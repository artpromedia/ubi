package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/ubi/ride-service/internal/testutil"
)

// RideEstimateRequest represents a ride estimate request
type RideEstimateRequest struct {
	PickupLat      float64 `json:"pickup_lat"`
	PickupLng      float64 `json:"pickup_lng"`
	DropoffLat     float64 `json:"dropoff_lat"`
	DropoffLng     float64 `json:"dropoff_lng"`
	VehicleType    string  `json:"vehicle_type"`
}

// RideEstimateResponse represents a ride estimate response
type RideEstimateResponse struct {
	EstimatedFare   int64   `json:"estimated_fare"`
	Currency        string  `json:"currency"`
	DistanceMeters  int     `json:"distance_meters"`
	DurationSeconds int     `json:"duration_seconds"`
	VehicleType     string  `json:"vehicle_type"`
	SurgeMultiplier float64 `json:"surge_multiplier"`
}

// RideHandler handles ride HTTP requests
type RideHandler struct {
	pricingService *testutil.MockPricingService
}

// NewRideHandler creates a new ride handler
func NewRideHandler(pricing *testutil.MockPricingService) *RideHandler {
	return &RideHandler{pricingService: pricing}
}

// Routes returns the ride routes
func (h *RideHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/estimate", h.GetEstimate)
	return r
}

// GetEstimate handles ride estimate requests
func (h *RideHandler) GetEstimate(w http.ResponseWriter, r *http.Request) {
	var req RideEstimateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Validate vehicle type
	validTypes := map[string]bool{"standard": true, "premium": true, "xl": true}
	if !validTypes[req.VehicleType] {
		http.Error(w, "Invalid vehicle type", http.StatusBadRequest)
		return
	}

	// Calculate distance (simplified)
	latDiff := req.DropoffLat - req.PickupLat
	lngDiff := req.DropoffLng - req.PickupLng
	distanceKm := (latDiff*latDiff + lngDiff*lngDiff) * 111.0 // Rough approximation
	distanceMeters := int(distanceKm * 1000)
	durationSeconds := int(distanceKm * 3 * 60) // ~20km/h average in city

	estimate, err := h.pricingService.CalculateEstimate(
		r.Context(),
		distanceMeters,
		durationSeconds,
		req.VehicleType,
	)
	if err != nil {
		http.Error(w, "Failed to calculate estimate", http.StatusInternalServerError)
		return
	}

	resp := RideEstimateResponse{
		EstimatedFare:   estimate.TotalFare,
		Currency:        estimate.Currency,
		DistanceMeters:  distanceMeters,
		DurationSeconds: durationSeconds,
		VehicleType:     req.VehicleType,
		SurgeMultiplier: estimate.SurgeMultiplier,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// ========================================
// Tests
// ========================================

func TestRideEstimate_Success(t *testing.T) {
	// Setup
	pricing := testutil.NewMockPricingService()
	handler := NewRideHandler(pricing)

	router := chi.NewRouter()
	router.Mount("/rides", handler.Routes())

	server := testutil.NewTestServer(router)
	defer server.Close()

	client := testutil.NewTestClient(server.BaseURL)

	// Test
	ctx := context.Background()
	req := RideEstimateRequest{
		PickupLat:   testutil.DefaultNigeriaLocation.Lat,
		PickupLng:   testutil.DefaultNigeriaLocation.Lng,
		DropoffLat:  6.4281,
		DropoffLng:  3.4219,
		VehicleType: "standard",
	}

	resp, err := client.Post(ctx, "/rides/estimate", req)
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}

	// Assertions
	assert := testutil.NewAssert(t)
	assert.Equal(http.StatusOK, resp.StatusCode)

	parsedResp := testutil.ParseResponse(t, resp)
	var result RideEstimateResponse
	assert.NoError(parsedResp.JSON(&result))
	
	assert.Greater(result.EstimatedFare, int64(0), "Expected positive fare")
	assert.Equal("NGN", result.Currency)
	assert.Equal("standard", result.VehicleType)
	assert.Greater(result.DistanceMeters, 0)
	assert.Greater(result.DurationSeconds, 0)
}

func TestRideEstimate_WithSurge(t *testing.T) {
	// Setup
	pricing := testutil.NewMockPricingService()
	pricing.SetSurge(1.5) // 50% surge
	handler := NewRideHandler(pricing)

	router := chi.NewRouter()
	router.Mount("/rides", handler.Routes())

	server := testutil.NewTestServer(router)
	defer server.Close()

	client := testutil.NewTestClient(server.BaseURL)

	// Test
	ctx := context.Background()
	req := RideEstimateRequest{
		PickupLat:   testutil.DefaultNigeriaLocation.Lat,
		PickupLng:   testutil.DefaultNigeriaLocation.Lng,
		DropoffLat:  6.4281,
		DropoffLng:  3.4219,
		VehicleType: "standard",
	}

	resp, err := client.Post(ctx, "/rides/estimate", req)
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}

	// Assertions
	assert := testutil.NewAssert(t)
	assert.Equal(http.StatusOK, resp.StatusCode)

	parsedResp := testutil.ParseResponse(t, resp)
	var result RideEstimateResponse
	assert.NoError(parsedResp.JSON(&result))
	assert.InDelta(1.5, result.SurgeMultiplier, 0.01)
}

