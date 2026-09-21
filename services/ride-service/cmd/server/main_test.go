package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestValidateIdentityConfigFailsClosedInProduction proves the boundary rule
// from configuration alone: a production process without a usable internal
// context secret, or with the development bypass set, must refuse to start.
func TestValidateIdentityConfigFailsClosedInProduction(t *testing.T) {
	cases := []struct {
		name            string
		environment     string
		verifierEnabled bool
		allowUnsigned   string
		wantError       bool
	}{
		{"production without a secret is fatal", "production", false, "", true},
		{"prod shorthand without a secret is fatal", "prod", false, "", true},
		{"PRODUCTION in caps without a secret is fatal", "PRODUCTION", false, "", true},
		{"production with padding without a secret is fatal", "  production  ", false, "", true},
		{"production with a secret boots", "production", true, "", false},
		{"the bypass is fatal in production even with a secret", "production", true, "1", true},
		{"the bypass is fatal in production whatever its value", "production", false, "false", true},
		{"development without a secret keeps today's behavior", "development", false, "", false},
		{"development with the bypass set is allowed", "development", false, "1", false},
		{"staging without a secret is not production", "staging", false, "", false},
		{"an empty environment is treated as development", "", false, "", false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			err := validateIdentityConfig(testCase.environment, testCase.verifierEnabled, testCase.allowUnsigned)
			if testCase.wantError && err == nil {
				t.Fatal("expected a fatal configuration error, got nil")
			}
			if !testCase.wantError && err != nil {
				t.Fatalf("expected the configuration to be accepted, got: %v", err)
			}
		})
	}
}

// TestBypassErrorNamesTheVariable: the refusal must tell the operator exactly
// which variable to delete, because a fatal at boot is only useful if it can
// be acted on.
func TestBypassErrorNamesTheVariable(t *testing.T) {
	err := validateIdentityConfig("production", true, "yes")
	if err == nil || !strings.Contains(err.Error(), envAllowUnsignedIdentity) {
		t.Fatalf("the bypass refusal must name %s: %v", envAllowUnsignedIdentity, err)
	}
}

// TestReadinessNeverReportsReadyWithoutIdentity: even if the fatal in main were
// ever refactored away, the readiness probe refuses to bless a production
// process whose identity boundary is unsigned — before it even looks at the
// database.
func TestReadinessNeverReportsReadyWithoutIdentity(t *testing.T) {
	probe := newHealth(nil, "production", false)

	recorder := httptest.NewRecorder()
	probe.ready(recorder, httptest.NewRequest(http.MethodGet, "/health/ready", nil))

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("readiness: got %d, want 503", recorder.Code)
	}
	if body := recorder.Body.String(); !strings.Contains(body, `"identity"`) {
		t.Fatalf("readiness must name the identity dependency: %s", body)
	}
}
