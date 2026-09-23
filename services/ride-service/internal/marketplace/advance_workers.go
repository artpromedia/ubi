package marketplace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// The advance-booking workers (A03). Every pass is a plain function over
// rows, idempotent and restart-safe: each transition re-reads its booking
// under lock and must still find the state it expects, every event key is
// derived from the booking (and offset/attempt), and every money movement
// runs under an award-derived idempotency key with a durable recovery row
// behind it. A crash anywhere resumes; a replay moves nothing twice.

// bookingRetryDelay is how soon a booking step that could not complete is
// retried. Plumbing, not policy.
const bookingRetryDelay = 30 * time.Second

// reminderHorizon is how far ahead the reminder passes look, and
// reminderPageCap bounds how many sweepBatch pages one pass reads.
// Plumbing, not policy.
const (
	reminderHorizon = 48 * time.Hour
	reminderPageCap = 50
)

// sweepAdvanceBookings runs every booking pass once.
func (s *Service) sweepAdvanceBookings(ctx context.Context, now time.Time) {
	s.sweepBookingFunding(ctx, now)
	s.sweepBookingEligibility(ctx, now)
	s.sweepBookingReconfirmation(ctx, now)
	s.sweepBookingActivations(ctx, now)
	s.sweepActivatedBookings(ctx, now)
	s.sweepBookingReminders(ctx, now)
}

// systemEnd is how the workers end a booking.
func systemEnd(to, reason, message string) bookingEnd {
	return bookingEnd{to: to, reason: reason, message: message, actorType: "system", actorID: "ride-service", actorRole: "system"}
}

// sweepBookingFunding secures payment_pending bookings once they enter the
// funding horizon, and fails the ones still unsecured at the deadline —
// commission returned, nothing charged, the rider told why.
func (s *Service) sweepBookingFunding(ctx context.Context, now time.Time) {
	overdue, err := s.deps.Store.BookingsInStates(ctx, s.deps.Store.Pool(),
		[]string{machine.MpBookingPaymentPending}, "funding_deadline", now, now, false, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list bookings past their funding deadline")
	}
	for _, b := range overdue {
		if _, err := s.endBooking(ctx, b, systemEnd(machine.MpBookingFailed, BookingFailFundingNotSecured,
			"We could not secure your payment for this booking in time, so it was released. Nothing was charged.")); err != nil {
			s.deps.Logger.Error().Err(err).Str("booking_id", b.ID.String()).Msg("failed to release an unfunded booking")
		}
	}
	due, err := s.deps.Store.BookingsInStates(ctx, s.deps.Store.Pool(),
		[]string{machine.MpBookingPaymentPending}, "funding_due_at", now, now, true, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list bookings due for funding")
		return
	}
	for _, b := range due {
		if !now.Before(b.FundingDeadline) {
			continue
		}
		if err := s.secureBookingFunding(ctx, b, now); err != nil {
			s.deps.Logger.Info().Err(err).Str("booking_id", b.ID.String()).Msg("booking funding not secured yet; will retry")
		}
	}
}

