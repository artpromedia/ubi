package marketplace

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// ---------------------------------------------------------------------------
// Post-award trip amendments (A02 items 4-6).
//
// An AWARDED execution's route and fare can change only through an
// amendment. The original agreement stays in force until the amendment
// COMMITS; until then nothing about the execution ride, the agreed fare or
// the captured commission moves. The money follows payment-service's
// documented adoption sequence (docs/MARKETPLACE-MONEY.md):
//
//   - propose: priced server-side as a DELTA under the award's own pricing
//     snapshot (its quote's city-config version — never today's policy), then
//     for an increase the incremental commission and the rider's top-up are
//     reserved BEFORE anyone is asked to approve;
//   - approve: both parties bind to the same (amendment id, route revision,
//     fare revision); the driver only while confirmed stationary;
//   - commit (a saga with a durable step ledger, like the award saga): the
//     driver's queued next job is revalidated first, then the reserved money
//     is captured/committed (a decrease is a linked partial refund), then the
//     execution's committed terms and the ride are rewritten in one
//     transaction. A step that fails part-way compensates;
//   - reject/expire: everything reserved is released.
//
// The same money path settles the two system adjustments: a stop's paid
// waiting (pre-authorized by the rider under the agreed cap) and a safe early
// termination. None of it ever re-charges the 10%: only differences move, as
// records linked to the award.
// ---------------------------------------------------------------------------

// Amendment kinds.
const (
	AmendmentKindRoute            = "route"
	AmendmentKindStopWaiting      = "stop_waiting"
	AmendmentKindEarlyTermination = "early_termination"
)

// Amendment saga steps (mp.amendments.step) and step states. Once both
// parties are bound the saga sits in `revalidate`; only when revalidation
// passes does it move — durably, BEFORE the first money call — to `capture`,
// the money phase. From then on the amendment is driven forward (or
// compensated) and never revalidated again: a money leg whose outcome is
// unknown may already have landed, so rejecting it with a plain release
// could orphan a committed top-up or a refunded commission.
const (
	amendStepReserve    = "reserve"
	amendStepApprovals  = "approvals"
	amendStepRevalidate = "revalidate"
	amendStepCapture    = "capture"
	amendStepApply      = "apply"
	amendStepCompensate = "compensate"
	amendStepRelease    = "release"
	amendStepDone       = "done"

	amendStatePending = "pending"
	amendStateUnknown = "unknown"
	amendStateStuck   = "stuck"
	amendStateDone    = "done"
)

// Reasons an amendment is refused, rejected or expired with.
const (
	ReasonNextJobConflict      = "next_job_conflict"
	amendReasonDriverSpendable = "insufficient_driver_spendable"
	amendReasonRiderFunds      = "insufficient_rider_funds"
	amendReasonWalletTerms     = "wallet_terms_refreshed"
	amendReasonExecutionEnded  = "execution_ended"
	amendReasonRouteChanged    = "route_changed"
	amendReasonApprovalWindow  = "approval_window_elapsed"
)

// Roles an amendment records approvals and history under.
const (
	partyRider  = "rider"
	partyDriver = "driver"
	partySystem = "system"
)

// PlaceInput is a destination a party names (a moved dropoff).
type PlaceInput struct {
	Lat   float64 `json:"lat"`
	Lng   float64 `json:"lng"`
	Label string  `json:"label,omitempty"`
}

// ProposeAmendmentRequest is the body of POST
// /v1/mp/requests/{requestId}/amendments. Stops are the REMAINING
// intermediate stops after the amendment, in order: a stop the driver has
// already reached is history and is kept as it is. A remaining stop that
// survives (same place and purpose) keeps its stopId. The expected revisions
// name the committed terms the proposer is editing; stale ones answer the
// refreshed terms.
type ProposeAmendmentRequest struct {
	Stops                 []StopInput `json:"stops"`
	Dropoff               *PlaceInput `json:"dropoff,omitempty"`
	ExpectedRouteRevision int         `json:"expectedRouteRevision"`
	ExpectedFareRevision  int         `json:"expectedFareRevision"`
}

// AmendmentDecisionRequest binds an approval (or a rejection) to exact terms.
type AmendmentDecisionRequest struct {
	RouteRevision int    `json:"routeRevision"`
	FareRevision  int    `json:"fareRevision"`
	Reason        string `json:"reason,omitempty"`
}

// amendmentRef is what an amendment POST stores as its idempotent response:
// the amendment it acted on. A replay answers that amendment's CURRENT view.
type amendmentRef struct {
	AmendmentID uuid.UUID `json:"amendmentId"`
}

// Idempotency scopes of the amendment and stop POSTs.
const (
	scopeAmendmentPropose = "mp.amendment.propose"
	scopeAmendmentApprove = "mp.amendment.approve"
	scopeAmendmentReject  = "mp.amendment.reject"
	scopeTripTerminate    = "mp.trip.terminate"
	scopeStopArrive       = "mp.stop.arrive"
	scopeStopDepart       = "mp.stop.depart"
	scopeStopSkip         = "mp.stop.skip"
	scopeStopWaitApproval = "mp.stop.waiting_approval"
)

// amendmentKey is the payment-service Idempotency-Key for one amendment
// operation (the amendment id stays the idempotency authority there).
func amendmentKey(op string, id uuid.UUID) string {
	return "mp.amd." + op + ":" + id.String()
}

// compensationID is the linked amendment id a compensating adjustment moves
// under: a captured leg is never edited, it is offset by its own record.
func compensationID(id uuid.UUID) string {
	return id.String() + ".c"
}

// eventKey keeps an outbox idempotency key inside the envelope's 64-char
// bound: the event name plus a digest of what makes the event unique.
func eventKey(name string, parts ...string) string {
	return name + ":" + digest(strings.Join(parts, "|"))
}

// ---------------------------------------------------------------------------
// The trip an actor may act on.
// ---------------------------------------------------------------------------

// tripContext is one awarded, executing trip as a party sees it.
type tripContext struct {
	request *Request
	award   *Award
	route   *ExecutionRoute
	role    string
}

// tripFor resolves the executing trip behind a request for a party to it,
// behind the ride vertical AND the feature flag the caller names. Anyone else
// — and a request whose award has no execution yet — reads as not found.
func (s *Service) tripFor(ctx context.Context, actor Actor, requestID uuid.UUID, flag string) (*tripContext, error) {
	if !actor.IsRider() && !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only the requester or the awarded driver can act on this trip")
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	award, err := s.deps.Store.LatestAwardForRequest(ctx, s.deps.Store.Pool(), requestID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, asDomainError(err)
	}
	role := ""
	switch {
	case actor.IsRider() && request.RequesterID == actor.UserID:
		role = partyRider
	case actor.IsDriver() && award != nil && award.DriverID == actor.UserID:
		role = partyDriver
	}
	if role == "" {
		return nil, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if request.Service != ServiceRide {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"trip amendments and stops are only available for rides").
			WithDetails(map[string]any{"service": request.Service})
	}
	if err := s.requireServiceFlag(ctx, request.Service, actor, request.CityID); err != nil {
		return nil, err
	}
	if flag != "" {
		if err := s.requireFlag(ctx, flag, actor, request.CityID); err != nil {
			return nil, domain.Errorf(domain.CodeFeatureDisabled, "this feature is not available here").
				WithDetails(map[string]any{"feature": flag})
		}
	}
	if award == nil || award.State != machine.MpAwardConfirmed || award.ExecutionID == nil {
		return nil, domain.Errorf(domain.CodeNoActiveRide, "this request has no executing trip")
	}
	route, err := s.ensureExecutionRoute(ctx, award, request)
	if err != nil {
		return nil, err
	}
	return &tripContext{request: request, award: award, route: route, role: role}, nil
}

// configVersionOf reads the city-config version a marketplace quote was
// priced under out of its pricing version (pricingVersionFor).
func configVersionOf(pricingVersion string) (int, bool) {
	index := strings.LastIndex(pricingVersion, "/cfg.")
	if index < 0 {
		return 0, false
	}
	version, err := strconv.Atoi(pricingVersion[index+len("/cfg."):])
	if err != nil || version <= 0 {
		return 0, false
	}
	return version, true
}

// snapshotConfig reads the city configuration at an award's pricing
// snapshot. A provider that cannot read versions fails closed: an amendment
// is never priced under today's policy by accident.
func (s *Service) snapshotConfig(ctx context.Context, cityID string, version int) (*cityconfig.CityConfig, *cityconfig.MarketplacePolicy, error) {
	versioned, ok := s.deps.Config.(cityconfig.VersionedProvider)
	if !ok {
		return nil, nil, domain.Errorf(domain.CodeConfigUnavailable,
			"the award's pricing snapshot cannot be read here")
	}
	config, err := versioned.ConfigVersion(ctx, cityID, version)
	if err != nil {
		return nil, nil, asDomainError(err)
	}
	policy, err := config.MarketplacePolicyFor()
	if err != nil {
		return nil, nil, asDomainError(err)
	}
	return config, policy, nil
}

// waitingTermsFor derives the paid stop-waiting terms an execution publishes
// from its pricing snapshot.
func waitingTermsFor(config *cityconfig.CityConfig, policy *cityconfig.MarketplacePolicy) WaitingTerms {
	terms := WaitingTerms{
		IncludedBasis:     includedBasisStopDwell,
		GeofenceMeters:    config.ArrivedGeofenceMeters,
		MaxAccuracyMeters: policy.Stationary.MaxAccuracyMeters,
		LocationMaxAgeSec: policy.Stationary.MaxLocationAgeSec,
	}
	if waiting := policy.StopsPolicy().PaidWaiting; waiting != nil {
		terms.PerMinMinor = waiting.PerMinMinor
		terms.MaxAuthorizedMinor = waiting.MaxAuthorizedMinor
		terms.ExcessiveAfterSec = waiting.ExcessiveAfterSec
	}
	return terms
}

