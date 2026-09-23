package marketplace_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// tripStop reads one stop out of a decoded trip view.
func tripStop(t *testing.T, trip map[string]any, stopID string) map[string]any {
	t.Helper()
	for _, raw := range trip["stops"].([]any) {
		stop := raw.(map[string]any)
		if stop["stopId"] == stopID {
			return stop
		}
	}
	t.Fatalf("stop %s is not in the trip view: %v", stopID, trip["stops"])
	return nil
}

// stopWaitingView reads a stop's waiting block.
func stopWaitingView(t *testing.T, stop map[string]any) map[string]any {
	t.Helper()
	waiting, ok := stop["waiting"].(map[string]any)
	if !ok {
		t.Fatalf("the stop carries no waiting block: %v", stop)
	}
	return waiting
}

// eventCount counts outbox rows of one name on an award.
func eventCount(t *testing.T, h *testutil.Harness, name string, awardID string) int {
	t.Helper()
	return outboxCount(t, h, name, awardID)
}

// waitingAmendment finds the committed stop-waiting adjustment of a trip.
func waitingAmendments(t *testing.T, f *tripFixture) []*marketplace.Amendment {
	t.Helper()
	all, err := f.h.Marketplace.Store().AmendmentsForAward(context.Background(), f.h.Pool, f.award.ID)
	if err != nil {
		t.Fatal(err)
	}
	var waiting []*marketplace.Amendment
	for _, amendment := range all {
		if amendment.Kind == marketplace.AmendmentKindStopWaiting {
			waiting = append(waiting, amendment)
		}
	}
	return waiting
}

// assertMoneyReconciles: the committed fare, the captured commission and
// the rider's funding agree — commission captured == commission(final fare).
func assertMoneyReconciles(t *testing.T, f *tripFixture, wantFare int64) {
	t.Helper()
	route := f.executionRoute(t)
	if route.AgreedFareMinor != wantFare {
		t.Fatalf("agreed fare: %d, want %d", route.AgreedFareMinor, wantFare)
	}
	if route.CapturedCommissionMinor != marketplace.CommissionMinor(wantFare) ||
		f.h.Wallet.CapturedTotal(f.reservation) != marketplace.CommissionMinor(wantFare) {
		t.Fatalf("captured commission: route %d, wallet %d, want commission(%d) = %d",
			route.CapturedCommissionMinor, f.h.Wallet.CapturedTotal(f.reservation), wantFare, marketplace.CommissionMinor(wantFare))
	}
	if f.h.Funding.FundedAmount(f.award.ID) != wantFare {
		t.Fatalf("rider funding: %d, want %d", f.h.Funding.FundedAmount(f.award.ID), wantFare)
	}
	if f.h.Wallet.CapturesByReservation[f.reservation] != 1 {
		t.Fatal("the award's commission hold is captured exactly once")
	}
}

