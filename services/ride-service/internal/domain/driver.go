// Package domain contains driver-related domain entities
package domain

import (
	"time"

	"github.com/google/uuid"
)

// DriverStatus represents the operational status of a driver
type DriverStatus string

const (
	DriverStatusOffline   DriverStatus = "OFFLINE"
	DriverStatusOnline    DriverStatus = "ONLINE"
	DriverStatusBusy      DriverStatus = "BUSY"
	DriverStatusOnRide    DriverStatus = "ON_RIDE"
)

// VehicleType represents the type of vehicle
type VehicleType string

const (
	VehicleTypeCar       VehicleType = "CAR"
	VehicleTypeSUV       VehicleType = "SUV"
	VehicleTypeBike      VehicleType = "BIKE"
	VehicleTypeTricycle  VehicleType = "TRICYCLE"
	VehicleTypeVan       VehicleType = "VAN"
	VehicleTypeTruck     VehicleType = "TRUCK"
)

// Driver represents a driver in the system
type Driver struct {
	ID              uuid.UUID     `json:"id"`
	UserID          uuid.UUID     `json:"user_id"`
	Status          DriverStatus  `json:"status"`
	
	// Profile
	FirstName       string        `json:"first_name"`
	LastName        string        `json:"last_name"`
	Phone           string        `json:"phone"`
	ProfilePhoto    string        `json:"profile_photo,omitempty"`
	
	// Location
	CurrentLocation *Location     `json:"current_location,omitempty"`
	H3Cell          string        `json:"h3_cell,omitempty"`
	LastLocationAt  *time.Time    `json:"last_location_at,omitempty"`
	Heading         float64       `json:"heading,omitempty"`
	Speed           float64       `json:"speed,omitempty"`
	
	// Vehicle
	Vehicle         *Vehicle      `json:"vehicle,omitempty"`
	
	// Metrics
	Rating          float64       `json:"rating"`
	TotalRides      int64         `json:"total_rides"`
	AcceptanceRate  float64       `json:"acceptance_rate"`
	
	// Active ride
	CurrentRideID   *uuid.UUID    `json:"current_ride_id,omitempty"`
	
	// Timestamps
	OnlineSince     *time.Time    `json:"online_since,omitempty"`
	CreatedAt       time.Time     `json:"created_at"`
	UpdatedAt       time.Time     `json:"updated_at"`
}

// Vehicle represents a driver's vehicle
type Vehicle struct {
	ID              uuid.UUID   `json:"id"`
	DriverID        uuid.UUID   `json:"driver_id"`
	Type            VehicleType `json:"type"`
	Make            string      `json:"make"`
	Model           string      `json:"model"`
	Year            int         `json:"year"`
	Color           string      `json:"color"`
	LicensePlate    string      `json:"license_plate"`
	Capacity        int         `json:"capacity"`
	
	// Supported ride types
	SupportedTypes  []RideType  `json:"supported_types"`
	
	// Insurance & Documents
	InsuranceExpiry *time.Time  `json:"insurance_expiry,omitempty"`
	InspectionExpiry *time.Time `json:"inspection_expiry,omitempty"`
	
	IsActive        bool        `json:"is_active"`
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
}

// NearbyDriver represents a driver found in proximity search
type NearbyDriver struct {
	Driver        *Driver   `json:"driver"`
	DistanceM     float64   `json:"distance_meters"`
	ETASeconds    int64     `json:"eta_seconds"`
	Bearing       float64   `json:"bearing"`
}

// DriverLocation represents a location update from a driver
type DriverLocation struct {
	DriverID      uuid.UUID `json:"driver_id"`
	Location      Location  `json:"location"`
	Heading       float64   `json:"heading"`
	Speed         float64   `json:"speed"`
	Accuracy      float64   `json:"accuracy"`
	Timestamp     time.Time `json:"timestamp"`
}

// IsAvailable returns true if driver can accept new rides
func (d *Driver) IsAvailable() bool {
	return d.Status == DriverStatusOnline && d.CurrentRideID == nil
}

// IsOnline returns true if driver is online
func (d *Driver) IsOnline() bool {
	return d.Status != DriverStatusOffline
}

// CanAcceptRideType checks if driver's vehicle supports the ride type
func (d *Driver) CanAcceptRideType(rideType RideType) bool {
	if d.Vehicle == nil {
		return false
	}
	
	for _, t := range d.Vehicle.SupportedTypes {
		if t == rideType {
			return true
		}
	}
	return false
}

// SetOnline sets driver status to online
func (d *Driver) SetOnline() {
	now := time.Now().UTC()
	d.Status = DriverStatusOnline
	d.OnlineSince = &now
	d.UpdatedAt = now
}

// SetOffline sets driver status to offline
func (d *Driver) SetOffline() {
	d.Status = DriverStatusOffline
	d.OnlineSince = nil
	d.CurrentRideID = nil
	d.UpdatedAt = time.Now().UTC()
}

// AssignRide assigns a ride to the driver
func (d *Driver) AssignRide(rideID uuid.UUID) error {
	if !d.IsAvailable() {
		return ErrDriverNotAvailable
	}
	
	d.Status = DriverStatusOnRide
	d.CurrentRideID = &rideID
	d.UpdatedAt = time.Now().UTC()
	return nil
}

// CompleteRide marks the current ride as complete
func (d *Driver) CompleteRide() {
	d.Status = DriverStatusOnline
	d.CurrentRideID = nil
	d.TotalRides++
	d.UpdatedAt = time.Now().UTC()
}

// UpdateLocation updates the driver's current location
func (d *Driver) UpdateLocation(loc Location, heading, speed float64) {
	now := time.Now().UTC()
	d.CurrentLocation = &loc
	d.H3Cell = loc.H3Cell
	d.Heading = heading
	d.Speed = speed
	d.LastLocationAt = &now
	d.UpdatedAt = now
}

// GetVehicleTypes returns ride types supported by vehicle type
func GetVehicleTypes(vehicleType VehicleType) []RideType {
	switch vehicleType {
	case VehicleTypeBike:
		return []RideType{RideTypeBoda}
	case VehicleTypeTricycle:
		return []RideType{RideTypeTricycle}
	case VehicleTypeCar:
		return []RideType{RideTypeStandard, RideTypePremium}
	case VehicleTypeSUV, VehicleTypeVan:
		return []RideType{RideTypeStandard, RideTypePremium, RideTypeXL}
	default:
		return []RideType{RideTypeStandard}
	}
}
