package testutil

import (
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// CityConfigFixture is a complete, valid city configuration in the shape
// CityConfigSchema defines (packages/contracts/src/city-config.ts) and
// config-service stores.
//
// It is a fixture, and it lives in a test-only package for that reason: no
// production path in this service may read a fare, a currency or a TTL from Go
// source. The numbers are deliberately round and deliberately not Lagos's, so
// a test that accidentally depends on the real market's fares fails here.
func CityConfigFixture(cityID string, version int) map[string]any {
	return map[string]any{
		"cityId":                 cityID,
		"version":                version,
		"currency":               "NGN",
		"currencyFractionDigits": 2,
		"locale":                 "en-NG",
		"timezone":               "Africa/Lagos",
		"emergencyNumber":        "112",
		"vehicleClasses":         []string{"go", "comfort"},
		"fares": map[string]any{
			"go": map[string]any{
				"baseMinor":       10_000,
				"perKmMinor":      5_000,
				"perMinMinor":     1_000,
				"bookingFeeMinor": 2_000,
				"minFareMinor":    50_000,
			},
			"comfort": map[string]any{
				"baseMinor":       20_000,
				"perKmMinor":      8_000,
				"perMinMinor":     2_000,
				"bookingFeeMinor": 2_000,
				"minFareMinor":    90_000,
			},
		},
		"waitPolicy": map[string]any{"freeSec": 300, "perMinMinor": 5_000},
		"cancelPolicy": map[string]any{
			"riderFeeAfterAssignMinor": 30_000,
			"driverFeeMinor":           0,
			"freeWindowSec":            120,
		},
		"pinRequired": true,
		"quoteTtlSec": 300,
		"offerTtlSec": 12,
		"matchingRings": []map[string]any{
			{"radiusMeters": 2_000, "maxCandidates": 5},
			{"radiusMeters": 4_000, "maxCandidates": 8},
		},
		"arrivedGeofenceMeters": 150,
		"maxPinAttempts":        3,
		"paymentMethods": []map[string]any{
			{"id": "cash", "available": true},
			{"id": "wallet", "available": true},
			{"id": "card", "available": false, "reason": "no acquirer in this city yet"},
		},
		"kycTiers": []map[string]any{
			{"tier": "tier0", "dailyOutMinor": 0, "singleTransferMinor": 0, "balanceCapMinor": 5_000_000},
		},
		"serviceFeePct":             20,
		"remittanceCapMinor":        5_000_000,
		"reservationFreeReleaseSec": 900,
		"airport": map[string]any{
			"codes":            []string{"LOS"},
			"arrivalBufferMin": 20, "checkInCutoffMin": 90, "trafficBufferMin": 45,
			"doors": map[string]any{"international_arrivals": "Arrivals Door C"},
		},
		"taxes": map[string]any{"vat": 7.5},
	}
}

// PickupFixture is the reference pickup point used across the ride tests.
func PickupFixture() domain.Place {
	return domain.Place{Lat: 6.5244, Lng: 3.3792, Address: "Test pickup"}
}

// DropoffFixture is roughly 5 km from PickupFixture.
func DropoffFixture() domain.Place {
	return domain.Place{Lat: 6.5694, Lng: 3.3792, Address: "Test dropoff"}
}

// LocationPointFixture builds a plausible location report.
func LocationPointFixture(seq int64, place domain.Place, at time.Time) domain.LocationPoint {
	return domain.LocationPoint{
		Seq:        seq,
		Lat:        place.Lat,
		Lng:        place.Lng,
		AccuracyM:  8,
		RecordedAt: at,
	}
}
