/*
 * Driver Handlers
 */

package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/middleware"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/models"
)

// GetAvailableDeliveries returns deliveries available for driver pickup
func (h *Handler) GetAvailableDeliveries(w http.ResponseWriter, r *http.Request) {
	driverID := middleware.GetUserID(r.Context())

	// Get driver's location
	var driverLoc models.DriverLocation
	err := h.rdb.GetJSON(r.Context(), "driver:location:"+driverID, &driverLoc)
	if err != nil {
		respondError(w, http.StatusBadRequest, "LOCATION_REQUIRED", "Please update your location first")
		return
	}

	// Find nearby deliveries (within 10km radius)
	query := `
		SELECT 
			id, tracking_number, type, pickup_location, dropoff_location,
			package, distance_km, estimated_minutes, total_fare, currency, created_at,
			ST_Distance(
				ST_MakePoint((pickup_location->>'longitude')::float, (pickup_location->>'latitude')::float)::geography,
				ST_MakePoint($1, $2)::geography
			) / 1000 as pickup_distance_km
		FROM deliveries
		WHERE status = 'CONFIRMED'
		AND ST_DWithin(
			ST_MakePoint((pickup_location->>'longitude')::float, (pickup_location->>'latitude')::float)::geography,
			ST_MakePoint($1, $2)::geography,
			10000
		)
		ORDER BY pickup_distance_km ASC
		LIMIT 20
	`

	rows, err := h.db.Pool.Query(r.Context(), query, driverLoc.Longitude, driverLoc.Latitude)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to fetch deliveries")
		return
	}
	defer rows.Close()

	var deliveries []map[string]interface{}
	for rows.Next() {
		var d struct {
			ID               string
			TrackingNumber   string
			Type             string
			PickupLocation   json.RawMessage
			DropoffLocation  json.RawMessage
			Package          json.RawMessage
			DistanceKm       float64
			EstimatedMinutes int
			TotalFare        float64
			Currency         string
			CreatedAt        time.Time
			PickupDistanceKm float64
		}

		rows.Scan(
			&d.ID, &d.TrackingNumber, &d.Type, &d.PickupLocation, &d.DropoffLocation,
			&d.Package, &d.DistanceKm, &d.EstimatedMinutes, &d.TotalFare, &d.Currency, &d.CreatedAt,
			&d.PickupDistanceKm,
		)

		var pickup, dropoff models.Location
		json.Unmarshal(d.PickupLocation, &pickup)
		json.Unmarshal(d.DropoffLocation, &dropoff)

		var pkg models.Package
		json.Unmarshal(d.Package, &pkg)

		deliveries = append(deliveries, map[string]interface{}{
			"id":               d.ID,
			"trackingNumber":   d.TrackingNumber,
			"type":             d.Type,
			"pickupLocation":   pickup,
			"dropoffLocation":  dropoff,
			"package":          pkg,
			"distanceKm":       d.DistanceKm,
			"estimatedMinutes": d.EstimatedMinutes,
			"totalFare":        d.TotalFare,
			"currency":         d.Currency,
			"pickupDistanceKm": d.PickupDistanceKm,
			"createdAt":        d.CreatedAt,
		})
	}

	if deliveries == nil {
		deliveries = []map[string]interface{}{}
	}

	respond(w, http.StatusOK, deliveries)
}

