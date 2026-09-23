package marketplace

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// VEHICLE SWAP ON AN ADVANCE BOOKING (A05 FL-8; machine mpVehicleSwap).
//
//	proposed            a fleet proposes another of its vehicles (contract A
//	                    route 7, behind marketplace_booking_vehicle_swaps)
//	driver_accepted     the booked driver accepts, parked (the stationary
//	                    gate, as for every driver decision)
//	revalidating        the server re-checks the target: same-or-higher
//	                    class, capacity at least the booking's, its occupancy
//	                    free for the booking's buffered interval, insurance
//	                    and inspection valid through it (route 9)
//	rider_consent_pending   the RIDER must confirm — always (decisions Q3:
//	                    riders check the plate at pickup)
//	applied             vehicle_id and the booking's occupancy row move
//	                    atomically under the vehicle exclusion constraint;
//	                    the fare is unchanged and the commission is never
//	                    charged again
//
// Any decline, failed revalidation, expiry (the booking's decision deadline)
// or the booking ending keeps the original vehicle; if the blocker remains
// the booking stays at_risk. At most one swap is live per booking.

// swapUpgrades is the same-or-higher class rule (handoff A4): a booking of a
// class may move to a vehicle offering that class, or one of the classes
// listed here as above it. Deliberately conservative: only `go` has classes
// above it; comfort, xl and moto move only within their own class.
var swapUpgrades = map[string][]string{
	"go": {"comfort", "xl"},
}

// fleetServiceActorID is the idempotency namespace of contract A calls
// (mp.idempotency_keys keys by actor uuid).
var fleetServiceActorID = uuid.NewSHA1(uuid.NameSpaceURL, []byte("ubi:service:fleet-service"))

// Swap ineligibility reasons (MP_SWAP_INELIGIBLE_REASONS).
const (
	SwapReasonNotEnabled         = "swaps_not_enabled"
	SwapReasonNotSwappable       = "booking_not_swappable"
	SwapReasonAlreadyOpen        = "swap_already_open"
	SwapReasonSameVehicle        = "same_vehicle"
	SwapReasonVehicleUnknown     = "vehicle_unknown"
	SwapReasonDifferentFleet     = "different_fleet"
	SwapReasonClass              = "class_not_eligible"
	SwapReasonCapacity           = "capacity_too_small"
	SwapReasonOccupied           = "vehicle_occupied"
	SwapReasonOffRoad            = "vehicle_off_road"
	SwapReasonDocuments          = "documents_expired"
	SwapReasonServiceUnavailable = "fleet_service_unavailable"
)

// swapRetryDelay is how soon a revalidation fleet-service could not answer
// is retried. Plumbing, not policy.
const swapRetryDelay = time.Minute

