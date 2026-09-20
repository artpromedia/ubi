package marketplace_test

// Regression tests for the adversarial-review fixes: each pins a behavior
// that was exploitable (or wire-broken) before the fix and fails against the
// old code.

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// TestReviseRefusedWhileSelectionPending (saga #1): a selection bumps the
// bid's version and pins its terms; a driver revise landing while the award
// saga is in flight is refused — the selected_pending → revised machine edge
// belongs to compensation alone — and the saga then confirms at the pinned
// commission.
func TestReviseRefusedWhileSelectionPending(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)
	bidID := bidView["bidId"].(string)
	reservationID := bidView["reservationId"].(string)
	commission := marketplace.CommissionMinor(amount)

	// The capture answer is lost: the award parks in pending with the bid
	// selected_pending — exactly the window the old revise could slip into.
	h.Wallet.UnknownCapture = true
	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidID, "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)

	pinned := bidRow(t, h, bidID)
	if pinned.State != machine.MpBidSelectedPending {
		t.Fatalf("bid state: %s, want selected_pending", pinned.State)
	}
	if pinned.BidVersion != 2 {
		t.Fatalf("selection must bump bid_version so a concurrent revise fails its guard: got %d", pinned.BidVersion)
	}

	adjustsBefore := h.Wallet.AdjustCalls
	// A revise against the pre-selection version: refused before any money moves.
	revise := h.Do(http.MethodPost, "/mp/bids/"+bidID+"/revise", driver, map[string]any{
		"amountMinor":     moneyBody(amount + 2_000),
		"expectedVersion": 1,
	}, move.IdempotencyHeader, idemKey())
	if revise.Code != http.StatusConflict {
		t.Fatalf("a revise of a selected_pending bid must be refused: %d (%s)", revise.Code, revise.Body.String())
	}
	// And against the bumped version too: the state alone forbids it.
	reviseV2 := h.Do(http.MethodPost, "/mp/bids/"+bidID+"/revise", driver, map[string]any{
		"amountMinor":     moneyBody(amount + 2_000),
		"expectedVersion": 2,
	}, move.IdempotencyHeader, idemKey())
	if reviseV2.Code != http.StatusConflict {
		t.Fatalf("a revise of a selected_pending bid must be refused whatever version it pins: %d (%s)",
			reviseV2.Code, reviseV2.Body.String())
	}
	if h.Wallet.AdjustCalls != adjustsBefore {
		t.Fatalf("a refused revise must never touch the hold: %d adjust calls", h.Wallet.AdjustCalls-adjustsBefore)
	}
	if hold := h.Wallet.Holds()[reservationID]; hold.AmountMinor.AmountMinor != commission {
		t.Fatalf("hold: %d, want the pinned commission %d", hold.AmountMinor.AmountMinor, commission)
	}

	// The wallet comes back: the saga confirms at the pinned terms.
	h.Wallet.UnknownCapture = false
	h.Clock.Advance(2 * time.Minute)
	_ = h.Marketplace.Sweep(context.Background())
	award := awardRow(t, h, requestID)
	if award.State != machine.MpAwardConfirmed || award.CommissionMinor != commission {
		t.Fatalf("award: state %s commission %d, want confirmed at %d", award.State, award.CommissionMinor, commission)
	}
	if h.Wallet.CapturesByReservation[reservationID] != 1 {
		t.Fatalf("captures: %d, want exactly 1", h.Wallet.CapturesByReservation[reservationID])
	}
}

