// Package geo provides geospatial utilities and Google Maps integration.
package geo

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// MapsClient provides Google Maps API integration
type MapsClient struct {
	apiKey     string
	httpClient *http.Client
	baseURL    string
}

// MapsClientConfig holds configuration for the Maps client
type MapsClientConfig struct {
	APIKey  string
	Timeout time.Duration
}

// NewMapsClient creates a new Google Maps API client
func NewMapsClient(config MapsClientConfig) *MapsClient {
	timeout := config.Timeout
	if timeout == 0 {
		timeout = 10 * time.Second
	}

	return &MapsClient{
		apiKey: config.APIKey,
		httpClient: &http.Client{
			Timeout: timeout,
		},
		baseURL: "https://maps.googleapis.com/maps/api",
	}
}

// AutocompleteRequest represents a places autocomplete request
type AutocompleteRequest struct {
	Input      string
	Lat        float64
	Lng        float64
	RadiusM    float64
	Language   string
	Components string // country restriction, e.g., "country:ng|country:ke"
	Types      string // place types, e.g., "address", "establishment"
}

// AutocompletePrediction represents a single autocomplete result
type AutocompletePrediction struct {
	PlaceID          string                       `json:"place_id"`
	Description      string                       `json:"description"`
	MainText         string                       `json:"main_text"`
	SecondaryText    string                       `json:"secondary_text"`
	StructuredFormat AutocompleteStructuredFormat `json:"structured_format"`
	Types            []string                     `json:"types"`
}

// AutocompleteStructuredFormat provides formatted text components
type AutocompleteStructuredFormat struct {
	MainText      string `json:"main_text"`
	SecondaryText string `json:"secondary_text"`
}

// AutocompleteResponse represents the autocomplete API response
type AutocompleteResponse struct {
	Predictions []AutocompletePrediction `json:"predictions"`
	Status      string                   `json:"status"`
	ErrorMsg    string                   `json:"error_message,omitempty"`
}

// Autocomplete performs Places Autocomplete search
func (c *MapsClient) Autocomplete(ctx context.Context, req AutocompleteRequest) (*AutocompleteResponse, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("Google Maps API key not configured")
	}

	params := url.Values{
		"input": {req.Input},
		"key":   {c.apiKey},
	}

	// Add location bias if provided
	if req.Lat != 0 && req.Lng != 0 {
		params.Set("location", fmt.Sprintf("%f,%f", req.Lat, req.Lng))
		radius := req.RadiusM
		if radius == 0 {
			radius = DefaultSearchRadius
		}
		params.Set("radius", fmt.Sprintf("%.0f", radius))
	}

	// Default to supported African countries
	components := req.Components
	if components == "" {
		components = "country:ng|country:ke|country:gh|country:ug|country:tz|country:rw|country:za"
	}
	params.Set("components", components)

	if req.Language != "" {
		params.Set("language", req.Language)
	} else {
		params.Set("language", "en")
	}

	if req.Types != "" {
		params.Set("types", req.Types)
	}

	endpoint := fmt.Sprintf("%s/place/autocomplete/json?%s", c.baseURL, params.Encode())

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	var result AutocompleteResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parsing response: %w", err)
	}

	if result.Status != "OK" && result.Status != "ZERO_RESULTS" {
		log.Error().
			Str("status", result.Status).
			Str("error", result.ErrorMsg).
			Msg("Google Places API error")
		return nil, fmt.Errorf("API error: %s - %s", result.Status, result.ErrorMsg)
	}

	// Transform to our structured format
	for i := range result.Predictions {
		pred := &result.Predictions[i]
		if pred.StructuredFormat.MainText == "" {
			// Parse from description if not provided
			parts := strings.SplitN(pred.Description, ", ", 2)
			pred.StructuredFormat.MainText = parts[0]
			if len(parts) > 1 {
				pred.StructuredFormat.SecondaryText = parts[1]
			}
			pred.MainText = pred.StructuredFormat.MainText
			pred.SecondaryText = pred.StructuredFormat.SecondaryText
		}
	}

	return &result, nil
}

// GeocodeRequest represents a geocoding request
type GeocodeRequest struct {
	Address    string
	Components string // country restriction
	Language   string
}

