package surge

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/uber/h3-go/v4"
)

const (
	H3Resolution = 7  // Resolution 7 for surge zones (~5.16 km² hexagons)
	SurgeCacheTTL = 30 * time.Second
)

type SurgeService struct {
	redis *redis.Client
	ctx   context.Context
}

type SurgeZone struct {
	H3Index    string    `json:"h3_index"`
	Multiplier float64   `json:"multiplier"`
	Demand     int       `json:"demand"`      // Active ride requests
	Supply     int       `json:"supply"`      // Available drivers
	UpdatedAt  time.Time `json:"updated_at"`
}

func NewSurgeService(redisClient *redis.Client) *SurgeService {
	return &SurgeService{
		redis: redisClient,
		ctx:   context.Background(),
	}
}

// CalculateSurge returns the surge multiplier for a location
func (s *SurgeService) CalculateSurge(ctx context.Context, lat, lng float64) (float64, error) {
	h3Index := h3.LatLngToCell(h3.LatLng{Lat: lat, Lng: lng}, H3Resolution)

	// Try to get cached surge
	zone, err := s.getSurgeZone(ctx, h3Index.String())
	if err == nil && time.Since(zone.UpdatedAt) <= SurgeCacheTTL {
		return zone.Multiplier, nil
	}

	// Calculate new surge
	zone = s.calculateZoneSurge(ctx, h3Index)
	s.cacheSurgeZone(ctx, zone)

	return zone.Multiplier, nil
}

// GetSurgeZones returns surge multipliers for multiple H3 cells (for map display)
func (s *SurgeService) GetSurgeZones(ctx context.Context, lat, lng float64, radius int) ([]*SurgeZone, error) {
	centerCell := h3.LatLngToCell(h3.LatLng{Lat: lat, Lng: lng}, H3Resolution)
	cells := h3.GridDisk(centerCell, radius)

	var zones []*SurgeZone
	for _, cell := range cells {
		zone, err := s.getSurgeZone(ctx, cell.String())
		if err != nil {
			// Calculate if not in cache
			zone = s.calculateZoneSurge(ctx, cell)
			s.cacheSurgeZone(ctx, zone)
		}
		zones = append(zones, zone)
	}

	return zones, nil
}

func (s *SurgeService) calculateZoneSurge(ctx context.Context, h3Index h3.Cell) *SurgeZone {
	// Get neighboring cells for broader view
	cells := h3.GridDisk(h3Index, 1) // Center + 1 ring

	var totalDemand, totalSupply int

	for _, cell := range cells {
		// Count active ride requests in cell
		demand := s.getActiveRequestsInZone(ctx, cell.String())
		totalDemand += demand

		// Count available drivers in cell
		supply := s.getAvailableDriversInZone(ctx, cell.String())
		totalSupply += supply
	}

	// Calculate surge multiplier
	multiplier := s.calculateMultiplier(totalDemand, totalSupply)

	return &SurgeZone{
		H3Index:    h3Index.String(),
		Multiplier: multiplier,
		Demand:     totalDemand,
		Supply:     totalSupply,
		UpdatedAt:  time.Now(),
	}
}

func (s *SurgeService) calculateMultiplier(demand, supply int) float64 {
	if supply == 0 {
		return 3.0 // Max surge when no drivers available
	}

	ratio := float64(demand) / float64(supply)

	// Surge tiers based on demand/supply ratio
	switch {
	case ratio <= 0.5:
		return 1.0 // No surge - more supply than demand

	case ratio <= 1.0:
		// 1.0x - 1.25x (0.5 to 1.0 ratio)
		return 1.0 + (ratio-0.5)*0.5

	case ratio <= 2.0:
		// 1.25x - 1.75x (1.0 to 2.0 ratio)
		return 1.25 + (ratio-1.0)*0.5

	case ratio <= 3.0:
		// 1.75x - 2.25x (2.0 to 3.0 ratio)
		return 1.75 + (ratio-2.0)*0.5

	default:
		// 2.25x - 3.0x (cap at 3.0x)
		return math.Min(2.25+(ratio-3.0)*0.25, 3.0)
	}
}

func (s *SurgeService) getActiveRequestsInZone(ctx context.Context, h3Index string) int {
	// Count active requests in this H3 cell
	count, err := s.redis.SCard(ctx, fmt.Sprintf("zone:%s:requests", h3Index)).Result()
	if err != nil {
		return 0
	}
	return int(count)
}

func (s *SurgeService) getAvailableDriversInZone(ctx context.Context, h3Index string) int {
	// Count available drivers in this H3 cell
	count, err := s.redis.SCard(ctx, fmt.Sprintf("h3:%s:drivers", h3Index)).Result()
	if err != nil {
		return 0
	}
	return int(count)
}

func (s *SurgeService) getSurgeZone(ctx context.Context, h3Index string) (*SurgeZone, error) {
	data, err := s.redis.Get(ctx, fmt.Sprintf("surge:%s", h3Index)).Result()
	if err != nil {
		return nil, err
	}

	var zone SurgeZone
	if err := json.Unmarshal([]byte(data), &zone); err != nil {
		return nil, err
	}

	return &zone, nil
}

func (s *SurgeService) cacheSurgeZone(ctx context.Context, zone *SurgeZone) {
	data, err := json.Marshal(zone)
	if err != nil {
		return
	}

	s.redis.SetEX(ctx, fmt.Sprintf("surge:%s", zone.H3Index), data, SurgeCacheTTL)
}

// TrackRequest adds a request to a zone's tracking
func (s *SurgeService) TrackRequest(ctx context.Context, requestID string, lat, lng float64) error {
	h3Index := h3.LatLngToCell(h3.LatLng{Lat: lat, Lng: lng}, H3Resolution)
	
	// Add to zone's active requests
	err := s.redis.SAdd(ctx, fmt.Sprintf("zone:%s:requests", h3Index.String()), requestID).Err()
	if err != nil {
		return err
	}

	// Set expiration (auto-cleanup after 10 minutes)
	return s.redis.Expire(ctx, fmt.Sprintf("zone:%s:requests", h3Index.String()), 10*time.Minute).Err()
}

// UntrackRequest removes a request from zone tracking
func (s *SurgeService) UntrackRequest(ctx context.Context, requestID string, lat, lng float64) error {
	h3Index := h3.LatLngToCell(h3.LatLng{Lat: lat, Lng: lng}, H3Resolution)
	return s.redis.SRem(ctx, fmt.Sprintf("zone:%s:requests", h3Index.String()), requestID).Err()
}

// GetSurgeMultiplierForFare applies surge to base fare
func (s *SurgeService) GetSurgeMultiplierForFare(ctx context.Context, lat, lng float64, baseFare float64) (float64, float64, error) {
	multiplier, err := s.CalculateSurge(ctx, lat, lng)
	if err != nil {
		return baseFare, 1.0, err
	}

	surgedFare := baseFare * multiplier
	return surgedFare, multiplier, nil
}
