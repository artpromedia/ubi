package move

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// Limits on a reported location. These are physics and sensor quality, not
// commercial policy, so they belong in code rather than in city config:
// a phone that reports a 500 m accuracy circle is not telling us where the car
// is, and nothing on a road covers 60 m in a second.
const (
	maxAccuracyMeters      = 100.0
	maxLocationAgeMinutes  = 5
	maxClockSkewSeconds    = 60
	maxPlausibleSpeedMps   = 60.0
	maxLocationBatchPoints = 100
)

// DriverStatusRequest is what a driver app may set. `Online` is the only lever;
// the resulting state is the server's, taken from the driver machine.
type DriverStatusRequest struct {
	Online  bool           `json:"online"`
	Filters DriverFilters  `json:"filters"`
	Extra   map[string]any `json:"-"`
}

// DriverFilters is what work a driver is willing to take.
type DriverFilters struct {
	VehicleClasses []string `json:"vehicleClasses"`
}

// SetDriverStatus takes a driver online or offline.
//
// Going online is gated on the driver_online flag, deny-by-default, so a city
// that has not opened driver supply cannot be flooded by apps that simply
// call the endpoint.
func (s *Service) SetDriverStatus(ctx context.Context, actor Actor, req DriverStatusRequest) (*DriverStatusView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a driver has a driver status")
	}
	if actor.CityID == "" {
		return nil, domain.Errorf(domain.CodeValidationFailed, "the gateway did not say which city this driver is in")
	}
	if req.Online {
		if err := s.requireFlag(ctx, cityconfig.FlagDriverOnline, actor); err != nil {
			return nil, err
		}
	}

	config, err := s.config(ctx, actor.CityID)
	if err != nil {
		return nil, err
	}
	for _, class := range req.Filters.VehicleClasses {
		if !config.SupportsVehicleClass(class) {
			return nil, domain.Errorf(domain.CodeValidationFailed,
				"this city does not offer the %q class", class).
				WithDetails(map[string]any{"vehicleClasses": config.VehicleClasses})
		}
	}

	var view *DriverStatusView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if _, err := s.deps.Store.EnsureSession(ctx, tx, actor.UserID, actor.CityID); err != nil {
			return err
		}
		session, err := s.deps.Store.SessionForUpdate(ctx, tx, actor.UserID)
		if err != nil {
			return err
		}

		now := s.now()
		target := machine.DriverOffline
		update := SessionUpdate{
			VehicleClasses: req.Filters.VehicleClasses,
			CityID:         actor.CityID,
			ClearOnline:    true,
		}
		if req.Online {
			target = machine.DriverAvailable
			update.ClearOnline = false
			update.OnlineSince = &now
		}

		if session.State == target {
			// Already there. Still record the filters, so a driver narrowing
			// what they will take does not have to bounce offline first.
			if _, err := tx.Exec(ctx,
				`UPDATE ride.driver_sessions SET vehicle_classes = COALESCE($2, vehicle_classes), city_id = $3, updated_at = now() WHERE driver_id = $1`,
				actor.UserID, jsonOrNil(req.Filters.VehicleClasses), actor.CityID); err != nil {
				return err
			}
			refreshed, err := s.deps.Store.Session(ctx, tx, actor.UserID)
			if err != nil {
				return err
			}
			view = sessionView(refreshed)
			return nil
		}

		if !req.Online && session.CurrentRideID != nil {
			return domain.Errorf(domain.CodeConflict,
				"finish or cancel the current ride before going offline").
				WithDetails(map[string]any{"rideId": session.CurrentRideID.String()})
		}

		moved, err := s.deps.Store.TransitionDriver(ctx, tx, session, target, update)
		if err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "driver.status_changed",
			AggregateType:  "driver",
			AggregateID:    actor.UserID.String(),
			ToVersion:      moved.Version,
			CityID:         actor.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "driver.status_changed:" + actor.UserID.String() + ":" + itoa(moved.Version),
			OccurredAt:     now,
			Payload: map[string]any{
				"driverId": actor.UserID.String(),
				"online":   req.Online,
				"state":    moved.State,
				"reasons":  []string{},
			},
		}); err != nil {
			return err
		}
		view = sessionView(moved)
		return nil
	})
	if err != nil {
		return nil, asDomainError(err)
	}
	return view, nil
}