// TestConcurrentIdenticalRaisesKeepHoldSynced (bounds #2): two identical
// raises of one bid under different idempotency keys — the loser's failure
// path must NOT clobber the winner's raised hold back down, leaving a live
// bid under-reserved.
func TestConcurrentIdenticalRaisesKeepHoldSynced(t *testing.T) {
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
	bidID := bidView["bidId"].(string)
	reservationID := bidView["reservationId"].(string)

	h.Clock.Advance(20 * time.Second) // clear the revision cooldown

	raised := amount + 2_000
	newCommission := marketplace.CommissionMinor(raised)
	body := map[string]any{"amountMinor": moneyBody(raised), "expectedVersion": 1}

	// The rival revise B commits INSIDE call A's window between its wallet
	// adjust and its transaction — the exact interleaving of the finding.
	var rival *httptest.ResponseRecorder
	h.Wallet.BeforeAdjust = func() {
		rival = h.Do(http.MethodPost, "/mp/bids/"+bidID+"/revise", driver, body,
			move.IdempotencyHeader, idemKey())
	}
	loser := h.Do(http.MethodPost, "/mp/bids/"+bidID+"/revise", driver, body,
		move.IdempotencyHeader, idemKey())

	if rival == nil || rival.Code != http.StatusOK {
		t.Fatalf("the rival revise must have committed: %+v", rival)
	}
	if loser.Code != http.StatusConflict {
		t.Fatalf("the losing revise must answer a conflict: %d (%s)", loser.Code, loser.Body.String())
	}

	bid := bidRow(t, h, bidID)
	if bid.AmountMinor != raised || bid.CommissionMinor != newCommission || bid.BidVersion != 2 {
		t.Fatalf("bid after the race: %+v", bid)
	}
	// THE point: the hold still matches the live bid's commission. The old
	// code compensated it back down to the pre-raise amount.
	if hold := h.Wallet.Holds()[reservationID]; hold.AmountMinor.AmountMinor != newCommission {
		t.Fatalf("hold after the race: %d, want %d (a live bid must stay fully reserved)",
			hold.AmountMinor.AmountMinor, newCommission)
	}
	// No orphan recovery debt was parked either.
	var unresolved int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM mp.reservation_recovery WHERE reservation_id = $1 AND resolved_at IS NULL`,
		reservationID).Scan(&unresolved); err != nil {
		t.Fatal(err)
	}
	if unresolved != 0 {
		t.Fatalf("unresolved recovery rows after a converged race: %d", unresolved)
	}
}

// TestReviseRequestRefusesForeignQuote (bounds #1): a replacement quote must
// price the SAME route (and market, currency, policy) — a short-trip quote
// can never lower a long trip's floor.
func TestReviseRequestRefusesForeignQuote(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()

	// A LONG trip, so its cost/bps floor sits well above the absolute floor a
	// short trip collapses to.
	longDropoff := testutil.PlaceAt(testutil.PickupFixture(), 25_000)
	view, _ := publishRoute(t, h, rider, testutil.PickupFixture(), longDropoff, 0)
	requestID := view["requestId"].(string)

	// A fresh quote for a DIFFERENT (much shorter) route in the same city,
	// class and service: cheaper bounds that must not govern this request.
	shortQuote := quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.PlaceAt(testutil.PickupFixture(), 700))
	shortMin := moneyMinor(t, shortQuote, "minimumFareMinor")
	requestMin := moneyMinor(t, view, "minimumFareMinor")
	if shortMin >= requestMin {
		t.Fatalf("fixture: the short route's floor (%d) must undercut the request's (%d)", shortMin, requestMin)
	}

	swap := h.Do(http.MethodPost, "/mp/requests/"+requestID+"/revise", rider, map[string]any{
		"requestedFareMinor": moneyBody(shortMin),
		"quoteId":            shortQuote["quoteId"],
		"expectedVersion":    int(asInt64(t, view, "version")),
	}, move.IdempotencyHeader, idemKey())
	requireCode(t, swap, http.StatusUnprocessableEntity, domain.CodeValidationFailed)

	// The request's stored bounds are untouched.
	request := requestRow(t, h, requestID)
	if request.MinMinor != requestMin {
		t.Fatalf("the stored floor moved: %d, want %d", request.MinMinor, requestMin)
	}

	// Control: a fresh quote for the SAME route is accepted and re-snapshots
	// bounds legitimately.
	sameQuote := quoteEnvelope(t, h, rider, testutil.PickupFixture(), longDropoff)
	sameMin := moneyMinor(t, sameQuote, "minimumFareMinor")
	ok := h.Do(http.MethodPost, "/mp/requests/"+requestID+"/revise", rider, map[string]any{
		"requestedFareMinor": moneyBody(sameMin),
		"quoteId":            sameQuote["quoteId"],
		"expectedVersion":    int(asInt64(t, view, "version")),
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, ok, http.StatusOK)
}

// TestUnknownReserveOutcomeReleasesRealHold (saga #2): a reserve whose answer
// was lost is recovered by REPLAYING the reserve under the same idempotency
// key and releasing the REAL reservation id — the driver's money never leaks.
func TestUnknownReserveOutcomeReleasesRealHold(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")
	commission := marketplace.CommissionMinor(amount)

	parkDriver(t, h, driver, testutil.PickupFixture())
	start := 10 * commission
	h.Wallet.SetSpendable(driver.UserID, start)

	// The reserve APPLIES but the answer is lost.
	h.Wallet.UnknownReserve = true
	refused := submitBid(t, h, driver, requestID, amount, "")
	requireCode(t, refused, http.StatusServiceUnavailable, domain.CodeServiceUnavailable)
	h.Wallet.UnknownReserve = false

	holds := h.Wallet.Holds()
	if len(holds) != 1 {
		t.Fatalf("the wallet holds %d reservations, want the 1 orphan", len(holds))
	}
	var reservationID string
	for id := range holds {
		reservationID = id
	}
	if got := h.Wallet.Spendable(driver.UserID); got != start-commission {
		t.Fatalf("spendable before recovery: %d, want %d (the orphan hold encumbers it)", got, start-commission)
	}

	// The sweep replays the reserve, learns the real id, and releases it —
	// exactly once, however many sweeps run.
	h.Clock.Advance(2 * time.Second)
	ctx := context.Background()
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if releases := releasesFor(h, reservationID); releases != 1 {
		t.Fatalf("releases after recovery: got %d, want exactly 1 (the old code released the key string and leaked the hold)", releases)
	}
	if got := h.Wallet.Spendable(driver.UserID); got != start {
		t.Fatalf("spendable after recovery: %d, want %d", got, start)
	}
	var unresolved int
	if err := h.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM mp.reservation_recovery WHERE resolved_at IS NULL AND driver_id = $1`,
		driver.UserID).Scan(&unresolved); err != nil {
		t.Fatal(err)
	}
	if unresolved != 0 {
		t.Fatalf("recovery rows left unresolved: %d", unresolved)
	}
}

