// Cross-tenant authorization at the mounted HTTP surface.
//
// These tests drive the REAL /v1 router (rides + marketplace) against live
// Postgres/Redis through the shared harness, as one authenticated user trying
// to read or move another user's data. The repo convention under test: a
// resource that is not yours answers 404 not_found (existence is not leaked),
// and a role that may never use an endpoint answers 403 forbidden.
//
// The signed-identity half mounts the same routes behind a verifier with a
// configured secret, proving the boundary holds at the route level: unsigned
// → 401, stale → 401, rotated-out-but-listed key → still accepted.
package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/handler"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// ---------------------------------------------------------------------------
// Local helpers (the marketplace package's test helpers are not importable)
// ---------------------------------------------------------------------------

func decodeMap(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode %q: %v", recorder.Body.String(), err)
	}
	return body
}

func requireStatus(t *testing.T, recorder *httptest.ResponseRecorder, want int) {
	t.Helper()
	if recorder.Code != want {
		t.Fatalf("status: got %d, want %d (%s)", recorder.Code, want, recorder.Body.String())
	}
}

func requireRefusal(t *testing.T, recorder *httptest.ResponseRecorder, status int, code domain.Code) {
	t.Helper()
	requireStatus(t, recorder, status)
	body := decodeMap(t, recorder)
	if body["code"] != string(code) {
		t.Fatalf("error code: got %v, want %s (%s)", body["code"], code, recorder.Body.String())
	}
}

func coordinate(value float64) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func moneyBody(minor int64) map[string]any {
	return map[string]any{"amountMinor": minor, "currency": "NGN"}
}

func moneyMinor(t *testing.T, body map[string]any, key string) int64 {
	t.Helper()
	object, ok := body[key].(map[string]any)
	if !ok {
		t.Fatalf("%s is not a Money object in %v", key, body)
	}
	amount, ok := object["amountMinor"].(float64)
	if !ok {
		t.Fatalf("%s carries no amountMinor: %v", key, object)
	}
	return int64(amount)
}

func idemKey() string { return "authz-" + uuid.NewString() }

// publishRequest takes rider through quote → publish and returns the request
// id and the quote's minimum fare.
func publishRequest(t *testing.T, h *testutil.Harness, rider testutil.Actor) (string, int64) {
	t.Helper()
	pickup, dropoff := testutil.PickupFixture(), testutil.DropoffFixture()
	path := "/mp/quote?service=ride&vehicleClass=go" +
		"&pickupLat=" + coordinate(pickup.Lat) + "&pickupLng=" + coordinate(pickup.Lng) +
		"&dropoffLat=" + coordinate(dropoff.Lat) + "&dropoffLng=" + coordinate(dropoff.Lng)
	recorder := h.Do(http.MethodGet, path, rider, nil)
	requireStatus(t, recorder, http.StatusOK)
	quote := decodeMap(t, recorder)
	amount := moneyMinor(t, quote, "minimumFareMinor")

	recorder = h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(amount),
		"paymentMethodId":    "wallet",
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, recorder, http.StatusCreated)
	view := decodeMap(t, recorder)
	return view["requestId"].(string), amount
}

// parkDriver brings a driver online, stationary at a place, and confirms
// parked — the full setup a current-slot bid needs.
func parkDriver(t *testing.T, h *testutil.Harness, driver testutil.Actor, place domain.Place) {
	t.Helper()
	recorder := h.Do(http.MethodPost, "/drivers/me/status", driver, map[string]any{
		"online":  true,
		"filters": map[string]any{"vehicleClasses": []string{"go"}},
	})
	requireStatus(t, recorder, http.StatusOK)

	now := h.Clock.Now()
	points := make([]map[string]any, 0, 4)
	for i, offset := range []time.Duration{-90 * time.Second, -60 * time.Second, -30 * time.Second, -time.Second} {
		points = append(points, map[string]any{
			"seq":                  i + 1,
			"lat":                  place.Lat,
			"lng":                  place.Lng,
			"accuracyMeters":       8.0,
			"speedMetersPerSecond": 0.0,
			"recordedAt":           now.Add(offset).Format(time.RFC3339Nano),
		})
	}
	recorder = h.Do(http.MethodPost, "/drivers/me/locations", driver, map[string]any{"points": points})
	requireStatus(t, recorder, http.StatusOK)
	recorder = h.Do(http.MethodPost, "/mp/driver/parked", driver, nil)
	requireStatus(t, recorder, http.StatusOK)
}

