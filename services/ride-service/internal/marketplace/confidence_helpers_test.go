package marketplace_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// profileServiceKey is the fixture DRIVER_PROFILE_RIDE_SERVICE_KEY the fake
// user-service checks (user-service refuses keys shorter than 32 bytes).
const profileServiceKey = "test-driver-profile-key-at-least-32-bytes"

// fakeUserService answers user-service's documented contract for
//
//	GET /internal/driver-profiles?ids=…   (DriverProfilesResponseSchema)
//
// exactly as services/user-service/src/routes/driver-profiles.ts does: the
// caller must name itself ride-service and present its own key; ids are
// deduplicated and lower-cased; every asked id resolves, an unknown one to
// the non-disclosing {driverId, status: "unavailable"}; the body is the
// {success, data: {profiles}} envelope. Tests can make it slow, fail, or
// answer a verbatim (malformed) body.
type fakeUserService struct {
	server *httptest.Server

	mu       sync.Mutex
	cards    map[string]map[string]any
	calls    int
	lastIDs  []string
	delay    time.Duration
	status   int
	verbatim string
}

func newFakeUserService(t *testing.T) *fakeUserService {
	t.Helper()
	fake := &fakeUserService{cards: map[string]map[string]any{}}
	fake.server = httptest.NewServer(http.HandlerFunc(fake.serve))
	t.Cleanup(fake.server.Close)
	return fake
}

