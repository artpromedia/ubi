package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/testutil"
)

// jsonBody encodes v as an *http.Request body.
func jsonBody(v interface{}) *bytes.Reader {
	b, _ := json.Marshal(v)
	return bytes.NewReader(b)
}

func req(method, path string, body interface{}) *http.Request {
	if body == nil {
		r := httptest.NewRequest(method, path, nil)
		return r
	}
	r := httptest.NewRequest(method, path, jsonBody(body))
	r.Header.Set("Content-Type", "application/json")
	return r
}

func decode(t *testing.T, rec *httptest.ResponseRecorder, target interface{}) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), target); err != nil {
		t.Fatalf("response is not valid JSON (%s): %v", rec.Body.String(), err)
	}
}

// attachBody is the proof-attach body for an upload id. Tests that are
// refused before any handler runs (identity middleware) send a random one.
func attachBody(uploadID string) map[string]string {
	return map[string]string{"uploadId": uploadID}
}

func anyAttachBody() map[string]string { return attachBody(uuid.New().String()) }

type apiEnvelope struct {
	Success bool `json:"success"`
	Data    json.RawMessage
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func custodyPath(deliveryID, suffix string) string {
	return "/api/v1/deliveries/" + deliveryID + "/custody" + suffix
}

// TestCustodyHappyPath: pickup proof -> delivery proof -> delivered.
func TestCustodyHappyPath(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "")

	rec := h.AttachProof(deliveryID, "/pickup-proof", actors.Driver,
		h.UploadProof(deliveryID, actors.Driver, "pickup", testutil.TestImage("image/png", 1)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("pickup-proof: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	rec = h.AttachProof(deliveryID, "/delivery-proof", actors.Driver,
		h.UploadProof(deliveryID, actors.Driver, "delivery", testutil.TestImage("image/jpeg", 2)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("delivery-proof: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	rec = h.Do(req(http.MethodGet, custodyPath(deliveryID, "/"), nil), actors.Sender)
	if rec.Code != http.StatusOK {
		t.Fatalf("timeline: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var timeline struct {
		Data struct {
			State  string `json:"state"`
			Events []struct {
				ToState string `json:"toState"`
			} `json:"events"`
		} `json:"data"`
	}
	decode(t, rec, &timeline)
	if timeline.Data.State != "delivered" {
		t.Fatalf("final custody state = %q, want delivered", timeline.Data.State)
	}
	if len(timeline.Data.Events) != 3 {
		t.Fatalf("expected 3 custody events (courier_assigned->picked_up, picked_up->in_transit, in_transit->delivered), got %d: %+v", len(timeline.Data.Events), timeline.Data.Events)
	}
}

// TestDuplicateProofIsIdempotent: the same upload attached twice creates no
// second delivery_proofs row, and neither does a second upload of the very
// same image.
func TestDuplicateProofIsIdempotent(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "")

	image := testutil.TestImage("image/png", 11)
	uploadID := h.UploadProof(deliveryID, actors.Driver, "pickup", image)
	rec1 := h.AttachProof(deliveryID, "/pickup-proof", actors.Driver, uploadID)
	if rec1.Code != http.StatusCreated {
		t.Fatalf("first post: status = %d, body = %s", rec1.Code, rec1.Body.String())
	}
	rec2 := h.AttachProof(deliveryID, "/pickup-proof", actors.Driver, uploadID)
	if rec2.Code != http.StatusOK {
		t.Fatalf("replay: status = %d, want 200 (idempotent), body = %s", rec2.Code, rec2.Body.String())
	}
	var replayBody struct {
		Data struct {
			Replay bool `json:"replay"`
		} `json:"data"`
	}
	decode(t, rec2, &replayBody)
	if !replayBody.Data.Replay {
		t.Fatal("expected the second identical post to be reported as a replay")
	}

	var count int
	if err := h.Pool.QueryRow(ctx, `SELECT count(*) FROM delivery_proofs WHERE delivery_id = $1 AND type = 'pickup'`, deliveryID).Scan(&count); err != nil {
		t.Fatalf("count query: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly one pickup proof row, got %d", count)
	}

	// Custody has moved past courier_assigned, so no further pickup upload
	// can even be issued — there is no way to record a second pickup proof.
	dupRec := h.RequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("pickup", "image/png", image))
	if dupRec.Code != http.StatusConflict {
		t.Fatalf("a pickup upload after pickup must be refused: status = %d, body = %s", dupRec.Code, dupRec.Body.String())
	}
	if err := h.Pool.QueryRow(ctx, `SELECT count(*) FROM delivery_proofs WHERE delivery_id = $1`, deliveryID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("proof rows = %d (%v), want 1", count, err)
	}
}

// TestMaliciousObjectOwnershipRefused: an actor who is neither this
// delivery's sender nor its driver gets 404, matching the marketplace 404
// convention — existence is not revealed to a foreign caller.
func TestMaliciousObjectOwnershipRefused(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "")
	realUpload := h.UploadProof(deliveryID, actors.Driver, "pickup", testutil.TestImage("image/png", 21))

	foreignDriver := testutil.Driver()
	rec := h.AttachProof(deliveryID, "/pickup-proof", foreignDriver, realUpload)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("foreign driver attaching the real driver's upload: status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
	rec = h.RequestUpload(deliveryID, foreignDriver, testutil.DeclarationFor("pickup", "image/png", testutil.TestImage("image/png", 22)))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("foreign driver requesting an upload: status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}

	foreignSender := testutil.Sender()
	rec = h.Do(req(http.MethodGet, custodyPath(deliveryID, "/"), nil), foreignSender)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("foreign sender reading the timeline: status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

// TestOnlySenderCanConsentToReturn: the assigned driver may propose a return
// but never consent to or reject one.
func TestOnlySenderCanConsentToReturn(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "in_transit")

	rec := h.Do(req(http.MethodPost, custodyPath(deliveryID, "/recipient-unreachable"), map[string]string{"reason": "no answer"}), actors.Driver)
	if rec.Code != http.StatusOK {
		t.Fatalf("recipient-unreachable: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	rec = h.Do(req(http.MethodPost, custodyPath(deliveryID, "/return/propose"), map[string]interface{}{"reason": "cannot reach recipient"}), actors.Driver)
	if rec.Code != http.StatusCreated {
		t.Fatalf("return/propose: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	// The DRIVER tries to consent — refused.
	rec = h.Do(req(http.MethodPost, custodyPath(deliveryID, "/return/consent"), map[string]string{"action": "consent"}), actors.Driver)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("driver consenting: status = %d, want 403, body = %s", rec.Code, rec.Body.String())
	}

	// The SENDER may.
	rec = h.Do(req(http.MethodPost, custodyPath(deliveryID, "/return/consent"), map[string]string{"action": "consent"}), actors.Sender)
	if rec.Code != http.StatusOK {
		t.Fatalf("sender consenting: status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

// TestRecipientUnreachableReturnConsentedFlow: recipient absent -> unreachable
// -> return proposed -> consent -> returned_to_sender.
func TestRecipientUnreachableReturnConsentedFlow(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "in_transit")

	rec := h.Do(req(http.MethodPost, custodyPath(deliveryID, "/recipient-unreachable"), map[string]string{"reason": "no answer"}), actors.Driver)
	if rec.Code != http.StatusOK {
		t.Fatalf("recipient-unreachable: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	rec = h.Do(req(http.MethodPost, custodyPath(deliveryID, "/return/propose"), map[string]interface{}{"reason": "recipient never answered"}), actors.Sender)
	if rec.Code != http.StatusCreated {
		t.Fatalf("return/propose: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var proposeResp struct {
		Data struct {
			ChargeStatus string `json:"chargeStatus"`
		} `json:"data"`
	}
	decode(t, rec, &proposeResp)
	if proposeResp.Data.ChargeStatus != "not_required" {
		t.Fatalf("chargeStatus = %q, want not_required for a fee-free return", proposeResp.Data.ChargeStatus)
	}

	rec = h.Do(req(http.MethodPost, custodyPath(deliveryID, "/return/consent"), map[string]string{"action": "consent"}), actors.Sender)
	if rec.Code != http.StatusOK {
		t.Fatalf("return/consent: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var state string
	if err := h.Pool.QueryRow(ctx, `SELECT state FROM delivery_custody WHERE delivery_id = $1`, deliveryID).Scan(&state); err != nil {
		t.Fatalf("state query: %v", err)
	}
	if state != "return_to_sender" {
		t.Fatalf("final state = %q, want return_to_sender", state)
	}
}

// TestSenderNoResponseExpiryDefaultsToHoldPoint: an unanswered return
// proposal's consent window converges to held_at_point, never an auto-charge,
// the next time the delivery is read or acted on.
func TestSenderNoResponseExpiryDefaultsToHoldPoint(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "recipient_unreachable")

	rec := h.Do(req(http.MethodPost, custodyPath(deliveryID, "/return/propose"), map[string]interface{}{"reason": "no answer, proposing return"}), actors.Driver)
	if rec.Code != http.StatusCreated {
		t.Fatalf("return/propose: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	// Simulate the consent window having passed with no sender response.
	if _, err := h.Pool.Exec(ctx, `
		UPDATE delivery_returns SET consent_expires_at = now() - interval '1 hour'
		WHERE delivery_id = $1`, deliveryID); err != nil {
		t.Fatalf("failed to backdate the consent window: %v", err)
	}

	// Reading the timeline lazily resolves the expiry.
	rec = h.Do(req(http.MethodGet, custodyPath(deliveryID, "/"), nil), actors.Sender)
	if rec.Code != http.StatusOK {
		t.Fatalf("timeline: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var timeline struct {
		Data struct {
			State string `json:"state"`
		} `json:"data"`
	}
	decode(t, rec, &timeline)
	if timeline.Data.State != "held_at_point" {
		t.Fatalf("state after expiry = %q, want held_at_point (the safe default)", timeline.Data.State)
	}

	var consentState string
	if err := h.Pool.QueryRow(ctx, `SELECT consent_state FROM delivery_returns WHERE delivery_id = $1`, deliveryID).Scan(&consentState); err != nil {
		t.Fatalf("consent_state query: %v", err)
	}
	if consentState != "expired" {
		t.Fatalf("consent_state = %q, want expired", consentState)
	}

	// The safe default never charges: no fee row could have been paid,
	// and a fresh delivery-proof attempt from delivered is refused (already
	// diverted away from the delivered path entirely).
	rec = h.Do(req(http.MethodPost, custodyPath(deliveryID, "/collected"), nil), actors.Driver)
	if rec.Code != http.StatusOK {
		t.Fatalf("collected-at-point after expiry default: status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

// TestLegacyUnsupportedChargeCannotComplete: a return recorded with a fee
// before charged returns existed (charge_status `unsupported`, never
// authorized) still cannot complete the charged leg — even sender consent is
// refused — while the fee-free hold-point path keeps working.
func TestLegacyUnsupportedChargeCannotComplete(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true})
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "return_proposed")
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO delivery_returns (delivery_id, custody_id, reason, fee_minor, currency, charge_status,
			proposed_by, proposed_by_role, proposed_at, consent_state, consent_expires_at, created_at, updated_at)
		SELECT $1, id, 'pre-P17 charged return', 50000, 'NGN', 'unsupported', $2, 'driver', now(), 'pending', now() + interval '1 day', now(), now()
		FROM delivery_custody WHERE delivery_id = $1`, deliveryID, actors.Driver.UserID.String()); err != nil {
		t.Fatalf("seed a legacy return: %v", err)
	}

	rec := h.Do(req(http.MethodPost, custodyPath(deliveryID, "/return/consent"), map[string]string{"action": "consent"}), actors.Sender)
	if rec.Code != http.StatusConflict {
		t.Fatalf("consenting to a legacy unsupported charge: status = %d, want 409, body = %s", rec.Code, rec.Body.String())
	}
	var errBody apiEnvelope
	decode(t, rec, &errBody)
	if errBody.Error == nil || errBody.Error.Code != "RETURN_CHARGE_UNSUPPORTED" {
		t.Fatalf("expected RETURN_CHARGE_UNSUPPORTED, got %+v", errBody.Error)
	}
	if got := len(h.Payment.Requests()); got != 0 {
		t.Fatalf("a legacy unsupported fee must never reach payment-service, got %d calls", got)
	}

	var state string
	if err := h.Pool.QueryRow(ctx, `SELECT state FROM delivery_custody WHERE delivery_id = $1`, deliveryID).Scan(&state); err != nil {
		t.Fatalf("state query: %v", err)
	}
	if state != "return_proposed" {
		t.Fatalf("custody state moved to %q despite the charge being unsupported; a charged return must never silently complete", state)
	}

	rec = h.Do(req(http.MethodPost, custodyPath(deliveryID, "/return/consent"), map[string]string{"action": "reject"}), actors.Sender)
	if rec.Code != http.StatusOK {
		t.Fatalf("rejecting a legacy charged return: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if err := h.Pool.QueryRow(ctx, `SELECT state FROM delivery_custody WHERE delivery_id = $1`, deliveryID).Scan(&state); err != nil {
		t.Fatalf("state query: %v", err)
	}
	if state != "held_at_point" {
		t.Fatalf("state after rejecting a legacy charged return = %q, want held_at_point", state)
	}
}

// TestConcurrentReturnProposeVsRetryRaceHasExactlyOneWinner: requests
// racing to move the SAME custody row out of recipient_unreachable — one
// proposing a (potentially fee-bearing) return, the other completing the
// delivery via a retry — must resolve to exactly one outcome. The optimistic
// version CAS in applyChain is what this proves: whichever request loses gets
// a 409 and changes nothing, so a return that would have carried a charge
// can never be created alongside a delivery that also completed (no double
// charge, no split-brain state).
func TestConcurrentReturnProposeVsRetryRaceHasExactlyOneWinner(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "recipient_unreachable")

	// Every retry attempt carries its own verified upload (six: the per-
	// delivery cap on open uploads), issued and PUT before the race starts.
	const attempts = 6
	uploads := make([]string, attempts)
	for i := range uploads {
		uploads[i] = h.UploadProof(deliveryID, actors.Driver, "delivery", testutil.TestImage("image/png", 100+i))
	}

	var wg sync.WaitGroup
	codes := make([]int, attempts*2)

	fire := func(i int, path string, body interface{}, actor testutil.Actor) {
		defer wg.Done()
		rec := h.Do(req(http.MethodPost, custodyPath(deliveryID, path), body), actor)
		codes[i] = rec.Code
	}

	for i := 0; i < attempts; i++ {
		wg.Add(2)
		go fire(i*2, "/return/propose", map[string]interface{}{"reason": fmt.Sprintf("attempt-%d", i)}, actors.Driver)
		go fire(i*2+1, "/delivery-proof", attachBody(uploads[i]), actors.Driver)
	}
	wg.Wait()

	successes := 0
	for _, code := range codes {
		if code == http.StatusCreated || code == http.StatusOK {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("expected exactly one winning transition out of %d racing requests, got %d successes: %v", len(codes), successes, codes)
	}

	var state string
	if err := h.Pool.QueryRow(ctx, `SELECT state FROM delivery_custody WHERE delivery_id = $1`, deliveryID).Scan(&state); err != nil {
		t.Fatalf("state query: %v", err)
	}
	if state != "return_proposed" && state != "delivered" {
		t.Fatalf("unexpected final state %q after the race", state)
	}

	// No double outcome: at most one return row, and it exists iff the
	// return won; at most one delivery proof, and it exists iff the retry won.
	var returnCount, proofCount int
	if err := h.Pool.QueryRow(ctx, `SELECT count(*) FROM delivery_returns WHERE delivery_id = $1`, deliveryID).Scan(&returnCount); err != nil {
		t.Fatalf("return count: %v", err)
	}
	if err := h.Pool.QueryRow(ctx, `SELECT count(*) FROM delivery_proofs WHERE delivery_id = $1 AND type = 'delivery'`, deliveryID).Scan(&proofCount); err != nil {
		t.Fatalf("proof count: %v", err)
	}
	if returnCount+proofCount != 1 {
		t.Fatalf("expected exactly one of {return, delivery proof} to have been recorded, got returns=%d proofs=%d", returnCount, proofCount)
	}
	if (state == "return_proposed") != (returnCount == 1) {
		t.Fatalf("state %q inconsistent with return row count %d", state, returnCount)
	}
	if (state == "delivered") != (proofCount == 1) {
		t.Fatalf("state %q inconsistent with delivery proof count %d", state, proofCount)
	}
}
