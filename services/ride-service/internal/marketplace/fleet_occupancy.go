package marketplace

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// THE SHARED VEHICLE OCCUPANCY LEDGER (A05 fleet calendar, decisions
// correction 3).
//
// Postgres cannot enforce one exclusion constraint across a fleet's
// maintenance blocks and ride-service's advance bookings, so everything that
// occupies a vehicle for an interval is written to ONE table,
// mp.vehicle_occupancy, whose EXCLUDE USING gist (vehicle_id WITH =,
// occupied WITH &&) covers every active booking and maintenance row:
//
//   - kind booking: an advance booking that carries a vehicle. Written in the
//     SAME transaction as the booking (award.go), released in the same
//     transaction as the booking leaving its occupying states
//     (Store.TransitionBooking), moved only by an applied, rider-consented
//     vehicle swap (fleet_swaps.go). The advance_bookings per-driver and
//     per-vehicle exclusions stay as they were.
//   - kind maintenance: a fleet's planned service, inspection or repair
//     block, recorded through internal contract A (fleet_internal.go). The
//     constraint refuses it over a booking — planned maintenance is never
//     confirmed over a confirmed booking.
//   - kind off_road: an unplanned breakdown report. Deliberately OUTSIDE the
//     constraint: a breakdown is never refused; it moves overlapping bookings
//     to at_risk instead (fleet_risk.go) and is flagged to UBI ops if the
//     vehicle goes online during it.
//
// Every write that reads the ledger before writing it (the award, a
// maintenance block, an off-road report, a swap) takes the vehicle's
// transaction lock first, so "which bookings does this overlap" and "insert"
// never interleave with another writer on the same vehicle; the constraint
// stays the final authority.

// Occupancy kinds (MP_VEHICLE_OCCUPANCY_KINDS).
const (
	OccupancyKindBooking     = "booking"
	OccupancyKindMaintenance = "maintenance"
	OccupancyKindOffRoad     = "off_road"
)

// Maintenance kinds (MP_MAINTENANCE_KINDS): time-based only — no odometer
// feed exists.
var maintenanceKinds = map[string]struct{}{
	"planned_service": {}, "inspection": {}, "repair": {},
}

// How an advance award resolved the booking's vehicle (FL-4).
const (
	// VehicleResolutionNotApplicable: the fleet flag is off for the market,
	// so fleet-service was never asked and the booking carries no vehicle —
	// exactly as before the fleet calendar.
	VehicleResolutionNotApplicable = "not_applicable"
	// VehicleResolutionResolved: fleet-service answered (a vehicle, or "no
	// covering assignment").
	VehicleResolutionResolved = "resolved"
	// VehicleResolutionPending: fleet-service could not answer in time. The
	// award went ahead without a vehicle (it is never blocked on the fleet
	// service); the sweep keeps asking.
	VehicleResolutionPending = "pending"
)

// Where a booking's vehicle came from.
const (
	VehicleSourceFleetAssignment = "fleet_assignment"
	VehicleSourceSwap            = "swap"
)

// vehicleOccupancyExclusion is the ledger's exclusion constraint.
const vehicleOccupancyExclusion = "vehicle_occupancy_no_overlap"

// advisoryVehicleLedger serialises writers of one vehicle's occupancy.
const advisoryVehicleLedger = int32(0x6d70564c) // "mpVL"

// errOccupancyConflict marks a row the ledger's exclusion constraint refused.
var errOccupancyConflict = errors.New("the vehicle is already occupied for that interval")

// VehicleOccupancy is one mp.vehicle_occupancy row.
type VehicleOccupancy struct {
	ID              uuid.UUID
	Kind            string
	SourceID        string
	VehicleID       string
	DriverID        *uuid.UUID
	Start           time.Time
	End             *time.Time // nil: an open-ended off-road report
	State           string
	MaintenanceKind *string
	Version         int
	CreatedAt       time.Time
	UpdatedAt       time.Time
	ReleasedAt      *time.Time
	ReleaseReason   *string
}

// Covers reports whether the occupancy holds the vehicle at an instant.
func (o *VehicleOccupancy) Covers(at time.Time) bool {
	return !at.Before(o.Start) && (o.End == nil || at.Before(*o.End))
}

// Overlaps reports whether the occupancy overlaps [start, end).
func (o *VehicleOccupancy) Overlaps(start, end time.Time) bool {
	return o.Start.Before(end) && (o.End == nil || start.Before(*o.End))
}

