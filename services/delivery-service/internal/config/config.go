/*
 * Configuration
 */

package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"
)

// Config holds all configuration values
type Config struct {
	Port               string
	Version            string
	Env                string
	DatabaseURL        string
	RedisURL           string
	JWTSecret          string
	InternalServiceKey string
	// InternalContextSecret verifies the gateway's signed caller identity on
	// the custody/return routes (internal/identity). It intentionally reads
	// the SAME env var ride-service reads (RIDE_INTERNAL_CONTEXT_SECRET): the
	// gateway signs one identity context per request and forwards it to
	// whichever backend the route proxies to, keyed by one shared secret, not
	// a secret per downstream service. See docs/security/INTERNAL_IDENTITY.md.
	// Required in production (ValidateIdentity).
	InternalContextSecret string
	// AllowUnsignedIdentity is RIDE_ALLOW_UNSIGNED_IDENTITY, the SAME
	// development-only bypass variable ride-service reads. It grants nothing
	// here — outside production an unset context secret already means
	// unsigned dev-trust — and is read only so production can refuse it: a
	// manifest that carries it into production fails to boot, even alongside
	// a valid secret, exactly as ride-service does.
	AllowUnsignedIdentity string

	// Pricing
	BaseFare          float64
	PerKmRate         float64
	PerMinuteRate     float64
	MinimumFare       float64
	ServiceFeePercent float64

	// Service URLs
	PaymentServiceURL string
	UserServiceURL    string
	NotificationURL   string

	// ProofStorage is the private S3-compatible bucket custody proofs live in
	// (MinIO in the Hetzner stack). Unconfigured means proof uploads and
	// proof attachment are refused, and in production readiness reports it
	// (ProofStorage.Configured / handlers.Readiness) — a custody proof is
	// never again a client-asserted string.
	ProofStorage ProofStorageConfig

	// ChargedReturnsEnabled is DELIVERY_CHARGED_RETURNS_ENABLED, the
	// deny-by-default switch for fee-bearing returns (P17). Only the literal
	// value "true" turns it on. Off: a return may only be proposed fee-free —
	// a fee is refused with CHARGED_RETURNS_NOT_OFFERED, never silently
	// dropped or recorded as payable. On: a fee is reserved from the sender's
	// wallet through payment-service's /v1/finance/delivery-returns at the
	// sender's approval and captured when the driver proves the parcel is
	// back. Turning it off stops NEW charged returns only: an already
	// reserved fee is still captured or released, never stranded.
	ChargedReturnsEnabled bool
}

// ProofStorageConfig is the proof bucket's connection. Endpoint is what this
// service talks to; PublicEndpoint (default: Endpoint) is the host a driver's
// or sender's app reaches, and the one presigned URLs are signed for — a
// SigV4 signature covers the Host header, so a URL signed for an internal
// host would not verify from outside.
type ProofStorageConfig struct {
	Endpoint       string
	PublicEndpoint string
	Region         string
	Bucket         string
	AccessKey      string
	SecretKey      string
	// UploadTTL bounds a presigned PUT; DownloadTTL a presigned GET.
	UploadTTL   time.Duration
	DownloadTTL time.Duration
}

// Proof URL lifetimes. Short by design: an upload URL is for one PUT right
// after it is issued, a download URL for one view by an entitled party.
const (
	DefaultProofUploadTTL   = 5 * time.Minute
	DefaultProofDownloadTTL = 60 * time.Second
	// MaxProofDownloadTTL caps a configured download lifetime: a proof URL is
	// a bearer credential, so it may never live long enough to be shared on.
	MaxProofDownloadTTL = 5 * time.Minute
)

// Configured reports whether every value a working proof store needs is
// present. Anything less is treated as not configured at all.
func (p ProofStorageConfig) Configured() bool {
	return strings.TrimSpace(p.Endpoint) != "" &&
		strings.TrimSpace(p.Bucket) != "" &&
		strings.TrimSpace(p.AccessKey) != "" &&
		strings.TrimSpace(p.SecretKey) != ""
}

