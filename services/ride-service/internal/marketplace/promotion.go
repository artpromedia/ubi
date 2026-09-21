package marketplace

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// ExecutionTerminal implements move.ExecutionObserver: the move core calls it
// after a ride commits into a terminal state. It is a post-commit courtesy —
// the durable promotion sweep catches anything this call misses, so a crash
// between commit and callback loses nothing.
func (s *Service) ExecutionTerminal(ctx context.Context, rideID uuid.UUID) {
	if err := s.handleExecutionTerminal(ctx, rideID); err != nil {
		s.deps.Logger.Error().Err(err).Str("ride_id", rideID.String()).
			Msg("marketplace completion handling failed; the sweep will retry")
	}
}

// handleExecutionTerminal releases the CURRENT claim coupled to a finished
// execution ride and promotes the driver's queued next claim, exactly once.
func (s *Service) handleExecutionTerminal(ctx context.Context, rideID uuid.UUID) error {
	claim, err := s.deps.Store.CurrentClaimByExecutionID(ctx, s.deps.Store.Pool(), rideID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	ride, err := s.deps.Store.ExecutionRideRow(ctx, s.deps.Store.Pool(), rideID)
	if err != nil {
		return err
	}
	if machine.IsRiderActive(ride.State) {
		return nil
	}

	completed := ride.State == machine.RiderCompleted ||
		ride.State == machine.RiderPaymentPending ||
		ride.State == machine.RiderPaymentFailed ||
		ride.State == machine.RiderRated
	driverCancelled := ride.State == machine.RiderCancelledByDriver

	// A COMPLETED marketplace execution owes payment-service its M06
	// settlement (the fee was captured at selection and is never charged
	// again). The intent is written durably INSIDE the claim-completion
	// transaction, then settled after commit; the recovery sweep retries
	// anything the wire lost. Everything the transaction must not fetch from
	// the pool mid-flight is read first (pool-deadlock rule).
	var settlement *SettlementRequest
	var settlementRowID uuid.UUID
	if completed && claim.AwardID != nil {
		award, awardErr := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), *claim.AwardID)
		if awardErr != nil {
			return awardErr
		}
		request, requestErr := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), award.RequestID)
		if requestErr != nil {
			return requestErr
		}
		method := "wallet"
		if request.PaymentMethodID == "cash" {
			method = "cash"
		}
		service := claim.ExecutionService
		if service == "" {
			service = ServiceRide
		}
		settlement = &SettlementRequest{
			AwardID:      award.ID,
			ExecutionRef: ExecutionRef{Service: service, ID: rideID.String()},
			RequesterID:  award.RequesterID,
			DriverID:     award.DriverID,
			FareMinor:    money(award.FareMinor, request.Currency),
			Method:       method,
			CityID:       request.CityID,
		}
		settlementRowID = uuid.New()
	}

	// A DRIVER-CANCELLED execution unwinds its award instead: award cancelled,
	// the captured commission reversed and the rider's funding reservation
	// released, all through the ONE existing reversal funnel
	// (`reverseCapturedHold` on the payment side, idempotent under the award's
	// reverse/release keys). The intents are written durably INSIDE the
	// claim-release transaction, driven after commit and swept until confirmed
	// — so a crash anywhere loses nothing and a replay moves no money twice.
	var unwind *driverCancelUnwind
	if driverCancelled && claim.AwardID != nil {
		award, awardErr := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), *claim.AwardID)
		if awardErr != nil {
			return awardErr
		}
		if award.State == machine.MpAwardConfirmed {
			bid, bidErr := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), award.BidID)
			if bidErr != nil {
				return bidErr
			}
			request, requestErr := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), award.RequestID)
			if requestErr != nil {
				return requestErr
			}
			unwind = &driverCancelUnwind{
				award: award, bid: bid, request: request,
				reverseRowID: uuid.New(), fundingRowID: uuid.New(),
			}
		}
	}

	now := s.now()
	settlementRecorded := false
	unwound := false
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.ClaimForUpdate(ctx, tx, claim.ID)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				return nil
			}
			return err
		}
		if locked.State != machine.MpClaimCurrent {
			return nil
		}
		to := machine.MpClaimReleased
		if completed {
			to = machine.MpClaimCompleted
		}
		if _, err := s.deps.Store.TransitionClaim(ctx, tx, locked, to, ClaimUpdate{}); err != nil {
			return err
		}
		if unwind != nil {
			applied, err := s.unwindDriverCancelledAward(ctx, tx, unwind, now)
			if err != nil {
				return err
			}
			unwound = applied
		}
		if settlement != nil {
			// The claim transition commits exactly once, so this intent is
			// written exactly once — and the settlement itself is idempotent
			// on the award id besides.
			payload, marshalErr := json.Marshal(settlement)
			if marshalErr != nil {
				return marshalErr
			}
			driverID := settlement.DriverID
			if err := s.deps.Store.InsertRecovery(ctx, tx, RecoveryRow{
				ID:            settlementRowID,
				ReservationID: settlementKeyFor(settlement.AwardID),
				DriverID:      driverID,
				Action:        RecoverySettle,
				Payload:       payload,
			}); err != nil {
				return err
			}
			settlementRecorded = true
		}
		return writeEvent(ctx, tx, Event{
			Name:           "mp.claim.released",
			AggregateType:  subjectClaim,
			AggregateID:    locked.ID.String(),
			ToVersion:      1,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "mp.claim.released:" + locked.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"claimId":  locked.ID.String(),
				"driverId": locked.DriverID.String(),
				"rideId":   rideID.String(),
				"outcome":  ride.State,
			},
		})
	})
	if err != nil {
		return err
	}

	if settlementRecorded {
		// The rows are committed: settle now, under the award's ONE
		// settlement key. Any failure — definite or unknown — leaves the
		// durable row for the sweep, which converges on the same key.
		if settleErr := s.deps.Settlement.Settle(ctx, *settlement, settlementKeyFor(settlement.AwardID)); settleErr != nil {
			s.deps.Logger.Warn().Err(settleErr).Str("award_id", settlement.AwardID.String()).
				Msg("completion settlement unconfirmed; the sweep will retry it")
		} else if resolveErr := s.deps.Store.ResolveRecovery(ctx, s.deps.Store.Pool(), settlementRowID, now); resolveErr != nil {
			s.deps.Logger.Error().Err(resolveErr).Str("award_id", settlement.AwardID.String()).
				Msg("could not resolve the settlement recovery row")
		}
	}
	if unwound {
		s.driveDriverCancelReversal(ctx, unwind, now)
	}

	return s.promoteNextFor(ctx, claim.DriverID)
}

