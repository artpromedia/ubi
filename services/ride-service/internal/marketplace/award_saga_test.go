package marketplace_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// doSelect posts a selection for a request.
func doSelect(t *testing.T, h *testutil.Harness, rider testutil.Actor, requestID string, body map[string]any, key string) *httptest.ResponseRecorder {
	t.Helper()
	if key == "" {
		key = idemKey()
	}
	return h.Do(http.MethodPost, "/mp/requests/"+requestID+"/select", rider, body, move.IdempotencyHeader, key)
}

// awardRow reads a request's latest award straight from the store.
func awardRow(t *testing.T, h *testutil.Harness, requestID string) *marketplace.Award {
	t.Helper()
	id, err := uuid.Parse(requestID)
	if err != nil {
		t.Fatalf("bad request id %q: %v", requestID, err)
	}
	award, err := h.Marketplace.Store().LatestAwardForRequest(context.Background(), h.Marketplace.Store().Pool(), id)
	if err != nil {
		t.Fatalf("failed to read award for request %s: %v", requestID, err)
	}
	return award
}

// claimRow reads the claim an award created.
func claimRow(t *testing.T, h *testutil.Harness, awardID uuid.UUID) *marketplace.Claim {
	t.Helper()
	claim, err := h.Marketplace.Store().ClaimByAwardID(context.Background(), h.Marketplace.Store().Pool(), awardID)
	if err != nil {
		t.Fatalf("failed to read claim for award %s: %v", awardID, err)
	}
	return claim
}

// rideRow reads the execution ride's core columns.
func rideRow(t *testing.T, h *testutil.Harness, rideID uuid.UUID) (state string, driverID *uuid.UUID, fareMinor int64, awardID *uuid.UUID, active bool) {
	t.Helper()
	err := h.Pool.QueryRow(context.Background(), `
		SELECT state, driver_id, quoted_fare_minor, marketplace_award_id, active
		FROM ride.rides WHERE id = $1`, rideID).Scan(&state, &driverID, &fareMinor, &awardID, &active)
	if err != nil {
		t.Fatalf("failed to read ride %s: %v", rideID, err)
	}
	return
}

