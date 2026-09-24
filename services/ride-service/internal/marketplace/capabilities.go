package marketplace

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// Accessibility and service needs (A06 part D).
//
// A rider may state two different things, and the engine keeps them apart:
//
//   - REQUIREMENTS are concrete needs a trip cannot go ahead without
//     (a wheelchair-accessible vehicle, carrying an assistance animal, extra
//     luggage capacity). Matching may rely ONLY on a VERIFIED capability: a
//     requirement is accepted only where a verified source reports supply in
//     the market, and then only drivers that source verifies may discover or
//     bid on the request (eligibility refuses everyone else with
//     SERVICE_NEED_UNVERIFIED). There is no verified capability source today —
//     user-service's verified driver card reports accessibility
//     "unavailable" — so every requirement is honestly refused as unavailable
//     in the market, with a fallback, instead of being matched silently to
//     unverified drivers or dressed up as accessible supply.
//   - PREFERENCES are soft wishes. They never gate anything; they may only
//     inform the offer comparison's "service fit", and only through a fact the
//     verified driver card carries (the registered vehicle body type).
//
// The capability source is a port (CapabilitySource) so a verified vehicle
// capability registry can plug in later without touching the gates.

// Service requirement codes (MP_SERVICE_REQUIREMENTS).
const (
	RequirementWheelchairAccessible = "wheelchair_accessible_vehicle"
	RequirementAssistanceAnimal     = "assistance_animal"
	RequirementExtraLuggage         = "extra_luggage_capacity"
)

// Service preference codes (MP_SERVICE_PREFERENCES).
const (
	PreferenceLargerVehicle   = "larger_vehicle"
	PreferenceElectricVehicle = "electric_vehicle"
)

// AccessibilityUnavailable is the verified-capability status user-service
// reports today, and the supply status of a requirement nobody verifies.
const AccessibilityUnavailable = "unavailable"

// Requirement supply statuses.
const (
	SupplyVerified    = "verified"
	SupplyUnavailable = "unavailable"
)

// ReasonServiceNeedUnverified: the request states a requirement this driver
// is not verified to meet. Go port of the MP_ELIGIBILITY_REASONS entry.
const ReasonServiceNeedUnverified = "SERVICE_NEED_UNVERIFIED"

type requirementSpec struct {
	code        string
	title       string
	unavailable string
}

// requirementCatalog is the closed list of requirements, in display order.
var requirementCatalog = []requirementSpec{
	{RequirementWheelchairAccessible, "Wheelchair-accessible vehicle",
		"No wheelchair-accessible vehicles are verified in this market yet, so we cannot promise one."},
	{RequirementAssistanceAnimal, "Travelling with an assistance animal",
		"Drivers ready to carry an assistance animal are not verified in this market yet, so we cannot promise one."},
	{RequirementExtraLuggage, "Extra luggage capacity",
		"Vehicle luggage capacity is not verified in this market yet, so we cannot promise the space."},
}

type preferenceSpec struct {
	code   string
	title  string
	detail string
	// bodyTypes are the verified registered body types that meet it.
	bodyTypes map[string]bool
}

// preferenceCatalog is the closed list of soft preferences, in display order.
var preferenceCatalog = []preferenceSpec{
	{PreferenceLargerVehicle, "Larger vehicle",
		"Offers from drivers whose verified registration is an SUV or a van rank higher when you sort by service fit.",
		map[string]bool{"suv": true, "van": true}},
	{PreferenceElectricVehicle, "Electric vehicle",
		"Offers from drivers whose verified registration is an electric vehicle rank higher when you sort by service fit.",
		map[string]bool{"electric": true}},
}

func requirementByCode(code string) (requirementSpec, bool) {
	for _, spec := range requirementCatalog {
		if spec.code == code {
			return spec, true
		}
	}
	return requirementSpec{}, false
}

func preferenceByCode(code string) (preferenceSpec, bool) {
	for _, spec := range preferenceCatalog {
		if spec.code == code {
			return spec, true
		}
	}
	return preferenceSpec{}, false
}

// serviceNeedsFallback is what a rider is offered when a requirement is not
// available: nothing is published on their behalf.
const serviceNeedsFallback = "Nothing was published. You can publish without the requirement, add it as a preference where one fits, or contact support to arrange the trip."

// ServiceNeedsInput is the optional serviceNeeds object of POST
// /v1/mp/requests (MpServiceNeedsInputSchema).
type ServiceNeedsInput struct {
	Requirements []string `json:"requirements,omitempty"`
	Preferences  []string `json:"preferences,omitempty"`
}

