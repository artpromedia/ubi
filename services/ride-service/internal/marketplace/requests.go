package marketplace

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// PublishRequest is the whole of POST /v1/mp/requests. There are no bounds in
// it: the bounds are the stored quote's. requestedFareMinor is a Money object
// per the contract, and its currency must be the quote's.
type PublishRequest struct {
	QuoteID            uuid.UUID      `json:"quoteId"`
	RequestedFareMinor Money          `json:"requestedFareMinor"`
	PaymentMethodID    string         `json:"paymentMethodId"`
	Delivery           map[string]any `json:"delivery,omitempty"`
}

// requireCurrency refuses a Money body whose currency does not name the
// stored aggregate's currency — a mismatch is refused, never silently
// re-denominated.
func requireCurrency(got Money, want string, field string) error {
	if got.Currency != want {
		return domain.Errorf(domain.CodeValidationFailed,
			"%s is denominated in %q but this trade is in %q", field, got.Currency, want).
			WithDetails(map[string]any{"field": field, "currency": got.Currency, "expectedCurrency": want})
	}
	return nil
}

// fareOutOfBounds phrases the one structured bounds error every surface uses:
// a human sentence naming the limit, plus the numbers a client renders.
func fareOutOfBounds(amount, minMinor, maxMinor int64, currency string, digits int) *domain.Error {
	if amount < minMinor {
		return domain.Errorf(domain.CodeFareOutOfBounds,
			"the offered fare is below the minimum of %s for this trip", formatMinor(minMinor, currency, digits)).
			WithDetails(map[string]any{
				"field":        "requestedFareMinor",
				"minimumMinor": minMinor,
				"maximumMinor": maxMinor,
				"message":      "The minimum for this trip is " + formatMinor(minMinor, currency, digits) + ".",
			})
	}
	return domain.Errorf(domain.CodeFareOutOfBounds,
		"the offered fare is above the maximum of %s for this trip", formatMinor(maxMinor, currency, digits)).
		WithDetails(map[string]any{
			"field":        "requestedFareMinor",
			"minimumMinor": minMinor,
			"maximumMinor": maxMinor,
			"message":      "The maximum for this trip is " + formatMinor(maxMinor, currency, digits) + ".",
		})
}

