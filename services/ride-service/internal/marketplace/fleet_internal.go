package marketplace

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// INTERNAL CONTRACT A — the routes ride-service serves fleet-service under
// /internal/fleet (packages/contracts/src/marketplace-fleet.ts). Service to
// service only: the handler authenticates X-Service-Key against
// FLEET_RIDE_SERVICE_KEY (>= 32 characters, constant-time, fail closed) and
// the client gateway never proxies these routes. A fleet sees bookings ONLY
// as opaque OccupiedBlocks.
//
//  1. POST occupancy/maintenance:preview           PreviewMaintenance
//  2. POST occupancy/maintenance                   RecordMaintenance
//  3. POST occupancy/maintenance/{blockId}/release ReleaseFleetBlock
//  4. POST occupancy/off-road                      ReportOffRoad
//  5. GET  occupancy/blocks                        OccupiedBlocks
//  6. GET  drivers/{driverId}/calendar             FleetDriverCalendar
//  7. POST bookings/{blockId}/vehicle-swaps        ProposeVehicleSwap (fleet_swaps.go)

// Contract A idempotency scopes (keyed under fleetServiceActorID).
const (
	scopeFleetMaintenanceCreate  = "mp.fleet.maintenance.create"
	scopeFleetMaintenanceRelease = "mp.fleet.maintenance.release"
	scopeFleetOffRoad            = "mp.fleet.offroad"
	scopeFleetSwapPropose        = "mp.fleet.swap.propose"
)

// Plumbing bounds on contract A inputs, not policy.
const (
	maxFleetIDLength       = 128
	maxFleetQueryIDs       = 200
	maxFleetQueryWindow    = 62 * 24 * time.Hour
	maxMaintenanceDuration = 31 * 24 * time.Hour
	feasibleSearchHorizon  = 90 * 24 * time.Hour
	feasibleSearchRows     = 500
	maxFleetBlocks         = 2000
)

// fleetIdemBody binds a path id into the fingerprinted idempotent body.
func fleetIdemBody(pathID string, body any) map[string]any {
	return map[string]any{"path": pathID, "body": body}
}

// lookupFleetIdempotent is LookupIdempotent under the fleet-service
// namespace, answering contract A's idempotency_conflict.
func (s *Service) lookupFleetIdempotent(ctx context.Context, db DB, scope, key string, body any) (*IdempotentResult, error) {
	replay, err := s.deps.Store.LookupIdempotent(ctx, db, scope, fleetServiceActorID, key, body)
	if err != nil {
		return nil, asFleetError(err)
	}
	return replay, nil
}

// asFleetError maps an error onto contract A's codes: a reused
// Idempotency-Key with another body is idempotency_conflict there.
func asFleetError(err error) *domain.Error {
	mapped := asDomainError(err)
	if mapped != nil && mapped.Code == domain.CodeIdempotencyKeyReuse {
		return domain.Errorf(domain.CodeIdempotencyConflict, "%s", mapped.Message).Wrap(err)
	}
	return mapped
}

func validFleetID(id string) bool {
	return id != "" && len(id) <= maxFleetIDLength && strings.TrimSpace(id) == id
}

// MaintenanceWindow is routes 1 and 2's body (MpMaintenancePreviewRequestSchema,
// MpMaintenanceCreateRequestSchema; BlockID only on route 2).
type MaintenanceWindow struct {
	BlockID   string    `json:"blockId,omitempty"`
	VehicleID string    `json:"vehicleId"`
	Kind      string    `json:"kind"`
	StartsAt  time.Time `json:"startsAt"`
	EndsAt    time.Time `json:"endsAt"`
}

func (m *MaintenanceWindow) validate(needBlock bool) error {
	m.StartsAt, m.EndsAt = m.StartsAt.UTC(), m.EndsAt.UTC()
	switch {
	case needBlock && !validFleetID(m.BlockID):
		return domain.Errorf(domain.CodeValidationFailed, "blockId is required").WithDetails(map[string]any{"field": "blockId"})
	case !needBlock && m.BlockID != "":
		return domain.Errorf(domain.CodeValidationFailed, "a preview takes no blockId").WithDetails(map[string]any{"field": "blockId"})
	case !validFleetID(m.VehicleID):
		return domain.Errorf(domain.CodeValidationFailed, "vehicleId is required").WithDetails(map[string]any{"field": "vehicleId"})
	case m.StartsAt.IsZero() || m.EndsAt.IsZero() || !m.EndsAt.After(m.StartsAt):
		return domain.Errorf(domain.CodeValidationFailed, "endsAt must be after startsAt").WithDetails(map[string]any{"field": "endsAt"})
	case m.EndsAt.Sub(m.StartsAt) > maxMaintenanceDuration:
		return domain.Errorf(domain.CodeValidationFailed, "a maintenance block may last at most 31 days").WithDetails(map[string]any{"field": "endsAt"})
	}
	if _, ok := maintenanceKinds[m.Kind]; !ok {
		return domain.Errorf(domain.CodeValidationFailed, "kind must be planned_service, inspection or repair").
			WithDetails(map[string]any{"field": "kind"})
	}
	return nil
}

