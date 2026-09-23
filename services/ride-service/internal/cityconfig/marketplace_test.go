package cityconfig

import (
	"encoding/json"
	"errors"
	"testing"
)

// minimalPolicy is the smallest marketplace policy Validate accepts.
func minimalPolicy() *MarketplacePolicy {
	return &MarketplacePolicy{
		PolicyVersion:      1,
		CommissionBps:      1000,
		CommissionRounding: "half_up",
		FareBounds: map[string]MarketplaceFareBounds{
			"ride:go": {AbsoluteFloorMinor: 1, CeilingBpsOfSuggested: 10_000},
		},
		SearchEnvelope: SearchEnvelopePolicy{
			InitialRadiusMeters: 1, MaxRadiusMeters: 1, InitialPickupEtaSec: 1, MaxPickupEtaSec: 1,
			ExpandAfterSec: 1, ExpansionSteps: 1,
		},
		Stationary:    StationaryPolicy{MinDwellSec: 1, MaxLocationAgeSec: 1, MaxAccuracyMeters: 1, MotionCloseSec: 1},
		FinishingTrip: FinishingTripPolicy{MaxRemainingSec: 1},
		Bids:          MarketplaceBidPolicy{BidExpirySec: 1, RequestExpirySec: 1, MaxLiveBidsPerDriver: 1, MaxOpenRequestsPerRequester: 1},
	}
}

// TestStopsPolicyPilotDefaults: a market without a stops block gets the
// pilot limits; a market with one gets exactly its own numbers.
func TestStopsPolicyPilotDefaults(t *testing.T) {
	policy := minimalPolicy()
	if err := policy.Validate("c"); err != nil {
		t.Fatal(err)
	}
	got := policy.StopsPolicy()
	if got.MaxIntermediateStops != 3 || got.DefaultDwellSec != PilotDefaultStopDwellSec || got.MaxDwellSec != PilotMaxStopDwellSec {
		t.Fatalf("pilot defaults: %+v", got)
	}

	var decoded MarketplacePolicy
	raw := `{"stops": {"maxIntermediateStops": 1, "defaultDwellSec": 30, "maxDwellSec": 90}}`
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatal(err)
	}
	if own := decoded.StopsPolicy(); own.MaxIntermediateStops != 1 || own.DefaultDwellSec != 30 || own.MaxDwellSec != 90 {
		t.Fatalf("a market's own block must win: %+v", own)
	}
}

// TestStopsPolicyValidation: a present-and-broken stops block refuses the
// whole policy, like every other marketplace block.
func TestStopsPolicyValidation(t *testing.T) {
	for name, stops := range map[string]MarketplaceStopsPolicy{
		"negative limit":          {MaxIntermediateStops: -1, MaxDwellSec: 60},
		"over the structural cap": {MaxIntermediateStops: maxIntermediateStopsCeiling + 1, MaxDwellSec: 60},
		"negative dwell ceiling":  {MaxIntermediateStops: 2, MaxDwellSec: -1},
		"default above ceiling":   {MaxIntermediateStops: 2, DefaultDwellSec: 61, MaxDwellSec: 60},
		"negative default dwell":  {MaxIntermediateStops: 2, DefaultDwellSec: -1, MaxDwellSec: 60},
	} {
		policy := minimalPolicy()
		block := stops
		policy.Stops = &block
		if err := policy.Validate("c"); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("%s: want ErrUnavailable, got %v", name, err)
		}
	}
	policy := minimalPolicy()
	policy.Stops = &MarketplaceStopsPolicy{MaxIntermediateStops: 0, DefaultDwellSec: 0, MaxDwellSec: 0}
	if err := policy.Validate("c"); err != nil {
		t.Fatalf("a market may switch stops off structurally: %v", err)
	}
}