// TestCompensationDecisionResumesIntoCompensation (saga #3): once the durable
// attempt ledger says `compensating`, the sweep resumes the award INTO the
// compensation path and never forward into finalize — even when the original
// blocker has cleared.
func TestCompensationDecisionResumesIntoCompensation(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)
	reservationID := bidView["reservationId"].(string)

	// Capture applies but the answer is lost: award pending, fee captured.
	h.Wallet.UnknownCapture = true
	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	award := awardRow(t, h, requestID)
	if award.State != machine.MpAwardPending {
		t.Fatalf("award state: %s, want pending", award.State)
	}
	h.Wallet.UnknownCapture = false

	// Simulate a crash AFTER the compensation decision was durably recorded
	// (which the fixed code writes BEFORE any reversal is driven).
	retryAt := h.Clock.Now()
	if err := h.Marketplace.Store().SaveCompensationDecision(context.Background(), h.Pool,
		award.ID, "execution_blocked", true, &retryAt); err != nil {
		t.Fatal(err)
	}

	// The sweep resumes: the award must COMPENSATE — reversing the captured
	// fee — never confirm, although finalize would happily succeed now.
	h.Clock.Advance(2 * time.Minute)
	_ = h.Marketplace.Sweep(context.Background())

	award = awardRow(t, h, requestID)
	if award.State != machine.MpAwardCompensated {
		t.Fatalf("award state after resume: %s, want compensated (never forward into finalize)", award.State)
	}
	if h.Wallet.ReversalsByReservation[reservationID] != 1 {
		t.Fatalf("reversals: %d, want exactly 1", h.Wallet.ReversalsByReservation[reservationID])
	}
	if request := requestRow(t, h, requestID); request.State != machine.MpRequestOpen {
		t.Fatalf("request state: %s, want reopened", request.State)
	}
	if bid := bidRow(t, h, bidView["bidId"].(string)); bid.State != machine.MpBidSubmitted {
		t.Fatalf("bid state: %s, want back to submitted", bid.State)
	}

	// Re-sweeping never doubles the reversal.
	h.Clock.Advance(2 * time.Minute)
	_ = h.Marketplace.Sweep(context.Background())
	if h.Wallet.ReversalsByReservation[reservationID] != 1 {
		t.Fatalf("reversals after re-sweep: %d, want 1", h.Wallet.ReversalsByReservation[reservationID])
	}
}

