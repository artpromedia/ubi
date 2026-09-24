package marketplace

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// ---------------------------------------------------------------------------
// Server-authoritative per-stop events on a multi-stop execution (A02 item 7).
//
// Every stop event is decided by the server from its own evidence and clock:
// arrival is geofenced against the driver's last ACCEPTED position (the same
// rule pickup arrival follows), with the fix's GPS accuracy as tolerance; a
// driver the fence cannot confirm may record a DISPUTED arrival, which never
// starts the paid-waiting clock. Waiting is measured from server timestamps
// (the confirmed arrival to the departure), never from a counter a client
// feeds, so a replay after a reconnect or a process restart recomputes the
// same number and cannot double-accrue. The milestones — waiting started,
// included allowance consumed, paid waiting accruing, rider approval
// required at the cap, excessive waiting — are published once each, stamped
// with the moment they happened, under deterministic outbox keys.
//
// Paid waiting settles through the SAME linked-adjustment path as an
// amendment (a stop_waiting adjustment: commission increment captured once,
// rider top-up committed, agreed fare raised), so the receipt is the agreed
// fare plus committed adjustments and the 10% is never charged twice.
// Today's PICKUP wait fee (move.Complete) is different: it is written onto
// the ride row but a marketplace settlement settles the agreed fare, so
// pickup waiting is not charged on marketplace trips. Stop waiting does not
// copy that gap — it is charged only through the committed adjustment, and
// only up to what the rider authorized.
// ---------------------------------------------------------------------------

// StopArriveRequest is the body of POST .../stops/{stopId}/arrive.
type StopArriveRequest struct {
	// Disputed records the arrival even though the server cannot confirm
	// the driver inside the stop's geofence (GPS drift, a stale fix). A
	// disputed arrival never starts paid waiting; a later arrival call from
	// inside the fence confirms it and starts the clock then.
	Disputed bool `json:"disputed,omitempty"`
}

// StopSkipRequest is the body of POST .../stops/{stopId}/skip.
type StopSkipRequest struct {
	Reason string `json:"reason,omitempty"`
}

// WaitingApprovalRequest is the rider's approval to wait past the agreed
// cap, bound to the cap revision they saw.
type WaitingApprovalRequest struct {
	CapRevision int `json:"capRevision"`
}

// TerminateTripRequest is the body of POST .../terminate: a safe early end of
// the journey at the vehicle's current position.
type TerminateTripRequest struct {
	Reason               string `json:"reason,omitempty"`
	ExpectedFareRevision int    `json:"expectedFareRevision"`
}

// stopRef is what a stop POST stores as its idempotent response.
type stopRef struct {
	StopID uuid.UUID `json:"stopId"`
}

// stopWaiting is one stop's waiting, computed from server timestamps.
type stopWaiting struct {
	waitedSec        int64
	includedSec      int64
	paidSec          int64
	uncappedMinor    int64
	feeMinor         int64
	remainingCap     int64
	approvalRequired bool
	excessive        bool
	allowanceEndsAt  *time.Time
	capExceededAt    *time.Time
	excessiveAt      *time.Time
}

// waitingOf measures a stop's waiting up to `end`: nothing before a CONFIRMED
// arrival; the stop's priced dwell is the included allowance; each started
// minute past it costs the published rate, up to the remaining authorized
// cap. Beyond the cap nothing accrues without the rider's approval.
func waitingOf(stop *ExecutionStop, terms WaitingTerms, remainingCap int64, end time.Time) stopWaiting {
	result := stopWaiting{includedSec: int64(stop.DwellSec), remainingCap: remainingCap}
	if stop.WaitStartedAt == nil {
		return result
	}
	started := *stop.WaitStartedAt
	waited := int64(end.Sub(started) / time.Second)
	if waited < 0 {
		waited = 0
	}
	result.waitedSec = waited
	allowanceEnds := started.Add(time.Duration(stop.DwellSec) * time.Second)
	result.allowanceEndsAt = &allowanceEnds
	if terms.ExcessiveAfterSec > 0 {
		excessiveAt := started.Add(time.Duration(terms.ExcessiveAfterSec) * time.Second)
		result.excessiveAt = &excessiveAt
		result.excessive = waited >= int64(terms.ExcessiveAfterSec)
	}
	billable := waited - int64(stop.DwellSec)
	if billable <= 0 || terms.PerMinMinor <= 0 {
		return result
	}
	result.paidSec = billable
	minutes := (billable + 59) / 60
	result.uncappedMinor = minutes * terms.PerMinMinor
	result.feeMinor = result.uncappedMinor
	if remainingCap < 0 {
		remainingCap = 0
	}
	if result.feeMinor > remainingCap {
		result.feeMinor = remainingCap
		result.approvalRequired = true
	}
	// The cap is exceeded once ceil(t/60)·rate > cap, i.e. from
	// floor(cap/rate) whole minutes past the allowance.
	capAt := allowanceEnds.Add(time.Duration(remainingCap/terms.PerMinMinor) * time.Minute)
	result.capExceededAt = &capAt
	return result
}

// remainingCapFor is the paid waiting still authorized for one stop: the
// trip's cap minus what is committed and what other stops finalised but
// have not settled yet.
func remainingCapFor(route *ExecutionRoute, stops []*ExecutionStop, stopID uuid.UUID) int64 {
	remaining := route.WaitingCapMinor - route.WaitingCommittedMinor
	for _, stop := range stops {
		if stop.StopID != stopID && stop.WaitingSettlement == waitingSettlementPending {
			remaining -= stop.WaitingFeeMinor
		}
	}
	if remaining < 0 {
		return 0
	}
	return remaining
}