// driverCancelUnwind carries everything the driver-cancel terminal path needs
// to unwind one confirmed award: the rows read before the transaction and the
// ids of the durable recovery intents written inside it.
type driverCancelUnwind struct {
	award   *Award
	bid     *Bid
	request *Request
	// reverseRowID / fundingRowID are the recovery rows written INSIDE the
	// claim-release transaction, so a crash between commit and the wallet
	// calls leaves the sweep a durable record of what is still owed.
	reverseRowID uuid.UUID
	fundingRowID uuid.UUID
}

// driverCancelReason is the linked reason the driver-cancel unwind carries
// into the award row, the commission reversal and the funding release.
const driverCancelReason = "driver_cancelled"

// unwindDriverCancelledAward applies the state half of the unwind inside the
// claim-release transaction: award confirmed → cancelled, the request's
// closeReason made honest (its state is `execution`, already terminal — the
// rider app renders "driver cancelled" and may only start a NEW search by
// explicit request), and the two money intents written durably. It reports
// whether it applied — a replay finds the award already cancelled and applies
// nothing, so the money funnel runs at most once.
func (s *Service) unwindDriverCancelledAward(ctx context.Context, tx pgx.Tx, unwind *driverCancelUnwind, now time.Time) (bool, error) {
	lockedAward, err := s.deps.Store.AwardForUpdate(ctx, tx, unwind.award.ID)
	if err != nil {
		return false, err
	}
	if lockedAward.State != machine.MpAwardConfirmed {
		return false, nil
	}
	reason := driverCancelReason
	if _, err := s.deps.Store.TransitionAward(ctx, tx, lockedAward, machine.MpAwardCancelled, AwardUpdate{
		FailReason: &reason,
		ResolvedAt: &now,
	}); err != nil {
		return false, err
	}

	lockedRequest, err := s.deps.Store.RequestForUpdate(ctx, tx, unwind.request.ID)
	if err != nil {
		return false, err
	}
	// The request sits in `execution` — terminal in the mpRequest machine —
	// so no state moves; the closeReason is what tells the requester the
	// truth. No new request and no new search are started here: that is the
	// requester's explicit call.
	if lockedRequest.CloseReason == "" {
		if err := s.deps.Store.SetRequestCloseReason(ctx, tx, lockedRequest.ID, driverCancelReason); err != nil {
			return false, err
		}
	}
	if err := writeEvent(ctx, tx, Event{
		Name:           "mp.request.closed",
		AggregateType:  subjectRequest,
		AggregateID:    lockedRequest.ID.String(),
		ToVersion:      lockedRequest.Version,
		CityID:         lockedRequest.CityID,
		ActorType:      "system",
		ActorID:        "ride-service",
		IdempotencyKey: "mp.request.closed:" + lockedRequest.ID.String(),
		OccurredAt:     now,
		Payload: map[string]any{
			"requestId": lockedRequest.ID.String(),
			"reason":    driverCancelReason,
		},
	}); err != nil {
		return false, err
	}

	// The two money intents, durable in this same transaction: the captured
	// commission's linked reversal and the rider funding release, each under
	// its award-derived idempotency key so the post-commit drive and the
	// sweep converge on ONE reversal and ONE release however often they run.
	bidID := unwind.bid.ID
	if err := s.deps.Store.InsertRecovery(ctx, tx, RecoveryRow{
		ID:            unwind.reverseRowID,
		ReservationID: unwind.bid.ReservationID,
		DriverID:      unwind.bid.DriverID,
		BidID:         &bidID,
		Action:        RecoveryReverse,
	}); err != nil {
		return false, err
	}
	fundingPayload, err := json.Marshal(FundingReleaseRecoveryPayload{
		AwardID: unwind.award.ID,
		Reason:  driverCancelReason,
	})
	if err != nil {
		return false, err
	}
	if err := s.deps.Store.InsertRecovery(ctx, tx, RecoveryRow{
		ID:            unwind.fundingRowID,
		ReservationID: fundingReleaseKeyFor(unwind.award.ID),
		DriverID:      unwind.award.RequesterID,
		Action:        RecoveryFundingRelease,
		Payload:       fundingPayload,
	}); err != nil {
		return false, err
	}

	if err := writeEvent(ctx, tx, Event{
		Name:           "mp.award.cancelled",
		AggregateType:  subjectAward,
		AggregateID:    unwind.award.ID.String(),
		ToVersion:      1,
		CityID:         unwind.request.CityID,
		ActorType:      "system",
		ActorID:        "ride-service",
		IdempotencyKey: "mp.award.cancelled:" + unwind.award.ID.String(),
		OccurredAt:     now,
		Payload: map[string]any{
			"awardId":         unwind.award.ID.String(),
			"requestId":       unwind.award.RequestID.String(),
			"driverId":        unwind.award.DriverID.String(),
			"commissionMinor": unwind.award.CommissionMinor,
			"reason":          driverCancelReason,
			"feeReversed":     true,
		},
	}); err != nil {
		return false, err
	}
	if err := writeAudit(ctx, tx, AuditRecord{
		ActorID:     "ride-service",
		ActorRole:   "system",
		Action:      "mp.award.cancelled",
		SubjectType: subjectAward,
		SubjectID:   unwind.award.ID.String(),
		Before:      map[string]any{"state": machine.MpAwardConfirmed},
		After:       map[string]any{"state": machine.MpAwardCancelled, "reason": driverCancelReason},
		Reason:      "the assigned driver cancelled the marketplace execution",
	}); err != nil {
		return false, err
	}
	return true, nil
}