// AcceptDelivery allows a driver to accept a delivery
func (h *Handler) AcceptDelivery(w http.ResponseWriter, r *http.Request) {
	driverID := middleware.GetUserID(r.Context())
	deliveryID := chi.URLParam(r, "id")

	// Try to acquire lock for this delivery
	lockKey := "delivery:lock:" + deliveryID
	acquired, err := h.rdb.SetNX(r.Context(), lockKey, driverID, 30*time.Second)
	if err != nil || !acquired {
		respondError(w, http.StatusConflict, "ALREADY_TAKEN", "Delivery is being processed by another driver")
		return
	}

	// Check delivery status
	var status string
	var customerID string
	err = h.db.Pool.QueryRow(r.Context(),
		"SELECT status, customer_id FROM deliveries WHERE id = $1",
		deliveryID,
	).Scan(&status, &customerID)

	if err != nil {
		h.rdb.Delete(r.Context(), lockKey)
		respondError(w, http.StatusNotFound, "NOT_FOUND", "Delivery not found")
		return
	}

	if status != "CONFIRMED" {
		h.rdb.Delete(r.Context(), lockKey)
		respondError(w, http.StatusBadRequest, "INVALID_STATUS", "Delivery cannot be accepted")
		return
	}

	// Assign driver
	_, err = h.db.Pool.Exec(r.Context(),
		`UPDATE deliveries SET 
			driver_id = $1,
			status = 'DRIVER_ASSIGNED',
			driver_assigned_at = NOW(),
			updated_at = NOW()
		WHERE id = $2`,
		driverID, deliveryID,
	)

	if err != nil {
		h.rdb.Delete(r.Context(), lockKey)
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to accept delivery")
		return
	}

	// Create event
	h.createDeliveryEvent(r.Context(), deliveryID, "driver_assigned", "DRIVER_ASSIGNED", nil, nil)

	// Publish event
	h.rdb.Publish(r.Context(), "delivery:driver_assigned", map[string]interface{}{
		"deliveryId": deliveryID,
		"driverId":   driverID,
		"customerId": customerID,
	})

	respond(w, http.StatusOK, map[string]interface{}{
		"message":    "Delivery accepted",
		"deliveryId": deliveryID,
	})
}

