package marketplace_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// TestAmendmentIncreaseCommitsOnlyTheDelta: a post-award route change is
// priced server-side as a delta under the award's snapshot, reserves ONLY the
// incremental commission and the rider's top-up before anyone approves,
// leaves the original agreement in force until both parties approved the
// exact terms, then captures the increment once, commits the top-up and
// rewrites the execution ride — never re-charging the 10%.
func TestAmendmentIncreaseCommitsOnlyTheDelta(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	originalFare, originalQuote, _, rideVersion := f.rideTerms(t)
	if originalFare != f.amount || h.Wallet.CapturedTotal(f.reservation) != marketplace.CommissionMinor(f.amount) {
		t.Fatalf("fixture: award fare %d, ride fare %d, captured %d", f.amount, originalFare, h.Wallet.CapturedTotal(f.reservation))
	}

	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	amendment := decode(t, recorder)
	if amendment["state"] != machine.MpAmendmentAwaiting || amendment["riderFunding"] != "reserved" ||
		amendment["routeRevision"].(float64) != 2 || amendment["fareRevision"].(float64) != 2 {
		t.Fatalf("proposal: %v", amendment)
	}
	if _, leaked := amendment["commissionDeltaMinor"]; leaked {
		t.Fatalf("the rider must never see the driver's commission: %v", amendment)
	}
	revised := moneyMinor(t, amendment, "revisedFareMinor")
	delta := moneyMinor(t, amendment, "fareDeltaMinor")
	if revised <= f.amount || revised-f.amount != delta || moneyMinor(t, amendment, "riderFundingDeltaMinor") != delta {
		t.Fatalf("an added stop must raise the fare by the priced delta: revised %d, delta %d", revised, delta)
	}
	if amendment["addedDistanceMeters"].(float64) <= 0 || amendment["addedDurationSec"].(float64) <= 0 {
		t.Fatalf("the proposal must state the added distance and time: %v", amendment)
	}
	commissionDelta := marketplace.CommissionMinor(revised) - marketplace.CommissionMinor(f.amount)
	// Reserved, not captured: the driver's spendable is encumbered by the
	// increment only, the rider's top-up is open, the original stands.
	if h.Wallet.OpenDeltas(f.reservation) != 1 || h.Funding.OpenTopUps(f.award.ID) != 1 {
		t.Fatalf("an increase must reserve both sides before approvals")
	}
	if h.Wallet.Spendable(f.driver.UserID) != 1_000_000-marketplace.CommissionMinor(f.amount)-commissionDelta {
		t.Fatalf("only the incremental commission may be reserved: spendable %d", h.Wallet.Spendable(f.driver.UserID))
	}
	if fare, quote, _, _ := f.rideTerms(t); fare != originalFare || quote != originalQuote {
		t.Fatal("the original agreement must stay in force until the amendment commits")
	}

	// The driver sees the incremental commission and net change.
	driverView := h.Do(http.MethodGet, f.path("/amendments/"+amendment["amendmentId"].(string)), f.driver, nil)
	requireStatus(t, driverView, http.StatusOK)
	if moneyMinor(t, decode(t, driverView), "commissionDeltaMinor") != commissionDelta ||
		moneyMinor(t, decode(t, driverView), "driverNetDeltaMinor") != delta-commissionDelta {
		t.Fatalf("driver view: %s", driverView.Body.String())
	}

	requireStatus(t, f.decide(f.rider, amendment, "approve", ""), http.StatusOK)
	if row := f.amendmentRow(t, amendment["amendmentId"].(string)); row.State != machine.MpAmendmentAwaiting {
		t.Fatalf("one approval must not commit: %s", row.State)
	}
	f.park(t, f.position, 30*time.Second)
	approved := f.decide(f.driver, amendment, "approve", "")
	requireStatus(t, approved, http.StatusOK)
	committed := decode(t, approved)
	if committed["state"] != machine.MpAmendmentCommitted || committed["riderFunding"] != "committed" {
		t.Fatalf("both approvals must commit: %v", committed)
	}

	route := f.executionRoute(t)
	if route.AgreedFareMinor != revised || route.RouteRevision != 2 || route.FareRevision != 2 || len(route.Stops) != 2 {
		t.Fatalf("committed terms: %+v", route)
	}
	if route.CapturedCommissionMinor != marketplace.CommissionMinor(revised) ||
		h.Wallet.CapturedTotal(f.reservation) != marketplace.CommissionMinor(revised) {
		t.Fatalf("captured commission must be commission(new fare): route %d, wallet %d, want %d",
			route.CapturedCommissionMinor, h.Wallet.CapturedTotal(f.reservation), marketplace.CommissionMinor(revised))
	}
	if h.Wallet.CapturesByReservation[f.reservation] != 1 || h.Wallet.DeltaCapturesByAmendment[amendment["amendmentId"].(string)] != 1 {
		t.Fatal("the award's hold is captured ONCE; only the increment moves, once")
	}
	if h.Funding.FundedAmount(f.award.ID) != revised || h.Funding.OpenTopUps(f.award.ID) != 0 {
		t.Fatalf("rider funding must cover the committed fare: %d", h.Funding.FundedAmount(f.award.ID))
	}
	fare, quote, _, version := f.rideTerms(t)
	if fare != revised || quote == originalQuote || version != rideVersion+1 {
		t.Fatalf("the execution ride must carry the committed terms: fare %d quote changed %v version %d", fare, quote != originalQuote, version)
	}
	if got := executionStopsFor(t, h, f.requestID); len(got) != 2 || got[0].StopID != f.stops[0]["stopId"] {
		t.Fatalf("the ride's quote must carry the amended stops with stable ids: %+v", got)
	}
	if outboxCount(t, h, "ride.terms_amended", f.rideID.String()) != 1 ||
		outboxCount(t, h, "mp.amendment.committed", amendment["amendmentId"].(string)) != 1 {
		t.Fatal("the commit must publish ride.terms_amended and mp.amendment.committed once")
	}
	events := historyEvents(t, h, amendment["amendmentId"].(string))
	want := []string{"proposed", "funding_secured", "approved", "approved", "funding_committed", "commission_committed", "committed"}
	if len(events) != len(want) {
		t.Fatalf("history: %v, want %v", events, want)
	}
	for i := range want {
		if events[i] != want[i] {
			t.Fatalf("history: %v, want %v", events, want)
		}
	}
	// The history is append-only: the database refuses an edit.
	if _, err := h.Pool.Exec(context.Background(),
		`UPDATE mp.amendment_history SET event = 'forged' WHERE amendment_id = $1`, amendment["amendmentId"]); err == nil {
		t.Fatal("amendment history must refuse updates")
	}
}

