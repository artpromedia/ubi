package marketplace_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
)

// These tests exercise the REAL HTTP clients (HTTPWallet, HTTPFunding)
// against a server that answers exactly what payment-service documents for
// the post-award amendment routes (services/payment-service/docs/
// MARKETPLACE-MONEY.md "Post-award amendments", mounted in
// src/routes/mp-holds.ts). The server asserts what a real payment-service
// would refuse — the X-Service-Key, a url-safe Idempotency-Key, the path
// family, the body shape (Money objects for the commission delta, bare
// integers for funding) — and answers the documented status codes and
// error bodies, so the client's wire shape and its error mapping (definite
// 409/422 refusals vs unknown 5xx outcomes) are proven end to end over HTTP.

const wireServiceKey = "wire-test-internal-key"

type wireCall struct {
	method, path, idempotencyKey string
	body                         map[string]any
}

type paymentWire struct {
	t       *testing.T
	mu      sync.Mutex
	calls   []wireCall
	answers map[string]func(call wireCall) (int, any)
}

func newPaymentWire(t *testing.T) (*paymentWire, *httptest.Server) {
	wire := &paymentWire{t: t, answers: map[string]func(call wireCall) (int, any){}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &body); err != nil {
				t.Errorf("%s %s: unparseable body %q", r.Method, r.URL.Path, raw)
			}
		}
		call := wireCall{method: r.Method, path: r.URL.Path, idempotencyKey: r.Header.Get("Idempotency-Key"), body: body}
		wire.mu.Lock()
		wire.calls = append(wire.calls, call)
		answer := wire.answers[r.URL.Path]
		wire.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Header.Get("X-Service-Key") != wireServiceKey:
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"code":"unauthorized","message":"service key required"}`))
			return
		case len(call.idempotencyKey) < 8 || len(call.idempotencyKey) > 64 ||
			strings.Trim(call.idempotencyKey, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.:-") != "":
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"code":"validation_failed","message":"a valid idempotency-key header is required"}`))
			return
		case answer == nil:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"code":"not_found","message":"no such route"}`))
			return
		}
		status, response := answer(call)
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(response)
	}))
	t.Cleanup(server.Close)
	return wire, server
}

func (w *paymentWire) on(path string, answer func(call wireCall) (int, any)) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.answers[path] = answer
}

func (w *paymentWire) last() wireCall {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.calls[len(w.calls)-1]
}

// moneyField asserts a documented Money body field: {amountMinor, currency}.
func moneyField(t *testing.T, body map[string]any, key string) int64 {
	t.Helper()
	object, ok := body[key].(map[string]any)
	if !ok {
		t.Fatalf("%s must be a Money object, got %#v", key, body[key])
	}
	amount, ok := object["amountMinor"].(float64)
	if !ok || object["currency"] != "NGN" || len(object) != 2 {
		t.Fatalf("%s is not {amountMinor, currency}: %#v", key, object)
	}
	return int64(amount)
}

func deltaAnswer(direction, state string, delta int64) map[string]any {
	return map[string]any{
		"reservationId": "mph_award", "amendmentId": "amd_1", "awardId": "awd_1",
		"direction": direction, "state": state, "deltaReservationId": "mph_delta",
		"deltaMinor":      map[string]any{"amountMinor": delta, "currency": "NGN"},
		"priorTotalMinor": map[string]any{"amountMinor": 50_000, "currency": "NGN"},
		"newTotalMinor":   map[string]any{"amountMinor": 60_050, "currency": "NGN"},
		"newBaseMinor":    map[string]any{"amountMinor": 600_500, "currency": "NGN"},
		"receiptId":       nil, "journalEntryId": nil, "originalReceiptId": "mcr_orig",
	}
}

// TestHTTPWalletCommissionDeltaWireContract: the four commission-delta
// operations hit /v1/wallet/mp/holds/{captured hold}/amendments/{id}/{op}
// with the documented bodies, and the client maps the documented answers:
// 201/200 success, 422 insufficient_spendable (definite, details kept),
// 409 version_conflict carrying refreshedTerms, 409 conflict, and a 5xx as
// an UNKNOWN outcome the saga must re-poll rather than treat as a no-op.
func TestHTTPWalletCommissionDeltaWireContract(t *testing.T) {
	wire, server := newPaymentWire(t)
	wallet := marketplace.NewHTTPWallet(server.URL, wireServiceKey, nil)
	ctx := context.Background()
	terms := marketplace.DeltaTerms{
		AwardID:         "awd_1",
		PriorTotalMinor: marketplace.Money{AmountMinor: 50_000, Currency: "NGN"},
		NewTotalMinor:   marketplace.Money{AmountMinor: 60_050, Currency: "NGN"},
		NewBaseMinor:    marketplace.Money{AmountMinor: 600_500, Currency: "NGN"},
	}

	base := "/v1/wallet/mp/holds/mph_award/amendments/amd_1/"
	wire.on(base+"reserve", func(call wireCall) (int, any) {
		if call.method != http.MethodPost || moneyField(t, call.body, "priorTotalMinor") != 50_000 ||
			moneyField(t, call.body, "newTotalMinor") != 60_050 || moneyField(t, call.body, "newBaseMinor") != 600_500 ||
			call.body["awardId"] != "awd_1" || len(call.body) != 4 {
			t.Errorf("reserve body: %#v", call.body)
		}
		return http.StatusCreated, deltaAnswer("increase", "active", 10_050)
	})
	delta, err := wallet.ReserveCommissionDelta(ctx, "mph_award", "amd_1", terms, "mp.amd.res:amd-1")
	if err != nil || delta.Direction != "increase" || delta.State != "active" || delta.DeltaMinor.AmountMinor != 10_050 {
		t.Fatalf("reserve: %+v, %v", delta, err)
	}
	if wire.last().idempotencyKey != "mp.amd.res:amd-1" {
		t.Fatalf("the Idempotency-Key header must be sent: %q", wire.last().idempotencyKey)
	}

	wire.on(base+"capture", func(call wireCall) (int, any) {
		if call.body["awardId"] != "awd_1" || moneyField(t, call.body, "newTotalMinor") != 60_050 || len(call.body) != 2 {
			t.Errorf("capture body: %#v", call.body)
		}
		answer := deltaAnswer("increase", "captured", 10_050)
		answer["receiptId"] = "mcr_delta"
		return http.StatusOK, answer
	})
	captured, err := wallet.CaptureCommissionDelta(ctx, "mph_award", "amd_1", "awd_1",
		marketplace.Money{AmountMinor: 60_050, Currency: "NGN"}, "mp.amd.cap:amd-1")
	if err != nil || captured.State != "captured" || captured.ReceiptID == nil || *captured.ReceiptID != "mcr_delta" {
		t.Fatalf("capture: %+v, %v", captured, err)
	}

	wire.on(base+"release", func(call wireCall) (int, any) {
		if call.body["awardId"] != "awd_1" || call.body["reason"] != "rider_rejected" || len(call.body) != 2 {
			t.Errorf("release body: %#v", call.body)
		}
		return http.StatusOK, deltaAnswer("none", "released", 0)
	})
	released, err := wallet.ReleaseCommissionDelta(ctx, "mph_award", "amd_1", "awd_1", "rider_rejected", "mp.amd.rel:amd-1")
	if err != nil || released.Direction != "none" || released.State != "released" {
		t.Fatalf("release: %+v, %v", released, err)
	}

	decrease := terms
	decrease.NewTotalMinor = marketplace.Money{AmountMinor: 40_000, Currency: "NGN"}
	decrease.NewBaseMinor = marketplace.Money{AmountMinor: 400_000, Currency: "NGN"}
	wire.on(base+"refund", func(call wireCall) (int, any) {
		if moneyField(t, call.body, "newTotalMinor") != 40_000 || moneyField(t, call.body, "priorTotalMinor") != 50_000 {
			t.Errorf("refund body: %#v", call.body)
		}
		answer := deltaAnswer("decrease", "refunded", 10_000)
		answer["deltaReservationId"] = nil
		return http.StatusCreated, answer
	})
	refunded, err := wallet.RefundCommissionDelta(ctx, "mph_award", "amd_1", decrease, "mp.amd.ref:amd-1")
	if err != nil || refunded.Direction != "decrease" || refunded.DeltaReservationID != nil || refunded.DeltaMinor.AmountMinor != 10_000 {
		t.Fatalf("refund: %+v, %v", refunded, err)
	}

	// Documented refusals, mapped to definite domain errors with details.
	wire.on(base+"reserve", func(wireCall) (int, any) {
		return http.StatusUnprocessableEntity, map[string]any{
			"code": "insufficient_spendable", "message": "the spendable balance does not cover it",
			"details": map[string]any{"requiredMinor": 10_050, "spendableMinor": 2_000, "shortfallMinor": 8_050},
		}
	})
	_, err = wallet.ReserveCommissionDelta(ctx, "mph_award", "amd_1", terms, "mp.amd.res:amd-1")
	mapped, ok := domain.AsError(err)
	if !ok || mapped.Code != domain.CodeInsufficientSpendable || mapped.Status() != http.StatusUnprocessableEntity ||
		mapped.Details["shortfallMinor"] != float64(8_050) || errors.Is(err, marketplace.ErrWalletUnknownOutcome) {
		t.Fatalf("insufficient_spendable must be a definite 422 with its details: %v", err)
	}
	wire.on(base+"reserve", func(wireCall) (int, any) {
		return http.StatusConflict, map[string]any{
			"code": "version_conflict", "message": "the prior total is not the award's captured commission",
			"details": map[string]any{"refreshedTerms": map[string]any{
				"capturedTotalMinor": map[string]any{"amountMinor": 55_000, "currency": "NGN"},
			}},
		}
	})
	_, err = wallet.ReserveCommissionDelta(ctx, "mph_award", "amd_1", terms, "mp.amd.res:amd-1")
	mapped, ok = domain.AsError(err)
	if !ok || mapped.Code != domain.CodeVersionConflict {
		t.Fatalf("a stale prior must be a definite version_conflict: %v", err)
	}
	refreshed, _ := mapped.Details["refreshedTerms"].(map[string]any)
	if captured, _ := refreshed["capturedTotalMinor"].(map[string]any); captured["amountMinor"] != float64(55_000) {
		t.Fatalf("the refreshed captured total must reach the caller: %#v", mapped.Details)
	}
	wire.on(base+"capture", func(wireCall) (int, any) {
		return http.StatusConflict, map[string]any{"code": "conflict", "message": "this amendment's increment was released"}
	})
	if _, err = wallet.CaptureCommissionDelta(ctx, "mph_award", "amd_1", "awd_1",
		marketplace.Money{AmountMinor: 60_050, Currency: "NGN"}, "mp.amd.cap:amd-1"); !isCode(err, domain.CodeConflict) {
		t.Fatalf("capture after release must be a definite conflict: %v", err)
	}
	wire.on(base+"capture", func(wireCall) (int, any) {
		return http.StatusBadGateway, map[string]any{"message": "upstream"}
	})
	if _, err = wallet.CaptureCommissionDelta(ctx, "mph_award", "amd_1", "awd_1",
		marketplace.Money{AmountMinor: 60_050, Currency: "NGN"}, "mp.amd.cap:amd-1"); !errors.Is(err, marketplace.ErrWalletUnknownOutcome) {
		t.Fatalf("a 5xx must be an UNKNOWN outcome, never a no-op: %v", err)
	}

	// A wallet nobody wired fails closed.
	if _, err := marketplace.NewHTTPWallet("", wireServiceKey, nil).ReserveCommissionDelta(ctx, "h", "a", terms, "mp.amd.res:x-1"); !isCode(err, domain.CodeServiceUnavailable) {
		t.Fatalf("an unwired wallet must refuse: %v", err)
	}
	// A wrong service key is refused before any money path runs.
	if _, err := marketplace.NewHTTPWallet(server.URL, "wrong", nil).ReleaseCommissionDelta(ctx, "mph_award", "amd_1", "awd_1", "r", "mp.amd.rel:amd-1"); !isCode(err, domain.CodeUnauthorized) {
		t.Fatalf("a wrong service key must be refused: %v", err)
	}
}

func isCode(err error, code domain.Code) bool {
	mapped, ok := domain.AsError(err)
	return ok && mapped.Code == code
}

// TestHTTPFundingAmendmentWireContract: the four rider-funding amendment
// operations hit /v1/wallet/mp/funding/{top-up,top-up/commit,top-up/release,
// partial-release} with bare-integer amounts, and the documented answers map:
// 201 reserved, 200 committed/released, cash secured:false, 422
// insufficient_funds, 409 version_conflict with refreshedTerms, 404
// not_found for a commit with nothing reserved.
func TestHTTPFundingAmendmentWireContract(t *testing.T) {
	wire, server := newPaymentWire(t)
	funding := marketplace.NewHTTPFunding(server.URL, wireServiceKey, nil)
	ctx := context.Background()
	award := uuid.New()
	requester := uuid.New()
	req := marketplace.FundingAmendment{
		RequesterID: requester, AwardID: award, AmendmentID: "amd_1", PaymentMethodID: "wallet",
		PriorAmountMinor: 500_000, NewAmountMinor: 600_000, Currency: "NGN", CityID: "city_1",
	}
	adjustment := func(kind, status string, secured bool) map[string]any {
		return map[string]any{
			"awardId": award.String(), "amendmentId": "amd_1", "kind": kind, "secured": secured, "status": status,
			"adjustmentId": "mra_1", "reservationId": "mrr_1", "deltaMinor": 100_000,
			"priorAmountMinor": 500_000, "newAmountMinor": 600_000, "currency": "NGN", "replayed": false,
		}
	}

	wire.on("/v1/wallet/mp/funding/top-up", func(call wireCall) (int, any) {
		for key, want := range map[string]any{
			"requesterId": requester.String(), "awardId": award.String(), "amendmentId": "amd_1",
			"paymentMethodId": "wallet", "priorAmountMinor": float64(500_000), "newAmountMinor": float64(600_000),
			"currency": "NGN", "cityId": "city_1",
		} {
			if call.body[key] != want {
				t.Errorf("top-up %s: %#v, want %#v", key, call.body[key], want)
			}
		}
		if len(call.body) != 8 {
			t.Errorf("top-up body carries extra fields: %#v", call.body)
		}
		return http.StatusCreated, adjustment("top_up", "reserved", true)
	})
	topped, err := funding.TopUp(ctx, req, "mp.amd.fund:amd-1")
	if err != nil || topped.Kind != "top_up" || topped.Status != "reserved" || !topped.Secured || topped.DeltaMinor != 100_000 {
		t.Fatalf("top-up: %+v, %v", topped, err)
	}

	wire.on("/v1/wallet/mp/funding/top-up/commit", func(call wireCall) (int, any) {
		if call.body["awardId"] != award.String() || call.body["amendmentId"] != "amd_1" ||
			call.body["newAmountMinor"] != float64(600_000) || len(call.body) != 3 {
			t.Errorf("commit body: %#v", call.body)
		}
		return http.StatusOK, adjustment("top_up", "committed", true)
	})
	committed, err := funding.CommitTopUp(ctx, award, "amd_1", 600_000, "mp.amd.fcom:amd-1")
	if err != nil || committed.Status != "committed" {
		t.Fatalf("commit: %+v, %v", committed, err)
	}

	wire.on("/v1/wallet/mp/funding/top-up/release", func(call wireCall) (int, any) {
		if call.body["reason"] != "expired" || len(call.body) != 3 {
			t.Errorf("release body: %#v", call.body)
		}
		return http.StatusOK, adjustment("top_up", "released", true)
	})
	if released, err := funding.ReleaseTopUp(ctx, award, "amd_1", "expired", "mp.amd.frel:amd-1"); err != nil || released.Status != "released" {
		t.Fatalf("release: %+v, %v", released, err)
	}

	decrease := req
	decrease.PriorAmountMinor, decrease.NewAmountMinor = 600_000, 450_000
	wire.on("/v1/wallet/mp/funding/partial-release", func(call wireCall) (int, any) {
		if call.body["priorAmountMinor"] != float64(600_000) || call.body["newAmountMinor"] != float64(450_000) {
			t.Errorf("partial-release body: %#v", call.body)
		}
		return http.StatusCreated, adjustment("partial_release", "committed", true)
	})
	if partial, err := funding.PartialRelease(ctx, decrease, "mp.amd.prel:amd-1"); err != nil || partial.Kind != "partial_release" {
		t.Fatalf("partial release: %+v, %v", partial, err)
	}

	// Cash: 200 with secured:false and no row.
	wire.on("/v1/wallet/mp/funding/top-up", func(wireCall) (int, any) {
		answer := adjustment("top_up", "unsecured", false)
		answer["adjustmentId"] = nil
		return http.StatusOK, answer
	})
	if cash, err := funding.TopUp(ctx, req, "mp.amd.fund:amd-2"); err != nil || cash.Secured || cash.AdjustmentID != nil {
		t.Fatalf("cash top-up must answer unsecured: %+v, %v", cash, err)
	}

	// Documented refusals.
	wire.on("/v1/wallet/mp/funding/top-up", func(wireCall) (int, any) {
		return http.StatusUnprocessableEntity, map[string]any{
			"code": "insufficient_funds", "message": "the wallet cannot cover the amended fare",
			"details": map[string]any{"requiredMinor": 100_000, "spendableMinor": 1_000, "shortfallMinor": 99_000},
		}
	})
	_, err = funding.TopUp(ctx, req, "mp.amd.fund:amd-1")
	mapped, ok := domain.AsError(err)
	if !ok || mapped.Code != domain.CodeInsufficientFunds || mapped.Status() != http.StatusUnprocessableEntity {
		t.Fatalf("insufficient_funds must be a definite 422 (ported code): %v", err)
	}
	wire.on("/v1/wallet/mp/funding/partial-release", func(wireCall) (int, any) {
		return http.StatusConflict, map[string]any{
			"code": "version_conflict", "message": "the prior amount is not what the award is funded to",
			"details": map[string]any{"refreshedTerms": map[string]any{"fundedAmountMinor": 550_000, "currency": "NGN"}},
		}
	})
	_, err = funding.PartialRelease(ctx, decrease, "mp.amd.prel:amd-1")
	if mapped, ok = domain.AsError(err); !ok || mapped.Code != domain.CodeVersionConflict ||
		mapped.Details["refreshedTerms"].(map[string]any)["fundedAmountMinor"] != float64(550_000) {
		t.Fatalf("a stale funding prior must carry the refreshed funded amount: %v", err)
	}
	wire.on("/v1/wallet/mp/funding/top-up/commit", func(wireCall) (int, any) {
		return http.StatusNotFound, map[string]any{"code": "not_found", "message": "no top-up is reserved for this amendment"}
	})
	if _, err = funding.CommitTopUp(ctx, award, "amd_9", 600_000, "mp.amd.fcom:amd-9"); !isCode(err, domain.CodeNotFound) {
		t.Fatalf("a commit with nothing reserved must be not_found: %v", err)
	}
	wire.on("/v1/wallet/mp/funding/top-up/commit", func(wireCall) (int, any) {
		return http.StatusServiceUnavailable, map[string]any{"message": "down"}
	})
	if _, err = funding.CommitTopUp(ctx, award, "amd_1", 600_000, "mp.amd.fcom:amd-1"); !errors.Is(err, marketplace.ErrWalletUnknownOutcome) {
		t.Fatalf("a 5xx must be an UNKNOWN outcome: %v", err)
	}
}
