// Package marketplace implements the negotiated-fare marketplace engine core
// (slices M02, M03, M03A): bounded quotes, published requests, funded private
// bids, driver eligibility, presets, rate profiles and the durable sweeps.
//
// The package owns the `mp` schema (see schema.sql) and every transition in
// it. A transition is only ever written together with its outbox event and,
// for money-adjacent actions, its audit row, in one transaction, after the
// contract machine has allowed it. The award saga and driver claims logic
// build on these tables in a following slice.
package marketplace

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

//go:embed schema.sql
var schemaSQL string

// DB is the subset of pgx that a pool and a transaction both satisfy.
type DB interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Store is the marketplace engine's data access for the `mp` schema. The
// embedded move store is how the award saga writes execution rides through the
// SAME exported functions the classic path uses — one machine, one SQL shape.
type Store struct {
	pool *pgxpool.Pool
	mv   *move.Store
}

// NewStore builds the store.
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool, mv: move.NewStore(pool)}
}

// Move exposes the embedded move store for execution-ride writes.
func (s *Store) Move() *move.Store { return s.mv }

// Pool exposes the underlying pool to readers that do not mutate state.
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// migrationLockKey matches the ride schema's lock: schema application is
// serialised across processes so concurrent CREATE/ALTER statements take
// turns instead of deadlocking.
const migrationLockKey = int64(0x72696465) // "ride"

// schemaCurrent reports whether the newest object this script creates already
// exists; when it does the whole script is skipped so no DDL lock is taken
// against a live workload.
func (s *Store) schemaCurrent(ctx context.Context) bool {
	var current bool
	err := s.pool.QueryRow(ctx,
		`SELECT to_regclass('mp.reservation_recovery') IS NOT NULL
			AND to_regclass('mp.idempotency_keys') IS NOT NULL
			AND to_regclass('mp.execution_pins') IS NOT NULL
			AND to_regclass('mp.driver_standing_actions') IS NOT NULL
			AND EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = 'mp' AND table_name = 'reservation_recovery' AND column_name = 'payload')
			AND EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = 'mp' AND table_name = 'bids' AND column_name = 'hold_released_at')
			AND EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = 'mp' AND table_name = 'award_attempts' AND column_name = 'captured')
			AND EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = 'mp' AND table_name = 'quotes' AND column_name = 'route_fingerprint')
			AND EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = 'mp' AND table_name = 'requests' AND column_name = 'stops_dwell_sec')
			AND to_regclass('mp.driver_preferences') IS NOT NULL`).Scan(&current)
	return err == nil && current
}

// Migrate applies the mp schema. Every statement is IF NOT EXISTS, so it is
// idempotent; it runs from tests and from an explicit boot flag. Application
// is serialised across processes and retried when a concurrent workload makes
// it the deadlock victim — the script is safe to re-run.
func (s *Store) Migrate(ctx context.Context) error {
	if s.schemaCurrent(ctx) {
		return nil
	}
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("failed to acquire a connection for migration: %w", err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, migrationLockKey); err != nil {
		return fmt.Errorf("failed to take the migration lock: %w", err)
	}
	defer func() {
		_, _ = conn.Exec(ctx, `SELECT pg_advisory_unlock($1)`, migrationLockKey)
	}()
	if s.schemaCurrent(ctx) {
		return nil
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if _, lastErr = conn.Exec(ctx, schemaSQL); lastErr == nil {
			return nil
		}
		var pgErr *pgconn.PgError
		if !errors.As(lastErr, &pgErr) || pgErr.Code != "40P01" {
			break
		}
	}
	return fmt.Errorf("failed to apply the mp schema: %w", lastErr)
}

// InTx runs fn in a transaction, rolling back on any error or panic.
func (s *Store) InTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}
	return nil
}

// isUniqueViolation reports whether an error is the named unique index saying
// no. The partial unique indexes are the final authority on "one live X".
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505" && (constraint == "" || pgErr.ConstraintName == constraint)
	}
	return false
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

// BreakdownRow is one labelled component of a suggested fare.
type BreakdownRow struct {
	Label       string `json:"label"`
	AmountMinor int64  `json:"amountMinor"`
}

// Quote is a stored bounded-fare envelope. The published amount is validated
// against THIS row, never against numbers a client restates.
type Quote struct {
	ID                uuid.UUID
	RequesterID       uuid.UUID
	CityID            string
	Service           string
	VehicleClass      string
	Currency          string
	SuggestedMinor    int64
	MinMinor          int64
	MaxMinor          int64
	RoutedDistanceM   int64
	RoutedDurationSec int64
	Pickup            Area
	Dropoff           Area
	// Stops are the ordered intermediate stops this envelope priced (empty
	// for a plain pickup → dropoff route); StopsDwellSec is their total
	// expected dwell, priced as route time; RouteFingerprint names the exact
	// route (endpoints + ordered stop set) the bounds belong to.
	Stops            []RouteStop
	StopsDwellSec    int64
	RouteFingerprint string
	Breakdown        []BreakdownRow
	PricingVersion   string
	PolicyVersion    int
	ExpiresAt        time.Time
	ConsumedBy       *uuid.UUID
	CreatedAt        time.Time
}

