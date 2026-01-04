/*
UBI Ride Service

High-performance ride matching, pricing, and dispatch service.
Built in Go for maximum performance in real-time operations.

Features:
  - Real-time driver matching using geospatial queries
  - Dynamic pricing based on demand, traffic, and time
  - Efficient dispatch algorithms
  - Live ride tracking via WebSockets
  - Integration with mapping services
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
	goredis "github.com/go-redis/redis/v8"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/handler"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/pricing"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/redis"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/repository"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/service"
)

// HTTP header and content type constants
const (
	headerContentType    = "Content-Type"
	contentTypeJSON      = "application/json"
	headerAccept         = "Accept"
	headerAuthorization  = "Authorization"
	headerRequestID      = "X-Request-ID"
	headerUserID         = "X-User-ID"
)

// Config holds the service configuration
type Config struct {
	Port            string
	Environment     string
	DatabaseURL     string
	RedisURL        string
	GoogleMapsKey   string
	ShutdownTimeout time.Duration
}

// App holds all application dependencies
type App struct {
	config        *Config
	db            *pgxpool.Pool
	redisClient   *goredis.Client
	driverPool    *redis.DriverPool
	rideRepo      *repository.RideRepository
	driverRepo    *repository.DriverRepository
	pricingEngine *pricing.Engine
	rideService   *service.RideService
	driverService *service.DriverService
	rideHandler   *handler.RideHandler
}

func main() {
	// Initialize logger
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	if os.Getenv("NODE_ENV") == "development" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}

	// Load configuration
	config := loadConfig()

	// Initialize application
	app, err := initializeApp(config)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to initialize application")
	}
	defer app.cleanup()

	// Create router
	r := chi.NewRouter()

	// Global middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(middleware.Compress(5))

	// CORS configuration
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"https://app.ubi.africa", "https://admin.ubi.africa", "http://localhost:*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{headerAccept, headerAuthorization, headerContentType, headerRequestID, headerUserID},
		ExposedHeaders:   []string{headerRequestID},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Rate limiting
	r.Use(httprate.LimitByIP(100, time.Minute))
	
	// Service auth middleware - extracts user from gateway headers
	r.Use(serviceAuthMiddleware)

	// Health check routes
	r.Get("/health/live", app.healthLive)
	r.Get("/health/ready", app.healthReady)
	r.Get("/health", app.healthDetailed)

	// API routes - Rider endpoints
	r.Route("/rides", func(r chi.Router) {
		r.Post("/", app.rideHandler.RequestRide)
		r.Get("/{rideId}", app.rideHandler.GetRide)
		r.Post("/{rideId}/cancel", app.rideHandler.CancelRide)
		r.Get("/{rideId}/track", app.rideHandler.TrackRide)
		r.Post("/{rideId}/rate", app.rideHandler.RateRide)
	})

	// Driver endpoints
	r.Route("/drivers", func(r chi.Router) {
		r.Put("/location", app.rideHandler.UpdateDriverLocation)
		r.Get("/nearby", app.rideHandler.GetNearbyDrivers)
	})
	
	// Driver ride management
	r.Route("/driver/rides", func(r chi.Router) {
		r.Post("/{rideId}/accept", app.rideHandler.AcceptRide)
		r.Post("/{rideId}/decline", app.rideHandler.DeclineRide)
	})

	// Pricing endpoints
	r.Route("/pricing", func(r chi.Router) {
		r.Post("/estimate", app.rideHandler.GetPriceEstimate)
		r.Get("/surge", app.rideHandler.GetSurgeMultiplier)
	})

	r.Route("/locations", func(r chi.Router) {
		r.Get("/autocomplete", autocompleteLocation)
		r.Get("/geocode", geocodeAddress)
		r.Get("/reverse", reverseGeocode)
	})

	// Create server
	server := &http.Server{
		Addr:         ":" + config.Port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server
	go func() {
		log.Info().
			Str("port", config.Port).
			Str("environment", config.Environment).
			Msg("🚗 UBI Ride Service starting")

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("Server failed to start")
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info().Msg("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), config.ShutdownTimeout)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatal().Err(err).Msg("Server forced to shutdown")
	}

	log.Info().Msg("Server exited properly")
}

// initializeApp initializes all application dependencies
func initializeApp(config *Config) (*App, error) {
	app := &App{config: config}
	
	// Initialize database connection
	if config.DatabaseURL != "" {
		poolConfig, err := pgxpool.ParseConfig(config.DatabaseURL)
		if err != nil {
			return nil, fmt.Errorf("failed to parse database URL: %w", err)
		}
		
		poolConfig.MaxConns = 25
		poolConfig.MinConns = 5
		poolConfig.MaxConnLifetime = 30 * time.Minute
		poolConfig.MaxConnIdleTime = 5 * time.Minute
		
		pool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
		if err != nil {
			return nil, fmt.Errorf("failed to create database pool: %w", err)
		}
		
		// Test connection
		if err := pool.Ping(context.Background()); err != nil {
			return nil, fmt.Errorf("failed to ping database: %w", err)
		}
		
		app.db = pool
		app.rideRepo = repository.NewRideRepository(pool)
		app.driverRepo = repository.NewDriverRepository(pool)
		
		log.Info().Msg("Database connection established")
	}
	
	// Initialize Redis connection
	if config.RedisURL != "" {
		opts, err := goredis.ParseURL(config.RedisURL)
		if err != nil {
			return nil, fmt.Errorf("failed to parse Redis URL: %w", err)
		}
		
		client := goredis.NewClient(opts)
		
		// Test connection
		if err := client.Ping(context.Background()).Err(); err != nil {
			return nil, fmt.Errorf("failed to ping Redis: %w", err)
		}
		
		app.redisClient = client
		app.driverPool = redis.NewDriverPool(client)
		
		log.Info().Msg("Redis connection established")
	}
	
	// Initialize pricing engine
	app.pricingEngine = pricing.NewEngine()
	
	// Initialize services
	app.rideService = service.NewRideService(app.rideRepo, app.driverPool, app.pricingEngine)
	app.driverService = service.NewDriverService(app.driverRepo, app.driverPool)
	
	// Initialize handlers
	app.rideHandler = handler.NewRideHandler(
		app.rideService,
		app.driverService,
		nil, // matching service injected later
		app.pricingEngine,
	)
	
	return app, nil
}

// cleanup releases all resources
func (a *App) cleanup() {
	if a.db != nil {
		a.db.Close()
		log.Info().Msg("Database connection closed")
	}
	if a.redisClient != nil {
		a.redisClient.Close()
		log.Info().Msg("Redis connection closed")
	}
}

// serviceAuthMiddleware extracts user info from gateway headers
func serviceAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract user ID from gateway header
		userID := r.Header.Get("X-User-ID")
		if userID != "" {
			ctx := context.WithValue(r.Context(), "user_id", userID)
			r = r.WithContext(ctx)
		}
		
		// Extract user role
		userRole := r.Header.Get("X-User-Role")
		if userRole != "" {
			ctx := context.WithValue(r.Context(), "user_role", userRole)
			r = r.WithContext(ctx)
		}
		
		next.ServeHTTP(w, r)
	})
}

func loadConfig() *Config {
	return &Config{
		Port:            getEnv("PORT", "4002"),
		Environment:     getEnv("NODE_ENV", "development"),
		DatabaseURL:     getEnv("DATABASE_URL", ""),
		RedisURL:        getEnv("REDIS_URL", ""),
		GoogleMapsKey:   getEnv("GOOGLE_MAPS_API_KEY", ""),
		ShutdownTimeout: 30 * time.Second,
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// Health check handlers

func (a *App) healthLive(w http.ResponseWriter, r *http.Request) {
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"ok","timestamp":"%s"}`, time.Now().UTC().Format(time.RFC3339))
}

func (a *App) healthReady(w http.ResponseWriter, r *http.Request) {
	// Check database connection
	if a.db != nil {
		if err := a.db.Ping(r.Context()); err != nil {
			w.Header().Set(headerContentType, contentTypeJSON)
			w.WriteHeader(http.StatusServiceUnavailable)
			fmt.Fprintf(w, `{"status":"not ready","error":"database unavailable"}`)
			return
		}
	}
	
	// Check Redis connection
	if a.redisClient != nil {
		if err := a.redisClient.Ping(r.Context()).Err(); err != nil {
			w.Header().Set(headerContentType, contentTypeJSON)
			w.WriteHeader(http.StatusServiceUnavailable)
			fmt.Fprintf(w, `{"status":"not ready","error":"redis unavailable"}`)
			return
		}
	}
	
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"ready","timestamp":"%s"}`, time.Now().UTC().Format(time.RFC3339))
}

func (a *App) healthDetailed(w http.ResponseWriter, r *http.Request) {
	dbStatus := "connected"
	redisStatus := "connected"
	
	if a.db != nil {
		if err := a.db.Ping(r.Context()); err != nil {
			dbStatus = "disconnected"
		}
	} else {
		dbStatus = "not configured"
	}
	
	if a.redisClient != nil {
		if err := a.redisClient.Ping(r.Context()).Err(); err != nil {
			redisStatus = "disconnected"
		}
	} else {
		redisStatus = "not configured"
	}
	
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{
		"status": "healthy",
		"timestamp": "%s",
		"version": "1.0.0",
		"service": "ride-service",
		"environment": "%s",
		"dependencies": {
			"database": "%s",
			"redis": "%s"
		}
	}`, time.Now().UTC().Format(time.RFC3339), a.config.Environment, dbStatus, redisStatus)
}

// Location service handlers (Google Maps integration)
// NOTE: Google Maps API integration pending - requires API key configuration

func writeNotImplemented(w http.ResponseWriter) {
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusNotImplemented)
	fmt.Fprintf(w, `{"error":"Not implemented - requires Google Maps API key"}`)
}

func autocompleteLocation(w http.ResponseWriter, r *http.Request) {
	// Google Places autocomplete - pending API integration
	writeNotImplemented(w)
}

func geocodeAddress(w http.ResponseWriter, r *http.Request) {
	// Google Geocoding - pending API integration
	writeNotImplemented(w)
}

func reverseGeocode(w http.ResponseWriter, r *http.Request) {
	// Reverse geocoding - pending API integration
	writeNotImplemented(w)
}
