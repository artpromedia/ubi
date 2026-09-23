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

// SubmitBid is the body of POST /v1/mp/bids (MpSubmitBidSchema).
// amountMinor is a Money object per the contract.
type SubmitBid struct {
	RequestID          uuid.UUID  `json:"requestId"`
	RequestRevision    int        `json:"requestRevision"`
	AmountMinor        Money      `json:"amountMinor"`
	Slot               string     `json:"slot"`
	DependsOnClaimID   *uuid.UUID `json:"dependsOnClaimId,omitempty"`
	AvailabilityEpoch  int64      `json:"availabilityEpoch"`
	RateProfileVersion *int       `json:"rateProfileVersion,omitempty"`
}

// isBidRevisable reports whether a bid is in a state a DRIVER may revise:
// submitted or revised, never selected_pending. The selected_pending→revised
// machine edge exists ONLY for the award saga's compensation; a user revise
// that lands after a selection pinned the terms must lose.
func isBidRevisable(state string) bool {
	return state == machine.MpBidSubmitted || state == machine.MpBidRevised
}

// CreateBid submits a funded bid (D02 → D03).
//
// Order of operations is the money invariant of this slice:
//
//  1. everything is validated — eligibility re-evaluated authoritatively,
//     bounds, slot rules, caps;
//  2. the 10% commission is RESERVED through the wallet, so a bid can never
//     be live without cleared funds behind it;
//  3. only then does the bid row become live, in one transaction with its
//     event, its audit row and its idempotency record — with the per-driver
//     cap RE-CHECKED inside that transaction under an advisory lock, so
//     concurrent submissions cannot slip past it;
//  4. if that transaction fails, the reservation is released (compensation),
//     and a release that cannot be confirmed is written down for the sweep.
func (s *Service) CreateBid(ctx context.Context, actor Actor, req SubmitBid, idempotencyKey string) (*BidView, int, error) {
	if !actor.IsDriver() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only a driver can bid")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	if req.Slot != SlotCurrent && req.Slot != SlotNext && req.Slot != SlotAdvance {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "%q is not a bid slot", req.Slot)
	}

	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeBidCreate, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view BidView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}

	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), req.RequestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if err := s.requireServiceFlag(ctx, request.Service, actor, request.CityID); err != nil {
		return nil, 0, err
	}

	now := s.now()
	if request.State != machine.MpRequestOpen || !now.Before(request.ExpiresAt) {
		return nil, 0, domain.Errorf(domain.CodeRequestClosed, "this request is no longer taking bids").
			WithDetails(map[string]any{"state": request.State})
	}
	if request.Revision != req.RequestRevision {
		return nil, 0, domain.Errorf(domain.CodeVersionConflict,
			"the request was revised after you looked at it; review the new terms").
			WithDetails(map[string]any{"seenRevision": req.RequestRevision, "currentRevision": request.Revision})
	}
	if request.RequesterID == actor.UserID {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}

	config, policy, err := s.policy(ctx, request.CityID)
	if err != nil {
		return nil, 0, err
	}

	// Bounds are the request's stored ones — the server's numbers — and the
	// amount must be denominated in the request's currency.
	if err := requireCurrency(req.AmountMinor, request.Currency, "amountMinor"); err != nil {
		return nil, 0, err
	}
	amountMinor := req.AmountMinor.AmountMinor
	if amountMinor < request.MinMinor || amountMinor > request.MaxMinor {
		return nil, 0, fareOutOfBounds(amountMinor, request.MinMinor, request.MaxMinor,
			request.Currency, config.CurrencyFractionDigits)
	}

	// Eligibility is revalidated authoritatively — never trusted from the
	// evaluation the driver app rendered.
	eligibility, err := s.EvaluateEligibility(ctx, actor, request, config, policy)
	if err != nil {
		return nil, 0, err
	}
	if !eligibility.Eligible || eligibility.Slot == nil {
		return nil, 0, domain.Errorf(domain.CodeSlotUnavailable, "you are not eligible to bid on this request right now").
			WithDetails(map[string]any{"reasons": eligibility.Reasons})
	}
	if *eligibility.Slot != req.Slot {
		return nil, 0, domain.Errorf(domain.CodeSlotUnavailable,
			"this bid asks for the %s slot but you qualify for the %s slot", req.Slot, *eligibility.Slot).
			WithDetails(map[string]any{"requestedSlot": req.Slot, "eligibleSlot": *eligibility.Slot})
	}
	if req.AvailabilityEpoch != eligibility.AvailabilityEpoch {
		return nil, 0, domain.Errorf(domain.CodeVersionConflict,
			"your availability changed after this bid was prepared; refresh and try again").
			WithDetails(map[string]any{"seenEpoch": req.AvailabilityEpoch, "currentEpoch": eligibility.AvailabilityEpoch})
	}

	// Slot rules over and above eligibility.
	if req.Slot == SlotNext {
		currentClaim, claimErr := s.deps.Store.CurrentClaim(ctx, s.deps.Store.Pool(), actor.UserID)
		if claimErr != nil {
			return nil, 0, domain.Errorf(domain.CodeQueueDependencyInvalid,
				"a next-slot bid must depend on your current job")
		}
		if req.DependsOnClaimID == nil || *req.DependsOnClaimID != currentClaim.ID {
			return nil, 0, domain.Errorf(domain.CodeQueueDependencyInvalid,
				"dependsOnClaimId must name your current claim").
				WithDetails(map[string]any{"currentClaimId": currentClaim.ID.String()})
		}
	} else if req.DependsOnClaimID != nil {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed,
			"a current-slot bid cannot depend on a claim")
	}

	// A fast, friendly refusal of an obviously-full cap. The AUTHORITATIVE
	// enforcement is the in-transaction recount below.
	liveBids, err := s.deps.Store.LiveBidCountForDriver(ctx, s.deps.Store.Pool(), actor.UserID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if liveBids >= policy.Bids.MaxLiveBidsPerDriver {
		return nil, 0, domain.Errorf(domain.CodeBidCapReached,
			"you already have %d live bids; withdraw one first", liveBids).
			WithDetails(map[string]any{"liveBids": liveBids, "maximum": policy.Bids.MaxLiveBidsPerDriver})
	}
	if _, err := s.deps.Store.LiveBidForDriverOnRequest(ctx, s.deps.Store.Pool(), request.ID, actor.UserID); err == nil {
		return nil, 0, domain.Errorf(domain.CodeBidNotLive,
			"you already have a live bid on this request; revise or withdraw it")
	} else if !errors.Is(err, domain.ErrNotFound) {
		return nil, 0, asDomainError(err)
	}

	// A03: an advance bid stands for the market's advance offer window
	// (bounded by the request's own expiry), not the immediate market's
	// short bid expiry — and its hold is bounded with it.
	bidExpiresAt := now.Add(time.Duration(policy.Bids.BidExpirySec) * time.Second)
	if req.Slot == SlotAdvance {
		advance, err := policy.AdvanceReservationPolicyFor(request.CityID)
		if err != nil {
			return nil, 0, asDomainError(err)
		}
		bidExpiresAt = now.Add(time.Duration(advance.BidExpirySec) * time.Second)
		if bidExpiresAt.After(request.ExpiresAt) {
			bidExpiresAt = request.ExpiresAt
		}
	}

	commission := CommissionMinor(amountMinor)
	bidID := uuid.New()

	// RESERVE BEFORE LIVE. The reservation is keyed to the bid id, so a retry
	// of this exact submission converges on one hold.
	reserveKey := "mp.reserve:" + bidID.String()
	reserve := ReserveRequest{
		DriverID:      actor.UserID,
		BidID:         bidID,
		RequestID:     request.ID,
		AmountMinor:   money(commission, request.Currency),
		BaseMinor:     money(amountMinor, request.Currency),
		PolicyVersion: policy.PolicyVersion,
		CityID:        request.CityID,
	}
	hold, err := s.deps.Wallet.Reserve(ctx, reserve, reserveKey)
	if err != nil {
		if errors.Is(err, ErrWalletUnknownOutcome) {
			// The reservation may exist server-side. Write down a REPLAY of
			// this exact reserve (same idempotency key): the sweep re-drives
			// it, converges on the real reservation id, and releases THAT id
			// — never the idempotency key string, which the wallet has never
			// heard of as a reservation.
			payload, marshalErr := json.Marshal(ReserveRecoveryPayload{Reserve: reserve, ReserveKey: reserveKey})
			if marshalErr != nil {
				s.deps.Logger.Error().Err(marshalErr).Msg("could not serialise the reserve recovery payload")
			}
			if recErr := s.deps.Store.InsertRecovery(ctx, s.deps.Store.Pool(), RecoveryRow{
				ReservationID: reserveKey,
				DriverID:      actor.UserID,
				BidID:         &bidID,
				Action:        RecoveryReserveReplay,
				Payload:       payload,
				LastError:     err.Error(),
			}); recErr != nil {
				s.deps.Logger.Error().Err(recErr).Msg("could not record unknown-outcome reservation")
			}
			return nil, 0, domain.Errorf(domain.CodeServiceUnavailable,
				"the wallet did not confirm the commission hold; nothing was bid").Wrap(err)
		}
		return nil, 0, asDomainError(err)
	}

	bid := &Bid{
		ID:                 bidID,
		RequestID:          request.ID,
		RequestRevision:    request.Revision,
		DriverID:           actor.UserID,
		State:              machine.MpBidSubmitted,
		BidVersion:         1,
		AmountMinor:        amountMinor,
		CommissionMinor:    commission,
		NetMinor:           amountMinor - commission,
		Slot:               req.Slot,
		DependsOnClaimID:   req.DependsOnClaimID,
		AvailabilityEpoch:  eligibility.AvailabilityEpoch,
		ReservationID:      hold.ReservationID,
		RateProfileVersion: req.RateProfileVersion,
		ExpiresAt:          bidExpiresAt,
	}

	var view *BidView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		// Re-check the request under lock: a revision or close that landed
		// between validation and here must win.
		locked, err := s.deps.Store.RequestForUpdate(ctx, tx, request.ID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpRequestOpen || locked.Revision != request.Revision {
			return domain.Errorf(domain.CodeVersionConflict,
				"the request changed while this bid was in flight; review the new terms")
		}
		// The per-driver cap is enforced HERE, atomically with the insert:
		// this driver's inserts serialise on the advisory lock and the
		// recount inside the transaction is the authority, so N concurrent
		// submissions can never end with more than the cap live.
		if err := s.deps.Store.AcquireCapLock(ctx, tx, advisoryDriverBidCap, actor.UserID); err != nil {
			return err
		}
		liveInTx, err := s.deps.Store.LiveBidCountForDriver(ctx, tx, actor.UserID)
		if err != nil {
			return err
		}
		if liveInTx >= policy.Bids.MaxLiveBidsPerDriver {
			return domain.Errorf(domain.CodeBidCapReached,
				"you already have %d live bids; withdraw one first", liveInTx).
				WithDetails(map[string]any{"liveBids": liveInTx, "maximum": policy.Bids.MaxLiveBidsPerDriver})
		}
		if err := s.deps.Store.InsertBid(ctx, tx, bid); err != nil {
			if errors.Is(err, errBidAlreadyLive) {
				return domain.Errorf(domain.CodeBidNotLive,
					"you already have a live bid on this request; revise or withdraw it")
			}
			return err
		}
		if err := s.deps.Store.InsertBidRevision(ctx, tx, bid.ID, 1, bid.AmountMinor, bid.CommissionMinor, "submitted"); err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.bid.submitted",
			AggregateType:  subjectBid,
			AggregateID:    bid.ID.String(),
			ToVersion:      bid.BidVersion,
			CityID:         request.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "mp.bid.submitted:" + bid.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"bidId":           bid.ID.String(),
				"requestId":       request.ID.String(),
				"requestRevision": bid.RequestRevision,
				"driverId":        actor.UserID.String(),
				"amountMinor":     bid.AmountMinor,
				"commissionMinor": bid.CommissionMinor,
				"slot":            bid.Slot,
				"reservationId":   bid.ReservationID,
				"expiresAt":       bid.ExpiresAt.Format(time.RFC3339),
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.bid.submitted",
			SubjectType: subjectBid,
			SubjectID:   bid.ID.String(),
			After: map[string]any{
				"requestId":       request.ID.String(),
				"amountMinor":     bid.AmountMinor,
				"commissionMinor": bid.CommissionMinor,
				"netMinor":        bid.NetMinor,
				"currency":        request.Currency,
				"reservationId":   bid.ReservationID,
				"slot":            bid.Slot,
			},
			Reason: "driver submitted a funded bid",
		}); err != nil {
			return err
		}
		view = bidViewOf(bid, request.Currency)
		if bid.Slot == SlotAdvance {
			expires := bid.ExpiresAt
			view.AdvanceCommitment = advanceCommitmentOf(request, bid.AmountMinor, &expires, config.CurrencyFractionDigits)
		}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeBidCreate, actor.UserID, idempotencyKey, req, 201, view)
	})
	if err != nil {
		// The bid never became live: give the money back. The release runs
		// under the bid's one release key, and a wallet that cannot confirm
		// it is owed by the sweep.
		s.releaseReservation(ctx, bid)
		return nil, 0, asDomainError(err)
	}
	return view, 201, nil
}

