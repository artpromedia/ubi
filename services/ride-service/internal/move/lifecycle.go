package move

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/repository"
)

// locationFreshnessForGeofence is how recently a driver must have reported a
// position for the server to accept it as evidence of where they are standing.
// It is not a city policy — it is how long a GPS fix is worth believing.
const locationFreshnessForGeofence = 90 * time.Second

// prepare resolves the ride and its pinned city configuration *before* a
// transaction is opened.
//
// This ordering is not cosmetic. Reading the configuration goes to the same
// connection pool, and a transaction that reaches back into the pool while
// holding a connection deadlocks the moment the pool is saturated — which is
// exactly what a burst of concurrent accepts does. Everything a transition
// needs from outside its own transaction is fetched first.
func (s *Service) prepare(ctx context.Context, actor Actor, rideID uuid.UUID) (*domain.Ride, *cityconfig.CityConfig, error) {
	ride, err := s.deps.Store.RideByID(ctx, s.deps.Store.Pool(), rideID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, nil, domain.Errorf(domain.CodeNotFound, "that ride does not exist")
	}
	if err != nil {
		return nil, nil, err
	}
	if err := s.authorise(actor, ride); err != nil {
		return nil, nil, err
	}
	config, err := s.config(ctx, ride.CityID)
	if err != nil {
		return nil, nil, err
	}
	return ride, config, nil
}

// Arrived records that the driver reached the pickup point.
//
// The server checks the distance itself, against the driver's last accepted
// location and the city's geofence. A driver app that says "I have arrived"
// from across town is refused: the claim is not evidence.
func (s *Service) Arrived(ctx context.Context, actor Actor, rideID uuid.UUID) (*RideView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only the assigned driver can report arrival")
	}

	_, config, err := s.prepare(ctx, actor, rideID)
	if err != nil {
		return nil, asDomainError(err)
	}

	var view *RideView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		ride, err := s.loadRideForActor(ctx, tx, actor, rideID)
		if err != nil {
			return err
		}
		session, err := s.deps.Store.SessionForUpdate(ctx, tx, actor.UserID)
		if err != nil {
			return err
		}

		now := s.now()
		if !session.HasLocation() {
			return domain.Errorf(domain.CodeNotAtPickup,
				"the server has no recent position for this driver").
				WithDetails(map[string]any{"geofenceMeters": config.ArrivedGeofenceMeters})
		}
		if now.Sub(*session.LastLocationAt) > locationFreshnessForGeofence {
			return domain.Errorf(domain.CodeNotAtPickup,
				"the driver's last position is too old to confirm arrival").
				WithDetails(map[string]any{
					"geofenceMeters": config.ArrivedGeofenceMeters,
					"positionAgeSec": int(now.Sub(*session.LastLocationAt).Seconds()),
				})
		}

		distance := geo.HaversineDistance(*session.LastLat, *session.LastLng, ride.Pickup.Lat, ride.Pickup.Lng)
		if distance > float64(config.ArrivedGeofenceMeters) {
			return domain.Errorf(domain.CodeNotAtPickup,
				"the driver is not at the pickup point yet").
				WithDetails(map[string]any{
					"geofenceMeters": config.ArrivedGeofenceMeters,
					"distanceMeters": int(distance),
				})
		}

		fromVersion := ride.Version
		moved, err := s.deps.Store.Transition(ctx, tx, ride, machine.RiderDriverArrived, RideUpdate{ArrivedAt: &now})
		if err != nil {
			return err
		}
		// The driver machine passes through `arrived` on its way to `waiting`;
		// both moves are in the contract and both are asserted.
		session, err = s.deps.Store.TransitionDriver(ctx, tx, session, machine.DriverArrived, SessionUpdate{})
		if err != nil {
			return err
		}
		if _, err := s.deps.Store.TransitionDriver(ctx, tx, session, machine.DriverWaiting, SessionUpdate{}); err != nil {
			return err
		}

		if err := writeEvent(ctx, tx, Event{
			Name:           "ride.driver_arrived",
			AggregateType:  "ride",
			AggregateID:    ride.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         ride.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "ride.driver_arrived:" + ride.ID.String() + ":" + itoa(moved.Version),
			OccurredAt:     now,
			Payload: map[string]any{
				"rideId":         ride.ID.String(),
				"version":        moved.Version,
				"distanceMeters": int(distance),
			},
		}); err != nil {
			return err
		}
		view = viewOf(moved, config.PinRequired)
		return nil
	})
	if err != nil {
		return nil, asDomainError(err)
	}
	return view, nil
}

