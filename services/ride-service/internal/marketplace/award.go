package marketplace

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// PickupWindowConsent is the finishing-trip consent inside a selection: the
// requester saw a window at this etaVersion and accepted it.
type PickupWindowConsent struct {
	EtaVersion int  `json:"etaVersion"`
	Accepted   bool `json:"accepted"`
}

// SelectWinnerRequest is the body of POST /v1/mp/requests/{id}/select.
type SelectWinnerRequest struct {
	BidID               uuid.UUID            `json:"bidId"`
	RequestVersion      int                  `json:"requestVersion"`
	BidVersion          int                  `json:"bidVersion"`
	PickupWindowConsent *PickupWindowConsent `json:"pickupWindowConsent,omitempty"`
}

// SelectResult answers a selection: the award to converge on, and — when this
// very call carried the saga through to a confirmed current-slot execution —
// the pickup PIN, returned ONCE to the owner and deliberately absent from the
// stored idempotent replay (the PIN is hashed at rest, exactly as CreateRide's).
type SelectResult struct {
	Award     *AwardView `json:"award"`
	PickupPin string     `json:"pickupPin,omitempty"`
	// Booking is the advance booking an advance selection created (A03):
	// driver reserved, and whether the rider's funding is secured yet.
	Booking *AdvanceBookingView `json:"booking,omitempty"`
}

// attemptRetryDelay is the base reconciliation delay for a stalled saga step.
// Plumbing, not policy: it only decides how soon the sweep asks again.
const attemptRetryDelay = 30 * time.Second

// errExecutionBlocked marks a finalize that definitely cannot complete —
// driver no longer available, a capacity index refusing the row — and must be
// compensated rather than retried forever.
var errExecutionBlocked = errors.New("the execution cannot be created")