// TestRecoveryReverseSkipsConfirmedAward (saga #3): an orphan RecoveryReverse
// row must never reverse the fee of an award that CONFIRMED — the row
// resolves untouched.
func TestRecoveryReverseSkipsConfirmedAward(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)
	reservationID := bidView["reservationId"].(string)

	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	if awardRow(t, h, requestID).State != machine.MpAwardConfirmed {
		t.Fatal("fixture: the award must be confirmed")
	}

	// The orphan row a crashed compensation attempt might have left behind.
	bidID := uuid.MustParse(bidView["bidId"].(string))
	if err := h.Marketplace.Store().InsertRecovery(context.Background(), h.Pool, marketplace.RecoveryRow{
		ReservationID: reservationID,
		DriverID:      driver.UserID,
		BidID:         &bidID,
		Action:        marketplace.RecoveryReverse,
		LastError:     "injected orphan",
	}); err != nil {
		t.Fatal(err)
	}

	h.Clock.Advance(2 * time.Second)
	ctx := context.Background()
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if h.Wallet.ReversalsByReservation[reservationID] != 0 {
		t.Fatalf("a confirmed award's fee was reversed by an orphan recovery row: %d reversals",
			h.Wallet.ReversalsByReservation[reservationID])
	}
	var unresolved int
	if err := h.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM mp.reservation_recovery WHERE reservation_id = $1 AND resolved_at IS NULL`,
		reservationID).Scan(&unresolved); err != nil {
		t.Fatal(err)
	}
	if unresolved != 0 {
		t.Fatalf("the orphan row must resolve (skip), not spin: %d unresolved", unresolved)
	}
}

// TestTransitionBidNeverOverwritesTerminalState (saga #5): a state-only
// transition asserted against a stale snapshot must fail its guard instead of
// overwriting a concurrently committed terminal state.
func TestTransitionBidNeverOverwritesTerminalState(t *testing.T) {
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
	bidID := bidView["bidId"].(string)

	// A stale snapshot from before the withdrawal…
	stale := bidRow(t, h, bidID)
	if stale.State != machine.MpBidSubmitted {
		t.Fatalf("fixture bid state: %s", stale.State)
	}

	withdraw := h.Do(http.MethodPost, "/mp/bids/"+bidID+"/withdraw", driver, nil,
		move.IdempotencyHeader, idemKey())
	requireStatus(t, withdraw, http.StatusOK)

	// …used for a state-only transition (submitted → lost, no version bump):
	// the guard must refuse, because the row is withdrawn now.
	ctx := context.Background()
	err := h.Marketplace.Store().InTx(ctx, func(tx pgx.Tx) error {
		_, err := h.Marketplace.Store().TransitionBid(ctx, tx, stale, machine.MpBidLost, marketplace.BidUpdate{})
		return err
	})
	if err == nil {
		t.Fatal("a terminal state was overwritten through a stale snapshot")
	}
	mapped, ok := domain.AsError(err)
	if !ok || mapped.Code != domain.CodeVersionConflict {
		t.Fatalf("expected version_conflict, got %v", err)
	}
	if bid := bidRow(t, h, bidID); bid.State != machine.MpBidWithdrawn {
		t.Fatalf("bid state: %s, want withdrawn preserved", bid.State)
	}
}

// TestBidCapEnforcedUnderConcurrency (bounds #4): N concurrent submissions
// cannot end with more live bids than the cap — the recount inside the insert
// transaction is the authority. The wallet barrier holds every submission in
// the window AFTER the old pool-side count, so the old check-then-act code
// deterministically exceeded the cap here.
func TestBidCapEnforcedUnderConcurrency(t *testing.T) {
	h := newHarness(t)
	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 10_000_000)

	const attempts = 4 // fixture cap: 3 live bids per driver

	type target struct {
		requestID string
		amount    int64
	}
	targets := make([]target, attempts)
	for i := range targets {
		view, _ := publishAt(t, h, h.Rider(), 0)
		targets[i] = target{view["requestId"].(string), moneyMinor(t, view, "minimumFareMinor")}
	}

	var mu sync.Mutex
	arrived := 0
	release := make(chan struct{})
	h.Wallet.BeforeReserve = func() {
		mu.Lock()
		arrived++
		if arrived == attempts {
			close(release)
		}
		mu.Unlock()
		<-release
	}

	recorders := make([]*httptest.ResponseRecorder, attempts)
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			recorders[i] = submitBid(t, h, driver, targets[i].requestID, targets[i].amount, "")
		}(i)
	}
	wg.Wait()
	h.Wallet.BeforeReserve = nil

	created, capped := 0, 0
	for i, recorder := range recorders {
		switch recorder.Code {
		case http.StatusCreated:
			created++
		case http.StatusTooManyRequests:
			capped++
		default:
			t.Fatalf("submission %d: unexpected status %d (%s)", i, recorder.Code, recorder.Body.String())
		}
	}
	if created != 3 || capped != 1 {
		t.Fatalf("cap under concurrency: %d created, %d capped; want 3/1", created, capped)
	}
	live, err := h.Marketplace.Store().LiveBidCountForDriver(context.Background(),
		h.Marketplace.Store().Pool(), driver.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if live != 3 {
		t.Fatalf("live bids: %d, want the cap of 3", live)
	}
	// The refused submission's reservation was released again: exactly three
	// active holds remain.
	active := 0
	for _, hold := range h.Wallet.Holds() {
		if hold.State == machine.MpHoldActive {
			active++
		}
	}
	if active != 3 {
		t.Fatalf("active holds: %d, want 3 (the loser's hold released)", active)
	}
}

// TestOpenRequestCapEnforcedUnderConcurrency (bounds #4): concurrent
// publishes cannot exceed the per-requester open-request cap.
func TestOpenRequestCapEnforcedUnderConcurrency(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()

	const attempts = 4 // fixture cap: 2 open requests per requester
	quotes := make([]map[string]any, attempts)
	for i := range quotes {
		quotes[i] = quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture())
	}

	recorders := make([]*httptest.ResponseRecorder, attempts)
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			recorders[i] = h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
				"quoteId":            quotes[i]["quoteId"],
				"requestedFareMinor": moneyBody(moneyMinor(t, quotes[i], "minimumFareMinor")),
				"paymentMethodId":    "wallet",
			}, move.IdempotencyHeader, idemKey())
		}(i)
	}
	wg.Wait()

	created := 0
	for i, recorder := range recorders {
		switch recorder.Code {
		case http.StatusCreated:
			created++
		case http.StatusTooManyRequests:
		default:
			t.Fatalf("publish %d: unexpected status %d (%s)", i, recorder.Code, recorder.Body.String())
		}
	}
	if created > 2 {
		t.Fatalf("open requests created under concurrency: %d, cap is 2", created)
	}
	var open int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM mp.requests WHERE requester_id = $1 AND state = 'open'`,
		rider.UserID).Scan(&open); err != nil {
		t.Fatal(err)
	}
	if open > 2 {
		t.Fatalf("open requests in the store: %d, cap is 2", open)
	}
}