func (f *fakeUserService) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.calls++
	delay, status, verbatim := f.delay, f.status, f.verbatim
	f.mu.Unlock()
	if delay > 0 {
		select {
		case <-time.After(delay):
		case <-r.Context().Done():
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	if r.URL.Path != "/internal/driver-profiles" || r.Method != http.MethodGet {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"code":"not_found","message":"not found"}`))
		return
	}
	if r.Header.Get("x-service-name") != "ride-service" || r.Header.Get("x-service-key") != profileServiceKey {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":"unauthorized","message":"Authentication required"}`))
		return
	}
	if status != 0 {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"code":"internal_error","message":"boom"}`))
		return
	}
	if verbatim != "" {
		_, _ = w.Write([]byte(verbatim))
		return
	}
	seen := map[string]bool{}
	var ids []string
	for _, raw := range strings.Split(r.URL.Query().Get("ids"), ",") {
		id := strings.ToLower(strings.TrimSpace(raw))
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	f.mu.Lock()
	f.lastIDs = ids
	profiles := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		if card, ok := f.cards[id]; ok {
			profiles = append(profiles, card)
			continue
		}
		profiles = append(profiles, map[string]any{"driverId": id, "status": "unavailable"})
	}
	f.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"profiles": profiles}})
}

// setCard publishes one driver's card.
func (f *fakeUserService) setCard(card map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cards[card["driverId"].(string)] = card
}

func (f *fakeUserService) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func (f *fakeUserService) set(delay time.Duration, status int, verbatim string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.delay, f.status, f.verbatim = delay, status, verbatim
}

// port is the REAL ride-service HTTP client pointed at the fake.
func (f *fakeUserService) port(options marketplace.DriverProfilesOptions) marketplace.DriverProfilePort {
	return marketplace.NewHTTPDriverProfiles(f.server.URL, profileServiceKey, options)
}

// driverCard is one available card in user-service's documented shape.
// rating nil means no completed trip carries a rating.
func driverCard(driverID uuid.UUID, verification string, rating map[string]any, trips int, bodyType string) map[string]any {
	var verifiedAt any
	if verification == marketplace.DriverVerificationVerified {
		verifiedAt = "2026-01-15"
	}
	var ratingField any
	if rating != nil {
		ratingField = rating
	}
	return map[string]any{
		"driverId":    driverID.String(),
		"status":      "available",
		"displayName": "Adaeze O.",
		"initials":    "AO",
		"photo":       nil,
		"verification": map[string]any{
			"status":     verification,
			"verifiedAt": verifiedAt,
		},
		"vehicle": map[string]any{
			"make":        "Toyota",
			"model":       "Corolla",
			"colour":      "Silver",
			"type":        bodyType,
			"plateMasked": "•••7K",
		},
		"rating":         ratingField,
		"completedTrips": trips,
		"memberSince":    "2025-06",
		"accessibility":  map[string]any{"status": "unavailable"},
	}
}

// confidenceHarness is the marketplace harness with both rider-confidence
// capabilities switched on for its city (deny by default), at the fixed
// off-peak hour.
func confidenceHarness(t *testing.T, opts ...testutil.HarnessOption) *testutil.Harness {
	t.Helper()
	all := append([]testutil.HarnessOption{
		testutil.WithFlag(cityconfig.FlagMarketplacePreferredDrivers, true),
		testutil.WithFlag(cityconfig.FlagMarketplaceAccessibility, true),
	}, opts...)
	h := newHarness(t, all...)
	h.Clock.Set(fixedOffPeakHour)
	return h
}

// tripWith is awardedTripFor with a CHOSEN driver (already online), so one
// driver can build a marketplace history across trips. seq is the driver's
// next location report sequence number; the fixture advances it.
func tripWith(t *testing.T, h *testutil.Harness, rider, driver testutil.Actor, seq int64) *tripFixture {
	t.Helper()
	f := &tripFixture{h: h, rider: rider, driver: driver, seq: seq}
	pickup, dropoff := testutil.PickupFixture(), testutil.DropoffFixture()
	view := publishQuote(t, h, rider, quoteEnvelope(t, h, rider, pickup, dropoff))
	f.requestID = view["requestId"].(string)
	f.amount = moneyMinor(t, view, "minimumFareMinor")
	f.park(t, pickup, 2*time.Minute)
	bid := bidNow(t, h, driver, f.requestID, f.amount)
	f.reservation = bid["reservationId"].(string)
	selected := doSelect(t, h, rider, f.requestID, map[string]any{
		"bidId": bid["bidId"], "requestVersion": requestVersionOf(t, h, rider, f.requestID), "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	f.pin, _ = decode(t, selected)["pickupPin"].(string)
	f.award = awardRow(t, h, f.requestID)
	if f.award.ExecutionID == nil {
		t.Fatalf("the award has no execution ride: %s", selected.Body.String())
	}
	f.rideID = *f.award.ExecutionID
	return f
}

// completedTripWith runs tripWith through to a completed ride.
func completedTripWith(t *testing.T, h *testutil.Harness, rider, driver testutil.Actor, seq int64) *tripFixture {
	t.Helper()
	f := tripWith(t, h, rider, driver, seq)
	f.start(t)
	f.complete(t)
	return f
}

// requestVersionOf reads a request's current version off the owner snapshot.
func requestVersionOf(t *testing.T, h *testutil.Harness, rider testutil.Actor, requestID string) int {
	t.Helper()
	snapshot := snapshotOf(t, h, rider, requestID, "")
	return int(snapshot["request"].(map[string]any)["version"].(float64))
}

// snapshotOf reads the owner snapshot, optionally sorted.
func snapshotOf(t *testing.T, h *testutil.Harness, rider testutil.Actor, requestID, sortKey string) map[string]any {
	t.Helper()
	path := "/mp/requests/" + requestID
	if sortKey != "" {
		path += "?sort=" + sortKey
	}
	recorder := h.Do(http.MethodGet, path, rider, nil)
	requireStatus(t, recorder, http.StatusOK)
	return decode(t, recorder)
}

// offersOf lists a snapshot's live offers.
func offersOf(t *testing.T, snapshot map[string]any) []map[string]any {
	t.Helper()
	raw, ok := snapshot["offers"].([]any)
	if !ok {
		t.Fatalf("no offers in %v", snapshot)
	}
	offers := make([]map[string]any, 0, len(raw))
	for _, entry := range raw {
		offers = append(offers, entry.(map[string]any))
	}
	return offers
}

// driverViewOf reads the driver view of a request.
func driverViewOf(t *testing.T, h *testutil.Harness, driver testutil.Actor, requestID string) map[string]any {
	t.Helper()
	recorder := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/driver-view", driver, nil)
	requireStatus(t, recorder, http.StatusOK)
	return decode(t, recorder)
}

// bidNow places a funded current-slot bid at the driver's CURRENT
// availability epoch (read from the driver view, as the app does).
func bidNow(t *testing.T, h *testutil.Harness, driver testutil.Actor, requestID string, amount int64) map[string]any {
	t.Helper()
	recorder := tryBid(t, h, driver, requestID, amount)
	requireStatus(t, recorder, http.StatusCreated)
	return decode(t, recorder)
}

// tryBid is bidNow without the status assertion.
func tryBid(t *testing.T, h *testutil.Harness, driver testutil.Actor, requestID string, amount int64) *httptest.ResponseRecorder {
	t.Helper()
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	epoch := float64(0)
	view := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/driver-view", driver, nil)
	if view.Code == http.StatusOK {
		epoch = decode(t, view)["eligibility"].(map[string]any)["availabilityEpoch"].(float64)
	}
	return h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId":         requestID,
		"requestRevision":   1,
		"amountMinor":       moneyBody(amount),
		"slot":              "current",
		"availabilityEpoch": int64(epoch),
	}, move.IdempotencyHeader, idemKey())
}

// saveFavourite saves the driver of a request's completed trip.
func saveFavourite(t *testing.T, h *testutil.Harness, rider testutil.Actor, requestID string) *httptest.ResponseRecorder {
	t.Helper()
	return h.Do(http.MethodPost, "/mp/favourite-drivers", rider, map[string]any{"requestId": requestID},
		move.IdempotencyHeader, idemKey())
}

// setPreferredOptIn saves the driver's preferred-request opt-in.
func setPreferredOptIn(t *testing.T, h *testutil.Harness, driver testutil.Actor, accept bool) *httptest.ResponseRecorder {
	t.Helper()
	current := h.Do(http.MethodGet, "/mp/driver/preferences", driver, nil)
	requireStatus(t, current, http.StatusOK)
	version := decode(t, current)["version"].(float64)
	return h.Do(http.MethodPatch, "/mp/driver/preferences", driver, map[string]any{
		"expectedVersion":          int(version),
		"acceptsPreferredRequests": accept,
	}, move.IdempotencyHeader, idemKey())
}

// publishWith publishes a request for the fixture route at its minimum with
// extra body fields, returning the recorder.
func publishWith(t *testing.T, h *testutil.Harness, rider testutil.Actor, extra map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	quote := quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture())
	body := map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "minimumFareMinor")),
		"paymentMethodId":    "wallet",
	}
	for key, value := range extra {
		body[key] = value
	}
	return h.Do(http.MethodPost, "/mp/requests", rider, body, move.IdempotencyHeader, idemKey())
}

// feedHas reports whether a driver's feed lists a request, returning its card.
func feedHas(t *testing.T, h *testutil.Harness, driver testutil.Actor, requestID string) (map[string]any, bool) {
	t.Helper()
	recorder := h.Do(http.MethodGet, "/mp/feed", driver, nil)
	requireStatus(t, recorder, http.StatusOK)
	for _, raw := range decode(t, recorder)["items"].([]any) {
		item := raw.(map[string]any)
		if item["requestId"] == requestID {
			return item, true
		}
	}
	return nil, false
}

// mustJSON encodes a fixture body.
func mustJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}