// SelectWinner runs the award saga (M05): pin versions, claim the request and
// the driver's capacity atomically, authorize rider funding, capture the
// winning commission exactly once under the award id, commit the execution and
// resolve the losers. No SQL transaction is ever held open across a wallet or
// funding call.
func (s *Service) SelectWinner(ctx context.Context, actor Actor, requestID uuid.UUID, req SelectWinnerRequest, idempotencyKey string) (*SelectResult, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only the requester can select a winner")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeSelect, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var result SelectResult
		if err := decodeJSON(replay.Response, &result); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &result, replay.StatusCode, nil
	}

	// The bid is read BEFORE the request: the later request snapshot is then
	// at least as new as the bid's, so a bid a revision invalidated always
	// meets the revision that invalidated it and answers the refreshed terms
	// below — never a bare bid_not_live that hides the route/fare change.
	bid, bidErr := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), req.BidID)

	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if request.RequesterID != actor.UserID {
		// "not found" rather than "forbidden": a request id must not probe
		// another requester's market.
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err := s.requireServiceFlag(ctx, request.Service, actor, request.CityID); err != nil {
		return nil, 0, err
	}

	if errors.Is(bidErr, domain.ErrNotFound) || (bidErr == nil && bid.RequestID != request.ID) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that offer does not exist on this request")
	}
	if bidErr != nil {
		return nil, 0, asDomainError(bidErr)
	}

	now := s.now()
	switch {
	case request.State == machine.MpRequestAwardPending:
		return nil, 0, s.awardUnresolvedError(ctx, request)
	case request.State != machine.MpRequestOpen || !now.Before(request.ExpiresAt):
		return nil, 0, domain.Errorf(domain.CodeRequestClosed, "this request is no longer open for selection").
			WithDetails(map[string]any{"state": request.State})
	}
	// Revision pinning: a bid is of the terms — fare AND route — of the
	// revision it was placed on. One placed before a fare or route edit can
	// never win, whatever state the invalidation left it in: the refreshed
	// terms (including the current route) come back for re-confirmation.
	if bid.RequestRevision != request.Revision {
		return nil, 0, domain.Errorf(domain.CodeVersionConflict,
			"this offer was made on an earlier version of the request; review the refreshed terms").
			WithDetails(refreshedTerms(request, bid))
	}
	if !machine.IsMpBidLive(bid.State) {
		return nil, 0, domain.Errorf(domain.CodeBidNotLive, "this offer is no longer live").
			WithDetails(map[string]any{"state": bid.State})
	}
	// Version pinning: a selection is of exact terms, never of whatever the
	// rows say by the time it lands. Staleness answers the refreshed terms.
	if request.Version != req.RequestVersion || bid.BidVersion != req.BidVersion {
		return nil, 0, domain.Errorf(domain.CodeVersionConflict,
			"the terms changed after you reviewed them; confirm the refreshed terms").
			WithDetails(refreshedTerms(request, bid))
	}

	_, policy, err := s.policy(ctx, request.CityID)
	if err != nil {
		return nil, 0, err
	}

	// A06 part C: a request booked on an organization is funded by its
	// budget. The organization's verdict at the offer's amount is read
	// BEFORE any award starts, so a refusal (policy, membership, no budget)
	// answers now with its reason and nothing is promised; the reservation
	// in the saga's funding step re-decides atomically.
	biz, err := s.requestBusiness(ctx, s.deps.Store.Pool(), request.ID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if biz != nil {
		if err := s.preCheckBusinessSelection(ctx, request, biz, bid); err != nil {
			return nil, 0, err
		}
	}

	// Finishing-trip winners require explicit consent to the CURRENT window,
	// recomputed here from the driver's actual position — never the window the
	// offer card showed an unknown time ago. All routing happens before any
	// transaction opens.
	var window *AwardWindow
	if bid.Slot == SlotNext {
		currentClaim, claimErr := s.deps.Store.CurrentClaim(ctx, s.deps.Store.Pool(), bid.DriverID)
		if claimErr != nil || bid.DependsOnClaimID == nil || currentClaim.ID != *bid.DependsOnClaimID {
			return nil, 0, domain.Errorf(domain.CodeQueueDependencyInvalid,
				"the driver's current job changed; this queued offer no longer lines up")
		}
		window, err = s.computeQueueWindow(ctx, bid.DriverID, request.Pickup, policy)
		if err != nil {
			return nil, 0, domain.Errorf(domain.CodeSlotUnavailable,
				"the pickup window cannot be verified right now; try again shortly").Wrap(err)
		}
		if req.PickupWindowConsent == nil || !req.PickupWindowConsent.Accepted ||
			req.PickupWindowConsent.EtaVersion != window.EtaVersion {
			// The window moved (or was never consented). No award is started:
			// the refreshed window comes back for reconfirmation.
			return nil, 0, domain.Errorf(domain.CodeVersionConflict,
				"confirm the current pickup window to select this offer").
				WithDetails(map[string]any{
					"field": "pickupWindowConsent",
					"pickupWindow": map[string]any{
						"earliestSec": window.EarliestSec,
						"latestSec":   window.LatestSec,
						"etaVersion":  window.EtaVersion,
					},
				})
		}
		window.ConsentedLatestSec = window.LatestSec
	}

	// A03: an ADVANCE selection books the driver's calendar instead of a
	// live slot. The calendar is checked (overlap of the buffered interval,
	// routed travel to/from the neighbouring bookings) before any
	// transaction opens, and re-checked under the driver's calendar lock
	// inside it, with the exclusion constraints as the final authority.
	var plan *bookingPlan
	var advancePolicy *cityconfig.AdvanceReservationPolicy
	if bid.Slot == SlotAdvance {
		if !request.isAdvance() {
			return nil, 0, domain.Errorf(domain.CodeConflict, "this offer is not for an advance booking")
		}
		if advancePolicy, err = policy.AdvanceReservationPolicyFor(request.CityID); err != nil {
			return nil, 0, asDomainError(err)
		}
		blocked, blockErr := s.driverBlocked(ctx, bid.DriverID)
		if blockErr != nil {
			return nil, 0, asDomainError(blockErr)
		}
		if blocked {
			return nil, 0, domain.Errorf(domain.CodeSlotUnavailable, "this driver can no longer take marketplace work").
				WithDetails(map[string]any{"reason": ReasonAccountNotEligible})
		}
		if plan, err = s.planBooking(ctx, bid.DriverID, request, advancePolicy); err != nil {
			if mapped, ok := domain.AsError(err); ok {
				return nil, 0, mapped
			}
			return nil, 0, domain.Errorf(domain.CodeSlotUnavailable,
				"the driver's calendar cannot be verified right now; try again shortly").Wrap(err)
		}
	}

	award := &Award{
		ID:              uuid.New(),
		RequestID:       request.ID,
		BidID:           bid.ID,
		DriverID:        bid.DriverID,
		RequesterID:     request.RequesterID,
		State:           machine.MpAwardPending,
		RequestVersion:  req.RequestVersion,
		BidVersion:      req.BidVersion,
		FareMinor:       bid.AmountMinor,
		CommissionMinor: bid.CommissionMinor,
		Slot:            bid.Slot,
		PickupWindow:    window,
	}
	claim := &Claim{
		ID:               uuid.New(),
		DriverID:         bid.DriverID,
		State:            machine.MpClaimAwardPending,
		Slot:             bid.Slot,
		Service:          request.Service,
		AwardID:          &award.ID,
		DependsOnClaimID: bid.DependsOnClaimID,
	}
	var booking *AdvanceBooking
	if plan != nil {
		// No live claim: the booking holds the calendar instead.
		claim = nil
		booking = newBooking(award, request, plan, advancePolicy, now)
	}

	// Transaction 1: claim the request and the driver's capacity atomically.
	// The partial unique indexes — one live award per request, one current and
	// one next claim per driver — are the final authority on both races.
	//
	// awardUnresolvedError reads the pool, and a pool read while holding this
	// transaction's connection is the deadlock the pool-deadlock rule forbids
	// — so the closure only RAISES a flag and the read happens after rollback.
	var pendingView *SelectResult
	var racedAwardPending bool
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.RequestForUpdate(ctx, tx, request.ID)
		if err != nil {
			return err
		}
		switch {
		case locked.State == machine.MpRequestAwardPending:
			racedAwardPending = true
			return domain.Errorf(domain.CodeAwardUnresolved,
				"a selection is already being resolved for this request")
		case locked.State != machine.MpRequestOpen:
			return domain.Errorf(domain.CodeRequestClosed, "this request is no longer open for selection").
				WithDetails(map[string]any{"state": locked.State})
		case locked.Version != req.RequestVersion:
			return domain.Errorf(domain.CodeVersionConflict,
				"the terms changed after you reviewed them; confirm the refreshed terms").
				WithDetails(refreshedTerms(locked, bid))
		}
		lockedBid, err := s.deps.Store.BidForUpdate(ctx, tx, bid.ID)
		if err != nil {
			return err
		}
		if !machine.IsMpBidLive(lockedBid.State) || lockedBid.BidVersion != req.BidVersion ||
			lockedBid.RequestRevision != locked.Revision {
			return domain.Errorf(domain.CodeVersionConflict,
				"the offer changed after you reviewed it; confirm the refreshed terms").
				WithDetails(refreshedTerms(locked, lockedBid))
		}

		fromVersion := locked.Version
		moved, err := s.deps.Store.TransitionRequest(ctx, tx, locked, machine.MpRequestAwardPending, RequestUpdate{})
		if err != nil {
			return err
		}
		// The selection BUMPS bid_version: any concurrent ReviseBid that
		// pinned the pre-selection version now fails its optimistic guard,
		// so the terms the award pinned can never be mutated mid-saga.
		selectedVersion := lockedBid.BidVersion + 1
		if _, err := s.deps.Store.TransitionBid(ctx, tx, lockedBid, machine.MpBidSelectedPending, BidUpdate{
			BidVersion: &selectedVersion,
		}); err != nil {
			return err
		}
		if err := s.deps.Store.InsertAward(ctx, tx, award); err != nil {
			if errors.Is(err, errAwardAlreadyLive) {
				return domain.Errorf(domain.CodeAwardUnresolved,
					"another selection is already being resolved for this request")
			}
			return err
		}
		if biz != nil {
			// The budget reservation is owed from this commit on, keyed by
			// the award: the saga's funding step reserves it INSTEAD OF the
			// rider's funding, and a crash resumes it from this row.
			if err := s.deps.Store.InsertBusinessBooking(ctx, tx, newBusinessBooking(award, locked, biz)); err != nil {
				return err
			}
		}
		if booking != nil {
			if err := s.lockCalendar(ctx, tx, bid.DriverID, plan); err != nil {
				return err
			}
			if err := s.deps.Store.InsertBooking(ctx, tx, booking); err != nil {
				if errors.Is(err, errCalendarConflict) {
					return calendarConflict("the driver's calendar took an overlapping booking while this selection was in flight", nil)
				}
				return err
			}
		} else if err := s.deps.Store.InsertClaim(ctx, tx, claim); err != nil {
			if errors.Is(err, errSlotOccupied) {
				return domain.Errorf(domain.CodeSlotUnavailable,
					"the driver's capacity was taken while this selection was in flight")
			}
			return err
		}
		retryAt := now.Add(attemptRetryDelay)
		if err := s.deps.Store.SaveAttempt(ctx, tx, award.ID, AttemptStepFunding, AttemptStatePending, "", &retryAt); err != nil {
			return err
		}

		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.award.pending",
			AggregateType:  subjectAward,
			AggregateID:    award.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         request.CityID,
			ActorType:      "rider",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "mp.award.pending:" + award.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"awardId":         award.ID.String(),
				"requestId":       request.ID.String(),
				"bidId":           bid.ID.String(),
				"driverId":        bid.DriverID.String(),
				"fareMinor":       award.FareMinor,
				"commissionMinor": award.CommissionMinor,
				"slot":            award.Slot,
			},
		}); err != nil {
			return err
		}
		if booking != nil {
			if err := s.writeBookingEvent(ctx, tx, booking, "mp.advance_booking.held", "rider", actor.UserID.String(), now,
				map[string]any{
					"fareMinor": award.FareMinor, "commissionMinor": award.CommissionMinor, "currency": request.Currency,
					"occupiedStart": booking.OccupiedStart.Format(time.RFC3339),
					"occupiedEnd":   booking.OccupiedEnd.Format(time.RFC3339),
					"driverSecured": false,
				}); err != nil {
				return err
			}
		} else if err := writeEvent(ctx, tx, Event{
			Name:           "mp.claim.created",
			AggregateType:  subjectClaim,
			AggregateID:    claim.ID.String(),
			ToVersion:      1,
			CityID:         request.CityID,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "mp.claim.created:" + claim.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"claimId":      claim.ID.String(),
				"awardId":      award.ID.String(),
				"driverId":     claim.DriverID.String(),
				"slot":         claim.Slot,
				"fencingToken": claim.FencingToken,
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.award.pending",
			SubjectType: subjectAward,
			SubjectID:   award.ID.String(),
			After: map[string]any{
				"requestId":       request.ID.String(),
				"bidId":           bid.ID.String(),
				"driverId":        bid.DriverID.String(),
				"fareMinor":       award.FareMinor,
				"commissionMinor": award.CommissionMinor,
				"currency":        request.Currency,
				"slot":            award.Slot,
			},
			Reason: "requester selected the winning offer",
		}); err != nil {
			return err
		}
		pendingView = &SelectResult{Award: awardViewOf(award, request.Currency)}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeSelect, actor.UserID, idempotencyKey, req, 202, pendingView)
	})
	if err != nil {
		if racedAwardPending {
			// Now that the transaction's connection is back in the pool, the
			// detailed answer (naming the unresolved award) is safe to read.
			return nil, 0, s.awardUnresolvedError(ctx, request)
		}
		return nil, 0, asDomainError(err)
	}

	// The saga's tail: funding, capture and finalize, each idempotent under
	// the award id. Any unknown outcome parks the award in pending for the
	// reconciliation sweep — it NEVER reopens the request while a debit may
	// still commit.
	resolved, pin, advErr := s.advanceAward(ctx, award.ID)
	if advErr != nil {
		s.deps.Logger.Warn().Err(advErr).Str("award_id", award.ID.String()).
			Msg("award saga paused; the reconciliation sweep will resume it")
	}
	result := pendingView
	if resolved != nil {
		result = &SelectResult{Award: awardViewOf(resolved, request.Currency), PickupPin: pin}
	}
	if booking != nil {
		// The advance booking as it stands after the saga's synchronous
		// push: driver reserved (or still confirming), and whether the
		// rider's funding is secured yet.
		if current, err := s.deps.Store.BookingByID(ctx, s.deps.Store.Pool(), booking.ID); err == nil {
			withBooking := *result
			withBooking.Booking = s.withBookingReminders(ctx,
				s.withVerifiedDriver(ctx, bookingViewOf(current, request, request.VehicleClass, viewerRider), current, request.VehicleClass),
				current.CityID)
			result = &withBooking
		}
	}
	return result, 202, nil
}

// awardUnresolvedError phrases the "a selection is already in flight" answer,
// naming the unresolved award when it can be read.
func (s *Service) awardUnresolvedError(ctx context.Context, request *Request) *domain.Error {
	details := map[string]any{"requestId": request.ID.String()}
	if award, err := s.deps.Store.LatestAwardForRequest(ctx, s.deps.Store.Pool(), request.ID); err == nil {
		details["awardId"] = award.ID.String()
		details["awardState"] = award.State
	}
	return domain.Errorf(domain.CodeAwardUnresolved,
		"a selection is already being resolved for this request").WithDetails(details)
}

