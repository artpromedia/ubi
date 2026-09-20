package marketplace_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// newHarness builds the marketplace-enabled harness every test here uses.
func newHarness(t *testing.T, opts ...testutil.HarnessOption) *testutil.Harness {
	t.Helper()
	all := append([]testutil.HarnessOption{testutil.WithMarketplace()}, opts...)
	return testutil.NewHarness(t, all...)
}

// idemKey mints a fresh, valid Idempotency-Key.
func idemKey() string { return "test-" + uuid.NewString() }

// moveActor converts a harness actor into the service's actor type.
func moveActor(actor testutil.Actor) move.Actor {
	return move.Actor{UserID: actor.UserID, Role: actor.Role, CityID: actor.CityID}
}

// decode unmarshals a recorded body into a map for loose assertions.
func decode(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode %q: %v", recorder.Body.String(), err)
	}
	return body
}

func requireStatus(t *testing.T, recorder *httptest.ResponseRecorder, want int) {
	t.Helper()
	if recorder.Code != want {
		t.Fatalf("status: got %d, want %d (%s)", recorder.Code, want, recorder.Body.String())
	}
}

func requireCode(t *testing.T, recorder *httptest.ResponseRecorder, status int, code domain.Code) {
	t.Helper()
	requireStatus(t, recorder, status)
	body := decode(t, recorder)
	if body["code"] != string(code) {
		t.Fatalf("error code: got %v, want %s (%s)", body["code"], code, recorder.Body.String())
	}
}

// asInt64 reads a JSON number out of a decoded map.
func asInt64(t *testing.T, body map[string]any, key string) int64 {
	t.Helper()
	value, ok := body[key].(float64)
	if !ok {
		t.Fatalf("%s is not a number in %v", key, body)
	}
	return int64(value)
}

// testCurrency is the harness city's currency (the fixture's).
const testCurrency = "NGN"

// moneyBody builds the Money object a client sends for an amount.
func moneyBody(minor int64) map[string]any {
	return map[string]any{"amountMinor": minor, "currency": testCurrency}
}

// moneyMinor reads a Money object's amountMinor out of a decoded map, and
// asserts the object shape (amountMinor + currency) while it is at it.
func moneyMinor(t *testing.T, body map[string]any, key string) int64 {
	t.Helper()
	object, ok := body[key].(map[string]any)
	if !ok {
		t.Fatalf("%s is not a Money object in %v", key, body)
	}
	amount, ok := object["amountMinor"].(float64)
	if !ok {
		t.Fatalf("%s carries no amountMinor: %v", key, object)
	}
	if currency, ok := object["currency"].(string); !ok || currency == "" {
		t.Fatalf("%s carries no currency: %v", key, object)
	}
	return int64(amount)
}

// quoteEnvelope asks for a marketplace quote between two places.
func quoteEnvelope(t *testing.T, h *testutil.Harness, rider testutil.Actor, pickup, dropoff domain.Place) map[string]any {
	t.Helper()
	path := "/mp/quote?service=ride&vehicleClass=go" +
		"&pickupLat=" + formatCoord(pickup.Lat) + "&pickupLng=" + formatCoord(pickup.Lng) +
		"&dropoffLat=" + formatCoord(dropoff.Lat) + "&dropoffLng=" + formatCoord(dropoff.Lng)
	recorder := h.Do(http.MethodGet, path, rider, nil)
	requireStatus(t, recorder, http.StatusOK)
	return decode(t, recorder)
}

func formatCoord(value float64) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

// publishAt publishes a request for the standard fixture route at an amount
// (0 means "the quote's minimum", which is hour-independent).
func publishAt(t *testing.T, h *testutil.Harness, rider testutil.Actor, amountMinor int64) (map[string]any, map[string]any) {
	t.Helper()
	return publishRoute(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture(), amountMinor)
}

func publishRoute(t *testing.T, h *testutil.Harness, rider testutil.Actor, pickup, dropoff domain.Place, amountMinor int64) (map[string]any, map[string]any) {
	t.Helper()
	quote := quoteEnvelope(t, h, rider, pickup, dropoff)
	if amountMinor == 0 {
		amountMinor = moneyMinor(t, quote, "minimumFareMinor")
	}
	recorder := h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(amountMinor),
		"paymentMethodId":    "wallet",
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, recorder, http.StatusCreated)
	return decode(t, recorder), quote
}

// goOnline takes a driver online offering the "go" class.
func goOnline(t *testing.T, h *testutil.Harness, driver testutil.Actor) {
	t.Helper()
	recorder := h.Do(http.MethodPost, "/drivers/me/status", driver, map[string]any{
		"online":  true,
		"filters": map[string]any{"vehicleClasses": []string{"go"}},
	})
	requireStatus(t, recorder, http.StatusOK)
}

