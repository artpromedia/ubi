//go:build integration

package integration_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	_ "github.com/lib/pq"
	"github.com/ubi/ride-service/internal/testutil"
)

// Integration tests require Docker and are run with: go test -tags=integration ./...

func TestRideLifecycle_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Setup infrastructure
	infra := testutil.NewTestInfra(t)
	infra.SetupTestEnv(t)

	ctx := context.Background()

	// Create tables (simplified for test)
	_, err := infra.DB.DB.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY,
			phone_number VARCHAR(20) UNIQUE NOT NULL,
			first_name VARCHAR(100),
			last_name VARCHAR(100),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create users table: %v", err)
	}

	_, err = infra.DB.DB.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS drivers (
			id UUID PRIMARY KEY,
			user_id UUID REFERENCES users(id),
			license_number VARCHAR(50),
			vehicle_make VARCHAR(50),
			vehicle_model VARCHAR(50),
			license_plate VARCHAR(20),
			rating DECIMAL(3, 2) DEFAULT 5.0,
			status VARCHAR(20) DEFAULT 'offline',
			current_lat DECIMAL(10, 8),
			current_lng DECIMAL(11, 8),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create drivers table: %v", err)
	}

	_, err = infra.DB.DB.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS rides (
			id UUID PRIMARY KEY,
			rider_id UUID REFERENCES users(id),
			driver_id UUID REFERENCES drivers(id),
			status VARCHAR(20) NOT NULL,
			pickup_lat DECIMAL(10, 8) NOT NULL,
			pickup_lng DECIMAL(11, 8) NOT NULL,
			pickup_address TEXT,
			dropoff_lat DECIMAL(10, 8) NOT NULL,
			dropoff_lng DECIMAL(11, 8) NOT NULL,
			dropoff_address TEXT,
			estimated_fare BIGINT,
			actual_fare BIGINT,
			vehicle_type VARCHAR(20) DEFAULT 'standard',
			requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			accepted_at TIMESTAMP WITH TIME ZONE,
			picked_up_at TIMESTAMP WITH TIME ZONE,
			dropped_off_at TIMESTAMP WITH TIME ZONE,
			cancelled_at TIMESTAMP WITH TIME ZONE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create rides table: %v", err)
	}

	// Test data
	user := testutil.NewUserBuilder().Build()
	driver := testutil.NewDriverBuilder().Build()
	ride := testutil.NewRideBuilder().
		WithRider(user.ID).
		Build()

	// Insert user
	_, err = infra.DB.DB.ExecContext(ctx, `
		INSERT INTO users (id, phone_number, first_name, last_name)
		VALUES ($1, $2, $3, $4)
	`, user.ID, user.PhoneNumber, user.FirstName, user.LastName)
	if err != nil {
		t.Fatalf("Failed to insert user: %v", err)
	}

	// Insert driver user
	driverUser := testutil.NewUserBuilder().
		WithID(driver.UserID).
		WithPhoneNumber(testutil.GenerateNigerianPhone()).
		Build()
	_, err = infra.DB.DB.ExecContext(ctx, `
		INSERT INTO users (id, phone_number, first_name, last_name)
		VALUES ($1, $2, $3, $4)
	`, driverUser.ID, driverUser.PhoneNumber, driverUser.FirstName, driverUser.LastName)
	if err != nil {
		t.Fatalf("Failed to insert driver user: %v", err)
	}

	// Insert driver
	_, err = infra.DB.DB.ExecContext(ctx, `
		INSERT INTO drivers (id, user_id, license_number, vehicle_make, vehicle_model, license_plate, rating, status, current_lat, current_lng)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, driver.ID, driver.UserID, driver.LicenseNumber, driver.VehicleMake, driver.VehicleModel, driver.LicensePlate, driver.Rating, driver.Status, driver.CurrentLat, driver.CurrentLng)
	if err != nil {
		t.Fatalf("Failed to insert driver: %v", err)
	}

	// Test ride lifecycle
	t.Run("CreateRide", func(t *testing.T) {
		_, err := infra.DB.DB.ExecContext(ctx, `
			INSERT INTO rides (id, rider_id, status, pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng, dropoff_address, estimated_fare, vehicle_type)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		`, ride.ID, ride.RiderID, "requested", ride.PickupLat, ride.PickupLng, ride.PickupAddress, ride.DropoffLat, ride.DropoffLng, ride.DropoffAddress, ride.EstimatedFare, ride.VehicleType)

		assert := testutil.NewAssert(t)
		assert.NoError(err)
	})

	t.Run("AcceptRide", func(t *testing.T) {
		_, err := infra.DB.DB.ExecContext(ctx, `
			UPDATE rides 
			SET status = 'accepted', driver_id = $1, accepted_at = NOW()
			WHERE id = $2 AND status = 'requested'
		`, driver.ID, ride.ID)

		assert := testutil.NewAssert(t)
		assert.NoError(err)

		// Verify
		var status string
		var driverID sql.NullString
		err = infra.DB.DB.QueryRowContext(ctx, `
			SELECT status, driver_id FROM rides WHERE id = $1
		`, ride.ID).Scan(&status, &driverID)

		assert.NoError(err)
		assert.Equal("accepted", status)
		assert.True(driverID.Valid)
		assert.Equal(driver.ID, driverID.String)
	})

	t.Run("StartRide", func(t *testing.T) {
		_, err := infra.DB.DB.ExecContext(ctx, `
			UPDATE rides 
			SET status = 'in_progress', picked_up_at = NOW()
			WHERE id = $1 AND status = 'accepted'
		`, ride.ID)

		assert := testutil.NewAssert(t)
		assert.NoError(err)

		// Verify
		var status string
		err = infra.DB.DB.QueryRowContext(ctx, `
			SELECT status FROM rides WHERE id = $1
		`, ride.ID).Scan(&status)

		assert.NoError(err)
		assert.Equal("in_progress", status)
	})

	t.Run("CompleteRide", func(t *testing.T) {
		actualFare := ride.EstimatedFare + 5000 // Slight increase

		_, err := infra.DB.DB.ExecContext(ctx, `
			UPDATE rides 
			SET status = 'completed', dropped_off_at = NOW(), actual_fare = $1
			WHERE id = $2 AND status = 'in_progress'
		`, actualFare, ride.ID)

		assert := testutil.NewAssert(t)
		assert.NoError(err)

		// Verify
		var status string
		var fare int64
		err = infra.DB.DB.QueryRowContext(ctx, `
			SELECT status, actual_fare FROM rides WHERE id = $1
		`, ride.ID).Scan(&status, &fare)

		assert.NoError(err)
		assert.Equal("completed", status)
		assert.Equal(actualFare, fare)
	})
}

func TestRideCancellation_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Setup infrastructure
	infra := testutil.NewTestInfra(t)
	infra.SetupTestEnv(t)

	ctx := context.Background()

	// Create tables
	_, err := infra.DB.DB.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY,
			phone_number VARCHAR(20) UNIQUE NOT NULL,
			first_name VARCHAR(100),
			last_name VARCHAR(100),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create users table: %v", err)
	}

	_, err = infra.DB.DB.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS rides (
			id UUID PRIMARY KEY,
			rider_id UUID REFERENCES users(id),
			driver_id UUID,
			status VARCHAR(20) NOT NULL,
			pickup_lat DECIMAL(10, 8) NOT NULL,
			pickup_lng DECIMAL(11, 8) NOT NULL,
			dropoff_lat DECIMAL(10, 8) NOT NULL,
			dropoff_lng DECIMAL(11, 8) NOT NULL,
			cancellation_reason TEXT,
			cancelled_at TIMESTAMP WITH TIME ZONE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create rides table: %v", err)
	}

	// Create user and ride
	user := testutil.NewUserBuilder().Build()
	ride := testutil.NewRideBuilder().WithRider(user.ID).Build()

	_, err = infra.DB.DB.ExecContext(ctx, `
		INSERT INTO users (id, phone_number, first_name, last_name)
		VALUES ($1, $2, $3, $4)
	`, user.ID, user.PhoneNumber, user.FirstName, user.LastName)
	if err != nil {
		t.Fatalf("Failed to insert user: %v", err)
	}

	_, err = infra.DB.DB.ExecContext(ctx, `
		INSERT INTO rides (id, rider_id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, ride.ID, ride.RiderID, "requested", ride.PickupLat, ride.PickupLng, ride.DropoffLat, ride.DropoffLng)
	if err != nil {
		t.Fatalf("Failed to insert ride: %v", err)
	}

	// Cancel ride
	cancellationReason := "Changed plans"
	_, err = infra.DB.DB.ExecContext(ctx, `
		UPDATE rides 
		SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = $1
		WHERE id = $2 AND status IN ('requested', 'accepted')
	`, cancellationReason, ride.ID)

	assert := testutil.NewAssert(t)
	assert.NoError(err)

	// Verify
	var status string
	var reason sql.NullString
	err = infra.DB.DB.QueryRowContext(ctx, `
		SELECT status, cancellation_reason FROM rides WHERE id = $1
	`, ride.ID).Scan(&status, &reason)

	assert.NoError(err)
	assert.Equal("cancelled", status)
	assert.True(reason.Valid)
	assert.Equal(cancellationReason, reason.String)
}