// stopTrip resolves a multi-stop trip and one of its stops for a party.
func (s *Service) stopTrip(ctx context.Context, actor Actor, requestID, stopID uuid.UUID) (*tripContext, error) {
	trip, err := s.tripFor(ctx, actor, requestID, cityconfig.FlagMarketplaceMultiStop)
	if err != nil {
		return nil, err
	}
	if len(trip.route.Stops) == 0 {
		return nil, domain.Errorf(domain.CodeNotFound, "this trip has no intermediate stops")
	}
	found := false
	for _, stop := range trip.route.Stops {
		if stop.StopID == stopID {
			found = true
			break
		}
	}
	if !found {
		return nil, domain.Errorf(domain.CodeNotFound, "that stop is not on this trip")
	}
	return trip, nil
}

// stopReplay answers a replayed stop POST with the CURRENT trip view.
func (s *Service) stopReplay(ctx context.Context, actor Actor, requestID uuid.UUID, scope, key string, body any) (*TripView, bool, error) {
	if err := ValidateIdempotencyKey(key); err != nil {
		return nil, true, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scope, actor.UserID, key, body)
	if err != nil {
		return nil, true, asDomainError(err)
	}
	if replay == nil {
		return nil, false, nil
	}
	view, err := s.TripView(ctx, actor, requestID)
	return view, true, err
}

// requireRunningTrip refuses a stop event on a trip whose passenger is not
// aboard, or that already ended.
func (s *Service) requireRunningTrip(ctx context.Context, route *ExecutionRoute) error {
	ride, err := s.deps.Store.Move().RideByID(ctx, s.deps.Store.Pool(), route.ExecutionID)
	if err != nil {
		return asDomainError(err)
	}
	if route.TerminatedAt != nil || !machine.IsRiderActive(ride.State) {
		return domain.Errorf(domain.CodeNoActiveRide, "this trip is no longer running").
			WithDetails(map[string]any{"rideState": ride.State})
	}
	if !pickedUp(ride.State) {
		return domain.Errorf(domain.CodeIllegalTransition,
			"stops are reached after the pickup; start the trip first").
			WithDetails(map[string]any{"rideState": ride.State})
	}
	return nil
}

// ArriveAtStop records the driver's arrival at a stop, server-authoritative.
func (s *Service) ArriveAtStop(ctx context.Context, actor Actor, requestID, stopID uuid.UUID, req StopArriveRequest, idempotencyKey string) (*TripView, error) {
	body := map[string]any{"stopId": stopID.String(), "arrive": req}
	if view, done, err := s.stopReplay(ctx, actor, requestID, scopeStopArrive, idempotencyKey, body); done {
		return view, err
	}
	trip, err := s.stopTrip(ctx, actor, requestID, stopID)
	if err != nil {
		return nil, err
	}
	if trip.role != partyDriver {
		return nil, domain.Errorf(domain.CodeForbidden, "only the awarded driver reports arrival at a stop")
	}
	if err := s.requireRunningTrip(ctx, trip.route); err != nil {
		return nil, err
	}
	terms := trip.route.WaitingTerms

	// The evidence, read before any transaction: the driver's last accepted
	// position, its age and its accuracy.
	session, err := s.deps.Store.DriverSessionRow(ctx, s.deps.Store.Pool(), actor.UserID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, asDomainError(err)
	}
	now := s.now()
	var target RouteStop
	for _, stop := range trip.route.Stops {
		if stop.StopID == stopID {
			target = stop
		}
	}
	evidence := map[string]any{"geofenceMeters": terms.GeofenceMeters, "stopId": stopID.String()}
	confirmed := false
	var distance *int
	var accuracy *float64
	switch {
	case session == nil || !session.HasLocation():
		evidence["reason"] = "position_unknown"
	case now.Sub(*session.LastLocationAt) > time.Duration(terms.LocationMaxAgeSec)*time.Second:
		evidence["reason"] = "position_stale"
		evidence["positionAgeSec"] = int(now.Sub(*session.LastLocationAt) / time.Second)
	default:
		meters := int(geo.HaversineDistance(*session.LastLat, *session.LastLng, target.Lat, target.Lng))
		distance = &meters
		evidence["distanceMeters"] = meters
		tolerance := 0.0
		if session.LastAccuracyM != nil {
			accuracy = session.LastAccuracyM
			tolerance = *session.LastAccuracyM
			evidence["accuracyMeters"] = *session.LastAccuracyM
		}
		if tolerance > float64(terms.MaxAccuracyMeters) {
			evidence["reason"] = "position_inaccurate"
		} else if float64(meters) <= float64(terms.GeofenceMeters)+tolerance {
			confirmed = true
		} else {
			evidence["reason"] = "not_at_stop"
			evidence["toleranceMeters"] = int(tolerance)
		}
	}
	if !confirmed && !req.Disputed {
		return nil, domain.Errorf(domain.CodeNotAtPickup, "the driver is not at this stop yet").WithDetails(evidence)
	}

	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		route, err := s.deps.Store.ExecutionRouteForUpdate(ctx, tx, trip.route.AwardID)
		if err != nil {
			return err
		}
		stops, err := s.deps.Store.ExecutionStopsForUpdate(ctx, tx, route.AwardID)
		if err != nil {
			return err
		}
		var stop *ExecutionStop
		for _, candidate := range stops {
			if candidate.StopID == stopID {
				stop = candidate
			}
		}
		if stop == nil || stop.State == StopStateRemoved {
			return domain.Errorf(domain.CodeNotFound, "that stop is not on this trip")
		}
		switch stop.State {
		case StopStateArrived:
			if !stop.ArrivalDisputed || !confirmed {
				// A replay (or a disputed arrival still unconfirmed): the
				// arrival stands as recorded; nothing new happened.
				break
			}
			stop.ArrivalDisputed = false
			stop.WaitStartedAt = &now
			stop.ArrivalDistanceM, stop.ArrivalAccuracyM = distance, accuracy
			if err := s.deps.Store.UpsertExecutionStop(ctx, tx, stop); err != nil {
				return err
			}
			if err := s.writeStopEvent(ctx, tx, route, stop, "mp.stop.arrived", actor, now, "confirmed",
				map[string]any{"confirmed": true, "distanceMeters": derefInt(distance)}); err != nil {
				return err
			}
			if err := s.writeStopEvent(ctx, tx, route, stop, "mp.stop.waiting_started", actor, now, "",
				waitingStartedPayload(stop, route)); err != nil {
				return err
			}
		case StopStatePending:
			for _, earlier := range stops {
				if earlier.StopID == stop.StopID || earlier.State == StopStateRemoved {
					continue
				}
				if earlier.State == StopStateArrived || (earlier.Order < stop.Order && earlier.State == StopStatePending) {
					return domain.Errorf(domain.CodeConflict, "finish (or skip) the earlier stop first").
						WithDetails(map[string]any{"reason": "earlier_stop_open", "stopId": earlier.StopID.String(), "stopState": earlier.State})
				}
			}
			stop.State = StopStateArrived
			stop.ArrivedAt = &now
			stop.ArrivalDistanceM, stop.ArrivalAccuracyM = distance, accuracy
			if confirmed {
				stop.WaitStartedAt = &now
			} else {
				stop.ArrivalDisputed = true
			}
			if err := s.deps.Store.UpsertExecutionStop(ctx, tx, stop); err != nil {
				return err
			}
			if confirmed {
				if err := s.writeStopEvent(ctx, tx, route, stop, "mp.stop.arrived", actor, now, "",
					map[string]any{"confirmed": true, "distanceMeters": derefInt(distance)}); err != nil {
					return err
				}
				if err := s.writeStopEvent(ctx, tx, route, stop, "mp.stop.waiting_started", actor, now, "",
					waitingStartedPayload(stop, route)); err != nil {
					return err
				}
			} else {
				if err := s.writeStopEvent(ctx, tx, route, stop, "mp.stop.arrival_disputed", actor, now, "", evidence); err != nil {
					return err
				}
				if err := writeAudit(ctx, tx, AuditRecord{
					ActorID: actor.UserID.String(), ActorRole: actor.Role, Action: "mp.stop.arrival_disputed",
					SubjectType: subjectAward, SubjectID: route.AwardID.String(),
					After:  map[string]any{"stopId": stop.StopID.String(), "evidence": evidence},
					Reason: "arrival recorded without geofence confirmation; paid waiting does not start",
				}); err != nil {
					return err
				}
			}
		default:
			return domain.Errorf(domain.CodeConflict, "this stop is already behind the trip").
				WithDetails(map[string]any{"stopState": stop.State})
		}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeStopArrive, actor.UserID, idempotencyKey, body, 200, stopRef{StopID: stopID})
	})
	if err != nil {
		return nil, asDomainError(err)
	}
	return s.TripView(ctx, actor, requestID)
}

func derefInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

// waitingStartedPayload publishes the waiting terms the clock runs under.
func waitingStartedPayload(stop *ExecutionStop, route *ExecutionRoute) map[string]any {
	return map[string]any{
		"includedSec":        stop.DwellSec,
		"perMinMinor":        route.WaitingTerms.PerMinMinor,
		"authorizedCapMinor": route.WaitingCapMinor,
		"capRevision":        route.CapRevision,
		"excessiveAfterSec":  route.WaitingTerms.ExcessiveAfterSec,
		"currency":           route.Currency,
	}
}

// DepartStop records the driver leaving a stop and finalises its waiting.
func (s *Service) DepartStop(ctx context.Context, actor Actor, requestID, stopID uuid.UUID, idempotencyKey string) (*TripView, error) {
	body := map[string]any{"stopId": stopID.String(), "depart": true}
	if view, done, err := s.stopReplay(ctx, actor, requestID, scopeStopDepart, idempotencyKey, body); done {
		return view, err
	}
	trip, err := s.stopTrip(ctx, actor, requestID, stopID)
	if err != nil {
		return nil, err
	}
	if trip.role != partyDriver {
		return nil, domain.Errorf(domain.CodeForbidden, "only the awarded driver reports departing a stop")
	}
	if err := s.requireRunningTrip(ctx, trip.route); err != nil {
		return nil, err
	}
	if err := s.finishStop(ctx, actor, trip.route.AwardID, stopID, StopStateDeparted, "", scopeStopDepart, idempotencyKey, body); err != nil {
		return nil, err
	}
	return s.TripView(ctx, actor, requestID)
}

// SkipStop drops a stop from the trip. The rider may drop any stop not yet
// left; the driver may leave a stop only once its waiting is excessive.
// Skipping never lowers the agreed fare — the stop was agreed — but waiting
// already earned at it is finalised and settled.
func (s *Service) SkipStop(ctx context.Context, actor Actor, requestID, stopID uuid.UUID, req StopSkipRequest, idempotencyKey string) (*TripView, error) {
	body := map[string]any{"stopId": stopID.String(), "skip": req}
	if view, done, err := s.stopReplay(ctx, actor, requestID, scopeStopSkip, idempotencyKey, body); done {
		return view, err
	}
	trip, err := s.stopTrip(ctx, actor, requestID, stopID)
	if err != nil {
		return nil, err
	}
	if err := s.requireRunningTrip(ctx, trip.route); err != nil {
		return nil, err
	}
	reason := strings.TrimSpace(req.Reason)
	if trip.role == partyDriver {
		reason = "excessive_waiting"
	} else if reason == "" {
		reason = "rider_request"
	}
	if len(reason) > 80 {
		reason = reason[:80]
	}
	if err := s.finishStop(ctx, actor, trip.route.AwardID, stopID, StopStateSkipped, reason, scopeStopSkip, idempotencyKey, body); err != nil {
		return nil, err
	}
	return s.TripView(ctx, actor, requestID)
}

