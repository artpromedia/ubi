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

// The award saga's delivery hand-off (the marketplace-assign producer):
// driven from the durable step ledger after the ONE commission capture,
// exactly once across lost answers and restarts, never re-charging, and
// nothing at all while marketplace_delivery is off.

const deliveryTestKey = "delivery-hand-off-test-key-0123456789"

// deliveryHarness is the marketplace harness wired to a delivery double
// through the REAL HTTP client.
func deliveryHarness(t *testing.T, double *deliveryDouble, key string) *testutil.Harness {
	t.Helper()
	return newHarness(t, testutil.WithDeliveryAssign(marketplace.NewHTTPDeliveryAssign(double.url(), key, nil)))
}

// deliveryAward is one selected delivery request.
type deliveryAward struct {
	rider, driver testutil.Actor
	requestID     string
	reservationID string
	amount        int64
	selected      map[string]any
	selectKey     string
	selectBody    map[string]any
}

// selectDelivery publishes a delivery request, has a parked driver bid it
// and selects the bid (the saga runs synchronously as far as it can).
func selectDelivery(t *testing.T, h *testutil.Harness, rider testutil.Actor) *deliveryAward {
	t.Helper()
	d := &deliveryAward{rider: rider, driver: h.Driver()}
	pickup, dropoff := testutil.PickupFixture(), testutil.DropoffFixture()
	quoteRecorder := h.Do(http.MethodGet, quotePath(t, "delivery", pickup, dropoff, nil), rider, nil)
	requireStatus(t, quoteRecorder, http.StatusOK)
	quote := decode(t, quoteRecorder)
	d.amount = moneyMinor(t, quote, "minimumFareMinor")
	published := h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(d.amount),
		"paymentMethodId":    "wallet",
		"delivery":           map[string]any{"weightKg": 7.5, "description": "Two document boxes", "fragile": true},
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, published, http.StatusCreated)
	d.requestID = decode(t, published)["requestId"].(string)

	parkDriver(t, h, d.driver, pickup)
	bid := fundedCurrentBid(t, h, d.driver, d.requestID, d.amount)
	d.reservationID = bid["reservationId"].(string)
	d.selectKey = idemKey()
	d.selectBody = map[string]any{"bidId": bid["bidId"], "requestVersion": 1, "bidVersion": 1}
	recorder := doSelect(t, h, rider, d.requestID, d.selectBody, d.selectKey)
	requireStatus(t, recorder, http.StatusAccepted)
	d.selected = decode(t, recorder)
	return d
}

func handoffRow(t *testing.T, h *testutil.Harness, awardID uuid.UUID) *marketplace.DeliveryHandoff {
	t.Helper()
	row, err := h.Marketplace.Store().HandoffByAward(context.Background(), h.Pool, awardID)
	if err != nil {
		t.Fatalf("read the hand-off of award %s: %v", awardID, err)
	}
	return row
}

func attemptRow(t *testing.T, h *testutil.Harness, awardID uuid.UUID) *marketplace.AwardAttempt {
	t.Helper()
	attempt, err := h.Marketplace.Store().AttemptFor(context.Background(), h.Pool, awardID)
	if err != nil {
		t.Fatal(err)
	}
	return attempt
}

// resumeLater advances past any saga backoff and runs the sweep — what a
// restarted process does: the durable ledger is its only memory.
func resumeLater(t *testing.T, h *testutil.Harness) {
	t.Helper()
	h.Clock.Advance(11 * time.Minute)
	sweepOnce(t, h)
}

