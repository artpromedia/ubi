package marketplace

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// eventNames is the Go port of the mp.* names in EVENT_NAMES
// (packages/contracts/src/events.ts). The set is closed: a producer cannot
// invent an event no consumer or ops timeline can render.
var eventNames = map[string]struct{}{
	"mp.request.published":   {},
	"mp.request.revised":     {},
	"mp.request.closed":      {},
	"mp.request.reopened":    {},
	"mp.bid.submitted":       {},
	"mp.bid.revised":         {},
	"mp.bid.withdrawn":       {},
	"mp.bid.expired":         {},
	"mp.bid.invalidated":     {},
	"mp.bid.lost":            {},
	"mp.bid.won":             {},
	"mp.award.pending":       {},
	"mp.award.confirmed":     {},
	"mp.award.failed":        {},
	"mp.award.cancelled":     {},
	"mp.commission.reserved": {},
	"mp.commission.adjusted": {},
	"mp.commission.released": {},
	"mp.commission.captured": {},
	"mp.commission.reversed": {},
	"mp.claim.created":       {},
	"mp.claim.promoted":      {},
	"mp.claim.released":      {},
	"mp.queue.eta_updated":   {},
	"mp.queue.window_missed": {},
	"mp.rate_profile.saved":  {},
	// A04.2: a driver saved a preferences version. PENDING registration in
	// the contract's EVENT_NAMES (packages/contracts/src/events.ts is owned
	// outside this slice); its subject is the already-registered "driver", so
	// the outbox relay's envelope validation accepts it today.
	"mp.driver_preferences.saved": {},
	// G15: dedicated settlement event. Registered for parity with the contract's
	// closed EVENT_NAMES set; the PRODUCER is payment-service (out of scope), not
	// ride-service — ride-service does not emit it. Consumers (notification,
	// realtime) recognize it alongside the legacy transfer.posted /
	// payment.cash_acknowledged names.
	"mp.settlement.posted": {},

	// A02: post-award trip amendments (subject mp_amendment) and the
	// server-authoritative per-stop events of a multi-stop execution
	// (subject mp_award). Registered in the contract's EVENT_NAMES too.
	"mp.amendment.proposed":             {},
	"mp.amendment.awaiting_approvals":   {},
	"mp.amendment.approved":             {},
	"mp.amendment.committed":            {},
	"mp.amendment.rejected":             {},
	"mp.amendment.expired":              {},
	"mp.amendment.failed":               {},
	"mp.amendment.compensated":          {},
	"mp.stop.arrived":                   {},
	"mp.stop.arrival_disputed":          {},
	"mp.stop.waiting_started":           {},
	"mp.stop.allowance_consumed":        {},
	"mp.stop.paid_waiting_accruing":     {},
	"mp.stop.waiting_approval_required": {},
	"mp.stop.waiting_approved":          {},
	"mp.stop.excessive_waiting":         {},
	"mp.stop.departed":                  {},
	"mp.stop.skipped":                   {},
	"mp.trip.terminated_early":          {},

	// Execution-ride names reused from the move surface: the award saga and
	// the promotion create the execution ride inside THEIR transaction, so the
	// same downstream consumers see the same ride lifecycle events. The
	// stranded-ride repair moves a ride across the driver-cancel terminal
	// edge inside ITS transaction for the same reason.
	"ride.requested":           {},
	"ride.assigned":            {},
	"ride.cancelled_by_driver": {},
	// A guest passenger's free decline before pickup (A06 part B) ends the
	// execution ride in cancelled_by_rider inside the decline's transaction.
	"ride.cancelled_by_rider": {},
	// A committed amendment rewrites the execution ride's quote, fare and
	// dropoff inside the amendment's transaction, bumping the ride version.
	"ride.terms_amended": {},

	// A03 Book for Later — registered in the contract's EVENT_NAMES too.
	// Scheduled requests / recurring occurrences (subject
	// mp_scheduled_request): no driver is secured in any of these.
	"mp.scheduled_request.created":        {},
	"mp.scheduled_request.reminder":       {},
	"mp.scheduled_request.needs_approval": {},
	"mp.scheduled_request.reapproved":     {},
	"mp.scheduled_request.published":      {},
	"mp.scheduled_request.unfulfilled":    {},
	"mp.scheduled_request.cancelled":      {},
	"mp.scheduled_request.skipped":        {},
	"mp.scheduled_request.expired":        {},
	"mp.recurring_occurrence.generated":   {},
	// Advance driver reservations on the booking calendar (subject
	// mp_advance_booking).
	"mp.advance_booking.held":                {},
	"mp.advance_booking.confirmed":           {},
	"mp.advance_booking.payment_pending":     {},
	"mp.advance_booking.funding_secured":     {},
	"mp.advance_booking.funding_refused":     {},
	"mp.advance_booking.reminder":            {},
	"mp.advance_booking.reconfirm_requested": {},
	"mp.advance_booking.reconfirmed":         {},
	"mp.advance_booking.activated":           {},
	"mp.advance_booking.completed":           {},
	"mp.advance_booking.failed":              {},
	"mp.advance_booking.cancelled":           {},
	"mp.advance_booking.released":            {},
	"mp.advance_booking.rematch_requested":   {},
	// Recurring templates (subject mp_recurring_template).
	"mp.recurring_template.created":   {},
	"mp.recurring_template.paused":    {},
	"mp.recurring_template.resumed":   {},
	"mp.recurring_template.cancelled": {},
	"mp.recurring_template.ended":     {},

	// Rider confidence (A04 item 3) — registered in the contract's
	// EVENT_NAMES too. Preferred-driver requests (subject mp_request): the
	// invitation reaches the named driver only, a decline only the driver who
	// declined, the market opening only the rider; a no-consent lapse closes
	// the request through mp.request.closed. Saved drivers (subject
	// mp_favourite_driver) are rider-private.
	"mp.request.preferred_driver_invited":  {},
	"mp.request.preferred_driver_declined": {},
	"mp.request.opened_to_market":          {},
	"mp.favourite_driver.saved":            {},
	"mp.favourite_driver.removed":          {},

	// Book for another adult (A06 part B) — registered in the contract's
	// EVENT_NAMES too, subject trip_access. Deliberately NOT mp.*: the issued
	// event is notification-service's SMS hand-off and must never ride the
	// mp.* channel the realtime gateway and the push consumer fan out to
	// riders and drivers — and it carries the passenger's phone, first name
	// and link token only inside its sealed envelope (trip_access_seal.go).
	// `revoked` records a withdrawn or replaced link; `declined` is the
	// passenger's free decline before pickup (audience: the requester).
	"trip_access.issued":   {},
	"trip_access.revoked":  {},
	"trip_access.declined": {},

	// Business travel (A06 part C) — registered in the contract's
	// EVENT_NAMES too, subject business_booking (one award's organization-
	// budget funding, machine mpBusinessBooking). Deliberately NOT mp.*:
	// nothing about the organization, its budget or its policy reaches the
	// driver, and the realtime gateway fans mp.* out to drivers. Payloads
	// carry ids and integer minor amounts only.
	"business_booking.reserved":  {},
	"business_booking.refused":   {},
	"business_booking.committed": {},
	"business_booking.released":  {},
	// payment-service raised the reservation (its reserve top-up) before a
	// raised total committed: an approved fare increase or paid waiting.
	"business_booking.reserve_increased": {},

	// Fleet availability calendar (A05) — registered in the contract's
	// EVENT_NAMES too. The booking's risk overlay (subject
	// mp_advance_booking; `risk_changed` names the DRIVER only, never the
	// requester, so the realtime gateway reaches the driver alone), the
	// rider's "cancel and release" on a failed booking, and the rider's
	// proactive offer when a booking fails (decisions Q4: a same-fare rematch
	// only when rematchAvailable, or the refund — never a republish).
	"mp.advance_booking.risk_changed":     {},
	"mp.advance_booking.rematch_declined": {},
	"mp.advance_booking.choice_offered":   {},
	// A vehicle swap on an advance booking (subject mp_vehicle_swap,
	// machine mpVehicleSwap). The fare never changes and the commission is
	// never charged again; the rider's consent is always required.
	"mp.vehicle_swap.proposed":                {},
	"mp.vehicle_swap.driver_accepted":         {},
	"mp.vehicle_swap.driver_declined":         {},
	"mp.vehicle_swap.revalidation_failed":     {},
	"mp.vehicle_swap.rider_consent_requested": {},
	"mp.vehicle_swap.applied":                 {},
	"mp.vehicle_swap.rider_declined":          {},
	"mp.vehicle_swap.expired":                 {},
	"mp.vehicle_swap.cancelled":               {},
	// The shared vehicle occupancy ledger (subject vehicle_occupancy).
	// Deliberately NOT mp.*: fleet/ops data that must never ride the channel
	// fanned out to riders and drivers; payloads name no rider and no
	// driver. `offroad_use_flagged` is the UBI ops alert for a vehicle that
	// went online or started a trip during a reported breakdown.
	"vehicle_occupancy.recorded":            {},
	"vehicle_occupancy.released":            {},
	"vehicle_occupancy.moved":               {},
	"vehicle_occupancy.offroad_use_flagged": {},
}

