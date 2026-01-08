package prediction

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// PredictedLocation represents a predicted destination with confidence score
type PredictedLocation struct {
	PlaceID     string    `json:"place_id"`
	Name        string    `json:"name"`
	Address     string    `json:"address"`
	Latitude    float64   `json:"latitude"`
	Longitude   float64   `json:"longitude"`
	Confidence  float64   `json:"confidence"`      // 0.0 - 1.0
	Label       string    `json:"label,omitempty"` // e.g., "Usual morning trip", "Friday evening?"
	Category    string    `json:"category"`        // home, work, frequent, popular
	LastVisited time.Time `json:"last_visited,omitempty"`
	VisitCount  int       `json:"visit_count"`
}

// TripPattern represents a user's trip pattern for ML features
type TripPattern struct {
	UserID         string    `json:"user_id"`
	PlaceID        string    `json:"place_id"`
	DayOfWeek      int       `json:"day_of_week"`       // 0-6 (Sunday-Saturday)
	HourOfDay      int       `json:"hour_of_day"`       // 0-23
	IsWeekend      bool      `json:"is_weekend"`
	PickupPlaceID  string    `json:"pickup_place_id"`
	TripCount      int       `json:"trip_count"`
	LastTripTime   time.Time `json:"last_trip_time"`
	AvgTripDuration float64  `json:"avg_trip_duration"` // minutes
}

// UserLocationHistory stores aggregated location data for predictions
type UserLocationHistory struct {
	UserID           string                   `json:"user_id"`
	HomeLocation     *PredictedLocation       `json:"home_location,omitempty"`
	WorkLocation     *PredictedLocation       `json:"work_location,omitempty"`
	FrequentPlaces   []PredictedLocation      `json:"frequent_places"`
	TripPatterns     []TripPattern            `json:"trip_patterns"`
	TotalTrips       int                      `json:"total_trips"`
	LastUpdated      time.Time                `json:"last_updated"`
	PredictionOptOut bool                     `json:"prediction_opt_out"`
}

// PopularLocation represents a popular destination for cold start
type PopularLocation struct {
	PlaceID    string  `json:"place_id"`
	Name       string  `json:"name"`
	Address    string  `json:"address"`
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
	Category   string  `json:"category"` // restaurant, shopping, transit, etc.
	Popularity float64 `json:"popularity"`
}

// PredictionConfig holds configuration for the prediction service
type PredictionConfig struct {
	// Minimum trips before personalized predictions
	MinTripsForPrediction int
	// Maximum number of predictions to return
	MaxPredictions int
	// Weight factors for prediction scoring
	TimeMatchWeight     float64
	FrequencyWeight     float64
	RecencyWeight       float64
	// Data retention period
	DataRetentionDays int
	// Popular locations cache TTL
	PopularLocationsTTL time.Duration
}

// DefaultConfig returns default prediction configuration
func DefaultConfig() PredictionConfig {
	return PredictionConfig{
		MinTripsForPrediction: 10,
		MaxPredictions:        3,
		TimeMatchWeight:       0.4,
		FrequencyWeight:       0.35,
		RecencyWeight:         0.25,
		DataRetentionDays:     90,
		PopularLocationsTTL:   24 * time.Hour,
	}
}

// Service provides ML-powered location predictions
type Service struct {
	redis           *redis.Client
	config          PredictionConfig
	popularCache    []PopularLocation
	popularCacheMu  sync.RWMutex
	popularCacheExp time.Time
}

// NewService creates a new location prediction service
func NewService(redisClient *redis.Client, config PredictionConfig) *Service {
	return &Service{
		redis:  redisClient,
		config: config,
	}
}

