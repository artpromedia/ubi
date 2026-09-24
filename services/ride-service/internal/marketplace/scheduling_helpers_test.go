package marketplace_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// schedulingHarness is the marketplace harness with the Book for Later
// flags opened (each one deny-by-default otherwise).
func schedulingHarness(t *testing.T, opts ...testutil.HarnessOption) *testutil.Harness {
	t.Helper()
	all := append([]testutil.HarnessOption{
		testutil.WithFlag(cityconfig.FlagScheduledRides, true),
		testutil.WithFlag(cityconfig.FlagMarketplaceAdvanceReservations, true),
		testutil.WithFlag(cityconfig.FlagMarketplaceRecurringJourneys, true),
	}, opts...)
	return newHarness(t, all...)
}

// lagos is the harness city's zone (the fixture's timezone, no DST).
var lagos = func() *time.Location {
	location, err := time.LoadLocation("Africa/Lagos")
	if err != nil {
		panic(err)
	}
	return location
}()

// scheduleAt is the schedule body for an instant, as a local date/time in
// the given zone (minute precision).
func scheduleAt(at time.Time, zone *time.Location) map[string]any {
	local := at.In(zone)
	return map[string]any{
		"localDate": local.Format("2006-01-02"),
		"localTime": local.Format("15:04"),
		"timeZone":  zone.String(),
	}
}

// pickupIn is a minute-aligned pickup instant `ahead` from the harness clock.
func pickupIn(h *testutil.Harness, ahead time.Duration) time.Time {
	return h.Clock.Now().Add(ahead).Truncate(time.Minute).Add(time.Minute)
}

// freshQuote prices the standard fixture route for a rider.
func freshQuote(t *testing.T, h *testutil.Harness, rider testutil.Actor) map[string]any {
	t.Helper()
	return quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture())
}

// postScheduled creates a scheduled request and returns the recorder.
func postScheduled(t *testing.T, h *testutil.Harness, rider testutil.Actor, quote map[string]any, schedule map[string]any, requested, maxFare int64, payment, key string) *httptest.ResponseRecorder {
	t.Helper()
	if key == "" {
		key = idemKey()
	}
	return h.Do(http.MethodPost, "/mp/scheduled-requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(requested),
		"maxFareMinor":       moneyBody(maxFare),
		"paymentMethodId":    payment,
		"schedule":           schedule,
	}, move.IdempotencyHeader, key)
}

// createScheduled creates a scheduled request for the fixture route at the
// quote's minimum, approving up to maxFare (0: twice the minimum).
func createScheduled(t *testing.T, h *testutil.Harness, rider testutil.Actor, pickupAt time.Time, maxFare int64) (map[string]any, map[string]any) {
	t.Helper()
	quote := freshQuote(t, h, rider)
	minimum := moneyMinor(t, quote, "minimumFareMinor")
	if maxFare == 0 {
		maxFare = minimum * 2
	}
	recorder := postScheduled(t, h, rider, quote, scheduleAt(pickupAt, lagos), minimum, maxFare, "wallet", "")
	requireStatus(t, recorder, http.StatusCreated)
	return decode(t, recorder), quote
}

// sweepOnce runs one marketplace sweep.
func sweepOnce(t *testing.T, h *testutil.Harness) {
	t.Helper()
	if err := h.Marketplace.Sweep(context.Background()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
}

// scheduledRow reads one stored intent.
func scheduledRow(t *testing.T, h *testutil.Harness, id string) *marketplace.ScheduledRequest {
	t.Helper()
	sr, err := h.Marketplace.Store().ScheduledRequestByID(context.Background(), h.Pool, uuid.MustParse(id))
	if err != nil {
		t.Fatalf("read scheduled request %s: %v", id, err)
	}
	return sr
}

// countRows counts rows for a query with one argument.
func countRows(t *testing.T, h *testutil.Harness, query string, args ...any) int {
	t.Helper()
	var n int
	if err := h.Pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatalf("count (%s): %v", query, err)
	}
	return n
}

