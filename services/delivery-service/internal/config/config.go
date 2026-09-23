/*
 * Configuration
 */

package config

import (
	"fmt"
	"os"
	"strings"
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
	}
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
	return c.ValidateIdentity()
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
