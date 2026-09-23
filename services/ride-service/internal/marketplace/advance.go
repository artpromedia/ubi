package marketplace

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// ADVANCE DRIVER RESERVATIONS (A03, product B).
//
// An advance request takes offers NOW for a FUTURE pickup window. Eligible
// drivers bid manually while parked (the stationary gate and the
// cleared-balance commission hold apply exactly as for any bid), the
// requester selects one specific driver, and the award saga captures the
// winning 10% commission ONCE at that advance award. The booking then lives
// on a durable calendar (mp.advance_bookings) that is SEPARATE from the live
// current/next claim slots: it enters them only at activation near pickup,
// and activation never charges the commission again.
//
// Rider funding across the booking horizon (explicit policy):
//   - wallet: secured with the existing wallet funding authorization (a
//     durable ledger reservation keyed by the award) at the advance award
//     when the pickup is within the market's funding horizon; otherwise the
//     booking is payment_pending and the worker secures it when the pickup
//     enters the horizon, failing the booking (commission returned, nothing
//     charged) if it is still unsecured at the funding deadline;
//   - cash: explicitly unsecured, collected at the trip;
//   - any other method fails closed at payment-service (no provider
//     authorization exists that could lapse before pickup).
// Every hold is therefore bounded by the booking horizon.

// advisoryDriverCalendar serialises writes to one driver's booking calendar
// so the travel-time check between consecutive bookings is not
// check-then-act; the exclusion constraints remain the final authority on
// overlap.
const advisoryDriverCalendar = int32(0x6d704443) // "mpDC"

// Booking failure reasons (contract MpBookingFailureSchema.reason).
const (
	BookingFailDriverWithdrew     = "driver_withdrew"
	BookingFailDriverIneligible   = "driver_ineligible"
	BookingFailReconfirmMissed    = "reconfirmation_missed"
	BookingFailFundingNotSecured  = "funding_not_secured"
	BookingFailDriverUnavailable  = "driver_unavailable"
	BookingFailDriverOnTrip       = "driver_on_running_trip"
	BookingFailExecutionBlocked   = "execution_blocked"
	BookingFailAwardCancelled     = "award_cancelled"
	BookingFailTripCancelled      = "trip_cancelled"
	BookingCancelledByRider       = "rider_cancelled"
	bookingRequestCloseReason     = "booking_failed"
	bookingRequestCancelledReason = "cancelled"
)

// placeOf turns a stored area back into a routable place.
func placeOf(area Area) domain.Place {
	return domain.Place{Lat: area.Lat, Lng: area.Lng, Address: area.Label}
}

// stopInputsOf turns a stored route's stops back into priceable inputs (the
// re-priced quote assigns fresh stop ids).
func stopInputsOf(stops []RouteStop) []StopInput {
	if len(stops) == 0 {
		return nil
	}
	out := make([]StopInput, 0, len(stops))
	for _, stop := range stops {
		dwell := stop.DwellSec
		out = append(out, StopInput{Lat: stop.Lat, Lng: stop.Lng, Label: stop.Label, Purpose: stop.Purpose, DwellSec: &dwell})
	}
	return out
}

// newRequestFromQuote builds an open request from a server-priced quote. The
// bounds are the quote's (the ceiling possibly tightened by the rider's own
// approval); nothing here comes from a client.
func newRequestFromQuote(quote *Quote, requesterID uuid.UUID, requestedMinor, maxMinor int64, paymentMethodID string, policy *cityconfig.MarketplacePolicy, expiresAt time.Time) *Request {
	request := &Request{
		ID:                uuid.New(),
		QuoteID:           quote.ID,
		RequesterID:       requesterID,
		CityID:            quote.CityID,
		Service:           quote.Service,
		VehicleClass:      quote.VehicleClass,
		Currency:          quote.Currency,
		State:             machine.MpRequestOpen,
		Revision:          1,
		Version:           1,
		RequestedMinor:    requestedMinor,
		SuggestedMinor:    quote.SuggestedMinor,
		MinMinor:          quote.MinMinor,
		MaxMinor:          maxMinor,
		Pickup:            quote.Pickup,
		Dropoff:           quote.Dropoff,
		Stops:             quote.Stops,
		RouteRevision:     1,
		RouteFingerprint:  quote.RouteFingerprint,
		RoutedDistanceM:   quote.RoutedDistanceM,
		RoutedDurationSec: quote.RoutedDurationSec,
		StopsDwellSec:     quote.StopsDwellSec,
		PaymentMethodID:   paymentMethodID,
		EnvelopeRadiusM:   policy.SearchEnvelope.InitialRadiusMeters,
		EnvelopeEtaSec:    policy.SearchEnvelope.InitialPickupEtaSec,
		PolicyVersion:     policy.PolicyVersion,
		PricingVersion:    quote.PricingVersion,
		ExpiresAt:         expiresAt,
		BookingKind:       BookingKindImmediate,
	}
	if request.RouteFingerprint == "" {
		request.RouteFingerprint = routeFingerprint(request.Pickup, request.Stops, request.Dropoff)
	}
	return request
}

// advanceRequestExpiry is when an advance request stops taking offers: its
// offer window, but never later than the reconfirmation opening (an award
// that late could not complete the booking's own lifecycle).
func advanceRequestExpiry(now, pickupAt time.Time, policy *cityconfig.AdvanceReservationPolicy) time.Time {
	expires := now.Add(time.Duration(policy.OfferWindowSec) * time.Second)
	latest := pickupAt.Add(-time.Duration(policy.ReconfirmOpensSec) * time.Second)
	if expires.After(latest) {
		expires = latest
	}
	return expires
}

// CreateAdvanceRequestBody is POST /v1/mp/advance-requests
// (MpCreateAdvanceRequestSchema).
type CreateAdvanceRequestBody struct {
	QuoteID            uuid.UUID     `json:"quoteId"`
	RequestedFareMinor Money         `json:"requestedFareMinor"`
	PaymentMethodID    string        `json:"paymentMethodId"`
	Schedule           ScheduleInput `json:"schedule"`
}

