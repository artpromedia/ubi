package move

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

const offerColumns = `
	id, ride_id, driver_id, ring, radius_meters, distance_meters, eta_seconds,
	state, COALESCE(reason, ''), expires_at, responded_at, created_at`

func scanOffer(row pgx.Row) (*domain.Offer, error) {
	var offer domain.Offer
	err := row.Scan(
		&offer.ID, &offer.RideID, &offer.DriverID, &offer.Ring, &offer.RadiusMeters,
		&offer.DistanceMeters, &offer.ETASeconds, &offer.State, &offer.Reason,
		&offer.ExpiresAt, &offer.RespondedAt, &offer.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read offer: %w", err)
	}
	return &offer, nil
}

// InsertOffer records an offer. A driver is offered a given ride at most once;
// a repeat collides with offers_ride_driver_uniq and is reported as not
// inserted rather than as an error.
func (s *Store) InsertOffer(ctx context.Context, db DB, offer *domain.Offer) (bool, error) {
	tag, err := db.Exec(ctx, `
		INSERT INTO ride.offers (
			id, ride_id, driver_id, ring, radius_meters, distance_meters,
			eta_seconds, state, expires_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (ride_id, driver_id) DO NOTHING`,
		offer.ID, offer.RideID, offer.DriverID, offer.Ring, offer.RadiusMeters,
		offer.DistanceMeters, offer.ETASeconds, domain.OfferOffered, offer.ExpiresAt,
	)
	if err != nil {
		return false, fmt.Errorf("failed to insert offer: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// OfferByID reads one offer.
func (s *Store) OfferByID(ctx context.Context, db DB, id uuid.UUID) (*domain.Offer, error) {
	return scanOffer(db.QueryRow(ctx, `SELECT `+offerColumns+` FROM ride.offers WHERE id = $1`, id))
}

// AcceptOffer is the atomic accept.
//
// The WHERE clause admits exactly one caller: only an offer still in `offered`
// and still inside its TTL moves to `accepted`. Even if two transactions were
// to reach this statement at the same instant, the partial unique index
// offers_one_accepted_per_ride refuses the second — the database, not an
// application lock, is the guarantee.
//
// A nil offer with a nil error means this caller lost the race.
func (s *Store) AcceptOffer(ctx context.Context, tx pgx.Tx, offerID uuid.UUID, now time.Time) (*domain.Offer, error) {
	row := tx.QueryRow(ctx, `
		UPDATE ride.offers
		SET state = $2, responded_at = $3
		WHERE id = $1 AND state = $4 AND expires_at > $3
		RETURNING `+offerColumns,
		offerID, domain.OfferAccepted, now, domain.OfferOffered)
	offer, err := scanOffer(row)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, nil
	}
	return offer, err
}

// RespondToOffer records a decline or an expiry. It only moves a live offer, so
// a decline that arrives after the offer expired does not rewrite history.
func (s *Store) RespondToOffer(ctx context.Context, db DB, offerID uuid.UUID, state, reason string, now time.Time) (*domain.Offer, error) {
	row := db.QueryRow(ctx, `
		UPDATE ride.offers
		SET state = $2, reason = $3, responded_at = $4
		WHERE id = $1 AND state = $5
		RETURNING `+offerColumns,
		offerID, state, reason, now, domain.OfferOffered)
	offer, err := scanOffer(row)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, nil
	}
	return offer, err
}

// LiveOfferCount counts the offers for a ride a driver could still accept.
func (s *Store) LiveOfferCount(ctx context.Context, db DB, rideID uuid.UUID, now time.Time) (int, error) {
	var count int
	err := db.QueryRow(ctx, `
		SELECT COUNT(*) FROM ride.offers
		WHERE ride_id = $1 AND state = $2 AND expires_at > $3`,
		rideID, domain.OfferOffered, now).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count live offers: %w", err)
	}
	return count, nil
}

