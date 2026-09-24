package marketplace

import (
	"testing"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

func stopFixture(order int, lat, lng float64, purpose string, dwell int) RouteStop {
	return RouteStop{StopID: uuid.New(), Order: order, Label: "label", Lat: lat, Lng: lng, Purpose: purpose, DwellSec: dwell}
}

// TestRouteFingerprintNamesTheRouteNotTheWords: the fingerprint moves with
// anything that changes the work (a coordinate, the order, a purpose, a
// dwell, an endpoint) and not with a label or a stop id.
func TestRouteFingerprintNamesTheRouteNotTheWords(t *testing.T) {
	pickup, dropoff := Area{Lat: 6.5244, Lng: 3.3792}, Area{Lat: 6.5694, Lng: 3.3792}
	a := stopFixture(1, 6.54, 3.39, StopPurposeErrand, 120)
	b := stopFixture(2, 6.55, 3.37, StopPurposeOther, 60)
	base := routeFingerprint(pickup, []RouteStop{a, b}, dropoff)

	relabelled := a
	relabelled.Label, relabelled.StopID = "a different label", uuid.New()
	if routeFingerprint(pickup, []RouteStop{relabelled, b}, dropoff) != base {
		t.Fatal("a label or id change must not change the route fingerprint")
	}
	longerWait := a
	longerWait.DwellSec = 300
	otherPurpose := a
	otherPurpose.Purpose = StopPurposePickupPassenger
	for name, fingerprint := range map[string]string{
		"reordered":     routeFingerprint(pickup, []RouteStop{b, a}, dropoff),
		"dwell":         routeFingerprint(pickup, []RouteStop{longerWait, b}, dropoff),
		"purpose":       routeFingerprint(pickup, []RouteStop{otherPurpose, b}, dropoff),
		"stop removed":  routeFingerprint(pickup, []RouteStop{a}, dropoff),
		"no stops":      routeFingerprint(pickup, nil, dropoff),
		"other dropoff": routeFingerprint(pickup, []RouteStop{a, b}, Area{Lat: 6.60, Lng: 3.3792}),
	} {
		if fingerprint == base {
			t.Fatalf("%s must change the route fingerprint", name)
		}
	}
}

// TestSameStopSetAndCarriedIDs: a material change is anything but the same
// places (within tolerance), purposes and dwells in the same order; adopting
// a revised list keeps the id of every surviving stop and mints none for it.
func TestSameStopSetAndCarriedIDs(t *testing.T) {
	a := stopFixture(1, 6.54, 3.39, StopPurposeErrand, 120)
	b := stopFixture(2, 6.55, 3.37, StopPurposeOther, 60)
	jitter := a
	jitter.Lat += 0.0001 // ~11 m: re-geocoding noise, the same place
	jitter.StopID = uuid.New()

	if !sameStopSet([]RouteStop{a, b}, []RouteStop{jitter, b}) {
		t.Fatal("a stop within the route tolerance is the same stop")
	}
	if sameStopSet([]RouteStop{a, b}, []RouteStop{b, a}) {
		t.Fatal("a reorder is a material change")
	}
	if sameStopSet([]RouteStop{a}, []RouteStop{a, b}) || sameStopSet(nil, []RouteStop{a}) {
		t.Fatal("adding a stop is a material change")
	}
	if !sameStopSet(nil, nil) {
		t.Fatal("two plain routes are the same route")
	}

	c := stopFixture(0, 6.56, 3.40, StopPurposeDropPassenger, 0)
	fresh := []RouteStop{c, jitter, b}
	adopted := carryStopIDs([]RouteStop{a, b}, fresh)
	if len(adopted) != 3 {
		t.Fatalf("adopted: %+v", adopted)
	}
	if adopted[0].StopID != c.StopID || adopted[1].StopID != a.StopID || adopted[2].StopID != b.StopID {
		t.Fatalf("surviving stops must keep their ids, new ones keep theirs: %+v", adopted)
	}
	for i, stop := range adopted {
		if stop.Order != i+1 {
			t.Fatalf("order must follow the new list: %+v", adopted)
		}
	}
	if carryStopIDs([]RouteStop{a}, nil) != nil {
		t.Fatal("removing every stop adopts the plain route")
	}
}

// TestBuildRouteStopsBoundsAndDefaults exercises the validator directly: the
// limit, the defaults and the zero-stop limit that disables stops.
func TestBuildRouteStopsBoundsAndDefaults(t *testing.T) {
	pickup, dropoff := domain.Place{Lat: 6.5244, Lng: 3.3792}, domain.Place{Lat: 6.5694, Lng: 3.3792}
	policy := cityconfig.MarketplaceStopsPolicy{MaxIntermediateStops: 2, DefaultDwellSec: 45, MaxDwellSec: 90}

	stops, err := buildRouteStops(pickup, dropoff, []StopInput{{Lat: 6.54, Lng: 3.39}}, policy)
	if err != nil {
		t.Fatal(err)
	}
	if stops[0].Purpose != StopPurposeOther || stops[0].DwellSec != 45 || stops[0].Order != 1 ||
		stops[0].StopID == uuid.Nil || stops[0].Label != areaLabelOf(6.54, 3.39) {
		t.Fatalf("defaults: %+v", stops[0])
	}
	if _, err := buildRouteStops(pickup, dropoff, []StopInput{{Lat: 6.54, Lng: 3.39}, {Lat: 6.55, Lng: 3.37}, {Lat: 6.56, Lng: 3.40}}, policy); err == nil {
		t.Fatal("three stops over a limit of two must be refused")
	}
	zero := 0
	if _, err := buildRouteStops(pickup, dropoff, []StopInput{{Lat: 6.54, Lng: 3.39, DwellSec: &zero, Label: "bad\u0007label"}}, policy); err == nil {
		t.Fatal("a control character in a label must be refused")
	}
	disabled := cityconfig.MarketplaceStopsPolicy{MaxIntermediateStops: 0}
	if _, err := buildRouteStops(pickup, dropoff, []StopInput{{Lat: 6.54, Lng: 3.39}}, disabled); err == nil {
		t.Fatal("a market with a zero stop limit takes no stops")
	}
	if stops, err := buildRouteStops(pickup, dropoff, nil, disabled); err != nil || stops != nil {
		t.Fatal("no stops is always the plain route")
	}
}

// TestStopsColumnRoundTrip: the jsonb encoding is '[]' for a plain route and
// decodes back to no stops; a real list round-trips intact.
func TestStopsColumnRoundTrip(t *testing.T) {
	encoded, err := encodeStops(nil)
	if err != nil || string(encoded) != "[]" {
		t.Fatalf("a plain route must store '[]': %s %v", encoded, err)
	}
	if decoded, err := decodeStops(encoded); err != nil || decoded != nil {
		t.Fatalf("'[]' must read back as no stops: %v %v", decoded, err)
	}
	stops := []RouteStop{stopFixture(1, 6.54, 3.39, StopPurposeErrand, 120)}
	encoded, err = encodeStops(stops)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeStops(encoded)
	if err != nil || len(decoded) != 1 || decoded[0] != stops[0] {
		t.Fatalf("round trip: %+v %v", decoded, err)
	}
	execution := executionStops(decoded)
	if execution[0].StopID != stops[0].StopID.String() || execution[0].Address != "label" || execution[0].Order != 1 {
		t.Fatalf("execution stop: %+v", execution[0])
	}
}
