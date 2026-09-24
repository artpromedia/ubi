package handlers_test

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/identity"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/testutil"
)

// Charged returns (P17), delivery-service's side: the fee is reserved from
// the sender's wallet at approval, captured once when the driver proves the
// hand-back, released when the charge is cancelled or the approval never
// commits — all through payment-service's /v1/finance/delivery-returns,
// played here by testutil.PaymentStub (the contract double; the ledger side
// is proven in payment-service's tests/finance/delivery-returns.test.ts).
// Every delivery is seeded with an agreed fare of 100000 NGN minor units.

const returnFee = 40000

type returnRow struct {
	ChargeStatus string
	ConsentState string
	ChargeRef    string
	ChargeEntry  string
	ChargeCity   string
}

func loadReturnRow(t *testing.T, h *testutil.Harness, deliveryID string) returnRow {
	t.Helper()
	var row returnRow
	if err := h.Pool.QueryRow(context.Background(), `
		SELECT charge_status, consent_state, COALESCE(charge_ref, ''), COALESCE(charge_entry_id, ''), COALESCE(charge_city_id, '')
		FROM delivery_returns WHERE delivery_id = $1 ORDER BY proposed_at DESC LIMIT 1`, deliveryID).Scan(
		&row.ChargeStatus, &row.ConsentState, &row.ChargeRef, &row.ChargeEntry, &row.ChargeCity); err != nil {
		t.Fatalf("read the return: %v", err)
	}
	return row
}

func returnID(t *testing.T, h *testutil.Harness, deliveryID string) string {
	t.Helper()
	var id string
	if err := h.Pool.QueryRow(context.Background(), `SELECT id::text FROM delivery_returns WHERE delivery_id = $1 ORDER BY proposed_at DESC LIMIT 1`, deliveryID).Scan(&id); err != nil {
		t.Fatalf("read the return id: %v", err)
	}
	return id
}

func awardOf(t *testing.T, h *testutil.Harness, deliveryID string) string {
	t.Helper()
	var award string
	if err := h.Pool.QueryRow(context.Background(), `SELECT marketplace_metadata->>'marketplaceAwardId' FROM deliveries WHERE id = $1`, deliveryID).Scan(&award); err != nil {
		t.Fatalf("read the award: %v", err)
	}
	return award
}

func proposeFee(h *testutil.Harness, deliveryID string, actor testutil.Actor, fee int64, currency string) *httpResult {
	rec := h.Do(req(http.MethodPost, custodyPath(deliveryID, "/return/propose"),
		map[string]interface{}{"reason": "recipient unreachable, bring it back", "feeMinor": fee, "currency": currency}), actor)
	return &httpResult{rec.Code, rec.Body.String()}
}

type httpResult struct {
	Code int
	Body string
}

func consent(h *testutil.Harness, deliveryID string, sender testutil.Actor, action string) *httpResult {
	rec := h.Do(req(http.MethodPost, custodyPath(deliveryID, "/return/consent"), map[string]string{"action": action}), sender)
	return &httpResult{rec.Code, rec.Body.String()}
}

func requireResult(t *testing.T, what string, got *httpResult, status int, contains string) {
	t.Helper()
	if got.Code != status || (contains != "" && !strings.Contains(got.Body, contains)) {
		t.Fatalf("%s: status = %d, body = %s; want %d containing %q", what, got.Code, got.Body, status, contains)
	}
}

// chargedReturn seeds a delivery whose recipient is unreachable and proposes
// a fee-bearing return with charged returns ON.
func chargedReturn(t *testing.T, h *testutil.Harness, fundedMinor int64) (string, struct{ Sender, Driver testutil.Actor }) {
	t.Helper()
	deliveryID, actors := h.SeedDelivery(context.Background(), testutil.Actor{}, testutil.Actor{}, "recipient_unreachable")
	h.Payment.Fund(actors.Sender.UserID.String(), fundedMinor)
	requireResult(t, "propose a charged return", proposeFee(h, deliveryID, actors.Driver, returnFee, "NGN"), http.StatusCreated, `"chargeStatus":"authorization_required"`)
	return deliveryID, struct{ Sender, Driver testutil.Actor }{actors.Sender, actors.Driver}
}

