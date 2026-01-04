// Package service implements the business logic for the ride service.
package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/pricing"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/redis"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/repository"
)

// RideService handles ride business logic
type RideService struct {
	rideRepo      *repository.RideRepository
	driverPool    *redis.DriverPool
	pricingEngine *pricing.Engine
}

// NewRideService creates a new ride service
func NewRideService(
	rideRepo *repository.RideRepository,
	driverPool *redis.DriverPool,
	pricingEngine *pricing.Engine,
) *RideService {
	return &RideService{
		rideRepo:      rideRepo,
		driverPool:    driverPool,
		pricingEngine: pricingEngine,
	}
}

// RequestRide creates a new ride request
func (s *RideService) RequestRide(ctx context.Context, req *domain.RideRequest) (*domain.Ride, error) {
	// Check if rider already has an active ride
	if s.rideRepo != nil {
		activeRide, err := s.rideRepo.GetActiveByRider(ctx, req.RiderID)
		if err != nil {
			return nil, err
		}
		if activeRide != nil {
			return nil, domain.ErrRideNotActive
		}
	}
	
	// Calculate route and pricing
	distance := geo.HaversineDistance(
		req.PickupLocation.Latitude, req.PickupLocation.Longitude,
		req.DropoffLocation.Latitude, req.DropoffLocation.Longitude,
	)
	
	// Add stops to distance
	if len(req.Stops) > 0 {
		prevLat := req.PickupLocation.Latitude
		prevLng := req.PickupLocation.Longitude
		
		for _, stop := range req.Stops {
			distance += geo.HaversineDistance(prevLat, prevLng, stop.Latitude, stop.Longitude)
			prevLat = stop.Latitude
			prevLng = stop.Longitude
		}
		
		// Add final leg to dropoff
		distance += geo.HaversineDistance(prevLat, prevLng, req.DropoffLocation.Latitude, req.DropoffLocation.Longitude)
	}
	
	// Estimate duration
	duration := geo.EstimateETA(distance, string(req.Type))
	duration = geo.EstimateETAWithTraffic(duration, time.Now().Hour())
	
	// Create ride
	ride := domain.NewRide(req)
	
	// Set route info
	ride.Route = &domain.RouteInfo{
		DistanceMeters:  int64(distance),
		DurationSeconds: duration,
	}
	
	// Calculate price
	h3Cell := req.PickupLocation.H3Cell
	if h3Cell == "" {
		h3Cell = geo.H3Cell(req.PickupLocation.Latitude, req.PickupLocation.Longitude, geo.H3Resolution)
	}
	
	price, err := s.pricingEngine.CalculatePrice(
		req.Type,
		distance,
		duration,
		domain.CurrencyNGN, // Default - should be based on location
		h3Cell,
		0, // NOTE: Promo discount lookup handled by promotion service
	)
	if err != nil {
		log.Error().Err(err).Msg("Failed to calculate price")
	} else {
		ride.Price = price
	}
	
	// Set status to searching
	ride.Status = domain.RideStatusSearching
	
	// Persist ride
	if s.rideRepo != nil {
		if err := s.rideRepo.Create(ctx, ride); err != nil {
			return nil, err
		}
	}
	
	// Cache ride
	if s.driverPool != nil {
		_ = s.driverPool.CacheRide(ctx, ride)
	}
	
	log.Info().
		Str("ride_id", ride.ID.String()).
		Str("rider_id", ride.RiderID.String()).
		Str("type", string(ride.Type)).
		Float64("distance", distance).
		Msg("Ride request created")
	
	// NOTE: Matching process is started via the matching engine
	
	return ride, nil
}

// GetRide retrieves a ride by ID
func (s *RideService) GetRide(ctx context.Context, rideID uuid.UUID) (*domain.Ride, error) {
	// Check cache first
	if s.driverPool != nil {
		if cached, err := s.driverPool.GetCachedRide(ctx, rideID); err == nil && cached != nil {
			return cached, nil
		}
	}
	
	// Get from database
	if s.rideRepo != nil {
		ride, err := s.rideRepo.GetByID(ctx, rideID)
		if err != nil {
			return nil, err
		}
		
		// Update cache
		if s.driverPool != nil {
			_ = s.driverPool.CacheRide(ctx, ride)
		}
		
		return ride, nil
	}
	
	return nil, domain.ErrRideNotFound
}

