package marketplace_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// TRIP-LINK SEALED DELIVERY CONTRACT, producer side, end to end: the
// trip_access.issued payload the shared relay broadcasts (and the outbox row
// that persists) never carries the token, the phone or the first name in
// clear; without a usable key no link is issued and nothing is written.

// TestTripAccessIssuedCarriesNoClearValues: the stored outbox row — every
// byte of it — holds neither the raw token, nor the passenger's phone, nor
// their first name; the payload has exactly the contract's non-sensitive
// keys; the envelope opens (under its own token's AAD) to all three. A
// reissue seals the new link under a fresh IV.
func TestTripAccessIssuedCarriesNoClearValues(t *testing.T) {
	h := guestHarness(t)
	g := bookGuest(t, h, h.Rider())

	var raw string
	if err := h.Pool.QueryRow(t.Context(),
		`SELECT payload::text FROM public.outbox_events WHERE name = 'trip_access.issued' AND aggregate_id = $1`, g.tokenID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{g.token, guestPhone, strings.TrimPrefix(guestPhone, "+"), "Ada", "Obi"} {
		if strings.Contains(raw, secret) {
			t.Fatalf("the outbox row carries %q in clear: %s", secret, raw)
		}
	}
	payload := outboxPayload(t, h, "trip_access.issued", g.tokenID)
	want := map[string]bool{"tokenId": true, "requestId": true, "scope": true, "expiresAt": true, "recipient": true, "smsCopy": true, "sealed": true}
	for key := range payload {
		if !want[key] {
			t.Fatalf("the payload carries only the contract's keys, not %q: %v", key, payload)
		}
	}
	for _, leaked := range []string{"accessToken", "phone", "firstName", "token"} {
		if _, ok := payload[leaked]; ok {
			t.Fatalf("%s must never ride the payload in clear", leaked)
		}
	}
	if payload["tokenId"] != g.tokenID || payload["requestId"] != g.requestID || payload["scope"] != marketplace.TripAccessScopeGuestPassenger {
		t.Fatalf("the payload names the token, the request and the scope: %v", payload)
	}
	sealed := payload["sealed"].(map[string]any)
	if len(sealed) != 6 {
		t.Fatalf("the envelope is exactly {v, alg, kid, iv, ct, tag}: %v", sealed)
	}
	opened := openSealedDelivery(t, h, payload, g.tokenID)
	if opened.Phone != guestPhone || opened.Token != g.token || opened.FirstName != "Ada" {
		t.Fatalf("the envelope opens to the delivery: %+v", opened)
	}

	reissued := h.Do(http.MethodPost, "/mp/requests/"+g.requestID+"/passenger/access/reissue", g.rider, nil, move.IdempotencyHeader, idemKey())
	requireStatus(t, reissued, http.StatusOK)
	newID, newToken := latestToken(t, h, g.requestID)
	if newID == g.tokenID || newToken == g.token {
		t.Fatal("a reissue is a new link")
	}
	next := outboxPayload(t, h, "trip_access.issued", newID)
	if next["sealed"].(map[string]any)["iv"] == sealed["iv"] {
		t.Fatal("every issued link is sealed under a fresh IV")
	}
}

// TestGuestBookingFailsClosedWithoutADeliveryKey: with no
// TRIP_ACCESS_DELIVERY_KEY the guest booking is REFUSED (503
// service_unavailable, reason trip_link_delivery_unavailable) before
// anything is written — no request, no passenger, no link, no event — while
// booking a ride for yourself stays available.
func TestGuestBookingFailsClosedWithoutADeliveryKey(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceGuestBookings, true), testutil.WithoutTripAccessSealer())
	rider := h.Rider()
	recorder, _ := publishWithPassenger(t, h, rider, passengerBody(yes(), yes()), "")
	requireRefusalReason(t, recorder, http.StatusServiceUnavailable, domain.CodeServiceUnavailable, marketplace.ReasonTripLinkDeliveryUnavailable)
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.requests WHERE requester_id = $1`, rider.UserID); n != 0 {
		t.Fatalf("nothing is published: %d", n)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.request_passengers WHERE requester_id = $1`, rider.UserID); n != 0 {
		t.Fatalf("no passenger is recorded: %d", n)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM public.outbox_events WHERE name = 'trip_access.issued' AND city_id = $1`, h.CityID); n != 0 {
		t.Fatalf("no trip link event is written: %d", n)
	}
	if strings.Contains(recorder.Body.String(), guestPhone) {
		t.Fatal("the refusal never echoes the phone")
	}
	publishAt(t, h, rider, 0) // booking for yourself is unaffected
}
