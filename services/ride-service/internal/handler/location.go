// Package handler provides HTTP handlers for the ride service API.
package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
)

// LocationHandler handles location-related HTTP requests (Google Maps integration)
type LocationHandler struct {
	mapsClient *geo.MapsClient
}

// NewLocationHandler creates a new location handler
func NewLocationHandler(mapsClient *geo.MapsClient) *LocationHandler {
	return &LocationHandler{
		mapsClient: mapsClient,
	}
}

// AutocompleteLocation handles Places Autocomplete requests
// GET /locations/autocomplete?input=...&lat=...&lng=...&radius=...
func (h *LocationHandler) AutocompleteLocation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Check if Maps client is configured
	if !h.mapsClient.IsConfigured() {
		writeJSONError(w, http.StatusServiceUnavailable, "MAPS_NOT_CONFIGURED", "Location service not available")
		return
	}

	// Parse query parameters
	input := r.URL.Query().Get("input")
	if input == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_INPUT", "input parameter is required")
		return
	}

	var lat, lng, radius float64
	var err error

	if latStr := r.URL.Query().Get("lat"); latStr != "" {
		lat, err = strconv.ParseFloat(latStr, 64)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "INVALID_LAT", "Invalid latitude value")
			return
		}
	}

	if lngStr := r.URL.Query().Get("lng"); lngStr != "" {
		lng, err = strconv.ParseFloat(lngStr, 64)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "INVALID_LNG", "Invalid longitude value")
			return
		}
	}

	if radiusStr := r.URL.Query().Get("radius"); radiusStr != "" {
		radius, err = strconv.ParseFloat(radiusStr, 64)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "INVALID_RADIUS", "Invalid radius value")
			return
		}
	}

	// Build request
	req := geo.AutocompleteRequest{
		Input:      input,
		Lat:        lat,
		Lng:        lng,
		RadiusM:    radius,
		Language:   r.URL.Query().Get("language"),
		Components: r.URL.Query().Get("components"),
		Types:      r.URL.Query().Get("types"),
	}

	// Call Maps API
	result, err := h.mapsClient.Autocomplete(ctx, req)
	if err != nil {
		log.Error().Err(err).Str("input", input).Msg("Autocomplete request failed")
		writeJSONError(w, http.StatusInternalServerError, "MAPS_ERROR", "Failed to fetch location suggestions")
		return
	}

	// Transform to our response format
	type Prediction struct {
		PlaceID       string `json:"place_id"`
		MainText      string `json:"main_text"`
		SecondaryText string `json:"secondary_text"`
		Description   string `json:"description"`
	}

	predictions := make([]Prediction, 0, len(result.Predictions))
	for _, p := range result.Predictions {
		predictions = append(predictions, Prediction{
			PlaceID:       p.PlaceID,
			MainText:      p.MainText,
			SecondaryText: p.SecondaryText,
			Description:   p.Description,
		})
	}

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"success":     true,
		"predictions": predictions,
	})
}

// GeocodeAddress converts an address to coordinates
// GET /locations/geocode?address=...
func (h *LocationHandler) GeocodeAddress(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Check if Maps client is configured
	if !h.mapsClient.IsConfigured() {
		writeJSONError(w, http.StatusServiceUnavailable, "MAPS_NOT_CONFIGURED", "Location service not available")
		return
	}

	// Parse query parameters
	address := r.URL.Query().Get("address")
	if address == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_ADDRESS", "address parameter is required")
		return
	}

	// Build request
	req := geo.GeocodeRequest{
		Address:    address,
		Language:   r.URL.Query().Get("language"),
		Components: r.URL.Query().Get("components"),
	}

	// Call Maps API
	result, err := h.mapsClient.Geocode(ctx, req)
	if err != nil {
		log.Error().Err(err).Str("address", address).Msg("Geocode request failed")
		writeJSONError(w, http.StatusInternalServerError, "MAPS_ERROR", "Failed to geocode address")
		return
	}

	if len(result.Results) == 0 {
		writeJSONError(w, http.StatusNotFound, "NO_RESULTS", "No location found for the given address")
		return
	}

	// Return first result
	first := result.Results[0]
	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"location": map[string]interface{}{
			"place_id":          first.PlaceID,
			"formatted_address": first.FormattedAddress,
			"lat":               first.Geometry.Location.Lat,
			"lng":               first.Geometry.Location.Lng,
			"location_type":     first.Geometry.LocationType,
		},
	})
}