// Event subjects (packages/contracts/src/events.ts): mp_request, mp_bid,
// mp_award, mp_claim, mp_hold, rate_profile, driver — and mp_amendment
// (subjectAmendment, amendment_views.go) for post-award trip amendments.
const (
	subjectRequest     = "mp_request"
	subjectBid         = "mp_bid"
	subjectAward       = "mp_award"
	subjectClaim       = "mp_claim"
	subjectHold        = "mp_hold"
	subjectRateProfile = "rate_profile"
	subjectDriver      = "driver"

	// A03 Book for Later subjects.
	subjectScheduled = "mp_scheduled_request"
	subjectBooking   = "mp_advance_booking"
	subjectTemplate  = "mp_recurring_template"

	// Rider confidence (A04 item 3): a rider's saved driver.
	subjectFavourite = "mp_favourite_driver"

	// subjectTripAccess (guest.go) is a guest passenger's trip link (A06
	// part B); subjectBusinessBooking (business_trips.go) one award's
	// organization-budget funding (A06 part C).

	// Fleet calendar (A05): a vehicle swap proposed on an advance booking,
	// and one row of the shared vehicle occupancy ledger.
	subjectVehicleSwap = "mp_vehicle_swap"
	subjectOccupancy   = "vehicle_occupancy"
)

