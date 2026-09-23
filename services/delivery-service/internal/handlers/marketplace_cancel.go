/*
 * Marketplace cancellation (the compensation of MarketplaceAssign).
 *
 * A service=delivery award is handed off to this service before it is
 * confirmed (MarketplaceAssign), so a QUEUED delivery award already has a
 * delivery here, assigned to the winning driver. When ride-service later
 * cancels that queued award — the requester's fee-free exit after a missed
 * window, the driver-failure recovery, a passenger's decline — it owes this
 * service a cancellation (services/ride-service/internal/marketplace/
 * delivery_cancel.go writes the intent in the award's own transaction and
 * drives it until it gets a definite answer):
 *
 *	POST /api/v1/webhooks/marketplace-cancel     (ServiceAuth: X-Service-Key)
 *	{"awardId", "deliveryId", "fencingToken", "reason"}
 *
 *	200 {success, data:{id, status:"CANCELLED", marketplaceAwardId, ...}}
 *	    — also the replay for a delivery this award already cancelled;
 *	404 DELIVERY_NOT_FOUND       no delivery was ever made for this award;
 *	409 AWARD_REPLAY_MISMATCH    the award's delivery is another one, or the
 *	                             fencing token is not the one it was handed
 *	                             off under;
 *	409 DELIVERY_NOT_CANCELLABLE custody has moved past assignment (the
 *	                             parcel is with the driver or beyond): it is
 *	                             never silently cancelled — ops resolves it;
 *	400 INVALID_JSON / VALIDATION_ERROR;
 *	503 SERVICE_KEY_NOT_CONFIGURED under an empty or committed-default key.
 *
 * Only a delivery whose custody is still `courier_assigned` (or `created`) is
 * cancelled: custody, the legacy delivery row, one custody_events row, the
 * shipment.cancelled outbox event and the audit row commit together, under a
 * row lock on the custody row, so a pickup racing the cancellation resolves
 * to exactly one of the two. This service moves no money: the commission is
 * reversed by ride-service with the award, never here.
 */

package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/custody"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/models"
)

// Keys the cancellation adds to deliveries.marketplace_metadata (the
// hand-off's own metadata, next to the award linkage MarketplaceAssign wrote).
const (
	packageKeyCancelledAt  = "marketplaceCancelledAt"
	packageKeyCancelReason = "marketplaceCancelReason"
)

// marketplaceCancelActor is who the audit row and the outbox event name as
// the actor: the marketplace engine, the only holder of the service key
// that cancels a queued award's delivery.
const marketplaceCancelActor = "ride-service"

// maxCancelReasonLength bounds the reason code ride-service sends
// (driver_offline, window_missed, passenger_declined, ...).
const maxCancelReasonLength = 200

// MarketplaceCancelRequest is the body of POST
// /api/v1/webhooks/marketplace-cancel (ride-service's DeliveryCancelRequest).
type MarketplaceCancelRequest struct {
	AwardID      string `json:"awardId"`
	DeliveryID   string `json:"deliveryId"`
	FencingToken *int64 `json:"fencingToken"`
	Reason       string `json:"reason"`
}

// marketplaceCancellation is the 200 answer, for the first call and every
// replay alike.
type marketplaceCancellation struct {
	ID                 string     `json:"id"`
	Status             string     `json:"status"`
	MarketplaceAwardID string     `json:"marketplaceAwardId"`
	CustodyState       string     `json:"custodyState"`
	CancelledAt        *time.Time `json:"cancelledAt"`
}

// validateMarketplaceCancel returns the list of field problems in a
// cancellation payload. Pure — unit-tested without a database.
func validateMarketplaceCancel(req *MarketplaceCancelRequest) []string {
	var problems []string
	if strings.TrimSpace(req.AwardID) == "" {
		problems = append(problems, "awardId is required")
	}
	if req.DeliveryID == "" {
		problems = append(problems, "deliveryId is required")
	} else if _, err := uuid.Parse(req.DeliveryID); err != nil {
		problems = append(problems, "deliveryId must be the delivery's id (a UUID)")
	}
	if req.FencingToken == nil {
		problems = append(problems, "fencingToken is required")
	} else if *req.FencingToken < 0 {
		problems = append(problems, "fencingToken must be a non-negative integer")
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		problems = append(problems, "reason is required")
	} else if len(reason) > maxCancelReasonLength {
		problems = append(problems, "reason must be a short reason code")
	}
	return problems
}

