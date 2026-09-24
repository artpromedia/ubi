package marketplace

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// CursorFor exposes the package's keyset cursor codec to tests that page
// through a Store list method directly rather than through the HTTP layer
// (which reads nextCursor off the JSON response body).
func CursorFor(createdAt time.Time, id uuid.UUID) string { return encodeCursor(createdAt, id) }

// ---------------------------------------------------------------------------
// C08: admin resolution read models (pending sagas, recoveries,
// cancellations, driver standing) and the driver standing/appeals aggregate.
// Every list here is paginated; nothing here is invented — each row is read
// straight from a table another slice already writes.
// ---------------------------------------------------------------------------

// PendingAwardRow is one award stuck in `award_pending`, with its saga
// position, for the stuck-saga board.
type PendingAwardRow struct {
	AwardID      uuid.UUID
	RequestID    uuid.UUID
	DriverID     uuid.UUID
	CityID       string
	Step         string
	AttemptState string
	Attempts     int
	LastError    string
	NextRetryAt  *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time

	// FundingSource is who funds the award (FundingSource*): its funding
	// step reserves the organization's budget on a business award.
	FundingSource string
}

// PendingAwards lists awards in `pending`, oldest first (the most urgent),
// joined with their saga position when one has been recorded.
func (s *Store) PendingAwards(ctx context.Context, db DB, cityID, cursor string, limit int) ([]*PendingAwardRow, error) {
	query := `
		SELECT a.id, a.request_id, a.driver_id, r.city_id,
			CASE WHEN EXISTS (SELECT 1 FROM mp.business_bookings b WHERE b.award_id = a.id) THEN $3
				WHEN r.payment_method_id = 'cash' THEN $4 ELSE $5 END,
			COALESCE(t.step, ''), COALESCE(t.state, ''), COALESCE(t.attempts, 0),
			COALESCE(t.last_error, ''), t.next_retry_at, a.created_at, a.updated_at
		FROM mp.awards a
		JOIN mp.requests r ON r.id = a.request_id
		LEFT JOIN mp.award_attempts t ON t.award_id = a.id
		WHERE a.state = $1 AND ($2 = '' OR r.city_id = $2)`
	args := []any{machine.MpAwardPending, cityID, FundingSourceBusiness, FundingSourceCash, FundingSourceRider}
	if cursor != "" {
		at, id, err := decodeCursor(cursor)
		if err != nil {
			return nil, domain.Errorf(domain.CodeValidationFailed, "that is not a pending-saga cursor")
		}
		query += fmt.Sprintf(` AND (a.created_at, a.id) > ($%d, $%d)`, len(args)+1, len(args)+2)
		args = append(args, at, id)
	}
	query += fmt.Sprintf(` ORDER BY a.created_at ASC, a.id ASC LIMIT %d`, limit)

	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list pending awards: %w", err)
	}
	defer rows.Close()
	var out []*PendingAwardRow
	for rows.Next() {
		var row PendingAwardRow
		if err := rows.Scan(&row.AwardID, &row.RequestID, &row.DriverID, &row.CityID, &row.FundingSource,
			&row.Step, &row.AttemptState, &row.Attempts, &row.LastError, &row.NextRetryAt,
			&row.CreatedAt, &row.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to read pending award row: %w", err)
		}
		out = append(out, &row)
	}
	return out, rows.Err()
}

// recoveryCurrencySQL derives a recovery row's currency (alias rr) from what
// it names: its bid's request, a settlement's or replayed reserve's own
// money, or the award its payload names — ” only when nothing names one.
const recoveryCurrencySQL = `COALESCE(
			(SELECT q.currency FROM mp.bids b JOIN mp.requests q ON q.id = b.request_id WHERE b.id = rr.bid_id),
			rr.payload->'fareMinor'->>'currency',
			rr.payload->'reserve'->'amountMinor'->>'currency',
			(SELECT q.currency FROM mp.awards a JOIN mp.requests q ON q.id = a.request_id
				WHERE a.id::text = rr.payload->>'awardId'),
			'')`

