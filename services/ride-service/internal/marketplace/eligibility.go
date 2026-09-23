package marketplace

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// Eligibility reason codes — the Go port of MP_ELIGIBILITY_REASONS in
// packages/contracts/src/marketplace.ts. The driver app renders these
// verbatim; it never computes eligibility locally.
const (
	ReasonOutsideRadius         = "OUTSIDE_RADIUS"
	ReasonPickupEtaTooLong      = "PICKUP_ETA_TOO_LONG"
	ReasonLocationStale         = "LOCATION_STALE"
	ReasonLocationInaccurate    = "LOCATION_INACCURATE"
	ReasonNotStationary         = "NOT_STATIONARY"
	ReasonNotNearCompletion     = "NOT_NEAR_COMPLETION"
	ReasonWrongDirection        = "WRONG_DIRECTION"
	ReasonSlotFull              = "SLOT_FULL"
	ReasonQueueDisabled         = "QUEUE_DISABLED"
	ReasonUnsupportedCapability = "UNSUPPORTED_CAPABILITY"
	ReasonAccountNotEligible    = "ACCOUNT_NOT_ELIGIBLE"
	ReasonOffline               = "OFFLINE"
	ReasonInsufficientSpendable = "INSUFFICIENT_SPENDABLE"
	ReasonRoutingUnavailable    = "ROUTING_UNAVAILABLE"
	// Advance reservations (A03).
	ReasonCalendarConflict = "CALENDAR_CONFLICT"
	ReasonAdvanceDisabled  = "ADVANCE_DISABLED"
)

// reasonWords gives every code its human title and detail once, so the same
// refusal reads the same everywhere.
func reason(code string) EligibilityReasonView {
	switch code {
	case ReasonOutsideRadius:
		return EligibilityReasonView{code, "Too far from the pickup", "You are outside this request's search area."}
	case ReasonPickupEtaTooLong:
		return EligibilityReasonView{code, "Pickup would take too long", "Your estimated arrival exceeds the request's pickup budget."}
	case ReasonLocationStale:
		return EligibilityReasonView{code, "Location not fresh", "We have no recent location fix for you. Keep the app reporting your position."}
	case ReasonLocationInaccurate:
		return EligibilityReasonView{code, "Location not precise enough", "Your last fix is too imprecise to place your vehicle."}
	case ReasonNotStationary:
		return EligibilityReasonView{code, "Vehicle not parked", "Interactive bidding opens only while you are safely parked."}
	case ReasonNotNearCompletion:
		return EligibilityReasonView{code, "Current trip not finishing yet", "Your current job has too much time left for a queued bid."}
	case ReasonWrongDirection:
		return EligibilityReasonView{code, "Wrong direction", "This pickup is not along your current trip's direction."}
	case ReasonSlotFull:
		return EligibilityReasonView{code, "No free slot", "You already hold the maximum of one current and one queued job."}
	case ReasonQueueDisabled:
		return EligibilityReasonView{code, "Queued bidding unavailable", "Queued next-job bidding is not enabled here."}
	case ReasonUnsupportedCapability:
		return EligibilityReasonView{code, "Vehicle or city mismatch", "This request needs a capability your profile does not offer."}
	case ReasonAccountNotEligible:
		return EligibilityReasonView{code, "Account not eligible", "Your account cannot take marketplace work right now."}
	case ReasonOffline:
		return EligibilityReasonView{code, "You are offline", "Go online to see and bid on marketplace requests."}
	case ReasonInsufficientSpendable:
		return EligibilityReasonView{code, "Wallet balance too low", "Your spendable balance does not cover the 10% commission hold."}
	case ReasonRoutingUnavailable:
		return EligibilityReasonView{code, "Route check unavailable", "We could not verify your route to this pickup. Try again shortly."}
	case ReasonCalendarConflict:
		return EligibilityReasonView{code, "Clashes with your bookings", "This pickup window, the trip and the travel to or from your other advance bookings would overlap."}
	case ReasonAdvanceDisabled:
		return EligibilityReasonView{code, "Advance bookings unavailable", "Bidding on future pickups is not enabled here."}
	default:
		return EligibilityReasonView{code, code, code}
	}
}