// outboxCount counts outbox rows by name and aggregate.
func outboxCount(t *testing.T, h *testutil.Harness, name, aggregateID string) int {
	t.Helper()
	var count int
	err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM public.outbox_events WHERE name = $1 AND aggregate_id = $2`,
		name, aggregateID).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}
	return count
}

// fundedCurrentBid parks the driver at the pickup and places a funded
// current-slot bid, returning the decoded bid view.
func fundedCurrentBid(t *testing.T, h *testutil.Harness, driver testutil.Actor, requestID string, amount int64) map[string]any {
	t.Helper()
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	recorder := submitBid(t, h, driver, requestID, amount, "")
	requireStatus(t, recorder, http.StatusCreated)
	return decode(t, recorder)
}

// TestSelectCurrentSlotHappyPath: selection claims request + capacity, funds,
// captures exactly once under the award id, creates the execution ride through
// the move machinery, resolves the award, and replays idempotently without
// restating the PIN.
func TestSelectCurrentSlotHappyPath(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)
	reservationID := bidView["reservationId"].(string)

	key := idemKey()
	body := map[string]any{"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1}
	recorder := doSelect(t, h, rider, requestID, body, key)
	requireStatus(t, recorder, http.StatusAccepted)
	result := decode(t, recorder)

	awardBody, ok := result["award"].(map[string]any)
	if !ok {
		t.Fatalf("no award in the selection answer: %v", result)
	}
	if awardBody["state"] != machine.MpAwardConfirmed {
		t.Fatalf("award state: got %v, want confirmed (%s)", awardBody["state"], recorder.Body.String())
	}
	pin, _ := result["pickupPin"].(string)
	if len(pin) != 4 {
		t.Fatalf("the owner must receive the 4-digit pickup PIN once, got %q", pin)
	}

	award := awardRow(t, h, requestID)
	if award.State != machine.MpAwardConfirmed || award.CaptureReceiptID == "" {
		t.Fatalf("award: %+v, want confirmed with a capture receipt", award)
	}
	if award.FareMinor != amount || award.CommissionMinor != marketplace.CommissionMinor(amount) {
		t.Fatalf("award money: fare %d commission %d", award.FareMinor, award.CommissionMinor)
	}
	if h.Wallet.CapturesByReservation[reservationID] != 1 {
		t.Fatalf("captures: got %d, want exactly 1", h.Wallet.CapturesByReservation[reservationID])
	}
	if h.Funding.EffectiveCalls != 1 {
		t.Fatalf("funding authorizations: got %d, want 1", h.Funding.EffectiveCalls)
	}

	// Bid won, request in execution, claim current with the execution ride.
	if bid := bidRow(t, h, bidView["bidId"].(string)); bid.State != machine.MpBidWon {
		t.Fatalf("winning bid state: %s", bid.State)
	}
	if request := requestRow(t, h, requestID); request.State != machine.MpRequestExecution {
		t.Fatalf("request state: %s, want execution", request.State)
	}
	claim := claimRow(t, h, award.ID)
	if claim.State != machine.MpClaimCurrent || claim.Slot != "current" || claim.ExecutionID == nil {
		t.Fatalf("claim: %+v, want current with an execution", claim)
	}
	if award.ExecutionID == nil || *award.ExecutionID != *claim.ExecutionID {
		t.Fatalf("award execution %v does not match claim execution %v", award.ExecutionID, claim.ExecutionID)
	}

	// The execution ride: driver assigned, agreed fare = bid amount, marked
	// as marketplace-managed.
	state, rideDriver, fare, rideAward, active := rideRow(t, h, *claim.ExecutionID)
	if state != machine.RiderDriverAssigned || !active {
		t.Fatalf("execution ride state: %s active=%v", state, active)
	}
	if rideDriver == nil || *rideDriver != driver.UserID {
		t.Fatalf("execution ride driver: %v", rideDriver)
	}
	if fare != amount {
		t.Fatalf("execution fare: got %d, want the bid amount %d", fare, amount)
	}
	if rideAward == nil || *rideAward != award.ID {
		t.Fatalf("execution ride award mark: %v", rideAward)
	}

	// Driver session walked to navigating_to_pickup.
	session, err := h.Service.Store().Session(context.Background(), h.Pool, driver.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if session.State != machine.DriverNavigatingToPickup || session.CurrentRideID == nil {
		t.Fatalf("driver session: %s ride=%v", session.State, session.CurrentRideID)
	}

	// Events committed with the transitions.
	if got := outboxCount(t, h, "mp.award.confirmed", award.ID.String()); got != 1 {
		t.Fatalf("mp.award.confirmed events: %d", got)
	}
	if got := outboxCount(t, h, "ride.assigned", claim.ExecutionID.String()); got != 1 {
		t.Fatalf("ride.assigned events: %d", got)
	}

	// Idempotent replay: same key, same body, no PIN restated.
	replay := doSelect(t, h, rider, requestID, body, key)
	requireStatus(t, replay, http.StatusAccepted)
	replayed := decode(t, replay)
	if _, hasPin := replayed["pickupPin"]; hasPin {
		t.Fatalf("a replay must not restate the pickup PIN: %v", replayed)
	}
}

// TestSelectStaleVersionsNeverAwardStaleTerms: a selection pinning versions
// that were revised in between answers version_conflict with the refreshed
// terms and starts no award.
func TestSelectStaleVersionsNeverAwardStaleTerms(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)

	// The driver revises the bid after the rider fetched version 1.
	h.Clock.Advance(20 * time.Second) // clear the revision cooldown
	revise := h.Do(http.MethodPost, "/mp/bids/"+bidView["bidId"].(string)+"/revise", driver, map[string]any{
		"amountMinor":     moneyBody(amount + 500),
		"expectedVersion": 1,
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, revise, http.StatusOK)

	recorder := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireCode(t, recorder, http.StatusConflict, domain.CodeVersionConflict)
	body := decode(t, recorder)
	details, _ := body["details"].(map[string]any)
	refreshedBid, _ := details["bid"].(map[string]any)
	if refreshedBid == nil || int(refreshedBid["bidVersion"].(float64)) != 2 {
		t.Fatalf("the conflict must carry the refreshed terms: %v", body)
	}
	if int(refreshedBid["amountMinor"].(float64)) != int(amount+500) {
		t.Fatalf("refreshed amount: %v", refreshedBid)
	}

	// Nothing was awarded, nothing captured.
	if _, err := h.Marketplace.Store().LatestAwardForRequest(context.Background(),
		h.Marketplace.Store().Pool(), uuid.MustParse(requestID)); err == nil {
		t.Fatal("a stale selection must not create an award")
	}
	if h.Wallet.CaptureCalls != 0 {
		t.Fatalf("captures after a stale selection: %d", h.Wallet.CaptureCalls)
	}

	// Selecting with the CURRENT versions succeeds at the revised terms.
	success := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 2,
	}, "")
	requireStatus(t, success, http.StatusAccepted)
	award := awardRow(t, h, requestID)
	if award.FareMinor != amount+500 || award.BidVersion != 2 {
		t.Fatalf("award terms: fare %d bidVersion %d", award.FareMinor, award.BidVersion)
	}
}

// TestConcurrentSelectsOneRequest: two offers, two concurrent selections —
// exactly one award and one capture; the other live bid loses with exactly
// one hold release.
func TestConcurrentSelectsOneRequest(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driverA := h.Driver()
	driverB := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driverA, testutil.PickupFixture())
	bidA := fundedCurrentBid(t, h, driverA, requestID, amount)
	parkDriver(t, h, driverB, testutil.PlaceAt(testutil.PickupFixture(), 500))
	bidB := fundedCurrentBid(t, h, driverB, requestID, amount+200)

	var wg sync.WaitGroup
	recorders := make([]*httptest.ResponseRecorder, 2)
	bodies := []map[string]any{
		{"bidId": bidA["bidId"], "requestVersion": 1, "bidVersion": 1},
		{"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1},
	}
	for i := range bodies {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			recorders[i] = doSelect(t, h, rider, requestID, bodies[i], "")
		}(i)
	}
	wg.Wait()

	winners := 0
	for i, recorder := range recorders {
		if recorder.Code == http.StatusAccepted {
			winners++
			continue
		}
		if recorder.Code != http.StatusConflict {
			t.Fatalf("loser %d: unexpected status %d (%s)", i, recorder.Code, recorder.Body.String())
		}
		code := decode(t, recorders[i])["code"]
		switch code {
		case string(domain.CodeVersionConflict), string(domain.CodeAwardUnresolved),
			string(domain.CodeRequestClosed), string(domain.CodeBidNotLive):
		default:
			t.Fatalf("loser %d: unexpected code %v", i, code)
		}
	}
	if winners != 1 {
		t.Fatalf("winners: got %d, want exactly 1", winners)
	}

	// Exactly one award, exactly one capture across BOTH reservations.
	award := awardRow(t, h, requestID)
	if award.State != machine.MpAwardConfirmed {
		t.Fatalf("award state: %s", award.State)
	}
	var awardCount int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM mp.awards WHERE request_id = $1`, requestID).Scan(&awardCount); err != nil {
		t.Fatal(err)
	}
	if awardCount != 1 {
		t.Fatalf("awards: got %d, want 1", awardCount)
	}
	totalCaptures := 0
	for _, captures := range h.Wallet.CapturesByReservation {
		totalCaptures += captures
	}
	if totalCaptures != 1 {
		t.Fatalf("effective captures: got %d, want 1", totalCaptures)
	}

	// The losing bid lost, with exactly one hold release.
	loserBid, loserRes := bidA, bidA["reservationId"].(string)
	if award.BidID.String() == bidA["bidId"].(string) {
		loserBid, loserRes = bidB, bidB["reservationId"].(string)
	}
	if got := bidRow(t, h, loserBid["bidId"].(string)).State; got != machine.MpBidLost {
		t.Fatalf("losing bid state: %s", got)
	}
	if releasesFor(h, loserRes) != 1 {
		t.Fatalf("loser releases: got %d, want 1", releasesFor(h, loserRes))
	}
}

