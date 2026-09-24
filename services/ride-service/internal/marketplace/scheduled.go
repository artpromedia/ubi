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

// SCHEDULED REQUESTS (A03, product A).
//
// A scheduled request is a stored INTENT — never a booking. No driver is
// secured by creating one, and every state, label and event says so. A
// durable worker publishes it as an ordinary marketplace request at the
// market's lead time, re-pricing the stored route (fresh routing, fresh fare
// bounds) and re-checking funding first. Terms outside the rider's existing
// approval — a refreshed minimum above their approved maximum, a payment
// method the city no longer takes, funding that cannot be verified — never
// publish silently: the intent moves to needs_rider_approval and the rider
// is notified (mp.scheduled_request.needs_approval).

// advisoryRequesterScheduleCap serialises a requester's intent creation so
// the pending-intent cap is enforced inside the insert transaction.
const advisoryRequesterScheduleCap = int32(0x6d705343) // "mpSC"

// scheduledRetryDelay is how soon a publication that could not complete
// (routing or config unavailable, the open-request cap momentarily full) is
// retried. Plumbing, not policy.
const scheduledRetryDelay = time.Minute

// Why an intent waits for the rider (contract MP_SCHEDULED_APPROVAL_REASONS).
const (
	approvalFareAboveApproval   = "fare_above_approval"
	approvalPaymentMethod       = "payment_method_unavailable"
	approvalFundingUnavailable  = "funding_unavailable"
	scheduledCloseMarketClosed  = "market_unavailable"
	scheduledClosePickupPassed  = "pickup_time_passed"
	scheduledCloseNoDriverFound = "no_driver_found"
	scheduledCloseCancelled     = "cancelled_by_rider"
	scheduledCloseTooLate       = "too_late_for_offers"
)

// CreateScheduledRequestBody is POST /v1/mp/scheduled-requests
// (MpCreateScheduledRequestSchema).
type CreateScheduledRequestBody struct {
	QuoteID            uuid.UUID     `json:"quoteId"`
	RequestedFareMinor Money         `json:"requestedFareMinor"`
	MaxFareMinor       Money         `json:"maxFareMinor"`
	PaymentMethodID    string        `json:"paymentMethodId"`
	Schedule           ScheduleInput `json:"schedule"`
}

// bookableQuote loads a requester's quote for a Book for Later product and
// runs the checks every product shares: ownership, rides only, the vertical
// and multi-stop flags, an unexpired unconsumed quote priced under the
// active policy, an available payment method, and the requested fare inside
// the quote's server bounds in the quote's currency.
func (s *Service) bookableQuote(ctx context.Context, actor Actor, quoteID uuid.UUID, requested Money, paymentMethodID string) (*Quote, *cityconfig.CityConfig, *cityconfig.MarketplacePolicy, error) {
	quote, err := s.deps.Store.QuoteByID(ctx, s.deps.Store.Pool(), quoteID)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && quote.RequesterID != actor.UserID) {
		return nil, nil, nil, domain.Errorf(domain.CodeNotFound, "that quote does not exist")
	}
	if err != nil {
		return nil, nil, nil, asDomainError(err)
	}
	if quote.Service != ServiceRide {
		return nil, nil, nil, domain.Errorf(domain.CodeValidationFailed,
			"booking for later is available for rides only").WithDetails(map[string]any{"field": "quoteId"})
	}
	if err := s.requireServiceFlag(ctx, quote.Service, actor, quote.CityID); err != nil {
		return nil, nil, nil, err
	}
	if len(quote.Stops) > 0 {
		if err := s.requireStopsAllowed(ctx, quote.Service, actor, quote.CityID); err != nil {
			return nil, nil, nil, err
		}
	}
	if !s.now().Before(quote.ExpiresAt) {
		return nil, nil, nil, domain.Errorf(domain.CodeQuoteExpired, "this quote has expired; ask for a new one")
	}
	if quote.ConsumedBy != nil {
		return nil, nil, nil, domain.Errorf(domain.CodeConflict, "this quote has already been used")
	}
	config, policy, err := s.policy(ctx, quote.CityID)
	if err != nil {
		return nil, nil, nil, err
	}
	if quote.PolicyVersion != policy.PolicyVersion {
		return nil, nil, nil, domain.Errorf(domain.CodeQuoteExpired,
			"the marketplace policy changed after this quote was issued; ask for a new one")
	}
	if available, reason := config.PaymentMethodAvailable(paymentMethodID); !available {
		return nil, nil, nil, domain.Errorf(domain.CodePaymentMethodUnavailable,
			"%s cannot be used in this city", paymentMethodID).
			WithDetails(map[string]any{"paymentMethodId": paymentMethodID, "reason": reason})
	}
	if err := requireCurrency(requested, quote.Currency, "requestedFareMinor"); err != nil {
		return nil, nil, nil, err
	}
	if requested.AmountMinor < quote.MinMinor || requested.AmountMinor > quote.MaxMinor {
		return nil, nil, nil, fareOutOfBounds(requested.AmountMinor, quote.MinMinor, quote.MaxMinor,
			quote.Currency, config.CurrencyFractionDigits)
	}
	return quote, config, policy, nil
}