// awardTo runs bid → select so the request carries an award for the driver.
func awardTo(t *testing.T, h *testutil.Harness, rider, driver testutil.Actor, requestID string, amount int64) {
	t.Helper()
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	recorder := h.Do(http.MethodPost, "/mp/bids", driver, map[string]any{
		"requestId":         requestID,
		"requestRevision":   1,
		"amountMinor":       moneyBody(amount),
		"slot":              "current",
		"availabilityEpoch": 0,
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, recorder, http.StatusCreated)
	bid := decodeMap(t, recorder)

	recorder = h.Do(http.MethodPost, "/mp/requests/"+requestID+"/select", rider, map[string]any{
		"bidId":          bid["bidId"],
		"requestVersion": 1,
		"bidVersion":     1,
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, recorder, http.StatusAccepted)
}

// ---------------------------------------------------------------------------
// Marketplace: another tenant's request, queue detail and award
// ---------------------------------------------------------------------------

// TestCrossTenantMarketplaceReadsAnswerNotFound: rider B (same city, valid
// identity) probing rider A's request detail and award learns nothing — 404,
// never the offers, never the award, never a hint the id exists.
func TestCrossTenantMarketplaceReadsAnswerNotFound(t *testing.T) {
	h := testutil.NewHarness(t, testutil.WithMarketplace())
	riderA := h.Rider()
	riderB := h.Rider()
	driverA := h.Driver()
	driverB := h.Driver()

	requestID, amount := publishRequest(t, h, riderA)

	t.Run("request detail is owner-only", func(t *testing.T) {
		owner := h.Do(http.MethodGet, "/mp/requests/"+requestID, riderA, nil)
		requireStatus(t, owner, http.StatusOK)
		stranger := h.Do(http.MethodGet, "/mp/requests/"+requestID, riderB, nil)
		requireRefusal(t, stranger, http.StatusNotFound, domain.CodeNotFound)
	})

	t.Run("another tenant cannot cancel the request", func(t *testing.T) {
		recorder := h.Do(http.MethodPost, "/mp/requests/"+requestID+"/cancel", riderB, nil,
			move.IdempotencyHeader, idemKey())
		requireRefusal(t, recorder, http.StatusNotFound, domain.CodeNotFound)
	})

	parkDriver(t, h, driverA, testutil.PickupFixture())
	awardTo(t, h, riderA, driverA, requestID, amount)

	t.Run("the award is visible to the owner and the winning driver only", func(t *testing.T) {
		owner := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/award", riderA, nil)
		requireStatus(t, owner, http.StatusOK)
		winner := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/award", driverA, nil)
		requireStatus(t, winner, http.StatusOK)

		strangerRider := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/award", riderB, nil)
		requireRefusal(t, strangerRider, http.StatusNotFound, domain.CodeNotFound)
		strangerDriver := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/award", driverB, nil)
		requireRefusal(t, strangerDriver, http.StatusNotFound, domain.CodeNotFound)
	})

	t.Run("a driver's bid list and job queue never carry another driver's rows", func(t *testing.T) {
		recorder := h.Do(http.MethodGet, "/mp/bids/mine", driverB, nil)
		requireStatus(t, recorder, http.StatusOK)
		if bids, ok := decodeMap(t, recorder)["bids"].([]any); ok && len(bids) != 0 {
			t.Fatalf("driver B sees %d bids that are not theirs", len(bids))
		}
		recorder = h.Do(http.MethodGet, "/mp/driver/jobs", driverB, nil)
		requireStatus(t, recorder, http.StatusOK)
		body := recorder.Body.String()
		if jobs, ok := decodeMap(t, recorder)["jobs"].([]any); ok && len(jobs) != 0 {
			t.Fatalf("driver B sees %d jobs that are not theirs: %s", len(jobs), body)
		}
	})

	t.Run("a rider role may not use driver money endpoints at all", func(t *testing.T) {
		recorder := h.Do(http.MethodGet, "/mp/bids/mine", riderB, nil)
		requireRefusal(t, recorder, http.StatusForbidden, domain.CodeForbidden)
	})
}

// ---------------------------------------------------------------------------
// Move core: another tenant's ride
// ---------------------------------------------------------------------------

// TestCrossTenantRideReadsAnswerNotFound: a ride is readable by its rider, its
// assigned driver and an admin; every other authenticated identity gets 404 —
// including the PIN endpoint, so a foreign driver cannot burn a ride's PIN
// attempts.
func TestCrossTenantRideReadsAnswerNotFound(t *testing.T) {
	h := testutil.NewHarness(t)
	riderA := h.Rider()
	riderB := h.Rider()
	driverB := h.Driver()

	quoteRecorder := h.Do(http.MethodPost, "/quotes", riderA, move.QuoteRequest{
		Pickup:       testutil.PickupFixture(),
		Dropoff:      testutil.DropoffFixture(),
		VehicleClass: "go",
	})
	requireStatus(t, quoteRecorder, http.StatusCreated)
	var quote move.QuoteView
	h.DecodeBody(quoteRecorder, &quote)

	rideRecorder := h.Do(http.MethodPost, "/rides", riderA, move.CreateRideRequest{
		QuoteID:         quote.QuoteID,
		Signature:       quote.Signature,
		PaymentMethodID: "cash",
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, rideRecorder, http.StatusCreated)
	var ride move.CreateRideResult
	h.DecodeBody(rideRecorder, &ride)
	ridePath := "/rides/" + ride.RideID.String()

	owner := h.Do(http.MethodGet, ridePath, riderA, nil)
	requireStatus(t, owner, http.StatusOK)

	for name, actor := range map[string]testutil.Actor{
		"another rider":       riderB,
		"an unrelated driver": driverB,
	} {
		t.Run(name+" cannot read the ride", func(t *testing.T) {
			requireRefusal(t, h.Do(http.MethodGet, ridePath, actor, nil), http.StatusNotFound, domain.CodeNotFound)
		})
		t.Run(name+" cannot read the dispatch timeline", func(t *testing.T) {
			requireRefusal(t, h.Do(http.MethodGet, ridePath+"/offers", actor, nil), http.StatusNotFound, domain.CodeNotFound)
		})
	}

	t.Run("an unrelated driver cannot probe the pickup PIN", func(t *testing.T) {
		recorder := h.Do(http.MethodPost, ridePath+"/verify-pin", driverB, map[string]string{"pin": "0000"})
		requireRefusal(t, recorder, http.StatusNotFound, domain.CodeNotFound)
	})
}

// ---------------------------------------------------------------------------
// Signed identity at the mounted routes
// ---------------------------------------------------------------------------

// signedRequest builds a request carrying the full signed header set.
func signedRequest(method, path string, verifier *handler.InternalContextVerifier, actor testutil.Actor, issuedAt time.Time) *http.Request {
	request := httptest.NewRequest(method, path, nil)
	request.Header.Set(handler.HeaderUserID, actor.UserID.String())
	request.Header.Set(handler.HeaderUserRole, actor.Role)
	request.Header.Set(handler.HeaderCityID, actor.CityID)
	request.Header.Set(handler.HeaderIssuedAt, strconv.FormatInt(issuedAt.Unix(), 10))
	request.Header.Set(handler.HeaderSignature, verifier.Sign(actor.UserID.String(), actor.Role, actor.CityID, issuedAt))
	return request
}

// TestSignedIdentityGuardsTheMountedRoutes proves the fail-closed behavior of
// the whole mounted surface once a secret is configured, including rotation
// and staleness — not just the middleware in isolation.
func TestSignedIdentityGuardsTheMountedRoutes(t *testing.T) {
	h := testutil.NewHarness(t, testutil.WithMarketplace())

	const currentKey = "route-secret-current-0000000000001"
	const previousKey = "route-secret-previous-000000000001"
	verifier := handler.NewInternalContextVerifier(currentKey+","+previousKey, 5*time.Minute)
	previousOnly := handler.NewInternalContextVerifier(previousKey, 5*time.Minute)

	router := handler.NewRideHandler(h.Service, zerolog.Nop()).
		Routes(handler.RequireIdentity(verifier), nil,
			handler.NewMarketplaceHandler(h.Marketplace, zerolog.Nop()))

	serve := func(request *http.Request) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		return recorder
	}
	rider := h.Rider()

	t.Run("unsigned request is refused with 401", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/rides/active", nil)
		request.Header.Set(handler.HeaderUserID, rider.UserID.String())
		request.Header.Set(handler.HeaderUserRole, rider.Role)
		request.Header.Set(handler.HeaderCityID, rider.CityID)
		requireRefusal(t, serve(request), http.StatusUnauthorized, domain.CodeUnauthorized)
	})

	t.Run("a correctly signed request reaches the handler", func(t *testing.T) {
		recorder := serve(signedRequest(http.MethodGet, "/rides/active", verifier, rider, time.Now()))
		// This rider has no active ride, so the HANDLER answers 204: proof the
		// request cleared the identity boundary rather than being 401'd.
		requireStatus(t, recorder, http.StatusNoContent)
	})

	t.Run("a stale issuedAt is refused even with a valid signature", func(t *testing.T) {
		stale := time.Now().Add(-time.Hour)
		recorder := serve(signedRequest(http.MethodGet, "/rides/active", verifier, rider, stale))
		requireRefusal(t, recorder, http.StatusUnauthorized, domain.CodeUnauthorized)
	})

	t.Run("a signature by the rotated-out key verifies while it is listed", func(t *testing.T) {
		recorder := serve(signedRequest(http.MethodGet, "/rides/active", previousOnly, rider, time.Now()))
		requireStatus(t, recorder, http.StatusNoContent)
	})
}
