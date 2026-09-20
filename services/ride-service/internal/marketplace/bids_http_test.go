package marketplace_test

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// TestBidReservesBeforeLive: the wallet reservation happens BEFORE the bid row
// exists, so a wallet that says no leaves no bid behind.
func TestBidReservesBeforeLive(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := asInt64(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())

	// A wallet outage refuses the bid and no bid row is written.
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	h.Wallet.FailReserve = errors.New("wallet down")
	recorder := submitBid(t, h, driver, requestID, amount, "")
	if recorder.Code == http.StatusCreated {
		t.Fatalf("a bid must not go live when the reservation failed: %s", recorder.Body.String())
	}
	request := requestRow(t, h, requestID)
	live, err := h.Marketplace.Store().LiveBidCountForRequest(context.Background(), h.Marketplace.Store().Pool(), request.ID)
	if err != nil {
		t.Fatal(err)
	}
	if live != 0 {
		t.Fatalf("live bids after failed reserve: got %d, want 0", live)
	}
	if h.Wallet.ReserveCalls == 0 {
		t.Fatal("the wallet was never asked before refusing the bid")
	}
	h.Wallet.FailReserve = nil

	// Success: the hold exists and the bid is live, funded by that hold.
	success := submitBid(t, h, driver, requestID, amount, "")
	requireStatus(t, success, http.StatusCreated)
	bidView := decode(t, success)
	commission := marketplace.CommissionMinor(amount)
	if got := asInt64(t, bidView, "commissionMinor"); got != commission {
		t.Fatalf("commission: got %d, want %d", got, commission)
	}
	if got := asInt64(t, bidView, "netMinor"); got != amount-commission {
		t.Fatalf("net: got %d, want %d", got, amount-commission)
	}
	holds := h.Wallet.Holds()
	hold, ok := holds[bidView["reservationId"].(string)]
	if !ok {
		t.Fatal("the bid's reservation does not exist in the wallet")
	}
	if hold.AmountMinor != commission || hold.State != machine.MpHoldActive {
		t.Fatalf("hold: %+v, want active at %d", hold, commission)
	}
}

// TestBidInsufficientSpendable: a spendable balance below the commission
// answers insufficient_spendable with the exact shortfall.
func TestBidInsufficientSpendable(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := asInt64(t, view, "minimumFareMinor")
	commission := marketplace.CommissionMinor(amount)

	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, commission-1)

	recorder := submitBid(t, h, driver, requestID, amount, "")
	requireCode(t, recorder, http.StatusUnprocessableEntity, domain.CodeInsufficientSpendable)
	details := decode(t, recorder)["details"].(map[string]any)
	if int64(details["shortfallMinor"].(float64)) != 1 {
		t.Fatalf("shortfall: got %v, want 1", details["shortfallMinor"])
	}
}

// TestOneLiveBidPerDriverPerRequest: two concurrent submissions by the same
// driver on the same request — exactly one wins; the loser's reservation is
// not left holding money.
func TestOneLiveBidUnderConcurrency(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := asInt64(t, view, "minimumFareMinor")
	commission := marketplace.CommissionMinor(amount)

	parkDriver(t, h, driver, testutil.PickupFixture())
	start := 10 * commission
	h.Wallet.SetSpendable(driver.UserID, start)

	codes := make([]int, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			recorder := submitBid(t, h, driver, requestID, amount, "")
			codes[index] = recorder.Code
		}(i)
	}
	wg.Wait()

	created, refused := 0, 0
	for _, code := range codes {
		switch {
		case code == http.StatusCreated:
			created++
		case code >= 400:
			refused++
		}
	}
	if created != 1 || refused != 1 {
		t.Fatalf("exactly one submission must win: statuses %v", codes)
	}

	request := requestRow(t, h, requestID)
	live, err := h.Marketplace.Store().LiveBidCountForRequest(context.Background(), h.Marketplace.Store().Pool(), request.ID)
	if err != nil {
		t.Fatal(err)
	}
	if live != 1 {
		t.Fatalf("live bids: got %d, want 1 (the partial unique index is the authority)", live)
	}
	// The winner holds one commission; whatever the loser reserved was
	// released again — the driver is out exactly one commission.
	if got := h.Wallet.Spendable(driver.UserID); got != start-commission {
		t.Fatalf("spendable after the race: got %d, want %d", got, start-commission)
	}
}

// TestBidCap: the fixture allows 3 live bids per driver; the fourth answers
// bid_cap_reached.
func TestBidCap(t *testing.T) {
	h := newHarness(t)
	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 10_000_000)

	var lastRequest string
	var amount int64
	for i := 0; i < 3; i++ {
		view, _ := publishAt(t, h, h.Rider(), 0)
		lastRequest = view["requestId"].(string)
		amount = asInt64(t, view, "minimumFareMinor")
		recorder := submitBid(t, h, driver, lastRequest, amount, "")
		requireStatus(t, recorder, http.StatusCreated)
	}
	view, _ := publishAt(t, h, h.Rider(), 0)
	amount = asInt64(t, view, "minimumFareMinor")
	recorder := submitBid(t, h, driver, view["requestId"].(string), amount, "")
	requireCode(t, recorder, http.StatusTooManyRequests, domain.CodeBidCapReached)
}

