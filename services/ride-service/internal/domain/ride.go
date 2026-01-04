// Package domain contains the core business entities and rules for the ride service.
package domain

import (
	"time"

	"github.com/google/uuid"
)

// RideStatus represents the current state of a ride
type RideStatus string

const (
	RideStatusPending    RideStatus = "PENDING"
	RideStatusSearching  RideStatus = "SEARCHING"
	RideStatusMatched    RideStatus = "MATCHED"
	RideStatusAccepted   RideStatus = "ACCEPTED"
	RideStatusArriving   RideStatus = "ARRIVING"
	RideStatusArrived    RideStatus = "ARRIVED"
	RideStatusInProgress RideStatus = "IN_PROGRESS"
	RideStatusCompleted  RideStatus = "COMPLETED"
	RideStatusCancelled  RideStatus = "CANCELLED"
)

// RideType represents the type of ride service
type RideType string

const (
	RideTypeStandard RideType = "STANDARD"
	RideTypePremium  RideType = "PREMIUM"
	RideTypeXL       RideType = "XL"
	RideTypeBoda     RideType = "BODA"
	RideTypeTricycle RideType = "TRICYCLE"
)

// PaymentMethod represents the payment method for a ride
type PaymentMethod string

const (
	PaymentMethodCash        PaymentMethod = "CASH"
	PaymentMethodWallet      PaymentMethod = "WALLET"
	PaymentMethodMobileMoney PaymentMethod = "MOBILE_MONEY"
	PaymentMethodCard        PaymentMethod = "CARD"
)

// Currency represents supported currencies
type Currency string

const (
	CurrencyNGN Currency = "NGN"
	CurrencyKES Currency = "KES"
	CurrencyGHS Currency = "GHS"
	CurrencyUGX Currency = "UGX"
	CurrencyTZS Currency = "TZS"
	CurrencyRWF Currency = "RWF"
	CurrencyZAR Currency = "ZAR"
	CurrencyUSD Currency = "USD"
)

// Location represents a geographic coordinate with optional metadata
type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Address   string  `json:"address,omitempty"`
	Name      string  `json:"name,omitempty"`
	PlaceID   string  `json:"place_id,omitempty"`
	H3Cell    string  `json:"h3_cell,omitempty"` // H3 grid cell for indexing
}

// RouteInfo contains route details between pickup and dropoff
type RouteInfo struct {
	DistanceMeters   int64   `json:"distance_meters"`
	DurationSeconds  int64   `json:"duration_seconds"`
	Polyline         string  `json:"polyline,omitempty"`
	TrafficDuration  int64   `json:"traffic_duration_seconds,omitempty"`
}

// PriceBreakdown contains detailed pricing information
type PriceBreakdown struct {
	BaseFare         int64   `json:"base_fare"`
	DistanceFare     int64   `json:"distance_fare"`
	TimeFare         int64   `json:"time_fare"`
	SurgeMultiplier  float64 `json:"surge_multiplier"`
	SurgeAmount      int64   `json:"surge_amount"`
	BookingFee       int64   `json:"booking_fee"`
	TollFees         int64   `json:"toll_fees"`
	PromoDiscount    int64   `json:"promo_discount"`
	Total            int64   `json:"total"`
	Currency         Currency `json:"currency"`
	DriverEarnings   int64   `json:"driver_earnings"`
	PlatformFee      int64   `json:"platform_fee"`
}

// Ride represents a ride request in the system
type Ride struct {
	ID              uuid.UUID      `json:"id"`
	RiderID         uuid.UUID      `json:"rider_id"`
	DriverID        *uuid.UUID     `json:"driver_id,omitempty"`
	VehicleID       *uuid.UUID     `json:"vehicle_id,omitempty"`
	
	// Locations
	PickupLocation  Location       `json:"pickup_location"`
	DropoffLocation Location       `json:"dropoff_location"`
	Stops           []Location     `json:"stops,omitempty"`
	CurrentLocation *Location      `json:"current_location,omitempty"`
	
	// Ride details
	Type            RideType       `json:"type"`
	Status          RideStatus     `json:"status"`
	PaymentMethod   PaymentMethod  `json:"payment_method"`
	
	// Route & Pricing
	Route           *RouteInfo     `json:"route,omitempty"`
	Price           *PriceBreakdown `json:"price,omitempty"`
	
	// Scheduling
	ScheduledFor    *time.Time     `json:"scheduled_for,omitempty"`
	
	// Timestamps
	RequestedAt     time.Time      `json:"requested_at"`
	AcceptedAt      *time.Time     `json:"accepted_at,omitempty"`
	ArrivedAt       *time.Time     `json:"arrived_at,omitempty"`
	StartedAt       *time.Time     `json:"started_at,omitempty"`
	CompletedAt     *time.Time     `json:"completed_at,omitempty"`
	CancelledAt     *time.Time     `json:"cancelled_at,omitempty"`
	
	// Cancellation
	CancellationReason string       `json:"cancellation_reason,omitempty"`
	CancelledBy        *uuid.UUID   `json:"cancelled_by,omitempty"`
	
	// Ratings
	RiderRating     *float32       `json:"rider_rating,omitempty"`
	DriverRating    *float32       `json:"driver_rating,omitempty"`
	
	// Promo code
	PromoCode       string         `json:"promo_code,omitempty"`
	
	// Metadata
	Metadata        map[string]any `json:"metadata,omitempty"`
	
	// Audit
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
}

