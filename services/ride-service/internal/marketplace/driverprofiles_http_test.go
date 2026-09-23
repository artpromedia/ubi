package marketplace_test

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// TestDriverProfilePortResolvesTheUserServiceContract: the real HTTP client,
// against a server answering user-service's documented contract, resolves a
// verified card (rating average AND count exactly as returned), a card whose
// checks are not current (rating null — never invented), and a
// non-disclosing "unavailable" id; it authenticates as ride-service with its
// own key, batches (more than 50 ids is two calls) and reuses resolved cards
// for the TTL.
func TestDriverProfilePortResolvesTheUserServiceContract(t *testing.T) {
	fake := newFakeUserService(t)
	verified, pending, unknown := uuid.New(), uuid.New(), uuid.New()
	fake.setCard(driverCard(verified, marketplace.DriverVerificationVerified, map[string]any{"average": 4.87, "count": 112}, 130, "suv"))
	fake.setCard(driverCard(pending, marketplace.DriverVerificationNotCurrent, nil, 3, "sedan"))

	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	port := fake.port(marketplace.DriverProfilesOptions{TTL: time.Minute, Now: clock})

	profiles, err := port.Profiles(context.Background(), []uuid.UUID{verified, pending, unknown, verified})
	if err != nil {
		t.Fatalf("a contract answer must resolve: %v", err)
	}
	if fake.callCount() != 1 || len(fake.lastIDs) != 3 {
		t.Fatalf("one call for three distinct ids: calls %d, ids %v", fake.callCount(), fake.lastIDs)
	}
	card := profiles[verified]
	if card == nil || !card.Verified() || card.Rating == nil || card.Rating.Average != 4.87 || card.Rating.Count != 112 ||
		card.CompletedTrips != 130 || card.Vehicle == nil || card.Vehicle.Type != "suv" || card.Vehicle.PlateMasked != "•••7K" ||
		card.AccessibilityStatus != "unavailable" {
		t.Fatalf("the verified card, verbatim: %+v", card)
	}
	if p := profiles[pending]; p == nil || p.Verified() || !p.Available || p.Rating != nil ||
		p.Verification.Status != marketplace.DriverVerificationNotCurrent {
		t.Fatalf("a not-current card is available but never verified, and no rating is invented: %+v", p)
	}
	if u := profiles[unknown]; u == nil || u.Available || u.Verified() {
		t.Fatalf("an unknown id resolves to the non-disclosing unavailable card: %+v", u)
	}

	// Within the TTL nothing is fetched again; past it, it is.
	if _, err := port.Profiles(context.Background(), []uuid.UUID{verified, pending}); err != nil || fake.callCount() != 1 {
		t.Fatalf("cached cards are reused inside the TTL: calls %d, err %v", fake.callCount(), err)
	}
	now = now.Add(61 * time.Second)
	if _, err := port.Profiles(context.Background(), []uuid.UUID{verified}); err != nil || fake.callCount() != 2 {
		t.Fatalf("an expired card is fetched again: calls %d, err %v", fake.callCount(), err)
	}

	// A batch beyond the contract's 50 ids is split.
	many := make([]uuid.UUID, 0, 60)
	for i := 0; i < 60; i++ {
		many = append(many, uuid.New())
	}
	before := fake.callCount()
	resolved, err := port.Profiles(context.Background(), many)
	if err != nil || len(resolved) != 60 || fake.callCount() != before+2 {
		t.Fatalf("60 ids resolve in two calls: resolved %d, calls %d, err %v", len(resolved), fake.callCount()-before, err)
	}
}

