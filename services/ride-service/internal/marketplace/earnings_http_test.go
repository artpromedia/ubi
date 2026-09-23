package marketplace_test

import (
	"net/http"
	"sort"
	"strings"
	"testing"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// The fixed inputs of the earnings fixtures. The harness router is the
// straight-line estimator at the pinned off-peak hour (traffic multiplier
// 1.0): 10 m/s with a 20% allowance, never less than 60 s. A driver parked
// 1,234 m due north of the pickup is therefore a 148 s leg, shown coarsened to
// 1,200 m and rounded UP to 180 s.
const (
	fixturePickupOffsetMeters = 1_234
	fixtureCoarsePickupMeters = 1_200
	fixtureCoarsePickupSec    = 180
)

// earningsOf reads the breakdown object off a card or a preset.
func earningsOf(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	earnings, ok := body["earnings"].(map[string]any)
	if !ok {
		t.Fatalf("no earnings breakdown on %v", body)
	}
	return earnings
}

func objectOf(t *testing.T, body map[string]any, key string) map[string]any {
	t.Helper()
	object, ok := body[key].(map[string]any)
	if !ok {
		t.Fatalf("%s is not an object in %v", key, body)
	}
	return object
}

// perHourMinor is the documented per-hour arithmetic: integer, half-up.
func perHourMinor(net, basisSec int64) int64 {
	return (net*3600 + basisSec/2) / basisSec
}

// requireMoneyBreakdown asserts the money half of a breakdown against its
// gross: the commission IS CommissionMinor(gross), the fleet remittance is an
// explicit none with a null amount, and net = gross − commission − 0.
func requireMoneyBreakdown(t *testing.T, earnings map[string]any, gross int64, basis string) (commission, net int64) {
	t.Helper()
	if got := moneyMinor(t, earnings, "grossMinor"); got != gross {
		t.Fatalf("gross: got %d, want %d", got, gross)
	}
	if earnings["grossBasis"] != basis {
		t.Fatalf("gross basis: got %v, want %s", earnings["grossBasis"], basis)
	}
	commission = moneyMinor(t, earnings, "commissionMinor")
	if commission != marketplace.CommissionMinor(gross) {
		t.Fatalf("commission: got %d, want CommissionMinor(%d) = %d", commission, gross, marketplace.CommissionMinor(gross))
	}
	if asInt64(t, earnings, "commissionBps") != 1_000 {
		t.Fatalf("commission bps: %v", earnings["commissionBps"])
	}
	remittance := objectOf(t, earnings, "fleetRemittance")
	if remittance["status"] != marketplace.FleetRemittanceNone {
		t.Fatalf("fleet remittance status: %v", remittance)
	}
	amount, present := remittance["amountMinor"]
	if !present || amount != nil {
		t.Fatalf("fleet remittance must be an explicit null amount, never a number: %v", remittance)
	}
	if reason, _ := remittance["reason"].(string); reason == "" {
		t.Fatalf("a none remittance states why: %v", remittance)
	}
	net = moneyMinor(t, earnings, "estimatedNetMinor")
	if net != gross-commission-0 {
		t.Fatalf("net: got %d, want gross − commission − remittance = %d", net, gross-commission)
	}
	running := objectOf(t, earnings, "runningCosts")
	if running["status"] != marketplace.RunningCostsNotEstimated {
		t.Fatalf("no fuel/energy input is disclosed, so none may be estimated: %v", running)
	}
	if disclaimer, _ := earnings["disclaimer"].(string); !strings.Contains(disclaimer, "estimates") {
		t.Fatalf("the breakdown must say which figures are estimates: %q", disclaimer)
	}
	return commission, net
}

// TestFeedCardEarningsBreakdown: every feed card carries the breakdown at
// the requester's fare, computed from real inputs only — CommissionMinor, an
// explicit none fleet remittance, the coarsened unpaid pickup (estimate,
// straight-line basis), the paid route as priced, and a per-hour estimate
// whose basis is exactly pickup + route time.
func TestFeedCardEarningsBreakdown(t *testing.T) {
	h := newHarness(t)
	h.Clock.Set(fixedOffPeakHour)
	rider := h.Rider()
	view, quote := publishAt(t, h, rider, 0)
	asked := moneyMinor(t, view, "requestedFareMinor")

	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PlaceAt(testutil.PickupFixture(), fixturePickupOffsetMeters))
	recorder := h.Do(http.MethodGet, "/mp/feed", driver, nil)
	requireStatus(t, recorder, http.StatusOK)
	items := decode(t, recorder)["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("feed items: %v", items)
	}
	item := items[0].(map[string]any)
	if moneyMinor(t, item, "askedMinor") != asked {
		t.Fatalf("the card's asked amount drifted: %v", item)
	}
	earnings := earningsOf(t, item)
	_, net := requireMoneyBreakdown(t, earnings, asked, marketplace.GrossBasisRequested)

	pickup := objectOf(t, earnings, "pickup")
	if asInt64(t, pickup, "distanceMeters") != fixtureCoarsePickupMeters || pickup["distanceBasis"] != marketplace.PickupBasisStraightLine {
		t.Fatalf("pickup distance must be the coarsened straight-line metres: %v", pickup)
	}
	if asInt64(t, pickup, "durationSec") != fixtureCoarsePickupSec || pickup["durationBasis"] != marketplace.PickupBasisStraightLineETA {
		t.Fatalf("pickup time must be the minute-rounded straight-line estimate: %v", pickup)
	}
	if pickup["estimate"] != true || pickup["paid"] != false {
		t.Fatalf("the pickup is an unpaid estimate: %v", pickup)
	}
	if label, _ := pickup["label"].(string); !strings.Contains(label, "1.2 km") || !strings.Contains(label, "estimate") {
		t.Fatalf("pickup label: %q", label)
	}

	route := objectOf(t, earnings, "route")
	routeSec := asInt64(t, quote, "routedDurationSec")
	if asInt64(t, route, "distanceMeters") != asInt64(t, quote, "routedDistanceMeters") ||
		asInt64(t, route, "durationSec") != routeSec ||
		asInt64(t, route, "stopCount") != 0 || asInt64(t, route, "stopsWaitingSec") != 0 {
		t.Fatalf("the paid route must be the priced route: %v vs quote %v", route, quote)
	}
	if route["waitingLabel"] != "No stops" {
		t.Fatalf("a plain route has no waiting: %v", route)
	}

	perHour := objectOf(t, earnings, "estimatedNetPerHour")
	basis := int64(fixtureCoarsePickupSec) + routeSec
	if asInt64(t, perHour, "basisSec") != basis {
		t.Fatalf("per-hour basis: got %v, want pickup %d + route %d", perHour["basisSec"], fixtureCoarsePickupSec, routeSec)
	}
	if got := moneyMinor(t, perHour, "amountMinor"); got != perHourMinor(net, basis) {
		t.Fatalf("net per hour: got %d, want %d", got, perHourMinor(net, basis))
	}
	if perHour["estimate"] != true || !strings.HasPrefix(perHour["basis"].(string), "Estimate:") {
		t.Fatalf("net per hour must be labelled an estimate with its inputs: %v", perHour)
	}
}

