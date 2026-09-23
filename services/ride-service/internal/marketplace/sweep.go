package marketplace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// sweepBatch bounds one pass over each table. Plumbing, not policy.
const sweepBatch = 100

// Sweep is one pass of the marketplace's durable background work:
//
//  1. expire overdue live bids and release their holds once;
//     1a. end preferred-driver windows whose time is up and whose named
//     driver holds no live offer: open to the market with the rider's
//     consent, otherwise close free (A04 item 3);
//  2. close open requests past expiry with zero live bids as no_offers;
//  3. expand search envelopes per policy — preserving valid bids and never
//     bumping the revision;
//  4. retry wallet operations the engine still owes (orphan reservations,
//     failed releases, adjusts, reversals — and rider funding releases for
//     awards abandoned into their terminal non-settled states, cancelled and
//     compensated, whose release the wallet could not confirm);
//  5. resume stalled award sagas — re-polling an unknown capture by award id
//     until the outcome is definite, NEVER timeout-reopening while a debit
//     may still commit;
//  6. settle finished current claims and promote queued next claims exactly
//     once (the durable backstop for a lost completion callback);
//  7. recompute queued pickup windows (eta_updated / window_missed once);
//  8. cancel queued awards whose driver went offline, with the fee reversed;
//  9. resume post-award amendments whose money is still open — re-driving a
//     stalled reservation or commit under the same amendment id, expiring
//     and releasing unapproved ones, compensating failed ones (A02);
//  10. publish due stop-waiting milestones and settle finalised stop
//     waiting still owed to the amendment path;
//  11. generate recurring occurrences inside the generation horizon, once
//     per template and local date (A03);
//  12. publish due scheduled intents with refreshed routing, bounds and
//     funding — or park them for the rider's renewed approval — expire
//     lapsed ones and record published ones the market left unfulfilled;
//  13. send due scheduled-request reminders, once per offset;
//  14. drive the advance-booking calendar: secure rider funding inside the
//     funding horizon (or release at the deadline), fail bookings whose
//     driver lost eligibility or missed reconfirmation, request
//     reconfirmation, activate reconfirmed bookings into the live slots
//     exactly once, record activated bookings' outcomes, send reminders.
//
// It is a plain function over rows, so a restart resumes rather than forgets,
// a test can drive it a tick at a time, and an operator can run it as a job.
func (s *Service) Sweep(ctx context.Context) error {
	now := s.now()
	s.sweepExpiredBids(ctx, now)
	s.sweepPreferredWindows(ctx, now)
	s.sweepExpiredRequests(ctx, now)
	s.sweepEnvelopes(ctx, now)
	s.sweepRecoveries(ctx, now)
	s.sweepStalledAwards(ctx, now)
	s.sweepPromotions(ctx)
	s.sweepQueuedWindows(ctx, now)
	s.sweepQueuedDriverFailures(ctx)
	s.sweepAmendments(ctx, now)
	s.sweepStopWaiting(ctx, now)
	s.sweepRecurringGeneration(ctx, now)
	s.sweepScheduledPublications(ctx, now)
	s.sweepScheduledReminders(ctx, now)
	s.sweepAdvanceBookings(ctx, now)
	return nil
}

// RunSweeper sweeps on a ticker until the context is cancelled.
func (s *Service) RunSweeper(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.Sweep(ctx); err != nil {
				s.deps.Logger.Error().Err(err).Msg("marketplace sweep failed")
			}
		}
	}
}

func (s *Service) sweepExpiredBids(ctx context.Context, now time.Time) {
	bids, err := s.deps.Store.ExpiredLiveBids(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list expired bids")
		return
	}
	for _, bid := range bids {
		expired, err := s.expireBid(ctx, bid, now)
		if err != nil {
			s.deps.Logger.Error().Err(err).Str("bid_id", bid.ID.String()).Msg("failed to expire bid")
			continue
		}
		if expired != nil {
			// The row is terminal: the hold is released exactly once, under
			// the bid's one release key; failures land in recovery.
			s.releaseReservation(ctx, expired)
		}
	}
}

