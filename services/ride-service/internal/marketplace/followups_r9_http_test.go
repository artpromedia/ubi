package marketplace_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// Round-9 ride-service follow-ups: notification targeting on the trip,
// stop, award and queue events.

// targetingLeaks are keys a notification-facing payload never carries: the
// audiences are named by id, never by location, phone, token or name.
var targetingLeaks = map[string]bool{
	"lat": true, "lng": true, "latitude": true, "longitude": true, "phone": true, "phoneE164": true,
	"firstName": true, "pin": true, "token": true, "sealed": true, "smsCopy": true, "email": true,
}

// walkPayloadKeys visits every object key of a decoded JSON document.
func walkPayloadKeys(value any, visit func(key string)) {
	switch typed := value.(type) {
	case map[string]any:
		for key, inner := range typed {
			visit(key)
			walkPayloadKeys(inner, visit)
		}
	case []any:
		for _, inner := range typed {
			walkPayloadKeys(inner, visit)
		}
	}
}

// requireTargetedEvents reads every outbox row of the named families for the
// given awards and requires each to name the award's requester AND driver by
// id (notification-service reaches each audience from the payload first),
// with nothing else identifying in it. Every name in `want` must appear.
func requireTargetedEvents(t *testing.T, h *testutil.Harness, awards []*marketplace.Award, want []string) {
	t.Helper()
	byID := map[string]*marketplace.Award{}
	ids := []string{}
	for _, award := range awards {
		byID[award.ID.String()] = award
		ids = append(ids, award.ID.String())
	}
	rows, err := h.Pool.Query(context.Background(), `
		SELECT name, payload FROM public.outbox_events
		WHERE (name LIKE 'mp.amendment.%' OR name LIKE 'mp.stop.%'
			OR name IN ('mp.award.confirmed', 'mp.claim.promoted', 'mp.queue.eta_updated', 'mp.queue.window_missed'))
			AND payload->>'awardId' = ANY($1)`, ids)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	seen := map[string]int{}
	for rows.Next() {
		var name string
		var payload map[string]any
		if err := rows.Scan(&name, &payload); err != nil {
			t.Fatal(err)
		}
		seen[name]++
		award := byID[payload["awardId"].(string)]
		if payload["requesterId"] != award.RequesterID.String() || payload["driverId"] != award.DriverID.String() {
			t.Errorf("%s names both parties by id: requester %v (want %s), driver %v (want %s)",
				name, payload["requesterId"], award.RequesterID, payload["driverId"], award.DriverID)
		}
		walkPayloadKeys(payload, func(key string) {
			if targetingLeaks[key] {
				t.Errorf("%s carries %q — payloads stay PII-free: %v", name, key, payload)
			}
		})
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for _, name := range want {
		if seen[name] == 0 {
			t.Errorf("the scenario produced no %s (seen: %v)", name, seen)
		}
	}
}

// TestAmendmentAndStopEventsNameBothParties: every mp.amendment.* and
// mp.stop.* event — driver arrival and departure at a stop, the paid-waiting
// milestones, the pre-authorized waiting adjustment from proposal to commit,
// and a rider's route amendment — names the requester and the driver.
func TestAmendmentAndStopEventsNameBothParties(t *testing.T) {
	h := amendHarness(t)
	// A rider's route amendment, approved by both parties.
	routed := awardedTrip(t, h, []map[string]any{firstStopInput()})
	proposed := routed.propose(routed.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, proposed, http.StatusCreated)
	amendment := decode(t, proposed)
	requireStatus(t, routed.decide(routed.rider, amendment, "approve", ""), http.StatusOK)
	routed.park(t, routed.position, 30*time.Second)
	requireStatus(t, routed.decide(routed.driver, amendment, "approve", ""), http.StatusOK)

	// A stop's arrival, paid waiting and departure, and the pre-authorized
	// waiting adjustment it settles through.
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	stopID := f.stops[0]["stopId"].(string)
	_, _, firstPlace, _ := stopFixtures()
	f.start(t)
	f.moveTo(t, firstPlace, 5*time.Minute)
	requireStatus(t, f.stopPost(f.driver, stopID, "arrive", map[string]any{}, ""), http.StatusOK)
	h.Clock.Advance(270 * time.Second)
	sweepOnce(t, h)
	requireStatus(t, f.stopPost(f.driver, stopID, "depart", nil, ""), http.StatusOK)
	h.Clock.Advance(time.Minute)
	sweepOnce(t, h)
	if waiting := waitingAmendments(t, f); len(waiting) != 1 {
		t.Fatalf("fixture: one waiting adjustment: %+v", waiting)
	}

	requireTargetedEvents(t, h, []*marketplace.Award{routed.award, f.award}, []string{
		"mp.award.confirmed", "mp.stop.arrived", "mp.stop.waiting_started", "mp.stop.paid_waiting_accruing",
		"mp.stop.departed", "mp.amendment.proposed", "mp.amendment.awaiting_approvals", "mp.amendment.approved",
		"mp.amendment.committed",
	})
}

// TestQueueEventsNameBothParties: the queued job's window-missed and ETA
// events and the promotion of the queued claim name the queued award's
// requester and driver.
func TestQueueEventsNameBothParties(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	f := setupQueuedAward(t, h)
	origin := testutil.PickupFixture()

	h.Clock.Advance(4 * time.Minute)
	ingestPoints(t, h, f.driver, []map[string]any{
		point(10, testutil.PlaceAt(origin, -10_000), h.Clock.Now().Add(-time.Second), 20),
	})
	sweepOnce(t, h)
	// Back at A's pickup to run trip A to completion.
	h.Clock.Advance(10 * time.Minute)
	ingestPoints(t, h, f.driver, []map[string]any{point(11, origin, h.Clock.Now().Add(-time.Second), 0)})

	ride := "/rides/" + f.rideA.String()
	requireStatus(t, h.Do(http.MethodPost, ride+"/arrived", f.driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, ride+"/verify-pin", f.driver, map[string]any{"pin": f.pinA}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, ride+"/start", f.driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, ride+"/complete", f.driver, map[string]any{}), http.StatusOK)
	if promoted := claimByID(t, h, f.claimB.ID); promoted.Slot != "current" {
		t.Fatalf("fixture: the queued claim is promoted: %+v", promoted)
	}
	promotedPayload := outboxPayload(t, h, "mp.claim.promoted", f.claimB.ID.String())
	if promotedPayload["requestId"] != f.requestB {
		t.Fatalf("the promotion names its request: %v", promotedPayload)
	}
	requireTargetedEvents(t, h, []*marketplace.Award{f.awardA, f.awardB},
		[]string{"mp.award.confirmed", "mp.queue.window_missed", "mp.claim.promoted"})
	if strings.Contains(promotedPayload["requesterId"].(string), f.riderA.UserID.String()) {
		t.Fatal("the promoted job names ITS requester, never the finished trip's")
	}
}

// TestBusinessPaymentMethodNeverReachesTheDriver (round-7 low): the
// execution ride of a business trip — every ride view the driver reads, and
// every ride.* event — says the fare is paid through UBI (paid_by_ubi:
// nothing to collect) and names no payer; so does the driver's receipt. The
// requester's own marketplace views keep the organization as payer.
func TestBusinessPaymentMethodNeverReachesTheDriver(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double)
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, 2_000_000)
	f := awardBusinessTrip(t, h, rider, map[string]any{"organizationId": org.orgID}, nil)

	for _, path := range []string{"/rides/" + f.rideID.String(), "/rides/active"} {
		view := h.Do(http.MethodGet, path, f.driver, nil)
		requireStatus(t, view, http.StatusOK)
		body := decode(t, view)
		if ride, nested := body["ride"].(map[string]any); nested {
			body = ride
		}
		if body["paymentMethodId"] != marketplace.PaymentMethodPaidByUBI {
			t.Fatalf("%s: the driver is told the fare is paid through UBI: %v", path, body["paymentMethodId"])
		}
		if raw := view.Body.String(); strings.Contains(raw, "business") || strings.Contains(raw, org.orgID) {
			t.Fatalf("%s: no payer details reach the driver: %s", path, raw)
		}
	}
	snapshot := decode(t, h.Do(http.MethodGet, "/mp/requests/"+f.requestID, rider, nil))["request"].(map[string]any)
	if business, ok := snapshot["business"].(map[string]any); !ok || business["payerRole"] != "organization" {
		t.Fatalf("the requester's own view still names the organization paying: %v", snapshot["business"])
	}

	completeTrip(t, h, rider, f.driver, f.requestID, f.rideID, 10)
	rows, err := h.Pool.Query(context.Background(),
		`SELECT name, payload::text FROM public.outbox_events WHERE name LIKE 'ride.%' AND aggregate_id = $1`, f.rideID.String())
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	names := map[string]string{}
	for rows.Next() {
		var name, payload string
		if err := rows.Scan(&name, &payload); err != nil {
			t.Fatal(err)
		}
		names[name] = payload
		if strings.Contains(payload, "business") || strings.Contains(payload, org.orgID) {
			t.Fatalf("%s names the payer: %s", name, payload)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"ride.requested", "ride.completed"} {
		if !strings.Contains(names[name], `"`+marketplace.PaymentMethodPaidByUBI+`"`) {
			t.Fatalf("%s carries paid_by_ubi: %q", name, names[name])
		}
	}

	receipt := h.Do(http.MethodGet, "/mp/requests/"+f.requestID+"/receipt", f.driver, nil)
	requireStatus(t, receipt, http.StatusOK)
	if method := decode(t, receipt)["payment"].(map[string]any)["method"]; method != marketplace.PaymentMethodPaidByUBI {
		t.Fatalf("the driver's receipt says paid through UBI: %v", method)
	}
	if raw := receipt.Body.String(); strings.Contains(raw, "business") {
		t.Fatalf("the driver's receipt never says business: %s", raw)
	}
}
