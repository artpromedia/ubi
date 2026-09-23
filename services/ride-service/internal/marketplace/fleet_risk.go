package marketplace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// THE BOOKING RISK OVERLAY (A05; machine mpBookingRisk).
//
// A confirmed advance booking is never cancelled by a fleet. What a fleet (or
// the world) can do is make its vehicle unusable for the booked interval —
// an off-road report, a document expiring before the booking ends, the
// driver's signed assignment ending before it (a termination notice), the
// vehicle taken by a maintenance block while the booking's vehicle was still
// unknown. Each such cause is a BLOCKER row (mp.booking_risk_blockers); the
// booking is `at_risk` exactly while one is open, with a decision deadline =
// the earlier of its reconfirmation deadline and activation minus the
// market's riskResolutionLeadSec (riskDeadlineFor).
//
// It is resolved by an applied vehicle swap (driver-accepted, server-
// revalidated, rider-consented — fleet_swaps.go), by the driver withdrawing
// (the booking ends through the existing failure path), or by the blocker
// clearing (the fleet releases the block, a document is renewed, an
// assignment covers the booking again). At the deadline the booking fails
// through the EXISTING failure path (endBooking) with reason
// risk_unresolved: the captured commission is returned with a linked
// reversal (decisions correction 1), rider funding is released, and a
// rematch is offered only when the server's rematchAvailable says so
// (correction 2). Every pass is idempotent and restart-safe: each transition
// re-reads its booking under lock and must still find what it expects.

// Blocker kinds (MP_BOOKING_RISK_REASONS).
const (
	BlockerOffRoad          = "off_road"
	BlockerDocumentExpiry   = "document_expiry"
	BlockerAssignmentEnding = "assignment_ending"
	BlockerVehicleConflict  = "vehicle_conflict"
)

// BookingFailRiskUnresolved is the failure reason of a booking whose risk
// lapsed (MpBookingFailureSchema.reason risk_unresolved).
const BookingFailRiskUnresolved = "risk_unresolved"

// errRiskNoLongerDue is endBooking finding, under the booking's lock, that a
// booking the lapse sweep listed is no longer at risk past its deadline (the
// blocker cleared or a swap applied meanwhile): nothing ends.
var errRiskNoLongerDue = errors.New("the booking's risk is no longer due")

// riskBookingStates are the booking states the overlay governs: committed,
// not yet in the live slots. (held is still being confirmed by the saga; an
// activated booking's trip is under way — a current passenger is never
// diverted.)
func riskBookingStates() []string {
	return []string{machine.MpBookingPaymentPending, machine.MpBookingConfirmed, machine.MpBookingReconfirmed}
}

func isRiskBookingState(state string) bool {
	for _, s := range riskBookingStates() {
		if s == state {
			return true
		}
	}
	return state == machine.MpBookingHeld
}

// RiskBlocker is one mp.booking_risk_blockers row.
type RiskBlocker struct {
	ID          uuid.UUID
	BookingID   uuid.UUID
	Kind        string
	SourceRef   string
	State       string
	Detail      map[string]any
	OpenedAt    time.Time
	ClearedAt   *time.Time
	ClearReason *string
}

