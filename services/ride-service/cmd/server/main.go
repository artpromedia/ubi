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
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
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

// envAllowUnsignedIdentity is the explicit development-only bypass for running
// without RIDE_INTERNAL_CONTEXT_SECRET. It exists so that the unsigned posture
// is always a decision someone wrote down — and so that production can refuse
// it: a deployment that sets it in production fails to boot rather than
// quietly trusting unsigned identity headers.
const envAllowUnsignedIdentity = "RIDE_ALLOW_UNSIGNED_IDENTITY"

// Config is the process configuration.
type Config struct {
	Port               string
	Environment        string
	DatabaseURL        string
	RedisURL           string
	GoogleMapsKey      string
	QuoteSigningSecret string
	InternalSecret     string
	IdentityMaxAge     time.Duration
	AllowUnsigned      string
	MigrateOnBoot      bool
	DispatchInterval   time.Duration
	ConfigCacheTTL     time.Duration
	ShutdownTimeout    time.Duration
	AllowedOrigins     []string

	PaymentServiceURL        string
	InternalServiceKey       string
	MarketplaceSweepInterval time.Duration

	// UserServiceURL and DriverProfileServiceKey wire the verified
	// driver-profile port (A06 part A). Either empty: offers are served with
	// "details unavailable", never blocked.
	UserServiceURL          string
	DriverProfileServiceKey string

	// DeliveryServiceURL and DeliveryServiceKey wire the award saga's
	// delivery hand-off (marketplace-assign). Either empty — or the key the
	// committed delivery-service default — and every hand-off fails closed:
	// nothing is sent, the award stays pending and an alarm is logged.
	DeliveryServiceURL string
	DeliveryServiceKey string

	// TripAccessDeliveryKey / TripAccessDeliveryKid seal a guest passenger's
	// trip-link delivery (TRIP_ACCESS_DELIVERY_KEY / _KID). Either missing:
	// guest bookings are refused, fail closed — nothing is sent in clear.
	TripAccessDeliveryKey string
	TripAccessDeliveryKid string

	// Internal contract A with fleet-service (A05 fleet calendar).
	// FleetRideServiceKey (FLEET_RIDE_SERVICE_KEY) is what fleet-service
	// presents to /internal/fleet; FleetServiceURL/FleetServiceKey
	// (FLEET_SERVICE_URL / FLEET_SERVICE_KEY) are how ride-service calls it.
	// Any of them unset (or a key under 32 characters) fails closed.
	FleetRideServiceKey string
	FleetServiceURL     string
	FleetServiceKey     string
}

