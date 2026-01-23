package geo

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMapsClient_Autocomplete(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request path
		if r.URL.Path != "/place/autocomplete/json" {
			t.Errorf("Expected path /place/autocomplete/json, got %s", r.URL.Path)
		}

		// Verify input parameter
		input := r.URL.Query().Get("input")
		if input != "Lagos Airport" {
			t.Errorf("Expected input 'Lagos Airport', got '%s'", input)
		}

		// Return mock response
		response := AutocompleteResponse{
			Status: "OK",
			Predictions: []AutocompletePrediction{
				{
					PlaceID:     "ChIJN1t_tDeuEmsRUsoyG83frY4",
					Description: "Murtala Muhammed International Airport, Lagos, Nigeria",
					MainText:    "Murtala Muhammed International Airport",
					SecondaryText: "Lagos, Nigeria",
				},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	// Create client with test server
	client := &MapsClient{
		apiKey:     "test-api-key",
		httpClient: &http.Client{Timeout: 10 * time.Second},
		baseURL:    server.URL,
	}

	// Make request
	result, err := client.Autocomplete(context.Background(), AutocompleteRequest{
		Input: "Lagos Airport",
		Lat:   6.5244,
		Lng:   3.3792,
	})

	if err != nil {
		t.Fatalf("Autocomplete failed: %v", err)
	}

	if len(result.Predictions) != 1 {
		t.Errorf("Expected 1 prediction, got %d", len(result.Predictions))
	}

	if result.Predictions[0].PlaceID != "ChIJN1t_tDeuEmsRUsoyG83frY4" {
		t.Errorf("Unexpected place ID: %s", result.Predictions[0].PlaceID)
	}
}

func TestMapsClient_Geocode(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/geocode/json" {
			t.Errorf("Expected path /geocode/json, got %s", r.URL.Path)
		}

		response := GeocodeResponse{
			Status: "OK",
			Results: []GeocodeResult{
				{
					PlaceID:          "ChIJD5gyo-yROxARAFPVLxeb4sY",
					FormattedAddress: "Nairobi, Kenya",
					Geometry: GeocodeGeometry{
						Location: Coordinate{
							Lat: -1.2921,
							Lng: 36.8219,
						},
						LocationType: "APPROXIMATE",
					},
				},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := &MapsClient{
		apiKey:     "test-api-key",
		httpClient: &http.Client{Timeout: 10 * time.Second},
		baseURL:    server.URL,
	}

	result, err := client.Geocode(context.Background(), GeocodeRequest{
		Address: "Nairobi, Kenya",
	})

	if err != nil {
		t.Fatalf("Geocode failed: %v", err)
	}

	if len(result.Results) != 1 {
		t.Errorf("Expected 1 result, got %d", len(result.Results))
	}

	if result.Results[0].Geometry.Location.Lat != -1.2921 {
		t.Errorf("Unexpected latitude: %f", result.Results[0].Geometry.Location.Lat)
	}
}

func TestMapsClient_ReverseGeocode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/geocode/json" {
			t.Errorf("Expected path /geocode/json, got %s", r.URL.Path)
		}

		// Verify latlng parameter
		latlng := r.URL.Query().Get("latlng")
		if latlng == "" {
			t.Error("Expected latlng parameter")
		}

		response := GeocodeResponse{
			Status: "OK",
			Results: []GeocodeResult{
				{
					PlaceID:          "ChIJD5gyo-yROxARAFPVLxeb4sY",
					FormattedAddress: "123 Main Street, Accra, Ghana",
					AddressComponents: []AddressComponent{
						{LongName: "Accra", ShortName: "Accra", Types: []string{"locality"}},
						{LongName: "Ghana", ShortName: "GH", Types: []string{"country"}},
					},
				},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := &MapsClient{
		apiKey:     "test-api-key",
		httpClient: &http.Client{Timeout: 10 * time.Second},
		baseURL:    server.URL,
	}

	result, err := client.ReverseGeocode(context.Background(), ReverseGeocodeRequest{
		Lat: 5.6037,
		Lng: -0.1870,
	})

	if err != nil {
		t.Fatalf("ReverseGeocode failed: %v", err)
	}

	if len(result.Results) != 1 {
		t.Errorf("Expected 1 result, got %d", len(result.Results))
	}

	if result.Results[0].FormattedAddress != "123 Main Street, Accra, Ghana" {
		t.Errorf("Unexpected address: %s", result.Results[0].FormattedAddress)
	}
}

func TestMapsClient_GetDirections(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/directions/json" {
			t.Errorf("Expected path /directions/json, got %s", r.URL.Path)
		}

		response := DirectionsResponse{
			Status: "OK",
			Routes: []DirectionsRoute{
				{
					Summary: "A1 Highway",
					Legs: []DirectionsLeg{
						{
							Distance: struct {
								Value int    `json:"value"`
								Text  string `json:"text"`
							}{Value: 15000, Text: "15 km"},
							Duration: struct {
								Value int    `json:"value"`
								Text  string `json:"text"`
							}{Value: 1800, Text: "30 mins"},
							DurationInTraffic: struct {
								Value int    `json:"value"`
								Text  string `json:"text"`
							}{Value: 2400, Text: "40 mins"},
						},
					},
				},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := &MapsClient{
		apiKey:     "test-api-key",
		httpClient: &http.Client{Timeout: 10 * time.Second},
		baseURL:    server.URL,
	}

	result, err := client.GetDirections(context.Background(), DirectionsRequest{
		OriginLat: 6.5244,
		OriginLng: 3.3792,
		DestLat:   6.4541,
		DestLng:   3.3947,
	})

	if err != nil {
		t.Fatalf("GetDirections failed: %v", err)
	}

	if len(result.Routes) != 1 {
		t.Errorf("Expected 1 route, got %d", len(result.Routes))
	}

	if result.Routes[0].Legs[0].Distance.Value != 15000 {
		t.Errorf("Unexpected distance: %d", result.Routes[0].Legs[0].Distance.Value)
	}
}

func TestMapsClient_NotConfigured(t *testing.T) {
	client := &MapsClient{
		apiKey:     "",
		httpClient: &http.Client{Timeout: 10 * time.Second},
		baseURL:    "https://maps.googleapis.com/maps/api",
	}

	// All methods should fail when API key is not configured
	_, err := client.Autocomplete(context.Background(), AutocompleteRequest{Input: "test"})
	if err == nil {
		t.Error("Expected error when API key not configured")
	}

	_, err = client.Geocode(context.Background(), GeocodeRequest{Address: "test"})
	if err == nil {
		t.Error("Expected error when API key not configured")
	}

	_, err = client.ReverseGeocode(context.Background(), ReverseGeocodeRequest{Lat: 0, Lng: 0})
	if err == nil {
		t.Error("Expected error when API key not configured")
	}

	_, err = client.GetDirections(context.Background(), DirectionsRequest{})
	if err == nil {
		t.Error("Expected error when API key not configured")
	}
}

func TestMapsClient_IsConfigured(t *testing.T) {
	client := NewMapsClient(MapsClientConfig{APIKey: ""})
	if client.IsConfigured() {
		t.Error("Expected IsConfigured to return false without API key")
	}

	client = NewMapsClient(MapsClientConfig{APIKey: "test-key"})
	if !client.IsConfigured() {
		t.Error("Expected IsConfigured to return true with API key")
	}
}

func TestMapsClient_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := AutocompleteResponse{
			Status:   "REQUEST_DENIED",
			ErrorMsg: "API key is invalid",
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := &MapsClient{
		apiKey:     "invalid-key",
		httpClient: &http.Client{Timeout: 10 * time.Second},
		baseURL:    server.URL,
	}

	_, err := client.Autocomplete(context.Background(), AutocompleteRequest{Input: "test"})
	if err == nil {
		t.Error("Expected error for API error response")
	}
}
