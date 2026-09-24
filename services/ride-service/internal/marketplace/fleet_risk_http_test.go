package marketplace_test

import (
	"context"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// setRiskLead edits the harness city's activated policy (config-service
// would publish a new version).
func setRiskLead(t *testing.T, h *testutil.Harness, seconds int) {
	t.Helper()
	if _, err := h.Pool.Exec(context.Background(), `
		UPDATE public.city_config_versions
		SET config = jsonb_set(config, '{marketplace,scheduling,advanceReservations,riskResolutionLeadSec}', to_jsonb($2::int))
		WHERE city_id = $1`, h.CityID, seconds); err != nil {
		t.Fatal(err)
	}
}

// reportOffRoad reports a vehicle off the road from now, open-ended.
func reportOffRoad(t *testing.T, h *testutil.Harness, blockID, vehicle string) {
	t.Helper()
	requireStatus(t, fleetPost(h, "/occupancy/off-road", offRoadBody(blockID, vehicle, h.Clock.Now(), nil), ""), http.StatusCreated)
}

// TestRiskDeadlineFailsTheBookingThroughTheFailurePath (item 4): an at-risk
// booking nobody resolves fails at its deadline through the EXISTING
// failure path — reason risk_unresolved, the captured commission returned
// with a linked reversal exactly once (correction 1), the rider's funding
// released, no rematch offered when too little lead time remains
// (correction 2) — and the rider is told only that the driver can't make it.
// Concurrent and repeated sweeps move nothing twice.
func TestRiskDeadlineFailsTheBookingThroughTheFailurePath(t *testing.T) {
	double := newFleetDouble(t)
	h := fleetHarness(t, double)
	vehicle := fleetVehicle(h, double, "a")
	f := bookOnVehicle(t, h, double, vehicle, 4*time.Hour, "wallet")
	if f.booking.FundingState != marketplace.BookingFundingSecured {
		t.Fatalf("fixture: the rider's funding is secured: %s", f.booking.FundingState)
	}
	reportOffRoad(t, h, "off-a", vehicle)
	b := f.reload(t)
	deadline := *b.RiskDeadline
	if !deadline.Equal(b.WindowStart.Add(-2*time.Hour)) || !deadline.Before(b.ReconfirmDeadline) {
		t.Fatalf("decisions Q4: the earlier of reconfirmation and pickup − 2 h: %v (pickup %v, reconfirm %v)",
			deadline, b.WindowStart, b.ReconfirmDeadline)
	}
	checkedWhileLive := b.NextVehicleCheckAt
	requestsBefore := riderRequests(t, h, f.rider)

	h.Clock.Set(deadline.Add(-time.Minute))
	sweepOnce(t, h)
	if b = f.reload(t); b.State != machine.MpBookingConfirmed || b.Risk != machine.MpRiskAtRisk {
		t.Fatalf("nothing lapses before the deadline: %s / %s", b.State, b.Risk)
	}

	h.Clock.Set(deadline)
	workers := []*marketplace.Service{h.Marketplace, restartedService(t, h), restartedService(t, h)}
	var wg sync.WaitGroup
	for _, worker := range workers {
		wg.Add(1)
		go func(worker *marketplace.Service) {
			defer wg.Done()
			_ = worker.Sweep(context.Background())
		}(worker)
	}
	wg.Wait()
	sweepOnce(t, h)

	b = f.reload(t)
	if b.State != machine.MpBookingFailed || b.Failure == nil || b.Failure.Reason != marketplace.BookingFailRiskUnresolved ||
		!b.Failure.CommissionReversed || !b.Failure.RiderFundingReleased || b.Failure.RematchAvailable {
		t.Fatalf("the booking fails with its explained outcome: %s %+v", b.State, b.Failure)
	}
	if b.Risk != machine.MpRiskLapsed || b.FundingState != marketplace.BookingFundingReleased {
		t.Fatalf("the risk lapsed and the funding hold was released: %s / %s", b.Risk, b.FundingState)
	}
	if checkedWhileLive == nil || b.NextVehicleCheckAt != nil {
		t.Fatalf("a booking checked while live leaves the vehicle-check schedule when it ends: %v → %v",
			checkedWhileLive, b.NextVehicleCheckAt)
	}
	if h.Wallet.ReversalsByReservation[f.reservationID] != 1 || h.Wallet.CapturesByReservation[f.reservationID] != 1 {
		t.Fatalf("the captured commission comes back exactly once, never re-charged: reversals %d captures %d",
			h.Wallet.ReversalsByReservation[f.reservationID], h.Wallet.CapturesByReservation[f.reservationID])
	}
	if _, released := h.Funding.ReleasedAwards[f.award.ID]; !released {
		t.Fatal("the rider's funding is released")
	}
	if award := awardRow(t, h, f.requestID); award.State != machine.MpAwardCancelled {
		t.Fatalf("the award is cancelled: %s", award.State)
	}
	if outboxCount(t, h, "mp.advance_booking.failed", b.ID.String()) != 1 {
		t.Fatal("the failure is published once")
	}
	// Proactively offered: with too little lead left for a rematch, the
	// refund alone — to the rider only, never republished.
	if outboxCount(t, h, "mp.advance_booking.choice_offered", b.ID.String()) != 1 {
		t.Fatal("the rider's choice is offered once, however many sweeps ran")
	}
	offer := outboxPayload(t, h, "mp.advance_booking.choice_offered", b.ID.String())
	requireChoiceOffer(t, offer, f, marketplace.BookingFailRiskUnresolved, []any{"refund"})
	if offer["sameFareMinor"] != nil || offer["rematchBy"] != nil || offer["rematchAvailable"] != false ||
		offer["refund"].(map[string]any)["riderFundingReleased"] != true {
		t.Fatalf("no rematch is offered without the lead for one; the hold was released: %v", offer)
	}
	if after := riderRequests(t, h, f.rider); after != requestsBefore || b.RematchRequestID != nil {
		t.Fatalf("nothing is republished without the rider's choice: %d requests before, %d after, rematch %v",
			requestsBefore, after, b.RematchRequestID)
	}
	for _, row := range ledgerRows(t, h, vehicle) {
		if row.Kind == "booking" && row.State != "released" {
			t.Fatalf("the failed booking frees its vehicle on the ledger: %+v", row)
		}
	}
	if blocks := rawBlocks(t, fleetGet(h, blocksQuery([]string{vehicle}, nil, h.Clock.Now().Add(-time.Hour), h.Clock.Now().Add(24*time.Hour)))); len(blocks) != 0 {
		t.Fatalf("a failed booking is no longer a block: %v", blocks)
	}

	riderView := h.Do(http.MethodGet, f.bookingPath(""), f.rider, nil)
	requireStatus(t, riderView, http.StatusOK)
	failure := decode(t, riderView)["failure"].(map[string]any)
	if failure["driverLost"] != true || failure["rematchAvailable"] != false ||
		failure["financialOutcome"].(map[string]any)["riderCharged"] != false {
		t.Fatalf("the rider sees D2 with no rematch: %v", failure)
	}
	for _, leak := range []string{"off", "vehicle", "fleet", "maintenance"} {
		if strings.Contains(strings.ToLower(failure["message"].(string)), leak) {
			t.Fatalf("the rider is not told why (%q): %q", leak, failure["message"])
		}
	}
	driverView := decode(t, h.Do(http.MethodGet, f.bookingPath(""), f.driver, nil))
	if message := driverView["failure"].(map[string]any)["message"].(string); !strings.Contains(message, "vehicle") ||
		!strings.Contains(message, "commission was returned") {
		t.Fatalf("the driver is told what happened and that the commission came back: %q", message)
	}
	requireCode(t, h.Do(http.MethodPost, f.bookingPath("/rematch"), f.rider, nil, move.IdempotencyHeader, idemKey()),
		http.StatusConflict, domain.CodeConflict)
}

// TestRiskDeadlineOffersRematchOnlyWhenTimeRemains (correction 2): with a
// market lead long enough that the deadline still leaves the minimum
// advance lead, the lapsed booking offers the rider a rematch at the same
// fare; the rider may instead "cancel and release", which closes the offer
// for good — idempotently, with an event and an audit row.
func TestRiskDeadlineOffersRematchOnlyWhenTimeRemains(t *testing.T) {
	double := newFleetDouble(t)
	h := fleetHarness(t, double)
	// A market lead equal to the minimum advance lead (3 h): the deadline
	// still leaves time for a same-fare rematch.
	setRiskLead(t, h, 10_800)
	vehicle := fleetVehicle(h, double, "a")
	other := fleetVehicle(h, double, "b")
	f := bookOnVehicle(t, h, double, vehicle, 4*time.Hour, "wallet")
	g := bookOnVehicle(t, h, double, other, 5*time.Hour, "wallet")
	reportOffRoad(t, h, "off-a", vehicle)
	reportOffRoad(t, h, "off-b", other)
	fb, gb := f.reload(t), g.reload(t)
	if !fb.RiskDeadline.Equal(fb.WindowStart.Add(-10_800 * time.Second)) {
		t.Fatalf("the deadline is the pickup minus the market's lead: %v", fb.RiskDeadline)
	}

	// Each lapses at its own deadline (the minimum advance lead still ahead).
	h.Clock.Set(*fb.RiskDeadline)
	requestsBefore := riderRequests(t, h, f.rider)
	sweepOnce(t, h)
	sweepOnce(t, h)
	if fb = f.reload(t); fb.State != machine.MpBookingFailed || !fb.Failure.RematchAvailable {
		t.Fatalf("with the minimum lead left, a rematch is offered: %+v", fb.Failure)
	}
	// The rider is OFFERED the same-fare rematch or the refund, proactively,
	// once — and nothing is republished until they choose.
	if outboxCount(t, h, "mp.advance_booking.choice_offered", fb.ID.String()) != 1 {
		t.Fatal("the choice is offered once")
	}
	offer := outboxPayload(t, h, "mp.advance_booking.choice_offered", fb.ID.String())
	requireChoiceOffer(t, offer, f, marketplace.BookingFailRiskUnresolved, []any{"rematch", "refund"})
	same := offer["sameFareMinor"].(map[string]any)
	if int64(same["amountMinor"].(float64)) != f.amount || offer["rematchAvailable"] != true ||
		!parseTime(t, offer["rematchBy"]).Equal(fb.WindowStart.Add(-10_800*time.Second)) {
		t.Fatalf("the offer names the same asked fare and until when a rematch can be asked: %v", offer)
	}
	if after := riderRequests(t, h, f.rider); after != requestsBefore || fb.RematchRequestID != nil {
		t.Fatalf("nothing is republished without the rider's choice: %d → %d", requestsBefore, after)
	}
	// Booking f: the rider rematches at the same fare.
	rematch := h.Do(http.MethodPost, f.bookingPath("/rematch"), f.rider, nil, move.IdempotencyHeader, idemKey())
	requireStatus(t, rematch, http.StatusCreated)
	if asked := moneyMinor(t, decode(t, rematch), "requestedFareMinor"); asked != f.amount {
		t.Fatalf("the rematch asks the same fare: %d vs %d", asked, f.amount)
	}
	if after := riderRequests(t, h, f.rider); after != requestsBefore+1 {
		t.Fatalf("the rider's own choice republishes exactly once: %d → %d", requestsBefore, after)
	}

	h.Clock.Set(*gb.RiskDeadline)
	sweepOnce(t, h)
	if gb = g.reload(t); gb.State != machine.MpBookingFailed || !gb.Failure.RematchAvailable {
		t.Fatalf("with the minimum lead left, a rematch is offered: %+v", gb.Failure)
	}

	// Booking g: the rider cancels and releases instead.
	key := idemKey()
	released := h.Do(http.MethodPost, g.bookingPath("/release"), g.rider, nil, move.IdempotencyHeader, key)
	requireStatus(t, released, http.StatusOK)
	view := decode(t, released)
	if failure := view["failure"].(map[string]any); view["state"] != "failed" || failure["rematchAvailable"] != false ||
		failure["released"] != true || failure["driverLost"] != true {
		t.Fatalf("release closes the rematch offer and says so: %v", view["failure"])
	}
	replay := h.Do(http.MethodPost, g.bookingPath("/release"), g.rider, nil, move.IdempotencyHeader, key)
	requireStatus(t, replay, http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, g.bookingPath("/release"), g.rider, nil, move.IdempotencyHeader, idemKey()), http.StatusOK)
	if outboxCount(t, h, "mp.advance_booking.rematch_declined", gb.ID.String()) != 1 {
		t.Fatal("the rider's choice is published once")
	}
	requireCode(t, h.Do(http.MethodPost, g.bookingPath("/rematch"), g.rider, nil, move.IdempotencyHeader, idemKey()),
		http.StatusConflict, domain.CodeConflict)
	// Only the rider, only a failed booking.
	requireStatus(t, h.Do(http.MethodPost, g.bookingPath("/release"), g.driver, nil, move.IdempotencyHeader, idemKey()), http.StatusForbidden)
	live := bookOnVehicle(t, h, double, "", 30*time.Hour, "wallet")
	requireCode(t, h.Do(http.MethodPost, live.bookingPath("/release"), live.rider, nil, move.IdempotencyHeader, idemKey()),
		http.StatusConflict, domain.CodeConflict)
	if h.Wallet.ReversalsByReservation[g.reservationID] != 1 {
		t.Fatalf("release moves no money of its own: %d reversals", h.Wallet.ReversalsByReservation[g.reservationID])
	}
}