// ReviseBid is the body of POST /v1/mp/bids/{id}/revise. amountMinor is a
// Money object per the contract.
type ReviseBid struct {
	AmountMinor     Money `json:"amountMinor"`
	ExpectedVersion int   `json:"expectedVersion"`
}

// ReviseBid changes a live bid's amount. A raise adjusts the hold FIRST — on
// failure the old bid stands untouched. A lower updates the row first and
// releases the difference after commit, with the sweep backstopping a wallet
// that cannot be reached.
//
// The transaction re-checks EVERYTHING that matters, under lock and in the
// same order SelectWinner locks (request, then bid): the request must still
// be open at the bid's revision, and the bid must be in a driver-revisable
// state — submitted or revised, never selected_pending, whose revised edge
// belongs to the award saga's compensation alone.
func (s *Service) ReviseBid(ctx context.Context, actor Actor, bidID uuid.UUID, req ReviseBid, idempotencyKey string) (*BidView, int, error) {
	if !actor.IsDriver() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only a driver can revise a bid")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeBidRevise, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view BidView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}

	bid, err := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), bidID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that bid does not exist")
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if bid.DriverID != actor.UserID {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that bid does not exist")
	}
	if !isBidRevisable(bid.State) {
		return nil, 0, domain.Errorf(domain.CodeBidNotLive, "this bid cannot be revised right now").
			WithDetails(map[string]any{"state": bid.State})
	}
	if bid.BidVersion != req.ExpectedVersion {
		return nil, 0, domain.Errorf(domain.CodeVersionConflict, "the bid changed while this call was in flight").
			WithDetails(map[string]any{"expectedVersion": req.ExpectedVersion, "currentVersion": bid.BidVersion})
	}

	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), bid.RequestID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	config, policy, err := s.policy(ctx, request.CityID)
	if err != nil {
		return nil, 0, err
	}

	now := s.now()
	// Cooldown applies to revisions only; a withdrawal (the safety exit) is a
	// different endpoint and is never rate limited by this.
	cooldown := time.Duration(policy.Bids.RevisionCooldownSec) * time.Second
	if since := now.Sub(bid.UpdatedAt); since < cooldown {
		retryAfter := int((cooldown - since + time.Second - 1) / time.Second)
		return nil, 0, domain.Errorf(domain.CodeBidRevisionCooldown,
			"you can revise this bid again in %d seconds", retryAfter).
			WithDetails(map[string]any{"retryAfterSec": retryAfter})
	}

	if request.State != machine.MpRequestOpen || !now.Before(request.ExpiresAt) {
		return nil, 0, domain.Errorf(domain.CodeRequestClosed, "this request is no longer taking bids")
	}
	if request.Revision != bid.RequestRevision {
		return nil, 0, domain.Errorf(domain.CodeVersionConflict,
			"the request was revised; this bid is against old terms")
	}
	if err := requireCurrency(req.AmountMinor, request.Currency, "amountMinor"); err != nil {
		return nil, 0, err
	}
	amountMinor := req.AmountMinor.AmountMinor
	if amountMinor < request.MinMinor || amountMinor > request.MaxMinor {
		return nil, 0, fareOutOfBounds(amountMinor, request.MinMinor, request.MaxMinor,
			request.Currency, config.CurrencyFractionDigits)
	}

	newCommission := CommissionMinor(amountMinor)
	raise := newCommission > bid.CommissionMinor

	if raise {
		// Raise: more money has to be held before the bid says so. On
		// failure the old bid — and its old hold — stand untouched.
		if _, err := s.deps.Wallet.Adjust(ctx, bid.ReservationID,
			money(newCommission, request.Currency), money(amountMinor, request.Currency),
			"mp.adjust:"+bid.ID.String()+":"+itoa(bid.BidVersion+1)); err != nil {
			return nil, 0, asDomainError(err)
		}
	}

	var view *BidView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		// Lock the REQUEST first (SelectWinner's lock order) and re-assert it
		// is still open at this bid's revision: a selection or close that
		// committed since the pool reads must win here, not at capture time.
		lockedRequest, err := s.deps.Store.RequestForUpdate(ctx, tx, bid.RequestID)
		if err != nil {
			return err
		}
		if lockedRequest.State != machine.MpRequestOpen || !now.Before(lockedRequest.ExpiresAt) {
			return domain.Errorf(domain.CodeRequestClosed, "this request is no longer taking bids").
				WithDetails(map[string]any{"state": lockedRequest.State})
		}
		if lockedRequest.Revision != bid.RequestRevision {
			return domain.Errorf(domain.CodeVersionConflict,
				"the request was revised; this bid is against old terms")
		}
		locked, err := s.deps.Store.BidForUpdate(ctx, tx, bidID)
		if err != nil {
			return err
		}
		if locked.BidVersion != req.ExpectedVersion || !isBidRevisable(locked.State) {
			return domain.Errorf(domain.CodeVersionConflict, "the bid changed while this call was in flight")
		}
		newVersion := locked.BidVersion + 1
		amount := amountMinor
		net := amount - newCommission
		commission := newCommission
		moved, err := s.deps.Store.TransitionBid(ctx, tx, locked, machine.MpBidRevised, BidUpdate{
			BidVersion:      &newVersion,
			AmountMinor:     &amount,
			CommissionMinor: &commission,
			NetMinor:        &net,
		})
		if err != nil {
			return err
		}
		if err := s.deps.Store.InsertBidRevision(ctx, tx, bid.ID, newVersion, amount, commission, "revised"); err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.bid.revised",
			AggregateType:  subjectBid,
			AggregateID:    bid.ID.String(),
			ToVersion:      newVersion,
			CityID:         request.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "mp.bid.revised:" + bid.ID.String() + ":" + itoa(newVersion),
			OccurredAt:     now,
			Payload: map[string]any{
				"bidId":           bid.ID.String(),
				"requestId":       request.ID.String(),
				"bidVersion":      newVersion,
				"amountMinor":     amount,
				"commissionMinor": commission,
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.bid.revised",
			SubjectType: subjectBid,
			SubjectID:   bid.ID.String(),
			Before:      map[string]any{"amountMinor": bid.AmountMinor, "commissionMinor": bid.CommissionMinor},
			After:       map[string]any{"amountMinor": amount, "commissionMinor": commission},
			Reason:      "driver revised the bid",
		}); err != nil {
			return err
		}
		view = bidViewOf(moved, request.Currency)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeBidRevise, actor.UserID, idempotencyKey, req, 200, view)
	})
	if err != nil {
		if raise {
			s.compensateRaisedHold(ctx, bid, request, amountMinor, newCommission, idempotencyKey)
		}
		return nil, 0, asDomainError(err)
	}

	if !raise && newCommission != bid.CommissionMinor {
		// Lower: the row now says less, so the hold follows it down. A wallet
		// failure here is money held too long, never money lost — the sweep
		// retries until the wallet agrees.
		if _, err := s.deps.Wallet.Adjust(ctx, bid.ReservationID,
			money(newCommission, request.Currency), money(amountMinor, request.Currency),
			"mp.adjust:"+bid.ID.String()+":"+itoa(bid.BidVersion+1)); err != nil {
			target := newCommission
			theBid := bid.ID
			if recErr := s.deps.Store.InsertRecovery(ctx, s.deps.Store.Pool(), RecoveryRow{
				ReservationID: bid.ReservationID,
				DriverID:      bid.DriverID,
				BidID:         &theBid,
				Action:        RecoveryAdjust,
				AmountMinor:   &target,
				LastError:     err.Error(),
			}); recErr != nil {
				s.deps.Logger.Error().Err(recErr).Msg("could not record adjust-down recovery")
			}
		}
	}
	return view, 200, nil
}

