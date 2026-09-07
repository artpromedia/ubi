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
			RiderDriverAssigned:      {RiderDriverArrived, RiderRematching, RiderCancelledByRider, RiderSafetyHold},
			RiderRematching:          {RiderDriverAssigned, RiderNoDriver, RiderCancelledByRider},
			RiderDriverArrived:       {RiderPinVerification, RiderRematching, RiderCancelledByRider, RiderNoShow},
			RiderPinVerification:     {RiderInProgress, RiderDriverArrived},
			RiderInProgress:          {RiderCompleted, RiderSafetyHold},
			RiderSafetyHold:          {RiderInProgress, RiderCompleted, RiderCancelledByOps},
			RiderCompleted:           {RiderPaymentPending, RiderRated},
			RiderPaymentPending:      {RiderCompleted, RiderPaymentFailed},
			RiderPaymentFailed:       {RiderPaymentPending, RiderCompleted},
			RiderRated:               {},
			// Terminal states the contract lists only as destinations.
			RiderNoShow:           {},
			RiderCancelledByRider: {},
			RiderCancelledByOps:   {},
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
