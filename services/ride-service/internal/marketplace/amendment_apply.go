package marketplace

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// applyAmendment is the commit saga's final transaction, run only after the
// money moved: the execution's committed terms (route and route revision,
// agreed fare and fare revision, captured commission, rider funding), its
// stops and the execution ride itself are rewritten together, and the
// amendment commits. Until this transaction the original agreement stood.
func (s *Service) applyAmendment(ctx context.Context, amendment *Amendment) (bool, error) {
	now := s.now()
	committed := false
	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.AmendmentForUpdate(ctx, tx, amendment.ID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpAmendmentAwaiting || locked.Step != amendStepApply {
			return nil
		}
		route, err := s.deps.Store.ExecutionRouteForUpdate(ctx, tx, locked.AwardID)
		if err != nil {
			return err
		}
		if route.RouteRevision != locked.BaseRouteRevision || route.FareRevision != locked.BaseFareRevision {
			// One amendment with open money per award makes this unreachable;
			// if it ever happens the money already moved, so it must not be
			// dropped silently.
			return errors.New("the execution's committed terms moved under an amendment whose money already moved")
		}
		stops, err := s.deps.Store.ExecutionStopsForUpdate(ctx, tx, locked.AwardID)
		if err != nil {
			return err
		}

		next := *route
		next.FareRevision = locked.FareRevision
		next.AgreedFareMinor = locked.RevisedFareMinor
		next.CapturedCommissionMinor = locked.RevisedCommissionMinor
		next.FundedMinor = locked.RevisedFundedMinor
		waitingFee := pricingInt(locked.Pricing, "waitingFeeMinor")
		switch locked.Kind {
		case AmendmentKindStopWaiting:
			next.WaitingCommittedMinor += locked.fareDelta()
		case AmendmentKindEarlyTermination:
			next.WaitingCommittedMinor += waitingFee
			next.TerminatedAt = &now
		}
		if locked.changesRoute() {
			next.RouteRevision = locked.RouteRevision
			next.Stops = locked.Stops
			next.Dropoff = locked.Dropoff
			// The committed route's distance is the one the amendment was
			// priced on (measured when it was proposed), so the receipt
			// states the route the fare was agreed for.
			if distance := pricingInt(locked.Pricing, "proposedDistanceM"); distance > 0 {
				next.RoutedDistanceM = &distance
			}
		}
		saved, err := s.deps.Store.SaveExecutionRoute(ctx, tx, &next)
		if err != nil {
			return err
		}
		if err := s.applyStopChanges(ctx, tx, locked, route, stops, waitingFee, now); err != nil {
			return err
		}
		if err := s.amendExecutionRide(ctx, tx, locked, saved, now); err != nil {
			return err
		}
		if locked.Kind == AmendmentKindEarlyTermination {
			if err := writeEvent(ctx, tx, Event{
				Name:           "mp.trip.terminated_early",
				AggregateType:  subjectAward,
				AggregateID:    saved.AwardID.String(),
				ToVersion:      saved.Version,
				CityID:         saved.CityID,
				ActorType:      actorTypeOf(locked.ProposedByRole),
				ActorID:        locked.ProposedBy,
				IdempotencyKey: eventKey("mp.trip.terminated_early", saved.AwardID.String()),
				OccurredAt:     now,
				Payload: map[string]any{
					"awardId":         saved.AwardID.String(),
					"requestId":       saved.RequestID.String(),
					"executionId":     saved.ExecutionID.String(),
					"amendmentId":     locked.ID.String(),
					"endedBy":         locked.ProposedByRole,
					"reason":          locked.Pricing["reason"],
					"agreedFareMinor": saved.AgreedFareMinor,
					"currency":        saved.Currency,
					"dropoff":         map[string]any{"lat": saved.Dropoff.Lat, "lng": saved.Dropoff.Lng},
				},
			}); err != nil {
				return err
			}
		}

		after := *locked
		after.State = machine.MpAmendmentCommitted
		after.MoneyOpen = false
		after.ResolvedAt = &now
		after.Step, after.StepState, after.NextRetryAt, after.LastError = amendStepDone, amendStateDone, nil, ""
		final, err := s.deps.Store.SaveAmendment(ctx, tx, locked, &after)
		if err != nil {
			return err
		}
		if err := s.deps.Store.InsertAmendmentHistory(ctx, tx, AmendmentHistoryRow{
			AmendmentID: final.ID, AwardID: final.AwardID, Event: "committed",
			FromState: locked.State, ToState: final.State, ActorRole: partySystem, ActorID: "ride-service",
			RouteRevision: final.RouteRevision, FareRevision: final.FareRevision,
			Detail: map[string]any{
				"agreedFareMinor":         saved.AgreedFareMinor,
				"capturedCommissionMinor": saved.CapturedCommissionMinor,
				"fundedMinor":             saved.FundedMinor,
			},
		}); err != nil {
			return err
		}
		if err := s.writeAmendmentEvent(ctx, tx, final, "mp.amendment.committed", partySystem, "ride-service", now,
			map[string]any{"agreedFareMinor": saved.AgreedFareMinor, "routeRevisionNow": saved.RouteRevision}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: "ride-service", ActorRole: partySystem, Action: "mp.amendment.committed",
			SubjectType: subjectAmendment, SubjectID: final.ID.String(),
			Before: map[string]any{
				"agreedFareMinor": route.AgreedFareMinor, "capturedCommissionMinor": route.CapturedCommissionMinor,
				"routeRevision": route.RouteRevision, "fareRevision": route.FareRevision,
			},
			After: map[string]any{
				"kind":            final.Kind,
				"agreedFareMinor": saved.AgreedFareMinor, "capturedCommissionMinor": saved.CapturedCommissionMinor,
				"routeRevision": saved.RouteRevision, "fareRevision": saved.FareRevision,
				"currency": final.Currency,
			},
			Reason: "both sides of the change were secured; only the difference moved, linked to the award",
		}); err != nil {
			return err
		}
		committed = true
		return nil
	})
	if err != nil {
		return false, asDomainError(err)
	}
	return committed, nil
}

