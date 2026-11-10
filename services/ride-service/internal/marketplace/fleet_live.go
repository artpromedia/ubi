package marketplace

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// LiveFleetVehicle is the fleet vehicle resolved for a driver's live online
// session and snapshotted onto live awards (CC-A01 / DEC-3 = A).
//
// Why both mp.driver_online_vehicles and mp.awards.fleet_vehicle exist:
//   - mp.driver_online_vehicles is the driver's CURRENT live session vehicle,
//     resolved at go-online and refreshed on each live award.
//   - mp.awards.fleet_vehicle is the IMMUTABLE vehicle snapshot on a specific
//     live award, so a trip already in progress keeps the vehicle it started
//     with even if the driver's fleet assignment changes later, and every
//     post-award surface (assigned view, queue, guest trip link, receipt, ops
//     timeline) names the exact same vehicle.
type LiveFleetVehicle struct {
	VehicleID        string     `json:"vehicleId"`
	FleetID          string     `json:"fleetId"`
	AssignmentID     string     `json:"assignmentId"`
	PlateMasked      string     `json:"plateMasked"`
	Make             *string    `json:"make,omitempty"`
	Model            *string    `json:"model,omitempty"`
	Colour           *string    `json:"colour,omitempty"`
	BodyType         string     `json:"bodyType"`
	Classes          []string   `json:"classes"`
	Capacity         int        `json:"capacity"`
	InsuranceExpiry  *time.Time `json:"insuranceExpiry,omitempty"`
	InspectionExpiry *time.Time `json:"inspectionExpiry,omitempty"`
	ShiftEndsAt      *time.Time `json:"shiftEndsAt,omitempty"`
	ResolvedAt       time.Time  `json:"resolvedAt"`
}

func liveFleetVehicleFrom(answer *FleetOnlineVehicle, resolvedAt time.Time) *LiveFleetVehicle {
	if answer == nil || answer.Vehicle == nil || answer.AssignmentID == nil {
		return nil
	}
	v := answer.Vehicle
	classes := make([]string, len(v.Classes))
	copy(classes, v.Classes)
	return &LiveFleetVehicle{
		VehicleID:        v.VehicleID,
		FleetID:          v.FleetID,
		AssignmentID:     *answer.AssignmentID,
		PlateMasked:      v.PlateMasked,
		Make:             v.Make,
		Model:            v.Model,
		Colour:           v.Colour,
		BodyType:         v.BodyType,
		Classes:          classes,
		Capacity:         v.Capacity,
		InsuranceExpiry:  v.InsuranceExpiry,
		InspectionExpiry: v.InspectionExpiry,
		ShiftEndsAt:      answer.ShiftEndsAt,
		ResolvedAt:       resolvedAt.UTC(),
	}
}

// SupportsClass reports whether the fleet vehicle is eligible for `vehicleClass`.
func (v *LiveFleetVehicle) SupportsClass(vehicleClass string) bool {
	if v == nil {
		return false
	}
	for _, class := range v.Classes {
		if class == vehicleClass {
			return true
		}
	}
	return false
}

func fleetSeatNote(capacity int) string {
	if capacity <= 0 {
		return capacityNote
	}
	if capacity == 1 {
		return "1 passenger seat"
	}
	return strconv.Itoa(capacity) + " passenger seats"
}

// OfferVehicleView renders the fleet vehicle into MpOfferVehicleSchema.
func (v *LiveFleetVehicle) OfferVehicleView(vehicleClass string) *OfferVehicleView {
	if v == nil {
		return nil
	}
	body := v.BodyType
	plate := v.PlateMasked
	seats := v.Capacity
	return &OfferVehicleView{
		Class:         vehicleClass,
		CapacitySeats: &seats,
		CapacityNote:  fleetSeatNote(v.Capacity),
		BodyType:      &body,
		Make:          v.Make,
		Model:         v.Model,
		Colour:        v.Colour,
		PlateMasked:   &plate,
		Verified:      true,
	}
}

