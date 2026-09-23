package marketplace_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/pricing"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// multiStopHarness is the marketplace harness with the multi-stop flag ON for
// its city (it is off everywhere else, deny by default).
func multiStopHarness(t *testing.T) *testutil.Harness {
	t.Helper()
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceMultiStop, true))
	h.Clock.Set(fixedOffPeakHour)
	return h
}

// stopAt is one requester stop input.
func stopAt(place domain.Place, purpose string, dwellSec *int, label string) map[string]any {
	stop := map[string]any{"lat": place.Lat, "lng": place.Lng}
	if purpose != "" {
		stop["purpose"] = purpose
	}
	if dwellSec != nil {
		stop["dwellSec"] = *dwellSec
	}
	if label != "" {
		stop["label"] = label
	}
	return stop
}

func intPtr(value int) *int { return &value }

// quotePath builds GET /mp/quote with an optional JSON-encoded stops param.
func quotePath(t *testing.T, service string, pickup, dropoff domain.Place, stops any) string {
	t.Helper()
	path := "/mp/quote?service=" + service + "&vehicleClass=go" +
		"&pickupLat=" + formatCoord(pickup.Lat) + "&pickupLng=" + formatCoord(pickup.Lng) +
		"&dropoffLat=" + formatCoord(dropoff.Lat) + "&dropoffLng=" + formatCoord(dropoff.Lng)
	if stops != nil {
		encoded, err := json.Marshal(stops)
		if err != nil {
			t.Fatal(err)
		}
		path += "&stops=" + url.QueryEscape(string(encoded))
	}
	return path
}

func quoteStops(t *testing.T, h *testutil.Harness, rider testutil.Actor, pickup, dropoff domain.Place, stops any) *httptest.ResponseRecorder {
	t.Helper()
	return h.Do(http.MethodGet, quotePath(t, "ride", pickup, dropoff, stops), rider, nil)
}

// publishQuote publishes a request against a quote at its minimum.
func publishQuote(t *testing.T, h *testutil.Harness, rider testutil.Actor, quote map[string]any) map[string]any {
	t.Helper()
	recorder := h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "minimumFareMinor")),
		"paymentMethodId":    "wallet",
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, recorder, http.StatusCreated)
	return decode(t, recorder)
}

// routeStops reads the stops array out of a decoded quote/request view.
func routeStops(t *testing.T, body map[string]any) []map[string]any {
	t.Helper()
	raw, ok := body["stops"].([]any)
	if !ok {
		t.Fatalf("no stops in %v", body)
	}
	stops := make([]map[string]any, 0, len(raw))
	for _, entry := range raw {
		stops = append(stops, entry.(map[string]any))
	}
	return stops
}

