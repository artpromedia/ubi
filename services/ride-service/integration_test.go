// Package ride_test drives the Move core end to end over the real HTTP
// handlers, against the Postgres and Redis this repository runs.
//
// Every guard slice 02 lists is exercised here through the API a client would
// use, not through a service method a client cannot reach: no double assignment
// under concurrent accepts, the PIN attempt limit, the arrival geofence, an
// idempotent ride create, a signed quote that cannot be edited, an illegal
// transition, and a driver cancellation without a reason code.
package ride_test

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/matching"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type scenario struct {
	h      *testutil.Harness
	rider  testutil.Actor
	driver testutil.Actor
}

// newScenario brings a driver online at a known point near the pickup and
// returns the pieces a test needs.
func newScenario(t *testing.T, opts ...testutil.HarnessOption) *scenario {
	t.Helper()
	h := testutil.NewHarness(t, opts...)
	s := &scenario{h: h, rider: h.Rider(), driver: h.Driver()}
	s.bringOnline(s.driver, testutil.PlaceAt(testutil.PickupFixture(), 100))
	return s
}

// bringOnline takes a driver online and reports a position for them.
func (s *scenario) bringOnline(driver testutil.Actor, at domain.Place) {
	s.h.T.Helper()

	recorder := s.h.Do(http.MethodPost, "/drivers/me/status", driver, move.DriverStatusRequest{
		Online:  true,
		Filters: move.DriverFilters{VehicleClasses: []string{"go"}},
	})
	if recorder.Code != http.StatusOK {
		s.h.T.Fatalf("driver could not go online: %d %s", recorder.Code, recorder.Body.String())
	}

	recorder = s.h.Do(http.MethodPost, "/drivers/me/locations", driver, map[string]any{
		"points": []domain.LocationPoint{
			testutil.LocationPointFixture(1, at, s.h.Clock.Now()),
		},
	})
	if recorder.Code != http.StatusOK {
		s.h.T.Fatalf("driver location was refused: %d %s", recorder.Code, recorder.Body.String())
	}
	var batch move.LocationBatchResult
	s.h.DecodeBody(recorder, &batch)
	if batch.Accepted != 1 {
		s.h.T.Fatalf("expected the location to be accepted, got %+v", batch)
	}
}