// Publish turns a bounded quote into an open request (R03).
func (s *Service) Publish(ctx context.Context, actor Actor, req PublishRequest, idempotencyKey string) (*RequestView, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only a requester can publish a request")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}

	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeRequestCreate, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view RequestView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}

	quote, err := s.deps.Store.QuoteByID(ctx, s.deps.Store.Pool(), req.QuoteID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that quote does not exist")
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if quote.RequesterID != actor.UserID {
		// "not found" rather than "forbidden": a quote id must not probe
		// another requester's trip.
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that quote does not exist")
	}
	if err := s.requireServiceFlag(ctx, quote.Service, actor, quote.CityID); err != nil {
		return nil, 0, err
	}
	// A multi-stop quote publishes only while multiple stops are allowed
	// here. The stops themselves come from the quote row — the body cannot
	// carry any — so a request is always published against the exact stop
	// set (and fingerprint) that was priced.
	if len(quote.Stops) > 0 {
		if err := s.requireStopsAllowed(ctx, quote.Service, actor, quote.CityID); err != nil {
			return nil, 0, err
		}
	}

	now := s.now()
	if !now.Before(quote.ExpiresAt) {
		return nil, 0, domain.Errorf(domain.CodeQuoteExpired, "this quote has expired; ask for a new one")
	}
	if quote.ConsumedBy != nil {
		return nil, 0, domain.Errorf(domain.CodeConflict, "this quote has already been used for another request")
	}

	config, policy, err := s.policy(ctx, quote.CityID)
	if err != nil {
		return nil, 0, err
	}
	if quote.PolicyVersion != policy.PolicyVersion {
		return nil, 0, domain.Errorf(domain.CodeQuoteExpired,
			"the marketplace policy changed after this quote was issued; ask for a new one").
			WithDetails(map[string]any{"quotedPolicyVersion": quote.PolicyVersion, "activePolicyVersion": policy.PolicyVersion})
	}
	if available, reason := config.PaymentMethodAvailable(req.PaymentMethodID); !available {
		return nil, 0, domain.Errorf(domain.CodePaymentMethodUnavailable,
			"%s cannot be used in this city", req.PaymentMethodID).
			WithDetails(map[string]any{"paymentMethodId": req.PaymentMethodID, "reason": reason})
	}

	// The requested amount is validated against the STORED bounds, never
	// against anything the client restated — and its currency must be the
	// quote's, never silently reinterpreted.
	if err := requireCurrency(req.RequestedFareMinor, quote.Currency, "requestedFareMinor"); err != nil {
		return nil, 0, err
	}
	if req.RequestedFareMinor.AmountMinor < quote.MinMinor || req.RequestedFareMinor.AmountMinor > quote.MaxMinor {
		return nil, 0, fareOutOfBounds(req.RequestedFareMinor.AmountMinor, quote.MinMinor, quote.MaxMinor,
			quote.Currency, config.CurrencyFractionDigits)
	}

	// The open-request cap is ENFORCED inside the insert transaction (see
	// below): a pool-side count here would be check-then-act under
	// concurrency. This early read only phrases the friendly refusal fast.
	openCount, err := s.deps.Store.OpenRequestCount(ctx, s.deps.Store.Pool(), actor.UserID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if openCount >= policy.Bids.MaxOpenRequestsPerRequester {
		return nil, 0, domain.Errorf(domain.CodeRequestCapReached,
			"you already have %d open requests; close one before publishing another", openCount).
			WithDetails(map[string]any{"openRequests": openCount, "maximum": policy.Bids.MaxOpenRequestsPerRequester})
	}

	request := &Request{
		ID:                uuid.New(),
		QuoteID:           quote.ID,
		RequesterID:       actor.UserID,
		CityID:            quote.CityID,
		Service:           quote.Service,
		VehicleClass:      quote.VehicleClass,
		Currency:          quote.Currency,
		State:             machine.MpRequestOpen,
		Revision:          1,
		Version:           1,
		RequestedMinor:    req.RequestedFareMinor.AmountMinor,
		SuggestedMinor:    quote.SuggestedMinor,
		MinMinor:          quote.MinMinor,
		MaxMinor:          quote.MaxMinor,
		Pickup:            quote.Pickup,
		Dropoff:           quote.Dropoff,
		Stops:             quote.Stops,
		RouteRevision:     1,
		RouteFingerprint:  quote.RouteFingerprint,
		RoutedDistanceM:   quote.RoutedDistanceM,
		RoutedDurationSec: quote.RoutedDurationSec,
		StopsDwellSec:     quote.StopsDwellSec,
		Delivery:          req.Delivery,
		PaymentMethodID:   req.PaymentMethodID,
		EnvelopeStep:      0,
		EnvelopeRadiusM:   policy.SearchEnvelope.InitialRadiusMeters,
		EnvelopeEtaSec:    policy.SearchEnvelope.InitialPickupEtaSec,
		PolicyVersion:     policy.PolicyVersion,
		PricingVersion:    quote.PricingVersion,
		ExpiresAt:         now.Add(time.Duration(policy.Bids.RequestExpirySec) * time.Second),
	}
	if request.RouteFingerprint == "" {
		// A quote priced before fingerprints existed: name its route now.
		request.RouteFingerprint = routeFingerprint(request.Pickup, request.Stops, request.Dropoff)
	}

	var view *RequestView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		// The cap is check-then-act unless the count and the insert commit
		// atomically: serialise this requester's publishes and recount inside
		// the transaction. The advisory lock is transaction-scoped.
		if err := s.deps.Store.AcquireCapLock(ctx, tx, advisoryRequesterOpenCap, actor.UserID); err != nil {
			return err
		}
		openInTx, err := s.deps.Store.OpenRequestCount(ctx, tx, actor.UserID)
		if err != nil {
			return err
		}
		if openInTx >= policy.Bids.MaxOpenRequestsPerRequester {
			return domain.Errorf(domain.CodeRequestCapReached,
				"you already have %d open requests; close one before publishing another", openInTx).
				WithDetails(map[string]any{"openRequests": openInTx, "maximum": policy.Bids.MaxOpenRequestsPerRequester})
		}
		if err := s.deps.Store.InsertRequest(ctx, tx, request); err != nil {
			return err
		}
		if err := s.deps.Store.ConsumeQuote(ctx, tx, quote.ID, request.ID); err != nil {
			return err
		}
		snapshot := map[string]any{
			"requestedMinor": request.RequestedMinor,
			"minMinor":       request.MinMinor,
			"maxMinor":       request.MaxMinor,
			"envelope":       map[string]any{"radiusMeters": request.EnvelopeRadiusM, "pickupEtaSec": request.EnvelopeEtaSec},
		}
		if route := routeSnapshot(request); route != nil {
			snapshot["route"] = route
		}
		if err := s.deps.Store.InsertRequestRevision(ctx, tx, request.ID, 1, request.RequestedMinor, quote.ID, snapshot); err != nil {
			return err
		}
		publishedPayload := map[string]any{
			"requestId":      request.ID.String(),
			"quoteId":        quote.ID.String(),
			"service":        request.Service,
			"vehicleClass":   request.VehicleClass,
			"requestedMinor": request.RequestedMinor,
			"currency":       request.Currency,
			"revision":       request.Revision,
			"expiresAt":      request.ExpiresAt.Format(time.RFC3339),
		}
		publishedAudit := map[string]any{
			"state":          request.State,
			"requestedMinor": request.RequestedMinor,
			"minMinor":       request.MinMinor,
			"maxMinor":       request.MaxMinor,
			"currency":       request.Currency,
			"policyVersion":  request.PolicyVersion,
		}
		if request.hasRoute() {
			publishedPayload["stopCount"] = len(request.Stops)
			publishedPayload["routeRevision"] = request.RouteRevision
			publishedPayload["routeFingerprint"] = request.RouteFingerprint
			publishedAudit["stopCount"] = len(request.Stops)
			publishedAudit["routeFingerprint"] = request.RouteFingerprint
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.request.published",
			AggregateType:  subjectRequest,
			AggregateID:    request.ID.String(),
			ToVersion:      request.Version,
			CityID:         request.CityID,
			ActorType:      "rider",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "mp.request.published:" + request.ID.String(),
			OccurredAt:     now,
			Payload:        publishedPayload,
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.request.published",
			SubjectType: subjectRequest,
			SubjectID:   request.ID.String(),
			After:       publishedAudit,
			Reason:      "requester published a marketplace request",
		}); err != nil {
			return err
		}
		view = requestViewOf(request)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeRequestCreate, actor.UserID, idempotencyKey, req, 201, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, 201, nil
}

