package eta

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"time"
)

// =============================================================================
// GOOGLE MAPS ROUTING CLIENT
// =============================================================================

// GoogleMapsClient implements real routing using Google Maps Directions API
type GoogleMapsClient struct {
	apiKey     string
	httpClient *http.Client
	baseURL    string
}

// NewGoogleMapsClient creates a new Google Maps routing client
func NewGoogleMapsClient(apiKey string) *GoogleMapsClient {
	if apiKey == "" {
		apiKey = os.Getenv("GOOGLE_MAPS_API_KEY")
	}
	return &GoogleMapsClient{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		baseURL: "https://maps.googleapis.com/maps/api/directions/json",
	}
}

type googleDirectionsResponse struct {
	Status string `json:"status"`
	Routes []struct {
		Legs []struct {
			Distance struct {
				Value int `json:"value"` // meters
			} `json:"distance"`
			Duration struct {
				Value int `json:"value"` // seconds
			} `json:"duration"`
			DurationInTraffic struct {
				Value int `json:"value"` // seconds with traffic
			} `json:"duration_in_traffic"`
		} `json:"legs"`
		OverviewPolyline struct {
			Points string `json:"points"`
		} `json:"overview_polyline"`
	} `json:"routes"`
	ErrorMessage string `json:"error_message,omitempty"`
}

