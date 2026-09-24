package handlers_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/testutil"
)

// The marketplace award hand-off (POST /api/v1/webhooks/marketplace-assign)
// against the REAL Prisma schema (P17, recheck R02): the award carries the
// requester's USER id, deliveries.sender_id is a foreign key to riders.id,
// and the adapter must write the rider PROFILE — or refuse.

func assignBody(awardID, customerID, driverID string) map[string]interface{} {
	return map[string]interface{}{
		"awardId":      awardID,
		"requestId":    "mpr_" + awardID,
		"driverId":     driverID,
		"customerId":   customerID,
		"fareMinor":    125000,
		"currency":     "NGN",
		"fencingToken": 3,
		"pickup":       map[string]interface{}{"latitude": 6.4281, "longitude": 3.4219, "address": "Victoria Island"},
		"dropoff":      map[string]interface{}{"latitude": 6.4579, "longitude": 3.5856, "address": "Lekki"},
		"packageDetails": map[string]interface{}{
			"description": "Documents", "size": "SMALL", "weight": 1.2, "requiresPod": true,
		},
	}
}

func postAssign(h *testutil.Harness, body map[string]interface{}) *httptest.ResponseRecorder {
	r := req(http.MethodPost, "/api/v1/webhooks/marketplace-assign", body)
	r.Header.Set("X-Service-Key", h.ServiceKey())
	rec := httptest.NewRecorder()
	h.Router.ServeHTTP(rec, r)
	return rec
}

type assignSummary struct {
	Data struct {
		ID              string `json:"id"`
		CustomerID      string `json:"customerId"`
		SenderProfileID string `json:"senderProfileId"`
		DriverID        string `json:"driverId"`
		AgreedFareMinor int64  `json:"agreedFareMinor"`
	} `json:"data"`
}

func cleanupAward(t *testing.T, h *testutil.Harness, awardID string) {
	t.Cleanup(func() {
		_, _ = h.Pool.Exec(context.Background(), `DELETE FROM deliveries WHERE marketplace_metadata->>'marketplaceAwardId' = $1`, awardID)
	})
}

