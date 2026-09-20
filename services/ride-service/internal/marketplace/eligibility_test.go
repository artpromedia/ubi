package marketplace_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// evaluate runs the one server-owned eligibility function directly.
func evaluate(t *testing.T, h *testutil.Harness, driver testutil.Actor, requestID string) *marketplace.EligibilityView {
	t.Helper()
	config, policy := cityPolicy(t, h)
	request := requestRow(t, h, requestID)
	view, err := h.Marketplace.EvaluateEligibility(context.Background(), moveActor(driver), request, config, policy)
	if err != nil {
		t.Fatalf("eligibility evaluation failed: %v", err)
	}
	return view
}

func TestEligibilityOffline(t *testing.T) {
	h := newHarness(t)
	view, _ := publishAt(t, h, h.Rider(), 0)
	driver := h.Driver() // never went online

	result := evaluate(t, h, driver, view["requestId"].(string))
	if result.Eligible || !hasReason(result, "OFFLINE") {
		t.Fatalf("an unknown driver must be OFFLINE: %+v", result)
	}
}

func TestEligibilityStaleLocation(t *testing.T) {
	h := newHarness(t)
	view, _ := publishAt(t, h, h.Rider(), 0)
	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PickupFixture())

	// Fresh now: eligible for the current slot.
	fresh := evaluate(t, h, driver, view["requestId"].(string))
	if !fresh.Eligible || fresh.Slot == nil || *fresh.Slot != "current" {
		t.Fatalf("a parked driver at the pickup must be eligible: %+v", fresh.Reasons)
	}

	// Three minutes later the fix is older than maxLocationAgeSec (120).
	h.Clock.Advance(3 * time.Minute)
	stale := evaluate(t, h, driver, view["requestId"].(string))
	if stale.Eligible || !hasReason(stale, "LOCATION_STALE") {
		t.Fatalf("a stale fix must refuse with LOCATION_STALE: %+v", stale)
	}
}

func TestEligibilityNotStationary(t *testing.T) {
	h := newHarness(t)
	view, _ := publishAt(t, h, h.Rider(), 0)
	requestID := view["requestId"].(string)
	driver := h.Driver()
	goOnline(t, h, driver)

	// One just-now fix cannot prove a dwell window; parked or not, the gate
	// stays closed.
	now := h.Clock.Now()
	ingestPoints(t, h, driver, []map[string]any{point(1, testutil.PickupFixture(), now.Add(-time.Second), 0)})
	recorder := h.Do(http.MethodPost, "/mp/driver/parked", driver, nil)
	requireStatus(t, recorder, http.StatusOK)

	result := evaluate(t, h, driver, requestID)
	if result.Eligible || !hasReason(result, "NOT_STATIONARY") {
		t.Fatalf("an unproven dwell must refuse with NOT_STATIONARY: %+v", result)
	}
}

func TestEligibilityParkedCannotOverrideMotion(t *testing.T) {
	h := newHarness(t)
	view, _ := publishAt(t, h, h.Rider(), 0)
	driver := h.Driver()
	goOnline(t, h, driver)

	// A full history — but the samples say the vehicle is moving at 8 m/s.
	now := h.Clock.Now()
	pickup := testutil.PickupFixture()
	ingestPoints(t, h, driver, []map[string]any{
		point(1, pickup, now.Add(-90*time.Second), 8),
		point(2, pickup, now.Add(-45*time.Second), 8),
		point(3, pickup, now.Add(-1*time.Second), 8),
	})
	recorder := h.Do(http.MethodPost, "/mp/driver/parked", driver, nil)
	requireStatus(t, recorder, http.StatusOK)

	result := evaluate(t, h, driver, view["requestId"].(string))
	if result.Eligible || !hasReason(result, "NOT_STATIONARY") {
		t.Fatalf("a parked confirmation must not override moving telemetry: %+v", result)
	}
}

func TestEligibilityOutsideRadius(t *testing.T) {
	h := newHarness(t)
	view, _ := publishAt(t, h, h.Rider(), 0)
	driver := h.Driver()
	// Parked, but 5 km north of the pickup — outside the 3 km envelope.
	parkDriver(t, h, driver, testutil.PlaceAt(testutil.PickupFixture(), 5_000))

	result := evaluate(t, h, driver, view["requestId"].(string))
	if result.Eligible || !hasReason(result, "OUTSIDE_RADIUS") {
		t.Fatalf("a driver outside the envelope must refuse with OUTSIDE_RADIUS: %+v", result)
	}
}

