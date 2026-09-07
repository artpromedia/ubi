package testutil

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	goredis "github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/handler"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/matching"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/pricing"
	ridisc "github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/redis"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/repository"
)

// The harness talks to the real Postgres and the real Redis this repository
// runs against. There is no container runtime in this environment and no
// in-memory substitute worth having: the guarantees slice 02 asks for —
// exactly one accept under concurrency, a unique active ride per driver, a
// transaction that carries its own outbox row — are properties of the
// database, and a fake would only prove that the fake agrees with itself.
const (
	defaultDatabaseURL = "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_test"
	defaultRedisURL    = "redis://127.0.0.1:6379/1"
	// testSigningSecret is a fixture, used only by tests in this package tree.
	testSigningSecret = "test-quote-signing-secret-at-least-32-bytes"
)

var (
	migrateOnce sync.Once
	migrateErr  error
)

// Harness is a wired ride service pointed at live infrastructure, plus the
// seeded city configuration every test needs and the router the handlers
// really serve.
type Harness struct {
	T       *testing.T
	Pool    *pgxpool.Pool
	Redis   *goredis.Client
	Service *move.Service
	Router  http.Handler
	Signer  *move.QuoteSigner
	Clock   *Clock

	// CityID is unique per harness, so tests running side by side never share
	// a city's config, flags, drivers or rides.
	CityID        string
	ConfigVersion int
}

// HarnessOption customises a harness before it is built.
type HarnessOption func(*harnessOptions)

type harnessOptions struct {
	config       map[string]any
	policy       matching.Policy
	flags        map[string]bool
	withoutRedis bool
}

// WithCityConfig replaces the seeded city configuration.
func WithCityConfig(config map[string]any) HarnessOption {
	return func(o *harnessOptions) { o.config = config }
}

// WithPolicy replaces the dispatch policy.
func WithPolicy(policy matching.Policy) HarnessOption {
	return func(o *harnessOptions) { o.policy = policy }
}

// WithoutRedisGuards builds the service with no Redis at all.
//
// It exists for one test: the headline concurrency guard. With the SETNX accept
// lock gone, every concurrent accept reaches the database, so what the test
// proves is the database's guarantee rather than Redis's — which is the one
// that has to hold when Redis is down or a key has expired early.
func WithoutRedisGuards() HarnessOption {
	return func(o *harnessOptions) { o.withoutRedis = true }
}

// WithFlag sets a feature flag for the harness city.
func WithFlag(key string, enabled bool) HarnessOption {
	return func(o *harnessOptions) { o.flags[key] = enabled }
}

