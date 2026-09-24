package marketplace_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// TestScheduledRequestFlagDenyByDefault: with scheduled_rides off (the
// default) a scheduled request is feature_disabled (404), and nothing is
// stored.
func TestScheduledRequestFlagDenyByDefault(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	quote := freshQuote(t, h, rider)
	minimum := moneyMinor(t, quote, "minimumFareMinor")
	recorder := postScheduled(t, h, rider, quote, scheduleAt(pickupIn(h, 3*time.Hour), lagos), minimum, minimum*2, "wallet", "")
	requireCode(t, recorder, http.StatusNotFound, domain.CodeFeatureDisabled)
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.scheduled_requests WHERE city_id = $1`, h.CityID); n != 0 {
		t.Fatalf("a refused scheduled request stored %d rows", n)
	}
}

// TestScheduledRequestNeverClaimsADriver: a scheduled request is an intent:
// it says (in state, label and boolean) that no driver is secured, and
// until its publication time it creates no request, no bid, no award and no
// claim — however many sweeps run.
func TestScheduledRequestNeverClaimsADriver(t *testing.T) {
	h := schedulingHarness(t)
	rider := h.Rider()
	pickupAt := pickupIn(h, 3*time.Hour)
	view, _ := createScheduled(t, h, rider, pickupAt, 0)

	if view["state"] != machine.MpScheduledUnassigned || view["driverSecured"] != false {
		t.Fatalf("a new scheduled request secures no driver: %v", view)
	}
	if label, _ := view["statusLabel"].(string); !strings.Contains(label, "no driver secured") {
		t.Fatalf("the label must say no driver is secured: %q", label)
	}
	schedule := view["schedule"].(map[string]any)
	if schedule["timeZone"] != "Africa/Lagos" || schedule["dstResolution"] != "exact" || schedule["windowMinutes"] != float64(10) {
		t.Fatalf("schedule: %v", schedule)
	}
	if at, _ := time.Parse(time.RFC3339, schedule["pickupAt"].(string)); !at.Equal(pickupAt) {
		t.Fatalf("pickupAt %v, want %v", schedule["pickupAt"], pickupAt)
	}
	publishAt, _ := time.Parse(time.RFC3339, view["publishAt"].(string))
	if !publishAt.Equal(pickupAt.Add(-30 * time.Minute)) {
		t.Fatalf("publishAt %v, want the 30-min lead before %v", publishAt, pickupAt)
	}
	id := view["scheduledRequestId"].(string)
	if n := outboxCount(t, h, "mp.scheduled_request.created", id); n != 1 {
		t.Fatalf("created events: %d", n)
	}

	for i := 0; i < 3; i++ {
		h.Clock.Advance(20 * time.Minute)
		sweepOnce(t, h)
	}
	if sr := scheduledRow(t, h, id); sr.State != machine.MpScheduledUnassigned || sr.RequestID != nil {
		t.Fatalf("before its lead time the intent stays unpublished: %s %v", sr.State, sr.RequestID)
	}
	for _, table := range []string{"mp.requests", "mp.awards", "mp.bids"} {
		query := `SELECT COUNT(*) FROM ` + table + ` WHERE `
		switch table {
		case "mp.requests":
			query += `requester_id = $1`
		default:
			query += `request_id IN (SELECT id FROM mp.requests WHERE requester_id = $1)`
		}
		if n := countRows(t, h, query, rider.UserID); n != 0 {
			t.Fatalf("%s rows for an unpublished scheduled request: %d", table, n)
		}
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.driver_claims WHERE award_id IN (SELECT id FROM mp.awards WHERE requester_id = $1)`, rider.UserID); n != 0 {
		t.Fatalf("claims for a scheduled request: %d", n)
	}

	got := h.Do(http.MethodGet, "/mp/scheduled-requests/"+id, rider, nil)
	requireStatus(t, got, http.StatusOK)
	if decode(t, got)["driverSecured"] != false {
		t.Fatal("the read view must still say no driver is secured")
	}
	// Another rider cannot read it.
	requireStatus(t, h.Do(http.MethodGet, "/mp/scheduled-requests/"+id, h.Rider(), nil), http.StatusNotFound)
}