// Snapshot answers GET /v1/mp/requests/{id}: the owner's request, the private
// offers, and the award once one exists. Only the owner may read it.
func (s *Service) Snapshot(ctx context.Context, actor Actor, requestID uuid.UUID) (*RequestSnapshotView, error) {
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	if request.RequesterID != actor.UserID {
		return nil, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}

	bids, err := s.deps.Store.LiveBidsForRequest(ctx, s.deps.Store.Pool(), request.ID)
	if err != nil {
		return nil, asDomainError(err)
	}

	now := s.now()
	offers := make([]*OfferView, 0, len(bids))
	for _, bid := range bids {
		offers = append(offers, s.offerViewOf(ctx, request, bid, now))
	}

	return &RequestSnapshotView{
		Request: requestViewOf(request),
		Offers:  offers,
		Seq:     request.Version,
	}, nil
}

// offerViewOf renders the rider-facing view of one bid. The amount is the
// rider's to see; everything about the driver is a display field derived
// server-side, and nothing about other bidders leaks through it.
func (s *Service) offerViewOf(ctx context.Context, request *Request, bid *Bid, now time.Time) *OfferView {
	kind := "immediate"
	var window *PickupWindow
	if bid.Slot == SlotNext {
		kind = "finishing_trip"
	}

	pickupLabel := "Pickup estimate unavailable"
	if session, err := s.deps.Store.DriverSessionRow(ctx, s.deps.Store.Pool(), bid.DriverID); err == nil && session.HasLocation() {
		distance := geo.HaversineDistance(*session.LastLat, *session.LastLng, request.Pickup.Lat, request.Pickup.Lng)
		eta := geo.EstimateETA(distance, "car")
		minutes := int((eta + 59) / 60)
		if bid.Slot == SlotNext {
			// A finishing-trip pickup can only be later than the direct drive;
			// the exact window is recomputed at selection time.
			window = &PickupWindow{
				EarliestSec: int(eta),
				LatestSec:   int(eta) + 2*int(eta),
				EtaVersion:  bid.BidVersion,
			}
			pickupLabel = "Pickup window " + itoa(minutes) + "–" + itoa(minutes*3) + " min (finishing a trip)"
		} else {
			pickupLabel = "Pickup in ~" + itoa(minutes) + " min · " + formatKm(distance) + " away"
		}
	}

	return &OfferView{
		BidID:           bid.ID.String(),
		BidVersion:      bid.BidVersion,
		RequestRevision: bid.RequestRevision,
		AmountMinor:     money(bid.AmountMinor, request.Currency),
		Kind:            kind,
		Driver:          verifiedDriverView(bid.DriverID.String(), request.VehicleClass),
		PickupLabel:     pickupLabel,
		PickupWindow:    window,
		ExpiresAt:       bid.ExpiresAt,
		Withdrawn:       bid.State == machine.MpBidWithdrawn,
		WhyRecommended:  nil,
	}
}