// CreateAdvanceRequest publishes an advance-booking request (product B):
// drivers may offer for the future pickup window from now on; no driver is
// secured until the requester selects an offer.
func (s *Service) CreateAdvanceRequest(ctx context.Context, actor Actor, body CreateAdvanceRequestBody, idempotencyKey string) (*RequestView, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only a requester can book a driver in advance")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeAdvanceCreate, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view RequestView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}

	quote, config, policy, err := s.bookableQuote(ctx, actor, body.QuoteID, body.RequestedFareMinor, body.PaymentMethodID)
	if err != nil {
		// A concurrent retry of this same key may have consumed the quote
		// since the lookup above: its answer is this call's answer.
		if late, lookupErr := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeAdvanceCreate, actor.UserID, idempotencyKey, body); lookupErr == nil && late != nil {
			var view RequestView
			if err := decodeJSON(late.Response, &view); err != nil {
				return nil, 0, asDomainError(err)
			}
			return &view, late.StatusCode, nil
		}
		return nil, 0, err
	}
	if err := s.requireFlag(ctx, cityconfig.FlagMarketplaceAdvanceReservations, actor, quote.CityID); err != nil {
		return nil, 0, err
	}
	advance, err := policy.AdvanceReservationPolicyFor(quote.CityID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	schedule, _, err := resolveSchedule(body.Schedule, config.Timezone, windowBounds{
		minSec: advance.MinWindowSec, defaultSec: advance.DefaultWindowSec, maxSec: advance.MaxWindowSec,
	})
	if err != nil {
		return nil, 0, err
	}
	now := s.now()
	// The booking horizon bounds every hold this booking can create.
	if err := requireLead(schedule.PickupAt, now, advance.MinLeadSec, advance.BookingHorizonSec); err != nil {
		return nil, 0, err
	}

	request := newRequestFromQuote(quote, actor.UserID, body.RequestedFareMinor.AmountMinor, quote.MaxMinor,
		body.PaymentMethodID, policy, advanceRequestExpiry(now, schedule.PickupAt, advance))
	request.BookingKind = BookingKindAdvance
	request.Schedule = schedule
	windowStart, windowEnd := schedule.PickupAt, schedule.WindowEnd
	request.PickupWindowStart, request.PickupWindowEnd = &windowStart, &windowEnd

	var view *RequestView
	var replayed *IdempotentResult
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.deps.Store.AcquireCapLock(ctx, tx, advisoryRequesterOpenCap, actor.UserID); err != nil {
			return err
		}
		// Re-checked under the requester's lock: a concurrent retry of this
		// same key that committed first is replayed, not refused.
		if replayed, err = s.deps.Store.LookupIdempotent(ctx, tx, scopeAdvanceCreate, actor.UserID, idempotencyKey, body); err != nil || replayed != nil {
			return err
		}
		open, err := s.deps.Store.OpenAdvanceRequestCount(ctx, tx, actor.UserID)
		if err != nil {
			return err
		}
		if open >= advance.MaxOpenPerRequester {
			return domain.Errorf(domain.CodeRequestCapReached,
				"you already have %d advance requests taking offers; close one first", open).
				WithDetails(map[string]any{"openRequests": open, "maximum": advance.MaxOpenPerRequester})
		}
		if err := s.writePublishedRequest(ctx, tx, request, quote, publisher{
			actorType: "rider",
			actorID:   actor.UserID.String(),
			actorRole: actor.Role,
			reason:    "requester published an advance-booking request; no driver is secured until an offer is selected",
		}, now); err != nil {
			return err
		}
		view = requestViewOf(request)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeAdvanceCreate, actor.UserID, idempotencyKey, body, 201, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replayed != nil {
		var stored RequestView
		if err := decodeJSON(replayed.Response, &stored); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &stored, replayed.StatusCode, nil
	}
	return view, 201, nil
}

// ---------------------------------------------------------------------------
// The booking calendar.
// ---------------------------------------------------------------------------

// bookingPlan is where a new booking would sit on a driver's calendar: its
// occupied interval (pickup window + routed trip + uncertainty buffers) and
// the neighbouring bookings whose travel time to/from it was verified.
type bookingPlan struct {
	windowStart   time.Time
	windowEnd     time.Time
	tripSec       int64
	occupiedStart time.Time
	occupiedEnd   time.Time
	previousID    *uuid.UUID
	nextID        *uuid.UUID
	// vehicle is the fleet vehicle resolved for the interval (A05 FL-4).
	vehicle resolvedVehicle
}

// calendarConflict is the structured refusal of a booking the calendar
// cannot hold.
func calendarConflict(detail string, extra map[string]any) *domain.Error {
	details := map[string]any{"reason": ReasonCalendarConflict, "detail": detail}
	for key, value := range extra {
		details[key] = value
	}
	return domain.Errorf(domain.CodeSlotUnavailable, "this pickup window does not fit your booking calendar").
		WithDetails(details)
}

// bookingInterval is a request's calendar interval under the policy.
func bookingInterval(request *Request, policy *cityconfig.AdvanceReservationPolicy) (time.Time, time.Time, int64, error) {
	if request.PickupWindowStart == nil || request.PickupWindowEnd == nil {
		return time.Time{}, time.Time{}, 0, errors.New("the request has no pickup window")
	}
	trip := request.RoutedDurationSec + request.StopsDwellSec
	start := request.PickupWindowStart.Add(-time.Duration(policy.PreBufferSec) * time.Second)
	end := request.PickupWindowEnd.Add(time.Duration(trip+int64(policy.PostBufferSec)) * time.Second)
	return start, end, trip, nil
}

