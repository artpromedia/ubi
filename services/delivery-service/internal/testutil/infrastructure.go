package testutil

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/config"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/database"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/handlers"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/identity"
	deliveryredis "github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/redis"
)

// The harness talks to the real Postgres and the real Redis this repository
// runs against. There is no container runtime in this environment (the
// previous version of this file started testcontainers, which cannot pull
// images here) and no in-memory substitute worth having: the guarantees C07
// asks for — exactly one custody transition under a concurrent race, an
// idempotent proof with no second row, a return that cannot complete a
// charged leg — are properties of the database, and a fake would only prove
// the fake agrees with itself.
//
// The database is the SAME ubi_test database ride-service's own harness uses
// (services/ride-service/internal/testutil/infrastructure.go): CI's unit-go
// job (.github/workflows/test.yml) provisions ONE Postgres + Redis pair for
// both services in its matrix and runs `prisma migrate deploy` against it
// before either service's tests run. The harness does not trust that
// blindly: ensurePrismaMigrated (migrations.go) checks the database against
// packages/database/prisma/migrations, applies anything pending with Prisma,
// and proves the real deliveries.sender_id -> riders foreign key is present —
// the delivery tests never run against a handcrafted, permissive schema.
// DELIVERY_TEST_DATABASE_URL / DELIVERY_TEST_REDIS_URL let a run target a
// different instance; absent those, RIDE_TEST_DATABASE_URL /
// RIDE_TEST_REDIS_URL (what CI actually sets today) are read next, then the
// local default.
//
// Proof storage is a real S3 protocol endpoint (s3.go) and payment-service's
// return-fee endpoint a contract stub (paymentstub.go), both wired through
// configuration exactly as production wires the real ones.
const (
	defaultDatabaseURL = "postgres://ubi:ubi_dev_password@127.0.0.1:5432/ubi_test?sslmode=disable"
	defaultRedisURL    = "redis://127.0.0.1:6379/3"
)

func envOr(keys []string, fallback string) string {
	for _, key := range keys {
		if v := os.Getenv(key); v != "" {
			return v
		}
	}
	return fallback
}

// Harness wires the real delivery-service HTTP handlers against live
// Postgres and Redis, through the SAME gateway-identity middleware production
// uses for the custody/return routes.
type Harness struct {
	T      *testing.T
	Pool   *pgxpool.Pool
	Redis  *deliveryredis.Client
	Router http.Handler
	Cfg    *config.Config

	// Verifier is the verifier handlers.NewRouter mounted, exposed so a test
	// can sign a request the way the gateway would (DoSigned) when it wants to
	// exercise the signed path instead of the dev-trust default.
	Verifier *identity.Verifier

	// S3 is this harness's proof bucket (nil with Options.NoProofStorage).
	S3 *TestS3
	// Payment is payment-service's return-fee contract stub (always
	// running; charged returns only reach it when Options.ChargedReturns).
	Payment *PaymentStub
}

// Options select a harness posture.
type Options struct {
	// Production builds the production posture (UBI_ENV=production).
	Production bool
	// ContextSecret is RIDE_INTERNAL_CONTEXT_SECRET.
	ContextSecret string
	// NoProofStorage leaves proof object storage unconfigured.
	NoProofStorage bool
	// ChargedReturns turns DELIVERY_CHARGED_RETURNS_ENABLED on.
	ChargedReturns bool
	// NoPaymentService leaves PAYMENT_SERVICE_URL empty (the return-fee
	// port is then funding.Disabled).
	NoPaymentService bool
	// UploadTTL / DownloadTTL override the proof URL lifetimes.
	UploadTTL   time.Duration
	DownloadTTL time.Duration
}

const testInternalServiceKey = "test-internal-service-key-not-the-committed-default"

// ServiceKey is the harness's INTERNAL_SERVICE_KEY, for calls to the
// service-key webhooks (marketplace-assign).
func (h *Harness) ServiceKey() string { return h.Cfg.InternalServiceKey }

// NewHarness builds the service against live Postgres and Redis and registers
// cleanup that removes everything a test writes, scoped by the delivery ids
// the test itself creates (there is no per-test city/tenant to scope by, so
// callers pass the delivery ids they seed to Cleanup via T.Cleanup, or use
// SeedDelivery, which registers its own cleanup). Unsigned dev-trust posture
// (a non-production environment with no RIDE_INTERNAL_CONTEXT_SECRET), with a
// real proof bucket and charged returns OFF (the deny-by-default posture).
func NewHarness(t *testing.T) *Harness {
	t.Helper()
	return NewHarnessWith(t, Options{})
}

// NewProductionHarness builds the service exactly as a production process
// wires it — UBI_ENV=production, non-default service key and JWT secret, and
// contextSecret as RIDE_INTERNAL_CONTEXT_SECRET — through the same
// handlers.NewRouter cmd/server serves. It deliberately does NOT run
// config.ValidateProduction: a test proving the per-request second line of
// defence must be able to build the router boot would have refused (an empty
// contextSecret); such a test asserts the boot refusal itself.
func NewProductionHarness(t *testing.T, contextSecret string) *Harness {
	t.Helper()
	return NewHarnessWith(t, Options{Production: true, ContextSecret: contextSecret})
}

