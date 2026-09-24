package marketplace

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// C08 — admin resolution, standing and appeals.
//
// Every read here is paginated and reads a table another slice already
// writes; nothing is invented. Every mutation is a bounded, idempotent
// command: it validates an Idempotency-Key, checks an optimistic-concurrency
// expectation the caller must have just read, writes exactly one audit row
// with its effect (or none, on a preview), and never edits a table directly
// outside these guarded paths. No command here can move money — recovery
// retry and award reconciliation only ask the SAME wallet/payment ports the
// engine itself uses to converge, under the SAME idempotency keys.

// Who funds an award (PendingSagaView.fundingSource).
const (
	FundingSourceBusiness = "business"
	FundingSourceRider    = "rider"
	FundingSourceCash     = "cash"
)

func requireAdmin(actor Actor, verb string) error {
	if actor.Role != move.RoleAdmin {
		return domain.Errorf(domain.CodeForbidden, "only an operator can %s", verb)
	}
	return nil
}

func ageSec(now, at time.Time) int64 {
	d := now.Sub(at)
	if d < 0 {
		return 0
	}
	return int64(d.Seconds())
}

// ---------------------------------------------------------------------------
// Stuck-saga board (A: pending-saga age)
// ---------------------------------------------------------------------------

// PendingSagaView is one award stuck in `award_pending`.
type PendingSagaView struct {
	AwardID      string     `json:"awardId"`
	RequestID    string     `json:"requestId"`
	DriverID     string     `json:"driverId"`
	CityID       string     `json:"cityId"`
	Step         string     `json:"step"`
	AttemptState string     `json:"attemptState"`
	Attempts     int        `json:"attempts"`
	LastError    string     `json:"lastError,omitempty"`
	AgeSec       int64      `json:"ageSec"`
	NextRetryAt  *time.Time `json:"nextRetryAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`

	// FundingSource marks who funds the award (business | rider | cash): on
	// a business award the funding step is the organization budget's
	// reserve (business:<awardId>:reserve), never rider funding.
	FundingSource string `json:"fundingSource"`
}

// PendingSagasPage answers GET /v1/admin/mp/pending-sagas.
type PendingSagasPage struct {
	Rows       []*PendingSagaView `json:"rows"`
	NextCursor *string            `json:"nextCursor,omitempty"`
}

// AdminPendingSagas lists awards stuck in `award_pending`, oldest (most
// urgent) first. Read-only — the RUNBOOK is explicit that a stuck saga is
// never reopened; the paired command is AdminReconcileAward, which only ever
// re-polls the SAME saga step the sweep itself would resume.
func (s *Service) AdminPendingSagas(ctx context.Context, actor Actor, cityID, cursor string) (*PendingSagasPage, error) {
	if err := requireAdmin(actor, "read the stuck-saga board"); err != nil {
		return nil, err
	}
	rows, err := s.deps.Store.PendingAwards(ctx, s.deps.Store.Pool(), cityID, cursor, feedPageSize)
	if err != nil {
		return nil, asDomainError(err)
	}
	now := s.now()
	page := &PendingSagasPage{Rows: []*PendingSagaView{}}
	for _, row := range rows {
		page.Rows = append(page.Rows, &PendingSagaView{
			AwardID: row.AwardID.String(), RequestID: row.RequestID.String(), DriverID: row.DriverID.String(),
			CityID: row.CityID, FundingSource: row.FundingSource,
			Step: row.Step, AttemptState: row.AttemptState, Attempts: row.Attempts,
			LastError: row.LastError, AgeSec: ageSec(now, row.CreatedAt), NextRetryAt: row.NextRetryAt,
			CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		})
	}
	if len(rows) == feedPageSize {
		last := rows[len(rows)-1]
		next := encodeCursor(last.CreatedAt, last.AwardID)
		page.NextCursor = &next
	}
	return page, nil
}

// ReconcileAwardRequest is the body of
// POST /v1/admin/mp/awards/{awardId}/reconcile.
type ReconcileAwardRequest struct {
	// DryRun previews the award's current position without touching it.
	DryRun bool `json:"dryRun"`
	// ExpectedUpdatedAt is the award's `updatedAt` the operator last saw — the
	// optimistic-concurrency guard. Required to apply.
	ExpectedUpdatedAt *time.Time `json:"expectedUpdatedAt,omitempty"`
}