// quote asks for a quote as the rider.
func (s *scenario) quote() move.QuoteView {
	s.h.T.Helper()
	recorder := s.h.Do(http.MethodPost, "/quotes", s.rider, move.QuoteRequest{
		Pickup:       testutil.PickupFixture(),
		Dropoff:      testutil.DropoffFixture(),
		VehicleClass: "go",
	})
	if recorder.Code != http.StatusCreated {
		s.h.T.Fatalf("quote failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var quote move.QuoteView
	s.h.DecodeBody(recorder, &quote)
	return quote
}

// requestRide turns a quote into a ride.
func (s *scenario) requestRide(quote move.QuoteView, key string) move.CreateRideResult {
	s.h.T.Helper()
	recorder := s.h.Do(http.MethodPost, "/rides", s.rider, move.CreateRideRequest{
		QuoteID:         quote.QuoteID,
		Signature:       quote.Signature,
		PaymentMethodID: "cash",
	}, move.IdempotencyHeader, key)
	if recorder.Code != http.StatusCreated {
		s.h.T.Fatalf("ride request failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var result move.CreateRideResult
	s.h.DecodeBody(recorder, &result)
	return result
}

// offersFor reads the persisted dispatch timeline for a ride.
func (s *scenario) offersFor(rideID uuid.UUID) []domain.Offer {
	s.h.T.Helper()
	recorder := s.h.Do(http.MethodGet, "/rides/"+rideID.String()+"/offers", s.rider, nil)
	if recorder.Code != http.StatusOK {
		s.h.T.Fatalf("reading offers failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Offers []domain.Offer `json:"offers"`
	}
	s.h.DecodeBody(recorder, &body)
	return body.Offers
}

func decodeError(t *testing.T, body []byte) domain.Error {
	t.Helper()
	var parsed domain.Error
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("failed to decode the error body %q: %v", string(body), err)
	}
	return parsed
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

func TestRideLockstepHappyPath(t *testing.T) {
	s := newScenario(t)

	quote := s.quote()
	if quote.FareMinor <= 0 || quote.Currency == "" || quote.Signature == "" {
		t.Fatalf("a quote must carry a signed fare in the city's currency: %+v", quote)
	}
	if quote.ConfigVersion != s.h.ConfigVersion {
		t.Fatalf("config version: got %d, want %d", quote.ConfigVersion, s.h.ConfigVersion)
	}

	ride := s.requestRide(quote, "happy-path-0001")
	if ride.Status != "SEARCHING" {
		t.Fatalf("a new ride is SEARCHING on the wire: got %q", ride.Status)
	}
	if ride.State != machine.RiderMatching {
		t.Fatalf("a new ride is `matching` in the contract machine: got %q", ride.State)
	}
	if ride.ConfigVersion != quote.ConfigVersion {
		t.Fatal("the ride must pin the config version its fare was priced under")
	}
	if ride.QuotedFareMinor != quote.FareMinor {
		t.Fatalf("the ride fare must be the quoted fare: %d vs %d", ride.QuotedFareMinor, quote.FareMinor)
	}
	if len(ride.Pin) != 4 {
		t.Fatalf("the rider is told the pickup PIN once: got %q", ride.Pin)
	}

	// Requesting a ride actually dispatched: the offer exists because ride
	// creation ran the matcher, not because a test called it.
	offers := s.offersFor(ride.RideID)
	if len(offers) != 1 {
		t.Fatalf("expected one persisted offer after the request, got %d", len(offers))
	}
	offer := offers[0]
	if offer.DriverID != s.driver.UserID || offer.State != domain.OfferOffered {
		t.Fatalf("unexpected offer: %+v", offer)
	}

	// Accept.
	recorder := s.h.Do(http.MethodPost, "/offers/"+offer.ID.String()+"/accept", s.driver, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("accept failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var accepted move.AcceptResultView
	s.h.DecodeBody(recorder, &accepted)
	if accepted.Result != domain.AcceptOK {
		t.Fatalf("accept result: got %q, want ok", accepted.Result)
	}
	if accepted.Ride.State != machine.RiderDriverAssigned {
		t.Fatalf("state after accept: got %q", accepted.Ride.State)
	}

	// Arrive, inside the geofence.
	recorder = s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/arrived", s.driver, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("arrival failed: %d %s", recorder.Code, recorder.Body.String())
	}

	// Verify the PIN the rider was given.
	recorder = s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/verify-pin", s.driver,
		map[string]string{"pin": ride.Pin})
	if recorder.Code != http.StatusOK {
		t.Fatalf("PIN verification failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var pinResult move.PinResultView
	s.h.DecodeBody(recorder, &pinResult)
	if !pinResult.Verified {
		t.Fatal("the correct PIN must verify")
	}

	// Start and complete.
	recorder = s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/start", s.driver, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("start failed: %d %s", recorder.Code, recorder.Body.String())
	}

	// Five minutes of driving, so the wait fee is measured from real timestamps.
	s.h.Clock.Advance(5 * time.Minute)

	recorder = s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/complete", s.driver, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("complete failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var completed move.RideView
	s.h.DecodeBody(recorder, &completed)
	if completed.State != machine.RiderCompleted {
		t.Fatalf("state after completion: got %q", completed.State)
	}
	if completed.FinalFareMinor == nil {
		t.Fatal("a completed ride must carry a final fare")
	}
	if *completed.FinalFareMinor != quote.FareMinor+completed.WaitFeeMinor {
		t.Fatalf("the final fare must be the quoted fare plus the measured wait: %d vs %d + %d",
			*completed.FinalFareMinor, quote.FareMinor, completed.WaitFeeMinor)
	}

	// The transitions were published through the outbox, in the same
	// transactions that wrote them.
	assertEventPublished(t, s.h, "ride.requested", ride.RideID)
	assertEventPublished(t, s.h, "ride.assigned", ride.RideID)
	assertEventPublished(t, s.h, "ride.driver_arrived", ride.RideID)
	assertEventPublished(t, s.h, "ride.pin_verified", ride.RideID)
	assertEventPublished(t, s.h, "ride.started", ride.RideID)
	assertEventPublished(t, s.h, "ride.completed", ride.RideID)
}

func assertEventPublished(t *testing.T, h *testutil.Harness, name string, rideID uuid.UUID) {
	t.Helper()
	var count int
	err := h.Pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM public.outbox_events
		WHERE name = $1 AND aggregate_type = 'ride' AND aggregate_id = $2`,
		name, rideID.String()).Scan(&count)
	if err != nil {
		t.Fatalf("failed to read the outbox: %v", err)
	}
	if count == 0 {
		t.Fatalf("no %s event was published for the ride", name)
	}
}

// ---------------------------------------------------------------------------
// Guard: no double assignment under concurrent accepts
// ---------------------------------------------------------------------------

// TestConcurrentAcceptsOnOneOfferProduceExactlyOneWinner is the headline guard.
//
// It runs with Redis disabled, so the SETNX lock cannot be what makes it pass:
// every goroutine reaches Postgres, and the conditional UPDATE plus the partial
// unique index are what admit exactly one.
func TestConcurrentAcceptsOnOneOfferProduceExactlyOneWinner(t *testing.T) {
	s := newScenario(t, testutil.WithoutRedisGuards())

	ride := s.requestRide(s.quote(), "concurrent-one-offer")
	offers := s.offersFor(ride.RideID)
	if len(offers) != 1 {
		t.Fatalf("expected one offer, got %d", len(offers))
	}
	offerPath := "/offers/" + offers[0].ID.String() + "/accept"

	const attempts = 64
	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		results = map[domain.AcceptResult]int{}
	)
	start := make(chan struct{})

	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			recorder := s.h.Do(http.MethodPost, offerPath, s.driver, nil)
			var view move.AcceptResultView
			if err := json.Unmarshal(recorder.Body.Bytes(), &view); err != nil {
				mu.Lock()
				results["undecodable"]++
				mu.Unlock()
				return
			}
			mu.Lock()
			results[view.Result]++
			mu.Unlock()
		}()
	}
	close(start)
	wg.Wait()

	if results[domain.AcceptOK] != 1 {
		t.Fatalf("exactly one accept must win; got %+v", results)
	}
	if results[domain.AcceptOK]+results[domain.AcceptAlreadyAssigned]+results[domain.AcceptExpired] != attempts {
		t.Fatalf("every attempt must get one of ok, already_assigned or expired; got %+v", results)
	}

	// And the database agrees: one accepted offer, one assigned driver.
	var acceptedOffers int
	if err := s.h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM ride.offers WHERE ride_id = $1 AND state = 'accepted'`,
		ride.RideID).Scan(&acceptedOffers); err != nil {
		t.Fatalf("failed to count accepted offers: %v", err)
	}
	if acceptedOffers != 1 {
		t.Fatalf("accepted offers in the database: got %d, want 1", acceptedOffers)
	}
}

// TestConcurrentAcceptsAcrossDriversAssignOnlyOne covers the other shape of the
// same race: several drivers holding several offers for one ride, all accepting
// at once. Only one ride can be assigned, so only one of them may win.
func TestConcurrentAcceptsAcrossDriversAssignOnlyOne(t *testing.T) {
	h := testutil.NewHarness(t, testutil.WithoutRedisGuards())
	s := &scenario{h: h, rider: h.Rider()}

	const drivers = 5
	fleet := make([]testutil.Actor, 0, drivers)
	for i := 0; i < drivers; i++ {
		driver := h.Driver()
		s.bringOnline(driver, testutil.PlaceAt(testutil.PickupFixture(), float64(50+i*20)))
		fleet = append(fleet, driver)
	}
	s.driver = fleet[0]

	ride := s.requestRide(s.quote(), "concurrent-many-drivers")
	offers := s.offersFor(ride.RideID)
	if len(offers) < 2 {
		t.Fatalf("expected the ring to offer several drivers, got %d", len(offers))
	}

	byDriver := map[uuid.UUID]testutil.Actor{}
	for _, driver := range fleet {
		byDriver[driver.UserID] = driver
	}

	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		results = map[domain.AcceptResult]int{}
	)
	start := make(chan struct{})
	for _, offer := range offers {
		driver, ok := byDriver[offer.DriverID]
		if !ok {
			t.Fatalf("an offer went to a driver that is not in the fleet: %s", offer.DriverID)
		}
		path := "/offers/" + offer.ID.String() + "/accept"
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			recorder := h.Do(http.MethodPost, path, driver, nil)
			var view move.AcceptResultView
			if err := json.Unmarshal(recorder.Body.Bytes(), &view); err != nil {
				return
			}
			mu.Lock()
			results[view.Result]++
			mu.Unlock()
		}()
	}
	close(start)
	wg.Wait()

	if results[domain.AcceptOK] != 1 {
		t.Fatalf("only one driver may be assigned; got %+v", results)
	}

	var assigned int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM ride.rides WHERE id = $1 AND driver_id IS NOT NULL`,
		ride.RideID).Scan(&assigned); err != nil {
		t.Fatalf("failed to read the ride: %v", err)
	}
	if assigned != 1 {
		t.Fatal("the ride must end up with exactly one driver")
	}
}

// ---------------------------------------------------------------------------
// Guard: idempotent ride create
// ---------------------------------------------------------------------------

func TestRideCreateIsIdempotent(t *testing.T) {
	s := newScenario(t)
	quote := s.quote()

	body := move.CreateRideRequest{
		QuoteID:         quote.QuoteID,
		Signature:       quote.Signature,
		PaymentMethodID: "cash",
	}

	first := s.h.Do(http.MethodPost, "/rides", s.rider, body, move.IdempotencyHeader, "replay-me-0001")
	if first.Code != http.StatusCreated {
		t.Fatalf("first request: %d %s", first.Code, first.Body.String())
	}
	second := s.h.Do(http.MethodPost, "/rides", s.rider, body, move.IdempotencyHeader, "replay-me-0001")
	if second.Code != http.StatusCreated {
		t.Fatalf("replay: %d %s", second.Code, second.Body.String())
	}

	var one, two move.CreateRideResult
	s.h.DecodeBody(first, &one)
	s.h.DecodeBody(second, &two)
	if one.RideID != two.RideID {
		t.Fatalf("a replay must return the original ride: %s vs %s", one.RideID, two.RideID)
	}
	if two.Pin != "" {
		t.Fatal("a replay must not restate the PIN: it is hashed at rest and cannot be re-derived")
	}

	var rides int
	if err := s.h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM ride.rides WHERE rider_id = $1`, s.rider.UserID).Scan(&rides); err != nil {
		t.Fatalf("failed to count rides: %v", err)
	}
	if rides != 1 {
		t.Fatalf("a replay must not create a second ride; found %d", rides)
	}
}

func TestRideCreateNeedsAnIdempotencyKey(t *testing.T) {
	s := newScenario(t)
	quote := s.quote()

	recorder := s.h.Do(http.MethodPost, "/rides", s.rider, move.CreateRideRequest{
		QuoteID:         quote.QuoteID,
		Signature:       quote.Signature,
		PaymentMethodID: "cash",
	})
	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: got %d, want 422 (%s)", recorder.Code, recorder.Body.String())
	}
	if code := decodeError(t, recorder.Body.Bytes()).Code; code != domain.CodeValidationFailed {
		t.Fatalf("code: got %q", code)
	}
}

func TestSameKeyWithADifferentBodyIsRefused(t *testing.T) {
	s := newScenario(t)
	quote := s.quote()

	first := s.h.Do(http.MethodPost, "/rides", s.rider, move.CreateRideRequest{
		QuoteID: quote.QuoteID, Signature: quote.Signature, PaymentMethodID: "cash",
	}, move.IdempotencyHeader, "reused-key-0001")
	if first.Code != http.StatusCreated {
		t.Fatalf("first request: %d %s", first.Code, first.Body.String())
	}

	second := s.h.Do(http.MethodPost, "/rides", s.rider, move.CreateRideRequest{
		QuoteID: quote.QuoteID, Signature: quote.Signature, PaymentMethodID: "wallet",
	}, move.IdempotencyHeader, "reused-key-0001")
	if second.Code != http.StatusConflict {
		t.Fatalf("status: got %d, want 409 (%s)", second.Code, second.Body.String())
	}
	if code := decodeError(t, second.Body.Bytes()).Code; code != domain.CodeIdempotencyKeyReuse {
		t.Fatalf("code: got %q, want idempotency_key_reuse", code)
	}
}

// ---------------------------------------------------------------------------
// Guard: the quote is server-authoritative
// ---------------------------------------------------------------------------

func TestATamperedQuoteIsRefused(t *testing.T) {
	s := newScenario(t)
	quote := s.quote()

	recorder := s.h.Do(http.MethodPost, "/rides", s.rider, move.CreateRideRequest{
		QuoteID:         quote.QuoteID,
		Signature:       "not-the-signature-the-server-issued",
		PaymentMethodID: "cash",
	}, move.IdempotencyHeader, "tampered-0001")

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: got %d, want 422 (%s)", recorder.Code, recorder.Body.String())
	}
	if code := decodeError(t, recorder.Body.Bytes()).Code; code != domain.CodeQuoteSignatureInvalid {
		t.Fatalf("code: got %q, want quote_signature_invalid", code)
	}
}