// InsertQuote persists a priced envelope.
func (s *Store) InsertQuote(ctx context.Context, db DB, quote *Quote) error {
	breakdown, err := json.Marshal(quote.Breakdown)
	if err != nil {
		return fmt.Errorf("unserialisable quote breakdown: %w", err)
	}
	pickup, err := json.Marshal(quote.Pickup)
	if err != nil {
		return fmt.Errorf("unserialisable quote pickup: %w", err)
	}
	dropoff, err := json.Marshal(quote.Dropoff)
	if err != nil {
		return fmt.Errorf("unserialisable quote dropoff: %w", err)
	}
	stops, err := encodeStops(quote.Stops)
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, `
		INSERT INTO mp.quotes (
			id, requester_id, city_id, service, vehicle_class, currency,
			suggested_minor, min_minor, max_minor,
			routed_distance_m, routed_duration_sec, pickup, dropoff, breakdown,
			pricing_version, policy_version, expires_at,
			stops, stops_dwell_sec, route_fingerprint
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
		quote.ID, quote.RequesterID, quote.CityID, quote.Service, quote.VehicleClass, quote.Currency,
		quote.SuggestedMinor, quote.MinMinor, quote.MaxMinor,
		quote.RoutedDistanceM, quote.RoutedDurationSec, pickup, dropoff, breakdown,
		quote.PricingVersion, quote.PolicyVersion, quote.ExpiresAt,
		stops, quote.StopsDwellSec, quote.RouteFingerprint,
	)
	if err != nil {
		return fmt.Errorf("failed to insert marketplace quote: %w", err)
	}
	return nil
}

const quoteColumns = `
	id, requester_id, city_id, service, vehicle_class, currency,
	suggested_minor, min_minor, max_minor,
	routed_distance_m, routed_duration_sec, pickup, dropoff, breakdown,
	pricing_version, policy_version, expires_at, consumed_by, created_at,
	stops, stops_dwell_sec, route_fingerprint`

func scanQuote(row pgx.Row) (*Quote, error) {
	var quote Quote
	var pickup, dropoff, breakdown, stops []byte
	err := row.Scan(
		&quote.ID, &quote.RequesterID, &quote.CityID, &quote.Service, &quote.VehicleClass, &quote.Currency,
		&quote.SuggestedMinor, &quote.MinMinor, &quote.MaxMinor,
		&quote.RoutedDistanceM, &quote.RoutedDurationSec, &pickup, &dropoff, &breakdown,
		&quote.PricingVersion, &quote.PolicyVersion, &quote.ExpiresAt, &quote.ConsumedBy, &quote.CreatedAt,
		&stops, &quote.StopsDwellSec, &quote.RouteFingerprint,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read marketplace quote: %w", err)
	}
	if err := json.Unmarshal(pickup, &quote.Pickup); err != nil {
		return nil, fmt.Errorf("quote %s stores an unreadable pickup: %w", quote.ID, err)
	}
	if err := json.Unmarshal(dropoff, &quote.Dropoff); err != nil {
		return nil, fmt.Errorf("quote %s stores an unreadable dropoff: %w", quote.ID, err)
	}
	if len(breakdown) > 0 {
		if err := json.Unmarshal(breakdown, &quote.Breakdown); err != nil {
			return nil, fmt.Errorf("quote %s stores an unreadable breakdown: %w", quote.ID, err)
		}
	}
	if quote.Stops, err = decodeStops(stops); err != nil {
		return nil, fmt.Errorf("quote %s stores unreadable stops: %w", quote.ID, err)
	}
	return &quote, nil
}

// QuoteByID reads one quote.
func (s *Store) QuoteByID(ctx context.Context, db DB, id uuid.UUID) (*Quote, error) {
	return scanQuote(db.QueryRow(ctx, `SELECT `+quoteColumns+` FROM mp.quotes WHERE id = $1`, id))
}

// ConsumeQuote marks a quote as spent by a request, exactly once.
func (s *Store) ConsumeQuote(ctx context.Context, db DB, quoteID, requestID uuid.UUID) error {
	tag, err := db.Exec(ctx,
		`UPDATE mp.quotes SET consumed_by = $2 WHERE id = $1 AND consumed_by IS NULL`,
		quoteID, requestID)
	if err != nil {
		return fmt.Errorf("failed to consume marketplace quote: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.Errorf(domain.CodeConflict, "this quote has already been used for another request")
	}
	return nil
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

// Area is the privacy-safe area reference a request carries: a label and a
// coarse centroid, never a house number.
type Area struct {
	Label string  `json:"label"`
	Lat   float64 `json:"lat"`
	Lng   float64 `json:"lng"`
}

// Request is one marketplace request row.
type Request struct {
	ID             uuid.UUID
	QuoteID        uuid.UUID
	RequesterID    uuid.UUID
	CityID         string
	Service        string
	VehicleClass   string
	Currency       string
	State          string
	Revision       int
	Version        int
	RequestedMinor int64
	SuggestedMinor int64
	MinMinor       int64
	MaxMinor       int64
	Pickup         Area
	Dropoff        Area
	// Stops is the request's ordered intermediate-stop route (empty for a
	// plain pickup → dropoff trip), copied from the quote it was published
	// or route-revised against. RouteRevision bumps only when a revision
	// changes the stop set; Revision (which bids pin) bumps on every edit.
	Stops             []RouteStop
	RouteRevision     int
	RouteFingerprint  string
	RoutedDistanceM   int64
	RoutedDurationSec int64
	StopsDwellSec     int64
	Delivery          map[string]any
	PaymentMethodID   string
	EnvelopeStep      int
	EnvelopeRadiusM   int
	EnvelopeEtaSec    int
	PolicyVersion     int
	PricingVersion    string
	ExpiresAt         time.Time
	CloseReason       string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

const requestColumns = `
	id, quote_id, requester_id, city_id, service, vehicle_class, currency,
	state, revision, version,
	requested_minor, suggested_minor, min_minor, max_minor,
	pickup, dropoff, delivery, payment_method_id,
	envelope_step, envelope_radius_m, envelope_eta_sec,
	policy_version, pricing_version, expires_at,
	COALESCE(close_reason, ''), created_at, updated_at,
	stops, route_revision, route_fingerprint,
	routed_distance_m, routed_duration_sec, stops_dwell_sec`

func scanRequest(row pgx.Row) (*Request, error) {
	var request Request
	var pickup, dropoff, delivery, stops []byte
	err := row.Scan(
		&request.ID, &request.QuoteID, &request.RequesterID, &request.CityID,
		&request.Service, &request.VehicleClass, &request.Currency,
		&request.State, &request.Revision, &request.Version,
		&request.RequestedMinor, &request.SuggestedMinor, &request.MinMinor, &request.MaxMinor,
		&pickup, &dropoff, &delivery, &request.PaymentMethodID,
		&request.EnvelopeStep, &request.EnvelopeRadiusM, &request.EnvelopeEtaSec,
		&request.PolicyVersion, &request.PricingVersion, &request.ExpiresAt,
		&request.CloseReason, &request.CreatedAt, &request.UpdatedAt,
		&stops, &request.RouteRevision, &request.RouteFingerprint,
		&request.RoutedDistanceM, &request.RoutedDurationSec, &request.StopsDwellSec,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read marketplace request: %w", err)
	}
	if err := json.Unmarshal(pickup, &request.Pickup); err != nil {
		return nil, fmt.Errorf("request %s stores an unreadable pickup: %w", request.ID, err)
	}
	if err := json.Unmarshal(dropoff, &request.Dropoff); err != nil {
		return nil, fmt.Errorf("request %s stores an unreadable dropoff: %w", request.ID, err)
	}
	if len(delivery) > 0 {
		if err := json.Unmarshal(delivery, &request.Delivery); err != nil {
			return nil, fmt.Errorf("request %s stores unreadable delivery details: %w", request.ID, err)
		}
	}
	if request.Stops, err = decodeStops(stops); err != nil {
		return nil, fmt.Errorf("request %s stores unreadable stops: %w", request.ID, err)
	}
	return &request, nil
}

// InsertRequest writes a new open request together with its first revision row.
func (s *Store) InsertRequest(ctx context.Context, db DB, request *Request) error {
	pickup, err := json.Marshal(request.Pickup)
	if err != nil {
		return fmt.Errorf("unserialisable pickup: %w", err)
	}
	dropoff, err := json.Marshal(request.Dropoff)
	if err != nil {
		return fmt.Errorf("unserialisable dropoff: %w", err)
	}
	var delivery []byte
	if request.Delivery != nil {
		if delivery, err = json.Marshal(request.Delivery); err != nil {
			return fmt.Errorf("unserialisable delivery details: %w", err)
		}
	}
	stops, err := encodeStops(request.Stops)
	if err != nil {
		return err
	}
	routeRevision := request.RouteRevision
	if routeRevision < 1 {
		routeRevision = 1
	}
	_, err = db.Exec(ctx, `
		INSERT INTO mp.requests (
			id, quote_id, requester_id, city_id, service, vehicle_class, currency,
			state, revision, version,
			requested_minor, suggested_minor, min_minor, max_minor,
			pickup, dropoff, delivery, payment_method_id,
			envelope_step, envelope_radius_m, envelope_eta_sec,
			policy_version, pricing_version, expires_at,
			stops, route_revision, route_fingerprint,
			routed_distance_m, routed_duration_sec, stops_dwell_sec
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
			$25,$26,$27,$28,$29,$30)`,
		request.ID, request.QuoteID, request.RequesterID, request.CityID,
		request.Service, request.VehicleClass, request.Currency,
		request.State, request.Revision, request.Version,
		request.RequestedMinor, request.SuggestedMinor, request.MinMinor, request.MaxMinor,
		pickup, dropoff, delivery, request.PaymentMethodID,
		request.EnvelopeStep, request.EnvelopeRadiusM, request.EnvelopeEtaSec,
		request.PolicyVersion, request.PricingVersion, request.ExpiresAt,
		stops, routeRevision, request.RouteFingerprint,
		request.RoutedDistanceM, request.RoutedDurationSec, request.StopsDwellSec,
	)
	if err != nil {
		return fmt.Errorf("failed to insert marketplace request: %w", err)
	}
	return nil
}

// InsertRequestRevision snapshots one revision.
func (s *Store) InsertRequestRevision(ctx context.Context, db DB, requestID uuid.UUID, revision int, requestedMinor int64, quoteID uuid.UUID, snapshot map[string]any) error {
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("unserialisable revision snapshot: %w", err)
	}
	_, err = db.Exec(ctx, `
		INSERT INTO mp.request_revisions (request_id, revision, requested_minor, quote_id, snapshot)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (request_id, revision) DO NOTHING`,
		requestID, revision, requestedMinor, quoteID, encoded)
	if err != nil {
		return fmt.Errorf("failed to insert request revision: %w", err)
	}
	return nil
}

// RequestByID reads one request.
func (s *Store) RequestByID(ctx context.Context, db DB, id uuid.UUID) (*Request, error) {
	return scanRequest(db.QueryRow(ctx, `SELECT `+requestColumns+` FROM mp.requests WHERE id = $1`, id))
}

// RequestForUpdate reads and locks one request for the rest of the transaction.
func (s *Store) RequestForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Request, error) {
	return scanRequest(tx.QueryRow(ctx, `SELECT `+requestColumns+` FROM mp.requests WHERE id = $1 FOR UPDATE`, id))
}

// OpenRequestCount counts a requester's requests still occupying the market.
func (s *Store) OpenRequestCount(ctx context.Context, db DB, requesterID uuid.UUID) (int, error) {
	var count int
	err := db.QueryRow(ctx, `
		SELECT COUNT(*) FROM mp.requests
		WHERE requester_id = $1 AND state = ANY($2)`,
		requesterID, []string{machine.MpRequestOpen, machine.MpRequestAwardPending}).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count open requests: %w", err)
	}
	return count, nil
}

// RequestUpdate carries the columns a request transition may change.
type RequestUpdate struct {
	Revision        *int
	RequestedMinor  *int64
	MinMinor        *int64
	MaxMinor        *int64
	QuoteID         *uuid.UUID
	EnvelopeStep    *int
	EnvelopeRadiusM *int
	EnvelopeEtaSec  *int
	ExpiresAt       *time.Time
	CloseReason     *string
	// Route columns, set together by a route-changing revision (Stops,
	// RouteRevision, RouteFingerprint, StopsDwellSec) and by any revision
	// that adopts a fresh quote (the routed metrics).
	Stops             *[]RouteStop
	RouteRevision     *int
	RouteFingerprint  *string
	RoutedDistanceM   *int64
	RoutedDurationSec *int64
	StopsDwellSec     *int64
}

// TransitionRequest moves a request to a new state (open → open is the
// contract's revision/expansion edge). It refuses anything the mpRequest
// machine does not allow, under the optimistic version guard.
func (s *Store) TransitionRequest(ctx context.Context, tx pgx.Tx, request *Request, to string, update RequestUpdate) (*Request, error) {
	if err := machine.Assert(machine.MpRequest, request.State, to); err != nil {
		allowed, _ := machine.Allowed(machine.MpRequest, request.State)
		return nil, domain.Errorf(domain.CodeIllegalTransition, "a request cannot move from %s to %s", request.State, to).
			WithDetails(map[string]any{"from": request.State, "to": to, "allowed": allowed}).
			Wrap(err)
	}
	var stops []byte
	if update.Stops != nil {
		encoded, err := encodeStops(*update.Stops)
		if err != nil {
			return nil, err
		}
		stops = encoded
	}
	row := tx.QueryRow(ctx, `
		UPDATE mp.requests SET
			state = $3,
			version = version + 1,
			revision = COALESCE($4, revision),
			requested_minor = COALESCE($5, requested_minor),
			min_minor = COALESCE($6, min_minor),
			max_minor = COALESCE($7, max_minor),
			quote_id = COALESCE($8, quote_id),
			envelope_step = COALESCE($9, envelope_step),
			envelope_radius_m = COALESCE($10, envelope_radius_m),
			envelope_eta_sec = COALESCE($11, envelope_eta_sec),
			expires_at = COALESCE($12, expires_at),
			close_reason = COALESCE($13, close_reason),
			stops = COALESCE($14::jsonb, stops),
			route_revision = COALESCE($15, route_revision),
			route_fingerprint = COALESCE($16, route_fingerprint),
			routed_distance_m = COALESCE($17, routed_distance_m),
			routed_duration_sec = COALESCE($18, routed_duration_sec),
			stops_dwell_sec = COALESCE($19, stops_dwell_sec),
			updated_at = now()
		WHERE id = $1 AND version = $2
		RETURNING `+requestColumns,
		request.ID, request.Version, to,
		update.Revision, update.RequestedMinor, update.MinMinor, update.MaxMinor,
		update.QuoteID, update.EnvelopeStep, update.EnvelopeRadiusM, update.EnvelopeEtaSec,
		update.ExpiresAt, update.CloseReason,
		stops, update.RouteRevision, update.RouteFingerprint,
		update.RoutedDistanceM, update.RoutedDurationSec, update.StopsDwellSec,
	)
	updated, err := scanRequest(row)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the request changed while this call was in flight").
			WithDetails(map[string]any{"requestId": request.ID.String(), "expectedVersion": request.Version})
	}
	return updated, err
}

// SetRequestCloseReason records why a request ended WITHOUT a state change:
// a request already in the terminal `execution` state has no edge left in the
// mpRequest machine, but when its execution is driver-cancelled the requester
// is still owed an honest closeReason. Only the first reason sticks.
func (s *Store) SetRequestCloseReason(ctx context.Context, db DB, requestID uuid.UUID, reason string) error {
	_, err := db.Exec(ctx, `
		UPDATE mp.requests SET close_reason = $2, updated_at = now()
		WHERE id = $1 AND close_reason IS NULL`, requestID, reason)
	if err != nil {
		return fmt.Errorf("failed to record the request close reason: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Bids
// ---------------------------------------------------------------------------

// Bid is one marketplace bid row.
type Bid struct {
	ID                 uuid.UUID
	RequestID          uuid.UUID
	RequestRevision    int
	DriverID           uuid.UUID
	State              string
	BidVersion         int
	AmountMinor        int64
	CommissionMinor    int64
	NetMinor           int64
	Slot               string
	DependsOnClaimID   *uuid.UUID
	AvailabilityEpoch  int64
	ReservationID      string
	RateProfileVersion *int
	// HoldReleasedAt is set only once the wallet CONFIRMED the hold's
	// release. Until then a terminal bid's hold renders release_pending.
	HoldReleasedAt *time.Time
	ExpiresAt      time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

const bidColumns = `
	id, request_id, request_revision, driver_id, state, bid_version,
	amount_minor, commission_minor, net_minor, slot, depends_on_claim_id,
	availability_epoch, reservation_id, rate_profile_version, hold_released_at,
	expires_at, created_at, updated_at`

func scanBid(row pgx.Row) (*Bid, error) {
	var bid Bid
	err := row.Scan(
		&bid.ID, &bid.RequestID, &bid.RequestRevision, &bid.DriverID, &bid.State, &bid.BidVersion,
		&bid.AmountMinor, &bid.CommissionMinor, &bid.NetMinor, &bid.Slot, &bid.DependsOnClaimID,
		&bid.AvailabilityEpoch, &bid.ReservationID, &bid.RateProfileVersion, &bid.HoldReleasedAt,
		&bid.ExpiresAt, &bid.CreatedAt, &bid.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read marketplace bid: %w", err)
	}
	return &bid, nil
}

// InsertBid writes a new live bid. A second live bid by the same driver on the
// same request collides with bids_one_live_per_driver_request; that collision
// is reported as errBidAlreadyLive for the caller to answer as bid_not_live.
var errBidAlreadyLive = errors.New("the driver already has a live bid on this request")

func (s *Store) InsertBid(ctx context.Context, db DB, bid *Bid) error {
	_, err := db.Exec(ctx, `
		INSERT INTO mp.bids (
			id, request_id, request_revision, driver_id, state, bid_version,
			amount_minor, commission_minor, net_minor, slot, depends_on_claim_id,
			availability_epoch, reservation_id, rate_profile_version, expires_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		bid.ID, bid.RequestID, bid.RequestRevision, bid.DriverID, bid.State, bid.BidVersion,
		bid.AmountMinor, bid.CommissionMinor, bid.NetMinor, bid.Slot, bid.DependsOnClaimID,
		bid.AvailabilityEpoch, bid.ReservationID, bid.RateProfileVersion, bid.ExpiresAt,
	)
	if err != nil {
		if isUniqueViolation(err, "bids_one_live_per_driver_request") {
			return errBidAlreadyLive
		}
		return fmt.Errorf("failed to insert marketplace bid: %w", err)
	}
	return nil
}

