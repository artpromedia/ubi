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

// Preferred-driver requests (A04 item 3) — the mpPreferredWindow machine.
//
// A rider may name a driver they saved after a completed trip, provided that
// driver opted in to preferred requests. The request is then an ordinary
// open request with ONE difference while its window is exclusive: only the
// named driver may discover it or offer on it. Offering goes through the
// ordinary funded-bid path (CreateBid) — the same stored fare bounds,
// stationary eligibility, wallet-held 10% reservation and single capture at
// the rider's selection — so nothing is waived and nothing is assigned: the
// driver may offer at their own price, or decline, or let the window pass.
//
// When the window ends (or the driver declines) with no live offer from
// them, the rider's choice AT REQUEST TIME decides: with explicit fallback
// consent the request opens to every eligible driver and gets the market's
// full request lifetime from that moment; without it the request expires,
// free, with closeReason preferred_driver_unavailable. The rider is never
// told whether the driver declined or simply did not answer, and neither a
// decline nor a lapse is recorded against the driver anywhere — standing and
// reliability only ever count awarded rides.

const (
	scopePreferredDecline = "mp.preferred.decline"

	// CloseReasonPreferredUnavailable closes a preferred request whose rider
	// did not consent to open-market fallback.
	CloseReasonPreferredUnavailable = "preferred_driver_unavailable"

	// Why a window was resolved (internal; the rider sees one reason).
	preferredResolutionLapsed   = "window_lapsed"
	preferredResolutionDeclined = "declined"
)

// PreferredDriverInput is the optional preferredDriver object of POST
// /v1/mp/requests (MpPreferredDriverInputSchema). FallbackToMarket is
// required: the rider must say, explicitly, whether the request may open to
// every driver if the named one does not offer.
type PreferredDriverInput struct {
	DriverID         uuid.UUID `json:"driverId"`
	FallbackToMarket *bool     `json:"fallbackToMarket"`
}

