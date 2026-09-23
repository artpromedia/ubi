package marketplace

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// RECURRING JOURNEYS (A03).
//
// A template is the series; its occurrences are ordinary Book for Later
// intents (mp.scheduled_requests rows carrying template_id + the local
// occurrence date, unique together). Each occurrence is either product —
// a scheduled request or an advance-reservation request — and has its own
// fare approval, funding, driver commitment, cancellation and receipt. A
// series is never "confirmed": a driver secured for one trip secures no
// other. Generation is idempotent: a replayed or concurrent pass collides
// with the unique index and creates nothing twice.

// advisoryRequesterTemplateCap serialises a requester's template creation.
const advisoryRequesterTemplateCap = int32(0x6d705254) // "mpRT"

// occurrenceCloseDSTAmbiguous marks an occurrence skipped because its local
// time does not exist (or happens twice) that day and the rider asked to
// reject such times rather than have them resolved.
const occurrenceCloseDSTAmbiguous = "dst_ambiguous_time"

// CreateTemplateBody is POST /v1/mp/recurring-templates
// (MpCreateRecurringTemplateSchema).
type CreateTemplateBody struct {
	QuoteID            uuid.UUID `json:"quoteId"`
	Product            string    `json:"product"`
	DaysOfWeek         []string  `json:"daysOfWeek"`
	LocalTime          string    `json:"localTime"`
	TimeZone           string    `json:"timeZone,omitempty"`
	StartsOn           string    `json:"startsOn"`
	EndsOn             *string   `json:"endsOn,omitempty"`
	WindowMinutes      *int      `json:"windowMinutes,omitempty"`
	DSTDisambiguation  string    `json:"dstDisambiguation,omitempty"`
	RequestedFareMinor Money     `json:"requestedFareMinor"`
	MaxFareMinor       Money     `json:"maxFareMinor"`
	PaymentMethodID    string    `json:"paymentMethodId"`
}

// TemplateCommandBody is the body of pause / resume / cancel.
type TemplateCommandBody struct {
	ExpectedVersion int `json:"expectedVersion"`
}

// productFlag is the flag a Book for Later product sells under.
func productFlag(product string) string {
	if product == ProductAdvanceReservation {
		return cityconfig.FlagMarketplaceAdvanceReservations
	}
	return cityconfig.FlagScheduledRides
}

// productTiming is the per-product timing an occurrence is generated with.
type productTiming struct {
	window     windowBounds
	minLeadSec int
	// publishAt answers when an occurrence with this pickup publishes.
	publishAt func(pickupAt, now time.Time) time.Time
}

// timingFor reads a product's timing from the market policy, failing closed.
func timingFor(product string, cityID string, policy *cityconfig.MarketplacePolicy) (*productTiming, error) {
	switch product {
	case ProductScheduledRequest:
		scheduled, err := policy.ScheduledRequestPolicyFor(cityID)
		if err != nil {
			return nil, err
		}
		return &productTiming{
			window:     windowBounds{minSec: scheduled.MinWindowSec, defaultSec: scheduled.DefaultWindowSec, maxSec: scheduled.MaxWindowSec},
			minLeadSec: scheduled.MinLeadSec,
			publishAt: func(pickupAt, _ time.Time) time.Time {
				return pickupAt.Add(-time.Duration(scheduled.PublishLeadSec) * time.Second)
			},
		}, nil
	case ProductAdvanceReservation:
		advance, err := policy.AdvanceReservationPolicyFor(cityID)
		if err != nil {
			return nil, err
		}
		return &productTiming{
			window:     windowBounds{minSec: advance.MinWindowSec, defaultSec: advance.DefaultWindowSec, maxSec: advance.MaxWindowSec},
			minLeadSec: advance.MinLeadSec,
			// An advance occurrence takes offers as soon as its pickup is
			// inside the booking horizon.
			publishAt: func(pickupAt, now time.Time) time.Time {
				at := pickupAt.Add(-time.Duration(advance.BookingHorizonSec) * time.Second)
				if at.Before(now) {
					return now
				}
				return at
			},
		}, nil
	}
	return nil, domain.Errorf(domain.CodeValidationFailed, "%q is not a Book for Later product", product).
		WithDetails(map[string]any{"field": "product"})
}

