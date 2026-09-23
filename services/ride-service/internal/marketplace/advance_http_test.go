package marketplace_test

import (
	"context"
	"net/http"
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

// nightClock pins the harness clock to 00:00 UTC (01:00 in Lagos): the
// straight-line router's traffic multiplier is the night one for the next
// several hours, so routed durations are stable run to run.
func nightClock(h *testutil.Harness) {
	h.Clock.Set(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC))
}

// TestAdvanceReservationFlagDenyByDefault: without
// marketplace_advance_reservations (the default) an advance request is
// feature_disabled, and nothing is published.
func TestAdvanceReservationFlagDenyByDefault(t *testing.T) {
	h := newHarness(t, testutil.WithFlag(cityconfig.FlagScheduledRides, true))
	rider := h.Rider()
	quote := freshQuote(t, h, rider)
	recorder := h.Do(http.MethodPost, "/mp/advance-requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "minimumFareMinor")),
		"paymentMethodId":    "wallet",
		"schedule":           scheduleAt(pickupIn(h, 5*time.Hour), lagos),
	}, move.IdempotencyHeader, idemKey())
	requireCode(t, recorder, http.StatusNotFound, domain.CodeFeatureDisabled)
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.requests WHERE requester_id = $1`, rider.UserID); n != 0 {
		t.Fatalf("a refused advance request published %d requests", n)
	}
}

// TestAdvanceBookingWithinFundingHorizon is the advance product end to end:
// the request takes offers for a FUTURE window (no driver secured), a driver
// far outside any immediate envelope sees it as a future booking with the
// wallet commitment explained before bidding, bids manually while parked
// (commission held from the cleared balance), the requester selects that
// driver in advance: the commission is captured once, the rider's funding is
// secured (pickup inside the funding horizon), and the booking sits on the
// driver's calendar — never in the live current/next slots, which stay free
// for immediate work.
func TestAdvanceBookingWithinFundingHorizon(t *testing.T) {
	h := schedulingHarness(t)
	nightClock(h)
	rider, driver := h.Rider(), h.Driver()
	pickupAt := pickupIn(h, 4*time.Hour)
	view := createAdvance(t, h, rider, pickupAt, "wallet")
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "requestedFareMinor")

	booking := view["booking"].(map[string]any)
	if booking["kind"] != "advance" || booking["driverSecured"] != false ||
		!strings.Contains(booking["notice"].(string), "No driver is secured") {
		t.Fatalf("an advance request secures no driver until selection: %v", booking)
	}
	if expires, _ := time.Parse(time.RFC3339Nano, view["expiresAt"].(string)); !expires.Equal(h.Clock.Now().Add(time.Hour)) {
		t.Fatalf("offers run for the offer window: expiresAt %v", view["expiresAt"])
	}

	// 20 km away: outside every immediate envelope, still a future booking
	// this driver may take.
	parkDriver(t, h, driver, testutil.PlaceAt(testutil.PickupFixture(), 20_000))
	feed := h.Do(http.MethodGet, "/mp/feed", driver, nil)
	requireStatus(t, feed, http.StatusOK)
	var card map[string]any
	for _, item := range decode(t, feed)["items"].([]any) {
		if item.(map[string]any)["requestId"] == requestID {
			card = item.(map[string]any)
		}
	}
	if card == nil || card["booking"] == nil || !strings.HasPrefix(card["title"].(string), "Advance booking") {
		t.Fatalf("the feed marks the future booking with its window: %v", card)
	}

	driverView := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/driver-view", driver, nil)
	requireStatus(t, driverView, http.StatusOK)
	dv := decode(t, driverView)
	eligibility := dv["eligibility"].(map[string]any)
	if eligibility["eligible"] != true || eligibility["slot"] != "advance" {
		t.Fatalf("a parked driver is eligible for the advance slot: %v", eligibility)
	}
	commitment := dv["advanceCommitment"].(map[string]any)
	if commitment["capturedAt"] != "advance_award" || commitment["chargedAgainAtActivation"] != false ||
		commitment["heldFrom"] != "cleared_balance" || moneyMinor(t, commitment, "commissionMinor") != marketplace.CommissionMinor(amount) {
		t.Fatalf("the advance wallet commitment is explained before bidding: %v", commitment)
	}

	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	// The live slots cannot be used for a future booking.
	wrongSlot := h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId": requestID, "requestRevision": 1, "amountMinor": moneyBody(amount),
		"slot": "current", "availabilityEpoch": 0,
	}, move.IdempotencyHeader, idemKey())
	requireCode(t, wrongSlot, http.StatusConflict, domain.CodeSlotUnavailable)
	bid := advanceBid(t, h, driver, requestID, amount)
	requireStatus(t, bid, http.StatusCreated)
	bidView := decode(t, bid)
	if bidView["slot"] != "advance" || bidView["advanceCommitment"] == nil {
		t.Fatalf("the advance bid restates its commitment: %v", bidView)
	}
	if expires, _ := time.Parse(time.RFC3339Nano, bidView["expiresAt"].(string)); !expires.Equal(h.Clock.Now().Add(time.Hour)) {
		t.Fatalf("an advance bid stands for the advance bid window, bounded by the request: %v", bidView["expiresAt"])
	}
	reservation := bidView["reservationId"].(string)

	// The rider sees the offer as an advance booking, never a live ETA.
	snapshot := h.Do(http.MethodGet, "/mp/requests/"+requestID, rider, nil)
	requireStatus(t, snapshot, http.StatusOK)
	snap := decode(t, snapshot)
	if live, _ := snap["offers"].([]any); len(live) != 0 {
		t.Fatalf("an advance offer is never listed as a live offer: %v", live)
	}
	advanceOffers, _ := snap["advanceOffers"].([]any)
	if len(advanceOffers) != 1 {
		t.Fatalf("the advance offer is listed under advanceOffers: %v", snap)
	}
	offer := advanceOffers[0].(map[string]any)
	if offer["kind"] != "advance_booking" || !strings.HasPrefix(offer["pickupLabel"].(string), "Advance booking") ||
		offer["pickupWindow"] != nil {
		t.Fatalf("offer: %v", offer)
	}

	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	result := decode(t, selected)
	if result["award"].(map[string]any)["state"] != machine.MpAwardConfirmed || result["pickupPin"] != nil {
		t.Fatalf("the advance award confirms, with no PIN yet: %v", result)
	}
	selectedBooking := result["booking"].(map[string]any)
	if selectedBooking["state"] != machine.MpBookingConfirmed || selectedBooking["driverReserved"] != true ||
		selectedBooking["fullySecured"] != true || selectedBooking["funding"].(map[string]any)["state"] != "secured" {
		t.Fatalf("inside the funding horizon the booking is fully secured: %v", selectedBooking)
	}

	award := awardRow(t, h, requestID)
	if award.Slot != marketplace.SlotAdvance || award.State != machine.MpAwardConfirmed || award.ExecutionID != nil {
		t.Fatalf("advance award: %+v", award)
	}
	if h.Wallet.CapturesByReservation[reservation] != 1 {
		t.Fatalf("the commission is captured once at the advance award: %d", h.Wallet.CapturesByReservation[reservation])
	}
	if h.Funding.FundedAmount(award.ID) != amount {
		t.Fatalf("rider funding secured for the fare: %d", h.Funding.FundedAmount(award.ID))
	}
	if request := requestRow(t, h, requestID); request.State != machine.MpRequestAwarded {
		t.Fatalf("the request is awarded (not executing) until activation: %s", request.State)
	}
	driverHasNoClaims(t, h, driver.UserID)
	b := bookingOfAward(t, h, award.ID)
	if outboxCount(t, h, "mp.advance_booking.held", b.ID.String()) != 1 ||
		outboxCount(t, h, "mp.advance_booking.confirmed", b.ID.String()) != 1 {
		t.Fatal("the booking's transitions are published")
	}
	if !b.OccupiedStart.Equal(pickupAt.Add(-10*time.Minute)) || !b.OccupiedEnd.After(b.WindowEnd.Add(10*time.Minute)) {
		t.Fatalf("the calendar interval covers the window, the routed trip and the buffers: %v – %v", b.OccupiedStart, b.OccupiedEnd)
	}

	calendar := h.Do(http.MethodGet, "/mp/driver/calendar", driver, nil)
	requireStatus(t, calendar, http.StatusOK)
	entries := decode(t, calendar)["bookings"].([]any)
	if len(entries) != 1 || entries[0].(map[string]any)["viewer"] != "driver" || entries[0].(map[string]any)["commissionMinor"] == nil {
		t.Fatalf("the driver's calendar holds the booking: %v", entries)
	}
	riderView := h.Do(http.MethodGet, "/mp/advance-bookings/"+b.ID.String(), rider, nil)
	requireStatus(t, riderView, http.StatusOK)
	rv := decode(t, riderView)
	if rv["driver"] == nil || rv["commissionMinor"] != nil || !strings.Contains(strings.Join(toStrings(rv["notices"]), " "), "not guaranteed") {
		t.Fatalf("the rider's booking view: %v", rv)
	}
	requireStatus(t, h.Do(http.MethodGet, "/mp/advance-bookings/"+b.ID.String(), h.Rider(), nil), http.StatusNotFound)
	requireStatus(t, h.Do(http.MethodGet, "/mp/advance-bookings/"+b.ID.String(), h.Driver(), nil), http.StatusNotFound)

	// The future booking does not occupy today's queue: the same driver,
	// parked at a fresh pickup, is eligible for immediate work right now.
	immediate, _ := publishAt(t, h, h.Rider(), 0)
	ingestPoints(t, h, driver, []map[string]any{
		point(10, testutil.PickupFixture(), h.Clock.Now().Add(-90*time.Second), 0),
		point(11, testutil.PickupFixture(), h.Clock.Now().Add(-60*time.Second), 0),
		point(12, testutil.PickupFixture(), h.Clock.Now().Add(-30*time.Second), 0),
		point(13, testutil.PickupFixture(), h.Clock.Now().Add(-time.Second), 0),
	})
	requireStatus(t, h.Do(http.MethodPost, "/mp/driver/parked", driver, nil), http.StatusOK)
	immediateView := h.Do(http.MethodGet, "/mp/requests/"+immediate["requestId"].(string)+"/driver-view", driver, nil)
	requireStatus(t, immediateView, http.StatusOK)
	if e := decode(t, immediateView)["eligibility"].(map[string]any); e["eligible"] != true || e["slot"] != "current" {
		t.Fatalf("a driver with a future booking keeps their current slot: %v", e)
	}
}

func toStrings(value any) []string {
	var out []string
	for _, item := range value.([]any) {
		out = append(out, item.(string))
	}
	return out
}

// TestAdvanceBookingBeyondFundingHorizonIsPaymentPending: beyond the funding
// horizon nothing is authorized at the award — the driver is reserved (and
// their commission captured once) but the booking is payment_pending, stated
// as not fully secured; when the pickup enters the horizon the worker
// secures funding under the award's one key, exactly once.
func TestAdvanceBookingBeyondFundingHorizonIsPaymentPending(t *testing.T) {
	h := schedulingHarness(t)
	f := bookAdvance(t, h, 72*time.Hour, "wallet")

	if f.booking.State != machine.MpBookingPaymentPending || f.booking.FundingState != marketplace.BookingFundingPending {
		t.Fatalf("beyond the funding horizon: %s / %s", f.booking.State, f.booking.FundingState)
	}
	selected := f.selected["booking"].(map[string]any)
	if selected["driverReserved"] != true || selected["fullySecured"] != false {
		t.Fatalf("payment_pending is distinguished from a fully secured booking: %v", selected)
	}
	if notices := strings.Join(toStrings(selected["notices"]), " "); !strings.Contains(notices, "not fully secured") {
		t.Fatalf("the rider is told the booking is not fully secured: %q", notices)
	}
	if h.Funding.EffectiveCalls != 0 {
		t.Fatalf("no funding may be authorized beyond the horizon: %d", h.Funding.EffectiveCalls)
	}
	if h.Wallet.CapturesByReservation[f.reservationID] != 1 {
		t.Fatalf("the commission is captured at the advance award: %d", h.Wallet.CapturesByReservation[f.reservationID])
	}

	sweepOnce(t, h)
	if b := f.reload(t); b.State != machine.MpBookingPaymentPending {
		t.Fatalf("funding is not due yet: %s", b.State)
	}
	h.Clock.Set(f.booking.FundingDueAt.Add(time.Minute))
	sweepOnce(t, h)
	sweepOnce(t, h)
	b := f.reload(t)
	if b.State != machine.MpBookingConfirmed || b.FundingState != marketplace.BookingFundingSecured {
		t.Fatalf("inside the horizon the worker secures funding: %s / %s (%s)", b.State, b.FundingState, b.LastError)
	}
	if h.Funding.EffectiveCalls != 1 || h.Funding.FundedAmount(f.award.ID) != f.amount {
		t.Fatalf("exactly one funding reservation for the fare: calls %d funded %d", h.Funding.EffectiveCalls, h.Funding.FundedAmount(f.award.ID))
	}
	if outboxCount(t, h, "mp.advance_booking.funding_secured", b.ID.String()) != 1 {
		t.Fatal("funding_secured is published once")
	}
}

// TestAdvanceBookingFundingRefusedThenReleasedAtDeadline: a refused
// authorization is reported to the rider and retried; still unsecured at the
// funding deadline, the booking is released with the outcome explained —
// the driver's commission returned (once), nothing charged to the rider.
func TestAdvanceBookingFundingRefusedThenReleasedAtDeadline(t *testing.T) {
	h := schedulingHarness(t)
	f := bookAdvance(t, h, 72*time.Hour, "wallet")
	h.Funding.Fail = domain.Errorf(domain.CodeInsufficientFunds, "the wallet cannot cover this fare")

	h.Clock.Set(f.booking.FundingDueAt.Add(time.Minute))
	sweepOnce(t, h)
	b := f.reload(t)
	if b.State != machine.MpBookingPaymentPending || b.FundingState != marketplace.BookingFundingRefused {
		t.Fatalf("a refused authorization keeps the booking payment_pending: %s / %s", b.State, b.FundingState)
	}
	if outboxCount(t, h, "mp.advance_booking.funding_refused", b.ID.String()) != 1 {
		t.Fatal("the rider is told funding was refused")
	}

	h.Clock.Set(f.booking.FundingDeadline.Add(time.Minute))
	sweepOnce(t, h)
	sweepOnce(t, h)
	b = f.reload(t)
	if b.State != machine.MpBookingFailed || b.Failure == nil || b.Failure.Reason != marketplace.BookingFailFundingNotSecured {
		t.Fatalf("unsecured at the deadline, the booking is released: %s %+v", b.State, b.Failure)
	}
	if h.Wallet.ReversalsByReservation[f.reservationID] != 1 {
		t.Fatalf("the captured commission is returned exactly once: %d", h.Wallet.ReversalsByReservation[f.reservationID])
	}
	if award := awardRow(t, h, f.requestID); award.State != machine.MpAwardCancelled {
		t.Fatalf("award: %s", award.State)
	}
	if request := requestRow(t, h, f.requestID); request.State != machine.MpRequestCancelled || request.CloseReason != "booking_failed" {
		t.Fatalf("request: %s / %s", request.State, request.CloseReason)
	}
	view := h.Do(http.MethodGet, f.bookingPath(""), f.rider, nil)
	requireStatus(t, view, http.StatusOK)
	failure := decode(t, view)["failure"].(map[string]any)
	outcome := failure["financialOutcome"].(map[string]any)
	if outcome["riderCharged"] != false || outcome["commissionReversed"] != true || failure["message"] == "" {
		t.Fatalf("the failure explains the financial outcome: %v", failure)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.reservation_recovery WHERE bid_id = $1 AND resolved_at IS NULL`, uuid.MustParse(f.bidID)); n != 0 {
		t.Fatalf("the reversal intent is resolved: %d open", n)
	}
}

