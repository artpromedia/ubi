package handlers_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/identity"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/testutil"
)

// The production posture of the custody/return routes, proven through the
// router cmd/server serves (handlers.NewRouter) against the live database:
// in production the gateway's plain identity headers authenticate nobody, a
// tampered signature is refused before any handler runs, and a process built
// without a context secret refuses everything instead of falling back to the
// headers. Every refusal is also checked to have left custody state untouched.

const productionContextSecret = "prod-gateway-context-key-for-tests"

// custodySnapshot is the state a refused request must not have moved.
type custodySnapshot struct {
	State   string
	Version int
	Events  int
	Proofs  int
}

func snapshotCustody(t *testing.T, h *testutil.Harness, deliveryID string) custodySnapshot {
	t.Helper()
	ctx := context.Background()
	var snap custodySnapshot
	if err := h.Pool.QueryRow(ctx,
		`SELECT state, version FROM delivery_custody WHERE delivery_id = $1`, deliveryID,
	).Scan(&snap.State, &snap.Version); err != nil {
		t.Fatalf("read delivery_custody: %v", err)
	}
	if err := h.Pool.QueryRow(ctx,
		`SELECT count(*) FROM custody_events WHERE delivery_id = $1`, deliveryID,
	).Scan(&snap.Events); err != nil {
		t.Fatalf("count custody_events: %v", err)
	}
	if err := h.Pool.QueryRow(ctx,
		`SELECT count(*) FROM delivery_proofs WHERE delivery_id = $1`, deliveryID,
	).Scan(&snap.Proofs); err != nil {
		t.Fatalf("count delivery_proofs: %v", err)
	}
	return snap
}

func requireUntouched(t *testing.T, h *testutil.Harness, deliveryID string) {
	t.Helper()
	want := custodySnapshot{State: "courier_assigned", Version: 1}
	if got := snapshotCustody(t, h, deliveryID); got != want {
		t.Fatalf("a refused request moved custody: got %+v, want %+v", got, want)
	}
}

func requireErrorCode(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantCode string) {
	t.Helper()
	if rec.Code != wantStatus {
		t.Fatalf("status = %d, want %d (body %s)", rec.Code, wantStatus, rec.Body.String())
	}
	var env apiEnvelope
	decode(t, rec, &env)
	if env.Success || env.Error == nil || env.Error.Code != wantCode {
		t.Fatalf("error = %+v, want code %s (body %s)", env.Error, wantCode, rec.Body.String())
	}
}

// signedFor builds a request carrying the given identity headers and a
// signature computed by signer over signedAs — letting a test present one
// identity while holding a signature for another.
func signedFor(r *http.Request, presented testutil.Actor, signer *identity.Verifier, signedAs testutil.Actor, issuedAt time.Time) *http.Request {
	r.Header.Set(identity.HeaderUserID, presented.UserID.String())
	r.Header.Set(identity.HeaderUserRole, presented.Role)
	r.Header.Set(identity.HeaderCityID, presented.CityID)
	r.Header.Set(identity.HeaderSignature, signer.Sign(signedAs.UserID.String(), signedAs.Role, signedAs.CityID, issuedAt))
	r.Header.Set(identity.HeaderIssuedAt, strconv.FormatInt(issuedAt.Unix(), 10))
	return r
}

func serve(h *testutil.Harness, r *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.Router.ServeHTTP(rec, r)
	return rec
}

// TestProductionCustodyRefusesUnsignedIdentity: the exact headers the
// dev-trust posture accepts — the real assigned driver's and sender's ids —
// are refused in production when they arrive unsigned.
func TestProductionCustodyRefusesUnsignedIdentity(t *testing.T) {
	h := testutil.NewProductionHarness(t, productionContextSecret)
	if err := h.Cfg.ValidateProduction(); err != nil {
		t.Fatalf("the harness must model a configuration production would boot: %v", err)
	}
	deliveryID, actors := h.SeedDelivery(context.Background(), testutil.Actor{}, testutil.Actor{}, "")

	rec := h.Do(req(http.MethodPost, custodyPath(deliveryID, "/pickup-proof"), proofPayload("unsigned-1")), actors.Driver)
	requireErrorCode(t, rec, http.StatusUnauthorized, "UNAUTHORIZED")

	rec = h.Do(req(http.MethodGet, custodyPath(deliveryID, "/"), nil), actors.Sender)
	requireErrorCode(t, rec, http.StatusUnauthorized, "UNAUTHORIZED")

	requireUntouched(t, h, deliveryID)
}