// TestAFareEditedInFlightIsRefused re-signs a cheaper fare with the server's
// own signer and shows it still fails: the fare the signature is checked
// against is the stored one, so a client cannot pay less by claiming less.
func TestAFareEditedInFlightIsRefused(t *testing.T) {
	s := newScenario(t)
	quote := s.quote()

	forged := s.h.Signer.Sign(quote.QuoteID, 1, quote.Currency, quote.ExpiresAt, quote.ConfigVersion)
	recorder := s.h.Do(http.MethodPost, "/rides", s.rider, move.CreateRideRequest{
		QuoteID:         quote.QuoteID,
		Signature:       forged,
		PaymentMethodID: "cash",
	}, move.IdempotencyHeader, "reprice-0001")

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: got %d, want 422 (%s)", recorder.Code, recorder.Body.String())
	}
	if code := decodeError(t, recorder.Body.Bytes()).Code; code != domain.CodeQuoteSignatureInvalid {
		t.Fatalf("code: got %q, want quote_signature_invalid", code)
	}
}

func TestAnExpiredQuoteIsRefused(t *testing.T) {
	s := newScenario(t)
	quote := s.quote()

	// The fixture city sets a 300-second quote TTL; step past it.
	s.h.Clock.Advance(301 * time.Second)

	recorder := s.h.Do(http.MethodPost, "/rides", s.rider, move.CreateRideRequest{
		QuoteID:         quote.QuoteID,
		Signature:       quote.Signature,
		PaymentMethodID: "cash",
	}, move.IdempotencyHeader, "expired-0001")

	if recorder.Code != http.StatusConflict {
		t.Fatalf("status: got %d, want 409 (%s)", recorder.Code, recorder.Body.String())
	}
	if code := decodeError(t, recorder.Body.Bytes()).Code; code != domain.CodeQuoteExpired {
		t.Fatalf("code: got %q, want quote_expired", code)
	}
}

