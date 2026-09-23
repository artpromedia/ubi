package marketplace

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// feedPageSize bounds one feed page. A page size is plumbing, not policy.
const feedPageSize = 20

// feedCursor encodes the last row's (created_at, id) so pagination is stable
// under inserts.
func encodeCursor(createdAt time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString(
		[]byte(strconv.FormatInt(createdAt.UnixNano(), 10) + "|" + id.String()))
}

func decodeCursor(cursor string) (time.Time, uuid.UUID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, uuid.Nil, errors.New("malformed cursor")
	}
	nanos, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	return time.Unix(0, nanos).UTC(), id, nil
}

// openRequestsForFeed lists open, unexpired requests in a city, newest first,
// keyed for cursor pagination.
func (s *Store) openRequestsForFeed(ctx context.Context, db DB, cityID string, now time.Time, before *time.Time, beforeID *uuid.UUID, limit int) ([]*Request, error) {
	query := `
		SELECT ` + requestColumns + `
		FROM mp.requests
		WHERE city_id = $1 AND state = $2 AND expires_at > $3`
	args := []any{cityID, machine.MpRequestOpen, now}
	if before != nil && beforeID != nil {
		query += ` AND (created_at, id) < ($4, $5)`
		args = append(args, *before, *beforeID)
	}
	query += fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT %d`, limit)
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list feed requests: %w", err)
	}
	defer rows.Close()
	var requests []*Request
	for rows.Next() {
		request, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}
		requests = append(requests, request)
	}
	return requests, rows.Err()
}

// feedItemOf renders the privacy-limited card: area labels, coarse distance
// and money. Never coordinates, never an exact address, never the requester.
func feedItemOf(request *Request, distanceMeters float64) *FeedItemView {
	title := "Ride request · " + request.VehicleClass
	if request.Service == ServiceDelivery {
		title = "Delivery request · " + request.VehicleClass
	}
	meta := request.Pickup.Label + " → " + request.Dropoff.Label
	if len(request.Stops) > 0 {
		meta += " · " + stopCountLabel(len(request.Stops))
	}
	if distanceMeters >= 0 {
		meta += " · " + formatKm(distanceMeters) + " from you"
	}
	var badge *string
	if request.Service == ServiceDelivery && request.Delivery != nil {
		if weight, ok := request.Delivery["weightKg"].(float64); ok {
			label := fmt.Sprintf("%.0f kg", weight)
			badge = &label
		}
	}
	return &FeedItemView{
		RequestID:       request.ID.String(),
		Revision:        request.Revision,
		Service:         request.Service,
		Title:           title,
		Meta:            meta,
		AskedMinor:      money(request.RequestedMinor, request.Currency),
		AskedByLabel:    "Requester asks",
		CapabilityBadge: badge,
		ExpiresAt:       request.ExpiresAt,
		Route:           feedRouteOf(request),
	}
}

// FeedQuery is what a driver may ask of the feed.
type FeedQuery struct {
	Cursor string
	// IgnorePreferences shows every request the envelope admits, neither
	// filtered nor ranked by the driver's preferences (A04.2). Preferences
	// never touch eligibility either way.
	IgnorePreferences bool
}

// feedPreferencesNote is the one line a feed states about preferences.
const feedPreferencesNote = "Filtered and sorted by your preferences. They never bid for you."

// Feed answers GET /v1/mp/feed (D01): the paginated, privacy-limited list of
// open requests this driver could discover. Reading the feed never reserves
// the driver or removes availability. Every card carries the server-composed
// earnings breakdown at the requester's fare (A04.1); the driver's saved
// preferences hide what they do not want and rank homeward requests first
// within the page (A04.2) — a filter on DISCOVERY, never on eligibility.
func (s *Service) Feed(ctx context.Context, actor Actor, query FeedQuery) (*FeedPageView, error) {
	cursor := query.Cursor
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a driver has a marketplace feed")
	}
	if actor.CityID == "" {
		return nil, domain.Errorf(domain.CodeValidationFailed, "the gateway did not say which city this driver is in")
	}

	session, err := s.deps.Store.DriverSessionRow(ctx, s.deps.Store.Pool(), actor.UserID)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && session.State == machine.DriverOffline) {
		// An offline driver sees an empty market, not an error.
		epoch, epochErr := s.deps.Store.AvailabilityEpoch(ctx, s.deps.Store.Pool(), actor.UserID)
		if epochErr != nil {
			return nil, asDomainError(epochErr)
		}
		return &FeedPageView{Items: []*FeedItemView{}, AvailabilityEpoch: epoch}, nil
	}
	if err != nil {
		return nil, asDomainError(err)
	}

	// The feed serves both verticals; a vertical whose flag is off for this
	// driver simply does not appear.
	ridesOn := s.requireFlag(ctx, flagFor(ServiceRide), actor, actor.CityID) == nil
	deliveryOn := s.requireFlag(ctx, flagFor(ServiceDelivery), actor, actor.CityID) == nil
	if !ridesOn && !deliveryOn {
		return nil, domain.Errorf(domain.CodeFeatureDisabled, "this feature is not available here")
	}

	now := s.now()
	var before *time.Time
	var beforeID *uuid.UUID
	if cursor != "" {
		at, id, err := decodeCursor(cursor)
		if err != nil {
			return nil, domain.Errorf(domain.CodeValidationFailed, "that is not a feed cursor")
		}
		before, beforeID = &at, &id
	}

	epoch, err := s.deps.Store.AvailabilityEpoch(ctx, s.deps.Store.Pool(), actor.UserID)
	if err != nil {
		return nil, asDomainError(err)
	}

	page := &FeedPageView{Items: []*FeedItemView{}, AvailabilityEpoch: epoch}

	prefs, err := s.deps.Store.LatestDriverPreferences(ctx, s.deps.Store.Pool(), actor.UserID, actor.CityID)
	if errors.Is(err, domain.ErrNotFound) {
		prefs = nil
	} else if err != nil {
		return nil, asDomainError(err)
	}
	if prefs != nil {
		page.Preferences = &FeedPreferencesView{
			Version: prefs.Version,
			Applied: !query.IgnorePreferences,
			Note:    feedPreferencesNote,
		}
		if query.IgnorePreferences {
			page.Preferences.Note = "Showing every request in your area; your preferences are not applied."
			prefs = nil
		}
	}
	// Scan forward until a page is filled or the market runs out. The batch
	// is larger than the page because capability and envelope filters drop
	// rows after the query.
	scanFrom, scanFromID := before, beforeID
	for len(page.Items) < feedPageSize {
		batch, err := s.deps.Store.openRequestsForFeed(ctx, s.deps.Store.Pool(), actor.CityID, now, scanFrom, scanFromID, feedPageSize*3)
		if err != nil {
			return nil, asDomainError(err)
		}
		if len(batch) == 0 {
			break
		}
		for _, request := range batch {
			last := request
			scanFrom, scanFromID = &last.CreatedAt, &last.ID
			if request.RequesterID == actor.UserID {
				continue
			}
			if request.Service == ServiceRide && !ridesOn {
				continue
			}
			if request.Service == ServiceDelivery && !deliveryOn {
				continue
			}
			if !session.Offers(request.VehicleClass) {
				continue
			}
			if !session.HasLocation() {
				// No usable location: nothing is inside any envelope.
				continue
			}
			distance := geo.HaversineDistance(*session.LastLat, *session.LastLng, request.Pickup.Lat, request.Pickup.Lng)
			if distance > float64(request.EnvelopeRadiusM) {
				continue
			}
			if reason := prefs.hiddenReason(request, coarsePickupMeters(distance)); reason != "" {
				page.Preferences.HiddenCount++
				continue
			}
			item := feedItemOf(request, distance)
			pickup := s.straightLinePickup(ctx, *session.LastLat, *session.LastLng, request)
			pickup.distanceM = distance
			item.Earnings = earningsBreakdown(request, request.RequestedMinor, GrossBasisRequested, pickup)
			if prefs != nil {
				item.PreferenceTags = prefs.preferenceTags(request)
			}
			page.Items = append(page.Items, item)
			if len(page.Items) == feedPageSize {
				break
			}
		}
		if len(batch) < feedPageSize*3 {
			break
		}
	}
	if len(page.Items) == feedPageSize && scanFrom != nil && scanFromID != nil {
		next := encodeCursor(*scanFrom, *scanFromID)
		page.NextCursor = &next
	}
	// Rank within the page: homeward matches first, otherwise newest first.
	// The cursor is the SCAN position, so re-ordering a page never skips or
	// repeats a request across pages.
	sort.SliceStable(page.Items, func(i, j int) bool {
		return len(page.Items[i].PreferenceTags) > 0 && len(page.Items[j].PreferenceTags) == 0
	})
	return page, nil
}

func flagFor(service string) string {
	flag, _ := serviceFlag(service)
	return flag
}

// DriverView answers GET /v1/mp/requests/{id}/driver-view (D02/D03/D10): the
// privacy-limited item, the authoritative eligibility, the server-generated
// presets, the profile line and the driver's own live bid.
func (s *Service) DriverView(ctx context.Context, actor Actor, requestID uuid.UUID) (*DriverViewResult, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a driver has a driver view")
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	// A07: a driver may only driver-view requests in their own city. The feed
	// is already city-scoped; without this a driver could probe (and bid on) an
	// out-of-city request by id. A mismatch answers 404 so existence — and the
	// request's coarse pickup label/distance in the feed item — is not leaked
	// cross-city. (Eligibility still further gates whether they can bid.)
	if actor.CityID != "" && request.CityID != actor.CityID {
		return nil, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err := s.requireServiceFlag(ctx, request.Service, actor, request.CityID); err != nil {
		return nil, err
	}
	if request.State != machine.MpRequestOpen {
		return nil, domain.Errorf(domain.CodeRequestClosed, "this request is no longer open").
			WithDetails(map[string]any{"state": request.State})
	}

	config, policy, err := s.policy(ctx, request.CityID)
	if err != nil {
		return nil, err
	}

	eligibility, err := s.EvaluateEligibility(ctx, actor, request, config, policy)
	if err != nil {
		return nil, err
	}

	distance := float64(-1)
	pickup := unknownPickup()
	if session, sessionErr := s.deps.Store.DriverSessionRow(ctx, s.deps.Store.Pool(), actor.UserID); sessionErr == nil && session.HasLocation() {
		distance = geo.HaversineDistance(*session.LastLat, *session.LastLng, request.Pickup.Lat, request.Pickup.Lng)
		pickup = s.straightLinePickup(ctx, *session.LastLat, *session.LastLng, request)
		pickup.distanceM = distance
	}
	// An eligible driver's pickup was routed by the eligibility evaluation
	// itself; that measured leg replaces the straight-line estimate.
	if eligibility.pickup != nil {
		pickup = *eligibility.pickup
	}

	prefs, err := s.deps.Store.LatestDriverPreferences(ctx, s.deps.Store.Pool(), actor.UserID, request.CityID)
	if errors.Is(err, domain.ErrNotFound) {
		prefs = nil
	} else if err != nil {
		return nil, asDomainError(err)
	}

	item := feedItemOf(request, distance)
	item.Earnings = earningsBreakdown(request, request.RequestedMinor, GrossBasisRequested, pickup)
	if prefs != nil {
		item.PreferenceTags = prefs.preferenceTags(request)
	}
	result := &DriverViewResult{
		Item:        item,
		Eligibility: eligibility,
		Presets:     []*PresetView{},
	}

	// Presets are money: they need the wallet's one spendable number. If the
	// wallet cannot answer, the view fails honestly rather than promising
	// affordability nobody checked. The internal overview endpoint takes the
	// driver AND the city whose currency/config applies.
	overview, err := s.deps.Wallet.Overview(ctx, actor.UserID, request.CityID)
	if err != nil {
		return nil, asDomainError(err)
	}

	profile, profileErr := s.deps.Store.LatestRateProfile(ctx, s.deps.Store.Pool(), actor.UserID,
		request.CityID, request.Service, request.VehicleClass)
	if profileErr != nil && !errors.Is(profileErr, domain.ErrNotFound) {
		return nil, asDomainError(profileErr)
	}

	result.Presets, result.ProfileLine, result.CeilingNotice = s.buildPresets(ctx, request, config.CurrencyFractionDigits, overview.SpendableMinor.AmountMinor, profile, prefs, pickup)
	// A request the driver's feed would hide stays fully biddable here
	// (preferences are not eligibility); the view just says which preference
	// it does not meet.
	if prefs != nil {
		if words := prefs.hiddenWords(request, coarsePickupMeters(distance), config.CurrencyFractionDigits); words != "" {
			result.PreferenceNotice = &words
		}
	}

	if myBid, bidErr := s.deps.Store.LiveBidForDriverOnRequest(ctx, s.deps.Store.Pool(), request.ID, actor.UserID); bidErr == nil {
		result.MyBid = bidViewOf(myBid, request.Currency)
	} else if !errors.Is(bidErr, domain.ErrNotFound) {
		return nil, asDomainError(bidErr)
	}

	// The next-slot dependency the contract mandates: the driver's current
	// claim id, or null when they have none.
	if currentClaim, claimErr := s.deps.Store.CurrentClaim(ctx, s.deps.Store.Pool(), actor.UserID); claimErr == nil {
		id := currentClaim.ID.String()
		result.CurrentClaimID = &id
	} else if !errors.Is(claimErr, domain.ErrNotFound) {
		return nil, asDomainError(claimErr)
	}

	return result, nil
}

// buildPresets generates the quick offers: the requested amount, one lower,
// one higher (policy-derived steps inside the stored bounds), the rate
// profile's calculation when one exists and the driver's minimum trip amount
// when the request can pay it but asks less. Every preset carries gross, the
// 10% half-up commission and net, the full earnings breakdown at its amount,
// plus affordability against the one spendable. Nothing outside the bounds is
// ever emitted, and nothing unaffordable is emitted without its exact
// shortfall. Presets are suggestions: nothing here places a bid.
func (s *Service) buildPresets(ctx context.Context, request *Request, digits int, spendableMinor int64, profile *RateProfile, prefs *DriverPreferences, pickup pickupEstimate) ([]*PresetView, *string, *string) {
	currency := request.Currency

	// The step is derived from the request's own envelope: a tenth of the
	// negotiable range, never less than one minor unit.
	step := (request.MaxMinor - request.MinMinor) / 10
	if step < 1 {
		step = 1
	}

	type candidate struct {
		amount     int64
		title      string
		source     string
		emphasized bool
	}
	candidates := []candidate{
		{request.RequestedMinor, "Accept asking price", "requested", true},
	}
	if lower := request.RequestedMinor - step; lower >= request.MinMinor {
		candidates = append(candidates, candidate{lower, "Bid lower", "lower", false})
	}
	if higher := request.RequestedMinor + step; higher <= request.MaxMinor {
		candidates = append(candidates, candidate{higher, "Bid higher", "higher", false})
	}

	var profileLine, ceilingNotice *string
	if profile != nil {
		quote, err := s.deps.Store.QuoteByID(ctx, s.deps.Store.Pool(), request.QuoteID)
		if err == nil {
			amount := profileFare(profile, quote.RoutedDistanceM)
			line := "Your rate: " + formatMinor(profile.PerKmMinor, currency, digits) + "/km · min " +
				formatMinor(profile.MinTripMinor, currency, digits) + " (v" + itoa(profile.Version) + ")"
			profileLine = &line
			switch {
			case amount > request.MaxMinor:
				notice := "Your profile fare of " + formatMinor(amount, currency, digits) +
					" exceeds this request's maximum of " + formatMinor(request.MaxMinor, currency, digits) + "."
				ceilingNotice = &notice
			case amount < request.MinMinor:
				notice := "Your profile fare of " + formatMinor(amount, currency, digits) +
					" is below this request's minimum of " + formatMinor(request.MinMinor, currency, digits) + "."
				ceilingNotice = &notice
			default:
				candidates = append(candidates, candidate{amount, "Your rate", "rate_profile", false})
			}
		}
	}

	// The driver's minimum trip amount pre-fills an offer when the request
	// asks less but its maximum can pay it (above the maximum the driver
	// view's preference notice explains it instead; it is never clamped).
	if prefs != nil && prefs.MinTripAmountMinor != nil && prefs.Currency == currency {
		minimum := *prefs.MinTripAmountMinor
		if minimum > request.RequestedMinor && minimum >= request.MinMinor && minimum <= request.MaxMinor {
			candidates = append(candidates, candidate{minimum, "Your minimum trip", "preference_minimum", false})
		}
	}

	seen := map[int64]bool{}
	presets := make([]*PresetView, 0, len(candidates))
	for _, c := range candidates {
		if seen[c.amount] {
			continue
		}
		seen[c.amount] = true
		commission := CommissionMinor(c.amount)
		net := c.amount - commission
		preset := &PresetView{
			Key:             c.source + ":" + strconv.FormatInt(c.amount, 10),
			AmountMinor:     money(c.amount, currency),
			CommissionMinor: money(commission, currency),
			NetMinor:        money(net, currency),
			Title:           c.title,
			FeeNetLabel:     "Fee " + formatMinor(commission, currency, digits) + " · You receive " + formatMinor(net, currency, digits),
			Affordable:      spendableMinor >= commission,
			Emphasized:      c.emphasized,
			Source:          c.source,
			Earnings:        earningsBreakdown(request, c.amount, GrossBasisPreset, pickup),
		}
		if !preset.Affordable {
			shortfall := money(commission-spendableMinor, currency)
			label := "Top up " + formatMinor(shortfall.AmountMinor, currency, digits) + " to place this bid"
			preset.ShortfallMinor = &shortfall
			preset.ShortfallLabel = &label
		}
		presets = append(presets, preset)
	}
	return presets, profileLine, ceilingNotice
}