// TestReviseRaiseFailureKeepsOldBid: a raise adjusts the hold FIRST — when the
// wallet refuses, the old bid and its old hold stand untouched.
func TestReviseRaiseFailureKeepsOldBid(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := asInt64(t, view, "minimumFareMinor")
	commission := marketplace.CommissionMinor(amount)

	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	created := submitBid(t, h, driver, requestID, amount, "")
	requireStatus(t, created, http.StatusCreated)
	bidView := decode(t, created)
	bidID := bidView["bidId"].(string)
	reservationID := bidView["reservationId"].(string)

	// Inside the cooldown the revision is refused outright.
	tooSoon := h.Do(http.MethodPost, "/mp/bids/"+bidID+"/revise", driver, map[string]any{
		"amountMinor":     amount + 2_000,
		"expectedVersion": 1,
	}, move.IdempotencyHeader, idemKey())
	requireCode(t, tooSoon, http.StatusTooManyRequests, domain.CodeBidRevisionCooldown)

	h.Clock.Advance(20 * time.Second)

	h.Wallet.FailAdjust = errors.New("wallet down")
	failed := h.Do(http.MethodPost, "/mp/bids/"+bidID+"/revise", driver, map[string]any{
		"amountMinor":     amount + 2_000,
		"expectedVersion": 1,
	}, move.IdempotencyHeader, idemKey())
	if failed.Code == http.StatusOK {
		t.Fatalf("a raise whose hold adjustment failed must not change the bid: %s", failed.Body.String())
	}
	h.Wallet.FailAdjust = nil

	bid := bidRow(t, h, bidID)
	if bid.AmountMinor != amount || bid.BidVersion != 1 || bid.State != machine.MpBidSubmitted {
		t.Fatalf("the old bid changed after a failed raise: %+v", bid)
	}
	if hold := h.Wallet.Holds()[reservationID]; hold.AmountMinor != commission {
		t.Fatalf("the old hold changed after a failed raise: %+v", hold)
	}

	// With the wallet healthy the raise lands: hold first, then the row.
	raised := h.Do(http.MethodPost, "/mp/bids/"+bidID+"/revise", driver, map[string]any{
		"amountMinor":     amount + 2_000,
		"expectedVersion": 1,
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, raised, http.StatusOK)
	raisedView := decode(t, raised)
	if asInt64(t, raisedView, "bidVersion") != 2 {
		t.Fatalf("bidVersion after raise: got %v, want 2", raisedView["bidVersion"])
	}
	newCommission := marketplace.CommissionMinor(amount + 2_000)
	if hold := h.Wallet.Holds()[reservationID]; hold.AmountMinor != newCommission {
		t.Fatalf("hold after raise: got %d, want %d", hold.AmountMinor, newCommission)
	}
}

// TestWithdrawReleasesOnce: withdrawing releases the hold exactly once, and a
// replay of the same idempotency key answers the stored response without a
// second release.
func TestWithdrawReleasesOnce(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := asInt64(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	created := submitBid(t, h, driver, requestID, amount, "")
	requireStatus(t, created, http.StatusCreated)
	bidView := decode(t, created)
	bidID := bidView["bidId"].(string)
	reservationID := bidView["reservationId"].(string)

	key := idemKey()
	first := h.Do(http.MethodPost, "/mp/bids/"+bidID+"/withdraw", driver, nil, move.IdempotencyHeader, key)
	requireStatus(t, first, http.StatusOK)
	replay := h.Do(http.MethodPost, "/mp/bids/"+bidID+"/withdraw", driver, nil, move.IdempotencyHeader, key)
	requireStatus(t, replay, http.StatusOK)
	if first.Body.String() != replay.Body.String() {
		t.Fatalf("a replay must answer byte-identically:\n%s\n%s", first.Body.String(), replay.Body.String())
	}

	if releases := releasesFor(h, reservationID); releases != 1 {
		t.Fatalf("releases after withdraw + replay: got %d, want exactly 1", releases)
	}
	if bid := bidRow(t, h, bidID); bid.State != machine.MpBidWithdrawn {
		t.Fatalf("bid state: got %s, want withdrawn", bid.State)
	}

	// A fresh key against the dead bid is an honest conflict, not a release.
	again := h.Do(http.MethodPost, "/mp/bids/"+bidID+"/withdraw", driver, nil, move.IdempotencyHeader, idemKey())
	requireCode(t, again, http.StatusConflict, domain.CodeBidNotLive)
	if releases := releasesFor(h, reservationID); releases != 1 {
		t.Fatalf("releases after conflicting withdraw: got %d, want 1", releases)
	}
}

// TestMyBidsCarriesHoldState: the driver's list derives each hold's state
// from the bid lifecycle.
func TestMyBidsCarriesHoldState(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	amount := asInt64(t, view, "minimumFareMinor")
	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	created := submitBid(t, h, driver, view["requestId"].(string), amount, "")
	requireStatus(t, created, http.StatusCreated)

	recorder := h.Do(http.MethodGet, "/mp/bids/mine", driver, nil)
	requireStatus(t, recorder, http.StatusOK)
	body := decode(t, recorder)
	bids := body["bids"].([]any)
	if len(bids) != 1 {
		t.Fatalf("bids: got %d, want 1", len(bids))
	}
	entry := bids[0].(map[string]any)
	if entry["holdState"] != machine.MpHoldActive {
		t.Fatalf("holdState: got %v, want active", entry["holdState"])
	}
}