// driveDriverCancelReversal is the post-commit half of the unwind: it drives
// the commission reversal and the rider funding release now, resolving each
// durable intent on a confirmed answer. Anything unconfirmed stays written
// down for the sweep, which re-drives the same keys — never a second entry.
func (s *Service) driveDriverCancelReversal(ctx context.Context, unwind *driverCancelUnwind, now time.Time) {
	if _, revErr := s.deps.Wallet.Reverse(ctx, unwind.bid.ReservationID, unwind.award.ID.String(),
		driverCancelReason, "mp.reverse:"+unwind.award.ID.String()); revErr != nil {
		s.deps.Logger.Warn().Err(revErr).Str("award_id", unwind.award.ID.String()).
			Msg("driver-cancel fee reversal unconfirmed; the sweep owns the durable intent")
	} else if err := s.deps.Store.ResolveRecovery(ctx, s.deps.Store.Pool(), unwind.reverseRowID, now); err != nil {
		s.deps.Logger.Error().Err(err).Str("award_id", unwind.award.ID.String()).
			Msg("could not resolve the reversal recovery row")
	}

	relErr := s.deps.Funding.Release(ctx, unwind.award.ID, driverCancelReason, fundingReleaseKeyFor(unwind.award.ID))
	switch {
	case relErr == nil:
		if err := s.deps.Store.ResolveRecovery(ctx, s.deps.Store.Pool(), unwind.fundingRowID, now); err != nil {
			s.deps.Logger.Error().Err(err).Str("award_id", unwind.award.ID.String()).
				Msg("could not resolve the funding release recovery row")
		}
	case errors.Is(relErr, ErrFundingReservationConsumed):
		// A DEFINITE answer: settlement already spent this reservation, which
		// contradicts a driver-cancelled execution. Alarm, resolve (retrying
		// cannot change a consumed reservation), investigate.
		s.deps.Logger.Error().Str("award_id", unwind.award.ID.String()).
			Msg("rider funding reservation already CONSUMED for a driver-cancelled execution — settlement and cancellation disagree; investigate")
		if err := s.deps.Store.ResolveRecovery(ctx, s.deps.Store.Pool(), unwind.fundingRowID, now); err != nil {
			s.deps.Logger.Error().Err(err).Str("award_id", unwind.award.ID.String()).
				Msg("could not resolve the funding release recovery row")
		}
	default:
		s.deps.Logger.Warn().Err(relErr).Str("award_id", unwind.award.ID.String()).
			Msg("driver-cancel funding release unconfirmed; the sweep owns the durable intent")
	}
}