func TestRideEstimate_PremiumVehicle(t *testing.T) {
	// Setup
	pricing := testutil.NewMockPricingService()
	handler := NewRideHandler(pricing)

	router := chi.NewRouter()
	router.Mount("/rides", handler.Routes())

	server := testutil.NewTestServer(router)
	defer server.Close()

	client := testutil.NewTestClient(server.BaseURL)

	// Test
	ctx := context.Background()

	// Get standard estimate
	standardReq := RideEstimateRequest{
		PickupLat:   testutil.DefaultNigeriaLocation.Lat,
		PickupLng:   testutil.DefaultNigeriaLocation.Lng,
		DropoffLat:  6.4281,
		DropoffLng:  3.4219,
		VehicleType: "standard",
	}

	standardResp, _ := client.Post(ctx, "/rides/estimate", standardReq)
	parsedStandard := testutil.ParseResponse(t, standardResp)
	var standardResult RideEstimateResponse
	parsedStandard.JSON(&standardResult)

	// Get premium estimate
	premiumReq := RideEstimateRequest{
		PickupLat:   testutil.DefaultNigeriaLocation.Lat,
		PickupLng:   testutil.DefaultNigeriaLocation.Lng,
		DropoffLat:  6.4281,
		DropoffLng:  3.4219,
		VehicleType: "premium",
	}

	premiumResp, _ := client.Post(ctx, "/rides/estimate", premiumReq)
	parsedPremium := testutil.ParseResponse(t, premiumResp)
	var premiumResult RideEstimateResponse
	parsedPremium.JSON(&premiumResult)

	// Premium should be more expensive
	assert := testutil.NewAssert(t)
	assert.Greater(premiumResult.EstimatedFare, standardResult.EstimatedFare)
	assert.Equal("premium", premiumResult.VehicleType)
}

func TestRideEstimate_InvalidVehicleType(t *testing.T) {
	// Setup
	pricing := testutil.NewMockPricingService()
	handler := NewRideHandler(pricing)

	router := chi.NewRouter()
	router.Mount("/rides", handler.Routes())

	server := testutil.NewTestServer(router)
	defer server.Close()

	client := testutil.NewTestClient(server.BaseURL)

	// Test
	ctx := context.Background()
	req := RideEstimateRequest{
		PickupLat:   testutil.DefaultNigeriaLocation.Lat,
		PickupLng:   testutil.DefaultNigeriaLocation.Lng,
		DropoffLat:  6.4281,
		DropoffLng:  3.4219,
		VehicleType: "invalid_type",
	}

	resp, err := client.Post(ctx, "/rides/estimate", req)
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}

	// Assertions
	assert := testutil.NewAssert(t)
	assert.Equal(http.StatusBadRequest, resp.StatusCode)
}

