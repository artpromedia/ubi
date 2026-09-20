package marketplace_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// TestReleaseFailureIsRecoveredBySweep: a hold whose release the wallet could
// not confirm is written down and the sweep retries it until the wallet
// agrees — the money is never silently forgotten.
func TestReleaseFailureIsRecoveredBySweep(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	created := submitBid(t, h, driver, requestID, amount, "")
	requireStatus(t, created, http.StatusCreated)
	bidView := decode(t, created)
	reservationID := bidView["reservationId"].(string)

	// The wallet goes dark exactly when the withdrawal wants to release.
	h.Wallet.FailRelease = errors.New("wallet down")
	withdraw := h.Do(http.MethodPost, "/mp/bids/"+bidView["bidId"].(string)+"/withdraw", driver, nil,
		move.IdempotencyHeader, idemKey())
	requireStatus(t, withdraw, http.StatusOK)
	if releases := releasesFor(h, reservationID); releases != 0 {
		t.Fatalf("the dark wallet cannot have released anything: %d", releases)
	}

	// The debt is on the books, and the next sweep with a healthy wallet
	// settles it — exactly once, however many sweeps run. The harness clock
	// is frozen at construction, so step past the row's next_retry_at.
	h.Wallet.FailRelease = nil
	h.Clock.Advance(2 * time.Second)
	ctx := context.Background()
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if releases := releasesFor(h, reservationID); releases != 1 {
		t.Fatalf("releases after recovery sweeps: got %d, want exactly 1", releases)
	}

	var unresolved int
	if err := h.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM mp.reservation_recovery WHERE reservation_id = $1 AND resolved_at IS NULL`,
		reservationID).Scan(&unresolved); err != nil {
		t.Fatal(err)
	}
	if unresolved != 0 {
		t.Fatalf("recovery rows left unresolved: %d", unresolved)
	}
}

// TestLegacyAcceptRefusesMarketplaceRides: a ride created by a marketplace
// award cannot be taken through the legacy offer-accept path.
func TestLegacyAcceptRefusesMarketplaceRides(t *testing.T) {
	h := newHarness(t)
	driver := h.Driver()
	goOnline(t, h, driver)

	ctx := context.Background()
	quoteID, rideID, offerID := uuid.New(), uuid.New(), uuid.New()
	riderID := uuid.New()
	pickup := testutil.PickupFixture()
	dropoff := testutil.DropoffFixture()
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO ride.quotes (id, city_id, config_version, rider_id, vehicle_class,
			pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
			distance_meters, duration_seconds, fare_minor, currency, breakdown, expires_at, consumed_by)
		VALUES ($1,$2,1,$3,'go',$4,$5,$6,$7,5000,600,50000,'NGN','{}'::jsonb, now() + interval '1 hour', $8)`,
		quoteID, h.CityID, riderID, pickup.Lat, pickup.Lng, dropoff.Lat, dropoff.Lng, rideID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO ride.rides (id, city_id, config_version, quote_id, rider_id,
			state, vehicle_class, payment_method_id,
			pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
			quoted_fare_minor, currency, pin_hash, marketplace_award_id)
		VALUES ($1,$2,1,$3,$4,$5,'go','wallet',$6,$7,$8,$9,50000,'NGN','\x00',$10)`,
		rideID, h.CityID, quoteID, riderID, machine.RiderMatching,
		pickup.Lat, pickup.Lng, dropoff.Lat, dropoff.Lng, uuid.New()); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO ride.offers (id, ride_id, driver_id, ring, radius_meters,
			distance_meters, eta_seconds, state, expires_at)
		VALUES ($1,$2,$3,0,2000,100,60,'offered', now() + interval '1 minute')`,
		offerID, rideID, driver.UserID); err != nil {
		t.Fatal(err)
	}

	recorder := h.Do(http.MethodPost, "/offers/"+offerID.String()+"/accept", driver, nil)
	requireCode(t, recorder, http.StatusConflict, domain.CodeRequestClosed)
}