// EvaluateEligibility is the ONE server-owned eligibility function, used by
// the feed, the driver view, bid submission and (in the following slice)
// selection and promotion. It never invents an ETA: missing or stale inputs
// make the driver NOT eligible with the honest reason.
func (s *Service) EvaluateEligibility(ctx context.Context, actor Actor, request *Request, config *cityconfig.CityConfig, policy *cityconfig.MarketplacePolicy) (*EligibilityView, error) {
	now := s.now()
	result := &EligibilityView{
		// An empty list, never null: the contract's reasons is an array.
		Reasons:       []EligibilityReasonView{},
		PolicyVersion: policy.PolicyVersion,
		EvaluatedAt:   now,
	}
	refuse := func(codes ...string) *EligibilityView {
		for _, code := range codes {
			result.Reasons = append(result.Reasons, reason(code))
		}
		result.Eligible = false
		return result
	}

	// C08: a driver under an in-effect standing suspension is not eligible
	// for any marketplace work — checked before anything else, the same way
	// ReasonOffline short-circuits below. The suspension is admin-owned,
	// audited and appealable (see standing.go); nothing here can lift it.
	blocked, err := s.driverBlocked(ctx, actor.UserID)
	if err != nil {
		return nil, asDomainError(err)
	}
	if blocked {
		return refuse(ReasonAccountNotEligible), nil
	}

	epoch, err := s.deps.Store.AvailabilityEpoch(ctx, s.deps.Store.Pool(), actor.UserID)
	if err != nil {
		return nil, asDomainError(err)
	}
	result.AvailabilityEpoch = epoch

	session, err := s.deps.Store.DriverSessionRow(ctx, s.deps.Store.Pool(), actor.UserID)
	if errors.Is(err, domain.ErrNotFound) {
		return refuse(ReasonOffline), nil
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	if session.State == machine.DriverOffline {
		return refuse(ReasonOffline), nil
	}
	if session.CityID != request.CityID {
		return refuse(ReasonUnsupportedCapability), nil
	}
	if !session.Offers(request.VehicleClass) {
		return refuse(ReasonUnsupportedCapability), nil
	}

	// Location freshness and accuracy gate every branch. A clock that claims
	// the future is as untrustworthy as one from an hour ago.
	stationary := policy.Stationary
	if !session.HasLocation() {
		return refuse(ReasonLocationStale), nil
	}
	fixAge := now.Sub(*session.LastLocationAt)
	if fixAge < -time.Minute || fixAge > time.Duration(stationary.MaxLocationAgeSec)*time.Second {
		return refuse(ReasonLocationStale), nil
	}
	if session.LastAccuracyM == nil || *session.LastAccuracyM <= 0 || *session.LastAccuracyM > float64(stationary.MaxAccuracyMeters) {
		return refuse(ReasonLocationInaccurate), nil
	}

	// A03: an advance-booking request is judged against the driver's
	// booking calendar, not their live slots — a future booking never
	// occupies today's current/next queue.
	if request.isAdvance() {
		return s.evaluateAdvance(ctx, actor, request, policy, result, refuse, now)
	}

	currentClaim, err := s.deps.Store.CurrentClaim(ctx, s.deps.Store.Pool(), actor.UserID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, asDomainError(err)
	}

	if currentClaim == nil {
		return s.evaluateImmediate(ctx, actor, request, policy, session, result, refuse, now)
	}
	return s.evaluateFinishingTrip(ctx, actor, request, policy, session, currentClaim, result, refuse, now)
}

type refuseFunc func(codes ...string) *EligibilityView

// evaluateImmediate is the parked, no-current-work branch: slot = current.
func (s *Service) evaluateImmediate(
	ctx context.Context,
	actor Actor,
	request *Request,
	policy *cityconfig.MarketplacePolicy,
	session *domain.DriverSession,
	result *EligibilityView,
	refuse refuseFunc,
	now time.Time,
) (*EligibilityView, error) {
	if ok, code := s.stationaryVerdict(ctx, actor.UserID, policy.Stationary, now); !ok {
		return refuse(code), nil
	}

	distance := geo.HaversineDistance(*session.LastLat, *session.LastLng, request.Pickup.Lat, request.Pickup.Lng)
	if distance > float64(request.EnvelopeRadiusM) {
		return refuse(ReasonOutsideRadius), nil
	}

	leg, err := s.routeLeg(ctx, *session.LastLat, *session.LastLng, request.Pickup.Lat, request.Pickup.Lng)
	if err != nil {
		return refuse(ReasonRoutingUnavailable), nil
	}
	eta := leg.DurationSeconds
	if eta > int64(request.EnvelopeEtaSec) {
		return refuse(ReasonPickupEtaTooLong), nil
	}

	slot := SlotCurrent
	result.Eligible = true
	result.Slot = &slot
	// The routed leg IS the pickup: the time until pickup and the unpaid
	// drive coincide on the immediate branch.
	result.setPredictedPickup(eta, PickupBasisRoutedLeg, pickupEstimate{
		distanceM:     float64(leg.DistanceMeters),
		distanceBasis: PickupBasisRouted,
		durationSec:   eta,
		durationBasis: PickupBasisRoutedLeg,
	})
	return result, nil
}

// evaluateFinishingTrip is the queued next-job branch (M05A): a driver whose
// current job is nearly done may bid for a dependent next job, if the vertical
// is open and the geometry works out.
func (s *Service) evaluateFinishingTrip(
	ctx context.Context,
	actor Actor,
	request *Request,
	policy *cityconfig.MarketplacePolicy,
	session *domain.DriverSession,
	currentClaim *Claim,
	result *EligibilityView,
	refuse refuseFunc,
	now time.Time,
) (*EligibilityView, error) {
	if !s.queueEnabled(ctx, actor, request.CityID) {
		return refuse(ReasonSlotFull, ReasonQueueDisabled), nil
	}
	if nextClaim, err := s.deps.Store.NextClaim(ctx, s.deps.Store.Pool(), actor.UserID); err == nil && nextClaim != nil {
		return refuse(ReasonSlotFull), nil
	} else if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, asDomainError(err)
	}

	if currentClaim.ExecutionID == nil {
		// A claim with no execution yet (award still settling) has no live
		// route to reason about; there is nothing honest to predict.
		return refuse(ReasonNotNearCompletion), nil
	}
	ride, err := s.deps.Store.ExecutionRideRow(ctx, s.deps.Store.Pool(), *currentClaim.ExecutionID)
	if errors.Is(err, domain.ErrNotFound) {
		return refuse(ReasonRoutingUnavailable), nil
	}
	if err != nil {
		return nil, asDomainError(err)
	}

	finishing := policy.FinishingTrip

	// Remaining service time: live position → the current trip's dropoff.
	// A multi-stop trip counts every stop the server has not seen finished
	// (server-authoritative stop events; an unreported stop is still ahead)
	// with its expected dwell, so the queued rider's window is never
	// understated.
	var remaining int64
	if ride.StopCount > 0 {
		var end Area
		remaining, end, err = s.remainingTripSeconds(ctx, ride, *session.LastLat, *session.LastLng)
		if err != nil {
			return refuse(ReasonRoutingUnavailable), nil
		}
		ride.DropoffLat, ride.DropoffLng = end.Lat, end.Lng
	} else if remaining, err = s.routeSeconds(ctx, *session.LastLat, *session.LastLng, ride.DropoffLat, ride.DropoffLng); err != nil {
		return refuse(ReasonRoutingUnavailable), nil
	}
	if remaining > int64(finishing.MaxRemainingSec) {
		return refuse(ReasonNotNearCompletion), nil
	}

	// Post-dropoff leg: the current dropoff → the new pickup, against the
	// request's envelope.
	hop := geo.HaversineDistance(ride.DropoffLat, ride.DropoffLng, request.Pickup.Lat, request.Pickup.Lng)
	if hop > float64(request.EnvelopeRadiusM) {
		return refuse(ReasonOutsideRadius), nil
	}
	hopLeg, err := s.routeLeg(ctx, ride.DropoffLat, ride.DropoffLng, request.Pickup.Lat, request.Pickup.Lng)
	if err != nil {
		return refuse(ReasonRoutingUnavailable), nil
	}
	travel := hopLeg.DurationSeconds
	if travel > int64(request.EnvelopeEtaSec) {
		return refuse(ReasonPickupEtaTooLong), nil
	}

	// Corridor: the new pickup has to lie roughly along the current trip's
	// direction, so a queued job never drags a rider backwards.
	tripBearing := geo.Bearing(ride.PickupLat, ride.PickupLng, ride.DropoffLat, ride.DropoffLng)
	hopBearing := geo.Bearing(ride.DropoffLat, ride.DropoffLng, request.Pickup.Lat, request.Pickup.Lng)
	if bearingDelta(tripBearing, hopBearing) > float64(finishing.CorridorMaxBearingDeltaDeg) {
		return refuse(ReasonWrongDirection), nil
	}

	predicted := remaining +
		int64(finishing.CompletionBufferSec) +
		travel +
		int64(finishing.UncertaintyBufferSec)

	slot := SlotNext
	result.Eligible = true
	result.Slot = &slot
	// The time until pickup includes the rest of the current (paid) trip;
	// the UNPAID pickup is only the post-dropoff hop, which is what the
	// earnings breakdown counts.
	result.setPredictedPickup(predicted, PickupBasisFinishingTrip, pickupEstimate{
		distanceM:     float64(hopLeg.DistanceMeters),
		distanceBasis: PickupBasisRouted,
		durationSec:   travel,
		durationBasis: PickupBasisRoutedLeg,
	})
	return result, nil
}

