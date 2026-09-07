package move

import (
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// Actor is who is making a request. It is built by the handler from the signed
// gateway headers and never from the request body: a client that names its own
// user id, role or city is ignored (CLAUDE.md #1, hard rule 3).
type Actor struct {
	UserID uuid.UUID
	Role   string
	CityID string
}

// Roles the gateway issues that this service acts on.
const (
	RoleRider  = "rider"
	RoleDriver = "driver"
	RoleAdmin  = "admin"
)

// IsRider reports whether the actor may act as the rider on a ride.
func (a Actor) IsRider() bool { return a.Role == RoleRider }

// IsDriver reports whether the actor may act as the driver on a ride.
func (a Actor) IsDriver() bool { return a.Role == RoleDriver }

// QuoteView is what a rider is told about a quote. Note what the client is
// given and what it is not: it receives the fare, the currency, the expiry and
// a signature over all of them, and it receives no lever to change any of them.
type QuoteView struct {
	QuoteID       uuid.UUID            `json:"quoteId"`
	FareMinor     int64                `json:"fareMinor"`
	Currency      string               `json:"currency"`
	ExpiresAt     time.Time            `json:"expiresAt"`
	Signature     string               `json:"signature"`
	ConfigVersion int                  `json:"configVersion"`
	VehicleClass  string               `json:"vehicleClass"`
	Distance      int64                `json:"distanceMeters"`
	Duration      int64                `json:"durationSeconds"`
	Breakdown     domain.FareBreakdown `json:"breakdown"`
}

// DriverSummary is what a rider may know about their driver while the ride is
// live. It carries an id and an ETA and nothing else: names, plates and photos
// belong to user-service, and privacy by role (CLAUDE.md #6) means this service
// does not restate them.
type DriverSummary struct {
	DriverID   uuid.UUID `json:"driverId"`
	ETASeconds int64     `json:"etaSeconds,omitempty"`
}

// RideView is the ride as an app renders it.
//
// `State` is the canonical rider-machine state and `Status` is the uppercase
// word on the board; both are sent so a client can render the board's language
// without any client ever having to infer a state machine of its own.
type RideView struct {
	RideID           uuid.UUID      `json:"rideId"`
	State            string         `json:"state"`
	Status           string         `json:"status"`
	Version          int            `json:"version"`
	CityID           string         `json:"cityId"`
	ConfigVersion    int            `json:"configVersion"`
	VehicleClass     string         `json:"vehicleClass"`
	PaymentMethodID  string         `json:"paymentMethodId"`
	Pickup           domain.Place   `json:"pickup"`
	Dropoff          domain.Place   `json:"dropoff"`
	Currency         string         `json:"currency"`
	QuotedFareMinor  int64          `json:"quotedFareMinor"`
	WaitFeeMinor     int64          `json:"waitFeeMinor"`
	FinalFareMinor   *int64         `json:"finalFareMinor,omitempty"`
	FareSource       string         `json:"fareSource,omitempty"`
	Driver           *DriverSummary `json:"driver,omitempty"`
	PinRequired      bool           `json:"pinRequired"`
	PinVerified      bool           `json:"pinVerified"`
	PinLocked        bool           `json:"pinLocked"`
	CancelReasonCode string         `json:"cancelReasonCode,omitempty"`
	CancelledByRole  string         `json:"cancelledByRole,omitempty"`
	RequestedAt      time.Time      `json:"requestedAt"`
	AssignedAt       *time.Time     `json:"assignedAt,omitempty"`
	ArrivedAt        *time.Time     `json:"arrivedAt,omitempty"`
	StartedAt        *time.Time     `json:"startedAt,omitempty"`
	CompletedAt      *time.Time     `json:"completedAt,omitempty"`
	CancelledAt      *time.Time     `json:"cancelledAt,omitempty"`
	UpdatedAt        time.Time      `json:"updatedAt"`
	// Options is what a rider can do next when matching found nobody, so the
	// app never has to invent choices for a dead end (board 1e).
	Options []string `json:"options,omitempty"`
}

// viewOf renders a ride. It takes no role argument because nothing in this
// view is role-sensitive: the pickup PIN is returned once at creation and is
// never re-read from a hash, and the driver's identity is not restated here.
func viewOf(ride *domain.Ride, pinRequired bool) *RideView {
	view := &RideView{
		RideID:           ride.ID,
		State:            ride.State,
		Status:           WireStatus(ride.State),
		Version:          ride.Version,
		CityID:           ride.CityID,
		ConfigVersion:    ride.ConfigVersion,
		VehicleClass:     ride.VehicleClass,
		PaymentMethodID:  ride.PaymentMethodID,
		Pickup:           ride.Pickup,
		Dropoff:          ride.Dropoff,
		Currency:         ride.Currency,
		QuotedFareMinor:  ride.QuotedFareMinor,
		WaitFeeMinor:     ride.WaitFeeMinor,
		FinalFareMinor:   ride.FinalFareMinor,
		PinRequired:      pinRequired,
		PinVerified:      ride.PinVerifiedAt != nil,
		PinLocked:        ride.PinLocked,
		CancelReasonCode: ride.CancelReasonCode,
		CancelledByRole:  ride.CancelledByRole,
		RequestedAt:      ride.CreatedAt,
		AssignedAt:       ride.AssignedAt,
		ArrivedAt:        ride.ArrivedAt,
		StartedAt:        ride.StartedAt,
		CompletedAt:      ride.CompletedAt,
		CancelledAt:      ride.CancelledAt,
		UpdatedAt:        ride.UpdatedAt,
	}
	if ride.DriverID != nil {
		view.Driver = &DriverSummary{DriverID: *ride.DriverID}
	}
	return view
}

// CreateRideResult is the 201 body. The PIN appears here and nowhere else: it
// is hashed at rest, so this is the one moment the server can state it.
type CreateRideResult struct {
	*RideView
	Pin string `json:"pin,omitempty"`
}

// AcceptResultView is the answer to an accept. Exactly one of ok, expired or
// already_assigned comes back, and under concurrency exactly one caller in the
// whole cluster sees "ok".
type AcceptResultView struct {
	Result domain.AcceptResult `json:"result"`
	Ride   *RideView           `json:"ride,omitempty"`
}

// PinResultView is the answer to a PIN attempt.
type PinResultView struct {
	Verified     bool      `json:"verified"`
	AttemptsLeft int       `json:"attemptsLeft"`
	Ride         *RideView `json:"ride,omitempty"`
}

// DriverStatusView is a driver's own session as the driver app renders it.
type DriverStatusView struct {
	DriverID       uuid.UUID  `json:"driverId"`
	State          string     `json:"state"`
	Online         bool       `json:"online"`
	Version        int        `json:"version"`
	CityID         string     `json:"cityId"`
	VehicleClasses []string   `json:"vehicleClasses"`
	CurrentRideID  *uuid.UUID `json:"currentRideId,omitempty"`
	OnlineSince    *time.Time `json:"onlineSince,omitempty"`
}

func sessionView(session *domain.DriverSession) *DriverStatusView {
	classes := session.VehicleClasses
	if classes == nil {
		classes = []string{}
	}
	return &DriverStatusView{
		DriverID:       session.DriverID,
		State:          session.State,
		Online:         session.State != "offline",
		Version:        session.Version,
		CityID:         session.CityID,
		VehicleClasses: classes,
		CurrentRideID:  session.CurrentRideID,
		OnlineSince:    session.OnlineSince,
	}
}

// LocationBatchResult reports the verdict on every point in a batch, so a
// driver app learns that its points were rejected instead of believing it is
// visible when it is not (CLAUDE.md #8).
type LocationBatchResult struct {
	Accepted int                      `json:"accepted"`
	Rejected int                      `json:"rejected"`
	LastSeq  int64                    `json:"lastSeq"`
	Points   []domain.LocationOutcome `json:"points"`
}