// FeasibleWindow is a window the server found free.
type FeasibleWindow struct {
	StartsAt time.Time `json:"startsAt"`
	EndsAt   time.Time `json:"endsAt"`
}

// MaintenancePreview is route 1's answer (MpMaintenancePreviewSchema).
type MaintenancePreview struct {
	Feasible           bool            `json:"feasible"`
	AffectedBlocks     []OccupiedBlock `json:"affectedBlocks"`
	NextFeasibleWindow *FeasibleWindow `json:"nextFeasibleWindow"`
}

// blocksOf projects the booking rows among ledger rows as opaque blocks.
func (s *Service) blocksOf(ctx context.Context, db DB, rows []*VehicleOccupancy) ([]OccupiedBlock, error) {
	blocks := []OccupiedBlock{}
	for _, row := range rows {
		if row.Kind != OccupancyKindBooking {
			continue
		}
		id, err := uuid.Parse(row.SourceID)
		if err != nil {
			continue
		}
		b, err := s.deps.Store.BookingByID(ctx, db, id)
		if errors.Is(err, domain.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		blocks = append(blocks, occupiedBlockOf(b))
	}
	return blocks, nil
}

// nextFeasibleWindow finds the earliest window of the same length, starting
// at or after `from`, that overlaps no active booking or maintenance row on
// the vehicle (buffers included), within the search horizon.
func (s *Service) nextFeasibleWindow(ctx context.Context, db DB, vehicleID string, from time.Time, length time.Duration) (*FeasibleWindow, error) {
	horizon := from.Add(feasibleSearchHorizon)
	rows, err := s.deps.Store.OccupancyFrom(ctx, db, vehicleID, from, horizon, feasibleSearchRows)
	if err != nil {
		return nil, err
	}
	candidate := from
	for _, row := range rows {
		if !candidate.Add(length).After(row.Start) {
			break
		}
		if row.End != nil && row.End.After(candidate) {
			candidate = *row.End
		}
	}
	if len(rows) == feasibleSearchRows || candidate.Add(length).After(horizon) {
		return nil, nil
	}
	return &FeasibleWindow{StartsAt: candidate.UTC(), EndsAt: candidate.Add(length).UTC()}, nil
}

// PreviewMaintenance is route 1: would this planned block fit? It reads the
// ledger only; nothing is held.
func (s *Service) PreviewMaintenance(ctx context.Context, body MaintenanceWindow) (*MaintenancePreview, error) {
	if err := body.validate(false); err != nil {
		return nil, err
	}
	end := body.EndsAt
	overlapping, err := s.deps.Store.OverlappingOccupancy(ctx, s.deps.Store.Pool(), body.VehicleID,
		[]string{OccupancyKindBooking, OccupancyKindMaintenance}, body.StartsAt, &end)
	if err != nil {
		return nil, asDomainError(err)
	}
	blocks, err := s.blocksOf(ctx, s.deps.Store.Pool(), overlapping)
	if err != nil {
		return nil, asDomainError(err)
	}
	preview := &MaintenancePreview{Feasible: len(overlapping) == 0, AffectedBlocks: blocks}
	if !preview.Feasible {
		if preview.NextFeasibleWindow, err = s.nextFeasibleWindow(ctx, s.deps.Store.Pool(), body.VehicleID,
			body.StartsAt, body.EndsAt.Sub(body.StartsAt)); err != nil {
			return nil, asDomainError(err)
		}
	}
	return preview, nil
}

// OccupancyRecorded is route 2's 201 (MpOccupancyRecordedSchema).
type OccupancyRecorded struct {
	OccupancyID string `json:"occupancyId"`
}

// occupancyConflict is contract A's 409 with the opaque blocks in the way.
func occupancyConflict(blocks []OccupiedBlock) *domain.Error {
	if blocks == nil {
		blocks = []OccupiedBlock{}
	}
	return domain.Errorf(domain.CodeOccupancyConflict,
		"the vehicle is occupied for that interval; planned maintenance is never confirmed over a booking").
		WithDetails(map[string]any{"affectedBlocks": blocks})
}

// RecordMaintenance is route 2: a planned block, recorded atomically under
// the vehicle exclusion constraint — or refused with the blocks in the way.
func (s *Service) RecordMaintenance(ctx context.Context, body MaintenanceWindow, idempotencyKey string) (*OccupancyRecorded, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	if err := body.validate(true); err != nil {
		return nil, 0, err
	}
	idem := fleetIdemBody("", body)
	replay, err := s.lookupFleetIdempotent(ctx, s.deps.Store.Pool(), scopeFleetMaintenanceCreate, idempotencyKey, idem)
	if err != nil {
		return nil, 0, err
	}
	if replay != nil {
		var stored OccupancyRecorded
		if err := decodeJSON(replay.Response, &stored); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &stored, replay.StatusCode, nil
	}
	now := s.now()
	kind := body.Kind
	end := body.EndsAt
	var result *OccupancyRecorded
	var replayed *IdempotentResult
	var conflict []*VehicleOccupancy
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.deps.Store.AcquireVehicleLock(ctx, tx, body.VehicleID); err != nil {
			return err
		}
		if replayed, err = s.lookupFleetIdempotent(ctx, tx, scopeFleetMaintenanceCreate, idempotencyKey, idem); err != nil || replayed != nil {
			return err
		}
		existing, err := s.deps.Store.OccupancyBySource(ctx, tx, OccupancyKindMaintenance, body.BlockID)
		switch {
		case err == nil:
			if existing.State != machine.MpOccupancyActive || existing.VehicleID != body.VehicleID ||
				!existing.Start.Equal(body.StartsAt) || existing.End == nil || !existing.End.Equal(body.EndsAt) ||
				existing.MaintenanceKind == nil || *existing.MaintenanceKind != body.Kind {
				return domain.Errorf(domain.CodeConflict, "that block is already recorded with other terms").
					WithDetails(map[string]any{"blockId": body.BlockID, "state": existing.State})
			}
			result = &OccupancyRecorded{OccupancyID: existing.ID.String()}
			return s.deps.Store.SaveIdempotent(ctx, tx, scopeFleetMaintenanceCreate, fleetServiceActorID, idempotencyKey, idem, 201, result)
		case !errors.Is(err, domain.ErrNotFound):
			return err
		}
		// Under the vehicle's ledger lock the overlap read is authoritative;
		// the exclusion constraint is the backstop.
		if conflict, err = s.deps.Store.OverlappingOccupancy(ctx, tx, body.VehicleID,
			[]string{OccupancyKindBooking, OccupancyKindMaintenance}, body.StartsAt, &end); err != nil {
			return err
		}
		if len(conflict) > 0 {
			return errOccupancyConflict
		}
		occupancy := &VehicleOccupancy{
			ID: uuid.New(), Kind: OccupancyKindMaintenance, SourceID: body.BlockID, VehicleID: body.VehicleID,
			Start: body.StartsAt, End: &end, MaintenanceKind: &kind, CreatedAt: now,
		}
		if err := s.deps.Store.InsertOccupancy(ctx, tx, occupancy); err != nil {
			return err
		}
		if err := writeOccupancyEvent(ctx, tx, occupancy, "vehicle_occupancy.recorded", "fleet", "fleet-service", now,
			"a fleet's planned maintenance block now occupies the vehicle", nil); err != nil {
			return err
		}
		result = &OccupancyRecorded{OccupancyID: occupancy.ID.String()}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeFleetMaintenanceCreate, fleetServiceActorID, idempotencyKey, idem, 201, result)
	})
	if errors.Is(err, errOccupancyConflict) {
		if conflict == nil {
			conflict, _ = s.deps.Store.OverlappingOccupancy(ctx, s.deps.Store.Pool(), body.VehicleID,
				[]string{OccupancyKindBooking, OccupancyKindMaintenance}, body.StartsAt, &end)
		}
		blocks, blockErr := s.blocksOf(ctx, s.deps.Store.Pool(), conflict)
		if blockErr != nil {
			return nil, 0, asDomainError(blockErr)
		}
		return nil, 0, occupancyConflict(blocks)
	}
	if err != nil {
		return nil, 0, asFleetError(err)
	}
	if replayed != nil {
		var stored OccupancyRecorded
		if err := decodeJSON(replayed.Response, &stored); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &stored, replayed.StatusCode, nil
	}
	return result, 201, nil
}

