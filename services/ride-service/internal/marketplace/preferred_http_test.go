package marketplace_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// savedDriver is a rider who completed a marketplace trip with a driver,
// saved that driver, and a driver who opted in to preferred requests.
type savedDriver struct {
	rider  testutil.Actor
	driver testutil.Actor
	trip   *tripFixture
}

func setupSavedDriver(t *testing.T, h *testutil.Harness) *savedDriver {
	t.Helper()
	s := &savedDriver{rider: h.Rider(), driver: h.Driver()}
	goOnline(t, h, s.driver)
	s.trip = completedTripWith(t, h, s.rider, s.driver, 1)
	requireStatus(t, saveFavourite(t, h, s.rider, s.trip.requestID), http.StatusCreated)
	requireStatus(t, setPreferredOptIn(t, h, s.driver, true), http.StatusOK)
	return s
}

// publishPreferred publishes a request naming the saved driver.
func (s *savedDriver) publishPreferred(t *testing.T, h *testutil.Harness, fallback bool) (map[string]any, string, int64) {
	t.Helper()
	recorder := publishWith(t, h, s.rider, map[string]any{
		"preferredDriver": map[string]any{"driverId": s.driver.UserID.String(), "fallbackToMarket": fallback},
	})
	requireStatus(t, recorder, http.StatusCreated)
	view := decode(t, recorder)
	return view, view["requestId"].(string), moneyMinor(t, view, "minimumFareMinor")
}

// parkNamed re-parks the named driver at the pickup (fresh fixes).
func (s *savedDriver) parkNamed(t *testing.T) {
	t.Helper()
	s.trip.park(t, testutil.PickupFixture(), 30*time.Second)
}

