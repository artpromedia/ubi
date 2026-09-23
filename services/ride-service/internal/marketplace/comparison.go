package marketplace

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// Offer comparison (A06 part A).
//
// Every offer the requester sees carries, computed server-side and never by
// the app: the total they pay, a pickup ESTIMATE (labelled as one, with its
// basis and age), the vehicle, the verified driver card from user-service
// (rating average AND count exactly as user-service returns them, or null —
// never invented), a clearly DEFINED reliability figure computed from this
// service's own marketplace rides (with its window, sample size, minimum
// sample and freshness; below the minimum it says "not enough history"), a
// service-fit score whose every point names the fact behind it, and badges
// that each carry their reason. The requester may sort by price, pickup
// estimate or service fit; the default order is the order drivers offered,
// so there is no sponsored or unexplained default winner, and the server
// never marks an offer "recommended".

// Offer sort keys (MP_OFFER_SORTS).
const (
	OfferSortOffered    = "offered"
	OfferSortPrice      = "price"
	OfferSortPickup     = "pickup"
	OfferSortServiceFit = "service_fit"
)

// offerSortSpecs names every sort and the tie-breaks it applies.
var offerSortSpecs = []OfferSortOptionView{
	{Key: OfferSortOffered, Label: "In the order drivers offered", TieBreak: "none — earliest offer first"},
	{Key: OfferSortPrice, Label: "Lowest total first", TieBreak: "then earliest estimated pickup, then earliest offer"},
	{Key: OfferSortPickup, Label: "Earliest estimated pickup first", TieBreak: "offers without an estimate last; then lowest total, then earliest offer"},
	{Key: OfferSortServiceFit, Label: "Best service fit first", TieBreak: "then lowest total, then earliest estimated pickup, then earliest offer"},
}

// ParseOfferSort validates the snapshot's `sort` query parameter; empty is
// the neutral default.
func ParseOfferSort(raw string) (string, error) {
	if raw == "" {
		return OfferSortOffered, nil
	}
	for _, spec := range offerSortSpecs {
		if spec.Key == raw {
			return raw, nil
		}
	}
	return "", domain.Errorf(domain.CodeValidationFailed, "%q is not an offer sort", raw).
		WithDetails(map[string]any{"field": "sort", "allowed": []string{OfferSortOffered, OfferSortPrice, OfferSortPickup, OfferSortServiceFit}})
}

// SnapshotOptions shape GET /v1/mp/requests/{id}.
type SnapshotOptions struct {
	Sort string
}

// Reliability is defined, not tuned: the driver's marketplace RIDES awarded
// in the trailing window, counting only the outcomes the driver controls.
const (
	reliabilityWindowDays    = 90
	reliabilityMinimumSample = 10
	reliabilityDefinition    = "Of the marketplace rides this driver was awarded in the last 90 days that ended, the share they completed and the share they cancelled themselves. Rider cancellations, rider no-shows, declined or lapsed preferred-driver invitations and trips still under way are not counted. Shown only from 10 such rides."
)

// Reliability statuses.
const (
	ReliabilityAvailable           = "available"
	ReliabilityInsufficientHistory = "insufficient_history"
	ReliabilityUnavailable         = "unavailable"
)

// Driver card statuses on an offer (OfferDriverProfile.status).
const (
	DriverCardVerified    = "verified"
	DriverCardNotVerified = "not_verified"
	DriverCardUnavailable = "unavailable"
)

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

// OfferPickupEstimateView is an offer's pickup ESTIMATE: minute-coarsened,
// with what it was measured with and when.
type OfferPickupEstimateView struct {
	Seconds     *int       `json:"seconds"`
	Basis       string     `json:"basis"`
	Label       string     `json:"label"`
	EstimatedAt *time.Time `json:"estimatedAt"`
	Estimate    bool       `json:"estimate"`
}