func TestAnUnavailablePaymentMethodIsRefusedHonestly(t *testing.T) {
	s := newScenario(t)
	quote := s.quote()

	// The fixture city marks card unavailable with a reason.
	recorder := s.h.Do(http.MethodPost, "/rides", s.rider, move.CreateRideRequest{
		QuoteID: quote.QuoteID, Signature: quote.Signature, PaymentMethodID: "card",
	}, move.IdempotencyHeader, "card-0001")

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: got %d, want 422 (%s)", recorder.Code, recorder.Body.String())
	}
	body := decodeError(t, recorder.Body.Bytes())
	if body.Code != domain.CodePaymentMethodUnavailable {
		t.Fatalf("code: got %q", body.Code)
	}
	if body.Details["reason"] == nil {
		t.Fatal("an unavailable method must say why, not just disappear")
	}
}

// ---------------------------------------------------------------------------
// Guard: the arrival geofence
// ---------------------------------------------------------------------------

func TestArrivalOutsideTheGeofenceIsRefused(t *testing.T) {
	s := newScenario(t)
	ride := s.requestRide(s.quote(), "geofence-0001")
	offers := s.offersFor(ride.RideID)
	if recorder := s.h.Do(http.MethodPost, "/offers/"+offers[0].ID.String()+"/accept", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("accept failed: %d %s", recorder.Code, recorder.Body.String())
	}

	// The city's geofence is 150 m; the driver drives 600 m away over half a
	// minute, which is a speed the server will believe.
	s.h.Clock.Advance(30 * time.Second)
	far := testutil.PlaceAt(testutil.PickupFixture(), 600)
	recorder := s.h.Do(http.MethodPost, "/drivers/me/locations", s.driver, map[string]any{
		"points": []domain.LocationPoint{testutil.LocationPointFixture(2, far, s.h.Clock.Now())},
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("location update failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var moved move.LocationBatchResult
	s.h.DecodeBody(recorder, &moved)
	if moved.Accepted != 1 {
		t.Fatalf("the driver's new position must be accepted before arrival is judged: %+v", moved)
	}

	recorder = s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/arrived", s.driver, nil)
	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: got %d, want 422 (%s)", recorder.Code, recorder.Body.String())
	}
	body := decodeError(t, recorder.Body.Bytes())
	if body.Code != domain.CodeNotAtPickup {
		t.Fatalf("code: got %q, want not_at_pickup", body.Code)
	}
	if body.Details["geofenceMeters"] != float64(150) {
		t.Fatalf("the geofence must come from city config: %+v", body.Details)
	}
}

func TestArrivalOnAStalePositionIsRefused(t *testing.T) {
	s := newScenario(t)
	ride := s.requestRide(s.quote(), "stale-position-0001")
	offers := s.offersFor(ride.RideID)
	if recorder := s.h.Do(http.MethodPost, "/offers/"+offers[0].ID.String()+"/accept", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("accept failed: %d %s", recorder.Code, recorder.Body.String())
	}

	// The driver has not reported a position for four minutes; their last fix
	// is no longer evidence of where the car is standing.
	s.h.Clock.Advance(4 * time.Minute)

	recorder := s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/arrived", s.driver, nil)
	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: got %d, want 422 (%s)", recorder.Code, recorder.Body.String())
	}
	if code := decodeError(t, recorder.Body.Bytes()).Code; code != domain.CodeNotAtPickup {
		t.Fatalf("code: got %q, want not_at_pickup", code)
	}
}

// ---------------------------------------------------------------------------
// Guard: PIN attempts
// ---------------------------------------------------------------------------

func TestPinAttemptsAreLimitedAndThenLocked(t *testing.T) {
	s := newScenario(t)
	ride := s.requestRide(s.quote(), "pin-limit-0001")
	offers := s.offersFor(ride.RideID)
	if recorder := s.h.Do(http.MethodPost, "/offers/"+offers[0].ID.String()+"/accept", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("accept failed: %d %s", recorder.Code, recorder.Body.String())
	}
	if recorder := s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/arrived", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("arrival failed: %d %s", recorder.Code, recorder.Body.String())
	}

	wrong := "0000"
	if wrong == ride.Pin {
		wrong = "1111"
	}
	path := "/rides/" + ride.RideID.String() + "/verify-pin"

	// The fixture city allows three attempts.
	for attempt := 1; attempt <= 2; attempt++ {
		recorder := s.h.Do(http.MethodPost, path, s.driver, map[string]string{"pin": wrong})
		if recorder.Code != http.StatusUnprocessableEntity {
			t.Fatalf("attempt %d: got %d, want 422 (%s)", attempt, recorder.Code, recorder.Body.String())
		}
		body := decodeError(t, recorder.Body.Bytes())
		if body.Code != domain.CodeWrongPin {
			t.Fatalf("attempt %d code: got %q, want wrong_pin", attempt, body.Code)
		}
		left, ok := body.Details["attemptsLeft"].(float64)
		if !ok || int(left) != 3-attempt {
			t.Fatalf("attempt %d must report %d attempts left, got %+v", attempt, 3-attempt, body.Details)
		}
	}

	// The third wrong attempt exhausts them and locks the PIN.
	recorder := s.h.Do(http.MethodPost, path, s.driver, map[string]string{"pin": wrong})
	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("final attempt: got %d, want 429 (%s)", recorder.Code, recorder.Body.String())
	}
	if code := decodeError(t, recorder.Body.Bytes()).Code; code != domain.CodePinAttemptsExhausted {
		t.Fatalf("final attempt code: got %q", code)
	}

	// Even the correct PIN cannot be used now.
	recorder = s.h.Do(http.MethodPost, path, s.driver, map[string]string{"pin": ride.Pin})
	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("after locking: got %d, want 429 (%s)", recorder.Code, recorder.Body.String())
	}

	var locked bool
	if err := s.h.Pool.QueryRow(context.Background(),
		`SELECT pin_locked FROM ride.rides WHERE id = $1`, ride.RideID).Scan(&locked); err != nil {
		t.Fatalf("failed to read the ride: %v", err)
	}
	if !locked {
		t.Fatal("the PIN must be locked in the database, not only in the response")
	}
}

