package eta

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/go-redis/redis/v8"
)

type ETAService struct {
	routingClient  RoutingClient
	trafficService *TrafficService
	cache          *redis.Client
	ctx            context.Context
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

func NewETAService(routingClient RoutingClient, redisClient *redis.Client) *ETAService {
	return &ETAService{
		routingClient:  routingClient,
		trafficService: &TrafficService{redis: redisClient, ctx: context.Background()},
		cache:          redisClient,
		ctx:            context.Background(),
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

	// Get route from routing service
	route, err := s.routingClient.GetRoute(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("routing service error: %w", err)
	}

	// Apply traffic adjustments
	trafficMultiplier := s.trafficService.GetMultiplier(
		req.OriginLat,
		req.OriginLng,
		req.DepartureTime,
	)

	adjustedDuration := time.Duration(float64(route.Duration) * trafficMultiplier)

	resp := &ETAResponse{
		Duration:     adjustedDuration,
		Distance:     route.Distance,
		TrafficLevel: s.getTrafficLevel(trafficMultiplier),
		Route:        route.Polyline,
		Confidence:   0.85, // Adjust based on historical accuracy
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

func (s *ETAService) buildCacheKey(req *ETARequest) string {
	// Round coordinates to 4 decimals (~11m precision) for better cache hits
	key := fmt.Sprintf("eta:%.4f,%.4f:%.4f,%.4f:%d",
		req.OriginLat, req.OriginLng,
		req.DestLat, req.DestLng,
		req.DepartureTime.Unix()/60) // Round to minute
	return fmt.Sprintf("%x", md5.Sum([]byte(key)))
}

func (s *ETAService) getTrafficLevel(multiplier float64) string {
	switch {
	case multiplier <= 1.1:
		return "low"
	case multiplier <= 1.3:
		return "moderate"
	default:
		return "heavy"
	}
}

// GetMultiplier returns traffic multiplier for route
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

	// TODO: Get real-time traffic data from H3 cells
	// cellTraffic := t.getH3CellTraffic(lat, lng)
	// multiplier *= cellTraffic

	return multiplier
}

// Mock routing client for development
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

// ============================================
// Production Routing Service Implementations
// ============================================

// GoogleMapsRoutingClient implements RoutingClient using Google Maps Directions API
type GoogleMapsRoutingClient struct {
	apiKey     string
	httpClient *http.Client
}

func NewGoogleMapsRoutingClient() *GoogleMapsRoutingClient {
	apiKey := os.Getenv("GOOGLE_MAPS_API_KEY")
	return &GoogleMapsRoutingClient{
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func (g *GoogleMapsRoutingClient) GetRoute(ctx context.Context, req *ETARequest) (*RouteResponse, error) {
	if g.apiKey == "" {
		return nil, fmt.Errorf("GOOGLE_MAPS_API_KEY not configured")
	}

	baseURL := "https://maps.googleapis.com/maps/api/directions/json"
	params := url.Values{}
	params.Set("origin", fmt.Sprintf("%.6f,%.6f", req.OriginLat, req.OriginLng))
	params.Set("destination", fmt.Sprintf("%.6f,%.6f", req.DestLat, req.DestLng))
	params.Set("key", g.apiKey)
	params.Set("departure_time", strconv.FormatInt(req.DepartureTime.Unix(), 10))
	params.Set("traffic_model", "best_guess")

	fullURL := baseURL + "?" + params.Encode()

	httpReq, err := http.NewRequestWithContext(ctx, "GET", fullURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := g.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to call Google Maps API: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var result struct {
		Status string `json:"status"`
		Routes []struct {
			Legs []struct {
				Distance struct {
					Value int `json:"value"` // meters
				} `json:"distance"`
				DurationInTraffic struct {
					Value int `json:"value"` // seconds
				} `json:"duration_in_traffic"`
				Duration struct {
					Value int `json:"value"` // seconds
				} `json:"duration"`
			} `json:"legs"`
			OverviewPolyline struct {
				Points string `json:"points"`
			} `json:"overview_polyline"`
		} `json:"routes"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if result.Status != "OK" || len(result.Routes) == 0 {
		return nil, fmt.Errorf("no route found: %s", result.Status)
	}

	route := result.Routes[0]
	leg := route.Legs[0]

	// Use duration_in_traffic if available, otherwise use duration
	durationSecs := leg.DurationInTraffic.Value
	if durationSecs == 0 {
		durationSecs = leg.Duration.Value
	}

	// Decode polyline
	polyline := decodePolyline(route.OverviewPolyline.Points)

	return &RouteResponse{
		Duration: time.Duration(durationSecs) * time.Second,
		Distance: float64(leg.Distance.Value),
		Polyline: polyline,
	}, nil
}

// MapboxRoutingClient implements RoutingClient using Mapbox Directions API
type MapboxRoutingClient struct {
	accessToken string
	httpClient  *http.Client
}

func NewMapboxRoutingClient() *MapboxRoutingClient {
	accessToken := os.Getenv("MAPBOX_ACCESS_TOKEN")
	return &MapboxRoutingClient{
		accessToken: accessToken,
		httpClient:  &http.Client{Timeout: 10 * time.Second},
	}
}

func (m *MapboxRoutingClient) GetRoute(ctx context.Context, req *ETARequest) (*RouteResponse, error) {
	if m.accessToken == "" {
		return nil, fmt.Errorf("MAPBOX_ACCESS_TOKEN not configured")
	}

	// Mapbox format: lng,lat;lng,lat
	coordinates := fmt.Sprintf("%.6f,%.6f;%.6f,%.6f",
		req.OriginLng, req.OriginLat,
		req.DestLng, req.DestLat)

	baseURL := fmt.Sprintf("https://api.mapbox.com/directions/v5/mapbox/driving-traffic/%s", coordinates)
	params := url.Values{}
	params.Set("access_token", m.accessToken)
	params.Set("geometries", "geojson")
	params.Set("overview", "full")

	fullURL := baseURL + "?" + params.Encode()

	httpReq, err := http.NewRequestWithContext(ctx, "GET", fullURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := m.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to call Mapbox API: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var result struct {
		Code   string `json:"code"`
		Routes []struct {
			Duration float64 `json:"duration"` // seconds
			Distance float64 `json:"distance"` // meters
			Geometry struct {
				Coordinates [][]float64 `json:"coordinates"` // [lng, lat]
			} `json:"geometry"`
		} `json:"routes"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if result.Code != "Ok" || len(result.Routes) == 0 {
		return nil, fmt.Errorf("no route found: %s", result.Code)
	}

	route := result.Routes[0]

	// Convert coordinates to LatLng
	polyline := make([]LatLng, len(route.Geometry.Coordinates))
	for i, coord := range route.Geometry.Coordinates {
		polyline[i] = LatLng{Lat: coord[1], Lng: coord[0]}
	}

	return &RouteResponse{
		Duration: time.Duration(route.Duration) * time.Second,
		Distance: route.Distance,
		Polyline: polyline,
	}, nil
}

// OSRMRoutingClient implements RoutingClient using self-hosted OSRM
type OSRMRoutingClient struct {
	baseURL    string
	httpClient *http.Client
}

func NewOSRMRoutingClient() *OSRMRoutingClient {
	baseURL := os.Getenv("OSRM_BASE_URL")
	if baseURL == "" {
		baseURL = "http://osrm:5000" // Default Docker service name
	}
	return &OSRMRoutingClient{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func (o *OSRMRoutingClient) GetRoute(ctx context.Context, req *ETARequest) (*RouteResponse, error) {
	// OSRM format: lng,lat;lng,lat
	coordinates := fmt.Sprintf("%.6f,%.6f;%.6f,%.6f",
		req.OriginLng, req.OriginLat,
		req.DestLng, req.DestLat)

	fullURL := fmt.Sprintf("%s/route/v1/driving/%s?geometries=geojson&overview=full",
		o.baseURL, coordinates)

	httpReq, err := http.NewRequestWithContext(ctx, "GET", fullURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := o.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to call OSRM: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var result struct {
		Code   string `json:"code"`
		Routes []struct {
			Duration float64 `json:"duration"` // seconds
			Distance float64 `json:"distance"` // meters
			Geometry struct {
				Coordinates [][]float64 `json:"coordinates"` // [lng, lat]
			} `json:"geometry"`
		} `json:"routes"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if result.Code != "Ok" || len(result.Routes) == 0 {
		return nil, fmt.Errorf("no route found: %s", result.Code)
	}

	route := result.Routes[0]

	// Convert coordinates to LatLng
	polyline := make([]LatLng, len(route.Geometry.Coordinates))
	for i, coord := range route.Geometry.Coordinates {
		polyline[i] = LatLng{Lat: coord[1], Lng: coord[0]}
	}

	return &RouteResponse{
		Duration: time.Duration(route.Duration) * time.Second,
		Distance: route.Distance,
		Polyline: polyline,
	}, nil
}

// MultiProviderRoutingClient tries multiple routing services with fallback
type MultiProviderRoutingClient struct {
	providers []RoutingClient
}

func NewMultiProviderRoutingClient() *MultiProviderRoutingClient {
	providers := []RoutingClient{}

	// Add Google Maps if API key is available
	if os.Getenv("GOOGLE_MAPS_API_KEY") != "" {
		providers = append(providers, NewGoogleMapsRoutingClient())
	}

	// Add Mapbox if token is available
	if os.Getenv("MAPBOX_ACCESS_TOKEN") != "" {
		providers = append(providers, NewMapboxRoutingClient())
	}

	// Add OSRM as fallback (self-hosted, always available)
	providers = append(providers, NewOSRMRoutingClient())

	// If no providers configured, add mock as last resort
	if len(providers) == 0 {
		providers = append(providers, &MockRoutingClient{})
	}

	return &MultiProviderRoutingClient{providers: providers}
}

func (m *MultiProviderRoutingClient) GetRoute(ctx context.Context, req *ETARequest) (*RouteResponse, error) {
	var lastErr error

	for _, provider := range m.providers {
		route, err := provider.GetRoute(ctx, req)
		if err == nil {
			return route, nil
		}
		lastErr = err
		// Log the error but try next provider
		fmt.Printf("[Routing] Provider failed, trying next: %v\n", err)
	}

	return nil, fmt.Errorf("all routing providers failed: %w", lastErr)
}

// Helper function to decode Google Maps polyline encoding
func decodePolyline(encoded string) []LatLng {
	var points []LatLng
	index, lat, lng := 0, 0, 0

	for index < len(encoded) {
		// Decode latitude
		shift, result := 0, 0
		for {
			b := int(encoded[index]) - 63
			index++
			result |= (b & 0x1f) << shift
			shift += 5
			if b < 0x20 {
				break
			}
		}
		if result&1 != 0 {
			lat += ^(result >> 1)
		} else {
			lat += result >> 1
		}

		// Decode longitude
		shift, result = 0, 0
		for {
			b := int(encoded[index]) - 63
			index++
			result |= (b & 0x1f) << shift
			shift += 5
			if b < 0x20 {
				break
			}
		}
		if result&1 != 0 {
			lng += ^(result >> 1)
		} else {
			lng += result >> 1
		}

		points = append(points, LatLng{
			Lat: float64(lat) / 1e5,
			Lng: float64(lng) / 1e5,
		})
	}

	return points
}

// NewProductionETAService creates an ETA service with production routing
func NewProductionETAService(redisClient *redis.Client) *ETAService {
	return NewETAService(NewMultiProviderRoutingClient(), redisClient)
}