// TestDriverProfilePortRejectsMalformedAnswers: the strict schema refuses a
// whole answer that does not match the contract — an unknown key, a missing
// nullable key, a zero rating count, a verification status or vehicle type
// outside the contract, an accessibility claim the contract does not admit,
// an id that was not asked for, a missing id, a false success, a refusal.
func TestDriverProfilePortRejectsMalformedAnswers(t *testing.T) {
	driverID := uuid.New()
	good := func(mutate func(card map[string]any)) string {
		card := driverCard(driverID, marketplace.DriverVerificationVerified, map[string]any{"average": 4.5, "count": 10}, 12, "sedan")
		mutate(card)
		return mustJSON(t, map[string]any{"success": true, "data": map[string]any{"profiles": []any{card}}})
	}
	cases := []struct {
		name string
		body string
	}{
		{"unknown key on the card", good(func(card map[string]any) { card["phone"] = "+2348000000000" })},
		{"missing nullable key", good(func(card map[string]any) { delete(card, "photo") })},
		{"rating count zero", good(func(card map[string]any) { card["rating"] = map[string]any{"average": 4.5, "count": 0} })},
		{"rating above five", good(func(card map[string]any) { card["rating"] = map[string]any{"average": 5.5, "count": 3} })},
		{"fractional count", good(func(card map[string]any) { card["rating"] = map[string]any{"average": 4.5, "count": 2.5} })},
		{"unknown verification status", good(func(card map[string]any) {
			card["verification"] = map[string]any{"status": "approved", "verifiedAt": nil}
		})},
		{"unknown vehicle type", good(func(card map[string]any) {
			card["vehicle"].(map[string]any)["type"] = "limousine"
		})},
		{"accessibility claimed", good(func(card map[string]any) {
			card["accessibility"] = map[string]any{"status": "verified"}
		})},
		{"negative trips", good(func(card map[string]any) { card["completedTrips"] = -1 })},
		{"bad member month", good(func(card map[string]any) { card["memberSince"] = "2025-13" })},
		{"unavailable card with extra data", mustJSON(t, map[string]any{"success": true, "data": map[string]any{
			"profiles": []any{map[string]any{"driverId": driverID.String(), "status": "unavailable", "displayName": "X"}},
		}})},
		{"an id that was not asked", mustJSON(t, map[string]any{"success": true, "data": map[string]any{
			"profiles": []any{map[string]any{"driverId": uuid.NewString(), "status": "unavailable"}},
		}})},
		{"the asked id missing", `{"success":true,"data":{"profiles":[]}}`},
		{"success false", `{"success":false,"data":{"profiles":[]}}`},
		{"extra envelope key", `{"success":true,"data":{"profiles":[]},"debug":1}`},
		{"not json", `<html>proxy error</html>`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake := newFakeUserService(t)
			fake.set(0, 0, tc.body)
			port := fake.port(marketplace.DriverProfilesOptions{Backoff: -1})
			profiles, err := port.Profiles(context.Background(), []uuid.UUID{driverID})
			if !errors.Is(err, marketplace.ErrDriverProfilesUnavailable) {
				t.Fatalf("a malformed answer must be refused: %v", err)
			}
			if len(profiles) != 0 {
				t.Fatalf("nothing from a malformed answer is trusted: %+v", profiles)
			}
		})
	}

	// A refusal (wrong key) is unavailable too, and so is an unconfigured port.
	fake := newFakeUserService(t)
	wrongKey := marketplace.NewHTTPDriverProfiles(fake.server.URL, "a-different-key-that-is-long-enough-to-pass", marketplace.DriverProfilesOptions{})
	if _, err := wrongKey.Profiles(context.Background(), []uuid.UUID{driverID}); !errors.Is(err, marketplace.ErrDriverProfilesUnavailable) {
		t.Fatalf("a refused call resolves nothing: %v", err)
	}
	unconfigured := marketplace.NewHTTPDriverProfiles("", "", marketplace.DriverProfilesOptions{})
	if _, err := unconfigured.Profiles(context.Background(), []uuid.UUID{driverID}); !errors.Is(err, marketplace.ErrDriverProfilesUnavailable) {
		t.Fatalf("an unconfigured port resolves nothing: %v", err)
	}
}

// TestDriverProfilePortDownAndTimeout: a user-service that is down or slower
// than the client timeout resolves nothing, within the timeout, and the port
// then backs off instead of hammering it.
func TestDriverProfilePortDownAndTimeout(t *testing.T) {
	driverID := uuid.New()
	fake := newFakeUserService(t)
	fake.set(2*time.Second, 0, "")
	port := fake.port(marketplace.DriverProfilesOptions{
		Client:  &http.Client{Timeout: 150 * time.Millisecond},
		Backoff: time.Minute,
	})
	started := time.Now()
	_, err := port.Profiles(context.Background(), []uuid.UUID{driverID})
	if !errors.Is(err, marketplace.ErrDriverProfilesUnavailable) || time.Since(started) > time.Second {
		t.Fatalf("a slow user-service times out quickly: %v after %s", err, time.Since(started))
	}
	calls := fake.callCount()
	if _, err := port.Profiles(context.Background(), []uuid.UUID{driverID}); !errors.Is(err, marketplace.ErrDriverProfilesUnavailable) || fake.callCount() != calls {
		t.Fatalf("inside the backoff the port does not call again: %v, calls %d → %d", err, calls, fake.callCount())
	}

	down := newFakeUserService(t)
	downPort := down.port(marketplace.DriverProfilesOptions{})
	down.server.Close()
	if _, err := downPort.Profiles(context.Background(), []uuid.UUID{driverID}); !errors.Is(err, marketplace.ErrDriverProfilesUnavailable) {
		t.Fatalf("a closed user-service resolves nothing: %v", err)
	}
}