// requireLead refuses a pickup too soon or too far ahead.
func requireLead(pickupAt, now time.Time, minLeadSec, maxHorizonSec int) error {
	lead := pickupAt.Sub(now)
	if lead < time.Duration(minLeadSec)*time.Second {
		return domain.Errorf(domain.CodeValidationFailed,
			"the pickup must be at least %d minutes from now", minLeadSec/60).
			WithDetails(map[string]any{"field": "schedule", "minimumLeadMinutes": minLeadSec / 60, "pickupAt": pickupAt})
	}
	if lead > time.Duration(maxHorizonSec)*time.Second {
		return domain.Errorf(domain.CodeValidationFailed,
			"the pickup can be at most %d days ahead", maxHorizonSec/86_400).
			WithDetails(map[string]any{"field": "schedule", "maximumHorizonDays": maxHorizonSec / 86_400, "pickupAt": pickupAt})
	}
	return nil
}

// CreateScheduledRequest stores a scheduled request (product A). Nothing is
// published, reserved or charged: the answer says no driver is secured.
func (s *Service) CreateScheduledRequest(ctx context.Context, actor Actor, body CreateScheduledRequestBody, idempotencyKey string) (*ScheduledRequestView, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only a requester can schedule a request")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeScheduledCreate, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view ScheduledRequestView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}

	quote, config, policy, err := s.bookableQuote(ctx, actor, body.QuoteID, body.RequestedFareMinor, body.PaymentMethodID)
	if err != nil {
		return nil, 0, err
	}
	if err := s.requireFlag(ctx, cityconfig.FlagScheduledRides, actor, quote.CityID); err != nil {
		return nil, 0, err
	}
	scheduling, err := policy.ScheduledRequestPolicyFor(quote.CityID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if err := requireCurrency(body.MaxFareMinor, quote.Currency, "maxFareMinor"); err != nil {
		return nil, 0, err
	}
	if body.MaxFareMinor.AmountMinor < body.RequestedFareMinor.AmountMinor {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed,
			"the approved maximum cannot be below the asked fare").WithDetails(map[string]any{"field": "maxFareMinor"})
	}
	schedule, _, err := resolveSchedule(body.Schedule, config.Timezone, windowBounds{
		minSec: scheduling.MinWindowSec, defaultSec: scheduling.DefaultWindowSec, maxSec: scheduling.MaxWindowSec,
	})
	if err != nil {
		return nil, 0, err
	}
	now := s.now()
	if err := requireLead(schedule.PickupAt, now, scheduling.MinLeadSec, scheduling.MaxHorizonSec); err != nil {
		return nil, 0, err
	}

	sr := &ScheduledRequest{
		ID:              uuid.New(),
		Product:         ProductScheduledRequest,
		RequesterID:     actor.UserID,
		CityID:          quote.CityID,
		Service:         quote.Service,
		VehicleClass:    quote.VehicleClass,
		Currency:        quote.Currency,
		State:           machine.MpScheduledUnassigned,
		Version:         1,
		Pickup:          quote.Pickup,
		Dropoff:         quote.Dropoff,
		Stops:           quote.Stops,
		PaymentMethodID: body.PaymentMethodID,
		RequestedMinor:  body.RequestedFareMinor.AmountMinor,
		MaxFareMinor:    body.MaxFareMinor.AmountMinor,
		Schedule:        *schedule,
		PublishAt:       schedule.PickupAt.Add(-time.Duration(scheduling.PublishLeadSec) * time.Second),
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	var view *ScheduledRequestView
	var replayed *IdempotentResult
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.deps.Store.AcquireCapLock(ctx, tx, advisoryRequesterScheduleCap, actor.UserID); err != nil {
			return err
		}
		// Re-checked under the requester's lock: a concurrent retry of this
		// same key that committed first is REPLAYED, never stored twice.
		if replayed, err = s.deps.Store.LookupIdempotent(ctx, tx, scopeScheduledCreate, actor.UserID, idempotencyKey, body); err != nil || replayed != nil {
			return err
		}
		pending, err := s.deps.Store.PendingScheduledCount(ctx, tx, actor.UserID)
		if err != nil {
			return err
		}
		if pending >= scheduling.MaxPendingPerRequester {
			return domain.Errorf(domain.CodeRequestCapReached,
				"you already have %d scheduled requests waiting; cancel one first", pending).
				WithDetails(map[string]any{"pending": pending, "maximum": scheduling.MaxPendingPerRequester})
		}
		if _, err := s.deps.Store.InsertScheduledRequest(ctx, tx, sr); err != nil {
			return err
		}
		if err := s.writeScheduledEvent(ctx, tx, sr, "mp.scheduled_request.created", "rider", actor.UserID.String(), now,
			map[string]any{"publishAt": sr.PublishAt.Format(time.RFC3339)}, sr.ID.String()); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.scheduled_request.created",
			SubjectType: subjectScheduled,
			SubjectID:   sr.ID.String(),
			After: map[string]any{
				"state": sr.State, "pickupAt": sr.Schedule.PickupAt, "timeZone": sr.Schedule.TimeZone,
				"dstResolution": sr.Schedule.DSTResolution, "requestedMinor": sr.RequestedMinor,
				"maxFareMinor": sr.MaxFareMinor, "currency": sr.Currency, "driverSecured": false,
			},
			Reason: "requester scheduled a request; no driver is secured",
		}); err != nil {
			return err
		}
		view = scheduledViewOf(sr, nil, false)
		// The stored row stamps created/updated; the view is re-read below
		// for the answer, but the idempotent record carries this one.
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeScheduledCreate, actor.UserID, idempotencyKey, body, 201, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replayed != nil {
		var stored ScheduledRequestView
		if err := decodeJSON(replayed.Response, &stored); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &stored, replayed.StatusCode, nil
	}
	return view, 201, nil
}

