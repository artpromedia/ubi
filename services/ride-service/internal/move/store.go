package move

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

//go:embed schema.sql
var schemaSQL string

// DB is the subset of pgx that a pool and a transaction both satisfy, so every
// query in this package can run inside or outside a transaction unchanged.
type DB interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Store is the ride-service's data access for the `ride` schema. Every state
// change goes through InTx so the row update, the outbox event and the audit
// row commit together or not at all.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore builds the store.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Pool exposes the underlying pool to readers that do not mutate state.
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// Migrate applies the ride schema. Every statement is IF NOT EXISTS, so it is
// idempotent; it runs from tests and from an explicit boot flag, never
// implicitly on every start.
func (s *Store) Migrate(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, schemaSQL); err != nil {
		return fmt.Errorf("failed to apply ride schema: %w", err)
	}
	return nil
}

// InTx runs fn in a transaction, rolling back on any error or panic.
func (s *Store) InTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer func() {
		// A rollback after a successful commit is a no-op; after a panic or an
		// early return it is what stops a half-applied transition being seen.
		_ = tx.Rollback(ctx)
	}()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

// InsertQuote persists a priced, signed quote.
func (s *Store) InsertQuote(ctx context.Context, db DB, quote *domain.Quote) error {
	stops, err := json.Marshal(quote.Stops)
	if err != nil {
		return fmt.Errorf("unserialisable stops: %w", err)
	}
	breakdown, err := json.Marshal(quote.Breakdown)
	if err != nil {
		return fmt.Errorf("unserialisable fare breakdown: %w", err)
	}
	_, err = db.Exec(ctx, `
		INSERT INTO ride.quotes (
			id, city_id, config_version, rider_id, vehicle_class,
			pickup_lat, pickup_lng, pickup_address,
			dropoff_lat, dropoff_lng, dropoff_address,
			stops, distance_meters, duration_seconds,
			fare_minor, currency, breakdown, expires_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
		quote.ID, quote.CityID, quote.ConfigVersion, quote.RiderID, quote.VehicleClass,
		quote.Pickup.Lat, quote.Pickup.Lng, quote.Pickup.Address,
		quote.Dropoff.Lat, quote.Dropoff.Lng, quote.Dropoff.Address,
		stops, quote.DistanceMeters, quote.DurationSeconds,
		quote.FareMinor, quote.Currency, breakdown, quote.ExpiresAt,
	)
	if err != nil {
		return fmt.Errorf("failed to insert quote: %w", err)
	}
	return nil
}

const quoteColumns = `
	id, city_id, config_version, rider_id, vehicle_class,
	pickup_lat, pickup_lng, pickup_address,
	dropoff_lat, dropoff_lng, dropoff_address,
	stops, distance_meters, duration_seconds,
	fare_minor, currency, breakdown, expires_at, consumed_by`

func scanQuote(row pgx.Row) (*domain.Quote, error) {
	var quote domain.Quote
	var stops, breakdown []byte
	err := row.Scan(
		&quote.ID, &quote.CityID, &quote.ConfigVersion, &quote.RiderID, &quote.VehicleClass,
		&quote.Pickup.Lat, &quote.Pickup.Lng, &quote.Pickup.Address,
		&quote.Dropoff.Lat, &quote.Dropoff.Lng, &quote.Dropoff.Address,
		&stops, &quote.DistanceMeters, &quote.DurationSeconds,
		&quote.FareMinor, &quote.Currency, &breakdown, &quote.ExpiresAt, &quote.ConsumedBy,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read quote: %w", err)
	}
	if len(stops) > 0 {
		if err := json.Unmarshal(stops, &quote.Stops); err != nil {
			return nil, fmt.Errorf("quote %s stores unreadable stops: %w", quote.ID, err)
		}
	}
	if len(breakdown) > 0 {
		if err := json.Unmarshal(breakdown, &quote.Breakdown); err != nil {
			return nil, fmt.Errorf("quote %s stores an unreadable breakdown: %w", quote.ID, err)
		}
	}
	quote.ExpiresAt = quote.ExpiresAt.UTC()
	return &quote, nil
}

// Quote reads one quote.
func (s *Store) Quote(ctx context.Context, db DB, id uuid.UUID) (*domain.Quote, error) {
	return scanQuote(db.QueryRow(ctx, `SELECT `+quoteColumns+` FROM ride.quotes WHERE id = $1`, id))
}

// ConsumeQuote marks a quote as spent by a ride. It succeeds exactly once: the
// conditional update is what stops one signed quote paying for two rides.
func (s *Store) ConsumeQuote(ctx context.Context, db DB, quoteID, rideID uuid.UUID) error {
	tag, err := db.Exec(ctx,
		`UPDATE ride.quotes SET consumed_by = $2 WHERE id = $1 AND consumed_by IS NULL`,
		quoteID, rideID)
	if err != nil {
		return fmt.Errorf("failed to consume quote: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.Errorf(domain.CodeConflict, "this quote has already been used for another ride")
	}
	return nil
}

// ---------------------------------------------------------------------------
// Rides
// ---------------------------------------------------------------------------

const rideColumns = `
	id, city_id, config_version, quote_id, rider_id, driver_id,
	state, version, active, vehicle_class, payment_method_id,
	pickup_lat, pickup_lng, pickup_address,
	dropoff_lat, dropoff_lng, dropoff_address,
	quoted_fare_minor, final_fare_minor, wait_fee_minor, currency,
	pin_attempts, pin_locked, pin_verified_at,
	dispatch_ring, dispatch_rounds,
	assigned_at, arrived_at, started_at, completed_at, cancelled_at,
	COALESCE(cancelled_by_role, ''), COALESCE(cancel_reason_code, ''),
	created_at, updated_at`

func scanRide(row pgx.Row) (*domain.Ride, error) {
	var ride domain.Ride
	err := row.Scan(
		&ride.ID, &ride.CityID, &ride.ConfigVersion, &ride.QuoteID, &ride.RiderID, &ride.DriverID,
		&ride.State, &ride.Version, &ride.Active, &ride.VehicleClass, &ride.PaymentMethodID,
		&ride.Pickup.Lat, &ride.Pickup.Lng, &ride.Pickup.Address,
		&ride.Dropoff.Lat, &ride.Dropoff.Lng, &ride.Dropoff.Address,
		&ride.QuotedFareMinor, &ride.FinalFareMinor, &ride.WaitFeeMinor, &ride.Currency,
		&ride.PinAttempts, &ride.PinLocked, &ride.PinVerifiedAt,
		&ride.DispatchRing, &ride.DispatchRounds,
		&ride.AssignedAt, &ride.ArrivedAt, &ride.StartedAt, &ride.CompletedAt, &ride.CancelledAt,
		&ride.CancelledByRole, &ride.CancelReasonCode,
		&ride.CreatedAt, &ride.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read ride: %w", err)
	}
	return &ride, nil
}

// InsertRide writes a new ride together with the hash of its pickup PIN.
func (s *Store) InsertRide(ctx context.Context, db DB, ride *domain.Ride, pinHash []byte) error {
	_, err := db.Exec(ctx, `
		INSERT INTO ride.rides (
			id, city_id, config_version, quote_id, rider_id,
			state, version, active, vehicle_class, payment_method_id,
			pickup_lat, pickup_lng, pickup_address,
			dropoff_lat, dropoff_lng, dropoff_address,
			quoted_fare_minor, currency, pin_hash
		) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
		ride.ID, ride.CityID, ride.ConfigVersion, ride.QuoteID, ride.RiderID,
		ride.State, ride.Version, ride.VehicleClass, ride.PaymentMethodID,
		ride.Pickup.Lat, ride.Pickup.Lng, ride.Pickup.Address,
		ride.Dropoff.Lat, ride.Dropoff.Lng, ride.Dropoff.Address,
		ride.QuotedFareMinor, ride.Currency, pinHash,
	)
	if err != nil {
		return fmt.Errorf("failed to insert ride: %w", err)
	}
	return nil
}