// finishStop moves a stop to departed or skipped, finalising its waiting
// fee (capped at what the rider authorized) from server timestamps, then
// settles that fee through the amendment path.
func (s *Service) finishStop(ctx context.Context, actor Actor, awardID, stopID uuid.UUID, to, reason, scope, key string, body any) error {
	now := s.now()
	settle := false
	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		route, err := s.deps.Store.ExecutionRouteForUpdate(ctx, tx, awardID)
		if err != nil {
			return err
		}
		stops, err := s.deps.Store.ExecutionStopsForUpdate(ctx, tx, awardID)
		if err != nil {
			return err
		}
		var stop *ExecutionStop
		for _, candidate := range stops {
			if candidate.StopID == stopID {
				stop = candidate
			}
		}
		if stop == nil || stop.State == StopStateRemoved {
			return domain.Errorf(domain.CodeNotFound, "that stop is not on this trip")
		}
		if stop.State == to {
			// A replay of the same finish: the recorded outcome stands.
			return s.deps.Store.SaveIdempotent(ctx, tx, scope, actor.UserID, key, body, 200, stopRef{StopID: stopID})
		}
		waiting := waitingOf(stop, route.WaitingTerms, remainingCapFor(route, stops, stopID), now)
		excessive := waiting.excessive
		if stop.WaitStartedAt == nil && stop.ArrivedAt != nil && route.WaitingTerms.ExcessiveAfterSec > 0 {
			// A disputed arrival never earns paid waiting, but the driver who
			// stood there long enough may still leave the stop.
			excessive = now.Sub(*stop.ArrivedAt) >= time.Duration(route.WaitingTerms.ExcessiveAfterSec)*time.Second
		}
		switch {
		case to == StopStateDeparted && stop.State != StopStateArrived:
			return domain.Errorf(domain.CodeConflict, "the driver has not arrived at this stop").
				WithDetails(map[string]any{"stopState": stop.State})
		case to == StopStateSkipped && stop.State != StopStatePending && stop.State != StopStateArrived:
			return domain.Errorf(domain.CodeConflict, "this stop is already behind the trip").
				WithDetails(map[string]any{"stopState": stop.State})
		case to == StopStateSkipped && actor.IsDriver() && (stop.State != StopStateArrived || !excessive):
			return domain.Errorf(domain.CodeConflict,
				"a driver may leave a stop only after its waiting became excessive").
				WithDetails(map[string]any{"reason": "waiting_not_excessive", "stopState": stop.State,
					"waitedSec": waiting.waitedSec, "excessiveAfterSec": route.WaitingTerms.ExcessiveAfterSec})
		}
		if stop.State == StopStateArrived {
			if err := s.emitWaitingMilestones(ctx, tx, route, stop, waiting, now); err != nil {
				return err
			}
		}
		stop.State = to
		if to == StopStateDeparted {
			stop.DepartedAt = &now
		} else {
			stop.SkippedAt = &now
			stop.SkipReason = reason
		}
		stop.WaitingFeeMinor = waiting.feeMinor
		if waiting.feeMinor > 0 {
			stop.WaitingSettlement = waitingSettlementPending
			settle = true
		}
		if err := s.deps.Store.UpsertExecutionStop(ctx, tx, stop); err != nil {
			return err
		}
		name := "mp.stop.departed"
		if to == StopStateSkipped {
			name = "mp.stop.skipped"
		}
		if err := s.writeStopEvent(ctx, tx, route, stop, name, actor, now, "", map[string]any{
			"waitedSec":       waiting.waitedSec,
			"includedSec":     waiting.includedSec,
			"paidSec":         waiting.paidSec,
			"waitingFeeMinor": waiting.feeMinor,
			"reason":          reason,
		}); err != nil {
			return err
		}
		auditActor := actor.UserID.String()
		if actor.Role == partySystem {
			auditActor = "ride-service"
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: auditActor, ActorRole: actor.Role, Action: name,
			SubjectType: subjectAward, SubjectID: route.AwardID.String(),
			After: map[string]any{"stopId": stop.StopID.String(), "state": to, "waitedSec": waiting.waitedSec,
				"waitingFeeMinor": waiting.feeMinor, "currency": route.Currency, "reason": reason},
			Reason: "stop finished; any paid waiting settles as a linked adjustment",
		}); err != nil {
			return err
		}
		return s.deps.Store.SaveIdempotent(ctx, tx, scope, actor.UserID, key, body, 200, stopRef{StopID: stopID})
	})
	if err != nil {
		return asDomainError(err)
	}
	if settle {
		s.settleStopWaiting(ctx, awardID, stopID)
	}
	return nil
}

// waitingAmendmentID is the ONE adjustment a stop's waiting fee ever
// settles under, so the post-finish call and the sweep converge on it.
func waitingAmendmentID(awardID, stopID uuid.UUID) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("mp.stop_waiting|"+awardID.String()+"|"+stopID.String()))
}