// TestStopArrivalGeofencedWithDisputedPath: arrival is decided by the
// server against the driver's last accepted position and the geofence (with
// GPS accuracy as tolerance). A driver outside it may record a DISPUTED
// arrival, which never starts paid waiting; a later arrival from inside the
// fence confirms it and starts the clock then.
func TestStopArrivalGeofencedWithDisputedPath(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	stopID := f.stops[0]["stopId"].(string)
	_, _, firstPlace, _ := stopFixtures()

	requireCode(t, f.stopPost(f.driver, stopID, "arrive", map[string]any{}, ""), http.StatusConflict, domain.CodeIllegalTransition)
	f.start(t)
	requireCode(t, f.stopPost(f.rider, stopID, "arrive", map[string]any{}, ""), http.StatusForbidden, domain.CodeForbidden)

	far := f.stopPost(f.driver, stopID, "arrive", map[string]any{}, "")
	requireCode(t, far, http.StatusUnprocessableEntity, domain.CodeNotAtPickup)
	details := decode(t, far)["details"].(map[string]any)
	if details["reason"] != "not_at_stop" || details["distanceMeters"].(float64) < 1_000 || details["geofenceMeters"].(float64) != 150 {
		t.Fatalf("the refusal must carry the server's evidence: %v", details)
	}

	disputed := f.stopPost(f.driver, stopID, "arrive", map[string]any{"disputed": true}, "")
	requireStatus(t, disputed, http.StatusOK)
	stop := tripStop(t, decode(t, disputed), stopID)
	if stop["state"] != marketplace.StopStateArrived || stop["arrivalDisputed"] != true {
		t.Fatalf("a disputed arrival is recorded as disputed: %v", stop)
	}
	if eventCount(t, h, "mp.stop.arrival_disputed", f.award.ID.String()) != 1 ||
		eventCount(t, h, "mp.stop.waiting_started", f.award.ID.String()) != 0 {
		t.Fatal("a disputed arrival publishes the dispute and never starts waiting")
	}
	h.Clock.Advance(15 * time.Minute)
	waiting := stopWaitingView(t, tripStop(t, f.trip(t, f.rider), stopID))
	if waiting["waitedSec"].(float64) != 0 || moneyMinor(t, waiting, "feeMinor") != 0 {
		t.Fatalf("no paid waiting accrues on a disputed arrival: %v", waiting)
	}

	// The driver reaches the fence: the arrival is confirmed, waiting starts.
	f.moveTo(t, testutil.PlaceEast(firstPlace, 40), time.Minute)
	confirmedAt := h.Clock.Now()
	confirmed := f.stopPost(f.driver, stopID, "arrive", map[string]any{}, "")
	requireStatus(t, confirmed, http.StatusOK)
	stop = tripStop(t, decode(t, confirmed), stopID)
	if stop["arrivalDisputed"] != false || eventCount(t, h, "mp.stop.waiting_started", f.award.ID.String()) != 1 {
		t.Fatalf("a confirmed arrival clears the dispute and starts waiting: %v", stop)
	}
	h.Clock.Advance(60 * time.Second)
	waiting = stopWaitingView(t, tripStop(t, f.trip(t, f.driver), stopID))
	if waiting["waitedSec"].(float64) != 60 || waiting["allowanceRemainingSec"].(float64) != 60 {
		t.Fatalf("waiting runs from the confirmed arrival (%s): %v", confirmedAt, waiting)
	}
	departed := f.stopPost(f.driver, stopID, "depart", nil, "")
	requireStatus(t, departed, http.StatusOK)
	stop = tripStop(t, decode(t, departed), stopID)
	if stop["state"] != marketplace.StopStateDeparted || moneyMinor(t, stopWaitingView(t, stop), "feeMinor") != 0 {
		t.Fatalf("a departure inside the allowance costs nothing: %v", stop)
	}
	if len(waitingAmendments(t, f)) != 0 {
		t.Fatal("no waiting adjustment for waiting inside the allowance")
	}
}

