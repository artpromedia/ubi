package marketplace_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// TestQuoteBoundsAreTheMaxOfThreeFloors: floor = max(absolute, cost-based,
// bps-of-suggested); ceiling = bps-of-suggested; suggested sits inside.
func TestQuoteBounds(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()

	quote := quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture())

	suggested := asInt64(t, quote, "suggestedFareMinor")
	minimum := asInt64(t, quote, "minimumFareMinor")
	maximum := asInt64(t, quote, "maximumFareMinor")

	// The fixture policy: absolute 40,000, cost 45,000, floor 7,000 bps,
	// ceiling 20,000 bps.
	expectedFloor := int64(45_000)
	if bps := suggested * 7_000 / 10_000; bps > expectedFloor {
		expectedFloor = bps
	}
	if minimum != expectedFloor {
		t.Fatalf("minimum: got %d, want %d (suggested %d)", minimum, expectedFloor, suggested)
	}
	if want := suggested * 20_000 / 10_000; maximum != want {
		t.Fatalf("maximum: got %d, want %d", maximum, want)
	}
	if suggested < minimum || suggested > maximum {
		t.Fatalf("suggested %d is outside its own bounds [%d, %d]", suggested, minimum, maximum)
	}
	if quote["policyVersion"].(float64) != 1 {
		t.Fatalf("policyVersion: got %v, want 1", quote["policyVersion"])
	}
}

// TestQuoteFailsClosedWithoutPolicy: a city without a marketplace block
// answers 503 market_not_configured, never invented bounds.
func TestQuoteFailsClosedWithoutPolicy(t *testing.T) {
	h := testutil.NewHarness(t,
		testutil.WithFlag("marketplace_rides", true))
	rider := h.Rider()
	pickup, dropoff := testutil.PickupFixture(), testutil.DropoffFixture()
	path := "/mp/quote?service=ride&vehicleClass=go" +
		"&pickupLat=" + formatCoord(pickup.Lat) + "&pickupLng=" + formatCoord(pickup.Lng) +
		"&dropoffLat=" + formatCoord(dropoff.Lat) + "&dropoffLng=" + formatCoord(dropoff.Lng)
	recorder := h.Do(http.MethodGet, path, rider, nil)
	requireCode(t, recorder, http.StatusServiceUnavailable, domain.CodeMarketNotConfigured)
}

// TestPublishValidatesAgainstStoredBounds: the requested amount is judged
// against the STORED quote's bounds — below the floor and above the ceiling
// are refused with a structured, human-phrased field error, and the exact
// boundary values pass.
func TestPublishValidation(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()

	// Sentinels: -1 = floor-1, -2 = floor, -3 = ceiling, -4 = ceiling+1.
	publish := func(sentinel int64) *httptest.ResponseRecorder {
		quote := quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture())
		minimum := asInt64(t, quote, "minimumFareMinor")
		maximum := asInt64(t, quote, "maximumFareMinor")
		amount := sentinel
		switch sentinel {
		case -1:
			amount = minimum - 1
		case -2:
			amount = minimum
		case -3:
			amount = maximum
		case -4:
			amount = maximum + 1
		}
		return h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
			"quoteId":            quote["quoteId"],
			"requestedFareMinor": amount,
			"paymentMethodId":    "wallet",
		}, move.IdempotencyHeader, idemKey())
	}

	below := publish(-1)
	requireCode(t, below, http.StatusUnprocessableEntity, domain.CodeFareOutOfBounds)
	details, ok := decode(t, below)["details"].(map[string]any)
	if !ok {
		t.Fatalf("fare_out_of_bounds carried no details: %s", below.Body.String())
	}
	if details["field"] != "requestedFareMinor" {
		t.Fatalf("details.field: got %v", details["field"])
	}
	if _, ok := details["minimumMinor"].(float64); !ok {
		t.Fatalf("details carry no minimumMinor: %v", details)
	}
	if message, ok := details["message"].(string); !ok || message == "" {
		t.Fatalf("details carry no human message: %v", details)
	}

	above := publish(-4)
	requireCode(t, above, http.StatusUnprocessableEntity, domain.CodeFareOutOfBounds)

	atFloor := publish(-2)
	requireStatus(t, atFloor, http.StatusCreated)
	atCeiling := publish(-3)
	requireStatus(t, atCeiling, http.StatusCreated)
}