// refreshedTerms is the version_conflict payload: the CURRENT terms, so the
// client can re-render and re-confirm instead of guessing.
func refreshedTerms(request *Request, bid *Bid) map[string]any {
	bidTerms := map[string]any{
		"bidId":       bid.ID.String(),
		"bidVersion":  bid.BidVersion,
		"amountMinor": bid.AmountMinor,
		"slot":        bid.Slot,
		"state":       bid.State,
	}
	if bid.RequestRevision != request.Revision || request.hasRoute() {
		// Which revision (fare + route) the offer was made on.
		bidTerms["requestRevision"] = bid.RequestRevision
	}
	terms := map[string]any{
		"requestVersion":     request.Version,
		"requestRevision":    request.Revision,
		"requestedFareMinor": request.RequestedMinor,
		"requestState":       request.State,
		"bid":                bidTerms,
	}
	if request.hasRoute() {
		// The route the request stands on NOW, so the requester re-confirms
		// against the current stops rather than the ones the offer saw.
		terms["routeRevision"] = request.RouteRevision
		terms["routeFingerprint"] = request.RouteFingerprint
		terms["stopCount"] = len(request.Stops)
	}
	return terms
}

// AwardForRequest answers GET /v1/mp/requests/{id}/award for convergence
// polling: the owner or the winning driver, nobody else.
func (s *Service) AwardForRequest(ctx context.Context, actor Actor, requestID uuid.UUID) (*AwardView, error) {
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	award, err := s.deps.Store.LatestAwardForRequest(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeNotFound, "this request has no award")
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	if request.RequesterID != actor.UserID && award.DriverID != actor.UserID {
		return nil, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	return awardViewOf(award, request.Currency), nil
}

// ---------------------------------------------------------------------------
// The saga tail: funding → capture → finalize, driven by the durable step
// ledger in mp.award_attempts. Synchronous selection and the reconciliation
// sweep both call this one function, so a crash resumes instead of forgetting.
// ---------------------------------------------------------------------------

// advanceAward pushes one pending award as far as it can go. It returns the
// award's latest state and, when this call created a current-slot execution,
// the pickup PIN for one-time delivery to the owner.
func (s *Service) advanceAward(ctx context.Context, awardID uuid.UUID) (*Award, string, error) {
	pin := ""
	for {
		award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), awardID)
		if err != nil {
			return nil, pin, asDomainError(err)
		}
		if award.State != machine.MpAwardPending {
			return award, pin, nil
		}
		attempt, err := s.deps.Store.AttemptFor(ctx, s.deps.Store.Pool(), awardID)
		if err != nil {
			return award, pin, asDomainError(err)
		}

		switch attempt.Step {
		case AttemptStepFunding:
			if done, err := s.runFundingStep(ctx, award, attempt); err != nil || !done {
				return s.reloadAward(ctx, awardID, pin, err)
			}
		case AttemptStepCapture:
			if done, err := s.runCaptureStep(ctx, award, attempt); err != nil || !done {
				return s.reloadAward(ctx, awardID, pin, err)
			}
		case AttemptStepHandoff:
			// A delivery award: the captured award is handed to
			// delivery-service before anything is confirmed.
			if done, err := s.runHandoffStep(ctx, award, attempt); err != nil || !done {
				return s.reloadAward(ctx, awardID, pin, err)
			}
		case AttemptStepFinalize:
			createdPin, done, err := s.runFinalizeStep(ctx, award, attempt)
			if createdPin != "" {
				pin = createdPin
			}
			if err != nil || !done {
				return s.reloadAward(ctx, awardID, pin, err)
			}
			// finalize either confirmed or compensated; the loop reloads and
			// returns the terminal state.
		case AttemptStepCompensate:
			// The COMPENSATION DECISION is durable: an award that got here is
			// only ever resumed INTO the compensation path — never forward
			// into finalize, whatever the original blocker did since.
			reason := attempt.LastError
			if reason == "" {
				reason = "compensation_resumed"
			}
			s.compensateAward(ctx, award.ID, reason, attempt.Captured)
			return s.reloadAward(ctx, awardID, pin, nil)
		default:
			return award, pin, fmt.Errorf("award %s has an unknown saga step %q", awardID, attempt.Step)
		}
	}
}

// reloadAward reads the award's latest state for the caller's answer.
func (s *Service) reloadAward(ctx context.Context, awardID uuid.UUID, pin string, cause error) (*Award, string, error) {
	award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), awardID)
	if err != nil {
		return nil, pin, asDomainError(err)
	}
	return award, pin, cause
}

// stepBackoff grows the retry delay with the attempt count, capped.
func stepBackoff(attempts int) time.Duration {
	backoff := time.Duration(attempts+1) * attemptRetryDelay
	if backoff > 10*time.Minute {
		backoff = 10 * time.Minute
	}
	return backoff
}

// runFundingStep authorizes the rider's funding for the SELECTED amount. Cash
// is validated against city config; anything else goes through the funding
// port with the award id as its idempotency key.
func (s *Service) runFundingStep(ctx context.Context, award *Award, attempt *AwardAttempt) (bool, error) {
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), award.RequestID)
	if err != nil {
		return false, asDomainError(err)
	}
	// A06 part C: a business award reserves the organization's budget
	// INSTEAD OF authorizing the rider's funding — never both.
	if business, err := s.deps.Store.BusinessBookingByAward(ctx, s.deps.Store.Pool(), award.ID); err == nil {
		return s.runBusinessFundingStep(ctx, award, attempt, business)
	} else if !errors.Is(err, domain.ErrNotFound) {
		return false, asDomainError(err)
	}
	now := s.now()

	// A03: an ADVANCE award secures rider funding with the same wallet
	// authorization, but only once the pickup is within the market's funding
	// horizon. Beyond it nothing is authorized now: the booking is
	// payment_pending (driver reserved, rider funding not yet secured) and
	// the booking worker authorizes under this very award key when the pickup
	// enters the horizon — so no hold outlives the bounded horizon.
	var booking *AdvanceBooking
	deferFunding := false
	if award.Slot == SlotAdvance {
		if booking, err = s.deps.Store.BookingByAwardID(ctx, s.deps.Store.Pool(), award.ID); err != nil {
			return false, asDomainError(err)
		}
		deferFunding = request.PaymentMethodID != "cash" && now.Before(booking.FundingDueAt)
	}

	var fundErr error
	fundingState := BookingFundingSecured
	switch {
	case deferFunding:
		fundingState = BookingFundingPending
	case request.PaymentMethodID == "cash":
		fundingState = BookingFundingUnsecuredCash
		config, cfgErr := s.config(ctx, request.CityID)
		if cfgErr != nil {
			fundErr = fmt.Errorf("%w: %v", ErrWalletUnknownOutcome, cfgErr)
		} else if available, reason := config.PaymentMethodAvailable("cash"); !available {
			fundErr = domain.Errorf(domain.CodePaymentMethodUnavailable,
				"cash cannot fund this request any more").
				WithDetails(map[string]any{"reason": reason})
		}
	default:
		auth, authErr := s.deps.Funding.Authorize(ctx, FundingRequest{
			RequesterID:     award.RequesterID,
			RequestID:       award.RequestID,
			AwardID:         award.ID,
			PaymentMethodID: request.PaymentMethodID,
			AmountMinor:     award.FareMinor,
			Currency:        request.Currency,
			CityID:          request.CityID,
		}, "mp.fund:"+award.ID.String())
		fundErr = authErr
		if authErr == nil && auth != nil && !auth.Secured {
			fundingState = BookingFundingUnsecuredCash
		}
		if authErr == nil && auth != nil {
			// The award row has no natural column for the funding security,
			// so the fact is logged (C02): `secured=true` means a durable
			// reservation now encumbers the fare until settlement consumes it
			// or compensation releases it; `secured=false` is explicitly
			// unsecured collection (cash never reaches this branch today).
			reservationID := ""
			if auth.ReservationID != nil {
				reservationID = *auth.ReservationID
			}
			s.deps.Logger.Info().
				Str("award_id", award.ID.String()).
				Bool("secured", auth.Secured).
				Str("reservation_id", reservationID).
				Msg("rider funding authorized")
		}
	}

	if fundErr != nil {
		if mapped, ok := domain.AsError(fundErr); ok && !errors.Is(fundErr, ErrWalletUnknownOutcome) {
			// A definite refusal: nothing was captured, compensate now.
			s.compensateAward(ctx, award.ID, "funding_refused: "+string(mapped.Code), false)
			return false, nil
		}
		// Unknown outcome: stay pending, let the sweep ask again.
		retryAt := now.Add(stepBackoff(attempt.Attempts))
		if saveErr := s.deps.Store.SaveAttempt(ctx, s.deps.Store.Pool(), award.ID,
			AttemptStepFunding, AttemptStateUnknown, fundErr.Error(), &retryAt); saveErr != nil {
			s.deps.Logger.Error().Err(saveErr).Msg("could not park the funding step")
		}
		return false, fundErr
	}

	if booking != nil {
		// Recorded before the step advances: finalize reads it to decide
		// confirmed (secured / cash explicitly unsecured) vs payment_pending.
		if err := s.deps.Store.SetBookingFundingState(ctx, s.deps.Store.Pool(), booking.ID, fundingState); err != nil {
			return false, err
		}
	}
	retryAt := now.Add(attemptRetryDelay)
	if err := s.deps.Store.SaveAttempt(ctx, s.deps.Store.Pool(), award.ID,
		AttemptStepCapture, AttemptStatePending, "", &retryAt); err != nil {
		return false, err
	}
	return true, nil
}