func completeReturn(t *testing.T, h *testutil.Harness, deliveryID string, driver testutil.Actor, seed int) *httpResult {
	t.Helper()
	uploadID := h.UploadProof(deliveryID, driver, "return", testutil.TestImage("image/png", seed))
	rec := h.AttachProof(deliveryID, "/return/complete", driver, uploadID)
	return &httpResult{rec.Code, rec.Body.String()}
}

func admin() testutil.Actor {
	return testutil.Actor{UserID: uuid.New(), Role: identity.RoleAdmin, CityID: "LOS"}
}

// TestChargedReturnsAreDenyByDefault: with the switch off only fee-free
// returns exist — a fee is refused explicitly, nothing is written, and
// payment-service is never called.
func TestChargedReturnsAreDenyByDefault(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "recipient_unreachable")

	requireResult(t, "propose a fee with charged returns off", proposeFee(h, deliveryID, actors.Driver, returnFee, "NGN"),
		http.StatusConflict, "CHARGED_RETURNS_NOT_OFFERED")
	var rows int
	if err := h.Pool.QueryRow(ctx, `SELECT count(*) FROM delivery_returns WHERE delivery_id = $1`, deliveryID).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("a refused charged proposal wrote %d return rows (%v)", rows, err)
	}
	if custodyState(t, h, deliveryID) != "recipient_unreachable" {
		t.Fatal("a refused charged proposal must not move custody")
	}

	timeline := h.Do(req(http.MethodGet, custodyPath(deliveryID, "/"), nil), actors.Sender)
	if !strings.Contains(timeline.Body.String(), `"returnPolicy":{"chargedReturnsOffered":false,"feeFreeOnly":true}`) {
		t.Fatalf("the timeline must say only fee-free returns are offered: %s", timeline.Body.String())
	}

	requireResult(t, "propose fee-free", proposeFee(h, deliveryID, actors.Driver, 0, ""), http.StatusCreated, `"chargeStatus":"not_required"`)
	requireResult(t, "consent fee-free", consent(h, deliveryID, actors.Sender, "consent"), http.StatusOK, `"custodyState":"return_to_sender"`)
	if got := h.Payment.Requests(); len(got) != 0 {
		t.Fatalf("fee-free returns never reach payment-service, got %v", got)
	}
}

// TestChargedReturnsNeedAPaymentService: the switch alone does not offer
// fees — with no usable payment-service a fee could be approved but never
// reserved, so fee-bearing proposals are refused exactly as with the switch
// off, and the timeline says fee-free only.
func TestChargedReturnsNeedAPaymentService(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true, NoPaymentService: true})
	deliveryID, actors := h.SeedDelivery(context.Background(), testutil.Actor{}, testutil.Actor{}, "recipient_unreachable")

	requireResult(t, "propose a fee with no payment-service", proposeFee(h, deliveryID, actors.Driver, returnFee, "NGN"),
		http.StatusConflict, "CHARGED_RETURNS_NOT_OFFERED")
	timeline := h.Do(req(http.MethodGet, custodyPath(deliveryID, "/"), nil), actors.Sender)
	if !strings.Contains(timeline.Body.String(), `"returnPolicy":{"chargedReturnsOffered":false,"feeFreeOnly":true}`) {
		t.Fatalf("the timeline must say only fee-free returns are offered: %s", timeline.Body.String())
	}
	requireResult(t, "propose fee-free", proposeFee(h, deliveryID, actors.Driver, 0, ""), http.StatusCreated, `"chargeStatus":"not_required"`)
}

