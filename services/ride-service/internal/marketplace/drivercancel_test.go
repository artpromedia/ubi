package marketplace_test

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// currentExecution is a confirmed current-slot marketplace execution: the
// smallest fixture a driver-cancel test needs.
type currentExecution struct {
	rider, driver testutil.Actor
	requestID     string
	award         *marketplace.Award
	claim         *marketplace.Claim
	rideID        uuid.UUID
	reservationID string
}

// setupCurrentExecution publishes, bids, and selects a current-slot winner,
// leaving a driver_assigned execution ride managed by a confirmed award.
func setupCurrentExecution(t *testing.T, h *testutil.Harness) *currentExecution {
	t.Helper()
	f := &currentExecution{rider: h.Rider(), driver: h.Driver()}

	view, _ := publishAt(t, h, f.rider, 0)
	f.requestID = view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, f.driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, f.driver, f.requestID, amount)
	f.reservationID = bidView["reservationId"].(string)

	selected := doSelect(t, h, f.rider, f.requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)

	f.award = awardRow(t, h, f.requestID)
	if f.award.State != machine.MpAwardConfirmed {
		t.Fatalf("award state after selection: %s (%s)", f.award.State, selected.Body.String())
	}
	f.claim = claimRow(t, h, f.award.ID)
	if f.claim.State != machine.MpClaimCurrent || f.claim.ExecutionID == nil {
		t.Fatalf("claim after selection: %+v", f.claim)
	}
	f.rideID = *f.claim.ExecutionID
	return f
}

// driverCancel cancels the execution ride as its assigned driver.
func driverCancel(t *testing.T, h *testutil.Harness, f *currentExecution) {
	t.Helper()
	recorder := h.Do(http.MethodPost, "/rides/"+f.rideID.String()+"/cancel", f.driver,
		map[string]any{"reasonCode": "vehicle_issue"})
	requireStatus(t, recorder, http.StatusOK)
}

// eventPayloadField reads one field out of a single outbox event's payload.
func eventPayloadField(t *testing.T, h *testutil.Harness, name, aggregateID, field string) string {
	t.Helper()
	var value *string
	err := h.Pool.QueryRow(context.Background(),
		`SELECT payload->>$3 FROM public.outbox_events WHERE name = $1 AND aggregate_id = $2`,
		name, aggregateID, field).Scan(&value)
	if err != nil {
		t.Fatalf("failed to read %s payload of %s/%s: %v", field, name, aggregateID, err)
	}
	if value == nil {
		return ""
	}
	return *value
}