// ensureExecutionRoute reads (creating on first use) an awarded execution's
// committed terms: the award's route, fare, captured commission and funding,
// its pricing snapshot and the waiting terms that snapshot publishes.
func (s *Service) ensureExecutionRoute(ctx context.Context, award *Award, request *Request) (*ExecutionRoute, error) {
	route, err := s.deps.Store.ExecutionRouteByAward(ctx, s.deps.Store.Pool(), award.ID)
	if err == nil {
		return route, nil
	}
	if !errors.Is(err, domain.ErrNotFound) {
		return nil, asDomainError(err)
	}
	bid, err := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), award.BidID)
	if err != nil {
		return nil, asDomainError(err)
	}
	quote, err := s.deps.Store.QuoteByID(ctx, s.deps.Store.Pool(), request.QuoteID)
	if err != nil {
		return nil, asDomainError(err)
	}
	configVersion, ok := configVersionOf(quote.PricingVersion)
	if !ok {
		return nil, domain.Errorf(domain.CodeConfigUnavailable,
			"the award's pricing snapshot is not recorded; its terms cannot be amended")
	}
	config, policy, err := s.snapshotConfig(ctx, request.CityID, configVersion)
	if err != nil {
		return nil, err
	}
	terms := waitingTermsFor(config, policy)
	route = &ExecutionRoute{
		AwardID:                 award.ID,
		RequestID:               request.ID,
		ExecutionID:             *award.ExecutionID,
		RequesterID:             award.RequesterID,
		DriverID:                award.DriverID,
		CityID:                  request.CityID,
		Service:                 request.Service,
		VehicleClass:            request.VehicleClass,
		Currency:                request.Currency,
		PaymentMethodID:         request.PaymentMethodID,
		ReservationID:           bid.ReservationID,
		ConfigVersion:           configVersion,
		PolicyVersion:           quote.PolicyVersion,
		OriginalFareMinor:       award.FareMinor,
		AgreedFareMinor:         award.FareMinor,
		CapturedCommissionMinor: award.CommissionMinor,
		FundedMinor:             award.FareMinor,
		Pickup:                  request.Pickup,
		Dropoff:                 request.Dropoff,
		Stops:                   request.Stops,
		WaitingTerms:            terms,
		WaitingCapMinor:         terms.MaxAuthorizedMinor,
	}
	stops := make([]*ExecutionStop, 0, len(request.Stops))
	for _, stop := range request.Stops {
		stops = append(stops, executionStopOf(award.ID, *award.ExecutionID, stop))
	}
	if err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		_, err := s.deps.Store.InsertExecutionRoute(ctx, tx, route, stops)
		return err
	}); err != nil {
		return nil, asDomainError(err)
	}
	route, err = s.deps.Store.ExecutionRouteByAward(ctx, s.deps.Store.Pool(), award.ID)
	if err != nil {
		return nil, asDomainError(err)
	}
	return route, nil
}

// executionStopOf is a route stop's first (pending) execution state.
func executionStopOf(awardID, executionID uuid.UUID, stop RouteStop) *ExecutionStop {
	return &ExecutionStop{
		AwardID:           awardID,
		StopID:            stop.StopID,
		ExecutionID:       executionID,
		Order:             stop.Order,
		State:             StopStatePending,
		Lat:               stop.Lat,
		Lng:               stop.Lng,
		Label:             stop.Label,
		Purpose:           stop.Purpose,
		DwellSec:          stop.DwellSec,
		WaitingSettlement: waitingSettlementNone,
	}
}

// ---------------------------------------------------------------------------
// Server-side pricing of a route change, under the award's snapshot.
// ---------------------------------------------------------------------------

// routeMetrics is one ordered route as the shared Router measures it, plus
// the expected dwell it prices as time.
type routeMetrics struct {
	distanceM   int64
	durationSec int64
	dwellSec    int64
}

func (s *Service) measureRoute(ctx context.Context, pickup Area, stops []RouteStop, dropoff Area) (routeMetrics, error) {
	route, err := s.deps.Router.Route(ctx,
		domain.Place{Lat: pickup.Lat, Lng: pickup.Lng}, stopPlaces(stops),
		domain.Place{Lat: dropoff.Lat, Lng: dropoff.Lng})
	if err != nil {
		return routeMetrics{}, err
	}
	return routeMetrics{distanceM: route.DistanceMeters, durationSec: route.DurationSeconds, dwellSec: totalDwellSec(stops)}, nil
}

// amendmentPrice is a priced route change.
type amendmentPrice struct {
	revisedFare       int64
	revisedCommission int64
	addedDistanceM    int64
	addedDurationSec  int64
	proposed          routeMetrics
	pricing           map[string]any
}

// priceRouteChange prices the committed route → the proposed route as a
// DELTA under the award's snapshot: only the distance and time components
// (the proposed route's dwell priced as time, exactly as the quote priced
// it) move; base, booking fee and any minimum-fare top-up were part of the
// negotiated fare and are never re-charged. Both routes are measured now, so
// the delta compares like with like. The route part of the revised fare is
// held inside the proposed route's server bounds under the same snapshot;
// committed waiting fees ride on top untouched.
func (s *Service) priceRouteChange(ctx context.Context, route *ExecutionRoute, config *cityconfig.CityConfig,
	proposedStops []RouteStop, proposedDropoff Area) (*amendmentPrice, error) {
	current, err := s.measureRoute(ctx, route.Pickup, route.Stops, route.Dropoff)
	if err != nil {
		return nil, domain.Errorf(domain.CodeServiceUnavailable, "the route cannot be measured right now").Wrap(err)
	}
	proposed, err := s.measureRoute(ctx, route.Pickup, proposedStops, proposedDropoff)
	if err != nil {
		return nil, domain.Errorf(domain.CodeServiceUnavailable, "the route cannot be measured right now").Wrap(err)
	}
	_, currentBreakdown, err := s.deps.Pricing.Fare(config, route.VehicleClass, current.distanceM, current.durationSec+current.dwellSec)
	if err != nil {
		return nil, asDomainError(err)
	}
	proposedFare, proposedBreakdown, err := s.deps.Pricing.Fare(config, route.VehicleClass, proposed.distanceM, proposed.durationSec+proposed.dwellSec)
	if err != nil {
		return nil, asDomainError(err)
	}
	fareBounds, err := config.MarketplaceBoundsFor(route.Service, route.VehicleClass)
	if err != nil {
		return nil, asDomainError(err)
	}
	currentVariable := currentBreakdown.DistanceMinor + currentBreakdown.TimeMinor
	proposedVariable := proposedBreakdown.DistanceMinor + proposedBreakdown.TimeMinor
	delta := proposedVariable - currentVariable

	routeFare := route.AgreedFareMinor - route.WaitingCommittedMinor
	revisedRoute := routeFare + delta
	minMinor, maxMinor := boundsFor(fareBounds, proposedFare.AmountMinor)
	boundedBy := ""
	if revisedRoute < minMinor {
		revisedRoute, boundedBy = minMinor, "floor"
	}
	if revisedRoute > maxMinor {
		revisedRoute, boundedBy = maxMinor, "ceiling"
	}
	revised := revisedRoute + route.WaitingCommittedMinor
	table, _ := config.FareTableFor(route.VehicleClass)
	pricing := map[string]any{
		"configVersion":         route.ConfigVersion,
		"policyVersion":         route.PolicyVersion,
		"perKmMinor":            table.PerKmMinor,
		"perMinMinor":           table.PerMinMinor,
		"currentVariableMinor":  currentVariable,
		"proposedVariableMinor": proposedVariable,
		"routeDeltaMinor":       delta,
		"minimumFareMinor":      minMinor,
		"maximumFareMinor":      maxMinor,
		"proposedDistanceM":     proposed.distanceM,
		"proposedDurationSec":   proposed.durationSec,
		"proposedDwellSec":      proposed.dwellSec,
	}
	if boundedBy != "" {
		pricing["boundedBy"] = boundedBy
	}
	return &amendmentPrice{
		revisedFare:       revised,
		revisedCommission: CommissionMinor(revised),
		addedDistanceM:    proposed.distanceM - current.distanceM,
		addedDurationSec:  (proposed.durationSec + proposed.dwellSec) - (current.durationSec + current.dwellSec),
		proposed:          proposed,
		pricing:           pricing,
	}, nil
}

// proposedRoute builds the complete ordered stop list an amendment proposes:
// the visited stops, unchanged and first, then the requested remaining stops
// validated against the snapshot's stop limits (surviving stops keep their
// ids). It also reports whether the stop set or the dropoff actually change.
func proposedRoute(route *ExecutionRoute, stops []*ExecutionStop, inputs []StopInput, dropoff *PlaceInput,
	stopsPolicy cityconfig.MarketplaceStopsPolicy) ([]RouteStop, Area, bool, error) {
	var visited, remaining []RouteStop
	stateOf := map[uuid.UUID]*ExecutionStop{}
	for _, stop := range stops {
		stateOf[stop.StopID] = stop
	}
	for _, stop := range route.Stops {
		if row, ok := stateOf[stop.StopID]; ok && row.visited() {
			visited = append(visited, stop)
		} else {
			remaining = append(remaining, stop)
		}
	}

	newDropoff := route.Dropoff
	if dropoff != nil {
		place := domain.Place{Lat: dropoff.Lat, Lng: dropoff.Lng}
		if !place.Valid() {
			return nil, Area{}, false, stopsFieldError("dropoff", "the new dropoff is not a valid coordinate")
		}
		label, err := cleanStopLabel(dropoff.Label, 0, dropoff.Lat, dropoff.Lng)
		if err != nil {
			return nil, Area{}, false, stopsFieldError("dropoff.label", "the dropoff label must be a short printable line")
		}
		newDropoff = Area{Label: label, Lat: dropoff.Lat, Lng: dropoff.Lng}
	}

	limits := stopsPolicy
	limits.MaxIntermediateStops -= len(visited)
	if limits.MaxIntermediateStops < 0 {
		limits.MaxIntermediateStops = 0
	}
	start := domain.Place{Lat: route.Pickup.Lat, Lng: route.Pickup.Lng}
	if len(visited) > 0 {
		last := visited[len(visited)-1]
		start = domain.Place{Lat: last.Lat, Lng: last.Lng}
	}
	built, err := buildRouteStops(start, domain.Place{Lat: newDropoff.Lat, Lng: newDropoff.Lng}, inputs, limits)
	if err != nil {
		return nil, Area{}, false, err
	}
	built = carryStopIDs(remaining, built)
	complete := make([]RouteStop, 0, len(visited)+len(built))
	complete = append(complete, visited...)
	complete = append(complete, built...)
	for i := range complete {
		complete[i].Order = i + 1
	}
	changed := !sameStopSet(route.Stops, complete) || !samePoint(route.Dropoff.Lat, route.Dropoff.Lng, newDropoff.Lat, newDropoff.Lng)
	return complete, newDropoff, changed, nil
}

