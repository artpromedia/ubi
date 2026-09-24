package marketplace

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// Saved (favourite) drivers (A04 item 3).
//
// A rider may save a driver they COMPLETED a marketplace trip with — never an
// arbitrary driver id — so a saved driver is someone the rider actually rode
// with. Saving is part of the deny-by-default preferred-driver capability;
// listing and removing are always allowed, so a rider can always see and
// delete what is stored about their choices. A saved driver is only ever
// ASKED first on a request (preferred.go): saving never assigns, never
// guarantees availability and never bypasses eligibility, pricing or the
// driver's own opt-in.

// Idempotency scopes for saved drivers.
const (
	scopeFavouriteSave   = "mp.favourite.save"
	scopeFavouriteRemove = "mp.favourite.remove"
)

// Saved-driver states (mp.favourite_drivers.state).
const (
	favouriteActive  = "active"
	favouriteRemoved = "removed"
)

// SaveFavouriteRequest is the body of POST /v1/mp/favourite-drivers: the
// request whose completed trip the rider took with the driver to save.
type SaveFavouriteRequest struct {
	RequestID uuid.UUID `json:"requestId"`
}

// FavouriteDriver is one mp.favourite_drivers row.
type FavouriteDriver struct {
	ID            uuid.UUID
	RiderID       uuid.UUID
	DriverID      uuid.UUID
	CityID        string
	SourceAwardID uuid.UUID
	State         string
	Version       int
	CreatedAt     time.Time
	UpdatedAt     time.Time
	RemovedAt     *time.Time
}

// FavouriteDriverView is one saved driver as the rider sees them.
type FavouriteDriverView struct {
	DriverID        string                  `json:"driverId"`
	CityID          string                  `json:"cityId"`
	State           string                  `json:"state"`
	SavedAt         time.Time               `json:"savedAt"`
	Driver          OfferDriverView         `json:"driver"`
	DriverProfile   *OfferDriverProfileView `json:"driverProfile"`
	CanRequest      bool                    `json:"canRequest"`
	CanRequestLabel string                  `json:"canRequestLabel"`
}

// FavouriteDriversView answers GET /v1/mp/favourite-drivers.
type FavouriteDriversView struct {
	Items []*FavouriteDriverView `json:"items"`
	Note  string                 `json:"note"`
}

const favouritesNote = "Asking a saved driver first never assigns them: they may offer at their own price or decline, and nothing about pricing or eligibility changes."

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const favouriteColumns = `
	id, rider_id, driver_id, city_id, source_award_id, state, version,
	created_at, updated_at, removed_at`

func scanFavourite(row pgx.Row) (*FavouriteDriver, error) {
	var f FavouriteDriver
	err := row.Scan(&f.ID, &f.RiderID, &f.DriverID, &f.CityID, &f.SourceAwardID, &f.State, &f.Version,
		&f.CreatedAt, &f.UpdatedAt, &f.RemovedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read a saved driver: %w", err)
	}
	return &f, nil
}

// FavouriteForUpdate reads and locks one rider/driver pair.
func (s *Store) FavouriteForUpdate(ctx context.Context, tx pgx.Tx, riderID, driverID uuid.UUID) (*FavouriteDriver, error) {
	return scanFavourite(tx.QueryRow(ctx, `
		SELECT `+favouriteColumns+` FROM mp.favourite_drivers
		WHERE rider_id = $1 AND driver_id = $2 FOR UPDATE`, riderID, driverID))
}

// ActiveFavourite reads one active pair.
func (s *Store) ActiveFavourite(ctx context.Context, db DB, riderID, driverID uuid.UUID) (*FavouriteDriver, error) {
	return scanFavourite(db.QueryRow(ctx, `
		SELECT `+favouriteColumns+` FROM mp.favourite_drivers
		WHERE rider_id = $1 AND driver_id = $2 AND state = $3`, riderID, driverID, favouriteActive))
}