// expireBid marks one overdue bid expired. A nil bid with a nil error means
// another sweeper or a user action got there first.
func (s *Service) expireBid(ctx context.Context, bid *Bid, now time.Time) (*Bid, error) {
	var expired *Bid
	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BidForUpdate(ctx, tx, bid.ID)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				return nil
			}
			return err
		}
		if !machine.IsMpBidLive(locked.State) || locked.ExpiresAt.After(now) {
			return nil
		}
		moved, err := s.deps.Store.TransitionBid(ctx, tx, locked, machine.MpBidExpired, BidUpdate{})
		if err != nil {
			return err
		}
		expired = moved
		return writeEvent(ctx, tx, Event{
			Name:           "mp.bid.expired",
			AggregateType:  subjectBid,
			AggregateID:    bid.ID.String(),
			ToVersion:      moved.BidVersion,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "mp.bid.expired:" + bid.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"bidId":         bid.ID.String(),
				"requestId":     bid.RequestID.String(),
				"driverId":      bid.DriverID.String(),
				"reservationId": bid.ReservationID,
			},
		})
	})
	return expired, err
}

// expiredOpenRequests lists open requests past their deadline.
func (s *Store) expiredOpenRequests(ctx context.Context, db DB, now time.Time, limit int) ([]*Request, error) {
	rows, err := db.Query(ctx, `
		SELECT `+requestColumns+`
		FROM mp.requests
		WHERE state = $1 AND expires_at <= $2
		ORDER BY expires_at ASC
		LIMIT $3`, machine.MpRequestOpen, now, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list expired requests: %w", err)
	}
	defer rows.Close()
	var requests []*Request
	for rows.Next() {
		request, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}
		requests = append(requests, request)
	}
	return requests, rows.Err()
}

func (s *Service) sweepExpiredRequests(ctx context.Context, now time.Time) {
	requests, err := s.deps.Store.expiredOpenRequests(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list expired requests")
		return
	}
	for _, request := range requests {
		if err := s.closeRequestNoOffers(ctx, request, now); err != nil {
			s.deps.Logger.Error().Err(err).Str("request_id", request.ID.String()).Msg("failed to close expired request")
		}
	}
}

// closeRequestNoOffers closes an expired request that attracted no live bids.
// A request that still carries live bids is left for the requester (and for
// the bid-expiry sweep, after which this pass closes it).
func (s *Service) closeRequestNoOffers(ctx context.Context, request *Request, now time.Time) error {
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.RequestForUpdate(ctx, tx, request.ID)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				return nil
			}
			return err
		}
		if locked.State != machine.MpRequestOpen || locked.ExpiresAt.After(now) {
			return nil
		}
		live, err := s.deps.Store.LiveBidCountForRequest(ctx, tx, locked.ID)
		if err != nil {
			return err
		}
		if live > 0 {
			return nil
		}
		reason := "no_offers"
		fromVersion := locked.Version
		moved, err := s.deps.Store.TransitionRequest(ctx, tx, locked, machine.MpRequestNoOffers, RequestUpdate{
			CloseReason: &reason,
		})
		if err != nil {
			return err
		}
		return writeEvent(ctx, tx, Event{
			Name:           "mp.request.closed",
			AggregateType:  subjectRequest,
			AggregateID:    locked.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         locked.CityID,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "mp.request.closed:" + locked.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"requestId": locked.ID.String(),
				"reason":    reason,
			},
		})
	})
}

// expandableRequests lists open requests whose envelope may grow: still open,
// not past expiry, steps left, and past the expansion deadline for their step.
func (s *Store) expandableRequests(ctx context.Context, db DB, now time.Time, limit int) ([]*Request, error) {
	rows, err := db.Query(ctx, `
		SELECT `+requestColumns+`
		FROM mp.requests
		WHERE state = $1 AND expires_at > $2
		ORDER BY created_at ASC
		LIMIT $3`, machine.MpRequestOpen, now, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list expandable requests: %w", err)
	}
	defer rows.Close()
	var requests []*Request
	for rows.Next() {
		request, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}
		requests = append(requests, request)
	}
	return requests, rows.Err()
}

