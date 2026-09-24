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
	"strings"
	"time"

	goredis "github.com/go-redis/redis/v8"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
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
	// PaymentServiceURL and InternalServiceKey wire the marketplace's wallet
	// port. Leaving them empty is legal: the marketplace surface still mounts,
	// and every funded action fails closed at the wallet instead of
	// pretending to reserve.
	PaymentServiceURL  string
	InternalServiceKey string
	Logger             zerolog.Logger
	// UserServiceURL and DriverProfileServiceKey (DRIVER_PROFILE_RIDE_SERVICE_KEY)
	// wire the verified driver-profile port for the rider's offer comparison
	// (A06 part A). Leaving either empty is legal: every driver renders
	// "details unavailable" and no offer is ever blocked by it.
	UserServiceURL          string
	DriverProfileServiceKey string
	// DeliveryServiceURL (DELIVERY_SERVICE_URL) and DeliveryServiceKey wire
	// the award saga's hand-off to delivery-service's marketplace-assign.
	// Leaving either empty is legal and fails closed: a delivery award's
	// hand-off sends nothing and stays pending, alarmed, until configured.
	DeliveryServiceURL string
	DeliveryServiceKey string
	// TripAccessDeliveryKey (TRIP_ACCESS_DELIVERY_KEY, standard base64 of 32
	// random bytes) and TripAccessDeliveryKid (TRIP_ACCESS_DELIVERY_KID) seal
	// a guest passenger's trip-link delivery to notification-service. Either
	// missing or unusable fails closed: no trip link is issued (a guest
	// booking is refused; booking for yourself is unaffected) and the phone
	// and token are never written to the outbox in clear.
	TripAccessDeliveryKey string
	TripAccessDeliveryKid string
	// Environment names the deployment (UBI_ENV); in production an unusable
	// trip-access key is logged as an alert rather than a warning.
	Environment string
	// FleetServiceURL (FLEET_SERVICE_URL) and FleetServiceKey
	// (FLEET_SERVICE_KEY, at least 32 characters) wire internal contract A's
	// fleet-service routes (A05: the vehicle a fleet driver is assigned to,
	// a vehicle's class, capacity and documents). Either unusable fails
	// closed: an advance award goes ahead without a vehicle (never blocked)
	// and no vehicle swap can be revalidated, so none is offered.
	FleetServiceURL string
	FleetServiceKey string
}

