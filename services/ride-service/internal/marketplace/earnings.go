package marketplace

import (
	"context"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// Driver earnings breakdown (A04.1).
//
// Every driver-facing feed card and every server-generated preset carries ONE
// server-composed breakdown built only from real inputs: the gross (the
// requester's published fare, or the preset's bid amount), the 10% commission
// from CommissionMinor, the fleet remittance (none exists today — stated as an
// explicit "none", never a number), the resulting net, the unpaid pickup leg,
// the paid route (every leg through every stop, as priced) and the expected
// stop waiting. Anything that is an estimate — the pickup time, the per-hour
// figure — says so and names its inputs. No fuel or energy figure is invented:
// nothing discloses such an input, so running costs are "not estimated".
//
// Pre-award privacy: the pickup distance is coarsened to 100 m and the pickup
// time up to the whole minute, the same granularity the card's "1.2 km from
// you" line already shows, so repeated reads from different positions cannot
// triangulate an exact pickup. No coordinate or address ever enters a
// breakdown.

// Where a breakdown's gross comes from.
const (
	GrossBasisRequested = "requested_fare"
	GrossBasisPreset    = "preset_amount"
)

// Fleet remittance status. "none" is the only status today: no fleet
// arrangement applies to marketplace earnings, so nothing is remitted and the
// amount is null rather than a fabricated zero-or-guess.
const FleetRemittanceNone = "none"

// Pickup distance/time bases: what each pickup number was measured with.
const (
	PickupBasisRouted          = "routed"
	PickupBasisStraightLine    = "straight_line"
	PickupBasisRoutedLeg       = "routed_leg"
	PickupBasisFinishingTrip   = "finishing_trip_prediction"
	PickupBasisStraightLineETA = "straight_line_estimate"
	PickupBasisUnavailable     = "unavailable"
)

// RunningCostsNotEstimated is the only running-cost status: no fuel or energy
// input is disclosed anywhere, so none is estimated.
const RunningCostsNotEstimated = "not_estimated"

// The pre-award pickup granularity (see the privacy note above).
const (
	pickupDistanceGranularityM   = 100
	pickupDurationGranularitySec = 60
)

// FleetRemittanceView is the disclosed fleet share of a fare.
type FleetRemittanceView struct {
	Status      string `json:"status"`
	AmountMinor *Money `json:"amountMinor"`
	Reason      string `json:"reason"`
}

// PickupEstimateView is the unpaid drive to the pickup: coarsened, labelled an
// estimate, with the basis of each number.
type PickupEstimateView struct {
	DistanceMeters *int64 `json:"distanceMeters"`
	DistanceBasis  string `json:"distanceBasis"`
	DurationSec    *int64 `json:"durationSec"`
	DurationBasis  string `json:"durationBasis"`
	Estimate       bool   `json:"estimate"`
	Paid           bool   `json:"paid"`
	Label          string `json:"label"`
}

// PaidRouteView is the trip the fare pays for: the complete ordered route the
// request was priced on (every leg through every stop) and the expected dwell
// at its stops.
type PaidRouteView struct {
	DistanceMeters  int64  `json:"distanceMeters"`
	DurationSec     int64  `json:"durationSec"`
	StopCount       int    `json:"stopCount"`
	StopsWaitingSec int64  `json:"stopsWaitingSec"`
	Estimate        bool   `json:"estimate"`
	Label           string `json:"label"`
	WaitingLabel    string `json:"waitingLabel"`
}

// NetPerHourView is the estimated net per hour of the job's own time.
type NetPerHourView struct {
	AmountMinor Money  `json:"amountMinor"`
	Estimate    bool   `json:"estimate"`
	BasisSec    int64  `json:"basisSec"`
	Basis       string `json:"basis"`
}

// RunningCostsView states what the breakdown does NOT estimate, and why.
type RunningCostsView struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}