func sortedKeys(body map[string]any) []string {
	keys := make([]string, 0, len(body))
	for key := range body {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// The fixture route and two stops that lie OFF the straight pickup → dropoff
// line, so the complete ordered route is measurably longer.
func stopFixtures() (pickup, dropoff, first, second domain.Place) {
	pickup, dropoff = testutil.PickupFixture(), testutil.DropoffFixture()
	first = testutil.PlaceEast(testutil.PlaceAt(pickup, 1_500), 1_200)
	second = testutil.PlaceEast(testutil.PlaceAt(pickup, 3_000), -2_500)
	return pickup, dropoff, first, second
}

// setFlagForCity flips one flag rule for the harness city in place, exactly
// as an operator's config-service change would.
func setFlagForCity(t *testing.T, h *testutil.Harness, key string, enabled bool) {
	t.Helper()
	tag, err := h.Pool.Exec(context.Background(),
		`UPDATE public.flag_rules SET enabled = $3 WHERE flag_key = $1 AND city_id = $2`, key, h.CityID, enabled)
	if err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("failed to set %s=%v for %s: %v (%d rows)", key, enabled, h.CityID, err, tag.RowsAffected())
	}
}

// TestQuoteWithStopsPricesTheFullRoute: the quote routes pickup → stops →
// dropoff through the shared Router, prices the complete route PLUS the
// expected dwell as time, derives the bounds from that full-route price, and
// answers the ordered stops with server-assigned ids and defaults.
func TestQuoteWithStopsPricesTheFullRoute(t *testing.T) {
	h := multiStopHarness(t)
	rider := h.Rider()
	pickup, dropoff, first, second := stopFixtures()

	plain := quoteEnvelope(t, h, rider, pickup, dropoff)
	recorder := quoteStops(t, h, rider, pickup, dropoff, []map[string]any{
		stopAt(first, "drop_passenger", intPtr(180), "Mum's gate"),
		stopAt(second, "", nil, ""),
	})
	requireStatus(t, recorder, http.StatusOK)
	quote := decode(t, recorder)

	// The complete ordered route, measured by the same Router the service
	// uses: never the straight pickup → dropoff line.
	router := move.NewStraightLineRouter()
	router.Now = h.Clock.Now
	measured, err := router.Route(context.Background(), pickup, []domain.Place{first, second}, dropoff)
	if err != nil {
		t.Fatal(err)
	}
	distance := asInt64(t, quote, "routedDistanceMeters")
	duration := asInt64(t, quote, "routedDurationSec")
	if distance != measured.DistanceMeters || duration != measured.DurationSeconds {
		t.Fatalf("routed %d m / %d s, want the full route's %d m / %d s",
			distance, duration, measured.DistanceMeters, measured.DurationSeconds)
	}
	if distance <= asInt64(t, plain, "routedDistanceMeters") {
		t.Fatalf("a route through stops (%d m) must be longer than the direct one (%d m)",
			distance, asInt64(t, plain, "routedDistanceMeters"))
	}

	// Priced as distance + (driving time + expected dwell) under the city's
	// fare table: 180 s declared + the 120 s pilot default.
	if got := asInt64(t, quote, "stopsDwellSec"); got != 300 {
		t.Fatalf("stopsDwellSec: got %d, want 300", got)
	}
	config, _ := cityPolicy(t, h)
	want, _, err := pricing.NewEngine().Fare(config, "go", distance, duration+300)
	if err != nil {
		t.Fatal(err)
	}
	suggested := moneyMinor(t, quote, "suggestedFareMinor")
	if suggested != want.AmountMinor {
		t.Fatalf("suggested %d, want the full route + dwell price %d", suggested, want.AmountMinor)
	}
	if suggested <= moneyMinor(t, plain, "suggestedFareMinor") {
		t.Fatalf("the multi-stop fare %d must exceed the direct fare %d", suggested, moneyMinor(t, plain, "suggestedFareMinor"))
	}
	// Bounds re-derived from the full-route price (fixture: floor =
	// max(45,000, 70%), ceiling = 200%).
	floor := int64(45_000)
	if bps := suggested * 7_000 / 10_000; bps > floor {
		floor = bps
	}
	if moneyMinor(t, quote, "minimumFareMinor") != floor || moneyMinor(t, quote, "maximumFareMinor") != suggested*2 {
		t.Fatalf("bounds [%d, %d] were not derived from the full-route price %d",
			moneyMinor(t, quote, "minimumFareMinor"), moneyMinor(t, quote, "maximumFareMinor"), suggested)
	}

	// The waiting is its own disclosed line and the lines add up.
	var total int64
	waiting := int64(-1)
	for _, entry := range quote["breakdown"].([]any) {
		row := entry.(map[string]any)
		amount := int64(row["amountMinor"].(map[string]any)["amountMinor"].(float64))
		total += amount
		if row["label"] == "Stop waiting" {
			waiting = amount
		}
	}
	if waiting <= 0 {
		t.Fatalf("the dwell must be priced on a Stop waiting row: %v", quote["breakdown"])
	}
	if total != suggested {
		t.Fatalf("breakdown sums to %d, suggested is %d", total, suggested)
	}

	stops := routeStops(t, quote)
	if len(stops) != 2 {
		t.Fatalf("stops: %v", stops)
	}
	for i, stop := range stops {
		if _, err := uuid.Parse(stop["stopId"].(string)); err != nil {
			t.Fatalf("stop %d has no server-assigned uuid: %v", i, stop)
		}
		if int(stop["order"].(float64)) != i+1 {
			t.Fatalf("stop %d order: %v", i, stop["order"])
		}
	}
	if stops[0]["label"] != "Mum's gate" || stops[0]["purpose"] != "drop_passenger" || stops[0]["dwellSec"].(float64) != 180 {
		t.Fatalf("first stop: %v", stops[0])
	}
	if stops[1]["purpose"] != "other" || stops[1]["dwellSec"].(float64) != float64(cityconfig.PilotDefaultStopDwellSec) {
		t.Fatalf("the second stop must default to purpose other and the pilot dwell: %v", stops[1])
	}
	if fingerprint, _ := quote["routeFingerprint"].(string); !strings.HasPrefix(fingerprint, "rt_") {
		t.Fatalf("routeFingerprint: %v", quote["routeFingerprint"])
	}
}

// TestQuoteStopValidation: the market limit (pilot default 3, configurable
// per market), coordinates, dwell bounds, purposes, duplicate and
// adjacent-identical stops, and the wire shape of the parameter itself.
func TestQuoteStopValidation(t *testing.T) {
	h := multiStopHarness(t)
	rider := h.Rider()
	pickup, dropoff, first, second := stopFixtures()
	third := testutil.PlaceEast(testutil.PlaceAt(pickup, 4_000), 700)
	fourth := testutil.PlaceEast(testutil.PlaceAt(pickup, 4_500), -700)

	refuse := func(name string, stops any, field string) map[string]any {
		t.Helper()
		recorder := quoteStops(t, h, rider, pickup, dropoff, stops)
		requireCode(t, recorder, http.StatusUnprocessableEntity, domain.CodeValidationFailed)
		body := decode(t, recorder)
		details, _ := body["details"].(map[string]any)
		if field != "" && (details == nil || details["field"] != field) {
			t.Fatalf("%s: details.field %v, want %s (%s)", name, details, field, recorder.Body.String())
		}
		return details
	}

	details := refuse("four stops over the pilot limit", []map[string]any{
		stopAt(first, "", nil, ""), stopAt(second, "", nil, ""),
		stopAt(third, "", nil, ""), stopAt(fourth, "", nil, ""),
	}, "stops")
	if details["maximum"].(float64) != float64(cityconfig.PilotMaxIntermediateStops) {
		t.Fatalf("the refusal must name the pilot limit: %v", details)
	}
	refuse("off-planet coordinate", []map[string]any{{"lat": 95.0, "lng": 3.3}}, "stops[0]")
	refuse("null island", []map[string]any{{"lat": 0.0, "lng": 0.0}}, "stops[0]")
	refuse("a stop missing its lng", []map[string]any{{"lat": first.Lat}}, "stops[0]")
	refuse("a stop with a null lat", []map[string]any{{"lat": nil, "lng": first.Lng}}, "stops[0]")
	refuse("dwell over the ceiling", []map[string]any{stopAt(first, "", intPtr(cityconfig.PilotMaxStopDwellSec+1), "")}, "stops[0].dwellSec")
	refuse("negative dwell", []map[string]any{stopAt(first, "", intPtr(-1), "")}, "stops[0].dwellSec")
	refuse("unknown purpose", []map[string]any{stopAt(first, "joyride", nil, "")}, "stops[0].purpose")
	refuse("duplicate stops", []map[string]any{
		stopAt(first, "", nil, ""), stopAt(second, "", nil, ""), stopAt(testutil.PlaceEast(first, 10), "", nil, ""),
	}, "stops[2]")
	refuse("first stop is the pickup", []map[string]any{stopAt(testutil.PlaceEast(pickup, 5), "", nil, "")}, "stops[0]")
	refuse("last stop is the dropoff", []map[string]any{
		stopAt(first, "", nil, ""), stopAt(testutil.PlaceAt(dropoff, -5), "", nil, ""),
	}, "stops[1]")
	refuse("a client-named stop id", []map[string]any{{"lat": first.Lat, "lng": first.Lng, "stopId": uuid.NewString()}}, "stops")
	refuse("a client-named price", []map[string]any{{"lat": first.Lat, "lng": first.Lng, "fareMinor": 1}}, "stops")
	refuse("not an array", map[string]any{"lat": first.Lat, "lng": first.Lng}, "stops")
	refuse("an overlong label", []map[string]any{stopAt(first, "", nil, strings.Repeat("x", 81))}, "stops[0].label")

	// Exactly the pilot limit is fine.
	ok := quoteStops(t, h, rider, pickup, dropoff, []map[string]any{
		stopAt(first, "", nil, ""), stopAt(second, "", nil, ""), stopAt(third, "", nil, ""),
	})
	requireStatus(t, ok, http.StatusOK)

	// The limit is per market: this city's policy now allows ONE stop.
	if _, err := h.Pool.Exec(context.Background(), `
		UPDATE public.city_config_versions
		SET config = jsonb_set(config, '{marketplace,stops}',
			'{"maxIntermediateStops": 1, "defaultDwellSec": 60, "maxDwellSec": 300}'::jsonb)
		WHERE city_id = $1`, h.CityID); err != nil {
		t.Fatal(err)
	}
	details = refuse("two stops over the market's own limit", []map[string]any{
		stopAt(first, "", nil, ""), stopAt(second, "", nil, ""),
	}, "stops")
	if details["maximum"].(float64) != 1 {
		t.Fatalf("the refusal must name the market's limit: %v", details)
	}
	refuse("dwell over the market's ceiling", []map[string]any{stopAt(first, "", intPtr(301), "")}, "stops[0].dwellSec")
	single := quoteStops(t, h, rider, pickup, dropoff, []map[string]any{stopAt(first, "", nil, "")})
	requireStatus(t, single, http.StatusOK)
	if dwell := routeStops(t, decode(t, single))[0]["dwellSec"].(float64); dwell != 60 {
		t.Fatalf("the market's default dwell must apply: %v", dwell)
	}
}

// TestMultiStopFlagOffRefusesStops: deny by default — with the flag off a
// quote with stops is refused (feature_disabled), a multi-stop quote issued
// while it was on cannot be published once it is off, and a quote WITHOUT
// stops answers exactly the legacy shape.
func TestMultiStopFlagOffRefusesStops(t *testing.T) {
	h := newHarness(t) // marketplace_multi_stop is not granted here
	rider := h.Rider()
	pickup, dropoff, first, _ := stopFixtures()

	refused := quoteStops(t, h, rider, pickup, dropoff, []map[string]any{stopAt(first, "", nil, "")})
	requireCode(t, refused, http.StatusNotFound, domain.CodeFeatureDisabled)
	if details, _ := decode(t, refused)["details"].(map[string]any); details["feature"] != cityconfig.FlagMarketplaceMultiStop {
		t.Fatalf("the refusal must name the multi-stop feature: %v", details)
	}

	// An empty list is the plain route.
	empty := quoteStops(t, h, rider, pickup, dropoff, []map[string]any{})
	requireStatus(t, empty, http.StatusOK)

	// Flag on, quote with stops, flag off, publish: refused.
	h2 := multiStopHarness(t)
	rider2 := h2.Rider()
	recorder := quoteStops(t, h2, rider2, pickup, dropoff, []map[string]any{stopAt(first, "", nil, "")})
	requireStatus(t, recorder, http.StatusOK)
	quote := decode(t, recorder)
	setFlagForCity(t, h2, cityconfig.FlagMarketplaceMultiStop, false)
	publish := h2.Do(http.MethodPost, "/mp/requests", rider2, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "minimumFareMinor")),
		"paymentMethodId":    "wallet",
	}, move.IdempotencyHeader, idemKey())
	requireCode(t, publish, http.StatusNotFound, domain.CodeFeatureDisabled)
}