// settleStopWaiting drives a finalised stop's waiting fee through the
// amendment money path. Another amendment holding open money defers it; the
// sweep retries until it settles.
func (s *Service) settleStopWaiting(ctx context.Context, awardID, stopID uuid.UUID) {
	route, err := s.deps.Store.ExecutionRouteByAward(ctx, s.deps.Store.Pool(), awardID)
	if err != nil {
		s.deps.Logger.Error().Err(err).Str("award_id", awardID.String()).Msg("stop waiting settlement could not read the trip")
		return
	}
	stops, err := s.deps.Store.ExecutionStops(ctx, s.deps.Store.Pool(), awardID)
	if err != nil {
		return
	}
	var stop *ExecutionStop
	for _, candidate := range stops {
		if candidate.StopID == stopID {
			stop = candidate
		}
	}
	if stop == nil || stop.WaitingSettlement != waitingSettlementPending || stop.WaitingFeeMinor <= 0 {
		return
	}
	if stop.WaitingAmendmentID != nil {
		// The adjustment exists: the amendment sweep drives it (with its
		// backoff); a second driver here would only hammer payment-service.
		return
	}
	id := waitingAmendmentID(awardID, stopID)
	stopRefID := stopID
	_, err = s.createSystemAdjustment(ctx, route, systemAdjustment{
		id:              id,
		kind:            AmendmentKindStopWaiting,
		revisedFare:     route.AgreedFareMinor + stop.WaitingFeeMinor,
		referenceStopID: &stopRefID,
		linkStop:        true,
		actorRole:       partySystem,
		actorID:         "ride-service",
		pricing: map[string]any{
			"waitingFeeMinor": stop.WaitingFeeMinor,
			"perMinMinor":     route.WaitingTerms.PerMinMinor,
			"includedSec":     stop.DwellSec,
			"configVersion":   route.ConfigVersion,
		},
	})
	if err != nil && !errors.Is(err, errAmendmentOpen) {
		s.deps.Logger.Warn().Err(err).Str("award_id", awardID.String()).Str("stop_id", stopID.String()).
			Msg("stop waiting settlement unresolved; the sweep will retry")
	}
}

// ApproveWaiting is the rider's explicit approval to keep paying for waiting
// past the agreed cap: the authorized cap grows by one more increment of the
// published maximum, bound to the cap revision the rider saw.
func (s *Service) ApproveWaiting(ctx context.Context, actor Actor, requestID, stopID uuid.UUID, req WaitingApprovalRequest, idempotencyKey string) (*TripView, error) {
	body := map[string]any{"stopId": stopID.String(), "approval": req}
	if view, done, err := s.stopReplay(ctx, actor, requestID, scopeStopWaitApproval, idempotencyKey, body); done {
		return view, err
	}
	trip, err := s.stopTrip(ctx, actor, requestID, stopID)
	if err != nil {
		return nil, err
	}
	if trip.role != partyRider {
		return nil, domain.Errorf(domain.CodeForbidden, "only the rider can approve more paid waiting")
	}
	terms := trip.route.WaitingTerms
	if terms.PerMinMinor <= 0 || terms.MaxAuthorizedMinor <= 0 {
		return nil, domain.Errorf(domain.CodeConflict, "paid stop waiting is not offered in this market").
			WithDetails(map[string]any{"reason": "paid_waiting_unavailable"})
	}
	now := s.now()
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		route, err := s.deps.Store.ExecutionRouteForUpdate(ctx, tx, trip.route.AwardID)
		if err != nil {
			return err
		}
		if route.CapRevision != req.CapRevision {
			return domain.Errorf(domain.CodeVersionConflict, "the waiting authorization changed; review it again").
				WithDetails(map[string]any{"refreshedTerms": map[string]any{
					"capRevision":        route.CapRevision,
					"authorizedCapMinor": money(route.WaitingCapMinor, route.Currency),
				}})
		}
		stops, err := s.deps.Store.ExecutionStopsForUpdate(ctx, tx, route.AwardID)
		if err != nil {
			return err
		}
		var stop *ExecutionStop
		for _, candidate := range stops {
			if candidate.StopID == stopID {
				stop = candidate
			}
		}
		if stop == nil || stop.State != StopStateArrived {
			return domain.Errorf(domain.CodeConflict, "the driver is not waiting at this stop").
				WithDetails(map[string]any{"reason": "not_waiting"})
		}
		next := *route
		next.WaitingCapMinor += terms.MaxAuthorizedMinor
		next.CapRevision++
		saved, err := s.deps.Store.SaveExecutionRoute(ctx, tx, &next)
		if err != nil {
			return err
		}
		if err := s.writeStopEvent(ctx, tx, saved, stop, "mp.stop.waiting_approved", actor, now, itoa(saved.CapRevision), map[string]any{
			"authorizedCapMinor": saved.WaitingCapMinor,
			"capRevision":        saved.CapRevision,
			"currency":           saved.Currency,
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role, Action: "mp.stop.waiting_approved",
			SubjectType: subjectAward, SubjectID: saved.AwardID.String(),
			Before: map[string]any{"authorizedCapMinor": route.WaitingCapMinor, "capRevision": route.CapRevision},
			After:  map[string]any{"authorizedCapMinor": saved.WaitingCapMinor, "capRevision": saved.CapRevision, "stopId": stopID.String()},
			Reason: "the rider explicitly approved paid waiting beyond the agreed cap",
		}); err != nil {
			return err
		}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeStopWaitApproval, actor.UserID, idempotencyKey, body, 200, stopRef{StopID: stopID})
	})
	if err != nil {
		return nil, asDomainError(err)
	}
	return s.TripView(ctx, actor, requestID)
}

