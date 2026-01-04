package testutil

import (
	"time"

	"github.com/google/uuid"
)

// ========================================
// Delivery Domain Fixtures
// ========================================

// CustomerFixture represents a test customer
type CustomerFixture struct {
	ID          string
	UserID      string
	Name        string
	PhoneNumber string
	Email       string
	CreatedAt   time.Time
}

// RestaurantFixture represents a test restaurant
type RestaurantFixture struct {
	ID           string
	Name         string
	Lat          float64
	Lng          float64
	Address      string
	PhoneNumber  string
	PrepTimeMin  int
	Rating       float64
	IsOpen       bool
	CreatedAt    time.Time
}

// CourierFixture represents a test courier
type CourierFixture struct {
	ID             string
	UserID         string
	Name           string
	PhoneNumber    string
	VehicleType    string
	Rating         float64
	TotalDeliveries int
	Status         string
	CurrentLat     float64
	CurrentLng     float64
	LastLocationAt time.Time
	CreatedAt      time.Time
}

// DeliveryFixture represents a test delivery
type DeliveryFixture struct {
	ID                string
	OrderID           string
	CustomerID        string
	RestaurantID      string
	CourierID         string
	Status            string
	PickupLat         float64
	PickupLng         float64
	PickupAddress     string
	DropoffLat        float64
	DropoffLng        float64
	DropoffAddress    string
	EstimatedDuration int // minutes
	ActualDuration    int // minutes
	DeliveryFee       int64
	Tip               int64
	Items             []DeliveryItemFixture
	RequestedAt       time.Time
	AcceptedAt        *time.Time
	PickedUpAt        *time.Time
	DeliveredAt       *time.Time
	CancelledAt       *time.Time
	CreatedAt         time.Time
}