// compensateRaisedHold puts a raised hold back after the revise transaction
// failed — UNLESS the bid's committed state shows another, concurrent call
// already committed the very revision this call attempted, in which case the
// raised hold is exactly right and shrinking it would leave a live bid
// under-reserved. The compensating adjust runs under a key unique to THIS
// attempt (the caller's idempotency key), never one a rival attempt shares.
func (s *Service) compensateRaisedHold(ctx context.Context, bid *Bid, request *Request, attemptedAmount, attemptedCommission int64, idempotencyKey string) {
	targetAmount, targetCommission := bid.AmountMinor, bid.CommissionMinor
	if fresh, freshErr := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), bid.ID); freshErr == nil {
		if fresh.AmountMinor == attemptedAmount && fresh.CommissionMinor == attemptedCommission {
			// A concurrent identical revise won: the committed bid carries the
			// raised terms and the raised hold funds it. Nothing to undo.
			return
		}
		// Otherwise the committed row is the truth to restore to (normally
		// the pre-call amounts; under a rival different revise, its amounts).
		targetAmount, targetCommission = fresh.AmountMinor, fresh.CommissionMinor
	}
	if _, adjErr := s.deps.Wallet.Adjust(ctx, bid.ReservationID,
		money(targetCommission, request.Currency), money(targetAmount, request.Currency),
		"mp.adjust.compensate:"+bid.ID.String()+":"+idempotencyKey); adjErr != nil {
		theBid := bid.ID
		target := targetCommission
		if recErr := s.deps.Store.InsertRecovery(ctx, s.deps.Store.Pool(), RecoveryRow{
			ReservationID: bid.ReservationID,
			DriverID:      bid.DriverID,
			BidID:         &theBid,
			Action:        RecoveryAdjust,
			AmountMinor:   &target,
			LastError:     adjErr.Error(),
		}); recErr != nil {
			s.deps.Logger.Error().Err(recErr).Msg("could not record adjust compensation")
		}
	}
}

