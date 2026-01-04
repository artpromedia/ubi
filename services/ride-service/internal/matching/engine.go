// Package matching implements the driver matching engine for rides.
package matching

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
)

// Config holds matching engine configuration
type Config struct {
	// Maximum search radius in meters
	MaxSearchRadius float64
	
	// Initial search radius in meters
	InitialSearchRadius float64
	
	// Radius expansion step in meters
	RadiusExpansionStep float64
	
	// Maximum drivers to consider
	MaxDriversToConsider int
	
	// Driver offer timeout
	OfferTimeout time.Duration
	
	// Maximum matching attempts before giving up
	MaxMatchingAttempts int
	
	// Time between matching attempts
	MatchingInterval time.Duration
}

// DefaultConfig returns default matching configuration
func DefaultConfig() *Config {
	return &Config{
		MaxSearchRadius:      15000, // 15km
		InitialSearchRadius:  3000,  // 3km
		RadiusExpansionStep:  2000,  // 2km
		MaxDriversToConsider: 10,
		OfferTimeout:         30 * time.Second,
		MaxMatchingAttempts:  5,
		MatchingInterval:     15 * time.Second,
	}
}

// DriverPool manages available drivers
type DriverPool interface {
	// GetNearbyDrivers returns drivers near a location
	GetNearbyDrivers(ctx context.Context, lat, lng, radiusM float64, rideType domain.RideType) ([]*domain.NearbyDriver, error)
	
	// GetDriver returns a driver by ID
	GetDriver(ctx context.Context, driverID uuid.UUID) (*domain.Driver, error)
	
	// LockDriver temporarily locks a driver for matching
	LockDriver(ctx context.Context, driverID uuid.UUID, duration time.Duration) error
	
	// UnlockDriver releases a locked driver
	UnlockDriver(ctx context.Context, driverID uuid.UUID) error
	
	// IsDriverLocked checks if a driver is locked
	IsDriverLocked(ctx context.Context, driverID uuid.UUID) bool
}

// OfferSender sends ride offers to drivers
type OfferSender interface {
	// SendOffer sends a ride offer to a driver
	SendOffer(ctx context.Context, driverID uuid.UUID, ride *domain.Ride, etaSeconds int64) error
}

// Engine is the main matching engine
type Engine struct {
	config     *Config
	driverPool DriverPool
	sender     OfferSender
	
	// Active matching sessions
	sessions   map[uuid.UUID]*MatchingSession
	sessionsMu sync.RWMutex
}

// MatchingSession tracks an active matching attempt
type MatchingSession struct {
	Ride           *domain.Ride
	StartedAt      time.Time
	Attempt        int
	CurrentRadius  float64
	OfferedDrivers map[uuid.UUID]time.Time
	Status         MatchingStatus
	ResultCh       chan *MatchResult
	CancelFunc     context.CancelFunc
}

// MatchingStatus represents the status of a matching session
type MatchingStatus int

const (
	MatchingStatusSearching MatchingStatus = iota
	MatchingStatusMatched
	MatchingStatusFailed
	MatchingStatusCancelled
)

// MatchResult represents the result of a matching attempt
type MatchResult struct {
	Success   bool
	DriverID  uuid.UUID
	VehicleID uuid.UUID
	ETA       int64
	Error     error
}

// NewEngine creates a new matching engine
func NewEngine(config *Config, pool DriverPool, sender OfferSender) *Engine {
	if config == nil {
		config = DefaultConfig()
	}
	
	return &Engine{
		config:     config,
		driverPool: pool,
		sender:     sender,
		sessions:   make(map[uuid.UUID]*MatchingSession),
	}
}

// StartMatching begins the matching process for a ride
func (e *Engine) StartMatching(ctx context.Context, ride *domain.Ride) (<-chan *MatchResult, error) {
	// Validate ride
	if ride.Status != domain.RideStatusPending && ride.Status != domain.RideStatusSearching {
		return nil, domain.ErrInvalidStatusTransition
	}
	
	// Check if already matching
	e.sessionsMu.Lock()
	if _, exists := e.sessions[ride.ID]; exists {
		e.sessionsMu.Unlock()
		return nil, domain.ErrRideAlreadyAssigned
	}
	
	// Create matching context with cancellation
	matchCtx, cancel := context.WithCancel(ctx)
	
	// Create session
	session := &MatchingSession{
		Ride:           ride,
		StartedAt:      time.Now(),
		Attempt:        0,
		CurrentRadius:  e.config.InitialSearchRadius,
		OfferedDrivers: make(map[uuid.UUID]time.Time),
		Status:         MatchingStatusSearching,
		ResultCh:       make(chan *MatchResult, 1),
		CancelFunc:     cancel,
	}
	
	e.sessions[ride.ID] = session
	e.sessionsMu.Unlock()
	
	// Start matching goroutine
	go e.runMatching(matchCtx, session)
	
	return session.ResultCh, nil
}

