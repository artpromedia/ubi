package marketplace_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// swapHarness is the fleet harness with vehicle swaps opened
// (marketplace_booking_vehicle_swaps is deny-by-default).
func swapHarness(t *testing.T, double *fleetDouble, opts ...testutil.HarnessOption) *testutil.Harness {
	t.Helper()
	return fleetHarness(t, double, append([]testutil.HarnessOption{
		testutil.WithFlag(cityconfig.FlagMarketplaceBookingVehicleSwaps, true),
	}, opts...)...)
}

// proposeSwap is contract A route 7.
func proposeSwap(h *testutil.Harness, blockID uuid.UUID, toVehicle, key string) *httptest.ResponseRecorder {
	return fleetPost(h, "/bookings/"+blockID.String()+"/vehicle-swaps",
		map[string]any{"toVehicleId": toVehicle, "requestedByStaffId": "staff-7"}, key)
}

// proposedSwapID proposes and returns the swap id (201 required).
func proposedSwapID(t *testing.T, h *testutil.Harness, blockID uuid.UUID, toVehicle string) string {
	t.Helper()
	recorder := proposeSwap(h, blockID, toVehicle, "")
	requireStatus(t, recorder, http.StatusCreated)
	return decode(t, recorder)["swapId"].(string)
}

// driverDecides is the driver's accept/decline of a swap.
func (f *advanceFixture) driverDecides(swapID, decision, key string) *httptest.ResponseRecorder {
	if key == "" {
		key = idemKey()
	}
	return f.h.Do(http.MethodPost, f.bookingPath("/vehicle-swaps/"+swapID+"/"+decision), f.driver, nil, move.IdempotencyHeader, key)
}

// riderDecides is the rider's accept/decline of a vehicle change.
func (f *advanceFixture) riderDecides(changeID, decision, key string) *httptest.ResponseRecorder {
	if key == "" {
		key = idemKey()
	}
	return f.h.Do(http.MethodPost, f.bookingPath("/changes/"+changeID+"/"+decision), f.rider, nil, move.IdempotencyHeader, key)
}

// swapRow reads one swap.
func swapRow(t *testing.T, h *testutil.Harness, id string) *marketplace.VehicleSwap {
	t.Helper()
	swap, err := h.Marketplace.Store().SwapByID(context.Background(), h.Pool, uuid.MustParse(id))
	if err != nil {
		t.Fatal(err)
	}
	return swap
}

// repark confirms the driver parked again at the harness clock (fresh
// samples from seqBase), as a driver does after moving.
func repark(t *testing.T, h *testutil.Harness, driver testutil.Actor, seqBase int64) {
	t.Helper()
	now := h.Clock.Now()
	ingestPoints(t, h, driver, []map[string]any{
		point(seqBase, testutil.PickupFixture(), now.Add(-90*time.Second), 0),
		point(seqBase+1, testutil.PickupFixture(), now.Add(-60*time.Second), 0),
		point(seqBase+2, testutil.PickupFixture(), now.Add(-30*time.Second), 0),
		point(seqBase+3, testutil.PickupFixture(), now.Add(-time.Second), 0),
	})
	requireStatus(t, h.Do(http.MethodPost, "/mp/driver/parked", driver, nil), http.StatusOK)
}

// eventPayload reads the one outbox payload of an event on an aggregate.
func eventPayload(t *testing.T, h *testutil.Harness, name, aggregateID string) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := h.Pool.QueryRow(context.Background(), `
		SELECT payload FROM public.outbox_events WHERE name = $1 AND aggregate_id = $2`, name, aggregateID).Scan(&payload); err != nil {
		t.Fatalf("read %s for %s: %v", name, aggregateID, err)
	}
	return payload
}