// ---------------------------------------------------------------------------
// Propose.
// ---------------------------------------------------------------------------

// ProposeAmendment prices a route change on an awarded, executing trip,
// records the proposal and — for an increase — reserves the incremental
// commission and the rider's top-up before anyone is asked to approve. The
// original agreement stays in force. 201 with the amendment awaiting
// approvals; 202 while the reservation's outcome is still unknown (the sweep
// converges it); a definite refusal (insufficient funds, stale wallet terms)
// answers the refusal and leaves the proposal rejected with nothing held.
func (s *Service) ProposeAmendment(ctx context.Context, actor Actor, requestID uuid.UUID, req ProposeAmendmentRequest, idempotencyKey string) (*AmendmentView, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	// The fingerprint names the trip too: the same key and body replayed on
	// another request is a key reuse, never that request's answer.
	idemBody := map[string]any{"requestId": requestID.String(), "proposal": req}
	if view, status, done, err := s.amendmentReplay(ctx, actor, scopeAmendmentPropose, idempotencyKey, idemBody); done {
		return view, status, err
	}
	trip, err := s.tripFor(ctx, actor, requestID, cityconfig.FlagMarketplaceTripAmendments)
	if err != nil {
		return nil, 0, err
	}
	if len(req.Stops) > 0 || len(trip.route.Stops) > 0 {
		if err := s.requireStopsAllowed(ctx, trip.request.Service, actor, trip.request.CityID); err != nil {
			return nil, 0, err
		}
	}
	if trip.role == partyDriver {
		// Proposing a fare change is a fare decision: never in motion.
		if err := s.requireDriverParked(ctx, actor, trip.request.CityID,
			"park safely before proposing a change to the trip", nil); err != nil {
			return nil, 0, err
		}
	}
	route := trip.route
	if req.ExpectedRouteRevision != route.RouteRevision || req.ExpectedFareRevision != route.FareRevision {
		return nil, 0, domain.Errorf(domain.CodeVersionConflict,
			"the trip's terms changed after you reviewed them; review the refreshed terms").
			WithDetails(tripTermsDetails(route))
	}
	ride, err := s.deps.Store.Move().RideByID(ctx, s.deps.Store.Pool(), route.ExecutionID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if !machine.IsRiderActive(ride.State) || route.TerminatedAt != nil {
		return nil, 0, domain.Errorf(domain.CodeNoActiveRide, "this trip is no longer running").
			WithDetails(map[string]any{"rideState": ride.State})
	}
	if open, err := s.deps.Store.OpenAmendmentForAward(ctx, s.deps.Store.Pool(), route.AwardID); err == nil {
		return nil, 0, openAmendmentError(open)
	} else if !errors.Is(err, domain.ErrNotFound) {
		return nil, 0, asDomainError(err)
	}

	config, policy, err := s.snapshotConfig(ctx, route.CityID, route.ConfigVersion)
	if err != nil {
		return nil, 0, err
	}
	stops, err := s.deps.Store.ExecutionStops(ctx, s.deps.Store.Pool(), route.AwardID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	proposedStops, proposedDropoff, changed, err := proposedRoute(route, stops, req.Stops, req.Dropoff, policy.StopsPolicy())
	if err != nil {
		return nil, 0, err
	}
	if !changed {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "the proposal does not change the route").
			WithDetails(map[string]any{"field": "stops"})
	}
	price, err := s.priceRouteChange(ctx, route, config, proposedStops, proposedDropoff)
	if err != nil {
		return nil, 0, err
	}
	// The driver's queued next job is checked before anything is reserved:
	// an amendment that would break a consented pickup window is refused
	// outright — the queued rider is never silently sacrificed.
	if conflict := s.nextJobConflict(ctx, route, stops, proposedStops, proposedDropoff); conflict != nil {
		return nil, 0, domain.Errorf(domain.CodeConflict,
			"this change would break the pickup window promised to the driver's next rider").
			WithDetails(conflict)
	}

	now := s.now()
	amendment := &Amendment{
		ID:                     uuid.New(),
		AwardID:                route.AwardID,
		RequestID:              route.RequestID,
		ExecutionID:            route.ExecutionID,
		CityID:                 route.CityID,
		Kind:                   AmendmentKindRoute,
		State:                  machine.MpAmendmentProposed,
		ProposedBy:             actor.UserID.String(),
		ProposedByRole:         trip.role,
		BaseRouteRevision:      route.RouteRevision,
		BaseFareRevision:       route.FareRevision,
		RouteRevision:          route.RouteRevision + 1,
		FareRevision:           route.FareRevision + 1,
		Stops:                  proposedStops,
		Dropoff:                proposedDropoff,
		Currency:               route.Currency,
		PriorFareMinor:         route.AgreedFareMinor,
		RevisedFareMinor:       price.revisedFare,
		PriorCommissionMinor:   route.CapturedCommissionMinor,
		RevisedCommissionMinor: price.revisedCommission,
		PriorFundedMinor:       route.FundedMinor,
		RevisedFundedMinor:     price.revisedFare,
		AddedDistanceM:         price.addedDistanceM,
		AddedDurationSec:       price.addedDurationSec,
		Pricing:                price.pricing,
		ExpiresAt:              now.Add(time.Duration(policy.StopsPolicy().ApprovalWindowSec()) * time.Second),
		Step:                   amendStepReserve,
		StepState:              amendStatePending,
		NextRetryAt:            sweepBackstop(now),
	}
	if err := s.insertAmendment(ctx, amendment, actor, trip.role, now, func(tx pgx.Tx) error {
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeAmendmentPropose, actor.UserID, idempotencyKey, idemBody,
			202, amendmentRef{AmendmentID: amendment.ID})
	}); err != nil {
		return nil, 0, err
	}

	advanced, advErr := s.advanceAmendment(ctx, amendment.ID)
	if advanced == nil {
		advanced = amendment
	}
	if advErr != nil {
		if mapped, ok := domain.AsError(advErr); ok && advanced.State == machine.MpAmendmentRejected {
			details := map[string]any{}
			for key, value := range mapped.Details {
				details[key] = value
			}
			details["amendmentId"] = advanced.ID.String()
			details["amendmentState"] = advanced.State
			details["reason"] = advanced.Reason
			return nil, 0, domain.Errorf(mapped.Code, "%s", mapped.Message).WithDetails(details)
		}
		s.deps.Logger.Warn().Err(advErr).Str("amendment_id", amendment.ID.String()).
			Msg("amendment reservation paused; the sweep will converge it")
	}
	status := 201
	if advanced.State == machine.MpAmendmentProposed {
		status = 202
	}
	return s.amendmentViewFor(ctx, advanced, trip.role), status, nil
}

// openAmendmentError answers "another amendment is still open".
func openAmendmentError(open *Amendment) *domain.Error {
	return domain.Errorf(domain.CodeConflict, "another change to this trip is still being resolved").
		WithDetails(map[string]any{
			"reason":         "amendment_open",
			"amendmentId":    open.ID.String(),
			"amendmentState": open.State,
		})
}

// requireDriverParked refuses a driver's fare decision — proposing,
// approving or rejecting a change to the trip — unless the server confirms
// them stationary and parked (the existing motion/parked gate): never an
// in-motion fare interaction.
func (s *Service) requireDriverParked(ctx context.Context, actor Actor, cityID, message string, extra map[string]any) error {
	_, policy, err := s.policy(ctx, cityID)
	if err != nil {
		return err
	}
	if ok, code := s.stationaryVerdict(ctx, actor.UserID, policy.Stationary, s.now()); !ok {
		details := map[string]any{"reason": code}
		for key, value := range extra {
			details[key] = value
		}
		return domain.Errorf(domain.CodeDriverIneligible, "%s", message).WithDetails(details)
	}
	return nil
}

// tripTermsDetails is the refreshed-terms payload of a stale amendment edit.
func tripTermsDetails(route *ExecutionRoute) map[string]any {
	return map[string]any{
		"refreshedTerms": map[string]any{
			"routeRevision":   route.RouteRevision,
			"fareRevision":    route.FareRevision,
			"agreedFareMinor": money(route.AgreedFareMinor, route.Currency),
			"stopCount":       len(route.Stops),
		},
	}
}