// ReviseRequest is the body of POST /v1/mp/requests/{id}/revise.
// requestedFareMinor is a Money object per the contract.
type ReviseRequest struct {
	RequestedFareMinor Money      `json:"requestedFareMinor"`
	QuoteID            *uuid.UUID `json:"quoteId,omitempty"`
	ExpectedVersion    int        `json:"expectedVersion"`
}

// freshQuoteRouteToleranceMeters is how far a replacement quote's pickup or
// dropoff may sit from the request's stored route and still count as "the
// same route": float jitter and re-geocoding noise, never a different trip.
const freshQuoteRouteToleranceMeters = 50.0

// sameRoutePoint reports whether two stored coordinates name the same place
// within the tight tolerance.
func sameRoutePoint(a, b Area) bool {
	return geo.HaversineDistance(a.Lat, a.Lng, b.Lat, b.Lng) <= freshQuoteRouteToleranceMeters
}

// ReviseRequest is a price-affecting edit: new revision, live bids
// invalidated, every bid's hold released. Envelope-only expansion is NOT this
// — the sweep does that without touching revision or bids.
//
// It is also the pre-award ROUTE edit (A02): a replacement quote for the same
// endpoints but a different ordered stop set re-prices the complete route,
// replaces the request's stops (surviving stops keep their ids), bumps
// route_revision alongside revision and — through the very same invalidation
// and hold-release machinery as a fare edit — kills every bid placed on the
// obsolete route.
func (s *Service) ReviseRequest(ctx context.Context, actor Actor, requestID uuid.UUID, req ReviseRequest, idempotencyKey string) (*RequestView, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only the requester can revise a request")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeRequestRevise, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view RequestView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}

	current, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if current.RequesterID != actor.UserID {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}

	config, policy, err := s.policy(ctx, current.CityID)
	if err != nil {
		return nil, 0, err
	}
	if err := requireCurrency(req.RequestedFareMinor, current.Currency, "requestedFareMinor"); err != nil {
		return nil, 0, err
	}

	// Bounds for the new amount: the stored ones, or a fresh quote's — and a
	// fresh quote may only tighten/shift the bounds for the SAME trade. It
	// must match the request's city, currency, service, vehicle class AND
	// route (the stored pickup/dropoff within a tight tolerance), and carry
	// the ACTIVE policy version; the cost-based floor is per route, so bounds
	// priced for another route (or market) never govern this one.
	minMinor, maxMinor := current.MinMinor, current.MaxMinor
	quoteID := current.QuoteID
	var freshQuote *Quote
	if req.QuoteID != nil && *req.QuoteID != current.QuoteID {
		freshQuote, err = s.deps.Store.QuoteByID(ctx, s.deps.Store.Pool(), *req.QuoteID)
		if errors.Is(err, domain.ErrNotFound) {
			return nil, 0, domain.Errorf(domain.CodeNotFound, "that quote does not exist")
		}
		if err != nil {
			return nil, 0, asDomainError(err)
		}
		if freshQuote.RequesterID != actor.UserID {
			return nil, 0, domain.Errorf(domain.CodeNotFound, "that quote does not exist")
		}
		now := s.now()
		if !now.Before(freshQuote.ExpiresAt) {
			return nil, 0, domain.Errorf(domain.CodeQuoteExpired, "this quote has expired; ask for a new one")
		}
		if freshQuote.ConsumedBy != nil {
			return nil, 0, domain.Errorf(domain.CodeConflict, "this quote has already been used")
		}
		if freshQuote.Service != current.Service || freshQuote.VehicleClass != current.VehicleClass {
			return nil, 0, domain.Errorf(domain.CodeValidationFailed,
				"a revision cannot change the request's service or vehicle class")
		}
		if freshQuote.CityID != current.CityID || freshQuote.Currency != current.Currency {
			return nil, 0, domain.Errorf(domain.CodeValidationFailed,
				"a revision cannot move the request to another city or currency").
				WithDetails(map[string]any{
					"quoteCityId": freshQuote.CityID, "requestCityId": current.CityID,
					"quoteCurrency": freshQuote.Currency, "requestCurrency": current.Currency,
				})
		}
		if !sameRoutePoint(freshQuote.Pickup, current.Pickup) || !sameRoutePoint(freshQuote.Dropoff, current.Dropoff) {
			return nil, 0, domain.Errorf(domain.CodeValidationFailed,
				"the replacement quote prices a different route than this request").
				WithDetails(map[string]any{"field": "quoteId"})
		}
		if freshQuote.PolicyVersion != policy.PolicyVersion {
			return nil, 0, domain.Errorf(domain.CodeValidationFailed,
				"the replacement quote was priced under a policy that is no longer active; ask for a new one").
				WithDetails(map[string]any{"quotedPolicyVersion": freshQuote.PolicyVersion, "activePolicyVersion": policy.PolicyVersion})
		}
		// A replacement quote may carry a DIFFERENT stop set: that is the
		// pre-award route edit. It passes the same gate as any other stop
		// route (ride only, multi-stop flag on) and its bounds were priced
		// for its own complete route, so they govern the revised request.
		if len(freshQuote.Stops) > 0 {
			if err := s.requireStopsAllowed(ctx, freshQuote.Service, actor, freshQuote.CityID); err != nil {
				return nil, 0, err
			}
		}
		minMinor, maxMinor = freshQuote.MinMinor, freshQuote.MaxMinor
		quoteID = freshQuote.ID
	}
	requestedMinor := req.RequestedFareMinor.AmountMinor
	if requestedMinor < minMinor || requestedMinor > maxMinor {
		return nil, 0, fareOutOfBounds(requestedMinor, minMinor, maxMinor,
			current.Currency, config.CurrencyFractionDigits)
	}

	var view *RequestView
	var releases []*Bid
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		request, err := s.deps.Store.RequestForUpdate(ctx, tx, requestID)
		if err != nil {
			return err
		}
		if request.State != machine.MpRequestOpen {
			return domain.Errorf(domain.CodeRequestClosed, "this request is no longer open").
				WithDetails(map[string]any{"state": request.State})
		}
		if request.Version != req.ExpectedVersion {
			return domain.Errorf(domain.CodeVersionConflict, "the request changed while this call was in flight").
				WithDetails(map[string]any{"expectedVersion": req.ExpectedVersion, "currentVersion": request.Version})
		}

		// Without a replacement quote the bounds are the LOCKED row's: the
		// pool read above may predate a revision that landed in between, and
		// the version guard alone does not make its numbers current.
		if freshQuote == nil {
			minMinor, maxMinor, quoteID = request.MinMinor, request.MaxMinor, request.QuoteID
			if requestedMinor < minMinor || requestedMinor > maxMinor {
				return fareOutOfBounds(requestedMinor, minMinor, maxMinor,
					request.Currency, config.CurrencyFractionDigits)
			}
		}

		now := s.now()
		if freshQuote != nil {
			if err := s.deps.Store.ConsumeQuote(ctx, tx, freshQuote.ID, request.ID); err != nil {
				return err
			}
		}

		fromVersion := request.Version
		revision := request.Revision + 1
		update := RequestUpdate{
			Revision:       &revision,
			RequestedMinor: &requestedMinor,
			MinMinor:       &minMinor,
			MaxMinor:       &maxMinor,
			QuoteID:        &quoteID,
		}
		// ONE revision counter covers fare and route: bids are pinned to it
		// and every existing guard (bid submit/revise, selection) checks it,
		// so a stop change invalidates exactly like a fare change and reuses
		// the same bid-invalidation and hold-release path below. The route
		// columns move only when the adopted quote's stop set differs
		// MATERIALLY from the locked row's; route_revision then bumps, the
		// route is re-fingerprinted, and every surviving stop keeps its id.
		routeChanged := false
		if freshQuote != nil {
			update.RoutedDistanceM = &freshQuote.RoutedDistanceM
			update.RoutedDurationSec = &freshQuote.RoutedDurationSec
			if !sameStopSet(request.Stops, freshQuote.Stops) {
				routeChanged = true
				stops := carryStopIDs(request.Stops, freshQuote.Stops)
				routeRevision := request.RouteRevision + 1
				fingerprint := routeFingerprint(request.Pickup, stops, request.Dropoff)
				dwell := totalDwellSec(stops)
				update.Stops = &stops
				update.RouteRevision = &routeRevision
				update.RouteFingerprint = &fingerprint
				update.StopsDwellSec = &dwell
			}
		}
		moved, err := s.deps.Store.TransitionRequest(ctx, tx, request, machine.MpRequestOpen, update)
		if err != nil {
			return err
		}
		snapshot := map[string]any{
			"requestedMinor": requestedMinor,
			"minMinor":       minMinor,
			"maxMinor":       maxMinor,
		}
		if route := routeSnapshot(moved); route != nil {
			snapshot["route"] = route
			snapshot["routeChanged"] = routeChanged
		}
		if err := s.deps.Store.InsertRequestRevision(ctx, tx, request.ID, revision, requestedMinor, quoteID, snapshot); err != nil {
			return err
		}

		reason := "request_revised"
		if routeChanged {
			reason = "route_revised"
		}
		invalidated, err := s.invalidateLiveBids(ctx, tx, moved, reason, now)
		if err != nil {
			return err
		}
		releases = invalidated

		payload := map[string]any{
			"requestId":       request.ID.String(),
			"revision":        revision,
			"requestedMinor":  requestedMinor,
			"invalidatedBids": len(invalidated),
		}
		before := map[string]any{"requestedMinor": request.RequestedMinor, "revision": request.Revision}
		after := map[string]any{"requestedMinor": requestedMinor, "revision": revision}
		auditReason := "requester revised the asked fare"
		if request.hasRoute() || moved.hasRoute() {
			payload["routeChanged"] = routeChanged
			payload["routeRevision"] = moved.RouteRevision
			payload["routeFingerprint"] = moved.RouteFingerprint
			payload["stopCount"] = len(moved.Stops)
			before["routeRevision"], before["routeFingerprint"] = request.RouteRevision, request.RouteFingerprint
			after["routeRevision"], after["routeFingerprint"] = moved.RouteRevision, moved.RouteFingerprint
		}
		if routeChanged {
			auditReason = "requester revised the route (intermediate stops) and the asked fare"
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.request.revised",
			AggregateType:  subjectRequest,
			AggregateID:    request.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         request.CityID,
			ActorType:      "rider",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "mp.request.revised:" + request.ID.String() + ":" + itoa(revision),
			OccurredAt:     now,
			Payload:        payload,
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.request.revised",
			SubjectType: subjectRequest,
			SubjectID:   request.ID.String(),
			Before:      before,
			After:       after,
			Reason:      auditReason,
		}); err != nil {
			return err
		}
		view = requestViewOf(moved)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeRequestRevise, actor.UserID, idempotencyKey, req, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}

	// The rows are committed: every invalidated bid's hold is now released,
	// and a wallet that cannot be reached right now is owed by the sweep.
	s.releaseBidReservations(ctx, releases)
	return view, 200, nil
}