// NewHarnessWith builds the service in the posture opts describe.
func NewHarnessWith(t *testing.T, opts Options) *Harness {
	t.Helper()
	env := "test"
	if opts.Production {
		env = "production"
	}
	payment := NewPaymentStub(t, testInternalServiceKey)
	cfg := &config.Config{
		Env:                   env,
		InternalServiceKey:    testInternalServiceKey,
		JWTSecret:             "test-jwt-secret-not-the-committed-default",
		InternalContextSecret: opts.ContextSecret,
		PaymentServiceURL:     payment.Server.URL,
		ChargedReturnsEnabled: opts.ChargedReturns,
	}
	if opts.NoPaymentService {
		cfg.PaymentServiceURL = ""
	}
	var store *TestS3
	if !opts.NoProofStorage {
		store = NewTestS3(t)
		cfg.ProofStorage = store.Config
		if opts.UploadTTL > 0 {
			cfg.ProofStorage.UploadTTL = opts.UploadTTL
		}
		if opts.DownloadTTL > 0 {
			cfg.ProofStorage.DownloadTTL = opts.DownloadTTL
		}
	}
	harness := newHarness(t, cfg)
	harness.S3 = store
	harness.Payment = payment
	return harness
}

func newHarness(t *testing.T, cfg *config.Config) *Harness {
	t.Helper()
	ctx := context.Background()

	dbURL := envOr([]string{"DELIVERY_TEST_DATABASE_URL", "RIDE_TEST_DATABASE_URL"}, defaultDatabaseURL)
	redisURL := envOr([]string{"DELIVERY_TEST_REDIS_URL", "RIDE_TEST_REDIS_URL"}, defaultRedisURL)

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("failed to create the test database pool: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("failed to reach the test database at %s: %v", dbURL, err)
	}
	ensurePrismaMigrated(t, pool, dbURL)

	rdb, err := deliveryredis.New(redisURL)
	if err != nil {
		pool.Close()
		t.Fatalf("failed to reach test Redis at %s: %v", redisURL, err)
	}

	db := &database.DB{Pool: pool}
	h := handlers.New(db, rdb, cfg)
	// The production router, not a test-only assembly: the verifier's posture
	// comes from cfg exactly as it does in cmd/server.
	router, verifier := handlers.NewRouter(h)

	harness := &Harness{T: t, Pool: pool, Redis: rdb, Router: router, Cfg: cfg, Verifier: verifier}
	t.Cleanup(func() {
		_ = rdb.Close()
		pool.Close()
	})
	return harness
}

// SeedUser inserts a real `users` row whose id IS userID (the gateway user
// identity) and registers its cleanup. Idempotent.
func (h *Harness) SeedUser(ctx context.Context, userID string) {
	h.T.Helper()
	short := userID[:8]
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO users (id, email, phone, password_hash, first_name, last_name, country, created_at, updated_at)
		VALUES ($1, $2, $3, 'x', 'Test', 'User', 'NG', now(), now())
		ON CONFLICT (id) DO NOTHING
	`, userID, "user-"+userID+"@test.ubi.africa", "+234"+short+userID[9:13]); err != nil {
		h.T.Fatalf("failed to seed a test user: %v", err)
	}
	h.T.Cleanup(func() {
		// Deliveries reference the rider profile (no cascade), so remove them
		// before the user whose profile cascades away with it.
		_, _ = h.Pool.Exec(context.Background(), `DELETE FROM deliveries WHERE sender_id IN (SELECT id FROM riders WHERE user_id = $1)`, userID)
		if _, err := h.Pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID); err != nil {
			h.T.Logf("cleanup of seeded test user %s failed: %v", userID, err)
		}
	})
}

// SeedRiderProfile gives an existing user a rider profile and returns the
// profile's own id — a DIFFERENT uuid from the user id, exactly as in
// production, so a test can tell the two identities apart.
func (h *Harness) SeedRiderProfile(ctx context.Context, userID string) string {
	h.T.Helper()
	riderID := uuid.New().String()
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO riders (id, user_id, referral_code, created_at, updated_at)
		VALUES ($1, $2, $3, now(), now())
	`, riderID, userID, "REF-"+riderID[:13]); err != nil {
		h.T.Fatalf("failed to seed a rider profile: %v", err)
	}
	return riderID
}

// Actor is a caller identity for a request.
type Actor struct {
	UserID uuid.UUID
	Role   string
	CityID string
}

// Sender returns a fresh rider (sender) identity.
func Sender() Actor { return Actor{UserID: uuid.New(), Role: identity.RoleRider, CityID: "LOS"} }

// Driver returns a fresh driver identity.
func Driver() Actor { return Actor{UserID: uuid.New(), Role: identity.RoleDriver, CityID: "LOS"} }