// planBooking checks a request against a driver's committed bookings: no
// overlap of the buffered intervals, and enough routed travel time from the
// previous booking's dropoff to this pickup and from this dropoff to the
// next booking's pickup. Routing happens here, before any transaction.
func (s *Service) planBooking(ctx context.Context, driverID uuid.UUID, request *Request, policy *cityconfig.AdvanceReservationPolicy) (*bookingPlan, error) {
	start, end, trip, err := bookingInterval(request, policy)
	if err != nil {
		return nil, err
	}
	plan := &bookingPlan{
		windowStart: *request.PickupWindowStart, windowEnd: *request.PickupWindowEnd,
		tripSec: trip, occupiedStart: start, occupiedEnd: end,
	}
	neighbours, err := s.deps.Store.CalendarNeighbours(ctx, s.deps.Store.Pool(), driverID, start, end)
	if err != nil {
		return nil, err
	}
	if len(neighbours.overlapping) > 0 {
		return nil, calendarConflict("overlaps another booking on your calendar",
			map[string]any{"conflictingWindowStart": neighbours.overlapping[0].WindowStart})
	}
	if previous := neighbours.previous; previous != nil {
		travel, err := s.routeSeconds(ctx, previous.Dropoff.Lat, previous.Dropoff.Lng, request.Pickup.Lat, request.Pickup.Lng)
		if err != nil {
			return nil, err
		}
		if previous.OccupiedEnd.Add(time.Duration(travel) * time.Second).After(start) {
			return nil, calendarConflict("not enough time to travel from your previous booking",
				map[string]any{"travelSec": travel, "previousEndsAt": previous.OccupiedEnd})
		}
		id := previous.ID
		plan.previousID = &id
	}
	if next := neighbours.next; next != nil {
		travel, err := s.routeSeconds(ctx, request.Dropoff.Lat, request.Dropoff.Lng, next.Pickup.Lat, next.Pickup.Lng)
		if err != nil {
			return nil, err
		}
		if end.Add(time.Duration(travel) * time.Second).After(next.OccupiedStart) {
			return nil, calendarConflict("not enough time to travel to your next booking",
				map[string]any{"travelSec": travel, "nextStartsAt": next.OccupiedStart})
		}
		id := next.ID
		plan.nextID = &id
	}
	return plan, nil
}

// lockCalendar re-checks a plan inside the booking transaction, under the
// driver's calendar lock: the neighbours it verified must still be the
// neighbours, and nothing may overlap. A calendar that moved since answers
// a retryable conflict; the exclusion constraints back this up.
func (s *Service) lockCalendar(ctx context.Context, tx pgx.Tx, driverID uuid.UUID, plan *bookingPlan) error {
	if err := s.deps.Store.AcquireCapLock(ctx, tx, advisoryDriverCalendar, driverID); err != nil {
		return err
	}
	neighbours, err := s.deps.Store.CalendarNeighbours(ctx, tx, driverID, plan.occupiedStart, plan.occupiedEnd)
	if err != nil {
		return err
	}
	if len(neighbours.overlapping) > 0 {
		return calendarConflict("overlaps another booking on the driver's calendar", nil)
	}
	sameID := func(want *uuid.UUID, got *AdvanceBooking) bool {
		if want == nil || got == nil {
			return want == nil && got == nil
		}
		return *want == got.ID
	}
	if !sameID(plan.previousID, neighbours.previous) || !sameID(plan.nextID, neighbours.next) {
		return calendarConflict("the driver's calendar changed while this was in flight; try again", nil)
	}
	return nil
}

// newBooking builds the calendar row an advance award holds.
func newBooking(award *Award, request *Request, plan *bookingPlan, policy *cityconfig.AdvanceReservationPolicy, now time.Time) *AdvanceBooking {
	before := func(sec int) time.Time { return plan.windowStart.Add(-time.Duration(sec) * time.Second) }
	return &AdvanceBooking{
		ID:                 uuid.New(),
		AwardID:            award.ID,
		RequestID:          request.ID,
		BidID:              award.BidID,
		DriverID:           award.DriverID,
		RequesterID:        request.RequesterID,
		CityID:             request.CityID,
		State:              machine.MpBookingHeld,
		Version:            1,
		FundingState:       BookingFundingPending,
		PaymentMethodID:    request.PaymentMethodID,
		Currency:           request.Currency,
		FareMinor:          award.FareMinor,
		CommissionMinor:    award.CommissionMinor,
		WindowStart:        plan.windowStart,
		WindowEnd:          plan.windowEnd,
		TripDurationSec:    plan.tripSec,
		OccupiedStart:      plan.occupiedStart,
		OccupiedEnd:        plan.occupiedEnd,
		Pickup:             request.Pickup,
		Dropoff:            request.Dropoff,
		FundingDueAt:       before(policy.FundingHorizonSec),
		FundingDeadline:    before(policy.FundingDeadlineSec),
		ReconfirmOpensAt:   before(policy.ReconfirmOpensSec),
		ReconfirmDeadline:  before(policy.ReconfirmDeadlineSec),
		ActivationAt:       before(policy.ActivationLeadSec),
		ActivationDeadline: plan.windowStart,
		CreatedAt:          now,
	}
}

// writeBookingEvent appends one mp.advance_booking.* outbox row.
func (s *Service) writeBookingEvent(ctx context.Context, tx pgx.Tx, b *AdvanceBooking, name, actorType, actorID string, now time.Time, extra map[string]any, keyParts ...string) error {
	payload := map[string]any{
		"bookingId":    b.ID.String(),
		"awardId":      b.AwardID.String(),
		"requestId":    b.RequestID.String(),
		"driverId":     b.DriverID.String(),
		"requesterId":  b.RequesterID.String(),
		"state":        b.State,
		"fundingState": b.FundingState,
		"windowStart":  b.WindowStart.Format(time.RFC3339),
		"windowEnd":    b.WindowEnd.Format(time.RFC3339),
	}
	for key, value := range extra {
		payload[key] = value
	}
	if len(keyParts) == 0 {
		keyParts = []string{b.ID.String()}
	}
	return writeEvent(ctx, tx, Event{
		Name:           name,
		AggregateType:  subjectBooking,
		AggregateID:    b.ID.String(),
		ToVersion:      b.Version,
		CityID:         b.CityID,
		ActorType:      actorType,
		ActorID:        actorID,
		IdempotencyKey: eventKey(name, keyParts...),
		OccurredAt:     now,
		Payload:        payload,
	})
}

