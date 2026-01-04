/*
 * HTTP Handlers
 */

package handlers

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/config"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/database"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/middleware"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/models"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/redis"
)

// Handler holds all HTTP handlers
type Handler struct {
	db  *database.DB
	rdb *redis.Client
	cfg *config.Config
}

// New creates a new Handler
func New(db *database.DB, rdb *redis.Client, cfg *config.Config) *Handler {
	return &Handler{
		db:  db,
		rdb: rdb,
		cfg: cfg,
	}
}

// Response helpers
type response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *errorInfo  `json:"error,omitempty"`
	Meta    interface{} `json:"meta,omitempty"`
}

type errorInfo struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details,omitempty"`
}

func respond(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(response{Success: true, Data: data})
}

func respondWithMeta(w http.ResponseWriter, status int, data, meta interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(response{Success: true, Data: data, Meta: meta})
}

func respondError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(response{
		Success: false,
		Error:   &errorInfo{Code: code, Message: message},
	})
}

// ============================================
// Health Handlers
// ============================================

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	respond(w, http.StatusOK, map[string]interface{}{
		"status":    "healthy",
		"service":   "delivery-service",
		"timestamp": time.Now().UTC(),
	})
}

func (h *Handler) Liveness(w http.ResponseWriter, r *http.Request) {
	respond(w, http.StatusOK, map[string]string{"status": "alive"})
}

