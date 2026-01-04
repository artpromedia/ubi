package matching

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/segmentio/kafka-go"
)

const (
	DispatchTimeout = 15 * time.Second
	MaxSearchRadius = 8.0 // kilometers
	InitialRadius   = 2.0
	RadiusIncrement = 2.0
)

var ErrNoDriversAvailable = fmt.Errorf("no available drivers found")
var ErrDispatchTimeout = fmt.Errorf("dispatch timed out")

type RideRequest struct {
	RequestID     string    `json:"request_id"`
	RiderID       string    `json:"rider_id"`
	PickupLat     float64   `json:"pickup_lat"`
	PickupLng     float64   `json:"pickup_lng"`
	DropoffLat    float64   `json:"dropoff_lat"`
	DropoffLng    float64   `json:"dropoff_lng"`
	VehicleType   string    `json:"vehicle_type"`
	PickupAddress string    `json:"pickup_address"`
	DropoffAddress string   `json:"dropoff_address"`
	FareEstimate  float64   `json:"fare_estimate"`
	Currency      string    `json:"currency"`
	RequestedAt   time.Time `json:"requested_at"`
	MaxWaitTime   time.Duration `json:"max_wait_time"`
}

type MatchResult struct {
	RequestID   string        `json:"request_id"`
	DriverID    string        `json:"driver_id"`
	ETA         time.Duration `json:"eta"`
	Distance    float64       `json:"distance"`
	MatchedAt   time.Time     `json:"matched_at"`
}