// TestAmendmentBindsApprovalsToExactRevisions: an approval (or a proposal)
// bound to terms other than the ones on the table is refused with the
// refreshed terms — a stale selection of terms can never commit.
func TestAmendmentBindsApprovalsToExactRevisions(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})

	stale := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 7), "")
	requireCode(t, stale, http.StatusConflict, domain.CodeVersionConflict)
	details := decode(t, stale)["details"].(map[string]any)["refreshedTerms"].(map[string]any)
	if details["fareRevision"].(float64) != 1 || details["routeRevision"].(float64) != 1 {
		t.Fatalf("refreshed terms: %v", details)
	}

	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	amendment := decode(t, recorder)
	wrong := map[string]any{"amendmentId": amendment["amendmentId"], "routeRevision": 2, "fareRevision": 1}
	requireCode(t, f.decide(f.rider, wrong, "approve", ""), http.StatusConflict, domain.CodeVersionConflict)
	if row := f.amendmentRow(t, amendment["amendmentId"].(string)); row.RiderApprovedAt != nil {
		t.Fatal("a mis-bound approval must record nothing")
	}

	requireStatus(t, f.decide(f.rider, amendment, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)
	requireStatus(t, f.decide(f.driver, amendment, "approve", ""), http.StatusOK)

	// The terms moved to revision 2: a proposal against revision 1 is stale.
	again := f.propose(f.rider, proposal([]map[string]any{firstStopInput()}, 1, 1), "")
	requireCode(t, again, http.StatusConflict, domain.CodeVersionConflict)
}

// TestConcurrentAmendmentProposalsExactlyOneOpen: two proposals racing on one
// trip leave exactly ONE amendment with open money — the database's partial
// unique index decides — and exactly one commission increment reserved.
func TestConcurrentAmendmentProposalsExactlyOneOpen(t *testing.T) {
	for round := 0; round < 4; round++ {
		h := amendHarness(t)
		f := awardedTrip(t, h, []map[string]any{firstStopInput()})
		recorders := make([]*httptest.ResponseRecorder, 2)
		done := make(chan struct{})
		start := make(chan struct{})
		for i, actor := range []struct {
			who  string
			body map[string]any
		}{
			{"rider", proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1)},
			{"driver", proposal([]map[string]any{secondStopInput()}, 1, 1)},
		} {
			go func(i int, who string, body map[string]any) {
				defer func() { done <- struct{}{} }()
				<-start
				party := f.rider
				if who == "driver" {
					party = f.driver
				}
				recorders[i] = f.propose(party, body, "")
			}(i, actor.who, actor.body)
		}
		close(start)
		<-done
		<-done
		created := 0
		for _, recorder := range recorders {
			switch recorder.Code {
			case http.StatusCreated:
				created++
			case http.StatusConflict:
				if body := decode(t, recorder); body["code"] != string(domain.CodeConflict) {
					t.Fatalf("round %d: the losing proposal must be a conflict: %v", round, body)
				}
			default:
				t.Fatalf("round %d: unexpected outcome %d %s", round, recorder.Code, recorder.Body.String())
			}
		}
		if created != 1 || f.openMoneyRows(t) != 1 || h.Wallet.OpenDeltas(f.reservation) != 1 {
			t.Fatalf("round %d: exactly one open amendment: created %d, open rows %d, open deltas %d",
				round, created, f.openMoneyRows(t), h.Wallet.OpenDeltas(f.reservation))
		}
	}
}