// runCaptureStep captures the winning commission hold exactly once, keyed by
// the award id. An unknown outcome parks the award in pending — the sweeper
// re-polls this same call until the wallet gives a definite answer, because a
// timeout-reopen while the debit may still commit would move money twice.
func (s *Service) runCaptureStep(ctx context.Context, award *Award, attempt *AwardAttempt) (bool, error) {
	bid, err := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), award.BidID)
	if err != nil {
		return false, asDomainError(err)
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), award.RequestID)
	if err != nil {
		return false, asDomainError(err)
	}
	now := s.now()

	// The capture carries the award's PINNED commission as the expected
	// amount: a hold whose current amount differs (a revise raced the
	// selection) is refused with a definite conflict and compensated —
	// the wallet never debits terms that were not awarded.
	result, capErr := s.deps.Wallet.Capture(ctx, bid.ReservationID, award.ID.String(),
		money(award.CommissionMinor, request.Currency), "mp.capture:"+award.ID.String())
	if capErr != nil {
		if errors.Is(capErr, ErrWalletUnknownOutcome) {
			retryAt := now.Add(stepBackoff(attempt.Attempts))
			if saveErr := s.deps.Store.SaveAttempt(ctx, s.deps.Store.Pool(), award.ID,
				AttemptStepCapture, AttemptStateUnknown, capErr.Error(), &retryAt); saveErr != nil {
				s.deps.Logger.Error().Err(saveErr).Msg("could not park the capture step")
			}
			return false, capErr
		}
		if _, ok := domain.AsError(capErr); ok {
			// The wallet said a definite no: nothing was debited.
			s.compensateAward(ctx, award.ID, "capture_refused", false)
			return false, nil
		}
		retryAt := now.Add(stepBackoff(attempt.Attempts))
		if saveErr := s.deps.Store.SaveAttempt(ctx, s.deps.Store.Pool(), award.ID,
			AttemptStepCapture, AttemptStatePending, capErr.Error(), &retryAt); saveErr != nil {
			s.deps.Logger.Error().Err(saveErr).Msg("could not defer the capture step")
		}
		return false, capErr
	}

	if err := s.deps.Store.SetAwardCaptureReceipt(ctx, s.deps.Store.Pool(), award.ID, result.ReceiptID); err != nil {
		// The receipt is re-fetchable by replaying the idempotent capture; do
		// not fail the saga over a bookkeeping write.
		s.deps.Logger.Error().Err(err).Msg("could not record the capture receipt")
	}
	// A delivery award is handed to delivery-service next; a ride finalizes
	// into its execution ride. Either way the capture above was the ONE
	// commission debit — no later step touches the wallet.
	next := AttemptStepFinalize
	if handsOffDelivery(request, award) {
		next = AttemptStepHandoff
	}
	retryAt := now.Add(attemptRetryDelay)
	if err := s.deps.Store.SaveAttempt(ctx, s.deps.Store.Pool(), award.ID,
		next, AttemptStatePending, "", &retryAt); err != nil {
		return false, err
	}
	return true, nil
}

// handsOffDelivery reports whether an award executes as a delivery-service
// delivery: a live-slot (current or next) award on a service=delivery
// request. Advance bookings are rides only.
func handsOffDelivery(request *Request, award *Award) bool {
	return request.Service == ServiceDelivery && award.Slot != SlotAdvance
}

// runFinalizeStep commits transaction 2. A definite blocker (driver gone, a
// capacity index refusing the execution) compensates — including reversing the
// already-captured fee; a transient failure is retried.
func (s *Service) runFinalizeStep(ctx context.Context, award *Award, attempt *AwardAttempt) (string, bool, error) {
	// A delivery award finalizes only onto a delivery delivery-service
	// confirmed. One that reached this step without it (a saga already past
	// capture when the hand-off step shipped) is rewound to the hand-off —
	// never finalized into an execution ride.
	delivery := false
	if request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), award.RequestID); err == nil && handsOffDelivery(request, award) {
		delivery = true
		handoff, handoffErr := s.deps.Store.HandoffByAward(ctx, s.deps.Store.Pool(), award.ID)
		if handoffErr != nil && !errors.Is(handoffErr, domain.ErrNotFound) {
			return "", false, handoffErr
		}
		if handoff == nil || handoff.State != HandoffDelivered || handoff.DeliveryID == nil {
			retryAt := s.now().Add(attemptRetryDelay)
			if err := s.deps.Store.SaveAttempt(ctx, s.deps.Store.Pool(), award.ID,
				AttemptStepHandoff, AttemptStatePending, "", &retryAt); err != nil {
				return "", false, err
			}
			return "", true, nil
		}
	}
	pin, err := s.finalizeAward(ctx, award.ID)
	if err == nil {
		return pin, true, nil
	}
	if errors.Is(err, errExecutionBlocked) && !delivery {
		s.compensateAward(ctx, award.ID, "execution_blocked", true)
		return "", true, nil
	}
	if delivery {
		// The delivery already exists in delivery-service, assigned to this
		// driver: compensating here would strand it. A finalize that cannot
		// commit is an alarm for ops and is retried, never unwound.
		s.deps.Logger.Error().Err(err).Str("award_id", award.ID.String()).
			Msg("ALARM: a handed-off delivery award could not be finalized; retrying, never compensating")
	}
	retryAt := s.now().Add(stepBackoff(attempt.Attempts))
	if saveErr := s.deps.Store.SaveAttempt(ctx, s.deps.Store.Pool(), award.ID,
		AttemptStepFinalize, AttemptStatePending, err.Error(), &retryAt); saveErr != nil {
		s.deps.Logger.Error().Err(saveErr).Msg("could not defer the finalize step")
	}
	return "", false, err
}

