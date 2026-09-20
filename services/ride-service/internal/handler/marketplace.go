package handler

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// MarketplaceHandler serves the /v1/mp and /v1/admin/mp endpoints.
type MarketplaceHandler struct {
	service *marketplace.Service
	logger  zerolog.Logger
}

// NewMarketplaceHandler builds the handler.
func NewMarketplaceHandler(service *marketplace.Service, logger zerolog.Logger) *MarketplaceHandler {
	return &MarketplaceHandler{service: service, logger: logger}
}

func (h *MarketplaceHandler) fail(w http.ResponseWriter, r *http.Request, err error) {
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

func (h *MarketplaceHandler) actor(w http.ResponseWriter, r *http.Request) (move.Actor, bool) {
	actor, ok := ActorFrom(r.Context())
	if !ok {
		h.fail(w, r, domain.Errorf(domain.CodeInternalError, "this route is missing its identity middleware"))
		return move.Actor{}, false
	}
	return actor, true
}

func uuidParam(r *http.Request, name string) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		return uuid.Nil, domain.Errorf(domain.CodeValidationFailed, "that is not a %s", name)
	}
	return id, nil
}

// mount attaches the marketplace routes onto the /v1 router the ride handler
// builds. Everything here sits behind the same RequireIdentity middleware.
func (h *MarketplaceHandler) mount(r chi.Router) {
	r.Route("/mp", func(r chi.Router) {
		r.Get("/quote", h.Quote)
		r.Get("/feed", h.Feed)
		r.Post("/driver/parked", h.ConfirmParked)
		r.Get("/driver/jobs", h.DriverJobs)

		r.Route("/requests", func(r chi.Router) {
			r.Post("/", h.PublishRequest)
			r.Get("/{requestId}", h.GetRequest)
			r.Post("/{requestId}/revise", h.ReviseRequest)
			r.Post("/{requestId}/cancel", h.CancelRequest)
			r.Post("/{requestId}/select", h.SelectWinner)
			r.Get("/{requestId}/award", h.GetAward)
			r.Get("/{requestId}/driver-view", h.DriverView)
		})

		r.Route("/bids", func(r chi.Router) {
			r.Post("/", h.SubmitBid)
			r.Get("/mine", h.MyBids)
			r.Post("/{bidId}/revise", h.ReviseBid)
			r.Post("/{bidId}/withdraw", h.WithdrawBid)
		})

		r.Route("/rate-profiles", func(r chi.Router) {
			r.Get("/", h.RateProfiles)
			r.Put("/", h.SaveRateProfile)
			r.Post("/preview", h.PreviewRateProfile)
		})
	})

	r.Route("/admin/mp", func(r chi.Router) {
		r.Get("/requests", h.AdminRequests)
		r.Get("/requests/{requestId}/timeline", h.AdminRequestTimeline)
	})
}

