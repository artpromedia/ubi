package marketplace_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// TestExpirySweepReleasesOnce: an overdue bid is expired by the sweep and its
// hold released exactly once, however many times the sweep runs.
func TestExpirySweepReleasesOnce(t *testing.T) {
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

	// Past the fixture's bidExpirySec (120) but not the request's expiry (600).
	h.Clock.Advance(121 * time.Second)
	ctx := context.Background()
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}

	if bid := bidRow(t, h, bidID); bid.State != machine.MpBidExpired {
		t.Fatalf("bid state after sweep: got %s, want expired", bid.State)
	}
	if releases := releasesFor(h, reservationID); releases != 1 {
		t.Fatalf("releases after two sweeps: got %d, want exactly 1", releases)
	}
	// The request outlives its bids until its own deadline.
	if request := requestRow(t, h, requestID); request.State != machine.MpRequestOpen {
		t.Fatalf("request state: got %s, want still open", request.State)
	}

	// Past the request's own expiry, with zero live bids left, the sweep
	// closes it as no_offers.
	h.Clock.Advance(500 * time.Second)
	if err := h.Marketplace.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	request := requestRow(t, h, requestID)
	if request.State != machine.MpRequestNoOffers {
		t.Fatalf("request state after expiry: got %s, want no_offers", request.State)
	}
	if request.CloseReason != "no_offers" {
		t.Fatalf("close reason: got %q, want no_offers", request.CloseReason)
	}
}

// TestRequestExpiresNoOffers: a request that never attracted a bid closes as
// no_offers at its deadline.
func TestRequestExpiresNoOffers(t *testing.T) {
	h := newHarness(t)
	view, _ := publishAt(t, h, h.Rider(), 0)
	requestID := view["requestId"].(string)

	h.Clock.Advance(601 * time.Second)
	if err := h.Marketplace.Sweep(context.Background()); err != nil {
		t.Fatal(err)
	}
	if request := requestRow(t, h, requestID); request.State != machine.MpRequestNoOffers {
		t.Fatalf("request state: got %s, want no_offers", request.State)
	}
}

// TestEnvelopeExpansionPreservesBids: the progressive expansion grows the
// envelope after expandAfterSec when offers are scarce — WITHOUT bumping the
// revision, invalidating bids or touching holds.
func TestEnvelopeExpansionPreservesBids(t *testing.T) {
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
	reservationID := bidView["reservationId"].(string)

	before := requestRow(t, h, requestID)
	if before.EnvelopeRadiusM != 3_000 || before.EnvelopeStep != 0 {
		t.Fatalf("fixture envelope: %+v", before)
	}

	// One live bid < minOffersBeforeExpand (2), so the expansion is allowed.
	h.Clock.Advance(31 * time.Second)
	if err := h.Marketplace.Sweep(context.Background()); err != nil {
		t.Fatal(err)
	}

	after := requestRow(t, h, requestID)
	if after.EnvelopeStep != 1 {
		t.Fatalf("envelope step: got %d, want 1", after.EnvelopeStep)
	}
	if after.EnvelopeRadiusM != 5_000 { // 3000 + (9000-3000)*1/3
		t.Fatalf("envelope radius: got %d, want 5000", after.EnvelopeRadiusM)
	}
	if after.EnvelopeEtaSec != 900 { // 600 + (1500-600)*1/3
		t.Fatalf("envelope eta: got %d, want 900", after.EnvelopeEtaSec)
	}
	// The negotiation itself is untouched.
	if after.Revision != before.Revision {
		t.Fatalf("revision moved on an envelope-only change: %d → %d", before.Revision, after.Revision)
	}
	if bid := bidRow(t, h, bidView["bidId"].(string)); !machine.IsMpBidLive(bid.State) {
		t.Fatalf("bid state after expansion: got %s, want still live", bid.State)
	}
	if releases := releasesFor(h, reservationID); releases != 0 {
		t.Fatalf("holds released by an envelope expansion: got %d, want 0", releases)
	}
}