// actorTypeOf maps a party role onto the event envelope's actor types.
func actorTypeOf(role string) string {
	if role == partyRider || role == partyDriver {
		return role
	}
	return "system"
}

// pricingInt reads an integer the pricing snapshot recorded (JSON numbers
// decode as float64).
func pricingInt(pricing map[string]any, key string) int64 {
	switch value := pricing[key].(type) {
	case float64:
		return int64(value)
	case int64:
		return value
	case int:
		return int64(value)
	}
	return 0
}

// applyStopChanges rewrites an execution's stop states for a committed
// amendment: a route change adds its new stops as pending, reorders the
// survivors and removes dropped ones (a dropped stop the driver reached in
// the meantime is skipped with its waiting finalised); a termination skips
// what was never reached and closes — or, if the driver already left it,
// settles — the stop whose waiting it priced; a waiting fee marks its stop
// settled.
func (s *Service) applyStopChanges(ctx context.Context, tx pgx.Tx, amendment *Amendment, route *ExecutionRoute, stops []*ExecutionStop, waitingFee int64, now time.Time) error {
	existing := map[uuid.UUID]*ExecutionStop{}
	for _, stop := range stops {
		existing[stop.StopID] = stop
	}
	amendmentID := amendment.ID
	switch amendment.Kind {
	case AmendmentKindStopWaiting:
		if amendment.ReferenceStopID == nil {
			return nil
		}
		stop, ok := existing[*amendment.ReferenceStopID]
		if !ok {
			return nil
		}
		stop.WaitingSettlement = waitingSettlementCommitted
		stop.WaitingAmendmentID = &amendmentID
		return s.deps.Store.UpsertExecutionStop(ctx, tx, stop)

	case AmendmentKindEarlyTermination:
		waitingStop, _ := amendment.Pricing["waitingStopId"].(string)
		for _, stop := range stops {
			switch {
			case stop.State == StopStatePending:
				stop.State = StopStateSkipped
				stop.SkippedAt = &now
				stop.SkipReason = "trip_terminated"
			case stop.State == StopStateArrived:
				stop.State = StopStateDeparted
				stop.DepartedAt = &now
				stop.WaitingFeeMinor = waitingFee
				if waitingFee > 0 {
					stop.WaitingSettlement = waitingSettlementCommitted
					stop.WaitingAmendmentID = &amendmentID
				}
			case waitingStop != "" && stop.StopID.String() == waitingStop &&
				stop.WaitingSettlement == waitingSettlementPending && stop.WaitingAmendmentID == nil:
				// The driver left the stop while this termination was still
				// converging. Its waiting was priced INTO the termination, so
				// it settles here at the termination's fee — never a second
				// time through its own stop_waiting adjustment.
				stop.WaitingFeeMinor = waitingFee
				stop.WaitingAmendmentID = &amendmentID
				stop.WaitingSettlement = waitingSettlementNone
				if waitingFee > 0 {
					stop.WaitingSettlement = waitingSettlementCommitted
				}
			default:
				continue
			}
			if err := s.deps.Store.UpsertExecutionStop(ctx, tx, stop); err != nil {
				return err
			}
		}
		return nil
	}

	proposed := map[uuid.UUID]bool{}
	for _, stop := range amendment.Stops {
		proposed[stop.StopID] = true
		row, ok := existing[stop.StopID]
		if !ok {
			row = executionStopOf(amendment.AwardID, route.ExecutionID, stop)
		}
		row.Order = stop.Order
		if err := s.deps.Store.UpsertExecutionStop(ctx, tx, row); err != nil {
			return err
		}
	}
	for _, stop := range stops {
		if proposed[stop.StopID] {
			continue
		}
		switch stop.State {
		case StopStatePending:
			stop.State = StopStateRemoved
		case StopStateArrived:
			// Reached after the commit revalidated, while the original
			// agreement was still in force, and dropped by the committed
			// route: it leaves the trip as skipped, its waiting finalised up
			// to now and settled on its own like any stop's — so it neither
			// blocks the next stop's arrival nor keeps accruing.
			waiting := waitingOf(stop, route.WaitingTerms, remainingCapFor(route, stops, stop.StopID), now)
			stop.State = StopStateSkipped
			stop.SkippedAt = &now
			stop.SkipReason = "removed_by_amendment"
			stop.WaitingFeeMinor = waiting.feeMinor
			if waiting.feeMinor > 0 {
				stop.WaitingSettlement = waitingSettlementPending
			}
			if err := s.writeStopEvent(ctx, tx, route, stop, "mp.stop.skipped", Actor{Role: partySystem}, now, "", map[string]any{
				"waitedSec":       waiting.waitedSec,
				"includedSec":     waiting.includedSec,
				"paidSec":         waiting.paidSec,
				"waitingFeeMinor": waiting.feeMinor,
				"reason":          stop.SkipReason,
				"amendmentId":     amendmentID.String(),
			}); err != nil {
				return err
			}
		default:
			continue
		}
		if err := s.deps.Store.UpsertExecutionStop(ctx, tx, stop); err != nil {
			return err
		}
	}
	return nil
}

