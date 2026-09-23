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

// MarketplacePolicyFixture is a complete, valid marketplace policy block in
// the shape MarketplacePolicySchema defines. The numbers are test data — round
// on purpose, and never production defaults (the schema comment says so too).
func MarketplacePolicyFixture() map[string]any {
	fareBounds := map[string]any{
		"absoluteFloorMinor":    40_000,
		"costFloorMinor":        45_000,
		"floorBpsOfSuggested":   7_000,
		"ceilingBpsOfSuggested": 20_000,
	}
	rateBounds := map[string]any{
		"maxPerKmMinor":           50_000,
		"maxMinimumTripFareMinor": 500_000,
	}
	return map[string]any{
		"policyVersion":      1,
		"commissionBps":      1_000,
		"commissionRounding": "half_up",
		"fareBounds": map[string]any{
			"ride:go":      fareBounds,
			"ride:comfort": fareBounds,
			"delivery:go":  fareBounds,
		},
		"searchEnvelope": map[string]any{
			"initialRadiusMeters":   3_000,
			"maxRadiusMeters":       9_000,
			"initialPickupEtaSec":   600,
			"maxPickupEtaSec":       1_500,
			"expandAfterSec":        30,
			"minOffersBeforeExpand": 2,
			"expansionSteps":        3,
		},
		"stationary": map[string]any{
			"minDwellSec":       60,
			"maxSpeedMps":       1.5,
			"maxLocationAgeSec": 120,
			"maxAccuracyMeters": 50,
			"motionCloseSec":    20,
		},
		"finishingTrip": map[string]any{
			"maxRemainingSec":            600,
			"completionBufferSec":        120,
			"uncertaintyBufferSec":       60,
			"corridorMaxBearingDeltaDeg": 90,
		},
		"bids": map[string]any{
			"bidExpirySec":                120,
			"requestExpirySec":            600,
			"revisionCooldownSec":         15,
			"maxLiveBidsPerDriver":        3,
			"maxOpenRequestsPerRequester": 2,
		},
		"queue": map[string]any{
			"pickupWindowToleranceSec": 300,
		},
		// The pilot stop limits, stated, plus paid stop waiting (A02): 10.00
		// a started minute past a stop's included allowance, 50.00 authorized
		// up front per trip (and per rider approval), excessive after 15 min.
		"stops": map[string]any{
			"maxIntermediateStops": 3,
			"defaultDwellSec":      120,
			"maxDwellSec":          600,
			"paidWaiting": map[string]any{
				"perMinMinor":        1_000,
				"maxAuthorizedMinor": 5_000,
				"excessiveAfterSec":  900,
			},
			"amendmentApprovalSec": 180,
		},
		"rateProfileBounds": map[string]any{
			"ride:go":      rateBounds,
			"ride:comfort": rateBounds,
			"delivery:go":  rateBounds,
		},
		// Book for Later (A03). Test data: every product is still dark until
		// a test opens its deny-by-default flag.
		"scheduling": SchedulingPolicyFixture(),
	}
}

// SchedulingPolicyFixture is a complete, valid Book for Later block in the
// shape MpSchedulingPolicySchema defines: publish 30 min before a scheduled
// pickup; advance bookings up to 7 days ahead (at least 3 h), rider funding
// secured within 48 h of pickup and by 2 h before, reconfirmation between
// 2 h and 45 min before, activation 30 min before, 10-min buffers; recurring
// occurrences generated 7 days ahead.
func SchedulingPolicyFixture() map[string]any {
	return map[string]any{
		"scheduledRequests": map[string]any{
			"publishLeadSec":         1_800,
			"minLeadSec":             3_600,
			"maxHorizonSec":          1_209_600,
			"defaultWindowSec":       600,
			"minWindowSec":           300,
			"maxWindowSec":           1_800,
			"reminderOffsetsSec":     []int{43_200, 3_600},
			"maxPendingPerRequester": 10,
		},
		"advanceReservations": map[string]any{
			"bookingHorizonSec":    604_800,
			"minLeadSec":           10_800,
			"offerWindowSec":       3_600,
			"bidExpirySec":         3_600,
			"defaultWindowSec":     600,
			"minWindowSec":         300,
			"maxWindowSec":         1_800,
			"fundingHorizonSec":    172_800,
			"fundingDeadlineSec":   7_200,
			"reconfirmOpensSec":    7_200,
			"reconfirmDeadlineSec": 2_700,
			"activationLeadSec":    1_800,
			"preBufferSec":         600,
			"postBufferSec":        600,
			"reminderOffsetsSec":   []int{43_200, 3_600},
			"maxOpenPerRequester":  5,
			// A05: a booking at risk must be resolved by the earlier of its
			// reconfirmation deadline and activation minus 30 minutes.
			"riskResolutionLeadSec": 1_800,
		},
		"recurring": map[string]any{
			"generationHorizonDays":          7,
			"maxActiveTemplatesPerRequester": 5,
			"maxSeriesDays":                  366,
		},
	}
}

// MarketplaceCityConfigFixture is the city fixture with the marketplace block
// attached, for harness cities that carry a marketplace policy.
func MarketplaceCityConfigFixture(cityID string, version int) map[string]any {
	config := CityConfigFixture(cityID, version)
	config["marketplace"] = MarketplacePolicyFixture()
	return config
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
