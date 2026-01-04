// Package redis provides Redis-based driver location tracking and caching.
package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
)

const (
	// Key prefixes
	driverLocationKey    = "driver:location:"
	driverStatusKey      = "driver:status:"
	driverLockKey        = "driver:lock:"
	rideCacheKey         = "ride:"
	h3CellDriversKey     = "h3:drivers:"
	surgeDataKey         = "surge:"
	activeDriversKey     = "drivers:active"
	rideMatchingKey      = "matching:ride:"
	
	// TTLs
	locationTTL          = 5 * time.Minute
	driverStatusTTL      = 1 * time.Hour
	rideCacheTTL         = 30 * time.Minute
	surgeTTL             = 5 * time.Minute
	matchingLockTTL      = 60 * time.Second
)

// DriverPool manages driver locations and availability in Redis
type DriverPool struct {
	client *redis.Client
}

// NewDriverPool creates a new Redis driver pool
func NewDriverPool(client *redis.Client) *DriverPool {
	return &DriverPool{client: client}
}

// DriverLocationData represents driver location stored in Redis
type DriverLocationData struct {
	DriverID   string    `json:"driver_id"`
	Latitude   float64   `json:"latitude"`
	Longitude  float64   `json:"longitude"`
	Heading    float64   `json:"heading"`
	Speed      float64   `json:"speed"`
	H3Cell     string    `json:"h3_cell"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// UpdateLocation updates a driver's location in Redis
func (p *DriverPool) UpdateLocation(ctx context.Context, loc *domain.DriverLocation) error {
	data := DriverLocationData{
		DriverID:  loc.DriverID.String(),
		Latitude:  loc.Location.Latitude,
		Longitude: loc.Location.Longitude,
		Heading:   loc.Heading,
		Speed:     loc.Speed,
		H3Cell:    loc.Location.H3Cell,
		UpdatedAt: loc.Timestamp,
	}
	
	// Store location data
	locationJSON, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal location: %w", err)
	}
	
	pipe := p.client.Pipeline()
	
	// Store driver location
	pipe.Set(ctx, driverLocationKey+loc.DriverID.String(), locationJSON, locationTTL)
	
	// Add to geo index for proximity search
	pipe.GeoAdd(ctx, activeDriversKey, &redis.GeoLocation{
		Name:      loc.DriverID.String(),
		Latitude:  loc.Location.Latitude,
		Longitude: loc.Location.Longitude,
	})
	
	// Add to H3 cell index
	if loc.Location.H3Cell != "" {
		// Get old cell to remove from
		oldData, err := p.GetDriverLocation(ctx, loc.DriverID)
		if err == nil && oldData != nil && oldData.H3Cell != loc.Location.H3Cell {
			pipe.SRem(ctx, h3CellDriversKey+oldData.H3Cell, loc.DriverID.String())
		}
		pipe.SAdd(ctx, h3CellDriversKey+loc.Location.H3Cell, loc.DriverID.String())
		pipe.Expire(ctx, h3CellDriversKey+loc.Location.H3Cell, locationTTL)
	}
	
	_, err = pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to update location: %w", err)
	}
	
	log.Debug().
		Str("driver_id", loc.DriverID.String()).
		Float64("lat", loc.Location.Latitude).
		Float64("lng", loc.Location.Longitude).
		Str("h3_cell", loc.Location.H3Cell).
		Msg("Updated driver location in Redis")
	
	return nil
}

// GetDriverLocation gets a driver's current location
func (p *DriverPool) GetDriverLocation(ctx context.Context, driverID uuid.UUID) (*DriverLocationData, error) {
	data, err := p.client.Get(ctx, driverLocationKey+driverID.String()).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, err
	}
	
	var loc DriverLocationData
	if err := json.Unmarshal(data, &loc); err != nil {
		return nil, err
	}
	
	return &loc, nil
}

// GetNearbyDrivers finds drivers near a location using Redis GEO
func (p *DriverPool) GetNearbyDrivers(ctx context.Context, lat, lng, radiusM float64, rideType domain.RideType) ([]*domain.NearbyDriver, error) {
	// Use GEORADIUS to find nearby drivers
	results, err := p.client.GeoRadius(ctx, activeDriversKey, lng, lat, &redis.GeoRadiusQuery{
		Radius:      radiusM,
		Unit:        "m",
		WithCoord:   true,
		WithDist:    true,
		WithGeoHash: false,
		Count:       50,
		Sort:        "ASC", // Closest first
	}).Result()
	
	if err != nil {
		return nil, fmt.Errorf("failed to search nearby drivers: %w", err)
	}
	
	var drivers []*domain.NearbyDriver
	
	for _, result := range results {
		driverID, err := uuid.Parse(result.Name)
		if err != nil {
			continue
		}
		
		// Get driver's full location data
		locData, err := p.GetDriverLocation(ctx, driverID)
		if err != nil || locData == nil {
			continue
		}
		
		// Check if location is fresh (within last 5 minutes)
		if time.Since(locData.UpdatedAt) > locationTTL {
			continue
		}
		
		// Get driver status
		status, err := p.GetDriverStatus(ctx, driverID)
		if err != nil || status != domain.DriverStatusOnline {
			continue
		}
		
		// Check if driver is locked (being matched)
		if p.IsDriverLocked(ctx, driverID) {
			continue
		}
		
		// Calculate ETA
		eta := geo.EstimateETA(result.Dist, "car")
		
		driver := &domain.NearbyDriver{
			Driver: &domain.Driver{
				ID:     driverID,
				Status: domain.DriverStatusOnline,
				CurrentLocation: &domain.Location{
					Latitude:  result.Latitude,
					Longitude: result.Longitude,
					H3Cell:    locData.H3Cell,
				},
				Heading: locData.Heading,
				Speed:   locData.Speed,
			},
			DistanceM:  result.Dist,
			ETASeconds: eta,
		}
		
		drivers = append(drivers, driver)
	}
	
	return drivers, nil
}

// GetDriversInCell gets all drivers in an H3 cell
func (p *DriverPool) GetDriversInCell(ctx context.Context, h3Cell string) ([]uuid.UUID, error) {
	members, err := p.client.SMembers(ctx, h3CellDriversKey+h3Cell).Result()
	if err != nil {
		return nil, err
	}
	
	var driverIDs []uuid.UUID
	for _, member := range members {
		if id, err := uuid.Parse(member); err == nil {
			driverIDs = append(driverIDs, id)
		}
	}
	
	return driverIDs, nil
}

// CountDriversInCell counts active drivers in an H3 cell
func (p *DriverPool) CountDriversInCell(ctx context.Context, h3Cell string) (int64, error) {
	return p.client.SCard(ctx, h3CellDriversKey+h3Cell).Result()
}

// SetDriverStatus sets a driver's status
func (p *DriverPool) SetDriverStatus(ctx context.Context, driverID uuid.UUID, status domain.DriverStatus) error {
	err := p.client.Set(ctx, driverStatusKey+driverID.String(), string(status), driverStatusTTL).Err()
	if err != nil {
		return err
	}
	
	// If going offline, remove from active drivers
	if status == domain.DriverStatusOffline {
		p.client.ZRem(ctx, activeDriversKey, driverID.String())
	}
	
	return nil
}

// GetDriverStatus gets a driver's status
func (p *DriverPool) GetDriverStatus(ctx context.Context, driverID uuid.UUID) (domain.DriverStatus, error) {
	status, err := p.client.Get(ctx, driverStatusKey+driverID.String()).Result()
	if err != nil {
		if err == redis.Nil {
			return domain.DriverStatusOffline, nil
		}
		return "", err
	}
	return domain.DriverStatus(status), nil
}

// LockDriver temporarily locks a driver for matching
func (p *DriverPool) LockDriver(ctx context.Context, driverID uuid.UUID, duration time.Duration) error {
	ok, err := p.client.SetNX(ctx, driverLockKey+driverID.String(), "1", duration).Result()
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrDriverBusy
	}
	return nil
}

// UnlockDriver releases a driver lock
func (p *DriverPool) UnlockDriver(ctx context.Context, driverID uuid.UUID) error {
	return p.client.Del(ctx, driverLockKey+driverID.String()).Err()
}

// IsDriverLocked checks if a driver is locked
func (p *DriverPool) IsDriverLocked(ctx context.Context, driverID uuid.UUID) bool {
	exists, _ := p.client.Exists(ctx, driverLockKey+driverID.String()).Result()
	return exists > 0
}

// RemoveDriver removes a driver from all indices
func (p *DriverPool) RemoveDriver(ctx context.Context, driverID uuid.UUID) error {
	// Get current location to find H3 cell
	locData, _ := p.GetDriverLocation(ctx, driverID)
	
	pipe := p.client.Pipeline()
	
	pipe.Del(ctx, driverLocationKey+driverID.String())
	pipe.Del(ctx, driverStatusKey+driverID.String())
	pipe.Del(ctx, driverLockKey+driverID.String())
	pipe.ZRem(ctx, activeDriversKey, driverID.String())
	
	if locData != nil && locData.H3Cell != "" {
		pipe.SRem(ctx, h3CellDriversKey+locData.H3Cell, driverID.String())
	}
	
	_, err := pipe.Exec(ctx)
	return err
}

// Surge pricing helpers

// SurgeData represents surge pricing data
type SurgeData struct {
	Cell            string  `json:"cell"`
	Multiplier      float64 `json:"multiplier"`
	ActiveDrivers   int     `json:"active_drivers"`
	PendingRequests int     `json:"pending_requests"`
	UpdatedAt       int64   `json:"updated_at"`
}

// GetSurgeData gets surge data for an H3 cell
func (p *DriverPool) GetSurgeData(ctx context.Context, h3Cell string) (*SurgeData, error) {
	data, err := p.client.Get(ctx, surgeDataKey+h3Cell).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, err
	}
	
	var surge SurgeData
	if err := json.Unmarshal(data, &surge); err != nil {
		return nil, err
	}
	
	return &surge, nil
}

// SetSurgeData sets surge data for an H3 cell
func (p *DriverPool) SetSurgeData(ctx context.Context, data *SurgeData) error {
	data.UpdatedAt = time.Now().Unix()
	
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	
	return p.client.Set(ctx, surgeDataKey+data.Cell, jsonData, surgeTTL).Err()
}

// Ride caching

// CacheRide caches a ride
func (p *DriverPool) CacheRide(ctx context.Context, ride *domain.Ride) error {
	data, err := json.Marshal(ride)
	if err != nil {
		return err
	}
	return p.client.Set(ctx, rideCacheKey+ride.ID.String(), data, rideCacheTTL).Err()
}

// GetCachedRide gets a cached ride
func (p *DriverPool) GetCachedRide(ctx context.Context, rideID uuid.UUID) (*domain.Ride, error) {
	data, err := p.client.Get(ctx, rideCacheKey+rideID.String()).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, err
	}
	
	var ride domain.Ride
	if err := json.Unmarshal(data, &ride); err != nil {
		return nil, err
	}
	
	return &ride, nil
}

// InvalidateRideCache removes a ride from cache
func (p *DriverPool) InvalidateRideCache(ctx context.Context, rideID uuid.UUID) error {
	return p.client.Del(ctx, rideCacheKey+rideID.String()).Err()
}

// Matching helpers

// SetMatchingLock sets a lock for ride matching
func (p *DriverPool) SetMatchingLock(ctx context.Context, rideID uuid.UUID) (bool, error) {
	return p.client.SetNX(ctx, rideMatchingKey+rideID.String(), "1", matchingLockTTL).Result()
}

// ReleaseMatchingLock releases a matching lock
func (p *DriverPool) ReleaseMatchingLock(ctx context.Context, rideID uuid.UUID) error {
	return p.client.Del(ctx, rideMatchingKey+rideID.String()).Err()
}

// Analytics helpers

// IncrementMetric increments a metric counter
func (p *DriverPool) IncrementMetric(ctx context.Context, metric string, value int64) error {
	key := fmt.Sprintf("metrics:%s:%s", metric, time.Now().Format("2006-01-02"))
	return p.client.IncrBy(ctx, key, value).Err()
}

// GetMetric gets a metric value
func (p *DriverPool) GetMetric(ctx context.Context, metric string, date time.Time) (int64, error) {
	key := fmt.Sprintf("metrics:%s:%s", metric, date.Format("2006-01-02"))
	result, err := p.client.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return 0, nil
		}
		return 0, err
	}
	return strconv.ParseInt(result, 10, 64)
}

// Health check

// Ping checks Redis connectivity
func (p *DriverPool) Ping(ctx context.Context) error {
	return p.client.Ping(ctx).Err()
}
