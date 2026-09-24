package marketplace_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// Round 7 follow-ups: the ride view names its marketplace request, the
// advance booking view carries its reminders and free-cancellation deadline,
// and a cancelled queued delivery award cancels its handed-off delivery.

// TestRideViewNamesItsMarketplaceRequest: GET /v1/rides/:id of a marketplace
// execution carries marketplaceRequestId — for the rider and the driver — and
// a classic ride carries none.
func TestRideViewNamesItsMarketplaceRequest(t *testing.T) {
	h := newHarness(t)
	f := setupCurrentExecution(t, h)
	for _, actor := range []testutil.Actor{f.rider, f.driver} {
		recorder := h.Do(http.MethodGet, "/rides/"+f.rideID.String(), actor, nil)
		requireStatus(t, recorder, http.StatusOK)
		if got := decode(t, recorder)["marketplaceRequestId"]; got != f.requestID {
			t.Fatalf("the execution ride names its request: got %v, want %s", got, f.requestID)
		}
	}

	rider := h.Rider()
	quote := h.Do(http.MethodPost, "/quotes", rider, move.QuoteRequest{
		Pickup: testutil.PickupFixture(), Dropoff: testutil.DropoffFixture(), VehicleClass: "go",
	})
	requireStatus(t, quote, http.StatusCreated)
	var quoted move.QuoteView
	h.DecodeBody(quote, &quoted)
	created := h.Do(http.MethodPost, "/rides", rider, move.CreateRideRequest{
		QuoteID: quoted.QuoteID, Signature: quoted.Signature, PaymentMethodID: "cash",
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, created, http.StatusCreated)
	var result move.CreateRideResult
	h.DecodeBody(created, &result)
	classic := h.Do(http.MethodGet, "/rides/"+result.RideID.String(), rider, nil)
	requireStatus(t, classic, http.StatusOK)
	if _, present := decode(t, classic)["marketplaceRequestId"]; present {
		t.Fatalf("a classic ride names no marketplace request: %s", classic.Body.String())
	}
}

// TestAdvanceBookingViewCarriesRemindersAndFreeCancellation: the rider's
// booking view states the market's reminder offsets and until when the
// booking can be cancelled free (activation); the driver's view carries the
// reminders but no rider cancellation deadline; a cancelled booking has none.
func TestAdvanceBookingViewCarriesRemindersAndFreeCancellation(t *testing.T) {
	h := schedulingHarness(t)
	f := bookAdvance(t, h, 8*time.Hour, "wallet")

	rider := h.Do(http.MethodGet, f.bookingPath(""), f.rider, nil)
	requireStatus(t, rider, http.StatusOK)
	view := decode(t, rider)
	offsets, ok := view["reminderOffsetsSec"].([]any)
	if !ok || len(offsets) != 2 || offsets[0] != float64(43_200) || offsets[1] != float64(3_600) {
		t.Fatalf("the rider sees the market's reminder offsets: %v", view["reminderOffsetsSec"])
	}
	if view["freeCancellationDeadline"] != view["activationAt"] || view["freeCancellationDeadline"] == nil {
		t.Fatalf("free cancellation runs until activation: %v vs %v", view["freeCancellationDeadline"], view["activationAt"])
	}

	driver := h.Do(http.MethodGet, f.bookingPath(""), f.driver, nil)
	requireStatus(t, driver, http.StatusOK)
	driverView := decode(t, driver)
	if driverView["freeCancellationDeadline"] != nil || len(driverView["reminderOffsetsSec"].([]any)) != 2 {
		t.Fatalf("the driver sees the reminders but no rider cancellation deadline: %v", driverView)
	}

	cancelled := h.Do(http.MethodPost, f.bookingPath("/cancel"), f.rider, nil, move.IdempotencyHeader, idemKey())
	requireStatus(t, cancelled, http.StatusOK)
	if after := decode(t, cancelled); after["freeCancellationDeadline"] != nil {
		t.Fatalf("a cancelled booking has no cancellation deadline: %v", after["freeCancellationDeadline"])
	}
}

// queuedDeliveryAward awards a service=delivery request into the driver's
// NEXT slot behind a current ride, handed off to the delivery double.
func queuedDeliveryAward(t *testing.T, h *testutil.Harness, double *deliveryDouble) (*marketplace.Award, testutil.Actor, string) {
	t.Helper()
	origin := testutil.PickupFixture()
	riderA, sender, driver := h.Rider(), h.Rider(), h.Driver()
	double.withSender(sender.UserID)
	viewA, _ := publishRoute(t, h, riderA, origin, testutil.PlaceAt(origin, 3_000), 0)
	requestA := viewA["requestId"].(string)
	parkDriver(t, h, driver, origin)
	bidA := fundedCurrentBid(t, h, driver, requestA, moneyMinor(t, viewA, "minimumFareMinor"))
	requireStatus(t, doSelect(t, h, riderA, requestA, map[string]any{"bidId": bidA["bidId"], "requestVersion": 1, "bidVersion": 1}, ""), http.StatusAccepted)
	claimA := claimRow(t, h, awardRow(t, h, requestA).ID)

	quote := h.Do(http.MethodGet, quotePath(t, "delivery", testutil.PlaceAt(origin, 4_000), testutil.PlaceAt(origin, 9_000), nil), sender, nil)
	requireStatus(t, quote, http.StatusOK)
	amount := moneyMinor(t, decode(t, quote), "minimumFareMinor")
	published := h.Do(http.MethodPost, "/mp/requests", sender, map[string]any{
		"quoteId": decode(t, quote)["quoteId"], "requestedFareMinor": moneyBody(amount),
		"paymentMethodId": "wallet", "delivery": map[string]any{"weightKg": 2},
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, published, http.StatusCreated)
	requestB := decode(t, published)["requestId"].(string)
	eligibility := evaluate(t, h, driver, requestB)
	queued := h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId": requestB, "requestRevision": 1, "amountMinor": moneyBody(amount),
		"slot": "next", "dependsOnClaimId": claimA.ID.String(), "availabilityEpoch": eligibility.AvailabilityEpoch,
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, queued, http.StatusCreated)
	bidB := decode(t, queued)
	unconsented := doSelect(t, h, sender, requestB, map[string]any{"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1}, "")
	etaVersion := decode(t, unconsented)["details"].(map[string]any)["pickupWindow"].(map[string]any)["etaVersion"]
	requireStatus(t, doSelect(t, h, sender, requestB, map[string]any{
		"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1,
		"pickupWindowConsent": map[string]any{"etaVersion": etaVersion, "accepted": true},
	}, ""), http.StatusAccepted)
	award := awardRow(t, h, requestB)
	if award.State != machine.MpAwardConfirmed || award.ExecutionService != marketplace.ServiceDelivery || award.ExecutionID == nil {
		t.Fatalf("fixture: the queued delivery is handed off and confirmed: %s", award.State)
	}
	return award, driver, bidB["reservationId"].(string)
}

// driverDropsOffline simulates the driver's session going offline (the app
// died): the queued-driver failure recovery cancels their queued award.
func driverDropsOffline(t *testing.T, h *testutil.Harness, driver testutil.Actor) {
	t.Helper()
	if _, err := h.Pool.Exec(context.Background(), `UPDATE ride.driver_sessions SET state = 'offline' WHERE driver_id = $1`, driver.UserID); err != nil {
		t.Fatal(err)
	}
}

func deliveryCancelRow(t *testing.T, h *testutil.Harness, awardID uuid.UUID) *marketplace.DeliveryCancelRow {
	t.Helper()
	row, err := h.Marketplace.Store().DeliveryCancelByAward(context.Background(), h.Pool, awardID)
	if err != nil {
		t.Fatalf("read the delivery cancellation of %s: %v", awardID, err)
	}
	return row
}

// TestCancelledQueuedDeliveryCancelsItsDelivery: a queued delivery award
// whose hand-off already reached delivery-service is cancelled by the
// driver-failure recovery; the cancellation of the delivery is owed in the
// same transaction, sent once, recorded and audited — no orphan delivery,
// and further sweeps send nothing.
func TestCancelledQueuedDeliveryCancelsItsDelivery(t *testing.T) {
	double := newDeliveryDouble(t, deliveryTestKey)
	double.deployCancel()
	h := newHarness(t,
		testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true),
		testutil.WithDeliveryAssign(marketplace.NewHTTPDeliveryAssign(double.url(), deliveryTestKey, nil)))
	h.Clock.Set(fixedOffPeakHour)
	award, driver, reservation := queuedDeliveryAward(t, h, double)
	claim := claimRow(t, h, award.ID)

	driverDropsOffline(t, h, driver)
	sweepOnce(t, h)
	if after := awardRow(t, h, award.RequestID.String()); after.State != machine.MpAwardCancelled || after.FailReason != "driver_offline" {
		t.Fatalf("the queued award is cancelled: %s / %s", after.State, after.FailReason)
	}
	calls, cancelled, bodies := double.cancelSnapshot()
	if calls != 1 || cancelled != 1 {
		t.Fatalf("the delivery is cancelled once: calls %d, cancelled %d", calls, cancelled)
	}
	body := bodies[0]
	if body["awardId"] != award.ID.String() || body["deliveryId"] != award.ExecutionID.String() ||
		body["fencingToken"] != float64(claim.FencingToken) || body["reason"] != "driver_offline" {
		t.Fatalf("the cancellation names the award, its delivery and fencing token: %v", body)
	}
	if delivery, _ := double.deliveryFor(award.ID); delivery["status"] != "CANCELLED" {
		t.Fatalf("delivery-service no longer holds an assigned orphan: %v", delivery["status"])
	}
	row := deliveryCancelRow(t, h, award.ID)
	if row.State != marketplace.DeliveryCancelCancelled || row.ResolvedAt == nil {
		t.Fatalf("the cancellation is recorded: %+v", row)
	}
	for _, action := range []string{"mp.delivery.cancel_owed", "mp.delivery.cancelled"} {
		if n := countRows(t, h, `SELECT COUNT(*) FROM public.audit_log WHERE action = $1 AND subject_id = $2`, action, award.ID.String()); n != 1 {
			t.Fatalf("%s is audited once: %d", action, n)
		}
	}
	if h.Wallet.ReversalsByReservation[reservation] != 1 {
		t.Fatal("the captured commission is reversed once")
	}
	sweepOnce(t, h)
	resumeLater(t, h)
	if calls, _, _ := double.cancelSnapshot(); calls != 1 {
		t.Fatalf("nothing is sent again: %d", calls)
	}
}

// TestQueuedDeliveryCancelIsOwedUntilDeliveryServiceServesIt: while
// delivery-service does not serve marketplace-cancel (its router's plain 404)
// the owed cancellation stays pending — alarmed, retried with backoff, never
// dropped — and is delivered once the route exists.
func TestQueuedDeliveryCancelIsOwedUntilDeliveryServiceServesIt(t *testing.T) {
	double := newDeliveryDouble(t, deliveryTestKey)
	h := newHarness(t,
		testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true),
		testutil.WithDeliveryAssign(marketplace.NewHTTPDeliveryAssign(double.url(), deliveryTestKey, nil)))
	h.Clock.Set(fixedOffPeakHour)
	award, driver, _ := queuedDeliveryAward(t, h, double)

	driverDropsOffline(t, h, driver)
	sweepOnce(t, h)
	row := deliveryCancelRow(t, h, award.ID)
	if row.State != marketplace.DeliveryCancelPending || row.Attempts < 1 || row.LastStatus == nil || *row.LastStatus != http.StatusNotFound {
		t.Fatalf("the cancellation is owed, recorded with the router's 404: %+v", row)
	}
	resumeLater(t, h)
	if row := deliveryCancelRow(t, h, award.ID); row.State != marketplace.DeliveryCancelPending {
		t.Fatalf("still owed while the route is missing: %s", row.State)
	}

	double.deployCancel()
	resumeLater(t, h)
	if row := deliveryCancelRow(t, h, award.ID); row.State != marketplace.DeliveryCancelCancelled {
		t.Fatalf("delivered once the route exists: %+v", row)
	}
	if _, cancelled, _ := double.cancelSnapshot(); cancelled != 1 {
		t.Fatalf("one effective cancellation: %d", cancelled)
	}
	if delivery, _ := double.deliveryFor(award.ID); delivery["status"] != "CANCELLED" {
		t.Fatalf("the delivery is cancelled: %v", delivery["status"])
	}
}