// CancelRide cancels a ride
func (s *RideService) CancelRide(ctx context.Context, rideID, userID uuid.UUID, reason string) error {
	ride, err := s.GetRide(ctx, rideID)
	if err != nil {
		return err
	}
	
	// Validate user can cancel
	if ride.RiderID != userID && (ride.DriverID == nil || *ride.DriverID != userID) {
		return domain.ErrForbidden
	}
	
	// Cancel the ride
	if err := ride.Cancel(userID, reason); err != nil {
		return err
	}
	
	// Update database
	if s.rideRepo != nil {
		if err := s.rideRepo.Update(ctx, ride); err != nil {
			return err
		}
	}
	
	// Invalidate cache
	if s.driverPool != nil {
		_ = s.driverPool.InvalidateRideCache(ctx, rideID)
	}
	
	// If driver was assigned, free them
	if ride.DriverID != nil && s.driverPool != nil {
		_ = s.driverPool.SetDriverStatus(ctx, *ride.DriverID, domain.DriverStatusOnline)
	}
	
	log.Info().
		Str("ride_id", rideID.String()).
		Str("cancelled_by", userID.String()).
		Str("reason", reason).
		Msg("Ride cancelled")
	
	return nil
}

// UpdateRideStatus updates the status of a ride
func (s *RideService) UpdateRideStatus(ctx context.Context, rideID uuid.UUID, status domain.RideStatus) error {
	ride, err := s.GetRide(ctx, rideID)
	if err != nil {
		return err
	}
	
	if err := ride.UpdateStatus(status); err != nil {
		return err
	}
	
	// Update database
	if s.rideRepo != nil {
		if err := s.rideRepo.Update(ctx, ride); err != nil {
			return err
		}
	}
	
	// Update cache
	if s.driverPool != nil {
		_ = s.driverPool.CacheRide(ctx, ride)
	}
	
	// Handle status-specific actions
	if status == domain.RideStatusCompleted && ride.DriverID != nil {
		// Free up driver
		if s.driverPool != nil {
			_ = s.driverPool.SetDriverStatus(ctx, *ride.DriverID, domain.DriverStatusOnline)
		}
	}
	
	log.Info().
		Str("ride_id", rideID.String()).
		Str("status", string(status)).
		Msg("Ride status updated")
	
	return nil
}

// RateRide adds a rating to a completed ride
func (s *RideService) RateRide(ctx context.Context, rideID uuid.UUID, rating float32, isRider bool) error {
	ride, err := s.GetRide(ctx, rideID)
	if err != nil {
		return err
	}
	
	if ride.Status != domain.RideStatusCompleted {
		return domain.ErrRideNotActive
	}
	
	if isRider {
		ride.DriverRating = &rating
	} else {
		ride.RiderRating = &rating
	}
	
	ride.UpdatedAt = time.Now().UTC()
	
	// Update database
	if s.rideRepo != nil {
		if err := s.rideRepo.Update(ctx, ride); err != nil {
			return err
		}
	}
	
	// Invalidate cache
	if s.driverPool != nil {
		_ = s.driverPool.InvalidateRideCache(ctx, rideID)
	}
	
	return nil
}

// GetActiveRide gets the active ride for a user
func (s *RideService) GetActiveRide(ctx context.Context, userID uuid.UUID, isRider bool) (*domain.Ride, error) {
	if s.rideRepo == nil {
		return nil, nil
	}
	
	if isRider {
		return s.rideRepo.GetActiveByRider(ctx, userID)
	}
	return s.rideRepo.GetActiveByDriver(ctx, userID)
}

// GetRideHistory gets ride history for a user
func (s *RideService) GetRideHistory(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*domain.Ride, int64, error) {
	if s.rideRepo == nil {
		return nil, 0, nil
	}
	
	return s.rideRepo.GetRiderHistory(ctx, userID, limit, offset)
}