// Cancel closes an open request (owner only) and releases every live bid's
// hold. A request under an unresolved award answers request_closed: the state
// machine says award_pending is not the requester's to cancel unilaterally.
func (s *Service) Cancel(ctx context.Context, actor Actor, requestID uuid.UUID, idempotencyKey string) (*RequestView, int, error) {
	if !actor.IsRider() {
		return nil, 0, domain.Errorf(domain.CodeForbidden, "only the requester can cancel a request")
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	body := map[string]any{"requestId": requestID.String()}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeRequestCancel, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view RequestView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}

	current, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if current.RequesterID != actor.UserID {
		return nil, 0, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}

	// A queued (awarded, unpromoted) request whose pickup window was missed
	// may exit FEE-FREE: the award cancels and the captured fee is reversed
	// with a linked entry. Cancelling this next job never touches the
	// driver's current job.
	if current.State == machine.MpRequestAwarded {
		return s.cancelMissedQueuedAward(ctx, actor, current, idempotencyKey, body)
	}
	if current.State == machine.MpRequestAwardPending {
		return nil, 0, s.awardUnresolvedError(ctx, current)
	}

	var view *RequestView
	var releases []*Bid
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		request, err := s.deps.Store.RequestForUpdate(ctx, tx, requestID)
		if err != nil {
			return err
		}
		if request.State != machine.MpRequestOpen {
			return domain.Errorf(domain.CodeRequestClosed, "this request can no longer be cancelled").
				WithDetails(map[string]any{"state": request.State})
		}

		now := s.now()
		reason := "cancelled"
		fromVersion := request.Version
		moved, err := s.deps.Store.TransitionRequest(ctx, tx, request, machine.MpRequestCancelled, RequestUpdate{
			CloseReason: &reason,
		})
		if err != nil {
			return err
		}

		invalidated, err := s.invalidateLiveBids(ctx, tx, moved, "request_cancelled", now)
		if err != nil {
			return err
		}
		releases = invalidated

		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.request.closed",
			AggregateType:  subjectRequest,
			AggregateID:    request.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         request.CityID,
			ActorType:      "rider",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "mp.request.closed:" + request.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"requestId":       request.ID.String(),
				"reason":          reason,
				"invalidatedBids": len(invalidated),
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.request.closed",
			SubjectType: subjectRequest,
			SubjectID:   request.ID.String(),
			Before:      map[string]any{"state": request.State},
			After:       map[string]any{"state": moved.State, "reason": reason},
			Reason:      "requester cancelled the request",
		}); err != nil {
			return err
		}
		view = requestViewOf(moved)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopeRequestCancel, actor.UserID, idempotencyKey, body, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}

	s.releaseBidReservations(ctx, releases)
	return view, 200, nil
}

