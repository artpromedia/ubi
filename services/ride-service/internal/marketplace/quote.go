package marketplace

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// QuoteParams is what a requester may ask for. Note what is absent: no fare,
// no bounds, no expiry. The client says where; the server says what the
// envelope is.
type QuoteParams struct {
	Service      string
	VehicleClass string
	Pickup       domain.Place
	Dropoff      domain.Place
	WeightKg     float64
}

// pricingVersionFor names the deterministic engine and the config version a
// quote was priced under, so a stored quote states its own provenance.
func pricingVersionFor(config *cityconfig.CityConfig) string {
	return "engine.v1/cfg." + itoa(config.Version)
}

// bpsOf is `amount * bps / 10_000` in integer arithmetic.
func bpsOf(amountMinor, bps int64) int64 {
	return amountMinor * bps / 10_000
}

// boundsFor computes the negotiation bounds for a suggested fare under the
// city's marketplace policy: floor = max(absolute, cost-based, bps of
// suggested); ceiling = bps of suggested. When a short trip puts the floor
// above the bps ceiling, the floor wins — cost protection outranks the
// mistake guard — and the envelope collapses to a single admissible price.
func boundsFor(bounds cityconfig.MarketplaceFareBounds, suggestedMinor int64) (int64, int64) {
	floor := bounds.AbsoluteFloorMinor
	if bounds.CostFloorMinor > floor {
		floor = bounds.CostFloorMinor
	}
	if bps := bpsOf(suggestedMinor, bounds.FloorBpsOfSuggested); bps > floor {
		floor = bps
	}
	ceiling := bpsOf(suggestedMinor, bounds.CeilingBpsOfSuggested)
	if ceiling < floor {
		ceiling = floor
	}
	return floor, ceiling
}

// Quote prices a trip or delivery and answers the bounded envelope (R02).
func (s *Service) Quote(ctx context.Context, actor Actor, params QuoteParams) (*QuoteEnvelopeView, error) {
	if !actor.IsRider() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a requester can ask for a marketplace quote")
	}
	if params.Service != ServiceRide && params.Service != ServiceDelivery {
		return nil, domain.Errorf(domain.CodeValidationFailed, "%q is not a marketplace service", params.Service)
	}
	if !params.Pickup.Valid() {
		return nil, domain.Errorf(domain.CodeValidationFailed, "pickup is not a valid coordinate")
	}
	if !params.Dropoff.Valid() {
		return nil, domain.Errorf(domain.CodeValidationFailed, "dropoff is not a valid coordinate")
	}
	if err := s.requireServiceFlag(ctx, params.Service, actor, actor.CityID); err != nil {
		return nil, err
	}

	config, policy, err := s.policy(ctx, actor.CityID)
	if err != nil {
		return nil, err
	}
	if !config.SupportsVehicleClass(params.VehicleClass) {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"this city does not offer the %q class", params.VehicleClass).
			WithDetails(map[string]any{"vehicleClasses": config.VehicleClasses})
	}
	fareBounds, err := config.MarketplaceBoundsFor(params.Service, params.VehicleClass)
	if err != nil {
		return nil, asDomainError(err)
	}

	route, err := s.deps.Router.Route(ctx, params.Pickup, nil, params.Dropoff)
	if err != nil {
		return nil, asDomainError(err)
	}
	suggested, breakdown, err := s.deps.Pricing.Fare(config, params.VehicleClass, route.DistanceMeters, route.DurationSeconds)
	if err != nil {
		return nil, asDomainError(err)
	}
	minMinor, maxMinor := boundsFor(fareBounds, suggested.AmountMinor)

	rows := []BreakdownRow{
		{Label: "Base", AmountMinor: breakdown.BaseMinor},
		{Label: "Distance", AmountMinor: breakdown.DistanceMinor},
		{Label: "Time", AmountMinor: breakdown.TimeMinor},
		{Label: "Booking fee", AmountMinor: breakdown.BookingFeeMinor},
	}
	if breakdown.MinFareTopUpMinor > 0 {
		rows = append(rows, BreakdownRow{Label: "Minimum fare top-up", AmountMinor: breakdown.MinFareTopUpMinor})
	}

	now := s.now()
	quote := &Quote{
		ID:                uuid.New(),
		RequesterID:       actor.UserID,
		CityID:            config.CityID,
		Service:           params.Service,
		VehicleClass:      params.VehicleClass,
		Currency:          suggested.Currency,
		SuggestedMinor:    suggested.AmountMinor,
		MinMinor:          minMinor,
		MaxMinor:          maxMinor,
		RoutedDistanceM:   route.DistanceMeters,
		RoutedDurationSec: route.DurationSeconds,
		Pickup:            exactAreaOf(params.Pickup),
		Dropoff:           exactAreaOf(params.Dropoff),
		Breakdown:         rows,
		PricingVersion:    pricingVersionFor(config),
		PolicyVersion:     policy.PolicyVersion,
		ExpiresAt:         now.Add(config.QuoteTTL()).Truncate(1e9),
	}

	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		return s.deps.Store.InsertQuote(ctx, tx, quote)
	})
	if err != nil {
		return nil, asDomainError(err)
	}

	return quoteEnvelopeViewOf(quote), nil
}

// quoteEnvelopeViewOf renders the client-facing envelope: every amount a
// Money object, per the contract.
func quoteEnvelopeViewOf(quote *Quote) *QuoteEnvelopeView {
	breakdown := make([]BreakdownRowView, 0, len(quote.Breakdown))
	for _, row := range quote.Breakdown {
		breakdown = append(breakdown, BreakdownRowView{
			Label:       row.Label,
			AmountMinor: money(row.AmountMinor, quote.Currency),
		})
	}
	return &QuoteEnvelopeView{
		QuoteID:              quote.ID.String(),
		Service:              quote.Service,
		VehicleClass:         quote.VehicleClass,
		CityID:               quote.CityID,
		Currency:             quote.Currency,
		SuggestedFareMinor:   money(quote.SuggestedMinor, quote.Currency),
		MinimumFareMinor:     money(quote.MinMinor, quote.Currency),
		MaximumFareMinor:     money(quote.MaxMinor, quote.Currency),
		ExpiresAt:            quote.ExpiresAt,
		PricingVersion:       quote.PricingVersion,
		PolicyVersion:        quote.PolicyVersion,
		Breakdown:            breakdown,
		RoutedDistanceMeters: quote.RoutedDistanceM,
		RoutedDurationSec:    quote.RoutedDurationSec,
	}
}

// exactAreaOf keeps the routed coordinate for server-side checks — envelope
// radius, ETA budgets — under a label that never carries an address. Drivers
// are shown only the label; the coordinate stays inside the server until an
// award discloses the pickup.
func exactAreaOf(place domain.Place) Area {
	return Area{
		Label: areaLabelOf(place.Lat, place.Lng),
		Lat:   place.Lat,
		Lng:   place.Lng,
	}
}

// areaLabelOf coarsens a coordinate into the words a feed card may show:
// roughly a 1 km cell, never a house number.
func areaLabelOf(lat, lng float64) string {
	return fmt.Sprintf("Area %.2f, %.2f", float64(int(lat*100))/100, float64(int(lng*100))/100)
}
