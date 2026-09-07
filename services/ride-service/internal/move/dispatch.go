package move

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/matching"
)

// Dispatch offers a ride to the next ring of drivers.
//
// It is called once inline when a ride is created — which is what makes a
// SEARCHING ride something a driver can actually see — and then repeatedly by
// Sweep. Everything it decides is written down: the ring the ride is on, every
// offer, and every expiry. Nothing about a dispatch lives in a goroutine's
// memory, so a restart resumes rather than forgetting.
func (s *Service) Dispatch(ctx context.Context, rideID uuid.UUID) error {
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		ride, err := s.deps.Store.RideForUpdate(ctx, tx, rideID)
		if errors.Is(err, domain.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if ride.State != machine.RiderMatching && ride.State != machine.RiderRematching {
			return nil
		}

		now := s.now()
		live, err := s.deps.Store.LiveOfferCount(ctx, tx, ride.ID, now)
		if err != nil {
			return err
		}
		if live > 0 {
			// Drivers are still looking at this ride; do not pile on.
			return nil
		}

		config, err := s.config(ctx, ride.CityID)
		if err != nil {
			return err
		}

		ring, ok := matching.RingFor(config, ride.DispatchRing)
		if !ok {
			// Rings exhausted for this round: start again from the innermost
			// ring, unless the ride has used up its rounds.
			if ride.DispatchRounds+1 >= s.deps.Policy.MaxRounds {
				return s.noDriver(ctx, tx, ride, now)
			}
			nextRing := 0
			nextRound := ride.DispatchRounds + 1
			if _, err := tx.Exec(ctx,
				`UPDATE ride.rides SET dispatch_ring = $2, dispatch_rounds = $3, updated_at = now() WHERE id = $1`,
				ride.ID, nextRing, nextRound); err != nil {
				return err
			}
			ride.DispatchRing = nextRing
			ride.DispatchRounds = nextRound
			ring, ok = matching.RingFor(config, nextRing)
			if !ok {
				return s.noDriver(ctx, tx, ride, now)
			}
		}

		excluded, err := s.deps.Store.OfferedDriverIDs(ctx, tx, ride.ID)
		if err != nil {
			return err
		}
		minLat, maxLat, minLng, maxLng := matching.BoundingBox(ride.Pickup.Lat, ride.Pickup.Lng, float64(ring.RadiusMeters))
		sessions, err := s.deps.Store.AvailableDrivers(ctx, tx,
			ride.CityID, ride.VehicleClass,
			minLat, maxLat, minLng, maxLng,
			now.Add(-s.deps.Policy.LocationFreshness), excluded)
		if err != nil {
			return err
		}

		candidates := matching.Candidates(sessions, ride.Pickup, ring)
		created := 0
		expiresAt := now.Add(config.OfferTTL())

		for _, candidate := range candidates {
			offer := &domain.Offer{
				ID:             uuid.New(),
				RideID:         ride.ID,
				DriverID:       candidate.DriverID,
				Ring:           ring.Index,
				RadiusMeters:   ring.RadiusMeters,
				DistanceMeters: candidate.DistanceMeters,
				ETASeconds:     candidate.ETASeconds,
				ExpiresAt:      expiresAt,
			}
			inserted, err := s.deps.Store.InsertOffer(ctx, tx, offer)
			if err != nil {
				return err
			}
			if !inserted {
				continue
			}

			session, err := s.deps.Store.SessionForUpdate(ctx, tx, candidate.DriverID)
			if err != nil {
				return err
			}
			// A driver who changed state between the query and here is skipped:
			// the contract, not the query plan, decides whether they can be
			// offered work.
			if session.State != machine.DriverAvailable {
				if _, err := s.deps.Store.RespondToOffer(ctx, tx, offer.ID, domain.OfferExpired, "driver_unavailable", now); err != nil {
					return err
				}
				continue
			}
			if _, err := s.deps.Store.TransitionDriver(ctx, tx, session, machine.DriverOfferReceived, SessionUpdate{}); err != nil {
				return err
			}

			if err := writeEvent(ctx, tx, Event{
				Name:           "offer.created",
				AggregateType:  "offer",
				AggregateID:    offer.ID.String(),
				ToVersion:      1,
				CityID:         ride.CityID,
				ActorType:      "system",
				ActorID:        "ride-service",
				IdempotencyKey: "offer.created:" + offer.ID.String(),
				OccurredAt:     now,
				Payload: map[string]any{
					"offerId":    offer.ID.String(),
					"rideId":     ride.ID.String(),
					"driverId":   candidate.DriverID.String(),
					"expiresAt":  expiresAt.Format(time.RFC3339),
					"etaSeconds": candidate.ETASeconds,
					"ring":       ring.Index,
				},
			}); err != nil {
				return err
			}
			created++
		}

		// Advance the ring whether or not this one produced offers: an empty
		// ring is information, and the next sweep should look further out.
		if _, err := tx.Exec(ctx,
			`UPDATE ride.rides SET dispatch_ring = $2, updated_at = now() WHERE id = $1`,
			ride.ID, ring.Index+1); err != nil {
			return err
		}

		return writeEvent(ctx, tx, Event{
			Name:           "matching.retry",
			AggregateType:  "ride",
			AggregateID:    ride.ID.String(),
			ToVersion:      ride.Version,
			CityID:         ride.CityID,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "matching.retry:" + ride.ID.String() + ":" + itoa(ride.DispatchRounds) + ":" + itoa(ring.Index),
			OccurredAt:     now,
			Payload: map[string]any{
				"rideId": ride.ID.String(),
				"ring":   ring.Index,
				"radius": ring.RadiusMeters,
				"offers": created,
			},
		})
	})
}

