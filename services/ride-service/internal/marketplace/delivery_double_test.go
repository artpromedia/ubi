package marketplace_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// deliveryDouble answers delivery-service's POST
// /api/v1/webhooks/marketplace-assign exactly as documented in
// services/delivery-service/docs/MARKETPLACE-DELIVERY-ENABLEMENT.md §4a and
// implemented by services/delivery-service/internal/handlers/marketplace.go:
// ServiceAuth on X-Service-Key (403 FORBIDDEN), 503 SERVICE_KEY_NOT_CONFIGURED
// for an empty or committed-default key, 400 VALIDATION_ERROR on the same
// field checks, 422 SENDER_PROFILE_NOT_FOUND for a requester with no rider
// profile, idempotency on awardId (200 replay with the same body, 409
// AWARD_REPLAY_MISMATCH for different parties), 409 ASSIGN_IN_PROGRESS while
// another call holds the award, 201 on creation — all in the service's
// {success, data | error{code, message}} envelope.
//
// (The real router cannot be mounted in-process from this module: it lives
// under services/delivery-service/internal, which Go forbids importing from
// another module tree.)
type deliveryDouble struct {
	t   *testing.T
	srv *httptest.Server
	key string

	mu sync.Mutex
	// senders are the requester user ids that have a rider profile.
	senders map[string]bool
	// deliveries is the store, by award id.
	deliveries map[string]map[string]any
	// bodies are every decoded request, in order.
	bodies []map[string]any
	calls  int
	// created counts deliveries actually created (201s).
	created int

	// Injected behaviour, consumed call by call.
	// inProgress answers 409 ASSIGN_IN_PROGRESS for this many calls.
	inProgress int
	// serverErrors answers 500 DATABASE_ERROR for this many calls.
	serverErrors int
	// dropAfterCommit creates (or replays) the delivery, then drops the
	// connection without an answer for this many calls: the lost response.
	dropAfterCommit int

	// Queued-delivery cancellation (ride-service's producer contract for
	// POST /api/v1/webhooks/marketplace-cancel, delivery_cancel.go).
	// delivery-service does not serve it yet: until cancelDeployed, the route
	// answers chi's plain-text 404 exactly like the real router would.
	cancelDeployed bool
	cancelCalls    int
	cancelBodies   []map[string]any
	// cancelled counts deliveries actually moved to CANCELLED.
	cancelled int
}

// deployCancel makes the double serve marketplace-cancel.
func (d *deliveryDouble) deployCancel() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.cancelDeployed = true
}

func (d *deliveryDouble) cancelSnapshot() (calls, cancelled int, bodies []map[string]any) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.cancelCalls, d.cancelled, append([]map[string]any(nil), d.cancelBodies...)
}

// cancel answers the marketplace-cancel contract: idempotent on the award
// (a replay of an already-cancelled delivery is 200), 404
// DELIVERY_NOT_FOUND for an award with no delivery, 409
// AWARD_REPLAY_MISMATCH for another delivery id, 409
// DELIVERY_NOT_CANCELLABLE once custody moved past assignment.
func (d *deliveryDouble) cancel(w http.ResponseWriter, r *http.Request) {
	d.cancelCalls++
	if !d.cancelDeployed {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("404 page not found\n"))
		return
	}
	if d.key == "" || r.Header.Get("X-Service-Key") != d.key {
		d.respondError(w, http.StatusForbidden, "FORBIDDEN", "Invalid service key")
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		d.respondError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid request body")
		return
	}
	d.cancelBodies = append(d.cancelBodies, body)
	awardID, _ := body["awardId"].(string)
	deliveryID, _ := body["deliveryId"].(string)
	existing, ok := d.deliveries[awardID]
	if !ok {
		d.respondError(w, http.StatusNotFound, "DELIVERY_NOT_FOUND", "No delivery for this award")
		return
	}
	if existing["id"] != deliveryID {
		d.respondError(w, http.StatusConflict, "AWARD_REPLAY_MISMATCH", "This award's delivery is another one")
		return
	}
	switch existing["status"] {
	case "CANCELLED":
	case "DRIVER_ASSIGNED":
		existing["status"] = "CANCELLED"
		d.cancelled++
	default:
		d.respondError(w, http.StatusConflict, "DELIVERY_NOT_CANCELLABLE", "Custody has moved; the delivery cannot be cancelled")
		return
	}
	d.respond(w, http.StatusOK, map[string]any{"id": existing["id"], "status": existing["status"], "marketplaceAwardId": awardID})
}

// newDeliveryDouble starts a double configured with `key` as its
// INTERNAL_SERVICE_KEY.
func newDeliveryDouble(t *testing.T, key string) *deliveryDouble {
	t.Helper()
	d := &deliveryDouble{t: t, key: key, senders: map[string]bool{}, deliveries: map[string]map[string]any{}}
	d.srv = httptest.NewServer(http.HandlerFunc(d.serve))
	t.Cleanup(d.srv.Close)
	return d
}

func (d *deliveryDouble) url() string { return d.srv.URL }

// withSender registers a requester user id as having a rider profile.
func (d *deliveryDouble) withSender(userID uuid.UUID) *deliveryDouble {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.senders[userID.String()] = true
	return d
}

func (d *deliveryDouble) respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
}