// TestConcurrentSelectsSameDriverSameSlot: two requesters select the SAME
// driver for the current slot at once — the capacity indexes admit one winner.
func TestConcurrentSelectsSameDriverSameSlot(t *testing.T) {
	h := newHarness(t)
	riderA := h.Rider()
	riderB := h.Rider()
	driver := h.Driver()

	viewA, _ := publishAt(t, h, riderA, 0)
	viewB, _ := publishRoute(t, h, riderB, testutil.PickupFixture(), testutil.PlaceAt(testutil.PickupFixture(), 6_000), 0)
	requestA, requestB := viewA["requestId"].(string), viewB["requestId"].(string)

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidA := fundedCurrentBid(t, h, driver, requestA, moneyMinor(t, viewA, "minimumFareMinor"))
	bidB := fundedCurrentBid(t, h, driver, requestB, moneyMinor(t, viewB, "minimumFareMinor"))

	var wg sync.WaitGroup
	recorders := make([]*httptest.ResponseRecorder, 2)
	calls := []struct {
		rider     testutil.Actor
		requestID string
		bidID     any
	}{
		{riderA, requestA, bidA["bidId"]},
		{riderB, requestB, bidB["bidId"]},
	}
	for i := range calls {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			recorders[i] = doSelect(t, h, calls[i].rider, calls[i].requestID, map[string]any{
				"bidId": calls[i].bidID, "requestVersion": 1, "bidVersion": 1,
			}, "")
		}(i)
	}
	wg.Wait()

	winners := 0
	for i, recorder := range recorders {
		if recorder.Code == http.StatusAccepted {
			result := decode(t, recorder)
			if awardBody, _ := result["award"].(map[string]any); awardBody != nil && awardBody["state"] == machine.MpAwardConfirmed {
				winners++
				continue
			}
			t.Fatalf("a 202 without a confirmed award: %s", recorder.Body.String())
		}
		code := decode(t, recorders[i])["code"]
		switch code {
		// slot_unavailable: the claim index refused a second occupation;
		// bid_not_live / version_conflict: the winner's finalize already
		// invalidated the clashing bid before the loser's transaction read it.
		case string(domain.CodeSlotUnavailable), string(domain.CodeBidNotLive), string(domain.CodeVersionConflict):
		default:
			t.Fatalf("loser %d: unexpected code %v (%s)", i, code, recorders[i].Body.String())
		}
	}
	if winners != 1 {
		t.Fatalf("winners: got %d, want exactly 1", winners)
	}

	// Exactly one current-slot occupation for this driver, one capture total.
	var currentClaims int
	if err := h.Pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM mp.driver_claims
		WHERE driver_id = $1 AND (state = 'current' OR (state = 'award_pending' AND slot = 'current'))`,
		driver.UserID).Scan(&currentClaims); err != nil {
		t.Fatal(err)
	}
	if currentClaims != 1 {
		t.Fatalf("current claims: got %d, want 1", currentClaims)
	}
	totalCaptures := 0
	for _, captures := range h.Wallet.CapturesByReservation {
		totalCaptures += captures
	}
	if totalCaptures != 1 {
		t.Fatalf("effective captures: got %d, want 1", totalCaptures)
	}
}

// TestWinnerOtherCurrentBidsInvalidated: a driver's current-intent bid cannot
// be silently honoured after they were awarded elsewhere — it is invalidated
// with one hold release, and a later selection of it answers bid_not_live.
func TestWinnerOtherCurrentBidsInvalidated(t *testing.T) {
	h := newHarness(t)
	riderA := h.Rider()
	riderB := h.Rider()
	driver := h.Driver()

	viewA, _ := publishAt(t, h, riderA, 0)
	viewB, _ := publishRoute(t, h, riderB, testutil.PickupFixture(), testutil.PlaceAt(testutil.PickupFixture(), 6_000), 0)
	requestA, requestB := viewA["requestId"].(string), viewB["requestId"].(string)

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidA := fundedCurrentBid(t, h, driver, requestA, moneyMinor(t, viewA, "minimumFareMinor"))
	bidB := fundedCurrentBid(t, h, driver, requestB, moneyMinor(t, viewB, "minimumFareMinor"))

	winner := doSelect(t, h, riderA, requestA, map[string]any{
		"bidId": bidA["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, winner, http.StatusAccepted)

	// The clashing current-slot bid on B is invalidated, its hold released
	// once, and B's owner was notified through the event stream.
	invalidated := bidRow(t, h, bidB["bidId"].(string))
	if invalidated.State != machine.MpBidInvalidated {
		t.Fatalf("clashing bid state: %s, want invalidated", invalidated.State)
	}
	if releasesFor(h, bidB["reservationId"].(string)) != 1 {
		t.Fatalf("clashing bid releases: %d, want 1", releasesFor(h, bidB["reservationId"].(string)))
	}
	if got := outboxCount(t, h, "mp.bid.invalidated", bidB["bidId"].(string)); got != 1 {
		t.Fatalf("mp.bid.invalidated events: %d", got)
	}

	late := doSelect(t, h, riderB, requestB, map[string]any{
		"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireCode(t, late, http.StatusConflict, domain.CodeBidNotLive)
}

// TestFundingDefiniteFailureCompensates: a definite funding refusal unwinds
// the award — request reopened, bid back live with its hold intact, claim
// released, nothing captured.
func TestFundingDefiniteFailureCompensates(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)

	h.Funding.Fail = domain.Errorf(domain.CodePaymentMethodUnavailable, "wallet cannot fund this")
	recorder := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, recorder, http.StatusAccepted)

	award := awardRow(t, h, requestID)
	if award.State != machine.MpAwardCompensated {
		t.Fatalf("award state: %s, want compensated", award.State)
	}
	if request := requestRow(t, h, requestID); request.State != machine.MpRequestOpen {
		t.Fatalf("request state: %s, want reopened", request.State)
	}
	if bid := bidRow(t, h, bidView["bidId"].(string)); bid.State != machine.MpBidSubmitted {
		t.Fatalf("bid state: %s, want back to submitted", bid.State)
	}
	if claim := claimRow(t, h, award.ID); claim.State != machine.MpClaimReleased {
		t.Fatalf("claim state: %s, want released", claim.State)
	}
	// The hold still funds the live bid; nothing was captured or released.
	if releasesFor(h, bidView["reservationId"].(string)) != 0 {
		t.Fatal("compensation must not release the live bid's hold")
	}
	if h.Wallet.CaptureCalls != 0 {
		t.Fatalf("captures: %d, want 0", h.Wallet.CaptureCalls)
	}
	if got := outboxCount(t, h, "mp.award.failed", award.ID.String()); got != 1 {
		t.Fatalf("mp.award.failed events: %d", got)
	}
	if got := outboxCount(t, h, "mp.request.reopened", requestID); got != 1 {
		t.Fatalf("mp.request.reopened events: %d", got)
	}
}

// TestCaptureRefusedReleasesRiderFunding: a saga that fails AFTER the rider's
// funding reservation was taken (the capture answers a definite refusal) must
// free the rider's money — the reservation is released exactly once, with the
// compensation's reason linked (C02).
func TestCaptureRefusedReleasesRiderFunding(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)

	// Funding succeeds (a durable reservation now encumbers the fare); the
	// commission capture then refuses definitively.
	h.Wallet.FailCapture = domain.Errorf(domain.CodeConflict,
		"the hold's current amount is not the award's pinned commission")
	recorder := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, recorder, http.StatusAccepted)

	award := awardRow(t, h, requestID)
	if award.State != machine.MpAwardCompensated {
		t.Fatalf("award state: %s, want compensated", award.State)
	}
	if h.Funding.EffectiveCalls != 1 {
		t.Fatalf("funding authorizations: got %d, want 1", h.Funding.EffectiveCalls)
	}
	// The rider reservation was released exactly once, with the reason.
	if h.Funding.EffectiveReleases != 1 {
		t.Fatalf("effective funding releases: got %d, want exactly 1", h.Funding.EffectiveReleases)
	}
	reason, released := h.Funding.ReleasedAwards[award.ID]
	if !released || reason != "capture_refused" {
		t.Fatalf("released awards: %v, want award %s released with reason capture_refused",
			h.Funding.ReleasedAwards, award.ID)
	}
	// Nothing left on the recovery books for this award's funding.
	var unresolved int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM mp.reservation_recovery
		 WHERE reservation_id = $1 AND resolved_at IS NULL`,
		"mp.fund.release:"+award.ID.String()).Scan(&unresolved); err != nil {
		t.Fatal(err)
	}
	if unresolved != 0 {
		t.Fatalf("funding release recovery rows left unresolved: %d", unresolved)
	}
}