// finalizeAward is transaction 2: award confirmed, bid won, request awarded
// (and into execution for a current slot, with the execution ride created in
// this same transaction), claim into its slot, losers lost and the winner's
// clashing bids invalidated. Hold releases happen after commit, backstopped by
// the recovery sweep.
func (s *Service) finalizeAward(ctx context.Context, awardID uuid.UUID) (string, error) {
	// Everything a transaction must not fetch from the pool mid-flight is
	// read first (pool-deadlock rule).
	award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), awardID)
	if err != nil {
		return "", asDomainError(err)
	}
	if award.State != machine.MpAwardPending {
		return "", nil
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), award.RequestID)
	if err != nil {
		return "", asDomainError(err)
	}
	config, err := s.config(ctx, request.CityID)
	if err != nil {
		return "", err
	}
	advance := award.Slot == SlotAdvance
	// A delivery award executes as the delivery delivery-service created for
	// it (runFinalizeStep guarantees the hand-off answered 201/200).
	var deliveryID *uuid.UUID
	if handsOffDelivery(request, award) {
		handoff, err := s.deps.Store.HandoffByAward(ctx, s.deps.Store.Pool(), award.ID)
		if err != nil {
			return "", asDomainError(err)
		}
		if handoff.State != HandoffDelivered || handoff.DeliveryID == nil {
			return "", fmt.Errorf("award %s has no confirmed delivery hand-off", award.ID)
		}
		deliveryID = handoff.DeliveryID
	}
	var booking *AdvanceBooking
	var advancePolicy *cityconfig.AdvanceReservationPolicy
	if advance {
		if booking, err = s.deps.Store.BookingByAwardID(ctx, s.deps.Store.Pool(), award.ID); err != nil {
			return "", asDomainError(err)
		}
		policy, policyErr := config.MarketplacePolicyFor()
		if policyErr != nil {
			return "", asDomainError(policyErr)
		}
		if advancePolicy, err = policy.AdvanceReservationPolicyFor(request.CityID); err != nil {
			return "", asDomainError(err)
		}
	}

	pin := ""
	var releases []*Bid
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.AwardForUpdate(ctx, tx, awardID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpAwardPending {
			return nil
		}
		lockedRequest, err := s.deps.Store.RequestForUpdate(ctx, tx, award.RequestID)
		if err != nil {
			return err
		}
		lockedBid, err := s.deps.Store.BidForUpdate(ctx, tx, award.BidID)
		if err != nil {
			return err
		}
		var claim *Claim
		if !advance {
			if claim, err = s.deps.Store.ClaimByAwardID(ctx, tx, awardID); err != nil {
				return err
			}
			if claim, err = s.deps.Store.ClaimForUpdate(ctx, tx, claim.ID); err != nil {
				return err
			}
		}

		now := s.now()
		update := AwardUpdate{ResolvedAt: &now}
		var bookedAs *AdvanceBooking

		if advance {
			// A03: the calendar booking the selection held becomes the
			// driver's committed future booking. No claim, no execution: the
			// live slots are untouched until activation near pickup.
			lockedBooking, err := s.deps.Store.BookingForUpdate(ctx, tx, booking.ID)
			if err != nil {
				return err
			}
			if lockedBooking.State != machine.MpBookingHeld {
				return fmt.Errorf("%w: the booking is %s, not held", errExecutionBlocked, lockedBooking.State)
			}
			to := machine.MpBookingPaymentPending
			if lockedBooking.FundingState == BookingFundingSecured || lockedBooking.FundingState == BookingFundingUnsecuredCash {
				to = machine.MpBookingConfirmed
			}
			if bookedAs, err = s.deps.Store.TransitionBooking(ctx, tx, lockedBooking, to, BookingUpdate{}); err != nil {
				return err
			}
			if lockedRequest, err = s.deps.Store.TransitionRequest(ctx, tx, lockedRequest, machine.MpRequestAwarded, RequestUpdate{}); err != nil {
				return err
			}
		} else if deliveryID != nil {
			// The delivery exists in delivery-service (assigned to this
			// driver, custody seeded); ride-service records it as the
			// award's execution — no execution ride, no pickup PIN. A
			// queued delivery keeps its claim in the next slot until the
			// promotion couples it.
			service := ServiceDelivery
			update.ExecutionService = &service
			update.ExecutionID = deliveryID
			if award.Slot == SlotCurrent {
				if _, err = s.deps.Store.TransitionClaim(ctx, tx, claim, machine.MpClaimCurrent, ClaimUpdate{
					ExecutionService: &service,
					ExecutionID:      deliveryID,
				}); err != nil {
					return err
				}
				if lockedRequest, err = s.deps.Store.TransitionRequest(ctx, tx, lockedRequest, machine.MpRequestAwarded, RequestUpdate{}); err != nil {
					return err
				}
				if lockedRequest, err = s.deps.Store.TransitionRequest(ctx, tx, lockedRequest, machine.MpRequestExecution, RequestUpdate{}); err != nil {
					return err
				}
			} else {
				if _, err = s.deps.Store.TransitionClaim(ctx, tx, claim, machine.MpClaimNext, ClaimUpdate{}); err != nil {
					return err
				}
				if lockedRequest, err = s.deps.Store.TransitionRequest(ctx, tx, lockedRequest, machine.MpRequestAwarded, RequestUpdate{}); err != nil {
					return err
				}
			}
		} else if award.Slot == SlotCurrent {
			ride, ridePin, err := s.createExecutionRide(ctx, tx, lockedRequest, locked, config, now)
			if err != nil {
				return err
			}
			pin = ridePin
			service := "ride"
			update.ExecutionService = &service
			update.ExecutionID = &ride.ID
			if _, err = s.deps.Store.TransitionClaim(ctx, tx, claim, machine.MpClaimCurrent, ClaimUpdate{
				ExecutionService: &service,
				ExecutionID:      &ride.ID,
			}); err != nil {
				return err
			}
			if lockedRequest, err = s.deps.Store.TransitionRequest(ctx, tx, lockedRequest, machine.MpRequestAwarded, RequestUpdate{}); err != nil {
				return err
			}
			if lockedRequest, err = s.deps.Store.TransitionRequest(ctx, tx, lockedRequest, machine.MpRequestExecution, RequestUpdate{}); err != nil {
				return err
			}
		} else {
			if _, err = s.deps.Store.TransitionClaim(ctx, tx, claim, machine.MpClaimNext, ClaimUpdate{}); err != nil {
				return err
			}
			if lockedRequest, err = s.deps.Store.TransitionRequest(ctx, tx, lockedRequest, machine.MpRequestAwarded, RequestUpdate{}); err != nil {
				return err
			}
		}

		confirmed, err := s.deps.Store.TransitionAward(ctx, tx, locked, machine.MpAwardConfirmed, update)
		if err != nil {
			return err
		}
		wonBid, err := s.deps.Store.TransitionBid(ctx, tx, lockedBid, machine.MpBidWon, BidUpdate{})
		if err != nil {
			return err
		}

		// Losers: every other live bid on this request loses, with one hold
		// release each after commit. Each loser is RE-READ UNDER LOCK before
		// its transition: the list is an MVCC snapshot, and a bid that
		// concurrently reached a terminal state (withdrawn, expired) must be
		// skipped, never overwritten to lost.
		losers, err := s.deps.Store.LiveBidsForRequest(ctx, tx, request.ID)
		if err != nil {
			return err
		}
		for _, snapshot := range losers {
			if snapshot.ID == wonBid.ID {
				continue
			}
			loser, err := s.deps.Store.BidForUpdate(ctx, tx, snapshot.ID)
			if err != nil {
				if errors.Is(err, domain.ErrNotFound) {
					continue
				}
				return err
			}
			if !machine.IsMpBidLive(loser.State) {
				continue
			}
			moved, err := s.deps.Store.TransitionBid(ctx, tx, loser, machine.MpBidLost, BidUpdate{})
			if err != nil {
				return err
			}
			if err := writeEvent(ctx, tx, Event{
				Name:           "mp.bid.lost",
				AggregateType:  subjectBid,
				AggregateID:    loser.ID.String(),
				ToVersion:      moved.BidVersion,
				CityID:         request.CityID,
				ActorType:      "system",
				ActorID:        "ride-service",
				IdempotencyKey: "mp.bid.lost:" + loser.ID.String(),
				OccurredAt:     now,
				Payload: map[string]any{
					"bidId":         loser.ID.String(),
					"requestId":     request.ID.String(),
					"driverId":      loser.DriverID.String(),
					"reservationId": loser.ReservationID,
				},
			}); err != nil {
				return err
			}
			releases = append(releases, moved)
		}

		// The winner's OTHER live bids for the same capacity slot are now
		// impossible promises; they are invalidated (which notifies those
		// requests' owners through the event stream) and their holds released.
		// For an advance award the clashing offers are the driver's other
		// advance bids whose calendar interval now overlaps this booking.
		var clashing []*Bid
		if advance {
			clashing, err = s.overlappingAdvanceBids(ctx, tx, bookedAs, request.ID, advancePolicy)
		} else {
			clashing, err = s.deps.Store.LiveBidsForDriverInSlot(ctx, tx, award.DriverID, award.Slot, request.ID)
		}
		if err != nil {
			return err
		}
		for _, clashSnapshot := range clashing {
			other, err := s.deps.Store.BidForUpdate(ctx, tx, clashSnapshot.ID)
			if err != nil {
				if errors.Is(err, domain.ErrNotFound) {
					continue
				}
				return err
			}
			if !machine.IsMpBidLive(other.State) {
				continue
			}
			moved, err := s.deps.Store.TransitionBid(ctx, tx, other, machine.MpBidInvalidated, BidUpdate{})
			if err != nil {
				return err
			}
			if err := writeEvent(ctx, tx, Event{
				Name:           "mp.bid.invalidated",
				AggregateType:  subjectBid,
				AggregateID:    other.ID.String(),
				ToVersion:      moved.BidVersion,
				CityID:         request.CityID,
				ActorType:      "system",
				ActorID:        "ride-service",
				IdempotencyKey: "mp.bid.invalidated:" + other.ID.String(),
				OccurredAt:     now,
				Payload: map[string]any{
					"bidId":     other.ID.String(),
					"requestId": other.RequestID.String(),
					"driverId":  other.DriverID.String(),
					"reason":    "driver_awarded_elsewhere",
				},
			}); err != nil {
				return err
			}
			releases = append(releases, moved)
		}

		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.award.confirmed",
			AggregateType:  subjectAward,
			AggregateID:    award.ID.String(),
			ToVersion:      lockedRequest.Version,
			CityID:         request.CityID,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "mp.award.confirmed:" + award.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"awardId":          award.ID.String(),
				"requestId":        request.ID.String(),
				"bidId":            award.BidID.String(),
				"driverId":         award.DriverID.String(),
				"fareMinor":        award.FareMinor,
				"commissionMinor":  award.CommissionMinor,
				"slot":             award.Slot,
				"requestState":     lockedRequest.State,
				"executionId":      executionIDString(confirmed),
				"executionService": executionServiceOf(confirmed),
				"captureReceipt":   confirmed.CaptureReceiptID,
			},
		}); err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.bid.won",
			AggregateType:  subjectBid,
			AggregateID:    wonBid.ID.String(),
			ToVersion:      wonBid.BidVersion,
			CityID:         request.CityID,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "mp.bid.won:" + wonBid.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"bidId":     wonBid.ID.String(),
				"requestId": request.ID.String(),
				"awardId":   award.ID.String(),
				"driverId":  wonBid.DriverID.String(),
			},
		}); err != nil {
			return err
		}
		if bookedAs != nil {
			name := "mp.advance_booking.confirmed"
			if bookedAs.State == machine.MpBookingPaymentPending {
				name = "mp.advance_booking.payment_pending"
			}
			if err := s.writeBookingEvent(ctx, tx, bookedAs, name, "system", "ride-service", now, map[string]any{
				"fareMinor":          award.FareMinor,
				"commissionMinor":    award.CommissionMinor,
				"currency":           request.Currency,
				"commissionCaptured": true,
				"captureReceipt":     confirmed.CaptureReceiptID,
				"driverReserved":     true,
				"fullySecured":       bookedAs.State == machine.MpBookingConfirmed,
				"fundingDueAt":       bookedAs.FundingDueAt.Format(time.RFC3339),
				"fundingDeadline":    bookedAs.FundingDeadline.Format(time.RFC3339),
				"reconfirmOpensAt":   bookedAs.ReconfirmOpensAt.Format(time.RFC3339),
				"reconfirmDeadline":  bookedAs.ReconfirmDeadline.Format(time.RFC3339),
				"activationAt":       bookedAs.ActivationAt.Format(time.RFC3339),
			}); err != nil {
				return err
			}
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     "ride-service",
			ActorRole:   "system",
			Action:      "mp.award.confirmed",
			SubjectType: subjectAward,
			SubjectID:   award.ID.String(),
			Before:      map[string]any{"state": machine.MpAwardPending},
			After: map[string]any{
				"state":            machine.MpAwardConfirmed,
				"fareMinor":        award.FareMinor,
				"commissionMinor":  award.CommissionMinor,
				"currency":         request.Currency,
				"captureReceipt":   confirmed.CaptureReceiptID,
				"executionId":      executionIDString(confirmed),
				"executionService": executionServiceOf(confirmed),
			},
			Reason: "the award saga captured the commission and committed the execution",
		}); err != nil {
			return err
		}
		return s.deps.Store.SaveAttempt(ctx, tx, award.ID, AttemptStepFinalize, AttemptStateDone, "", nil)
	})
	if err != nil {
		if isExecutionBlocked(err) {
			return "", fmt.Errorf("%w: %v", errExecutionBlocked, err)
		}
		return "", err
	}

	// The rows are committed: the losing and invalidated holds are released,
	// exactly once each, with the sweep owed anything the wallet cannot
	// confirm right now.
	s.releaseBidReservations(ctx, releases)
	return pin, nil
}

