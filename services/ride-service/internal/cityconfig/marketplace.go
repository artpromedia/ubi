package cityconfig

import (
	"errors"
	"fmt"
)

// ErrMarketNotConfigured means the city has no marketplace policy, or the
// policy has no bounds for the requested service:vehicleClass pair. Callers
// fail closed on it (market_not_configured, HTTP 503): a market nobody
// configured is a market that does not exist, never one with invented numbers.
var ErrMarketNotConfigured = errors.New("marketplace is not configured here")

// commissionBpsFixed is the one commission the contract allows: 10%, 1,000
// basis points, on the accepted negotiated service fare. It is a contract
// literal (MarketplacePolicySchema.commissionBps: z.literal(1_000)), not a
// tunable — a policy carrying any other number is refused as unreadable.
const commissionBpsFixed = 1000

// MarketplaceFareBounds mirrors MarketplaceFareBoundsSchema: the effective
// floor is max(absolute, cost-based, bps-of-suggested); the ceiling protects
// against mistakes and abuse.
type MarketplaceFareBounds struct {
	AbsoluteFloorMinor    int64 `json:"absoluteFloorMinor"`
	CostFloorMinor        int64 `json:"costFloorMinor"`
	FloorBpsOfSuggested   int64 `json:"floorBpsOfSuggested"`
	CeilingBpsOfSuggested int64 `json:"ceilingBpsOfSuggested"`
}

// SearchEnvelopePolicy mirrors SearchEnvelopePolicySchema.
type SearchEnvelopePolicy struct {
	InitialRadiusMeters   int `json:"initialRadiusMeters"`
	MaxRadiusMeters       int `json:"maxRadiusMeters"`
	InitialPickupEtaSec   int `json:"initialPickupEtaSec"`
	MaxPickupEtaSec       int `json:"maxPickupEtaSec"`
	ExpandAfterSec        int `json:"expandAfterSec"`
	MinOffersBeforeExpand int `json:"minOffersBeforeExpand"`
	ExpansionSteps        int `json:"expansionSteps"`
}

// StationaryPolicy mirrors StationaryPolicySchema.
type StationaryPolicy struct {
	MinDwellSec       int     `json:"minDwellSec"`
	MaxSpeedMps       float64 `json:"maxSpeedMps"`
	MaxLocationAgeSec int     `json:"maxLocationAgeSec"`
	MaxAccuracyMeters int     `json:"maxAccuracyMeters"`
	MotionCloseSec    int     `json:"motionCloseSec"`
}

// FinishingTripPolicy mirrors FinishingTripPolicySchema.
type FinishingTripPolicy struct {
	MaxRemainingSec            int `json:"maxRemainingSec"`
	CompletionBufferSec        int `json:"completionBufferSec"`
	UncertaintyBufferSec       int `json:"uncertaintyBufferSec"`
	CorridorMaxBearingDeltaDeg int `json:"corridorMaxBearingDeltaDeg"`
}

// MarketplaceBidPolicy mirrors MarketplaceBidPolicySchema.
type MarketplaceBidPolicy struct {
	BidExpirySec                int `json:"bidExpirySec"`
	RequestExpirySec            int `json:"requestExpirySec"`
	RevisionCooldownSec         int `json:"revisionCooldownSec"`
	MaxLiveBidsPerDriver        int `json:"maxLiveBidsPerDriver"`
	MaxOpenRequestsPerRequester int `json:"maxOpenRequestsPerRequester"`
}

// QueuePolicy mirrors QueuePolicySchema.
type QueuePolicy struct {
	PickupWindowToleranceSec int `json:"pickupWindowToleranceSec"`
}

// RateProfileBounds mirrors RateProfileBoundsSchema.
type RateProfileBounds struct {
	MaxPerKmMinor           int64 `json:"maxPerKmMinor"`
	MaxMinimumTripFareMinor int64 `json:"maxMinimumTripFareMinor"`
}

// MarketplacePolicy mirrors MarketplacePolicySchema in
// packages/contracts/src/city-config.ts. Every number the marketplace engine
// needs lives here, versioned per city; there is no code default for any of it.
type MarketplacePolicy struct {
	PolicyVersion      int                              `json:"policyVersion"`
	CommissionBps      int                              `json:"commissionBps"`
	CommissionRounding string                           `json:"commissionRounding"`
	FareBounds         map[string]MarketplaceFareBounds `json:"fareBounds"`
	SearchEnvelope     SearchEnvelopePolicy             `json:"searchEnvelope"`
	Stationary         StationaryPolicy                 `json:"stationary"`
	FinishingTrip      FinishingTripPolicy              `json:"finishingTrip"`
	Bids               MarketplaceBidPolicy             `json:"bids"`
	Queue              QueuePolicy                      `json:"queue"`
	RateProfileBounds  map[string]RateProfileBounds     `json:"rateProfileBounds"`
}