// CancelMatching cancels an active matching session
func (e *Engine) CancelMatching(rideID uuid.UUID) error {
	e.sessionsMu.Lock()
	session, exists := e.sessions[rideID]
	if !exists {
		e.sessionsMu.Unlock()
		return domain.ErrRideNotFound
	}
	
	session.Status = MatchingStatusCancelled
	session.CancelFunc()
	delete(e.sessions, rideID)
	e.sessionsMu.Unlock()
	
	return nil
}

// AcceptRide handles a driver accepting a ride
func (e *Engine) AcceptRide(ctx context.Context, rideID, driverID uuid.UUID) (*MatchResult, error) {
	e.sessionsMu.Lock()
	session, exists := e.sessions[rideID]
	if !exists {
		e.sessionsMu.Unlock()
		return nil, domain.ErrRideNotFound
	}
	
	// Check if driver was offered this ride
	offerTime, offered := session.OfferedDrivers[driverID]
	if !offered {
		e.sessionsMu.Unlock()
		return nil, domain.ErrUnauthorized
	}
	
	// Check if offer has expired
	if time.Since(offerTime) > e.config.OfferTimeout {
		e.sessionsMu.Unlock()
		return nil, domain.ErrMatchingTimeout
	}
	
	// Get driver details
	driver, err := e.driverPool.GetDriver(ctx, driverID)
	if err != nil {
		e.sessionsMu.Unlock()
		return nil, err
	}
	
	if !driver.IsAvailable() {
		e.sessionsMu.Unlock()
		return nil, domain.ErrDriverNotAvailable
	}
	
	// Calculate ETA
	eta := e.calculateETA(session.Ride.PickupLocation, *driver.CurrentLocation, driver.Vehicle.Type)
	
	// Create result
	result := &MatchResult{
		Success:   true,
		DriverID:  driverID,
		VehicleID: driver.Vehicle.ID,
		ETA:       eta,
	}
	
	session.Status = MatchingStatusMatched
	session.CancelFunc() // Stop matching
	
	// Send result through channel
	select {
	case session.ResultCh <- result:
	default:
	}
	
	delete(e.sessions, rideID)
	e.sessionsMu.Unlock()
	
	return result, nil
}

// DeclineRide handles a driver declining a ride
func (e *Engine) DeclineRide(rideID, driverID uuid.UUID) error {
	e.sessionsMu.RLock()
	session, exists := e.sessions[rideID]
	if !exists {
		e.sessionsMu.RUnlock()
		return domain.ErrRideNotFound
	}
	e.sessionsMu.RUnlock()
	
	// Mark driver as having declined (won't be offered again)
	e.sessionsMu.Lock()
	session.OfferedDrivers[driverID] = time.Time{} // Zero time = declined
	e.sessionsMu.Unlock()
	
	// Unlock driver
	_ = e.driverPool.UnlockDriver(context.Background(), driverID)
	
	return nil
}

// runMatching runs the matching algorithm
func (e *Engine) runMatching(ctx context.Context, session *MatchingSession) {
	defer func() {
		close(session.ResultCh)
		e.sessionsMu.Lock()
		delete(e.sessions, session.Ride.ID)
		e.sessionsMu.Unlock()
	}()
	
	ride := session.Ride
	
	for session.Attempt < e.config.MaxMatchingAttempts {
		select {
		case <-ctx.Done():
			session.Status = MatchingStatusCancelled
			return
		default:
		}
		
		session.Attempt++
		log.Info().
			Str("ride_id", ride.ID.String()).
			Int("attempt", session.Attempt).
			Float64("radius", session.CurrentRadius).
			Msg("Starting matching attempt")
		
		// Find nearby drivers
		drivers, err := e.driverPool.GetNearbyDrivers(
			ctx,
			ride.PickupLocation.Latitude,
			ride.PickupLocation.Longitude,
			session.CurrentRadius,
			ride.Type,
		)
		
		if err != nil {
			log.Error().Err(err).Msg("Failed to get nearby drivers")
			continue
		}
		
		// Filter out already offered/declined drivers
		candidates := e.filterCandidates(session, drivers)
		
		if len(candidates) == 0 {
			log.Info().Msg("No candidates found, expanding radius")
			session.CurrentRadius = min(
				session.CurrentRadius+e.config.RadiusExpansionStep,
				e.config.MaxSearchRadius,
			)
			time.Sleep(e.config.MatchingInterval)
			continue
		}
		
		// Rank candidates
		ranked := e.rankCandidates(candidates, ride)
		
		// Send offers to top candidates
		for i, candidate := range ranked {
			if i >= e.config.MaxDriversToConsider {
				break
			}
			
			// Lock driver
			if err := e.driverPool.LockDriver(ctx, candidate.Driver.ID, e.config.OfferTimeout); err != nil {
				continue
			}
			
			// Record offer
			session.OfferedDrivers[candidate.Driver.ID] = time.Now()
			
			// Send offer
			if err := e.sender.SendOffer(ctx, candidate.Driver.ID, ride, candidate.ETASeconds); err != nil {
				log.Error().Err(err).
					Str("driver_id", candidate.Driver.ID.String()).
					Msg("Failed to send offer")
				_ = e.driverPool.UnlockDriver(ctx, candidate.Driver.ID)
				continue
			}
			
			log.Info().
				Str("driver_id", candidate.Driver.ID.String()).
				Int64("eta", candidate.ETASeconds).
				Msg("Sent ride offer to driver")
		}
		
		// Wait for responses
		timer := time.NewTimer(e.config.OfferTimeout)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			// Timeout - unlock all offered drivers and try again
			for driverID, offerTime := range session.OfferedDrivers {
				if !offerTime.IsZero() && time.Since(offerTime) > e.config.OfferTimeout {
					_ = e.driverPool.UnlockDriver(ctx, driverID)
				}
			}
		}
		
		// Expand radius for next attempt
		session.CurrentRadius = min(
			session.CurrentRadius+e.config.RadiusExpansionStep,
			e.config.MaxSearchRadius,
		)
	}
	
	// All attempts exhausted
	session.Status = MatchingStatusFailed
	session.ResultCh <- &MatchResult{
		Success: false,
		Error:   domain.ErrNoDriversAvailable,
	}
}