// OfferVehicleView is the vehicle behind an offer: the class the server
// verified the driver eligible for, and — only from a verified card — the
// registered vehicle.
type OfferVehicleView struct {
	Class         string  `json:"class"`
	CapacitySeats *int    `json:"capacitySeats"`
	CapacityNote  string  `json:"capacityNote"`
	BodyType      *string `json:"bodyType"`
	Make          *string `json:"make"`
	Model         *string `json:"model"`
	Colour        *string `json:"colour"`
	PlateMasked   *string `json:"plateMasked"`
	Verified      bool    `json:"verified"`
}

// OfferRatingView is user-service's rating, verbatim.
type OfferRatingView struct {
	Average float64 `json:"average"`
	Count   int     `json:"count"`
}

// OfferDriverProfileView is the driver card as the requester may see it.
// Every field is null when the card is unavailable; nothing is filled in.
type OfferDriverProfileView struct {
	Status         string           `json:"status"`
	Label          string           `json:"label"`
	DisplayName    *string          `json:"displayName"`
	Initials       *string          `json:"initials"`
	PhotoRef       *string          `json:"photoRef"`
	PhotoVerified  *bool            `json:"photoVerified"`
	VerifiedAt     *string          `json:"verifiedAt"`
	Rating         *OfferRatingView `json:"rating"`
	RatingLabel    string           `json:"ratingLabel"`
	CompletedTrips *int             `json:"completedTrips"`
	MemberSince    *string          `json:"memberSince"`
	Accessibility  string           `json:"accessibility"`
}

// ReliabilityView is the defined reliability figure, or why there is none.
type ReliabilityView struct {
	Status                    string    `json:"status"`
	Definition                string    `json:"definition"`
	WindowDays                int       `json:"windowDays"`
	MinimumSample             int       `json:"minimumSample"`
	SampleSize                int       `json:"sampleSize"`
	CompletedJobs             int       `json:"completedJobs"`
	DriverCancellations       int       `json:"driverCancellations"`
	CompletionRateBps         *int      `json:"completionRateBps"`
	DriverCancellationRateBps *int      `json:"driverCancellationRateBps"`
	Label                     string    `json:"label"`
	ComputedAt                time.Time `json:"computedAt"`
}

// CriterionView is one named fact behind a service-fit point or a badge.
type CriterionView struct {
	Code  string `json:"code"`
	Label string `json:"label"`
}

// ServiceFitView is how well an offer fits what the requester asked for,
// criterion by criterion.
type ServiceFitView struct {
	Score      int             `json:"score"`
	MaxScore   int             `json:"maxScore"`
	Matched    []CriterionView `json:"matched"`
	Unmet      []CriterionView `json:"unmet"`
	Definition string          `json:"definition"`
}

// OfferSortOptionView is one sort the requester may pick.
type OfferSortOptionView struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	TieBreak string `json:"tieBreak"`
}

// OfferOrderView says which order the offers are in and which others exist.
type OfferOrderView struct {
	Sort     string                `json:"sort"`
	Label    string                `json:"label"`
	TieBreak string                `json:"tieBreak"`
	Options  []OfferSortOptionView `json:"options"`
	Note     string                `json:"note"`
}

const (
	offerOrderNote       = "No offer is sponsored and none is chosen for you: you pick the winner."
	serviceFitDefinition = "One point per criterion: driver details verified by UBI, a driver you saved, and each preference you stated that the driver's verified vehicle meets."
	totalNoteBase        = "This is the total you pay for this offer. No booking or service fee is added on top."
	totalNoteStops       = " Paid waiting at a stop is only ever added with your approval."
	capacityNote         = "Seat capacity is not published for this vehicle class."
)

// ---------------------------------------------------------------------------
// Bid pickup estimates (mp.bid_pickup_estimates)
// ---------------------------------------------------------------------------

// bidPickupEstimate is the stored pickup estimate behind one bid.
type bidPickupEstimate struct {
	PredictedSec int
	Basis        string
	DistanceM    *int
	EstimatedAt  time.Time
}