// TestDeliveryHandOffIsExactlyOnceAcrossALostAnswer: delivery-service creates
// the delivery but the answer is lost. The award stays pending (nothing
// promised) at the hand-off step; the resumed saga re-sends the SAME body and
// adopts delivery-service's 200 replay — one delivery, one commission capture,
// the award confirmed onto {service: delivery} with no execution ride. A
// replayed selection and further sweeps send nothing more.
func TestDeliveryHandOffIsExactlyOnceAcrossALostAnswer(t *testing.T) {
	double := newDeliveryDouble(t, deliveryTestKey)
	h := deliveryHarness(t, double, deliveryTestKey)
	rider := h.Rider()
	double.withSender(rider.UserID)
	double.inject(0, 0, 1)

	d := selectDelivery(t, h, rider)
	award := awardRow(t, h, d.requestID)
	if award.State != machine.MpAwardPending {
		t.Fatalf("a lost hand-off answer promises nothing: award %s", award.State)
	}
	if attempt := attemptRow(t, h, award.ID); attempt.Step != marketplace.AttemptStepHandoff || attempt.State != marketplace.AttemptStateUnknown {
		t.Fatalf("the ledger parks at the hand-off, outcome unknown: %s/%s", attempt.Step, attempt.State)
	}
	if outboxCount(t, h, "mp.award.confirmed", award.ID.String()) != 0 {
		t.Fatal("no confirmation before delivery-service answered")
	}
	calls, created, _ := double.snapshot()
	if calls != 1 || created != 1 {
		t.Fatalf("delivery-service committed once: calls %d, created %d", calls, created)
	}
	if h.Wallet.CapturesByReservation[d.reservationID] != 1 {
		t.Fatalf("the ONE capture happened before the hand-off: %d", h.Wallet.CapturesByReservation[d.reservationID])
	}

	resumeLater(t, h)
	award = awardRow(t, h, d.requestID)
	if award.State != machine.MpAwardConfirmed {
		t.Fatalf("the resumed saga confirms the award: %s (%s)", award.State, attemptRow(t, h, award.ID).LastError)
	}
	delivery, ok := double.deliveryFor(award.ID)
	if !ok {
		t.Fatal("the double holds the award's delivery")
	}
	if award.ExecutionService != marketplace.ServiceDelivery || award.ExecutionID == nil || award.ExecutionID.String() != delivery["id"] {
		t.Fatalf("the award executes as the ONE delivery: %s %v vs %v", award.ExecutionService, award.ExecutionID, delivery["id"])
	}
	calls, created, bodies := double.snapshot()
	if calls != 2 || created != 1 {
		t.Fatalf("one re-send, one delivery: calls %d, created %d", calls, created)
	}
	if bodies[0]["awardId"] != bodies[1]["awardId"] || bodies[0]["fencingToken"] != bodies[1]["fencingToken"] ||
		bodies[0]["fareMinor"] != bodies[1]["fareMinor"] {
		t.Fatalf("the re-send is the same hand-off: %v vs %v", bodies[0], bodies[1])
	}
	if h.Wallet.CapturesByReservation[d.reservationID] != 1 || h.Wallet.ReversalsByReservation[d.reservationID] != 0 {
		t.Fatalf("never re-charged, never reversed: captures %d, reversals %d",
			h.Wallet.CapturesByReservation[d.reservationID], h.Wallet.ReversalsByReservation[d.reservationID])
	}

	// The documented body, exactly.
	claim := claimRow(t, h, award.ID)
	body := bodies[1]
	pickup, dropoff := body["pickup"].(map[string]any), body["dropoff"].(map[string]any)
	pkg := body["packageDetails"].(map[string]any)
	if body["awardId"] != award.ID.String() || body["requestId"] != d.requestID ||
		body["customerId"] != rider.UserID.String() || body["driverId"] != d.driver.UserID.String() ||
		body["fareMinor"] != float64(award.FareMinor) || body["currency"] != testCurrency ||
		body["fencingToken"] != float64(claim.FencingToken) ||
		pickup["latitude"] != testutil.PickupFixture().Lat || dropoff["longitude"] != testutil.DropoffFixture().Lng ||
		pkg["weight"] != 7.5 || pkg["size"] != "MEDIUM" || pkg["description"] != "Two document boxes" ||
		pkg["fragile"] != true || pkg["requiresPod"] != true {
		t.Fatalf("the hand-off body is the documented contract: %v", body)
	}

	// The delivery is the execution: claim current on it, request executing,
	// no execution ride, no PIN promised.
	if claim.State != machine.MpClaimCurrent || claim.ExecutionService != marketplace.ServiceDelivery ||
		claim.ExecutionID == nil || claim.ExecutionID.String() != delivery["id"] {
		t.Fatalf("the driver's current claim couples to the delivery: %+v", claim)
	}
	if request := requestRow(t, h, d.requestID); request.State != machine.MpRequestExecution {
		t.Fatalf("the request is executing: %s", request.State)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM ride.rides WHERE marketplace_award_id = $1`, award.ID); n != 0 {
		t.Fatalf("a delivery award writes no execution ride: %d", n)
	}
	if row := handoffRow(t, h, award.ID); row.State != marketplace.HandoffDelivered || row.DeliveryID == nil ||
		row.DeliveryID.String() != delivery["id"] || row.Attempts != 2 {
		t.Fatalf("the hand-off record: %+v", row)
	}
	confirmed := outboxPayload(t, h, "mp.award.confirmed", award.ID.String())
	if confirmed["executionService"] != "delivery" || confirmed["executionId"] != delivery["id"] {
		t.Fatalf("mp.award.confirmed names the delivery: %v", confirmed)
	}
	jobs := h.Do(http.MethodGet, "/mp/driver/jobs", d.driver, nil)
	requireStatus(t, jobs, http.StatusOK)
	current := decode(t, jobs)["current"].(map[string]any)
	if ref := current["executionRef"].(map[string]any); ref["service"] != "delivery" || ref["id"] != delivery["id"] || current["requestId"] != d.requestID {
		t.Fatalf("the driver's job opens the delivery: %v", current)
	}

	// Nothing more is ever sent for this award.
	resumeLater(t, h)
	replay := doSelect(t, h, rider, d.requestID, d.selectBody, d.selectKey)
	requireStatus(t, replay, http.StatusAccepted)
	if calls, created, _ := double.snapshot(); calls != 2 || created != 1 {
		t.Fatalf("a confirmed award is never handed off again: calls %d, created %d", calls, created)
	}
	if outboxCount(t, h, "mp.award.confirmed", award.ID.String()) != 1 {
		t.Fatal("confirmed exactly once")
	}
}

// TestDeliveryHandOffRetriesAmbiguousAnswers: 409 ASSIGN_IN_PROGRESS and a
// 5xx are never guessed at — the award stays pending and the sweep asks again
// until delivery-service creates the delivery.
func TestDeliveryHandOffRetriesAmbiguousAnswers(t *testing.T) {
	double := newDeliveryDouble(t, deliveryTestKey)
	h := deliveryHarness(t, double, deliveryTestKey)
	rider := h.Rider()
	double.withSender(rider.UserID)
	double.inject(1, 1, 0)

	d := selectDelivery(t, h, rider)
	award := awardRow(t, h, d.requestID)
	if award.State != machine.MpAwardPending {
		t.Fatalf("an in-progress answer leaves the award pending: %s", award.State)
	}
	if row := handoffRow(t, h, award.ID); row.State != marketplace.HandoffUnknown || row.LastCode != "ASSIGN_IN_PROGRESS" {
		t.Fatalf("the in-progress answer is recorded: %+v", row)
	}
	resumeLater(t, h)
	if row := handoffRow(t, h, award.ID); row.State != marketplace.HandoffUnknown || row.LastCode != "DATABASE_ERROR" {
		t.Fatalf("the 5xx is recorded as unknown: %+v", row)
	}
	if awardRow(t, h, d.requestID).State != machine.MpAwardPending {
		t.Fatal("a 5xx never compensates")
	}
	resumeLater(t, h)
	award = awardRow(t, h, d.requestID)
	if award.State != machine.MpAwardConfirmed || award.ExecutionService != marketplace.ServiceDelivery {
		t.Fatalf("the definite answer confirms the award: %s/%s", award.State, award.ExecutionService)
	}
	if calls, created, _ := double.snapshot(); calls != 3 || created != 1 {
		t.Fatalf("three sends, one delivery: calls %d, created %d", calls, created)
	}
	if h.Wallet.CapturesByReservation[d.reservationID] != 1 {
		t.Fatal("captured exactly once")
	}
}

// TestDeliveryHandOffPermanentRefusalCompensates: a requester with no rider
// profile is refused 422 SENDER_PROFILE_NOT_FOUND — permanent. The award is
// compensated through the one funnel: the captured fee reversed with a
// linked entry (never a second capture), the rider's funding released, the
// bid live again, no delivery and no confirmation.
func TestDeliveryHandOffPermanentRefusalCompensates(t *testing.T) {
	double := newDeliveryDouble(t, deliveryTestKey)
	h := deliveryHarness(t, double, deliveryTestKey)
	rider := h.Rider() // no rider profile registered with the double

	d := selectDelivery(t, h, rider)
	award := awardRow(t, h, d.requestID)
	if award.State != machine.MpAwardCompensated || award.FailReason != "delivery_handoff_refused: SENDER_PROFILE_NOT_FOUND" {
		t.Fatalf("a permanent refusal compensates the award: %s (%s)", award.State, award.FailReason)
	}
	if h.Wallet.CapturesByReservation[d.reservationID] != 1 || h.Wallet.ReversalsByReservation[d.reservationID] != 1 {
		t.Fatalf("one capture, one linked reversal: captures %d, reversals %d",
			h.Wallet.CapturesByReservation[d.reservationID], h.Wallet.ReversalsByReservation[d.reservationID])
	}
	if reason, released := h.Funding.ReleasedAwards[award.ID]; !released || reason == "" {
		t.Fatalf("the rider's funding is released: %v", h.Funding.ReleasedAwards)
	}
	if row := handoffRow(t, h, award.ID); row.State != marketplace.HandoffRefused || row.LastCode != "SENDER_PROFILE_NOT_FOUND" ||
		row.LastStatus == nil || *row.LastStatus != http.StatusUnprocessableEntity {
		t.Fatalf("the refusal is recorded: %+v", row)
	}
	if outboxCount(t, h, "mp.award.confirmed", award.ID.String()) != 0 || outboxCount(t, h, "mp.award.failed", award.ID.String()) != 1 {
		t.Fatal("failed, never confirmed")
	}
	if request := requestRow(t, h, d.requestID); request.State != machine.MpRequestOpen {
		t.Fatalf("the request reopens while it can still stand: %s", request.State)
	}
	if _, created, _ := double.snapshot(); created != 0 {
		t.Fatal("no delivery exists")
	}
	resumeLater(t, h)
	if calls, _, _ := double.snapshot(); calls != 1 {
		t.Fatalf("a compensated award is never re-sent: %d calls", calls)
	}
}

// TestDeliveryHandOffNothingSentWhileTheFlagIsOff: marketplace_delivery is
// switched off after the capture (its answer was lost, so the saga resumed
// later). The resumed capture replays — no second debit — and the hand-off
// sends NOTHING: the award is compensated with the fee reversed.
func TestDeliveryHandOffNothingSentWhileTheFlagIsOff(t *testing.T) {
	double := newDeliveryDouble(t, deliveryTestKey)
	h := deliveryHarness(t, double, deliveryTestKey)
	rider := h.Rider()
	double.withSender(rider.UserID)
	h.Wallet.UnknownCapture = true

	d := selectDelivery(t, h, rider)
	award := awardRow(t, h, d.requestID)
	if attempt := attemptRow(t, h, award.ID); award.State != machine.MpAwardPending || attempt.Step != marketplace.AttemptStepCapture {
		t.Fatalf("fixture: the saga parks at the capture: %s %s", award.State, attempt.Step)
	}
	h.Wallet.UnknownCapture = false
	if _, err := h.Pool.Exec(context.Background(),
		`UPDATE public.flag_rules SET enabled = false WHERE flag_key = $1 AND city_id = $2`,
		cityconfig.FlagMarketplaceDelivery, h.CityID); err != nil {
		t.Fatal(err)
	}

	resumeLater(t, h)
	award = awardRow(t, h, d.requestID)
	if award.State != machine.MpAwardCompensated || award.FailReason != "delivery_handoff_disabled" {
		t.Fatalf("an off flag compensates instead of handing off: %s (%s)", award.State, award.FailReason)
	}
	if calls, _, _ := double.snapshot(); calls != 0 {
		t.Fatalf("nothing is sent while marketplace_delivery is off: %d calls", calls)
	}
	if h.Wallet.CapturesByReservation[d.reservationID] != 1 || h.Wallet.ReversalsByReservation[d.reservationID] != 1 {
		t.Fatalf("the replayed capture moved no money; one linked reversal: captures %d, reversals %d",
			h.Wallet.CapturesByReservation[d.reservationID], h.Wallet.ReversalsByReservation[d.reservationID])
	}
	if row := handoffRow(t, h, award.ID); row.State != marketplace.HandoffDisabled {
		t.Fatalf("the hand-off record says why nothing was sent: %+v", row)
	}
}

// TestDeliveryHandOffMisconfigurationStaysPending: a key delivery-service
// refuses (403) and a client with no URL at all are deployment faults — the
// award stays pending, alarmed, nothing is compensated or promised, and the
// sweep resumes once the deployment is fixed.
func TestDeliveryHandOffMisconfigurationStaysPending(t *testing.T) {
	double := newDeliveryDouble(t, deliveryTestKey)
	h := deliveryHarness(t, double, "a-key-delivery-service-does-not-have")
	rider := h.Rider()
	double.withSender(rider.UserID)

	d := selectDelivery(t, h, rider)
	award := awardRow(t, h, d.requestID)
	if award.State != machine.MpAwardPending {
		t.Fatalf("a refused key never compensates: %s", award.State)
	}
	if row := handoffRow(t, h, award.ID); row.State != marketplace.HandoffBlocked || row.LastStatus == nil || *row.LastStatus != http.StatusForbidden {
		t.Fatalf("the misconfiguration is recorded: %+v", row)
	}
	if h.Wallet.ReversalsByReservation[d.reservationID] != 0 {
		t.Fatal("nothing is reversed for a deployment fault")
	}

	// An unwired client sends nothing at all.
	unwired := newHarness(t, testutil.WithDeliveryAssign(marketplace.NewHTTPDeliveryAssign("", deliveryTestKey, nil)))
	e := selectDelivery(t, unwired, unwired.Rider())
	other := awardRow(t, unwired, e.requestID)
	if other.State != machine.MpAwardPending {
		t.Fatalf("an unwired hand-off keeps the award pending: %s", other.State)
	}
	if row := handoffRow(t, unwired, other.ID); row.State != marketplace.HandoffBlocked {
		t.Fatalf("the unwired hand-off is recorded as blocked: %+v", row)
	}
	if calls, _, _ := double.snapshot(); calls != 1 {
		t.Fatalf("only the first harness reached delivery-service: %d", calls)
	}
}

// TestQueuedDeliveryIsHandedOffOnceAndPromotedOntoIt: a finishing-trip
// driver wins a DELIVERY in the next slot. The saga hands it off at award
// time (the delivery exists, assigned, before anything is confirmed) and the
// claim waits in the next slot; when the current trip completes, the
// promotion couples the claim to that same delivery — no execution ride, no
// second hand-off, no second commission.
func TestQueuedDeliveryIsHandedOffOnceAndPromotedOntoIt(t *testing.T) {
	double := newDeliveryDouble(t, deliveryTestKey)
	h := newHarness(t,
		testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true),
		testutil.WithDeliveryAssign(marketplace.NewHTTPDeliveryAssign(double.url(), deliveryTestKey, nil)))
	h.Clock.Set(fixedOffPeakHour)
	origin := testutil.PickupFixture()
	riderA, sender, driver := h.Rider(), h.Rider(), h.Driver()
	double.withSender(sender.UserID)

	viewA, _ := publishRoute(t, h, riderA, origin, testutil.PlaceAt(origin, 3_000), 0)
	requestA := viewA["requestId"].(string)
	parkDriver(t, h, driver, origin)
	bidA := fundedCurrentBid(t, h, driver, requestA, moneyMinor(t, viewA, "minimumFareMinor"))
	selectedA := doSelect(t, h, riderA, requestA, map[string]any{"bidId": bidA["bidId"], "requestVersion": 1, "bidVersion": 1}, "")
	requireStatus(t, selectedA, http.StatusAccepted)
	claimA := claimRow(t, h, awardRow(t, h, requestA).ID)
	tripA := &tripFixture{h: h, driver: driver, rideID: *claimA.ExecutionID, pin: decode(t, selectedA)["pickupPin"].(string)}

	quote := h.Do(http.MethodGet, quotePath(t, "delivery", testutil.PlaceAt(origin, 4_000), testutil.PlaceAt(origin, 9_000), nil), sender, nil)
	requireStatus(t, quote, http.StatusOK)
	amountB := moneyMinor(t, decode(t, quote), "minimumFareMinor")
	published := h.Do(http.MethodPost, "/mp/requests", sender, map[string]any{
		"quoteId":            decode(t, quote)["quoteId"],
		"requestedFareMinor": moneyBody(amountB),
		"paymentMethodId":    "wallet",
		"delivery":           map[string]any{"weightKg": 2},
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, published, http.StatusCreated)
	requestB := decode(t, published)["requestId"].(string)
	eligibility := evaluate(t, h, driver, requestB)
	if !eligibility.Eligible || eligibility.Slot == nil || *eligibility.Slot != "next" {
		t.Fatalf("fixture: the driver qualifies for the next slot: %+v", eligibility.Reasons)
	}
	queued := h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId": requestB, "requestRevision": 1, "amountMinor": moneyBody(amountB),
		"slot": "next", "dependsOnClaimId": claimA.ID.String(), "availabilityEpoch": eligibility.AvailabilityEpoch,
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, queued, http.StatusCreated)
	bidB := decode(t, queued)
	unconsented := doSelect(t, h, sender, requestB, map[string]any{"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1}, "")
	etaVersion := decode(t, unconsented)["details"].(map[string]any)["pickupWindow"].(map[string]any)["etaVersion"]
	consented := doSelect(t, h, sender, requestB, map[string]any{
		"bidId": bidB["bidId"], "requestVersion": 1, "bidVersion": 1,
		"pickupWindowConsent": map[string]any{"etaVersion": etaVersion, "accepted": true},
	}, "")
	requireStatus(t, consented, http.StatusAccepted)

	awardB := awardRow(t, h, requestB)
	delivery, ok := double.deliveryFor(awardB.ID)
	if awardB.State != machine.MpAwardConfirmed || !ok || awardB.ExecutionService != marketplace.ServiceDelivery ||
		awardB.ExecutionID == nil || awardB.ExecutionID.String() != delivery["id"] {
		t.Fatalf("the queued delivery is handed off before confirmation: %s %v", awardB.State, awardB.ExecutionID)
	}
	claimB := claimRow(t, h, awardB.ID)
	if claimB.State != machine.MpClaimNext || claimB.ExecutionID != nil {
		t.Fatalf("the claim waits in the next slot: %+v", claimB)
	}

	tripA.start(t)
	tripA.complete(t)
	promoted := claimByID(t, h, claimB.ID)
	if promoted.State != machine.MpClaimCurrent || promoted.ExecutionService != marketplace.ServiceDelivery ||
		promoted.ExecutionID == nil || promoted.ExecutionID.String() != delivery["id"] {
		t.Fatalf("the promotion couples the claim to the handed-off delivery: %+v", promoted)
	}
	if promoted.FencingToken <= claimB.FencingToken {
		t.Fatalf("the promotion bumps the fencing token: %d -> %d", claimB.FencingToken, promoted.FencingToken)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM ride.rides WHERE marketplace_award_id = $1`, awardB.ID); n != 0 {
		t.Fatalf("a promoted delivery writes no execution ride: %d", n)
	}
	if request := requestRow(t, h, requestB); request.State != machine.MpRequestExecution {
		t.Fatalf("the delivery request is executing: %s", request.State)
	}
	if calls, created, _ := double.snapshot(); calls != 1 || created != 1 {
		t.Fatalf("handed off exactly once: calls %d, created %d", calls, created)
	}
	if h.Wallet.CapturesByReservation[bidB["reservationId"].(string)] != 1 {
		t.Fatal("the promotion never charges the commission again")
	}
	promotedEvent := outboxPayload(t, h, "mp.claim.promoted", claimB.ID.String())
	if promotedEvent["executionService"] != "delivery" || promotedEvent["executionId"] != delivery["id"] || promotedEvent["rideId"] != "" {
		t.Fatalf("the promotion event names the delivery: %v", promotedEvent)
	}
}

