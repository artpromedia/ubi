package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"ride-service/internal/prediction"

	"github.com/go-chi/chi/v5"
)

// PredictionHandler handles location prediction API requests
type PredictionHandler struct {
	predictionService *prediction.Service
}

// NewPredictionHandler creates a new prediction handler
func NewPredictionHandler(ps *prediction.Service) *PredictionHandler {
	return &PredictionHandler{
		predictionService: ps,
	}
}

// RegisterRoutes registers prediction routes
func (h *PredictionHandler) RegisterRoutes(r chi.Router) {
	r.Route("/users/me/predicted-locations", func(r chi.Router) {
		r.Get("/", h.GetPredictedLocations)
	})
	r.Route("/users/me/predictions", func(r chi.Router) {
		r.Put("/opt-out", h.SetOptOut)
		r.Delete("/data", h.DeleteData)
	})
}

// GetPredictedLocationsResponse is the API response for predicted locations
type GetPredictedLocationsResponse struct {
	Predictions []PredictedLocationDTO `json:"predictions"`
	Source      string                 `json:"source"` // "personalized" or "popular"
}

// PredictedLocationDTO is the API representation of a predicted location
type PredictedLocationDTO struct {
	PlaceID    string  `json:"place_id"`
	Name       string  `json:"name"`
	Address    string  `json:"address"`
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
	Confidence float64 `json:"confidence"`
	Label      string  `json:"label,omitempty"`
	Category   string  `json:"category"`
}

// GetPredictedLocations handles GET /api/v1/users/me/predicted-locations
// @Summary Get predicted destinations
// @Description Returns ML-powered destination predictions based on user patterns
// @Tags locations
// @Accept json
// @Produce json
// @Param lat query number true "Current latitude"
// @Param lng query number true "Current longitude"
// @Success 200 {object} GetPredictedLocationsResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /users/me/predicted-locations [get]
func (h *PredictionHandler) GetPredictedLocations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Get user ID from context (set by auth middleware)
	userID, ok := ctx.Value("user_id").(string)
	if !ok || userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// Parse query parameters
	latStr := r.URL.Query().Get("lat")
	lngStr := r.URL.Query().Get("lng")

	if latStr == "" || lngStr == "" {
		writeError(w, http.StatusBadRequest, "lat and lng query parameters are required")
		return
	}

	lat, err := strconv.ParseFloat(latStr, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid lat parameter")
		return
	}

	lng, err := strconv.ParseFloat(lngStr, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid lng parameter")
		return
	}

	// Get predictions
	predictions, err := h.predictionService.GetPredictedLocations(ctx, userID, lat, lng)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get predictions")
		return
	}

	// Convert to DTOs
	dtos := make([]PredictedLocationDTO, len(predictions))
	source := "personalized"

	for i, p := range predictions {
		dtos[i] = PredictedLocationDTO{
			PlaceID:    p.PlaceID,
			Name:       p.Name,
			Address:    p.Address,
			Latitude:   p.Latitude,
			Longitude:  p.Longitude,
			Confidence: p.Confidence,
			Label:      p.Label,
			Category:   p.Category,
		}

		if p.Category == "popular" {
			source = "popular"
		}
	}

	response := GetPredictedLocationsResponse{
		Predictions: dtos,
		Source:      source,
	}

	writeJSON(w, http.StatusOK, response)
}

// OptOutRequest is the request body for setting prediction opt-out
type OptOutRequest struct {
	OptOut bool `json:"opt_out"`
}

// SetOptOut handles PUT /api/v1/users/me/predictions/opt-out
// @Summary Set prediction opt-out preference
// @Description Allows users to opt out of location predictions (privacy control)
// @Tags locations
// @Accept json
// @Produce json
// @Param body body OptOutRequest true "Opt-out preference"
// @Success 200 {object} SuccessResponse
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /users/me/predictions/opt-out [put]
func (h *PredictionHandler) SetOptOut(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	userID, ok := ctx.Value("user_id").(string)
	if !ok || userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req OptOutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.predictionService.SetPredictionOptOut(ctx, userID, req.OptOut); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update preference")
		return
	}

	writeJSON(w, http.StatusOK, SuccessResponse{
		Success: true,
		Message: "Prediction preference updated",
	})
}

// DeleteData handles DELETE /api/v1/users/me/predictions/data
// @Summary Delete all prediction data
// @Description Removes all prediction data for the user (GDPR compliance)
// @Tags locations
// @Produce json
// @Success 200 {object} SuccessResponse
// @Failure 401 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /users/me/predictions/data [delete]
func (h *PredictionHandler) DeleteData(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	userID, ok := ctx.Value("user_id").(string)
	if !ok || userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if err := h.predictionService.DeleteUserData(ctx, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete data")
		return
	}

	writeJSON(w, http.StatusOK, SuccessResponse{
		Success: true,
		Message: "Prediction data deleted",
	})
}

// Helper types and functions

// ErrorResponse represents an API error response
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

// SuccessResponse represents a generic success response
type SuccessResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, ErrorResponse{
		Error:   http.StatusText(status),
		Message: message,
	})
}
