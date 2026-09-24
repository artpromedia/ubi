package marketplace

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// Owed-work boards (round 9, for the round-8 admin screens): the durable
// owed operations the rounds 5-7 sagas added — an organization budget's
// commit/release (mp.business_bookings.owed_op) and a queued delivery's
// cancellation in delivery-service (mp.delivery_cancellations) — each with a
// paginated admin read and an explicit retry with a dry-run preview. Like
// the C08 commands (standing.go), a retry only drives the SAME runner the
// sweep uses, under the SAME idempotency keys (business:<award>:<op>, the
// award id at delivery-service), so a raced or replayed retry converges; it
// needs an Idempotency-Key and the attempts the operator last saw, writes
// one audit row, and never moves money of its own. Views carry ids, states,
// codes and integer minor amounts only — never a person's name, phone,
// location or a token.

// ---------------------------------------------------------------------------
// Business budget ops owed
// ---------------------------------------------------------------------------

// BusinessBookingAdminView is one award's organization-budget funding as an
// operator sees it.
type BusinessBookingAdminView struct {
	AwardID        string     `json:"awardId"`
	RequestID      string     `json:"requestId"`
	BookingRef     string     `json:"bookingRef"`
	OrganizationID string     `json:"organizationId"`
	CostCentreID   string     `json:"costCentreId,omitempty"`
	CityID         string     `json:"cityId"`
	State          string     `json:"state"`
	OwedOp         string     `json:"owedOp,omitempty"`
	ReleaseParty   string     `json:"releaseParty,omitempty"`
	ReleaseReason  string     `json:"releaseReason,omitempty"`
	ReservedMinor  Money      `json:"reservedMinor"`
	CommittedMinor *Money     `json:"committedMinor,omitempty"`
	Attempts       int        `json:"attempts"`
	LastError      string     `json:"lastError,omitempty"`
	NextAttemptAt  *time.Time `json:"nextAttemptAt,omitempty"`
	AgeSec         int64      `json:"ageSec"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

// BusinessBookingsPage answers GET /v1/admin/mp/business-bookings.
type BusinessBookingsPage struct {
	Rows       []*BusinessBookingAdminView `json:"rows"`
	NextCursor *string                     `json:"nextCursor,omitempty"`
}

func businessBookingAdminView(b *BusinessBooking, now time.Time) *BusinessBookingAdminView {
	view := &BusinessBookingAdminView{
		AwardID: b.AwardID.String(), RequestID: b.RequestID.String(), BookingRef: b.BookingRef,
		OrganizationID: b.OrganizationID, CostCentreID: b.CostCentreID, CityID: b.CityID, State: b.State,
		OwedOp: b.OwedOp, ReleaseParty: b.ReleaseParty, ReleaseReason: b.ReleaseReason,
		ReservedMinor: money(b.ReservedMinor, b.Currency), Attempts: b.Attempts, LastError: b.LastError,
		NextAttemptAt: b.NextAttemptAt, AgeSec: ageSec(now, b.CreatedAt), CreatedAt: b.CreatedAt, UpdatedAt: b.UpdatedAt,
	}
	if b.CommittedMinor != nil {
		committed := money(*b.CommittedMinor, b.Currency)
		view.CommittedMinor = &committed
	}
	return view
}

// AdminBusinessBookings lists business bookings, oldest first — with owed,
// only those still owing payment-service a commit or release.
func (s *Service) AdminBusinessBookings(ctx context.Context, actor Actor, owed bool, cityID, cursor string) (*BusinessBookingsPage, error) {
	if err := requireAdmin(actor, "read the business budget board"); err != nil {
		return nil, err
	}
	rows, err := s.deps.Store.ListBusinessBookings(ctx, s.deps.Store.Pool(), owed, cityID, cursor, feedPageSize)
	if err != nil {
		return nil, asDomainError(err)
	}
	now := s.now()
	page := &BusinessBookingsPage{Rows: []*BusinessBookingAdminView{}}
	for _, row := range rows {
		page.Rows = append(page.Rows, businessBookingAdminView(row, now))
	}
	if len(rows) == feedPageSize {
		last := rows[len(rows)-1]
		next := encodeCursor(last.CreatedAt, last.AwardID)
		page.NextCursor = &next
	}
	return page, nil
}

// OwedRetryRequest is the body of the owed-work retry commands.
type OwedRetryRequest struct {
	// DryRun previews the row and what a retry would do, touching nothing.
	DryRun bool `json:"dryRun"`
	// ExpectedAttempts is the row's `attempts` the operator last saw — the
	// optimistic-concurrency guard. Required to apply.
	ExpectedAttempts *int `json:"expectedAttempts,omitempty"`
}

// Owed-work retry outcomes.
const (
	OwedRetryPreview     = "preview"
	OwedRetryResolved    = "resolved"
	OwedRetryDeferred    = "deferred"
	OwedRetryNothingOwed = "nothing_owed"
)

// BusinessRetryResult answers POST /v1/admin/mp/business-bookings/{awardId}/retry.
type BusinessRetryResult struct {
	Row     *BusinessBookingAdminView `json:"row"`
	Outcome string                    `json:"outcome"` // preview | resolved | deferred | nothing_owed
	Detail  string                    `json:"detail,omitempty"`
}

// AdminRetryBusinessOp drives ONE award's owed business commit/release now
// instead of waiting for its backoff — runBusinessOp, the sweep's runner,
// under the award's one key per op — so payment-service replays anything
// that already landed.
func (s *Service) AdminRetryBusinessOp(ctx context.Context, actor Actor, awardID uuid.UUID, req OwedRetryRequest, idempotencyKey string) (*BusinessRetryResult, int, error) {
	if err := requireAdmin(actor, "retry a business budget op"); err != nil {
		return nil, 0, err
	}
	booking, err := s.deps.Store.BusinessBookingByAward(ctx, s.deps.Store.Pool(), awardID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that award has no business booking")
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	now := s.now()
	if req.DryRun {
		detail := "nothing is owed: a retry would change nothing"
		if booking.OwedOp != "" {
			detail = fmt.Sprintf("a retry re-sends the owed %s under %s; payment-service replays one that already landed",
				booking.OwedOp, businessKey(booking.AwardID, booking.OwedOp))
		}
		return &BusinessRetryResult{Row: businessBookingAdminView(booking, now), Outcome: OwedRetryPreview, Detail: detail}, 200, nil
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeAdminBusinessRetry, actor.UserID, idempotencyKey, owedRetryBody(awardID, req))
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var response BusinessRetryResult
		if err := decodeJSON(replay.Response, &response); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &response, replay.StatusCode, nil
	}
	if booking.OwedOp == "" {
		response := &BusinessRetryResult{Row: businessBookingAdminView(booking, now), Outcome: OwedRetryNothingOwed,
			Detail: "this booking owes payment-service nothing; nothing was sent"}
		if err := s.deps.Store.SaveIdempotent(ctx, s.deps.Store.Pool(), scopeAdminBusinessRetry, actor.UserID, idempotencyKey,
			owedRetryBody(awardID, req), 200, response); err != nil {
			return nil, 0, asDomainError(err)
		}
		return response, 200, nil
	}
	if req.ExpectedAttempts == nil {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "expectedAttempts is required to apply a retry")
	}
	if booking.Attempts != *req.ExpectedAttempts {
		return nil, 0, domain.Errorf(domain.CodeVersionConflict,
			"this booking changed since you last read it (attempts now %d) — reload and retry", booking.Attempts)
	}

	owedOp := booking.OwedOp
	opErr := s.runBusinessOp(ctx, awardID)
	reloaded, err := s.deps.Store.BusinessBookingByAward(ctx, s.deps.Store.Pool(), awardID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	outcome, detail := OwedRetryDeferred, ""
	switch {
	case reloaded.OwedOp == "":
		outcome = OwedRetryResolved
	case opErr != nil:
		detail = truncateError(opErr)
	default:
		detail = "payment-service has not confirmed the " + owedOp + " yet; the sweep keeps driving it"
	}
	response := &BusinessRetryResult{Row: businessBookingAdminView(reloaded, s.now()), Outcome: outcome, Detail: detail}
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role,
			Action: "mp.admin.business_op_retry", SubjectType: subjectBusinessBooking, SubjectID: awardID.String(),
			Before: map[string]any{"owedOp": owedOp, "attempts": booking.Attempts, "state": booking.State},
			After:  map[string]any{"outcome": outcome, "owedOp": reloaded.OwedOp, "state": reloaded.State},
			Reason: "operator-triggered retry of an owed business budget op",
		}); err != nil {
			return err
		}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeAdminBusinessRetry, actor.UserID, idempotencyKey, owedRetryBody(awardID, req), 200, response)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return response, 200, nil
}

// owedRetryBody is what an owed-work retry's idempotency key binds: the row
// and the operator's request.
func owedRetryBody(id uuid.UUID, req OwedRetryRequest) map[string]any {
	body := map[string]any{"id": id.String(), "dryRun": req.DryRun}
	if req.ExpectedAttempts != nil {
		body["expectedAttempts"] = *req.ExpectedAttempts
	}
	return body
}

// ListBusinessBookings pages business bookings oldest first; owed keeps only
// those with an owed op.
func (s *Store) ListBusinessBookings(ctx context.Context, db DB, owed bool, cityID, cursor string, limit int) ([]*BusinessBooking, error) {
	query := `SELECT ` + businessBookingColumns + ` FROM mp.business_bookings
		WHERE ($1 = false OR owed_op IS NOT NULL) AND ($2 = '' OR city_id = $2)`
	args := []any{owed, cityID}
	if cursor != "" {
		at, id, err := decodeCursor(cursor)
		if err != nil {
			return nil, domain.Errorf(domain.CodeValidationFailed, "that is not a business booking cursor")
		}
		query += fmt.Sprintf(` AND (created_at, award_id) > ($%d, $%d)`, len(args)+1, len(args)+2)
		args = append(args, at, id)
	}
	query += fmt.Sprintf(` ORDER BY created_at ASC, award_id ASC LIMIT %d`, limit)
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list business bookings: %w", err)
	}
	defer rows.Close()
	var out []*BusinessBooking
	for rows.Next() {
		booking, err := scanBusinessBooking(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, booking)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Queued delivery cancellations owed
// ---------------------------------------------------------------------------

// DeliveryCancelAdminView is one owed (or answered) delivery cancellation.
type DeliveryCancelAdminView struct {
	AwardID       string     `json:"awardId"`
	DeliveryID    string     `json:"deliveryId"`
	Reason        string     `json:"reason"`
	State         string     `json:"state"`
	Attempts      int        `json:"attempts"`
	LastStatus    *int       `json:"lastStatus,omitempty"`
	LastCode      string     `json:"lastCode,omitempty"`
	LastError     string     `json:"lastError,omitempty"`
	NextAttemptAt *time.Time `json:"nextAttemptAt,omitempty"`
	ResolvedAt    *time.Time `json:"resolvedAt,omitempty"`
	AgeSec        int64      `json:"ageSec"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

// DeliveryCancellationsPage answers GET /v1/admin/mp/delivery-cancellations.
type DeliveryCancellationsPage struct {
	Rows       []*DeliveryCancelAdminView `json:"rows"`
	NextCursor *string                    `json:"nextCursor,omitempty"`
}

func deliveryCancelAdminView(row *DeliveryCancelRow, now time.Time) *DeliveryCancelAdminView {
	return &DeliveryCancelAdminView{
		AwardID: row.AwardID.String(), DeliveryID: row.DeliveryID.String(), Reason: row.Reason, State: row.State,
		Attempts: row.Attempts, LastStatus: row.LastStatus, LastCode: row.LastCode, LastError: row.LastError,
		NextAttemptAt: row.NextAttemptAt, ResolvedAt: row.ResolvedAt, AgeSec: ageSec(now, row.CreatedAt),
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

// AdminDeliveryCancellations lists owed delivery cancellations, oldest first,
// optionally in one state (pending | cancelled | refused) and one city.
func (s *Service) AdminDeliveryCancellations(ctx context.Context, actor Actor, state, cityID, cursor string) (*DeliveryCancellationsPage, error) {
	if err := requireAdmin(actor, "read the delivery cancellation board"); err != nil {
		return nil, err
	}
	switch state {
	case "", DeliveryCancelPending, DeliveryCancelCancelled, DeliveryCancelRefused:
	default:
		return nil, domain.Errorf(domain.CodeValidationFailed, "state is pending, cancelled or refused").
			WithDetails(map[string]any{"field": "state"})
	}
	rows, err := s.deps.Store.ListDeliveryCancellations(ctx, s.deps.Store.Pool(), state, cityID, cursor, feedPageSize)
	if err != nil {
		return nil, asDomainError(err)
	}
	now := s.now()
	page := &DeliveryCancellationsPage{Rows: []*DeliveryCancelAdminView{}}
	for _, row := range rows {
		page.Rows = append(page.Rows, deliveryCancelAdminView(row, now))
	}
	if len(rows) == feedPageSize {
		last := rows[len(rows)-1]
		next := encodeCursor(last.CreatedAt, last.AwardID)
		page.NextCursor = &next
	}
	return page, nil
}

// DeliveryCancelRetryResult answers
// POST /v1/admin/mp/delivery-cancellations/{awardId}/retry.
type DeliveryCancelRetryResult struct {
	Row     *DeliveryCancelAdminView `json:"row"`
	Outcome string                   `json:"outcome"` // preview | resolved | deferred | nothing_owed
	Detail  string                   `json:"detail,omitempty"`
}

// AdminRetryDeliveryCancel drives ONE owed delivery cancellation now —
// runDeliveryCancel, the sweep's runner; delivery-service is idempotent on
// the award id, so a re-send replays the one cancellation.
func (s *Service) AdminRetryDeliveryCancel(ctx context.Context, actor Actor, awardID uuid.UUID, req OwedRetryRequest, idempotencyKey string) (*DeliveryCancelRetryResult, int, error) {
	if err := requireAdmin(actor, "retry a delivery cancellation"); err != nil {
		return nil, 0, err
	}
	row, err := s.deps.Store.DeliveryCancelByAward(ctx, s.deps.Store.Pool(), awardID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that award owes no delivery cancellation")
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	now := s.now()
	if req.DryRun {
		detail := "this cancellation already has a definite answer (" + row.State + "); a retry would change nothing"
		if row.State == DeliveryCancelPending {
			detail = "a retry re-sends the cancellation of delivery " + row.DeliveryID.String() +
				" for award " + row.AwardID.String() + "; delivery-service replays one it already cancelled"
		}
		return &DeliveryCancelRetryResult{Row: deliveryCancelAdminView(row, now), Outcome: OwedRetryPreview, Detail: detail}, 200, nil
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeAdminDeliveryRetry, actor.UserID, idempotencyKey, owedRetryBody(awardID, req))
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var response DeliveryCancelRetryResult
		if err := decodeJSON(replay.Response, &response); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &response, replay.StatusCode, nil
	}
	if row.State != DeliveryCancelPending {
		response := &DeliveryCancelRetryResult{Row: deliveryCancelAdminView(row, now), Outcome: OwedRetryNothingOwed,
			Detail: "this cancellation already has a definite answer; nothing was sent"}
		if err := s.deps.Store.SaveIdempotent(ctx, s.deps.Store.Pool(), scopeAdminDeliveryRetry, actor.UserID, idempotencyKey,
			owedRetryBody(awardID, req), 200, response); err != nil {
			return nil, 0, asDomainError(err)
		}
		return response, 200, nil
	}
	if req.ExpectedAttempts == nil {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "expectedAttempts is required to apply a retry")
	}
	if row.Attempts != *req.ExpectedAttempts {
		return nil, 0, domain.Errorf(domain.CodeVersionConflict,
			"this cancellation changed since you last read it (attempts now %d) — reload and retry", row.Attempts)
	}

	opErr := s.runDeliveryCancel(ctx, awardID)
	reloaded, err := s.deps.Store.DeliveryCancelByAward(ctx, s.deps.Store.Pool(), awardID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	outcome, detail := OwedRetryDeferred, ""
	switch {
	case reloaded.State != DeliveryCancelPending:
		outcome = OwedRetryResolved
		detail = "delivery-service answered definitely: " + reloaded.State
	case opErr != nil:
		detail = truncateError(opErr)
	}
	response := &DeliveryCancelRetryResult{Row: deliveryCancelAdminView(reloaded, s.now()), Outcome: outcome, Detail: detail}
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role,
			Action: "mp.admin.delivery_cancel_retry", SubjectType: subjectAward, SubjectID: awardID.String(),
			Before: map[string]any{"state": row.State, "attempts": row.Attempts},
			After:  map[string]any{"outcome": outcome, "state": reloaded.State},
			Reason: "operator-triggered retry of an owed delivery cancellation",
		}); err != nil {
			return err
		}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeAdminDeliveryRetry, actor.UserID, idempotencyKey, owedRetryBody(awardID, req), 200, response)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return response, 200, nil
}

