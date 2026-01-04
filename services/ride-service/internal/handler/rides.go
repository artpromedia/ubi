// Package handler provides HTTP handlers for the ride service API.
package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/pricing"
)

// Error message constants
const (
	errMsgInvalidRequestBody = "Invalid request body"
	errMsgInvalidRideID      = "Invalid ride ID"
	errMsgRideNotFound       = "Ride not found"
)

// RideService defines the ride service interface
type RideService interface {
	RequestRide(ctx context.Context, req *domain.RideRequest) (*domain.Ride, error)
	GetRide(ctx context.Context, rideID uuid.UUID) (*domain.Ride, error)
	CancelRide(ctx context.Context, rideID, userID uuid.UUID, reason string) error
	UpdateRideStatus(ctx context.Context, rideID uuid.UUID, status domain.RideStatus) error
	RateRide(ctx context.Context, rideID uuid.UUID, rating float32, isRider bool) error
	GetActiveRide(ctx context.Context, userID uuid.UUID, isRider bool) (*domain.Ride, error)
	GetRideHistory(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*domain.Ride, int64, error)
}

// DriverService defines the driver service interface
type DriverService interface {
	GetNearbyDrivers(ctx context.Context, lat, lng, radius float64, rideType domain.RideType) ([]*domain.NearbyDriver, error)
	UpdateLocation(ctx context.Context, driverID uuid.UUID, loc *domain.DriverLocation) error
	AcceptRide(ctx context.Context, rideID, driverID uuid.UUID) error
	DeclineRide(ctx context.Context, rideID, driverID uuid.UUID) error
}

// MatchingService defines the matching service interface
type MatchingService interface {
	AcceptRide(ctx context.Context, rideID, driverID uuid.UUID) error
	DeclineRide(rideID, driverID uuid.UUID) error
}

// RideHandler handles ride-related HTTP requests
type RideHandler struct {
	rideService    RideService
	driverService  DriverService
	matchingService MatchingService
	pricingEngine  *pricing.Engine
}

// NewRideHandler creates a new ride handler
func NewRideHandler(
	rideService RideService,
	driverService DriverService,
	matchingService MatchingService,
	pricingEngine *pricing.Engine,
) *RideHandler {
	return &RideHandler{
		rideService:     rideService,
		driverService:   driverService,
		matchingService: matchingService,
		pricingEngine:   pricingEngine,
	}
}

// Response helpers

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *APIError   `json:"error,omitempty"`
}

type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(APIResponse{
		Success: status >= 200 && status < 300,
		Data:    data,
	})
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(APIResponse{
		Success: false,
		Error: &APIError{
			Code:    code,
			Message: message,
		},
	})
}

// Request/Response types

type RequestRideRequest struct {
	PickupLocation  LocationInput `json:"pickup_location"`
	DropoffLocation LocationInput `json:"dropoff_location"`
	Stops           []LocationInput `json:"stops,omitempty"`
	Type            string        `json:"type"`
	PaymentMethod   string        `json:"payment_method"`
	ScheduledFor    *time.Time    `json:"scheduled_for,omitempty"`
	PromoCode       string        `json:"promo_code,omitempty"`
	Notes           string        `json:"notes,omitempty"`
}

type LocationInput struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Address   string  `json:"address,omitempty"`
	Name      string  `json:"name,omitempty"`
	PlaceID   string  `json:"place_id,omitempty"`
}

type CancelRideRequest struct {
	Reason string `json:"reason"`
}

type RateRideRequest struct {
	Rating  float32 `json:"rating"`
	Comment string  `json:"comment,omitempty"`
}

type UpdateLocationRequest struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Heading   float64 `json:"heading"`
	Speed     float64 `json:"speed"`
	Accuracy  float64 `json:"accuracy"`
}

type PriceEstimateRequest struct {
	PickupLatitude   float64 `json:"pickup_latitude"`
	PickupLongitude  float64 `json:"pickup_longitude"`
	DropoffLatitude  float64 `json:"dropoff_latitude"`
	DropoffLongitude float64 `json:"dropoff_longitude"`
	Currency         string  `json:"currency,omitempty"`
}

type PriceEstimateResponse struct {
	Estimates map[string]PriceEstimate `json:"estimates"`
	Distance  int64                    `json:"distance_meters"`
	Duration  int64                    `json:"duration_seconds"`
	Surge     float64                  `json:"surge_multiplier"`
}