// amendExecutionRide points a still-running execution ride at a new
// server-written quote carrying the committed route and agreed fare (the
// original quote stays as provenance), moves its dropoff when the amendment
// did, bumps its version and publishes ride.terms_amended. A ride that
// already ended keeps its row; the committed terms and the settlement carry
// the truth from here.
func (s *Service) amendExecutionRide(ctx context.Context, tx pgx.Tx, amendment *Amendment, route *ExecutionRoute, now time.Time) error {
	mv := s.deps.Store.Move()
	ride, err := mv.RideForUpdate(ctx, tx, route.ExecutionID)
	if err != nil {
		return err
	}
	if !machine.IsRiderActive(ride.State) {
		return nil
	}
	current, err := mv.Quote(ctx, tx, ride.QuoteID)
	if err != nil {
		return err
	}
	distance, duration := current.DistanceMeters, current.DurationSeconds
	if amendment.changesRoute() {
		distance = pricingInt(amendment.Pricing, "proposedDistanceM")
		duration = pricingInt(amendment.Pricing, "proposedDurationSec")
	}
	dropoff := domain.Place{Lat: route.Dropoff.Lat, Lng: route.Dropoff.Lng, Address: route.Dropoff.Label}
	amended := &domain.Quote{
		ID:              uuid.New(),
		CityID:          ride.CityID,
		ConfigVersion:   route.ConfigVersion,
		RiderID:         ride.RiderID,
		VehicleClass:    ride.VehicleClass,
		Pickup:          ride.Pickup,
		Dropoff:         dropoff,
		Stops:           executionStops(route.Stops),
		DistanceMeters:  distance,
		DurationSeconds: duration,
		FareMinor:       route.AgreedFareMinor,
		Currency:        ride.Currency,
		ExpiresAt:       now,
	}
	if err := mv.InsertQuote(ctx, tx, amended); err != nil {
		return err
	}
	if err := mv.ConsumeQuote(ctx, tx, amended.ID, ride.ID); err != nil {
		return err
	}
	var version int
	if err := tx.QueryRow(ctx, `
		UPDATE ride.rides SET
			quote_id = $3,
			quoted_fare_minor = $4,
			dropoff_lat = $5,
			dropoff_lng = $6,
			dropoff_address = $7,
			version = version + 1,
			updated_at = now()
		WHERE id = $1 AND version = $2
		RETURNING version`,
		ride.ID, ride.Version, amended.ID, route.AgreedFareMinor, dropoff.Lat, dropoff.Lng, dropoff.Address,
	).Scan(&version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Errorf(domain.CodeVersionConflict, "the ride changed while the amendment committed")
		}
		return err
	}
	fromVersion := ride.Version
	return writeEvent(ctx, tx, Event{
		Name:           "ride.terms_amended",
		AggregateType:  "ride",
		AggregateID:    ride.ID.String(),
		FromVersion:    &fromVersion,
		ToVersion:      version,
		CityID:         ride.CityID,
		ActorType:      "system",
		ActorID:        "ride-service",
		IdempotencyKey: eventKey("ride.terms_amended", ride.ID.String(), amendment.ID.String()),
		OccurredAt:     now,
		Payload: map[string]any{
			"rideId":        ride.ID.String(),
			"version":       version,
			"amendmentId":   amendment.ID.String(),
			"kind":          amendment.Kind,
			"routeRevision": route.RouteRevision,
			"fareRevision":  route.FareRevision,
			"fareMinor":     route.AgreedFareMinor,
			"currency":      ride.Currency,
			"stopCount":     len(route.Stops),
			"dropoff":       map[string]any{"lat": dropoff.Lat, "lng": dropoff.Lng},
		},
	})
}