// OpenBlocker opens one blocker on a booking; it reports whether THIS call
// opened it (an identical open blocker already there answers false).
func (s *Store) OpenBlocker(ctx context.Context, tx pgx.Tx, bookingID uuid.UUID, kind, sourceRef string, detail map[string]any, now time.Time) (bool, error) {
	if detail == nil {
		detail = map[string]any{}
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		return false, fmt.Errorf("unserialisable blocker detail: %w", err)
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO mp.booking_risk_blockers (id, booking_id, kind, source_ref, state, detail, opened_at)
		VALUES ($1, $2, $3, $4, 'open', $5, $6)
		ON CONFLICT (booking_id, kind, source_ref) WHERE state = 'open' DO NOTHING`,
		uuid.New(), bookingID, kind, sourceRef, encoded, now)
	if err != nil {
		return false, fmt.Errorf("failed to open a booking risk blocker: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// ClearBlockers clears a booking's open blockers — those of one kind and
// source when both are given, of one kind when only kind is, or all — and
// reports how many it cleared.
func (s *Store) ClearBlockers(ctx context.Context, tx pgx.Tx, bookingID uuid.UUID, kind, sourceRef, reason string, now time.Time) (int, error) {
	tag, err := tx.Exec(ctx, `
		UPDATE mp.booking_risk_blockers
		SET state = 'cleared', cleared_at = $5, clear_reason = $4
		WHERE booking_id = $1 AND state = 'open'
			AND ($2 = '' OR kind = $2) AND ($3 = '' OR source_ref = $3)`,
		bookingID, kind, sourceRef, reason, now)
	if err != nil {
		return 0, fmt.Errorf("failed to clear booking risk blockers: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// OpenBlockers lists a booking's open blockers, oldest first.
func (s *Store) OpenBlockers(ctx context.Context, db DB, bookingID uuid.UUID) ([]*RiskBlocker, error) {
	rows, err := db.Query(ctx, `
		SELECT id, booking_id, kind, source_ref, state, detail, opened_at, cleared_at, clear_reason
		FROM mp.booking_risk_blockers
		WHERE booking_id = $1 AND state = 'open'
		ORDER BY opened_at ASC, id ASC`, bookingID)
	if err != nil {
		return nil, fmt.Errorf("failed to list booking risk blockers: %w", err)
	}
	defer rows.Close()
	var out []*RiskBlocker
	for rows.Next() {
		var blocker RiskBlocker
		var detail []byte
		if err := rows.Scan(&blocker.ID, &blocker.BookingID, &blocker.Kind, &blocker.SourceRef, &blocker.State,
			&detail, &blocker.OpenedAt, &blocker.ClearedAt, &blocker.ClearReason); err != nil {
			return nil, fmt.Errorf("failed to read a booking risk blocker: %w", err)
		}
		if len(detail) > 0 {
			if err := json.Unmarshal(detail, &blocker.Detail); err != nil {
				return nil, fmt.Errorf("blocker %s stores unreadable detail: %w", blocker.ID, err)
			}
		}
		out = append(out, &blocker)
	}
	return out, rows.Err()
}

// BookingsWithOpenBlocker lists the bookings holding an open blocker from
// one source (e.g. one off-road block).
func (s *Store) BookingsWithOpenBlocker(ctx context.Context, db DB, kind, sourceRef string) ([]uuid.UUID, error) {
	rows, err := db.Query(ctx, `
		SELECT DISTINCT booking_id FROM mp.booking_risk_blockers
		WHERE state = 'open' AND kind = $1 AND source_ref = $2
		ORDER BY booking_id`, kind, sourceRef)
	if err != nil {
		return nil, fmt.Errorf("failed to list bookings by blocker: %w", err)
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// SetBookingRisk moves a booking's risk overlay, refusing anything the
// mpBookingRisk machine does not allow, under the booking's optimistic
// version. An at_risk booking always carries its deadline.
func (s *Store) SetBookingRisk(ctx context.Context, tx pgx.Tx, b *AdvanceBooking, to string, deadline *time.Time, now time.Time) (*AdvanceBooking, error) {
	if to != b.Risk {
		if err := machine.Assert(machine.MpBookingRisk, b.Risk, to); err != nil {
			allowed, _ := machine.Allowed(machine.MpBookingRisk, b.Risk)
			return nil, domain.Errorf(domain.CodeIllegalTransition, "a booking's risk cannot move from %s to %s", b.Risk, to).
				WithDetails(map[string]any{"from": b.Risk, "to": to, "allowed": allowed}).Wrap(err)
		}
	}
	if to == machine.MpRiskAtRisk && deadline == nil {
		return nil, errors.New("an at-risk booking needs a decision deadline")
	}
	var since *time.Time
	if to == machine.MpRiskAtRisk {
		since = &now
	}
	updated, err := scanBooking(tx.QueryRow(ctx, `
		UPDATE mp.advance_bookings SET
			risk = $3::text,
			risk_deadline = CASE WHEN $3::text = 'at_risk' THEN $4::timestamptz ELSE NULL END,
			risk_since = CASE WHEN $3::text = 'at_risk' THEN COALESCE(risk_since, $5::timestamptz) ELSE NULL END,
			version = version + 1,
			updated_at = now()
		WHERE id = $1 AND version = $2
		RETURNING `+bookingColumns, b.ID, b.Version, to, deadline, since))
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the booking changed while this call was in flight").
			WithDetails(map[string]any{"bookingId": b.ID.String(), "expectedVersion": b.Version})
	}
	return updated, err
}

// BookingsAtRiskDue lists at-risk bookings whose decision deadline passed.
func (s *Store) BookingsAtRiskDue(ctx context.Context, db DB, now time.Time, limit int) ([]*AdvanceBooking, error) {
	return s.bookingList(ctx, db, `
		SELECT `+bookingColumns+` FROM mp.advance_bookings
		WHERE risk = 'at_risk' AND risk_deadline <= $1 AND state = ANY($2)
		ORDER BY risk_deadline ASC
		LIMIT $3`, now, riskBookingStates(), limit)
}

// BookingsDueVehicleCheck lists committed bookings whose vehicle question or
// revalidation is due.
func (s *Store) BookingsDueVehicleCheck(ctx context.Context, db DB, now time.Time, limit int) ([]*AdvanceBooking, error) {
	return s.bookingList(ctx, db, `
		SELECT `+bookingColumns+` FROM mp.advance_bookings
		WHERE next_vehicle_check_at <= $1 AND state = ANY($2)
		ORDER BY next_vehicle_check_at ASC
		LIMIT $3`, now, vehicleCheckStates(), limit)
}

// vehicleCheckStates are the booking states whose vehicle is resolved and
// revalidated (TransitionBooking clears the schedule on leaving them).
func vehicleCheckStates() []string {
	return []string{machine.MpBookingHeld, machine.MpBookingPaymentPending,
		machine.MpBookingConfirmed, machine.MpBookingReconfirmed}
}

// ScheduleVehicleCheck records a vehicle check's outcome and when to ask
// again (nil: never).
func (s *Store) ScheduleVehicleCheck(ctx context.Context, db DB, bookingID uuid.UUID, checkedAt time.Time, next *time.Time) error {
	_, err := db.Exec(ctx, `
		UPDATE mp.advance_bookings
		SET vehicle_checked_at = $2, next_vehicle_check_at = $3, updated_at = now()
		WHERE id = $1`, bookingID, checkedAt, next)
	if err != nil {
		return fmt.Errorf("failed to schedule the booking's vehicle check: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Opening and clearing risk.
// ---------------------------------------------------------------------------

// riskMessage is the driver's sentence for an at-risk booking.
func riskMessage(reasons []string, deadline *time.Time) string {
	message := "Something affecting your vehicle puts this booking at risk"
	if len(reasons) > 0 {
		switch reasons[0] {
		case BlockerOffRoad:
			message = "Your fleet reported this booking's vehicle off the road"
		case BlockerDocumentExpiry:
			message = "A document for this booking's vehicle expires before the trip"
		case BlockerAssignmentEnding:
			message = "Your assignment to this booking's vehicle ends before the trip"
		case BlockerVehicleConflict:
			message = "This booking's vehicle is booked for maintenance during the trip"
		}
	}
	if deadline != nil {
		message += ". Keep it on another vehicle if your fleet proposes one, or withdraw — by " +
			deadline.UTC().Format(time.RFC3339) + " it is released and your commission returned."
	}
	return message
}

// writeRiskEvent writes mp.advance_booking.risk_changed: the DRIVER's alert.
// The payload names the driver only (never the requester), so the realtime
// gateway reaches the driver alone; the rider hears only about a change to
// consent to, or the booking failing.
func (s *Service) writeRiskEvent(ctx context.Context, tx pgx.Tx, b *AdvanceBooking, reasons []string, actorType, actorID string, now time.Time) error {
	var deadline any
	if b.RiskDeadline != nil {
		deadline = b.RiskDeadline.UTC().Format(time.RFC3339)
	}
	payload := map[string]any{
		"bookingId":        b.ID.String(),
		"driverId":         b.DriverID.String(),
		"risk":             b.Risk,
		"decisionDeadline": deadline,
		"reasons":          reasons,
		"audience":         []string{viewerDriver},
	}
	if b.Risk == machine.MpRiskAtRisk {
		payload["message"] = riskMessage(reasons, b.RiskDeadline)
	}
	if err := writeEvent(ctx, tx, Event{
		Name:           "mp.advance_booking.risk_changed",
		AggregateType:  subjectBooking,
		AggregateID:    b.ID.String(),
		ToVersion:      b.Version,
		CityID:         b.CityID,
		ActorType:      actorType,
		ActorID:        actorID,
		IdempotencyKey: eventKey("mp.advance_booking.risk_changed", b.ID.String(), itoa(b.Version)),
		OccurredAt:     now,
		Payload:        payload,
	}); err != nil {
		return err
	}
	return writeAudit(ctx, tx, AuditRecord{
		ActorID: actorID, ActorRole: actorType, Action: "mp.advance_booking.risk_changed",
		SubjectType: subjectBooking, SubjectID: b.ID.String(),
		After:  map[string]any{"risk": b.Risk, "decisionDeadline": deadline, "reasons": reasons},
		Reason: "the booking's risk overlay changed",
	})
}

// openBookingRisk opens a blocker on a booking LOCKED by the caller and, when
// the booking was ok, moves it to at_risk with its decision deadline. A
// blocker already open for the same source changes nothing.
func (s *Service) openBookingRisk(ctx context.Context, tx pgx.Tx, b *AdvanceBooking, kind, sourceRef string, detail map[string]any, actorType, actorID string, now time.Time) (*AdvanceBooking, error) {
	if !isRiskBookingState(b.State) {
		return b, nil
	}
	opened, err := s.deps.Store.OpenBlocker(ctx, tx, b.ID, kind, sourceRef, detail, now)
	if err != nil || !opened || b.Risk == machine.MpRiskAtRisk {
		return b, err
	}
	deadline := riskDeadlineFor(b, s.bookingRiskLead(ctx, b.CityID), now)
	moved, err := s.deps.Store.SetBookingRisk(ctx, tx, b, machine.MpRiskAtRisk, &deadline, now)
	if err != nil {
		return nil, err
	}
	if err := s.writeRiskEvent(ctx, tx, moved, []string{kind}, actorType, actorID, now); err != nil {
		return nil, err
	}
	return moved, nil
}

// clearBookingRisk clears blockers on a booking LOCKED by the caller (kind
// and source narrow it; both empty clears all) and moves the booking back to
// ok once none remain open.
func (s *Service) clearBookingRisk(ctx context.Context, tx pgx.Tx, b *AdvanceBooking, kind, sourceRef, reason, actorType, actorID string, now time.Time) (*AdvanceBooking, error) {
	cleared, err := s.deps.Store.ClearBlockers(ctx, tx, b.ID, kind, sourceRef, reason, now)
	if err != nil {
		return nil, err
	}
	if cleared == 0 || b.Risk != machine.MpRiskAtRisk {
		return b, nil
	}
	open, err := s.deps.Store.OpenBlockers(ctx, tx, b.ID)
	if err != nil {
		return nil, err
	}
	if len(open) > 0 {
		return b, nil
	}
	moved, err := s.deps.Store.SetBookingRisk(ctx, tx, b, machine.MpRiskOK, nil, now)
	if err != nil {
		return nil, err
	}
	if err := s.writeRiskEvent(ctx, tx, moved, []string{}, actorType, actorID, now); err != nil {
		return nil, err
	}
	return moved, nil
}

// withBookingLocked runs fn on one booking under lock, inside a transaction
// that first takes the vehicle ledger locks (sorted) — the lock order every
// ledger writer uses, so a swap, an off-road report and a release on the
// same vehicle queue instead of deadlocking.
func (s *Service) withBookingLocked(ctx context.Context, bookingID uuid.UUID, vehicleIDs []string, fn func(tx pgx.Tx, b *AdvanceBooking) error) error {
	sorted := append([]string(nil), vehicleIDs...)
	sort.Strings(sorted)
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		seen := map[string]bool{}
		for _, vehicle := range sorted {
			if vehicle == "" || seen[vehicle] {
				continue
			}
			seen[vehicle] = true
			if err := s.deps.Store.AcquireVehicleLock(ctx, tx, vehicle); err != nil {
				return err
			}
		}
		locked, err := s.deps.Store.BookingForUpdate(ctx, tx, bookingID)
		if err != nil {
			return err
		}
		return fn(tx, locked)
	})
}

// ---------------------------------------------------------------------------
// The sweep.
// ---------------------------------------------------------------------------

// sweepFleetCalendar runs the fleet calendar's durable passes: bookings
// whose risk lapsed fail; vehicles still unknown are asked for again and
// known ones revalidated; stalled swap revalidations are retried and lapsed
// swaps expire; bookings known to ride on an off-road vehicle are flagged.
func (s *Service) sweepFleetCalendar(ctx context.Context, now time.Time) {
	s.sweepLapsedRisk(ctx, now)
	s.sweepBookingVehicles(ctx, now)
	s.sweepVehicleSwaps(ctx, now)
	s.sweepOffRoadUse(ctx, now)
}

// sweepLapsedRisk fails every at-risk booking past its decision deadline
// through the existing failure path: commission reversed (linked entry),
// rider funding released, rematch offered only when rematchAvailable says so.
func (s *Service) sweepLapsedRisk(ctx context.Context, now time.Time) {
	due, err := s.deps.Store.BookingsAtRiskDue(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list bookings whose risk lapsed")
		return
	}
	for _, b := range due {
		end := systemEnd(machine.MpBookingFailed, BookingFailRiskUnresolved,
			"Your driver can't make this trip, so this booking was released. You won't be charged and any payment hold was released.")
		end.riskLapsed = true
		// endBooking re-checks the risk under the booking's lock.
		if _, err := s.endBooking(ctx, b, end); err != nil && !errors.Is(err, errRiskNoLongerDue) {
			s.deps.Logger.Error().Err(err).Str("booking_id", b.ID.String()).Msg("failed to release a booking whose risk lapsed")
		}
	}
}

// sweepBookingVehicles asks fleet-service again for vehicles it could not
// name at the award, and revalidates known ones: the signed assignment must
// still cover the booking and the documents must be valid through it.
func (s *Service) sweepBookingVehicles(ctx context.Context, now time.Time) {
	due, err := s.deps.Store.BookingsDueVehicleCheck(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list bookings due a vehicle check")
		return
	}
	for _, b := range due {
		if err := s.checkBookingVehicle(ctx, b, now); err != nil {
			s.deps.Logger.Info().Err(err).Str("booking_id", b.ID.String()).Msg("booking vehicle check deferred")
			retry := now.Add(vehicleResolveRetry)
			if schedErr := s.deps.Store.ScheduleVehicleCheck(ctx, s.deps.Store.Pool(), b.ID, now, &retry); schedErr != nil {
				s.deps.Logger.Error().Err(schedErr).Msg("could not defer the booking's vehicle check")
			}
		}
	}
}

// checkBookingVehicle is one booking's vehicle check. Every fleet-service
// call happens before the transaction that applies its answer.
func (s *Service) checkBookingVehicle(ctx context.Context, b *AdvanceBooking, now time.Time) error {
	switch {
	case b.VehicleResolution == VehicleResolutionPending && b.VehicleID == nil:
		answer, err := s.deps.Fleet.VehicleAt(ctx, b.DriverID, b.OccupiedStart, b.OccupiedEnd)
		if err != nil {
			return err
		}
		return s.backfillBookingVehicle(ctx, b, vehicleFromAnswer(answer), now)
	case b.VehicleID != nil:
		return s.revalidateBookingVehicle(ctx, b, now)
	default:
		return s.deps.Store.ScheduleVehicleCheck(ctx, s.deps.Store.Pool(), b.ID, now, nil)
	}
}

// backfillBookingVehicle writes a vehicle fleet-service named late onto a
// booking and the ledger, atomically. A vehicle the ledger refuses (a
// maintenance block, or another booking, holds it for the interval) is NOT
// written: the booking goes at_risk with a vehicle_conflict blocker and is
// asked about again; an off-road report over it puts the booking at risk.
func (s *Service) backfillBookingVehicle(ctx context.Context, b *AdvanceBooking, vehicle resolvedVehicle, now time.Time) error {
	if vehicle.vehicleID == nil {
		return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `
				UPDATE mp.advance_bookings
				SET vehicle_resolution = 'resolved', vehicle_checked_at = $2, next_vehicle_check_at = NULL, updated_at = now()
				WHERE id = $1 AND vehicle_resolution = 'pending' AND vehicle_id IS NULL`, b.ID, now); err != nil {
				return fmt.Errorf("failed to record the booking's vehicle resolution: %w", err)
			}
			return nil
		})
	}
	vehicleID := *vehicle.vehicleID
	conflict := false
	err := s.withBookingLocked(ctx, b.ID, []string{vehicleID}, func(tx pgx.Tx, locked *AdvanceBooking) error {
		if locked.VehicleID != nil || locked.VehicleResolution != VehicleResolutionPending || !isRiskBookingState(locked.State) {
			return nil
		}
		// Written under a savepoint: a ledger or calendar refusal must not
		// poison the transaction that then records the conflict.
		written := true
		if err := s.inSavepoint(ctx, tx, func(sp pgx.Tx) error {
			next := now.Add(vehicleRecheckInterval)
			if _, err := sp.Exec(ctx, `
				UPDATE mp.advance_bookings
				SET vehicle_id = $2, vehicle_source = 'fleet_assignment', vehicle_resolution = 'resolved',
					vehicle_class = $3, vehicle_capacity = $4, vehicle_checked_at = $5, next_vehicle_check_at = $6,
					version = version + 1, updated_at = now()
				WHERE id = $1`, locked.ID, vehicleID, vehicle.class, vehicle.capacity, now, next); err != nil {
				if isCalendarExclusion(err) {
					return errOccupancyConflict
				}
				return fmt.Errorf("failed to write the booking's vehicle: %w", err)
			}
			withVehicle := *locked
			withVehicle.VehicleID = &vehicleID
			occupancy := bookingVehicleOccupancy(&withVehicle)
			occupancy.CreatedAt = now
			if err := s.deps.Store.InsertOccupancy(ctx, sp, occupancy); err != nil {
				return err
			}
			return writeOccupancyEvent(ctx, sp, occupancy, "vehicle_occupancy.recorded", "system", "ride-service", now,
				"a booking's vehicle fleet-service named after the award now occupies it", map[string]any{"blockId": locked.BlockID.String()})
		}); err != nil {
			if !errors.Is(err, errOccupancyConflict) {
				return err
			}
			written = false
		}
		refreshed, err := s.deps.Store.BookingForUpdate(ctx, tx, locked.ID)
		if err != nil {
			return err
		}
		if !written {
			conflict = true
			retry := now.Add(vehicleResolveRetry)
			if err := s.deps.Store.ScheduleVehicleCheck(ctx, tx, refreshed.ID, now, &retry); err != nil {
				return err
			}
			_, err := s.openBookingRisk(ctx, tx, refreshed, BlockerVehicleConflict, "vehicle:"+vehicleID,
				map[string]any{"vehicleId": vehicleID}, "system", "ride-service", now)
			return err
		}
		// The vehicle is on the booking: a conflict opened earlier is over,
		// and an off-road report already holding it puts the booking at risk.
		refreshed, err = s.clearBookingRisk(ctx, tx, refreshed, BlockerVehicleConflict, "", "vehicle_recorded", "system", "ride-service", now)
		if err != nil {
			return err
		}
		end := refreshed.OccupiedEnd
		offRoad, err := s.deps.Store.OverlappingOccupancy(ctx, tx, vehicleID, []string{OccupancyKindOffRoad}, refreshed.OccupiedStart, &end)
		if err != nil {
			return err
		}
		for _, report := range offRoad {
			if refreshed, err = s.openBookingRisk(ctx, tx, refreshed, BlockerOffRoad, report.ID.String(),
				map[string]any{"vehicleId": vehicleID}, "system", "ride-service", now); err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil && conflict {
		s.deps.Logger.Info().Str("booking_id", b.ID.String()).Msg("the vehicle fleet-service named is occupied for the booking; the booking is at risk")
	}
	return err
}

// inSavepoint runs fn in a nested transaction (a savepoint).
func (s *Service) inSavepoint(ctx context.Context, tx pgx.Tx, fn func(sp pgx.Tx) error) error {
	sp, err := tx.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to open a savepoint: %w", err)
	}
	if err := fn(sp); err != nil {
		_ = sp.Rollback(ctx)
		return err
	}
	return sp.Commit(ctx)
}

// revalidateBookingVehicle checks a known vehicle against fleet-service:
// for a vehicle that came from the driver's assignment, the assignment must
// still cover the booking (else assignment_ending — e.g. a termination
// notice ending before it); for any vehicle, both documents must be valid
// through the booking's end (else document_expiry). Each blocker clears once
// the answer is good again.
func (s *Service) revalidateBookingVehicle(ctx context.Context, b *AdvanceBooking, now time.Time) error {
	vehicleID := *b.VehicleID
	var assignment *FleetVehicleAt
	if b.VehicleSource == VehicleSourceFleetAssignment {
		answer, err := s.deps.Fleet.VehicleAt(ctx, b.DriverID, b.OccupiedStart, b.OccupiedEnd)
		if err != nil {
			return err
		}
		assignment = answer
	}
	vehicle, vehicleErr := s.deps.Fleet.Vehicle(ctx, vehicleID)
	if vehicleErr != nil && !errors.Is(vehicleErr, ErrFleetVehicleUnknown) {
		return vehicleErr
	}
	next := now.Add(vehicleRecheckInterval)
	return s.withBookingLocked(ctx, b.ID, []string{vehicleID}, func(tx pgx.Tx, locked *AdvanceBooking) error {
		if locked.VehicleID == nil || *locked.VehicleID != vehicleID || !isRiskBookingState(locked.State) {
			return nil
		}
		var err error
		if assignment != nil {
			covered := assignment.VehicleID != nil && *assignment.VehicleID == vehicleID
			if covered {
				locked, err = s.clearBookingRisk(ctx, tx, locked, BlockerAssignmentEnding, "", "assignment_covers_booking", "system", "ride-service", now)
			} else {
				locked, err = s.openBookingRisk(ctx, tx, locked, BlockerAssignmentEnding, "assignment:"+vehicleID,
					map[string]any{"vehicleId": vehicleID}, "system", "ride-service", now)
			}
			if err != nil {
				return err
			}
		}
		documentsValid := vehicle != nil && vehicle.DocumentsValidThrough(locked.OccupiedEnd)
		if documentsValid {
			locked, err = s.clearBookingRisk(ctx, tx, locked, BlockerDocumentExpiry, "", "documents_valid", "system", "ride-service", now)
		} else {
			detail := map[string]any{"vehicleId": vehicleID}
			if vehicle != nil && vehicle.EarliestExpiry() != nil {
				detail["expiresAt"] = vehicle.EarliestExpiry().Format(time.RFC3339)
			}
			locked, err = s.openBookingRisk(ctx, tx, locked, BlockerDocumentExpiry, "documents:"+vehicleID, detail, "system", "ride-service", now)
		}
		if err != nil {
			return err
		}
		return s.deps.Store.ScheduleVehicleCheck(ctx, tx, locked.ID, now, &next)
	})
}

// ---------------------------------------------------------------------------
// Off-road abuse control (decisions correction 4).
// ---------------------------------------------------------------------------

// Off-road use triggers.
const (
	OffRoadUseDriverOnline = "driver_online"
	OffRoadUseTripStarted  = "trip_started"
)

// flagOffRoadUse records — once per occurrence — that a vehicle reported
// off-road was used during the claimed breakdown, with a UBI ops event and an
// audit row, in one transaction. It is never silently ignored.
func (s *Service) flagOffRoadUse(ctx context.Context, report *VehicleOccupancy, driverID uuid.UUID, cityID, trigger, subjectRef string, now time.Time) error {
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		id := uuid.New()
		var city *string
		if cityID != "" {
			city = &cityID
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO mp.offroad_use_flags (id, occupancy_id, vehicle_id, driver_id, city_id, trigger, subject_ref, observed_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (occupancy_id, driver_id, trigger, subject_ref) DO NOTHING`,
			id, report.ID, report.VehicleID, driverID, city, trigger, subjectRef, now)
		if err != nil {
			return fmt.Errorf("failed to record an off-road use flag: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		payload := map[string]any{
			"flagId":      id.String(),
			"occupancyId": report.ID.String(),
			"blockId":     report.SourceID,
			"vehicleId":   report.VehicleID,
			"driverId":    driverID.String(),
			"trigger":     trigger,
			"observedAt":  now.UTC().Format(time.RFC3339),
			"reportedAt":  report.CreatedAt.UTC().Format(time.RFC3339),
			"audience":    []string{"ubi_ops"},
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "vehicle_occupancy.offroad_use_flagged",
			AggregateType:  subjectOccupancy,
			AggregateID:    report.ID.String(),
			ToVersion:      report.Version,
			CityID:         cityID,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: eventKey("vehicle_occupancy.offroad_use_flagged", report.ID.String(), driverID.String(), trigger, subjectRef),
			OccurredAt:     now,
			Payload:        payload,
		}); err != nil {
			return err
		}
		return writeAudit(ctx, tx, AuditRecord{
			ActorID: "ride-service", ActorRole: "system", Action: "vehicle_occupancy.offroad_use_flagged",
			SubjectType: subjectOccupancy, SubjectID: report.ID.String(),
			After:  payload,
			Reason: "a vehicle reported off-road was used during the claimed breakdown; flagged to UBI ops",
		})
	})
}

