package handler

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// INTERNAL CONTRACT A — ride-service's side (A05 fleet calendar;
// packages/contracts/src/marketplace-fleet.ts,
// contracts/openapi/marketplace-fleet-internal.yaml). Mounted by
// cmd/server/main.go at /internal/fleet, OUTSIDE the /v1 gateway-identity
// middleware and never proxied by the client gateway: its only caller is
// fleet-service, authenticated by X-Service-Key against
// FLEET_RIDE_SERVICE_KEY.
//
//	POST /internal/fleet/occupancy/maintenance:preview
//	POST /internal/fleet/occupancy/maintenance                    (Idempotency-Key)
//	POST /internal/fleet/occupancy/maintenance/{blockId}/release  (Idempotency-Key)
//	POST /internal/fleet/occupancy/off-road                       (Idempotency-Key)
//	GET  /internal/fleet/occupancy/blocks?vehicleIds&driverIds&from&to
//	GET  /internal/fleet/drivers/{driverId}/calendar?from&to
//	POST /internal/fleet/bookings/{blockId}/vehicle-swaps         (Idempotency-Key)

// FleetServiceKeyMinLength is the shortest FLEET_RIDE_SERVICE_KEY accepted:
// shorter (or unset) fails closed — every contract A route is refused.
const FleetServiceKeyMinLength = marketplace.FleetServiceKeyMinLength

