package eta

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"time"

	"github.com/go-redis/redis/v8"
)

type ETAService struct {
	routingClient    RoutingClient
	trafficService   *TrafficService
	h3TrafficService *H3TrafficService
	cache            *redis.Client
	ctx              context.Context
}

type RoutingClient interface {
	GetRoute(ctx context.Context, req *ETARequest) (*RouteResponse, error)
}

type ETARequest struct {
	OriginLat     float64
	OriginLng     float64
	DestLat       float64
	DestLng       float64
	DepartureTime time.Time
	City          string // Optional: for city-specific traffic patterns
}

type ETAResponse struct {
	Duration     time.Duration `json:"duration"`
	Distance     float64       `json:"distance"` // meters
	TrafficLevel string        `json:"traffic_level"` // "low", "moderate", "heavy"
	Route        []LatLng      `json:"route"`
	Confidence   float64       `json:"confidence"` // 0-1
}

type LatLng struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type RouteResponse struct {
	Duration time.Duration
	Distance float64
	Polyline []LatLng
}

type TrafficService struct {
	redis *redis.Client
	ctx   context.Context
}

// NewETAService creates a new ETA service with real routing providers
func NewETAService(routingClient RoutingClient, redisClient *redis.Client) *ETAService {
	// If no routing client provided, use fallback client with multiple providers
	if routingClient == nil {
		routingClient = NewFallbackRoutingClient()
	}

	return &ETAService{
		routingClient:    routingClient,
		trafficService:   &TrafficService{redis: redisClient, ctx: context.Background()},
		h3TrafficService: NewH3TrafficService(redisClient),
		cache:            redisClient,
		ctx:              context.Background(),
	}
}

// GetETA calculates estimated time of arrival with traffic adjustment
func (s *ETAService) GetETA(ctx context.Context, req *ETARequest) (*ETAResponse, error) {
	// Check cache first (2-minute TTL)
	cacheKey := s.buildCacheKey(req)
	cached, err := s.cache.Get(ctx, cacheKey).Result()
	if err == nil {
		var resp ETAResponse
		if json.Unmarshal([]byte(cached), &resp) == nil {
			return &resp, nil
		}
	}

	// Get route from routing service (uses real providers with fallback)
	route, err := s.routingClient.GetRoute(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("routing service error: %w", err)
	}

	// Apply traffic adjustments using H3-based traffic service
	var trafficMultiplier float64
	if req.City != "" {
		// Use city-specific traffic patterns
		trafficMultiplier = s.h3TrafficService.GetCityTrafficMultiplier(req.City, req.DepartureTime)
	} else if len(route.Polyline) > 0 {
		// Use route-based traffic calculation
		trafficMultiplier = s.h3TrafficService.GetRouteTrafficMultiplier(route.Polyline, req.DepartureTime)
	} else {
		// Fall back to simple location-based traffic
		trafficMultiplier = s.h3TrafficService.GetTrafficMultiplier(
			req.OriginLat,
			req.OriginLng,
			req.DepartureTime,
		)
	}

	adjustedDuration := time.Duration(float64(route.Duration) * trafficMultiplier)

	// Calculate confidence based on data quality
	confidence := s.calculateConfidence(route, trafficMultiplier)

	resp := &ETAResponse{
		Duration:     adjustedDuration,
		Distance:     route.Distance,
		TrafficLevel: s.getTrafficLevel(trafficMultiplier),
		Route:        route.Polyline,
		Confidence:   confidence,
	}

	// Cache for 2 minutes
	respJSON, _ := json.Marshal(resp)
	s.cache.Set(ctx, cacheKey, respJSON, 2*time.Minute)

	return resp, nil
}

// GetLiveETA calculates ETA from current position to destination
func (s *ETAService) GetLiveETA(
	ctx context.Context,
	currentLat, currentLng, destLat, destLng float64,
) (*ETAResponse, error) {
	return s.GetETA(ctx, &ETARequest{
		OriginLat:     currentLat,
		OriginLng:     currentLng,
		DestLat:       destLat,
		DestLng:       destLng,
		DepartureTime: time.Now(),
	})
}

