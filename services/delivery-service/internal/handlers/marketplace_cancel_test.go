package handlers_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/testutil"
)

// POST /api/v1/webhooks/marketplace-cancel against the REAL router and the
// REAL Prisma schema: the compensation ride-service owes delivery-service
// when a queued delivery award is cancelled (services/ride-service/internal/
// marketplace/delivery_cancel.go). The request/answer contract pinned here is
// the one ride-service's classifyDeliveryCancelAnswer maps: 200 (and the
// idempotent replay) → cancelled; 404 DELIVERY_NOT_FOUND, 409
// DELIVERY_NOT_CANCELLABLE, 409 AWARD_REPLAY_MISMATCH, 400 VALIDATION_ERROR /
// INVALID_JSON → a permanent refusal ops resolves; 403 / 503
// SERVICE_KEY_NOT_CONFIGURED → misconfiguration.

func cancelBody(awardID, deliveryID string, fencingToken int64, reason string) map[string]interface{} {
	return map[string]interface{}{
		"awardId":      awardID,
		"deliveryId":   deliveryID,
		"fencingToken": fencingToken,
		"reason":       reason,
	}
}

func postCancelWithKey(h *testutil.Harness, body interface{}, key string) *httptest.ResponseRecorder {
	r := req(http.MethodPost, "/api/v1/webhooks/marketplace-cancel", body)
	if key != "" {
		r.Header.Set("X-Service-Key", key)
	}
	rec := httptest.NewRecorder()
	h.Router.ServeHTTP(rec, r)
	return rec
}

func postCancel(h *testutil.Harness, body interface{}) *httptest.ResponseRecorder {
	return postCancelWithKey(h, body, h.ServiceKey())
}

// assignedDelivery hands an award off through the real marketplace-assign
// (fencing token 3, assignBody) and returns the delivery id and its parties.
func assignedDelivery(t *testing.T, h *testutil.Harness) (awardID, deliveryID string, sender, driver testutil.Actor) {
	t.Helper()
	ctx := context.Background()
	sender, driver = testutil.Sender(), testutil.Driver()
	h.SeedUser(ctx, sender.UserID.String())
	h.SeedRiderProfile(ctx, sender.UserID.String())
	awardID = uuid.New().String()
	cleanupAward(t, h, awardID)
	rec := postAssign(h, assignBody(awardID, sender.UserID.String(), driver.UserID.String()))
	if rec.Code != http.StatusCreated {
		t.Fatalf("marketplace-assign: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var created assignSummary
	decode(t, rec, &created)
	deliveryID = created.Data.ID
	cleanupDeliveryEvents(t, h, deliveryID)
	return awardID, deliveryID, sender, driver
}

// cleanupDeliveryEvents removes the outbox and audit rows a test's delivery
// wrote (deliveries cascade the rest).
func cleanupDeliveryEvents(t *testing.T, h *testutil.Harness, deliveryID string) {
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = h.Pool.Exec(ctx, `DELETE FROM public.outbox_events WHERE aggregate_type = 'shipment' AND aggregate_id = $1`, deliveryID)
		_, _ = h.Pool.Exec(ctx, `DELETE FROM public.audit_log WHERE subject_id = $1`, deliveryID)
	})
}

type cancellationAnswer struct {
	Data struct {
		ID                 string  `json:"id"`
		Status             string  `json:"status"`
		MarketplaceAwardID string  `json:"marketplaceAwardId"`
		CustodyState       string  `json:"custodyState"`
		CancelledAt        *string `json:"cancelledAt"`
	} `json:"data"`
}

type deliveryRows struct {
	custodyState   string
	custodyVersion int
	custodyEvents  int
	status         string
	cancelReason   string
	cancelledAt    bool
	cancelEvents   int
	cancelAudits   int
}

func readDeliveryRows(t *testing.T, h *testutil.Harness, deliveryID string) deliveryRows {
	t.Helper()
	var rows deliveryRows
	if err := h.Pool.QueryRow(context.Background(), `
		SELECT c.state, c.version, c.cancelled_at IS NOT NULL,
			(SELECT count(*) FROM custody_events e WHERE e.custody_id = c.id),
			d.status::text, COALESCE(d.marketplace_metadata->>'marketplaceCancelReason', ''),
			(SELECT count(*) FROM public.outbox_events o WHERE o.aggregate_type = 'shipment' AND o.aggregate_id = $1::text AND o.name = 'shipment.cancelled'),
			(SELECT count(*) FROM public.audit_log a WHERE a.subject_id = $1::text AND a.action = 'delivery.marketplace_cancelled')
		FROM deliveries d JOIN delivery_custody c ON c.delivery_id = d.id
		WHERE d.id = $1::uuid`, deliveryID).Scan(&rows.custodyState, &rows.custodyVersion, &rows.cancelledAt, &rows.custodyEvents,
		&rows.status, &rows.cancelReason, &rows.cancelEvents, &rows.cancelAudits); err != nil {
		t.Fatalf("read the delivery rows: %v", err)
	}
	return rows
}