// MoveVehicleView renders the fleet vehicle onto GET /v1/rides/{id}.
func (v *LiveFleetVehicle) MoveVehicleView(vehicleClass string) *move.AssignedVehicleView {
	if v == nil {
		return nil
	}
	body := v.BodyType
	seats := v.Capacity
	return &move.AssignedVehicleView{
		Class:         vehicleClass,
		CapacitySeats: &seats,
		BodyType:      &body,
		Make:          v.Make,
		Model:         v.Model,
		Colour:        v.Colour,
		PlateMasked:   v.PlateMasked,
		Verified:      true,
	}
}

// OverrideDriverDisplay replaces the rider-facing driver card's masked plate
// with the assigned fleet vehicle's plate so a stale drivers.vehicle_id plate
// is never shown on a live fleet ride.
func (v *LiveFleetVehicle) OverrideDriverDisplay(driver OfferDriverView) OfferDriverView {
	if v == nil {
		return driver
	}
	driver.PlateMasked = v.PlateMasked
	return driver
}

// TimelineSummary formats the non-PII vehicle metadata written into outbox and
// audit payloads so the ops timeline names the exact same vehicle as the rider
// receipt and assigned view.
func (v *LiveFleetVehicle) TimelineSummary() map[string]any {
	if v == nil {
		return nil
	}
	return map[string]any{
		"vehicleId":    v.VehicleID,
		"fleetId":      v.FleetID,
		"assignmentId": v.AssignmentID,
		"plateMasked":  v.PlateMasked,
		"make":         v.Make,
		"model":        v.Model,
		"colour":       v.Colour,
		"bodyType":     v.BodyType,
		"classes":      v.Classes,
		"capacity":     v.Capacity,
		"resolvedAt":   v.ResolvedAt.UTC().Format(time.RFC3339),
	}
}

// ---------------------------------------------------------------------------
// Store persistence (mp.driver_online_vehicles)
// ---------------------------------------------------------------------------

const onlineVehicleColumns = `
	driver_id, city_id, vehicle_id, fleet_id, assignment_id,
	plate_masked, make, model, colour, body_type, classes, capacity,
	insurance_expiry, inspection_expiry, shift_ends_at, resolved_at`

func scanDriverOnlineVehicle(row pgx.Row) (uuid.UUID, string, *LiveFleetVehicle, error) {
	var driverID uuid.UUID
	var cityID string
	var v LiveFleetVehicle
	err := row.Scan(
		&driverID, &cityID, &v.VehicleID, &v.FleetID, &v.AssignmentID,
		&v.PlateMasked, &v.Make, &v.Model, &v.Colour, &v.BodyType, &v.Classes, &v.Capacity,
		&v.InsuranceExpiry, &v.InspectionExpiry, &v.ShiftEndsAt, &v.ResolvedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, "", nil, domain.ErrNotFound
		}
		return uuid.Nil, "", nil, fmt.Errorf("failed to read driver online vehicle: %w", err)
	}
	if v.Classes == nil {
		v.Classes = []string{}
	}
	return driverID, cityID, &v, nil
}