// PreferredRequest is one mp.preferred_requests row.
type PreferredRequest struct {
	RequestID        uuid.UUID
	DriverID         uuid.UUID
	RequesterID      uuid.UUID
	CityID           string
	State            string
	FallbackToMarket bool
	WindowSec        int
	WindowEndsAt     time.Time
	DeclinedAt       *time.Time
	ResolvedAt       *time.Time
	Resolution       string
	Version          int
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// excludes reports whether the window keeps the request to its named driver
// and the asking driver is someone else.
func (p *PreferredRequest) excludes(driverID uuid.UUID) bool {
	return p != nil && p.State == machine.MpPreferredExclusive && p.DriverID != driverID
}

// invites reports whether the request is exclusively this driver's to answer.
func (p *PreferredRequest) invites(driverID uuid.UUID) bool {
	return p != nil && p.State == machine.MpPreferredExclusive && p.DriverID == driverID
}

// preferredPlan is a validated preferred-driver input.
type preferredPlan struct {
	driverID  uuid.UUID
	fallback  bool
	windowSec int
}

// PreferredDriverView is the requester's view of the window (on RequestView).
type PreferredDriverView struct {
	DriverID         string    `json:"driverId"`
	State            string    `json:"state"`
	WindowSec        int       `json:"windowSec"`
	WindowEndsAt     time.Time `json:"windowEndsAt"`
	FallbackToMarket bool      `json:"fallbackToMarket"`
	Label            string    `json:"label"`
}

// PreferredInvitationView is the named driver's view of the invitation (on a
// feed card and the driver view). It never identifies the rider.
type PreferredInvitationView struct {
	WindowEndsAt time.Time `json:"windowEndsAt"`
	Label        string    `json:"label"`
	Note         string    `json:"note"`
	CanDecline   bool      `json:"canDecline"`
}

// PreferredDeclineView answers POST /v1/mp/requests/{id}/preferred/decline.
type PreferredDeclineView struct {
	RequestID  string    `json:"requestId"`
	Declined   bool      `json:"declined"`
	DeclinedAt time.Time `json:"declinedAt"`
	Note       string    `json:"note"`
}

const (
	preferredInvitationLabel = "A rider you drove before asked you first"
	preferredInvitationNote  = "Offer at your own price or decline. Declining or letting this pass is free and never affects your standing."
	preferredDeclineNote     = "Declined. This is free: it does not affect your standing, your reliability or the requests you see."
)

func preferredDriverViewOf(p *PreferredRequest) *PreferredDriverView {
	if p == nil {
		return nil
	}
	view := &PreferredDriverView{
		DriverID:         p.DriverID.String(),
		State:            p.State,
		WindowSec:        p.WindowSec,
		WindowEndsAt:     p.WindowEndsAt,
		FallbackToMarket: p.FallbackToMarket,
	}
	minutes := itoa(ceilMinutes(p.WindowSec))
	switch {
	case p.State == machine.MpPreferredExclusive && p.FallbackToMarket:
		view.Label = "Your saved driver has up to " + minutes + " min to offer. If they don't, the request opens to every driver."
	case p.State == machine.MpPreferredExclusive:
		view.Label = "Your saved driver has up to " + minutes + " min to offer. If they don't, the request closes and nothing is charged."
	case p.State == machine.MpPreferredMarketOpen:
		view.Label = "Your saved driver could not take this trip. The request is now open to every driver."
	default:
		view.Label = "Your saved driver could not take this trip. The request closed and nothing was charged."
	}
	return view
}

func preferredInvitationOf(p *PreferredRequest) *PreferredInvitationView {
	return &PreferredInvitationView{
		WindowEndsAt: p.WindowEndsAt,
		Label:        preferredInvitationLabel,
		Note:         preferredInvitationNote,
		CanDecline:   true,
	}
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const preferredColumns = `
	request_id, driver_id, requester_id, city_id, state, fallback_to_market,
	window_sec, window_ends_at, declined_at, resolved_at, COALESCE(resolution, ''),
	version, created_at, updated_at`

func scanPreferred(row pgx.Row) (*PreferredRequest, error) {
	var p PreferredRequest
	err := row.Scan(&p.RequestID, &p.DriverID, &p.RequesterID, &p.CityID, &p.State, &p.FallbackToMarket,
		&p.WindowSec, &p.WindowEndsAt, &p.DeclinedAt, &p.ResolvedAt, &p.Resolution,
		&p.Version, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read a preferred-driver window: %w", err)
	}
	return &p, nil
}

// InsertPreferredRequest opens a request's exclusive window.
func (s *Store) InsertPreferredRequest(ctx context.Context, tx pgx.Tx, p *PreferredRequest) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO mp.preferred_requests (
			request_id, driver_id, requester_id, city_id, state, fallback_to_market,
			window_sec, window_ends_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		p.RequestID, p.DriverID, p.RequesterID, p.CityID, machine.MpPreferredExclusive, p.FallbackToMarket,
		p.WindowSec, p.WindowEndsAt); err != nil {
		return fmt.Errorf("failed to open the preferred-driver window: %w", err)
	}
	return nil
}

// PreferredForRequest reads one request's window (domain.ErrNotFound: none).
func (s *Store) PreferredForRequest(ctx context.Context, db DB, requestID uuid.UUID) (*PreferredRequest, error) {
	return scanPreferred(db.QueryRow(ctx, `SELECT `+preferredColumns+` FROM mp.preferred_requests WHERE request_id = $1`, requestID))
}

// PreferredForUpdate reads and locks one request's window. Callers lock the
// request row first, the same order every writer of either row uses.
func (s *Store) PreferredForUpdate(ctx context.Context, tx pgx.Tx, requestID uuid.UUID) (*PreferredRequest, error) {
	return scanPreferred(tx.QueryRow(ctx, `SELECT `+preferredColumns+` FROM mp.preferred_requests WHERE request_id = $1 FOR UPDATE`, requestID))
}

// PreferredForRequests reads the windows of a set of requests.
func (s *Store) PreferredForRequests(ctx context.Context, db DB, requestIDs []uuid.UUID) (map[uuid.UUID]*PreferredRequest, error) {
	out := map[uuid.UUID]*PreferredRequest{}
	if len(requestIDs) == 0 {
		return out, nil
	}
	rows, err := db.Query(ctx, `SELECT `+preferredColumns+` FROM mp.preferred_requests WHERE request_id = ANY($1)`, requestIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to read preferred-driver windows: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		p, err := scanPreferred(rows)
		if err != nil {
			return nil, err
		}
		out[p.RequestID] = p
	}
	return out, rows.Err()
}

// TransitionPreferred moves a window along the mpPreferredWindow machine
// under its optimistic version.
func (s *Store) TransitionPreferred(ctx context.Context, tx pgx.Tx, p *PreferredRequest, to, resolution string, declinedAt *time.Time, at time.Time) (*PreferredRequest, error) {
	if err := machine.Assert(machine.MpPreferredWindow, p.State, to); err != nil {
		return nil, domain.Errorf(domain.CodeIllegalTransition, "a preferred-driver window cannot move from %s to %s", p.State, to).Wrap(err)
	}
	moved, err := scanPreferred(tx.QueryRow(ctx, `
		UPDATE mp.preferred_requests SET
			state = $3, resolution = $4, resolved_at = $5,
			declined_at = COALESCE($6, declined_at),
			version = version + 1, updated_at = now()
		WHERE request_id = $1 AND version = $2
		RETURNING `+preferredColumns,
		p.RequestID, p.Version, to, resolution, at, declinedAt))
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeVersionConflict, "the preferred-driver window changed while this call was in flight")
	}
	return moved, err
}