// TestRiskFromDocumentsAndAssignmentsResolvesWhenTheBlockerClears: the
// revalidation sweep puts a booking at risk when its vehicle's insurance
// expires before the booking ends, and again when the driver's signed
// assignment stops covering it (a termination notice ending first); each
// clears on its own once fleet-service's answer is good again.
func TestRiskFromDocumentsAndAssignmentsResolvesWhenTheBlockerClears(t *testing.T) {
	double := newFleetDouble(t)
	h := fleetHarness(t, double)
	vehicle := fleetVehicle(h, double, "a")
	f := bookOnVehicle(t, h, double, vehicle, 30*time.Hour, "wallet")
	b := f.booking
	day := b.WindowStart.UTC().Format("2006-01-02")

	// Insurance expires on the booking's day (from 00:00 UTC).
	double.setDocuments(vehicle, day, "2030-01-01")
	h.Clock.Set(h.Clock.Now().Add(61 * time.Minute))
	sweepOnce(t, h)
	b = f.reload(t)
	if b.Risk != machine.MpRiskAtRisk {
		t.Fatalf("a document expiring before the booking ends puts it at risk: %s", b.Risk)
	}
	driverRisk := decode(t, h.Do(http.MethodGet, f.bookingPath(""), f.driver, nil))["risk"].(map[string]any)
	if reasons := driverRisk["reasons"].([]any); len(reasons) != 1 || reasons[0] != "document_expiry" {
		t.Fatalf("the driver sees why: %v", driverRisk)
	}
	double.setDocuments(vehicle, "2031-01-01", "2031-01-01")
	h.Clock.Set(h.Clock.Now().Add(61 * time.Minute))
	sweepOnce(t, h)
	if b = f.reload(t); b.Risk != machine.MpRiskOK {
		t.Fatalf("a renewed document resolves the risk: %s", b.Risk)
	}

	// The fleet ends the driver's assignment before the booking.
	double.endAssignments(f.driver.UserID, b.WindowStart.Add(-2*time.Hour))
	h.Clock.Set(h.Clock.Now().Add(61 * time.Minute))
	sweepOnce(t, h)
	if b = f.reload(t); b.Risk != machine.MpRiskAtRisk {
		t.Fatalf("an assignment ending before the booking puts it at risk: %s", b.Risk)
	}
	double.assign(f.driver.UserID, vehicle, h.Clock.Now().Add(-time.Hour), nil)
	h.Clock.Set(h.Clock.Now().Add(61 * time.Minute))
	sweepOnce(t, h)
	if b = f.reload(t); b.Risk != machine.MpRiskOK || b.State != machine.MpBookingConfirmed {
		t.Fatalf("a covering assignment resolves the risk: %s / %s", b.Risk, b.State)
	}
	if n := outboxCount(t, h, "mp.advance_booking.risk_changed", b.ID.String()); n != 4 {
		t.Fatalf("each change of the overlay is published once: %d", n)
	}
}

