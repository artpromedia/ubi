package move

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// acceptLockTTL bounds how long one accept may hold the per-ride lock. It is
// short because the work it guards is a single transaction; if a process dies
// mid-accept, the next caller waits at most this long.
const acceptLockTTL = 5 * time.Second

// errRaceLost unwinds the transaction when another driver got there first. It
// never reaches a client: the caller turns it into an already_assigned result.
var errRaceLost = errors.New("another driver was assigned first")

// AcceptOffer is the driver accepting a dispatch.
//
// Three things stand between two drivers and the same ride, in increasing order
// of authority:
//
//  1. a Redis SETNX lock per ride, which keeps a stampede of concurrent accepts
//     from all reaching the database at once;
//  2. a conditional UPDATE that only moves an offer out of `offered` while it
//     is still inside its TTL, and a conditional ride transition that only
//     assigns a ride that has no driver;
//  3. the partial unique indexes offers_one_accepted_per_ride and
//     rides_one_active_per_driver, which the database enforces whatever the
//     application believes.
//
// Only the third is a guarantee. The first two exist so the third is rarely the
// thing that has to say no.
func (s *Service) AcceptOffer(ctx context.Context, actor Actor, offerID uuid.UUID) (*AcceptResultView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a driver can accept an offer")
	}

	offer, err := s.deps.Store.OfferByID(ctx, s.deps.Store.Pool(), offerID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeNotFound, "that offer does not exist")
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	if offer.DriverID != actor.UserID {
		// Not "forbidden": an offer id must not be a way to learn that another
		// driver was offered this ride.
		return nil, domain.Errorf(domain.CodeNotFound, "that offer does not exist")
	}

	lock, acquired := s.deps.Redis.AcquireAcceptLock(ctx, offer.RideID, acceptLockTTL)
	if !acquired {
		// Someone else is mid-accept on this ride. Report what the database
		// currently says rather than guessing.
		return s.lostAccept(ctx, offerID)
	}
	defer lock.Release(ctx)

	var result *AcceptResultView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		now := s.now()

		accepted, err := s.deps.Store.AcceptOffer(ctx, tx, offerID, now)
		if err != nil {
			return err
		}
		if accepted == nil {
			return errRaceLost
		}

		ride, err := s.deps.Store.RideForUpdate(ctx, tx, offer.RideID)
		if err != nil {
			return err
		}
		if ride.DriverID != nil {
			return errRaceLost
		}
		config, err := s.config(ctx, ride.CityID)
		if err != nil {
			return err
		}

		session, err := s.deps.Store.SessionForUpdate(ctx, tx, actor.UserID)
		if err != nil {
			return err
		}

		fromVersion := ride.Version
		driverID := actor.UserID
		moved, err := s.deps.Store.Transition(ctx, tx, ride, machine.RiderDriverAssigned, RideUpdate{
			DriverID:   &driverID,
			AssignedAt: &now,
		})
		if err != nil {
			// A ride that is no longer matching was taken or cancelled while
			// this accept was in flight.
			if mapped, ok := domain.AsError(err); ok &&
				(mapped.Code == domain.CodeIllegalTransition || mapped.Code == domain.CodeVersionConflict) {
				return errRaceLost
			}
			return err
		}

		session, err = s.deps.Store.TransitionDriver(ctx, tx, session, machine.DriverAccepted, SessionUpdate{
			CurrentRideID: &moved.ID,
		})
		if err != nil {
			return err
		}
		if _, err := s.deps.Store.TransitionDriver(ctx, tx, session, machine.DriverNavigatingToPickup, SessionUpdate{}); err != nil {
			return err
		}

		// Every other live offer for this ride is now dead, and the drivers
		// holding them are free again. Their offers are marked, not deleted, so
		// the ops timeline still shows who was asked.
		if err := s.expireSiblingOffers(ctx, tx, moved.ID, offerID, now); err != nil {
			return err
		}

		if err := writeEvent(ctx, tx, Event{
			Name:           "offer.accepted",
			AggregateType:  "offer",
			AggregateID:    offerID.String(),
			ToVersion:      1,
			CityID:         ride.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "offer.accepted:" + offerID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"offerId":  offerID.String(),
				"rideId":   moved.ID.String(),
				"driverId": actor.UserID.String(),
				"result":   string(domain.AcceptOK),
			},
		}); err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "ride.assigned",
			AggregateType:  "ride",
			AggregateID:    moved.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         ride.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "ride.assigned:" + moved.ID.String() + ":" + itoa(moved.Version),
			OccurredAt:     now,
			Payload: map[string]any{
				"rideId":     moved.ID.String(),
				"version":    moved.Version,
				"driverId":   actor.UserID.String(),
				"etaSeconds": accepted.ETASeconds,
				"fareMinor":  moved.QuotedFareMinor,
				"currency":   moved.Currency,
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "ride.assigned",
			SubjectType: "ride",
			SubjectID:   moved.ID.String(),
			Before:      map[string]any{"state": ride.State},
			After:       map[string]any{"state": moved.State, "offerId": offerID.String()},
			Reason:      "driver accepted the offer",
		}); err != nil {
			return err
		}

		view := viewOf(moved, config.PinRequired)
		view.Driver = &DriverSummary{DriverID: actor.UserID, ETASeconds: accepted.ETASeconds}
		result = &AcceptResultView{Result: domain.AcceptOK, Ride: view}
		return nil
	})
	if errors.Is(err, errRaceLost) {
		return s.lostAccept(ctx, offerID)
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	return result, nil
}