// promoteNextFor promotes the driver's queued next claim into the current
// slot, exactly once, after revalidating the pickup window from the driver's
// ACTUAL location — a cancelled-early current trip must never assume the
// original destination. It is idempotent: a claim that is no longer `next`,
// a slot already re-taken, or an unavailable driver make it a no-op that the
// sweep (or the driver-failure recovery) picks up later.
func (s *Service) promoteNextFor(ctx context.Context, driverID uuid.UUID) error {
	next, err := s.deps.Store.NextClaim(ctx, s.deps.Store.Pool(), driverID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if next.State != machine.MpClaimNext || next.AwardID == nil {
		return nil
	}
	if next.DependsOnClaimID != nil {
		dep, err := s.deps.Store.ClaimByID(ctx, s.deps.Store.Pool(), *next.DependsOnClaimID)
		if err != nil && !errors.Is(err, domain.ErrNotFound) {
			return err
		}
		if err == nil && dep.State != machine.MpClaimCompleted && dep.State != machine.MpClaimReleased {
			// The current job is still running; nothing to promote yet.
			return nil
		}
	}

	award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), *next.AwardID)
	if err != nil {
		return err
	}
	if award.State != machine.MpAwardConfirmed {
		return nil
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), award.RequestID)
	if err != nil {
		return err
	}
	if request.State != machine.MpRequestAwarded {
		return nil
	}
	config, policy, err := s.policy(ctx, request.CityID)
	if err != nil {
		return err
	}

	// Revalidate the ETA from where the driver ACTUALLY is. No usable
	// position or no route is an honest "not yet": the sweep retries, and a
	// driver who stays gone is handled by the queued-claim failure recovery.
	window, err := s.computeQueueWindow(ctx, driverID, request.Pickup, policy)
	if err != nil {
		s.deps.Logger.Info().Err(err).Str("driver_id", driverID.String()).
			Msg("promotion deferred: the pickup window cannot be recomputed yet")
		return nil
	}

	now := s.now()
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.ClaimForUpdate(ctx, tx, next.ID)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				return nil
			}
			return err
		}
		if locked.State != machine.MpClaimNext {
			return nil
		}
		lockedAward, err := s.deps.Store.AwardForUpdate(ctx, tx, award.ID)
		if err != nil {
			return err
		}
		if lockedAward.State != machine.MpAwardConfirmed {
			return nil
		}
		lockedRequest, err := s.deps.Store.RequestForUpdate(ctx, tx, request.ID)
		if err != nil {
			return err
		}
		if lockedRequest.State != machine.MpRequestAwarded {
			return nil
		}

		// The window is refreshed on the award before execution starts, so
		// the requester's timeline shows the revalidated numbers; the queue
		// events fire when the version moved or the promise was broken.
		merged, versionChanged, newlyMissed := mergeAwardWindow(lockedAward.PickupWindow, window)
		if err := s.deps.Store.SetAwardWindow(ctx, tx, lockedAward.ID, merged); err != nil {
			return err
		}
		if versionChanged {
			if err := s.writeQueueEtaEvent(ctx, tx, lockedAward, lockedRequest, merged, now); err != nil {
				return err
			}
		}
		if newlyMissed {
			if err := s.writeWindowMissedEvent(ctx, tx, lockedAward, lockedRequest, merged, now); err != nil {
				return err
			}
		}

		// The execution ride is created first: a driver who is not available
		// blocks the whole transaction and the promotion simply has not
		// happened.
		ride, pin, err := s.createExecutionRide(ctx, tx, lockedRequest, lockedAward, config, now)
		if err != nil {
			return err
		}
		// The plaintext PIN was encrypted into the vault inside createExecutionRide
		// (same tx). A promotion has no rider call in flight, so the requester
		// retrieves it over the authenticated REST channel (GET .../pin); it is
		// deliberately never put on the promotion event or any push.
		_ = pin

		service := "ride"
		slot := SlotCurrent
		promoted, err := s.deps.Store.TransitionClaim(ctx, tx, locked, machine.MpClaimCurrent, ClaimUpdate{
			Slot:             &slot,
			ExecutionService: &service,
			ExecutionID:      &ride.ID,
			// The fencing token bump is what makes a stale execution unable to
			// couple to the promoted claim, and what settles a race with a
			// fresh award for the freed slot.
			BumpFencing: true,
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

		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.claim.promoted",
			AggregateType:  subjectClaim,
			AggregateID:    promoted.ID.String(),
			ToVersion:      1,
			CityID:         request.CityID,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "mp.claim.promoted:" + promoted.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"claimId":      promoted.ID.String(),
				"awardId":      lockedAward.ID.String(),
				"driverId":     driverID.String(),
				"rideId":       ride.ID.String(),
				"fencingToken": promoted.FencingToken,
				"pickupWindow": map[string]any{
					"earliestSec": merged.EarliestSec,
					"latestSec":   merged.LatestSec,
					"etaVersion":  merged.EtaVersion,
				},
			},
		}); err != nil {
			return err
		}
		return writeAudit(ctx, tx, AuditRecord{
			ActorID:     "ride-service",
			ActorRole:   "system",
			Action:      "mp.claim.promoted",
			SubjectType: subjectClaim,
			SubjectID:   promoted.ID.String(),
			Before:      map[string]any{"state": machine.MpClaimNext},
			After:       map[string]any{"state": machine.MpClaimCurrent, "rideId": ride.ID.String()},
			// NO second commission: the fee was captured once, at selection.
			Reason: "queued claim promoted after the current job finished",
		})
	})
	if err != nil {
		if errors.Is(err, errSlotOccupied) || errors.Is(err, errExecutionBlocked) {
			// A fresh award took the freed slot first, or the driver is not
			// available: the partial uniques decided, and the claim stays
			// queued for a later pass (or for the failure recovery).
			s.deps.Logger.Info().Err(err).Str("driver_id", driverID.String()).
				Msg("promotion yielded; the queued claim stays queued")
			return nil
		}
		return err
	}
	return nil
}