func (h *Handler) Readiness(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	dbErr := h.db.Health(ctx)
	redisErr := h.rdb.Health(ctx)

	status := "ready"
	statusCode := http.StatusOK

	checks := map[string]interface{}{
		"database": map[string]interface{}{
			"status": "healthy",
		},
		"redis": map[string]interface{}{
			"status": "healthy",
		},
	}

	if dbErr != nil {
		status = "not_ready"
		statusCode = http.StatusServiceUnavailable
		checks["database"] = map[string]interface{}{
			"status": "unhealthy",
			"error":  dbErr.Error(),
		}
	}

	if redisErr != nil {
		status = "not_ready"
		statusCode = http.StatusServiceUnavailable
		checks["redis"] = map[string]interface{}{
			"status": "unhealthy",
			"error":  redisErr.Error(),
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(response{
		Success: statusCode == http.StatusOK,
		Data: map[string]interface{}{
			"status":    status,
			"checks":    checks,
			"timestamp": time.Now().UTC(),
		},
	})
}

// ============================================
// Delivery Handlers
// ============================================

// CreateDeliveryRequest represents delivery creation request
type CreateDeliveryRequest struct {
	Type                 models.DeliveryType `json:"type"`
	PickupLocation       models.Location     `json:"pickupLocation"`
	DropoffLocation      models.Location     `json:"dropoffLocation"`
	PickupContact        models.ContactInfo  `json:"pickupContact"`
	DropoffContact       models.ContactInfo  `json:"dropoffContact"`
	Package              models.Package      `json:"package"`
	ScheduledPickupTime  *time.Time          `json:"scheduledPickupTime,omitempty"`
	PickupInstructions   string              `json:"pickupInstructions,omitempty"`
	DeliveryInstructions string              `json:"deliveryInstructions,omitempty"`
	Currency             models.Currency     `json:"currency"`
}

func (h *Handler) CreateDelivery(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	
	var req CreateDeliveryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid request body")
		return
	}

	// Validate
	if req.PickupLocation.Latitude == 0 || req.DropoffLocation.Latitude == 0 {
		respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Pickup and dropoff locations required")
		return
	}

	// Calculate distance
	distance := haversineDistance(
		req.PickupLocation.Latitude, req.PickupLocation.Longitude,
		req.DropoffLocation.Latitude, req.DropoffLocation.Longitude,
	)

	// Calculate fare
	fare := h.calculateFare(distance, req.Package.Size, req.Type)

	// Generate IDs
	deliveryID := "del_" + uuid.New().String()[:12]
	trackingNumber := generateTrackingNumber()

	// Marshal JSON fields
	pickupLoc, _ := json.Marshal(req.PickupLocation)
	dropoffLoc, _ := json.Marshal(req.DropoffLocation)
	pickupContact, _ := json.Marshal(req.PickupContact)
	dropoffContact, _ := json.Marshal(req.DropoffContact)
	pkg, _ := json.Marshal(req.Package)

	// Estimate time (avg 20 km/h in city)
	estimatedMinutes := int(math.Ceil((distance / 20.0) * 60))
	if estimatedMinutes < 15 {
		estimatedMinutes = 15
	}

	// Insert delivery
	query := `
		INSERT INTO deliveries (
			id, tracking_number, customer_id, type, status,
			pickup_location, dropoff_location, pickup_contact, dropoff_contact,
			package, distance_km, estimated_minutes,
			base_fare, distance_fare, time_fare, surge_fare, service_fee, insurance_fee, total_fare,
			currency, payment_status,
			scheduled_pickup_time, pickup_instructions, delivery_instructions,
			created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9,
			$10, $11, $12,
			$13, $14, $15, $16, $17, $18, $19,
			$20, $21,
			$22, $23, $24,
			NOW(), NOW()
		)
		RETURNING id, tracking_number, status, total_fare, currency, estimated_minutes, created_at
	`

	var delivery struct {
		ID               string    `json:"id"`
		TrackingNumber   string    `json:"trackingNumber"`
		Status           string    `json:"status"`
		TotalFare        float64   `json:"totalFare"`
		Currency         string    `json:"currency"`
		EstimatedMinutes int       `json:"estimatedMinutes"`
		CreatedAt        time.Time `json:"createdAt"`
	}

	err := h.db.Pool.QueryRow(r.Context(), query,
		deliveryID, trackingNumber, userID, req.Type, models.DeliveryStatusPending,
		pickupLoc, dropoffLoc, pickupContact, dropoffContact,
		pkg, distance, estimatedMinutes,
		fare.BaseFare, fare.DistanceFare, fare.TimeFare, fare.SurgeFare, fare.ServiceFee, fare.InsuranceFee, fare.Total,
		req.Currency, "PENDING",
		req.ScheduledPickupTime, req.PickupInstructions, req.DeliveryInstructions,
	).Scan(&delivery.ID, &delivery.TrackingNumber, &delivery.Status, &delivery.TotalFare, &delivery.Currency, &delivery.EstimatedMinutes, &delivery.CreatedAt)

	if err != nil {
		log.Error().Err(err).Msg("Failed to create delivery")
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to create delivery")
		return
	}

	// Publish event
	h.rdb.Publish(r.Context(), "delivery:created", map[string]interface{}{
		"deliveryId":     delivery.ID,
		"trackingNumber": delivery.TrackingNumber,
		"customerId":     userID,
		"pickup":         req.PickupLocation,
		"dropoff":        req.DropoffLocation,
	})

	respond(w, http.StatusCreated, map[string]interface{}{
		"delivery":        delivery,
		"fare":            fare,
		"pickupLocation":  req.PickupLocation,
		"dropoffLocation": req.DropoffLocation,
	})
}

func (h *Handler) GetDelivery(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	deliveryID := chi.URLParam(r, "id")

	query := `
		SELECT 
			id, tracking_number, customer_id, driver_id, type, status,
			pickup_location, dropoff_location, pickup_contact, dropoff_contact,
			package, distance_km, estimated_minutes,
			base_fare, distance_fare, time_fare, surge_fare, service_fee, insurance_fee, tip, total_fare,
			currency, payment_status, payment_method, payment_id,
			scheduled_pickup_time, confirmed_at, driver_assigned_at, picked_up_at, delivered_at, cancelled_at,
			pickup_instructions, delivery_instructions, cancellation_reason,
			proof_of_delivery, recipient_signature, delivery_photo,
			customer_rating, driver_rating,
			created_at, updated_at
		FROM deliveries
		WHERE id = $1 AND (customer_id = $2 OR driver_id = $2)
	`

	var d models.Delivery
	err := h.db.Pool.QueryRow(r.Context(), query, deliveryID, userID).Scan(
		&d.ID, &d.TrackingNumber, &d.CustomerID, &d.DriverID, &d.Type, &d.Status,
		&d.PickupLocation, &d.DropoffLocation, &d.PickupContact, &d.DropoffContact,
		&d.Package, &d.DistanceKm, &d.EstimatedMinutes,
		&d.BaseFare, &d.DistanceFare, &d.TimeFare, &d.SurgeFare, &d.ServiceFee, &d.InsuranceFee, &d.Tip, &d.TotalFare,
		&d.Currency, &d.PaymentStatus, &d.PaymentMethod, &d.PaymentID,
		&d.ScheduledPickupTime, &d.ConfirmedAt, &d.DriverAssignedAt, &d.PickedUpAt, &d.DeliveredAt, &d.CancelledAt,
		&d.PickupInstructions, &d.DeliveryInstructions, &d.CancellationReason,
		&d.ProofOfDelivery, &d.RecipientSignature, &d.DeliveryPhoto,
		&d.CustomerRating, &d.DriverRating,
		&d.CreatedAt, &d.UpdatedAt,
	)

	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", "Delivery not found")
		return
	}

	respond(w, http.StatusOK, d)
}