// TestDriverViewPresetsCarryEarnings: each preset's breakdown is at the
// preset's own amount and agrees with the preset's own commission/net; the
// eligibility evaluation's routed pickup is exported (minute-coarsened, with
// its basis) and IS the presets' pickup input.
func TestDriverViewPresetsCarryEarnings(t *testing.T) {
	h := newHarness(t)
	h.Clock.Set(fixedOffPeakHour)
	rider := h.Rider()
	view, quote := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)

	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PlaceAt(testutil.PickupFixture(), fixturePickupOffsetMeters))
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)

	recorder := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/driver-view", driver, nil)
	requireStatus(t, recorder, http.StatusOK)
	body := decode(t, recorder)

	eligibility := objectOf(t, body, "eligibility")
	if eligibility["eligible"] != true {
		t.Fatalf("the parked driver must be eligible: %v", eligibility)
	}
	if asInt64(t, eligibility, "predictedPickupSec") != fixtureCoarsePickupSec || eligibility["predictedPickupBasis"] != marketplace.PickupBasisRoutedLeg {
		t.Fatalf("the predicted pickup must be exported, minute-coarsened, with its basis: %v", eligibility)
	}

	routeSec := asInt64(t, quote, "routedDurationSec")
	presets := body["presets"].([]any)
	if len(presets) < 2 {
		t.Fatalf("expected requested + higher presets, got %v", presets)
	}
	for _, raw := range presets {
		preset := raw.(map[string]any)
		amount := moneyMinor(t, preset, "amountMinor")
		earnings := earningsOf(t, preset)
		commission, net := requireMoneyBreakdown(t, earnings, amount, marketplace.GrossBasisPreset)
		if commission != moneyMinor(t, preset, "commissionMinor") || net != moneyMinor(t, preset, "netMinor") {
			t.Fatalf("the breakdown disagrees with its own preset: %v", preset)
		}
		pickup := objectOf(t, earnings, "pickup")
		if pickup["distanceBasis"] != marketplace.PickupBasisRouted || pickup["durationBasis"] != marketplace.PickupBasisRoutedLeg {
			t.Fatalf("an eligible driver's preset pickup is the routed leg: %v", pickup)
		}
		if asInt64(t, pickup, "durationSec") != asInt64(t, eligibility, "predictedPickupSec") ||
			asInt64(t, pickup, "distanceMeters") != fixtureCoarsePickupMeters {
			t.Fatalf("preset pickup %v must be the exported prediction %v", pickup, eligibility)
		}
		perHour := objectOf(t, earnings, "estimatedNetPerHour")
		basis := int64(fixtureCoarsePickupSec) + routeSec
		if got := moneyMinor(t, perHour, "amountMinor"); got != perHourMinor(net, basis) {
			t.Fatalf("preset net per hour: got %d, want %d", got, perHourMinor(net, basis))
		}
	}
	// The item card in the driver view carries the requested-fare breakdown.
	item := objectOf(t, body, "item")
	requireMoneyBreakdown(t, earningsOf(t, item), moneyMinor(t, item, "askedMinor"), marketplace.GrossBasisRequested)
}