// ReverseGeocode converts coordinates to an address
// GET /locations/reverse?lat=...&lng=...
func (h *LocationHandler) ReverseGeocode(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Check if Maps client is configured
	if !h.mapsClient.IsConfigured() {
		writeJSONError(w, http.StatusServiceUnavailable, "MAPS_NOT_CONFIGURED", "Location service not available")
		return
	}

	// Parse query parameters
	latStr := r.URL.Query().Get("lat")
	lngStr := r.URL.Query().Get("lng")

	if latStr == "" || lngStr == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_PARAMS", "lat and lng parameters are required")
		return
	}

	lat, err := strconv.ParseFloat(latStr, 64)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "INVALID_LAT", "Invalid latitude value")
		return
	}

	lng, err := strconv.ParseFloat(lngStr, 64)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "INVALID_LNG", "Invalid longitude value")
		return
	}

	// Validate coordinates
	if !geo.IsValidCoordinate(lat, lng) {
		writeJSONError(w, http.StatusBadRequest, "INVALID_COORDS", "Coordinates out of valid range")
		return
	}

	// Build request
	req := geo.ReverseGeocodeRequest{
		Lat:        lat,
		Lng:        lng,
		Language:   r.URL.Query().Get("language"),
		ResultType: r.URL.Query().Get("result_type"),
	}

	// Call Maps API
	result, err := h.mapsClient.ReverseGeocode(ctx, req)
	if err != nil {
		log.Error().Err(err).Float64("lat", lat).Float64("lng", lng).Msg("Reverse geocode request failed")
		writeJSONError(w, http.StatusInternalServerError, "MAPS_ERROR", "Failed to reverse geocode")
		return
	}

	if len(result.Results) == 0 {
		writeJSONError(w, http.StatusNotFound, "NO_RESULTS", "No address found for the given coordinates")
		return
	}

	// Return first result
	first := result.Results[0]
	
	// Extract useful address components
	var city, country, postalCode string
	for _, comp := range first.AddressComponents {
		for _, t := range comp.Types {
			switch t {
			case "locality":
				city = comp.LongName
			case "country":
				country = comp.ShortName
			case "postal_code":
				postalCode = comp.ShortName
			}
		}
	}

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"address": map[string]interface{}{
			"place_id":          first.PlaceID,
			"formatted_address": first.FormattedAddress,
			"city":              city,
			"country":           country,
			"postal_code":       postalCode,
			"types":             first.Types,
		},
	})
}

// GetPlaceDetails fetches detailed information about a place
// GET /locations/place?place_id=...
func (h *LocationHandler) GetPlaceDetails(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Check if Maps client is configured
	if !h.mapsClient.IsConfigured() {
		writeJSONError(w, http.StatusServiceUnavailable, "MAPS_NOT_CONFIGURED", "Location service not available")
		return
	}

	// Parse query parameters
	placeID := r.URL.Query().Get("place_id")
	if placeID == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_PLACE_ID", "place_id parameter is required")
		return
	}

	// Build request
	req := geo.PlaceDetailsRequest{
		PlaceID:  placeID,
		Fields:   r.URL.Query().Get("fields"),
		Language: r.URL.Query().Get("language"),
	}

	// Call Maps API
	result, err := h.mapsClient.GetPlaceDetails(ctx, req)
	if err != nil {
		log.Error().Err(err).Str("place_id", placeID).Msg("Place details request failed")
		writeJSONError(w, http.StatusInternalServerError, "MAPS_ERROR", "Failed to fetch place details")
		return
	}

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"place": map[string]interface{}{
			"place_id":          result.Result.PlaceID,
			"name":              result.Result.Name,
			"formatted_address": result.Result.FormattedAddress,
			"lat":               result.Result.Geometry.Location.Lat,
			"lng":               result.Result.Geometry.Location.Lng,
			"types":             result.Result.Types,
		},
	})
}

// Helper functions

func writeJSONResponse(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeJSONError(w http.ResponseWriter, status int, code, message string) {
	writeJSONResponse(w, status, map[string]interface{}{
		"success": false,
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}
