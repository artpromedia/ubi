package cityconfig

import (
	"errors"
	"testing"
)

// TestPreferredDriverPolicy: without a block a market gets the pilot window,
// cut to half the request lifetime where requests live shorter; a configured
// window must be 30–900 s and strictly shorter than the request lifetime.
func TestPreferredDriverPolicy(t *testing.T) {
	policy := minimalPolicy()
	policy.Bids.RequestExpirySec = 600
	if got := policy.PreferredDriverPolicy().ExclusiveWindowSec; got != PilotPreferredExclusiveWindowSec {
		t.Fatalf("pilot window: got %d", got)
	}
	policy.Bids.RequestExpirySec = 100
	if got := policy.PreferredDriverPolicy().ExclusiveWindowSec; got != 50 {
		t.Fatalf("the window never outlives a short-lived request: got %d", got)
	}

	policy.Bids.RequestExpirySec = 600
	policy.PreferredDriver = &MarketplacePreferredDriverPolicy{ExclusiveWindowSec: 90}
	if err := policy.Validate("c"); err != nil || policy.PreferredDriverPolicy().ExclusiveWindowSec != 90 {
		t.Fatalf("a configured window is used as is: %v", err)
	}
	for _, window := range []int{0, 29, 901, 600} {
		policy.PreferredDriver = &MarketplacePreferredDriverPolicy{ExclusiveWindowSec: window}
		if err := policy.Validate("c"); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("window %d must be refused: %v", window, err)
		}
	}
}
