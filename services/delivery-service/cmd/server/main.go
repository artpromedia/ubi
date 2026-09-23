/*
 * Delivery Service - UBI Send (Package Delivery)
 * Main entry point
 */

package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/config"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/database"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/handlers"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/redis"
)

func main() {
	// Configure zerolog
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	if os.Getenv("ENV") == "development" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}

	// Load configuration
	cfg := config.Load()

	// Fail closed before anything is wired: in production a missing or
	// committed-default internal key / JWT secret, a missing
	// RIDE_INTERNAL_CONTEXT_SECRET, or the RIDE_ALLOW_UNSIGNED_IDENTITY bypass
	// is a refusal to start, never a warning (docs/security/INTERNAL_IDENTITY.md;
	// the identity half mirrors ride-service's validateIdentityConfig).
	if err := cfg.ValidateProduction(); err != nil {
		log.Fatal().Err(err).Msg("refusing to start: production secrets or the internal identity boundary are not configured")
	}

	log.Info().
		Str("service", "delivery-service").
		Str("version", cfg.Version).
		Msg("Starting service")

	// Initialize database
	db, err := database.New(cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to connect to database")
	}
	defer db.Close()

	// Initialize Redis
	rdb, err := redis.New(cfg.RedisURL)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to connect to Redis")
	}
	defer func() { _ = rdb.Close() }()

	// Initialize handlers
	h := handlers.New(db, rdb, cfg)

	// Router: every route this service serves, including custody/returns,
	// whose gateway-identity verifier reads the same
	// RIDE_INTERNAL_CONTEXT_SECRET the gateway signs with, in the posture the
	// environment demands (production: signature mandatory, never a fallback
	// to the plain headers). Shared with the test harness (internal/testutil)
	// so the router under test is exactly the router production serves.
	r, verifier := handlers.NewRouter(h)
	if verifier.Enabled() {
		log.Info().Msg("gateway identity signatures are required on the custody/return routes")
	} else {
		// Only reachable outside production: ValidateProduction above is fatal
		// for an unsigned boundary in production.
		log.Warn().Msg("RIDE_INTERNAL_CONTEXT_SECRET is not set: the custody/return routes trust the gateway's plain identity headers unsigned (development only)")
	}

	// Start server
	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Port),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		log.Info().Str("port", cfg.Port).Msg("Server listening")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("Server failed")
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info().Msg("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Error().Err(err).Msg("Server forced to shutdown")
	}

	log.Info().Msg("Server exited")
}