// RideByID reads one ride.
func (s *Store) RideByID(ctx context.Context, db DB, id uuid.UUID) (*domain.Ride, error) {
	return scanRide(db.QueryRow(ctx, `SELECT `+rideColumns+` FROM ride.rides WHERE id = $1`, id))
}

// RideForUpdate reads and locks one ride for the rest of the transaction, so
// two concurrent transitions on the same ride serialise instead of racing.
func (s *Store) RideForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*domain.Ride, error) {
	return scanRide(tx.QueryRow(ctx, `SELECT `+rideColumns+` FROM ride.rides WHERE id = $1 FOR UPDATE`, id))
}

// ActiveRideForRider returns the rider's live ride, or domain.ErrNotFound.
func (s *Store) ActiveRideForRider(ctx context.Context, db DB, riderID uuid.UUID) (*domain.Ride, error) {
	return scanRide(db.QueryRow(ctx,
		`SELECT `+rideColumns+` FROM ride.rides WHERE rider_id = $1 AND active`, riderID))
}

// ActiveRideForDriver returns the driver's live ride, or domain.ErrNotFound.
func (s *Store) ActiveRideForDriver(ctx context.Context, db DB, driverID uuid.UUID) (*domain.Ride, error) {
	return scanRide(db.QueryRow(ctx,
		`SELECT `+rideColumns+` FROM ride.rides WHERE driver_id = $1 AND active`, driverID))
}

// PinHash reads the stored hash of a ride's pickup PIN. The plaintext is never
// stored, so this is all a database reader gets.
func (s *Store) PinHash(ctx context.Context, db DB, rideID uuid.UUID) ([]byte, error) {
	var hash []byte
	err := db.QueryRow(ctx, `SELECT pin_hash FROM ride.rides WHERE id = $1`, rideID).Scan(&hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read PIN hash: %w", err)
	}
	return hash, nil
}

