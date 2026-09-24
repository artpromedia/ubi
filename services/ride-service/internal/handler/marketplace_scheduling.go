package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// Book for Later routes (A03): scheduled requests, advance driver
// reservations (advance requests → advance bookings, and the driver's
// calendar) and recurring journeys. Identity comes from the signed gateway
// headers like every /v1/mp route; every state-changing POST requires an
// Idempotency-Key.

// mountScheduling attaches the Book for Later routes under /mp.
func (h *MarketplaceHandler) mountScheduling(r chi.Router) {
	r.Route("/scheduled-requests", func(r chi.Router) {
		r.Post("/", h.CreateScheduledRequest)
		r.Get("/", h.ListScheduledRequests)
		r.Get("/{scheduledRequestId}", h.GetScheduledRequest)
		r.Post("/{scheduledRequestId}/cancel", h.CancelScheduledRequest)
		r.Post("/{scheduledRequestId}/approve", h.ApproveScheduledRequest)
	})
	r.Post("/advance-requests", h.CreateAdvanceRequest)
	r.Route("/advance-bookings", func(r chi.Router) {
		r.Get("/", h.ListBookings)
		r.Get("/{bookingId}", h.GetBooking)
		r.Post("/{bookingId}/cancel", h.CancelBooking)
		r.Post("/{bookingId}/reconfirm", h.ReconfirmBooking)
		r.Post("/{bookingId}/withdraw", h.WithdrawBooking)
		r.Post("/{bookingId}/rematch", h.RematchBooking)
		// A05 fleet calendar (fleet_internal.go): the rider's "cancel and
		// release" on a failed booking (D2), the driver's decision on a
		// fleet's vehicle swap (parked), the rider's consent to a vehicle
		// change (D1).
		r.Post("/{bookingId}/release", h.ReleaseBooking)
		r.Post("/{bookingId}/vehicle-swaps/{swapId}/accept", h.vehicleSwapDecision(true))
		r.Post("/{bookingId}/vehicle-swaps/{swapId}/decline", h.vehicleSwapDecision(false))
		r.Post("/{bookingId}/changes/{changeId}/accept", h.bookingChangeDecision(true))
		r.Post("/{bookingId}/changes/{changeId}/decline", h.bookingChangeDecision(false))
	})
	r.Get("/driver/calendar", h.DriverCalendar)
	r.Route("/recurring-templates", func(r chi.Router) {
		r.Post("/", h.CreateRecurringTemplate)
		r.Get("/", h.ListRecurringTemplates)
		r.Get("/{templateId}", h.GetRecurringTemplate)
		r.Post("/{templateId}/pause", h.templateCommand(marketplace.TemplatePause))
		r.Post("/{templateId}/resume", h.templateCommand(marketplace.TemplateResume))
		r.Post("/{templateId}/cancel", h.templateCommand(marketplace.TemplateCancel))
		r.Post("/{templateId}/occurrences/{date}/skip", h.SkipOccurrence)
	})
}