// OccupancyReleased is route 3's answer (MpOccupancyReleasedSchema).
type OccupancyReleased struct {
	Released bool `json:"released"`
}

// ReleaseFleetBlock is route 3: the fleet's maintenance or off-road block no
// longer occupies the vehicle. Idempotent — a block already released, or
// never recorded, answers the same. Releasing an off-road report clears the
// risk it put on bookings.
func (s *Service) ReleaseFleetBlock(ctx context.Context, blockID, idempotencyKey string) (*OccupancyReleased, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	if !validFleetID(blockID) {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "that is not a block id")
	}
	idem := fleetIdemBody(blockID, nil)
	replay, err := s.lookupFleetIdempotent(ctx, s.deps.Store.Pool(), scopeFleetMaintenanceRelease, idempotencyKey, idem)
	if err != nil {
		return nil, 0, err
	}
	if replay != nil {
		var stored OccupancyReleased
		if err := decodeJSON(replay.Response, &stored); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &stored, replay.StatusCode, nil
	}
	rows, err := s.deps.Store.FleetBlocksBySource(ctx, s.deps.Store.Pool(), blockID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	vehicles := []string{}
	for _, row := range rows {
		vehicles = appendOnce(vehicles, row.VehicleID)
	}
	sort.Strings(vehicles)
	now := s.now()
	result := &OccupancyReleased{Released: true}
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		for _, vehicle := range vehicles {
			if err := s.deps.Store.AcquireVehicleLock(ctx, tx, vehicle); err != nil {
				return err
			}
		}
		for _, kind := range []string{OccupancyKindMaintenance, OccupancyKindOffRoad} {
			released, err := s.deps.Store.ReleaseOccupancyBySource(ctx, tx, kind, blockID, "released_by_fleet")
			if err != nil {
				return err
			}
			if released == nil {
				continue
			}
			if err := writeOccupancyEvent(ctx, tx, released, "vehicle_occupancy.released", "fleet", "fleet-service", now,
				"the fleet released its block; it no longer occupies the vehicle", nil); err != nil {
				return err
			}
			if kind != OccupancyKindOffRoad {
				continue
			}
			bookings, err := s.deps.Store.BookingsWithOpenBlocker(ctx, tx, BlockerOffRoad, released.ID.String())
			if err != nil {
				return err
			}
			for _, bookingID := range bookings {
				locked, err := s.deps.Store.BookingForUpdate(ctx, tx, bookingID)
				if err != nil {
					return err
				}
				if _, err := s.clearBookingRisk(ctx, tx, locked, BlockerOffRoad, released.ID.String(),
					"off_road_released", "fleet", "fleet-service", now); err != nil {
					return err
				}
			}
		}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeFleetMaintenanceRelease, fleetServiceActorID, idempotencyKey, idem, 200, result)
	})
	if err != nil {
		return nil, 0, asFleetError(err)
	}
	return result, 200, nil
}