// secureBookingFunding authorizes the rider's funding for a payment_pending
// booking under the award's ONE funding key — the same key the award saga
// uses — so a retry, or a racing pass, converges on a single reservation.
func (s *Service) secureBookingFunding(ctx context.Context, b *AdvanceBooking, now time.Time) error {
	award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), b.AwardID)
	if err != nil {
		return err
	}
	auth, authErr := s.deps.Funding.Authorize(ctx, FundingRequest{
		RequesterID:     b.RequesterID,
		RequestID:       b.RequestID,
		AwardID:         award.ID,
		PaymentMethodID: b.PaymentMethodID,
		AmountMinor:     b.FareMinor,
		Currency:        b.Currency,
		CityID:          b.CityID,
	}, "mp.fund:"+award.ID.String())
	if authErr != nil {
		retryAt := now.Add(15 * time.Minute)
		if retryAt.After(b.FundingDeadline) {
			retryAt = b.FundingDeadline
		}
		if mapped, ok := domain.AsError(authErr); ok && !errors.Is(authErr, ErrWalletUnknownOutcome) {
			// A definite refusal (insufficient funds, method unavailable):
			// the rider is told, and the pass retries until the deadline.
			if txErr := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
				locked, err := s.deps.Store.BookingForUpdate(ctx, tx, b.ID)
				if err != nil {
					return err
				}
				if locked.State != machine.MpBookingPaymentPending {
					return nil
				}
				refused := BookingFundingRefused
				moved, err := s.deps.Store.TransitionBooking(ctx, tx, locked, locked.State, BookingUpdate{FundingState: &refused})
				if err != nil {
					return err
				}
				return s.writeBookingEvent(ctx, tx, moved, "mp.advance_booking.funding_refused", "system", "ride-service", now,
					map[string]any{
						"code":     string(mapped.Code),
						"deadline": b.FundingDeadline.Format(time.RFC3339),
						"message":  "We could not secure your payment for this booking. Top up or change your payment method before the deadline, or the booking is released at no charge.",
					}, b.ID.String(), itoa(b.Attempts))
			}); txErr != nil {
				return txErr
			}
		}
		if err := s.deps.Store.DeferBooking(ctx, s.deps.Store.Pool(), b.ID, authErr.Error(), retryAt); err != nil {
			return err
		}
		return authErr
	}
	state := BookingFundingSecured
	if auth != nil && !auth.Secured {
		state = BookingFundingUnsecuredCash
	}
	// The authorization above ran outside any lock. If the booking ended
	// meanwhile (a rider cancel, the deadline pass on another replica), its
	// own funding release may already have run — and found nothing, because
	// this reservation did not exist yet. The reservation just created must
	// then be released too, durably, or it would encumber the rider's wallet
	// with no booking behind it.
	orphanRowID := uuid.New()
	orphaned := false
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BookingForUpdate(ctx, tx, b.ID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpBookingPaymentPending {
			if machine.IsMpBookingOccupying(locked.State) || state != BookingFundingSecured {
				// Still live (a racing pass confirmed it), or nothing is
				// encumbered: the reservation belongs to the booking.
				return nil
			}
			payload, err := json.Marshal(FundingReleaseRecoveryPayload{AwardID: award.ID, Reason: "booking_ended"})
			if err != nil {
				return err
			}
			orphaned = true
			return s.deps.Store.InsertRecovery(ctx, tx, RecoveryRow{
				ID: orphanRowID, ReservationID: fundingReleaseKeyFor(award.ID), DriverID: award.RequesterID,
				Action: RecoveryFundingRelease, Payload: payload,
			})
		}
		moved, err := s.deps.Store.TransitionBooking(ctx, tx, locked, machine.MpBookingConfirmed, BookingUpdate{
			FundingState: &state, ClearNextTry: true,
		})
		if err != nil {
			return err
		}
		if err := s.writeBookingEvent(ctx, tx, moved, "mp.advance_booking.funding_secured", "system", "ride-service", now,
			map[string]any{"fareMinor": b.FareMinor, "currency": b.Currency}); err != nil {
			return err
		}
		if err := s.writeBookingEvent(ctx, tx, moved, "mp.advance_booking.confirmed", "system", "ride-service", now,
			map[string]any{"driverReserved": true, "fullySecured": true}); err != nil {
			return err
		}
		return writeAudit(ctx, tx, AuditRecord{
			ActorID: "ride-service", ActorRole: "system", Action: "mp.advance_booking.funding_secured",
			SubjectType: subjectBooking, SubjectID: moved.ID.String(),
			Before: map[string]any{"state": locked.State, "fundingState": locked.FundingState},
			After:  map[string]any{"state": moved.State, "fundingState": moved.FundingState, "fareMinor": b.FareMinor, "currency": b.Currency},
			Reason: "rider funding secured as the booking entered the funding horizon",
		})
	})
	if err != nil || !orphaned {
		return err
	}
	// Driven now; the recovery sweep owns it if the answer is not confirmed.
	if releaseErr := s.deps.Funding.Release(ctx, award.ID, "booking_ended", fundingReleaseKeyFor(award.ID)); releaseErr != nil {
		s.deps.Logger.Warn().Err(releaseErr).Str("award_id", award.ID.String()).
			Msg("funding authorized for an ended booking; its release is unconfirmed and the sweep owns it")
		return nil
	}
	if resolveErr := s.deps.Store.ResolveRecovery(ctx, s.deps.Store.Pool(), orphanRowID, now); resolveErr != nil {
		s.deps.Logger.Error().Err(resolveErr).Str("award_id", award.ID.String()).Msg("could not resolve the funding recovery row")
	}
	return nil
}

