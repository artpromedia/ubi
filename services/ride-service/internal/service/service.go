// Package service is the composition root: it turns process configuration into
// a wired Move service.
//
// It exists so that main.go stays a process (flags, signals, HTTP server) and
// the decisions about what this service refuses to start without live in one
// readable place. Nothing here has business logic; everything here has a
// reason to fail loudly at boot rather than quietly at 3am.
package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	goredis "github.com/go-redis/redis/v8"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/matching"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/pricing"
	ridisc "github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/redis"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/repository"
)

// Config is everything the process needs to build the service.
type Config struct {
	DatabaseURL string
	RedisURL    string
	// QuoteSigningSecret signs quotes. There is no default and no development
	// fallback: a service that cannot sign a quote cannot make one, because an
	// unsigned quote is a fare a client could edit.
	QuoteSigningSecret string
	GoogleMapsKey      string
	ConfigCacheTTL     time.Duration
	Logger             zerolog.Logger
}

// Runtime is a wired service and the resources it owns.
type Runtime struct {
	Service *move.Service
	Maps    *geo.MapsClient
	DB      *pgxpool.Pool
	Redis   *goredis.Client
	logger  zerolog.Logger
}

// Build wires the service. It returns an error rather than a half-built
// runtime; the caller closes what it gets back.
func Build(ctx context.Context, config Config) (*Runtime, error) {
	if config.DatabaseURL == "" {
		return nil, errors.New("DATABASE_URL is required: this service has no in-memory mode")
	}

	signer, err := move.NewQuoteSigner(config.QuoteSigningSecret)
	if err != nil {
		return nil, fmt.Errorf("RIDE_QUOTE_SIGNING_SECRET: %w", err)
	}

	poolConfig, err := pgxpool.ParseConfig(config.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse DATABASE_URL: %w", err)
	}
	poolConfig.MaxConns = 25
	poolConfig.MinConns = 2
	poolConfig.MaxConnLifetime = 30 * time.Minute
	poolConfig.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create the database pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to reach the database: %w", err)
	}

	runtime := &Runtime{DB: pool, logger: config.Logger}

	if config.RedisURL != "" {
		options, err := goredis.ParseURL(config.RedisURL)
		if err != nil {
			runtime.Close()
			return nil, fmt.Errorf("failed to parse REDIS_URL: %w", err)
		}
		client := goredis.NewClient(options)
		if err := client.Ping(ctx).Err(); err != nil {
			runtime.Close()
			return nil, fmt.Errorf("failed to reach Redis: %w", err)
		}
		runtime.Redis = client
	} else {
		// Legal, and stated plainly: without Redis the accept lock and the PIN
		// rate limiter are gone, and the database constraints carry the load
		// alone. Correct, slower under a stampede.
		config.Logger.Warn().Msg("REDIS_URL is not set: accept locking and PIN rate limiting are disabled")
	}

	maps := geo.NewMapsClient(geo.MapsClientConfig{APIKey: config.GoogleMapsKey})
	runtime.Maps = maps

	var router move.Router = move.NewStraightLineRouter()
	if maps.IsConfigured() {
		router = move.NewMapsRouter(maps, router)
	} else {
		config.Logger.Warn().Msg("GOOGLE_MAPS_API_KEY is not set: routes are estimated, not measured")
	}

	moveService, err := move.NewService(move.Deps{
		Store:   move.NewStore(pool),
		Config:  cityconfig.NewStore(pool, runtime.Redis, config.ConfigCacheTTL),
		Flags:   cityconfig.NewFlags(pool),
		Pricing: pricing.NewEngine(),
		Signer:  signer,
		Router:  router,
		Redis:   ridisc.New(runtime.Redis),
		Ledger:  repository.NewLedgerRepository(pool),
		Policy:  matching.DefaultPolicy(),
		Logger:  config.Logger,
	})
	if err != nil {
		runtime.Close()
		return nil, err
	}
	runtime.Service = moveService

	return runtime, nil
}

// Migrate applies the ride schema. It is called from an explicit boot flag, not
// on every start: a service that migrates itself on every deploy will one day
// migrate itself during an incident.
func (r *Runtime) Migrate(ctx context.Context) error {
	return r.Service.Store().Migrate(ctx)
}

// Close releases the runtime's resources.
func (r *Runtime) Close() {
	if r.DB != nil {
		r.DB.Close()
	}
	if r.Redis != nil {
		if err := r.Redis.Close(); err != nil {
			r.logger.Warn().Err(err).Msg("failed to close Redis")
		}
	}
}