// TestDeliveryRejectsStops: a delivery is single-drop whatever the flags say;
// the refusal is a clear validation error, not a missing feature.
func TestDeliveryRejectsStops(t *testing.T) {
	h := multiStopHarness(t)
	rider := h.Rider()
	pickup, dropoff, first, _ := stopFixtures()

	recorder := h.Do(http.MethodGet, quotePath(t, "delivery", pickup, dropoff, []map[string]any{stopAt(first, "", nil, "")}), rider, nil)
	requireCode(t, recorder, http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	details, _ := decode(t, recorder)["details"].(map[string]any)
	if details["field"] != "stops" || details["service"] != "delivery" {
		t.Fatalf("the refusal must name stops on a delivery: %v", details)
	}
	// The same delivery without stops still quotes.
	plain := h.Do(http.MethodGet, quotePath(t, "delivery", pickup, dropoff, nil), rider, nil)
	requireStatus(t, plain, http.StatusOK)
}

// TestNoStopPathUnchanged: without stops every client surface renders exactly
// the legacy shape — no route key appears on the quote, the request view or
// the feed card — whether or not the multi-stop flag is on.
func TestNoStopPathUnchanged(t *testing.T) {
	legacyQuote := []string{
		"breakdown", "cityId", "currency", "expiresAt", "maximumFareMinor", "minimumFareMinor",
		"policyVersion", "pricingVersion", "quoteId", "routedDistanceMeters", "routedDurationSec",
		"service", "suggestedFareMinor", "vehicleClass",
	}
	legacyRequest := []string{
		"cityId", "closeReason", "createdAt", "currency", "delivery", "dropoff", "expiresAt",
		"maximumFareMinor", "minimumFareMinor", "pickup", "policyVersion", "pricingVersion", "quoteId",
		"requestId", "requestedFareMinor", "requesterId", "revision", "searchEnvelope", "service", "state",
		"suggestedFareMinor", "vehicleClass", "version",
	}
	// A04.1 added the earnings breakdown to EVERY card, stops or not; the
	// multi-stop route key must still be absent from a plain card.
	legacyFeedItem := []string{
		"askedByLabel", "askedMinor", "capabilityBadge", "earnings", "expiresAt", "meta", "requestId", "revision",
		"service", "title",
	}
	for _, flagOn := range []bool{false, true} {
		h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceMultiStop, flagOn))
		rider := h.Rider()
		view, quote := publishAt(t, h, rider, 0)
		if got := sortedKeys(quote); strings.Join(got, ",") != strings.Join(legacyQuote, ",") {
			t.Fatalf("flag=%v quote keys changed: %v", flagOn, got)
		}
		labels := []string{}
		for _, entry := range quote["breakdown"].([]any) {
			labels = append(labels, entry.(map[string]any)["label"].(string))
		}
		if strings.Contains(strings.Join(labels, ","), "Stop waiting") {
			t.Fatalf("flag=%v a plain quote grew a waiting line: %v", flagOn, labels)
		}
		if got := sortedKeys(view); strings.Join(got, ",") != strings.Join(legacyRequest, ",") {
			t.Fatalf("flag=%v request keys changed: %v", flagOn, got)
		}

		driver := h.Driver()
		parkDriver(t, h, driver, testutil.PickupFixture())
		feed := h.Do(http.MethodGet, "/mp/feed", driver, nil)
		requireStatus(t, feed, http.StatusOK)
		items := decode(t, feed)["items"].([]any)
		if len(items) != 1 {
			t.Fatalf("flag=%v feed items: %v", flagOn, items)
		}
		item := items[0].(map[string]any)
		if got := sortedKeys(item); strings.Join(got, ",") != strings.Join(legacyFeedItem, ",") {
			t.Fatalf("flag=%v feed item keys changed: %v", flagOn, got)
		}
		if strings.Contains(item["meta"].(string), "stop") {
			t.Fatalf("flag=%v a plain card mentions stops: %v", flagOn, item["meta"])
		}
	}
}

