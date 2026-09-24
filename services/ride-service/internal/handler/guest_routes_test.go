package handler_test

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/handler"
)

var routeParam = regexp.MustCompile(`\{[^}]+\}`)

// TestOnlyTheTripLinkIsOutsideIdentity: the guest passenger's trip link (A06
// part B) is the ONLY surface mounted outside the gateway-identity
// middleware. Every other route the production constructor serves refuses a
// caller with no identity at the middleware (401) — no handler runs, so the
// nil services here are never reached — and the routes outside identity are
// exactly the three token-authenticated trip-link routes.
func TestOnlyTheTripLinkIsOutsideIdentity(t *testing.T) {
	logger := zerolog.Nop()
	api := handler.NewRideHandler(nil, logger).Routes(
		handler.RequireIdentity(handler.NewInternalContextVerifier("", 0)),
		handler.NewLocationHandler(nil),
		handler.NewMarketplaceHandler(nil, logger),
	)

	var outside []string
	checked := 0
	err := chi.Walk(api, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.HasPrefix(route, "/mp/trip-access") {
			outside = append(outside, method+" "+route)
			return nil
		}
		path := routeParam.ReplaceAllString(route, uuid.NewString())
		recorder := httptest.NewRecorder()
		api.ServeHTTP(recorder, httptest.NewRequest(method, path, nil))
		if recorder.Code != http.StatusUnauthorized {
			t.Errorf("%s %s answered %d without identity; every route but the trip link requires it", method, route, recorder.Code)
		}
		checked++
		return nil
	})
	if err != nil {
		t.Fatalf("walk the router: %v", err)
	}
	if checked < 50 {
		t.Fatalf("the walk covered only %d identified routes; the constructor stopped mounting its surface", checked)
	}
	// Unknown paths and methods meet identity first too, so an anonymous
	// caller cannot map the surface by 404s.
	for _, probe := range []struct{ method, path string }{
		{http.MethodGet, "/no-such-route"},
		{http.MethodGet, "/mp/no-such-route"},
		{http.MethodDelete, "/mp/trip-access"},
		{http.MethodPut, "/rides/active"},
	} {
		recorder := httptest.NewRecorder()
		api.ServeHTTP(recorder, httptest.NewRequest(probe.method, probe.path, nil))
		if recorder.Code != http.StatusUnauthorized {
			t.Errorf("%s %s answered %d to an anonymous caller; want 401", probe.method, probe.path, recorder.Code)
		}
	}
	sort.Strings(outside)
	want := []string{"GET /mp/trip-access", "GET /mp/trip-access/pin", "POST /mp/trip-access/decline"}
	if strings.Join(outside, "|") != strings.Join(want, "|") {
		t.Fatalf("routes outside identity: got %v, want exactly %v", outside, want)
	}
}