// ReconcileAwardResult answers both modes.
type ReconcileAwardResult struct {
	AwardID     string    `json:"awardId"`
	DryRun      bool      `json:"dryRun"`
	BeforeState string    `json:"beforeState"`
	AfterState  string    `json:"afterState"`
	Outcome     string    `json:"outcome"` // preview | resolved | unresolved
	Detail      string    `json:"detail,omitempty"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// AdminReconcileAward asks the engine to advance ONE stuck award's saga
// right now — the exact same step the reconciliation sweep would take,
// invoked on demand. It never skips a step, never reopens a resolved award
// (advanceAward is a no-op once the award has left `pending`) and never
// touches money directly: it only asks the wallet/funding/settlement ports
// the award saga already uses, under their existing per-award idempotency
// keys, so calling it twice can never double-capture or double-reverse.
func (s *Service) AdminReconcileAward(ctx context.Context, actor Actor, awardID uuid.UUID, req ReconcileAwardRequest, idempotencyKey string) (*ReconcileAwardResult, int, error) {
	if err := requireAdmin(actor, "reconcile a marketplace award"); err != nil {
		return nil, 0, err
	}
	award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), awardID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}

	if req.DryRun {
		return &ReconcileAwardResult{
			AwardID: award.ID.String(), DryRun: true,
			BeforeState: award.State, AfterState: award.State,
			Outcome: "preview", UpdatedAt: award.UpdatedAt,
		}, 200, nil
	}

	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeAdminAwardReconcile, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var response ReconcileAwardResult
		if err := decodeJSON(replay.Response, &response); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &response, replay.StatusCode, nil
	}
	if req.ExpectedUpdatedAt == nil {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "expectedUpdatedAt is required to apply a reconcile")
	}
	if !award.UpdatedAt.Equal(*req.ExpectedUpdatedAt) {
		return nil, 0, domain.Errorf(domain.CodeVersionConflict,
			"this award changed since you last read it (updatedAt now %s) — reload and retry",
			award.UpdatedAt.Format(time.RFC3339Nano))
	}

	before := award.State
	updated, _, advErr := s.advanceAward(ctx, awardID)
	if updated == nil {
		return nil, 0, asDomainError(advErr)
	}
	outcome := "unresolved"
	detail := ""
	switch {
	case advErr != nil:
		detail = advErr.Error()
	case updated.State != machine.MpAwardPending:
		outcome = "resolved"
	}

	response := &ReconcileAwardResult{
		AwardID: updated.ID.String(), DryRun: false,
		BeforeState: before, AfterState: updated.State,
		Outcome: outcome, Detail: detail, UpdatedAt: updated.UpdatedAt,
	}
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role,
			Action: "mp.admin.award_reconcile", SubjectType: subjectAward, SubjectID: updated.ID.String(),
			Before: map[string]any{"state": before},
			After:  map[string]any{"state": updated.State, "outcome": outcome},
			Reason: "operator-triggered saga reconciliation",
		}); err != nil {
			return err
		}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeAdminAwardReconcile, actor.UserID, idempotencyKey, req, 200, response)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return response, 200, nil
}

// ---------------------------------------------------------------------------
// Failed reservation-recovery board
// ---------------------------------------------------------------------------

// RecoveryView is one unresolved reservation-recovery row.
type RecoveryView struct {
	ID            string     `json:"id"`
	Action        string     `json:"action"`
	DriverID      string     `json:"driverId"`
	BidID         *string    `json:"bidId,omitempty"`
	ReservationID string     `json:"reservationId"`
	AmountMinor   *int64     `json:"amountMinor,omitempty"`
	Attempts      int        `json:"attempts"`
	LastError     string     `json:"lastError,omitempty"`
	AgeSec        int64      `json:"ageSec"`
	NextRetryAt   time.Time  `json:"nextRetryAt"`
	ResolvedAt    *time.Time `json:"resolvedAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`

	// Currency is AmountMinor's (and the row's money's) currency, derived
	// from what the row names; absent only when nothing names one.
	Currency string `json:"currency,omitempty"`
}

// RecoveriesPage answers GET /v1/admin/mp/recoveries.
type RecoveriesPage struct {
	Rows       []*RecoveryView `json:"rows"`
	NextCursor *string         `json:"nextCursor,omitempty"`
}

func toRecoveryView(row *RecoveryRow, now time.Time) *RecoveryView {
	var bidID *string
	if row.BidID != nil {
		s := row.BidID.String()
		bidID = &s
	}
	return &RecoveryView{
		ID: row.ID.String(), Action: row.Action, DriverID: row.DriverID.String(), BidID: bidID,
		ReservationID: row.ReservationID, AmountMinor: row.AmountMinor, Currency: row.Currency, Attempts: row.Attempts,
		LastError: row.LastError, AgeSec: ageSec(now, row.CreatedAt), NextRetryAt: row.NextRetryAt,
		ResolvedAt: row.ResolvedAt, CreatedAt: row.CreatedAt,
	}
}