// TestStopWaitingTimerReplay: paid waiting is computed from server
// timestamps. Sweeps, a restarted process and replayed departures all land
// on the SAME milestones (once each, stamped when they happened) and the
// SAME fee — which settles once, through the linked-adjustment path.
func TestStopWaitingTimerReplay(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	stopID := f.stops[0]["stopId"].(string)
	_, _, firstPlace, _ := stopFixtures()
	f.start(t)
	f.moveTo(t, firstPlace, 5*time.Minute)
	requireStatus(t, f.stopPost(f.driver, stopID, "arrive", map[string]any{}, ""), http.StatusOK)
	arrivedAt := h.Clock.Now()

	h.Clock.Advance(270 * time.Second) // 120s included + 150s paid → 3 started minutes
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		if err := h.Marketplace.Sweep(ctx); err != nil {
			t.Fatal(err)
		}
	}
	restarted := restartedService(t, h)
	if err := restarted.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	award := f.award.ID.String()
	for _, name := range []string{"mp.stop.waiting_started", "mp.stop.allowance_consumed", "mp.stop.paid_waiting_accruing"} {
		if got := eventCount(t, h, name, award); got != 1 {
			t.Fatalf("%s must be published exactly once across sweeps and a restart: %d", name, got)
		}
	}
	var consumedAt time.Time
	if err := h.Pool.QueryRow(ctx, `
		SELECT occurred_at FROM public.outbox_events WHERE name = 'mp.stop.allowance_consumed' AND aggregate_id = $1`,
		award).Scan(&consumedAt); err != nil {
		t.Fatal(err)
	}
	if !consumedAt.Equal(arrivedAt.Add(120 * time.Second)) {
		t.Fatalf("a milestone is stamped when it happened (%s), not when it was noticed: %s", arrivedAt.Add(120*time.Second), consumedAt)
	}

	// The restarted process computes the same waiting from the same rows.
	view, err := restarted.TripView(ctx, moveActor(f.driver), f.award.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Stops[0].Waiting == nil || view.Stops[0].Waiting.FeeMinor.AmountMinor != 3_000 || !view.Stops[0].Waiting.Accruing {
		t.Fatalf("waiting after a restart: %+v", view.Stops[0].Waiting)
	}

	departKey := idemKey()
	if _, err := restarted.DepartStop(ctx, moveActor(f.driver), f.award.RequestID, uuid.MustParse(view.Stops[0].StopID), departKey); err != nil {
		t.Fatal(err)
	}
	requireStatus(t, f.stopPost(f.driver, stopID, "depart", nil, departKey), http.StatusOK)
	requireStatus(t, f.stopPost(f.driver, stopID, "depart", nil, ""), http.StatusOK)
	h.Clock.Advance(10 * time.Minute)
	_ = h.Marketplace.Sweep(ctx)

	waiting := waitingAmendments(t, f)
	if len(waiting) != 1 || waiting[0].State != machine.MpAmendmentCommitted || waiting[0].RevisedFareMinor-waiting[0].PriorFareMinor != 3_000 {
		t.Fatalf("exactly one committed waiting adjustment of 30.00: %+v", waiting)
	}
	if h.Wallet.DeltaCapturesByAmendment[waiting[0].ID.String()] != 1 {
		t.Fatal("the waiting fee's commission increment is captured once")
	}
	stop := tripStop(t, f.trip(t, f.rider), stopID)
	if moneyMinor(t, stopWaitingView(t, stop), "feeMinor") != 3_000 || stopWaitingView(t, stop)["settlement"] != "committed" {
		t.Fatalf("the waiting stops at departure and settles once: %v", stop)
	}
	assertMoneyReconciles(t, f, f.amount+3_000)
}

// TestPaidWaitingCapNeedsRiderApproval: paid waiting accrues only up to the
// agreed maximum; beyond it the rider must approve (once per cap revision)
// before another minor unit accrues.
func TestPaidWaitingCapNeedsRiderApproval(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	stopID := f.stops[0]["stopId"].(string)
	_, _, firstPlace, _ := stopFixtures()
	f.start(t)
	f.moveTo(t, firstPlace, 5*time.Minute)
	requireStatus(t, f.stopPost(f.driver, stopID, "arrive", map[string]any{}, ""), http.StatusOK)

	h.Clock.Advance(520 * time.Second) // 400s paid → 7 started minutes = 70.00 > the 50.00 cap
	waiting := stopWaitingView(t, tripStop(t, f.trip(t, f.rider), stopID))
	if waiting["approvalRequired"] != true || waiting["accruing"] != false || moneyMinor(t, waiting, "feeMinor") != 5_000 {
		t.Fatalf("waiting must stop at the cap and ask the rider: %v", waiting)
	}
	_ = h.Marketplace.Sweep(context.Background())
	_ = h.Marketplace.Sweep(context.Background())
	if eventCount(t, h, "mp.stop.waiting_approval_required", f.award.ID.String()) != 1 {
		t.Fatal("the approval request is published once per cap")
	}

	requireCode(t, f.stopPost(f.driver, stopID, "waiting-approval", map[string]any{"capRevision": 1}, ""),
		http.StatusForbidden, domain.CodeForbidden)
	requireCode(t, f.stopPost(f.rider, stopID, "waiting-approval", map[string]any{"capRevision": 2}, ""),
		http.StatusConflict, domain.CodeVersionConflict)
	key := idemKey()
	approved := f.stopPost(f.rider, stopID, "waiting-approval", map[string]any{"capRevision": 1}, key)
	requireStatus(t, approved, http.StatusOK)
	requireStatus(t, f.stopPost(f.rider, stopID, "waiting-approval", map[string]any{"capRevision": 1}, key), http.StatusOK)
	trip := f.trip(t, f.rider)
	terms := trip["waitingTerms"].(map[string]any)
	if moneyMinor(t, terms, "authorizedCapMinor") != 10_000 || terms["capRevision"].(float64) != 2 {
		t.Fatalf("one approval raises the cap once: %v", terms)
	}
	waiting = stopWaitingView(t, tripStop(t, trip, stopID))
	if waiting["approvalRequired"] != false || moneyMinor(t, waiting, "feeMinor") != 7_000 {
		t.Fatalf("after approval the waiting resumes accruing: %v", waiting)
	}
	requireStatus(t, f.stopPost(f.driver, stopID, "depart", nil, ""), http.StatusOK)
	assertMoneyReconciles(t, f, f.amount+7_000)
}