// checkOffRoadUse asks whether the vehicle a driver is using now is
// reported off-road, and flags it if so. The vehicle is the one on the
// driver's booking running now, else the one fleet-service says the driver
// is assigned to right now. Cheap when no vehicle anywhere is off-road.
func (s *Service) checkOffRoadUse(ctx context.Context, driverID uuid.UUID, cityID, trigger, subjectRef string) {
	now := s.now()
	offRoadNow, err := s.deps.Store.AnyActiveOffRoadAt(ctx, s.deps.Store.Pool(), now)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("off-road use check failed")
		return
	}
	if !offRoadNow {
		return
	}
	vehicles := map[string]bool{}
	bookings, err := s.deps.Store.BookingsOccupying(ctx, s.deps.Store.Pool(), nil, []uuid.UUID{driverID}, now, now.Add(time.Second), 10)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("off-road use check could not read the driver's bookings")
	}
	for _, b := range bookings {
		if b.VehicleID != nil {
			vehicles[*b.VehicleID] = true
		}
	}
	// fleet-service is asked only where the deny-by-default fleet flag is on
	// (as at the award), so a go-online elsewhere never waits on it.
	if s.flagOn(ctx, cityconfig.FlagFleet, driverID.String(), cityID) {
		if answer, err := s.deps.Fleet.VehicleAt(ctx, driverID, now, now.Add(time.Minute)); err == nil && answer != nil && answer.VehicleID != nil {
			vehicles[*answer.VehicleID] = true
		} else if err != nil && FleetServiceConfigured(s.deps.Fleet) {
			s.deps.Logger.Warn().Err(err).Str("driver_id", driverID.String()).Msg("off-road use check could not ask fleet-service for the driver's vehicle")
		}
	}
	for vehicleID := range vehicles {
		end := now.Add(time.Second)
		reports, err := s.deps.Store.OverlappingOccupancy(ctx, s.deps.Store.Pool(), vehicleID, []string{OccupancyKindOffRoad}, now, &end)
		if err != nil {
			s.deps.Logger.Error().Err(err).Msg("off-road use check could not read the ledger")
			continue
		}
		for _, report := range reports {
			if err := s.flagOffRoadUse(ctx, report, driverID, cityID, trigger, subjectRef, now); err != nil {
				s.deps.Logger.Error().Err(err).Str("vehicle_id", vehicleID).Msg("failed to flag off-road use")
			}
		}
	}
}

