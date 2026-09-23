package handler

import (
	"net"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// Book for another adult (A06 part B).
//
// Two kinds of route live here:
//
//   - the REQUESTER's access controls under /mp/requests/{id}/passenger —
//     gateway identity like every /v1/mp route, Idempotency-Key required;
//   - the PASSENGER's trip link under /mp/trip-access — authenticated ONLY by
//     the trip access token in the X-Trip-Access-Token header (never in the
//     URL, so it stays out of access logs and Referer headers). These are
//     mounted OUTSIDE the gateway-identity middleware (RideHandler.Routes)
//     because the passenger is not a UBI user; a gateway identity, if one
//     arrives, grants nothing here. Every call is rate limited per client and
//     per token before the token is looked up, every answer is no-store, and
//     the token opens its one trip and nothing else.

// HeaderTripAccessToken carries a guest passenger's trip access token.
const HeaderTripAccessToken = "X-Trip-Access-Token"

// mountRequestGuest attaches the requester's passenger-access routes under
// /mp/requests.
func (h *MarketplaceHandler) mountRequestGuest(r chi.Router) {
	r.Post("/{requestId}/passenger/access/revoke", h.RevokePassengerAccess)
	r.Post("/{requestId}/passenger/access/reissue", h.ReissuePassengerAccess)
}

// mountTripAccess attaches the passenger's token-authenticated trip link. It
// is called on the /v1 router OUTSIDE the identity group.
func (h *MarketplaceHandler) mountTripAccess(r chi.Router) {
	r.Get("/mp/trip-access", h.TripAccessView)
	r.Get("/mp/trip-access/pin", h.TripAccessPin)
	r.Post("/mp/trip-access/decline", h.TripAccessDecline)
}

// RevokePassengerAccess handles POST /v1/mp/requests/{requestId}/passenger/access/revoke.
func (h *MarketplaceHandler) RevokePassengerAccess(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.RevokePassengerAccess(r.Context(), actor, requestID, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// ReissuePassengerAccess handles POST /v1/mp/requests/{requestId}/passenger/access/reissue.
func (h *MarketplaceHandler) ReissuePassengerAccess(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.ReissuePassengerAccess(r.Context(), actor, requestID, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// tripAccess rate-limits and authenticates a trip-link call. It writes the
// refusal itself and reports whether the handler may go on.
func (h *MarketplaceHandler) tripAccess(w http.ResponseWriter, r *http.Request) (*marketplace.TripAccessSession, bool) {
	// A trip link's answers are personal and short-lived: never cached, and
	// never leaked onward through a Referer.
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	raw := strings.TrimSpace(r.Header.Get(HeaderTripAccessToken))
	if err := h.service.LimitTripAccess(r.Context(), clientKey(r), raw); err != nil {
		h.fail(w, r, err)
		return nil, false
	}
	session, err := h.service.AuthenticateTripAccess(r.Context(), raw)
	if err != nil {
		h.fail(w, r, err)
		return nil, false
	}
	return session, true
}

// clientKey is the caller's address without its port (main.go's RealIP has
// already resolved the forwarded client address).
func clientKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// TripAccessView handles GET /v1/mp/trip-access.
func (h *MarketplaceHandler) TripAccessView(w http.ResponseWriter, r *http.Request) {
	session, ok := h.tripAccess(w, r)
	if !ok {
		return
	}
	view, err := h.service.TripAccessView(r.Context(), session)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// TripAccessPin handles GET /v1/mp/trip-access/pin.
func (h *MarketplaceHandler) TripAccessPin(w http.ResponseWriter, r *http.Request) {
	session, ok := h.tripAccess(w, r)
	if !ok {
		return
	}
	view, err := h.service.TripAccessPin(r.Context(), session)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// TripAccessDecline handles POST /v1/mp/trip-access/decline.
func (h *MarketplaceHandler) TripAccessDecline(w http.ResponseWriter, r *http.Request) {
	session, ok := h.tripAccess(w, r)
	if !ok {
		return
	}
	view, status, err := h.service.DeclineTrip(r.Context(), session, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}