// TestDriverCancelMarketplaceRideTerminal: a driver cancellation of a
// marketplace-managed ride ends the ride in `cancelled_by_driver` — never
// `rematching` — and the terminal funnel releases the claim, cancels the
// award, reverses the captured commission and releases the rider's funding
// reservation, each exactly once, with no new dispatch and no new search.
func TestDriverCancelMarketplaceRideTerminal(t *testing.T) {
	h := newHarness(t)
	f := setupCurrentExecution(t, h)
	ctx := context.Background()

	driverCancel(t, h, f)

	// The ride is TERMINAL: no rematching, not active, driver freed.
	state, _, _, _, active := rideRow(t, h, f.rideID)
	if state != machine.RiderCancelledByDriver || active {
		t.Fatalf("ride after driver cancel: state=%s active=%v, want cancelled_by_driver inactive", state, active)
	}
	if got := eventPayloadField(t, h, "ride.cancelled_by_driver", f.rideID.String(), "terminal"); got != "true" {
		t.Fatalf("ride.cancelled_by_driver terminal payload: %q, want true", got)
	}
	session, err := h.Service.Store().Session(ctx, h.Pool, f.driver.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if session.State != machine.DriverAvailable {
		t.Fatalf("driver session after cancel: %s, want available", session.State)
	}

	// The claim is released and the award cancelled, via the observer.
	if got := claimByID(t, h, f.claim.ID).State; got != machine.MpClaimReleased {
		t.Fatalf("claim after driver cancel: %s, want released", got)
	}
	award := awardRow(t, h, f.requestID)
	if award.State != machine.MpAwardCancelled {
		t.Fatalf("award after driver cancel: %s, want cancelled", award.State)
	}
	if got := outboxCount(t, h, "mp.award.cancelled", f.award.ID.String()); got != 1 {
		t.Fatalf("mp.award.cancelled events: %d, want 1", got)
	}

	// The request stays in its terminal `execution` state but tells the
	// truth: the rider app renders the closeReason and only an explicit new
	// request starts a new search.
	request := requestRow(t, h, f.requestID)
	if request.State != machine.MpRequestExecution || request.CloseReason != "driver_cancelled" {
		t.Fatalf("request after driver cancel: state=%s closeReason=%q", request.State, request.CloseReason)
	}
	if got := outboxCount(t, h, "mp.request.closed", f.requestID); got != 1 {
		t.Fatalf("mp.request.closed events: %d, want 1", got)
	}

	// Money: the captured commission reversed exactly once, the rider
	// funding reservation released exactly once, with the linked reason.
	if got := h.Wallet.ReversalsByReservation[f.reservationID]; got != 1 {
		t.Fatalf("commission reversals: %d, want exactly 1", got)
	}
	if got := h.Wallet.CapturesByReservation[f.reservationID]; got != 1 {
		t.Fatalf("captures: %d, want still exactly 1", got)
	}
	if reason := h.Funding.ReleasedAwards[f.award.ID]; reason != "driver_cancelled" {
		t.Fatalf("funding release reason: %q, want driver_cancelled", reason)
	}
	if h.Funding.EffectiveReleases != 1 {
		t.Fatalf("effective funding releases: %d, want exactly 1", h.Funding.EffectiveReleases)
	}

	// NO new dispatch and NO new search: a dispatcher pass offers nothing,
	// and the requester still owns exactly the one request they published.
	if err := h.Service.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	var offers, requests int
	if err := h.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM ride.offers WHERE ride_id = $1`, f.rideID).Scan(&offers); err != nil {
		t.Fatal(err)
	}
	if offers != 0 {
		t.Fatalf("offers after a marketplace driver cancel: %d, want 0", offers)
	}
	if err := h.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM mp.requests WHERE requester_id = $1`, f.rider.UserID).Scan(&requests); err != nil {
		t.Fatal(err)
	}
	if requests != 1 {
		t.Fatalf("requests after a marketplace driver cancel: %d, want the original 1 only", requests)
	}

	// Replay and re-sweep converge without a second reversal or release.
	h.Marketplace.ExecutionTerminal(ctx, f.rideID)
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if got := h.Wallet.ReversalsByReservation[f.reservationID]; got != 1 {
		t.Fatalf("commission reversals after replay: %d, want still 1", got)
	}
	if h.Funding.EffectiveReleases != 1 {
		t.Fatalf("funding releases after replay: %d, want still 1", h.Funding.EffectiveReleases)
	}
	if got := outboxCount(t, h, "mp.award.cancelled", f.award.ID.String()); got != 1 {
		t.Fatalf("mp.award.cancelled events after replay: %d, want still 1", got)
	}
	var unresolved int
	if err := h.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM mp.reservation_recovery
		WHERE resolved_at IS NULL AND (reservation_id = $1 OR reservation_id = $2)`,
		f.reservationID, "mp.fund.release:"+f.award.ID.String()).Scan(&unresolved); err != nil {
		t.Fatal(err)
	}
	if unresolved != 0 {
		t.Fatalf("unresolved recovery rows after a confirmed unwind: %d, want 0", unresolved)
	}
}

// TestDriverCancelCrashBeforeObserverSweepConverges: the post-commit observer
// is a courtesy. With it gone (a crash between the terminal commit and the
// callback), the durable sweep alone converges the claim, the award, the
// commission and the rider funding — exactly once.
func TestDriverCancelCrashBeforeObserverSweepConverges(t *testing.T) {
	h := newHarness(t)
	f := setupCurrentExecution(t, h)
	ctx := context.Background()

	// Simulate the crash: no observer fires after the commit.
	h.Service.SetExecutionObserver(nil)
	driverCancel(t, h, f)

	state, _, _, _, active := rideRow(t, h, f.rideID)
	if state != machine.RiderCancelledByDriver || active {
		t.Fatalf("ride after driver cancel: state=%s active=%v", state, active)
	}
	if got := claimByID(t, h, f.claim.ID).State; got != machine.MpClaimCurrent {
		t.Fatalf("claim before the sweep: %s, want still current (nothing observed the commit)", got)
	}
	if got := h.Wallet.ReversalsByReservation[f.reservationID]; got != 0 {
		t.Fatalf("reversals before the sweep: %d, want 0", got)
	}

	// The sweep finds the current claim with a terminal execution and runs
	// the same funnel.
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if got := claimByID(t, h, f.claim.ID).State; got != machine.MpClaimReleased {
		t.Fatalf("claim after the sweep: %s, want released", got)
	}
	if got := awardRow(t, h, f.requestID).State; got != machine.MpAwardCancelled {
		t.Fatalf("award after the sweep: %s, want cancelled", got)
	}
	if got := h.Wallet.ReversalsByReservation[f.reservationID]; got != 1 {
		t.Fatalf("reversals after the sweep: %d, want exactly 1", got)
	}
	if reason := h.Funding.ReleasedAwards[f.award.ID]; reason != "driver_cancelled" {
		t.Fatalf("funding release reason after the sweep: %q, want driver_cancelled", reason)
	}

	// A second sweep changes nothing.
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if got := h.Wallet.ReversalsByReservation[f.reservationID]; got != 1 {
		t.Fatalf("reversals after a second sweep: %d, want still 1", got)
	}
	if h.Funding.EffectiveReleases != 1 {
		t.Fatalf("funding releases after a second sweep: %d, want still 1", h.Funding.EffectiveReleases)
	}
}

// TestDriverCancelWithQueuedNextPromotesWithoutSecondCommission: a driver who
// cancels their current marketplace ride still owes their queued job. The
// queued claim promotes through the existing promotion logic, revalidated
// from the driver's ACTUAL position — with the cancelled award reversed once,
// the queued award's commission never captured twice, and never a third
// commitment for the driver.
func TestDriverCancelWithQueuedNextPromotesWithoutSecondCommission(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	f := setupQueuedAward(t, h)
	ctx := context.Background()
	origin := testutil.PickupFixture()

	resA := bidRow(t, h, f.awardA.BidID.String()).ReservationID

	// The driver cancels the CURRENT trip.
	cancel := h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/cancel", f.driver,
		map[string]any{"reasonCode": "vehicle_issue"})
	requireStatus(t, cancel, http.StatusOK)

	state, _, _, _, active := rideRow(t, h, f.rideA)
	if state != machine.RiderCancelledByDriver || active {
		t.Fatalf("current ride after driver cancel: state=%s active=%v", state, active)
	}
	if got := claimByID(t, h, f.claimA.ID).State; got != machine.MpClaimReleased {
		t.Fatalf("current claim after driver cancel: %s, want released", got)
	}
	if got := awardRow(t, h, f.requestA).State; got != machine.MpAwardCancelled {
		t.Fatalf("cancelled award state: %s", got)
	}
	if got := h.Wallet.ReversalsByReservation[resA]; got != 1 {
		t.Fatalf("reversals for the cancelled award: %d, want exactly 1", got)
	}

	// The driver reports where they ACTUALLY are; the sweep promotes the
	// queued claim from that position, exactly once.
	ingestPoints(t, h, f.driver, []map[string]any{
		point(10, testutil.PlaceAt(origin, 200), h.Clock.Now().Add(-time.Second), 0),
	})
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}

	promoted := claimByID(t, h, f.claimB.ID)
	if promoted.State != machine.MpClaimCurrent || promoted.ExecutionID == nil {
		t.Fatalf("queued claim after the cancel: %+v, want promoted to current", promoted)
	}
	if got := outboxCount(t, h, "mp.claim.promoted", f.claimB.ID.String()); got != 1 {
		t.Fatalf("mp.claim.promoted events: %d, want exactly 1", got)
	}

	// NEVER a second commission for the queued job, NEVER a reversal of it,
	// and never a third commitment for the driver.
	if got := h.Wallet.CapturesByReservation[f.resB]; got != 1 {
		t.Fatalf("captures for the queued award: %d, want still exactly 1", got)
	}
	if got := h.Wallet.ReversalsByReservation[f.resB]; got != 0 {
		t.Fatalf("reversals for the queued award: %d, want 0", got)
	}
	var commitments int
	if err := h.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM mp.driver_claims
		WHERE driver_id = $1 AND state IN ('current', 'next')`, f.driver.UserID).Scan(&commitments); err != nil {
		t.Fatal(err)
	}
	if commitments != 1 {
		t.Fatalf("driver commitments after promotion: %d, want exactly the promoted 1", commitments)
	}

	// Idempotence: another sweep does not repeat anything.
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if got := h.Wallet.ReversalsByReservation[resA]; got != 1 {
		t.Fatalf("reversals for the cancelled award after re-sweep: %d, want still 1", got)
	}
	if got := outboxCount(t, h, "mp.claim.promoted", f.claimB.ID.String()); got != 1 {
		t.Fatalf("mp.claim.promoted events after re-sweep: %d, want still 1", got)
	}
}

