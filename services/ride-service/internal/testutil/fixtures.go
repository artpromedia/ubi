package testutil

import (
	"time"

	"github.com/google/uuid"
)

// UserFixture represents a test user
type UserFixture struct {
	ID          string
	PhoneNumber string
	FirstName   string
	LastName    string
	Email       string
	CreatedAt   time.Time
}

// DriverFixture represents a test driver
type DriverFixture struct {
	ID             string
	UserID         string
	LicenseNumber  string
	VehicleMake    string
	VehicleModel   string
	VehicleYear    int
	LicensePlate   string
	Rating         float64
	TotalRides     int
	Status         string
	CurrentLat     float64
	CurrentLng     float64
	LastLocationAt time.Time
	CreatedAt      time.Time
}

// RideFixture represents a test ride
type RideFixture struct {
	ID               string
	RiderID          string
	DriverID         string
	Status           string
	PickupLat        float64
	PickupLng        float64
	PickupAddress    string
	DropoffLat       float64
	DropoffLng       float64
	DropoffAddress   string
	VehicleType      string
	EstimatedFare    int64
	ActualFare       int64
	DistanceMeters   int
	DurationSeconds  int
	RequestedAt      time.Time
	AcceptedAt       *time.Time
	PickedUpAt       *time.Time
	DroppedOffAt     *time.Time
	CancelledAt      *time.Time
	CancellationNote string
	CreatedAt        time.Time
}

// LocationFixture represents a location
type LocationFixture struct {
	Lat     float64
	Lng     float64
	Address string
	City    string
	Country string
}

// ========================================
// Default Test Values
// ========================================

var (
	// DefaultNigeriaLocation is Lagos, Nigeria
	DefaultNigeriaLocation = LocationFixture{
		Lat:     6.5244,
		Lng:     3.3792,
		Address: "Victoria Island, Lagos",
		City:    "Lagos",
		Country: "NG",
	}

	// DefaultKenyaLocation is Nairobi, Kenya
	DefaultKenyaLocation = LocationFixture{
		Lat:     -1.2921,
		Lng:     36.8219,
		Address: "CBD, Nairobi",
		City:    "Nairobi",
		Country: "KE",
	}

	// DefaultSouthAfricaLocation is Cape Town, South Africa
	DefaultSouthAfricaLocation = LocationFixture{
		Lat:     -33.9249,
		Lng:     18.4241,
		Address: "V&A Waterfront, Cape Town",
		City:    "Cape Town",
		Country: "ZA",
	}
)

// ========================================
// Fixture Builders
// ========================================

// UserBuilder builds test users
type UserBuilder struct {
	user UserFixture
}

// NewUserBuilder creates a new UserBuilder with defaults
func NewUserBuilder() *UserBuilder {
	return &UserBuilder{
		user: UserFixture{
			ID:          uuid.New().String(),
			PhoneNumber: "+2348012345678",
			FirstName:   "Test",
			LastName:    "User",
			Email:       "test.user@example.com",
			CreatedAt:   time.Now(),
		},
	}
}

// WithID sets the user ID
func (b *UserBuilder) WithID(id string) *UserBuilder {
	b.user.ID = id
	return b
}

// WithPhoneNumber sets the phone number
func (b *UserBuilder) WithPhoneNumber(phone string) *UserBuilder {
	b.user.PhoneNumber = phone
	return b
}

// WithName sets the user name
func (b *UserBuilder) WithName(first, last string) *UserBuilder {
	b.user.FirstName = first
	b.user.LastName = last
	return b
}

// WithEmail sets the email
func (b *UserBuilder) WithEmail(email string) *UserBuilder {
	b.user.Email = email
	return b
}

// Build returns the user fixture
func (b *UserBuilder) Build() UserFixture {
	return b.user
}

// DriverBuilder builds test drivers
type DriverBuilder struct {
	driver DriverFixture
}

// NewDriverBuilder creates a new DriverBuilder with defaults
func NewDriverBuilder() *DriverBuilder {
	return &DriverBuilder{
		driver: DriverFixture{
			ID:             uuid.New().String(),
			UserID:         uuid.New().String(),
			LicenseNumber:  "DRV-12345",
			VehicleMake:    "Toyota",
			VehicleModel:   "Corolla",
			VehicleYear:    2020,
			LicensePlate:   "LAG-123-AB",
			Rating:         4.8,
			TotalRides:     150,
			Status:         "online",
			CurrentLat:     DefaultNigeriaLocation.Lat,
			CurrentLng:     DefaultNigeriaLocation.Lng,
			LastLocationAt: time.Now(),
			CreatedAt:      time.Now(),
		},
	}
}

// WithID sets the driver ID
func (b *DriverBuilder) WithID(id string) *DriverBuilder {
	b.driver.ID = id
	return b
}

// WithUserID sets the user ID
func (b *DriverBuilder) WithUserID(userID string) *DriverBuilder {
	b.driver.UserID = userID
	return b
}

// WithVehicle sets vehicle details
func (b *DriverBuilder) WithVehicle(make, model string, year int) *DriverBuilder {
	b.driver.VehicleMake = make
	b.driver.VehicleModel = model
	b.driver.VehicleYear = year
	return b
}

// WithLocation sets the driver location
func (b *DriverBuilder) WithLocation(lat, lng float64) *DriverBuilder {
	b.driver.CurrentLat = lat
	b.driver.CurrentLng = lng
	b.driver.LastLocationAt = time.Now()
	return b
}

// WithStatus sets the driver status
func (b *DriverBuilder) WithStatus(status string) *DriverBuilder {
	b.driver.Status = status
	return b
}