// TestAdvanceCalendarRefusesOverlapAndTravelConflicts: a driver's committed
// booking blocks every other advance request whose buffered interval
// overlaps it (eligibility says CALENDAR_CONFLICT, the bid is refused), and
// also one that does not overlap but cannot be reached in time from the
// booking's dropoff; a reachable later request is fine.
func TestAdvanceCalendarRefusesOverlapAndTravelConflicts(t *testing.T) {
	h := schedulingHarness(t)
	nightClock(h)
	f := bookAdvance(t, h, 5*time.Hour, "wallet")
	other := h.Rider()

	overlapping := createAdvance(t, h, other, f.pickupAt.Add(20*time.Minute), "wallet")
	dv := h.Do(http.MethodGet, "/mp/requests/"+overlapping["requestId"].(string)+"/driver-view", f.driver, nil)
	requireStatus(t, dv, http.StatusOK)
	eligibility := decode(t, dv)["eligibility"].(map[string]any)
	if eligibility["eligible"] != false || !reasonListed(eligibility, marketplace.ReasonCalendarConflict) {
		t.Fatalf("an overlapping window is a calendar conflict: %v", eligibility)
	}
	refused := advanceBid(t, h, f.driver, overlapping["requestId"].(string), moneyMinor(t, overlapping, "requestedFareMinor"))
	requireCode(t, refused, http.StatusConflict, domain.CodeSlotUnavailable)

	// Just after the booking's interval, but 40 km from its dropoff: the
	// travel between consecutive bookings does not fit.
	gapStart := f.booking.OccupiedEnd.Add(15 * time.Minute).Truncate(time.Minute).Add(time.Minute)
	far := testutil.PlaceAt(testutil.DropoffFixture(), 40_000)
	unreachable := createAdvanceRoute(t, h, other, far, testutil.PlaceAt(far, 5_000), gapStart)
	dv = h.Do(http.MethodGet, "/mp/requests/"+unreachable+"/driver-view", f.driver, nil)
	requireStatus(t, dv, http.StatusOK)
	if e := decode(t, dv)["eligibility"].(map[string]any); e["eligible"] != false || !reasonListed(e, marketplace.ReasonCalendarConflict) {
		t.Fatalf("an unreachable next booking is a calendar conflict: %v", e)
	}
	// The same slot starting at the booking's own dropoff is reachable.
	reachable := createAdvanceRoute(t, h, other, testutil.DropoffFixture(), testutil.PlaceAt(testutil.DropoffFixture(), 5_000), gapStart)
	dv = h.Do(http.MethodGet, "/mp/requests/"+reachable+"/driver-view", f.driver, nil)
	requireStatus(t, dv, http.StatusOK)
	if e := decode(t, dv)["eligibility"].(map[string]any); e["eligible"] != true || e["slot"] != "advance" {
		t.Fatalf("a reachable next booking fits the calendar: %v", e)
	}
}

