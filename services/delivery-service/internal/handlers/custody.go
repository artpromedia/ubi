/*
 * Delivery custody and returns (C07, G08).
 *
 * The tables this file reads/writes (delivery_custody, custody_events,
 * delivery_proofs, delivery_returns) are Prisma-owned, exactly like
 * `deliveries` itself (packages/database/prisma, migration
 * 20260921031850_delivery_custody) — this service contains zero CREATE TABLE.
 * It reaches them through the same pgx pool and raw SQL it already uses for
 * `deliveries`.
 *
 * Only marketplace-managed deliveries have a delivery_custody row (seeded by
 * MarketplaceAssign — see custodyForMarketplaceAssign in marketplace.go). A
 * legacy open-market delivery, an unknown delivery id, or an actor who is
 * neither the delivery's sender nor its assigned driver all answer 404,
 * matching the marketplace 404 convention: existence is not revealed to a
 * foreign caller.
 */

package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/custody"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/identity"
)

// custodyRecord is the delivery_custody row plus the fields handlers need.
type custodyRecord struct {
	ID         string
	DeliveryID string
	State      string
	Version    int
	SenderID   string
	DriverID   *string
}

func (c *custodyRecord) isSender(actor identity.Actor) bool {
	return c.SenderID == actor.UserID.String()
}

func (c *custodyRecord) isAssignedDriver(actor identity.Actor) bool {
	return c.DriverID != nil && *c.DriverID == actor.UserID.String()
}

// custodyError carries the HTTP status and canonical code for a failure
// inside this file, so every handler can respond the same way through one
// writeCustodyError call.
type custodyError struct {
	status  int
	code    string
	message string
}

func (e *custodyError) Error() string { return e.message }

func errNotFound() *custodyError {
	return &custodyError{http.StatusNotFound, "NOT_FOUND", "No delivery with custody tracking was found for this caller"}
}
func errForbidden(message string) *custodyError {
	return &custodyError{http.StatusForbidden, "FORBIDDEN", message}
}
func errValidation(message string) *custodyError {
	return &custodyError{http.StatusBadRequest, "VALIDATION_ERROR", message}
}
func errConflict(message string) *custodyError {
	return &custodyError{http.StatusConflict, "STATE_CONFLICT", message}
}
func errChargeUnsupported() *custodyError {
	return &custodyError{
		http.StatusConflict, "RETURN_CHARGE_UNSUPPORTED",
		"This return proposes a fee, and delivery-service has no authorized funding path to collect it. " +
			"It cannot complete the charged leg — resolve it as a fee-free return, or let it default to a hold point.",
	}
}

func writeCustodyError(w http.ResponseWriter, err error) {
	if custErr, ok := err.(*custodyError); ok {
		respondError(w, custErr.status, custErr.code, custErr.message)
		return
	}
	respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "custody operation failed")
}

// loadCustodyForActor loads the delivery's custody row and refuses (404)
// unless the caller is the delivery's sender or its assigned driver. This is
// the ONE gate every custody/return handler goes through before touching
// state, so a cross-tenant/foreign-actor request is indistinguishable from
// the delivery not existing at all.
func (h *Handler) loadCustodyForActor(ctx context.Context, deliveryID string, actor identity.Actor) (*custodyRecord, *custodyError) {
	if _, err := uuid.Parse(deliveryID); err != nil {
		return nil, errNotFound()
	}
	var rec custodyRecord
	err := h.db.Pool.QueryRow(ctx, `
		SELECT id, delivery_id, state, version, sender_id, driver_id
		FROM delivery_custody
		WHERE delivery_id = $1
	`, deliveryID).Scan(&rec.ID, &rec.DeliveryID, &rec.State, &rec.Version, &rec.SenderID, &rec.DriverID)
	if err != nil {
		return nil, errNotFound()
	}
	if !rec.isSender(actor) && !rec.isAssignedDriver(actor) && actor.Role != identity.RoleAdmin {
		return nil, errNotFound()
	}
	return &rec, nil
}