// UpsertFavourite writes an active pair: a new row, or a removed one made
// active again (with the newer source trip). A pair that is ALREADY active
// is left untouched and answers domain.ErrNotFound: a concurrent save got
// there first (the pre-read cannot lock a row that did not exist yet), and
// re-activating it would bump the version and publish a second "saved".
func (s *Store) UpsertFavourite(ctx context.Context, tx pgx.Tx, f *FavouriteDriver) (*FavouriteDriver, error) {
	return scanFavourite(tx.QueryRow(ctx, `
		INSERT INTO mp.favourite_drivers (id, rider_id, driver_id, city_id, source_award_id, state)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (rider_id, driver_id) DO UPDATE SET
			state = EXCLUDED.state,
			city_id = EXCLUDED.city_id,
			source_award_id = EXCLUDED.source_award_id,
			version = mp.favourite_drivers.version + 1,
			removed_at = NULL,
			updated_at = now()
		WHERE mp.favourite_drivers.state <> EXCLUDED.state
		RETURNING `+favouriteColumns,
		f.ID, f.RiderID, f.DriverID, f.CityID, f.SourceAwardID, favouriteActive))
}

// RemoveFavouriteRow marks an active pair removed.
func (s *Store) RemoveFavouriteRow(ctx context.Context, tx pgx.Tx, f *FavouriteDriver, at time.Time) (*FavouriteDriver, error) {
	return scanFavourite(tx.QueryRow(ctx, `
		UPDATE mp.favourite_drivers SET state = $3, removed_at = $4, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $2
		RETURNING `+favouriteColumns, f.ID, f.Version, favouriteRemoved, at))
}

