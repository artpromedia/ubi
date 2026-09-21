// Package custody is the Go port of contracts/state-machines.json's `shipment`
// machine, plus the custody/return business rules delivery-service enforces
// on top of it (G08, C07).
//
// The transition table below is copied from the contract verbatim (including
// the legacy claim/exception branches this service does not yet exercise);
// nothing in this service may move a delivery's custody between states any
// other way. machine_test.go proves this file has not drifted from the
// contract.
package custody

import (
	"errors"
	"fmt"
	"sort"
)

// Name identifies the machine this package ports (contracts/state-machines.json
// has exactly one machine relevant here: `shipment`).
type Name string

// Shipment is the only machine this package ports.
const Shipment Name = "shipment"

// ErrIllegalTransition is returned for any move the contract does not allow.
var ErrIllegalTransition = errors.New("illegal transition")

// ErrUnknownState is returned when a state is not part of the machine at all.
var ErrUnknownState = errors.New("unknown state")

// Shipment machine states (contracts/state-machines.json -> shipment).
//
// `Created` and `CourierAssigned` play the role of "awaiting pickup" for a
// marketplace-managed delivery: the marketplace award hand-off
// (handlers.MarketplaceAssign) already knows the driver, so a custody row is
// seeded directly at CourierAssigned rather than modelling a separate
// "awaiting_pickup" state that would duplicate it. `ReturnToSender` likewise
// plays "returned_to_sender". See docs/marketplace/DELIVERY_CUSTODY.md.
const (
	Created         = "created"
	CourierAssigned = "courier_assigned"
	PickedUp        = "picked_up"
	InTransit       = "in_transit"
	Delivered       = "delivered"
	Cancelled       = "cancelled"

	// Legacy claim/exception branches (pre-existing shipment contract). This
	// service does not post to these; they are ported for contract parity.
	Exception      = "exception"
	RetryScheduled = "retry_scheduled"
	NeighbourDeliv = "neighbour_delivery"
	HubHold        = "hub_hold"
	HubPickup      = "hub_pickup"
	ReturnToSender = "return_to_sender"
	ClaimOpened    = "claim_opened"
	ClaimApproved  = "claim_approved"
	ClaimPartial   = "claim_partial"
	ClaimDeclined  = "claim_declined"
	Appealed       = "appealed"
	Closed         = "closed"

	// Custody/return exception arc (C07/G08 additive extension).
	DeliveryAttempted    = "delivery_attempted"
	RecipientUnreachable = "recipient_unreachable"
	ReturnProposed       = "return_proposed"
	ReturnConsented      = "return_consented"
	Returning            = "returning"
	HeldAtPoint          = "held_at_point"
	Collected            = "collected"
	DeliveryRetry        = "delivery_retry"
)

// transitions is contracts/state-machines.json's `shipment` machine,
// transcribed. Order inside a slice is irrelevant; membership is what is
// enforced. Keep this in lockstep with the JSON file — machine_test.go fails
// the build the moment the two disagree.
var transitions = map[string][]string{
	Created:         {CourierAssigned, Cancelled},
	CourierAssigned: {PickedUp, Cancelled},
	PickedUp:        {InTransit},
	InTransit:       {Delivered, Exception, DeliveryAttempted},
	Exception:       {RetryScheduled, NeighbourDeliv, ReturnToSender, HubHold},
	HubHold:         {RetryScheduled, HubPickup, ReturnToSender},
	RetryScheduled:  {InTransit},
	Delivered:       {ClaimOpened, Closed},
	ClaimOpened:     {ClaimApproved, ClaimPartial, ClaimDeclined},
	ClaimApproved:   {Closed},
	ClaimPartial:    {Closed},
	ClaimDeclined:   {Appealed, Closed},
	Appealed:        {Closed},

	DeliveryAttempted:    {Delivered, RecipientUnreachable},
	RecipientUnreachable: {ReturnProposed, HeldAtPoint, DeliveryRetry},
	ReturnProposed:       {ReturnConsented, HeldAtPoint},
	ReturnConsented:      {Returning},
	Returning:            {ReturnToSender},
	HeldAtPoint:          {Collected},
	DeliveryRetry:        {Delivered},

	// Terminal states the contract lists only as destinations.
	Cancelled:      {},
	NeighbourDeliv: {},
	ReturnToSender: {},
	HubPickup:      {},
	Closed:         {},
	Collected:      {},
}

// Initial returns the machine's initial state.
func Initial() string { return Created }

// Allowed returns the states reachable from `from`, sorted, for error details.
func Allowed(from string) ([]string, error) {
	next, ok := transitions[from]
	if !ok {
		return nil, fmt.Errorf("%w: shipment has no state %q", ErrUnknownState, from)
	}
	out := make([]string, len(next))
	copy(out, next)
	sort.Strings(out)
	return out, nil
}

// Can reports whether the contract allows from -> to.
func Can(from, to string) bool { return Assert(from, to) == nil }

// Assert refuses any transition the contract does not contain.
func Assert(from, to string) error {
	next, ok := transitions[from]
	if !ok {
		return fmt.Errorf("%w: shipment has no state %q", ErrUnknownState, from)
	}
	if _, ok := transitions[to]; !ok {
		return fmt.Errorf("%w: shipment has no state %q", ErrUnknownState, to)
	}
	for _, candidate := range next {
		if candidate == to {
			return nil
		}
	}
	return fmt.Errorf("%w: shipment cannot move %s -> %s", ErrIllegalTransition, from, to)
}

// IsTerminal reports whether no transition leaves this state.
func IsTerminal(state string) (bool, error) {
	next, err := Allowed(state)
	if err != nil {
		return false, err
	}
	return len(next) == 0, nil
}

// States returns every state of the machine, sorted. Used by tests to prove
// the port matches the contract file rather than a remembered subset of it.
func States() []string {
	out := make([]string, 0, len(transitions))
	for state := range transitions {
		out = append(out, state)
	}
	sort.Strings(out)
	return out
}

// CustodyTerminalStates are the states in which a delivery's custody is done
// moving: no further custody/return action can change it. Money-adjacent
// gates (e.g. refusing a second charge attempt) key off this list.
func CustodyTerminalStates() []string {
	return []string{Delivered, ReturnToSender, Collected, Cancelled}
}

// IsCustodyTerminal reports whether the given state is one of the four
// custody-terminal outcomes this service recognises (delivered,
// returned-to-sender, collected-at-point, cancelled).
func IsCustodyTerminal(state string) bool {
	for _, s := range CustodyTerminalStates() {
		if s == state {
			return true
		}
	}
	return false
}
