package marketplace_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// Round 6 follow-ups: the driver job card's request id, advance-booking
// outcomes phrased for the party reading them, and the receipt's routed
// distance after a committed amendment.

// TestDriverJobCarriesTheRequestID: the driver's jobs projection names the
// award's marketplace request, and that id is the one the trip routes take —
// the driver app opens the trip/amendment screens with it instead of guessing
// from bids. A trip the requester takes themselves carries no passenger block.
func TestDriverJobCarriesTheRequestID(t *testing.T) {
	h := newHarness(t)
	f := awardedTrip(t, h, nil)

	recorder := h.Do(http.MethodGet, "/mp/driver/jobs", f.driver, nil)
	requireStatus(t, recorder, http.StatusOK)
	current, ok := decode(t, recorder)["current"].(map[string]any)
	if !ok {
		t.Fatalf("the driver has a current job: %s", recorder.Body.String())
	}
	if current["requestId"] != f.requestID {
		t.Fatalf("the job names its request: got %v, want %s", current["requestId"], f.requestID)
	}
	if ref := current["executionRef"].(map[string]any); ref["service"] != "ride" || ref["id"] != f.rideID.String() {
		t.Fatalf("the execution reference is unchanged: %v", ref)
	}
	if _, present := current["passenger"]; present {
		t.Fatalf("a trip the requester takes carries no passenger block: %v", current)
	}
	// The id opens the request-scoped routes for the winning driver.
	award := h.Do(http.MethodGet, "/mp/requests/"+current["requestId"].(string)+"/award", f.driver, nil)
	requireStatus(t, award, http.StatusOK)
	if decode(t, award)["awardId"] != f.award.ID.String() {
		t.Fatalf("the request id resolves to this award: %s", award.Body.String())
	}
}

// TestAdvanceBookingFailureIsPhrasedForTheReader: a driver who withdraws is
// told "you withdrew" — never the rider's "your driver withdrew" — and is not
// offered the rider's rematch; the rider reads their own sentence and keeps
// the rematch. A rider's cancellation reads as the rider's to the driver. The
// financial outcome is the same record for both.
func TestAdvanceBookingFailureIsPhrasedForTheReader(t *testing.T) {
	h := schedulingHarness(t)
	f := bookAdvance(t, h, 8*time.Hour, "wallet")

	withdraw := h.Do(http.MethodPost, f.bookingPath("/withdraw"), f.driver,
		map[string]any{"reason": "vehicle in the workshop"}, move.IdempotencyHeader, idemKey())
	requireStatus(t, withdraw, http.StatusOK)
	driverFailure := decode(t, withdraw)["failure"].(map[string]any)
	driverMessage := driverFailure["message"].(string)
	if !strings.HasPrefix(driverMessage, "You withdrew from this booking") || strings.Contains(driverMessage, "Your driver") ||
		!strings.Contains(driverMessage, "10% commission was returned") {
		t.Fatalf("the driver reads their own outcome: %q", driverMessage)
	}
	if driverFailure["rematchAvailable"] != false {
		t.Fatalf("the rematch is the rider's option, never the driver's: %v", driverFailure)
	}

	driverView := h.Do(http.MethodGet, f.bookingPath(""), f.driver, nil)
	requireStatus(t, driverView, http.StatusOK)
	if got := decode(t, driverView)["failure"].(map[string]any)["message"]; got != driverMessage {
		t.Fatalf("the driver's read is phrased the same way: %v", got)
	}

	riderView := h.Do(http.MethodGet, f.bookingPath(""), f.rider, nil)
	requireStatus(t, riderView, http.StatusOK)
	riderFailure := decode(t, riderView)["failure"].(map[string]any)
	riderMessage := riderFailure["message"].(string)
	if !strings.HasPrefix(riderMessage, "Your driver withdrew") || riderFailure["rematchAvailable"] != true {
		t.Fatalf("the rider reads the rider's sentence and keeps the rematch: %v", riderFailure)
	}
	for _, failure := range []map[string]any{driverFailure, riderFailure} {
		outcome := failure["financialOutcome"].(map[string]any)
		if outcome["commissionReversed"] != true || outcome["riderCharged"] != false || failure["reason"] != marketplace.BookingFailDriverWithdrew {
			t.Fatalf("one financial record for both readers: %v", failure)
		}
	}

	// A rider's cancellation, read by the driver.
	g := bookAdvance(t, h, 9*time.Hour, "wallet")
	requireStatus(t, h.Do(http.MethodPost, g.bookingPath("/cancel"), g.rider, nil, move.IdempotencyHeader, idemKey()), http.StatusOK)
	cancelled := h.Do(http.MethodGet, g.bookingPath(""), g.driver, nil)
	requireStatus(t, cancelled, http.StatusOK)
	message := decode(t, cancelled)["failure"].(map[string]any)["message"].(string)
	if !strings.HasPrefix(message, "The rider cancelled this booking.") || strings.Contains(message, "You cancelled") {
		t.Fatalf("the driver reads the rider's cancellation as the rider's: %q", message)
	}
}