// evaluateAdvance is the eligibility branch for an advance-booking request:
// the account, session, city, class and location gates already ran; here the
// advance flag, the stationary gate (manual offers are made parked, always)
// and the booking calendar decide. Live position is not an ETA input — the
// pickup is in the future — so no pickup is predicted.
func (s *Service) evaluateAdvance(ctx context.Context, actor Actor, request *Request, policy *cityconfig.MarketplacePolicy, result *EligibilityView, refuse refuseFunc, now time.Time) (*EligibilityView, error) {
	if !s.flagOn(ctx, cityconfig.FlagMarketplaceAdvanceReservations, actor.UserID.String(), request.CityID) {
		return refuse(ReasonAdvanceDisabled), nil
	}
	advance, err := policy.AdvanceReservationPolicyFor(request.CityID)
	if err != nil {
		return refuse(ReasonAdvanceDisabled), nil
	}
	if ok, code := s.stationaryVerdict(ctx, actor.UserID, policy.Stationary, now); !ok {
		return refuse(code), nil
	}
	if _, err := s.planBooking(ctx, actor.UserID, request, advance); err != nil {
		if mapped, ok := domain.AsError(err); ok && mapped.Code == domain.CodeSlotUnavailable {
			return refuse(ReasonCalendarConflict), nil
		}
		return refuse(ReasonRoutingUnavailable), nil
	}
	slot := SlotAdvance
	result.Eligible = true
	result.Slot = &slot
	return result, nil
}

// ---------------------------------------------------------------------------
// Booking commands.
// ---------------------------------------------------------------------------

// bookingForParty reads a booking its rider or its driver may see; anyone
// else gets "not found".
func (s *Service) bookingForParty(ctx context.Context, actor Actor, id uuid.UUID) (*AdvanceBooking, string, error) {
	b, err := s.deps.Store.BookingByID(ctx, s.deps.Store.Pool(), id)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, "", domain.Errorf(domain.CodeNotFound, "that booking does not exist")
	}
	if err != nil {
		return nil, "", asDomainError(err)
	}
	switch {
	case actor.IsRider() && b.RequesterID == actor.UserID:
		return b, viewerRider, nil
	case actor.IsDriver() && b.DriverID == actor.UserID:
		return b, viewerDriver, nil
	}
	return nil, "", domain.Errorf(domain.CodeNotFound, "that booking does not exist")
}

// bookingView renders a booking with its request for one viewer.
func (s *Service) bookingView(ctx context.Context, b *AdvanceBooking, viewer string) *AdvanceBookingView {
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), b.RequestID)
	vehicleClass := ""
	if err == nil {
		vehicleClass = request.VehicleClass
	} else {
		request = nil
	}
	view := s.withVerifiedDriver(ctx, bookingViewOf(b, request, vehicleClass, viewer), b, vehicleClass)
	return s.withFleetState(ctx, s.withBookingReminders(ctx, view, b.CityID), b, viewer)
}

// GetBooking answers GET /v1/mp/advance-bookings/{id}.
func (s *Service) GetBooking(ctx context.Context, actor Actor, id uuid.UUID) (*AdvanceBookingView, error) {
	b, viewer, err := s.bookingForParty(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	return s.bookingView(ctx, b, viewer), nil
}

// ListBookings answers GET /v1/mp/advance-bookings: the rider's bookings, or
// the driver's.
func (s *Service) ListBookings(ctx context.Context, actor Actor) ([]*AdvanceBookingView, error) {
	since := s.now().Add(-24 * time.Hour)
	var rows []*AdvanceBooking
	var err error
	viewer := viewerRider
	switch {
	case actor.IsRider():
		rows, err = s.deps.Store.BookingsForRequester(ctx, s.deps.Store.Pool(), actor.UserID, since, 100)
	case actor.IsDriver():
		viewer = viewerDriver
		rows, err = s.deps.Store.BookingsForDriver(ctx, s.deps.Store.Pool(), actor.UserID, since, 100)
	default:
		return nil, domain.Errorf(domain.CodeForbidden, "only a rider or a driver has bookings")
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	views := make([]*AdvanceBookingView, 0, len(rows))
	for _, b := range rows {
		views = append(views, s.bookingView(ctx, b, viewer))
	}
	return views, nil
}

// DriverCalendar answers GET /v1/mp/driver/calendar: the driver's committed
// future bookings, separate from their live current/next jobs.
func (s *Service) DriverCalendar(ctx context.Context, actor Actor) (*DriverCalendarView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a driver has a booking calendar")
	}
	rows, err := s.deps.Store.BookingsForDriver(ctx, s.deps.Store.Pool(), actor.UserID, s.now().Add(-time.Hour), 100)
	if err != nil {
		return nil, asDomainError(err)
	}
	view := &DriverCalendarView{Bookings: []*AdvanceBookingView{}, Note: driverCalendarNote}
	for _, b := range rows {
		if !machine.IsMpBookingOccupying(b.State) {
			continue
		}
		view.Bookings = append(view.Bookings, s.bookingView(ctx, b, viewerDriver))
	}
	return view, nil
}

// bookingReplay answers a stored idempotent booking response.
func bookingReplay(replay *IdempotentResult) (*AdvanceBookingView, int, error) {
	var view AdvanceBookingView
	if err := decodeJSON(replay.Response, &view); err != nil {
		return nil, 0, asDomainError(err)
	}
	return &view, replay.StatusCode, nil
}

// ReconfirmBooking is the driver's reconfirmation before pickup: allowed in
// the reconfirmation window, while still eligible.
func (s *Service) ReconfirmBooking(ctx context.Context, actor Actor, id uuid.UUID, idempotencyKey string) (*AdvanceBookingView, int, error) {
	if !actor.IsDriver() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only the booked driver can reconfirm")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	b, _, err := s.bookingForParty(ctx, actor, id)
	if err != nil {
		return nil, 0, err
	}
	body := map[string]any{"bookingId": id.String()}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeBookingReconfirm, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		return bookingReplay(replay)
	}
	blocked, err := s.driverBlocked(ctx, actor.UserID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if blocked {
		return nil, 0, domain.Errorf(domain.CodeDriverIneligible, "your account cannot take marketplace work right now").
			WithDetails(map[string]any{"reason": ReasonAccountNotEligible})
	}
	now := s.now()
	if now.Before(b.ReconfirmOpensAt) {
		return nil, 0, domain.Errorf(domain.CodeConflict, "reconfirmation opens at %s", b.ReconfirmOpensAt.Format(time.RFC3339)).
			WithDetails(map[string]any{"opensAt": b.ReconfirmOpensAt})
	}
	var view *AdvanceBookingView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BookingForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if locked.State != machine.MpBookingConfirmed {
			return domain.Errorf(domain.CodeConflict, "this booking cannot be reconfirmed now").
				WithDetails(map[string]any{"state": locked.State})
		}
		if !now.Before(locked.ReconfirmDeadline) {
			return domain.Errorf(domain.CodeConflict, "the reconfirmation deadline has passed").
				WithDetails(map[string]any{"deadline": locked.ReconfirmDeadline})
		}
		moved, err := s.deps.Store.TransitionBooking(ctx, tx, locked, machine.MpBookingReconfirmed, BookingUpdate{ReconfirmedAt: &now})
		if err != nil {
			return err
		}
		if err := s.writeBookingEvent(ctx, tx, moved, "mp.advance_booking.reconfirmed", "driver", actor.UserID.String(), now, nil); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role, Action: "mp.advance_booking.reconfirmed",
			SubjectType: subjectBooking, SubjectID: moved.ID.String(),
			Before: map[string]any{"state": locked.State}, After: map[string]any{"state": moved.State},
			Reason: "the booked driver reconfirmed before pickup",
		}); err != nil {
			return err
		}
		view = bookingViewOf(moved, nil, "", viewerDriver)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeBookingReconfirm, actor.UserID, idempotencyKey, body, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, 200, nil
}

