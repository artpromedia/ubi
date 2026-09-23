package marketplace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// Book for Later products (contract MP_BOOKING_PRODUCTS): what a stored
// intent becomes when it is published.
const (
	ProductScheduledRequest   = "scheduled_request"
	ProductAdvanceReservation = "advance_reservation"
)

// ---------------------------------------------------------------------------
// Scheduled requests (and recurring occurrences)
// ---------------------------------------------------------------------------

// ScheduledApproval is why a stored intent waits for the rider instead of
// publishing, with the refreshed terms that need renewed approval.
type ScheduledApproval struct {
	Reason             string `json:"reason"`
	Message            string `json:"message"`
	RefreshedMinMinor  *int64 `json:"refreshedMinMinor,omitempty"`
	RefreshedMaxMinor  *int64 `json:"refreshedMaxMinor,omitempty"`
	RefreshedSuggested *int64 `json:"refreshedSuggestedMinor,omitempty"`
}

// ScheduledRequest is one mp.scheduled_requests row: a stored intent no
// driver is committed to (a scheduled request, or one recurring occurrence).
type ScheduledRequest struct {
	ID              uuid.UUID
	Product         string
	RequesterID     uuid.UUID
	CityID          string
	Service         string
	VehicleClass    string
	Currency        string
	State           string
	Version         int
	Pickup          Area
	Dropoff         Area
	Stops           []RouteStop
	PaymentMethodID string
	RequestedMinor  int64
	MaxFareMinor    int64
	Schedule        PickupSchedule
	PublishAt       time.Time
	TemplateID      *uuid.UUID
	OccurrenceDate  *string
	RequestID       *uuid.UUID
	Approval        *ScheduledApproval
	RemindersSent   []int32
	Attempts        int
	NextAttemptAt   *time.Time
	LastError       string
	CloseReason     string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

const scheduledColumns = `
	id, product, requester_id, city_id, service, vehicle_class, currency,
	state, version, pickup, dropoff, stops, payment_method_id,
	requested_minor, max_fare_minor,
	local_date::text, local_time, time_zone, utc_offset_sec, dst_resolution, window_sec,
	pickup_at, window_end, publish_at,
	template_id, occurrence_date::text, request_id, approval, reminders_sent,
	attempts, next_attempt_at, COALESCE(last_error, ''), COALESCE(close_reason, ''),
	created_at, updated_at`

func scanScheduled(row pgx.Row) (*ScheduledRequest, error) {
	var sr ScheduledRequest
	var pickup, dropoff, stops, approval []byte
	err := row.Scan(
		&sr.ID, &sr.Product, &sr.RequesterID, &sr.CityID, &sr.Service, &sr.VehicleClass, &sr.Currency,
		&sr.State, &sr.Version, &pickup, &dropoff, &stops, &sr.PaymentMethodID,
		&sr.RequestedMinor, &sr.MaxFareMinor,
		&sr.Schedule.LocalDate, &sr.Schedule.LocalTime, &sr.Schedule.TimeZone, &sr.Schedule.UTCOffsetSec,
		&sr.Schedule.DSTResolution, &sr.Schedule.WindowSec,
		&sr.Schedule.PickupAt, &sr.Schedule.WindowEnd, &sr.PublishAt,
		&sr.TemplateID, &sr.OccurrenceDate, &sr.RequestID, &approval, &sr.RemindersSent,
		&sr.Attempts, &sr.NextAttemptAt, &sr.LastError, &sr.CloseReason,
		&sr.CreatedAt, &sr.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read scheduled request: %w", err)
	}
	if err := json.Unmarshal(pickup, &sr.Pickup); err != nil {
		return nil, fmt.Errorf("scheduled request %s stores an unreadable pickup: %w", sr.ID, err)
	}
	if err := json.Unmarshal(dropoff, &sr.Dropoff); err != nil {
		return nil, fmt.Errorf("scheduled request %s stores an unreadable dropoff: %w", sr.ID, err)
	}
	if sr.Stops, err = decodeStops(stops); err != nil {
		return nil, fmt.Errorf("scheduled request %s stores unreadable stops: %w", sr.ID, err)
	}
	if len(approval) > 0 && string(approval) != "null" {
		sr.Approval = &ScheduledApproval{}
		if err := json.Unmarshal(approval, sr.Approval); err != nil {
			return nil, fmt.Errorf("scheduled request %s stores an unreadable approval: %w", sr.ID, err)
		}
	}
	sr.Schedule.PickupAt = sr.Schedule.PickupAt.UTC()
	sr.Schedule.WindowEnd = sr.Schedule.WindowEnd.UTC()
	return &sr, nil
}

// insertScheduledSQL writes one intent. For an occurrence the partial unique
// index on (template_id, occurrence_date) turns a replayed generation into a
// no-op (ON CONFLICT DO NOTHING) — never a duplicate.
const insertScheduledSQL = `
	INSERT INTO mp.scheduled_requests (
		id, product, requester_id, city_id, service, vehicle_class, currency,
		state, version, pickup, dropoff, stops, payment_method_id,
		requested_minor, max_fare_minor,
		local_date, local_time, time_zone, utc_offset_sec, dst_resolution, window_sec,
		pickup_at, window_end, publish_at,
		template_id, occurrence_date, close_reason, created_at, updated_at
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::date,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::date,$27,$28,$28)
	ON CONFLICT (template_id, occurrence_date) WHERE template_id IS NOT NULL DO NOTHING`

// InsertScheduledRequest writes a stored intent. It reports whether a row
// was written: false only for an occurrence that already exists.
func (s *Store) InsertScheduledRequest(ctx context.Context, db DB, sr *ScheduledRequest) (bool, error) {
	pickup, err := json.Marshal(sr.Pickup)
	if err != nil {
		return false, fmt.Errorf("unserialisable pickup: %w", err)
	}
	dropoff, err := json.Marshal(sr.Dropoff)
	if err != nil {
		return false, fmt.Errorf("unserialisable dropoff: %w", err)
	}
	stops, err := encodeStops(sr.Stops)
	if err != nil {
		return false, err
	}
	tag, err := db.Exec(ctx, insertScheduledSQL,
		sr.ID, sr.Product, sr.RequesterID, sr.CityID, sr.Service, sr.VehicleClass, sr.Currency,
		sr.State, sr.Version, pickup, dropoff, stops, sr.PaymentMethodID,
		sr.RequestedMinor, sr.MaxFareMinor,
		sr.Schedule.LocalDate, sr.Schedule.LocalTime, sr.Schedule.TimeZone, sr.Schedule.UTCOffsetSec,
		sr.Schedule.DSTResolution, sr.Schedule.WindowSec,
		sr.Schedule.PickupAt, sr.Schedule.WindowEnd, sr.PublishAt,
		sr.TemplateID, sr.OccurrenceDate, nullable(sr.CloseReason), stampOf(sr.CreatedAt),
	)
	if err != nil {
		return false, fmt.Errorf("failed to insert scheduled request: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// stampOf is the creation stamp a row is written with: the service clock's
// instant (so deadlines and reminders computed from the service clock agree
// with it), or the database's now() when the caller set none.
func stampOf(at time.Time) any {
	if at.IsZero() {
		return time.Now().UTC()
	}
	return at.UTC()
}

// ScheduledRequestByID reads one intent.
func (s *Store) ScheduledRequestByID(ctx context.Context, db DB, id uuid.UUID) (*ScheduledRequest, error) {
	return scanScheduled(db.QueryRow(ctx, `SELECT `+scheduledColumns+` FROM mp.scheduled_requests WHERE id = $1`, id))
}

// ScheduledRequestForUpdate reads and locks one intent.
func (s *Store) ScheduledRequestForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*ScheduledRequest, error) {
	return scanScheduled(tx.QueryRow(ctx, `SELECT `+scheduledColumns+` FROM mp.scheduled_requests WHERE id = $1 FOR UPDATE`, id))
}

// OccurrenceByDate reads one template's occurrence for a local date.
func (s *Store) OccurrenceByDate(ctx context.Context, db DB, templateID uuid.UUID, date string) (*ScheduledRequest, error) {
	return scanScheduled(db.QueryRow(ctx, `
		SELECT `+scheduledColumns+` FROM mp.scheduled_requests
		WHERE template_id = $1 AND occurrence_date = $2::date`, templateID, date))
}

// ScheduledByRequestID reads the intent a published request came from.
func (s *Store) ScheduledByRequestID(ctx context.Context, db DB, requestID uuid.UUID) (*ScheduledRequest, error) {
	return scanScheduled(db.QueryRow(ctx, `
		SELECT `+scheduledColumns+` FROM mp.scheduled_requests WHERE request_id = $1`, requestID))
}

func (s *Store) scheduledList(ctx context.Context, db DB, query string, args ...any) ([]*ScheduledRequest, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list scheduled requests: %w", err)
	}
	defer rows.Close()
	var out []*ScheduledRequest
	for rows.Next() {
		sr, err := scanScheduled(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sr)
	}
	return out, rows.Err()
}

// ScheduledRequestsForRequester lists a requester's one-off intents (not
// recurring occurrences), soonest pickup first.
func (s *Store) ScheduledRequestsForRequester(ctx context.Context, db DB, requesterID uuid.UUID, limit int) ([]*ScheduledRequest, error) {
	return s.scheduledList(ctx, db, `
		SELECT `+scheduledColumns+` FROM mp.scheduled_requests
		WHERE requester_id = $1 AND template_id IS NULL
		ORDER BY pickup_at ASC
		LIMIT $2`, requesterID, limit)
}

// OccurrencesForTemplate lists a template's occurrences from a local date on.
func (s *Store) OccurrencesForTemplate(ctx context.Context, db DB, templateID uuid.UUID, fromDate string, limit int) ([]*ScheduledRequest, error) {
	return s.scheduledList(ctx, db, `
		SELECT `+scheduledColumns+` FROM mp.scheduled_requests
		WHERE template_id = $1 AND occurrence_date >= $2::date
		ORDER BY occurrence_date ASC
		LIMIT $3`, templateID, fromDate, limit)
}

// PendingScheduledCount counts a requester's intents still waiting to
// publish (the per-requester cap).
func (s *Store) PendingScheduledCount(ctx context.Context, db DB, requesterID uuid.UUID) (int, error) {
	var count int
	err := db.QueryRow(ctx, `
		SELECT COUNT(*) FROM mp.scheduled_requests
		WHERE requester_id = $1 AND template_id IS NULL AND state = ANY($2)`,
		requesterID, []string{machine.MpScheduledUnassigned, machine.MpScheduledNeedsApproval}).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count pending scheduled requests: %w", err)
	}
	return count, nil
}

// DueScheduledPublications lists intents whose publication time has come.
func (s *Store) DueScheduledPublications(ctx context.Context, db DB, now time.Time, limit int) ([]*ScheduledRequest, error) {
	return s.scheduledList(ctx, db, `
		SELECT `+scheduledColumns+` FROM mp.scheduled_requests
		WHERE state = $1 AND publish_at <= $2 AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
		ORDER BY publish_at ASC
		LIMIT $3`, machine.MpScheduledUnassigned, now, limit)
}

// LapsedScheduledIntents lists unpublished intents whose pickup window ended.
func (s *Store) LapsedScheduledIntents(ctx context.Context, db DB, now time.Time, limit int) ([]*ScheduledRequest, error) {
	return s.scheduledList(ctx, db, `
		SELECT `+scheduledColumns+` FROM mp.scheduled_requests
		WHERE state = ANY($1) AND window_end <= $2
		ORDER BY window_end ASC
		LIMIT $3`, []string{machine.MpScheduledUnassigned, machine.MpScheduledNeedsApproval}, now, limit)
}

// PendingScheduledForReminders lists unpublished intents with a pickup
// still ahead (the reminder pass decides which offsets are due), one keyset
// page at a time: rows after (afterPickup, afterID) in (pickup_at, id)
// order, so the pass reaches every intent in the horizon — not only the
// soonest batch, which would delay every later intent's reminder.
func (s *Store) PendingScheduledForReminders(ctx context.Context, db DB, now, horizon, afterPickup time.Time, afterID uuid.UUID, limit int) ([]*ScheduledRequest, error) {
	return s.scheduledList(ctx, db, `
		SELECT `+scheduledColumns+` FROM mp.scheduled_requests
		WHERE state = ANY($1) AND pickup_at > $2 AND pickup_at <= $3
			AND (pickup_at, id) > ($4, $5)
		ORDER BY pickup_at ASC, id ASC
		LIMIT $6`, []string{machine.MpScheduledUnassigned, machine.MpScheduledNeedsApproval}, now, horizon,
		afterPickup, afterID, limit)
}

// PublishedScheduledUnfulfilled lists published intents whose request the
// market closed without an award (no offers, expired).
func (s *Store) PublishedScheduledUnfulfilled(ctx context.Context, db DB, limit int) ([]*ScheduledRequest, error) {
	return s.scheduledList(ctx, db, `
		SELECT `+prefixed("sr.", scheduledColumns)+` FROM mp.scheduled_requests sr
		JOIN mp.requests r ON r.id = sr.request_id
		WHERE sr.state = $1 AND r.state = ANY($2)
		ORDER BY sr.pickup_at ASC
		LIMIT $3`, machine.MpScheduledPublished,
		[]string{machine.MpRequestNoOffers, machine.MpRequestExpired}, limit)
}

// ScheduledUpdate carries the columns an intent transition may change.
type ScheduledUpdate struct {
	RequestID       *uuid.UUID
	Approval        *ScheduledApproval
	ClearApproval   bool
	RequestedMinor  *int64
	MaxFareMinor    *int64
	PublishAt       *time.Time
	ClearNextTry    bool
	CloseReason     *string
	PaymentMethodID *string
}

// TransitionScheduled moves an intent, refusing anything the
// mpScheduledRequest machine does not allow, under the optimistic version.
func (s *Store) TransitionScheduled(ctx context.Context, tx pgx.Tx, sr *ScheduledRequest, to string, update ScheduledUpdate) (*ScheduledRequest, error) {
	if err := machine.Assert(machine.MpScheduledRequest, sr.State, to); err != nil {
		allowed, _ := machine.Allowed(machine.MpScheduledRequest, sr.State)
		return nil, domain.Errorf(domain.CodeIllegalTransition, "a scheduled request cannot move from %s to %s", sr.State, to).
			WithDetails(map[string]any{"from": sr.State, "to": to, "allowed": allowed}).
			Wrap(err)
	}
	var approval []byte
	if update.Approval != nil {
		encoded, err := json.Marshal(update.Approval)
		if err != nil {
			return nil, fmt.Errorf("unserialisable approval: %w", err)
		}
		approval = encoded
	}
	row := tx.QueryRow(ctx, `
		UPDATE mp.scheduled_requests SET
			state = $3,
			version = version + 1,
			request_id = COALESCE($4, request_id),
			approval = CASE WHEN $5 THEN NULL ELSE COALESCE($6::jsonb, approval) END,
			requested_minor = COALESCE($7, requested_minor),
			max_fare_minor = COALESCE($8, max_fare_minor),
			publish_at = COALESCE($9, publish_at),
			next_attempt_at = CASE WHEN $10 THEN NULL ELSE next_attempt_at END,
			attempts = CASE WHEN $10 THEN 0 ELSE attempts END,
			close_reason = COALESCE($11, close_reason),
			payment_method_id = COALESCE($12, payment_method_id),
			updated_at = now()
		WHERE id = $1 AND version = $2
		RETURNING `+scheduledColumns,
		sr.ID, sr.Version, to,
		update.RequestID, update.ClearApproval, approval,
		update.RequestedMinor, update.MaxFareMinor, update.PublishAt,
		update.ClearNextTry, update.CloseReason, update.PaymentMethodID,
	)
	updated, err := scanScheduled(row)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the scheduled request changed while this call was in flight").
			WithDetails(map[string]any{"scheduledRequestId": sr.ID.String(), "expectedVersion": sr.Version})
	}
	return updated, err
}