// InsertBidRevision snapshots one bid version.
func (s *Store) InsertBidRevision(ctx context.Context, db DB, bidID uuid.UUID, bidVersion int, amountMinor, commissionMinor int64, reason string) error {
	_, err := db.Exec(ctx, `
		INSERT INTO mp.bid_revisions (bid_id, bid_version, amount_minor, commission_minor, reason)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (bid_id, bid_version) DO NOTHING`,
		bidID, bidVersion, amountMinor, commissionMinor, reason)
	if err != nil {
		return fmt.Errorf("failed to insert bid revision: %w", err)
	}
	return nil
}

// BidByID reads one bid.
func (s *Store) BidByID(ctx context.Context, db DB, id uuid.UUID) (*Bid, error) {
	return scanBid(db.QueryRow(ctx, `SELECT `+bidColumns+` FROM mp.bids WHERE id = $1`, id))
}

// BidForUpdate reads and locks one bid.
func (s *Store) BidForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Bid, error) {
	return scanBid(tx.QueryRow(ctx, `SELECT `+bidColumns+` FROM mp.bids WHERE id = $1 FOR UPDATE`, id))
}

func (s *Store) bidList(ctx context.Context, db DB, query string, args ...any) ([]*Bid, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list marketplace bids: %w", err)
	}
	defer rows.Close()
	var bids []*Bid
	for rows.Next() {
		bid, err := scanBid(rows)
		if err != nil {
			return nil, err
		}
		bids = append(bids, bid)
	}
	return bids, rows.Err()
}