// canonicalDays validates and orders weekday names (mon … sun).
func canonicalDays(days []string) ([]string, error) {
	seen := map[string]bool{}
	for _, day := range days {
		if dayIndex(day) < 0 {
			return nil, domain.Errorf(domain.CodeValidationFailed, "%q is not a weekday (mon … sun)", day).
				WithDetails(map[string]any{"field": "daysOfWeek"})
		}
		seen[day] = true
	}
	if len(seen) == 0 {
		return nil, domain.Errorf(domain.CodeValidationFailed, "a series needs at least one weekday").
			WithDetails(map[string]any{"field": "daysOfWeek"})
	}
	out := make([]string, 0, len(seen))
	for _, day := range availabilityDays {
		if seen[day] {
			out = append(out, day)
		}
	}
	return out, nil
}

// weekdayName is the mon … sun name of a date.
func weekdayName(date time.Time) string {
	return availabilityDays[(int(date.Weekday())+6)%7]
}

// CreateRecurringTemplate stores a series and generates its first
// occurrences. Nothing is published or charged by creating it.
func (s *Service) CreateRecurringTemplate(ctx context.Context, actor Actor, body CreateTemplateBody, idempotencyKey string) (*RecurringTemplateView, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only a requester can create a recurring journey")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeTemplateCreate, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		return s.templateReplay(ctx, replay)
	}
	quote, config, policy, err := s.bookableQuote(ctx, actor, body.QuoteID, body.RequestedFareMinor, body.PaymentMethodID)
	if err != nil {
		return nil, 0, err
	}
	if err := s.requireFlag(ctx, cityconfig.FlagMarketplaceRecurringJourneys, actor, quote.CityID); err != nil {
		return nil, 0, err
	}
	timing, err := timingFor(body.Product, quote.CityID, policy)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if err := s.requireFlag(ctx, productFlag(body.Product), actor, quote.CityID); err != nil {
		return nil, 0, err
	}
	recurring, err := policy.RecurringPolicyFor(quote.CityID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if err := requireCurrency(body.MaxFareMinor, quote.Currency, "maxFareMinor"); err != nil {
		return nil, 0, err
	}
	if body.MaxFareMinor.AmountMinor < body.RequestedFareMinor.AmountMinor {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "the approved maximum cannot be below the asked fare").
			WithDetails(map[string]any{"field": "maxFareMinor"})
	}
	days, err := canonicalDays(body.DaysOfWeek)
	if err != nil {
		return nil, 0, err
	}
	zoneName := body.TimeZone
	if zoneName == "" {
		zoneName = config.Timezone
	}
	location, err := loadZone(zoneName)
	if err != nil {
		return nil, 0, err
	}
	if _, _, err := parseLocalClock(body.LocalTime); err != nil {
		return nil, 0, err
	}
	if !validDisambiguation(body.DSTDisambiguation) {
		return nil, 0, scheduleFieldError("dstDisambiguation", "%q is not a DST disambiguation", body.DSTDisambiguation)
	}
	disambiguation := body.DSTDisambiguation
	if disambiguation == "" {
		disambiguation = DSTCompatible
	}
	startsOn, err := parseLocalDate(body.StartsOn)
	if err != nil {
		return nil, 0, scheduleFieldError("startsOn", "%q is not a calendar date (YYYY-MM-DD)", body.StartsOn)
	}
	now := s.now()
	local := now.In(location)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	if startsOn.Before(today) {
		return nil, 0, scheduleFieldError("startsOn", "a series cannot start in the past")
	}
	if body.EndsOn != nil {
		endsOn, err := parseLocalDate(*body.EndsOn)
		if err != nil {
			return nil, 0, scheduleFieldError("endsOn", "%q is not a calendar date (YYYY-MM-DD)", *body.EndsOn)
		}
		if endsOn.Before(startsOn) {
			return nil, 0, scheduleFieldError("endsOn", "a series cannot end before it starts")
		}
		if endsOn.Sub(startsOn) > time.Duration(recurring.MaxSeriesDays)*24*time.Hour {
			return nil, 0, scheduleFieldError("endsOn", "a series may span at most %d days", recurring.MaxSeriesDays)
		}
	}
	windowSec := timing.window.defaultSec
	if body.WindowMinutes != nil {
		windowSec = *body.WindowMinutes * 60
	}
	if windowSec < timing.window.minSec || windowSec > timing.window.maxSec {
		return nil, 0, domain.Errorf(domain.CodeValidationFailed,
			"the pickup window must be between %d and %d minutes", timing.window.minSec/60, timing.window.maxSec/60).
			WithDetails(map[string]any{"field": "windowMinutes"})
	}

	template := &RecurringTemplate{
		ID:                uuid.New(),
		RequesterID:       actor.UserID,
		CityID:            quote.CityID,
		Product:           body.Product,
		Service:           quote.Service,
		VehicleClass:      quote.VehicleClass,
		Currency:          quote.Currency,
		State:             machine.MpTemplateActive,
		Version:           1,
		Pickup:            quote.Pickup,
		Dropoff:           quote.Dropoff,
		Stops:             quote.Stops,
		PaymentMethodID:   body.PaymentMethodID,
		RequestedMinor:    body.RequestedFareMinor.AmountMinor,
		MaxFareMinor:      body.MaxFareMinor.AmountMinor,
		DaysOfWeek:        days,
		LocalTime:         body.LocalTime,
		TimeZone:          location.String(),
		WindowSec:         windowSec,
		DSTDisambiguation: disambiguation,
		StartsOn:          body.StartsOn,
		EndsOn:            body.EndsOn,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	var replayed *IdempotentResult
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.deps.Store.AcquireCapLock(ctx, tx, advisoryRequesterTemplateCap, actor.UserID); err != nil {
			return err
		}
		// Re-checked under the requester's lock: a concurrent retry of this
		// same key that committed first is replayed — never a second series.
		if replayed, err = s.deps.Store.LookupIdempotent(ctx, tx, scopeTemplateCreate, actor.UserID, idempotencyKey, body); err != nil || replayed != nil {
			return err
		}
		live, err := s.deps.Store.ActiveTemplateCount(ctx, tx, actor.UserID)
		if err != nil {
			return err
		}
		if live >= recurring.MaxActiveTemplatesPerRequester {
			return domain.Errorf(domain.CodeRequestCapReached,
				"you already have %d recurring journeys; cancel one first", live).
				WithDetails(map[string]any{"templates": live, "maximum": recurring.MaxActiveTemplatesPerRequester})
		}
		if err := s.deps.Store.InsertTemplate(ctx, tx, template); err != nil {
			return err
		}
		if err := s.writeTemplateEvent(ctx, tx, template, "mp.recurring_template.created", "rider", actor.UserID.String(), now, nil); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role, Action: "mp.recurring_template.created",
			SubjectType: subjectTemplate, SubjectID: template.ID.String(),
			After: map[string]any{
				"product": template.Product, "daysOfWeek": template.DaysOfWeek, "localTime": template.LocalTime,
				"timeZone": template.TimeZone, "requestedMinor": template.RequestedMinor,
				"maxFareMinor": template.MaxFareMinor, "currency": template.Currency,
			},
			Reason: "requester created a recurring journey; each occurrence books separately",
		}); err != nil {
			return err
		}
		// The key is recorded WITH the series it created, so a retry after a
		// crash anywhere past this commit replays this series (see
		// templateReplay) instead of creating another.
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeTemplateCreate, actor.UserID, idempotencyKey, body, 201,
			templateViewOf(template, nil))
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replayed != nil {
		return s.templateReplay(ctx, replayed)
	}
	// The first occurrences exist as soon as the series does (the worker
	// would generate the same rows; the unique index makes the two converge).
	if _, err := s.generateOccurrences(ctx, template, now); err != nil {
		s.deps.Logger.Warn().Err(err).Str("template_id", template.ID.String()).Msg("first occurrence generation deferred to the worker")
	}
	view, err := s.templateView(ctx, template.ID)
	if err != nil {
		return nil, 0, err
	}
	return view, 201, nil
}