// RecoveryByID reads one recovery row for the admin retry command's preview
// and its optimistic-concurrency check.
func (s *Store) RecoveryByID(ctx context.Context, db DB, id uuid.UUID) (*RecoveryRow, error) {
	var row RecoveryRow
	err := db.QueryRow(ctx, `
		SELECT id, reservation_id, driver_id, bid_id, action, amount_minor, payload,
			attempts, COALESCE(last_error, ''), next_retry_at, resolved_at, created_at, `+recoveryCurrencySQL+`
		FROM mp.reservation_recovery rr WHERE id = $1`, id).Scan(
		&row.ID, &row.ReservationID, &row.DriverID, &row.BidID, &row.Action,
		&row.AmountMinor, &row.Payload, &row.Attempts, &row.LastError, &row.NextRetryAt,
		&row.ResolvedAt, &row.CreatedAt, &row.Currency)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read recovery row %s: %w", id, err)
	}
	return &row, nil
}

// ListRecoveries lists unresolved recovery rows, oldest first, for the
// stuck-saga & failed-reservation-recovery board. An empty action filters
// nothing.
func (s *Store) ListRecoveries(ctx context.Context, db DB, action, cursor string, limit int) ([]*RecoveryRow, error) {
	query := `
		SELECT id, reservation_id, driver_id, bid_id, action, amount_minor, payload,
			attempts, COALESCE(last_error, ''), next_retry_at, resolved_at, created_at, ` + recoveryCurrencySQL + `
		FROM mp.reservation_recovery rr
		WHERE resolved_at IS NULL AND ($1 = '' OR action = $1)`
	args := []any{action}
	if cursor != "" {
		at, id, err := decodeCursor(cursor)
		if err != nil {
			return nil, domain.Errorf(domain.CodeValidationFailed, "that is not a recovery cursor")
		}
		query += fmt.Sprintf(` AND (created_at, id) > ($%d, $%d)`, len(args)+1, len(args)+2)
		args = append(args, at, id)
	}
	query += fmt.Sprintf(` ORDER BY created_at ASC, id ASC LIMIT %d`, limit)

	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list recoveries: %w", err)
	}
	defer rows.Close()
	var out []*RecoveryRow
	for rows.Next() {
		var row RecoveryRow
		if err := rows.Scan(&row.ID, &row.ReservationID, &row.DriverID, &row.BidID, &row.Action,
			&row.AmountMinor, &row.Payload, &row.Attempts, &row.LastError, &row.NextRetryAt,
			&row.ResolvedAt, &row.CreatedAt, &row.Currency); err != nil {
			return nil, fmt.Errorf("failed to read recovery row: %w", err)
		}
		out = append(out, &row)
	}
	return out, rows.Err()
}

// CancellationRow is one marketplace-managed ride that ended in a
// cancellation or a no-show (the cancellations/no-shows board).
type CancellationRow struct {
	RideID     uuid.UUID
	AwardID    *uuid.UUID
	RequestID  *uuid.UUID
	CityID     string
	DriverID   *uuid.UUID
	RiderID    uuid.UUID
	State      string
	ReasonCode string
	At         time.Time
}

// cancellationStates is the closed set of ride.rides terminal states this
// board renders — never any state outside it.
var cancellationStates = []string{
	machine.RiderCancelledByDriver,
	machine.RiderCancelledByRider,
	machine.RiderNoShow,
}