// insertAmendment writes a new amendment with its first history row, its
// outbox event and its audit row in one transaction; `extra` runs inside the
// same transaction (the idempotent response, a stop's settlement link). A
// second amendment with open money on the same award is refused by the
// database.
func (s *Service) insertAmendment(ctx context.Context, amendment *Amendment, actor Actor, role string, now time.Time, extra func(tx pgx.Tx) error) error {
	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.deps.Store.InsertAmendment(ctx, tx, amendment); err != nil {
			return err
		}
		if err := s.deps.Store.InsertAmendmentHistory(ctx, tx, AmendmentHistoryRow{
			AmendmentID: amendment.ID, AwardID: amendment.AwardID, Event: "proposed",
			ToState: amendment.State, ActorRole: role, ActorID: actor.UserID.String(),
			RouteRevision: amendment.RouteRevision, FareRevision: amendment.FareRevision,
			Detail: map[string]any{
				"kind":                   amendment.Kind,
				"priorFareMinor":         amendment.PriorFareMinor,
				"revisedFareMinor":       amendment.RevisedFareMinor,
				"priorCommissionMinor":   amendment.PriorCommissionMinor,
				"revisedCommissionMinor": amendment.RevisedCommissionMinor,
				"pricing":                amendment.Pricing,
			},
		}); err != nil {
			return err
		}
		if err := s.writeAmendmentEvent(ctx, tx, amendment, "mp.amendment.proposed", role, actor.UserID.String(), now, nil); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: role,
			Action: "mp.amendment.proposed", SubjectType: subjectAmendment, SubjectID: amendment.ID.String(),
			After: map[string]any{
				"kind":             amendment.Kind,
				"awardId":          amendment.AwardID.String(),
				"priorFareMinor":   amendment.PriorFareMinor,
				"revisedFareMinor": amendment.RevisedFareMinor,
				"currency":         amendment.Currency,
				"routeRevision":    amendment.RouteRevision,
				"fareRevision":     amendment.FareRevision,
			},
			Reason: "a post-award change was proposed; the original agreement stays in force until it commits",
		}); err != nil {
			return err
		}
		if extra != nil {
			return extra(tx)
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, errAmendmentOpen) {
			if open, readErr := s.deps.Store.OpenAmendmentForAward(ctx, s.deps.Store.Pool(), amendment.AwardID); readErr == nil {
				return openAmendmentError(open)
			}
			return domain.Errorf(domain.CodeConflict, "another change to this trip is still being resolved").
				WithDetails(map[string]any{"reason": "amendment_open"})
		}
		return asDomainError(err)
	}
	return nil
}

// amendmentReplay answers a replayed amendment POST with the CURRENT view of
// the amendment the key acted on. done reports that the caller must return.
func (s *Service) amendmentReplay(ctx context.Context, actor Actor, scope, key string, body any) (*AmendmentView, int, bool, error) {
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scope, actor.UserID, key, body)
	if err != nil {
		return nil, 0, true, asDomainError(err)
	}
	if replay == nil {
		return nil, 0, false, nil
	}
	var ref amendmentRef
	if err := decodeJSON(replay.Response, &ref); err != nil {
		return nil, 0, true, asDomainError(err)
	}
	amendment, err := s.deps.Store.AmendmentByID(ctx, s.deps.Store.Pool(), ref.AmendmentID)
	if err != nil {
		return nil, 0, true, asDomainError(err)
	}
	role := partyRider
	if actor.IsDriver() {
		role = partyDriver
	}
	return s.amendmentViewFor(ctx, amendment, role), 200, true, nil
}

// ---------------------------------------------------------------------------
// Approve / reject / read.
// ---------------------------------------------------------------------------

// ApproveAmendment records one party's approval, bound to the exact terms
// (amendment id, route revision, fare revision). The driver's approval is
// accepted only while the server confirms them stationary and parked — never
// an in-motion control. The second approval runs the commit saga.
func (s *Service) ApproveAmendment(ctx context.Context, actor Actor, requestID, amendmentID uuid.UUID, req AmendmentDecisionRequest, idempotencyKey string) (*AmendmentView, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	if view, status, done, err := s.amendmentReplay(ctx, actor, scopeAmendmentApprove, idempotencyKey, decisionBody(amendmentID, req)); done {
		return view, status, err
	}
	trip, amendment, err := s.amendmentFor(ctx, actor, requestID, amendmentID)
	if err != nil {
		return nil, 0, err
	}
	if err := bindDecision(amendment, req); err != nil {
		return nil, 0, err
	}
	now := s.now()
	switch amendment.State {
	case machine.MpAmendmentProposed:
		return nil, 0, domain.Errorf(domain.CodeConflict,
			"this change is still securing its funding; approve it once it is ready").
			WithDetails(map[string]any{"amendmentState": amendment.State, "reason": "funding_pending"})
	case machine.MpAmendmentAwaiting:
	default:
		return nil, 0, amendmentClosedError(amendment)
	}
	if !now.Before(amendment.ExpiresAt) && !amendment.bothApproved() {
		expired, _ := s.expireAmendment(ctx, amendment.ID, amendReasonApprovalWindow)
		if expired != nil {
			amendment = expired
		}
		return nil, 0, amendmentClosedError(amendment)
	}
	if trip.role == partyDriver {
		if err := s.requireDriverParked(ctx, actor, trip.request.CityID,
			"park safely before approving a change to the trip", map[string]any{"amendmentId": amendment.ID.String()}); err != nil {
			return nil, 0, err
		}
	}

	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.AmendmentForUpdate(ctx, tx, amendment.ID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpAmendmentAwaiting {
			return amendmentClosedError(locked)
		}
		if err := bindDecision(locked, req); err != nil {
			return err
		}
		next := *locked
		already := (trip.role == partyRider && locked.RiderApprovedAt != nil) ||
			(trip.role == partyDriver && locked.DriverApprovedAt != nil)
		if !already {
			if trip.role == partyRider {
				next.RiderApprovedAt = &now
			} else {
				next.DriverApprovedAt = &now
			}
			if next.bothApproved() {
				// Both bound: the commit saga takes over now, and the sweep
				// resumes it after a crash instead of letting it expire.
				next.Step, next.StepState, next.NextRetryAt = amendStepRevalidate, amendStatePending, sweepBackstop(now)
			}
			saved, err := s.deps.Store.SaveAmendment(ctx, tx, locked, &next)
			if err != nil {
				return err
			}
			if err := s.deps.Store.InsertAmendmentHistory(ctx, tx, AmendmentHistoryRow{
				AmendmentID: saved.ID, AwardID: saved.AwardID, Event: "approved",
				FromState: locked.State, ToState: saved.State, ActorRole: trip.role, ActorID: actor.UserID.String(),
				RouteRevision: saved.RouteRevision, FareRevision: saved.FareRevision,
			}); err != nil {
				return err
			}
			if err := s.writeAmendmentEvent(ctx, tx, saved, "mp.amendment.approved", trip.role, actor.UserID.String(), now,
				map[string]any{"approvedBy": trip.role}); err != nil {
				return err
			}
		}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeAmendmentApprove, actor.UserID, idempotencyKey,
			decisionBody(amendmentID, req), 200, amendmentRef{AmendmentID: amendment.ID})
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}

	advanced, advErr := s.advanceAmendment(ctx, amendment.ID)
	if advanced == nil {
		return nil, 0, asDomainError(advErr)
	}
	if advErr != nil {
		if mapped, ok := domain.AsError(advErr); ok && (advanced.State == machine.MpAmendmentRejected ||
			advanced.State == machine.MpAmendmentFailed || advanced.State == machine.MpAmendmentCompensated) {
			details := map[string]any{}
			for key, value := range mapped.Details {
				details[key] = value
			}
			details["amendmentId"] = advanced.ID.String()
			details["amendmentState"] = advanced.State
			return nil, 0, domain.Errorf(mapped.Code, "%s", mapped.Message).WithDetails(details)
		}
		s.deps.Logger.Warn().Err(advErr).Str("amendment_id", amendment.ID.String()).
			Msg("amendment commit paused; the sweep will resume it")
	}
	return s.amendmentViewFor(ctx, advanced, trip.role), 200, nil
}

// RejectAmendment ends a proposal on either party's say-so and releases
// everything it reserved. A driver's rejection carries NO standing or
// acceptance penalty: nothing here touches the standing ledger, by design.
func (s *Service) RejectAmendment(ctx context.Context, actor Actor, requestID, amendmentID uuid.UUID, req AmendmentDecisionRequest, idempotencyKey string) (*AmendmentView, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	if view, status, done, err := s.amendmentReplay(ctx, actor, scopeAmendmentReject, idempotencyKey, decisionBody(amendmentID, req)); done {
		return view, status, err
	}
	trip, amendment, err := s.amendmentFor(ctx, actor, requestID, amendmentID)
	if err != nil {
		return nil, 0, err
	}
	if err := bindDecision(amendment, req); err != nil {
		return nil, 0, err
	}
	if amendment.Kind != AmendmentKindRoute {
		return nil, 0, domain.Errorf(domain.CodeConflict, "this adjustment was pre-authorized and cannot be rejected").
			WithDetails(map[string]any{"kind": amendment.Kind})
	}
	if trip.role == partyDriver {
		// A rejection is a fare decision too: never in motion. A driver who
		// cannot park simply lets the proposal expire — the same outcome,
		// and still no standing penalty.
		if err := s.requireDriverParked(ctx, actor, trip.request.CityID,
			"park safely before rejecting a change to the trip", map[string]any{"amendmentId": amendment.ID.String()}); err != nil {
			return nil, 0, err
		}
	}
	reason := strings.TrimSpace(req.Reason)
	if len(reason) > 120 {
		reason = reason[:120]
	}
	if reason == "" {
		reason = trip.role + "_rejected"
	}
	now := s.now()
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.AmendmentForUpdate(ctx, tx, amendment.ID)
		if err != nil {
			return err
		}
		switch {
		case locked.State == machine.MpAmendmentRejected:
			return s.deps.Store.SaveIdempotent(ctx, tx, scopeAmendmentReject, actor.UserID, idempotencyKey,
				decisionBody(amendmentID, req), 200, amendmentRef{AmendmentID: locked.ID})
		case locked.State != machine.MpAmendmentProposed && locked.State != machine.MpAmendmentAwaiting:
			return amendmentClosedError(locked)
		case locked.bothApproved():
			return domain.Errorf(domain.CodeConflict, "both parties approved this change; it is committing").
				WithDetails(map[string]any{"amendmentState": locked.State, "reason": "committing"})
		}
		if err := s.closeAmendmentTx(ctx, tx, locked, machine.MpAmendmentRejected, reason, trip.role, actor.UserID.String(), now); err != nil {
			return err
		}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeAmendmentReject, actor.UserID, idempotencyKey,
			decisionBody(amendmentID, req), 200, amendmentRef{AmendmentID: locked.ID})
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	advanced, advErr := s.advanceAmendment(ctx, amendment.ID)
	if advErr != nil {
		s.deps.Logger.Warn().Err(advErr).Str("amendment_id", amendment.ID.String()).
			Msg("releasing a rejected amendment's money is unconfirmed; the sweep will retry")
	}
	if advanced == nil {
		advanced = amendment
	}
	return s.amendmentViewFor(ctx, advanced, trip.role), 200, nil
}

