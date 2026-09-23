package marketplace

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/pricing"
	ridisc "github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/redis"
)

// The marketplace services and capacity slots the contract defines.
const (
	ServiceRide     = "ride"
	ServiceDelivery = "delivery"

	SlotCurrent = "current"
	SlotNext    = "next"
	// SlotAdvance is what an ADVANCE RESERVATION bid and award are for (A03):
	// a future pickup window on the driver's booking calendar. It is never a
	// claim slot — the booking enters the live current/next slots only at
	// activation near pickup.
	SlotAdvance = "advance"
)

// Actor is the caller, built by the handler from the signed gateway headers,
// exactly as the move package does. The marketplace reuses that one type so a
// request cannot carry two identities.
type Actor = move.Actor

// Deps are everything the marketplace engine needs; the composition root
// builds all of them.
type Deps struct {
	Store      *Store
	Config     cityconfig.Provider
	Flags      *cityconfig.Flags
	Pricing    *pricing.Engine
	Router     move.Router
	Wallet     WalletPort
	Funding    FundingPort
	Settlement SettlementPort
	Redis      *ridisc.Client
	Logger     zerolog.Logger
	// Now is injectable so expiry, cooldown and dwell tests do not sleep.
	Now func() time.Time
	// DriverProfiles resolves verified driver cards from user-service for
	// the rider's offer comparison (A06 part A). Optional: nil resolves
	// nothing and every driver renders "details unavailable" — an offer is
	// never blocked by a missing profile.
	DriverProfiles DriverProfilePort
	// Capabilities answers what is VERIFIED about accessibility and service
	// needs (A06 part D). Optional: nil is the profile-backed source, which
	// today verifies nothing — so hard requirements are honestly unavailable.
	Capabilities CapabilitySource
}

// Service is the marketplace engine core.
type Service struct {
	deps Deps
	// templateCursor is where the recurring generation pass resumes its
	// round-robin walk over active series (A03). In memory only: a fairness
	// hint, never a correctness input.
	templateCursor struct {
		mu    sync.Mutex
		after uuid.UUID
	}
}

// NewService validates its dependencies rather than discovering a nil one
// halfway through a money-adjacent transaction.
func NewService(deps Deps) (*Service, error) {
	switch {
	case deps.Store == nil:
		return nil, errors.New("marketplace service needs a store")
	case deps.Config == nil:
		return nil, errors.New("marketplace service needs a city configuration provider")
	case deps.Flags == nil:
		return nil, errors.New("marketplace service needs a feature flag evaluator")
	case deps.Pricing == nil:
		return nil, errors.New("marketplace service needs a pricing engine")
	case deps.Router == nil:
		return nil, errors.New("marketplace service needs a router")
	case deps.Wallet == nil:
		return nil, errors.New("marketplace service needs a wallet port")
	case deps.Funding == nil:
		return nil, errors.New("marketplace service needs a rider funding port")
	case deps.Settlement == nil:
		return nil, errors.New("marketplace service needs a completion settlement port")
	}
	if deps.Now == nil {
		deps.Now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{deps: deps}, nil
}

func (s *Service) now() time.Time { return s.deps.Now().UTC() }

// Store exposes the store to the sweeper and to tests.
func (s *Service) Store() *Store { return s.deps.Store }

// config reads the activated configuration for a city, failing closed.
func (s *Service) config(ctx context.Context, cityID string) (*cityconfig.CityConfig, error) {
	config, err := s.deps.Config.Config(ctx, cityID)
	if err != nil {
		return nil, asDomainError(err)
	}
	return config, nil
}

// policy reads the city's marketplace policy, failing closed with
// market_not_configured when the block is absent.
func (s *Service) policy(ctx context.Context, cityID string) (*cityconfig.CityConfig, *cityconfig.MarketplacePolicy, error) {
	config, err := s.config(ctx, cityID)
	if err != nil {
		return nil, nil, err
	}
	policy, err := config.MarketplacePolicyFor()
	if err != nil {
		return nil, nil, asDomainError(err)
	}
	return config, policy, nil
}

// serviceFlag maps a marketplace service to its vertical flag.
func serviceFlag(service string) (string, error) {
	switch service {
	case ServiceRide:
		return cityconfig.FlagMarketplaceRides, nil
	case ServiceDelivery:
		return cityconfig.FlagMarketplaceDelivery, nil
	default:
		return "", domain.Errorf(domain.CodeValidationFailed,
			"%q is not a marketplace service", service)
	}
}

// requireFlag refuses the request unless the flag is on for this city and
// user. Deny by default: a flag that cannot be evaluated is off, and an off
// flag reads as feature_disabled → 404 (CLAUDE.md #5).
func (s *Service) requireFlag(ctx context.Context, key string, actor Actor, cityID string) error {
	enabled, err := s.deps.Flags.Enabled(ctx, key, cityID, actor.UserID.String())
	if err != nil {
		s.deps.Logger.Warn().Err(err).Str("flag", key).Msg("flag evaluation failed; denying")
		return domain.Errorf(domain.CodeFeatureDisabled, "this feature is not available here")
	}
	if !enabled {
		return domain.Errorf(domain.CodeFeatureDisabled, "this feature is not available here")
	}
	return nil
}

// requireServiceFlag gates a call on the vertical of the request's service.
func (s *Service) requireServiceFlag(ctx context.Context, service string, actor Actor, cityID string) error {
	flag, err := serviceFlag(service)
	if err != nil {
		return err
	}
	return s.requireFlag(ctx, flag, actor, cityID)
}

// flagOn evaluates a flag for a user deny-by-default, turning an evaluation
// failure into "off" rather than an error: the workers' question.
func (s *Service) flagOn(ctx context.Context, key string, userID string, cityID string) bool {
	enabled, err := s.deps.Flags.Enabled(ctx, key, cityID, userID)
	return err == nil && enabled
}

// queueEnabled reports whether the queued-jobs (next slot) vertical is open,
// deny by default and without turning an evaluation failure into an error.
func (s *Service) queueEnabled(ctx context.Context, actor Actor, cityID string) bool {
	enabled, err := s.deps.Flags.Enabled(ctx, cityconfig.FlagMarketplaceQueuedJobs, cityID, actor.UserID.String())
	return err == nil && enabled
}

// asDomainError turns any error this package produces into the canonical
// error a client sees, exactly as the move package does, plus the fail-closed
// mapping for an unconfigured market.
func asDomainError(err error) *domain.Error {
	if err == nil {
		return nil
	}
	if mapped, ok := domain.AsError(err); ok {
		return mapped
	}
	switch {
	case errors.Is(err, cityconfig.ErrMarketNotConfigured):
		return domain.Errorf(domain.CodeMarketNotConfigured,
			"the negotiated-fare marketplace is not configured here").Wrap(err)
	case errors.Is(err, domain.ErrNotFound), errors.Is(err, pgx.ErrNoRows):
		return domain.Errorf(domain.CodeNotFound, "not found").Wrap(err)
	case errors.Is(err, cityconfig.ErrUnknownCity):
		return domain.Errorf(domain.CodeCityUnsupported, "this city is not open for the marketplace").Wrap(err)
	case errors.Is(err, cityconfig.ErrUnavailable):
		return domain.Errorf(domain.CodeConfigUnavailable, "city configuration is unavailable").Wrap(err)
	default:
		return domain.Errorf(domain.CodeInternalError, "the request could not be completed").Wrap(err)
	}
}