// Runtime is a wired service and the resources it owns.
type Runtime struct {
	Service     *move.Service
	Marketplace *marketplace.Service
	Maps        *geo.MapsClient
	DB          *pgxpool.Pool
	Redis       *goredis.Client
	logger      zerolog.Logger
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

	if config.PaymentServiceURL == "" {
		config.Logger.Warn().Msg("PAYMENT_SERVICE_URL is not set: marketplace bids will fail closed at the wallet")
	}
	httpWallet := marketplace.NewHTTPWallet(config.PaymentServiceURL, config.InternalServiceKey, nil)
	if config.UserServiceURL == "" || config.DriverProfileServiceKey == "" {
		config.Logger.Warn().Msg("USER_SERVICE_URL or DRIVER_PROFILE_RIDE_SERVICE_KEY is not set: offers show driver details as unavailable")
	}
	deliveryAssign := marketplace.NewHTTPDeliveryAssign(config.DeliveryServiceURL, config.DeliveryServiceKey, nil)
	if !deliveryAssign.Configured() {
		config.Logger.Warn().Msg("DELIVERY_SERVICE_URL or a non-default delivery service key is not set: marketplace delivery awards cannot be handed off")
	}
	tripAccessSealer := buildTripAccessSealer(config)
	fleetService := marketplace.NewHTTPFleetService(config.FleetServiceURL, config.FleetServiceKey, marketplace.FleetServiceOptions{})
	if !marketplace.FleetServiceConfigured(fleetService) {
		config.Logger.Warn().Msg("FLEET_SERVICE_URL or a FLEET_SERVICE_KEY of at least 32 characters is not set: advance bookings carry no fleet vehicle and no vehicle swap can be offered")
	}
	marketplaceService, err := marketplace.NewService(marketplace.Deps{
		Store:      marketplace.NewStore(pool),
		Config:     cityconfig.NewStore(pool, runtime.Redis, config.ConfigCacheTTL),
		Flags:      cityconfig.NewFlags(pool),
		Pricing:    pricing.NewEngine(),
		Router:     router,
		Wallet:     httpWallet,
		Funding:    marketplace.NewHTTPFunding(config.PaymentServiceURL, config.InternalServiceKey, nil),
		Settlement: httpWallet,
		Redis:      ridisc.New(runtime.Redis),
		Logger:     config.Logger,
		DriverProfiles: marketplace.NewHTTPDriverProfiles(config.UserServiceURL, config.DriverProfileServiceKey,
			marketplace.DriverProfilesOptions{}),
		Delivery:         deliveryAssign,
		TripAccessSealer: tripAccessSealer,
		// Business travel (A06 part C): payment-service's internal
		// /v1/finance/business, on the same URL and service key as the
		// wallet. Unwired, every business check fails closed.
		Business: marketplace.NewHTTPBusiness(config.PaymentServiceURL, config.InternalServiceKey, nil),
		// Fleet calendar (A05): fleet-service's side of contract A.
		Fleet: fleetService,
	})
	if err != nil {
		runtime.Close()
		return nil, err
	}
	runtime.Marketplace = marketplaceService

	// The move core tells the marketplace when an execution ride ends, so a
	// queued next job can be promoted; the marketplace sweep is the durable
	// backstop for this callback. Defined in move, implemented in marketplace:
	// no import cycle.
	moveService.SetExecutionObserver(marketplaceService)
	// A05: a driver going online, or a live trip starting, is checked
	// against the vehicles fleets reported off the road (post-commit; the
	// marketplace sweep backstops it).
	moveService.SetDriverActivityObserver(marketplaceService)
	// A06 part C: a rider's cancel of a marketplace ride is first asked of
	// the marketplace (a business trip's booker who left the organization
	// may not cancel a colleague's trip).
	moveService.SetRiderCancelGuard(marketplaceService)

	return runtime, nil
}

// buildTripAccessSealer turns TRIP_ACCESS_DELIVERY_KEY/KID into the sealer,
// or nil (fail closed) when either is missing or unusable. A missing key in
// production is an alert: guest bookings are refused until it is set.
func buildTripAccessSealer(config Config) *marketplace.TripAccessSealer {
	sealer, err := marketplace.NewTripAccessSealer(config.TripAccessDeliveryKey, config.TripAccessDeliveryKid)
	if err == nil {
		config.Logger.Info().Str("kid", sealer.Kid()).Msg("guest trip-link deliveries are sealed")
		return sealer
	}
	event := config.Logger.Warn()
	if isProduction(config.Environment) {
		event = config.Logger.Error().Bool("alert", true)
	}
	event.Err(err).Msg("TRIP_ACCESS_DELIVERY_KEY/KID unusable: guest passenger trip links are refused (fail closed); nothing is sent in clear")
	return nil
}

// isProduction mirrors main's production check for the two spellings
// deployments use.
func isProduction(environment string) bool {
	switch strings.ToLower(strings.TrimSpace(environment)) {
	case "production", "prod":
		return true
	default:
		return false
	}
}

// Migrate applies the ride and mp schemas. It is called from an explicit boot
// flag, not on every start: a service that migrates itself on every deploy
// will one day migrate itself during an incident.
func (r *Runtime) Migrate(ctx context.Context) error {
	if err := r.Service.Store().Migrate(ctx); err != nil {
		return err
	}
	if r.Marketplace != nil {
		return r.Marketplace.Store().Migrate(ctx)
	}
	return nil
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
