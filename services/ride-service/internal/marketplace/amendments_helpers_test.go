package marketplace_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/pricing"
	ridisc "github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/redis"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// amendHarness is the marketplace harness with multiple stops AND post-award
// trip amendments switched on for its city (both deny by default), at the
// fixed off-peak hour so routed durations are identical on every run.
func amendHarness(t *testing.T, opts ...testutil.HarnessOption) *testutil.Harness {
	t.Helper()
	all := append([]testutil.HarnessOption{
		testutil.WithFlag(cityconfig.FlagMarketplaceMultiStop, true),
		testutil.WithFlag(cityconfig.FlagMarketplaceTripAmendments, true),
	}, opts...)
	h := newHarness(t, all...)
	h.Clock.Set(fixedOffPeakHour)
	return h
}

// tripFixture is one awarded, executing marketplace ride.
type tripFixture struct {
	h           *testutil.Harness
	rider       testutil.Actor
	driver      testutil.Actor
	requestID   string
	award       *marketplace.Award
	rideID      uuid.UUID
	pin         string
	reservation string
	amount      int64
	stops       []map[string]any
	seq         int64
	position    domain.Place
}

// awardedTrip publishes a request (with the given stops) at its minimum
// fare, has a parked driver bid it, and selects the bid: the award saga
// captures the 10% once and creates the execution ride.
func awardedTrip(t *testing.T, h *testutil.Harness, stops []map[string]any) *tripFixture {
	t.Helper()
	return awardedTripFor(t, h, h.Rider(), stops)
}