const occupancyColumns = `
	id, kind, source_id, vehicle_id, driver_id, lower(occupied),
	CASE WHEN upper_inf(occupied) THEN NULL ELSE upper(occupied) END,
	state, maintenance_kind, version, created_at, updated_at, released_at, release_reason`

func scanOccupancy(row pgx.Row) (*VehicleOccupancy, error) {
	var o VehicleOccupancy
	err := row.Scan(&o.ID, &o.Kind, &o.SourceID, &o.VehicleID, &o.DriverID, &o.Start, &o.End,
		&o.State, &o.MaintenanceKind, &o.Version, &o.CreatedAt, &o.UpdatedAt, &o.ReleasedAt, &o.ReleaseReason)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read vehicle occupancy: %w", err)
	}
	o.Start = o.Start.UTC()
	if o.End != nil {
		end := o.End.UTC()
		o.End = &end
	}
	return &o, nil
}

func (s *Store) occupancyList(ctx context.Context, db DB, query string, args ...any) ([]*VehicleOccupancy, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list vehicle occupancy: %w", err)
	}
	defer rows.Close()
	var out []*VehicleOccupancy
	for rows.Next() {
		o, err := scanOccupancy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// AcquireVehicleLock serialises every ledger writer of one vehicle for the
// rest of the transaction.
func (s *Store) AcquireVehicleLock(ctx context.Context, tx pgx.Tx, vehicleID string) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1, hashtext($2))`, advisoryVehicleLedger, vehicleID); err != nil {
		return fmt.Errorf("failed to take the vehicle ledger lock: %w", err)
	}
	return nil
}

// isOccupancyExclusion reports whether an error is the ledger's exclusion
// constraint saying no.
func isOccupancyExclusion(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23P01" && pgErr.ConstraintName == vehicleOccupancyExclusion
}

// InsertOccupancy writes a new active occupancy row. The exclusion
// constraint is the final authority: a booking or maintenance row that
// overlaps another active one on the same vehicle answers
// errOccupancyConflict.
func (s *Store) InsertOccupancy(ctx context.Context, db DB, o *VehicleOccupancy) error {
	if o.State == "" {
		o.State = machine.MpOccupancyActive
	}
	if o.Version == 0 {
		o.Version = 1
	}
	_, err := db.Exec(ctx, `
		INSERT INTO mp.vehicle_occupancy (
			id, kind, source_id, vehicle_id, driver_id, occupied, state, maintenance_kind, version, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, tstzrange($6, $7, '[)'), $8, $9, $10, $11, $11)`,
		o.ID, o.Kind, o.SourceID, o.VehicleID, o.DriverID, o.Start, o.End, o.State, o.MaintenanceKind, o.Version,
		stampOf(o.CreatedAt))
	if err != nil {
		if isOccupancyExclusion(err) {
			return errOccupancyConflict
		}
		return fmt.Errorf("failed to insert vehicle occupancy: %w", err)
	}
	return nil
}

// OccupancyBySource reads the row one source (a booking, a fleet block) wrote.
func (s *Store) OccupancyBySource(ctx context.Context, db DB, kind, sourceID string) (*VehicleOccupancy, error) {
	return scanOccupancy(db.QueryRow(ctx, `SELECT `+occupancyColumns+`
		FROM mp.vehicle_occupancy WHERE kind = $1 AND source_id = $2`, kind, sourceID))
}

// FleetBlocksBySource reads the fleet-written rows (maintenance, off_road)
// for one fleet block id.
func (s *Store) FleetBlocksBySource(ctx context.Context, db DB, sourceID string) ([]*VehicleOccupancy, error) {
	return s.occupancyList(ctx, db, `SELECT `+occupancyColumns+`
		FROM mp.vehicle_occupancy
		WHERE source_id = $1 AND kind IN ('maintenance', 'off_road')
		ORDER BY created_at ASC`, sourceID)
}

// OverlappingOccupancy lists a vehicle's active rows of the given kinds that
// overlap [start, end) (end nil: open-ended), soonest first.
func (s *Store) OverlappingOccupancy(ctx context.Context, db DB, vehicleID string, kinds []string, start time.Time, end *time.Time) ([]*VehicleOccupancy, error) {
	return s.occupancyList(ctx, db, `SELECT `+occupancyColumns+`
		FROM mp.vehicle_occupancy
		WHERE vehicle_id = $1 AND state = 'active' AND kind = ANY($2) AND occupied && tstzrange($3, $4, '[)')
		ORDER BY lower(occupied) ASC`, vehicleID, kinds, start, end)
}

// OccupancyFrom lists a vehicle's active booking and maintenance rows that
// end after `from`, soonest first — the intervals a next feasible window has
// to fit between.
func (s *Store) OccupancyFrom(ctx context.Context, db DB, vehicleID string, from, until time.Time, limit int) ([]*VehicleOccupancy, error) {
	return s.occupancyList(ctx, db, `SELECT `+occupancyColumns+`
		FROM mp.vehicle_occupancy
		WHERE vehicle_id = $1 AND state = 'active' AND kind IN ('booking', 'maintenance')
			AND upper(occupied) > $2 AND lower(occupied) < $3
		ORDER BY lower(occupied) ASC
		LIMIT $4`, vehicleID, from, until, limit)
}

// ActiveOffRoadAt lists the off-road rows holding any vehicle at an instant.
func (s *Store) ActiveOffRoadAt(ctx context.Context, db DB, at time.Time, limit int) ([]*VehicleOccupancy, error) {
	return s.occupancyList(ctx, db, `SELECT `+occupancyColumns+`
		FROM mp.vehicle_occupancy
		WHERE kind = 'off_road' AND state = 'active' AND occupied @> $1::timestamptz
		ORDER BY created_at ASC
		LIMIT $2`, at, limit)
}

// AnyActiveOffRoadAt reports cheaply whether ANY vehicle is off-road now —
// the gate in front of the go-online / trip-start abuse check.
func (s *Store) AnyActiveOffRoadAt(ctx context.Context, db DB, at time.Time) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM mp.vehicle_occupancy
		WHERE kind = 'off_road' AND state = 'active' AND occupied @> $1::timestamptz)`, at).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check for off-road vehicles: %w", err)
	}
	return exists, nil
}

