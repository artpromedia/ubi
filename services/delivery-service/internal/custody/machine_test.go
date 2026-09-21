package custody_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/custody"
)

// contractPath is the canonical machine definition this package is a port of.
const contractPath = "../../../../contracts/state-machines.json"

type contractMachine struct {
	Initial     string              `json:"initial"`
	Transitions map[string][]string `json:"transitions"`
}

func loadContract(t *testing.T) contractMachine {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(contractPath))
	if err != nil {
		t.Fatalf("failed to read %s: %v", contractPath, err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatalf("failed to parse the state machine contract: %v", err)
	}
	section, ok := document["shipment"]
	if !ok {
		t.Fatal(`the contract has no "shipment" machine`)
	}
	var parsed contractMachine
	if err := json.Unmarshal(section, &parsed); err != nil {
		t.Fatalf("failed to parse the shipment machine: %v", err)
	}
	return parsed
}

// TestPortMatchesContract is the test that matters for this package: it reads
// contracts/state-machines.json's `shipment` machine and asserts the Go table
// is the same machine — states, initial state, and every edge in both
// directions. A hand-rolled looser version (an extra edge someone added to
// make a bug go away) fails here rather than in production.
func TestPortMatchesContract(t *testing.T) {
	expected := loadContract(t)

	if got := custody.Initial(); got != expected.Initial {
		t.Errorf("initial state: got %q, contract says %q", got, expected.Initial)
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
	ported := custody.States()
	portedSet := map[string]struct{}{}
	for _, state := range ported {
		portedSet[state] = struct{}{}
	}
	for state := range mentioned {
		if _, ok := portedSet[state]; !ok {
			t.Errorf("the port is missing the state %q", state)
		}
	}
	for state := range portedSet {
		if _, ok := mentioned[state]; !ok {
			t.Errorf("the port invented the state %q", state)
		}
	}

	// Every edge, in both directions: nothing missing, nothing added.
	for from, tos := range expected.Transitions {
		allowed, err := custody.Allowed(from)
		if err != nil {
			t.Errorf("%v", err)
			continue
		}
		want := append([]string(nil), tos...)
		sort.Strings(want)
		if len(want) != len(allowed) {
			t.Errorf("%s: port allows %v, contract allows %v", from, allowed, want)
			continue
		}
		for i := range want {
			if want[i] != allowed[i] {
				t.Errorf("%s: port allows %v, contract allows %v", from, allowed, want)
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
			if custody.Can(from, to) != contractAllows {
				t.Errorf("%s -> %s: port says %v, contract says %v",
					from, to, !contractAllows, contractAllows)
			}
		}
	}
}

func TestCustodyArcAssertions(t *testing.T) {
	legal := []struct{ from, to string }{
		{custody.CourierAssigned, custody.PickedUp},
		{custody.PickedUp, custody.InTransit},
		{custody.InTransit, custody.DeliveryAttempted},
		{custody.DeliveryAttempted, custody.RecipientUnreachable},
		{custody.RecipientUnreachable, custody.ReturnProposed},
		{custody.RecipientUnreachable, custody.HeldAtPoint},
		{custody.RecipientUnreachable, custody.DeliveryRetry},
		{custody.ReturnProposed, custody.ReturnConsented},
		{custody.ReturnProposed, custody.HeldAtPoint},
		{custody.ReturnConsented, custody.Returning},
		{custody.Returning, custody.ReturnToSender},
		{custody.HeldAtPoint, custody.Collected},
		{custody.DeliveryRetry, custody.Delivered},
		{custody.DeliveryAttempted, custody.Delivered},
	}
	for _, tc := range legal {
		if err := custody.Assert(tc.from, tc.to); err != nil {
			t.Errorf("%s -> %s should be allowed: %v", tc.from, tc.to, err)
		}
	}

	illegal := []struct{ from, to string }{
		{custody.RecipientUnreachable, custody.Delivered},
		{custody.ReturnProposed, custody.ReturnToSender},
		{custody.HeldAtPoint, custody.ReturnConsented},
		{custody.Collected, custody.Delivered},
		{custody.ReturnToSender, custody.Collected},
	}
	for _, tc := range illegal {
		if err := custody.Assert(tc.from, tc.to); err == nil {
			t.Errorf("%s -> %s should be refused", tc.from, tc.to)
		}
	}
}

func TestUnknownStatesAreRefused(t *testing.T) {
	if err := custody.Assert("teleporting", custody.Delivered); err == nil {
		t.Fatal("an unknown source state must be refused")
	}
	if err := custody.Assert(custody.InTransit, "teleporting"); err == nil {
		t.Fatal("an unknown destination state must be refused")
	}
}

func TestCustodyTerminalStates(t *testing.T) {
	// custody-terminal is a service-level concept ("this service will not move
	// custody further"), distinct from graph-terminal: `delivered` still has a
	// legacy claims sub-flow (delivered -> claim_opened -> ...) in the full
	// shipment contract that this service does not implement or need to.
	for _, state := range custody.CustodyTerminalStates() {
		if !custody.IsCustodyTerminal(state) {
			t.Errorf("%s should count as custody-terminal", state)
		}
	}
	for _, state := range []string{custody.ReturnToSender, custody.Collected, custody.Cancelled} {
		terminal, err := custody.IsTerminal(state)
		if err != nil {
			t.Fatalf("IsTerminal(%s): %v", state, err)
		}
		if !terminal {
			t.Errorf("%s should have no outgoing contract edges", state)
		}
	}
	if custody.IsCustodyTerminal(custody.InTransit) {
		t.Error("in_transit should not count as custody-terminal")
	}
}