// TestDriverSkipsOnlyAfterExcessiveWaiting: the rider may drop a stop; the
// driver may leave one only once its waiting is excessive — and waiting
// earned until then settles, capped at what the rider authorized.
func TestDriverSkipsOnlyAfterExcessiveWaiting(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput(), secondStopInput()})
	first, second := f.stops[0]["stopId"].(string), f.stops[1]["stopId"].(string)
	_, _, firstPlace, _ := stopFixtures()
	f.start(t)
	f.moveTo(t, firstPlace, 5*time.Minute)
	requireStatus(t, f.stopPost(f.driver, first, "arrive", map[string]any{}, ""), http.StatusOK)
	// Even a disputed arrival cannot jump ahead of the stop being waited at.
	requireCode(t, f.stopPost(f.driver, second, "arrive", map[string]any{"disputed": true}, ""), http.StatusConflict, domain.CodeConflict)

	early := f.stopPost(f.driver, first, "skip", map[string]any{}, "")
	requireCode(t, early, http.StatusConflict, domain.CodeConflict)
	if reason := decode(t, early)["details"].(map[string]any)["reason"]; reason != "waiting_not_excessive" {
		t.Fatalf("the driver's early skip must say why it is refused: %v", reason)
	}
	riderSkip := f.stopPost(f.rider, second, "skip", map[string]any{"reason": "no longer needed"}, "")
	requireStatus(t, riderSkip, http.StatusOK)
	if stop := tripStop(t, decode(t, riderSkip), second); stop["state"] != marketplace.StopStateSkipped || stop["skipReason"] != "no longer needed" {
		t.Fatalf("the rider may drop a stop: %v", stop)
	}

	h.Clock.Advance(901 * time.Second)
	skipped := f.stopPost(f.driver, first, "skip", map[string]any{}, "")
	requireStatus(t, skipped, http.StatusOK)
	stop := tripStop(t, decode(t, skipped), first)
	if stop["state"] != marketplace.StopStateSkipped || stop["skipReason"] != "excessive_waiting" {
		t.Fatalf("after excessive waiting the driver may leave: %v", stop)
	}
	if eventCount(t, h, "mp.stop.excessive_waiting", f.award.ID.String()) != 1 {
		t.Fatal("excessive waiting is published once")
	}
	if moneyMinor(t, stopWaitingView(t, stop), "feeMinor") != 5_000 {
		t.Fatalf("the earned waiting settles capped at the authorized maximum: %v", stop)
	}
	assertMoneyReconciles(t, f, f.amount+5_000)
}