func (s *Service) sweepEnvelopes(ctx context.Context, now time.Time) {
	requests, err := s.deps.Store.expandableRequests(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list requests for expansion")
		return
	}
	for _, request := range requests {
		if err := s.expandEnvelope(ctx, request, now); err != nil {
			s.deps.Logger.Error().Err(err).Str("request_id", request.ID.String()).Msg("envelope expansion failed")
		}
	}
}

// expandEnvelope grows one request's search envelope per policy: after
// expandAfterSec per step, only while the offer count is below the policy's
// threshold, stepping linearly to the maxima. Existing valid bids are
// PRESERVED — an envelope change is not a revision and invalidates nothing.
func (s *Service) expandEnvelope(ctx context.Context, request *Request, now time.Time) error {
	_, policy, err := s.policy(ctx, request.CityID)
	if err != nil {
		// A city whose policy vanished mid-flight expands nothing.
		return nil
	}
	envelope := policy.SearchEnvelope

	if request.EnvelopeStep >= envelope.ExpansionSteps {
		return nil
	}
	due := request.CreatedAt.Add(time.Duration((request.EnvelopeStep+1)*envelope.ExpandAfterSec) * time.Second)
	if now.Before(due) {
		return nil
	}

	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.RequestForUpdate(ctx, tx, request.ID)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				return nil
			}
			return err
		}
		if locked.State != machine.MpRequestOpen || locked.EnvelopeStep != request.EnvelopeStep {
			return nil
		}
		live, err := s.deps.Store.LiveBidCountForRequest(ctx, tx, locked.ID)
		if err != nil {
			return err
		}
		if live >= envelope.MinOffersBeforeExpand {
			return nil
		}

		step := locked.EnvelopeStep + 1
		radius := envelope.InitialRadiusMeters +
			(envelope.MaxRadiusMeters-envelope.InitialRadiusMeters)*step/envelope.ExpansionSteps
		eta := envelope.InitialPickupEtaSec +
			(envelope.MaxPickupEtaSec-envelope.InitialPickupEtaSec)*step/envelope.ExpansionSteps
		if radius > envelope.MaxRadiusMeters {
			radius = envelope.MaxRadiusMeters
		}
		if eta > envelope.MaxPickupEtaSec {
			eta = envelope.MaxPickupEtaSec
		}

		fromVersion := locked.Version
		// open → open, envelope fields only: the revision does not move, so
		// every live bid stays valid and every hold stays where it is.
		moved, err := s.deps.Store.TransitionRequest(ctx, tx, locked, machine.MpRequestOpen, RequestUpdate{
			EnvelopeStep:    &step,
			EnvelopeRadiusM: &radius,
			EnvelopeEtaSec:  &eta,
		})
		if err != nil {
			return err
		}
		return writeEvent(ctx, tx, Event{
			Name:           "mp.request.revised",
			AggregateType:  subjectRequest,
			AggregateID:    locked.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         locked.CityID,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "mp.request.envelope:" + locked.ID.String() + ":" + itoa(step),
			OccurredAt:     now,
			Payload: map[string]any{
				"requestId": locked.ID.String(),
				"revision":  moved.Revision,
				"envelope": map[string]any{
					"step":         step,
					"radiusMeters": radius,
					"pickupEtaSec": eta,
				},
				"envelopeOnly": true,
			},
		})
	})
}

