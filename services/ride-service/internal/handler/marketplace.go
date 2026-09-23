package handler

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

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
		r.Get("/driver/preferences", h.DriverPreferences)
		r.Patch("/driver/preferences", h.PatchDriverPreferences)

		r.Route("/requests", func(r chi.Router) {
			r.Post("/", h.PublishRequest)
			r.Get("/{requestId}", h.GetRequest)
			r.Post("/{requestId}/revise", h.ReviseRequest)
			r.Post("/{requestId}/cancel", h.CancelRequest)
			r.Post("/{requestId}/select", h.SelectWinner)
			r.Get("/{requestId}/award", h.GetAward)
			r.Get("/{requestId}/queue", h.RequestQueue)
			r.Get("/{requestId}/pin", h.RetrievePin)
			r.Get("/{requestId}/driver-view", h.DriverView)

			// A02: the executing trip's committed terms, post-award
			// amendments and server-authoritative stop events.
			r.Get("/{requestId}/trip", h.TripView)
			r.Post("/{requestId}/terminate", h.TerminateTrip)
			r.Get("/{requestId}/amendments", h.ListAmendments)
			r.Post("/{requestId}/amendments", h.ProposeAmendment)
			r.Get("/{requestId}/amendments/{amendmentId}", h.GetAmendment)
			r.Post("/{requestId}/amendments/{amendmentId}/approve", h.ApproveAmendment)
			r.Post("/{requestId}/amendments/{amendmentId}/reject", h.RejectAmendment)
			r.Post("/{requestId}/stops/{stopId}/arrive", h.ArriveAtStop)
			r.Post("/{requestId}/stops/{stopId}/depart", h.DepartStop)
			r.Post("/{requestId}/stops/{stopId}/skip", h.SkipStop)
			r.Post("/{requestId}/stops/{stopId}/waiting-approval", h.ApproveWaiting)

			// A06/A04.3 rider confidence: receipts and the preferred-driver
			// decline.
			h.mountRequestConfidence(r)

			// A06 part B: the requester's controls over a guest
			// passenger's trip link.
			h.mountRequestGuest(r)
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

		// A03 Book for Later: scheduled requests, advance driver
		// reservations and recurring journeys.
		h.mountScheduling(r)

		// A06/A04.3 rider confidence: saved drivers and service needs.
		h.mountConfidence(r)
	})

	r.Route("/admin/mp", func(r chi.Router) {
		r.Get("/requests", h.AdminRequests)
		r.Get("/requests/{requestId}/timeline", h.AdminRequestTimeline)
		r.Get("/requests/{requestId}/resolution", h.AdminResolution)
		r.Post("/repairs/stranded-rides", h.RepairStrandedRides)

		// C08: stuck-saga & failed-reservation-recovery board.
		r.Get("/pending-sagas", h.AdminPendingSagas)
		r.Post("/awards/{awardId}/reconcile", h.AdminReconcileAward)
		r.Get("/recoveries", h.AdminRecoveries)
		r.Post("/recoveries/{recoveryId}/retry", h.AdminRetryRecovery)

		// C08: cancellations/no-shows + driver standing & appeals.
		r.Get("/cancellations", h.AdminCancellations)
		r.Get("/drivers/standing", h.AdminDriverStandingList)
		r.Get("/drivers/{driverId}/standing", h.AdminDriverStanding)
		r.Post("/drivers/{driverId}/standing-actions", h.AdminProposeStandingAction)
		r.Get("/standing-actions", h.AdminStandingActions)
		r.Post("/standing-actions/{actionId}/decide", h.AdminDecideStandingAction)
		r.Post("/standing-actions/{actionId}/appeal", h.AdminFileAppeal)
		r.Post("/standing-actions/{actionId}/appeal-decision", h.AdminDecideAppeal)
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
	stops, err := parseStopsParam(query)
	if err != nil {
		h.fail(w, r, err)
		return
	}

	envelope, err := h.service.Quote(r.Context(), actor, marketplace.QuoteParams{
		Service:      query.Get("service"),
		VehicleClass: query.Get("vehicleClass"),
		Pickup:       domain.Place{Lat: pickupLat, Lng: pickupLng},
		Dropoff:      domain.Place{Lat: dropoffLat, Lng: dropoffLng},
		Stops:        stops,
		WeightKg:     weightKg,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, envelope)
}

// maxStopsParamBytes bounds the encoded `stops` query parameter. Plumbing,
// not policy: the market's stop limit is enforced by the service; this only
// keeps a query string from being a request body in disguise.
const maxStopsParamBytes = 4096

// stopInputWire is one element of the `stops` parameter as it arrives. The
// coordinates are pointers so a missing (or null) lat/lng is refused: decoded
// straight into a float it would read as 0 — a real point on the equator or
// the prime meridian that Place.Valid accepts and the route would price.
type stopInputWire struct {
	Lat      *float64 `json:"lat"`
	Lng      *float64 `json:"lng"`
	Label    string   `json:"label,omitempty"`
	Purpose  string   `json:"purpose,omitempty"`
	DwellSec *int     `json:"dwellSec,omitempty"`
}

// parseStopsParam reads the optional `stops` query parameter of GET
// /v1/mp/quote: ONE JSON array of {lat, lng, label?, purpose?, dwellSec?} in
// pickup → dropoff order (MpStopInputSchema). Unknown keys are refused — a
// client cannot name a stop id or a price — and lat and lng are required on
// every stop. Absent, `null` and `[]` all mean the plain pickup → dropoff
// route.
func parseStopsParam(query url.Values) ([]marketplace.StopInput, error) {
	values, present := query["stops"]
	if !present {
		return nil, nil
	}
	if len(values) != 1 {
		return nil, domain.Errorf(domain.CodeValidationFailed, "stops must be given once, as one JSON array").
			WithDetails(map[string]any{"field": "stops"})
	}
	raw := strings.TrimSpace(values[0])
	if raw == "" {
		return nil, nil
	}
	if len(raw) > maxStopsParamBytes {
		return nil, domain.Errorf(domain.CodeValidationFailed, "stops is too long").
			WithDetails(map[string]any{"field": "stops", "maximumBytes": maxStopsParamBytes})
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	var wire []stopInputWire
	if err := decoder.Decode(&wire); err != nil || decoder.More() {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"stops must be a JSON array of {lat, lng, label?, purpose?, dwellSec?}").
			WithDetails(map[string]any{"field": "stops"})
	}
	if len(wire) == 0 {
		return nil, nil
	}
	stops := make([]marketplace.StopInput, 0, len(wire))
	for i, stop := range wire {
		if stop.Lat == nil || stop.Lng == nil {
			return nil, domain.Errorf(domain.CodeValidationFailed,
				"stop %d needs both lat and lng", i+1).
				WithDetails(map[string]any{"field": "stops[" + strconv.Itoa(i) + "]"})
		}
		stops = append(stops, marketplace.StopInput{
			Lat:      *stop.Lat,
			Lng:      *stop.Lng,
			Label:    stop.Label,
			Purpose:  stop.Purpose,
			DwellSec: stop.DwellSec,
		})
	}
	return stops, nil
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
	// A06 part A: the requester's chosen offer order (price, pickup,
	// service_fit); absent is the neutral offered order.
	snapshot, err := h.service.SnapshotWithOptions(r.Context(), actor, requestID,
		marketplace.SnapshotOptions{Sort: r.URL.Query().Get("sort")})
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

// RequestQueue handles GET /v1/mp/requests/{requestId}/queue (G07): the
// requester's authorized, versioned queue projection.
func (h *MarketplaceHandler) RequestQueue(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.QueueProjection(r.Context(), actor, requestID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("ETag", etagFor(view.Version))
	writeJSON(w, http.StatusOK, view)
}

// RetrievePin handles GET /v1/mp/requests/{requestId}/pin (G07 companion): the
// secure pickup-PIN retrieval. The PIN is returned only in the response body
// over this authenticated channel; it is never logged, so h.fail (which logs
// only the code and path) is safe on every error path here.
func (h *MarketplaceHandler) RetrievePin(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.RetrievePin(r.Context(), actor, requestID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// Feed handles GET /v1/mp/feed.
func (h *MarketplaceHandler) Feed(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	query := marketplace.FeedQuery{Cursor: r.URL.Query().Get("cursor")}
	// `preferences=ignore` shows the whole envelope, unfiltered by the
	// driver's preferences; `apply` (or nothing) applies them.
	switch mode := r.URL.Query().Get("preferences"); mode {
	case "", "apply":
	case "ignore":
		query.IgnorePreferences = true
	default:
		h.fail(w, r, domain.Errorf(domain.CodeValidationFailed, "preferences must be apply or ignore, not %q", mode))
		return
	}
	page, err := h.service.Feed(r.Context(), actor, query)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// DriverPreferences handles GET /v1/mp/driver/preferences.
func (h *MarketplaceHandler) DriverPreferences(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	view, err := h.service.DriverPreferences(r.Context(), actor)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// PatchDriverPreferences handles PATCH /v1/mp/driver/preferences: versioned
// (expectedVersion) and idempotent (Idempotency-Key).
func (h *MarketplaceHandler) PatchDriverPreferences(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var req marketplace.PatchDriverPreferencesRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.PatchDriverPreferences(r.Context(), actor, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
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

// RepairStrandedRides handles POST /v1/admin/mp/repairs/stranded-rides: the
// G04 repair for marketplace rides stranded in `rematching` by a driver
// cancellation that predates the terminal `cancelled_by_driver` state.
func (h *MarketplaceHandler) RepairStrandedRides(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	var req marketplace.RepairStrandedRidesRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	response, status, err := h.service.AdminRepairStrandedRides(r.Context(), actor, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, response)
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

// AdminResolution handles GET /v1/admin/mp/requests/{requestId}/resolution:
// the unified resolution timeline (C08).
func (h *MarketplaceHandler) AdminResolution(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.AdminResolution(r.Context(), actor, requestID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// AdminPendingSagas handles GET /v1/admin/mp/pending-sagas (C08).
func (h *MarketplaceHandler) AdminPendingSagas(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	page, err := h.service.AdminPendingSagas(r.Context(), actor, query.Get("cityId"), query.Get("cursor"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// AdminReconcileAward handles POST /v1/admin/mp/awards/{awardId}/reconcile (C08).
func (h *MarketplaceHandler) AdminReconcileAward(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	awardID, err := uuidParam(r, "awardId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.ReconcileAwardRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	result, status, err := h.service.AdminReconcileAward(r.Context(), actor, awardID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, result)
}

// AdminRecoveries handles GET /v1/admin/mp/recoveries (C08).
func (h *MarketplaceHandler) AdminRecoveries(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	page, err := h.service.AdminRecoveries(r.Context(), actor, query.Get("action"), query.Get("cursor"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// AdminRetryRecovery handles POST /v1/admin/mp/recoveries/{recoveryId}/retry (C08).
func (h *MarketplaceHandler) AdminRetryRecovery(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	recoveryID, err := uuidParam(r, "recoveryId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.RetryRecoveryRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	result, status, err := h.service.AdminRetryRecovery(r.Context(), actor, recoveryID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, result)
}

// AdminCancellations handles GET /v1/admin/mp/cancellations (C08).
func (h *MarketplaceHandler) AdminCancellations(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	page, err := h.service.AdminCancellations(r.Context(), actor, query.Get("cityId"), query.Get("driverId"), query.Get("cursor"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// AdminDriverStandingList handles GET /v1/admin/mp/drivers/standing (C08):
// the pattern-detection board (A06 addendum).
func (h *MarketplaceHandler) AdminDriverStandingList(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	page, err := h.service.AdminDriverStandingList(r.Context(), actor, query.Get("cityId"),
		intQuery(query, "windowDays"), intQuery(query, "minRides"), intQuery(query, "limit"), intQuery(query, "offset"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// AdminDriverStanding handles GET /v1/admin/mp/drivers/{driverId}/standing (C08).
func (h *MarketplaceHandler) AdminDriverStanding(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	driverID, err := uuidParam(r, "driverId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.AdminDriverStanding(r.Context(), actor, driverID, intQuery(r.URL.Query(), "windowDays"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// AdminProposeStandingAction handles POST /v1/admin/mp/drivers/{driverId}/standing-actions (C08).
func (h *MarketplaceHandler) AdminProposeStandingAction(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	driverID, err := uuidParam(r, "driverId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.ProposeStandingActionRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.AdminProposeStandingAction(r.Context(), actor, driverID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// AdminStandingActions handles GET /v1/admin/mp/standing-actions (C08): the
// review queue, filterable by status.
func (h *MarketplaceHandler) AdminStandingActions(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	page, err := h.service.AdminStandingActions(r.Context(), actor, query.Get("status"), query.Get("cursor"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// AdminDecideStandingAction handles POST /v1/admin/mp/standing-actions/{actionId}/decide (C08).
func (h *MarketplaceHandler) AdminDecideStandingAction(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	actionID, err := uuidParam(r, "actionId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.DecideStandingActionRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.AdminDecideStandingAction(r.Context(), actor, actionID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// AdminFileAppeal handles POST /v1/admin/mp/standing-actions/{actionId}/appeal (C08).
func (h *MarketplaceHandler) AdminFileAppeal(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	actionID, err := uuidParam(r, "actionId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.FileAppealRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.AdminFileAppeal(r.Context(), actor, actionID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// AdminDecideAppeal handles POST /v1/admin/mp/standing-actions/{actionId}/appeal-decision (C08).
func (h *MarketplaceHandler) AdminDecideAppeal(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	actionID, err := uuidParam(r, "actionId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.DecideAppealRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.AdminDecideAppeal(r.Context(), actor, actionID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// intQuery reads an optional non-negative integer query parameter, 0 when
// absent or unparsable — every caller treats 0 as "use the default".
func intQuery(query url.Values, name string) int {
	value, err := strconv.Atoi(query.Get(name))
	if err != nil || value < 0 {
		return 0
	}
	return value
}

// decodeOptionalBody decodes a JSON body when one was sent; an absent body
// leaves the target at its zero value.
func decodeOptionalBody(r *http.Request, target any) error {
	if err := decodeBody(r, target); err != nil {
		if mapped, ok := domain.AsError(err); ok && mapped.Message == emptyBodyMessage {
			return nil
		}
		return err
	}
	return nil
}

// tripIDs parses the request id and, when named, one more path id.
func tripIDs(r *http.Request, second string) (uuid.UUID, uuid.UUID, error) {
	requestID, err := uuidParam(r, "requestId")
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	if second == "" {
		return requestID, uuid.Nil, nil
	}
	id, err := uuidParam(r, second)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	return requestID, id, nil
}

// TripView handles GET /v1/mp/requests/{requestId}/trip.
func (h *MarketplaceHandler) TripView(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, _, err := tripIDs(r, "")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.TripView(r.Context(), actor, requestID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("ETag", etagFor(view.Version))
	writeJSON(w, http.StatusOK, view)
}

// TerminateTrip handles POST /v1/mp/requests/{requestId}/terminate.
func (h *MarketplaceHandler) TerminateTrip(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, _, err := tripIDs(r, "")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.TerminateTripRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.TerminateTrip(r.Context(), actor, requestID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// ListAmendments handles GET /v1/mp/requests/{requestId}/amendments.
func (h *MarketplaceHandler) ListAmendments(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, _, err := tripIDs(r, "")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.ListAmendments(r.Context(), actor, requestID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// ProposeAmendment handles POST /v1/mp/requests/{requestId}/amendments.
func (h *MarketplaceHandler) ProposeAmendment(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, _, err := tripIDs(r, "")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.ProposeAmendmentRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, status, err := h.service.ProposeAmendment(r.Context(), actor, requestID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// GetAmendment handles GET /v1/mp/requests/{requestId}/amendments/{amendmentId}.
func (h *MarketplaceHandler) GetAmendment(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, amendmentID, err := tripIDs(r, "amendmentId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.GetAmendment(r.Context(), actor, requestID, amendmentID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// ApproveAmendment handles POST .../amendments/{amendmentId}/approve.
func (h *MarketplaceHandler) ApproveAmendment(w http.ResponseWriter, r *http.Request) {
	h.decideAmendment(w, r, true)
}

// RejectAmendment handles POST .../amendments/{amendmentId}/reject.
func (h *MarketplaceHandler) RejectAmendment(w http.ResponseWriter, r *http.Request) {
	h.decideAmendment(w, r, false)
}

func (h *MarketplaceHandler) decideAmendment(w http.ResponseWriter, r *http.Request, approve bool) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, amendmentID, err := tripIDs(r, "amendmentId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.AmendmentDecisionRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	decide := h.service.RejectAmendment
	if approve {
		decide = h.service.ApproveAmendment
	}
	view, status, err := decide(r.Context(), actor, requestID, amendmentID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, status, view)
}

// ArriveAtStop handles POST .../stops/{stopId}/arrive.
func (h *MarketplaceHandler) ArriveAtStop(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, stopID, err := tripIDs(r, "stopId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.StopArriveRequest
	if err := decodeOptionalBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.ArriveAtStop(r.Context(), actor, requestID, stopID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// DepartStop handles POST .../stops/{stopId}/depart.
func (h *MarketplaceHandler) DepartStop(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, stopID, err := tripIDs(r, "stopId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var ignored struct{}
	if err := decodeOptionalBody(r, &ignored); err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.DepartStop(r.Context(), actor, requestID, stopID, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// SkipStop handles POST .../stops/{stopId}/skip.
func (h *MarketplaceHandler) SkipStop(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, stopID, err := tripIDs(r, "stopId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.StopSkipRequest
	if err := decodeOptionalBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.SkipStop(r.Context(), actor, requestID, stopID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// ApproveWaiting handles POST .../stops/{stopId}/waiting-approval.
func (h *MarketplaceHandler) ApproveWaiting(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.actor(w, r)
	if !ok {
		return
	}
	requestID, stopID, err := tripIDs(r, "stopId")
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var req marketplace.WaitingApprovalRequest
	if err := decodeBody(r, &req); err != nil {
		h.fail(w, r, err)
		return
	}
	view, err := h.service.ApproveWaiting(r.Context(), actor, requestID, stopID, req, r.Header.Get(move.IdempotencyHeader))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}