// decisionBody is what an approval/rejection's idempotency fingerprint covers.
func decisionBody(amendmentID uuid.UUID, req AmendmentDecisionRequest) map[string]any {
	return map[string]any{"amendmentId": amendmentID.String(), "decision": req}
}

// bindDecision refuses a decision bound to other terms than the amendment's.
func bindDecision(amendment *Amendment, req AmendmentDecisionRequest) error {
	if req.RouteRevision != amendment.RouteRevision || req.FareRevision != amendment.FareRevision {
		return domain.Errorf(domain.CodeVersionConflict,
			"this decision names other terms than the change on the table; review it again").
			WithDetails(map[string]any{
				"amendmentId": amendment.ID.String(),
				"refreshedTerms": map[string]any{
					"routeRevision":    amendment.RouteRevision,
					"fareRevision":     amendment.FareRevision,
					"revisedFareMinor": money(amendment.RevisedFareMinor, amendment.Currency),
				},
			})
	}
	return nil
}

// amendmentClosedError answers a decision on an amendment that is over.
func amendmentClosedError(amendment *Amendment) *domain.Error {
	return domain.Errorf(domain.CodeConflict, "this change is no longer open").
		WithDetails(map[string]any{
			"amendmentId":    amendment.ID.String(),
			"amendmentState": amendment.State,
			"reason":         amendment.Reason,
		})
}

// amendmentFor resolves one amendment of a trip for a party to it.
func (s *Service) amendmentFor(ctx context.Context, actor Actor, requestID, amendmentID uuid.UUID) (*tripContext, *Amendment, error) {
	trip, err := s.tripFor(ctx, actor, requestID, cityconfig.FlagMarketplaceTripAmendments)
	if err != nil {
		return nil, nil, err
	}
	amendment, err := s.deps.Store.AmendmentByID(ctx, s.deps.Store.Pool(), amendmentID)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && amendment.AwardID != trip.route.AwardID) {
		return nil, nil, domain.Errorf(domain.CodeNotFound, "that change does not exist on this trip")
	}
	if err != nil {
		return nil, nil, asDomainError(err)
	}
	return trip, amendment, nil
}

// GetAmendment answers GET /v1/mp/requests/{id}/amendments/{amendmentId}.
func (s *Service) GetAmendment(ctx context.Context, actor Actor, requestID, amendmentID uuid.UUID) (*AmendmentView, error) {
	trip, amendment, err := s.amendmentFor(ctx, actor, requestID, amendmentID)
	if err != nil {
		return nil, err
	}
	return s.amendmentViewFor(ctx, amendment, trip.role), nil
}

// ListAmendments answers GET /v1/mp/requests/{id}/amendments: every change
// ever proposed on the trip, oldest first, with the committed terms.
func (s *Service) ListAmendments(ctx context.Context, actor Actor, requestID uuid.UUID) (*AmendmentListView, error) {
	trip, err := s.tripFor(ctx, actor, requestID, cityconfig.FlagMarketplaceTripAmendments)
	if err != nil {
		return nil, err
	}
	amendments, err := s.deps.Store.AmendmentsForAward(ctx, s.deps.Store.Pool(), trip.route.AwardID)
	if err != nil {
		return nil, asDomainError(err)
	}
	view := &AmendmentListView{
		RequestID:     trip.request.ID.String(),
		RouteRevision: trip.route.RouteRevision,
		FareRevision:  trip.route.FareRevision,
		Amendments:    make([]*AmendmentView, 0, len(amendments)),
	}
	view.AgreedFareMinor = money(trip.route.AgreedFareMinor, trip.route.Currency)
	for _, amendment := range amendments {
		view.Amendments = append(view.Amendments, s.amendmentViewFor(ctx, amendment, trip.role))
	}
	return view, nil
}

// ---------------------------------------------------------------------------
// The amendment saga, driven by the durable step ledger. Synchronous calls
// and the sweep both use this one function, so a crash resumes.
// ---------------------------------------------------------------------------

// advanceAmendment pushes one amendment as far as it can go and answers its
// latest row. A definite refusal (insufficient funds, a refused commit leg,
// a next-job conflict) moves the row — rejected, or failed — and the loop
// keeps going so the release or compensation runs at once; the refusal is
// answered at the end for the caller to relay. An unknown outcome stops the
// loop with the step parked for the sweep.
func (s *Service) advanceAmendment(ctx context.Context, id uuid.UUID) (*Amendment, error) {
	var refusal error
	for guard := 0; guard < 12; guard++ {
		amendment, err := s.deps.Store.AmendmentByID(ctx, s.deps.Store.Pool(), id)
		if err != nil {
			return nil, asDomainError(err)
		}
		if !amendment.MoneyOpen || amendment.StepState == amendStateStuck {
			return amendment, refusal
		}
		route, err := s.deps.Store.ExecutionRouteByAward(ctx, s.deps.Store.Pool(), amendment.AwardID)
		if err != nil {
			return amendment, asDomainError(err)
		}
		var stepErr error
		var progressed bool
		switch {
		case amendment.State == machine.MpAmendmentProposed:
			progressed, stepErr = s.runAmendmentReserve(ctx, amendment, route)
		case amendment.State == machine.MpAmendmentAwaiting && !amendment.bothApproved():
			return amendment, refusal
		case amendment.State == machine.MpAmendmentAwaiting && amendment.Step == amendStepApply:
			progressed, stepErr = s.applyAmendment(ctx, amendment)
		case amendment.State == machine.MpAmendmentAwaiting:
			progressed, stepErr = s.runAmendmentCommit(ctx, amendment, route)
		case amendment.State == machine.MpAmendmentFailed:
			progressed, stepErr = s.compensateAmendment(ctx, amendment, route)
		case amendment.State == machine.MpAmendmentRejected || amendment.State == machine.MpAmendmentExpired:
			progressed, stepErr = s.releaseAmendmentMoney(ctx, amendment, route)
		default:
			return amendment, fmt.Errorf("amendment %s is in state %s with open money", id, amendment.State)
		}
		if stepErr != nil {
			if isUnknownOutcome(stepErr) {
				latest, readErr := s.deps.Store.AmendmentByID(ctx, s.deps.Store.Pool(), id)
				if readErr != nil {
					return amendment, stepErr
				}
				return latest, stepErr
			}
			if refusal == nil {
				refusal = stepErr
			}
			continue
		}
		if !progressed {
			latest, readErr := s.deps.Store.AmendmentByID(ctx, s.deps.Store.Pool(), id)
			if readErr != nil {
				return amendment, refusal
			}
			return latest, refusal
		}
	}
	amendment, err := s.deps.Store.AmendmentByID(ctx, s.deps.Store.Pool(), id)
	if err != nil {
		return nil, asDomainError(err)
	}
	return amendment, refusal
}

// sweepBackstop is when the sweep may pick up a step the synchronous path is
// driving right now: late enough not to race it, soon enough to resume it
// after a crash.
func sweepBackstop(now time.Time) *time.Time {
	at := now.Add(attemptRetryDelay)
	return &at
}

// parkAmendment records an unknown outcome on the current step: the sweep
// retries the same idempotent call, never a new one.
func (s *Service) parkAmendment(ctx context.Context, amendment *Amendment, cause error) {
	retryAt := s.now().Add(stepBackoff(amendment.Attempts))
	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.AmendmentForUpdate(ctx, tx, amendment.ID)
		if err != nil {
			return err
		}
		next := *locked
		next.StepState = amendStateUnknown
		next.Attempts = locked.Attempts + 1
		next.LastError = truncateError(cause)
		next.NextRetryAt = &retryAt
		_, err = s.deps.Store.SaveAmendment(ctx, tx, locked, &next)
		return err
	})
	if err != nil {
		s.deps.Logger.Error().Err(err).Str("amendment_id", amendment.ID.String()).Msg("could not park the amendment step")
	}
}

func truncateError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if len(message) > 500 {
		message = message[:500]
	}
	return message
}

// isUnknownOutcome reports a money call whose effect this service does not
// know — anything that is not a definite, coded refusal.
func isUnknownOutcome(err error) bool {
	if errors.Is(err, ErrWalletUnknownOutcome) {
		return true
	}
	_, definite := domain.AsError(err)
	return !definite
}

// refusalReason names a definite money refusal on the amendment row.
func refusalReason(err error) string {
	mapped, ok := domain.AsError(err)
	if !ok {
		return "refused"
	}
	switch mapped.Code {
	case domain.CodeInsufficientSpendable:
		return amendReasonDriverSpendable
	case domain.CodeInsufficientFunds:
		return amendReasonRiderFunds
	case domain.CodeVersionConflict:
		return amendReasonWalletTerms
	default:
		return "refused:" + string(mapped.Code)
	}
}

