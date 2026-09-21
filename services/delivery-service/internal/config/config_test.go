package config

import (
	"strings"
	"testing"
)

// TestValidateProductionFailsClosed proves the boot-time rule: a production
// process without real secrets refuses to start; development keeps working
// with the committed defaults (the per-request marketplace guard still fails
// closed there).
func TestValidateProductionFailsClosed(t *testing.T) {
	cases := []struct {
		name        string
		env         string
		internalKey string
		jwtSecret   string
		wantError   string // substring of the error, "" for no error
	}{
		{"production with the committed internal key default is fatal", "production", "internal-key", "a-strong-jwt-secret", "INTERNAL_SERVICE_KEY"},
		{"production with an empty internal key is fatal", "production", "", "a-strong-jwt-secret", "INTERNAL_SERVICE_KEY"},
		{"production with a whitespace internal key is fatal", "production", "   ", "a-strong-jwt-secret", "INTERNAL_SERVICE_KEY"},
		{"production with the committed jwt default is fatal", "production", "a-strong-internal-key", "your-secret-key", "JWT_SECRET"},
		{"production with an empty jwt secret is fatal", "production", "a-strong-internal-key", "", "JWT_SECRET"},
		{"prod shorthand is production", "prod", "internal-key", "a-strong-jwt-secret", "INTERNAL_SERVICE_KEY"},
		{"PRODUCTION in caps is production", "PRODUCTION", "", "a-strong-jwt-secret", "INTERNAL_SERVICE_KEY"},
		{"production with real secrets boots", "production", "a-strong-internal-key", "a-strong-jwt-secret", ""},
		{"development keeps the committed defaults", "development", "internal-key", "your-secret-key", ""},
		{"staging is not production", "staging", "", "", ""},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			cfg := &Config{
				Env:                testCase.env,
				InternalServiceKey: testCase.internalKey,
				JWTSecret:          testCase.jwtSecret,
			}
			err := cfg.ValidateProduction()
			if testCase.wantError == "" {
				if err != nil {
					t.Fatalf("expected the configuration to be accepted, got: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("expected a fatal configuration error, got nil")
			}
			if !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("the refusal must name %s: %v", testCase.wantError, err)
			}
		})
	}
}

func TestIsProduction(t *testing.T) {
	for env, want := range map[string]bool{
		"production": true, "prod": true, " PRODUCTION ": true,
		"development": false, "test": false, "": false, "staging": false,
	} {
		if got := (&Config{Env: env}).IsProduction(); got != want {
			t.Fatalf("IsProduction(%q): got %v, want %v", env, got, want)
		}
	}
}