// TestRejectedAmendmentReleasesAllHolds: a driver's rejection releases the
// commission increment AND the rider's top-up, changes nothing about the
// trip, and costs the driver NO standing.
func TestRejectedAmendmentReleasesAllHolds(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	spendable := h.Wallet.Spendable(f.driver.UserID)
	fare, quote, _, _ := f.rideTerms(t)

	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	amendment := decode(t, recorder)
	if h.Wallet.Spendable(f.driver.UserID) >= spendable {
		t.Fatal("fixture: the increase must have reserved the increment")
	}

	rejected := f.decide(f.driver, amendment, "reject", "")
	requireStatus(t, rejected, http.StatusOK)
	if view := decode(t, rejected); view["state"] != machine.MpAmendmentRejected || view["riderFunding"] != "released" {
		t.Fatalf("rejection: %v", view)
	}
	id := amendment["amendmentId"].(string)
	if h.Wallet.OpenDeltas(f.reservation) != 0 || h.Wallet.DeltaReleasesByAmendment[id] != 1 ||
		h.Wallet.Spendable(f.driver.UserID) != spendable {
		t.Fatal("the commission increment must be released exactly once, restoring the spendable")
	}
	if h.Funding.OpenTopUps(f.award.ID) != 0 || h.Funding.EffectiveTopUpReleases != 1 || h.Funding.FundedAmount(f.award.ID) != f.amount {
		t.Fatal("the rider's top-up must be released, funding back to the agreed fare")
	}
	if row := f.amendmentRow(t, id); row.MoneyOpen || row.Reason != "driver_rejected" {
		t.Fatalf("the rejected amendment must close its money: %+v", row)
	}
	if nowFare, nowQuote, _, _ := f.rideTerms(t); nowFare != fare || nowQuote != quote {
		t.Fatal("a rejected amendment must leave the ride untouched")
	}
	if route := f.executionRoute(t); route.AgreedFareMinor != f.amount || route.RouteRevision != 1 || route.FareRevision != 1 {
		t.Fatalf("the agreement must stand: %+v", route)
	}
	var standing int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM mp.driver_standing_actions WHERE driver_id = $1`, f.driver.UserID).Scan(&standing); err != nil {
		t.Fatal(err)
	}
	if standing != 0 {
		t.Fatalf("rejecting a change must carry no standing penalty: %d actions", standing)
	}
	// A rejected change cannot be approved afterwards.
	requireCode(t, f.decide(f.rider, amendment, "approve", ""), http.StatusConflict, domain.CodeConflict)
}

// TestAmendmentInsufficientFundsRefusesWithoutSideEffects: a driver who
// cannot cover the incremental commission, or a rider who cannot cover the
// top-up, gets a definite refusal — and nothing is held and nothing changes.
func TestAmendmentInsufficientFundsRefusesWithoutSideEffects(t *testing.T) {
	t.Run("driver spendable", func(t *testing.T) {
		h := amendHarness(t)
		f := awardedTrip(t, h, []map[string]any{firstStopInput()})
		h.Wallet.SetSpendable(f.driver.UserID, 100)
		recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
		requireCode(t, recorder, http.StatusUnprocessableEntity, domain.CodeInsufficientSpendable)
		details := decode(t, recorder)["details"].(map[string]any)
		if details["amendmentState"] != machine.MpAmendmentRejected || details["reason"] != "insufficient_driver_spendable" {
			t.Fatalf("refusal details: %v", details)
		}
		if h.Wallet.OpenDeltas(f.reservation) != 0 || h.Wallet.Spendable(f.driver.UserID) != 100 || h.Funding.TopUpCalls != 0 {
			t.Fatal("a refused increment must hold nothing and never reach the rider's funding")
		}
		assertTripUntouched(t, f)
	})
	t.Run("rider funds", func(t *testing.T) {
		h := amendHarness(t)
		f := awardedTrip(t, h, []map[string]any{firstStopInput()})
		h.Funding.SetRiderSpendable(f.rider.UserID, 1_000)
		spendable := h.Wallet.Spendable(f.driver.UserID)
		recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
		requireCode(t, recorder, http.StatusUnprocessableEntity, domain.CodeInsufficientFunds)
		id := decode(t, recorder)["details"].(map[string]any)["amendmentId"].(string)
		if h.Wallet.DeltaReleasesByAmendment[id] != 1 || h.Wallet.OpenDeltas(f.reservation) != 0 ||
			h.Wallet.Spendable(f.driver.UserID) != spendable {
			t.Fatal("the commission increment reserved first must be released when the rider cannot fund")
		}
		if h.Funding.OpenTopUps(f.award.ID) != 0 || h.Funding.RiderSpendable(f.rider.UserID) != 1_000 {
			t.Fatal("a refused top-up holds nothing")
		}
		if row := f.amendmentRow(t, id); row.MoneyOpen || row.State != machine.MpAmendmentRejected {
			t.Fatalf("the refused proposal must be closed: %+v", row)
		}
		assertTripUntouched(t, f)
	})
}

// assertTripUntouched: the original agreement stands.
func assertTripUntouched(t *testing.T, f *tripFixture) {
	t.Helper()
	route := f.executionRoute(t)
	if route.AgreedFareMinor != f.amount || route.FareRevision != 1 || route.RouteRevision != 1 ||
		route.CapturedCommissionMinor != marketplace.CommissionMinor(f.amount) {
		t.Fatalf("committed terms moved: %+v", route)
	}
	if fare, _, _, _ := f.rideTerms(t); fare != f.amount {
		t.Fatalf("the ride's fare moved: %d", fare)
	}
	if f.h.Wallet.CapturedTotal(f.reservation) != marketplace.CommissionMinor(f.amount) {
		t.Fatal("the captured commission moved")
	}
}

// TestAmendmentDuplicateAdjustmentsAreIdempotent: replaying a proposal, an
// approval or the commit moves no money twice — the same amendment answers,
// the increment is captured once, the funding committed once.
func TestAmendmentDuplicateAdjustmentsAreIdempotent(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	body := proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1)
	key := idemKey()
	first := f.propose(f.rider, body, key)
	requireStatus(t, first, http.StatusCreated)
	amendment := decode(t, first)
	replay := f.propose(f.rider, body, key)
	requireStatus(t, replay, http.StatusOK)
	if decode(t, replay)["amendmentId"] != amendment["amendmentId"] {
		t.Fatal("a replayed proposal must answer the same amendment")
	}
	if h.Wallet.DeltaReserveCalls != 1 || h.Funding.EffectiveTopUps != 1 {
		t.Fatalf("a replay must not reserve again: %d reserves, %d top-ups", h.Wallet.DeltaReserveCalls, h.Funding.EffectiveTopUps)
	}
	// The same key with another body is refused.
	requireCode(t, f.propose(f.rider, proposal([]map[string]any{secondStopInput()}, 1, 1), key),
		http.StatusConflict, domain.CodeIdempotencyKeyReuse)

	approveKey := idemKey()
	requireStatus(t, f.decide(f.rider, amendment, "approve", approveKey), http.StatusOK)
	requireStatus(t, f.decide(f.rider, amendment, "approve", approveKey), http.StatusOK)
	requireStatus(t, f.decide(f.rider, amendment, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)
	driverKey := idemKey()
	requireStatus(t, f.decide(f.driver, amendment, "approve", driverKey), http.StatusOK)
	requireStatus(t, f.decide(f.driver, amendment, "approve", driverKey), http.StatusOK)

	// The saga re-driven by the sweep (twice) finds nothing left to do.
	h.Clock.Advance(5 * time.Minute)
	_ = h.Marketplace.Sweep(context.Background())
	_ = h.Marketplace.Sweep(context.Background())
	id := amendment["amendmentId"].(string)
	if h.Wallet.DeltaCapturesByAmendment[id] != 1 || h.Funding.EffectiveTopUpCommits != 1 {
		t.Fatalf("the increment must be captured once and the top-up committed once: %d / %d",
			h.Wallet.DeltaCapturesByAmendment[id], h.Funding.EffectiveTopUpCommits)
	}
	if outboxCount(t, h, "mp.amendment.committed", id) != 1 || outboxCount(t, h, "ride.terms_amended", f.rideID.String()) != 1 {
		t.Fatal("a commit is published once")
	}
	var approvals int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM mp.amendment_history WHERE amendment_id = $1 AND event = 'approved'`, id).Scan(&approvals); err != nil {
		t.Fatal(err)
	}
	if approvals != 2 {
		t.Fatalf("each party's approval is recorded once: %d", approvals)
	}
}

