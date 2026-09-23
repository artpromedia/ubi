/*
 * Charged returns (P17, recheck R02): delivery-service's side of the return
 * fee, reserved / captured / released by payment-service's
 * /v1/finance/delivery-returns (internal/funding). This service never moves
 * money and never names the award's commission: the return leg is a new
 * charge, paid by the sender, to the award's driver.
 *
 * The ladder (delivery_returns.charge_status):
 *
 *   authorization_required ──(sender approves)──> reserving ──> reserved
 *        │                                           │   (custody: returning)
 *        │                                           │
 *        └── reject / expiry / hold point ◄── release┘  (a possibly-held fee
 *                                                        is released FIRST)
 *
 *   reserved ──(driver proves the hand-back: return/complete)──> capture_pending
 *            ──(capture confirmed)──> captured          (custody: return_to_sender)
 *   reserved ──(ops cancels the charge)──> released     (the return completes fee-free)
 *
 * `reserving` and `capture_pending` are write-ahead markers: they are written
 * BEFORE the payment-service call, and every call is idempotent on the return
 * id, so a timeout or a crash between the call and the local commit is
 * resolved by simply calling again — never by guessing. A charge approval
 * whose custody transition then fails (another request moved the custody
 * first) is compensated by a release in the same request — unless the request
 * that won was a concurrent approval of the same return (approvalCommitted),
 * whose fee that reservation now is. A reject or expiry never resolves the
 * return while its row says a fee is being reserved (resolveReturnRow).
 *
 * Deny-by-default: DELIVERY_CHARGED_RETURNS_ENABLED gates NEW charges (a
 * fee-bearing proposal, and the reservation at approval). Capture and release
 * of an existing charge are never blocked by it.
 */

package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/custody"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/funding"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/identity"
)

// deliveryMoney is what a return fee is bounded by and linked to.
type deliveryMoney struct {
	Currency        string
	AwardID         string
	AgreedFareMinor int64
}

// deliveryMoneyContext reads the delivery's currency and the marketplace
// award linkage MarketplaceAssign stored (award id, agreed fare in minor
// units) — the server-side facts a return fee is bounded by.
func (h *Handler) deliveryMoneyContext(ctx context.Context, deliveryID string) (*deliveryMoney, error) {
	var money deliveryMoney
	err := h.db.Pool.QueryRow(ctx, `
		SELECT currency::text,
			COALESCE(marketplace_metadata->>'`+packageKeyMarketplaceAwardID+`', ''),
			COALESCE((marketplace_metadata->>'`+packageKeyAgreedFareMinor+`')::bigint, 0)
		FROM deliveries WHERE id = $1
	`, deliveryID).Scan(&money.Currency, &money.AwardID, &money.AgreedFareMinor)
	if err != nil {
		return nil, err
	}
	return &money, nil
}

// chargedReturnsOffered reports whether NEW fee-bearing returns are offered:
// the deny-by-default switch is on AND there is a payment-service to reserve
// the fee with. With the switch on but no usable payment-service (no URL, or
// only the committed-default internal key — funding.Disabled), a fee could be
// proposed and approved yet never reserved, and the write-ahead marker would
// then block even a fee-free resolution; so fees are simply not offered.
func (h *Handler) chargedReturnsOffered() bool {
	if !h.cfg.ChargedReturnsEnabled {
		return false
	}
	_, disabled := h.funding.(funding.Disabled)
	return !disabled
}

// chargeTerms assembles the terms payment-service keys a return charge by.
// Every op sends the same terms, so they are derived from stored facts only.
func (h *Handler) chargeTerms(ctx context.Context, cst *custodyRecord, ret *openReturn, reason string) (funding.Terms, error) {
	money, err := h.deliveryMoneyContext(ctx, cst.DeliveryID)
	if err != nil {
		return funding.Terms{}, err
	}
	if money.AwardID == "" || cst.DriverID == nil || ret.Currency == nil || ret.ChargeCityID == "" {
		return funding.Terms{}, errConflict("this return has no complete fee terms (award, driver, currency, city)")
	}
	return funding.Terms{
		ReturnID:   ret.ID,
		DeliveryID: cst.DeliveryID,
		AwardID:    money.AwardID,
		SenderID:   cst.SenderID,
		DriverID:   *cst.DriverID,
		FeeMinor:   ret.FeeMinor,
		Currency:   *ret.Currency,
		CityID:     ret.ChargeCityID,
		Reason:     reason,
	}, nil
}