// TestScheduledRequestPublishesWithRefreshedTerms: at its lead time the
// worker re-prices the stored route, re-checks funding and publishes an
// ordinary request within the rider's approval — the ceiling tightened to
// the approved maximum — exactly once, however often the sweep replays. The
// published request still secures no driver.
func TestScheduledRequestPublishesWithRefreshedTerms(t *testing.T) {
	h := schedulingHarness(t)
	rider := h.Rider()
	h.Wallet.SetSpendable(rider.UserID, 10_000_000)
	pickupAt := pickupIn(h, 2*time.Hour)
	quoteMin := int64(0)
	view, quote := createScheduled(t, h, rider, pickupAt, 0)
	quoteMin = moneyMinor(t, quote, "minimumFareMinor")
	approvedMax := moneyMinor(t, view, "maxFareMinor")
	id := view["scheduledRequestId"].(string)

	h.Clock.Set(pickupAt.Add(-30 * time.Minute))
	sweepOnce(t, h)
	sweepOnce(t, h)

	sr := scheduledRow(t, h, id)
	if sr.State != machine.MpScheduledPublished || sr.RequestID == nil {
		t.Fatalf("at the lead time the intent publishes: %s (%s)", sr.State, sr.LastError)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.requests WHERE scheduled_request_id = $1`, sr.ID); n != 1 {
		t.Fatalf("published requests: %d, want exactly 1", n)
	}
	request := requestRow(t, h, sr.RequestID.String())
	if request.BookingKind != "scheduled" || request.State != machine.MpRequestOpen {
		t.Fatalf("published request: kind=%s state=%s", request.BookingKind, request.State)
	}
	if request.MaxMinor > approvedMax || request.MinMinor > request.RequestedMinor || request.RequestedMinor != quoteMin {
		t.Fatalf("published bounds must stay within the approval: min=%d asked=%d max=%d approved=%d",
			request.MinMinor, request.RequestedMinor, request.MaxMinor, approvedMax)
	}
	if request.QuoteID.String() == quote["quoteId"] {
		t.Fatal("publication must price a FRESH quote, not reuse the stale one")
	}
	if n := outboxCount(t, h, "mp.scheduled_request.published", id); n != 1 {
		t.Fatalf("published events: %d", n)
	}
	snapshot := h.Do(http.MethodGet, "/mp/requests/"+sr.RequestID.String(), rider, nil)
	requireStatus(t, snapshot, http.StatusOK)
	booking := decode(t, snapshot)["request"].(map[string]any)["booking"].(map[string]any)
	if booking["kind"] != "scheduled" || booking["driverSecured"] != false || booking["scheduledRequestId"] != id {
		t.Fatalf("the published request's booking block: %v", booking)
	}
	scheduled := h.Do(http.MethodGet, "/mp/scheduled-requests/"+id, rider, nil)
	requireStatus(t, scheduled, http.StatusOK)
	if body := decode(t, scheduled); body["driverSecured"] != false || body["requestState"] != "open" {
		t.Fatalf("the published intent still secures no driver: %v", body)
	}
}

// raiseFares multiplies the city's go fares, so a re-priced route's bounds
// move above an earlier approval (config-service would publish a new
// version; the harness edits the activated one).
func raiseFares(t *testing.T, h *testutil.Harness, perKmMinor int) {
	t.Helper()
	if _, err := h.Pool.Exec(context.Background(), `
		UPDATE public.city_config_versions
		SET config = jsonb_set(config, '{fares,go,perKmMinor}', to_jsonb($2::int))
		WHERE city_id = $1`, h.CityID, perKmMinor); err != nil {
		t.Fatal(err)
	}
}

// TestScheduledRequestNeedsApprovalWhenTermsLeaveApproval: refreshed bounds
// above the rider's approved maximum never publish silently — the intent
// parks in needs_rider_approval with the refreshed terms and a
// notification; the rider's renewed approval publishes it on the next pass.
func TestScheduledRequestNeedsApprovalWhenTermsLeaveApproval(t *testing.T) {
	h := schedulingHarness(t)
	rider := h.Rider()
	h.Wallet.SetSpendable(rider.UserID, 100_000_000)
	pickupAt := pickupIn(h, 2*time.Hour)
	quote := freshQuote(t, h, rider)
	minimum := moneyMinor(t, quote, "minimumFareMinor")
	created := postScheduled(t, h, rider, quote, scheduleAt(pickupAt, lagos), minimum, minimum, "wallet", "")
	requireStatus(t, created, http.StatusCreated)
	id := decode(t, created)["scheduledRequestId"].(string)

	raiseFares(t, h, 50_000)
	h.Clock.Set(pickupAt.Add(-30 * time.Minute))
	sweepOnce(t, h)

	sr := scheduledRow(t, h, id)
	if sr.State != machine.MpScheduledNeedsApproval || sr.RequestID != nil {
		t.Fatalf("terms above the approval must park, not publish: %s", sr.State)
	}
	if sr.Approval == nil || sr.Approval.Reason != "fare_above_approval" || sr.Approval.RefreshedMinMinor == nil ||
		*sr.Approval.RefreshedMinMinor <= minimum {
		t.Fatalf("the refreshed terms must be recorded: %+v", sr.Approval)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.requests WHERE requester_id = $1`, rider.UserID); n != 0 {
		t.Fatalf("nothing is published while approval is pending: %d requests", n)
	}
	if n := outboxCount(t, h, "mp.scheduled_request.needs_approval", id); n != 1 {
		t.Fatalf("needs_approval notifications: %d", n)
	}
	sweepOnce(t, h)
	if n := outboxCount(t, h, "mp.scheduled_request.needs_approval", id); n != 1 {
		t.Fatalf("a replayed sweep must not re-notify: %d", n)
	}

	view := h.Do(http.MethodGet, "/mp/scheduled-requests/"+id, rider, nil)
	requireStatus(t, view, http.StatusOK)
	body := decode(t, view)
	approval := body["approval"].(map[string]any)
	refreshedMin := moneyMinor(t, approval["refreshedTerms"].(map[string]any), "minimumFareMinor")
	if body["driverSecured"] != false || !strings.Contains(body["statusLabel"].(string), "no driver secured") {
		t.Fatalf("needs-approval view: %v", body)
	}

	// Approving below the refreshed minimum is refused.
	tooLow := h.Do(http.MethodPost, "/mp/scheduled-requests/"+id+"/approve", rider, map[string]any{
		"expectedVersion": sr.Version, "maxFareMinor": moneyBody(refreshedMin - 1),
	}, move.IdempotencyHeader, idemKey())
	requireCode(t, tooLow, http.StatusUnprocessableEntity, domain.CodeFareOutOfBounds)

	approve := h.Do(http.MethodPost, "/mp/scheduled-requests/"+id+"/approve", rider, map[string]any{
		"expectedVersion":    sr.Version,
		"maxFareMinor":       moneyBody(refreshedMin * 2),
		"requestedFareMinor": moneyBody(refreshedMin),
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, approve, http.StatusOK)
	if state := decode(t, approve)["state"]; state != machine.MpScheduledUnassigned {
		t.Fatalf("approval returns the intent to scheduled_unassigned: %v", state)
	}
	sweepOnce(t, h)
	sr = scheduledRow(t, h, id)
	if sr.State != machine.MpScheduledPublished || sr.RequestID == nil {
		t.Fatalf("the approved intent publishes on the next pass: %s (%s)", sr.State, sr.LastError)
	}
	if request := requestRow(t, h, sr.RequestID.String()); request.MaxMinor > refreshedMin*2 || request.RequestedMinor < request.MinMinor {
		t.Fatalf("published within the renewed approval: %+v", request)
	}
}

// TestScheduledRequestInsufficientFundingNeedsApproval: a wallet rider whose
// spendable cannot cover the asked fare at publication is not published into
// a failing award — the intent parks with funding_unavailable.
func TestScheduledRequestInsufficientFundingNeedsApproval(t *testing.T) {
	h := schedulingHarness(t)
	rider := h.Rider()
	pickupAt := pickupIn(h, 2*time.Hour)
	view, _ := createScheduled(t, h, rider, pickupAt, 0)
	id := view["scheduledRequestId"].(string)
	h.Wallet.SetSpendable(rider.UserID, 1)

	h.Clock.Set(pickupAt.Add(-30 * time.Minute))
	sweepOnce(t, h)
	sr := scheduledRow(t, h, id)
	if sr.State != machine.MpScheduledNeedsApproval || sr.Approval == nil || sr.Approval.Reason != "funding_unavailable" {
		t.Fatalf("unfundable publication must park for the rider: %s %+v", sr.State, sr.Approval)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.requests WHERE requester_id = $1`, rider.UserID); n != 0 {
		t.Fatalf("nothing is published without funding: %d", n)
	}

	// Past its window an unapproved intent lapses, explained.
	h.Clock.Set(pickupAt.Add(11 * time.Minute))
	sweepOnce(t, h)
	if sr := scheduledRow(t, h, id); sr.State != machine.MpScheduledExpired || sr.CloseReason != "pickup_time_passed" {
		t.Fatalf("a lapsed intent expires: %s %s", sr.State, sr.CloseReason)
	}
}

// TestScheduledRequestUnavailableSupplyEndsUnfulfilled: publication does not
// depend on supply (nothing is promised), and when no driver offers before
// the request expires the intent ends unfulfilled with the rider told —
// nothing charged, no driver ever claimed.
func TestScheduledRequestUnavailableSupplyEndsUnfulfilled(t *testing.T) {
	h := schedulingHarness(t)
	rider := h.Rider()
	h.Wallet.SetSpendable(rider.UserID, 10_000_000)
	pickupAt := pickupIn(h, 2*time.Hour)
	view, _ := createScheduled(t, h, rider, pickupAt, 0)
	id := view["scheduledRequestId"].(string)

	h.Clock.Set(pickupAt.Add(-30 * time.Minute))
	sweepOnce(t, h)
	sr := scheduledRow(t, h, id)
	if sr.State != machine.MpScheduledPublished {
		t.Fatalf("publication proceeds with no drivers online: %s (%s)", sr.State, sr.LastError)
	}
	// No driver offers; the request expires (600 s policy, capped at the
	// window's end) and closes no_offers; the intent follows.
	h.Clock.Advance(11 * time.Minute)
	sweepOnce(t, h)
	sweepOnce(t, h)
	sr = scheduledRow(t, h, id)
	if sr.State != machine.MpScheduledUnfulfilled || sr.CloseReason != "no_driver_found" {
		t.Fatalf("an intent the market left without a driver is unfulfilled: %s %s", sr.State, sr.CloseReason)
	}
	if n := outboxCount(t, h, "mp.scheduled_request.unfulfilled", id); n != 1 {
		t.Fatalf("unfulfilled notifications: %d", n)
	}
	if h.Funding.Calls != 0 {
		t.Fatalf("no funding may be authorized without an award: %d calls", h.Funding.Calls)
	}
}

// TestScheduledRequestMarketClosedAtPublication: switching the ride vertical
// off stops the sale honestly — the intent is closed unfulfilled
// (market_unavailable), never published into a market nobody can see.
func TestScheduledRequestMarketClosedAtPublication(t *testing.T) {
	h := schedulingHarness(t)
	rider := h.Rider()
	h.Wallet.SetSpendable(rider.UserID, 10_000_000)
	pickupAt := pickupIn(h, 2*time.Hour)
	view, _ := createScheduled(t, h, rider, pickupAt, 0)
	id := view["scheduledRequestId"].(string)
	if _, err := h.Pool.Exec(context.Background(),
		`UPDATE public.flag_rules SET enabled = false WHERE flag_key = $1 AND city_id = $2`,
		cityconfig.FlagMarketplaceRides, h.CityID); err != nil {
		t.Fatal(err)
	}
	h.Clock.Set(pickupAt.Add(-30 * time.Minute))
	sweepOnce(t, h)
	if sr := scheduledRow(t, h, id); sr.State != machine.MpScheduledUnfulfilled || sr.CloseReason != "market_unavailable" {
		t.Fatalf("a closed market ends the intent honestly: %s %s", sr.State, sr.CloseReason)
	}
}

// TestScheduledRequestCancelIdempotencyAndBounds: the lead/horizon rules,
// idempotent replay (and key reuse refused), the per-rider cap, and cancel
// before (allowed) versus after (refused, the request is cancelled instead)
// publication.
func TestScheduledRequestCancelIdempotencyAndBounds(t *testing.T) {
	h := schedulingHarness(t)
	rider := h.Rider()
	quote := freshQuote(t, h, rider)
	minimum := moneyMinor(t, quote, "minimumFareMinor")

	tooSoon := postScheduled(t, h, rider, quote, scheduleAt(pickupIn(h, 30*time.Minute), lagos), minimum, minimum, "wallet", "")
	requireCode(t, tooSoon, http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	tooFar := postScheduled(t, h, rider, quote, scheduleAt(pickupIn(h, 15*24*time.Hour), lagos), minimum, minimum, "wallet", "")
	requireCode(t, tooFar, http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	belowAsk := postScheduled(t, h, rider, quote, scheduleAt(pickupIn(h, 3*time.Hour), lagos), minimum, minimum-1, "wallet", "")
	requireCode(t, belowAsk, http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	card := postScheduled(t, h, rider, quote, scheduleAt(pickupIn(h, 3*time.Hour), lagos), minimum, minimum, "card", "")
	requireCode(t, card, http.StatusUnprocessableEntity, domain.CodePaymentMethodUnavailable)

	key := idemKey()
	schedule := scheduleAt(pickupIn(h, 3*time.Hour), lagos)
	first := postScheduled(t, h, rider, quote, schedule, minimum, minimum*2, "wallet", key)
	requireStatus(t, first, http.StatusCreated)
	replay := postScheduled(t, h, rider, quote, schedule, minimum, minimum*2, "wallet", key)
	requireStatus(t, replay, http.StatusCreated)
	if decode(t, first)["scheduledRequestId"] != decode(t, replay)["scheduledRequestId"] {
		t.Fatal("a replay must answer the original intent")
	}
	reuse := postScheduled(t, h, rider, quote, schedule, minimum, minimum*3, "wallet", key)
	requireCode(t, reuse, http.StatusConflict, domain.CodeIdempotencyKeyReuse)
	id := decode(t, first)["scheduledRequestId"].(string)
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.scheduled_requests WHERE requester_id = $1`, rider.UserID); n != 1 {
		t.Fatalf("stored intents: %d", n)
	}

	cancel := h.Do(http.MethodPost, "/mp/scheduled-requests/"+id+"/cancel", rider, nil, move.IdempotencyHeader, idemKey())
	requireStatus(t, cancel, http.StatusOK)
	if body := decode(t, cancel); body["state"] != machine.MpScheduledCancelled {
		t.Fatalf("cancelled: %v", body)
	}
	stranger := h.Do(http.MethodPost, "/mp/scheduled-requests/"+id+"/cancel", h.Rider(), nil, move.IdempotencyHeader, idemKey())
	requireStatus(t, stranger, http.StatusNotFound)

	// A published intent is cancelled through its request.
	h.Wallet.SetSpendable(rider.UserID, 10_000_000)
	pickupAt := pickupIn(h, 2*time.Hour)
	published, _ := createScheduled(t, h, rider, pickupAt, 0)
	publishedID := published["scheduledRequestId"].(string)
	h.Clock.Set(pickupAt.Add(-30 * time.Minute))
	sweepOnce(t, h)
	late := h.Do(http.MethodPost, "/mp/scheduled-requests/"+publishedID+"/cancel", rider, nil, move.IdempotencyHeader, idemKey())
	requireCode(t, late, http.StatusConflict, domain.CodeRequestClosed)
	if details := decode(t, late)["details"].(map[string]any); details["requestId"] == nil {
		t.Fatalf("the refusal names the request to cancel: %v", details)
	}
}

// TestScheduledRequestRemindersOnce: reminders fire once per offset, only
// for moments after the intent was made, and each says no driver is secured.
func TestScheduledRequestRemindersOnce(t *testing.T) {
	h := schedulingHarness(t)
	rider := h.Rider()
	pickupAt := pickupIn(h, 13*time.Hour)
	view, _ := createScheduled(t, h, rider, pickupAt, 0)
	id := view["scheduledRequestId"].(string)

	h.Clock.Set(pickupAt.Add(-12*time.Hour + time.Minute))
	sweepOnce(t, h)
	sweepOnce(t, h)
	if n := outboxCount(t, h, "mp.scheduled_request.reminder", id); n != 1 {
		t.Fatalf("12 h reminders: %d, want 1", n)
	}
	h.Clock.Set(pickupAt.Add(-time.Hour + time.Minute))
	sweepOnce(t, h)
	sweepOnce(t, h)
	if n := outboxCount(t, h, "mp.scheduled_request.reminder", id); n != 2 {
		t.Fatalf("reminders after the 1 h mark: %d, want 2", n)
	}
	if sr := scheduledRow(t, h, id); len(sr.RemindersSent) != 2 {
		t.Fatalf("reminders recorded: %v", sr.RemindersSent)
	}
	message := eventPayloadField(t, h, "mp.scheduled_request.reminder", id, "message")
	if !strings.Contains(message, "no driver is secured") {
		t.Fatalf("a reminder says no driver is secured: %q", message)
	}
}

// TestScheduledRequestDSTPickupsResolveExplicitly: a pickup inside a DST
// zone's spring-forward gap is refused with `reject` and shifted forward
// (reported) with the default; a fall-back overlap takes the earlier
// instant by default and the later one on request. The stored instant is
// the resolved one.
func TestScheduledRequestDSTPickupsResolveExplicitly(t *testing.T) {
	h := schedulingHarness(t)
	rider := h.Rider()
	newYork, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	// Two days before New York falls back (2026-11-01).
	h.Clock.Set(time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC))
	quote := freshQuote(t, h, rider)
	minimum := moneyMinor(t, quote, "minimumFareMinor")
	overlap := map[string]any{"localDate": "2026-11-01", "localTime": "01:30", "timeZone": "America/New_York"}

	earlier := postScheduled(t, h, rider, quote, overlap, minimum, minimum*2, "wallet", "")
	requireStatus(t, earlier, http.StatusCreated)
	schedule := decode(t, earlier)["schedule"].(map[string]any)
	if schedule["pickupAt"] != "2026-11-01T05:30:00Z" || schedule["dstResolution"] != "overlap_earlier" || schedule["utcOffset"] != "-04:00" {
		t.Fatalf("fall-back overlap, default: %v", schedule)
	}

	later := map[string]any{"localDate": "2026-11-01", "localTime": "01:30", "timeZone": "America/New_York", "dstDisambiguation": "later"}
	laterResp := postScheduled(t, h, rider, freshQuote(t, h, rider), later, minimum, minimum*2, "wallet", "")
	requireStatus(t, laterResp, http.StatusCreated)
	schedule = decode(t, laterResp)["schedule"].(map[string]any)
	if schedule["pickupAt"] != "2026-11-01T06:30:00Z" || schedule["dstResolution"] != "overlap_later" || schedule["utcOffset"] != "-05:00" {
		t.Fatalf("fall-back overlap, later: %v", schedule)
	}

	reject := map[string]any{"localDate": "2026-11-01", "localTime": "01:30", "timeZone": "America/New_York", "dstDisambiguation": "reject"}
	refused := postScheduled(t, h, rider, freshQuote(t, h, rider), reject, minimum, minimum*2, "wallet", "")
	requireCode(t, refused, http.StatusUnprocessableEntity, domain.CodeValidationFailed)

	// Spring forward: 2027-03-14 02:30 does not exist in New York.
	h.Clock.Set(time.Date(2027, 3, 12, 12, 0, 0, 0, time.UTC))
	gap := map[string]any{"localDate": "2027-03-14", "localTime": "02:30", "timeZone": "America/New_York"}
	gapResp := postScheduled(t, h, rider, freshQuote(t, h, rider), gap, minimum, minimum*2, "wallet", "")
	requireStatus(t, gapResp, http.StatusCreated)
	body := decode(t, gapResp)
	schedule = body["schedule"].(map[string]any)
	if schedule["pickupAt"] != "2027-03-14T07:30:00Z" || schedule["dstResolution"] != "gap_shifted_forward" {
		t.Fatalf("spring-forward gap, default: %v", schedule)
	}
	if label, _ := schedule["label"].(string); !strings.Contains(label, "03:30") || !strings.Contains(label, "does not exist") {
		t.Fatalf("the label must say the time was shifted: %q", label)
	}
	gapReject := map[string]any{"localDate": "2027-03-14", "localTime": "02:30", "timeZone": "America/New_York", "dstDisambiguation": "reject"}
	requireCode(t, postScheduled(t, h, rider, freshQuote(t, h, rider), gapReject, minimum, minimum*2, "wallet", ""),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)

	// A no-DST zone resolves every time exactly.
	lagosResp := postScheduled(t, h, rider, freshQuote(t, h, rider),
		map[string]any{"localDate": "2027-03-14", "localTime": "02:30", "timeZone": "Africa/Lagos", "dstDisambiguation": "reject"},
		minimum, minimum*2, "wallet", "")
	requireStatus(t, lagosResp, http.StatusCreated)
	schedule = decode(t, lagosResp)["schedule"].(map[string]any)
	if schedule["pickupAt"] != "2027-03-14T01:30:00Z" || schedule["dstResolution"] != "exact" {
		t.Fatalf("Lagos: %v", schedule)
	}

	stored := scheduledRow(t, h, body["scheduledRequestId"].(string))
	if stored.Schedule.LocalTime != "02:30" || stored.Schedule.TimeZone != newYork.String() ||
		!stored.Schedule.PickupAt.Equal(time.Date(2027, 3, 14, 7, 30, 0, 0, time.UTC)) {
		t.Fatalf("stored schedule: %+v", stored.Schedule)
	}
	_ = uuid.Nil
}