// TestCaptureUnknownOutcomeStaysPending: an ambiguous capture parks the award
// in pending — the request is NEVER timeout-reopened while the debit may still
// commit — and the reconciliation sweep resolves it: to confirmed when the
// re-poll answers the replayed receipt, with exactly one effective debit.
func TestCaptureUnknownOutcomeStaysPending(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)
	reservationID := bidView["reservationId"].(string)

	h.Wallet.UnknownCapture = true
	recorder := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, recorder, http.StatusAccepted)

	award := awardRow(t, h, requestID)
	if award.State != machine.MpAwardPending {
		t.Fatalf("award state: %s, want pending under an unknown outcome", award.State)
	}
	if request := requestRow(t, h, requestID); request.State != machine.MpRequestAwardPending {
		t.Fatalf("request state: %s, must stay award_pending", request.State)
	}

	// A second selection while unresolved answers award_unresolved.
	second := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 2, "bidVersion": 1,
	}, "")
	requireCode(t, second, http.StatusConflict, domain.CodeAwardUnresolved)

	// Convergence polling works for the owner and the winning driver.
	for _, actor := range []testutil.Actor{rider, driver} {
		poll := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/award", actor, nil)
		requireStatus(t, poll, http.StatusOK)
		if decode(t, poll)["state"] != machine.MpAwardPending {
			t.Fatalf("poll state: %v", decode(t, poll))
		}
	}

	// Sweeping while the wallet is still ambiguous changes nothing.
	h.Clock.Advance(65 * time.Second)
	_ = h.Marketplace.Sweep(context.Background())
	if awardRow(t, h, requestID).State != machine.MpAwardPending {
		t.Fatal("the sweep must not resolve an award the wallet has not answered for")
	}

	// The wallet comes back: the re-poll replays the ORIGINAL receipt and the
	// award confirms with exactly one effective debit.
	h.Wallet.UnknownCapture = false
	h.Clock.Advance(2 * time.Minute)
	_ = h.Marketplace.Sweep(context.Background())

	award = awardRow(t, h, requestID)
	if award.State != machine.MpAwardConfirmed || award.CaptureReceiptID == "" {
		t.Fatalf("award after reconciliation: %+v", award)
	}
	if h.Wallet.CapturesByReservation[reservationID] != 1 {
		t.Fatalf("effective captures: got %d, want 1 (no double debit)",
			h.Wallet.CapturesByReservation[reservationID])
	}
	if h.Wallet.CaptureCalls < 2 {
		t.Fatalf("the sweeper never re-polled: %d capture calls", h.Wallet.CaptureCalls)
	}
	if request := requestRow(t, h, requestID); request.State != machine.MpRequestExecution {
		t.Fatalf("request state: %s, want execution", request.State)
	}
}