// AdminRecoveries lists unresolved reservation-recovery rows, oldest first.
func (s *Service) AdminRecoveries(ctx context.Context, actor Actor, action, cursor string) (*RecoveriesPage, error) {
	if err := requireAdmin(actor, "read the reservation-recovery board"); err != nil {
		return nil, err
	}
	rows, err := s.deps.Store.ListRecoveries(ctx, s.deps.Store.Pool(), action, cursor, feedPageSize)
	if err != nil {
		return nil, asDomainError(err)
	}
	now := s.now()
	page := &RecoveriesPage{Rows: []*RecoveryView{}}
	for _, row := range rows {
		page.Rows = append(page.Rows, toRecoveryView(row, now))
	}
	if len(rows) == feedPageSize {
		last := rows[len(rows)-1]
		next := encodeCursor(last.CreatedAt, last.ID)
		page.NextCursor = &next
	}
	return page, nil
}

// RetryRecoveryRequest is the body of
// POST /v1/admin/mp/recoveries/{id}/retry.
type RetryRecoveryRequest struct {
	// DryRun previews the row without retrying it.
	DryRun bool `json:"dryRun"`
	// ExpectedAttempts is the row's `attempts` the operator last saw — the
	// optimistic-concurrency guard. Required to apply.
	ExpectedAttempts *int `json:"expectedAttempts,omitempty"`
}

// RetryRecoveryResult answers both modes.
type RetryRecoveryResult struct {
	Row     *RecoveryView `json:"row"`
	Outcome string        `json:"outcome"` // preview | resolved | deferred | already_resolved
	Detail  string        `json:"detail,omitempty"`
}

// AdminRetryRecovery forces ONE recovery row's retry now instead of waiting
// for its backoff, by calling the SAME runRecovery the sweep uses under the
// SAME wallet idempotency keys — so a raced or replayed call converges
// rather than double-releasing, double-reversing or double-settling.
func (s *Service) AdminRetryRecovery(ctx context.Context, actor Actor, id uuid.UUID, req RetryRecoveryRequest, idempotencyKey string) (*RetryRecoveryResult, int, error) {
	if err := requireAdmin(actor, "retry a reservation recovery"); err != nil {
		return nil, 0, err
	}
	row, err := s.deps.Store.RecoveryByID(ctx, s.deps.Store.Pool(), id)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	now := s.now()

	if req.DryRun {
		return &RetryRecoveryResult{Row: toRecoveryView(row, now), Outcome: "preview"}, 200, nil
	}

	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeAdminRecoveryRetry, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var response RetryRecoveryResult
		if err := decodeJSON(replay.Response, &response); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &response, replay.StatusCode, nil
	}

	if row.ResolvedAt != nil {
		response := &RetryRecoveryResult{Row: toRecoveryView(row, now), Outcome: "already_resolved",
			Detail: "this recovery row resolved before this call reached it; nothing was retried again"}
		if err := s.deps.Store.SaveIdempotent(ctx, s.deps.Store.Pool(), scopeAdminRecoveryRetry, actor.UserID, idempotencyKey, req, 200, response); err != nil {
			return nil, 0, asDomainError(err)
		}
		return response, 200, nil
	}
	if req.ExpectedAttempts == nil {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "expectedAttempts is required to apply a retry")
	}
	if row.Attempts != *req.ExpectedAttempts {
		return nil, 0, domain.Errorf(domain.CodeVersionConflict,
			"this recovery row changed since you last read it (attempts now %d) — reload and retry", row.Attempts)
	}

	resolved, opErr := s.runRecovery(ctx, row, now)
	outcome := "deferred"
	detail := ""
	if resolved {
		outcome = "resolved"
	} else if opErr != nil {
		detail = opErr.Error()
	}

	var reloaded *RecoveryRow
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if resolved {
			if err := s.deps.Store.ResolveRecovery(ctx, tx, row.ID, now); err != nil {
				return err
			}
		} else {
			backoff := 30 * time.Second
			lastError := detail
			if lastError == "" {
				lastError = "deferred by operator retry"
			}
			if err := s.deps.Store.DeferRecovery(ctx, tx, row.ID, lastError, now.Add(backoff)); err != nil {
				return err
			}
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role,
			Action: "mp.admin.recovery_retry", SubjectType: "mp_reservation_recovery", SubjectID: row.ID.String(),
			Before: map[string]any{"attempts": row.Attempts, "action": row.Action},
			After:  map[string]any{"outcome": outcome},
			Reason: "operator-triggered recovery retry",
		}); err != nil {
			return err
		}
		var innerErr error
		reloaded, innerErr = s.deps.Store.RecoveryByID(ctx, tx, row.ID)
		if innerErr != nil {
			return innerErr
		}
		response := &RetryRecoveryResult{Row: toRecoveryView(reloaded, now), Outcome: outcome, Detail: detail}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeAdminRecoveryRetry, actor.UserID, idempotencyKey, req, 200, response)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return &RetryRecoveryResult{Row: toRecoveryView(reloaded, now), Outcome: outcome, Detail: detail}, 200, nil
}

