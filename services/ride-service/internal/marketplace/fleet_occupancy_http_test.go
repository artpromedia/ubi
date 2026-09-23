package marketplace_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
)

// requireExclusion fails unless err is the shared ledger's exclusion
// constraint refusing a row.
func requireExclusion(t *testing.T, err error) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23P01" || pgErr.ConstraintName != "vehicle_occupancy_no_overlap" {
		t.Fatalf("the vehicle occupancy exclusion constraint must refuse this row, got %v", err)
	}
}

// TestFleetOccupancyLedgerExcludesMaintenanceOverABooking (FL-2, FL-4,
// correction 3): an advance booking on a fleet vehicle writes its row on the
// shared occupancy ledger in its own transaction; planned maintenance over
// it is previewed as infeasible (with the opaque block and the next free
// window), refused 409 occupancy_conflict by the service AND by the database
// constraint, recorded in the free window idempotently, and released
// idempotently.
func TestFleetOccupancyLedgerExcludesMaintenanceOverABooking(t *testing.T) {
	double := newFleetDouble(t)
	h := fleetHarness(t, double)
	vehicle := fleetVehicle(h, double, "a")
	f := bookOnVehicle(t, h, double, vehicle, 4*time.Hour, "wallet")
	b := f.booking

	if b.VehicleID == nil || *b.VehicleID != vehicle || b.VehicleResolution != marketplace.VehicleResolutionResolved ||
		b.VehicleSource != marketplace.VehicleSourceFleetAssignment || b.VehicleCapacity == nil || *b.VehicleCapacity != 4 {
		t.Fatalf("the advance award records the driver's fleet vehicle: %+v", b)
	}
	rows := ledgerRows(t, h, vehicle)
	if len(rows) != 1 || rows[0].Kind != "booking" || rows[0].SourceID != b.ID.String() || rows[0].State != "active" ||
		!rows[0].Start.Equal(b.OccupiedStart) || rows[0].End == nil || !rows[0].End.Equal(b.OccupiedEnd) {
		t.Fatalf("the booking's ledger row carries its buffered interval: %+v", rows)
	}
	if outboxCount(t, h, "vehicle_occupancy.recorded", rows[0].ID.String()) != 1 {
		t.Fatal("the booking's ledger row is published once")
	}

	// Preview over the booking: infeasible, the opaque block, the next window.
	overlapStart, overlapEnd := b.OccupiedStart.Add(5*time.Minute), b.OccupiedStart.Add(65*time.Minute)
	preview := fleetPost(h, "/occupancy/maintenance:preview", windowBody(vehicle, "planned_service", overlapStart, overlapEnd), "")
	requireStatus(t, preview, http.StatusOK)
	var previewBody map[string]json.RawMessage
	if err := json.Unmarshal(preview.Body.Bytes(), &previewBody); err != nil {
		t.Fatal(err)
	}
	var feasible bool
	_ = json.Unmarshal(previewBody["feasible"], &feasible)
	var affected []map[string]json.RawMessage
	_ = json.Unmarshal(previewBody["affectedBlocks"], &affected)
	if feasible || len(affected) != 1 {
		t.Fatalf("maintenance over a booking is infeasible and names it: %s", preview.Body.String())
	}
	requireOpaqueBlock(t, affected[0], f)
	var next struct {
		StartsAt time.Time `json:"startsAt"`
		EndsAt   time.Time `json:"endsAt"`
	}
	if err := json.Unmarshal(previewBody["nextFeasibleWindow"], &next); err != nil {
		t.Fatalf("an infeasible preview suggests the next free window: %s", preview.Body.String())
	}
	if !next.StartsAt.Equal(b.OccupiedEnd) || !next.EndsAt.Equal(b.OccupiedEnd.Add(time.Hour)) {
		t.Fatalf("the next window starts when the booking (buffers included) ends: %v – %v", next.StartsAt, next.EndsAt)
	}

	// Confirming it anyway is refused, with the blocks in the way.
	refused := fleetPost(h, "/occupancy/maintenance", blockBody("mnt-a", vehicle, "planned_service", overlapStart, overlapEnd), "")
	requireCode(t, refused, http.StatusConflict, domain.CodeOccupancyConflict)
	details := decode(t, refused)["details"].(map[string]any)
	if blocks := details["affectedBlocks"].([]any); len(blocks) != 1 || blocks[0].(map[string]any)["blockId"] != b.BlockID.String() {
		t.Fatalf("the 409 names the opaque block in the way: %v", details)
	}
	if n := len(ledgerRows(t, h, vehicle)); n != 1 {
		t.Fatalf("a refused block writes nothing: %d rows", n)
	}
	// The database refuses it too, whatever a caller does.
	_, err := h.Pool.Exec(context.Background(), `
		INSERT INTO mp.vehicle_occupancy (id, kind, source_id, vehicle_id, occupied, maintenance_kind)
		VALUES (gen_random_uuid(), 'maintenance', 'raw-maintenance', $1, tstzrange($2, $3, '[)'), 'repair')`,
		vehicle, overlapStart, overlapEnd)
	requireExclusion(t, err)

	// In the free window it is recorded; a replay answers the same; the key
	// with another body is idempotency_conflict.
	key := idemKey()
	created := fleetPost(h, "/occupancy/maintenance", blockBody("mnt-a", vehicle, "planned_service", next.StartsAt, next.EndsAt), key)
	requireStatus(t, created, http.StatusCreated)
	occupancyID := decode(t, created)["occupancyId"].(string)
	replayed := fleetPost(h, "/occupancy/maintenance", blockBody("mnt-a", vehicle, "planned_service", next.StartsAt, next.EndsAt), key)
	requireStatus(t, replayed, http.StatusCreated)
	if decode(t, replayed)["occupancyId"] != occupancyID {
		t.Fatalf("a replay answers the same occupancy: %s", replayed.Body.String())
	}
	reused := fleetPost(h, "/occupancy/maintenance", blockBody("mnt-a", vehicle, "inspection", next.StartsAt, next.EndsAt), key)
	requireCode(t, reused, http.StatusConflict, domain.CodeIdempotencyConflict)
	if outboxCount(t, h, "vehicle_occupancy.recorded", occupancyID) != 1 {
		t.Fatal("the maintenance block is recorded and published once")
	}
	// A booking row can no longer take that window on the vehicle.
	_, err = h.Pool.Exec(context.Background(), `
		INSERT INTO mp.vehicle_occupancy (id, kind, source_id, vehicle_id, driver_id, occupied)
		VALUES (gen_random_uuid(), 'booking', gen_random_uuid()::text, $1, gen_random_uuid(), tstzrange($2, $3, '[)'))`,
		vehicle, next.StartsAt.Add(10*time.Minute), next.StartsAt.Add(20*time.Minute))
	requireExclusion(t, err)

	// Release is idempotent: a replay, a new key and an unknown block all
	// answer {released: true}; the row is released once.
	releaseKey := idemKey()
	for _, call := range []struct{ path, key string }{
		{"/occupancy/maintenance/mnt-a/release", releaseKey},
		{"/occupancy/maintenance/mnt-a/release", releaseKey},
		{"/occupancy/maintenance/mnt-a/release", ""},
		{"/occupancy/maintenance/mnt-never-recorded/release", ""},
	} {
		released := fleetPost(h, call.path, nil, call.key)
		requireStatus(t, released, http.StatusOK)
		if body := decode(t, released); len(body) != 1 || body["released"] != true {
			t.Fatalf("release answers exactly {released: true}: %v", body)
		}
	}
	if outboxCount(t, h, "vehicle_occupancy.released", occupancyID) != 1 {
		t.Fatal("the release is published once")
	}
	for _, row := range ledgerRows(t, h, vehicle) {
		if row.Kind == "maintenance" && row.State != "released" {
			t.Fatalf("the maintenance row is released: %+v", row)
		}
	}
	free := fleetPost(h, "/occupancy/maintenance:preview", windowBody(vehicle, "repair", next.StartsAt, next.EndsAt), "")
	requireStatus(t, free, http.StatusOK)
	if body := decode(t, free); body["feasible"] != true || body["nextFeasibleWindow"] != nil || len(body["affectedBlocks"].([]any)) != 0 {
		t.Fatalf("a released block frees its window: %v", body)
	}

	// Contract validation: a preview takes no blockId; unknown kinds and
	// unknown keys are refused.
	requireStatus(t, fleetPost(h, "/occupancy/maintenance:preview",
		blockBody("x", vehicle, "planned_service", next.StartsAt, next.EndsAt), ""), http.StatusUnprocessableEntity)
	requireStatus(t, fleetPost(h, "/occupancy/maintenance",
		blockBody("x", vehicle, "car_wash", next.StartsAt, next.EndsAt), ""), http.StatusUnprocessableEntity)
	extra := blockBody("x", vehicle, "repair", next.StartsAt, next.EndsAt)
	extra["riderId"] = f.rider.UserID.String()
	requireStatus(t, fleetPost(h, "/occupancy/maintenance", extra, ""), http.StatusUnprocessableEntity)
}