// TestVehicleSwapFullLifecycle (FL-8, Q3): a fleet proposes another vehicle
// for an at-risk booking; the driver sees it and decides only while parked;
// the server revalidates the target; the RIDER consents to "different
// vehicle, same driver, fare unchanged"; applying moves vehicle_id and the
// booking's ledger row atomically, resolves the risk, keeps the fare and
// never charges the commission again.
func TestVehicleSwapFullLifecycle(t *testing.T) {
	double := newFleetDouble(t)
	h := swapHarness(t, double)
	original := fleetVehicle(h, double, "a")
	target := h.VehicleID("b")
	double.addVehicle(target, "flt_"+h.CityID, []string{"go", "comfort"}, 4, "2030-01-01", "2030-01-01")
	f := bookOnVehicle(t, h, double, original, 30*time.Hour, "wallet")
	reportOffRoad(t, h, "off-a", original)
	b := f.reload(t)
	var originalRow occupancyRow
	for _, row := range ledgerRows(t, h, original) {
		if row.Kind == "booking" {
			originalRow = row
		}
	}
	capturesBefore := h.Wallet.CaptureCalls

	key := idemKey()
	proposed := proposeSwap(h, b.BlockID, target, key)
	requireStatus(t, proposed, http.StatusCreated)
	body := decode(t, proposed)
	swapID, _ := body["swapId"].(string)
	if len(body) != 2 || swapID == "" || body["status"] != "proposed" {
		t.Fatalf("route 7 answers exactly {swapId, status: proposed}: %v", body)
	}
	replay := proposeSwap(h, b.BlockID, target, key)
	requireStatus(t, replay, http.StatusCreated)
	if replay.Body.String() != proposed.Body.String() {
		t.Fatal("a replay answers the same swap")
	}
	requireCode(t, proposeSwap(h, b.BlockID, target, ""), http.StatusUnprocessableEntity, domain.CodeSwapIneligible)
	if payload := eventPayload(t, h, "mp.vehicle_swap.proposed", swapID); payload["driverId"] != f.driver.UserID.String() ||
		payload["requesterId"] != nil {
		t.Fatalf("the proposal reaches the driver only: %v", payload)
	}

	driverView := decode(t, h.Do(http.MethodGet, f.bookingPath(""), f.driver, nil))
	offer, _ := driverView["vehicleSwap"].(map[string]any)
	if offer == nil || offer["swapId"] != swapID || offer["state"] != "proposed" ||
		offer["to"].(map[string]any)["label"] != "Comfort / Go · 4 seats" || offer["from"].(map[string]any)["label"] != "Go · 4 seats" {
		t.Fatalf("the driver sees the proposal with server-written vehicle labels: %v", driverView["vehicleSwap"])
	}
	if riderView := h.Do(http.MethodGet, f.bookingPath(""), f.rider, nil); strings.Contains(riderView.Body.String(), "pendingChange") {
		t.Fatalf("the rider is not asked before the driver accepts and the server revalidates: %s", riderView.Body.String())
	}

	// Only the booked driver, and only parked.
	requireStatus(t, h.Do(http.MethodPost, f.bookingPath("/vehicle-swaps/"+swapID+"/accept"), f.rider, nil,
		move.IdempotencyHeader, idemKey()), http.StatusForbidden)
	requireStatus(t, h.Do(http.MethodPost, f.bookingPath("/vehicle-swaps/"+swapID+"/accept"), h.Driver(), nil,
		move.IdempotencyHeader, idemKey()), http.StatusNotFound)
	h.Clock.Set(h.Clock.Now().Add(10 * time.Minute))
	requireCode(t, f.driverDecides(swapID, "accept", ""), http.StatusForbidden, domain.CodeDriverIneligible)
	if swapRow(t, h, swapID).State != machine.MpSwapProposed {
		t.Fatal("a refused (moving) decision changes nothing")
	}
	repark(t, h, f.driver, 20)

	acceptKey := idemKey()
	accepted := f.driverDecides(swapID, "accept", acceptKey)
	requireStatus(t, accepted, http.StatusOK)
	requireStatus(t, f.driverDecides(swapID, "accept", acceptKey), http.StatusOK)
	if swap := swapRow(t, h, swapID); swap.State != machine.MpSwapRiderConsent || swap.RevalidatedAt == nil {
		t.Fatalf("after the driver accepts, the server revalidates and asks the rider: %s", swap.State)
	}
	if payload := eventPayload(t, h, "mp.vehicle_swap.rider_consent_requested", swapID); payload["requesterId"] != f.rider.UserID.String() {
		t.Fatalf("the rider is asked: %v", payload)
	}

	riderView := decode(t, h.Do(http.MethodGet, f.bookingPath(""), f.rider, nil))
	change, _ := riderView["pendingChange"].(map[string]any)
	if change == nil || change["changeId"] != swapID || change["kind"] != "vehicle_swap" || change["sameDriver"] != true ||
		change["fareUnchanged"] != true || moneyMinor(t, change, "fareMinor") != f.amount ||
		change["to"].(map[string]any)["label"] != "Comfort / Go · 4 seats" ||
		!strings.Contains(change["notice"].(string), "Nothing changes unless you confirm") {
		t.Fatalf("D1: different vehicle, same driver, fare unchanged: %v", riderView["pendingChange"])
	}
	if riderView["risk"] != nil || riderView["vehicleSwap"] != nil {
		t.Fatalf("the rider sees the change to consent to, never the risk or the fleet's proposal: %v", riderView)
	}

	riderKey := idemKey()
	applied := f.riderDecides(swapID, "accept", riderKey)
	requireStatus(t, applied, http.StatusOK)
	requireStatus(t, f.riderDecides(swapID, "accept", riderKey), http.StatusOK)
	b = f.reload(t)
	if b.VehicleID == nil || *b.VehicleID != target || b.VehicleSource != marketplace.VehicleSourceSwap ||
		b.Risk != machine.MpRiskOK || b.State != machine.MpBookingConfirmed || b.FareMinor != f.amount {
		t.Fatalf("the booking moves to the new vehicle, fare unchanged, risk resolved: %+v", b)
	}
	targetRows := ledgerRows(t, h, target)
	if len(targetRows) != 1 || targetRows[0].ID != originalRow.ID || targetRows[0].State != "active" ||
		!targetRows[0].Start.Equal(b.OccupiedStart) {
		t.Fatalf("the booking's ledger row moved with it: %+v", targetRows)
	}
	for _, row := range ledgerRows(t, h, original) {
		if row.Kind == "booking" {
			t.Fatalf("the original vehicle no longer holds the booking: %+v", row)
		}
	}
	if h.Wallet.CaptureCalls != capturesBefore || h.Wallet.CapturesByReservation[f.reservationID] != 1 ||
		h.Wallet.ReversalsByReservation[f.reservationID] != 0 {
		t.Fatalf("the commission is never charged again: calls %d→%d", capturesBefore, h.Wallet.CaptureCalls)
	}
	if outboxCount(t, h, "mp.vehicle_swap.applied", swapID) != 1 ||
		outboxCount(t, h, "vehicle_occupancy.moved", originalRow.ID.String()) != 1 {
		t.Fatal("the swap and the ledger move are published once")
	}
	if swap := swapRow(t, h, swapID); swap.State != machine.MpSwapApplied || swap.AppliedAt == nil {
		t.Fatalf("swap: %s", swap.State)
	}
	blocks := rawBlocks(t, fleetGet(h, blocksQuery([]string{target}, nil, h.Clock.Now(), h.Clock.Now().Add(48*time.Hour))))
	if len(blocks) != 1 || string(blocks[0]["vehicleId"]) != `"`+target+`"` || string(blocks[0]["risk"]) != `"ok"` {
		t.Fatalf("the fleet sees the booking on the new vehicle, ok: %v", blocks)
	}
	requireCode(t, f.riderDecides(swapID, "decline", ""), http.StatusConflict, domain.CodeConflict)
}

