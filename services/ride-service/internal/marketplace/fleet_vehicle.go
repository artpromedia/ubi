package marketplace

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// VEHICLE IDENTITY ON ADVANCE BOOKINGS (A05 FL-4).
//
// At the advance award ride-service asks fleet-service (contract A route 8)
// which vehicle the driver is assigned to, under a signed assignment, for the
// booking's WHOLE occupied interval (buffers included) — and writes that
// vehicle onto the booking and its row on the shared occupancy ledger in the
// booking's own transaction, so the per-vehicle exclusion applies from the
// first moment. The question is asked before any transaction opens, behind
// the deny-by-default `fleet` flag and a short timeout, and it NEVER blocks
// the award:
//
//   - flag off → not_applicable: no call, no vehicle — the booking behaves
//     exactly as before the fleet calendar;
//   - no fleet assignment covering the interval → resolved, no vehicle;
//   - fleet-service down, slow or malformed → pending, no vehicle: the award
//     goes ahead and the sweep keeps asking (fleet_risk.go). ride-service has
//     no other record of a driver's vehicle (the verified driver profile
//     carries a masked plate, never an id), so the fallback is null, and the
//     booking is guarded by the per-driver exclusion alone meanwhile.
//
// Once a vehicle is known it is revalidated on a slow schedule: the signed
// assignment must still cover the booking (a termination notice ending
// before it opens an assignment_ending blocker) and the vehicle's documents
// must be valid through it (else document_expiry) — both move the booking to
// at_risk rather than failing it.

// Plumbing, not policy: how soon an unanswered vehicle question is asked
// again, and how often a known vehicle is revalidated.
const (
	vehicleResolveRetry    = 5 * time.Minute
	vehicleRecheckInterval = time.Hour
)

// resolvedVehicle is what route 8 said about a booking's interval.
type resolvedVehicle struct {
	vehicleID  *string
	class      *string
	capacity   *int
	resolution string
	source     string
}

// resolveBookingVehicle asks fleet-service which vehicle the driver is
// assigned to for [start, end). Never an error: every failure is "pending".
func (s *Service) resolveBookingVehicle(ctx context.Context, driverID uuid.UUID, cityID string, start, end time.Time) resolvedVehicle {
	if !s.flagOn(ctx, cityconfig.FlagFleet, driverID.String(), cityID) {
		return resolvedVehicle{resolution: VehicleResolutionNotApplicable}
	}
	answer, err := s.deps.Fleet.VehicleAt(ctx, driverID, start, end)
	if err != nil {
		s.deps.Logger.Warn().Err(err).Str("driver_id", driverID.String()).
			Msg("fleet-service did not say which vehicle the driver uses; the advance booking goes ahead without one and the sweep keeps asking")
		return resolvedVehicle{resolution: VehicleResolutionPending}
	}
	return vehicleFromAnswer(answer)
}

// vehicleFromAnswer turns a route 8 answer into a resolution.
func vehicleFromAnswer(answer *FleetVehicleAt) resolvedVehicle {
	if answer == nil || answer.VehicleID == nil {
		return resolvedVehicle{resolution: VehicleResolutionResolved}
	}
	return resolvedVehicle{
		vehicleID:  answer.VehicleID,
		class:      answer.VehicleClass,
		capacity:   answer.Capacity,
		resolution: VehicleResolutionResolved,
		source:     VehicleSourceFleetAssignment,
	}
}

// applyTo writes the resolution onto a new booking, with its revalidation
// schedule.
func (v resolvedVehicle) applyTo(b *AdvanceBooking, now time.Time) {
	b.VehicleResolution = v.resolution
	if b.VehicleResolution == "" {
		b.VehicleResolution = VehicleResolutionNotApplicable
	}
	b.VehicleID = v.vehicleID
	b.VehicleSource = v.source
	b.VehicleClass = v.class
	b.VehicleCapacity = v.capacity
	switch {
	case b.VehicleResolution == VehicleResolutionPending:
		next := now.Add(vehicleResolveRetry)
		b.NextVehicleCheckAt = &next
	case b.VehicleID != nil:
		next := now.Add(vehicleRecheckInterval)
		b.NextVehicleCheckAt = &next
	}
}

// checkBookingVehicleFree takes the vehicle's ledger lock and refuses a new
// booking on a vehicle reported off the road for its interval. Maintenance
// and other bookings are refused by the exclusion constraints themselves.
func (s *Service) checkBookingVehicleFree(ctx context.Context, tx pgx.Tx, b *AdvanceBooking) error {
	if err := s.deps.Store.AcquireVehicleLock(ctx, tx, *b.VehicleID); err != nil {
		return err
	}
	end := b.OccupiedEnd
	offRoad, err := s.deps.Store.OverlappingOccupancy(ctx, tx, *b.VehicleID, []string{OccupancyKindOffRoad}, b.OccupiedStart, &end)
	if err != nil {
		return err
	}
	if len(offRoad) > 0 {
		return calendarConflict("the driver's vehicle is reported off the road for this window",
			map[string]any{"vehicleUnavailable": true})
	}
	return nil
}