func main() {
	zerolog.TimeFieldFormat = time.RFC3339
	if os.Getenv("NODE_ENV") == "development" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}

	config := loadConfig()

	// The trust boundary is validated before anything is wired: in production a
	// missing internal-context secret (or an attempt to bypass it) is a refusal
	// to start, never a warning.
	verifier := handler.NewInternalContextVerifier(config.InternalSecret, config.IdentityMaxAge)
	if err := validateIdentityConfig(config.Environment, verifier.Enabled(), config.AllowUnsigned); err != nil {
		log.Fatal().Err(err).Msg("refusing to start: the internal identity boundary is not configured")
	}
	if verifier.Enabled() {
		log.Info().Msg("gateway identity signatures are required")
	} else {
		log.Warn().Msg("RIDE_INTERNAL_CONTEXT_SECRET is not set: gateway identity headers are trusted unsigned (development only)")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	runtime, err := service.Build(ctx, service.Config{
		DatabaseURL:        config.DatabaseURL,
		RedisURL:           config.RedisURL,
		QuoteSigningSecret: config.QuoteSigningSecret,
		GoogleMapsKey:      config.GoogleMapsKey,
		ConfigCacheTTL:     config.ConfigCacheTTL,
		PaymentServiceURL:  config.PaymentServiceURL,
		InternalServiceKey: config.InternalServiceKey,
		Logger:             log.Logger,

		UserServiceURL:          config.UserServiceURL,
		DriverProfileServiceKey: config.DriverProfileServiceKey,

		DeliveryServiceURL: config.DeliveryServiceURL,
		DeliveryServiceKey: config.DeliveryServiceKey,

		TripAccessDeliveryKey: config.TripAccessDeliveryKey,
		TripAccessDeliveryKid: config.TripAccessDeliveryKid,
		Environment:           config.Environment,

		FleetServiceURL: config.FleetServiceURL,
		FleetServiceKey: config.FleetServiceKey,
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

	rideHandler := handler.NewRideHandler(runtime.Service, log.Logger)
	locationHandler := handler.NewLocationHandler(runtime.Maps)

	// Who a request is counted as (internal/handler/ratelimit.go): the verified
	// ride-context actor, else the client address — forwarded headers are
	// believed only from RIDE_TRUSTED_PROXIES (the gateway), never from anyone.
	limiter := handler.NewRateLimiter(verifier, getEnv(handler.EnvTrustedProxies, ""),
		handler.DefaultRateLimit, handler.DefaultRateLimitWindow, log.Logger)
	// fleet-service's /internal/fleet calls with the VALID service key are
	// not throttled (a 429 mid-saga costs more than serving it); any other
	// key is counted per client, then refused by RequireFleetServiceKey.
	limiter.ExemptFleetServiceKey(config.FleetRideServiceKey)

	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(limiter.ClientAddress)
	router.Use(middleware.Recoverer)
	router.Use(middleware.Timeout(30 * time.Second))
	router.Use(middleware.Compress(5))
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins: config.AllowedOrigins,
		// PUT is for /v1/mp/rate-profiles (contracts/openapi/marketplace.yaml).
		AllowedMethods: []string{"GET", "POST", "PUT", "OPTIONS"},
		AllowedHeaders: []string{
			headerAccept, headerContentType, headerRequestID, headerIdempotency,
			"If-None-Match",
			handler.HeaderUserID, handler.HeaderUserRole, handler.HeaderCityID,
			handler.HeaderSignature, handler.HeaderIssuedAt,
			// A guest passenger's trip link (A06 part B) sends its token
			// here, never in the URL.
			handler.HeaderTripAccessToken,
		},
		ExposedHeaders:   []string{headerRequestID, "ETag"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	router.Use(limiter.Limit)

	// Belt and braces for the fatal above: were the process somehow running in
	// production without signature checking, readiness would still never say
	// ready, so no traffic is routed to an unauthenticated boundary.
	identityReady := verifier.Enabled() || !isProductionEnvironment(config.Environment)
	health := newHealth(runtime, config.Environment, identityReady)
	router.Get("/health/live", health.live)
	router.Get("/health/ready", health.ready)
	router.Get("/health", health.detailed)

	// Every /v1 route is behind the identity middleware except a guest
	// passenger's trip link (/v1/mp/trip-access*, A06 part B), which is
	// authenticated by its own scoped, expiring, revocable token and rate
	// limited per client and token. No route serves an anonymous caller.
	var marketplaceHandler *handler.MarketplaceHandler
	if runtime.Marketplace != nil {
		marketplaceHandler = handler.NewMarketplaceHandler(runtime.Marketplace, log.Logger)
	}
	router.Mount("/v1", rideHandler.Routes(handler.RequireIdentity(verifier), locationHandler, marketplaceHandler))
	// Internal contract A (A05 fleet calendar): fleet-service only, by
	// FLEET_RIDE_SERVICE_KEY, outside the gateway identity middleware and
	// never proxied by the client gateway. Unset key: every route refused.
	router.Mount("/internal/fleet", handler.FleetInternalRoutes(config.FleetRideServiceKey, marketplaceHandler))

	// The dispatcher is a sweep over durable rows, not a per-ride goroutine, so
	// a restart resumes matching instead of losing it.
	go runtime.Service.RunDispatcher(ctx, config.DispatchInterval)

	// The marketplace sweeper is the same shape: bid/request expiry, envelope
	// expansion and wallet recovery are durable row scans, never RAM.
	if runtime.Marketplace != nil {
		go runtime.Marketplace.RunSweeper(ctx, config.MarketplaceSweepInterval)
	}

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
		Port: getEnv("PORT", "4002"),
		// UBI_ENV is the repo-wide deployment-environment name for Go services
		// (docs/security/INTERNAL_IDENTITY.md). NODE_ENV is kept as a fallback
		// because this service historically read it.
		Environment:        getEnv("UBI_ENV", getEnv("NODE_ENV", "development")),
		DatabaseURL:        getEnv("DATABASE_URL", ""),
		RedisURL:           getEnv("REDIS_URL", ""),
		GoogleMapsKey:      getEnv("GOOGLE_MAPS_API_KEY", ""),
		QuoteSigningSecret: getEnv("RIDE_QUOTE_SIGNING_SECRET", ""),
		InternalSecret:     getEnv("RIDE_INTERNAL_CONTEXT_SECRET", ""),
		IdentityMaxAge:     getDuration("RIDE_INTERNAL_CONTEXT_MAX_AGE_MS", 5*time.Minute),
		AllowUnsigned:      getEnv(envAllowUnsignedIdentity, ""),
		MigrateOnBoot:      getEnv("RIDE_MIGRATE_ON_BOOT", "false") == "true",
		DispatchInterval:   getDuration("RIDE_DISPATCH_INTERVAL_MS", time.Second),
		ConfigCacheTTL:     getDuration("RIDE_CONFIG_CACHE_TTL_MS", 60*time.Second),
		ShutdownTimeout:    getDuration("RIDE_SHUTDOWN_TIMEOUT_MS", 30*time.Second),
		AllowedOrigins:     []string{"https://app.ubi.africa", "https://admin.ubi.africa", "http://localhost:*"},

		PaymentServiceURL:        getEnv("PAYMENT_SERVICE_URL", ""),
		InternalServiceKey:       getEnv("INTERNAL_SERVICE_KEY", ""),
		MarketplaceSweepInterval: getDuration("RIDE_MP_SWEEP_INTERVAL_MS", time.Second),

		UserServiceURL:          getEnv("USER_SERVICE_URL", ""),
		DriverProfileServiceKey: getEnv("DRIVER_PROFILE_RIDE_SERVICE_KEY", ""),

		DeliveryServiceURL: getEnv("DELIVERY_SERVICE_URL", ""),
		// delivery-service authenticates the hand-off with ITS
		// INTERNAL_SERVICE_KEY; DELIVERY_SERVICE_KEY names it when it differs
		// from the key payment-service shares.
		DeliveryServiceKey: getEnv("DELIVERY_SERVICE_KEY", getEnv("INTERNAL_SERVICE_KEY", "")),

		TripAccessDeliveryKey: getEnv("TRIP_ACCESS_DELIVERY_KEY", ""),
		TripAccessDeliveryKid: getEnv("TRIP_ACCESS_DELIVERY_KID", ""),

		FleetRideServiceKey: getEnv("FLEET_RIDE_SERVICE_KEY", ""),
		FleetServiceURL:     getEnv("FLEET_SERVICE_URL", ""),
		FleetServiceKey:     getEnv("FLEET_SERVICE_KEY", ""),
	}
}

// isProductionEnvironment reports whether an environment name means "real
// riders, real money". Both spellings deployments actually use are covered, so
// a shorthand cannot dodge the fail-closed rule.
func isProductionEnvironment(environment string) bool {
	switch strings.ToLower(strings.TrimSpace(environment)) {
	case "production", "prod":
		return true
	default:
		return false
	}
}

// validateIdentityConfig is the fail-closed rule for the gateway trust
// boundary, kept pure so a unit test can prove it:
//
//   - production + no usable RIDE_INTERNAL_CONTEXT_SECRET → error (fatal);
//   - production + RIDE_ALLOW_UNSIGNED_IDENTITY set to ANY value → error
//     (fatal), even when a secret is also configured — the bypass variable
//     must never survive into a production manifest;
//   - development keeps today's behavior (unsigned allowed, loudly warned).
func validateIdentityConfig(environment string, verifierEnabled bool, allowUnsigned string) error {
	if !isProductionEnvironment(environment) {
		return nil
	}
	if strings.TrimSpace(allowUnsigned) != "" {
		return fmt.Errorf("%s is set in production; it is a development-only bypass and must be removed from the environment", envAllowUnsignedIdentity)
	}
	if !verifierEnabled {
		return fmt.Errorf("RIDE_INTERNAL_CONTEXT_SECRET must be set in production: without it, gateway identity headers would be trusted unsigned")
	}
	return nil
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
	// identityReady is false only when this is a production process whose
	// identity boundary is unsigned — a state main() refuses to reach, but one
	// readiness must also never bless.
	identityReady bool
}

func newHealth(runtime *service.Runtime, environment string, identityReady bool) *health {
	return &health{runtime: runtime, environment: environment, identityReady: identityReady}
}

func (h *health) live(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprintf(w, `{"status":"ok","timestamp":%q}`, time.Now().UTC().Format(time.RFC3339))
}

func (h *health) ready(w http.ResponseWriter, r *http.Request) {
	w.Header().Set(headerContentType, contentTypeJSON)
	if !h.identityReady {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = fmt.Fprint(w, `{"status":"not ready","dependency":"identity"}`)
		return
	}
	if err := h.runtime.DB.Ping(r.Context()); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = fmt.Fprint(w, `{"status":"not ready","dependency":"database"}`)
		return
	}
	if h.runtime.Redis != nil {
		if err := h.runtime.Redis.Ping(r.Context()).Err(); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = fmt.Fprint(w, `{"status":"not ready","dependency":"redis"}`)
			return
		}
	}
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprintf(w, `{"status":"ready","timestamp":%q}`, time.Now().UTC().Format(time.RFC3339))
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
	_, _ = fmt.Fprintf(w,
		`{"status":"healthy","service":"ride-service","environment":%q,"timestamp":%q,"dependencies":{"database":%q,"redis":%q}}`,
		h.environment, time.Now().UTC().Format(time.RFC3339), database, redisStatus)
}