// mergeAwardWindow folds a freshly computed window into the stored one,
// preserving what was consented and whether the missed-window event already
// fired. It reports whether the version moved and whether the promise was
// newly broken.
func mergeAwardWindow(stored, fresh *AwardWindow) (*AwardWindow, bool, bool) {
	merged := *fresh
	if stored == nil {
		return &merged, true, false
	}
	merged.ConsentedLatestSec = stored.ConsentedLatestSec
	merged.MissedEmitted = stored.MissedEmitted
	versionChanged := fresh.EtaVersion != stored.EtaVersion
	newlyMissed := !stored.MissedEmitted && stored.ConsentedLatestSec > 0 &&
		fresh.PredictedSec > stored.ConsentedLatestSec
	if newlyMissed {
		merged.MissedEmitted = true
	}
	return &merged, versionChanged, newlyMissed
}

func (s *Service) writeQueueEtaEvent(ctx context.Context, tx pgx.Tx, award *Award, request *Request, window *AwardWindow, now time.Time) error {
	return writeEvent(ctx, tx, Event{
		Name:           "mp.queue.eta_updated",
		AggregateType:  subjectAward,
		AggregateID:    award.ID.String(),
		ToVersion:      window.EtaVersion,
		CityID:         request.CityID,
		ActorType:      "system",
		ActorID:        "ride-service",
		IdempotencyKey: "mp.queue.eta_updated:" + award.ID.String() + ":" + itoa(window.EtaVersion),
		OccurredAt:     now,
		Payload: map[string]any{
			"awardId":   award.ID.String(),
			"requestId": request.ID.String(),
			"pickupWindow": map[string]any{
				"earliestSec": window.EarliestSec,
				"latestSec":   window.LatestSec,
				"etaVersion":  window.EtaVersion,
			},
		},
	})
}