func TestConcurrentRideRequests_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Setup infrastructure
	infra := testutil.NewTestInfra(t)
	infra.SetupTestEnv(t)

	ctx := context.Background()

	// Create tables
	_, err := infra.DB.DB.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY,
			phone_number VARCHAR(20) UNIQUE NOT NULL,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create users table: %v", err)
	}

	_, err = infra.DB.DB.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS rides (
			id UUID PRIMARY KEY,
			rider_id UUID REFERENCES users(id),
			status VARCHAR(20) NOT NULL,
			pickup_lat DECIMAL(10, 8) NOT NULL,
			pickup_lng DECIMAL(11, 8) NOT NULL,
			dropoff_lat DECIMAL(10, 8) NOT NULL,
			dropoff_lng DECIMAL(11, 8) NOT NULL,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`)
	if err != nil {
		t.Fatalf("Failed to create rides table: %v", err)
	}

	// Create multiple users
	users := testutil.GenerateUsers(10)
	for _, u := range users {
		_, err := infra.DB.DB.ExecContext(ctx, `
			INSERT INTO users (id, phone_number) VALUES ($1, $2)
		`, u.ID, u.PhoneNumber)
		if err != nil {
			t.Fatalf("Failed to insert user: %v", err)
		}
	}

	// Concurrently create rides
	done := make(chan bool, len(users))
	for _, u := range users {
		go func(user testutil.UserFixture) {
			ride := testutil.NewRideBuilder().WithRider(user.ID).Build()
			_, err := infra.DB.DB.ExecContext(ctx, `
				INSERT INTO rides (id, rider_id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
			`, ride.ID, ride.RiderID, "requested", ride.PickupLat, ride.PickupLng, ride.DropoffLat, ride.DropoffLng)
			if err != nil {
				t.Errorf("Failed to create ride: %v", err)
			}
			done <- true
		}(u)
	}

	// Wait for all goroutines
	for i := 0; i < len(users); i++ {
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Fatal("Timeout waiting for concurrent ride creation")
		}
	}

	// Verify all rides were created
	var count int
	err = infra.DB.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM rides`).Scan(&count)
	
	assert := testutil.NewAssert(t)
	assert.NoError(err)
	assert.Equal(len(users), count)
}
