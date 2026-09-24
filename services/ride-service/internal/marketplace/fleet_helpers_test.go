package marketplace_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// fleetHarness is the Book for Later harness with the fleet calendar on
// (the deny-by-default `fleet` flag) and fleet-service's contract A routes
// served by a faithful double.
func fleetHarness(t *testing.T, double *fleetDouble, opts ...testutil.HarnessOption) *testutil.Harness {
	t.Helper()
	all := append([]testutil.HarnessOption{
		testutil.WithFlag(cityconfig.FlagFleet, true),
		testutil.WithFleetService(double.port()),
	}, opts...)
	h := schedulingHarness(t, all...)
	nightClock(h)
	return h
}

// fleetVehicle registers a fleet vehicle in the double: class go, 4 seats,
// documents valid for years.
func fleetVehicle(h *testutil.Harness, double *fleetDouble, name string) string {
	id := h.VehicleID(name)
	double.addVehicle(id, "flt_"+h.CityID, []string{"go"}, 4, "2030-01-01", "2030-01-01")
	return id
}

// prepareOnVehicle runs the advance flow up to the driver's bid, for a
// driver the fleet signed onto `vehicle` (none when empty), for a pickup
// `ahead` from now.
func prepareOnVehicle(t *testing.T, h *testutil.Harness, double *fleetDouble, vehicle string, ahead time.Duration, payment string) *advanceFixture {
	t.Helper()
	f := &advanceFixture{h: h, rider: h.Rider(), driver: h.Driver(), pickupAt: pickupIn(h, ahead)}
	if vehicle != "" {
		double.assign(f.driver.UserID, vehicle, h.Clock.Now().Add(-24*time.Hour), nil)
	}
	view := createAdvance(t, h, f.rider, f.pickupAt, payment)
	f.requestID = view["requestId"].(string)
	f.amount = moneyMinor(t, view, "requestedFareMinor")
	parkDriver(t, h, f.driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(f.driver.UserID, 1_000_000)
	bid := advanceBid(t, h, f.driver, f.requestID, f.amount)
	requireStatus(t, bid, http.StatusCreated)
	bidView := decode(t, bid)
	f.bidID = bidView["bidId"].(string)
	f.reservationID = bidView["reservationId"].(string)
	return f
}

// selectPrepared is the rider's selection of the prepared bid.
func selectPrepared(t *testing.T, f *advanceFixture) *httptest.ResponseRecorder {
	t.Helper()
	return doSelect(t, f.h, f.rider, f.requestID, map[string]any{
		"bidId": f.bidID, "requestVersion": 1, "bidVersion": 1,
	}, "")
}

// bookOnVehicle runs the whole advance flow for a driver the fleet signed
// onto `vehicle` (none when empty) for a pickup `ahead` from now.
func bookOnVehicle(t *testing.T, h *testutil.Harness, double *fleetDouble, vehicle string, ahead time.Duration, payment string) *advanceFixture {
	t.Helper()
	f := prepareOnVehicle(t, h, double, vehicle, ahead, payment)
	selected := selectPrepared(t, f)
	requireStatus(t, selected, http.StatusAccepted)
	f.selected = decode(t, selected)
	f.award = awardRow(t, h, f.requestID)
	f.booking = bookingOfAward(t, h, f.award.ID)
	return f
}

// fleetPost calls a contract A POST route as fleet-service, with a fresh
// Idempotency-Key unless one is given.
func fleetPost(h *testutil.Harness, path string, body any, key string) *httptest.ResponseRecorder {
	if key == "" {
		key = idemKey()
	}
	return h.DoInternal(http.MethodPost, path, h.FleetRideServiceKey, body, move.IdempotencyHeader, key)
}

// fleetGet calls a contract A GET route as fleet-service.
func fleetGet(h *testutil.Harness, path string) *httptest.ResponseRecorder {
	return h.DoInternal(http.MethodGet, path, h.FleetRideServiceKey, nil)
}

// blocksQuery is route 5's path for the given ids and window.
func blocksQuery(vehicleIDs, driverIDs []string, from, to time.Time) string {
	query := url.Values{}
	if len(vehicleIDs) > 0 {
		query.Set("vehicleIds", strings.Join(vehicleIDs, ","))
	}
	if len(driverIDs) > 0 {
		query.Set("driverIds", strings.Join(driverIDs, ","))
	}
	query.Set("from", from.UTC().Format(time.RFC3339))
	query.Set("to", to.UTC().Format(time.RFC3339))
	return "/occupancy/blocks?" + query.Encode()
}

// rawBlocks reads route 5's blocks as raw JSON objects (so a test can see
// every key actually on the wire).
func rawBlocks(t *testing.T, recorder *httptest.ResponseRecorder) []map[string]json.RawMessage {
	t.Helper()
	requireStatus(t, recorder, http.StatusOK)
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope) != 1 || envelope["blocks"] == nil {
		t.Fatalf("route 5 answers exactly {blocks}: %s", recorder.Body.String())
	}
	var blocks []map[string]json.RawMessage
	if err := json.Unmarshal(envelope["blocks"], &blocks); err != nil {
		t.Fatal(err)
	}
	return blocks
}

