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
	// Stops are the ordered intermediate stops, pickup → stops → dropoff.
	// Empty is the plain route, priced exactly as before.
	Stops    []StopInput
	WeightKg float64
	// Business asks for the organization's advisory policy verdict (A06
	// part C; organizationId / costCentreId / travellerId query params).
	Business *BusinessQuoteInput
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
	if len(params.Stops) > 0 && params.Service == ServiceDelivery {
		// Refused before any flag is read: a delivery is single-drop whatever
		// is switched on, and the requester is owed the reason.
		return nil, s.requireStopsAllowed(ctx, params.Service, actor, actor.CityID)
	}
	if err := s.requireServiceFlag(ctx, params.Service, actor, actor.CityID); err != nil {
		return nil, err
	}
	if len(params.Stops) > 0 {
		if err := s.requireStopsAllowed(ctx, params.Service, actor, actor.CityID); err != nil {
			return nil, err
		}
	}

	config, policy, err := s.policy(ctx, actor.CityID)
	if err != nil {
		return nil, err
	}
	quote, err := s.priceQuote(ctx, actor.UserID, config, policy, params)
	if err != nil {
		return nil, err
	}

	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		return s.deps.Store.InsertQuote(ctx, tx, quote)
	})
	if err != nil {
		return nil, asDomainError(err)
	}

	envelope := quoteEnvelopeViewOf(quote)
	if params.Business != nil {
		// Read after the quote is stored and outside any transaction: the
		// verdict is advisory (the reservation re-decides everything).
		if envelope.Business, err = s.quoteBusinessCheck(ctx, actor, quote, params.Business); err != nil {
			return nil, err
		}
	}
	return envelope, nil
}

// priceQuote routes and prices a trip server-side under the city's policy and
// returns the bounded quote, unsaved. The HTTP quote and the Book for Later
// publication worker (A03, which re-prices a stored route at publication)
// share it, so a refreshed quote is priced exactly like a fresh one.
func (s *Service) priceQuote(ctx context.Context, requesterID uuid.UUID, config *cityconfig.CityConfig, policy *cityconfig.MarketplacePolicy, params QuoteParams) (*Quote, error) {
	if !config.SupportsVehicleClass(params.VehicleClass) {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"this city does not offer the %q class", params.VehicleClass).
			WithDetails(map[string]any{"vehicleClasses": config.VehicleClasses})
	}
	fareBounds, err := config.MarketplaceBoundsFor(params.Service, params.VehicleClass)
	if err != nil {
		return nil, asDomainError(err)
	}

	stops, err := buildRouteStops(params.Pickup, params.Dropoff, params.Stops, policy.StopsPolicy())
	if err != nil {
		return nil, err
	}

	// The COMPLETE ordered route is measured by the shared Router (it sums
	// pickup → stops → dropoff legs) and priced server-side; the expected
	// dwell at the stops is priced as route time under the same per-minute
	// fare, and the bounds below are derived from that full-route price.
	route, err := s.deps.Router.Route(ctx, params.Pickup, stopPlaces(stops), params.Dropoff)
	if err != nil {
		return nil, asDomainError(err)
	}
	dwellSec := totalDwellSec(stops)
	suggested, breakdown, err := s.deps.Pricing.Fare(config, params.VehicleClass, route.DistanceMeters, route.DurationSeconds+dwellSec)
	if err != nil {
		return nil, asDomainError(err)
	}
	minMinor, maxMinor := boundsFor(fareBounds, suggested.AmountMinor)

	timeMinor, waitingMinor := breakdown.TimeMinor, int64(0)
	if dwellSec > 0 {
		// Split the time line so the stop waiting is its own disclosed row:
		// the driving-only time, and the difference the dwell adds.
		_, driving, err := s.deps.Pricing.Fare(config, params.VehicleClass, route.DistanceMeters, route.DurationSeconds)
		if err != nil {
			return nil, asDomainError(err)
		}
		timeMinor, waitingMinor = driving.TimeMinor, breakdown.TimeMinor-driving.TimeMinor
	}
	rows := []BreakdownRow{
		{Label: "Base", AmountMinor: breakdown.BaseMinor},
		{Label: "Distance", AmountMinor: breakdown.DistanceMinor},
		{Label: "Time", AmountMinor: timeMinor},
	}
	if len(stops) > 0 {
		rows = append(rows, BreakdownRow{Label: "Stop waiting", AmountMinor: waitingMinor})
	}
	rows = append(rows, BreakdownRow{Label: "Booking fee", AmountMinor: breakdown.BookingFeeMinor})
	if breakdown.MinFareTopUpMinor > 0 {
		rows = append(rows, BreakdownRow{Label: "Minimum fare top-up", AmountMinor: breakdown.MinFareTopUpMinor})
	}

	now := s.now()
	quote := &Quote{
		ID:                uuid.New(),
		RequesterID:       requesterID,
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
		Stops:             stops,
		StopsDwellSec:     dwellSec,
		Breakdown:         rows,
		PricingVersion:    pricingVersionFor(config),
		PolicyVersion:     policy.PolicyVersion,
		ExpiresAt:         now.Add(config.QuoteTTL()).Truncate(1e9),
	}
	quote.RouteFingerprint = routeFingerprint(quote.Pickup, quote.Stops, quote.Dropoff)

	return quote, nil
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
	view := &QuoteEnvelopeView{
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
	// The route fields are present only for a multi-stop envelope, so a plain
	// pickup → dropoff quote answers byte-for-byte what it always did.
	if len(quote.Stops) > 0 {
		view.Stops = quote.Stops
		view.StopsDwellSec = quote.StopsDwellSec
		view.RouteFingerprint = quote.RouteFingerprint
	}
	return view
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
