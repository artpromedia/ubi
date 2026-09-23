package marketplace_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

const preferencesPath = "/mp/driver/preferences"

// cleanPreferences removes the preferences rows a harness city accumulated
// (the shared harness cleanup predates the table).
func cleanPreferences(t *testing.T, h *testutil.Harness) {
	t.Helper()
	t.Cleanup(func() {
		if _, err := h.Pool.Exec(context.Background(), `DELETE FROM mp.driver_preferences WHERE city_id = $1`, h.CityID); err != nil {
			t.Logf("preferences cleanup failed: %v", err)
		}
	})
}

// patchPreferences sends one PATCH with a fresh key unless one is given.
func patchPreferences(h *testutil.Harness, driver testutil.Actor, body map[string]any, key string) *httptest.ResponseRecorder {
	if key == "" {
		key = idemKey()
	}
	return h.Do(http.MethodPatch, preferencesPath, driver, body, move.IdempotencyHeader, key)
}

// savePreferences PATCHes against the driver's current version and demands
// success, returning the saved view.
func savePreferences(t *testing.T, h *testutil.Harness, driver testutil.Actor, fields map[string]any) map[string]any {
	t.Helper()
	current := h.Do(http.MethodGet, preferencesPath, driver, nil)
	requireStatus(t, current, http.StatusOK)
	body := map[string]any{"expectedVersion": asInt64(t, decode(t, current), "version")}
	for key, value := range fields {
		body[key] = value
	}
	recorder := patchPreferences(h, driver, body, "")
	requireStatus(t, recorder, http.StatusOK)
	return decode(t, recorder)
}

func preferenceRows(t *testing.T, h *testutil.Harness, driver testutil.Actor) int {
	t.Helper()
	var count int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM mp.driver_preferences WHERE driver_id = $1`, driver.UserID).Scan(&count); err != nil {
		t.Fatalf("failed to count preference rows: %v", err)
	}
	return count
}

func driverBidCount(t *testing.T, h *testutil.Harness, driver testutil.Actor) int {
	t.Helper()
	var count int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM mp.bids WHERE driver_id = $1`, driver.UserID).Scan(&count); err != nil {
		t.Fatalf("failed to count bids: %v", err)
	}
	return count
}

// feedIDs reads a feed page's request ids in order, plus its preferences block.
func feedIDs(t *testing.T, h *testutil.Harness, driver testutil.Actor, query string) ([]string, map[string]any, []map[string]any) {
	t.Helper()
	recorder := h.Do(http.MethodGet, "/mp/feed"+query, driver, nil)
	requireStatus(t, recorder, http.StatusOK)
	page := decode(t, recorder)
	ids := []string{}
	items := []map[string]any{}
	for _, raw := range page["items"].([]any) {
		item := raw.(map[string]any)
		ids = append(ids, item["requestId"].(string))
		items = append(items, item)
	}
	prefs, _ := page["preferences"].(map[string]any)
	return ids, prefs, items
}

func contains(ids []string, id string) bool {
	for _, candidate := range ids {
		if candidate == id {
			return true
		}
	}
	return false
}