// TestPublishCarriesQuotedStopsAndDriversSeeOnlyAreas: the published request
// carries exactly the quoted stop set (ids and fingerprint included — the
// publish body cannot restate stops), and the driver's feed card and driver
// view state the stop count and full-route metrics with every stop coarsened
// to an area label: no coordinate, no requester label.
func TestPublishCarriesQuotedStopsAndDriversSeeOnlyAreas(t *testing.T) {
	h := multiStopHarness(t)
	rider := h.Rider()
	pickup, dropoff, first, second := stopFixtures()

	recorder := quoteStops(t, h, rider, pickup, dropoff, []map[string]any{
		stopAt(first, "pickup_passenger", intPtr(90), "Flat 4B, 12 Secret Close"),
		stopAt(second, "errand", intPtr(240), "Pharmacy on Adeola"),
	})
	requireStatus(t, recorder, http.StatusOK)
	quote := decode(t, recorder)

	// A body that tries to restate stops is refused outright.
	restated := h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "minimumFareMinor")),
		"paymentMethodId":    "wallet",
		"stops":              []map[string]any{stopAt(first, "", nil, "")},
	}, move.IdempotencyHeader, idemKey())
	requireCode(t, restated, http.StatusUnprocessableEntity, domain.CodeValidationFailed)

	view := publishQuote(t, h, rider, quote)
	quoted, published := routeStops(t, quote), routeStops(t, view)
	if len(published) != 2 {
		t.Fatalf("published stops: %v", published)
	}
	for i := range quoted {
		if published[i]["stopId"] != quoted[i]["stopId"] || published[i]["order"] != quoted[i]["order"] ||
			published[i]["purpose"] != quoted[i]["purpose"] || published[i]["dwellSec"] != quoted[i]["dwellSec"] {
			t.Fatalf("stop %d drifted between quote and request: %v vs %v", i, quoted[i], published[i])
		}
	}
	if view["routeFingerprint"] != quote["routeFingerprint"] || asInt64(t, view, "routeRevision") != 1 {
		t.Fatalf("the request must be bound to the quoted route: %v / %v", view["routeFingerprint"], view["routeRevision"])
	}
	request := requestRow(t, h, view["requestId"].(string))
	if request.RoutedDistanceM != asInt64(t, quote, "routedDistanceMeters") || request.StopsDwellSec != 330 {
		t.Fatalf("request route metrics: %d m, %d s dwell", request.RoutedDistanceM, request.StopsDwellSec)
	}

	driver := h.Driver()
	parkDriver(t, h, driver, pickup)
	feed := h.Do(http.MethodGet, "/mp/feed", driver, nil)
	requireStatus(t, feed, http.StatusOK)
	driverView := h.Do(http.MethodGet, "/mp/requests/"+view["requestId"].(string)+"/driver-view", driver, nil)
	requireStatus(t, driverView, http.StatusOK)
	for name, raw := range map[string]string{"feed": feed.Body.String(), "driver-view": driverView.Body.String()} {
		for _, secret := range []string{"Secret Close", "Pharmacy", formatCoord(first.Lat), formatCoord(second.Lng)} {
			if strings.Contains(raw, secret) {
				t.Fatalf("the %s leaks %q before an award: %s", name, secret, raw)
			}
		}
	}
	item := decode(t, feed)["items"].([]any)[0].(map[string]any)
	route, ok := item["route"].(map[string]any)
	if !ok {
		t.Fatalf("a multi-stop card must carry its route summary: %v", item)
	}
	if route["stopCount"].(float64) != 2 || route["stopsDwellSec"].(float64) != 330 ||
		int64(route["routedDistanceMeters"].(float64)) != asInt64(t, quote, "routedDistanceMeters") ||
		int64(route["routedDurationSec"].(float64)) != asInt64(t, quote, "routedDurationSec") {
		t.Fatalf("route summary: %v", route)
	}
	if !strings.Contains(item["meta"].(string), "2 stops") {
		t.Fatalf("the card meta must state the stop count: %v", item["meta"])
	}
	for _, entry := range route["stops"].([]any) {
		stop := entry.(map[string]any)
		if got := sortedKeys(stop); strings.Join(got, ",") != "areaLabel,dwellSec,order,purpose" {
			t.Fatalf("a pre-award stop carries more than a coarse area: %v", stop)
		}
		if !strings.HasPrefix(stop["areaLabel"].(string), "Area ") {
			t.Fatalf("stop area label is not coarsened like pickup/dropoff: %v", stop)
		}
	}
}