// IngestLocations accepts a batch of location points from a driver app.
//
// Each point is judged on its own and the verdict is reported back. A point is
// refused when it is out of sequence, too old, from the future, too imprecise
// to place a car, or implies a speed nothing on a road reaches. Refusing is the
// point: a matching engine that believes a bad fix sends a rider a car that is
// not there.
func (s *Service) IngestLocations(ctx context.Context, actor Actor, points []domain.LocationPoint) (*LocationBatchResult, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a driver reports driver locations")
	}
	if len(points) == 0 {
		return nil, domain.Errorf(domain.CodeValidationFailed, "a location batch must carry at least one point")
	}
	if len(points) > maxLocationBatchPoints {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"a location batch may carry at most %d points", maxLocationBatchPoints)
	}
	if actor.CityID == "" {
		return nil, domain.Errorf(domain.CodeValidationFailed, "the gateway did not say which city this driver is in")
	}

	result := &LocationBatchResult{Points: make([]domain.LocationOutcome, 0, len(points))}

	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if _, err := s.deps.Store.EnsureSession(ctx, tx, actor.UserID, actor.CityID); err != nil {
			return err
		}
		session, err := s.deps.Store.SessionForUpdate(ctx, tx, actor.UserID)
		if err != nil {
			return err
		}

		now := s.now()
		lastSeq := session.LastSeq
		lastLat, lastLng := session.LastLat, session.LastLng
		lastAt := session.LastLocationAt

		for _, point := range points {
			outcome := domain.LocationOutcome{Seq: point.Seq, Accepted: true}
			place := domain.Place{Lat: point.Lat, Lng: point.Lng}

			switch {
			case !place.Valid():
				outcome.Accepted, outcome.Reason = false, domain.LocationRejectedCoordinates
			case point.Seq <= lastSeq:
				outcome.Accepted, outcome.Reason = false, domain.LocationRejectedStaleSeq
			case point.RecordedAt.IsZero():
				outcome.Accepted, outcome.Reason = false, domain.LocationRejectedStaleTime
			case point.RecordedAt.After(now.Add(maxClockSkewSeconds * time.Second)):
				outcome.Accepted, outcome.Reason = false, domain.LocationRejectedFutureTime
			case now.Sub(point.RecordedAt) > maxLocationAgeMinutes*time.Minute:
				outcome.Accepted, outcome.Reason = false, domain.LocationRejectedStaleTime
			case point.AccuracyM <= 0 || point.AccuracyM > maxAccuracyMeters:
				outcome.Accepted, outcome.Reason = false, domain.LocationRejectedAccuracy
			}

			if outcome.Accepted && lastLat != nil && lastLng != nil && lastAt != nil {
				elapsed := point.RecordedAt.Sub(*lastAt).Seconds()
				if elapsed > 0 {
					distance := geo.HaversineDistance(*lastLat, *lastLng, point.Lat, point.Lng)
					if distance/elapsed > maxPlausibleSpeedMps {
						outcome.Accepted, outcome.Reason = false, domain.LocationRejectedSpeed
					}
				}
			}

			if !outcome.Accepted {
				result.Rejected++
				result.Points = append(result.Points, outcome)
				continue
			}

			if err := s.deps.Store.RecordLocation(ctx, tx, actor.UserID, point.Seq, point.Lat, point.Lng, point.AccuracyM, point.RecordedAt); err != nil {
				return err
			}
			lat, lng, at := point.Lat, point.Lng, point.RecordedAt
			lastSeq, lastLat, lastLng, lastAt = point.Seq, &lat, &lng, &at
			result.Accepted++
			result.Points = append(result.Points, outcome)
		}

		result.LastSeq = lastSeq
		return nil
	})
	if err != nil {
		return nil, asDomainError(err)
	}
	return result, nil
}

// DriverStatus returns a driver their own session, creating it in the driver
// machine's initial state the first time they ask.
func (s *Service) DriverStatus(ctx context.Context, actor Actor) (*DriverStatusView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a driver has a driver status")
	}
	session, err := s.deps.Store.Session(ctx, s.deps.Store.Pool(), actor.UserID)
	if errors.Is(err, domain.ErrNotFound) {
		if actor.CityID == "" {
			return nil, domain.Errorf(domain.CodeValidationFailed, "the gateway did not say which city this driver is in")
		}
		session, err = s.deps.Store.EnsureSession(ctx, s.deps.Store.Pool(), actor.UserID, actor.CityID)
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	return sessionView(session), nil
}