// DriverService handles driver-related business logic
type DriverService struct {
	driverRepo *repository.DriverRepository
	driverPool *redis.DriverPool
}

// NewDriverService creates a new driver service
func NewDriverService(
	driverRepo *repository.DriverRepository,
	driverPool *redis.DriverPool,
) *DriverService {
	return &DriverService{
		driverRepo: driverRepo,
		driverPool: driverPool,
	}
}

// GetNearbyDrivers finds drivers near a location
func (s *DriverService) GetNearbyDrivers(ctx context.Context, lat, lng, radius float64, rideType domain.RideType) ([]*domain.NearbyDriver, error) {
	// Use Redis for real-time location data
	if s.driverPool != nil {
		return s.driverPool.GetNearbyDrivers(ctx, lat, lng, radius, rideType)
	}
	
	// Fall back to database
	if s.driverRepo != nil {
		return s.driverRepo.GetNearby(ctx, lat, lng, radius, &rideType)
	}
	
	return nil, nil
}

// UpdateLocation updates a driver's location
func (s *DriverService) UpdateLocation(ctx context.Context, driverID uuid.UUID, loc *domain.DriverLocation) error {
	// Update in Redis for real-time access
	if s.driverPool != nil {
		if err := s.driverPool.UpdateLocation(ctx, loc); err != nil {
			log.Error().Err(err).Msg("Failed to update driver location in Redis")
		}
	}
	
	// Persist to database (less frequently in production)
	if s.driverRepo != nil {
		if err := s.driverRepo.UpdateLocation(ctx, driverID, loc); err != nil {
			log.Error().Err(err).Msg("Failed to persist driver location")
		}
	}
	
	return nil
}

// AcceptRide handles a driver accepting a ride
func (s *DriverService) AcceptRide(ctx context.Context, rideID, driverID uuid.UUID) error {
	// Check if driver is available
	if s.driverPool != nil {
		status, err := s.driverPool.GetDriverStatus(ctx, driverID)
		if err != nil {
			return err
		}
		if status != domain.DriverStatusOnline {
			return domain.ErrDriverNotAvailable
		}
		
		// Check if driver is locked
		if s.driverPool.IsDriverLocked(ctx, driverID) {
			return domain.ErrDriverBusy
		}
	}
	
	// Assign driver to ride in database
	if s.driverRepo != nil {
		if err := s.driverRepo.AssignRide(ctx, driverID, rideID); err != nil {
			return err
		}
	}
	
	// Update driver status
	if s.driverPool != nil {
		_ = s.driverPool.SetDriverStatus(ctx, driverID, domain.DriverStatusOnRide)
	}
	
	log.Info().
		Str("ride_id", rideID.String()).
		Str("driver_id", driverID.String()).
		Msg("Driver accepted ride")
	
	return nil
}

// DeclineRide handles a driver declining a ride
func (s *DriverService) DeclineRide(ctx context.Context, rideID, driverID uuid.UUID) error {
	// Unlock driver if locked
	if s.driverPool != nil {
		_ = s.driverPool.UnlockDriver(ctx, driverID)
	}
	
	log.Info().
		Str("ride_id", rideID.String()).
		Str("driver_id", driverID.String()).
		Msg("Driver declined ride")
	
	return nil
}

// SetDriverStatus sets a driver's operational status
func (s *DriverService) SetDriverStatus(ctx context.Context, driverID uuid.UUID, status domain.DriverStatus) error {
	// Update in Redis
	if s.driverPool != nil {
		if err := s.driverPool.SetDriverStatus(ctx, driverID, status); err != nil {
			return err
		}
	}
	
	// Update in database
	if s.driverRepo != nil {
		if err := s.driverRepo.UpdateStatus(ctx, driverID, status); err != nil {
			return err
		}
	}
	
	return nil
}

// GetDriver gets a driver by ID
func (s *DriverService) GetDriver(ctx context.Context, driverID uuid.UUID) (*domain.Driver, error) {
	if s.driverRepo != nil {
		return s.driverRepo.GetByID(ctx, driverID)
	}
	return nil, domain.ErrDriverNotFound
}