func outboxPayload(t *testing.T, h *testutil.Harness, name, aggregateID string) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT payload FROM public.outbox_events WHERE name = $1 AND aggregate_id = $2`, name, aggregateID).Scan(&payload); err != nil {
		t.Fatalf("no %s event for %s: %v", name, aggregateID, err)
	}
	return payload
}

// TestPreferredDriverExclusiveWindowThenConsentedFallback: a rider asks a
// saved, opted-in driver first. For the bounded window the request exists for
// that driver alone — every other driver's feed, driver view and bid path
// answers as if it did not exist. The named driver lets it pass; because the
// rider consented to fallback at request time, the sweep opens the request
// to the market with a fresh request lifetime, and another driver offers
// through the ordinary funded path (10% reserved).
func TestPreferredDriverExclusiveWindowThenConsentedFallback(t *testing.T) {
	h := confidenceHarness(t)
	s := setupSavedDriver(t, h)
	other := h.Driver()
	parkDriver(t, h, other, testutil.PlaceAt(testutil.PickupFixture(), 300))

	view, requestID, amount := s.publishPreferred(t, h, true)
	preferred := view["preferredDriver"].(map[string]any)
	if preferred["state"] != machine.MpPreferredExclusive || preferred["windowSec"] != float64(120) || preferred["fallbackToMarket"] != true ||
		!strings.Contains(preferred["label"].(string), "opens to every driver") {
		t.Fatalf("the rider sees the bounded window and what happens after it: %v", preferred)
	}
	invite := outboxPayload(t, h, "mp.request.preferred_driver_invited", requestID)
	if invite["driverId"] != s.driver.UserID.String() || invite["requesterId"] != nil {
		t.Fatalf("the invitation reaches the named driver and never identifies the rider: %v", invite)
	}

	if _, listed := feedHas(t, h, other, requestID); listed {
		t.Fatal("another driver must not discover an exclusive request")
	}
	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+requestID+"/driver-view", other, nil), http.StatusNotFound, domain.CodeNotFound)
	requireCode(t, tryBid(t, h, other, requestID, amount), http.StatusNotFound, domain.CodeNotFound)

	s.parkNamed(t)
	card, listed := feedHas(t, h, s.driver, requestID)
	if !listed || card["preferredRequest"] == nil ||
		!strings.Contains(card["preferredRequest"].(map[string]any)["note"].(string), "never affects your standing") {
		t.Fatalf("the named driver sees the invitation with the free-decline note: %v", card)
	}
	if driverViewOf(t, h, s.driver, requestID)["preferredRequest"] == nil {
		t.Fatal("the named driver's view carries the invitation")
	}

	// The window passes with no offer.
	h.Clock.Advance(121 * time.Second)
	_ = h.Marketplace.Sweep(context.Background())
	snapshot := snapshotOf(t, h, s.rider, requestID, "")
	request := snapshot["request"].(map[string]any)
	if request["state"] != machine.MpRequestOpen || request["preferredDriver"].(map[string]any)["state"] != machine.MpPreferredMarketOpen {
		t.Fatalf("with consent the request opens to the market: %v", request)
	}
	expires, err := time.Parse(time.RFC3339Nano, request["expiresAt"].(string))
	if err != nil || expires.Before(h.Clock.Now().Add(599*time.Second)) {
		t.Fatalf("the open market gets the full request lifetime: %v at %v (%v)", expires, h.Clock.Now(), err)
	}
	opened := outboxPayload(t, h, "mp.request.opened_to_market", requestID)
	if opened["requesterId"] != s.rider.UserID.String() || opened["reason"] != marketplace.CloseReasonPreferredUnavailable {
		t.Fatalf("the rider is told the market opened, not why the driver did not answer: %v", opened)
	}

	(&tripFixture{h: h, driver: other, seq: 5}).park(t, testutil.PlaceAt(testutil.PickupFixture(), 300), time.Second)
	if _, listed := feedHas(t, h, other, requestID); !listed {
		t.Fatal("once open, every eligible driver discovers the request")
	}
	bid := bidNow(t, h, other, requestID, amount)
	if moneyMinor(t, bid, "commissionMinor") != marketplace.CommissionMinor(amount) || bid["holdState"] != marketplace.HoldStateHeld {
		t.Fatalf("an open-market offer reserves exactly the 10%%: %v", bid)
	}
}

// TestPreferredDriverNoConsentClosesFree: without fallback consent a window
// that passes unanswered closes the request, free of charge, with the clear
// reason preferred_driver_unavailable — no hold, no funding, and no other
// driver ever saw it.
func TestPreferredDriverNoConsentClosesFree(t *testing.T) {
	h := confidenceHarness(t)
	s := setupSavedDriver(t, h)
	other := h.Driver()
	parkDriver(t, h, other, testutil.PickupFixture())
	reservesBefore, fundingBefore := h.Wallet.ReserveCalls, h.Funding.Calls

	view, requestID, _ := s.publishPreferred(t, h, false)
	if !strings.Contains(view["preferredDriver"].(map[string]any)["label"].(string), "nothing is charged") {
		t.Fatalf("the rider is told what happens without fallback: %v", view["preferredDriver"])
	}
	if _, listed := feedHas(t, h, other, requestID); listed {
		t.Fatal("another driver must not discover an exclusive request")
	}

	// Not yet due: the sweep leaves it alone.
	h.Clock.Advance(60 * time.Second)
	_ = h.Marketplace.Sweep(context.Background())
	if row := requestRow(t, h, requestID); row.State != machine.MpRequestOpen {
		t.Fatalf("the window is still running: %s", row.State)
	}
	h.Clock.Advance(61 * time.Second)
	_ = h.Marketplace.Sweep(context.Background())
	row := requestRow(t, h, requestID)
	if row.State != machine.MpRequestExpired || row.CloseReason != marketplace.CloseReasonPreferredUnavailable {
		t.Fatalf("without consent the request expires with a clear reason: %s / %s", row.State, row.CloseReason)
	}
	request := snapshotOf(t, h, s.rider, requestID, "")["request"].(map[string]any)
	if request["closeReason"] != marketplace.CloseReasonPreferredUnavailable ||
		request["preferredDriver"].(map[string]any)["state"] != machine.MpPreferredClosed ||
		!strings.Contains(request["preferredDriver"].(map[string]any)["label"].(string), "nothing was charged") {
		t.Fatalf("the rider sees the free closure: %v", request)
	}
	closed := outboxPayload(t, h, "mp.request.closed", requestID)
	if closed["reason"] != marketplace.CloseReasonPreferredUnavailable || closed["requesterId"] != s.rider.UserID.String() {
		t.Fatalf("the closure is published to the rider: %v", closed)
	}
	if h.Wallet.ReserveCalls != reservesBefore || h.Funding.Calls != fundingBefore {
		t.Fatal("a closed preferred request moved no money")
	}
	if _, listed := feedHas(t, h, other, requestID); listed {
		t.Fatal("a closed preferred request never reaches the market")
	}
}

// TestPreferredDriverDeclineIsFreeAndNeverRecorded: the named driver
// declines. It is idempotent, answers with the free-decline note, opens the
// market at once (the rider consented), and leaves no trace on the driver:
// no standing action, the same standing aggregate, the same reliability, and
// the driver keeps bidding on other requests as before.
func TestPreferredDriverDeclineIsFreeAndNeverRecorded(t *testing.T) {
	h := confidenceHarness(t)
	s := setupSavedDriver(t, h)
	other := h.Driver()
	standingBefore, err := h.Marketplace.Store().DriverStandingAggregate(context.Background(), h.Pool, s.driver.UserID, 90)
	if err != nil {
		t.Fatal(err)
	}

	_, requestID, _ := s.publishPreferred(t, h, true)
	path := "/mp/requests/" + requestID + "/preferred/decline"
	requireCode(t, h.Do(http.MethodPost, path, other, nil, move.IdempotencyHeader, idemKey()), http.StatusNotFound, domain.CodeNotFound)
	requireCode(t, h.Do(http.MethodPost, path, s.rider, nil, move.IdempotencyHeader, idemKey()), http.StatusForbidden, domain.CodeForbidden)

	key := idemKey()
	declined := h.Do(http.MethodPost, path, s.driver, nil, move.IdempotencyHeader, key)
	requireStatus(t, declined, http.StatusOK)
	body := decode(t, declined)
	if body["declined"] != true || !strings.Contains(body["note"].(string), "does not affect your standing") {
		t.Fatalf("the decline is acknowledged as free: %v", body)
	}
	replay := h.Do(http.MethodPost, path, s.driver, nil, move.IdempotencyHeader, key)
	requireStatus(t, replay, http.StatusOK)
	if replay.Body.String() != declined.Body.String() {
		t.Fatalf("a replayed decline answers the same: %s vs %s", replay.Body.String(), declined.Body.String())
	}
	requireCode(t, h.Do(http.MethodPost, path, s.driver, nil, move.IdempotencyHeader, idemKey()), http.StatusConflict, domain.CodeConflict)

	request := snapshotOf(t, h, s.rider, requestID, "")["request"].(map[string]any)
	if request["preferredDriver"].(map[string]any)["state"] != machine.MpPreferredMarketOpen {
		t.Fatalf("a decline with consent opens the market at once: %v", request)
	}
	if payload := outboxPayload(t, h, "mp.request.preferred_driver_declined", requestID); payload["requesterId"] != nil ||
		payload["driverId"] != s.driver.UserID.String() {
		t.Fatalf("the decline event reaches the driver alone: %v", payload)
	}

	var actions int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM mp.driver_standing_actions WHERE driver_id = $1`, s.driver.UserID).Scan(&actions); err != nil {
		t.Fatal(err)
	}
	standingAfter, err := h.Marketplace.Store().DriverStandingAggregate(context.Background(), h.Pool, s.driver.UserID, 90)
	if err != nil {
		t.Fatal(err)
	}
	if actions != 0 || *standingAfter != *standingBefore {
		t.Fatalf("a decline is never recorded against the driver: actions %d, standing %+v → %+v", actions, standingBefore, standingAfter)
	}

	// The driver bids on an ordinary request as before, with the same
	// reliability as before the decline (one completed ride).
	rider := h.Rider()
	plain, _ := publishAt(t, h, rider, 0)
	s.parkNamed(t)
	bidNow(t, h, s.driver, plain["requestId"].(string), moneyMinor(t, plain, "minimumFareMinor"))
	reliability := offersOf(t, snapshotOf(t, h, rider, plain["requestId"].(string), ""))[0]["reliability"].(map[string]any)
	if reliability["sampleSize"] != float64(1) || reliability["driverCancellations"] != float64(0) {
		t.Fatalf("a decline does not touch reliability: %v", reliability)
	}
}