// sweepBookingEligibility fails bookings near pickup whose driver lost
// marketplace eligibility (an in-effect standing suspension): the rider is
// told at once, the commission returned, the funding released and a
// consented rematch offered when there is still time.
func (s *Service) sweepBookingEligibility(ctx context.Context, now time.Time) {
	rows, err := s.deps.Store.BookingsInStates(ctx, s.deps.Store.Pool(),
		[]string{machine.MpBookingPaymentPending, machine.MpBookingConfirmed, machine.MpBookingReconfirmed},
		"reconfirm_opens_at", now, now, false, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list bookings for the eligibility check")
		return
	}
	for _, b := range rows {
		blocked, err := s.driverBlocked(ctx, b.DriverID)
		if err != nil || !blocked {
			continue
		}
		if _, err := s.endBooking(ctx, b, systemEnd(machine.MpBookingFailed, BookingFailDriverIneligible,
			"Your driver can no longer take marketplace trips, so this booking was released. Nothing was charged to you.")); err != nil {
			s.deps.Logger.Error().Err(err).Str("booking_id", b.ID.String()).Msg("failed to release a booking with an ineligible driver")
		}
	}
}

// sweepBookingReconfirmation asks each confirmed booking's driver to
// reconfirm once the window opens, and fails the ones whose driver missed
// the deadline.
func (s *Service) sweepBookingReconfirmation(ctx context.Context, now time.Time) {
	missed, err := s.deps.Store.BookingsInStates(ctx, s.deps.Store.Pool(),
		[]string{machine.MpBookingConfirmed}, "reconfirm_deadline", now, now, false, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list bookings past their reconfirmation deadline")
	}
	for _, b := range missed {
		if _, err := s.endBooking(ctx, b, systemEnd(machine.MpBookingFailed, BookingFailReconfirmMissed,
			"Your driver did not reconfirm before pickup, so this booking was released. Nothing was charged to you.")); err != nil {
			s.deps.Logger.Error().Err(err).Str("booking_id", b.ID.String()).Msg("failed to release an unreconfirmed booking")
		}
	}
	open, err := s.deps.Store.BookingsAwaitingReconfirmRequest(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list bookings due a reconfirmation request")
		return
	}
	for _, b := range open {
		if b.ReconfirmRequestedAt != nil || !now.Before(b.ReconfirmDeadline) {
			continue
		}
		if err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
			locked, err := s.deps.Store.BookingForUpdate(ctx, tx, b.ID)
			if err != nil {
				return err
			}
			if locked.State != machine.MpBookingConfirmed || locked.ReconfirmRequestedAt != nil {
				return nil
			}
			moved, err := s.deps.Store.TransitionBooking(ctx, tx, locked, locked.State, BookingUpdate{ReconfirmRequestedAt: &now})
			if err != nil {
				return err
			}
			return s.writeBookingEvent(ctx, tx, moved, "mp.advance_booking.reconfirm_requested", "system", "ride-service", now,
				map[string]any{
					"deadline": moved.ReconfirmDeadline.Format(time.RFC3339),
					"message":  "Please reconfirm your advance booking. If you do not reconfirm in time it is released and your commission returned.",
				})
		}); err != nil {
			s.deps.Logger.Error().Err(err).Str("booking_id", b.ID.String()).Msg("failed to request a reconfirmation")
		}
	}
}

// activationError is a transient activation blocker with the failure reason
// the booking fails with if it persists past the activation deadline.
type activationError struct {
	reason string
	detail string
}

func (e *activationError) Error() string {
	return fmt.Sprintf("%v: %s: %s", errBookingNotActivatable, e.reason, e.detail)
}

func (e *activationError) Unwrap() error { return errBookingNotActivatable }

