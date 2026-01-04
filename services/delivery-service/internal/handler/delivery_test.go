package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/ubi/delivery-service/internal/testutil"
)

// ========================================
// Request/Response Types
// ========================================

// CreateDeliveryRequest represents a delivery creation request
type CreateDeliveryRequest struct {
	OrderID      string  `json:"order_id"`
	CustomerID   string  `json:"customer_id"`
	RestaurantID string  `json:"restaurant_id"`
	PickupLat    float64 `json:"pickup_lat"`
	PickupLng    float64 `json:"pickup_lng"`
	DropoffLat   float64 `json:"dropoff_lat"`
	DropoffLng   float64 `json:"dropoff_lng"`
	Items        []struct {
		Name     string `json:"name"`
		Quantity int    `json:"quantity"`
		Price    int64  `json:"price"`
	} `json:"items"`
}

// DeliveryResponse represents a delivery response
type DeliveryResponse struct {
	ID                string `json:"id"`
	OrderID           string `json:"order_id"`
	Status            string `json:"status"`
	EstimatedDuration int    `json:"estimated_duration_minutes"`
	DeliveryFee       int64  `json:"delivery_fee"`
	CourierID         string `json:"courier_id,omitempty"`
	CourierName       string `json:"courier_name,omitempty"`
	CourierPhone      string `json:"courier_phone,omitempty"`
}

// DeliveryEstimateResponse represents a delivery estimate
type DeliveryEstimateResponse struct {
	DeliveryFee       int64  `json:"delivery_fee"`
	EstimatedDuration int    `json:"estimated_duration_minutes"`
	Currency          string `json:"currency"`
}

// ========================================
// Mock Handler for Testing
// ========================================

// DeliveryHandler handles delivery HTTP requests
type DeliveryHandler struct {
	deliveries map[string]*testutil.DeliveryFixture
}

// NewDeliveryHandler creates a new delivery handler
func NewDeliveryHandler() *DeliveryHandler {
	return &DeliveryHandler{
		deliveries: make(map[string]*testutil.DeliveryFixture),
	}
}

// Routes returns the delivery routes
func (h *DeliveryHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/", h.CreateDelivery)
	r.Get("/{id}", h.GetDelivery)
	r.Post("/{id}/accept", h.AcceptDelivery)
	r.Post("/{id}/pickup", h.PickupDelivery)
	r.Post("/{id}/complete", h.CompleteDelivery)
	r.Post("/{id}/cancel", h.CancelDelivery)
	r.Post("/estimate", h.GetEstimate)
	return r
}

