package marketplace_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
)

// fleetDouble is a FAITHFUL double of fleet-service's side of internal
// contract A — routes 8 and 9 exactly as packages/contracts/src/
// marketplace-fleet.ts (MpFleetVehicleAtSchema, MpFleetVehicleSchema) and
// the lead's contract text define them:
//
//	GET /internal/fleet/drivers/{driverId}/vehicle-at?from&to
//	  → 200 {vehicleId, assignmentId, vehicleClass, capacity} — the vehicle
//	    the driver is assigned to for the WHOLE interval under a signed
//	    assignment, all null when no assignment covers it
//	GET /internal/fleet/vehicles/{vehicleId}
//	  → 200 {vehicleId, fleetId, classes, capacity, documents:
//	    {insuranceExpiry, inspectionExpiry}} | 404
//	X-Service-Key: FLEET_SERVICE_KEY (>= 32 characters), else 401
//
// The real HTTP client (marketplace.NewHTTPFleetService) talks to it over
// real HTTP; nothing in the engine is mocked.
type fleetDouble struct {
	t      *testing.T
	server *httptest.Server
	key    string

	mu          sync.Mutex
	assignments map[uuid.UUID][]fleetAssignment
	vehicles    map[string]fleetVehicleRecord
	down        bool
	delay       time.Duration
	calls       map[string]int
	badKeys     int
}

type fleetAssignment struct {
	id       string
	vehicle  string
	from     time.Time
	to       *time.Time
	class    string
	capacity int
}

type fleetVehicleRecord struct {
	fleetID    string
	classes    []string
	capacity   int
	insurance  *string
	inspection *string
}

// fleetDoubleKey is the FLEET_SERVICE_KEY fixture (32+ characters).
const fleetDoubleKey = "test-fleet-service-key-abcdefghijklmnopqrstuvwxyz"

func newFleetDouble(t *testing.T) *fleetDouble {
	t.Helper()
	d := &fleetDouble{
		t: t, key: fleetDoubleKey,
		assignments: map[uuid.UUID][]fleetAssignment{},
		vehicles:    map[string]fleetVehicleRecord{},
		calls:       map[string]int{},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /internal/fleet/drivers/{driverId}/vehicle-at", d.vehicleAt)
	mux.HandleFunc("GET /internal/fleet/vehicles/{vehicleId}", d.vehicle)
	d.server = httptest.NewServer(d.authenticated(mux))
	t.Cleanup(d.server.Close)
	return d
}

// port is the real HTTP client pointed at the double, with a short timeout.
func (d *fleetDouble) port() marketplace.FleetServicePort {
	return marketplace.NewHTTPFleetService(d.server.URL, d.key, marketplace.FleetServiceOptions{
		Client: &http.Client{Timeout: 300 * time.Millisecond},
	})
}

func (d *fleetDouble) authenticated(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d.mu.Lock()
		down, delay := d.down, d.delay
		if r.Header.Get("X-Service-Key") != d.key {
			d.badKeys++
			d.mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"code":"unauthorized","message":"a valid service key is required"}`))
			return
		}
		d.mu.Unlock()
		if delay > 0 {
			time.Sleep(delay)
		}
		if down {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"code":"service_unavailable","message":"down"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (d *fleetDouble) record(route string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.calls[route]++
}

// callCount reads how often a route was called.
func (d *fleetDouble) callCount(route string) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.calls[route]
}

func (d *fleetDouble) setDown(down bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.down = down
}

func (d *fleetDouble) setDelay(delay time.Duration) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.delay = delay
}

// assign signs the driver onto a vehicle from `from` (open-ended when to is
// nil).
func (d *fleetDouble) assign(driverID uuid.UUID, vehicleID string, from time.Time, to *time.Time) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	record, ok := d.vehicles[vehicleID]
	if !ok {
		d.t.Fatalf("assign to unknown vehicle %s", vehicleID)
	}
	id := "asg_" + uuid.NewString()[:8]
	d.assignments[driverID] = append(d.assignments[driverID], fleetAssignment{
		id: id, vehicle: vehicleID, from: from, to: to, class: record.classes[0], capacity: record.capacity,
	})
	return id
}

// endAssignments sets every assignment of the driver to end at `at` (a
// termination notice ending then).
func (d *fleetDouble) endAssignments(driverID uuid.UUID, at time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for i := range d.assignments[driverID] {
		end := at
		d.assignments[driverID][i].to = &end
	}
}

// addVehicle registers a vehicle with documents valid until the given dates
// (ISO YYYY-MM-DD; "" is a missing document).
func (d *fleetDouble) addVehicle(vehicleID, fleetID string, classes []string, capacity int, insurance, inspection string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	record := fleetVehicleRecord{fleetID: fleetID, classes: classes, capacity: capacity}
	if insurance != "" {
		record.insurance = &insurance
	}
	if inspection != "" {
		record.inspection = &inspection
	}
	d.vehicles[vehicleID] = record
}

// setDocuments replaces a vehicle's document expiries.
func (d *fleetDouble) setDocuments(vehicleID, insurance, inspection string) {
	d.mu.Lock()
	record := d.vehicles[vehicleID]
	d.mu.Unlock()
	d.addVehicle(vehicleID, record.fleetID, record.classes, record.capacity, insurance, inspection)
}

func writeDoubleJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// vehicleAt serves route 8: an assignment must cover the WHOLE interval.
func (d *fleetDouble) vehicleAt(w http.ResponseWriter, r *http.Request) {
	d.record("vehicle-at")
	driverID, err := uuid.Parse(r.PathValue("driverId"))
	if err != nil {
		writeDoubleJSON(w, http.StatusUnprocessableEntity, map[string]any{"code": "validation_failed", "message": "driverId"})
		return
	}
	from, fromErr := time.Parse(time.RFC3339Nano, r.URL.Query().Get("from"))
	to, toErr := time.Parse(time.RFC3339Nano, r.URL.Query().Get("to"))
	if fromErr != nil || toErr != nil || !to.After(from) {
		writeDoubleJSON(w, http.StatusUnprocessableEntity, map[string]any{"code": "validation_failed", "message": "from/to"})
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, assignment := range d.assignments[driverID] {
		covers := !from.Before(assignment.from) && (assignment.to == nil || !to.After(*assignment.to))
		if covers {
			writeDoubleJSON(w, http.StatusOK, map[string]any{
				"vehicleId": assignment.vehicle, "assignmentId": assignment.id,
				"vehicleClass": assignment.class, "capacity": assignment.capacity,
			})
			return
		}
	}
	writeDoubleJSON(w, http.StatusOK, map[string]any{
		"vehicleId": nil, "assignmentId": nil, "vehicleClass": nil, "capacity": nil,
	})
}

// vehicle serves route 9.
func (d *fleetDouble) vehicle(w http.ResponseWriter, r *http.Request) {
	d.record("vehicle")
	id := r.PathValue("vehicleId")
	d.mu.Lock()
	record, ok := d.vehicles[id]
	d.mu.Unlock()
	if !ok {
		writeDoubleJSON(w, http.StatusNotFound, map[string]any{"code": "not_found", "message": "no such vehicle"})
		return
	}
	writeDoubleJSON(w, http.StatusOK, map[string]any{
		"vehicleId": id, "fleetId": record.fleetID, "classes": record.classes, "capacity": record.capacity,
		"documents": map[string]any{"insuranceExpiry": record.insurance, "inspectionExpiry": record.inspection},
	})
}
