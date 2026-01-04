package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/joho/godotenv"
	"github.com/segmentio/kafka-go"
	"github.com/uber/h3-go/v4"
)

const (
	H3Resolution = 8 // ~460m hexagons, good for city matching
	LocationTTL  = 30 * time.Second
)

type DriverLocation struct {
	DriverID    string    `json:"driver_id"`
	Latitude    float64   `json:"latitude"`
	Longitude   float64   `json:"longitude"`
	Heading     float64   `json:"heading"`
	Speed       float64   `json:"speed"`
	Accuracy    float64   `json:"accuracy"`
	Timestamp   time.Time `json:"timestamp"`
	H3Index     string    `json:"h3_index"`
	VehicleType string    `json:"vehicle_type"`
	IsAvailable bool      `json:"is_available"`
	Distance    float64   `json:"distance,omitempty"` // For query results
}

type LocationService struct {
	redis  *redis.Client
	kafka  *kafka.Writer
	ctx    context.Context
}

func NewLocationService(redisURL, kafkaBrokers string) *LocationService {
	// Redis client
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("Failed to parse Redis URL: %v", err)
	}
	rdb := redis.NewClient(opt)

	// Test Redis connection
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}

	// Kafka writer
	kafkaWriter := &kafka.Writer{
		Addr:     kafka.TCP(kafkaBrokers),
		Topic:    "driver-locations",
		Balancer: &kafka.LeastBytes{},
	}

	log.Println("✅ Connected to Redis and Kafka")

	return &LocationService{
		redis: rdb,
		kafka: kafkaWriter,
		ctx:   context.Background(),
	}
}

// UpdateDriverLocation stores driver location with H3 indexing
func (s *LocationService) UpdateDriverLocation(loc *DriverLocation) error {
	// Calculate H3 index
	h3Index := h3.LatLngToCell(h3.LatLng{
		Lat: loc.Latitude,
		Lng: loc.Longitude,
	}, H3Resolution)
	loc.H3Index = h3Index.String()

	// Use pipeline for atomic operations
	pipe := s.redis.Pipeline()

	// 1. Geo index for radius queries
	pipe.GeoAdd(s.ctx, "drivers:geo", &redis.GeoLocation{
		Name:      loc.DriverID,
		Latitude:  loc.Latitude,
		Longitude: loc.Longitude,
	})

	// 2. H3 index for fast matching
	if loc.IsAvailable {
		pipe.SAdd(s.ctx, fmt.Sprintf("h3:%s:drivers", loc.H3Index), loc.DriverID)
		pipe.Expire(s.ctx, fmt.Sprintf("h3:%s:drivers", loc.H3Index), LocationTTL)
	}

	// 3. Driver details hash
	pipe.HSet(s.ctx, fmt.Sprintf("driver:%s:location", loc.DriverID), map[string]interface{}{
		"lat":          loc.Latitude,
		"lng":          loc.Longitude,
		"heading":      loc.Heading,
		"speed":        loc.Speed,
		"accuracy":     loc.Accuracy,
		"h3":           loc.H3Index,
		"vehicle_type": loc.VehicleType,
		"available":    loc.IsAvailable,
		"updated":      loc.Timestamp.Unix(),
	})
	pipe.Expire(s.ctx, fmt.Sprintf("driver:%s:location", loc.DriverID), LocationTTL)

	// 4. Update driver status
	if loc.IsAvailable {
		pipe.SAdd(s.ctx, "drivers:available", loc.DriverID)
		pipe.Expire(s.ctx, "drivers:available", LocationTTL)
	} else {
		pipe.SRem(s.ctx, "drivers:available", loc.DriverID)
	}

	_, err := pipe.Exec(s.ctx)
	if err != nil {
		return fmt.Errorf("redis pipeline error: %w", err)
	}

	// Publish for real-time subscribers
	if loc.IsAvailable {
		locationJSON, _ := json.Marshal(loc)
		s.redis.Publish(s.ctx, fmt.Sprintf("driver:%s:location", loc.DriverID), locationJSON)
	}

	// Send to Kafka for processing/storage
	go s.sendToKafka(loc)

	return nil
}

// FindNearbyDrivers finds available drivers near a location
func (s *LocationService) FindNearbyDrivers(lat, lng float64, radiusKm float64, vehicleType string) ([]*DriverLocation, error) {
	// Get H3 index and neighboring cells
	centerCell := h3.LatLngToCell(h3.LatLng{Lat: lat, Lng: lng}, H3Resolution)
	
	// Get rings of neighboring cells (center + 2 rings = ~2.8 km coverage)
	neighbors := h3.GridDisk(centerCell, 2)

	var driverIDs []string
	driverSet := make(map[string]bool)

	// Get drivers from all relevant H3 cells (fast set lookup)
	for _, cell := range neighbors {
		ids, err := s.redis.SMembers(s.ctx, fmt.Sprintf("h3:%s:drivers", cell.String())).Result()
		if err == nil {
			for _, id := range ids {
				if !driverSet[id] {
					driverSet[id] = true
					driverIDs = append(driverIDs, id)
				}
			}
		}
	}

	// Filter by exact distance and availability
	var nearbyDrivers []*DriverLocation

	for _, driverID := range driverIDs {
		loc, err := s.getDriverLocation(driverID)
		if err != nil || !loc.IsAvailable {
			continue
		}

		// Check vehicle type filter
		if vehicleType != "" && loc.VehicleType != vehicleType {
			continue
		}

		// Calculate exact distance using Haversine formula
		distance := haversineDistance(lat, lng, loc.Latitude, loc.Longitude)
		if distance <= radiusKm {
			loc.Distance = distance
			nearbyDrivers = append(nearbyDrivers, loc)
		}
	}

	// Sort by distance (closest first)
	sort.Slice(nearbyDrivers, func(i, j int) bool {
		return nearbyDrivers[i].Distance < nearbyDrivers[j].Distance
	})

	return nearbyDrivers, nil
}

