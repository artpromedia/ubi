package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// echoActor is the handler under the identity middleware in these tests: it
// reports the actor the middleware established, so the test can see exactly
// what the service would have acted as.
func echoActor(w http.ResponseWriter, r *http.Request) {
	actor, ok := ActorFrom(r.Context())
	if !ok {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"userId": actor.UserID.String(),
		"role":   actor.Role,
		"cityId": actor.CityID,
	})
}

func serve(t *testing.T, verifier *InternalContextVerifier, request *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	RequireIdentity(verifier)(http.HandlerFunc(echoActor)).ServeHTTP(recorder, request)
	return recorder
}

// TestIdentityUsesTheGatewaysHeaderNames is the regression guard for the defect
// this fixed: the service used to read X-User-ID / X-User-Role, which the API
// gateway has never sent, so every request arrived without an identity.
func TestIdentityUsesTheGatewaysHeaderNames(t *testing.T) {
	userID := uuid.New()
	request := httptest.NewRequest(http.MethodGet, "/v1/rides/active", nil)
	request.Header.Set("x-auth-user-id", userID.String())
	request.Header.Set("x-auth-user-role", move.RoleRider)
	request.Header.Set("x-auth-city-id", "LOS")

	recorder := serve(t, NewInternalContextVerifier("", 0), request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (%s)", recorder.Code, recorder.Body.String())
	}

	var body map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode the body: %v", err)
	}
	if body["userId"] != userID.String() || body["role"] != move.RoleRider || body["cityId"] != "LOS" {
		t.Fatalf("the actor did not come from the gateway headers: %+v", body)
	}
}

func TestIdentityHeadersAreCanonicalised(t *testing.T) {
	// Go canonicalises header keys, so the gateway's lowercase spelling and the
	// canonical spelling must reach the same actor.
	userID := uuid.New()
	request := httptest.NewRequest(http.MethodGet, "/v1/rides/active", nil)
	request.Header.Set("X-Auth-User-Id", userID.String())
	request.Header.Set("X-Auth-User-Role", move.RoleDriver)

	recorder := serve(t, NewInternalContextVerifier("", 0), request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (%s)", recorder.Code, recorder.Body.String())
	}
}

// TestRequestWithoutIdentityIsRefused proves there is no anonymous fallback.
func TestRequestWithoutIdentityIsRefused(t *testing.T) {
	cases := []struct {
		name    string
		headers map[string]string
		status  int
		code    domain.Code
	}{
		{"no headers at all", map[string]string{}, http.StatusUnauthorized, domain.CodeUnauthorized},
		{
			"a user with no role",
			map[string]string{"x-auth-user-id": uuid.NewString()},
			http.StatusUnauthorized, domain.CodeUnauthorized,
		},
		{
			"a role with no user",
			map[string]string{"x-auth-user-role": move.RoleRider},
			http.StatusUnauthorized, domain.CodeUnauthorized,
		},
		{
			"the old header names the gateway never sent",
			map[string]string{"X-User-ID": uuid.NewString(), "X-User-Role": move.RoleRider},
			http.StatusUnauthorized, domain.CodeUnauthorized,
		},
		{
			"a user id that is not a user id",
			map[string]string{"x-auth-user-id": "rider-42", "x-auth-user-role": move.RoleRider},
			http.StatusUnauthorized, domain.CodeUnauthorized,
		},
		{
			"a role this service does not know",
			map[string]string{"x-auth-user-id": uuid.NewString(), "x-auth-user-role": "auditor"},
			http.StatusForbidden, domain.CodeForbidden,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/v1/rides/active", nil)
			for key, value := range testCase.headers {
				request.Header.Set(key, value)
			}
			recorder := serve(t, NewInternalContextVerifier("", 0), request)
			if recorder.Code != testCase.status {
				t.Fatalf("status: got %d, want %d (%s)", recorder.Code, testCase.status, recorder.Body.String())
			}
			var body domain.Error
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatalf("failed to decode the error body: %v", err)
			}
			if body.Code != testCase.code {
				t.Fatalf("code: got %q, want %q", body.Code, testCase.code)
			}
		})
	}
}