// contractBlockFields reads MP_OCCUPIED_BLOCK_FIELDS from the contract, so
// the allowlist test holds the wire to the contract text itself.
func contractBlockFields(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean("../../../../packages/contracts/src/marketplace-fleet.ts"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	start := strings.Index(text, "export const MP_OCCUPIED_BLOCK_FIELDS = [")
	if start < 0 {
		t.Fatal("the contract no longer declares MP_OCCUPIED_BLOCK_FIELDS")
	}
	list := text[start:]
	list = list[:strings.Index(list, "] as const")]
	var fields []string
	for _, match := range regexp.MustCompile(`"([A-Za-z]+)"`).FindAllStringSubmatch(list, -1) {
		fields = append(fields, match[1])
	}
	sort.Strings(fields)
	if len(fields) != 8 {
		t.Fatalf("the contract's OccupiedBlock allowlist changed: %v", fields)
	}
	return fields
}

// requireOpaqueBlock fails unless a block carries EXACTLY the contract's
// OccupiedBlock keys, and none of its values reveals the booking's rider,
// location, fare, request or booking id.
func requireOpaqueBlock(t *testing.T, block map[string]json.RawMessage, f *advanceFixture) {
	t.Helper()
	want := contractBlockFields(t)
	got := make([]string, 0, len(block))
	for key := range block {
		got = append(got, key)
	}
	sort.Strings(got)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("an OccupiedBlock carries exactly %v — got %v", want, got)
	}
	encoded, _ := json.Marshal(block)
	for _, secret := range []string{
		f.rider.UserID.String(), f.booking.ID.String(), f.booking.RequestID.String(), f.booking.AwardID.String(),
		f.booking.Pickup.Label, f.booking.Dropoff.Label, itoa64(f.booking.FareMinor),
	} {
		if secret != "" && strings.Contains(string(encoded), secret) {
			t.Fatalf("an OccupiedBlock leaks %q: %s", secret, encoded)
		}
	}
}

func itoa64(n int64) string {
	raw, _ := json.Marshal(n)
	return string(raw)
}

// occupancyRow is one ledger row as the database holds it.
type occupancyRow struct {
	ID       uuid.UUID
	Kind     string
	SourceID string
	State    string
	Start    time.Time
	End      *time.Time
}

// ledgerRows reads every ledger row for a vehicle, oldest first.
func ledgerRows(t *testing.T, h *testutil.Harness, vehicleID string) []occupancyRow {
	t.Helper()
	rows, err := h.Pool.Query(context.Background(), `
		SELECT id, kind, source_id, state, lower(occupied),
			CASE WHEN upper_inf(occupied) THEN NULL ELSE upper(occupied) END
		FROM mp.vehicle_occupancy WHERE vehicle_id = $1 ORDER BY created_at, id`, vehicleID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []occupancyRow
	for rows.Next() {
		var row occupancyRow
		if err := rows.Scan(&row.ID, &row.Kind, &row.SourceID, &row.State, &row.Start, &row.End); err != nil {
			t.Fatal(err)
		}
		out = append(out, row)
	}
	return out
}

// windowBody is a maintenance window body.
func windowBody(vehicleID, kind string, start, end time.Time) map[string]any {
	return map[string]any{
		"vehicleId": vehicleID, "kind": kind,
		"startsAt": start.UTC().Format(time.RFC3339), "endsAt": end.UTC().Format(time.RFC3339),
	}
}

// blockBody is a maintenance window body with a fleet block id.
func blockBody(blockID, vehicleID, kind string, start, end time.Time) map[string]any {
	body := windowBody(vehicleID, kind, start, end)
	body["blockId"] = blockID
	return body
}

// offRoadBody is route 4's body (expectedEnd nil: open-ended).
func offRoadBody(blockID, vehicleID string, start time.Time, expectedEnd *time.Time) map[string]any {
	var end any
	if expectedEnd != nil {
		end = expectedEnd.UTC().Format(time.RFC3339)
	}
	return map[string]any{
		"blockId": blockID, "vehicleId": vehicleID,
		"startsAt": start.UTC().Format(time.RFC3339), "expectedEndsAt": end,
	}
}

// parseTime reads an RFC 3339 instant out of a decoded body.
func parseTime(t *testing.T, value any) time.Time {
	t.Helper()
	text, ok := value.(string)
	if !ok {
		t.Fatalf("not a timestamp: %v", value)
	}
	at, err := time.Parse(time.RFC3339Nano, text)
	if err != nil {
		t.Fatal(err)
	}
	return at
}