// ConfirmPickup confirms package pickup
func (h *Handler) ConfirmPickup(w http.ResponseWriter, r *http.Request) {
	driverID := middleware.GetUserID(r.Context())
	deliveryID := chi.URLParam(r, "id")

	var req struct {
		Photo string  `json:"photo,omitempty"`
		Note  string  `json:"note,omitempty"`
		Lat   float64 `json:"latitude"`
		Lon   float64 `json:"longitude"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	// Verify driver assignment
	var status string
	var customerID string
	err := h.db.Pool.QueryRow(r.Context(),
		"SELECT status, customer_id FROM deliveries WHERE id = $1 AND driver_id = $2",
		deliveryID, driverID,
	).Scan(&status, &customerID)

	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", "Delivery not found")
		return
	}

	if status != "DRIVER_ASSIGNED" {
		respondError(w, http.StatusBadRequest, "INVALID_STATUS", "Cannot confirm pickup at this stage")
		return
	}

	// Update status
	_, err = h.db.Pool.Exec(r.Context(),
		`UPDATE deliveries SET 
			status = 'PICKED_UP',
			picked_up_at = NOW(),
			updated_at = NOW()
		WHERE id = $1`,
		deliveryID,
	)

	if err != nil {
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to confirm pickup")
		return
	}

	// Create event
	location := map[string]float64{"latitude": req.Lat, "longitude": req.Lon}
	h.createDeliveryEvent(r.Context(), deliveryID, "picked_up", "PICKED_UP", location, &req.Note)

	// Notify customer
	h.rdb.Publish(r.Context(), "delivery:picked_up", map[string]interface{}{
		"deliveryId": deliveryID,
		"driverId":   driverID,
		"customerId": customerID,
	})

	respond(w, http.StatusOK, map[string]string{"message": "Pickup confirmed"})
}

// ConfirmDelivery confirms package delivery
func (h *Handler) ConfirmDelivery(w http.ResponseWriter, r *http.Request) {
	driverID := middleware.GetUserID(r.Context())
	deliveryID := chi.URLParam(r, "id")

	var req struct {
		Signature string  `json:"signature,omitempty"` // Base64 image
		Photo     string  `json:"photo,omitempty"`     // Delivery photo
		Note      string  `json:"note,omitempty"`
		Lat       float64 `json:"latitude"`
		Lon       float64 `json:"longitude"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	// Verify driver assignment and status
	var status, customerID string
	var requiresPOD bool
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT status, customer_id, (package->>'requiresPod')::boolean 
		FROM deliveries WHERE id = $1 AND driver_id = $2`,
		deliveryID, driverID,
	).Scan(&status, &customerID, &requiresPOD)

	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", "Delivery not found")
		return
	}

	if status != "PICKED_UP" && status != "IN_TRANSIT" {
		respondError(w, http.StatusBadRequest, "INVALID_STATUS", "Cannot confirm delivery at this stage")
		return
	}

	// Check POD requirement
	if requiresPOD && req.Signature == "" && req.Photo == "" {
		respondError(w, http.StatusBadRequest, "POD_REQUIRED", "Proof of delivery required")
		return
	}

	// Update status
	_, err = h.db.Pool.Exec(r.Context(),
		`UPDATE deliveries SET 
			status = 'DELIVERED',
			delivered_at = NOW(),
			recipient_signature = $1,
			delivery_photo = $2,
			updated_at = NOW()
		WHERE id = $3`,
		req.Signature, req.Photo, deliveryID,
	)

	if err != nil {
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to confirm delivery")
		return
	}

	// Create event
	location := map[string]float64{"latitude": req.Lat, "longitude": req.Lon}
	h.createDeliveryEvent(r.Context(), deliveryID, "delivered", "DELIVERED", location, &req.Note)

	// Notify and trigger payout
	h.rdb.Publish(r.Context(), "delivery:delivered", map[string]interface{}{
		"deliveryId": deliveryID,
		"driverId":   driverID,
		"customerId": customerID,
	})

	respond(w, http.StatusOK, map[string]string{"message": "Delivery confirmed"})
}

// UpdateDriverLocation updates driver's current location
func (h *Handler) UpdateDriverLocation(w http.ResponseWriter, r *http.Request) {
	driverID := middleware.GetUserID(r.Context())

	var req struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		Heading   float64 `json:"heading"`
		Speed     float64 `json:"speed"`
		Accuracy  float64 `json:"accuracy"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid request")
		return
	}

	location := models.DriverLocation{
		DriverID:  driverID,
		Latitude:  req.Latitude,
		Longitude: req.Longitude,
		Heading:   req.Heading,
		Speed:     req.Speed,
		Accuracy:  req.Accuracy,
		UpdatedAt: time.Now(),
	}

	// Store in Redis (expires after 5 minutes of inactivity)
	err := h.rdb.SetJSON(r.Context(), "driver:location:"+driverID, location, 5*time.Minute)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "REDIS_ERROR", "Failed to update location")
		return
	}

	// Add to geo index for spatial queries
	err = h.rdb.GeoAdd(r.Context(), "drivers:active", req.Longitude, req.Latitude, driverID)
	if err != nil {
		// Non-critical, continue
	}

	// Check if driver has active delivery and publish location update
	var activeDeliveryID string
	h.db.Pool.QueryRow(r.Context(),
		`SELECT id FROM deliveries 
		WHERE driver_id = $1 AND status IN ('DRIVER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT')
		LIMIT 1`,
		driverID,
	).Scan(&activeDeliveryID)

	if activeDeliveryID != "" {
		h.rdb.Publish(r.Context(), "delivery:location:"+activeDeliveryID, location)
	}

	respond(w, http.StatusOK, map[string]interface{}{
		"updated":  true,
		"location": location,
	})
}

// Helper: Create delivery event
func (h *Handler) createDeliveryEvent(ctx context.Context, deliveryID, eventType, status string, location interface{}, note *string) {
	eventID := "evt_" + uuid.New().String()[:12]
	locationJSON, _ := json.Marshal(location)

	h.db.Pool.Exec(ctx,
		`INSERT INTO delivery_events (id, delivery_id, type, status, location, note, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
		eventID, deliveryID, eventType, status, locationJSON, note,
	)
}

type contextKey string

const contextKeyContext contextKey = "context"

func (h *Handler) createDeliveryEvent2(r *http.Request, deliveryID, eventType, status string, location interface{}, note *string) {
	h.createDeliveryEvent(r.Context(), deliveryID, eventType, status, location, note)
}
