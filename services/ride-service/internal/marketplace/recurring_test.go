package marketplace_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// postTemplate creates a recurring template; extra overrides body fields.
func postTemplate(t *testing.T, h *testutil.Harness, rider testutil.Actor, extra map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	quote := freshQuote(t, h, rider)
	minimum := moneyMinor(t, quote, "minimumFareMinor")
	body := map[string]any{
		"quoteId":            quote["quoteId"],
		"product":            marketplace.ProductScheduledRequest,
		"daysOfWeek":         []string{"mon", "wed", "fri"},
		"localTime":          "08:30",
		"startsOn":           h.Clock.Now().In(lagos).Format("2006-01-02"),
		"requestedFareMinor": moneyBody(minimum),
		"maxFareMinor":       moneyBody(minimum * 2),
		"paymentMethodId":    "wallet",
	}
	for key, value := range extra {
		body[key] = value
	}
	return h.Do(http.MethodPost, "/mp/recurring-templates", rider, body, move.IdempotencyHeader, idemKey())
}

// occurrenceDates lists a template's occurrence dates with their counts.
func occurrenceDates(t *testing.T, h *testutil.Harness, templateID string) map[string]int {
	t.Helper()
	rows, err := h.Pool.Query(context.Background(), `
		SELECT occurrence_date::text, COUNT(*) FROM mp.scheduled_requests
		WHERE template_id = $1 GROUP BY occurrence_date`, uuid.MustParse(templateID))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var date string
		var n int
		if err := rows.Scan(&date, &n); err != nil {
			t.Fatal(err)
		}
		out[date] = n
	}
	return out
}

// mondayMorning pins the clock to Monday 2026-10-05, 07:00 in Lagos.
func mondayMorning(h *testutil.Harness) {
	h.Clock.Set(time.Date(2026, 10, 5, 6, 0, 0, 0, time.UTC))
}

// TestRecurringFlagDenyByDefault: recurring journeys need their own flag
// (off by default) on top of the product's.
func TestRecurringFlagDenyByDefault(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagScheduledRides, true))
	requireCode(t, postTemplate(t, h, h.Rider(), nil), http.StatusNotFound, domain.CodeFeatureDisabled)
	// …and the product's flag: an advance series with advance reservations off.
	h2 := newHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceRecurringJourneys, true), testutil.WithFlag(cityconfig.FlagScheduledRides, true))
	requireCode(t, postTemplate(t, h2, h2.Rider(), map[string]any{"product": marketplace.ProductAdvanceReservation}),
		http.StatusNotFound, domain.CodeFeatureDisabled)
}