// sweepBookingActivations moves reconfirmed bookings into the live slots at
// their activation time, exactly once. A booking that cannot be activated by
// its deadline (the pickup window's start) fails honestly — its driver is
// never substituted and a current passenger is never diverted.
func (s *Service) sweepBookingActivations(ctx context.Context, now time.Time) {
	rows, err := s.deps.Store.BookingsInStates(ctx, s.deps.Store.Pool(),
		[]string{machine.MpBookingReconfirmed}, "activation_at", now, now, true, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list bookings due for activation")
		return
	}
	for _, b := range rows {
		err := s.activateBooking(ctx, b, now)
		if err == nil {
			continue
		}
		var blocked *activationError
		if !errors.As(err, &blocked) {
			s.deps.Logger.Error().Err(err).Str("booking_id", b.ID.String()).Msg("booking activation failed; will retry")
			if deferErr := s.deps.Store.DeferBooking(ctx, s.deps.Store.Pool(), b.ID, err.Error(), now.Add(bookingRetryDelay)); deferErr != nil {
				s.deps.Logger.Error().Err(deferErr).Msg("could not defer the booking activation")
			}
			continue
		}
		if !now.Before(b.ActivationDeadline) {
			message := "Your driver could not start this booking in time"
			switch blocked.reason {
			case BookingFailDriverOnTrip:
				message = "Your driver is still on another trip that cannot finish in time for your pickup"
			case BookingFailDriverUnavailable:
				message = "Your driver was not available to start this booking in time"
			}
			message += ", so it was released. Nothing was charged to you and any payment hold was released."
			if _, endErr := s.endBooking(ctx, b, systemEnd(machine.MpBookingFailed, blocked.reason, message)); endErr != nil {
				s.deps.Logger.Error().Err(endErr).Str("booking_id", b.ID.String()).Msg("failed to release an unactivatable booking")
			}
			continue
		}
		if deferErr := s.deps.Store.DeferBooking(ctx, s.deps.Store.Pool(), b.ID, err.Error(), now.Add(bookingRetryDelay)); deferErr != nil {
			s.deps.Logger.Error().Err(deferErr).Msg("could not defer the booking activation")
		}
	}
}

// activateBooking moves one reconfirmed booking into the driver's live
// slots. With no current job it becomes the CURRENT claim and its execution
// ride is created (driver navigating to pickup); behind a running trip that
// can finish in time it becomes the queued NEXT claim, which the existing
// promotion picks up exactly once. The commission is NEVER charged here —
// it was captured once at the advance award.
func (s *Service) activateBooking(ctx context.Context, b *AdvanceBooking, now time.Time) error {
	award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), b.AwardID)
	if err != nil {
		return err
	}
	if award.State != machine.MpAwardConfirmed {
		return nil
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), b.RequestID)
	if err != nil {
		return err
	}
	if request.State != machine.MpRequestAwarded {
		return nil
	}
	config, policy, err := s.policy(ctx, b.CityID)
	if err != nil {
		return err
	}
	blocked, err := s.driverBlocked(ctx, b.DriverID)
	if err != nil {
		return err
	}
	if blocked {
		_, err := s.endBooking(ctx, b, systemEnd(machine.MpBookingFailed, BookingFailDriverIneligible,
			"Your driver can no longer take marketplace trips, so this booking was released. Nothing was charged to you."))
		return err
	}
	current, err := s.deps.Store.CurrentClaim(ctx, s.deps.Store.Pool(), b.DriverID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return err
	}
	if current == nil {
		return s.activateIntoCurrent(ctx, b, award, request, config, now)
	}
	return s.activateIntoNext(ctx, b, award, request, current, policy, now)
}

// activateIntoCurrent makes a booking the driver's current job.
func (s *Service) activateIntoCurrent(ctx context.Context, b *AdvanceBooking, award *Award, request *Request, config *cityconfig.CityConfig, now time.Time) error {
	session, err := s.deps.Store.DriverSessionRow(ctx, s.deps.Store.Pool(), b.DriverID)
	if errors.Is(err, domain.ErrNotFound) {
		return &activationError{reason: BookingFailDriverUnavailable, detail: "the driver has no session"}
	}
	if err != nil {
		return err
	}
	if session.State != machine.DriverAvailable {
		return &activationError{reason: BookingFailDriverUnavailable, detail: "the driver is " + session.State}
	}
	claim := &Claim{
		ID:       uuid.New(),
		DriverID: b.DriverID,
		State:    machine.MpClaimAwardPending,
		Slot:     SlotCurrent,
		Service:  request.Service,
		AwardID:  &award.ID,
	}
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, lockedAward, lockedRequest, proceed, err := s.lockForActivation(ctx, tx, b, award, request)
		if err != nil || !proceed {
			return err
		}
		if err := s.deps.Store.InsertClaim(ctx, tx, claim); err != nil {
			if errors.Is(err, errSlotOccupied) {
				return &activationError{reason: BookingFailDriverUnavailable, detail: "the driver's current slot was taken"}
			}
			return err
		}
		ride, _, err := s.createExecutionRide(ctx, tx, lockedRequest, lockedAward, config, now)
		if err != nil {
			if isExecutionBlocked(err) {
				return &activationError{reason: BookingFailDriverUnavailable, detail: err.Error()}
			}
			return err
		}
		service := ServiceRide
		claimed, err := s.deps.Store.TransitionClaim(ctx, tx, claim, machine.MpClaimCurrent, ClaimUpdate{
			ExecutionService: &service,
			ExecutionID:      &ride.ID,
		})
		if err != nil {
			return err
		}
		if err := s.deps.Store.SetAwardExecution(ctx, tx, lockedAward.ID, service, ride.ID); err != nil {
			return err
		}
		if _, err := s.deps.Store.TransitionRequest(ctx, tx, lockedRequest, machine.MpRequestExecution, RequestUpdate{}); err != nil {
			return err
		}
		return s.finishActivation(ctx, tx, locked, claimed, ride.ID.String(), now)
	})
	return err
}

