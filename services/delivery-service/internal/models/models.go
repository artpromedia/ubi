/*
 * Database Types and Models
 */

package models

import (
	"database/sql"
	"encoding/json"
	"time"
)

// DeliveryStatus represents the status of a delivery
type DeliveryStatus string

const (
	DeliveryStatusPending      DeliveryStatus = "PENDING"
	DeliveryStatusConfirmed    DeliveryStatus = "CONFIRMED"
	DeliveryStatusDriverAssigned DeliveryStatus = "DRIVER_ASSIGNED"
	DeliveryStatusPickedUp     DeliveryStatus = "PICKED_UP"
	DeliveryStatusInTransit    DeliveryStatus = "IN_TRANSIT"
	DeliveryStatusDelivered    DeliveryStatus = "DELIVERED"
	DeliveryStatusCancelled    DeliveryStatus = "CANCELLED"
	DeliveryStatusFailed       DeliveryStatus = "FAILED"
)

// DeliveryType represents the type of delivery
type DeliveryType string

const (
	DeliveryTypeStandard DeliveryType = "STANDARD"
	DeliveryTypeExpress  DeliveryType = "EXPRESS"
	DeliveryTypeSameDay  DeliveryType = "SAME_DAY"
	DeliveryTypeScheduled DeliveryType = "SCHEDULED"
)

// PackageSize represents package size category
type PackageSize string

const (
	PackageSizeSmall   PackageSize = "SMALL"   // Up to 5kg
	PackageSizeMedium  PackageSize = "MEDIUM"  // 5-15kg
	PackageSizeLarge   PackageSize = "LARGE"   // 15-30kg
	PackageSizeXLarge  PackageSize = "XLARGE"  // 30kg+
)

// Currency type
type Currency string

const (
	CurrencyNGN Currency = "NGN"
	CurrencyKES Currency = "KES"
	CurrencyGHS Currency = "GHS"
	CurrencyUGX Currency = "UGX"
	CurrencyTZS Currency = "TZS"
	CurrencyZAR Currency = "ZAR"
	CurrencyXOF Currency = "XOF"
)

// Location represents a geographical location
type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Address   string  `json:"address"`
	City      string  `json:"city"`
	State     string  `json:"state,omitempty"`
	Country   string  `json:"country"`
	PostalCode string `json:"postalCode,omitempty"`
	PlaceID   string  `json:"placeId,omitempty"`
}

// ContactInfo represents contact information
type ContactInfo struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
	Email string `json:"email,omitempty"`
}

// Package represents package details
type Package struct {
	Description string      `json:"description"`
	Size        PackageSize `json:"size"`
	Weight      float64     `json:"weight"` // kg
	Dimensions  *Dimensions `json:"dimensions,omitempty"`
	Value       float64     `json:"value,omitempty"` // Declared value
	Fragile     bool        `json:"fragile"`
	RequiresPOD bool        `json:"requiresPod"` // Proof of delivery
}

