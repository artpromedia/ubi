package marketplace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// Queued delivery cancellation compensation.
//
// A service=delivery award is handed off to delivery-service BEFORE it is
// confirmed (delivery_handoff.go): a QUEUED delivery award therefore already
// exists there, assigned to the winning driver. When that queued award is
// later cancelled — the requester's fee-free exit after a missed window, the
// driver-failure recovery, or a passenger's decline — ride-service must
// cancel the delivery too, or delivery-service is left holding an orphan
// assigned to a driver who will never do it.
//
// The cancellation is a durable intent (mp.delivery_cancellations), written
// in the SAME transaction that cancels the award, then driven after commit
// and by the sweep until delivery-service answers definitely — exactly like
// the hand-off itself, and idempotent on the award id on both sides:
//
//	POST {DELIVERY_SERVICE_URL}/api/v1/webhooks/marketplace-cancel
//	X-Service-Key: <delivery-service's INTERNAL_SERVICE_KEY>
//	{"awardId", "deliveryId", "fencingToken", "reason"}
//
//	200 {success, data:{id, status:"CANCELLED", marketplaceAwardId}} — also
//	    the replay for an award already cancelled;
//	409 CANCEL_IN_PROGRESS, 5xx, a timeout, an unreadable body — retry;
//	404 DELIVERY_NOT_FOUND, 409 DELIVERY_NOT_CANCELLABLE (custody already
//	    moved), 409 AWARD_REPLAY_MISMATCH, 400 VALIDATION_ERROR — permanent:
//	    recorded refused and alarmed for ops (never silently dropped);
//	403, 401, 503 SERVICE_KEY_NOT_CONFIGURED, a 404 with no code (the route
//	    is not deployed) — misconfigured: alarmed, kept pending, retried.
//
// delivery-service does not serve this route yet (its marketplace contract
// has no cancellation): until it does every attempt answers misconfigured,
// the intent stays pending and the alarm names the delivery — the orphan is
// always recorded, never lost.

// deliveryCancelPath is delivery-service's marketplace-cancel route.
const deliveryCancelPath = "/api/v1/webhooks/marketplace-cancel"

// Delivery cancellation states (mp.delivery_cancellations.state).
const (
	DeliveryCancelPending   = "pending"
	DeliveryCancelCancelled = "cancelled"
	DeliveryCancelRefused   = "refused"
)

// DeliveryCancelRequest is the marketplace-cancel body.
type DeliveryCancelRequest struct {
	AwardID      string `json:"awardId"`
	DeliveryID   string `json:"deliveryId"`
	FencingToken int64  `json:"fencingToken"`
	Reason       string `json:"reason"`
}

// DeliveryCancellation is delivery-service's 200 answer.
type DeliveryCancellation struct {
	ID                 string `json:"id"`
	Status             string `json:"status"`
	MarketplaceAwardID string `json:"marketplaceAwardId"`
}

// DeliveryCancelPort cancels a handed-off delivery, idempotent on the award.
// It is optional on the delivery port: a port without it is misconfigured
// for cancellations (the intent stays pending, alarmed).
type DeliveryCancelPort interface {
	Cancel(ctx context.Context, req DeliveryCancelRequest) (*DeliveryCancellation, error)
}