// isExecutionBlocked classifies a finalize failure as definitely blocked (so
// compensation runs) rather than transient (so the sweep retries).
func isExecutionBlocked(err error) bool {
	if errors.Is(err, errExecutionBlocked) {
		return true
	}
	if isUniqueViolation(err, "rides_one_active_per_driver") ||
		isUniqueViolation(err, "rides_one_active_per_rider") ||
		isUniqueViolation(err, "offers_one_accepted_per_ride") {
		return true
	}
	if mapped, ok := domain.AsError(err); ok {
		switch mapped.Code {
		case domain.CodeIllegalTransition, domain.CodeConflict, domain.CodeSlotUnavailable:
			return true
		}
	}
	return false
}

func executionIDString(award *Award) string {
	if award.ExecutionID == nil {
		return ""
	}
	return award.ExecutionID.String()
}

// executionServiceOf names the service an award's execution lives in ("" when
// there is none yet).
func executionServiceOf(award *Award) string {
	if award.ExecutionID == nil {
		return ""
	}
	if award.ExecutionService == "" {
		return ServiceRide
	}
	return award.ExecutionService
}

// compensateAward unwinds a failed award: any captured fee is reversed with a
// linked entry, the claim is released, the bid returns to its live state with
// its hold intact, and the request reopens (or closes if it can no longer
// stand). It is only ever called on DEFINITE failures.
//
// ORDERING IS THE POINT: the compensation decision is recorded DURABLY (the
// attempt ledger moves to step `compensating`, with the captured flag) BEFORE
// any wallet reversal is driven. A crash after the reversal can then only
// resume into THIS path — the sweep can never march the award forward into
// finalize and confirm it with its commission already handed back.
func (s *Service) compensateAward(ctx context.Context, awardID uuid.UUID, reason string, captured bool) {
	award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), awardID)
	if err != nil || award.State != machine.MpAwardPending {
		return
	}
	bid, err := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), award.BidID)
	if err != nil {
		s.deps.Logger.Error().Err(err).Str("award_id", awardID.String()).Msg("compensation could not read the bid")
		return
	}

	retryAt := s.now().Add(attemptRetryDelay)
	if err := s.deps.Store.SaveCompensationDecision(ctx, s.deps.Store.Pool(), awardID, reason, captured, &retryAt); err != nil {
		// Without the durable decision the reversal must not run: the sweep
		// would otherwise resume this pending award forward into finalize.
		s.deps.Logger.Error().Err(err).Str("award_id", awardID.String()).
			Msg("could not record the compensation decision; deferring to the sweep")
		return
	}

	if captured {
		// The fee was (or may have been) captured: reverse it before the state
		// unwinds, under the award's one reversal key. A wallet that cannot
		// confirm the reversal is owed by the sweep — the money is never
		// "probably fine".
		if _, revErr := s.deps.Wallet.Reverse(ctx, bid.ReservationID, award.ID.String(),
			reason, "mp.reverse:"+award.ID.String()); revErr != nil {
			s.deps.Logger.Warn().Err(revErr).Str("award_id", awardID.String()).
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
	}

	// An abandoned award frees the rider's funding reservation (C02) with the
	// compensation's reason, under the award's one release key. The endpoint
	// is forgiving (cash and funding-refused awards have no reservation), so
	// every compensation converges here; a failure never wedges compensation —
	// it is written down for the sweep. Runs AFTER the durable compensation
	// decision above, so a crash resumes into this same path.
	s.releaseRiderFunding(ctx, award, reason)
	// A business award's budget reservation (if the funding step reserved
	// one) is released the same way — owed durably, driven, swept — as the
	// system: no award resulted.
	s.releaseBusinessFunding(ctx, award.ID, systemRelease(reason))

	now := s.now()
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.AwardForUpdate(ctx, tx, awardID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpAwardPending {
			return nil
		}
		failReason := reason
		failed, err := s.deps.Store.TransitionAward(ctx, tx, locked, machine.MpAwardFailed, AwardUpdate{FailReason: &failReason})
		if err != nil {
			return err
		}
		if _, err := s.deps.Store.TransitionAward(ctx, tx, failed, machine.MpAwardCompensated, AwardUpdate{ResolvedAt: &now}); err != nil {
			return err
		}

		// The bid goes back to the live state it was selected from; its hold
		// was never released and still funds it. Whether that state is
		// `submitted` or `revised` is read from the revision history — the
		// selection bumps bid_version too, so the version alone no longer
		// says.
		lockedBid, err := s.deps.Store.BidForUpdate(ctx, tx, award.BidID)
		if err != nil {
			return err
		}
		if lockedBid.State == machine.MpBidSelectedPending {
			revised, err := s.deps.Store.HasRevisedRevision(ctx, tx, lockedBid.ID)
			if err != nil {
				return err
			}
			backTo := machine.MpBidSubmitted
			if revised {
				backTo = machine.MpBidRevised
			}
			if _, err := s.deps.Store.TransitionBid(ctx, tx, lockedBid, backTo, BidUpdate{}); err != nil {
				return err
			}
		}

		claim, err := s.deps.Store.ClaimByAwardID(ctx, tx, awardID)
		if err == nil {
			if claim, err = s.deps.Store.ClaimForUpdate(ctx, tx, claim.ID); err != nil {
				return err
			}
			if claim.State == machine.MpClaimAwardPending {
				if _, err := s.deps.Store.TransitionClaim(ctx, tx, claim, machine.MpClaimReleased, ClaimUpdate{}); err != nil {
					return err
				}
				if err := writeEvent(ctx, tx, Event{
					Name:           "mp.claim.released",
					AggregateType:  subjectClaim,
					AggregateID:    claim.ID.String(),
					ToVersion:      1,
					ActorType:      "system",
					ActorID:        "ride-service",
					IdempotencyKey: "mp.claim.released:" + claim.ID.String(),
					OccurredAt:     now,
					Payload: map[string]any{
						"claimId":  claim.ID.String(),
						"awardId":  awardID.String(),
						"driverId": claim.DriverID.String(),
						"reason":   "award_compensated",
					},
				}); err != nil {
					return err
				}
			}
		} else if !errors.Is(err, domain.ErrNotFound) {
			return err
		}

		// A03: an abandoned advance award frees the calendar interval its
		// selection held (the exclusion constraints stop counting it).
		if award.Slot == SlotAdvance {
			heldBooking, err := s.deps.Store.BookingByAwardID(ctx, tx, awardID)
			if err != nil && !errors.Is(err, domain.ErrNotFound) {
				return err
			}
			if err == nil {
				lockedBooking, err := s.deps.Store.BookingForUpdate(ctx, tx, heldBooking.ID)
				if err != nil {
					return err
				}
				if lockedBooking.State == machine.MpBookingHeld {
					released, err := s.deps.Store.TransitionBooking(ctx, tx, lockedBooking, machine.MpBookingReleased, BookingUpdate{})
					if err != nil {
						return err
					}
					if err := s.writeBookingEvent(ctx, tx, released, "mp.advance_booking.released", "system", "ride-service", now,
						map[string]any{"reason": reason, "driverSecured": false}); err != nil {
						return err
					}
				}
			}
		}

		lockedRequest, err := s.deps.Store.RequestForUpdate(ctx, tx, award.RequestID)
		if err != nil {
			return err
		}
		if lockedRequest.State == machine.MpRequestAwardPending {
			fromVersion := lockedRequest.Version
			if now.Before(lockedRequest.ExpiresAt) {
				reopened, err := s.deps.Store.TransitionRequest(ctx, tx, lockedRequest, machine.MpRequestOpen, RequestUpdate{})
				if err != nil {
					return err
				}
				if err := writeEvent(ctx, tx, Event{
					Name:           "mp.request.reopened",
					AggregateType:  subjectRequest,
					AggregateID:    lockedRequest.ID.String(),
					FromVersion:    &fromVersion,
					ToVersion:      reopened.Version,
					CityID:         lockedRequest.CityID,
					ActorType:      "system",
					ActorID:        "ride-service",
					IdempotencyKey: "mp.request.reopened:" + lockedRequest.ID.String() + ":" + awardID.String(),
					OccurredAt:     now,
					Payload: map[string]any{
						"requestId": lockedRequest.ID.String(),
						"awardId":   awardID.String(),
						"reason":    reason,
					},
				}); err != nil {
					return err
				}
			} else {
				closeReason := "award_failed"
				closed, err := s.deps.Store.TransitionRequest(ctx, tx, lockedRequest, machine.MpRequestCancelled, RequestUpdate{
					CloseReason: &closeReason,
				})
				if err != nil {
					return err
				}
				if err := writeEvent(ctx, tx, Event{
					Name:           "mp.request.closed",
					AggregateType:  subjectRequest,
					AggregateID:    lockedRequest.ID.String(),
					FromVersion:    &fromVersion,
					ToVersion:      closed.Version,
					CityID:         lockedRequest.CityID,
					ActorType:      "system",
					ActorID:        "ride-service",
					IdempotencyKey: "mp.request.closed:" + lockedRequest.ID.String(),
					OccurredAt:     now,
					Payload: map[string]any{
						"requestId": lockedRequest.ID.String(),
						"reason":    closeReason,
					},
				}); err != nil {
					return err
				}
			}
		}

		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.award.failed",
			AggregateType:  subjectAward,
			AggregateID:    awardID.String(),
			ToVersion:      1,
			CityID:         lockedRequest.CityID,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "mp.award.failed:" + awardID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"awardId":   awardID.String(),
				"requestId": award.RequestID.String(),
				"bidId":     award.BidID.String(),
				"driverId":  award.DriverID.String(),
				"reason":    reason,
				"reversed":  captured,
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     "ride-service",
			ActorRole:   "system",
			Action:      "mp.award.failed",
			SubjectType: subjectAward,
			SubjectID:   awardID.String(),
			Before:      map[string]any{"state": machine.MpAwardPending},
			After:       map[string]any{"state": machine.MpAwardCompensated, "reason": reason, "reversed": captured},
			Reason:      reason,
		}); err != nil {
			return err
		}
		return s.deps.Store.SaveAttempt(ctx, tx, awardID, AttemptStepCompensate, AttemptStateFailed, reason, nil)
	})
	if err != nil {
		s.deps.Logger.Error().Err(err).Str("award_id", awardID.String()).
			Msg("award compensation failed; the sweep will resume the compensation")
	}
}