// disableDeliveryFlag switches marketplace_delivery off for the harness city.
func disableDeliveryFlag(t *testing.T, h *testutil.Harness) {
	t.Helper()
	if _, err := h.Pool.Exec(context.Background(),
		`UPDATE public.flag_rules SET enabled = false WHERE flag_key = $1 AND city_id = $2`,
		cityconfig.FlagMarketplaceDelivery, h.CityID); err != nil {
		t.Fatal(err)
	}
}

// TestDeliveryHandOffReconcilesALostAnswerAfterTheFlagGoesOff: delivery-service
// created the delivery but its answer was lost, and marketplace_delivery is
// then switched off. The delivery may exist, so the flag no longer decides:
// the resumed saga re-sends (delivery-service's 200 replay of the ONE
// delivery) and confirms the award onto it — never compensating an award whose
// delivery is already assigned to the driver, never a second delivery, never
// a reversal of the fee the driver earned.
func TestDeliveryHandOffReconcilesALostAnswerAfterTheFlagGoesOff(t *testing.T) {
	double := newDeliveryDouble(t, deliveryTestKey)
	h := deliveryHarness(t, double, deliveryTestKey)
	rider := h.Rider()
	double.withSender(rider.UserID)
	double.inject(0, 0, 1)

	d := selectDelivery(t, h, rider)
	award := awardRow(t, h, d.requestID)
	if award.State != machine.MpAwardPending {
		t.Fatalf("fixture: the lost answer leaves the award pending: %s", award.State)
	}
	if row := handoffRow(t, h, award.ID); row.UnresolvedSends != 1 || row.State != marketplace.HandoffUnknown {
		t.Fatalf("the send that may have landed stays unresolved: %+v", row)
	}
	if _, created, _ := double.snapshot(); created != 1 {
		t.Fatalf("fixture: delivery-service committed the delivery: %d", created)
	}

	disableDeliveryFlag(t, h)
	resumeLater(t, h)

	award = awardRow(t, h, d.requestID)
	delivery, ok := double.deliveryFor(award.ID)
	if award.State != machine.MpAwardConfirmed || !ok || award.ExecutionID == nil || award.ExecutionID.String() != delivery["id"] {
		t.Fatalf("the existing delivery is reconciled, not stranded: %s (%s) %v", award.State, award.FailReason, award.ExecutionID)
	}
	if calls, created, _ := double.snapshot(); calls != 2 || created != 1 {
		t.Fatalf("one idempotent re-send, one delivery: calls %d, created %d", calls, created)
	}
	if h.Wallet.CapturesByReservation[d.reservationID] != 1 || h.Wallet.ReversalsByReservation[d.reservationID] != 0 {
		t.Fatalf("captured once, never reversed: captures %d, reversals %d",
			h.Wallet.CapturesByReservation[d.reservationID], h.Wallet.ReversalsByReservation[d.reservationID])
	}
	if _, released := h.Funding.ReleasedAwards[award.ID]; released {
		t.Fatal("the rider's funding still backs the delivery")
	}
	if row := handoffRow(t, h, award.ID); row.State != marketplace.HandoffDelivered {
		t.Fatalf("the hand-off is delivered: %+v", row)
	}
}

