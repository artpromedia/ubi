/*
UBI Ride Service

Slice 02 — the Move core lockstep. One ride, both apps, never out of sync:
signed server-authoritative quotes, ride creation under an idempotency key,
ring dispatch with persisted offers, an atomic accept, a geofenced arrival, a
rate-limited PIN, and a completion whose fare comes from the ledger.
*/
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/handler"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/service"
)

// Headers this service reads or echoes. The identity headers are the gateway's
// (see internal/handler/identity.go); they are listed here so CORS allows them.
const (
	headerContentType = "Content-Type"
	contentTypeJSON   = "application/json"
	headerAccept      = "Accept"
	headerRequestID   = "X-Request-ID"
	headerIdempotency = "Idempotency-Key"
)

// Config is the process configuration.
type Config struct {
	Port               string
	Environment        string
	DatabaseURL        string
	RedisURL           string
	GoogleMapsKey      string
	QuoteSigningSecret string
	InternalSecret     string
	MigrateOnBoot      bool
	DispatchInterval   time.Duration
	ConfigCacheTTL     time.Duration
	ShutdownTimeout    time.Duration
	AllowedOrigins     []string
}

func main() {
	zerolog.TimeFieldFormat = time.RFC3339
	if os.Getenv("NODE_ENV") == "development" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}

	config := loadConfig()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	runtime, err := service.Build(ctx, service.Config{
		DatabaseURL:        config.DatabaseURL,
		RedisURL:           config.RedisURL,
		QuoteSigningSecret: config.QuoteSigningSecret,
		GoogleMapsKey:      config.GoogleMapsKey,
		ConfigCacheTTL:     config.ConfigCacheTTL,
		Logger:             log.Logger,
	})
	if err != nil {
		log.Fatal().Err(err).Msg("failed to start the ride service")
	}
	defer runtime.Close()

	if config.MigrateOnBoot {
		if err := runtime.Migrate(ctx); err != nil {
			log.Fatal().Err(err).Msg("failed to apply the ride schema")
		}
		log.Info().Msg("ride schema applied")
	}

	verifier := handler.NewInternalContextVerifier(config.InternalSecret, 5*time.Minute)
	if verifier.Enabled() {
		log.Info().Msg("gateway identity signatures are required")
	} else {
		log.Warn().Msg("RIDE_INTERNAL_CONTEXT_SECRET is not set: gateway identity headers are trusted unsigned")
	}

	rideHandler := handler.NewRideHandler(runtime.Service, log.Logger)
	locationHandler := handler.NewLocationHandler(runtime.Maps)

	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(middleware.Recoverer)
	router.Use(middleware.Timeout(30 * time.Second))
	router.Use(middleware.Compress(5))
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins: config.AllowedOrigins,
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders: []string{
			headerAccept, headerContentType, headerRequestID, headerIdempotency,
			"If-None-Match",
			handler.HeaderUserID, handler.HeaderUserRole, handler.HeaderCityID,
			handler.HeaderSignature, handler.HeaderIssuedAt,
		},
		ExposedHeaders:   []string{headerRequestID, "ETag"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	router.Use(httprate.LimitByIP(300, time.Minute))

	health := newHealth(runtime, config.Environment)
	router.Get("/health/live", health.live)
	router.Get("/health/ready", health.ready)
	router.Get("/health", health.detailed)

	// Every /v1 route is behind the identity middleware. There is no route on
	// this service that serves an anonymous caller.
	router.Mount("/v1", rideHandler.Routes(handler.RequireIdentity(verifier), locationHandler))

	// The dispatcher is a sweep over durable rows, not a per-ride goroutine, so
	// a restart resumes matching instead of losing it.
	go runtime.Service.RunDispatcher(ctx, config.DispatchInterval)

	server := &http.Server{
		Addr:              ":" + config.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Info().
			Str("port", config.Port).
			Str("environment", config.Environment).
			Msg("UBI ride service listening")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("the server stopped")
		}
	}()

	<-ctx.Done()
	log.Info().Msg("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), config.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("shutdown did not complete cleanly")
	}
	log.Info().Msg("stopped")
}

func loadConfig() *Config {
	return &Config{
		Port:               getEnv("PORT", "4002"),
		Environment:        getEnv("NODE_ENV", "development"),
		DatabaseURL:        getEnv("DATABASE_URL", ""),
		RedisURL:           getEnv("REDIS_URL", ""),
		GoogleMapsKey:      getEnv("GOOGLE_MAPS_API_KEY", ""),
		QuoteSigningSecret: getEnv("RIDE_QUOTE_SIGNING_SECRET", ""),
		InternalSecret:     getEnv("RIDE_INTERNAL_CONTEXT_SECRET", ""),
		MigrateOnBoot:      getEnv("RIDE_MIGRATE_ON_BOOT", "false") == "true",
		DispatchInterval:   getDuration("RIDE_DISPATCH_INTERVAL_MS", time.Second),
		ConfigCacheTTL:     getDuration("RIDE_CONFIG_CACHE_TTL_MS", 60*time.Second),
		ShutdownTimeout:    getDuration("RIDE_SHUTDOWN_TIMEOUT_MS", 30*time.Second),
		AllowedOrigins:     []string{"https://app.ubi.africa", "https://admin.ubi.africa", "http://localhost:*"},
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getDuration(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	milliseconds, err := strconv.Atoi(raw)
	if err != nil || milliseconds <= 0 {
		log.Warn().Str("env", key).Msg("ignoring an unreadable duration")
		return fallback
	}
	return time.Duration(milliseconds) * time.Millisecond
}

// health answers the three probes an operator needs: is the process up, can it
// serve, and what does it think of its dependencies.
type health struct {
	runtime     *service.Runtime
	environment string
}

func newHealth(runtime *service.Runtime, environment string) *health {
	return &health{runtime: runtime, environment: environment}
}

func (h *health) live(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"ok","timestamp":%q}`, time.Now().UTC().Format(time.RFC3339))
}

func (h *health) ready(w http.ResponseWriter, r *http.Request) {
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := h.runtime.DB.Ping(r.Context()); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprint(w, `{"status":"not ready","dependency":"database"}`)
		return
	}
	if h.runtime.Redis != nil {
		if err := h.runtime.Redis.Ping(r.Context()).Err(); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			fmt.Fprint(w, `{"status":"not ready","dependency":"redis"}`)
			return
		}
	}
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"ready","timestamp":%q}`, time.Now().UTC().Format(time.RFC3339))
}

func (h *health) detailed(w http.ResponseWriter, r *http.Request) {
	database := "connected"
	if err := h.runtime.DB.Ping(r.Context()); err != nil {
		database = "disconnected"
	}
	redisStatus := "not configured"
	if h.runtime.Redis != nil {
		redisStatus = "connected"
		if err := h.runtime.Redis.Ping(r.Context()).Err(); err != nil {
			redisStatus = "disconnected"
		}
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w,
		`{"status":"healthy","service":"ride-service","environment":%q,"timestamp":%q,"dependencies":{"database":%q,"redis":%q}}`,
		h.environment, time.Now().UTC().Format(time.RFC3339), database, redisStatus)
}