// writeScheduledEvent appends one mp.scheduled_request.* (or occurrence)
// outbox row. keyParts make the key unique per transition.
func (s *Service) writeScheduledEvent(ctx context.Context, tx pgx.Tx, sr *ScheduledRequest, name, actorType, actorID string, now time.Time, extra map[string]any, keyParts ...string) error {
	payload := map[string]any{
		"scheduledRequestId": sr.ID.String(),
		"product":            sr.Product,
		"requesterId":        sr.RequesterID.String(),
		"state":              sr.State,
		"pickupAt":           sr.Schedule.PickupAt.Format(time.RFC3339),
		"windowEnd":          sr.Schedule.WindowEnd.Format(time.RFC3339),
		"localDate":          sr.Schedule.LocalDate,
		"localTime":          sr.Schedule.LocalTime,
		"timeZone":           sr.Schedule.TimeZone,
		"driverSecured":      false,
	}
	if sr.TemplateID != nil {
		payload["templateId"] = sr.TemplateID.String()
		if sr.OccurrenceDate != nil {
			payload["occurrenceDate"] = *sr.OccurrenceDate
		}
	}
	for key, value := range extra {
		payload[key] = value
	}
	return writeEvent(ctx, tx, Event{
		Name:           name,
		AggregateType:  subjectScheduled,
		AggregateID:    sr.ID.String(),
		ToVersion:      sr.Version,
		CityID:         sr.CityID,
		ActorType:      actorType,
		ActorID:        actorID,
		IdempotencyKey: eventKey(name, keyParts...),
		OccurredAt:     now,
		Payload:        payload,
	})
}

// scheduledForOwner reads an intent its requester owns ("not found"
// otherwise, so ids never probe another rider's plans).
func (s *Service) scheduledForOwner(ctx context.Context, actor Actor, id uuid.UUID) (*ScheduledRequest, error) {
	if !actor.IsRider() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a requester has scheduled requests")
	}
	sr, err := s.deps.Store.ScheduledRequestByID(ctx, s.deps.Store.Pool(), id)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && sr.RequesterID != actor.UserID) {
		return nil, domain.Errorf(domain.CodeNotFound, "that scheduled request does not exist")
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	return sr, nil
}

// scheduledView renders an intent with its published request and series.
func (s *Service) scheduledView(ctx context.Context, sr *ScheduledRequest) *ScheduledRequestView {
	var request *Request
	if sr.RequestID != nil {
		if found, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), *sr.RequestID); err == nil {
			request = found
		}
	}
	paused := false
	if sr.TemplateID != nil {
		if template, err := s.deps.Store.TemplateByID(ctx, s.deps.Store.Pool(), *sr.TemplateID); err == nil {
			paused = template.State == machine.MpTemplatePaused
		}
	}
	return scheduledViewOf(sr, request, paused)
}

// GetScheduledRequest answers GET /v1/mp/scheduled-requests/{id}.
func (s *Service) GetScheduledRequest(ctx context.Context, actor Actor, id uuid.UUID) (*ScheduledRequestView, error) {
	sr, err := s.scheduledForOwner(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	return s.scheduledView(ctx, sr), nil
}

// ListScheduledRequests answers GET /v1/mp/scheduled-requests: the rider's
// one-off intents (recurring occurrences are listed under their series).
func (s *Service) ListScheduledRequests(ctx context.Context, actor Actor) ([]*ScheduledRequestView, error) {
	if !actor.IsRider() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a requester has scheduled requests")
	}
	rows, err := s.deps.Store.ScheduledRequestsForRequester(ctx, s.deps.Store.Pool(), actor.UserID, 100)
	if err != nil {
		return nil, asDomainError(err)
	}
	views := make([]*ScheduledRequestView, 0, len(rows))
	for _, sr := range rows {
		views = append(views, s.scheduledView(ctx, sr))
	}
	return views, nil
}