// NewHarness builds the service against live Postgres and Redis, seeds a city,
// and registers cleanup that removes everything it wrote.
func NewHarness(t *testing.T, opts ...HarnessOption) *Harness {
	t.Helper()

	ctx := context.Background()
	cityID := "T" + uuid.NewString()[:7]

	options := &harnessOptions{
		config: CityConfigFixture(cityID, 1),
		policy: matching.DefaultPolicy(),
		flags: map[string]bool{
			cityconfig.FlagMove:         true,
			cityconfig.FlagRideRequest:  true,
			cityconfig.FlagDriverOnline: true,
		},
	}
	for _, opt := range opts {
		opt(options)
	}

	pool, err := pgxpool.New(ctx, envOr("RIDE_TEST_DATABASE_URL", defaultDatabaseURL))
	if err != nil {
		t.Fatalf("failed to create the test database pool: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("failed to reach the test database: %v", err)
	}

	redisOptions, err := goredis.ParseURL(envOr("RIDE_TEST_REDIS_URL", defaultRedisURL))
	if err != nil {
		pool.Close()
		t.Fatalf("failed to parse the test Redis URL: %v", err)
	}
	redisClient := goredis.NewClient(redisOptions)
	if err := redisClient.Ping(ctx).Err(); err != nil {
		pool.Close()
		t.Fatalf("failed to reach test Redis: %v", err)
	}

	store := move.NewStore(pool)
	// Once per test binary: the DDL is idempotent, but two harnesses running it
	// at the same instant would queue behind each other's schema locks for no
	// benefit.
	migrateOnce.Do(func() { migrateErr = store.Migrate(ctx) })
	if migrateErr != nil {
		pool.Close()
		t.Fatalf("failed to apply the ride schema: %v", migrateErr)
	}

	version, ok := options.config["version"].(int)
	if !ok {
		version = 1
	}
	seedCity(t, ctx, pool, cityID, version, options.config, options.flags)

	signer, err := move.NewQuoteSigner(testSigningSecret)
	if err != nil {
		t.Fatalf("failed to build the quote signer: %v", err)
	}

	guards := ridisc.New(redisClient)
	if options.withoutRedis {
		guards = ridisc.New(nil)
	}

	clock := NewClock(time.Now().UTC())
	service, err := move.NewService(move.Deps{
		Store:   store,
		Config:  cityconfig.NewStore(pool, nil, time.Second),
		Flags:   cityconfig.NewFlags(pool),
		Pricing: pricing.NewEngine(),
		Signer:  signer,
		Router:  move.NewStraightLineRouter(),
		Redis:   guards,
		Ledger:  repository.NewLedgerRepository(pool),
		Policy:  options.policy,
		Logger:  zerolog.Nop(),
		Now:     clock.Now,
	})
	if err != nil {
		pool.Close()
		t.Fatalf("failed to build the move service: %v", err)
	}

	rideHandler := handler.NewRideHandler(service, zerolog.Nop())
	router := rideHandler.Routes(handler.RequireIdentity(handler.NewInternalContextVerifier("", 0)), nil)

	h := &Harness{
		T: t, Pool: pool, Redis: redisClient, Service: service,
		Router: router, Signer: signer, Clock: clock,
		CityID: cityID, ConfigVersion: version,
	}

	t.Cleanup(func() {
		h.cleanup(context.Background())
		redisClient.Close()
		pool.Close()
	})
	return h
}

// cleanup removes every row this harness created. It runs even when a test
// fails, so a red test does not leave a city behind for the next one.
func (h *Harness) cleanup(ctx context.Context) {
	statements := []string{
		`DELETE FROM ride.offers WHERE ride_id IN (SELECT id FROM ride.rides WHERE city_id = $1)`,
		`DELETE FROM ride.rides WHERE city_id = $1`,
		`DELETE FROM ride.quotes WHERE city_id = $1`,
		`DELETE FROM ride.driver_sessions WHERE city_id = $1`,
		`DELETE FROM public.outbox_events WHERE city_id = $1`,
		`DELETE FROM public.flag_rules WHERE city_id = $1`,
		`DELETE FROM public.city_config_versions WHERE city_id = $1`,
		`DELETE FROM public.cities WHERE id = $1`,
	}
	for _, statement := range statements {
		if _, err := h.Pool.Exec(ctx, statement, h.CityID); err != nil {
			h.T.Logf("cleanup statement failed (%s): %v", statement, err)
		}
	}
	// The idempotency rows are keyed by actor, not city, so they are cleared by
	// scope instead.
	if _, err := h.Pool.Exec(ctx, `DELETE FROM ride.idempotency_keys WHERE created_at < now()`); err != nil {
		h.T.Logf("cleanup of idempotency keys failed: %v", err)
	}
}

// Actor is a caller identity for a request.
type Actor struct {
	UserID uuid.UUID
	Role   string
	CityID string
}

// Rider returns a fresh rider identity in the harness city.
func (h *Harness) Rider() Actor {
	return Actor{UserID: uuid.New(), Role: move.RoleRider, CityID: h.CityID}
}

// Driver returns a fresh driver identity in the harness city.
func (h *Harness) Driver() Actor {
	return Actor{UserID: uuid.New(), Role: move.RoleDriver, CityID: h.CityID}
}

// Do sends a request through the real router with the gateway's identity
// headers, and returns the recorded response.
func (h *Harness) Do(method, path string, actor Actor, body any, headers ...string) *httptest.ResponseRecorder {
	h.T.Helper()

	var reader *jsonReader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			h.T.Fatalf("failed to encode the request body: %v", err)
		}
		reader = newJSONReader(encoded)
	}

	var request *http.Request
	if reader == nil {
		request = httptest.NewRequest(method, path, nil)
	} else {
		request = httptest.NewRequest(method, path, reader)
		request.Header.Set("Content-Type", "application/json")
	}
	if actor.UserID != uuid.Nil {
		request.Header.Set(handler.HeaderUserID, actor.UserID.String())
		request.Header.Set(handler.HeaderUserRole, actor.Role)
		if actor.CityID != "" {
			request.Header.Set(handler.HeaderCityID, actor.CityID)
		}
	}
	for i := 0; i+1 < len(headers); i += 2 {
		request.Header.Set(headers[i], headers[i+1])
	}

	recorder := httptest.NewRecorder()
	h.Router.ServeHTTP(recorder, request)
	return recorder
}

// DecodeBody decodes a recorded response body, failing the test if it cannot.
func (h *Harness) DecodeBody(recorder *httptest.ResponseRecorder, target any) {
	h.T.Helper()
	if err := json.Unmarshal(recorder.Body.Bytes(), target); err != nil {
		h.T.Fatalf("failed to decode the response body %q: %v", recorder.Body.String(), err)
	}
}

// seedCity writes the city, its activated configuration version and its flag
// rules. It is the same shape config-service writes, read back by the same
// query the service uses in production.
func seedCity(t *testing.T, ctx context.Context, pool *pgxpool.Pool, cityID string, version int, config map[string]any, flags map[string]bool) {
	t.Helper()

	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatalf("failed to encode the city configuration: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO public.cities (id, name, country, timezone, active, updated_at)
		VALUES ($1, $2, 'NG', 'Africa/Lagos', true, now())
		ON CONFLICT (id) DO UPDATE SET active = true, updated_at = now()`,
		cityID, "Test City "+cityID); err != nil {
		t.Fatalf("failed to seed the test city: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO public.city_config_versions (id, city_id, version, config, activated_at, created_by, updated_at)
		VALUES ($1, $2, $3, $4, now(), 'system:test', now())`,
		"ccv_"+cityID, cityID, version, encoded); err != nil {
		t.Fatalf("failed to seed the city configuration: %v", err)
	}

	for key, enabled := range flags {
		if _, err := pool.Exec(ctx, `
			INSERT INTO public.feature_flags (key, default_on, description, updated_at)
			VALUES ($1, false, $2, now())
			ON CONFLICT (key) DO NOTHING`, key, key+" vertical"); err != nil {
			t.Fatalf("failed to register the %s flag: %v", key, err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO public.flag_rules (id, flag_key, city_id, enabled, updated_by, updated_at)
			VALUES ($1, $2, $3, $4, 'system:test', now())
			ON CONFLICT (flag_key, city_id) DO UPDATE SET enabled = EXCLUDED.enabled`,
			fmt.Sprintf("flr_%s_%s", key, cityID), key, cityID, enabled); err != nil {
			t.Fatalf("failed to seed the %s flag rule: %v", key, err)
		}
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
