package move

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/matching"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/pricing"
	ridisc "github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/redis"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/repository"
)

// Deps are everything the service needs. They are all interfaces or concrete
// types the composition root builds; the service constructs none of them, so a
// test can point it at a real database and a fake clock.
type Deps struct {
	Store   *Store
	Config  cityconfig.Provider
	Flags   *cityconfig.Flags
	Pricing *pricing.Engine
	Signer  *QuoteSigner
	Router  Router
	Redis   *ridisc.Client
	Ledger  *repository.LedgerRepository
	Policy  matching.Policy
	Logger  zerolog.Logger
	// Now is injectable so expiry and geofence tests do not have to sleep.
	Now func() time.Time
}

// Service is the Move core.
type Service struct {
	deps Deps
}

// NewService validates its dependencies rather than discovering a nil one
// halfway through a money-moving transaction.
func NewService(deps Deps) (*Service, error) {
	switch {
	case deps.Store == nil:
		return nil, errors.New("move service needs a store")
	case deps.Config == nil:
		return nil, errors.New("move service needs a city configuration provider")
	case deps.Flags == nil:
		return nil, errors.New("move service needs a feature flag evaluator")
	case deps.Pricing == nil:
		return nil, errors.New("move service needs a pricing engine")
	case deps.Signer == nil:
		return nil, errors.New("move service needs a quote signer")
	case deps.Router == nil:
		return nil, errors.New("move service needs a router")
	}
	if deps.Now == nil {
		deps.Now = func() time.Time { return time.Now().UTC() }
	}
	deps.Policy = deps.Policy.Normalise()
	return &Service{deps: deps}, nil
}

func (s *Service) now() time.Time { return s.deps.Now().UTC() }

// Store exposes the store to the dispatcher and to tests that need to assert
// on persisted rows.
func (s *Service) Store() *Store { return s.deps.Store }

// config reads the activated configuration for a city, failing closed.
func (s *Service) config(ctx context.Context, cityID string) (*cityconfig.CityConfig, error) {
	config, err := s.deps.Config.Config(ctx, cityID)
	if err != nil {
		return nil, asDomainError(err)
	}
	return config, nil
}