// LiveBidsForRequest lists a request's live bids, oldest first.
func (s *Store) LiveBidsForRequest(ctx context.Context, db DB, requestID uuid.UUID) ([]*Bid, error) {
	return s.bidList(ctx, db, `
		SELECT `+bidColumns+` FROM mp.bids
		WHERE request_id = $1 AND state = ANY($2)
		ORDER BY created_at ASC`, requestID, machine.MpBidLiveStates())
}

// LiveBidCountForRequest counts a request's live bids.
func (s *Store) LiveBidCountForRequest(ctx context.Context, db DB, requestID uuid.UUID) (int, error) {
	var count int
	err := db.QueryRow(ctx, `
		SELECT COUNT(*) FROM mp.bids WHERE request_id = $1 AND state = ANY($2)`,
		requestID, machine.MpBidLiveStates()).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count live bids: %w", err)
	}
	return count, nil
}

// LiveBidCountForDriver counts a driver's live bids across requests.
func (s *Store) LiveBidCountForDriver(ctx context.Context, db DB, driverID uuid.UUID) (int, error) {
	var count int
	err := db.QueryRow(ctx, `
		SELECT COUNT(*) FROM mp.bids WHERE driver_id = $1 AND state = ANY($2)`,
		driverID, machine.MpBidLiveStates()).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count the driver's live bids: %w", err)
	}
	return count, nil
}

