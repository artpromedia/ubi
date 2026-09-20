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
// it: the bounds are the stored quote's.
type PublishRequest struct {
	QuoteID            uuid.UUID      `json:"quoteId"`
	RequestedFareMinor int64          `json:"requestedFareMinor"`
	PaymentMethodID    string         `json:"paymentMethodId"`
	Delivery           map[string]any `json:"delivery,omitempty"`
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
	// against anything the client restated.
	if req.RequestedFareMinor < quote.MinMinor || req.RequestedFareMinor > quote.MaxMinor {
		return nil, 0, fareOutOfBounds(req.RequestedFareMinor, quote.MinMinor, quote.MaxMinor,
			quote.Currency, config.CurrencyFractionDigits)
	}

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
		ID:              uuid.New(),
		QuoteID:         quote.ID,
		RequesterID:     actor.UserID,
		CityID:          quote.CityID,
		Service:         quote.Service,
		VehicleClass:    quote.VehicleClass,
		Currency:        quote.Currency,
		State:           machine.MpRequestOpen,
		Revision:        1,
		Version:         1,
		RequestedMinor:  req.RequestedFareMinor,
		SuggestedMinor:  quote.SuggestedMinor,
		MinMinor:        quote.MinMinor,
		MaxMinor:        quote.MaxMinor,
		Pickup:          quote.Pickup,
		Dropoff:         quote.Dropoff,
		Delivery:        req.Delivery,
		PaymentMethodID: req.PaymentMethodID,
		EnvelopeStep:    0,
		EnvelopeRadiusM: policy.SearchEnvelope.InitialRadiusMeters,
		EnvelopeEtaSec:  policy.SearchEnvelope.InitialPickupEtaSec,
		PolicyVersion:   policy.PolicyVersion,
		PricingVersion:  quote.PricingVersion,
		ExpiresAt:       now.Add(time.Duration(policy.Bids.RequestExpirySec) * time.Second),
	}

	var view *RequestView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.deps.Store.InsertRequest(ctx, tx, request); err != nil {
			return err
		}
		if err := s.deps.Store.ConsumeQuote(ctx, tx, quote.ID, request.ID); err != nil {
			return err
		}
		if err := s.deps.Store.InsertRequestRevision(ctx, tx, request.ID, 1, request.RequestedMinor, quote.ID, map[string]any{
			"requestedMinor": request.RequestedMinor,
			"minMinor":       request.MinMinor,
			"maxMinor":       request.MaxMinor,
			"envelope":       map[string]any{"radiusMeters": request.EnvelopeRadiusM, "pickupEtaSec": request.EnvelopeEtaSec},
		}); err != nil {
			return err
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
			Payload: map[string]any{
				"requestId":      request.ID.String(),
				"quoteId":        quote.ID.String(),
				"service":        request.Service,
				"vehicleClass":   request.VehicleClass,
				"requestedMinor": request.RequestedMinor,
				"currency":       request.Currency,
				"revision":       request.Revision,
				"expiresAt":      request.ExpiresAt.Format(time.RFC3339),
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.request.published",
			SubjectType: subjectRequest,
			SubjectID:   request.ID.String(),
			After: map[string]any{
				"state":          request.State,
				"requestedMinor": request.RequestedMinor,
				"minMinor":       request.MinMinor,
				"maxMinor":       request.MaxMinor,
				"currency":       request.Currency,
				"policyVersion":  request.PolicyVersion,
			},
			Reason: "requester published a marketplace request",
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
		AmountMinor:     bid.AmountMinor,
		Kind:            kind,
		Driver:          maskedDriverView(bid.DriverID.String(), request.VehicleClass),
		PickupLabel:     pickupLabel,
		PickupWindow:    window,
		ExpiresAt:       bid.ExpiresAt,
		Withdrawn:       bid.State == machine.MpBidWithdrawn,
		WhyRecommended:  nil,
	}
}

// ReviseRequest is the body of POST /v1/mp/requests/{id}/revise.
type ReviseRequest struct {
	RequestedFareMinor int64      `json:"requestedFareMinor"`
	QuoteID            *uuid.UUID `json:"quoteId,omitempty"`
	ExpectedVersion    int        `json:"expectedVersion"`
}

// ReviseRequest is a price-affecting edit: new revision, live bids
// invalidated, every bid's hold released. Envelope-only expansion is NOT this
// — the sweep does that without touching revision or bids.
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

	config, _, err := s.policy(ctx, current.CityID)
	if err != nil {
		return nil, 0, err
	}

	// Bounds for the new amount: the stored ones, or a fresh quote's when the
	// route changed and the requester re-quoted.
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
		minMinor, maxMinor = freshQuote.MinMinor, freshQuote.MaxMinor
		quoteID = freshQuote.ID
	}
	if req.RequestedFareMinor < minMinor || req.RequestedFareMinor > maxMinor {
		return nil, 0, fareOutOfBounds(req.RequestedFareMinor, minMinor, maxMinor,
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

		now := s.now()
		if freshQuote != nil {
			if err := s.deps.Store.ConsumeQuote(ctx, tx, freshQuote.ID, request.ID); err != nil {
				return err
			}
		}

		fromVersion := request.Version
		revision := request.Revision + 1
		moved, err := s.deps.Store.TransitionRequest(ctx, tx, request, machine.MpRequestOpen, RequestUpdate{
			Revision:       &revision,
			RequestedMinor: &req.RequestedFareMinor,
			MinMinor:       &minMinor,
			MaxMinor:       &maxMinor,
			QuoteID:        &quoteID,
		})
		if err != nil {
			return err
		}
		if err := s.deps.Store.InsertRequestRevision(ctx, tx, request.ID, revision, req.RequestedFareMinor, quoteID, map[string]any{
			"requestedMinor": req.RequestedFareMinor,
			"minMinor":       minMinor,
			"maxMinor":       maxMinor,
		}); err != nil {
			return err
		}

		invalidated, err := s.invalidateLiveBids(ctx, tx, moved, "request_revised", now)
		if err != nil {
			return err
		}
		releases = invalidated

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
			Payload: map[string]any{
				"requestId":       request.ID.String(),
				"revision":        revision,
				"requestedMinor":  req.RequestedFareMinor,
				"invalidatedBids": len(invalidated),
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.request.revised",
			SubjectType: subjectRequest,
			SubjectID:   request.ID.String(),
			Before:      map[string]any{"requestedMinor": request.RequestedMinor, "revision": request.Revision},
			After:       map[string]any{"requestedMinor": req.RequestedFareMinor, "revision": revision},
			Reason:      "requester revised the asked fare",
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
	for _, bid := range bids {
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
