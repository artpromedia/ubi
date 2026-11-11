package marketplace

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// Off-road flag operator decisions (P2-02 / CC-A04).
const (
	OffroadDecisionDismiss            = "dismiss"
	OffroadDecisionWarnFleet          = "warn_fleet"
	OffroadDecisionEscalateToStanding = "escalate_to_standing"
)

const subjectOffroadFlag = "mp_offroad_use_flag"

// OffroadUseFlagRow is one row of mp.offroad_use_flags joined with its
// mp.vehicle_occupancy breakdown report.
type OffroadUseFlagRow struct {
	ID               uuid.UUID
	OccupancyID      uuid.UUID
	BlockID          string
	OccupancyState   string
	ReportedAt       time.Time
	VehicleID        string
	DriverID         uuid.UUID
	CityID           *string
	Trigger          string
	SubjectRef       string
	ObservedAt       time.Time
	CreatedAt        time.Time
	Decision         *string
	DecidedBy        *uuid.UUID
	DecidedAt        *time.Time
	DecisionReason   *string
	StandingActionID *uuid.UUID
}

// OffroadUseFlagAdminView is one off-road abuse flag as UBI ops sees it:
// opaque ids, states, timestamps and the operator's decision — never PII,
// coordinates or tokens.
type OffroadUseFlagAdminView struct {
	FlagID           string     `json:"flagId"`
	OccupancyID      string     `json:"occupancyId"`
	BlockID          string     `json:"blockId"`
	OccupancyState   string     `json:"occupancyState"`
	ReportedAt       time.Time  `json:"reportedAt"`
	VehicleID        string     `json:"vehicleId"`
	DriverID         string     `json:"driverId"`
	CityID           string     `json:"cityId,omitempty"`
	Trigger          string     `json:"trigger"`
	SubjectRef       string     `json:"subjectRef"`
	ObservedAt       time.Time  `json:"observedAt"`
	CreatedAt        time.Time  `json:"createdAt"`
	AgeSec           int64      `json:"ageSec"`
	Decision         string     `json:"decision,omitempty"`
	DecidedBy        *string    `json:"decidedBy,omitempty"`
	DecidedAt        *time.Time `json:"decidedAt,omitempty"`
	DecisionReason   string     `json:"decisionReason,omitempty"`
	StandingActionID *string    `json:"standingActionId,omitempty"`
}

// OffroadUseFlagsPage answers GET /v1/admin/mp/offroad-flags.
type OffroadUseFlagsPage struct {
	Rows       []*OffroadUseFlagAdminView `json:"rows"`
	NextCursor *string                    `json:"nextCursor,omitempty"`
}

// OffroadFlagsFilter narrows GET /v1/admin/mp/offroad-flags.
type OffroadFlagsFilter struct {
	CityID    string
	VehicleID string
	Trigger   string
	Since     *time.Time
	Cursor    string
}

func toOffroadUseFlagView(row *OffroadUseFlagRow, now time.Time) *OffroadUseFlagAdminView {
	toStr := func(id *uuid.UUID) *string {
		if id == nil {
			return nil
		}
		v := id.String()
		return &v
	}
	view := &OffroadUseFlagAdminView{
		FlagID:           row.ID.String(),
		OccupancyID:      row.OccupancyID.String(),
		BlockID:          row.BlockID,
		OccupancyState:   row.OccupancyState,
		ReportedAt:       row.ReportedAt,
		VehicleID:        row.VehicleID,
		DriverID:         row.DriverID.String(),
		Trigger:          row.Trigger,
		SubjectRef:       row.SubjectRef,
		ObservedAt:       row.ObservedAt,
		CreatedAt:        row.CreatedAt,
		AgeSec:           ageSec(now, row.ObservedAt),
		DecidedBy:        toStr(row.DecidedBy),
		DecidedAt:        row.DecidedAt,
		StandingActionID: toStr(row.StandingActionID),
	}
	if row.CityID != nil {
		view.CityID = *row.CityID
	}
	if row.Decision != nil {
		view.Decision = *row.Decision
	}
	if row.DecisionReason != nil {
		view.DecisionReason = *row.DecisionReason
	}
	return view
}