// releaseHeldFee releases a return's fee when one is — or may be — held
// (custody.MayHoldReservation), and records the release. A no-op for any
// other charge status. An error means the release is not confirmed and the
// caller must NOT resolve the return (errFeePending, or a definite refusal
// such as an already-captured fee, which is surfaced as a conflict).
func (h *Handler) releaseHeldFee(ctx context.Context, cst *custodyRecord, ret *openReturn, reason string) error {
	if !custody.MayHoldReservation(ret.ChargeStatus) {
		return nil
	}
	terms, err := h.chargeTerms(ctx, cst, ret, reason)
	if err != nil {
		return err
	}
	if _, err := h.funding.Release(ctx, terms); err != nil {
		var refusal *funding.Refusal
		if errors.As(err, &refusal) {
			log.Error().Err(err).Str("returnId", ret.ID).Msg("payment-service refused to release a return fee")
			return &custodyError{http.StatusConflict, "RETURN_FEE_RELEASE_REFUSED", refusal.Error()}
		}
		log.Warn().Err(err).Str("returnId", ret.ID).Msg("return fee release not confirmed; the return stays unresolved")
		return errFeePending()
	}
	if _, err := h.db.Pool.Exec(ctx, `
		UPDATE delivery_returns SET charge_status = $2, charge_updated_at = now(), updated_at = now()
		WHERE id = $1 AND charge_status IN ($3, $4)
	`, ret.ID, custody.ChargeReleased, custody.ChargeReserving, custody.ChargeReserved); err != nil {
		return err
	}
	ret.ChargeStatus = custody.ChargeReleased
	return nil
}

// settlePendingCapture takes a completed return's fee (capture_pending ->
// captured). Idempotent: the capture replays on payment-service under the
// return's key. A payment-service answer that the charge was released
// instead (ops cancelled it while the return completed) is recorded as
// released — the fee was never taken.
func (h *Handler) settlePendingCapture(ctx context.Context, cst *custodyRecord, ret *openReturn) error {
	if ret.ChargeStatus != custody.ChargeCapturePending {
		return nil
	}
	terms, err := h.chargeTerms(ctx, cst, ret, "return completed: parcel handed back to the sender")
	if err != nil {
		return err
	}
	charge, err := h.funding.Capture(ctx, terms)
	if err != nil {
		var refusal *funding.Refusal
		if errors.As(err, &refusal) && refusal.ChargeState == custody.ChargeReleased {
			_, dbErr := h.db.Pool.Exec(ctx, `
				UPDATE delivery_returns SET charge_status = $2, charge_updated_at = now(), updated_at = now()
				WHERE id = $1 AND charge_status = $3
			`, ret.ID, custody.ChargeReleased, custody.ChargeCapturePending)
			if dbErr == nil {
				ret.ChargeStatus = custody.ChargeReleased
			}
			return dbErr
		}
		return err
	}
	entryID := charge.EntryID
	if entryID == "" {
		entryID = charge.CaptureEntryID
	}
	if _, err := h.db.Pool.Exec(ctx, `
		UPDATE delivery_returns SET charge_status = $2, charge_entry_id = $3, charge_updated_at = now(), updated_at = now()
		WHERE id = $1 AND charge_status = $4
	`, ret.ID, custody.ChargeCaptured, entryID, custody.ChargeCapturePending); err != nil {
		return err
	}
	ret.ChargeStatus = custody.ChargeCaptured
	return nil
}