// sweepRecoveries retries the wallet operations the engine still owes.
func (s *Service) sweepRecoveries(ctx context.Context, now time.Time) {
	due, err := s.deps.Store.DueRecoveries(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list due recoveries")
		return
	}
	for _, row := range due {
		resolved, opErr := s.runRecovery(ctx, row, now)
		if resolved {
			if err := s.deps.Store.ResolveRecovery(ctx, s.deps.Store.Pool(), row.ID, now); err != nil {
				s.deps.Logger.Error().Err(err).Str("recovery_id", row.ID.String()).Msg("failed to resolve recovery")
			}
			continue
		}
		lastError := "deferred"
		if opErr != nil {
			lastError = opErr.Error()
		}
		backoff := time.Duration(30*(row.Attempts+1)) * time.Second
		if backoff > 10*time.Minute {
			backoff = 10 * time.Minute
		}
		if err := s.deps.Store.DeferRecovery(ctx, s.deps.Store.Pool(), row.ID, lastError, now.Add(backoff)); err != nil {
			s.deps.Logger.Error().Err(err).Str("recovery_id", row.ID.String()).Msg("failed to defer recovery")
		}
	}
}

// isWalletNotFound reports the wallet's definite "never heard of it".
func isWalletNotFound(err error) bool {
	mapped, ok := domain.AsError(err)
	return ok && mapped.Code == domain.CodeNotFound
}