// ListDeliveryCancellations pages owed delivery cancellations oldest first,
// optionally in one state and one city (the award's request's).
func (s *Store) ListDeliveryCancellations(ctx context.Context, db DB, state, cityID, cursor string, limit int) ([]*DeliveryCancelRow, error) {
	query := `SELECT ` + deliveryCancelColumns + ` FROM mp.delivery_cancellations
		WHERE ($1 = '' OR state = $1)
			AND ($2 = '' OR award_id IN (
				SELECT a.id FROM mp.awards a JOIN mp.requests r ON r.id = a.request_id WHERE r.city_id = $2))`
	args := []any{state, cityID}
	if cursor != "" {
		at, id, err := decodeCursor(cursor)
		if err != nil {
			return nil, domain.Errorf(domain.CodeValidationFailed, "that is not a delivery cancellation cursor")
		}
		query += fmt.Sprintf(` AND (created_at, award_id) > ($%d, $%d)`, len(args)+1, len(args)+2)
		args = append(args, at, id)
	}
	query += fmt.Sprintf(` ORDER BY created_at ASC, award_id ASC LIMIT %d`, limit)
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list delivery cancellations: %w", err)
	}
	defer rows.Close()
	var out []*DeliveryCancelRow
	for rows.Next() {
		row, err := scanDeliveryCancel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