// TestChargedReturnReservesAtApprovalAndCapturesExactlyOnce: the whole
// charged leg, with the server bounds, the single reservation, the single
// capture on the verified hand-back, and replays that move no money.
func TestChargedReturnReservesAtApprovalAndCapturesExactlyOnce(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true})
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "recipient_unreachable")
	sender := actors.Sender.UserID.String()
	h.Payment.Fund(sender, 100000)

	// Server-set bounds: never above the agreed fare, only in its currency.
	requireResult(t, "fee above the agreed fare", proposeFee(h, deliveryID, actors.Driver, 100001, "NGN"), http.StatusBadRequest, "RETURN_FEE_OUT_OF_BOUNDS")
	requireResult(t, "fee in another currency", proposeFee(h, deliveryID, actors.Driver, returnFee, "KES"), http.StatusBadRequest, "RETURN_FEE_OUT_OF_BOUNDS")
	requireResult(t, "propose", proposeFee(h, deliveryID, actors.Driver, returnFee, "NGN"), http.StatusCreated, `"chargeStatus":"authorization_required"`)
	if got := h.Payment.Requests(); len(got) != 0 {
		t.Fatalf("nothing is held until the sender approves, got %v", got)
	}

	requireResult(t, "sender approves", consent(h, deliveryID, actors.Sender, "consent"), http.StatusOK, `"chargeStatus":"reserved"`)
	if custodyState(t, h, deliveryID) != "returning" {
		t.Fatal("an approved charged return is on its way back, not yet returned")
	}
	retID := returnID(t, h, deliveryID)
	charge := h.Payment.Charge(retID)
	if charge == nil || charge.State != "reserved" || charge.Reserves != 1 || charge.FeeMinor != returnFee || charge.Currency != "NGN" {
		t.Fatalf("payment-side charge = %+v, want one reservation of %d NGN", charge, returnFee)
	}
	if charge.SenderID != sender || charge.DriverID != actors.Driver.UserID.String() || charge.AwardID != awardOf(t, h, deliveryID) || charge.CityID != "LOS" {
		t.Fatalf("charge terms %+v do not name the sender, the award's driver, the award and the sender's city", charge)
	}
	if h.Payment.Spendable(sender) != 100000-returnFee {
		t.Fatalf("spendable = %d, want %d", h.Payment.Spendable(sender), 100000-returnFee)
	}
	row := loadReturnRow(t, h, deliveryID)
	if row.ChargeStatus != "reserved" || row.ConsentState != "consented" || row.ChargeRef != charge.ChargeID || row.ChargeCity != "LOS" {
		t.Fatalf("return row = %+v", row)
	}

	// A second approval finds nothing pending and reserves nothing.
	requireResult(t, "approve again", consent(h, deliveryID, actors.Sender, "consent"), http.StatusConflict, "STATE_CONFLICT")
	if h.Payment.Charge(retID).Reserves != 1 {
		t.Fatal("a repeated approval must never reserve twice")
	}

	// The driver proves the hand-back with a verified return proof.
	uploadID := h.UploadProof(deliveryID, actors.Driver, "return", testutil.TestImage("image/jpeg", 201))
	rec := h.AttachProof(deliveryID, "/return/complete", actors.Driver, uploadID)
	requireResult(t, "complete the return", &httpResult{rec.Code, rec.Body.String()}, http.StatusCreated, `"chargeStatus":"captured"`)
	if custodyState(t, h, deliveryID) != "return_to_sender" {
		t.Fatal("a completed return is back with the sender")
	}
	charge = h.Payment.Charge(retID)
	if charge.State != "captured" || charge.Captures != 1 {
		t.Fatalf("payment-side charge = %+v, want captured once", charge)
	}
	if row := loadReturnRow(t, h, deliveryID); row.ChargeStatus != "captured" || row.ChargeEntry != charge.CaptureEntryID {
		t.Fatalf("return row = %+v, want captured with entry %s", row, charge.CaptureEntryID)
	}

	// Replaying the completion is a replay — no second capture.
	rec = h.AttachProof(deliveryID, "/return/complete", actors.Driver, uploadID)
	requireResult(t, "replay the completion", &httpResult{rec.Code, rec.Body.String()}, http.StatusOK, `"replay":true`)
	if h.Payment.Charge(retID).Captures != 1 {
		t.Fatal("a replayed completion must never capture twice")
	}

	// The return leg only ever spoke to the return-fee endpoint: never to a
	// commission hold, never to the award's funding.
	for _, call := range h.Payment.Requests() {
		if !strings.HasPrefix(call, "POST /v1/finance/delivery-returns/") {
			t.Fatalf("delivery-service called %s — the return leg must never touch the award's commission or funding", call)
		}
	}
}

