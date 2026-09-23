package marketplace_test

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/handler"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// Book for another adult (A06 part B): payer/requester/passenger separation,
// the requester's attestation (and the minor refusal), and the passenger's
// scoped trip link — its reach, its expiry, its revocation, its rate limits,
// and the free decline before pickup.

const guestPhone = "+2348031234567"

// guestHarness is the marketplace harness with guest bookings switched on
// for its city (deny by default).
func guestHarness(t *testing.T) *testutil.Harness {
	t.Helper()
	return newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceGuestBookings, true))
}

func yes() *bool { v := true; return &v }
func no() *bool  { v := false; return &v }

// passengerBody is a passenger input with the attestation given.
func passengerBody(adult, consent *bool) map[string]any {
	body := map[string]any{"firstName": "Ada", "lastName": "Obi", "phone": guestPhone}
	if adult != nil {
		body["isAdult"] = *adult
	}
	if consent != nil {
		body["consentConfirmed"] = *consent
	}
	return body
}

// publishWithPassenger posts a ride request for the fixture route naming a
// passenger, answering the raw recorder.
func publishWithPassenger(t *testing.T, h *testutil.Harness, rider testutil.Actor, passenger map[string]any, key string) (*httptest.ResponseRecorder, int64) {
	t.Helper()
	quote := quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture())
	amount := moneyMinor(t, quote, "minimumFareMinor")
	if key == "" {
		key = idemKey()
	}
	return h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(amount),
		"paymentMethodId":    "wallet",
		"passenger":          passenger,
	}, move.IdempotencyHeader, key), amount
}

// guestTrip is one published guest request and the passenger's link.
type guestTrip struct {
	rider     testutil.Actor
	requestID string
	amount    int64
	view      map[string]any
	token     string
	tokenID   string
}

func bookGuest(t *testing.T, h *testutil.Harness, rider testutil.Actor) *guestTrip {
	t.Helper()
	recorder, amount := publishWithPassenger(t, h, rider, passengerBody(yes(), yes()), "")
	requireStatus(t, recorder, http.StatusCreated)
	g := &guestTrip{rider: rider, amount: amount, view: decode(t, recorder)}
	g.requestID = g.view["requestId"].(string)
	g.tokenID, g.token = latestToken(t, h, g.requestID)
	return g
}

