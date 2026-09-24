/*
 * Delivery custody and returns (C07, G08; completed by P17).
 *
 * The tables this file reads/writes (delivery_custody, custody_events,
 * delivery_proofs, delivery_proof_uploads, delivery_returns) are
 * Prisma-owned, exactly like `deliveries` itself (packages/database/prisma)
 * — this service contains zero CREATE TABLE. It reaches them through the
 * same pgx pool and raw SQL it already uses for `deliveries`.
 *
 * Only marketplace-managed deliveries have a delivery_custody row (seeded by
 * MarketplaceAssign — see seedMarketplaceCustody). A legacy open-market
 * delivery, an unknown delivery id, or an actor who is neither the
 * delivery's sender nor its assigned driver all answer 404, matching the
 * marketplace 404 convention: existence is not revealed to a foreign caller.
 *
 * Proofs (proofs.go) are verified objects in the private proof bucket, never
 * client-asserted strings. Returns may carry a fee only while charged returns
 * are enabled; the fee is reserved, captured and released by payment-service
 * (return_funding.go) — this service never moves money and never touches the
 * award's commission.
 */

package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

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
		"This return was proposed with a fee before charged returns existed, and that fee was never authorized. " +
			"It cannot complete the charged leg — resolve it as a fee-free return, or let it default to a hold point.",
	}
}

// errChargedReturnsNotOffered is the explicit refusal while the
// charged-returns switch is off (or payment-service says the city has it
// off): the fee is never silently dropped or recorded as payable.
func errChargedReturnsNotOffered() *custodyError {
	return &custodyError{
		http.StatusConflict, "CHARGED_RETURNS_NOT_OFFERED",
		"Charged returns are not offered here: propose the return fee-free (feeMinor 0), or divert the parcel to a hold point.",
	}
}

// errFeePending: the return-fee outcome at payment-service is not yet
// known (or a held fee could not be released yet). Nothing was resolved;
// retrying is safe — every fee call is idempotent on the return id.
func errFeePending() *custodyError {
	return &custodyError{
		http.StatusServiceUnavailable, "RETURN_FEE_PENDING",
		"The return fee could not be confirmed with payment-service yet; nothing was resolved. Retry shortly.",
	}
}

