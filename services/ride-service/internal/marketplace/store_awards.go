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

// AwardWindow is the pickup window pinned onto a finishing-trip award,
// persisted as mp.awards.pickup_window. `etaVersion` is what the requester
// consented to; `consentedLatestSec` is the latest arrival that consent
// promised, against which the queue sweep judges a missed window.
type AwardWindow struct {
	EarliestSec        int  `json:"earliestSec"`
	LatestSec          int  `json:"latestSec"`
	EtaVersion         int  `json:"etaVersion"`
	PredictedSec       int  `json:"predictedSec"`
	ConsentedLatestSec int  `json:"consentedLatestSec"`
	MissedEmitted      bool `json:"missedEmitted"`
}

// Award is one row of mp.awards: the immutable record of a selection. Its id
// is the idempotency key of the single commission capture.
type Award struct {
	ID               uuid.UUID
	RequestID        uuid.UUID
	BidID            uuid.UUID
	DriverID         uuid.UUID
	RequesterID      uuid.UUID
	State            string
	RequestVersion   int
	BidVersion       int
	FareMinor        int64
	CommissionMinor  int64
	Slot             string
	ExecutionService string
	ExecutionID      *uuid.UUID
	CaptureReceiptID string
	FailReason       string
	PickupWindow     *AwardWindow
	CreatedAt        time.Time
	ResolvedAt       *time.Time
	UpdatedAt        time.Time
}

const awardColumns = `
	id, request_id, bid_id, driver_id, requester_id, state,
	request_version, bid_version, fare_minor, commission_minor, slot,
	COALESCE(execution_service, ''), execution_id,
	COALESCE(capture_receipt_id, ''), COALESCE(fail_reason, ''),
	pickup_window, created_at, resolved_at, updated_at`

func scanAward(row pgx.Row) (*Award, error) {
	var award Award
	var window []byte
	err := row.Scan(
		&award.ID, &award.RequestID, &award.BidID, &award.DriverID, &award.RequesterID, &award.State,
		&award.RequestVersion, &award.BidVersion, &award.FareMinor, &award.CommissionMinor, &award.Slot,
		&award.ExecutionService, &award.ExecutionID,
		&award.CaptureReceiptID, &award.FailReason,
		&window, &award.CreatedAt, &award.ResolvedAt, &award.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read marketplace award: %w", err)
	}
	if len(window) > 0 {
		var decoded AwardWindow
		if err := json.Unmarshal(window, &decoded); err != nil {
			return nil, fmt.Errorf("award %s stores an unreadable pickup window: %w", award.ID, err)
		}
		award.PickupWindow = &decoded
	}
	return &award, nil
}

// errAwardAlreadyLive is awards_one_live_per_request saying no: a pending or
// confirmed award already occupies this request.
var errAwardAlreadyLive = errors.New("the request already carries an unresolved award")