// DeferScheduled records a failed publication attempt and when to retry.
func (s *Store) DeferScheduled(ctx context.Context, db DB, id uuid.UUID, lastError string, retryAt time.Time) error {
	_, err := db.Exec(ctx, `
		UPDATE mp.scheduled_requests
		SET attempts = attempts + 1, last_error = $2, next_attempt_at = $3, updated_at = now()
		WHERE id = $1`, id, lastError, retryAt)
	if err != nil {
		return fmt.Errorf("failed to defer the scheduled request: %w", err)
	}
	return nil
}

// ClearOccurrenceRetries makes a resumed series' waiting occurrences due
// again at once (a paused series deferred their publication).
func (s *Store) ClearOccurrenceRetries(ctx context.Context, db DB, templateID uuid.UUID) error {
	_, err := db.Exec(ctx, `
		UPDATE mp.scheduled_requests SET next_attempt_at = NULL, attempts = 0, updated_at = now()
		WHERE template_id = $1 AND state = $2`, templateID, machine.MpScheduledUnassigned)
	if err != nil {
		return fmt.Errorf("failed to clear the series' deferred publications: %w", err)
	}
	return nil
}

// MarkScheduledReminder records a reminder offset as sent. It reports
// whether THIS call recorded it (false: already sent).
func (s *Store) MarkScheduledReminder(ctx context.Context, tx pgx.Tx, id uuid.UUID, offsetSec int) (bool, error) {
	tag, err := tx.Exec(ctx, `
		UPDATE mp.scheduled_requests
		SET reminders_sent = array_append(reminders_sent, $2::integer), updated_at = now()
		WHERE id = $1 AND NOT ($2::integer = ANY(reminders_sent))`, id, offsetSec)
	if err != nil {
		return false, fmt.Errorf("failed to record the reminder: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// prefixed qualifies a fixed column list with a table alias, for the joins
// that read one table's columns next to another's.
func prefixed(alias, columns string) string {
	result := ""
	for _, part := range splitColumns(columns) {
		if result != "" {
			result += ", "
		}
		result += qualifyColumn(alias, part)
	}
	return result
}

// splitColumns splits a column list on top-level commas.
func splitColumns(columns string) []string {
	var parts []string
	depth := 0
	start := 0
	for i := 0; i < len(columns); i++ {
		switch columns[i] {
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				parts = append(parts, trimSpace(columns[start:i]))
				start = i + 1
			}
		}
	}
	parts = append(parts, trimSpace(columns[start:]))
	return parts
}

func trimSpace(value string) string {
	start, end := 0, len(value)
	for start < end && (value[start] == ' ' || value[start] == '\n' || value[start] == '\t') {
		start++
	}
	for end > start && (value[end-1] == ' ' || value[end-1] == '\n' || value[end-1] == '\t') {
		end--
	}
	return value[start:end]
}

// qualifyColumn prefixes the column a single expression reads: a bare
// column, a `col::type` cast, or a COALESCE over the column.
func qualifyColumn(alias, expression string) string {
	const coalesce = "COALESCE("
	if len(expression) > len(coalesce) && expression[:len(coalesce)] == coalesce {
		return coalesce + alias + expression[len(coalesce):]
	}
	return alias + expression
}

// ---------------------------------------------------------------------------
// Advance bookings (the booking calendar)
// ---------------------------------------------------------------------------

// Booking funding states (contract MP_BOOKING_FUNDING_STATES).
const (
	BookingFundingPending       = "pending"
	BookingFundingSecured       = "secured"
	BookingFundingUnsecuredCash = "unsecured_cash"
	BookingFundingRefused       = "refused"
	BookingFundingReleased      = "released"
)

// BookingFailure is the explained outcome of a failed or cancelled booking.
type BookingFailure struct {
	Reason               string `json:"reason"`
	Message              string `json:"message"`
	CommissionReversed   bool   `json:"commissionReversed"`
	RiderFundingReleased bool   `json:"riderFundingReleased"`
	RematchAvailable     bool   `json:"rematchAvailable"`
}

// AdvanceBooking is one mp.advance_bookings row: a requester-selected
// driver's committed future booking on the calendar.
type AdvanceBooking struct {
	ID                   uuid.UUID
	AwardID              uuid.UUID
	RequestID            uuid.UUID
	BidID                uuid.UUID
	DriverID             uuid.UUID
	RequesterID          uuid.UUID
	VehicleID            *string
	CityID               string
	State                string
	Version              int
	FundingState         string
	PaymentMethodID      string
	Currency             string
	FareMinor            int64
	CommissionMinor      int64
	WindowStart          time.Time
	WindowEnd            time.Time
	TripDurationSec      int64
	OccupiedStart        time.Time
	OccupiedEnd          time.Time
	Pickup               Area
	Dropoff              Area
	FundingDueAt         time.Time
	FundingDeadline      time.Time
	ReconfirmOpensAt     time.Time
	ReconfirmDeadline    time.Time
	ActivationAt         time.Time
	ActivationDeadline   time.Time
	ReconfirmRequestedAt *time.Time
	ReconfirmedAt        *time.Time
	ActivatedAt          *time.Time
	ActivatedSlot        string
	ClaimID              *uuid.UUID
	RemindersSent        []int32
	Failure              *BookingFailure
	RematchRequestID     *uuid.UUID
	Attempts             int
	NextAttemptAt        *time.Time
	LastError            string
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

const bookingColumns = `
	id, award_id, request_id, bid_id, driver_id, requester_id, vehicle_id, city_id,
	state, version, funding_state, payment_method_id, currency, fare_minor, commission_minor,
	window_start, window_end, trip_duration_sec, lower(occupied), upper(occupied),
	pickup, dropoff,
	funding_due_at, funding_deadline, reconfirm_opens_at, reconfirm_deadline,
	activation_at, activation_deadline,
	reconfirm_requested_at, reconfirmed_at, activated_at, COALESCE(activated_slot, ''), claim_id,
	reminders_sent, failure, rematch_request_id,
	attempts, next_attempt_at, COALESCE(last_error, ''), created_at, updated_at`

func scanBooking(row pgx.Row) (*AdvanceBooking, error) {
	var b AdvanceBooking
	var pickup, dropoff, failure []byte
	err := row.Scan(
		&b.ID, &b.AwardID, &b.RequestID, &b.BidID, &b.DriverID, &b.RequesterID, &b.VehicleID, &b.CityID,
		&b.State, &b.Version, &b.FundingState, &b.PaymentMethodID, &b.Currency, &b.FareMinor, &b.CommissionMinor,
		&b.WindowStart, &b.WindowEnd, &b.TripDurationSec, &b.OccupiedStart, &b.OccupiedEnd,
		&pickup, &dropoff,
		&b.FundingDueAt, &b.FundingDeadline, &b.ReconfirmOpensAt, &b.ReconfirmDeadline,
		&b.ActivationAt, &b.ActivationDeadline,
		&b.ReconfirmRequestedAt, &b.ReconfirmedAt, &b.ActivatedAt, &b.ActivatedSlot, &b.ClaimID,
		&b.RemindersSent, &failure, &b.RematchRequestID,
		&b.Attempts, &b.NextAttemptAt, &b.LastError, &b.CreatedAt, &b.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read advance booking: %w", err)
	}
	if err := json.Unmarshal(pickup, &b.Pickup); err != nil {
		return nil, fmt.Errorf("booking %s stores an unreadable pickup: %w", b.ID, err)
	}
	if err := json.Unmarshal(dropoff, &b.Dropoff); err != nil {
		return nil, fmt.Errorf("booking %s stores an unreadable dropoff: %w", b.ID, err)
	}
	if len(failure) > 0 && string(failure) != "null" {
		b.Failure = &BookingFailure{}
		if err := json.Unmarshal(failure, b.Failure); err != nil {
			return nil, fmt.Errorf("booking %s stores an unreadable failure: %w", b.ID, err)
		}
	}
	for _, at := range []*time.Time{&b.WindowStart, &b.WindowEnd, &b.OccupiedStart, &b.OccupiedEnd,
		&b.FundingDueAt, &b.FundingDeadline, &b.ReconfirmOpensAt, &b.ReconfirmDeadline,
		&b.ActivationAt, &b.ActivationDeadline} {
		*at = at.UTC()
	}
	return &b, nil
}

// errCalendarConflict marks a booking the calendar's exclusion constraints
// refused: the driver (or the vehicle) already holds an overlapping one.
var errCalendarConflict = errors.New("the driver's booking calendar already holds an overlapping booking")

// isCalendarExclusion reports whether an error is one of the calendar's
// exclusion constraints saying no.
func isCalendarExclusion(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23P01" &&
			(pgErr.ConstraintName == "advance_bookings_no_overlap" || pgErr.ConstraintName == "advance_bookings_vehicle_no_overlap")
	}
	return false
}

// InsertBooking writes a booking onto the calendar. The exclusion
// constraints are the final authority on overlap: a collision answers
// errCalendarConflict, whatever raced.
func (s *Store) InsertBooking(ctx context.Context, db DB, b *AdvanceBooking) error {
	pickup, err := json.Marshal(b.Pickup)
	if err != nil {
		return fmt.Errorf("unserialisable pickup: %w", err)
	}
	dropoff, err := json.Marshal(b.Dropoff)
	if err != nil {
		return fmt.Errorf("unserialisable dropoff: %w", err)
	}
	_, err = db.Exec(ctx, `
		INSERT INTO mp.advance_bookings (
			id, award_id, request_id, bid_id, driver_id, requester_id, vehicle_id, city_id,
			state, version, funding_state, payment_method_id, currency, fare_minor, commission_minor,
			window_start, window_end, trip_duration_sec, occupied, pickup, dropoff,
			funding_due_at, funding_deadline, reconfirm_opens_at, reconfirm_deadline,
			activation_at, activation_deadline, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
			tstzrange($19, $20, '[)'), $21,$22,$23,$24,$25,$26,$27,$28,$29,$29)`,
		b.ID, b.AwardID, b.RequestID, b.BidID, b.DriverID, b.RequesterID, b.VehicleID, b.CityID,
		b.State, b.Version, b.FundingState, b.PaymentMethodID, b.Currency, b.FareMinor, b.CommissionMinor,
		b.WindowStart, b.WindowEnd, b.TripDurationSec, b.OccupiedStart, b.OccupiedEnd, pickup, dropoff,
		b.FundingDueAt, b.FundingDeadline, b.ReconfirmOpensAt, b.ReconfirmDeadline,
		b.ActivationAt, b.ActivationDeadline, stampOf(b.CreatedAt),
	)
	if err != nil {
		if isCalendarExclusion(err) {
			return errCalendarConflict
		}
		return fmt.Errorf("failed to insert advance booking: %w", err)
	}
	return nil
}

// BookingByID reads one booking.
func (s *Store) BookingByID(ctx context.Context, db DB, id uuid.UUID) (*AdvanceBooking, error) {
	return scanBooking(db.QueryRow(ctx, `SELECT `+bookingColumns+` FROM mp.advance_bookings WHERE id = $1`, id))
}

// BookingForUpdate reads and locks one booking.
func (s *Store) BookingForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*AdvanceBooking, error) {
	return scanBooking(tx.QueryRow(ctx, `SELECT `+bookingColumns+` FROM mp.advance_bookings WHERE id = $1 FOR UPDATE`, id))
}

// BookingByAwardID reads the booking an advance award created.
func (s *Store) BookingByAwardID(ctx context.Context, db DB, awardID uuid.UUID) (*AdvanceBooking, error) {
	return scanBooking(db.QueryRow(ctx, `SELECT `+bookingColumns+` FROM mp.advance_bookings WHERE award_id = $1`, awardID))
}

func (s *Store) bookingList(ctx context.Context, db DB, query string, args ...any) ([]*AdvanceBooking, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list advance bookings: %w", err)
	}
	defer rows.Close()
	var out []*AdvanceBooking
	for rows.Next() {
		b, err := scanBooking(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// BookingsForDriver lists a driver's bookings whose window has not ended
// long ago, soonest first: the driver's calendar.
func (s *Store) BookingsForDriver(ctx context.Context, db DB, driverID uuid.UUID, since time.Time, limit int) ([]*AdvanceBooking, error) {
	return s.bookingList(ctx, db, `
		SELECT `+bookingColumns+` FROM mp.advance_bookings
		WHERE driver_id = $1 AND window_end >= $2
		ORDER BY window_start ASC
		LIMIT $3`, driverID, since, limit)
}

// BookingsForRequester lists a requester's bookings, soonest first.
func (s *Store) BookingsForRequester(ctx context.Context, db DB, requesterID uuid.UUID, since time.Time, limit int) ([]*AdvanceBooking, error) {
	return s.bookingList(ctx, db, `
		SELECT `+bookingColumns+` FROM mp.advance_bookings
		WHERE requester_id = $1 AND window_end >= $2
		ORDER BY window_start ASC
		LIMIT $3`, requesterID, since, limit)
}

// calendarNeighbours is the booking calendar around one interval: every
// committed booking that overlaps it, and the nearest committed booking
// wholly before and wholly after it.
type calendarNeighbours struct {
	overlapping []*AdvanceBooking
	previous    *AdvanceBooking
	next        *AdvanceBooking
}

// CalendarNeighbours reads a driver's committed bookings around [start, end).
func (s *Store) CalendarNeighbours(ctx context.Context, db DB, driverID uuid.UUID, start, end time.Time) (*calendarNeighbours, error) {
	occupying := machine.MpBookingOccupyingStates()
	overlapping, err := s.bookingList(ctx, db, `
		SELECT `+bookingColumns+` FROM mp.advance_bookings
		WHERE driver_id = $1 AND state = ANY($2) AND occupied && tstzrange($3, $4, '[)')
		ORDER BY window_start ASC`, driverID, occupying, start, end)
	if err != nil {
		return nil, err
	}
	out := &calendarNeighbours{overlapping: overlapping}
	previous, err := scanBooking(db.QueryRow(ctx, `
		SELECT `+bookingColumns+` FROM mp.advance_bookings
		WHERE driver_id = $1 AND state = ANY($2) AND upper(occupied) <= $3
		ORDER BY upper(occupied) DESC LIMIT 1`, driverID, occupying, start))
	if err == nil {
		out.previous = previous
	} else if !errors.Is(err, domain.ErrNotFound) {
		return nil, err
	}
	next, err := scanBooking(db.QueryRow(ctx, `
		SELECT `+bookingColumns+` FROM mp.advance_bookings
		WHERE driver_id = $1 AND state = ANY($2) AND lower(occupied) >= $3
		ORDER BY lower(occupied) ASC LIMIT 1`, driverID, occupying, end))
	if err == nil {
		out.next = next
	} else if !errors.Is(err, domain.ErrNotFound) {
		return nil, err
	}
	return out, nil
}

// BookingUpdate carries the columns a booking transition may change.
type BookingUpdate struct {
	FundingState         *string
	ReconfirmRequestedAt *time.Time
	ReconfirmedAt        *time.Time
	ActivatedAt          *time.Time
	ActivatedSlot        *string
	ClaimID              *uuid.UUID
	Failure              *BookingFailure
	RematchRequestID     *uuid.UUID
	ClearNextTry         bool
}

// TransitionBooking moves a booking, refusing anything the mpAdvanceBooking
// machine does not allow, under the optimistic version. A to-state equal to
// the current state is a field-only update (no machine edge needed).
func (s *Store) TransitionBooking(ctx context.Context, tx pgx.Tx, b *AdvanceBooking, to string, update BookingUpdate) (*AdvanceBooking, error) {
	if to != b.State {
		if err := machine.Assert(machine.MpAdvanceBooking, b.State, to); err != nil {
			allowed, _ := machine.Allowed(machine.MpAdvanceBooking, b.State)
			return nil, domain.Errorf(domain.CodeIllegalTransition, "a booking cannot move from %s to %s", b.State, to).
				WithDetails(map[string]any{"from": b.State, "to": to, "allowed": allowed}).
				Wrap(err)
		}
	}
	var failure []byte
	if update.Failure != nil {
		encoded, err := json.Marshal(update.Failure)
		if err != nil {
			return nil, fmt.Errorf("unserialisable booking failure: %w", err)
		}
		failure = encoded
	}
	row := tx.QueryRow(ctx, `
		UPDATE mp.advance_bookings SET
			state = $3,
			version = version + 1,
			funding_state = COALESCE($4, funding_state),
			reconfirm_requested_at = COALESCE($5, reconfirm_requested_at),
			reconfirmed_at = COALESCE($6, reconfirmed_at),
			activated_at = COALESCE($7, activated_at),
			activated_slot = COALESCE($8, activated_slot),
			claim_id = COALESCE($9, claim_id),
			failure = COALESCE($10::jsonb, failure),
			rematch_request_id = COALESCE($11, rematch_request_id),
			next_attempt_at = CASE WHEN $12 THEN NULL ELSE next_attempt_at END,
			attempts = CASE WHEN $12 THEN 0 ELSE attempts END,
			updated_at = now()
		WHERE id = $1 AND version = $2
		RETURNING `+bookingColumns,
		b.ID, b.Version, to,
		update.FundingState, update.ReconfirmRequestedAt, update.ReconfirmedAt,
		update.ActivatedAt, update.ActivatedSlot, update.ClaimID, failure, update.RematchRequestID,
		update.ClearNextTry,
	)
	updated, err := scanBooking(row)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the booking changed while this call was in flight").
			WithDetails(map[string]any{"bookingId": b.ID.String(), "expectedVersion": b.Version})
	}
	return updated, err
}

// SetBookingFundingState records the funding decision the award saga took
// for an advance award (idempotent; no state change).
func (s *Store) SetBookingFundingState(ctx context.Context, db DB, bookingID uuid.UUID, state string) error {
	_, err := db.Exec(ctx, `
		UPDATE mp.advance_bookings SET funding_state = $2, updated_at = now() WHERE id = $1`, bookingID, state)
	if err != nil {
		return fmt.Errorf("failed to record the booking funding state: %w", err)
	}
	return nil
}

// DeferBooking records a failed worker attempt and when to retry.
func (s *Store) DeferBooking(ctx context.Context, db DB, id uuid.UUID, lastError string, retryAt time.Time) error {
	_, err := db.Exec(ctx, `
		UPDATE mp.advance_bookings
		SET attempts = attempts + 1, last_error = $2, next_attempt_at = $3, updated_at = now()
		WHERE id = $1`, id, lastError, retryAt)
	if err != nil {
		return fmt.Errorf("failed to defer the booking: %w", err)
	}
	return nil
}

// MarkBookingReminder records a reminder offset as sent; it reports whether
// THIS call recorded it.
func (s *Store) MarkBookingReminder(ctx context.Context, tx pgx.Tx, id uuid.UUID, offsetSec int) (bool, error) {
	tag, err := tx.Exec(ctx, `
		UPDATE mp.advance_bookings
		SET reminders_sent = array_append(reminders_sent, $2::integer), updated_at = now()
		WHERE id = $1 AND NOT ($2::integer = ANY(reminders_sent))`, id, offsetSec)
	if err != nil {
		return false, fmt.Errorf("failed to record the reminder: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// BookingsInStates lists bookings in the given states whose `column` (a
// fixed timestamp column name from this file, never input) is at or before
// `due`. With respectRetry, rows whose deferred retry is not due yet (as of
// `now`) are skipped.
func (s *Store) BookingsInStates(ctx context.Context, db DB, states []string, column string, due, now time.Time, respectRetry bool, limit int) ([]*AdvanceBooking, error) {
	switch column {
	case "funding_due_at", "funding_deadline", "reconfirm_opens_at", "reconfirm_deadline",
		"activation_at", "activation_deadline", "window_start":
	default:
		return nil, fmt.Errorf("unknown booking deadline column %q", column)
	}
	return s.bookingList(ctx, db, `
		SELECT `+bookingColumns+` FROM mp.advance_bookings
		WHERE state = ANY($1) AND `+column+` <= $2
			AND (NOT $4 OR next_attempt_at IS NULL OR next_attempt_at <= $5)
		ORDER BY `+column+` ASC
		LIMIT $3`, states, due, limit, respectRetry, now)
}

// BookingsForReminders lists live bookings whose window starts in (now,
// horizon], one keyset page at a time after (afterStart, afterID) in
// (window_start, id) order — the reminder pass walks every page, so a busy
// calendar never delays a later booking's reminder.
func (s *Store) BookingsForReminders(ctx context.Context, db DB, states []string, now, horizon, afterStart time.Time, afterID uuid.UUID, limit int) ([]*AdvanceBooking, error) {
	return s.bookingList(ctx, db, `
		SELECT `+bookingColumns+` FROM mp.advance_bookings
		WHERE state = ANY($1) AND window_start > $2 AND window_start <= $3
			AND (window_start, id) > ($4, $5)
		ORDER BY window_start ASC, id ASC
		LIMIT $6`, states, now, horizon, afterStart, afterID, limit)
}

// BookingsAwaitingReconfirmRequest lists confirmed bookings whose
// reconfirmation window is open and whose driver has NOT been asked yet.
// Filtering the asked ones out in SQL keeps a backlog of bookings awaiting
// their drivers' answers from starving later ones of their request.
func (s *Store) BookingsAwaitingReconfirmRequest(ctx context.Context, db DB, now time.Time, limit int) ([]*AdvanceBooking, error) {
	return s.bookingList(ctx, db, `
		SELECT `+bookingColumns+` FROM mp.advance_bookings
		WHERE state = $1 AND reconfirm_opens_at <= $2 AND reconfirm_deadline > $2
			AND reconfirm_requested_at IS NULL
		ORDER BY reconfirm_opens_at ASC
		LIMIT $3`, machine.MpBookingConfirmed, now, limit)
}

// LiveAdvanceBidsForDriver lists a driver's live advance bids on other
// requests (with each request's window) — the offers a new booking may make
// impossible.
func (s *Store) LiveAdvanceBidsForDriver(ctx context.Context, db DB, driverID, excludeRequest uuid.UUID) ([]*Bid, error) {
	return s.bidList(ctx, db, `
		SELECT `+bidColumns+` FROM mp.bids
		WHERE driver_id = $1 AND slot = $2 AND request_id <> $3 AND state = ANY($4)
		ORDER BY created_at ASC`, driverID, SlotAdvance, excludeRequest, machine.MpBidLiveStates())
}

// OpenAdvanceRequestCount counts a requester's advance requests still taking
// offers or resolving an award.
func (s *Store) OpenAdvanceRequestCount(ctx context.Context, db DB, requesterID uuid.UUID) (int, error) {
	var count int
	err := db.QueryRow(ctx, `
		SELECT COUNT(*) FROM mp.requests
		WHERE requester_id = $1 AND booking_kind = $2 AND state = ANY($3)`,
		requesterID, BookingKindAdvance, []string{machine.MpRequestOpen, machine.MpRequestAwardPending}).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count open advance requests: %w", err)
	}
	return count, nil
}

// ---------------------------------------------------------------------------
// Recurring templates
// ---------------------------------------------------------------------------

// RecurringTemplate is one mp.recurring_templates row: the series, stored
// apart from its occurrences (mp.scheduled_requests).
type RecurringTemplate struct {
	ID                uuid.UUID
	RequesterID       uuid.UUID
	CityID            string
	Product           string
	Service           string
	VehicleClass      string
	Currency          string
	State             string
	Version           int
	Pickup            Area
	Dropoff           Area
	Stops             []RouteStop
	PaymentMethodID   string
	RequestedMinor    int64
	MaxFareMinor      int64
	DaysOfWeek        []string
	LocalTime         string
	TimeZone          string
	WindowSec         int
	DSTDisambiguation string
	StartsOn          string
	EndsOn            *string
	GeneratedThrough  *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

const templateColumns = `
	id, requester_id, city_id, product, service, vehicle_class, currency, state, version,
	pickup, dropoff, stops, payment_method_id, requested_minor, max_fare_minor,
	days_of_week, local_time, time_zone, window_sec, dst_disambiguation,
	starts_on::text, ends_on::text, generated_through::text, created_at, updated_at`

func scanTemplate(row pgx.Row) (*RecurringTemplate, error) {
	var t RecurringTemplate
	var pickup, dropoff, stops []byte
	err := row.Scan(
		&t.ID, &t.RequesterID, &t.CityID, &t.Product, &t.Service, &t.VehicleClass, &t.Currency, &t.State, &t.Version,
		&pickup, &dropoff, &stops, &t.PaymentMethodID, &t.RequestedMinor, &t.MaxFareMinor,
		&t.DaysOfWeek, &t.LocalTime, &t.TimeZone, &t.WindowSec, &t.DSTDisambiguation,
		&t.StartsOn, &t.EndsOn, &t.GeneratedThrough, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read recurring template: %w", err)
	}
	if err := json.Unmarshal(pickup, &t.Pickup); err != nil {
		return nil, fmt.Errorf("template %s stores an unreadable pickup: %w", t.ID, err)
	}
	if err := json.Unmarshal(dropoff, &t.Dropoff); err != nil {
		return nil, fmt.Errorf("template %s stores an unreadable dropoff: %w", t.ID, err)
	}
	if t.Stops, err = decodeStops(stops); err != nil {
		return nil, fmt.Errorf("template %s stores unreadable stops: %w", t.ID, err)
	}
	return &t, nil
}

// InsertTemplate writes a new series.
func (s *Store) InsertTemplate(ctx context.Context, db DB, t *RecurringTemplate) error {
	pickup, err := json.Marshal(t.Pickup)
	if err != nil {
		return fmt.Errorf("unserialisable pickup: %w", err)
	}
	dropoff, err := json.Marshal(t.Dropoff)
	if err != nil {
		return fmt.Errorf("unserialisable dropoff: %w", err)
	}
	stops, err := encodeStops(t.Stops)
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, `
		INSERT INTO mp.recurring_templates (
			id, requester_id, city_id, product, service, vehicle_class, currency, state, version,
			pickup, dropoff, stops, payment_method_id, requested_minor, max_fare_minor,
			days_of_week, local_time, time_zone, window_sec, dst_disambiguation, starts_on, ends_on,
			created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::date,$22::date,$23,$23)`,
		t.ID, t.RequesterID, t.CityID, t.Product, t.Service, t.VehicleClass, t.Currency, t.State, t.Version,
		pickup, dropoff, stops, t.PaymentMethodID, t.RequestedMinor, t.MaxFareMinor,
		t.DaysOfWeek, t.LocalTime, t.TimeZone, t.WindowSec, t.DSTDisambiguation, t.StartsOn, t.EndsOn,
		stampOf(t.CreatedAt),
	)
	if err != nil {
		return fmt.Errorf("failed to insert recurring template: %w", err)
	}
	return nil
}

// TemplateByID reads one series.
func (s *Store) TemplateByID(ctx context.Context, db DB, id uuid.UUID) (*RecurringTemplate, error) {
	return scanTemplate(db.QueryRow(ctx, `SELECT `+templateColumns+` FROM mp.recurring_templates WHERE id = $1`, id))
}

// TemplateForUpdate reads and locks one series.
func (s *Store) TemplateForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*RecurringTemplate, error) {
	return scanTemplate(tx.QueryRow(ctx, `SELECT `+templateColumns+` FROM mp.recurring_templates WHERE id = $1 FOR UPDATE`, id))
}

func (s *Store) templateList(ctx context.Context, db DB, query string, args ...any) ([]*RecurringTemplate, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list recurring templates: %w", err)
	}
	defer rows.Close()
	var out []*RecurringTemplate
	for rows.Next() {
		t, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// TemplatesForRequester lists a requester's series, newest first.
func (s *Store) TemplatesForRequester(ctx context.Context, db DB, requesterID uuid.UUID, limit int) ([]*RecurringTemplate, error) {
	return s.templateList(ctx, db, `
		SELECT `+templateColumns+` FROM mp.recurring_templates
		WHERE requester_id = $1 ORDER BY created_at DESC LIMIT $2`, requesterID, limit)
}

// ActiveTemplateCount counts a requester's live (active or paused) series.
func (s *Store) ActiveTemplateCount(ctx context.Context, db DB, requesterID uuid.UUID) (int, error) {
	var count int
	err := db.QueryRow(ctx, `
		SELECT COUNT(*) FROM mp.recurring_templates WHERE requester_id = $1 AND state = ANY($2)`,
		requesterID, []string{machine.MpTemplateActive, machine.MpTemplatePaused}).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count recurring templates: %w", err)
	}
	return count, nil
}

// ActiveTemplatesAfter lists active series for the generation pass in id
// order after a cursor: the pass walks every series round-robin, a batch per
// tick. (Ordering by the generation watermark instead would let a batch of
// series that cannot advance — their market's flag off, their policy
// missing — hold the front of the queue for ever and starve every other
// series of its occurrences.)
func (s *Store) ActiveTemplatesAfter(ctx context.Context, db DB, after uuid.UUID, limit int) ([]*RecurringTemplate, error) {
	return s.templateList(ctx, db, `
		SELECT `+templateColumns+` FROM mp.recurring_templates
		WHERE state = $1 AND id > $2
		ORDER BY id ASC
		LIMIT $3`, machine.MpTemplateActive, after, limit)
}

// TransitionTemplate moves a series, refusing anything the
// mpRecurringTemplate machine does not allow, under the optimistic version.
func (s *Store) TransitionTemplate(ctx context.Context, tx pgx.Tx, t *RecurringTemplate, to string) (*RecurringTemplate, error) {
	if err := machine.Assert(machine.MpRecurringTemplate, t.State, to); err != nil {
		allowed, _ := machine.Allowed(machine.MpRecurringTemplate, t.State)
		return nil, domain.Errorf(domain.CodeIllegalTransition, "a series cannot move from %s to %s", t.State, to).
			WithDetails(map[string]any{"from": t.State, "to": to, "allowed": allowed}).
			Wrap(err)
	}
	updated, err := scanTemplate(tx.QueryRow(ctx, `
		UPDATE mp.recurring_templates SET state = $3, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $2
		RETURNING `+templateColumns, t.ID, t.Version, to))
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the series changed while this call was in flight").
			WithDetails(map[string]any{"templateId": t.ID.String(), "expectedVersion": t.Version})
	}
	return updated, err
}

// AdvanceGeneratedThrough moves a series' generation watermark forward only
// (a replayed or concurrent pass can never move it back).
func (s *Store) AdvanceGeneratedThrough(ctx context.Context, db DB, id uuid.UUID, through string) error {
	_, err := db.Exec(ctx, `
		UPDATE mp.recurring_templates
		SET generated_through = GREATEST(COALESCE(generated_through, $2::date), $2::date), updated_at = now()
		WHERE id = $1`, id, through)
	if err != nil {
		return fmt.Errorf("failed to advance the generation watermark: %w", err)
	}
	return nil
}