// multiStopRequest publishes a one-stop request and puts two funded bids on
// it, returning the request view, the fresh bid views and the stop.
func multiStopRequest(t *testing.T, h *testutil.Harness, rider testutil.Actor) (map[string]any, []map[string]any) {
	t.Helper()
	pickup, dropoff, first, _ := stopFixtures()
	recorder := quoteStops(t, h, rider, pickup, dropoff, []map[string]any{stopAt(first, "drop_passenger", intPtr(120), "Kid's school")})
	requireStatus(t, recorder, http.StatusOK)
	view := publishQuote(t, h, rider, decode(t, recorder))
	amount := moneyMinor(t, view, "minimumFareMinor")

	var bids []map[string]any
	for i := 0; i < 2; i++ {
		driver := h.Driver()
		parkDriver(t, h, driver, pickup)
		bids = append(bids, fundedCurrentBid(t, h, driver, view["requestId"].(string), amount))
	}
	return view, bids
}

// routeRevisionQuote prices the revised route: the original stop kept, and a
// second stop added after it.
func routeRevisionQuote(t *testing.T, h *testutil.Harness, rider testutil.Actor) map[string]any {
	t.Helper()
	pickup, dropoff, first, second := stopFixtures()
	recorder := quoteStops(t, h, rider, pickup, dropoff, []map[string]any{
		stopAt(first, "drop_passenger", intPtr(120), "Kid's school"),
		stopAt(second, "errand", intPtr(300), ""),
	})
	requireStatus(t, recorder, http.StatusOK)
	return decode(t, recorder)
}