// TestDeliveryHandOffKeyRefusalThenFlagOffCompensates: delivery-service
// refused the key (403 — definitely nothing created), and marketplace_delivery
// is then switched off. No send is unresolved, so the flag decides again:
// nothing more is sent and the award is compensated with the fee reversed.
func TestDeliveryHandOffKeyRefusalThenFlagOffCompensates(t *testing.T) {
	double := newDeliveryDouble(t, deliveryTestKey)
	h := deliveryHarness(t, double, "a-key-delivery-service-does-not-have")
	rider := h.Rider()
	double.withSender(rider.UserID)

	d := selectDelivery(t, h, rider)
	award := awardRow(t, h, d.requestID)
	if row := handoffRow(t, h, award.ID); row.State != marketplace.HandoffBlocked || row.UnresolvedSends != 0 {
		t.Fatalf("a 403 is a definite no: nothing unresolved: %+v", row)
	}

	disableDeliveryFlag(t, h)
	resumeLater(t, h)

	award = awardRow(t, h, d.requestID)
	if award.State != machine.MpAwardCompensated || award.FailReason != "delivery_handoff_disabled" {
		t.Fatalf("with nothing possibly created, the off flag compensates: %s (%s)", award.State, award.FailReason)
	}
	if calls, created, _ := double.snapshot(); calls != 1 || created != 0 {
		t.Fatalf("nothing more is sent: calls %d, created %d", calls, created)
	}
	if h.Wallet.CapturesByReservation[d.reservationID] != 1 || h.Wallet.ReversalsByReservation[d.reservationID] != 1 {
		t.Fatalf("one capture, one linked reversal: captures %d, reversals %d",
			h.Wallet.CapturesByReservation[d.reservationID], h.Wallet.ReversalsByReservation[d.reservationID])
	}
	resumeLater(t, h)
	if calls, _, _ := double.snapshot(); calls != 1 {
		t.Fatalf("a disabled hand-off is never sent: %d calls", calls)
	}
}
