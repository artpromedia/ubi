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

// The ask-service reaches this service directly (its marketplace port) and
// signs the caller's identity itself, with a TypeScript port of the gateway
// signer (services/ask-service/src/lib/ride-context.ts). These vectors are the
// cross-language contract for that path. The SAME literals live in
// services/ask-service/tests/ride-context-vectors.ts, where
// tests/ride-context.test.ts proves the signer produces exactly these
// signatures and tests/marketplace-port.test.ts proves the port puts exactly
// these headers on the wire. Here they go through the real verifier and the
// real RequireIdentity middleware, so a drift in the payload, the encoding, the
// key-list rule or a header name turns a test red on one side instead of
// turning every assistant marketplace call into a 401.
type askDelegationVector struct {
	name      string
	secret    string // RIDE_INTERNAL_CONTEXT_SECRET as configured (key list)
	userID    string
	role      string
	cityID    string
	issuedAt  int64
	signature string
}

var askDelegationVectors = []askDelegationVector{
	{
		name:      "rider in Lagos, single key",
		secret:    "ask-delegation-vector-secret-0001",
		userID:    "3f6c1a52-8d0e-4b7a-9c21-5e4f0a9b7d13",
		role:      move.RoleRider,
		cityID:    "LOS",
		issuedAt:  1758400123,
		signature: "6wUOqkL0K4rh5FV02DcIlaNvkx1QyELUouzwXHJjWMc",
	},
	{
		name:      "driver in Accra, rotated key list (first key signs)",
		secret:    "ask-delegation-vector-new-key-0002,ask-delegation-vector-old-key-0001",
		userID:    "b2e4d6f8-1a3c-4e5f-8a9b-0c1d2e3f4a5b",
		role:      move.RoleDriver,
		cityID:    "ACC",
		issuedAt:  1758400456,
		signature: "sO6FEHob8dR2xu7m3ErEK1l12QmdcWLgpuNUOgKa_ZY",
	},
}

// askOldKeySignature is vector 2 signed with the OLD key of its rotation: an
// ask-service pod that has not rolled yet must still be accepted while the old
// key is listed.
const askOldKeySignature = "hWZeXalAF2293bRqjpA95XXC5QTwYXs9Xo9vA49oRpg"

// pinnedWindow is a verifier age window just wide enough to include a pinned
// vector's timestamp. The window is a constructor parameter of the real
// verifier; widening it for a fixed vector changes nothing else about how the
// signature is checked.
func pinnedWindow(issuedAt int64) time.Duration {
	age := time.Since(time.Unix(issuedAt, 0))
	if age < 0 {
		age = -age
	}
	return age + time.Hour
}

// askWireRequest is the request exactly as the ask-service marketplace port
// puts it on the wire: the three identity headers plus the HMAC pair.
func askWireRequest(userID, role, cityID string, issuedAt int64, signature string) *http.Request {
	request := httptest.NewRequest(http.MethodGet, "/v1/mp/requests/"+uuid.NewString(), nil)
	request.Header.Set("x-auth-user-id", userID)
	request.Header.Set("x-auth-user-role", role)
	request.Header.Set("x-auth-city-id", cityID)
	request.Header.Set("x-auth-issued-at", strconv.FormatInt(issuedAt, 10))
	request.Header.Set("x-auth-signature", signature)
	return request
}

func decodeActor(t *testing.T, recorder *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var body map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode the actor: %v", err)
	}
	return body
}

func expectUnauthorized(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want 401 (%s)", recorder.Code, recorder.Body.String())
	}
	var body domain.Error
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode the error body: %v", err)
	}
	if body.Code != domain.CodeUnauthorized {
		t.Fatalf("code: got %q, want unauthorized", body.Code)
	}
}

