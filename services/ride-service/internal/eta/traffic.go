package eta

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/uber/h3-go/v4"
)

// =============================================================================
// H3-BASED TRAFFIC SERVICE
// =============================================================================

// H3TrafficService provides real-time traffic data using H3 hexagonal cells
type H3TrafficService struct {
	redis *redis.Client
	ctx   context.Context
}

// NewH3TrafficService creates a new H3-based traffic service
func NewH3TrafficService(redisClient *redis.Client) *H3TrafficService {
	return &H3TrafficService{
		redis: redisClient,
		ctx:   context.Background(),
	}
}

// TrafficCellData represents traffic data for an H3 cell
type TrafficCellData struct {
	CellID       string    `json:"cell_id"`
	SpeedKmh     float64   `json:"speed_kmh"`      // Average speed in the cell
	BaseSpeedKmh float64   `json:"base_speed_kmh"` // Free-flow speed
	Density      float64   `json:"density"`        // Vehicles per km
	Incidents    int       `json:"incidents"`      // Active incidents in cell
	LastUpdated  time.Time `json:"last_updated"`
}

// GetTrafficMultiplier returns the traffic multiplier for a given location
func (t *H3TrafficService) GetTrafficMultiplier(lat, lng float64, departureTime time.Time) float64 {
	// Get H3 cell at resolution 7 (about 5km average edge length, good for traffic)
	cell := h3.LatLngToCell(h3.LatLng{Lat: lat, Lng: lng}, 7)

	// Get traffic data from Redis
	trafficData, err := t.getCellTrafficData(cell.String())
	if err != nil || trafficData == nil {
		// Fall back to time-based estimation
		return t.getTimeBasedMultiplier(departureTime)
	}

	// Calculate multiplier based on current vs base speed
	if trafficData.BaseSpeedKmh <= 0 {
		trafficData.BaseSpeedKmh = 50.0 // Default free-flow speed
	}

	speedRatio := trafficData.SpeedKmh / trafficData.BaseSpeedKmh
	if speedRatio <= 0 {
		speedRatio = 0.3 // Minimum ratio for gridlock
	}

	// Multiplier is inverse of speed ratio (slower speed = higher multiplier)
	multiplier := 1.0 / speedRatio

	// Cap the multiplier between 0.8 (very fast traffic) and 3.0 (gridlock)
	if multiplier < 0.8 {
		multiplier = 0.8
	}
	if multiplier > 3.0 {
		multiplier = 3.0
	}

	// Add time-based adjustment for confidence
	timeMultiplier := t.getTimeBasedMultiplier(departureTime)

	// Blend real data (70%) with time estimate (30%) for robustness
	return multiplier*0.7 + timeMultiplier*0.3
}

// GetRouteTrafficMultiplier calculates traffic for an entire route
func (t *H3TrafficService) GetRouteTrafficMultiplier(route []LatLng, departureTime time.Time) float64 {
	if len(route) == 0 {
		return 1.0
	}

	// Sample the route at regular intervals
	totalMultiplier := 0.0
	samples := 0

	for i := 0; i < len(route)-1; i++ {
		// Sample every few points
		if i%(max(1, len(route)/10)) == 0 {
			multiplier := t.GetTrafficMultiplier(route[i].Lat, route[i].Lng, departureTime)
			totalMultiplier += multiplier
			samples++
		}
	}

	if samples == 0 {
		return 1.0
	}

	return totalMultiplier / float64(samples)
}

// UpdateCellTraffic updates traffic data for a cell (called by traffic aggregation system)
func (t *H3TrafficService) UpdateCellTraffic(cellID string, data *TrafficCellData) error {
	data.CellID = cellID
	data.LastUpdated = time.Now()

	jsonData, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal traffic data: %w", err)
	}

	// Store with 10-minute expiry (traffic data should be refreshed regularly)
	return t.redis.Set(t.ctx, fmt.Sprintf("traffic:cell:%s", cellID), jsonData, 10*time.Minute).Err()
}