type PriceEstimate struct {
	Type           string `json:"type"`
	Total          int64  `json:"total"`
	TotalFormatted string `json:"total_formatted"`
	Currency       string `json:"currency"`
	ETA            int64  `json:"eta_seconds"`
}

type NearbyDriversResponse struct {
	Drivers []NearbyDriverInfo `json:"drivers"`
}

type NearbyDriverInfo struct {
	ID           string  `json:"id"`
	FirstName    string  `json:"first_name"`
	Rating       float64 `json:"rating"`
	VehicleType  string  `json:"vehicle_type"`
	VehicleMake  string  `json:"vehicle_make"`
	VehicleModel string  `json:"vehicle_model"`
	LicensePlate string  `json:"license_plate"`
	Latitude     float64 `json:"latitude"`
	Longitude    float64 `json:"longitude"`
	Heading      float64 `json:"heading"`
	ETASeconds   int64   `json:"eta_seconds"`
	DistanceM    float64 `json:"distance_meters"`
}

// Handlers

// RequestRide handles POST /rides
func (h *RideHandler) RequestRide(w http.ResponseWriter, r *http.Request) {
	userID := getUserIDFromContext(r.Context())
	if userID == uuid.Nil {
		writeError(w, http.StatusUnauthorized, domain.ErrCodeUnauthorized, "Unauthorized")
		return
	}
	
	var req RequestRideRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, errMsgInvalidRequestBody)
		return
	}
	
	// Validate locations
	if !geo.IsValidCoordinate(req.PickupLocation.Latitude, req.PickupLocation.Longitude) {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidLocation, "Invalid pickup location")
		return
	}
	if !geo.IsValidCoordinate(req.DropoffLocation.Latitude, req.DropoffLocation.Longitude) {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidLocation, "Invalid dropoff location")
		return
	}
	
	// Check service area
	inService, _ := geo.IsInServiceArea(req.PickupLocation.Latitude, req.PickupLocation.Longitude)
	if !inService {
		writeError(w, http.StatusBadRequest, domain.ErrCodeOutOfService, "Pickup location is outside service area")
		return
	}
	
	// Convert to domain request
	rideReq := &domain.RideRequest{
		RiderID: userID,
		PickupLocation: domain.Location{
			Latitude:  req.PickupLocation.Latitude,
			Longitude: req.PickupLocation.Longitude,
			Address:   req.PickupLocation.Address,
			Name:      req.PickupLocation.Name,
			PlaceID:   req.PickupLocation.PlaceID,
			H3Cell:    geo.H3Cell(req.PickupLocation.Latitude, req.PickupLocation.Longitude, geo.H3Resolution),
		},
		DropoffLocation: domain.Location{
			Latitude:  req.DropoffLocation.Latitude,
			Longitude: req.DropoffLocation.Longitude,
			Address:   req.DropoffLocation.Address,
			Name:      req.DropoffLocation.Name,
			PlaceID:   req.DropoffLocation.PlaceID,
			H3Cell:    geo.H3Cell(req.DropoffLocation.Latitude, req.DropoffLocation.Longitude, geo.H3Resolution),
		},
		Type:          domain.RideType(req.Type),
		PaymentMethod: domain.PaymentMethod(req.PaymentMethod),
		ScheduledFor:  req.ScheduledFor,
		PromoCode:     req.PromoCode,
		Notes:         req.Notes,
	}
	
	// Convert stops
	for _, stop := range req.Stops {
		rideReq.Stops = append(rideReq.Stops, domain.Location{
			Latitude:  stop.Latitude,
			Longitude: stop.Longitude,
			Address:   stop.Address,
			Name:      stop.Name,
			PlaceID:   stop.PlaceID,
		})
	}
	
	// Create ride
	ride, err := h.rideService.RequestRide(r.Context(), rideReq)
	if err != nil {
		log.Error().Err(err).Msg("Failed to request ride")
		writeError(w, http.StatusInternalServerError, domain.ErrCodeInternal, "Failed to request ride")
		return
	}
	
	writeJSON(w, http.StatusCreated, ride)
}