func reasonListed(eligibility map[string]any, code string) bool {
	for _, item := range eligibility["reasons"].([]any) {
		if item.(map[string]any)["code"] == code {
			return true
		}
	}
	return false
}

// createAdvanceRoute publishes an advance request for a custom route.
func createAdvanceRoute(t *testing.T, h *testutil.Harness, rider testutil.Actor, pickup, dropoff domain.Place, pickupAt time.Time) string {
	t.Helper()
	quote := quoteEnvelope(t, h, rider, pickup, dropoff)
	recorder := h.Do(http.MethodPost, "/mp/advance-requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "minimumFareMinor")),
		"paymentMethodId":    "wallet",
		"schedule":           scheduleAt(pickupAt, lagos),
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, recorder, http.StatusCreated)
	return decode(t, recorder)["requestId"].(string)
}

// TestAdvanceCalendarConcurrentSelectionsExactlyOne: one driver offers on
// two overlapping future windows (legal — nothing is committed yet) and both
// requesters select at the same instant. The calendar lock and the btree_gist
// exclusion constraint let exactly one booking commit; the other selection
// is refused and its hold released — never two overlapping commitments.
func TestAdvanceCalendarConcurrentSelectionsExactlyOne(t *testing.T) {
	h := schedulingHarness(t)
	nightClock(h)
	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	pickupAt := pickupIn(h, 6*time.Hour)

	type side struct {
		rider     testutil.Actor
		requestID string
		bidID     string
	}
	sides := []*side{{rider: h.Rider()}, {rider: h.Rider()}}
	for i, s := range sides {
		view := createAdvance(t, h, s.rider, pickupAt.Add(time.Duration(i)*15*time.Minute), "wallet")
		s.requestID = view["requestId"].(string)
		bid := advanceBid(t, h, driver, s.requestID, moneyMinor(t, view, "requestedFareMinor"))
		requireStatus(t, bid, http.StatusCreated)
		s.bidID = decode(t, bid)["bidId"].(string)
	}

	statuses := make([]int, len(sides))
	codes := make([]string, len(sides))
	var start sync.WaitGroup
	var done sync.WaitGroup
	start.Add(1)
	for i, s := range sides {
		done.Add(1)
		go func(i int, s *side) {
			defer done.Done()
			start.Wait()
			recorder := h.Do(http.MethodPost, "/mp/requests/"+s.requestID+"/select", s.rider, map[string]any{
				"bidId": s.bidID, "requestVersion": 1, "bidVersion": 1,
			}, move.IdempotencyHeader, idemKey())
			statuses[i] = recorder.Code
			if recorder.Code != http.StatusAccepted {
				codes[i] = recorder.Body.String()
			}
		}(i, s)
	}
	start.Done()
	done.Wait()

	accepted := 0
	for i, status := range statuses {
		if status == http.StatusAccepted {
			accepted++
		} else if status != http.StatusConflict || !strings.Contains(codes[i], string(domain.CodeSlotUnavailable)) {
			t.Fatalf("a losing selection is a calendar conflict, got %d %s", status, codes[i])
		}
	}
	if accepted != 1 {
		t.Fatalf("exactly one overlapping selection may win: statuses %v", statuses)
	}
	occupying := countRows(t, h, `SELECT COUNT(*) FROM mp.advance_bookings WHERE driver_id = $1 AND state = ANY($2)`,
		driver.UserID, machine.MpBookingOccupyingStates())
	if occupying != 1 {
		t.Fatalf("the calendar holds exactly one of the overlapping bookings: %d", occupying)
	}
	confirmed := countRows(t, h, `SELECT COUNT(*) FROM mp.awards WHERE driver_id = $1 AND state = 'confirmed'`, driver.UserID)
	if confirmed != 1 {
		t.Fatalf("confirmed awards: %d", confirmed)
	}
	// The loser's offer can no longer stand: the winner's award invalidates
	// it (the calendar cannot take it) and its hold is released once.
	won := 0
	for _, s := range sides {
		bid := bidRow(t, h, s.bidID)
		if bid.State == machine.MpBidWon {
			won++
			continue
		}
		if bid.State != machine.MpBidInvalidated || releasesFor(h, bid.ReservationID) != 1 {
			t.Fatalf("the losing bid is invalidated with its hold released once: %s, %d releases", bid.State, releasesFor(h, bid.ReservationID))
		}
	}
	if won != 1 {
		t.Fatalf("won bids: %d", won)
	}
}