// Validate checks the shape of a configured store (endpoints must be
// absolute http(s) URLs; TTLs within bounds). It says nothing about an
// unconfigured one — that is Configured's job.
func (p ProofStorageConfig) Validate() error {
	for name, raw := range map[string]string{"PROOF_STORAGE_ENDPOINT": p.Endpoint, "PROOF_STORAGE_PUBLIC_ENDPOINT": p.PublicEndpoint} {
		if raw == "" {
			continue
		}
		parsed, err := url.Parse(raw)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || (parsed.Path != "" && parsed.Path != "/") {
			return fmt.Errorf("%s must be an absolute http(s) URL with no path, got %q", name, raw)
		}
	}
	if p.UploadTTL <= 0 || p.UploadTTL > 15*time.Minute {
		return fmt.Errorf("the proof upload URL lifetime must be between 1s and 15m, got %s", p.UploadTTL)
	}
	if p.DownloadTTL <= 0 || p.DownloadTTL > MaxProofDownloadTTL {
		return fmt.Errorf("the proof download URL lifetime must be between 1s and %s, got %s", MaxProofDownloadTTL, p.DownloadTTL)
	}
	return nil
}

// Committed defaults. They live in this repository, so they are public
// knowledge and can never authenticate anything in production.
const (
	defaultInternalServiceKey = "internal-key"
	defaultJWTSecret          = "your-secret-key"
)

// Environment variables of the gateway trust boundary. Shared with
// ride-service by design (see InternalContextSecret); named here so every
// refusal tells the operator exactly which variable to fix.
const (
	EnvInternalContextSecret = "RIDE_INTERNAL_CONTEXT_SECRET"
	EnvAllowUnsignedIdentity = "RIDE_ALLOW_UNSIGNED_IDENTITY"
)

// Load loads configuration from environment
func Load() *Config {
	return &Config{
		Port:    getEnv("PORT", "4005"),
		Version: getEnv("SERVICE_VERSION", "1.0.0"),
		// UBI_ENV is the repo-wide deployment-environment name for Go services
		// (docs/security/INTERNAL_IDENTITY.md); ENV stays as a fallback because
		// this service historically read it.
		Env:                   getEnv("UBI_ENV", getEnv("ENV", "development")),
		DatabaseURL:           getEnv("DATABASE_URL", "postgres://ubi:ubi@localhost:5432/ubi_delivery?sslmode=disable"),
		RedisURL:              getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:             getEnv("JWT_SECRET", defaultJWTSecret),
		InternalServiceKey:    getEnv("INTERNAL_SERVICE_KEY", defaultInternalServiceKey),
		InternalContextSecret: getEnv(EnvInternalContextSecret, ""),
		AllowUnsignedIdentity: getEnv(EnvAllowUnsignedIdentity, ""),

		// Pricing defaults (NGN)
		BaseFare:          500.0,
		PerKmRate:         150.0,
		PerMinuteRate:     15.0,
		MinimumFare:       800.0,
		ServiceFeePercent: 0.05,

		// Service URLs
		PaymentServiceURL: getEnv("PAYMENT_SERVICE_URL", "http://localhost:4003"),
		UserServiceURL:    getEnv("USER_SERVICE_URL", "http://localhost:4001"),
		NotificationURL:   getEnv("NOTIFICATION_SERVICE_URL", "http://localhost:4006"),

		ProofStorage: ProofStorageConfig{
			Endpoint:       getEnv("PROOF_STORAGE_ENDPOINT", ""),
			PublicEndpoint: getEnv("PROOF_STORAGE_PUBLIC_ENDPOINT", ""),
			Region:         getEnv("PROOF_STORAGE_REGION", "us-east-1"),
			Bucket:         getEnv("PROOF_STORAGE_BUCKET", ""),
			AccessKey:      getEnv("PROOF_STORAGE_ACCESS_KEY", ""),
			SecretKey:      getEnv("PROOF_STORAGE_SECRET_KEY", ""),
			UploadTTL:      getDuration("PROOF_UPLOAD_URL_TTL", DefaultProofUploadTTL),
			DownloadTTL:    getDuration("PROOF_DOWNLOAD_URL_TTL", DefaultProofDownloadTTL),
		},
		ChargedReturnsEnabled: os.Getenv(EnvChargedReturnsEnabled) == "true",
	}
}

// EnvChargedReturnsEnabled names the charged-returns switch (see
// Config.ChargedReturnsEnabled).
const EnvChargedReturnsEnabled = "DELIVERY_CHARGED_RETURNS_ENABLED"

// getDuration reads a Go duration ("90s", "5m"); an unparsable value falls
// back to the default rather than to zero, so a typo can never mint a URL that
// lives forever or never.
func getDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if parsed, err := time.ParseDuration(value); err == nil {
			return parsed
		}
	}
	return defaultValue
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// IsProduction reports whether this configuration means real riders and real
// money. Both spellings deployments actually use are covered, so a shorthand
// cannot dodge the fail-closed rule.
func (c *Config) IsProduction() bool {
	switch strings.ToLower(strings.TrimSpace(c.Env)) {
	case "production", "prod":
		return true
	default:
		return false
	}
}