// OffRoadReport is route 4's body (MpOffRoadRequestSchema).
type OffRoadReport struct {
	BlockID        string     `json:"blockId"`
	VehicleID      string     `json:"vehicleId"`
	StartsAt       time.Time  `json:"startsAt"`
	ExpectedEndsAt *time.Time `json:"expectedEndsAt"`
}

// AtRiskBooking is one entry of route 4's answer.
type AtRiskBooking struct {
	BlockID          string    `json:"blockId"`
	DecisionDeadline time.Time `json:"decisionDeadline"`
}

// OffRoadRecorded is route 4's 201 (MpOffRoadRecordedSchema).
type OffRoadRecorded struct {
	OccupancyID    string          `json:"occupancyId"`
	AtRiskBookings []AtRiskBooking `json:"atRiskBookings"`
}

// ReportOffRoad is route 4: an unplanned breakdown. It is NEVER refused by
// bookings: it takes effect at once, and every overlapping confirmed booking
// on the vehicle moves to at_risk with its decision deadline (the swap or
// withdraw path follows). The report is audited and visible to UBI ops; the
// vehicle going online during it is flagged (fleet_risk.go).
func (s *Service) ReportOffRoad(ctx context.Context, body OffRoadReport, idempotencyKey string) (*OffRoadRecorded, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	body.StartsAt = body.StartsAt.UTC()
	switch {
	case !validFleetID(body.BlockID):
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "blockId is required").WithDetails(map[string]any{"field": "blockId"})
	case !validFleetID(body.VehicleID):
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "vehicleId is required").WithDetails(map[string]any{"field": "vehicleId"})
	case body.StartsAt.IsZero():
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "startsAt is required").WithDetails(map[string]any{"field": "startsAt"})
	case body.ExpectedEndsAt != nil && !body.ExpectedEndsAt.After(body.StartsAt):
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "expectedEndsAt must be after startsAt").
			WithDetails(map[string]any{"field": "expectedEndsAt"})
	}
	if body.ExpectedEndsAt != nil {
		end := body.ExpectedEndsAt.UTC()
		body.ExpectedEndsAt = &end
	}
	idem := fleetIdemBody("", body)
	replay, err := s.lookupFleetIdempotent(ctx, s.deps.Store.Pool(), scopeFleetOffRoad, idempotencyKey, idem)
	if err != nil {
		return nil, 0, err
	}
	if replay != nil {
		var stored OffRoadRecorded
		if err := decodeJSON(replay.Response, &stored); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &stored, replay.StatusCode, nil
	}
	now := s.now()
	var result *OffRoadRecorded
	var replayed *IdempotentResult
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.deps.Store.AcquireVehicleLock(ctx, tx, body.VehicleID); err != nil {
			return err
		}
		if replayed, err = s.lookupFleetIdempotent(ctx, tx, scopeFleetOffRoad, idempotencyKey, idem); err != nil || replayed != nil {
			return err
		}
		occupancy, err := s.deps.Store.OccupancyBySource(ctx, tx, OccupancyKindOffRoad, body.BlockID)
		switch {
		case err == nil:
			sameEnd := (occupancy.End == nil) == (body.ExpectedEndsAt == nil) &&
				(occupancy.End == nil || occupancy.End.Equal(*body.ExpectedEndsAt))
			if occupancy.State != machine.MpOccupancyActive || occupancy.VehicleID != body.VehicleID ||
				!occupancy.Start.Equal(body.StartsAt) || !sameEnd {
				return domain.Errorf(domain.CodeConflict, "that block is already recorded with other terms").
					WithDetails(map[string]any{"blockId": body.BlockID, "state": occupancy.State})
			}
		case errors.Is(err, domain.ErrNotFound):
			occupancy = &VehicleOccupancy{
				ID: uuid.New(), Kind: OccupancyKindOffRoad, SourceID: body.BlockID, VehicleID: body.VehicleID,
				Start: body.StartsAt, End: body.ExpectedEndsAt, CreatedAt: now,
			}
			if err := s.deps.Store.InsertOccupancy(ctx, tx, occupancy); err != nil {
				return err
			}
			if err := writeOccupancyEvent(ctx, tx, occupancy, "vehicle_occupancy.recorded", "fleet", "fleet-service", now,
				"a fleet reported the vehicle off the road; overlapping bookings are at risk, never cancelled", nil); err != nil {
				return err
			}
		default:
			return err
		}
		states := append([]string{machine.MpBookingHeld}, riskBookingStates()...)
		bookings, err := s.deps.Store.BookingsOnVehicle(ctx, tx, body.VehicleID, states, body.StartsAt, body.ExpectedEndsAt)
		if err != nil {
			return err
		}
		sort.Slice(bookings, func(i, j int) bool { return bookings[i].ID.String() < bookings[j].ID.String() })
		result = &OffRoadRecorded{OccupancyID: occupancy.ID.String(), AtRiskBookings: []AtRiskBooking{}}
		for _, b := range bookings {
			locked, err := s.deps.Store.BookingForUpdate(ctx, tx, b.ID)
			if err != nil {
				return err
			}
			moved, err := s.openBookingRisk(ctx, tx, locked, BlockerOffRoad, occupancy.ID.String(),
				map[string]any{"blockId": body.BlockID, "vehicleId": body.VehicleID}, "fleet", "fleet-service", now)
			if err != nil {
				return err
			}
			if moved.Risk == machine.MpRiskAtRisk && moved.RiskDeadline != nil {
				result.AtRiskBookings = append(result.AtRiskBookings, AtRiskBooking{
					BlockID: moved.BlockID.String(), DecisionDeadline: moved.RiskDeadline.UTC(),
				})
			}
		}
		sort.Slice(result.AtRiskBookings, func(i, j int) bool {
			return result.AtRiskBookings[i].DecisionDeadline.Before(result.AtRiskBookings[j].DecisionDeadline)
		})
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeFleetOffRoad, fleetServiceActorID, idempotencyKey, idem, 201, result)
	})
	if err != nil {
		return nil, 0, asFleetError(err)
	}
	if replayed != nil {
		var stored OffRoadRecorded
		if err := decodeJSON(replayed.Response, &stored); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &stored, replayed.StatusCode, nil
	}
	return result, 201, nil
}