// VehicleSwap is one mp.booking_vehicle_swaps row.
type VehicleSwap struct {
	ID                 uuid.UUID
	BookingID          uuid.UUID
	CityID             string
	DriverID           uuid.UUID
	RequesterID        uuid.UUID
	FromVehicleID      *string
	ToVehicleID        string
	RequestedByStaffID string
	State              string
	Version            int
	FromClasses        []string
	FromCapacity       *int
	ToClasses          []string
	ToCapacity         *int
	FleetID            *string
	ExpiresAt          time.Time
	FailureReasons     []string
	DriverDecidedAt    *time.Time
	RevalidatedAt      *time.Time
	RiderDecidedAt     *time.Time
	AppliedAt          *time.Time
	EndedAt            *time.Time
	Attempts           int
	NextAttemptAt      *time.Time
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

const swapColumns = `
	id, booking_id, city_id, driver_id, requester_id, from_vehicle_id, to_vehicle_id, requested_by_staff_id,
	state, version, from_classes, from_capacity, to_classes, to_capacity, fleet_id, expires_at, failure_reasons,
	driver_decided_at, revalidated_at, rider_decided_at, applied_at, ended_at, attempts, next_attempt_at,
	created_at, updated_at`

func scanSwap(row pgx.Row) (*VehicleSwap, error) {
	var w VehicleSwap
	err := row.Scan(&w.ID, &w.BookingID, &w.CityID, &w.DriverID, &w.RequesterID, &w.FromVehicleID, &w.ToVehicleID,
		&w.RequestedByStaffID, &w.State, &w.Version, &w.FromClasses, &w.FromCapacity, &w.ToClasses, &w.ToCapacity,
		&w.FleetID, &w.ExpiresAt, &w.FailureReasons, &w.DriverDecidedAt, &w.RevalidatedAt, &w.RiderDecidedAt,
		&w.AppliedAt, &w.EndedAt, &w.Attempts, &w.NextAttemptAt, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read vehicle swap: %w", err)
	}
	w.ExpiresAt = w.ExpiresAt.UTC()
	return &w, nil
}

func (s *Store) swapList(ctx context.Context, db DB, query string, args ...any) ([]*VehicleSwap, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list vehicle swaps: %w", err)
	}
	defer rows.Close()
	var out []*VehicleSwap
	for rows.Next() {
		w, err := scanSwap(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// errSwapAlreadyLive is the one-live-swap-per-booking index saying no.
var errSwapAlreadyLive = errors.New("a vehicle swap is already in flight for this booking")

// InsertSwap writes a new proposed swap.
func (s *Store) InsertSwap(ctx context.Context, tx pgx.Tx, w *VehicleSwap) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO mp.booking_vehicle_swaps (
			id, booking_id, city_id, driver_id, requester_id, from_vehicle_id, to_vehicle_id, requested_by_staff_id,
			state, version, from_classes, from_capacity, to_classes, to_capacity, fleet_id, expires_at,
			created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
		w.ID, w.BookingID, w.CityID, w.DriverID, w.RequesterID, w.FromVehicleID, w.ToVehicleID, w.RequestedByStaffID,
		w.State, w.Version, w.FromClasses, w.FromCapacity, w.ToClasses, w.ToCapacity, w.FleetID, w.ExpiresAt,
		stampOf(w.CreatedAt))
	if err != nil {
		if isUniqueViolation(err, "booking_vehicle_swaps_one_live") {
			return errSwapAlreadyLive
		}
		return fmt.Errorf("failed to insert vehicle swap: %w", err)
	}
	return nil
}

// SwapByID reads one swap.
func (s *Store) SwapByID(ctx context.Context, db DB, id uuid.UUID) (*VehicleSwap, error) {
	return scanSwap(db.QueryRow(ctx, `SELECT `+swapColumns+` FROM mp.booking_vehicle_swaps WHERE id = $1`, id))
}

// SwapForUpdate reads and locks one swap.
func (s *Store) SwapForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*VehicleSwap, error) {
	return scanSwap(tx.QueryRow(ctx, `SELECT `+swapColumns+` FROM mp.booking_vehicle_swaps WHERE id = $1 FOR UPDATE`, id))
}

// LiveSwapForBooking reads the booking's swap still in flight, if any.
func (s *Store) LiveSwapForBooking(ctx context.Context, db DB, bookingID uuid.UUID) (*VehicleSwap, error) {
	return scanSwap(db.QueryRow(ctx, `SELECT `+swapColumns+` FROM mp.booking_vehicle_swaps
		WHERE booking_id = $1 AND state = ANY($2)`, bookingID, machine.MpSwapLiveStates()))
}

// SwapsDue lists live swaps past their expiry, and revalidations due a retry.
func (s *Store) SwapsDue(ctx context.Context, db DB, now time.Time, limit int) ([]*VehicleSwap, error) {
	return s.swapList(ctx, db, `SELECT `+swapColumns+` FROM mp.booking_vehicle_swaps
		WHERE state = ANY($1) AND (expires_at <= $2
			OR (state IN ('driver_accepted', 'revalidating') AND (next_attempt_at IS NULL OR next_attempt_at <= $2)))
		ORDER BY expires_at ASC
		LIMIT $3`, machine.MpSwapLiveStates(), now, limit)
}

// SwapUpdate carries the columns a swap transition may change.
type SwapUpdate struct {
	FailureReasons  []string
	DriverDecidedAt *time.Time
	RevalidatedAt   *time.Time
	RiderDecidedAt  *time.Time
	AppliedAt       *time.Time
	ToClasses       []string
	ToCapacity      *int
	FleetID         *string
	NextAttemptAt   *time.Time
	CountAttempt    bool
}

// TransitionSwap moves a swap, refusing anything the mpVehicleSwap machine
// does not allow, under the optimistic version. A to-state equal to the
// current one is a field-only update.
func (s *Store) TransitionSwap(ctx context.Context, tx pgx.Tx, w *VehicleSwap, to string, update SwapUpdate) (*VehicleSwap, error) {
	if to != w.State {
		if err := machine.Assert(machine.MpVehicleSwap, w.State, to); err != nil {
			allowed, _ := machine.Allowed(machine.MpVehicleSwap, w.State)
			return nil, domain.Errorf(domain.CodeIllegalTransition, "a vehicle swap cannot move from %s to %s", w.State, to).
				WithDetails(map[string]any{"from": w.State, "to": to, "allowed": allowed}).Wrap(err)
		}
	}
	ended := !machine.IsMpSwapLive(to) && machine.IsMpSwapLive(w.State)
	updated, err := scanSwap(tx.QueryRow(ctx, `
		UPDATE mp.booking_vehicle_swaps SET
			state = $3,
			version = version + 1,
			failure_reasons = COALESCE($4, failure_reasons),
			driver_decided_at = COALESCE($5, driver_decided_at),
			revalidated_at = COALESCE($6, revalidated_at),
			rider_decided_at = COALESCE($7, rider_decided_at),
			applied_at = COALESCE($8, applied_at),
			to_classes = COALESCE($9, to_classes),
			to_capacity = COALESCE($10, to_capacity),
			fleet_id = COALESCE($11, fleet_id),
			next_attempt_at = $12,
			attempts = attempts + CASE WHEN $13 THEN 1 ELSE 0 END,
			ended_at = CASE WHEN $14 THEN now() ELSE ended_at END,
			updated_at = now()
		WHERE id = $1 AND version = $2
		RETURNING `+swapColumns,
		w.ID, w.Version, to, update.FailureReasons, update.DriverDecidedAt, update.RevalidatedAt,
		update.RiderDecidedAt, update.AppliedAt, update.ToClasses, update.ToCapacity, update.FleetID,
		update.NextAttemptAt, update.CountAttempt, ended))
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the vehicle swap changed while this call was in flight").
			WithDetails(map[string]any{"swapId": w.ID.String(), "expectedVersion": w.Version})
	}
	return updated, err
}

// ---------------------------------------------------------------------------
// Eligibility.
// ---------------------------------------------------------------------------

// swapTarget is what revalidation learned about a swap's target vehicle.
type swapTarget struct {
	reasons  []string
	target   *FleetVehicle
	from     *FleetVehicle
	retrying bool // fleet-service did not answer: nothing was decided
}

// classEligible reports whether a vehicle offering `classes` may carry a
// booking of `booked` class (same or higher).
func classEligible(booked string, classes []string) bool {
	allowed := map[string]bool{booked: true}
	for _, upgrade := range swapUpgrades[booked] {
		allowed[upgrade] = true
	}
	for _, class := range classes {
		if allowed[class] {
			return true
		}
	}
	return false
}