// ActiveFavouritesForRider lists a rider's saved drivers, newest first.
func (s *Store) ActiveFavouritesForRider(ctx context.Context, db DB, riderID uuid.UUID, limit int) ([]*FavouriteDriver, error) {
	rows, err := db.Query(ctx, `
		SELECT `+favouriteColumns+` FROM mp.favourite_drivers
		WHERE rider_id = $1 AND state = $2
		ORDER BY updated_at DESC LIMIT $3`, riderID, favouriteActive, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list saved drivers: %w", err)
	}
	defer rows.Close()
	var out []*FavouriteDriver
	for rows.Next() {
		f, err := scanFavourite(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ActiveFavouriteDrivers answers which of a set of drivers the rider saved.
func (s *Store) ActiveFavouriteDrivers(ctx context.Context, db DB, riderID uuid.UUID, driverIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	out := map[uuid.UUID]bool{}
	if len(driverIDs) == 0 {
		return out, nil
	}
	rows, err := db.Query(ctx, `
		SELECT driver_id FROM mp.favourite_drivers
		WHERE rider_id = $1 AND state = $2 AND driver_id = ANY($3)`, riderID, favouriteActive, driverIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to read saved drivers: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("failed to read saved drivers: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

// completedTripDriver returns the driver of a request's completed marketplace
// RIDE, or a refusal saying why there is none.
func (s *Service) completedTripDriver(ctx context.Context, request *Request) (*Award, error) {
	notCompleted := domain.Errorf(domain.CodeConflict, "you can save a driver once you have completed a trip with them").
		WithDetails(map[string]any{"reason": "trip_not_completed"})
	if request.Service != ServiceRide {
		return nil, notCompleted
	}
	award, err := s.deps.Store.LatestAwardForRequest(ctx, s.deps.Store.Pool(), request.ID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, notCompleted
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	if award.State != machine.MpAwardConfirmed || award.ExecutionID == nil {
		return nil, notCompleted
	}
	ride, err := s.deps.Store.ExecutionRideSummary(ctx, s.deps.Store.Pool(), *award.ExecutionID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, notCompleted
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	if !rideCompleted(ride) {
		return nil, notCompleted
	}
	return award, nil
}

// rideCompleted reports whether an execution ride was carried out to the end.
func rideCompleted(ride *ExecutionRideSummary) bool {
	if ride == nil || ride.CompletedAt == nil {
		return false
	}
	for _, state := range completedRideStates {
		if ride.State == state {
			return true
		}
	}
	return false
}

// SaveFavourite answers POST /v1/mp/favourite-drivers: save the driver of a
// completed trip. Idempotent; saving an already-saved driver changes nothing.
func (s *Service) SaveFavourite(ctx context.Context, actor Actor, req SaveFavouriteRequest, idempotencyKey string) (*FavouriteDriverView, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only a rider saves drivers")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeFavouriteSave, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view FavouriteDriverView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}

	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), req.RequestID)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && request.RequesterID != actor.UserID) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if err := s.requireFlag(ctx, cityconfig.FlagMarketplacePreferredDrivers, actor, request.CityID); err != nil {
		return nil, 0, err
	}
	award, err := s.completedTripDriver(ctx, request)
	if err != nil {
		return nil, 0, err
	}

	now := s.now()
	status := 201
	var saved *FavouriteDriver
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		existing, err := s.deps.Store.FavouriteForUpdate(ctx, tx, actor.UserID, award.DriverID)
		if err != nil && !errors.Is(err, domain.ErrNotFound) {
			return err
		}
		if existing != nil && existing.State == favouriteActive {
			saved, status = existing, 200
		} else {
			saved, err = s.deps.Store.UpsertFavourite(ctx, tx, &FavouriteDriver{
				ID: uuid.New(), RiderID: actor.UserID, DriverID: award.DriverID,
				CityID: request.CityID, SourceAwardID: award.ID,
			})
			if errors.Is(err, domain.ErrNotFound) {
				// A concurrent save activated the pair first: nothing
				// changes and nothing is published twice.
				current, readErr := s.deps.Store.FavouriteForUpdate(ctx, tx, actor.UserID, award.DriverID)
				if readErr != nil {
					return readErr
				}
				saved, status = current, 200
				return nil
			}
			if err != nil {
				return err
			}
			if err := writeEvent(ctx, tx, Event{
				Name:           "mp.favourite_driver.saved",
				AggregateType:  subjectFavourite,
				AggregateID:    saved.ID.String(),
				ToVersion:      saved.Version,
				CityID:         saved.CityID,
				ActorType:      "rider",
				ActorID:        actor.UserID.String(),
				IdempotencyKey: eventKey("mp.favourite_driver.saved", saved.ID.String(), itoa(saved.Version)),
				OccurredAt:     now,
				Payload: map[string]any{
					"favouriteId":   saved.ID.String(),
					"requesterId":   actor.UserID.String(),
					"savedDriverId": saved.DriverID.String(),
					"sourceAwardId": award.ID.String(),
				},
			}); err != nil {
				return err
			}
			if err := writeAudit(ctx, tx, AuditRecord{
				ActorID:     actor.UserID.String(),
				ActorRole:   actor.Role,
				Action:      "mp.favourite_driver.saved",
				SubjectType: subjectFavourite,
				SubjectID:   saved.ID.String(),
				After: map[string]any{
					"driverId": saved.DriverID.String(), "cityId": saved.CityID,
					"sourceAwardId": award.ID.String(), "version": saved.Version,
				},
				Reason: "rider saved the driver of a completed trip",
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	view := s.favouriteViewOf(ctx, actor, saved, s.driverProfilesFor(ctx, []uuid.UUID{saved.DriverID}), request.VehicleClass)
	if err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeFavouriteSave, actor.UserID, idempotencyKey, req, status, view)
	}); err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, status, nil
}

// ListFavourites answers GET /v1/mp/favourite-drivers. Always readable.
func (s *Service) ListFavourites(ctx context.Context, actor Actor) (*FavouriteDriversView, error) {
	if !actor.IsRider() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a rider has saved drivers")
	}
	rows, err := s.deps.Store.ActiveFavouritesForRider(ctx, s.deps.Store.Pool(), actor.UserID, 100)
	if err != nil {
		return nil, asDomainError(err)
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.DriverID)
	}
	profiles := s.driverProfilesFor(ctx, ids)
	view := &FavouriteDriversView{Items: make([]*FavouriteDriverView, 0, len(rows)), Note: favouritesNote}
	for _, row := range rows {
		view.Items = append(view.Items, s.favouriteViewOf(ctx, actor, row, profiles, ""))
	}
	return view, nil
}

// RemoveFavourite answers POST /v1/mp/favourite-drivers/{driverId}/remove.
// Always allowed, whatever the flag says.
func (s *Service) RemoveFavourite(ctx context.Context, actor Actor, driverID uuid.UUID, idempotencyKey string) (*FavouriteDriverView, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only a rider has saved drivers")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	body := map[string]any{"driverId": driverID.String()}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeFavouriteRemove, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view FavouriteDriverView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}
	now := s.now()
	var removed *FavouriteDriver
	var view *FavouriteDriverView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		existing, err := s.deps.Store.FavouriteForUpdate(ctx, tx, actor.UserID, driverID)
		if errors.Is(err, domain.ErrNotFound) || (err == nil && existing.State != favouriteActive) {
			return domain.Errorf(domain.CodeNotFound, "that driver is not one of your saved drivers")
		}
		if err != nil {
			return err
		}
		if removed, err = s.deps.Store.RemoveFavouriteRow(ctx, tx, existing, now); err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.favourite_driver.removed",
			AggregateType:  subjectFavourite,
			AggregateID:    removed.ID.String(),
			FromVersion:    &existing.Version,
			ToVersion:      removed.Version,
			CityID:         removed.CityID,
			ActorType:      "rider",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: eventKey("mp.favourite_driver.removed", removed.ID.String(), itoa(removed.Version)),
			OccurredAt:     now,
			Payload: map[string]any{
				"favouriteId":   removed.ID.String(),
				"requesterId":   actor.UserID.String(),
				"savedDriverId": removed.DriverID.String(),
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.favourite_driver.removed",
			SubjectType: subjectFavourite,
			SubjectID:   removed.ID.String(),
			Before:      map[string]any{"state": existing.State, "version": existing.Version},
			After:       map[string]any{"state": removed.State, "version": removed.Version},
			Reason:      "rider removed a saved driver",
		}); err != nil {
			return err
		}
		// Stored with the removal it reports: a replay after a lost answer
		// is this 200, never a 404 for an already-removed driver. (A removed
		// row's view reads nothing further.)
		view = s.favouriteViewOf(ctx, actor, removed, map[uuid.UUID]*DriverProfile{}, "")
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeFavouriteRemove, actor.UserID, idempotencyKey, body, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, 200, nil
}

// favouriteViewOf renders one saved driver, including whether the rider can
// ask them first right now. The reason a driver cannot be asked (opted out,
// or not currently taking marketplace work) is deliberately not
// distinguished.
func (s *Service) favouriteViewOf(ctx context.Context, actor Actor, f *FavouriteDriver, profiles map[uuid.UUID]*DriverProfile, vehicleClass string) *FavouriteDriverView {
	profile := profiles[f.DriverID]
	view := &FavouriteDriverView{
		DriverID:        f.DriverID.String(),
		CityID:          f.CityID,
		State:           f.State,
		SavedAt:         f.UpdatedAt,
		Driver:          verifiedDriverView(f.DriverID.String(), vehicleClass, profile),
		DriverProfile:   offerDriverProfileViewOf(profile),
		CanRequestLabel: "Not taking preferred requests right now",
	}
	if f.State != favouriteActive {
		view.CanRequestLabel = "Removed from your saved drivers"
		return view
	}
	if !s.flagOn(ctx, cityconfig.FlagMarketplacePreferredDrivers, actor.UserID.String(), f.CityID) {
		view.CanRequestLabel = "Asking a saved driver first is not available here"
		return view
	}
	if ok, err := s.driverTakesPreferredRequests(ctx, f.DriverID, f.CityID); err == nil && ok {
		view.CanRequest = true
		view.CanRequestLabel = "You can ask this driver first"
	}
	return view
}

// driverTakesPreferredRequests reports whether a driver may be named on a
// preferred request in a city: opted in, and not under a standing block.
func (s *Service) driverTakesPreferredRequests(ctx context.Context, driverID uuid.UUID, cityID string) (bool, error) {
	prefs, err := s.deps.Store.LatestDriverPreferences(ctx, s.deps.Store.Pool(), driverID, cityID)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !prefs.AcceptsPreferredRequests {
		return false, nil
	}
	blocked, err := s.driverBlocked(ctx, driverID)
	if err != nil {
		return false, err
	}
	return !blocked, nil
}