// TestDriverWithdrawalResolvesTheRisk: the driver may withdraw from an
// at-risk booking; it fails through the existing path (commission returned,
// funding released, a rematch offered with enough lead) and the overlay
// resolves rather than lapsing.
func TestDriverWithdrawalResolvesTheRisk(t *testing.T) {
	double := newFleetDouble(t)
	h := fleetHarness(t, double)
	vehicle := fleetVehicle(h, double, "a")
	f := bookOnVehicle(t, h, double, vehicle, 30*time.Hour, "wallet")
	reportOffRoad(t, h, "off-a", vehicle)
	withdraw := h.Do(http.MethodPost, f.bookingPath("/withdraw"), f.driver,
		map[string]any{"reason": "my vehicle broke down"}, move.IdempotencyHeader, idemKey())
	requireStatus(t, withdraw, http.StatusOK)
	b := f.reload(t)
	if b.State != machine.MpBookingFailed || b.Failure.Reason != marketplace.BookingFailDriverWithdrew ||
		!b.Failure.RematchAvailable || b.Risk != machine.MpRiskOK {
		t.Fatalf("withdrawal ends the booking and resolves the risk: %s %+v %s", b.State, b.Failure, b.Risk)
	}
	if h.Wallet.ReversalsByReservation[f.reservationID] != 1 {
		t.Fatal("the commission is returned once")
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.booking_risk_blockers WHERE booking_id = $1 AND state = 'open'`, b.ID); n != 0 {
		t.Fatalf("no blocker stays open on an ended booking: %d", n)
	}
	riderFailure := decode(t, h.Do(http.MethodGet, f.bookingPath(""), f.rider, nil))["failure"].(map[string]any)
	if riderFailure["driverLost"] != true || riderFailure["rematchAvailable"] != true {
		t.Fatalf("the rider sees D2 with a same-fare rematch: %v", riderFailure)
	}
}

// riderRequests counts every marketplace request a rider has (a rematch is
// a new one).
func riderRequests(t *testing.T, h *testutil.Harness, rider testutil.Actor) int {
	t.Helper()
	return countRows(t, h, `SELECT COUNT(*) FROM mp.requests WHERE requester_id = $1`, rider.UserID)
}

// requireChoiceOffer checks the rider-only shape of an
// mp.advance_booking.choice_offered payload: the requester named, never the
// driver, no location, no commission — and the options offered.
func requireChoiceOffer(t *testing.T, offer map[string]any, f *advanceFixture, reason string, options []any) {
	t.Helper()
	if offer["requesterId"] != f.rider.UserID.String() || offer["reason"] != reason ||
		!reflect.DeepEqual(offer["options"], options) || !reflect.DeepEqual(offer["audience"], []any{"rider"}) {
		t.Fatalf("the offer is the rider's, with the options %v: %v", options, offer)
	}
	for _, leak := range []string{"driverId", "commissionMinor", "pickup", "dropoff", "lat", "lng", "vehicleId"} {
		if _, present := offer[leak]; present {
			t.Fatalf("the rider's offer never carries %q: %v", leak, offer)
		}
	}
	if refund := offer["refund"].(map[string]any); refund["riderCharged"] != false {
		t.Fatalf("nothing is charged to the rider: %v", refund)
	}
}
