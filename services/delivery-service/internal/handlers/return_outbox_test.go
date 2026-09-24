package handlers_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/testutil"
)

// shipment.return_proposed through the transactional outbox: notification-
// service (services/notification-service/src/marketplace/specs.ts) consumes
// `event:shipment.return_proposed` and pushes the SENDER — by the user id in
// `senderId` — to answer before `consentExpiresAt`, "Approve a return fee"
// when `chargeStatus` is authorization_required.

type outboxRow struct {
	Name        string
	Subject     string
	ActorType   string
	ActorID     string
	Key         string
	FromVersion *int
	ToVersion   int
	Payload     map[string]interface{}
}

func returnProposedRows(t *testing.T, h *testutil.Harness, deliveryID string) []outboxRow {
	t.Helper()
	rows, err := h.Pool.Query(context.Background(), `
		SELECT name, aggregate_type, actor_type, actor_id, idempotency_key, from_version, to_version, payload
		FROM public.outbox_events
		WHERE aggregate_id = $1 AND name = 'shipment.return_proposed'`, deliveryID)
	if err != nil {
		t.Fatalf("read the outbox: %v", err)
	}
	defer rows.Close()
	var out []outboxRow
	for rows.Next() {
		var row outboxRow
		var raw []byte
		if err := rows.Scan(&row.Name, &row.Subject, &row.ActorType, &row.ActorID, &row.Key, &row.FromVersion, &row.ToVersion, &raw); err != nil {
			t.Fatalf("scan the outbox: %v", err)
		}
		if err := json.Unmarshal(raw, &row.Payload); err != nil {
			t.Fatalf("payload: %v", err)
		}
		out = append(out, row)
	}
	return out
}

type proposal struct {
	Data struct {
		ReturnID         string    `json:"returnId"`
		ChargeStatus     string    `json:"chargeStatus"`
		ConsentExpiresAt time.Time `json:"consentExpiresAt"`
	} `json:"data"`
}

// TestReturnProposalIsAnnouncedThroughTheOutbox: a fee-free return proposed
// by the driver writes exactly one shipment.return_proposed row, in the same
// transaction, addressed to the sender's user id — and never carries the
// free-text reason.
func TestReturnProposalIsAnnouncedThroughTheOutbox(t *testing.T) {
	h := testutil.NewHarness(t)
	deliveryID, actors := h.SeedDelivery(context.Background(), testutil.Actor{}, testutil.Actor{}, "recipient_unreachable")

	reason := "Recipient at +2348000000000 did not answer"
	rec := h.Do(req(http.MethodPost, custodyPath(deliveryID, "/return/propose"),
		map[string]interface{}{"reason": reason, "feeMinor": 0}), actors.Driver)
	if rec.Code != http.StatusCreated {
		t.Fatalf("propose: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var proposed proposal
	decode(t, rec, &proposed)

	events := returnProposedRows(t, h, deliveryID)
	if len(events) != 1 {
		t.Fatalf("outbox rows = %d, want exactly 1", len(events))
	}
	event := events[0]
	if event.Subject != "shipment" || event.ActorType != "driver" || event.ActorID != actors.Driver.UserID.String() ||
		event.Key != "shipment.return_proposed:"+proposed.Data.ReturnID || len(event.Key) > 64 ||
		event.FromVersion == nil || *event.FromVersion != 1 || event.ToVersion != 2 {
		t.Fatalf("envelope = %+v", event)
	}
	payload := event.Payload
	if payload["deliveryId"] != deliveryID || payload["returnId"] != proposed.Data.ReturnID ||
		payload["senderId"] != actors.Sender.UserID.String() || payload["driverId"] != actors.Driver.UserID.String() ||
		payload["chargeStatus"] != "not_required" || payload["feeMinor"] != float64(0) || payload["currency"] != nil {
		t.Fatalf("payload = %v", payload)
	}
	expires, err := time.Parse(time.RFC3339, payload["consentExpiresAt"].(string))
	if err != nil || !expires.Equal(proposed.Data.ConsentExpiresAt.Truncate(time.Second)) {
		t.Fatalf("consentExpiresAt = %v (%v), want the proposal's %s", payload["consentExpiresAt"], err, proposed.Data.ConsentExpiresAt)
	}
	raw, _ := json.Marshal(payload)
	if strings.Contains(string(raw), "2348000000000") || strings.Contains(string(raw), "did not answer") {
		t.Fatalf("the free-text reason leaked into the event: %s", raw)
	}
}

// TestChargedReturnProposalAsksTheSenderToApproveTheFee: with charged
// returns on, the event says the fee needs the sender's authorization — the
// state notification-service turns into "Approve a return fee" — and a
// proposal that is refused writes nothing to the outbox.
func TestChargedReturnProposalAsksTheSenderToApproveTheFee(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{ChargedReturns: true})
	deliveryID, actors := chargedReturn(t, h, 100000)

	events := returnProposedRows(t, h, deliveryID)
	if len(events) != 1 {
		t.Fatalf("outbox rows = %d, want 1", len(events))
	}
	payload := events[0].Payload
	if payload["chargeStatus"] != "authorization_required" || payload["feeMinor"] != float64(returnFee) ||
		payload["currency"] != "NGN" || payload["senderId"] != actors.Sender.UserID.String() {
		t.Fatalf("payload = %v", payload)
	}

	// Refused before anything is written: a second proposal (custody is no
	// longer recipient_unreachable) and, elsewhere, a fee while charged
	// returns are off.
	requireResult(t, "a second proposal", proposeFee(h, deliveryID, actors.Driver, 0, ""), http.StatusConflict, "STATE_CONFLICT")
	if n := len(returnProposedRows(t, h, deliveryID)); n != 1 {
		t.Fatalf("a refused proposal wrote an event: %d rows", n)
	}

	off := testutil.NewHarness(t)
	offDelivery, offActors := off.SeedDelivery(context.Background(), testutil.Actor{}, testutil.Actor{}, "recipient_unreachable")
	requireResult(t, "a fee with charged returns off", proposeFee(off, offDelivery, offActors.Driver, returnFee, "NGN"), http.StatusConflict, "CHARGED_RETURNS_NOT_OFFERED")
	if n := len(returnProposedRows(t, off, offDelivery)); n != 0 {
		t.Fatalf("a refused proposal wrote an event: %d rows", n)
	}
}