// ingestPoints reports location points for a driver via the real ingest path,
// which also feeds the stationary gate's sample ring.
func ingestPoints(t *testing.T, h *testutil.Harness, driver testutil.Actor, points []map[string]any) {
	t.Helper()
	recorder := h.Do(http.MethodPost, "/drivers/me/locations", driver, map[string]any{"points": points})
	requireStatus(t, recorder, http.StatusOK)
	var result move.LocationBatchResult
	h.DecodeBody(recorder, &result)
	if result.Rejected > 0 {
		t.Fatalf("location ingest rejected %d points: %s", result.Rejected, recorder.Body.String())
	}
}

// point builds one location report.
func point(seq int64, place domain.Place, at time.Time, speedMps float64) map[string]any {
	return map[string]any{
		"seq":                  seq,
		"lat":                  place.Lat,
		"lng":                  place.Lng,
		"accuracyMeters":       8.0,
		"speedMetersPerSecond": speedMps,
		"recordedAt":           at.Format(time.RFC3339Nano),
	}
}

// parkDriver puts a driver online at a place with a full dwell history and an
// explicit parked confirmation: the complete immediate-branch setup.
func parkDriver(t *testing.T, h *testutil.Harness, driver testutil.Actor, place domain.Place) {
	t.Helper()
	goOnline(t, h, driver)
	now := h.Clock.Now()
	ingestPoints(t, h, driver, []map[string]any{
		point(1, place, now.Add(-90*time.Second), 0),
		point(2, place, now.Add(-60*time.Second), 0),
		point(3, place, now.Add(-30*time.Second), 0),
		point(4, place, now.Add(-1*time.Second), 0),
	})
	recorder := h.Do(http.MethodPost, "/mp/driver/parked", driver, nil)
	requireStatus(t, recorder, http.StatusOK)
}

// submitBid posts a current-slot bid and returns the recorder.
func submitBid(t *testing.T, h *testutil.Harness, driver testutil.Actor, requestID string, amountMinor int64, key string) *httptest.ResponseRecorder {
	t.Helper()
	if key == "" {
		key = idemKey()
	}
	return h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId":         requestID,
		"requestRevision":   1,
		"amountMinor":       moneyBody(amountMinor),
		"slot":              "current",
		"availabilityEpoch": 0,
	}, move.IdempotencyHeader, key)
}

// bidRow reads one bid straight from the store.
func bidRow(t *testing.T, h *testutil.Harness, bidID string) *marketplace.Bid {
	t.Helper()
	id, err := uuid.Parse(bidID)
	if err != nil {
		t.Fatalf("bad bid id %q: %v", bidID, err)
	}
	bid, err := h.Marketplace.Store().BidByID(context.Background(), h.Marketplace.Store().Pool(), id)
	if err != nil {
		t.Fatalf("failed to read bid %s: %v", bidID, err)
	}
	return bid
}

// requestRow reads one request straight from the store.
func requestRow(t *testing.T, h *testutil.Harness, requestID string) *marketplace.Request {
	t.Helper()
	id, err := uuid.Parse(requestID)
	if err != nil {
		t.Fatalf("bad request id %q: %v", requestID, err)
	}
	request, err := h.Marketplace.Store().RequestByID(context.Background(), h.Marketplace.Store().Pool(), id)
	if err != nil {
		t.Fatalf("failed to read request %s: %v", requestID, err)
	}
	return request
}

// cityPolicy loads the harness city's config and marketplace policy.
func cityPolicy(t *testing.T, h *testutil.Harness) (*cityconfig.CityConfig, *cityconfig.MarketplacePolicy) {
	t.Helper()
	config, err := cityconfig.NewStore(h.Pool, nil, time.Second).Config(context.Background(), h.CityID)
	if err != nil {
		t.Fatalf("failed to load the city config: %v", err)
	}
	policy, err := config.MarketplacePolicyFor()
	if err != nil {
		t.Fatalf("failed to load the marketplace policy: %v", err)
	}
	return config, policy
}

// hasReason reports whether an eligibility answer carries a reason code.
func hasReason(view *marketplace.EligibilityView, code string) bool {
	for _, reason := range view.Reasons {
		if reason.Code == code {
			return true
		}
	}
	return false
}

// releasesFor sums the fake wallet's effective releases for one reservation.
func releasesFor(h *testutil.Harness, reservationID string) int {
	return h.Wallet.ReleasesByReservation[reservationID]
}