// ---------------------------------------------------------------------------
// Cancellations / no-shows board
// ---------------------------------------------------------------------------

// CancellationView is one marketplace-managed cancellation or no-show.
type CancellationView struct {
	RideID     string    `json:"rideId"`
	AwardID    *string   `json:"awardId,omitempty"`
	RequestID  *string   `json:"requestId,omitempty"`
	CityID     string    `json:"cityId"`
	DriverID   *string   `json:"driverId,omitempty"`
	RiderID    string    `json:"riderId"`
	State      string    `json:"state"`
	ReasonCode string    `json:"reasonCode,omitempty"`
	At         time.Time `json:"at"`
}

// CancellationsPage answers GET /v1/admin/mp/cancellations.
type CancellationsPage struct {
	Rows       []*CancellationView `json:"rows"`
	NextCursor *string             `json:"nextCursor,omitempty"`
}

func parseOptionalUUID(raw string) (*uuid.UUID, error) {
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, domain.Errorf(domain.CodeValidationFailed, "driverId is not a valid id")
	}
	return &id, nil
}

// AdminCancellations lists marketplace-managed cancellations/no-shows,
// newest first.
func (s *Service) AdminCancellations(ctx context.Context, actor Actor, cityID, driverID, cursor string) (*CancellationsPage, error) {
	if err := requireAdmin(actor, "read the cancellations board"); err != nil {
		return nil, err
	}
	driver, err := parseOptionalUUID(driverID)
	if err != nil {
		return nil, err
	}
	rows, err := s.deps.Store.ListCancellations(ctx, s.deps.Store.Pool(), cityID, driver, cursor, feedPageSize)
	if err != nil {
		return nil, asDomainError(err)
	}
	page := &CancellationsPage{Rows: []*CancellationView{}}
	for _, row := range rows {
		var awardID, requestID, rowDriverID *string
		if row.AwardID != nil {
			v := row.AwardID.String()
			awardID = &v
		}
		if row.RequestID != nil {
			v := row.RequestID.String()
			requestID = &v
		}
		if row.DriverID != nil {
			v := row.DriverID.String()
			rowDriverID = &v
		}
		page.Rows = append(page.Rows, &CancellationView{
			RideID: row.RideID.String(), AwardID: awardID, RequestID: requestID, CityID: row.CityID,
			DriverID: rowDriverID, RiderID: row.RiderID.String(), State: row.State, ReasonCode: row.ReasonCode,
			At: row.At,
		})
	}
	if len(rows) == feedPageSize {
		last := rows[len(rows)-1]
		next := encodeCursor(last.At, last.RideID)
		page.NextCursor = &next
	}
	return page, nil
}

// ---------------------------------------------------------------------------
// Driver standing board
// ---------------------------------------------------------------------------

const defaultStandingWindowDays = 30
const defaultStandingMinRides = 3

// DriverStandingView is one driver's standing summary.
type DriverStandingView struct {
	DriverID            string                `json:"driverId"`
	CityID              string                `json:"cityId"`
	WindowDays          int                   `json:"windowDays"`
	TotalRides          int                   `json:"totalRides"`
	Completions         int                   `json:"completions"`
	DriverCancellations int                   `json:"driverCancellations"`
	RiderCancellations  int                   `json:"riderCancellations"`
	NoShows             int                   `json:"noShows"`
	CancellationRate    float64               `json:"cancellationRate"`
	Blocked             bool                  `json:"blocked"`
	ActiveAction        *StandingActionView   `json:"activeAction,omitempty"`
	History             []*StandingActionView `json:"history"`
}

