package identity

import (
	"net/http"
	"net/http/httptest"
	"strconv"
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
