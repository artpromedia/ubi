// Package machine is the Go port of contracts/state-machines.json.
//
// The transition tables below are copied from the contract verbatim; nothing
// in this service may move an aggregate between states any other way. A
// transition that is not in the contract is refused, and it is refused inside
// the same database transaction that would have written the new state and the
// outbox row, so an illegal move cannot be half-applied.
package machine

import (
	"errors"
	"fmt"
	"sort"
)

// Name identifies one machine in contracts/state-machines.json.
type Name string

const (
	// Rider is the rider machine: idle → … → rated.
	Rider Name = "rider"
	// Driver is the driver machine: offline → available → … → available.
	Driver Name = "driver"
	// MpRequest is the marketplace request machine: draft → open → … → execution.
	MpRequest Name = "mpRequest"
	// MpBid is the marketplace bid machine: submitted → … → won/lost.
	MpBid Name = "mpBid"
	// MpHold is the wallet commission-hold machine: active → … → reversed.
	MpHold Name = "mpHold"
	// MpAward is the award saga machine: pending → confirmed/failed.
	MpAward Name = "mpAward"
	// MpClaim is the driver capacity claim machine: award_pending → … → released.
	MpClaim Name = "mpClaim"
	// MpAmendment is the post-award trip amendment machine: proposed →
	// awaiting_approvals_and_funding → committed/rejected/expired (A02).
	MpAmendment Name = "mpAmendment"
	// MpScheduledRequest is the Book for Later stored intent (A03) — a
	// scheduled request, or one occurrence of a recurring template:
	// scheduled_unassigned → published (no driver secured in any state).
	MpScheduledRequest Name = "mpScheduledRequest"
	// MpAdvanceBooking is the advance driver reservation on the booking
	// calendar (A03): held → confirmed/payment_pending → reconfirmed →
	// activated.
	MpAdvanceBooking Name = "mpAdvanceBooking"
	// MpRecurringTemplate is the recurring journey template (A03):
	// active ⇄ paused → cancelled/ended.
	MpRecurringTemplate Name = "mpRecurringTemplate"
	// MpPreferredWindow is a preferred-driver request's bounded exclusive
	// window (A04 item 3): exclusive → market_open (the rider consented to
	// fallback) or closed (the request expired free).
	MpPreferredWindow Name = "mpPreferredWindow"
	// MpBusinessBooking is one award's organization-budget funding (A06 part
	// C): reserving → reserved | refused, reserved → committed | released.
	MpBusinessBooking Name = "mpBusinessBooking"
)

// ErrIllegalTransition is returned for any move the contract does not allow.
var ErrIllegalTransition = errors.New("illegal transition")

// ErrUnknownState is returned when a state is not part of the machine at all.
var ErrUnknownState = errors.New("unknown state")

// Rider machine states (contracts/state-machines.json → rider).
const (
	RiderIdle                = "idle"
	RiderDestinationSelected = "destination_selected"
	RiderQuoteReady          = "quote_ready"
	RiderQuoteExpired        = "quote_expired"
	RiderRequesting          = "requesting"
	RiderMatching            = "matching"
	RiderNoDriver            = "no_driver"
	RiderDriverAssigned      = "driver_assigned"
	RiderRematching          = "rematching"
	RiderDriverArrived       = "driver_arrived"
	RiderNoShow              = "no_show"
	RiderPinVerification     = "pin_verification"
	RiderInProgress          = "in_progress"
	RiderSafetyHold          = "safety_hold"
	RiderCompleted           = "completed"
	RiderPaymentPending      = "payment_pending"
	RiderPaymentFailed       = "payment_failed"
	RiderRated               = "rated"
	RiderCancelledByRider    = "cancelled_by_rider"
	RiderCancelledByDriver   = "cancelled_by_driver"
	RiderCancelledByOps      = "cancelled_by_ops"
)

// Driver machine states (contracts/state-machines.json → driver).
const (
	DriverOffline            = "offline"
	DriverAvailable          = "available"
	DriverOfferReceived      = "offer_received"
	DriverOfferExpired       = "offer_expired"
	DriverDeclined           = "declined"
	DriverAccepted           = "accepted"
	DriverNavigatingToPickup = "navigating_to_pickup"
	DriverArrived            = "arrived"
	DriverWaiting            = "waiting"
	DriverNoShow             = "no_show"
	DriverPinVerified        = "pin_verified"
	DriverInTrip             = "in_trip"
	DriverCollectingPayment  = "collecting_payment"
	DriverPaymentDisputed    = "payment_disputed"
	DriverCompleted          = "completed"
	DriverCancelled          = "cancelled"
	DriverSafetyHold         = "safety_hold"
)