// filterCandidates removes drivers that have already been offered or declined
func (e *Engine) filterCandidates(session *MatchingSession, drivers []*domain.NearbyDriver) []*domain.NearbyDriver {
	var candidates []*domain.NearbyDriver
	
	for _, d := range drivers {
		// Skip if already offered
		if _, offered := session.OfferedDrivers[d.Driver.ID]; offered {
			continue
		}
		
		// Skip if locked
		if e.driverPool.IsDriverLocked(context.Background(), d.Driver.ID) {
			continue
		}
		
		candidates = append(candidates, d)
	}
	
	return candidates
}

// rankCandidates scores and ranks driver candidates
func (e *Engine) rankCandidates(candidates []*domain.NearbyDriver, ride *domain.Ride) []*domain.NearbyDriver {
	// Score each candidate
	type scoredDriver struct {
		driver *domain.NearbyDriver
		score  float64
	}
	
	scored := make([]scoredDriver, len(candidates))
	
	for i, c := range candidates {
		score := e.calculateScore(c, ride)
		scored[i] = scoredDriver{driver: c, score: score}
	}
	
	// Sort by score (highest first)
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].score > scored[j].score
	})
	
	// Extract ranked drivers
	ranked := make([]*domain.NearbyDriver, len(scored))
	for i, s := range scored {
		ranked[i] = s.driver
	}
	
	return ranked
}

// calculateScore calculates a matching score for a driver
func (e *Engine) calculateScore(candidate *domain.NearbyDriver, ride *domain.Ride) float64 {
	// Scoring factors:
	// - Distance (closer is better) - 40%
	// - Rating (higher is better) - 30%
	// - Acceptance rate (higher is better) - 20%
	// - ETA (shorter is better) - 10%
	
	// Distance score (max 40 points)
	// Score decreases linearly with distance
	maxDistance := e.config.MaxSearchRadius
	distanceScore := (1 - (candidate.DistanceM / maxDistance)) * 40
	if distanceScore < 0 {
		distanceScore = 0
	}
	
	// Rating score (max 30 points)
	// 5.0 rating = 30 points, 4.0 = 24, etc.
	ratingScore := (candidate.Driver.Rating / 5.0) * 30
	
	// Acceptance rate score (max 20 points)
	acceptanceScore := candidate.Driver.AcceptanceRate * 20
	
	// ETA score (max 10 points)
	// 5 minutes or less = 10 points, decreases after that
	maxETA := int64(30 * 60) // 30 minutes
	etaScore := (1 - (float64(candidate.ETASeconds) / float64(maxETA))) * 10
	if etaScore < 0 {
		etaScore = 0
	}
	
	return distanceScore + ratingScore + acceptanceScore + etaScore
}

// calculateETA calculates ETA from driver to pickup
func (e *Engine) calculateETA(pickup domain.Location, driverLoc domain.Location, vehicleType domain.VehicleType) int64 {
	distance := geo.HaversineDistance(
		driverLoc.Latitude, driverLoc.Longitude,
		pickup.Latitude, pickup.Longitude,
	)
	
	// Map vehicle type to string for ETA calculation
	vType := "car"
	switch vehicleType {
	case domain.VehicleTypeBike:
		vType = "bike"
	case domain.VehicleTypeTricycle:
		vType = "tricycle"
	}
	
	return geo.EstimateETA(distance, vType)
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
