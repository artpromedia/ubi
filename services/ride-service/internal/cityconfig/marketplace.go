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

// MarketplaceStopsPolicy bounds ordered intermediate stops on a marketplace
// ride (A02): how many a request may carry and the expected dwell each may
// declare (priced as route time). It mirrors MpMultiStopPolicySchema in
// packages/contracts/src/marketplace.ts.
type MarketplaceStopsPolicy struct {
	MaxIntermediateStops int `json:"maxIntermediateStops"`
	DefaultDwellSec      int `json:"defaultDwellSec"`
	MaxDwellSec          int `json:"maxDwellSec"`
	// PaidWaiting prices waiting at a stop beyond its included allowance
	// (the expected dwell the fare already priced). Absent: waiting beyond the
	// allowance is never charged — the cap is zero, so any paid waiting needs
	// the rider's explicit approval first.
	PaidWaiting *StopPaidWaitingPolicy `json:"paidWaiting,omitempty"`
	// AmendmentApprovalSec is how long a post-award amendment waits for both
	// parties' approvals before it expires and releases everything it
	// reserved. Zero means the pilot default below.
	AmendmentApprovalSec int `json:"amendmentApprovalSec,omitempty"`
}

// StopPaidWaitingPolicy mirrors MpStopPaidWaitingPolicySchema: the per-minute
// rate for waiting past a stop's included allowance, the maximum waiting cost
// a rider authorizes up front per trip (each explicit rider approval extends
// the cap by one more such increment), and the total wait at one stop after
// which it counts as excessive and the driver may leave it.
type StopPaidWaitingPolicy struct {
	PerMinMinor        int64 `json:"perMinMinor"`
	MaxAuthorizedMinor int64 `json:"maxAuthorizedMinor"`
	ExcessiveAfterSec  int   `json:"excessiveAfterSec"`
}

// The pilot multi-stop limits (addendum A02): up to three intermediate stops,
// a two-minute expected dwell when the requester names none, ten minutes at
// most per stop. They apply only when a market's policy carries no `stops`
// block — a configurable product choice, not a hidden constant — and the
// capability itself stays behind the deny-by-default marketplace_multi_stop
// flag, so these numbers never open anything on their own.
const (
	PilotMaxIntermediateStops = 3
	PilotDefaultStopDwellSec  = 120
	PilotMaxStopDwellSec      = 600
	// PilotAmendmentApprovalSec is the approval window an unapproved
	// post-award amendment gets when the market configures none: long enough
	// for a parked driver to review, short enough that reserved money never
	// lingers. The capability stays behind marketplace_trip_amendments.
	PilotAmendmentApprovalSec = 180

	// maxIntermediateStopsCeiling is structural, not policy: every stop is a
	// routed leg at quote time, so no market may configure an unbounded list.
	maxIntermediateStopsCeiling = 10
)

// StopsPolicy answers the market's multi-stop limits: the configured block,
// or the pilot defaults when the market has none.
func (p *MarketplacePolicy) StopsPolicy() MarketplaceStopsPolicy {
	if p == nil || p.Stops == nil {
		return MarketplaceStopsPolicy{
			MaxIntermediateStops: PilotMaxIntermediateStops,
			DefaultDwellSec:      PilotDefaultStopDwellSec,
			MaxDwellSec:          PilotMaxStopDwellSec,
		}
	}
	return *p.Stops
}

// ApprovalWindowSec answers the amendment approval window: the configured
// one, or the pilot default.
func (s MarketplaceStopsPolicy) ApprovalWindowSec() int {
	if s.AmendmentApprovalSec > 0 {
		return s.AmendmentApprovalSec
	}
	return PilotAmendmentApprovalSec
}

// validate refuses a stops block the engine could not honour.
func (s *MarketplaceStopsPolicy) validate(cityID string) error {
	if s.PaidWaiting != nil {
		waiting := s.PaidWaiting
		switch {
		case waiting.PerMinMinor < 0 || waiting.MaxAuthorizedMinor < 0:
			return fmt.Errorf("%w: city %s marketplace paid stop waiting carries a negative amount", ErrUnavailable, cityID)
		case waiting.ExcessiveAfterSec <= 0:
			return fmt.Errorf("%w: city %s marketplace paid stop waiting has no excessive-waiting threshold", ErrUnavailable, cityID)
		}
	}
	switch {
	case s.AmendmentApprovalSec < 0:
		return fmt.Errorf("%w: city %s marketplace amendment approval window is negative", ErrUnavailable, cityID)
	case s.MaxIntermediateStops < 0 || s.MaxIntermediateStops > maxIntermediateStopsCeiling:
		return fmt.Errorf("%w: city %s marketplace stop limit must be between 0 and %d",
			ErrUnavailable, cityID, maxIntermediateStopsCeiling)
	case s.MaxDwellSec < 0:
		return fmt.Errorf("%w: city %s marketplace stop dwell ceiling is negative", ErrUnavailable, cityID)
	case s.DefaultDwellSec < 0 || s.DefaultDwellSec > s.MaxDwellSec:
		return fmt.Errorf("%w: city %s marketplace default stop dwell is outside its ceiling", ErrUnavailable, cityID)
	}
	return nil
}

// MarketplacePolicy mirrors MarketplacePolicySchema in
// packages/contracts/src/city-config.ts. Every number the marketplace engine
// needs lives here, versioned per city; there is no code default for any of
// it — except the optional `stops` block, whose pilot defaults are documented
// above and only matter once the multi-stop flag is on.
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
	// Stops is the optional per-market multi-stop block; absent means the
	// pilot defaults (see StopsPolicy).
	Stops *MarketplaceStopsPolicy `json:"stops,omitempty"`
	// Scheduling is the optional Book for Later block (A03). Unlike stops
	// it has NO defaults: absent (or a product's sub-block absent) means that
	// product fails closed with market_not_configured (see scheduling.go).
	Scheduling *MarketplaceSchedulingPolicy `json:"scheduling,omitempty"`
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
	if p.Stops != nil {
		if err := p.Stops.validate(cityID); err != nil {
			return err
		}
	}
	if p.Scheduling != nil {
		if err := p.Scheduling.validate(cityID); err != nil {
			return err
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