func reviseWithQuote(h *testutil.Harness, rider testutil.Actor, requestID string, quote map[string]any, amount int64, expectedVersion int) *httptest.ResponseRecorder {
	return h.Do(http.MethodPost, "/mp/requests/"+requestID+"/revise", rider, map[string]any{
		"requestedFareMinor": moneyBody(amount),
		"quoteId":            quote["quoteId"],
		"expectedVersion":    expectedVersion,
	}, move.IdempotencyHeader, idemKey())
}

// TestRouteRevisionInvalidatesBidsAndReleasesHoldsOnce: a material stop change
// on an open request is a new revision AND a new route revision; the bounds
// come from the fresh quote's full route; every live bid is invalidated and
// its hold released exactly once through the existing machinery (a re-run
// sweep releases nothing twice); surviving stops keep their ids; no bid can be
// placed against the obsolete revision; and a later fare-only revision keeps
// the route revision.
func TestRouteRevisionInvalidatesBidsAndReleasesHoldsOnce(t *testing.T) {
	h := multiStopHarness(t)
	rider := h.Rider()
	view, bids := multiStopRequest(t, h, rider)
	requestID := view["requestId"].(string)
	original := routeStops(t, view)

	fresh := routeRevisionQuote(t, h, rider)
	freshMin := moneyMinor(t, fresh, "minimumFareMinor")
	if freshMin <= moneyMinor(t, view, "minimumFareMinor") {
		t.Fatalf("fixture: the longer route's floor (%d) must exceed the old one (%d)", freshMin, moneyMinor(t, view, "minimumFareMinor"))
	}
	// The OLD fare is below the new route's floor: refused, nothing moves.
	tooCheap := reviseWithQuote(h, rider, requestID, fresh, moneyMinor(t, view, "minimumFareMinor"), int(asInt64(t, view, "version")))
	requireCode(t, tooCheap, http.StatusUnprocessableEntity, domain.CodeFareOutOfBounds)

	recorder := reviseWithQuote(h, rider, requestID, fresh, freshMin, int(asInt64(t, view, "version")))
	requireStatus(t, recorder, http.StatusOK)
	revised := decode(t, recorder)
	if asInt64(t, revised, "revision") != 2 || asInt64(t, revised, "routeRevision") != 2 {
		t.Fatalf("revision/routeRevision: %v / %v", revised["revision"], revised["routeRevision"])
	}
	if revised["routeFingerprint"] == view["routeFingerprint"] {
		t.Fatal("a changed stop set must change the route fingerprint")
	}
	if moneyMinor(t, revised, "minimumFareMinor") != freshMin ||
		moneyMinor(t, revised, "maximumFareMinor") != moneyMinor(t, fresh, "maximumFareMinor") {
		t.Fatal("the revised bounds must be the fresh full-route quote's")
	}
	stops := routeStops(t, revised)
	if len(stops) != 2 || stops[0]["stopId"] != original[0]["stopId"] {
		t.Fatalf("the surviving stop must keep its id: %v vs %v", stops, original)
	}
	if stops[1]["stopId"] == original[0]["stopId"] || int(stops[1]["order"].(float64)) != 2 {
		t.Fatalf("the added stop must get its own id and the next order: %v", stops[1])
	}

	for _, bid := range bids {
		row := bidRow(t, h, bid["bidId"].(string))
		if row.State != machine.MpBidInvalidated {
			t.Fatalf("bid %s after the route revision: %s", row.ID, row.State)
		}
		if releasesFor(h, bid["reservationId"].(string)) != 1 {
			t.Fatalf("hold %s releases: %d, want exactly 1", bid["reservationId"], releasesFor(h, bid["reservationId"].(string)))
		}
		var reason string
		if err := h.Pool.QueryRow(context.Background(), `
			SELECT payload->>'reason' FROM public.outbox_events
			WHERE name = 'mp.bid.invalidated' AND aggregate_id = $1`, bid["bidId"]).Scan(&reason); err != nil {
			t.Fatal(err)
		}
		if reason != "route_revised" {
			t.Fatalf("invalidation reason: %q", reason)
		}
	}
	// The sweep re-running changes nothing: every release happened once.
	if err := h.Marketplace.Sweep(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, bid := range bids {
		if releasesFor(h, bid["reservationId"].(string)) != 1 {
			t.Fatalf("a sweep re-released hold %s", bid["reservationId"])
		}
	}

	// The revision snapshot records the route each revision stood on.
	var routeChanged bool
	var snapshotStops int
	if err := h.Pool.QueryRow(context.Background(), `
		SELECT (snapshot->>'routeChanged')::boolean, jsonb_array_length(snapshot->'route'->'stops')
		FROM mp.request_revisions WHERE request_id = $1 AND revision = 2`, requestID).Scan(&routeChanged, &snapshotStops); err != nil {
		t.Fatal(err)
	}
	if !routeChanged || snapshotStops != 2 {
		t.Fatalf("revision 2 snapshot: routeChanged=%v stops=%d", routeChanged, snapshotStops)
	}

	// A bid against the obsolete revision is refused.
	late := h.Driver()
	parkDriver(t, h, late, testutil.PickupFixture())
	stale := submitBid(t, h, late, requestID, freshMin, "")
	requireCode(t, stale, http.StatusConflict, domain.CodeVersionConflict)

	// A fare-only revision with a same-route quote keeps the route revision.
	same := routeRevisionQuote(t, h, rider)
	fareOnly := reviseWithQuote(h, rider, requestID, same, moneyMinor(t, same, "minimumFareMinor")+1_000, int(asInt64(t, revised, "version")))
	requireStatus(t, fareOnly, http.StatusOK)
	priced := decode(t, fareOnly)
	if asInt64(t, priced, "revision") != 3 || asInt64(t, priced, "routeRevision") != 2 {
		t.Fatalf("a same-route revision bumps only revision: %v / %v", priced["revision"], priced["routeRevision"])
	}
	if routeStops(t, priced)[1]["stopId"] != stops[1]["stopId"] {
		t.Fatal("a same-route revision must not re-mint stop ids")
	}
}

// TestSelectingStaleRevisionBidFails: a bid placed on the obsolete route can
// never win — even with the request's CURRENT version the selection answers
// version_conflict with the refreshed terms (current revision, route revision
// and the bid's own revision), and no award, capture or execution exists.
func TestSelectingStaleRevisionBidFails(t *testing.T) {
	h := multiStopHarness(t)
	rider := h.Rider()
	view, bids := multiStopRequest(t, h, rider)
	requestID := view["requestId"].(string)

	fresh := routeRevisionQuote(t, h, rider)
	recorder := reviseWithQuote(h, rider, requestID, fresh, moneyMinor(t, fresh, "minimumFareMinor"), int(asInt64(t, view, "version")))
	requireStatus(t, recorder, http.StatusOK)
	revised := decode(t, recorder)

	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId":          bids[0]["bidId"],
		"requestVersion": asInt64(t, revised, "version"),
		"bidVersion":     1,
	}, "")
	requireCode(t, selected, http.StatusConflict, domain.CodeVersionConflict)
	details := decode(t, selected)["details"].(map[string]any)
	if details["requestRevision"].(float64) != 2 || details["routeRevision"].(float64) != 2 {
		t.Fatalf("refreshed terms must carry the current revision and route: %v", details)
	}
	if details["bid"].(map[string]any)["requestRevision"].(float64) != 1 {
		t.Fatalf("refreshed terms must say which revision the offer was on: %v", details)
	}
	if details["routeFingerprint"] != revised["routeFingerprint"] {
		t.Fatalf("refreshed terms must name the current route: %v", details)
	}
	if h.Wallet.CaptureCalls != 0 {
		t.Fatalf("a stale selection must never capture: %d calls", h.Wallet.CaptureCalls)
	}
	if request := requestRow(t, h, requestID); request.State != machine.MpRequestOpen {
		t.Fatalf("the request must stay open: %s", request.State)
	}
	var awards int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM mp.awards WHERE request_id = $1`, requestID).Scan(&awards); err != nil {
		t.Fatal(err)
	}
	if awards != 0 {
		t.Fatalf("a stale selection created %d awards", awards)
	}
}

// executionStopsFor reads the ordered stops the execution ride's quote
// carries, through the move store — what move/* itself sees.
func executionStopsFor(t *testing.T, h *testutil.Harness, requestID string) []domain.Stop {
	t.Helper()
	award := awardRow(t, h, requestID)
	claim := claimRow(t, h, award.ID)
	if claim.ExecutionID == nil {
		t.Fatalf("award %s has no execution ride", award.ID)
	}
	var quoteID uuid.UUID
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT quote_id FROM ride.rides WHERE id = $1`, *claim.ExecutionID).Scan(&quoteID); err != nil {
		t.Fatal(err)
	}
	quote, err := h.Marketplace.Store().Move().Quote(context.Background(), h.Pool, quoteID)
	if err != nil {
		t.Fatal(err)
	}
	return quote.Stops
}