// TestChargedReturnInsufficientFundsChangesNothing: a wallet that cannot cover
// the fee is refused at approval; nothing is held, custody stays, and the
// fee-free hold point remains available.
func TestChargedReturnInsufficientFundsChangesNothing(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true})
	deliveryID, actors := chargedReturn(t, h, 1000)

	requireResult(t, "approve without funds", consent(h, deliveryID, actors.Sender, "consent"), http.StatusPaymentRequired, "RETURN_FEE_INSUFFICIENT_FUNDS")
	if custodyState(t, h, deliveryID) != "return_proposed" {
		t.Fatal("custody must not move when the fee cannot be reserved")
	}
	if row := loadReturnRow(t, h, deliveryID); row.ChargeStatus != "authorization_required" || row.ConsentState != "pending" {
		t.Fatalf("return row = %+v, want still awaiting an authorization", row)
	}
	if h.Payment.Charge(returnID(t, h, deliveryID)) != nil {
		t.Fatal("payment-service must hold nothing after refusing")
	}

	requireResult(t, "reject instead", consent(h, deliveryID, actors.Sender, "reject"), http.StatusOK, `"custodyState":"held_at_point"`)
	for _, call := range h.Payment.Requests() {
		if strings.HasSuffix(call, "/release") {
			t.Fatal("nothing was held, so nothing is released")
		}
	}
}

// TestChargedReturnUnknownReserveOutcomeIsReplayedNotGuessed: the reserve
// landed but its answer was lost; the approval reports pending, keeps the
// write-ahead marker, and a retry replays the SAME reservation.
func TestChargedReturnUnknownReserveOutcomeIsReplayedNotGuessed(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true})
	deliveryID, actors := chargedReturn(t, h, 100000)
	h.Payment.FailAfterApply("reserve", 1)

	requireResult(t, "approve, answer lost", consent(h, deliveryID, actors.Sender, "consent"), http.StatusServiceUnavailable, "RETURN_FEE_PENDING")
	if row := loadReturnRow(t, h, deliveryID); row.ChargeStatus != "reserving" {
		t.Fatalf("the write-ahead marker must stay: %+v", row)
	}
	if custodyState(t, h, deliveryID) != "return_proposed" {
		t.Fatal("an unconfirmed reservation must not move custody")
	}

	requireResult(t, "approve again", consent(h, deliveryID, actors.Sender, "consent"), http.StatusOK, `"chargeStatus":"reserved"`)
	if charge := h.Payment.Charge(returnID(t, h, deliveryID)); charge.Reserves != 1 || charge.State != "reserved" {
		t.Fatalf("the retry must replay the one reservation, got %+v", charge)
	}
	if custodyState(t, h, deliveryID) != "returning" {
		t.Fatal("the confirmed reservation moves custody to returning")
	}
}

// TestChargedReturnRejectReleasesAPossiblyHeldFeeFirst: after an approval
// whose outcome was unknown, a rejection releases the fee before resolving —
// and if the release cannot be confirmed, nothing is resolved yet.
func TestChargedReturnRejectReleasesAPossiblyHeldFeeFirst(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true})
	deliveryID, actors := chargedReturn(t, h, 100000)
	sender := actors.Sender.UserID.String()
	h.Payment.FailAfterApply("reserve", 1)
	requireResult(t, "approve, answer lost", consent(h, deliveryID, actors.Sender, "consent"), http.StatusServiceUnavailable, "RETURN_FEE_PENDING")

	h.Payment.FailNext("release", 1)
	requireResult(t, "reject while payment-service is down", consent(h, deliveryID, actors.Sender, "reject"), http.StatusServiceUnavailable, "RETURN_FEE_PENDING")
	if custodyState(t, h, deliveryID) != "return_proposed" {
		t.Fatal("a return must not resolve while its fee may still be held")
	}

	requireResult(t, "reject", consent(h, deliveryID, actors.Sender, "reject"), http.StatusOK, `"custodyState":"held_at_point"`)
	charge := h.Payment.Charge(returnID(t, h, deliveryID))
	if charge.State != "released" || charge.Releases != 1 || charge.Captures != 0 {
		t.Fatalf("payment-side charge = %+v, want released once, never captured", charge)
	}
	if h.Payment.Spendable(sender) != 100000 {
		t.Fatalf("spendable = %d, want fully restored", h.Payment.Spendable(sender))
	}
	if row := loadReturnRow(t, h, deliveryID); row.ChargeStatus != "released" || row.ConsentState != "rejected" {
		t.Fatalf("return row = %+v", row)
	}
}

