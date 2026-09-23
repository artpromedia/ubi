package marketplace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
)

// eventsContractPath is the contract this package's event allowlist ports.
const eventsContractPath = "../../../../packages/contracts/src/events.ts"

// TestEventAllowlistMatchesContract: every event this service may publish,
// and every subject it publishes under, is registered in the contract's
// closed EVENT_NAMES / SUBJECT_TYPES — an unregistered name would be
// quarantined by the outbox relay instead of reaching a consumer.
func TestEventAllowlistMatchesContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Clean(eventsContractPath))
	if err != nil {
		t.Fatalf("read %s: %v", eventsContractPath, err)
	}
	contract := string(raw)
	for name := range eventNames {
		if !strings.Contains(contract, `"`+name+`"`) {
			t.Errorf("event %q is not registered in the contract's EVENT_NAMES", name)
		}
	}
	for _, subject := range []string{
		subjectRequest, subjectBid, subjectAward, subjectClaim, subjectHold, subjectRateProfile, subjectDriver,
		subjectAmendment, subjectScheduled, subjectBooking, subjectTemplate, subjectFavourite, subjectTripAccess,
		subjectBusinessBooking,
	} {
		if !strings.Contains(contract, `"`+subject+`"`) {
			t.Errorf("subject %q is not registered in the contract's SUBJECT_TYPES", subject)
		}
	}
}

// TestEventKeysFitTheEnvelope: the Book for Later events build their outbox
// keys with eventKey, which must fit the envelope's 64-character bound for
// every registered name.
func TestEventKeysFitTheEnvelope(t *testing.T) {
	for name := range eventNames {
		if !strings.HasPrefix(name, "mp.scheduled_request.") && !strings.HasPrefix(name, "mp.advance_booking.") &&
			!strings.HasPrefix(name, "mp.recurring_") {
			continue
		}
		if key := eventKey(name, "00000000-0000-0000-0000-000000000000", "2026-11-01", "43200"); len(key) > 64 {
			t.Errorf("event %q builds a %d-character key", name, len(key))
		}
	}
}

// flagsContractPath is the contract the cityconfig flag keys port.
const flagsContractPath = "../../../../packages/contracts/src/flags.ts"

// TestBusinessTravelIsRegistered: business_travel is a declared FlagKey the
// Go flag constant names exactly, and every organization.* event user-service
// publishes (BUSINESS_TRAVEL_EVENT_NAMES) is in the closed EVENT_NAMES — so
// the outbox relay never quarantines an organization or business booking
// event.
func TestBusinessTravelIsRegistered(t *testing.T) {
	flags, err := os.ReadFile(filepath.Clean(flagsContractPath))
	if err != nil {
		t.Fatalf("read %s: %v", flagsContractPath, err)
	}
	keys := string(flags)[strings.Index(string(flags), "FLAG_KEYS"):]
	keys = keys[:strings.Index(keys, "] as const")]
	if !strings.Contains(keys, `"`+cityconfig.FlagBusinessTravel+`"`) {
		t.Fatalf("%q is not a declared FlagKey", cityconfig.FlagBusinessTravel)
	}
	events, err := os.ReadFile(filepath.Clean(eventsContractPath))
	if err != nil {
		t.Fatal(err)
	}
	contract := string(events)
	names := contract[strings.Index(contract, "export const EVENT_NAMES"):]
	names = names[:strings.Index(names, "] as const")]
	business, err := os.ReadFile(filepath.Clean("../../../../packages/contracts/src/business-travel.ts"))
	if err != nil {
		t.Fatal(err)
	}
	list := string(business)[strings.Index(string(business), "export const BUSINESS_TRAVEL_EVENT_NAMES"):]
	list = list[:strings.Index(list, "] as const")]
	found := 0
	for _, line := range strings.Split(list, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, `"organization.`) {
			continue
		}
		found++
		if !strings.Contains(names, strings.TrimSuffix(line, ",")) {
			t.Errorf("%s is not registered in EVENT_NAMES", line)
		}
	}
	if found != 11 {
		t.Fatalf("expected the 11 organization events, found %d", found)
	}
}
