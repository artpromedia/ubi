// Package repository provides data access for the ride service.
package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// RideRepository handles ride data access
type RideRepository struct {
	pool *pgxpool.Pool
}

// NewRideRepository creates a new ride repository
func NewRideRepository(pool *pgxpool.Pool) *RideRepository {
	return &RideRepository{pool: pool}
}

// Create inserts a new ride
func (r *RideRepository) Create(ctx context.Context, ride *domain.Ride) error {
	// Serialize locations and route as JSON
	pickupJSON, _ := json.Marshal(ride.PickupLocation)
	dropoffJSON, _ := json.Marshal(ride.DropoffLocation)
	stopsJSON, _ := json.Marshal(ride.Stops)
	
	var routeJSON, priceJSON []byte
	if ride.Route != nil {
		routeJSON, _ = json.Marshal(ride.Route)
	}
	if ride.Price != nil {
		priceJSON, _ = json.Marshal(ride.Price)
	}
	
	metadataJSON, _ := json.Marshal(ride.Metadata)
	
	query := `
		INSERT INTO rides (
			id, rider_id, driver_id, vehicle_id,
			pickup_location, dropoff_location, stops, current_location,
			type, status, payment_method,
			route, price,
			scheduled_for, requested_at, accepted_at, arrived_at,
			started_at, completed_at, cancelled_at,
			cancellation_reason, cancelled_by,
			rider_rating, driver_rating,
			promo_code, metadata,
			created_at, updated_at
		) VALUES (
			$1, $2, $3, $4,
			$5, $6, $7, $8,
			$9, $10, $11,
			$12, $13,
			$14, $15, $16, $17,
			$18, $19, $20,
			$21, $22,
			$23, $24,
			$25, $26,
			$27, $28
		)`
	
	_, err := r.pool.Exec(ctx, query,
		ride.ID, ride.RiderID, ride.DriverID, ride.VehicleID,
		pickupJSON, dropoffJSON, stopsJSON, nil,
		ride.Type, ride.Status, ride.PaymentMethod,
		routeJSON, priceJSON,
		ride.ScheduledFor, ride.RequestedAt, ride.AcceptedAt, ride.ArrivedAt,
		ride.StartedAt, ride.CompletedAt, ride.CancelledAt,
		ride.CancellationReason, ride.CancelledBy,
		ride.RiderRating, ride.DriverRating,
		ride.PromoCode, metadataJSON,
		ride.CreatedAt, ride.UpdatedAt,
	)
	
	return err
}

// Update updates an existing ride
func (r *RideRepository) Update(ctx context.Context, ride *domain.Ride) error {
	// Serialize locations
	var currentLocJSON []byte
	if ride.CurrentLocation != nil {
		currentLocJSON, _ = json.Marshal(ride.CurrentLocation)
	}
	
	var routeJSON, priceJSON []byte
	if ride.Route != nil {
		routeJSON, _ = json.Marshal(ride.Route)
	}
	if ride.Price != nil {
		priceJSON, _ = json.Marshal(ride.Price)
	}
	
	metadataJSON, _ := json.Marshal(ride.Metadata)
	
	query := `
		UPDATE rides SET
			driver_id = $2,
			vehicle_id = $3,
			current_location = $4,
			status = $5,
			route = $6,
			price = $7,
			accepted_at = $8,
			arrived_at = $9,
			started_at = $10,
			completed_at = $11,
			cancelled_at = $12,
			cancellation_reason = $13,
			cancelled_by = $14,
			rider_rating = $15,
			driver_rating = $16,
			metadata = $17,
			updated_at = $18
		WHERE id = $1`
	
	_, err := r.pool.Exec(ctx, query,
		ride.ID,
		ride.DriverID,
		ride.VehicleID,
		currentLocJSON,
		ride.Status,
		routeJSON,
		priceJSON,
		ride.AcceptedAt,
		ride.ArrivedAt,
		ride.StartedAt,
		ride.CompletedAt,
		ride.CancelledAt,
		ride.CancellationReason,
		ride.CancelledBy,
		ride.RiderRating,
		ride.DriverRating,
		metadataJSON,
		time.Now().UTC(),
	)
	
	return err
}

