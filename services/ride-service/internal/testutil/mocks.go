package testutil

import (
	"context"
	"sync"
	"time"
)

// ========================================
// Ride Matching Mock
// ========================================

// MockRideMatcher provides a mock ride matching service
type MockRideMatcher struct {
	mu           sync.RWMutex
	drivers      map[string]*MockDriver
	matchDelay   time.Duration
	shouldFail   bool
	failureError error
}

// MockDriver represents a mock driver for matching
type MockDriver struct {
	ID        string
	Lat       float64
	Lng       float64
	Status    string
	Rating    float64
	Available bool
}

// NewMockRideMatcher creates a new mock ride matcher
func NewMockRideMatcher() *MockRideMatcher {
	return &MockRideMatcher{
		drivers:    make(map[string]*MockDriver),
		matchDelay: 0,
	}
}

// AddDriver adds a driver to the mock
func (m *MockRideMatcher) AddDriver(driver *MockDriver) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.drivers[driver.ID] = driver
}

// RemoveDriver removes a driver from the mock
func (m *MockRideMatcher) RemoveDriver(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.drivers, id)
}

// SetMatchDelay sets the simulated matching delay
func (m *MockRideMatcher) SetMatchDelay(delay time.Duration) {
	m.matchDelay = delay
}

// SetFailure configures the matcher to fail
func (m *MockRideMatcher) SetFailure(shouldFail bool, err error) {
	m.shouldFail = shouldFail
	m.failureError = err
}

// FindNearbyDrivers finds drivers within a radius
func (m *MockRideMatcher) FindNearbyDrivers(ctx context.Context, lat, lng float64, radiusKm float64) ([]*MockDriver, error) {
	if m.matchDelay > 0 {
		time.Sleep(m.matchDelay)
	}

	if m.shouldFail {
		return nil, m.failureError
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	var nearby []*MockDriver
	for _, driver := range m.drivers {
		if driver.Available && driver.Status == "online" {
			// Simple distance check (not accurate but sufficient for tests)
			latDiff := driver.Lat - lat
			lngDiff := driver.Lng - lng
			distKm := (latDiff*latDiff + lngDiff*lngDiff) * 111.0 * 111.0 // Rough approximation

			if distKm <= radiusKm*radiusKm {
				nearby = append(nearby, driver)
			}
		}
	}

	return nearby, nil
}

// MatchDriver matches a driver to a ride
func (m *MockRideMatcher) MatchDriver(ctx context.Context, rideID, pickupLat, pickupLng string) (*MockDriver, error) {
	if m.matchDelay > 0 {
		time.Sleep(m.matchDelay)
	}

	if m.shouldFail {
		return nil, m.failureError
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	// Return first available driver (simplified)
	for _, driver := range m.drivers {
		if driver.Available && driver.Status == "online" {
			return driver, nil
		}
	}

	return nil, nil
}

// ========================================
// Pricing Mock
// ========================================

// MockPricingService provides mock pricing calculations
type MockPricingService struct {
	BaseFare       int64
	PerKmRate      int64
	PerMinuteRate  int64
	SurgeMultiplier float64
	shouldFail     bool
	failureError   error
}

// NewMockPricingService creates a new mock pricing service
func NewMockPricingService() *MockPricingService {
	return &MockPricingService{
		BaseFare:        50000,  // 500 NGN base
		PerKmRate:       10000,  // 100 NGN per km
		PerMinuteRate:   2000,   // 20 NGN per minute
		SurgeMultiplier: 1.0,
	}
}

// SetSurge sets the surge multiplier
func (m *MockPricingService) SetSurge(multiplier float64) {
	m.SurgeMultiplier = multiplier
}

// SetFailure configures the service to fail
func (m *MockPricingService) SetFailure(shouldFail bool, err error) {
	m.shouldFail = shouldFail
	m.failureError = err
}

// PriceEstimate represents a price estimate
type PriceEstimate struct {
	BaseFare        int64
	DistanceFare    int64
	TimeFare        int64
	SurgeMultiplier float64
	TotalFare       int64
	Currency        string
}

// CalculateEstimate calculates a fare estimate
func (m *MockPricingService) CalculateEstimate(ctx context.Context, distanceMeters, durationSeconds int, vehicleType string) (*PriceEstimate, error) {
	if m.shouldFail {
		return nil, m.failureError
	}

	distanceKm := float64(distanceMeters) / 1000.0
	durationMin := float64(durationSeconds) / 60.0

	distanceFare := int64(distanceKm * float64(m.PerKmRate))
	timeFare := int64(durationMin * float64(m.PerMinuteRate))

	// Apply vehicle type multiplier
	vehicleMultiplier := 1.0
	switch vehicleType {
	case "premium":
		vehicleMultiplier = 1.5
	case "xl":
		vehicleMultiplier = 1.3
	}

	subtotal := float64(m.BaseFare+distanceFare+timeFare) * vehicleMultiplier
	total := int64(subtotal * m.SurgeMultiplier)

	return &PriceEstimate{
		BaseFare:        m.BaseFare,
		DistanceFare:    distanceFare,
		TimeFare:        timeFare,
		SurgeMultiplier: m.SurgeMultiplier,
		TotalFare:       total,
		Currency:        "NGN",
	}, nil
}

// ========================================
// Payment Mock
// ========================================

// MockPaymentService provides mock payment processing
type MockPaymentService struct {
	ProcessedPayments []*MockPayment
	shouldFail        bool
	failureError      error
	delayMs           int
	mu                sync.Mutex
}

// MockPayment represents a mock payment
type MockPayment struct {
	ID          string
	RideID      string
	Amount      int64
	Currency    string
	Method      string
	Status      string
	ProcessedAt time.Time
}

// NewMockPaymentService creates a new mock payment service
func NewMockPaymentService() *MockPaymentService {
	return &MockPaymentService{
		ProcessedPayments: make([]*MockPayment, 0),
	}
}

// SetDelay sets processing delay in milliseconds
func (m *MockPaymentService) SetDelay(ms int) {
	m.delayMs = ms
}

// SetFailure configures the service to fail
func (m *MockPaymentService) SetFailure(shouldFail bool, err error) {
	m.shouldFail = shouldFail
	m.failureError = err
}

// ProcessPayment processes a mock payment
func (m *MockPaymentService) ProcessPayment(ctx context.Context, rideID string, amount int64, method string) (*MockPayment, error) {
	if m.delayMs > 0 {
		time.Sleep(time.Duration(m.delayMs) * time.Millisecond)
	}

	if m.shouldFail {
		return nil, m.failureError
	}

	payment := &MockPayment{
		ID:          RandomUUID(),
		RideID:      rideID,
		Amount:      amount,
		Currency:    "NGN",
		Method:      method,
		Status:      "completed",
		ProcessedAt: time.Now(),
	}

	m.mu.Lock()
	m.ProcessedPayments = append(m.ProcessedPayments, payment)
	m.mu.Unlock()

	return payment, nil
}

// GetPayments returns all processed payments
func (m *MockPaymentService) GetPayments() []*MockPayment {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.ProcessedPayments
}

// ClearPayments clears the payment history
func (m *MockPaymentService) ClearPayments() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ProcessedPayments = m.ProcessedPayments[:0]
}

// ========================================
// Notification Mock
// ========================================

// MockNotificationService provides mock notification sending
type MockNotificationService struct {
	SentNotifications []*MockNotification
	shouldFail        bool
	failureError      error
	mu                sync.Mutex
}

// MockNotification represents a sent notification
type MockNotification struct {
	UserID    string
	Type      string
	Title     string
	Body      string
	Data      map[string]interface{}
	SentAt    time.Time
}

// NewMockNotificationService creates a new mock notification service
func NewMockNotificationService() *MockNotificationService {
	return &MockNotificationService{
		SentNotifications: make([]*MockNotification, 0),
	}
}

// SetFailure configures the service to fail
func (m *MockNotificationService) SetFailure(shouldFail bool, err error) {
	m.shouldFail = shouldFail
	m.failureError = err
}

// Send sends a mock notification
func (m *MockNotificationService) Send(ctx context.Context, userID, notifType, title, body string, data map[string]interface{}) error {
	if m.shouldFail {
		return m.failureError
	}

	notification := &MockNotification{
		UserID: userID,
		Type:   notifType,
		Title:  title,
		Body:   body,
		Data:   data,
		SentAt: time.Now(),
	}

	m.mu.Lock()
	m.SentNotifications = append(m.SentNotifications, notification)
	m.mu.Unlock()

	return nil
}

// GetNotifications returns all sent notifications
func (m *MockNotificationService) GetNotifications() []*MockNotification {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.SentNotifications
}

// GetNotificationsForUser returns notifications for a specific user
func (m *MockNotificationService) GetNotificationsForUser(userID string) []*MockNotification {
	m.mu.Lock()
	defer m.mu.Unlock()

	var userNotifs []*MockNotification
	for _, n := range m.SentNotifications {
		if n.UserID == userID {
			userNotifs = append(userNotifs, n)
		}
	}
	return userNotifs
}

// ClearNotifications clears the notification history
func (m *MockNotificationService) ClearNotifications() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.SentNotifications = m.SentNotifications[:0]
}