// GetRide handles GET /rides/{rideId}
func (h *RideHandler) GetRide(w http.ResponseWriter, r *http.Request) {
	rideID, err := uuid.Parse(chi.URLParam(r, "rideId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, errMsgInvalidRideID)
		return
	}
	
	ride, err := h.rideService.GetRide(r.Context(), rideID)
	if err != nil {
		if err == domain.ErrRideNotFound {
			writeError(w, http.StatusNotFound, domain.ErrCodeRideNotFound, errMsgRideNotFound)
			return
		}
		writeError(w, http.StatusInternalServerError, domain.ErrCodeInternal, "Failed to get ride")
		return
	}
	
	writeJSON(w, http.StatusOK, ride)
}

// CancelRide handles POST /rides/{rideId}/cancel
func (h *RideHandler) CancelRide(w http.ResponseWriter, r *http.Request) {
	userID := getUserIDFromContext(r.Context())
	if userID == uuid.Nil {
		writeError(w, http.StatusUnauthorized, domain.ErrCodeUnauthorized, "Unauthorized")
		return
	}
	
	rideID, err := uuid.Parse(chi.URLParam(r, "rideId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, errMsgInvalidRideID)
		return
	}
	
	var req CancelRideRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Reason = "User cancelled"
	}
	
	if err := h.rideService.CancelRide(r.Context(), rideID, userID, req.Reason); err != nil {
		switch err {
		case domain.ErrRideNotFound:
			writeError(w, http.StatusNotFound, domain.ErrCodeRideNotFound, errMsgRideNotFound)
		case domain.ErrRideAlreadyEnded:
			writeError(w, http.StatusBadRequest, domain.ErrCodeRideAlreadyEnded, "Ride has already ended")
		default:
			writeError(w, http.StatusInternalServerError, domain.ErrCodeInternal, "Failed to cancel ride")
		}
		return
	}
	
	writeJSON(w, http.StatusOK, map[string]string{"message": "Ride cancelled successfully"})
}

// TrackRide handles GET /rides/{rideId}/track
func (h *RideHandler) TrackRide(w http.ResponseWriter, r *http.Request) {
	rideID, err := uuid.Parse(chi.URLParam(r, "rideId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, errMsgInvalidRideID)
		return
	}
	
	ride, err := h.rideService.GetRide(r.Context(), rideID)
	if err != nil {
		if err == domain.ErrRideNotFound {
			writeError(w, http.StatusNotFound, domain.ErrCodeRideNotFound, errMsgRideNotFound)
			return
		}
		writeError(w, http.StatusInternalServerError, domain.ErrCodeInternal, "Failed to get ride")
		return
	}
	
	// Return tracking info
	trackingInfo := map[string]interface{}{
		"ride_id":          ride.ID,
		"status":           ride.Status,
		"current_location": ride.CurrentLocation,
		"pickup_location":  ride.PickupLocation,
		"dropoff_location": ride.DropoffLocation,
		"driver_id":        ride.DriverID,
	}
	
	// Add ETA if in progress
	if ride.Status == domain.RideStatusInProgress && ride.Route != nil {
		trackingInfo["eta_seconds"] = ride.Route.DurationSeconds
	}
	
	writeJSON(w, http.StatusOK, trackingInfo)
}

// RateRide handles POST /rides/{rideId}/rate
func (h *RideHandler) RateRide(w http.ResponseWriter, r *http.Request) {
	userID := getUserIDFromContext(r.Context())
	if userID == uuid.Nil {
		writeError(w, http.StatusUnauthorized, domain.ErrCodeUnauthorized, "Unauthorized")
		return
	}
	
	rideID, err := uuid.Parse(chi.URLParam(r, "rideId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, errMsgInvalidRideID)
		return
	}
	
	var req RateRideRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, errMsgInvalidRequestBody)
		return
	}
	
	if req.Rating < 1 || req.Rating > 5 {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, "Rating must be between 1 and 5")
		return
	}
	
	// Determine if user is rider or driver
	ride, err := h.rideService.GetRide(r.Context(), rideID)
	if err != nil {
		writeError(w, http.StatusNotFound, domain.ErrCodeRideNotFound, errMsgRideNotFound)
		return
	}
	
	isRider := ride.RiderID == userID
	
	if err := h.rideService.RateRide(r.Context(), rideID, req.Rating, isRider); err != nil {
		writeError(w, http.StatusInternalServerError, domain.ErrCodeInternal, "Failed to rate ride")
		return
	}
	
	writeJSON(w, http.StatusOK, map[string]string{"message": "Rating submitted successfully"})
}