// TestAdvanceCalendarExclusionConstraints: the database itself refuses
// overlapping committed intervals — for one driver, and for one vehicle
// shared by two drivers (vehicle identity is the fleet slice's to supply;
// the constraint enforces it the moment it is set) — while a vehicle's
// non-overlapping bookings are fine.
func TestAdvanceCalendarExclusionConstraints(t *testing.T) {
	h := schedulingHarness(t)
	nightClock(h)
	first := bookAdvance(t, h, 5*time.Hour, "wallet")
	second := bookAdvance(t, h, 5*time.Hour, "wallet") // another driver, same window
	later := bookAdvance(t, h, 9*time.Hour, "wallet")  // a third driver, hours later
	ctx := context.Background()

	_, err := h.Pool.Exec(ctx, `UPDATE mp.advance_bookings SET driver_id = $2 WHERE id = $1`, second.booking.ID, first.driver.UserID)
	if !isExclusion(err, "advance_bookings_no_overlap") {
		t.Fatalf("two overlapping bookings for one driver must be refused by the database: %v", err)
	}

	if _, err := h.Pool.Exec(ctx, `UPDATE mp.advance_bookings SET vehicle_id = 'veh-shared' WHERE id = $1`, first.booking.ID); err != nil {
		t.Fatal(err)
	}
	_, err = h.Pool.Exec(ctx, `UPDATE mp.advance_bookings SET vehicle_id = 'veh-shared' WHERE id = $1`, second.booking.ID)
	if !isExclusion(err, "advance_bookings_vehicle_no_overlap") {
		t.Fatalf("one vehicle with two drivers in overlapping windows must be refused: %v", err)
	}
	if _, err := h.Pool.Exec(ctx, `UPDATE mp.advance_bookings SET vehicle_id = 'veh-shared' WHERE id = $1`, later.booking.ID); err != nil {
		t.Fatalf("the shared vehicle's non-overlapping booking is fine: %v", err)
	}
	// A released booking stops occupying its interval.
	if _, err := h.Pool.Exec(ctx, `UPDATE mp.advance_bookings SET state = 'cancelled' WHERE id = $1`, first.booking.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Pool.Exec(ctx, `UPDATE mp.advance_bookings SET vehicle_id = 'veh-shared' WHERE id = $1`, second.booking.ID); err != nil {
		t.Fatalf("an ended booking frees the vehicle's interval: %v", err)
	}
}

func isExclusion(err error, constraint string) bool {
	return err != nil && strings.Contains(err.Error(), "SQLSTATE 23P01") && strings.Contains(err.Error(), constraint)
}

// TestAdvanceBookingDriverSuspendedNearPickup: a driver who loses marketplace
// eligibility (an approved suspension) is not silently kept or replaced:
// near pickup the booking fails with the reason explained, the commission is
// returned, the rider's funding released and nothing charged.
func TestAdvanceBookingDriverSuspendedNearPickup(t *testing.T) {
	h := schedulingHarness(t)
	f := bookAdvance(t, h, 4*time.Hour, "wallet")
	suspend(t, h, f.driver)

	sweepOnce(t, h)
	if b := f.reload(t); b.State != machine.MpBookingConfirmed {
		t.Fatalf("eligibility is judged near pickup: %s", b.State)
	}
	h.Clock.Set(f.booking.ReconfirmOpensAt.Add(time.Minute))
	sweepOnce(t, h)
	b := f.reload(t)
	if b.State != machine.MpBookingFailed || b.Failure == nil || b.Failure.Reason != marketplace.BookingFailDriverIneligible {
		t.Fatalf("a suspended driver's booking fails: %s %+v", b.State, b.Failure)
	}
	if h.Wallet.ReversalsByReservation[f.reservationID] != 1 {
		t.Fatalf("commission returned once: %d", h.Wallet.ReversalsByReservation[f.reservationID])
	}
	if _, released := h.Funding.ReleasedAwards[f.award.ID]; !released {
		t.Fatal("the rider's funding reservation is released")
	}
	if b.Failure.RematchAvailable {
		t.Fatal("two hours out there is no time for another advance booking; the rider is told to request a ride")
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.awards WHERE request_id = $1 AND state IN ('pending','confirmed')`, uuid.MustParse(f.requestID)); n != 0 {
		t.Fatalf("no other driver is silently substituted: %d live awards", n)
	}
}

// TestAdvanceBookingMissedReconfirmation: the driver is asked (once) to
// reconfirm when the window opens; a driver who misses the deadline loses the
// booking, the rider is told and nothing is charged; a late reconfirmation
// is refused.
func TestAdvanceBookingMissedReconfirmation(t *testing.T) {
	h := schedulingHarness(t)
	f := bookAdvance(t, h, 4*time.Hour, "wallet")
	early := h.Do(http.MethodPost, f.bookingPath("/reconfirm"), f.driver, nil, move.IdempotencyHeader, idemKey())
	requireCode(t, early, http.StatusConflict, domain.CodeConflict)

	h.Clock.Set(f.booking.ReconfirmOpensAt.Add(time.Minute))
	sweepOnce(t, h)
	sweepOnce(t, h)
	if outboxCount(t, h, "mp.advance_booking.reconfirm_requested", f.booking.ID.String()) != 1 {
		t.Fatal("the driver is asked to reconfirm exactly once")
	}
	h.Clock.Set(f.booking.ReconfirmDeadline.Add(time.Minute))
	sweepOnce(t, h)
	b := f.reload(t)
	if b.State != machine.MpBookingFailed || b.Failure.Reason != marketplace.BookingFailReconfirmMissed {
		t.Fatalf("a missed reconfirmation fails the booking: %s %+v", b.State, b.Failure)
	}
	if h.Wallet.ReversalsByReservation[f.reservationID] != 1 {
		t.Fatal("the commission is returned once")
	}
	late := h.Do(http.MethodPost, f.bookingPath("/reconfirm"), f.driver, nil, move.IdempotencyHeader, idemKey())
	requireCode(t, late, http.StatusConflict, domain.CodeConflict)
}

// TestAdvanceBookingDriverWithdrawsAndRiderRematches: a driver who cannot
// attend withdraws; the rider is told why and what happened to the money,
// and is OFFERED a rematch — which happens only on the rider's consent, as a
// fresh advance request for the same window at the same asked fare (never
// silently raised, never silently assigned).
func TestAdvanceBookingDriverWithdrawsAndRiderRematches(t *testing.T) {
	h := schedulingHarness(t)
	f := bookAdvance(t, h, 8*time.Hour, "wallet")
	requireStatus(t, h.Do(http.MethodPost, f.bookingPath("/withdraw"), h.Driver(),
		map[string]any{"reason": "not mine"}, move.IdempotencyHeader, idemKey()), http.StatusNotFound)

	withdraw := h.Do(http.MethodPost, f.bookingPath("/withdraw"), f.driver,
		map[string]any{"reason": "vehicle in the workshop"}, move.IdempotencyHeader, idemKey())
	requireStatus(t, withdraw, http.StatusOK)
	if decode(t, withdraw)["state"] != machine.MpBookingFailed {
		t.Fatal("a withdrawal fails the booking")
	}
	if h.Wallet.ReversalsByReservation[f.reservationID] != 1 {
		t.Fatalf("commission returned once: %d", h.Wallet.ReversalsByReservation[f.reservationID])
	}
	view := h.Do(http.MethodGet, f.bookingPath(""), f.rider, nil)
	requireStatus(t, view, http.StatusOK)
	failure := decode(t, view)["failure"].(map[string]any)
	if failure["reason"] != marketplace.BookingFailDriverWithdrew || failure["rematchAvailable"] != true ||
		failure["financialOutcome"].(map[string]any)["riderCharged"] != false {
		t.Fatalf("the rider is told what happened and offered a rematch: %v", failure)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.requests WHERE requester_id = $1`, f.rider.UserID); n != 1 {
		t.Fatalf("nothing is re-published without the rider's consent: %d requests", n)
	}

	rematch := h.Do(http.MethodPost, f.bookingPath("/rematch"), f.rider, nil, move.IdempotencyHeader, idemKey())
	requireStatus(t, rematch, http.StatusCreated)
	fresh := decode(t, rematch)
	if moneyMinor(t, fresh, "requestedFareMinor") != f.amount {
		t.Fatalf("the rematch asks the same fare: %d vs %d", moneyMinor(t, fresh, "requestedFareMinor"), f.amount)
	}
	booking := fresh["booking"].(map[string]any)
	if booking["kind"] != "advance" || booking["driverSecured"] != false {
		t.Fatalf("a rematch is a fresh request with no driver secured: %v", booking)
	}
	if start, _ := time.Parse(time.RFC3339, booking["schedule"].(map[string]any)["windowStart"].(string)); !start.Equal(f.booking.WindowStart) {
		t.Fatalf("the rematch keeps the window: %v", booking["schedule"])
	}
	freshID := fresh["requestId"].(string)
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.bids WHERE request_id = $1`, uuid.MustParse(freshID)); n != 0 {
		t.Fatalf("no driver is silently attached to the rematch: %d bids", n)
	}
	again := h.Do(http.MethodPost, f.bookingPath("/rematch"), f.rider, nil, move.IdempotencyHeader, idemKey())
	requireCode(t, again, http.StatusConflict, domain.CodeConflict)
	if b := f.reload(t); b.RematchRequestID == nil || b.RematchRequestID.String() != freshID {
		t.Fatalf("the booking links its rematch: %v", b.RematchRequestID)
	}
}

// TestAdvanceBookingRiderCancel: the rider cancels before activation: the
// award is cancelled, the driver's commission returned, the rider's funding
// released — and the calendar interval freed. The cancel replays
// idempotently.
func TestAdvanceBookingRiderCancel(t *testing.T) {
	h := schedulingHarness(t)
	f := bookAdvance(t, h, 5*time.Hour, "wallet")
	key := idemKey()
	cancel := h.Do(http.MethodPost, f.bookingPath("/cancel"), f.rider, nil, move.IdempotencyHeader, key)
	requireStatus(t, cancel, http.StatusOK)
	replay := h.Do(http.MethodPost, f.bookingPath("/cancel"), f.rider, nil, move.IdempotencyHeader, key)
	requireStatus(t, replay, http.StatusOK)
	if decode(t, cancel)["state"] != machine.MpBookingCancelled || decode(t, replay)["state"] != machine.MpBookingCancelled {
		t.Fatal("cancelled, idempotently")
	}
	if h.Wallet.ReversalsByReservation[f.reservationID] != 1 {
		t.Fatalf("commission returned exactly once: %d", h.Wallet.ReversalsByReservation[f.reservationID])
	}
	if _, released := h.Funding.ReleasedAwards[f.award.ID]; !released {
		t.Fatal("rider funding released")
	}
	if request := requestRow(t, h, f.requestID); request.State != machine.MpRequestCancelled || request.CloseReason != "cancelled" {
		t.Fatalf("request: %s / %s", request.State, request.CloseReason)
	}
	calendar := h.Do(http.MethodGet, "/mp/driver/calendar", f.driver, nil)
	requireStatus(t, calendar, http.StatusOK)
	if entries := decode(t, calendar)["bookings"].([]any); len(entries) != 0 {
		t.Fatalf("a cancelled booking leaves the calendar: %v", entries)
	}
}

// completeTrip drives an execution ride through arrival, PIN, start and
// completion with the PIN the rider retrieves over REST.
func completeTrip(t *testing.T, h *testutil.Harness, rider, driver testutil.Actor, requestID string, rideID uuid.UUID, seq int64) {
	t.Helper()
	ingestPoints(t, h, driver, []map[string]any{point(seq, testutil.PickupFixture(), h.Clock.Now().Add(-time.Second), 0)})
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/arrived", driver, map[string]any{}), http.StatusOK)
	pinResp := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/pin", rider, nil)
	requireStatus(t, pinResp, http.StatusOK)
	pin, _ := decode(t, pinResp)["pin"].(string)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/verify-pin", driver, map[string]any{"pin": pin}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/start", driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/complete", driver, map[string]any{}), http.StatusOK)
}

// TestAdvanceActivationExactlyOnceAndCommissionOnce: near pickup the
// reconfirmed booking enters the driver's live CURRENT slot with its
// execution ride — exactly once, even when several freshly restarted
// workers sweep at the same moment and again after — and neither the
// activation nor the completed trip charges the commission again: one
// capture at the advance award, one settlement at completion.
func TestAdvanceActivationExactlyOnceAndCommissionOnce(t *testing.T) {
	h := schedulingHarness(t)
	f := bookAdvance(t, h, 4*time.Hour, "wallet")
	f.reconfirm(t)
	capturesBefore := h.Wallet.CaptureCalls

	h.Clock.Set(f.booking.ActivationAt.Add(time.Minute))
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
	sweepOnce(t, h)
	sweepOnce(t, restartedServiceHarness(t, h))

	b := f.reload(t)
	if b.State != machine.MpBookingActivated || b.ActivatedSlot != marketplace.SlotCurrent || b.ClaimID == nil {
		t.Fatalf("the booking activates into the current slot: %s %s (%s)", b.State, b.ActivatedSlot, b.LastError)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.driver_claims WHERE driver_id = $1`, f.driver.UserID); n != 1 {
		t.Fatalf("exactly one live claim: %d", n)
	}
	claim := claimRow(t, h, f.award.ID)
	if claim.State != machine.MpClaimCurrent || claim.ExecutionID == nil || claim.ID != *b.ClaimID {
		t.Fatalf("claim: %+v", claim)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM ride.rides WHERE rider_id = $1`, f.rider.UserID); n != 1 {
		t.Fatalf("exactly one execution ride: %d", n)
	}
	state, rideDriver, fare, awardMark, active := rideRow(t, h, *claim.ExecutionID)
	if state != machine.RiderDriverAssigned || !active || rideDriver == nil || *rideDriver != f.driver.UserID ||
		fare != f.amount || awardMark == nil || *awardMark != f.award.ID {
		t.Fatalf("execution ride: %s active=%v driver=%v fare=%d award=%v", state, active, rideDriver, fare, awardMark)
	}
	if outboxCount(t, h, "mp.advance_booking.activated", b.ID.String()) != 1 {
		t.Fatal("activated is published once")
	}
	if request := requestRow(t, h, f.requestID); request.State != machine.MpRequestExecution {
		t.Fatalf("request: %s", request.State)
	}
	if h.Wallet.CaptureCalls != capturesBefore || h.Wallet.CapturesByReservation[f.reservationID] != 1 {
		t.Fatalf("activation must not charge the commission again: calls %d→%d, captures %d",
			capturesBefore, h.Wallet.CaptureCalls, h.Wallet.CapturesByReservation[f.reservationID])
	}

	completeTrip(t, h, f.rider, f.driver, f.requestID, *claim.ExecutionID, 40)
	sweepOnce(t, h)
	if h.Settlement.EffectiveCalls != 1 || h.Settlement.Requests[f.award.ID].FareMinor.AmountMinor != f.amount {
		t.Fatalf("one settlement at the agreed fare: %d %+v", h.Settlement.EffectiveCalls, h.Settlement.Requests[f.award.ID])
	}
	if h.Wallet.CapturesByReservation[f.reservationID] != 1 || h.Wallet.ReversalsByReservation[f.reservationID] != 0 {
		t.Fatal("the commission was captured exactly once and never reversed")
	}
	if b := f.reload(t); b.State != machine.MpBookingCompleted {
		t.Fatalf("the booking records its completed trip: %s", b.State)
	}
}

// restartedServiceHarness wraps a restarted service in a harness copy so
// sweepOnce can drive it.
func restartedServiceHarness(t *testing.T, h *testutil.Harness) *testutil.Harness {
	t.Helper()
	copyOf := *h
	copyOf.Marketplace = restartedService(t, h)
	return &copyOf
}

// setupRunningTrip gives a driver a current immediate job (a passenger on
// board-to-be) near pickup, returning the ride and the PIN.
func setupRunningTrip(t *testing.T, h *testutil.Harness, driver testutil.Actor, seq int64) (string, uuid.UUID, string) {
	t.Helper()
	passenger := h.Rider()
	view, _ := publishAt(t, h, passenger, 0)
	requestID := view["requestId"].(string)
	now := h.Clock.Now()
	ingestPoints(t, h, driver, []map[string]any{
		point(seq, testutil.PickupFixture(), now.Add(-90*time.Second), 0),
		point(seq+1, testutil.PickupFixture(), now.Add(-60*time.Second), 0),
		point(seq+2, testutil.PickupFixture(), now.Add(-30*time.Second), 0),
		point(seq+3, testutil.PickupFixture(), now.Add(-time.Second), 0),
	})
	requireStatus(t, h.Do(http.MethodPost, "/mp/driver/parked", driver, nil), http.StatusOK)
	bid := h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId": requestID, "requestRevision": 1, "amountMinor": moneyBody(moneyMinor(t, view, "minimumFareMinor")),
		"slot": "current", "availabilityEpoch": epochOf(t, h, driver),
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, bid, http.StatusCreated)
	selected := doSelect(t, h, passenger, requestID, map[string]any{
		"bidId": decode(t, bid)["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	award := awardRow(t, h, requestID)
	if award.State != machine.MpAwardConfirmed || award.ExecutionID == nil {
		t.Fatalf("the immediate job: %+v", award)
	}
	return requestID, *award.ExecutionID, decode(t, selected)["pickupPin"].(string)
}

// TestAdvanceActivationNeverDivertsACurrentPassenger: at activation the
// driver is carrying another passenger and queued jobs are off: the booking
// waits (the current trip is never cut short), and when the pickup window
// opens with the driver still on that trip the booking fails honestly —
// commission returned, rider told — while the passenger's trip is untouched.
func TestAdvanceActivationNeverDivertsACurrentPassenger(t *testing.T) {
	h := schedulingHarness(t)
	f := bookAdvance(t, h, 4*time.Hour, "wallet")
	f.reconfirm(t)

	h.Clock.Set(f.booking.ActivationAt.Add(-5 * time.Minute))
	_, runningRide, _ := setupRunningTrip(t, h, f.driver, 30)

	h.Clock.Set(f.booking.ActivationAt.Add(time.Minute))
	sweepOnce(t, h)
	if b := f.reload(t); b.State != machine.MpBookingReconfirmed || !strings.Contains(b.LastError, marketplace.BookingFailDriverOnTrip) {
		t.Fatalf("activation waits while the driver carries a passenger: %s (%s)", b.State, b.LastError)
	}
	h.Clock.Set(f.booking.ActivationDeadline.Add(time.Minute))
	sweepOnce(t, h)
	b := f.reload(t)
	if b.State != machine.MpBookingFailed || b.Failure.Reason != marketplace.BookingFailDriverOnTrip ||
		!strings.Contains(b.Failure.Message, "still on another trip") {
		t.Fatalf("the booking fails honestly at its deadline: %s %+v", b.State, b.Failure)
	}
	if h.Wallet.ReversalsByReservation[f.reservationID] != 1 {
		t.Fatal("the booking's commission is returned once")
	}
	state, rideDriver, _, _, active := rideRow(t, h, runningRide)
	if state != machine.RiderDriverAssigned || !active || rideDriver == nil || *rideDriver != f.driver.UserID {
		t.Fatalf("the current passenger's trip is untouched: %s active=%v", state, active)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.driver_claims WHERE driver_id = $1 AND state = 'current'`, f.driver.UserID); n != 1 {
		t.Fatalf("the current claim stands: %d", n)
	}
}

