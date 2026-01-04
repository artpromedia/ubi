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

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/config"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/database"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/handlers"
	appMiddleware "github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/middleware"
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
	defer rdb.Close()

	// Initialize handlers
	h := handlers.New(db, rdb, cfg)

	// Create router
	r := chi.NewRouter()

	// Global middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Compress(5))
	r.Use(middleware.Timeout(60 * time.Second))

	// CORS
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "X-Idempotency-Key"},
		ExposedHeaders:   []string{"X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Rate limiting
	r.Use(httprate.LimitByIP(100, time.Minute))

	// Health routes
	r.Get("/health", h.Health)
	r.Get("/health/live", h.Liveness)
	r.Get("/health/ready", h.Readiness)

	// API routes
	r.Route("/api/v1", func(r chi.Router) {
		// Deliveries
		r.Route("/deliveries", func(r chi.Router) {
			r.Use(appMiddleware.Auth(rdb, cfg.JWTSecret))
			r.Post("/", h.CreateDelivery)
			r.Get("/", h.ListDeliveries)
			r.Get("/active", h.GetActiveDeliveries)
			r.Get("/{id}", h.GetDelivery)
			r.Get("/{id}/track", h.TrackDelivery)
			r.Post("/{id}/cancel", h.CancelDelivery)
			r.Post("/{id}/tip", h.AddTip)
		})

		// Driver routes
		r.Route("/driver", func(r chi.Router) {
			r.Use(appMiddleware.Auth(rdb, cfg.JWTSecret))
			r.Use(appMiddleware.DriverOnly)
			r.Get("/deliveries/available", h.GetAvailableDeliveries)
			r.Post("/deliveries/{id}/accept", h.AcceptDelivery)
			r.Post("/deliveries/{id}/pickup", h.ConfirmPickup)
			r.Post("/deliveries/{id}/deliver", h.ConfirmDelivery)
			r.Post("/location", h.UpdateDriverLocation)
		})

		// Quotes
		r.Route("/quotes", func(r chi.Router) {
			r.Post("/", h.GetQuote)
		})

		// Zones
		r.Route("/zones", func(r chi.Router) {
			r.Get("/", h.GetZones)
			r.Get("/check", h.CheckZone)
		})

		// Webhooks (internal)
		r.Route("/webhooks", func(r chi.Router) {
			r.Use(appMiddleware.ServiceAuth(cfg.InternalServiceKey))
			r.Post("/payment", h.PaymentWebhook)
			r.Post("/order", h.OrderWebhook)
		})
	})

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