// duePreferredWindows lists exclusive windows past their end whose request
// is still open.
func (s *Store) duePreferredWindows(ctx context.Context, db DB, now time.Time, limit int) ([]*PreferredRequest, error) {
	rows, err := db.Query(ctx, `
		SELECT `+prefixedPreferredColumns+`
		FROM mp.preferred_requests p
		JOIN mp.requests r ON r.id = p.request_id
		WHERE p.state = $1 AND p.window_ends_at <= $2 AND r.state = $3
		ORDER BY p.window_ends_at ASC
		LIMIT $4`, machine.MpPreferredExclusive, now, machine.MpRequestOpen, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list due preferred-driver windows: %w", err)
	}
	defer rows.Close()
	var out []*PreferredRequest
	for rows.Next() {
		p, err := scanPreferred(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

const prefixedPreferredColumns = `
	p.request_id, p.driver_id, p.requester_id, p.city_id, p.state, p.fallback_to_market,
	p.window_sec, p.window_ends_at, p.declined_at, p.resolved_at, COALESCE(p.resolution, ''),
	p.version, p.created_at, p.updated_at`

// ---------------------------------------------------------------------------
// Publishing a preferred request
// ---------------------------------------------------------------------------

// validatePreferredDriver is Publish's gate for a named driver: the
// capability is on, the rider says explicitly what happens if the driver
// does not offer, and the driver is one the rider saved after a completed
// trip and who takes preferred requests. Why a saved driver cannot be named
// (opted out, or not currently taking marketplace work) is not disclosed.
func (s *Service) validatePreferredDriver(ctx context.Context, actor Actor, quote *Quote, policy *cityconfig.MarketplacePolicy, input *PreferredDriverInput) (*preferredPlan, error) {
	if input == nil {
		return nil, nil
	}
	if err := s.requireFlag(ctx, cityconfig.FlagMarketplacePreferredDrivers, actor, quote.CityID); err != nil {
		return nil, err
	}
	if quote.Service != ServiceRide {
		return nil, domain.Errorf(domain.CodeValidationFailed, "a preferred driver can be named on rides only").
			WithDetails(map[string]any{"field": "preferredDriver"})
	}
	if input.DriverID == uuid.Nil {
		return nil, domain.Errorf(domain.CodeValidationFailed, "preferredDriver.driverId is required").
			WithDetails(map[string]any{"field": "preferredDriver.driverId"})
	}
	if input.FallbackToMarket == nil {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"preferredDriver.fallbackToMarket is required: say whether every driver may offer if this driver does not").
			WithDetails(map[string]any{"field": "preferredDriver.fallbackToMarket"})
	}
	if input.DriverID == actor.UserID {
		return nil, domain.Errorf(domain.CodeValidationFailed, "you cannot name yourself as the driver").
			WithDetails(map[string]any{"field": "preferredDriver.driverId"})
	}
	if _, err := s.deps.Store.ActiveFavourite(ctx, s.deps.Store.Pool(), actor.UserID, input.DriverID); errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"you can only ask a driver you saved after a completed trip").
			WithDetails(map[string]any{"field": "preferredDriver.driverId", "reason": "not_a_saved_driver"})
	} else if err != nil {
		return nil, asDomainError(err)
	}
	takes, err := s.driverTakesPreferredRequests(ctx, input.DriverID, quote.CityID)
	if err != nil {
		return nil, asDomainError(err)
	}
	if !takes {
		return nil, domain.Errorf(domain.CodeConflict,
			"this driver is not taking preferred requests right now; publish to every driver or choose another saved driver").
			WithDetails(map[string]any{"reason": CloseReasonPreferredUnavailable})
	}
	return &preferredPlan{
		driverID:  input.DriverID,
		fallback:  *input.FallbackToMarket,
		windowSec: policy.PreferredDriverPolicy().ExclusiveWindowSec,
	}, nil
}