// ReleaseOccupancyBySource moves one source's active row to released
// (mpVehicleOccupancy active → released), idempotently: a row already
// released, or no row at all, answers nil without writing. The released row
// is returned when THIS call released it.
func (s *Store) ReleaseOccupancyBySource(ctx context.Context, db DB, kind, sourceID, reason string) (*VehicleOccupancy, error) {
	if err := machine.Assert(machine.MpVehicleOccupancy, machine.MpOccupancyActive, machine.MpOccupancyReleased); err != nil {
		return nil, err
	}
	released, err := scanOccupancy(db.QueryRow(ctx, `
		UPDATE mp.vehicle_occupancy
		SET state = 'released', version = version + 1, released_at = now(), release_reason = $3, updated_at = now()
		WHERE kind = $1 AND source_id = $2 AND state = 'active'
		RETURNING `+occupancyColumns, kind, sourceID, reason))
	if errors.Is(err, domain.ErrNotFound) {
		return nil, nil
	}
	return released, err
}

// MoveBookingOccupancy points a booking's active occupancy row at another
// vehicle (an applied swap). The exclusion constraint re-checks the target;
// a collision answers errOccupancyConflict. Nil: the booking had no row.
func (s *Store) MoveBookingOccupancy(ctx context.Context, tx pgx.Tx, bookingID uuid.UUID, toVehicleID string) (*VehicleOccupancy, error) {
	moved, err := scanOccupancy(tx.QueryRow(ctx, `
		UPDATE mp.vehicle_occupancy
		SET vehicle_id = $2, version = version + 1, updated_at = now()
		WHERE kind = 'booking' AND source_id = $1 AND state = 'active'
		RETURNING `+occupancyColumns, bookingID.String(), toVehicleID))
	if errors.Is(err, domain.ErrNotFound) {
		return nil, nil
	}
	if isOccupancyExclusion(err) {
		return nil, errOccupancyConflict
	}
	return moved, err
}

// ---------------------------------------------------------------------------
// The fleet-safe booking projection (FL-6).
// ---------------------------------------------------------------------------

// OccupiedBlock kinds and risk flags (MpOccupiedBlockSchema).
const (
	OccupiedBooked = "booked"
	OccupiedOnTrip = "on_trip"
)