// TestEarlyTerminationPartialJourney: a safe early end — refused while the
// driver is moving, then taken parked with a safety reason — skips the stops
// never reached, moves the dropoff to where the vehicle is, and lowers the
// fare by the unvisited remainder (held at the travelled route's server
// floor), settled as ONE linked decrease: a partial commission refund and a
// partial funding release. Completion then settles exactly that fare.
func TestEarlyTerminationPartialJourney(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput(), secondStopInput()})
	first, second := f.stops[0]["stopId"].(string), f.stops[1]["stopId"].(string)
	_, _, firstPlace, secondPlace := stopFixtures()
	f.start(t)
	f.moveTo(t, firstPlace, 5*time.Minute)
	requireStatus(t, f.stopPost(f.driver, first, "arrive", map[string]any{}, ""), http.StatusOK)
	h.Clock.Advance(60 * time.Second)
	requireStatus(t, f.stopPost(f.driver, first, "depart", nil, ""), http.StatusOK)

	midway := domain.Place{Lat: (firstPlace.Lat + secondPlace.Lat) / 2, Lng: (firstPlace.Lng + secondPlace.Lng) / 2}
	f.moveTo(t, midway, 4*time.Minute)
	f.drive(t, midway)
	requireCode(t, h.Do(http.MethodPost, f.path("/terminate"), f.driver,
		map[string]any{"reason": "safety_concern", "expectedFareRevision": 1}, move.IdempotencyHeader, idemKey()),
		http.StatusForbidden, domain.CodeDriverIneligible)
	requireCode(t, h.Do(http.MethodPost, f.path("/terminate"), f.driver,
		map[string]any{"expectedFareRevision": 1}, move.IdempotencyHeader, idemKey()),
		http.StatusUnprocessableEntity, domain.CodeReasonCodeRequired)

	f.park(t, midway, time.Minute)
	key := idemKey()
	body := map[string]any{"reason": "safety_concern", "expectedFareRevision": 1}
	ended := h.Do(http.MethodPost, f.path("/terminate"), f.driver, body, move.IdempotencyHeader, key)
	requireStatus(t, ended, http.StatusOK)
	trip := decode(t, ended)
	if trip["terminatedAt"] == nil || tripStop(t, trip, second)["state"] != marketplace.StopStateSkipped ||
		tripStop(t, trip, second)["skipReason"] != "trip_terminated" {
		t.Fatalf("an early end skips the stops never reached: %v", trip)
	}
	route := f.executionRoute(t)
	if route.AgreedFareMinor >= f.amount {
		t.Fatalf("an early end lowers the fare: %d vs %d", route.AgreedFareMinor, f.amount)
	}
	_, _, dropoffLat, _ := f.rideTerms(t)
	if dropoffLat != midway.Lat || route.Dropoff.Lat != midway.Lat {
		t.Fatalf("the journey now ends where the vehicle stopped: ride %f, route %f, want %f", dropoffLat, route.Dropoff.Lat, midway.Lat)
	}
	var terminations []*marketplace.Amendment
	all, _ := h.Marketplace.Store().AmendmentsForAward(context.Background(), h.Pool, f.award.ID)
	for _, amendment := range all {
		if amendment.Kind == marketplace.AmendmentKindEarlyTermination {
			terminations = append(terminations, amendment)
		}
	}
	if len(terminations) != 1 || terminations[0].State != machine.MpAmendmentCommitted {
		t.Fatalf("one committed early_termination adjustment: %+v", terminations)
	}
	id := terminations[0].ID.String()
	if h.Wallet.DeltaRefundsByAmendment[id] != 1 || h.Funding.EffectivePartialReleases != 1 {
		t.Fatal("the decrease settles as a linked partial refund and partial release")
	}
	if eventCount(t, h, "mp.trip.terminated_early", f.award.ID.String()) != 1 {
		t.Fatal("the early end is published once")
	}
	// A replay answers the same outcome; a second termination is refused.
	requireStatus(t, h.Do(http.MethodPost, f.path("/terminate"), f.driver, body, move.IdempotencyHeader, key), http.StatusOK)
	requireCode(t, h.Do(http.MethodPost, f.path("/terminate"), f.rider,
		map[string]any{"expectedFareRevision": 2}, move.IdempotencyHeader, idemKey()), http.StatusConflict, domain.CodeConflict)

	final := route.AgreedFareMinor
	assertMoneyReconciles(t, f, final)
	f.complete(t)
	settled, ok := h.Settlement.Requests[f.award.ID]
	if !ok || settled.FareMinor.AmountMinor != final {
		t.Fatalf("completion settles the terminated fare %d: %+v", final, settled)
	}
}