func TestThePinIsNotStoredInPlaintext(t *testing.T) {
	s := newScenario(t)
	ride := s.requestRide(s.quote(), "pin-hash-0001")

	var hash []byte
	if err := s.h.Pool.QueryRow(context.Background(),
		`SELECT pin_hash FROM ride.rides WHERE id = $1`, ride.RideID).Scan(&hash); err != nil {
		t.Fatalf("failed to read the PIN hash: %v", err)
	}
	if len(hash) < 20 {
		t.Fatalf("the stored value is too short to be a hash: %d bytes", len(hash))
	}
	if string(hash) == ride.Pin {
		t.Fatal("the PIN must not be stored in plaintext")
	}
}

// ---------------------------------------------------------------------------
// Guard: illegal transitions
// ---------------------------------------------------------------------------

func TestStartingBeforeThePinIsVerifiedIsRefused(t *testing.T) {
	s := newScenario(t)
	ride := s.requestRide(s.quote(), "early-start-0001")
	offers := s.offersFor(ride.RideID)
	if recorder := s.h.Do(http.MethodPost, "/offers/"+offers[0].ID.String()+"/accept", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("accept failed: %d %s", recorder.Code, recorder.Body.String())
	}
	if recorder := s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/arrived", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("arrival failed: %d %s", recorder.Code, recorder.Body.String())
	}

	recorder := s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/start", s.driver, nil)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status: got %d, want 409 (%s)", recorder.Code, recorder.Body.String())
	}
	if code := decodeError(t, recorder.Body.Bytes()).Code; code != domain.CodePinNotVerified {
		t.Fatalf("code: got %q, want pin_not_verified", code)
	}
}

func TestCompletingARideThatNeverStartedIsRefused(t *testing.T) {
	s := newScenario(t)
	ride := s.requestRide(s.quote(), "early-complete-0001")
	offers := s.offersFor(ride.RideID)
	if recorder := s.h.Do(http.MethodPost, "/offers/"+offers[0].ID.String()+"/accept", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("accept failed: %d %s", recorder.Code, recorder.Body.String())
	}

	recorder := s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/complete", s.driver, nil)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status: got %d, want 409 (%s)", recorder.Code, recorder.Body.String())
	}
	body := decodeError(t, recorder.Body.Bytes())
	if body.Code != domain.CodeIllegalTransition {
		t.Fatalf("code: got %q, want illegal_transition", body.Code)
	}
	if body.Details["allowed"] == nil {
		t.Fatal("a refused transition must say what was allowed instead")
	}
}