// TestEarningsAreHonestAboutUnknowns: a driver with no location has no
// pickup distance or time and therefore no per-hour figure — null, with the
// unavailable basis, never an invented number. The money half still stands.
func TestEarningsAreHonestAboutUnknowns(t *testing.T) {
	h := newHarness(t)
	h.Clock.Set(fixedOffPeakHour)
	rider := h.Rider()
	view, _ := publishAt(t, h, rider, 0)

	driver := h.Driver() // never online: no session, no fix
	recorder := h.Do(http.MethodGet, "/mp/requests/"+view["requestId"].(string)+"/driver-view", driver, nil)
	requireStatus(t, recorder, http.StatusOK)
	body := decode(t, recorder)
	eligibility := objectOf(t, body, "eligibility")
	if eligibility["eligible"] != false || eligibility["predictedPickupSec"] != nil {
		t.Fatalf("an offline driver has no predicted pickup: %v", eligibility)
	}
	item := objectOf(t, body, "item")
	earnings := earningsOf(t, item)
	requireMoneyBreakdown(t, earnings, moneyMinor(t, item, "askedMinor"), marketplace.GrossBasisRequested)
	pickup := objectOf(t, earnings, "pickup")
	if pickup["distanceMeters"] != nil || pickup["durationSec"] != nil ||
		pickup["distanceBasis"] != marketplace.PickupBasisUnavailable || pickup["durationBasis"] != marketplace.PickupBasisUnavailable {
		t.Fatalf("an unknown pickup must be null with the unavailable basis: %v", pickup)
	}
	if value, present := earnings["estimatedNetPerHour"]; !present || value != nil {
		t.Fatalf("no per-hour estimate may exist without a pickup time: %v", earnings)
	}
}

