// Package matching holds the dispatch policy: which ring a ride is on, which
// drivers are inside it, and in what order they should be offered the work.
//
// Everything here is a pure function of its inputs. It performs no I/O, holds
// no session state and starts no goroutines — a dispatch that lived in memory
// would vanish on a restart, and slice 02 requires every offer and response to
// be persisted so the ops timeline can show them. The durable half lives in
// the move package; this half is the arithmetic, so it can be reasoned about
// and tested without a database.
package matching

import (
	"math"
	"sort"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
)

// Candidate is a driver who could be offered a ride, with the measurements the
// ranking is made from.
type Candidate struct {
	DriverID       uuid.UUID
	Lat            float64
	Lng            float64
	DistanceMeters float64
	ETASeconds     int64
	// Score is filled in by Rank; higher is better.
	Score float64
}

// Ring is one search ring from the city configuration.
type Ring struct {
	Index         int
	RadiusMeters  int
	MaxCandidates int
}

// RingFor returns the ring a ride on `index` should search, clamped to the last
// configured ring. The rings themselves come from city config, never from a
// constant here: a city that wants to start at 500 m says so in its config.
func RingFor(config *cityconfig.CityConfig, index int) (Ring, bool) {
	if len(config.MatchingRings) == 0 {
		return Ring{}, false
	}
	if index < 0 {
		index = 0
	}
	if index >= len(config.MatchingRings) {
		return Ring{}, false
	}
	ring := config.MatchingRings[index]
	return Ring{Index: index, RadiusMeters: ring.RadiusMeters, MaxCandidates: ring.MaxCandidates}, true
}

// RingCount is how many rings a city searches before a ride runs out of rings.
func RingCount(config *cityconfig.CityConfig) int { return len(config.MatchingRings) }

// BoundingBox returns the latitude/longitude window that contains every point
// within `radiusMeters` of a centre. It is a prefilter for the database; the
// exact distance is measured afterwards, because a box corner is further away
// than the radius allows.
func BoundingBox(lat, lng float64, radiusMeters float64) (minLat, maxLat, minLng, maxLng float64) {
	const metersPerDegreeLat = 111_320.0
	deltaLat := radiusMeters / metersPerDegreeLat

	// Degrees of longitude shrink towards the poles. Guard the cosine so a
	// point near a pole widens the box instead of dividing by zero.
	cos := math.Cos(lat * math.Pi / 180)
	if math.Abs(cos) < 0.01 {
		cos = 0.01
	}
	deltaLng := radiusMeters / (metersPerDegreeLat * math.Abs(cos))

	return lat - deltaLat, lat + deltaLat, lng - deltaLng, lng + deltaLng
}

// Within reports whether a driver is inside the ring, measured properly.
func Within(pickupLat, pickupLng, driverLat, driverLng float64, radiusMeters int) (float64, bool) {
	distance := geo.HaversineDistance(pickupLat, pickupLng, driverLat, driverLng)
	return distance, distance <= float64(radiusMeters)
}

// ETASeconds estimates how long a driver needs to reach the pickup.
func ETASeconds(distanceMeters float64) int64 {
	return geo.EstimateETA(distanceMeters, "car")
}

// Rank orders candidates best-first and trims the list to the ring's capacity.
//
// The score is the ETA in seconds, negated, so the driver who can be there
// soonest ranks first and ties break on driver id — the ordering is total and
// deterministic, which is what lets a dispatch be replayed and explained.
func Rank(candidates []Candidate, maxCandidates int) []Candidate {
	ranked := make([]Candidate, len(candidates))
	copy(ranked, candidates)
	for i := range ranked {
		ranked[i].Score = -float64(ranked[i].ETASeconds)
	}
	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].Score != ranked[j].Score {
			return ranked[i].Score > ranked[j].Score
		}
		if ranked[i].DistanceMeters != ranked[j].DistanceMeters {
			return ranked[i].DistanceMeters < ranked[j].DistanceMeters
		}
		return ranked[i].DriverID.String() < ranked[j].DriverID.String()
	})
	if maxCandidates > 0 && len(ranked) > maxCandidates {
		ranked = ranked[:maxCandidates]
	}
	return ranked
}