type DriverLocation struct {
	DriverID    string  `json:"driver_id"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	Heading     float64 `json:"heading"`
	Speed       float64 `json:"speed"`
	VehicleType string  `json:"vehicle_type"`
	Distance    float64 `json:"distance"`
}

type Dispatch struct {
	ID         string    `json:"id"`
	RequestID  string    `json:"request_id"`
	DriverID   string    `json:"driver_id"`
	Status     string    `json:"status"` // pending, accepted, rejected, expired
	ExpiresAt  time.Time `json:"expires_at"`
	CreatedAt  time.Time `json:"created_at"`
	RespondedAt *time.Time `json:"responded_at,omitempty"`
}

type ScoredDriver struct {
	Driver   *DriverLocation
	Score    float64
	ETA      time.Duration
	Distance float64
}

type LocationServiceClient interface {
	FindNearbyDrivers(ctx context.Context, lat, lng, radius float64, vehicleType string) ([]*DriverLocation, error)
}

type RoutingServiceClient interface {
	GetETA(ctx context.Context, originLat, originLng, destLat, destLng float64) (time.Duration, error)
}

type MatchingService struct {
	redis           *redis.Client
	kafka           *kafka.Writer
	locationClient  LocationServiceClient
	routingClient   RoutingServiceClient
	ctx             context.Context
}

func NewMatchingService(
	redisClient *redis.Client,
	kafkaBrokers string,
	locationClient LocationServiceClient,
	routingClient RoutingServiceClient,
) *MatchingService {
	kafkaWriter := &kafka.Writer{
		Addr:     kafka.TCP(kafkaBrokers),
		Topic:    "ride-matches",
		Balancer: &kafka.LeastBytes{},
	}

	return &MatchingService{
		redis:          redisClient,
		kafka:          kafkaWriter,
		locationClient: locationClient,
		routingClient:  routingClient,
		ctx:            context.Background(),
	}
}

// FindMatch finds and dispatches to the best available driver
func (s *MatchingService) FindMatch(ctx context.Context, request *RideRequest) (*MatchResult, error) {
	log.Printf("[Matching] Starting match for request %s", request.RequestID)

	// Store ride request
	if err := s.storeRideRequest(ctx, request); err != nil {
		return nil, fmt.Errorf("failed to store request: %w", err)
	}

	// Expand search radius until driver found or max reached
	radius := InitialRadius

	for radius <= MaxSearchRadius {
		log.Printf("[Matching] Searching with radius %.1f km", radius)

		// Find available drivers
		drivers, err := s.locationClient.FindNearbyDrivers(
			ctx,
			request.PickupLat,
			request.PickupLng,
			radius,
			request.VehicleType,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to find nearby drivers: %w", err)
		}

		log.Printf("[Matching] Found %d drivers within %.1f km", len(drivers), radius)

		if len(drivers) == 0 {
			radius += RadiusIncrement
			continue
		}

		// Score and rank drivers
		scoredDrivers, err := s.scoreDrivers(ctx, request, drivers)
		if err != nil {
			return nil, fmt.Errorf("failed to score drivers: %w", err)
		}

		// Try to dispatch to best drivers
		for _, scored := range scoredDrivers {
			log.Printf("[Matching] Attempting dispatch to driver %s (score: %.2f, distance: %.2f km)",
				scored.Driver.DriverID, scored.Score, scored.Distance)

			accepted, err := s.dispatchToDriver(ctx, request, scored.Driver)
			if err != nil {
				log.Printf("[Matching] Dispatch error for driver %s: %v", scored.Driver.DriverID, err)
				continue
			}

			if accepted {
				result := &MatchResult{
					RequestID: request.RequestID,
					DriverID:  scored.Driver.DriverID,
					ETA:       scored.ETA,
					Distance:  scored.Distance,
					MatchedAt: time.Now(),
				}

				// Publish match event
				s.publishMatchEvent(ctx, result)

				log.Printf("[Matching] Successfully matched request %s to driver %s",
					request.RequestID, scored.Driver.DriverID)

				return result, nil
			}

			log.Printf("[Matching] Driver %s rejected request", scored.Driver.DriverID)
		}

		// No drivers accepted, expand search
		radius += RadiusIncrement
	}

	log.Printf("[Matching] No drivers found for request %s within %.1f km", request.RequestID, MaxSearchRadius)
	return nil, ErrNoDriversAvailable
}

// scoreDrivers scores and ranks drivers based on multiple factors
func (s *MatchingService) scoreDrivers(
	ctx context.Context,
	request *RideRequest,
	drivers []*DriverLocation,
) ([]ScoredDriver, error) {
	var scored []ScoredDriver

	for _, driver := range drivers {
		// Calculate ETA using routing service
		eta, err := s.routingClient.GetETA(
			ctx,
			driver.Latitude, driver.Longitude,
			request.PickupLat, request.PickupLng,
		)
		if err != nil {
			log.Printf("Failed to get ETA for driver %s: %v", driver.DriverID, err)
			continue
		}

		// Calculate composite score
		score := s.calculateScore(driver, request, eta)

		scored = append(scored, ScoredDriver{
			Driver:   driver,
			Score:    score,
			ETA:      eta,
			Distance: driver.Distance,
		})
	}

	// Sort by score (highest first)
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].Score > scored[j].Score
	})

	return scored, nil
}

// calculateScore computes a composite score for driver ranking
func (s *MatchingService) calculateScore(
	driver *DriverLocation,
	request *RideRequest,
	eta time.Duration,
) float64 {
	score := 100.0

	// Distance penalty (closer is better)
	score -= driver.Distance * 5.0

	// ETA penalty (faster is better)
	score -= eta.Minutes() * 2.0

	// Driver rating bonus (from Redis)
	rating := s.getDriverRating(driver.DriverID)
	score += (rating - 4.0) * 10.0 // Bonus for 4+ star drivers

	// Acceptance rate bonus
	acceptRate := s.getDriverAcceptRate(driver.DriverID)
	score += acceptRate * 20.0

	// Heading bonus (driver already heading toward pickup)
	headingBonus := s.calculateHeadingBonus(driver, request)
	score += headingBonus

	return score
}

// dispatchToDriver sends ride request to driver and waits for response
func (s *MatchingService) dispatchToDriver(
	ctx context.Context,
	request *RideRequest,
	driver *DriverLocation,
) (bool, error) {
	// Generate dispatch ID
	dispatchID := fmt.Sprintf("dispatch_%d", time.Now().UnixNano())

	// Create dispatch record
	dispatch := &Dispatch{
		ID:        dispatchID,
		RequestID: request.RequestID,
		DriverID:  driver.DriverID,
		Status:    "pending",
		ExpiresAt: time.Now().Add(DispatchTimeout),
		CreatedAt: time.Now(),
	}

	// Store dispatch
	if err := s.storeDispatch(ctx, dispatch); err != nil {
		return false, fmt.Errorf("failed to store dispatch: %w", err)
	}

	// Send to driver via WebSocket (through real-time gateway)
	if err := s.sendDispatchToDriver(ctx, dispatch, request); err != nil {
		return false, fmt.Errorf("failed to send dispatch: %w", err)
	}

	// Wait for response with timeout
	response, err := s.waitForDriverResponse(ctx, dispatchID, DispatchTimeout)
	if err != nil {
		// Mark as expired
		s.updateDispatchStatus(ctx, dispatchID, "expired")
		return false, err
	}

	// Update dispatch with response
	dispatch.RespondedAt = &response.RespondedAt
	dispatch.Status = response.Status
	s.updateDispatchStatus(ctx, dispatchID, response.Status)

	return response.Status == "accepted", nil
}

// Helper functions

func (s *MatchingService) storeRideRequest(ctx context.Context, request *RideRequest) error {
	data, err := json.Marshal(request)
	if err != nil {
		return err
	}
	return s.redis.SetEX(ctx, fmt.Sprintf("request:%s", request.RequestID), data, 10*time.Minute).Err()
}

func (s *MatchingService) storeDispatch(ctx context.Context, dispatch *Dispatch) error {
	data, err := json.Marshal(dispatch)
	if err != nil {
		return err
	}
	return s.redis.SetEX(ctx, fmt.Sprintf("dispatch:%s", dispatch.ID), data, 5*time.Minute).Err()
}

func (s *MatchingService) updateDispatchStatus(ctx context.Context, dispatchID, status string) error {
	return s.redis.HSet(ctx, fmt.Sprintf("dispatch:%s", dispatchID), "status", status).Err()
}

func (s *MatchingService) sendDispatchToDriver(
	ctx context.Context,
	dispatch *Dispatch,
	request *RideRequest,
) error {
	// This would call the real-time gateway's broadcast endpoint
	message := map[string]interface{}{
		"type": "dispatch_request",
		"payload": map[string]interface{}{
			"dispatch_id":      dispatch.ID,
			"request_id":       request.RequestID,
			"pickup_address":   request.PickupAddress,
			"pickup_lat":       request.PickupLat,
			"pickup_lng":       request.PickupLng,
			"dropoff_address":  request.DropoffAddress,
			"fare_estimate":    request.FareEstimate,
			"currency":         request.Currency,
			"expires_in":       int(DispatchTimeout.Seconds()),
		},
	}

	// Publish to Redis channel for real-time gateway
	data, _ := json.Marshal(message)
	return s.redis.Publish(ctx, fmt.Sprintf("user:%s", dispatch.DriverID), data).Err()
}

type DispatchResponse struct {
	Status      string
	RespondedAt time.Time
}

func (s *MatchingService) waitForDriverResponse(
	ctx context.Context,
	dispatchID string,
	timeout time.Duration,
) (*DispatchResponse, error) {
	// Subscribe to response channel
	pubsub := s.redis.Subscribe(ctx, fmt.Sprintf("dispatch:%s:response", dispatchID))
	defer pubsub.Close()

	// Wait for message with timeout
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	for {
		select {
		case <-timeoutCtx.Done():
			return nil, ErrDispatchTimeout

		case msg := <-pubsub.Channel():
			var response map[string]interface{}
			if err := json.Unmarshal([]byte(msg.Payload), &response); err != nil {
				continue
			}

			accepted, ok := response["accepted"].(bool)
			if !ok {
				continue
			}

			status := "rejected"
			if accepted {
				status = "accepted"
			}

			return &DispatchResponse{
				Status:      status,
				RespondedAt: time.Now(),
			}, nil
		}
	}
}

func (s *MatchingService) getDriverRating(driverID string) float64 {
	// Get from Redis cache or database
	val, err := s.redis.HGet(s.ctx, fmt.Sprintf("driver:%s:stats", driverID), "rating").Float64()
	if err != nil {
		return 4.5 // Default rating
	}
	return val
}

func (s *MatchingService) getDriverAcceptRate(driverID string) float64 {
	// Get from Redis cache or database
	val, err := s.redis.HGet(s.ctx, fmt.Sprintf("driver:%s:stats", driverID), "accept_rate").Float64()
	if err != nil {
		return 0.8 // Default 80% acceptance
	}
	return val
}

func (s *MatchingService) calculateHeadingBonus(driver *DriverLocation, request *RideRequest) float64 {
	// Calculate if driver is heading toward pickup
	// Simplified implementation - in production, use proper bearing calculation
	// Bonus of 0-10 points based on alignment
	return 5.0
}

func (s *MatchingService) publishMatchEvent(ctx context.Context, result *MatchResult) {
	data, err := json.Marshal(result)
	if err != nil {
		log.Printf("Failed to marshal match event: %v", err)
		return
	}

	err = s.kafka.WriteMessages(ctx, kafka.Message{
		Key:   []byte(result.RequestID),
		Value: data,
	})
	if err != nil {
		log.Printf("Failed to publish match event to Kafka: %v", err)
	}
}

func (s *MatchingService) Close() error {
	return s.kafka.Close()
}