// TestExecutionRideCarriesOrderedStops: the awarded execution ride carries
// the request's ordered stops with the same stable ids (including a stop that
// survived a route revision), order, purpose, dwell and the requester's label
// as the address the awarded driver may now see.
func TestExecutionRideCarriesOrderedStops(t *testing.T) {
	h := multiStopHarness(t)
	rider := h.Rider()
	view, _ := multiStopRequest(t, h, rider)
	requestID := view["requestId"].(string)

	fresh := routeRevisionQuote(t, h, rider)
	recorder := reviseWithQuote(h, rider, requestID, fresh, moneyMinor(t, fresh, "minimumFareMinor"), int(asInt64(t, view, "version")))
	requireStatus(t, recorder, http.StatusOK)
	revised := decode(t, recorder)
	amount := moneyMinor(t, revised, "minimumFareMinor")

	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	bid := h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId":         requestID,
		"requestRevision":   2,
		"amountMinor":       moneyBody(amount),
		"slot":              "current",
		"availabilityEpoch": 0,
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, bid, http.StatusCreated)
	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": decode(t, bid)["bidId"], "requestVersion": asInt64(t, revised, "version"), "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	if award := awardRow(t, h, requestID); award.State != machine.MpAwardConfirmed {
		t.Fatalf("award state: %s (%s)", award.State, selected.Body.String())
	}

	want := routeStops(t, revised)
	got := executionStopsFor(t, h, requestID)
	if len(got) != len(want) {
		t.Fatalf("execution stops: %+v, want %d", got, len(want))
	}
	original := routeStops(t, view)
	if got[0].StopID != original[0]["stopId"] {
		t.Fatalf("the surviving stop's id must reach the execution: %s vs %v", got[0].StopID, original[0]["stopId"])
	}
	for i := range want {
		if got[i].StopID != want[i]["stopId"] || got[i].Order != i+1 ||
			got[i].Purpose != want[i]["purpose"] || float64(got[i].DwellSec) != want[i]["dwellSec"].(float64) ||
			got[i].Address != want[i]["label"] || got[i].Lat != want[i]["lat"].(float64) {
			t.Fatalf("execution stop %d: %+v, want %v", i, got[i], want[i])
		}
	}
}