// TestAskDelegationVectorsAreAcceptedByTheRealVerifier: every pinned vector is
// what this service's own signer produces, and the ask-service's wire request
// carrying it passes RequireIdentity as exactly that user, role and city.
func TestAskDelegationVectorsAreAcceptedByTheRealVerifier(t *testing.T) {
	for _, vector := range askDelegationVectors {
		t.Run(vector.name, func(t *testing.T) {
			verifier := NewInternalContextVerifier(vector.secret, pinnedWindow(vector.issuedAt))

			if got := verifier.Sign(vector.userID, vector.role, vector.cityID, time.Unix(vector.issuedAt, 0)); got != vector.signature {
				t.Fatalf("signer parity: got %q, want %q — ask-service and ride-service no longer agree on the canonical payload", got, vector.signature)
			}

			recorder := serve(t, verifier, askWireRequest(vector.userID, vector.role, vector.cityID, vector.issuedAt, vector.signature))
			if recorder.Code != http.StatusOK {
				t.Fatalf("status: got %d, want 200 (%s)", recorder.Code, recorder.Body.String())
			}
			actor := decodeActor(t, recorder)
			if actor["userId"] != vector.userID || actor["role"] != vector.role || actor["cityId"] != vector.cityID {
				t.Fatalf("the actor is not the signed principal: %+v", actor)
			}
		})
	}

	t.Run("the old key of a rotation still verifies while listed", func(t *testing.T) {
		vector := askDelegationVectors[1]
		verifier := NewInternalContextVerifier(vector.secret, pinnedWindow(vector.issuedAt))
		recorder := serve(t, verifier, askWireRequest(vector.userID, vector.role, vector.cityID, vector.issuedAt, askOldKeySignature))
		if recorder.Code != http.StatusOK {
			t.Fatalf("status: got %d, want 200 (%s)", recorder.Code, recorder.Body.String())
		}
	})
}

// TestAskDelegationTamperingIsRefused: any change to a signed field, to the
// signature bytes or to its encoding is a 401 — the assistant cannot present
// an identity other than the one it signed, and neither can anyone who
// captured one of its requests.
func TestAskDelegationTamperingIsRefused(t *testing.T) {
	vector := askDelegationVectors[0]
	verifier := NewInternalContextVerifier(vector.secret, pinnedWindow(vector.issuedAt))

	cases := map[string]*http.Request{
		"another user":        askWireRequest(uuid.NewString(), vector.role, vector.cityID, vector.issuedAt, vector.signature),
		"an elevated role":    askWireRequest(vector.userID, move.RoleAdmin, vector.cityID, vector.issuedAt, vector.signature),
		"the service role":    askWireRequest(vector.userID, "service", vector.cityID, vector.issuedAt, vector.signature),
		"a swapped role":      askWireRequest(vector.userID, move.RoleDriver, vector.cityID, vector.issuedAt, vector.signature),
		"another city":        askWireRequest(vector.userID, vector.role, "ACC", vector.issuedAt, vector.signature),
		"no city":             askWireRequest(vector.userID, vector.role, "", vector.issuedAt, vector.signature),
		"a shifted timestamp": askWireRequest(vector.userID, vector.role, vector.cityID, vector.issuedAt+1, vector.signature),
		"a truncated signature": askWireRequest(vector.userID, vector.role, vector.cityID, vector.issuedAt,
			vector.signature[:len(vector.signature)-1]),
		"a padded signature": askWireRequest(vector.userID, vector.role, vector.cityID, vector.issuedAt, vector.signature+"="),
		"a signature from another request": askWireRequest(vector.userID, vector.role, vector.cityID, vector.issuedAt,
			askDelegationVectors[1].signature),
	}
	for name, request := range cases {
		t.Run(name, func(t *testing.T) {
			expectUnauthorized(t, serve(t, verifier, request))
		})
	}

	t.Run("standard base64 instead of base64url", func(t *testing.T) {
		rotated := askDelegationVectors[1]
		rotatedVerifier := NewInternalContextVerifier(rotated.secret, pinnedWindow(rotated.issuedAt))
		standard := strings.NewReplacer("-", "+", "_", "/").Replace(rotated.signature)
		if standard == rotated.signature {
			t.Fatal("the fixture must contain a base64url-only character for this case to mean anything")
		}
		expectUnauthorized(t, serve(t, rotatedVerifier,
			askWireRequest(rotated.userID, rotated.role, rotated.cityID, rotated.issuedAt, standard)))
	})
}