func (h *Handler) ListDeliveries(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	status := r.URL.Query().Get("status")

	query := `
		SELECT id, tracking_number, type, status, total_fare, currency, created_at
		FROM deliveries
		WHERE customer_id = $1
	`
	args := []interface{}{userID}

	if status != "" {
		query += " AND status = $2"
		args = append(args, status)
	}
	query += " ORDER BY created_at DESC LIMIT 50"

	rows, err := h.db.Pool.Query(r.Context(), query, args...)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to fetch deliveries")
		return
	}
	defer rows.Close()

	var deliveries []map[string]interface{}
	for rows.Next() {
		var d struct {
			ID             string
			TrackingNumber string
			Type           string
			Status         string
			TotalFare      float64
			Currency       string
			CreatedAt      time.Time
		}
		rows.Scan(&d.ID, &d.TrackingNumber, &d.Type, &d.Status, &d.TotalFare, &d.Currency, &d.CreatedAt)
		deliveries = append(deliveries, map[string]interface{}{
			"id":             d.ID,
			"trackingNumber": d.TrackingNumber,
			"type":           d.Type,
			"status":         d.Status,
			"totalFare":      d.TotalFare,
			"currency":       d.Currency,
			"createdAt":      d.CreatedAt,
		})
	}

	if deliveries == nil {
		deliveries = []map[string]interface{}{}
	}

	respond(w, http.StatusOK, deliveries)
}

func (h *Handler) GetActiveDeliveries(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	query := `
		SELECT id, tracking_number, type, status, total_fare, currency, estimated_minutes, created_at
		FROM deliveries
		WHERE customer_id = $1 AND status NOT IN ('DELIVERED', 'CANCELLED', 'FAILED')
		ORDER BY created_at DESC
	`

	rows, err := h.db.Pool.Query(r.Context(), query, userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to fetch active deliveries")
		return
	}
	defer rows.Close()

	var deliveries []map[string]interface{}
	for rows.Next() {
		var d struct {
			ID               string
			TrackingNumber   string
			Type             string
			Status           string
			TotalFare        float64
			Currency         string
			EstimatedMinutes int
			CreatedAt        time.Time
		}
		rows.Scan(&d.ID, &d.TrackingNumber, &d.Type, &d.Status, &d.TotalFare, &d.Currency, &d.EstimatedMinutes, &d.CreatedAt)
		deliveries = append(deliveries, map[string]interface{}{
			"id":               d.ID,
			"trackingNumber":   d.TrackingNumber,
			"type":             d.Type,
			"status":           d.Status,
			"totalFare":        d.TotalFare,
			"currency":         d.Currency,
			"estimatedMinutes": d.EstimatedMinutes,
			"createdAt":        d.CreatedAt,
		})
	}

	if deliveries == nil {
		deliveries = []map[string]interface{}{}
	}

	respond(w, http.StatusOK, deliveries)
}