// ServiceNeeds is a request's stored needs: codes only, never free text.
type ServiceNeeds struct {
	Requirements []string `json:"requirements"`
	Preferences  []string `json:"preferences"`
}

func (n *ServiceNeeds) empty() bool {
	return n == nil || (len(n.Requirements) == 0 && len(n.Preferences) == 0)
}

// canonicalServiceNeeds validates the input against the closed catalogs and
// returns it in canonical (catalog) order; nil means "no needs stated".
func canonicalServiceNeeds(input *ServiceNeedsInput) (*ServiceNeeds, error) {
	if input == nil || (len(input.Requirements) == 0 && len(input.Preferences) == 0) {
		return nil, nil
	}
	seen := map[string]bool{}
	needs := &ServiceNeeds{Requirements: []string{}, Preferences: []string{}}
	for index, code := range input.Requirements {
		if _, ok := requirementByCode(code); !ok {
			return nil, domain.Errorf(domain.CodeValidationFailed, "%q is not a service requirement", code).
				WithDetails(map[string]any{"field": fmt.Sprintf("serviceNeeds.requirements[%d]", index)})
		}
		if seen[code] {
			return nil, domain.Errorf(domain.CodeValidationFailed, "%q is listed twice", code).
				WithDetails(map[string]any{"field": fmt.Sprintf("serviceNeeds.requirements[%d]", index)})
		}
		seen[code] = true
		needs.Requirements = append(needs.Requirements, code)
	}
	for index, code := range input.Preferences {
		if _, ok := preferenceByCode(code); !ok {
			return nil, domain.Errorf(domain.CodeValidationFailed, "%q is not a service preference", code).
				WithDetails(map[string]any{"field": fmt.Sprintf("serviceNeeds.preferences[%d]", index)})
		}
		if seen[code] {
			return nil, domain.Errorf(domain.CodeValidationFailed, "%q is listed twice", code).
				WithDetails(map[string]any{"field": fmt.Sprintf("serviceNeeds.preferences[%d]", index)})
		}
		seen[code] = true
		needs.Preferences = append(needs.Preferences, code)
	}
	order := func(codes []string, rank func(string) int) {
		sort.SliceStable(codes, func(i, j int) bool { return rank(codes[i]) < rank(codes[j]) })
	}
	order(needs.Requirements, func(code string) int {
		for i, spec := range requirementCatalog {
			if spec.code == code {
				return i
			}
		}
		return len(requirementCatalog)
	})
	order(needs.Preferences, func(code string) int {
		for i, spec := range preferenceCatalog {
			if spec.code == code {
				return i
			}
		}
		return len(preferenceCatalog)
	})
	return needs, nil
}

// ---------------------------------------------------------------------------
// The capability source
// ---------------------------------------------------------------------------

// CapabilitySource answers what is VERIFIED about service requirements. It
// is the seam a verified vehicle-capability registry plugs into.
type CapabilitySource interface {
	// MarketSupply reports whether this market has VERIFIED supply for a
	// requirement: SupplyVerified, or SupplyUnavailable with the reason the
	// rider is shown.
	MarketSupply(ctx context.Context, cityID, service, vehicleClass, requirement string) (status string, reason string)
	// DriverCapabilities returns the requirements a driver is VERIFIED to
	// meet. An error means nothing is verified for them right now.
	DriverCapabilities(ctx context.Context, driverID uuid.UUID) (map[string]bool, error)
}

// profileCapabilitySource is the production source: user-service's verified
// driver card. That card carries accessibility "unavailable" (there is no
// verified vehicle-capability data model yet), so this source verifies no
// requirement for any driver and reports no verified supply in any market.
type profileCapabilitySource struct{}

func (p profileCapabilitySource) MarketSupply(_ context.Context, _, _, _, requirement string) (string, string) {
	spec, ok := requirementByCode(requirement)
	if !ok {
		return SupplyUnavailable, "This requirement is not supported."
	}
	return SupplyUnavailable, spec.unavailable
}

func (p profileCapabilitySource) DriverCapabilities(context.Context, uuid.UUID) (map[string]bool, error) {
	// The verified card's accessibility status is "unavailable" under
	// today's contract — the port refuses a card claiming anything else as
	// malformed — so no requirement is verified for any driver. When the
	// contract gains a verified status, its capabilities map here.
	return map[string]bool{}, nil
}

// capabilities is the configured source, or the profile-backed default.
func (s *Service) capabilities() CapabilitySource {
	if s.deps.Capabilities != nil {
		return s.deps.Capabilities
	}
	return profileCapabilitySource{}
}