// TestDriverApprovalRefusedWhileMoving: the driver's approval is an
// interactive decision and is refused while telemetry shows motion — never
// an in-motion control. Once parked, the same approval lands.
func TestDriverApprovalRefusedWhileMoving(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	amendment := decode(t, recorder)

	f.drive(t, f.position)
	moving := f.decide(f.driver, amendment, "approve", "")
	requireCode(t, moving, http.StatusForbidden, domain.CodeDriverIneligible)
	if reason := decode(t, moving)["details"].(map[string]any)["reason"]; reason != "NOT_STATIONARY" {
		t.Fatalf("the refusal must say why: %v", reason)
	}
	if row := f.amendmentRow(t, amendment["amendmentId"].(string)); row.DriverApprovedAt != nil {
		t.Fatal("an in-motion approval must record nothing")
	}
	f.park(t, f.position, 2*time.Minute)
	requireStatus(t, f.decide(f.driver, amendment, "approve", ""), http.StatusOK)
	if row := f.amendmentRow(t, amendment["amendmentId"].(string)); row.DriverApprovedAt == nil {
		t.Fatal("a parked driver's approval must land")
	}
}

// TestAmendmentExpiresAndReleases: an amendment nobody approves in the
// configured window expires on the sweep and releases what it reserved.
func TestAmendmentExpiresAndReleases(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	recorder := f.propose(f.driver, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	amendment := decode(t, recorder)
	if amendment["proposedByRole"] != "driver" {
		t.Fatalf("either party may propose: %v", amendment["proposedByRole"])
	}
	h.Clock.Advance(181 * time.Second)
	if err := h.Marketplace.Sweep(context.Background()); err != nil {
		t.Fatal(err)
	}
	row := f.amendmentRow(t, amendment["amendmentId"].(string))
	if row.State != machine.MpAmendmentExpired || row.MoneyOpen {
		t.Fatalf("an unapproved amendment must expire and close its money: %+v", row)
	}
	if h.Wallet.OpenDeltas(f.reservation) != 0 || h.Funding.OpenTopUps(f.award.ID) != 0 {
		t.Fatal("expiry must release every reservation")
	}
	assertTripUntouched(t, f)
	// A late approval is refused.
	requireCode(t, f.decide(f.rider, amendment, "approve", ""), http.StatusConflict, domain.CodeConflict)
}

// TestAmendmentFlagsDenyByDefault: with marketplace_trip_amendments off no
// change can be proposed; the executing trip is untouched.
func TestAmendmentFlagsDenyByDefault(t *testing.T) {
	h := newHarness(t)
	h.Clock.Set(fixedOffPeakHour)
	f := awardedTrip(t, h, nil)
	recorder := f.propose(f.rider, map[string]any{
		"stops": []map[string]any{}, "dropoff": map[string]any{"lat": 6.58, "lng": 3.38},
		"expectedRouteRevision": 1, "expectedFareRevision": 1,
	}, "")
	requireCode(t, recorder, http.StatusNotFound, domain.CodeFeatureDisabled)
	requireCode(t, h.Do(http.MethodPost, f.path("/terminate"), f.rider, map[string]any{"expectedFareRevision": 1},
		"Idempotency-Key", idemKey()), http.StatusNotFound, domain.CodeFeatureDisabled)
	var rows int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM mp.amendments WHERE request_id = $1`, f.requestID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatal("a disabled feature must write nothing")
	}
}

// TestAmendmentProcessDeathMidCommitResumes: the commission capture lands at
// payment-service but its answer is lost (the process may as well have
// died). The amendment parks on its durable step; a RESTARTED service's sweep
// re-drives the same amendment id, payment-service replays the original
// capture, and the commit completes — the increment moved exactly once.
func TestAmendmentProcessDeathMidCommitResumes(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	amendment := decode(t, recorder)
	id := amendment["amendmentId"].(string)
	revised := moneyMinor(t, amendment, "revisedFareMinor")
	requireStatus(t, f.decide(f.rider, amendment, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)

	h.Wallet.UnknownDeltaCapture = true
	paused := f.decide(f.driver, amendment, "approve", "")
	requireStatus(t, paused, http.StatusOK)
	if view := decode(t, paused); view["state"] != machine.MpAmendmentAwaiting {
		t.Fatalf("an unknown capture outcome must park the commit, not decide it: %v", view["state"])
	}
	row := f.amendmentRow(t, id)
	if !row.FundingDone || row.CommissionDone || row.Step != "capture" || row.StepState != "unknown" || !row.MoneyOpen {
		t.Fatalf("the durable step ledger must record where the commit stopped: %+v", row)
	}
	if h.Wallet.DeltaCapturesByAmendment[id] != 1 {
		t.Fatal("fixture: the capture must have landed at the wallet")
	}
	if route := f.executionRoute(t); route.AgreedFareMinor != f.amount {
		t.Fatal("until the commit completes the original agreement stands")
	}

	// "Restart": a fresh service instance with no memory of the call.
	h.Wallet.UnknownDeltaCapture = false
	h.Clock.Advance(2 * time.Minute)
	restarted := restartedService(t, h)
	if err := restarted.Sweep(context.Background()); err != nil {
		t.Fatal(err)
	}
	row = f.amendmentRow(t, id)
	if row.State != machine.MpAmendmentCommitted || row.MoneyOpen {
		t.Fatalf("the restarted sweep must resume the commit: %+v", row)
	}
	if h.Wallet.DeltaCapturesByAmendment[id] != 1 || h.Funding.EffectiveTopUpCommits != 1 {
		t.Fatalf("resuming must replay, never re-capture: captures %d, commits %d",
			h.Wallet.DeltaCapturesByAmendment[id], h.Funding.EffectiveTopUpCommits)
	}
	route := f.executionRoute(t)
	if route.AgreedFareMinor != revised || h.Wallet.CapturedTotal(f.reservation) != marketplace.CommissionMinor(revised) {
		t.Fatalf("the resumed commit must land the committed terms: fare %d, captured %d", route.AgreedFareMinor, h.Wallet.CapturedTotal(f.reservation))
	}
}

// TestAmendmentCommitFailureCompensates: the rider's top-up committed, then
// the commission capture is DEFINITELY refused. The amendment fails and is
// compensated with linked adjustments of its own — the committed top-up is
// released back and the reserved increment freed — so nothing of it remains
// and the original agreement stands.
func TestAmendmentCommitFailureCompensates(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	amendment := decode(t, recorder)
	id := amendment["amendmentId"].(string)
	requireStatus(t, f.decide(f.rider, amendment, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)

	h.Wallet.FailDeltaCapture = domain.Errorf(domain.CodeConflict, "the award's commission is no longer captured")
	failed := f.decide(f.driver, amendment, "approve", "")
	requireCode(t, failed, http.StatusConflict, domain.CodeConflict)
	if state := decode(t, failed)["details"].(map[string]any)["amendmentState"]; state != machine.MpAmendmentCompensated {
		t.Fatalf("a part-way refusal must end compensated: %v", state)
	}
	row := f.amendmentRow(t, id)
	if row.State != machine.MpAmendmentCompensated || row.MoneyOpen || !row.FundingDone || row.CommissionDone {
		t.Fatalf("compensated row: %+v", row)
	}
	if h.Funding.FundedAmount(f.award.ID) != f.amount || h.Funding.EffectivePartialReleases != 1 {
		t.Fatalf("the committed top-up must be offset by a linked partial release: funded %d", h.Funding.FundedAmount(f.award.ID))
	}
	if h.Wallet.OpenDeltas(f.reservation) != 0 || h.Wallet.DeltaCapturesByAmendment[id] != 0 {
		t.Fatal("the reserved increment must be released and never captured")
	}
	events := historyEvents(t, h, id)
	if events[len(events)-2] != "failed" || events[len(events)-1] != "compensated" {
		t.Fatalf("history must record failed then compensated: %v", events)
	}
	assertTripUntouched(t, f)
}

// TestAmendmentNextJobConflictRefused: a driver with a consented queued next
// job cannot have their current trip lengthened past that rider's promised
// pickup window — the change is refused with next_job_conflict before any
// money is touched (and re-checked first at commit), while a change that
// keeps the promise is accepted. The queued rider is never silently
// sacrificed.
func TestAmendmentNextJobConflictRefused(t *testing.T) {
	h := amendHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	q := setupQueuedAward(t, h)
	origin := testutil.PickupFixture()
	trip := &tripFixture{h: h, rider: q.riderA, driver: q.driver, requestID: q.requestA, award: q.awardA,
		rideID: q.rideA, seq: 4, position: origin}

	far := stopAt(testutil.PlaceEast(testutil.PlaceAt(origin, 1_500), 2_000), "errand", intPtr(300), "")
	refused := trip.propose(q.riderA, proposal([]map[string]any{far}, 1, 1), "")
	requireCode(t, refused, http.StatusConflict, domain.CodeConflict)
	details := decode(t, refused)["details"].(map[string]any)
	if details["reason"] != marketplace.ReasonNextJobConflict {
		t.Fatalf("the refusal must name the next-job conflict: %v", details)
	}
	// The queued job is ANOTHER customer's: a rider proposer never learns
	// its award, request or promised pickup.
	for _, key := range []string{"queuedAwardId", "queuedRequestId", "consentedPickupBy", "predictedPickupAt"} {
		if _, leaked := details[key]; leaked {
			t.Fatalf("a rider must not see the queued job's %s: %v", key, details)
		}
	}
	// The driver owns the queue and is told exactly which job it protects.
	trip.park(t, origin, 0)
	driverRefused := trip.propose(q.driver, proposal([]map[string]any{far}, 1, 1), "")
	requireCode(t, driverRefused, http.StatusConflict, domain.CodeConflict)
	driverDetails := decode(t, driverRefused)["details"].(map[string]any)
	if driverDetails["reason"] != marketplace.ReasonNextJobConflict || driverDetails["queuedAwardId"] != q.awardB.ID.String() ||
		driverDetails["queuedRequestId"] == nil || driverDetails["consentedPickupBy"] == nil {
		t.Fatalf("the driver's refusal must name the protected queued job: %v", driverDetails)
	}
	if h.Wallet.DeltaReserveCalls != 0 {
		t.Fatal("a conflicting change must be refused before any money moves")
	}
	var rows int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM mp.amendments WHERE award_id = $1`, q.awardA.ID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatal("a refused conflicting change writes no amendment")
	}

	// A modest change keeps the promise at proposal time …
	modest := stopAt(testutil.PlaceEast(testutil.PlaceAt(origin, 1_500), 1_000), "errand", intPtr(120), "")
	recorder := trip.propose(q.riderA, proposal([]map[string]any{modest}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	amendment := decode(t, recorder)
	requireStatus(t, trip.decide(q.riderA, amendment, "approve", ""), http.StatusOK)

	// … but by the time the driver approves, the promise would break: the
	// commit revalidates FIRST and refuses, releasing everything.
	trip.park(t, origin, 130*time.Second)
	late := trip.decide(q.driver, amendment, "approve", "")
	requireCode(t, late, http.StatusConflict, domain.CodeConflict)
	if reason := decode(t, late)["details"].(map[string]any)["reason"]; reason != marketplace.ReasonNextJobConflict {
		t.Fatalf("the commit must refuse with next_job_conflict: %v", reason)
	}
	row := trip.amendmentRow(t, amendment["amendmentId"].(string))
	if row.State != machine.MpAmendmentRejected || row.Reason != marketplace.ReasonNextJobConflict || row.MoneyOpen {
		t.Fatalf("the refused commit must reject and release: %+v", row)
	}
	if h.Wallet.OpenDeltas(bidReservationOf(t, h, q.awardA)) != 0 {
		t.Fatal("the increment must be released")
	}
	if award := awardRow(t, h, q.requestB); award.State != machine.MpAwardConfirmed {
		t.Fatalf("the queued rider's award must be untouched: %s", award.State)
	}
	if claim := claimByID(t, h, q.claimB.ID); claim.State != machine.MpClaimNext {
		t.Fatalf("the queued claim must stay queued: %s", claim.State)
	}
}

// bidReservationOf is the award's captured hold.
func bidReservationOf(t *testing.T, h *testutil.Harness, award *marketplace.Award) string {
	t.Helper()
	bid, err := h.Marketplace.Store().BidByID(context.Background(), h.Pool, award.BidID)
	if err != nil {
		t.Fatal(err)
	}
	return bid.ReservationID
}

// TestAmendmentDecreaseCompensation: a committed decrease whose commission
// refund landed but whose rider partial release is definitely refused is
// compensated by restoring the captured total with a linked increment of its
// own — the award ends exactly where it stood before the decrease.
func TestAmendmentDecreaseCompensation(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	increase := decode(t, recorder)
	requireStatus(t, f.decide(f.rider, increase, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)
	requireStatus(t, f.decide(f.driver, increase, "approve", ""), http.StatusOK)
	raised := f.executionRoute(t).AgreedFareMinor

	recorder = f.propose(f.rider, proposal([]map[string]any{firstStopInput()}, 2, 2), "")
	requireStatus(t, recorder, http.StatusCreated)
	decrease := decode(t, recorder)
	if h.Wallet.DeltaReserveCalls != 1 || h.Funding.TopUpCalls != 1 {
		t.Fatal("a decrease reserves nothing before approvals")
	}
	requireStatus(t, f.decide(f.rider, decrease, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)
	h.Funding.FailPartialRelease = domain.Errorf(domain.CodeConflict, "this award's funding reservation is no longer active")
	failed := f.decide(f.driver, decrease, "approve", "")
	requireCode(t, failed, http.StatusConflict, domain.CodeConflict)
	id := decrease["amendmentId"].(string)
	row := f.amendmentRow(t, id)
	if row.State != machine.MpAmendmentCompensated || !row.CommissionDone || row.FundingDone || row.MoneyOpen {
		t.Fatalf("compensated decrease: %+v", row)
	}
	if h.Wallet.DeltaRefundsByAmendment[id] != 1 || h.Wallet.DeltaCapturesByAmendment[id+".c"] != 1 {
		t.Fatal("the refund is offset by one linked compensating capture")
	}
	assertMoneyReconciles(t, f, raised)
}

// TestAmendmentStaleWalletTermsRefused: when payment-service's captured total
// disagrees with the prior ride-service states, the reserve answers 409
// version_conflict with the refreshed terms; the proposal is rejected with
// nothing held and the caller gets the refreshed terms — never a guess.
func TestAmendmentStaleWalletTermsRefused(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	f.trip(t, f.rider) // the execution's committed terms now exist
	if _, err := h.Pool.Exec(context.Background(),
		`UPDATE mp.execution_routes SET captured_commission_minor = captured_commission_minor - 500 WHERE award_id = $1`,
		f.award.ID); err != nil {
		t.Fatal(err)
	}
	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireCode(t, recorder, http.StatusConflict, domain.CodeVersionConflict)
	details := decode(t, recorder)["details"].(map[string]any)
	refreshed := details["refreshedTerms"].(map[string]any)["capturedTotalMinor"].(map[string]any)
	if int64(refreshed["amountMinor"].(float64)) != marketplace.CommissionMinor(f.amount) || details["reason"] != "wallet_terms_refreshed" {
		t.Fatalf("the refreshed wallet terms must reach the caller: %v", details)
	}
	if h.Wallet.OpenDeltas(f.reservation) != 0 || h.Funding.TopUpCalls != 0 || f.openMoneyRows(t) != 0 {
		t.Fatal("a stale-terms refusal holds nothing")
	}
}

// TestAmendmentMovesDropoffOnPlainTrip: a trip without stops can have its
// destination moved (amendments flag only); the committed dropoff reaches the
// execution ride itself.
func TestAmendmentMovesDropoffOnPlainTrip(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, nil)
	further := testutil.PlaceAt(testutil.DropoffFixture(), 1_500)
	recorder := f.propose(f.rider, map[string]any{
		"stops":                 []map[string]any{},
		"dropoff":               map[string]any{"lat": further.Lat, "lng": further.Lng, "label": "Office"},
		"expectedRouteRevision": 1,
		"expectedFareRevision":  1,
	}, "")
	requireStatus(t, recorder, http.StatusCreated)
	amendment := decode(t, recorder)
	if moneyMinor(t, amendment, "fareDeltaMinor") <= 0 || amendment["dropoff"].(map[string]any)["label"] != "Office" {
		t.Fatalf("a further dropoff must cost more and name the new place: %v", amendment)
	}
	requireStatus(t, f.decide(f.rider, amendment, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)
	requireStatus(t, f.decide(f.driver, amendment, "approve", ""), http.StatusOK)
	_, _, dropoffLat, _ := f.rideTerms(t)
	if dropoffLat != further.Lat || f.executionRoute(t).Dropoff.Lat != further.Lat {
		t.Fatalf("the committed dropoff must reach the ride: %f", dropoffLat)
	}
	assertMoneyReconciles(t, f, moneyMinor(t, amendment, "revisedFareMinor"))

	// Nothing to change is refused.
	same := f.propose(f.rider, map[string]any{
		"stops":                 []map[string]any{},
		"dropoff":               map[string]any{"lat": further.Lat, "lng": further.Lng},
		"expectedRouteRevision": 2,
		"expectedFareRevision":  2,
	}, "")
	requireCode(t, same, http.StatusUnprocessableEntity, domain.CodeValidationFailed)
}

// TestStopEventsNeedMultiStopFlag: stop events exist only on multi-stop
// trips behind marketplace_multi_stop; switching it off shuts them.
func TestStopEventsNeedMultiStopFlag(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	f.start(t)
	setFlagForCity(t, h, cityconfig.FlagMarketplaceMultiStop, false)
	requireCode(t, f.stopPost(f.driver, f.stops[0]["stopId"].(string), "arrive", map[string]any{}, ""),
		http.StatusNotFound, domain.CodeFeatureDisabled)
	plain := awardedTrip(t, h, nil)
	setFlagForCity(t, h, cityconfig.FlagMarketplaceMultiStop, true)
	requireCode(t, plain.stopPost(plain.driver, f.stops[0]["stopId"].(string), "arrive", map[string]any{}, ""),
		http.StatusNotFound, domain.CodeNotFound)
}

// TestOpenAmendmentClosesWhenTripEnds: a change still awaiting approvals when
// the trip ends never lands — completion expires it, releases what it
// reserved and settles the ORIGINAL agreed fare; a driver cancellation
// expires it too, and the award's reversal hands everything back.
func TestOpenAmendmentClosesWhenTripEnds(t *testing.T) {
	for _, ending := range []string{"completed", "driver_cancelled"} {
		t.Run(ending, func(t *testing.T) {
			h := amendHarness(t)
			f := awardedTrip(t, h, []map[string]any{firstStopInput()})
			if ending == "completed" {
				f.start(t)
			}
			recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
			requireStatus(t, recorder, http.StatusCreated)
			amendment := decode(t, recorder)
			requireStatus(t, f.decide(f.rider, amendment, "approve", ""), http.StatusOK)

			if ending == "completed" {
				f.complete(t)
				settled, ok := h.Settlement.Requests[f.award.ID]
				if !ok || settled.FareMinor.AmountMinor != f.amount {
					t.Fatalf("an uncommitted change must not reach the settlement: %+v", settled)
				}
			} else {
				requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideID.String()+"/cancel", f.driver,
					map[string]any{"reasonCode": "vehicle_issue"}), http.StatusOK)
				if award := awardRow(t, h, f.requestID); award.State != machine.MpAwardCancelled {
					t.Fatalf("a driver cancellation unwinds the award: %s", award.State)
				}
			}
			row := f.amendmentRow(t, amendment["amendmentId"].(string))
			if row.State != machine.MpAmendmentExpired || row.Reason != "execution_ended" || row.MoneyOpen {
				t.Fatalf("the open change must expire with the trip: %+v", row)
			}
			if h.Wallet.OpenDeltas(f.reservation) != 0 || h.Funding.OpenTopUps(f.award.ID) != 0 {
				t.Fatal("everything the open change reserved must be released")
			}
		})
	}
}