// ========================================
// Location Tracking Mock
// ========================================

// MockLocationTracker provides mock location tracking
type MockLocationTracker struct {
	locations map[string][]*LocationUpdate
	mu        sync.RWMutex
}

// LocationUpdate represents a location update
type LocationUpdate struct {
	EntityID  string
	Lat       float64
	Lng       float64
	Speed     float64
	Heading   float64
	Timestamp time.Time
}

// NewMockLocationTracker creates a new mock location tracker
func NewMockLocationTracker() *MockLocationTracker {
	return &MockLocationTracker{
		locations: make(map[string][]*LocationUpdate),
	}
}

// UpdateLocation records a location update
func (m *MockLocationTracker) UpdateLocation(entityID string, lat, lng, speed, heading float64) {
	update := &LocationUpdate{
		EntityID:  entityID,
		Lat:       lat,
		Lng:       lng,
		Speed:     speed,
		Heading:   heading,
		Timestamp: time.Now(),
	}

	m.mu.Lock()
	m.locations[entityID] = append(m.locations[entityID], update)
	m.mu.Unlock()
}

// GetLocations returns all location updates for an entity
func (m *MockLocationTracker) GetLocations(entityID string) []*LocationUpdate {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.locations[entityID]
}

// GetLastLocation returns the most recent location for an entity
func (m *MockLocationTracker) GetLastLocation(entityID string) *LocationUpdate {
	m.mu.RLock()
	defer m.mu.RUnlock()

	updates := m.locations[entityID]
	if len(updates) == 0 {
		return nil
	}
	return updates[len(updates)-1]
}

// Clear clears all tracked locations
func (m *MockLocationTracker) Clear() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.locations = make(map[string][]*LocationUpdate)
}
