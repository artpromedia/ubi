package marketplace

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// The stranded-ride repair (G04). Before the `cancelled_by_driver` terminal
// state existed, a driver cancellation moved a marketplace execution ride to
// `rematching` — a state legacy dispatch deliberately never re-offers for
// marketplace rides — so the ride sat there forever with its award, claim and
// rider funding untouched. This admin job converges those already-stranded
// rows through the SAME terminal funnel a fresh driver cancellation now uses.

// repairBatchCap is the hard per-call ceiling: a repair is an audited,
// operator-driven action, not a bulk migration, and each ride costs wallet
// round-trips. Plumbing, not policy.
const repairBatchCap = 50

// RepairStrandedRidesRequest is the body of
// POST /v1/admin/mp/repairs/stranded-rides.
type RepairStrandedRidesRequest struct {
	// DryRun lists the stranded rides without writing anything.
	DryRun bool `json:"dryRun"`
	// RideIDs restricts the repair to these rides; empty means "scan".
	RideIDs []uuid.UUID `json:"rideIds,omitempty"`
	// Limit bounds one call (default and hard cap: 50).
	Limit int `json:"limit,omitempty"`
}

// StrandedRideRow is one stranded ride as the dry run reports it.
type StrandedRideRow struct {
	RideID        string    `json:"rideId"`
	CityID        string    `json:"cityId"`
	StrandedSince time.Time `json:"strandedSince"`
	AwardID       string    `json:"awardId"`
}

// Repair outcomes, one per ride, so a replayed or raced call reads honestly.
const (
	RepairOutcomeRepaired    = "repaired"
	RepairOutcomeNotStranded = "not_stranded"
)

// RepairRideResult is one ride's apply outcome.
type RepairRideResult struct {
	RideID  string `json:"rideId"`
	Outcome string `json:"outcome"`
	Detail  string `json:"detail,omitempty"`
}

// RepairStrandedRidesResponse answers both modes.
type RepairStrandedRidesResponse struct {
	DryRun   bool               `json:"dryRun"`
	Limit    int                `json:"limit"`
	Stranded []StrandedRideRow  `json:"stranded"`
	Results  []RepairRideResult `json:"results"`
}

// StrandedMarketplaceRides lists rides carrying the stranded signature:
// `rematching` with a marketplace award mark. Legacy rides in `rematching`
// never match (their marketplace_award_id is NULL) and are never touched.
func (s *Store) StrandedMarketplaceRides(ctx context.Context, db DB, rideIDs []uuid.UUID, limit int) ([]StrandedRideRow, error) {
	query := `
		SELECT id, city_id, updated_at, marketplace_award_id
		FROM ride.rides
		WHERE state = $1 AND marketplace_award_id IS NOT NULL`
	args := []any{machine.RiderRematching}
	if len(rideIDs) > 0 {
		query += ` AND id = ANY($2)`
		args = append(args, rideIDs)
	}
	query += fmt.Sprintf(` ORDER BY updated_at ASC LIMIT %d`, limit)

	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list stranded marketplace rides: %w", err)
	}
	defer rows.Close()

	var stranded []StrandedRideRow
	for rows.Next() {
		var id, awardID uuid.UUID
		var cityID string
		var since time.Time
		if err := rows.Scan(&id, &cityID, &since, &awardID); err != nil {
			return nil, fmt.Errorf("failed to read stranded ride row: %w", err)
		}
		stranded = append(stranded, StrandedRideRow{
			RideID:        id.String(),
			CityID:        cityID,
			StrandedSince: since,
			AwardID:       awardID.String(),
		})
	}
	return stranded, rows.Err()
}