// releaseRiderFunding frees an abandoned award's rider funding reservation
// (C02), exactly once under the award's release key. A reservation the
// settlement already CONSUMED is a definite disagreement between settlement
// and compensation: it is alarmed loudly and never retried (retrying cannot
// change a consumed reservation). Any other failure is recorded for the
// sweep, which re-drives the same key until payment-service answers.
func (s *Service) releaseRiderFunding(ctx context.Context, award *Award, reason string) {
	if _, err := s.deps.Store.BusinessBookingByAward(ctx, s.deps.Store.Pool(), award.ID); err == nil {
		// A business award has no rider funding: its organization budget
		// is released by releaseBusinessFunding instead (never both).
		return
	}
	err := s.deps.Funding.Release(ctx, award.ID, reason, fundingReleaseKeyFor(award.ID))
	if err == nil {
		return
	}
	if errors.Is(err, ErrFundingReservationConsumed) {
		s.deps.Logger.Error().Str("award_id", award.ID.String()).Str("reason", reason).
			Msg("rider funding reservation already CONSUMED while abandoning the award — settlement and compensation disagree; investigate")
		return
	}
	s.deps.Logger.Warn().Err(err).Str("award_id", award.ID.String()).
		Msg("rider funding release unconfirmed; recorded for the sweep")
	payload, marshalErr := json.Marshal(FundingReleaseRecoveryPayload{AwardID: award.ID, Reason: reason})
	if marshalErr != nil {
		s.deps.Logger.Error().Err(marshalErr).Msg("could not encode the funding release for recovery")
		return
	}
	if recErr := s.deps.Store.InsertRecovery(ctx, s.deps.Store.Pool(), RecoveryRow{
		ReservationID: fundingReleaseKeyFor(award.ID),
		DriverID:      award.RequesterID,
		Action:        RecoveryFundingRelease,
		Payload:       payload,
		LastError:     err.Error(),
	}); recErr != nil {
		s.deps.Logger.Error().Err(recErr).Msg("could not record the funding release for recovery")
	}
}

// ---------------------------------------------------------------------------
// Execution ride creation — shared by the current-slot award and by promotion.
// ---------------------------------------------------------------------------