// InsertAward writes the immutable award row. A second live award for the same
// request collides with awards_one_live_per_request.
func (s *Store) InsertAward(ctx context.Context, db DB, award *Award) error {
	var window []byte
	var err error
	if award.PickupWindow != nil {
		if window, err = json.Marshal(award.PickupWindow); err != nil {
			return fmt.Errorf("unserialisable award pickup window: %w", err)
		}
	}
	_, err = db.Exec(ctx, `
		INSERT INTO mp.awards (
			id, request_id, bid_id, driver_id, requester_id, state,
			request_version, bid_version, fare_minor, commission_minor, slot,
			pickup_window
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		award.ID, award.RequestID, award.BidID, award.DriverID, award.RequesterID, award.State,
		award.RequestVersion, award.BidVersion, award.FareMinor, award.CommissionMinor, award.Slot,
		window,
	)
	if err != nil {
		if isUniqueViolation(err, "awards_one_live_per_request") {
			return errAwardAlreadyLive
		}
		return fmt.Errorf("failed to insert marketplace award: %w", err)
	}
	return nil
}

// AwardByID reads one award.
func (s *Store) AwardByID(ctx context.Context, db DB, id uuid.UUID) (*Award, error) {
	return scanAward(db.QueryRow(ctx, `SELECT `+awardColumns+` FROM mp.awards WHERE id = $1`, id))
}

// AwardForUpdate reads and locks one award for the rest of the transaction.
func (s *Store) AwardForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Award, error) {
	return scanAward(tx.QueryRow(ctx, `SELECT `+awardColumns+` FROM mp.awards WHERE id = $1 FOR UPDATE`, id))
}

// LatestAwardForRequest reads a request's most recent award, or
// domain.ErrNotFound when the request was never selected.
func (s *Store) LatestAwardForRequest(ctx context.Context, db DB, requestID uuid.UUID) (*Award, error) {
	return scanAward(db.QueryRow(ctx, `
		SELECT `+awardColumns+` FROM mp.awards
		WHERE request_id = $1
		ORDER BY created_at DESC
		LIMIT 1`, requestID))
}

// AwardByBidID reads the award a bid produced, newest first.
func (s *Store) AwardByBidID(ctx context.Context, db DB, bidID uuid.UUID) (*Award, error) {
	return scanAward(db.QueryRow(ctx, `
		SELECT `+awardColumns+` FROM mp.awards
		WHERE bid_id = $1
		ORDER BY created_at DESC
		LIMIT 1`, bidID))
}

// AwardUpdate carries the columns an award transition may change.
type AwardUpdate struct {
	CaptureReceiptID *string
	FailReason       *string
	ExecutionService *string
	ExecutionID      *uuid.UUID
	PickupWindow     *AwardWindow
	ResolvedAt       *time.Time
}

// TransitionAward moves an award, refusing anything the mpAward machine does
// not allow. The conditional WHERE on the current state is the optimistic
// guard: awards have no client-visible version, but two concurrent resolvers
// still cannot both believe they resolved it.
func (s *Store) TransitionAward(ctx context.Context, tx pgx.Tx, award *Award, to string, update AwardUpdate) (*Award, error) {
	if err := machine.Assert(machine.MpAward, award.State, to); err != nil {
		allowed, _ := machine.Allowed(machine.MpAward, award.State)
		return nil, domain.Errorf(domain.CodeIllegalTransition, "an award cannot move from %s to %s", award.State, to).
			WithDetails(map[string]any{"from": award.State, "to": to, "allowed": allowed}).
			Wrap(err)
	}
	var window []byte
	var err error
	if update.PickupWindow != nil {
		if window, err = json.Marshal(update.PickupWindow); err != nil {
			return nil, fmt.Errorf("unserialisable award pickup window: %w", err)
		}
	}
	row := tx.QueryRow(ctx, `
		UPDATE mp.awards SET
			state = $3,
			capture_receipt_id = COALESCE($4, capture_receipt_id),
			fail_reason = COALESCE($5, fail_reason),
			execution_service = COALESCE($6, execution_service),
			execution_id = COALESCE($7, execution_id),
			pickup_window = COALESCE($8, pickup_window),
			resolved_at = COALESCE($9, resolved_at),
			updated_at = now()
		WHERE id = $1 AND state = $2
		RETURNING `+awardColumns,
		award.ID, award.State, to,
		update.CaptureReceiptID, update.FailReason,
		update.ExecutionService, update.ExecutionID,
		window, update.ResolvedAt,
	)
	moved, err := scanAward(row)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the award changed while this call was in flight").
			WithDetails(map[string]any{"awardId": award.ID.String(), "expectedState": award.State})
	}
	return moved, err
}

// SetAwardCaptureReceipt records the wallet's receipt on the award without a
// state change: the durable proof that the single debit happened.
func (s *Store) SetAwardCaptureReceipt(ctx context.Context, db DB, awardID uuid.UUID, receiptID string) error {
	_, err := db.Exec(ctx,
		`UPDATE mp.awards SET capture_receipt_id = $2, updated_at = now() WHERE id = $1`,
		awardID, receiptID)
	if err != nil {
		return fmt.Errorf("failed to record the capture receipt: %w", err)
	}
	return nil
}

// SetAwardWindow updates a queued award's pickup window (jsonb only; the
// caller writes the mp.queue.* event in the same transaction).
func (s *Store) SetAwardWindow(ctx context.Context, db DB, awardID uuid.UUID, window *AwardWindow) error {
	encoded, err := json.Marshal(window)
	if err != nil {
		return fmt.Errorf("unserialisable award pickup window: %w", err)
	}
	_, err = db.Exec(ctx,
		`UPDATE mp.awards SET pickup_window = $2, updated_at = now() WHERE id = $1`,
		awardID, encoded)
	if err != nil {
		return fmt.Errorf("failed to update the award pickup window: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Award attempts: the saga's durable step ledger
// ---------------------------------------------------------------------------

// Saga steps and step states persisted in mp.award_attempts.
const (
	AttemptStepFunding  = "funding"
	AttemptStepCapture  = "capture"
	AttemptStepFinalize = "finalize"

	AttemptStatePending = "pending"
	AttemptStateUnknown = "unknown"
	AttemptStateDone    = "done"
	AttemptStateFailed  = "failed"
)

// AwardAttempt is the saga's position for one award.
type AwardAttempt struct {
	AwardID     uuid.UUID
	Step        string
	State       string
	Attempts    int
	LastError   string
	NextRetryAt *time.Time
	UpdatedAt   time.Time
}

// SaveAttempt upserts the saga position. Attempts count every write, so the
// backoff and the ops view both see how often the wallet had to be asked.
func (s *Store) SaveAttempt(ctx context.Context, db DB, awardID uuid.UUID, step, state, lastError string, nextRetryAt *time.Time) error {
	_, err := db.Exec(ctx, `
		INSERT INTO mp.award_attempts (award_id, step, state, attempts, last_error, next_retry_at, updated_at)
		VALUES ($1, $2, $3, 1, $4, $5, now())
		ON CONFLICT (award_id) DO UPDATE SET
			step = EXCLUDED.step,
			state = EXCLUDED.state,
			attempts = mp.award_attempts.attempts + 1,
			last_error = EXCLUDED.last_error,
			next_retry_at = EXCLUDED.next_retry_at,
			updated_at = now()`,
		awardID, step, state, nullable(lastError), nextRetryAt)
	if err != nil {
		return fmt.Errorf("failed to save the award attempt: %w", err)
	}
	return nil
}

// AttemptFor reads the saga position for one award.
func (s *Store) AttemptFor(ctx context.Context, db DB, awardID uuid.UUID) (*AwardAttempt, error) {
	var attempt AwardAttempt
	err := db.QueryRow(ctx, `
		SELECT award_id, step, state, attempts, COALESCE(last_error, ''), next_retry_at, updated_at
		FROM mp.award_attempts WHERE award_id = $1`, awardID).Scan(
		&attempt.AwardID, &attempt.Step, &attempt.State, &attempt.Attempts,
		&attempt.LastError, &attempt.NextRetryAt, &attempt.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read the award attempt: %w", err)
	}
	return &attempt, nil
}

// StalledPendingAwards lists pending awards whose saga is due another push —
// the reconciliation sweep that re-polls capture until the outcome is
// definite. An award NEVER times out of pending here; it only gets retried.
func (s *Store) StalledPendingAwards(ctx context.Context, db DB, now time.Time, limit int) ([]uuid.UUID, error) {
	rows, err := db.Query(ctx, `
		SELECT a.id
		FROM mp.awards a
		JOIN mp.award_attempts t ON t.award_id = a.id
		WHERE a.state = $1
			AND t.state IN ($2, $3)
			AND (t.next_retry_at IS NULL OR t.next_retry_at <= $4)
		ORDER BY t.updated_at ASC
		LIMIT $5`,
		machine.MpAwardPending, AttemptStatePending, AttemptStateUnknown, now, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list stalled awards: %w", err)
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("failed to read stalled award id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ---------------------------------------------------------------------------
// Driver claims (write side: the award saga and the promotion own these)
// ---------------------------------------------------------------------------

// errSlotOccupied is one of the claim partial uniques saying no: the driver's
// current or next slot is already taken, whatever the application believed.
var errSlotOccupied = errors.New("the driver's capacity slot is already taken")

// InsertClaim writes a new capacity claim. The one-current/one-next partial
// unique indexes are the final authority on driver capacity.
func (s *Store) InsertClaim(ctx context.Context, db DB, claim *Claim) error {
	row := db.QueryRow(ctx, `
		INSERT INTO mp.driver_claims (
			id, driver_id, state, slot, service, award_id,
			execution_service, execution_id, depends_on_claim_id, availability_epoch
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING fencing_token`,
		claim.ID, claim.DriverID, claim.State, claim.Slot, claim.Service, claim.AwardID,
		nullable(claim.ExecutionService), claim.ExecutionID, claim.DependsOnClaimID, claim.AvailabilityEpoch,
	)
	if err := row.Scan(&claim.FencingToken); err != nil {
		if isUniqueViolation(err, "claims_one_current_per_driver") || isUniqueViolation(err, "claims_one_next_per_driver") {
			return errSlotOccupied
		}
		return fmt.Errorf("failed to insert driver claim: %w", err)
	}
	return nil
}

// ClaimByID reads one claim.
func (s *Store) ClaimByID(ctx context.Context, db DB, id uuid.UUID) (*Claim, error) {
	return scanClaim(db.QueryRow(ctx, `SELECT `+claimColumns+` FROM mp.driver_claims WHERE id = $1`, id))
}

// ClaimForUpdate reads and locks one claim.
func (s *Store) ClaimForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Claim, error) {
	return scanClaim(tx.QueryRow(ctx, `SELECT `+claimColumns+` FROM mp.driver_claims WHERE id = $1 FOR UPDATE`, id))
}

// ClaimByAwardID reads the claim an award created.
func (s *Store) ClaimByAwardID(ctx context.Context, db DB, awardID uuid.UUID) (*Claim, error) {
	return scanClaim(db.QueryRow(ctx, `SELECT `+claimColumns+` FROM mp.driver_claims WHERE award_id = $1`, awardID))
}

// CurrentClaimByExecutionID reads the CURRENT claim coupled to one execution
// ride, or domain.ErrNotFound.
func (s *Store) CurrentClaimByExecutionID(ctx context.Context, db DB, executionID uuid.UUID) (*Claim, error) {
	return scanClaim(db.QueryRow(ctx, `
		SELECT `+claimColumns+` FROM mp.driver_claims
		WHERE execution_id = $1 AND state = $2`, executionID, machine.MpClaimCurrent))
}

// ClaimUpdate carries the columns a claim transition may change.
type ClaimUpdate struct {
	Slot             *string
	ExecutionService *string
	ExecutionID      *uuid.UUID
	// BumpFencing mints a fresh fencing token for the transition: promotion
	// bumps it so a stale execution cannot couple to the promoted claim.
	BumpFencing bool
}

// TransitionClaim moves a claim, refusing anything the mpClaim machine does
// not allow, conditionally on the state it was read in. A promotion that races
// a fresh award into the freed slot loses to the partial unique index and is
// reported as errSlotOccupied.
func (s *Store) TransitionClaim(ctx context.Context, tx pgx.Tx, claim *Claim, to string, update ClaimUpdate) (*Claim, error) {
	if err := machine.Assert(machine.MpClaim, claim.State, to); err != nil {
		allowed, _ := machine.Allowed(machine.MpClaim, claim.State)
		return nil, domain.Errorf(domain.CodeIllegalTransition, "a claim cannot move from %s to %s", claim.State, to).
			WithDetails(map[string]any{"from": claim.State, "to": to, "allowed": allowed}).
			Wrap(err)
	}
	fencing := "fencing_token"
	if update.BumpFencing {
		fencing = "nextval('mp.claim_fencing_seq')"
	}
	row := tx.QueryRow(ctx, `
		UPDATE mp.driver_claims SET
			state = $3,
			slot = COALESCE($4, slot),
			execution_service = COALESCE($5, execution_service),
			execution_id = COALESCE($6, execution_id),
			fencing_token = `+fencing+`,
			updated_at = now()
		WHERE id = $1 AND state = $2
		RETURNING `+claimColumns,
		claim.ID, claim.State, to,
		update.Slot, update.ExecutionService, update.ExecutionID,
	)
	moved, err := scanClaim(row)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the claim changed while this call was in flight").
			WithDetails(map[string]any{"claimId": claim.ID.String(), "expectedState": claim.State})
	}
	if err != nil && (isUniqueViolation(err, "claims_one_current_per_driver") || isUniqueViolation(err, "claims_one_next_per_driver")) {
		return nil, errSlotOccupied
	}
	return moved, err
}

func (s *Store) claimList(ctx context.Context, db DB, query string, args ...any) ([]*Claim, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list driver claims: %w", err)
	}
	defer rows.Close()
	var claims []*Claim
	for rows.Next() {
		claim, err := scanClaim(rows)
		if err != nil {
			return nil, err
		}
		claims = append(claims, claim)
	}
	return claims, rows.Err()
}

// CurrentClaimsWithTerminalExecution lists CURRENT claims whose execution ride
// is no longer active: the durable backstop for a missed completion callback.
func (s *Store) CurrentClaimsWithTerminalExecution(ctx context.Context, db DB, limit int) ([]*Claim, error) {
	return s.claimList(ctx, db, `
		SELECT `+claimColumns+` FROM mp.driver_claims c
		WHERE c.state = $1 AND c.execution_id IS NOT NULL
			AND EXISTS (
				SELECT 1 FROM ride.rides r WHERE r.id = c.execution_id AND NOT r.active
			)
		ORDER BY c.updated_at ASC
		LIMIT $2`, machine.MpClaimCurrent, limit)
}

// PromotableNextClaims lists NEXT claims whose dependency has finished (or was
// released): the durable side of exactly-once promotion.
func (s *Store) PromotableNextClaims(ctx context.Context, db DB, limit int) ([]*Claim, error) {
	return s.claimList(ctx, db, `
		SELECT `+claimColumns+` FROM mp.driver_claims c
		WHERE c.state = $1 AND (
			c.depends_on_claim_id IS NULL
			OR EXISTS (
				SELECT 1 FROM mp.driver_claims d
				WHERE d.id = c.depends_on_claim_id AND d.state = ANY($2)
			)
		)
		ORDER BY c.updated_at ASC
		LIMIT $3`, machine.MpClaimNext,
		[]string{machine.MpClaimCompleted, machine.MpClaimReleased}, limit)
}

// QueuedNextClaims lists NEXT claims still waiting behind a live dependency —
// the queued awards whose pickup window the sweep keeps honest.
func (s *Store) QueuedNextClaims(ctx context.Context, db DB, limit int) ([]*Claim, error) {
	return s.claimList(ctx, db, `
		SELECT `+claimColumns+` FROM mp.driver_claims c
		WHERE c.state = $1 AND c.award_id IS NOT NULL
		ORDER BY c.updated_at ASC
		LIMIT $2`, machine.MpClaimNext, limit)
}

// NextClaimsWithOfflineDriver lists NEXT claims whose driver has gone offline
// or vanished: queued work that can no longer be silently owed.
func (s *Store) NextClaimsWithOfflineDriver(ctx context.Context, db DB, limit int) ([]*Claim, error) {
	return s.claimList(ctx, db, `
		SELECT `+claimColumns+` FROM mp.driver_claims c
		WHERE c.state = $1 AND NOT EXISTS (
			SELECT 1 FROM ride.driver_sessions s
			WHERE s.driver_id = c.driver_id AND s.state <> 'offline'
		)
		ORDER BY c.updated_at ASC
		LIMIT $2`, machine.MpClaimNext, limit)
}

// LiveBidsForDriverInSlot lists a driver's other live bids competing for the
// same capacity slot, excluding one request: the bids a win invalidates.
func (s *Store) LiveBidsForDriverInSlot(ctx context.Context, db DB, driverID uuid.UUID, slot string, excludeRequest uuid.UUID) ([]*Bid, error) {
	return s.bidList(ctx, db, `
		SELECT `+bidColumns+` FROM mp.bids
		WHERE driver_id = $1 AND slot = $2 AND request_id <> $3 AND state = ANY($4)
		ORDER BY created_at ASC`,
		driverID, slot, excludeRequest, machine.MpBidLiveStates())
}
