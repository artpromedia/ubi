package testutil

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
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
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
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

	// Marketplace pieces, wired when the harness is built WithMarketplace().
	Marketplace *marketplace.Service
	Wallet      *marketplace.FakeWallet
	Funding     *marketplace.FakeFunding
	Settlement  *marketplace.FakeSettlement

	// TripAccessKey / TripAccessKid are the sealed-delivery key the harness
	// built the marketplace with (a fresh random key per harness), so a test
	// can open trip_access.issued exactly as notification-service does. Nil
	// when built WithoutTripAccessSealer.
	TripAccessKey []byte
	TripAccessKid string

	// CityID is unique per harness, so tests running side by side never share
	// a city's config, flags, drivers or rides.
	CityID        string
	ConfigVersion int

	// Internal is the /internal/fleet router (internal contract A, A05)
	// exactly as cmd/server/main.go mounts it, authenticated by
	// FleetRideServiceKey. Drive it with DoInternal.
	Internal            http.Handler
	FleetRideServiceKey string
}

// HarnessOption customises a harness before it is built.
type HarnessOption func(*harnessOptions)

type harnessOptions struct {
	config       map[string]any
	policy       matching.Policy
	flags        map[string]bool
	withoutRedis bool
	marketplace  bool
	// A06: the verified driver-profile port and the capability source the
	// marketplace is built with (nil: the production defaults — no profile
	// service, nothing verified).
	driverProfiles marketplace.DriverProfilePort
	capabilities   marketplace.CapabilitySource
	// delivery is the award saga's delivery hand-off port (nil: the
	// production default for an unwired deployment — fail closed).
	delivery marketplace.DeliveryAssignPort
	// withoutTripAccessSealer builds the marketplace with no sealed-delivery
	// key: the production fail-closed posture for guest trip links.
	withoutTripAccessSealer bool
	// business is the business-travel port (nil: the production default for
	// an unwired deployment — every business call fails closed).
	business marketplace.BusinessPort
	// fleet is fleet-service's side of contract A (nil: the production
	// default for an unwired deployment — nothing is ever resolved), and
	// fleetRideServiceKey the key /internal/fleet accepts.
	fleet               marketplace.FleetServicePort
	fleetRideServiceKey *string
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

// WithDriverProfiles builds the marketplace with a driver-profile port — in
// tests, the real HTTP client pointed at an httptest server that answers
// user-service's documented contract.
func WithDriverProfiles(port marketplace.DriverProfilePort) HarnessOption {
	return func(o *harnessOptions) { o.driverProfiles = port }
}

// WithCapabilities builds the marketplace with a capability source: the seam
// a verified vehicle-capability registry plugs into.
func WithCapabilities(source marketplace.CapabilitySource) HarnessOption {
	return func(o *harnessOptions) { o.capabilities = source }
}

// WithDeliveryAssign builds the marketplace with a delivery hand-off port —
// in tests, the real HTTP client pointed at an httptest server that answers
// delivery-service's documented marketplace-assign contract.
func WithDeliveryAssign(port marketplace.DeliveryAssignPort) HarnessOption {
	return func(o *harnessOptions) { o.delivery = port }
}

// WithoutTripAccessSealer builds the marketplace with no
// TRIP_ACCESS_DELIVERY_KEY: guest trip links must be refused, fail closed.
func WithoutTripAccessSealer() HarnessOption {
	return func(o *harnessOptions) { o.withoutTripAccessSealer = true }
}

// WithBusiness builds the marketplace with a business-travel port — in
// tests, the real HTTP client pointed at an httptest server that answers
// payment-service's documented /v1/finance/business contract.
func WithBusiness(port marketplace.BusinessPort) HarnessOption {
	return func(o *harnessOptions) { o.business = port }
}

// WithFleetService builds the marketplace with fleet-service's side of
// internal contract A — in tests, the real HTTP client pointed at an
// httptest server that answers routes 8 and 9 as documented.
func WithFleetService(port marketplace.FleetServicePort) HarnessOption {
	return func(o *harnessOptions) { o.fleet = port }
}

// WithFleetRideServiceKey sets the FLEET_RIDE_SERVICE_KEY /internal/fleet
// accepts ("" is the production default when unset: fail closed).
func WithFleetRideServiceKey(key string) HarnessOption {
	return func(o *harnessOptions) { o.fleetRideServiceKey = &key }
}

// DefaultFleetRideServiceKey is the harness's FLEET_RIDE_SERVICE_KEY unless
// a test sets another (a fixture, 32+ characters).
const DefaultFleetRideServiceKey = "test-fleet-ride-service-key-0123456789abcdef"

// WithMarketplace attaches the marketplace policy fixture to the city config
// and opens the ride/delivery marketplace flags (queued jobs stays off; a
// test that wants it adds WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true)).
func WithMarketplace() HarnessOption {
	return func(o *harnessOptions) {
		o.marketplace = true
		o.config["marketplace"] = MarketplacePolicyFixture()
		o.flags[cityconfig.FlagMarketplaceRides] = true
		o.flags[cityconfig.FlagMarketplaceDelivery] = true
	}
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
	mpStore := marketplace.NewStore(pool)
	// Once per test binary: the DDL is idempotent, but two harnesses running it
	// at the same instant would queue behind each other's schema locks for no
	// benefit.
	migrateOnce.Do(func() {
		if migrateErr = store.Migrate(ctx); migrateErr != nil {
			return
		}
		migrateErr = mpStore.Migrate(ctx)
	})
	if migrateErr != nil {
		pool.Close()
		t.Fatalf("failed to apply the ride/mp schemas: %v", migrateErr)
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

	fakeWallet := marketplace.NewFakeWallet()
	fakeFunding := marketplace.NewFakeFunding()
	fakeSettlement := marketplace.NewFakeSettlement()
	// The marketplace router prices with the harness clock, so a test that
	// pins the hour gets the same ETA multiplier every run.
	mpRouter := move.NewStraightLineRouter()
	mpRouter.Now = clock.Now
	var tripAccessKey []byte
	var tripAccessKid string
	var tripAccessSealer *marketplace.TripAccessSealer
	if !options.withoutTripAccessSealer {
		tripAccessKey = make([]byte, 32)
		if _, err := rand.Read(tripAccessKey); err != nil {
			t.Fatalf("no randomness for the trip access key: %v", err)
		}
		tripAccessKid = "test-" + cityID
		if tripAccessSealer, err = marketplace.NewTripAccessSealer(base64.StdEncoding.EncodeToString(tripAccessKey), tripAccessKid); err != nil {
			t.Fatalf("failed to build the trip access sealer: %v", err)
		}
	}
	marketplaceService, err := marketplace.NewService(marketplace.Deps{
		Store:      mpStore,
		Config:     cityconfig.NewStore(pool, nil, time.Second),
		Flags:      cityconfig.NewFlags(pool),
		Pricing:    pricing.NewEngine(),
		Router:     mpRouter,
		Wallet:     fakeWallet,
		Funding:    fakeFunding,
		Settlement: fakeSettlement,
		Redis:      guards,
		Logger:     zerolog.Nop(),
		Now:        clock.Now,

		DriverProfiles: options.driverProfiles,
		Capabilities:   options.capabilities,
		Delivery:       options.delivery,

		TripAccessSealer: tripAccessSealer,
		Business:         options.business,
		Fleet:            options.fleet,
	})
	if err != nil {
		pool.Close()
		t.Fatalf("failed to build the marketplace service: %v", err)
	}
	// Production parity: the move core notifies the marketplace post-commit
	// when an execution ride ends (service.Build wires the same observer).
	service.SetExecutionObserver(marketplaceService)
	service.SetDriverActivityObserver(marketplaceService)

	rideHandler := handler.NewRideHandler(service, zerolog.Nop())
	marketplaceHandler := handler.NewMarketplaceHandler(marketplaceService, zerolog.Nop())
	router := rideHandler.Routes(handler.RequireIdentity(handler.NewInternalContextVerifier("", 0)), nil, marketplaceHandler)
	fleetKey := DefaultFleetRideServiceKey
	if options.fleetRideServiceKey != nil {
		fleetKey = *options.fleetRideServiceKey
	}
	internal := handler.FleetInternalRoutes(fleetKey, marketplaceHandler)

	h := &Harness{
		T: t, Pool: pool, Redis: redisClient, Service: service,
		Router: router, Signer: signer, Clock: clock,
		Marketplace: marketplaceService, Wallet: fakeWallet, Funding: fakeFunding, Settlement: fakeSettlement,
		TripAccessKey: tripAccessKey, TripAccessKid: tripAccessKid,
		CityID: cityID, ConfigVersion: version,
		Internal: internal, FleetRideServiceKey: fleetKey,
	}

	t.Cleanup(func() {
		h.cleanup(context.Background())
		_ = redisClient.Close()
		pool.Close()
	})
	return h
}

// cleanup removes every row this harness created. It runs even when a test
// fails, so a red test does not leave a city behind for the next one.
func (h *Harness) cleanup(ctx context.Context) {
	statements := []string{
		`DELETE FROM mp.reservation_recovery WHERE bid_id IN (SELECT id FROM mp.bids WHERE request_id IN (SELECT id FROM mp.requests WHERE city_id = $1))`,
		`DELETE FROM mp.driver_claims WHERE driver_id IN (SELECT driver_id FROM ride.driver_sessions WHERE city_id = $1)`,
		`DELETE FROM mp.driver_claims WHERE award_id IN (SELECT id FROM mp.awards WHERE request_id IN (SELECT id FROM mp.requests WHERE city_id = $1))`,
		// Completion settlement rows carry no bid: keyed by the award, they can
		// stay deferred while an amendment still holds open money (A02), and
		// must not be driven by a later test's sweep.
		`DELETE FROM mp.reservation_recovery WHERE bid_id IS NULL AND reservation_id IN (SELECT 'mp.settle:' || id::text FROM mp.awards WHERE request_id IN (SELECT id FROM mp.requests WHERE city_id = $1))`,
		// Rider funding releases the award paths wrote durably (keyed by
		// the award, no bid): a later test's sweep must not drive them.
		`DELETE FROM mp.reservation_recovery WHERE bid_id IS NULL AND reservation_id IN (SELECT 'mp.fund.release:' || id::text FROM mp.awards WHERE request_id IN (SELECT id FROM mp.requests WHERE city_id = $1))`,
		`DELETE FROM mp.amendments WHERE city_id = $1`,
		// A06/A04.3 rider confidence. Pickup estimates, preferred windows and
		// service needs cascade with their bids/requests; saved drivers are
		// keyed by the city of the trip they were saved from.
		`DELETE FROM mp.favourite_drivers WHERE city_id = $1`,
		`DELETE FROM mp.execution_routes WHERE city_id = $1`,
		// A05 fleet calendar: off-road use flags reference the ledger; the
		// ledger's fleet rows use this harness's vehicle ids (VehicleID) and
		// its booking rows this city's bookings. Swaps and risk blockers
		// cascade with their bookings.
		`DELETE FROM mp.offroad_use_flags WHERE city_id = $1 OR vehicle_id LIKE 'veh-' || $1 || '-%'`,
		`DELETE FROM mp.vehicle_occupancy WHERE vehicle_id LIKE 'veh-' || $1 || '-%'
			OR (kind = 'booking' AND source_id IN (SELECT id::text FROM mp.advance_bookings WHERE city_id = $1))`,
		// A03 Book for Later: the booking calendar references awards and
		// requests; occurrences reference their templates.
		`DELETE FROM mp.advance_bookings WHERE city_id = $1`,
		`DELETE FROM mp.scheduled_requests WHERE city_id = $1`,
		`DELETE FROM mp.recurring_templates WHERE city_id = $1`,
		`DELETE FROM mp.awards WHERE request_id IN (SELECT id FROM mp.requests WHERE city_id = $1)`,
		`DELETE FROM mp.bids WHERE request_id IN (SELECT id FROM mp.requests WHERE city_id = $1)`,
		`DELETE FROM mp.requests WHERE city_id = $1`,
		`DELETE FROM mp.quotes WHERE city_id = $1`,
		`DELETE FROM mp.rate_profiles WHERE city_id = $1`,
		`DELETE FROM mp.driver_preferences WHERE city_id = $1`,
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
	// The idempotency rows are keyed by actor, not city, so they are cleared
	// by age instead. Only aged rows: several test binaries share this
	// database, and deleting rows written moments ago would yank another
	// binary's in-flight replay out from under it.
	if _, err := h.Pool.Exec(ctx, `DELETE FROM ride.idempotency_keys WHERE created_at < now() - interval '1 hour'`); err != nil {
		h.T.Logf("cleanup of idempotency keys failed: %v", err)
	}
	if _, err := h.Pool.Exec(ctx, `DELETE FROM mp.idempotency_keys WHERE created_at < now() - interval '1 hour'`); err != nil {
		h.T.Logf("cleanup of mp idempotency keys failed: %v", err)
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

	var request *http.Request
	if body == nil {
		request = httptest.NewRequest(method, path, nil)
	} else {
		encoded, err := json.Marshal(body)
		if err != nil {
			h.T.Fatalf("failed to encode the request body: %v", err)
		}
		// A *bytes.Reader, so httptest sets Content-Length the way a real
		// client would: a handler that reads the header must see a real value.
		request = httptest.NewRequest(method, path, bytes.NewReader(encoded))
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

// VehicleID is a fleet vehicle id scoped to this harness (its cleanup
// removes every ledger row written for it).
func (h *Harness) VehicleID(name string) string {
	return "veh-" + h.CityID + "-" + name
}

// DoInternal sends a request through the /internal/fleet router with the
// given X-Service-Key ("" sends none), as fleet-service would.
func (h *Harness) DoInternal(method, path, serviceKey string, body any, headers ...string) *httptest.ResponseRecorder {
	h.T.Helper()
	var request *http.Request
	if body == nil {
		request = httptest.NewRequest(method, path, nil)
	} else {
		encoded, err := json.Marshal(body)
		if err != nil {
			h.T.Fatalf("failed to encode the request body: %v", err)
		}
		request = httptest.NewRequest(method, path, bytes.NewReader(encoded))
		request.Header.Set("Content-Type", "application/json")
	}
	if serviceKey != "" {
		request.Header.Set(marketplace.FleetServiceKeyHeader, serviceKey)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		request.Header.Set(headers[i], headers[i+1])
	}
	recorder := httptest.NewRecorder()
	h.Internal.ServeHTTP(recorder, request)
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