// GetByID retrieves a ride by ID
func (r *RideRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.Ride, error) {
	query := `
		SELECT
			id, rider_id, driver_id, vehicle_id,
			pickup_location, dropoff_location, stops, current_location,
			type, status, payment_method,
			route, price,
			scheduled_for, requested_at, accepted_at, arrived_at,
			started_at, completed_at, cancelled_at,
			cancellation_reason, cancelled_by,
			rider_rating, driver_rating,
			promo_code, metadata,
			created_at, updated_at
		FROM rides WHERE id = $1`
	
	return r.scanRide(r.pool.QueryRow(ctx, query, id))
}

// GetActiveByRider gets the active ride for a rider
func (r *RideRepository) GetActiveByRider(ctx context.Context, riderID uuid.UUID) (*domain.Ride, error) {
	query := `
		SELECT
			id, rider_id, driver_id, vehicle_id,
			pickup_location, dropoff_location, stops, current_location,
			type, status, payment_method,
			route, price,
			scheduled_for, requested_at, accepted_at, arrived_at,
			started_at, completed_at, cancelled_at,
			cancellation_reason, cancelled_by,
			rider_rating, driver_rating,
			promo_code, metadata,
			created_at, updated_at
		FROM rides
		WHERE rider_id = $1
			AND status NOT IN ('COMPLETED', 'CANCELLED')
		ORDER BY created_at DESC
		LIMIT 1`
	
	ride, err := r.scanRide(r.pool.QueryRow(ctx, query, riderID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return ride, err
}

// GetActiveByDriver gets the active ride for a driver
func (r *RideRepository) GetActiveByDriver(ctx context.Context, driverID uuid.UUID) (*domain.Ride, error) {
	query := `
		SELECT
			id, rider_id, driver_id, vehicle_id,
			pickup_location, dropoff_location, stops, current_location,
			type, status, payment_method,
			route, price,
			scheduled_for, requested_at, accepted_at, arrived_at,
			started_at, completed_at, cancelled_at,
			cancellation_reason, cancelled_by,
			rider_rating, driver_rating,
			promo_code, metadata,
			created_at, updated_at
		FROM rides
		WHERE driver_id = $1
			AND status NOT IN ('COMPLETED', 'CANCELLED')
		ORDER BY created_at DESC
		LIMIT 1`
	
	ride, err := r.scanRide(r.pool.QueryRow(ctx, query, driverID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return ride, err
}

// GetRiderHistory gets ride history for a rider
func (r *RideRepository) GetRiderHistory(ctx context.Context, riderID uuid.UUID, limit, offset int) ([]*domain.Ride, int64, error) {
	// Get total count
	var total int64
	countQuery := `SELECT COUNT(*) FROM rides WHERE rider_id = $1`
	if err := r.pool.QueryRow(ctx, countQuery, riderID).Scan(&total); err != nil {
		return nil, 0, err
	}
	
	query := `
		SELECT
			id, rider_id, driver_id, vehicle_id,
			pickup_location, dropoff_location, stops, current_location,
			type, status, payment_method,
			route, price,
			scheduled_for, requested_at, accepted_at, arrived_at,
			started_at, completed_at, cancelled_at,
			cancellation_reason, cancelled_by,
			rider_rating, driver_rating,
			promo_code, metadata,
			created_at, updated_at
		FROM rides
		WHERE rider_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`
	
	rows, err := r.pool.Query(ctx, query, riderID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	
	var rides []*domain.Ride
	for rows.Next() {
		ride, err := r.scanRideFromRows(rows)
		if err != nil {
			return nil, 0, err
		}
		rides = append(rides, ride)
	}
	
	return rides, total, nil
}

// UpdateStatus updates just the ride status
func (r *RideRepository) UpdateStatus(ctx context.Context, id uuid.UUID, status domain.RideStatus) error {
	query := `UPDATE rides SET status = $2, updated_at = $3 WHERE id = $1`
	_, err := r.pool.Exec(ctx, query, id, status, time.Now().UTC())
	return err
}

// UpdateLocation updates the current location of a ride
func (r *RideRepository) UpdateLocation(ctx context.Context, id uuid.UUID, location domain.Location) error {
	locJSON, _ := json.Marshal(location)
	query := `UPDATE rides SET current_location = $2, updated_at = $3 WHERE id = $1`
	_, err := r.pool.Exec(ctx, query, id, locJSON, time.Now().UTC())
	return err
}

// scanRide scans a single ride from a row
func (r *RideRepository) scanRide(row pgx.Row) (*domain.Ride, error) {
	var ride domain.Ride
	var driverID, vehicleID, cancelledBy sql.NullString
	var pickupJSON, dropoffJSON, stopsJSON, currentLocJSON, routeJSON, priceJSON, metadataJSON []byte
	var scheduledFor, acceptedAt, arrivedAt, startedAt, completedAt, cancelledAt sql.NullTime
	var riderRating, driverRating sql.NullFloat64
	
	err := row.Scan(
		&ride.ID, &ride.RiderID, &driverID, &vehicleID,
		&pickupJSON, &dropoffJSON, &stopsJSON, &currentLocJSON,
		&ride.Type, &ride.Status, &ride.PaymentMethod,
		&routeJSON, &priceJSON,
		&scheduledFor, &ride.RequestedAt, &acceptedAt, &arrivedAt,
		&startedAt, &completedAt, &cancelledAt,
		&ride.CancellationReason, &cancelledBy,
		&riderRating, &driverRating,
		&ride.PromoCode, &metadataJSON,
		&ride.CreatedAt, &ride.UpdatedAt,
	)
	
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrRideNotFound
		}
		return nil, err
	}
	
	// Parse UUIDs
	if driverID.Valid {
		id, _ := uuid.Parse(driverID.String)
		ride.DriverID = &id
	}
	if vehicleID.Valid {
		id, _ := uuid.Parse(vehicleID.String)
		ride.VehicleID = &id
	}
	if cancelledBy.Valid {
		id, _ := uuid.Parse(cancelledBy.String)
		ride.CancelledBy = &id
	}
	
	// Parse timestamps
	if scheduledFor.Valid {
		ride.ScheduledFor = &scheduledFor.Time
	}
	if acceptedAt.Valid {
		ride.AcceptedAt = &acceptedAt.Time
	}
	if arrivedAt.Valid {
		ride.ArrivedAt = &arrivedAt.Time
	}
	if startedAt.Valid {
		ride.StartedAt = &startedAt.Time
	}
	if completedAt.Valid {
		ride.CompletedAt = &completedAt.Time
	}
	if cancelledAt.Valid {
		ride.CancelledAt = &cancelledAt.Time
	}
	
	// Parse ratings
	if riderRating.Valid {
		r := float32(riderRating.Float64)
		ride.RiderRating = &r
	}
	if driverRating.Valid {
		r := float32(driverRating.Float64)
		ride.DriverRating = &r
	}
	
	// Parse JSON fields
	_ = json.Unmarshal(pickupJSON, &ride.PickupLocation)
	_ = json.Unmarshal(dropoffJSON, &ride.DropoffLocation)
	_ = json.Unmarshal(stopsJSON, &ride.Stops)
	if len(currentLocJSON) > 0 {
		var loc domain.Location
		if json.Unmarshal(currentLocJSON, &loc) == nil {
			ride.CurrentLocation = &loc
		}
	}
	if len(routeJSON) > 0 {
		var route domain.RouteInfo
		if json.Unmarshal(routeJSON, &route) == nil {
			ride.Route = &route
		}
	}
	if len(priceJSON) > 0 {
		var price domain.PriceBreakdown
		if json.Unmarshal(priceJSON, &price) == nil {
			ride.Price = &price
		}
	}
	if len(metadataJSON) > 0 {
		ride.Metadata = make(map[string]any)
		_ = json.Unmarshal(metadataJSON, &ride.Metadata)
	}
	
	return &ride, nil
}

// scanRideFromRows scans a ride from rows iterator
func (r *RideRepository) scanRideFromRows(rows pgx.Rows) (*domain.Ride, error) {
	var ride domain.Ride
	var driverID, vehicleID, cancelledBy sql.NullString
	var pickupJSON, dropoffJSON, stopsJSON, currentLocJSON, routeJSON, priceJSON, metadataJSON []byte
	var scheduledFor, acceptedAt, arrivedAt, startedAt, completedAt, cancelledAt sql.NullTime
	var riderRating, driverRating sql.NullFloat64
	
	err := rows.Scan(
		&ride.ID, &ride.RiderID, &driverID, &vehicleID,
		&pickupJSON, &dropoffJSON, &stopsJSON, &currentLocJSON,
		&ride.Type, &ride.Status, &ride.PaymentMethod,
		&routeJSON, &priceJSON,
		&scheduledFor, &ride.RequestedAt, &acceptedAt, &arrivedAt,
		&startedAt, &completedAt, &cancelledAt,
		&ride.CancellationReason, &cancelledBy,
		&riderRating, &driverRating,
		&ride.PromoCode, &metadataJSON,
		&ride.CreatedAt, &ride.UpdatedAt,
	)
	
	if err != nil {
		return nil, err
	}
	
	// Parse UUIDs
	if driverID.Valid {
		id, _ := uuid.Parse(driverID.String)
		ride.DriverID = &id
	}
	if vehicleID.Valid {
		id, _ := uuid.Parse(vehicleID.String)
		ride.VehicleID = &id
	}
	if cancelledBy.Valid {
		id, _ := uuid.Parse(cancelledBy.String)
		ride.CancelledBy = &id
	}
	
	// Parse timestamps
	if scheduledFor.Valid {
		ride.ScheduledFor = &scheduledFor.Time
	}
	if acceptedAt.Valid {
		ride.AcceptedAt = &acceptedAt.Time
	}
	if arrivedAt.Valid {
		ride.ArrivedAt = &arrivedAt.Time
	}
	if startedAt.Valid {
		ride.StartedAt = &startedAt.Time
	}
	if completedAt.Valid {
		ride.CompletedAt = &completedAt.Time
	}
	if cancelledAt.Valid {
		ride.CancelledAt = &cancelledAt.Time
	}
	
	// Parse ratings
	if riderRating.Valid {
		r := float32(riderRating.Float64)
		ride.RiderRating = &r
	}
	if driverRating.Valid {
		r := float32(driverRating.Float64)
		ride.DriverRating = &r
	}
	
	// Parse JSON fields
	_ = json.Unmarshal(pickupJSON, &ride.PickupLocation)
	_ = json.Unmarshal(dropoffJSON, &ride.DropoffLocation)
	_ = json.Unmarshal(stopsJSON, &ride.Stops)
	if len(currentLocJSON) > 0 {
		var loc domain.Location
		if json.Unmarshal(currentLocJSON, &loc) == nil {
			ride.CurrentLocation = &loc
		}
	}
	if len(routeJSON) > 0 {
		var route domain.RouteInfo
		if json.Unmarshal(routeJSON, &route) == nil {
			ride.Route = &route
		}
	}
	if len(priceJSON) > 0 {
		var price domain.PriceBreakdown
		if json.Unmarshal(priceJSON, &price) == nil {
			ride.Price = &price
		}
	}
	if len(metadataJSON) > 0 {
		ride.Metadata = make(map[string]any)
		_ = json.Unmarshal(metadataJSON, &ride.Metadata)
	}
	
	return &ride, nil
}

// GetPendingScheduledRides gets scheduled rides that are due
func (r *RideRepository) GetPendingScheduledRides(ctx context.Context, beforeTime time.Time) ([]*domain.Ride, error) {
	query := `
		SELECT
			id, rider_id, driver_id, vehicle_id,
			pickup_location, dropoff_location, stops, current_location,
			type, status, payment_method,
			route, price,
			scheduled_for, requested_at, accepted_at, arrived_at,
			started_at, completed_at, cancelled_at,
			cancellation_reason, cancelled_by,
			rider_rating, driver_rating,
			promo_code, metadata,
			created_at, updated_at
		FROM rides
		WHERE status = 'PENDING'
			AND scheduled_for IS NOT NULL
			AND scheduled_for <= $1
		ORDER BY scheduled_for ASC
		LIMIT 100`
	
	rows, err := r.pool.Query(ctx, query, beforeTime)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var rides []*domain.Ride
	for rows.Next() {
		ride, err := r.scanRideFromRows(rows)
		if err != nil {
			return nil, err
		}
		rides = append(rides, ride)
	}
	
	return rides, nil
}

// GetMetrics gets ride metrics for analytics
func (r *RideRepository) GetMetrics(ctx context.Context, startTime, endTime time.Time) (map[string]any, error) {
	metrics := make(map[string]any)
	
	// Total rides
	var totalRides int64
	r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM rides
		WHERE created_at >= $1 AND created_at < $2
	`, startTime, endTime).Scan(&totalRides)
	metrics["total_rides"] = totalRides
	
	// Completed rides
	var completedRides int64
	r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM rides
		WHERE status = 'COMPLETED'
			AND completed_at >= $1 AND completed_at < $2
	`, startTime, endTime).Scan(&completedRides)
	metrics["completed_rides"] = completedRides
	
	// Cancelled rides
	var cancelledRides int64
	r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM rides
		WHERE status = 'CANCELLED'
			AND cancelled_at >= $1 AND cancelled_at < $2
	`, startTime, endTime).Scan(&cancelledRides)
	metrics["cancelled_rides"] = cancelledRides
	
	// Average ride value
	var avgValue sql.NullFloat64
	r.pool.QueryRow(ctx, `
		SELECT AVG((price->>'total')::numeric)
		FROM rides
		WHERE status = 'COMPLETED'
			AND completed_at >= $1 AND completed_at < $2
			AND price IS NOT NULL
	`, startTime, endTime).Scan(&avgValue)
	if avgValue.Valid {
		metrics["average_ride_value"] = avgValue.Float64
	}
	
	// Completion rate
	if totalRides > 0 {
		metrics["completion_rate"] = float64(completedRides) / float64(totalRides) * 100
	}
	
	return metrics, nil
}

// CreateRidesTable creates the rides table (for testing/migrations)
func (r *RideRepository) CreateRidesTable(ctx context.Context) error {
	query := `
		CREATE TABLE IF NOT EXISTS rides (
			id UUID PRIMARY KEY,
			rider_id UUID NOT NULL,
			driver_id UUID,
			vehicle_id UUID,
			pickup_location JSONB NOT NULL,
			dropoff_location JSONB NOT NULL,
			stops JSONB DEFAULT '[]'::jsonb,
			current_location JSONB,
			type VARCHAR(50) NOT NULL,
			status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
			payment_method VARCHAR(50) NOT NULL,
			route JSONB,
			price JSONB,
			scheduled_for TIMESTAMPTZ,
			requested_at TIMESTAMPTZ NOT NULL,
			accepted_at TIMESTAMPTZ,
			arrived_at TIMESTAMPTZ,
			started_at TIMESTAMPTZ,
			completed_at TIMESTAMPTZ,
			cancelled_at TIMESTAMPTZ,
			cancellation_reason TEXT,
			cancelled_by UUID,
			rider_rating DECIMAL(2,1),
			driver_rating DECIMAL(2,1),
			promo_code VARCHAR(50),
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		
		CREATE INDEX IF NOT EXISTS idx_rides_rider_id ON rides(rider_id);
		CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON rides(driver_id);
		CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
		CREATE INDEX IF NOT EXISTS idx_rides_scheduled_for ON rides(scheduled_for) WHERE scheduled_for IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_rides_created_at ON rides(created_at);
	`
	
	_, err := r.pool.Exec(ctx, query)
	return err
}

// DriverFilter for querying drivers
type DriverFilter struct {
	Status       *domain.DriverStatus
	H3Cells      []string
	RideType     *domain.RideType
	MinRating    *float64
	IsOnline     *bool
	Limit        int
	Offset       int
}

// DriverRepository handles driver data access for the ride service
type DriverRepository struct {
	pool *pgxpool.Pool
}

// NewDriverRepository creates a new driver repository
func NewDriverRepository(pool *pgxpool.Pool) *DriverRepository {
	return &DriverRepository{pool: pool}
}

// GetByID gets a driver by ID
func (r *DriverRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.Driver, error) {
	query := `
		SELECT
			d.id, d.user_id, d.status,
			u.first_name, u.last_name, u.phone, u.profile_photo,
			d.current_location, d.h3_cell, d.last_location_at,
			d.heading, d.speed,
			d.rating, d.total_rides, d.acceptance_rate,
			d.current_ride_id, d.online_since,
			d.created_at, d.updated_at,
			v.id as vehicle_id, v.type as vehicle_type,
			v.make, v.model, v.year, v.color, v.license_plate,
			v.capacity, v.supported_types
		FROM drivers d
		JOIN users u ON u.id = d.user_id
		LEFT JOIN vehicles v ON v.driver_id = d.id AND v.is_active = true
		WHERE d.id = $1`
	
	return r.scanDriver(r.pool.QueryRow(ctx, query, id))
}

// GetNearby gets drivers near a location
func (r *DriverRepository) GetNearby(ctx context.Context, lat, lng, radiusM float64, rideType *domain.RideType) ([]*domain.NearbyDriver, error) {
	// Use PostGIS for efficient geospatial queries
	query := `
		SELECT
			d.id, d.user_id, d.status,
			u.first_name, u.last_name, u.phone, u.profile_photo,
			d.current_location, d.h3_cell, d.last_location_at,
			d.heading, d.speed,
			d.rating, d.total_rides, d.acceptance_rate,
			d.current_ride_id, d.online_since,
			d.created_at, d.updated_at,
			v.id as vehicle_id, v.type as vehicle_type,
			v.make, v.model, v.year, v.color, v.license_plate,
			v.capacity, v.supported_types,
			ST_Distance(
				d.location_point::geography,
				ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
			) as distance_meters
		FROM drivers d
		JOIN users u ON u.id = d.user_id
		LEFT JOIN vehicles v ON v.driver_id = d.id AND v.is_active = true
		WHERE d.status = 'ONLINE'
			AND d.current_ride_id IS NULL
			AND d.location_point IS NOT NULL
			AND ST_DWithin(
				d.location_point::geography,
				ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
				$3
			)
		ORDER BY distance_meters ASC
		LIMIT 50`
	
	rows, err := r.pool.Query(ctx, query, lat, lng, radiusM)
	if err != nil {
		return nil, fmt.Errorf("failed to query nearby drivers: %w", err)
	}
	defer rows.Close()
	
	var drivers []*domain.NearbyDriver
	for rows.Next() {
		nd, err := r.scanNearbyDriver(rows)
		if err != nil {
			continue
		}
		
		// Filter by ride type if specified
		if rideType != nil && !nd.Driver.CanAcceptRideType(*rideType) {
			continue
		}
		
		drivers = append(drivers, nd)
	}
	
	return drivers, nil
}

// UpdateLocation updates a driver's location
func (r *DriverRepository) UpdateLocation(ctx context.Context, driverID uuid.UUID, loc *domain.DriverLocation) error {
	locJSON, _ := json.Marshal(domain.Location{
		Latitude:  loc.Location.Latitude,
		Longitude: loc.Location.Longitude,
		H3Cell:    loc.Location.H3Cell,
	})
	
	query := `
		UPDATE drivers SET
			current_location = $2,
			location_point = ST_SetSRID(ST_MakePoint($4, $3), 4326),
			h3_cell = $5,
			heading = $6,
			speed = $7,
			last_location_at = $8,
			updated_at = $8
		WHERE id = $1`
	
	_, err := r.pool.Exec(ctx, query,
		driverID,
		locJSON,
		loc.Location.Latitude,
		loc.Location.Longitude,
		loc.Location.H3Cell,
		loc.Heading,
		loc.Speed,
		loc.Timestamp,
	)
	
	return err
}

// UpdateStatus updates a driver's status
func (r *DriverRepository) UpdateStatus(ctx context.Context, driverID uuid.UUID, status domain.DriverStatus) error {
	now := time.Now().UTC()
	
	var onlineSince *time.Time
	if status == domain.DriverStatusOnline {
		onlineSince = &now
	}
	
	query := `
		UPDATE drivers SET
			status = $2,
			online_since = $3,
			updated_at = $4
		WHERE id = $1`
	
	_, err := r.pool.Exec(ctx, query, driverID, status, onlineSince, now)
	return err
}

// AssignRide assigns a ride to a driver
func (r *DriverRepository) AssignRide(ctx context.Context, driverID, rideID uuid.UUID) error {
	query := `
		UPDATE drivers SET
			status = 'ON_RIDE',
			current_ride_id = $2,
			updated_at = $3
		WHERE id = $1 AND status = 'ONLINE' AND current_ride_id IS NULL`
	
	result, err := r.pool.Exec(ctx, query, driverID, rideID, time.Now().UTC())
	if err != nil {
		return err
	}
	
	if result.RowsAffected() == 0 {
		return domain.ErrDriverNotAvailable
	}
	
	return nil
}

// CompleteRide marks a driver's ride as complete
func (r *DriverRepository) CompleteRide(ctx context.Context, driverID uuid.UUID) error {
	query := `
		UPDATE drivers SET
			status = 'ONLINE',
			current_ride_id = NULL,
			total_rides = total_rides + 1,
			updated_at = $2
		WHERE id = $1`
	
	_, err := r.pool.Exec(ctx, query, driverID, time.Now().UTC())
	return err
}

func (r *DriverRepository) scanDriver(row pgx.Row) (*domain.Driver, error) {
	var driver domain.Driver
	var currentLocJSON []byte
	var lastLocAt, onlineSince sql.NullTime
	var currentRideID, vehicleID sql.NullString
	var vehicleType sql.NullString
	var make, model, color, licensePlate sql.NullString
	var year, capacity sql.NullInt32
	var supportedTypes []byte
	
	err := row.Scan(
		&driver.ID, &driver.UserID, &driver.Status,
		&driver.FirstName, &driver.LastName, &driver.Phone, &driver.ProfilePhoto,
		&currentLocJSON, &driver.H3Cell, &lastLocAt,
		&driver.Heading, &driver.Speed,
		&driver.Rating, &driver.TotalRides, &driver.AcceptanceRate,
		&currentRideID, &onlineSince,
		&driver.CreatedAt, &driver.UpdatedAt,
		&vehicleID, &vehicleType,
		&make, &model, &year, &color, &licensePlate,
		&capacity, &supportedTypes,
	)
	
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrDriverNotFound
		}
		return nil, err
	}
	
	// Parse location
	if len(currentLocJSON) > 0 {
		var loc domain.Location
		if json.Unmarshal(currentLocJSON, &loc) == nil {
			driver.CurrentLocation = &loc
		}
	}
	
	// Parse timestamps
	if lastLocAt.Valid {
		driver.LastLocationAt = &lastLocAt.Time
	}
	if onlineSince.Valid {
		driver.OnlineSince = &onlineSince.Time
	}
	
	// Parse current ride
	if currentRideID.Valid {
		id, _ := uuid.Parse(currentRideID.String)
		driver.CurrentRideID = &id
	}
	
	// Parse vehicle
	if vehicleID.Valid {
		vehicle := &domain.Vehicle{
			DriverID: driver.ID,
		}
		vehicle.ID, _ = uuid.Parse(vehicleID.String)
		
		if vehicleType.Valid {
			vehicle.Type = domain.VehicleType(vehicleType.String)
		}
		if make.Valid {
			vehicle.Make = make.String
		}
		if model.Valid {
			vehicle.Model = model.String
		}
		if year.Valid {
			vehicle.Year = int(year.Int32)
		}
		if color.Valid {
			vehicle.Color = color.String
		}
		if licensePlate.Valid {
			vehicle.LicensePlate = licensePlate.String
		}
		if capacity.Valid {
			vehicle.Capacity = int(capacity.Int32)
		}
		if len(supportedTypes) > 0 {
			_ = json.Unmarshal(supportedTypes, &vehicle.SupportedTypes)
		}
		
		vehicle.IsActive = true
		driver.Vehicle = vehicle
	}
	
	return &driver, nil
}

func (r *DriverRepository) scanNearbyDriver(rows pgx.Rows) (*domain.NearbyDriver, error) {
	var driver domain.Driver
	var currentLocJSON []byte
	var lastLocAt, onlineSince sql.NullTime
	var currentRideID, vehicleID sql.NullString
	var vehicleType sql.NullString
	var make, model, color, licensePlate sql.NullString
	var year, capacity sql.NullInt32
	var supportedTypes []byte
	var distanceMeters float64
	
	err := rows.Scan(
		&driver.ID, &driver.UserID, &driver.Status,
		&driver.FirstName, &driver.LastName, &driver.Phone, &driver.ProfilePhoto,
		&currentLocJSON, &driver.H3Cell, &lastLocAt,
		&driver.Heading, &driver.Speed,
		&driver.Rating, &driver.TotalRides, &driver.AcceptanceRate,
		&currentRideID, &onlineSince,
		&driver.CreatedAt, &driver.UpdatedAt,
		&vehicleID, &vehicleType,
		&make, &model, &year, &color, &licensePlate,
		&capacity, &supportedTypes,
		&distanceMeters,
	)
	
	if err != nil {
		return nil, err
	}
	
	// Parse location
	if len(currentLocJSON) > 0 {
		var loc domain.Location
		if json.Unmarshal(currentLocJSON, &loc) == nil {
			driver.CurrentLocation = &loc
		}
	}
	
	// Parse timestamps
	if lastLocAt.Valid {
		driver.LastLocationAt = &lastLocAt.Time
	}
	if onlineSince.Valid {
		driver.OnlineSince = &onlineSince.Time
	}
	
	// Parse vehicle
	if vehicleID.Valid {
		vehicle := &domain.Vehicle{
			DriverID: driver.ID,
		}
		vehicle.ID, _ = uuid.Parse(vehicleID.String)
		
		if vehicleType.Valid {
			vehicle.Type = domain.VehicleType(vehicleType.String)
		}
		if make.Valid {
			vehicle.Make = make.String
		}
		if model.Valid {
			vehicle.Model = model.String
		}
		if year.Valid {
			vehicle.Year = int(year.Int32)
		}
		if color.Valid {
			vehicle.Color = color.String
		}
		if licensePlate.Valid {
			vehicle.LicensePlate = licensePlate.String
		}
		if capacity.Valid {
			vehicle.Capacity = int(capacity.Int32)
		}
		if len(supportedTypes) > 0 {
			_ = json.Unmarshal(supportedTypes, &vehicle.SupportedTypes)
		}
		
		vehicle.IsActive = true
		driver.Vehicle = vehicle
	}
	
	// Calculate ETA
	vType := "car"
	if driver.Vehicle != nil {
		switch driver.Vehicle.Type {
		case domain.VehicleTypeBike:
			vType = "bike"
		case domain.VehicleTypeTricycle:
			vType = "tricycle"
		}
	}
	
	return &domain.NearbyDriver{
		Driver:     &driver,
		DistanceM:  distanceMeters,
		ETASeconds: int64(distanceMeters/10.0) * int64(1.2), // Rough ETA
	}, nil
}