// consentChargedReturn is the sender's approval of a fee-bearing return:
// reserve the fee first, and only a confirmed reservation moves custody to
// `returning`.
func (h *Handler) consentChargedReturn(w http.ResponseWriter, r *http.Request, cst *custodyRecord, ret *openReturn, actor identity.Actor) {
	ctx := r.Context()
	if !h.chargedReturnsOffered() {
		// The switch was turned off after the proposal (or there is no
		// usable payment-service): no new commitment. The sender can still
		// reject (hold point, no charge).
		writeCustodyError(w, errChargedReturnsNotOffered())
		return
	}
	if actor.CityID == "" && ret.ChargeCityID == "" {
		writeCustodyError(w, errValidation("the approving sender's city is unknown, so the return fee cannot be scoped"))
		return
	}

	// Write-ahead: from here until the outcome is recorded, any other path
	// that resolves this return releases the (possible) reservation first.
	// The city is pinned on the first attempt so every retry sends the same
	// terms.
	var cityID string
	err := h.db.Pool.QueryRow(ctx, `
		UPDATE delivery_returns
		SET charge_status = $2, charge_city_id = COALESCE(charge_city_id, $3), charge_updated_at = now(), updated_at = now()
		WHERE id = $1 AND consent_state = $4 AND charge_status IN ($5, $6)
			AND EXISTS (SELECT 1 FROM delivery_custody c WHERE c.id = delivery_returns.custody_id AND c.state = $7)
		RETURNING charge_city_id
	`, ret.ID, custody.ChargeReserving, actor.CityID, custody.ConsentPending,
		custody.ChargeAuthorizationRequired, custody.ChargeReserving, custody.ReturnProposed).Scan(&cityID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeCustodyError(w, errConflict("this return's fee changed concurrently; re-fetch the timeline"))
		return
	}
	if err != nil {
		writeCustodyError(w, err)
		return
	}
	ret.ChargeStatus = custody.ChargeReserving
	ret.ChargeCityID = cityID

	terms, err := h.chargeTerms(ctx, cst, ret, "sender approved the return")
	if err != nil {
		writeCustodyError(w, err)
		return
	}
	charge, err := h.funding.Reserve(ctx, terms)
	if err != nil {
		var refusal *funding.Refusal
		if !errors.As(err, &refusal) {
			// Outcome unknown: keep the write-ahead marker; a retry replays.
			log.Warn().Err(err).Str("returnId", ret.ID).Msg("return fee reservation outcome unknown")
			writeCustodyError(w, errFeePending())
			return
		}
		// A definite "no": payment-service held nothing.
		if _, dbErr := h.db.Pool.Exec(ctx, `
			UPDATE delivery_returns SET charge_status = $2, charge_updated_at = now(), updated_at = now()
			WHERE id = $1 AND charge_status = $3
		`, ret.ID, custody.ChargeAuthorizationRequired, custody.ChargeReserving); dbErr != nil {
			writeCustodyError(w, dbErr)
			return
		}
		switch {
		case refusal.InsufficientFunds():
			respondError(w, http.StatusPaymentRequired, "RETURN_FEE_INSUFFICIENT_FUNDS",
				"The sender's wallet cannot cover the return fee. Nothing was charged: top up and approve again, or reject the return (hold point, no fee).")
		case refusal.FeatureDisabled():
			writeCustodyError(w, errChargedReturnsNotOffered())
		default:
			respondError(w, http.StatusConflict, "RETURN_FEE_REFUSED", refusal.Error())
		}
		return
	}

	err = h.applyChain(ctx, cst,
		[]string{custody.ReturnProposed, custody.ReturnConsented, custody.Returning},
		custody.ActorSender, &actor.UserID, "return_consented_by_sender_fee_reserved",
		func(ctx context.Context, tx pgx.Tx) error {
			tag, e := tx.Exec(ctx, `
				UPDATE delivery_returns
				SET consent_state = $2, resolved_at = now(), resolved_by = $3,
					charge_status = $4, charge_ref = $5, charge_updated_at = now(), updated_at = now()
				WHERE id = $1 AND charge_status = $6
			`, ret.ID, custody.ConsentConsented, actor.UserID.String(), custody.ChargeReserved, charge.ChargeID, custody.ChargeReserving)
			if e != nil {
				return e
			}
			if tag.RowsAffected() != 1 {
				return errConflict("this return's fee changed concurrently; re-fetch the timeline")
			}
			return nil
		})
	if err != nil {
		// This approval did not commit, so its fee must not stay held —
		// unless a concurrent approval of this SAME return did commit (a
		// double tap, or a retry racing its original: both replayed the one
		// reservation under the return's key). That reservation is now the
		// approved return's fee, owed to the driver at completion; releasing
		// it here would hand the sender a free return they agreed to pay for.
		if h.approvalCommitted(ctx, ret.ID) {
			writeCustodyError(w, err)
			return
		}
		if relErr := h.releaseHeldFee(ctx, cst, ret, "return_approval_did_not_commit"); relErr != nil {
			log.Error().Err(relErr).Str("returnId", ret.ID).Msg("could not release a fee whose approval did not commit; it stays marked reserving for the next resolution")
		}
		writeCustodyError(w, err)
		return
	}

	respond(w, http.StatusOK, map[string]interface{}{
		"deliveryId": cst.DeliveryID, "custodyState": cst.State, "consentState": custody.ConsentConsented,
		"chargeStatus": custody.ChargeReserved, "chargeRef": charge.ChargeID,
	})
}

// approvalCommitted reports whether some approval of this return has
// committed: consented, with the fee recorded past the write-ahead marker
// (reserved, or already on to capture). The approval's custody transition and
// that return-row update commit in ONE transaction, so once another request's
// custody CAS has beaten ours this read is decisive. An unreadable row answers
// true: keeping a hold that ops can cancel (return/cancel-charge) is the safe
// side of wrongly releasing an approved return's fee.
func (h *Handler) approvalCommitted(ctx context.Context, returnID string) bool {
	var consentState, chargeStatus string
	if err := h.db.Pool.QueryRow(ctx, `SELECT consent_state, charge_status FROM delivery_returns WHERE id = $1`, returnID).
		Scan(&consentState, &chargeStatus); err != nil {
		log.Error().Err(err).Str("returnId", returnID).Msg("could not read a return after its approval failed; its fee is left for ops to resolve")
		return true
	}
	return consentState == custody.ConsentConsented &&
		(chargeStatus == custody.ChargeReserved || chargeStatus == custody.ChargeCapturePending || chargeStatus == custody.ChargeCaptured)
}