// unavailableRequirements answers, for a set of requirements, the ones this
// market cannot honour, each with the rider-facing reason.
func (s *Service) unavailableRequirements(ctx context.Context, cityID, service, vehicleClass string, requirements []string) []ServiceRequirementView {
	var out []ServiceRequirementView
	for _, code := range requirements {
		status, why := s.capabilities().MarketSupply(ctx, cityID, service, vehicleClass, code)
		if status == SupplyVerified {
			continue
		}
		spec, _ := requirementByCode(code)
		out = append(out, ServiceRequirementView{Code: code, Title: spec.title, Availability: SupplyUnavailable, Detail: why})
	}
	return out
}

// unmetRequirements lists the request's requirements this driver is not
// VERIFIED to meet. An unreadable capability answer verifies nothing.
func (s *Service) unmetRequirements(ctx context.Context, driverID uuid.UUID, needs *ServiceNeeds) []string {
	if needs == nil || len(needs.Requirements) == 0 {
		return nil
	}
	verified, err := s.capabilities().DriverCapabilities(ctx, driverID)
	if err != nil {
		verified = map[string]bool{}
	}
	var unmet []string
	for _, code := range needs.Requirements {
		if !verified[code] {
			unmet = append(unmet, code)
		}
	}
	return unmet
}

// ---------------------------------------------------------------------------
// The catalog view: GET /v1/mp/service-needs
// ---------------------------------------------------------------------------

// ServiceRequirementView is one requirement and its honest availability.
type ServiceRequirementView struct {
	Code         string `json:"code"`
	Title        string `json:"title"`
	Availability string `json:"availability"`
	Detail       string `json:"detail"`
}

// ServicePreferenceView is one soft preference and what it can affect.
type ServicePreferenceView struct {
	Code   string `json:"code"`
	Title  string `json:"title"`
	Effect string `json:"effect"`
	Detail string `json:"detail"`
}

// ServiceNeedsCatalogView answers GET /v1/mp/service-needs
// (MpServiceNeedsCatalogSchema).
type ServiceNeedsCatalogView struct {
	CityID       string                   `json:"cityId"`
	Service      string                   `json:"service"`
	VehicleClass string                   `json:"vehicleClass"`
	Requirements []ServiceRequirementView `json:"requirements"`
	Preferences  []ServicePreferenceView  `json:"preferences"`
	Fallback     string                   `json:"fallback"`
	Disclosure   string                   `json:"disclosure"`
}

// preferenceEffectRankingOnly is the only effect a soft preference has.
const preferenceEffectRankingOnly = "ranking_only"

const serviceNeedsDisclosure = "Requirements are matched only to capabilities we have verified. Where none are verified we say so instead of matching you to a driver who may not meet them. Preferences never limit who can offer; they only change the service-fit order."

// ServiceNeedsCatalog answers GET /v1/mp/service-needs: the requirements a
// rider may state, each with its honest availability in the rider's market,
// and the soft preferences with what they can (and cannot) do.
func (s *Service) ServiceNeedsCatalog(ctx context.Context, actor Actor, service, vehicleClass string) (*ServiceNeedsCatalogView, error) {
	if !actor.IsRider() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a requester states service needs")
	}
	if actor.CityID == "" {
		return nil, domain.Errorf(domain.CodeValidationFailed, "the gateway did not say which city this requester is in")
	}
	if service == "" {
		service = ServiceRide
	}
	if service != ServiceRide {
		return nil, domain.Errorf(domain.CodeValidationFailed, "service needs apply to rides").
			WithDetails(map[string]any{"field": "service"})
	}
	if err := s.requireServiceFlag(ctx, service, actor, actor.CityID); err != nil {
		return nil, err
	}
	if err := s.requireFlag(ctx, cityconfig.FlagMarketplaceAccessibility, actor, actor.CityID); err != nil {
		return nil, err
	}
	config, _, err := s.policy(ctx, actor.CityID)
	if err != nil {
		return nil, err
	}
	if vehicleClass == "" {
		return nil, domain.Errorf(domain.CodeValidationFailed, "vehicleClass is required").
			WithDetails(map[string]any{"field": "vehicleClass"})
	}
	if !config.SupportsVehicleClass(vehicleClass) {
		return nil, domain.Errorf(domain.CodeValidationFailed, "%q is not sold in this city", vehicleClass).
			WithDetails(map[string]any{"field": "vehicleClass"})
	}
	view := &ServiceNeedsCatalogView{
		CityID:       actor.CityID,
		Service:      service,
		VehicleClass: vehicleClass,
		Requirements: make([]ServiceRequirementView, 0, len(requirementCatalog)),
		Preferences:  make([]ServicePreferenceView, 0, len(preferenceCatalog)),
		Fallback:     serviceNeedsFallback,
		Disclosure:   serviceNeedsDisclosure,
	}
	for _, spec := range requirementCatalog {
		status, why := s.capabilities().MarketSupply(ctx, actor.CityID, service, vehicleClass, spec.code)
		if status != SupplyVerified {
			status = SupplyUnavailable
		} else {
			why = "Verified drivers can offer on this requirement in this market."
		}
		view.Requirements = append(view.Requirements, ServiceRequirementView{
			Code: spec.code, Title: spec.title, Availability: status, Detail: why,
		})
	}
	for _, spec := range preferenceCatalog {
		view.Preferences = append(view.Preferences, ServicePreferenceView{
			Code: spec.code, Title: spec.title, Effect: preferenceEffectRankingOnly, Detail: spec.detail,
		})
	}
	return view, nil
}