// motionVerdict classifies the driver's telemetry evidence for the parked
// attestation and the stationary gate: parked state parked_confirmed (no
// evidence of motion, fresh fix), moving (clear motion above the gate — which
// no attestation may override), or stale_location (no usable, fresh, accurate
// fix to judge by). `covered` says whether the sample ring reaches back
// across the full dwell window; `reason` is the matching eligibility reason
// code for anything short of a confirmed, covered stillness.
func (s *Service) motionVerdict(ctx context.Context, driverID uuid.UUID, policy cityconfig.StationaryPolicy, now time.Time) (state string, covered bool, reason string) {
	samples := s.deps.Redis.DriverSamples(ctx, driverID, 0)
	if len(samples) == 0 {
		return ParkedStateStale, false, ReasonLocationStale
	}

	// Newest first. The newest sample must be fresh, accurate and honest
	// about its clock; replayed or future-stamped fixes are refused.
	newest := samples[0]
	age := now.Sub(newest.RecordedAt)
	if age > time.Duration(policy.MaxLocationAgeSec)*time.Second || age < -time.Minute {
		return ParkedStateStale, false, ReasonLocationStale
	}
	if newest.AccuracyM <= 0 || newest.AccuracyM > float64(policy.MaxAccuracyMeters) {
		return ParkedStateStale, false, ReasonLocationInaccurate
	}

	// Walk back through the window the dwell must cover. Any sample moving
	// above the gate — reported or derived between consecutive fixes — is
	// clear motion, whatever the parked button says.
	windowStart := now.Add(-time.Duration(policy.MinDwellSec) * time.Second)
	previous := newest
	for index, sample := range samples {
		if sample.RecordedAt.After(now.Add(time.Minute)) {
			return ParkedStateStale, false, ReasonLocationStale
		}
		if sample.SpeedMps > policy.MaxSpeedMps {
			return ParkedStateMoving, false, ReasonNotStationary
		}
		if index > 0 {
			elapsed := previous.RecordedAt.Sub(sample.RecordedAt).Seconds()
			if elapsed > 0.5 {
				derived := geo.HaversineDistance(sample.Lat, sample.Lng, previous.Lat, previous.Lng) / elapsed
				if derived > policy.MaxSpeedMps {
					return ParkedStateMoving, false, ReasonNotStationary
				}
			}
			previous = sample
		}
		if !sample.RecordedAt.After(windowStart) {
			covered = true
			break
		}
	}
	if !covered {
		// The ring does not reach back across the dwell window: not enough
		// evidence of sustained stillness (for the GATE; the attestation ack
		// still reads parked_confirmed — no motion was seen).
		return ParkedStateConfirmed, false, ReasonNotStationary
	}
	return ParkedStateConfirmed, true, ""
}

