package cityconfig

import (
	"fmt"
)

// MarketplaceSchedulingPolicy mirrors MpSchedulingPolicySchema in
// packages/contracts/src/marketplace.ts: the market's Book for Later policy
// (A03). It is optional inside the marketplace policy and each product's
// block is optional inside it — an absent block is a product this market has
// not configured, and every call into it fails closed with
// market_not_configured. There are no code defaults for any of these numbers.
type MarketplaceSchedulingPolicy struct {
	ScheduledRequests   *ScheduledRequestPolicy   `json:"scheduledRequests,omitempty"`
	AdvanceReservations *AdvanceReservationPolicy `json:"advanceReservations,omitempty"`
	Recurring           *RecurringPolicy          `json:"recurring,omitempty"`
}

// ScheduledRequestPolicy mirrors MpScheduledRequestPolicySchema: a stored
// intent is published as an ordinary marketplace request PublishLeadSec
// before its pickup; it may be made no later than MinLeadSec before the
// pickup and no further ahead than MaxHorizonSec.
type ScheduledRequestPolicy struct {
	PublishLeadSec         int   `json:"publishLeadSec"`
	MinLeadSec             int   `json:"minLeadSec"`
	MaxHorizonSec          int   `json:"maxHorizonSec"`
	DefaultWindowSec       int   `json:"defaultWindowSec"`
	MinWindowSec           int   `json:"minWindowSec"`
	MaxWindowSec           int   `json:"maxWindowSec"`
	ReminderOffsetsSec     []int `json:"reminderOffsetsSec"`
	MaxPendingPerRequester int   `json:"maxPendingPerRequester"`
}

// AdvanceReservationPolicy mirrors MpAdvanceReservationPolicySchema. Every
// offset is measured back from the pickup window's start:
//
//	bookingHorizon > minLead > reconfirmOpens > reconfirmDeadline ≥ activationLead
//	fundingHorizon ≥ fundingDeadline ≥ reconfirmOpens
//
// so rider funding is settled (secured or the booking failed) before the
// driver is asked to reconfirm, and reconfirmation closes before activation.
type AdvanceReservationPolicy struct {
	BookingHorizonSec    int   `json:"bookingHorizonSec"`
	MinLeadSec           int   `json:"minLeadSec"`
	OfferWindowSec       int   `json:"offerWindowSec"`
	BidExpirySec         int   `json:"bidExpirySec"`
	DefaultWindowSec     int   `json:"defaultWindowSec"`
	MinWindowSec         int   `json:"minWindowSec"`
	MaxWindowSec         int   `json:"maxWindowSec"`
	FundingHorizonSec    int   `json:"fundingHorizonSec"`
	FundingDeadlineSec   int   `json:"fundingDeadlineSec"`
	ReconfirmOpensSec    int   `json:"reconfirmOpensSec"`
	ReconfirmDeadlineSec int   `json:"reconfirmDeadlineSec"`
	ActivationLeadSec    int   `json:"activationLeadSec"`
	PreBufferSec         int   `json:"preBufferSec"`
	PostBufferSec        int   `json:"postBufferSec"`
	ReminderOffsetsSec   []int `json:"reminderOffsetsSec"`
	MaxOpenPerRequester  int   `json:"maxOpenPerRequester"`
	// RiskResolutionLeadSec (A05 fleet calendar, optional; decisions Q4) is
	// how long before the PICKUP a booking put at risk must be resolved: its
	// decision deadline is the EARLIER of its reconfirmation deadline (while
	// it awaits reconfirmation) and the pickup minus this lead — never later
	// than activation. At most MinLeadSec: a lead equal to it still leaves a
	// same-fare rematch possible at the deadline. Absent applies the decided
	// default, DefaultRiskResolutionLeadSec, capped at MinLeadSec.
	RiskResolutionLeadSec *int `json:"riskResolutionLeadSec,omitempty"`
}

// DefaultRiskResolutionLeadSec is the decided risk resolution lead
// (docs/design/FLEET_CALENDAR_DECISIONS.md Q4: pickup − 2 h; the contract's
// MP_DEFAULT_RISK_RESOLUTION_LEAD_SEC) for a market that configures none. It
// is a product decision recorded in the contract, not a guessed number.
const DefaultRiskResolutionLeadSec = 7_200

// RiskResolutionLead is the market's risk resolution lead in seconds: the
// configured one, else the decided default capped at the market's minimum
// advance lead (the bound a configured lead is validated against).
func (p *AdvanceReservationPolicy) RiskResolutionLead() int {
	if p == nil {
		return DefaultRiskResolutionLeadSec
	}
	if p.RiskResolutionLeadSec != nil {
		return *p.RiskResolutionLeadSec
	}
	if p.MinLeadSec > 0 && p.MinLeadSec < DefaultRiskResolutionLeadSec {
		return p.MinLeadSec
	}
	return DefaultRiskResolutionLeadSec
}

// RecurringPolicy mirrors MpRecurringPolicySchema.
type RecurringPolicy struct {
	GenerationHorizonDays          int `json:"generationHorizonDays"`
	MaxActiveTemplatesPerRequester int `json:"maxActiveTemplatesPerRequester"`
	MaxSeriesDays                  int `json:"maxSeriesDays"`
}

// maxReminderOffsets bounds the reminder list. Structural, not policy.
const maxReminderOffsets = 4

func validWindow(minSec, defaultSec, maxSec int) bool {
	return minSec > 0 && minSec <= defaultSec && defaultSec <= maxSec
}

func validReminders(offsets []int) bool {
	if len(offsets) > maxReminderOffsets {
		return false
	}
	for _, offset := range offsets {
		if offset <= 0 {
			return false
		}
	}
	return true
}

