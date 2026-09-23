package marketplace_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"reflect"
	"sort"
	"testing"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
)

// The shared contract fixture (testdata/business_finance_contract.json):
// payment-service's documented internal business API, as bodies. The Go
// client types must decode every documented response STRICTLY (no field
// unaccounted for), its requests must marshal to exactly the documented
// bodies, and the test double must answer the same shapes — so the client,
// the double and the contract cannot drift apart silently.

type contractOp struct {
	Method         string          `json:"method"`
	Path           string          `json:"path"`
	IdempotencyKey string          `json:"idempotencyKey"`
	Request        json.RawMessage `json:"request"`
	Response       json.RawMessage `json:"response"`
}

type businessContract struct {
	BasePath    string     `json:"basePath"`
	PolicyCheck contractOp `json:"policyCheck"`
	Reserve     contractOp `json:"reserve"`
	Commit      contractOp `json:"commit"`
	Release     contractOp `json:"release"`
	Status      contractOp `json:"status"`
	Refusals    []struct {
		Status int             `json:"status"`
		Body   json.RawMessage `json:"body"`
	} `json:"refusals"`
}

func loadBusinessContract(t *testing.T) businessContract {
	t.Helper()
	raw, err := os.ReadFile("testdata/business_finance_contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var contract businessContract
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("the fixture is JSON: %v", err)
	}
	return contract
}

func strictDecode(t *testing.T, label string, raw json.RawMessage, target any) {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		t.Fatalf("%s: the Go type does not cover the documented body: %v", label, err)
	}
}

// sameJSON compares two JSON documents semantically.
func sameJSON(t *testing.T, label string, a, b []byte) {
	t.Helper()
	var left, right any
	if err := json.Unmarshal(a, &left); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &right); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(left, right) {
		t.Fatalf("%s:\n got %s\nwant %s", label, a, b)
	}
}

// shapeOf is a document's key structure (object keys, recursively).
func shapeOf(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		shape := map[string]any{}
		for _, key := range keys {
			shape[key] = shapeOf(typed[key])
		}
		return shape
	case []any:
		if len(typed) == 0 {
			return []any{}
		}
		return []any{shapeOf(typed[0])}
	default:
		return nil
	}
}

func sameShape(t *testing.T, label string, got map[string]any, want json.RawMessage) {
	t.Helper()
	var documented map[string]any
	if err := json.Unmarshal(want, &documented); err != nil {
		t.Fatal(err)
	}
	g, w := shapeOf(got), shapeOf(documented)
	// Empty arrays carry no element shape; compare objects only where both
	// sides have one.
	if !reflect.DeepEqual(pruneEmpty(g), pruneEmpty(w)) {
		gj, _ := json.Marshal(g)
		wj, _ := json.Marshal(w)
		t.Fatalf("%s: the double's answer has another shape than the contract's:\n got %s\nwant %s", label, gj, wj)
	}
}

func pruneEmpty(shape any) any {
	switch typed := shape.(type) {
	case map[string]any:
		out := map[string]any{}
		for key, value := range typed {
			out[key] = pruneEmpty(value)
		}
		return out
	case []any:
		return []any{}
	default:
		return nil
	}
}