// WithdrawBookingBody is POST /v1/mp/advance-bookings/{id}/withdraw.
type WithdrawBookingBody struct {
	Reason string `json:"reason"`
}

// WithdrawBooking is the driver saying they cannot attend: the booking fails
// with the reason explained to the rider, the captured commission is
// returned with a linked reversal, the rider's funding released, and a
// consented rematch offered. Nobody is silently substituted.
func (s *Service) WithdrawBooking(ctx context.Context, actor Actor, id uuid.UUID, body WithdrawBookingBody, idempotencyKey string) (*AdvanceBookingView, int, error) {
	if !actor.IsDriver() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only the booked driver can withdraw")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	if body.Reason == "" || len(body.Reason) > 280 {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "say why you cannot attend (up to 280 characters)").
			WithDetails(map[string]any{"field": "reason"})
	}
	b, _, err := s.bookingForParty(ctx, actor, id)
	if err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeBookingWithdraw, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		return bookingReplay(replay)
	}
	var view *AdvanceBookingView
	failed, err := s.endBooking(ctx, b, bookingEnd{
		to:        machine.MpBookingFailed,
		reason:    BookingFailDriverWithdrew,
		message:   "Your driver withdrew from this booking and cannot attend. Nothing was charged to you and any payment hold was released.",
		actorType: "driver", actorID: actor.UserID.String(), actorRole: actor.Role,
		saveIdem: func(tx pgx.Tx, moved *AdvanceBooking) error {
			view = bookingViewOf(moved, nil, "", viewerDriver)
			return s.deps.Store.SaveIdempotent(ctx, tx, scopeBookingWithdraw, actor.UserID, idempotencyKey, body, 200, view)
		},
	})
	if err != nil {
		return nil, 0, err
	}
	if view == nil {
		view = s.bookingView(ctx, failed, viewerDriver)
	}
	return view, 200, nil
}

// CancelBooking is the rider cancelling their advance booking before
// activation: the award is cancelled, the driver's captured commission
// returned with a linked reversal and the rider's funding released. No
// cancellation fee is charged in this slice (a fee policy is A04.5's).
func (s *Service) CancelBooking(ctx context.Context, actor Actor, id uuid.UUID, idempotencyKey string) (*AdvanceBookingView, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only the requester can cancel their booking")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	b, _, err := s.bookingForParty(ctx, actor, id)
	if err != nil {
		return nil, 0, err
	}
	body := map[string]any{"bookingId": id.String()}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeBookingCancel, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		return bookingReplay(replay)
	}
	if b.State == machine.MpBookingHeld {
		return nil, 0, domain.Errorf(domain.CodeAwardUnresolved, "your selection is still being confirmed; try again shortly").
			WithDetails(map[string]any{"awardId": b.AwardID.String()})
	}
	var view *AdvanceBookingView
	cancelled, err := s.endBooking(ctx, b, bookingEnd{
		to:        machine.MpBookingCancelled,
		reason:    BookingCancelledByRider,
		message:   "You cancelled this booking. Nothing was charged and any payment hold was released.",
		actorType: "rider", actorID: actor.UserID.String(), actorRole: actor.Role,
		saveIdem: func(tx pgx.Tx, moved *AdvanceBooking) error {
			view = bookingViewOf(moved, nil, "", viewerRider)
			return s.deps.Store.SaveIdempotent(ctx, tx, scopeBookingCancel, actor.UserID, idempotencyKey, body, 200, view)
		},
	})
	if err != nil {
		return nil, 0, err
	}
	if view == nil {
		view = s.bookingView(ctx, cancelled, viewerRider)
	}
	return view, 200, nil
}

// bookingEnd describes how a booking ends before activation.
type bookingEnd struct {
	to        string // failed | cancelled
	reason    string
	message   string
	actorType string
	actorID   string
	actorRole string
	saveIdem  func(tx pgx.Tx, moved *AdvanceBooking) error
	// riskLapsed marks the fleet calendar's deadline failure (A05): the
	// booking's risk overlay moves at_risk → lapsed instead of being
	// resolved (at_risk → ok) by the booking ending.
	riskLapsed bool
}