// RideUpdate carries the columns a transition may change alongside the state.
// Every field is a pointer: nil means "leave it as it was", which keeps a
// transition from silently clearing a timestamp it does not know about.
type RideUpdate struct {
	DriverID         *uuid.UUID
	FinalFareMinor   *int64
	WaitFeeMinor     *int64
	PinAttempts      *int
	PinLocked        *bool
	PinVerifiedAt    *time.Time
	DispatchRing     *int
	DispatchRounds   *int
	AssignedAt       *time.Time
	ArrivedAt        *time.Time
	StartedAt        *time.Time
	CompletedAt      *time.Time
	CancelledAt      *time.Time
	CancelledByRole  *string
	CancelReasonCode *string
	// ClearDriver detaches the driver, used when a driver cancels and the ride
	// goes back out to matching.
	ClearDriver bool
}

// Transition moves a ride to a new state.
//
// It refuses anything the rider machine in contracts/state-machines.json does
// not allow, and refuses it before any row is written. The update is guarded by
// the ride's current version, so two concurrent writers cannot both believe
// they made the transition — the loser gets version_conflict.
func (s *Store) Transition(ctx context.Context, tx pgx.Tx, ride *domain.Ride, to string, update RideUpdate) (*domain.Ride, error) {
	if err := machine.Assert(machine.Rider, ride.State, to); err != nil {
		allowed, _ := machine.Allowed(machine.Rider, ride.State)
		return nil, domain.Errorf(domain.CodeIllegalTransition, "a ride cannot move from %s to %s", ride.State, to).
			WithDetails(map[string]any{"from": ride.State, "to": to, "allowed": allowed}).
			Wrap(err)
	}

	active := machine.IsRiderActive(to)
	driverID := ride.DriverID
	if update.ClearDriver {
		driverID = nil
	} else if update.DriverID != nil {
		driverID = update.DriverID
	}

	row := tx.QueryRow(ctx, `
		UPDATE ride.rides SET
			state = $3,
			version = version + 1,
			active = $4,
			driver_id = $5,
			final_fare_minor = COALESCE($6, final_fare_minor),
			wait_fee_minor = COALESCE($7, wait_fee_minor),
			pin_attempts = COALESCE($8, pin_attempts),
			pin_locked = COALESCE($9, pin_locked),
			pin_verified_at = COALESCE($10, pin_verified_at),
			dispatch_ring = COALESCE($11, dispatch_ring),
			dispatch_rounds = COALESCE($12, dispatch_rounds),
			assigned_at = COALESCE($13, assigned_at),
			arrived_at = COALESCE($14, arrived_at),
			started_at = COALESCE($15, started_at),
			completed_at = COALESCE($16, completed_at),
			cancelled_at = COALESCE($17, cancelled_at),
			cancelled_by_role = COALESCE($18, cancelled_by_role),
			cancel_reason_code = COALESCE($19, cancel_reason_code),
			updated_at = now()
		WHERE id = $1 AND version = $2
		RETURNING `+rideColumns,
		ride.ID, ride.Version, to, active, driverID,
		update.FinalFareMinor, update.WaitFeeMinor,
		update.PinAttempts, update.PinLocked, update.PinVerifiedAt,
		update.DispatchRing, update.DispatchRounds,
		update.AssignedAt, update.ArrivedAt, update.StartedAt,
		update.CompletedAt, update.CancelledAt,
		update.CancelledByRole, update.CancelReasonCode,
	)
	updated, err := scanRide(row)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the ride changed while this request was in flight").
			WithDetails(map[string]any{"rideId": ride.ID.String(), "expectedVersion": ride.Version})
	}
	return updated, err
}

// RecordPinAttempt records a PIN attempt without moving the ride's state.
func (s *Store) RecordPinAttempt(ctx context.Context, db DB, rideID uuid.UUID, attempts int, locked bool) error {
	_, err := db.Exec(ctx,
		`UPDATE ride.rides SET pin_attempts = $2, pin_locked = $3, updated_at = now() WHERE id = $1`,
		rideID, attempts, locked)
	if err != nil {
		return fmt.Errorf("failed to record PIN attempt: %w", err)
	}
	return nil
}

// RidesAwaitingDispatch returns live rides that still need a driver, oldest
// first, so the dispatcher always serves the longest-waiting rider next.
func (s *Store) RidesAwaitingDispatch(ctx context.Context, db DB, limit int) ([]*domain.Ride, error) {
	rows, err := db.Query(ctx, `
		SELECT `+rideColumns+`
		FROM ride.rides
		WHERE active AND state IN ($1, $2)
		ORDER BY updated_at ASC
		LIMIT $3`, machine.RiderMatching, machine.RiderRematching, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list rides awaiting dispatch: %w", err)
	}
	defer rows.Close()

	var rides []*domain.Ride
	for rows.Next() {
		ride, err := scanRide(rows)
		if err != nil {
			return nil, err
		}
		rides = append(rides, ride)
	}
	return rides, rows.Err()
}