// Withdraw takes a live bid off the market and releases its hold exactly once.
func (s *Service) Withdraw(ctx context.Context, actor Actor, bidID uuid.UUID, idempotencyKey string) (*BidView, int, error) {
	if !actor.IsDriver() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only a driver can withdraw a bid")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	body := map[string]any{"bidId": bidID.String()}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeBidWithdraw, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view BidView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}

	bid, err := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), bidID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that bid does not exist")
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if bid.DriverID != actor.UserID {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that bid does not exist")
	}
	if !machine.IsMpBidLive(bid.State) {
		return nil, 0, domain.Errorf(domain.CodeBidNotLive, "this bid is no longer live").
			WithDetails(map[string]any{"state": bid.State})
	}

	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), bid.RequestID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}

	now := s.now()
	var view *BidView
	var withdrawn *Bid
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BidForUpdate(ctx, tx, bidID)
		if err != nil {
			return err
		}
		if !machine.IsMpBidLive(locked.State) {
			return domain.Errorf(domain.CodeBidNotLive, "this bid is no longer live")
		}
		moved, err := s.deps.Store.TransitionBid(ctx, tx, locked, machine.MpBidWithdrawn, BidUpdate{})
		if err != nil {
			return err
		}
		withdrawn = moved
		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.bid.withdrawn",
			AggregateType:  subjectBid,
			AggregateID:    bid.ID.String(),
			ToVersion:      moved.BidVersion,
			CityID:         request.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "mp.bid.withdrawn:" + bid.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"bidId":         bid.ID.String(),
				"requestId":     request.ID.String(),
				"driverId":      actor.UserID.String(),
				"reservationId": bid.ReservationID,
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.bid.withdrawn",
			SubjectType: subjectBid,
			SubjectID:   bid.ID.String(),
			Before:      map[string]any{"state": bid.State, "commissionMinor": bid.CommissionMinor},
			After:       map[string]any{"state": moved.State},
			Reason:      "driver withdrew the bid",
		}); err != nil {
			return err
		}
		view = bidViewOf(moved, request.Currency)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeBidWithdraw, actor.UserID, idempotencyKey, body, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}

	// One release, under the bid's one release key. A replay of this endpoint
	// hits the idempotency record above and never reaches here again.
	s.releaseReservation(ctx, withdrawn)
	return view, 200, nil
}