// DriverWentOnline implements move.DriverActivityObserver: called after a
// driver's go-online committed.
func (s *Service) DriverWentOnline(ctx context.Context, driverID uuid.UUID, cityID string, onlineSince time.Time) {
	// Microsecond precision, as ride.driver_sessions stores it, so the sweep
	// backstop names the same occurrence (flagged once, not twice).
	s.checkOffRoadUse(ctx, driverID, cityID, OffRoadUseDriverOnline,
		"online:"+onlineSince.UTC().Truncate(time.Microsecond).Format(time.RFC3339Nano))
}

// TripStarted implements move.DriverActivityObserver: called after a live
// trip's start committed.
func (s *Service) TripStarted(ctx context.Context, rideID, driverID uuid.UUID, cityID string) {
	s.checkOffRoadUse(ctx, driverID, cityID, OffRoadUseTripStarted, "ride:"+rideID.String())
}

// sweepOffRoadUse is the durable backstop for the post-commit checks above,
// for the drivers ride-service itself knows ride a vehicle: every booking on
// a vehicle reported off-road now whose trip has started (activated), or
// whose driver is online, is flagged — once per occurrence.
func (s *Service) sweepOffRoadUse(ctx context.Context, now time.Time) {
	reports, err := s.deps.Store.ActiveOffRoadAt(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list off-road vehicles")
		return
	}
	for _, report := range reports {
		bookings, err := s.deps.Store.BookingsOnVehicle(ctx, s.deps.Store.Pool(), report.VehicleID,
			machine.MpBookingOccupyingStates(), report.Start, report.End)
		if err != nil {
			s.deps.Logger.Error().Err(err).Msg("failed to list bookings on an off-road vehicle")
			continue
		}
		for _, b := range bookings {
			// A booking whose trip entered the live slots is using the
			// vehicle now, whatever its buffered interval says.
			if b.State == machine.MpBookingActivated {
				if err := s.flagOffRoadUse(ctx, report, b.DriverID, b.CityID, OffRoadUseTripStarted, "booking:"+b.ID.String(), now); err != nil {
					s.deps.Logger.Error().Err(err).Msg("failed to flag off-road use")
				}
				continue
			}
			// Otherwise only a booking whose interval is now tells us the
			// driver is on this vehicle while online.
			if now.Before(b.OccupiedStart) || !now.Before(b.OccupiedEnd) {
				continue
			}
			state, onlineSince, err := s.deps.Store.DriverOnlineSince(ctx, s.deps.Store.Pool(), b.DriverID)
			// Only a driver who went online DURING the claimed breakdown.
			if err != nil || state == machine.DriverOffline || onlineSince == nil || onlineSince.Before(report.Start) {
				continue
			}
			if err := s.flagOffRoadUse(ctx, report, b.DriverID, b.CityID, OffRoadUseDriverOnline,
				"online:"+onlineSince.UTC().Format(time.RFC3339Nano), now); err != nil {
				s.deps.Logger.Error().Err(err).Msg("failed to flag off-road use")
			}
		}
	}
}

// DriverOnlineSince reads a driver's session state and when they last went
// online (ride.driver_sessions is the move package's; read only).
func (s *Store) DriverOnlineSince(ctx context.Context, db DB, driverID uuid.UUID) (string, *time.Time, error) {
	var state string
	var onlineSince *time.Time
	err := db.QueryRow(ctx, `SELECT state, online_since FROM ride.driver_sessions WHERE driver_id = $1`, driverID).
		Scan(&state, &onlineSince)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, domain.ErrNotFound
	}
	if err != nil {
		return "", nil, fmt.Errorf("failed to read the driver's session: %w", err)
	}
	return state, onlineSince, nil
}