// checkSwapTarget runs every eligibility rule for moving a booking to a
// vehicle. fleet-service calls happen here, before any transaction.
func (s *Service) checkSwapTarget(ctx context.Context, b *AdvanceBooking, bookedClass, toVehicleID string) swapTarget {
	result := swapTarget{}
	target, err := s.deps.Fleet.Vehicle(ctx, toVehicleID)
	switch {
	case errors.Is(err, ErrFleetVehicleUnknown):
		result.reasons = append(result.reasons, SwapReasonVehicleUnknown)
		return result
	case err != nil:
		result.reasons = append(result.reasons, SwapReasonServiceUnavailable)
		result.retrying = true
		return result
	}
	result.target = target
	required := 1
	if b.VehicleCapacity != nil {
		required = *b.VehicleCapacity
	}
	if b.VehicleID != nil {
		from, err := s.deps.Fleet.Vehicle(ctx, *b.VehicleID)
		switch {
		case err == nil:
			result.from = from
			if from.FleetID != target.FleetID {
				result.reasons = append(result.reasons, SwapReasonDifferentFleet)
			}
			if b.VehicleCapacity == nil {
				required = from.Capacity
			}
		case !errors.Is(err, ErrFleetVehicleUnknown):
			result.reasons = append(result.reasons, SwapReasonServiceUnavailable)
			result.retrying = true
			return result
		}
	}
	if !classEligible(bookedClass, target.Classes) {
		result.reasons = append(result.reasons, SwapReasonClass)
	}
	if target.Capacity < required {
		result.reasons = append(result.reasons, SwapReasonCapacity)
	}
	end := b.OccupiedEnd
	occupied, err := s.deps.Store.OverlappingOccupancy(ctx, s.deps.Store.Pool(), toVehicleID,
		[]string{OccupancyKindBooking, OccupancyKindMaintenance, OccupancyKindOffRoad}, b.OccupiedStart, &end)
	if err != nil {
		result.reasons = append(result.reasons, SwapReasonServiceUnavailable)
		result.retrying = true
		return result
	}
	for _, row := range occupied {
		switch {
		case row.Kind == OccupancyKindOffRoad:
			result.reasons = appendOnce(result.reasons, SwapReasonOffRoad)
		case row.Kind == OccupancyKindBooking && row.SourceID == b.ID.String():
		default:
			result.reasons = appendOnce(result.reasons, SwapReasonOccupied)
		}
	}
	if !target.DocumentsValidThrough(b.OccupiedEnd) {
		result.reasons = append(result.reasons, SwapReasonDocuments)
	}
	return result
}

func appendOnce(list []string, value string) []string {
	for _, existing := range list {
		if existing == value {
			return list
		}
	}
	return append(list, value)
}

// swapIneligible is contract A's 422.
func swapIneligible(reasons []string) *domain.Error {
	return domain.Errorf(domain.CodeSwapIneligible, "this vehicle swap cannot be offered").
		WithDetails(map[string]any{"reasons": reasons})
}

// ---------------------------------------------------------------------------
// Route 7: the fleet proposes.
// ---------------------------------------------------------------------------

// FleetSwapProposal is route 7's body (MpFleetVehicleSwapRequestSchema).
type FleetSwapProposal struct {
	ToVehicleID        string `json:"toVehicleId"`
	RequestedByStaffID string `json:"requestedByStaffId"`
}

// FleetSwapProposed is route 7's 201 (MpFleetVehicleSwapCreatedSchema).
type FleetSwapProposed struct {
	SwapID string `json:"swapId"`
	Status string `json:"status"`
}

// ProposeVehicleSwap is contract A route 7: a fleet proposes moving the
// booking behind an opaque block to another vehicle. Nothing changes for
// the rider until the driver accepts, the server revalidates and the rider
// consents.
func (s *Service) ProposeVehicleSwap(ctx context.Context, blockID uuid.UUID, body FleetSwapProposal, idempotencyKey string) (*FleetSwapProposed, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	body.ToVehicleID = strings.TrimSpace(body.ToVehicleID)
	body.RequestedByStaffID = strings.TrimSpace(body.RequestedByStaffID)
	if body.ToVehicleID == "" || body.RequestedByStaffID == "" || len(body.ToVehicleID) > 128 || len(body.RequestedByStaffID) > 128 {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "toVehicleId and requestedByStaffId are required")
	}
	replay, err := s.lookupFleetIdempotent(ctx, s.deps.Store.Pool(), scopeFleetSwapPropose, idempotencyKey, fleetIdemBody(blockID.String(), body))
	if err != nil {
		return nil, 0, err
	}
	if replay != nil {
		var stored FleetSwapProposed
		if err := decodeJSON(replay.Response, &stored); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &stored, replay.StatusCode, nil
	}
	b, err := s.deps.Store.BookingByBlockID(ctx, s.deps.Store.Pool(), blockID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that block does not exist")
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if !s.flagOn(ctx, cityconfig.FlagMarketplaceBookingVehicleSwaps, b.DriverID.String(), b.CityID) {
		return nil, 0, swapIneligible([]string{SwapReasonNotEnabled})
	}
	now := s.now()
	expiresAt := riskDeadlineFor(b, s.bookingRiskLead(ctx, b.CityID), now)
	if b.Risk == machine.MpRiskAtRisk && b.RiskDeadline != nil {
		expiresAt = b.RiskDeadline.UTC()
	}
	switch {
	case b.State == machine.MpBookingHeld:
		return nil, 0, swapIneligible([]string{SwapReasonNotSwappable})
	case !isRiskBookingState(b.State) || !now.Before(expiresAt):
		return nil, 0, swapIneligible([]string{SwapReasonNotSwappable})
	case b.VehicleID != nil && *b.VehicleID == body.ToVehicleID:
		return nil, 0, swapIneligible([]string{SwapReasonSameVehicle})
	}
	if live, err := s.deps.Store.LiveSwapForBooking(ctx, s.deps.Store.Pool(), b.ID); err == nil && live != nil {
		return nil, 0, swapIneligible([]string{SwapReasonAlreadyOpen})
	} else if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, 0, asDomainError(err)
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), b.RequestID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	check := s.checkSwapTarget(ctx, b, request.VehicleClass, body.ToVehicleID)
	if len(check.reasons) > 0 {
		return nil, 0, swapIneligible(check.reasons)
	}
	swap := &VehicleSwap{
		ID:                 uuid.New(),
		BookingID:          b.ID,
		CityID:             b.CityID,
		DriverID:           b.DriverID,
		RequesterID:        b.RequesterID,
		FromVehicleID:      b.VehicleID,
		ToVehicleID:        body.ToVehicleID,
		RequestedByStaffID: body.RequestedByStaffID,
		State:              machine.MpSwapProposed,
		Version:            1,
		ToClasses:          check.target.Classes,
		ToCapacity:         &check.target.Capacity,
		FleetID:            &check.target.FleetID,
		ExpiresAt:          expiresAt,
		CreatedAt:          now,
	}
	if check.from != nil {
		swap.FromClasses = check.from.Classes
		capacity := check.from.Capacity
		swap.FromCapacity = &capacity
	} else if b.VehicleClass != nil {
		swap.FromClasses = []string{*b.VehicleClass}
		swap.FromCapacity = b.VehicleCapacity
	}
	vehicles := []string{body.ToVehicleID}
	if b.VehicleID != nil {
		vehicles = append(vehicles, *b.VehicleID)
	}
	var result *FleetSwapProposed
	var replayed *IdempotentResult
	err = s.withBookingLocked(ctx, b.ID, vehicles, func(tx pgx.Tx, locked *AdvanceBooking) error {
		if replayed, err = s.lookupFleetIdempotent(ctx, tx, scopeFleetSwapPropose, idempotencyKey, fleetIdemBody(blockID.String(), body)); err != nil || replayed != nil {
			return err
		}
		if !isRiskBookingState(locked.State) || locked.State == machine.MpBookingHeld ||
			!sameVehicle(locked.VehicleID, b.VehicleID) {
			return swapIneligible([]string{SwapReasonNotSwappable})
		}
		if err := s.deps.Store.InsertSwap(ctx, tx, swap); err != nil {
			if errors.Is(err, errSwapAlreadyLive) {
				return swapIneligible([]string{SwapReasonAlreadyOpen})
			}
			return err
		}
		if err := s.writeSwapEvent(ctx, tx, swap, "mp.vehicle_swap.proposed", "fleet", "fleet-service", now, false); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: body.RequestedByStaffID, ActorRole: "fleet_staff", Action: "mp.vehicle_swap.proposed",
			SubjectType: subjectVehicleSwap, SubjectID: swap.ID.String(),
			After: map[string]any{
				"bookingId": b.ID.String(), "fromVehicleId": b.VehicleID, "toVehicleId": body.ToVehicleID,
				"expiresAt": expiresAt.Format(time.RFC3339),
			},
			Reason: "a fleet proposed a vehicle swap on an advance booking; the driver decides, then the rider consents",
		}); err != nil {
			return err
		}
		result = &FleetSwapProposed{SwapID: swap.ID.String(), Status: machine.MpSwapProposed}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeFleetSwapPropose, fleetServiceActorID, idempotencyKey,
			fleetIdemBody(blockID.String(), body), 201, result)
	})
	if err != nil {
		return nil, 0, asFleetError(err)
	}
	if replayed != nil {
		var stored FleetSwapProposed
		if err := decodeJSON(replayed.Response, &stored); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &stored, replayed.StatusCode, nil
	}
	return result, 201, nil
}