// TestRiderAndDriverCancelRaceExactlyOneTerminalOutcome: a rider cancel and a
// driver cancel race on the same assigned marketplace ride. The row lock and
// the version guard let exactly one commit; the ride ends in exactly one
// terminal state, the claim is released once, and money moves at most once
// (only the driver-cancel outcome reverses the commission).
func TestRiderAndDriverCancelRaceExactlyOneTerminalOutcome(t *testing.T) {
	h := newHarness(t)
	f := setupCurrentExecution(t, h)
	ctx := context.Background()

	var wg sync.WaitGroup
	var riderCode, driverCode int
	wg.Add(2)
	go func() {
		defer wg.Done()
		recorder := h.Do(http.MethodPost, "/rides/"+f.rideID.String()+"/cancel", f.rider,
			map[string]any{"reasonCode": "changed_mind"})
		riderCode = recorder.Code
	}()
	go func() {
		defer wg.Done()
		recorder := h.Do(http.MethodPost, "/rides/"+f.rideID.String()+"/cancel", f.driver,
			map[string]any{"reasonCode": "vehicle_issue"})
		driverCode = recorder.Code
	}()
	wg.Wait()

	if (riderCode == http.StatusOK) == (driverCode == http.StatusOK) {
		t.Fatalf("exactly one cancellation must win: rider=%d driver=%d", riderCode, driverCode)
	}

	state, _, _, _, active := rideRow(t, h, f.rideID)
	if active {
		t.Fatalf("the ride must be terminal after the race, still active in %s", state)
	}
	switch {
	case riderCode == http.StatusOK && state != machine.RiderCancelledByRider:
		t.Fatalf("rider won but the ride is %s", state)
	case driverCode == http.StatusOK && state != machine.RiderCancelledByDriver:
		t.Fatalf("driver won but the ride is %s", state)
	}

	// Converge the post-commit work either way, then assert the invariants.
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if got := claimByID(t, h, f.claim.ID).State; got != machine.MpClaimReleased {
		t.Fatalf("claim after the race: %s, want released (never orphaned)", got)
	}
	wantReversals := 0
	if state == machine.RiderCancelledByDriver {
		wantReversals = 1
	}
	if got := h.Wallet.ReversalsByReservation[f.reservationID]; got != wantReversals {
		t.Fatalf("reversals after the race: %d, want %d", got, wantReversals)
	}
	if got := h.Wallet.CapturesByReservation[f.reservationID]; got != 1 {
		t.Fatalf("captures after the race: %d, want still exactly 1 (no duplicate fee)", got)
	}
	winner, loser := "ride.cancelled_by_rider", "ride.cancelled_by_driver"
	if state == machine.RiderCancelledByDriver {
		winner, loser = loser, winner
	}
	if got := outboxCount(t, h, winner, f.rideID.String()); got != 1 {
		t.Fatalf("%s events: %d, want 1", winner, got)
	}
	if got := outboxCount(t, h, loser, f.rideID.String()); got != 0 {
		t.Fatalf("%s events: %d, want 0 (the loser rolled back)", loser, got)
	}
}