// requireFlag refuses the request unless the flag is on for this city and user.
// A flag that cannot be evaluated is off, and an off flag reads as
// feature_disabled → 404, so a disabled vertical is indistinguishable from one
// that does not exist (CLAUDE.md #5).
func (s *Service) requireFlag(ctx context.Context, key string, actor Actor) error {
	enabled, err := s.deps.Flags.Enabled(ctx, key, actor.CityID, actor.UserID.String())
	if err != nil {
		s.deps.Logger.Warn().Err(err).Str("flag", key).Msg("flag evaluation failed; denying")
		return domain.Errorf(domain.CodeFeatureDisabled, "this feature is not available here")
	}
	if !enabled {
		return domain.Errorf(domain.CodeFeatureDisabled, "this feature is not available here")
	}
	return nil
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

// QuoteRequest is what a rider may ask for. Note what is absent: no fare, no
// currency, no expiry and no config version. The client says where it wants to
// go; the server says what that costs and for how long the answer stands.
type QuoteRequest struct {
	Pickup       domain.Place   `json:"pickup"`
	Dropoff      domain.Place   `json:"dropoff"`
	Stops        []domain.Place `json:"stops"`
	VehicleClass string         `json:"vehicleClass"`
}

// CreateQuote prices a trip and signs the result.
func (s *Service) CreateQuote(ctx context.Context, actor Actor, req QuoteRequest) (*QuoteView, error) {
	if !actor.IsRider() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a rider can ask for a quote")
	}
	if err := s.requireFlag(ctx, cityconfig.FlagRideRequest, actor); err != nil {
		return nil, err
	}
	if !req.Pickup.Valid() {
		return nil, domain.Errorf(domain.CodeValidationFailed, "pickup is not a valid coordinate")
	}
	if !req.Dropoff.Valid() {
		return nil, domain.Errorf(domain.CodeValidationFailed, "dropoff is not a valid coordinate")
	}
	for i, stop := range req.Stops {
		if !stop.Valid() {
			return nil, domain.Errorf(domain.CodeValidationFailed, "stop %d is not a valid coordinate", i+1)
		}
	}

	config, err := s.config(ctx, actor.CityID)
	if err != nil {
		return nil, err
	}
	if !config.SupportsVehicleClass(req.VehicleClass) {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"this city does not offer the %q class", req.VehicleClass).
			WithDetails(map[string]any{"vehicleClasses": config.VehicleClasses})
	}

	route, err := s.deps.Router.Route(ctx, req.Pickup, req.Stops, req.Dropoff)
	if err != nil {
		return nil, asDomainError(err)
	}

	fare, breakdown, err := s.deps.Pricing.Fare(config, req.VehicleClass, route.DistanceMeters, route.DurationSeconds)
	if err != nil {
		return nil, asDomainError(err)
	}

	now := s.now()
	quote := &domain.Quote{
		ID:              uuid.New(),
		CityID:          config.CityID,
		ConfigVersion:   config.Version,
		RiderID:         actor.UserID,
		VehicleClass:    req.VehicleClass,
		Pickup:          req.Pickup,
		Dropoff:         req.Dropoff,
		Stops:           req.Stops,
		DistanceMeters:  route.DistanceMeters,
		DurationSeconds: route.DurationSeconds,
		FareMinor:       fare.AmountMinor,
		Currency:        fare.Currency,
		Breakdown:       breakdown,
		// The TTL is the city's, so a market that wants a 60-second quote gets
		// one by changing config rather than by changing this service.
		ExpiresAt: now.Add(config.QuoteTTL()).Truncate(time.Second),
	}
	quote.Signature = s.deps.Signer.Sign(quote.ID, quote.FareMinor, quote.Currency, quote.ExpiresAt, quote.ConfigVersion)

	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.deps.Store.InsertQuote(ctx, tx, quote); err != nil {
			return err
		}
		return writeEvent(ctx, tx, Event{
			Name:           "quote.created",
			AggregateType:  "quote",
			AggregateID:    quote.ID.String(),
			ToVersion:      1,
			CityID:         quote.CityID,
			ActorType:      "rider",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "quote.created:" + quote.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"quoteId":       quote.ID.String(),
				"fareMinor":     quote.FareMinor,
				"currency":      quote.Currency,
				"expiresAt":     quote.ExpiresAt.Format(time.RFC3339),
				"configVersion": quote.ConfigVersion,
			},
		})
	})
	if err != nil {
		return nil, asDomainError(err)
	}

	return &QuoteView{
		QuoteID:       quote.ID,
		FareMinor:     quote.FareMinor,
		Currency:      quote.Currency,
		ExpiresAt:     quote.ExpiresAt,
		Signature:     quote.Signature,
		ConfigVersion: quote.ConfigVersion,
		VehicleClass:  quote.VehicleClass,
		Distance:      quote.DistanceMeters,
		Duration:      quote.DurationSeconds,
		Breakdown:     quote.Breakdown,
	}, nil
}

// ---------------------------------------------------------------------------
// Ride creation
// ---------------------------------------------------------------------------

// CreateRideRequest is the whole of what a client may send to start a ride.
// There is no fare, no currency and no status in it: the fare comes from the
// signed quote and the status is the server's to decide.
type CreateRideRequest struct {
	QuoteID         uuid.UUID `json:"quoteId"`
	Signature       string    `json:"signature"`
	PaymentMethodID string    `json:"paymentMethodId"`
}

const createRideScope = "ride.create"