// stationaryVerdict is the stationary gate: sustained dwell below the speed
// gate for the configured window, a fresh and accurate latest fix, AND an
// explicit parked confirmation. A confirmation cannot override telemetry that
// shows the vehicle clearly moving, and no data means NOT stationary.
func (s *Service) stationaryVerdict(ctx context.Context, driverID uuid.UUID, policy cityconfig.StationaryPolicy, now time.Time) (bool, string) {
	state, covered, reason := s.motionVerdict(ctx, driverID, policy, now)
	if state != ParkedStateConfirmed || !covered {
		return false, reason
	}
	if !s.deps.Redis.ParkedConfirmed(ctx, driverID) {
		return false, ReasonNotStationary
	}
	return true, ""
}

// routeSeconds asks the router for a leg's duration. There is no fallback
// estimate here: the caller answers ROUTING_UNAVAILABLE instead of guessing.
func (s *Service) routeSeconds(ctx context.Context, fromLat, fromLng, toLat, toLng float64) (int64, error) {
	route, err := s.routeLeg(ctx, fromLat, fromLng, toLat, toLng)
	if err != nil {
		return 0, err
	}
	return route.DurationSeconds, nil
}

// routeLeg asks the router for one leg's distance and duration, with the same
// no-fallback rule as routeSeconds.
func (s *Service) routeLeg(ctx context.Context, fromLat, fromLng, toLat, toLng float64) (move.Route, error) {
	return s.deps.Router.Route(ctx,
		domain.Place{Lat: fromLat, Lng: fromLng}, nil,
		domain.Place{Lat: toLat, Lng: toLng})
}