// activateIntoNext queues a booking behind the driver's running trip — only
// when the queued vertical is open, the next slot is free and the trip can
// finish in time for the booking's window (predicted from the driver's
// ACTUAL position, stop-aware). Otherwise it waits; nobody is diverted.
func (s *Service) activateIntoNext(ctx context.Context, b *AdvanceBooking, award *Award, request *Request, current *Claim, policy *cityconfig.MarketplacePolicy, now time.Time) error {
	if !s.flagOn(ctx, cityconfig.FlagMarketplaceQueuedJobs, b.DriverID.String(), b.CityID) {
		return &activationError{reason: BookingFailDriverOnTrip, detail: "the driver is on a trip and queued jobs are not enabled"}
	}
	if current.ExecutionID == nil {
		return &activationError{reason: BookingFailDriverOnTrip, detail: "the driver's current job is still being awarded"}
	}
	if next, err := s.deps.Store.NextClaim(ctx, s.deps.Store.Pool(), b.DriverID); err == nil && next != nil {
		return &activationError{reason: BookingFailDriverOnTrip, detail: "the driver's queue is full"}
	} else if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return err
	}
	window, err := s.computeQueueWindow(ctx, b.DriverID, request.Pickup, policy)
	if err != nil {
		return &activationError{reason: BookingFailDriverOnTrip, detail: "the running trip's finish cannot be predicted: " + err.Error()}
	}
	if now.Add(time.Duration(window.PredictedSec) * time.Second).After(b.WindowEnd) {
		return &activationError{reason: BookingFailDriverOnTrip, detail: "the running trip cannot finish in time for the pickup window"}
	}
	// The promise the queued booking carries is its own window's end.
	window.ConsentedLatestSec = int(b.WindowEnd.Sub(now) / time.Second)
	dependsOn := current.ID
	claim := &Claim{
		ID:               uuid.New(),
		DriverID:         b.DriverID,
		State:            machine.MpClaimAwardPending,
		Slot:             SlotNext,
		Service:          request.Service,
		AwardID:          &award.ID,
		DependsOnClaimID: &dependsOn,
	}
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, lockedAward, _, proceed, err := s.lockForActivation(ctx, tx, b, award, request)
		if err != nil || !proceed {
			return err
		}
		if err := s.deps.Store.InsertClaim(ctx, tx, claim); err != nil {
			if errors.Is(err, errSlotOccupied) {
				return &activationError{reason: BookingFailDriverOnTrip, detail: "the driver's queue was taken"}
			}
			return err
		}
		claimed, err := s.deps.Store.TransitionClaim(ctx, tx, claim, machine.MpClaimNext, ClaimUpdate{})
		if err != nil {
			return err
		}
		if err := s.deps.Store.SetAwardWindow(ctx, tx, lockedAward.ID, window); err != nil {
			return err
		}
		return s.finishActivation(ctx, tx, locked, claimed, "", now)
	})
}

