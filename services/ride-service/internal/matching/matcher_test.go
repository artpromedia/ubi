package matching_test

import (
	"context"
	"testing"
	"time"

	"github.com/ubi/ride-service/internal/testutil"
)

// DriverMatcher interface for driver matching
type DriverMatcher interface {
	FindNearbyDrivers(ctx context.Context, lat, lng float64, radiusKm float64) ([]*testutil.MockDriver, error)
	MatchDriver(ctx context.Context, rideID string, pickupLat, pickupLng float64) (*testutil.MockDriver, error)
}

// SimpleDriverMatcher implements basic driver matching logic
type SimpleDriverMatcher struct {
	rideMatcher *testutil.MockRideMatcher
}

// NewSimpleDriverMatcher creates a new simple driver matcher
func NewSimpleDriverMatcher(matcher *testutil.MockRideMatcher) *SimpleDriverMatcher {
	return &SimpleDriverMatcher{rideMatcher: matcher}
}

// FindNearbyDrivers finds drivers within radius
func (m *SimpleDriverMatcher) FindNearbyDrivers(ctx context.Context, lat, lng float64, radiusKm float64) ([]*testutil.MockDriver, error) {
	return m.rideMatcher.FindNearbyDrivers(ctx, lat, lng, radiusKm)
}

// MatchDriver matches the best available driver
func (m *SimpleDriverMatcher) MatchDriver(ctx context.Context, rideID string, pickupLat, pickupLng float64) (*testutil.MockDriver, error) {
	drivers, err := m.rideMatcher.FindNearbyDrivers(ctx, pickupLat, pickupLng, 5.0) // 5km radius
	if err != nil {
		return nil, err
	}

	if len(drivers) == 0 {
		return nil, nil
	}

	// Find driver with best rating
	var bestDriver *testutil.MockDriver
	for _, d := range drivers {
		if bestDriver == nil || d.Rating > bestDriver.Rating {
			bestDriver = d
		}
	}

	return bestDriver, nil
}

// ========================================
// Tests
// ========================================

func TestFindNearbyDrivers_NoDrivers(t *testing.T) {
	// Setup
	matcher := testutil.NewMockRideMatcher()
	service := NewSimpleDriverMatcher(matcher)

	// Test
	ctx := context.Background()
	drivers, err := service.FindNearbyDrivers(
		ctx,
		testutil.DefaultNigeriaLocation.Lat,
		testutil.DefaultNigeriaLocation.Lng,
		5.0,
	)

	// Assertions
	assert := testutil.NewAssert(t)
	assert.NoError(err)
	assert.Empty(drivers)
}

func TestFindNearbyDrivers_DriversInRange(t *testing.T) {
	// Setup
	matcher := testutil.NewMockRideMatcher()
	
	// Add drivers near Lagos
	matcher.AddDriver(&testutil.MockDriver{
		ID:        "driver-1",
		Lat:       testutil.DefaultNigeriaLocation.Lat + 0.01, // ~1.1km away
		Lng:       testutil.DefaultNigeriaLocation.Lng,
		Status:    "online",
		Rating:    4.8,
		Available: true,
	})
	matcher.AddDriver(&testutil.MockDriver{
		ID:        "driver-2",
		Lat:       testutil.DefaultNigeriaLocation.Lat - 0.01,
		Lng:       testutil.DefaultNigeriaLocation.Lng,
		Status:    "online",
		Rating:    4.5,
		Available: true,
	})

	service := NewSimpleDriverMatcher(matcher)

	// Test
	ctx := context.Background()
	drivers, err := service.FindNearbyDrivers(
		ctx,
		testutil.DefaultNigeriaLocation.Lat,
		testutil.DefaultNigeriaLocation.Lng,
		5.0,
	)

	// Assertions
	assert := testutil.NewAssert(t)
	assert.NoError(err)
	assert.Len(drivers, 2)
}

