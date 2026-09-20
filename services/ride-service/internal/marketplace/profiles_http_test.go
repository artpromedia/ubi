package marketplace_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// TestRateProfileSaveIsVersionedAndBounded: saves append versions; a rate
// above the city's bounds is refused with rate_profile_out_of_bounds.
func TestRateProfileSave(t *testing.T) {
	h := newHarness(t)
	driver := h.Driver()

	save := func(perKm, minTrip int64) map[string]any {
		recorder := h.Do(http.MethodPut, "/mp/rate-profiles", driver, map[string]any{
			"cityId":               h.CityID,
			"service":              "ride",
			"vehicleClass":         "go",
			"perKmMinor":           perKm,
			"minimumTripFareMinor": minTrip,
		}, move.IdempotencyHeader, idemKey())
		requireStatus(t, recorder, http.StatusOK)
		return decode(t, recorder)
	}

	first := save(300_00, 1_500_00)
	if asInt64(t, first, "version") != 1 {
		t.Fatalf("first version: got %v, want 1", first["version"])
	}
	second := save(320_00, 1_500_00)
	if asInt64(t, second, "version") != 2 {
		t.Fatalf("second version: got %v, want 2", second["version"])
	}

	// Above maxPerKmMinor (50,000 in the fixture): refused, nothing saved.
	tooHigh := h.Do(http.MethodPut, "/mp/rate-profiles", driver, map[string]any{
		"cityId":               h.CityID,
		"service":              "ride",
		"vehicleClass":         "go",
		"perKmMinor":           60_000,
		"minimumTripFareMinor": 0,
	}, move.IdempotencyHeader, idemKey())
	requireCode(t, tooHigh, http.StatusUnprocessableEntity, domain.CodeRateProfileOutOfBounds)

	list := h.Do(http.MethodGet, "/mp/rate-profiles", driver, nil)
	requireStatus(t, list, http.StatusOK)
	profiles := decode(t, list)["profiles"].([]any)
	if len(profiles) != 1 {
		t.Fatalf("profiles listed: got %d, want 1 (the newest version per pair)", len(profiles))
	}
	if asInt64(t, profiles[0].(map[string]any), "version") != 2 {
		t.Fatalf("listed version: got %v, want 2", profiles[0].(map[string]any)["version"])
	}
}

// TestRateProfileSaveNeverTouchesLiveBids: saving a new profile version
// leaves an outstanding bid exactly as it was.
func TestRateProfileSaveNeverTouchesLiveBids(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0)
	amount := moneyMinor(t, view, "minimumFareMinor")
	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	created := submitBid(t, h, driver, view["requestId"].(string), amount, "")
	requireStatus(t, created, http.StatusCreated)
	bidID := decode(t, created)["bidId"].(string)
	before := bidRow(t, h, bidID)

	recorder := h.Do(http.MethodPut, "/mp/rate-profiles", driver, map[string]any{
		"cityId":               h.CityID,
		"service":              "ride",
		"vehicleClass":         "go",
		"perKmMinor":           300_00,
		"minimumTripFareMinor": 0,
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, recorder, http.StatusOK)

	after := bidRow(t, h, bidID)
	if after.AmountMinor != before.AmountMinor || after.BidVersion != before.BidVersion || after.State != before.State {
		t.Fatalf("saving a profile touched a live bid: %+v → %+v", before, after)
	}
}

// TestRatePreviewFormula: the preview computes on routed metres with integer
// arithmetic — 10,500 m at 300.00/km is exactly 3,150.00 — applies the
// platform floor visibly, and flags a ceiling breach without clamping.
func TestRatePreview(t *testing.T) {
	h := newHarness(t)
	driver := h.Driver()

	preview := func(perKm, minTrip, distance int64) map[string]any {
		recorder := h.Do(http.MethodPost, "/mp/rate-profiles/preview", driver, map[string]any{
			"cityId":                h.CityID,
			"service":               "ride",
			"vehicleClass":          "go",
			"perKmMinor":            perKm,
			"minimumTripFareMinor":  minTrip,
			"exampleDistanceMeters": distance,
		})
		requireStatus(t, recorder, http.StatusOK)
		return decode(t, recorder)
	}

	// The fractional-km example. 10.5 km must NOT be rounded to 11 or 10 km.
	fractional := preview(300_00, 0, 10_500)
	if got := moneyMinor(t, fractional, "grossMinor"); got != 3_150_00 {
		t.Fatalf("gross for 10500m at 300.00/km: got %d, want 315000", got)
	}
	if got := moneyMinor(t, fractional, "commissionMinor"); got != marketplace.CommissionMinor(3_150_00) {
		t.Fatalf("commission: got %d", got)
	}
	if fractional["floorAdjusted"].(bool) {
		t.Fatal("315000 is above the platform floor; floorAdjusted must be false")
	}

	// The minimum trip fare binds a short trip.
	minimumBinds := preview(300_00, 1_500_00, 1_000)
	if got := moneyMinor(t, minimumBinds, "grossMinor"); got != 1_500_00 {
		t.Fatalf("gross with binding minimum: got %d, want 150000", got)
	}

	// A tiny trip under the platform floor (45,000 in the fixture) is lifted
	// to it, visibly.
	floored := preview(300_00, 0, 1_000)
	if got := moneyMinor(t, floored, "grossMinor"); got != 45_000 {
		t.Fatalf("floored gross: got %d, want 45000", got)
	}
	if !floored["floorAdjusted"].(bool) {
		t.Fatal("the platform floor must be applied visibly (floorAdjusted)")
	}

	// A rate above the city limit is flagged — and NOT clamped.
	ceiling := preview(60_000, 0, 10_500)
	if !ceiling["exceedsCeiling"].(bool) {
		t.Fatal("a rate above maxPerKmMinor must set exceedsCeiling")
	}
	if got := moneyMinor(t, ceiling, "grossMinor"); got != (60_000*10_500+500)/1_000 {
		t.Fatalf("the ceiling flag must not clamp the gross: got %d", got)
	}
	if disclaimer, _ := ceiling["disclaimer"].(string); disclaimer == "" {
		t.Fatal("a preview always carries its disclaimer")
	}
}