// templateReplay answers a replayed template creation: the SAME series the
// key created, rendered as it stands now. Its first occurrences are generated
// after the creating transaction, so a replay (which may race that original
// call, or follow a crash between the two) converges them first — generation
// is idempotent per (template, local date), so this can never duplicate one.
func (s *Service) templateReplay(ctx context.Context, replay *IdempotentResult) (*RecurringTemplateView, int, error) {
	var stored RecurringTemplateView
	if err := decodeJSON(replay.Response, &stored); err != nil {
		return nil, 0, asDomainError(err)
	}
	id, err := uuid.Parse(stored.TemplateID)
	if err != nil {
		return &stored, replay.StatusCode, nil
	}
	if template, err := s.deps.Store.TemplateByID(ctx, s.deps.Store.Pool(), id); err == nil {
		if _, err := s.generateOccurrences(ctx, template, s.now()); err != nil {
			s.deps.Logger.Warn().Err(err).Str("template_id", id.String()).Msg("occurrence generation on replay deferred to the worker")
		}
	}
	if current, err := s.templateView(ctx, id); err == nil {
		return current, replay.StatusCode, nil
	}
	return &stored, replay.StatusCode, nil
}

// writeTemplateEvent appends one mp.recurring_template.* outbox row.
func (s *Service) writeTemplateEvent(ctx context.Context, tx pgx.Tx, t *RecurringTemplate, name, actorType, actorID string, now time.Time, extra map[string]any) error {
	payload := map[string]any{
		"templateId":  t.ID.String(),
		"requesterId": t.RequesterID.String(),
		"product":     t.Product,
		"state":       t.State,
		"daysOfWeek":  t.DaysOfWeek,
		"localTime":   t.LocalTime,
		"timeZone":    t.TimeZone,
		// A series is never "confirmed" by one occurrence's award.
		"seriesConfirmed": false,
	}
	for key, value := range extra {
		payload[key] = value
	}
	return writeEvent(ctx, tx, Event{
		Name:           name,
		AggregateType:  subjectTemplate,
		AggregateID:    t.ID.String(),
		ToVersion:      t.Version,
		CityID:         t.CityID,
		ActorType:      actorType,
		ActorID:        actorID,
		IdempotencyKey: eventKey(name, t.ID.String(), itoa(t.Version)),
		OccurredAt:     now,
		Payload:        payload,
	})
}

