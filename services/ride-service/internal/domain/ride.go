package domain

import (
	"math"
	"time"

	"github.com/google/uuid"
)

// Money is an integer amount in the minor unit of an explicit currency. There
// is no float anywhere near a fare, and no amount travels without the currency
// it is denominated in — both from city config, never from a constant here.
type Money struct {
	AmountMinor int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
}

// Place is a coordinate with an optional human label.
type Place struct {
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Address string  `json:"address,omitempty"`
}

// Valid reports whether a coordinate is on Earth, and not the null island a
// missing JSON field decodes to.
func (p Place) Valid() bool {
	if math.IsNaN(p.Lat) || math.IsNaN(p.Lng) || math.IsInf(p.Lat, 0) || math.IsInf(p.Lng, 0) {
		return false
	}
	if p.Lat < -90 || p.Lat > 90 || p.Lng < -180 || p.Lng > 180 {
		return false
	}
	return p.Lat != 0 || p.Lng != 0
}

// FareBreakdown is what a fare is made of. It is stored with the quote so a
// completed ride can be explained line by line without recomputing anything.
type FareBreakdown struct {
	BaseMinor        int64 `json:"baseMinor"`
	DistanceMinor    int64 `json:"distanceMinor"`
	TimeMinor        int64 `json:"timeMinor"`
	BookingFeeMinor  int64 `json:"bookingFeeMinor"`
	MinFareTopUpMinor int64 `json:"minFareTopUpMinor"`
	TotalMinor       int64 `json:"totalMinor"`
}

// Quote is a priced, signed offer to carry a rider. Every field except the
// requested geometry is computed by the server.
type Quote struct {
	ID              uuid.UUID     `json:"quoteId"`
	CityID          string        `json:"cityId"`
	ConfigVersion   int           `json:"configVersion"`
	RiderID         uuid.UUID     `json:"-"`
	VehicleClass    string        `json:"vehicleClass"`
	Pickup          Place         `json:"pickup"`
	Dropoff         Place         `json:"dropoff"`
	Stops           []Place       `json:"stops"`
	DistanceMeters  int64         `json:"distanceMeters"`
	DurationSeconds int64         `json:"durationSeconds"`
	FareMinor       int64         `json:"fareMinor"`
	Currency        string        `json:"currency"`
	Breakdown       FareBreakdown `json:"breakdown"`
	ExpiresAt       time.Time     `json:"expiresAt"`
	Signature       string        `json:"signature"`
	ConsumedBy      *uuid.UUID    `json:"-"`
}

// Expired reports whether the quote may no longer be used.
func (q *Quote) Expired(now time.Time) bool { return !now.Before(q.ExpiresAt) }

// Ride is one ride, in a state of the rider machine from
// contracts/state-machines.json. `Version` is the aggregate version used for
// ETags and for the outbox from/to versions.
type Ride struct {
	ID               uuid.UUID  `json:"rideId"`
	CityID           string     `json:"cityId"`
	ConfigVersion    int        `json:"configVersion"`
	QuoteID          uuid.UUID  `json:"quoteId"`
	RiderID          uuid.UUID  `json:"riderId"`
	DriverID         *uuid.UUID `json:"driverId,omitempty"`
	State            string     `json:"state"`
	Version          int        `json:"version"`
	Active           bool       `json:"active"`
	VehicleClass     string     `json:"vehicleClass"`
	PaymentMethodID  string     `json:"paymentMethodId"`
	Pickup           Place      `json:"pickup"`
	Dropoff          Place      `json:"dropoff"`
	QuotedFareMinor  int64      `json:"quotedFareMinor"`
	FinalFareMinor   *int64     `json:"finalFareMinor,omitempty"`
	WaitFeeMinor     int64      `json:"waitFeeMinor"`
	Currency         string     `json:"currency"`
	PinAttempts      int        `json:"pinAttempts"`
	PinLocked        bool       `json:"pinLocked"`
	PinVerifiedAt    *time.Time `json:"pinVerifiedAt,omitempty"`
	DispatchRing     int        `json:"dispatchRing"`
	DispatchRounds   int        `json:"dispatchRounds"`
	AssignedAt       *time.Time `json:"assignedAt,omitempty"`
	ArrivedAt        *time.Time `json:"arrivedAt,omitempty"`
	StartedAt        *time.Time `json:"startedAt,omitempty"`
	CompletedAt      *time.Time `json:"completedAt,omitempty"`
	CancelledAt      *time.Time `json:"cancelledAt,omitempty"`
	CancelledByRole  string     `json:"cancelledByRole,omitempty"`
	CancelReasonCode string     `json:"cancelReasonCode,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

// Offer states. Every offer and every response is persisted, which is what the
// ops timeline (board 4b) reads; none of this lives only in a goroutine.
const (
	OfferOffered  = "offered"
	OfferAccepted = "accepted"
	OfferDeclined = "declined"
	OfferExpired  = "expired"
)

// Offer is one dispatch of one ride to one driver.
type Offer struct {
	ID             uuid.UUID  `json:"offerId"`
	RideID         uuid.UUID  `json:"rideId"`
	DriverID       uuid.UUID  `json:"driverId"`
	Ring           int        `json:"ring"`
	RadiusMeters   int        `json:"radiusMeters"`
	DistanceMeters float64    `json:"distanceMeters"`
	ETASeconds     int64      `json:"etaSeconds"`
	State          string     `json:"state"`
	Reason         string     `json:"reason,omitempty"`
	ExpiresAt      time.Time  `json:"expiresAt"`
	RespondedAt    *time.Time `json:"respondedAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
}

// Live reports whether a driver could still accept this offer.
func (o *Offer) Live(now time.Time) bool {
	return o.State == OfferOffered && now.Before(o.ExpiresAt)
}

// AcceptResult is the closed set of answers to an accept. Exactly one of these
// comes back, and under concurrency exactly one caller gets AcceptOK.
type AcceptResult string

const (
	AcceptOK              AcceptResult = "ok"
	AcceptExpired         AcceptResult = "expired"
	AcceptAlreadyAssigned AcceptResult = "already_assigned"
)

// CancellationReasons is the closed set of reason codes a cancellation may
// carry. A driver must supply one (slice 02 guard); `unsafe` routes the ride
// into the safety flow rather than a plain cancellation.
var CancellationReasons = map[string]struct{}{
	"rider_no_show":      {},
	"rider_unreachable":  {},
	"wrong_pickup":       {},
	"vehicle_issue":      {},
	"traffic":            {},
	"too_far":            {},
	"unsafe":             {},
	"changed_mind":       {},
	"found_another_ride": {},
	"driver_late":        {},
	"price_too_high":     {},
	"other":              {},
}

// ValidCancellationReason reports whether a reason code is one the platform
// knows. An unknown code is refused rather than stored, so the ops timeline
// cannot fill up with free text.
func ValidCancellationReason(code string) bool {
	_, ok := CancellationReasons[code]
	return ok
}