// MyBids answers GET /v1/mp/bids/mine (D06): the driver's bids with each
// hold's state derived from the bid lifecycle AND the wallet's confirmed
// releases — never `released` before the money actually came back.
func (s *Service) MyBids(ctx context.Context, actor Actor) ([]*BidView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a driver has bids")
	}
	bids, err := s.deps.Store.BidsForDriver(ctx, s.deps.Store.Pool(), actor.UserID, 100)
	if err != nil {
		return nil, asDomainError(err)
	}
	requestIDs := make([]uuid.UUID, 0, len(bids))
	seen := map[uuid.UUID]bool{}
	for _, bid := range bids {
		if !seen[bid.RequestID] {
			seen[bid.RequestID] = true
			requestIDs = append(requestIDs, bid.RequestID)
		}
	}
	currencies, err := s.deps.Store.RequestCurrencies(ctx, s.deps.Store.Pool(), requestIDs)
	if err != nil {
		return nil, asDomainError(err)
	}
	views := make([]*BidView, 0, len(bids))
	for _, bid := range bids {
		view := bidViewOf(bid, currencies[bid.RequestID])
		if bid.Slot == SlotAdvance {
			// Restate the advance wallet commitment on the driver's own list.
			if request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), bid.RequestID); err == nil {
				digits := 2
				if config, err := s.config(ctx, request.CityID); err == nil {
					digits = config.CurrencyFractionDigits
				}
				expires := bid.ExpiresAt
				view.AdvanceCommitment = advanceCommitmentOf(request, bid.AmountMinor, &expires, digits)
			}
		}
		views = append(views, view)
	}
	return views, nil
}