// generateOccurrences creates a series' occurrences for the local dates
// inside the generation horizon, idempotently: each (template, local date)
// is inserted at most once, whatever replays or races. It returns how many
// rows THIS call created. A series whose flags are off generates nothing new
// (stopping sales never touches occurrences that already exist).
func (s *Service) generateOccurrences(ctx context.Context, t *RecurringTemplate, now time.Time) (int, error) {
	if t.State != machine.MpTemplateActive {
		return 0, nil
	}
	requester := t.RequesterID.String()
	if !s.flagOn(ctx, cityconfig.FlagMarketplaceRecurringJourneys, requester, t.CityID) ||
		!s.flagOn(ctx, productFlag(t.Product), requester, t.CityID) {
		return 0, nil
	}
	_, policy, err := s.policy(ctx, t.CityID)
	if err != nil {
		return 0, err
	}
	recurring, err := policy.RecurringPolicyFor(t.CityID)
	if err != nil {
		return 0, err
	}
	timing, err := timingFor(t.Product, t.CityID, policy)
	if err != nil {
		return 0, err
	}
	location, err := loadZone(t.TimeZone)
	if err != nil {
		return 0, err
	}
	local := now.In(location)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	from := today
	if startsOn, err := parseLocalDate(t.StartsOn); err == nil && startsOn.After(from) {
		from = startsOn
	}
	if t.GeneratedThrough != nil {
		if through, err := parseLocalDate(*t.GeneratedThrough); err == nil && !through.Before(from) {
			from = through.AddDate(0, 0, 1)
		}
	}
	until := today.AddDate(0, 0, recurring.GenerationHorizonDays)
	var endsOn *time.Time
	if t.EndsOn != nil {
		if parsed, err := parseLocalDate(*t.EndsOn); err == nil {
			endsOn = &parsed
			if parsed.Before(until) {
				until = parsed
			}
		}
	}
	days := map[string]bool{}
	for _, day := range t.DaysOfWeek {
		days[day] = true
	}
	windowMinutes := t.WindowSec / 60
	created := 0
	for date := from; !date.After(until); date = date.AddDate(0, 0, 1) {
		if !days[weekdayName(date)] {
			continue
		}
		dateText := date.Format("2006-01-02")
		input := ScheduleInput{
			LocalDate: dateText, LocalTime: t.LocalTime, TimeZone: t.TimeZone,
			WindowMinutes: &windowMinutes, DSTDisambiguation: t.DSTDisambiguation,
		}
		skipReason := ""
		schedule, _, err := resolveSchedule(input, t.TimeZone, timing.window)
		if err != nil && t.DSTDisambiguation == DSTReject {
			// The rider asked not to have ambiguous times resolved: the
			// occurrence is recorded as skipped, transparently.
			input.DSTDisambiguation = DSTCompatible
			if schedule, _, err = resolveSchedule(input, t.TimeZone, timing.window); err != nil {
				return created, err
			}
			skipReason = occurrenceCloseDSTAmbiguous
		} else if err != nil {
			return created, err
		}
		if schedule.PickupAt.Before(now.Add(time.Duration(timing.minLeadSec) * time.Second)) {
			// Too soon to book honestly; never generated.
			continue
		}
		occurrenceDate := dateText
		templateID := t.ID
		sr := &ScheduledRequest{
			ID:              uuid.New(),
			Product:         t.Product,
			RequesterID:     t.RequesterID,
			CityID:          t.CityID,
			Service:         t.Service,
			VehicleClass:    t.VehicleClass,
			Currency:        t.Currency,
			State:           machine.MpScheduledUnassigned,
			Version:         1,
			Pickup:          t.Pickup,
			Dropoff:         t.Dropoff,
			Stops:           t.Stops,
			PaymentMethodID: t.PaymentMethodID,
			RequestedMinor:  t.RequestedMinor,
			MaxFareMinor:    t.MaxFareMinor,
			Schedule:        *schedule,
			PublishAt:       timing.publishAt(schedule.PickupAt, now),
			TemplateID:      &templateID,
			OccurrenceDate:  &occurrenceDate,
			CloseReason:     skipReason,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if skipReason != "" {
			sr.State = machine.MpScheduledSkipped
		}
		if err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
			inserted, err := s.deps.Store.InsertScheduledRequest(ctx, tx, sr)
			if err != nil || !inserted {
				return err
			}
			created++
			if err := s.writeScheduledEvent(ctx, tx, sr, "mp.recurring_occurrence.generated", "system", "ride-service", now,
				map[string]any{"publishAt": sr.PublishAt.Format(time.RFC3339), "dstResolution": sr.Schedule.DSTResolution},
				t.ID.String(), dateText); err != nil {
				return err
			}
			if skipReason != "" {
				return s.writeScheduledEvent(ctx, tx, sr, "mp.scheduled_request.skipped", "system", "ride-service", now,
					map[string]any{"reason": skipReason}, sr.ID.String())
			}
			return nil
		}); err != nil {
			return created, err
		}
	}
	if !until.Before(from) {
		if err := s.deps.Store.AdvanceGeneratedThrough(ctx, s.deps.Store.Pool(), t.ID, until.Format("2006-01-02")); err != nil {
			return created, err
		}
	}
	if endsOn != nil && endsOn.Before(today) {
		// Everything the series will ever have is generated: it has ended.
		if err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
			locked, err := s.deps.Store.TemplateForUpdate(ctx, tx, t.ID)
			if err != nil || locked.State != machine.MpTemplateActive {
				return err
			}
			ended, err := s.deps.Store.TransitionTemplate(ctx, tx, locked, machine.MpTemplateEnded)
			if err != nil {
				return err
			}
			return s.writeTemplateEvent(ctx, tx, ended, "mp.recurring_template.ended", "system", "ride-service", now, nil)
		}); err != nil {
			return created, err
		}
	}
	return created, nil
}

