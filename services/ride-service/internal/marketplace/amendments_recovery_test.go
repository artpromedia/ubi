package marketplace_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// TestAmendmentUnknownCommitLegConvergesAfterTripEnds: the rider's top-up
// commit LANDS at payment-service but its answer is lost, and the trip ends
// before the sweep retries. The commit already entered its money phase, so
// the retry converges the SAME idempotent calls forward — it never
// revalidates the ended trip into a rejection whose plain release would
// orphan the committed top-up. Meanwhile the unresolved adjustment never
// holds the driver's claim hostage: completion releases it at once and only
// the SETTLEMENT waits, then settles the committed fare exactly once.
func TestAmendmentUnknownCommitLegConvergesAfterTripEnds(t *testing.T) {
	// The harness keeps the wall clock here: the settlement row is due at the
	// DATABASE's now() when it is written, so the sweep must be able to reach
	// it by advancing the harness clock.
	h := newHarness(t,
		testutil.WithFlag(cityconfig.FlagMarketplaceMultiStop, true),
		testutil.WithFlag(cityconfig.FlagMarketplaceTripAmendments, true))
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	f.start(t)
	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	amendment := decode(t, recorder)
	id := amendment["amendmentId"].(string)
	revised := moneyMinor(t, amendment, "revisedFareMinor")
	requireStatus(t, f.decide(f.rider, amendment, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)

	h.Funding.UnknownCommitTopUp = true
	requireStatus(t, f.decide(f.driver, amendment, "approve", ""), http.StatusOK)
	row := f.amendmentRow(t, id)
	if row.State != machine.MpAmendmentAwaiting || row.FundingDone || row.Step != "capture" || row.StepState != "unknown" {
		t.Fatalf("an unknown first money leg must park the money phase: %+v", row)
	}
	if h.Funding.EffectiveTopUpCommits != 1 {
		t.Fatal("fixture: the top-up commit must have landed at payment-service")
	}
	h.Funding.UnknownCommitTopUp = false

	// The trip ends while that outcome is still unknown.
	f.complete(t)
	if claim := claimRow(t, h, f.award.ID); claim.State != machine.MpClaimCompleted {
		t.Fatalf("an unresolved adjustment must not hold the driver's claim: %s", claim.State)
	}
	if _, settled := h.Settlement.Requests[f.award.ID]; settled {
		t.Fatal("the settlement must wait while an adjustment holds open money")
	}

	// Time passes: the settlement row comes up in the sweep BEFORE the
	// amendment is resumed and defers while money is open; the same sweep
	// then resumes the amendment.
	h.Clock.Advance(2 * time.Minute)
	if err := h.Marketplace.Sweep(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, settled := h.Settlement.Requests[f.award.ID]; settled {
		t.Fatal("the settlement must defer while the adjustment still held open money")
	}
	row = f.amendmentRow(t, id)
	if row.State != machine.MpAmendmentCommitted || row.MoneyOpen {
		t.Fatalf("the retry must converge the money phase forward, never reject it: %+v", row)
	}
	if h.Funding.EffectiveTopUpCommits != 1 || h.Wallet.DeltaCapturesByAmendment[id] != 1 {
		t.Fatalf("each leg moves once: commits %d, captures %d", h.Funding.EffectiveTopUpCommits, h.Wallet.DeltaCapturesByAmendment[id])
	}
	assertMoneyReconciles(t, f, revised)

	// The deferred settlement row converges on the committed fare.
	h.Clock.Advance(10 * time.Minute)
	if err := h.Marketplace.Sweep(context.Background()); err != nil {
		t.Fatal(err)
	}
	settled, ok := h.Settlement.Requests[f.award.ID]
	if !ok || settled.FareMinor.AmountMinor != revised {
		t.Fatalf("completion settles the committed fare %d: %+v", revised, settled)
	}
	var rows, unresolved int
	if err := h.Pool.QueryRow(context.Background(), `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE resolved_at IS NULL)
		FROM mp.reservation_recovery WHERE action = 'settle' AND reservation_id = $1`,
		"mp.settle:"+f.award.ID.String()).Scan(&rows, &unresolved); err != nil {
		t.Fatal(err)
	}
	if rows != 1 || unresolved != 0 {
		t.Fatalf("one settlement row, resolved: %d rows, %d unresolved", rows, unresolved)
	}
}

// TestAmendmentKeysAreBoundToTheTrip: an Idempotency-Key a rider already
// used to propose a change (or end a trip early) on one trip, replayed with
// the same body on their NEXT trip, is a key reuse — never the first trip's
// amendment, and never a false "terminated" answer for a trip that was not.
func TestAmendmentKeysAreBoundToTheTrip(t *testing.T) {
	h := amendHarness(t)
	rider := h.Rider()
	further := testutil.PlaceAt(testutil.DropoffFixture(), 1_500)
	body := map[string]any{
		"stops":                 []map[string]any{},
		"dropoff":               map[string]any{"lat": further.Lat, "lng": further.Lng},
		"expectedRouteRevision": 1,
		"expectedFareRevision":  1,
	}
	proposeKey, terminateKey := idemKey(), idemKey()
	terminate := map[string]any{"expectedFareRevision": 1}

	first := awardedTripFor(t, h, rider, nil)
	first.start(t)
	proposed := first.propose(rider, body, proposeKey)
	requireStatus(t, proposed, http.StatusCreated)
	requireStatus(t, first.decide(rider, decode(t, proposed), "reject", ""), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, first.path("/terminate"), rider, terminate, move.IdempotencyHeader, terminateKey),
		http.StatusOK)
	first.complete(t)

	second := awardedTripFor(t, h, rider, nil)
	second.start(t)
	requireCode(t, second.propose(rider, body, proposeKey), http.StatusConflict, domain.CodeIdempotencyKeyReuse)
	requireCode(t, h.Do(http.MethodPost, second.path("/terminate"), rider, terminate, move.IdempotencyHeader, terminateKey),
		http.StatusConflict, domain.CodeIdempotencyKeyReuse)
	if trip := second.trip(t, rider); trip["terminatedAt"] != nil || trip["fareRevision"].(float64) != 1 {
		t.Fatalf("a reused key must change nothing on the second trip: %v", trip)
	}
	if second.openMoneyRows(t) != 0 {
		t.Fatal("a reused key must write no amendment")
	}
}

// TestEarlyTerminationSettlesADepartedStopsWaitingOnce: a termination priced
// the waiting at the stop the driver stood at, but its commit is parked
// (the refund's outcome was lost) and the driver departs that stop in the
// meantime. When the termination commits it settles that stop's waiting —
// the stop never raises a second stop_waiting adjustment for the same wait.
func TestEarlyTerminationSettlesADepartedStopsWaitingOnce(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput(), secondStopInput()})
	first := f.stops[0]["stopId"].(string)
	_, _, firstPlace, _ := stopFixtures()
	f.start(t)
	f.moveTo(t, firstPlace, 5*time.Minute)
	requireStatus(t, f.stopPost(f.driver, first, "arrive", map[string]any{}, ""), http.StatusOK)
	h.Clock.Advance(270 * time.Second) // 120s included + 150s paid → 3 started minutes
	f.moveTo(t, firstPlace, time.Second)

	h.Wallet.FailDeltaRefund = errors.New("connection reset by peer") // an unknown outcome
	ended := h.Do(http.MethodPost, f.path("/terminate"), f.rider, map[string]any{"expectedFareRevision": 1},
		move.IdempotencyHeader, idemKey())
	requireStatus(t, ended, http.StatusAccepted)
	var termination *marketplace.Amendment
	all, err := h.Marketplace.Store().AmendmentsForAward(context.Background(), h.Pool, f.award.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, amendment := range all {
		if amendment.Kind == marketplace.AmendmentKindEarlyTermination {
			termination = amendment
		}
	}
	if termination == nil || termination.State != machine.MpAmendmentAwaiting || termination.RevisedFareMinor >= termination.PriorFareMinor ||
		marketplace.CommissionMinor(termination.RevisedFareMinor) >= termination.PriorCommissionMinor {
		t.Fatalf("fixture: a parked early-termination decrease: %+v", termination)
	}

	// The driver leaves the stop while the termination is still converging.
	requireStatus(t, f.stopPost(f.driver, first, "depart", nil, ""), http.StatusOK)

	h.Wallet.FailDeltaRefund = nil
	h.Clock.Advance(5 * time.Minute)
	for i := 0; i < 2; i++ {
		if err := h.Marketplace.Sweep(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if row := f.amendmentRow(t, termination.ID.String()); row.State != machine.MpAmendmentCommitted || row.MoneyOpen {
		t.Fatalf("the termination must commit: %+v", row)
	}
	if waiting := waitingAmendments(t, f); len(waiting) != 0 {
		t.Fatalf("the wait the termination priced must never be charged again: %+v", waiting)
	}
	stop := tripStop(t, f.trip(t, f.rider), first)
	if moneyMinor(t, stopWaitingView(t, stop), "feeMinor") != 3_000 || stopWaitingView(t, stop)["settlement"] != "committed" {
		t.Fatalf("the stop's waiting settles once, under the termination: %v", stop)
	}
	assertMoneyReconciles(t, f, termination.RevisedFareMinor)
}

// TestAmendmentDroppingAStopReachedMidCommit: while a route change that drops
// a stop is committing (after its revalidation, before its apply), the
// driver reaches that stop — the original agreement is still in force. The
// commit leaves the stop skipped with its waiting finalised, so it neither
// stays "arrived" forever nor blocks the next stop's arrival.
func TestAmendmentDroppingAStopReachedMidCommit(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	first := f.stops[0]["stopId"].(string)
	_, _, firstPlace, _ := stopFixtures()
	f.start(t)

	recorder := f.propose(f.rider, proposal([]map[string]any{secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	amendment := decode(t, recorder)
	if moneyMinor(t, amendment, "fareDeltaMinor") <= 0 {
		t.Fatalf("fixture: replacing the stop must be an increase (a capture runs): %v", amendment)
	}
	requireStatus(t, f.decide(f.rider, amendment, "approve", ""), http.StatusOK)
	f.park(t, firstPlace, 30*time.Second)

	arrived := -1
	h.Wallet.BeforeDeltaCapture = func() {
		arrived = f.stopPost(f.driver, first, "arrive", map[string]any{}, "").Code
	}
	requireStatus(t, f.decide(f.driver, amendment, "approve", ""), http.StatusOK)
	if arrived != http.StatusOK {
		t.Fatalf("fixture: the driver must reach the dropped stop mid-commit: %d", arrived)
	}
	if row := f.amendmentRow(t, amendment["amendmentId"].(string)); row.State != machine.MpAmendmentCommitted {
		t.Fatalf("the change must commit: %s", row.State)
	}
	var dropped *marketplace.ExecutionStop
	stops, err := h.Marketplace.Store().ExecutionStops(context.Background(), h.Pool, f.award.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, stop := range stops {
		if stop.StopID.String() == first {
			dropped = stop
		}
	}
	if dropped == nil || dropped.State != marketplace.StopStateSkipped || dropped.SkipReason != "removed_by_amendment" {
		t.Fatalf("the dropped stop reached mid-commit must leave the trip as skipped: %+v", dropped)
	}

	// The committed route's stop can be reached next.
	route := f.executionRoute(t)
	if len(route.Stops) != 1 || route.Stops[0].StopID.String() == first {
		t.Fatalf("committed stops: %+v", route.Stops)
	}
	f.moveTo(t, secondStop(), 3*time.Minute)
	requireStatus(t, f.stopPost(f.driver, route.Stops[0].StopID.String(), "arrive", map[string]any{}, ""), http.StatusOK)
	assertMoneyReconciles(t, f, moneyMinor(t, amendment, "revisedFareMinor"))
}

// TestDriverFareDecisionsRefusedWhileMoving: proposing or rejecting a change
// is a fare decision too — a driver in motion is refused (nothing written,
// nothing released) and the same call lands once they are parked.
func TestDriverFareDecisionsRefusedWhileMoving(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	f.drive(t, f.position)

	moving := f.propose(f.driver, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireCode(t, moving, http.StatusForbidden, domain.CodeDriverIneligible)
	if reason := decode(t, moving)["details"].(map[string]any)["reason"]; reason != "NOT_STATIONARY" {
		t.Fatalf("the refusal must say why: %v", reason)
	}
	var rows int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM mp.amendments WHERE award_id = $1`, f.award.ID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 || h.Wallet.DeltaReserveCalls != 0 {
		t.Fatal("an in-motion proposal must write and reserve nothing")
	}

	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	amendment := decode(t, recorder)
	requireCode(t, f.decide(f.driver, amendment, "reject", ""), http.StatusForbidden, domain.CodeDriverIneligible)
	if row := f.amendmentRow(t, amendment["amendmentId"].(string)); row.State != machine.MpAmendmentAwaiting || h.Wallet.OpenDeltas(f.reservation) != 1 {
		t.Fatalf("an in-motion rejection must change nothing: %s", row.State)
	}
	f.park(t, f.position, time.Minute)
	requireStatus(t, f.decide(f.driver, amendment, "reject", ""), http.StatusOK)
	if row := f.amendmentRow(t, amendment["amendmentId"].(string)); row.State != machine.MpAmendmentRejected || row.MoneyOpen {
		t.Fatalf("a parked driver's rejection lands and releases: %+v", row)
	}
}