// TestProductionCustodyRefusesTamperedIdentity: every way of presenting an
// identity the gateway did not sign is refused with 401 by the identity
// middleware — before the custody handler's own 403/404 checks could even
// run — and moves nothing.
func TestProductionCustodyRefusesTamperedIdentity(t *testing.T) {
	h := testutil.NewProductionHarness(t, productionContextSecret)
	deliveryID, actors := h.SeedDelivery(context.Background(), testutil.Actor{}, testutil.Actor{}, "")
	gateway := h.Verifier
	foreignKey := identity.NewVerifier("a-key-the-gateway-does-not-hold", 0)
	foreignDriver := testutil.Driver()
	asAdmin := actors.Sender
	asAdmin.Role = identity.RoleAdmin
	otherCity := actors.Driver
	otherCity.CityID = "NBO"
	now := time.Now()

	cases := []struct {
		name  string
		build func(r *http.Request) *http.Request
	}{
		{"impersonating the assigned driver with a foreign driver's signature", func(r *http.Request) *http.Request {
			return signedFor(r, actors.Driver, gateway, foreignDriver, now)
		}},
		{"escalating the sender's signed rider identity to admin", func(r *http.Request) *http.Request {
			return signedFor(r, asAdmin, gateway, actors.Sender, now)
		}},
		{"moving the driver's signed identity to another city", func(r *http.Request) *http.Request {
			return signedFor(r, otherCity, gateway, actors.Driver, now)
		}},
		{"signing the assigned driver's identity with a foreign key", func(r *http.Request) *http.Request {
			return signedFor(r, actors.Driver, foreignKey, actors.Driver, now)
		}},
		{"replaying an expired gateway signature", func(r *http.Request) *http.Request {
			return signedFor(r, actors.Driver, gateway, actors.Driver, now.Add(-10*time.Minute))
		}},
		{"a valid signature with an unreadable timestamp", func(r *http.Request) *http.Request {
			r = signedFor(r, actors.Driver, gateway, actors.Driver, now)
			r.Header.Set(identity.HeaderIssuedAt, "not-a-timestamp")
			return r
		}},
		{"a signature with no timestamp", func(r *http.Request) *http.Request {
			r = signedFor(r, actors.Driver, gateway, actors.Driver, now)
			r.Header.Del(identity.HeaderIssuedAt)
			return r
		}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			r := testCase.build(req(http.MethodPost, custodyPath(deliveryID, "/pickup-proof"), proofPayload("tamper-1")))
			requireErrorCode(t, serve(h, r), http.StatusUnauthorized, "UNAUTHORIZED")
			requireUntouched(t, h, deliveryID)
		})
	}
}

