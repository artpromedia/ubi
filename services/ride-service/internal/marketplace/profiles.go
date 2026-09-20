package marketplace

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// profileFormulaVersion names the profile arithmetic below, so a preview can
// state which formula produced it.
const profileFormulaVersion = 1

// profileDistanceFare prices routed metres against a per-km rate with integer
// arithmetic and half-up rounding AT THE END: fare = perKm * metres / 1000,
// never `round the km first` — 10,500 m at 300.00/km is 3,150.00, not
// 3,300.00 or 3,000.00.
func profileDistanceFare(perKmMinor, distanceMeters int64) int64 {
	if perKmMinor <= 0 || distanceMeters <= 0 {
		return 0
	}
	return (perKmMinor*distanceMeters + 500) / 1000
}

// profileFare is the gross service fare a profile asks for a routed distance:
// the greater of the minimum trip fare and the distance component (plus any
// configured optional components — none are enabled in this slice).
func profileFare(profile *RateProfile, distanceMeters int64) int64 {
	fare := profileDistanceFare(profile.PerKmMinor, distanceMeters)
	if fare < profile.MinTripMinor {
		fare = profile.MinTripMinor
	}
	return fare
}

// RateProfiles answers GET /v1/mp/rate-profiles: the newest version of each
// of the driver's profiles.
func (s *Service) RateProfiles(ctx context.Context, actor Actor) ([]*RateProfileView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a driver has rate profiles")
	}
	profiles, err := s.deps.Store.RateProfilesForDriver(ctx, s.deps.Store.Pool(), actor.UserID)
	if err != nil {
		return nil, asDomainError(err)
	}
	views := make([]*RateProfileView, 0, len(profiles))
	for _, profile := range profiles {
		views = append(views, rateProfileViewOf(profile))
	}
	return views, nil
}

// SaveRateProfileRequest is the body of PUT /v1/mp/rate-profiles.
type SaveRateProfileRequest struct {
	CityID               string `json:"cityId"`
	Service              string `json:"service"`
	VehicleClass         string `json:"vehicleClass"`
	PerKmMinor           int64  `json:"perKmMinor"`
	MinimumTripFareMinor int64  `json:"minimumTripFareMinor"`
}

// SaveRateProfile appends a new profile version (D09). Saving shapes FUTURE
// calculations only: no outstanding bid, hold or award is touched, ever.
func (s *Service) SaveRateProfile(ctx context.Context, actor Actor, req SaveRateProfileRequest, idempotencyKey string) (*RateProfileView, int, error) {
	if !actor.IsDriver() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only a driver can save a rate profile")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	if req.Service != ServiceRide && req.Service != ServiceDelivery {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "%q is not a marketplace service", req.Service)
	}
	if req.PerKmMinor <= 0 || req.MinimumTripFareMinor < 0 {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "a rate profile needs a positive per-km rate")
	}
	if err := s.requireServiceFlag(ctx, req.Service, actor, req.CityID); err != nil {
		return nil, 0, err
	}

	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeRateProfileSave, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view RateProfileView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}

	config, _, err := s.policy(ctx, req.CityID)
	if err != nil {
		return nil, 0, err
	}
	if !config.SupportsVehicleClass(req.VehicleClass) {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed,
			"this city does not offer the %q class", req.VehicleClass)
	}
	bounds, err := config.MarketplaceRateBoundsFor(req.Service, req.VehicleClass)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if req.PerKmMinor > bounds.MaxPerKmMinor || req.MinimumTripFareMinor > bounds.MaxMinimumTripFareMinor {
		return nil, 0, domain.Errorf(domain.CodeRateProfileOutOfBounds,
			"this rate is above the city's limits for %s %s", req.Service, req.VehicleClass).
			WithDetails(map[string]any{
				"maxPerKmMinor":                 bounds.MaxPerKmMinor,
				"maxMinimumTripFareMinor":       bounds.MaxMinimumTripFareMinor,
				"submittedPerKmMinor":           req.PerKmMinor,
				"submittedMinimumTripFareMinor": req.MinimumTripFareMinor,
			})
	}

	now := s.now()
	version := 1
	if latest, err := s.deps.Store.LatestRateProfile(ctx, s.deps.Store.Pool(), actor.UserID,
		req.CityID, req.Service, req.VehicleClass); err == nil {
		version = latest.Version + 1
	} else if !errors.Is(err, domain.ErrNotFound) {
		return nil, 0, asDomainError(err)
	}

	profile := &RateProfile{
		ID:           uuid.New(),
		DriverID:     actor.UserID,
		CityID:       req.CityID,
		Service:      req.Service,
		VehicleClass: req.VehicleClass,
		Currency:     config.Currency,
		Version:      version,
		PerKmMinor:   req.PerKmMinor,
		MinTripMinor: req.MinimumTripFareMinor,
	}

	var view *RateProfileView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.deps.Store.InsertRateProfile(ctx, tx, profile); err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.rate_profile.saved",
			AggregateType:  subjectRateProfile,
			AggregateID:    profile.ID.String(),
			ToVersion:      profile.Version,
			CityID:         profile.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "mp.rate_profile.saved:" + profile.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"profileId":    profile.ID.String(),
				"driverId":     actor.UserID.String(),
				"version":      profile.Version,
				"service":      profile.Service,
				"vehicleClass": profile.VehicleClass,
				"perKmMinor":   profile.PerKmMinor,
				"minTripMinor": profile.MinTripMinor,
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.rate_profile.saved",
			SubjectType: subjectRateProfile,
			SubjectID:   profile.ID.String(),
			After: map[string]any{
				"version":      profile.Version,
				"perKmMinor":   profile.PerKmMinor,
				"minTripMinor": profile.MinTripMinor,
				"currency":     profile.Currency,
			},
			Reason: "driver saved a rate profile version",
		}); err != nil {
			return err
		}
		view = rateProfileViewOf(profile)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeRateProfileSave, actor.UserID, idempotencyKey, req, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, 200, nil
}