// latestToken reads the request's newest link: its id from the store and the
// raw token from the trip_access.issued event notification-service reads —
// by OPENING its sealed envelope with the harness's delivery key, exactly as
// the consumer does (the payload carries no token in clear).
func latestToken(t *testing.T, h *testutil.Harness, requestID string) (string, string) {
	t.Helper()
	var id uuid.UUID
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT id FROM mp.trip_access_tokens WHERE request_id = $1 ORDER BY (revoked_at IS NULL) DESC, created_at DESC LIMIT 1`,
		uuid.MustParse(requestID)).Scan(&id); err != nil {
		t.Fatalf("no trip link for %s: %v", requestID, err)
	}
	payload := outboxPayload(t, h, "trip_access.issued", id.String())
	opened := openSealedDelivery(t, h, payload, id.String())
	if opened.Token == "" {
		t.Fatalf("the sealed delivery carries the link token: %v", payload)
	}
	return id.String(), opened.Token
}

// sealedDelivery is what a trip_access.issued envelope opens to.
type sealedDelivery struct {
	Phone     string `json:"phone"`
	Token     string `json:"token"`
	FirstName string `json:"firstName"`
}

// openSealedDelivery opens a trip_access.issued payload's `sealed` envelope
// the way notification-service does — an independent AES-256-GCM opener
// (crypto/aes + cipher.GCM), keyed by kid, AAD "ubi.trip_access.v1|"+tokenId
// — never through ride-service's own sealer.
func openSealedDelivery(t *testing.T, h *testutil.Harness, payload map[string]any, tokenID string) sealedDelivery {
	t.Helper()
	sealed, ok := payload["sealed"].(map[string]any)
	if !ok {
		t.Fatalf("the issued event carries a sealed envelope: %v", payload)
	}
	if sealed["v"] != float64(1) || sealed["alg"] != "A256GCM" || sealed["kid"] != h.TripAccessKid {
		t.Fatalf("the envelope names version, algorithm and the harness key: %v", sealed)
	}
	decode := func(field string) []byte {
		raw, err := base64.RawURLEncoding.DecodeString(sealed[field].(string))
		if err != nil {
			t.Fatalf("%s is not base64url without padding: %v", field, err)
		}
		return raw
	}
	iv, ct, tag := decode("iv"), decode("ct"), decode("tag")
	if len(iv) != 12 || len(tag) != 16 {
		t.Fatalf("a 12-byte IV and a 16-byte tag: %d / %d", len(iv), len(tag))
	}
	block, err := aes.NewCipher(h.TripAccessKey)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := gcm.Open(nil, iv, append(append([]byte{}, ct...), tag...), []byte("ubi.trip_access.v1|"+tokenID))
	if err != nil {
		t.Fatalf("the envelope opens under its token's AAD: %v", err)
	}
	var opened sealedDelivery
	if err := json.Unmarshal(plain, &opened); err != nil {
		t.Fatalf("the plaintext is a JSON object: %v", err)
	}
	return opened
}

// tripAccess calls a trip-link route with a token from a client address,
// through the real router and WITHOUT any gateway identity.
func tripAccess(t *testing.T, h *testutil.Harness, method, path, token, client string, headers ...string) *httptest.ResponseRecorder {
	t.Helper()
	var body *bytes.Reader
	if method == http.MethodPost {
		body = bytes.NewReader([]byte(`{}`))
	} else {
		body = bytes.NewReader(nil)
	}
	request := httptest.NewRequest(method, path, body)
	request.RemoteAddr = client + ":40000"
	if token != "" {
		request.Header.Set(handler.HeaderTripAccessToken, token)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		request.Header.Set(headers[i], headers[i+1])
	}
	recorder := httptest.NewRecorder()
	h.Router.ServeHTTP(recorder, request)
	return recorder
}

// clientAddr is a fresh documentation-range address per test, so the
// per-client limiter of one test never throttles another.
func clientAddr() string {
	buf := make([]byte, 2)
	_, _ = rand.Read(buf)
	return "198.51." + itoaByte(buf[0]) + "." + itoaByte(buf[1])
}

func itoaByte(b byte) string {
	raw, _ := json.Marshal(int(b))
	return string(raw)
}

func forgedToken() string {
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	return "uta_" + base64.RawURLEncoding.EncodeToString(buf)
}

func requireRefusalReason(t *testing.T, recorder *httptest.ResponseRecorder, status int, code domain.Code, reason string) {
	t.Helper()
	requireCode(t, recorder, status, code)
	details, _ := decode(t, recorder)["details"].(map[string]any)
	if details["reason"] != reason {
		t.Fatalf("refusal reason: got %v, want %s (%s)", details["reason"], reason, recorder.Body.String())
	}
}

// TestGuestBookingNeedsAttestationAndRefusesMinors: a requester may book a
// ride for a named adult only with an explicit attestation of the
// passenger's age and consent. A child travelling alone is refused with its
// own reason, missing attestation and consent are refused, a bad phone is
// refused — and none of it writes anything. With the flag off the passenger
// field is unavailable; deliveries cannot name a passenger.
func TestGuestBookingNeedsAttestationAndRefusesMinors(t *testing.T) {
	h := guestHarness(t)
	rider := h.Rider()

	missing, _ := publishWithPassenger(t, h, rider, passengerBody(nil, yes()), "")
	requireRefusalReason(t, missing, http.StatusUnprocessableEntity, domain.CodeValidationFailed, marketplace.ReasonAttestationRequired)
	minor, _ := publishWithPassenger(t, h, rider, passengerBody(no(), yes()), "")
	requireRefusalReason(t, minor, http.StatusUnprocessableEntity, domain.CodeValidationFailed, marketplace.ReasonUnaccompaniedMinor)
	if message := decode(t, minor)["message"].(string); !strings.Contains(message, "child travelling alone") {
		t.Fatalf("the minor refusal says why: %q", message)
	}
	noConsent, _ := publishWithPassenger(t, h, rider, passengerBody(yes(), no()), "")
	requireRefusalReason(t, noConsent, http.StatusUnprocessableEntity, domain.CodeValidationFailed, marketplace.ReasonPassengerConsentRequired)
	badPhone := passengerBody(yes(), yes())
	badPhone["phone"] = "08031234567"
	phone, _ := publishWithPassenger(t, h, rider, badPhone, "")
	requireCode(t, phone, http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.requests WHERE requester_id = $1`, rider.UserID); n != 0 {
		t.Fatalf("a refused guest booking writes nothing: %d requests", n)
	}

	// Deliveries cannot name a passenger.
	quote := h.Do(http.MethodGet, quotePath(t, "delivery", testutil.PickupFixture(), testutil.DropoffFixture(), nil), rider, nil)
	requireStatus(t, quote, http.StatusOK)
	delivery := h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
		"quoteId":            decode(t, quote)["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, decode(t, quote), "minimumFareMinor")),
		"paymentMethodId":    "wallet",
		"passenger":          passengerBody(yes(), yes()),
	}, move.IdempotencyHeader, idemKey())
	requireCode(t, delivery, http.StatusUnprocessableEntity, domain.CodeValidationFailed)

	// Deny by default: the same body in a city without the flag.
	off := newHarness(t)
	disabled, _ := publishWithPassenger(t, off, off.Rider(), passengerBody(yes(), yes()), "")
	requireCode(t, disabled, http.StatusNotFound, domain.CodeFeatureDisabled)
}