// OccupiedBlocksQuery is route 5's query.
type OccupiedBlocksQuery struct {
	VehicleIDs []string
	DriverIDs  []uuid.UUID
	From       time.Time
	To         time.Time
}

// ParseFleetWindow reads contract A's from/to query pair.
func ParseFleetWindow(rawFrom, rawTo string) (time.Time, time.Time, error) {
	from, err := time.Parse(time.RFC3339Nano, rawFrom)
	if err != nil {
		return time.Time{}, time.Time{}, domain.Errorf(domain.CodeValidationFailed, "from must be an ISO-8601 instant").
			WithDetails(map[string]any{"field": "from"})
	}
	to, err := time.Parse(time.RFC3339Nano, rawTo)
	if err != nil {
		return time.Time{}, time.Time{}, domain.Errorf(domain.CodeValidationFailed, "to must be an ISO-8601 instant").
			WithDetails(map[string]any{"field": "to"})
	}
	if !to.After(from) || to.Sub(from) > maxFleetQueryWindow {
		return time.Time{}, time.Time{}, domain.Errorf(domain.CodeValidationFailed, "to must be after from, within 62 days").
			WithDetails(map[string]any{"field": "to"})
	}
	return from.UTC(), to.UTC(), nil
}

// ParseFleetIDList splits a comma-separated id list, refusing empty entries.
func ParseFleetIDList(raw, field string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if !validFleetID(part) {
			return nil, domain.Errorf(domain.CodeValidationFailed, "%s carries an empty or unusable id", field).
				WithDetails(map[string]any{"field": field})
		}
		out = appendOnce(out, part)
	}
	if len(out) > maxFleetQueryIDs {
		return nil, domain.Errorf(domain.CodeValidationFailed, "at most %d ids per query", maxFleetQueryIDs).
			WithDetails(map[string]any{"field": field})
	}
	return out, nil
}