// TestVehicleSwapIneligibleTargets: route 7 refuses 422 swap_ineligible,
// with the reasons, every target that could not carry the booking — and
// everything while the deny-by-default swap flag is off.
func TestVehicleSwapIneligibleTargets(t *testing.T) {
	double := newFleetDouble(t)
	dark := fleetHarness(t, double)
	darkVehicle := fleetVehicle(dark, double, "a")
	darkBooking := bookOnVehicle(t, dark, double, darkVehicle, 30*time.Hour, "wallet")
	requireSwapRefused(t, proposeSwap(dark, darkBooking.booking.BlockID, fleetVehicle(dark, double, "b"), ""), "swaps_not_enabled")

	h := swapHarness(t, double)
	original := fleetVehicle(h, double, "a")
	f := bookOnVehicle(t, h, double, original, 30*time.Hour, "wallet")
	b := f.booking
	fleet := "flt_" + h.CityID
	double.addVehicle(h.VehicleID("moto"), fleet, []string{"moto"}, 4, "2030-01-01", "2030-01-01")
	double.addVehicle(h.VehicleID("small"), fleet, []string{"go"}, 3, "2030-01-01", "2030-01-01")
	double.addVehicle(h.VehicleID("expired"), fleet, []string{"go"}, 4, b.WindowStart.UTC().Format("2006-01-02"), "2030-01-01")
	double.addVehicle(h.VehicleID("uninsured"), fleet, []string{"go"}, 4, "", "2030-01-01")
	double.addVehicle(h.VehicleID("elsewhere"), "flt_another_fleet", []string{"go"}, 4, "2030-01-01", "2030-01-01")
	busy := fleetVehicle(h, double, "busy")
	broken := fleetVehicle(h, double, "broken")
	requireStatus(t, fleetPost(h, "/occupancy/maintenance", blockBody("mnt-busy", busy, "repair", b.OccupiedStart, b.OccupiedEnd), ""), http.StatusCreated)
	reportOffRoad(t, h, "off-broken", broken)

	for target, reason := range map[string]string{
		h.VehicleID("ghost"):     "vehicle_unknown",
		h.VehicleID("moto"):      "class_not_eligible",
		h.VehicleID("small"):     "capacity_too_small",
		h.VehicleID("expired"):   "documents_expired",
		h.VehicleID("uninsured"): "documents_expired",
		h.VehicleID("elsewhere"): "different_fleet",
		busy:                     "vehicle_occupied",
		broken:                   "vehicle_off_road",
		original:                 "same_vehicle",
	} {
		requireSwapRefused(t, proposeSwap(h, b.BlockID, target, ""), reason)
	}
	requireStatus(t, proposeSwap(h, uuid.New(), fleetVehicle(h, double, "c"), ""), http.StatusNotFound)
	// The internal booking id is never a block id.
	requireStatus(t, proposeSwap(h, b.ID, fleetVehicle(h, double, "d"), ""), http.StatusNotFound)
	requireStatus(t, fleetPost(h, "/bookings/"+b.BlockID.String()+"/vehicle-swaps",
		map[string]any{"toVehicleId": fleetVehicle(h, double, "e")}, ""), http.StatusUnprocessableEntity)
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.booking_vehicle_swaps WHERE booking_id = $1`, b.ID); n != 0 {
		t.Fatalf("no refused proposal is recorded: %d", n)
	}
	// Same-or-higher class: a comfort-only vehicle may carry a go booking.
	double.addVehicle(h.VehicleID("comfort"), fleet, []string{"comfort"}, 4, "2030-01-01", "2030-01-01")
	requireStatus(t, proposeSwap(h, b.BlockID, h.VehicleID("comfort"), ""), http.StatusCreated)
}

func requireSwapRefused(t *testing.T, recorder *httptest.ResponseRecorder, reason string) {
	t.Helper()
	requireCode(t, recorder, http.StatusUnprocessableEntity, domain.CodeSwapIneligible)
	reasons := decode(t, recorder)["details"].(map[string]any)["reasons"].([]any)
	if !reflect.DeepEqual(reasons, []any{reason}) {
		t.Fatalf("swap_ineligible names %q: %v", reason, reasons)
	}
}

// TestVehicleSwapDeclinesAndFailuresKeepTheOriginalVehicle: a driver's
// decline, a rider's decline, a target taken before the rider consents, a
// target whose documents lapse before revalidation, fleet-service silent
// during revalidation (retried) and the booking ending mid-swap — each
// keeps the original vehicle, and a booking whose blocker remains stays at
// risk.
func TestVehicleSwapDeclinesAndFailuresKeepTheOriginalVehicle(t *testing.T) {
	double := newFleetDouble(t)
	h := swapHarness(t, double)
	original := fleetVehicle(h, double, "a")
	target := fleetVehicle(h, double, "b")
	f := bookOnVehicle(t, h, double, original, 30*time.Hour, "wallet")
	reportOffRoad(t, h, "off-a", original)
	b := f.reload(t)
	keepsOriginal := func(stage string) {
		t.Helper()
		b := f.reload(t)
		if b.VehicleID == nil || *b.VehicleID != original || b.Risk != machine.MpRiskAtRisk {
			t.Fatalf("%s: the booking keeps its vehicle and stays at risk: %+v", stage, b)
		}
		if rows := ledgerRows(t, h, target); len(rows) != 0 && rows[0].Kind == "booking" {
			t.Fatalf("%s: nothing moved to the target: %+v", stage, rows)
		}
	}

	s1 := proposedSwapID(t, h, b.BlockID, target)
	requireStatus(t, f.driverDecides(s1, "decline", ""), http.StatusOK)
	if swapRow(t, h, s1).State != machine.MpSwapDriverDeclined || outboxCount(t, h, "mp.vehicle_swap.rider_consent_requested", s1) != 0 {
		t.Fatal("a driver's decline ends the swap; the rider is never asked")
	}
	keepsOriginal("driver declined")

	s2 := proposedSwapID(t, h, b.BlockID, target)
	requireStatus(t, f.driverDecides(s2, "accept", ""), http.StatusOK)
	requireStatus(t, f.riderDecides(s2, "decline", ""), http.StatusOK)
	if swapRow(t, h, s2).State != machine.MpSwapRiderDeclined {
		t.Fatal("the rider's decline ends the swap")
	}
	if strings.Contains(h.Do(http.MethodGet, f.bookingPath(""), f.rider, nil).Body.String(), "pendingChange") {
		t.Fatal("a declined change is no longer pending")
	}
	keepsOriginal("rider declined")

	s3 := proposedSwapID(t, h, b.BlockID, target)
	requireStatus(t, f.driverDecides(s3, "accept", ""), http.StatusOK)
	requireStatus(t, fleetPost(h, "/occupancy/maintenance", blockBody("mnt-b", target, "repair", b.OccupiedStart, b.OccupiedEnd), ""), http.StatusCreated)
	taken := f.riderDecides(s3, "accept", "")
	requireCode(t, taken, http.StatusConflict, domain.CodeConflict)
	if swap := swapRow(t, h, s3); swap.State != machine.MpSwapRevalidationFailed ||
		!reflect.DeepEqual(swap.FailureReasons, []string{marketplace.SwapReasonOccupied}) {
		t.Fatalf("a target taken before consent fails the swap: %s %v", swap.State, swap.FailureReasons)
	}
	keepsOriginal("target taken")
	requireStatus(t, fleetPost(h, "/occupancy/maintenance/mnt-b/release", nil, ""), http.StatusOK)

	s4 := proposedSwapID(t, h, b.BlockID, target)
	double.setDocuments(target, b.WindowStart.UTC().Format("2006-01-02"), "2030-01-01")
	requireStatus(t, f.driverDecides(s4, "accept", ""), http.StatusOK)
	if swap := swapRow(t, h, s4); swap.State != machine.MpSwapRevalidationFailed ||
		!reflect.DeepEqual(swap.FailureReasons, []string{marketplace.SwapReasonDocuments}) ||
		outboxCount(t, h, "mp.vehicle_swap.rider_consent_requested", s4) != 0 {
		t.Fatalf("server revalidation refuses a target whose documents lapse: %s %v", swap.State, swap.FailureReasons)
	}
	keepsOriginal("revalidation failed")
	double.setDocuments(target, "2030-01-01", "2030-01-01")

	s5 := proposedSwapID(t, h, b.BlockID, target)
	double.setDown(true)
	requireStatus(t, f.driverDecides(s5, "accept", ""), http.StatusOK)
	if swap := swapRow(t, h, s5); swap.State != machine.MpSwapRevalidating || swap.NextAttemptAt == nil {
		t.Fatalf("fleet-service silent: the swap waits in revalidating for a retry: %s", swap.State)
	}
	double.setDown(false)
	h.Clock.Set(h.Clock.Now().Add(2 * time.Minute))
	sweepOnce(t, h)
	if swapRow(t, h, s5).State != machine.MpSwapRiderConsent {
		t.Fatal("the sweep retries the revalidation and asks the rider")
	}

	// The rider cancels the booking instead: free, and the swap is cancelled.
	requireStatus(t, h.Do(http.MethodPost, f.bookingPath("/cancel"), f.rider, nil, move.IdempotencyHeader, idemKey()), http.StatusOK)
	if swapRow(t, h, s5).State != machine.MpSwapCancelled || f.reload(t).State != machine.MpBookingCancelled {
		t.Fatal("cancelling the booking cancels the swap in flight")
	}
	if h.Wallet.ReversalsByReservation[f.reservationID] != 1 {
		t.Fatal("the cancellation returns the commission once")
	}
}

// TestVehicleSwapExpiresAtTheDecisionDeadline: a swap nobody finishes
// expires at the booking's decision deadline and changes nothing.
func TestVehicleSwapExpiresAtTheDecisionDeadline(t *testing.T) {
	double := newFleetDouble(t)
	h := swapHarness(t, double)
	original := fleetVehicle(h, double, "a")
	target := fleetVehicle(h, double, "b")
	f := bookOnVehicle(t, h, double, original, 30*time.Hour, "wallet")
	swapID := proposedSwapID(t, h, f.booking.BlockID, target)
	swap := swapRow(t, h, swapID)
	if !swap.ExpiresAt.Equal(f.booking.WindowStart.Add(-2 * time.Hour)) {
		t.Fatalf("a swap expires at the booking's decision deadline: %v", swap.ExpiresAt)
	}
	h.Clock.Set(swap.ExpiresAt)
	sweepOnce(t, h)
	if swapRow(t, h, swapID).State != machine.MpSwapExpired || outboxCount(t, h, "mp.vehicle_swap.expired", swapID) != 1 {
		t.Fatal("the swap expires once")
	}
	b := f.reload(t)
	if b.VehicleID == nil || *b.VehicleID != original || b.State != machine.MpBookingConfirmed || b.Risk != machine.MpRiskOK {
		t.Fatalf("an expired swap changes nothing: %+v", b)
	}
	requireCode(t, f.driverDecides(swapID, "accept", ""), http.StatusConflict, domain.CodeConflict)
}