// TestCaptureRefusedWhenHoldDiffersFromAwardedTerms (client-contract #1 /
// money #1): the capture pins the award's commission — a hold whose amount no
// longer matches is refused with a definite conflict and the award
// compensates instead of debiting terms that were never awarded.
func TestCaptureRefusedWhenHoldDiffersFromAwardedTerms(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)
	reservationID := bidView["reservationId"].(string)

	// Sabotage: the hold is inflated behind the saga's back, right before the
	// capture step runs (what an unguarded revise used to be able to do).
	h.Wallet.BeforeCapture = func() {
		if _, err := h.Wallet.Adjust(context.Background(), reservationID,
			marketplace.Money{AmountMinor: marketplace.CommissionMinor(amount) * 2, Currency: testCurrency},
			marketplace.Money{AmountMinor: amount * 2, Currency: testCurrency},
			"test.sabotage:"+reservationID); err != nil {
			t.Errorf("sabotage adjust failed: %v", err)
		}
	}
	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)

	award := awardRow(t, h, requestID)
	if award.State != machine.MpAwardCompensated {
		t.Fatalf("award state: %s, want compensated (the mismatched capture must be a definite refusal)", award.State)
	}
	if h.Wallet.CapturesByReservation[reservationID] != 0 {
		t.Fatalf("captures: %d, want 0 (nothing may be debited at unawarded terms)",
			h.Wallet.CapturesByReservation[reservationID])
	}
	if request := requestRow(t, h, requestID); request.State != machine.MpRequestOpen {
		t.Fatalf("request state: %s, want reopened", request.State)
	}
}

// TestAwardViewWireShape (client-contract #2, #3, #4): the award view carries
// Money objects and executionRef {service, id} exactly as the contract
// documents, and the select 202 body is {award, pickupPin?}.
func TestAwardViewWireShape(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)
	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	result := decode(t, selected)

	awardBody, ok := result["award"].(map[string]any)
	if !ok {
		t.Fatalf("the select 202 body must be {award, pickupPin?}: %v", result)
	}
	if pin, _ := result["pickupPin"].(string); len(pin) != 4 {
		t.Fatalf("pickupPin must ride once beside the award: %q", pin)
	}
	if got := moneyMinor(t, awardBody, "fareMinor"); got != amount {
		t.Fatalf("award.fareMinor: %d, want %d", got, amount)
	}
	if got := moneyMinor(t, awardBody, "commissionMinor"); got != marketplace.CommissionMinor(amount) {
		t.Fatalf("award.commissionMinor: %d", got)
	}
	ref, ok := awardBody["executionRef"].(map[string]any)
	if !ok {
		t.Fatalf("award.executionRef must be {service, id}: %v", awardBody)
	}
	if ref["service"] != "ride" || ref["id"] == "" {
		t.Fatalf("executionRef: %v", ref)
	}
	if _, hasFlat := awardBody["executionId"]; hasFlat {
		t.Fatalf("the flat executionId must be gone: %v", awardBody)
	}

	// The GET convergence view carries the same shape.
	poll := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/award", rider, nil)
	requireStatus(t, poll, http.StatusOK)
	polled := decode(t, poll)
	pollRef, ok := polled["executionRef"].(map[string]any)
	if !ok || pollRef["id"] != ref["id"] {
		t.Fatalf("GET award executionRef: %v", polled)
	}
	_ = moneyMinor(t, polled, "fareMinor")
}

