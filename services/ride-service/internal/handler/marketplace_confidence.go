package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// Rider confidence routes (A06 parts A and D, A04 item 3, receipts). Identity
// comes from the signed gateway headers like every /v1/mp route; every
// state-changing POST requires an Idempotency-Key.

// mountConfidence attaches the saved-driver and service-needs routes under /mp.
func (h *MarketplaceHandler) mountConfidence(r chi.Router) {
	r.Route("/favourite-drivers", func(r chi.Router) {
		r.Get("/", h.ListFavourites)
		r.Post("/", h.SaveFavourite)
		r.Post("/{driverId}/remove", h.RemoveFavourite)
	})
	r.Get("/service-needs", h.ServiceNeedsCatalog)
}

// mountRequestConfidence attaches the per-request routes under
// /mp/requests.
func (h *MarketplaceHandler) mountRequestConfidence(r chi.Router) {
	r.Get("/{requestId}/receipt", h.Receipt)
	r.Post("/{requestId}/preferred/decline", h.DeclinePreferred)
}

// Receipt handles GET /v1/mp/requests/{requestId}/receipt.
func (h *MarketplaceHandler) Receipt(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	receipt, err := h.service.Receipt(r.Context(), actor, requestID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, receipt)
}

// DeclinePreferred handles POST /v1/mp/requests/{requestId}/preferred/decline.
func (h *MarketplaceHandler) DeclinePreferred(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.DeclinePreferred(r.Context(), actor, requestID, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// ListFavourites handles GET /v1/mp/favourite-drivers.
func (h *MarketplaceHandler) ListFavourites(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	view, err := h.service.ListFavourites(r.Context(), actor)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// SaveFavourite handles POST /v1/mp/favourite-drivers.
func (h *MarketplaceHandler) SaveFavourite(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var body marketplace.SaveFavouriteRequest
	if err := decodeBody(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.SaveFavourite(r.Context(), actor, body, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// RemoveFavourite handles POST /v1/mp/favourite-drivers/{driverId}/remove.
func (h *MarketplaceHandler) RemoveFavourite(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	driverID, err := uuidParam(r, "driverId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.RemoveFavourite(r.Context(), actor, driverID, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// ServiceNeedsCatalog handles GET /v1/mp/service-needs.
func (h *MarketplaceHandler) ServiceNeedsCatalog(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	view, err := h.service.ServiceNeedsCatalog(r.Context(), actor, query.Get("service"), query.Get("vehicleClass"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}
