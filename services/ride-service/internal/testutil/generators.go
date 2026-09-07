package testutil

import (
	"math"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// PlaceAt returns the point `meters` due north of an origin.
//
// Tests need to put a driver a known distance from a pickup — just inside a
// geofence, or just outside it — and they need that distance to be the same on
// every run. Nothing here is random: a randomly placed driver would make a
// geofence test pass or fail by luck.
func PlaceAt(origin domain.Place, metersNorth float64) domain.Place {
	const metersPerDegreeLat = 111_320.0
	return domain.Place{
		Lat: origin.Lat + metersNorth/metersPerDegreeLat,
		Lng: origin.Lng,
	}
}

// PlaceEast returns the point `meters` due east of an origin.
func PlaceEast(origin domain.Place, metersEast float64) domain.Place {
	const metersPerDegreeLat = 111_320.0
	cos := math.Cos(origin.Lat * math.Pi / 180)
	if math.Abs(cos) < 0.01 {
		cos = 0.01
	}
	return domain.Place{
		Lat: origin.Lat,
		Lng: origin.Lng + metersEast/(metersPerDegreeLat*cos),
	}
}
