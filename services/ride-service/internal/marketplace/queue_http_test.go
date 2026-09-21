package marketplace_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// currentSlotAward publishes a request, parks the driver, funds a current-slot
// bid and selects it — returning the request id, the execution ride id and the
// one-time pickup PIN the select response revealed.
func currentSlotAward(t *testing.T, h *testutil.Harness, rider, driver testutil.Actor) (requestID, rideID, pin string) {
	t.Helper()
	origin := testutil.PickupFixture()
	view, _ := publishRoute(t, h, rider, origin, testutil.PlaceAt(origin, 3_000), 0)
	requestID = view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")
	parkDriver(t, h, driver, origin)
	bid := fundedCurrentBid(t, h, driver, requestID, amount)
	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bid["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	pin, _ = decode(t, selected)["pickupPin"].(string)
	award := awardRow(t, h, requestID)
	if award.ExecutionID == nil {
		t.Fatal("the current-slot award has no execution ride")
	}
	rideID = award.ExecutionID.String()
	return requestID, rideID, pin
}

// TestQueueProjectionAuthorizedAndVersioned covers the G07 closure conditions:
// the owner gets the composed state, a foreign rider gets 404, the projection
// carries an asOf the client can detect as stale, and the version increments on
// a real state change (promotion).
func TestQueueProjectionAuthorizedAndVersioned(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	f := setupQueuedAward(t, h)

	// Authorized fetch: the owner of the queued request sees the composed view.
	rec := h.Do(http.MethodGet, "/mp/requests/"+f.requestB+"/queue", f.riderB, nil)
	requireStatus(t, rec, http.StatusOK)
	v := decode(t, rec)
	if v["status"] != "queued" && v["status"] != "promoting" {
		t.Fatalf("queued status: got %v", v["status"])
	}
	driver, _ := v["driver"].(map[string]any)
	if driver == nil || driver["profileStatus"] != "unavailable" {
		t.Fatalf("driver projection: %v", v["driver"])
	}
	if _, ok := v["driverFirstName"].(string); !ok {
		t.Fatalf("driverFirstName missing: %v", v)
	}
	fare, _ := v["fareMinor"].(map[string]any)
	if fare == nil || int64(fare["amountMinor"].(float64)) != f.amountB {
		t.Fatalf("queue fare: got %v, want %d", v["fareMinor"], f.amountB)
	}
	if v["pickupWindow"] == nil {
		t.Fatalf("queued view must carry the consented pickup window: %v", v)
	}
	actions, _ := v["actions"].(map[string]any)
	if actions == nil || actions["canCancel"] != true {
		t.Fatalf("queued actions: %v", v["actions"])
	}
	version1 := int(v["version"].(float64))
	asOf1 := v["asOf"].(string)

	// Foreign rider: rider A (owns request A, not B) and a brand-new stranger
	// both learn nothing — 404, existence not leaked.
	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+f.requestB+"/queue", f.riderA, nil),
		http.StatusNotFound, domain.CodeNotFound)
	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+f.requestB+"/queue", h.Rider(), nil),
		http.StatusNotFound, domain.CodeNotFound)

	// Stale detection: advancing the clock changes asOf, so a client can tell
	// its cached projection is older than the server's.
	h.Clock.Set(h.Clock.Now().Add(45 * time.Second))
	rec = h.Do(http.MethodGet, "/mp/requests/"+f.requestB+"/queue", f.riderB, nil)
	requireStatus(t, rec, http.StatusOK)
	asOf2 := decode(t, rec)["asOf"].(string)
	if asOf2 == asOf1 {
		t.Fatalf("asOf did not advance with the clock: %s", asOf2)
	}
	t1, _ := time.Parse(time.RFC3339, asOf1)
	t2, _ := time.Parse(time.RFC3339, asOf2)
	if !t2.After(t1) {
		t.Fatalf("asOf must move forward: %s -> %s", asOf1, asOf2)
	}

	// Version increments on a real state change: completing trip A promotes B,
	// moving the request awarded -> execution (a version bump).
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/arrived", f.driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/verify-pin", f.driver, map[string]any{"pin": f.pinA}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/start", f.driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/complete", f.driver, map[string]any{}), http.StatusOK)

	rec = h.Do(http.MethodGet, "/mp/requests/"+f.requestB+"/queue", f.riderB, nil)
	requireStatus(t, rec, http.StatusOK)
	v = decode(t, rec)
	if got := int(v["version"].(float64)); got <= version1 {
		t.Fatalf("version must increment after promotion: %d -> %d", version1, got)
	}
	if v["status"] != "assigned" && v["status"] != "arrived" && v["status"] != "in_progress" {
		t.Fatalf("status after promotion: got %v, want a promoted state", v["status"])
	}
}

// TestQueueBeforeAwardIsNotFound: a request with no award has nothing to track.
func TestQueueBeforeAwardIsNotFound(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	view, _ := publishRoute(t, h, rider, testutil.PickupFixture(), testutil.PlaceAt(testutil.PickupFixture(), 3_000), 0)
	requestID := view["requestId"].(string)
	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+requestID+"/queue", rider, nil),
		http.StatusNotFound, domain.CodeNotFound)
}

// TestWinnerAndOfferDriverConsistent (G09): the driver a rider sees in the
// bidding-time offer and in the post-selection queue projection are the same,
// and neither fabricates a rating — profileStatus says "unavailable" honestly.
func TestWinnerAndOfferDriverConsistent(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	origin := testutil.PickupFixture()
	view, _ := publishRoute(t, h, rider, origin, testutil.PlaceAt(origin, 3_000), 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")
	parkDriver(t, h, driver, origin)
	bid := fundedCurrentBid(t, h, driver, requestID, amount)

	// Offer projection (during bidding).
	snap := decode(t, h.Do(http.MethodGet, "/mp/requests/"+requestID, rider, nil))
	offers, _ := snap["offers"].([]any)
	if len(offers) == 0 {
		t.Fatalf("no offers in snapshot: %v", snap)
	}
	offerDriver := offers[0].(map[string]any)["driver"].(map[string]any)
	if offerDriver["profileStatus"] != "unavailable" {
		t.Fatalf("offer driver must be honestly unavailable: %v", offerDriver)
	}
	// No fabricated rating: the placeholder is the "–" no-value marker, never a
	// numeric-looking rating presented as real.
	if rating, _ := offerDriver["rating"].(string); rating != "–" {
		t.Fatalf("offer rating must be the no-value marker, got %q", rating)
	}

	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bid["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)

	// Winner projection (after selection): the queue view's driver.
	q := decode(t, h.Do(http.MethodGet, "/mp/requests/"+requestID+"/queue", rider, nil))
	queueDriver := q["driver"].(map[string]any)
	if queueDriver["displayName"] != offerDriver["displayName"] {
		t.Fatalf("winner display %v != offer display %v", queueDriver["displayName"], offerDriver["displayName"])
	}
	if queueDriver["profileStatus"] != "unavailable" {
		t.Fatalf("winner driver must be honestly unavailable: %v", queueDriver)
	}
}