func sameVehicle(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// writeSwapEvent writes one mp.vehicle_swap.* row. The driver is always an
// audience; the rider only once their consent is asked for (and on the
// outcome of that consent).
func (s *Service) writeSwapEvent(ctx context.Context, tx pgx.Tx, w *VehicleSwap, name, actorType, actorID string, now time.Time, riderAudience bool) error {
	payload := map[string]any{
		"swapId":        w.ID.String(),
		"bookingId":     w.BookingID.String(),
		"driverId":      w.DriverID.String(),
		"state":         w.State,
		"fromVehicleId": w.FromVehicleID,
		"toVehicleId":   w.ToVehicleID,
		"expiresAt":     w.ExpiresAt.Format(time.RFC3339),
		"fareChanged":   false,
	}
	audience := []string{viewerDriver}
	if riderAudience {
		payload["requesterId"] = w.RequesterID.String()
		audience = append(audience, viewerRider)
	}
	payload["audience"] = audience
	if len(w.FailureReasons) > 0 {
		payload["reasons"] = w.FailureReasons
	}
	return writeEvent(ctx, tx, Event{
		Name:           name,
		AggregateType:  subjectVehicleSwap,
		AggregateID:    w.ID.String(),
		ToVersion:      w.Version,
		CityID:         w.CityID,
		ActorType:      actorType,
		ActorID:        actorID,
		IdempotencyKey: eventKey(name, w.ID.String(), itoa(w.Version)),
		OccurredAt:     now,
		Payload:        payload,
	})
}

// ---------------------------------------------------------------------------
// The driver decides.
// ---------------------------------------------------------------------------

// swapForParty reads a swap on a booking its party may see.
func (s *Service) swapForParty(ctx context.Context, actor Actor, bookingID, swapID uuid.UUID) (*AdvanceBooking, *VehicleSwap, string, error) {
	b, viewer, err := s.bookingForParty(ctx, actor, bookingID)
	if err != nil {
		return nil, nil, "", err
	}
	swap, err := s.deps.Store.SwapByID(ctx, s.deps.Store.Pool(), swapID)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && swap.BookingID != b.ID) {
		return nil, nil, "", domain.Errorf(domain.CodeNotFound, "that change does not exist on this booking")
	}
	if err != nil {
		return nil, nil, "", asDomainError(err)
	}
	return b, swap, viewer, nil
}