func TestFindNearbyDrivers_ExcludesOfflineDrivers(t *testing.T) {
	// Setup
	matcher := testutil.NewMockRideMatcher()
	
	matcher.AddDriver(&testutil.MockDriver{
		ID:        "driver-online",
		Lat:       testutil.DefaultNigeriaLocation.Lat + 0.01,
		Lng:       testutil.DefaultNigeriaLocation.Lng,
		Status:    "online",
		Available: true,
	})
	matcher.AddDriver(&testutil.MockDriver{
		ID:        "driver-offline",
		Lat:       testutil.DefaultNigeriaLocation.Lat + 0.01,
		Lng:       testutil.DefaultNigeriaLocation.Lng,
		Status:    "offline", // Should be excluded
		Available: true,
	})

	service := NewSimpleDriverMatcher(matcher)

	// Test
	ctx := context.Background()
	drivers, err := service.FindNearbyDrivers(
		ctx,
		testutil.DefaultNigeriaLocation.Lat,
		testutil.DefaultNigeriaLocation.Lng,
		5.0,
	)

	// Assertions
	assert := testutil.NewAssert(t)
	assert.NoError(err)
	assert.Len(drivers, 1)
	assert.Equal("driver-online", drivers[0].ID)
}

func TestFindNearbyDrivers_ExcludesUnavailableDrivers(t *testing.T) {
	// Setup
	matcher := testutil.NewMockRideMatcher()
	
	matcher.AddDriver(&testutil.MockDriver{
		ID:        "driver-available",
		Lat:       testutil.DefaultNigeriaLocation.Lat + 0.01,
		Lng:       testutil.DefaultNigeriaLocation.Lng,
		Status:    "online",
		Available: true,
	})
	matcher.AddDriver(&testutil.MockDriver{
		ID:        "driver-busy",
		Lat:       testutil.DefaultNigeriaLocation.Lat + 0.01,
		Lng:       testutil.DefaultNigeriaLocation.Lng,
		Status:    "online",
		Available: false, // On another ride
	})

	service := NewSimpleDriverMatcher(matcher)

	// Test
	ctx := context.Background()
	drivers, err := service.FindNearbyDrivers(
		ctx,
		testutil.DefaultNigeriaLocation.Lat,
		testutil.DefaultNigeriaLocation.Lng,
		5.0,
	)

	// Assertions
	assert := testutil.NewAssert(t)
	assert.NoError(err)
	assert.Len(drivers, 1)
	assert.Equal("driver-available", drivers[0].ID)
}

func TestMatchDriver_SelectsHighestRated(t *testing.T) {
	// Setup
	matcher := testutil.NewMockRideMatcher()
	
	matcher.AddDriver(&testutil.MockDriver{
		ID:        "driver-1",
		Lat:       testutil.DefaultNigeriaLocation.Lat + 0.01,
		Lng:       testutil.DefaultNigeriaLocation.Lng,
		Status:    "online",
		Rating:    4.5,
		Available: true,
	})
	matcher.AddDriver(&testutil.MockDriver{
		ID:        "driver-2",
		Lat:       testutil.DefaultNigeriaLocation.Lat + 0.01,
		Lng:       testutil.DefaultNigeriaLocation.Lng,
		Status:    "online",
		Rating:    4.9, // Highest rating
		Available: true,
	})
	matcher.AddDriver(&testutil.MockDriver{
		ID:        "driver-3",
		Lat:       testutil.DefaultNigeriaLocation.Lat + 0.01,
		Lng:       testutil.DefaultNigeriaLocation.Lng,
		Status:    "online",
		Rating:    4.7,
		Available: true,
	})

	service := NewSimpleDriverMatcher(matcher)

	// Test
	ctx := context.Background()
	driver, err := service.MatchDriver(
		ctx,
		"ride-123",
		testutil.DefaultNigeriaLocation.Lat,
		testutil.DefaultNigeriaLocation.Lng,
	)

	// Assertions
	assert := testutil.NewAssert(t)
	assert.NoError(err)
	assert.NotNil(driver)
	assert.Equal("driver-2", driver.ID, "Should select highest rated driver")
	assert.InDelta(4.9, driver.Rating, 0.01)
}

func TestMatchDriver_NoAvailableDrivers(t *testing.T) {
	// Setup
	matcher := testutil.NewMockRideMatcher()
	service := NewSimpleDriverMatcher(matcher)

	// Test
	ctx := context.Background()
	driver, err := service.MatchDriver(
		ctx,
		"ride-123",
		testutil.DefaultNigeriaLocation.Lat,
		testutil.DefaultNigeriaLocation.Lng,
	)

	// Assertions
	assert := testutil.NewAssert(t)
	assert.NoError(err)
	assert.Nil(driver)
}