func TestAStrangerCannotActOnSomebodyElsesRide(t *testing.T) {
	s := newScenario(t)
	ride := s.requestRide(s.quote(), "stranger-0001")

	stranger := s.h.Driver()
	recorder := s.h.Do(http.MethodGet, "/rides/"+ride.RideID.String(), stranger, nil)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status: got %d, want 404 (%s)", recorder.Code, recorder.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Guard: cancellation
// ---------------------------------------------------------------------------

func TestADriverCancellationNeedsAReasonCode(t *testing.T) {
	s := newScenario(t)
	ride := s.requestRide(s.quote(), "driver-cancel-0001")
	offers := s.offersFor(ride.RideID)
	if recorder := s.h.Do(http.MethodPost, "/offers/"+offers[0].ID.String()+"/accept", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("accept failed: %d %s", recorder.Code, recorder.Body.String())
	}

	path := "/rides/" + ride.RideID.String() + "/cancel"

	recorder := s.h.Do(http.MethodPost, path, s.driver, map[string]string{"reasonCode": ""})
	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: got %d, want 422 (%s)", recorder.Code, recorder.Body.String())
	}
	if code := decodeError(t, recorder.Body.Bytes()).Code; code != domain.CodeReasonCodeRequired {
		t.Fatalf("code: got %q, want reason_code_required", code)
	}

	// A reason the platform does not know is refused too, so the ops timeline
	// cannot fill up with free text.
	recorder = s.h.Do(http.MethodPost, path, s.driver, map[string]string{"reasonCode": "felt like it"})
	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: got %d, want 422 (%s)", recorder.Code, recorder.Body.String())
	}

	// With a real reason the ride goes back out to matching rather than dying.
	recorder = s.h.Do(http.MethodPost, path, s.driver, map[string]string{"reasonCode": "vehicle_issue"})
	if recorder.Code != http.StatusOK {
		t.Fatalf("cancel failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var view move.RideView
	s.h.DecodeBody(recorder, &view)
	if view.State != machine.RiderRematching {
		t.Fatalf("after a driver cancellation the ride re-matches: got %q", view.State)
	}
	if view.Driver != nil {
		t.Fatal("the cancelled driver must be detached from the ride")
	}
	assertEventPublished(t, s.h, "ride.cancelled_by_driver", ride.RideID)
}

func TestARiderCanCancelWithoutAReasonCode(t *testing.T) {
	s := newScenario(t)
	ride := s.requestRide(s.quote(), "rider-cancel-0001")

	recorder := s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/cancel", s.rider, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("cancel failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var view move.RideView
	s.h.DecodeBody(recorder, &view)
	if view.State != machine.RiderCancelledByRider {
		t.Fatalf("state: got %q", view.State)
	}
	assertEventPublished(t, s.h, "ride.cancelled_by_rider", ride.RideID)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

func TestActiveRideIs204WhenThereIsNone(t *testing.T) {
	h := testutil.NewHarness(t)
	rider := h.Rider()

	recorder := h.Do(http.MethodGet, "/rides/active", rider, nil)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status: got %d, want 204 (%s)", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("a 204 carries no body, got %q", recorder.Body.String())
	}
}

func TestActiveRideReturnsTheLiveRideToBothParties(t *testing.T) {
	s := newScenario(t)
	ride := s.requestRide(s.quote(), "active-0001")
	offers := s.offersFor(ride.RideID)
	if recorder := s.h.Do(http.MethodPost, "/offers/"+offers[0].ID.String()+"/accept", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("accept failed: %d %s", recorder.Code, recorder.Body.String())
	}

	for _, actor := range []testutil.Actor{s.rider, s.driver} {
		recorder := s.h.Do(http.MethodGet, "/rides/active", actor, nil)
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s: got %d, want 200 (%s)", actor.Role, recorder.Code, recorder.Body.String())
		}
		var view move.RideView
		s.h.DecodeBody(recorder, &view)
		if view.RideID != ride.RideID {
			t.Fatalf("%s saw the wrong ride", actor.Role)
		}
	}
}

func TestRideReadCarriesAnETagAndAnswers304(t *testing.T) {
	s := newScenario(t)
	ride := s.requestRide(s.quote(), "etag-0001")

	first := s.h.Do(http.MethodGet, "/rides/"+ride.RideID.String(), s.rider, nil)
	if first.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (%s)", first.Code, first.Body.String())
	}
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("a ride read must carry an ETag over its version")
	}

	second := s.h.Do(http.MethodGet, "/rides/"+ride.RideID.String(), s.rider, nil, "If-None-Match", etag)
	if second.Code != http.StatusNotModified {
		t.Fatalf("an unchanged ride must answer 304, got %d", second.Code)
	}

	// Move the ride on, and the ETag must change.
	offers := s.offersFor(ride.RideID)
	if recorder := s.h.Do(http.MethodPost, "/offers/"+offers[0].ID.String()+"/accept", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("accept failed: %d %s", recorder.Code, recorder.Body.String())
	}
	third := s.h.Do(http.MethodGet, "/rides/"+ride.RideID.String(), s.rider, nil, "If-None-Match", etag)
	if third.Code != http.StatusOK {
		t.Fatalf("a changed ride must be re-sent, got %d", third.Code)
	}
}

// ---------------------------------------------------------------------------
// The final fare comes from the ledger
// ---------------------------------------------------------------------------

func TestTheFinalFareIsReadBackFromTheLedger(t *testing.T) {
	s := newScenario(t)
	ride := s.requestRide(s.quote(), "ledger-0001")
	offers := s.offersFor(ride.RideID)
	if recorder := s.h.Do(http.MethodPost, "/offers/"+offers[0].ID.String()+"/accept", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("accept failed: %d %s", recorder.Code, recorder.Body.String())
	}
	if recorder := s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/arrived", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("arrival failed: %d %s", recorder.Code, recorder.Body.String())
	}
	if recorder := s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/verify-pin", s.driver,
		map[string]string{"pin": ride.Pin}); recorder.Code != http.StatusOK {
		t.Fatalf("PIN verification failed: %d %s", recorder.Code, recorder.Body.String())
	}
	if recorder := s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/start", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("start failed: %d %s", recorder.Code, recorder.Body.String())
	}
	if recorder := s.h.Do(http.MethodPost, "/rides/"+ride.RideID.String()+"/complete", s.driver, nil); recorder.Code != http.StatusOK {
		t.Fatalf("complete failed: %d %s", recorder.Code, recorder.Body.String())
	}

	// Before the ledger posts, the ride reports the server-computed amount and
	// says so; it does not claim the ledger confirmed anything.
	before := s.h.Do(http.MethodGet, "/rides/"+ride.RideID.String(), s.rider, nil)
	var view move.RideView
	s.h.DecodeBody(before, &view)
	if view.FareSource != "server" {
		t.Fatalf("fare source before posting: got %q, want server", view.FareSource)
	}

	// payment-service posts the completion entry. This is what it writes:
	// reference ride:<id>, with the rider's fare line tagged :fare.
	postLedgerEntry(t, s.h, ride.RideID, 987_650, view.Currency)

	after := s.h.Do(http.MethodGet, "/rides/"+ride.RideID.String(), s.rider, nil)
	var settled move.RideView
	s.h.DecodeBody(after, &settled)
	if settled.FareSource != "ledger" {
		t.Fatalf("fare source after posting: got %q, want ledger", settled.FareSource)
	}
	if settled.FinalFareMinor == nil || *settled.FinalFareMinor != 987_650 {
		t.Fatalf("the final fare must come from the journal, got %v", settled.FinalFareMinor)
	}
}