// DeliveryItemFixture represents a delivery item
type DeliveryItemFixture struct {
	ID          string
	Name        string
	Quantity    int
	Price       int64
	Notes       string
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
// Default Test Locations
// ========================================

var (
	// Lagos Locations
	LagosVictoriaIsland = LocationFixture{
		Lat:     6.4281,
		Lng:     3.4219,
		Address: "Victoria Island, Lagos",
		City:    "Lagos",
		Country: "NG",
	}

	LagosIkeja = LocationFixture{
		Lat:     6.6018,
		Lng:     3.3515,
		Address: "Ikeja, Lagos",
		City:    "Lagos",
		Country: "NG",
	}

	LagosLekki = LocationFixture{
		Lat:     6.4579,
		Lng:     3.5856,
		Address: "Lekki, Lagos",
		City:    "Lagos",
		Country: "NG",
	}

	// Nairobi Locations
	NairobiCBD = LocationFixture{
		Lat:     -1.2921,
		Lng:     36.8219,
		Address: "CBD, Nairobi",
		City:    "Nairobi",
		Country: "KE",
	}

	NairobiWestlands = LocationFixture{
		Lat:     -1.2673,
		Lng:     36.8111,
		Address: "Westlands, Nairobi",
		City:    "Nairobi",
		Country: "KE",
	}
)

// ========================================
// Fixture Builders
// ========================================

// CustomerBuilder builds test customers
type CustomerBuilder struct {
	customer CustomerFixture
}

// NewCustomerBuilder creates a new CustomerBuilder with defaults
func NewCustomerBuilder() *CustomerBuilder {
	return &CustomerBuilder{
		customer: CustomerFixture{
			ID:          uuid.New().String(),
			UserID:      uuid.New().String(),
			Name:        "Test Customer",
			PhoneNumber: "+2348012345678",
			Email:       "customer@example.com",
			CreatedAt:   time.Now(),
		},
	}
}

// WithID sets the customer ID
func (b *CustomerBuilder) WithID(id string) *CustomerBuilder {
	b.customer.ID = id
	return b
}

// WithName sets the customer name
func (b *CustomerBuilder) WithName(name string) *CustomerBuilder {
	b.customer.Name = name
	return b
}

// WithPhoneNumber sets the phone number
func (b *CustomerBuilder) WithPhoneNumber(phone string) *CustomerBuilder {
	b.customer.PhoneNumber = phone
	return b
}

// Build returns the customer fixture
func (b *CustomerBuilder) Build() CustomerFixture {
	return b.customer
}

// RestaurantBuilder builds test restaurants
type RestaurantBuilder struct {
	restaurant RestaurantFixture
}

// NewRestaurantBuilder creates a new RestaurantBuilder with defaults
func NewRestaurantBuilder() *RestaurantBuilder {
	return &RestaurantBuilder{
		restaurant: RestaurantFixture{
			ID:          uuid.New().String(),
			Name:        "Test Restaurant",
			Lat:         LagosVictoriaIsland.Lat,
			Lng:         LagosVictoriaIsland.Lng,
			Address:     LagosVictoriaIsland.Address,
			PhoneNumber: "+2348012345678",
			PrepTimeMin: 20,
			Rating:      4.5,
			IsOpen:      true,
			CreatedAt:   time.Now(),
		},
	}
}

// WithID sets the restaurant ID
func (b *RestaurantBuilder) WithID(id string) *RestaurantBuilder {
	b.restaurant.ID = id
	return b
}

// WithName sets the restaurant name
func (b *RestaurantBuilder) WithName(name string) *RestaurantBuilder {
	b.restaurant.Name = name
	return b
}

// WithLocation sets the restaurant location
func (b *RestaurantBuilder) WithLocation(loc LocationFixture) *RestaurantBuilder {
	b.restaurant.Lat = loc.Lat
	b.restaurant.Lng = loc.Lng
	b.restaurant.Address = loc.Address
	return b
}

// WithPrepTime sets the preparation time
func (b *RestaurantBuilder) WithPrepTime(minutes int) *RestaurantBuilder {
	b.restaurant.PrepTimeMin = minutes
	return b
}

// WithRating sets the rating
func (b *RestaurantBuilder) WithRating(rating float64) *RestaurantBuilder {
	b.restaurant.Rating = rating
	return b
}

// Closed marks the restaurant as closed
func (b *RestaurantBuilder) Closed() *RestaurantBuilder {
	b.restaurant.IsOpen = false
	return b
}

// Build returns the restaurant fixture
func (b *RestaurantBuilder) Build() RestaurantFixture {
	return b.restaurant
}

// CourierBuilder builds test couriers
type CourierBuilder struct {
	courier CourierFixture
}

// NewCourierBuilder creates a new CourierBuilder with defaults
func NewCourierBuilder() *CourierBuilder {
	return &CourierBuilder{
		courier: CourierFixture{
			ID:              uuid.New().String(),
			UserID:          uuid.New().String(),
			Name:            "Test Courier",
			PhoneNumber:     "+2348012345678",
			VehicleType:     "motorcycle",
			Rating:          4.8,
			TotalDeliveries: 150,
			Status:          "online",
			CurrentLat:      LagosVictoriaIsland.Lat,
			CurrentLng:      LagosVictoriaIsland.Lng,
			LastLocationAt:  time.Now(),
			CreatedAt:       time.Now(),
		},
	}
}

// WithID sets the courier ID
func (b *CourierBuilder) WithID(id string) *CourierBuilder {
	b.courier.ID = id
	return b
}

// WithName sets the courier name
func (b *CourierBuilder) WithName(name string) *CourierBuilder {
	b.courier.Name = name
	return b
}

// WithVehicleType sets the vehicle type
func (b *CourierBuilder) WithVehicleType(vehicleType string) *CourierBuilder {
	b.courier.VehicleType = vehicleType
	return b
}

// WithLocation sets the courier location
func (b *CourierBuilder) WithLocation(lat, lng float64) *CourierBuilder {
	b.courier.CurrentLat = lat
	b.courier.CurrentLng = lng
	b.courier.LastLocationAt = time.Now()
	return b
}

// WithStatus sets the courier status
func (b *CourierBuilder) WithStatus(status string) *CourierBuilder {
	b.courier.Status = status
	return b
}

// WithRating sets the courier rating
func (b *CourierBuilder) WithRating(rating float64, totalDeliveries int) *CourierBuilder {
	b.courier.Rating = rating
	b.courier.TotalDeliveries = totalDeliveries
	return b
}

// Build returns the courier fixture
func (b *CourierBuilder) Build() CourierFixture {
	return b.courier
}

// DeliveryBuilder builds test deliveries
type DeliveryBuilder struct {
	delivery DeliveryFixture
}

// NewDeliveryBuilder creates a new DeliveryBuilder with defaults
func NewDeliveryBuilder() *DeliveryBuilder {
	return &DeliveryBuilder{
		delivery: DeliveryFixture{
			ID:                uuid.New().String(),
			OrderID:           uuid.New().String(),
			CustomerID:        uuid.New().String(),
			RestaurantID:      uuid.New().String(),
			Status:            "pending",
			PickupLat:         LagosVictoriaIsland.Lat,
			PickupLng:         LagosVictoriaIsland.Lng,
			PickupAddress:     LagosVictoriaIsland.Address,
			DropoffLat:        LagosLekki.Lat,
			DropoffLng:        LagosLekki.Lng,
			DropoffAddress:    LagosLekki.Address,
			EstimatedDuration: 30,
			DeliveryFee:       50000, // 500 NGN
			Items: []DeliveryItemFixture{
				{
					ID:       uuid.New().String(),
					Name:     "Jollof Rice",
					Quantity: 2,
					Price:    150000, // 1500 NGN
					Notes:    "Extra spicy",
				},
			},
			RequestedAt: time.Now(),
			CreatedAt:   time.Now(),
		},
	}
}

// WithID sets the delivery ID
func (b *DeliveryBuilder) WithID(id string) *DeliveryBuilder {
	b.delivery.ID = id
	return b
}

// WithOrderID sets the order ID
func (b *DeliveryBuilder) WithOrderID(orderID string) *DeliveryBuilder {
	b.delivery.OrderID = orderID
	return b
}

// WithCustomer sets the customer ID
func (b *DeliveryBuilder) WithCustomer(customerID string) *DeliveryBuilder {
	b.delivery.CustomerID = customerID
	return b
}

// WithRestaurant sets the restaurant ID
func (b *DeliveryBuilder) WithRestaurant(restaurantID string) *DeliveryBuilder {
	b.delivery.RestaurantID = restaurantID
	return b
}

// WithCourier sets the courier ID
func (b *DeliveryBuilder) WithCourier(courierID string) *DeliveryBuilder {
	b.delivery.CourierID = courierID
	return b
}

// WithStatus sets the delivery status
func (b *DeliveryBuilder) WithStatus(status string) *DeliveryBuilder {
	b.delivery.Status = status
	return b
}

// WithPickup sets the pickup location
func (b *DeliveryBuilder) WithPickup(loc LocationFixture) *DeliveryBuilder {
	b.delivery.PickupLat = loc.Lat
	b.delivery.PickupLng = loc.Lng
	b.delivery.PickupAddress = loc.Address
	return b
}

// WithDropoff sets the dropoff location
func (b *DeliveryBuilder) WithDropoff(loc LocationFixture) *DeliveryBuilder {
	b.delivery.DropoffLat = loc.Lat
	b.delivery.DropoffLng = loc.Lng
	b.delivery.DropoffAddress = loc.Address
	return b
}

// WithFee sets the delivery fee
func (b *DeliveryBuilder) WithFee(fee int64) *DeliveryBuilder {
	b.delivery.DeliveryFee = fee
	return b
}

// WithTip sets the tip
func (b *DeliveryBuilder) WithTip(tip int64) *DeliveryBuilder {
	b.delivery.Tip = tip
	return b
}

// WithItems sets the delivery items
func (b *DeliveryBuilder) WithItems(items []DeliveryItemFixture) *DeliveryBuilder {
	b.delivery.Items = items
	return b
}

// Accepted marks the delivery as accepted
func (b *DeliveryBuilder) Accepted(courierID string) *DeliveryBuilder {
	b.delivery.Status = "accepted"
	b.delivery.CourierID = courierID
	now := time.Now()
	b.delivery.AcceptedAt = &now
	return b
}

// PickedUp marks the delivery as picked up
func (b *DeliveryBuilder) PickedUp() *DeliveryBuilder {
	b.delivery.Status = "picked_up"
	now := time.Now()
	if b.delivery.AcceptedAt == nil {
		b.delivery.AcceptedAt = &now
	}
	b.delivery.PickedUpAt = &now
	return b
}

// Delivered marks the delivery as delivered
func (b *DeliveryBuilder) Delivered() *DeliveryBuilder {
	b.delivery.Status = "delivered"
	now := time.Now()
	if b.delivery.AcceptedAt == nil {
		b.delivery.AcceptedAt = &now
	}
	if b.delivery.PickedUpAt == nil {
		b.delivery.PickedUpAt = &now
	}
	b.delivery.DeliveredAt = &now
	b.delivery.ActualDuration = b.delivery.EstimatedDuration + 5 // Slight delay
	return b
}

// Cancelled marks the delivery as cancelled
func (b *DeliveryBuilder) Cancelled() *DeliveryBuilder {
	b.delivery.Status = "cancelled"
	now := time.Now()
	b.delivery.CancelledAt = &now
	return b
}

// Build returns the delivery fixture
func (b *DeliveryBuilder) Build() DeliveryFixture {
	return b.delivery
}

// ========================================
// Batch Generators
// ========================================

// GenerateCustomers creates multiple test customers
func GenerateCustomers(count int) []CustomerFixture {
	customers := make([]CustomerFixture, count)
	for i := 0; i < count; i++ {
		customers[i] = NewCustomerBuilder().
			WithName(RandomFirstName() + " " + RandomLastName()).
			WithPhoneNumber(GenerateNigerianPhone()).
			Build()
	}
	return customers
}

// GenerateRestaurants creates multiple test restaurants
func GenerateRestaurants(count int, location LocationFixture) []RestaurantFixture {
	restaurants := make([]RestaurantFixture, count)
	names := []string{"Mama Put", "Kilimanjaro", "The Place", "Tantalizers", "Mr. Biggs", "Sweet Sensation", "Chicken Republic", "Genesis"}

	for i := 0; i < count; i++ {
		// Spread restaurants around the location
		lat := location.Lat + (float64(i%5)-2.0)*0.01
		lng := location.Lng + (float64(i/5)-2.0)*0.01

		restaurants[i] = NewRestaurantBuilder().
			WithName(names[i%len(names)] + " " + RandomString(3)).
			WithLocation(LocationFixture{Lat: lat, Lng: lng, Address: location.Address}).
			WithPrepTime(15 + i*5).
			WithRating(4.0 + float64(i%10)/10.0).
			Build()
	}
	return restaurants
}

// GenerateCouriers creates multiple test couriers
func GenerateCouriers(count int, location LocationFixture) []CourierFixture {
	couriers := make([]CourierFixture, count)
	vehicleTypes := []string{"motorcycle", "bicycle", "car"}

	for i := 0; i < count; i++ {
		// Spread couriers around the location
		lat := location.Lat + (float64(i%10)-5.0)*0.005
		lng := location.Lng + (float64(i/10)-5.0)*0.005

		couriers[i] = NewCourierBuilder().
			WithName(RandomFirstName() + " " + RandomLastName()).
			WithVehicleType(vehicleTypes[i%len(vehicleTypes)]).
			WithLocation(lat, lng).
			WithRating(4.0+float64(i%10)/10.0, 50+i*10).
			Build()
	}
	return couriers
}

// GenerateDeliveries creates multiple test deliveries
func GenerateDeliveries(count int, customerID, restaurantID string) []DeliveryFixture {
	deliveries := make([]DeliveryFixture, count)

	for i := 0; i < count; i++ {
		builder := NewDeliveryBuilder().
			WithCustomer(customerID).
			WithRestaurant(restaurantID)

		// Mix of statuses
		switch i % 5 {
		case 0:
			builder.WithStatus("pending")
		case 1:
			builder.Accepted(uuid.New().String())
		case 2:
			builder.Accepted(uuid.New().String()).PickedUp()
		case 3:
			builder.Accepted(uuid.New().String()).Delivered()
		case 4:
			builder.Cancelled()
		}

		deliveries[i] = builder.Build()
	}
	return deliveries
}