// TestPreferredDriverOffersThroughTheOrdinaryPath: nothing is waived for the
// named driver. Moving, they cannot bid (stationary bidding); below the
// stored floor they are refused; without the wallet for the 10% they are
// refused; a valid offer reserves exactly the 10%. A live offer keeps the
// window where it is past its end (the market stays closed); once the offer
// is withdrawn the sweep opens the market; the rider's selection captures the
// commission exactly once.
func TestPreferredDriverOffersThroughTheOrdinaryPath(t *testing.T) {
	h := confidenceHarness(t)
	s := setupSavedDriver(t, h)
	other := h.Driver()
	parkDriver(t, h, other, testutil.PlaceAt(testutil.PickupFixture(), 300))
	view, requestID, minimum := s.publishPreferred(t, h, true)

	s.trip.drive(t, testutil.PickupFixture())
	moving := tryBid(t, h, s.driver, requestID, minimum)
	requireCode(t, moving, domain.StatusFor(domain.CodeSlotUnavailable), domain.CodeSlotUnavailable)

	s.parkNamed(t)
	requireCode(t, tryBid(t, h, s.driver, requestID, minimum-1), http.StatusUnprocessableEntity, domain.CodeFareOutOfBounds)
	if maximum := moneyMinor(t, view, "maximumFareMinor"); maximum > 0 {
		requireCode(t, tryBid(t, h, s.driver, requestID, maximum+1), http.StatusUnprocessableEntity, domain.CodeFareOutOfBounds)
	}
	h.Wallet.SetSpendable(s.driver.UserID, 0)
	broke := submitBidAtEpoch(t, h, s.driver, requestID, minimum)
	requireCode(t, broke, domain.StatusFor(domain.CodeInsufficientSpendable), domain.CodeInsufficientSpendable)

	amount := minimum + 500
	bid := bidNow(t, h, s.driver, requestID, amount)
	if moneyMinor(t, bid, "commissionMinor") != marketplace.CommissionMinor(amount) || bid["holdState"] != marketplace.HoldStateHeld {
		t.Fatalf("the named driver's offer reserves exactly the 10%%: %v", bid)
	}

	// Past the window (but inside the bid's own expiry), a live offer keeps
	// the market closed.
	h.Clock.Advance(65 * time.Second)
	_ = h.Marketplace.Sweep(context.Background())
	if state := snapshotOf(t, h, s.rider, requestID, "")["request"].(map[string]any)["preferredDriver"].(map[string]any)["state"]; state != machine.MpPreferredExclusive {
		t.Fatalf("a live preferred offer keeps the window: %v", state)
	}
	(&tripFixture{h: h, driver: other, seq: 5}).park(t, testutil.PlaceAt(testutil.PickupFixture(), 300), time.Second)
	requireCode(t, tryBid(t, h, other, requestID, amount), http.StatusNotFound, domain.CodeNotFound)

	// Withdrawn: the sweep opens the market (consent was given).
	requireStatus(t, h.Do(http.MethodPost, "/mp/bids/"+bid["bidId"].(string)+"/withdraw", s.driver, map[string]any{},
		move.IdempotencyHeader, idemKey()), http.StatusOK)
	_ = h.Marketplace.Sweep(context.Background())
	if state := snapshotOf(t, h, s.rider, requestID, "")["request"].(map[string]any)["preferredDriver"].(map[string]any)["state"]; state != machine.MpPreferredMarketOpen {
		t.Fatalf("with the offer gone, the market opens: %v", state)
	}

	// The named driver offers again on the open market and is selected: the
	// commission is captured exactly once, at selection.
	s.parkNamed(t)
	again := bidNow(t, h, s.driver, requestID, amount)
	selected := doSelect(t, h, s.rider, requestID, map[string]any{
		"bidId": again["bidId"], "requestVersion": requestVersionOf(t, h, s.rider, requestID), "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	reservation := again["reservationId"].(string)
	if h.Wallet.CapturesByReservation[reservation] != 1 || h.Wallet.CapturedTotal(reservation) != marketplace.CommissionMinor(amount) {
		t.Fatalf("captured once, exactly the 10%%: captures %d, total %d", h.Wallet.CapturesByReservation[reservation], h.Wallet.CapturedTotal(reservation))
	}
}

// submitBidAtEpoch places a current-slot bid at the driver's current epoch
// WITHOUT topping up the wallet first.
func submitBidAtEpoch(t *testing.T, h *testutil.Harness, driver testutil.Actor, requestID string, amount int64) *httptest.ResponseRecorder {
	t.Helper()
	view := driverViewOf(t, h, driver, requestID)
	epoch := view["eligibility"].(map[string]any)["availabilityEpoch"].(float64)
	return h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId":         requestID,
		"requestRevision":   1,
		"amountMinor":       moneyBody(amount),
		"slot":              "current",
		"availabilityEpoch": int64(epoch),
	}, move.IdempotencyHeader, idemKey())
}