// endBooking fails or cancels a not-yet-activated booking, exactly once:
// booking → failed/cancelled with the explained outcome, award confirmed →
// cancelled, request awarded → cancelled, and the two money intents (the
// captured commission's linked reversal, the rider funding release) written
// durably in the same transaction — then driven after commit, with the
// recovery sweep owning anything unconfirmed. A replay finds the booking
// already ended and moves nothing.
func (s *Service) endBooking(ctx context.Context, b *AdvanceBooking, end bookingEnd) (*AdvanceBooking, error) {
	award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), b.AwardID)
	if err != nil {
		return nil, asDomainError(err)
	}
	bid, err := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), award.BidID)
	if err != nil {
		return nil, asDomainError(err)
	}
	now := s.now()
	rematch := false
	if _, policy, err := s.policy(ctx, b.CityID); err == nil {
		if advance, err := policy.AdvanceReservationPolicyFor(b.CityID); err == nil {
			rematch = end.to == machine.MpBookingFailed &&
				b.WindowStart.Sub(now) >= time.Duration(advance.MinLeadSec)*time.Second
		}
	}
	reverseRowID, fundingRowID := uuid.New(), uuid.New()
	fundingHeld := b.FundingState == BookingFundingSecured
	var moved *AdvanceBooking
	applied := false
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BookingForUpdate(ctx, tx, b.ID)
		if err != nil {
			return err
		}
		switch locked.State {
		case machine.MpBookingPaymentPending, machine.MpBookingConfirmed, machine.MpBookingReconfirmed:
		default:
			return domain.Errorf(domain.CodeConflict, "this booking can no longer be ended this way").
				WithDetails(map[string]any{"state": locked.State})
		}
		// A05: the risk sweep listed this booking without a lock. Under the
		// lock it must still be at risk past its deadline — a blocker that
		// cleared (or a swap applied) meanwhile wins, and nothing ends.
		if end.riskLapsed && (locked.Risk != machine.MpRiskAtRisk || locked.RiskDeadline == nil || now.Before(*locked.RiskDeadline)) {
			return errRiskNoLongerDue
		}
		failure := &BookingFailure{
			Reason:               end.reason,
			Message:              end.message,
			CommissionReversed:   true,
			RiderFundingReleased: fundingHeld,
			RematchAvailable:     rematch,
		}
		if rematch {
			failure.Message += " You can ask us to find another driver for the same window; nobody is booked without your consent."
		}
		funding := locked.FundingState
		if fundingHeld {
			funding = BookingFundingReleased
		}
		moved, err = s.deps.Store.TransitionBooking(ctx, tx, locked, end.to, BookingUpdate{Failure: failure, FundingState: &funding})
		if err != nil {
			return err
		}
		// A05: the booking ending settles its fleet-calendar state in the
		// same transaction — its vehicle left the occupancy ledger in
		// TransitionBooking; its risk overlay resolves (or lapses, at the
		// deadline) and any vehicle swap still in flight is cancelled,
		// keeping the vehicle it had.
		if moved, err = s.settleEndedBookingFleetState(ctx, tx, moved, end, now); err != nil {
			return err
		}
		lockedAward, err := s.deps.Store.AwardForUpdate(ctx, tx, award.ID)
		if err != nil {
			return err
		}
		if lockedAward.State == machine.MpAwardConfirmed {
			reason := end.reason
			if _, err := s.deps.Store.TransitionAward(ctx, tx, lockedAward, machine.MpAwardCancelled, AwardUpdate{
				FailReason: &reason, ResolvedAt: &now,
			}); err != nil {
				return err
			}
		}
		lockedRequest, err := s.deps.Store.RequestForUpdate(ctx, tx, award.RequestID)
		if err != nil {
			return err
		}
		if lockedRequest.State == machine.MpRequestAwarded {
			closeReason := bookingRequestCloseReason
			if end.to == machine.MpBookingCancelled {
				closeReason = bookingRequestCancelledReason
			}
			fromVersion := lockedRequest.Version
			closed, err := s.deps.Store.TransitionRequest(ctx, tx, lockedRequest, machine.MpRequestCancelled, RequestUpdate{CloseReason: &closeReason})
			if err != nil {
				return err
			}
			if err := writeEvent(ctx, tx, Event{
				Name: "mp.request.closed", AggregateType: subjectRequest, AggregateID: closed.ID.String(),
				FromVersion: &fromVersion, ToVersion: closed.Version, CityID: closed.CityID,
				ActorType: end.actorType, ActorID: end.actorID,
				IdempotencyKey: "mp.request.closed:" + closed.ID.String(), OccurredAt: now,
				Payload: map[string]any{"requestId": closed.ID.String(), "reason": closeReason, "bookingId": b.ID.String()},
			}); err != nil {
				return err
			}
		}
		// The two money intents, durable in this transaction under the
		// award-derived keys (reverse: mp.reverse:<award>, release:
		// mp.fund.release:<award>) — however often they are driven, the
		// commission comes back once and the funding frees once.
		bidID := bid.ID
		if err := s.deps.Store.InsertRecovery(ctx, tx, RecoveryRow{
			ID: reverseRowID, ReservationID: bid.ReservationID, DriverID: bid.DriverID, BidID: &bidID, Action: RecoveryReverse,
		}); err != nil {
			return err
		}
		payload, err := json.Marshal(FundingReleaseRecoveryPayload{AwardID: award.ID, Reason: end.reason})
		if err != nil {
			return err
		}
		if err := s.deps.Store.InsertRecovery(ctx, tx, RecoveryRow{
			ID: fundingRowID, ReservationID: fundingReleaseKeyFor(award.ID), DriverID: award.RequesterID,
			Action: RecoveryFundingRelease, Payload: payload,
		}); err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name: "mp.award.cancelled", AggregateType: subjectAward, AggregateID: award.ID.String(),
			ToVersion: 1, CityID: b.CityID, ActorType: end.actorType, ActorID: end.actorID,
			IdempotencyKey: "mp.award.cancelled:" + award.ID.String(), OccurredAt: now,
			Payload: map[string]any{
				"awardId": award.ID.String(), "requestId": award.RequestID.String(), "driverId": award.DriverID.String(),
				"commissionMinor": award.CommissionMinor, "reason": end.reason, "feeReversed": true,
				"bookingId": b.ID.String(),
			},
		}); err != nil {
			return err
		}
		event := "mp.advance_booking.failed"
		if end.to == machine.MpBookingCancelled {
			event = "mp.advance_booking.cancelled"
		}
		if err := s.writeBookingEvent(ctx, tx, moved, event, end.actorType, end.actorID, now, map[string]any{
			"reason":  end.reason,
			"message": failure.Message,
			"financialOutcome": map[string]any{
				"commissionReversed": true, "riderFundingReleased": fundingHeld, "riderCharged": false,
			},
			"rematchAvailable": rematch,
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: end.actorID, ActorRole: end.actorRole, Action: event,
			SubjectType: subjectBooking, SubjectID: moved.ID.String(),
			Before: map[string]any{"state": locked.State, "fundingState": locked.FundingState},
			After: map[string]any{
				"state": moved.State, "reason": end.reason, "commissionMinor": award.CommissionMinor,
				"commissionReversed": true, "riderFundingReleased": fundingHeld, "currency": b.Currency,
			},
			Reason: end.message,
		}); err != nil {
			return err
		}
		applied = true
		if end.saveIdem != nil {
			return end.saveIdem(tx, moved)
		}
		return nil
	})
	if errors.Is(err, errRiskNoLongerDue) {
		return nil, err
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	if applied {
		s.driveAwardUnwind(ctx, award, bid, end.reason, reverseRowID, fundingRowID, now)
	}
	return moved, nil
}