// LiveBidForDriverOnRequest returns the driver's live bid on a request, if any.
func (s *Store) LiveBidForDriverOnRequest(ctx context.Context, db DB, requestID, driverID uuid.UUID) (*Bid, error) {
	return scanBid(db.QueryRow(ctx, `
		SELECT `+bidColumns+` FROM mp.bids
		WHERE request_id = $1 AND driver_id = $2 AND state = ANY($3)`,
		requestID, driverID, machine.MpBidLiveStates()))
}

// BidsForDriver lists a driver's bids, newest first.
func (s *Store) BidsForDriver(ctx context.Context, db DB, driverID uuid.UUID, limit int) ([]*Bid, error) {
	return s.bidList(ctx, db, `
		SELECT `+bidColumns+` FROM mp.bids
		WHERE driver_id = $1
		ORDER BY created_at DESC
		LIMIT $2`, driverID, limit)
}

// ExpiredLiveBids lists live bids whose deadline has passed, for the sweep.
func (s *Store) ExpiredLiveBids(ctx context.Context, db DB, now time.Time, limit int) ([]*Bid, error) {
	return s.bidList(ctx, db, `
		SELECT `+bidColumns+` FROM mp.bids
		WHERE state = ANY($1) AND expires_at <= $2
		ORDER BY expires_at ASC
		LIMIT $3`, machine.MpBidLiveStates(), now, limit)
}