// writePreferredWindow opens the exclusive window inside the publishing
// transaction and invites the named driver (the event's audience is that
// driver alone; the rider is not identified to them).
func (s *Service) writePreferredWindow(ctx context.Context, tx pgx.Tx, request *Request, actor Actor, plan *preferredPlan, now time.Time) (*PreferredRequest, error) {
	window := &PreferredRequest{
		RequestID:        request.ID,
		DriverID:         plan.driverID,
		RequesterID:      request.RequesterID,
		CityID:           request.CityID,
		State:            machine.MpPreferredExclusive,
		FallbackToMarket: plan.fallback,
		WindowSec:        plan.windowSec,
		WindowEndsAt:     now.Add(time.Duration(plan.windowSec) * time.Second),
		Version:          1,
	}
	if err := s.deps.Store.InsertPreferredRequest(ctx, tx, window); err != nil {
		return nil, err
	}
	if err := writeEvent(ctx, tx, Event{
		Name:           "mp.request.preferred_driver_invited",
		AggregateType:  subjectRequest,
		AggregateID:    request.ID.String(),
		ToVersion:      request.Version,
		CityID:         request.CityID,
		ActorType:      "rider",
		ActorID:        actor.UserID.String(),
		IdempotencyKey: eventKey("mp.request.preferred_driver_invited", request.ID.String()),
		OccurredAt:     now,
		Payload: map[string]any{
			"requestId":    request.ID.String(),
			"driverId":     plan.driverID.String(),
			"service":      request.Service,
			"vehicleClass": request.VehicleClass,
			"windowSec":    plan.windowSec,
			"windowEndsAt": window.WindowEndsAt.Format(time.RFC3339),
		},
	}); err != nil {
		return nil, err
	}
	if err := writeAudit(ctx, tx, AuditRecord{
		ActorID:     actor.UserID.String(),
		ActorRole:   actor.Role,
		Action:      "mp.request.preferred_driver_invited",
		SubjectType: subjectRequest,
		SubjectID:   request.ID.String(),
		After: map[string]any{
			"driverId":         plan.driverID.String(),
			"fallbackToMarket": plan.fallback,
			"windowSec":        plan.windowSec,
			"windowEndsAt":     window.WindowEndsAt.Format(time.RFC3339),
		},
		Reason: "requester asked a saved driver first",
	}); err != nil {
		return nil, err
	}
	return window, nil
}

// writeServiceNeeds records a request's stated needs with its audit row.
func (s *Service) writeServiceNeeds(ctx context.Context, tx pgx.Tx, request *Request, actor Actor, needs *ServiceNeeds) error {
	if err := s.deps.Store.InsertRequestServiceNeeds(ctx, tx, request.ID, needs); err != nil {
		return err
	}
	return writeAudit(ctx, tx, AuditRecord{
		ActorID:     actor.UserID.String(),
		ActorRole:   actor.Role,
		Action:      "mp.request.service_needs_recorded",
		SubjectType: subjectRequest,
		SubjectID:   request.ID.String(),
		After:       map[string]any{"requirements": needs.Requirements, "preferences": needs.Preferences},
		Reason:      "requester stated service needs",
	})
}

// attachRequestConfidence adds the owner-only preferred-driver window and
// stated needs to a request view. A read failure leaves them off; nothing is
// guessed.
func (s *Service) attachRequestConfidence(ctx context.Context, view *RequestView, request *Request, needs *ServiceNeeds) {
	if window, err := s.deps.Store.PreferredForRequest(ctx, s.deps.Store.Pool(), request.ID); err == nil {
		view.PreferredDriver = preferredDriverViewOf(window)
	} else if !errors.Is(err, domain.ErrNotFound) {
		s.deps.Logger.Warn().Err(err).Str("request_id", request.ID.String()).Msg("preferred-driver window unreadable for a request view")
	}
	if !needs.empty() {
		view.ServiceNeeds = needs
	}
}

// ---------------------------------------------------------------------------
// Who may discover and offer
// ---------------------------------------------------------------------------

// marketExcludes reports whether an exclusive preferred window keeps this
// driver away from the request. Unreadable windows exclude (fail closed).
func (s *Service) marketExcludes(ctx context.Context, db DB, request *Request, driverID uuid.UUID) (bool, *PreferredRequest, error) {
	window, err := s.deps.Store.PreferredForRequest(ctx, db, request.ID)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil, nil
	}
	if err != nil {
		return true, nil, err
	}
	return window.excludes(driverID), window, nil
}