// lostAccept reports why this driver did not get the ride: the offer ran out of
// time, or somebody else took it. Both are answers, not errors in the sense of
// something having gone wrong, so the result is carried in the body and the
// status is the canonical one for the code.
func (s *Service) lostAccept(ctx context.Context, offerID uuid.UUID) (*AcceptResultView, error) {
	offer, err := s.deps.Store.OfferByID(ctx, s.deps.Store.Pool(), offerID)
	if err != nil {
		return nil, asDomainError(err)
	}
	now := s.now()
	if offer.State == domain.OfferOffered && !now.Before(offer.ExpiresAt) {
		return &AcceptResultView{Result: domain.AcceptExpired}, nil
	}
	if offer.State == domain.OfferExpired {
		return &AcceptResultView{Result: domain.AcceptExpired}, nil
	}
	return &AcceptResultView{Result: domain.AcceptAlreadyAssigned}, nil
}

// DeclineOffer records a driver turning work down and hands them back to the
// pool. A decline is persisted like every other response, because acceptance
// rate is a fact about a driver and the ops timeline has to show it.
func (s *Service) DeclineOffer(ctx context.Context, actor Actor, offerID uuid.UUID) error {
	if !actor.IsDriver() {
		return domain.Errorf(domain.CodeForbidden, "only a driver can decline an offer")
	}
	offer, err := s.deps.Store.OfferByID(ctx, s.deps.Store.Pool(), offerID)
	if errors.Is(err, domain.ErrNotFound) {
		return domain.Errorf(domain.CodeNotFound, "that offer does not exist")
	}
	if err != nil {
		return asDomainError(err)
	}
	if offer.DriverID != actor.UserID {
		return domain.Errorf(domain.CodeNotFound, "that offer does not exist")
	}

	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		now := s.now()
		declined, err := s.deps.Store.RespondToOffer(ctx, tx, offerID, domain.OfferDeclined, "driver_declined", now)
		if err != nil {
			return err
		}
		if declined == nil {
			// Already expired or already answered; nothing to record.
			return nil
		}
		if err := s.freeOfferedDriver(ctx, tx, actor.UserID, machine.DriverDeclined); err != nil {
			return err
		}
		return writeEvent(ctx, tx, Event{
			Name:           "offer.declined",
			AggregateType:  "offer",
			AggregateID:    offerID.String(),
			ToVersion:      1,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "offer.declined:" + offerID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"offerId":  offerID.String(),
				"rideId":   offer.RideID.String(),
				"driverId": actor.UserID.String(),
				"result":   "declined",
			},
		})
	})
	if err != nil {
		return asDomainError(err)
	}
	return nil
}

// expireSiblingOffers marks every other live offer for a ride as expired and
// releases the drivers who were holding them.
func (s *Service) expireSiblingOffers(ctx context.Context, tx pgx.Tx, rideID, keep uuid.UUID, now time.Time) error {
	offers, err := s.deps.Store.OffersForRide(ctx, tx, rideID)
	if err != nil {
		return err
	}
	for _, sibling := range offers {
		if sibling.ID == keep || sibling.State != domain.OfferOffered {
			continue
		}
		expired, err := s.deps.Store.RespondToOffer(ctx, tx, sibling.ID, domain.OfferExpired, "another_driver_accepted", now)
		if err != nil {
			return err
		}
		if expired == nil {
			continue
		}
		if err := s.freeOfferedDriver(ctx, tx, sibling.DriverID, machine.DriverOfferExpired); err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "offer.expired",
			AggregateType:  "offer",
			AggregateID:    sibling.ID.String(),
			ToVersion:      1,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "offer.expired:" + sibling.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"offerId":  sibling.ID.String(),
				"rideId":   rideID.String(),
				"driverId": sibling.DriverID.String(),
				"result":   "another_driver_accepted",
			},
		}); err != nil {
			return err
		}
	}
	return nil
}

// freeOfferedDriver returns a driver who was holding an offer to `available`.
// A driver who has since gone offline or taken other work is left alone.
func (s *Service) freeOfferedDriver(ctx context.Context, tx pgx.Tx, driverID uuid.UUID, via string) error {
	session, err := s.deps.Store.SessionForUpdate(ctx, tx, driverID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if session.State != machine.DriverOfferReceived {
		return nil
	}
	session, err = s.deps.Store.TransitionDriver(ctx, tx, session, via, SessionUpdate{})
	if err != nil {
		return err
	}
	_, err = s.deps.Store.TransitionDriver(ctx, tx, session, machine.DriverAvailable, SessionUpdate{})
	return err
}