// TestChargedReturnExpiryReleasesAReserveThatNeverLanded: the reserve never
// reached payment-service; the consent window then expires. The safe default
// still releases first (a tombstone there, so a late reserve cannot strand a
// hold) and only then holds the parcel at a point.
func TestChargedReturnExpiryReleasesAReserveThatNeverLanded(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true})
	deliveryID, actors := chargedReturn(t, h, 100000)
	h.Payment.FailNext("reserve", 1)
	requireResult(t, "approve, call never landed", consent(h, deliveryID, actors.Sender, "consent"), http.StatusServiceUnavailable, "RETURN_FEE_PENDING")
	if _, err := h.Pool.Exec(context.Background(), `UPDATE delivery_returns SET consent_expires_at = now() - interval '1 hour' WHERE delivery_id = $1`, deliveryID); err != nil {
		t.Fatalf("backdate: %v", err)
	}

	timeline := h.Do(req(http.MethodGet, custodyPath(deliveryID, "/"), nil), actors.Sender)
	if timeline.Code != http.StatusOK || !strings.Contains(timeline.Body.String(), `"state":"held_at_point"`) {
		t.Fatalf("expiry must default to the hold point: %s", timeline.Body.String())
	}
	charge := h.Payment.Charge(returnID(t, h, deliveryID))
	if charge == nil || !charge.Tombstone || charge.State != "released" {
		t.Fatalf("payment-side record = %+v, want a released tombstone", charge)
	}
	if h.Payment.Spendable(actors.Sender.UserID.String()) != 100000 {
		t.Fatal("nothing may stay held")
	}
}

// TestChargedReturnApprovalThatLosesTheRaceIsCompensated: the reservation
// succeeds but another request moves the custody first; the approval does not
// commit, so its fee is released in the same request.
func TestChargedReturnApprovalThatLosesTheRaceIsCompensated(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true})
	deliveryID, actors := chargedReturn(t, h, 100000)
	h.Payment.OnReserve = func() {
		if _, err := h.Pool.Exec(context.Background(), `UPDATE delivery_custody SET version = version + 1 WHERE delivery_id = $1`, deliveryID); err != nil {
			t.Errorf("race the custody: %v", err)
		}
	}

	requireResult(t, "approve and lose the race", consent(h, deliveryID, actors.Sender, "consent"), http.StatusConflict, "STATE_CONFLICT")
	charge := h.Payment.Charge(returnID(t, h, deliveryID))
	if charge.State != "released" || charge.Reserves != 1 || charge.Releases != 1 {
		t.Fatalf("payment-side charge = %+v, want reserved then released", charge)
	}
	if h.Payment.Spendable(actors.Sender.UserID.String()) != 100000 {
		t.Fatal("a compensated approval must hold nothing")
	}
	if row := loadReturnRow(t, h, deliveryID); row.ChargeStatus != "released" || row.ConsentState != "pending" {
		t.Fatalf("return row = %+v", row)
	}
	if custodyState(t, h, deliveryID) != "return_proposed" {
		t.Fatal("the losing approval must not have moved custody")
	}
}

// TestConcurrentDoubleApprovalKeepsTheWinnersFee: the sender's app sends the
// approval twice at once (a double tap, a retry racing its original). Both
// write the write-ahead marker and both reserve — payment-service replays the
// one reservation under the return's key — but only one custody transition
// can commit. The loser's compensation must NOT release the fee the winner
// just committed: the return is approved and on its way back, so its fee
// stays held for the capture.
func TestConcurrentDoubleApprovalKeepsTheWinnersFee(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true})
	deliveryID, actors := chargedReturn(t, h, 100000)

	var rival *httpResult
	var once sync.Once
	h.Payment.OnReserve = func() {
		// The first approval's reserve has landed but not yet answered: the
		// second approval runs start to finish (its reserve is a replay).
		once.Do(func() { rival = consent(h, deliveryID, actors.Sender, "consent") })
	}

	first := consent(h, deliveryID, actors.Sender, "consent")
	requireResult(t, "the rival approval", rival, http.StatusOK, `"chargeStatus":"reserved"`)
	requireResult(t, "the approval that lost the race", first, http.StatusConflict, "STATE_CONFLICT")

	charge := h.Payment.Charge(returnID(t, h, deliveryID))
	if charge.State != "reserved" || charge.Reserves != 1 || charge.Releases != 0 {
		t.Fatalf("payment-side charge = %+v, want the one reservation still held", charge)
	}
	if h.Payment.Spendable(actors.Sender.UserID.String()) != 100000-returnFee {
		t.Fatal("the approved return's fee must stay held")
	}
	if row := loadReturnRow(t, h, deliveryID); row.ChargeStatus != "reserved" || row.ConsentState != "consented" {
		t.Fatalf("return row = %+v, want consented and reserved", row)
	}
	if custodyState(t, h, deliveryID) != "returning" {
		t.Fatal("the winning approval moved custody to returning")
	}

	// And the fee is still captured when the driver completes the return.
	requireResult(t, "complete the return", completeReturn(t, h, deliveryID, actors.Driver, 351), http.StatusCreated, `"chargeStatus":"captured"`)
	if charge := h.Payment.Charge(returnID(t, h, deliveryID)); charge.Captures != 1 {
		t.Fatalf("payment-side charge = %+v, want captured once", charge)
	}
}

