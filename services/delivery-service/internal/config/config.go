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
	
	// Pricing
	BaseFare           float64
	PerKmRate          float64
	PerMinuteRate      float64
	MinimumFare        float64
	ServiceFeePercent  float64
	
	// Service URLs
	PaymentServiceURL  string
	UserServiceURL     string
	NotificationURL    string
}

// Committed defaults. They live in this repository, so they are public
// knowledge and can never authenticate anything in production.
const (
	defaultInternalServiceKey = "internal-key"
	defaultJWTSecret          = "your-secret-key"
)

// Load loads configuration from environment
func Load() *Config {
	return &Config{
		Port:    getEnv("PORT", "4005"),
		Version: getEnv("SERVICE_VERSION", "1.0.0"),
		// UBI_ENV is the repo-wide deployment-environment name for Go services
		// (docs/security/INTERNAL_IDENTITY.md); ENV stays as a fallback because
		// this service historically read it.
		Env:                getEnv("UBI_ENV", getEnv("ENV", "development")),
		DatabaseURL:        getEnv("DATABASE_URL", "postgres://ubi:ubi@localhost:5432/ubi_delivery?sslmode=disable"),
		RedisURL:           getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:          getEnv("JWT_SECRET", defaultJWTSecret),
		InternalServiceKey: getEnv("INTERNAL_SERVICE_KEY", defaultInternalServiceKey),
		
		// Pricing defaults (NGN)
		BaseFare:          500.0,
		PerKmRate:         150.0,
		PerMinuteRate:     15.0,
		MinimumFare:       800.0,
		ServiceFeePercent: 0.05,
		
		// Service URLs
		PaymentServiceURL:  getEnv("PAYMENT_SERVICE_URL", "http://localhost:4003"),
		UserServiceURL:     getEnv("USER_SERVICE_URL", "http://localhost:4001"),
		NotificationURL:    getEnv("NOTIFICATION_SERVICE_URL", "http://localhost:4006"),
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
// is missing or still a committed repository default refuses to start. The
// per-request guard on the marketplace hand-off (handlers.marketplaceAssignKeyUsable)
// stays as the second line of defence; this makes the misconfiguration fatal
// at boot instead of a latent 403 (or, for JWT, a forgeable session).
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
	return nil
}
