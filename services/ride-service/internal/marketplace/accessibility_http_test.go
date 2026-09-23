package marketplace_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// requestsOf counts a requester's marketplace requests.
func requestsOf(t *testing.T, h *testutil.Harness, requester testutil.Actor) int {
	t.Helper()
	var count int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM mp.requests WHERE requester_id = $1`, requester.UserID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

// TestAccessibilityRequirementIsHonestlyUnavailable: with the production
// capability source (user-service's verified card reports accessibility
// "unavailable"; no verified vehicle-capability registry exists) every
// requirement is shown as unavailable in the market, and publishing one is
// refused with the reason and a fallback — nothing is published, the quote
// is not spent, and no driver is silently matched. Preferences are accepted
// (ranking only). The input is deny-by-default.
func TestAccessibilityRequirementIsHonestlyUnavailable(t *testing.T) {
	h := confidenceHarness(t)
	rider := h.Rider()

	recorder := h.Do(http.MethodGet, "/mp/service-needs?vehicleClass=go", rider, nil)
	requireStatus(t, recorder, http.StatusOK)
	catalog := decode(t, recorder)
	requirements := catalog["requirements"].([]any)
	if len(requirements) != 3 {
		t.Fatalf("three concrete requirements: %v", requirements)
	}
	for _, raw := range requirements {
		requirement := raw.(map[string]any)
		if requirement["availability"] != marketplace.SupplyUnavailable || requirement["detail"] == "" {
			t.Fatalf("no requirement is claimed as supplied: %v", requirement)
		}
	}
	for _, raw := range catalog["preferences"].([]any) {
		if raw.(map[string]any)["effect"] != "ranking_only" {
			t.Fatalf("a preference only ever ranks: %v", raw)
		}
	}

	quote := quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture())
	body := map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "minimumFareMinor")),
		"paymentMethodId":    "wallet",
		"serviceNeeds":       map[string]any{"requirements": []string{"wheelchair_accessible_vehicle"}},
	}
	refused := h.Do(http.MethodPost, "/mp/requests", rider, body, move.IdempotencyHeader, idemKey())
	requireCode(t, refused, http.StatusConflict, domain.CodeConflict)
	details := decode(t, refused)["details"].(map[string]any)
	listed := details["requirements"].([]any)
	if details["reason"] != "service_need_unavailable" || len(listed) != 1 ||
		listed[0].(map[string]any)["code"] != marketplace.RequirementWheelchairAccessible || details["fallback"] == "" {
		t.Fatalf("the refusal names the requirement, why, and a fallback: %v", details)
	}
	if requestsOf(t, h, rider) != 0 {
		t.Fatal("nothing is published without a requirement the rider stated")
	}
	// The quote was not spent: the rider can publish it without the
	// requirement (their choice), with a preference that only ranks.
	delete(body, "serviceNeeds")
	body["serviceNeeds"] = map[string]any{"preferences": []string{"larger_vehicle"}}
	published := h.Do(http.MethodPost, "/mp/requests", rider, body, move.IdempotencyHeader, idemKey())
	requireStatus(t, published, http.StatusCreated)
	requestID := decode(t, published)["requestId"].(string)
	needs := snapshotOf(t, h, rider, requestID, "")["request"].(map[string]any)["serviceNeeds"].(map[string]any)
	if len(needs["requirements"].([]any)) != 0 || needs["preferences"].([]any)[0] != marketplace.PreferenceLargerVehicle {
		t.Fatalf("the owner sees exactly the needs stated: %v", needs)
	}

	// A preference never gates discovery: an ordinary parked driver sees it.
	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PickupFixture())
	if _, seen := feedHas(t, h, driver, requestID); !seen {
		t.Fatal("a soft preference must not hide a request from drivers")
	}

	requireCode(t, publishWith(t, h, h.Rider(), map[string]any{
		"serviceNeeds": map[string]any{"requirements": []string{"child_seat"}},
	}), http.StatusUnprocessableEntity, domain.CodeValidationFailed)

	// Deny by default.
	setFlagForCity(t, h, cityconfig.FlagMarketplaceAccessibility, false)
	requireCode(t, h.Do(http.MethodGet, "/mp/service-needs?vehicleClass=go", rider, nil), http.StatusNotFound, domain.CodeFeatureDisabled)
	requireCode(t, publishWith(t, h, h.Rider(), map[string]any{
		"serviceNeeds": map[string]any{"preferences": []string{"larger_vehicle"}},
	}), http.StatusNotFound, domain.CodeFeatureDisabled)
}

// verifiedCapabilities is a capability source that verifies what the test
// says: the seam a verified vehicle-capability registry plugs into.
type verifiedCapabilities struct {
	market  map[string]bool
	drivers map[uuid.UUID]map[string]bool
}

func (v verifiedCapabilities) MarketSupply(_ context.Context, _, _, _, requirement string) (string, string) {
	if v.market[requirement] {
		return marketplace.SupplyVerified, ""
	}
	return marketplace.SupplyUnavailable, "not verified here"
}

func (v verifiedCapabilities) DriverCapabilities(_ context.Context, driverID uuid.UUID) (map[string]bool, error) {
	return v.drivers[driverID], nil
}

// TestVerifiedCapabilityGatesMatching: where a verified source reports
// wheelchair-accessible supply, a request requiring it is published — and
// only drivers that source verifies may discover or bid on it. An unverified
// driver never sees it, and eligibility refuses them with
// SERVICE_NEED_UNVERIFIED.
func TestVerifiedCapabilityGatesMatching(t *testing.T) {
	accessible, ordinary := uuid.New(), uuid.New()
	source := verifiedCapabilities{
		market:  map[string]bool{marketplace.RequirementWheelchairAccessible: true},
		drivers: map[uuid.UUID]map[string]bool{accessible: {marketplace.RequirementWheelchairAccessible: true}},
	}
	h := confidenceHarness(t, testutil.WithCapabilities(source))
	rider := h.Rider()

	recorder := publishWith(t, h, rider, map[string]any{
		"serviceNeeds": map[string]any{"requirements": []string{"wheelchair_accessible_vehicle"}},
	})
	requireStatus(t, recorder, http.StatusCreated)
	view := decode(t, recorder)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	verified := testutil.Actor{UserID: accessible, Role: move.RoleDriver, CityID: h.CityID}
	unverified := testutil.Actor{UserID: ordinary, Role: move.RoleDriver, CityID: h.CityID}
	parkDriver(t, h, verified, testutil.PickupFixture())
	parkDriver(t, h, unverified, testutil.PlaceAt(testutil.PickupFixture(), 200))

	if _, seen := feedHas(t, h, unverified, requestID); seen {
		t.Fatal("an unverified driver must never be matched to a requirement")
	}
	eligibility := driverViewOf(t, h, unverified, requestID)["eligibility"].(map[string]any)
	if eligibility["eligible"] != false || eligibility["reasons"].([]any)[0].(map[string]any)["code"] != marketplace.ReasonServiceNeedUnverified {
		t.Fatalf("eligibility refuses with the honest reason: %v", eligibility)
	}
	requireCode(t, tryBid(t, h, unverified, requestID, amount), domain.StatusFor(domain.CodeSlotUnavailable), domain.CodeSlotUnavailable)

	if _, seen := feedHas(t, h, verified, requestID); !seen {
		t.Fatal("a verified driver discovers the request")
	}
	bidNow(t, h, verified, requestID, amount)
}
