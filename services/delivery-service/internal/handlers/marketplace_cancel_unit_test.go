/*
 * Unit tests for marketplace-cancel's pure decisions and its fail-closed
 * posture, without a database. The handler against the real schema —
 * cancellation, replay, refusals, the pickup race — is exercised in
 * marketplace_cancel_test.go.
 */

package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/config"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/custody"
)

func int64Ptr(v int64) *int64 { return &v }

func TestValidateMarketplaceCancel(t *testing.T) {
	valid := func() MarketplaceCancelRequest {
		return MarketplaceCancelRequest{
			AwardID:      "8c3f7f1e-6a44-4b8c-9d6e-1f2a3b4c5d6e",
			DeliveryID:   "5b0e0f4a-2d1c-4f7e-9a3b-6c8d1e2f3a4b",
			FencingToken: int64Ptr(7),
			Reason:       "driver_offline",
		}
	}
	if problems := validateMarketplaceCancel(ptr(valid())); len(problems) != 0 {
		t.Fatalf("a valid cancellation has problems: %v", problems)
	}
	zero := valid()
	zero.FencingToken = int64Ptr(0)
	if problems := validateMarketplaceCancel(&zero); len(problems) != 0 {
		t.Fatalf("fencing token 0 is a valid token: %v", problems)
	}
	cases := map[string]func(*MarketplaceCancelRequest){
		"no award id":            func(r *MarketplaceCancelRequest) { r.AwardID = " " },
		"no delivery id":         func(r *MarketplaceCancelRequest) { r.DeliveryID = "" },
		"a delivery id not UUID": func(r *MarketplaceCancelRequest) { r.DeliveryID = "del_123" },
		"no fencing token":       func(r *MarketplaceCancelRequest) { r.FencingToken = nil },
		"a negative token":       func(r *MarketplaceCancelRequest) { r.FencingToken = int64Ptr(-1) },
		"no reason":              func(r *MarketplaceCancelRequest) { r.Reason = "  " },
		"an essay for a reason":  func(r *MarketplaceCancelRequest) { r.Reason = strings.Repeat("x", maxCancelReasonLength+1) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			req := valid()
			mutate(&req)
			if problems := validateMarketplaceCancel(&req); len(problems) != 1 {
				t.Fatalf("problems = %v, want exactly one", problems)
			}
		})
	}
}

func ptr[T any](v T) *T { return &v }

// TestOnlyAnUnpickedDeliveryIsCancellable: custody before pickup can be
// taken back; from pickup on the parcel is with the driver and it cannot.
func TestOnlyAnUnpickedDeliveryIsCancellable(t *testing.T) {
	for _, state := range custody.States() {
		want := state == custody.CourierAssigned || state == custody.Created
		if got := cancellableCustody(state); got != want {
			t.Errorf("cancellableCustody(%q) = %v, want %v", state, got, want)
		}
	}
}

// TestMarketplaceCancelFailsClosedUnderDefaultKey: through the real router,
// the committed default key passes ServiceAuth (the legacy webhooks still
// accept it outside production) but can never cancel a delivery — 503, which
// ride-service classifies as misconfiguration and keeps the intent owed —
// and, being public, it buys no exemption from the client limiter either.
func TestMarketplaceCancelFailsClosedUnderDefaultKey(t *testing.T) {
	router, _ := NewRouter(New(nil, nil, &config.Config{InternalServiceKey: committedDefaultServiceKey}))
	body, err := json.Marshal(map[string]any{
		"awardId": "8c3f7f1e-6a44-4b8c-9d6e-1f2a3b4c5d6e", "deliveryId": "5b0e0f4a-2d1c-4f7e-9a3b-6c8d1e2f3a4b",
		"fencingToken": 7, "reason": "driver_offline",
	})
	if err != nil {
		t.Fatal(err)
	}
	send := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/marketplace-cancel", bytes.NewReader(body))
		req.Header.Set("X-Service-Key", committedDefaultServiceKey)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	rec := send()
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "SERVICE_KEY_NOT_CONFIGURED") {
		t.Fatalf("status = %d, body = %s; want 503 SERVICE_KEY_NOT_CONFIGURED", rec.Code, rec.Body.String())
	}
	limited := false
	for i := 0; i < 100 && !limited; i++ {
		limited = send().Code == http.StatusTooManyRequests
	}
	if !limited {
		t.Fatal("the committed default key must be counted per client, never exempt")
	}
}