// CreateScheduledRequest handles POST /v1/mp/scheduled-requests.
func (h *MarketplaceHandler) CreateScheduledRequest(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var body marketplace.CreateScheduledRequestBody
	if err := decodeBody(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.CreateScheduledRequest(r.Context(), actor, body, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// ListScheduledRequests handles GET /v1/mp/scheduled-requests.
func (h *MarketplaceHandler) ListScheduledRequests(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	views, err := h.service.ListScheduledRequests(r.Context(), actor)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": views})
}

// GetScheduledRequest handles GET /v1/mp/scheduled-requests/{id}.
func (h *MarketplaceHandler) GetScheduledRequest(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id, err := uuidParam(r, "scheduledRequestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.GetScheduledRequest(r.Context(), actor, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// CancelScheduledRequest handles POST /v1/mp/scheduled-requests/{id}/cancel.
func (h *MarketplaceHandler) CancelScheduledRequest(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id, err := uuidParam(r, "scheduledRequestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.CancelScheduledRequest(r.Context(), actor, id, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// ApproveScheduledRequest handles POST /v1/mp/scheduled-requests/{id}/approve.
func (h *MarketplaceHandler) ApproveScheduledRequest(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id, err := uuidParam(r, "scheduledRequestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var body marketplace.ApproveScheduledBody
	if err := decodeBody(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.ApproveScheduledRequest(r.Context(), actor, id, body, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// CreateAdvanceRequest handles POST /v1/mp/advance-requests.
func (h *MarketplaceHandler) CreateAdvanceRequest(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var body marketplace.CreateAdvanceRequestBody
	if err := decodeBody(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.CreateAdvanceRequest(r.Context(), actor, body, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("ETag", etagFor(view.Version))
	writeJSON(w, status, view)
}

// ListBookings handles GET /v1/mp/advance-bookings (rider: theirs; driver:
// theirs).
func (h *MarketplaceHandler) ListBookings(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	views, err := h.service.ListBookings(r.Context(), actor)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": views})
}

// GetBooking handles GET /v1/mp/advance-bookings/{id}.
func (h *MarketplaceHandler) GetBooking(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id, err := uuidParam(r, "bookingId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.GetBooking(r.Context(), actor, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// CancelBooking handles POST /v1/mp/advance-bookings/{id}/cancel (rider).
func (h *MarketplaceHandler) CancelBooking(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id, err := uuidParam(r, "bookingId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.CancelBooking(r.Context(), actor, id, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// ReconfirmBooking handles POST /v1/mp/advance-bookings/{id}/reconfirm (driver).
func (h *MarketplaceHandler) ReconfirmBooking(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id, err := uuidParam(r, "bookingId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.ReconfirmBooking(r.Context(), actor, id, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// WithdrawBooking handles POST /v1/mp/advance-bookings/{id}/withdraw (driver).
func (h *MarketplaceHandler) WithdrawBooking(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id, err := uuidParam(r, "bookingId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var body marketplace.WithdrawBookingBody
	if err := decodeBody(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.WithdrawBooking(r.Context(), actor, id, body, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// RematchBooking handles POST /v1/mp/advance-bookings/{id}/rematch (rider).
func (h *MarketplaceHandler) RematchBooking(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id, err := uuidParam(r, "bookingId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var body marketplace.RematchBookingBody
	if err := decodeOptionalBody(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.RematchBooking(r.Context(), actor, id, body, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// DriverCalendar handles GET /v1/mp/driver/calendar.
func (h *MarketplaceHandler) DriverCalendar(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	view, err := h.service.DriverCalendar(r.Context(), actor)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// CreateRecurringTemplate handles POST /v1/mp/recurring-templates.
func (h *MarketplaceHandler) CreateRecurringTemplate(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var body marketplace.CreateTemplateBody
	if err := decodeBody(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.CreateRecurringTemplate(r.Context(), actor, body, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// ListRecurringTemplates handles GET /v1/mp/recurring-templates.
func (h *MarketplaceHandler) ListRecurringTemplates(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	views, err := h.service.ListRecurringTemplates(r.Context(), actor)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": views})
}

// GetRecurringTemplate handles GET /v1/mp/recurring-templates/{id}.
func (h *MarketplaceHandler) GetRecurringTemplate(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id, err := uuidParam(r, "templateId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.GetRecurringTemplate(r.Context(), actor, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// templateCommand handles POST /v1/mp/recurring-templates/{id}/{pause|resume|cancel}.
func (h *MarketplaceHandler) templateCommand(command string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := h.actor(w, r)
		if !ok {
			return
		}
		id, err := uuidParam(r, "templateId")
		if err != nil {
			h.fail(w, r, err)
			return
		}
		var body marketplace.TemplateCommandBody
		if err := decodeBody(r, &body); err != nil {
			h.fail(w, r, err)
			return
		}
		view, status, err := h.service.CommandRecurringTemplate(r.Context(), actor, id, command, body, r.Header.Get(move.IdempotencyHeader))
		if err != nil {
			h.fail(w, r, err)
			return
		}
		writeJSON(w, status, view)
	}
}

// SkipOccurrence handles POST /v1/mp/recurring-templates/{id}/occurrences/{date}/skip.
func (h *MarketplaceHandler) SkipOccurrence(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id, err := uuidParam(r, "templateId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.SkipOccurrence(r.Context(), actor, id, chi.URLParam(r, "date"), r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}