// systemAdjustment is a pre-authorized adjustment the server itself
// proposes: a stop's paid waiting (authorized by the rider under the agreed
// cap) or a safe early termination.
type systemAdjustment struct {
	id              uuid.UUID
	kind            string
	revisedFare     int64
	stops           []RouteStop
	dropoff         Area
	referenceStopID *uuid.UUID
	pricing         map[string]any
	actorRole       string
	actorID         string
	// linkStop settles the reference stop's waiting on this amendment
	// inside the insert transaction.
	linkStop bool
	// extra runs inside the insert transaction (an endpoint's idempotent
	// response), so a replay after a crash finds the adjustment.
	extra func(tx pgx.Tx, amendmentID uuid.UUID) error
}

// createSystemAdjustment records a pre-authorized adjustment and drives it
// through the SAME money path as an approved amendment: both approvals are
// implicit (the rider authorized the waiting cap up front; a termination
// only ever lowers the rider's charge or adds waiting already earned), so it
// reserves, captures and commits in one pass. It answers errAmendmentOpen
// when another amendment still has open money — the caller defers.
func (s *Service) createSystemAdjustment(ctx context.Context, route *ExecutionRoute, adj systemAdjustment) (*Amendment, error) {
	now := s.now()
	routeRevision := route.RouteRevision
	stops, dropoff := route.Stops, route.Dropoff
	if adj.kind != AmendmentKindStopWaiting {
		routeRevision++
		stops, dropoff = adj.stops, adj.dropoff
	}
	revisedFunded := adj.revisedFare
	amendment := &Amendment{
		ID:                     adj.id,
		AwardID:                route.AwardID,
		RequestID:              route.RequestID,
		ExecutionID:            route.ExecutionID,
		CityID:                 route.CityID,
		Kind:                   adj.kind,
		State:                  machine.MpAmendmentProposed,
		ProposedBy:             adj.actorID,
		ProposedByRole:         adj.actorRole,
		BaseRouteRevision:      route.RouteRevision,
		BaseFareRevision:       route.FareRevision,
		RouteRevision:          routeRevision,
		FareRevision:           route.FareRevision + 1,
		Stops:                  stops,
		Dropoff:                dropoff,
		Currency:               route.Currency,
		PriorFareMinor:         route.AgreedFareMinor,
		RevisedFareMinor:       adj.revisedFare,
		PriorCommissionMinor:   route.CapturedCommissionMinor,
		RevisedCommissionMinor: CommissionMinor(adj.revisedFare),
		PriorFundedMinor:       route.FundedMinor,
		RevisedFundedMinor:     revisedFunded,
		Pricing:                adj.pricing,
		ReferenceStopID:        adj.referenceStopID,
		RiderApprovedAt:        &now,
		DriverApprovedAt:       &now,
		// A pre-authorized adjustment never waits for approvals; the window
		// only bounds how long its reservation may stay unresolved.
		ExpiresAt:   now.Add(24 * time.Hour),
		Step:        amendStepReserve,
		StepState:   amendStatePending,
		NextRetryAt: sweepBackstop(now),
	}
	if existing, err := s.deps.Store.AmendmentByID(ctx, s.deps.Store.Pool(), adj.id); err == nil {
		// A deterministic adjustment (a stop's waiting fee) already written:
		// resume it, never write a second.
		return s.advanceAmendment(ctx, existing.ID)
	} else if !errors.Is(err, domain.ErrNotFound) {
		return nil, asDomainError(err)
	}
	actor := Actor{UserID: uuid.Nil, Role: adj.actorRole}
	if parsed, err := uuid.Parse(adj.actorID); err == nil {
		actor.UserID = parsed
	}
	err := s.insertAmendment(ctx, amendment, actor, adj.actorRole, now, func(tx pgx.Tx) error {
		if adj.extra != nil {
			if err := adj.extra(tx, amendment.ID); err != nil {
				return err
			}
		}
		if !adj.linkStop || adj.referenceStopID == nil {
			return nil
		}
		_, err := tx.Exec(ctx, `
			UPDATE mp.execution_stops SET waiting_amendment_id = $3, version = version + 1, updated_at = now()
			WHERE award_id = $1 AND stop_id = $2`, route.AwardID, *adj.referenceStopID, amendment.ID)
		return err
	})
	if err != nil {
		if mapped, ok := domain.AsError(err); ok && mapped.Code == domain.CodeConflict {
			return nil, errAmendmentOpen
		}
		return nil, err
	}
	return s.advanceAmendment(ctx, amendment.ID)
}