// GetPredictedLocations returns predicted destinations for a user
func (s *Service) GetPredictedLocations(ctx context.Context, userID string, currentLat, currentLng float64) ([]PredictedLocation, error) {
	// Get user's location history
	history, err := s.getUserHistory(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user history: %w", err)
	}

	// Check if user has opted out of predictions
	if history != nil && history.PredictionOptOut {
		return nil, nil
	}

	// Cold start: return popular locations for new users
	if history == nil || history.TotalTrips < s.config.MinTripsForPrediction {
		return s.getPopularLocations(ctx, currentLat, currentLng)
	}

	// Get current time context
	now := time.Now()
	hour := now.Hour()
	dayOfWeek := int(now.Weekday())
	isWeekend := dayOfWeek == 0 || dayOfWeek == 6

	// Score all potential destinations
	predictions := s.scorePredictions(history, hour, dayOfWeek, isWeekend, currentLat, currentLng)

	// Sort by confidence and take top N
	sort.Slice(predictions, func(i, j int) bool {
		return predictions[i].Confidence > predictions[j].Confidence
	})

	if len(predictions) > s.config.MaxPredictions {
		predictions = predictions[:s.config.MaxPredictions]
	}

	// Add contextual labels
	for i := range predictions {
		predictions[i].Label = s.generateLabel(&predictions[i], hour, dayOfWeek, isWeekend)
	}

	return predictions, nil
}

// RecordTrip records a completed trip for learning
func (s *Service) RecordTrip(ctx context.Context, userID, pickupPlaceID, dropoffPlaceID string, dropoffName, dropoffAddress string, dropoffLat, dropoffLng float64, tripDuration time.Duration) error {
	history, err := s.getUserHistory(ctx, userID)
	if err != nil && history == nil {
		history = &UserLocationHistory{
			UserID:         userID,
			FrequentPlaces: []PredictedLocation{},
			TripPatterns:   []TripPattern{},
		}
	}

	now := time.Now()
	dayOfWeek := int(now.Weekday())
	hour := now.Hour()
	isWeekend := dayOfWeek == 0 || dayOfWeek == 6

	// Update or add place to frequent places
	found := false
	for i := range history.FrequentPlaces {
		if history.FrequentPlaces[i].PlaceID == dropoffPlaceID {
			history.FrequentPlaces[i].VisitCount++
			history.FrequentPlaces[i].LastVisited = now
			found = true
			break
		}
	}

	if !found {
		history.FrequentPlaces = append(history.FrequentPlaces, PredictedLocation{
			PlaceID:     dropoffPlaceID,
			Name:        dropoffName,
			Address:     dropoffAddress,
			Latitude:    dropoffLat,
			Longitude:   dropoffLng,
			Category:    "frequent",
			LastVisited: now,
			VisitCount:  1,
		})
	}

	// Update or add trip pattern
	patternFound := false
	for i := range history.TripPatterns {
		p := &history.TripPatterns[i]
		if p.PlaceID == dropoffPlaceID && p.DayOfWeek == dayOfWeek && abs(p.HourOfDay-hour) <= 2 {
			p.TripCount++
			p.LastTripTime = now
			p.AvgTripDuration = (p.AvgTripDuration*float64(p.TripCount-1) + tripDuration.Minutes()) / float64(p.TripCount)
			patternFound = true
			break
		}
	}

	if !patternFound {
		history.TripPatterns = append(history.TripPatterns, TripPattern{
			UserID:          userID,
			PlaceID:         dropoffPlaceID,
			DayOfWeek:       dayOfWeek,
			HourOfDay:       hour,
			IsWeekend:       isWeekend,
			PickupPlaceID:   pickupPlaceID,
			TripCount:       1,
			LastTripTime:    now,
			AvgTripDuration: tripDuration.Minutes(),
		})
	}

	// Detect home/work based on patterns
	s.detectHomeWork(history)

	history.TotalTrips++
	history.LastUpdated = now

	// Save updated history
	return s.saveUserHistory(ctx, history)
}

// SetPredictionOptOut allows users to opt out of predictions
func (s *Service) SetPredictionOptOut(ctx context.Context, userID string, optOut bool) error {
	history, err := s.getUserHistory(ctx, userID)
	if err != nil {
		history = &UserLocationHistory{UserID: userID}
	}

	history.PredictionOptOut = optOut
	history.LastUpdated = time.Now()

	return s.saveUserHistory(ctx, history)
}

