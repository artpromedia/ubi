package marketplace_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/handler"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// TestFleetInternalAuthFailsClosed: contract A takes X-Service-Key against
// FLEET_RIDE_SERVICE_KEY only — a missing or wrong key is 401 and writes
// nothing, the gateway's identity headers authenticate nobody here, the
// routes are not served on the /v1 router at all, and an unset or short
// configured key refuses everyone. Outbound, the fleet-service client never
// calls with an unusable FLEET_SERVICE_KEY.
func TestFleetInternalAuthFailsClosed(t *testing.T) {
	double := newFleetDouble(t)
	h := fleetHarness(t, double)
	vehicle := fleetVehicle(h, double, "a")
	now := h.Clock.Now()
	blocks := blocksQuery([]string{vehicle}, nil, now, now.Add(time.Hour))
	maintenance := blockBody("mnt-auth", vehicle, "repair", now.Add(time.Hour), now.Add(2*time.Hour))

	requireCode(t, h.DoInternal(http.MethodGet, blocks, "", nil), http.StatusUnauthorized, domain.CodeUnauthorized)
	requireCode(t, h.DoInternal(http.MethodGet, blocks, "the-wrong-key-but-long-enough-0123456789", nil),
		http.StatusUnauthorized, domain.CodeUnauthorized)
	requireCode(t, h.DoInternal(http.MethodPost, "/occupancy/maintenance", h.FleetRideServiceKey[:len(h.FleetRideServiceKey)-1], maintenance,
		"Idempotency-Key", idemKey()), http.StatusUnauthorized, domain.CodeUnauthorized)
	// The gateway's identity headers are not a service key.
	driver := h.Driver()
	requireCode(t, h.DoInternal(http.MethodPost, "/occupancy/maintenance", "", maintenance,
		"Idempotency-Key", idemKey(), handler.HeaderUserID, driver.UserID.String(), handler.HeaderUserRole, driver.Role),
		http.StatusUnauthorized, domain.CodeUnauthorized)
	if rows := ledgerRows(t, h, vehicle); len(rows) != 0 {
		t.Fatalf("an unauthenticated call wrote %d ledger rows", len(rows))
	}
	requireStatus(t, fleetGet(h, blocks), http.StatusOK)
	requireStatus(t, fleetPost(h, "/occupancy/maintenance", maintenance, ""), http.StatusCreated)

	// Not served on the client-facing /v1 router, with or without identity.
	requireStatus(t, h.Do(http.MethodGet, "/internal/fleet"+blocks, driver, nil), http.StatusNotFound)
	requireStatus(t, h.Do(http.MethodGet, "/fleet"+blocks, driver, nil), http.StatusNotFound)

	// FLEET_RIDE_SERVICE_KEY unset, or shorter than 32 characters: closed.
	unset := fleetHarness(t, double, testutil.WithFleetRideServiceKey(""))
	requireCode(t, unset.DoInternal(http.MethodGet, blocks, testutil.DefaultFleetRideServiceKey, nil),
		http.StatusServiceUnavailable, domain.CodeServiceUnavailable)
	requireCode(t, unset.DoInternal(http.MethodGet, blocks, "", nil), http.StatusServiceUnavailable, domain.CodeServiceUnavailable)
	short := fleetHarness(t, double, testutil.WithFleetRideServiceKey("short-key"))
	requireCode(t, short.DoInternal(http.MethodGet, blocks, "short-key", nil), http.StatusServiceUnavailable, domain.CodeServiceUnavailable)

	// Outbound: an unusable FLEET_SERVICE_KEY never calls; a wrong one is
	// refused by fleet-service and answers "unavailable".
	before := double.callCount("vehicle-at")
	unconfigured := marketplace.NewHTTPFleetService(double.server.URL, "short", marketplace.FleetServiceOptions{})
	if marketplace.FleetServiceConfigured(unconfigured) {
		t.Fatal("a short FLEET_SERVICE_KEY must leave the port unconfigured")
	}
	if _, err := unconfigured.VehicleAt(context.Background(), uuid.New(), now, now.Add(time.Hour)); !errors.Is(err, marketplace.ErrFleetServiceUnavailable) {
		t.Fatalf("an unconfigured port answers unavailable: %v", err)
	}
	wrong := marketplace.NewHTTPFleetService(double.server.URL, "a-different-fleet-service-key-0123456789", marketplace.FleetServiceOptions{})
	if _, err := wrong.Vehicle(context.Background(), vehicle); !errors.Is(err, marketplace.ErrFleetServiceUnavailable) {
		t.Fatalf("a refused key answers unavailable: %v", err)
	}
	if double.callCount("vehicle-at") != before || double.badKeys != 1 {
		t.Fatalf("no call without a usable key; the wrong key reached fleet-service once and was refused (%d)", double.badKeys)
	}
}