// GetRoute gets route from Google Maps Directions API
func (g *GoogleMapsClient) GetRoute(ctx context.Context, req *ETARequest) (*RouteResponse, error) {
	if g.apiKey == "" {
		return nil, fmt.Errorf("Google Maps API key not configured")
	}

	params := url.Values{}
	params.Set("origin", fmt.Sprintf("%f,%f", req.OriginLat, req.OriginLng))
	params.Set("destination", fmt.Sprintf("%f,%f", req.DestLat, req.DestLng))
	params.Set("departure_time", fmt.Sprintf("%d", req.DepartureTime.Unix()))
	params.Set("traffic_model", "best_guess")
	params.Set("key", g.apiKey)

	reqURL := fmt.Sprintf("%s?%s", g.baseURL, params.Encode())

	httpReq, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
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

	var dirResp googleDirectionsResponse
	if err := json.Unmarshal(body, &dirResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if dirResp.Status != "OK" {
		return nil, fmt.Errorf("Google Maps API error: %s - %s", dirResp.Status, dirResp.ErrorMessage)
	}

	if len(dirResp.Routes) == 0 || len(dirResp.Routes[0].Legs) == 0 {
		return nil, fmt.Errorf("no routes found")
	}

	leg := dirResp.Routes[0].Legs[0]

	// Use duration_in_traffic if available, otherwise use regular duration
	durationSeconds := leg.Duration.Value
	if leg.DurationInTraffic.Value > 0 {
		durationSeconds = leg.DurationInTraffic.Value
	}

	// Decode polyline
	polyline := decodePolyline(dirResp.Routes[0].OverviewPolyline.Points)

	return &RouteResponse{
		Duration: time.Duration(durationSeconds) * time.Second,
		Distance: float64(leg.Distance.Value),
		Polyline: polyline,
	}, nil
}

// =============================================================================
// MAPBOX ROUTING CLIENT
// =============================================================================

// MapboxClient implements routing using Mapbox Directions API
type MapboxClient struct {
	accessToken string
	httpClient  *http.Client
	baseURL     string
}

// NewMapboxClient creates a new Mapbox routing client
func NewMapboxClient(accessToken string) *MapboxClient {
	if accessToken == "" {
		accessToken = os.Getenv("MAPBOX_ACCESS_TOKEN")
	}
	return &MapboxClient{
		accessToken: accessToken,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		baseURL: "https://api.mapbox.com/directions/v5/mapbox/driving-traffic",
	}
}

type mapboxDirectionsResponse struct {
	Code   string `json:"code"`
	Routes []struct {
		Duration float64 `json:"duration"` // seconds
		Distance float64 `json:"distance"` // meters
		Geometry struct {
			Coordinates [][]float64 `json:"coordinates"`
		} `json:"geometry"`
	} `json:"routes"`
	Message string `json:"message,omitempty"`
}

// GetRoute gets route from Mapbox Directions API
func (m *MapboxClient) GetRoute(ctx context.Context, req *ETARequest) (*RouteResponse, error) {
	if m.accessToken == "" {
		return nil, fmt.Errorf("Mapbox access token not configured")
	}

	// Mapbox expects coordinates as lng,lat
	coordinates := fmt.Sprintf("%f,%f;%f,%f",
		req.OriginLng, req.OriginLat,
		req.DestLng, req.DestLat,
	)

	params := url.Values{}
	params.Set("access_token", m.accessToken)
	params.Set("geometries", "geojson")
	params.Set("depart_at", req.DepartureTime.Format(time.RFC3339))

	reqURL := fmt.Sprintf("%s/%s?%s", m.baseURL, coordinates, params.Encode())

	httpReq, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
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

	var dirResp mapboxDirectionsResponse
	if err := json.Unmarshal(body, &dirResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if dirResp.Code != "Ok" {
		return nil, fmt.Errorf("Mapbox API error: %s - %s", dirResp.Code, dirResp.Message)
	}

	if len(dirResp.Routes) == 0 {
		return nil, fmt.Errorf("no routes found")
	}

	route := dirResp.Routes[0]

	// Convert coordinates to LatLng (Mapbox returns [lng, lat])
	polyline := make([]LatLng, len(route.Geometry.Coordinates))
	for i, coord := range route.Geometry.Coordinates {
		polyline[i] = LatLng{
			Lat: coord[1], // lat is second in Mapbox
			Lng: coord[0], // lng is first
		}
	}

	return &RouteResponse{
		Duration: time.Duration(route.Duration) * time.Second,
		Distance: route.Distance,
		Polyline: polyline,
	}, nil
}

// =============================================================================
// OSRM ROUTING CLIENT (Self-hosted)
// =============================================================================

// OSRMClient implements routing using OSRM (Open Source Routing Machine)
type OSRMClient struct {
	baseURL    string
	httpClient *http.Client
}

// NewOSRMClient creates a new OSRM routing client
func NewOSRMClient(baseURL string) *OSRMClient {
	if baseURL == "" {
		baseURL = os.Getenv("OSRM_BASE_URL")
		if baseURL == "" {
			baseURL = "http://router.project-osrm.org" // Public demo server (for testing only)
		}
	}
	return &OSRMClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

type osrmRouteResponse struct {
	Code   string `json:"code"`
	Routes []struct {
		Duration float64 `json:"duration"` // seconds
		Distance float64 `json:"distance"` // meters
		Geometry string  `json:"geometry"` // polyline5 encoded
	} `json:"routes"`
	Message string `json:"message,omitempty"`
}

// GetRoute gets route from OSRM
func (o *OSRMClient) GetRoute(ctx context.Context, req *ETARequest) (*RouteResponse, error) {
	// OSRM expects coordinates as lng,lat
	coordinates := fmt.Sprintf("%f,%f;%f,%f",
		req.OriginLng, req.OriginLat,
		req.DestLng, req.DestLat,
	)

	params := url.Values{}
	params.Set("overview", "full")
	params.Set("geometries", "polyline")

	reqURL := fmt.Sprintf("%s/route/v1/driving/%s?%s", o.baseURL, coordinates, params.Encode())

	httpReq, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
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

	var routeResp osrmRouteResponse
	if err := json.Unmarshal(body, &routeResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if routeResp.Code != "Ok" {
		return nil, fmt.Errorf("OSRM error: %s - %s", routeResp.Code, routeResp.Message)
	}

	if len(routeResp.Routes) == 0 {
		return nil, fmt.Errorf("no routes found")
	}

	route := routeResp.Routes[0]

	// Decode polyline (OSRM uses polyline5 format)
	polyline := decodePolyline(route.Geometry)

	return &RouteResponse{
		Duration: time.Duration(route.Duration) * time.Second,
		Distance: route.Distance,
		Polyline: polyline,
	}, nil
}

// =============================================================================
// FALLBACK ROUTING CLIENT WITH MULTIPLE PROVIDERS
// =============================================================================

// FallbackRoutingClient tries multiple routing providers in order
type FallbackRoutingClient struct {
	clients []RoutingClient
}

// NewFallbackRoutingClient creates a client that tries providers in order
func NewFallbackRoutingClient() *FallbackRoutingClient {
	clients := []RoutingClient{}

	// Add clients in order of preference
	if os.Getenv("GOOGLE_MAPS_API_KEY") != "" {
		clients = append(clients, NewGoogleMapsClient(""))
	}
	if os.Getenv("MAPBOX_ACCESS_TOKEN") != "" {
		clients = append(clients, NewMapboxClient(""))
	}
	if os.Getenv("OSRM_BASE_URL") != "" {
		clients = append(clients, NewOSRMClient(""))
	}

	// Always add mock client as last fallback
	clients = append(clients, &MockRoutingClient{})

	return &FallbackRoutingClient{
		clients: clients,
	}
}

// GetRoute tries each client until one succeeds
func (f *FallbackRoutingClient) GetRoute(ctx context.Context, req *ETARequest) (*RouteResponse, error) {
	var lastErr error

	for _, client := range f.clients {
		resp, err := client.GetRoute(ctx, req)
		if err == nil {
			return resp, nil
		}
		lastErr = err
	}

	return nil, fmt.Errorf("all routing providers failed: %w", lastErr)
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

// decodePolyline decodes a polyline5-encoded string
func decodePolyline(encoded string) []LatLng {
	var points []LatLng
	index := 0
	lat := 0
	lng := 0

	for index < len(encoded) {
		// Decode latitude
		var result int
		var shift uint
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
		result = 0
		shift = 0
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

// haversineDistance calculates the distance between two points using Haversine formula
func haversineDistance(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadius = 6371.0 // km

	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	deltaLat := (lat2 - lat1) * math.Pi / 180
	deltaLng := (lng2 - lng1) * math.Pi / 180

	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*
			math.Sin(deltaLng/2)*math.Sin(deltaLng/2)

	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadius * c
}