// TestReceiptDistanceIsTheCommittedRoute: a trip that committed a route
// amendment (a second stop) states the COMMITTED route's routed distance on
// its receipt — the distance the amended fare was priced on — while its money
// lines reconcile exactly as before. A plain trip states the award's routed
// distance.
func TestReceiptDistanceIsTheCommittedRoute(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	awardedDistance := requestRow(t, h, f.requestID).RoutedDistanceM
	if awardedDistance <= 0 {
		t.Fatalf("fixture: the request is routed: %d", awardedDistance)
	}
	f.start(t)

	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	increase := decode(t, recorder)
	added := asInt64(t, increase, "addedDistanceMeters")
	if added <= 0 {
		t.Fatalf("fixture: the second stop lengthens the route: %v", increase)
	}
	requireStatus(t, f.decide(f.rider, increase, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)
	requireStatus(t, f.decide(f.driver, increase, "approve", ""), http.StatusOK)

	var stored *int64
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT routed_distance_m FROM mp.execution_routes WHERE award_id = $1`, f.award.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == nil || *stored != awardedDistance+added {
		t.Fatalf("the committed route carries the amended distance: got %v, want %d", stored, awardedDistance+added)
	}
	f.complete(t)

	rider := receiptOf(t, h, f.rider, f.requestID)
	trip := rider["trip"].(map[string]any)
	if got := asInt64(t, trip, "routedDistanceMeters"); got != awardedDistance+added {
		t.Fatalf("the receipt states the committed route's distance: got %d, want %d (awarded %d)", got, awardedDistance+added, awardedDistance)
	}
	settled := h.Settlement.Requests[f.award.ID]
	total := moneyMinor(t, rider, "totalMinor")
	if total != settled.FareMinor.AmountMinor || total <= f.amount {
		t.Fatalf("the money still reconciles with the settlement: total %d, settled %d", total, settled.FareMinor.AmountMinor)
	}
	driver := receiptOf(t, h, f.driver, f.requestID)
	if asInt64(t, driver["trip"].(map[string]any), "routedDistanceMeters") != awardedDistance+added {
		t.Fatalf("both parties read the same trip facts: %v", driver["trip"])
	}

	// A plain trip: no execution-route row, the award's routed distance.
	g := awardedTrip(t, h, nil)
	g.start(t)
	g.complete(t)
	plain := receiptOf(t, h, g.rider, g.requestID)
	if got, want := asInt64(t, plain["trip"].(map[string]any), "routedDistanceMeters"), requestRow(t, h, g.requestID).RoutedDistanceM; got != want || got <= 0 {
		t.Fatalf("a plain trip states the award's routed distance: got %d, want %d", got, want)
	}
}