// sweepRecurringGeneration is the durable generation pass: one batch of
// active series per tick, round-robin by id (the cursor is only a fairness
// hint — generation itself is idempotent, so a restart that forgets it, or
// two replicas walking in step, can never duplicate an occurrence).
func (s *Service) sweepRecurringGeneration(ctx context.Context, now time.Time) {
	s.templateCursor.mu.Lock()
	after := s.templateCursor.after
	s.templateCursor.mu.Unlock()
	templates, err := s.deps.Store.ActiveTemplatesAfter(ctx, s.deps.Store.Pool(), after, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list recurring templates")
		return
	}
	next := uuid.Nil
	if len(templates) == sweepBatch {
		next = templates[len(templates)-1].ID
	}
	s.templateCursor.mu.Lock()
	s.templateCursor.after = next
	s.templateCursor.mu.Unlock()
	for _, t := range templates {
		if _, err := s.generateOccurrences(ctx, t, now); err != nil {
			s.deps.Logger.Error().Err(err).Str("template_id", t.ID.String()).Msg("occurrence generation failed; will retry")
		}
	}
}

// templateForOwner reads a series its requester owns.
func (s *Service) templateForOwner(ctx context.Context, actor Actor, id uuid.UUID) (*RecurringTemplate, error) {
	if !actor.IsRider() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a requester has recurring journeys")
	}
	t, err := s.deps.Store.TemplateByID(ctx, s.deps.Store.Pool(), id)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && t.RequesterID != actor.UserID) {
		return nil, domain.Errorf(domain.CodeNotFound, "that recurring journey does not exist")
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	return t, nil
}

