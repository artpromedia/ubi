package cityconfig

import "fmt"

// MarketplacePreferredDriverPolicy mirrors MpPreferredDriverPolicySchema in
// packages/contracts/src/marketplace.ts: how long a named (preferred) driver
// has the request to themselves before it opens to the market — only with
// the rider's explicit fallback consent — or closes free (A04 item 3).
type MarketplacePreferredDriverPolicy struct {
	ExclusiveWindowSec int `json:"exclusiveWindowSec"`
}

// The pilot preferred-driver window: two minutes, long enough for a parked
// driver to see the invitation and offer, short enough that a rider who
// consented to fallback still reaches the open market quickly. It applies
// only when a market's policy carries no `preferredDriver` block — a
// configurable product choice, not a hidden constant — and the capability
// itself stays behind the deny-by-default marketplace_preferred_drivers flag,
// so this number never opens anything on its own.
const (
	PilotPreferredExclusiveWindowSec = 120

	// The structural bounds on a configured window: below 30 s nobody can
	// respond; above 15 min the rider waits on one person for too long.
	minPreferredExclusiveWindowSec = 30
	maxPreferredExclusiveWindowSec = 900
)

// PreferredDriverPolicy answers the market's preferred-driver window: the
// configured block, or the pilot default — in both cases strictly shorter
// than the market's request lifetime, so the window can never outlive the
// request it governs (a pilot default longer than a short-lived market's
// requests is cut to half their lifetime).
func (p *MarketplacePolicy) PreferredDriverPolicy() MarketplacePreferredDriverPolicy {
	if p != nil && p.PreferredDriver != nil {
		return *p.PreferredDriver
	}
	window := PilotPreferredExclusiveWindowSec
	if p != nil && p.Bids.RequestExpirySec > 0 && window >= p.Bids.RequestExpirySec {
		window = p.Bids.RequestExpirySec / 2
	}
	return MarketplacePreferredDriverPolicy{ExclusiveWindowSec: window}
}

func (p *MarketplacePreferredDriverPolicy) validate(cityID string, requestExpirySec int) error {
	switch {
	case p.ExclusiveWindowSec < minPreferredExclusiveWindowSec || p.ExclusiveWindowSec > maxPreferredExclusiveWindowSec:
		return fmt.Errorf("%w: city %s preferred-driver window must be %d–%d seconds",
			ErrUnavailable, cityID, minPreferredExclusiveWindowSec, maxPreferredExclusiveWindowSec)
	case requestExpirySec > 0 && p.ExclusiveWindowSec >= requestExpirySec:
		return fmt.Errorf("%w: city %s preferred-driver window must be shorter than the request lifetime",
			ErrUnavailable, cityID)
	}
	return nil
}