// TestGuestBookingSeparatesPayerRequesterAndPassenger: a valid booking
// publishes the request with the requester as payer, records the passenger
// with the attestation, and issues ONE trip link — handed to
// notification-service once, in the trip_access.issued event (not mp.*),
// stored only as its hash, and never in the requester's response. The
// requester's view carries the passenger on this request; no mp.* event
// carries the passenger's phone. The publish replays idempotently.
func TestGuestBookingSeparatesPayerRequesterAndPassenger(t *testing.T) {
	h := guestHarness(t)
	rider := h.Rider()
	key := idemKey()
	quote := quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture())
	publish := map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "minimumFareMinor")),
		"paymentMethodId":    "wallet",
		"passenger":          passengerBody(yes(), yes()),
	}
	recorder := h.Do(http.MethodPost, "/mp/requests", rider, publish, move.IdempotencyHeader, key)
	requireStatus(t, recorder, http.StatusCreated)
	view := decode(t, recorder)
	requestID := view["requestId"].(string)
	passenger := view["passenger"].(map[string]any)
	if passenger["firstName"] != "Ada" || passenger["lastName"] != "Obi" || passenger["phone"] != guestPhone ||
		passenger["payerRole"] != "requester" || passenger["accessStatus"] != marketplace.AccessStatusActive ||
		passenger["attestation"] == "" {
		t.Fatalf("the requester's view names the passenger and the payer: %v", passenger)
	}
	tokenID, token := latestToken(t, h, requestID)
	if strings.Contains(recorder.Body.String(), token) {
		t.Fatal("the raw link token never reaches the requester")
	}
	issued := outboxPayload(t, h, "trip_access.issued", tokenID)
	recipient := issued["recipient"].(map[string]any)
	sms := issued["smsCopy"].(string)
	if recipient["channel"] != "sms" || len(recipient) != 1 ||
		!strings.Contains(sms, "{link}") || !strings.HasPrefix(sms, "{firstName}") || !strings.Contains(sms, "No driver is confirmed yet") {
		t.Fatalf("the SMS hand-off is a template that never promises a driver: %v", issued)
	}
	opened := openSealedDelivery(t, h, issued, tokenID)
	if opened.Phone != guestPhone || opened.FirstName != "Ada" || opened.Token != token {
		t.Fatalf("the sealed envelope carries the phone, first name and token: %+v", opened)
	}
	if _, leaks := issued["requesterId"]; leaks {
		t.Fatalf("the passenger's SMS event carries no requester identity: %v", issued)
	}
	sum := sha256.Sum256([]byte(token))
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.trip_access_tokens WHERE token_hash = $1`, hex.EncodeToString(sum[:])); n != 1 {
		t.Fatalf("the token is stored as its SHA-256: %d", n)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.trip_access_tokens WHERE token_hash = $1`, token); n != 0 {
		t.Fatal("the raw token is never stored")
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM public.outbox_events WHERE name LIKE 'mp.%' AND payload::text LIKE '%' || $1 || '%'`, guestPhone); n != 0 {
		t.Fatalf("no mp.* event carries the passenger's phone: %d", n)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM public.audit_log WHERE action = 'mp.request.passenger_named' AND subject_id = $1`, requestID); n != 1 {
		t.Fatalf("the attestation is audited: %d", n)
	}

	// The same body under the same key replays the booking; a different
	// passenger under that key is refused — never a second booking or link.
	replay := h.Do(http.MethodPost, "/mp/requests", rider, publish, move.IdempotencyHeader, key)
	requireStatus(t, replay, http.StatusCreated)
	if decode(t, replay)["requestId"] != requestID || strings.Contains(replay.Body.String(), token) {
		t.Fatalf("the replay answers the original booking: %s", replay.Body.String())
	}
	other := passengerBody(yes(), yes())
	other["firstName"] = "Chidi"
	publish["passenger"] = other
	requireCode(t, h.Do(http.MethodPost, "/mp/requests", rider, publish, move.IdempotencyHeader, key),
		http.StatusConflict, domain.CodeIdempotencyKeyReuse)
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.trip_access_tokens WHERE request_id = $1`, uuid.MustParse(requestID)); n != 1 {
		t.Fatalf("one link per booking: %d", n)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.requests WHERE requester_id = $1`, rider.UserID); n != 1 {
		t.Fatalf("one booking: %d", n)
	}

	snapshot := h.Do(http.MethodGet, "/mp/requests/"+requestID, rider, nil)
	requireStatus(t, snapshot, http.StatusOK)
	if got := decode(t, snapshot)["request"].(map[string]any)["passenger"].(map[string]any); got["phone"] != guestPhone {
		t.Fatalf("the requester reads the passenger on this request: %v", got)
	}
}

// TestTripLinkReachesOnlyItsTrip: the passenger's link opens exactly its own
// trip — status, places, support — and nothing about the requester or the
// money; it needs no gateway identity and a gateway identity without it gets
// nothing. Forged, malformed and absent tokens are refused alike; a revoked
// link is refused while the reissued one works; an expired one is refused.
func TestTripLinkReachesOnlyItsTrip(t *testing.T) {
	h := guestHarness(t)
	client := clientAddr()
	first := bookGuest(t, h, h.Rider())
	second := bookGuest(t, h, h.Rider()) // another requester, the same passenger

	view := tripAccess(t, h, http.MethodGet, "/mp/trip-access", first.token, client)
	requireStatus(t, view, http.StatusOK)
	if view.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("a trip link's answer is never cached")
	}
	body := decode(t, view)
	wantRef := "UBI-" + strings.ToUpper(strings.ReplaceAll(first.requestID, "-", "")[:8])
	if body["status"] != marketplace.TripStatusFindingDriver || body["driver"] != nil ||
		body["support"].(map[string]any)["reference"] != wantRef ||
		body["passenger"].(map[string]any)["firstName"] != "Ada" ||
		body["actions"].(map[string]any)["canDecline"] != true {
		t.Fatalf("the link opens its own trip: %v", body)
	}
	raw := view.Body.String()
	for _, secret := range []string{first.rider.UserID.String(), first.requestID, second.requestID, guestPhone, "amountMinor", "fareMinor"} {
		if strings.Contains(raw, secret) {
			t.Fatalf("the passenger's view carries nothing beyond the trip (%q leaked): %s", secret, raw)
		}
	}
	other := tripAccess(t, h, http.MethodGet, "/mp/trip-access", second.token, client)
	requireStatus(t, other, http.StatusOK)
	if decode(t, other)["support"].(map[string]any)["reference"] == wantRef {
		t.Fatal("each link opens only its own trip")
	}

	requireRefusalReason(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", forgedToken(), client),
		http.StatusUnauthorized, domain.CodeUnauthorized, marketplace.TripAccessInvalid)
	requireRefusalReason(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", "uta_short", client),
		http.StatusUnauthorized, domain.CodeUnauthorized, marketplace.TripAccessInvalid)
	requireRefusalReason(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", "", client),
		http.StatusUnauthorized, domain.CodeUnauthorized, marketplace.TripAccessInvalid)
	// A gateway identity is not a trip link.
	withIdentity := tripAccess(t, h, http.MethodGet, "/mp/trip-access", "", client,
		handler.HeaderUserID, first.rider.UserID.String(), handler.HeaderUserRole, move.RoleRider)
	requireCode(t, withIdentity, http.StatusUnauthorized, domain.CodeUnauthorized)
	// A token sent in the URL is not read.
	requireCode(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access?token="+first.token, "", client),
		http.StatusUnauthorized, domain.CodeUnauthorized)

	// Revoked by the requester: refused; the reissued link works.
	requireCode(t, h.Do(http.MethodPost, "/mp/requests/"+first.requestID+"/passenger/access/revoke", h.Rider(), nil,
		move.IdempotencyHeader, idemKey()), http.StatusNotFound, domain.CodeNotFound)
	revoke := h.Do(http.MethodPost, "/mp/requests/"+first.requestID+"/passenger/access/revoke", first.rider, nil,
		move.IdempotencyHeader, idemKey())
	requireStatus(t, revoke, http.StatusOK)
	if decode(t, revoke)["accessStatus"] != marketplace.AccessStatusRevoked {
		t.Fatalf("the requester sees the link revoked: %s", revoke.Body.String())
	}
	requireRefusalReason(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", first.token, client),
		http.StatusUnauthorized, domain.CodeUnauthorized, marketplace.TripAccessRevoked)
	if outboxCount(t, h, "trip_access.revoked", first.tokenID) != 1 {
		t.Fatal("the revocation is published once")
	}
	reissue := h.Do(http.MethodPost, "/mp/requests/"+first.requestID+"/passenger/access/reissue", first.rider, nil,
		move.IdempotencyHeader, idemKey())
	requireStatus(t, reissue, http.StatusOK)
	_, fresh := latestToken(t, h, first.requestID)
	if fresh == first.token {
		t.Fatal("a reissue mints a new link")
	}
	requireStatus(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", fresh, client), http.StatusOK)
	requireRefusalReason(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", first.token, client),
		http.StatusUnauthorized, domain.CodeUnauthorized, marketplace.TripAccessRevoked)

	// Expired: past the link's lifetime.
	h.Clock.Advance(13 * time.Hour)
	requireRefusalReason(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", fresh, client),
		http.StatusUnauthorized, domain.CodeUnauthorized, marketplace.TripAccessExpired)
	requireRefusalReason(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", second.token, client),
		http.StatusUnauthorized, domain.CodeUnauthorized, marketplace.TripAccessExpired)
}

