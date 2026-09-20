package marketplace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// DriverSessionRow reads the driver's session from ride.driver_sessions. The
// move package owns that table; the marketplace only reads it, and only the
// fields eligibility needs.
func (s *Store) DriverSessionRow(ctx context.Context, db DB, driverID uuid.UUID) (*domain.DriverSession, error) {
	var session domain.DriverSession
	var classes []byte
	err := db.QueryRow(ctx, `
		SELECT driver_id, city_id, state, version, vehicle_classes,
			current_ride_id, last_lat, last_lng, last_accuracy_m, last_location_at
		FROM ride.driver_sessions
		WHERE driver_id = $1`, driverID).Scan(
		&session.DriverID, &session.CityID, &session.State, &session.Version,
		&classes, &session.CurrentRideID,
		&session.LastLat, &session.LastLng, &session.LastAccuracyM, &session.LastLocationAt,
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
	return &session, nil
}

// ExecutionRide is the slice of a ride the finishing-trip branch needs: where
// the current trip is heading and whether it is still under way.
type ExecutionRide struct {
	ID         uuid.UUID
	State      string
	PickupLat  float64
	PickupLng  float64
	DropoffLat float64
	DropoffLng float64
}

// ExecutionRideRow reads one ride's route endpoints from ride.rides.
func (s *Store) ExecutionRideRow(ctx context.Context, db DB, rideID uuid.UUID) (*ExecutionRide, error) {
	var ride ExecutionRide
	err := db.QueryRow(ctx, `
		SELECT id, state, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng
		FROM ride.rides
		WHERE id = $1`, rideID).Scan(
		&ride.ID, &ride.State, &ride.PickupLat, &ride.PickupLng, &ride.DropoffLat, &ride.DropoffLng,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read the execution ride: %w", err)
	}
	return &ride, nil
}