// cancellableCustody reports whether a custody state still allows the
// marketplace to take the delivery back: nothing has been picked up. Pure.
func cancellableCustody(state string) bool {
	return (state == custody.CourierAssigned || state == custody.Created) && custody.Can(state, custody.Cancelled)
}

// awardDelivery is the delivery an award handed off, with its custody row.
type awardDelivery struct {
	DeliveryID   string
	FencingToken int64
	CustodyID    *string
	SenderID     *string
	DriverID     *string
}

// findAwardDelivery returns the delivery MarketplaceAssign created for the
// award, or pgx.ErrNoRows.
func (h *Handler) findAwardDelivery(ctx context.Context, awardID string) (*awardDelivery, error) {
	var d awardDelivery
	err := h.db.Pool.QueryRow(ctx, `
		SELECT d.id::text,
			COALESCE((d.marketplace_metadata->>'`+packageKeyFencingToken+`')::bigint, -1),
			c.id::text, c.sender_id::text, c.driver_id::text
		FROM deliveries d
		LEFT JOIN delivery_custody c ON c.delivery_id = d.id
		WHERE d.marketplace_metadata->>'`+packageKeyMarketplaceAwardID+`' = $1
		LIMIT 1`, awardID).Scan(&d.DeliveryID, &d.FencingToken, &d.CustodyID, &d.SenderID, &d.DriverID)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// errDeliveryNotCancellable carries the custody state that refused.
type errDeliveryNotCancellable struct{ state string }

func (e errDeliveryNotCancellable) Error() string { return "custody is " + e.state }

func respondNotCancellable(w http.ResponseWriter, state string) {
	message := "Custody has moved past assignment (" + state + "): the parcel is with the driver or beyond, " +
		"so this delivery cannot be cancelled here; ops must resolve it"
	if state == "" {
		message = "This delivery has no custody tracking, so it cannot be cancelled here; ops must resolve it"
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusConflict)
	_ = json.NewEncoder(w).Encode(response{
		Success: false,
		Error: &errorInfo{
			Code:    "DELIVERY_NOT_CANCELLABLE",
			Message: message,
			Details: map[string]string{"custodyState": state},
		},
	})
}

// MarketplaceCancel handles POST /api/v1/webhooks/marketplace-cancel
// (ServiceAuth). Idempotent on awardId: a replay for a delivery this award
// already cancelled answers 200 with the same body.
func (h *Handler) MarketplaceCancel(w http.ResponseWriter, r *http.Request) {
	// Same fail-closed rule as MarketplaceAssign: under an empty or
	// committed-default key the ServiceAuth match proves nothing.
	if !marketplaceAssignKeyUsable(h.cfg.InternalServiceKey) {
		respondError(w, http.StatusServiceUnavailable, "SERVICE_KEY_NOT_CONFIGURED",
			"Marketplace cancellation is disabled: INTERNAL_SERVICE_KEY must be set to a non-default value")
		return
	}

	var req MarketplaceCancelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid request body")
		return
	}
	if problems := validateMarketplaceCancel(&req); len(problems) > 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(response{
			Success: false,
			Error: &errorInfo{
				Code:    "VALIDATION_ERROR",
				Message: "Invalid marketplace cancellation payload",
				Details: problems,
			},
		})
		return
	}
	reason := strings.TrimSpace(req.Reason)

	found, err := h.findAwardDelivery(r.Context(), req.AwardID)
	if errors.Is(err, pgx.ErrNoRows) {
		respondError(w, http.StatusNotFound, "DELIVERY_NOT_FOUND", "No delivery was handed off for this award")
		return
	}
	if err != nil {
		log.Error().Err(err).Str("awardId", req.AwardID).Msg("Failed to look up the award's delivery")
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to look up the delivery")
		return
	}
	if found.DeliveryID != req.DeliveryID {
		respondError(w, http.StatusConflict, "AWARD_REPLAY_MISMATCH", "This award's delivery is another one")
		return
	}
	// The fencing token is the award claim's: the delivery was handed off
	// under it and only that claim may take it back. A different token is a
	// stale (or foreign) holder, never a reason to cancel.
	if found.FencingToken != *req.FencingToken {
		respondError(w, http.StatusConflict, "AWARD_REPLAY_MISMATCH",
			"This cancellation's fencing token is not the one the delivery was handed off under")
		return
	}
	if found.CustodyID == nil {
		respondNotCancellable(w, "")
		return
	}

	answer, err := h.cancelAwardDelivery(r.Context(), found, req.AwardID, *req.FencingToken, reason)
	var refused errDeliveryNotCancellable
	if errors.As(err, &refused) {
		respondNotCancellable(w, refused.state)
		return
	}
	if err != nil {
		log.Error().Err(err).Str("awardId", req.AwardID).Str("deliveryId", req.DeliveryID).
			Msg("Failed to cancel the marketplace delivery")
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to cancel the delivery")
		return
	}
	respond(w, http.StatusOK, answer)
}