func writeCustodyError(w http.ResponseWriter, err error) {
	var custErr *custodyError
	if errors.As(err, &custErr) {
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
// Sender or assigned driver. recipient_unreachable -> return_proposed.
//
// A fee is only OFFERED while charged returns are enabled
// (custody.ResolveChargeStatus): with the switch off a fee-bearing proposal
// is refused with CHARGED_RETURNS_NOT_OFFERED and nothing is written — only
// fee-free returns exist then, explicitly. With the switch on the fee must
// sit inside the server's bounds (custody.ValidateReturnFee: the delivery's
// currency, never above its agreed fare) and is recorded as
// `authorization_required`; nothing is held until the sender approves.
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

	chargeStatus, offered := custody.ResolveChargeStatus(req.FeeMinor, h.chargedReturnsOffered())
	if !offered {
		writeCustodyError(w, errChargedReturnsNotOffered())
		return
	}
	if req.FeeMinor > 0 {
		money, err := h.deliveryMoneyContext(r.Context(), deliveryID)
		if err != nil {
			writeCustodyError(w, err)
			return
		}
		if problems := custody.ValidateReturnFee(req.FeeMinor, req.Currency, money.Currency, money.AgreedFareMinor); len(problems) > 0 {
			respondError(w, http.StatusBadRequest, "RETURN_FEE_OUT_OF_BOUNDS", strings.Join(problems, "; "))
			return
		}
	}

	proposedAt := time.Now().UTC()
	expiresAt := custody.ConsentExpiresAt(proposedAt)
	actorType := custody.ActorDriver
	if isSender {
		actorType = custody.ActorSender
	}

	var returnID string
	fromVersion := cst.Version
	err := h.applyChain(r.Context(), cst,
		[]string{custody.RecipientUnreachable, custody.ReturnProposed},
		actorType, &actor.UserID, req.Reason,
		func(ctx context.Context, tx pgx.Tx) error {
			var currency *string
			if req.FeeMinor > 0 {
				currency = &req.Currency
			}
			if err := tx.QueryRow(ctx, `
				INSERT INTO delivery_returns (
					delivery_id, custody_id, reason, fee_minor, currency, charge_status,
					proposed_by, proposed_by_role, proposed_at, consent_state, consent_expires_at, created_at, updated_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
				RETURNING id
			`, deliveryID, cst.ID, req.Reason, req.FeeMinor, currency, chargeStatus,
				actor.UserID.String(), actor.Role, proposedAt, custody.ConsentPending, expiresAt).Scan(&returnID); err != nil {
				return err
			}
			// The sender must answer before the deadline: announced through
			// the outbox in this same transaction (notification-service
			// pushes the sender, with an SMS fallback). The free-text reason
			// stays on the custody timeline, never in the event.
			return writeOutboxEvent(ctx, tx, returnProposedEvent(cst, returnID, actor, req.FeeMinor, currency, chargeStatus, expiresAt, fromVersion, proposedAt))
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
// custody in return_proposed or later.
type openReturn struct {
	ID               string
	ChargeStatus     string
	ConsentState     string
	ConsentExpiresAt time.Time
	FeeMinor         int64
	Currency         *string
	ChargeCityID     string
	ChargeRef        string
}

func (h *Handler) loadOpenReturn(ctx context.Context, custodyID string) (*openReturn, error) {
	var ret openReturn
	row := h.db.Pool.QueryRow(ctx, `
		SELECT id, charge_status, consent_state, consent_expires_at, fee_minor, currency,
			COALESCE(charge_city_id, ''), COALESCE(charge_ref, '')
		FROM delivery_returns
		WHERE custody_id = $1
		ORDER BY proposed_at DESC
		LIMIT 1
	`, custodyID)
	if scanErr := row.Scan(&ret.ID, &ret.ChargeStatus, &ret.ConsentState, &ret.ConsentExpiresAt, &ret.FeeMinor, &ret.Currency,
		&ret.ChargeCityID, &ret.ChargeRef); scanErr != nil {
		return nil, scanErr
	}
	return &ret, nil
}

// resolveExpiredReturn lazily applies the safe default (held_at_point) when a
// return_proposed custody's consent window has passed with no sender
// response. Called at the top of return/consent, collected-at-point and the
// timeline read, so an unanswered proposal converges the next time anyone
// looks rather than staying in limbo forever. Never charges anything: a fee
// whose reservation outcome was left unknown by an interrupted approval is
// released first, and if that release cannot be confirmed yet the default is
// not applied this time (errFeePending) rather than stranding a hold.
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
	if err := h.releaseHeldFee(ctx, cst, ret, "return_consent_window_expired"); err != nil {
		return err
	}
	return h.applyChain(ctx, cst,
		[]string{custody.ReturnProposed, custody.HeldAtPoint},
		custody.ActorSystem, nil, "return_consent_window_expired_defaulted_to_hold_point",
		func(ctx context.Context, tx pgx.Tx) error {
			return resolveReturnRow(ctx, tx, ret.ID, custody.ConsentExpired, nil)
		})
}

// resolveReturnRow records a return proposal's resolution without the fee
// (rejected, or expired to the hold point) inside the custody transition's
// transaction — refusing, and so rolling that transition back, when the row
// says a fee is (or may be) held right now. The caller released any such fee
// first; seeing one here means an approval started reserving after that
// check (a reject racing an approve), and resolving the return underneath it
// could strand the hold. The caller answers a conflict and a retry releases
// first.
func resolveReturnRow(ctx context.Context, tx pgx.Tx, returnID, consentState string, resolvedBy *string) error {
	tag, err := tx.Exec(ctx, `
		UPDATE delivery_returns SET consent_state = $1, resolved_at = now(), resolved_by = COALESCE($2, resolved_by), updated_at = now()
		WHERE id = $3 AND charge_status NOT IN ($4, $5)
	`, consentState, resolvedBy, returnID, custody.ChargeReserving, custody.ChargeReserved)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errConflict("this return's fee is being reserved right now; re-fetch the timeline and retry")
	}
	return nil
}

type returnConsentRequest struct {
	Action string `json:"action"` // "consent" | "reject"
}

// PostReturnConsent handles POST /api/v1/deliveries/{id}/custody/return/consent.
// Sender ONLY — a driver may propose a return but never authorize or refuse
// one.
//
//   - reject: always allowed; defaults to a hold point, same as an unanswered
//     expiry (a fee whose reservation outcome is unknown is released first).
//   - consent, fee-free: return_proposed -> ... -> return_to_sender, as before.
//   - consent, fee-bearing (charged returns on): the fee is reserved from the
//     sender's wallet FIRST (consentChargedReturn); only a confirmed
//     reservation moves custody to `returning`. Insufficient funds answers
//     402 and changes nothing.
//   - consent on a legacy `unsupported` fee: refused (RETURN_CHARGE_UNSUPPORTED).
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
		if err := h.releaseHeldFee(r.Context(), cst, ret, "return_rejected_by_sender"); err != nil {
			writeCustodyError(w, err)
			return
		}
		err = h.applyChain(r.Context(), cst,
			[]string{custody.ReturnProposed, custody.HeldAtPoint},
			custody.ActorSender, &actor.UserID, "return_rejected_by_sender",
			func(ctx context.Context, tx pgx.Tx) error {
				resolvedBy := actor.UserID.String()
				return resolveReturnRow(ctx, tx, ret.ID, custody.ConsentRejected, &resolvedBy)
			})
		if err != nil {
			writeCustodyError(w, err)
			return
		}
		respond(w, http.StatusOK, map[string]interface{}{"deliveryId": deliveryID, "custodyState": cst.State, "consentState": custody.ConsentRejected})
		return

	case "consent":
		switch {
		case custody.CanCompleteReturn(ret.ChargeStatus):
			// Fee-free: nothing to reserve.
		case ret.ChargeStatus == custody.ChargeUnsupported:
			writeCustodyError(w, errChargeUnsupported())
			return
		case custody.NeedsReservation(ret.ChargeStatus):
			h.consentChargedReturn(w, r, cst, ret, actor)
			return
		default:
			writeCustodyError(w, errConflict("this return's fee is already "+ret.ChargeStatus))
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
		respond(w, http.StatusOK, map[string]interface{}{"deliveryId": deliveryID, "custodyState": cst.State, "consentState": custody.ConsentConsented, "chargeStatus": ret.ChargeStatus})
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
// single endpoint. A return proposal abandoned this way releases any fee
// whose reservation outcome was left unknown first.
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
		if ret, err := h.loadOpenReturn(r.Context(), cst.ID); err == nil {
			if err := h.releaseHeldFee(r.Context(), cst, ret, "return_abandoned_for_hold_point"); err != nil {
				writeCustodyError(w, err)
				return
			}
		}
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

type proofView struct {
	ProofID     string    `json:"proofId"`
	Type        string    `json:"type"`
	ContentType string    `json:"contentType"`
	SizeBytes   int64     `json:"sizeBytes"`
	SHA256      string    `json:"sha256"`
	Verified    bool      `json:"verified"`
	CreatedAt   time.Time `json:"createdAt"`
}

// GetCustodyTimeline handles GET /api/v1/deliveries/{id}/custody. Sender or
// assigned driver only; anyone else (including a genuine but unrelated
// account) sees 404, same as every other handler in this file.
//
// The response also carries the return policy in force (`returnPolicy`: are
// charged returns offered at all?) and the delivery's proofs — metadata
// only; a proof's bytes are reachable solely through a short-lived presigned
// URL from GET .../custody/proofs/{proofId}/url. Reading the timeline also
// retries a fee capture a completed return still owes (never a new charge).
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
		var custErr *custodyError
		if !errors.As(err, &custErr) || custErr.code != "RETURN_FEE_PENDING" {
			writeCustodyError(w, err)
			return
		}
		// A pending fee release only delays the safe default; the read
		// itself still answers.
		log.Warn().Str("deliveryId", deliveryID).Msg("expired return left pending: its fee release is not confirmed yet")
	}
	if ret, err := h.loadOpenReturn(r.Context(), cst.ID); err == nil && ret.ChargeStatus == custody.ChargeCapturePending {
		if err := h.settlePendingCapture(r.Context(), cst, ret); err != nil {
			log.Warn().Err(err).Str("deliveryId", deliveryID).Msg("a completed return's fee capture is still pending")
		}
	}

	rows, err := h.db.Pool.Query(r.Context(), `
		SELECT COALESCE(from_state, ''), to_state, actor_type, COALESCE(reason, ''), created_at
		FROM custody_events WHERE custody_id = $1 ORDER BY created_at ASC
	`, cst.ID)
	if err != nil {
		writeCustodyError(w, err)
		return
	}
	events := make([]custodyEventView, 0)
	for rows.Next() {
		var ev custodyEventView
		if err := rows.Scan(&ev.FromState, &ev.ToState, &ev.ActorType, &ev.Reason, &ev.CreatedAt); err != nil {
			rows.Close()
			writeCustodyError(w, err)
			return
		}
		events = append(events, ev)
	}
	rows.Close()

	proofRows, err := h.db.Pool.Query(r.Context(), `
		SELECT id::text, type, content_type, size_bytes, sha256, verified_at IS NOT NULL, created_at
		FROM delivery_proofs WHERE custody_id = $1 ORDER BY created_at ASC
	`, cst.ID)
	if err != nil {
		writeCustodyError(w, err)
		return
	}
	proofs := make([]proofView, 0)
	for proofRows.Next() {
		var pv proofView
		if err := proofRows.Scan(&pv.ProofID, &pv.Type, &pv.ContentType, &pv.SizeBytes, &pv.SHA256, &pv.Verified, &pv.CreatedAt); err != nil {
			proofRows.Close()
			writeCustodyError(w, err)
			return
		}
		proofs = append(proofs, pv)
	}
	proofRows.Close()

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
		"returnPolicy": map[string]interface{}{
			"chargedReturnsOffered": h.chargedReturnsOffered(),
			"feeFreeOnly":           !h.chargedReturnsOffered(),
		},
		"proofs": proofs,
		"events": events,
	})
}

// seedMarketplaceCustody seeds the delivery_custody row (and its first
// custody event) for a freshly assigned marketplace delivery, inside
// MarketplaceAssign's transaction so the delivery and its custody commit
// together (P17). The driver is already known at award time, so custody
// starts at CourierAssigned rather than modelling a separate "awaiting
// driver" state — see internal/custody's package doc. senderUserID is the
// requester's USER id (the gateway identity the access matrix compares), not
// the rider profile deliveries.sender_id references.
func seedMarketplaceCustody(ctx context.Context, tx pgx.Tx, deliveryID, senderUserID, driverID string) error {
	var custodyID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO delivery_custody (delivery_id, state, version, sender_id, driver_id, created_at, updated_at)
		VALUES ($1, $2, 1, $3, $4, now(), now())
		RETURNING id
	`, deliveryID, custody.CourierAssigned, senderUserID, driverID).Scan(&custodyID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO custody_events (custody_id, delivery_id, from_state, to_state, actor_type, reason, created_at)
		VALUES ($1, $2, NULL, $3, $4, 'marketplace_award_assigned', now())
	`, custodyID, deliveryID, custody.CourierAssigned, custody.ActorSystem)
	return err
}