func (s *Service) writeWindowMissedEvent(ctx context.Context, tx pgx.Tx, award *Award, request *Request, window *AwardWindow, now time.Time) error {
	return writeEvent(ctx, tx, Event{
		Name:          "mp.queue.window_missed",
		AggregateType: subjectAward,
		AggregateID:   award.ID.String(),
		ToVersion:     window.EtaVersion,
		CityID:        request.CityID,
		ActorType:     "system",
		ActorID:       "ride-service",
		// One idempotency key per award: the missed-window event fires ONCE.
		IdempotencyKey: "mp.queue.window_missed:" + award.ID.String(),
		OccurredAt:     now,
		Payload: map[string]any{
			"awardId":            award.ID.String(),
			"requestId":          request.ID.String(),
			"consentedLatestSec": window.ConsentedLatestSec,
			"predictedSec":       window.PredictedSec,
			"feeFreeCancel":      true,
		},
	})
}

// SetAwardExecution couples a confirmed award to its execution ride without a
// state change (promotion keeps the award confirmed; only pending awards move
// through TransitionAward).
func (s *Store) SetAwardExecution(ctx context.Context, db DB, awardID uuid.UUID, service string, executionID uuid.UUID) error {
	_, err := db.Exec(ctx, `
		UPDATE mp.awards SET execution_service = $2, execution_id = $3, updated_at = now()
		WHERE id = $1`, awardID, service, executionID)
	if err != nil {
		return err
	}
	return nil
}

// ---------------------------------------------------------------------------
// Queued-award cancellation: the fee-free exit after a missed window, and the
// driver-failure recovery. One reversal path, never silent.
// ---------------------------------------------------------------------------