// lockForActivation re-reads the booking, award and request under lock (in
// that order) and reports whether activation may proceed: a booking already
// activated — by a concurrent or restarted pass — answers false, so
// activation happens exactly once.
func (s *Service) lockForActivation(ctx context.Context, tx pgx.Tx, b *AdvanceBooking, award *Award, request *Request) (*AdvanceBooking, *Award, *Request, bool, error) {
	locked, err := s.deps.Store.BookingForUpdate(ctx, tx, b.ID)
	if err != nil {
		return nil, nil, nil, false, err
	}
	if locked.State != machine.MpBookingReconfirmed {
		return nil, nil, nil, false, nil
	}
	lockedAward, err := s.deps.Store.AwardForUpdate(ctx, tx, award.ID)
	if err != nil {
		return nil, nil, nil, false, err
	}
	if lockedAward.State != machine.MpAwardConfirmed {
		return nil, nil, nil, false, nil
	}
	lockedRequest, err := s.deps.Store.RequestForUpdate(ctx, tx, request.ID)
	if err != nil {
		return nil, nil, nil, false, err
	}
	if lockedRequest.State != machine.MpRequestAwarded {
		return nil, nil, nil, false, nil
	}
	return locked, lockedAward, lockedRequest, true, nil
}

// finishActivation records the activation on the booking with its events
// and audit row, inside the activation transaction.
func (s *Service) finishActivation(ctx context.Context, tx pgx.Tx, b *AdvanceBooking, claim *Claim, rideID string, now time.Time) error {
	slot := claim.Slot
	claimID := claim.ID
	moved, err := s.deps.Store.TransitionBooking(ctx, tx, b, machine.MpBookingActivated, BookingUpdate{
		ActivatedAt: &now, ActivatedSlot: &slot, ClaimID: &claimID, ClearNextTry: true,
	})
	if err != nil {
		return err
	}
	if err := writeEvent(ctx, tx, Event{
		Name:           "mp.claim.created",
		AggregateType:  subjectClaim,
		AggregateID:    claim.ID.String(),
		ToVersion:      1,
		CityID:         b.CityID,
		ActorType:      "system",
		ActorID:        "ride-service",
		IdempotencyKey: "mp.claim.created:" + claim.ID.String(),
		OccurredAt:     now,
		Payload: map[string]any{
			"claimId":      claim.ID.String(),
			"awardId":      b.AwardID.String(),
			"driverId":     claim.DriverID.String(),
			"slot":         claim.Slot,
			"fencingToken": claim.FencingToken,
			"bookingId":    b.ID.String(),
			"source":       "advance_booking_activation",
		},
	}); err != nil {
		return err
	}
	extra := map[string]any{
		"slot":                     slot,
		"claimId":                  claim.ID.String(),
		"commissionChargedAgain":   false,
		"commissionAlreadyCharged": b.CommissionMinor,
		"currency":                 b.Currency,
	}
	if rideID != "" {
		extra["rideId"] = rideID
	}
	if err := s.writeBookingEvent(ctx, tx, moved, "mp.advance_booking.activated", "system", "ride-service", now, extra); err != nil {
		return err
	}
	return writeAudit(ctx, tx, AuditRecord{
		ActorID: "ride-service", ActorRole: "system", Action: "mp.advance_booking.activated",
		SubjectType: subjectBooking, SubjectID: moved.ID.String(),
		Before: map[string]any{"state": b.State},
		After:  map[string]any{"state": moved.State, "slot": slot, "claimId": claim.ID.String(), "rideId": rideID},
		// NO second commission: the fee was captured once, at the advance award.
		Reason: "advance booking activated into the driver's live slots near pickup",
	})
}