// CreateRide turns a signed quote into a searching ride.
//
// The quote's signature and expiry are re-checked against the stored row, the
// city config version is pinned onto the ride, a pickup PIN is generated and
// hashed, and the ride, its outbox event, its audit row and the idempotency
// record are all written in one transaction. A replay of the same key returns
// the original ride without creating a second one.
func (s *Service) CreateRide(ctx context.Context, actor Actor, req CreateRideRequest, idempotencyKey string) (*CreateRideResult, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only a rider can request a ride")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	if err := s.requireFlag(ctx, cityconfig.FlagRideRequest, actor); err != nil {
		return nil, 0, err
	}

	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), createRideScope, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view RideView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		// The PIN is deliberately absent from a replay: it is hashed at rest,
		// so the server cannot restate it, and it is never stored in the
		// idempotency record where it would outlive the ride.
		return &CreateRideResult{RideView: &view}, replay.StatusCode, nil
	}

	quote, err := s.deps.Store.Quote(ctx, s.deps.Store.Pool(), req.QuoteID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that quote does not exist")
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if quote.RiderID != actor.UserID {
		// Answering "not found" rather than "forbidden" keeps a quote id from
		// being a probe for another rider's trip.
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that quote does not exist")
	}
	if !s.deps.Signer.Verify(req.Signature, quote.ID, quote.FareMinor, quote.Currency, quote.ExpiresAt, quote.ConfigVersion) {
		return nil, 0, domain.Errorf(domain.CodeQuoteSignatureInvalid,
			"this quote's signature does not match the quote the server issued")
	}
	now := s.now()
	if quote.Expired(now) {
		return nil, 0, domain.Errorf(domain.CodeQuoteExpired, "this quote has expired; ask for a new one")
	}
	if quote.ConsumedBy != nil {
		return nil, 0, domain.Errorf(domain.CodeConflict, "this quote has already been used for another ride")
	}

	config, err := s.config(ctx, quote.CityID)
	if err != nil {
		return nil, 0, err
	}
	if config.Version != quote.ConfigVersion {
		// The fare was priced under a version that is no longer active. Re-quote
		// rather than charging yesterday's price or silently repricing.
		return nil, 0, domain.Errorf(domain.CodeQuoteExpired,
			"the city configuration changed after this quote was issued; ask for a new one").
			WithDetails(map[string]any{"quotedVersion": quote.ConfigVersion, "activeVersion": config.Version})
	}
	if available, reason := config.PaymentMethodAvailable(req.PaymentMethodID); !available {
		return nil, 0, domain.Errorf(domain.CodePaymentMethodUnavailable,
			"%s cannot be used in this city", req.PaymentMethodID).
			WithDetails(map[string]any{"paymentMethodId": req.PaymentMethodID, "reason": reason})
	}

	if existing, err := s.deps.Store.ActiveRideForRider(ctx, s.deps.Store.Pool(), actor.UserID); err == nil {
		return nil, 0, domain.Errorf(domain.CodeConflict, "you already have a ride in progress").
			WithDetails(map[string]any{"rideId": existing.ID.String(), "state": existing.State})
	} else if !errors.Is(err, domain.ErrNotFound) {
		return nil, 0, asDomainError(err)
	}

	pin, err := generatePIN()
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	pinHash, err := hashPIN(pin)
	if err != nil {
		return nil, 0, asDomainError(err)
	}

	ride := &domain.Ride{
		ID:              uuid.New(),
		CityID:          quote.CityID,
		ConfigVersion:   quote.ConfigVersion,
		QuoteID:         quote.ID,
		RiderID:         actor.UserID,
		State:           machine.RiderRequesting,
		Version:         1,
		Active:          true,
		VehicleClass:    quote.VehicleClass,
		PaymentMethodID: req.PaymentMethodID,
		Pickup:          quote.Pickup,
		Dropoff:         quote.Dropoff,
		QuotedFareMinor: quote.FareMinor,
		Currency:        quote.Currency,
	}

	var view *RideView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.deps.Store.InsertRide(ctx, tx, ride, pinHash); err != nil {
			return err
		}
		if err := s.deps.Store.ConsumeQuote(ctx, tx, quote.ID, ride.ID); err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "ride.requested",
			AggregateType:  "ride",
			AggregateID:    ride.ID.String(),
			ToVersion:      ride.Version,
			CityID:         ride.CityID,
			ActorType:      "rider",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "ride.requested:" + ride.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"rideId":        ride.ID.String(),
				"quoteId":       quote.ID.String(),
				"paymentMethod": req.PaymentMethodID,
				"pickup":        map[string]any{"lat": ride.Pickup.Lat, "lng": ride.Pickup.Lng},
				"dropoff":       map[string]any{"lat": ride.Dropoff.Lat, "lng": ride.Dropoff.Lng},
			},
		}); err != nil {
			return err
		}

		// requesting → matching is a contract transition, not a free relabel:
		// the machine is asked before the row moves.
		fromVersion := ride.Version
		moved, err := s.deps.Store.Transition(ctx, tx, ride, machine.RiderMatching, RideUpdate{})
		if err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "matching.restarted",
			AggregateType:  "ride",
			AggregateID:    ride.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         ride.CityID,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "matching.restarted:" + ride.ID.String() + ":" + itoa(moved.Version),
			OccurredAt:     now,
			Payload:        map[string]any{"rideId": ride.ID.String(), "reason": "requested"},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "ride.requested",
			SubjectType: "ride",
			SubjectID:   ride.ID.String(),
			After: map[string]any{
				"state":           moved.State,
				"quoteId":         quote.ID.String(),
				"configVersion":   ride.ConfigVersion,
				"quotedFareMinor": ride.QuotedFareMinor,
				"currency":        ride.Currency,
				"paymentMethodId": ride.PaymentMethodID,
			},
			Reason: "rider requested a ride",
		}); err != nil {
			return err
		}

		view = viewOf(moved, config.PinRequired)
		return s.deps.Store.SaveIdempotent(ctx, tx, createRideScope, actor.UserID, idempotencyKey, req, 201, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}

	// Dispatch immediately. This is the difference between a ride that is
	// "searching" on a screen and one a driver can actually see: the first ring
	// of offers is created here, and the dispatcher's sweep only handles the
	// retries and the expiries after it.
	if err := s.Dispatch(ctx, ride.ID); err != nil {
		s.deps.Logger.Error().Err(err).Str("ride_id", ride.ID.String()).Msg("initial dispatch failed")
	}
	if refreshed, err := s.deps.Store.RideByID(ctx, s.deps.Store.Pool(), ride.ID); err == nil {
		view = viewOf(refreshed, config.PinRequired)
	}

	return &CreateRideResult{RideView: view, Pin: pin}, 201, nil
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// RideByID returns a ride to the rider or the assigned driver on it.
func (s *Service) RideByID(ctx context.Context, actor Actor, rideID uuid.UUID) (*RideView, error) {
	ride, err := s.deps.Store.RideByID(ctx, s.deps.Store.Pool(), rideID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeNotFound, "that ride does not exist")
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	if err := s.authorise(actor, ride); err != nil {
		return nil, err
	}
	return s.decorate(ctx, ride)
}