// TestMarketplaceCancelCancelsAnAssignedDeliveryOnce: a delivery still at
// courier_assigned is cancelled — custody, the legacy row, the custody
// timeline, the shipment.cancelled outbox event and the audit row together —
// and a replay answers the same 200 without writing anything again.
func TestMarketplaceCancelCancelsAnAssignedDeliveryOnce(t *testing.T) {
	h := testutil.NewHarness(t)
	awardID, deliveryID, sender, driver := assignedDelivery(t, h)

	rec := postCancel(h, cancelBody(awardID, deliveryID, 3, "driver_offline"))
	if rec.Code != http.StatusOK {
		t.Fatalf("marketplace-cancel: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var first cancellationAnswer
	decode(t, rec, &first)
	if first.Data.ID != deliveryID || first.Data.Status != "CANCELLED" || first.Data.MarketplaceAwardID != awardID ||
		first.Data.CustodyState != "cancelled" || first.Data.CancelledAt == nil {
		t.Fatalf("answer = %+v", first.Data)
	}

	rows := readDeliveryRows(t, h, deliveryID)
	if rows.custodyState != "cancelled" || rows.custodyVersion != 2 || !rows.cancelledAt || rows.custodyEvents != 2 {
		t.Fatalf("custody = %+v, want cancelled at version 2 with 2 timeline events", rows)
	}
	if rows.status != "FAILED" || rows.cancelReason != "driver_offline" {
		t.Fatalf("legacy row = status %s reason %q", rows.status, rows.cancelReason)
	}
	if rows.cancelEvents != 1 || rows.cancelAudits != 1 {
		t.Fatalf("outbox %d, audit %d; want exactly one of each", rows.cancelEvents, rows.cancelAudits)
	}

	// The outbox row is a valid envelope for the shared relay.
	var (
		actorType, actorID, key, aggregateType string
		fromVersion                            *int
		toVersion                              int
		rawPayload                             []byte
	)
	if err := h.Pool.QueryRow(context.Background(), `
		SELECT actor_type, actor_id, idempotency_key, aggregate_type, from_version, to_version, payload
		FROM public.outbox_events WHERE aggregate_id = $1 AND name = 'shipment.cancelled'`, deliveryID).Scan(
		&actorType, &actorID, &key, &aggregateType, &fromVersion, &toVersion, &rawPayload); err != nil {
		t.Fatalf("read the outbox row: %v", err)
	}
	if actorType != "system" || actorID != "ride-service" || aggregateType != "shipment" || len(key) > 64 ||
		fromVersion == nil || *fromVersion != 1 || toVersion != 2 {
		t.Fatalf("envelope = actor %s/%s subject %s key %q versions %v→%d", actorType, actorID, aggregateType, key, fromVersion, toVersion)
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if payload["deliveryId"] != deliveryID || payload["marketplaceAwardId"] != awardID || payload["reason"] != "driver_offline" ||
		payload["senderId"] != sender.UserID.String() || payload["driverId"] != driver.UserID.String() || payload["fromState"] != "courier_assigned" {
		t.Fatalf("payload = %v", payload)
	}

	// The replay: the same answer, nothing written again.
	replay := postCancel(h, cancelBody(awardID, deliveryID, 3, "driver_offline"))
	if replay.Code != http.StatusOK {
		t.Fatalf("replay: status = %d, body = %s", replay.Code, replay.Body.String())
	}
	var again cancellationAnswer
	decode(t, replay, &again)
	if again.Data.ID != deliveryID || again.Data.Status != "CANCELLED" || again.Data.CancelledAt == nil ||
		*again.Data.CancelledAt == "" {
		t.Fatalf("replay answer = %+v", again.Data)
	}
	if after := readDeliveryRows(t, h, deliveryID); after != rows {
		t.Fatalf("a replay wrote again: before %+v, after %+v", rows, after)
	}

	// The driver can no longer prove a pickup on a cancelled delivery.
	requireCode(t, h.RequestUpload(deliveryID, driver, testutil.DeclarationFor("pickup", "image/png", testutil.TestImage("image/png", 5))),
		http.StatusConflict, "STATE_CONFLICT")
}

// TestMarketplaceCancelRefusals: every refusal the contract names, and none
// of them changes anything.
func TestMarketplaceCancelRefusals(t *testing.T) {
	h := testutil.NewHarness(t)
	awardID, deliveryID, _, _ := assignedDelivery(t, h)

	requireCode(t, postCancel(h, cancelBody(uuid.New().String(), deliveryID, 3, "driver_offline")), http.StatusNotFound, "DELIVERY_NOT_FOUND")
	requireCode(t, postCancel(h, cancelBody(awardID, uuid.New().String(), 3, "driver_offline")), http.StatusConflict, "AWARD_REPLAY_MISMATCH")
	// A stale (or any other) fencing token is not the award claim's.
	requireCode(t, postCancel(h, cancelBody(awardID, deliveryID, 2, "driver_offline")), http.StatusConflict, "AWARD_REPLAY_MISMATCH")
	requireCode(t, postCancel(h, cancelBody(awardID, deliveryID, 4, "driver_offline")), http.StatusConflict, "AWARD_REPLAY_MISMATCH")

	missingToken := cancelBody(awardID, deliveryID, 3, "driver_offline")
	delete(missingToken, "fencingToken")
	requireCode(t, postCancel(h, missingToken), http.StatusBadRequest, "VALIDATION_ERROR")
	requireCode(t, postCancel(h, cancelBody(awardID, "not-a-uuid", 3, "driver_offline")), http.StatusBadRequest, "VALIDATION_ERROR")
	requireCode(t, postCancel(h, cancelBody(awardID, deliveryID, -1, "driver_offline")), http.StatusBadRequest, "VALIDATION_ERROR")
	requireCode(t, postCancel(h, cancelBody(awardID, deliveryID, 3, "  ")), http.StatusBadRequest, "VALIDATION_ERROR")
	requireCode(t, postCancel(h, cancelBody("", deliveryID, 3, "driver_offline")), http.StatusBadRequest, "VALIDATION_ERROR")
	requireCode(t, postCancel(h, "not an object"), http.StatusBadRequest, "INVALID_JSON")

	// ServiceAuth: no key, or the wrong one.
	requireCode(t, postCancelWithKey(h, cancelBody(awardID, deliveryID, 3, "driver_offline"), ""), http.StatusForbidden, "FORBIDDEN")
	requireCode(t, postCancelWithKey(h, cancelBody(awardID, deliveryID, 3, "driver_offline"), h.ServiceKey()+"x"), http.StatusForbidden, "FORBIDDEN")

	rows := readDeliveryRows(t, h, deliveryID)
	if rows.custodyState != "courier_assigned" || rows.custodyVersion != 1 || rows.status != "PENDING" || rows.cancelEvents != 0 || rows.cancelAudits != 0 {
		t.Fatalf("a refused cancellation changed something: %+v", rows)
	}
}

// TestMarketplaceCancelNeverTakesBackAPickedUpParcel: once the driver has
// proved the pickup the parcel is in their hands, so the delivery is not
// silently cancelled — 409 DELIVERY_NOT_CANCELLABLE naming the custody state,
// which ride-service records as refused and alarms for ops.
func TestMarketplaceCancelNeverTakesBackAPickedUpParcel(t *testing.T) {
	h := testutil.NewHarness(t)
	awardID, deliveryID, _, driver := assignedDelivery(t, h)
	h.ProveStep(deliveryID, driver, "pickup", "/pickup-proof", 21)

	rec := postCancel(h, cancelBody(awardID, deliveryID, 3, "window_missed"))
	requireCode(t, rec, http.StatusConflict, "DELIVERY_NOT_CANCELLABLE")
	var refused struct {
		Error struct {
			Message string            `json:"message"`
			Details map[string]string `json:"details"`
		} `json:"error"`
	}
	decode(t, rec, &refused)
	if refused.Error.Details["custodyState"] != "in_transit" || refused.Error.Message == "" {
		t.Fatalf("the refusal must name the custody state: %+v", refused.Error)
	}
	rows := readDeliveryRows(t, h, deliveryID)
	if rows.custodyState != "in_transit" || rows.status != "PENDING" || rows.cancelEvents != 0 || rows.cancelAudits != 0 {
		t.Fatalf("a refused cancellation changed the delivery: %+v", rows)
	}
}

// TestMarketplaceCancelRacingPickupHasOneWinner: cancellations and the
// driver's pickup proof racing on the same custody row resolve to exactly
// one outcome — never a cancelled delivery with a recorded pickup, never two
// cancellations.
func TestMarketplaceCancelRacingPickupHasOneWinner(t *testing.T) {
	h := testutil.NewHarness(t)
	awardID, deliveryID, _, driver := assignedDelivery(t, h)
	uploadID := h.UploadProof(deliveryID, driver, "pickup", testutil.TestImage("image/png", 31))

	const cancels = 4
	var wg sync.WaitGroup
	cancelCodes := make([]string, cancels)
	var pickupCode int
	wg.Add(cancels + 1)
	for i := 0; i < cancels; i++ {
		go func(i int) {
			defer wg.Done()
			rec := postCancel(h, cancelBody(awardID, deliveryID, 3, "passenger_declined"))
			var env apiEnvelope
			_ = json.Unmarshal(rec.Body.Bytes(), &env)
			cancelCodes[i] = http.StatusText(rec.Code)
			if env.Error != nil {
				cancelCodes[i] += " " + env.Error.Code
			}
		}(i)
	}
	go func() {
		defer wg.Done()
		pickupCode = h.AttachProof(deliveryID, "/pickup-proof", driver, uploadID).Code
	}()
	wg.Wait()

	rows := readDeliveryRows(t, h, deliveryID)
	var proofs int
	if err := h.Pool.QueryRow(context.Background(), `SELECT count(*) FROM delivery_proofs WHERE delivery_id = $1`, deliveryID).Scan(&proofs); err != nil {
		t.Fatalf("proof count: %v", err)
	}
	switch rows.custodyState {
	case "cancelled":
		for _, code := range cancelCodes {
			if code != "OK" {
				t.Fatalf("the cancellation won, so every cancel answers 200 (first or replay): %v", cancelCodes)
			}
		}
		if pickupCode == http.StatusCreated || proofs != 0 || rows.cancelEvents != 1 || rows.cancelAudits != 1 {
			t.Fatalf("cancelled, yet pickup %d proofs %d events %d audits %d", pickupCode, proofs, rows.cancelEvents, rows.cancelAudits)
		}
	case "in_transit":
		for _, code := range cancelCodes {
			if code != "Conflict DELIVERY_NOT_CANCELLABLE" {
				t.Fatalf("the pickup won, so every cancel is refused: %v", cancelCodes)
			}
		}
		if pickupCode != http.StatusCreated || proofs != 1 || rows.cancelEvents != 0 || rows.cancelAudits != 0 {
			t.Fatalf("picked up, yet pickup %d proofs %d events %d audits %d", pickupCode, proofs, rows.cancelEvents, rows.cancelAudits)
		}
	default:
		t.Fatalf("unexpected custody state after the race: %+v", rows)
	}
}

// TestServiceCallsAreNeverThrottledByTheClientLimiter: ride-service's
// hand-offs all arrive from one pod address with no forwarding header. The
// old LimitByIP(100/min) put every one of them — platform-wide — in that
// address's bucket; a valid service call is now never counted, while a
// forged key from the same address is.
func TestServiceCallsAreNeverThrottledByTheClientLimiter(t *testing.T) {
	h := testutil.NewHarness(t)
	const calls = 150
	for i := 0; i < calls; i++ {
		rec := postCancel(h, cancelBody(uuid.New().String(), uuid.New().String(), 1, "driver_offline"))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("service call %d: status = %d (%s), want 404 DELIVERY_NOT_FOUND — never 429", i, rec.Code, rec.Body.String())
		}
	}
	refused := 0
	for i := 0; i < 101; i++ {
		rec := postCancelWithKey(h, cancelBody(uuid.New().String(), uuid.New().String(), 1, "x"), "forged-"+h.ServiceKey())
		switch rec.Code {
		case http.StatusForbidden:
		case http.StatusTooManyRequests:
			refused++
		default:
			t.Fatalf("forged key: status %d", rec.Code)
		}
	}
	if refused != 1 {
		t.Fatalf("a forged key must be counted per client (100 a minute): %d refused, want 1", refused)
	}
}