// setPredictedPickup records an eligible driver's pickup prediction: the
// exported, minute-coarsened time until pickup with its basis, and the
// measured unpaid leg the driver view's earnings breakdown is built from.
func (v *EligibilityView) setPredictedPickup(predictedSec int64, basis string, unpaid pickupEstimate) {
	coarse := int(coarsePickupSeconds(predictedSec))
	v.PredictedPickupSec = &coarse
	v.PredictedPickupBasis = &basis
	v.pickup = &unpaid
}

// bearingDelta is the smallest angle between two bearings, in degrees.
func bearingDelta(a, b float64) float64 {
	delta := math.Mod(math.Abs(a-b), 360)
	if delta > 180 {
		delta = 360 - delta
	}
	return delta
}

// The parked-ack states the contract defines: what the SERVER actually
// accepted, which the client adopts instead of assuming.
const (
	ParkedStateConfirmed = "parked_confirmed"
	ParkedStateMoving    = "moving"
	ParkedStateStale     = "stale_location"
)

// ConfirmParked records the driver's explicit parked confirmation with a TTL
// derived from the city's stationary policy (dwell window plus the motion
// hysteresis). The confirmation is an input to the gate, never an override:
// an attestation over clearly-moving telemetry answers `moving` (and records
// nothing), one over stale telemetry answers `stale_location`. The ack is the
// contract's parked shape: {state, availabilityEpoch, confirmedAt, expiresAt,
// ttlSeconds}.
func (s *Service) ConfirmParked(ctx context.Context, actor Actor) (*ParkedAckView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a driver can confirm they are parked")
	}
	if actor.CityID == "" {
		return nil, domain.Errorf(domain.CodeValidationFailed, "the gateway did not say which city this driver is in")
	}
	_, policy, err := s.policy(ctx, actor.CityID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	ttl := time.Duration(policy.Stationary.MinDwellSec+policy.Stationary.MotionCloseSec) * time.Second

	// What does the telemetry actually say? The server acknowledges only what
	// it accepted — a parked press cannot outvote moving samples.
	state, _, _ := s.motionVerdict(ctx, actor.UserID, policy.Stationary, now)
	if state == ParkedStateConfirmed {
		if err := s.deps.Redis.ConfirmParked(ctx, actor.UserID, ttl); err != nil {
			return nil, domain.Errorf(domain.CodeServiceUnavailable, "the parked confirmation could not be recorded").Wrap(err)
		}
	}

	epoch, err := s.deps.Store.AvailabilityEpoch(ctx, s.deps.Store.Pool(), actor.UserID)
	if err != nil {
		return nil, asDomainError(err)
	}
	return &ParkedAckView{
		State:             state,
		AvailabilityEpoch: epoch,
		ConfirmedAt:       now,
		ExpiresAt:         now.Add(ttl),
		TTLSeconds:        int(ttl / time.Second),
	}, nil
}