// templateView renders a series with its occurrences from a week ago on.
func (s *Service) templateView(ctx context.Context, id uuid.UUID) (*RecurringTemplateView, error) {
	t, err := s.deps.Store.TemplateByID(ctx, s.deps.Store.Pool(), id)
	if err != nil {
		return nil, asDomainError(err)
	}
	from := s.now().AddDate(0, 0, -7).Format("2006-01-02")
	rows, err := s.deps.Store.OccurrencesForTemplate(ctx, s.deps.Store.Pool(), t.ID, from, 60)
	if err != nil {
		return nil, asDomainError(err)
	}
	occurrences := make([]*ScheduledRequestView, 0, len(rows))
	paused := t.State == machine.MpTemplatePaused
	for _, sr := range rows {
		var request *Request
		if sr.RequestID != nil {
			if found, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), *sr.RequestID); err == nil {
				request = found
			}
		}
		occurrences = append(occurrences, scheduledViewOf(sr, request, paused))
	}
	return templateViewOf(t, occurrences), nil
}

// GetRecurringTemplate answers GET /v1/mp/recurring-templates/{id}.
func (s *Service) GetRecurringTemplate(ctx context.Context, actor Actor, id uuid.UUID) (*RecurringTemplateView, error) {
	if _, err := s.templateForOwner(ctx, actor, id); err != nil {
		return nil, err
	}
	return s.templateView(ctx, id)
}

// ListRecurringTemplates answers GET /v1/mp/recurring-templates.
func (s *Service) ListRecurringTemplates(ctx context.Context, actor Actor) ([]*RecurringTemplateView, error) {
	if !actor.IsRider() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a requester has recurring journeys")
	}
	templates, err := s.deps.Store.TemplatesForRequester(ctx, s.deps.Store.Pool(), actor.UserID, 50)
	if err != nil {
		return nil, asDomainError(err)
	}
	views := make([]*RecurringTemplateView, 0, len(templates))
	for _, t := range templates {
		view, err := s.templateView(ctx, t.ID)
		if err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, nil
}

// Series commands.
const (
	TemplatePause  = "pause"
	TemplateResume = "resume"
	TemplateCancel = "cancel"
)