// ---------------------------------------------------------------------------
// Store: mp.request_service_needs
// ---------------------------------------------------------------------------

// InsertRequestServiceNeeds records a request's needs inside the publishing
// transaction.
func (s *Store) InsertRequestServiceNeeds(ctx context.Context, tx pgx.Tx, requestID uuid.UUID, needs *ServiceNeeds) error {
	requirements, err := json.Marshal(needs.Requirements)
	if err != nil {
		return fmt.Errorf("unserialisable requirements: %w", err)
	}
	preferences, err := json.Marshal(needs.Preferences)
	if err != nil {
		return fmt.Errorf("unserialisable preferences: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO mp.request_service_needs (request_id, requirements, preferences)
		VALUES ($1, $2, $3)`, requestID, requirements, preferences); err != nil {
		return fmt.Errorf("failed to record the request's service needs: %w", err)
	}
	return nil
}

// ServiceNeedsForRequests reads the needs of a set of requests; requests
// without stated needs are absent from the map.
func (s *Store) ServiceNeedsForRequests(ctx context.Context, db DB, requestIDs []uuid.UUID) (map[uuid.UUID]*ServiceNeeds, error) {
	out := map[uuid.UUID]*ServiceNeeds{}
	if len(requestIDs) == 0 {
		return out, nil
	}
	rows, err := db.Query(ctx, `
		SELECT request_id, requirements, preferences FROM mp.request_service_needs
		WHERE request_id = ANY($1)`, requestIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to read service needs: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var requirements, preferences []byte
		if err := rows.Scan(&id, &requirements, &preferences); err != nil {
			return nil, fmt.Errorf("failed to read service needs: %w", err)
		}
		needs := &ServiceNeeds{Requirements: []string{}, Preferences: []string{}}
		if err := json.Unmarshal(requirements, &needs.Requirements); err != nil {
			return nil, fmt.Errorf("request %s stores unreadable requirements: %w", id, err)
		}
		if err := json.Unmarshal(preferences, &needs.Preferences); err != nil {
			return nil, fmt.Errorf("request %s stores unreadable preferences: %w", id, err)
		}
		out[id] = needs
	}
	return out, rows.Err()
}

// requestServiceNeeds reads one request's needs (nil when none were stated).
func (s *Service) requestServiceNeeds(ctx context.Context, requestID uuid.UUID) (*ServiceNeeds, error) {
	all, err := s.deps.Store.ServiceNeedsForRequests(ctx, s.deps.Store.Pool(), []uuid.UUID{requestID})
	if err != nil {
		return nil, err
	}
	return all[requestID], nil
}

// validateServiceNeeds is Publish's gate: needs are a deny-by-default input,
// and a requirement the market cannot verify refuses the whole publish with
// the honest reason and a fallback — nothing is published silently without it.
func (s *Service) validateServiceNeeds(ctx context.Context, actor Actor, quote *Quote, input *ServiceNeedsInput) (*ServiceNeeds, error) {
	needs, err := canonicalServiceNeeds(input)
	if err != nil || needs == nil {
		return nil, err
	}
	if err := s.requireFlag(ctx, cityconfig.FlagMarketplaceAccessibility, actor, quote.CityID); err != nil {
		return nil, err
	}
	if quote.Service != ServiceRide {
		return nil, domain.Errorf(domain.CodeValidationFailed, "service needs apply to rides").
			WithDetails(map[string]any{"field": "serviceNeeds"})
	}
	if unavailable := s.unavailableRequirements(ctx, quote.CityID, quote.Service, quote.VehicleClass, needs.Requirements); len(unavailable) > 0 {
		return nil, domain.Errorf(domain.CodeConflict,
			"a requirement you stated cannot be met by a verified driver in this market").
			WithDetails(map[string]any{
				"reason":       "service_need_unavailable",
				"requirements": unavailable,
				"fallback":     serviceNeedsFallback,
			})
	}
	return needs, nil
}