// pinRateLimit is how many PIN attempts one ride may make in a window, on top
// of the city's own attempt limit. The city limit locks the PIN permanently;
// this only stops a fast guessing loop from spending all of them in a second.
const (
	pinRateLimitAttempts = 5
	pinRateLimitWindow   = time.Minute
)

// VerifyPin checks the pickup PIN the rider showed the driver.
//
// A wrong PIN costs an attempt and reports how many are left. When they run
// out the PIN is locked and the ride cannot be started without support — a
// wrong PIN is how a rider gets into the wrong car, so guessing is not allowed
// to be cheap.
func (s *Service) VerifyPin(ctx context.Context, actor Actor, rideID uuid.UUID, pin string) (*PinResultView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only the assigned driver can verify the pickup PIN")
	}
	if !s.deps.Redis.AllowPinAttempt(ctx, rideID, pinRateLimitAttempts, pinRateLimitWindow) {
		return nil, domain.Errorf(domain.CodeRateLimited, "too many PIN attempts; wait a moment")
	}

	_, config, err := s.prepare(ctx, actor, rideID)
	if err != nil {
		return nil, asDomainError(err)
	}

	var result *PinResultView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		ride, err := s.loadRideForActor(ctx, tx, actor, rideID)
		if err != nil {
			return err
		}
		if !config.PinRequired {
			return domain.Errorf(domain.CodeValidationFailed, "this city does not use pickup PINs")
		}
		if ride.PinLocked {
			return domain.Errorf(domain.CodePinAttemptsExhausted,
				"the pickup PIN is locked for this ride").
				WithDetails(map[string]any{"attemptsLeft": 0})
		}
		if ride.PinVerifiedAt != nil {
			// Already verified: report success rather than spending an attempt,
			// so a retried request is harmless.
			result = &PinResultView{Verified: true, AttemptsLeft: config.MaxPinAttempts - ride.PinAttempts, Ride: viewOf(ride, true)}
			return nil
		}

		now := s.now()
		hash, err := s.deps.Store.PinHash(ctx, tx, ride.ID)
		if err != nil {
			return err
		}

		// An ill-formed PIN is refused without a hash comparison, but it still
		// costs an attempt: otherwise the attempt limit could be probed for free.
		matched := validPINFormat(pin) && pinMatches(hash, pin)
		attempts := ride.PinAttempts + 1

		if !matched {
			locked := attempts >= config.MaxPinAttempts
			if err := s.deps.Store.RecordPinAttempt(ctx, tx, ride.ID, attempts, locked); err != nil {
				return err
			}
			// The rider machine enters pin_verification on the first attempt:
			// the PIN screen is live on both apps from that moment (board 1g).
			if ride.State == machine.RiderDriverArrived {
				if _, err := s.deps.Store.Transition(ctx, tx, ride, machine.RiderPinVerification, RideUpdate{
					PinAttempts: &attempts, PinLocked: &locked,
				}); err != nil {
					return err
				}
			}
			if locked {
				if err := writeEvent(ctx, tx, Event{
					Name:           "pin.locked",
					AggregateType:  "ride",
					AggregateID:    ride.ID.String(),
					ToVersion:      ride.Version,
					CityID:         ride.CityID,
					ActorType:      "driver",
					ActorID:        actor.UserID.String(),
					IdempotencyKey: "pin.locked:" + ride.ID.String(),
					OccurredAt:     now,
					Payload:        map[string]any{"rideId": ride.ID.String(), "attempts": attempts},
				}); err != nil {
					return err
				}
			}
			left := config.MaxPinAttempts - attempts
			if left < 0 {
				left = 0
			}
			code := domain.CodeWrongPin
			message := "that PIN does not match"
			if locked {
				code = domain.CodePinAttemptsExhausted
				message = "the pickup PIN is now locked for this ride"
			}
			return domain.Errorf(code, "%s", message).
				WithDetails(map[string]any{"attemptsLeft": left})
		}

		state := ride.State
		var moved *domain.Ride
		if state == machine.RiderDriverArrived {
			moved, err = s.deps.Store.Transition(ctx, tx, ride, machine.RiderPinVerification, RideUpdate{
				PinAttempts: &attempts, PinVerifiedAt: &now,
			})
			if err != nil {
				return err
			}
		} else if state == machine.RiderPinVerification {
			if err := s.deps.Store.RecordPinAttempt(ctx, tx, ride.ID, attempts, false); err != nil {
				return err
			}
			moved, err = s.deps.Store.RideForUpdate(ctx, tx, ride.ID)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx,
				`UPDATE ride.rides SET pin_verified_at = $2 WHERE id = $1 AND pin_verified_at IS NULL`,
				ride.ID, now); err != nil {
				return err
			}
			moved.PinVerifiedAt = &now
		} else {
			return domain.Errorf(domain.CodeIllegalTransition,
				"a PIN can only be verified once the driver has arrived").
				WithDetails(map[string]any{"state": state})
		}

		session, err := s.deps.Store.SessionForUpdate(ctx, tx, actor.UserID)
		if err != nil {
			return err
		}
		if _, err := s.deps.Store.TransitionDriver(ctx, tx, session, machine.DriverPinVerified, SessionUpdate{}); err != nil {
			return err
		}

		if err := writeEvent(ctx, tx, Event{
			Name:           "ride.pin_verified",
			AggregateType:  "ride",
			AggregateID:    ride.ID.String(),
			ToVersion:      moved.Version,
			CityID:         ride.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "ride.pin_verified:" + ride.ID.String(),
			OccurredAt:     now,
			Payload:        map[string]any{"rideId": ride.ID.String(), "version": moved.Version},
		}); err != nil {
			return err
		}

		result = &PinResultView{
			Verified:     true,
			AttemptsLeft: config.MaxPinAttempts - attempts,
			Ride:         viewOf(moved, true),
		}
		return nil
	})
	if err != nil {
		return nil, asDomainError(err)
	}
	s.deps.Redis.ClearPinAttempts(ctx, rideID)
	return result, nil
}