// ValidateProduction is the fail-closed startup rule, kept pure so a unit test
// can prove it: a production process whose internal service key or JWT secret
// is missing or still a committed repository default, or whose gateway
// identity boundary is unsigned (ValidateIdentity), refuses to start. The
// per-request guards — the marketplace hand-off's marketplaceAssignKeyUsable
// and the custody routes' production-posture verifier (identity.NewVerifierFor)
// — stay as the second line of defence; this makes the misconfiguration fatal
// at boot instead of a latent 403/503 (or, for JWT and the identity context, a
// forgeable caller).
func (c *Config) ValidateProduction() error {
	if !c.IsProduction() {
		return nil
	}
	if strings.TrimSpace(c.InternalServiceKey) == "" || c.InternalServiceKey == defaultInternalServiceKey {
		return fmt.Errorf("INTERNAL_SERVICE_KEY must be set to a non-default value in production: the committed default is public knowledge and cannot authenticate service calls")
	}
	if strings.TrimSpace(c.JWTSecret) == "" || c.JWTSecret == defaultJWTSecret {
		return fmt.Errorf("JWT_SECRET must be set to a non-default value in production: with the committed default anyone can mint valid sessions")
	}
	if c.ProofStorage.Configured() {
		if err := c.ProofStorage.Validate(); err != nil {
			return err
		}
	}
	if c.ChargedReturnsEnabled && strings.TrimSpace(c.PaymentServiceURL) == "" {
		return fmt.Errorf("%s is on but PAYMENT_SERVICE_URL is empty: a charged return could be approved with nowhere to reserve its fee", EnvChargedReturnsEnabled)
	}
	return c.ValidateIdentity()
}

// ValidateProofStorage is the fail-closed rule for custody proofs in
// production: without a configured, well-formed proof store the process
// stays up (the legacy routes and probes keep answering) but is never ready,
// and every proof upload/attachment is refused. Outside production an
// unconfigured store only refuses the proof routes.
func (c *Config) ValidateProofStorage() error {
	if !c.ProofStorage.Configured() {
		return fmt.Errorf("proof object storage is not configured (PROOF_STORAGE_ENDPOINT, PROOF_STORAGE_BUCKET, PROOF_STORAGE_ACCESS_KEY, PROOF_STORAGE_SECRET_KEY): custody proofs cannot be uploaded or verified")
	}
	return c.ProofStorage.Validate()
}

// ValidateIdentity is the fail-closed rule for the gateway trust boundary the
// custody/return routes sit behind — a port of ride-service's
// validateIdentityConfig (services/ride-service/cmd/server/main.go), kept pure
// so a unit test can prove it:
//
//   - production + no usable RIDE_INTERNAL_CONTEXT_SECRET (unset, blank, or a
//     key list of only separators) → error (fatal at boot);
//   - production + RIDE_ALLOW_UNSIGNED_IDENTITY set to ANY value → error
//     (fatal), even when a secret is also configured — the bypass variable
//     must never survive into a production manifest;
//   - anywhere else → nil: development keeps unsigned dev-trust, loudly
//     warned at start-up by cmd/server.
//
// handlers.Readiness reads the same rule, so even a refactored boot path would
// never report a production process with an unsigned boundary as ready.
func (c *Config) ValidateIdentity() error {
	if !c.IsProduction() {
		return nil
	}
	if strings.TrimSpace(c.AllowUnsignedIdentity) != "" {
		return fmt.Errorf("%s is set in production; it is a development-only bypass and must be removed from the environment", EnvAllowUnsignedIdentity)
	}
	if !hasContextKey(c.InternalContextSecret) {
		return fmt.Errorf("%s must be set in production: without it, the custody/return routes would trust the gateway's identity headers unsigned", EnvInternalContextSecret)
	}
	return nil
}

// hasContextKey reports whether a comma-separated key list holds at least one
// usable key, parsed exactly the way identity.NewVerifier parses it (split on
// commas, trim, drop empties) — so " , " counts as unset here just as it
// leaves the verifier disabled. config_test pins the two against each other.
func hasContextKey(secret string) bool {
	for _, part := range strings.Split(secret, ",") {
		if strings.TrimSpace(part) != "" {
			return true
		}
	}
	return false
}
