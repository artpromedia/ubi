// Package geo provides geospatial utilities for the ride service.
package geo

import (
	"fmt"
	"math"
)

const (
	// Earth's radius in meters
	EarthRadius = 6371000.0
	
	// Degrees to radians conversion factor
	DegToRad = math.Pi / 180.0
	
	// Radians to degrees conversion factor
	RadToDeg = 180.0 / math.Pi
	
	// H3 resolution for driver matching (approx 460m hexagon edge)
	H3Resolution = 9
	
	// Default search radius in meters
	DefaultSearchRadius = 5000.0
	
	// Maximum search radius in meters
	MaxSearchRadius = 50000.0
)

// Coordinate represents a geographic coordinate
type Coordinate struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// BoundingBox represents a geographic bounding box
type BoundingBox struct {
	MinLat float64 `json:"min_lat"`
	MaxLat float64 `json:"max_lat"`
	MinLng float64 `json:"min_lng"`
	MaxLng float64 `json:"max_lng"`
}

// HaversineDistance calculates the great-circle distance between two points
// Returns distance in meters
func HaversineDistance(lat1, lng1, lat2, lng2 float64) float64 {
	dLat := (lat2 - lat1) * DegToRad
	dLng := (lng2 - lng1) * DegToRad
	
	lat1Rad := lat1 * DegToRad
	lat2Rad := lat2 * DegToRad
	
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Sin(dLng/2)*math.Sin(dLng/2)*math.Cos(lat1Rad)*math.Cos(lat2Rad)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	
	return EarthRadius * c
}

// DistanceCoords calculates distance between two coordinates
func DistanceCoords(c1, c2 Coordinate) float64 {
	return HaversineDistance(c1.Lat, c1.Lng, c2.Lat, c2.Lng)
}

// Bearing calculates the initial bearing from point 1 to point 2
// Returns bearing in degrees (0-360)
func Bearing(lat1, lng1, lat2, lng2 float64) float64 {
	lat1Rad := lat1 * DegToRad
	lat2Rad := lat2 * DegToRad
	dLng := (lng2 - lng1) * DegToRad
	
	y := math.Sin(dLng) * math.Cos(lat2Rad)
	x := math.Cos(lat1Rad)*math.Sin(lat2Rad) - math.Sin(lat1Rad)*math.Cos(lat2Rad)*math.Cos(dLng)
	
	bearing := math.Atan2(y, x) * RadToDeg
	
	// Normalize to 0-360
	return math.Mod(bearing+360, 360)
}

// DestinationPoint calculates the destination point given distance and bearing
func DestinationPoint(lat, lng, distanceM, bearingDeg float64) Coordinate {
	latRad := lat * DegToRad
	lngRad := lng * DegToRad
	bearingRad := bearingDeg * DegToRad
	
	angularDist := distanceM / EarthRadius
	
	destLat := math.Asin(
		math.Sin(latRad)*math.Cos(angularDist) +
			math.Cos(latRad)*math.Sin(angularDist)*math.Cos(bearingRad))
	
	destLng := lngRad + math.Atan2(
		math.Sin(bearingRad)*math.Sin(angularDist)*math.Cos(latRad),
		math.Cos(angularDist)-math.Sin(latRad)*math.Sin(destLat))
	
	return Coordinate{
		Lat: destLat * RadToDeg,
		Lng: destLng * RadToDeg,
	}
}

// GetBoundingBox returns a bounding box around a center point
func GetBoundingBox(lat, lng, radiusM float64) BoundingBox {
	// Approximate degrees per meter at this latitude
	latDegPerMeter := 1.0 / 111320.0
	lngDegPerMeter := 1.0 / (111320.0 * math.Cos(lat*DegToRad))
	
	latDelta := radiusM * latDegPerMeter
	lngDelta := radiusM * lngDegPerMeter
	
	return BoundingBox{
		MinLat: lat - latDelta,
		MaxLat: lat + latDelta,
		MinLng: lng - lngDelta,
		MaxLng: lng + lngDelta,
	}
}

// IsWithinBounds checks if a coordinate is within a bounding box
func IsWithinBounds(lat, lng float64, bounds BoundingBox) bool {
	return lat >= bounds.MinLat && lat <= bounds.MaxLat &&
		lng >= bounds.MinLng && lng <= bounds.MaxLng
}