// CancelScheduledRequest cancels an unpublished intent. A published one is
// an ordinary request by now: it is cancelled through the request.
func (s *Service) CancelScheduledRequest(ctx context.Context, actor Actor, id uuid.UUID, idempotencyKey string) (*ScheduledRequestView, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	sr, err := s.scheduledForOwner(ctx, actor, id)
	if err != nil {
		return nil, 0, err
	}
	body := map[string]any{"scheduledRequestId": id.String()}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeScheduledCancel, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view ScheduledRequestView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}
	if sr.State == machine.MpScheduledPublished && sr.RequestID != nil {
		return nil, 0, domain.Errorf(domain.CodeRequestClosed,
			"this trip was already sent to drivers; cancel the request instead").
			WithDetails(map[string]any{"requestId": sr.RequestID.String()})
	}
	now := s.now()
	var view *ScheduledRequestView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.ScheduledRequestForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if locked.State != machine.MpScheduledUnassigned && locked.State != machine.MpScheduledNeedsApproval {
			return domain.Errorf(domain.CodeRequestClosed, "this scheduled request can no longer be cancelled").
				WithDetails(map[string]any{"state": locked.State})
		}
		reason := scheduledCloseCancelled
		moved, err := s.deps.Store.TransitionScheduled(ctx, tx, locked, machine.MpScheduledCancelled, ScheduledUpdate{CloseReason: &reason})
		if err != nil {
			return err
		}
		if err := s.writeScheduledEvent(ctx, tx, moved, "mp.scheduled_request.cancelled", "rider", actor.UserID.String(), now,
			map[string]any{"reason": reason}, moved.ID.String()); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role, Action: "mp.scheduled_request.cancelled",
			SubjectType: subjectScheduled, SubjectID: moved.ID.String(),
			Before: map[string]any{"state": locked.State}, After: map[string]any{"state": moved.State},
			Reason: "requester cancelled a scheduled request before any driver was secured",
		}); err != nil {
			return err
		}
		view = scheduledViewOf(moved, nil, false)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeScheduledCancel, actor.UserID, idempotencyKey, body, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, 200, nil
}

// ApproveScheduledBody is POST /v1/mp/scheduled-requests/{id}/approve
// (MpApproveScheduledRequestSchema, plus an optional replacement payment
// method when the stored one became unavailable).
type ApproveScheduledBody struct {
	ExpectedVersion    int    `json:"expectedVersion"`
	MaxFareMinor       Money  `json:"maxFareMinor"`
	RequestedFareMinor *Money `json:"requestedFareMinor,omitempty"`
	PaymentMethodID    string `json:"paymentMethodId,omitempty"`
}

// ApproveScheduledRequest is the rider's renewed approval of refreshed terms.
// The intent returns to scheduled_unassigned and the next worker pass
// publishes it — refreshing the terms once more, so an approval is never
// stretched over terms that moved again.
func (s *Service) ApproveScheduledRequest(ctx context.Context, actor Actor, id uuid.UUID, body ApproveScheduledBody, idempotencyKey string) (*ScheduledRequestView, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	sr, err := s.scheduledForOwner(ctx, actor, id)
	if err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeScheduledApprove, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view ScheduledRequestView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}
	if err := requireCurrency(body.MaxFareMinor, sr.Currency, "maxFareMinor"); err != nil {
		return nil, 0, err
	}
	requested := sr.RequestedMinor
	if body.RequestedFareMinor != nil {
		if err := requireCurrency(*body.RequestedFareMinor, sr.Currency, "requestedFareMinor"); err != nil {
			return nil, 0, err
		}
		requested = body.RequestedFareMinor.AmountMinor
	}
	if requested > body.MaxFareMinor.AmountMinor {
		requested = body.MaxFareMinor.AmountMinor
	}
	if requested <= 0 {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "the asked fare must be positive").
			WithDetails(map[string]any{"field": "requestedFareMinor"})
	}
	var paymentMethod *string
	if body.PaymentMethodID != "" {
		config, err := s.config(ctx, sr.CityID)
		if err != nil {
			return nil, 0, err
		}
		if available, reason := config.PaymentMethodAvailable(body.PaymentMethodID); !available {
			return nil, 0, domain.Errorf(domain.CodePaymentMethodUnavailable,
				"%s cannot be used in this city", body.PaymentMethodID).
				WithDetails(map[string]any{"paymentMethodId": body.PaymentMethodID, "reason": reason})
		}
		paymentMethod = &body.PaymentMethodID
	}

	now := s.now()
	var view *ScheduledRequestView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.ScheduledRequestForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if locked.State != machine.MpScheduledNeedsApproval {
			return domain.Errorf(domain.CodeConflict, "this scheduled request is not waiting for your approval").
				WithDetails(map[string]any{"state": locked.State})
		}
		if locked.Version != body.ExpectedVersion {
			return domain.Errorf(domain.CodeVersionConflict, "the scheduled request changed; review it again").
				WithDetails(map[string]any{"expectedVersion": body.ExpectedVersion, "currentVersion": locked.Version})
		}
		if !now.Before(locked.Schedule.WindowEnd) {
			return domain.Errorf(domain.CodeRequestClosed, "the pickup time has passed")
		}
		if locked.Approval != nil && locked.Approval.RefreshedMinMinor != nil &&
			body.MaxFareMinor.AmountMinor < *locked.Approval.RefreshedMinMinor {
			return domain.Errorf(domain.CodeFareOutOfBounds,
				"the refreshed minimum for this trip is above the maximum you approved").
				WithDetails(map[string]any{"field": "maxFareMinor", "minimumMinor": *locked.Approval.RefreshedMinMinor})
		}
		maxFare := body.MaxFareMinor.AmountMinor
		moved, err := s.deps.Store.TransitionScheduled(ctx, tx, locked, machine.MpScheduledUnassigned, ScheduledUpdate{
			ClearApproval:   true,
			MaxFareMinor:    &maxFare,
			RequestedMinor:  &requested,
			ClearNextTry:    true,
			PaymentMethodID: paymentMethod,
		})
		if err != nil {
			return err
		}
		if err := s.writeScheduledEvent(ctx, tx, moved, "mp.scheduled_request.reapproved", "rider", actor.UserID.String(), now,
			map[string]any{"maxFareMinor": maxFare, "requestedMinor": requested, "currency": moved.Currency},
			moved.ID.String(), itoa(moved.Version)); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role, Action: "mp.scheduled_request.reapproved",
			SubjectType: subjectScheduled, SubjectID: moved.ID.String(),
			Before: map[string]any{"maxFareMinor": locked.MaxFareMinor, "requestedMinor": locked.RequestedMinor},
			After:  map[string]any{"maxFareMinor": maxFare, "requestedMinor": requested, "currency": moved.Currency},
			Reason: "requester approved refreshed terms for a scheduled request",
		}); err != nil {
			return err
		}
		view = scheduledViewOf(moved, nil, false)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeScheduledApprove, actor.UserID, idempotencyKey, body, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, 200, nil
}