// driveAwardUnwind is the post-commit half of ending a booking: the linked
// commission reversal and the rider funding release, each resolving its
// durable intent on a confirmed answer and otherwise left to the sweep,
// which re-drives the same award-derived keys.
func (s *Service) driveAwardUnwind(ctx context.Context, award *Award, bid *Bid, reason string, reverseRowID, fundingRowID uuid.UUID, now time.Time) {
	if _, err := s.deps.Wallet.Reverse(ctx, bid.ReservationID, award.ID.String(), reason, "mp.reverse:"+award.ID.String()); err != nil {
		s.deps.Logger.Warn().Err(err).Str("award_id", award.ID.String()).Msg("booking commission reversal unconfirmed; the sweep owns it")
	} else if err := s.deps.Store.ResolveRecovery(ctx, s.deps.Store.Pool(), reverseRowID, now); err != nil {
		s.deps.Logger.Error().Err(err).Str("award_id", award.ID.String()).Msg("could not resolve the reversal recovery row")
	}
	err := s.deps.Funding.Release(ctx, award.ID, reason, fundingReleaseKeyFor(award.ID))
	switch {
	case err == nil, errors.Is(err, ErrFundingReservationConsumed):
		if errors.Is(err, ErrFundingReservationConsumed) {
			s.deps.Logger.Error().Str("award_id", award.ID.String()).
				Msg("rider funding already CONSUMED for an ended booking — settlement and cancellation disagree; investigate")
		}
		if resolveErr := s.deps.Store.ResolveRecovery(ctx, s.deps.Store.Pool(), fundingRowID, now); resolveErr != nil {
			s.deps.Logger.Error().Err(resolveErr).Str("award_id", award.ID.String()).Msg("could not resolve the funding recovery row")
		}
	default:
		s.deps.Logger.Warn().Err(err).Str("award_id", award.ID.String()).Msg("booking funding release unconfirmed; the sweep owns it")
	}
}

// RematchBookingBody is POST /v1/mp/advance-bookings/{id}/rematch.
type RematchBookingBody struct {
	RequestedFareMinor *Money `json:"requestedFareMinor,omitempty"`
}

// RematchBooking is the rider's explicit consent to re-publish a failed
// booking's trip for the same window: a NEW advance request (no driver
// secured) priced with refreshed bounds. The fare is the original asked fare
// unless the rider names another — it is never silently raised: a refreshed
// minimum above it is refused with the refreshed terms for the rider to
// decide on.
func (s *Service) RematchBooking(ctx context.Context, actor Actor, id uuid.UUID, body RematchBookingBody, idempotencyKey string) (*RequestView, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only the requester can ask for another driver")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	b, _, err := s.bookingForParty(ctx, actor, id)
	if err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeBookingRematch, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view RequestView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}
	if b.State != machine.MpBookingFailed || b.Failure == nil || !b.Failure.RematchAvailable {
		return nil, 0, domain.Errorf(domain.CodeConflict, "this booking cannot be rematched").
			WithDetails(map[string]any{"state": b.State})
	}
	if b.RematchRequestID != nil {
		return nil, 0, domain.Errorf(domain.CodeConflict, "a rematch was already requested for this booking").
			WithDetails(map[string]any{"requestId": b.RematchRequestID.String()})
	}
	if b.RematchDeclinedAt != nil {
		return nil, 0, domain.Errorf(domain.CodeConflict, "you chose to cancel and release this booking; book again instead")
	}
	original, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), b.RequestID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if err := s.requireServiceFlag(ctx, original.Service, actor, original.CityID); err != nil {
		return nil, 0, err
	}
	config, policy, err := s.policy(ctx, original.CityID)
	if err != nil {
		return nil, 0, err
	}
	advance, err := policy.AdvanceReservationPolicyFor(original.CityID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	now := s.now()
	if original.Schedule == nil || original.Schedule.PickupAt.Sub(now) < time.Duration(advance.MinLeadSec)*time.Second {
		return nil, 0, domain.Errorf(domain.CodeConflict,
			"there is no longer time to book another driver in advance; request a ride instead")
	}
	quote, err := s.priceQuote(ctx, actor.UserID, config, policy, QuoteParams{
		Service: original.Service, VehicleClass: original.VehicleClass,
		Pickup: placeOf(original.Pickup), Dropoff: placeOf(original.Dropoff), Stops: stopInputsOf(original.Stops),
	})
	if err != nil {
		return nil, 0, err
	}
	asked := original.RequestedMinor
	if body.RequestedFareMinor != nil {
		if err := requireCurrency(*body.RequestedFareMinor, quote.Currency, "requestedFareMinor"); err != nil {
			return nil, 0, err
		}
		asked = body.RequestedFareMinor.AmountMinor
	}
	if asked < quote.MinMinor || asked > quote.MaxMinor {
		return nil, 0, fareOutOfBounds(asked, quote.MinMinor, quote.MaxMinor, quote.Currency, config.CurrencyFractionDigits)
	}
	quote.ExpiresAt = now.Add(config.QuoteTTL())
	request := newRequestFromQuote(quote, actor.UserID, asked, quote.MaxMinor, original.PaymentMethodID, policy,
		advanceRequestExpiry(now, original.Schedule.PickupAt, advance))
	schedule := *original.Schedule
	request.BookingKind = BookingKindAdvance
	request.Schedule = &schedule
	windowStart, windowEnd := schedule.PickupAt, schedule.WindowEnd
	request.PickupWindowStart, request.PickupWindowEnd = &windowStart, &windowEnd

	var view *RequestView
	var replayed *IdempotentResult
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BookingForUpdate(ctx, tx, b.ID)
		if err != nil {
			return err
		}
		// Under the booking lock: a concurrent retry of this same consent
		// that committed first is replayed, not refused.
		if replayed, err = s.deps.Store.LookupIdempotent(ctx, tx, scopeBookingRematch, actor.UserID, idempotencyKey, body); err != nil || replayed != nil {
			return err
		}
		if locked.State != machine.MpBookingFailed || locked.RematchRequestID != nil || locked.RematchDeclinedAt != nil {
			return domain.Errorf(domain.CodeConflict, "a rematch was already requested for this booking")
		}
		if err := s.acquirePublishCapacity(ctx, tx, actor.UserID, BookingKindAdvance, policy, advance); err != nil {
			if errors.Is(err, errPublicationDeferred) {
				return domain.Errorf(domain.CodeRequestCapReached, "you already have the maximum of advance requests taking offers")
			}
			return err
		}
		if err := s.deps.Store.InsertQuote(ctx, tx, quote); err != nil {
			return err
		}
		if err := s.writePublishedRequest(ctx, tx, request, quote, publisher{
			actorType: "rider", actorID: actor.UserID.String(), actorRole: actor.Role,
			reason: "requester consented to re-publish a failed advance booking for the same window",
		}, now); err != nil {
			return err
		}
		requestID := request.ID
		moved, err := s.deps.Store.TransitionBooking(ctx, tx, locked, locked.State, BookingUpdate{RematchRequestID: &requestID})
		if err != nil {
			return err
		}
		if err := s.writeBookingEvent(ctx, tx, moved, "mp.advance_booking.rematch_requested", "rider", actor.UserID.String(), now,
			map[string]any{"rematchRequestId": request.ID.String(), "requestedMinor": asked, "currency": quote.Currency}); err != nil {
			return err
		}
		view = requestViewOf(request)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeBookingRematch, actor.UserID, idempotencyKey, body, 201, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replayed != nil {
		var stored RequestView
		if err := decodeJSON(replayed.Response, &stored); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &stored, replayed.StatusCode, nil
	}
	return view, 201, nil
}