// noDriver tells the rider the truth: nobody took this ride. The rider is left
// with explicit options rather than a spinner (board 1e).
func (s *Service) noDriver(ctx context.Context, tx pgx.Tx, ride *domain.Ride, now time.Time) error {
	fromVersion := ride.Version
	moved, err := s.deps.Store.Transition(ctx, tx, ride, machine.RiderNoDriver, RideUpdate{})
	if err != nil {
		return err
	}
	return writeEvent(ctx, tx, Event{
		Name:           "ride.no_driver",
		AggregateType:  "ride",
		AggregateID:    ride.ID.String(),
		FromVersion:    &fromVersion,
		ToVersion:      moved.Version,
		CityID:         ride.CityID,
		ActorType:      "system",
		ActorID:        "ride-service",
		IdempotencyKey: "ride.no_driver:" + ride.ID.String() + ":" + itoa(moved.Version),
		OccurredAt:     now,
		Payload: map[string]any{
			"rideId":  ride.ID.String(),
			"ring":    ride.DispatchRing,
			"rounds":  ride.DispatchRounds,
			"options": []string{"switch_class", "keep_waiting", "cancel_free"},
		},
	})
}

// Sweep is one pass of the dispatcher: expire the offers whose time is up, then
// give every ride still looking for a driver its next ring.
//
// It is a plain function rather than a background goroutine's private loop, so
// a test can drive it a tick at a time and an operator can run it from a job.
func (s *Service) Sweep(ctx context.Context) error {
	now := s.now()
	batch := s.deps.Policy.SweepBatch

	expired, err := s.deps.Store.ExpiredOffers(ctx, s.deps.Store.Pool(), now, batch)
	if err != nil {
		return asDomainError(err)
	}
	for _, offer := range expired {
		if err := s.expireOffer(ctx, offer, now); err != nil {
			s.deps.Logger.Error().Err(err).Str("offer_id", offer.ID.String()).Msg("failed to expire offer")
		}
	}

	rides, err := s.deps.Store.RidesAwaitingDispatch(ctx, s.deps.Store.Pool(), batch)
	if err != nil {
		return asDomainError(err)
	}
	for _, ride := range rides {
		if err := s.Dispatch(ctx, ride.ID); err != nil {
			s.deps.Logger.Error().Err(err).Str("ride_id", ride.ID.String()).Msg("dispatch failed")
		}
	}
	return nil
}

// expireOffer marks one overdue offer and frees the driver holding it.
func (s *Service) expireOffer(ctx context.Context, offer *domain.Offer, now time.Time) error {
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		marked, err := s.deps.Store.RespondToOffer(ctx, tx, offer.ID, domain.OfferExpired, "no_response", now)
		if err != nil {
			return err
		}
		if marked == nil {
			return nil
		}
		if err := s.freeOfferedDriver(ctx, tx, offer.DriverID, machine.DriverOfferExpired); err != nil {
			return err
		}
		return writeEvent(ctx, tx, Event{
			Name:           "offer.expired",
			AggregateType:  "offer",
			AggregateID:    offer.ID.String(),
			ToVersion:      1,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "offer.expired:" + offer.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"offerId":  offer.ID.String(),
				"rideId":   offer.RideID.String(),
				"driverId": offer.DriverID.String(),
				"result":   "no_response",
			},
		})
	})
}

// RunDispatcher sweeps on a ticker until the context is cancelled.
func (s *Service) RunDispatcher(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.Sweep(ctx); err != nil {
				s.deps.Logger.Error().Err(err).Msg("dispatch sweep failed")
			}
		}
	}
}

// OffersForRide is the dispatch half of the ops timeline for one ride.
func (s *Service) OffersForRide(ctx context.Context, actor Actor, rideID uuid.UUID) ([]*domain.Offer, error) {
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
	offers, err := s.deps.Store.OffersForRide(ctx, s.deps.Store.Pool(), rideID)
	if err != nil {
		return nil, asDomainError(err)
	}
	return offers, nil
}
