/*
 * Configuration
 */

package config

import (
	"os"
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

// Load loads configuration from environment
func Load() *Config {
	return &Config{
		Port:               getEnv("PORT", "4005"),
		Version:            getEnv("SERVICE_VERSION", "1.0.0"),
		Env:                getEnv("ENV", "development"),
		DatabaseURL:        getEnv("DATABASE_URL", "postgres://ubi:ubi@localhost:5432/ubi_delivery?sslmode=disable"),
		RedisURL:           getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:          getEnv("JWT_SECRET", "your-secret-key"),
		InternalServiceKey: getEnv("INTERNAL_SERVICE_KEY", "internal-key"),
		
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