// AdminOffroadFlags lists off-road use flags, newest-observed first, filtered
// by city, vehicle, trigger (driver_online | trip_started) and since.
func (s *Service) AdminOffroadFlags(ctx context.Context, actor Actor, filter OffroadFlagsFilter) (*OffroadUseFlagsPage, error) {
	if err := requireAdminRead(actor, "read the off-road use flags board"); err != nil {
		return nil, err
	}
	switch filter.Trigger {
	case "", OffRoadUseDriverOnline, OffRoadUseTripStarted:
	default:
		return nil, domain.Errorf(domain.CodeValidationFailed, "trigger must be driver_online or trip_started").
			WithDetails(map[string]any{"field": "trigger"})
	}
	rows, err := s.deps.Store.ListOffroadUseFlags(ctx, s.deps.Store.Pool(), filter, feedPageSize)
	if err != nil {
		return nil, asDomainError(err)
	}
	now := s.now()
	page := &OffroadUseFlagsPage{Rows: []*OffroadUseFlagAdminView{}}
	for _, row := range rows {
		page.Rows = append(page.Rows, toOffroadUseFlagView(row, now))
	}
	if len(rows) == feedPageSize {
		last := rows[len(rows)-1]
		next := encodeCursor(last.ObservedAt, last.ID)
		page.NextCursor = &next
	}
	return page, nil
}

// DecideOffroadFlagRequest is the body of
// POST /v1/admin/mp/offroad-flags/{flagId}/decide.
type DecideOffroadFlagRequest struct {
	Decision           string `json:"decision"`
	Reason             string `json:"reason"`
	StandingActionType string `json:"standingActionType,omitempty"`
}

// DecideOffroadFlagResult answers POST /v1/admin/mp/offroad-flags/{flagId}/decide.
type DecideOffroadFlagResult struct {
	Row            *OffroadUseFlagAdminView `json:"row"`
	StandingAction *StandingActionView      `json:"standingAction,omitempty"`
}

func offroadDecideBody(flagID uuid.UUID, req DecideOffroadFlagRequest) map[string]any {
	body := map[string]any{
		"flagId":   flagID.String(),
		"decision": req.Decision,
		"reason":   req.Reason,
	}
	if req.StandingActionType != "" {
		body["standingActionType"] = req.StandingActionType
	}
	return body
}

