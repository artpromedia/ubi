package cityconfig

import (
	"errors"
	"testing"
)

// validAdvance is a complete advance reservation block (the harness's
// SchedulingPolicyFixture numbers): minimum lead 3 h, reconfirmation 2 h to
// 45 min before, activation 30 min before.
func validAdvance() *AdvanceReservationPolicy {
	return &AdvanceReservationPolicy{
		BookingHorizonSec: 604_800, MinLeadSec: 10_800, OfferWindowSec: 3_600, BidExpirySec: 3_600,
		DefaultWindowSec: 600, MinWindowSec: 300, MaxWindowSec: 1_800,
		FundingHorizonSec: 172_800, FundingDeadlineSec: 7_200,
		ReconfirmOpensSec: 7_200, ReconfirmDeadlineSec: 2_700, ActivationLeadSec: 1_800,
		PreBufferSec: 600, PostBufferSec: 600, ReminderOffsetsSec: []int{43_200, 3_600}, MaxOpenPerRequester: 5,
	}
}

func withAdvance(advance *AdvanceReservationPolicy) *MarketplacePolicy {
	policy := minimalPolicy()
	policy.Scheduling = &MarketplaceSchedulingPolicy{AdvanceReservations: advance}
	return policy
}

// TestRiskResolutionLeadDefaultsAndBounds (decisions Q4): a market that
// configures no lead gets the decided 2 h, capped at its minimum advance
// lead; a configured lead wins; a configured lead must be positive and at
// most the minimum lead (equal still leaves a same-fare rematch possible at
// the deadline) — anything else makes the policy unreadable, never guessed
// around.
func TestRiskResolutionLeadDefaultsAndBounds(t *testing.T) {
	if DefaultRiskResolutionLeadSec != 7_200 {
		t.Fatalf("the decided default is pickup − 2 h: %d", DefaultRiskResolutionLeadSec)
	}
	absent := validAdvance()
	if err := withAdvance(absent).Validate("c"); err != nil {
		t.Fatal(err)
	}
	if got := absent.RiskResolutionLead(); got != 7_200 {
		t.Fatalf("absent ⇒ the 2 h default: %d", got)
	}
	short := validAdvance()
	short.MinLeadSec, short.ReconfirmOpensSec, short.ReconfirmDeadlineSec = 5_400, 3_600, 2_700
	short.FundingDeadlineSec = 3_600
	if err := withAdvance(short).Validate("c"); err != nil {
		t.Fatal(err)
	}
	if got := short.RiskResolutionLead(); got != 5_400 {
		t.Fatalf("the default never exceeds the market's minimum lead: %d", got)
	}
	var none *AdvanceReservationPolicy
	if got := none.RiskResolutionLead(); got != DefaultRiskResolutionLeadSec {
		t.Fatalf("no block ⇒ the default: %d", got)
	}

	for lead, ok := range map[int]bool{1_800: true, 7_200: true, 10_800: true, 10_801: false, 0: false, -1: false} {
		configured := validAdvance()
		value := lead
		configured.RiskResolutionLeadSec = &value
		err := withAdvance(configured).Validate("c")
		switch {
		case ok && err != nil:
			t.Errorf("lead %d is usable: %v", lead, err)
		case ok && configured.RiskResolutionLead() != lead:
			t.Errorf("a configured lead wins: %d vs %d", configured.RiskResolutionLead(), lead)
		case !ok && !errors.Is(err, ErrUnavailable):
			t.Errorf("lead %d must make the policy unreadable, got %v", lead, err)
		}
	}
}