func TestRideEstimate_ServiceError(t *testing.T) {
	// Setup
	pricing := testutil.NewMockPricingService()
	pricing.SetFailure(true, nil)
	handler := NewRideHandler(pricing)

	router := chi.NewRouter()
	router.Mount("/rides", handler.Routes())

	server := testutil.NewTestServer(router)
	defer server.Close()

	client := testutil.NewTestClient(server.BaseURL)

	// Test
	ctx := context.Background()
	req := RideEstimateRequest{
		PickupLat:   testutil.DefaultNigeriaLocation.Lat,
		PickupLng:   testutil.DefaultNigeriaLocation.Lng,
		DropoffLat:  6.4281,
		DropoffLng:  3.4219,
		VehicleType: "standard",
	}

	resp, err := client.Post(ctx, "/rides/estimate", req)
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}

	// Assertions
	assert := testutil.NewAssert(t)
	assert.Equal(http.StatusInternalServerError, resp.StatusCode)
}

func TestRideEstimate_InvalidJSON(t *testing.T) {
	// Setup
	pricing := testutil.NewMockPricingService()
	handler := NewRideHandler(pricing)

	router := chi.NewRouter()
	router.Mount("/rides", handler.Routes())

	server := testutil.NewTestServer(router)
	defer server.Close()

	// Test with invalid JSON
	req, _ := http.NewRequest(http.MethodPost, server.BaseURL+"/rides/estimate", nil)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}

	// Assertions
	assert := testutil.NewAssert(t)
	assert.Equal(http.StatusBadRequest, resp.StatusCode)
}

// Table-driven tests for different locations
func TestRideEstimate_DifferentLocations(t *testing.T) {
	testCases := []struct {
		name       string
		pickup     testutil.LocationFixture
		dropoffLat float64
		dropoffLng float64
	}{
		{
			name:       "Lagos Victoria Island to Ikeja",
			pickup:     testutil.DefaultNigeriaLocation,
			dropoffLat: 6.6018,
			dropoffLng: 3.3515,
		},
		{
			name:       "Nairobi CBD to Westlands",
			pickup:     testutil.DefaultKenyaLocation,
			dropoffLat: -1.2673,
			dropoffLng: 36.8111,
		},
		{
			name:       "Cape Town Waterfront to Gardens",
			pickup:     testutil.DefaultSouthAfricaLocation,
			dropoffLat: -33.9321,
			dropoffLng: 18.4149,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Setup
			pricing := testutil.NewMockPricingService()
			handler := NewRideHandler(pricing)

			router := chi.NewRouter()
			router.Mount("/rides", handler.Routes())

			server := testutil.NewTestServer(router)
			defer server.Close()

			client := testutil.NewTestClient(server.BaseURL)

			// Test
			ctx := context.Background()
			req := RideEstimateRequest{
				PickupLat:   tc.pickup.Lat,
				PickupLng:   tc.pickup.Lng,
				DropoffLat:  tc.dropoffLat,
				DropoffLng:  tc.dropoffLng,
				VehicleType: "standard",
			}

			resp, err := client.Post(ctx, "/rides/estimate", req)
			if err != nil {
				t.Fatalf("Request failed: %v", err)
			}

			// Assertions
			assert := testutil.NewAssert(t)
			assert.Equal(http.StatusOK, resp.StatusCode)

			parsedResp := testutil.ParseResponse(t, resp)
			var result RideEstimateResponse
			assert.NoError(parsedResp.JSON(&result))
			assert.Greater(result.EstimatedFare, int64(0))
		})
	}
}