// strandRide rewinds one marketplace execution ride into the pre-C04
// stranded shape: `rematching`, still active, driver detached and the driver
// session already freed — exactly what the old driver-cancel branch left.
func strandRide(t *testing.T, h *testutil.Harness, f *currentExecution) {
	t.Helper()
	ctx := context.Background()
	if _, err := h.Pool.Exec(ctx, `
		UPDATE ride.rides
		SET state = 'rematching', active = true, driver_id = NULL,
			cancelled_by_role = 'driver', cancel_reason_code = 'vehicle_issue'
		WHERE id = $1`, f.rideID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Pool.Exec(ctx, `
		UPDATE ride.driver_sessions SET state = 'available', current_ride_id = NULL
		WHERE driver_id = $1`, f.driver.UserID); err != nil {
		t.Fatal(err)
	}
}

// TestRepairStrandedRides: the admin repair lists stranded rides without
// writing (dry run), converges them through the same terminal funnel (apply),
// reports an already-repaired ride instead of double-acting, replays its
// idempotency key, and clamps its batch size.
func TestRepairStrandedRides(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	admin := testutil.Actor{UserID: uuid.New(), Role: move.RoleAdmin, CityID: h.CityID}

	first := setupCurrentExecution(t, h)
	second := setupCurrentExecution(t, h)
	strandRide(t, h, first)
	strandRide(t, h, second)

	// Dry run: both stranded rides listed with their award marks; nothing
	// written, nothing reversed. A limit of 1 caps the listing.
	dry := h.Do(http.MethodPost, "/admin/mp/repairs/stranded-rides", admin, map[string]any{"dryRun": true})
	requireStatus(t, dry, http.StatusOK)
	var dryResponse marketplace.RepairStrandedRidesResponse
	h.DecodeBody(dry, &dryResponse)
	if !dryResponse.DryRun || len(dryResponse.Stranded) != 2 {
		t.Fatalf("dry run: %+v, want both stranded rides listed", dryResponse)
	}
	for _, row := range dryResponse.Stranded {
		if row.AwardID == "" || row.CityID != h.CityID || row.StrandedSince.IsZero() {
			t.Fatalf("dry run row incomplete: %+v", row)
		}
	}
	capped := h.Do(http.MethodPost, "/admin/mp/repairs/stranded-rides", admin,
		map[string]any{"dryRun": true, "limit": 1})
	requireStatus(t, capped, http.StatusOK)
	var cappedResponse marketplace.RepairStrandedRidesResponse
	h.DecodeBody(capped, &cappedResponse)
	if len(cappedResponse.Stranded) != 1 {
		t.Fatalf("limited dry run listed %d rides, want 1", len(cappedResponse.Stranded))
	}
	oversized := h.Do(http.MethodPost, "/admin/mp/repairs/stranded-rides", admin,
		map[string]any{"dryRun": true, "limit": 100000})
	requireStatus(t, oversized, http.StatusOK)
	var oversizedResponse marketplace.RepairStrandedRidesResponse
	h.DecodeBody(oversized, &oversizedResponse)
	if oversizedResponse.Limit != 50 {
		t.Fatalf("oversized limit not clamped: %d, want the 50 cap", oversizedResponse.Limit)
	}
	if state, _, _, _, active := rideRow(t, h, first.rideID); state != machine.RiderRematching || !active {
		t.Fatalf("dry run mutated the ride: state=%s active=%v", state, active)
	}
	if h.Wallet.ReverseCalls != 0 || h.Funding.ReleaseCalls != 0 {
		t.Fatalf("dry run touched money: reversals=%d releases=%d", h.Wallet.ReverseCalls, h.Funding.ReleaseCalls)
	}

	// Only admins may run it.
	forbidden := h.Do(http.MethodPost, "/admin/mp/repairs/stranded-rides", first.rider, map[string]any{"dryRun": true})
	requireStatus(t, forbidden, http.StatusForbidden)

	// Apply: both rides converge through the same terminal funnel.
	key := idemKey()
	apply := h.Do(http.MethodPost, "/admin/mp/repairs/stranded-rides", admin,
		map[string]any{"dryRun": false}, move.IdempotencyHeader, key)
	requireStatus(t, apply, http.StatusOK)
	var applied marketplace.RepairStrandedRidesResponse
	h.DecodeBody(apply, &applied)
	if len(applied.Results) != 2 {
		t.Fatalf("apply results: %+v, want 2", applied.Results)
	}
	for _, result := range applied.Results {
		if result.Outcome != marketplace.RepairOutcomeRepaired {
			t.Fatalf("apply outcome for %s: %+v", result.RideID, result)
		}
	}
	for _, f := range []*currentExecution{first, second} {
		state, _, _, _, active := rideRow(t, h, f.rideID)
		if state != machine.RiderCancelledByDriver || active {
			t.Fatalf("repaired ride %s: state=%s active=%v", f.rideID, state, active)
		}
		if got := claimByID(t, h, f.claim.ID).State; got != machine.MpClaimReleased {
			t.Fatalf("repaired claim: %s, want released", got)
		}
		if got := awardRow(t, h, f.requestID).State; got != machine.MpAwardCancelled {
			t.Fatalf("repaired award: %s, want cancelled", got)
		}
		if got := h.Wallet.ReversalsByReservation[f.reservationID]; got != 1 {
			t.Fatalf("repaired reversals: %d, want exactly 1", got)
		}
		if reason := h.Funding.ReleasedAwards[f.award.ID]; reason != "driver_cancelled" {
			t.Fatalf("repaired funding release reason: %q", reason)
		}
		if request := requestRow(t, h, f.requestID); request.CloseReason != "driver_cancelled" {
			t.Fatalf("repaired request closeReason: %q", request.CloseReason)
		}
	}
	var audits int
	if err := h.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM public.audit_log
		WHERE action = 'mp.repair.stranded_ride' AND subject_id = ANY($1)`,
		[]string{first.rideID.String(), second.rideID.String()}).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 2 {
		t.Fatalf("repair audit rows: %d, want one per ride", audits)
	}

	// Replaying the SAME key answers the recorded response without
	// re-scanning; a FRESH apply naming the ride reports it as already
	// repaired; neither moves money again.
	replay := h.Do(http.MethodPost, "/admin/mp/repairs/stranded-rides", admin,
		map[string]any{"dryRun": false}, move.IdempotencyHeader, key)
	requireStatus(t, replay, http.StatusOK)
	var replayed marketplace.RepairStrandedRidesResponse
	h.DecodeBody(replay, &replayed)
	if len(replayed.Results) != 2 {
		t.Fatalf("replayed results: %+v", replayed.Results)
	}
	again := h.Do(http.MethodPost, "/admin/mp/repairs/stranded-rides", admin,
		map[string]any{"dryRun": false, "rideIds": []string{first.rideID.String()}},
		move.IdempotencyHeader, idemKey())
	requireStatus(t, again, http.StatusOK)
	var againResponse marketplace.RepairStrandedRidesResponse
	h.DecodeBody(again, &againResponse)
	if len(againResponse.Results) != 1 || againResponse.Results[0].Outcome != marketplace.RepairOutcomeNotStranded {
		t.Fatalf("second apply: %+v, want the ride reported as not stranded", againResponse.Results)
	}
	if got := h.Wallet.ReversalsByReservation[first.reservationID]; got != 1 {
		t.Fatalf("reversals after replays: %d, want still 1", got)
	}
	if h.Funding.EffectiveReleases != 2 {
		t.Fatalf("funding releases after replays: %d, want still one per award", h.Funding.EffectiveReleases)
	}
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if got := h.Wallet.ReversalsByReservation[first.reservationID]; got != 1 {
		t.Fatalf("reversals after the sweep: %d, want still 1", got)
	}
}
