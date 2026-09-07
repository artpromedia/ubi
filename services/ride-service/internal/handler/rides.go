// Package handler provides the HTTP surface of the ride service.
//
// Every route is under /v1 and every route is behind RequireIdentity: the
// caller's user id, role and city come from the gateway's signed headers and
// never from the request body, so no handler can be talked into acting as
// somebody else (hard rule 3).
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// maxRequestBytes caps a request body. Every body this service takes is a
// handful of fields; anything larger is a mistake or an attack.
const maxRequestBytes = 64 * 1024

// emptyBodyMessage marks the one decoding failure a handler may choose to
// tolerate: no body at all.
const emptyBodyMessage = "this endpoint needs a JSON body"

// RideHandler serves the Move endpoints.
type RideHandler struct {
	service *move.Service
	logger  zerolog.Logger
}

// NewRideHandler builds the handler.
func NewRideHandler(service *move.Service, logger zerolog.Logger) *RideHandler {
	return &RideHandler{service: service, logger: logger}
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if body == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(body); err != nil {
		// The status is already written; there is nothing honest left to send.
		return
	}
}

// writeError renders the canonical error body every UBI service uses:
// { code, message, details }, with the status the code maps to. Clients branch
// on `code`, never on message text.
func writeError(w http.ResponseWriter, err error) {
	mapped, ok := domain.AsError(err)
	if !ok {
		mapped = domain.Errorf(domain.CodeInternalError, "the request could not be completed")
	}
	writeJSON(w, mapped.Status(), mapped)
}

// fail logs server-side failures with the request path and the code, and never
// with the caller's identity or coordinates (CLAUDE.md #7).
func (h *RideHandler) fail(w http.ResponseWriter, r *http.Request, err error) {
	mapped, ok := domain.AsError(err)
	if !ok {
		mapped = domain.Errorf(domain.CodeInternalError, "the request could not be completed").Wrap(err)
	}
	if mapped.Status() >= 500 {
		h.logger.Error().Err(err).Str("path", r.URL.Path).Str("code", string(mapped.Code)).Msg("request failed")
	} else {
		h.logger.Info().Str("path", r.URL.Path).Str("code", string(mapped.Code)).Msg("request rejected")
	}
	writeJSON(w, mapped.Status(), mapped)
}

func decodeBody(r *http.Request, target any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, maxRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		if errors.Is(err, io.EOF) {
			return domain.Errorf(domain.CodeValidationFailed, "%s", emptyBodyMessage)
		}
		return domain.Errorf(domain.CodeValidationFailed, "the request body could not be read: %s", err.Error())
	}
	return nil
}

func (h *RideHandler) actor(w http.ResponseWriter, r *http.Request) (move.Actor, bool) {
	actor, ok := ActorFrom(r.Context())
	if !ok {
		h.fail(w, r, domain.Errorf(domain.CodeInternalError, "this route is missing its identity middleware"))
		return move.Actor{}, false
	}
	return actor, true
}

func rideIDFrom(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, "rideId"))
	if err != nil {
		return uuid.Nil, domain.Errorf(domain.CodeValidationFailed, "that is not a ride id")
	}
	return id, nil
}

func offerIDFrom(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, "offerId"))
	if err != nil {
		return uuid.Nil, domain.Errorf(domain.CodeValidationFailed, "that is not an offer id")
	}
	return id, nil
}

// etagFor is the ride's aggregate version as a weak ETag. Version is the same
// number the outbox events carry, so a client that resumes a stream and a
// client that polls agree on what "current" means.
func etagFor(version int) string {
	return `W/"` + strconv.Itoa(version) + `"`
}