// createExecutionRide writes the execution ride inside the caller's
// transaction, through the SAME exported move store functions the classic path
// uses: insert in `requesting`, contract transitions requesting → matching →
// driver_assigned, and the driver session walked available → offer_received →
// accepted → navigating_to_pickup. The agreed fare is the bid amount, fixed.
func (s *Service) createExecutionRide(ctx context.Context, tx pgx.Tx, request *Request, award *Award, config *cityconfig.CityConfig, now time.Time) (*domain.Ride, string, error) {
	mv := s.deps.Store.Move()

	session, err := mv.SessionForUpdate(ctx, tx, award.DriverID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, "", fmt.Errorf("%w: the driver has no session", errExecutionBlocked)
		}
		return nil, "", err
	}
	if session.State != machine.DriverAvailable {
		return nil, "", fmt.Errorf("%w: the driver is %s, not available", errExecutionBlocked, session.State)
	}

	mpQuote, err := s.deps.Store.QuoteByID(ctx, tx, request.QuoteID)
	if err != nil {
		return nil, "", err
	}

	pin, err := generateExecutionPIN()
	if err != nil {
		return nil, "", err
	}
	pinHash, err := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
	if err != nil {
		return nil, "", fmt.Errorf("failed to hash the pickup PIN: %w", err)
	}

	// The execution ride consumes a server-written quote row that pins the
	// negotiated fare and the request's routed endpoints, so ride.rides keeps
	// its NOT NULL quote provenance and the fare stays tamper-evident.
	rideQuote := &domain.Quote{
		ID:            uuid.New(),
		CityID:        request.CityID,
		ConfigVersion: config.Version,
		RiderID:       request.RequesterID,
		VehicleClass:  request.VehicleClass,
		Pickup:        domain.Place{Lat: request.Pickup.Lat, Lng: request.Pickup.Lng, Address: request.Pickup.Label},
		Dropoff:       domain.Place{Lat: request.Dropoff.Lat, Lng: request.Dropoff.Lng, Address: request.Dropoff.Label},
		// The awarded route's ordered stops, with the stable ids, order,
		// purpose and dwell the award was made against: the execution (and
		// every move/* reader of this quote) sees exactly the stops quoted.
		Stops:           executionStops(request.Stops),
		DistanceMeters:  mpQuote.RoutedDistanceM,
		DurationSeconds: mpQuote.RoutedDurationSec,
		FareMinor:       award.FareMinor,
		Currency:        request.Currency,
		ExpiresAt:       now,
	}
	if err := mv.InsertQuote(ctx, tx, rideQuote); err != nil {
		return nil, "", err
	}

	ride := &domain.Ride{
		ID:              uuid.New(),
		CityID:          request.CityID,
		ConfigVersion:   config.Version,
		QuoteID:         rideQuote.ID,
		RiderID:         request.RequesterID,
		State:           machine.RiderRequesting,
		Version:         1,
		Active:          true,
		VehicleClass:    request.VehicleClass,
		PaymentMethodID: request.PaymentMethodID,
		Pickup:          rideQuote.Pickup,
		Dropoff:         rideQuote.Dropoff,
		QuotedFareMinor: award.FareMinor,
		Currency:        request.Currency,
	}
	if err := mv.InsertRide(ctx, tx, ride, pinHash); err != nil {
		if isUniqueViolation(err, "rides_one_active_per_rider") || isUniqueViolation(err, "rides_one_active_per_driver") {
			return nil, "", fmt.Errorf("%w: %v", errExecutionBlocked, err)
		}
		return nil, "", err
	}
	if err := mv.ConsumeQuote(ctx, tx, rideQuote.ID, ride.ID); err != nil {
		return nil, "", err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE ride.rides SET marketplace_award_id = $2 WHERE id = $1`,
		ride.ID, award.ID); err != nil {
		return nil, "", fmt.Errorf("failed to mark the execution ride as marketplace-managed: %w", err)
	}

	// Capture the encrypted PIN so the requester can retrieve it over the
	// authenticated REST channel — the ONLY path for a promotion-created ride,
	// where no /select response carries it. Same transaction as the ride, so
	// the vault never disagrees with the ride that exists.
	if err := s.storeExecutionPin(ctx, tx, request, ride.ID, pin, now); err != nil {
		return nil, "", err
	}

	if err := writeEvent(ctx, tx, Event{
		Name:           "ride.requested",
		AggregateType:  "ride",
		AggregateID:    ride.ID.String(),
		ToVersion:      ride.Version,
		CityID:         ride.CityID,
		ActorType:      "system",
		ActorID:        "ride-service",
		IdempotencyKey: "ride.requested:" + ride.ID.String(),
		OccurredAt:     now,
		Payload: map[string]any{
			"rideId":        ride.ID.String(),
			"quoteId":       rideQuote.ID.String(),
			"awardId":       award.ID.String(),
			"paymentMethod": ride.PaymentMethodID,
			"pickup":        map[string]any{"lat": ride.Pickup.Lat, "lng": ride.Pickup.Lng},
			"dropoff":       map[string]any{"lat": ride.Dropoff.Lat, "lng": ride.Dropoff.Lng},
		},
	}); err != nil {
		return nil, "", err
	}

	matching, err := mv.Transition(ctx, tx, ride, machine.RiderMatching, move.RideUpdate{})
	if err != nil {
		return nil, "", err
	}
	driverID := award.DriverID
	fromVersion := matching.Version
	assigned, err := mv.Transition(ctx, tx, matching, machine.RiderDriverAssigned, move.RideUpdate{
		DriverID:   &driverID,
		AssignedAt: &now,
	})
	if err != nil {
		return nil, "", err
	}
	if err := writeEvent(ctx, tx, Event{
		Name:           "ride.assigned",
		AggregateType:  "ride",
		AggregateID:    assigned.ID.String(),
		FromVersion:    &fromVersion,
		ToVersion:      assigned.Version,
		CityID:         assigned.CityID,
		ActorType:      "system",
		ActorID:        "ride-service",
		IdempotencyKey: "ride.assigned:" + assigned.ID.String() + ":" + itoa(assigned.Version),
		OccurredAt:     now,
		Payload: map[string]any{
			"rideId":    assigned.ID.String(),
			"version":   assigned.Version,
			"driverId":  driverID.String(),
			"awardId":   award.ID.String(),
			"fareMinor": assigned.QuotedFareMinor,
			"currency":  assigned.Currency,
		},
	}); err != nil {
		return nil, "", err
	}

	// The driver session walks the contract path exactly as AcceptOffer does.
	session, err = mv.TransitionDriver(ctx, tx, session, machine.DriverOfferReceived, move.SessionUpdate{})
	if err != nil {
		return nil, "", err
	}
	session, err = mv.TransitionDriver(ctx, tx, session, machine.DriverAccepted, move.SessionUpdate{
		CurrentRideID: &assigned.ID,
	})
	if err != nil {
		return nil, "", err
	}
	if _, err := mv.TransitionDriver(ctx, tx, session, machine.DriverNavigatingToPickup, move.SessionUpdate{}); err != nil {
		return nil, "", err
	}

	return assigned, pin, nil
}

// generateExecutionPIN mirrors the move package's pickup PIN: four uniformly
// random digits from the system CSPRNG, stored only as a hash.
func generateExecutionPIN() (string, error) {
	var builder strings.Builder
	for i := 0; i < 4; i++ {
		digit, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", fmt.Errorf("failed to generate the pickup PIN: %w", err)
		}
		builder.WriteString(digit.String())
	}
	return builder.String(), nil
}

// ---------------------------------------------------------------------------
// Queued pickup windows
// ---------------------------------------------------------------------------

// computeQueueWindow predicts a finishing-trip pickup window from the
// driver's ACTUAL position: remaining service time on the live current trip
// (when there is one) plus the policy buffers plus the travel leg to the new
// pickup. `etaVersion` quantises the prediction by the policy tolerance, so a
// consent is to a window bucket, not a second-exact number, and a MATERIAL
// worsening changes the version.
func (s *Service) computeQueueWindow(ctx context.Context, driverID uuid.UUID, pickup Area, policy *cityconfig.MarketplacePolicy) (*AwardWindow, error) {
	session, err := s.deps.Store.DriverSessionRow(ctx, s.deps.Store.Pool(), driverID)
	if err != nil {
		return nil, fmt.Errorf("no driver session: %w", err)
	}
	if session.State == machine.DriverOffline || !session.HasLocation() {
		return nil, errors.New("the driver has no usable position")
	}
	now := s.now()
	fixAge := now.Sub(*session.LastLocationAt)
	if fixAge < -time.Minute || fixAge > time.Duration(policy.Stationary.MaxLocationAgeSec)*time.Second {
		return nil, errors.New("the driver's position is stale")
	}

	finishing := policy.FinishingTrip
	var predicted int64

	// The remaining leg exists only while the current trip is genuinely live;
	// a cancelled-early trip must NOT assume the original destination.
	origin := domain.Place{Lat: *session.LastLat, Lng: *session.LastLng}
	if claim, err := s.deps.Store.CurrentClaim(ctx, s.deps.Store.Pool(), driverID); err == nil && claim.ExecutionID != nil {
		ride, rideErr := s.deps.Store.ExecutionRideRow(ctx, s.deps.Store.Pool(), *claim.ExecutionID)
		if rideErr == nil && machine.IsRiderActive(ride.State) {
			if ride.StopCount > 0 {
				// A multi-stop trip's remaining time is stop-aware: the
				// stops the server has NOT seen the driver finish (every
				// stop, until stop events say otherwise), their dwell, and
				// the committed dropoff (A02).
				remaining, end, err := s.remainingTripSeconds(ctx, ride, *session.LastLat, *session.LastLng)
				if err != nil {
					return nil, fmt.Errorf("routing unavailable: %w", err)
				}
				predicted += remaining + int64(finishing.CompletionBufferSec)
				origin = domain.Place{Lat: end.Lat, Lng: end.Lng}
			} else {
				remaining, err := s.routeSeconds(ctx, *session.LastLat, *session.LastLng, ride.DropoffLat, ride.DropoffLng)
				if err != nil {
					return nil, fmt.Errorf("routing unavailable: %w", err)
				}
				predicted += remaining + int64(finishing.CompletionBufferSec)
				origin = domain.Place{Lat: ride.DropoffLat, Lng: ride.DropoffLng}
			}
		}
	} else if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, err
	}

	travel, err := s.routeSeconds(ctx, origin.Lat, origin.Lng, pickup.Lat, pickup.Lng)
	if err != nil {
		return nil, fmt.Errorf("routing unavailable: %w", err)
	}
	predicted += travel + int64(finishing.UncertaintyBufferSec)

	tolerance := policy.Queue.PickupWindowToleranceSec
	if tolerance <= 0 {
		tolerance = 60
	}
	return &AwardWindow{
		EarliestSec:  int(predicted),
		LatestSec:    int(predicted) + tolerance,
		EtaVersion:   int(predicted)/tolerance + 1,
		PredictedSec: int(predicted),
	}, nil
}