// Marketplace request machine states (contracts/state-machines.json → mpRequest).
const (
	MpRequestDraft        = "draft"
	MpRequestOpen         = "open"
	MpRequestAwardPending = "award_pending"
	MpRequestAwarded      = "awarded"
	MpRequestExecution    = "execution"
	MpRequestCancelled    = "cancelled"
	MpRequestExpired      = "expired"
	MpRequestNoOffers     = "no_offers"
)

// Marketplace bid machine states (contracts/state-machines.json → mpBid).
const (
	MpBidSubmitted       = "submitted"
	MpBidRevised         = "revised"
	MpBidSelectedPending = "selected_pending"
	MpBidWithdrawn       = "withdrawn"
	MpBidExpired         = "expired"
	MpBidInvalidated     = "invalidated"
	MpBidLost            = "lost"
	MpBidWon             = "won"
)

// Marketplace hold machine states (contracts/state-machines.json → mpHold).
const (
	MpHoldActive         = "active"
	MpHoldCapturePending = "capture_pending"
	MpHoldCaptured       = "captured"
	MpHoldReleased       = "released"
	MpHoldReversed       = "reversed"
)

// Marketplace award machine states (contracts/state-machines.json → mpAward).
const (
	MpAwardPending     = "pending"
	MpAwardConfirmed   = "confirmed"
	MpAwardFailed      = "failed"
	MpAwardCancelled   = "cancelled"
	MpAwardCompensated = "compensated"
)

// Marketplace claim machine states (contracts/state-machines.json → mpClaim).
const (
	MpClaimAwardPending = "award_pending"
	MpClaimCurrent      = "current"
	MpClaimNext         = "next"
	MpClaimCompleted    = "completed"
	MpClaimReleased     = "released"
)

// Marketplace amendment machine states (contracts/state-machines.json →
// mpAmendment).
const (
	MpAmendmentProposed    = "proposed"
	MpAmendmentAwaiting    = "awaiting_approvals_and_funding"
	MpAmendmentCommitted   = "committed"
	MpAmendmentRejected    = "rejected"
	MpAmendmentExpired     = "expired"
	MpAmendmentFailed      = "failed"
	MpAmendmentCompensated = "compensated"
)

// Scheduled request / recurring occurrence states (contracts/state-machines.json
// → mpScheduledRequest). The names say what is true: none of them secures a
// driver.
const (
	MpScheduledUnassigned    = "scheduled_unassigned"
	MpScheduledNeedsApproval = "needs_rider_approval"
	MpScheduledPublished     = "published"
	MpScheduledCancelled     = "cancelled"
	MpScheduledSkipped       = "skipped"
	MpScheduledExpired       = "expired"
	MpScheduledUnfulfilled   = "unfulfilled"
)

// Advance booking states (contracts/state-machines.json → mpAdvanceBooking).
const (
	MpBookingHeld           = "held"
	MpBookingPaymentPending = "payment_pending"
	MpBookingConfirmed      = "confirmed"
	MpBookingReconfirmed    = "reconfirmed"
	MpBookingActivated      = "activated"
	MpBookingCompleted      = "completed"
	MpBookingFailed         = "failed"
	MpBookingCancelled      = "cancelled"
	MpBookingReleased       = "released"
)

// Recurring template states (contracts/state-machines.json → mpRecurringTemplate).
const (
	MpTemplateActive    = "active"
	MpTemplatePaused    = "paused"
	MpTemplateCancelled = "cancelled"
	MpTemplateEnded     = "ended"
)

// Preferred-driver window states (contracts/state-machines.json →
// mpPreferredWindow). Only an OPEN request is governed by its window.
const (
	MpPreferredExclusive  = "exclusive"
	MpPreferredMarketOpen = "market_open"
	MpPreferredClosed     = "closed"
)

// Business booking states (contracts/state-machines.json → mpBusinessBooking).
const (
	MpBusinessReserving = "reserving"
	MpBusinessReserved  = "reserved"
	MpBusinessRefused   = "refused"
	MpBusinessCommitted = "committed"
	MpBusinessReleased  = "released"
)