func (h *Handler) TrackDelivery(w http.ResponseWriter, r *http.Request) {
	deliveryID := chi.URLParam(r, "id")

	// Get delivery
	query := `
		SELECT id, tracking_number, status, driver_id, pickup_location, dropoff_location,
			estimated_minutes, confirmed_at, driver_assigned_at, picked_up_at, delivered_at
		FROM deliveries WHERE id = $1
	`

	var d struct {
		ID               string
		TrackingNumber   string
		Status           string
		DriverID         *string
		PickupLocation   json.RawMessage
		DropoffLocation  json.RawMessage
		EstimatedMinutes int
		ConfirmedAt      *time.Time
		DriverAssignedAt *time.Time
		PickedUpAt       *time.Time
		DeliveredAt      *time.Time
	}

	err := h.db.Pool.QueryRow(r.Context(), query, deliveryID).Scan(
		&d.ID, &d.TrackingNumber, &d.Status, &d.DriverID,
		&d.PickupLocation, &d.DropoffLocation,
		&d.EstimatedMinutes, &d.ConfirmedAt, &d.DriverAssignedAt, &d.PickedUpAt, &d.DeliveredAt,
	)

	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", "Delivery not found")
		return
	}

	// Get driver location if assigned
	var driverLocation *models.DriverLocation
	if d.DriverID != nil && (d.Status == "DRIVER_ASSIGNED" || d.Status == "PICKED_UP" || d.Status == "IN_TRANSIT") {
		var loc models.DriverLocation
		if err := h.rdb.GetJSON(r.Context(), "driver:location:"+*d.DriverID, &loc); err == nil {
			driverLocation = &loc
		}
	}

	// Get events
	eventsQuery := `
		SELECT type, status, location, note, created_at
		FROM delivery_events
		WHERE delivery_id = $1
		ORDER BY created_at ASC
	`

	eventRows, _ := h.db.Pool.Query(r.Context(), eventsQuery, deliveryID)
	defer eventRows.Close()

	var events []map[string]interface{}
	for eventRows.Next() {
		var evt struct {
			Type      string
			Status    string
			Location  json.RawMessage
			Note      *string
			CreatedAt time.Time
		}
		eventRows.Scan(&evt.Type, &evt.Status, &evt.Location, &evt.Note, &evt.CreatedAt)
		events = append(events, map[string]interface{}{
			"type":      evt.Type,
			"status":    evt.Status,
			"location":  evt.Location,
			"note":      evt.Note,
			"createdAt": evt.CreatedAt,
		})
	}

	respond(w, http.StatusOK, map[string]interface{}{
		"delivery":       d,
		"driverLocation": driverLocation,
		"events":         events,
	})
}

