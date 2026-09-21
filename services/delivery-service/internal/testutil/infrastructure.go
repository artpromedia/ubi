package testutil

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

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
// before either service's tests run, so `deliveries` and the new
// delivery_custody/custody_events/delivery_proofs/delivery_returns tables
// this package needs are already there. DELIVERY_TEST_DATABASE_URL /
// DELIVERY_TEST_REDIS_URL let a run target a different instance; absent
// those, RIDE_TEST_DATABASE_URL / RIDE_TEST_REDIS_URL (what CI actually sets
// today) are read next, then the local default.
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

	// Verifier is exposed so a test can sign a request the way the gateway
	// would when it wants to exercise the signed path instead of the
	// dev-trust default.
	Verifier *identity.Verifier
}

// NewHarness builds the service against live Postgres and Redis and registers
// cleanup that removes everything a test writes, scoped by the delivery ids
// the test itself creates (there is no per-test city/tenant to scope by, so
// callers pass the delivery ids they seed to Cleanup via T.Cleanup, or use
// SeedDelivery, which registers its own cleanup).
func NewHarness(t *testing.T) *Harness {
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

	rdb, err := deliveryredis.New(redisURL)
	if err != nil {
		pool.Close()
		t.Fatalf("failed to reach test Redis at %s: %v", redisURL, err)
	}

	cfg := &config.Config{
		Env:                "test",
		InternalServiceKey: "test-internal-service-key-not-the-committed-default",
		JWTSecret:          "test-jwt-secret-not-the-committed-default",
	}

	db := &database.DB{Pool: pool}
	h := handlers.New(db, rdb, cfg)
	// Unsigned dev-trust posture in tests, matching production's posture when
	// RIDE_INTERNAL_CONTEXT_SECRET is unset (see internal/identity's package
	// doc for why this is not hardened here). SignedHarness below builds one
	// WITH a configured secret for tests that need to exercise verification.
	verifier := identity.NewVerifier("", 0)
	router := handlers.Routes(h, identity.RequireIdentity(verifier))

	harness := &Harness{T: t, Pool: pool, Redis: rdb, Router: router, Cfg: cfg, Verifier: verifier}
	t.Cleanup(func() {
		_ = rdb.Close()
		pool.Close()
	})
	return harness
}

// seedUserAndRider creates a `users` row and a `riders` row whose id IS
// riderID, so a delivery's sender_id (which FKs to riders.id, not users.id —
// see SeedDelivery) can legitimately reference it. Best-effort idempotent:
// safe to call more than once for the same id.
func (h *Harness) seedUserAndRider(ctx context.Context, riderID string) {
	h.T.Helper()
	short := riderID[:8]
	userID := uuid.New().String()
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO users (id, email, phone, password_hash, first_name, last_name, country, created_at, updated_at)
		VALUES ($1, $2, $3, 'x', 'Test', 'Sender', 'NG', now(), now())
		ON CONFLICT (id) DO NOTHING
	`, userID, "sender-"+short+"@test.ubi.africa", "+234"+short[:7]); err != nil {
		h.T.Fatalf("failed to seed a test user: %v", err)
	}
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO riders (id, user_id, referral_code, created_at, updated_at)
		VALUES ($1, $2, $3, now(), now())
		ON CONFLICT (id) DO NOTHING
	`, riderID, userID, "REF-"+short); err != nil {
		h.T.Fatalf("failed to seed a test rider: %v", err)
	}
	h.T.Cleanup(func() {
		if _, err := h.Pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID); err != nil {
			h.T.Logf("cleanup of seeded test user %s failed: %v", userID, err)
		}
	})
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

	// deliveries.sender_id carries a real FK to `riders` (a profile row, not
	// the bare user id) — a pre-existing constraint from the Prisma baseline,
	// unrelated to custody. A user+rider row is seeded here purely to satisfy
	// that FK for a realistic test; see the C07 report for why
	// MarketplaceAssign accepting a bare user id in `customerId` and writing
	// it straight to sender_id is itself a further, pre-existing gap this
	// prompt does not close (it would require ride-service's marketplace
	// engine, or the FK design itself, to change — both out of scope here).
	h.seedUserAndRider(ctx, sender.UserID.String())

	id := uuid.New().String()
	trackingNumber := "TRK" + uuid.New().String()[:8]
	metadata := []byte(`{"marketplaceAwardId":"awd_test","marketplaceRequestId":"mpr_test","agreedFareMinor":100000,"marketplaceFencingToken":1}`)

	// Mirrors handlers.MarketplaceAssign's real INSERT column-for-column
	// (packages/database/prisma migration 20260921033947_delivery_custody):
	// this is the same seeding a real marketplace award hand-off performs,
	// not a fictional shape.
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
		)`, id, trackingNumber, sender.UserID.String(), driver.UserID.String(), metadata)
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