// AdminDecideOffroadFlag records an operator's disposition on one off-road
// abuse flag (`dismiss`, `warn_fleet`, or `escalate_to_standing`), audited and
// idempotent. When escalated to standing, a `policy_violation` standing action
// is recorded in the same transaction (defaulting to a `pending_approval`
// suspension so maker-checker protects driver eligibility, or an informational
// `warning` when `standingActionType` is `"warning"`).
func (s *Service) AdminDecideOffroadFlag(ctx context.Context, actor Actor, flagID uuid.UUID, req DecideOffroadFlagRequest, idempotencyKey string) (*DecideOffroadFlagResult, int, error) {
	if err := requireAdmin(actor, "decide an off-road use flag"); err != nil {
		return nil, 0, err
	}
	switch req.Decision {
	case OffroadDecisionDismiss, OffroadDecisionWarnFleet, OffroadDecisionEscalateToStanding:
	default:
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "decision must be dismiss, warn_fleet or escalate_to_standing").
			WithDetails(map[string]any{"field": "decision"})
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "reason is required to decide an off-road use flag").
			WithDetails(map[string]any{"field": "reason"})
	}
	req.Reason = reason
	actionType := strings.TrimSpace(req.StandingActionType)
	if req.Decision == OffroadDecisionEscalateToStanding {
		if actionType == "" {
			actionType = StandingActionSuspension
		}
		if actionType != StandingActionWarning && actionType != StandingActionSuspension {
			return nil, 0, domain.Errorf(domain.CodeValidationFailed, "standingActionType must be warning or suspension").
				WithDetails(map[string]any{"field": "standingActionType"})
		}
		req.StandingActionType = actionType
	} else if actionType != "" {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "standingActionType applies only when decision is escalate_to_standing").
			WithDetails(map[string]any{"field": "standingActionType"})
	}

	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	bodyKey := offroadDecideBody(flagID, req)
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeAdminOffroadDecide, actor.UserID, idempotencyKey, bodyKey)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var response DecideOffroadFlagResult
		if err := decodeJSON(replay.Response, &response); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &response, replay.StatusCode, nil
	}

	now := s.now()
	var response *DecideOffroadFlagResult
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.OffroadUseFlagForUpdate(ctx, tx, flagID)
		if errors.Is(err, domain.ErrNotFound) {
			return domain.Errorf(domain.CodeNotFound, "that off-road use flag does not exist")
		}
		if err != nil {
			return err
		}
		if locked.Decision != nil {
			return domain.Errorf(domain.CodeVersionConflict,
				"this off-road use flag has already been decided (%s)", *locked.Decision)
		}

		var standingID *uuid.UUID
		var standingView *StandingActionView
		if req.Decision == OffroadDecisionEscalateToStanding {
			cityID := "unspecified"
			if locked.CityID != nil && *locked.CityID != "" {
				cityID = *locked.CityID
			} else if actor.CityID != "" {
				cityID = actor.CityID
			}
			action := &StandingAction{
				ID:         uuid.New(),
				DriverID:   locked.DriverID,
				CityID:     cityID,
				ActionType: actionType,
				ReasonCode: "policy_violation",
				ReasonNote: fmt.Sprintf("off-road flag %s (%s on vehicle %s): %s", locked.ID.String(), locked.Trigger, locked.VehicleID, reason),
				ProposedBy: actor.UserID,
			}
			if isProtectedStandingAction(actionType) {
				action.Status = StandingStatusPendingApproval
			} else {
				action.Status = StandingStatusActive
				decidedBy := actor.UserID
				action.DecidedBy = &decidedBy
				action.DecidedAt = &now
				action.DecisionReason = "informational action from off-road use flag; no approval required"
			}
			if err := s.deps.Store.InsertStandingAction(ctx, tx, action); err != nil {
				return err
			}
			if err := writeAudit(ctx, tx, AuditRecord{
				ActorID: actor.UserID.String(), ActorRole: actor.Role,
				Action: "mp.standing.propose", SubjectType: "mp_driver_standing", SubjectID: action.ID.String(),
				Before: map[string]any{},
				After: map[string]any{
					"driverId":   locked.DriverID.String(),
					"actionType": actionType,
					"status":     action.Status,
					"flagId":     locked.ID.String(),
				},
				Reason: reason,
			}); err != nil {
				return err
			}
			reloadedAction, err := s.deps.Store.StandingActionByID(ctx, tx, action.ID)
			if err != nil {
				return err
			}
			standingID = &action.ID
			standingView = toStandingActionView(reloadedAction)
		}

		if _, err := tx.Exec(ctx, `
			UPDATE mp.offroad_use_flags
			SET decision = $2, decided_by = $3, decided_at = $4, decision_reason = $5, standing_action_id = $6
			WHERE id = $1`,
			flagID, req.Decision, actor.UserID, now, reason, standingID,
		); err != nil {
			return fmt.Errorf("failed to record off-road flag decision: %w", err)
		}

		after := map[string]any{
			"decision":  req.Decision,
			"vehicleId": locked.VehicleID,
			"driverId":  locked.DriverID.String(),
			"trigger":   locked.Trigger,
		}
		if standingID != nil {
			after["standingActionId"] = standingID.String()
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role,
			Action: "mp.admin.offroad_flag_decided", SubjectType: subjectOffroadFlag, SubjectID: flagID.String(),
			Before: map[string]any{"decision": nil},
			After:  after,
			Reason: reason,
		}); err != nil {
			return err
		}

		reloaded, err := s.deps.Store.OffroadUseFlagByID(ctx, tx, flagID)
		if err != nil {
			return err
		}
		response = &DecideOffroadFlagResult{
			Row:            toOffroadUseFlagView(reloaded, now),
			StandingAction: standingView,
		}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeAdminOffroadDecide, actor.UserID, idempotencyKey, bodyKey, 200, response)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return response, 200, nil
}