// ---------------------------------------------------------------------------
// Next-job feasibility and the stop-aware remaining trip.
// ---------------------------------------------------------------------------

// remainingFrom is the time left on a trip from a position: the legs through
// the pickup (when the passenger is not aboard yet), every stop not yet
// reached and the dropoff, plus the expected dwell still ahead — the full
// dwell of each stop not reached and what is left of the one being waited
// at. The same function prices the committed and a proposed route, so the
// two estimates compare like with like.
func (s *Service) remainingFrom(ctx context.Context, from domain.Place, beforePickup bool, pickup Area,
	stops []RouteStop, stateOf map[uuid.UUID]*ExecutionStop, dropoff Area, now time.Time) (int64, error) {
	var waypoints []domain.Place
	if beforePickup {
		waypoints = append(waypoints, domain.Place{Lat: pickup.Lat, Lng: pickup.Lng})
	}
	var dwell int64
	for _, stop := range stops {
		row, known := stateOf[stop.StopID]
		switch {
		case !known || row.State == StopStatePending:
			waypoints = append(waypoints, domain.Place{Lat: stop.Lat, Lng: stop.Lng})
			dwell += int64(stop.DwellSec)
		case row.State == StopStateArrived:
			started := row.ArrivedAt
			if row.WaitStartedAt != nil {
				started = row.WaitStartedAt
			}
			left := int64(stop.DwellSec)
			if started != nil {
				left -= int64(now.Sub(*started) / time.Second)
			}
			if left > 0 {
				dwell += left
			}
		}
	}
	route, err := s.deps.Router.Route(ctx, from, waypoints, domain.Place{Lat: dropoff.Lat, Lng: dropoff.Lng})
	if err != nil {
		return 0, err
	}
	return route.DurationSeconds + dwell, nil
}