// TestRequestCap: the policy's maxOpenRequestsPerRequester (2 in the fixture)
// refuses a third open request with request_cap_reached.
func TestRequestCap(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()

	publishAt(t, h, rider, 0)
	publishAt(t, h, rider, 0)

	quote := quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture())
	recorder := h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": asInt64(t, quote, "minimumFareMinor"),
		"paymentMethodId":    "wallet",
	}, move.IdempotencyHeader, idemKey())
	requireCode(t, recorder, http.StatusTooManyRequests, domain.CodeRequestCapReached)
}

// TestReviseInvalidatesBidsAndReleasesHolds: a price revision bumps the
// revision, invalidates every live bid and releases each bid's hold exactly
// once through the wallet port.
func TestReviseInvalidatesBidsAndReleasesHolds(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := asInt64(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)

	bidRecorder := submitBid(t, h, driver, requestID, amount, "")
	requireStatus(t, bidRecorder, http.StatusCreated)
	bidView := decode(t, bidRecorder)
	reservationID := bidView["reservationId"].(string)

	// Wrong expected version first: optimistic concurrency answers 409.
	stale := h.Do(http.MethodPost, "/mp/requests/"+requestID+"/revise", rider, map[string]any{
		"requestedFareMinor": amount + 1_000,
		"expectedVersion":    99,
	}, move.IdempotencyHeader, idemKey())
	requireCode(t, stale, http.StatusConflict, domain.CodeVersionConflict)

	recorder := h.Do(http.MethodPost, "/mp/requests/"+requestID+"/revise", rider, map[string]any{
		"requestedFareMinor": amount + 1_000,
		"expectedVersion":    int(asInt64(t, view, "version")),
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, recorder, http.StatusOK)
	revised := decode(t, recorder)
	if asInt64(t, revised, "revision") != 2 {
		t.Fatalf("revision: got %v, want 2", revised["revision"])
	}

	bid := bidRow(t, h, bidView["bidId"].(string))
	if bid.State != machine.MpBidInvalidated {
		t.Fatalf("bid state after revision: got %s, want invalidated", bid.State)
	}
	if releases := releasesFor(h, reservationID); releases != 1 {
		t.Fatalf("hold releases after revision: got %d, want exactly 1", releases)
	}
}

// TestCancelReleasesBids: cancelling an open request closes it with
// reason=cancelled and releases every live bid's hold; a second cancel finds
// the request closed.
func TestCancelReleasesBids(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := asInt64(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	bidRecorder := submitBid(t, h, driver, requestID, amount, "")
	requireStatus(t, bidRecorder, http.StatusCreated)
	reservationID := decode(t, bidRecorder)["reservationId"].(string)

	recorder := h.Do(http.MethodPost, "/mp/requests/"+requestID+"/cancel", rider, nil,
		move.IdempotencyHeader, idemKey())
	requireStatus(t, recorder, http.StatusOK)
	cancelled := decode(t, recorder)
	if cancelled["state"] != machine.MpRequestCancelled {
		t.Fatalf("state after cancel: got %v", cancelled["state"])
	}
	if releases := releasesFor(h, reservationID); releases != 1 {
		t.Fatalf("hold releases after cancel: got %d, want 1", releases)
	}

	again := h.Do(http.MethodPost, "/mp/requests/"+requestID+"/cancel", rider, nil,
		move.IdempotencyHeader, idemKey())
	requireCode(t, again, http.StatusConflict, domain.CodeRequestClosed)
}

// TestSnapshotIsOwnerOnly: a request id in someone else's hands answers
// not_found, never the offers.
func TestSnapshotIsOwnerOnly(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	other := h.Rider()

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)

	owner := h.Do(http.MethodGet, "/mp/requests/"+requestID, rider, nil)
	requireStatus(t, owner, http.StatusOK)

	stranger := h.Do(http.MethodGet, "/mp/requests/"+requestID, other, nil)
	requireCode(t, stranger, http.StatusNotFound, domain.CodeNotFound)
}