func TestMatchDriver_WithMatchingDelay(t *testing.T) {
	// Setup
	matcher := testutil.NewMockRideMatcher()
	matcher.SetMatchDelay(100 * time.Millisecond)
	
	matcher.AddDriver(&testutil.MockDriver{
		ID:        "driver-1",
		Lat:       testutil.DefaultNigeriaLocation.Lat + 0.01,
		Lng:       testutil.DefaultNigeriaLocation.Lng,
		Status:    "online",
		Rating:    4.5,
		Available: true,
	})

	service := NewSimpleDriverMatcher(matcher)

	// Test
	ctx := context.Background()
	start := time.Now()
	driver, err := service.MatchDriver(
		ctx,
		"ride-123",
		testutil.DefaultNigeriaLocation.Lat,
		testutil.DefaultNigeriaLocation.Lng,
	)
	elapsed := time.Since(start)

	// Assertions
	assert := testutil.NewAssert(t)
	assert.NoError(err)
	assert.NotNil(driver)
	assert.GreaterOrEqual(elapsed, 100*time.Millisecond, "Should have matching delay")
}

// Table-driven tests for different locations
func TestFindNearbyDrivers_DifferentRegions(t *testing.T) {
	testCases := []struct {
		name       string
		location   testutil.LocationFixture
		driverCount int
	}{
		{
			name:        "Lagos Nigeria",
			location:    testutil.DefaultNigeriaLocation,
			driverCount: 5,
		},
		{
			name:        "Nairobi Kenya",
			location:    testutil.DefaultKenyaLocation,
			driverCount: 3,
		},
		{
			name:        "Cape Town South Africa",
			location:    testutil.DefaultSouthAfricaLocation,
			driverCount: 4,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup
			matcher := testutil.NewMockRideMatcher()
			
			// Generate drivers for the location
			for i := 0; i < tc.driverCount; i++ {
				matcher.AddDriver(&testutil.MockDriver{
					ID:        testutil.RandomUUID(),
					Lat:       tc.location.Lat + float64(i)*0.005,
					Lng:       tc.location.Lng,
					Status:    "online",
					Rating:    4.0 + float64(i)*0.1,
					Available: true,
				})
			}

			service := NewSimpleDriverMatcher(matcher)

			// Test
			ctx := context.Background()
			drivers, err := service.FindNearbyDrivers(
				ctx,
				tc.location.Lat,
				tc.location.Lng,
				10.0, // 10km radius
			)

			// Assertions
			assert := testutil.NewAssert(t)
			assert.NoError(err)
			assert.Len(drivers, tc.driverCount)
		})
	}
}

// Benchmark tests
func BenchmarkFindNearbyDrivers(b *testing.B) {
	// Setup with 100 drivers
	matcher := testutil.NewMockRideMatcher()
	for i := 0; i < 100; i++ {
		matcher.AddDriver(&testutil.MockDriver{
			ID:        testutil.RandomUUID(),
			Lat:       testutil.DefaultNigeriaLocation.Lat + float64(i%10)*0.01,
			Lng:       testutil.DefaultNigeriaLocation.Lng + float64(i/10)*0.01,
			Status:    "online",
			Rating:    testutil.RandomRating(),
			Available: i%3 != 0, // 2/3 available
		})
	}

	service := NewSimpleDriverMatcher(matcher)
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		service.FindNearbyDrivers(
			ctx,
			testutil.DefaultNigeriaLocation.Lat,
			testutil.DefaultNigeriaLocation.Lng,
			5.0,
		)
	}
}

func BenchmarkMatchDriver(b *testing.B) {
	// Setup with 100 drivers
	matcher := testutil.NewMockRideMatcher()
	for i := 0; i < 100; i++ {
		matcher.AddDriver(&testutil.MockDriver{
			ID:        testutil.RandomUUID(),
			Lat:       testutil.DefaultNigeriaLocation.Lat + float64(i%10)*0.01,
			Lng:       testutil.DefaultNigeriaLocation.Lng + float64(i/10)*0.01,
			Status:    "online",
			Rating:    testutil.RandomRating(),
			Available: true,
		})
	}

	service := NewSimpleDriverMatcher(matcher)
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		service.MatchDriver(
			ctx,
			"ride-123",
			testutil.DefaultNigeriaLocation.Lat,
			testutil.DefaultNigeriaLocation.Lng,
		)
	}
}