// pickedUp reports whether the passenger is aboard (so the pickup leg is
// behind the driver).
func pickedUp(rideState string) bool {
	return rideState == machine.RiderInProgress || rideState == machine.RiderSafetyHold
}

// executionTripState reads what the remaining-trip estimate needs about a
// live execution: its committed route when one exists (with the stops'
// server-authoritative states), else the awarded quote's stops, all still
// ahead — an unreported stop is never assumed done.
func (s *Service) executionTripState(ctx context.Context, rideID uuid.UUID) (Area, []RouteStop, map[uuid.UUID]*ExecutionStop, Area, error) {
	stateOf := map[uuid.UUID]*ExecutionStop{}
	route, err := s.deps.Store.ExecutionRouteByExecution(ctx, s.deps.Store.Pool(), rideID)
	if err == nil {
		stops, err := s.deps.Store.ExecutionStops(ctx, s.deps.Store.Pool(), route.AwardID)
		if err != nil {
			return Area{}, nil, nil, Area{}, err
		}
		for _, stop := range stops {
			stateOf[stop.StopID] = stop
		}
		return route.Pickup, route.Stops, stateOf, route.Dropoff, nil
	}
	if !errors.Is(err, domain.ErrNotFound) {
		return Area{}, nil, nil, Area{}, err
	}
	ride, err := s.deps.Store.Move().RideByID(ctx, s.deps.Store.Pool(), rideID)
	if err != nil {
		return Area{}, nil, nil, Area{}, err
	}
	quote, err := s.deps.Store.Move().Quote(ctx, s.deps.Store.Pool(), ride.QuoteID)
	if err != nil {
		return Area{}, nil, nil, Area{}, err
	}
	stops := make([]RouteStop, 0, len(quote.Stops))
	for i, stop := range quote.Stops {
		id, parseErr := uuid.Parse(stop.StopID)
		if parseErr != nil {
			id = uuid.NewSHA1(uuid.NameSpaceOID, []byte(rideID.String()+itoa(i)))
		}
		stops = append(stops, RouteStop{StopID: id, Order: i + 1, Lat: stop.Lat, Lng: stop.Lng, Purpose: stop.Purpose, DwellSec: stop.DwellSec})
	}
	return Area{Lat: ride.Pickup.Lat, Lng: ride.Pickup.Lng}, stops, stateOf,
		Area{Lat: ride.Dropoff.Lat, Lng: ride.Dropoff.Lng}, nil
}

// remainingTripSeconds is the stop-aware remaining time of a live multi-stop
// execution from the driver's position, and the point the trip ends at.
func (s *Service) remainingTripSeconds(ctx context.Context, ride *ExecutionRide, fromLat, fromLng float64) (int64, Area, error) {
	pickup, stops, stateOf, dropoff, err := s.executionTripState(ctx, ride.ID)
	if err != nil {
		return 0, Area{}, err
	}
	remaining, err := s.remainingFrom(ctx, domain.Place{Lat: fromLat, Lng: fromLng}, !pickedUp(ride.State),
		pickup, stops, stateOf, dropoff, s.now())
	if err != nil {
		return 0, Area{}, err
	}
	return remaining, dropoff, nil
}