// buildChain validates a sequence of states against the contract machine and
// returns the from/to pairs to log. It refuses (rather than silently
// truncating) the moment an intermediate hop is illegal.
func buildChain(states ...string) ([][2]string, error) {
	hops := make([][2]string, 0, len(states)-1)
	for i := 0; i+1 < len(states); i++ {
		if err := custody.Assert(states[i], states[i+1]); err != nil {
			return nil, err
		}
		hops = append(hops, [2]string{states[i], states[i+1]})
	}
	return hops, nil
}

// applyChain atomically CASes delivery_custody.state from cst.State to the
// chain's final state (WHERE id = ... AND version = ...), and logs one
// custody_events row per hop. side, when non-nil, runs inside the SAME
// transaction (e.g. to also write a delivery_proofs or delivery_returns row),
// so a proof/return row and its custody transition commit together or not at
// all. Returns errConflict when another request already moved this custody
// row (the version no longer matches) — this is the single point that makes
// two concurrent transitions from the same state resolve to exactly one
// winner.
func (h *Handler) applyChain(
	ctx context.Context, cst *custodyRecord, states []string,
	actorType string, actorID *uuid.UUID, reason string,
	side func(ctx context.Context, tx pgx.Tx) error,
) error {
	if len(states) < 2 || states[0] != cst.State {
		return errConflict("the delivery's custody state has changed; re-fetch the timeline and retry")
	}
	hops, err := buildChain(states...)
	if err != nil {
		return errValidation(err.Error())
	}
	finalState := states[len(states)-1]

	tx, err := h.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		UPDATE delivery_custody
		SET state = $1, version = version + 1, updated_at = now(),
			picked_up_at = CASE WHEN $1 = 'in_transit' AND picked_up_at IS NULL THEN now() ELSE picked_up_at END,
			delivered_at = CASE WHEN $1 = 'delivered' THEN now() ELSE delivered_at END,
			cancelled_at = CASE WHEN $1 = 'cancelled' THEN now() ELSE cancelled_at END,
			recipient_unreachable_at = CASE WHEN $1 = 'recipient_unreachable' AND recipient_unreachable_at IS NULL THEN now() ELSE recipient_unreachable_at END
		WHERE id = $2 AND version = $3
	`, finalState, cst.ID, cst.Version)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errConflict("the delivery's custody state has changed; re-fetch the timeline and retry")
	}

	var actorIDStr *string
	if actorID != nil {
		s := actorID.String()
		actorIDStr = &s
	}
	for _, hop := range hops {
		if _, err := tx.Exec(ctx, `
			INSERT INTO custody_events (custody_id, delivery_id, from_state, to_state, actor_type, actor_id, reason, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, now())
		`, cst.ID, cst.DeliveryID, hop[0], hop[1], actorType, actorIDStr, reason); err != nil {
			return err
		}
	}

	if side != nil {
		if err := side(ctx, tx); err != nil {
			return err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	cst.State = finalState
	cst.Version++
	return nil
}

// ============================================
// Proofs
// ============================================

type proofRequest struct {
	ObjectKey   string `json:"objectKey"`
	ContentType string `json:"contentType"`
	SizeBytes   int64  `json:"sizeBytes"`
	SHA256      string `json:"sha256"`
}

// postProof is the shared body for pickup-proof and delivery-proof: validate
// the reference, short-circuit on an exact idempotent replay (no second row,
// whatever the current state is), otherwise insert the proof row and apply
// the state chain in one transaction.
func (h *Handler) postProof(w http.ResponseWriter, r *http.Request, proofType string, chainFor func(current string) []string) {
	deliveryID := chi.URLParam(r, "id")
	actor, ok := identity.ActorFrom(r.Context())
	if !ok {
		writeCustodyError(w, errNotFound())
		return
	}
	if actor.Role != identity.RoleDriver {
		writeCustodyError(w, errForbidden("only the assigned driver may post a "+proofType+" proof"))
		return
	}
	cst, cerr := h.loadCustodyForActor(r.Context(), deliveryID, actor)
	if cerr != nil {
		writeCustodyError(w, cerr)
		return
	}
	if !cst.isAssignedDriver(actor) {
		writeCustodyError(w, errNotFound())
		return
	}

	var req proofRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCustodyError(w, errValidation("invalid request body"))
		return
	}
	sha := strings.ToLower(strings.TrimSpace(req.SHA256))
	problems := custody.ValidateProof(custody.ProofInput{
		ObjectKey: req.ObjectKey, ContentType: req.ContentType, SizeBytes: req.SizeBytes, SHA256: sha,
	})
	if len(problems) > 0 {
		respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", strings.Join(problems, "; "))
		return
	}

	// Idempotent replay: an identical proof (same delivery, type, checksum)
	// already recorded means this exact submission was seen before —
	// answer with the existing row, touch nothing else, whatever the current
	// custody state is now.
	var existingID string
	err := h.db.Pool.QueryRow(r.Context(), `
		SELECT id FROM delivery_proofs WHERE delivery_id = $1 AND type = $2 AND sha256 = $3
	`, deliveryID, proofType, sha).Scan(&existingID)
	if err == nil {
		respond(w, http.StatusOK, map[string]interface{}{
			"proofId": existingID, "deliveryId": deliveryID, "type": proofType,
			"replay": true, "custodyState": cst.State,
		})
		return
	}

	chain := chainFor(cst.State)
	if chain == nil {
		writeCustodyError(w, errConflict("a "+proofType+" proof cannot be posted from custody state "+cst.State))
		return
	}

	var proofID string
	err = h.applyChain(r.Context(), cst, chain, custody.ActorDriver, &actor.UserID, proofType+"_proof_recorded",
		func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx, `
				INSERT INTO delivery_proofs (delivery_id, custody_id, type, object_key, content_type, size_bytes, sha256, uploaded_by, uploaded_role, created_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
				ON CONFLICT (delivery_id, type, sha256) DO UPDATE SET delivery_id = EXCLUDED.delivery_id
				RETURNING id
			`, deliveryID, cst.ID, proofType, req.ObjectKey, req.ContentType, req.SizeBytes, sha, actor.UserID.String(), actor.Role).Scan(&proofID)
		})
	if err != nil {
		writeCustodyError(w, err)
		return
	}

	respond(w, http.StatusCreated, map[string]interface{}{
		"proofId": proofID, "deliveryId": deliveryID, "type": proofType,
		"replay": false, "custodyState": cst.State,
	})
}

// PostPickupProof handles POST /api/v1/deliveries/{id}/custody/pickup-proof.
// Driver only. courier_assigned -> picked_up -> in_transit (a pickup starts
// transit immediately; there is no separate "start transit" action).
func (h *Handler) PostPickupProof(w http.ResponseWriter, r *http.Request) {
	h.postProof(w, r, custody.ProofPickup, func(current string) []string {
		if current == custody.CourierAssigned {
			return []string{custody.CourierAssigned, custody.PickedUp, custody.InTransit}
		}
		return nil
	})
}

// PostDeliveryProof handles POST /api/v1/deliveries/{id}/custody/delivery-proof.
// Driver only. Reaches `delivered` from in_transit, delivery_attempted,
// delivery_retry directly, or from recipient_unreachable by chaining through
// delivery_retry (a successful retry IS a delivery proof; there is no
// separate "start retry" action).
func (h *Handler) PostDeliveryProof(w http.ResponseWriter, r *http.Request) {
	h.postProof(w, r, custody.ProofDelivery, func(current string) []string {
		switch current {
		case custody.InTransit, custody.DeliveryAttempted, custody.DeliveryRetry:
			return []string{current, custody.Delivered}
		case custody.RecipientUnreachable:
			return []string{custody.RecipientUnreachable, custody.DeliveryRetry, custody.Delivered}
		default:
			return nil
		}
	})
}

// ============================================
// Recipient unreachable
// ============================================

type recipientUnreachableRequest struct {
	Reason string `json:"reason"`
}

// PostRecipientUnreachable handles
// POST /api/v1/deliveries/{id}/custody/recipient-unreachable. Driver only.
// Starts the return/hold-point timer (delivery_custody.recipient_unreachable_at).
func (h *Handler) PostRecipientUnreachable(w http.ResponseWriter, r *http.Request) {
	deliveryID := chi.URLParam(r, "id")
	actor, ok := identity.ActorFrom(r.Context())
	if !ok {
		writeCustodyError(w, errNotFound())
		return
	}
	if actor.Role != identity.RoleDriver {
		writeCustodyError(w, errForbidden("only the assigned driver may report the recipient as unreachable"))
		return
	}
	cst, cerr := h.loadCustodyForActor(r.Context(), deliveryID, actor)
	if cerr != nil {
		writeCustodyError(w, cerr)
		return
	}
	if !cst.isAssignedDriver(actor) {
		writeCustodyError(w, errNotFound())
		return
	}

	var req recipientUnreachableRequest
	_ = json.NewDecoder(r.Body).Decode(&req) // reason is optional

	var chain []string
	switch cst.State {
	case custody.InTransit:
		chain = []string{custody.InTransit, custody.DeliveryAttempted, custody.RecipientUnreachable}
	case custody.DeliveryAttempted:
		chain = []string{custody.DeliveryAttempted, custody.RecipientUnreachable}
	default:
		writeCustodyError(w, errConflict("recipient-unreachable cannot be reported from custody state "+cst.State))
		return
	}

	if err := h.applyChain(r.Context(), cst, chain, custody.ActorDriver, &actor.UserID, req.Reason, nil); err != nil {
		writeCustodyError(w, err)
		return
	}

	respond(w, http.StatusOK, map[string]interface{}{
		"deliveryId": deliveryID, "custodyState": cst.State,
	})
}

// ============================================
// Returns
// ============================================

type proposeReturnRequest struct {
	Reason   string `json:"reason"`
	FeeMinor int64  `json:"feeMinor"`
	Currency string `json:"currency"`
}

// PostProposeReturn handles POST /api/v1/deliveries/{id}/custody/return/propose.
// Sender or assigned driver. recipient_unreachable -> return_proposed. A
// proposed fee is recorded honestly (custody.ResolveChargeStatus) but never
// authorizes a charge — see internal/custody/rules.go.
func (h *Handler) PostProposeReturn(w http.ResponseWriter, r *http.Request) {
	deliveryID := chi.URLParam(r, "id")
	actor, ok := identity.ActorFrom(r.Context())
	if !ok {
		writeCustodyError(w, errNotFound())
		return
	}
	cst, cerr := h.loadCustodyForActor(r.Context(), deliveryID, actor)
	if cerr != nil {
		writeCustodyError(w, cerr)
		return
	}
	isSender := cst.isSender(actor)
	isDriver := cst.isAssignedDriver(actor)
	if !isSender && !isDriver {
		writeCustodyError(w, errNotFound())
		return
	}
	if cst.State != custody.RecipientUnreachable {
		writeCustodyError(w, errConflict("a return can only be proposed while the recipient is unreachable, not from state "+cst.State))
		return
	}

	var req proposeReturnRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCustodyError(w, errValidation("invalid request body"))
		return
	}
	if strings.TrimSpace(req.Reason) == "" {
		writeCustodyError(w, errValidation("reason is required"))
		return
	}
	if req.FeeMinor < 0 {
		writeCustodyError(w, errValidation("feeMinor must not be negative"))
		return
	}
	if req.FeeMinor > 0 && len(req.Currency) != 3 {
		writeCustodyError(w, errValidation("currency is required when feeMinor is positive"))
		return
	}

	chargeStatus := custody.ResolveChargeStatus(req.FeeMinor)
	proposedAt := time.Now().UTC()
	expiresAt := custody.ConsentExpiresAt(proposedAt)
	actorType := custody.ActorDriver
	if isSender {
		actorType = custody.ActorSender
	}

	var returnID string
	err := h.applyChain(r.Context(), cst,
		[]string{custody.RecipientUnreachable, custody.ReturnProposed},
		actorType, &actor.UserID, req.Reason,
		func(ctx context.Context, tx pgx.Tx) error {
			var currency *string
			if req.Currency != "" {
				currency = &req.Currency
			}
			return tx.QueryRow(ctx, `
				INSERT INTO delivery_returns (
					delivery_id, custody_id, reason, fee_minor, currency, charge_status,
					proposed_by, proposed_by_role, proposed_at, consent_state, consent_expires_at, created_at, updated_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
				RETURNING id
			`, deliveryID, cst.ID, req.Reason, req.FeeMinor, currency, chargeStatus,
				actor.UserID.String(), actor.Role, proposedAt, custody.ConsentPending, expiresAt).Scan(&returnID)
		})
	if err != nil {
		writeCustodyError(w, err)
		return
	}

	respond(w, http.StatusCreated, map[string]interface{}{
		"returnId": returnID, "deliveryId": deliveryID, "custodyState": cst.State,
		"chargeStatus": chargeStatus, "consentExpiresAt": expiresAt,
	})
}

// openReturn is the current (or just-expired) delivery_returns row for a
// custody in return_proposed.
type openReturn struct {
	ID               string
	ChargeStatus     string
	ConsentState     string
	ConsentExpiresAt time.Time
	FeeMinor         int64
	Currency         *string
}

func (h *Handler) loadOpenReturn(ctx context.Context, custodyID string) (*openReturn, error) {
	var ret openReturn
	row := h.db.Pool.QueryRow(ctx, `
		SELECT id, charge_status, consent_state, consent_expires_at, fee_minor, currency
		FROM delivery_returns
		WHERE custody_id = $1
		ORDER BY proposed_at DESC
		LIMIT 1
	`, custodyID)
	if scanErr := row.Scan(&ret.ID, &ret.ChargeStatus, &ret.ConsentState, &ret.ConsentExpiresAt, &ret.FeeMinor, &ret.Currency); scanErr != nil {
		return nil, scanErr
	}
	return &ret, nil
}

// resolveExpiredReturn lazily applies the safe default (held_at_point) when a
// return_proposed custody's consent window has passed with no sender
// response. Called at the top of return/consent, collected-at-point and the
// timeline read, so an unanswered proposal converges the next time anyone
// looks rather than staying in limbo forever. Never charges anything.
func (h *Handler) resolveExpiredReturn(ctx context.Context, cst *custodyRecord) error {
	if cst.State != custody.ReturnProposed {
		return nil
	}
	ret, err := h.loadOpenReturn(ctx, cst.ID)
	if err != nil || ret.ConsentState != custody.ConsentPending {
		return nil
	}
	if !custody.ConsentWindowExpired(time.Now().UTC(), ret.ConsentExpiresAt) {
		return nil
	}
	return h.applyChain(ctx, cst,
		[]string{custody.ReturnProposed, custody.HeldAtPoint},
		custody.ActorSystem, nil, "return_consent_window_expired_defaulted_to_hold_point",
		func(ctx context.Context, tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `
				UPDATE delivery_returns SET consent_state = $1, resolved_at = now(), updated_at = now()
				WHERE id = $2
			`, custody.ConsentExpired, ret.ID)
			return err
		})
}

type returnConsentRequest struct {
	Action string `json:"action"` // "consent" | "reject"
}

// PostReturnConsent handles POST /api/v1/deliveries/{id}/custody/return/consent.
// Sender ONLY — a driver may propose a return but never authorize or refuse
// one. Accepting a fee-bearing return still cannot complete the charged leg
// (errChargeUnsupported); rejecting always succeeds and defaults to a hold
// point, same as an unanswered expiry.
func (h *Handler) PostReturnConsent(w http.ResponseWriter, r *http.Request) {
	deliveryID := chi.URLParam(r, "id")
	actor, ok := identity.ActorFrom(r.Context())
	if !ok {
		writeCustodyError(w, errNotFound())
		return
	}
	cst, cerr := h.loadCustodyForActor(r.Context(), deliveryID, actor)
	if cerr != nil {
		writeCustodyError(w, cerr)
		return
	}
	if !cst.isSender(actor) {
		if cst.isAssignedDriver(actor) {
			writeCustodyError(w, errForbidden("only the sender may consent to or reject a return"))
			return
		}
		writeCustodyError(w, errNotFound())
		return
	}

	if err := h.resolveExpiredReturn(r.Context(), cst); err != nil {
		writeCustodyError(w, err)
		return
	}
	if cst.State != custody.ReturnProposed {
		writeCustodyError(w, errConflict("there is no pending return proposal to respond to (custody state is "+cst.State+")"))
		return
	}

	var req returnConsentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCustodyError(w, errValidation("invalid request body"))
		return
	}

	ret, err := h.loadOpenReturn(r.Context(), cst.ID)
	if err != nil {
		writeCustodyError(w, errConflict("no return proposal was found to respond to"))
		return
	}

	switch req.Action {
	case "reject":
		err = h.applyChain(r.Context(), cst,
			[]string{custody.ReturnProposed, custody.HeldAtPoint},
			custody.ActorSender, &actor.UserID, "return_rejected_by_sender",
			func(ctx context.Context, tx pgx.Tx) error {
				_, e := tx.Exec(ctx, `UPDATE delivery_returns SET consent_state = $1, resolved_at = now(), resolved_by = $2, updated_at = now() WHERE id = $3`,
					custody.ConsentRejected, actor.UserID.String(), ret.ID)
				return e
			})
		if err != nil {
			writeCustodyError(w, err)
			return
		}
		respond(w, http.StatusOK, map[string]interface{}{"deliveryId": deliveryID, "custodyState": cst.State, "consentState": custody.ConsentRejected})
		return

	case "consent":
		if !custody.CanCompleteReturn(ret.ChargeStatus) {
			writeCustodyError(w, errChargeUnsupported())
			return
		}
		err = h.applyChain(r.Context(), cst,
			[]string{custody.ReturnProposed, custody.ReturnConsented, custody.Returning, custody.ReturnToSender},
			custody.ActorSender, &actor.UserID, "return_consented_by_sender",
			func(ctx context.Context, tx pgx.Tx) error {
				_, e := tx.Exec(ctx, `UPDATE delivery_returns SET consent_state = $1, resolved_at = now(), resolved_by = $2, updated_at = now() WHERE id = $3`,
					custody.ConsentConsented, actor.UserID.String(), ret.ID)
				return e
			})
		if err != nil {
			writeCustodyError(w, err)
			return
		}
		respond(w, http.StatusOK, map[string]interface{}{"deliveryId": deliveryID, "custodyState": cst.State, "consentState": custody.ConsentConsented})
		return

	default:
		writeCustodyError(w, errValidation(`action must be "consent" or "reject"`))
	}
}

// ============================================
// Collected at point
// ============================================

// PostCollectedAtPoint handles POST /api/v1/deliveries/{id}/custody/collected.
// Assigned driver or ops (admin). held_at_point -> collected. Also accepts a
// direct hand-off from recipient_unreachable or return_proposed (chained
// through held_at_point) so a driver taking the parcel straight to a hold
// point, or a hold point reached by rejection/expiry, converge on the same
// single endpoint.
func (h *Handler) PostCollectedAtPoint(w http.ResponseWriter, r *http.Request) {
	deliveryID := chi.URLParam(r, "id")
	actor, ok := identity.ActorFrom(r.Context())
	if !ok {
		writeCustodyError(w, errNotFound())
		return
	}
	cst, cerr := h.loadCustodyForActor(r.Context(), deliveryID, actor)
	if cerr != nil {
		writeCustodyError(w, cerr)
		return
	}
	if !cst.isAssignedDriver(actor) && actor.Role != identity.RoleAdmin {
		if cst.isSender(actor) {
			writeCustodyError(w, errForbidden("only the assigned driver or ops may confirm collection at a hold point"))
			return
		}
		writeCustodyError(w, errNotFound())
		return
	}

	if err := h.resolveExpiredReturn(r.Context(), cst); err != nil {
		writeCustodyError(w, err)
		return
	}

	actorType := custody.ActorDriver
	if actor.Role == identity.RoleAdmin {
		actorType = custody.ActorOps
	}

	var chain []string
	switch cst.State {
	case custody.HeldAtPoint:
		chain = []string{custody.HeldAtPoint, custody.Collected}
	case custody.RecipientUnreachable:
		chain = []string{custody.RecipientUnreachable, custody.HeldAtPoint, custody.Collected}
	case custody.ReturnProposed:
		chain = []string{custody.ReturnProposed, custody.HeldAtPoint, custody.Collected}
	default:
		writeCustodyError(w, errConflict("collected-at-point is not valid from custody state "+cst.State))
		return
	}

	if err := h.applyChain(r.Context(), cst, chain, actorType, &actor.UserID, "collected_at_point", nil); err != nil {
		writeCustodyError(w, err)
		return
	}

	respond(w, http.StatusOK, map[string]interface{}{"deliveryId": deliveryID, "custodyState": cst.State})
}

// ============================================
// Timeline
// ============================================

type custodyEventView struct {
	FromState string    `json:"fromState,omitempty"`
	ToState   string    `json:"toState"`
	ActorType string    `json:"actorType"`
	Reason    string    `json:"reason,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// GetCustodyTimeline handles GET /api/v1/deliveries/{id}/custody. Sender or
// assigned driver only; anyone else (including a genuine but unrelated
// account) sees 404, same as every other handler in this file.
func (h *Handler) GetCustodyTimeline(w http.ResponseWriter, r *http.Request) {
	deliveryID := chi.URLParam(r, "id")
	actor, ok := identity.ActorFrom(r.Context())
	if !ok {
		writeCustodyError(w, errNotFound())
		return
	}
	cst, cerr := h.loadCustodyForActor(r.Context(), deliveryID, actor)
	if cerr != nil {
		writeCustodyError(w, cerr)
		return
	}
	if !cst.isSender(actor) && !cst.isAssignedDriver(actor) {
		writeCustodyError(w, errNotFound())
		return
	}

	if err := h.resolveExpiredReturn(r.Context(), cst); err != nil {
		writeCustodyError(w, err)
		return
	}

	rows, err := h.db.Pool.Query(r.Context(), `
		SELECT COALESCE(from_state, ''), to_state, actor_type, COALESCE(reason, ''), created_at
		FROM custody_events WHERE custody_id = $1 ORDER BY created_at ASC
	`, cst.ID)
	if err != nil {
		writeCustodyError(w, err)
		return
	}
	defer rows.Close()

	events := make([]custodyEventView, 0)
	for rows.Next() {
		var ev custodyEventView
		if err := rows.Scan(&ev.FromState, &ev.ToState, &ev.ActorType, &ev.Reason, &ev.CreatedAt); err != nil {
			writeCustodyError(w, err)
			return
		}
		events = append(events, ev)
	}

	// The latest return proposal, if any — lets a client (rider-mobile's
	// custody screen) render the fee/reason/expiry without a second call.
	// Best-effort: absent entirely when no return was ever proposed.
	var openReturnView interface{}
	if ret, err := h.loadOpenReturn(r.Context(), cst.ID); err == nil {
		currency := ""
		if ret.Currency != nil {
			currency = *ret.Currency
		}
		openReturnView = map[string]interface{}{
			"returnId":         ret.ID,
			"chargeStatus":     ret.ChargeStatus,
			"consentState":     ret.ConsentState,
			"consentExpiresAt": ret.ConsentExpiresAt,
			"feeMinor":         ret.FeeMinor,
			"currency":         currency,
		}
	}

	respond(w, http.StatusOK, map[string]interface{}{
		"deliveryId": deliveryID,
		"state":      cst.State,
		"version":    cst.Version,
		"openReturn": openReturnView,
		"events":     events,
	})
}

// custodyForMarketplaceAssign seeds the delivery_custody row for a freshly
// assigned marketplace delivery. Called by MarketplaceAssign (marketplace.go)
// in the SAME transaction-adjacent flow as the delivery insert (best-effort:
// see the call site for why this is not itself inside that INSERT's
// transaction). The driver is already known at award time, so custody starts
// at CourierAssigned rather than modelling a separate "awaiting driver"
// state — see internal/custody's package doc.
func (h *Handler) custodyForMarketplaceAssign(ctx context.Context, deliveryID, senderID, driverID string) error {
	_, err := h.db.Pool.Exec(ctx, `
		INSERT INTO delivery_custody (delivery_id, state, version, sender_id, driver_id, created_at, updated_at)
		VALUES ($1, $2, 1, $3, $4, now(), now())
		ON CONFLICT (delivery_id) DO NOTHING
	`, deliveryID, custody.CourierAssigned, senderID, driverID)
	if err != nil {
		return err
	}
	var custodyID string
	if err := h.db.Pool.QueryRow(ctx, `SELECT id FROM delivery_custody WHERE delivery_id = $1`, deliveryID).Scan(&custodyID); err != nil {
		return err
	}
	_, err = h.db.Pool.Exec(ctx, `
		INSERT INTO custody_events (custody_id, delivery_id, from_state, to_state, actor_type, reason, created_at)
		VALUES ($1, $2, NULL, $3, $4, 'marketplace_award_assigned', now())
	`, custodyID, deliveryID, custody.CourierAssigned, custody.ActorSystem)
	return err
}