// GetPriceEstimate handles POST /pricing/estimate
func (h *RideHandler) GetPriceEstimate(w http.ResponseWriter, r *http.Request) {
	var req PriceEstimateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, errMsgInvalidRequestBody)
		return
	}
	
	// Calculate distance
	distance := geo.HaversineDistance(
		req.PickupLatitude, req.PickupLongitude,
		req.DropoffLatitude, req.DropoffLongitude,
	)
	
	// Estimate duration
	duration := geo.EstimateETA(distance, "car")
	
	// Get H3 cell for surge
	h3Cell := geo.H3Cell(req.PickupLatitude, req.PickupLongitude, geo.H3Resolution)
	
	// Default currency
	currency := domain.CurrencyNGN
	if req.Currency != "" {
		currency = domain.Currency(req.Currency)
	}
	
	// Get estimates for all ride types
	estimates, err := h.pricingEngine.GetPriceEstimate(distance, duration, currency, h3Cell)
	if err != nil {
		writeError(w, http.StatusInternalServerError, domain.ErrCodePricingFailed, "Failed to calculate price")
		return
	}
	
	// Build response
	response := PriceEstimateResponse{
		Estimates: make(map[string]PriceEstimate),
		Distance:  int64(distance),
		Duration:  duration,
		Surge:     h.pricingEngine.GetSurgeMultiplier(h3Cell),
	}
	
	for rideType, price := range estimates {
		response.Estimates[string(rideType)] = PriceEstimate{
			Type:           string(rideType),
			Total:          price.Total,
			TotalFormatted: pricing.FormatPrice(price.Total, price.Currency),
			Currency:       string(price.Currency),
			ETA:            geo.EstimateETA(distance, string(rideType)),
		}
	}
	
	writeJSON(w, http.StatusOK, response)
}

// GetSurgeMultiplier handles GET /pricing/surge
func (h *RideHandler) GetSurgeMultiplier(w http.ResponseWriter, r *http.Request) {
	latStr := r.URL.Query().Get("lat")
	lngStr := r.URL.Query().Get("lng")
	
	lat, err := strconv.ParseFloat(latStr, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, "Invalid latitude")
		return
	}
	
	lng, err := strconv.ParseFloat(lngStr, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, "Invalid longitude")
		return
	}
	
	h3Cell := geo.H3Cell(lat, lng, geo.H3Resolution)
	surge := h.pricingEngine.GetSurgeMultiplier(h3Cell)
	
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"surge_multiplier": surge,
		"h3_cell":          h3Cell,
	})
}

// UpdateDriverLocation handles PUT /drivers/location
func (h *RideHandler) UpdateDriverLocation(w http.ResponseWriter, r *http.Request) {
	driverID := getUserIDFromContext(r.Context())
	if driverID == uuid.Nil {
		writeError(w, http.StatusUnauthorized, domain.ErrCodeUnauthorized, "Unauthorized")
		return
	}
	
	var req UpdateLocationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, "Invalid request body")
		return
	}
	
	if !geo.IsValidCoordinate(req.Latitude, req.Longitude) {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidLocation, "Invalid location")
		return
	}
	
	loc := &domain.DriverLocation{
		DriverID: driverID,
		Location: domain.Location{
			Latitude:  req.Latitude,
			Longitude: req.Longitude,
			H3Cell:    geo.H3Cell(req.Latitude, req.Longitude, geo.H3Resolution),
		},
		Heading:   req.Heading,
		Speed:     req.Speed,
		Accuracy:  req.Accuracy,
		Timestamp: time.Now().UTC(),
	}
	
	if err := h.driverService.UpdateLocation(r.Context(), driverID, loc); err != nil {
		writeError(w, http.StatusInternalServerError, domain.ErrCodeInternal, "Failed to update location")
		return
	}
	
	writeJSON(w, http.StatusOK, map[string]string{"message": "Location updated"})
}