// Do sends a request through the real router with the gateway's identity
// headers, and returns the recorded response.
func (h *Harness) Do(req *http.Request, actor Actor) *httptest.ResponseRecorder {
	h.T.Helper()
	if actor.UserID != uuid.Nil {
		req.Header.Set(identity.HeaderUserID, actor.UserID.String())
		req.Header.Set(identity.HeaderUserRole, actor.Role)
		if actor.CityID != "" {
			req.Header.Set(identity.HeaderCityID, actor.CityID)
		}
	}
	rec := httptest.NewRecorder()
	h.Router.ServeHTTP(rec, req)
	return rec
}

// DoSigned sends a request the way the API gateway does when
// RIDE_INTERNAL_CONTEXT_SECRET is configured: the identity headers plus a
// fresh HMAC signature from the harness's verifier (its current key). It
// fails the test if the harness has no key, rather than silently sending an
// unsigned request.
func (h *Harness) DoSigned(req *http.Request, actor Actor) *httptest.ResponseRecorder {
	h.T.Helper()
	if !h.Verifier.Enabled() {
		h.T.Fatal("DoSigned needs a harness built with an internal context secret")
	}
	issuedAt := time.Now()
	req.Header.Set(identity.HeaderSignature, h.Verifier.Sign(actor.UserID.String(), actor.Role, actor.CityID, issuedAt))
	req.Header.Set(identity.HeaderIssuedAt, strconv.FormatInt(issuedAt.Unix(), 10))
	return h.Do(req, actor)
}

// SeedDelivery inserts a `deliveries` row plus its `delivery_custody` row the
// way handlers.MarketplaceAssign would, and registers cleanup. It returns the
// delivery id, and the sender/driver actors it created if the caller passed
// the zero Actor for either.
func (h *Harness) SeedDelivery(ctx context.Context, sender, driver Actor, state string) (deliveryID string, out struct {
	Sender Actor
	Driver Actor
}) {
	h.T.Helper()
	if sender.UserID == uuid.Nil {
		sender = Sender()
	}
	if driver.UserID == uuid.Nil {
		driver = Driver()
	}
	out.Sender, out.Driver = sender, driver

	// The two identities, exactly as production has them (P17): the sender's
	// USER id (a real users row — the gateway identity the custody access
	// matrix compares) and its rider PROFILE (a separate riders row, whose id
	// deliveries.sender_id's real foreign key demands).
	h.SeedUser(ctx, sender.UserID.String())
	riderID := h.SeedRiderProfile(ctx, sender.UserID.String())

	id := uuid.New().String()
	trackingNumber := "TRK" + uuid.New().String()[:8]
	metadata := []byte(fmt.Sprintf(`{"marketplaceAwardId":"awd_%s","marketplaceRequestId":"mpr_test","agreedFareMinor":100000,"marketplaceFencingToken":1}`, id[:8]))

	// Mirrors handlers.MarketplaceAssign's real INSERT column-for-column: the
	// same rows a real marketplace award hand-off writes (sender_id = the
	// rider profile, custody sender = the user), not a fictional shape.
	_, err := h.Pool.Exec(ctx, `
		INSERT INTO deliveries (
			id, tracking_number, sender_id, driver_id, status,
			pickup_address, pickup_latitude, pickup_longitude, pickup_contact, pickup_phone,
			dropoff_address, dropoff_latitude, dropoff_longitude, dropoff_contact, dropoff_phone,
			package_size, package_weight, package_description, is_fragile, requires_signature,
			price, currency, payment_method, payment_status,
			marketplace_metadata, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, 'PENDING',
			'Victoria Island, Lagos', 6.4281, 3.4219, '', '',
			'Lekki, Lagos', 6.4579, 3.5856, '', '',
			'SMALL', 1.2, 'Documents', false, true,
			1000.00, 'NGN', 'WALLET', 'PENDING',
			$5, now(), now()
		)`, id, trackingNumber, riderID, driver.UserID.String(), metadata)
	if err != nil {
		h.T.Fatalf("failed to seed a delivery: %v", err)
	}

	if state == "" {
		state = "courier_assigned"
	}
	_, err = h.Pool.Exec(ctx, `
		INSERT INTO delivery_custody (delivery_id, state, version, sender_id, driver_id, created_at, updated_at)
		VALUES ($1, $2, 1, $3, $4, now(), now())`,
		id, state, sender.UserID.String(), driver.UserID.String())
	if err != nil {
		h.T.Fatalf("failed to seed delivery_custody: %v", err)
	}

	h.T.Cleanup(func() {
		// CASCADE takes custody_events/delivery_proofs/delivery_returns/delivery_custody with it.
		if _, err := h.Pool.Exec(context.Background(), `DELETE FROM deliveries WHERE id = $1`, id); err != nil {
			h.T.Logf("cleanup of seeded delivery %s failed: %v", id, err)
		}
	})

	return id, out
}