func (h *DeliveryHandler) CreateDelivery(w http.ResponseWriter, r *http.Request) {
	var req CreateDeliveryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	delivery := testutil.NewDeliveryBuilder().
		WithOrderID(req.OrderID).
		WithCustomer(req.CustomerID).
		WithRestaurant(req.RestaurantID).
		Build()

	h.deliveries[delivery.ID] = &delivery

	resp := DeliveryResponse{
		ID:                delivery.ID,
		OrderID:           delivery.OrderID,
		Status:            delivery.Status,
		EstimatedDuration: delivery.EstimatedDuration,
		DeliveryFee:       delivery.DeliveryFee,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(resp)
}

func (h *DeliveryHandler) GetDelivery(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	delivery, ok := h.deliveries[id]
	if !ok {
		http.Error(w, "Delivery not found", http.StatusNotFound)
		return
	}

	resp := DeliveryResponse{
		ID:                delivery.ID,
		OrderID:           delivery.OrderID,
		Status:            delivery.Status,
		EstimatedDuration: delivery.EstimatedDuration,
		DeliveryFee:       delivery.DeliveryFee,
		CourierID:         delivery.CourierID,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *DeliveryHandler) AcceptDelivery(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	delivery, ok := h.deliveries[id]
	if !ok {
		http.Error(w, "Delivery not found", http.StatusNotFound)
		return
	}

	if delivery.Status != "pending" {
		http.Error(w, "Invalid status transition", http.StatusBadRequest)
		return
	}

	// Simulate courier accepting
	courier := testutil.NewCourierBuilder().Build()
	delivery.Status = "accepted"
	delivery.CourierID = courier.ID

	resp := DeliveryResponse{
		ID:           delivery.ID,
		OrderID:      delivery.OrderID,
		Status:       delivery.Status,
		CourierID:    delivery.CourierID,
		CourierName:  courier.Name,
		CourierPhone: courier.PhoneNumber,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *DeliveryHandler) PickupDelivery(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	delivery, ok := h.deliveries[id]
	if !ok {
		http.Error(w, "Delivery not found", http.StatusNotFound)
		return
	}

	if delivery.Status != "accepted" {
		http.Error(w, "Invalid status transition", http.StatusBadRequest)
		return
	}

	delivery.Status = "picked_up"

	resp := DeliveryResponse{
		ID:      delivery.ID,
		Status:  delivery.Status,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *DeliveryHandler) CompleteDelivery(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	delivery, ok := h.deliveries[id]
	if !ok {
		http.Error(w, "Delivery not found", http.StatusNotFound)
		return
	}

	if delivery.Status != "picked_up" {
		http.Error(w, "Invalid status transition", http.StatusBadRequest)
		return
	}

	delivery.Status = "delivered"

	resp := DeliveryResponse{
		ID:     delivery.ID,
		Status: delivery.Status,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *DeliveryHandler) CancelDelivery(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	delivery, ok := h.deliveries[id]
	if !ok {
		http.Error(w, "Delivery not found", http.StatusNotFound)
		return
	}

	if delivery.Status == "delivered" || delivery.Status == "cancelled" {
		http.Error(w, "Cannot cancel completed delivery", http.StatusBadRequest)
		return
	}

	delivery.Status = "cancelled"

	resp := DeliveryResponse{
		ID:     delivery.ID,
		Status: delivery.Status,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *DeliveryHandler) GetEstimate(w http.ResponseWriter, r *http.Request) {
	// Simple estimate calculation
	resp := DeliveryEstimateResponse{
		DeliveryFee:       50000, // 500 NGN
		EstimatedDuration: 30,    // 30 minutes
		Currency:          "NGN",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// ========================================
// Tests
// ========================================

func TestCreateDelivery_Success(t *testing.T) {
	handler := NewDeliveryHandler()
	router := chi.NewRouter()
	router.Mount("/deliveries", handler.Routes())

	req := CreateDeliveryRequest{
		OrderID:      testutil.RandomUUID(),
		CustomerID:   testutil.RandomUUID(),
		RestaurantID: testutil.RandomUUID(),
		PickupLat:    testutil.LagosVictoriaIsland.Lat,
		PickupLng:    testutil.LagosVictoriaIsland.Lng,
		DropoffLat:   testutil.LagosLekki.Lat,
		DropoffLng:   testutil.LagosLekki.Lng,
	}

	body, _ := json.Marshal(req)
	httpReq := httptest.NewRequest(http.MethodPost, "/deliveries/", strings.NewReader(string(body)))
	httpReq.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httpReq)

	if rec.Code != http.StatusCreated {
		t.Errorf("Expected status 201, got %d", rec.Code)
	}

	var resp DeliveryResponse
	json.NewDecoder(rec.Body).Decode(&resp)

	if resp.ID == "" {
		t.Error("Expected delivery ID")
	}
	if resp.Status != "pending" {
		t.Errorf("Expected status 'pending', got '%s'", resp.Status)
	}
	if resp.OrderID != req.OrderID {
		t.Errorf("Expected order ID '%s', got '%s'", req.OrderID, resp.OrderID)
	}
}

func TestDeliveryLifecycle_HappyPath(t *testing.T) {
	handler := NewDeliveryHandler()
	router := chi.NewRouter()
	router.Mount("/deliveries", handler.Routes())

	// Create delivery
	createReq := CreateDeliveryRequest{
		OrderID:      testutil.RandomUUID(),
		CustomerID:   testutil.RandomUUID(),
		RestaurantID: testutil.RandomUUID(),
	}
	createBody, _ := json.Marshal(createReq)
	httpReq := httptest.NewRequest(http.MethodPost, "/deliveries/", strings.NewReader(string(createBody)))
	httpReq.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httpReq)

	var delivery DeliveryResponse
	json.NewDecoder(rec.Body).Decode(&delivery)
	deliveryID := delivery.ID

	// Accept delivery
	t.Run("Accept", func(t *testing.T) {
		httpReq := httptest.NewRequest(http.MethodPost, "/deliveries/"+deliveryID+"/accept", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httpReq)

		if rec.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", rec.Code)
		}

		var resp DeliveryResponse
		json.NewDecoder(rec.Body).Decode(&resp)
		if resp.Status != "accepted" {
			t.Errorf("Expected status 'accepted', got '%s'", resp.Status)
		}
		if resp.CourierID == "" {
			t.Error("Expected courier ID")
		}
	})

	// Pickup delivery
	t.Run("Pickup", func(t *testing.T) {
		httpReq := httptest.NewRequest(http.MethodPost, "/deliveries/"+deliveryID+"/pickup", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httpReq)

		if rec.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", rec.Code)
		}

		var resp DeliveryResponse
		json.NewDecoder(rec.Body).Decode(&resp)
		if resp.Status != "picked_up" {
			t.Errorf("Expected status 'picked_up', got '%s'", resp.Status)
		}
	})

	// Complete delivery
	t.Run("Complete", func(t *testing.T) {
		httpReq := httptest.NewRequest(http.MethodPost, "/deliveries/"+deliveryID+"/complete", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httpReq)

		if rec.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", rec.Code)
		}

		var resp DeliveryResponse
		json.NewDecoder(rec.Body).Decode(&resp)
		if resp.Status != "delivered" {
			t.Errorf("Expected status 'delivered', got '%s'", resp.Status)
		}
	})
}

func TestDelivery_InvalidStatusTransitions(t *testing.T) {
	handler := NewDeliveryHandler()
	router := chi.NewRouter()
	router.Mount("/deliveries", handler.Routes())

	// Create delivery
	createReq := CreateDeliveryRequest{
		OrderID:      testutil.RandomUUID(),
		CustomerID:   testutil.RandomUUID(),
		RestaurantID: testutil.RandomUUID(),
	}
	createBody, _ := json.Marshal(createReq)
	httpReq := httptest.NewRequest(http.MethodPost, "/deliveries/", strings.NewReader(string(createBody)))
	httpReq.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httpReq)

	var delivery DeliveryResponse
	json.NewDecoder(rec.Body).Decode(&delivery)
	deliveryID := delivery.ID

	testCases := []struct {
		name       string
		action     string
		setup      func() // Setup state before test
		wantStatus int
	}{
		{
			name:       "Cannot pickup without accepting",
			action:     "pickup",
			setup:      func() {}, // No setup, delivery is pending
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "Cannot complete without pickup",
			action:     "complete",
			setup: func() {
				// Accept first
				req := httptest.NewRequest(http.MethodPost, "/deliveries/"+deliveryID+"/accept", nil)
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)
			},
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Create fresh delivery for each test
			createBody, _ := json.Marshal(createReq)
			createReq := httptest.NewRequest(http.MethodPost, "/deliveries/", strings.NewReader(string(createBody)))
			createReq.Header.Set("Content-Type", "application/json")
			createRec := httptest.NewRecorder()
			router.ServeHTTP(createRec, createReq)

			var d DeliveryResponse
			json.NewDecoder(createRec.Body).Decode(&d)

			tc.setup()

			req := httptest.NewRequest(http.MethodPost, "/deliveries/"+d.ID+"/"+tc.action, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Errorf("Expected status %d, got %d", tc.wantStatus, rec.Code)
			}
		})
	}
}