// cancelEnvelope is delivery-service's response envelope for a cancel.
type cancelEnvelope struct {
	Success bool                  `json:"success"`
	Data    *DeliveryCancellation `json:"data"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// Cancel implements DeliveryCancelPort against marketplace-cancel.
func (c *HTTPDeliveryAssign) Cancel(ctx context.Context, req DeliveryCancelRequest) (*DeliveryCancellation, error) {
	if !c.Configured() {
		return nil, &DeliveryAssignError{Outcome: HandoffOutcomeMisconfigured,
			Message: "DELIVERY_SERVICE_URL and a non-default service key are required to cancel a delivery"}
	}
	encoded, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("unserialisable delivery cancellation: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+deliveryCancelPath, bytes.NewReader(encoded))
	if err != nil {
		return nil, fmt.Errorf("failed to build the delivery cancellation: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Service-Key", c.serviceKey)
	response, err := c.client.Do(request)
	if err != nil {
		return nil, &DeliveryAssignError{Outcome: HandoffOutcomeRetry, Message: err.Error()}
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, &DeliveryAssignError{Outcome: HandoffOutcomeRetry, Status: response.StatusCode, Message: err.Error()}
	}
	var envelope cancelEnvelope
	decodeErr := json.Unmarshal(raw, &envelope)
	if response.StatusCode == http.StatusOK {
		if decodeErr != nil || !envelope.Success || envelope.Data == nil || envelope.Data.ID != req.DeliveryID {
			return nil, &DeliveryAssignError{Outcome: HandoffOutcomeRetry, Status: response.StatusCode,
				Message: "unreadable or mismatched cancellation body"}
		}
		return envelope.Data, nil
	}
	code, message := "", ""
	if decodeErr == nil && envelope.Error != nil {
		code, message = envelope.Error.Code, envelope.Error.Message
	}
	if message == "" {
		message = http.StatusText(response.StatusCode)
	}
	return nil, &DeliveryAssignError{
		Outcome: classifyDeliveryCancelAnswer(response.StatusCode, code),
		Status:  response.StatusCode, Code: code, Message: message,
	}
}

// classifyDeliveryCancelAnswer maps a non-success cancel answer onto its
// handling. Pure — unit-tested without a server. Nothing undocumented is
// ever guessed permanent.
func classifyDeliveryCancelAnswer(status int, code string) string {
	switch {
	case status == http.StatusNotFound && code == "DELIVERY_NOT_FOUND":
		return HandoffOutcomePermanent
	case status == http.StatusConflict && (code == "DELIVERY_NOT_CANCELLABLE" || code == "AWARD_REPLAY_MISMATCH"):
		return HandoffOutcomePermanent
	case status == http.StatusBadRequest && (code == "VALIDATION_ERROR" || code == "INVALID_JSON"):
		return HandoffOutcomePermanent
	case status == http.StatusServiceUnavailable && code == "SERVICE_KEY_NOT_CONFIGURED":
		return HandoffOutcomeMisconfigured
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return HandoffOutcomeMisconfigured
	case status == http.StatusNotFound && code == "":
		// The route is not there at all: a deployment that predates the
		// contract. Configuration, not a verdict on this delivery.
		return HandoffOutcomeMisconfigured
	default:
		return HandoffOutcomeRetry
	}
}

// DeliveryCancelRow is one mp.delivery_cancellations row.
type DeliveryCancelRow struct {
	AwardID      uuid.UUID
	DeliveryID   uuid.UUID
	FencingToken int64
	Reason       string
	State        string
	Attempts     int
	LastStatus   *int
	LastCode     string
	LastError    string
	ResolvedAt   *time.Time
}

// oweDeliveryCancel writes the durable cancellation intent for a queued
// delivery award inside the transaction that cancels the award.
func (s *Service) oweDeliveryCancel(ctx context.Context, tx pgx.Tx, award *Award, claim *Claim, reason, actorID, actorRole string, now time.Time) error {
	if award.ExecutionService != ServiceDelivery || award.ExecutionID == nil {
		return nil
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO mp.delivery_cancellations (award_id, delivery_id, fencing_token, reason, state, next_attempt_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6, $6)
		ON CONFLICT (award_id) DO NOTHING`,
		award.ID, *award.ExecutionID, claim.FencingToken, reason, DeliveryCancelPending, now)
	if err != nil {
		return fmt.Errorf("failed to record the owed delivery cancellation: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil
	}
	return writeAudit(ctx, tx, AuditRecord{
		ActorID:     actorID,
		ActorRole:   actorRole,
		Action:      "mp.delivery.cancel_owed",
		SubjectType: subjectAward,
		SubjectID:   award.ID.String(),
		After:       map[string]any{"deliveryId": award.ExecutionID.String(), "reason": reason, "fencingToken": claim.FencingToken},
		Reason:      "a queued delivery award was cancelled; its handed-off delivery must be cancelled in delivery-service",
	})
}

// driveDeliveryCancel sends one owed cancellation now; anything short of a
// definite answer stays pending for the sweep.
func (s *Service) driveDeliveryCancel(ctx context.Context, awardID uuid.UUID) {
	if err := s.runDeliveryCancel(ctx, awardID); err != nil {
		s.deps.Logger.Warn().Err(err).Str("award_id", awardID.String()).
			Msg("delivery cancellation unconfirmed; the sweep owns the owed cancellation")
	}
}

// sweepDeliveryCancellations drives every due owed cancellation.
func (s *Service) sweepDeliveryCancellations(ctx context.Context, now time.Time) {
	rows, err := s.deps.Store.Pool().Query(ctx, `
		SELECT award_id FROM mp.delivery_cancellations
		WHERE state = $1 AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
		ORDER BY next_attempt_at NULLS FIRST, award_id LIMIT $3`, DeliveryCancelPending, now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list owed delivery cancellations")
		return
	}
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		s.driveDeliveryCancel(ctx, id)
	}
}