// ---------------------------------------------------------------------------
// The publication worker.
// ---------------------------------------------------------------------------

// errPublicationDeferred marks a publication that could not complete now
// and is retried (routing/config unavailable, the open cap momentarily full).
var errPublicationDeferred = errors.New("publication deferred")

// publishScheduled publishes one due intent — or parks it for the rider, or
// closes it with an explained outcome. It is idempotent: the intent row is
// re-read under lock and must still be scheduled_unassigned at its version,
// so a replayed or concurrent pass publishes at most once.
func (s *Service) publishScheduled(ctx context.Context, sr *ScheduledRequest, now time.Time) error {
	if !now.Before(sr.Schedule.WindowEnd) {
		return s.closeScheduled(ctx, sr, machine.MpScheduledExpired, scheduledClosePickupPassed,
			"mp.scheduled_request.expired", now)
	}
	if sr.TemplateID != nil {
		template, err := s.deps.Store.TemplateByID(ctx, s.deps.Store.Pool(), *sr.TemplateID)
		if err != nil {
			return err
		}
		if template.State == machine.MpTemplatePaused {
			// A paused series publishes nothing; the occurrence waits (and
			// lapses to expired if the pickup passes while paused).
			return s.deps.Store.DeferScheduled(ctx, s.deps.Store.Pool(), sr.ID, "series paused", now.Add(5*scheduledRetryDelay))
		}
	}

	config, policy, err := s.policy(ctx, sr.CityID)
	if err != nil {
		if mapped, ok := domain.AsError(err); ok && mapped.Code == domain.CodeMarketNotConfigured {
			return s.closeScheduled(ctx, sr, machine.MpScheduledUnfulfilled, scheduledCloseMarketClosed,
				"mp.scheduled_request.unfulfilled", now)
		}
		return s.deferScheduled(ctx, sr, err, now)
	}
	// The market must still be open for this rider. Switching the flags off
	// stops new sales; an intent that cannot be served is closed honestly.
	if !s.flagOn(ctx, flagFor(sr.Service), sr.RequesterID.String(), sr.CityID) {
		return s.closeScheduled(ctx, sr, machine.MpScheduledUnfulfilled, scheduledCloseMarketClosed,
			"mp.scheduled_request.unfulfilled", now)
	}
	var advance *cityconfig.AdvanceReservationPolicy
	if sr.Product == ProductAdvanceReservation {
		if advance, err = policy.AdvanceReservationPolicyFor(sr.CityID); err != nil {
			return s.closeScheduled(ctx, sr, machine.MpScheduledUnfulfilled, scheduledCloseMarketClosed,
				"mp.scheduled_request.unfulfilled", now)
		}
	}

	// Refresh routing and the fare bounds: the stored route is re-priced
	// exactly like a fresh quote.
	quote, err := s.priceQuote(ctx, sr.RequesterID, config, policy, QuoteParams{
		Service:      sr.Service,
		VehicleClass: sr.VehicleClass,
		Pickup:       placeOf(sr.Pickup),
		Dropoff:      placeOf(sr.Dropoff),
		Stops:        stopInputsOf(sr.Stops),
	})
	if err != nil {
		if mapped, ok := domain.AsError(err); ok && (mapped.Code == domain.CodeMarketNotConfigured || mapped.Code == domain.CodeValidationFailed) {
			return s.closeScheduled(ctx, sr, machine.MpScheduledUnfulfilled, scheduledCloseMarketClosed,
				"mp.scheduled_request.unfulfilled", now)
		}
		return s.deferScheduled(ctx, sr, err, now)
	}
	refreshed := &ScheduledApproval{RefreshedMinMinor: &quote.MinMinor, RefreshedMaxMinor: &quote.MaxMinor, RefreshedSuggested: &quote.SuggestedMinor}
	if quote.MinMinor > sr.MaxFareMinor {
		refreshed.Reason = approvalFareAboveApproval
		refreshed.Message = "The minimum fare for this trip is now " +
			formatMinor(quote.MinMinor, quote.Currency, config.CurrencyFractionDigits) + ", above the " +
			formatMinor(sr.MaxFareMinor, sr.Currency, config.CurrencyFractionDigits) +
			" you approved. Nothing was sent to drivers; approve a new maximum to continue."
		return s.parkForApproval(ctx, sr, refreshed, now)
	}
	if available, _ := config.PaymentMethodAvailable(sr.PaymentMethodID); !available {
		refreshed.Reason = approvalPaymentMethod
		refreshed.Message = "Your payment method can no longer be used here. Nothing was sent to drivers; choose another to continue."
		return s.parkForApproval(ctx, sr, refreshed, now)
	}
	maxBound := quote.MaxMinor
	if sr.MaxFareMinor < maxBound {
		// The rider's approval tightens the server's ceiling: no driver can
		// offer above what the rider approved.
		maxBound = sr.MaxFareMinor
	}
	asked := sr.RequestedMinor
	if asked < quote.MinMinor {
		asked = quote.MinMinor
	}
	if asked > maxBound {
		asked = maxBound
	}
	// Funding is re-verified before anything is published: a wallet rider's
	// spendable must cover the asked fare. (The durable funding reservation
	// is still taken at award by the award saga; cash stays unsecured.)
	if sr.PaymentMethodID != "cash" {
		overview, err := s.deps.Wallet.Overview(ctx, sr.RequesterID, sr.CityID)
		if err != nil {
			return s.deferScheduled(ctx, sr, err, now)
		}
		if overview.SpendableMinor.AmountMinor < asked {
			refreshed.Reason = approvalFundingUnavailable
			refreshed.Message = "Your wallet cannot cover " + formatMinor(asked, sr.Currency, config.CurrencyFractionDigits) +
				" for this trip. Nothing was sent to drivers; top up and approve to continue."
			return s.parkForApproval(ctx, sr, refreshed, now)
		}
	}

	kind := BookingKindScheduled
	expiresAt := now.Add(time.Duration(policy.Bids.RequestExpirySec) * time.Second)
	if expiresAt.After(sr.Schedule.WindowEnd) {
		expiresAt = sr.Schedule.WindowEnd
	}
	if advance != nil {
		kind = BookingKindAdvance
		expiresAt = advanceRequestExpiry(now, sr.Schedule.PickupAt, advance)
		if !expiresAt.After(now) {
			return s.closeScheduled(ctx, sr, machine.MpScheduledExpired, scheduledCloseTooLate,
				"mp.scheduled_request.expired", now)
		}
	}
	quote.ExpiresAt = now.Add(config.QuoteTTL())
	request := newRequestFromQuote(quote, sr.RequesterID, asked, maxBound, sr.PaymentMethodID, policy, expiresAt)
	schedule := sr.Schedule
	request.BookingKind = kind
	request.Schedule = &schedule
	windowStart, windowEnd := schedule.PickupAt, schedule.WindowEnd
	request.PickupWindowStart, request.PickupWindowEnd = &windowStart, &windowEnd
	scheduledID := sr.ID
	request.ScheduledRequestID = &scheduledID

	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.ScheduledRequestForUpdate(ctx, tx, sr.ID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpScheduledUnassigned || locked.Version != sr.Version {
			// Another pass (or the rider) got here first.
			return nil
		}
		if err := s.acquirePublishCapacity(ctx, tx, sr.RequesterID, kind, policy, advance); err != nil {
			return err
		}
		if err := s.deps.Store.InsertQuote(ctx, tx, quote); err != nil {
			return err
		}
		if err := s.writePublishedRequest(ctx, tx, request, quote, publisher{
			actorType: "system",
			actorID:   "ride-service",
			actorRole: "system",
			reason:    "the Book for Later worker published a stored intent at its lead time with refreshed terms",
		}, now); err != nil {
			return err
		}
		requestID := request.ID
		moved, err := s.deps.Store.TransitionScheduled(ctx, tx, locked, machine.MpScheduledPublished, ScheduledUpdate{
			RequestID: &requestID, ClearApproval: true, ClearNextTry: true,
		})
		if err != nil {
			return err
		}
		if err := s.writeScheduledEvent(ctx, tx, moved, "mp.scheduled_request.published", "system", "ride-service", now,
			map[string]any{
				"requestId": request.ID.String(), "bookingKind": kind,
				"requestedMinor": asked, "minMinor": quote.MinMinor, "maxMinor": maxBound, "currency": quote.Currency,
			}, moved.ID.String()); err != nil {
			return err
		}
		return writeAudit(ctx, tx, AuditRecord{
			ActorID: "ride-service", ActorRole: "system", Action: "mp.scheduled_request.published",
			SubjectType: subjectScheduled, SubjectID: moved.ID.String(),
			Before: map[string]any{"state": locked.State},
			After: map[string]any{
				"state": moved.State, "requestId": request.ID.String(), "requestedMinor": asked,
				"minMinor": quote.MinMinor, "maxMinor": maxBound, "approvedMaxMinor": sr.MaxFareMinor,
				"currency": quote.Currency,
			},
			Reason: "published within the rider's approval after refreshing routing, bounds and funding",
		})
	})
	if errors.Is(err, errPublicationDeferred) {
		return s.deps.Store.DeferScheduled(ctx, s.deps.Store.Pool(), sr.ID, "the open-request cap is full", now.Add(scheduledRetryDelay))
	}
	return err
}