// machines is the contract, transcribed. Order inside a slice is irrelevant;
// membership is what is enforced.
var machines = map[Name]struct {
	initial     string
	transitions map[string][]string
}{
	Rider: {
		initial: RiderIdle,
		transitions: map[string][]string{
			RiderIdle:                {RiderDestinationSelected},
			RiderDestinationSelected: {RiderQuoteReady, RiderIdle},
			RiderQuoteReady:          {RiderRequesting, RiderQuoteExpired, RiderDestinationSelected},
			RiderQuoteExpired:        {RiderQuoteReady},
			RiderRequesting:          {RiderMatching},
			RiderMatching:            {RiderDriverAssigned, RiderNoDriver, RiderCancelledByRider},
			RiderNoDriver:            {RiderMatching, RiderCancelledByRider},
			RiderDriverAssigned:      {RiderDriverArrived, RiderRematching, RiderCancelledByRider, RiderCancelledByDriver, RiderSafetyHold},
			RiderRematching:          {RiderDriverAssigned, RiderNoDriver, RiderCancelledByRider, RiderCancelledByDriver},
			RiderDriverArrived:       {RiderPinVerification, RiderRematching, RiderCancelledByRider, RiderCancelledByDriver, RiderNoShow},
			RiderPinVerification:     {RiderInProgress, RiderDriverArrived},
			RiderInProgress:          {RiderCompleted, RiderSafetyHold},
			RiderSafetyHold:          {RiderInProgress, RiderCompleted, RiderCancelledByOps},
			RiderCompleted:           {RiderPaymentPending, RiderRated},
			RiderPaymentPending:      {RiderCompleted, RiderPaymentFailed},
			RiderPaymentFailed:       {RiderPaymentPending, RiderCompleted},
			RiderRated:               {},
			// Terminal states the contract lists only as destinations.
			RiderNoShow:            {},
			RiderCancelledByRider:  {},
			RiderCancelledByDriver: {},
			RiderCancelledByOps:    {},
		},
	},
	Driver: {
		initial: DriverOffline,
		transitions: map[string][]string{
			DriverOffline:            {DriverAvailable},
			DriverAvailable:          {DriverOfferReceived, DriverOffline},
			DriverOfferReceived:      {DriverAccepted, DriverOfferExpired, DriverDeclined},
			DriverOfferExpired:       {DriverAvailable},
			DriverDeclined:           {DriverAvailable},
			DriverAccepted:           {DriverNavigatingToPickup},
			DriverNavigatingToPickup: {DriverArrived, DriverCancelled, DriverSafetyHold},
			DriverArrived:            {DriverWaiting},
			DriverWaiting:            {DriverPinVerified, DriverNoShow, DriverCancelled},
			DriverPinVerified:        {DriverInTrip},
			DriverInTrip:             {DriverCollectingPayment, DriverSafetyHold},
			DriverCollectingPayment:  {DriverCompleted, DriverPaymentDisputed},
			DriverPaymentDisputed:    {DriverCompleted},
			DriverCompleted:          {DriverAvailable},
			DriverCancelled:          {DriverAvailable},
			DriverSafetyHold:         {DriverInTrip, DriverAvailable},
			// Terminal state the contract lists only as a destination.
			DriverNoShow: {},
		},
	},
	MpRequest: {
		initial: MpRequestDraft,
		transitions: map[string][]string{
			MpRequestDraft:        {MpRequestOpen, MpRequestCancelled},
			MpRequestOpen:         {MpRequestOpen, MpRequestAwardPending, MpRequestCancelled, MpRequestExpired, MpRequestNoOffers},
			MpRequestAwardPending: {MpRequestAwarded, MpRequestOpen, MpRequestCancelled},
			MpRequestAwarded:      {MpRequestExecution, MpRequestCancelled},
			MpRequestExecution:    {},
			// Terminal states the contract lists only as destinations.
			MpRequestCancelled: {},
			MpRequestExpired:   {},
			MpRequestNoOffers:  {},
		},
	},
	MpBid: {
		initial: MpBidSubmitted,
		transitions: map[string][]string{
			MpBidSubmitted:       {MpBidRevised, MpBidSelectedPending, MpBidWithdrawn, MpBidExpired, MpBidInvalidated, MpBidLost},
			MpBidRevised:         {MpBidRevised, MpBidSelectedPending, MpBidWithdrawn, MpBidExpired, MpBidInvalidated, MpBidLost},
			MpBidSelectedPending: {MpBidWon, MpBidSubmitted, MpBidRevised, MpBidLost, MpBidInvalidated},
			// Terminal states the contract lists only as destinations.
			MpBidWithdrawn:   {},
			MpBidExpired:     {},
			MpBidInvalidated: {},
			MpBidLost:        {},
			MpBidWon:         {},
		},
	},
	MpHold: {
		initial: MpHoldActive,
		transitions: map[string][]string{
			MpHoldActive:         {MpHoldActive, MpHoldCapturePending, MpHoldReleased},
			MpHoldCapturePending: {MpHoldCaptured, MpHoldActive},
			MpHoldCaptured:       {MpHoldReversed},
			// Terminal states the contract lists only as destinations.
			MpHoldReleased: {},
			MpHoldReversed: {},
		},
	},
	MpAward: {
		initial: MpAwardPending,
		transitions: map[string][]string{
			MpAwardPending:   {MpAwardConfirmed, MpAwardFailed},
			MpAwardConfirmed: {MpAwardCancelled},
			MpAwardFailed:    {MpAwardCompensated},
			// Terminal states the contract lists only as destinations.
			MpAwardCancelled:   {},
			MpAwardCompensated: {},
		},
	},
	MpClaim: {
		initial: MpClaimAwardPending,
		transitions: map[string][]string{
			MpClaimAwardPending: {MpClaimCurrent, MpClaimNext, MpClaimReleased},
			MpClaimCurrent:      {MpClaimCompleted, MpClaimReleased},
			MpClaimNext:         {MpClaimCurrent, MpClaimReleased},
			// Terminal states the contract lists only as destinations.
			MpClaimCompleted: {},
			MpClaimReleased:  {},
		},
	},
	MpAmendment: {
		initial: MpAmendmentProposed,
		transitions: map[string][]string{
			MpAmendmentProposed: {MpAmendmentAwaiting, MpAmendmentRejected, MpAmendmentExpired},
			MpAmendmentAwaiting: {MpAmendmentCommitted, MpAmendmentRejected, MpAmendmentExpired, MpAmendmentFailed},
			MpAmendmentFailed:   {MpAmendmentCompensated},
			// Terminal states the contract lists only as destinations.
			MpAmendmentCommitted:   {},
			MpAmendmentRejected:    {},
			MpAmendmentExpired:     {},
			MpAmendmentCompensated: {},
		},
	},
	MpScheduledRequest: {
		initial: MpScheduledUnassigned,
		transitions: map[string][]string{
			MpScheduledUnassigned: {MpScheduledPublished, MpScheduledNeedsApproval, MpScheduledCancelled,
				MpScheduledSkipped, MpScheduledExpired, MpScheduledUnfulfilled},
			MpScheduledNeedsApproval: {MpScheduledUnassigned, MpScheduledCancelled, MpScheduledSkipped, MpScheduledExpired},
			MpScheduledPublished:     {MpScheduledUnfulfilled},
			// Terminal states the contract lists only as destinations.
			MpScheduledCancelled:   {},
			MpScheduledSkipped:     {},
			MpScheduledExpired:     {},
			MpScheduledUnfulfilled: {},
		},
	},
	MpAdvanceBooking: {
		initial: MpBookingHeld,
		transitions: map[string][]string{
			MpBookingHeld:           {MpBookingConfirmed, MpBookingPaymentPending, MpBookingReleased},
			MpBookingPaymentPending: {MpBookingConfirmed, MpBookingFailed, MpBookingCancelled},
			MpBookingConfirmed:      {MpBookingReconfirmed, MpBookingFailed, MpBookingCancelled},
			MpBookingReconfirmed:    {MpBookingActivated, MpBookingFailed, MpBookingCancelled},
			MpBookingActivated:      {MpBookingCompleted, MpBookingFailed},
			// Terminal states the contract lists only as destinations.
			MpBookingCompleted: {},
			MpBookingFailed:    {},
			MpBookingCancelled: {},
			MpBookingReleased:  {},
		},
	},
	MpRecurringTemplate: {
		initial: MpTemplateActive,
		transitions: map[string][]string{
			MpTemplateActive: {MpTemplatePaused, MpTemplateCancelled, MpTemplateEnded},
			MpTemplatePaused: {MpTemplateActive, MpTemplateCancelled, MpTemplateEnded},
			// Terminal states the contract lists only as destinations.
			MpTemplateCancelled: {},
			MpTemplateEnded:     {},
		},
	},
	MpPreferredWindow: {
		initial: MpPreferredExclusive,
		transitions: map[string][]string{
			MpPreferredExclusive: {MpPreferredMarketOpen, MpPreferredClosed},
			// Terminal states the contract lists only as destinations.
			MpPreferredMarketOpen: {},
			MpPreferredClosed:     {},
		},
	},
	MpBusinessBooking: {
		initial: MpBusinessReserving,
		transitions: map[string][]string{
			MpBusinessReserving: {MpBusinessReserved, MpBusinessRefused},
			MpBusinessReserved:  {MpBusinessCommitted, MpBusinessReleased},
			// Terminal states the contract lists only as destinations.
			MpBusinessRefused:   {},
			MpBusinessCommitted: {},
			MpBusinessReleased:  {},
		},
	},
}