// TestConcurrentRouteReviseVsSelect: a route revision racing a selection
// resolves to exactly one outcome. Either the selection wins (the revision is
// refused and the execution carries the ORIGINAL stops) or the revision wins
// (the selection answers version_conflict, the bid is invalidated and its
// hold released exactly once, nothing is captured).
func TestConcurrentRouteReviseVsSelect(t *testing.T) {
	outcomes := map[string]int{}
	for round := 0; round < 6; round++ {
		h := multiStopHarness(t)
		rider := h.Rider()
		view, bids := multiStopRequest(t, h, rider)
		requestID := view["requestId"].(string)
		version := int(asInt64(t, view, "version"))
		fresh := routeRevisionQuote(t, h, rider)
		freshMin := moneyMinor(t, fresh, "minimumFareMinor")

		var revise, selected *httptest.ResponseRecorder
		var wg sync.WaitGroup
		start := make(chan struct{})
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			revise = reviseWithQuote(h, rider, requestID, fresh, freshMin, version)
		}()
		go func() {
			defer wg.Done()
			<-start
			selected = h.Do(http.MethodPost, "/mp/requests/"+requestID+"/select", rider, map[string]any{
				"bidId": bids[0]["bidId"], "requestVersion": version, "bidVersion": 1,
			}, move.IdempotencyHeader, idemKey())
		}()
		close(start)
		wg.Wait()

		reviseWon := revise.Code == http.StatusOK
		selectWon := selected.Code == http.StatusAccepted
		if reviseWon == selectWon {
			t.Fatalf("round %d: exactly one must win: revise %d (%s), select %d (%s)",
				round, revise.Code, revise.Body.String(), selected.Code, selected.Body.String())
		}
		reservation := bids[0]["reservationId"].(string)
		if selectWon {
			outcomes["select"]++
			code := decode(t, revise)["code"]
			if revise.Code != http.StatusConflict ||
				(code != string(domain.CodeRequestClosed) && code != string(domain.CodeVersionConflict)) {
				t.Fatalf("round %d: the losing revision: %d (%s)", round, revise.Code, revise.Body.String())
			}
			if award := awardRow(t, h, requestID); award.State != machine.MpAwardConfirmed {
				t.Fatalf("round %d: award %s", round, award.State)
			}
			got := executionStopsFor(t, h, requestID)
			want := routeStops(t, view)
			if len(got) != 1 || got[0].StopID != want[0]["stopId"] {
				t.Fatalf("round %d: the execution must carry the ORIGINAL route: %+v", round, got)
			}
			if h.Wallet.CapturesByReservation[reservation] != 1 || releasesFor(h, reservation) != 0 {
				t.Fatalf("round %d: the winning hold must be captured once and never released", round)
			}
			if row := requestRow(t, h, requestID); row.RouteRevision != 1 || row.Revision != 1 {
				t.Fatalf("round %d: the refused revision moved the route: %d/%d", round, row.Revision, row.RouteRevision)
			}
		} else {
			outcomes["revise"]++
			requireCode(t, selected, http.StatusConflict, domain.CodeVersionConflict)
			if row := bidRow(t, h, bids[0]["bidId"].(string)); row.State != machine.MpBidInvalidated {
				t.Fatalf("round %d: the obsolete bid is %s", round, row.State)
			}
			if releasesFor(h, reservation) != 1 || h.Wallet.CapturesByReservation[reservation] != 0 {
				t.Fatalf("round %d: the obsolete hold must be released once and never captured (released %d, captured %d)",
					round, releasesFor(h, reservation), h.Wallet.CapturesByReservation[reservation])
			}
			var awards int
			if err := h.Pool.QueryRow(context.Background(),
				`SELECT COUNT(*) FROM mp.awards WHERE request_id = $1`, requestID).Scan(&awards); err != nil {
				t.Fatal(err)
			}
			if awards != 0 {
				t.Fatalf("round %d: a lost selection left %d awards", round, awards)
			}
		}
	}
	t.Logf("race outcomes: %v", outcomes)
}