// Start begins the trip. It requires a verified PIN: the driver machine must be
// in `pin_verified`, and the ride must carry the timestamp of the verification.
func (s *Service) Start(ctx context.Context, actor Actor, rideID uuid.UUID) (*RideView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only the assigned driver can start the trip")
	}

	_, config, err := s.prepare(ctx, actor, rideID)
	if err != nil {
		return nil, asDomainError(err)
	}

	var view *RideView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		ride, err := s.loadRideForActor(ctx, tx, actor, rideID)
		if err != nil {
			return err
		}
		if config.PinRequired && ride.PinVerifiedAt == nil {
			return domain.Errorf(domain.CodePinNotVerified,
				"the pickup PIN has not been verified for this ride")
		}

		session, err := s.deps.Store.SessionForUpdate(ctx, tx, actor.UserID)
		if err != nil {
			return err
		}

		now := s.now()
		fromVersion := ride.Version
		moved, err := s.deps.Store.Transition(ctx, tx, ride, machine.RiderInProgress, RideUpdate{StartedAt: &now})
		if err != nil {
			return err
		}
		if _, err := s.deps.Store.TransitionDriver(ctx, tx, session, machine.DriverInTrip, SessionUpdate{}); err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "ride.started",
			AggregateType:  "ride",
			AggregateID:    ride.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         ride.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "ride.started:" + ride.ID.String() + ":" + itoa(moved.Version),
			OccurredAt:     now,
			Payload:        map[string]any{"rideId": ride.ID.String(), "version": moved.Version},
		}); err != nil {
			return err
		}
		view = viewOf(moved, config.PinRequired)
		return nil
	})
	if err != nil {
		return nil, asDomainError(err)
	}
	return view, nil
}