// GeocodeResult represents a geocoding result
type GeocodeResult struct {
	PlaceID          string            `json:"place_id"`
	FormattedAddress string            `json:"formatted_address"`
	Geometry         GeocodeGeometry   `json:"geometry"`
	AddressComponents []AddressComponent `json:"address_components"`
	Types            []string          `json:"types"`
}

// GeocodeGeometry contains location data
type GeocodeGeometry struct {
	Location     Coordinate `json:"location"`
	LocationType string     `json:"location_type"`
	Viewport     struct {
		Northeast Coordinate `json:"northeast"`
		Southwest Coordinate `json:"southwest"`
	} `json:"viewport"`
}

// AddressComponent represents a parsed address part
type AddressComponent struct {
	LongName  string   `json:"long_name"`
	ShortName string   `json:"short_name"`
	Types     []string `json:"types"`
}

// GeocodeResponse represents the geocoding API response
type GeocodeResponse struct {
	Results  []GeocodeResult `json:"results"`
	Status   string          `json:"status"`
	ErrorMsg string          `json:"error_message,omitempty"`
}

// Geocode converts an address to coordinates
func (c *MapsClient) Geocode(ctx context.Context, req GeocodeRequest) (*GeocodeResponse, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("Google Maps API key not configured")
	}

	params := url.Values{
		"address": {req.Address},
		"key":     {c.apiKey},
	}

	// Default to supported African countries
	components := req.Components
	if components == "" {
		components = "country:NG|country:KE|country:GH|country:UG|country:TZ|country:RW|country:ZA"
	}
	params.Set("components", components)

	if req.Language != "" {
		params.Set("language", req.Language)
	}

	endpoint := fmt.Sprintf("%s/geocode/json?%s", c.baseURL, params.Encode())

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	var result GeocodeResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parsing response: %w", err)
	}

	if result.Status != "OK" && result.Status != "ZERO_RESULTS" {
		log.Error().
			Str("status", result.Status).
			Str("error", result.ErrorMsg).
			Msg("Google Geocoding API error")
		return nil, fmt.Errorf("API error: %s - %s", result.Status, result.ErrorMsg)
	}

	return &result, nil
}

// ReverseGeocodeRequest represents a reverse geocoding request
type ReverseGeocodeRequest struct {
	Lat        float64
	Lng        float64
	ResultType string // filter by result type, e.g., "street_address"
	Language   string
}

// ReverseGeocode converts coordinates to an address
func (c *MapsClient) ReverseGeocode(ctx context.Context, req ReverseGeocodeRequest) (*GeocodeResponse, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("Google Maps API key not configured")
	}

	params := url.Values{
		"latlng": {fmt.Sprintf("%f,%f", req.Lat, req.Lng)},
		"key":    {c.apiKey},
	}

	if req.ResultType != "" {
		params.Set("result_type", req.ResultType)
	}

	if req.Language != "" {
		params.Set("language", req.Language)
	}

	endpoint := fmt.Sprintf("%s/geocode/json?%s", c.baseURL, params.Encode())

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	var result GeocodeResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parsing response: %w", err)
	}

	if result.Status != "OK" && result.Status != "ZERO_RESULTS" {
		log.Error().
			Str("status", result.Status).
			Str("error", result.ErrorMsg).
			Msg("Google Reverse Geocoding API error")
		return nil, fmt.Errorf("API error: %s - %s", result.Status, result.ErrorMsg)
	}

	return &result, nil
}

// DirectionsRequest represents a directions request
type DirectionsRequest struct {
	OriginLat     float64
	OriginLng     float64
	DestLat       float64
	DestLng       float64
	DepartureTime time.Time
	Mode          string // "driving", "walking", "bicycling", "transit"
	Alternatives  bool
	AvoidTolls    bool
	AvoidHighways bool
}

// DirectionsRoute represents a route in the directions response
type DirectionsRoute struct {
	Summary          string         `json:"summary"`
	Legs             []DirectionsLeg `json:"legs"`
	OverviewPolyline struct {
		Points string `json:"points"`
	} `json:"overview_polyline"`
	Bounds struct {
		Northeast Coordinate `json:"northeast"`
		Southwest Coordinate `json:"southwest"`
	} `json:"bounds"`
	Warnings []string `json:"warnings"`
}

