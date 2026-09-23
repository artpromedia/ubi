package identity

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRequireIdentityRejectsMissingHeaders(t *testing.T) {
	verifier := NewVerifier("", 0)
	var called bool
	handler := RequireIdentity(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if called {
		t.Fatal("the handler must not run without a caller identity")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestRequireIdentityRejectsUnknownRole(t *testing.T) {
	verifier := NewVerifier("", 0)
	handler := RequireIdentity(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("the handler must not run for an unknown role")
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(HeaderUserID, uuid.NewString())
	req.Header.Set(HeaderUserRole, "restaurant")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestRequireIdentityAcceptsUnsignedInDevPosture(t *testing.T) {
	verifier := NewVerifier("", 0)
	var gotActor Actor
	handler := RequireIdentity(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actor, ok := ActorFrom(r.Context())
		if !ok {
			t.Fatal("expected an actor in context")
		}
		gotActor = actor
	}))

	userID := uuid.NewString()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(HeaderUserID, userID)
	req.Header.Set(HeaderUserRole, RoleDriver)
	req.Header.Set(HeaderCityID, "LOS")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if gotActor.UserID.String() != userID || gotActor.Role != RoleDriver || gotActor.CityID != "LOS" {
		t.Fatalf("unexpected actor: %+v", gotActor)
	}
}

func TestRequireIdentityRefusesUnsignedWhenSecretConfigured(t *testing.T) {
	verifier := NewVerifier("a-strong-shared-secret", time.Minute)

	handler := RequireIdentity(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("the handler must not run for an unsigned request once a secret is configured")
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(HeaderUserID, uuid.NewString())
	req.Header.Set(HeaderUserRole, RoleDriver)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestRequireIdentityAcceptsAValidSignature(t *testing.T) {
	verifier := NewVerifier("a-strong-shared-secret", time.Minute)
	userID := uuid.NewString()
	issuedAt := time.Now()
	signature := verifier.Sign(userID, RoleRider, "LOS", issuedAt)

	var called bool
	handler := RequireIdentity(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(HeaderUserID, userID)
	req.Header.Set(HeaderUserRole, RoleRider)
	req.Header.Set(HeaderCityID, "LOS")
	req.Header.Set(HeaderSignature, signature)
	req.Header.Set(HeaderIssuedAt, formatUnix(issuedAt))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !called {
		t.Fatal("expected the handler to run for a validly signed request")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestRequireIdentityRefusesATamperedSignature(t *testing.T) {
	verifier := NewVerifier("a-strong-shared-secret", time.Minute)
	userID := uuid.NewString()
	issuedAt := time.Now()
	// Signed for "rider" but the request claims "driver" — a forged escalation.
	signature := verifier.Sign(userID, RoleRider, "LOS", issuedAt)

	handler := RequireIdentity(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("a tampered role must not verify")
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(HeaderUserID, userID)
	req.Header.Set(HeaderUserRole, RoleDriver)
	req.Header.Set(HeaderCityID, "LOS")
	req.Header.Set(HeaderSignature, signature)
	req.Header.Set(HeaderIssuedAt, formatUnix(issuedAt))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func formatUnix(t time.Time) string {
	return strconv.FormatInt(t.Unix(), 10)
}

// serveWith runs one request through RequireIdentity(verifier) and reports
// whether the protected handler ran.
func serveWith(verifier *Verifier, req *http.Request) (*httptest.ResponseRecorder, bool) {
	var called bool
	handler := RequireIdentity(verifier)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec, called
}

func identityRequest(userID, role, cityID, signature string, issuedAt time.Time) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set(HeaderUserID, userID)
	req.Header.Set(HeaderUserRole, role)
	req.Header.Set(HeaderCityID, cityID)
	if signature != "" {
		req.Header.Set(HeaderSignature, signature)
		req.Header.Set(HeaderIssuedAt, formatUnix(issuedAt))
	}
	return req
}

// TestProductionVerifierWithoutAKeyRefusesEveryRequest is the per-request
// second line of defence behind the boot check: a production-posture verifier
// built without a key never falls back to trusting the plain headers.
func TestProductionVerifierWithoutAKeyRefusesEveryRequest(t *testing.T) {
	for _, secret := range []string{"", "  ", " , "} {
		verifier := NewVerifierFor(secret, time.Minute, true)
		rec, called := serveWith(verifier, identityRequest(uuid.NewString(), RoleDriver, "LOS", "", time.Time{}))
		if called {
			t.Fatalf("secret %q: the handler must not run on unsigned headers in production", secret)
		}
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("secret %q: status = %d, want 503", secret, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "IDENTITY_NOT_CONFIGURED") {
			t.Fatalf("secret %q: body must carry IDENTITY_NOT_CONFIGURED: %s", secret, rec.Body.String())
		}
	}
}

// TestNilVerifierFailsClosed: a wiring mistake is never a reason to trust
// headers.
func TestNilVerifierFailsClosed(t *testing.T) {
	rec, called := serveWith(nil, identityRequest(uuid.NewString(), RoleRider, "LOS", "", time.Time{}))
	if called || rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("a nil verifier must refuse (503) without running the handler: status = %d, called = %v", rec.Code, called)
	}
}

// TestProductionVerifierRequiresTheGatewaySignature: with a key, the
// production posture accepts only a valid, fresh gateway signature over the
// exact identity presented.
func TestProductionVerifierRequiresTheGatewaySignature(t *testing.T) {
	verifier := NewVerifierFor("a-strong-shared-secret", time.Minute, true)
	userID := uuid.NewString()
	now := time.Now()

	cases := []struct {
		name      string
		req       *http.Request
		wantCode  int
		wantAllow bool
	}{
		{"unsigned headers are refused", identityRequest(userID, RoleDriver, "LOS", "", now), http.StatusUnauthorized, false},
		{"a signature for another user is refused", identityRequest(userID, RoleDriver, "LOS", verifier.Sign(uuid.NewString(), RoleDriver, "LOS", now), now), http.StatusUnauthorized, false},
		{"a signature for another role is refused", identityRequest(userID, RoleAdmin, "LOS", verifier.Sign(userID, RoleDriver, "LOS", now), now), http.StatusUnauthorized, false},
		{"a signature for another city is refused", identityRequest(userID, RoleDriver, "NBO", verifier.Sign(userID, RoleDriver, "LOS", now), now), http.StatusUnauthorized, false},
		{"a signature under a foreign key is refused", identityRequest(userID, RoleDriver, "LOS", NewVerifier("not-the-gateway-key", 0).Sign(userID, RoleDriver, "LOS", now), now), http.StatusUnauthorized, false},
		{"an expired signature is refused", identityRequest(userID, RoleDriver, "LOS", verifier.Sign(userID, RoleDriver, "LOS", now.Add(-10*time.Minute)), now.Add(-10*time.Minute)), http.StatusUnauthorized, false},
		{"a valid gateway signature is accepted", identityRequest(userID, RoleDriver, "LOS", verifier.Sign(userID, RoleDriver, "LOS", now), now), http.StatusOK, true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			rec, called := serveWith(verifier, testCase.req)
			if called != testCase.wantAllow || rec.Code != testCase.wantCode {
				t.Fatalf("status = %d, handler ran = %v; want %d, %v (body %s)", rec.Code, called, testCase.wantCode, testCase.wantAllow, rec.Body.String())
			}
		})
	}
}

// TestDevelopmentVerifierForKeepsDevTrust: outside production the posture is
// unchanged — unsigned gateway headers still work with no key configured.
func TestDevelopmentVerifierForKeepsDevTrust(t *testing.T) {
	rec, called := serveWith(NewVerifierFor("", 0, false), identityRequest(uuid.NewString(), RoleRider, "LOS", "", time.Time{}))
	if !called || rec.Code != http.StatusOK {
		t.Fatalf("development must keep unsigned dev-trust: status = %d, called = %v", rec.Code, called)
	}
}

// TestSecretRotationAcceptsEveryListedKey: during a rotation
// ("new-key,previous-key") a signature under either key verifies, and one
// under any other key does not — so the gateway and this service can roll
// keys without a flag day.
func TestSecretRotationAcceptsEveryListedKey(t *testing.T) {
	verifier := NewVerifierFor("new-key, previous-key", time.Minute, true)
	userID := uuid.NewString()
	now := time.Now()
	for signer, wantCode := range map[string]int{"new-key": http.StatusOK, "previous-key": http.StatusOK, "retired-key": http.StatusUnauthorized} {
		signature := NewVerifier(signer, 0).Sign(userID, RoleRider, "LOS", now)
		rec, _ := serveWith(verifier, identityRequest(userID, RoleRider, "LOS", signature, now))
		if rec.Code != wantCode {
			t.Fatalf("signed with %s: status = %d, want %d", signer, rec.Code, wantCode)
		}
	}
}