// TestPreferredDriverGuards: a driver can be saved only from a completed
// trip; naming requires a saved, opted-in driver and explicit fallback
// consent; the capability is deny-by-default (saving, opting in and naming
// are refused while the flag is off — opting OUT and removing never are);
// removing a saved driver ends naming them.
func TestPreferredDriverGuards(t *testing.T) {
	h := confidenceHarness(t)
	rider, driver := h.Rider(), h.Driver()
	goOnline(t, h, driver)

	// Awarded but not completed: not yet saveable.
	f := tripWith(t, h, rider, driver, 1)
	requireCode(t, saveFavourite(t, h, rider, f.requestID), http.StatusConflict, domain.CodeConflict)
	f.start(t)
	f.complete(t)
	requireCode(t, saveFavourite(t, h, h.Rider(), f.requestID), http.StatusNotFound, domain.CodeNotFound)
	requireStatus(t, saveFavourite(t, h, rider, f.requestID), http.StatusCreated)
	requireStatus(t, saveFavourite(t, h, rider, f.requestID), http.StatusOK)

	named := func(fallback any, extra map[string]any) map[string]any {
		body := map[string]any{"driverId": driver.UserID.String()}
		if fallback != nil {
			body["fallbackToMarket"] = fallback
		}
		for k, v := range extra {
			body[k] = v
		}
		return map[string]any{"preferredDriver": body}
	}
	// Saved but not opted in: refused without saying why.
	refused := publishWith(t, h, rider, named(true, nil))
	requireCode(t, refused, http.StatusConflict, domain.CodeConflict)
	if decode(t, refused)["details"].(map[string]any)["reason"] != marketplace.CloseReasonPreferredUnavailable {
		t.Fatalf("an opted-out driver is simply unavailable: %s", refused.Body.String())
	}
	requireStatus(t, setPreferredOptIn(t, h, driver, true), http.StatusOK)
	requireCode(t, publishWith(t, h, rider, named(nil, nil)), http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	requireCode(t, publishWith(t, h, rider, named(true, map[string]any{"priority": "high"})), http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	stranger := h.Rider()
	notSaved := publishWith(t, h, stranger, named(true, nil))
	requireCode(t, notSaved, http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	if decode(t, notSaved)["details"].(map[string]any)["reason"] != "not_a_saved_driver" {
		t.Fatalf("only a saved driver can be named: %s", notSaved.Body.String())
	}

	list := h.Do(http.MethodGet, "/mp/favourite-drivers", rider, nil)
	requireStatus(t, list, http.StatusOK)
	items := decode(t, list)["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["canRequest"] != true || items[0].(map[string]any)["driverId"] != driver.UserID.String() {
		t.Fatalf("the saved driver is listed and can be asked: %v", items)
	}

	// Deny by default: with the flag off nothing new opens.
	setFlagForCity(t, h, cityconfig.FlagMarketplacePreferredDrivers, false)
	requireCode(t, publishWith(t, h, rider, named(true, nil)), http.StatusNotFound, domain.CodeFeatureDisabled)
	requireCode(t, saveFavourite(t, h, rider, f.requestID), http.StatusNotFound, domain.CodeFeatureDisabled)
	list = h.Do(http.MethodGet, "/mp/favourite-drivers", rider, nil)
	requireStatus(t, list, http.StatusOK)
	if item := decode(t, list)["items"].([]any)[0].(map[string]any); item["canRequest"] != false {
		t.Fatalf("with the capability off, nobody can be asked: %v", item)
	}
	requireStatus(t, setPreferredOptIn(t, h, driver, false), http.StatusOK)
	requireCode(t, setPreferredOptIn(t, h, driver, true), http.StatusNotFound, domain.CodeFeatureDisabled)
	setFlagForCity(t, h, cityconfig.FlagMarketplacePreferredDrivers, true)
	requireStatus(t, setPreferredOptIn(t, h, driver, true), http.StatusOK)

	// Removing is always allowed and ends naming.
	removeKey := idemKey()
	removed := h.Do(http.MethodPost, "/mp/favourite-drivers/"+driver.UserID.String()+"/remove", rider, nil, move.IdempotencyHeader, removeKey)
	requireStatus(t, removed, http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/mp/favourite-drivers/"+driver.UserID.String()+"/remove", rider, nil, move.IdempotencyHeader, removeKey), http.StatusOK)
	requireCode(t, h.Do(http.MethodPost, "/mp/favourite-drivers/"+driver.UserID.String()+"/remove", rider, nil, move.IdempotencyHeader, idemKey()),
		http.StatusNotFound, domain.CodeNotFound)
	requireCode(t, publishWith(t, h, rider, named(true, nil)), http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	if outboxCount(t, h, "mp.favourite_driver.removed", decodeFavouriteID(t, h, rider.UserID.String())) != 1 {
		t.Fatal("the removal is published once")
	}
}

// decodeFavouriteID reads a rider's (only) saved-driver row id.
func decodeFavouriteID(t *testing.T, h *testutil.Harness, riderID string) string {
	t.Helper()
	var id string
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT id::text FROM mp.favourite_drivers WHERE rider_id = $1`, riderID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// TestSaveFavouriteConcurrentSavesPublishOnce: concurrent saves of the same
// completed trip's driver (each with its own idempotency key) converge on ONE
// active pair at version 1 and exactly one mp.favourite_driver.saved event;
// every other caller is told the driver was already saved (200).
func TestSaveFavouriteConcurrentSavesPublishOnce(t *testing.T) {
	h := confidenceHarness(t)
	rider, driver := h.Rider(), h.Driver()
	goOnline(t, h, driver)
	f := completedTripWith(t, h, rider, driver, 1)

	const callers = 8
	statuses := make([]int, callers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			statuses[i] = h.Do(http.MethodPost, "/mp/favourite-drivers", rider, map[string]any{"requestId": f.requestID},
				move.IdempotencyHeader, idemKey()).Code
		}(i)
	}
	close(start)
	wg.Wait()

	created := 0
	for _, status := range statuses {
		switch status {
		case http.StatusCreated:
			created++
		case http.StatusOK:
		default:
			t.Fatalf("every concurrent save succeeds: %v", statuses)
		}
	}
	id := decodeFavouriteID(t, h, rider.UserID.String())
	var version int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT version FROM mp.favourite_drivers WHERE id = $1`, id).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if created != 1 || version != 1 || outboxCount(t, h, "mp.favourite_driver.saved", id) != 1 {
		t.Fatalf("one save, one event: created %d of %v, version %d, events %d",
			created, statuses, version, outboxCount(t, h, "mp.favourite_driver.saved", id))
	}
}