// fundingRequestFor is the funding-amendment body for one amendment.
func fundingRequestFor(amendment *Amendment, route *ExecutionRoute, amendmentID string, prior, next int64) FundingAmendment {
	return FundingAmendment{
		RequesterID:      route.RequesterID,
		AwardID:          route.AwardID,
		AmendmentID:      amendmentID,
		PaymentMethodID:  route.PaymentMethodID,
		PriorAmountMinor: prior,
		NewAmountMinor:   next,
		Currency:         amendment.Currency,
		CityID:           route.CityID,
	}
}

// deltaTermsFor is the commission-delta body for one move of the total.
func deltaTermsFor(amendment *Amendment, prior, next, base int64) DeltaTerms {
	return DeltaTerms{
		AwardID:         amendment.AwardID.String(),
		PriorTotalMinor: money(prior, amendment.Currency),
		NewTotalMinor:   money(next, amendment.Currency),
		NewBaseMinor:    money(base, amendment.Currency),
	}
}

// runAmendmentReserve secures an increase BEFORE approvals: the incremental
// commission on the driver's spendable, then the rider's top-up. A definite
// refusal releases whatever the other leg reserved and rejects the proposal
// (nothing held, nothing changed); an unknown outcome parks the step for the
// sweep, which retries the same amendment id (payment-service replays).
func (s *Service) runAmendmentReserve(ctx context.Context, amendment *Amendment, route *ExecutionRoute) (bool, error) {
	now := s.now()
	if !now.Before(amendment.ExpiresAt) && !amendment.bothApproved() {
		// Nobody can approve it any more: expire and release. (A
		// pre-authorized adjustment keeps converging its reservation.)
		_, err := s.expireAmendment(ctx, amendment.ID, amendReasonApprovalWindow)
		return false, err
	}
	commissionReserved := false
	var refusal error
	if amendment.commissionDelta() > 0 {
		_, err := s.deps.Wallet.ReserveCommissionDelta(ctx, route.ReservationID, amendment.ID.String(),
			deltaTermsFor(amendment, amendment.PriorCommissionMinor, amendment.RevisedCommissionMinor, amendment.RevisedFareMinor),
			amendmentKey("res", amendment.ID))
		switch {
		case err == nil:
			commissionReserved = true
		case isUnknownOutcome(err):
			s.parkAmendment(ctx, amendment, err)
			return false, err
		default:
			refusal = err
		}
	}
	if refusal == nil && amendment.fundingDelta() > 0 && route.securedFunding() {
		_, err := s.deps.Funding.TopUp(ctx, fundingRequestFor(amendment, route, amendment.ID.String(),
			amendment.PriorFundedMinor, amendment.RevisedFundedMinor), amendmentKey("fund", amendment.ID))
		switch {
		case err == nil:
		case isUnknownOutcome(err):
			s.parkAmendment(ctx, amendment, err)
			return false, err
		default:
			refusal = err
		}
	}

	if refusal != nil {
		// Only a leg that DID reserve needs releasing; a definite refusal
		// wrote nothing. The release is idempotent, and if it cannot be
		// confirmed now the row keeps money_open for the sweep.
		releaseOwed := commissionReserved
		if commissionReserved {
			if _, err := s.deps.Wallet.ReleaseCommissionDelta(ctx, route.ReservationID, amendment.ID.String(),
				amendment.AwardID.String(), refusalReason(refusal), amendmentKey("rel", amendment.ID)); err == nil {
				releaseOwed = false
			} else {
				s.deps.Logger.Warn().Err(err).Str("amendment_id", amendment.ID.String()).
					Msg("releasing a refused amendment's commission increment is unconfirmed; the sweep owns it")
			}
		}
		if err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
			locked, err := s.deps.Store.AmendmentForUpdate(ctx, tx, amendment.ID)
			if err != nil {
				return err
			}
			if locked.State != machine.MpAmendmentProposed {
				return nil
			}
			return s.closeAmendmentTx(ctx, tx, locked, machine.MpAmendmentRejected, refusalReason(refusal),
				partySystem, "ride-service", now, closeOptions{moneyOpen: releaseOwed})
		}); err != nil {
			return false, asDomainError(err)
		}
		return false, refusal
	}

	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.AmendmentForUpdate(ctx, tx, amendment.ID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpAmendmentProposed {
			return nil
		}
		next := *locked
		next.State = machine.MpAmendmentAwaiting
		next.Attempts = 0
		next.LastError = ""
		if locked.bothApproved() {
			// A pre-authorized system adjustment commits straight away.
			next.Step, next.StepState, next.NextRetryAt = amendStepRevalidate, amendStatePending, sweepBackstop(now)
		} else {
			expires := locked.ExpiresAt
			next.Step, next.StepState, next.NextRetryAt = amendStepApprovals, amendStatePending, &expires
		}
		saved, err := s.deps.Store.SaveAmendment(ctx, tx, locked, &next)
		if err != nil {
			return err
		}
		if err := s.deps.Store.InsertAmendmentHistory(ctx, tx, AmendmentHistoryRow{
			AmendmentID: saved.ID, AwardID: saved.AwardID, Event: "funding_secured",
			FromState: locked.State, ToState: saved.State, ActorRole: partySystem, ActorID: "ride-service",
			RouteRevision: saved.RouteRevision, FareRevision: saved.FareRevision,
			Detail: map[string]any{
				"commissionReservedMinor": maxInt64(saved.commissionDelta(), 0),
				"riderTopUpMinor":         riderTopUp(saved, route),
			},
		}); err != nil {
			return err
		}
		return s.writeAmendmentEvent(ctx, tx, saved, "mp.amendment.awaiting_approvals", partySystem, "ride-service", now, nil)
	})
	if err != nil {
		return false, asDomainError(err)
	}
	return true, nil
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

// riderTopUp is the funding an increase reserved for the rider (0 for cash
// and for decreases).
func riderTopUp(amendment *Amendment, route *ExecutionRoute) int64 {
	if !route.securedFunding() || amendment.fundingDelta() <= 0 {
		return 0
	}
	return amendment.fundingDelta()
}

// closeOptions tunes how a closing transition leaves the money flags.
type closeOptions struct {
	// moneyOpen keeps the row open for a release still owed.
	moneyOpen bool
}

// closeAmendmentTx moves an open amendment to rejected/expired inside the
// caller's transaction, with history, event and audit. By default the money
// stays open with a release step owed; the release itself runs after commit.
func (s *Service) closeAmendmentTx(ctx context.Context, tx pgx.Tx, locked *Amendment, to, reason, role, actorID string, now time.Time, opts ...closeOptions) error {
	next := *locked
	next.State = to
	next.Reason = reason
	next.ResolvedAt = &now
	next.MoneyOpen = true
	next.Step, next.StepState, next.NextRetryAt = amendStepRelease, amendStatePending, sweepBackstop(now)
	if len(opts) > 0 && !opts[0].moneyOpen {
		next.MoneyOpen = false
		next.Step, next.StepState, next.NextRetryAt = amendStepDone, amendStateDone, nil
	}
	saved, err := s.deps.Store.SaveAmendment(ctx, tx, locked, &next)
	if err != nil {
		return err
	}
	if err := s.deps.Store.InsertAmendmentHistory(ctx, tx, AmendmentHistoryRow{
		AmendmentID: saved.ID, AwardID: saved.AwardID, Event: to,
		FromState: locked.State, ToState: saved.State, ActorRole: role, ActorID: actorID,
		RouteRevision: saved.RouteRevision, FareRevision: saved.FareRevision,
		Detail: map[string]any{"reason": reason},
	}); err != nil {
		return err
	}
	name := "mp.amendment.rejected"
	if to == machine.MpAmendmentExpired {
		name = "mp.amendment.expired"
	}
	if saved.Kind == AmendmentKindStopWaiting && saved.ReferenceStopID != nil {
		// The waiting fee did not settle: the stop says so, and the receipt
		// never shows it.
		if _, err := tx.Exec(ctx, `
			UPDATE mp.execution_stops SET waiting_settlement = $3, version = version + 1, updated_at = now()
			WHERE award_id = $1 AND stop_id = $2`, saved.AwardID, *saved.ReferenceStopID, waitingSettlementFailed); err != nil {
			return err
		}
	}
	if err := s.writeAmendmentEvent(ctx, tx, saved, name, role, actorID, now, map[string]any{"reason": reason}); err != nil {
		return err
	}
	return writeAudit(ctx, tx, AuditRecord{
		ActorID: actorID, ActorRole: role, Action: name,
		SubjectType: subjectAmendment, SubjectID: saved.ID.String(),
		Before: map[string]any{"state": locked.State},
		After:  map[string]any{"state": saved.State, "reason": reason},
		Reason: "the change did not commit; the original agreement stands and anything reserved is released",
	})
}

// expireAmendment ends an unapproved amendment whose window lapsed (or whose
// trip ended), then releases what it reserved.
func (s *Service) expireAmendment(ctx context.Context, id uuid.UUID, reason string) (*Amendment, error) {
	now := s.now()
	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.AmendmentForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if (locked.State != machine.MpAmendmentProposed && locked.State != machine.MpAmendmentAwaiting) || locked.bothApproved() {
			return nil
		}
		return s.closeAmendmentTx(ctx, tx, locked, machine.MpAmendmentExpired, reason, partySystem, "ride-service", now)
	})
	if err != nil {
		return nil, asDomainError(err)
	}
	return s.advanceAmendment(ctx, id)
}