// TestRecurringTemplateGeneratesIndependentOccurrences: a series is stored
// apart from its occurrences; generation creates one occurrence per matching
// local date inside the horizon (never one too soon to book honestly), each
// its own intent with no driver secured — and the series itself is never
// labelled confirmed.
func TestRecurringTemplateGeneratesIndependentOccurrences(t *testing.T) {
	h := schedulingHarness(t)
	mondayMorning(h)
	rider := h.Rider()
	created := postTemplate(t, h, rider, nil)
	requireStatus(t, created, http.StatusCreated)
	template := decode(t, created)
	templateID := template["templateId"].(string)
	if template["state"] != machine.MpTemplateActive || !strings.Contains(template["seriesNote"].(string), "does not secure any other") {
		t.Fatalf("template: %v", template)
	}
	dates := occurrenceDates(t, h, templateID)
	want := []string{"2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12"}
	if len(dates) != len(want) {
		t.Fatalf("occurrences %v, want %v", dates, want)
	}
	for _, date := range want {
		if dates[date] != 1 {
			t.Fatalf("occurrence %s: %d", date, dates[date])
		}
	}
	occurrences := template["occurrences"].([]any)
	if len(occurrences) != 4 {
		t.Fatalf("the template view lists its occurrences: %d", len(occurrences))
	}
	for _, item := range occurrences {
		occurrence := item.(map[string]any)
		if occurrence["state"] != machine.MpScheduledUnassigned || occurrence["driverSecured"] != false ||
			occurrence["templateId"] != templateID || occurrence["product"] != marketplace.ProductScheduledRequest {
			t.Fatalf("each occurrence is its own unsecured intent: %v", occurrence)
		}
	}
	first := occurrences[0].(map[string]any)["schedule"].(map[string]any)
	if first["pickupAt"] != "2026-10-05T07:30:00Z" || first["localTime"] != "08:30" {
		t.Fatalf("occurrence schedule: %v", first)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM public.outbox_events WHERE name = 'mp.recurring_occurrence.generated' AND city_id = $1`, h.CityID); n != 4 {
		t.Fatalf("generated events: %d", n)
	}
	body := strings.ToLower(created.Body.String())
	if strings.Contains(body, `"state":"confirmed"`) {
		t.Fatal("a series is never confirmed")
	}
}

// TestRecurringGenerationReplaySafe: however the generation pass is
// replayed — the watermark lost, several freshly restarted workers racing —
// each (template, local date) has exactly one occurrence and one event.
func TestRecurringGenerationReplaySafe(t *testing.T) {
	h := schedulingHarness(t)
	mondayMorning(h)
	rider := h.Rider()
	created := postTemplate(t, h, rider, map[string]any{"daysOfWeek": []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"}})
	requireStatus(t, created, http.StatusCreated)
	templateID := decode(t, created)["templateId"].(string)
	before := occurrenceDates(t, h, templateID)
	if len(before) != 8 {
		t.Fatalf("daily series occurrences: %v", before)
	}

	for round := 0; round < 3; round++ {
		if _, err := h.Pool.Exec(context.Background(),
			`UPDATE mp.recurring_templates SET generated_through = NULL WHERE id = $1`, uuid.MustParse(templateID)); err != nil {
			t.Fatal(err)
		}
		workers := []*marketplace.Service{restartedService(t, h), restartedService(t, h), restartedService(t, h), h.Marketplace}
		var wg sync.WaitGroup
		for _, worker := range workers {
			wg.Add(1)
			go func(worker *marketplace.Service) {
				defer wg.Done()
				_ = worker.Sweep(context.Background())
			}(worker)
		}
		wg.Wait()
	}
	after := occurrenceDates(t, h, templateID)
	if len(after) != len(before) {
		t.Fatalf("replays created new dates: %v", after)
	}
	for date, n := range after {
		if n != 1 {
			t.Fatalf("duplicate occurrence for %s: %d", date, n)
		}
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM public.outbox_events WHERE name = 'mp.recurring_occurrence.generated' AND city_id = $1`, h.CityID); n != len(before) {
		t.Fatalf("generated events after replays: %d, want %d", n, len(before))
	}

	// A day later exactly one new date appears, once.
	h.Clock.Advance(24 * time.Hour)
	sweepOnce(t, h)
	sweepOnce(t, h)
	later := occurrenceDates(t, h, templateID)
	if len(later) != len(before)+1 || later["2026-10-13"] != 1 {
		t.Fatalf("the horizon advances by one date: %v", later)
	}
}