// TestMarketplaceAssignWritesTheSenderRiderProfile: the delivery's sender_id
// is the requester's rider profile, the custody sender is the requester's
// user id, and both commit together — then the sender (by user id) can use
// the custody surface.
func TestMarketplaceAssignWritesTheSenderRiderProfile(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	sender := testutil.Sender()
	driver := testutil.Driver()
	h.SeedUser(ctx, sender.UserID.String())
	riderID := h.SeedRiderProfile(ctx, sender.UserID.String())
	awardID := "awd_" + uuid.New().String()[:12]
	cleanupAward(t, h, awardID)

	rec := postAssign(h, assignBody(awardID, sender.UserID.String(), driver.UserID.String()))
	if rec.Code != http.StatusCreated {
		t.Fatalf("marketplace-assign: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var created assignSummary
	decode(t, rec, &created)
	if created.Data.CustomerID != sender.UserID.String() || created.Data.SenderProfileID != riderID {
		t.Fatalf("summary identities = customer %s / profile %s, want %s / %s",
			created.Data.CustomerID, created.Data.SenderProfileID, sender.UserID, riderID)
	}

	var senderID, custodySender, custodyDriver, state string
	var events int
	if err := h.Pool.QueryRow(ctx, `
		SELECT d.sender_id::text, c.sender_id::text, c.driver_id::text, c.state,
			(SELECT count(*) FROM custody_events e WHERE e.custody_id = c.id)
		FROM deliveries d JOIN delivery_custody c ON c.delivery_id = d.id
		WHERE d.id = $1`, created.Data.ID).Scan(&senderID, &custodySender, &custodyDriver, &state, &events); err != nil {
		t.Fatalf("read the delivery and its custody: %v", err)
	}
	if senderID != riderID {
		t.Fatalf("deliveries.sender_id = %s, want the rider profile %s (not the user id %s)", senderID, riderID, sender.UserID)
	}
	if custodySender != sender.UserID.String() || custodyDriver != driver.UserID.String() || state != "courier_assigned" || events != 1 {
		t.Fatalf("custody = sender %s driver %s state %s events %d", custodySender, custodyDriver, state, events)
	}

	// The access matrix keys on the gateway user id: the sender reads the
	// timeline, the driver can request a pickup upload.
	if rec := h.Do(req(http.MethodGet, custodyPath(created.Data.ID, "/"), nil), sender); rec.Code != http.StatusOK {
		t.Fatalf("sender timeline: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if rec := h.RequestUpload(created.Data.ID, driver, testutil.DeclarationFor("pickup", "image/png", testutil.TestImage("image/png", 1))); rec.Code != http.StatusCreated {
		t.Fatalf("driver upload request: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	// Replay: the same delivery, same identities; a replay naming another
	// driver is a conflict, never someone else's delivery.
	replay := postAssign(h, assignBody(awardID, sender.UserID.String(), driver.UserID.String()))
	if replay.Code != http.StatusOK {
		t.Fatalf("replay: status = %d, body = %s", replay.Code, replay.Body.String())
	}
	var replayed assignSummary
	decode(t, replay, &replayed)
	if replayed.Data.ID != created.Data.ID || replayed.Data.CustomerID != sender.UserID.String() || replayed.Data.SenderProfileID != riderID {
		t.Fatalf("replay answered %+v, want the original delivery %+v", replayed.Data, created.Data)
	}
	requireCode(t, postAssign(h, assignBody(awardID, sender.UserID.String(), testutil.Driver().UserID.String())), http.StatusConflict, "AWARD_REPLAY_MISMATCH")

	var count int
	if err := h.Pool.QueryRow(ctx, `SELECT count(*) FROM deliveries WHERE marketplace_metadata->>'marketplaceAwardId' = $1`, awardID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("deliveries for the award = %d (%v), want exactly 1", count, err)
	}
}

// TestMarketplaceAssignRefusesARequesterWithoutARiderProfile: no profile, no
// delivery — refused before anything is written, and retryable once the
// profile exists.
func TestMarketplaceAssignRefusesARequesterWithoutARiderProfile(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	sender := testutil.Sender()
	driver := testutil.Driver()
	h.SeedUser(ctx, sender.UserID.String())
	awardID := "awd_" + uuid.New().String()[:12]
	cleanupAward(t, h, awardID)

	requireCode(t, postAssign(h, assignBody(awardID, sender.UserID.String(), driver.UserID.String())), http.StatusUnprocessableEntity, "SENDER_PROFILE_NOT_FOUND")
	// An unknown user entirely is refused the same way.
	requireCode(t, postAssign(h, assignBody("awd_"+uuid.New().String()[:12], uuid.New().String(), driver.UserID.String())), http.StatusUnprocessableEntity, "SENDER_PROFILE_NOT_FOUND")

	var deliveries, custodies int
	if err := h.Pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM deliveries WHERE marketplace_metadata->>'marketplaceAwardId' = $1),
			(SELECT count(*) FROM delivery_custody WHERE sender_id = $2)`, awardID, sender.UserID.String()).Scan(&deliveries, &custodies); err != nil {
		t.Fatalf("count: %v", err)
	}
	if deliveries != 0 || custodies != 0 {
		t.Fatalf("a refused hand-off wrote deliveries=%d custodies=%d", deliveries, custodies)
	}

	// The refusal released the award lock: once the profile exists the same
	// award goes through.
	riderID := h.SeedRiderProfile(ctx, sender.UserID.String())
	rec := postAssign(h, assignBody(awardID, sender.UserID.String(), driver.UserID.String()))
	if rec.Code != http.StatusCreated {
		t.Fatalf("after the profile exists: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var created assignSummary
	decode(t, rec, &created)
	if created.Data.SenderProfileID != riderID {
		t.Fatalf("sender profile = %s, want %s", created.Data.SenderProfileID, riderID)
	}
}

// TestSenderColumnRefusesARawUserID proves the schema under test is the real
// one: the very insert the pre-P17 adapter performed — the award's user id
// straight into deliveries.sender_id — violates the foreign key.
func TestSenderColumnRefusesARawUserID(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	sender := testutil.Sender()
	h.SeedUser(ctx, sender.UserID.String())
	h.SeedRiderProfile(ctx, sender.UserID.String())

	_, err := h.Pool.Exec(ctx, `
		INSERT INTO deliveries (id, tracking_number, sender_id, status,
			pickup_address, pickup_latitude, pickup_longitude, pickup_contact, pickup_phone,
			dropoff_address, dropoff_latitude, dropoff_longitude, dropoff_contact, dropoff_phone,
			package_size, package_description, price, currency, payment_method, payment_status, created_at, updated_at)
		VALUES ($1, $2, $3, 'PENDING', 'a', 6.4, 3.4, '', '', 'b', 6.5, 3.5, '', '',
			'SMALL', 'x', 10.00, 'NGN', 'WALLET', 'PENDING', now(), now())`,
		uuid.New().String(), "TRK"+uuid.New().String()[:8], sender.UserID.String())
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23503" || pgErr.ConstraintName != "deliveries_sender_id_fkey" {
		t.Fatalf("inserting a user id as sender_id must violate deliveries_sender_id_fkey, got %v", err)
	}
}