// BidUpdate carries the columns a bid transition may change.
type BidUpdate struct {
	BidVersion      *int
	AmountMinor     *int64
	CommissionMinor *int64
	NetMinor        *int64
	RequestRevision *int
	ExpiresAt       *time.Time
}

// TransitionBid moves a bid, refusing anything the mpBid machine does not
// allow. The UPDATE re-qualifies on BOTH the optimistic bid_version guard and
// the exact from-state, so a state-only transition (withdraw, expire, lost,
// invalidated — which never bumps bid_version) can never overwrite a state a
// concurrent writer committed in the meantime. Zero rows means the caller's
// snapshot is stale: it must re-read (under lock) and re-assert, never
// overwrite.
func (s *Store) TransitionBid(ctx context.Context, tx pgx.Tx, bid *Bid, to string, update BidUpdate) (*Bid, error) {
	if err := machine.Assert(machine.MpBid, bid.State, to); err != nil {
		allowed, _ := machine.Allowed(machine.MpBid, bid.State)
		return nil, domain.Errorf(domain.CodeIllegalTransition, "a bid cannot move from %s to %s", bid.State, to).
			WithDetails(map[string]any{"from": bid.State, "to": to, "allowed": allowed}).
			Wrap(err)
	}
	row := tx.QueryRow(ctx, `
		UPDATE mp.bids SET
			state = $4,
			bid_version = COALESCE($5, bid_version),
			amount_minor = COALESCE($6, amount_minor),
			commission_minor = COALESCE($7, commission_minor),
			net_minor = COALESCE($8, net_minor),
			request_revision = COALESCE($9, request_revision),
			expires_at = COALESCE($10, expires_at),
			updated_at = now()
		WHERE id = $1 AND bid_version = $2 AND state = $3
		RETURNING `+bidColumns,
		bid.ID, bid.BidVersion, bid.State, to,
		update.BidVersion, update.AmountMinor, update.CommissionMinor, update.NetMinor,
		update.RequestRevision, update.ExpiresAt,
	)
	updated, err := scanBid(row)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the bid changed while this call was in flight").
			WithDetails(map[string]any{"bidId": bid.ID.String(), "expectedVersion": bid.BidVersion, "expectedState": bid.State})
	}
	return updated, err
}

// MarkHoldReleased records the wallet's CONFIRMATION that a bid's hold was
// released. It is bookkeeping for the driver's honest holdState — never a
// precondition for the money itself, which the release keys own.
func (s *Store) MarkHoldReleased(ctx context.Context, db DB, bidID uuid.UUID, at time.Time) error {
	_, err := db.Exec(ctx,
		`UPDATE mp.bids SET hold_released_at = COALESCE(hold_released_at, $2) WHERE id = $1`,
		bidID, at)
	if err != nil {
		return fmt.Errorf("failed to mark the hold released: %w", err)
	}
	return nil
}