// acquirePublishCapacity enforces the requester's open-request cap for the
// kind being published, inside the publishing transaction, under the same
// advisory lock the requester's own publishes take.
func (s *Service) acquirePublishCapacity(ctx context.Context, tx pgx.Tx, requesterID uuid.UUID, kind string, policy *cityconfig.MarketplacePolicy, advance *cityconfig.AdvanceReservationPolicy) error {
	if err := s.deps.Store.AcquireCapLock(ctx, tx, advisoryRequesterOpenCap, requesterID); err != nil {
		return err
	}
	if kind == BookingKindAdvance {
		open, err := s.deps.Store.OpenAdvanceRequestCount(ctx, tx, requesterID)
		if err != nil {
			return err
		}
		if open >= advance.MaxOpenPerRequester {
			return errPublicationDeferred
		}
		return nil
	}
	open, err := s.deps.Store.OpenRequestCount(ctx, tx, requesterID)
	if err != nil {
		return err
	}
	if open >= policy.Bids.MaxOpenRequestsPerRequester {
		return errPublicationDeferred
	}
	return nil
}

// deferScheduled records a transient publication failure for a retry.
func (s *Service) deferScheduled(ctx context.Context, sr *ScheduledRequest, cause error, now time.Time) error {
	backoff := stepBackoff(sr.Attempts)
	if backoff > 5*time.Minute {
		backoff = 5 * time.Minute
	}
	if err := s.deps.Store.DeferScheduled(ctx, s.deps.Store.Pool(), sr.ID, cause.Error(), now.Add(backoff)); err != nil {
		return err
	}
	return fmt.Errorf("%w: %v", errPublicationDeferred, cause)
}