// TestFleetOffRoadIsNeverRefusedAndPutsBookingsAtRisk (A1, correction 4):
// an off-road report on a vehicle with a confirmed booking is recorded
// (outside the exclusion constraint) and moves the booking to at_risk with
// its decision deadline — the earlier of the reconfirmation deadline and
// activation minus the market's 30-minute lead. The driver is told why; the
// rider is not. Releasing the report resolves the risk.
func TestFleetOffRoadIsNeverRefusedAndPutsBookingsAtRisk(t *testing.T) {
	double := newFleetDouble(t)
	h := fleetHarness(t, double)
	vehicle := fleetVehicle(h, double, "a")
	f := bookOnVehicle(t, h, double, vehicle, 4*time.Hour, "wallet")
	b := f.booking
	if b.State != machine.MpBookingConfirmed || b.Risk != machine.MpRiskOK {
		t.Fatalf("a fresh booking is confirmed and ok: %s / %s", b.State, b.Risk)
	}
	wantDeadline := b.ActivationAt.Add(-30 * time.Minute)
	if !wantDeadline.Before(b.ReconfirmDeadline) {
		t.Fatalf("fixture: activation − 30 min is the earlier candidate here")
	}

	start := h.Clock.Now()
	key := idemKey()
	report := fleetPost(h, "/occupancy/off-road", offRoadBody("off-a", vehicle, start, nil), key)
	requireStatus(t, report, http.StatusCreated)
	recorded := decode(t, report)
	atRisk := recorded["atRiskBookings"].([]any)
	if len(atRisk) != 1 {
		t.Fatalf("the overlapping booking is at risk: %v", recorded)
	}
	entry := atRisk[0].(map[string]any)
	if len(entry) != 2 || entry["blockId"] != b.BlockID.String() || !parseTime(t, entry["decisionDeadline"]).Equal(wantDeadline) {
		t.Fatalf("at-risk entries are {blockId, decisionDeadline} with the policy deadline: %v", entry)
	}
	replay := fleetPost(h, "/occupancy/off-road", offRoadBody("off-a", vehicle, start, nil), key)
	requireStatus(t, replay, http.StatusCreated)
	if replay.Body.String() != report.Body.String() {
		t.Fatalf("a replay answers the same: %s vs %s", replay.Body.String(), report.Body.String())
	}
	again := fleetPost(h, "/occupancy/off-road", offRoadBody("off-a", vehicle, start, nil), "")
	requireStatus(t, again, http.StatusCreated)
	if decode(t, again)["occupancyId"] != recorded["occupancyId"] {
		t.Fatal("the same block reported again is the same occupancy")
	}

	rows := ledgerRows(t, h, vehicle)
	kinds := []string{}
	for _, row := range rows {
		if row.State == "active" {
			kinds = append(kinds, row.Kind)
		}
	}
	sort.Strings(kinds)
	if strings.Join(kinds, ",") != "booking,off_road" {
		t.Fatalf("the off-road row sits beside the booking (outside the constraint): %v", kinds)
	}
	b = f.reload(t)
	if b.State != machine.MpBookingConfirmed || b.Risk != machine.MpRiskAtRisk || b.RiskDeadline == nil || !b.RiskDeadline.Equal(wantDeadline) {
		t.Fatalf("off-road never cancels: the booking is confirmed and at risk until %v: %s / %s / %v", wantDeadline, b.State, b.Risk, b.RiskDeadline)
	}
	if outboxCount(t, h, "mp.advance_booking.risk_changed", b.ID.String()) != 1 {
		t.Fatal("the driver is alerted once")
	}
	var payload map[string]any
	if err := h.Pool.QueryRow(context.Background(), `
		SELECT payload FROM public.outbox_events WHERE name = 'mp.advance_booking.risk_changed' AND aggregate_id = $1`,
		b.ID.String()).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	if payload["driverId"] != f.driver.UserID.String() || payload["requesterId"] != nil {
		t.Fatalf("the risk alert reaches the driver only: %v", payload)
	}

	blocks := rawBlocks(t, fleetGet(h, blocksQuery([]string{vehicle}, nil, start, start.Add(24*time.Hour))))
	if len(blocks) != 1 || string(blocks[0]["risk"]) != `"at_risk"` {
		t.Fatalf("the fleet sees the server's risk flag: %v", blocks)
	}
	requireOpaqueBlock(t, blocks[0], f)

	driverView := decode(t, h.Do(http.MethodGet, f.bookingPath(""), f.driver, nil))
	risk, _ := driverView["risk"].(map[string]any)
	if risk == nil || risk["state"] != "at_risk" || !reflect.DeepEqual(risk["reasons"], []any{"off_road"}) ||
		!parseTime(t, risk["decisionDeadline"]).Equal(wantDeadline) {
		t.Fatalf("the driver sees the risk, its reason and the deadline: %v", driverView["risk"])
	}
	riderView := h.Do(http.MethodGet, f.bookingPath(""), f.rider, nil)
	if strings.Contains(riderView.Body.String(), `"risk"`) || strings.Contains(riderView.Body.String(), "off_road") ||
		strings.Contains(riderView.Body.String(), "off the road") {
		t.Fatalf("the rider is never told why a booking is at risk: %s", riderView.Body.String())
	}

	// A report that ends before the booking puts nothing at risk.
	earlyEnd := start.Add(time.Hour)
	early := fleetPost(h, "/occupancy/off-road", offRoadBody("off-early", vehicle, start, &earlyEnd), "")
	requireStatus(t, early, http.StatusCreated)
	if n := len(decode(t, early)["atRiskBookings"].([]any)); n != 0 {
		t.Fatalf("a breakdown over before the booking puts nothing at risk: %d", n)
	}

	// The fleet releases the report: the blocker clears and the booking is ok.
	requireStatus(t, fleetPost(h, "/occupancy/maintenance/off-a/release", nil, ""), http.StatusOK)
	b = f.reload(t)
	if b.Risk != machine.MpRiskOK || b.RiskDeadline != nil || b.State != machine.MpBookingConfirmed {
		t.Fatalf("releasing the off-road report resolves the risk: %s %v", b.Risk, b.RiskDeadline)
	}
	if outboxCount(t, h, "mp.advance_booking.risk_changed", b.ID.String()) != 2 {
		t.Fatal("the driver hears the risk resolved")
	}
}

