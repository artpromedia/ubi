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

// SubmitBid is the body of POST /v1/mp/bids (MpSubmitBidSchema).
type SubmitBid struct {
	RequestID          uuid.UUID  `json:"requestId"`
	RequestRevision    int        `json:"requestRevision"`
	AmountMinor        int64      `json:"amountMinor"`
	Slot               string     `json:"slot"`
	DependsOnClaimID   *uuid.UUID `json:"dependsOnClaimId,omitempty"`
	AvailabilityEpoch  int64      `json:"availabilityEpoch"`
	RateProfileVersion *int       `json:"rateProfileVersion,omitempty"`
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
//     event, its audit row and its idempotency record;
//  4. if that transaction fails, the reservation is released (compensation),
//     and a release that cannot be confirmed is written down for the sweep.
func (s *Service) CreateBid(ctx context.Context, actor Actor, req SubmitBid, idempotencyKey string) (*BidView, int, error) {
	if !actor.IsDriver() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only a driver can bid")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	if req.Slot != SlotCurrent && req.Slot != SlotNext {
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

	// Bounds are the request's stored ones — the server's numbers.
	if req.AmountMinor < request.MinMinor || req.AmountMinor > request.MaxMinor {
		return nil, 0, fareOutOfBounds(req.AmountMinor, request.MinMinor, request.MaxMinor,
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

	commission := CommissionMinor(req.AmountMinor)
	bidID := uuid.New()

	// RESERVE BEFORE LIVE. The reservation is keyed to the bid id, so a retry
	// of this exact submission converges on one hold.
	hold, err := s.deps.Wallet.Reserve(ctx, ReserveRequest{
		DriverID:      actor.UserID,
		BidID:         bidID,
		RequestID:     request.ID,
		AmountMinor:   commission,
		BaseMinor:     req.AmountMinor,
		PolicyVersion: policy.PolicyVersion,
		CityID:        request.CityID,
	}, "mp.reserve:"+bidID.String())
	if err != nil {
		if errors.Is(err, ErrWalletUnknownOutcome) {
			// The reservation may exist. Write it down so the sweep releases
			// whatever the wallet actually holds under this bid's key.
			if recErr := s.deps.Store.InsertRecovery(ctx, s.deps.Store.Pool(), RecoveryRow{
				ReservationID: "mp.reserve:" + bidID.String(),
				DriverID:      actor.UserID,
				BidID:         &bidID,
				Action:        RecoveryRelease,
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
		AmountMinor:        req.AmountMinor,
		CommissionMinor:    commission,
		NetMinor:           req.AmountMinor - commission,
		Slot:               req.Slot,
		DependsOnClaimID:   req.DependsOnClaimID,
		AvailabilityEpoch:  eligibility.AvailabilityEpoch,
		ReservationID:      hold.ReservationID,
		RateProfileVersion: req.RateProfileVersion,
		ExpiresAt:          now.Add(time.Duration(policy.Bids.BidExpirySec) * time.Second),
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
		view = bidViewOf(bid)
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

// ReviseBid is the body of POST /v1/mp/bids/{id}/revise.
type ReviseBid struct {
	AmountMinor     int64 `json:"amountMinor"`
	ExpectedVersion int   `json:"expectedVersion"`
}

// ReviseBid changes a live bid's amount. A raise adjusts the hold FIRST — on
// failure the old bid stands untouched. A lower updates the row first and
// releases the difference after commit, with the sweep backstopping a wallet
// that cannot be reached.
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
	if !machine.IsMpBidLive(bid.State) {
		return nil, 0, domain.Errorf(domain.CodeBidNotLive, "this bid is no longer live").
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
	if req.AmountMinor < request.MinMinor || req.AmountMinor > request.MaxMinor {
		return nil, 0, fareOutOfBounds(req.AmountMinor, request.MinMinor, request.MaxMinor,
			request.Currency, config.CurrencyFractionDigits)
	}

	newCommission := CommissionMinor(req.AmountMinor)
	raise := newCommission > bid.CommissionMinor

	if raise {
		// Raise: more money has to be held before the bid says so. On
		// failure the old bid — and its old hold — stand untouched.
		if _, err := s.deps.Wallet.Adjust(ctx, bid.ReservationID, newCommission, req.AmountMinor,
			"mp.adjust:"+bid.ID.String()+":"+itoa(bid.BidVersion+1)); err != nil {
			return nil, 0, asDomainError(err)
		}
	}

	var view *BidView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BidForUpdate(ctx, tx, bidID)
		if err != nil {
			return err
		}
		if locked.BidVersion != req.ExpectedVersion || !machine.IsMpBidLive(locked.State) {
			return domain.Errorf(domain.CodeVersionConflict, "the bid changed while this call was in flight")
		}
		newVersion := locked.BidVersion + 1
		amount := req.AmountMinor
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
		view = bidViewOf(moved)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeBidRevise, actor.UserID, idempotencyKey, req, 200, view)
	})
	if err != nil {
		if raise {
			// The raise held extra money for a revision that never happened:
			// put the hold back where the live bid says it is.
			if _, adjErr := s.deps.Wallet.Adjust(ctx, bid.ReservationID, bid.CommissionMinor, bid.AmountMinor,
				"mp.adjust.compensate:"+bid.ID.String()+":"+itoa(bid.BidVersion+1)); adjErr != nil {
				oldCommission := bid.CommissionMinor
				theBid := bid.ID
				if recErr := s.deps.Store.InsertRecovery(ctx, s.deps.Store.Pool(), RecoveryRow{
					ReservationID: bid.ReservationID,
					DriverID:      bid.DriverID,
					BidID:         &theBid,
					Action:        RecoveryAdjust,
					AmountMinor:   &oldCommission,
					LastError:     adjErr.Error(),
				}); recErr != nil {
					s.deps.Logger.Error().Err(recErr).Msg("could not record adjust compensation")
				}
			}
		}
		return nil, 0, asDomainError(err)
	}

	if !raise && newCommission != bid.CommissionMinor {
		// Lower: the row now says less, so the hold follows it down. A wallet
		// failure here is money held too long, never money lost — the sweep
		// retries until the wallet agrees.
		if _, err := s.deps.Wallet.Adjust(ctx, bid.ReservationID, newCommission, req.AmountMinor,
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
		view = bidViewOf(moved)
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
// hold's state derived from the bid lifecycle.
func (s *Service) MyBids(ctx context.Context, actor Actor) ([]*BidView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a driver has bids")
	}
	bids, err := s.deps.Store.BidsForDriver(ctx, s.deps.Store.Pool(), actor.UserID, 100)
	if err != nil {
		return nil, asDomainError(err)
	}
	views := make([]*BidView, 0, len(bids))
	for _, bid := range bids {
		views = append(views, bidViewOf(bid))
	}
	return views, nil
}