// DecideVehicleSwap is the booked driver accepting or declining a fleet's
// swap proposal, parked. Accepting starts the server's revalidation at once;
// declining keeps the original vehicle (the booking stays at risk if its
// blocker remains).
func (s *Service) DecideVehicleSwap(ctx context.Context, actor Actor, bookingID, swapID uuid.UUID, accept bool, idempotencyKey string) (*AdvanceBookingView, int, error) {
	if !actor.IsDriver() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only the booked driver decides on a vehicle swap")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	b, swap, _, err := s.swapForParty(ctx, actor, bookingID, swapID)
	if err != nil {
		return nil, 0, err
	}
	body := map[string]any{"bookingId": bookingID.String(), "swapId": swapID.String(), "accept": accept}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeSwapDriverDecide, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		return bookingReplay(replay)
	}
	now := s.now()
	if swap.State != machine.MpSwapProposed || !now.Before(swap.ExpiresAt) {
		return nil, 0, domain.Errorf(domain.CodeConflict, "this vehicle change can no longer be decided").
			WithDetails(map[string]any{"state": swap.State})
	}
	if err := s.requireDriverParked(ctx, actor, b.CityID, "review a vehicle change once you are safely parked",
		map[string]any{"swapId": swapID.String()}); err != nil {
		return nil, 0, err
	}
	var view *AdvanceBookingView
	var replayed *IdempotentResult
	vehicles := []string{swap.ToVehicleID}
	if swap.FromVehicleID != nil {
		vehicles = append(vehicles, *swap.FromVehicleID)
	}
	err = s.withBookingLocked(ctx, b.ID, vehicles, func(tx pgx.Tx, locked *AdvanceBooking) error {
		// Under the booking lock: a concurrent retry of this same key that
		// committed first is replayed, not refused.
		var err error
		if replayed, err = s.deps.Store.LookupIdempotent(ctx, tx, scopeSwapDriverDecide, actor.UserID, idempotencyKey, body); err != nil || replayed != nil {
			return err
		}
		lockedSwap, err := s.deps.Store.SwapForUpdate(ctx, tx, swap.ID)
		if err != nil {
			return err
		}
		if lockedSwap.State != machine.MpSwapProposed || !now.Before(lockedSwap.ExpiresAt) {
			return domain.Errorf(domain.CodeConflict, "this vehicle change can no longer be decided").
				WithDetails(map[string]any{"state": lockedSwap.State})
		}
		if accept {
			accepted, err := s.deps.Store.TransitionSwap(ctx, tx, lockedSwap, machine.MpSwapDriverAccepted, SwapUpdate{DriverDecidedAt: &now})
			if err != nil {
				return err
			}
			if err := s.writeSwapEvent(ctx, tx, accepted, "mp.vehicle_swap.driver_accepted", "driver", actor.UserID.String(), now, false); err != nil {
				return err
			}
			// The server's revalidation starts now; its answer is written
			// after this commit (fleet-service is never called inside a
			// transaction), and the sweep retries it if it cannot finish.
			if _, err := s.deps.Store.TransitionSwap(ctx, tx, accepted, machine.MpSwapRevalidating, SwapUpdate{}); err != nil {
				return err
			}
		} else {
			declined, err := s.deps.Store.TransitionSwap(ctx, tx, lockedSwap, machine.MpSwapDriverDeclined, SwapUpdate{DriverDecidedAt: &now})
			if err != nil {
				return err
			}
			if err := s.writeSwapEvent(ctx, tx, declined, "mp.vehicle_swap.driver_declined", "driver", actor.UserID.String(), now, false); err != nil {
				return err
			}
		}
		decision := "declined"
		if accept {
			decision = "accepted"
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role, Action: "mp.vehicle_swap.driver_" + decision,
			SubjectType: subjectVehicleSwap, SubjectID: swap.ID.String(),
			Before: map[string]any{"state": lockedSwap.State},
			After:  map[string]any{"decision": decision, "bookingId": locked.ID.String()},
			Reason: "the booked driver decided on a fleet's vehicle swap, parked",
		}); err != nil {
			return err
		}
		view = bookingViewOf(locked, nil, "", viewerDriver)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeSwapDriverDecide, actor.UserID, idempotencyKey, body, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replayed != nil {
		return bookingReplay(replayed)
	}
	if accept {
		if err := s.revalidateSwap(ctx, swap.ID); err != nil {
			s.deps.Logger.Warn().Err(err).Str("swap_id", swap.ID.String()).Msg("vehicle swap revalidation paused; the sweep retries it")
		}
	}
	if current, err := s.deps.Store.BookingByID(ctx, s.deps.Store.Pool(), b.ID); err == nil {
		view = s.bookingView(ctx, current, viewerDriver)
	}
	return view, 200, nil
}

// revalidateSwap is the server's check between the driver's acceptance and
// the rider's consent: the target must still be eligible for the booking.
// Eligible → rider_consent_pending (the rider is asked); ineligible →
// revalidation_failed (the original vehicle stays); fleet-service silent →
// still revalidating, retried by the sweep until the swap expires.
func (s *Service) revalidateSwap(ctx context.Context, swapID uuid.UUID) error {
	swap, err := s.deps.Store.SwapByID(ctx, s.deps.Store.Pool(), swapID)
	if err != nil {
		return err
	}
	if swap.State != machine.MpSwapRevalidating && swap.State != machine.MpSwapDriverAccepted {
		return nil
	}
	b, err := s.deps.Store.BookingByID(ctx, s.deps.Store.Pool(), swap.BookingID)
	if err != nil {
		return err
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), b.RequestID)
	if err != nil {
		return err
	}
	check := s.checkSwapTarget(ctx, b, request.VehicleClass, swap.ToVehicleID)
	now := s.now()
	vehicles := []string{swap.ToVehicleID}
	if swap.FromVehicleID != nil {
		vehicles = append(vehicles, *swap.FromVehicleID)
	}
	return s.withBookingLocked(ctx, b.ID, vehicles, func(tx pgx.Tx, locked *AdvanceBooking) error {
		lockedSwap, err := s.deps.Store.SwapForUpdate(ctx, tx, swap.ID)
		if err != nil {
			return err
		}
		if lockedSwap.State == machine.MpSwapDriverAccepted {
			if lockedSwap, err = s.deps.Store.TransitionSwap(ctx, tx, lockedSwap, machine.MpSwapRevalidating, SwapUpdate{}); err != nil {
				return err
			}
		}
		if lockedSwap.State != machine.MpSwapRevalidating {
			return nil
		}
		if check.retrying {
			retry := now.Add(swapRetryDelay)
			_, err := s.deps.Store.TransitionSwap(ctx, tx, lockedSwap, lockedSwap.State, SwapUpdate{NextAttemptAt: &retry, CountAttempt: true})
			return err
		}
		reasons := check.reasons
		if !isRiskBookingState(locked.State) || !sameVehicle(locked.VehicleID, lockedSwap.FromVehicleID) {
			reasons = appendOnce(reasons, SwapReasonNotSwappable)
		}
		if len(reasons) > 0 {
			failed, err := s.deps.Store.TransitionSwap(ctx, tx, lockedSwap, machine.MpSwapRevalidationFailed, SwapUpdate{
				FailureReasons: reasons, RevalidatedAt: &now,
			})
			if err != nil {
				return err
			}
			return s.writeSwapEvent(ctx, tx, failed, "mp.vehicle_swap.revalidation_failed", "system", "ride-service", now, false)
		}
		capacity := check.target.Capacity
		fleetID := check.target.FleetID
		pending, err := s.deps.Store.TransitionSwap(ctx, tx, lockedSwap, machine.MpSwapRiderConsent, SwapUpdate{
			RevalidatedAt: &now, ToClasses: check.target.Classes, ToCapacity: &capacity, FleetID: &fleetID,
		})
		if err != nil {
			return err
		}
		// The rider is asked now: "Confirm new vehicle" or cancel for free.
		return s.writeSwapEvent(ctx, tx, pending, "mp.vehicle_swap.rider_consent_requested", "system", "ride-service", now, true)
	})
}