// CommandRecurringTemplate pauses, resumes or cancels a series. Pausing stops
// generation and publication of its occurrences (an occurrence whose pickup
// passes while paused lapses); cancelling also cancels every unpublished
// occurrence. Occurrences already sent to drivers (or booked) are separate
// trips and are left to be cancelled on their own — the answer says so.
func (s *Service) CommandRecurringTemplate(ctx context.Context, actor Actor, id uuid.UUID, command string, body TemplateCommandBody, idempotencyKey string) (*RecurringTemplateView, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	if _, err := s.templateForOwner(ctx, actor, id); err != nil {
		return nil, 0, err
	}
	idemBody := map[string]any{"templateId": id.String(), "command": command, "expectedVersion": body.ExpectedVersion}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeTemplateCommand, actor.UserID, idempotencyKey, idemBody)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view RecurringTemplateView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}
	var to, event string
	switch command {
	case TemplatePause:
		to, event = machine.MpTemplatePaused, "mp.recurring_template.paused"
	case TemplateResume:
		to, event = machine.MpTemplateActive, "mp.recurring_template.resumed"
	case TemplateCancel:
		to, event = machine.MpTemplateCancelled, "mp.recurring_template.cancelled"
	default:
		return nil, 0, domain.Errorf(domain.CodeValidationFailed, "%q is not a series command", command)
	}
	now := s.now()
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.TemplateForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if locked.Version != body.ExpectedVersion {
			return domain.Errorf(domain.CodeVersionConflict, "the series changed; review it again").
				WithDetails(map[string]any{"expectedVersion": body.ExpectedVersion, "currentVersion": locked.Version})
		}
		if !machine.Can(machine.MpRecurringTemplate, locked.State, to) {
			return domain.Errorf(domain.CodeConflict, "the series cannot be %sd now", command).
				WithDetails(map[string]any{"state": locked.State})
		}
		moved, err := s.deps.Store.TransitionTemplate(ctx, tx, locked, to)
		if err != nil {
			return err
		}
		if command == TemplateResume {
			// Occurrences the pause deferred are due again right away.
			if err := s.deps.Store.ClearOccurrenceRetries(ctx, tx, id); err != nil {
				return err
			}
		}
		cancelledOccurrences := 0
		if command == TemplateCancel {
			rows, err := s.deps.Store.OccurrencesForTemplate(ctx, tx, id, "0001-01-01", 1000)
			if err != nil {
				return err
			}
			reason := "series_cancelled"
			for _, sr := range rows {
				if sr.State != machine.MpScheduledUnassigned && sr.State != machine.MpScheduledNeedsApproval {
					continue
				}
				lockedOccurrence, err := s.deps.Store.ScheduledRequestForUpdate(ctx, tx, sr.ID)
				if err != nil {
					return err
				}
				if lockedOccurrence.State != machine.MpScheduledUnassigned && lockedOccurrence.State != machine.MpScheduledNeedsApproval {
					continue
				}
				cancelled, err := s.deps.Store.TransitionScheduled(ctx, tx, lockedOccurrence, machine.MpScheduledCancelled, ScheduledUpdate{CloseReason: &reason})
				if err != nil {
					return err
				}
				if err := s.writeScheduledEvent(ctx, tx, cancelled, "mp.scheduled_request.cancelled", "rider", actor.UserID.String(), now,
					map[string]any{"reason": reason}, cancelled.ID.String()); err != nil {
					return err
				}
				cancelledOccurrences++
			}
		}
		if err := s.writeTemplateEvent(ctx, tx, moved, event, "rider", actor.UserID.String(), now,
			map[string]any{"cancelledOccurrences": cancelledOccurrences}); err != nil {
			return err
		}
		return writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role, Action: event,
			SubjectType: subjectTemplate, SubjectID: moved.ID.String(),
			Before: map[string]any{"state": locked.State},
			After:  map[string]any{"state": moved.State, "cancelledOccurrences": cancelledOccurrences},
			Reason: "requester " + command + "d a recurring journey",
		})
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if command == TemplateResume {
		if template, err := s.deps.Store.TemplateByID(ctx, s.deps.Store.Pool(), id); err == nil {
			if _, err := s.generateOccurrences(ctx, template, now); err != nil {
				s.deps.Logger.Warn().Err(err).Str("template_id", id.String()).Msg("occurrence generation after resume deferred to the worker")
			}
		}
	}
	view, err := s.templateView(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	if err := s.deps.Store.SaveIdempotent(ctx, s.deps.Store.Pool(), scopeTemplateCommand, actor.UserID, idempotencyKey, idemBody, 200, view); err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, 200, nil
}