// TestOffersCarryVerifiedDriverDetails: through the real router, an offer from
// a verified driver carries the user-service card — rating average and count
// verbatim, vehicle registration, real completed trips — both structured and
// in the legacy display fields (profileStatus verified); an offer from a
// driver user-service does not disclose says "details unavailable" with every
// field null and the G09 placeholders. After selection, the winner (queue)
// projection renders the SAME driver as the offer did.
func TestOffersCarryVerifiedDriverDetails(t *testing.T) {
	fake := newFakeUserService(t)
	h := newHarness(t, testutil.WithDriverProfiles(fake.port(marketplace.DriverProfilesOptions{})))
	h.Clock.Set(fixedOffPeakHour)
	rider := h.Rider()
	known, hidden := h.Driver(), h.Driver()
	fake.setCard(driverCard(known.UserID, marketplace.DriverVerificationVerified, map[string]any{"average": 4.87, "count": 112}, 130, "suv"))

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")
	parkDriver(t, h, known, testutil.PickupFixture())
	parkDriver(t, h, hidden, testutil.PlaceAt(testutil.PickupFixture(), 800))
	knownBid := bidNow(t, h, known, requestID, amount)
	bidNow(t, h, hidden, requestID, amount+1_000)

	offers := offersOf(t, snapshotOf(t, h, rider, requestID, ""))
	if len(offers) != 2 {
		t.Fatalf("two offers: %v", offers)
	}
	verifiedOffer, hiddenOffer := offers[0], offers[1]
	profile := verifiedOffer["driverProfile"].(map[string]any)
	rating := profile["rating"].(map[string]any)
	if profile["status"] != "verified" || rating["average"] != 4.87 || rating["count"] != float64(112) ||
		profile["completedTrips"] != float64(130) || profile["displayName"] != "Adaeze O." || profile["accessibility"] != "unavailable" {
		t.Fatalf("the verified card, as user-service returned it: %v", profile)
	}
	legacy := verifiedOffer["driver"].(map[string]any)
	if legacy["profileStatus"] != "verified" || legacy["rating"] != "4.87" || legacy["completedTrips"] != float64(130) ||
		legacy["displayName"] != "Adaeze O." || legacy["plateMasked"] != "•••7K" || legacy["vehicle"] != "go" {
		t.Fatalf("the legacy display carries the verified card: %v", legacy)
	}
	vehicle := verifiedOffer["vehicle"].(map[string]any)
	if vehicle["class"] != "go" || vehicle["bodyType"] != "suv" || vehicle["verified"] != true || vehicle["capacitySeats"] != nil {
		t.Fatalf("the vehicle: verified class and registration, no invented capacity: %v", vehicle)
	}

	hiddenProfile := hiddenOffer["driverProfile"].(map[string]any)
	if hiddenProfile["status"] != "unavailable" || hiddenProfile["rating"] != nil || hiddenProfile["completedTrips"] != nil ||
		hiddenProfile["displayName"] != nil || hiddenProfile["label"] != "Driver details unavailable" {
		t.Fatalf("a non-disclosed driver has no invented details: %v", hiddenProfile)
	}
	if d := hiddenOffer["driver"].(map[string]any); d["profileStatus"] != "unavailable" || d["rating"] != "–" || d["completedTrips"] != float64(0) {
		t.Fatalf("the G09 placeholders stay under profileStatus unavailable: %v", d)
	}

	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": knownBid["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	queue := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/queue", rider, nil)
	requireStatus(t, queue, http.StatusOK)
	winner := decode(t, queue)["driver"].(map[string]any)
	for _, key := range []string{"displayName", "initials", "rating", "completedTrips", "vehicle", "plateMasked", "profileStatus"} {
		if winner[key] != legacy[key] {
			t.Fatalf("the winner renders exactly as the offer did: %s %v vs %v", key, winner[key], legacy[key])
		}
	}
}

// TestOffersServedWhenProfileServiceIsDown: a user-service that is down, or
// hangs past the client timeout, never blocks offers: the snapshot answers
// promptly with every offer, each saying "details unavailable".
func TestOffersServedWhenProfileServiceIsDown(t *testing.T) {
	for _, mode := range []string{"down", "timeout"} {
		t.Run(mode, func(t *testing.T) {
			fake := newFakeUserService(t)
			port := fake.port(marketplace.DriverProfilesOptions{Client: &http.Client{Timeout: 200 * time.Millisecond}})
			if mode == "down" {
				fake.server.Close()
			} else {
				fake.set(3*time.Second, 0, "")
			}
			h := newHarness(t, testutil.WithDriverProfiles(port))
			h.Clock.Set(fixedOffPeakHour)
			rider, driver := h.Rider(), h.Driver()
			fake.setCard(driverCard(driver.UserID, marketplace.DriverVerificationVerified, nil, 4, "sedan"))
			view, _ := publishAt(t, h, rider, 0)
			requestID := view["requestId"].(string)
			parkDriver(t, h, driver, testutil.PickupFixture())
			bidNow(t, h, driver, requestID, moneyMinor(t, view, "minimumFareMinor"))

			started := time.Now()
			offers := offersOf(t, snapshotOf(t, h, rider, requestID, ""))
			if time.Since(started) > 2*time.Second {
				t.Fatalf("a down profile service must not stall offers: %s", time.Since(started))
			}
			if len(offers) != 1 {
				t.Fatalf("the offer is served regardless: %v", offers)
			}
			profile := offers[0]["driverProfile"].(map[string]any)
			if profile["status"] != "unavailable" || !strings.Contains(profile["label"].(string), "unavailable") ||
				offers[0]["driver"].(map[string]any)["profileStatus"] != "unavailable" {
				t.Fatalf("details are honestly unavailable: %v", offers[0])
			}
		})
	}
}