// GetNearbyDrivers handles GET /drivers/nearby
func (h *RideHandler) GetNearbyDrivers(w http.ResponseWriter, r *http.Request) {
	latStr := r.URL.Query().Get("lat")
	lngStr := r.URL.Query().Get("lng")
	radiusStr := r.URL.Query().Get("radius")
	rideTypeStr := r.URL.Query().Get("type")
	
	lat, err := strconv.ParseFloat(latStr, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, "Invalid latitude")
		return
	}
	
	lng, err := strconv.ParseFloat(lngStr, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, "Invalid longitude")
		return
	}
	
	radius := 5000.0 // Default 5km
	if radiusStr != "" {
		radius, _ = strconv.ParseFloat(radiusStr, 64)
	}
	if radius > geo.MaxSearchRadius {
		radius = geo.MaxSearchRadius
	}
	
	rideType := domain.RideTypeStandard
	if rideTypeStr != "" {
		rideType = domain.RideType(rideTypeStr)
	}
	
	drivers, err := h.driverService.GetNearbyDrivers(r.Context(), lat, lng, radius, rideType)
	if err != nil {
		writeError(w, http.StatusInternalServerError, domain.ErrCodeInternal, "Failed to get nearby drivers")
		return
	}
	
	response := NearbyDriversResponse{
		Drivers: make([]NearbyDriverInfo, 0, len(drivers)),
	}
	
	for _, d := range drivers {
		info := NearbyDriverInfo{
			ID:         d.Driver.ID.String(),
			FirstName:  d.Driver.FirstName,
			Rating:     d.Driver.Rating,
			ETASeconds: d.ETASeconds,
			DistanceM:  d.DistanceM,
			Heading:    d.Driver.Heading,
		}
		
		if d.Driver.CurrentLocation != nil {
			info.Latitude = d.Driver.CurrentLocation.Latitude
			info.Longitude = d.Driver.CurrentLocation.Longitude
		}
		
		if d.Driver.Vehicle != nil {
			info.VehicleType = string(d.Driver.Vehicle.Type)
			info.VehicleMake = d.Driver.Vehicle.Make
			info.VehicleModel = d.Driver.Vehicle.Model
			info.LicensePlate = d.Driver.Vehicle.LicensePlate
		}
		
		response.Drivers = append(response.Drivers, info)
	}
	
	writeJSON(w, http.StatusOK, response)
}

// AcceptRide handles POST /driver/rides/{rideId}/accept
func (h *RideHandler) AcceptRide(w http.ResponseWriter, r *http.Request) {
	driverID := getUserIDFromContext(r.Context())
	if driverID == uuid.Nil {
		writeError(w, http.StatusUnauthorized, domain.ErrCodeUnauthorized, "Unauthorized")
		return
	}
	
	rideID, err := uuid.Parse(chi.URLParam(r, "rideId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, errMsgInvalidRideID)
		return
	}
	
	if err := h.driverService.AcceptRide(r.Context(), rideID, driverID); err != nil {
		switch err {
		case domain.ErrRideNotFound:
			writeError(w, http.StatusNotFound, domain.ErrCodeRideNotFound, "Ride not found")
		case domain.ErrDriverNotAvailable:
			writeError(w, http.StatusBadRequest, domain.ErrCodeDriverNotAvailable, "Driver not available")
		case domain.ErrRideAlreadyAssigned:
			writeError(w, http.StatusConflict, domain.ErrCodeRideAlreadyAssigned, "Ride already assigned")
		default:
			writeError(w, http.StatusInternalServerError, domain.ErrCodeInternal, "Failed to accept ride")
		}
		return
	}
	
	// Get updated ride
	ride, _ := h.rideService.GetRide(r.Context(), rideID)
	
	writeJSON(w, http.StatusOK, ride)
}

// DeclineRide handles POST /driver/rides/{rideId}/decline
func (h *RideHandler) DeclineRide(w http.ResponseWriter, r *http.Request) {
	driverID := getUserIDFromContext(r.Context())
	if driverID == uuid.Nil {
		writeError(w, http.StatusUnauthorized, domain.ErrCodeUnauthorized, "Unauthorized")
		return
	}
	
	rideID, err := uuid.Parse(chi.URLParam(r, "rideId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, domain.ErrCodeInvalidRequest, errMsgInvalidRideID)
		return
	}
	
	if err := h.driverService.DeclineRide(r.Context(), rideID, driverID); err != nil {
		writeError(w, http.StatusInternalServerError, domain.ErrCodeInternal, "Failed to decline ride")
		return
	}
	
	writeJSON(w, http.StatusOK, map[string]string{"message": "Ride declined"})
}

// Helper to get user ID from context (set by auth middleware)
func getUserIDFromContext(ctx context.Context) uuid.UUID {
	if id, ok := ctx.Value("user_id").(uuid.UUID); ok {
		return id
	}
	if idStr, ok := ctx.Value("user_id").(string); ok {
		if id, err := uuid.Parse(idStr); err == nil {
			return id
		}
	}
	return uuid.Nil
}