// OfferedDriverIDs lists the drivers who have already seen this ride, so a
// later ring does not offer the same ride to the same driver twice.
func (s *Store) OfferedDriverIDs(ctx context.Context, db DB, rideID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := db.Query(ctx, `SELECT driver_id FROM ride.offers WHERE ride_id = $1`, rideID)
	if err != nil {
		return nil, fmt.Errorf("failed to list offered drivers: %w", err)
	}
	defer rows.Close()

	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("failed to read offered driver: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// OffersForRide returns every offer made for a ride, newest first. This is the
// dispatch half of the ops timeline (board 4b).
func (s *Store) OffersForRide(ctx context.Context, db DB, rideID uuid.UUID) ([]*domain.Offer, error) {
	rows, err := db.Query(ctx,
		`SELECT `+offerColumns+` FROM ride.offers WHERE ride_id = $1 ORDER BY created_at DESC`, rideID)
	if err != nil {
		return nil, fmt.Errorf("failed to list offers: %w", err)
	}
	defer rows.Close()

	var offers []*domain.Offer
	for rows.Next() {
		offer, err := scanOffer(rows)
		if err != nil {
			return nil, err
		}
		offers = append(offers, offer)
	}
	return offers, rows.Err()
}

// ExpiredOffers returns live offers whose deadline has passed. The sweeper uses
// it, which is why an offer expires even if the process that made it died.
func (s *Store) ExpiredOffers(ctx context.Context, db DB, now time.Time, limit int) ([]*domain.Offer, error) {
	rows, err := db.Query(ctx, `
		SELECT `+offerColumns+`
		FROM ride.offers
		WHERE state = $1 AND expires_at <= $2
		ORDER BY expires_at ASC
		LIMIT $3`, domain.OfferOffered, now, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list expired offers: %w", err)
	}
	defer rows.Close()

	var offers []*domain.Offer
	for rows.Next() {
		offer, err := scanOffer(rows)
		if err != nil {
			return nil, err
		}
		offers = append(offers, offer)
	}
	return offers, rows.Err()
}

// ---------------------------------------------------------------------------
// Driver sessions
// ---------------------------------------------------------------------------

const sessionColumns = `
	driver_id, city_id, state, version, vehicle_classes, filters,
	current_ride_id, last_seq, last_lat, last_lng, last_accuracy_m,
	last_location_at, online_since`

func scanSession(row pgx.Row) (*domain.DriverSession, error) {
	var session domain.DriverSession
	var classes, filters []byte
	err := row.Scan(
		&session.DriverID, &session.CityID, &session.State, &session.Version,
		&classes, &filters, &session.CurrentRideID, &session.LastSeq,
		&session.LastLat, &session.LastLng, &session.LastAccuracyM,
		&session.LastLocationAt, &session.OnlineSince,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read driver session: %w", err)
	}
	if len(classes) > 0 {
		if err := json.Unmarshal(classes, &session.VehicleClasses); err != nil {
			return nil, fmt.Errorf("driver session stores unreadable vehicle classes: %w", err)
		}
	}
	if len(filters) > 0 {
		if err := json.Unmarshal(filters, &session.Filters); err != nil {
			return nil, fmt.Errorf("driver session stores unreadable filters: %w", err)
		}
	}
	return &session, nil
}

// Session reads a driver's session.
func (s *Store) Session(ctx context.Context, db DB, driverID uuid.UUID) (*domain.DriverSession, error) {
	return scanSession(db.QueryRow(ctx,
		`SELECT `+sessionColumns+` FROM ride.driver_sessions WHERE driver_id = $1`, driverID))
}

// SessionForUpdate reads and locks a driver's session.
func (s *Store) SessionForUpdate(ctx context.Context, tx pgx.Tx, driverID uuid.UUID) (*domain.DriverSession, error) {
	return scanSession(tx.QueryRow(ctx,
		`SELECT `+sessionColumns+` FROM ride.driver_sessions WHERE driver_id = $1 FOR UPDATE`, driverID))
}

// EnsureSession creates a driver's session in the driver machine's initial
// state if it does not exist yet, then returns it. A driver who has never been
// seen starts `offline`, never `available`: going online is a transition the
// driver has to make.
func (s *Store) EnsureSession(ctx context.Context, db DB, driverID uuid.UUID, cityID string) (*domain.DriverSession, error) {
	initial, err := machine.Initial(machine.Driver)
	if err != nil {
		return nil, err
	}
	_, err = db.Exec(ctx, `
		INSERT INTO ride.driver_sessions (driver_id, city_id, state)
		VALUES ($1, $2, $3)
		ON CONFLICT (driver_id) DO NOTHING`, driverID, cityID, initial)
	if err != nil {
		return nil, fmt.Errorf("failed to create driver session: %w", err)
	}
	return s.Session(ctx, db, driverID)
}

// SessionUpdate carries the columns a driver transition may change.
type SessionUpdate struct {
	VehicleClasses []string
	Filters        map[string]any
	CurrentRideID  *uuid.UUID
	ClearRide      bool
	OnlineSince    *time.Time
	ClearOnline    bool
	CityID         string
}

// TransitionDriver moves a driver session, refusing anything the driver machine
// in contracts/state-machines.json does not allow, under the same optimistic
// version guard the rider machine uses.
func (s *Store) TransitionDriver(ctx context.Context, tx pgx.Tx, session *domain.DriverSession, to string, update SessionUpdate) (*domain.DriverSession, error) {
	if err := assertDriverTransition(session.State, to); err != nil {
		return nil, err
	}

	rideID := session.CurrentRideID
	if update.ClearRide {
		rideID = nil
	} else if update.CurrentRideID != nil {
		rideID = update.CurrentRideID
	}
	onlineSince := session.OnlineSince
	if update.ClearOnline {
		onlineSince = nil
	} else if update.OnlineSince != nil {
		onlineSince = update.OnlineSince
	}
	cityID := session.CityID
	if update.CityID != "" {
		cityID = update.CityID
	}

	var classes, filters []byte
	var err error
	if update.VehicleClasses != nil {
		if classes, err = json.Marshal(update.VehicleClasses); err != nil {
			return nil, fmt.Errorf("unserialisable vehicle classes: %w", err)
		}
	}
	if update.Filters != nil {
		if filters, err = json.Marshal(update.Filters); err != nil {
			return nil, fmt.Errorf("unserialisable driver filters: %w", err)
		}
	}

	row := tx.QueryRow(ctx, `
		UPDATE ride.driver_sessions SET
			state = $3,
			version = version + 1,
			city_id = $4,
			vehicle_classes = COALESCE($5, vehicle_classes),
			filters = COALESCE($6, filters),
			current_ride_id = $7,
			online_since = $8,
			updated_at = now()
		WHERE driver_id = $1 AND version = $2
		RETURNING `+sessionColumns,
		session.DriverID, session.Version, to, cityID, classes, filters, rideID, onlineSince)
	updated, err := scanSession(row)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the driver session changed while this request was in flight")
	}
	return updated, err
}

// AvailableDrivers lists drivers who could take a ride: in this city, in the
// driver machine's `available` state, not already on a trip, offering the
// requested vehicle class, inside the bounding box around pickup, and
// reporting a location recent enough to be believed.
//
// The bounding box is a cheap prefilter; the caller measures the real distance,
// because a box corner is up to 40% further away than the radius allows.
func (s *Store) AvailableDrivers(
	ctx context.Context,
	db DB,
	cityID, vehicleClass string,
	minLat, maxLat, minLng, maxLng float64,
	freshAfter time.Time,
	exclude []uuid.UUID,
) ([]*domain.DriverSession, error) {
	if exclude == nil {
		exclude = []uuid.UUID{}
	}
	rows, err := db.Query(ctx, `
		SELECT `+sessionColumns+`
		FROM ride.driver_sessions
		WHERE city_id = $1
			AND state = $2
			AND current_ride_id IS NULL
			AND last_location_at IS NOT NULL
			AND last_location_at >= $3
			AND last_lat BETWEEN $4 AND $5
			AND last_lng BETWEEN $6 AND $7
			AND (vehicle_classes = '[]'::jsonb OR vehicle_classes ? $8)
			AND NOT (driver_id = ANY($9::uuid[]))`,
		cityID, machine.DriverAvailable, freshAfter,
		minLat, maxLat, minLng, maxLng, vehicleClass, exclude)
	if err != nil {
		return nil, fmt.Errorf("failed to list available drivers: %w", err)
	}
	defer rows.Close()

	var sessions []*domain.DriverSession
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

// RecordLocation stores an accepted location point. The `last_seq < $2` guard
// means a batch that arrives out of order cannot move the driver backwards.
func (s *Store) RecordLocation(ctx context.Context, db DB, driverID uuid.UUID, seq int64, lat, lng, accuracy float64, at time.Time) error {
	_, err := db.Exec(ctx, `
		UPDATE ride.driver_sessions SET
			last_seq = $2, last_lat = $3, last_lng = $4,
			last_accuracy_m = $5, last_location_at = $6, updated_at = now()
		WHERE driver_id = $1 AND last_seq < $2`,
		driverID, seq, lat, lng, accuracy, at)
	if err != nil {
		return fmt.Errorf("failed to record driver location: %w", err)
	}
	return nil
}