// TerminateTrip ends a running journey early and safely at the vehicle's
// current position: the stops never reached are skipped, the stop being
// waited at is closed with its earned waiting, and the fare drops by the
// unvisited remainder priced under the award's snapshot (never below the
// travelled route's server floor). It settles as one early_termination
// adjustment through the same linked path — the 10% moves only by the
// difference. A driver must be parked and give a safety reason; the rider
// may end their own trip. The driver then completes the ride as usual.
func (s *Service) TerminateTrip(ctx context.Context, actor Actor, requestID uuid.UUID, req TerminateTripRequest, idempotencyKey string) (*TripView, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	// The fingerprint names the trip: the same key and body on another
	// request is a key reuse, never a false "terminated" answer.
	idemBody := map[string]any{"requestId": requestID.String(), "terminate": req}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeTripTerminate, actor.UserID, idempotencyKey, idemBody)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		view, err := s.TripView(ctx, actor, requestID)
		return view, 200, err
	}
	trip, err := s.tripFor(ctx, actor, requestID, cityconfig.FlagMarketplaceTripAmendments)
	if err != nil {
		return nil, 0, err
	}
	route := trip.route
	reason := strings.TrimSpace(req.Reason)
	if trip.role == partyDriver && !terminationAllowedReasons[reason] {
		return nil, 0, domain.Errorf(domain.CodeReasonCodeRequired, "a driver ending a trip early must give a reason").
			WithDetails(map[string]any{"reasonCodes": []string{"excessive_waiting", "rider_request", "safety_concern", "vehicle_issue"}})
	}
	if reason == "" {
		reason = "rider_request"
	}
	if len(reason) > 80 {
		reason = reason[:80]
	}
	if req.ExpectedFareRevision != route.FareRevision {
		return nil, 0, domain.Errorf(domain.CodeVersionConflict, "the trip's terms changed; review them again").
			WithDetails(tripTermsDetails(route))
	}
	ride, err := s.deps.Store.Move().RideByID(ctx, s.deps.Store.Pool(), route.ExecutionID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if route.TerminatedAt != nil || ride.State != machine.RiderInProgress {
		return nil, 0, domain.Errorf(domain.CodeConflict, "only a trip under way can end early").
			WithDetails(map[string]any{"rideState": ride.State})
	}
	if open, err := s.deps.Store.OpenAmendmentForAward(ctx, s.deps.Store.Pool(), route.AwardID); err == nil {
		return nil, 0, openAmendmentError(open)
	} else if !errors.Is(err, domain.ErrNotFound) {
		return nil, 0, asDomainError(err)
	}
	_, policy, err := s.policy(ctx, route.CityID)
	if err != nil {
		return nil, 0, err
	}
	now := s.now()
	if trip.role == partyDriver {
		if ok, code := s.stationaryVerdict(ctx, actor.UserID, policy.Stationary, now); !ok {
			return nil, 0, domain.Errorf(domain.CodeDriverIneligible, "stop safely before ending the trip").
				WithDetails(map[string]any{"reason": code})
		}
	}
	session, err := s.deps.Store.DriverSessionRow(ctx, s.deps.Store.Pool(), route.DriverID)
	if err != nil || !session.HasLocation() ||
		now.Sub(*session.LastLocationAt) > time.Duration(route.WaitingTerms.LocationMaxAgeSec)*time.Second {
		return nil, 0, domain.Errorf(domain.CodeNotAtPickup, "the vehicle's position is not fresh enough to end the trip here").
			WithDetails(map[string]any{"reason": "position_stale"})
	}
	config, _, err := s.snapshotConfig(ctx, route.CityID, route.ConfigVersion)
	if err != nil {
		return nil, 0, err
	}
	stops, err := s.deps.Store.ExecutionStops(ctx, s.deps.Store.Pool(), route.AwardID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	stateOf := map[uuid.UUID]*ExecutionStop{}
	var waitingFee int64
	var waitingStop *uuid.UUID
	for _, stop := range stops {
		stateOf[stop.StopID] = stop
		if stop.State == StopStateArrived {
			waitingFee = waitingOf(stop, route.WaitingTerms, remainingCapFor(route, stops, stop.StopID), now).feeMinor
			id := stop.StopID
			waitingStop = &id
		}
	}
	var travelled []RouteStop
	for _, stop := range route.Stops {
		if row, ok := stateOf[stop.StopID]; ok && row.visited() {
			travelled = append(travelled, stop)
		}
	}
	endPoint := Area{Label: "Trip ended early", Lat: *session.LastLat, Lng: *session.LastLng}
	price, err := s.priceRouteChange(ctx, route, config, travelled, endPoint)
	if err != nil {
		return nil, 0, err
	}
	// Ending early never raises the route part of the fare.
	revised := price.revisedFare
	if revised > route.AgreedFareMinor {
		revised = route.AgreedFareMinor
	}
	revised += waitingFee
	price.pricing["waitingFeeMinor"] = waitingFee
	price.pricing["reason"] = reason
	if waitingStop != nil {
		// The stop whose waiting this termination settles: if the driver
		// departs it while the termination is still converging, the commit
		// settles that stop's waiting here — never a second time on its own.
		price.pricing["waitingStopId"] = waitingStop.String()
	}
	adjustment, err := s.createSystemAdjustment(ctx, route, systemAdjustment{
		id:          uuid.New(),
		kind:        AmendmentKindEarlyTermination,
		revisedFare: revised,
		stops:       travelled,
		dropoff:     endPoint,
		pricing:     price.pricing,
		actorRole:   trip.role,
		actorID:     actor.UserID.String(),
		extra: func(tx pgx.Tx, amendmentID uuid.UUID) error {
			return s.deps.Store.SaveIdempotent(ctx, tx, scopeTripTerminate, actor.UserID, idempotencyKey, idemBody, 200,
				amendmentRef{AmendmentID: amendmentID})
		},
	})
	if err != nil {
		if errors.Is(err, errAmendmentOpen) {
			return nil, 0, domain.Errorf(domain.CodeConflict, "another change to this trip is still being resolved").
				WithDetails(map[string]any{"reason": "amendment_open"})
		}
		if adjustment == nil {
			return nil, 0, asDomainError(err)
		}
	}
	if adjustment != nil && adjustment.State == machine.MpAmendmentRejected && err != nil {
		return nil, 0, asDomainError(err)
	}
	view, viewErr := s.TripView(ctx, actor, requestID)
	status := 200
	if adjustment != nil && adjustment.State != machine.MpAmendmentCommitted {
		status = 202
	}
	return view, status, viewErr
}

// ---------------------------------------------------------------------------
// Waiting milestones, finishing on completion, and the sweeps.
// ---------------------------------------------------------------------------

// emitWaitingMilestones publishes, once each, every waiting milestone a stop
// has passed by `now`, stamped with the moment it happened. Keys are
// deterministic, so the sweep, a departure and a restarted process all
// converge on one event per milestone.
func (s *Service) emitWaitingMilestones(ctx context.Context, tx pgx.Tx, route *ExecutionRoute, stop *ExecutionStop, waiting stopWaiting, now time.Time) error {
	system := Actor{Role: partySystem}
	if waiting.allowanceEndsAt != nil && !now.Before(*waiting.allowanceEndsAt) && waiting.waitedSec > waiting.includedSec {
		if err := s.writeStopEvent(ctx, tx, route, stop, "mp.stop.allowance_consumed", system, *waiting.allowanceEndsAt, "",
			map[string]any{"includedSec": waiting.includedSec}); err != nil {
			return err
		}
		if route.WaitingTerms.PerMinMinor > 0 && waiting.remainingCap > 0 {
			if err := s.writeStopEvent(ctx, tx, route, stop, "mp.stop.paid_waiting_accruing", system, *waiting.allowanceEndsAt, "", map[string]any{
				"perMinMinor":        route.WaitingTerms.PerMinMinor,
				"remainingCapMinor":  waiting.remainingCap,
				"authorizedCapMinor": route.WaitingCapMinor,
				"capRevision":        route.CapRevision,
				"currency":           route.Currency,
			}); err != nil {
				return err
			}
		}
	}
	if waiting.approvalRequired && waiting.capExceededAt != nil {
		if err := s.writeStopEvent(ctx, tx, route, stop, "mp.stop.waiting_approval_required", system, *waiting.capExceededAt,
			itoa(route.CapRevision), map[string]any{
				"authorizedCapMinor": route.WaitingCapMinor,
				"capRevision":        route.CapRevision,
				"accruedMinor":       waiting.feeMinor,
				"currency":           route.Currency,
			}); err != nil {
			return err
		}
	}
	if waiting.excessive && waiting.excessiveAt != nil {
		if err := s.writeStopEvent(ctx, tx, route, stop, "mp.stop.excessive_waiting", system, *waiting.excessiveAt, "",
			map[string]any{"excessiveAfterSec": route.WaitingTerms.ExcessiveAfterSec, "waitedSec": waiting.waitedSec}); err != nil {
			return err
		}
	}
	return nil
}

// writeStopEvent appends one mp.stop.* outbox row on the award's subject.
// `discriminator` distinguishes events that may legitimately repeat for one
// stop (a confirmation after a dispute, one approval-required per cap).
func (s *Service) writeStopEvent(ctx context.Context, tx pgx.Tx, route *ExecutionRoute, stop *ExecutionStop, name string, actor Actor, at time.Time, discriminator string, extra map[string]any) error {
	payload := map[string]any{
		"awardId":     route.AwardID.String(),
		"requestId":   route.RequestID.String(),
		"requesterId": route.RequesterID.String(),
		"driverId":    route.DriverID.String(),
		"executionId": route.ExecutionID.String(),
		"stopId":      stop.StopID.String(),
		"order":       stop.Order,
		"state":       stop.State,
		"occurredAt":  at,
	}
	for key, value := range extra {
		payload[key] = value
	}
	actorType, actorID := "system", "ride-service"
	if actor.Role == partyRider || actor.Role == partyDriver {
		actorType, actorID = actor.Role, actor.UserID.String()
	}
	return writeEvent(ctx, tx, Event{
		Name:           name,
		AggregateType:  subjectAward,
		AggregateID:    route.AwardID.String(),
		ToVersion:      route.Version,
		CityID:         route.CityID,
		ActorType:      actorType,
		ActorID:        actorID,
		IdempotencyKey: eventKey(name, route.AwardID.String(), stop.StopID.String(), discriminator),
		OccurredAt:     at,
		Payload:        payload,
	})
}

// sweepStopWaiting publishes due waiting milestones for every stop being
// waited at, and settles finalised waiting fees still owed.
func (s *Service) sweepStopWaiting(ctx context.Context, now time.Time) {
	arrived, err := s.deps.Store.ArrivedStops(ctx, s.deps.Store.Pool(), sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list stops being waited at")
	} else {
		for _, stop := range arrived {
			if stop.WaitStartedAt == nil {
				continue
			}
			if err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
				route, err := s.deps.Store.ExecutionRouteForUpdate(ctx, tx, stop.AwardID)
				if err != nil {
					return err
				}
				stops, err := s.deps.Store.ExecutionStops(ctx, tx, stop.AwardID)
				if err != nil {
					return err
				}
				for _, current := range stops {
					if current.StopID == stop.StopID && current.State == StopStateArrived {
						waiting := waitingOf(current, route.WaitingTerms, remainingCapFor(route, stops, current.StopID), now)
						return s.emitWaitingMilestones(ctx, tx, route, current, waiting, now)
					}
				}
				return nil
			}); err != nil {
				s.deps.Logger.Error().Err(err).Str("stop_id", stop.StopID.String()).Msg("failed to publish waiting milestones")
			}
		}
	}
	owed, err := s.deps.Store.StopsAwaitingWaitingSettlement(ctx, s.deps.Store.Pool(), sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list unsettled stop waiting")
		return
	}
	for _, stop := range owed {
		s.settleStopWaiting(ctx, stop.AwardID, stop.StopID)
	}
}