// TestAdvanceActivationQueuesBehindATripThatFinishesInTime: with queued jobs
// on, a booking whose driver is on a short trip that ends in time is
// activated into the NEXT slot (depending on the running trip) — the current
// passenger is untouched — and the existing promotion starts it exactly
// once when that trip completes, still without a second commission.
func TestAdvanceActivationQueuesBehindATripThatFinishesInTime(t *testing.T) {
	h := schedulingHarness(t, testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true))
	nightClock(h)
	f := bookAdvance(t, h, 4*time.Hour, "wallet")
	f.reconfirm(t)

	h.Clock.Set(f.booking.ActivationAt.Add(-2 * time.Minute))
	runningRequest, runningRide, runningPin := setupRunningTrip(t, h, f.driver, 30)
	currentClaim := claimRow(t, h, awardRow(t, h, runningRequest).ID)

	h.Clock.Set(f.booking.ActivationAt.Add(time.Minute))
	ingestPoints(t, h, f.driver, []map[string]any{point(40, testutil.PickupFixture(), h.Clock.Now().Add(-time.Second), 0)})
	sweepOnce(t, h)
	b := f.reload(t)
	if b.State != machine.MpBookingActivated || b.ActivatedSlot != marketplace.SlotNext {
		t.Fatalf("a trip that ends in time lets the booking queue behind it: %s %s (%s)", b.State, b.ActivatedSlot, b.LastError)
	}
	queued := claimRow(t, h, f.award.ID)
	if queued.State != machine.MpClaimNext || queued.DependsOnClaimID == nil || *queued.DependsOnClaimID != currentClaim.ID {
		t.Fatalf("the queued claim depends on the running trip: %+v", queued)
	}
	if state, _, _, _, active := rideRow(t, h, runningRide); state != machine.RiderDriverAssigned || !active {
		t.Fatalf("the current passenger's trip is untouched: %s", state)
	}

	// The running trip completes: promotion starts the booking's trip once.
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+runningRide.String()+"/arrived", f.driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+runningRide.String()+"/verify-pin", f.driver, map[string]any{"pin": runningPin}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+runningRide.String()+"/start", f.driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+runningRide.String()+"/complete", f.driver, map[string]any{}), http.StatusOK)
	sweepOnce(t, h)
	promoted := claimRow(t, h, f.award.ID)
	if promoted.State != machine.MpClaimCurrent || promoted.ExecutionID == nil {
		t.Fatalf("the booking's claim is promoted after the running trip: %+v", promoted)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM ride.rides WHERE rider_id = $1`, f.rider.UserID); n != 1 {
		t.Fatalf("exactly one execution ride for the booking: %d", n)
	}
	if h.Wallet.CapturesByReservation[f.reservationID] != 1 {
		t.Fatal("still exactly one commission capture for the booking")
	}
}

// TestAdvanceBookingRemindersOnce: reminders reach both parties once per
// offset.
func TestAdvanceBookingRemindersOnce(t *testing.T) {
	h := schedulingHarness(t)
	f := bookAdvance(t, h, 14*time.Hour, "wallet")
	h.Clock.Set(f.booking.WindowStart.Add(-12*time.Hour + time.Minute))
	sweepOnce(t, h)
	sweepOnce(t, h)
	if n := outboxCount(t, h, "mp.advance_booking.reminder", f.booking.ID.String()); n != 1 {
		t.Fatalf("12 h reminders: %d", n)
	}
	audience := eventPayloadField(t, h, "mp.advance_booking.reminder", f.booking.ID.String(), "audience")
	if !strings.Contains(audience, "rider") || !strings.Contains(audience, "driver") {
		t.Fatalf("reminders go to both parties: %s", audience)
	}
}

// TestAdvanceBookingFundingAuthorizedAsBookingEndsIsReleased: the funding
// worker authorizes outside any lock. A rider cancel that lands while that
// authorization is in flight releases "nothing" — the reservation does not
// exist yet — so the worker, finding the booking ended, must release the
// reservation it just created. The rider's wallet is never left encumbered
// by a booking that no longer exists.
func TestAdvanceBookingFundingAuthorizedAsBookingEndsIsReleased(t *testing.T) {
	h := schedulingHarness(t)
	f := bookAdvance(t, h, 72*time.Hour, "wallet")
	if f.booking.State != machine.MpBookingPaymentPending {
		t.Fatalf("beyond the funding horizon: %s", f.booking.State)
	}
	h.Clock.Set(f.booking.FundingDueAt.Add(time.Minute))
	landed := false
	h.Funding.BeforeAuthorize = func(req marketplace.FundingRequest) {
		if landed || req.AwardID != f.award.ID {
			return
		}
		landed = true
		cancel := h.Do(http.MethodPost, f.bookingPath("/cancel"), f.rider, nil, move.IdempotencyHeader, idemKey())
		requireStatus(t, cancel, http.StatusOK)
	}
	sweepOnce(t, h)
	h.Funding.BeforeAuthorize = nil
	if !landed {
		t.Fatal("the cancel must land while the worker's authorization is in flight")
	}
	if b := f.reload(t); b.State != machine.MpBookingCancelled {
		t.Fatalf("the rider's cancel stands: %s", b.State)
	}
	if h.Funding.EffectiveCalls != 1 {
		t.Fatalf("the worker's authorization did happen: %d", h.Funding.EffectiveCalls)
	}
	if h.Funding.ReservationActive(f.award.ID) {
		t.Fatal("a funding reservation authorized for an ended booking must be released")
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.reservation_recovery WHERE reservation_id = $1 AND resolved_at IS NULL`,
		"mp.fund.release:"+f.award.ID.String()); n != 0 {
		t.Fatalf("every funding release intent is resolved: %d open", n)
	}
	sweepOnce(t, h)
	if b := f.reload(t); b.State != machine.MpBookingCancelled || h.Funding.EffectiveCalls != 1 {
		t.Fatalf("a later pass changes nothing: %s, %d authorizations", b.State, h.Funding.EffectiveCalls)
	}
}