// ListCancellations lists marketplace-managed rides that ended cancelled or
// no-show, newest first. A nil driverID means "every driver".
func (s *Store) ListCancellations(ctx context.Context, db DB, cityID string, driverID *uuid.UUID, cursor string, limit int) ([]*CancellationRow, error) {
	query := `
		SELECT rr.id, rr.marketplace_award_id, aw.request_id, rr.city_id, rr.driver_id, rr.rider_id,
			rr.state, COALESCE(rr.cancel_reason_code, ''), COALESCE(rr.cancelled_at, rr.updated_at)
		FROM ride.rides rr
		LEFT JOIN mp.awards aw ON aw.id = rr.marketplace_award_id
		WHERE rr.marketplace_award_id IS NOT NULL
			AND rr.state = ANY($1)
			AND ($2 = '' OR rr.city_id = $2)
			AND ($3::uuid IS NULL OR rr.driver_id = $3)`
	args := []any{cancellationStates, cityID, driverID}
	if cursor != "" {
		at, id, err := decodeCursor(cursor)
		if err != nil {
			return nil, domain.Errorf(domain.CodeValidationFailed, "that is not a cancellations cursor")
		}
		query += fmt.Sprintf(` AND (COALESCE(rr.cancelled_at, rr.updated_at), rr.id) < ($%d, $%d)`, len(args)+1, len(args)+2)
		args = append(args, at, id)
	}
	query += fmt.Sprintf(` ORDER BY COALESCE(rr.cancelled_at, rr.updated_at) DESC, rr.id DESC LIMIT %d`, limit)

	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list cancellations: %w", err)
	}
	defer rows.Close()
	var out []*CancellationRow
	for rows.Next() {
		var row CancellationRow
		if err := rows.Scan(&row.RideID, &row.AwardID, &row.RequestID, &row.CityID, &row.DriverID,
			&row.RiderID, &row.State, &row.ReasonCode, &row.At); err != nil {
			return nil, fmt.Errorf("failed to read cancellation row: %w", err)
		}
		out = append(out, &row)
	}
	return out, rows.Err()
}

// DriverAggregate is one driver's completion/cancellation/no-show counts
// over a trailing window — the real, computed input to standing decisions
// and to the A06 repeated-cancellation pattern the abuse addendum named as
// missing.
type DriverAggregate struct {
	DriverID            uuid.UUID
	CityID              string
	WindowDays          int
	Total               int
	Completions         int
	DriverCancellations int
	RiderCancellations  int
	NoShows             int
}

// CancellationRate is (driver cancellations + no-shows) / total, the pattern
// signal — 0 when there is no sample yet.
func (a DriverAggregate) CancellationRate() float64 {
	if a.Total == 0 {
		return 0
	}
	return float64(a.DriverCancellations+a.NoShows) / float64(a.Total)
}

// DriverStandingAggregate computes one driver's window aggregate.
func (s *Store) DriverStandingAggregate(ctx context.Context, db DB, driverID uuid.UUID, windowDays int) (*DriverAggregate, error) {
	agg := &DriverAggregate{DriverID: driverID, WindowDays: windowDays}
	since := time.Now().UTC().AddDate(0, 0, -windowDays)
	err := db.QueryRow(ctx, `
		SELECT COALESCE(MAX(city_id), ''),
			COUNT(*) FILTER (WHERE state = $2),
			COUNT(*) FILTER (WHERE state = $3),
			COUNT(*) FILTER (WHERE state = $4),
			COUNT(*) FILTER (WHERE state = $5),
			COUNT(*)
		FROM ride.rides
		WHERE marketplace_award_id IS NOT NULL AND driver_id = $1 AND created_at >= $6`,
		driverID, machine.RiderCompleted, machine.RiderCancelledByDriver,
		machine.RiderCancelledByRider, machine.RiderNoShow, since).Scan(
		&agg.CityID, &agg.Completions, &agg.DriverCancellations, &agg.RiderCancellations,
		&agg.NoShows, &agg.Total)
	if err != nil {
		return nil, fmt.Errorf("failed to aggregate driver standing for %s: %w", driverID, err)
	}
	return agg, nil
}

// DriverStandingListRow is one row of the flagged-drivers board.
type DriverStandingListRow struct {
	DriverAggregate
}