// sweepAmendments resumes every amendment whose money is still open: stalled
// reservations and commits are re-driven under the same amendment id,
// unapproved ones past their window expire and release, rejected ones retry
// their release, failed ones compensate.
func (s *Service) sweepAmendments(ctx context.Context, now time.Time) {
	due, err := s.deps.Store.DueAmendments(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list due amendments")
		return
	}
	for _, amendment := range due {
		if (amendment.State == machine.MpAmendmentProposed || amendment.State == machine.MpAmendmentAwaiting) &&
			!amendment.bothApproved() && !now.Before(amendment.ExpiresAt) {
			if _, err := s.expireAmendment(ctx, amendment.ID, amendReasonApprovalWindow); err != nil {
				s.deps.Logger.Warn().Err(err).Str("amendment_id", amendment.ID.String()).Msg("amendment expiry unresolved")
			}
			continue
		}
		if _, err := s.advanceAmendment(ctx, amendment.ID); err != nil {
			s.deps.Logger.Warn().Err(err).Str("amendment_id", amendment.ID.String()).Msg("amendment saga unresolved")
		}
	}
}

// errTripUnsettled defers a completion settlement while an adjustment to the
// trip still has open money: settling first would settle the wrong fare.
var errTripUnsettled = errors.New("a trip adjustment is still unresolved; settlement deferred")