// cancelMissedQueuedAward is the owner's fee-free exit from a queued award
// whose pickup window was missed (mp.queue.window_missed already fired). It
// refuses a queued award whose window still stands — the market's answer to
// buyer's remorse is the driver keeping the job they won.
func (s *Service) cancelMissedQueuedAward(ctx context.Context, actor Actor, request *Request, idempotencyKey string, body map[string]any) (*RequestView, int, error) {
	award, err := s.deps.Store.LatestAwardForRequest(ctx, s.deps.Store.Pool(), request.ID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, 0, domain.Errorf(domain.CodeRequestClosed, "this request can no longer be cancelled")
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if award.State != machine.MpAwardConfirmed {
		return nil, 0, domain.Errorf(domain.CodeRequestClosed, "this request can no longer be cancelled").
			WithDetails(map[string]any{"awardState": award.State})
	}
	if award.PickupWindow == nil || !award.PickupWindow.MissedEmitted {
		return nil, 0, domain.Errorf(domain.CodeRequestClosed,
			"this queued job's pickup window still stands; it can only be cancelled fee-free after a missed window")
	}

	var view *RequestView
	closed, err := s.cancelQueuedAward(ctx, award, "window_missed", actor.UserID.String(), actor.Role,
		func(tx pgx.Tx, closedRequest *Request) error {
			view = requestViewOf(closedRequest)
			return s.deps.Store.SaveIdempotent(ctx, tx, scopeRequestCancel, actor.UserID, idempotencyKey, body, 200, view)
		})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if view == nil {
		view = requestViewOf(closed)
	}
	return view, 200, nil
}

// invalidateLiveBids marks every live bid on a request invalidated inside the
// caller's transaction, with one mp.bid.invalidated event each. The wallet
// releases happen after commit — a hold must never be released for an
// invalidation that then rolls back.
func (s *Service) invalidateLiveBids(ctx context.Context, tx pgx.Tx, request *Request, reason string, now time.Time) ([]*Bid, error) {
	bids, err := s.deps.Store.LiveBidsForRequest(ctx, tx, request.ID)
	if err != nil {
		return nil, err
	}
	invalidated := make([]*Bid, 0, len(bids))
	for _, snapshot := range bids {
		// Re-read under lock: a bid that concurrently reached a terminal
		// state must be skipped, never overwritten to invalidated.
		bid, err := s.deps.Store.BidForUpdate(ctx, tx, snapshot.ID)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				continue
			}
			return nil, err
		}
		if !machine.IsMpBidLive(bid.State) {
			continue
		}
		moved, err := s.deps.Store.TransitionBid(ctx, tx, bid, machine.MpBidInvalidated, BidUpdate{})
		if err != nil {
			return nil, err
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.bid.invalidated",
			AggregateType:  subjectBid,
			AggregateID:    bid.ID.String(),
			ToVersion:      moved.BidVersion,
			CityID:         request.CityID,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: "mp.bid.invalidated:" + bid.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"bidId":     bid.ID.String(),
				"requestId": request.ID.String(),
				"driverId":  bid.DriverID.String(),
				"reason":    reason,
			},
		}); err != nil {
			return nil, err
		}
		invalidated = append(invalidated, moved)
	}
	return invalidated, nil
}