// SkipOccurrence skips one occurrence of a series: an unpublished one moves
// to skipped; one not generated yet is recorded as skipped so generation can
// never create it; one already sent to drivers is a trip of its own and is
// cancelled through its request or booking. The rest of the series is
// untouched.
func (s *Service) SkipOccurrence(ctx context.Context, actor Actor, templateID uuid.UUID, date string, idempotencyKey string) (*ScheduledRequestView, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	t, err := s.templateForOwner(ctx, actor, templateID)
	if err != nil {
		return nil, 0, err
	}
	idemBody := map[string]any{"templateId": templateID.String(), "date": date}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeOccurrenceSkip, actor.UserID, idempotencyKey, idemBody)
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
	day, err := parseLocalDate(date)
	if err != nil {
		return nil, 0, scheduleFieldError("date", "%q is not a calendar date (YYYY-MM-DD)", date)
	}
	inSeries := false
	for _, weekday := range t.DaysOfWeek {
		if weekday == weekdayName(day) {
			inSeries = true
		}
	}
	startsOn, _ := parseLocalDate(t.StartsOn)
	if !inSeries || day.Before(startsOn) || (t.EndsOn != nil && date > *t.EndsOn) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "this series has no trip on %s", date)
	}
	now := s.now()
	var view *ScheduledRequestView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		existing, err := s.deps.Store.OccurrenceByDate(ctx, tx, templateID, date)
		if err != nil && !errors.Is(err, domain.ErrNotFound) {
			return err
		}
		reason := "skipped_by_rider"
		if existing == nil {
			_, policy, err := s.policy(ctx, t.CityID)
			if err != nil {
				return err
			}
			timing, err := timingFor(t.Product, t.CityID, policy)
			if err != nil {
				return err
			}
			windowMinutes := t.WindowSec / 60
			schedule, _, err := resolveSchedule(ScheduleInput{
				LocalDate: date, LocalTime: t.LocalTime, TimeZone: t.TimeZone,
				WindowMinutes: &windowMinutes, DSTDisambiguation: DSTCompatible,
			}, t.TimeZone, timing.window)
			if err != nil {
				return err
			}
			if !schedule.WindowEnd.After(now) {
				return domain.Errorf(domain.CodeConflict, "that trip's time has already passed")
			}
			occurrenceDate := date
			sr := &ScheduledRequest{
				ID: uuid.New(), Product: t.Product, RequesterID: t.RequesterID, CityID: t.CityID,
				Service: t.Service, VehicleClass: t.VehicleClass, Currency: t.Currency,
				State: machine.MpScheduledSkipped, Version: 1,
				Pickup: t.Pickup, Dropoff: t.Dropoff, Stops: t.Stops, PaymentMethodID: t.PaymentMethodID,
				RequestedMinor: t.RequestedMinor, MaxFareMinor: t.MaxFareMinor, Schedule: *schedule,
				PublishAt: timing.publishAt(schedule.PickupAt, now), TemplateID: &templateID,
				OccurrenceDate: &occurrenceDate, CloseReason: reason, CreatedAt: now, UpdatedAt: now,
			}
			inserted, err := s.deps.Store.InsertScheduledRequest(ctx, tx, sr)
			if err != nil {
				return err
			}
			if !inserted {
				return domain.Errorf(domain.CodeConflict, "that trip was just generated; try again")
			}
			if err := s.writeScheduledEvent(ctx, tx, sr, "mp.scheduled_request.skipped", "rider", actor.UserID.String(), now,
				map[string]any{"reason": reason}, sr.ID.String()); err != nil {
				return err
			}
			if err := writeAudit(ctx, tx, AuditRecord{
				ActorID: actor.UserID.String(), ActorRole: actor.Role, Action: "mp.scheduled_request.skipped",
				SubjectType: subjectScheduled, SubjectID: sr.ID.String(),
				After:  map[string]any{"state": sr.State, "templateId": templateID.String(), "occurrenceDate": date},
				Reason: "requester skipped one occurrence of a recurring journey before it was generated",
			}); err != nil {
				return err
			}
			view = scheduledViewOf(sr, nil, false)
			return s.deps.Store.SaveIdempotent(ctx, tx, scopeOccurrenceSkip, actor.UserID, idempotencyKey, idemBody, 200, view)
		}
		locked, err := s.deps.Store.ScheduledRequestForUpdate(ctx, tx, existing.ID)
		if err != nil {
			return err
		}
		switch locked.State {
		case machine.MpScheduledSkipped:
			view = scheduledViewOf(locked, nil, false)
		case machine.MpScheduledUnassigned, machine.MpScheduledNeedsApproval:
			moved, err := s.deps.Store.TransitionScheduled(ctx, tx, locked, machine.MpScheduledSkipped, ScheduledUpdate{CloseReason: &reason})
			if err != nil {
				return err
			}
			if err := s.writeScheduledEvent(ctx, tx, moved, "mp.scheduled_request.skipped", "rider", actor.UserID.String(), now,
				map[string]any{"reason": reason}, moved.ID.String()); err != nil {
				return err
			}
			if err := writeAudit(ctx, tx, AuditRecord{
				ActorID: actor.UserID.String(), ActorRole: actor.Role, Action: "mp.scheduled_request.skipped",
				SubjectType: subjectScheduled, SubjectID: moved.ID.String(),
				Before: map[string]any{"state": locked.State},
				After:  map[string]any{"state": moved.State, "templateId": templateID.String(), "occurrenceDate": date},
				Reason: "requester skipped one occurrence of a recurring journey",
			}); err != nil {
				return err
			}
			view = scheduledViewOf(moved, nil, false)
		case machine.MpScheduledPublished:
			details := map[string]any{"state": locked.State}
			if locked.RequestID != nil {
				details["requestId"] = locked.RequestID.String()
			}
			return domain.Errorf(domain.CodeConflict,
				"that trip was already sent to drivers; cancel its request or booking instead").WithDetails(details)
		default:
			return domain.Errorf(domain.CodeConflict, "that trip can no longer be skipped").
				WithDetails(map[string]any{"state": locked.State})
		}
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeOccurrenceSkip, actor.UserID, idempotencyKey, idemBody, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, 200, nil
}