// ---------------------------------------------------------------------------
// The rider consents (D1).
// ---------------------------------------------------------------------------

// DecideBookingChange is the rider's answer to a revalidated vehicle change:
// accept applies it (vehicle and occupancy moved atomically; fare
// unchanged; commission never charged again); decline keeps the original
// vehicle. Nothing changes unless the rider accepts.
func (s *Service) DecideBookingChange(ctx context.Context, actor Actor, bookingID, changeID uuid.UUID, accept bool, idempotencyKey string) (*AdvanceBookingView, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only the rider decides on a change to their booking")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	b, swap, _, err := s.swapForParty(ctx, actor, bookingID, changeID)
	if err != nil {
		return nil, 0, err
	}
	body := map[string]any{"bookingId": bookingID.String(), "changeId": changeID.String(), "accept": accept}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeSwapRiderDecide, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		return bookingReplay(replay)
	}
	now := s.now()
	vehicles := []string{swap.ToVehicleID}
	if swap.FromVehicleID != nil {
		vehicles = append(vehicles, *swap.FromVehicleID)
	}
	var refusal *domain.Error
	var view *AdvanceBookingView
	var replayed *IdempotentResult
	err = s.withBookingLocked(ctx, b.ID, vehicles, func(tx pgx.Tx, locked *AdvanceBooking) error {
		// Under the booking lock: a concurrent retry of this same key that
		// committed first is replayed, not refused.
		var err error
		if replayed, err = s.deps.Store.LookupIdempotent(ctx, tx, scopeSwapRiderDecide, actor.UserID, idempotencyKey, body); err != nil || replayed != nil {
			return err
		}
		lockedSwap, err := s.deps.Store.SwapForUpdate(ctx, tx, swap.ID)
		if err != nil {
			return err
		}
		if lockedSwap.State != machine.MpSwapRiderConsent || !now.Before(lockedSwap.ExpiresAt) {
			return domain.Errorf(domain.CodeConflict, "this change is no longer waiting for your answer").
				WithDetails(map[string]any{"state": lockedSwap.State})
		}
		if !accept {
			declined, err := s.deps.Store.TransitionSwap(ctx, tx, lockedSwap, machine.MpSwapRiderDeclined, SwapUpdate{RiderDecidedAt: &now})
			if err != nil {
				return err
			}
			if err := s.writeSwapEvent(ctx, tx, declined, "mp.vehicle_swap.rider_declined", "rider", actor.UserID.String(), now, true); err != nil {
				return err
			}
			if err := writeAudit(ctx, tx, AuditRecord{
				ActorID: actor.UserID.String(), ActorRole: actor.Role, Action: "mp.vehicle_swap.rider_declined",
				SubjectType: subjectVehicleSwap, SubjectID: declined.ID.String(),
				Before: map[string]any{"state": lockedSwap.State}, After: map[string]any{"state": declined.State},
				Reason: "the rider kept the original vehicle; nothing changed",
			}); err != nil {
				return err
			}
			view = bookingViewOf(locked, nil, "", viewerRider)
			return s.deps.Store.SaveIdempotent(ctx, tx, scopeSwapRiderDecide, actor.UserID, idempotencyKey, body, 200, view)
		}
		applied, reasons, err := s.applySwap(ctx, tx, locked, lockedSwap, actor, now)
		if err != nil {
			return err
		}
		if len(reasons) > 0 {
			// Committed as a failed revalidation — the refusal is carried
			// out of the transaction so the failure record survives.
			refusal = domain.Errorf(domain.CodeConflict,
				"the new vehicle is no longer available, so your booking keeps its original vehicle").
				WithDetails(map[string]any{"reasons": reasons})
			return nil
		}
		view = bookingViewOf(applied, nil, "", viewerRider)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeSwapRiderDecide, actor.UserID, idempotencyKey, body, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replayed != nil {
		return bookingReplay(replayed)
	}
	if refusal != nil {
		return nil, 0, refusal
	}
	if current, err := s.deps.Store.BookingByID(ctx, s.deps.Store.Pool(), b.ID); err == nil {
		view = s.bookingView(ctx, current, viewerRider)
	}
	return view, 200, nil
}

// applySwap moves the booking's vehicle_id and its occupancy row to the
// target atomically, under the vehicle exclusion constraints. A target no
// longer free (or now off-road) fails the swap instead — recorded, with the
// original vehicle kept. Every blocker on the booking clears: its vehicle
// is a different one now (the next revalidation re-checks the new one).
func (s *Service) applySwap(ctx context.Context, tx pgx.Tx, b *AdvanceBooking, swap *VehicleSwap, actor Actor, now time.Time) (*AdvanceBooking, []string, error) {
	var reasons []string
	if !isRiskBookingState(b.State) || !sameVehicle(b.VehicleID, swap.FromVehicleID) {
		reasons = append(reasons, SwapReasonNotSwappable)
	}
	end := b.OccupiedEnd
	offRoad, err := s.deps.Store.OverlappingOccupancy(ctx, tx, swap.ToVehicleID, []string{OccupancyKindOffRoad}, b.OccupiedStart, &end)
	if err != nil {
		return nil, nil, err
	}
	if len(offRoad) > 0 {
		reasons = append(reasons, SwapReasonOffRoad)
	}
	var moved *AdvanceBooking
	var occupancy *VehicleOccupancy
	if len(reasons) == 0 {
		err := s.inSavepoint(ctx, tx, func(sp pgx.Tx) error {
			next := now.Add(vehicleRecheckInterval)
			var class *string
			if len(swap.ToClasses) > 0 {
				first := swap.ToClasses[0]
				class = &first
			}
			updated, err := scanBooking(sp.QueryRow(ctx, `
				UPDATE mp.advance_bookings SET
					vehicle_id = $3, vehicle_source = 'swap', vehicle_resolution = 'resolved',
					vehicle_class = $4, vehicle_capacity = $5, next_vehicle_check_at = $6,
					version = version + 1, updated_at = now()
				WHERE id = $1 AND version = $2
				RETURNING `+bookingColumns, b.ID, b.Version, swap.ToVehicleID, class, swap.ToCapacity, next))
			if err != nil {
				if isCalendarExclusion(err) {
					return errOccupancyConflict
				}
				return err
			}
			moved = updated
			if occupancy, err = s.deps.Store.MoveBookingOccupancy(ctx, sp, b.ID, swap.ToVehicleID); err != nil {
				return err
			}
			if occupancy == nil {
				// The booking had no vehicle row yet (its vehicle was never
				// known): it gets one on the target now.
				occupancy = bookingVehicleOccupancy(moved)
				occupancy.CreatedAt = now
				return s.deps.Store.InsertOccupancy(ctx, sp, occupancy)
			}
			return nil
		})
		if errors.Is(err, errOccupancyConflict) {
			reasons = append(reasons, SwapReasonOccupied)
		} else if err != nil {
			return nil, nil, err
		}
	}
	if len(reasons) > 0 {
		failed, err := s.deps.Store.TransitionSwap(ctx, tx, swap, machine.MpSwapRevalidationFailed, SwapUpdate{
			FailureReasons: reasons, RiderDecidedAt: &now,
		})
		if err != nil {
			return nil, nil, err
		}
		if err := s.writeSwapEvent(ctx, tx, failed, "mp.vehicle_swap.revalidation_failed", "system", "ride-service", now, true); err != nil {
			return nil, nil, err
		}
		return b, reasons, nil
	}
	applied, err := s.deps.Store.TransitionSwap(ctx, tx, swap, machine.MpSwapApplied, SwapUpdate{RiderDecidedAt: &now, AppliedAt: &now})
	if err != nil {
		return nil, nil, err
	}
	if err := s.writeSwapEvent(ctx, tx, applied, "mp.vehicle_swap.applied", "rider", actor.UserID.String(), now, true); err != nil {
		return nil, nil, err
	}
	if err := writeOccupancyEvent(ctx, tx, occupancy, "vehicle_occupancy.moved", "rider", actor.UserID.String(), now,
		"an applied, rider-consented vehicle swap moved the booking's occupancy",
		map[string]any{"blockId": moved.BlockID.String(), "fromVehicleId": swap.FromVehicleID, "swapId": swap.ID.String()}); err != nil {
		return nil, nil, err
	}
	if err := writeAudit(ctx, tx, AuditRecord{
		ActorID: actor.UserID.String(), ActorRole: actor.Role, Action: "mp.vehicle_swap.applied",
		SubjectType: subjectVehicleSwap, SubjectID: applied.ID.String(),
		Before: map[string]any{"vehicleId": swap.FromVehicleID},
		After: map[string]any{
			"vehicleId": swap.ToVehicleID, "bookingId": b.ID.String(),
			// The fare is unchanged and the 10% was captured once at the
			// advance award: no second commission, no adjustment.
			"fareMinor": b.FareMinor, "currency": b.Currency, "fareChanged": false, "commissionChargedAgain": false,
		},
		Reason: "the rider consented to the driver-accepted, revalidated vehicle change",
	}); err != nil {
		return nil, nil, err
	}
	moved, err = s.clearBookingRisk(ctx, tx, moved, "", "", "vehicle_swapped", "rider", actor.UserID.String(), now)
	if err != nil {
		return nil, nil, err
	}
	return moved, nil, nil
}

// ---------------------------------------------------------------------------
// Ending bookings, the sweep, and the views.
// ---------------------------------------------------------------------------

// settleEndedBookingFleetState runs inside endBooking's transaction: a live
// swap is cancelled (the original vehicle stays with the ended booking), and
// the risk overlay resolves — or lapses, when the deadline failed it.
func (s *Service) settleEndedBookingFleetState(ctx context.Context, tx pgx.Tx, b *AdvanceBooking, end bookingEnd, now time.Time) (*AdvanceBooking, error) {
	live, err := s.deps.Store.LiveSwapForBooking(ctx, tx, b.ID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, err
	}
	if live != nil {
		cancelled, err := s.deps.Store.TransitionSwap(ctx, tx, live, machine.MpSwapCancelled, SwapUpdate{})
		if err != nil {
			return nil, err
		}
		if err := s.writeSwapEvent(ctx, tx, cancelled, "mp.vehicle_swap.cancelled", end.actorType, end.actorID, now, false); err != nil {
			return nil, err
		}
	}
	if b.Risk != machine.MpRiskAtRisk {
		return b, nil
	}
	reason, to := "booking_ended", machine.MpRiskOK
	if end.riskLapsed {
		reason, to = "decision_deadline_passed", machine.MpRiskLapsed
	}
	if _, err := s.deps.Store.ClearBlockers(ctx, tx, b.ID, "", "", reason, now); err != nil {
		return nil, err
	}
	return s.deps.Store.SetBookingRisk(ctx, tx, b, to, nil, now)
}

// sweepVehicleSwaps expires live swaps past their deadline (keeping the
// original vehicle) and retries revalidations fleet-service could not
// answer.
func (s *Service) sweepVehicleSwaps(ctx context.Context, now time.Time) {
	due, err := s.deps.Store.SwapsDue(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list vehicle swaps due")
		return
	}
	for _, swap := range due {
		if now.Before(swap.ExpiresAt) {
			if err := s.revalidateSwap(ctx, swap.ID); err != nil {
				s.deps.Logger.Warn().Err(err).Str("swap_id", swap.ID.String()).Msg("vehicle swap revalidation retry failed")
			}
			continue
		}
		vehicles := []string{swap.ToVehicleID}
		if swap.FromVehicleID != nil {
			vehicles = append(vehicles, *swap.FromVehicleID)
		}
		if err := s.withBookingLocked(ctx, swap.BookingID, vehicles, func(tx pgx.Tx, _ *AdvanceBooking) error {
			locked, err := s.deps.Store.SwapForUpdate(ctx, tx, swap.ID)
			if err != nil || !machine.IsMpSwapLive(locked.State) || now.Before(locked.ExpiresAt) {
				return err
			}
			expired, err := s.deps.Store.TransitionSwap(ctx, tx, locked, machine.MpSwapExpired, SwapUpdate{})
			if err != nil {
				return err
			}
			return s.writeSwapEvent(ctx, tx, expired, "mp.vehicle_swap.expired", "system", "ride-service", now,
				locked.State == machine.MpSwapRiderConsent)
		}); err != nil {
			s.deps.Logger.Error().Err(err).Str("swap_id", swap.ID.String()).Msg("failed to expire a vehicle swap")
		}
	}
}

// BookingVehicleView is MpBookingVehicleSchema: a server-written label only.
type BookingVehicleView struct {
	Label    string   `json:"label"`
	Classes  []string `json:"classes"`
	Capacity *int     `json:"capacity"`
}

// vehicleCardOf phrases a vehicle for the booking's parties.
func vehicleCardOf(classes []string, capacity *int) *BookingVehicleView {
	names := make([]string, 0, len(classes))
	for _, class := range classes {
		if class == "" {
			continue
		}
		names = append(names, strings.ToUpper(class[:1])+class[1:])
	}
	sort.Strings(names)
	label := "Vehicle"
	if len(names) > 0 {
		label = strings.Join(names, " / ")
	}
	if capacity != nil {
		label += " · " + itoa(*capacity) + " seats"
	}
	out := &BookingVehicleView{Label: label, Classes: append([]string{}, classes...), Capacity: capacity}
	return out
}

// BookingRiskView is MpBookingRiskViewSchema (driver view only).
type BookingRiskView struct {
	State            string     `json:"state"`
	DecisionDeadline *time.Time `json:"decisionDeadline"`
	Reasons          []string   `json:"reasons"`
	Message          string     `json:"message"`
}

// BookingPendingChangeView is MpBookingPendingChangeSchema (rider view, D1).
type BookingPendingChangeView struct {
	ChangeID      string              `json:"changeId"`
	Kind          string              `json:"kind"`
	SameDriver    bool                `json:"sameDriver"`
	From          *BookingVehicleView `json:"from"`
	To            *BookingVehicleView `json:"to"`
	FareMinor     Money               `json:"fareMinor"`
	FareUnchanged bool                `json:"fareUnchanged"`
	ExpiresAt     time.Time           `json:"expiresAt"`
	Notice        string              `json:"notice"`
}

// BookingSwapOfferView is MpBookingVehicleSwapOfferSchema (driver view).
type BookingSwapOfferView struct {
	SwapID    string              `json:"swapId"`
	State     string              `json:"state"`
	From      *BookingVehicleView `json:"from"`
	To        *BookingVehicleView `json:"to"`
	ExpiresAt time.Time           `json:"expiresAt"`
	Notice    string              `json:"notice"`
}

// pendingChangeNotice is D1's promise.
const pendingChangeNotice = "Different vehicle, same driver. Your fare is unchanged. Nothing changes unless you confirm, and cancelling is free."

// withFleetState fills the fleet-calendar fields onto a booking view read
// outside a transaction: the vehicle (both parties), the risk overlay and a
// swap awaiting the driver (driver view), a change awaiting the rider's
// consent (rider view). Riders never see why a booking is at risk.
func (s *Service) withFleetState(ctx context.Context, view *AdvanceBookingView, b *AdvanceBooking, viewer string) *AdvanceBookingView {
	if view == nil || b == nil {
		return view
	}
	if b.VehicleID != nil {
		var classes []string
		if b.VehicleClass != nil {
			classes = []string{*b.VehicleClass}
		}
		view.Vehicle = vehicleCardOf(classes, b.VehicleCapacity)
	}
	if viewer == viewerDriver && b.Risk == machine.MpRiskAtRisk {
		reasons := []string{}
		if open, err := s.deps.Store.OpenBlockers(ctx, s.deps.Store.Pool(), b.ID); err == nil {
			for _, blocker := range open {
				reasons = appendOnce(reasons, blocker.Kind)
			}
		}
		view.Risk = &BookingRiskView{
			State: b.Risk, DecisionDeadline: b.RiskDeadline, Reasons: reasons,
			Message: riskMessage(reasons, b.RiskDeadline),
		}
	}
	live, err := s.deps.Store.LiveSwapForBooking(ctx, s.deps.Store.Pool(), b.ID)
	if err != nil || live == nil {
		return view
	}
	from := (*BookingVehicleView)(nil)
	if live.FromVehicleID != nil {
		from = vehicleCardOf(live.FromClasses, live.FromCapacity)
	}
	to := vehicleCardOf(live.ToClasses, live.ToCapacity)
	switch {
	case viewer == viewerRider && live.State == machine.MpSwapRiderConsent:
		view.PendingChange = &BookingPendingChangeView{
			ChangeID: live.ID.String(), Kind: "vehicle_swap", SameDriver: true,
			From: from, To: to, FareMinor: money(b.FareMinor, b.Currency), FareUnchanged: true,
			ExpiresAt: live.ExpiresAt, Notice: pendingChangeNotice,
		}
	case viewer == viewerDriver:
		notice := "Your fleet proposes moving this booking to another vehicle. The fare and your commission are unchanged. If you accept, UBI checks the vehicle and then the rider confirms; nothing changes before that."
		if live.State != machine.MpSwapProposed {
			notice = "You accepted the vehicle change. UBI is checking the vehicle and then asks the rider to confirm; nothing changes before that."
		}
		view.VehicleSwap = &BookingSwapOfferView{
			SwapID: live.ID.String(), State: live.State, From: from, To: to,
			ExpiresAt: live.ExpiresAt, Notice: notice,
		}
	}
	return view
}
