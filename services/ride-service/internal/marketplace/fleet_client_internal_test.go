package marketplace

import (
	"errors"
	"testing"
	"time"
)

// TestFleetClientHoldsFleetServiceToTheContract: routes 8 and 9 are parsed
// strictly — exactly the documented keys, no half-null assignment, positive
// capacities — and a malformed answer is refused as a whole, never
// half-trusted. A bare-date document expiry is read conservatively (expired
// from 00:00 UTC on that date).
func TestFleetClientHoldsFleetServiceToTheContract(t *testing.T) {
	good := `{"vehicleId":"veh-1","assignmentId":"asg-1","vehicleClass":"go","capacity":4}`
	at, err := parseFleetVehicleAt([]byte(good))
	if err != nil || *at.VehicleID != "veh-1" || *at.AssignmentID != "asg-1" || *at.Capacity != 4 {
		t.Fatalf("a well-formed answer parses: %+v %v", at, err)
	}
	none, err := parseFleetVehicleAt([]byte(`{"vehicleId":null,"assignmentId":null,"vehicleClass":null,"capacity":null}`))
	if err != nil || none.VehicleID != nil {
		t.Fatalf("no covering assignment is all null: %+v %v", none, err)
	}
	for name, body := range map[string]string{
		"extra key":           `{"vehicleId":"veh-1","assignmentId":"asg-1","vehicleClass":"go","capacity":4,"riderId":"x"}`,
		"missing key":         `{"vehicleId":"veh-1","assignmentId":"asg-1","vehicleClass":"go"}`,
		"vehicle without asg": `{"vehicleId":"veh-1","assignmentId":null,"vehicleClass":"go","capacity":4}`,
		"null with class":     `{"vehicleId":null,"assignmentId":null,"vehicleClass":"go","capacity":null}`,
		"zero capacity":       `{"vehicleId":"veh-1","assignmentId":"asg-1","vehicleClass":"go","capacity":0}`,
		"fractional capacity": `{"vehicleId":"veh-1","assignmentId":"asg-1","vehicleClass":"go","capacity":3.5}`,
		"empty id":            `{"vehicleId":"","assignmentId":"asg-1","vehicleClass":"go","capacity":4}`,
		"not an object":       `[]`,
	} {
		if _, err := parseFleetVehicleAt([]byte(body)); !errors.Is(err, ErrFleetServiceUnavailable) {
			t.Errorf("%s: a malformed route 8 answer is refused, got %v", name, err)
		}
	}

	vehicle, err := parseFleetVehicle([]byte(`{"vehicleId":"veh-1","fleetId":"flt-1","classes":["go","comfort"],"capacity":4,
		"documents":{"insuranceExpiry":"2026-10-01","inspectionExpiry":"2026-12-31T12:00:00Z"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if !vehicle.InsuranceExpiry.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("a bare date expires at 00:00 UTC on that date: %v", vehicle.InsuranceExpiry)
	}
	if vehicle.DocumentsValidThrough(time.Date(2026, 10, 1, 6, 0, 0, 0, time.UTC)) {
		t.Fatal("insurance expiring on the booking's day does not cover it")
	}
	if !vehicle.DocumentsValidThrough(time.Date(2026, 9, 30, 23, 0, 0, 0, time.UTC)) {
		t.Fatal("both documents cover the day before")
	}
	missing, err := parseFleetVehicle([]byte(`{"vehicleId":"veh-1","fleetId":"flt-1","classes":["go"],"capacity":4,
		"documents":{"insuranceExpiry":null,"inspectionExpiry":"2030-01-01"}}`))
	if err != nil || missing.DocumentsValidThrough(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("a missing document never counts as valid: %v", err)
	}
	for name, body := range map[string]string{
		"extra document": `{"vehicleId":"v","fleetId":"f","classes":["go"],"capacity":4,"documents":{"insuranceExpiry":null,"inspectionExpiry":null,"plate":"x"}}`,
		"no fleet":       `{"vehicleId":"v","fleetId":null,"classes":["go"],"capacity":4,"documents":{"insuranceExpiry":null,"inspectionExpiry":null}}`,
		"bad date":       `{"vehicleId":"v","fleetId":"f","classes":["go"],"capacity":4,"documents":{"insuranceExpiry":"soon","inspectionExpiry":null}}`,
		"null classes":   `{"vehicleId":"v","fleetId":"f","classes":null,"capacity":4,"documents":{"insuranceExpiry":null,"inspectionExpiry":null}}`,
		"extra key":      `{"vehicleId":"v","fleetId":"f","classes":["go"],"capacity":4,"owner":"x","documents":{"insuranceExpiry":null,"inspectionExpiry":null}}`,
	} {
		if _, err := parseFleetVehicle([]byte(body)); !errors.Is(err, ErrFleetServiceUnavailable) {
			t.Errorf("%s: a malformed route 9 answer is refused, got %v", name, err)
		}
	}
}

// TestRiskDeadlineIsTheEarlierCandidate (Q4): the earlier of the
// reconfirmation deadline (while reconfirmation is still owed) and
// activation minus the market's lead; never in the past.
func TestRiskDeadlineIsTheEarlierCandidate(t *testing.T) {
	pickup := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	b := &AdvanceBooking{
		State:             "confirmed",
		ReconfirmDeadline: pickup.Add(-45 * time.Minute),
		ActivationAt:      pickup.Add(-30 * time.Minute),
	}
	now := pickup.Add(-5 * time.Hour)
	if got := riskDeadlineFor(b, 0, now); !got.Equal(b.ReconfirmDeadline) {
		t.Fatalf("with no lead, the reconfirmation deadline comes first: %v", got)
	}
	if got := riskDeadlineFor(b, 1_800, now); !got.Equal(pickup.Add(-time.Hour)) {
		t.Fatalf("activation − 30 min comes first: %v", got)
	}
	reconfirmed := *b
	reconfirmed.State = "reconfirmed"
	at := pickup.Add(-2 * time.Hour)
	reconfirmed.ReconfirmedAt = &at
	if got := riskDeadlineFor(&reconfirmed, 0, now); !got.Equal(b.ActivationAt) {
		t.Fatalf("a reconfirmed booking owes no reconfirmation: %v", got)
	}
	late := pickup.Add(-10 * time.Minute)
	if got := riskDeadlineFor(b, 1_800, late); !got.Equal(late) {
		t.Fatalf("a blocker too late to resolve is due at once: %v", got)
	}
}