// UpsertDriverOnlineVehicle records or refreshes a fleet driver's resolved
// online session vehicle.
func (s *Store) UpsertDriverOnlineVehicle(ctx context.Context, db DB, driverID uuid.UUID, cityID string, v *LiveFleetVehicle) error {
	classes := v.Classes
	if classes == nil {
		classes = []string{}
	}
	_, err := db.Exec(ctx, `
		INSERT INTO mp.driver_online_vehicles (
			driver_id, city_id, vehicle_id, fleet_id, assignment_id,
			plate_masked, make, model, colour, body_type, classes, capacity,
			insurance_expiry, inspection_expiry, shift_ends_at, resolved_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
		ON CONFLICT (driver_id) DO UPDATE SET
			city_id = EXCLUDED.city_id,
			vehicle_id = EXCLUDED.vehicle_id,
			fleet_id = EXCLUDED.fleet_id,
			assignment_id = EXCLUDED.assignment_id,
			plate_masked = EXCLUDED.plate_masked,
			make = EXCLUDED.make,
			model = EXCLUDED.model,
			colour = EXCLUDED.colour,
			body_type = EXCLUDED.body_type,
			classes = EXCLUDED.classes,
			capacity = EXCLUDED.capacity,
			insurance_expiry = EXCLUDED.insurance_expiry,
			inspection_expiry = EXCLUDED.inspection_expiry,
			shift_ends_at = EXCLUDED.shift_ends_at,
			resolved_at = EXCLUDED.resolved_at,
			updated_at = now()`,
		driverID, cityID, v.VehicleID, v.FleetID, v.AssignmentID,
		v.PlateMasked, v.Make, v.Model, v.Colour, v.BodyType, classes, v.Capacity,
		v.InsuranceExpiry, v.InspectionExpiry, v.ShiftEndsAt, v.ResolvedAt.UTC(),
	)
	if err != nil {
		return fmt.Errorf("failed to upsert driver online vehicle: %w", err)
	}
	return nil
}

// DeleteDriverOnlineVehicle clears a driver's online fleet vehicle record.
func (s *Store) DeleteDriverOnlineVehicle(ctx context.Context, db DB, driverID uuid.UUID) error {
	if _, err := db.Exec(ctx, `DELETE FROM mp.driver_online_vehicles WHERE driver_id = $1`, driverID); err != nil {
		return fmt.Errorf("failed to delete driver online vehicle: %w", err)
	}
	return nil
}

// DriverOnlineVehicle reads one driver's online fleet vehicle, or ErrNotFound.
func (s *Store) DriverOnlineVehicle(ctx context.Context, db DB, driverID uuid.UUID) (*LiveFleetVehicle, error) {
	_, _, v, err := scanDriverOnlineVehicle(db.QueryRow(ctx,
		`SELECT `+onlineVehicleColumns+` FROM mp.driver_online_vehicles WHERE driver_id = $1`, driverID))
	return v, err
}

// DriverOnlineVehicles batch-reads online fleet vehicles for a set of drivers.
func (s *Store) DriverOnlineVehicles(ctx context.Context, db DB, driverIDs []uuid.UUID) (map[uuid.UUID]*LiveFleetVehicle, error) {
	out := map[uuid.UUID]*LiveFleetVehicle{}
	if len(driverIDs) == 0 {
		return out, nil
	}
	rows, err := db.Query(ctx,
		`SELECT `+onlineVehicleColumns+` FROM mp.driver_online_vehicles WHERE driver_id = ANY($1)`, driverIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to list driver online vehicles: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		id, _, v, err := scanDriverOnlineVehicle(rows)
		if err != nil {
			return nil, err
		}
		out[id] = v
	}
	return out, rows.Err()
}

// OnlineDriverRef pairs a driver and city holding an online fleet vehicle.
type OnlineDriverRef struct {
	DriverID uuid.UUID
	CityID   string
}