// ---------------------------------------------------------------------------
// Declining, and the window ending
// ---------------------------------------------------------------------------

// DeclinePreferred answers POST /v1/mp/requests/{id}/preferred/decline: the
// named driver declines, free. Always allowed while the invitation stands
// (whatever the flag says), and never recorded against the driver.
func (s *Service) DeclinePreferred(ctx context.Context, actor Actor, requestID uuid.UUID, idempotencyKey string) (*PreferredDeclineView, int, error) {
	if !actor.IsDriver() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only the invited driver can decline")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	body := map[string]any{"requestId": requestID.String()}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopePreferredDecline, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view PreferredDeclineView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}
	notInvited := domain.Errorf(domain.CodeNotFound, "that request does not exist")
	window, err := s.deps.Store.PreferredForRequest(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && window.DriverID != actor.UserID) {
		return nil, 0, notInvited
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	_, policy, err := s.policy(ctx, request.CityID)
	if err != nil {
		return nil, 0, err
	}

	now := s.now()
	var view *PreferredDeclineView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.RequestForUpdate(ctx, tx, requestID)
		if err != nil {
			return err
		}
		current, err := s.deps.Store.PreferredForUpdate(ctx, tx, requestID)
		if err != nil {
			return err
		}
		if current.State != machine.MpPreferredExclusive || locked.State != machine.MpRequestOpen {
			return domain.Errorf(domain.CodeConflict, "this invitation is no longer open").
				WithDetails(map[string]any{"state": current.State, "requestState": locked.State})
		}
		if _, err := s.deps.Store.LiveBidForDriverOnRequest(ctx, tx, requestID, actor.UserID); err == nil {
			return domain.Errorf(domain.CodeConflict, "you have a live offer on this request; withdraw it to decline").
				WithDetails(map[string]any{"reason": "live_offer"})
		} else if !errors.Is(err, domain.ErrNotFound) {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.request.preferred_driver_declined",
			AggregateType:  subjectRequest,
			AggregateID:    requestID.String(),
			ToVersion:      locked.Version,
			CityID:         locked.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: eventKey("mp.request.preferred_driver_declined", requestID.String()),
			OccurredAt:     now,
			Payload: map[string]any{
				"requestId": requestID.String(),
				"driverId":  actor.UserID.String(),
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.request.preferred_driver_declined",
			SubjectType: subjectRequest,
			SubjectID:   requestID.String(),
			After:       map[string]any{"declined": true},
			Reason:      "invited driver declined a preferred request (free, not recorded against standing)",
		}); err != nil {
			return err
		}
		declinedAt := now
		if err := s.resolvePreferredWindow(ctx, tx, locked, current, policy, preferredResolutionDeclined, &declinedAt, now); err != nil {
			return err
		}
		view = &PreferredDeclineView{RequestID: requestID.String(), Declined: true, DeclinedAt: now, Note: preferredDeclineNote}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopePreferredDecline, actor.UserID, idempotencyKey, body, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, 200, nil
}

// resolvePreferredWindow ends an exclusive window inside the caller's
// transaction (request and window rows locked, request open, no live offer
// from the named driver): open to the market with the rider's consent,
// otherwise close the request free.
func (s *Service) resolvePreferredWindow(ctx context.Context, tx pgx.Tx, request *Request, window *PreferredRequest,
	policy *cityconfig.MarketplacePolicy, resolution string, declinedAt *time.Time, now time.Time) error {
	fromVersion := request.Version
	if window.FallbackToMarket {
		if _, err := s.deps.Store.TransitionPreferred(ctx, tx, window, machine.MpPreferredMarketOpen, resolution, declinedAt, now); err != nil {
			return err
		}
		// The market gets the full request lifetime from the moment it opens.
		expires := now.Add(time.Duration(policy.Bids.RequestExpirySec) * time.Second)
		if expires.Before(request.ExpiresAt) {
			expires = request.ExpiresAt
		}
		moved, err := s.deps.Store.TransitionRequest(ctx, tx, request, machine.MpRequestOpen, RequestUpdate{ExpiresAt: &expires})
		if err != nil {
			return err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.request.opened_to_market",
			AggregateType:  subjectRequest,
			AggregateID:    request.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         request.CityID,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: eventKey("mp.request.opened_to_market", request.ID.String()),
			OccurredAt:     now,
			Payload: map[string]any{
				"requestId":   request.ID.String(),
				"requesterId": request.RequesterID.String(),
				"reason":      CloseReasonPreferredUnavailable,
				"expiresAt":   expires.Format(time.RFC3339),
			},
		}); err != nil {
			return err
		}
		return writeAudit(ctx, tx, AuditRecord{
			ActorID:     "ride-service",
			ActorRole:   "system",
			Action:      "mp.request.opened_to_market",
			SubjectType: subjectRequest,
			SubjectID:   request.ID.String(),
			Before:      map[string]any{"preferredState": window.State, "expiresAt": request.ExpiresAt.Format(time.RFC3339)},
			After:       map[string]any{"preferredState": machine.MpPreferredMarketOpen, "expiresAt": expires.Format(time.RFC3339), "resolution": resolution},
			Reason:      "preferred driver did not offer; the rider consented to open-market fallback",
		})
	}

	// No consent: close the request, free. A live bid would mean someone may
	// still be selected; the precondition says there is none, and this
	// re-check refuses to close over one rather than strand its hold.
	live, err := s.deps.Store.LiveBidCountForRequest(ctx, tx, request.ID)
	if err != nil {
		return err
	}
	if live > 0 {
		return domain.Errorf(domain.CodeConflict, "the request still has a live offer")
	}
	if _, err := s.deps.Store.TransitionPreferred(ctx, tx, window, machine.MpPreferredClosed, resolution, declinedAt, now); err != nil {
		return err
	}
	reason := CloseReasonPreferredUnavailable
	moved, err := s.deps.Store.TransitionRequest(ctx, tx, request, machine.MpRequestExpired, RequestUpdate{CloseReason: &reason})
	if err != nil {
		return err
	}
	if err := writeEvent(ctx, tx, Event{
		Name:           "mp.request.closed",
		AggregateType:  subjectRequest,
		AggregateID:    request.ID.String(),
		FromVersion:    &fromVersion,
		ToVersion:      moved.Version,
		CityID:         request.CityID,
		ActorType:      "system",
		ActorID:        "ride-service",
		IdempotencyKey: "mp.request.closed:" + request.ID.String(),
		OccurredAt:     now,
		Payload: map[string]any{
			"requestId":   request.ID.String(),
			"requesterId": request.RequesterID.String(),
			"reason":      reason,
		},
	}); err != nil {
		return err
	}
	return writeAudit(ctx, tx, AuditRecord{
		ActorID:     "ride-service",
		ActorRole:   "system",
		Action:      "mp.request.closed",
		SubjectType: subjectRequest,
		SubjectID:   request.ID.String(),
		Before:      map[string]any{"state": request.State, "preferredState": window.State},
		After:       map[string]any{"state": machine.MpRequestExpired, "closeReason": reason, "resolution": resolution},
		Reason:      "preferred driver did not offer and the rider did not consent to open-market fallback; closed free of charge",
	})
}

