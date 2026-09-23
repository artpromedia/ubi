package marketplace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
		subjectAmendment, subjectScheduled, subjectBooking, subjectTemplate,
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