// AdminDriverStanding composes one driver's standing summary: the real
// completion/cancellation/no-show aggregate over a trailing window, whether
// they are currently blocked, and their standing-action history.
func (s *Service) AdminDriverStanding(ctx context.Context, actor Actor, driverID uuid.UUID, windowDays int) (*DriverStandingView, error) {
	if err := requireAdmin(actor, "read a driver's standing"); err != nil {
		return nil, err
	}
	if windowDays <= 0 {
		windowDays = defaultStandingWindowDays
	}
	agg, err := s.deps.Store.DriverStandingAggregate(ctx, s.deps.Store.Pool(), driverID, windowDays)
	if err != nil {
		return nil, asDomainError(err)
	}
	blocked, err := s.driverBlocked(ctx, driverID)
	if err != nil {
		return nil, asDomainError(err)
	}
	history, err := s.deps.Store.ListStandingActions(ctx, s.deps.Store.Pool(), &driverID, "", "", feedPageSize)
	if err != nil {
		return nil, asDomainError(err)
	}
	view := &DriverStandingView{
		DriverID: driverID.String(), CityID: agg.CityID, WindowDays: windowDays, TotalRides: agg.Total,
		Completions: agg.Completions, DriverCancellations: agg.DriverCancellations,
		RiderCancellations: agg.RiderCancellations, NoShows: agg.NoShows,
		CancellationRate: agg.CancellationRate(), Blocked: blocked, History: []*StandingActionView{},
	}
	for _, a := range history {
		hv := toStandingActionView(a)
		view.History = append(view.History, hv)
		if view.ActiveAction == nil && (a.Status == StandingStatusActive || a.Status == StandingStatusAppealed || a.Status == StandingStatusPendingApproval) {
			view.ActiveAction = hv
		}
	}
	return view, nil
}

// DriverStandingRow is one row of the flagged-drivers board.
type DriverStandingRow struct {
	DriverID            string  `json:"driverId"`
	CityID              string  `json:"cityId"`
	WindowDays          int     `json:"windowDays"`
	TotalRides          int     `json:"totalRides"`
	Completions         int     `json:"completions"`
	DriverCancellations int     `json:"driverCancellations"`
	NoShows             int     `json:"noShows"`
	CancellationRate    float64 `json:"cancellationRate"`
}

// DriverStandingListPage answers GET /v1/admin/mp/drivers/standing.
type DriverStandingListPage struct {
	Rows       []*DriverStandingRow `json:"rows"`
	Total      int                  `json:"total"`
	Limit      int                  `json:"limit"`
	Offset     int                  `json:"offset"`
	WindowDays int                  `json:"windowDays"`
	MinRides   int                  `json:"minRides"`
}

// AdminDriverStandingList is the pattern-detection read the abuse addendum
// named as missing (A06): every driver whose trailing-window sample of
// marketplace-managed rides meets minRides, worst cancellation rate first.
// It computes the rate live from ride.rides on every call — nothing is
// pre-flagged or cached, so the list can never go stale.
func (s *Service) AdminDriverStandingList(ctx context.Context, actor Actor, cityID string, windowDays, minRides, limit, offset int) (*DriverStandingListPage, error) {
	if err := requireAdmin(actor, "read the driver standing board"); err != nil {
		return nil, err
	}
	if windowDays <= 0 {
		windowDays = defaultStandingWindowDays
	}
	if minRides <= 0 {
		minRides = defaultStandingMinRides
	}
	if limit <= 0 || limit > feedPageSize {
		limit = feedPageSize
	}
	if offset < 0 {
		offset = 0
	}
	rows, total, err := s.deps.Store.ListDriverStanding(ctx, s.deps.Store.Pool(), cityID, windowDays, minRides, limit, offset)
	if err != nil {
		return nil, asDomainError(err)
	}
	page := &DriverStandingListPage{Rows: []*DriverStandingRow{}, Total: total, Limit: limit, Offset: offset,
		WindowDays: windowDays, MinRides: minRides}
	for _, row := range rows {
		page.Rows = append(page.Rows, &DriverStandingRow{
			DriverID: row.DriverID.String(), CityID: row.CityID, WindowDays: windowDays, TotalRides: row.Total,
			Completions: row.Completions, DriverCancellations: row.DriverCancellations, NoShows: row.NoShows,
			CancellationRate: row.CancellationRate(),
		})
	}
	return page, nil
}