// RatePreviewRequest is the body of POST /v1/mp/rate-profiles/preview.
type RatePreviewRequest struct {
	CityID                string `json:"cityId"`
	Service               string `json:"service"`
	VehicleClass          string `json:"vehicleClass"`
	PerKmMinor            int64  `json:"perKmMinor"`
	MinimumTripFareMinor  int64  `json:"minimumTripFareMinor"`
	ExampleDistanceMeters int64  `json:"exampleDistanceMeters"`
}

// PreviewRateProfile is the ONLY place example maths happens: server-computed,
// on routed-style metres, with the platform floor applied visibly and a
// ceiling breach flagged without clamping.
func (s *Service) PreviewRateProfile(ctx context.Context, actor Actor, req RatePreviewRequest) (*RatePreviewView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a driver can preview a rate profile")
	}
	if req.Service != ServiceRide && req.Service != ServiceDelivery {
		return nil, domain.Errorf(domain.CodeValidationFailed, "%q is not a marketplace service", req.Service)
	}
	if req.ExampleDistanceMeters <= 0 {
		return nil, domain.Errorf(domain.CodeValidationFailed, "the example distance must be positive")
	}
	if err := s.requireServiceFlag(ctx, req.Service, actor, req.CityID); err != nil {
		return nil, err
	}

	config, _, err := s.policy(ctx, req.CityID)
	if err != nil {
		return nil, err
	}
	fareBounds, err := config.MarketplaceBoundsFor(req.Service, req.VehicleClass)
	if err != nil {
		return nil, asDomainError(err)
	}
	rateBounds, err := config.MarketplaceRateBoundsFor(req.Service, req.VehicleClass)
	if err != nil {
		return nil, asDomainError(err)
	}

	digits := config.CurrencyFractionDigits
	currency := config.Currency

	profile := &RateProfile{PerKmMinor: req.PerKmMinor, MinTripMinor: req.MinimumTripFareMinor}
	distanceComponent := profileDistanceFare(req.PerKmMinor, req.ExampleDistanceMeters)
	raw := profileFare(profile, req.ExampleDistanceMeters)

	// The platform floor a suggested-fare-independent preview can honestly
	// apply: the absolute and cost-based components. The bps-of-suggested
	// parts depend on a real route and are enforced per request.
	floor := fareBounds.AbsoluteFloorMinor
	if fareBounds.CostFloorMinor > floor {
		floor = fareBounds.CostFloorMinor
	}
	gross := raw
	floorAdjusted := false
	if gross < floor {
		gross = floor
		floorAdjusted = true
	}

	// A ceiling breach is flagged, never clamped: the driver sees the truth
	// about their number instead of a silently different one.
	exceedsCeiling := req.PerKmMinor > rateBounds.MaxPerKmMinor ||
		req.MinimumTripFareMinor > rateBounds.MaxMinimumTripFareMinor

	commission := CommissionMinor(gross)
	net := gross - commission

	rows := []RatePreviewRow{
		{Label: "Distance", Value: formatKm(float64(req.ExampleDistanceMeters))},
		{Label: "Distance fare", Value: formatMinor(distanceComponent, currency, digits)},
		{Label: "Minimum trip fare", Value: formatMinor(req.MinimumTripFareMinor, currency, digits)},
	}
	if floorAdjusted {
		rows = append(rows, RatePreviewRow{Label: "Platform floor applied", Value: formatMinor(floor, currency, digits)})
	}
	rows = append(rows,
		RatePreviewRow{Label: "Gross fare", Value: formatMinor(gross, currency, digits)},
		RatePreviewRow{Label: "Fee (10%)", Value: "-" + formatMinor(commission, currency, digits)},
		RatePreviewRow{Label: "You receive", Value: formatMinor(net, currency, digits)},
	)
	if exceedsCeiling {
		rows = append(rows, RatePreviewRow{
			Label: "Above city limit",
			Value: "This rate exceeds the city's limit and cannot be saved",
			Tone:  "errorInk",
		})
	}

	return &RatePreviewView{
		ProfileFormulaVersion: profileFormulaVersion,
		GrossMinor:            money(gross, currency),
		CommissionMinor:       money(commission, currency),
		NetMinor:              money(net, currency),
		FloorAdjusted:         floorAdjusted,
		ExceedsCeiling:        exceedsCeiling,
		Rows:                  rows,
		Disclaimer:            "Example only. Real offers are computed on each request's routed distance and checked against that request's bounds.",
	}, nil
}