// ActiveRide returns the caller's live ride. A caller with none gets
// no_active_ride, which the handler renders as 204.
func (s *Service) ActiveRide(ctx context.Context, actor Actor) (*RideView, error) {
	var ride *domain.Ride
	var err error
	switch {
	case actor.IsRider():
		ride, err = s.deps.Store.ActiveRideForRider(ctx, s.deps.Store.Pool(), actor.UserID)
	case actor.IsDriver():
		ride, err = s.deps.Store.ActiveRideForDriver(ctx, s.deps.Store.Pool(), actor.UserID)
	default:
		return nil, domain.Errorf(domain.CodeForbidden, "only a rider or a driver has an active ride")
	}
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeNoActiveRide, "no active ride")
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	return s.decorate(ctx, ride)
}

// authorise refuses anyone who is not a party to the ride. An admin may read
// but is not granted the rider's or driver's actions.
func (s *Service) authorise(actor Actor, ride *domain.Ride) error {
	switch {
	case actor.Role == RoleAdmin:
		return nil
	case actor.IsRider() && ride.RiderID == actor.UserID:
		return nil
	case actor.IsDriver() && ride.DriverID != nil && *ride.DriverID == actor.UserID:
		return nil
	default:
		return domain.Errorf(domain.CodeNotFound, "that ride does not exist")
	}
}

// decorate renders a ride and fills in the parts that need config or the
// ledger: whether a PIN is policy here, the options a stranded rider has, and
// what the journal says a completed ride actually settled at.
func (s *Service) decorate(ctx context.Context, ride *domain.Ride) (*RideView, error) {
	pinRequired := true
	if config, err := s.config(ctx, ride.CityID); err == nil {
		pinRequired = config.PinRequired
	}
	view := viewOf(ride, pinRequired)

	if ride.State == machine.RiderNoDriver {
		view.Options = []string{"switch_class", "keep_waiting", "cancel_free"}
	}

	if ride.CompletedAt != nil {
		if fare, err := s.deps.Ledger.RideFare(ctx, ride.ID); err == nil {
			amount := fare.Amount.AmountMinor
			view.FinalFareMinor = &amount
			view.Currency = fare.Amount.Currency
			view.FareSource = string(fare.Source)
		} else if ride.FinalFareMinor != nil {
			view.FareSource = string(repository.FareFromServer)
		}
	}
	return view, nil
}