// cancelQueuedAward cancels a CONFIRMED, still-queued award: award confirmed →
// cancelled, claim released, request closed, and the captured fee reversed
// with a linked entry after commit (recovery-backstopped). `saveIdem` lets the
// owner endpoint persist its idempotent response inside the same transaction.
func (s *Service) cancelQueuedAward(
	ctx context.Context,
	award *Award,
	reason string,
	actorID, actorRole string,
	saveIdem func(tx pgx.Tx, request *Request) error,
) (*Request, error) {
	bid, err := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), award.BidID)
	if err != nil {
		return nil, asDomainError(err)
	}

	now := s.now()
	var closedRequest *Request
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		lockedAward, err := s.deps.Store.AwardForUpdate(ctx, tx, award.ID)
		if err != nil {
			return err
		}
		if lockedAward.State != machine.MpAwardConfirmed {
			return domain.Errorf(domain.CodeRequestClosed, "this award can no longer be cancelled").
				WithDetails(map[string]any{"state": lockedAward.State})
		}
		claim, err := s.deps.Store.ClaimByAwardID(ctx, tx, award.ID)
		if err != nil {
			return err
		}
		claim, err = s.deps.Store.ClaimForUpdate(ctx, tx, claim.ID)
		if err != nil {
			return err
		}
		if claim.State != machine.MpClaimNext {
			// Promoted (or already released): cancelling a current job goes
			// through the ride, never through this path — and vice versa.
			return domain.Errorf(domain.CodeRequestClosed, "this job is no longer queued").
				WithDetails(map[string]any{"claimState": claim.State})
		}

		failReason := reason
		if _, err := s.deps.Store.TransitionAward(ctx, tx, lockedAward, machine.MpAwardCancelled, AwardUpdate{
			FailReason: &failReason,
			ResolvedAt: &now,
		}); err != nil {
			return err
		}
		if _, err := s.deps.Store.TransitionClaim(ctx, tx, claim, machine.MpClaimReleased, ClaimUpdate{}); err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.claim.released",
			AggregateType:  subjectClaim,
			AggregateID:    claim.ID.String(),
			ToVersion:      1,
			ActorType:      actorRole,
			ActorID:        actorID,
			IdempotencyKey: "mp.claim.released:" + claim.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"claimId":  claim.ID.String(),
				"awardId":  award.ID.String(),
				"driverId": claim.DriverID.String(),
				"reason":   reason,
			},
		}); err != nil {
			return err
		}

		lockedRequest, err := s.deps.Store.RequestForUpdate(ctx, tx, award.RequestID)
		if err != nil {
			return err
		}
		if lockedRequest.State == machine.MpRequestAwarded {
			closeReason := "cancelled"
			fromVersion := lockedRequest.Version
			moved, err := s.deps.Store.TransitionRequest(ctx, tx, lockedRequest, machine.MpRequestCancelled, RequestUpdate{
				CloseReason: &closeReason,
			})
			if err != nil {
				return err
			}
			closedRequest = moved
			if err := writeEvent(ctx, tx, Event{
				Name:           "mp.request.closed",
				AggregateType:  subjectRequest,
				AggregateID:    lockedRequest.ID.String(),
				FromVersion:    &fromVersion,
				ToVersion:      moved.Version,
				CityID:         lockedRequest.CityID,
				ActorType:      actorRole,
				ActorID:        actorID,
				IdempotencyKey: "mp.request.closed:" + lockedRequest.ID.String(),
				OccurredAt:     now,
				Payload: map[string]any{
					"requestId": lockedRequest.ID.String(),
					"reason":    reason,
				},
			}); err != nil {
				return err
			}
		} else {
			closedRequest = lockedRequest
		}

		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.award.cancelled",
			AggregateType:  subjectAward,
			AggregateID:    award.ID.String(),
			ToVersion:      1,
			CityID:         closedRequest.CityID,
			ActorType:      actorRole,
			ActorID:        actorID,
			IdempotencyKey: "mp.award.cancelled:" + award.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"awardId":         award.ID.String(),
				"requestId":       award.RequestID.String(),
				"driverId":        award.DriverID.String(),
				"commissionMinor": award.CommissionMinor,
				"reason":          reason,
				"feeReversed":     true,
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actorID,
			ActorRole:   actorRole,
			Action:      "mp.award.cancelled",
			SubjectType: subjectAward,
			SubjectID:   award.ID.String(),
			Before:      map[string]any{"state": machine.MpAwardConfirmed},
			After:       map[string]any{"state": machine.MpAwardCancelled, "reason": reason},
			Reason:      reason,
		}); err != nil {
			return err
		}
		if saveIdem != nil {
			return saveIdem(tx, closedRequest)
		}
		return nil
	})
	if err != nil {
		return nil, asDomainError(err)
	}

	// The rows are committed: the captured fee is reversed with a linked
	// entry, exactly once under the award's reversal key. A wallet that cannot
	// confirm it is owed by the sweep — never silent.
	if _, revErr := s.deps.Wallet.Reverse(ctx, bid.ReservationID, award.ID.String(),
		reason, "mp.reverse:"+award.ID.String()); revErr != nil {
		s.deps.Logger.Warn().Err(revErr).Str("award_id", award.ID.String()).
			Msg("fee reversal unconfirmed; recorded for the sweep")
		bidID := bid.ID
		if recErr := s.deps.Store.InsertRecovery(ctx, s.deps.Store.Pool(), RecoveryRow{
			ReservationID: bid.ReservationID,
			DriverID:      bid.DriverID,
			BidID:         &bidID,
			Action:        RecoveryReverse,
			LastError:     revErr.Error(),
		}); recErr != nil {
			s.deps.Logger.Error().Err(recErr).Msg("could not record the reversal for recovery")
		}
	}
	return closedRequest, nil
}

// ---------------------------------------------------------------------------
// Sweep passes for the queued lifecycle (wired into Service.Sweep).
// ---------------------------------------------------------------------------