// OccupiedBlocksView is route 5's answer (MpOccupiedBlocksSchema).
type OccupiedBlocksView struct {
	Blocks []OccupiedBlock `json:"blocks"`
}

// OccupiedBlocks is route 5: the fleet-safe projection of the bookings on
// the given vehicles and drivers in [from, to) — exactly the OccupiedBlock
// fields, nothing else.
func (s *Service) OccupiedBlocks(ctx context.Context, query OccupiedBlocksQuery) (*OccupiedBlocksView, error) {
	if len(query.VehicleIDs) == 0 && len(query.DriverIDs) == 0 {
		return nil, domain.Errorf(domain.CodeValidationFailed, "name at least one vehicleId or driverId").
			WithDetails(map[string]any{"field": "vehicleIds"})
	}
	bookings, err := s.deps.Store.BookingsOccupying(ctx, s.deps.Store.Pool(), query.VehicleIDs, query.DriverIDs,
		query.From, query.To, maxFleetBlocks)
	if err != nil {
		return nil, asDomainError(err)
	}
	view := &OccupiedBlocksView{Blocks: make([]OccupiedBlock, 0, len(bookings))}
	for _, b := range bookings {
		view.Blocks = append(view.Blocks, occupiedBlockOf(b))
	}
	return view, nil
}

// FleetDriverCalendar is route 6: the driver-entitled calendar entries
// (MpDriverCalendarSchema's bookings, the DRIVER's own view) for composing
// that driver's own schedule — served by fleet-service to the driver only
// (decisions correction 7), never to a fleet.
func (s *Service) FleetDriverCalendar(ctx context.Context, driverID uuid.UUID, from, to time.Time) (*DriverCalendarView, error) {
	bookings, err := s.deps.Store.BookingsOccupying(ctx, s.deps.Store.Pool(), nil, []uuid.UUID{driverID}, from, to, maxFleetBlocks)
	if err != nil {
		return nil, asDomainError(err)
	}
	view := &DriverCalendarView{Bookings: []*AdvanceBookingView{}, Note: driverCalendarNote}
	for _, b := range bookings {
		view.Bookings = append(view.Bookings, s.bookingView(ctx, b, viewerDriver))
	}
	return view, nil
}