// TestCaptureUnknownThenDefiniteRefusalCompensates: the sweeper resolves the
// other way too — a re-poll that answers a definite refusal (nothing was ever
// debited) compensates and reopens.
func TestCaptureUnknownThenDefiniteRefusalCompensates(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)

	// The wire drops before the wallet applies anything.
	h.Wallet.FailCapture = fmt.Errorf("%w: connection reset", marketplace.ErrWalletUnknownOutcome)
	recorder := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, recorder, http.StatusAccepted)
	if awardRow(t, h, requestID).State != machine.MpAwardPending {
		t.Fatal("an unknown capture must stay pending")
	}

	// The wallet answers definitively: it never saw a capturable hold.
	h.Wallet.FailCapture = domain.Errorf(domain.CodeNotFound, "no capturable hold")
	h.Clock.Advance(2 * time.Minute)
	_ = h.Marketplace.Sweep(context.Background())

	award := awardRow(t, h, requestID)
	if award.State != machine.MpAwardCompensated {
		t.Fatalf("award state: %s, want compensated", award.State)
	}
	if request := requestRow(t, h, requestID); request.State != machine.MpRequestOpen {
		t.Fatalf("request state: %s, want reopened", request.State)
	}
	if bid := bidRow(t, h, bidView["bidId"].(string)); bid.State != machine.MpBidSubmitted {
		t.Fatalf("bid state: %s, want back live", bid.State)
	}
	if h.Wallet.ReverseCalls != 0 {
		t.Fatal("nothing was captured, so nothing may be reversed")
	}
}

// TestLegacyAcceptRefusesMarketplaceRide: an execution ride created by an
// award cannot be taken through the classic offer-accept path.
func TestLegacyAcceptRefusesMarketplaceRide(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()
	intruder := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)
	recorder := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, recorder, http.StatusAccepted)

	award := awardRow(t, h, requestID)
	claim := claimRow(t, h, award.ID)

	// A stray legacy offer for the marketplace ride.
	offerID := uuid.New()
	if _, err := h.Pool.Exec(context.Background(), `
		INSERT INTO ride.offers (id, ride_id, driver_id, ring, radius_meters, distance_meters, eta_seconds, state, expires_at)
		VALUES ($1,$2,$3,0,2000,100,60,'offered', now() + interval '1 hour')`,
		offerID, *claim.ExecutionID, intruder.UserID); err != nil {
		t.Fatal(err)
	}

	accept := h.Do(http.MethodPost, "/offers/"+offerID.String()+"/accept", intruder, map[string]any{})
	requireCode(t, accept, http.StatusConflict, domain.CodeRequestClosed)
}