// EarningsBreakdownView is the server-composed earnings breakdown
// (MpEarningsBreakdownSchema). The driver app renders it; it never derives a
// commission, a net or a rate from the gross.
type EarningsBreakdownView struct {
	GrossMinor          Money               `json:"grossMinor"`
	GrossBasis          string              `json:"grossBasis"`
	CommissionMinor     Money               `json:"commissionMinor"`
	CommissionBps       int                 `json:"commissionBps"`
	FleetRemittance     FleetRemittanceView `json:"fleetRemittance"`
	EstimatedNetMinor   Money               `json:"estimatedNetMinor"`
	Pickup              PickupEstimateView  `json:"pickup"`
	Route               *PaidRouteView      `json:"route"`
	EstimatedNetPerHour *NetPerHourView     `json:"estimatedNetPerHour"`
	RunningCosts        RunningCostsView    `json:"runningCosts"`
	Disclaimer          string              `json:"disclaimer"`
}

const (
	fleetRemittanceNoneReason = "No fleet arrangement applies to marketplace jobs, so nothing from this fare is remitted to a fleet."
	runningCostsReason        = "No fuel or energy cost input is disclosed, so running costs are not estimated. Net is before your own fuel, energy and vehicle costs."
	earningsDisclaimer        = "Net = fare − 10% UBI commission − fleet remittance (none). Pickup time and net per hour are estimates, not guaranteed earnings."
)

// pickupEstimate is one pickup leg as the server measured or predicted it.
// Negative values mean "unknown"; the view renders them as null.
type pickupEstimate struct {
	distanceM     float64
	distanceBasis string
	durationSec   int64
	durationBasis string
}

func unknownPickup() pickupEstimate {
	return pickupEstimate{
		distanceM:     -1,
		distanceBasis: PickupBasisUnavailable,
		durationSec:   -1,
		durationBasis: PickupBasisUnavailable,
	}
}

// coarsePickupMeters rounds a pickup distance to the card's 100 m granularity.
func coarsePickupMeters(meters float64) int64 {
	if meters < 0 {
		return -1
	}
	steps := int64(meters/pickupDistanceGranularityM + 0.5)
	return steps * pickupDistanceGranularityM
}

// coarsePickupSeconds rounds a pickup time UP to the whole minute (an ETA that
// errs early is the one that disappoints a rider).
func coarsePickupSeconds(seconds int64) int64 {
	if seconds < 0 {
		return -1
	}
	return (seconds + pickupDurationGranularitySec - 1) / pickupDurationGranularitySec * pickupDurationGranularitySec
}

// straightLinePickup estimates a pickup leg without a routing call: the
// great-circle distance and the same urban-speed estimate the fallback router
// uses. The feed uses it because routing every card on every refresh would
// be a paid provider call per card; the basis says exactly what it is.
func (s *Service) straightLinePickup(ctx context.Context, fromLat, fromLng float64, request *Request) pickupEstimate {
	router := &move.StraightLineRouter{Now: s.deps.Now}
	route, err := router.Route(ctx,
		domain.Place{Lat: fromLat, Lng: fromLng}, nil,
		domain.Place{Lat: request.Pickup.Lat, Lng: request.Pickup.Lng})
	if err != nil {
		return unknownPickup()
	}
	return pickupEstimate{
		distanceM:     float64(route.DistanceMeters),
		distanceBasis: PickupBasisStraightLine,
		durationSec:   route.DurationSeconds,
		durationBasis: PickupBasisStraightLineETA,
	}
}

// formatMinutes phrases a whole-minute duration for a label.
func formatMinutes(seconds int64) string {
	minutes := (seconds + 59) / 60
	return "~" + itoa(int(minutes)) + " min"
}