// releaseBidReservations releases each bid's hold exactly once, after the
// invalidation committed. A wallet failure is written down for the sweep; it
// is never swallowed and never retried in a tight loop here.
func (s *Service) releaseBidReservations(ctx context.Context, bids []*Bid) {
	for _, bid := range bids {
		s.releaseReservation(ctx, bid)
	}
}

// releaseReservation releases one bid's hold under the bid's own idempotency
// key, recording a recovery row when the wallet cannot confirm it.
func (s *Service) releaseReservation(ctx context.Context, bid *Bid) {
	if bid.ReservationID == "" {
		return
	}
	if _, err := s.deps.Wallet.Release(ctx, bid.ReservationID, releaseKeyFor(bid.ID)); err != nil {
		s.deps.Logger.Warn().Err(err).
			Str("bid_id", bid.ID.String()).
			Str("reservation_id", bid.ReservationID).
			Msg("hold release failed; recorded for the sweep")
		bidID := bid.ID
		if insertErr := s.deps.Store.InsertRecovery(ctx, s.deps.Store.Pool(), RecoveryRow{
			ReservationID: bid.ReservationID,
			DriverID:      bid.DriverID,
			BidID:         &bidID,
			Action:        RecoveryRelease,
			LastError:     err.Error(),
		}); insertErr != nil {
			s.deps.Logger.Error().Err(insertErr).
				Str("reservation_id", bid.ReservationID).
				Msg("could not record the release for recovery")
		}
		return
	}
	// The wallet CONFIRMED the release: record it so the driver's holdState
	// may honestly say `released` (until then it reads release_pending).
	if err := s.deps.Store.MarkHoldReleased(ctx, s.deps.Store.Pool(), bid.ID, s.now()); err != nil {
		s.deps.Logger.Error().Err(err).Str("bid_id", bid.ID.String()).Msg("could not record the confirmed release")
	}
}

// releaseKeyFor is the one idempotency key a bid's hold is ever released
// under, so compensation, withdrawal and the sweep converge on one release.
func releaseKeyFor(bidID uuid.UUID) string {
	return "mp.release:" + bidID.String()
}

func formatKm(meters float64) string {
	tenths := int(meters/100 + 0.5)
	return itoa(tenths/10) + "." + itoa(tenths%10) + " km"
}