// PostReturnComplete handles POST /api/v1/deliveries/{id}/custody/return/complete.
// Assigned driver only, with a verified `return` proof upload: returning ->
// return_to_sender, and the reserved fee becomes capture_pending in the SAME
// transaction; the capture follows and is retried until confirmed (a replay
// of this call, or the next timeline read). A charge ops cancelled completes
// fee-free.
func (h *Handler) PostReturnComplete(w http.ResponseWriter, r *http.Request) {
	deliveryID := chi.URLParam(r, "id")
	actor, ok := identity.ActorFrom(r.Context())
	if !ok {
		writeCustodyError(w, errNotFound())
		return
	}
	if actor.Role != identity.RoleDriver {
		writeCustodyError(w, errForbidden("only the assigned driver may complete a return"))
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
	uploadID, derr := decodeAttach(r)
	if derr != nil {
		writeCustodyError(w, derr)
		return
	}
	ret, err := h.loadOpenReturn(r.Context(), cst.ID)
	if err != nil {
		writeCustodyError(w, errConflict("this delivery has no return to complete"))
		return
	}

	outcome, err := h.attachVerifiedProof(r.Context(), cst, actor, custody.ProofReturn, uploadID,
		func(current string) []string {
			if current == custody.Returning {
				return []string{custody.Returning, custody.ReturnToSender}
			}
			return nil
		},
		func(ctx context.Context, tx pgx.Tx) error {
			_, e := tx.Exec(ctx, `
				UPDATE delivery_returns
				SET charge_status = CASE WHEN charge_status = $2 THEN $3 ELSE charge_status END,
					charge_updated_at = CASE WHEN charge_status = $2 THEN now() ELSE charge_updated_at END,
					updated_at = now()
				WHERE id = $1
			`, ret.ID, custody.ChargeReserved, custody.ChargeCapturePending)
			return e
		})
	if err != nil {
		writeCustodyError(w, err)
		return
	}

	current, cerr := h.loadCustodyForActor(r.Context(), deliveryID, actor)
	if cerr == nil {
		cst = current
	}
	if reloaded, err := h.loadOpenReturn(r.Context(), cst.ID); err == nil {
		ret = reloaded
	}
	status := http.StatusCreated
	if outcome.Replay {
		status = http.StatusOK
	}
	if ret.ChargeStatus == custody.ChargeCapturePending {
		if err := h.settlePendingCapture(r.Context(), cst, ret); err != nil {
			// The parcel is back and the proof recorded; the fee capture is
			// owed and will be retried. Say so rather than pretend.
			log.Warn().Err(err).Str("returnId", ret.ID).Msg("return completed; its fee capture is pending")
			status = http.StatusAccepted
		}
	}
	respond(w, status, map[string]interface{}{
		"proofId": outcome.ProofID, "deliveryId": deliveryID, "type": custody.ProofReturn,
		"replay": outcome.Replay, "custodyState": cst.State, "chargeStatus": ret.ChargeStatus,
	})
}

type cancelChargeRequest struct {
	Reason string `json:"reason"`
}

// PostReturnCancelCharge handles POST /api/v1/deliveries/{id}/custody/return/cancel-charge.
// Ops (admin) only: releases a return fee that is — or may be — held; the
// return itself carries on and completes fee-free. Never blocked by the
// charged-returns switch (a kill switch must not strand a sender's money).
func (h *Handler) PostReturnCancelCharge(w http.ResponseWriter, r *http.Request) {
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
	if actor.Role != identity.RoleAdmin {
		writeCustodyError(w, errForbidden("only ops may cancel a return fee"))
		return
	}
	var req cancelChargeRequest
	_ = json.NewDecoder(r.Body).Decode(&req) // reason is optional
	reason := req.Reason
	if reason == "" {
		reason = "return_fee_cancelled_by_ops"
	}
	ret, err := h.loadOpenReturn(r.Context(), cst.ID)
	if err != nil || !custody.MayHoldReservation(ret.ChargeStatus) {
		writeCustodyError(w, errConflict("no return fee is held for this delivery"))
		return
	}
	if err := h.releaseHeldFee(r.Context(), cst, ret, reason); err != nil {
		writeCustodyError(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]interface{}{
		"deliveryId": deliveryID, "returnId": ret.ID, "custodyState": cst.State, "chargeStatus": ret.ChargeStatus,
	})
}