// TestPreferencesDefaultsAndVersionedPatch: an unsaved driver reads version
// 0 defaults with policy-derived bounds; PATCH appends versions against
// expectedVersion, replays byte-for-byte on its key, refuses a stale version
// and a reused key, clears with null, writes nothing for a no-op, and every
// saved version has its outbox event and audit row (homeward redacted).
func TestPreferencesDefaultsAndVersionedPatch(t *testing.T) {
	h := newHarness(t)
	cleanPreferences(t, h)
	driver := h.Driver()

	initial := h.Do(http.MethodGet, preferencesPath, driver, nil)
	requireStatus(t, initial, http.StatusOK)
	defaults := decode(t, initial)
	if asInt64(t, defaults, "version") != 0 || defaults["acceptsDeliveries"] != true || defaults["acceptsStops"] != true ||
		defaults["minimumTripAmountMinor"] != nil || defaults["maxPickupDistanceMeters"] != nil || defaults["homeward"] != nil {
		t.Fatalf("unsaved preferences must be the permissive defaults: %v", defaults)
	}
	bounds := objectOf(t, defaults, "bounds")
	pickupBounds := objectOf(t, bounds, "maxPickupDistanceMeters")
	if asInt64(t, pickupBounds, "min") != 500 || asInt64(t, pickupBounds, "max") != 9_000 {
		t.Fatalf("pickup bounds must come from the market's widest envelope: %v", pickupBounds)
	}
	if asInt64(t, bounds, "maxStopsCeiling") != 3 || moneyMinor(t, bounds, "minimumTripAmountMaxMinor") != 500_000 {
		t.Fatalf("stop/minimum-trip bounds must come from the market policy: %v", bounds)
	}
	if disclosure, _ := defaults["disclosure"].(string); !strings.Contains(disclosure, "never bid for you") {
		t.Fatalf("the view must state that preferences never bid: %q", disclosure)
	}

	key := idemKey()
	body := map[string]any{
		"expectedVersion":         0,
		"minimumTripAmountMinor":  moneyBody(120_000),
		"maxPickupDistanceMeters": 2_500,
		"homeward": map[string]any{
			"lat": testutil.DropoffFixture().Lat, "lng": testutil.DropoffFixture().Lng, "radiusMeters": 3_000, "label": "Home",
		},
	}
	first := patchPreferences(h, driver, body, key)
	requireStatus(t, first, http.StatusOK)
	saved := decode(t, first)
	if asInt64(t, saved, "version") != 1 || moneyMinor(t, saved, "minimumTripAmountMinor") != 120_000 ||
		asInt64(t, saved, "maxPickupDistanceMeters") != 2_500 {
		t.Fatalf("first save: %v", saved)
	}

	// Replay: byte-for-byte, and no second row.
	replay := patchPreferences(h, driver, body, key)
	requireStatus(t, replay, http.StatusOK)
	if replay.Body.String() != first.Body.String() {
		t.Fatalf("a replay must answer byte-for-byte:\n%s\n%s", first.Body.String(), replay.Body.String())
	}
	if preferenceRows(t, h, driver) != 1 {
		t.Fatalf("a replay must not write a version")
	}
	// The same key with a different body is refused.
	body["maxPickupDistanceMeters"] = 3_000
	requireCode(t, patchPreferences(h, driver, body, key), http.StatusConflict, domain.CodeIdempotencyKeyReuse)

	// A fresh key against the stale version 0 is a version conflict.
	stale := patchPreferences(h, driver, map[string]any{"expectedVersion": 0, "maxStops": 1}, "")
	requireCode(t, stale, http.StatusConflict, domain.CodeVersionConflict)
	if details := objectOf(t, decode(t, stale), "details"); asInt64(t, details, "currentVersion") != 1 {
		t.Fatalf("the conflict names the current version: %v", details)
	}

	// null clears a nullable field; absent fields stay as they were.
	cleared := patchPreferences(h, driver, map[string]any{"expectedVersion": 1, "minimumTripAmountMinor": nil}, "")
	requireStatus(t, cleared, http.StatusOK)
	second := decode(t, cleared)
	if asInt64(t, second, "version") != 2 || second["minimumTripAmountMinor"] != nil || asInt64(t, second, "maxPickupDistanceMeters") != 2_500 {
		t.Fatalf("null must clear only its own field: %v", second)
	}
	if objectOf(t, second, "homeward")["label"] != "Home" {
		t.Fatalf("an absent field must keep its value: %v", second["homeward"])
	}

	// A PATCH that changes nothing writes nothing.
	noop := patchPreferences(h, driver, map[string]any{"expectedVersion": 2, "maxPickupDistanceMeters": 2_500}, "")
	requireStatus(t, noop, http.StatusOK)
	if asInt64(t, decode(t, noop), "version") != 2 || preferenceRows(t, h, driver) != 2 {
		t.Fatalf("a no-op PATCH must not append a version")
	}

	read := h.Do(http.MethodGet, preferencesPath, driver, nil)
	requireStatus(t, read, http.StatusOK)
	readBody := decode(t, read)
	if asInt64(t, readBody, "version") != 2 {
		t.Fatalf("GET must answer the newest version")
	}
	// The PATCH answer's updatedAt is the stored row's time, not a second
	// clock: GET reads back exactly the instant the save stated.
	patchedAt, errPatched := time.Parse(time.RFC3339Nano, second["updatedAt"].(string))
	readAt, errRead := time.Parse(time.RFC3339Nano, readBody["updatedAt"].(string))
	if errPatched != nil || errRead != nil || !patchedAt.Equal(readAt) {
		t.Fatalf("updatedAt drifted between the PATCH answer (%v) and GET (%v)", second["updatedAt"], readBody["updatedAt"])
	}

	// Outbox + audit, one of each per saved version, in the same transaction.
	rows, err := h.Pool.Query(context.Background(), `
		SELECT payload FROM public.outbox_events
		WHERE name = 'mp.driver_preferences.saved' AND aggregate_id = $1
		ORDER BY to_version`, driver.UserID.String())
	if err != nil {
		t.Fatal(err)
	}
	var payloads []string
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			t.Fatal(err)
		}
		payloads = append(payloads, string(payload))
	}
	rows.Close()
	if len(payloads) != 2 {
		t.Fatalf("expected one outbox event per saved version, got %d", len(payloads))
	}
	homeLat := formatCoord(testutil.DropoffFixture().Lat)
	for _, payload := range payloads {
		if strings.Contains(payload, homeLat) {
			t.Fatalf("an outbox payload leaks the homeward coordinates: %s", payload)
		}
	}
	var audits int
	var auditLeak bool
	if err := h.Pool.QueryRow(context.Background(), `
		SELECT count(*), COALESCE(bool_or(after::text LIKE '%' || $2 || '%'), false)
		FROM public.audit_log WHERE action = 'mp.driver_preferences.saved' AND subject_id = $1`,
		driver.UserID.String(), homeLat).Scan(&audits, &auditLeak); err != nil {
		t.Fatal(err)
	}
	if audits != 2 || auditLeak {
		t.Fatalf("audit rows: %d (want 2), homeward leaked: %v", audits, auditLeak)
	}
}