// DeleteUserData removes all prediction data for a user (GDPR compliance)
func (s *Service) DeleteUserData(ctx context.Context, userID string) error {
	key := fmt.Sprintf("prediction:user:%s", userID)
	return s.redis.Del(ctx, key).Err()
}

// Internal methods

func (s *Service) getUserHistory(ctx context.Context, userID string) (*UserLocationHistory, error) {
	key := fmt.Sprintf("prediction:user:%s", userID)
	data, err := s.redis.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var history UserLocationHistory
	if err := json.Unmarshal(data, &history); err != nil {
		return nil, err
	}

	return &history, nil
}

func (s *Service) saveUserHistory(ctx context.Context, history *UserLocationHistory) error {
	key := fmt.Sprintf("prediction:user:%s", history.UserID)
	data, err := json.Marshal(history)
	if err != nil {
		return err
	}

	ttl := time.Duration(s.config.DataRetentionDays) * 24 * time.Hour
	return s.redis.Set(ctx, key, data, ttl).Err()
}

func (s *Service) scorePredictions(history *UserLocationHistory, hour, dayOfWeek int, isWeekend bool, currentLat, currentLng float64) []PredictedLocation {
	placeScores := make(map[string]*PredictedLocation)

	// Score based on trip patterns
	for _, pattern := range history.TripPatterns {
		score := 0.0

		// Time match scoring
		hourDiff := abs(pattern.HourOfDay - hour)
		if hourDiff <= 1 {
			score += s.config.TimeMatchWeight * 1.0
		} else if hourDiff <= 2 {
			score += s.config.TimeMatchWeight * 0.7
		} else if hourDiff <= 3 {
			score += s.config.TimeMatchWeight * 0.3
		}

		// Day match scoring
		if pattern.DayOfWeek == dayOfWeek {
			score += s.config.TimeMatchWeight * 0.5
		} else if pattern.IsWeekend == isWeekend {
			score += s.config.TimeMatchWeight * 0.2
		}

		// Frequency scoring
		freqScore := math.Min(float64(pattern.TripCount)/20.0, 1.0)
		score += s.config.FrequencyWeight * freqScore

		// Recency scoring
		daysSinceLast := time.Since(pattern.LastTripTime).Hours() / 24
		recencyScore := math.Max(0, 1.0-daysSinceLast/30.0)
		score += s.config.RecencyWeight * recencyScore

		// Update place score
		if existing, ok := placeScores[pattern.PlaceID]; ok {
			if score > existing.Confidence {
				existing.Confidence = score
			}
		} else {
			// Find place details from frequent places
			for _, place := range history.FrequentPlaces {
				if place.PlaceID == pattern.PlaceID {
					placeCopy := place
					placeCopy.Confidence = score
					placeScores[pattern.PlaceID] = &placeCopy
					break
				}
			}
		}
	}

	// Boost home/work if appropriate
	if history.HomeLocation != nil {
		if (hour >= 17 && hour <= 22) || isWeekend {
			if p, ok := placeScores[history.HomeLocation.PlaceID]; ok {
				p.Confidence *= 1.3
				p.Category = "home"
			}
		}
	}

	if history.WorkLocation != nil {
		if hour >= 7 && hour <= 10 && !isWeekend {
			if p, ok := placeScores[history.WorkLocation.PlaceID]; ok {
				p.Confidence *= 1.3
				p.Category = "work"
			}
		}
	}

	// Convert to slice
	predictions := make([]PredictedLocation, 0, len(placeScores))
	for _, p := range placeScores {
		// Normalize confidence to 0-1
		p.Confidence = math.Min(p.Confidence, 1.0)
		predictions = append(predictions, *p)
	}

	return predictions
}

func (s *Service) generateLabel(p *PredictedLocation, hour, dayOfWeek int, isWeekend bool) string {
	switch p.Category {
	case "home":
		if hour >= 17 {
			return "Heading home?"
		}
		return "Home"
	case "work":
		if hour >= 7 && hour <= 10 {
			return "Usual morning trip"
		}
		return "Work"
	default:
		if isWeekend {
			dayName := time.Weekday(dayOfWeek).String()
			return fmt.Sprintf("%s outing?", dayName)
		}
		if p.VisitCount >= 5 {
			return "Frequent destination"
		}
		return ""
	}
}