// TestRecurringSkipPauseResumeCancel: skip one occurrence (generated or not
// yet generated — generation never resurrects it), pause the series (nothing
// generated or published while paused), resume it, and cancel it (unpublished
// occurrences cancelled; a published one is its own trip and stands).
func TestRecurringSkipPauseResumeCancel(t *testing.T) {
	h := schedulingHarness(t)
	mondayMorning(h)
	rider := h.Rider()
	h.Wallet.SetSpendable(rider.UserID, 100_000_000)
	created := postTemplate(t, h, rider, map[string]any{"daysOfWeek": []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"}})
	requireStatus(t, created, http.StatusCreated)
	template := decode(t, created)
	templateID := template["templateId"].(string)
	path := "/mp/recurring-templates/" + templateID

	skip := h.Do(http.MethodPost, path+"/occurrences/2026-10-07/skip", rider, nil, move.IdempotencyHeader, idemKey())
	requireStatus(t, skip, http.StatusOK)
	if decode(t, skip)["state"] != machine.MpScheduledSkipped {
		t.Fatal("a generated occurrence is skipped")
	}
	future := h.Do(http.MethodPost, path+"/occurrences/2026-10-15/skip", rider, nil, move.IdempotencyHeader, idemKey())
	requireStatus(t, future, http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, path+"/occurrences/2026-10-15/skip", h.Rider(), nil, move.IdempotencyHeader, idemKey()), http.StatusNotFound)
	h.Clock.Advance(4 * 24 * time.Hour) // 2026-10-09: the horizon now reaches 10-16
	sweepOnce(t, h)
	dates := occurrenceDates(t, h, templateID)
	if dates["2026-10-15"] != 1 || dates["2026-10-16"] != 1 {
		t.Fatalf("generation continues around the skipped date: %v", dates)
	}
	skipped, err := h.Marketplace.Store().OccurrenceByDate(context.Background(), h.Pool, uuid.MustParse(templateID), "2026-10-15")
	if err != nil || skipped.State != machine.MpScheduledSkipped {
		t.Fatalf("generation never resurrects a skipped date: %+v %v", skipped, err)
	}

	// Pause: the series stops generating and publishing.
	current := h.Do(http.MethodGet, path, rider, nil)
	version := int(decode(t, current)["version"].(float64))
	pause := h.Do(http.MethodPost, path+"/pause", rider, map[string]any{"expectedVersion": version}, move.IdempotencyHeader, idemKey())
	requireStatus(t, pause, http.StatusOK)
	paused := decode(t, pause)
	if paused["state"] != machine.MpTemplatePaused {
		t.Fatalf("paused: %v", paused["state"])
	}
	target, err := h.Marketplace.Store().OccurrenceByDate(context.Background(), h.Pool, uuid.MustParse(templateID), "2026-10-10")
	if err != nil {
		t.Fatal(err)
	}
	h.Clock.Set(target.PublishAt.Add(time.Minute))
	sweepOnce(t, h)
	if sr := scheduledRow(t, h, target.ID.String()); sr.State != machine.MpScheduledUnassigned || sr.RequestID != nil {
		t.Fatalf("a paused series publishes nothing: %s", sr.State)
	}
	generatedWhilePaused := occurrenceDates(t, h, templateID)
	if _, ok := generatedWhilePaused["2026-10-17"]; ok {
		t.Fatalf("a paused series generates nothing new: %v", generatedWhilePaused)
	}

	resume := h.Do(http.MethodPost, path+"/resume", rider, map[string]any{"expectedVersion": version + 1}, move.IdempotencyHeader, idemKey())
	requireStatus(t, resume, http.StatusOK)
	sweepOnce(t, h)
	published := scheduledRow(t, h, target.ID.String())
	if published.State != machine.MpScheduledPublished || published.RequestID == nil {
		t.Fatalf("after resume the due occurrence publishes: %s (%s)", published.State, published.LastError)
	}
	if dates := occurrenceDates(t, h, templateID); dates["2026-10-17"] != 1 {
		t.Fatalf("after resume generation catches up: %v", dates)
	}

	// The series view: one occurrence published (still no driver secured),
	// the series never "confirmed".
	view := decode(t, h.Do(http.MethodGet, path, rider, nil))
	if view["state"] != machine.MpTemplateActive {
		t.Fatalf("series state: %v", view["state"])
	}

	cancel := h.Do(http.MethodPost, path+"/cancel", rider, map[string]any{"expectedVersion": int(view["version"].(float64))}, move.IdempotencyHeader, idemKey())
	requireStatus(t, cancel, http.StatusOK)
	if decode(t, cancel)["state"] != machine.MpTemplateCancelled {
		t.Fatal("cancelled")
	}
	if sr := scheduledRow(t, h, target.ID.String()); sr.State != machine.MpScheduledPublished {
		t.Fatalf("a published occurrence is its own trip and stands: %s", sr.State)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.scheduled_requests WHERE template_id = $1 AND state = ANY($2)`,
		uuid.MustParse(templateID), []string{machine.MpScheduledUnassigned, machine.MpScheduledNeedsApproval}); n != 0 {
		t.Fatalf("cancelling the series cancels its unpublished occurrences: %d left", n)
	}
	stale := h.Do(http.MethodPost, path+"/resume", rider, map[string]any{"expectedVersion": version}, move.IdempotencyHeader, idemKey())
	requireCode(t, stale, http.StatusConflict, domain.CodeVersionConflict)
}

// TestRecurringAdvanceOccurrenceBooksIndependently: an advance-reservation
// series publishes each occurrence as its own advance request; booking a
// driver for one occurrence secures that trip only — its siblings stay
// unsecured, and the series is not "confirmed".
func TestRecurringAdvanceOccurrenceBooksIndependently(t *testing.T) {
	h := schedulingHarness(t)
	mondayMorning(h)
	rider := h.Rider()
	h.Wallet.SetSpendable(rider.UserID, 100_000_000)
	created := postTemplate(t, h, rider, map[string]any{
		"product": marketplace.ProductAdvanceReservation, "daysOfWeek": []string{"tue", "thu"}, "localTime": "18:00",
	})
	requireStatus(t, created, http.StatusCreated)
	templateID := decode(t, created)["templateId"].(string)
	sweepOnce(t, h)

	rows, err := h.Marketplace.Store().OccurrencesForTemplate(context.Background(), h.Pool, uuid.MustParse(templateID), "2026-10-01", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("occurrences: %d", len(rows))
	}
	for _, sr := range rows {
		if sr.State != machine.MpScheduledPublished || sr.RequestID == nil {
			t.Fatalf("inside the booking horizon an advance occurrence takes offers at once: %s (%s)", sr.State, sr.LastError)
		}
		if request := requestRow(t, h, sr.RequestID.String()); request.BookingKind != "advance" || request.PickupWindowStart == nil ||
			!request.PickupWindowStart.Equal(sr.Schedule.PickupAt) {
			t.Fatalf("each occurrence is an advance request for its own window: %+v", request)
		}
	}

	// A driver is booked for the first occurrence only.
	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	firstRequest := rows[0].RequestID.String()
	amount := requestRow(t, h, firstRequest).RequestedMinor
	bid := advanceBid(t, h, driver, firstRequest, amount)
	requireStatus(t, bid, http.StatusCreated)
	requireStatus(t, doSelect(t, h, rider, firstRequest, map[string]any{
		"bidId": decode(t, bid)["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, ""), http.StatusAccepted)

	view := decode(t, h.Do(http.MethodGet, "/mp/recurring-templates/"+templateID, rider, nil))
	secured := 0
	for _, item := range view["occurrences"].([]any) {
		if item.(map[string]any)["driverSecured"] == true {
			secured++
		}
	}
	if secured != 1 {
		t.Fatalf("exactly the booked occurrence has a driver secured: %d", secured)
	}
	if view["state"] != machine.MpTemplateActive || !strings.Contains(view["seriesNote"].(string), "booked, approved, paid and cancellable on its own") {
		t.Fatalf("the series is never confirmed by one occurrence: %v", view["state"])
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.awards WHERE requester_id = $1`, rider.UserID); n != 1 {
		t.Fatalf("one award, for one occurrence: %d", n)
	}
}

// TestRecurringDSTOccurrences: a daily 01:30 series in New York across the
// fall-back night: with the default the ambiguous date takes the earlier
// instant (reported); with `reject` that date is recorded as skipped,
// transparently, while the other dates are unaffected.
func TestRecurringDSTOccurrences(t *testing.T) {
	h := schedulingHarness(t)
	h.Clock.Set(time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC))
	rider := h.Rider()
	daily := []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
	compatible := postTemplate(t, h, rider, map[string]any{
		"daysOfWeek": daily, "localTime": "01:30", "timeZone": "America/New_York", "startsOn": "2026-10-30", "endsOn": "2026-11-03",
	})
	requireStatus(t, compatible, http.StatusCreated)
	compatibleID := decode(t, compatible)["templateId"].(string)
	overlap, err := h.Marketplace.Store().OccurrenceByDate(context.Background(), h.Pool, uuid.MustParse(compatibleID), "2026-11-01")
	if err != nil {
		t.Fatal(err)
	}
	if overlap.State != machine.MpScheduledUnassigned || overlap.Schedule.DSTResolution != marketplace.DSTResolutionOverlapEarlier ||
		!overlap.Schedule.PickupAt.Equal(time.Date(2026, 11, 1, 5, 30, 0, 0, time.UTC)) {
		t.Fatalf("the fall-back date resolves to the earlier instant: %+v", overlap.Schedule)
	}
	after, err := h.Marketplace.Store().OccurrenceByDate(context.Background(), h.Pool, uuid.MustParse(compatibleID), "2026-11-02")
	if err != nil || !after.Schedule.PickupAt.Equal(time.Date(2026, 11, 2, 6, 30, 0, 0, time.UTC)) || after.Schedule.UTCOffsetSec != -5*3600 {
		t.Fatalf("after the change the series follows local time (EST): %+v %v", after, err)
	}

	reject := postTemplate(t, h, rider, map[string]any{
		"daysOfWeek": daily, "localTime": "01:30", "timeZone": "America/New_York", "startsOn": "2026-10-30",
		"endsOn": "2026-11-03", "dstDisambiguation": "reject",
	})
	requireStatus(t, reject, http.StatusCreated)
	rejectID := decode(t, reject)["templateId"].(string)
	skipped, err := h.Marketplace.Store().OccurrenceByDate(context.Background(), h.Pool, uuid.MustParse(rejectID), "2026-11-01")
	if err != nil || skipped.State != machine.MpScheduledSkipped || skipped.CloseReason != "dst_ambiguous_time" {
		t.Fatalf("with reject the ambiguous date is skipped, transparently: %+v %v", skipped, err)
	}
	if dates := occurrenceDates(t, h, rejectID); len(dates) != 5 {
		t.Fatalf("every other date is generated: %v", dates)
	}
}