// postLedgerEntry writes a balanced ride completion entry the way
// services/payment-service/src/ledger/ride-posting.ts does, and removes it when
// the test ends.
func postLedgerEntry(t *testing.T, h *testutil.Harness, rideID uuid.UUID, fareMinor int64, currency string) {
	t.Helper()
	ctx := context.Background()
	entryID := "je_test_" + rideID.String()[:8]
	reference := "ride:" + rideID.String()

	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO public.journal_entries (id, kind, reference, description, occurred_at, idempotency_key)
		VALUES ($1, 'ride_completion', $2, 'test ride settlement', now(), $3)`,
		entryID, reference, "ride.completed:"+rideID.String()); err != nil {
		t.Fatalf("failed to write the journal entry: %v", err)
	}
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO public.journal_lines (id, entry_id, account, amount_minor, currency, counterpart_ref)
		VALUES ($1, $2, 'wallet', $3, $4, $5), ($6, $2, 'ubi_commission', $7, $4, $8)`,
		entryID+"_a", entryID, -fareMinor, currency, reference+":fare",
		entryID+"_b", fareMinor, reference+":service_fee"); err != nil {
		t.Fatalf("failed to write the journal lines: %v", err)
	}

	t.Cleanup(func() {
		if _, err := h.Pool.Exec(ctx, `DELETE FROM public.journal_lines WHERE entry_id = $1`, entryID); err != nil {
			t.Logf("failed to clean up journal lines: %v", err)
		}
		if _, err := h.Pool.Exec(ctx, `DELETE FROM public.journal_entries WHERE id = $1`, entryID); err != nil {
			t.Logf("failed to clean up the journal entry: %v", err)
		}
	})
}

// ---------------------------------------------------------------------------
// Driver locations
// ---------------------------------------------------------------------------

func TestImplausibleLocationsAreRejectedPointByPoint(t *testing.T) {
	h := testutil.NewHarness(t)
	driver := h.Driver()
	pickup := testutil.PickupFixture()
	now := h.Clock.Now()

	if recorder := h.Do(http.MethodPost, "/drivers/me/status", driver, move.DriverStatusRequest{
		Online: true, Filters: move.DriverFilters{VehicleClasses: []string{"go"}},
	}); recorder.Code != http.StatusOK {
		t.Fatalf("driver could not go online: %d %s", recorder.Code, recorder.Body.String())
	}

	good := testutil.LocationPointFixture(10, pickup, now)

	imprecise := testutil.LocationPointFixture(11, testutil.PlaceAt(pickup, 20), now)
	imprecise.AccuracyM = 500

	fromTheFuture := testutil.LocationPointFixture(12, testutil.PlaceAt(pickup, 30), now.Add(10*time.Minute))

	ancient := testutil.LocationPointFixture(13, testutil.PlaceAt(pickup, 40), now.Add(-30*time.Minute))

	// 50 km in one second.
	teleport := testutil.LocationPointFixture(14, testutil.PlaceAt(pickup, 50_000), now.Add(time.Second))

	replayed := testutil.LocationPointFixture(5, testutil.PlaceAt(pickup, 10), now)

	recorder := h.Do(http.MethodPost, "/drivers/me/locations", driver, map[string]any{
		"points": []domain.LocationPoint{good, imprecise, fromTheFuture, ancient, teleport, replayed},
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (%s)", recorder.Code, recorder.Body.String())
	}

	var batch move.LocationBatchResult
	h.DecodeBody(recorder, &batch)
	if batch.Accepted != 1 {
		t.Fatalf("only the good point should be accepted, got %d (%+v)", batch.Accepted, batch.Points)
	}
	if batch.Rejected != 5 {
		t.Fatalf("five points should be rejected, got %d (%+v)", batch.Rejected, batch.Points)
	}
	if batch.LastSeq != 10 {
		t.Fatalf("the accepted sequence must be recorded: got %d", batch.LastSeq)
	}

	reasons := map[int64]string{}
	for _, outcome := range batch.Points {
		if !outcome.Accepted {
			reasons[outcome.Seq] = outcome.Reason
		}
	}
	expected := map[int64]string{
		11: domain.LocationRejectedAccuracy,
		12: domain.LocationRejectedFutureTime,
		13: domain.LocationRejectedStaleTime,
		14: domain.LocationRejectedSpeed,
		5:  domain.LocationRejectedStaleSeq,
	}
	for seq, want := range expected {
		if reasons[seq] != want {
			t.Errorf("point %d: got reason %q, want %q", seq, reasons[seq], want)
		}
	}
}

func TestAnOfflineDriverIsNotDispatched(t *testing.T) {
	h := testutil.NewHarness(t)
	s := &scenario{h: h, rider: h.Rider(), driver: h.Driver()}
	s.bringOnline(s.driver, testutil.PlaceAt(testutil.PickupFixture(), 100))

	if recorder := h.Do(http.MethodPost, "/drivers/me/status", s.driver, move.DriverStatusRequest{
		Online: false,
	}); recorder.Code != http.StatusOK {
		t.Fatalf("going offline failed: %d %s", recorder.Code, recorder.Body.String())
	}

	ride := s.requestRide(s.quote(), "offline-driver-0001")
	if offers := s.offersFor(ride.RideID); len(offers) != 0 {
		t.Fatalf("an offline driver must not be offered work, got %d offers", len(offers))
	}
}

// ---------------------------------------------------------------------------
// Feature flags deny by default
// ---------------------------------------------------------------------------

func TestRideRequestIsRefusedWhenTheFlagIsOff(t *testing.T) {
	h := testutil.NewHarness(t, testutil.WithFlag("ride_request", false))
	rider := h.Rider()

	recorder := h.Do(http.MethodPost, "/quotes", rider, move.QuoteRequest{
		Pickup:       testutil.PickupFixture(),
		Dropoff:      testutil.DropoffFixture(),
		VehicleClass: "go",
	})
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status: got %d, want 404 (%s)", recorder.Code, recorder.Body.String())
	}
	if code := decodeError(t, recorder.Body.Bytes()).Code; code != domain.CodeFeatureDisabled {
		t.Fatalf("code: got %q, want feature_disabled", code)
	}
}