// TestOccupiedBlockProjectionIsExactlyTheContractFields (FL-6, Q1): route 5
// answers each booking as an OccupiedBlock carrying EXACTLY the contract's
// fields — time with buffers, the server's risk flag and deadline — and no
// rider, location, fare, request or booking internals, not even as null. The
// Go type's JSON keys are held to the contract text too.
func TestOccupiedBlockProjectionIsExactlyTheContractFields(t *testing.T) {
	var zero marketplace.OccupiedBlock
	encoded, _ := json.Marshal(zero)
	var keys map[string]json.RawMessage
	_ = json.Unmarshal(encoded, &keys)
	goKeys := make([]string, 0, len(keys))
	for key := range keys {
		goKeys = append(goKeys, key)
	}
	sort.Strings(goKeys)
	if want := contractBlockFields(t); !reflect.DeepEqual(goKeys, want) {
		t.Fatalf("the Go OccupiedBlock marshals %v; the contract allows exactly %v", goKeys, want)
	}

	double := newFleetDouble(t)
	h := fleetHarness(t, double)
	vehicle := fleetVehicle(h, double, "a")
	f := bookOnVehicle(t, h, double, vehicle, 4*time.Hour, "wallet")
	b := f.booking
	from, to := h.Clock.Now(), h.Clock.Now().Add(48*time.Hour)

	for _, path := range []string{
		blocksQuery([]string{vehicle}, nil, from, to),
		blocksQuery(nil, []string{f.driver.UserID.String()}, from, to),
		blocksQuery([]string{vehicle, h.VehicleID("other")}, []string{f.driver.UserID.String()}, from, to),
	} {
		blocks := rawBlocks(t, fleetGet(h, path))
		if len(blocks) != 1 {
			t.Fatalf("%s: one block for the one booking, got %d", path, len(blocks))
		}
		block := blocks[0]
		requireOpaqueBlock(t, block, f)
		var parsed marketplace.OccupiedBlock
		raw, _ := json.Marshal(block)
		_ = json.Unmarshal(raw, &parsed)
		if parsed.BlockID != b.BlockID.String() || parsed.BlockID == b.ID.String() || parsed.DriverID != f.driver.UserID.String() ||
			parsed.VehicleID == nil || *parsed.VehicleID != vehicle || !parsed.StartsAt.Equal(b.OccupiedStart) ||
			!parsed.EndsAt.Equal(b.OccupiedEnd) || parsed.Kind != "booked" || parsed.Risk != "ok" ||
			string(block["decisionDeadline"]) != "null" {
			t.Fatalf("the block is the booking's opaque, buffered time: %s", raw)
		}
	}
	// Outside the window, and for other vehicles, there is nothing.
	if blocks := rawBlocks(t, fleetGet(h, blocksQuery([]string{vehicle}, nil, to, to.Add(time.Hour)))); len(blocks) != 0 {
		t.Fatalf("nothing outside the window: %v", blocks)
	}
	if blocks := rawBlocks(t, fleetGet(h, blocksQuery([]string{h.VehicleID("other")}, nil, from, to))); len(blocks) != 0 {
		t.Fatalf("nothing for another vehicle: %v", blocks)
	}
	// A booking with no vehicle still shows, by driver, with vehicleId null
	// (present, never omitted).
	g := bookOnVehicle(t, h, double, "", 30*time.Hour, "wallet")
	blocks := rawBlocks(t, fleetGet(h, blocksQuery(nil, []string{g.driver.UserID.String()}, from, to.Add(48*time.Hour))))
	if len(blocks) != 1 || string(blocks[0]["vehicleId"]) != "null" {
		t.Fatalf("a booking without a vehicle is a block with vehicleId null: %v", blocks)
	}
	requireOpaqueBlock(t, blocks[0], g)

	// Query validation.
	requireStatus(t, fleetGet(h, "/occupancy/blocks?from="+from.Format(time.RFC3339)+"&to="+to.Format(time.RFC3339)), http.StatusUnprocessableEntity)
	requireStatus(t, fleetGet(h, blocksQuery([]string{vehicle}, nil, to, from)), http.StatusUnprocessableEntity)
	requireStatus(t, fleetGet(h, blocksQuery(nil, []string{"not-a-driver"}, from, to)), http.StatusUnprocessableEntity)

	// Route 6: the driver-entitled calendar entries, the driver's own view.
	calendar := fleetGet(h, "/drivers/"+f.driver.UserID.String()+"/calendar?from="+from.Format(time.RFC3339)+"&to="+to.Format(time.RFC3339))
	requireStatus(t, calendar, http.StatusOK)
	entries := decode(t, calendar)["bookings"].([]any)
	if len(entries) != 1 {
		t.Fatalf("the driver's calendar entries: %v", entries)
	}
	entry := entries[0].(map[string]any)
	if entry["bookingId"] != b.ID.String() || entry["viewer"] != "driver" || entry["commissionMinor"] == nil ||
		entry["vehicle"] == nil {
		t.Fatalf("route 6 answers MpDriverCalendar's driver-view bookings: %v", entry)
	}
	empty := fleetGet(h, "/drivers/"+f.driver.UserID.String()+"/calendar?from="+to.Format(time.RFC3339)+"&to="+to.Add(time.Hour).Format(time.RFC3339))
	requireStatus(t, empty, http.StatusOK)
	if n := len(decode(t, empty)["bookings"].([]any)); n != 0 {
		t.Fatalf("route 6 honours its window: %d", n)
	}
}