// Validate refuses a marketplace policy that would make the engine invent a
// number, and refuses any commission other than the contract's 1,000 bps.
func (p *MarketplacePolicy) Validate(cityID string) error {
	switch {
	case p.PolicyVersion <= 0:
		return fmt.Errorf("%w: city %s marketplace policy has no version", ErrUnavailable, cityID)
	case p.CommissionBps != commissionBpsFixed:
		return fmt.Errorf("%w: city %s marketplace policy carries a commission other than 1000 bps", ErrUnavailable, cityID)
	case p.CommissionRounding != "half_up":
		return fmt.Errorf("%w: city %s marketplace policy carries an unknown rounding rule", ErrUnavailable, cityID)
	case len(p.FareBounds) == 0:
		return fmt.Errorf("%w: city %s marketplace policy has no fare bounds", ErrUnavailable, cityID)
	case p.SearchEnvelope.InitialRadiusMeters <= 0 || p.SearchEnvelope.MaxRadiusMeters <= 0:
		return fmt.Errorf("%w: city %s marketplace policy has no search envelope", ErrUnavailable, cityID)
	case p.SearchEnvelope.InitialPickupEtaSec <= 0 || p.SearchEnvelope.MaxPickupEtaSec <= 0:
		return fmt.Errorf("%w: city %s marketplace policy has no pickup ETA budget", ErrUnavailable, cityID)
	case p.SearchEnvelope.ExpandAfterSec <= 0 || p.SearchEnvelope.ExpansionSteps <= 0:
		return fmt.Errorf("%w: city %s marketplace policy has no expansion schedule", ErrUnavailable, cityID)
	case p.Stationary.MinDwellSec <= 0 || p.Stationary.MaxLocationAgeSec <= 0 || p.Stationary.MaxAccuracyMeters <= 0 || p.Stationary.MotionCloseSec <= 0:
		return fmt.Errorf("%w: city %s marketplace policy has no stationary gate", ErrUnavailable, cityID)
	case p.FinishingTrip.MaxRemainingSec <= 0:
		return fmt.Errorf("%w: city %s marketplace policy has no finishing-trip window", ErrUnavailable, cityID)
	case p.Bids.BidExpirySec <= 0 || p.Bids.RequestExpirySec <= 0:
		return fmt.Errorf("%w: city %s marketplace policy has no bid or request expiry", ErrUnavailable, cityID)
	case p.Bids.MaxLiveBidsPerDriver <= 0 || p.Bids.MaxOpenRequestsPerRequester <= 0:
		return fmt.Errorf("%w: city %s marketplace policy has no bid or request caps", ErrUnavailable, cityID)
	}
	for pair, bounds := range p.FareBounds {
		if bounds.AbsoluteFloorMinor <= 0 || bounds.CeilingBpsOfSuggested < 10_000 {
			return fmt.Errorf("%w: city %s marketplace bounds for %q are unusable", ErrUnavailable, cityID, pair)
		}
	}
	return nil
}

// fareBoundsKey is the fareBounds/rateProfileBounds map key the contract uses.
func fareBoundsKey(service, vehicleClass string) string {
	return service + ":" + vehicleClass
}

// MarketplacePolicyFor returns the city's marketplace policy, failing closed
// with ErrMarketNotConfigured when the block is absent. This and
// MarketplaceBoundsFor are the only ways marketplace code reads the policy.
func (c *CityConfig) MarketplacePolicyFor() (*MarketplacePolicy, error) {
	if c.Marketplace == nil {
		return nil, fmt.Errorf("%w: city %s v%d has no marketplace policy", ErrMarketNotConfigured, c.CityID, c.Version)
	}
	if err := c.Marketplace.Validate(c.CityID); err != nil {
		return nil, err
	}
	return c.Marketplace, nil
}

// MarketplaceBoundsFor is the Go port of marketplaceBoundsFor in
// packages/contracts/src/city-config.ts: the ONLY way to read marketplace fare
// bounds, failing closed when the city or the service:vehicleClass pair is
// unconfigured.
func (c *CityConfig) MarketplaceBoundsFor(service, vehicleClass string) (MarketplaceFareBounds, error) {
	policy, err := c.MarketplacePolicyFor()
	if err != nil {
		return MarketplaceFareBounds{}, err
	}
	bounds, ok := policy.FareBounds[fareBoundsKey(service, vehicleClass)]
	if !ok {
		return MarketplaceFareBounds{}, fmt.Errorf(
			"%w: city %s v%d has no marketplace fare bounds for %q",
			ErrMarketNotConfigured, c.CityID, c.Version, fareBoundsKey(service, vehicleClass))
	}
	return bounds, nil
}

// MarketplaceRateBoundsFor reads the rate-profile bounds for a pair, failing
// closed the same way fare bounds do.
func (c *CityConfig) MarketplaceRateBoundsFor(service, vehicleClass string) (RateProfileBounds, error) {
	policy, err := c.MarketplacePolicyFor()
	if err != nil {
		return RateProfileBounds{}, err
	}
	bounds, ok := policy.RateProfileBounds[fareBoundsKey(service, vehicleClass)]
	if !ok {
		return RateProfileBounds{}, fmt.Errorf(
			"%w: city %s v%d has no rate profile bounds for %q",
			ErrMarketNotConfigured, c.CityID, c.Version, fareBoundsKey(service, vehicleClass))
	}
	return bounds, nil
}
