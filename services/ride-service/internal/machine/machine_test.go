package machine_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// contractPath is the canonical machine definition this package is a port of.
const contractPath = "../../../../contracts/state-machines.json"

type contractMachine struct {
	Initial     string              `json:"initial"`
	Transitions map[string][]string `json:"transitions"`
}

func loadContract(t *testing.T) map[string]contractMachine {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(contractPath))
	if err != nil {
		t.Fatalf("failed to read %s: %v", contractPath, err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatalf("failed to parse the state machine contract: %v", err)
	}
	machines := map[string]contractMachine{}
	for _, name := range []string{"rider", "driver"} {
		section, ok := document[name]
		if !ok {
			t.Fatalf("the contract has no %q machine", name)
		}
		var parsed contractMachine
		if err := json.Unmarshal(section, &parsed); err != nil {
			t.Fatalf("failed to parse the %s machine: %v", name, err)
		}
		machines[name] = parsed
	}
	return machines
}

// TestPortMatchesContract is the test that matters for this package: it reads
// contracts/state-machines.json and asserts the Go tables are the same machine.
// A hand-rolled looser version — an extra edge someone added to make a bug go
// away — fails here rather than in production.
func TestPortMatchesContract(t *testing.T) {
	contract := loadContract(t)

	for name, expected := range contract {
		machineName := machine.Name(name)

		initial, err := machine.Initial(machineName)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if initial != expected.Initial {
			t.Errorf("%s initial state: got %q, contract says %q", name, initial, expected.Initial)
		}

		// Every state the contract mentions — as a source or only ever as a
		// destination — must exist in the port.
		mentioned := map[string]struct{}{}
		for from, tos := range expected.Transitions {
			mentioned[from] = struct{}{}
			for _, to := range tos {
				mentioned[to] = struct{}{}
			}
		}
		ported, err := machine.States(machineName)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		portedSet := map[string]struct{}{}
		for _, state := range ported {
			portedSet[state] = struct{}{}
		}
		for state := range mentioned {
			if _, ok := portedSet[state]; !ok {
				t.Errorf("%s: the port is missing the state %q", name, state)
			}
		}
		for state := range portedSet {
			if _, ok := mentioned[state]; !ok {
				t.Errorf("%s: the port invented the state %q", name, state)
			}
		}

		// Every edge, in both directions: nothing missing, nothing added.
		for from, tos := range expected.Transitions {
			allowed, err := machine.Allowed(machineName, from)
			if err != nil {
				t.Errorf("%s: %v", name, err)
				continue
			}
			want := append([]string(nil), tos...)
			sort.Strings(want)
			if len(want) != len(allowed) {
				t.Errorf("%s %s: port allows %v, contract allows %v", name, from, allowed, want)
				continue
			}
			for i := range want {
				if want[i] != allowed[i] {
					t.Errorf("%s %s: port allows %v, contract allows %v", name, from, allowed, want)
					break
				}
			}
		}

		// And the closure: no pair the contract omits may be allowed.
		for from := range portedSet {
			for to := range portedSet {
				contractAllows := false
				for _, candidate := range expected.Transitions[from] {
					if candidate == to {
						contractAllows = true
						break
					}
				}
				if machine.Can(machineName, from, to) != contractAllows {
					t.Errorf("%s: %s → %s: port says %v, contract says %v",
						name, from, to, !contractAllows, contractAllows)
				}
			}
		}
	}
}

func TestAssertRefusesIllegalTransitions(t *testing.T) {
	cases := []struct {
		name    string
		machine machine.Name
		from    string
		to      string
	}{
		{"a ride cannot start before the PIN screen", machine.Rider, machine.RiderDriverArrived, machine.RiderInProgress},
		{"a ride cannot skip matching", machine.Rider, machine.RiderRequesting, machine.RiderDriverAssigned},
		{"a rated ride is terminal", machine.Rider, machine.RiderRated, machine.RiderInProgress},
		{"a driver cannot start a trip without a verified PIN", machine.Driver, machine.DriverWaiting, machine.DriverInTrip},
		{"an offline driver cannot receive an offer", machine.Driver, machine.DriverOffline, machine.DriverOfferReceived},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if err := machine.Assert(testCase.machine, testCase.from, testCase.to); err == nil {
				t.Fatalf("expected %s → %s to be refused", testCase.from, testCase.to)
			}
		})
	}
}

func TestAssertAllowsContractTransitions(t *testing.T) {
	legal := []struct {
		machine machine.Name
		from    string
		to      string
	}{
		{machine.Rider, machine.RiderMatching, machine.RiderDriverAssigned},
		{machine.Rider, machine.RiderDriverArrived, machine.RiderPinVerification},
		{machine.Rider, machine.RiderPinVerification, machine.RiderInProgress},
		{machine.Rider, machine.RiderDriverAssigned, machine.RiderRematching},
		{machine.Driver, machine.DriverWaiting, machine.DriverPinVerified},
		{machine.Driver, machine.DriverPinVerified, machine.DriverInTrip},
		{machine.Driver, machine.DriverCollectingPayment, machine.DriverCompleted},
	}
	for _, transition := range legal {
		if err := machine.Assert(transition.machine, transition.from, transition.to); err != nil {
			t.Errorf("%s → %s should be allowed: %v", transition.from, transition.to, err)
		}
	}
}

func TestUnknownStatesAreRefused(t *testing.T) {
	if err := machine.Assert(machine.Rider, "teleporting", machine.RiderInProgress); err == nil {
		t.Fatal("an unknown source state must be refused")
	}
	if err := machine.Assert(machine.Rider, machine.RiderInProgress, "teleporting"); err == nil {
		t.Fatal("an unknown destination state must be refused")
	}
	if err := machine.Assert("courier", "a", "b"); err == nil {
		t.Fatal("an unknown machine must be refused")
	}
}

func TestActiveStatesCoverTheLiveRide(t *testing.T) {
	// A ride in any of these states occupies its rider and, once assigned, its
	// driver: the partial unique indexes depend on this list being right.
	for _, state := range machine.RiderActiveStates() {
		if !machine.IsRiderActive(state) {
			t.Errorf("%s should count as active", state)
		}
	}
	for _, state := range []string{
		machine.RiderCompleted, machine.RiderRated, machine.RiderCancelledByRider,
		machine.RiderCancelledByOps, machine.RiderNoShow,
	} {
		if machine.IsRiderActive(state) {
			t.Errorf("%s should not count as active", state)
		}
	}
}