// DirectionsLeg represents a leg of a route
type DirectionsLeg struct {
	Distance struct {
		Value int    `json:"value"` // meters
		Text  string `json:"text"`
	} `json:"distance"`
	Duration struct {
		Value int    `json:"value"` // seconds
		Text  string `json:"text"`
	} `json:"duration"`
	DurationInTraffic struct {
		Value int    `json:"value"` // seconds
		Text  string `json:"text"`
	} `json:"duration_in_traffic"`
	StartLocation Coordinate `json:"start_location"`
	EndLocation   Coordinate `json:"end_location"`
	StartAddress  string     `json:"start_address"`
	EndAddress    string     `json:"end_address"`
	Steps         []DirectionsStep `json:"steps"`
}

// DirectionsStep represents a step in a route leg
type DirectionsStep struct {
	Distance struct {
		Value int    `json:"value"`
		Text  string `json:"text"`
	} `json:"distance"`
	Duration struct {
		Value int    `json:"value"`
		Text  string `json:"text"`
	} `json:"duration"`
	StartLocation    Coordinate `json:"start_location"`
	EndLocation      Coordinate `json:"end_location"`
	HTMLInstructions string     `json:"html_instructions"`
	Maneuver         string     `json:"maneuver"`
	Polyline         struct {
		Points string `json:"points"`
	} `json:"polyline"`
}

// DirectionsResponse represents the directions API response
type DirectionsResponse struct {
	Routes   []DirectionsRoute `json:"routes"`
	Status   string            `json:"status"`
	ErrorMsg string            `json:"error_message,omitempty"`
}

// GetDirections fetches driving directions between two points
func (c *MapsClient) GetDirections(ctx context.Context, req DirectionsRequest) (*DirectionsResponse, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("Google Maps API key not configured")
	}

	params := url.Values{
		"origin":      {fmt.Sprintf("%f,%f", req.OriginLat, req.OriginLng)},
		"destination": {fmt.Sprintf("%f,%f", req.DestLat, req.DestLng)},
		"key":         {c.apiKey},
	}

	mode := req.Mode
	if mode == "" {
		mode = "driving"
	}
	params.Set("mode", mode)

	// Request traffic info for driving
	if mode == "driving" {
		if req.DepartureTime.IsZero() {
			params.Set("departure_time", "now")
		} else {
			params.Set("departure_time", fmt.Sprintf("%d", req.DepartureTime.Unix()))
		}
		params.Set("traffic_model", "best_guess")
	}

	if req.Alternatives {
		params.Set("alternatives", "true")
	}

	var avoid []string
	if req.AvoidTolls {
		avoid = append(avoid, "tolls")
	}
	if req.AvoidHighways {
		avoid = append(avoid, "highways")
	}
	if len(avoid) > 0 {
		params.Set("avoid", strings.Join(avoid, "|"))
	}

	endpoint := fmt.Sprintf("%s/directions/json?%s", c.baseURL, params.Encode())

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	var result DirectionsResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parsing response: %w", err)
	}

	if result.Status != "OK" && result.Status != "ZERO_RESULTS" {
		log.Error().
			Str("status", result.Status).
			Str("error", result.ErrorMsg).
			Msg("Google Directions API error")
		return nil, fmt.Errorf("API error: %s - %s", result.Status, result.ErrorMsg)
	}

	return &result, nil
}

// PlaceDetailsRequest represents a place details request
type PlaceDetailsRequest struct {
	PlaceID  string
	Fields   string // comma-separated list of fields
	Language string
}

// PlaceDetails represents detailed place information
type PlaceDetails struct {
	PlaceID          string            `json:"place_id"`
	Name             string            `json:"name"`
	FormattedAddress string            `json:"formatted_address"`
	Geometry         GeocodeGeometry   `json:"geometry"`
	AddressComponents []AddressComponent `json:"address_components"`
	FormattedPhone   string            `json:"formatted_phone_number"`
	Website          string            `json:"website"`
	URL              string            `json:"url"` // Google Maps URL
	Types            []string          `json:"types"`
}

// PlaceDetailsResponse represents the place details API response
type PlaceDetailsResponse struct {
	Result   PlaceDetails `json:"result"`
	Status   string       `json:"status"`
	ErrorMsg string       `json:"error_message,omitempty"`
}