// TestRejectRacingAnApprovalNeverStrandsAFee: the sender rejects while an
// approval's reservation is in flight. The rejection must not resolve the
// return underneath a possibly-held fee: either it loses (and a retry
// releases first) or the approval loses and releases what it reserved.
func TestRejectRacingAnApprovalNeverStrandsAFee(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true})
	deliveryID, actors := chargedReturn(t, h, 100000)

	var rival *httpResult
	var once sync.Once
	h.Payment.OnReserve = func() {
		once.Do(func() { rival = consent(h, deliveryID, actors.Sender, "reject") })
	}
	approval := consent(h, deliveryID, actors.Sender, "consent")
	t.Logf("approval answered %d, the racing rejection %d", approval.Code, rival.Code)
	if approval.Code == http.StatusOK && rival.Code == http.StatusOK {
		t.Fatalf("an approval and a rejection cannot both win: %s / %s", approval.Body, rival.Body)
	}

	// Whatever happened, converge: reject until the return is resolved.
	for i := 0; i < 3 && custodyState(t, h, deliveryID) == "return_proposed"; i++ {
		consent(h, deliveryID, actors.Sender, "reject")
	}
	row := loadReturnRow(t, h, deliveryID)
	charge := h.Payment.Charge(returnID(t, h, deliveryID))
	switch custodyState(t, h, deliveryID) {
	case "held_at_point":
		if charge == nil || charge.State != "released" || row.ChargeStatus != "released" {
			t.Fatalf("a rejected return holds nothing: charge = %+v, row = %+v", charge, row)
		}
		if h.Payment.Spendable(actors.Sender.UserID.String()) != 100000 {
			t.Fatal("a rejected return's fee must be released in full")
		}
	case "returning":
		if charge == nil || charge.State != "reserved" || row.ChargeStatus != "reserved" || row.ConsentState != "consented" {
			t.Fatalf("an approved return keeps its fee: charge = %+v, row = %+v", charge, row)
		}
	default:
		t.Fatalf("unexpected custody state %s", custodyState(t, h, deliveryID))
	}
}

// TestOpsCancelledChargeCompletesFeeFree: ops release a held fee; the return
// carries on and completes without any capture.
func TestOpsCancelledChargeCompletesFeeFree(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true})
	deliveryID, actors := chargedReturn(t, h, 100000)
	requireResult(t, "approve", consent(h, deliveryID, actors.Sender, "consent"), http.StatusOK, `"chargeStatus":"reserved"`)

	cancel := func(actor testutil.Actor) *httpResult {
		rec := h.Do(req(http.MethodPost, custodyPath(deliveryID, "/return/cancel-charge"), map[string]string{"reason": "goodwill waiver"}), actor)
		return &httpResult{rec.Code, rec.Body.String()}
	}
	requireResult(t, "the sender cannot cancel the fee", cancel(actors.Sender), http.StatusForbidden, "FORBIDDEN")
	requireResult(t, "the driver cannot cancel the fee", cancel(actors.Driver), http.StatusForbidden, "FORBIDDEN")
	requireResult(t, "ops cancel the fee", cancel(admin()), http.StatusOK, `"chargeStatus":"released"`)
	requireResult(t, "nothing left to cancel", cancel(admin()), http.StatusConflict, "STATE_CONFLICT")

	requireResult(t, "complete fee-free", completeReturn(t, h, deliveryID, actors.Driver, 301), http.StatusCreated, `"chargeStatus":"released"`)
	charge := h.Payment.Charge(returnID(t, h, deliveryID))
	if charge.Captures != 0 || charge.Releases != 1 {
		t.Fatalf("payment-side charge = %+v, want released once and never captured", charge)
	}
	if h.Payment.Spendable(actors.Sender.UserID.String()) != 100000 {
		t.Fatal("a cancelled fee is fully released")
	}
	if custodyState(t, h, deliveryID) != "return_to_sender" {
		t.Fatal("the return itself still completes")
	}
}