// runRecovery drives one recovery row and reports whether it is resolved.
func (s *Service) runRecovery(ctx context.Context, row *RecoveryRow, now time.Time) (bool, error) {
	switch row.Action {
	case RecoveryRelease:
		_, opErr := s.deps.Wallet.Release(ctx, row.ReservationID, "mp.recovery:"+row.ID.String())
		if opErr == nil {
			s.markRowHoldReleased(ctx, row, now)
			return true, nil
		}
		if isWalletNotFound(opErr) {
			// The wallet has never heard of this reservation: an unknown
			// outcome that turned out to be "never applied". Nothing to
			// release; the row is done.
			return true, nil
		}
		return false, opErr

	case RecoveryAdjust:
		if row.BidID == nil || row.AmountMinor == nil {
			return false, errors.New("adjust recovery row is missing its bid or amount")
		}
		bid, bidErr := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), *row.BidID)
		if bidErr != nil {
			return false, bidErr
		}
		request, reqErr := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), bid.RequestID)
		if reqErr != nil {
			return false, reqErr
		}
		_, opErr := s.deps.Wallet.Adjust(ctx, row.ReservationID,
			money(*row.AmountMinor, request.Currency), money(bid.AmountMinor, request.Currency),
			"mp.recovery:"+row.ID.String())
		if opErr == nil || isWalletNotFound(opErr) {
			return true, opErr
		}
		return false, opErr

	case RecoveryReverse:
		// A reversal is idempotent under the award's one reversal key, so the
		// retry converges on the same linked entry — but ONLY once the
		// award's own state says the fee is genuinely owed back. A CONFIRMED
		// award keeps its fee (the row resolves untouched); a still-pending
		// award's compensation path owns the reversal, so the row defers.
		if row.BidID == nil {
			return false, errors.New("reverse recovery row is missing its bid")
		}
		award, awardErr := s.deps.Store.AwardByBidID(ctx, s.deps.Store.Pool(), *row.BidID)
		if awardErr != nil {
			return false, awardErr
		}
		switch award.State {
		case machine.MpAwardConfirmed:
			return true, nil
		case machine.MpAwardPending:
			return false, errors.New("award still pending; the compensation path owns the reversal")
		}
		_, opErr := s.deps.Wallet.Reverse(ctx, row.ReservationID, award.ID.String(),
			"recovery", "mp.reverse:"+award.ID.String())
		if opErr == nil || isWalletNotFound(opErr) {
			return true, opErr
		}
		return false, opErr

	case RecoveryReserveReplay:
		// The reserve's outcome was never learned: REPLAY it under the SAME
		// idempotency key. The wallet converges — answering the real
		// reservation id whether or not the original applied — and then THAT
		// id is released under the bid's one release key.
		var payload ReserveRecoveryPayload
		if err := json.Unmarshal(row.Payload, &payload); err != nil || payload.ReserveKey == "" {
			return false, fmt.Errorf("reserve replay row has an unreadable payload: %v", err)
		}
		hold, resErr := s.deps.Wallet.Reserve(ctx, payload.Reserve, payload.ReserveKey)
		if resErr != nil {
			if mapped, ok := domain.AsError(resErr); ok && !errors.Is(resErr, ErrWalletUnknownOutcome) {
				// A definite refusal (e.g. insufficient_spendable): the
				// original reserve never applied and the replay applied
				// nothing either. Nothing is held; the row is done.
				s.deps.Logger.Info().Str("code", string(mapped.Code)).
					Str("recovery_id", row.ID.String()).Msg("reserve replay refused; nothing was ever held")
				return true, nil
			}
			return false, resErr
		}
		releaseKey := "mp.recovery:" + row.ID.String()
		if row.BidID != nil {
			releaseKey = releaseKeyFor(*row.BidID)
		}
		if _, relErr := s.deps.Wallet.Release(ctx, hold.ReservationID, releaseKey); relErr != nil && !isWalletNotFound(relErr) {
			return false, relErr
		}
		s.markRowHoldReleased(ctx, row, now)
		return true, nil

	case RecoveryFundingRelease:
		// A rider funding release an abandoned award still owes (C02),
		// idempotent under the award's ONE release key — however many sweeps
		// run, the reservation frees at most once. A CONSUMED reservation is
		// a DEFINITE answer: the award settled with this money, so the row
		// resolves (retrying cannot change it) and the disagreement is
		// alarmed instead of looped on.
		var payload FundingReleaseRecoveryPayload
		if err := json.Unmarshal(row.Payload, &payload); err != nil || payload.AwardID == uuid.Nil {
			return false, fmt.Errorf("funding release row has an unreadable payload: %v", err)
		}
		opErr := s.deps.Funding.Release(ctx, payload.AwardID, payload.Reason,
			fundingReleaseKeyFor(payload.AwardID))
		if opErr == nil {
			return true, nil
		}
		if errors.Is(opErr, ErrFundingReservationConsumed) {
			s.deps.Logger.Error().Str("award_id", payload.AwardID.String()).
				Msg("rider funding reservation already CONSUMED for an abandoned award — settlement and compensation disagree; investigate")
			return true, opErr
		}
		return false, opErr

	case RecoverySettle:
		// Completion settlement, idempotent on the award id. NEVER resolved
		// on an error — payment-service answering not_found for an award is
		// not "settled", it is a bug to keep retrying loudly.
		var settle SettlementRequest
		if err := json.Unmarshal(row.Payload, &settle); err != nil {
			return false, fmt.Errorf("settlement row has an unreadable payload: %v", err)
		}
		// An amended trip settles its COMMITTED fare as it stands now, and
		// only once no adjustment to it holds open money (A02).
		settle, adjErr := s.committedSettlement(ctx, settle)
		if adjErr != nil {
			return false, adjErr
		}
		if opErr := s.deps.Settlement.Settle(ctx, settle, settlementKeyFor(settle.AwardID)); opErr != nil {
			return false, opErr
		}
		return true, nil

	default:
		return false, fmt.Errorf("unknown recovery action %q", row.Action)
	}
}

// markRowHoldReleased records the confirmed release on the bid row (when the
// recovery row knows its bid), so the driver's holdState can honestly say
// `released`.
func (s *Service) markRowHoldReleased(ctx context.Context, row *RecoveryRow, now time.Time) {
	if row.BidID == nil {
		return
	}
	if err := s.deps.Store.MarkHoldReleased(ctx, s.deps.Store.Pool(), *row.BidID, now); err != nil {
		s.deps.Logger.Error().Err(err).Str("bid_id", row.BidID.String()).Msg("could not record the confirmed release")
	}
}

// settlementKeyFor is the ONE idempotency key an award's completion is ever
// settled under, so the observer path and the sweep converge on one posting.
func settlementKeyFor(awardID uuid.UUID) string {
	return "mp.settle:" + awardID.String()
}