// AdminRepairStrandedRides handles POST /v1/admin/mp/repairs/stranded-rides.
//
// Dry run reads and reports. Apply moves each stranded ride across the
// contract's repair edge (`rematching → cancelled_by_driver`) in its own
// transaction, audited per ride, then hands it to the SAME terminal funnel a
// live driver cancellation uses — claim released, award cancelled, commission
// reversed and rider funding released exactly once under the award's keys,
// queued next claim promoted or released. It never touches money rows
// directly, and anything the wallet cannot confirm right now is owed durably
// to the sweep. A ride that moved on (or was already repaired) is reported
// per ride and skipped, so a replay converges instead of double-acting.
func (s *Service) AdminRepairStrandedRides(ctx context.Context, actor Actor, req RepairStrandedRidesRequest, idempotencyKey string) (*RepairStrandedRidesResponse, int, error) {
	if actor.Role != move.RoleAdmin {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only an operator can repair stranded rides")
	}

	limit := req.Limit
	if limit <= 0 || limit > repairBatchCap {
		limit = repairBatchCap
	}

	if req.DryRun {
		// Read-only: no idempotency record, nothing written.
		stranded, err := s.deps.Store.StrandedMarketplaceRides(ctx, s.deps.Store.Pool(), req.RideIDs, limit)
		if err != nil {
			return nil, 0, asDomainError(err)
		}
		if stranded == nil {
			stranded = []StrandedRideRow{}
		}
		return &RepairStrandedRidesResponse{
			DryRun:   true,
			Limit:    limit,
			Stranded: stranded,
			Results:  []RepairRideResult{},
		}, 200, nil
	}

	// Apply mode mutates, so it honors Idempotency-Key like every other
	// mutating marketplace endpoint: a replayed key answers the recorded
	// response without re-scanning.
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeAdminRepair, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var response RepairStrandedRidesResponse
		if err := decodeJSON(replay.Response, &response); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &response, replay.StatusCode, nil
	}

	stranded, err := s.deps.Store.StrandedMarketplaceRides(ctx, s.deps.Store.Pool(), req.RideIDs, limit)
	if err != nil {
		return nil, 0, asDomainError(err)
	}

	response := &RepairStrandedRidesResponse{
		DryRun:   false,
		Limit:    limit,
		Stranded: []StrandedRideRow{},
		Results:  make([]RepairRideResult, 0, len(stranded)+len(req.RideIDs)),
	}

	repaired := map[uuid.UUID]bool{}
	for _, row := range stranded {
		rideID, parseErr := uuid.Parse(row.RideID)
		if parseErr != nil {
			continue
		}
		repaired[rideID] = true
		response.Results = append(response.Results, s.repairStrandedRide(ctx, actor, rideID))
	}
	// Explicitly named rides that no longer carry the stranded signature are
	// reported rather than silently dropped: "already repaired or moved on"
	// is the answer a replayed apply needs.
	for _, rideID := range req.RideIDs {
		if repaired[rideID] {
			continue
		}
		response.Results = append(response.Results, RepairRideResult{
			RideID:  rideID.String(),
			Outcome: RepairOutcomeNotStranded,
			Detail:  "not in rematching with a marketplace award; already repaired or moved on",
		})
	}

	if err := s.deps.Store.SaveIdempotent(ctx, s.deps.Store.Pool(), scopeAdminRepair, actor.UserID, idempotencyKey, req, 200, response); err != nil {
		return nil, 0, asDomainError(err)
	}
	return response, 200, nil
}

// repairStrandedRide converges one stranded ride: the contract's repair edge
// in a transaction of its own (re-checked under lock, so a raced or replayed
// call skips instead of double-moving), then the shared terminal funnel.
func (s *Service) repairStrandedRide(ctx context.Context, actor Actor, rideID uuid.UUID) RepairRideResult {
	mv := s.deps.Store.Move()
	now := s.now()

	moved := false
	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		ride, err := mv.RideForUpdate(ctx, tx, rideID)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				return nil
			}
			return err
		}
		if ride.State != machine.RiderRematching {
			return nil
		}
		awardID, err := mv.MarketplaceAwardID(ctx, tx, rideID)
		if err != nil {
			return err
		}
		if awardID == nil {
			// A legacy ride legitimately rematching: never touched.
			return nil
		}

		fromVersion := ride.Version
		repairedRide, err := mv.Transition(ctx, tx, ride, machine.RiderCancelledByDriver, move.RideUpdate{
			CancelledAt: &now,
		})
		if err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "ride.cancelled_by_driver",
			AggregateType:  "ride",
			AggregateID:    ride.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      repairedRide.Version,
			CityID:         ride.CityID,
			ActorType:      "admin",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "ride.cancelled_by_driver:" + ride.ID.String() + ":" + itoa(repairedRide.Version),
			OccurredAt:     now,
			Payload: map[string]any{
				"rideId":     ride.ID.String(),
				"reasonCode": ride.CancelReasonCode,
				"terminal":   true,
				"repair":     true,
				"awardId":    awardID.String(),
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.repair.stranded_ride",
			SubjectType: "ride",
			SubjectID:   ride.ID.String(),
			Before:      map[string]any{"state": machine.RiderRematching, "awardId": awardID.String()},
			After:       map[string]any{"state": machine.RiderCancelledByDriver},
			Reason:      "stranded marketplace ride converged to the driver-cancel terminal state",
		}); err != nil {
			return err
		}
		moved = true
		return nil
	})
	if err != nil {
		return RepairRideResult{RideID: rideID.String(), Outcome: RepairOutcomeNotStranded, Detail: err.Error()}
	}
	if !moved {
		return RepairRideResult{
			RideID:  rideID.String(),
			Outcome: RepairOutcomeNotStranded,
			Detail:  "not in rematching with a marketplace award; already repaired or moved on",
		}
	}

	// The ride is terminal and committed: the SAME funnel as a live driver
	// cancellation. If this call is lost, the sweep finds the current claim
	// with its terminal execution and converges — the repair never invents a
	// second money path.
	if err := s.handleExecutionTerminal(ctx, rideID); err != nil {
		s.deps.Logger.Warn().Err(err).Str("ride_id", rideID.String()).
			Msg("repair terminal handling deferred; the sweep will converge it")
		return RepairRideResult{
			RideID:  rideID.String(),
			Outcome: RepairOutcomeRepaired,
			Detail:  "ride is terminal; award/claim/funding convergence deferred to the sweep",
		}
	}
	return RepairRideResult{RideID: rideID.String(), Outcome: RepairOutcomeRepaired}
}