// TestAskDelegationWrongSecretIsRefused: a vector signed with a key this
// service does not list never verifies, and neither does a rotation's old key
// once it has been dropped.
func TestAskDelegationWrongSecretIsRefused(t *testing.T) {
	for _, vector := range askDelegationVectors {
		t.Run(vector.name, func(t *testing.T) {
			stranger := NewInternalContextVerifier("a-key-the-ask-service-never-had-0001", pinnedWindow(vector.issuedAt))
			expectUnauthorized(t, serve(t, stranger,
				askWireRequest(vector.userID, vector.role, vector.cityID, vector.issuedAt, vector.signature)))
		})
	}

	t.Run("a dropped old key", func(t *testing.T) {
		vector := askDelegationVectors[1]
		newOnly := NewInternalContextVerifier("ask-delegation-vector-new-key-0002", pinnedWindow(vector.issuedAt))
		expectUnauthorized(t, serve(t, newOnly,
			askWireRequest(vector.userID, vector.role, vector.cityID, vector.issuedAt, askOldKeySignature)))
	})
}

// TestAskDelegationClockSkewIsBounded: the verifier's age window applies on
// both sides of its clock. The pinned vectors are long past a production
// window; a fresh signature is accepted inside the window and refused outside
// it, whether stale or from the future.
func TestAskDelegationClockSkewIsBounded(t *testing.T) {
	const window = 5 * time.Minute
	vector := askDelegationVectors[0]
	verifier := NewInternalContextVerifier(vector.secret, window)

	t.Run("a pinned vector is expired under the production window", func(t *testing.T) {
		expectUnauthorized(t, serve(t, verifier,
			askWireRequest(vector.userID, vector.role, vector.cityID, vector.issuedAt, vector.signature)))
	})

	for _, testCase := range []struct {
		name     string
		offset   time.Duration
		accepted bool
	}{
		{"now", 0, true},
		{"four minutes ago", -4 * time.Minute, true},
		{"four minutes ahead", 4 * time.Minute, true},
		{"six minutes ago", -6 * time.Minute, false},
		{"six minutes ahead", 6 * time.Minute, false},
		{"an hour ago (a replay)", -time.Hour, false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			issuedAt := time.Now().Add(testCase.offset)
			signature := verifier.Sign(vector.userID, vector.role, vector.cityID, issuedAt)
			recorder := serve(t, verifier,
				askWireRequest(vector.userID, vector.role, vector.cityID, issuedAt.Unix(), signature))
			if !testCase.accepted {
				expectUnauthorized(t, recorder)
				return
			}
			if recorder.Code != http.StatusOK {
				t.Fatalf("status: got %d, want 200 inside the window (%s)", recorder.Code, recorder.Body.String())
			}
		})
	}
}

// TestAskUnsignedIdentityIsRefusedWhenSigningIsConfigured: what the ask-service
// sends when it has no key (identity headers only), and what it used to send
// (X-User-ID / X-User-Role / X-Service-Key), are both refused by a verifier with
// a secret — the production posture. The assistant has no unsigned way in.
func TestAskUnsignedIdentityIsRefusedWhenSigningIsConfigured(t *testing.T) {
	vector := askDelegationVectors[0]
	verifier := NewInternalContextVerifier(vector.secret, 5*time.Minute)

	t.Run("identity headers without the HMAC pair", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/v1/mp/quote", nil)
		request.Header.Set("x-auth-user-id", vector.userID)
		request.Header.Set("x-auth-user-role", vector.role)
		request.Header.Set("x-auth-city-id", vector.cityID)
		expectUnauthorized(t, serve(t, verifier, request))
	})

	t.Run("the headers the ask marketplace port used to send", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/v1/mp/quote", nil)
		request.Header.Set("X-User-ID", vector.userID)
		request.Header.Set("X-User-Role", vector.role)
		request.Header.Set("X-Service-Key", "internal-service-key")
		expectUnauthorized(t, serve(t, verifier, request))
	})
}