// TestRecurringGenerationNotStarvedByStalledSeries: a batch's worth of
// active series that cannot advance (here an unreadable zone; in production
// a market whose flag was switched off) never holds the generation pass's
// queue: the pass walks every series round-robin, so a healthy series still
// gets its next occurrence.
func TestRecurringGenerationNotStarvedByStalledSeries(t *testing.T) {
	h := schedulingHarness(t)
	mondayMorning(h)
	created := postTemplate(t, h, h.Rider(), nil)
	requireStatus(t, created, http.StatusCreated)
	templateID := decode(t, created)["templateId"].(string)
	if dates := occurrenceDates(t, h, templateID); dates["2026-10-14"] != 0 {
		t.Fatalf("Wednesday 14th is beyond the first horizon: %v", dates)
	}
	// 100 stalled series (a full batch), never generated and sorting first
	// by watermark.
	if _, err := h.Pool.Exec(context.Background(), `
		INSERT INTO mp.recurring_templates (
			id, requester_id, city_id, product, service, vehicle_class, currency, state, version,
			pickup, dropoff, stops, payment_method_id, requested_minor, max_fare_minor,
			days_of_week, local_time, time_zone, window_sec, dst_disambiguation, starts_on, ends_on)
		SELECT gen_random_uuid(), gen_random_uuid(), city_id, product, service, vehicle_class, currency, state, 1,
			pickup, dropoff, stops, payment_method_id, requested_minor, max_fare_minor,
			days_of_week, local_time, 'Not/AZone', window_sec, dst_disambiguation, starts_on, ends_on
		FROM mp.recurring_templates, generate_series(1, 100)
		WHERE id = $1`, uuid.MustParse(templateID)); err != nil {
		t.Fatal(err)
	}

	h.Clock.Advance(3 * 24 * time.Hour) // Thursday: the horizon now reaches Wednesday 14th
	sweepOnce(t, h)
	sweepOnce(t, h)
	if dates := occurrenceDates(t, h, templateID); dates["2026-10-14"] != 1 {
		t.Fatalf("the healthy series generates its next occurrence despite the stalled ones: %v", dates)
	}
}