// WithRating sets the driver rating
func (b *DriverBuilder) WithRating(rating float64, totalRides int) *DriverBuilder {
	b.driver.Rating = rating
	b.driver.TotalRides = totalRides
	return b
}

// Build returns the driver fixture
func (b *DriverBuilder) Build() DriverFixture {
	return b.driver
}

// RideBuilder builds test rides
type RideBuilder struct {
	ride RideFixture
}

// NewRideBuilder creates a new RideBuilder with defaults
func NewRideBuilder() *RideBuilder {
	return &RideBuilder{
		ride: RideFixture{
			ID:               uuid.New().String(),
			RiderID:          uuid.New().String(),
			Status:           "requested",
			PickupLat:        DefaultNigeriaLocation.Lat,
			PickupLng:        DefaultNigeriaLocation.Lng,
			PickupAddress:    DefaultNigeriaLocation.Address,
			DropoffLat:       6.4281,
			DropoffLng:       3.4219,
			DropoffAddress:   "Ikeja, Lagos",
			VehicleType:      "standard",
			EstimatedFare:    250000, // 2500 NGN in kobo
			DistanceMeters:   8500,
			DurationSeconds:  1800,
			RequestedAt:      time.Now(),
			CreatedAt:        time.Now(),
		},
	}
}

// WithID sets the ride ID
func (b *RideBuilder) WithID(id string) *RideBuilder {
	b.ride.ID = id
	return b
}

// WithRider sets the rider ID
func (b *RideBuilder) WithRider(riderID string) *RideBuilder {
	b.ride.RiderID = riderID
	return b
}

// WithDriver sets the driver ID
func (b *RideBuilder) WithDriver(driverID string) *RideBuilder {
	b.ride.DriverID = driverID
	return b
}

// WithStatus sets the ride status
func (b *RideBuilder) WithStatus(status string) *RideBuilder {
	b.ride.Status = status
	return b
}

// WithPickup sets the pickup location
func (b *RideBuilder) WithPickup(lat, lng float64, address string) *RideBuilder {
	b.ride.PickupLat = lat
	b.ride.PickupLng = lng
	b.ride.PickupAddress = address
	return b
}

// WithDropoff sets the dropoff location
func (b *RideBuilder) WithDropoff(lat, lng float64, address string) *RideBuilder {
	b.ride.DropoffLat = lat
	b.ride.DropoffLng = lng
	b.ride.DropoffAddress = address
	return b
}

// WithVehicleType sets the vehicle type
func (b *RideBuilder) WithVehicleType(vehicleType string) *RideBuilder {
	b.ride.VehicleType = vehicleType
	return b
}

// WithFare sets the fare
func (b *RideBuilder) WithFare(estimated, actual int64) *RideBuilder {
	b.ride.EstimatedFare = estimated
	b.ride.ActualFare = actual
	return b
}

// WithDistance sets the distance and duration
func (b *RideBuilder) WithDistance(meters, seconds int) *RideBuilder {
	b.ride.DistanceMeters = meters
	b.ride.DurationSeconds = seconds
	return b
}

// InProgress marks the ride as in progress
func (b *RideBuilder) InProgress() *RideBuilder {
	b.ride.Status = "in_progress"
	now := time.Now()
	b.ride.AcceptedAt = &now
	b.ride.PickedUpAt = &now
	return b
}

// Completed marks the ride as completed
func (b *RideBuilder) Completed() *RideBuilder {
	b.ride.Status = "completed"
	now := time.Now()
	b.ride.AcceptedAt = &now
	b.ride.PickedUpAt = &now
	b.ride.DroppedOffAt = &now
	b.ride.ActualFare = b.ride.EstimatedFare
	return b
}

// Cancelled marks the ride as cancelled
func (b *RideBuilder) Cancelled(note string) *RideBuilder {
	b.ride.Status = "cancelled"
	now := time.Now()
	b.ride.CancelledAt = &now
	b.ride.CancellationNote = note
	return b
}

// Build returns the ride fixture
func (b *RideBuilder) Build() RideFixture {
	return b.ride
}

// ========================================
// Batch Generators
// ========================================

// GenerateUsers creates multiple test users
func GenerateUsers(count int) []UserFixture {
	users := make([]UserFixture, count)
	for i := 0; i < count; i++ {
		users[i] = NewUserBuilder().
			WithPhoneNumber(GenerateNigerianPhone()).
			WithName(RandomFirstName(), RandomLastName()).
			Build()
	}
	return users
}

// GenerateDrivers creates multiple test drivers
func GenerateDrivers(count int, location LocationFixture) []DriverFixture {
	drivers := make([]DriverFixture, count)
	for i := 0; i < count; i++ {
		// Spread drivers around the location
		lat := location.Lat + (float64(i%10)-5.0)*0.01
		lng := location.Lng + (float64(i/10)-5.0)*0.01

		drivers[i] = NewDriverBuilder().
			WithLocation(lat, lng).
			WithRating(4.0+float64(i%10)/10.0, 50+i*10).
			Build()
	}
	return drivers
}

// GenerateRides creates multiple test rides
func GenerateRides(count int, riderID string) []RideFixture {
	rides := make([]RideFixture, count)
	for i := 0; i < count; i++ {
		builder := NewRideBuilder().WithRider(riderID)

		// Mix of statuses
		switch i % 5 {
		case 0:
			builder.WithStatus("requested")
		case 1:
			builder.WithStatus("accepted")
		case 2:
			builder.InProgress()
		case 3:
			builder.Completed()
		case 4:
			builder.Cancelled("Changed plans")
		}

		rides[i] = builder.Build()
	}
	return rides
}