// InsertBidPickupEstimate records the eligibility evaluation's pickup
// prediction for a new bid, inside the bid's own transaction. A bid whose
// evaluation carried no prediction (an advance bid) records nothing.
func (s *Store) InsertBidPickupEstimate(ctx context.Context, tx pgx.Tx, bidID uuid.UUID, eligibility *EligibilityView, at time.Time) error {
	if eligibility == nil || eligibility.PredictedPickupSec == nil || eligibility.PredictedPickupBasis == nil {
		return nil
	}
	var distance *int
	if eligibility.pickup != nil && eligibility.pickup.distanceM >= 0 {
		coarse := int(coarsePickupMeters(eligibility.pickup.distanceM))
		distance = &coarse
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO mp.bid_pickup_estimates (bid_id, predicted_sec, basis, distance_m, estimated_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (bid_id) DO NOTHING`,
		bidID, *eligibility.PredictedPickupSec, *eligibility.PredictedPickupBasis, distance, at); err != nil {
		return fmt.Errorf("failed to record the bid's pickup estimate: %w", err)
	}
	return nil
}

// PickupEstimatesForBids reads the stored estimates of a set of bids.
func (s *Store) PickupEstimatesForBids(ctx context.Context, db DB, bidIDs []uuid.UUID) (map[uuid.UUID]*bidPickupEstimate, error) {
	out := map[uuid.UUID]*bidPickupEstimate{}
	if len(bidIDs) == 0 {
		return out, nil
	}
	rows, err := db.Query(ctx, `
		SELECT bid_id, predicted_sec, basis, distance_m, estimated_at
		FROM mp.bid_pickup_estimates WHERE bid_id = ANY($1)`, bidIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to read pickup estimates: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var estimate bidPickupEstimate
		if err := rows.Scan(&id, &estimate.PredictedSec, &estimate.Basis, &estimate.DistanceM, &estimate.EstimatedAt); err != nil {
			return nil, fmt.Errorf("failed to read pickup estimate: %w", err)
		}
		out[id] = &estimate
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Reliability
// ---------------------------------------------------------------------------

// rideOutcomes is one driver's counted marketplace ride outcomes.
type rideOutcomes struct {
	completed       int
	driverCancelled int
}

// completedRideStates are the ride states that mean the trip was done.
var completedRideStates = []string{
	machine.RiderCompleted, machine.RiderPaymentPending, machine.RiderPaymentFailed, machine.RiderRated,
}

// MarketplaceRideOutcomes counts, per driver, the marketplace rides created
// since `since` that were completed or cancelled by the driver.
func (s *Store) MarketplaceRideOutcomes(ctx context.Context, db DB, driverIDs []uuid.UUID, since time.Time) (map[uuid.UUID]rideOutcomes, error) {
	out := map[uuid.UUID]rideOutcomes{}
	if len(driverIDs) == 0 {
		return out, nil
	}
	rows, err := db.Query(ctx, `
		SELECT driver_id,
			COUNT(*) FILTER (WHERE state = ANY($3)),
			COUNT(*) FILTER (WHERE state = $4)
		FROM ride.rides
		WHERE marketplace_award_id IS NOT NULL AND driver_id = ANY($1) AND created_at >= $2
		GROUP BY driver_id`,
		driverIDs, since, completedRideStates, machine.RiderCancelledByDriver)
	if err != nil {
		return nil, fmt.Errorf("failed to count marketplace ride outcomes: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var outcome rideOutcomes
		if err := rows.Scan(&id, &outcome.completed, &outcome.driverCancelled); err != nil {
			return nil, fmt.Errorf("failed to read marketplace ride outcomes: %w", err)
		}
		out[id] = outcome
	}
	return out, rows.Err()
}

// halfUpBps is numerator/denominator in basis points, rounded half-up.
func halfUpBps(numerator, denominator int) int {
	if denominator <= 0 {
		return 0
	}
	return (numerator*20000 + denominator) / (2 * denominator)
}

// formatBpsPercent renders basis points as a percentage with one decimal.
func formatBpsPercent(bps int) string {
	tenths := (bps + 5) / 10
	return strconv.Itoa(tenths/10) + "." + strconv.Itoa(tenths%10) + "%"
}

// reliabilityOf applies the definition to one driver's counted outcomes.
func reliabilityOf(outcome rideOutcomes, computedAt time.Time) *ReliabilityView {
	sample := outcome.completed + outcome.driverCancelled
	view := &ReliabilityView{
		Definition:          reliabilityDefinition,
		WindowDays:          reliabilityWindowDays,
		MinimumSample:       reliabilityMinimumSample,
		SampleSize:          sample,
		CompletedJobs:       outcome.completed,
		DriverCancellations: outcome.driverCancelled,
		ComputedAt:          computedAt,
	}
	if sample < reliabilityMinimumSample {
		view.Status = ReliabilityInsufficientHistory
		view.Label = "Not enough history yet"
		return view
	}
	cancelled := halfUpBps(outcome.driverCancelled, sample)
	completed := 10_000 - cancelled
	view.Status = ReliabilityAvailable
	view.CompletionRateBps = &completed
	view.DriverCancellationRateBps = &cancelled
	view.Label = "Completed " + strconv.Itoa(outcome.completed) + " of " + strconv.Itoa(sample) +
		" marketplace rides in 90 days · " + formatBpsPercent(cancelled) + " cancelled by the driver"
	return view
}

// unavailableReliability says the figure could not be computed right now.
func unavailableReliability(computedAt time.Time) *ReliabilityView {
	return &ReliabilityView{
		Status:        ReliabilityUnavailable,
		Definition:    reliabilityDefinition,
		WindowDays:    reliabilityWindowDays,
		MinimumSample: reliabilityMinimumSample,
		Label:         "Reliability unavailable right now",
		ComputedAt:    computedAt,
	}
}

// reliabilityFor computes the defined reliability for a set of drivers. A
// read failure renders "unavailable", never a guess.
func (s *Service) reliabilityFor(ctx context.Context, driverIDs []uuid.UUID, now time.Time) map[uuid.UUID]*ReliabilityView {
	out := make(map[uuid.UUID]*ReliabilityView, len(driverIDs))
	since := now.AddDate(0, 0, -reliabilityWindowDays)
	outcomes, err := s.deps.Store.MarketplaceRideOutcomes(ctx, s.deps.Store.Pool(), driverIDs, since)
	for _, id := range driverIDs {
		if err != nil {
			out[id] = unavailableReliability(now)
			continue
		}
		out[id] = reliabilityOf(outcomes[id], now)
	}
	if err != nil {
		s.deps.Logger.Warn().Err(err).Msg("driver reliability unavailable for an offer view")
	}
	return out
}

// ---------------------------------------------------------------------------
// The driver display (one function for offers, winner, queue and bookings)
// ---------------------------------------------------------------------------

// formatRating renders user-service's average for the legacy string field.
func formatRating(average float64) string {
	return strconv.FormatFloat(average, 'f', 2, 64)
}

// offerDriverProfileViewOf renders the driver card. No card (user-service
// unconfigured, down, or non-disclosing) is one honest "unavailable".
func offerDriverProfileViewOf(profile *DriverProfile) *OfferDriverProfileView {
	view := &OfferDriverProfileView{
		Status:        DriverCardUnavailable,
		Label:         "Driver details unavailable",
		RatingLabel:   "Rating unavailable",
		Accessibility: AccessibilityUnavailable,
	}
	if profile == nil || !profile.Available {
		return view
	}
	view.Status = DriverCardNotVerified
	view.Label = "Driver checks not complete"
	if profile.Verified() {
		view.Status = DriverCardVerified
		view.Label = "Verified by UBI"
	}
	view.DisplayName = profile.DisplayName
	view.Initials = profile.Initials
	if profile.Photo != nil {
		ref, verified := profile.Photo.Ref, profile.Photo.Verified
		view.PhotoRef = &ref
		view.PhotoVerified = &verified
	}
	view.VerifiedAt = profile.Verification.VerifiedAt
	if profile.Rating != nil {
		view.Rating = &OfferRatingView{Average: profile.Rating.Average, Count: profile.Rating.Count}
		noun := " ratings"
		if profile.Rating.Count == 1 {
			noun = " rating"
		}
		view.RatingLabel = formatRating(profile.Rating.Average) + " from " + strconv.Itoa(profile.Rating.Count) + noun
	} else {
		view.RatingLabel = "No ratings yet"
	}
	trips := profile.CompletedTrips
	view.CompletedTrips = &trips
	since := profile.MemberSince
	view.MemberSince = &since
	view.Accessibility = profile.AccessibilityStatus
	return view
}

// offerVehicleViewOf renders the vehicle: the verified class always, the
// registered vehicle only from a verified card.
func offerVehicleViewOf(vehicleClass string, profile *DriverProfile) *OfferVehicleView {
	view := &OfferVehicleView{Class: vehicleClass, CapacityNote: capacityNote}
	if profile.Verified() && profile.Vehicle != nil {
		body, plate := profile.Vehicle.Type, profile.Vehicle.PlateMasked
		view.BodyType = &body
		view.Make = profile.Vehicle.Make
		view.Model = profile.Vehicle.Model
		view.Colour = profile.Vehicle.Colour
		view.PlateMasked = &plate
		view.Verified = true
	}
	return view
}

// driverDisplayFor resolves one driver's card and renders the legacy
// display fields from it — the single path the queue and booking projections
// use, so a driver renders the same way everywhere.
func (s *Service) driverDisplayFor(ctx context.Context, driverID uuid.UUID, vehicleClass string) OfferDriverView {
	profiles := s.driverProfilesFor(ctx, []uuid.UUID{driverID})
	return verifiedDriverView(driverID.String(), vehicleClass, profiles[driverID])
}

// withVerifiedDriver swaps a rider's booking view's placeholder driver for
// the profile-backed display (a driver's own view carries no driver block).
func (s *Service) withVerifiedDriver(ctx context.Context, view *AdvanceBookingView, b *AdvanceBooking, vehicleClass string) *AdvanceBookingView {
	if view == nil || view.Driver == nil {
		return view
	}
	driver := s.driverDisplayFor(ctx, b.DriverID, vehicleClass)
	view.Driver = &driver
	return view
}

// ---------------------------------------------------------------------------
// Offer comparison assembly
// ---------------------------------------------------------------------------

// offerContext is everything the snapshot loads once for all its offers.
type offerContext struct {
	profiles    map[uuid.UUID]*DriverProfile
	estimates   map[uuid.UUID]*bidPickupEstimate
	reliability map[uuid.UUID]*ReliabilityView
	favourites  map[uuid.UUID]bool
	needs       *ServiceNeeds
	now         time.Time
}

// loadOfferContext batch-loads the comparison inputs for a request's bids.
// Every input degrades to "unavailable" on its own: an offer view is never
// refused because a comparison input could not be read.
func (s *Service) loadOfferContext(ctx context.Context, request *Request, bids []*Bid, now time.Time) *offerContext {
	oc := &offerContext{now: now}
	driverIDs := make([]uuid.UUID, 0, len(bids))
	bidIDs := make([]uuid.UUID, 0, len(bids))
	seen := map[uuid.UUID]bool{}
	for _, bid := range bids {
		bidIDs = append(bidIDs, bid.ID)
		if !seen[bid.DriverID] {
			seen[bid.DriverID] = true
			driverIDs = append(driverIDs, bid.DriverID)
		}
	}
	oc.profiles = s.driverProfilesFor(ctx, driverIDs)
	oc.reliability = s.reliabilityFor(ctx, driverIDs, now)
	pool := s.deps.Store.Pool()
	var err error
	if oc.estimates, err = s.deps.Store.PickupEstimatesForBids(ctx, pool, bidIDs); err != nil {
		s.deps.Logger.Warn().Err(err).Msg("pickup estimates unavailable for an offer view")
		oc.estimates = map[uuid.UUID]*bidPickupEstimate{}
	}
	if oc.favourites, err = s.deps.Store.ActiveFavouriteDrivers(ctx, pool, request.RequesterID, driverIDs); err != nil {
		s.deps.Logger.Warn().Err(err).Msg("saved drivers unavailable for an offer view")
		oc.favourites = map[uuid.UUID]bool{}
	}
	if oc.needs, err = s.requestServiceNeeds(ctx, request.ID); err != nil {
		s.deps.Logger.Warn().Err(err).Msg("service needs unavailable for an offer view")
		oc.needs = nil
	}
	return oc
}

// pickupEstimateOf phrases an offer's pickup estimate: the stored
// eligibility prediction when there is one, else the live straight-line
// estimate the pickup label was built from, else unavailable.
func pickupEstimateOf(kind string, stored *bidPickupEstimate, liveSec *int, pickupLabel string) *OfferPickupEstimateView {
	switch {
	case kind == OfferKindAdvanceBooking:
		return &OfferPickupEstimateView{Basis: "advance_booking", Label: pickupLabel, Estimate: true}
	case stored != nil:
		seconds := stored.PredictedSec
		at := stored.EstimatedAt
		minutes := ceilMinutes(seconds)
		label := "Estimated pickup in ~" + itoa(minutes) + " min"
		if stored.Basis == PickupBasisFinishingTrip {
			label += ", after the driver finishes a trip"
		}
		return &OfferPickupEstimateView{Seconds: &seconds, Basis: stored.Basis, Label: label, EstimatedAt: &at, Estimate: true}
	case liveSec != nil:
		seconds := *liveSec
		return &OfferPickupEstimateView{
			Seconds: &seconds, Basis: PickupBasisStraightLineETA,
			Label:    "Estimated pickup in ~" + itoa(ceilMinutes(seconds)) + " min (straight-line estimate)",
			Estimate: true,
		}
	default:
		return &OfferPickupEstimateView{Basis: PickupBasisUnavailable, Label: "Pickup estimate unavailable", Estimate: true}
	}
}

// serviceFitOf scores one offer against what the requester asked for.
func serviceFitOf(profile *DriverProfile, saved bool, needs *ServiceNeeds) *ServiceFitView {
	view := &ServiceFitView{Matched: []CriterionView{}, Unmet: []CriterionView{}, Definition: serviceFitDefinition}
	criterion := func(met bool, code, metLabel, unmetLabel string) {
		view.MaxScore++
		if met {
			view.Score++
			view.Matched = append(view.Matched, CriterionView{Code: code, Label: metLabel})
			return
		}
		view.Unmet = append(view.Unmet, CriterionView{Code: code, Label: unmetLabel})
	}
	criterion(profile.Verified(), "verified_details", "Driver details verified by UBI", "Driver details not verified")
	criterion(saved, "saved_driver", "A driver you saved", "Not a driver you saved")
	if needs != nil {
		for _, code := range needs.Preferences {
			spec, ok := preferenceByCode(code)
			if !ok {
				continue
			}
			met := profile.Verified() && profile.Vehicle != nil && spec.bodyTypes[profile.Vehicle.Type]
			criterion(met, "preference:"+code, spec.title+": verified vehicle meets it", spec.title+": not confirmed by a verified vehicle")
		}
	}
	return view
}

// comparisonTotal is the amount the requester pays for an offer.
func comparisonTotal(offer *OfferView) int64 {
	if offer.TotalMinor != nil {
		return offer.TotalMinor.AmountMinor
	}
	return offer.AmountMinor.AmountMinor
}

func pickupSecondsOf(offer *OfferView) (int, bool) {
	if offer.PickupEstimate == nil || offer.PickupEstimate.Seconds == nil {
		return 0, false
	}
	return *offer.PickupEstimate.Seconds, true
}

// applyBadges marks, among a list's selectable offers, the lowest total and
// the earliest estimated pickup — each badge with its reason, and only when
// there is something to compare (two or more offers that differ).
func applyBadges(offers []*OfferView) {
	var live []*OfferView
	for _, offer := range offers {
		if !offer.Withdrawn {
			live = append(live, offer)
		}
	}
	count := strconv.Itoa(len(live))
	if len(live) >= 2 {
		lowest, highest := comparisonTotal(live[0]), comparisonTotal(live[0])
		for _, offer := range live[1:] {
			if total := comparisonTotal(offer); total < lowest {
				lowest = total
			} else if total > highest {
				highest = total
			}
		}
		if lowest != highest {
			for _, offer := range live {
				if comparisonTotal(offer) == lowest {
					offer.Badges = append(offer.Badges, CriterionView{Code: "lowest_total", Label: "Lowest total of " + count + " offers"})
				}
			}
		}
		earliest, latest, known := 0, 0, 0
		for _, offer := range live {
			seconds, ok := pickupSecondsOf(offer)
			if !ok {
				continue
			}
			if known == 0 || seconds < earliest {
				earliest = seconds
			}
			if known == 0 || seconds > latest {
				latest = seconds
			}
			known++
		}
		if known >= 2 && earliest != latest {
			for _, offer := range live {
				if seconds, ok := pickupSecondsOf(offer); ok && seconds == earliest {
					offer.Badges = append(offer.Badges, CriterionView{Code: "earliest_pickup", Label: "Earliest estimated pickup of " + count + " offers"})
				}
			}
		}
	}
}

// sortOffers orders a list per the requested sort; the snapshot's lists come
// in offered (created) order, which every tie-break falls back to.
func sortOffers(offers []*OfferView, key string) {
	position := make(map[*OfferView]int, len(offers))
	for i, offer := range offers {
		position[offer] = i
	}
	byPickup := func(a, b *OfferView) (bool, bool) {
		as, aok := pickupSecondsOf(a)
		bs, bok := pickupSecondsOf(b)
		switch {
		case aok && !bok:
			return true, true
		case !aok && bok:
			return false, true
		case aok && bok && as != bs:
			return as < bs, true
		}
		return false, false
	}
	byTotal := func(a, b *OfferView) (bool, bool) {
		at, bt := comparisonTotal(a), comparisonTotal(b)
		if at != bt {
			return at < bt, true
		}
		return false, false
	}
	byFit := func(a, b *OfferView) (bool, bool) {
		as, bs := 0, 0
		if a.ServiceFit != nil {
			as = a.ServiceFit.Score
		}
		if b.ServiceFit != nil {
			bs = b.ServiceFit.Score
		}
		if as != bs {
			return as > bs, true
		}
		return false, false
	}
	var chain []func(a, b *OfferView) (bool, bool)
	switch key {
	case OfferSortPrice:
		chain = append(chain, byTotal, byPickup)
	case OfferSortPickup:
		chain = append(chain, byPickup, byTotal)
	case OfferSortServiceFit:
		chain = append(chain, byFit, byTotal, byPickup)
	default:
		return
	}
	sort.SliceStable(offers, func(i, j int) bool {
		for _, compare := range chain {
			if less, decided := compare(offers[i], offers[j]); decided {
				return less
			}
		}
		return position[offers[i]] < position[offers[j]]
	})
}

// offerOrderViewOf describes the order a snapshot's offers are in.
func offerOrderViewOf(key string) *OfferOrderView {
	view := &OfferOrderView{Sort: key, Options: offerSortSpecs, Note: offerOrderNote}
	for _, spec := range offerSortSpecs {
		if spec.Key == key {
			view.Label = spec.Label
			view.TieBreak = spec.TieBreak
		}
	}
	return view
}

// totalNoteFor is the one sentence that says what the total includes.
func totalNoteFor(request *Request) string {
	if len(request.Stops) > 0 {
		return totalNoteBase + totalNoteStops
	}
	return totalNoteBase
}

// totalLabelFor phrases the total the requester pays. With the currency's
// fraction digits unknown (negative) there is no honest phrasing: the label
// is left off (omitted from the offer) and the client shows totalMinor's
// own formatting only.
func totalLabelFor(total int64, currency string, digits int) string {
	if digits < 0 {
		return ""
	}
	return "You pay " + strings.TrimSpace(formatMinor(total, currency, digits))
}
