package marketplace_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// offRoadFlag is one mp.offroad_use_flags row.
type offRoadFlag struct {
	DriverID   uuid.UUID
	VehicleID  string
	Trigger    string
	SubjectRef string
}

// offRoadFlags reads every flag recorded for a vehicle.
func offRoadFlags(t *testing.T, h *testutil.Harness, vehicleID string) []offRoadFlag {
	t.Helper()
	rows, err := h.Pool.Query(context.Background(), `
		SELECT driver_id, vehicle_id, trigger, subject_ref FROM mp.offroad_use_flags
		WHERE vehicle_id = $1 ORDER BY created_at, id`, vehicleID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []offRoadFlag
	for rows.Next() {
		var flag offRoadFlag
		if err := rows.Scan(&flag.DriverID, &flag.VehicleID, &flag.Trigger, &flag.SubjectRef); err != nil {
			t.Fatal(err)
		}
		out = append(out, flag)
	}
	return out
}

// goOffline takes a driver offline.
func goOffline(t *testing.T, h *testutil.Harness, driver testutil.Actor) {
	t.Helper()
	requireStatus(t, h.Do(http.MethodPost, "/drivers/me/status", driver, map[string]any{"online": false}), http.StatusOK)
}

// offRoadReportID is the ledger id of a fleet's off-road block.
func offRoadReportID(t *testing.T, h *testutil.Harness, blockID string) string {
	t.Helper()
	var id string
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT id::text FROM mp.vehicle_occupancy WHERE kind = 'off_road' AND source_id = $1`, blockID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// TestOffRoadVehicleGoingOnlineIsFlagged (correction 4): every off-road
// report is audited, and a vehicle reported off-road whose driver goes
// online during the claimed breakdown is flagged to UBI ops — recorded once
// per occurrence, with an ops event and an audit row, never silently
// ignored. With no vehicle off-road anywhere the check costs no call.
func TestOffRoadVehicleGoingOnlineIsFlagged(t *testing.T) {
	double := newFleetDouble(t)
	h := fleetHarness(t, double)
	vehicle := fleetVehicle(h, double, "a")
	healthy := fleetVehicle(h, double, "b")
	driver, other := h.Driver(), h.Driver()
	double.assign(driver.UserID, vehicle, h.Clock.Now().Add(-24*time.Hour), nil)
	double.assign(other.UserID, healthy, h.Clock.Now().Add(-24*time.Hour), nil)

	// Nothing off-road: going online asks fleet-service nothing.
	goOnline(t, h, other)
	goOffline(t, h, other)
	if calls := double.callCount("vehicle-at"); calls != 0 {
		t.Fatalf("no vehicle is off-road, so no check is made: %d calls", calls)
	}

	reportOffRoad(t, h, "off-a", vehicle)
	reportID := offRoadReportID(t, h, "off-a")
	if n := countRows(t, h, `SELECT COUNT(*) FROM public.audit_log WHERE action = 'vehicle_occupancy.recorded' AND subject_id = $1`, reportID); n != 1 {
		t.Fatalf("the off-road report itself is audited: %d", n)
	}

	goOnline(t, h, driver)
	flags := offRoadFlags(t, h, vehicle)
	if len(flags) != 1 || flags[0].DriverID != driver.UserID || flags[0].Trigger != "driver_online" ||
		!strings.HasPrefix(flags[0].SubjectRef, "online:") {
		t.Fatalf("the vehicle going online during its breakdown is flagged: %+v", flags)
	}
	payload := eventPayload(t, h, "vehicle_occupancy.offroad_use_flagged", reportID)
	if payload["driverId"] != driver.UserID.String() || payload["vehicleId"] != vehicle || payload["trigger"] != "driver_online" ||
		payload["blockId"] != "off-a" {
		t.Fatalf("UBI ops gets the flag: %v", payload)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM public.audit_log WHERE action = 'vehicle_occupancy.offroad_use_flagged' AND subject_id = $1`, reportID); n != 1 {
		t.Fatalf("the flag is audited: %d", n)
	}
	// Re-asserting online (no transition) is not a new occurrence; going
	// offline and online again is.
	goOnline(t, h, driver)
	if n := len(offRoadFlags(t, h, vehicle)); n != 1 {
		t.Fatalf("no transition, no new flag: %d", n)
	}
	goOffline(t, h, driver)
	h.Clock.Set(h.Clock.Now().Add(time.Minute))
	goOnline(t, h, driver)
	if n := len(offRoadFlags(t, h, vehicle)); n != 2 {
		t.Fatalf("each go-online during the breakdown is flagged: %d", n)
	}
	// A driver on a healthy vehicle is never flagged.
	goOnline(t, h, other)
	if n := len(offRoadFlags(t, h, healthy)); n != 0 {
		t.Fatalf("a healthy vehicle is not flagged: %d", n)
	}
	// Once the fleet releases the report, going online is fine.
	requireStatus(t, fleetPost(h, "/occupancy/maintenance/off-a/release", nil, ""), http.StatusOK)
	goOffline(t, h, driver)
	h.Clock.Set(h.Clock.Now().Add(time.Minute))
	goOnline(t, h, driver)
	if n := len(offRoadFlags(t, h, vehicle)); n != 2 {
		t.Fatalf("no flag after the breakdown is released: %d", n)
	}
}