// settleTripAdjustments runs when an execution ends, before its settlement
// is recorded. A completed trip closes any stop still being waited at (its
// waiting ends with the trip) and settles earned waiting; any unapproved
// change expires and releases what it reserved; a change already approved
// is pushed to its outcome. If money is still open afterwards the caller
// defers the SETTLEMENT (never the claim release) and the sweep comes back
// (committedSettlement). A driver-cancelled trip only expires
// open proposals — the award's reversal hands back everything else.
func (s *Service) settleTripAdjustments(ctx context.Context, rideID uuid.UUID, completed bool) (*ExecutionRoute, error) {
	route, err := s.deps.Store.ExecutionRouteByExecution(ctx, s.deps.Store.Pool(), rideID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if completed {
		stops, err := s.deps.Store.ExecutionStops(ctx, s.deps.Store.Pool(), route.AwardID)
		if err != nil {
			return nil, err
		}
		for _, stop := range stops {
			if stop.State == StopStateArrived {
				system := Actor{Role: partySystem}
				if err := s.finishStop(ctx, system, route.AwardID, stop.StopID, StopStateDeparted, "trip_completed",
					"mp.stop.system_close", "sys-"+stop.StopID.String(), map[string]any{"stopId": stop.StopID.String()}); err != nil {
					return nil, err
				}
			}
		}
	}
	amendments, err := s.deps.Store.AmendmentsForAward(ctx, s.deps.Store.Pool(), route.AwardID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	for _, amendment := range amendments {
		if !amendment.MoneyOpen {
			continue
		}
		if amendment.StepState == amendStateUnknown && amendment.NextRetryAt != nil && now.Before(*amendment.NextRetryAt) {
			// A parked unknown outcome keeps its backoff; the settlement
			// simply waits for it.
			continue
		}
		if (amendment.State == machine.MpAmendmentProposed || amendment.State == machine.MpAmendmentAwaiting) && !amendment.bothApproved() {
			if _, err := s.expireAmendment(ctx, amendment.ID, amendReasonExecutionEnded); err != nil {
				s.deps.Logger.Warn().Err(err).Str("amendment_id", amendment.ID.String()).Msg("closing an open change at trip end is unresolved")
			}
			continue
		}
		if _, err := s.advanceAmendment(ctx, amendment.ID); err != nil {
			s.deps.Logger.Warn().Err(err).Str("amendment_id", amendment.ID.String()).Msg("resolving a change at trip end is unresolved")
		}
	}
	if completed {
		owed, err := s.deps.Store.ExecutionStops(ctx, s.deps.Store.Pool(), route.AwardID)
		if err != nil {
			return nil, err
		}
		for _, stop := range owed {
			if stop.WaitingSettlement == waitingSettlementPending {
				s.settleStopWaiting(ctx, route.AwardID, stop.StopID)
			}
		}
		if _, err := s.deps.Store.OpenAmendmentForAward(ctx, s.deps.Store.Pool(), route.AwardID); err == nil {
			return nil, errTripUnsettled
		} else if !errors.Is(err, domain.ErrNotFound) {
			return nil, err
		}
		stops, err := s.deps.Store.ExecutionStops(ctx, s.deps.Store.Pool(), route.AwardID)
		if err != nil {
			return nil, err
		}
		for _, stop := range stops {
			if stop.WaitingSettlement == waitingSettlementPending {
				return nil, errTripUnsettled
			}
		}
	}
	return s.deps.Store.ExecutionRouteByAward(ctx, s.deps.Store.Pool(), route.AwardID)
}

// committedSettlement re-derives a completion settlement at the moment it
// is driven: an award whose execution carries committed terms settles its
// COMMITTED fare (the original plus committed adjustments), and not while
// any adjustment still holds open money or a stop's finalised waiting is
// still owed to the amendment path — errTripUnsettled defers the durable
// row and the sweep comes back. An award that never amended or reported a
// stop settles its payload unchanged.
func (s *Service) committedSettlement(ctx context.Context, settle SettlementRequest) (SettlementRequest, error) {
	route, err := s.deps.Store.ExecutionRouteByAward(ctx, s.deps.Store.Pool(), settle.AwardID)
	if errors.Is(err, domain.ErrNotFound) {
		return settle, nil
	}
	if err != nil {
		return settle, err
	}
	if _, err := s.deps.Store.OpenAmendmentForAward(ctx, s.deps.Store.Pool(), route.AwardID); err == nil {
		return settle, errTripUnsettled
	} else if !errors.Is(err, domain.ErrNotFound) {
		return settle, err
	}
	stops, err := s.deps.Store.ExecutionStops(ctx, s.deps.Store.Pool(), route.AwardID)
	if err != nil {
		return settle, err
	}
	for _, stop := range stops {
		if stop.WaitingSettlement == waitingSettlementPending {
			return settle, errTripUnsettled
		}
	}
	settle.FareMinor = money(route.AgreedFareMinor, route.Currency)
	return settle, nil
}