// TestTripLinkIsRateLimited: one token gets a bounded number of calls per
// minute, and one client a bounded number across tokens — so scanning with
// forged tokens stops at 429 before the database is asked.
func TestTripLinkIsRateLimited(t *testing.T) {
	h := guestHarness(t)
	g := bookGuest(t, h, h.Rider())

	perToken := clientAddr()
	for i := 0; i < 30; i++ {
		requireStatus(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", g.token, perToken), http.StatusOK)
	}
	requireCode(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", g.token, perToken), http.StatusTooManyRequests, domain.CodeRateLimited)
	// The limit is the token's: from another client it is still spent.
	requireCode(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", g.token, clientAddr()), http.StatusTooManyRequests, domain.CodeRateLimited)

	scanner := clientAddr()
	for i := 0; i < 60; i++ {
		requireCode(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", forgedToken(), scanner), http.StatusUnauthorized, domain.CodeUnauthorized)
	}
	requireCode(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", forgedToken(), scanner), http.StatusTooManyRequests, domain.CodeRateLimited)
}

// TestRequesterCannotReadAnotherTripOfThePassenger: two requesters book the
// same passenger. Each sees the passenger only on their own request; neither
// can read, revoke or reissue on the other's — there is no read of the
// passenger's trips at all.
func TestRequesterCannotReadAnotherTripOfThePassenger(t *testing.T) {
	h := guestHarness(t)
	a := bookGuest(t, h, h.Rider())
	b := bookGuest(t, h, h.Rider())

	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+b.requestID, a.rider, nil), http.StatusNotFound, domain.CodeNotFound)
	for _, op := range []string{"revoke", "reissue"} {
		requireCode(t, h.Do(http.MethodPost, "/mp/requests/"+b.requestID+"/passenger/access/"+op, a.rider, nil,
			move.IdempotencyHeader, idemKey()), http.StatusNotFound, domain.CodeNotFound)
	}
	own := h.Do(http.MethodGet, "/mp/requests/"+a.requestID, a.rider, nil)
	requireStatus(t, own, http.StatusOK)
	if strings.Contains(own.Body.String(), b.requestID) {
		t.Fatal("a requester's own trip names no other trip of the passenger")
	}
	// A requester who never booked a passenger has none to control.
	plain, _ := publishAt(t, h, a.rider, 0)
	requireCode(t, h.Do(http.MethodPost, "/mp/requests/"+plain["requestId"].(string)+"/passenger/access/revoke", a.rider, nil,
		move.IdempotencyHeader, idemKey()), http.StatusNotFound, domain.CodeNotFound)
	if _, present := plain["passenger"]; present {
		t.Fatal("a request the requester takes carries no passenger block")
	}
}

// TestPassengerDeclinesAnOpenRequestForFree: before any driver is chosen the
// passenger declines: the request closes (reason passenger_declined), every
// live offer is invalidated and its hold released, nothing is captured or
// funded, the requester is told, and the decline replays.
func TestPassengerDeclinesAnOpenRequestForFree(t *testing.T) {
	h := guestHarness(t)
	g := bookGuest(t, h, h.Rider())
	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PickupFixture())
	bid := fundedCurrentBid(t, h, driver, g.requestID, g.amount)
	reservation := bid["reservationId"].(string)

	client := clientAddr()
	requireCode(t, tripAccess(t, h, http.MethodPost, "/mp/trip-access/decline", g.token, client), http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	key := idemKey()
	declined := tripAccess(t, h, http.MethodPost, "/mp/trip-access/decline", g.token, client, move.IdempotencyHeader, key)
	requireStatus(t, declined, http.StatusOK)
	view := decode(t, declined)
	if view["status"] != marketplace.TripStatusDeclined || view["actions"].(map[string]any)["canDecline"] != false {
		t.Fatalf("the passenger sees their decline: %v", view)
	}
	if request := requestRow(t, h, g.requestID); request.State != machine.MpRequestCancelled || request.CloseReason != "passenger_declined" {
		t.Fatalf("the request closes on the decline: %s / %s", request.State, request.CloseReason)
	}
	if h.Wallet.ReleasesByReservation[reservation] != 1 || h.Wallet.CapturesByReservation[reservation] != 0 {
		t.Fatalf("the offer's hold is released, nothing captured: releases %d, captures %d",
			h.Wallet.ReleasesByReservation[reservation], h.Wallet.CapturesByReservation[reservation])
	}
	if h.Funding.Calls != 0 {
		t.Fatalf("the requester was never charged: %d funding calls", h.Funding.Calls)
	}
	declinedEvent := outboxPayload(t, h, "trip_access.declined", g.tokenID)
	if declinedEvent["requesterId"] != g.rider.UserID.String() || declinedEvent["feeMinor"] != float64(0) {
		t.Fatalf("the requester is told, at no fee: %v", declinedEvent)
	}
	replay := tripAccess(t, h, http.MethodPost, "/mp/trip-access/decline", g.token, client, move.IdempotencyHeader, key)
	requireStatus(t, replay, http.StatusOK)
	if replay.Body.String() != declined.Body.String() {
		t.Fatal("the decline replays byte for byte")
	}
	again := tripAccess(t, h, http.MethodPost, "/mp/trip-access/decline", g.token, client, move.IdempotencyHeader, idemKey())
	requireStatus(t, again, http.StatusOK)
	if outboxCount(t, h, "trip_access.declined", g.tokenID) != 1 || h.Wallet.ReleasesByReservation[reservation] != 1 {
		t.Fatal("a second decline moves nothing")
	}
	snapshot := h.Do(http.MethodGet, "/mp/requests/"+g.requestID, g.rider, nil)
	requireStatus(t, snapshot, http.StatusOK)
	if got := decode(t, snapshot)["request"].(map[string]any)["passenger"].(map[string]any); got["accessStatus"] != marketplace.AccessStatusDeclined || got["declinedAt"] == nil {
		t.Fatalf("the requester sees the decline: %v", got)
	}
}

// TestPassengerDeclinesBeforePickupForFree: the award is made and the driver
// is on the way. The driver's card names the passenger's first name and the
// PIN pickup — never the phone or the requester. The passenger's link shows
// the verified driver card, an ETA, and hands over the PIN. The passenger
// declines before pickup: the execution ends cancelled_by_rider with no fee,
// the driver's commission comes back through ONE linked reversal (never a
// second capture), the requester's funding is released, and the driver is
// free again.
func TestPassengerDeclinesBeforePickupForFree(t *testing.T) {
	h := guestHarness(t)
	g := bookGuest(t, h, h.Rider())
	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PickupFixture())
	bid := fundedCurrentBid(t, h, driver, g.requestID, g.amount)
	reservation := bid["reservationId"].(string)
	selected := doSelect(t, h, g.rider, g.requestID, map[string]any{"bidId": bid["bidId"], "requestVersion": 1, "bidVersion": 1}, "")
	requireStatus(t, selected, http.StatusAccepted)
	pin := decode(t, selected)["pickupPin"].(string)
	award := awardRow(t, h, g.requestID)

	jobs := h.Do(http.MethodGet, "/mp/driver/jobs", driver, nil)
	requireStatus(t, jobs, http.StatusOK)
	card := decode(t, jobs)["current"].(map[string]any)["passenger"].(map[string]any)
	if card["firstName"] != "Ada" || card["bookedForAnother"] != true || card["pickupVerification"] != marketplace.PickupVerificationPin {
		t.Fatalf("the driver sees the passenger's first name and the PIN pickup: %v", card)
	}
	if raw := jobs.Body.String(); strings.Contains(raw, guestPhone) || strings.Contains(raw, "Obi") || strings.Contains(raw, g.rider.UserID.String()) {
		t.Fatalf("the driver never sees the phone, the family name or the requester: %s", raw)
	}

	client := clientAddr()
	view := tripAccess(t, h, http.MethodGet, "/mp/trip-access", g.token, client)
	requireStatus(t, view, http.StatusOK)
	body := decode(t, view)
	if body["status"] != marketplace.TripStatusDriverOnTheWay || body["driver"] == nil || body["eta"] == nil ||
		body["pickupVerification"].(map[string]any)["pinAvailable"] != true {
		t.Fatalf("the passenger follows the committed driver: %v", body)
	}
	pinView := tripAccess(t, h, http.MethodGet, "/mp/trip-access/pin", g.token, client)
	requireStatus(t, pinView, http.StatusOK)
	pinBody := decode(t, pinView)
	if pinBody["pin"] != pin {
		t.Fatalf("the passenger gets the pickup PIN: %s", pinView.Body.String())
	}
	if _, leaks := pinBody["rideId"]; leaks || strings.Contains(pinView.Body.String(), award.ExecutionID.String()) {
		t.Fatalf("the passenger's PIN view never exposes the internal execution ride id: %s", pinView.Body.String())
	}

	declined := tripAccess(t, h, http.MethodPost, "/mp/trip-access/decline", g.token, client, move.IdempotencyHeader, idemKey())
	requireStatus(t, declined, http.StatusOK)
	state, _, _, _, active := rideRow(t, h, *award.ExecutionID)
	if state != machine.RiderCancelledByRider || active {
		t.Fatalf("the execution ends cancelled_by_rider: %s active=%v", state, active)
	}
	cancelled := outboxPayload(t, h, "ride.cancelled_by_rider", award.ExecutionID.String())
	if cancelled["feeMinor"] != float64(0) || cancelled["reason"] != "passenger_declined" {
		t.Fatalf("no fee on a passenger's decline: %v", cancelled)
	}
	if after := awardRow(t, h, g.requestID); after.State != machine.MpAwardCancelled || after.FailReason != "passenger_declined" {
		t.Fatalf("the award unwinds with the passenger's reason: %s / %s", after.State, after.FailReason)
	}
	if h.Wallet.CapturesByReservation[reservation] != 1 || h.Wallet.ReversalsByReservation[reservation] != 1 {
		t.Fatalf("one capture, one linked reversal: captures %d, reversals %d",
			h.Wallet.CapturesByReservation[reservation], h.Wallet.ReversalsByReservation[reservation])
	}
	if reason := h.Funding.ReleasedAwards[award.ID]; reason != "passenger_declined" {
		t.Fatalf("the requester's funding is released: %q", reason)
	}
	if claim := claimRow(t, h, award.ID); claim.State != machine.MpClaimReleased {
		t.Fatalf("the driver's claim is released: %s", claim.State)
	}
	var session string
	if err := h.Pool.QueryRow(context.Background(), `SELECT state FROM ride.driver_sessions WHERE driver_id = $1`, driver.UserID).Scan(&session); err != nil {
		t.Fatal(err)
	}
	if session != machine.DriverAvailable {
		t.Fatalf("the driver is free again: %s", session)
	}
	requireCode(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access/pin", g.token, client), http.StatusConflict, domain.CodeConflict)
	sweepOnce(t, h)
	if h.Wallet.ReversalsByReservation[reservation] != 1 || h.Wallet.CapturesByReservation[reservation] != 1 {
		t.Fatal("the sweep moves no money twice")
	}
}

// TestPassengerCannotDeclineOncePickedUp: once the PIN is verified and the
// trip started, the decline is refused and the PIN is spent.
func TestPassengerCannotDeclineOncePickedUp(t *testing.T) {
	h := guestHarness(t)
	g := bookGuest(t, h, h.Rider())
	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PickupFixture())
	bid := fundedCurrentBid(t, h, driver, g.requestID, g.amount)
	selected := doSelect(t, h, g.rider, g.requestID, map[string]any{"bidId": bid["bidId"], "requestVersion": 1, "bidVersion": 1}, "")
	requireStatus(t, selected, http.StatusAccepted)
	award := awardRow(t, h, g.requestID)
	trip := &tripFixture{h: h, rider: g.rider, driver: driver, requestID: g.requestID, award: award,
		rideID: *award.ExecutionID, pin: decode(t, selected)["pickupPin"].(string)}
	trip.start(t)

	client := clientAddr()
	view := tripAccess(t, h, http.MethodGet, "/mp/trip-access", g.token, client)
	requireStatus(t, view, http.StatusOK)
	if body := decode(t, view); body["status"] != marketplace.TripStatusInProgress || body["actions"].(map[string]any)["canDecline"] != false {
		t.Fatalf("aboard, the trip cannot be declined: %v", body)
	}
	requireRefusalReason(t, tripAccess(t, h, http.MethodPost, "/mp/trip-access/decline", g.token, client, move.IdempotencyHeader, idemKey()),
		http.StatusConflict, domain.CodeConflict, "past_pickup")
	requireCode(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access/pin", g.token, client), http.StatusConflict, domain.CodeConflict)
	if state, _, _, _, _ := rideRow(t, h, trip.rideID); state != machine.RiderInProgress {
		t.Fatalf("the trip runs on: %s", state)
	}
}

// TestPassengerDeclinesAQueuedAwardForFree: the guest's trip was won by a
// finishing-trip driver and waits in the next slot. The passenger declines:
// the queued award is cancelled with the driver's commission returned through
// one linked reversal, the requester's funding released, the queued claim
// freed — and the driver's CURRENT trip is untouched.
func TestPassengerDeclinesAQueuedAwardForFree(t *testing.T) {
	h := newHarness(t,
		testutil.WithFlag(cityconfig.FlagMarketplaceGuestBookings, true),
		testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	h.Clock.Set(fixedOffPeakHour)
	origin := testutil.PickupFixture()
	riderA, driver := h.Rider(), h.Driver()

	viewA, _ := publishRoute(t, h, riderA, origin, testutil.PlaceAt(origin, 3_000), 0)
	requestA := viewA["requestId"].(string)
	parkDriver(t, h, driver, origin)
	bidA := fundedCurrentBid(t, h, driver, requestA, moneyMinor(t, viewA, "minimumFareMinor"))
	requireStatus(t, doSelect(t, h, riderA, requestA, map[string]any{"bidId": bidA["bidId"], "requestVersion": 1, "bidVersion": 1}, ""), http.StatusAccepted)
	claimA := claimRow(t, h, awardRow(t, h, requestA).ID)

	requester := h.Rider()
	quote := quoteEnvelope(t, h, requester, testutil.PlaceAt(origin, 4_000), testutil.PlaceAt(origin, 9_000))
	amount := moneyMinor(t, quote, "minimumFareMinor")
	published := h.Do(http.MethodPost, "/mp/requests", requester, map[string]any{
		"quoteId": quote["quoteId"], "requestedFareMinor": moneyBody(amount), "paymentMethodId": "wallet",
		"passenger": passengerBody(yes(), yes()),
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, published, http.StatusCreated)
	requestB := decode(t, published)["requestId"].(string)
	_, token := latestToken(t, h, requestB)
	eligibility := evaluate(t, h, driver, requestB)
	queued := h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId": requestB, "requestRevision": 1, "amountMinor": moneyBody(amount),
		"slot": "next", "dependsOnClaimId": claimA.ID.String(), "availabilityEpoch": eligibility.AvailabilityEpoch,
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, queued, http.StatusCreated)
	bidB := decode(t, queued)
	reservation := bidB["reservationId"].(string)
	unconsented := doSelect(t, h, requester, requestB, map[string]any{"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1}, "")
	etaVersion := decode(t, unconsented)["details"].(map[string]any)["pickupWindow"].(map[string]any)["etaVersion"]
	requireStatus(t, doSelect(t, h, requester, requestB, map[string]any{
		"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1,
		"pickupWindowConsent": map[string]any{"etaVersion": etaVersion, "accepted": true},
	}, ""), http.StatusAccepted)
	awardB := awardRow(t, h, requestB)

	client := clientAddr()
	view := tripAccess(t, h, http.MethodGet, "/mp/trip-access", token, client)
	requireStatus(t, view, http.StatusOK)
	if body := decode(t, view); body["status"] != marketplace.TripStatusDriverQueued || body["driver"] == nil ||
		body["actions"].(map[string]any)["canDecline"] != true {
		t.Fatalf("the passenger sees a committed, queued driver: %v", body)
	}
	requireStatus(t, tripAccess(t, h, http.MethodPost, "/mp/trip-access/decline", token, client, move.IdempotencyHeader, idemKey()), http.StatusOK)

	if after := awardRow(t, h, requestB); after.State != machine.MpAwardCancelled || after.FailReason != "passenger_declined" {
		t.Fatalf("the queued award is cancelled with the passenger's reason: %s / %s", after.State, after.FailReason)
	}
	if h.Wallet.CapturesByReservation[reservation] != 1 || h.Wallet.ReversalsByReservation[reservation] != 1 {
		t.Fatalf("one capture, one linked reversal: captures %d, reversals %d",
			h.Wallet.CapturesByReservation[reservation], h.Wallet.ReversalsByReservation[reservation])
	}
	if reason := h.Funding.ReleasedAwards[awardB.ID]; reason != "passenger_declined" {
		t.Fatalf("the requester's funding is released: %q", reason)
	}
	if claim := claimRow(t, h, awardB.ID); claim.State != machine.MpClaimReleased {
		t.Fatalf("the queued claim is freed: %s", claim.State)
	}
	if current := claimByID(t, h, claimA.ID); current.State != machine.MpClaimCurrent {
		t.Fatalf("the driver's current trip is untouched: %s", current.State)
	}
	// Both money intents were written DURABLY in the cancellation's
	// transaction (so a crash after the commit still owes them to the
	// sweep) and resolved once the wallet and payment-service confirmed.
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.reservation_recovery
		WHERE reservation_id = $1 AND action = $2 AND resolved_at IS NOT NULL`,
		"mp.fund.release:"+awardB.ID.String(), marketplace.RecoveryFundingRelease); n != 1 {
		t.Fatalf("the funding release was a durable, resolved intent: %d rows", n)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.reservation_recovery
		WHERE reservation_id = $1 AND action = 'reverse' AND resolved_at IS NOT NULL`, reservation); n != 1 {
		t.Fatalf("the commission reversal was a durable, resolved intent: %d rows", n)
	}
}

// TestQueuedDeclineReleaseIsOwedAcrossAFailure: payment-service cannot
// confirm the requester's funding release when the passenger declines a
// queued award. The decline still answers (it is free and committed), the
// release stays owed as the durable intent written with the cancellation, and
// the sweep releases it — once — when payment-service answers again.
func TestQueuedDeclineReleaseIsOwedAcrossAFailure(t *testing.T) {
	h := newHarness(t,
		testutil.WithFlag(cityconfig.FlagMarketplaceGuestBookings, true),
		testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	h.Clock.Set(fixedOffPeakHour)
	origin := testutil.PickupFixture()
	riderA, driver := h.Rider(), h.Driver()

	viewA, _ := publishRoute(t, h, riderA, origin, testutil.PlaceAt(origin, 3_000), 0)
	requestA := viewA["requestId"].(string)
	parkDriver(t, h, driver, origin)
	bidA := fundedCurrentBid(t, h, driver, requestA, moneyMinor(t, viewA, "minimumFareMinor"))
	requireStatus(t, doSelect(t, h, riderA, requestA, map[string]any{"bidId": bidA["bidId"], "requestVersion": 1, "bidVersion": 1}, ""), http.StatusAccepted)
	claimA := claimRow(t, h, awardRow(t, h, requestA).ID)

	requester := h.Rider()
	quote := quoteEnvelope(t, h, requester, testutil.PlaceAt(origin, 4_000), testutil.PlaceAt(origin, 9_000))
	amount := moneyMinor(t, quote, "minimumFareMinor")
	published := h.Do(http.MethodPost, "/mp/requests", requester, map[string]any{
		"quoteId": quote["quoteId"], "requestedFareMinor": moneyBody(amount), "paymentMethodId": "wallet",
		"passenger": passengerBody(yes(), yes()),
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, published, http.StatusCreated)
	requestB := decode(t, published)["requestId"].(string)
	_, token := latestToken(t, h, requestB)
	eligibility := evaluate(t, h, driver, requestB)
	queued := h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId": requestB, "requestRevision": 1, "amountMinor": moneyBody(amount),
		"slot": "next", "dependsOnClaimId": claimA.ID.String(), "availabilityEpoch": eligibility.AvailabilityEpoch,
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, queued, http.StatusCreated)
	bidB := decode(t, queued)
	reservation := bidB["reservationId"].(string)
	unconsented := doSelect(t, h, requester, requestB, map[string]any{"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1}, "")
	etaVersion := decode(t, unconsented)["details"].(map[string]any)["pickupWindow"].(map[string]any)["etaVersion"]
	requireStatus(t, doSelect(t, h, requester, requestB, map[string]any{
		"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1,
		"pickupWindowConsent": map[string]any{"etaVersion": etaVersion, "accepted": true},
	}, ""), http.StatusAccepted)
	awardB := awardRow(t, h, requestB)
	releaseKey := "mp.fund.release:" + awardB.ID.String()

	h.Funding.FailRelease = errors.New("payment-service unavailable")
	requireStatus(t, tripAccess(t, h, http.MethodPost, "/mp/trip-access/decline", token, clientAddr(), move.IdempotencyHeader, idemKey()), http.StatusOK)
	if after := awardRow(t, h, requestB); after.State != machine.MpAwardCancelled {
		t.Fatalf("the decline commits whatever payment-service says: %s", after.State)
	}
	if _, released := h.Funding.ReleasedAwards[awardB.ID]; released {
		t.Fatal("fixture: payment-service refused the release")
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.reservation_recovery
		WHERE reservation_id = $1 AND action = $2 AND resolved_at IS NULL`, releaseKey, marketplace.RecoveryFundingRelease); n != 1 {
		t.Fatalf("the release stays owed as ONE durable intent: %d rows", n)
	}

	h.Funding.FailRelease = nil
	// The intent row's first retry time is the database's clock (real time);
	// this harness pins its own clock to a fixed off-peak hour in the past, so
	// the sweep runs "later" in real time.
	h.Clock.Set(time.Now().UTC().Add(11 * time.Minute))
	sweepOnce(t, h)
	if reason := h.Funding.ReleasedAwards[awardB.ID]; reason != "passenger_declined" {
		t.Fatalf("the sweep releases the requester's funding with the decline's reason: %q", reason)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.reservation_recovery
		WHERE reservation_id = $1 AND action = $2 AND resolved_at IS NULL`, releaseKey, marketplace.RecoveryFundingRelease); n != 0 {
		t.Fatalf("the owed release is resolved: %d rows open", n)
	}
	if h.Wallet.CapturesByReservation[reservation] != 1 || h.Wallet.ReversalsByReservation[reservation] != 1 {
		t.Fatalf("one capture, one linked reversal: captures %d, reversals %d",
			h.Wallet.CapturesByReservation[reservation], h.Wallet.ReversalsByReservation[reservation])
	}
}

// TestGuestNamesCannotCarryALink: the passenger's first name opens a
// UBI-sent SMS to a number the requester chose, so a "name" carrying a link,
// a number or a call to action is refused before anything is written — while
// real names in any script, with hyphens and apostrophes, are accepted.
func TestGuestNamesCannotCarryALink(t *testing.T) {
	h := guestHarness(t)
	rider := h.Rider()
	for _, bad := range []map[string]any{
		{"firstName": "Win at bit.ly/x"},
		{"firstName": "evil.com"},
		{"firstName": "Call 08031234567"},
		{"firstName": "https:"},
		{"firstName": "Ada", "lastName": "see www/x"},
	} {
		body := passengerBody(yes(), yes())
		for key, value := range bad {
			body[key] = value
		}
		recorder, _ := publishWithPassenger(t, h, rider, body, "")
		requireCode(t, recorder, http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.requests WHERE requester_id = $1`, rider.UserID); n != 0 {
		t.Fatalf("a refused name writes nothing: %d requests", n)
	}
	good := passengerBody(yes(), yes())
	good["firstName"], good["lastName"] = "Zoë-Ann", "O’Neil St. Clair"
	recorder, _ := publishWithPassenger(t, h, rider, good, "")
	requireStatus(t, recorder, http.StatusCreated)
	if got := decode(t, recorder)["passenger"].(map[string]any); got["firstName"] != "Zoë-Ann" || got["lastName"] != "O’Neil St. Clair" {
		t.Fatalf("real names are kept as written: %v", got)
	}
}

// TestTripLinkReissuesAreBounded: every link is an SMS to the passenger's
// phone, so a booking sends at most a bounded number of links — the requester
// cannot make UBI message that number at will. The refusal writes nothing and
// the last link keeps working.
func TestTripLinkReissuesAreBounded(t *testing.T) {
	h := guestHarness(t)
	g := bookGuest(t, h, h.Rider())
	reissue := func() *httptest.ResponseRecorder {
		return h.Do(http.MethodPost, "/mp/requests/"+g.requestID+"/passenger/access/reissue", g.rider, nil,
			move.IdempotencyHeader, idemKey())
	}
	for i := 0; i < 4; i++ {
		requireStatus(t, reissue(), http.StatusOK)
	}
	requireRefusalReason(t, reissue(), http.StatusTooManyRequests, domain.CodeRateLimited, "trip_link_limit")
	if n := countRows(t, h, `SELECT COUNT(*) FROM public.outbox_events WHERE name = 'trip_access.issued' AND payload->>'requestId' = $1`, g.requestID); n != 5 {
		t.Fatalf("five links (five SMS) at most: %d", n)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.trip_access_tokens WHERE request_id = $1 AND revoked_at IS NULL`, uuid.MustParse(g.requestID)); n != 1 {
		t.Fatalf("the refused reissue revoked nothing: %d live links", n)
	}
	_, last := latestToken(t, h, g.requestID)
	requireStatus(t, tripAccess(t, h, http.MethodGet, "/mp/trip-access", last, clientAddr()), http.StatusOK)
}