func (s *Service) detectHomeWork(history *UserLocationHistory) {
	if len(history.TripPatterns) < 10 {
		return
	}

	// Group patterns by place
	placePatterns := make(map[string][]TripPattern)
	for _, p := range history.TripPatterns {
		placePatterns[p.PlaceID] = append(placePatterns[p.PlaceID], p)
	}

	// Find home: most trips ending 6PM-11PM or weekends
	var homeCandidate string
	homeScore := 0

	// Find work: most trips 7AM-10AM on weekdays
	var workCandidate string
	workScore := 0

	for placeID, patterns := range placePatterns {
		homeCount := 0
		workCount := 0

		for _, p := range patterns {
			if (p.HourOfDay >= 18 && p.HourOfDay <= 23) || p.IsWeekend {
				homeCount += p.TripCount
			}
			if p.HourOfDay >= 7 && p.HourOfDay <= 10 && !p.IsWeekend {
				workCount += p.TripCount
			}
		}

		if homeCount > homeScore {
			homeScore = homeCount
			homeCandidate = placeID
		}
		if workCount > workScore {
			workScore = workCount
			workCandidate = placeID
		}
	}

	// Update history with detected locations
	for i := range history.FrequentPlaces {
		if history.FrequentPlaces[i].PlaceID == homeCandidate && homeScore >= 5 {
			loc := history.FrequentPlaces[i]
			loc.Category = "home"
			history.HomeLocation = &loc
		}
		if history.FrequentPlaces[i].PlaceID == workCandidate && workScore >= 5 {
			loc := history.FrequentPlaces[i]
			loc.Category = "work"
			history.WorkLocation = &loc
		}
	}
}

func (s *Service) getPopularLocations(ctx context.Context, lat, lng float64) ([]PredictedLocation, error) {
	s.popularCacheMu.RLock()
	if time.Now().Before(s.popularCacheExp) && len(s.popularCache) > 0 {
		defer s.popularCacheMu.RUnlock()
		return s.convertPopularToPredicted(s.popularCache, lat, lng), nil
	}
	s.popularCacheMu.RUnlock()

	// Fetch from Redis
	data, err := s.redis.Get(ctx, "prediction:popular_locations").Bytes()
	if err != nil && err != redis.Nil {
		return nil, err
	}

	var popular []PopularLocation
	if data != nil {
		if err := json.Unmarshal(data, &popular); err != nil {
			return nil, err
		}
	}

	// Cache the results
	s.popularCacheMu.Lock()
	s.popularCache = popular
	s.popularCacheExp = time.Now().Add(s.config.PopularLocationsTTL)
	s.popularCacheMu.Unlock()

	return s.convertPopularToPredicted(popular, lat, lng), nil
}

func (s *Service) convertPopularToPredicted(popular []PopularLocation, lat, lng float64) []PredictedLocation {
	predictions := make([]PredictedLocation, 0, len(popular))
	for _, p := range popular {
		// Calculate distance-based confidence (closer = higher confidence)
		dist := haversine(lat, lng, p.Latitude, p.Longitude)
		confidence := math.Max(0.3, 1.0-dist/20.0) // Within 20km

		predictions = append(predictions, PredictedLocation{
			PlaceID:    p.PlaceID,
			Name:       p.Name,
			Address:    p.Address,
			Latitude:   p.Latitude,
			Longitude:  p.Longitude,
			Confidence: confidence * p.Popularity,
			Category:   "popular",
			Label:      fmt.Sprintf("Popular %s", p.Category),
		})
	}

	// Sort by confidence
	sort.Slice(predictions, func(i, j int) bool {
		return predictions[i].Confidence > predictions[j].Confidence
	})

	if len(predictions) > 3 {
		predictions = predictions[:3]
	}

	return predictions
}

// Utility functions

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371 // Earth radius in km
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Sin(dLon/2)*math.Sin(dLon/2)*math.Cos(lat1Rad)*math.Cos(lat2Rad)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return R * c
}