// ListDriverStanding lists drivers whose trailing-window sample meets
// minRides, worst cancellation rate first — the real pattern-detection read
// the abuse addendum (A06) named as missing. Pagination is offset-based: the
// underlying query is a GROUP BY aggregate, not a keyset-ordered table.
func (s *Store) ListDriverStanding(ctx context.Context, db DB, cityID string, windowDays, minRides, limit, offset int) ([]*DriverStandingListRow, int, error) {
	since := time.Now().UTC().AddDate(0, 0, -windowDays)
	countQuery := `
		SELECT COUNT(*) FROM (
			SELECT driver_id FROM ride.rides
			WHERE marketplace_award_id IS NOT NULL AND driver_id IS NOT NULL
				AND created_at >= $1 AND ($2 = '' OR city_id = $2)
			GROUP BY driver_id, city_id
			HAVING COUNT(*) >= $3
		) matched`
	var total int
	if err := db.QueryRow(ctx, countQuery, since, cityID, minRides).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("failed to count flagged drivers: %w", err)
	}

	query := `
		SELECT driver_id, city_id,
			COUNT(*) FILTER (WHERE state = $4) AS completions,
			COUNT(*) FILTER (WHERE state = $5) AS driver_cancellations,
			COUNT(*) FILTER (WHERE state = $6) AS rider_cancellations,
			COUNT(*) FILTER (WHERE state = $7) AS no_shows,
			COUNT(*) AS total
		FROM ride.rides
		WHERE marketplace_award_id IS NOT NULL AND driver_id IS NOT NULL
			AND created_at >= $1 AND ($2 = '' OR city_id = $2)
		GROUP BY driver_id, city_id
		HAVING COUNT(*) >= $3
		ORDER BY
			(COUNT(*) FILTER (WHERE state IN ($5, $7)))::float8 / COUNT(*) DESC,
			total DESC
		LIMIT $8 OFFSET $9`
	rows, err := db.Query(ctx, query, since, cityID, minRides,
		machine.RiderCompleted, machine.RiderCancelledByDriver, machine.RiderCancelledByRider,
		machine.RiderNoShow, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list driver standing: %w", err)
	}
	defer rows.Close()
	var out []*DriverStandingListRow
	for rows.Next() {
		var row DriverStandingListRow
		row.WindowDays = windowDays
		if err := rows.Scan(&row.DriverID, &row.CityID, &row.Completions, &row.DriverCancellations,
			&row.RiderCancellations, &row.NoShows, &row.Total); err != nil {
			return nil, 0, fmt.Errorf("failed to read driver standing row: %w", err)
		}
		out = append(out, &row)
	}
	return out, total, rows.Err()
}

// ExecutionRideSummary is the admin-facing slice of ride.rides the unified
// resolution view needs — more than ExecutionRideRow carries (that one only
// serves eligibility routing).
type ExecutionRideSummary struct {
	RideID           uuid.UUID
	State            string
	DriverID         *uuid.UUID
	Active           bool
	AssignedAt       *time.Time
	ArrivedAt        *time.Time
	StartedAt        *time.Time
	CompletedAt      *time.Time
	CancelledAt      *time.Time
	CancelledByRole  string
	CancelReasonCode string
	FinalFareMinor   *int64
}

// ExecutionRideSummary reads the admin view of one execution ride.
func (s *Store) ExecutionRideSummary(ctx context.Context, db DB, rideID uuid.UUID) (*ExecutionRideSummary, error) {
	var row ExecutionRideSummary
	err := db.QueryRow(ctx, `
		SELECT id, state, driver_id, active, assigned_at, arrived_at, started_at, completed_at,
			cancelled_at, COALESCE(cancelled_by_role, ''), COALESCE(cancel_reason_code, ''), final_fare_minor
		FROM ride.rides WHERE id = $1`, rideID).Scan(
		&row.RideID, &row.State, &row.DriverID, &row.Active, &row.AssignedAt, &row.ArrivedAt, &row.StartedAt,
		&row.CompletedAt, &row.CancelledAt, &row.CancelledByRole, &row.CancelReasonCode, &row.FinalFareMinor)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read execution ride summary %s: %w", rideID, err)
	}
	return &row, nil
}