// sweepActivatedBookings records how activated bookings ended: completed
// when their execution completed, failed when the award was cancelled (a
// driver-cancelled or driver-offline queued job — whose money the award
// paths already reversed) or the trip was cancelled otherwise.
func (s *Service) sweepActivatedBookings(ctx context.Context, now time.Time) {
	rows, err := s.deps.Store.BookingsInStates(ctx, s.deps.Store.Pool(),
		[]string{machine.MpBookingActivated}, "activation_at", now, now, false, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list activated bookings")
		return
	}
	for _, b := range rows {
		award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), b.AwardID)
		if err != nil {
			continue
		}
		to := ""
		var failure *BookingFailure
		switch {
		case award.State == machine.MpAwardCancelled:
			to = machine.MpBookingFailed
			failure = &BookingFailure{
				Reason:               BookingFailAwardCancelled,
				Message:              "Your driver could not complete this booking (" + award.FailReason + "). Nothing was charged to you and any payment hold was released.",
				CommissionReversed:   true,
				RiderFundingReleased: true,
			}
		case award.ExecutionID != nil:
			ride, err := s.deps.Store.ExecutionRideRow(ctx, s.deps.Store.Pool(), *award.ExecutionID)
			if err != nil || machine.IsRiderActive(ride.State) {
				continue
			}
			switch ride.State {
			case machine.RiderCompleted, machine.RiderPaymentPending, machine.RiderPaymentFailed, machine.RiderRated:
				to = machine.MpBookingCompleted
			default:
				to = machine.MpBookingFailed
				failure = &BookingFailure{
					Reason:  BookingFailTripCancelled,
					Message: "The trip from this booking was cancelled (" + ride.State + ").",
				}
			}
		default:
			continue
		}
		if err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
			locked, err := s.deps.Store.BookingForUpdate(ctx, tx, b.ID)
			if err != nil {
				return err
			}
			if locked.State != machine.MpBookingActivated {
				return nil
			}
			moved, err := s.deps.Store.TransitionBooking(ctx, tx, locked, to, BookingUpdate{Failure: failure})
			if err != nil {
				return err
			}
			name := "mp.advance_booking.completed"
			extra := map[string]any{}
			if to == machine.MpBookingFailed {
				name = "mp.advance_booking.failed"
				extra["reason"] = failure.Reason
				extra["message"] = failure.Message
			}
			if err := s.writeBookingEvent(ctx, tx, moved, name, "system", "ride-service", now, extra); err != nil {
				return err
			}
			after := map[string]any{"state": moved.State}
			for key, value := range extra {
				after[key] = value
			}
			return writeAudit(ctx, tx, AuditRecord{
				ActorID: "ride-service", ActorRole: "system", Action: name,
				SubjectType: subjectBooking, SubjectID: moved.ID.String(),
				Before: map[string]any{"state": locked.State},
				After:  after,
				Reason: "an activated advance booking's trip reached its outcome",
			})
		}); err != nil {
			s.deps.Logger.Error().Err(err).Str("booking_id", b.ID.String()).Msg("failed to record an activated booking's outcome")
		}
	}
}

// sweepBookingReminders publishes each due reminder offset once per live
// booking, to both parties.
func (s *Service) sweepBookingReminders(ctx context.Context, now time.Time) {
	// Every live booking in the reminder horizon, page by page: a single
	// soonest-first batch would hold back a later booking's reminder until
	// the calendar ahead of it thinned out.
	var rows []*AdvanceBooking
	afterStart, afterID := now, uuid.Nil
	for page := 0; page < reminderPageCap; page++ {
		batch, err := s.deps.Store.BookingsForReminders(ctx, s.deps.Store.Pool(),
			[]string{machine.MpBookingPaymentPending, machine.MpBookingConfirmed, machine.MpBookingReconfirmed},
			now, now.Add(reminderHorizon), afterStart, afterID, sweepBatch)
		if err != nil {
			s.deps.Logger.Error().Err(err).Msg("failed to list bookings for reminders")
			break
		}
		rows = append(rows, batch...)
		if len(batch) < sweepBatch {
			break
		}
		last := batch[len(batch)-1]
		afterStart, afterID = last.WindowStart, last.ID
	}
	policies := map[string]*cityconfig.AdvanceReservationPolicy{}
	for _, b := range rows {
		advance, ok := policies[b.CityID]
		if !ok {
			if _, policy, err := s.policy(ctx, b.CityID); err == nil {
				advance, _ = policy.AdvanceReservationPolicyFor(b.CityID)
			}
			policies[b.CityID] = advance
		}
		if advance == nil {
			continue
		}
		for _, offset := range dueReminderOffsets(advance.ReminderOffsetsSec, b.RemindersSent, b.WindowStart, b.CreatedAt, now) {
			if err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
				recorded, err := s.deps.Store.MarkBookingReminder(ctx, tx, b.ID, offset)
				if err != nil || !recorded {
					return err
				}
				return s.writeBookingEvent(ctx, tx, b, "mp.advance_booking.reminder", "system", "ride-service", now,
					map[string]any{
						"offsetSec": offset,
						"audience":  []string{viewerRider, viewerDriver},
						"fullySecured": b.State != machine.MpBookingPaymentPending &&
							(b.FundingState == BookingFundingSecured || b.FundingState == BookingFundingUnsecuredCash),
					}, b.ID.String(), itoa(offset))
			}); err != nil {
				s.deps.Logger.Error().Err(err).Str("booking_id", b.ID.String()).Msg("failed to send a booking reminder")
			}
		}
	}
}