func TestEligibilityPickupEtaTooLong(t *testing.T) {
	h := newHarness(t)
	view, _ := publishAt(t, h, h.Rider(), 0)
	requestID := view["requestId"].(string)
	driver := h.Driver()
	// Inside the radius (2 km) but the request's ETA budget is squeezed to
	// 60 seconds server-side, which no 2 km drive meets.
	parkDriver(t, h, driver, testutil.PlaceAt(testutil.PickupFixture(), 2_000))
	if _, err := h.Pool.Exec(context.Background(),
		`UPDATE mp.requests SET envelope_eta_sec = 60 WHERE id = $1`, requestID); err != nil {
		t.Fatal(err)
	}

	result := evaluate(t, h, driver, requestID)
	if result.Eligible || !hasReason(result, "PICKUP_ETA_TOO_LONG") {
		t.Fatalf("an over-budget pickup must refuse with PICKUP_ETA_TOO_LONG: %+v", result)
	}
}

func TestEligibilityWrongVehicleClass(t *testing.T) {
	h := newHarness(t)
	view, _ := publishAt(t, h, h.Rider(), 0) // vehicleClass "go"
	driver := h.Driver()
	recorder := h.Do(http.MethodPost, "/drivers/me/status", driver, map[string]any{
		"online":  true,
		"filters": map[string]any{"vehicleClasses": []string{"comfort"}},
	})
	requireStatus(t, recorder, http.StatusOK)
	now := h.Clock.Now()
	ingestPoints(t, h, driver, []map[string]any{
		point(1, testutil.PickupFixture(), now.Add(-90*time.Second), 0),
		point(2, testutil.PickupFixture(), now.Add(-1*time.Second), 0),
	})

	result := evaluate(t, h, driver, view["requestId"].(string))
	if result.Eligible || !hasReason(result, "UNSUPPORTED_CAPABILITY") {
		t.Fatalf("a class mismatch must refuse with UNSUPPORTED_CAPABILITY: %+v", result)
	}
}

