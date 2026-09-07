package matching

import (
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// Policy holds the dispatch limits that are not city configuration.
//
// City config owns the rings and the offer TTL, because those are commercial
// choices a city operator approves. What is left here is operational safety:
// how stale a driver's location may be before the server stops believing it,
// and how many times a ride may sweep the rings before the rider is told there
// is no driver rather than being left spinning.
type Policy struct {
	// LocationFreshness is how recently a driver must have reported a position
	// to be offered work.
	LocationFreshness time.Duration
	// MaxRounds is how many complete sweeps of the configured rings a ride gets
	// before it moves to `no_driver`. Retries are bounded, never endless.
	MaxRounds int
	// SweepBatch caps how much work one dispatcher tick does, so a backlog
	// cannot turn into one enormous transaction.
	SweepBatch int
}

// DefaultPolicy is the operational default. It is deliberately conservative:
// two minutes of silence from a driver app is enough to stop routing riders to
// them, and three sweeps of the rings is enough to tell a rider the truth.
func DefaultPolicy() Policy {
	return Policy{
		LocationFreshness: 2 * time.Minute,
		MaxRounds:         3,
		SweepBatch:        50,
	}
}

// Normalise fills in any zero field with the default, so a partially built
// Policy cannot silently disable a limit.
func (p Policy) Normalise() Policy {
	defaults := DefaultPolicy()
	if p.LocationFreshness <= 0 {
		p.LocationFreshness = defaults.LocationFreshness
	}
	if p.MaxRounds <= 0 {
		p.MaxRounds = defaults.MaxRounds
	}
	if p.SweepBatch <= 0 {
		p.SweepBatch = defaults.SweepBatch
	}
	return p
}

// Exhausted reports whether a ride has used up its rings and its rounds.
func (p Policy) Exhausted(config *cityconfig.CityConfig, ring, rounds int) bool {
	if RingCount(config) == 0 {
		return true
	}
	return rounds >= p.MaxRounds && ring >= RingCount(config)
}

// Candidates measures every session against the pickup point and keeps the ones
// genuinely inside the ring, ranked best-first.
//
// Sessions arrive from a bounding-box query, which over-selects; this is where
// the real distance decides. A session without a location is dropped rather
// than treated as being at the origin.
func Candidates(sessions []*domain.DriverSession, pickup domain.Place, ring Ring) []Candidate {
	candidates := make([]Candidate, 0, len(sessions))
	for _, session := range sessions {
		if !session.HasLocation() {
			continue
		}
		distance, inside := Within(pickup.Lat, pickup.Lng, *session.LastLat, *session.LastLng, ring.RadiusMeters)
		if !inside {
			continue
		}
		candidates = append(candidates, Candidate{
			DriverID:       session.DriverID,
			Lat:            *session.LastLat,
			Lng:            *session.LastLng,
			DistanceMeters: distance,
			ETASeconds:     ETASeconds(distance),
		})
	}
	return Rank(candidates, ring.MaxCandidates)
}