// IsValidCoordinate checks if coordinates are valid
func IsValidCoordinate(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

// H3Cell generates a mock H3 cell index for a coordinate
// In production, use the actual h3-go library
func H3Cell(lat, lng float64, resolution int) string {
	// This is a simplified mock - in production use h3-go
	// Format: 8-digit cell index based on lat/lng grid
	latBucket := int((lat + 90) * 1000)
	lngBucket := int((lng + 180) * 1000)
	
	return fmt.Sprintf("%d%08d%08d", resolution, latBucket, lngBucket)
}

// H3Neighbors returns neighboring H3 cell indices
// In production, use the actual h3-go library
func H3Neighbors(cell string) []string {
	// Simplified mock - returns the cell and approximate neighbors
	// In production, use h3-go kRing function
	return []string{cell}
}

// EstimateETA estimates travel time in seconds based on distance
// Uses average speeds for African urban conditions
func EstimateETA(distanceM float64, vehicleType string) int64 {
	// Average speeds in m/s for African urban conditions
	speeds := map[string]float64{
		"bike":      8.0,   // ~30 km/h
		"tricycle":  6.0,   // ~22 km/h
		"car":       10.0,  // ~36 km/h (accounting for traffic)
		"suv":       10.0,
		"premium":   10.0,
		"default":   10.0,
	}
	
	speed, exists := speeds[vehicleType]
	if !exists {
		speed = speeds["default"]
	}
	
	// Add 20% buffer for stops, turns, etc.
	eta := distanceM / speed * 1.2
	
	// Minimum 60 seconds
	if eta < 60 {
		return 60
	}
	
	return int64(eta)
}

// EstimateETAWithTraffic adjusts ETA based on time of day
func EstimateETAWithTraffic(baseETASeconds int64, hour int) int64 {
	// Traffic multipliers based on hour (0-23)
	// Peak hours in African cities
	var multiplier float64
	
	switch {
	case hour >= 7 && hour <= 9:
		multiplier = 1.5 // Morning rush
	case hour >= 17 && hour <= 20:
		multiplier = 1.7 // Evening rush
	case hour >= 12 && hour <= 14:
		multiplier = 1.2 // Lunch hour
	case hour >= 22 || hour <= 5:
		multiplier = 0.8 // Night - faster
	default:
		multiplier = 1.0
	}
	
	return int64(float64(baseETASeconds) * multiplier)
}

// PolylineEncode encodes a series of coordinates into a polyline string
func PolylineEncode(coords []Coordinate) string {
	if len(coords) == 0 {
		return ""
	}
	
	var result []byte
	var prevLat, prevLng int64
	
	for _, coord := range coords {
		lat := int64(coord.Lat * 1e5)
		lng := int64(coord.Lng * 1e5)
		
		result = append(result, encodeValue(lat-prevLat)...)
		result = append(result, encodeValue(lng-prevLng)...)
		
		prevLat = lat
		prevLng = lng
	}
	
	return string(result)
}

func encodeValue(v int64) []byte {
	if v < 0 {
		v = ^(v << 1)
	} else {
		v = v << 1
	}
	
	var result []byte
	for v >= 0x20 {
		result = append(result, byte((v&0x1f)|0x20)+63)
		v >>= 5
	}
	result = append(result, byte(v)+63)
	
	return result
}

// African cities with their service area bounds
type ServiceArea struct {
	Name   string
	Center Coordinate
	Radius float64 // meters
}

// GetServiceAreas returns supported service areas in Africa
func GetServiceAreas() []ServiceArea {
	return []ServiceArea{
		{Name: "Lagos", Center: Coordinate{Lat: 6.5244, Lng: 3.3792}, Radius: 50000},
		{Name: "Nairobi", Center: Coordinate{Lat: -1.2921, Lng: 36.8219}, Radius: 40000},
		{Name: "Accra", Center: Coordinate{Lat: 5.6037, Lng: -0.1870}, Radius: 35000},
		{Name: "Kampala", Center: Coordinate{Lat: 0.3476, Lng: 32.5825}, Radius: 30000},
		{Name: "Dar es Salaam", Center: Coordinate{Lat: -6.7924, Lng: 39.2083}, Radius: 35000},
		{Name: "Kigali", Center: Coordinate{Lat: -1.9403, Lng: 29.8739}, Radius: 25000},
		{Name: "Abuja", Center: Coordinate{Lat: 9.0579, Lng: 7.4951}, Radius: 40000},
		{Name: "Johannesburg", Center: Coordinate{Lat: -26.2041, Lng: 28.0473}, Radius: 60000},
		{Name: "Cape Town", Center: Coordinate{Lat: -33.9249, Lng: 18.4241}, Radius: 50000},
	}
}

// IsInServiceArea checks if a coordinate is within any supported service area
func IsInServiceArea(lat, lng float64) (bool, *ServiceArea) {
	coord := Coordinate{Lat: lat, Lng: lng}
	
	for _, area := range GetServiceAreas() {
		dist := DistanceCoords(coord, area.Center)
		if dist <= area.Radius {
			return true, &area
		}
	}
	
	return false, nil
}