const offroadUseFlagSelect = `
	SELECT f.id, f.occupancy_id, o.source_id, o.state, o.created_at,
		f.vehicle_id, f.driver_id, f.city_id, f.trigger, f.subject_ref,
		f.observed_at, f.created_at,
		f.decision, f.decided_by, f.decided_at, f.decision_reason, f.standing_action_id
	FROM mp.offroad_use_flags f
	JOIN mp.vehicle_occupancy o ON o.id = f.occupancy_id`

func scanOffroadUseFlag(scanner interface{ Scan(dest ...any) error }) (*OffroadUseFlagRow, error) {
	var row OffroadUseFlagRow
	if err := scanner.Scan(
		&row.ID, &row.OccupancyID, &row.BlockID, &row.OccupancyState, &row.ReportedAt,
		&row.VehicleID, &row.DriverID, &row.CityID, &row.Trigger, &row.SubjectRef,
		&row.ObservedAt, &row.CreatedAt,
		&row.Decision, &row.DecidedBy, &row.DecidedAt, &row.DecisionReason, &row.StandingActionID,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to scan off-road use flag: %w", err)
	}
	return &row, nil
}

// ListOffroadUseFlags pages off-road use flags newest-observed first.
func (s *Store) ListOffroadUseFlags(ctx context.Context, db DB, filter OffroadFlagsFilter, limit int) ([]*OffroadUseFlagRow, error) {
	query := offroadUseFlagSelect + `
		WHERE ($1 = '' OR f.city_id = $1)
			AND ($2 = '' OR f.vehicle_id = $2)
			AND ($3 = '' OR f.trigger = $3)`
	args := []any{filter.CityID, filter.VehicleID, filter.Trigger}
	if filter.Since != nil {
		query += fmt.Sprintf(` AND f.observed_at >= $%d`, len(args)+1)
		args = append(args, *filter.Since)
	}
	if filter.Cursor != "" {
		at, id, err := decodeCursor(filter.Cursor)
		if err != nil {
			return nil, domain.Errorf(domain.CodeValidationFailed, "that is not an off-road flag cursor").
				WithDetails(map[string]any{"field": "cursor"})
		}
		query += fmt.Sprintf(` AND (f.observed_at, f.id) < ($%d, $%d)`, len(args)+1, len(args)+2)
		args = append(args, at, id)
	}
	query += fmt.Sprintf(` ORDER BY f.observed_at DESC, f.id DESC LIMIT %d`, limit)
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list off-road use flags: %w", err)
	}
	defer rows.Close()
	var out []*OffroadUseFlagRow
	for rows.Next() {
		row, err := scanOffroadUseFlag(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// OffroadUseFlagByID loads one off-road use flag joined with its occupancy row.
func (s *Store) OffroadUseFlagByID(ctx context.Context, db DB, id uuid.UUID) (*OffroadUseFlagRow, error) {
	return scanOffroadUseFlag(db.QueryRow(ctx, offroadUseFlagSelect+` WHERE f.id = $1`, id))
}

// OffroadUseFlagForUpdate locks one off-road use flag row for operator decision.
func (s *Store) OffroadUseFlagForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*OffroadUseFlagRow, error) {
	return scanOffroadUseFlag(tx.QueryRow(ctx, offroadUseFlagSelect+` WHERE f.id = $1 FOR UPDATE OF f`, id))
}