// validate refuses a scheduling block the engine could not honour. A broken
// block makes the whole marketplace policy unreadable (config_unavailable),
// exactly like a broken stops block: numbers are never guessed around.
func (p *MarketplaceSchedulingPolicy) validate(cityID string) error {
	if scheduled := p.ScheduledRequests; scheduled != nil {
		switch {
		case scheduled.PublishLeadSec <= 0 || scheduled.MinLeadSec < scheduled.PublishLeadSec:
			return fmt.Errorf("%w: city %s scheduled requests must publish before their minimum lead", ErrUnavailable, cityID)
		case scheduled.MaxHorizonSec <= scheduled.MinLeadSec:
			return fmt.Errorf("%w: city %s scheduled request horizon is shorter than its minimum lead", ErrUnavailable, cityID)
		case !validWindow(scheduled.MinWindowSec, scheduled.DefaultWindowSec, scheduled.MaxWindowSec):
			return fmt.Errorf("%w: city %s scheduled request pickup window bounds are inconsistent", ErrUnavailable, cityID)
		case !validReminders(scheduled.ReminderOffsetsSec):
			return fmt.Errorf("%w: city %s scheduled request reminders are unusable", ErrUnavailable, cityID)
		case scheduled.MaxPendingPerRequester <= 0:
			return fmt.Errorf("%w: city %s scheduled requests have no per-requester cap", ErrUnavailable, cityID)
		}
	}
	if advance := p.AdvanceReservations; advance != nil {
		switch {
		case advance.ActivationLeadSec <= 0 ||
			advance.ReconfirmDeadlineSec < advance.ActivationLeadSec ||
			advance.ReconfirmOpensSec <= advance.ReconfirmDeadlineSec ||
			advance.MinLeadSec <= advance.ReconfirmOpensSec ||
			advance.BookingHorizonSec <= advance.MinLeadSec:
			return fmt.Errorf("%w: city %s advance reservation deadlines are out of order", ErrUnavailable, cityID)
		case advance.FundingDeadlineSec < advance.ReconfirmOpensSec || advance.FundingHorizonSec < advance.FundingDeadlineSec:
			return fmt.Errorf("%w: city %s advance reservation funding deadlines are out of order", ErrUnavailable, cityID)
		case advance.OfferWindowSec <= 0 || advance.BidExpirySec <= 0:
			return fmt.Errorf("%w: city %s advance reservations have no offer window", ErrUnavailable, cityID)
		case !validWindow(advance.MinWindowSec, advance.DefaultWindowSec, advance.MaxWindowSec):
			return fmt.Errorf("%w: city %s advance reservation pickup window bounds are inconsistent", ErrUnavailable, cityID)
		case advance.PreBufferSec < 0 || advance.PostBufferSec < 0:
			return fmt.Errorf("%w: city %s advance reservation buffers are negative", ErrUnavailable, cityID)
		case !validReminders(advance.ReminderOffsetsSec):
			return fmt.Errorf("%w: city %s advance reservation reminders are unusable", ErrUnavailable, cityID)
		case advance.MaxOpenPerRequester <= 0:
			return fmt.Errorf("%w: city %s advance reservations have no per-requester cap", ErrUnavailable, cityID)
		case advance.RiskResolutionLeadSec != nil &&
			(*advance.RiskResolutionLeadSec <= 0 || *advance.RiskResolutionLeadSec > advance.MinLeadSec):
			return fmt.Errorf("%w: city %s advance reservation risk resolution lead is unusable", ErrUnavailable, cityID)
		}
	}
	if recurring := p.Recurring; recurring != nil {
		switch {
		case recurring.GenerationHorizonDays < 1 || recurring.GenerationHorizonDays > 14:
			return fmt.Errorf("%w: city %s recurring generation horizon must be 1-14 days", ErrUnavailable, cityID)
		case recurring.MaxActiveTemplatesPerRequester <= 0 || recurring.MaxSeriesDays <= 0:
			return fmt.Errorf("%w: city %s recurring journeys have no caps", ErrUnavailable, cityID)
		}
	}
	return nil
}

// ScheduledRequestPolicyFor answers the market's scheduled-request policy,
// failing closed with ErrMarketNotConfigured when the block is absent.
func (p *MarketplacePolicy) ScheduledRequestPolicyFor(cityID string) (*ScheduledRequestPolicy, error) {
	if p == nil || p.Scheduling == nil || p.Scheduling.ScheduledRequests == nil {
		return nil, fmt.Errorf("%w: city %s has no scheduled request policy", ErrMarketNotConfigured, cityID)
	}
	return p.Scheduling.ScheduledRequests, nil
}

// AdvanceReservationPolicyFor answers the market's advance reservation
// policy, failing closed with ErrMarketNotConfigured when the block is absent.
func (p *MarketplacePolicy) AdvanceReservationPolicyFor(cityID string) (*AdvanceReservationPolicy, error) {
	if p == nil || p.Scheduling == nil || p.Scheduling.AdvanceReservations == nil {
		return nil, fmt.Errorf("%w: city %s has no advance reservation policy", ErrMarketNotConfigured, cityID)
	}
	return p.Scheduling.AdvanceReservations, nil
}

// RecurringPolicyFor answers the market's recurring-journey policy, failing
// closed with ErrMarketNotConfigured when the block is absent.
func (p *MarketplacePolicy) RecurringPolicyFor(cityID string) (*RecurringPolicy, error) {
	if p == nil || p.Scheduling == nil || p.Scheduling.Recurring == nil {
		return nil, fmt.Errorf("%w: city %s has no recurring journey policy", ErrMarketNotConfigured, cityID)
	}
	return p.Scheduling.Recurring, nil
}