// GetETAWithCity calculates ETA with city-specific traffic patterns
func (s *ETAService) GetETAWithCity(
	ctx context.Context,
	originLat, originLng, destLat, destLng float64,
	city string,
) (*ETAResponse, error) {
	return s.GetETA(ctx, &ETARequest{
		OriginLat:     originLat,
		OriginLng:     originLng,
		DestLat:       destLat,
		DestLng:       destLng,
		DepartureTime: time.Now(),
		City:          city,
	})
}

// RecordDriverLocation records driver location for traffic aggregation
func (s *ETAService) RecordDriverLocation(lat, lng, speedKmh float64) error {
	return s.h3TrafficService.RecordDriverSpeed(lat, lng, speedKmh)
}

func (s *ETAService) buildCacheKey(req *ETARequest) string {
	// Round coordinates to 4 decimals (~11m precision) for better cache hits
	key := fmt.Sprintf("eta:%.4f,%.4f:%.4f,%.4f:%d:%s",
		req.OriginLat, req.OriginLng,
		req.DestLat, req.DestLng,
		req.DepartureTime.Unix()/60, // Round to minute
		req.City)
	return fmt.Sprintf("%x", md5.Sum([]byte(key)))
}

func (s *ETAService) getTrafficLevel(multiplier float64) string {
	switch {
	case multiplier <= 1.1:
		return "low"
	case multiplier <= 1.3:
		return "moderate"
	case multiplier <= 1.6:
		return "heavy"
	default:
		return "severe"
	}
}

func (s *ETAService) calculateConfidence(route *RouteResponse, trafficMultiplier float64) float64 {
	confidence := 0.85 // Base confidence

	// Increase confidence if we have a detailed route
	if len(route.Polyline) > 5 {
		confidence += 0.05
	}

	// Decrease confidence during heavy traffic (more uncertainty)
	if trafficMultiplier > 1.5 {
		confidence -= 0.1
	}

	// Cap confidence
	if confidence > 0.95 {
		confidence = 0.95
	}
	if confidence < 0.5 {
		confidence = 0.5
	}

	return confidence
}

// GetMultiplier returns traffic multiplier for route (legacy method for compatibility)
func (t *TrafficService) GetMultiplier(lat, lng float64, departureTime time.Time) float64 {
	// Get traffic data from Redis (would be updated by separate traffic monitoring service)
	hour := departureTime.Hour()
	dayOfWeek := departureTime.Weekday()

	// Default multipliers based on time of day
	multiplier := 1.0

	// Rush hour adjustments
	isWeekday := dayOfWeek >= time.Monday && dayOfWeek <= time.Friday
	
	if isWeekday {
		// Morning rush (7-9 AM)
		if hour >= 7 && hour <= 9 {
			multiplier = 1.3
		}
		// Evening rush (5-7 PM)
		if hour >= 17 && hour <= 19 {
			multiplier = 1.4
		}
	}

	// Weekend adjustments
	if dayOfWeek == time.Saturday || dayOfWeek == time.Sunday {
		// Weekend midday traffic
		if hour >= 12 && hour <= 16 {
			multiplier = 1.2
		}
	}

	// Late night low traffic
	if hour >= 22 || hour <= 5 {
		multiplier = 0.9
	}

	return multiplier
}

// MockRoutingClient for development/testing
type MockRoutingClient struct{}

func (m *MockRoutingClient) GetRoute(ctx context.Context, req *ETARequest) (*RouteResponse, error) {
	// Simplified: use Haversine distance and assume 30 km/h average speed in city
	distance := haversineDistance(req.OriginLat, req.OriginLng, req.DestLat, req.DestLng)
	
	// Distance in meters
	distanceMeters := distance * 1000
	
	// Duration assuming 30 km/h average speed
	durationSeconds := (distance / 30.0) * 3600
	duration := time.Duration(durationSeconds) * time.Second

	return &RouteResponse{
		Duration: duration,
		Distance: distanceMeters,
		Polyline: []LatLng{
			{Lat: req.OriginLat, Lng: req.OriginLng},
			{Lat: req.DestLat, Lng: req.DestLng},
		},
	}, nil
}
