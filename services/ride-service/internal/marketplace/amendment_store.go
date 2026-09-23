package marketplace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// ---------------------------------------------------------------------------
// Execution routes: the committed terms of one awarded execution (A02).
// ---------------------------------------------------------------------------

// WaitingTerms are the paid stop-waiting terms an execution carries, taken
// from the award's own pricing snapshot and published to both parties: the
// included allowance at each stop is the expected dwell the fare already
// priced; past it, waiting accrues per started minute at PerMinMinor up to
// the rider's authorized cap (MaxAuthorizedMinor per approval); a stop whose
// total wait reaches ExcessiveAfterSec is excessive and the driver may leave
// it. Arrival is geofenced like pickup arrival, with the GPS accuracy (up to
// MaxAccuracyMeters) as tolerance.
type WaitingTerms struct {
	IncludedBasis      string `json:"includedBasis"`
	PerMinMinor        int64  `json:"perMinMinor"`
	MaxAuthorizedMinor int64  `json:"maxAuthorizedMinor"`
	ExcessiveAfterSec  int    `json:"excessiveAfterSec"`
	GeofenceMeters     int    `json:"geofenceMeters"`
	MaxAccuracyMeters  int    `json:"maxAccuracyMeters"`
	LocationMaxAgeSec  int    `json:"locationMaxAgeSec"`
}

// includedBasisStopDwell names the allowance rule: the stop's priced dwell.
const includedBasisStopDwell = "stop_dwell"