// HasRevisedRevision reports whether a bid ever committed a driver revision
// (a bid_revisions row written with reason 'revised'). The award saga's
// compensation uses it to pick the honest live state to return the bid to,
// because bid_version alone no longer says (selection bumps it too).
func (s *Store) HasRevisedRevision(ctx context.Context, db DB, bidID uuid.UUID) (bool, error) {
	var count int
	err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM mp.bid_revisions WHERE bid_id = $1 AND reason = 'revised'`,
		bidID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("failed to count bid revisions: %w", err)
	}
	return count > 0, nil
}

// RequestCurrencies maps request ids to their currency, for views built from
// bid rows alone (which do not restate the request's currency).
func (s *Store) RequestCurrencies(ctx context.Context, db DB, requestIDs []uuid.UUID) (map[uuid.UUID]string, error) {
	out := map[uuid.UUID]string{}
	if len(requestIDs) == 0 {
		return out, nil
	}
	rows, err := db.Query(ctx, `SELECT id, currency FROM mp.requests WHERE id = ANY($1)`, requestIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to read request currencies: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var currency string
		if err := rows.Scan(&id, &currency); err != nil {
			return nil, fmt.Errorf("failed to read request currency: %w", err)
		}
		out[id] = currency
	}
	return out, rows.Err()
}

// Advisory-lock namespaces for the in-transaction cap re-checks. The pair
// (namespace, hash of the subject id) scopes pg_advisory_xact_lock so a
// driver's concurrent bid inserts (and a requester's concurrent publishes)
// serialise against each other and the recount inside the transaction is
// authoritative.
const (
	advisoryDriverBidCap     = int32(0x6d704243) // "mpBC"
	advisoryRequesterOpenCap = int32(0x6d705243) // "mpRC"
)

// AcquireCapLock takes a transaction-scoped advisory lock for one subject in
// one namespace. It is released automatically at commit/rollback.
func (s *Store) AcquireCapLock(ctx context.Context, tx pgx.Tx, namespace int32, subject uuid.UUID) error {
	if _, err := tx.Exec(ctx,
		`SELECT pg_advisory_xact_lock($1, hashtext($2))`, namespace, subject.String()); err != nil {
		return fmt.Errorf("failed to take the cap lock: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Driver claims (read side for eligibility; the award saga writes them)
// ---------------------------------------------------------------------------

// Claim is one driver capacity claim row.
type Claim struct {
	ID                uuid.UUID
	DriverID          uuid.UUID
	State             string
	Slot              string
	Service           string
	AwardID           *uuid.UUID
	ExecutionService  string
	ExecutionID       *uuid.UUID
	DependsOnClaimID  *uuid.UUID
	AvailabilityEpoch int64
	FencingToken      int64
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

const claimColumns = `
	id, driver_id, state, slot, service, award_id,
	COALESCE(execution_service, ''), execution_id, depends_on_claim_id,
	availability_epoch, fencing_token, created_at, updated_at`

func scanClaim(row pgx.Row) (*Claim, error) {
	var claim Claim
	err := row.Scan(
		&claim.ID, &claim.DriverID, &claim.State, &claim.Slot, &claim.Service, &claim.AwardID,
		&claim.ExecutionService, &claim.ExecutionID, &claim.DependsOnClaimID,
		&claim.AvailabilityEpoch, &claim.FencingToken, &claim.CreatedAt, &claim.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read driver claim: %w", err)
	}
	return &claim, nil
}

// CurrentClaim returns the driver's claim occupying the current slot, or
// domain.ErrNotFound. The WHERE mirrors claims_one_current_per_driver exactly.
func (s *Store) CurrentClaim(ctx context.Context, db DB, driverID uuid.UUID) (*Claim, error) {
	return scanClaim(db.QueryRow(ctx, `
		SELECT `+claimColumns+` FROM mp.driver_claims
		WHERE driver_id = $1
			AND (state = $2 OR (state = $3 AND slot = $4))`,
		driverID, machine.MpClaimCurrent, machine.MpClaimAwardPending, SlotCurrent))
}

// NextClaim returns the driver's claim occupying the next slot, or
// domain.ErrNotFound. The WHERE mirrors claims_one_next_per_driver exactly.
func (s *Store) NextClaim(ctx context.Context, db DB, driverID uuid.UUID) (*Claim, error) {
	return scanClaim(db.QueryRow(ctx, `
		SELECT `+claimColumns+` FROM mp.driver_claims
		WHERE driver_id = $1
			AND (state = $2 OR (state = $3 AND slot = $4))`,
		driverID, machine.MpClaimNext, machine.MpClaimAwardPending, SlotNext))
}

// AvailabilityEpoch is a number that changes whenever the driver's claim
// picture changes: the highest fencing token over all their claims. A bid
// carries the epoch its eligibility was evaluated under, and a mismatch at
// submission means the driver acted on a stale picture.
func (s *Store) AvailabilityEpoch(ctx context.Context, db DB, driverID uuid.UUID) (int64, error) {
	var epoch int64
	err := db.QueryRow(ctx,
		`SELECT COALESCE(MAX(fencing_token), 0) FROM mp.driver_claims WHERE driver_id = $1`,
		driverID).Scan(&epoch)
	if err != nil {
		return 0, fmt.Errorf("failed to read availability epoch: %w", err)
	}
	return epoch, nil
}

// ---------------------------------------------------------------------------
// Rate profiles
// ---------------------------------------------------------------------------

// RateProfileComponents are the optional profile components; nil means the
// component is disabled. They stay disabled unless configured AND disclosed.
type RateProfileComponents struct {
	PerMinuteMinor   *int64 `json:"perMinuteMinor"`
	PickupPerKmMinor *int64 `json:"pickupPerKmMinor"`
	HandlingMinor    *int64 `json:"handlingMinor"`
}

// RateProfile is one versioned, append-only rate profile row.
type RateProfile struct {
	ID           uuid.UUID
	DriverID     uuid.UUID
	CityID       string
	Service      string
	VehicleClass string
	Currency     string
	Version      int
	PerKmMinor   int64
	MinTripMinor int64
	Components   RateProfileComponents
	CreatedAt    time.Time
}

const rateProfileColumns = `
	id, driver_id, city_id, service, vehicle_class, currency, version,
	per_km_minor, min_trip_minor, components, created_at`

func scanRateProfile(row pgx.Row) (*RateProfile, error) {
	var profile RateProfile
	var components []byte
	err := row.Scan(
		&profile.ID, &profile.DriverID, &profile.CityID, &profile.Service,
		&profile.VehicleClass, &profile.Currency, &profile.Version,
		&profile.PerKmMinor, &profile.MinTripMinor, &components, &profile.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read rate profile: %w", err)
	}
	if len(components) > 0 {
		if err := json.Unmarshal(components, &profile.Components); err != nil {
			return nil, fmt.Errorf("rate profile %s stores unreadable components: %w", profile.ID, err)
		}
	}
	return &profile, nil
}

// InsertRateProfile appends a new profile version. Profiles are append-only;
// there is no UPDATE path.
func (s *Store) InsertRateProfile(ctx context.Context, db DB, profile *RateProfile) error {
	components, err := json.Marshal(profile.Components)
	if err != nil {
		return fmt.Errorf("unserialisable profile components: %w", err)
	}
	_, err = db.Exec(ctx, `
		INSERT INTO mp.rate_profiles (
			id, driver_id, city_id, service, vehicle_class, currency, version,
			per_km_minor, min_trip_minor, components
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		profile.ID, profile.DriverID, profile.CityID, profile.Service,
		profile.VehicleClass, profile.Currency, profile.Version,
		profile.PerKmMinor, profile.MinTripMinor, components,
	)
	if err != nil {
		return fmt.Errorf("failed to insert rate profile: %w", err)
	}
	return nil
}

// LatestRateProfile returns the driver's newest profile for a pair, or
// domain.ErrNotFound.
func (s *Store) LatestRateProfile(ctx context.Context, db DB, driverID uuid.UUID, cityID, service, vehicleClass string) (*RateProfile, error) {
	return scanRateProfile(db.QueryRow(ctx, `
		SELECT `+rateProfileColumns+` FROM mp.rate_profiles
		WHERE driver_id = $1 AND city_id = $2 AND service = $3 AND vehicle_class = $4
		ORDER BY version DESC
		LIMIT 1`, driverID, cityID, service, vehicleClass))
}