// OccupiedBlock is the ONLY shape of a booking a fleet (or fleet-service)
// ever receives (MpOccupiedBlockSchema, strict). startsAt/endsAt include the
// booking's buffers. There is deliberately no other field — no rider, no
// location, no fare, no request or booking id (BlockID is opaque) — and the
// allowlist test fails if one is ever added.
type OccupiedBlock struct {
	BlockID          string     `json:"blockId"`
	DriverID         string     `json:"driverId"`
	VehicleID        *string    `json:"vehicleId"`
	StartsAt         time.Time  `json:"startsAt"`
	EndsAt           time.Time  `json:"endsAt"`
	Kind             string     `json:"kind"`
	Risk             string     `json:"risk"`
	DecisionDeadline *time.Time `json:"decisionDeadline"`
}

// occupiedBlockOf projects a booking for a fleet.
func occupiedBlockOf(b *AdvanceBooking) OccupiedBlock {
	kind := OccupiedBooked
	if b.State == machine.MpBookingActivated {
		kind = OccupiedOnTrip
	}
	risk := machine.MpRiskOK
	var deadline *time.Time
	if b.Risk == machine.MpRiskAtRisk {
		risk = machine.MpRiskAtRisk
		if b.RiskDeadline != nil {
			at := b.RiskDeadline.UTC()
			deadline = &at
		}
	}
	return OccupiedBlock{
		BlockID:          b.BlockID.String(),
		DriverID:         b.DriverID.String(),
		VehicleID:        b.VehicleID,
		StartsAt:         b.OccupiedStart.UTC(),
		EndsAt:           b.OccupiedEnd.UTC(),
		Kind:             kind,
		Risk:             risk,
		DecisionDeadline: deadline,
	}
}

// BookingsOccupying lists bookings in occupying states whose interval
// overlaps [from, to) and whose vehicle is one of vehicleIDs or whose driver
// is one of driverIDs.
func (s *Store) BookingsOccupying(ctx context.Context, db DB, vehicleIDs []string, driverIDs []uuid.UUID, from, to time.Time, limit int) ([]*AdvanceBooking, error) {
	if vehicleIDs == nil {
		vehicleIDs = []string{}
	}
	if driverIDs == nil {
		driverIDs = []uuid.UUID{}
	}
	return s.bookingList(ctx, db, `
		SELECT `+bookingColumns+` FROM mp.advance_bookings
		WHERE state = ANY($1) AND occupied && tstzrange($2, $3, '[)')
			AND (vehicle_id = ANY($4) OR driver_id = ANY($5))
		ORDER BY lower(occupied) ASC, id ASC
		LIMIT $6`, machine.MpBookingOccupyingStates(), from, to, vehicleIDs, driverIDs, limit)
}

// BookingsOnVehicle lists the bookings in the given states whose vehicle is
// vehicleID and whose interval overlaps [start, end) (end nil: open-ended).
func (s *Store) BookingsOnVehicle(ctx context.Context, db DB, vehicleID string, states []string, start time.Time, end *time.Time) ([]*AdvanceBooking, error) {
	return s.bookingList(ctx, db, `
		SELECT `+bookingColumns+` FROM mp.advance_bookings
		WHERE vehicle_id = $1 AND state = ANY($2) AND occupied && tstzrange($3, $4, '[)')
		ORDER BY lower(occupied) ASC, id ASC`, vehicleID, states, start, end)
}

// BookingByBlockID reads the booking behind an opaque fleet block id.
func (s *Store) BookingByBlockID(ctx context.Context, db DB, blockID uuid.UUID) (*AdvanceBooking, error) {
	return scanBooking(db.QueryRow(ctx, `SELECT `+bookingColumns+` FROM mp.advance_bookings WHERE block_id = $1`, blockID))
}

// bookingVehicleOccupancy is the ledger row an advance booking with a
// vehicle writes in its own transaction.
func bookingVehicleOccupancy(b *AdvanceBooking) *VehicleOccupancy {
	driver := b.DriverID
	end := b.OccupiedEnd
	return &VehicleOccupancy{
		ID:        uuid.New(),
		Kind:      OccupancyKindBooking,
		SourceID:  b.ID.String(),
		VehicleID: *b.VehicleID,
		DriverID:  &driver,
		Start:     b.OccupiedStart,
		End:       &end,
		CreatedAt: b.CreatedAt,
	}
}