func (d *deliveryDouble) respondError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "error": map[string]any{"code": code, "message": message}})
}

func (d *deliveryDouble) serve(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if r.Method == http.MethodPost && r.URL.Path == "/api/v1/webhooks/marketplace-cancel" {
		d.cancel(w, r)
		return
	}
	if r.Method != http.MethodPost || r.URL.Path != "/api/v1/webhooks/marketplace-assign" {
		d.respondError(w, http.StatusNotFound, "NOT_FOUND", "no such route")
		return
	}
	d.calls++
	// ServiceAuth (middleware/auth.go).
	if d.key == "" || r.Header.Get("X-Service-Key") != d.key {
		d.respondError(w, http.StatusForbidden, "FORBIDDEN", "Invalid service key")
		return
	}
	// marketplaceAssignKeyUsable.
	if d.key == "internal-key" {
		d.respondError(w, http.StatusServiceUnavailable, "SERVICE_KEY_NOT_CONFIGURED",
			"Marketplace assignment is disabled: INTERNAL_SERVICE_KEY must be set to a non-default value")
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		d.respondError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid request body")
		return
	}
	d.bodies = append(d.bodies, body)
	if problems := d.validate(body); len(problems) > 0 {
		d.respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid marketplace assignment payload")
		return
	}
	awardID := body["awardId"].(string)
	existing, seen := d.deliveries[awardID]
	if !seen && d.inProgress > 0 {
		d.inProgress--
		d.respondError(w, http.StatusConflict, "ASSIGN_IN_PROGRESS", "This award is already being processed; retry shortly")
		return
	}
	if d.serverErrors > 0 {
		d.serverErrors--
		d.respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to create delivery")
		return
	}
	status := http.StatusOK
	if seen {
		if existing["customerId"] != body["customerId"] || existing["driverId"] != body["driverId"] {
			d.respondError(w, http.StatusConflict, "AWARD_REPLAY_MISMATCH",
				"This award already created a delivery for a different requester or driver")
			return
		}
	} else {
		if !d.senders[body["customerId"].(string)] {
			d.respondError(w, http.StatusUnprocessableEntity, "SENDER_PROFILE_NOT_FOUND",
				"The requester has no rider profile; a marketplace delivery's sender must be a rider")
			return
		}
		existing = map[string]any{
			"id":                 uuid.NewString(),
			"trackingNumber":     "UBI" + uuid.NewString()[:8],
			"status":             "DRIVER_ASSIGNED",
			"driverId":           body["driverId"],
			"customerId":         body["customerId"],
			"senderProfileId":    uuid.NewString(),
			"marketplaceAwardId": awardID,
			"agreedFareMinor":    body["fareMinor"],
			"currency":           body["currency"],
			"createdAt":          time.Now().UTC().Format(time.RFC3339),
		}
		d.deliveries[awardID] = existing
		d.created++
		status = http.StatusCreated
	}
	if d.dropAfterCommit > 0 {
		d.dropAfterCommit--
		// The delivery is committed; the caller never hears so.
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			d.t.Error("the double cannot drop a connection")
			return
		}
		conn, _, err := hijacker.Hijack()
		if err == nil {
			_ = conn.Close()
		}
		return
	}
	d.respond(w, status, existing)
}

// validate is validateMarketplaceAssign's field checks.
func (d *deliveryDouble) validate(body map[string]any) []string {
	var problems []string
	str := func(key string) string { value, _ := body[key].(string); return value }
	num := func(key string) float64 { value, _ := body[key].(float64); return value }
	if str("awardId") == "" {
		problems = append(problems, "awardId")
	}
	if str("requestId") == "" {
		problems = append(problems, "requestId")
	}
	if _, err := uuid.Parse(str("driverId")); err != nil {
		problems = append(problems, "driverId")
	}
	if _, err := uuid.Parse(str("customerId")); err != nil {
		problems = append(problems, "customerId")
	}
	if str("driverId") != "" && str("driverId") == str("customerId") {
		problems = append(problems, "self-delivery")
	}
	if num("fareMinor") <= 0 || num("fareMinor") != float64(int64(num("fareMinor"))) {
		problems = append(problems, "fareMinor")
	}
	switch str("currency") {
	case "NGN", "KES", "ZAR", "GHS", "RWF", "ETB", "USD":
	default:
		problems = append(problems, "currency")
	}
	for _, key := range []string{"pickup", "dropoff"} {
		place, _ := body[key].(map[string]any)
		lat, _ := place["latitude"].(float64)
		lng, _ := place["longitude"].(float64)
		if lat == 0 && lng == 0 {
			problems = append(problems, key)
		}
	}
	if token, ok := body["fencingToken"].(float64); !ok || token < 0 {
		problems = append(problems, "fencingToken")
	}
	return problems
}

func (d *deliveryDouble) snapshot() (calls, created int, bodies []map[string]any) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.calls, d.created, append([]map[string]any(nil), d.bodies...)
}

func (d *deliveryDouble) deliveryFor(awardID uuid.UUID) (map[string]any, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delivery, ok := d.deliveries[awardID.String()]
	return delivery, ok
}

func (d *deliveryDouble) inject(inProgress, serverErrors, dropAfterCommit int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.inProgress, d.serverErrors, d.dropAfterCommit = inProgress, serverErrors, dropAfterCommit
}
