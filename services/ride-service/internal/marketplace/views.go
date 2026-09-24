package marketplace

import (
	"fmt"
	"strings"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// BreakdownRowView is one labelled component of a suggested fare as clients
// see it: the amount is a Money object per the contract. (The stored
// BreakdownRow keeps its compact shape; only the view is Money-shaped.)
type BreakdownRowView struct {
	Label       string `json:"label"`
	AmountMinor Money  `json:"amountMinor"`
}

// QuoteEnvelopeView answers GET /v1/mp/quote (MpQuoteEnvelopeSchema).
type QuoteEnvelopeView struct {
	QuoteID              string             `json:"quoteId"`
	Service              string             `json:"service"`
	VehicleClass         string             `json:"vehicleClass"`
	CityID               string             `json:"cityId"`
	Currency             string             `json:"currency"`
	SuggestedFareMinor   Money              `json:"suggestedFareMinor"`
	MinimumFareMinor     Money              `json:"minimumFareMinor"`
	MaximumFareMinor     Money              `json:"maximumFareMinor"`
	ExpiresAt            time.Time          `json:"expiresAt"`
	PricingVersion       string             `json:"pricingVersion"`
	PolicyVersion        int                `json:"policyVersion"`
	Breakdown            []BreakdownRowView `json:"breakdown"`
	RoutedDistanceMeters int64              `json:"routedDistanceMeters"`
	RoutedDurationSec    int64              `json:"routedDurationSec"`
	// Multi-stop only (omitted for a plain route): the ordered stops priced,
	// their total expected dwell (priced as time), and the route fingerprint
	// the bounds belong to.
	Stops            []RouteStop `json:"stops,omitempty"`
	StopsDwellSec    int64       `json:"stopsDwellSec,omitempty"`
	RouteFingerprint string      `json:"routeFingerprint,omitempty"`
	// Business is present only when the quote asked about an organization
	// (A06 part C): the organization's advisory verdict at the suggested
	// fare — an out-of-policy or unfunded option is never shown bookable.
	Business *BusinessQuoteView `json:"business,omitempty"`
}

// SearchEnvelopeView is the request's current search envelope.
type SearchEnvelopeView struct {
	Step         int `json:"step"`
	RadiusMeters int `json:"radiusMeters"`
	PickupEtaSec int `json:"pickupEtaSec"`
}

// RequestView is the owner's view of a request (MpRequestSchema).
type RequestView struct {
	RequestID          string             `json:"requestId"`
	State              string             `json:"state"`
	Revision           int                `json:"revision"`
	Version            int                `json:"version"`
	Service            string             `json:"service"`
	VehicleClass       string             `json:"vehicleClass"`
	CityID             string             `json:"cityId"`
	Currency           string             `json:"currency"`
	RequesterID        string             `json:"requesterId"`
	QuoteID            string             `json:"quoteId"`
	RequestedFareMinor Money              `json:"requestedFareMinor"`
	SuggestedFareMinor Money              `json:"suggestedFareMinor"`
	MinimumFareMinor   Money              `json:"minimumFareMinor"`
	MaximumFareMinor   Money              `json:"maximumFareMinor"`
	Pickup             Area               `json:"pickup"`
	Dropoff            Area               `json:"dropoff"`
	Delivery           map[string]any     `json:"delivery"`
	SearchEnvelope     SearchEnvelopeView `json:"searchEnvelope"`
	PolicyVersion      int                `json:"policyVersion"`
	PricingVersion     string             `json:"pricingVersion"`
	ExpiresAt          time.Time          `json:"expiresAt"`
	CreatedAt          time.Time          `json:"createdAt"`
	CloseReason        *string            `json:"closeReason"`
	// Present only for a request that carries (or carried) intermediate
	// stops, so a plain request renders exactly as before: the owner's
	// ordered stops (exact — this is their own trip), the route revision and
	// the fingerprint of the route the current bounds were priced for.
	Stops            []RouteStop `json:"stops,omitempty"`
	RouteRevision    int         `json:"routeRevision,omitempty"`
	RouteFingerprint string      `json:"routeFingerprint,omitempty"`
	// Booking is present only on a scheduled or advance-booking request
	// (A03): its future pickup window and whether a driver is secured.
	Booking *RequestBookingView `json:"booking,omitempty"`
	// PreferredDriver is present only on a request that named a saved driver
	// (A04 item 3): the exclusive window and what happens when it ends.
	PreferredDriver *PreferredDriverView `json:"preferredDriver,omitempty"`
	// ServiceNeeds is present only when the requester stated needs (A06 D).
	ServiceNeeds *ServiceNeeds `json:"serviceNeeds,omitempty"`
	// Passenger is present only when the requester booked for another adult
	// (A06 part B), and only on the requester's own view of this request.
	Passenger *RequestPassengerView `json:"passenger,omitempty"`
	// Business is present only on a request booked on an organization (A06
	// part C), and only on the requester's own view: the payer, the booking
	// terms and where the organization's funding stands.
	Business *RequestBusinessView `json:"business,omitempty"`
}

func requestViewOf(request *Request) *RequestView {
	var closeReason *string
	if request.CloseReason != "" {
		reason := request.CloseReason
		closeReason = &reason
	}
	view := &RequestView{
		RequestID:          request.ID.String(),
		State:              request.State,
		Revision:           request.Revision,
		Version:            request.Version,
		Service:            request.Service,
		VehicleClass:       request.VehicleClass,
		CityID:             request.CityID,
		Currency:           request.Currency,
		RequesterID:        request.RequesterID.String(),
		QuoteID:            request.QuoteID.String(),
		RequestedFareMinor: money(request.RequestedMinor, request.Currency),
		SuggestedFareMinor: money(request.SuggestedMinor, request.Currency),
		MinimumFareMinor:   money(request.MinMinor, request.Currency),
		MaximumFareMinor:   money(request.MaxMinor, request.Currency),
		Pickup:             request.Pickup,
		Dropoff:            request.Dropoff,
		Delivery:           request.Delivery,
		SearchEnvelope: SearchEnvelopeView{
			Step:         request.EnvelopeStep,
			RadiusMeters: request.EnvelopeRadiusM,
			PickupEtaSec: request.EnvelopeEtaSec,
		},
		PolicyVersion:  request.PolicyVersion,
		PricingVersion: request.PricingVersion,
		ExpiresAt:      request.ExpiresAt,
		CreatedAt:      request.CreatedAt,
		CloseReason:    closeReason,
	}
	if request.hasRoute() {
		view.Stops = request.Stops
		view.RouteRevision = request.RouteRevision
		view.RouteFingerprint = request.RouteFingerprint
	}
	view.Booking = requestBookingViewOf(request)
	return view
}

// The client-facing hold-state vocabulary (MpBidDto.holdState). This is the
// D06 rule made explicit: `released` is stated ONLY once the wallet CONFIRMED
// the release; until then a terminal bid renders release_pending. A live bid
// — and a won/selected bid, whose reservation was or will be captured as the
// commission — renders `held`: the money is encumbered either way, and the
// honest capture story belongs to the receipt, not this one-word gauge.
const (
	HoldStateHeld           = "held"
	HoldStateReleasePending = "release_pending"
	HoldStateReleased       = "released"
)

// BidView is the driver's own bid (MpBidSchema): their money, only theirs.
type BidView struct {
	BidID            string    `json:"bidId"`
	RequestID        string    `json:"requestId"`
	RequestRevision  int       `json:"requestRevision"`
	BidVersion       int       `json:"bidVersion"`
	State            string    `json:"state"`
	DriverID         string    `json:"driverId"`
	AmountMinor      Money     `json:"amountMinor"`
	CommissionMinor  Money     `json:"commissionMinor"`
	NetMinor         Money     `json:"netMinor"`
	Slot             string    `json:"slot"`
	DependsOnClaimID *string   `json:"dependsOnClaimId"`
	ReservationID    string    `json:"reservationId"`
	HoldState        string    `json:"holdState"`
	ExpiresAt        time.Time `json:"expiresAt"`
	CreatedAt        time.Time `json:"createdAt"`
	// AdvanceCommitment restates, on an advance bid (A03), the wallet
	// commitment the driver took on: held now, captured once at the advance
	// award, never charged again at activation.
	AdvanceCommitment *AdvanceCommitmentView `json:"advanceCommitment,omitempty"`
}

// holdStateFor maps a bid row to the honest client vocabulary. Live and
// won/captured bids read `held`; a terminal bid reads `released` only when
// the release was financially confirmed (bid.HoldReleasedAt), otherwise
// `release_pending` — an unresolved recovery row or an in-flight release must
// never be dressed up as done.
func holdStateFor(bid *Bid) string {
	switch {
	case machine.IsMpBidLive(bid.State), bid.State == machine.MpBidWon:
		return HoldStateHeld
	case bid.HoldReleasedAt != nil:
		return HoldStateReleased
	default:
		return HoldStateReleasePending
	}
}

func bidViewOf(bid *Bid, currency string) *BidView {
	var dependsOn *string
	if bid.DependsOnClaimID != nil {
		claim := bid.DependsOnClaimID.String()
		dependsOn = &claim
	}
	return &BidView{
		BidID:            bid.ID.String(),
		RequestID:        bid.RequestID.String(),
		RequestRevision:  bid.RequestRevision,
		BidVersion:       bid.BidVersion,
		State:            bid.State,
		DriverID:         bid.DriverID.String(),
		AmountMinor:      money(bid.AmountMinor, currency),
		CommissionMinor:  money(bid.CommissionMinor, currency),
		NetMinor:         money(bid.NetMinor, currency),
		Slot:             bid.Slot,
		DependsOnClaimID: dependsOn,
		ReservationID:    bid.ReservationID,
		HoldState:        holdStateFor(bid),
		ExpiresAt:        bid.ExpiresAt,
		CreatedAt:        bid.CreatedAt,
	}
}

// OfferDriverView is what a requester may know about a bidding driver:
// display fields only, never rival prices, never another bidder's identity.
//
// ProfileStatus is the G09 honesty gate. Verified driver identity (real name,
// plate, photo, rating and completed-trip history) is owned by user-service
// and resolved through the driver-profile port (driverprofiles.go; see
// docs/marketplace/DRIVER_IDENTITY.md). ProfileStatus is "verified" only when
// user-service returned a card whose verification status is "verified";
// otherwise it is "unavailable" and Rating/CompletedTrips are placeholders a
// client must not present as real. Vehicle is always server-verified: it is
// the class the driver is eligible for and bidding on.
type OfferDriverView struct {
	DisplayName    string `json:"displayName"`
	Initials       string `json:"initials"`
	Rating         string `json:"rating"`
	CompletedTrips int    `json:"completedTrips"`
	Vehicle        string `json:"vehicle"`
	PlateMasked    string `json:"plateMasked"`
	ProfileStatus  string `json:"profileStatus"`
}

// Driver profile availability (contract OfferDriver.profileStatus).
const (
	ProfileStatusVerified    = "verified"
	ProfileStatusUnavailable = "unavailable"
)

// OfferView is the rider-facing view of one bid (MpOfferSchema).
type OfferView struct {
	BidID           string          `json:"bidId"`
	BidVersion      int             `json:"bidVersion"`
	RequestRevision int             `json:"requestRevision"`
	AmountMinor     Money           `json:"amountMinor"`
	Kind            string          `json:"kind"`
	Driver          OfferDriverView `json:"driver"`
	PickupLabel     string          `json:"pickupLabel"`
	PickupWindow    *PickupWindow   `json:"pickupWindow"`
	ExpiresAt       time.Time       `json:"expiresAt"`
	Withdrawn       bool            `json:"withdrawn"`
	WhyRecommended  *string         `json:"whyRecommended"`

	// Offer comparison (A06 part A), all server-computed: what the rider
	// pays (the offered fare; the marketplace adds no booking fee on top),
	// the pickup ESTIMATE, the vehicle, the verified driver card, the
	// defined reliability figure, the service fit and reasoned badges.
	BookingFeeMinor *Money                   `json:"bookingFeeMinor,omitempty"`
	TotalMinor      *Money                   `json:"totalMinor,omitempty"`
	TotalLabel      string                   `json:"totalLabel,omitempty"`
	TotalNote       string                   `json:"totalNote,omitempty"`
	PickupEstimate  *OfferPickupEstimateView `json:"pickupEstimate,omitempty"`
	Vehicle         *OfferVehicleView        `json:"vehicle,omitempty"`
	DriverProfile   *OfferDriverProfileView  `json:"driverProfile,omitempty"`
	Reliability     *ReliabilityView         `json:"reliability,omitempty"`
	ServiceFit      *ServiceFitView          `json:"serviceFit,omitempty"`
	Badges          []CriterionView          `json:"badges,omitempty"`
}

// PickupWindow is a finishing-trip offer's predicted pickup window.
type PickupWindow struct {
	EarliestSec int `json:"earliestSec"`
	LatestSec   int `json:"latestSec"`
	EtaVersion  int `json:"etaVersion"`
}

// RequestSnapshotView answers GET /v1/mp/requests/{id}. An advance-booking
// request's offers (A03) are listed under advanceOffers, never under offers:
// they are bids on a future pickup window, not transport now, so a client
// that only knows the live offer kinds never renders one as a live pickup.
type RequestSnapshotView struct {
	Request       *RequestView `json:"request"`
	Offers        []*OfferView `json:"offers"`
	AdvanceOffers []*OfferView `json:"advanceOffers,omitempty"`
	Award         *AwardView   `json:"award,omitempty"`
	Seq           int          `json:"seq"`
	// OfferOrder says which order the offers are in (A06 part A): the
	// neutral offered order unless the requester asked for another.
	OfferOrder *OfferOrderView `json:"offerOrder,omitempty"`
}

// ExecutionRefView names the execution an award handed off to, exactly as the
// contract's Award.executionRef documents it: {service, id}.
type ExecutionRefView struct {
	Service string `json:"service"`
	ID      string `json:"id"`
}

// AwardView is the award as clients converge on it (MpAwardSchema): the
// answer of POST .../select (202, pending) and of GET .../award until the saga
// resolves it one way or the other.
type AwardView struct {
	AwardID         string            `json:"awardId"`
	RequestID       string            `json:"requestId"`
	BidID           string            `json:"bidId"`
	State           string            `json:"state"`
	RequestVersion  int               `json:"requestVersion"`
	BidVersion      int               `json:"bidVersion"`
	DriverID        string            `json:"driverId"`
	RequesterID     string            `json:"requesterId"`
	FareMinor       Money             `json:"fareMinor"`
	CommissionMinor Money             `json:"commissionMinor"`
	Slot            string            `json:"slot"`
	ExecutionRef    *ExecutionRefView `json:"executionRef,omitempty"`
	PickupWindow    *PickupWindow     `json:"pickupWindow,omitempty"`
	FailReason      *string           `json:"failReason,omitempty"`
	CreatedAt       time.Time         `json:"createdAt"`
	ResolvedAt      *time.Time        `json:"resolvedAt"`
}

func awardViewOf(award *Award, currency string) *AwardView {
	view := &AwardView{
		AwardID:         award.ID.String(),
		RequestID:       award.RequestID.String(),
		BidID:           award.BidID.String(),
		State:           award.State,
		RequestVersion:  award.RequestVersion,
		BidVersion:      award.BidVersion,
		DriverID:        award.DriverID.String(),
		RequesterID:     award.RequesterID.String(),
		FareMinor:       money(award.FareMinor, currency),
		CommissionMinor: money(award.CommissionMinor, currency),
		Slot:            award.Slot,
		CreatedAt:       award.CreatedAt,
		ResolvedAt:      award.ResolvedAt,
	}
	if award.ExecutionID != nil {
		service := award.ExecutionService
		if service == "" {
			service = ServiceRide
		}
		view.ExecutionRef = &ExecutionRefView{Service: service, ID: award.ExecutionID.String()}
	}
	if award.PickupWindow != nil {
		view.PickupWindow = &PickupWindow{
			EarliestSec: award.PickupWindow.EarliestSec,
			LatestSec:   award.PickupWindow.LatestSec,
			EtaVersion:  award.PickupWindow.EtaVersion,
		}
	}
	if award.FailReason != "" {
		reason := award.FailReason
		view.FailReason = &reason
	}
	return view
}

// FeedItemView is one privacy-limited feed card (MpFeedItemSchema).
type FeedItemView struct {
	RequestID       string    `json:"requestId"`
	Revision        int       `json:"revision"`
	Service         string    `json:"service"`
	Title           string    `json:"title"`
	Meta            string    `json:"meta"`
	AskedMinor      Money     `json:"askedMinor"`
	AskedByLabel    string    `json:"askedByLabel"`
	CapabilityBadge *string   `json:"capabilityBadge"`
	ExpiresAt       time.Time `json:"expiresAt"`
	// Route is the multi-stop summary (omitted for a plain route): stop
	// count, coarse stop areas and the full route's distance/duration/dwell.
	Route *FeedRouteView `json:"route,omitempty"`
	// Earnings is the server-composed breakdown at the requester's published
	// fare (A04.1): gross, 10% commission, fleet remittance (none), net, the
	// unpaid pickup (coarsened, estimated), the paid route and stop waiting.
	Earnings *EarningsBreakdownView `json:"earnings"`
	// PreferenceTags are the driver's own preference matches (e.g.
	// "homeward"); omitted when there are none.
	PreferenceTags []string `json:"preferenceTags,omitempty"`
	// Booking marks an advance-booking card (A03): a FUTURE pickup window,
	// not an immediate job. Omitted for immediate requests.
	Booking *RequestBookingView `json:"booking,omitempty"`
	// PreferredRequest marks a request a rider asked THIS driver first on
	// (A04 item 3), with the window and the free-decline note. Omitted
	// otherwise; no other driver ever sees such a card while it is exclusive.
	PreferredRequest *PreferredInvitationView `json:"preferredRequest,omitempty"`
}

// FeedPageView answers GET /v1/mp/feed.
type FeedPageView struct {
	Items             []*FeedItemView `json:"items"`
	NextCursor        *string         `json:"nextCursor"`
	AvailabilityEpoch int64           `json:"availabilityEpoch"`
	// Preferences says whether the driver's preferences shaped this page and
	// how many requests they hid (A04.2).
	Preferences *FeedPreferencesView `json:"preferences,omitempty"`
}

// EligibilityReasonView is one machine-readable reason with its human words.
type EligibilityReasonView struct {
	Code   string `json:"code"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

// EligibilityView is the single server-owned eligibility answer
// (MpEligibilitySchema). The driver app renders it verbatim; it never
// computes eligibility locally.
type EligibilityView struct {
	Eligible          bool                    `json:"eligible"`
	Slot              *string                 `json:"slot"`
	Reasons           []EligibilityReasonView `json:"reasons"`
	PolicyVersion     int                     `json:"policyVersion"`
	AvailabilityEpoch int64                   `json:"availabilityEpoch"`
	EvaluatedAt       time.Time               `json:"evaluatedAt"`

	// PredictedPickupSec is the server's time-until-pickup ESTIMATE for an
	// eligible driver (null otherwise), rounded up to the whole minute so it
	// cannot triangulate the pickup: the routed leg on the immediate branch
	// (basis routed_leg); on the finishing-trip branch the remaining service
	// time + completion buffer + the post-dropoff leg + uncertainty buffer
	// (basis finishing_trip_prediction).
	PredictedPickupSec   *int    `json:"predictedPickupSec"`
	PredictedPickupBasis *string `json:"predictedPickupBasis"`

	// pickup is the measured UNPAID pickup leg behind that prediction (the
	// whole leg on the immediate branch, only the post-dropoff hop on the
	// finishing-trip branch): the driver view's earnings breakdown input.
	pickup *pickupEstimate
}

// PresetView is one server-generated quick offer (MpPresetSchema).
type PresetView struct {
	Key             string  `json:"key"`
	AmountMinor     Money   `json:"amountMinor"`
	CommissionMinor Money   `json:"commissionMinor"`
	NetMinor        Money   `json:"netMinor"`
	Title           string  `json:"title"`
	FeeNetLabel     string  `json:"feeNetLabel"`
	Affordable      bool    `json:"affordable"`
	ShortfallMinor  *Money  `json:"shortfallMinor,omitempty"`
	ShortfallLabel  *string `json:"shortfallLabel"`
	Emphasized      bool    `json:"emphasized"`
	Source          string  `json:"source"`
	// Earnings is the same server-composed breakdown as the card's, at THIS
	// preset's amount (A04.1).
	Earnings *EarningsBreakdownView `json:"earnings"`
}

// DriverViewResult answers GET /v1/mp/requests/{id}/driver-view.
// currentClaimId is the driver's current work claim — the mandatory
// dependsOnClaimId for a next-slot bid — or null when none exists.
type DriverViewResult struct {
	Item          *FeedItemView    `json:"item"`
	Eligibility   *EligibilityView `json:"eligibility"`
	Presets       []*PresetView    `json:"presets"`
	ProfileLine   *string          `json:"profileLine,omitempty"`
	CeilingNotice *string          `json:"ceilingNotice,omitempty"`
	// PreferenceNotice explains a preference this request cannot meet (the
	// driver opened it directly although their feed would hide it).
	PreferenceNotice *string  `json:"preferenceNotice,omitempty"`
	MyBid            *BidView `json:"myBid,omitempty"`
	CurrentClaimID   *string  `json:"currentClaimId"`
	// AdvanceCommitment explains, BEFORE an advance bid (A03), what bidding
	// commits the driver's wallet to at the requester's asked fare.
	AdvanceCommitment *AdvanceCommitmentView `json:"advanceCommitment,omitempty"`
	// PreferredRequest is present when a rider asked this driver first
	// (A04 item 3): offer through the ordinary presets, or decline for free.
	PreferredRequest *PreferredInvitationView `json:"preferredRequest,omitempty"`
}

// ParkedAckView answers POST /v1/mp/driver/parked: the state the SERVER
// acknowledges — a parked attestation over moving telemetry answers moving,
// one over stale telemetry answers stale_location — which the client adopts.
type ParkedAckView struct {
	State             string    `json:"state"`
	AvailabilityEpoch int64     `json:"availabilityEpoch"`
	ConfirmedAt       time.Time `json:"confirmedAt"`
	ExpiresAt         time.Time `json:"expiresAt"`
	TTLSeconds        int       `json:"ttlSeconds"`
}

// DriverJobView is one claims-projection row (contract DriverJob): the
// driver's current or queued job with its money and execution reference.
type DriverJobView struct {
	ClaimID string `json:"claimId"`
	// RequestID is the award's marketplace request: the key of the trip,
	// stop and amendment routes (/v1/mp/requests/{id}/...) the driver app
	// opens from this card. Absent only for a claim with no award.
	RequestID       string            `json:"requestId,omitempty"`
	Slot            string            `json:"slot"`
	Service         string            `json:"service"`
	State           string            `json:"state"`
	FareMinor       Money             `json:"fareMinor"`
	CommissionMinor Money             `json:"commissionMinor"`
	ReceiptID       *string           `json:"receiptId,omitempty"`
	ExecutionRef    *ExecutionRefView `json:"executionRef,omitempty"`
	PickupWindow    *PickupWindow     `json:"pickupWindow,omitempty"`
	// Passenger is set when the requester booked this trip for another
	// adult (A06 part B): the passenger's FIRST NAME and how pickup is
	// verified — never the requester's details or the passenger's phone.
	Passenger *DriverPassengerView `json:"passenger,omitempty"`
}

// DriverJobsView answers GET /v1/mp/driver/jobs (D05/D11).
type DriverJobsView struct {
	Current   *DriverJobView `json:"current,omitempty"`
	Next      *DriverJobView `json:"next,omitempty"`
	Promotion string         `json:"promotion"`
}

// RateProfileView is one versioned profile (MpRateProfileSchema).
type RateProfileView struct {
	ProfileID            string                `json:"profileId"`
	DriverID             string                `json:"driverId"`
	Version              int                   `json:"version"`
	CityID               string                `json:"cityId"`
	Service              string                `json:"service"`
	VehicleClass         string                `json:"vehicleClass"`
	Currency             string                `json:"currency"`
	PerKmMinor           int64                 `json:"perKmMinor"`
	MinimumTripFareMinor int64                 `json:"minimumTripFareMinor"`
	Components           RateProfileComponents `json:"components"`
	CreatedAt            time.Time             `json:"createdAt"`
}

func rateProfileViewOf(profile *RateProfile) *RateProfileView {
	return &RateProfileView{
		ProfileID:            profile.ID.String(),
		DriverID:             profile.DriverID.String(),
		Version:              profile.Version,
		CityID:               profile.CityID,
		Service:              profile.Service,
		VehicleClass:         profile.VehicleClass,
		Currency:             profile.Currency,
		PerKmMinor:           profile.PerKmMinor,
		MinimumTripFareMinor: profile.MinTripMinor,
		Components:           profile.Components,
		CreatedAt:            profile.CreatedAt,
	}
}

// RatePreviewRow is one labelled line of the preview breakdown.
type RatePreviewRow struct {
	Label string `json:"label"`
	Value string `json:"value"`
	Tone  string `json:"tone,omitempty"`
}

// RatePreviewView answers POST /v1/mp/rate-profiles/preview.
type RatePreviewView struct {
	ProfileFormulaVersion int              `json:"profileFormulaVersion"`
	GrossMinor            Money            `json:"grossMinor"`
	CommissionMinor       Money            `json:"commissionMinor"`
	NetMinor              Money            `json:"netMinor"`
	FloorAdjusted         bool             `json:"floorAdjusted"`
	ExceedsCeiling        bool             `json:"exceedsCeiling"`
	Rows                  []RatePreviewRow `json:"rows"`
	Disclaimer            string           `json:"disclaimer"`
}

// formatMinor renders integer minor units as a human money string using the
// city's currency exponent — display only, never arithmetic.
func formatMinor(minor int64, currency string, fractionDigits int) string {
	if fractionDigits <= 0 {
		return fmt.Sprintf("%s %d", currency, minor)
	}
	divisor := int64(1)
	for i := 0; i < fractionDigits; i++ {
		divisor *= 10
	}
	sign := ""
	if minor < 0 {
		sign = "-"
		minor = -minor
	}
	return fmt.Sprintf("%s%s %d.%0*d", sign, currency, minor/divisor, fractionDigits, minor%divisor)
}

// verifiedDriverView derives the rider-facing driver display server-side.
//
// The one fact ride-service itself verifies is the vehicle class (the driver
// is eligible for it and bidding on it). Identity and reputation come from
// user-service's verified card (A06 part A): only a card whose verification
// status is "verified" fills the name, initials, rating, completed trips and
// masked plate and flips ProfileStatus to ProfileStatusVerified. A missing,
// non-disclosing or not-yet-verified card keeps the G09 placeholders under
// ProfileStatusUnavailable, so a client cannot render a pseudonym, an em-dash
// rating or a placeholder trip count as if they were real. The legacy fields
// stay non-nullable for the apps that read them; the structured card with
// nullable fields is OfferView.DriverProfile. The offer, winner
// (post-selection), queue and booking projections all call THIS function, so
// the same driver never renders two different ways.
func verifiedDriverView(driverID string, vehicleClass string, profile *DriverProfile) OfferDriverView {
	tag := strings.ToUpper(digest("mp.driver.display:" + driverID)[:4])
	view := OfferDriverView{
		DisplayName:    "Driver " + tag,
		Initials:       tag[:2],
		Rating:         "–",
		CompletedTrips: 0,
		Vehicle:        vehicleClass,
		PlateMasked:    "•••",
		ProfileStatus:  ProfileStatusUnavailable,
	}
	if !profile.Verified() {
		return view
	}
	view.ProfileStatus = ProfileStatusVerified
	if profile.DisplayName != nil {
		view.DisplayName = *profile.DisplayName
	}
	if profile.Initials != nil {
		view.Initials = *profile.Initials
	}
	if profile.Rating != nil {
		view.Rating = formatRating(profile.Rating.Average)
	}
	view.CompletedTrips = profile.CompletedTrips
	if profile.Vehicle != nil {
		view.PlateMasked = profile.Vehicle.PlateMasked
	}
	return view
}