// TestAdvanceReconfirmRequestListsOnlyUnasked: the reconfirmation pass reads
// only bookings whose driver has not been asked yet, so a backlog of asked
// bookings waiting for their drivers can never starve a later booking of its
// request (and fail it for a reconfirmation nobody asked for).
func TestAdvanceReconfirmRequestListsOnlyUnasked(t *testing.T) {
	h := schedulingHarness(t)
	nightClock(h)
	first := bookAdvance(t, h, 5*time.Hour, "wallet")
	second := bookAdvance(t, h, 5*time.Hour+30*time.Minute, "wallet")
	store := h.Marketplace.Store()
	ctx := context.Background()

	h.Clock.Set(first.booking.ReconfirmOpensAt.Add(time.Minute))
	due, err := store.BookingsAwaitingReconfirmRequest(ctx, h.Pool, h.Clock.Now(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 1 || due[0].ID != first.booking.ID {
		t.Fatalf("only the booking whose window opened is due: %d", len(due))
	}
	sweepOnce(t, h)
	if b := first.reload(t); b.ReconfirmRequestedAt == nil {
		t.Fatal("the first driver is asked to reconfirm")
	}
	h.Clock.Set(second.booking.ReconfirmOpensAt.Add(time.Minute))
	due, err = store.BookingsAwaitingReconfirmRequest(ctx, h.Pool, h.Clock.Now(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 1 || due[0].ID != second.booking.ID {
		t.Fatalf("an already-asked booking never takes the batch slot of an unasked one: %v", due)
	}
	sweepOnce(t, h)
	if b := second.reload(t); b.ReconfirmRequestedAt == nil {
		t.Fatal("the second driver is asked to reconfirm")
	}
	if n := outboxCount(t, h, "mp.advance_booking.reconfirm_requested", first.booking.ID.String()); n != 1 {
		t.Fatalf("the first driver is asked once: %d", n)
	}
}