// finishingTripFixture seeds a driver mid-trip: a real ride row heading north
// and a current claim pointing at it. Returns the claim id.
func finishingTripFixture(t *testing.T, h *testutil.Harness, driver testutil.Actor, driverAt domain.Place, tripPickup, tripDropoff domain.Place) uuid.UUID {
	t.Helper()
	ctx := context.Background()

	quoteID, rideID, claimID := uuid.New(), uuid.New(), uuid.New()
	riderID := uuid.New()
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO ride.quotes (id, city_id, config_version, rider_id, vehicle_class,
			pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
			distance_meters, duration_seconds, fare_minor, currency, breakdown, expires_at, consumed_by)
		VALUES ($1,$2,1,$3,'go',$4,$5,$6,$7,3000,300,50000,'NGN','{}'::jsonb, now() + interval '1 hour', $8)`,
		quoteID, h.CityID, riderID, tripPickup.Lat, tripPickup.Lng, tripDropoff.Lat, tripDropoff.Lng, rideID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO ride.rides (id, city_id, config_version, quote_id, rider_id, driver_id,
			state, vehicle_class, payment_method_id,
			pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
			quoted_fare_minor, currency, pin_hash)
		VALUES ($1,$2,1,$3,$4,$5,'in_progress','go','wallet',$6,$7,$8,$9,50000,'NGN','\x00')`,
		rideID, h.CityID, quoteID, riderID, driver.UserID,
		tripPickup.Lat, tripPickup.Lng, tripDropoff.Lat, tripDropoff.Lng); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO mp.driver_claims (id, driver_id, state, slot, service, execution_service, execution_id)
		VALUES ($1,$2,'current','current','ride','ride',$3)`,
		claimID, driver.UserID, rideID); err != nil {
		t.Fatal(err)
	}

	goOnline(t, h, driver)
	now := h.Clock.Now()
	ingestPoints(t, h, driver, []map[string]any{point(1, driverAt, now.Add(-time.Second), 12)})
	return claimID
}

func TestEligibilityQueueDisabled(t *testing.T) {
	h := newHarness(t) // marketplace_queued_jobs stays off
	view, _ := publishAt(t, h, h.Rider(), 0)
	driver := h.Driver()
	origin := testutil.PickupFixture()
	finishingTripFixture(t, h, driver, testutil.PlaceAt(origin, 2_500),
		origin, testutil.PlaceAt(origin, 3_000))

	result := evaluate(t, h, driver, view["requestId"].(string))
	if result.Eligible || !hasReason(result, "SLOT_FULL") || !hasReason(result, "QUEUE_DISABLED") {
		t.Fatalf("a busy driver without the queue flag must see SLOT_FULL + QUEUE_DISABLED: %+v", result)
	}
}

func TestEligibilityFinishingTrip(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	origin := testutil.PickupFixture()
	tripDropoff := testutil.PlaceAt(origin, 3_000)

	// The new request's pickup lies 1 km beyond the current dropoff, along
	// the same northbound corridor.
	newPickup := testutil.PlaceAt(origin, 4_000)
	view, _ := publishRoute(t, h, h.Rider(), newPickup, testutil.PlaceAt(origin, 9_000), 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	driver := h.Driver()
	claimID := finishingTripFixture(t, h, driver, testutil.PlaceAt(origin, 2_500), origin, tripDropoff)

	result := evaluate(t, h, driver, requestID)
	if !result.Eligible || result.Slot == nil || *result.Slot != "next" {
		t.Fatalf("a near-completion driver along the corridor must qualify for the next slot: %+v", result.Reasons)
	}
	if result.AvailabilityEpoch == 0 {
		t.Fatal("a driver with a claim must carry a non-zero availability epoch")
	}

	// The queued bid itself: slot=next with the current claim as dependency.
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	wrongDependency := h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId":         requestID,
		"requestRevision":   1,
		"amountMinor":       moneyBody(amount),
		"slot":              "next",
		"dependsOnClaimId":  uuid.NewString(),
		"availabilityEpoch": result.AvailabilityEpoch,
	}, move.IdempotencyHeader, idemKey())
	requireCode(t, wrongDependency, http.StatusConflict, domain.CodeQueueDependencyInvalid)

	queued := h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId":         requestID,
		"requestRevision":   1,
		"amountMinor":       moneyBody(amount),
		"slot":              "next",
		"dependsOnClaimId":  claimID.String(),
		"availabilityEpoch": result.AvailabilityEpoch,
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, queued, http.StatusCreated)
	queuedView := decode(t, queued)
	if queuedView["slot"] != "next" {
		t.Fatalf("slot: got %v, want next", queuedView["slot"])
	}
}

func TestEligibilityNotNearCompletion(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	origin := testutil.PickupFixture()
	view, _ := publishRoute(t, h, h.Rider(), testutil.PlaceAt(origin, 4_000), testutil.PlaceAt(origin, 9_000), 0)

	driver := h.Driver()
	// The driver is 13 km from the current dropoff: far too much service
	// time left for a queued bid.
	finishingTripFixture(t, h, driver, testutil.PlaceAt(origin, -10_000), origin, testutil.PlaceAt(origin, 3_000))

	result := evaluate(t, h, driver, view["requestId"].(string))
	if result.Eligible || !hasReason(result, "NOT_NEAR_COMPLETION") {
		t.Fatalf("a driver mid-trip must refuse with NOT_NEAR_COMPLETION: %+v", result)
	}
}

func TestEligibilityWrongDirection(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	origin := testutil.PickupFixture()
	// The new pickup is 1 km SOUTH of the northbound trip's dropoff: a 180°
	// turn against the corridor.
	view, _ := publishRoute(t, h, h.Rider(), testutil.PlaceAt(origin, 2_000), testutil.PlaceAt(origin, -3_000), 0)

	driver := h.Driver()
	finishingTripFixture(t, h, driver, testutil.PlaceAt(origin, 2_500), origin, testutil.PlaceAt(origin, 3_000))

	result := evaluate(t, h, driver, view["requestId"].(string))
	if result.Eligible || !hasReason(result, "WRONG_DIRECTION") {
		t.Fatalf("a pickup against the corridor must refuse with WRONG_DIRECTION: %+v", result)
	}
}

func TestEligibilitySlotFull(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	origin := testutil.PickupFixture()
	view, _ := publishRoute(t, h, h.Rider(), testutil.PlaceAt(origin, 4_000), testutil.PlaceAt(origin, 9_000), 0)

	driver := h.Driver()
	claimID := finishingTripFixture(t, h, driver, testutil.PlaceAt(origin, 2_500), origin, testutil.PlaceAt(origin, 3_000))
	// The next slot is already taken by a dependent claim.
	if _, err := h.Pool.Exec(context.Background(), `
		INSERT INTO mp.driver_claims (id, driver_id, state, slot, service, depends_on_claim_id)
		VALUES ($1,$2,'next','next','ride',$3)`,
		uuid.New(), driver.UserID, claimID); err != nil {
		t.Fatal(err)
	}

	result := evaluate(t, h, driver, view["requestId"].(string))
	if result.Eligible || !hasReason(result, "SLOT_FULL") {
		t.Fatalf("a driver with current+next claims must refuse with SLOT_FULL: %+v", result)
	}
}