// ExecutionRoute is one row of mp.execution_routes.
type ExecutionRoute struct {
	AwardID                 uuid.UUID
	RequestID               uuid.UUID
	ExecutionID             uuid.UUID
	RequesterID             uuid.UUID
	DriverID                uuid.UUID
	CityID                  string
	Service                 string
	VehicleClass            string
	Currency                string
	PaymentMethodID         string
	ReservationID           string
	ConfigVersion           int
	PolicyVersion           int
	RouteRevision           int
	FareRevision            int
	OriginalFareMinor       int64
	AgreedFareMinor         int64
	CapturedCommissionMinor int64
	FundedMinor             int64
	Pickup                  Area
	Dropoff                 Area
	Stops                   []RouteStop
	WaitingTerms            WaitingTerms
	WaitingCapMinor         int64
	CapRevision             int
	WaitingCommittedMinor   int64
	TerminatedAt            *time.Time
	// RoutedDistanceM is the committed route's routed distance: the award's
	// route when the terms were first written, replaced by the proposed
	// route's measured distance whenever a committed amendment changes the
	// route. Nil on a row written before the column existed (the request's
	// routed distance is then the best record there is).
	RoutedDistanceM *int64
	Version         int
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// securedFunding reports whether the rider's funding is a payment-service
// reservation (wallet) rather than unsecured cash.
func (r *ExecutionRoute) securedFunding() bool {
	return r.PaymentMethodID != "cash"
}

const executionRouteColumns = `
	award_id, request_id, execution_id, requester_id, driver_id,
	city_id, service, vehicle_class, currency, payment_method_id, reservation_id,
	config_version, policy_version, route_revision, fare_revision,
	original_fare_minor, agreed_fare_minor, captured_commission_minor, funded_minor,
	pickup, dropoff, stops, waiting_terms, waiting_cap_minor, cap_revision,
	waiting_committed_minor, terminated_at, routed_distance_m, version, created_at, updated_at`

func scanExecutionRoute(row pgx.Row) (*ExecutionRoute, error) {
	var route ExecutionRoute
	var pickup, dropoff, stops, terms []byte
	err := row.Scan(
		&route.AwardID, &route.RequestID, &route.ExecutionID, &route.RequesterID, &route.DriverID,
		&route.CityID, &route.Service, &route.VehicleClass, &route.Currency, &route.PaymentMethodID, &route.ReservationID,
		&route.ConfigVersion, &route.PolicyVersion, &route.RouteRevision, &route.FareRevision,
		&route.OriginalFareMinor, &route.AgreedFareMinor, &route.CapturedCommissionMinor, &route.FundedMinor,
		&pickup, &dropoff, &stops, &terms, &route.WaitingCapMinor, &route.CapRevision,
		&route.WaitingCommittedMinor, &route.TerminatedAt, &route.RoutedDistanceM, &route.Version, &route.CreatedAt, &route.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read the execution route: %w", err)
	}
	if err := json.Unmarshal(pickup, &route.Pickup); err != nil {
		return nil, fmt.Errorf("execution route %s stores an unreadable pickup: %w", route.AwardID, err)
	}
	if err := json.Unmarshal(dropoff, &route.Dropoff); err != nil {
		return nil, fmt.Errorf("execution route %s stores an unreadable dropoff: %w", route.AwardID, err)
	}
	if route.Stops, err = decodeStops(stops); err != nil {
		return nil, fmt.Errorf("execution route %s stores unreadable stops: %w", route.AwardID, err)
	}
	if err := json.Unmarshal(terms, &route.WaitingTerms); err != nil {
		return nil, fmt.Errorf("execution route %s stores unreadable waiting terms: %w", route.AwardID, err)
	}
	return &route, nil
}

// InsertExecutionRoute writes an execution's first committed terms and its
// stops, once: a concurrent first use collides on the award id and adopts
// the row the other writer created.
func (s *Store) InsertExecutionRoute(ctx context.Context, tx pgx.Tx, route *ExecutionRoute, stops []*ExecutionStop) (bool, error) {
	pickup, err := json.Marshal(route.Pickup)
	if err != nil {
		return false, fmt.Errorf("unserialisable pickup: %w", err)
	}
	dropoff, err := json.Marshal(route.Dropoff)
	if err != nil {
		return false, fmt.Errorf("unserialisable dropoff: %w", err)
	}
	encodedStops, err := encodeStops(route.Stops)
	if err != nil {
		return false, err
	}
	terms, err := json.Marshal(route.WaitingTerms)
	if err != nil {
		return false, fmt.Errorf("unserialisable waiting terms: %w", err)
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO mp.execution_routes (
			award_id, request_id, execution_id, requester_id, driver_id,
			city_id, service, vehicle_class, currency, payment_method_id, reservation_id,
			config_version, policy_version, route_revision, fare_revision,
			original_fare_minor, agreed_fare_minor, captured_commission_minor, funded_minor,
			pickup, dropoff, stops, waiting_terms, waiting_cap_minor, routed_distance_m
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,1,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
		ON CONFLICT (award_id) DO NOTHING`,
		route.AwardID, route.RequestID, route.ExecutionID, route.RequesterID, route.DriverID,
		route.CityID, route.Service, route.VehicleClass, route.Currency, route.PaymentMethodID, route.ReservationID,
		route.ConfigVersion, route.PolicyVersion,
		route.OriginalFareMinor, route.AgreedFareMinor, route.CapturedCommissionMinor, route.FundedMinor,
		pickup, dropoff, encodedStops, terms, route.WaitingCapMinor, route.RoutedDistanceM,
	)
	if err != nil {
		return false, fmt.Errorf("failed to insert the execution route: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	for _, stop := range stops {
		if err := s.UpsertExecutionStop(ctx, tx, stop); err != nil {
			return false, err
		}
	}
	return true, nil
}

// ExecutionRouteByAward reads one execution's committed terms.
func (s *Store) ExecutionRouteByAward(ctx context.Context, db DB, awardID uuid.UUID) (*ExecutionRoute, error) {
	return scanExecutionRoute(db.QueryRow(ctx,
		`SELECT `+executionRouteColumns+` FROM mp.execution_routes WHERE award_id = $1`, awardID))
}

// ExecutionRouteByExecution reads the committed terms of an execution ride.
func (s *Store) ExecutionRouteByExecution(ctx context.Context, db DB, executionID uuid.UUID) (*ExecutionRoute, error) {
	return scanExecutionRoute(db.QueryRow(ctx,
		`SELECT `+executionRouteColumns+` FROM mp.execution_routes WHERE execution_id = $1`, executionID))
}

// ExecutionRouteForUpdate reads and locks one execution's committed terms.
func (s *Store) ExecutionRouteForUpdate(ctx context.Context, tx pgx.Tx, awardID uuid.UUID) (*ExecutionRoute, error) {
	return scanExecutionRoute(tx.QueryRow(ctx,
		`SELECT `+executionRouteColumns+` FROM mp.execution_routes WHERE award_id = $1 FOR UPDATE`, awardID))
}

// SaveExecutionRoute writes the committed terms back under the optimistic
// version the caller read, bumping it. A lost race is a version conflict.
func (s *Store) SaveExecutionRoute(ctx context.Context, tx pgx.Tx, route *ExecutionRoute) (*ExecutionRoute, error) {
	dropoff, err := json.Marshal(route.Dropoff)
	if err != nil {
		return nil, fmt.Errorf("unserialisable dropoff: %w", err)
	}
	encodedStops, err := encodeStops(route.Stops)
	if err != nil {
		return nil, err
	}
	saved, err := scanExecutionRoute(tx.QueryRow(ctx, `
		UPDATE mp.execution_routes SET
			route_revision = $3,
			fare_revision = $4,
			agreed_fare_minor = $5,
			captured_commission_minor = $6,
			funded_minor = $7,
			dropoff = $8,
			stops = $9,
			waiting_cap_minor = $10,
			cap_revision = $11,
			waiting_committed_minor = $12,
			terminated_at = $13,
			routed_distance_m = $14,
			version = version + 1,
			updated_at = now()
		WHERE award_id = $1 AND version = $2
		RETURNING `+executionRouteColumns,
		route.AwardID, route.Version, route.RouteRevision, route.FareRevision,
		route.AgreedFareMinor, route.CapturedCommissionMinor, route.FundedMinor,
		dropoff, encodedStops, route.WaitingCapMinor, route.CapRevision,
		route.WaitingCommittedMinor, route.TerminatedAt, route.RoutedDistanceM,
	))
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the trip's terms changed while this request was in flight").
			WithDetails(map[string]any{"awardId": route.AwardID.String()})
	}
	return saved, err
}

// ---------------------------------------------------------------------------
// Execution stops: each stop's server-authoritative state.
// ---------------------------------------------------------------------------

// Stop states on an execution.
const (
	StopStatePending  = "pending"
	StopStateArrived  = "arrived"
	StopStateDeparted = "departed"
	StopStateSkipped  = "skipped"
	StopStateRemoved  = "removed"
)

// Waiting settlement states of a stop's finalised waiting fee.
const (
	waitingSettlementNone      = "none"
	waitingSettlementPending   = "pending"
	waitingSettlementCommitted = "committed"
	waitingSettlementFailed    = "failed"
)

// ExecutionStop is one row of mp.execution_stops.
type ExecutionStop struct {
	AwardID            uuid.UUID
	StopID             uuid.UUID
	ExecutionID        uuid.UUID
	Order              int
	State              string
	Lat                float64
	Lng                float64
	Label              string
	Purpose            string
	DwellSec           int
	ArrivedAt          *time.Time
	ArrivalDistanceM   *int
	ArrivalAccuracyM   *float64
	ArrivalDisputed    bool
	WaitStartedAt      *time.Time
	DepartedAt         *time.Time
	SkippedAt          *time.Time
	SkipReason         string
	WaitingFeeMinor    int64
	WaitingSettlement  string
	WaitingAmendmentID *uuid.UUID
	Version            int
	UpdatedAt          time.Time
}

// visited reports whether the driver has reached (or passed) the stop: its
// place in the route is history an amendment may not rewrite.
func (st *ExecutionStop) visited() bool {
	return st.State == StopStateArrived || st.State == StopStateDeparted || st.State == StopStateSkipped
}

const executionStopColumns = `
	award_id, stop_id, execution_id, stop_order, state, lat, lng, label, purpose, dwell_sec,
	arrived_at, arrival_distance_m, arrival_accuracy_m, arrival_disputed, wait_started_at,
	departed_at, skipped_at, COALESCE(skip_reason, ''), waiting_fee_minor, waiting_settlement,
	waiting_amendment_id, version, updated_at`

func scanExecutionStop(row pgx.Row) (*ExecutionStop, error) {
	var stop ExecutionStop
	err := row.Scan(
		&stop.AwardID, &stop.StopID, &stop.ExecutionID, &stop.Order, &stop.State, &stop.Lat, &stop.Lng,
		&stop.Label, &stop.Purpose, &stop.DwellSec,
		&stop.ArrivedAt, &stop.ArrivalDistanceM, &stop.ArrivalAccuracyM, &stop.ArrivalDisputed, &stop.WaitStartedAt,
		&stop.DepartedAt, &stop.SkippedAt, &stop.SkipReason, &stop.WaitingFeeMinor, &stop.WaitingSettlement,
		&stop.WaitingAmendmentID, &stop.Version, &stop.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read the execution stop: %w", err)
	}
	return &stop, nil
}

func (s *Store) stopList(ctx context.Context, db DB, query string, args ...any) ([]*ExecutionStop, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list execution stops: %w", err)
	}
	defer rows.Close()
	var stops []*ExecutionStop
	for rows.Next() {
		stop, err := scanExecutionStop(rows)
		if err != nil {
			return nil, err
		}
		stops = append(stops, stop)
	}
	return stops, rows.Err()
}

// ExecutionStops lists an execution's stops (removed ones included) in route
// order.
func (s *Store) ExecutionStops(ctx context.Context, db DB, awardID uuid.UUID) ([]*ExecutionStop, error) {
	return s.stopList(ctx, db, `
		SELECT `+executionStopColumns+` FROM mp.execution_stops
		WHERE award_id = $1 ORDER BY stop_order ASC, created_at ASC`, awardID)
}

// ExecutionStopsForUpdate locks every stop of one execution, in route order.
func (s *Store) ExecutionStopsForUpdate(ctx context.Context, tx pgx.Tx, awardID uuid.UUID) ([]*ExecutionStop, error) {
	return s.stopList(ctx, tx, `
		SELECT `+executionStopColumns+` FROM mp.execution_stops
		WHERE award_id = $1 ORDER BY stop_order ASC, created_at ASC FOR UPDATE`, awardID)
}

// ArrivedStops lists stops currently being waited at, oldest first, for the
// waiting-milestone sweep.
func (s *Store) ArrivedStops(ctx context.Context, db DB, limit int) ([]*ExecutionStop, error) {
	return s.stopList(ctx, db, `
		SELECT `+executionStopColumns+` FROM mp.execution_stops
		WHERE state = $1 ORDER BY updated_at ASC LIMIT $2`, StopStateArrived, limit)
}

// StopsAwaitingWaitingSettlement lists finalised stops whose waiting fee is
// still owed to the amendment path.
func (s *Store) StopsAwaitingWaitingSettlement(ctx context.Context, db DB, limit int) ([]*ExecutionStop, error) {
	return s.stopList(ctx, db, `
		SELECT `+executionStopColumns+` FROM mp.execution_stops
		WHERE waiting_settlement = $1 ORDER BY updated_at ASC LIMIT $2`, waitingSettlementPending, limit)
}

// UpsertExecutionStop writes a stop's full state (insert, or overwrite of a
// row the caller holds locked).
func (s *Store) UpsertExecutionStop(ctx context.Context, tx pgx.Tx, stop *ExecutionStop) error {
	settlement := stop.WaitingSettlement
	if settlement == "" {
		settlement = waitingSettlementNone
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO mp.execution_stops (
			award_id, stop_id, execution_id, stop_order, state, lat, lng, label, purpose, dwell_sec,
			arrived_at, arrival_distance_m, arrival_accuracy_m, arrival_disputed, wait_started_at,
			departed_at, skipped_at, skip_reason, waiting_fee_minor, waiting_settlement, waiting_amendment_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NULLIF($18,''),$19,$20,$21)
		ON CONFLICT (award_id, stop_id) DO UPDATE SET
			stop_order = EXCLUDED.stop_order,
			state = EXCLUDED.state,
			lat = EXCLUDED.lat,
			lng = EXCLUDED.lng,
			label = EXCLUDED.label,
			purpose = EXCLUDED.purpose,
			dwell_sec = EXCLUDED.dwell_sec,
			arrived_at = EXCLUDED.arrived_at,
			arrival_distance_m = EXCLUDED.arrival_distance_m,
			arrival_accuracy_m = EXCLUDED.arrival_accuracy_m,
			arrival_disputed = EXCLUDED.arrival_disputed,
			wait_started_at = EXCLUDED.wait_started_at,
			departed_at = EXCLUDED.departed_at,
			skipped_at = EXCLUDED.skipped_at,
			skip_reason = EXCLUDED.skip_reason,
			waiting_fee_minor = EXCLUDED.waiting_fee_minor,
			waiting_settlement = EXCLUDED.waiting_settlement,
			waiting_amendment_id = EXCLUDED.waiting_amendment_id,
			version = mp.execution_stops.version + 1,
			updated_at = now()`,
		stop.AwardID, stop.StopID, stop.ExecutionID, stop.Order, stop.State, stop.Lat, stop.Lng,
		stop.Label, stop.Purpose, stop.DwellSec,
		stop.ArrivedAt, stop.ArrivalDistanceM, stop.ArrivalAccuracyM, stop.ArrivalDisputed, stop.WaitStartedAt,
		stop.DepartedAt, stop.SkippedAt, stop.SkipReason, stop.WaitingFeeMinor, settlement, stop.WaitingAmendmentID,
	)
	if err != nil {
		return fmt.Errorf("failed to write the execution stop: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Amendments: the mpAmendment aggregate and its append-only history.
// ---------------------------------------------------------------------------

// Amendment is one row of mp.amendments.
type Amendment struct {
	ID                     uuid.UUID
	AwardID                uuid.UUID
	RequestID              uuid.UUID
	ExecutionID            uuid.UUID
	CityID                 string
	Kind                   string
	State                  string
	ProposedBy             string
	ProposedByRole         string
	BaseRouteRevision      int
	BaseFareRevision       int
	RouteRevision          int
	FareRevision           int
	Stops                  []RouteStop
	Dropoff                Area
	Currency               string
	PriorFareMinor         int64
	RevisedFareMinor       int64
	PriorCommissionMinor   int64
	RevisedCommissionMinor int64
	PriorFundedMinor       int64
	RevisedFundedMinor     int64
	AddedDistanceM         int64
	AddedDurationSec       int64
	Pricing                map[string]any
	ReferenceStopID        *uuid.UUID
	RiderApprovedAt        *time.Time
	DriverApprovedAt       *time.Time
	ExpiresAt              time.Time
	Step                   string
	StepState              string
	Attempts               int
	LastError              string
	NextRetryAt            *time.Time
	FundingDone            bool
	CommissionDone         bool
	MoneyOpen              bool
	Reason                 string
	Version                int
	CreatedAt              time.Time
	UpdatedAt              time.Time
	ResolvedAt             *time.Time
}

// bothApproved reports whether both parties bound themselves to the terms.
func (a *Amendment) bothApproved() bool {
	return a.RiderApprovedAt != nil && a.DriverApprovedAt != nil
}

// commissionDelta is the signed change to the captured commission.
func (a *Amendment) commissionDelta() int64 {
	return a.RevisedCommissionMinor - a.PriorCommissionMinor
}

// fundingDelta is the signed change to the rider's funded amount.
func (a *Amendment) fundingDelta() int64 {
	return a.RevisedFundedMinor - a.PriorFundedMinor
}

// fareDelta is the signed change to the agreed fare.
func (a *Amendment) fareDelta() int64 {
	return a.RevisedFareMinor - a.PriorFareMinor
}

// changesRoute reports whether committing this amendment rewrites the
// execution's route (a waiting fee changes only the fare).
func (a *Amendment) changesRoute() bool {
	return a.Kind != AmendmentKindStopWaiting
}

const amendmentColumns = `
	id, award_id, request_id, execution_id, city_id, kind, state, proposed_by, proposed_by_role,
	base_route_revision, base_fare_revision, route_revision, fare_revision, stops, dropoff, currency,
	prior_fare_minor, revised_fare_minor, prior_commission_minor, revised_commission_minor,
	prior_funded_minor, revised_funded_minor, added_distance_m, added_duration_sec, pricing,
	reference_stop_id, rider_approved_at, driver_approved_at, expires_at,
	step, step_state, attempts, COALESCE(last_error, ''), next_retry_at,
	funding_done, commission_done, money_open, COALESCE(reason, ''), version,
	created_at, updated_at, resolved_at`

func scanAmendment(row pgx.Row) (*Amendment, error) {
	var amendment Amendment
	var stops, dropoff, pricing []byte
	err := row.Scan(
		&amendment.ID, &amendment.AwardID, &amendment.RequestID, &amendment.ExecutionID, &amendment.CityID,
		&amendment.Kind, &amendment.State, &amendment.ProposedBy, &amendment.ProposedByRole,
		&amendment.BaseRouteRevision, &amendment.BaseFareRevision, &amendment.RouteRevision, &amendment.FareRevision,
		&stops, &dropoff, &amendment.Currency,
		&amendment.PriorFareMinor, &amendment.RevisedFareMinor, &amendment.PriorCommissionMinor, &amendment.RevisedCommissionMinor,
		&amendment.PriorFundedMinor, &amendment.RevisedFundedMinor, &amendment.AddedDistanceM, &amendment.AddedDurationSec, &pricing,
		&amendment.ReferenceStopID, &amendment.RiderApprovedAt, &amendment.DriverApprovedAt, &amendment.ExpiresAt,
		&amendment.Step, &amendment.StepState, &amendment.Attempts, &amendment.LastError, &amendment.NextRetryAt,
		&amendment.FundingDone, &amendment.CommissionDone, &amendment.MoneyOpen, &amendment.Reason, &amendment.Version,
		&amendment.CreatedAt, &amendment.UpdatedAt, &amendment.ResolvedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read the amendment: %w", err)
	}
	if amendment.Stops, err = decodeStops(stops); err != nil {
		return nil, fmt.Errorf("amendment %s stores unreadable stops: %w", amendment.ID, err)
	}
	if err := json.Unmarshal(dropoff, &amendment.Dropoff); err != nil {
		return nil, fmt.Errorf("amendment %s stores an unreadable dropoff: %w", amendment.ID, err)
	}
	if len(pricing) > 0 {
		if err := json.Unmarshal(pricing, &amendment.Pricing); err != nil {
			return nil, fmt.Errorf("amendment %s stores unreadable pricing: %w", amendment.ID, err)
		}
	}
	return &amendment, nil
}

// errAmendmentOpen is amendments_one_open_per_award saying no: the award
// already carries an amendment with open money.
var errAmendmentOpen = errors.New("the award already carries an open amendment")

// InsertAmendment writes a new amendment.
func (s *Store) InsertAmendment(ctx context.Context, tx pgx.Tx, amendment *Amendment) error {
	stops, err := encodeStops(amendment.Stops)
	if err != nil {
		return err
	}
	dropoff, err := json.Marshal(amendment.Dropoff)
	if err != nil {
		return fmt.Errorf("unserialisable dropoff: %w", err)
	}
	pricing, err := json.Marshal(amendment.Pricing)
	if err != nil {
		return fmt.Errorf("unserialisable pricing: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO mp.amendments (
			id, award_id, request_id, execution_id, city_id, kind, state, proposed_by, proposed_by_role,
			base_route_revision, base_fare_revision, route_revision, fare_revision, stops, dropoff, currency,
			prior_fare_minor, revised_fare_minor, prior_commission_minor, revised_commission_minor,
			prior_funded_minor, revised_funded_minor, added_distance_m, added_duration_sec, pricing,
			reference_stop_id, rider_approved_at, driver_approved_at, expires_at,
			step, step_state, next_retry_at, money_open
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
			$26,$27,$28,$29,$30,$31,$32,true)`,
		amendment.ID, amendment.AwardID, amendment.RequestID, amendment.ExecutionID, amendment.CityID,
		amendment.Kind, amendment.State, amendment.ProposedBy, amendment.ProposedByRole,
		amendment.BaseRouteRevision, amendment.BaseFareRevision, amendment.RouteRevision, amendment.FareRevision,
		stops, dropoff, amendment.Currency,
		amendment.PriorFareMinor, amendment.RevisedFareMinor, amendment.PriorCommissionMinor, amendment.RevisedCommissionMinor,
		amendment.PriorFundedMinor, amendment.RevisedFundedMinor, amendment.AddedDistanceM, amendment.AddedDurationSec, pricing,
		amendment.ReferenceStopID, amendment.RiderApprovedAt, amendment.DriverApprovedAt, amendment.ExpiresAt,
		amendment.Step, amendment.StepState, amendment.NextRetryAt,
	)
	if err != nil {
		if isUniqueViolation(err, "amendments_one_open_per_award") {
			return errAmendmentOpen
		}
		if isUniqueViolation(err, "amendments_pkey") {
			return errAmendmentExists
		}
		return fmt.Errorf("failed to insert the amendment: %w", err)
	}
	amendment.MoneyOpen = true
	amendment.Version = 1
	return nil
}

// errAmendmentExists is a deterministic amendment id (a stop's waiting fee)
// that was already written.
var errAmendmentExists = errors.New("the amendment already exists")

// AmendmentByID reads one amendment.
func (s *Store) AmendmentByID(ctx context.Context, db DB, id uuid.UUID) (*Amendment, error) {
	return scanAmendment(db.QueryRow(ctx, `SELECT `+amendmentColumns+` FROM mp.amendments WHERE id = $1`, id))
}

// AmendmentForUpdate reads and locks one amendment.
func (s *Store) AmendmentForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Amendment, error) {
	return scanAmendment(tx.QueryRow(ctx, `SELECT `+amendmentColumns+` FROM mp.amendments WHERE id = $1 FOR UPDATE`, id))
}

func (s *Store) amendmentList(ctx context.Context, db DB, query string, args ...any) ([]*Amendment, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list amendments: %w", err)
	}
	defer rows.Close()
	var amendments []*Amendment
	for rows.Next() {
		amendment, err := scanAmendment(rows)
		if err != nil {
			return nil, err
		}
		amendments = append(amendments, amendment)
	}
	return amendments, rows.Err()
}

// AmendmentsForAward lists an award's amendments, oldest first.
func (s *Store) AmendmentsForAward(ctx context.Context, db DB, awardID uuid.UUID) ([]*Amendment, error) {
	return s.amendmentList(ctx, db, `
		SELECT `+amendmentColumns+` FROM mp.amendments
		WHERE award_id = $1 ORDER BY created_at ASC, id ASC`, awardID)
}

// OpenAmendmentForAward reads the award's amendment with open money, or
// domain.ErrNotFound.
func (s *Store) OpenAmendmentForAward(ctx context.Context, db DB, awardID uuid.UUID) (*Amendment, error) {
	return scanAmendment(db.QueryRow(ctx, `
		SELECT `+amendmentColumns+` FROM mp.amendments
		WHERE award_id = $1 AND money_open`, awardID))
}

// DueAmendments lists amendments whose money is still open and whose saga
// is due (or whose approval window has lapsed), for the sweep.
func (s *Store) DueAmendments(ctx context.Context, db DB, now time.Time, limit int) ([]*Amendment, error) {
	return s.amendmentList(ctx, db, `
		SELECT `+amendmentColumns+` FROM mp.amendments
		WHERE money_open AND (
			(next_retry_at IS NOT NULL AND next_retry_at <= $1)
			OR (state IN ($2, $3) AND expires_at <= $1))
		ORDER BY created_at ASC
		LIMIT $4`, now, machine.MpAmendmentProposed, machine.MpAmendmentAwaiting, limit)
}

// SaveAmendment writes an amendment back under the version the caller read,
// refusing any state move the mpAmendment machine does not allow.
func (s *Store) SaveAmendment(ctx context.Context, tx pgx.Tx, current *Amendment, next *Amendment) (*Amendment, error) {
	if current.State != next.State {
		if err := machine.Assert(machine.MpAmendment, current.State, next.State); err != nil {
			allowed, _ := machine.Allowed(machine.MpAmendment, current.State)
			return nil, domain.Errorf(domain.CodeIllegalTransition,
				"an amendment cannot move from %s to %s", current.State, next.State).
				WithDetails(map[string]any{"from": current.State, "to": next.State, "allowed": allowed}).
				Wrap(err)
		}
	}
	saved, err := scanAmendment(tx.QueryRow(ctx, `
		UPDATE mp.amendments SET
			state = $3,
			rider_approved_at = $4,
			driver_approved_at = $5,
			step = $6,
			step_state = $7,
			attempts = $8,
			last_error = NULLIF($9, ''),
			next_retry_at = $10,
			funding_done = $11,
			commission_done = $12,
			money_open = $13,
			reason = NULLIF($14, ''),
			resolved_at = $15,
			version = version + 1,
			updated_at = now()
		WHERE id = $1 AND version = $2
		RETURNING `+amendmentColumns,
		current.ID, current.Version, next.State, next.RiderApprovedAt, next.DriverApprovedAt,
		next.Step, next.StepState, next.Attempts, next.LastError, next.NextRetryAt,
		next.FundingDone, next.CommissionDone, next.MoneyOpen, next.Reason, next.ResolvedAt,
	))
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the amendment changed while this request was in flight").
			WithDetails(map[string]any{"amendmentId": current.ID.String()})
	}
	return saved, err
}

// AmendmentHistoryRow is one append-only history row.
type AmendmentHistoryRow struct {
	AmendmentID   uuid.UUID
	AwardID       uuid.UUID
	Event         string
	FromState     string
	ToState       string
	ActorRole     string
	ActorID       string
	RouteRevision int
	FareRevision  int
	Detail        map[string]any
	CreatedAt     time.Time
}

// InsertAmendmentHistory appends one history row (the table refuses edits).
func (s *Store) InsertAmendmentHistory(ctx context.Context, tx pgx.Tx, row AmendmentHistoryRow) error {
	detail := row.Detail
	if detail == nil {
		detail = map[string]any{}
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("unserialisable amendment history detail: %w", err)
	}
	var from *string
	if row.FromState != "" {
		from = &row.FromState
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO mp.amendment_history (
			amendment_id, award_id, event, from_state, to_state, actor_role, actor_id,
			route_revision, fare_revision, detail
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		row.AmendmentID, row.AwardID, row.Event, from, row.ToState, row.ActorRole, row.ActorID,
		row.RouteRevision, row.FareRevision, encoded)
	if err != nil {
		return fmt.Errorf("failed to append amendment history: %w", err)
	}
	return nil
}

// AmendmentHistory lists one amendment's history, oldest first.
func (s *Store) AmendmentHistory(ctx context.Context, db DB, amendmentID uuid.UUID) ([]AmendmentHistoryRow, error) {
	rows, err := db.Query(ctx, `
		SELECT amendment_id, award_id, event, COALESCE(from_state, ''), to_state, actor_role, actor_id,
			route_revision, fare_revision, detail, created_at
		FROM mp.amendment_history WHERE amendment_id = $1 ORDER BY id ASC`, amendmentID)
	if err != nil {
		return nil, fmt.Errorf("failed to read amendment history: %w", err)
	}
	defer rows.Close()
	var history []AmendmentHistoryRow
	for rows.Next() {
		var row AmendmentHistoryRow
		var detail []byte
		if err := rows.Scan(&row.AmendmentID, &row.AwardID, &row.Event, &row.FromState, &row.ToState,
			&row.ActorRole, &row.ActorID, &row.RouteRevision, &row.FareRevision, &detail, &row.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to read amendment history: %w", err)
		}
		if len(detail) > 0 {
			if err := json.Unmarshal(detail, &row.Detail); err != nil {
				return nil, fmt.Errorf("amendment history stores an unreadable detail: %w", err)
			}
		}
		history = append(history, row)
	}
	return history, rows.Err()
}