// GetPlaceDetails fetches detailed information about a place
func (c *MapsClient) GetPlaceDetails(ctx context.Context, req PlaceDetailsRequest) (*PlaceDetailsResponse, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("Google Maps API key not configured")
	}

	params := url.Values{
		"place_id": {req.PlaceID},
		"key":      {c.apiKey},
	}

	fields := req.Fields
	if fields == "" {
		// Default to commonly needed fields
		fields = "place_id,name,formatted_address,geometry,address_components,types"
	}
	params.Set("fields", fields)

	if req.Language != "" {
		params.Set("language", req.Language)
	}

	endpoint := fmt.Sprintf("%s/place/details/json?%s", c.baseURL, params.Encode())

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	var result PlaceDetailsResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parsing response: %w", err)
	}

	if result.Status != "OK" {
		log.Error().
			Str("status", result.Status).
			Str("error", result.ErrorMsg).
			Msg("Google Place Details API error")
		return nil, fmt.Errorf("API error: %s - %s", result.Status, result.ErrorMsg)
	}

	return &result, nil
}

// DistanceMatrixRequest represents a distance matrix request
type DistanceMatrixRequest struct {
	Origins       []Coordinate
	Destinations  []Coordinate
	DepartureTime time.Time
	Mode          string
	AvoidTolls    bool
	AvoidHighways bool
}

// DistanceMatrixElement represents a single origin-destination pair result
type DistanceMatrixElement struct {
	Distance struct {
		Value int    `json:"value"` // meters
		Text  string `json:"text"`
	} `json:"distance"`
	Duration struct {
		Value int    `json:"value"` // seconds
		Text  string `json:"text"`
	} `json:"duration"`
	DurationInTraffic struct {
		Value int    `json:"value"` // seconds
		Text  string `json:"text"`
	} `json:"duration_in_traffic"`
	Status string `json:"status"`
}

// DistanceMatrixRow represents results for one origin
type DistanceMatrixRow struct {
	Elements []DistanceMatrixElement `json:"elements"`
}

// DistanceMatrixResponse represents the distance matrix API response
type DistanceMatrixResponse struct {
	OriginAddresses      []string            `json:"origin_addresses"`
	DestinationAddresses []string            `json:"destination_addresses"`
	Rows                 []DistanceMatrixRow `json:"rows"`
	Status               string              `json:"status"`
	ErrorMsg             string              `json:"error_message,omitempty"`
}

// GetDistanceMatrix calculates distances and durations between multiple origins and destinations
func (c *MapsClient) GetDistanceMatrix(ctx context.Context, req DistanceMatrixRequest) (*DistanceMatrixResponse, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("Google Maps API key not configured")
	}

	// Build origins string
	var origins []string
	for _, o := range req.Origins {
		origins = append(origins, fmt.Sprintf("%f,%f", o.Lat, o.Lng))
	}

	// Build destinations string
	var destinations []string
	for _, d := range req.Destinations {
		destinations = append(destinations, fmt.Sprintf("%f,%f", d.Lat, d.Lng))
	}

	params := url.Values{
		"origins":      {strings.Join(origins, "|")},
		"destinations": {strings.Join(destinations, "|")},
		"key":          {c.apiKey},
	}

	mode := req.Mode
	if mode == "" {
		mode = "driving"
	}
	params.Set("mode", mode)

	if mode == "driving" {
		if req.DepartureTime.IsZero() {
			params.Set("departure_time", "now")
		} else {
			params.Set("departure_time", fmt.Sprintf("%d", req.DepartureTime.Unix()))
		}
		params.Set("traffic_model", "best_guess")
	}

	var avoid []string
	if req.AvoidTolls {
		avoid = append(avoid, "tolls")
	}
	if req.AvoidHighways {
		avoid = append(avoid, "highways")
	}
	if len(avoid) > 0 {
		params.Set("avoid", strings.Join(avoid, "|"))
	}

	endpoint := fmt.Sprintf("%s/distancematrix/json?%s", c.baseURL, params.Encode())

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	var result DistanceMatrixResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parsing response: %w", err)
	}

	if result.Status != "OK" {
		log.Error().
			Str("status", result.Status).
			Str("error", result.ErrorMsg).
			Msg("Google Distance Matrix API error")
		return nil, fmt.Errorf("API error: %s - %s", result.Status, result.ErrorMsg)
	}

	return &result, nil
}

// IsConfigured returns true if the Maps client has an API key configured
func (c *MapsClient) IsConfigured() bool {
	return c.apiKey != ""
}