// TestPreferencesValidation: every bound is enforced server-side with the
// field named; nothing refused is written.
func TestPreferencesValidation(t *testing.T) {
	h := newHarness(t)
	cleanPreferences(t, h)
	driver := h.Driver()
	home := testutil.DropoffFixture()

	cases := []struct {
		name  string
		body  map[string]any
		field string
	}{
		{"pickup below floor", map[string]any{"maxPickupDistanceMeters": 100}, "maxPickupDistanceMeters"},
		{"pickup above widest envelope", map[string]any{"maxPickupDistanceMeters": 20_000}, "maxPickupDistanceMeters"},
		{"stops above market limit", map[string]any{"maxStops": 4}, "maxStops"},
		{"negative stops", map[string]any{"maxStops": -1}, "maxStops"},
		{"stop limit while declining stops", map[string]any{"acceptsStops": false, "maxStops": 2}, "maxStops"},
		{"minimum in another currency", map[string]any{"minimumTripAmountMinor": map[string]any{"amountMinor": 1_000, "currency": "USD"}}, "minimumTripAmountMinor"},
		{"zero minimum", map[string]any{"minimumTripAmountMinor": moneyBody(0)}, "minimumTripAmountMinor"},
		{"minimum above every profile ceiling", map[string]any{"minimumTripAmountMinor": moneyBody(500_001)}, "minimumTripAmountMinor"},
		{"homeward radius too small", map[string]any{"homeward": map[string]any{"lat": home.Lat, "lng": home.Lng, "radiusMeters": 500}}, "homeward.radiusMeters"},
		{"homeward without lat", map[string]any{"homeward": map[string]any{"lng": home.Lng, "radiusMeters": 3_000}}, "homeward"},
		{"homeward off the planet", map[string]any{"homeward": map[string]any{"lat": 123.0, "lng": home.Lng, "radiusMeters": 3_000}}, "homeward"},
		{"homeward-only without an area", map[string]any{"homewardOnly": true}, "homewardOnly"},
		{"null boolean", map[string]any{"acceptsStops": nil}, "acceptsStops"},
		{"bad weekday", map[string]any{"availabilityWindows": []map[string]any{{"day": "funday", "startMinute": 60, "endMinute": 120}}}, "availabilityWindows[0].day"},
		{"window ends before it starts", map[string]any{"availabilityWindows": []map[string]any{{"day": "mon", "startMinute": 600, "endMinute": 540}}}, "availabilityWindows[0]"},
		{"overnight window", map[string]any{"availabilityWindows": []map[string]any{{"day": "fri", "startMinute": 1_320, "endMinute": 1_500}}}, "availabilityWindows[0]"},
		{"overlapping windows", map[string]any{"availabilityWindows": []map[string]any{
			{"day": "mon", "startMinute": 420, "endMinute": 600}, {"day": "mon", "startMinute": 540, "endMinute": 660},
		}}, "availabilityWindows"},
	}
	for _, tc := range cases {
		body := map[string]any{"expectedVersion": 0}
		for key, value := range tc.body {
			body[key] = value
		}
		recorder := patchPreferences(h, driver, body, "")
		requireCode(t, recorder, http.StatusUnprocessableEntity, domain.CodeValidationFailed)
		details, _ := decode(t, recorder)["details"].(map[string]any)
		if details["field"] != tc.field {
			t.Fatalf("%s: the refusal must name %q, got %v", tc.name, tc.field, details)
		}
	}

	// Body-shape refusals: unknown keys (top level and nested), a missing
	// expectedVersion and a missing Idempotency-Key.
	requireCode(t, patchPreferences(h, driver, map[string]any{"expectedVersion": 0, "autoBid": true}, ""),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	requireCode(t, patchPreferences(h, driver, map[string]any{"expectedVersion": 0,
		"homeward": map[string]any{"lat": home.Lat, "lng": home.Lng, "radiusMeters": 3_000, "exact": true}}, ""),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	requireCode(t, patchPreferences(h, driver, map[string]any{"maxStops": 1}, ""),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	noKey := h.Do(http.MethodPatch, preferencesPath, driver, map[string]any{"expectedVersion": 0, "maxStops": 1})
	requireCode(t, noKey, http.StatusUnprocessableEntity, domain.CodeValidationFailed)

	// A rider has no driver preferences.
	requireCode(t, h.Do(http.MethodGet, preferencesPath, h.Rider(), nil), http.StatusForbidden, domain.CodeForbidden)

	if preferenceRows(t, h, driver) != 0 {
		t.Fatal("a refused PATCH must not write a version")
	}

	// A valid schedule is stored canonically (weekday order, then start) with
	// server-phrased labels, and declining stops clears a stop limit.
	saved := savePreferences(t, h, driver, map[string]any{
		"maxStops": 2,
		"availabilityWindows": []map[string]any{
			{"day": "wed", "startMinute": 1_020, "endMinute": 1_440},
			{"day": "mon", "startMinute": 420, "endMinute": 600},
		},
	})
	windows := saved["availabilityWindows"].([]any)
	if len(windows) != 2 || windows[0].(map[string]any)["label"] != "Mon 07:00–10:00" ||
		windows[1].(map[string]any)["label"] != "Wed 17:00–24:00" {
		t.Fatalf("windows must be canonical and labelled: %v", windows)
	}
	if note, _ := saved["availabilityNote"].(string); !strings.Contains(note, "not available yet") {
		t.Fatalf("availability must be disclosed as stored-only: %q", note)
	}
	declined := savePreferences(t, h, driver, map[string]any{"acceptsStops": false})
	if declined["maxStops"] != nil || declined["acceptsStops"] != false {
		t.Fatalf("declining stops must clear the stop limit: %v", declined)
	}
}

// TestPreferencesConcurrentPatchOneWins: two PATCHes against the same version
// race; the (driver, city, version) key lets exactly one land.
func TestPreferencesConcurrentPatchOneWins(t *testing.T) {
	h := newHarness(t)
	cleanPreferences(t, h)
	for round := 0; round < 5; round++ {
		driver := h.Driver()
		var wg sync.WaitGroup
		start := make(chan struct{})
		results := make([]*httptest.ResponseRecorder, 2)
		for i := range results {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				results[i] = patchPreferences(h, driver, map[string]any{"expectedVersion": 0, "maxStops": i}, "")
			}(i)
		}
		close(start)
		wg.Wait()
		ok, conflict := 0, 0
		for _, recorder := range results {
			switch recorder.Code {
			case http.StatusOK:
				ok++
			case http.StatusConflict:
				var body map[string]any
				_ = json.Unmarshal(recorder.Body.Bytes(), &body)
				if body["code"] == string(domain.CodeVersionConflict) {
					conflict++
				}
			}
		}
		if ok != 1 || conflict != 1 || preferenceRows(t, h, driver) != 1 {
			t.Fatalf("round %d: exactly one PATCH must land: ok=%d conflict=%d rows=%d", round, ok, conflict, preferenceRows(t, h, driver))
		}
	}
}

// TestPreferencesSameKeyRetryRaceReplays: a client retry that races its own
// in-flight first attempt (same Idempotency-Key, same body) gets the first
// attempt's answer, byte-for-byte — never a version conflict against itself —
// and exactly one version, one event and one audit row exist.
func TestPreferencesSameKeyRetryRaceReplays(t *testing.T) {
	h := newHarness(t)
	cleanPreferences(t, h)
	for round := 0; round < 8; round++ {
		driver := h.Driver()
		key := idemKey()
		var wg sync.WaitGroup
		start := make(chan struct{})
		results := make([]*httptest.ResponseRecorder, 2)
		for i := range results {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				results[i] = patchPreferences(h, driver, map[string]any{"expectedVersion": 0, "maxStops": 2}, key)
			}(i)
		}
		close(start)
		wg.Wait()
		for i, recorder := range results {
			if recorder.Code != http.StatusOK {
				t.Fatalf("round %d attempt %d: a same-key retry must replay, got %d %s", round, i, recorder.Code, recorder.Body.String())
			}
		}
		if results[0].Body.String() != results[1].Body.String() {
			t.Fatalf("round %d: both attempts must carry the one stored answer:\n%s\n%s", round, results[0].Body.String(), results[1].Body.String())
		}
		var events, audits int
		if err := h.Pool.QueryRow(context.Background(), `
			SELECT (SELECT count(*) FROM public.outbox_events WHERE name = 'mp.driver_preferences.saved' AND aggregate_id = $1),
			       (SELECT count(*) FROM public.audit_log WHERE action = 'mp.driver_preferences.saved' AND subject_id = $1)`,
			driver.UserID.String()).Scan(&events, &audits); err != nil {
			t.Fatal(err)
		}
		if rows := preferenceRows(t, h, driver); rows != 1 || events != 1 || audits != 1 {
			t.Fatalf("round %d: one save means one version/event/audit, got rows=%d events=%d audits=%d", round, rows, events, audits)
		}
	}
}

// TestPreferencesFilterTheFeedButNeverBidOrGate: saved preferences hide
// deliveries, stop routes, far pickups and requests that cannot pay the
// minimum — counted, never described — while `preferences=ignore` shows the
// whole envelope again. Preferences are not eligibility (a hidden request is
// still biddable from its driver view) and they never create a bid or a
// wallet reservation.
func TestPreferencesFilterTheFeedButNeverBidOrGate(t *testing.T) {
	h := multiStopHarness(t)
	cleanPreferences(t, h)
	pickup, dropoff, first, second := stopFixtures()

	plain, _ := publishRoute(t, h, h.Rider(), pickup, dropoff, 0)
	farPickup, _ := publishRoute(t, h, h.Rider(), testutil.PlaceAt(pickup, 2_000), dropoff, 0)

	stopsRider := h.Rider()
	stopsQuote := quoteStops(t, h, stopsRider, pickup, dropoff, []map[string]any{
		stopAt(first, "", nil, ""), stopAt(second, "", nil, ""),
	})
	requireStatus(t, stopsQuote, http.StatusOK)
	withStops := publishQuote(t, h, stopsRider, decode(t, stopsQuote))

	deliveryRider := h.Rider()
	deliveryQuoteRecorder := h.Do(http.MethodGet, quotePath(t, "delivery", pickup, dropoff, nil), deliveryRider, nil)
	requireStatus(t, deliveryQuoteRecorder, http.StatusOK)
	deliveryQuote := decode(t, deliveryQuoteRecorder)
	deliveryRecorder := h.Do(http.MethodPost, "/mp/requests", deliveryRider, map[string]any{
		"quoteId":            deliveryQuote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, deliveryQuote, "minimumFareMinor")),
		"paymentMethodId":    "wallet",
		"delivery":           map[string]any{"weightKg": 3},
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, deliveryRecorder, http.StatusCreated)
	delivery := decode(t, deliveryRecorder)

	driver := h.Driver()
	parkDriver(t, h, driver, pickup)
	h.Wallet.SetSpendable(driver.UserID, 10_000_000)
	all := []string{plain["requestId"].(string), farPickup["requestId"].(string), withStops["requestId"].(string), delivery["requestId"].(string)}

	ids, prefsBlock, _ := feedIDs(t, h, driver, "")
	if len(ids) != 4 || prefsBlock != nil {
		t.Fatalf("with no preferences saved the feed is the whole envelope and says nothing about preferences: %v %v", ids, prefsBlock)
	}

	savePreferences(t, h, driver, map[string]any{
		"acceptsDeliveries":       false,
		"acceptsStops":            false,
		"maxPickupDistanceMeters": 1_000,
	})
	ids, prefsBlock, _ = feedIDs(t, h, driver, "")
	if len(ids) != 1 || ids[0] != all[0] {
		t.Fatalf("preferences must hide the delivery, the stop route and the far pickup: %v", ids)
	}
	if prefsBlock["applied"] != true || asInt64(t, prefsBlock, "hiddenCount") != 3 || asInt64(t, prefsBlock, "version") != 1 {
		t.Fatalf("the page must say preferences hid 3: %v", prefsBlock)
	}

	// Not eligibility: the hidden far-pickup request is still eligible and
	// still offers presets from its driver view, which says which
	// preference it misses.
	view := h.Do(http.MethodGet, "/mp/requests/"+all[1]+"/driver-view", driver, nil)
	requireStatus(t, view, http.StatusOK)
	detail := decode(t, view)
	if objectOf(t, detail, "eligibility")["eligible"] != true || len(detail["presets"].([]any)) == 0 {
		t.Fatalf("a preference must never gate eligibility: %v", detail["eligibility"])
	}
	if notice, _ := detail["preferenceNotice"].(string); !strings.Contains(notice, "maximum pickup distance of 1.0 km") {
		t.Fatalf("the driver view must name the missed preference: %v", detail["preferenceNotice"])
	}

	ignored, ignoredBlock, _ := feedIDs(t, h, driver, "?preferences=ignore")
	if len(ignored) != 4 || ignoredBlock["applied"] != false {
		t.Fatalf("preferences=ignore shows the whole envelope: %v %v", ignored, ignoredBlock)
	}
	requireCode(t, h.Do(http.MethodGet, "/mp/feed?preferences=sometimes", driver, nil),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)

	// A minimum trip amount above a request's MAXIMUM hides it too.
	plainMax := moneyMinor(t, plain, "maximumFareMinor")
	savePreferences(t, h, driver, map[string]any{"minimumTripAmountMinor": moneyBody(plainMax + 1)})
	ids, prefsBlock, _ = feedIDs(t, h, driver, "")
	if len(ids) != 0 || asInt64(t, prefsBlock, "hiddenCount") != 4 {
		t.Fatalf("a request that can never pay the minimum must be hidden: %v %v", ids, prefsBlock)
	}

	// Still not eligibility under the minimum either.
	view = h.Do(http.MethodGet, "/mp/requests/"+all[0]+"/driver-view", driver, nil)
	requireStatus(t, view, http.StatusOK)
	detail = decode(t, view)
	if objectOf(t, detail, "eligibility")["eligible"] != true || len(detail["presets"].([]any)) == 0 {
		t.Fatalf("a preference must never gate eligibility: %v", detail["eligibility"])
	}
	if notice, _ := detail["preferenceNotice"].(string); !strings.Contains(notice, "above this request's maximum") {
		t.Fatalf("the unpayable minimum must be explained: %v", detail["preferenceNotice"])
	}

	// And nothing — saving, reading the feed, reading a driver view — bids.
	if driverBidCount(t, h, driver) != 0 || h.Wallet.ReserveCalls != 0 {
		t.Fatalf("preferences must never create a bid or reserve a commission: bids=%d reserves=%d",
			driverBidCount(t, h, driver), h.Wallet.ReserveCalls)
	}
}