// TestPendingCaptureIsRetriedAndNeverDoubled: the parcel is back but the
// capture could not be confirmed; the completion says so (202), and the next
// read settles it — once.
func TestPendingCaptureIsRetriedAndNeverDoubled(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true})
	deliveryID, actors := chargedReturn(t, h, 100000)
	requireResult(t, "approve", consent(h, deliveryID, actors.Sender, "consent"), http.StatusOK, `"chargeStatus":"reserved"`)

	h.Payment.FailNext("capture", 1)
	requireResult(t, "complete while capture is down", completeReturn(t, h, deliveryID, actors.Driver, 401), http.StatusAccepted, `"chargeStatus":"capture_pending"`)
	if custodyState(t, h, deliveryID) != "return_to_sender" {
		t.Fatal("the hand-back is recorded even while the capture is owed")
	}

	for i := 0; i < 3; i++ {
		if rec := h.Do(req(http.MethodGet, custodyPath(deliveryID, "/"), nil), actors.Sender); rec.Code != http.StatusOK {
			t.Fatalf("timeline: %d %s", rec.Code, rec.Body.String())
		}
	}
	charge := h.Payment.Charge(returnID(t, h, deliveryID))
	if charge.State != "captured" || charge.Captures != 1 {
		t.Fatalf("payment-side charge = %+v, want captured exactly once", charge)
	}
	if row := loadReturnRow(t, h, deliveryID); row.ChargeStatus != "captured" || row.ChargeEntry == "" {
		t.Fatalf("return row = %+v", row)
	}
}

// TestKillSwitchStopsNewChargesButNeverStrandsMoney: turning charged returns
// off (here, or payment-service's city switch) refuses new charges, while an
// already reserved fee is still captured.
func TestKillSwitchStopsNewChargesButNeverStrandsMoney(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true})
	reserved, actors := chargedReturn(t, h, 100000)
	requireResult(t, "approve", consent(h, reserved, actors.Sender, "consent"), http.StatusOK, `"chargeStatus":"reserved"`)
	proposedOnly, others := chargedReturn(t, h, 100000)

	h.Cfg.ChargedReturnsEnabled = false
	fresh, freshActors := h.SeedDelivery(context.Background(), testutil.Actor{}, testutil.Actor{}, "recipient_unreachable")
	requireResult(t, "a new charged proposal", proposeFee(h, fresh, freshActors.Driver, returnFee, "NGN"), http.StatusConflict, "CHARGED_RETURNS_NOT_OFFERED")
	requireResult(t, "approving an older charged proposal", consent(h, proposedOnly, others.Sender, "consent"), http.StatusConflict, "CHARGED_RETURNS_NOT_OFFERED")
	requireResult(t, "the older proposal can still be rejected", consent(h, proposedOnly, others.Sender, "reject"), http.StatusOK, "held_at_point")

	requireResult(t, "complete the reserved return", completeReturn(t, h, reserved, actors.Driver, 501), http.StatusCreated, `"chargeStatus":"captured"`)
	if charge := h.Payment.Charge(returnID(t, h, reserved)); charge.Captures != 1 {
		t.Fatalf("the reserved fee must still be captured once, got %+v", charge)
	}

	// payment-service's own city switch refuses at approval the same way.
	h.Cfg.ChargedReturnsEnabled = true
	cityOff, cityActors := chargedReturn(t, h, 100000)
	h.Payment.DisableCity("LOS")
	requireResult(t, "approve in a city with the switch off", consent(h, cityOff, cityActors.Sender, "consent"), http.StatusConflict, "CHARGED_RETURNS_NOT_OFFERED")
	if row := loadReturnRow(t, h, cityOff); row.ChargeStatus != "authorization_required" {
		t.Fatalf("a refused reservation holds nothing: %+v", row)
	}
}