// TestOffRoadVehicleStartingATripIsFlagged: a live trip starting on a
// vehicle reported off-road is flagged, once.
func TestOffRoadVehicleStartingATripIsFlagged(t *testing.T) {
	double := newFleetDouble(t)
	h := fleetHarness(t, double)
	vehicle := fleetVehicle(h, double, "a")
	trip := awardedTripFor(t, h, h.Rider(), nil)
	double.assign(trip.driver.UserID, vehicle, h.Clock.Now().Add(-24*time.Hour), nil)
	reportOffRoad(t, h, "off-a", vehicle)
	flagsBefore := len(offRoadFlags(t, h, vehicle))
	trip.start(t)
	flags := offRoadFlags(t, h, vehicle)
	if len(flags) != flagsBefore+1 {
		t.Fatalf("the trip start is flagged: %+v", flags)
	}
	last := flags[len(flags)-1]
	if last.Trigger != "trip_started" || last.SubjectRef != "ride:"+trip.rideID.String() || last.DriverID != trip.driver.UserID {
		t.Fatalf("flagged as this trip's start: %+v", last)
	}
}

// TestOffRoadUseBackstopFlagsAnActivatedBooking: the sweep is the durable
// backstop for the post-commit checks — a booking whose trip entered the
// live slots on a vehicle reported off-road is flagged, once, however often
// the sweep runs; activated bookings are never put at risk (a current
// passenger is never diverted) and show to the fleet as on_trip.
func TestOffRoadUseBackstopFlagsAnActivatedBooking(t *testing.T) {
	double := newFleetDouble(t)
	h := fleetHarness(t, double)
	vehicle := fleetVehicle(h, double, "a")
	f := bookOnVehicle(t, h, double, vehicle, 4*time.Hour, "wallet")
	f.reconfirm(t)
	h.Clock.Set(f.booking.ActivationAt.Add(time.Minute))
	sweepOnce(t, h)
	if b := f.reload(t); b.State != machine.MpBookingActivated {
		t.Fatalf("fixture: the booking activates: %s (%s)", b.State, b.LastError)
	}
	blocks := rawBlocks(t, fleetGet(h, blocksQuery([]string{vehicle}, nil, h.Clock.Now(), h.Clock.Now().Add(6*time.Hour))))
	if len(blocks) != 1 || string(blocks[0]["kind"]) != `"on_trip"` {
		t.Fatalf("an activated booking is on_trip to the fleet: %v", blocks)
	}

	report := fleetPost(h, "/occupancy/off-road", offRoadBody("off-a", vehicle, h.Clock.Now(), nil), "")
	requireStatus(t, report, http.StatusCreated)
	if n := len(decode(t, report)["atRiskBookings"].([]any)); n != 0 {
		t.Fatalf("a trip already under way is never put at risk: %d", n)
	}
	sweepOnce(t, h)
	sweepOnce(t, h)
	flags := offRoadFlags(t, h, vehicle)
	if len(flags) != 1 || flags[0].Trigger != "trip_started" || flags[0].SubjectRef != "booking:"+f.booking.ID.String() ||
		flags[0].DriverID != f.driver.UserID {
		t.Fatalf("the booking's trip on an off-road vehicle is flagged once: %+v", flags)
	}
}