// releaseAmendmentMoney frees everything a rejected or expired amendment may
// hold: its commission increment and its rider top-up. Both calls are safe
// for a leg that never reserved (payment-service closes the amendment), and
// both replay idempotently.
func (s *Service) releaseAmendmentMoney(ctx context.Context, amendment *Amendment, route *ExecutionRoute) (bool, error) {
	reason := amendment.Reason
	if reason == "" {
		reason = amendment.State
	}
	if amendment.commissionDelta() > 0 {
		if _, err := s.deps.Wallet.ReleaseCommissionDelta(ctx, route.ReservationID, amendment.ID.String(),
			amendment.AwardID.String(), reason, amendmentKey("rel", amendment.ID)); err != nil && !isReleaseSettled(err) {
			s.parkAmendment(ctx, amendment, err)
			return false, err
		}
	}
	if amendment.fundingDelta() > 0 && route.securedFunding() {
		if _, err := s.deps.Funding.ReleaseTopUp(ctx, route.AwardID, amendment.ID.String(), reason,
			amendmentKey("frel", amendment.ID)); err != nil && !isReleaseSettled(err) {
			s.parkAmendment(ctx, amendment, err)
			return false, err
		}
	}
	return s.markMoneyClosed(ctx, amendment, "released")
}

// isReleaseSettled treats the award's own end (reversed commission, released
// funding) as a settled release: the award's reversal already handed back
// every open increment and adjustment with it.
func isReleaseSettled(err error) bool {
	mapped, ok := domain.AsError(err)
	return ok && !errors.Is(err, ErrWalletUnknownOutcome) &&
		(mapped.Code == domain.CodeConflict || mapped.Code == domain.CodeNotFound)
}

// markMoneyClosed records that nothing more is owed for an amendment.
func (s *Service) markMoneyClosed(ctx context.Context, amendment *Amendment, event string) (bool, error) {
	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.AmendmentForUpdate(ctx, tx, amendment.ID)
		if err != nil {
			return err
		}
		if !locked.MoneyOpen {
			return nil
		}
		next := *locked
		next.MoneyOpen = false
		next.Step, next.StepState, next.NextRetryAt, next.LastError = amendStepDone, amendStateDone, nil, ""
		saved, err := s.deps.Store.SaveAmendment(ctx, tx, locked, &next)
		if err != nil {
			return err
		}
		return s.deps.Store.InsertAmendmentHistory(ctx, tx, AmendmentHistoryRow{
			AmendmentID: saved.ID, AwardID: saved.AwardID, Event: event,
			FromState: locked.State, ToState: saved.State, ActorRole: partySystem, ActorID: "ride-service",
			RouteRevision: saved.RouteRevision, FareRevision: saved.FareRevision,
		})
	})
	if err != nil {
		return false, asDomainError(err)
	}
	return true, nil
}

// runAmendmentCommit is the commit saga's money half. It revalidates first,
// exactly once and before any money call (the trip still running, its
// visited stops unchanged, the driver's queued next job still honoured),
// then moves the reserved money — for an increase
// the rider's top-up commit then the commission increment's capture; for a
// decrease the commission's linked refund then the rider's partial release —
// each idempotent on the amendment id, each recorded durably as done before
// the next runs. A definite refusal part-way fails the amendment into
// compensation; an unknown outcome parks it for the sweep.
func (s *Service) runAmendmentCommit(ctx context.Context, amendment *Amendment, route *ExecutionRoute) (bool, error) {
	if amendment.Step == amendStepRevalidate {
		if reason, details := s.revalidateAmendment(ctx, amendment, route); reason != "" {
			rejected := false
			if err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
				locked, err := s.deps.Store.AmendmentForUpdate(ctx, tx, amendment.ID)
				if err != nil {
					return err
				}
				if locked.State != machine.MpAmendmentAwaiting || locked.Step != amendStepRevalidate {
					return nil
				}
				rejected = true
				return s.closeAmendmentTx(ctx, tx, locked, machine.MpAmendmentRejected, reason, partySystem, "ride-service", s.now())
			}); err != nil {
				return false, asDomainError(err)
			}
			if !rejected {
				// Another driver of this saga already entered the money
				// phase: re-read the row and follow it.
				return true, nil
			}
			details["reason"] = reason
			message := "the change can no longer be committed"
			if reason == ReasonNextJobConflict {
				message = "this change would break the pickup window promised to the driver's next rider"
			}
			return false, domain.Errorf(domain.CodeConflict, "%s", message).WithDetails(details)
		}
		// Revalidated: the money phase is recorded durably BEFORE the first
		// money call, so a retry after an unknown outcome (or a crash between
		// a call and its markLegDone) converges forward on the same
		// idempotent calls instead of revalidating — and possibly rejecting
		// with a plain release — an amendment whose money may have moved.
		if _, err := s.markStep(ctx, amendment.ID, amendStepCapture); err != nil {
			return false, err
		}
	}

	increase := amendment.fareDelta() > 0
	legs := []string{"commission", "funding"}
	if increase {
		legs = []string{"funding", "commission"}
	}
	current := amendment
	for _, leg := range legs {
		var err error
		switch leg {
		case "funding":
			if current.FundingDone {
				continue
			}
			err = s.commitFundingLeg(ctx, current, route)
		case "commission":
			if current.CommissionDone {
				continue
			}
			err = s.commitCommissionLeg(ctx, current, route)
		}
		if err != nil {
			if isUnknownOutcome(err) {
				s.parkAmendment(ctx, current, err)
				return false, err
			}
			s.failAmendment(ctx, current, leg, err)
			return false, err
		}
		marked, markErr := s.markLegDone(ctx, current.ID, leg)
		if markErr != nil {
			return false, markErr
		}
		current = marked
	}
	return s.markStep(ctx, current.ID, amendStepApply)
}

// commitFundingLeg moves the rider's side of one amendment.
func (s *Service) commitFundingLeg(ctx context.Context, amendment *Amendment, route *ExecutionRoute) error {
	delta := amendment.fundingDelta()
	if !route.securedFunding() || delta == 0 {
		return nil
	}
	if delta > 0 {
		_, err := s.deps.Funding.CommitTopUp(ctx, route.AwardID, amendment.ID.String(), amendment.RevisedFundedMinor,
			amendmentKey("fcom", amendment.ID))
		return err
	}
	_, err := s.deps.Funding.PartialRelease(ctx, fundingRequestFor(amendment, route, amendment.ID.String(),
		amendment.PriorFundedMinor, amendment.RevisedFundedMinor), amendmentKey("prel", amendment.ID))
	return err
}

// commitCommissionLeg moves the driver's commission for one amendment: the
// captured increment, or the linked partial refund — never a re-charge.
func (s *Service) commitCommissionLeg(ctx context.Context, amendment *Amendment, route *ExecutionRoute) error {
	delta := amendment.commissionDelta()
	switch {
	case delta > 0:
		_, err := s.deps.Wallet.CaptureCommissionDelta(ctx, route.ReservationID, amendment.ID.String(),
			amendment.AwardID.String(), money(amendment.RevisedCommissionMinor, amendment.Currency), amendmentKey("cap", amendment.ID))
		return err
	case delta < 0:
		_, err := s.deps.Wallet.RefundCommissionDelta(ctx, route.ReservationID, amendment.ID.String(),
			deltaTermsFor(amendment, amendment.PriorCommissionMinor, amendment.RevisedCommissionMinor, amendment.RevisedFareMinor),
			amendmentKey("ref", amendment.ID))
		return err
	}
	return nil
}

// markLegDone durably records one money leg as done.
func (s *Service) markLegDone(ctx context.Context, id uuid.UUID, leg string) (*Amendment, error) {
	var saved *Amendment
	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.AmendmentForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		next := *locked
		if leg == "funding" {
			next.FundingDone = true
		} else {
			next.CommissionDone = true
		}
		next.StepState, next.Attempts, next.LastError = amendStatePending, 0, ""
		saved, err = s.deps.Store.SaveAmendment(ctx, tx, locked, &next)
		if err != nil {
			return err
		}
		return s.deps.Store.InsertAmendmentHistory(ctx, tx, AmendmentHistoryRow{
			AmendmentID: saved.ID, AwardID: saved.AwardID, Event: leg + "_committed",
			FromState: locked.State, ToState: saved.State, ActorRole: partySystem, ActorID: "ride-service",
			RouteRevision: saved.RouteRevision, FareRevision: saved.FareRevision,
		})
	})
	if err != nil {
		return nil, asDomainError(err)
	}
	return saved, nil
}

// markStep moves the saga to its next step.
func (s *Service) markStep(ctx context.Context, id uuid.UUID, step string) (bool, error) {
	now := s.now()
	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.AmendmentForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		next := *locked
		next.Step, next.StepState, next.NextRetryAt = step, amendStatePending, sweepBackstop(now)
		_, err = s.deps.Store.SaveAmendment(ctx, tx, locked, &next)
		return err
	})
	if err != nil {
		return false, asDomainError(err)
	}
	return true, nil
}

// failAmendment records a definite refusal part-way through the commit: the
// amendment is failed and the compensation step owns what already moved.
func (s *Service) failAmendment(ctx context.Context, amendment *Amendment, leg string, cause error) {
	now := s.now()
	reason := leg + "_" + refusalReason(cause)
	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.AmendmentForUpdate(ctx, tx, amendment.ID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpAmendmentAwaiting {
			return nil
		}
		next := *locked
		next.State = machine.MpAmendmentFailed
		next.Reason = reason
		next.Step, next.StepState, next.NextRetryAt = amendStepCompensate, amendStatePending, sweepBackstop(now)
		next.LastError = truncateError(cause)
		saved, err := s.deps.Store.SaveAmendment(ctx, tx, locked, &next)
		if err != nil {
			return err
		}
		if err := s.deps.Store.InsertAmendmentHistory(ctx, tx, AmendmentHistoryRow{
			AmendmentID: saved.ID, AwardID: saved.AwardID, Event: "failed",
			FromState: locked.State, ToState: saved.State, ActorRole: partySystem, ActorID: "ride-service",
			RouteRevision: saved.RouteRevision, FareRevision: saved.FareRevision,
			Detail: map[string]any{"leg": leg, "reason": reason, "fundingDone": saved.FundingDone, "commissionDone": saved.CommissionDone},
		}); err != nil {
			return err
		}
		if err := s.writeAmendmentEvent(ctx, tx, saved, "mp.amendment.failed", partySystem, "ride-service", now,
			map[string]any{"reason": reason}); err != nil {
			return err
		}
		return writeAudit(ctx, tx, AuditRecord{
			ActorID: "ride-service", ActorRole: partySystem, Action: "mp.amendment.failed",
			SubjectType: subjectAmendment, SubjectID: saved.ID.String(),
			Before: map[string]any{"state": locked.State},
			After:  map[string]any{"state": saved.State, "reason": reason, "fundingDone": saved.FundingDone, "commissionDone": saved.CommissionDone},
			Reason: "a commit step was refused part-way; the compensation reverses what moved",
		})
	})
	if err != nil {
		s.deps.Logger.Error().Err(err).Str("amendment_id", amendment.ID.String()).Msg("could not record the failed amendment")
	}
}