// TestScheduledRemindersReachEveryIntentInTheHorizon: the reminder pass
// walks every pending intent in its horizon, not only the soonest batch —
// with more than a batch of sooner intents pending, a later intent's 12 h
// reminder still goes out at its moment, once.
func TestScheduledRemindersReachEveryIntentInTheHorizon(t *testing.T) {
	h := schedulingHarness(t)
	soon := pickupIn(h, 3*time.Hour)
	// 10 riders × the per-rider cap of 10 = 100 sooner intents (one batch).
	for r := 0; r < 10; r++ {
		rider := h.Rider()
		quote := freshQuote(t, h, rider)
		minimum := moneyMinor(t, quote, "minimumFareMinor")
		for i := 0; i < 10; i++ {
			at := soon.Add(time.Duration(r*10+i) * time.Minute)
			requireStatus(t, postScheduled(t, h, rider, quote, scheduleAt(at, lagos), minimum, minimum*2, "wallet", ""), http.StatusCreated)
		}
	}
	later := pickupIn(h, 13*time.Hour)
	view, _ := createScheduled(t, h, h.Rider(), later, 0)
	id := view["scheduledRequestId"].(string)

	h.Clock.Set(later.Add(-12*time.Hour + time.Minute))
	sweepOnce(t, h)
	if n := outboxCount(t, h, "mp.scheduled_request.reminder", id); n != 1 {
		t.Fatalf("the later intent's 12 h reminder: %d, want 1", n)
	}
	sweepOnce(t, h)
	if n := outboxCount(t, h, "mp.scheduled_request.reminder", id); n != 1 {
		t.Fatalf("still once after another pass: %d", n)
	}
}