// TestProductionCustodyAcceptsGatewaySignedIdentity: the refusals above are
// not a blanket refusal — a gateway-signed identity drives custody normally,
// including one signed with the previous key during a rotation.
func TestProductionCustodyAcceptsGatewaySignedIdentity(t *testing.T) {
	h := testutil.NewProductionHarness(t, productionContextSecret+",previous-gateway-context-key")
	deliveryID, actors := h.SeedDelivery(context.Background(), testutil.Actor{}, testutil.Actor{}, "")

	previousKey := identity.NewVerifier("previous-gateway-context-key", 0)
	r := signedFor(req(http.MethodPost, custodyPath(deliveryID, "/pickup-proof"), proofPayload("signed-1")), actors.Driver, previousKey, actors.Driver, time.Now())
	if rec := serve(h, r); rec.Code != http.StatusCreated {
		t.Fatalf("pickup-proof signed with the previous key: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	rec := h.DoSigned(req(http.MethodGet, custodyPath(deliveryID, "/"), nil), actors.Sender)
	if rec.Code != http.StatusOK {
		t.Fatalf("timeline signed with the current key: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	snap := snapshotCustody(t, h, deliveryID)
	if snap.State == "courier_assigned" || snap.Proofs != 1 || snap.Events == 0 {
		t.Fatalf("a signed pickup proof must move custody exactly once: %+v", snap)
	}

	ready := serve(h, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if ready.Code != http.StatusOK {
		t.Fatalf("readiness with a configured context secret: status = %d, body = %s", ready.Code, ready.Body.String())
	}
}

// TestProductionWithoutContextSecretFailsClosed: the configuration boot
// refuses is also refused per request and by readiness — the second line of
// defence if the boot check were ever refactored away. Even the real assigned
// driver's headers get 503, never dev-trust.
func TestProductionWithoutContextSecretFailsClosed(t *testing.T) {
	h := testutil.NewProductionHarness(t, "")
	if err := h.Cfg.ValidateProduction(); err == nil || !strings.Contains(err.Error(), "RIDE_INTERNAL_CONTEXT_SECRET") {
		t.Fatalf("boot must refuse production without RIDE_INTERNAL_CONTEXT_SECRET: %v", err)
	}
	deliveryID, actors := h.SeedDelivery(context.Background(), testutil.Actor{}, testutil.Actor{}, "")

	rec := h.Do(req(http.MethodPost, custodyPath(deliveryID, "/pickup-proof"), proofPayload("nokey-1")), actors.Driver)
	requireErrorCode(t, rec, http.StatusServiceUnavailable, "IDENTITY_NOT_CONFIGURED")
	rec = h.Do(req(http.MethodPost, custodyPath(deliveryID, "/return/consent"), map[string]interface{}{"decision": "approve"}), actors.Sender)
	requireErrorCode(t, rec, http.StatusServiceUnavailable, "IDENTITY_NOT_CONFIGURED")
	requireUntouched(t, h, deliveryID)

	ready := serve(h, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if ready.Code != http.StatusServiceUnavailable || !strings.Contains(ready.Body.String(), `"identity"`) {
		t.Fatalf("readiness must refuse and name the identity check: status = %d, body = %s", ready.Code, ready.Body.String())
	}
}

// identityFreeRoutes are the only mounted routes that act on nobody's
// identity (probes, fare quotes, zone lookup). Every other route must refuse
// a request that carries only the gateway's plain identity headers. A new
// route is therefore either classified here on purpose or proven to refuse.
var identityFreeRoutes = map[string]bool{
	"GET /health":             true,
	"GET /health/live":        true,
	"GET /health/ready":       true,
	"POST /api/v1/quotes/":    true,
	"GET /api/v1/zones/":      true,
	"GET /api/v1/zones/check": true,
}

// TestProductionEveryIdentityRouteRefusesUnsignedHeaders walks the router
// cmd/server serves and sends each identity-bearing route the assigned
// driver's unsigned gateway headers (and no bearer token, no service key).
// Custody/return routes must answer the identity middleware's 401; legacy
// routes their JWT 401; webhooks (the marketplace hand-off included) their
// service-key 403. Nothing may reach a handler, so custody stays untouched.
func TestProductionEveryIdentityRouteRefusesUnsignedHeaders(t *testing.T) {
	h := testutil.NewProductionHarness(t, productionContextSecret)
	deliveryID, actors := h.SeedDelivery(context.Background(), testutil.Actor{}, testutil.Actor{}, "")

	routes, ok := h.Router.(chi.Routes)
	if !ok {
		t.Fatalf("the production router is not walkable: %T", h.Router)
	}
	var walked, custodyRoutes int
	err := chi.Walk(routes, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		key := method + " " + route
		if identityFreeRoutes[key] {
			return nil
		}
		walked++
		path := strings.ReplaceAll(route, "{id}", deliveryID)
		rec := h.Do(req(method, path, map[string]interface{}{}), actors.Driver)
		t.Logf("%s -> %d", key, rec.Code)

		switch {
		case strings.HasPrefix(route, "/api/v1/deliveries/{id}/custody"):
			custodyRoutes++
			if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "no signed caller identity") {
				t.Errorf("%s: custody route must refuse unsigned identity in the identity middleware: status = %d, body = %s", key, rec.Code, rec.Body.String())
			}
		case strings.HasPrefix(route, "/api/v1/webhooks/"):
			if rec.Code != http.StatusForbidden {
				t.Errorf("%s: webhook must refuse without the service key: status = %d, body = %s", key, rec.Code, rec.Body.String())
			}
		default:
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s: identity-bearing route must refuse gateway headers without its own credential: status = %d, body = %s", key, rec.Code, rec.Body.String())
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk the router: %v", err)
	}
	if custodyRoutes != 7 {
		t.Fatalf("expected the 7 mounted custody/return routes to be walked, got %d", custodyRoutes)
	}
	if walked == custodyRoutes {
		t.Fatal("expected legacy and webhook routes to be walked too")
	}
	requireUntouched(t, h, deliveryID)
}