// MpBookingOccupyingStates are the advance-booking states whose calendar
// interval is committed. The exclusion constraints advance_bookings_no_overlap
// and advance_bookings_vehicle_no_overlap depend on this list being right.
func MpBookingOccupyingStates() []string {
	return []string{MpBookingHeld, MpBookingPaymentPending, MpBookingConfirmed, MpBookingReconfirmed, MpBookingActivated}
}

// IsMpBookingOccupying reports whether a booking in this state still holds
// its calendar interval.
func IsMpBookingOccupying(state string) bool {
	for _, s := range MpBookingOccupyingStates() {
		if s == state {
			return true
		}
	}
	return false
}

// MpBidLiveStates are the bid states in which a bid still competes for the
// request and still holds its commission reservation. The partial unique index
// bids_one_live_per_driver_request depends on this list being right.
func MpBidLiveStates() []string {
	return []string{MpBidSubmitted, MpBidRevised, MpBidSelectedPending}
}

// IsMpBidLive reports whether a bid in this state is still live.
func IsMpBidLive(state string) bool {
	for _, s := range MpBidLiveStates() {
		if s == state {
			return true
		}
	}
	return false
}

// Initial returns the machine's initial state.
func Initial(name Name) (string, error) {
	m, ok := machines[name]
	if !ok {
		return "", fmt.Errorf("%w: machine %q", ErrUnknownState, name)
	}
	return m.initial, nil
}