// parkForApproval moves an intent to needs_rider_approval with the refreshed
// terms, notifying the rider. Nothing is published.
func (s *Service) parkForApproval(ctx context.Context, sr *ScheduledRequest, approval *ScheduledApproval, now time.Time) error {
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.ScheduledRequestForUpdate(ctx, tx, sr.ID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpScheduledUnassigned || locked.Version != sr.Version {
			return nil
		}
		moved, err := s.deps.Store.TransitionScheduled(ctx, tx, locked, machine.MpScheduledNeedsApproval, ScheduledUpdate{
			Approval: approval, ClearNextTry: true,
		})
		if err != nil {
			return err
		}
		extra := map[string]any{"reason": approval.Reason, "message": approval.Message, "currency": moved.Currency}
		if approval.RefreshedMinMinor != nil {
			extra["refreshedMinMinor"] = *approval.RefreshedMinMinor
			extra["refreshedMaxMinor"] = *approval.RefreshedMaxMinor
			extra["approvedMaxMinor"] = moved.MaxFareMinor
		}
		if err := s.writeScheduledEvent(ctx, tx, moved, "mp.scheduled_request.needs_approval", "system", "ride-service", now,
			extra, moved.ID.String(), itoa(moved.Version)); err != nil {
			return err
		}
		return writeAudit(ctx, tx, AuditRecord{
			ActorID: "ride-service", ActorRole: "system", Action: "mp.scheduled_request.needs_approval",
			SubjectType: subjectScheduled, SubjectID: moved.ID.String(),
			Before: map[string]any{"state": locked.State}, After: extra,
			Reason: "refreshed terms fall outside the rider's approval; not published",
		})
	})
}

// closeScheduled moves an intent to a terminal state with its reason.
func (s *Service) closeScheduled(ctx context.Context, sr *ScheduledRequest, to, reason, event string, now time.Time) error {
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.ScheduledRequestForUpdate(ctx, tx, sr.ID)
		if err != nil {
			return err
		}
		if !machine.Can(machine.MpScheduledRequest, locked.State, to) {
			return nil
		}
		moved, err := s.deps.Store.TransitionScheduled(ctx, tx, locked, to, ScheduledUpdate{CloseReason: &reason})
		if err != nil {
			return err
		}
		if err := s.writeScheduledEvent(ctx, tx, moved, event, "system", "ride-service", now,
			map[string]any{"reason": reason}, moved.ID.String()); err != nil {
			return err
		}
		return writeAudit(ctx, tx, AuditRecord{
			ActorID: "ride-service", ActorRole: "system", Action: event,
			SubjectType: subjectScheduled, SubjectID: moved.ID.String(),
			Before: map[string]any{"state": locked.State}, After: map[string]any{"state": moved.State, "reason": reason},
			Reason: reason,
		})
	})
}

