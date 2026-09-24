package handler

import (
	"net/http"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// AdminBusinessBookings handles GET /v1/admin/mp/business-bookings
// (?owed=true lists only bookings still owing payment-service an op).
func (h *MarketplaceHandler) AdminBusinessBookings(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	owed := false
	switch query.Get("owed") {
	case "", "false":
	case "true":
		owed = true
	default:
		h.fail(w, r, domain.Errorf(domain.CodeValidationFailed, "owed is true or false").WithDetails(map[string]any{"field": "owed"}))
		return
	}
	page, err := h.service.AdminBusinessBookings(r.Context(), actor, owed, query.Get("cityId"), query.Get("cursor"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// AdminRetryBusinessOp handles POST /v1/admin/mp/business-bookings/{awardId}/retry.
func (h *MarketplaceHandler) AdminRetryBusinessOp(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	awardID, err := uuidParam(r, "awardId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.OwedRetryRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	result, status, err := h.service.AdminRetryBusinessOp(r.Context(), actor, awardID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, result)
}

// AdminDeliveryCancellations handles GET /v1/admin/mp/delivery-cancellations
// (?state=pending|cancelled|refused, ?cityId).
func (h *MarketplaceHandler) AdminDeliveryCancellations(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	page, err := h.service.AdminDeliveryCancellations(r.Context(), actor, query.Get("state"), query.Get("cityId"), query.Get("cursor"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// AdminRetryDeliveryCancel handles POST /v1/admin/mp/delivery-cancellations/{awardId}/retry.
func (h *MarketplaceHandler) AdminRetryDeliveryCancel(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	awardID, err := uuidParam(r, "awardId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.OwedRetryRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	result, status, err := h.service.AdminRetryDeliveryCancel(r.Context(), actor, awardID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, result)
}