func (h *Handler) CancelDelivery(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	deliveryID := chi.URLParam(r, "id")

	var req struct {
		Reason string `json:"reason"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	// Check if delivery can be cancelled
	var status string
	err := h.db.Pool.QueryRow(r.Context(),
		"SELECT status FROM deliveries WHERE id = $1 AND customer_id = $2",
		deliveryID, userID,
	).Scan(&status)

	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", "Delivery not found")
		return
	}

	if status != "PENDING" && status != "CONFIRMED" && status != "DRIVER_ASSIGNED" {
		respondError(w, http.StatusBadRequest, "CANNOT_CANCEL", "Delivery cannot be cancelled at this stage")
		return
	}

	// Update delivery
	_, err = h.db.Pool.Exec(r.Context(),
		`UPDATE deliveries SET 
			status = 'CANCELLED', 
			cancelled_at = NOW(), 
			cancellation_reason = $1,
			updated_at = NOW()
		WHERE id = $2`,
		req.Reason, deliveryID,
	)

	if err != nil {
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to cancel delivery")
		return
	}

	// Publish event
	h.rdb.Publish(r.Context(), "delivery:cancelled", map[string]interface{}{
		"deliveryId": deliveryID,
		"customerId": userID,
		"reason":     req.Reason,
	})

	respond(w, http.StatusOK, map[string]string{"message": "Delivery cancelled"})
}

func (h *Handler) AddTip(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	deliveryID := chi.URLParam(r, "id")

	var req struct {
		Amount float64 `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Amount <= 0 {
		respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Valid tip amount required")
		return
	}

	// Update tip
	result, err := h.db.Pool.Exec(r.Context(),
		`UPDATE deliveries SET 
			tip = tip + $1, 
			total_fare = total_fare + $1,
			updated_at = NOW()
		WHERE id = $2 AND customer_id = $3 AND status = 'DELIVERED'`,
		req.Amount, deliveryID, userID,
	)

	if err != nil || result.RowsAffected() == 0 {
		respondError(w, http.StatusBadRequest, "INVALID_DELIVERY", "Cannot add tip to this delivery")
		return
	}

	respond(w, http.StatusOK, map[string]string{"message": "Tip added"})
}

// ============================================
// Quote Handler
// ============================================

type QuoteRequest struct {
	PickupLocation  models.Location   `json:"pickupLocation"`
	DropoffLocation models.Location   `json:"dropoffLocation"`
	PackageSize     models.PackageSize `json:"packageSize"`
	Type            models.DeliveryType `json:"type"`
	Currency        models.Currency   `json:"currency"`
}

func (h *Handler) GetQuote(w http.ResponseWriter, r *http.Request) {
	var req QuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid request")
		return
	}

	distance := haversineDistance(
		req.PickupLocation.Latitude, req.PickupLocation.Longitude,
		req.DropoffLocation.Latitude, req.DropoffLocation.Longitude,
	)

	if req.Type == "" {
		req.Type = models.DeliveryTypeStandard
	}

	fare := h.calculateFare(distance, req.PackageSize, req.Type)
	estimatedMinutes := int(math.Ceil((distance / 20.0) * 60))
	if estimatedMinutes < 15 {
		estimatedMinutes = 15
	}

	respond(w, http.StatusOK, map[string]interface{}{
		"distanceKm":       math.Round(distance*10) / 10,
		"estimatedMinutes": estimatedMinutes,
		"fare":             fare,
		"currency":         req.Currency,
	})
}

// ============================================
// Zone Handlers
// ============================================

func (h *Handler) GetZones(w http.ResponseWriter, r *http.Request) {
	city := r.URL.Query().Get("city")

	query := `SELECT id, name, city, country, is_active, surge_multiplier FROM delivery_zones WHERE is_active = true`
	args := []interface{}{}

	if city != "" {
		query += " AND city = $1"
		args = append(args, city)
	}

	rows, err := h.db.Pool.Query(r.Context(), query, args...)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to fetch zones")
		return
	}
	defer rows.Close()

	var zones []map[string]interface{}
	for rows.Next() {
		var z struct {
			ID              string
			Name            string
			City            string
			Country         string
			IsActive        bool
			SurgeMultiplier float64
		}
		rows.Scan(&z.ID, &z.Name, &z.City, &z.Country, &z.IsActive, &z.SurgeMultiplier)
		zones = append(zones, map[string]interface{}{
			"id":              z.ID,
			"name":            z.Name,
			"city":            z.City,
			"country":         z.Country,
			"isActive":        z.IsActive,
			"surgeMultiplier": z.SurgeMultiplier,
		})
	}

	respond(w, http.StatusOK, zones)
}