// Event is one row of the transactional outbox, always written in the same
// transaction as the state change it describes (CLAUDE.md #2).
type Event struct {
	Name           string
	AggregateType  string
	AggregateID    string
	FromVersion    *int
	ToVersion      int
	CityID         string
	ActorType      string
	ActorID        string
	IdempotencyKey string
	Payload        map[string]any
	OccurredAt     time.Time
}

// writeEvent appends to public.outbox_events. A replayed transition writes the
// same idempotency key and is dropped, so a consumer never sees a duplicate.
func writeEvent(ctx context.Context, tx pgx.Tx, event Event) error {
	if _, ok := eventNames[event.Name]; !ok {
		return fmt.Errorf("refusing to publish unknown event %q", event.Name)
	}
	if event.IdempotencyKey == "" {
		return fmt.Errorf("event %s has no idempotency key", event.Name)
	}
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now().UTC()
	}
	payload, err := json.Marshal(event.Payload)
	if err != nil {
		return fmt.Errorf("event %s has an unserialisable payload: %w", event.Name, err)
	}

	var cityID *string
	if event.CityID != "" {
		cityID = &event.CityID
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO public.outbox_events (
			id, name, schema_version, aggregate_type, aggregate_id,
			from_version, to_version, city_id, actor_type, actor_id,
			idempotency_key, payload, occurred_at
		) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		deterministicID("evt", event.IdempotencyKey),
		event.Name,
		event.AggregateType,
		event.AggregateID,
		event.FromVersion,
		event.ToVersion,
		cityID,
		event.ActorType,
		event.ActorID,
		event.IdempotencyKey,
		payload,
		event.OccurredAt,
	)
	if err != nil {
		return fmt.Errorf("failed to write outbox event %s: %w", event.Name, err)
	}
	return nil
}

// AuditRecord is one row of public.audit_log. Every money-adjacent action
// writes one, in the same transaction (CLAUDE.md #2, #4).
type AuditRecord struct {
	ActorID     string
	ActorRole   string
	Action      string
	SubjectType string
	SubjectID   string
	Before      map[string]any
	After       map[string]any
	Reason      string
}

func writeAudit(ctx context.Context, tx pgx.Tx, record AuditRecord) error {
	var before, after []byte
	var err error
	if record.Before != nil {
		if before, err = json.Marshal(record.Before); err != nil {
			return fmt.Errorf("unserialisable audit before-state: %w", err)
		}
	}
	if record.After != nil {
		if after, err = json.Marshal(record.After); err != nil {
			return fmt.Errorf("unserialisable audit after-state: %w", err)
		}
	}
	var reason *string
	if record.Reason != "" {
		reason = &record.Reason
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO public.audit_log (
			id, actor_id, actor_role, action, subject_type, subject_id,
			before, after, reason
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		newID("aud"),
		record.ActorID, record.ActorRole, record.Action,
		record.SubjectType, record.SubjectID,
		before, after, reason,
	)
	if err != nil {
		return fmt.Errorf("failed to write audit row for %s: %w", record.Action, err)
	}
	return nil
}