// RateProfilesForDriver lists the newest version of each of the driver's
// profiles.
func (s *Store) RateProfilesForDriver(ctx context.Context, db DB, driverID uuid.UUID) ([]*RateProfile, error) {
	rows, err := db.Query(ctx, `
		SELECT DISTINCT ON (city_id, service, vehicle_class) `+rateProfileColumns+`
		FROM mp.rate_profiles
		WHERE driver_id = $1
		ORDER BY city_id, service, vehicle_class, version DESC`, driverID)
	if err != nil {
		return nil, fmt.Errorf("failed to list rate profiles: %w", err)
	}
	defer rows.Close()
	var profiles []*RateProfile
	for rows.Next() {
		profile, err := scanRateProfile(rows)
		if err != nil {
			return nil, err
		}
		profiles = append(profiles, profile)
	}
	return profiles, rows.Err()
}

// ---------------------------------------------------------------------------
// Reservation recovery
// ---------------------------------------------------------------------------

// RecoveryAction is what the sweep still owes the wallet.
const (
	RecoveryRelease = "release"
	RecoveryAdjust  = "adjust"
	// RecoveryReverse is a captured commission whose linked reversal could not
	// be confirmed; the sweep re-drives it by the bid's award until the wallet
	// answers — but only once the award is genuinely off the confirmed path.
	RecoveryReverse = "reverse"
	// RecoveryReserveReplay is a Reserve whose outcome was never learned. The
	// sweep REPLAYS the reserve under the SAME idempotency key (converging on
	// whatever the wallet actually holds and learning the real reservation
	// id), then releases THAT id. It never releases the idempotency key
	// string — the wallet has never heard of such a reservation.
	RecoveryReserveReplay = "reserve_replay"
	// RecoverySettle is a marketplace completion settlement the engine still
	// owes payment-service, idempotent on the award id.
	RecoverySettle = "settle"
)

// RecoveryRow is one wallet operation the engine could not deliver.
type RecoveryRow struct {
	ID            uuid.UUID
	ReservationID string
	DriverID      uuid.UUID
	BidID         *uuid.UUID
	Action        string
	AmountMinor   *int64
	// Payload carries the full replay body for reserve_replay (a
	// ReserveRecoveryPayload) and settle (a SettlementRequest).
	Payload     json.RawMessage
	Attempts    int
	LastError   string
	NextRetryAt time.Time
	ResolvedAt  *time.Time
	CreatedAt   time.Time
}

// ReserveRecoveryPayload is what a reserve_replay row needs to converge: the
// exact reserve request and the exact idempotency key the lost call used.
type ReserveRecoveryPayload struct {
	Reserve    ReserveRequest `json:"reserve"`
	ReserveKey string         `json:"reserveKey"`
}

// InsertRecovery writes down a wallet operation the sweep must retry. It runs
// on the pool, outside the failed transaction, because it is the record OF
// that failure — except settlement intents, which are written INSIDE the
// completion transaction so a crash cannot forget them.
func (s *Store) InsertRecovery(ctx context.Context, db DB, row RecoveryRow) error {
	if row.ID == uuid.Nil {
		row.ID = uuid.New()
	}
	_, err := db.Exec(ctx, `
		INSERT INTO mp.reservation_recovery (
			id, reservation_id, driver_id, bid_id, action, amount_minor, payload, last_error
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		row.ID, row.ReservationID, row.DriverID, row.BidID, row.Action, row.AmountMinor,
		row.Payload, nullable(row.LastError))
	if err != nil {
		return fmt.Errorf("failed to record the reservation recovery row: %w", err)
	}
	return nil
}

// DueRecoveries lists unresolved recovery rows whose retry time has come.
func (s *Store) DueRecoveries(ctx context.Context, db DB, now time.Time, limit int) ([]*RecoveryRow, error) {
	rows, err := db.Query(ctx, `
		SELECT id, reservation_id, driver_id, bid_id, action, amount_minor, payload,
			attempts, COALESCE(last_error, ''), next_retry_at, resolved_at, created_at
		FROM mp.reservation_recovery
		WHERE resolved_at IS NULL AND next_retry_at <= $1
		ORDER BY next_retry_at ASC
		LIMIT $2`, now, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list due recoveries: %w", err)
	}
	defer rows.Close()
	var due []*RecoveryRow
	for rows.Next() {
		var row RecoveryRow
		if err := rows.Scan(&row.ID, &row.ReservationID, &row.DriverID, &row.BidID, &row.Action,
			&row.AmountMinor, &row.Payload, &row.Attempts, &row.LastError, &row.NextRetryAt, &row.ResolvedAt, &row.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to read recovery row: %w", err)
		}
		due = append(due, &row)
	}
	return due, rows.Err()
}

// ResolveRecovery marks one recovery row done.
func (s *Store) ResolveRecovery(ctx context.Context, db DB, id uuid.UUID, now time.Time) error {
	_, err := db.Exec(ctx,
		`UPDATE mp.reservation_recovery SET resolved_at = $2 WHERE id = $1 AND resolved_at IS NULL`, id, now)
	if err != nil {
		return fmt.Errorf("failed to resolve recovery row: %w", err)
	}
	return nil
}

// DeferRecovery reschedules a recovery row after another failed attempt.
func (s *Store) DeferRecovery(ctx context.Context, db DB, id uuid.UUID, lastError string, retryAt time.Time) error {
	_, err := db.Exec(ctx, `
		UPDATE mp.reservation_recovery
		SET attempts = attempts + 1, last_error = $2, next_retry_at = $3
		WHERE id = $1 AND resolved_at IS NULL`, id, lastError, retryAt)
	if err != nil {
		return fmt.Errorf("failed to defer recovery row: %w", err)
	}
	return nil
}

func nullable(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