// TestHoldStateHonestVocabulary (client-contract #5): holdState speaks the
// client vocabulary — held | release_pending | released — and `released` is
// stated ONLY once the wallet confirmed the release.
func TestHoldStateHonestVocabulary(t *testing.T) {
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
	bidID := decode(t, created)["bidId"].(string)

	myHoldState := func() string {
		recorder := h.Do(http.MethodGet, "/mp/bids/mine", driver, nil)
		requireStatus(t, recorder, http.StatusOK)
		bids := decode(t, recorder)["bids"].([]any)
		for _, entry := range bids {
			row := entry.(map[string]any)
			if row["bidId"] == bidID {
				state, _ := row["holdState"].(string)
				return state
			}
		}
		t.Fatalf("bid %s not in /mp/bids/mine", bidID)
		return ""
	}

	if got := myHoldState(); got != marketplace.HoldStateHeld {
		t.Fatalf("live bid holdState: %q, want held", got)
	}

	// The wallet is dark when the withdrawal wants its release: the money is
	// still encumbered, so the state must be release_pending — NEVER released.
	h.Wallet.FailRelease = errors.New("wallet down")
	withdraw := h.Do(http.MethodPost, "/mp/bids/"+bidID+"/withdraw", driver, nil,
		move.IdempotencyHeader, idemKey())
	requireStatus(t, withdraw, http.StatusOK)
	if got := myHoldState(); got != marketplace.HoldStateReleasePending {
		t.Fatalf("holdState with an unconfirmed release: %q, want release_pending", got)
	}

	// Only once the sweep gets the wallet's confirmation does it read released.
	h.Wallet.FailRelease = nil
	h.Clock.Advance(2 * time.Second)
	if err := h.Marketplace.Sweep(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := myHoldState(); got != marketplace.HoldStateReleased {
		t.Fatalf("holdState after the confirmed release: %q, want released", got)
	}
}

// TestParkedAckContractShape (client-contract #6): the parked ack is the
// contract's {state, availabilityEpoch, confirmedAt, expiresAt, ttlSeconds},
// and `state` is what the server ACCEPTED: moving telemetry answers moving
// (and records nothing), no telemetry answers stale_location.
func TestParkedAckContractShape(t *testing.T) {
	h := newHarness(t)
	driver := h.Driver()
	goOnline(t, h, driver)

	// No telemetry at all: the attestation cannot be judged — stale_location.
	stale := h.Do(http.MethodPost, "/mp/driver/parked", driver, nil)
	requireStatus(t, stale, http.StatusOK)
	staleBody := decode(t, stale)
	if staleBody["state"] != "stale_location" {
		t.Fatalf("parked over no telemetry: state %v, want stale_location", staleBody["state"])
	}

	// Clearly moving samples: the attestation answers moving.
	now := h.Clock.Now()
	pickup := testutil.PickupFixture()
	ingestPoints(t, h, driver, []map[string]any{
		point(1, pickup, now.Add(-90*time.Second), 8),
		point(2, pickup, now.Add(-45*time.Second), 8),
		point(3, pickup, now.Add(-1*time.Second), 8),
	})
	moving := h.Do(http.MethodPost, "/mp/driver/parked", driver, nil)
	requireStatus(t, moving, http.StatusOK)
	movingBody := decode(t, moving)
	if movingBody["state"] != "moving" {
		t.Fatalf("parked over moving telemetry: state %v, want moving", movingBody["state"])
	}

	// Still samples: parked_confirmed, with the full ack shape.
	ingestPoints(t, h, driver, []map[string]any{
		point(4, pickup, now.Add(-30*time.Second), 0),
		point(5, pickup, now, 0),
	})
	// The gate walks newest-first and the newest still sample must clear the
	// motion window; the moving samples above age out of the dwell walk once
	// the still ones cover it. Refresh the ring entirely to keep it simple.
	h.Clock.Advance(3 * time.Minute)
	fresh := h.Clock.Now()
	ingestPoints(t, h, driver, []map[string]any{
		point(6, pickup, fresh.Add(-90*time.Second), 0),
		point(7, pickup, fresh.Add(-60*time.Second), 0),
		point(8, pickup, fresh.Add(-30*time.Second), 0),
		point(9, pickup, fresh.Add(-1*time.Second), 0),
	})
	parked := h.Do(http.MethodPost, "/mp/driver/parked", driver, nil)
	requireStatus(t, parked, http.StatusOK)
	body := decode(t, parked)
	if body["state"] != "parked_confirmed" {
		t.Fatalf("parked over still telemetry: state %v (%s)", body["state"], parked.Body.String())
	}
	for _, field := range []string{"availabilityEpoch", "confirmedAt", "expiresAt", "ttlSeconds"} {
		if _, ok := body[field]; !ok {
			t.Fatalf("the parked ack is missing %s: %v", field, body)
		}
	}
	if int(body["ttlSeconds"].(float64)) <= 0 {
		t.Fatalf("ttlSeconds: %v", body["ttlSeconds"])
	}
}

// TestDriverViewCarriesCurrentClaimID and the real /v1/mp/driver/jobs
// projection (client-contract #8).
func TestDriverJobsProjection(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	f := setupQueuedAward(t, h)

	// The driver-view of a THIRD open request names the current claim id —
	// the mandatory dependsOnClaimId for a next-slot bid.
	viewC, _ := publishRoute(t, h, h.Rider(),
		testutil.PlaceAt(testutil.PickupFixture(), 4_500), testutil.PlaceAt(testutil.PickupFixture(), 9_500), 0)
	driverView := h.Do(http.MethodGet, "/mp/requests/"+viewC["requestId"].(string)+"/driver-view", f.driver, nil)
	requireStatus(t, driverView, http.StatusOK)
	dv := decode(t, driverView)
	if dv["currentClaimId"] != f.claimA.ID.String() {
		t.Fatalf("driver-view currentClaimId: %v, want %s", dv["currentClaimId"], f.claimA.ID)
	}

	// The jobs projection: current + next with money, receipt, executionRef
	// and the queued pickup window.
	jobs := h.Do(http.MethodGet, "/mp/driver/jobs", f.driver, nil)
	requireStatus(t, jobs, http.StatusOK)
	body := decode(t, jobs)

	current, ok := body["current"].(map[string]any)
	if !ok {
		t.Fatalf("jobs.current missing: %v", body)
	}
	if current["claimId"] != f.claimA.ID.String() || current["slot"] != "current" {
		t.Fatalf("jobs.current: %v", current)
	}
	if got := moneyMinor(t, current, "fareMinor"); got != f.awardA.FareMinor {
		t.Fatalf("jobs.current.fareMinor: %d, want %d", got, f.awardA.FareMinor)
	}
	_ = moneyMinor(t, current, "commissionMinor")
	if receipt, _ := current["receiptId"].(string); receipt == "" {
		t.Fatalf("jobs.current.receiptId missing: %v", current)
	}
	ref, ok := current["executionRef"].(map[string]any)
	if !ok || ref["service"] != "ride" || ref["id"] != f.rideA.String() {
		t.Fatalf("jobs.current.executionRef: %v", current["executionRef"])
	}

	next, ok := body["next"].(map[string]any)
	if !ok {
		t.Fatalf("jobs.next missing: %v", body)
	}
	if next["claimId"] != f.claimB.ID.String() || next["slot"] != "next" {
		t.Fatalf("jobs.next: %v", next)
	}
	if _, ok := next["pickupWindow"].(map[string]any); !ok {
		t.Fatalf("jobs.next.pickupWindow missing: %v", next)
	}
	if body["promotion"] != "none" {
		t.Fatalf("promotion: %v, want none while the current job runs", body["promotion"])
	}

	// A driver with no claims gets an empty projection, not an error.
	idle := h.Driver()
	empty := h.Do(http.MethodGet, "/mp/driver/jobs", idle, nil)
	requireStatus(t, empty, http.StatusOK)
	emptyBody := decode(t, empty)
	if _, hasCurrent := emptyBody["current"]; hasCurrent {
		t.Fatalf("an idle driver has no current job: %v", emptyBody)
	}
	if emptyBody["promotion"] != "none" {
		t.Fatalf("idle promotion: %v", emptyBody["promotion"])
	}
}

// TestCompletionSettlesExactlyOnce (money #3): completing a marketplace
// execution posts the M06 settlement — idempotent on the award id — with the
// awarded fare and the request's payment method; sweeps never double it.
func TestCompletionSettlesExactlyOnce(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)
	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	pin, _ := decode(t, selected)["pickupPin"].(string)
	award := awardRow(t, h, requestID)
	claim := claimRow(t, h, award.ID)
	rideID := claim.ExecutionID

	// Drive the execution ride through its real lifecycle to completion.
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/arrived", driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/verify-pin", driver, map[string]any{"pin": pin}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/start", driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/complete", driver, map[string]any{}), http.StatusOK)

	if h.Settlement.EffectiveCalls != 1 {
		t.Fatalf("effective settlements after completion: %d, want exactly 1", h.Settlement.EffectiveCalls)
	}
	settled, ok := h.Settlement.Requests[award.ID]
	if !ok {
		t.Fatalf("no settlement recorded for award %s", award.ID)
	}
	if settled.FareMinor.AmountMinor != award.FareMinor || settled.FareMinor.Currency != testCurrency {
		t.Fatalf("settlement fare: %+v, want %d %s", settled.FareMinor, award.FareMinor, testCurrency)
	}
	if settled.Method != "wallet" {
		t.Fatalf("settlement method: %q, want wallet (the request's payment method)", settled.Method)
	}
	if settled.ExecutionRef.Service != "ride" || settled.ExecutionRef.ID != rideID.String() {
		t.Fatalf("settlement executionRef: %+v", settled.ExecutionRef)
	}
	if settled.DriverID != driver.UserID || settled.RequesterID != rider.UserID {
		t.Fatalf("settlement parties: %+v", settled)
	}

	// The durable intent resolved, and sweeps never settle twice.
	ctx := context.Background()
	var unresolved int
	if err := h.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM mp.reservation_recovery WHERE action = 'settle' AND resolved_at IS NULL`).Scan(&unresolved); err != nil {
		t.Fatal(err)
	}
	if unresolved != 0 {
		t.Fatalf("unresolved settlement rows after a confirmed settlement: %d", unresolved)
	}
	h.Clock.Advance(2 * time.Minute)
	_ = h.Marketplace.Sweep(ctx)
	_ = h.Marketplace.Sweep(ctx)
	if h.Settlement.EffectiveCalls != 1 {
		t.Fatalf("effective settlements after sweeps: %d, want 1", h.Settlement.EffectiveCalls)
	}
}

// TestCompletionSettlementRecoveredBySweep (money #3): a settlement whose
// outcome was lost is retried by the sweep under the award's one key and
// converges on exactly one effective posting.
func TestCompletionSettlementRecoveredBySweep(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)
	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	pin, _ := decode(t, selected)["pickupPin"].(string)
	award := awardRow(t, h, requestID)
	rideID := claimRow(t, h, award.ID).ExecutionID

	// The settlement wire goes dark exactly when completion posts it.
	h.Settlement.Fail = errors.New("payment-service unreachable")
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/arrived", driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/verify-pin", driver, map[string]any{"pin": pin}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/start", driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/complete", driver, map[string]any{}), http.StatusOK)

	if h.Settlement.EffectiveCalls != 0 {
		t.Fatalf("nothing may count as settled while the wire is dark: %d", h.Settlement.EffectiveCalls)
	}
	ctx := context.Background()
	var pending int
	if err := h.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM mp.reservation_recovery WHERE action = 'settle' AND resolved_at IS NULL`).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != 1 {
		t.Fatalf("the settlement debt must be on the books: %d rows", pending)
	}

	// The wire heals: the sweep settles exactly once, however often it runs.
	h.Settlement.Fail = nil
	h.Clock.Advance(2 * time.Second)
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if h.Settlement.EffectiveCalls != 1 {
		t.Fatalf("effective settlements after recovery: %d, want exactly 1", h.Settlement.EffectiveCalls)
	}
	if err := h.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM mp.reservation_recovery WHERE action = 'settle' AND resolved_at IS NULL`).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != 0 {
		t.Fatalf("settlement rows left unresolved: %d", pending)
	}
	settled := h.Settlement.Requests[award.ID]
	if settled.FareMinor.AmountMinor != award.FareMinor {
		t.Fatalf("recovered settlement fare: %+v", settled.FareMinor)
	}
}

// TestMoneyObjectsAcrossClientSurfaces (client-contract #2): every
// client-facing money field rides as a {amountMinor, currency} object — the
// quote envelope, the request view, the feed card, the presets and the
// driver's own bid.
func TestMoneyObjectsAcrossClientSurfaces(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, quote := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	// Quote envelope.
	for _, field := range []string{"suggestedFareMinor", "minimumFareMinor", "maximumFareMinor"} {
		_ = moneyMinor(t, quote, field)
	}
	if rows, ok := quote["breakdown"].([]any); ok && len(rows) > 0 {
		_ = moneyMinor(t, rows[0].(map[string]any), "amountMinor")
	} else {
		t.Fatalf("quote breakdown: %v", quote["breakdown"])
	}
	// Request view.
	for _, field := range []string{"requestedFareMinor", "suggestedFareMinor", "minimumFareMinor", "maximumFareMinor"} {
		_ = moneyMinor(t, view, field)
	}

	// Feed card + driver view presets.
	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	feed := h.Do(http.MethodGet, "/mp/feed", driver, nil)
	requireStatus(t, feed, http.StatusOK)
	items := decode(t, feed)["items"].([]any)
	if len(items) == 0 {
		t.Fatal("the parked driver must see the feed card")
	}
	_ = moneyMinor(t, items[0].(map[string]any), "askedMinor")

	driverView := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/driver-view", driver, nil)
	requireStatus(t, driverView, http.StatusOK)
	presets := decode(t, driverView)["presets"].([]any)
	if len(presets) == 0 {
		t.Fatal("presets missing")
	}
	preset := presets[0].(map[string]any)
	for _, field := range []string{"amountMinor", "commissionMinor", "netMinor"} {
		_ = moneyMinor(t, preset, field)
	}

	// The driver's own bid view.
	created := submitBid(t, h, driver, requestID, amount, "")
	requireStatus(t, created, http.StatusCreated)
	bidView := decode(t, created)
	for _, field := range []string{"amountMinor", "commissionMinor", "netMinor"} {
		_ = moneyMinor(t, bidView, field)
	}

	// The owner's offers.
	snapshot := h.Do(http.MethodGet, "/mp/requests/"+requestID, rider, nil)
	requireStatus(t, snapshot, http.StatusOK)
	offers := decode(t, snapshot)["offers"].([]any)
	if len(offers) != 1 {
		t.Fatalf("offers: %d", len(offers))
	}
	_ = moneyMinor(t, offers[0].(map[string]any), "amountMinor")

	// A bare-integer body is refused, not silently coerced.
	bare := h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": 12345,
		"paymentMethodId":    "wallet",
	}, move.IdempotencyHeader, idemKey())
	if bare.Code == http.StatusCreated {
		t.Fatalf("a bare-integer requestedFareMinor must be refused: %s", bare.Body.String())
	}
}