// TestMultiStopEarningsIncludeStopsAndWaiting: the paid route is the full
// ordered route through every stop, the stop count and expected dwell are
// disclosed, and the per-hour basis includes the waiting.
func TestMultiStopEarningsIncludeStopsAndWaiting(t *testing.T) {
	h := multiStopHarness(t)
	rider := h.Rider()
	pickup, dropoff, first, second := stopFixtures()
	recorder := quoteStops(t, h, rider, pickup, dropoff, []map[string]any{
		stopAt(first, "pickup_passenger", intPtr(90), "Flat 4B, 12 Secret Close"),
		stopAt(second, "errand", intPtr(240), "Pharmacy on Adeola"),
	})
	requireStatus(t, recorder, http.StatusOK)
	quote := decode(t, recorder)
	view := publishQuote(t, h, rider, quote)

	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PlaceAt(pickup, fixturePickupOffsetMeters))
	feed := h.Do(http.MethodGet, "/mp/feed", driver, nil)
	requireStatus(t, feed, http.StatusOK)
	item := decode(t, feed)["items"].([]any)[0].(map[string]any)
	earnings := earningsOf(t, item)
	_, net := requireMoneyBreakdown(t, earnings, moneyMinor(t, view, "requestedFareMinor"), marketplace.GrossBasisRequested)

	route := objectOf(t, earnings, "route")
	routeSec := asInt64(t, quote, "routedDurationSec")
	if asInt64(t, route, "distanceMeters") != asInt64(t, quote, "routedDistanceMeters") ||
		asInt64(t, route, "durationSec") != routeSec ||
		asInt64(t, route, "stopCount") != 2 || asInt64(t, route, "stopsWaitingSec") != 330 {
		t.Fatalf("the paid route must be the full priced route with its stops and dwell: %v", route)
	}
	if label := route["waitingLabel"].(string); !strings.Contains(label, "2 stops") || !strings.Contains(label, "~6 min") {
		t.Fatalf("waiting label: %q", label)
	}
	perHour := objectOf(t, earnings, "estimatedNetPerHour")
	basis := int64(fixtureCoarsePickupSec) + routeSec + 330
	if asInt64(t, perHour, "basisSec") != basis || moneyMinor(t, perHour, "amountMinor") != perHourMinor(net, basis) {
		t.Fatalf("per-hour must count pickup + route + stop waiting (%d s): %v", basis, perHour)
	}
	if !strings.Contains(perHour["basis"].(string), "stop waiting") {
		t.Fatalf("the per-hour basis names the waiting it includes: %v", perHour["basis"])
	}
	// Still privacy-limited: the requester's stop words and coordinates stay
	// out of the card, breakdown included.
	for _, secret := range []string{"Secret Close", "Pharmacy", formatCoord(first.Lat), formatCoord(pickup.Lat)} {
		if strings.Contains(feed.Body.String(), secret) {
			t.Fatalf("the feed leaks %q before an award", secret)
		}
	}
}