func TestAnUnknownCityCannotBeQuoted(t *testing.T) {
	h := testutil.NewHarness(t)
	rider := h.Rider()
	rider.CityID = "ZZZ-not-a-city"

	recorder := h.Do(http.MethodPost, "/quotes", rider, move.QuoteRequest{
		Pickup:       testutil.PickupFixture(),
		Dropoff:      testutil.DropoffFixture(),
		VehicleClass: "go",
	})
	// The flag rules are city-scoped, so an unknown city is denied before its
	// configuration is even looked for.
	if recorder.Code != http.StatusNotFound && recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d, want a refusal (%s)", recorder.Code, recorder.Body.String())
	}
}

// ---------------------------------------------------------------------------
// The dispatcher: widening rings, bounded retries, an honest dead end
// ---------------------------------------------------------------------------

// TestAnUnansweredOfferExpiresAndTheDriverIsFreed drives the sweeper directly,
// so the expiry is proven without waiting out a 12-second TTL.
func TestAnUnansweredOfferExpiresAndTheDriverIsFreed(t *testing.T) {
	s := newScenario(t)
	ride := s.requestRide(s.quote(), "offer-expiry-0001")

	offers := s.offersFor(ride.RideID)
	if len(offers) != 1 {
		t.Fatalf("expected one offer, got %d", len(offers))
	}

	// The city's offer TTL is 12 seconds; step past it and sweep.
	s.h.Clock.Advance(13 * time.Second)
	if err := s.h.Service.Sweep(context.Background()); err != nil {
		t.Fatalf("sweep failed: %v", err)
	}

	after := s.offersFor(ride.RideID)
	var expired int
	for _, offer := range after {
		if offer.ID == offers[0].ID && offer.State == domain.OfferExpired {
			expired++
		}
	}
	if expired != 1 {
		t.Fatalf("the unanswered offer must be recorded as expired: %+v", after)
	}

	// Accepting it now is refused with the expired result, not with silence.
	recorder := s.h.Do(http.MethodPost, "/offers/"+offers[0].ID.String()+"/accept", s.driver, nil)
	var view move.AcceptResultView
	s.h.DecodeBody(recorder, &view)
	if view.Result != domain.AcceptExpired {
		t.Fatalf("accept result: got %q, want expired", view.Result)
	}

	// And the driver is available again, so the next ring can reach them.
	status := s.h.Do(http.MethodGet, "/drivers/me/status", s.driver, nil)
	var session move.DriverStatusView
	s.h.DecodeBody(status, &session)
	if session.State != "available" {
		t.Fatalf("the driver must be free again after the offer expired: got %q", session.State)
	}
}

// TestARideWithNoDriverEndsWithOptionsRatherThanASpinner proves the retries are
// bounded and that the rider is told the truth when they run out (board 1e).
func TestARideWithNoDriverEndsWithOptionsRatherThanASpinner(t *testing.T) {
	h := testutil.NewHarness(t, testutil.WithPolicy(matching.Policy{MaxRounds: 1}))
	s := &scenario{h: h, rider: h.Rider(), driver: h.Driver()}

	// A driver exists, but far outside every configured ring.
	s.bringOnline(s.driver, testutil.PlaceAt(testutil.PickupFixture(), 50_000))

	ride := s.requestRide(s.quote(), "no-driver-0001")
	if offers := s.offersFor(ride.RideID); len(offers) != 0 {
		t.Fatalf("nobody is in range, so nobody should be offered: %d offers", len(offers))
	}

	// Two configured rings, then the round is spent.
	for i := 0; i < 3; i++ {
		if err := h.Service.Sweep(context.Background()); err != nil {
			t.Fatalf("sweep %d failed: %v", i, err)
		}
	}

	recorder := h.Do(http.MethodGet, "/rides/"+ride.RideID.String(), s.rider, nil)
	var view move.RideView
	h.DecodeBody(recorder, &view)
	if view.State != machine.RiderNoDriver {
		t.Fatalf("state: got %q, want no_driver", view.State)
	}
	if view.Status != "NO_DRIVER" {
		t.Fatalf("status: got %q, want NO_DRIVER", view.Status)
	}
	if len(view.Options) == 0 {
		t.Fatal("a stranded rider must be given options, not a spinner")
	}
	assertEventPublished(t, h, "ride.no_driver", ride.RideID)
	assertEventPublished(t, h, "matching.retry", ride.RideID)
}