// RecordDriverSpeed records a driver's current speed for traffic estimation
func (t *H3TrafficService) RecordDriverSpeed(lat, lng, speedKmh float64) error {
	cell := h3.LatLngToCell(h3.LatLng{Lat: lat, Lng: lng}, 7)
	cellID := cell.String()

	// Add to rolling average using Redis sorted set
	// Score is timestamp, member is speed
	member := fmt.Sprintf("%d:%f", time.Now().UnixNano(), speedKmh)

	pipe := t.redis.Pipeline()

	// Add speed record
	pipe.ZAdd(t.ctx, fmt.Sprintf("traffic:speeds:%s", cellID), &redis.Z{
		Score:  float64(time.Now().Unix()),
		Member: member,
	})

	// Remove old records (older than 5 minutes)
	cutoff := time.Now().Add(-5 * time.Minute).Unix()
	pipe.ZRemRangeByScore(t.ctx, fmt.Sprintf("traffic:speeds:%s", cellID), "0", fmt.Sprintf("%d", cutoff))

	_, err := pipe.Exec(t.ctx)
	return err
}

// AggregateTraffic aggregates speed reports into traffic data (run periodically)
func (t *H3TrafficService) AggregateTraffic(cellID string) error {
	speedsKey := fmt.Sprintf("traffic:speeds:%s", cellID)

	// Get all recent speed records
	records, err := t.redis.ZRangeWithScores(t.ctx, speedsKey, 0, -1).Result()
	if err != nil {
		return err
	}

	if len(records) < 3 {
		// Not enough data points
		return nil
	}

	// Calculate average speed
	var totalSpeed float64
	for _, record := range records {
		var speed float64
		fmt.Sscanf(record.Member.(string), "%*d:%f", &speed)
		totalSpeed += speed
	}
	avgSpeed := totalSpeed / float64(len(records))

	// Update cell traffic data
	trafficData := &TrafficCellData{
		SpeedKmh:     avgSpeed,
		BaseSpeedKmh: 50.0, // Could be stored per-cell based on road type
		Density:      float64(len(records)),
	}

	return t.UpdateCellTraffic(cellID, trafficData)
}

// getCellTrafficData retrieves traffic data for a cell from Redis
func (t *H3TrafficService) getCellTrafficData(cellID string) (*TrafficCellData, error) {
	data, err := t.redis.Get(t.ctx, fmt.Sprintf("traffic:cell:%s", cellID)).Result()
	if err != nil {
		return nil, err
	}

	var trafficData TrafficCellData
	if err := json.Unmarshal([]byte(data), &trafficData); err != nil {
		return nil, err
	}

	return &trafficData, nil
}

// getTimeBasedMultiplier returns a multiplier based on time of day and day of week
func (t *H3TrafficService) getTimeBasedMultiplier(departureTime time.Time) float64 {
	hour := departureTime.Hour()
	dayOfWeek := departureTime.Weekday()

	multiplier := 1.0

	isWeekday := dayOfWeek >= time.Monday && dayOfWeek <= time.Friday

	if isWeekday {
		// Morning rush (7-9 AM)
		if hour >= 7 && hour <= 9 {
			// Peak at 8 AM
			peakDistance := math.Abs(float64(hour) + float64(departureTime.Minute())/60.0 - 8.0)
			multiplier = 1.5 - peakDistance*0.2
		}
		// Evening rush (5-7 PM)
		if hour >= 17 && hour <= 19 {
			// Peak at 6 PM
			peakDistance := math.Abs(float64(hour) + float64(departureTime.Minute())/60.0 - 18.0)
			multiplier = 1.6 - peakDistance*0.2
		}
		// Pre-lunch
		if hour >= 11 && hour <= 13 {
			multiplier = 1.15
		}
	}

	// Weekend adjustments
	if dayOfWeek == time.Saturday {
		if hour >= 10 && hour <= 18 {
			multiplier = 1.2
		}
	}
	if dayOfWeek == time.Sunday {
		if hour >= 10 && hour <= 15 {
			multiplier = 1.1
		}
	}

	// Late night low traffic
	if hour >= 22 || hour <= 5 {
		multiplier = 0.85
	}

	return multiplier
}

// =============================================================================
// REGIONAL TRAFFIC PATTERNS FOR AFRICAN CITIES
// =============================================================================

// CityTrafficProfile defines traffic patterns for a specific city
type CityTrafficProfile struct {
	City            string
	Country         string
	MorningRushStart int // Hour (24h format)
	MorningRushEnd   int
	EveningRushStart int
	EveningRushEnd   int
	PeakMultiplier   float64 // Rush hour multiplier
	RainyMultiplier  float64 // Additional multiplier for rain
	BaseSpeedKmh     float64 // Average free-flow speed
}

