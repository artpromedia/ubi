package domain

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// errorsContractPath is the canonical error-code contract this file ports.
const errorsContractPath = "../../../../packages/contracts/src/errors.ts"

// contractErrorCodes reads the contract's ERROR_CODES list and its
// STATUS_BY_CODE map from the TypeScript source.
func contractErrorCodes(t *testing.T) (map[string]bool, map[string]int) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(errorsContractPath))
	if err != nil {
		t.Fatalf("read %s: %v", errorsContractPath, err)
	}
	source := string(raw)
	section := func(start, end string) string {
		from := strings.Index(source, start)
		if from < 0 {
			t.Fatalf("%s has no %q", errorsContractPath, start)
		}
		rest := source[from:]
		to := strings.Index(rest, end)
		if to < 0 {
			t.Fatalf("%s: %q is not closed by %q", errorsContractPath, start, end)
		}
		return rest[:to]
	}
	codes := map[string]bool{}
	for _, match := range regexp.MustCompile(`"([a-z_]+)"`).FindAllStringSubmatch(section("export const ERROR_CODES", "] as const"), -1) {
		codes[match[1]] = true
	}
	statuses := map[string]int{}
	for _, match := range regexp.MustCompile(`(?m)^\s*([a-z_]+):\s*(\d{3}),`).FindAllStringSubmatch(section("const STATUS_BY_CODE", "} as const"), -1) {
		status, _ := strconv.Atoi(match[2])
		statuses[match[1]] = status
	}
	if len(codes) == 0 || len(statuses) != len(codes) {
		t.Fatalf("the contract parsed to %d codes and %d statuses", len(codes), len(statuses))
	}
	return codes, statuses
}

// TestEveryCodeIsRegisteredInTheContract: every code this service can answer
// is a registered ErrorCode (packages/contracts/src/errors.ts) answering the
// same HTTP status — including internal contract A's occupancy_conflict,
// idempotency_conflict and swap_ineligible — so a client and fleet-service
// branch on one closed set.
func TestEveryCodeIsRegisteredInTheContract(t *testing.T) {
	codes, statuses := contractErrorCodes(t)
	for code, status := range statusByCode {
		if !codes[string(code)] {
			t.Errorf("%q is answered here but not registered in ERROR_CODES", code)
			continue
		}
		if statuses[string(code)] != status {
			t.Errorf("%q answers %d here but %d in the contract", code, status, statuses[string(code)])
		}
	}
	for _, fleet := range []Code{CodeOccupancyConflict, CodeIdempotencyConflict, CodeSwapIneligible} {
		if _, ok := statusByCode[fleet]; !ok {
			t.Errorf("%q has no status here", fleet)
		}
	}
}