// Complete ends the trip.
//
// The amount is computed here from the pinned quote and the city's wait policy,
// measured against the server's own arrival and start timestamps. The request
// body carries no amount at all, so there is nothing for a client to inflate.
// The published event is what the ledger posts from, and once it has posted,
// reads of this ride report the ledger's figure (see decorate).
func (s *Service) Complete(ctx context.Context, actor Actor, rideID uuid.UUID) (*RideView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only the assigned driver can complete the trip")
	}

	_, config, err := s.prepare(ctx, actor, rideID)
	if err != nil {
		return nil, asDomainError(err)
	}

	var view *RideView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		ride, err := s.loadRideForActor(ctx, tx, actor, rideID)
		if err != nil {
			return err
		}
		session, err := s.deps.Store.SessionForUpdate(ctx, tx, actor.UserID)
		if err != nil {
			return err
		}

		now := s.now()
		waitFee := s.waitFee(config, ride)
		total := ride.QuotedFareMinor + waitFee.AmountMinor
		fromVersion := ride.Version

		moved, err := s.deps.Store.Transition(ctx, tx, ride, machine.RiderCompleted, RideUpdate{
			CompletedAt:    &now,
			WaitFeeMinor:   &waitFee.AmountMinor,
			FinalFareMinor: &total,
		})
		if err != nil {
			return err
		}

		// The driver machine collects payment, completes, and becomes available
		// again. All three moves are in the contract; none is a shortcut.
		session, err = s.deps.Store.TransitionDriver(ctx, tx, session, machine.DriverCollectingPayment, SessionUpdate{})
		if err != nil {
			return err
		}
		session, err = s.deps.Store.TransitionDriver(ctx, tx, session, machine.DriverCompleted, SessionUpdate{})
		if err != nil {
			return err
		}
		if _, err := s.deps.Store.TransitionDriver(ctx, tx, session, machine.DriverAvailable, SessionUpdate{ClearRide: true}); err != nil {
			return err
		}

		if err := writeEvent(ctx, tx, Event{
			Name:           "ride.completed",
			AggregateType:  "ride",
			AggregateID:    ride.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         ride.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "ride.completed:" + ride.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"rideId":          ride.ID.String(),
				"version":         moved.Version,
				"fareMinor":       ride.QuotedFareMinor,
				"waitFeeMinor":    waitFee.AmountMinor,
				"totalMinor":      total,
				"currency":        ride.Currency,
				"paymentMethodId": ride.PaymentMethodID,
				"configVersion":   ride.ConfigVersion,
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "ride.completed",
			SubjectType: "ride",
			SubjectID:   ride.ID.String(),
			Before:      map[string]any{"state": ride.State},
			After: map[string]any{
				"state":        moved.State,
				"fareMinor":    ride.QuotedFareMinor,
				"waitFeeMinor": waitFee.AmountMinor,
				"totalMinor":   total,
				"currency":     ride.Currency,
			},
			Reason: "driver completed the trip",
		}); err != nil {
			return err
		}

		view = viewOf(moved, config.PinRequired)
		view.FareSource = string(repository.FareFromServer)
		return nil
	})
	if err != nil {
		return nil, asDomainError(err)
	}
	return view, nil
}

// waitFee is what the driver's wait at pickup costs, measured from the server's
// own arrival timestamp to the server's own start timestamp. A ride that never
// recorded an arrival waited zero.
func (s *Service) waitFee(config *cityconfig.CityConfig, ride *domain.Ride) domain.Money {
	if ride.ArrivedAt == nil {
		return domain.Money{AmountMinor: 0, Currency: config.Currency}
	}
	end := s.now()
	if ride.StartedAt != nil {
		end = *ride.StartedAt
	}
	waited := end.Sub(*ride.ArrivedAt)
	if waited < 0 {
		waited = 0
	}
	return s.deps.Pricing.WaitFee(config, waited)
}