// TestBookingVehicleResolutionNeverBlocksTheAward (FL-4): the vehicle is
// asked of fleet-service only with the fleet flag on; no covering assignment
// is "no vehicle"; fleet-service down or slow never blocks the award — the
// booking is confirmed without a vehicle, pending, and the sweep writes the
// vehicle and its ledger row once fleet-service answers.
func TestBookingVehicleResolutionNeverBlocksTheAward(t *testing.T) {
	t.Run("fleet flag off: never asked", func(t *testing.T) {
		double := newFleetDouble(t)
		h := schedulingHarness(t, testutil.WithFleetService(double.port()))
		nightClock(h)
		vehicle := fleetVehicle(h, double, "a")
		f := bookOnVehicle(t, h, double, vehicle, 4*time.Hour, "wallet")
		if f.booking.VehicleID != nil || f.booking.VehicleResolution != marketplace.VehicleResolutionNotApplicable ||
			f.booking.NextVehicleCheckAt != nil || double.callCount("vehicle-at") != 0 || len(ledgerRows(t, h, vehicle)) != 0 {
			t.Fatalf("with the fleet flag off the booking is exactly as before: %+v (calls %d)", f.booking, double.callCount("vehicle-at"))
		}
	})

	t.Run("no fleet assignment: no vehicle", func(t *testing.T) {
		double := newFleetDouble(t)
		h := fleetHarness(t, double)
		f := bookOnVehicle(t, h, double, "", 4*time.Hour, "wallet")
		if f.booking.VehicleID != nil || f.booking.VehicleResolution != marketplace.VehicleResolutionResolved ||
			f.booking.NextVehicleCheckAt != nil || double.callCount("vehicle-at") != 1 {
			t.Fatalf("a driver with no fleet assignment books without a vehicle: %+v", f.booking)
		}
	})

	t.Run("fleet-service down, then back: backfilled by the sweep", func(t *testing.T) {
		double := newFleetDouble(t)
		h := fleetHarness(t, double)
		vehicle := fleetVehicle(h, double, "a")
		double.setDown(true)
		f := bookOnVehicle(t, h, double, vehicle, 4*time.Hour, "wallet")
		b := f.booking
		if b.State != machine.MpBookingConfirmed || h.Wallet.CapturesByReservation[f.reservationID] != 1 {
			t.Fatalf("fleet-service down never blocks the award: %s", b.State)
		}
		if b.VehicleID != nil || b.VehicleResolution != marketplace.VehicleResolutionPending || b.NextVehicleCheckAt == nil ||
			!b.NextVehicleCheckAt.Equal(h.Clock.Now().Add(5*time.Minute)) || len(ledgerRows(t, h, vehicle)) != 0 {
			t.Fatalf("the booking goes ahead without a vehicle, asked again in 5 min: %+v", b)
		}
		sweepOnce(t, h)
		if b = f.reload(t); b.VehicleID != nil {
			t.Fatal("nothing is asked before the retry is due")
		}
		double.setDown(false)
		h.Clock.Set(h.Clock.Now().Add(6 * time.Minute))
		sweepOnce(t, h)
		b = f.reload(t)
		if b.VehicleID == nil || *b.VehicleID != vehicle || b.VehicleResolution != marketplace.VehicleResolutionResolved ||
			b.VehicleSource != marketplace.VehicleSourceFleetAssignment || b.Risk != machine.MpRiskOK {
			t.Fatalf("the sweep writes the vehicle fleet-service named: %+v", b)
		}
		rows := ledgerRows(t, h, vehicle)
		if len(rows) != 1 || rows[0].Kind != "booking" || rows[0].SourceID != b.ID.String() || rows[0].State != "active" ||
			!rows[0].Start.Equal(b.OccupiedStart) {
			t.Fatalf("with its ledger row, atomically: %+v", rows)
		}
	})

	t.Run("fleet-service hanging: the award does not wait for it", func(t *testing.T) {
		double := newFleetDouble(t)
		h := fleetHarness(t, double)
		vehicle := fleetVehicle(h, double, "a")
		double.setDelay(2 * time.Second)
		started := time.Now()
		f := bookOnVehicle(t, h, double, vehicle, 4*time.Hour, "wallet")
		if elapsed := time.Since(started); elapsed >= 2*time.Second {
			t.Fatalf("the award waited %v for a hanging fleet-service; the client timeout must bound it", elapsed)
		}
		if f.booking.State != machine.MpBookingConfirmed || f.booking.VehicleResolution != marketplace.VehicleResolutionPending {
			t.Fatalf("a timed-out answer is pending, the award confirmed: %s / %s", f.booking.State, f.booking.VehicleResolution)
		}
		double.setDelay(0)
	})

	t.Run("a vehicle named late but held by maintenance: at risk until it frees", func(t *testing.T) {
		double := newFleetDouble(t)
		h := fleetHarness(t, double)
		vehicle := fleetVehicle(h, double, "a")
		double.setDown(true)
		f := bookOnVehicle(t, h, double, vehicle, 4*time.Hour, "wallet")
		// While the booking's vehicle was unknown, the fleet booked the
		// vehicle's service over the same interval (nothing refused it).
		b := f.booking
		requireStatus(t, fleetPost(h, "/occupancy/maintenance",
			blockBody("mnt-late", vehicle, "planned_service", b.OccupiedStart, b.OccupiedEnd), ""), http.StatusCreated)
		double.setDown(false)
		h.Clock.Set(h.Clock.Now().Add(6 * time.Minute))
		sweepOnce(t, h)
		b = f.reload(t)
		if b.VehicleID != nil || b.Risk != machine.MpRiskAtRisk || b.RiskDeadline == nil ||
			b.VehicleResolution != marketplace.VehicleResolutionPending {
			t.Fatalf("the ledger refuses the vehicle; the booking is at risk instead: %+v", b)
		}
		requireStatus(t, fleetPost(h, "/occupancy/maintenance/mnt-late/release", nil, ""), http.StatusOK)
		h.Clock.Set(h.Clock.Now().Add(6 * time.Minute))
		sweepOnce(t, h)
		b = f.reload(t)
		if b.VehicleID == nil || *b.VehicleID != vehicle || b.Risk != machine.MpRiskOK {
			t.Fatalf("once the block is released the vehicle is written and the risk resolved: %+v", b)
		}
	})

	t.Run("a vehicle off the road or in maintenance for the window refuses the selection", func(t *testing.T) {
		double := newFleetDouble(t)
		h := fleetHarness(t, double)
		offRoad := fleetVehicle(h, double, "broken")
		serviced := fleetVehicle(h, double, "serviced")
		now := h.Clock.Now()
		requireStatus(t, fleetPost(h, "/occupancy/off-road", offRoadBody("off-1", offRoad, now, nil), ""), http.StatusCreated)
		f := prepareOnVehicle(t, h, double, offRoad, 4*time.Hour, "wallet")
		requireCode(t, selectPrepared(t, f), http.StatusConflict, domain.CodeSlotUnavailable)
		if request := requestRow(t, h, f.requestID); request.State != machine.MpRequestOpen {
			t.Fatalf("a refused selection leaves the request open for another offer: %s", request.State)
		}
		g := prepareOnVehicle(t, h, double, serviced, 5*time.Hour, "wallet")
		requireStatus(t, fleetPost(h, "/occupancy/maintenance", blockBody("mnt-1", serviced, "inspection",
			g.pickupAt.Add(-5*time.Minute), g.pickupAt.Add(5*time.Minute)), ""), http.StatusCreated)
		requireCode(t, selectPrepared(t, g), http.StatusConflict, domain.CodeSlotUnavailable)
		if n := countRows(t, h, `SELECT COUNT(*) FROM mp.advance_bookings WHERE request_id = $1`, uuid.MustParse(g.requestID)); n != 0 {
			t.Fatalf("no booking is written over a maintenance block: %d", n)
		}
	})
}