// TestHomewardPreferenceRanksAndTags: a request ending in the homeward area
// is tagged and ranked first within the page (newest-first otherwise), and
// homeward-only hides the rest.
func TestHomewardPreferenceRanksAndTags(t *testing.T) {
	h := newHarness(t)
	h.Clock.Set(fixedOffPeakHour)
	cleanPreferences(t, h)
	pickup := testutil.PickupFixture()
	home := testutil.DropoffFixture()               // ~5 km north of the pickup
	elsewhere := testutil.PlaceEast(pickup, -5_000) // ~5 km west

	homeward, _ := publishRoute(t, h, h.Rider(), pickup, home, 0) // older
	h.Clock.Advance(time.Second)
	other, _ := publishRoute(t, h, h.Rider(), pickup, elsewhere, 0) // newer

	driver := h.Driver()
	parkDriver(t, h, driver, pickup)
	ids, _, _ := feedIDs(t, h, driver, "")
	if len(ids) != 2 || ids[0] != other["requestId"] {
		t.Fatalf("without preferences the feed is newest first: %v", ids)
	}

	savePreferences(t, h, driver, map[string]any{
		"homeward": map[string]any{"lat": home.Lat, "lng": home.Lng, "radiusMeters": 2_000, "label": "Home"},
	})
	ids, _, items := feedIDs(t, h, driver, "")
	if len(ids) != 2 || ids[0] != homeward["requestId"] {
		t.Fatalf("the homeward request must rank first: %v", ids)
	}
	tags, _ := items[0]["preferenceTags"].([]any)
	if len(tags) != 1 || tags[0] != "homeward" {
		t.Fatalf("the homeward card must be tagged: %v", items[0])
	}
	if _, tagged := items[1]["preferenceTags"]; tagged {
		t.Fatalf("a non-matching card carries no tags: %v", items[1])
	}

	savePreferences(t, h, driver, map[string]any{"homewardOnly": true})
	ids, prefsBlock, _ := feedIDs(t, h, driver, "")
	if len(ids) != 1 || ids[0] != homeward["requestId"] || asInt64(t, prefsBlock, "hiddenCount") != 1 {
		t.Fatalf("homeward-only must hide the other request: %v %v", ids, prefsBlock)
	}
	if contains(ids, other["requestId"].(string)) {
		t.Fatal("homeward-only leaked a non-homeward request")
	}
}