// recordBookingOccupancy writes a booking's row on the shared vehicle
// occupancy ledger inside the booking's transaction, with its outbox event
// and audit row. The ledger's exclusion constraint refusing it (a
// maintenance block holds the vehicle) is a calendar conflict.
func (s *Service) recordBookingOccupancy(ctx context.Context, tx pgx.Tx, b *AdvanceBooking, actorType, actorID string, now time.Time) error {
	occupancy := bookingVehicleOccupancy(b)
	occupancy.CreatedAt = now
	if err := s.deps.Store.InsertOccupancy(ctx, tx, occupancy); err != nil {
		if errors.Is(err, errOccupancyConflict) {
			return calendarConflict("the driver's vehicle is booked for maintenance during this window",
				map[string]any{"vehicleUnavailable": true})
		}
		return err
	}
	return writeOccupancyEvent(ctx, tx, occupancy, "vehicle_occupancy.recorded", actorType, actorID, now,
		"an advance booking's vehicle now occupies it for the booked interval", map[string]any{"blockId": b.BlockID.String()})
}

// writeOccupancyEvent appends one vehicle_occupancy.* outbox row and its
// audit row. Deliberately NOT mp.*: ledger rows are fleet/ops data and never
// ride the channel the realtime gateway fans out to riders and drivers — so
// the payload names no rider and no driver.
func writeOccupancyEvent(ctx context.Context, tx pgx.Tx, o *VehicleOccupancy, name, actorType, actorID string, now time.Time, reason string, extra map[string]any) error {
	payload := map[string]any{
		"occupancyId": o.ID.String(),
		"kind":        o.Kind,
		"vehicleId":   o.VehicleID,
		"state":       o.State,
		"startsAt":    o.Start.UTC().Format(time.RFC3339),
		"endsAt":      nil,
	}
	if o.End != nil {
		payload["endsAt"] = o.End.UTC().Format(time.RFC3339)
	}
	if o.Kind != OccupancyKindBooking {
		payload["blockId"] = o.SourceID
	}
	if o.MaintenanceKind != nil {
		payload["maintenanceKind"] = *o.MaintenanceKind
	}
	for key, value := range extra {
		payload[key] = value
	}
	if err := writeEvent(ctx, tx, Event{
		Name:           name,
		AggregateType:  subjectOccupancy,
		AggregateID:    o.ID.String(),
		ToVersion:      o.Version,
		ActorType:      actorType,
		ActorID:        actorID,
		IdempotencyKey: eventKey(name, o.ID.String(), itoa(o.Version), o.VehicleID),
		OccurredAt:     now,
		Payload:        payload,
	}); err != nil {
		return err
	}
	role := actorType
	if actorType == "fleet" {
		role = "fleet_service"
	}
	return writeAudit(ctx, tx, AuditRecord{
		ActorID: actorID, ActorRole: role, Action: name,
		SubjectType: subjectOccupancy, SubjectID: o.ID.String(),
		After:  payload,
		Reason: reason,
	})
}

// bookingRiskLead is the market's risk resolution lead in seconds (0 when
// none is configured or the policy cannot be read).
func (s *Service) bookingRiskLead(ctx context.Context, cityID string) int {
	_, policy, err := s.policy(ctx, cityID)
	if err != nil {
		return 0
	}
	advance, err := policy.AdvanceReservationPolicyFor(cityID)
	if err != nil {
		return 0
	}
	return advance.RiskResolutionLead()
}

// riskDeadlineFor is when a booking put at risk must be resolved (Q4 as
// decided, a per-market policy value): the EARLIER of its reconfirmation
// deadline — while it still awaits reconfirmation — and activation minus the
// market's risk resolution lead. A blocker that arrives too late to resolve
// is due at once (never a deadline in the past).
func riskDeadlineFor(b *AdvanceBooking, leadSec int, now time.Time) time.Time {
	deadline := b.ActivationAt.Add(-time.Duration(leadSec) * time.Second)
	awaitingReconfirmation := b.ReconfirmedAt == nil &&
		(b.State == machine.MpBookingHeld || b.State == machine.MpBookingPaymentPending || b.State == machine.MpBookingConfirmed)
	if awaitingReconfirmation && b.ReconfirmDeadline.Before(deadline) {
		deadline = b.ReconfirmDeadline
	}
	if deadline.Before(now) {
		deadline = now
	}
	return deadline.UTC()
}