// TestSignedIdentityIsRequiredWhenConfigured covers the forward-compatible half:
// once the gateway signs the context it forwards, an unsigned or forged header
// set is refused, so reaching this service directly is not a way to become
// somebody.
func TestSignedIdentityIsRequiredWhenConfigured(t *testing.T) {
	const gatewaySecret = "internal-context-secret-for-the-tests"
	verifier := NewInternalContextVerifier(gatewaySecret, 5*time.Minute)
	if !verifier.Enabled() {
		t.Fatal("a configured verifier must be enabled")
	}

	userID := uuid.New()
	issuedAt := time.Now()

	t.Run("unsigned is refused", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/v1/rides/active", nil)
		request.Header.Set("x-auth-user-id", userID.String())
		request.Header.Set("x-auth-user-role", move.RoleRider)
		if recorder := serve(t, verifier, request); recorder.Code != http.StatusUnauthorized {
			t.Fatalf("status: got %d, want 401", recorder.Code)
		}
	})

	t.Run("correctly signed is accepted", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/v1/rides/active", nil)
		request.Header.Set("x-auth-user-id", userID.String())
		request.Header.Set("x-auth-user-role", move.RoleRider)
		request.Header.Set("x-auth-city-id", "LOS")
		request.Header.Set("x-auth-issued-at", formatUnix(issuedAt))
		request.Header.Set("x-auth-signature", verifier.Sign(userID.String(), move.RoleRider, "LOS", issuedAt))
		if recorder := serve(t, verifier, request); recorder.Code != http.StatusOK {
			t.Fatalf("status: got %d, want 200", recorder.Code)
		}
	})

	t.Run("a swapped role invalidates the signature", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/v1/rides/active", nil)
		request.Header.Set("x-auth-user-id", userID.String())
		// Signed as a rider, presented as a driver.
		request.Header.Set("x-auth-user-role", move.RoleDriver)
		request.Header.Set("x-auth-city-id", "LOS")
		request.Header.Set("x-auth-issued-at", formatUnix(issuedAt))
		request.Header.Set("x-auth-signature", verifier.Sign(userID.String(), move.RoleRider, "LOS", issuedAt))
		if recorder := serve(t, verifier, request); recorder.Code != http.StatusUnauthorized {
			t.Fatalf("status: got %d, want 401", recorder.Code)
		}
	})

	t.Run("a stale identity is refused", func(t *testing.T) {
		stale := time.Now().Add(-time.Hour)
		request := httptest.NewRequest(http.MethodGet, "/v1/rides/active", nil)
		request.Header.Set("x-auth-user-id", userID.String())
		request.Header.Set("x-auth-user-role", move.RoleRider)
		request.Header.Set("x-auth-issued-at", formatUnix(stale))
		request.Header.Set("x-auth-signature", verifier.Sign(userID.String(), move.RoleRider, "", stale))
		if recorder := serve(t, verifier, request); recorder.Code != http.StatusUnauthorized {
			t.Fatalf("status: got %d, want 401", recorder.Code)
		}
	})
}

func formatUnix(at time.Time) string {
	return strconv.FormatInt(at.Unix(), 10)
}

func TestETagsTrackTheRideVersion(t *testing.T) {
	if got := etagFor(4); got != `W/"4"` {
		t.Fatalf("etag: got %q, want %q", got, `W/"4"`)
	}
	if !etagMatches(`W/"4"`, `W/"4"`) {
		t.Fatal("an identical ETag must match")
	}
	if !etagMatches(`W/"2", W/"4"`, `W/"4"`) {
		t.Fatal("a list of ETags must match on any member")
	}
	if etagMatches(`W/"3"`, `W/"4"`) {
		t.Fatal("a stale ETag must not match, or a client would never see the new state")
	}
	if etagMatches("", `W/"4"`) {
		t.Fatal("an absent If-None-Match must not match")
	}
}

func TestErrorBodyIsTheCanonicalShape(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeError(recorder, domain.Errorf(domain.CodeWrongPin, "that PIN does not match").
		WithDetails(map[string]any{"attemptsLeft": 2}))

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: got %d, want 422 for wrong_pin", recorder.Code)
	}
	var body struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
		Details map[string]any `json:"details"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode the error body: %v", err)
	}
	if body.Code != string(domain.CodeWrongPin) {
		t.Fatalf("code: got %q, want wrong_pin", body.Code)
	}
	if body.Details["attemptsLeft"] != float64(2) {
		t.Fatalf("details must survive to the client: %+v", body.Details)
	}
}

func TestAnUnknownErrorNeverLeaksItsCause(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeError(recorder, errUnexpected{})

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status: got %d, want 500", recorder.Code)
	}
	if body := recorder.Body.String(); strings.Contains(body, "connection refused to 10.0.0.5") {
		t.Fatalf("an internal message reached the client: %s", body)
	}
}

type errUnexpected struct{}

func (errUnexpected) Error() string { return "connection refused to 10.0.0.5" }