// cancelAwardDelivery moves a still-assigned delivery's custody to
// cancelled — or recognises one this award already cancelled — under a row
// lock on the custody row. Everything it writes commits together.
func (h *Handler) cancelAwardDelivery(ctx context.Context, found *awardDelivery, awardID string, fencingToken int64, reason string) (*marketplaceCancellation, error) {
	tx, err := h.db.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var state string
	var version int
	var cancelledAt *time.Time
	if err := tx.QueryRow(ctx, `
		SELECT state, version, cancelled_at FROM delivery_custody WHERE id = $1 FOR UPDATE`,
		*found.CustodyID).Scan(&state, &version, &cancelledAt); err != nil {
		return nil, err
	}
	answer := &marketplaceCancellation{
		ID:                 found.DeliveryID,
		Status:             string(models.DeliveryStatusCancelled),
		MarketplaceAwardID: awardID,
		CustodyState:       custody.Cancelled,
	}
	if state == custody.Cancelled {
		// The replay: this award (the lookup is by award id, and the delivery
		// id and fencing token matched) already cancelled it.
		answer.CancelledAt = cancelledAt
		return answer, nil
	}
	if !cancellableCustody(state) {
		return nil, errDeliveryNotCancellable{state: state}
	}

	now := time.Now().UTC()
	if _, err := tx.Exec(ctx, `
		UPDATE delivery_custody
		SET state = $1, version = version + 1, cancelled_at = $2, updated_at = $2
		WHERE id = $3`, custody.Cancelled, now, *found.CustodyID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO custody_events (custody_id, delivery_id, from_state, to_state, actor_type, actor_id, reason, created_at)
		VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)`,
		*found.CustodyID, found.DeliveryID, state, custody.Cancelled, custody.ActorSystem,
		"marketplace_award_cancelled:"+reason, now); err != nil {
		return nil, err
	}
	// The legacy status column has no CANCELLED member (Prisma
	// DeliveryStatus); FAILED is its only terminal not-delivered value, so
	// legacy lists stop showing the delivery as active. Custody (cancelled)
	// is the source of truth, and the metadata says why.
	cancelMeta, err := json.Marshal(map[string]any{
		packageKeyCancelledAt:  now.Format(time.RFC3339),
		packageKeyCancelReason: reason,
	})
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE deliveries
		SET status = 'FAILED', marketplace_metadata = COALESCE(marketplace_metadata, '{}'::jsonb) || $1::jsonb, updated_at = $2
		WHERE id = $3`, cancelMeta, now, found.DeliveryID); err != nil {
		return nil, err
	}

	from := version
	var senderID, driverID any
	if found.SenderID != nil {
		senderID = *found.SenderID
	}
	if found.DriverID != nil {
		driverID = *found.DriverID
	}
	if err := writeOutboxEvent(ctx, tx, outboxEvent{
		Name:           EventShipmentCancelled,
		AggregateID:    found.DeliveryID,
		FromVersion:    &from,
		ToVersion:      version + 1,
		ActorType:      envelopeActorSystem,
		ActorID:        marketplaceCancelActor,
		IdempotencyKey: EventShipmentCancelled + ":" + found.DeliveryID,
		OccurredAt:     now,
		Payload: map[string]any{
			"deliveryId":         found.DeliveryID,
			"custodyId":          *found.CustodyID,
			"marketplaceAwardId": awardID,
			"senderId":           senderID,
			"driverId":           driverID,
			"reason":             reason,
			"fromState":          state,
		},
	}); err != nil {
		return nil, err
	}
	if err := writeAuditRow(ctx, tx, auditRecord{
		ActorID:     marketplaceCancelActor,
		ActorRole:   "service",
		Action:      "delivery.marketplace_cancelled",
		SubjectType: "delivery",
		SubjectID:   found.DeliveryID,
		Before:      map[string]any{"custodyState": state, "custodyVersion": version},
		After: map[string]any{
			"custodyState": custody.Cancelled, "custodyVersion": version + 1,
			"marketplaceAwardId": awardID, "fencingToken": fencingToken,
		},
		Reason: "the queued marketplace award was cancelled (" + reason + ")",
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	answer.CancelledAt = &now
	return answer, nil
}