// getDriverLocation retrieves driver location from Redis
func (s *LocationService) getDriverLocation(driverID string) (*DriverLocation, error) {
	data, err := s.redis.HGetAll(s.ctx, fmt.Sprintf("driver:%s:location", driverID)).Result()
	if err != nil || len(data) == 0 {
		return nil, fmt.Errorf("driver not found: %s", driverID)
	}

	lat, _ := strconv.ParseFloat(data["lat"], 64)
	lng, _ := strconv.ParseFloat(data["lng"], 64)
	heading, _ := strconv.ParseFloat(data["heading"], 64)
	speed, _ := strconv.ParseFloat(data["speed"], 64)
	accuracy, _ := strconv.ParseFloat(data["accuracy"], 64)
	updated, _ := strconv.ParseInt(data["updated"], 10, 64)
	available := data["available"] == "1"

	return &DriverLocation{
		DriverID:    driverID,
		Latitude:    lat,
		Longitude:   lng,
		Heading:     heading,
		Speed:       speed,
		Accuracy:    accuracy,
		H3Index:     data["h3"],
		VehicleType: data["vehicle_type"],
		IsAvailable: available,
		Timestamp:   time.Unix(updated, 0),
	}, nil
}

// GetDriverLocation retrieves a single driver's location
func (s *LocationService) GetDriverLocation(driverID string) (*DriverLocation, error) {
	return s.getDriverLocation(driverID)
}

// sendToKafka sends location to Kafka for processing/storage
func (s *LocationService) sendToKafka(loc *DriverLocation) {
	locationJSON, err := json.Marshal(loc)
	if err != nil {
		log.Printf("Error marshaling location: %v", err)
		return
	}

	err = s.kafka.WriteMessages(context.Background(), kafka.Message{
		Key:   []byte(loc.DriverID),
		Value: locationJSON,
	})
	if err != nil {
		log.Printf("Error writing to Kafka: %v", err)
	}
}

// haversineDistance calculates distance between two points in kilometers
func haversineDistance(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371 // Earth's radius in kilometers

	dLat := toRadians(lat2 - lat1)
	dLng := toRadians(lng2 - lng1)

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRadians(lat1))*math.Cos(toRadians(lat2))*
			math.Sin(dLng/2)*math.Sin(dLng/2)

	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return R * c
}

func toRadians(degrees float64) float64 {
	return degrees * math.Pi / 180
}

// HTTP Handlers
func main() {
	// Load environment variables
	godotenv.Load()

	port := os.Getenv("PORT")
	if port == "" {
		port = "4011"
	}

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}

	kafkaBrokers := os.Getenv("KAFKA_BROKERS")
	if kafkaBrokers == "" {
		kafkaBrokers = "localhost:9092"
	}

	// Initialize service
	service := NewLocationService(redisURL, kafkaBrokers)
	defer service.redis.Close()
	defer service.kafka.Close()

	// Setup Gin router
	router := gin.Default()

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":    "healthy",
			"service":   "location-service",
			"timestamp": time.Now().Format(time.RFC3339),
		})
	})

	// Update driver location
	router.POST("/api/locations/driver", func(c *gin.Context) {
		var loc DriverLocation
		if err := c.ShouldBindJSON(&loc); err != nil {
			c.JSON(400, gin.H{"error": "invalid request body"})
			return
		}

		if loc.Timestamp.IsZero() {
			loc.Timestamp = time.Now()
		}

		err := service.UpdateDriverLocation(&loc)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{
			"success": true,
			"h3_index": loc.H3Index,
		})
	})

	// Get driver location
	router.GET("/api/locations/driver/:driverId", func(c *gin.Context) {
		driverID := c.Param("driverId")

		loc, err := service.GetDriverLocation(driverID)
		if err != nil {
			c.JSON(404, gin.H{"error": "driver not found"})
			return
		}

		c.JSON(200, loc)
	})

	// Find nearby drivers
	router.GET("/api/locations/nearby", func(c *gin.Context) {
		lat, err1 := strconv.ParseFloat(c.Query("lat"), 64)
		lng, err2 := strconv.ParseFloat(c.Query("lng"), 64)
		radius, err3 := strconv.ParseFloat(c.Query("radius"), 64)

		if err1 != nil || err2 != nil || err3 != nil {
			c.JSON(400, gin.H{"error": "invalid lat/lng/radius parameters"})
			return
		}

		vehicleType := c.Query("vehicleType")

		drivers, err := service.FindNearbyDrivers(lat, lng, radius, vehicleType)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{
			"count": len(drivers),
			"drivers": drivers,
		})
	})

	// Start server
	log.Printf("🚀 Location Service running on port %s", port)
	log.Printf("📍 H3 Resolution: %d (~460m hexagons)", H3Resolution)
	if err := router.Run(fmt.Sprintf(":%s", port)); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