func etagMatches(header, etag string) bool {
	if header == "" {
		return false
	}
	for _, candidate := range strings.Split(header, ",") {
		if strings.TrimSpace(candidate) == etag {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Routes mounts the /v1 surface. The caller supplies the identity middleware so
// a test can mount the same routes with the same guard.
func (h *RideHandler) Routes(identity func(http.Handler) http.Handler, locations *LocationHandler) chi.Router {
	r := chi.NewRouter()
	r.Use(identity)

	r.Post("/quotes", h.CreateQuote)

	r.Route("/rides", func(r chi.Router) {
		r.Post("/", h.CreateRide)
		// Registered before the parameterised route on purpose: chi prefers the
		// static segment, so /rides/active is never read as a ride id.
		r.Get("/active", h.ActiveRide)
		r.Get("/{rideId}", h.GetRide)
		r.Get("/{rideId}/offers", h.RideOffers)
		r.Post("/{rideId}/arrived", h.Arrived)
		r.Post("/{rideId}/verify-pin", h.VerifyPin)
		r.Post("/{rideId}/start", h.Start)
		r.Post("/{rideId}/complete", h.Complete)
		r.Post("/{rideId}/cancel", h.Cancel)
	})

	r.Route("/offers", func(r chi.Router) {
		r.Post("/{offerId}/accept", h.AcceptOffer)
		r.Post("/{offerId}/decline", h.DeclineOffer)
	})

	r.Route("/drivers/me", func(r chi.Router) {
		r.Get("/status", h.DriverStatus)
		r.Post("/status", h.SetDriverStatus)
		r.Post("/locations", h.IngestLocations)
	})

	if locations != nil {
		r.Route("/locations", func(r chi.Router) {
			r.Get("/autocomplete", locations.AutocompleteLocation)
			r.Get("/geocode", locations.GeocodeAddress)
			r.Get("/reverse", locations.ReverseGeocode)
			r.Get("/place", locations.GetPlaceDetails)
		})
	}

	return r
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// CreateQuote handles POST /v1/quotes.
func (h *RideHandler) CreateQuote(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var req move.QuoteRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	quote, err := h.service.CreateQuote(r.Context(), actor, req)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, quote)
}

// CreateRide handles POST /v1/rides.
func (h *RideHandler) CreateRide(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var req move.CreateRideRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	key := r.Header.Get(move.IdempotencyHeader)
	result, status, err := h.service.CreateRide(r.Context(), actor, req, key)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("ETag", etagFor(result.Version))
	writeJSON(w, status, result)
}

// ActiveRide handles GET /v1/rides/active, answering 204 when there is none.
func (h *RideHandler) ActiveRide(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	view, err := h.service.ActiveRide(r.Context(), actor)
	if err != nil {
		if mapped, isDomain := domain.AsError(err); isDomain && mapped.Code == domain.CodeNoActiveRide {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.fail(w, r, err)
		return
	}
	w.Header().Set("ETag", etagFor(view.Version))
	writeJSON(w, http.StatusOK, view)
}

// GetRide handles GET /v1/rides/{rideId} with an ETag over the ride's version.
func (h *RideHandler) GetRide(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	rideID, err := rideIDFrom(r)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.RideByID(r.Context(), actor, rideID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	etag := etagFor(view.Version)
	w.Header().Set("ETag", etag)
	if etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// RideOffers handles GET /v1/rides/{rideId}/offers — the dispatch timeline.
func (h *RideHandler) RideOffers(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	rideID, err := rideIDFrom(r)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	offers, err := h.service.OffersForRide(r.Context(), actor, rideID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"offers": offers})
}

// AcceptOffer handles POST /v1/offers/{offerId}/accept.
//
// The body always carries the result — ok, expired or already_assigned — and
// the status is the canonical one for that outcome, so a driver app can branch
// on either without the two ever disagreeing.
func (h *RideHandler) AcceptOffer(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	offerID, err := offerIDFrom(r)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	result, err := h.service.AcceptOffer(r.Context(), actor, offerID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	switch result.Result {
	case domain.AcceptOK:
		w.Header().Set("ETag", etagFor(result.Ride.Version))
		writeJSON(w, http.StatusOK, result)
	case domain.AcceptExpired:
		writeJSON(w, domain.StatusFor(domain.CodeOfferExpired), result)
	default:
		writeJSON(w, domain.StatusFor(domain.CodeAlreadyAssigned), result)
	}
}

// DeclineOffer handles POST /v1/offers/{offerId}/decline.
func (h *RideHandler) DeclineOffer(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	offerID, err := offerIDFrom(r)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if err := h.service.DeclineOffer(r.Context(), actor, offerID); err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": "declined"})
}

// Arrived handles POST /v1/rides/{rideId}/arrived.
func (h *RideHandler) Arrived(w http.ResponseWriter, r *http.Request) {
	h.rideAction(w, r, func(actor move.Actor, rideID uuid.UUID) (*move.RideView, error) {
		return h.service.Arrived(r.Context(), actor, rideID)
	})
}

// Start handles POST /v1/rides/{rideId}/start.
func (h *RideHandler) Start(w http.ResponseWriter, r *http.Request) {
	h.rideAction(w, r, func(actor move.Actor, rideID uuid.UUID) (*move.RideView, error) {
		return h.service.Start(r.Context(), actor, rideID)
	})
}

// Complete handles POST /v1/rides/{rideId}/complete. It reads no amount from
// the request: the fare is the server's.
func (h *RideHandler) Complete(w http.ResponseWriter, r *http.Request) {
	h.rideAction(w, r, func(actor move.Actor, rideID uuid.UUID) (*move.RideView, error) {
		return h.service.Complete(r.Context(), actor, rideID)
	})
}

// VerifyPinRequest is the driver's PIN attempt.
type VerifyPinRequest struct {
	Pin string `json:"pin"`
}

// VerifyPin handles POST /v1/rides/{rideId}/verify-pin.
func (h *RideHandler) VerifyPin(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	rideID, err := rideIDFrom(r)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req VerifyPinRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	result, err := h.service.VerifyPin(r.Context(), actor, rideID, req.Pin)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// CancelRequest carries the reason code. A driver must supply one.
type CancelRequest struct {
	ReasonCode string `json:"reasonCode"`
}

// Cancel handles POST /v1/rides/{rideId}/cancel.
func (h *RideHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	rideID, err := rideIDFrom(r)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	// A rider may cancel with no body at all; a driver may not, and the service
	// is what refuses that. Content-Length is not consulted, because a chunked
	// request does not carry one and a missing reason must be the service's
	// finding rather than an artefact of how the body was framed.
	var req CancelRequest
	if err := decodeBody(r, &req); err != nil {
		if mapped, ok := domain.AsError(err); !ok || mapped.Message != emptyBodyMessage {
			h.fail(w, r, err)
			return
		}
	}
	view, err := h.service.Cancel(r.Context(), actor, rideID, req.ReasonCode)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("ETag", etagFor(view.Version))
	writeJSON(w, http.StatusOK, view)
}

// DriverStatus handles GET /v1/drivers/me/status.
func (h *RideHandler) DriverStatus(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	view, err := h.service.DriverStatus(r.Context(), actor)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// SetDriverStatus handles POST /v1/drivers/me/status.
func (h *RideHandler) SetDriverStatus(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var req move.DriverStatusRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.SetDriverStatus(r.Context(), actor, req)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// LocationBatchRequest is a batch of points from a driver app.
type LocationBatchRequest struct {
	Points []domain.LocationPoint `json:"points"`
}

// IngestLocations handles POST /v1/drivers/me/locations.
func (h *RideHandler) IngestLocations(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var req LocationBatchRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	result, err := h.service.IngestLocations(r.Context(), actor, req.Points)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// rideAction is the shape every ride-scoped action shares: resolve the actor,
// parse the id, run the transition, answer with the ride and its ETag.
func (h *RideHandler) rideAction(w http.ResponseWriter, r *http.Request, action func(move.Actor, uuid.UUID) (*move.RideView, error)) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	rideID, err := rideIDFrom(r)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := action(actor, rideID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("ETag", etagFor(view.Version))
	writeJSON(w, http.StatusOK, view)
}