// TestMinimumTripPrefillsAPresetNeverABid: a minimum trip amount between the
// asked fare and the maximum becomes a suggested preset (with its breakdown);
// above the maximum it becomes a notice. Neither places anything.
func TestMinimumTripPrefillsAPresetNeverABid(t *testing.T) {
	h := newHarness(t)
	h.Clock.Set(fixedOffPeakHour)
	cleanPreferences(t, h)
	view, _ := publishAt(t, h, h.Rider(), 0) // asked = the floor
	requestID := view["requestId"].(string)
	asked := moneyMinor(t, view, "requestedFareMinor")
	maximum := moneyMinor(t, view, "maximumFareMinor")

	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 10_000_000)

	minimum := asked + (maximum-asked)/3
	savePreferences(t, h, driver, map[string]any{"minimumTripAmountMinor": moneyBody(minimum)})
	recorder := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/driver-view", driver, nil)
	requireStatus(t, recorder, http.StatusOK)
	body := decode(t, recorder)
	var found map[string]any
	for _, raw := range body["presets"].([]any) {
		preset := raw.(map[string]any)
		if preset["source"] == "preference_minimum" {
			found = preset
		}
	}
	if found == nil || moneyMinor(t, found, "amountMinor") != minimum {
		t.Fatalf("the minimum trip amount must pre-fill a preset: %v", body["presets"])
	}
	requireMoneyBreakdown(t, earningsOf(t, found), minimum, "preset_amount")
	if _, noticed := body["preferenceNotice"]; noticed {
		t.Fatalf("a payable minimum needs no notice: %v", body["preferenceNotice"])
	}

	savePreferences(t, h, driver, map[string]any{"minimumTripAmountMinor": moneyBody(maximum + 100)})
	body = decode(t, h.Do(http.MethodGet, "/mp/requests/"+requestID+"/driver-view", driver, nil))
	for _, raw := range body["presets"].([]any) {
		if raw.(map[string]any)["source"] == "preference_minimum" {
			t.Fatal("an unpayable minimum must not become a preset above the maximum")
		}
	}
	if notice, _ := body["preferenceNotice"].(string); !strings.Contains(notice, "above this request's maximum") {
		t.Fatalf("an unpayable minimum must be explained: %v", body["preferenceNotice"])
	}
	if driverBidCount(t, h, driver) != 0 || h.Wallet.ReserveCalls != 0 {
		t.Fatal("a pre-filled preset is a suggestion; nothing may be bid automatically")
	}
}