// Quote handles GET /v1/mp/quote.
func (h *MarketplaceHandler) Quote(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	parse := func(name string) (float64, error) {
		value, err := strconv.ParseFloat(query.Get(name), 64)
		if err != nil {
			return 0, domain.Errorf(domain.CodeValidationFailed, "%s must be a coordinate", name)
		}
		return value, nil
	}
	pickupLat, err := parse("pickupLat")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	pickupLng, err := parse("pickupLng")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	dropoffLat, err := parse("dropoffLat")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	dropoffLng, err := parse("dropoffLng")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	weightKg := 0.0
	if raw := query.Get("weightKg"); raw != "" {
		if weightKg, err = strconv.ParseFloat(raw, 64); err != nil {
			h.fail(w, r, domain.Errorf(domain.CodeValidationFailed, "weightKg must be a number"))
			return
		}
	}

	envelope, err := h.service.Quote(r.Context(), actor, marketplace.QuoteParams{
		Service:      query.Get("service"),
		VehicleClass: query.Get("vehicleClass"),
		Pickup:       domain.Place{Lat: pickupLat, Lng: pickupLng},
		Dropoff:      domain.Place{Lat: dropoffLat, Lng: dropoffLng},
		WeightKg:     weightKg,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope)
}

// PublishRequest handles POST /v1/mp/requests.
func (h *MarketplaceHandler) PublishRequest(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var req marketplace.PublishRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.Publish(r.Context(), actor, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("ETag", etagFor(view.Version))
	writeJSON(w, status, view)
}

// GetRequest handles GET /v1/mp/requests/{requestId}.
func (h *MarketplaceHandler) GetRequest(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	snapshot, err := h.service.Snapshot(r.Context(), actor, requestID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("ETag", etagFor(snapshot.Request.Version))
	writeJSON(w, http.StatusOK, snapshot)
}

// ReviseRequest handles POST /v1/mp/requests/{requestId}/revise.
func (h *MarketplaceHandler) ReviseRequest(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.ReviseRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.ReviseRequest(r.Context(), actor, requestID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("ETag", etagFor(view.Version))
	writeJSON(w, status, view)
}

// CancelRequest handles POST /v1/mp/requests/{requestId}/cancel.
func (h *MarketplaceHandler) CancelRequest(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.Cancel(r.Context(), actor, requestID, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// SelectWinner handles POST /v1/mp/requests/{requestId}/select.
func (h *MarketplaceHandler) SelectWinner(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.SelectWinnerRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	result, status, err := h.service.SelectWinner(r.Context(), actor, requestID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, result)
}

// GetAward handles GET /v1/mp/requests/{requestId}/award.
func (h *MarketplaceHandler) GetAward(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	award, err := h.service.AwardForRequest(r.Context(), actor, requestID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, award)
}

// Feed handles GET /v1/mp/feed.
func (h *MarketplaceHandler) Feed(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	page, err := h.service.Feed(r.Context(), actor, r.URL.Query().Get("cursor"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// DriverView handles GET /v1/mp/requests/{requestId}/driver-view.
func (h *MarketplaceHandler) DriverView(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.DriverView(r.Context(), actor, requestID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// SubmitBid handles POST /v1/mp/bids.
func (h *MarketplaceHandler) SubmitBid(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var req marketplace.SubmitBid
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.CreateBid(r.Context(), actor, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// ReviseBid handles POST /v1/mp/bids/{bidId}/revise.
func (h *MarketplaceHandler) ReviseBid(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	bidID, err := uuidParam(r, "bidId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.ReviseBid
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.ReviseBid(r.Context(), actor, bidID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// WithdrawBid handles POST /v1/mp/bids/{bidId}/withdraw.
func (h *MarketplaceHandler) WithdrawBid(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	bidID, err := uuidParam(r, "bidId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.Withdraw(r.Context(), actor, bidID, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// MyBids handles GET /v1/mp/bids/mine.
func (h *MarketplaceHandler) MyBids(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	bids, err := h.service.MyBids(r.Context(), actor)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"bids": bids})
}

// RateProfiles handles GET /v1/mp/rate-profiles.
func (h *MarketplaceHandler) RateProfiles(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	profiles, err := h.service.RateProfiles(r.Context(), actor)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profiles": profiles})
}

// SaveRateProfile handles PUT /v1/mp/rate-profiles.
func (h *MarketplaceHandler) SaveRateProfile(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var req marketplace.SaveRateProfileRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.SaveRateProfile(r.Context(), actor, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// PreviewRateProfile handles POST /v1/mp/rate-profiles/preview.
func (h *MarketplaceHandler) PreviewRateProfile(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var req marketplace.RatePreviewRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.PreviewRateProfile(r.Context(), actor, req)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// ConfirmParked handles POST /v1/mp/driver/parked.
func (h *MarketplaceHandler) ConfirmParked(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	result, err := h.service.ConfirmParked(r.Context(), actor)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// DriverJobs handles GET /v1/mp/driver/jobs.
func (h *MarketplaceHandler) DriverJobs(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	jobs, err := h.service.DriverJobs(r.Context(), actor)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, jobs)
}

// AdminRequests handles GET /v1/admin/mp/requests.
func (h *MarketplaceHandler) AdminRequests(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	page, err := h.service.AdminRequests(r.Context(), actor, query.Get("cityId"), query.Get("state"), query.Get("cursor"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// AdminRequestTimeline handles GET /v1/admin/mp/requests/{requestId}/timeline.
func (h *MarketplaceHandler) AdminRequestTimeline(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	timeline, err := h.service.AdminRequestTimeline(r.Context(), actor, requestID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, timeline)
}