// sweepPreferredWindows ends every exclusive window whose time is up and
// whose named driver holds no live offer. A live offer keeps the window
// where it is; the sweep comes back once that offer is gone.
func (s *Service) sweepPreferredWindows(ctx context.Context, now time.Time) {
	due, err := s.deps.Store.duePreferredWindows(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list due preferred-driver windows")
		return
	}
	for _, window := range due {
		if err := s.lapsePreferredWindow(ctx, window.RequestID, now); err != nil {
			s.deps.Logger.Error().Err(err).Str("request_id", window.RequestID.String()).Msg("failed to end a preferred-driver window")
		}
	}
}

func (s *Service) lapsePreferredWindow(ctx context.Context, requestID uuid.UUID, now time.Time) error {
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if err != nil {
		return err
	}
	_, policy, err := s.policy(ctx, request.CityID)
	if err != nil {
		// A city whose policy vanished mid-flight is retried next tick.
		return err
	}
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.RequestForUpdate(ctx, tx, requestID)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				return nil
			}
			return err
		}
		window, err := s.deps.Store.PreferredForUpdate(ctx, tx, requestID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpRequestOpen || window.State != machine.MpPreferredExclusive || window.WindowEndsAt.After(now) {
			return nil
		}
		if _, err := s.deps.Store.LiveBidForDriverOnRequest(ctx, tx, requestID, window.DriverID); err == nil {
			return nil
		} else if !errors.Is(err, domain.ErrNotFound) {
			return err
		}
		return s.resolvePreferredWindow(ctx, tx, locked, window, policy, preferredResolutionLapsed, nil, now)
	})
}