// driverHasNoClaims asserts a driver holds nothing in the live slots.
func driverHasNoClaims(t *testing.T, h *testutil.Harness, driverID uuid.UUID) {
	t.Helper()
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.driver_claims WHERE driver_id = $1`, driverID); n != 0 {
		t.Fatalf("the driver holds %d live claims; a future booking must not occupy today's slots", n)
	}
}

// createAdvance publishes an advance-booking request for the fixture route
// at the quote's minimum and returns the request view.
func createAdvance(t *testing.T, h *testutil.Harness, rider testutil.Actor, pickupAt time.Time, payment string) map[string]any {
	t.Helper()
	quote := freshQuote(t, h, rider)
	recorder := h.Do(http.MethodPost, "/mp/advance-requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "minimumFareMinor")),
		"paymentMethodId":    payment,
		"schedule":           scheduleAt(pickupAt, lagos),
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, recorder, http.StatusCreated)
	return decode(t, recorder)
}

// advanceBid posts an advance-slot bid for the request's current revision.
func advanceBid(t *testing.T, h *testutil.Harness, driver testutil.Actor, requestID string, amount int64) *httptest.ResponseRecorder {
	t.Helper()
	return h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId":         requestID,
		"requestRevision":   1,
		"amountMinor":       moneyBody(amount),
		"slot":              "advance",
		"availabilityEpoch": epochOf(t, h, driver),
	}, move.IdempotencyHeader, idemKey())
}

// epochOf reads a driver's current availability epoch.
func epochOf(t *testing.T, h *testutil.Harness, driver testutil.Actor) int64 {
	t.Helper()
	epoch, err := h.Marketplace.Store().AvailabilityEpoch(context.Background(), h.Pool, driver.UserID)
	if err != nil {
		t.Fatal(err)
	}
	return epoch
}

// advanceFixture is one advance booking made through the real API: an
// advance request, a parked driver's funded advance bid and the rider's
// selection.
type advanceFixture struct {
	h             *testutil.Harness
	rider, driver testutil.Actor
	requestID     string
	bidID         string
	reservationID string
	amount        int64
	award         *marketplace.Award
	booking       *marketplace.AdvanceBooking
	pickupAt      time.Time
	selected      map[string]any
}

// bookAdvance runs the whole advance flow for a pickup `ahead` from now.
func bookAdvance(t *testing.T, h *testutil.Harness, ahead time.Duration, payment string) *advanceFixture {
	t.Helper()
	f := &advanceFixture{h: h, rider: h.Rider(), driver: h.Driver(), pickupAt: pickupIn(h, ahead)}
	view := createAdvance(t, h, f.rider, f.pickupAt, payment)
	f.requestID = view["requestId"].(string)
	f.amount = moneyMinor(t, view, "requestedFareMinor")
	parkDriver(t, h, f.driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(f.driver.UserID, 1_000_000)
	bid := advanceBid(t, h, f.driver, f.requestID, f.amount)
	requireStatus(t, bid, http.StatusCreated)
	bidView := decode(t, bid)
	f.bidID = bidView["bidId"].(string)
	f.reservationID = bidView["reservationId"].(string)
	selected := doSelect(t, h, f.rider, f.requestID, map[string]any{
		"bidId": f.bidID, "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	f.selected = decode(t, selected)
	f.award = awardRow(t, h, f.requestID)
	f.booking = bookingOfAward(t, h, f.award.ID)
	return f
}

// bookingOfAward reads the booking an advance award created.
func bookingOfAward(t *testing.T, h *testutil.Harness, awardID uuid.UUID) *marketplace.AdvanceBooking {
	t.Helper()
	b, err := h.Marketplace.Store().BookingByAwardID(context.Background(), h.Pool, awardID)
	if err != nil {
		t.Fatalf("read booking of award %s: %v", awardID, err)
	}
	return b
}

// reload re-reads the fixture's booking.
func (f *advanceFixture) reload(t *testing.T) *marketplace.AdvanceBooking {
	t.Helper()
	b, err := f.h.Marketplace.Store().BookingByID(context.Background(), f.h.Pool, f.booking.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.booking = b
	return b
}

// bookingPath is the booking's API path.
func (f *advanceFixture) bookingPath(suffix string) string {
	return "/mp/advance-bookings/" + f.booking.ID.String() + suffix
}

// reconfirm reconfirms as the driver once the window is open.
func (f *advanceFixture) reconfirm(t *testing.T) {
	t.Helper()
	f.h.Clock.Set(f.booking.ReconfirmOpensAt.Add(time.Minute))
	recorder := f.h.Do(http.MethodPost, f.bookingPath("/reconfirm"), f.driver, nil, move.IdempotencyHeader, idemKey())
	requireStatus(t, recorder, http.StatusOK)
	if b := f.reload(t); b.State != machine.MpBookingReconfirmed {
		t.Fatalf("booking after reconfirmation: %s", b.State)
	}
}

// suspend puts a driver under an approved (maker-checker) suspension.
func suspend(t *testing.T, h *testutil.Harness, driver testutil.Actor) {
	t.Helper()
	proposer, approver := adminActor(h), adminActor(h)
	propose := h.Do(http.MethodPost, "/admin/mp/drivers/"+driver.UserID.String()+"/standing-actions", proposer,
		map[string]any{"actionType": "suspension", "reasonCode": "safety_complaint", "reasonNote": "under review", "cityId": h.CityID},
		move.IdempotencyHeader, idemKey())
	requireStatus(t, propose, http.StatusCreated)
	var action marketplace.StandingActionView
	h.DecodeBody(propose, &action)
	approve := h.Do(http.MethodPost, "/admin/mp/standing-actions/"+action.ID+"/decide", approver,
		map[string]any{"approve": true, "reason": "confirmed"}, move.IdempotencyHeader, idemKey())
	requireStatus(t, approve, http.StatusOK)
}