// compensateAmendment reverses what a failed commit already moved, each
// reversal a linked record of its own (the compensation id), then marks the
// amendment compensated. Legs that only reserved are released.
func (s *Service) compensateAmendment(ctx context.Context, amendment *Amendment, route *ExecutionRoute) (bool, error) {
	compID := compensationID(amendment.ID)
	var err error
	if amendment.fareDelta() > 0 {
		if amendment.FundingDone && route.securedFunding() && amendment.fundingDelta() > 0 {
			// The committed top-up is offset by a partial release back to
			// the pre-amendment funding — a release can always land.
			_, err = s.deps.Funding.PartialRelease(ctx, fundingRequestFor(amendment, route, compID,
				amendment.RevisedFundedMinor, amendment.PriorFundedMinor), amendmentKey("cprel", amendment.ID))
		} else if !amendment.FundingDone && route.securedFunding() && amendment.fundingDelta() > 0 {
			_, err = s.deps.Funding.ReleaseTopUp(ctx, route.AwardID, amendment.ID.String(), amendment.Reason, amendmentKey("frel", amendment.ID))
			if isReleaseSettled(err) {
				err = nil
			}
		}
		if err == nil && amendment.commissionDelta() > 0 && !amendment.CommissionDone {
			_, err = s.deps.Wallet.ReleaseCommissionDelta(ctx, route.ReservationID, amendment.ID.String(),
				amendment.AwardID.String(), amendment.Reason, amendmentKey("rel", amendment.ID))
			if isReleaseSettled(err) {
				err = nil
			}
		}
	} else if amendment.CommissionDone && amendment.commissionDelta() < 0 {
		// A refunded decrease whose funding leg was refused: restore the
		// captured total with a linked increment of its own.
		terms := deltaTermsFor(amendment, amendment.RevisedCommissionMinor, amendment.PriorCommissionMinor, amendment.PriorFareMinor)
		if _, err = s.deps.Wallet.ReserveCommissionDelta(ctx, route.ReservationID, compID, terms, amendmentKey("cres", amendment.ID)); err == nil {
			_, err = s.deps.Wallet.CaptureCommissionDelta(ctx, route.ReservationID, compID, amendment.AwardID.String(),
				money(amendment.PriorCommissionMinor, amendment.Currency), amendmentKey("ccap", amendment.ID))
		}
	}
	if err != nil {
		if isUnknownOutcome(err) {
			s.parkAmendment(ctx, amendment, err)
			return false, err
		}
		// A definite refusal of a compensation leg needs a human: it stays
		// failed, money open, alarmed loudly — never retried into a loop.
		s.deps.Logger.Error().Err(err).Str("amendment_id", amendment.ID.String()).
			Msg("amendment compensation refused; ops must reconcile this award's adjustments")
		_ = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
			locked, lockErr := s.deps.Store.AmendmentForUpdate(ctx, tx, amendment.ID)
			if lockErr != nil {
				return lockErr
			}
			next := *locked
			next.StepState, next.LastError, next.NextRetryAt = amendStateStuck, truncateError(err), nil
			_, saveErr := s.deps.Store.SaveAmendment(ctx, tx, locked, &next)
			return saveErr
		})
		return false, err
	}

	now := s.now()
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.AmendmentForUpdate(ctx, tx, amendment.ID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpAmendmentFailed {
			return nil
		}
		next := *locked
		next.State = machine.MpAmendmentCompensated
		next.MoneyOpen = false
		next.ResolvedAt = &now
		next.Step, next.StepState, next.NextRetryAt, next.LastError = amendStepDone, amendStateDone, nil, ""
		saved, err := s.deps.Store.SaveAmendment(ctx, tx, locked, &next)
		if err != nil {
			return err
		}
		if err := s.deps.Store.InsertAmendmentHistory(ctx, tx, AmendmentHistoryRow{
			AmendmentID: saved.ID, AwardID: saved.AwardID, Event: "compensated",
			FromState: locked.State, ToState: saved.State, ActorRole: partySystem, ActorID: "ride-service",
			RouteRevision: saved.RouteRevision, FareRevision: saved.FareRevision,
			Detail: map[string]any{"compensationId": compID},
		}); err != nil {
			return err
		}
		if err := s.writeAmendmentEvent(ctx, tx, saved, "mp.amendment.compensated", partySystem, "ride-service", now,
			map[string]any{"compensationId": compID}); err != nil {
			return err
		}
		if saved.Kind == AmendmentKindStopWaiting && saved.ReferenceStopID != nil {
			if _, err := tx.Exec(ctx, `
				UPDATE mp.execution_stops SET waiting_settlement = $3, version = version + 1, updated_at = now()
				WHERE award_id = $1 AND stop_id = $2`, saved.AwardID, *saved.ReferenceStopID, waitingSettlementFailed); err != nil {
				return err
			}
		}
		return writeAudit(ctx, tx, AuditRecord{
			ActorID: "ride-service", ActorRole: partySystem, Action: "mp.amendment.compensated",
			SubjectType: subjectAmendment, SubjectID: saved.ID.String(),
			Before: map[string]any{"state": locked.State},
			After:  map[string]any{"state": saved.State, "compensationId": compID},
			Reason: "the partial commit was reversed with linked adjustments; the original agreement stands",
		})
	})
	if err != nil {
		return false, asDomainError(err)
	}
	return true, nil
}

// revalidateAmendment is the commit saga's first check. It answers a
// rejection reason (and details) or "" when the amendment may commit.
func (s *Service) revalidateAmendment(ctx context.Context, amendment *Amendment, route *ExecutionRoute) (string, map[string]any) {
	details := map[string]any{"amendmentId": amendment.ID.String()}
	if route.RouteRevision != amendment.BaseRouteRevision || route.FareRevision != amendment.BaseFareRevision {
		return amendReasonRouteChanged, details
	}
	if amendment.Kind == AmendmentKindStopWaiting {
		// A waiting fee was earned by a stop that already happened; it
		// settles whatever the ride has done since.
		return "", nil
	}
	ride, err := s.deps.Store.Move().RideByID(ctx, s.deps.Store.Pool(), route.ExecutionID)
	if err != nil {
		details["detail"] = "the execution ride cannot be read"
		return amendReasonExecutionEnded, details
	}
	if !machine.IsRiderActive(ride.State) {
		details["rideState"] = ride.State
		return amendReasonExecutionEnded, details
	}
	stops, err := s.deps.Store.ExecutionStops(ctx, s.deps.Store.Pool(), route.AwardID)
	if err != nil {
		return amendReasonRouteChanged, details
	}
	// Every stop the driver has reached since the proposal must still be in
	// the proposal — and ahead of every stop not yet reached: history is
	// never rewritten, nor reordered behind the future.
	visited := map[uuid.UUID]bool{}
	for _, stop := range stops {
		if stop.visited() {
			visited[stop.StopID] = true
		}
	}
	seen, future := 0, false
	for _, stop := range amendment.Stops {
		switch {
		case visited[stop.StopID] && future:
			details["stopId"] = stop.StopID.String()
			return amendReasonRouteChanged, details
		case visited[stop.StopID]:
			seen++
		default:
			future = true
		}
	}
	if seen != len(visited) {
		return amendReasonRouteChanged, details
	}
	if amendment.Kind == AmendmentKindRoute {
		if conflict := s.nextJobConflict(ctx, route, stops, amendment.Stops, amendment.Dropoff); conflict != nil {
			return ReasonNextJobConflict, conflict
		}
	}
	return "", nil
}

// writeAmendmentEvent appends one mp.amendment.* outbox row.
func (s *Service) writeAmendmentEvent(ctx context.Context, tx pgx.Tx, amendment *Amendment, name, role, actorID string, now time.Time, extra map[string]any) error {
	payload := map[string]any{
		"amendmentId":            amendment.ID.String(),
		"awardId":                amendment.AwardID.String(),
		"requestId":              amendment.RequestID.String(),
		"executionId":            amendment.ExecutionID.String(),
		"kind":                   amendment.Kind,
		"state":                  amendment.State,
		"routeRevision":          amendment.RouteRevision,
		"fareRevision":           amendment.FareRevision,
		"priorFareMinor":         amendment.PriorFareMinor,
		"revisedFareMinor":       amendment.RevisedFareMinor,
		"commissionDeltaMinor":   amendment.commissionDelta(),
		"riderFundingDeltaMinor": amendment.fundingDelta(),
		"currency":               amendment.Currency,
		"expiresAt":              amendment.ExpiresAt,
	}
	for key, value := range extra {
		payload[key] = value
	}
	return writeEvent(ctx, tx, Event{
		Name:           name,
		AggregateType:  subjectAmendment,
		AggregateID:    amendment.ID.String(),
		ToVersion:      amendment.Version,
		CityID:         amendment.CityID,
		ActorType:      actorTypeOf(role),
		ActorID:        actorID,
		IdempotencyKey: eventKey(name, amendment.ID.String(), itoa(amendment.Version), role),
		OccurredAt:     now,
		Payload:        payload,
	})
}
