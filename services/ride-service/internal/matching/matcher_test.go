package matching_test

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/matching"
)

func configWithRings(rings ...cityconfig.MatchingRing) *cityconfig.CityConfig {
	return &cityconfig.CityConfig{
		CityID:        "TST",
		Version:       1,
		Currency:      "NGN",
		MatchingRings: rings,
	}
}

func TestRingsWidenAndThenRunOut(t *testing.T) {
	config := configWithRings(
		cityconfig.MatchingRing{RadiusMeters: 2000, MaxCandidates: 5},
		cityconfig.MatchingRing{RadiusMeters: 4000, MaxCandidates: 8},
	)

	first, ok := matching.RingFor(config, 0)
	if !ok || first.RadiusMeters != 2000 || first.MaxCandidates != 5 {
		t.Fatalf("first ring: got %+v ok=%v", first, ok)
	}
	second, ok := matching.RingFor(config, 1)
	if !ok || second.RadiusMeters != 4000 {
		t.Fatalf("second ring: got %+v ok=%v", second, ok)
	}
	if _, ok := matching.RingFor(config, 2); ok {
		t.Fatal("a third ring must not be invented; the city configured two")
	}
	if matching.RingCount(config) != 2 {
		t.Fatalf("ring count: got %d, want 2", matching.RingCount(config))
	}
}

func TestRingsComeFromConfigNotFromCode(t *testing.T) {
	// A city with a single, tiny ring gets exactly that. If this service had a
	// default radius of its own, this would come back wider.
	config := configWithRings(cityconfig.MatchingRing{RadiusMeters: 300, MaxCandidates: 1})
	ring, ok := matching.RingFor(config, 0)
	if !ok {
		t.Fatal("the configured ring should be usable")
	}
	if ring.RadiusMeters != 300 || ring.MaxCandidates != 1 {
		t.Fatalf("got %+v, want the city's 300 m / 1 candidate ring", ring)
	}
}

func TestBoundingBoxContainsTheRing(t *testing.T) {
	const lat, lng = 6.5244, 3.3792
	const radius = 2000.0

	minLat, maxLat, minLng, maxLng := matching.BoundingBox(lat, lng, radius)
	if minLat >= lat || maxLat <= lat || minLng >= lng || maxLng <= lng {
		t.Fatalf("the box must surround the centre: %v %v %v %v", minLat, maxLat, minLng, maxLng)
	}

	// A point exactly at the radius due north must be inside the box, or the
	// database prefilter would drop a driver the ring should have reached.
	north := lat + radius/111_320.0
	if north > maxLat {
		t.Fatalf("a point on the ring (%v) fell outside the box (max %v)", north, maxLat)
	}
	if _, inside := matching.Within(lat, lng, north, lng, int(radius)); !inside {
		t.Fatal("a point on the ring should measure as inside it")
	}
	// And a point well beyond it is not, however wide the box was.
	if _, inside := matching.Within(lat, lng, lat+3*radius/111_320.0, lng, int(radius)); inside {
		t.Fatal("a point three times the radius away must not measure as inside")
	}
}

func session(id uuid.UUID, lat, lng float64, classes ...string) *domain.DriverSession {
	at := time.Now().UTC()
	return &domain.DriverSession{
		DriverID:       id,
		State:          "available",
		VehicleClasses: classes,
		LastLat:        &lat,
		LastLng:        &lng,
		LastLocationAt: &at,
	}
}

func TestCandidatesKeepOnlyDriversInsideTheRing(t *testing.T) {
	pickup := domain.Place{Lat: 6.5244, Lng: 3.3792}
	near := session(uuid.New(), pickup.Lat+0.001, pickup.Lng) // ~111 m
	far := session(uuid.New(), pickup.Lat+0.05, pickup.Lng)   // ~5.5 km
	noFix := session(uuid.New(), 0, 0)
	noFix.LastLat, noFix.LastLng = nil, nil

	candidates := matching.Candidates(
		[]*domain.DriverSession{near, far, noFix},
		pickup,
		matching.Ring{RadiusMeters: 2000, MaxCandidates: 5},
	)

	if len(candidates) != 1 {
		t.Fatalf("expected only the nearby driver, got %d candidates", len(candidates))
	}
	if candidates[0].DriverID != near.DriverID {
		t.Fatalf("expected the nearby driver, got %s", candidates[0].DriverID)
	}
	if candidates[0].ETASeconds <= 0 {
		t.Fatal("a candidate must carry an ETA")
	}
}

func TestCandidatesAreRankedNearestFirstAndCapped(t *testing.T) {
	pickup := domain.Place{Lat: 6.5244, Lng: 3.3792}
	closest := session(uuid.New(), pickup.Lat+0.0005, pickup.Lng)
	middle := session(uuid.New(), pickup.Lat+0.005, pickup.Lng)
	furthest := session(uuid.New(), pickup.Lat+0.01, pickup.Lng)

	candidates := matching.Candidates(
		[]*domain.DriverSession{furthest, closest, middle},
		pickup,
		matching.Ring{RadiusMeters: 5000, MaxCandidates: 2},
	)

	if len(candidates) != 2 {
		t.Fatalf("the ring caps candidates at 2, got %d", len(candidates))
	}
	if candidates[0].DriverID != closest.DriverID {
		t.Fatal("the nearest driver must rank first")
	}
	if candidates[0].DistanceMeters > candidates[1].DistanceMeters {
		t.Fatal("candidates must be ordered by how soon they can arrive")
	}
}

func TestRankIsDeterministic(t *testing.T) {
	// Two drivers at the same distance must always come back in the same order,
	// so a dispatch can be replayed and explained.
	a := matching.Candidate{DriverID: uuid.MustParse("00000000-0000-0000-0000-0000000000aa"), DistanceMeters: 100, ETASeconds: 60}
	b := matching.Candidate{DriverID: uuid.MustParse("00000000-0000-0000-0000-0000000000bb"), DistanceMeters: 100, ETASeconds: 60}

	first := matching.Rank([]matching.Candidate{a, b}, 2)
	second := matching.Rank([]matching.Candidate{b, a}, 2)

	if first[0].DriverID != second[0].DriverID || first[1].DriverID != second[1].DriverID {
		t.Fatal("ranking must not depend on the order the drivers arrived in")
	}
}

func TestPolicyNormalisesAwayDisabledLimits(t *testing.T) {
	normalised := matching.Policy{}.Normalise()
	if normalised.MaxRounds <= 0 {
		t.Fatal("a zero round limit would let a ride retry forever")
	}
	if normalised.LocationFreshness <= 0 {
		t.Fatal("a zero freshness window would let a stale driver be dispatched")
	}
	if normalised.SweepBatch <= 0 {
		t.Fatal("a zero sweep batch would do no work")
	}
}

func TestPolicyExhaustion(t *testing.T) {
	config := configWithRings(
		cityconfig.MatchingRing{RadiusMeters: 1000, MaxCandidates: 3},
		cityconfig.MatchingRing{RadiusMeters: 2000, MaxCandidates: 3},
	)
	policy := matching.Policy{MaxRounds: 2}.Normalise()

	if policy.Exhausted(config, 0, 0) {
		t.Fatal("a ride on its first ring is not exhausted")
	}
	if policy.Exhausted(config, 2, 1) {
		t.Fatal("a ride with a round left is not exhausted")
	}
	if !policy.Exhausted(config, 2, 2) {
		t.Fatal("a ride that has used every ring and every round is exhausted")
	}
	if !policy.Exhausted(configWithRings(), 0, 0) {
		t.Fatal("a city with no rings can match nobody")
	}
}