// TestReceiptReconcilesAcrossSequentialAmendments: an increase, a paid stop
// wait and a decrease commit; a rejected and an expired proposal do not. At
// completion the settled fare is exactly the original fare plus the committed
// adjustments, the captured commission is exactly commission(final fare) —
// captured once, moved only by linked deltas — and the rider's funding covers
// exactly the final fare.
func TestReceiptReconcilesAcrossSequentialAmendments(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	first := f.stops[0]["stopId"].(string)
	_, _, firstPlace, _ := stopFixtures()
	f.start(t)

	// 1. Increase: add a second stop.
	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	increase := decode(t, recorder)
	requireStatus(t, f.decide(f.rider, increase, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)
	requireStatus(t, f.decide(f.driver, increase, "approve", ""), http.StatusOK)

	// 2. Paid waiting at the first stop: 3 started minutes.
	f.moveTo(t, firstPlace, 5*time.Minute)
	requireStatus(t, f.stopPost(f.driver, first, "arrive", map[string]any{}, ""), http.StatusOK)
	h.Clock.Advance(270 * time.Second)
	requireStatus(t, f.stopPost(f.driver, first, "depart", nil, ""), http.StatusOK)

	// 3. Decrease: drop the added stop again (the first is history now).
	recorder = f.propose(f.rider, proposal(nil, 2, 3), "")
	requireStatus(t, recorder, http.StatusCreated)
	decrease := decode(t, recorder)
	if moneyMinor(t, decrease, "fareDeltaMinor") >= 0 || decrease["riderFunding"] != "release_on_commit" {
		t.Fatalf("dropping a stop lowers the fare and reserves nothing: %v", decrease)
	}
	requireStatus(t, f.decide(f.rider, decrease, "approve", ""), http.StatusOK)
	f.park(t, firstPlace, 30*time.Second)
	requireStatus(t, f.decide(f.driver, decrease, "approve", ""), http.StatusOK)

	// 4. A rejected proposal and 5. an expired one change nothing.
	recorder = f.propose(f.rider, proposal([]map[string]any{secondStopInput()}, 3, 4), "")
	requireStatus(t, recorder, http.StatusCreated)
	requireStatus(t, f.decide(f.driver, decode(t, recorder), "reject", ""), http.StatusOK)
	recorder = f.propose(f.driver, proposal([]map[string]any{secondStopInput()}, 3, 4), "")
	requireStatus(t, recorder, http.StatusCreated)
	expiring := decode(t, recorder)
	h.Clock.Advance(181 * time.Second)
	_ = h.Marketplace.Sweep(context.Background())
	if row := f.amendmentRow(t, expiring["amendmentId"].(string)); row.State != machine.MpAmendmentExpired {
		t.Fatalf("fixture: the unapproved proposal must expire: %s", row.State)
	}

	trip := f.trip(t, f.rider)
	adjustments := trip["committedAdjustments"].([]any)
	if len(adjustments) != 3 {
		t.Fatalf("only committed adjustments appear on the receipt: %v", adjustments)
	}
	sum := int64(0)
	for _, raw := range adjustments {
		sum += moneyMinor(t, raw.(map[string]any), "fareDeltaMinor")
	}
	final := moneyMinor(t, trip, "agreedFareMinor")
	if moneyMinor(t, trip, "originalFareMinor") != f.amount || final != f.amount+sum {
		t.Fatalf("receipt: original %d + committed %d must equal agreed %d", f.amount, sum, final)
	}
	if fare, _, _, _ := f.rideTerms(t); fare != final {
		t.Fatalf("the ride carries the agreed fare: %d vs %d", fare, final)
	}
	assertMoneyReconciles(t, f, final)

	f.complete(t)
	settled, ok := h.Settlement.Requests[f.award.ID]
	if !ok || settled.FareMinor.AmountMinor != final || h.Settlement.EffectiveCalls != 1 {
		t.Fatalf("completion settles the committed fare %d exactly once: %+v", final, settled)
	}
	if h.Wallet.CapturedTotal(f.reservation) != marketplace.CommissionMinor(settled.FareMinor.AmountMinor) {
		t.Fatalf("commission captured %d must equal commission(settled fare %d) = %d",
			h.Wallet.CapturedTotal(f.reservation), settled.FareMinor.AmountMinor, marketplace.CommissionMinor(settled.FareMinor.AmountMinor))
	}
}

// TestFinishingTripBehindMultiStopTripIsStopAware: with server-authoritative
// stop events the remaining time of a multi-stop current trip is known, so a
// driver may queue a next job behind it — priced honestly: the remaining
// stops and their dwell lengthen the promised pickup, a dwell too long for
// the finishing window still refuses, and once the server sees a stop done
// the estimate shrinks.
func TestFinishingTripBehindMultiStopTripIsStopAware(t *testing.T) {
	h := newHarness(t,
		testutil.WithFlag(cityconfig.FlagMarketplaceMultiStop, true),
		testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	h.Clock.Set(fixedOffPeakHour)
	origin := testutil.PickupFixture()
	stopPlace := testutil.PlaceEast(testutil.PlaceAt(origin, 1_500), 300)

	current := func(stops []map[string]any) (testutil.Actor, *tripFixture) {
		rider, driver := h.Rider(), h.Driver()
		var quote map[string]any
		if len(stops) > 0 {
			recorder := quoteStops(t, h, rider, origin, testutil.PlaceAt(origin, 3_000), stops)
			requireStatus(t, recorder, http.StatusOK)
			quote = decode(t, recorder)
		} else {
			quote = quoteEnvelope(t, h, rider, origin, testutil.PlaceAt(origin, 3_000))
		}
		view := publishQuote(t, h, rider, quote)
		parkDriver(t, h, driver, origin)
		bid := fundedCurrentBid(t, h, driver, view["requestId"].(string), moneyMinor(t, view, "minimumFareMinor"))
		selected := doSelect(t, h, rider, view["requestId"].(string), map[string]any{
			"bidId": bid["bidId"], "requestVersion": 1, "bidVersion": 1,
		}, "")
		requireStatus(t, selected, http.StatusAccepted)
		award := awardRow(t, h, view["requestId"].(string))
		pin, _ := decode(t, selected)["pickupPin"].(string)
		f := &tripFixture{h: h, rider: rider, driver: driver, requestID: view["requestId"].(string), award: award,
			rideID: *award.ExecutionID, pin: pin, seq: 4, position: origin}
		if len(stops) > 0 {
			f.stops = routeStops(t, view)
		}
		return driver, f
	}
	plainDriver, _ := current(nil)
	stopDriver, stopTrip := current([]map[string]any{stopAt(stopPlace, "errand", intPtr(60), "")})
	longDriver, _ := current([]map[string]any{stopAt(stopPlace, "errand", intPtr(600), "")})

	next, _ := publishRoute(t, h, h.Rider(), testutil.PlaceAt(origin, 4_000), testutil.PlaceAt(origin, 9_000), 0)
	nextID := next["requestId"].(string)
	plain := evaluate(t, h, plainDriver, nextID)
	withStop := evaluate(t, h, stopDriver, nextID)
	if !plain.Eligible || !withStop.Eligible || *withStop.Slot != "next" {
		t.Fatalf("a driver behind a multi-stop trip may now queue a next job: plain %+v, stop %+v", plain.Reasons, withStop.Reasons)
	}
	if *withStop.PredictedPickupSec < *plain.PredictedPickupSec+60 {
		t.Fatalf("the remaining stop and its dwell must lengthen the promise: %d vs %d", *withStop.PredictedPickupSec, *plain.PredictedPickupSec)
	}
	if long := evaluate(t, h, longDriver, nextID); long.Eligible || !hasReason(long, "NOT_NEAR_COMPLETION") {
		t.Fatalf("a dwell too long for the finishing window still refuses: %+v", long)
	}

	// The server sees the stop finished: the estimate shrinks.
	stopTrip.start(t)
	stopTrip.moveTo(t, stopPlace, 4*time.Minute)
	stopID := stopTrip.stops[0]["stopId"].(string)
	requireStatus(t, stopTrip.stopPost(stopDriver, stopID, "arrive", map[string]any{}, ""), http.StatusOK)
	requireStatus(t, stopTrip.stopPost(stopDriver, stopID, "depart", nil, ""), http.StatusOK)
	after := evaluate(t, h, stopDriver, nextID)
	if !after.Eligible || *after.PredictedPickupSec >= *withStop.PredictedPickupSec {
		t.Fatalf("a finished stop must shorten the remaining estimate: %v → %v", *withStop.PredictedPickupSec, after.PredictedPickupSec)
	}
}