// sweepStalledAwards resumes pending awards whose saga is due another push —
// including re-polling an unknown capture until the outcome is definite.
func (s *Service) sweepStalledAwards(ctx context.Context, now time.Time) {
	ids, err := s.deps.Store.StalledPendingAwards(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list stalled awards")
		return
	}
	for _, id := range ids {
		if _, _, err := s.advanceAward(ctx, id); err != nil {
			s.deps.Logger.Info().Err(err).Str("award_id", id.String()).
				Msg("award still unresolved; will retry")
		}
	}
}

// sweepPromotions is the durable side of exactly-once promotion: it catches
// completions whose post-commit callback was lost, and queued claims whose
// dependency finished.
func (s *Service) sweepPromotions(ctx context.Context) {
	stale, err := s.deps.Store.CurrentClaimsWithTerminalExecution(ctx, s.deps.Store.Pool(), sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list finished current claims")
	} else {
		for _, claim := range stale {
			if claim.ExecutionID == nil {
				continue
			}
			if err := s.handleExecutionTerminal(ctx, *claim.ExecutionID); err != nil {
				s.deps.Logger.Error().Err(err).Str("claim_id", claim.ID.String()).Msg("failed to settle finished claim")
			}
		}
	}

	promotable, err := s.deps.Store.PromotableNextClaims(ctx, s.deps.Store.Pool(), sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list promotable claims")
		return
	}
	for _, claim := range promotable {
		if err := s.promoteNextFor(ctx, claim.DriverID); err != nil {
			s.deps.Logger.Error().Err(err).Str("claim_id", claim.ID.String()).Msg("promotion failed")
		}
	}
}

// sweepQueuedWindows keeps every queued award's pickup window honest:
// continuous recomputation, mp.queue.eta_updated on a version change, and
// mp.queue.window_missed exactly once when the consented promise breaks —
// which opens the owner's fee-free cancel.
func (s *Service) sweepQueuedWindows(ctx context.Context, now time.Time) {
	claims, err := s.deps.Store.QueuedNextClaims(ctx, s.deps.Store.Pool(), sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list queued claims")
		return
	}
	for _, claim := range claims {
		if claim.AwardID == nil {
			continue
		}
		award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), *claim.AwardID)
		if err != nil || award.State != machine.MpAwardConfirmed {
			continue
		}
		request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), award.RequestID)
		if err != nil {
			continue
		}
		_, policy, err := s.policy(ctx, request.CityID)
		if err != nil {
			continue
		}
		window, err := s.computeQueueWindow(ctx, claim.DriverID, request.Pickup, policy)
		if err != nil {
			// No honest number, no update — the last window stands and the
			// driver-failure sweep owns a driver who stays gone.
			continue
		}
		merged, versionChanged, newlyMissed := mergeAwardWindow(award.PickupWindow, window)
		if !versionChanged && !newlyMissed {
			continue
		}
		err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
			locked, err := s.deps.Store.AwardForUpdate(ctx, tx, award.ID)
			if err != nil {
				return err
			}
			if locked.State != machine.MpAwardConfirmed {
				return nil
			}
			if err := s.deps.Store.SetAwardWindow(ctx, tx, locked.ID, merged); err != nil {
				return err
			}
			if versionChanged {
				if err := s.writeQueueEtaEvent(ctx, tx, locked, request, merged, now); err != nil {
					return err
				}
			}
			if newlyMissed {
				if err := s.writeWindowMissedEvent(ctx, tx, locked, request, merged, now); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			s.deps.Logger.Error().Err(err).Str("award_id", award.ID.String()).Msg("queued window update failed")
		}
	}
}

// sweepQueuedDriverFailures cancels queued awards whose driver has gone
// offline (or vanished): the same reversal path as the owner's fee-free
// cancel, driven by the sweep, never silent.
func (s *Service) sweepQueuedDriverFailures(ctx context.Context) {
	claims, err := s.deps.Store.NextClaimsWithOfflineDriver(ctx, s.deps.Store.Pool(), sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list queued claims with offline drivers")
		return
	}
	for _, claim := range claims {
		if claim.AwardID == nil {
			continue
		}
		award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), *claim.AwardID)
		if err != nil || award.State != machine.MpAwardConfirmed {
			continue
		}
		if _, err := s.cancelQueuedAward(ctx, award, "driver_offline", "ride-service", "system", nil); err != nil {
			s.deps.Logger.Error().Err(err).Str("award_id", award.ID.String()).
				Msg("failed to cancel a queued award for an offline driver")
		}
	}
}