// runDeliveryCancel sends one owed cancellation and records its answer.
func (s *Service) runDeliveryCancel(ctx context.Context, awardID uuid.UUID) error {
	row, err := s.deps.Store.DeliveryCancelByAward(ctx, s.deps.Store.Pool(), awardID)
	if err != nil {
		return err
	}
	if row.State != DeliveryCancelPending {
		return nil
	}
	now := s.now()
	canceller, ok := s.delivery().(DeliveryCancelPort)
	if !ok {
		cause := &DeliveryAssignError{Outcome: HandoffOutcomeMisconfigured, Message: "no delivery-service cancellation is configured"}
		s.alarmOrphanDelivery(row, cause)
		return s.parkDeliveryCancel(ctx, row, cause, now)
	}
	answer, err := canceller.Cancel(ctx, DeliveryCancelRequest{
		AwardID: row.AwardID.String(), DeliveryID: row.DeliveryID.String(),
		FencingToken: row.FencingToken, Reason: row.Reason,
	})
	if err == nil {
		return s.resolveDeliveryCancel(ctx, row, DeliveryCancelCancelled, http.StatusOK, "", answer.Status, now)
	}
	var classified *DeliveryAssignError
	if !errors.As(err, &classified) {
		return s.parkDeliveryCancel(ctx, row, err, now)
	}
	switch classified.Outcome {
	case HandoffOutcomePermanent:
		s.deps.Logger.Error().Str("award_id", row.AwardID.String()).Str("delivery_id", row.DeliveryID.String()).
			Int("status", classified.Status).Str("code", classified.Code).
			Msg("ALARM: delivery-service refused to cancel a cancelled queued award's delivery; ops must resolve it")
		return s.resolveDeliveryCancel(ctx, row, DeliveryCancelRefused, classified.Status, classified.Code, classified.Message, now)
	case HandoffOutcomeMisconfigured:
		s.alarmOrphanDelivery(row, classified)
		return s.parkDeliveryCancel(ctx, row, classified, now)
	default:
		return s.parkDeliveryCancel(ctx, row, classified, now)
	}
}

// alarmOrphanDelivery names the delivery an unconfigured deployment cannot
// cancel yet — recorded, never silent.
func (s *Service) alarmOrphanDelivery(row *DeliveryCancelRow, cause error) {
	s.deps.Logger.Error().Err(cause).Str("award_id", row.AwardID.String()).Str("delivery_id", row.DeliveryID.String()).
		Msg("ALARM: a cancelled queued award's delivery cannot be cancelled in delivery-service (misconfigured); the intent stays pending")
}

// parkDeliveryCancel records a non-definite answer and backs off.
func (s *Service) parkDeliveryCancel(ctx context.Context, row *DeliveryCancelRow, cause error, now time.Time) error {
	var status *int
	code := ""
	var classified *DeliveryAssignError
	if errors.As(cause, &classified) {
		if classified.Status != 0 {
			value := classified.Status
			status = &value
		}
		code = classified.Code
	}
	if _, err := s.deps.Store.Pool().Exec(ctx, `
		UPDATE mp.delivery_cancellations SET attempts = attempts + 1, last_status = $2, last_code = $3,
			last_error = $4, next_attempt_at = $5, updated_at = $6
		WHERE award_id = $1 AND state = $7`,
		row.AwardID, status, nullable(code), truncateError(cause), now.Add(stepBackoff(row.Attempts)), now, DeliveryCancelPending); err != nil {
		s.deps.Logger.Error().Err(err).Msg("could not park the owed delivery cancellation")
	}
	return cause
}

// resolveDeliveryCancel records a definite answer with its audit row.
func (s *Service) resolveDeliveryCancel(ctx context.Context, row *DeliveryCancelRow, state string, status int, code, detail string, now time.Time) error {
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE mp.delivery_cancellations SET state = $2, attempts = attempts + 1, last_status = $3,
				last_code = $4, last_error = $5, resolved_at = $6, next_attempt_at = NULL, updated_at = $6
			WHERE award_id = $1 AND state = $7`,
			row.AwardID, state, status, nullable(code), nullable(truncateRunes(detail, 500)), now, DeliveryCancelPending)
		if err != nil {
			return fmt.Errorf("failed to record the delivery cancellation answer: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		action, reason := "mp.delivery.cancelled", "delivery-service cancelled the queued award's delivery"
		if state == DeliveryCancelRefused {
			action, reason = "mp.delivery.cancel_refused", "delivery-service refused to cancel the queued award's delivery; ops must resolve it"
		}
		return writeAudit(ctx, tx, AuditRecord{
			ActorID:     "ride-service",
			ActorRole:   "system",
			Action:      action,
			SubjectType: subjectAward,
			SubjectID:   row.AwardID.String(),
			Before:      map[string]any{"state": DeliveryCancelPending},
			After:       map[string]any{"state": state, "deliveryId": row.DeliveryID.String(), "status": status, "code": code},
			Reason:      reason,
		})
	})
}

// DeliveryCancelByAward reads one award's owed cancellation.
func (s *Store) DeliveryCancelByAward(ctx context.Context, db DB, awardID uuid.UUID) (*DeliveryCancelRow, error) {
	var row DeliveryCancelRow
	err := db.QueryRow(ctx, `
		SELECT award_id, delivery_id, fencing_token, reason, state, attempts, last_status,
			COALESCE(last_code, ''), COALESCE(last_error, ''), resolved_at
		FROM mp.delivery_cancellations WHERE award_id = $1`, awardID).Scan(
		&row.AwardID, &row.DeliveryID, &row.FencingToken, &row.Reason, &row.State, &row.Attempts, &row.LastStatus,
		&row.LastCode, &row.LastError, &row.ResolvedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read the owed delivery cancellation: %w", err)
	}
	return &row, nil
}