// Cancel ends a ride before it completes.
//
// A driver must give a reason code — the ride is going back out to matching and
// the rider is owed an explanation, so an empty reason is refused. A rider
// cancelling ends the ride; a driver cancelling frees the driver and puts the
// ride back into `rematching` so the rider is not stranded.
func (s *Service) Cancel(ctx context.Context, actor Actor, rideID uuid.UUID, reasonCode string) (*RideView, error) {
	if actor.Role != RoleRider && actor.Role != RoleDriver {
		return nil, domain.Errorf(domain.CodeForbidden, "only a rider or the assigned driver can cancel a ride")
	}
	if actor.IsDriver() && reasonCode == "" {
		return nil, domain.Errorf(domain.CodeReasonCodeRequired,
			"a driver cancellation must carry a reason code").
			WithDetails(map[string]any{"reasonCodes": sortedReasonCodes()})
	}
	if reasonCode != "" && !domain.ValidCancellationReason(reasonCode) {
		return nil, domain.Errorf(domain.CodeValidationFailed, "%q is not a cancellation reason this platform knows", reasonCode).
			WithDetails(map[string]any{"reasonCodes": sortedReasonCodes()})
	}

	_, config, err := s.prepare(ctx, actor, rideID)
	if err != nil {
		return nil, asDomainError(err)
	}

	var view *RideView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		ride, err := s.loadRideForActor(ctx, tx, actor, rideID)
		if err != nil {
			return err
		}

		now := s.now()
		fromVersion := ride.Version
		role := actor.Role

		if actor.IsRider() {
			moved, err := s.deps.Store.Transition(ctx, tx, ride, machine.RiderCancelledByRider, RideUpdate{
				CancelledAt: &now, CancelledByRole: &role, CancelReasonCode: &reasonCode,
			})
			if err != nil {
				return err
			}
			if ride.DriverID != nil {
				if err := s.releaseDriver(ctx, tx, *ride.DriverID, machine.DriverCancelled); err != nil {
					return err
				}
			}
			fee := s.deps.Pricing.CancellationFee(config, RoleRider, ride.DriverID != nil, now.Sub(ride.CreatedAt))
			if err := writeEvent(ctx, tx, Event{
				Name:           "ride.cancelled_by_rider",
				AggregateType:  "ride",
				AggregateID:    ride.ID.String(),
				FromVersion:    &fromVersion,
				ToVersion:      moved.Version,
				CityID:         ride.CityID,
				ActorType:      "rider",
				ActorID:        actor.UserID.String(),
				IdempotencyKey: "ride.cancelled_by_rider:" + ride.ID.String(),
				OccurredAt:     now,
				Payload: map[string]any{
					"rideId":   ride.ID.String(),
					"reason":   reasonCode,
					"feeMinor": fee.AmountMinor,
					"currency": fee.Currency,
				},
			}); err != nil {
				return err
			}
			if err := writeAudit(ctx, tx, AuditRecord{
				ActorID: actor.UserID.String(), ActorRole: actor.Role,
				Action: "ride.cancelled_by_rider", SubjectType: "ride", SubjectID: ride.ID.String(),
				Before: map[string]any{"state": ride.State},
				After:  map[string]any{"state": moved.State, "feeMinor": fee.AmountMinor, "currency": fee.Currency},
				Reason: reasonCode,
			}); err != nil {
				return err
			}
			view = viewOf(moved, config.PinRequired)
			return nil
		}

		// Driver cancellation: the ride is not over, it is looking again.
		moved, err := s.deps.Store.Transition(ctx, tx, ride, machine.RiderRematching, RideUpdate{
			ClearDriver: true, CancelledByRole: &role, CancelReasonCode: &reasonCode,
		})
		if err != nil {
			return err
		}
		if err := s.releaseDriver(ctx, tx, actor.UserID, machine.DriverCancelled); err != nil {
			return err
		}
		fee := s.deps.Pricing.CancellationFee(config, RoleDriver, true, now.Sub(ride.CreatedAt))
		if err := writeEvent(ctx, tx, Event{
			Name:           "ride.cancelled_by_driver",
			AggregateType:  "ride",
			AggregateID:    ride.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         ride.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "ride.cancelled_by_driver:" + ride.ID.String() + ":" + itoa(moved.Version),
			OccurredAt:     now,
			Payload: map[string]any{
				"rideId":     ride.ID.String(),
				"reasonCode": reasonCode,
				"feeMinor":   fee.AmountMinor,
				"currency":   fee.Currency,
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role,
			Action: "ride.cancelled_by_driver", SubjectType: "ride", SubjectID: ride.ID.String(),
			Before: map[string]any{"state": ride.State},
			After:  map[string]any{"state": moved.State},
			Reason: reasonCode,
		}); err != nil {
			return err
		}
		view = viewOf(moved, config.PinRequired)
		return nil
	})
	if err != nil {
		return nil, asDomainError(err)
	}
	return view, nil
}

// releaseDriver takes a driver off a ride and hands them back to the pool.
func (s *Service) releaseDriver(ctx context.Context, tx pgx.Tx, driverID uuid.UUID, via string) error {
	session, err := s.deps.Store.SessionForUpdate(ctx, tx, driverID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if session.State == machine.DriverAvailable || session.State == machine.DriverOffline {
		return nil
	}
	session, err = s.deps.Store.TransitionDriver(ctx, tx, session, via, SessionUpdate{})
	if err != nil {
		return err
	}
	_, err = s.deps.Store.TransitionDriver(ctx, tx, session, machine.DriverAvailable, SessionUpdate{ClearRide: true})
	return err
}

// loadRideForActor locks a ride and refuses anyone who is not a party to it.
func (s *Service) loadRideForActor(ctx context.Context, tx pgx.Tx, actor Actor, rideID uuid.UUID) (*domain.Ride, error) {
	ride, err := s.deps.Store.RideForUpdate(ctx, tx, rideID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeNotFound, "that ride does not exist")
	}
	if err != nil {
		return nil, err
	}
	if err := s.authorise(actor, ride); err != nil {
		return nil, err
	}
	return ride, nil
}

func sortedReasonCodes() []string {
	codes := make([]string, 0, len(domain.CancellationReasons))
	for code := range domain.CancellationReasons {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	return codes
}