// sweepScheduledPublications is the durable publication pass: lapsed intents
// expire, due ones publish (or park, or close), published ones whose request
// the market closed without a driver become unfulfilled.
func (s *Service) sweepScheduledPublications(ctx context.Context, now time.Time) {
	lapsed, err := s.deps.Store.LapsedScheduledIntents(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list lapsed scheduled requests")
	}
	for _, sr := range lapsed {
		if err := s.closeScheduled(ctx, sr, machine.MpScheduledExpired, scheduledClosePickupPassed,
			"mp.scheduled_request.expired", now); err != nil {
			s.deps.Logger.Error().Err(err).Str("scheduled_request_id", sr.ID.String()).Msg("failed to expire a scheduled request")
		}
	}

	due, err := s.deps.Store.DueScheduledPublications(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list due scheduled requests")
	}
	for _, sr := range due {
		if err := s.publishScheduled(ctx, sr, now); err != nil {
			level := s.deps.Logger.Error()
			if errors.Is(err, errPublicationDeferred) {
				level = s.deps.Logger.Info()
			}
			level.Err(err).Str("scheduled_request_id", sr.ID.String()).Msg("scheduled publication did not complete; will retry")
		}
	}

	unfulfilled, err := s.deps.Store.PublishedScheduledUnfulfilled(ctx, s.deps.Store.Pool(), sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list unfulfilled scheduled requests")
	}
	for _, sr := range unfulfilled {
		if err := s.closeScheduled(ctx, sr, machine.MpScheduledUnfulfilled, scheduledCloseNoDriverFound,
			"mp.scheduled_request.unfulfilled", now); err != nil {
			s.deps.Logger.Error().Err(err).Str("scheduled_request_id", sr.ID.String()).Msg("failed to record an unfulfilled scheduled request")
		}
	}
}

// sweepScheduledReminders publishes each due reminder offset once per
// unpublished intent. An offset whose moment passed before the intent
// existed is never sent (a 12-hour reminder is not sent 30 minutes out).
func (s *Service) sweepScheduledReminders(ctx context.Context, now time.Time) {
	// Every pending intent in the reminder horizon, page by page (see
	// sweepBookingReminders).
	var rows []*ScheduledRequest
	afterPickup, afterID := now, uuid.Nil
	for page := 0; page < reminderPageCap; page++ {
		batch, err := s.deps.Store.PendingScheduledForReminders(ctx, s.deps.Store.Pool(), now, now.Add(reminderHorizon),
			afterPickup, afterID, sweepBatch)
		if err != nil {
			s.deps.Logger.Error().Err(err).Msg("failed to list scheduled requests for reminders")
			break
		}
		rows = append(rows, batch...)
		if len(batch) < sweepBatch {
			break
		}
		last := batch[len(batch)-1]
		afterPickup, afterID = last.Schedule.PickupAt, last.ID
	}
	policies := map[string]*cityconfig.ScheduledRequestPolicy{}
	for _, sr := range rows {
		scheduling, ok := policies[sr.CityID]
		if !ok {
			if _, policy, err := s.policy(ctx, sr.CityID); err == nil {
				scheduling, _ = policy.ScheduledRequestPolicyFor(sr.CityID)
			}
			policies[sr.CityID] = scheduling
		}
		if scheduling == nil {
			continue
		}
		for _, offset := range dueReminderOffsets(scheduling.ReminderOffsetsSec, sr.RemindersSent, sr.Schedule.PickupAt, sr.CreatedAt, now) {
			if err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
				recorded, err := s.deps.Store.MarkScheduledReminder(ctx, tx, sr.ID, offset)
				if err != nil || !recorded {
					return err
				}
				return s.writeScheduledEvent(ctx, tx, sr, "mp.scheduled_request.reminder", "system", "ride-service", now,
					map[string]any{
						"offsetSec": offset,
						"message":   "Reminder: no driver is secured for this trip yet. It is sent to drivers at its lead time.",
						"publishAt": sr.PublishAt.Format(time.RFC3339),
					}, sr.ID.String(), itoa(offset))
			}); err != nil {
				s.deps.Logger.Error().Err(err).Str("scheduled_request_id", sr.ID.String()).Msg("failed to send a scheduled reminder")
			}
		}
	}
}

// dueReminderOffsets answers the reminder offsets due now: the moment
// (pickup − offset) has come, it came after the aggregate was created, and
// the offset was not sent yet.
func dueReminderOffsets(offsets []int, sent []int32, pickupAt, createdAt, now time.Time) []int {
	var due []int
	for _, offset := range offsets {
		moment := pickupAt.Add(-time.Duration(offset) * time.Second)
		if moment.After(now) || !moment.After(createdAt) {
			continue
		}
		already := false
		for _, s := range sent {
			if int(s) == offset {
				already = true
				break
			}
		}
		if !already {
			due = append(due, offset)
		}
	}
	return due
}