// TestEarningsKeepTheFeedPrivacyLimited: the breakdown adds no coordinate,
// no address and no finer pickup than the card's own 0.1 km line — pickup
// metres are multiples of 100 and seconds multiples of 60, across positions.
func TestEarningsKeepTheFeedPrivacyLimited(t *testing.T) {
	h := newHarness(t)
	h.Clock.Set(fixedOffPeakHour)
	rider := h.Rider()
	publishAt(t, h, rider, 0)
	pickup := testutil.PickupFixture()

	for _, offset := range []float64{0, 377, 1_234, 2_051} {
		driver := h.Driver()
		position := testutil.PlaceAt(pickup, offset)
		parkDriver(t, h, driver, position)
		recorder := h.Do(http.MethodGet, "/mp/feed", driver, nil)
		requireStatus(t, recorder, http.StatusOK)
		raw := recorder.Body.String()
		for _, secret := range []string{formatCoord(pickup.Lat), formatCoord(pickup.Lng), "Test pickup", "Test dropoff"} {
			if strings.Contains(raw, secret) {
				t.Fatalf("offset %.0f: the feed leaks %q: %s", offset, secret, raw)
			}
		}
		item := decode(t, recorder)["items"].([]any)[0].(map[string]any)
		earnings := earningsOf(t, item)
		keys := sortedKeys(earnings)
		sort.Strings(keys)
		want := "commissionBps,commissionMinor,disclaimer,estimatedNetMinor,estimatedNetPerHour,fleetRemittance,grossBasis,grossMinor,pickup,route,runningCosts"
		if strings.Join(keys, ",") != want {
			t.Fatalf("breakdown keys changed: %v", keys)
		}
		pickupView := objectOf(t, earnings, "pickup")
		meters, seconds := asInt64(t, pickupView, "distanceMeters"), asInt64(t, pickupView, "durationSec")
		if meters%100 != 0 || seconds%60 != 0 {
			t.Fatalf("offset %.0f: pickup %d m / %d s is finer than the card's granularity", offset, meters, seconds)
		}
		if _, leaked := pickupView["lat"]; leaked {
			t.Fatalf("a pickup estimate carries a coordinate: %v", pickupView)
		}
	}
}

// TestFinishingTripEarningsCountOnlyTheUnpaidHop: for a queued next-job the
// exported time-until-pickup includes the rest of the current (paid) trip and
// its buffers, but the breakdown's UNPAID pickup is only the post-dropoff hop.
// Fixture: 500 m left on the current trip (60 s, the estimator's floor), a
// 1,000 m hop (120 s), the policy's 120 s completion + 60 s uncertainty
// buffers — so 360 s until pickup, of which 120 s is unpaid driving.
func TestFinishingTripEarningsCountOnlyTheUnpaidHop(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	h.Clock.Set(fixedOffPeakHour)
	origin := testutil.PickupFixture()
	view, quote := publishRoute(t, h, h.Rider(), testutil.PlaceAt(origin, 4_000), testutil.PlaceAt(origin, 9_000), 0)

	driver := h.Driver()
	finishingTripFixture(t, h, driver, testutil.PlaceAt(origin, 2_500), origin, testutil.PlaceAt(origin, 3_000))
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)

	recorder := h.Do(http.MethodGet, "/mp/requests/"+view["requestId"].(string)+"/driver-view", driver, nil)
	requireStatus(t, recorder, http.StatusOK)
	body := decode(t, recorder)
	eligibility := objectOf(t, body, "eligibility")
	if eligibility["eligible"] != true || eligibility["slot"] != "next" {
		t.Fatalf("the finishing driver must qualify for the next slot: %v", eligibility)
	}
	if asInt64(t, eligibility, "predictedPickupSec") != 360 || eligibility["predictedPickupBasis"] != marketplace.PickupBasisFinishingTrip {
		t.Fatalf("predicted pickup must be remaining + buffers + hop, with its basis: %v", eligibility)
	}
	routeSec := asInt64(t, quote, "routedDurationSec")
	for _, raw := range body["presets"].([]any) {
		preset := raw.(map[string]any)
		earnings := earningsOf(t, preset)
		_, net := requireMoneyBreakdown(t, earnings, moneyMinor(t, preset, "amountMinor"), marketplace.GrossBasisPreset)
		pickup := objectOf(t, earnings, "pickup")
		if asInt64(t, pickup, "distanceMeters") != 1_000 || asInt64(t, pickup, "durationSec") != 120 ||
			pickup["durationBasis"] != marketplace.PickupBasisRoutedLeg {
			t.Fatalf("the unpaid pickup is only the post-dropoff hop: %v", pickup)
		}
		perHour := objectOf(t, earnings, "estimatedNetPerHour")
		if asInt64(t, perHour, "basisSec") != 120+routeSec || moneyMinor(t, perHour, "amountMinor") != perHourMinor(net, 120+routeSec) {
			t.Fatalf("per-hour must not count the current (paid) trip as pickup time: %v", perHour)
		}
	}
}