// RecoveriesForBid lists every recovery row tied to a bid — resolved or not,
// oldest first — the money-recovery history for the resolution view.
func (s *Store) RecoveriesForBid(ctx context.Context, db DB, bidID uuid.UUID) ([]*RecoveryRow, error) {
	rows, err := db.Query(ctx, `
		SELECT id, reservation_id, driver_id, bid_id, action, amount_minor, payload,
			attempts, COALESCE(last_error, ''), next_retry_at, resolved_at, created_at, `+recoveryCurrencySQL+`
		FROM mp.reservation_recovery rr WHERE bid_id = $1 ORDER BY created_at ASC`, bidID)
	if err != nil {
		return nil, fmt.Errorf("failed to list recoveries for bid %s: %w", bidID, err)
	}
	defer rows.Close()
	var out []*RecoveryRow
	for rows.Next() {
		var row RecoveryRow
		if err := rows.Scan(&row.ID, &row.ReservationID, &row.DriverID, &row.BidID, &row.Action,
			&row.AmountMinor, &row.Payload, &row.Attempts, &row.LastError, &row.NextRetryAt,
			&row.ResolvedAt, &row.CreatedAt, &row.Currency); err != nil {
			return nil, fmt.Errorf("failed to read recovery row: %w", err)
		}
		out = append(out, &row)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Standing actions & appeals: maker-checker admin workflow state.
// ---------------------------------------------------------------------------

// Standing action types and statuses (mp.driver_standing_actions).
const (
	StandingActionWarning       = "warning"
	StandingActionSuspension    = "suspension"
	StandingActionReinstatement = "reinstatement"

	StandingStatusPendingApproval = "pending_approval"
	StandingStatusActive          = "active"
	StandingStatusRejected        = "rejected"
	StandingStatusAppealed        = "appealed"
	StandingStatusAppealUpheld    = "appeal_upheld"
	StandingStatusAppealDenied    = "appeal_denied"
)

// protectedStandingActions require a second, distinct operator's approval
// before they take effect. A warning is informational and commits at once.
func isProtectedStandingAction(actionType string) bool {
	return actionType == StandingActionSuspension || actionType == StandingActionReinstatement
}

// StandingAction is one row of mp.driver_standing_actions.
type StandingAction struct {
	ID              uuid.UUID
	DriverID        uuid.UUID
	CityID          string
	ActionType      string
	ReasonCode      string
	ReasonNote      string
	Status          string
	ProposedBy      uuid.UUID
	ProposedAt      time.Time
	DecidedBy       *uuid.UUID
	DecidedAt       *time.Time
	DecisionReason  string
	AppealedBy      *uuid.UUID
	AppealedAt      *time.Time
	AppealNote      string
	AppealDecidedBy *uuid.UUID
	AppealDecidedAt *time.Time
	AppealReason    string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

const standingColumns = `
	id, driver_id, city_id, action_type, reason_code, COALESCE(reason_note, ''), status,
	proposed_by, proposed_at, decided_by, decided_at, COALESCE(decision_reason, ''),
	appealed_by, appealed_at, COALESCE(appeal_note, ''),
	appeal_decided_by, appeal_decided_at, COALESCE(appeal_reason, ''),
	created_at, updated_at`

func scanStandingAction(row pgx.Row) (*StandingAction, error) {
	var a StandingAction
	err := row.Scan(
		&a.ID, &a.DriverID, &a.CityID, &a.ActionType, &a.ReasonCode, &a.ReasonNote, &a.Status,
		&a.ProposedBy, &a.ProposedAt, &a.DecidedBy, &a.DecidedAt, &a.DecisionReason,
		&a.AppealedBy, &a.AppealedAt, &a.AppealNote,
		&a.AppealDecidedBy, &a.AppealDecidedAt, &a.AppealReason,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read standing action: %w", err)
	}
	return &a, nil
}

// InsertStandingAction writes a new proposal.
func (s *Store) InsertStandingAction(ctx context.Context, db DB, a *StandingAction) error {
	_, err := db.Exec(ctx, `
		INSERT INTO mp.driver_standing_actions (
			id, driver_id, city_id, action_type, reason_code, reason_note, status,
			proposed_by, decided_by, decided_at, decision_reason
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		a.ID, a.DriverID, a.CityID, a.ActionType, a.ReasonCode, a.ReasonNote, a.Status,
		a.ProposedBy, a.DecidedBy, a.DecidedAt, nullable(a.DecisionReason))
	if err != nil {
		return fmt.Errorf("failed to insert standing action: %w", err)
	}
	return nil
}

// StandingActionByID reads one row, unlocked.
func (s *Store) StandingActionByID(ctx context.Context, db DB, id uuid.UUID) (*StandingAction, error) {
	return scanStandingAction(db.QueryRow(ctx, `SELECT `+standingColumns+` FROM mp.driver_standing_actions WHERE id = $1`, id))
}

// StandingActionForUpdate reads and locks one row for the rest of the
// transaction — every status transition below reads through this.
func (s *Store) StandingActionForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*StandingAction, error) {
	return scanStandingAction(tx.QueryRow(ctx, `SELECT `+standingColumns+` FROM mp.driver_standing_actions WHERE id = $1 FOR UPDATE`, id))
}

// DecideStandingAction records an approval or a rejection.
func (s *Store) DecideStandingAction(ctx context.Context, tx pgx.Tx, id uuid.UUID, status string, decidedBy uuid.UUID, decidedAt time.Time, reason string) error {
	_, err := tx.Exec(ctx, `
		UPDATE mp.driver_standing_actions
		SET status = $2, decided_by = $3, decided_at = $4, decision_reason = $5, updated_at = $4
		WHERE id = $1`, id, status, decidedBy, decidedAt, nullable(reason))
	if err != nil {
		return fmt.Errorf("failed to decide standing action %s: %w", id, err)
	}
	return nil
}

// FileStandingAppeal records that an active standing action was appealed.
func (s *Store) FileStandingAppeal(ctx context.Context, tx pgx.Tx, id uuid.UUID, appealedBy uuid.UUID, appealedAt time.Time, note string) error {
	_, err := tx.Exec(ctx, `
		UPDATE mp.driver_standing_actions
		SET status = $2, appealed_by = $3, appealed_at = $4, appeal_note = $5, updated_at = $4
		WHERE id = $1`, id, StandingStatusAppealed, appealedBy, appealedAt, nullable(note))
	if err != nil {
		return fmt.Errorf("failed to file appeal for standing action %s: %w", id, err)
	}
	return nil
}

// DecideStandingAppeal records the appeal outcome.
func (s *Store) DecideStandingAppeal(ctx context.Context, tx pgx.Tx, id uuid.UUID, status string, decidedBy uuid.UUID, decidedAt time.Time, reason string) error {
	_, err := tx.Exec(ctx, `
		UPDATE mp.driver_standing_actions
		SET status = $2, appeal_decided_by = $3, appeal_decided_at = $4, appeal_reason = $5, updated_at = $4
		WHERE id = $1`, id, status, decidedBy, decidedAt, nullable(reason))
	if err != nil {
		return fmt.Errorf("failed to decide appeal for standing action %s: %w", id, err)
	}
	return nil
}

// ListStandingActions lists a driver's standing history, newest first, or —
// when driverID is nil — the review queue for a given status.
func (s *Store) ListStandingActions(ctx context.Context, db DB, driverID *uuid.UUID, status, cursor string, limit int) ([]*StandingAction, error) {
	query := `SELECT ` + standingColumns + ` FROM mp.driver_standing_actions WHERE ($1::uuid IS NULL OR driver_id = $1) AND ($2 = '' OR status = $2)`
	args := []any{driverID, status}
	if cursor != "" {
		at, id, err := decodeCursor(cursor)
		if err != nil {
			return nil, domain.Errorf(domain.CodeValidationFailed, "that is not a standing-action cursor")
		}
		query += fmt.Sprintf(` AND (created_at, id) < ($%d, $%d)`, len(args)+1, len(args)+2)
		args = append(args, at, id)
	}
	query += fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT %d`, limit)

	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list standing actions: %w", err)
	}
	defer rows.Close()
	var out []*StandingAction
	for rows.Next() {
		a, err := scanStandingAction(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// LatestEffectiveStanding returns the most recent suspension/reinstatement
// row still in effect for a driver — domain.ErrNotFound when none is. Only
// this row decides whether EvaluateEligibility blocks the driver: the most
// recent effective row always wins over an older one, so a suspension
// overturned on appeal (appeal_upheld, excluded here) or superseded by a
// later reinstatement stops blocking without any row being deleted or
// hand-edited.
func (s *Store) LatestEffectiveStanding(ctx context.Context, db DB, driverID uuid.UUID) (*StandingAction, error) {
	return scanStandingAction(db.QueryRow(ctx, `
		SELECT `+standingColumns+`
		FROM mp.driver_standing_actions
		WHERE driver_id = $1
			AND action_type IN ($2, $3)
			AND status IN ($4, $5, $6)
		ORDER BY created_at DESC, id DESC
		LIMIT 1`,
		driverID, StandingActionSuspension, StandingActionReinstatement,
		StandingStatusActive, StandingStatusAppealed, StandingStatusAppealDenied))
}