// driverBlocked reports whether a driver currently carries an in-effect
// suspension. Only the most recent effective suspension/reinstatement row
// decides this — see LatestEffectiveStanding.
func (s *Service) driverBlocked(ctx context.Context, driverID uuid.UUID) (bool, error) {
	row, err := s.deps.Store.LatestEffectiveStanding(ctx, s.deps.Store.Pool(), driverID)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return row.ActionType == StandingActionSuspension, nil
}

// ---------------------------------------------------------------------------
// Standing actions & appeals (maker-checker)
// ---------------------------------------------------------------------------

// standingReasonCodes is the closed set a proposal or a decision must cite —
// reason codes are required, never freeform.
var standingReasonCodes = map[string]bool{
	"repeated_cancellation": true,
	"no_show_pattern":       true,
	"fraud_suspected":       true,
	"safety_complaint":      true,
	"policy_violation":      true,
	"appeal_reviewed":       true,
	"performance_recovered": true,
	"other":                 true,
}

func validReasonCode(code string) bool { return standingReasonCodes[code] }

// StandingActionView is one row of mp.driver_standing_actions.
type StandingActionView struct {
	ID               string     `json:"id"`
	DriverID         string     `json:"driverId"`
	CityID           string     `json:"cityId"`
	ActionType       string     `json:"actionType"`
	ReasonCode       string     `json:"reasonCode"`
	ReasonNote       string     `json:"reasonNote,omitempty"`
	Status           string     `json:"status"`
	ProposedBy       string     `json:"proposedBy"`
	ProposedAt       time.Time  `json:"proposedAt"`
	DecidedBy        *string    `json:"decidedBy,omitempty"`
	DecidedAt        *time.Time `json:"decidedAt,omitempty"`
	DecisionReason   string     `json:"decisionReason,omitempty"`
	AppealedBy       *string    `json:"appealedBy,omitempty"`
	AppealedAt       *time.Time `json:"appealedAt,omitempty"`
	AppealNote       string     `json:"appealNote,omitempty"`
	AppealDecidedBy  *string    `json:"appealDecidedBy,omitempty"`
	AppealDecidedAt  *time.Time `json:"appealDecidedAt,omitempty"`
	AppealReason     string     `json:"appealReason,omitempty"`
	RequiresApproval bool       `json:"requiresApproval"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

func toStandingActionView(a *StandingAction) *StandingActionView {
	toStr := func(id *uuid.UUID) *string {
		if id == nil {
			return nil
		}
		v := id.String()
		return &v
	}
	return &StandingActionView{
		ID: a.ID.String(), DriverID: a.DriverID.String(), CityID: a.CityID, ActionType: a.ActionType,
		ReasonCode: a.ReasonCode, ReasonNote: a.ReasonNote, Status: a.Status,
		ProposedBy: a.ProposedBy.String(), ProposedAt: a.ProposedAt,
		DecidedBy: toStr(a.DecidedBy), DecidedAt: a.DecidedAt, DecisionReason: a.DecisionReason,
		AppealedBy: toStr(a.AppealedBy), AppealedAt: a.AppealedAt, AppealNote: a.AppealNote,
		AppealDecidedBy: toStr(a.AppealDecidedBy), AppealDecidedAt: a.AppealDecidedAt, AppealReason: a.AppealReason,
		RequiresApproval: isProtectedStandingAction(a.ActionType), UpdatedAt: a.UpdatedAt,
	}
}

// ProposeStandingActionRequest is the body of
// POST /v1/admin/mp/drivers/{driverId}/standing-actions.
type ProposeStandingActionRequest struct {
	ActionType string `json:"actionType"`
	ReasonCode string `json:"reasonCode"`
	ReasonNote string `json:"reasonNote,omitempty"`
	CityID     string `json:"cityId"`
}

// AdminProposeStandingAction records a standing action against a driver. A
// warning is informational and commits immediately under this one operator;
// suspension and reinstatement are PROTECTED — they change eligibility (see
// EvaluateEligibility) and stay `pending_approval` until a second, distinct
// operator approves them.
func (s *Service) AdminProposeStandingAction(ctx context.Context, actor Actor, driverID uuid.UUID, req ProposeStandingActionRequest, idempotencyKey string) (*StandingActionView, int, error) {
	if err := requireAdmin(actor, "propose a driver standing action"); err != nil {
		return nil, 0, err
	}
	switch req.ActionType {
	case StandingActionWarning, StandingActionSuspension, StandingActionReinstatement:
	default:
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "actionType must be warning, suspension or reinstatement")
	}
	if !validReasonCode(req.ReasonCode) {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "reasonCode is required and must be a recognised code")
	}
	if req.CityID == "" {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "cityId is required")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeStandingPropose, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var response StandingActionView
		if err := decodeJSON(replay.Response, &response); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &response, replay.StatusCode, nil
	}

	now := s.now()
	protected := isProtectedStandingAction(req.ActionType)
	action := &StandingAction{
		ID: uuid.New(), DriverID: driverID, CityID: req.CityID, ActionType: req.ActionType,
		ReasonCode: req.ReasonCode, ReasonNote: req.ReasonNote, ProposedBy: actor.UserID,
	}
	if protected {
		action.Status = StandingStatusPendingApproval
	} else {
		action.Status = StandingStatusActive
		decidedBy := actor.UserID
		action.DecidedBy = &decidedBy
		action.DecidedAt = &now
		action.DecisionReason = "informational action; no approval required"
	}

	var response *StandingActionView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.deps.Store.InsertStandingAction(ctx, tx, action); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role,
			Action: "mp.standing.propose", SubjectType: "mp_driver_standing", SubjectID: action.ID.String(),
			Before: map[string]any{},
			After:  map[string]any{"driverId": driverID.String(), "actionType": req.ActionType, "status": action.Status},
			Reason: req.ReasonNote,
		}); err != nil {
			return err
		}
		reloaded, err := s.deps.Store.StandingActionByID(ctx, tx, action.ID)
		if err != nil {
			return err
		}
		response = toStandingActionView(reloaded)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeStandingPropose, actor.UserID, idempotencyKey, req, 201, response)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return response, 201, nil
}

// DecideStandingActionRequest is the body of
// POST /v1/admin/mp/standing-actions/{id}/decide.
type DecideStandingActionRequest struct {
	Approve bool   `json:"approve"`
	Reason  string `json:"reason"`
}

// AdminDecideStandingAction approves or rejects a pending protected standing
// action. Maker-checker: the operator who proposed it can never be the one
// who decides it — enforced here, not merely by the UI.
func (s *Service) AdminDecideStandingAction(ctx context.Context, actor Actor, id uuid.UUID, req DecideStandingActionRequest, idempotencyKey string) (*StandingActionView, int, error) {
	if err := requireAdmin(actor, "decide a driver standing action"); err != nil {
		return nil, 0, err
	}
	if req.Reason == "" {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "a reason is required to approve or reject a standing action")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeStandingApprove, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var response StandingActionView
		if err := decodeJSON(replay.Response, &response); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &response, replay.StatusCode, nil
	}

	now := s.now()
	var response *StandingActionView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		row, err := s.deps.Store.StandingActionForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if row.Status != StandingStatusPendingApproval {
			return domain.Errorf(domain.CodeVersionConflict,
				"this standing action is no longer pending approval (now %s)", row.Status)
		}
		if row.ProposedBy == actor.UserID {
			return domain.Errorf(domain.CodeForbidden,
				"the operator who proposed a standing action cannot approve or reject it")
		}
		newStatus := StandingStatusRejected
		if req.Approve {
			newStatus = StandingStatusActive
		}
		if err := s.deps.Store.DecideStandingAction(ctx, tx, id, newStatus, actor.UserID, now, req.Reason); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role,
			Action: "mp.standing.decide", SubjectType: "mp_driver_standing", SubjectID: id.String(),
			Before: map[string]any{"status": StandingStatusPendingApproval, "proposedBy": row.ProposedBy.String()},
			After:  map[string]any{"status": newStatus},
			Reason: req.Reason,
		}); err != nil {
			return err
		}
		reloaded, err := s.deps.Store.StandingActionByID(ctx, tx, id)
		if err != nil {
			return err
		}
		response = toStandingActionView(reloaded)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeStandingApprove, actor.UserID, idempotencyKey, req, 200, response)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return response, 200, nil
}

// FileAppealRequest is the body of
// POST /v1/admin/mp/standing-actions/{id}/appeal — an operator recording a
// driver's contest of an active suspension (e.g. filed through support).
type FileAppealRequest struct {
	Note string `json:"note"`
}

// AdminFileAppeal records that an active suspension is being appealed.
func (s *Service) AdminFileAppeal(ctx context.Context, actor Actor, id uuid.UUID, req FileAppealRequest, idempotencyKey string) (*StandingActionView, int, error) {
	if err := requireAdmin(actor, "file a standing appeal"); err != nil {
		return nil, 0, err
	}
	if req.Note == "" {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "a note describing the driver's appeal is required")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeStandingAppeal, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var response StandingActionView
		if err := decodeJSON(replay.Response, &response); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &response, replay.StatusCode, nil
	}

	now := s.now()
	var response *StandingActionView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		row, err := s.deps.Store.StandingActionForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if row.Status != StandingStatusActive || row.ActionType != StandingActionSuspension {
			return domain.Errorf(domain.CodeVersionConflict, "only an active suspension can be appealed (now %s/%s)", row.ActionType, row.Status)
		}
		if err := s.deps.Store.FileStandingAppeal(ctx, tx, id, actor.UserID, now, req.Note); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role,
			Action: "mp.standing.appeal_filed", SubjectType: "mp_driver_standing", SubjectID: id.String(),
			Before: map[string]any{"status": StandingStatusActive},
			After:  map[string]any{"status": StandingStatusAppealed},
			Reason: req.Note,
		}); err != nil {
			return err
		}
		reloaded, err := s.deps.Store.StandingActionByID(ctx, tx, id)
		if err != nil {
			return err
		}
		response = toStandingActionView(reloaded)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeStandingAppeal, actor.UserID, idempotencyKey, req, 200, response)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return response, 200, nil
}

// DecideAppealRequest is the body of
// POST /v1/admin/mp/standing-actions/{id}/appeal-decision.
type DecideAppealRequest struct {
	Uphold bool   `json:"uphold"` // true overturns the suspension; false denies the appeal
	Reason string `json:"reason"`
}

// AdminDecideAppeal reviews a filed appeal. Maker-checker: the operator who
// filed the appeal can never be the one who decides it.
func (s *Service) AdminDecideAppeal(ctx context.Context, actor Actor, id uuid.UUID, req DecideAppealRequest, idempotencyKey string) (*StandingActionView, int, error) {
	if err := requireAdmin(actor, "decide a standing appeal"); err != nil {
		return nil, 0, err
	}
	if req.Reason == "" {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "a reason is required to decide an appeal")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeStandingAppealDecide, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var response StandingActionView
		if err := decodeJSON(replay.Response, &response); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &response, replay.StatusCode, nil
	}

	now := s.now()
	var response *StandingActionView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		row, err := s.deps.Store.StandingActionForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if row.Status != StandingStatusAppealed {
			return domain.Errorf(domain.CodeVersionConflict, "this standing action has no pending appeal (now %s)", row.Status)
		}
		if row.AppealedBy != nil && *row.AppealedBy == actor.UserID {
			return domain.Errorf(domain.CodeForbidden, "the operator who filed an appeal cannot decide it")
		}
		newStatus := StandingStatusAppealDenied
		if req.Uphold {
			newStatus = StandingStatusAppealUpheld
		}
		if err := s.deps.Store.DecideStandingAppeal(ctx, tx, id, newStatus, actor.UserID, now, req.Reason); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role,
			Action: "mp.standing.appeal_decided", SubjectType: "mp_driver_standing", SubjectID: id.String(),
			Before: map[string]any{"status": StandingStatusAppealed},
			After:  map[string]any{"status": newStatus},
			Reason: req.Reason,
		}); err != nil {
			return err
		}
		reloaded, err := s.deps.Store.StandingActionByID(ctx, tx, id)
		if err != nil {
			return err
		}
		response = toStandingActionView(reloaded)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeStandingAppealDecide, actor.UserID, idempotencyKey, req, 200, response)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return response, 200, nil
}

// AdminStandingActions lists the standing-action review queue by status
// (e.g. pending_approval, appealed), newest first.
func (s *Service) AdminStandingActions(ctx context.Context, actor Actor, status, cursor string) (*StandingActionsPage, error) {
	if err := requireAdmin(actor, "read the standing-action review queue"); err != nil {
		return nil, err
	}
	rows, err := s.deps.Store.ListStandingActions(ctx, s.deps.Store.Pool(), nil, status, cursor, feedPageSize)
	if err != nil {
		return nil, asDomainError(err)
	}
	page := &StandingActionsPage{Rows: []*StandingActionView{}}
	for _, row := range rows {
		page.Rows = append(page.Rows, toStandingActionView(row))
	}
	if len(rows) == feedPageSize {
		last := rows[len(rows)-1]
		next := encodeCursor(last.CreatedAt, last.ID)
		page.NextCursor = &next
	}
	return page, nil
}

// StandingActionsPage answers GET /v1/admin/mp/standing-actions.
type StandingActionsPage struct {
	Rows       []*StandingActionView `json:"rows"`
	NextCursor *string               `json:"nextCursor,omitempty"`
}