// earningsBreakdown composes the breakdown for one gross amount. Every number
// comes from the request row, CommissionMinor or the measured/predicted
// pickup leg; the per-hour figure exists only when every time input is known.
func earningsBreakdown(request *Request, grossMinor int64, grossBasis string, pickup pickupEstimate) *EarningsBreakdownView {
	currency := request.Currency
	commission := CommissionMinor(grossMinor)
	// No fleet arrangement exists, so the remittance deducted is nothing. When
	// one lands, its disclosed amount is subtracted here and nowhere else.
	var remittance int64
	net := grossMinor - commission - remittance

	view := &EarningsBreakdownView{
		GrossMinor:      money(grossMinor, currency),
		GrossBasis:      grossBasis,
		CommissionMinor: money(commission, currency),
		CommissionBps:   commissionBps,
		FleetRemittance: FleetRemittanceView{
			Status: FleetRemittanceNone,
			Reason: fleetRemittanceNoneReason,
		},
		EstimatedNetMinor: money(net, currency),
		RunningCosts: RunningCostsView{
			Status: RunningCostsNotEstimated,
			Reason: runningCostsReason,
		},
		Disclaimer: earningsDisclaimer,
	}

	// The unpaid pickup, coarsened before it leaves the server.
	distance := coarsePickupMeters(pickup.distanceM)
	duration := coarsePickupSeconds(pickup.durationSec)
	view.Pickup = PickupEstimateView{
		DistanceBasis: pickup.distanceBasis,
		DurationBasis: pickup.durationBasis,
		Estimate:      true,
		Paid:          false,
	}
	switch {
	case distance >= 0 && duration >= 0:
		view.Pickup.DistanceMeters = &distance
		view.Pickup.DurationSec = &duration
		view.Pickup.Label = "Unpaid pickup · " + formatKm(float64(distance)) + " · " + formatMinutes(duration) + " (estimate)"
	case distance >= 0:
		view.Pickup.DistanceMeters = &distance
		view.Pickup.DurationBasis = PickupBasisUnavailable
		view.Pickup.Label = "Unpaid pickup · " + formatKm(float64(distance)) + " · time unavailable"
	default:
		view.Pickup.DistanceBasis = PickupBasisUnavailable
		view.Pickup.DurationBasis = PickupBasisUnavailable
		view.Pickup.Label = "Pickup distance unavailable without a recent location"
	}

	// The paid route: the complete ordered route the request was priced on.
	// A row written before the route metrics existed carries zeros; that is
	// "unknown", not a zero-length trip.
	if request.RoutedDistanceM > 0 {
		route := &PaidRouteView{
			DistanceMeters:  request.RoutedDistanceM,
			DurationSec:     request.RoutedDurationSec,
			StopCount:       len(request.Stops),
			StopsWaitingSec: request.StopsDwellSec,
			Estimate:        true,
			Label:           "Paid trip · " + formatKm(float64(request.RoutedDistanceM)) + " · " + formatMinutes(request.RoutedDurationSec) + " driving (estimate)",
			WaitingLabel:    "No stops",
		}
		if route.StopCount > 0 {
			route.WaitingLabel = stopCountLabel(route.StopCount) + " · " + formatMinutes(request.StopsDwellSec) + " expected waiting"
		}
		view.Route = route

		// Net per hour of the job's own time: pickup + paid route + expected
		// waiting, in the coarsened figures the driver is shown. Integer
		// arithmetic, half-up. Only when every input is known.
		if duration >= 0 {
			basis := duration + request.RoutedDurationSec + request.StopsDwellSec
			if basis > 0 && net > 0 {
				perHour := (net*3600 + basis/2) / basis
				words := "Estimate: net over pickup " + formatMinutes(duration) + " + trip " + formatMinutes(request.RoutedDurationSec)
				if request.StopsDwellSec > 0 {
					words += " + stop waiting " + formatMinutes(request.StopsDwellSec)
				}
				words += ". Excludes fuel/energy and time between jobs."
				view.EstimatedNetPerHour = &NetPerHourView{
					AmountMinor: money(perHour, currency),
					Estimate:    true,
					BasisSec:    basis,
					Basis:       words,
				}
			}
		}
	}
	return view
}