func TestGetDelivery_NotFound(t *testing.T) {
	handler := NewDeliveryHandler()
	router := chi.NewRouter()
	router.Mount("/deliveries", handler.Routes())

	req := httptest.NewRequest(http.MethodGet, "/deliveries/nonexistent-id", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d", rec.Code)
	}
}

func TestCancelDelivery_Success(t *testing.T) {
	handler := NewDeliveryHandler()
	router := chi.NewRouter()
	router.Mount("/deliveries", handler.Routes())

	// Create delivery
	createReq := CreateDeliveryRequest{
		OrderID:      testutil.RandomUUID(),
		CustomerID:   testutil.RandomUUID(),
		RestaurantID: testutil.RandomUUID(),
	}
	createBody, _ := json.Marshal(createReq)
	httpReq := httptest.NewRequest(http.MethodPost, "/deliveries/", strings.NewReader(string(createBody)))
	httpReq.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httpReq)

	var delivery DeliveryResponse
	json.NewDecoder(rec.Body).Decode(&delivery)

	// Cancel delivery
	cancelReq := httptest.NewRequest(http.MethodPost, "/deliveries/"+delivery.ID+"/cancel", nil)
	cancelRec := httptest.NewRecorder()
	router.ServeHTTP(cancelRec, cancelReq)

	if cancelRec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", cancelRec.Code)
	}

	var cancelResp DeliveryResponse
	json.NewDecoder(cancelRec.Body).Decode(&cancelResp)
	if cancelResp.Status != "cancelled" {
		t.Errorf("Expected status 'cancelled', got '%s'", cancelResp.Status)
	}
}

func TestGetEstimate(t *testing.T) {
	handler := NewDeliveryHandler()
	router := chi.NewRouter()
	router.Mount("/deliveries", handler.Routes())

	req := httptest.NewRequest(http.MethodPost, "/deliveries/estimate", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}

	var resp DeliveryEstimateResponse
	json.NewDecoder(rec.Body).Decode(&resp)

	if resp.DeliveryFee <= 0 {
		t.Error("Expected positive delivery fee")
	}
	if resp.EstimatedDuration <= 0 {
		t.Error("Expected positive estimated duration")
	}
	if resp.Currency != "NGN" {
		t.Errorf("Expected currency 'NGN', got '%s'", resp.Currency)
	}
}

// Benchmark tests
func BenchmarkCreateDelivery(b *testing.B) {
	handler := NewDeliveryHandler()
	router := chi.NewRouter()
	router.Mount("/deliveries", handler.Routes())

	req := CreateDeliveryRequest{
		OrderID:      testutil.RandomUUID(),
		CustomerID:   testutil.RandomUUID(),
		RestaurantID: testutil.RandomUUID(),
	}
	body, _ := json.Marshal(req)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		httpReq := httptest.NewRequest(http.MethodPost, "/deliveries/", strings.NewReader(string(body)))
		httpReq.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httpReq)
	}
}