func (h *Handler) CheckZone(w http.ResponseWriter, r *http.Request) {
	// Simplified zone check
	respond(w, http.StatusOK, map[string]interface{}{
		"supported":       true,
		"surgeMultiplier": 1.0,
	})
}

// ============================================
// Webhook Handlers
// ============================================

func (h *Handler) PaymentWebhook(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		DeliveryID    string `json:"deliveryId"`
		PaymentID     string `json:"paymentId"`
		PaymentStatus string `json:"status"`
		PaymentMethod string `json:"method"`
	}
	json.NewDecoder(r.Body).Decode(&payload)

	if payload.PaymentStatus == "SUCCESS" {
		h.db.Pool.Exec(r.Context(),
			`UPDATE deliveries SET 
				payment_status = 'PAID',
				payment_id = $1,
				payment_method = $2,
				status = 'CONFIRMED',
				confirmed_at = NOW(),
				updated_at = NOW()
			WHERE id = $3`,
			payload.PaymentID, payload.PaymentMethod, payload.DeliveryID,
		)

		// Publish for driver matching
		h.rdb.Publish(r.Context(), "delivery:confirmed", map[string]string{
			"deliveryId": payload.DeliveryID,
		})
	}

	respond(w, http.StatusOK, map[string]string{"status": "received"})
}

func (h *Handler) OrderWebhook(w http.ResponseWriter, r *http.Request) {
	// Handle food order delivery requests
	respond(w, http.StatusOK, map[string]string{"status": "received"})
}

// ============================================
// Helpers
// ============================================

type FareBreakdown struct {
	BaseFare     float64 `json:"baseFare"`
	DistanceFare float64 `json:"distanceFare"`
	TimeFare     float64 `json:"timeFare"`
	SurgeFare    float64 `json:"surgeFare"`
	ServiceFee   float64 `json:"serviceFee"`
	InsuranceFee float64 `json:"insuranceFee"`
	Total        float64 `json:"total"`
}

func (h *Handler) calculateFare(distanceKm float64, size models.PackageSize, deliveryType models.DeliveryType) FareBreakdown {
	// Size multipliers
	sizeMultiplier := 1.0
	switch size {
	case models.PackageSizeMedium:
		sizeMultiplier = 1.3
	case models.PackageSizeLarge:
		sizeMultiplier = 1.6
	case models.PackageSizeXLarge:
		sizeMultiplier = 2.0
	}

	// Type multipliers
	typeMultiplier := 1.0
	switch deliveryType {
	case models.DeliveryTypeExpress:
		typeMultiplier = 1.5
	case models.DeliveryTypeSameDay:
		typeMultiplier = 1.2
	}

	baseFare := h.cfg.BaseFare * sizeMultiplier * typeMultiplier
	distanceFare := distanceKm * h.cfg.PerKmRate * sizeMultiplier
	estimatedMinutes := (distanceKm / 20.0) * 60
	timeFare := estimatedMinutes * h.cfg.PerMinuteRate

	subtotal := baseFare + distanceFare + timeFare
	serviceFee := subtotal * h.cfg.ServiceFeePercent

	total := subtotal + serviceFee
	if total < h.cfg.MinimumFare {
		total = h.cfg.MinimumFare
	}

	return FareBreakdown{
		BaseFare:     math.Round(baseFare),
		DistanceFare: math.Round(distanceFare),
		TimeFare:     math.Round(timeFare),
		SurgeFare:    0,
		ServiceFee:   math.Round(serviceFee),
		InsuranceFee: 0,
		Total:        math.Round(total),
	}
}

func haversineDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371 // Earth radius in km

	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	deltaLat := (lat2 - lat1) * math.Pi / 180
	deltaLon := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*math.Sin(deltaLon/2)*math.Sin(deltaLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return R * c
}

func generateTrackingNumber() string {
	return "UBS" + uuid.New().String()[:8]
}