// Allowed returns the states reachable from `from`, sorted, for error details.
func Allowed(name Name, from string) ([]string, error) {
	m, ok := machines[name]
	if !ok {
		return nil, fmt.Errorf("%w: machine %q", ErrUnknownState, name)
	}
	next, ok := m.transitions[from]
	if !ok {
		return nil, fmt.Errorf("%w: %s has no state %q", ErrUnknownState, name, from)
	}
	out := make([]string, len(next))
	copy(out, next)
	sort.Strings(out)
	return out, nil
}

// Can reports whether the contract allows from → to.
func Can(name Name, from, to string) bool {
	return Assert(name, from, to) == nil
}

// Assert refuses any transition the contract does not contain.
func Assert(name Name, from, to string) error {
	m, ok := machines[name]
	if !ok {
		return fmt.Errorf("%w: machine %q", ErrUnknownState, name)
	}
	next, ok := m.transitions[from]
	if !ok {
		return fmt.Errorf("%w: %s has no state %q", ErrUnknownState, name, from)
	}
	if _, ok := m.transitions[to]; !ok {
		return fmt.Errorf("%w: %s has no state %q", ErrUnknownState, name, to)
	}
	for _, candidate := range next {
		if candidate == to {
			return nil
		}
	}
	return fmt.Errorf("%w: %s cannot move %s → %s", ErrIllegalTransition, name, from, to)
}

// IsTerminal reports whether no transition leaves this state.
func IsTerminal(name Name, state string) (bool, error) {
	next, err := Allowed(name, state)
	if err != nil {
		return false, err
	}
	return len(next) == 0, nil
}

// States returns every state of a machine, sorted. Used by tests to prove the
// port matches the contract file rather than a remembered subset of it.
func States(name Name) ([]string, error) {
	m, ok := machines[name]
	if !ok {
		return nil, fmt.Errorf("%w: machine %q", ErrUnknownState, name)
	}
	out := make([]string, 0, len(m.transitions))
	for state := range m.transitions {
		out = append(out, state)
	}
	sort.Strings(out)
	return out, nil
}

// RiderActiveStates are the rider states in which a ride still occupies the
// rider and (once assigned) the driver. Used for the "one live ride" indexes.
func RiderActiveStates() []string {
	return []string{
		RiderRequesting, RiderMatching, RiderNoDriver, RiderDriverAssigned,
		RiderRematching, RiderDriverArrived, RiderPinVerification,
		RiderInProgress, RiderSafetyHold,
	}
}

// IsRiderActive reports whether a ride in this state is still live.
func IsRiderActive(state string) bool {
	for _, s := range RiderActiveStates() {
		if s == state {
			return true
		}
	}
	return false
}