// ReleaseBooking is the rider's "cancel and release" on a booking whose
// driver can no longer make it (A05 D2): it closes the rematch offer for
// good, with an event and an audit row. The money was already settled when
// the booking failed — the captured commission returned with a linked
// reversal and any rider funding hold released (both owed durably, driven
// by the recovery sweep until confirmed) — so nothing is charged or moved
// here.
func (s *Service) ReleaseBooking(ctx context.Context, actor Actor, id uuid.UUID, idempotencyKey string) (*AdvanceBookingView, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only the requester can release their booking")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	b, _, err := s.bookingForParty(ctx, actor, id)
	if err != nil {
		return nil, 0, err
	}
	body := map[string]any{"bookingId": id.String()}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeBookingRelease, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		return bookingReplay(replay)
	}
	now := s.now()
	var view *AdvanceBookingView
	var replayed *IdempotentResult
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BookingForUpdate(ctx, tx, b.ID)
		if err != nil {
			return err
		}
		// Under the booking lock: a concurrent retry of this same key that
		// committed first is replayed, not refused.
		if replayed, err = s.deps.Store.LookupIdempotent(ctx, tx, scopeBookingRelease, actor.UserID, idempotencyKey, body); err != nil || replayed != nil {
			return err
		}
		if locked.State != machine.MpBookingFailed || locked.RematchRequestID != nil {
			return domain.Errorf(domain.CodeConflict, "only a failed booking with no rematch can be released").
				WithDetails(map[string]any{"state": locked.State})
		}
		if locked.RematchDeclinedAt == nil {
			updated, err := scanBooking(tx.QueryRow(ctx, `
				UPDATE mp.advance_bookings
				SET rematch_declined_at = $3, version = version + 1, updated_at = now()
				WHERE id = $1 AND version = $2
				RETURNING `+bookingColumns, locked.ID, locked.Version, now))
			if err != nil {
				return err
			}
			if err := s.writeBookingEvent(ctx, tx, updated, "mp.advance_booking.rematch_declined", "rider", actor.UserID.String(), now,
				map[string]any{"riderCharged": false, "riderFundingReleased": locked.FundingState == BookingFundingReleased}); err != nil {
				return err
			}
			if err := writeAudit(ctx, tx, AuditRecord{
				ActorID: actor.UserID.String(), ActorRole: actor.Role, Action: "mp.advance_booking.rematch_declined",
				SubjectType: subjectBooking, SubjectID: updated.ID.String(),
				Before: map[string]any{"rematchOffered": locked.Failure != nil && locked.Failure.RematchAvailable},
				After:  map[string]any{"rematchOffered": false, "fundingState": updated.FundingState},
				Reason: "the rider chose to cancel and release instead of a rematch",
			}); err != nil {
				return err
			}
			locked = updated
		}
		view = bookingViewOf(locked, nil, "", viewerRider)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeBookingRelease, actor.UserID, idempotencyKey, body, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replayed != nil {
		return bookingReplay(replayed)
	}
	if current, err := s.deps.Store.BookingByID(ctx, s.deps.Store.Pool(), b.ID); err == nil {
		view = s.bookingView(ctx, current, viewerRider)
	}
	return view, 200, nil
}

// errBookingNotActivatable is a transient activation blocker (the driver
// offline, on a trip that cannot yet be queued behind, a slot taken); see
// activationError.
var errBookingNotActivatable = errors.New("the booking cannot be activated yet")

// overlappingAdvanceBids lists the driver's other live advance bids whose
// calendar interval overlaps a booking just committed: offers the driver can
// no longer honour, invalidated (and their holds released) by the award.
func (s *Service) overlappingAdvanceBids(ctx context.Context, tx pgx.Tx, booking *AdvanceBooking, requestID uuid.UUID, policy *cityconfig.AdvanceReservationPolicy) ([]*Bid, error) {
	bids, err := s.deps.Store.LiveAdvanceBidsForDriver(ctx, tx, booking.DriverID, requestID)
	if err != nil {
		return nil, err
	}
	var out []*Bid
	for _, bid := range bids {
		other, err := s.deps.Store.RequestByID(ctx, tx, bid.RequestID)
		if errors.Is(err, domain.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		start, end, _, err := bookingInterval(other, policy)
		if err != nil {
			continue
		}
		if start.Before(booking.OccupiedEnd) && booking.OccupiedStart.Before(end) {
			out = append(out, bid)
		}
	}
	return out, nil
}