// OnlineDriversOnVehicle lists drivers whose online session currently names
// `vehicleID` (for the off-road sweep backstop).
func (s *Store) OnlineDriversOnVehicle(ctx context.Context, db DB, vehicleID string) ([]OnlineDriverRef, error) {
	rows, err := db.Query(ctx,
		`SELECT driver_id, city_id FROM mp.driver_online_vehicles WHERE vehicle_id = $1`, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("failed to list online drivers on vehicle %s: %w", vehicleID, err)
	}
	defer rows.Close()
	var out []OnlineDriverRef
	for rows.Next() {
		var ref OnlineDriverRef
		if err := rows.Scan(&ref.DriverID, &ref.CityID); err != nil {
			return nil, fmt.Errorf("failed to scan online driver on vehicle %s: %w", vehicleID, err)
		}
		out = append(out, ref)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Go-online guard, live award re-resolution & ride view projection
// ---------------------------------------------------------------------------

func fleetVehicleUnavailableError(reason string, details map[string]any) *domain.Error {
	var msg string
	switch reason {
	case "fleet_service_unavailable":
		msg = "We could not verify your assigned fleet vehicle right now. Try going online again in a moment."
	case OnlineVehicleNoActiveShift:
		msg = "You do not have an active signed fleet shift right now. Ask your fleet to assign a vehicle before going online."
	case OnlineVehicleDocExpired:
		msg = "Your assigned fleet vehicle has expired or missing insurance or inspection documents and cannot go online."
	case OnlineVehicleInactive:
		msg = "Your assigned fleet vehicle is not active right now. Contact your fleet manager."
	case "off_road":
		msg = "Your assigned fleet vehicle is reported off the road and cannot go online until the fleet clears it."
	default:
		msg = "Your assigned fleet vehicle is unavailable right now."
	}
	meta := map[string]any{"reason": reason}
	for k, v := range details {
		meta[k] = v
	}
	return domain.Errorf(domain.CodeFleetVehicleUnavailable, "%s", msg).WithDetails(meta)
}

func (s *Service) onlineSubjectRefFor(ctx context.Context, driverID uuid.UUID, now time.Time) string {
	instant := now
	if state, onlineSince, err := s.deps.Store.DriverOnlineSince(ctx, s.deps.Store.Pool(), driverID); err == nil &&
		state != machine.DriverOffline && onlineSince != nil {
		instant = *onlineSince
	}
	return "online:" + instant.UTC().Truncate(time.Microsecond).Format(time.RFC3339Nano)
}

// AuthorizeDriverOnline implements move.DriverOnlineGuard (CC-A01 / DEC-3 = A).
// Called BEFORE move.SetDriverStatus opens its transaction.
func (s *Service) AuthorizeDriverOnline(ctx context.Context, driverID uuid.UUID, cityID string) error {
	pool := s.deps.Store.Pool()
	if !s.flagOn(ctx, cityconfig.FlagFleet, driverID.String(), cityID) {
		_ = s.deps.Store.DeleteDriverOnlineVehicle(ctx, pool, driverID)
		return nil
	}

	now := s.now()
	answer, err := s.deps.Fleet.OnlineVehicle(ctx, driverID, cityID, now)
	if err != nil {
		_ = s.deps.Store.DeleteDriverOnlineVehicle(ctx, pool, driverID)
		return fleetVehicleUnavailableError("fleet_service_unavailable", nil).Wrap(err)
	}
	if !answer.FleetMember {
		_ = s.deps.Store.DeleteDriverOnlineVehicle(ctx, pool, driverID)
		return nil
	}

	if answer.Vehicle != nil {
		end := now.Add(time.Second)
		reports, occErr := s.deps.Store.OverlappingOccupancy(ctx, pool, answer.Vehicle.VehicleID, []string{OccupancyKindOffRoad}, now, &end)
		if occErr != nil {
			_ = s.deps.Store.DeleteDriverOnlineVehicle(ctx, pool, driverID)
			return fleetVehicleUnavailableError("fleet_service_unavailable", map[string]any{"vehicleId": answer.Vehicle.VehicleID}).Wrap(occErr)
		}
		if len(reports) > 0 {
			subjectRef := s.onlineSubjectRefFor(ctx, driverID, now)
			for _, report := range reports {
				if flagErr := s.flagOffRoadUse(ctx, report, driverID, cityID, OffRoadUseDriverOnline, subjectRef, now); flagErr != nil {
					s.deps.Logger.Error().Err(flagErr).Str("vehicle_id", answer.Vehicle.VehicleID).Msg("failed to flag off-road go-online attempt")
				}
			}
			_ = s.deps.Store.DeleteDriverOnlineVehicle(ctx, pool, driverID)
			return fleetVehicleUnavailableError("off_road", map[string]any{"vehicleId": answer.Vehicle.VehicleID})
		}
	}

	if answer.Status != OnlineVehicleOK || answer.Vehicle == nil {
		_ = s.deps.Store.DeleteDriverOnlineVehicle(ctx, pool, driverID)
		extra := map[string]any{}
		if answer.Vehicle != nil {
			extra["vehicleId"] = answer.Vehicle.VehicleID
		}
		return fleetVehicleUnavailableError(answer.Status, extra)
	}
	if !answer.Vehicle.DocumentsValidAt(now) {
		_ = s.deps.Store.DeleteDriverOnlineVehicle(ctx, pool, driverID)
		return fleetVehicleUnavailableError(OnlineVehicleDocExpired, map[string]any{"vehicleId": answer.Vehicle.VehicleID})
	}

	live := liveFleetVehicleFrom(answer, now)
	if err := s.deps.Store.UpsertDriverOnlineVehicle(ctx, pool, driverID, cityID, live); err != nil {
		return domain.Errorf(domain.CodeServiceUnavailable, "could not record the driver's assigned fleet vehicle").Wrap(err)
	}
	return nil
}

// DriverWentOffline implements move.DriverOnlineGuard.
func (s *Service) DriverWentOffline(ctx context.Context, driverID uuid.UUID) {
	if err := s.deps.Store.DeleteDriverOnlineVehicle(ctx, s.deps.Store.Pool(), driverID); err != nil {
		s.deps.Logger.Warn().Err(err).Str("driver_id", driverID.String()).Msg("could not clear driver online vehicle")
	}
}

// resolveLiveAwardVehicle re-resolves a fleet driver's assigned vehicle right
// before Transaction 1 of SelectWinner on a live slot (current or next). If
// the driver's shift ended, swapped to another vehicle, expired documents or
// went off-road since go-online, the live award either adopts the new valid
// fleet vehicle or refuses selection cleanly so the rider never receives a
// stale plate while any trip already in progress keeps its own award snapshot.
func (s *Service) resolveLiveAwardVehicle(ctx context.Context, driverID uuid.UUID, cityID, vehicleClass string, now time.Time) (*LiveFleetVehicle, error) {
	pool := s.deps.Store.Pool()
	if !s.flagOn(ctx, cityconfig.FlagFleet, driverID.String(), cityID) {
		return nil, nil
	}

	answer, err := s.deps.Fleet.OnlineVehicle(ctx, driverID, cityID, now)
	if err != nil {
		_ = s.deps.Store.DeleteDriverOnlineVehicle(ctx, pool, driverID)
		return nil, domain.Errorf(domain.CodeSlotUnavailable,
			"the driver's assigned fleet vehicle could not be verified right now; choose another offer or try again shortly").
			WithDetails(map[string]any{"reason": "fleet_vehicle_unavailable", "cause": "fleet_service_unavailable"}).
			Wrap(err)
	}
	if !answer.FleetMember {
		_ = s.deps.Store.DeleteDriverOnlineVehicle(ctx, pool, driverID)
		return nil, nil
	}
	if answer.Vehicle != nil {
		end := now.Add(time.Second)
		reports, occErr := s.deps.Store.OverlappingOccupancy(ctx, pool, answer.Vehicle.VehicleID, []string{OccupancyKindOffRoad}, now, &end)
		if occErr != nil {
			_ = s.deps.Store.DeleteDriverOnlineVehicle(ctx, pool, driverID)
			return nil, domain.Errorf(domain.CodeSlotUnavailable,
				"the driver's assigned fleet vehicle could not be verified right now").
				WithDetails(map[string]any{"reason": "fleet_vehicle_unavailable"}).
				Wrap(occErr)
		}
		if len(reports) > 0 {
			_ = s.deps.Store.DeleteDriverOnlineVehicle(ctx, pool, driverID)
			return nil, domain.Errorf(domain.CodeSlotUnavailable,
				"the driver's assigned fleet vehicle is off the road and cannot take this trip").
				WithDetails(map[string]any{"reason": "fleet_vehicle_unavailable", "cause": "off_road", "vehicleId": answer.Vehicle.VehicleID})
		}
	}
	if answer.Status != OnlineVehicleOK || answer.Vehicle == nil || !answer.Vehicle.DocumentsValidAt(now) {
		_ = s.deps.Store.DeleteDriverOnlineVehicle(ctx, pool, driverID)
		cause := answer.Status
		if cause == OnlineVehicleOK {
			cause = OnlineVehicleDocExpired
		}
		return nil, domain.Errorf(domain.CodeSlotUnavailable,
			"the driver's assigned fleet vehicle is no longer available for this trip").
			WithDetails(map[string]any{"reason": "fleet_vehicle_unavailable", "cause": cause})
	}
	if !answer.Vehicle.SupportsClass(vehicleClass) {
		live := liveFleetVehicleFrom(answer, now)
		_ = s.deps.Store.UpsertDriverOnlineVehicle(ctx, pool, driverID, cityID, live)
		return nil, domain.Errorf(domain.CodeSlotUnavailable,
			"the driver's assigned fleet vehicle does not offer the %q class", vehicleClass).
			WithDetails(map[string]any{"reason": "fleet_vehicle_unavailable", "cause": "class_mismatch", "vehicleId": answer.Vehicle.VehicleID})
	}

	live := liveFleetVehicleFrom(answer, now)
	if err := s.deps.Store.UpsertDriverOnlineVehicle(ctx, pool, driverID, cityID, live); err != nil {
		s.deps.Logger.Warn().Err(err).Str("driver_id", driverID.String()).Msg("could not refresh driver online vehicle at award")
	}
	return live, nil
}

// awardDriverAndVehicleFor resolves the consistent rider-facing driver +
// vehicle projections for a committed or pending award. Must only be called
// OUTSIDE a DB transaction (calls user-service driverProfilesFor).
func (s *Service) awardDriverAndVehicleFor(ctx context.Context, award *Award, vehicleClass string) (OfferDriverView, *OfferVehicleView) {
	profiles := s.driverProfilesFor(ctx, []uuid.UUID{award.DriverID})
	profile := profiles[award.DriverID]
	driver := verifiedDriverView(award.DriverID.String(), vehicleClass, profile)
	if award.FleetVehicle != nil {
		return award.FleetVehicle.OverrideDriverDisplay(driver), award.FleetVehicle.OfferVehicleView(vehicleClass)
	}
	return driver, offerVehicleViewOf(vehicleClass, profile)
}

// MarketplaceRideVehicle implements move.RideVehicleResolver for GET /v1/rides/{id}.
func (s *Service) MarketplaceRideVehicle(ctx context.Context, awardID uuid.UUID, vehicleClass string) *move.AssignedVehicleView {
	award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), awardID)
	if err != nil {
		s.deps.Logger.Warn().Err(err).Str("award_id", awardID.String()).Msg("could not load marketplace award for ride vehicle")
		return nil
	}
	if award.FleetVehicle != nil {
		return award.FleetVehicle.MoveVehicleView(vehicleClass)
	}
	profiles := s.driverProfilesFor(ctx, []uuid.UUID{award.DriverID})
	profile := profiles[award.DriverID]
	if !profile.Verified() || profile.Vehicle == nil {
		return nil
	}
	body := profile.Vehicle.Type
	return &move.AssignedVehicleView{
		Class:       vehicleClass,
		BodyType:    &body,
		Make:        profile.Vehicle.Make,
		Model:       profile.Vehicle.Model,
		Colour:      profile.Vehicle.Colour,
		PlateMasked: profile.Vehicle.PlateMasked,
		Verified:    true,
	}
}