// RideRequest represents a request to create a new ride
type RideRequest struct {
	RiderID         uuid.UUID     `json:"rider_id" validate:"required"`
	PickupLocation  Location      `json:"pickup_location" validate:"required"`
	DropoffLocation Location      `json:"dropoff_location" validate:"required"`
	Stops           []Location    `json:"stops"`
	Type            RideType      `json:"type" validate:"required"`
	PaymentMethod   PaymentMethod `json:"payment_method" validate:"required"`
	ScheduledFor    *time.Time    `json:"scheduled_for"`
	PromoCode       string        `json:"promo_code"`
	Notes           string        `json:"notes"`
}

// DriverOffer represents a driver's offer to fulfill a ride
type DriverOffer struct {
	DriverID       uuid.UUID  `json:"driver_id"`
	RideID         uuid.UUID  `json:"ride_id"`
	VehicleID      uuid.UUID  `json:"vehicle_id"`
	ETASeconds     int64      `json:"eta_seconds"`
	Distance       float64    `json:"distance_meters"`
	AcceptedAt     time.Time  `json:"accepted_at"`
	ExpiresAt      time.Time  `json:"expires_at"`
}

// CancellationPolicy defines cancellation rules
type CancellationPolicy struct {
	FreeCancellationWindowSeconds int64 `json:"free_cancellation_window_seconds"`
	CancellationFee               int64 `json:"cancellation_fee"`
	DriverNoShowThresholdSeconds  int64 `json:"driver_no_show_threshold_seconds"`
}

// NewRide creates a new ride from a request
func NewRide(req *RideRequest) *Ride {
	now := time.Now().UTC()
	return &Ride{
		ID:              uuid.New(),
		RiderID:         req.RiderID,
		PickupLocation:  req.PickupLocation,
		DropoffLocation: req.DropoffLocation,
		Stops:           req.Stops,
		Type:            req.Type,
		Status:          RideStatusPending,
		PaymentMethod:   req.PaymentMethod,
		ScheduledFor:    req.ScheduledFor,
		PromoCode:       req.PromoCode,
		RequestedAt:     now,
		CreatedAt:       now,
		UpdatedAt:       now,
		Metadata:        make(map[string]any),
	}
}

// CanTransitionTo checks if a status transition is valid
func (r *Ride) CanTransitionTo(newStatus RideStatus) bool {
	validTransitions := map[RideStatus][]RideStatus{
		RideStatusPending:    {RideStatusSearching, RideStatusCancelled},
		RideStatusSearching:  {RideStatusMatched, RideStatusCancelled},
		RideStatusMatched:    {RideStatusAccepted, RideStatusSearching, RideStatusCancelled},
		RideStatusAccepted:   {RideStatusArriving, RideStatusCancelled},
		RideStatusArriving:   {RideStatusArrived, RideStatusCancelled},
		RideStatusArrived:    {RideStatusInProgress, RideStatusCancelled},
		RideStatusInProgress: {RideStatusCompleted, RideStatusCancelled},
		RideStatusCompleted:  {},
		RideStatusCancelled:  {},
	}
	
	allowed, exists := validTransitions[r.Status]
	if !exists {
		return false
	}
	
	for _, status := range allowed {
		if status == newStatus {
			return true
		}
	}
	return false
}

// UpdateStatus updates the ride status with timestamp tracking
func (r *Ride) UpdateStatus(newStatus RideStatus) error {
	if !r.CanTransitionTo(newStatus) {
		return ErrInvalidStatusTransition
	}
	
	now := time.Now().UTC()
	r.Status = newStatus
	r.UpdatedAt = now
	
	switch newStatus {
	case RideStatusArrived:
		r.ArrivedAt = &now
	case RideStatusInProgress:
		r.StartedAt = &now
	case RideStatusCompleted:
		r.CompletedAt = &now
	case RideStatusCancelled:
		r.CancelledAt = &now
	}
	
	return nil
}

// AssignDriver assigns a driver and vehicle to the ride
func (r *Ride) AssignDriver(driverID, vehicleID uuid.UUID) error {
	if r.Status != RideStatusSearching && r.Status != RideStatusMatched {
		return ErrInvalidStatusTransition
	}
	
	now := time.Now().UTC()
	r.DriverID = &driverID
	r.VehicleID = &vehicleID
	r.Status = RideStatusAccepted
	r.AcceptedAt = &now
	r.UpdatedAt = now
	
	return nil
}

// Cancel cancels the ride with a reason
func (r *Ride) Cancel(cancelledBy uuid.UUID, reason string) error {
	if r.Status == RideStatusCompleted || r.Status == RideStatusCancelled {
		return ErrRideAlreadyEnded
	}
	
	now := time.Now().UTC()
	r.Status = RideStatusCancelled
	r.CancelledBy = &cancelledBy
	r.CancellationReason = reason
	r.CancelledAt = &now
	r.UpdatedAt = now
	
	return nil
}

// IsActive returns true if the ride is in an active state
func (r *Ride) IsActive() bool {
	return r.Status != RideStatusCompleted && r.Status != RideStatusCancelled
}

// WaitTimeSeconds returns how long the rider has been waiting
func (r *Ride) WaitTimeSeconds() int64 {
	if r.StartedAt != nil {
		return int64(r.StartedAt.Sub(r.RequestedAt).Seconds())
	}
	return int64(time.Since(r.RequestedAt).Seconds())
}
