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

// fixedOffPeakHour pins the harness clock to a 1.0 traffic multiplier so the
// straight-line router's ETAs are the same on every run.
var fixedOffPeakHour = time.Date(2026, 3, 4, 10, 0, 0, 0, time.UTC)

// claimByID re-reads one claim.
func claimByID(t *testing.T, h *testutil.Harness, id uuid.UUID) *marketplace.Claim {
	t.Helper()
	claim, err := h.Marketplace.Store().ClaimByID(context.Background(), h.Marketplace.Store().Pool(), id)
	if err != nil {
		t.Fatalf("failed to read claim %s: %v", id, err)
	}
	return claim
}

// queuedFixture is a driver with a CURRENT execution (request A) and a
// consented, confirmed QUEUED award behind it (request B).
type queuedFixture struct {
	riderA, riderB, driver testutil.Actor
	requestA, requestB     string
	awardA, awardB         *marketplace.Award
	claimA, claimB         *marketplace.Claim
	rideA                  uuid.UUID
	pinA                   string
	resB                   string
	amountB                int64
}

// setupQueuedAward builds the standard geometry: trip A runs origin → 3 km
// north, the driver is parked at the origin, and request B picks up 4 km
// north (1 km past A's dropoff, along the corridor).
func setupQueuedAward(t *testing.T, h *testutil.Harness) *queuedFixture {
	t.Helper()
	h.Clock.Set(fixedOffPeakHour)
	origin := testutil.PickupFixture()

	f := &queuedFixture{riderA: h.Rider(), riderB: h.Rider(), driver: h.Driver()}

	// Request A: published, bid on, selected — the driver's current job.
	viewA, _ := publishRoute(t, h, f.riderA, origin, testutil.PlaceAt(origin, 3_000), 0)
	f.requestA = viewA["requestId"].(string)
	amountA := moneyMinor(t, viewA, "minimumFareMinor")
	parkDriver(t, h, f.driver, origin)
	bidA := fundedCurrentBid(t, h, f.driver, f.requestA, amountA)
	selected := doSelect(t, h, f.riderA, f.requestA, map[string]any{
		"bidId": bidA["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	f.pinA, _ = decode(t, selected)["pickupPin"].(string)
	f.awardA = awardRow(t, h, f.requestA)
	f.claimA = claimRow(t, h, f.awardA.ID)
	if f.claimA.ExecutionID == nil {
		t.Fatal("the current award has no execution ride")
	}
	f.rideA = *f.claimA.ExecutionID

	// Request B: a finishing-trip (next slot) bid, selected under consent to
	// the recomputed pickup window.
	viewB, _ := publishRoute(t, h, f.riderB, testutil.PlaceAt(origin, 4_000), testutil.PlaceAt(origin, 9_000), 0)
	f.requestB = viewB["requestId"].(string)
	f.amountB = moneyMinor(t, viewB, "minimumFareMinor")

	eligibility := evaluate(t, h, f.driver, f.requestB)
	if !eligibility.Eligible || eligibility.Slot == nil || *eligibility.Slot != "next" {
		t.Fatalf("the driver must qualify for the next slot: %+v", eligibility.Reasons)
	}
	queued := h.Do(http.MethodPost, "/mp/bids", f.driver, map[string]any{
		"requestId":         f.requestB,
		"requestRevision":   1,
		"amountMinor":       moneyBody(f.amountB),
		"slot":              "next",
		"dependsOnClaimId":  f.claimA.ID.String(),
		"availabilityEpoch": eligibility.AvailabilityEpoch,
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, queued, http.StatusCreated)
	bidB := decode(t, queued)
	f.resB = bidB["reservationId"].(string)

	// Selecting without consent answers the current window for confirmation.
	unconsented := doSelect(t, h, f.riderB, f.requestB, map[string]any{
		"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireCode(t, unconsented, http.StatusConflict, domain.CodeVersionConflict)
	details := decode(t, unconsented)["details"].(map[string]any)
	window := details["pickupWindow"].(map[string]any)
	etaVersion := int(window["etaVersion"].(float64))

	consented := doSelect(t, h, f.riderB, f.requestB, map[string]any{
		"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1,
		"pickupWindowConsent": map[string]any{"etaVersion": etaVersion, "accepted": true},
	}, "")
	requireStatus(t, consented, http.StatusAccepted)

	f.awardB = awardRow(t, h, f.requestB)
	if f.awardB.State != machine.MpAwardConfirmed {
		t.Fatalf("queued award state: %s (%s)", f.awardB.State, consented.Body.String())
	}
	if f.awardB.ExecutionID != nil {
		t.Fatal("a queued award must NOT create an execution ride at selection")
	}
	if f.awardB.PickupWindow == nil || f.awardB.PickupWindow.ConsentedLatestSec == 0 {
		t.Fatalf("queued award window: %+v", f.awardB.PickupWindow)
	}
	f.claimB = claimRow(t, h, f.awardB.ID)
	if f.claimB.State != machine.MpClaimNext || f.claimB.Slot != "next" {
		t.Fatalf("queued claim: %+v", f.claimB)
	}
	if request := requestRow(t, h, f.requestB); request.State != machine.MpRequestAwarded {
		t.Fatalf("queued request state: %s, want awarded", request.State)
	}
	if h.Wallet.CapturesByReservation[f.resB] != 1 {
		t.Fatalf("queued captures: %d, want 1 (captured at selection)", h.Wallet.CapturesByReservation[f.resB])
	}
	return f
}

// TestPromotionAfterCompletion: real completion of the current trip promotes
// the queued claim exactly once — execution ride created, fencing token
// bumped, and NO second commission.
func TestPromotionAfterCompletion(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	f := setupQueuedAward(t, h)

	// Drive trip A through its real lifecycle with the PIN the selection
	// answered once.
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/arrived", f.driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/verify-pin", f.driver, map[string]any{"pin": f.pinA}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/start", f.driver, map[string]any{}), http.StatusOK)
	preFencing := f.claimB.FencingToken

	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/complete", f.driver, map[string]any{}), http.StatusOK)

	// The completion callback settled the current claim and promoted the next.
	if got := claimByID(t, h, f.claimA.ID).State; got != machine.MpClaimCompleted {
		t.Fatalf("current claim after completion: %s, want completed", got)
	}
	promoted := claimByID(t, h, f.claimB.ID)
	if promoted.State != machine.MpClaimCurrent || promoted.Slot != "current" {
		t.Fatalf("queued claim after completion: %+v, want promoted to current", promoted)
	}
	if promoted.FencingToken <= preFencing {
		t.Fatalf("fencing token must bump on promotion: %d -> %d", preFencing, promoted.FencingToken)
	}
	if promoted.ExecutionID == nil {
		t.Fatal("the promoted claim has no execution ride")
	}

	state, rideDriver, fare, awardMark, active := rideRow(t, h, *promoted.ExecutionID)
	if state != machine.RiderDriverAssigned || !active || rideDriver == nil || *rideDriver != f.driver.UserID {
		t.Fatalf("promoted execution ride: state=%s active=%v driver=%v", state, active, rideDriver)
	}
	if fare != f.amountB {
		t.Fatalf("promoted fare: got %d, want the queued bid amount %d", fare, f.amountB)
	}
	if awardMark == nil || *awardMark != f.awardB.ID {
		t.Fatalf("promoted ride award mark: %v", awardMark)
	}
	if request := requestRow(t, h, f.requestB); request.State != machine.MpRequestExecution {
		t.Fatalf("queued request after promotion: %s, want execution", request.State)
	}
	session, err := h.Service.Store().Session(context.Background(), h.Pool, f.driver.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if session.State != machine.DriverNavigatingToPickup || session.CurrentRideID == nil || *session.CurrentRideID != *promoted.ExecutionID {
		t.Fatalf("driver session after promotion: %s ride=%v", session.State, session.CurrentRideID)
	}

	// NO second commission: still exactly one capture for the queued hold,
	// and nothing reversed.
	if h.Wallet.CapturesByReservation[f.resB] != 1 {
		t.Fatalf("captures after promotion: %d, want still 1", h.Wallet.CapturesByReservation[f.resB])
	}
	if h.Wallet.ReverseCalls != 0 {
		t.Fatalf("reversals after promotion: %d, want 0", h.Wallet.ReverseCalls)
	}
	if got := outboxCount(t, h, "mp.claim.promoted", f.claimB.ID.String()); got != 1 {
		t.Fatalf("mp.claim.promoted events: %d", got)
	}

	// Idempotence: another sweep changes nothing and creates no second ride.
	_ = h.Marketplace.Sweep(context.Background())
	var rides int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM ride.rides WHERE rider_id = $1`, f.riderB.UserID).Scan(&rides); err != nil {
		t.Fatal(err)
	}
	if rides != 1 {
		t.Fatalf("rides for the queued requester: %d, want exactly 1", rides)
	}
	if got := outboxCount(t, h, "mp.claim.promoted", f.claimB.ID.String()); got != 1 {
		t.Fatalf("mp.claim.promoted events after re-sweep: %d", got)
	}
}

// TestPromotionRevalidatesFromActualLocationAndYieldsToFreshAward: an
// early-cancelled current trip promotes from the driver's ACTUAL position
// (never the original destination), and a fresh award racing into the freed
// slot leaves exactly one owner — the partial uniques and the fencing token
// decide.
func TestPromotionRevalidatesFromActualLocationAndYieldsToFreshAward(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	f := setupQueuedAward(t, h)
	origin := testutil.PickupFixture()
	consentedPredicted := f.awardB.PickupWindow.PredictedSec

	// The current trip is cancelled early, while the driver's last fix is too
	// old to promote on: the claim is released, the promotion honestly waits.
	h.Clock.Advance(3 * time.Minute)
	cancel := h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/cancel", f.riderA, map[string]any{"reasonCode": ""})
	requireStatus(t, cancel, http.StatusOK)
	if got := claimByID(t, h, f.claimA.ID).State; got != machine.MpClaimReleased {
		t.Fatalf("current claim after early cancel: %s, want released", got)
	}
	if got := claimByID(t, h, f.claimB.ID).State; got != machine.MpClaimNext {
		t.Fatalf("queued claim must survive the current cancel: %s", got)
	}

	// A fresh award races into the freed slot (its claim row, as the saga's
	// first transaction writes it).
	interloper := uuid.New()
	if _, err := h.Pool.Exec(context.Background(), `
		INSERT INTO mp.driver_claims (id, driver_id, state, slot, service)
		VALUES ($1, $2, 'current', 'current', 'ride')`, interloper, f.driver.UserID); err != nil {
		t.Fatal(err)
	}

	// The driver reports where they ACTUALLY are: near the origin, nowhere
	// near trip A's planned dropoff.
	ingestPoints(t, h, f.driver, []map[string]any{
		point(10, testutil.PlaceAt(origin, 200), h.Clock.Now().Add(-time.Second), 0),
	})

	// The sweep tries to promote and yields: one owner of the current slot.
	_ = h.Marketplace.Sweep(context.Background())
	if got := claimByID(t, h, f.claimB.ID).State; got != machine.MpClaimNext {
		t.Fatalf("promotion must yield to the occupied slot: claim is %s", got)
	}
	var currentClaims int
	if err := h.Pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM mp.driver_claims WHERE driver_id = $1 AND state = 'current'`,
		f.driver.UserID).Scan(&currentClaims); err != nil {
		t.Fatal(err)
	}
	if currentClaims != 1 {
		t.Fatalf("current claims while racing: %d, want exactly 1", currentClaims)
	}

	// The interloper finishes; the next sweep promotes, exactly once, with a
	// window recomputed from the actual position.
	if _, err := h.Pool.Exec(context.Background(),
		`UPDATE mp.driver_claims SET state = 'released' WHERE id = $1`, interloper); err != nil {
		t.Fatal(err)
	}
	_ = h.Marketplace.Sweep(context.Background())

	promoted := claimByID(t, h, f.claimB.ID)
	if promoted.State != machine.MpClaimCurrent || promoted.ExecutionID == nil {
		t.Fatalf("queued claim after the slot freed: %+v", promoted)
	}
	if promoted.FencingToken <= f.claimB.FencingToken {
		t.Fatalf("fencing token must bump on promotion: %d -> %d", f.claimB.FencingToken, promoted.FencingToken)
	}
	award := awardRow(t, h, f.requestB)
	if award.PickupWindow.PredictedSec >= consentedPredicted {
		t.Fatalf("the window must be recomputed from the ACTUAL position: %d (was %d from the abandoned route)",
			award.PickupWindow.PredictedSec, consentedPredicted)
	}
	if h.Wallet.CapturesByReservation[f.resB] != 1 {
		t.Fatalf("captures after promotion: %d, want still 1", h.Wallet.CapturesByReservation[f.resB])
	}
}

// TestQueuedWindowMissedAllowsFeeFreeCancel: the queue sweep keeps the window
// honest, emits window_missed exactly once, and the owner's cancel reverses
// the captured fee exactly once — without ever touching the current job.
func TestQueuedWindowMissedAllowsFeeFreeCancel(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	f := setupQueuedAward(t, h)
	origin := testutil.PickupFixture()

	// A queued job whose window still stands cannot be cancelled fee-free.
	early := h.Do(http.MethodPost, "/mp/requests/"+f.requestB+"/cancel", f.riderB, nil,
		move.IdempotencyHeader, idemKey())
	requireCode(t, early, http.StatusConflict, domain.CodeRequestClosed)

	// The current trip drags 10 km the wrong way: the recomputed window blows
	// past what was consented.
	h.Clock.Advance(4 * time.Minute)
	ingestPoints(t, h, f.driver, []map[string]any{
		point(10, testutil.PlaceAt(origin, -10_000), h.Clock.Now().Add(-time.Second), 20),
	})
	_ = h.Marketplace.Sweep(context.Background())

	award := awardRow(t, h, f.requestB)
	if award.PickupWindow == nil || !award.PickupWindow.MissedEmitted {
		t.Fatalf("the missed window was not recorded: %+v", award.PickupWindow)
	}
	if got := outboxCount(t, h, "mp.queue.window_missed", f.awardB.ID.String()); got != 1 {
		t.Fatalf("mp.queue.window_missed events: %d, want exactly 1", got)
	}
	// A second sweep does not repeat the missed event.
	_ = h.Marketplace.Sweep(context.Background())
	if got := outboxCount(t, h, "mp.queue.window_missed", f.awardB.ID.String()); got != 1 {
		t.Fatalf("mp.queue.window_missed events after re-sweep: %d", got)
	}

	// Fee-free exit: award cancelled, claim released, request closed, and the
	// captured commission reversed exactly once with a linked entry.
	key := idemKey()
	cancel := h.Do(http.MethodPost, "/mp/requests/"+f.requestB+"/cancel", f.riderB, nil,
		move.IdempotencyHeader, key)
	requireStatus(t, cancel, http.StatusOK)

	award = awardRow(t, h, f.requestB)
	if award.State != machine.MpAwardCancelled {
		t.Fatalf("award after cancel: %s", award.State)
	}
	if got := claimByID(t, h, f.claimB.ID).State; got != machine.MpClaimReleased {
		t.Fatalf("claim after cancel: %s", got)
	}
	if request := requestRow(t, h, f.requestB); request.State != machine.MpRequestCancelled {
		t.Fatalf("request after cancel: %s", request.State)
	}
	if h.Wallet.ReversalsByReservation[f.resB] != 1 {
		t.Fatalf("fee reversals: %d, want exactly 1", h.Wallet.ReversalsByReservation[f.resB])
	}
	if got := outboxCount(t, h, "mp.award.cancelled", f.awardB.ID.String()); got != 1 {
		t.Fatalf("mp.award.cancelled events: %d", got)
	}

	// Cancelling the NEXT job never touches the CURRENT job.
	if got := claimByID(t, h, f.claimA.ID).State; got != machine.MpClaimCurrent {
		t.Fatalf("current claim after next-cancel: %s, want untouched", got)
	}
	if state, _, _, _, active := rideRow(t, h, f.rideA); state != machine.RiderDriverAssigned || !active {
		t.Fatalf("current ride after next-cancel: %s active=%v", state, active)
	}

	// Replay converges; a fresh key answers request_closed; the reversal
	// stays at one either way.
	replay := h.Do(http.MethodPost, "/mp/requests/"+f.requestB+"/cancel", f.riderB, nil,
		move.IdempotencyHeader, key)
	requireStatus(t, replay, http.StatusOK)
	again := h.Do(http.MethodPost, "/mp/requests/"+f.requestB+"/cancel", f.riderB, nil,
		move.IdempotencyHeader, idemKey())
	requireCode(t, again, http.StatusConflict, domain.CodeRequestClosed)
	if h.Wallet.ReversalsByReservation[f.resB] != 1 {
		t.Fatalf("fee reversals after replays: %d, want still 1", h.Wallet.ReversalsByReservation[f.resB])
	}
	_ = h.Marketplace.Sweep(context.Background())
	if h.Wallet.ReversalsByReservation[f.resB] != 1 {
		t.Fatalf("fee reversals after sweep: %d, want still 1", h.Wallet.ReversalsByReservation[f.resB])
	}
}

// TestSelectWorsenedWindowForcesReconfirmation: a window that materially
// worsened between the offer card and the selection answers the refreshed
// window and starts no award until the owner re-consents.
func TestSelectWorsenedWindowForcesReconfirmation(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	h.Clock.Set(fixedOffPeakHour)
	origin := testutil.PickupFixture()
	riderA, riderB, driver := h.Rider(), h.Rider(), h.Driver()

	// Current job A and a live queued bid on B.
	viewA, _ := publishRoute(t, h, riderA, origin, testutil.PlaceAt(origin, 3_000), 0)
	parkDriver(t, h, driver, origin)
	bidA := fundedCurrentBid(t, h, driver, viewA["requestId"].(string), moneyMinor(t, viewA, "minimumFareMinor"))
	requireStatus(t, doSelect(t, h, riderA, viewA["requestId"].(string), map[string]any{
		"bidId": bidA["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, ""), http.StatusAccepted)
	claimA := claimRow(t, h, awardRow(t, h, viewA["requestId"].(string)).ID)

	viewB, _ := publishRoute(t, h, riderB, testutil.PlaceAt(origin, 4_000), testutil.PlaceAt(origin, 9_000), 0)
	requestB := viewB["requestId"].(string)
	eligibility := evaluate(t, h, driver, requestB)
	if !eligibility.Eligible {
		t.Fatalf("driver must be next-slot eligible: %+v", eligibility.Reasons)
	}
	queued := h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId": requestB, "requestRevision": 1,
		"amountMinor": moneyBody(moneyMinor(t, viewB, "minimumFareMinor")),
		"slot":        "next", "dependsOnClaimId": claimA.ID.String(),
		"availabilityEpoch": eligibility.AvailabilityEpoch,
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, queued, http.StatusCreated)
	bidB := decode(t, queued)

	// The window the owner first saw.
	first := doSelect(t, h, riderB, requestB, map[string]any{
		"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireCode(t, first, http.StatusConflict, domain.CodeVersionConflict)
	firstWindow := decode(t, first)["details"].(map[string]any)["pickupWindow"].(map[string]any)
	staleVersion := int(firstWindow["etaVersion"].(float64))

	// The trip worsens materially before the owner confirms.
	h.Clock.Advance(4 * time.Minute)
	ingestPoints(t, h, driver, []map[string]any{
		point(10, testutil.PlaceAt(origin, -10_000), h.Clock.Now().Add(-time.Second), 20),
	})

	// Consent to the OLD window is refused with the refreshed one; no award
	// was started.
	stale := doSelect(t, h, riderB, requestB, map[string]any{
		"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1,
		"pickupWindowConsent": map[string]any{"etaVersion": staleVersion, "accepted": true},
	}, "")
	requireCode(t, stale, http.StatusConflict, domain.CodeVersionConflict)
	refreshed := decode(t, stale)["details"].(map[string]any)["pickupWindow"].(map[string]any)
	freshVersion := int(refreshed["etaVersion"].(float64))
	if freshVersion == staleVersion {
		t.Fatalf("a materially worsened window must carry a new etaVersion: %d", freshVersion)
	}
	if _, err := h.Marketplace.Store().LatestAwardForRequest(context.Background(),
		h.Marketplace.Store().Pool(), uuid.MustParse(requestB)); err == nil {
		t.Fatal("no award may start before the window is reconfirmed")
	}

	// Consent to the CURRENT window proceeds.
	confirmed := doSelect(t, h, riderB, requestB, map[string]any{
		"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1,
		"pickupWindowConsent": map[string]any{"etaVersion": freshVersion, "accepted": true},
	}, "")
	requireStatus(t, confirmed, http.StatusAccepted)
	if award := awardRow(t, h, requestB); award.State != machine.MpAwardConfirmed {
		t.Fatalf("award after reconfirmation: %s", award.State)
	}
}

// TestQueuedDriverOfflineRecovery: a driver who goes offline holding a queued
// claim triggers the same reversal path, sweep-driven, never silent.
func TestQueuedDriverOfflineRecovery(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	f := setupQueuedAward(t, h)

	// The current trip ends early; the stale fix defers promotion, so the
	// queued claim is still `next` when the driver walks away.
	h.Clock.Advance(3 * time.Minute)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/cancel", f.riderA,
		map[string]any{"reasonCode": ""}), http.StatusOK)
	if got := claimByID(t, h, f.claimB.ID).State; got != machine.MpClaimNext {
		t.Fatalf("queued claim: %s, want still next", got)
	}
	offline := h.Do(http.MethodPost, "/drivers/me/status", f.driver, map[string]any{
		"online": false, "filters": map[string]any{"vehicleClasses": []string{"go"}},
	})
	requireStatus(t, offline, http.StatusOK)

	_ = h.Marketplace.Sweep(context.Background())

	award := awardRow(t, h, f.requestB)
	if award.State != machine.MpAwardCancelled {
		t.Fatalf("award after driver went offline: %s, want cancelled", award.State)
	}
	if got := claimByID(t, h, f.claimB.ID).State; got != machine.MpClaimReleased {
		t.Fatalf("queued claim after recovery: %s, want released", got)
	}
	if request := requestRow(t, h, f.requestB); request.State != machine.MpRequestCancelled {
		t.Fatalf("queued request after recovery: %s, want cancelled", request.State)
	}
	if h.Wallet.ReversalsByReservation[f.resB] != 1 {
		t.Fatalf("fee reversals: %d, want exactly 1", h.Wallet.ReversalsByReservation[f.resB])
	}
	// Re-sweeping never doubles the reversal.
	_ = h.Marketplace.Sweep(context.Background())
	if h.Wallet.ReversalsByReservation[f.resB] != 1 {
		t.Fatalf("fee reversals after re-sweep: %d, want still 1", h.Wallet.ReversalsByReservation[f.resB])
	}
}
