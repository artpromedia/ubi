package marketplace_test

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// sameKeyBurst posts one body under one Idempotency-Key from several
// goroutines at once — a client retrying while its first attempt is still in
// flight — and returns every answer.
func sameKeyBurst(h *testutil.Harness, actor testutil.Actor, path string, body map[string]any, n int) []*httptest.ResponseRecorder {
	key := idemKey()
	answers := make([]*httptest.ResponseRecorder, n)
	var start, done sync.WaitGroup
	start.Add(1)
	for i := 0; i < n; i++ {
		done.Add(1)
		go func(i int) {
			defer done.Done()
			start.Wait()
			answers[i] = h.Do(http.MethodPost, path, actor, body, move.IdempotencyHeader, key)
		}(i)
	}
	start.Done()
	done.Wait()
	return answers
}

// requireOneAnswer asserts every concurrent answer is the same success,
// naming the same resource.
func requireOneAnswer(t *testing.T, answers []*httptest.ResponseRecorder, status int, idField string) string {
	t.Helper()
	id := ""
	for _, answer := range answers {
		requireStatus(t, answer, status)
		got, _ := decode(t, answer)[idField].(string)
		if got == "" {
			t.Fatalf("answer without %s: %s", idField, answer.Body.String())
		}
		if id == "" {
			id = got
		} else if got != id {
			t.Fatalf("one idempotency key answered two different resources: %s and %s", id, got)
		}
	}
	return id
}

// TestScheduledCreateConcurrentSameKeyStoresOnce: concurrent retries of one
// scheduled-request creation store ONE intent and all answer it.
func TestScheduledCreateConcurrentSameKeyStoresOnce(t *testing.T) {
	h := schedulingHarness(t)
	rider := h.Rider()
	quote := freshQuote(t, h, rider)
	minimum := moneyMinor(t, quote, "minimumFareMinor")
	body := map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(minimum),
		"maxFareMinor":       moneyBody(minimum * 2),
		"paymentMethodId":    "wallet",
		"schedule":           scheduleAt(pickupIn(h, 3*time.Hour), lagos),
	}
	answers := sameKeyBurst(h, rider, "/mp/scheduled-requests", body, 6)
	requireOneAnswer(t, answers, http.StatusCreated, "scheduledRequestId")
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.scheduled_requests WHERE requester_id = $1`, rider.UserID); n != 1 {
		t.Fatalf("one key, one stored intent: %d", n)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM public.outbox_events WHERE name = 'mp.scheduled_request.created' AND city_id = $1`, h.CityID); n != 1 {
		t.Fatalf("one key, one created event: %d", n)
	}
}

// TestAdvanceCreateConcurrentSameKeyPublishesOnce: concurrent retries of one
// advance-request creation publish ONE request and all answer it (never a
// "quote already used" refusal for the caller's own retry).
func TestAdvanceCreateConcurrentSameKeyPublishesOnce(t *testing.T) {
	h := schedulingHarness(t)
	rider := h.Rider()
	quote := freshQuote(t, h, rider)
	body := map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "minimumFareMinor")),
		"paymentMethodId":    "wallet",
		"schedule":           scheduleAt(pickupIn(h, 6*time.Hour), lagos),
	}
	answers := sameKeyBurst(h, rider, "/mp/advance-requests", body, 6)
	requireOneAnswer(t, answers, http.StatusCreated, "requestId")
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.requests WHERE requester_id = $1 AND booking_kind = 'advance'`, rider.UserID); n != 1 {
		t.Fatalf("one key, one advance request: %d", n)
	}
}

// TestRecurringCreateConcurrentSameKeyCreatesOneSeries: concurrent retries
// of one template creation create ONE series — never a duplicate series that
// would generate every trip twice — and every answer (a replay included)
// names it with its occurrences.
func TestRecurringCreateConcurrentSameKeyCreatesOneSeries(t *testing.T) {
	h := schedulingHarness(t)
	mondayMorning(h)
	rider := h.Rider()
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
	answers := sameKeyBurst(h, rider, "/mp/recurring-templates", body, 6)
	templateID := requireOneAnswer(t, answers, http.StatusCreated, "templateId")
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.recurring_templates WHERE requester_id = $1`, rider.UserID); n != 1 {
		t.Fatalf("one key, one series: %d", n)
	}
	for date, n := range occurrenceDates(t, h, templateID) {
		if n != 1 {
			t.Fatalf("occurrence %s generated %d times", date, n)
		}
	}
	for _, answer := range answers {
		if occurrences := decode(t, answer)["occurrences"].([]any); len(occurrences) != 4 {
			t.Fatalf("every answer lists the series' occurrences: %d", len(occurrences))
		}
	}
}