// RequireFleetServiceKey authenticates contract A callers. It fails closed:
// an unset or short configured key refuses everyone (503), and a missing or
// wrong X-Service-Key is 401. The compare runs over SHA-256 digests in
// constant time, so neither the key nor its length leaks through timing.
func RequireFleetServiceKey(serviceKey string) func(http.Handler) http.Handler {
	configured := len(serviceKey) >= FleetServiceKeyMinLength
	matches := fleetKeyMatcher(serviceKey)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !configured {
				writeError(w, domain.Errorf(domain.CodeServiceUnavailable,
					"the fleet contract is not configured on this service"))
				return
			}
			if !matches(r.Header.Get(marketplace.FleetServiceKeyHeader)) {
				writeError(w, domain.Errorf(domain.CodeUnauthorized, "a valid service key is required"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// FleetInternalRoutes builds the /internal/fleet router. A nil marketplace
// handler (the engine is not configured) answers 503 on every route after
// authentication.
func FleetInternalRoutes(serviceKey string, h *MarketplaceHandler) http.Handler {
	r := chi.NewRouter()
	r.Use(RequireFleetServiceKey(serviceKey))
	if h == nil {
		h = &MarketplaceHandler{}
	}
	r.Route("/occupancy", func(r chi.Router) {
		r.Post("/maintenance:preview", h.FleetPreviewMaintenance)
		r.Post("/maintenance", h.FleetRecordMaintenance)
		r.Post("/maintenance/{blockId}/release", h.FleetReleaseBlock)
		r.Post("/off-road", h.FleetReportOffRoad)
		r.Get("/blocks", h.FleetOccupiedBlocks)
	})
	r.Get("/drivers/{driverId}/calendar", h.FleetDriverCalendar)
	r.Post("/bookings/{blockId}/vehicle-swaps", h.FleetProposeVehicleSwap)
	return r
}

// fleetReady refuses a contract A call when the marketplace engine is not
// wired.
func (h *MarketplaceHandler) fleetReady(w http.ResponseWriter, r *http.Request) bool {
	if h.service == nil {
		h.fail(w, r, domain.Errorf(domain.CodeServiceUnavailable, "the marketplace is not configured on this service"))
		return false
	}
	return true
}

// FleetPreviewMaintenance handles route 1.
func (h *MarketplaceHandler) FleetPreviewMaintenance(w http.ResponseWriter, r *http.Request) {
	if !h.fleetReady(w, r) {
		return
	}
	var body marketplace.MaintenanceWindow
	if err := decodeBody(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	preview, err := h.service.PreviewMaintenance(r.Context(), body)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, preview)
}

// FleetRecordMaintenance handles route 2.
func (h *MarketplaceHandler) FleetRecordMaintenance(w http.ResponseWriter, r *http.Request) {
	if !h.fleetReady(w, r) {
		return
	}
	var body marketplace.MaintenanceWindow
	if err := decodeBody(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	result, status, err := h.service.RecordMaintenance(r.Context(), body, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, result)
}

// FleetReleaseBlock handles route 3.
func (h *MarketplaceHandler) FleetReleaseBlock(w http.ResponseWriter, r *http.Request) {
	if !h.fleetReady(w, r) {
		return
	}
	result, status, err := h.service.ReleaseFleetBlock(r.Context(), chi.URLParam(r, "blockId"), r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, result)
}

// FleetReportOffRoad handles route 4.
func (h *MarketplaceHandler) FleetReportOffRoad(w http.ResponseWriter, r *http.Request) {
	if !h.fleetReady(w, r) {
		return
	}
	var body marketplace.OffRoadReport
	if err := decodeBody(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	result, status, err := h.service.ReportOffRoad(r.Context(), body, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, result)
}

// FleetOccupiedBlocks handles route 5.
func (h *MarketplaceHandler) FleetOccupiedBlocks(w http.ResponseWriter, r *http.Request) {
	if !h.fleetReady(w, r) {
		return
	}
	query := r.URL.Query()
	from, to, err := marketplace.ParseFleetWindow(query.Get("from"), query.Get("to"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	vehicles, err := marketplace.ParseFleetIDList(query.Get("vehicleIds"), "vehicleIds")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	rawDrivers, err := marketplace.ParseFleetIDList(query.Get("driverIds"), "driverIds")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	drivers := make([]uuid.UUID, 0, len(rawDrivers))
	for _, raw := range rawDrivers {
		id, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil {
			h.fail(w, r, domain.Errorf(domain.CodeValidationFailed, "driverIds must be driver ids").
				WithDetails(map[string]any{"field": "driverIds"}))
			return
		}
		drivers = append(drivers, id)
	}
	view, err := h.service.OccupiedBlocks(r.Context(), marketplace.OccupiedBlocksQuery{
		VehicleIDs: vehicles, DriverIDs: drivers, From: from, To: to,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// FleetDriverCalendar handles route 6.
func (h *MarketplaceHandler) FleetDriverCalendar(w http.ResponseWriter, r *http.Request) {
	if !h.fleetReady(w, r) {
		return
	}
	driverID, err := uuidParam(r, "driverId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	query := r.URL.Query()
	from, to, err := marketplace.ParseFleetWindow(query.Get("from"), query.Get("to"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.FleetDriverCalendar(r.Context(), driverID, from, to)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// FleetProposeVehicleSwap handles route 7.
func (h *MarketplaceHandler) FleetProposeVehicleSwap(w http.ResponseWriter, r *http.Request) {
	if !h.fleetReady(w, r) {
		return
	}
	blockID, err := uuidParam(r, "blockId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var body marketplace.FleetSwapProposal
	if err := decodeBody(r, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	result, status, err := h.service.ProposeVehicleSwap(r.Context(), blockID, body, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, result)
}

// ---------------------------------------------------------------------------
// The booking's own parties (under /v1/mp/advance-bookings, identity from
// the signed gateway headers like every /v1 route).
// ---------------------------------------------------------------------------

// ReleaseBooking handles POST /v1/mp/advance-bookings/{id}/release (rider,
// D2 "cancel and release").
func (h *MarketplaceHandler) ReleaseBooking(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	id, err := uuidParam(r, "bookingId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.ReleaseBooking(r.Context(), actor, id, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// vehicleSwapDecision handles POST /v1/mp/advance-bookings/{id}/
// vehicle-swaps/{swapId}/accept|decline (the booked driver, parked).
func (h *MarketplaceHandler) vehicleSwapDecision(accept bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := h.actor(w, r)
		if !ok {
			return
		}
		id, err := uuidParam(r, "bookingId")
		if err != nil {
			h.fail(w, r, err)
			return
		}
		swapID, err := uuidParam(r, "swapId")
		if err != nil {
			h.fail(w, r, err)
			return
		}
		view, status, err := h.service.DecideVehicleSwap(r.Context(), actor, id, swapID, accept, r.Header.Get(move.IdempotencyHeader))
		if err != nil {
			h.fail(w, r, err)
			return
		}
		writeJSON(w, status, view)
	}
}

// bookingChangeDecision handles POST /v1/mp/advance-bookings/{id}/changes/
// {changeId}/accept|decline (the rider, D1).
func (h *MarketplaceHandler) bookingChangeDecision(accept bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := h.actor(w, r)
		if !ok {
			return
		}
		id, err := uuidParam(r, "bookingId")
		if err != nil {
			h.fail(w, r, err)
			return
		}
		changeID, err := uuidParam(r, "changeId")
		if err != nil {
			h.fail(w, r, err)
			return
		}
		view, status, err := h.service.DecideBookingChange(r.Context(), actor, id, changeID, accept, r.Header.Get(move.IdempotencyHeader))
		if err != nil {
			h.fail(w, r, err)
			return
		}
		writeJSON(w, status, view)
	}
}
