package marketplace_test

import (
	"context"
	"net/http"
	"regexp"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

var fourDigits = regexp.MustCompile(`^[0-9]{4}$`)

// pinAppearsInOutbox reports whether the plaintext PIN appears as a JSON string
// value in any outbox event payload. Amounts serialize as bare numbers, so
// matching the QUOTED form ("1234") cannot false-positive on a numeric field —
// it only fires if the PIN actually leaked as a string somewhere.
func pinLeakedToOutbox(t *testing.T, h *testutil.Harness, pin string) bool {
	t.Helper()
	var count int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM public.outbox_events
		 WHERE city_id = $2 AND payload::text LIKE '%"' || $1 || '"%'`,
		pin, h.CityID).Scan(&count); err != nil {
		t.Fatalf("failed to scan outbox for the PIN: %v", err)
	}
	return count > 0
}

// TestPinRetrievalCurrentSlot covers the four PIN closure cases for a
// current-slot ride: entitled rider gets it, foreign rider 404, wrong lifecycle
// refused, and the PIN never lands in an event payload.
func TestPinRetrievalCurrentSlot(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()
	requestID, rideID, pin := currentSlotAward(t, h, rider, driver)
	if !fourDigits.MatchString(pin) {
		t.Fatalf("select did not reveal a PIN: %q", pin)
	}

	// 1) Entitled rider gets it, and it is the REAL PIN (it verifies the ride).
	rec := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/pin", rider, nil)
	requireStatus(t, rec, http.StatusOK)
	body := decode(t, rec)
	if body["pin"] != pin {
		t.Fatalf("retrieved PIN %v does not match the revealed PIN %q", body["pin"], pin)
	}
	if body["rideId"] != rideID {
		t.Fatalf("retrieved rideId %v != %q", body["rideId"], rideID)
	}

	// 2) Foreign rider learns nothing (404), and a driver role cannot fetch it.
	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+requestID+"/pin", h.Rider(), nil),
		http.StatusNotFound, domain.CodeNotFound)
	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+requestID+"/pin", driver, nil),
		http.StatusNotFound, domain.CodeNotFound)

	// 4) The PIN never appears in any outbox event payload.
	if pinLeakedToOutbox(t, h, pin) {
		t.Fatalf("the PIN %q leaked into an outbox event payload", pin)
	}

	// 3) Wrong lifecycle: once the ride has started (PIN spent) retrieval is refused.
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID+"/arrived", driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID+"/verify-pin", driver, map[string]any{"pin": pin}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID+"/start", driver, map[string]any{}), http.StatusOK)
	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+requestID+"/pin", rider, nil),
		http.StatusConflict, domain.CodeConflict)

	// Still never leaked, after the whole lifecycle ran.
	if pinLeakedToOutbox(t, h, pin) {
		t.Fatalf("the PIN %q leaked into an outbox event payload during the ride", pin)
	}
}

// TestPinRetrievalRateLimited: a rider fetching their own PIN too fast is
// throttled (429) without the ride advancing.
func TestPinRetrievalRateLimited(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	requestID, _, pin := currentSlotAward(t, h, rider, h.Driver())
	_ = pin

	for i := 0; i < 5; i++ {
		requireStatus(t, h.Do(http.MethodGet, "/mp/requests/"+requestID+"/pin", rider, nil), http.StatusOK)
	}
	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+requestID+"/pin", rider, nil),
		http.StatusTooManyRequests, domain.CodeRateLimited)
}

// TestPinRetrievalAfterPromotion: a promotion-created ride has no /select
// response to carry its PIN, so retrieval over REST is the only path. The
// rider gets the real PIN (it verifies the promoted ride) and it never leaked.
func TestPinRetrievalAfterPromotion(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	f := setupQueuedAward(t, h)

	// Complete trip A to promote the queued job B (creates B's execution ride).
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/arrived", f.driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/verify-pin", f.driver, map[string]any{"pin": f.pinA}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/start", f.driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideA.String()+"/complete", f.driver, map[string]any{}), http.StatusOK)

	award := awardRow(t, h, f.requestB)
	if award.ExecutionID == nil {
		t.Fatal("promotion did not create the execution ride")
	}
	rideB := award.ExecutionID.String()

	rec := h.Do(http.MethodGet, "/mp/requests/"+f.requestB+"/pin", f.riderB, nil)
	requireStatus(t, rec, http.StatusOK)
	pin, _ := decode(t, rec)["pin"].(string)
	if !fourDigits.MatchString(pin) {
		t.Fatalf("promotion PIN retrieval returned %q, want 4 digits", pin)
	}
	if pinLeakedToOutbox(t, h, pin) {
		t.Fatalf("the promoted-ride PIN %q leaked into an outbox event payload", pin)
	}

	// It is the REAL PIN: it verifies the promoted ride. Move the driver to
	// pickup B first (they finished trip A elsewhere) so the arrival geofence
	// passes.
	pickupB := testutil.PlaceAt(testutil.PickupFixture(), 4_000)
	// The driver spent real time finishing trip A and driving to pickup B, so
	// advance the clock before reporting the new position — an instant 4 km jump
	// would (rightly) be rejected as an implausible speed.
	h.Clock.Set(h.Clock.Now().Add(15 * time.Minute))
	now := h.Clock.Now()
	ingestPoints(t, h, f.driver, []map[string]any{point(100, pickupB, now, 0)})
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideB+"/arrived", f.driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideB+"/verify-pin", f.driver, map[string]any{"pin": pin}), http.StatusOK)

	// Foreign rider still gets nothing.
	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+f.requestB+"/pin", f.riderA, nil),
		http.StatusNotFound, domain.CodeNotFound)
}