// Dimensions represents package dimensions
type Dimensions struct {
	Length float64 `json:"length"` // cm
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// Delivery represents a delivery record
type Delivery struct {
	ID                  string          `json:"id" db:"id"`
	TrackingNumber      string          `json:"trackingNumber" db:"tracking_number"`
	CustomerID          string          `json:"customerId" db:"customer_id"`
	DriverID            sql.NullString  `json:"driverId" db:"driver_id"`
	Type                DeliveryType    `json:"type" db:"type"`
	Status              DeliveryStatus  `json:"status" db:"status"`
	
	// Locations
	PickupLocation      json.RawMessage `json:"pickupLocation" db:"pickup_location"`
	DropoffLocation     json.RawMessage `json:"dropoffLocation" db:"dropoff_location"`
	PickupContact       json.RawMessage `json:"pickupContact" db:"pickup_contact"`
	DropoffContact      json.RawMessage `json:"dropoffContact" db:"dropoff_contact"`
	
	// Package
	Package             json.RawMessage `json:"package" db:"package"`
	
	// Pricing
	DistanceKm          float64         `json:"distanceKm" db:"distance_km"`
	EstimatedMinutes    int             `json:"estimatedMinutes" db:"estimated_minutes"`
	BaseFare            float64         `json:"baseFare" db:"base_fare"`
	DistanceFare        float64         `json:"distanceFare" db:"distance_fare"`
	TimeFare            float64         `json:"timeFare" db:"time_fare"`
	SurgeFare           float64         `json:"surgeFare" db:"surge_fare"`
	ServiceFee          float64         `json:"serviceFee" db:"service_fee"`
	InsuranceFee        float64         `json:"insuranceFee" db:"insurance_fee"`
	Tip                 float64         `json:"tip" db:"tip"`
	TotalFare           float64         `json:"totalFare" db:"total_fare"`
	Currency            Currency        `json:"currency" db:"currency"`
	
	// Payment
	PaymentStatus       string          `json:"paymentStatus" db:"payment_status"`
	PaymentMethod       sql.NullString  `json:"paymentMethod" db:"payment_method"`
	PaymentID           sql.NullString  `json:"paymentId" db:"payment_id"`
	
	// Scheduling
	ScheduledPickupTime sql.NullTime    `json:"scheduledPickupTime" db:"scheduled_pickup_time"`
	
	// Timestamps
	ConfirmedAt         sql.NullTime    `json:"confirmedAt" db:"confirmed_at"`
	DriverAssignedAt    sql.NullTime    `json:"driverAssignedAt" db:"driver_assigned_at"`
	PickedUpAt          sql.NullTime    `json:"pickedUpAt" db:"picked_up_at"`
	DeliveredAt         sql.NullTime    `json:"deliveredAt" db:"delivered_at"`
	CancelledAt         sql.NullTime    `json:"cancelledAt" db:"cancelled_at"`
	
	// Notes
	PickupInstructions  sql.NullString  `json:"pickupInstructions" db:"pickup_instructions"`
	DeliveryInstructions sql.NullString `json:"deliveryInstructions" db:"delivery_instructions"`
	CancellationReason  sql.NullString  `json:"cancellationReason" db:"cancellation_reason"`
	
	// Proof
	ProofOfDelivery     sql.NullString  `json:"proofOfDelivery" db:"proof_of_delivery"`
	RecipientSignature  sql.NullString  `json:"recipientSignature" db:"recipient_signature"`
	DeliveryPhoto       sql.NullString  `json:"deliveryPhoto" db:"delivery_photo"`
	
	// Rating
	CustomerRating      sql.NullInt32   `json:"customerRating" db:"customer_rating"`
	DriverRating        sql.NullInt32   `json:"driverRating" db:"driver_rating"`
	
	CreatedAt           time.Time       `json:"createdAt" db:"created_at"`
	UpdatedAt           time.Time       `json:"updatedAt" db:"updated_at"`
}

// DeliveryZone represents a delivery zone/area
type DeliveryZone struct {
	ID          string          `json:"id" db:"id"`
	Name        string          `json:"name" db:"name"`
	City        string          `json:"city" db:"city"`
	Country     string          `json:"country" db:"country"`
	Polygon     json.RawMessage `json:"polygon" db:"polygon"`
	IsActive    bool            `json:"isActive" db:"is_active"`
	SurgeMultiplier float64     `json:"surgeMultiplier" db:"surge_multiplier"`
	CreatedAt   time.Time       `json:"createdAt" db:"created_at"`
}

// DriverLocation represents a driver's current location
type DriverLocation struct {
	DriverID    string    `json:"driverId"`
	Latitude    float64   `json:"latitude"`
	Longitude   float64   `json:"longitude"`
	Heading     float64   `json:"heading"`
	Speed       float64   `json:"speed"`
	Accuracy    float64   `json:"accuracy"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// DeliveryEvent represents delivery tracking events
type DeliveryEvent struct {
	ID          string          `json:"id" db:"id"`
	DeliveryID  string          `json:"deliveryId" db:"delivery_id"`
	Type        string          `json:"type" db:"type"`
	Status      DeliveryStatus  `json:"status" db:"status"`
	Location    json.RawMessage `json:"location" db:"location"`
	Note        sql.NullString  `json:"note" db:"note"`
	CreatedAt   time.Time       `json:"createdAt" db:"created_at"`
}