// AfricanCityProfiles defines traffic patterns for major African cities
var AfricanCityProfiles = map[string]CityTrafficProfile{
	"lagos": {
		City:             "Lagos",
		Country:          "Nigeria",
		MorningRushStart: 6,
		MorningRushEnd:   10,
		EveningRushStart: 16,
		EveningRushEnd:   21,
		PeakMultiplier:   2.5, // Lagos traffic is notoriously bad
		RainyMultiplier:  1.5,
		BaseSpeedKmh:     30,
	},
	"nairobi": {
		City:             "Nairobi",
		Country:          "Kenya",
		MorningRushStart: 7,
		MorningRushEnd:   9,
		EveningRushStart: 17,
		EveningRushEnd:   20,
		PeakMultiplier:   1.8,
		RainyMultiplier:  1.4,
		BaseSpeedKmh:     35,
	},
	"accra": {
		City:             "Accra",
		Country:          "Ghana",
		MorningRushStart: 7,
		MorningRushEnd:   9,
		EveningRushStart: 16,
		EveningRushEnd:   19,
		PeakMultiplier:   1.6,
		RainyMultiplier:  1.3,
		BaseSpeedKmh:     40,
	},
	"johannesburg": {
		City:             "Johannesburg",
		Country:          "South Africa",
		MorningRushStart: 6,
		MorningRushEnd:   9,
		EveningRushStart: 16,
		EveningRushEnd:   19,
		PeakMultiplier:   1.7,
		RainyMultiplier:  1.3,
		BaseSpeedKmh:     45,
	},
	"cairo": {
		City:             "Cairo",
		Country:          "Egypt",
		MorningRushStart: 8,
		MorningRushEnd:   11,
		EveningRushStart: 17,
		EveningRushEnd:   21,
		PeakMultiplier:   2.0,
		RainyMultiplier:  1.4,
		BaseSpeedKmh:     30,
	},
	"dar_es_salaam": {
		City:             "Dar es Salaam",
		Country:          "Tanzania",
		MorningRushStart: 7,
		MorningRushEnd:   9,
		EveningRushStart: 16,
		EveningRushEnd:   19,
		PeakMultiplier:   1.5,
		RainyMultiplier:  1.4,
		BaseSpeedKmh:     35,
	},
	"kigali": {
		City:             "Kigali",
		Country:          "Rwanda",
		MorningRushStart: 7,
		MorningRushEnd:   9,
		EveningRushStart: 17,
		EveningRushEnd:   19,
		PeakMultiplier:   1.3,
		RainyMultiplier:  1.2,
		BaseSpeedKmh:     50,
	},
}

// GetCityTrafficMultiplier returns a traffic multiplier for a specific city
func (t *H3TrafficService) GetCityTrafficMultiplier(city string, departureTime time.Time) float64 {
	profile, exists := AfricanCityProfiles[city]
	if !exists {
		return t.getTimeBasedMultiplier(departureTime)
	}

	hour := departureTime.Hour()
	dayOfWeek := departureTime.Weekday()
	multiplier := 1.0

	isWeekday := dayOfWeek >= time.Monday && dayOfWeek <= time.Friday

	if isWeekday {
		// Morning rush
		if hour >= profile.MorningRushStart && hour <= profile.MorningRushEnd {
			// Gradient towards peak
			peakHour := (profile.MorningRushStart + profile.MorningRushEnd) / 2
			peakDistance := math.Abs(float64(hour) - float64(peakHour))
			maxDistance := float64(profile.MorningRushEnd-profile.MorningRushStart) / 2
			multiplier = profile.PeakMultiplier - (peakDistance/maxDistance)*(profile.PeakMultiplier-1.2)
		}

		// Evening rush (typically worse)
		if hour >= profile.EveningRushStart && hour <= profile.EveningRushEnd {
			peakHour := (profile.EveningRushStart + profile.EveningRushEnd) / 2
			peakDistance := math.Abs(float64(hour) - float64(peakHour))
			maxDistance := float64(profile.EveningRushEnd-profile.EveningRushStart) / 2
			multiplier = profile.PeakMultiplier*1.1 - (peakDistance/maxDistance)*(profile.PeakMultiplier-1.2)
		}
	}

	// Late night low traffic
	if hour >= 22 || hour <= 5 {
		multiplier = 0.8
	}

	return multiplier
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