// nextJobConflict revalidates the driver's queued next job against a
// proposed remaining route. It answers nil when there is no queued job or
// the consented pickup promise still holds (or the change does not make it
// worse); otherwise the conflict details. A promise that cannot be verified
// right now counts as a conflict — the queued rider is never gambled with.
func (s *Service) nextJobConflict(ctx context.Context, route *ExecutionRoute, stops []*ExecutionStop, proposedStops []RouteStop, proposedDropoff Area) map[string]any {
	conflict := func(detail string, extra map[string]any) map[string]any {
		details := map[string]any{"reason": ReasonNextJobConflict, "detail": detail}
		for key, value := range extra {
			details[key] = value
		}
		return details
	}
	next, err := s.deps.Store.NextClaim(ctx, s.deps.Store.Pool(), route.DriverID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil
	}
	if err != nil {
		return conflict("the queued job cannot be read", nil)
	}
	if next.State == machine.MpClaimAwardPending {
		return conflict("a queued job is being awarded right now", nil)
	}
	if next.AwardID == nil {
		return nil
	}
	award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), *next.AwardID)
	if err != nil {
		return conflict("the queued award cannot be read", nil)
	}
	if award.State != machine.MpAwardConfirmed {
		return nil
	}
	if award.PickupWindow == nil || award.PickupWindow.ConsentedLatestSec <= 0 {
		return conflict("the queued job has no consented pickup window", map[string]any{"queuedAwardId": award.ID.String()})
	}
	queued, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), award.RequestID)
	if err != nil {
		return conflict("the queued request cannot be read", nil)
	}
	_, policy, err := s.policy(ctx, route.CityID)
	if err != nil {
		return conflict("the market policy cannot be read", nil)
	}
	session, err := s.deps.Store.DriverSessionRow(ctx, s.deps.Store.Pool(), route.DriverID)
	now := s.now()
	if err != nil || !session.HasLocation() ||
		now.Sub(*session.LastLocationAt) > time.Duration(policy.Stationary.MaxLocationAgeSec)*time.Second {
		return conflict("the driver's position is not fresh enough to verify the queued pickup", nil)
	}
	ride, err := s.deps.Store.Move().RideByID(ctx, s.deps.Store.Pool(), route.ExecutionID)
	if err != nil {
		return conflict("the current trip cannot be read", nil)
	}
	stateOf := map[uuid.UUID]*ExecutionStop{}
	for _, stop := range stops {
		stateOf[stop.StopID] = stop
	}
	from := domain.Place{Lat: *session.LastLat, Lng: *session.LastLng}
	before := !pickedUp(ride.State)
	predict := func(stops []RouteStop, dropoff Area) (int64, error) {
		remaining, err := s.remainingFrom(ctx, from, before, route.Pickup, stops, stateOf, dropoff, now)
		if err != nil {
			return 0, err
		}
		hop, err := s.routeSeconds(ctx, dropoff.Lat, dropoff.Lng, queued.Pickup.Lat, queued.Pickup.Lng)
		if err != nil {
			return 0, err
		}
		return remaining + int64(policy.FinishingTrip.CompletionBufferSec) + hop + int64(policy.FinishingTrip.UncertaintyBufferSec), nil
	}
	current, err := predict(route.Stops, route.Dropoff)
	if err != nil {
		return conflict("routing is unavailable", nil)
	}
	proposed, err := predict(proposedStops, proposedDropoff)
	if err != nil {
		return conflict("routing is unavailable", nil)
	}
	// The consent was to a window counted from the award's confirmation
	// (stamped on the service clock); the promise is that absolute time.
	confirmedAt := award.CreatedAt
	if award.ResolvedAt != nil {
		confirmedAt = *award.ResolvedAt
	}
	deadline := confirmedAt.Add(time.Duration(award.PickupWindow.ConsentedLatestSec) * time.Second)
	proposedAt := now.Add(time.Duration(proposed) * time.Second)
	if proposedAt.After(deadline) && proposed > current {
		return conflict("the change would make the driver miss the queued rider's consented pickup window", map[string]any{
			"queuedAwardId":            award.ID.String(),
			"queuedRequestId":          queued.ID.String(),
			"consentedPickupBy":        deadline,
			"predictedPickupAt":        proposedAt,
			"currentPredictedPickupAt": now.Add(time.Duration(current) * time.Second),
		})
	}
	return nil
}

// terminationAllowedReasons are the reasons a DRIVER may end a trip early
// with. A rider may end their own trip for any reason.
var terminationAllowedReasons = map[string]bool{
	"safety_concern":    true,
	"rider_request":     true,
	"vehicle_issue":     true,
	"excessive_waiting": true,
}