// awardedTripFor is awardedTrip for a given requester (with a fresh driver),
// so one rider can take several trips.
func awardedTripFor(t *testing.T, h *testutil.Harness, rider testutil.Actor, stops []map[string]any) *tripFixture {
	t.Helper()
	f := &tripFixture{h: h, rider: rider, driver: h.Driver(), seq: 4}
	pickup, dropoff := testutil.PickupFixture(), testutil.DropoffFixture()
	var quote map[string]any
	if len(stops) > 0 {
		recorder := quoteStops(t, h, f.rider, pickup, dropoff, stops)
		requireStatus(t, recorder, http.StatusOK)
		quote = decode(t, recorder)
	} else {
		quote = quoteEnvelope(t, h, f.rider, pickup, dropoff)
	}
	view := publishQuote(t, h, f.rider, quote)
	f.requestID = view["requestId"].(string)
	f.amount = moneyMinor(t, view, "minimumFareMinor")
	if len(stops) > 0 {
		f.stops = routeStops(t, view)
	}
	parkDriver(t, h, f.driver, pickup)
	f.position = pickup
	bid := fundedCurrentBid(t, h, f.driver, f.requestID, f.amount)
	f.reservation = bid["reservationId"].(string)
	selected := doSelect(t, h, f.rider, f.requestID, map[string]any{
		"bidId": bid["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	requireStatus(t, selected, http.StatusAccepted)
	f.pin, _ = decode(t, selected)["pickupPin"].(string)
	f.award = awardRow(t, h, f.requestID)
	if f.award.ExecutionID == nil {
		t.Fatalf("the award has no execution ride: %s", selected.Body.String())
	}
	f.rideID = *f.award.ExecutionID
	return f
}

// start walks the execution ride through arrival, PIN and start: the
// passenger is aboard.
func (f *tripFixture) start(t *testing.T) {
	t.Helper()
	ride := "/rides/" + f.rideID.String()
	requireStatus(t, f.h.Do(http.MethodPost, ride+"/arrived", f.driver, map[string]any{}), http.StatusOK)
	requireStatus(t, f.h.Do(http.MethodPost, ride+"/verify-pin", f.driver, map[string]any{"pin": f.pin}), http.StatusOK)
	requireStatus(t, f.h.Do(http.MethodPost, ride+"/start", f.driver, map[string]any{}), http.StatusOK)
}

// complete finishes the execution ride through the move core.
func (f *tripFixture) complete(t *testing.T) {
	t.Helper()
	requireStatus(t, f.h.Do(http.MethodPost, "/rides/"+f.rideID.String()+"/complete", f.driver, map[string]any{}), http.StatusOK)
}

// moveTo advances the clock and reports one fresh, still fix at a place.
func (f *tripFixture) moveTo(t *testing.T, place domain.Place, after time.Duration) {
	t.Helper()
	f.h.Clock.Advance(after)
	f.seq++
	ingestPoints(t, f.h, f.driver, []map[string]any{point(f.seq, place, f.h.Clock.Now(), 0)})
	f.position = place
}

// park advances the clock, reports a full dwell of still fixes at a place and
// confirms parked: the driver may now make an interactive decision.
func (f *tripFixture) park(t *testing.T, place domain.Place, after time.Duration) {
	t.Helper()
	f.h.Clock.Advance(after)
	now := f.h.Clock.Now()
	var points []map[string]any
	for _, back := range []time.Duration{90 * time.Second, 60 * time.Second, 30 * time.Second, time.Second} {
		f.seq++
		points = append(points, point(f.seq, place, now.Add(-back), 0))
	}
	ingestPoints(t, f.h, f.driver, points)
	f.position = place
	recorder := f.h.Do(http.MethodPost, "/mp/driver/parked", f.driver, nil)
	requireStatus(t, recorder, http.StatusOK)
	if state := decode(t, recorder)["state"]; state != "parked_confirmed" {
		t.Fatalf("the driver should be parked: %v", state)
	}
}

// drive reports clearly moving fixes: no interactive decision may be taken.
func (f *tripFixture) drive(t *testing.T, place domain.Place) {
	t.Helper()
	f.h.Clock.Advance(30 * time.Second)
	now := f.h.Clock.Now()
	f.seq++
	first := f.seq
	f.seq++
	ingestPoints(t, f.h, f.driver, []map[string]any{
		point(first, place, now.Add(-10*time.Second), 12),
		point(f.seq, testutil.PlaceAt(place, 100), now, 12),
	})
}

func (f *tripFixture) path(suffix string) string {
	return "/mp/requests/" + f.requestID + suffix
}

// trip reads the executing trip as an actor sees it.
func (f *tripFixture) trip(t *testing.T, actor testutil.Actor) map[string]any {
	t.Helper()
	recorder := f.h.Do(http.MethodGet, f.path("/trip"), actor, nil)
	requireStatus(t, recorder, http.StatusOK)
	return decode(t, recorder)
}

// propose posts an amendment with a fresh key.
func (f *tripFixture) propose(actor testutil.Actor, body map[string]any, key string) *httptest.ResponseRecorder {
	if key == "" {
		key = idemKey()
	}
	return f.h.Do(http.MethodPost, f.path("/amendments"), actor, body, move.IdempotencyHeader, key)
}

// proposal is the body of an amendment proposing these remaining stops.
func proposal(stops []map[string]any, routeRevision, fareRevision int) map[string]any {
	if stops == nil {
		stops = []map[string]any{}
	}
	return map[string]any{
		"stops":                 stops,
		"expectedRouteRevision": routeRevision,
		"expectedFareRevision":  fareRevision,
	}
}

// decide approves or rejects an amendment bound to its revisions.
func (f *tripFixture) decide(actor testutil.Actor, amendment map[string]any, verb, key string) *httptest.ResponseRecorder {
	if key == "" {
		key = idemKey()
	}
	return f.h.Do(http.MethodPost, f.path("/amendments/"+amendment["amendmentId"].(string)+"/"+verb), actor, map[string]any{
		"routeRevision": amendment["routeRevision"],
		"fareRevision":  amendment["fareRevision"],
	}, move.IdempotencyHeader, key)
}

// stopPost posts one stop event with a fresh key.
func (f *tripFixture) stopPost(actor testutil.Actor, stopID, verb string, body any, key string) *httptest.ResponseRecorder {
	if key == "" {
		key = idemKey()
	}
	return f.h.Do(http.MethodPost, f.path("/stops/"+stopID+"/"+verb), actor, body, move.IdempotencyHeader, key)
}

// executionRoute reads the trip's committed terms straight from the store.
func (f *tripFixture) executionRoute(t *testing.T) *marketplace.ExecutionRoute {
	t.Helper()
	route, err := f.h.Marketplace.Store().ExecutionRouteByAward(context.Background(), f.h.Pool, f.award.ID)
	if err != nil {
		t.Fatalf("no execution route for award %s: %v", f.award.ID, err)
	}
	return route
}

// amendmentRow reads one amendment straight from the store.
func (f *tripFixture) amendmentRow(t *testing.T, id string) *marketplace.Amendment {
	t.Helper()
	amendment, err := f.h.Marketplace.Store().AmendmentByID(context.Background(), f.h.Pool, uuid.MustParse(id))
	if err != nil {
		t.Fatalf("no amendment %s: %v", id, err)
	}
	return amendment
}

// rideTerms reads the execution ride's fare, quote and dropoff.
func (f *tripFixture) rideTerms(t *testing.T) (fare int64, quoteID uuid.UUID, dropoffLat float64, version int) {
	t.Helper()
	if err := f.h.Pool.QueryRow(context.Background(), `
		SELECT quoted_fare_minor, quote_id, dropoff_lat, version FROM ride.rides WHERE id = $1`, f.rideID).
		Scan(&fare, &quoteID, &dropoffLat, &version); err != nil {
		t.Fatal(err)
	}
	return
}

// openMoneyRows counts an award's amendments with open money.
func (f *tripFixture) openMoneyRows(t *testing.T) int {
	t.Helper()
	var count int
	if err := f.h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM mp.amendments WHERE award_id = $1 AND money_open`, f.award.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

// historyEvents lists one amendment's append-only history events.
func historyEvents(t *testing.T, h *testutil.Harness, amendmentID string) []string {
	t.Helper()
	history, err := h.Marketplace.Store().AmendmentHistory(context.Background(), h.Pool, uuid.MustParse(amendmentID))
	if err != nil {
		t.Fatal(err)
	}
	events := make([]string, 0, len(history))
	for _, row := range history {
		events = append(events, row.Event)
	}
	return events
}

// restartedService builds a SECOND marketplace service over the same
// database and the same payment-service fakes — what a process restart (or a
// second replica) is: no in-memory state survives, only the rows.
func restartedService(t *testing.T, h *testutil.Harness) *marketplace.Service {
	t.Helper()
	router := move.NewStraightLineRouter()
	router.Now = h.Clock.Now
	service, err := marketplace.NewService(marketplace.Deps{
		Store:      h.Marketplace.Store(),
		Config:     cityconfig.NewStore(h.Pool, nil, time.Second),
		Flags:      cityconfig.NewFlags(h.Pool),
		Pricing:    pricing.NewEngine(),
		Router:     router,
		Wallet:     h.Wallet,
		Funding:    h.Funding,
		Settlement: h.Settlement,
		Redis:      ridisc.New(h.Redis),
		Logger:     zerolog.Nop(),
		Now:        h.Clock.Now,
	})
	if err != nil {
		t.Fatal(err)
	}
	return service
}

// secondStop is a stop off the fixture route, after the fixture's first stop.
func secondStop() domain.Place {
	_, _, _, second := stopFixtures()
	return second
}

// firstStopInput is the fixture's first stop as a requester names it.
func firstStopInput() map[string]any {
	_, _, first, _ := stopFixtures()
	return stopAt(first, "drop_passenger", intPtr(120), "Kid's school")
}

// secondStopInput is the stop the tests' increases add.
func secondStopInput() map[string]any {
	return stopAt(secondStop(), "errand", intPtr(300), "Pharmacy")
}
