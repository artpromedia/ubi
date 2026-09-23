package config

import (
	"strings"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/identity"
)

// strongContextSecret stands in for a real RIDE_INTERNAL_CONTEXT_SECRET in the
// production rows that are about something else, so each row fails (or boots)
// for exactly the reason its name gives.
const strongContextSecret = "a-strong-context-secret"

// TestValidateProductionFailsClosed proves the boot-time rule: a production
// process without real secrets — including the gateway identity boundary's
// RIDE_INTERNAL_CONTEXT_SECRET — or with the RIDE_ALLOW_UNSIGNED_IDENTITY
// bypass set, refuses to start; development keeps working with the committed
// defaults and unsigned dev-trust (the per-request guards still fail closed
// there where they apply).
func TestValidateProductionFailsClosed(t *testing.T) {
	cases := []struct {
		name          string
		env           string
		internalKey   string
		jwtSecret     string
		contextSecret string
		allowUnsigned string
		wantError     string // substring of the error, "" for no error
	}{
		{"production with the committed internal key default is fatal", "production", "internal-key", "a-strong-jwt-secret", strongContextSecret, "", "INTERNAL_SERVICE_KEY"},
		{"production with an empty internal key is fatal", "production", "", "a-strong-jwt-secret", strongContextSecret, "", "INTERNAL_SERVICE_KEY"},
		{"production with a whitespace internal key is fatal", "production", "   ", "a-strong-jwt-secret", strongContextSecret, "", "INTERNAL_SERVICE_KEY"},
		{"production with the committed jwt default is fatal", "production", "a-strong-internal-key", "your-secret-key", strongContextSecret, "", "JWT_SECRET"},
		{"production with an empty jwt secret is fatal", "production", "a-strong-internal-key", "", strongContextSecret, "", "JWT_SECRET"},
		{"prod shorthand is production", "prod", "internal-key", "a-strong-jwt-secret", strongContextSecret, "", "INTERNAL_SERVICE_KEY"},
		{"PRODUCTION in caps is production", "PRODUCTION", "", "a-strong-jwt-secret", strongContextSecret, "", "INTERNAL_SERVICE_KEY"},

		// The gateway identity boundary (ride-service's validateIdentityConfig, ported).
		{"production without a context secret is fatal", "production", "a-strong-internal-key", "a-strong-jwt-secret", "", "", "RIDE_INTERNAL_CONTEXT_SECRET"},
		{"production with a whitespace context secret is fatal", "production", "a-strong-internal-key", "a-strong-jwt-secret", "   ", "", "RIDE_INTERNAL_CONTEXT_SECRET"},
		{"production with a separators-only key list is fatal", "production", "a-strong-internal-key", "a-strong-jwt-secret", " , ,", "", "RIDE_INTERNAL_CONTEXT_SECRET"},
		{"prod shorthand without a context secret is fatal", "prod", "a-strong-internal-key", "a-strong-jwt-secret", "", "", "RIDE_INTERNAL_CONTEXT_SECRET"},
		{"production with padding without a context secret is fatal", "  production  ", "a-strong-internal-key", "a-strong-jwt-secret", "", "", "RIDE_INTERNAL_CONTEXT_SECRET"},
		{"the bypass is fatal in production even with a context secret", "production", "a-strong-internal-key", "a-strong-jwt-secret", strongContextSecret, "1", "RIDE_ALLOW_UNSIGNED_IDENTITY"},
		{"the bypass is fatal in production whatever its value", "production", "a-strong-internal-key", "a-strong-jwt-secret", strongContextSecret, "false", "RIDE_ALLOW_UNSIGNED_IDENTITY"},
		{"the bypass without a context secret is named first", "production", "a-strong-internal-key", "a-strong-jwt-secret", "", "true", "RIDE_ALLOW_UNSIGNED_IDENTITY"},

		{"production with real secrets boots", "production", "a-strong-internal-key", "a-strong-jwt-secret", strongContextSecret, "", ""},
		{"production with a rotation key list boots", "production", "a-strong-internal-key", "a-strong-jwt-secret", " new-key , previous-key ", "", ""},
		{"development keeps the committed defaults", "development", "internal-key", "your-secret-key", "", "", ""},
		{"development without a context secret keeps unsigned dev-trust", "development", "a-strong-internal-key", "a-strong-jwt-secret", "", "", ""},
		{"development with the bypass set is allowed", "development", "internal-key", "your-secret-key", "", "1", ""},
		{"staging is not production", "staging", "", "", "", "1", ""},
		{"an empty environment is not production", "", "", "", "", "", ""},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			cfg := &Config{
				Env:                   testCase.env,
				InternalServiceKey:    testCase.internalKey,
				JWTSecret:             testCase.jwtSecret,
				InternalContextSecret: testCase.contextSecret,
				AllowUnsignedIdentity: testCase.allowUnsigned,
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

// TestValidateIdentityStandsAlone: the readiness probe calls ValidateIdentity
// on its own, so the identity rule must not depend on the other secrets being
// valid — and must not be satisfied by them either.
func TestValidateIdentityStandsAlone(t *testing.T) {
	if err := (&Config{Env: "production", InternalContextSecret: strongContextSecret}).ValidateIdentity(); err != nil {
		t.Fatalf("a production context secret must satisfy the identity rule on its own: %v", err)
	}
	withEveryOtherSecret := &Config{Env: "production", InternalServiceKey: "a-strong-internal-key", JWTSecret: "a-strong-jwt-secret"}
	if err := withEveryOtherSecret.ValidateIdentity(); err == nil || !strings.Contains(err.Error(), EnvInternalContextSecret) {
		t.Fatalf("strong legacy secrets must not stand in for the context secret: %v", err)
	}
}

// TestContextSecretParsingAgreesWithTheVerifier pins "usable key" in config to
// the verifier's own parsing: a key list boot accepts must be one that turns
// signature checking ON, and a key list that leaves the verifier disabled must
// be refused at boot. A drift here is exactly how an unsigned production
// process would slip through.
func TestContextSecretParsingAgreesWithTheVerifier(t *testing.T) {
	for _, secret := range []string{"", " ", ",", " , ,", "k", " k ", "new,old", ", k", "k ,"} {
		cfg := &Config{Env: "production", InternalContextSecret: secret}
		bootAccepts := cfg.ValidateIdentity() == nil
		verifierEnabled := identity.NewVerifier(secret, 0).Enabled()
		if bootAccepts != verifierEnabled {
			t.Fatalf("secret %q: boot accepts = %v but verifier enabled = %v", secret, bootAccepts, verifierEnabled)
		}
	}
}

// TestLoadReadsTheIdentityBoundaryVariables proves Load wires the exact
// variables ride-service and the gateway use, so the rule above sees what a
// production manifest actually sets.
func TestLoadReadsTheIdentityBoundaryVariables(t *testing.T) {
	t.Setenv("UBI_ENV", "production")
	t.Setenv("INTERNAL_SERVICE_KEY", "a-strong-internal-key")
	t.Setenv("JWT_SECRET", "a-strong-jwt-secret")

	t.Setenv(EnvInternalContextSecret, "")
	t.Setenv(EnvAllowUnsignedIdentity, "")
	if err := Load().ValidateProduction(); err == nil || !strings.Contains(err.Error(), "RIDE_INTERNAL_CONTEXT_SECRET") {
		t.Fatalf("production without RIDE_INTERNAL_CONTEXT_SECRET must refuse to boot: %v", err)
	}

	t.Setenv(EnvInternalContextSecret, strongContextSecret)
	if err := Load().ValidateProduction(); err != nil {
		t.Fatalf("production with RIDE_INTERNAL_CONTEXT_SECRET must boot: %v", err)
	}

	t.Setenv(EnvAllowUnsignedIdentity, "1")
	if err := Load().ValidateProduction(); err == nil || !strings.Contains(err.Error(), "RIDE_ALLOW_UNSIGNED_IDENTITY") {
		t.Fatalf("production with RIDE_ALLOW_UNSIGNED_IDENTITY must refuse to boot: %v", err)
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

func strongProduction() *Config {
	return &Config{
		Env:                   "production",
		InternalServiceKey:    "a-strong-internal-key",
		JWTSecret:             "a-strong-jwt-secret",
		InternalContextSecret: strongContextSecret,
		PaymentServiceURL:     "http://payment-service:4003",
	}
}

func goodStorage() ProofStorageConfig {
	return ProofStorageConfig{
		Endpoint: "http://minio:9000", PublicEndpoint: "https://proofs.ubi.africa", Region: "us-east-1",
		Bucket: "ubi-proofs", AccessKey: "access", SecretKey: "secret",
		UploadTTL: DefaultProofUploadTTL, DownloadTTL: DefaultProofDownloadTTL,
	}
}

// TestProofStorageConfiguration: "configured" means every value is present,
// a configured store must be well-formed (a malformed one refuses boot in
// production), and URL lifetimes stay short.
func TestProofStorageConfiguration(t *testing.T) {
	if (ProofStorageConfig{}).Configured() {
		t.Fatal("an empty store is not configured")
	}
	partial := goodStorage()
	partial.SecretKey = ""
	if partial.Configured() {
		t.Fatal("a store missing its secret is not configured — never half-used")
	}
	if !goodStorage().Configured() || goodStorage().Validate() != nil {
		t.Fatalf("a complete store must be configured and valid: %v", goodStorage().Validate())
	}

	for name, mutate := range map[string]func(*ProofStorageConfig){
		"endpoint without a scheme":      func(p *ProofStorageConfig) { p.Endpoint = "minio:9000" },
		"endpoint with a path":           func(p *ProofStorageConfig) { p.Endpoint = "http://minio:9000/bucket" },
		"public endpoint not http(s)":    func(p *ProofStorageConfig) { p.PublicEndpoint = "ftp://proofs" },
		"upload URL lifetime too long":   func(p *ProofStorageConfig) { p.UploadTTL = time.Hour },
		"download URL lifetime too long": func(p *ProofStorageConfig) { p.DownloadTTL = MaxProofDownloadTTL + time.Second },
		"zero download lifetime":         func(p *ProofStorageConfig) { p.DownloadTTL = 0 },
	} {
		storage := goodStorage()
		mutate(&storage)
		if storage.Validate() == nil {
			t.Fatalf("%s must be refused", name)
		}
		cfg := strongProduction()
		cfg.ProofStorage = storage
		if cfg.ValidateProduction() == nil {
			t.Fatalf("%s must refuse to boot in production", name)
		}
	}

	cfg := strongProduction()
	if err := cfg.ValidateProofStorage(); err == nil || !strings.Contains(err.Error(), "PROOF_STORAGE_ENDPOINT") {
		t.Fatalf("an unconfigured store must be named: %v", err)
	}
	// Unconfigured storage does not stop the process booting (readiness and
	// the proof routes fail closed instead).
	if err := cfg.ValidateProduction(); err != nil {
		t.Fatalf("production boots without proof storage (and is never ready): %v", err)
	}
	cfg.ProofStorage = goodStorage()
	if err := cfg.ValidateProofStorage(); err != nil {
		t.Fatalf("a configured store validates: %v", err)
	}
}

// TestChargedReturnsAreDenyByDefault: only the literal "true" turns charged
// returns on, and turning them on without a payment-service refuses to boot.
func TestChargedReturnsAreDenyByDefault(t *testing.T) {
	for value, want := range map[string]bool{"": false, "false": false, "1": false, "TRUE": false, "yes": false, "true": true} {
		t.Setenv(EnvChargedReturnsEnabled, value)
		if got := Load().ChargedReturnsEnabled; got != want {
			t.Fatalf("%s=%q: enabled = %v, want %v", EnvChargedReturnsEnabled, value, got, want)
		}
	}

	cfg := strongProduction()
	cfg.ChargedReturnsEnabled = true
	cfg.PaymentServiceURL = ""
	if err := cfg.ValidateProduction(); err == nil || !strings.Contains(err.Error(), EnvChargedReturnsEnabled) {
		t.Fatalf("charged returns with nowhere to reserve the fee must refuse to boot: %v", err)
	}
	cfg.PaymentServiceURL = "http://payment-service:4003"
	if err := cfg.ValidateProduction(); err != nil {
		t.Fatalf("charged returns with a payment-service boot: %v", err)
	}
}

func TestLoadReadsProofStorageVariables(t *testing.T) {
	t.Setenv("PROOF_STORAGE_ENDPOINT", "http://minio:9000")
	t.Setenv("PROOF_STORAGE_PUBLIC_ENDPOINT", "https://proofs.ubi.africa")
	t.Setenv("PROOF_STORAGE_BUCKET", "ubi-proofs")
	t.Setenv("PROOF_STORAGE_ACCESS_KEY", "access")
	t.Setenv("PROOF_STORAGE_SECRET_KEY", "secret")
	t.Setenv("PROOF_DOWNLOAD_URL_TTL", "not-a-duration")
	cfg := Load()
	if !cfg.ProofStorage.Configured() || cfg.ProofStorage.PublicEndpoint != "https://proofs.ubi.africa" || cfg.ProofStorage.Region != "us-east-1" {
		t.Fatalf("proof storage = %+v", cfg.ProofStorage)
	}
	if cfg.ProofStorage.DownloadTTL != DefaultProofDownloadTTL || cfg.ProofStorage.UploadTTL != DefaultProofUploadTTL {
		t.Fatalf("an unparsable lifetime must fall back to the default, got %s / %s", cfg.ProofStorage.UploadTTL, cfg.ProofStorage.DownloadTTL)
	}
}