// TestBusinessClientMatchesTheContractFixture: every documented response
// decodes strictly into the Go client's types; every request the client
// builds marshals to exactly the documented body.
func TestBusinessClientMatchesTheContractFixture(t *testing.T) {
	contract := loadBusinessContract(t)
	if contract.BasePath != marketplace.BusinessInternalBasePath {
		t.Fatalf("base path: %s", contract.BasePath)
	}
	var verdict marketplace.BusinessPolicyVerdict
	strictDecode(t, "policy-check", contract.PolicyCheck.Response, &verdict)
	if verdict.Allowed || len(verdict.Reasons) != 2 || verdict.Available.AmountMinor != 100000 {
		t.Fatalf("policy verdict decoded: %+v", verdict)
	}
	for label, op := range map[string]contractOp{"reserve": contract.Reserve, "commit": contract.Commit, "release": contract.Release} {
		var result marketplace.BusinessOpResult
		strictDecode(t, label, op.Response, &result)
		if result.Op != label || result.Reservation.BookingRef == "" {
			t.Fatalf("%s decoded: %+v", label, result)
		}
	}
	var status marketplace.BusinessReservationStatus
	strictDecode(t, "status", contract.Status.Response, &status)
	if status.Organization == nil || status.Organization.TaxID == nil || status.CostCentre == nil || status.CostCentre.Code != "OPS" || len(status.Ops) != 2 {
		t.Fatalf("status decoded with the receipt's billing and cost centre: %+v", status)
	}
	for _, refusal := range contract.Refusals {
		var body struct {
			Code    string         `json:"code"`
			Message string         `json:"message"`
			Details map[string]any `json:"details"`
		}
		strictDecode(t, "refusal", refusal.Body, &body)
		if body.Details["reason"] == nil {
			t.Fatalf("a refusal names details.reason: %s", refusal.Body)
		}
	}

	var terms marketplace.BusinessBookingTerms
	strictDecode(t, "policy-check request", contract.PolicyCheck.Request, &terms)
	encoded, _ := json.Marshal(terms)
	sameJSON(t, "policy-check request", encoded, contract.PolicyCheck.Request)
	var reserve marketplace.BusinessBookingTerms
	strictDecode(t, "reserve request", contract.Reserve.Request, &reserve)
	encoded, _ = json.Marshal(reserve)
	sameJSON(t, "reserve request (optional fields omitted)", encoded, contract.Reserve.Request)
	if contract.Reserve.IdempotencyKey != "business:"+reserve.BookingRef+":reserve" {
		t.Fatalf("the documented reserve key: %s", contract.Reserve.IdempotencyKey)
	}
	var commit marketplace.BusinessCommitRequest
	strictDecode(t, "commit request", contract.Commit.Request, &commit)
	encoded, _ = json.Marshal(commit)
	sameJSON(t, "commit request", encoded, contract.Commit.Request)
	var release marketplace.BusinessReleaseRequest
	strictDecode(t, "release request", contract.Release.Request, &release)
	encoded, _ = json.Marshal(release)
	sameJSON(t, "release request", encoded, contract.Release.Request)
}

// TestBusinessDoubleAnswersTheContractShapes: the test double's reserve,
// commit, release and status answers have exactly the documented shapes.
func TestBusinessDoubleAnswersTheContractShapes(t *testing.T) {
	contract := loadBusinessContract(t)
	double := newBusinessDouble(t, businessServiceKey)
	booker := uuid.New()
	org := double.seedOrg(booker, uuid.New(), 5_000_000, 2_000_000)
	call := func(method, path, key string, body any) map[string]any {
		t.Helper()
		var reader *bytes.Reader
		if body != nil {
			encoded, _ := json.Marshal(body)
			reader = bytes.NewReader(encoded)
		} else {
			reader = bytes.NewReader(nil)
		}
		request, err := http.NewRequest(method, double.url()+contract.BasePath+path, reader)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Service-Key", businessServiceKey)
		request.Header.Set("X-City-ID", "TCITY")
		if key != "" {
			request.Header.Set("Idempotency-Key", key)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = response.Body.Close() }()
		var answer map[string]any
		if err := json.NewDecoder(response.Body).Decode(&answer); err != nil {
			t.Fatal(err)
		}
		if response.StatusCode >= 300 {
			t.Fatalf("%s %s answered %d: %v", method, path, response.StatusCode, answer)
		}
		return answer
	}
	ref := uuid.NewString()
	terms := marketplace.BusinessBookingTerms{BookingRef: ref, OrganizationID: org.orgID, BookerID: booker.String(),
		TravellerID: booker.String(), Service: "ride", VehicleClass: "go", AmountMinor: 250000, Currency: testCurrency}
	sameShape(t, "policy-check", call(http.MethodPost, "/policy-check", "", terms), contract.PolicyCheck.Response)
	sameShape(t, "reserve", call(http.MethodPost, "/reserve", "business:"+ref+":reserve", terms), contract.Reserve.Response)
	sameShape(t, "commit", call(http.MethodPost, "/commit", "business:"+ref+":commit",
		marketplace.BusinessCommitRequest{BookingRef: ref, ActualMinor: 215000, Currency: testCurrency}), contract.Commit.Response)
	sameShape(t, "status", call(http.MethodGet, "/reservations/"+ref, "", nil), contract.Status.Response)

	other := uuid.NewString()
	terms.BookingRef = other
	call(http.MethodPost, "/reserve", "business:"+other+":reserve", terms)
	user := booker.String()
	sameShape(t, "release", call(http.MethodPost, "/release", "business:"+other+":release", marketplace.BusinessReleaseRequest{
		BookingRef: other, CancelledBy: marketplace.BusinessCancelledBy{Party: "booker", UserID: &user}, Reason: "cancelled_by_requester",
	}), contract.Release.Response)
}