// TestDriverViewPresets: server-generated presets are deduplicated, inside the
// bounds, and carry gross/commission/net plus honest affordability.
func TestDriverViewPresets(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()

	view, _ := publishAt(t, h, rider, 0) // requested = the floor
	requestID := view["requestId"].(string)
	minimum := moneyMinor(t, view, "minimumFareMinor")
	maximum := moneyMinor(t, view, "maximumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)

	recorder := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/driver-view", driver, nil)
	requireStatus(t, recorder, http.StatusOK)
	body := decode(t, recorder)

	presets := body["presets"].([]any)
	if len(presets) == 0 {
		t.Fatal("the driver view must offer presets")
	}
	seen := map[int64]bool{}
	for _, raw := range presets {
		preset := raw.(map[string]any)
		amount := moneyMinor(t, preset, "amountMinor")
		if amount < minimum || amount > maximum {
			t.Fatalf("preset %v is outside the bounds [%d, %d]", preset, minimum, maximum)
		}
		if seen[amount] {
			t.Fatalf("duplicate preset amount %d", amount)
		}
		seen[amount] = true
		commission := marketplace.CommissionMinor(amount)
		if got := moneyMinor(t, preset, "commissionMinor"); got != commission {
			t.Fatalf("preset commission: got %d, want %d", got, commission)
		}
		if got := moneyMinor(t, preset, "netMinor"); got != amount-commission {
			t.Fatalf("preset net: got %d, want %d", got, amount-commission)
		}
		if !preset["affordable"].(bool) {
			t.Fatalf("a fully funded driver must afford every preset: %v", preset)
		}
	}
	// The requested amount is the floor here, so "lower" cannot exist but
	// "requested" and "higher" must.
	sources := map[string]bool{}
	for _, raw := range presets {
		sources[raw.(map[string]any)["source"].(string)] = true
	}
	if !sources["requested"] || !sources["higher"] {
		t.Fatalf("expected requested + higher presets, got %v", sources)
	}
	if sources["lower"] {
		t.Fatal("a request at the floor cannot offer a lower preset")
	}

	// A broke driver sees the same presets with the exact shortfall, never a
	// silent unaffordable button.
	h.Wallet.SetSpendable(driver.UserID, 0)
	broke := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/driver-view", driver, nil)
	requireStatus(t, broke, http.StatusOK)
	for _, raw := range decode(t, broke)["presets"].([]any) {
		preset := raw.(map[string]any)
		if preset["affordable"].(bool) {
			t.Fatalf("a driver with no spendable cannot afford a preset: %v", preset)
		}
		commission := moneyMinor(t, preset, "commissionMinor")
		if got := moneyMinor(t, preset, "shortfallMinor"); got != commission {
			t.Fatalf("shortfall: got %d, want %d", got, commission)
		}
		if label, _ := preset["shortfallLabel"].(string); label == "" {
			t.Fatalf("an unaffordable preset must say how much to top up: %v", preset)
		}
	}
}

// TestFeedIsPrivacyLimited: a feed card carries area labels and money, never
// exact coordinates or addresses, and only drivers inside the envelope see it.
func TestFeedPrivacy(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	view, _ := publishAt(t, h, rider, 0)

	nearDriver := h.Driver()
	parkDriver(t, h, nearDriver, testutil.PickupFixture())
	recorder := h.Do(http.MethodGet, "/mp/feed", nearDriver, nil)
	requireStatus(t, recorder, http.StatusOK)
	page := decode(t, recorder)
	items := page["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("a parked driver at the pickup must see the request: %v", page)
	}
	item := items[0].(map[string]any)
	if item["requestId"] != view["requestId"] {
		t.Fatalf("wrong feed item: %v", item)
	}
	meta, _ := item["meta"].(string)
	if !strings.Contains(meta, "Area") {
		t.Fatalf("feed meta must speak in area labels: %q", meta)
	}
	if _, leaked := item["pickup"]; leaked {
		t.Fatal("a feed card must not carry pickup coordinates")
	}

	farDriver := h.Driver()
	parkDriver(t, h, farDriver, testutil.PlaceAt(testutil.PickupFixture(), 8_000))
	far := h.Do(http.MethodGet, "/mp/feed", farDriver, nil)
	requireStatus(t, far, http.StatusOK)
	if items := decode(t, far)["items"].([]any); len(items) != 0 {
		t.Fatalf("a driver outside the envelope must not see the request: %v", items)
	}
}
