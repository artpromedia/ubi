package marketplace

import (
	"context"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// Book for Later views (A03). Every one of them says, in words and in a
// boolean, whether a driver is actually secured: a scheduled request never
// is, an advance booking is once a requester-selected award confirmed it —
// and no view ever promises a guaranteed pickup.

// noGuaranteeNotice is stated on every booking view.
const noGuaranteeNotice = "Pickup is not guaranteed: if your driver cannot attend we tell you at once, charge you nothing for the trip and offer to find another driver with your consent."

// RequestBookingView is the future-booking block of a request, feed card or
// driver view (MpRequestBookingSchema).
type RequestBookingView struct {
	Kind               string             `json:"kind"`
	Schedule           PickupScheduleView `json:"schedule"`
	ScheduledRequestID *string            `json:"scheduledRequestId"`
	DriverSecured      bool               `json:"driverSecured"`
	Notice             string             `json:"notice"`
}

// requestBookingViewOf renders a request's booking block, or nil for an
// immediate request (so an immediate request renders exactly as before).
func requestBookingViewOf(request *Request) *RequestBookingView {
	if request.Schedule == nil || (request.BookingKind != BookingKindAdvance && request.BookingKind != BookingKindScheduled) {
		return nil
	}
	view := &RequestBookingView{
		Kind:     request.BookingKind,
		Schedule: scheduleViewOf(request.Schedule),
	}
	if request.ScheduledRequestID != nil {
		id := request.ScheduledRequestID.String()
		view.ScheduledRequestID = &id
	}
	secured := request.State == machine.MpRequestAwarded || request.State == machine.MpRequestExecution
	view.DriverSecured = secured
	switch {
	case request.BookingKind == BookingKindAdvance && secured:
		view.Notice = "A driver is reserved for this pickup window. Open the booking for funding and reconfirmation. " + noGuaranteeNotice
	case request.BookingKind == BookingKindAdvance && request.State == machine.MpRequestAwardPending:
		view.Notice = "Confirming the advance booking with the driver you selected. No driver is secured until it confirms."
	case request.BookingKind == BookingKindAdvance:
		view.Notice = "Drivers are offering for this future pickup window. No driver is secured until you select an offer; selecting one books that driver in advance."
	case secured:
		view.Notice = "Your scheduled request found a driver."
	default:
		view.Notice = "Your scheduled request is live now. No driver is secured until you select an offer."
	}
	return view
}

// AdvanceCommitmentView is what an advance bid commits the driver's wallet
// to (MpAdvanceCommitmentSchema), explained before the bid and restated on it.
type AdvanceCommitmentView struct {
	CommissionMinor          Money      `json:"commissionMinor"`
	HeldFrom                 string     `json:"heldFrom"`
	CapturedAt               string     `json:"capturedAt"`
	ChargedAgainAtActivation bool       `json:"chargedAgainAtActivation"`
	HoldExpiresAt            *time.Time `json:"holdExpiresAt"`
	PickupWindowStart        time.Time  `json:"pickupWindowStart"`
	PickupWindowEnd          time.Time  `json:"pickupWindowEnd"`
	Terms                    []string   `json:"terms"`
}

// advanceCommitmentOf phrases the advance wallet commitment for an amount on
// an advance request. holdExpiresAt is the bid's expiry once one exists.
func advanceCommitmentOf(request *Request, amountMinor int64, holdExpiresAt *time.Time, digits int) *AdvanceCommitmentView {
	if !request.isAdvance() || request.PickupWindowStart == nil || request.PickupWindowEnd == nil {
		return nil
	}
	commission := CommissionMinor(amountMinor)
	fee := formatMinor(commission, request.Currency, digits)
	return &AdvanceCommitmentView{
		CommissionMinor:          money(commission, request.Currency),
		HeldFrom:                 "cleared_balance",
		CapturedAt:               "advance_award",
		ChargedAgainAtActivation: false,
		HoldExpiresAt:            holdExpiresAt,
		PickupWindowStart:        *request.PickupWindowStart,
		PickupWindowEnd:          *request.PickupWindowEnd,
		Terms: []string{
			"This offer holds your 10% commission (" + fee + ") from your cleared wallet balance until the offer ends or is selected.",
			"If the requester selects you, the commission is captured once, at that moment — before the trip. Starting the trip later never charges it again.",
			"Selection books this pickup window on your calendar: reconfirm before pickup and stay eligible. If the booking fails or is cancelled, the captured commission is returned with a linked reversal.",
			"Near pickup the trip enters your live jobs only if you are free, or finishing a trip that ends in time — a current passenger is never cut short.",
		},
	}
}

// ScheduledApprovalView is why an intent waits for the rider.
type ScheduledApprovalView struct {
	Reason         string          `json:"reason"`
	Message        string          `json:"message"`
	RefreshedTerms *RefreshedTerms `json:"refreshedTerms"`
}

// RefreshedTerms are the bounds a publication refreshed.
type RefreshedTerms struct {
	MinimumFareMinor   Money `json:"minimumFareMinor"`
	MaximumFareMinor   Money `json:"maximumFareMinor"`
	SuggestedFareMinor Money `json:"suggestedFareMinor"`
}

// ScheduledRequestView is MpScheduledRequestSchema.
type ScheduledRequestView struct {
	ScheduledRequestID string                 `json:"scheduledRequestId"`
	Product            string                 `json:"product"`
	State              string                 `json:"state"`
	Version            int                    `json:"version"`
	DriverSecured      bool                   `json:"driverSecured"`
	StatusLabel        string                 `json:"statusLabel"`
	Notice             string                 `json:"notice"`
	Service            string                 `json:"service"`
	VehicleClass       string                 `json:"vehicleClass"`
	CityID             string                 `json:"cityId"`
	Currency           string                 `json:"currency"`
	Pickup             Area                   `json:"pickup"`
	Dropoff            Area                   `json:"dropoff"`
	Stops              []RouteStop            `json:"stops,omitempty"`
	Schedule           PickupScheduleView     `json:"schedule"`
	PublishAt          time.Time              `json:"publishAt"`
	RequestedFareMinor Money                  `json:"requestedFareMinor"`
	MaxFareMinor       Money                  `json:"maxFareMinor"`
	PaymentMethodID    string                 `json:"paymentMethodId"`
	RequestID          *string                `json:"requestId"`
	RequestState       *string                `json:"requestState"`
	TemplateID         *string                `json:"templateId"`
	OccurrenceDate     *string                `json:"occurrenceDate"`
	Approval           *ScheduledApprovalView `json:"approval"`
	CloseReason        *string                `json:"closeReason"`
	CreatedAt          time.Time              `json:"createdAt"`
	UpdatedAt          time.Time              `json:"updatedAt"`
}

// scheduledViewOf renders an intent. `request` is the published request
// (nil before publication); `seriesPaused` marks an occurrence whose series
// is paused (it will not publish while paused).
func scheduledViewOf(sr *ScheduledRequest, request *Request, seriesPaused bool) *ScheduledRequestView {
	schedule := scheduleViewOf(&sr.Schedule)
	view := &ScheduledRequestView{
		ScheduledRequestID: sr.ID.String(),
		Product:            sr.Product,
		State:              sr.State,
		Version:            sr.Version,
		Service:            sr.Service,
		VehicleClass:       sr.VehicleClass,
		CityID:             sr.CityID,
		Currency:           sr.Currency,
		Pickup:             sr.Pickup,
		Dropoff:            sr.Dropoff,
		Schedule:           schedule,
		PublishAt:          sr.PublishAt,
		RequestedFareMinor: money(sr.RequestedMinor, sr.Currency),
		MaxFareMinor:       money(sr.MaxFareMinor, sr.Currency),
		PaymentMethodID:    sr.PaymentMethodID,
		CreatedAt:          sr.CreatedAt,
		UpdatedAt:          sr.UpdatedAt,
	}
	if len(sr.Stops) > 0 {
		view.Stops = sr.Stops
	}
	if sr.RequestID != nil {
		id := sr.RequestID.String()
		view.RequestID = &id
	}
	if request != nil {
		state := request.State
		view.RequestState = &state
	}
	if sr.TemplateID != nil {
		id := sr.TemplateID.String()
		view.TemplateID = &id
		view.OccurrenceDate = sr.OccurrenceDate
	}
	if sr.CloseReason != "" {
		reason := sr.CloseReason
		view.CloseReason = &reason
	}
	if sr.Approval != nil {
		approval := &ScheduledApprovalView{Reason: sr.Approval.Reason, Message: sr.Approval.Message}
		if sr.Approval.RefreshedMinMinor != nil && sr.Approval.RefreshedMaxMinor != nil && sr.Approval.RefreshedSuggested != nil {
			approval.RefreshedTerms = &RefreshedTerms{
				MinimumFareMinor:   money(*sr.Approval.RefreshedMinMinor, sr.Currency),
				MaximumFareMinor:   money(*sr.Approval.RefreshedMaxMinor, sr.Currency),
				SuggestedFareMinor: money(*sr.Approval.RefreshedSuggested, sr.Currency),
			}
		}
		view.Approval = approval
	}

	publishWords := sr.PublishAt.Format(time.RFC3339)
	if location, err := time.LoadLocation(sr.Schedule.TimeZone); err == nil {
		publishWords = sr.PublishAt.In(location).Format("Mon 2 Jan, 15:04")
	}
	product := "your request"
	if sr.Product == ProductAdvanceReservation {
		product = "your advance-booking request"
	}
	switch sr.State {
	case machine.MpScheduledUnassigned:
		view.StatusLabel = "Scheduled — no driver secured yet"
		view.Notice = "We will send " + product + " to drivers at " + publishWords + ". No driver is secured until you choose an offer."
		if seriesPaused {
			view.StatusLabel = "Series paused — no driver secured"
			view.Notice = "This trip's series is paused, so it will not be sent to drivers unless you resume the series."
		}
	case machine.MpScheduledNeedsApproval:
		view.StatusLabel = "Needs your approval — no driver secured yet"
		view.Notice = "The trip's terms changed since you approved them, so nothing was sent to drivers. Review and approve to continue."
		if sr.Approval != nil {
			view.Notice = sr.Approval.Message
		}
	case machine.MpScheduledPublished:
		view.StatusLabel = "Sent to drivers — no driver secured yet"
		view.Notice = "Choose an offer to secure a driver."
		if request != nil {
			switch request.State {
			case machine.MpRequestAwardPending:
				view.StatusLabel = "Confirming your driver"
				view.Notice = "Your selected driver is being confirmed."
			case machine.MpRequestAwarded, machine.MpRequestExecution:
				view.DriverSecured = true
				view.StatusLabel = "Driver secured"
				view.Notice = "A driver accepted through your selection. Follow the trip from the request."
			case machine.MpRequestCancelled, machine.MpRequestExpired, machine.MpRequestNoOffers:
				view.StatusLabel = "Closed — no driver"
				view.Notice = "The request closed without a driver. Nothing was charged."
			}
		}
	case machine.MpScheduledUnfulfilled:
		view.StatusLabel = "No driver found"
		view.Notice = "No driver took this trip in time. Nothing was charged; you can book again."
	case machine.MpScheduledCancelled:
		view.StatusLabel = "Cancelled"
		view.Notice = "You cancelled this trip before any driver was secured. Nothing was charged."
	case machine.MpScheduledSkipped:
		view.StatusLabel = "Skipped"
		view.Notice = "This occurrence was skipped. The rest of the series is unaffected."
	case machine.MpScheduledExpired:
		view.StatusLabel = "Expired — never sent"
		view.Notice = "The pickup time passed before this trip could be sent to drivers. Nothing was charged."
	}
	return view
}

// BookingFundingView is an advance booking's rider funding.
type BookingFundingView struct {
	State    string     `json:"state"`
	Label    string     `json:"label"`
	DueAt    *time.Time `json:"dueAt"`
	Deadline *time.Time `json:"deadline"`
}

// BookingReconfirmationView is the driver's reconfirmation window.
type BookingReconfirmationView struct {
	OpensAt       time.Time  `json:"opensAt"`
	Deadline      time.Time  `json:"deadline"`
	ReconfirmedAt *time.Time `json:"reconfirmedAt"`
}

// BookingFinancialOutcome is what a failed booking did with the money.
type BookingFinancialOutcome struct {
	CommissionReversed   bool `json:"commissionReversed"`
	RiderFundingReleased bool `json:"riderFundingReleased"`
	RiderCharged         bool `json:"riderCharged"`
}

// BookingFailureView is MpBookingFailureSchema.
type BookingFailureView struct {
	Reason           string                  `json:"reason"`
	Message          string                  `json:"message"`
	FinancialOutcome BookingFinancialOutcome `json:"financialOutcome"`
	RematchAvailable bool                    `json:"rematchAvailable"`
}

// AdvanceBookingView is MpAdvanceBookingSchema.
type AdvanceBookingView struct {
	BookingID        string                    `json:"bookingId"`
	RequestID        string                    `json:"requestId"`
	AwardID          string                    `json:"awardId"`
	State            string                    `json:"state"`
	Version          int                       `json:"version"`
	Viewer           string                    `json:"viewer"`
	DriverReserved   bool                      `json:"driverReserved"`
	FullySecured     bool                      `json:"fullySecured"`
	StatusLabel      string                    `json:"statusLabel"`
	Notices          []string                  `json:"notices"`
	Schedule         PickupScheduleView        `json:"schedule"`
	Pickup           Area                      `json:"pickup"`
	Dropoff          Area                      `json:"dropoff"`
	FareMinor        Money                     `json:"fareMinor"`
	CommissionMinor  *Money                    `json:"commissionMinor,omitempty"`
	NetMinor         *Money                    `json:"netMinor,omitempty"`
	Driver           *OfferDriverView          `json:"driver,omitempty"`
	Funding          BookingFundingView        `json:"funding"`
	Reconfirmation   BookingReconfirmationView `json:"reconfirmation"`
	ActivationAt     time.Time                 `json:"activationAt"`
	ActivatedSlot    *string                   `json:"activatedSlot"`
	Failure          *BookingFailureView       `json:"failure"`
	RematchRequestID *string                   `json:"rematchRequestId"`
	// ReminderOffsetsSec are the market's reminder offsets, seconds before
	// the pickup window opens (empty when none are configured or the policy
	// could not be read).
	ReminderOffsetsSec []int `json:"reminderOffsetsSec"`
	// FreeCancellationDeadline is, on the rider's view, until when the
	// booking may be cancelled free of charge (activation); nil once it can
	// no longer be, and always nil on the driver's view.
	FreeCancellationDeadline *time.Time `json:"freeCancellationDeadline"`
	CreatedAt                time.Time  `json:"createdAt"`
	UpdatedAt                time.Time  `json:"updatedAt"`
}

// Booking viewers.
const (
	viewerRider  = "rider"
	viewerDriver = "driver"
)

// bookingViewOf renders a booking for its rider or its driver. The pickup
// and dropoff are the request's area labels for the driver until activation
// (the exact pickup is disclosed through the execution, as for any award).
func bookingViewOf(b *AdvanceBooking, request *Request, vehicleClass string, viewer string) *AdvanceBookingView {
	schedule := PickupScheduleView{
		PickupAt: b.WindowStart, WindowStart: b.WindowStart, WindowEnd: b.WindowEnd,
		WindowMinutes: int(b.WindowEnd.Sub(b.WindowStart) / time.Minute),
		TimeZone:      "UTC", UTCOffset: "+00:00", DSTResolution: DSTResolutionExact,
		LocalDate: b.WindowStart.Format("2006-01-02"), LocalTime: b.WindowStart.Format("15:04"),
		Label: b.WindowStart.Format("Mon 2 Jan 2006, 15:04") + " (UTC+00:00)",
	}
	if request != nil && request.Schedule != nil {
		schedule = scheduleViewOf(request.Schedule)
	}
	view := &AdvanceBookingView{
		BookingID:    b.ID.String(),
		RequestID:    b.RequestID.String(),
		AwardID:      b.AwardID.String(),
		State:        b.State,
		Version:      b.Version,
		Viewer:       viewer,
		Schedule:     schedule,
		Pickup:       b.Pickup,
		Dropoff:      b.Dropoff,
		FareMinor:    money(b.FareMinor, b.Currency),
		ActivationAt: b.ActivationAt,
		Reconfirmation: BookingReconfirmationView{
			OpensAt:       b.ReconfirmOpensAt,
			Deadline:      b.ReconfirmDeadline,
			ReconfirmedAt: b.ReconfirmedAt,
		},
		ReminderOffsetsSec: []int{},
		CreatedAt:          b.CreatedAt,
		UpdatedAt:          b.UpdatedAt,
	}
	if viewer == viewerRider && riderMayCancelFree(b.State) {
		// No cancellation fee is charged before activation (CancelBooking);
		// after it the booking is an ordinary queued or current job.
		deadline := b.ActivationAt
		view.FreeCancellationDeadline = &deadline
	}
	if viewer == viewerDriver {
		commission := money(b.CommissionMinor, b.Currency)
		net := money(b.FareMinor-b.CommissionMinor, b.Currency)
		view.CommissionMinor = &commission
		view.NetMinor = &net
		// The driver sees only coarse areas before activation.
		view.Pickup = Area{Label: b.Pickup.Label, Lat: coarse(b.Pickup.Lat), Lng: coarse(b.Pickup.Lng)}
		view.Dropoff = Area{Label: b.Dropoff.Label, Lat: coarse(b.Dropoff.Lat), Lng: coarse(b.Dropoff.Lng)}
	} else {
		// Placeholders here (this renderer also runs inside transactions and
		// replays); the read paths swap in the verified card through
		// withVerifiedDriver, the one profile-backed display.
		driver := verifiedDriverView(b.DriverID.String(), vehicleClass, nil)
		view.Driver = &driver
	}
	if b.ActivatedSlot != "" {
		slot := b.ActivatedSlot
		view.ActivatedSlot = &slot
	}
	if b.RematchRequestID != nil {
		id := b.RematchRequestID.String()
		view.RematchRequestID = &id
	}

	funding := BookingFundingView{State: b.FundingState}
	switch b.FundingState {
	case BookingFundingSecured:
		funding.Label = "Payment secured"
	case BookingFundingUnsecuredCash:
		funding.Label = "Cash — paid to the driver at the trip (not secured in advance)"
	case BookingFundingRefused:
		funding.Label = "Payment could not be secured yet — top up or change method before the deadline"
		due, deadline := b.FundingDueAt, b.FundingDeadline
		funding.DueAt, funding.Deadline = &due, &deadline
	case BookingFundingReleased:
		funding.Label = "Payment hold released"
	default:
		funding.Label = "Payment will be secured closer to pickup"
		due, deadline := b.FundingDueAt, b.FundingDeadline
		funding.DueAt, funding.Deadline = &due, &deadline
	}
	view.Funding = funding

	reserved := false
	switch b.State {
	case machine.MpBookingHeld:
		view.StatusLabel = "Confirming the driver you selected"
	case machine.MpBookingPaymentPending:
		reserved = true
		view.StatusLabel = "Driver reserved — payment pending"
	case machine.MpBookingConfirmed:
		reserved = true
		view.StatusLabel = "Driver reserved — awaiting the driver's reconfirmation before pickup"
	case machine.MpBookingReconfirmed:
		reserved = true
		view.StatusLabel = "Driver reserved and reconfirmed"
	case machine.MpBookingActivated:
		reserved = true
		view.StatusLabel = "Trip started from your booking"
	case machine.MpBookingCompleted:
		view.StatusLabel = "Completed"
	case machine.MpBookingFailed:
		view.StatusLabel = "Booking failed — no driver"
	case machine.MpBookingCancelled:
		view.StatusLabel = "Cancelled"
	case machine.MpBookingReleased:
		view.StatusLabel = "Not booked — the selection could not be completed"
	}
	view.DriverReserved = reserved
	view.FullySecured = reserved && (b.FundingState == BookingFundingSecured || b.FundingState == BookingFundingUnsecuredCash)

	notices := []string{}
	if viewer == viewerRider {
		if b.State == machine.MpBookingPaymentPending {
			notices = append(notices, "Your driver is reserved, but this booking is not fully secured until your payment is secured (by "+
				b.FundingDeadline.Format(time.RFC3339)+"). If it cannot be secured the booking is cancelled at no charge.")
		}
		if b.FundingState == BookingFundingUnsecuredCash && reserved {
			notices = append(notices, "Cash bookings are not secured in advance.")
		}
		notices = append(notices, noGuaranteeNotice)
	} else {
		notices = append(notices, "Your 10% commission was captured once when you were selected. Starting this trip will not charge it again.")
		if b.State == machine.MpBookingConfirmed {
			notices = append(notices, "Reconfirm between "+b.ReconfirmOpensAt.Format(time.RFC3339)+" and "+
				b.ReconfirmDeadline.Format(time.RFC3339)+" or the booking is released and your commission returned.")
		}
	}
	view.Notices = notices

	if b.Failure != nil {
		view.Failure = &BookingFailureView{
			Reason:  b.Failure.Reason,
			Message: bookingFailureMessage(b.Failure, viewer),
			FinancialOutcome: BookingFinancialOutcome{
				CommissionReversed:   b.Failure.CommissionReversed,
				RiderFundingReleased: b.Failure.RiderFundingReleased,
				RiderCharged:         false,
			},
			// The consented rematch is the RIDER's option; a driver is never
			// offered it.
			RematchAvailable: viewer == viewerRider && b.Failure.RematchAvailable && b.RematchRequestID == nil,
		}
	}
	return view
}

// riderMayCancelFree reports whether the rider may still cancel a booking in
// this state through CancelBooking, which charges no fee (held answers
// "try again shortly" while the selection confirms, and is still free).
func riderMayCancelFree(state string) bool {
	switch state {
	case machine.MpBookingHeld, machine.MpBookingPaymentPending, machine.MpBookingConfirmed, machine.MpBookingReconfirmed:
		return true
	default:
		return false
	}
}

// withBookingReminders fills the market's reminder offsets onto a booking
// view read outside a transaction; an unreadable policy leaves them empty.
func (s *Service) withBookingReminders(ctx context.Context, view *AdvanceBookingView, cityID string) *AdvanceBookingView {
	if view == nil {
		return view
	}
	_, policy, err := s.policy(ctx, cityID)
	if err != nil {
		return view
	}
	advance, err := policy.AdvanceReservationPolicyFor(cityID)
	if err != nil {
		return view
	}
	offsets := make([]int, 0, len(advance.ReminderOffsetsSec))
	offsets = append(offsets, advance.ReminderOffsetsSec...)
	view.ReminderOffsetsSec = offsets
	return view
}

// bookingFailureMessage phrases a failed or cancelled booking for the party
// reading it. The stored message is the RIDER's sentence (it is written once,
// when the booking ends, and may carry the rider-only rematch offer); the
// driver's sentence is derived from the machine-readable reason and the
// recorded financial outcome, so a driver never reads "your driver withdrew"
// about themselves, and never a promise about the rider's money phrased as
// theirs.
func bookingFailureMessage(failure *BookingFailure, viewer string) string {
	if viewer != viewerDriver {
		return failure.Message
	}
	var message string
	switch failure.Reason {
	case BookingFailDriverWithdrew:
		message = "You withdrew from this booking, so it was released."
	case BookingFailDriverIneligible:
		message = "Your account can no longer take marketplace trips, so this booking was released."
	case BookingFailReconfirmMissed:
		message = "You did not reconfirm before the deadline, so this booking was released."
	case BookingFailFundingNotSecured:
		message = "The rider's payment could not be secured in time, so this booking was released."
	case BookingFailDriverUnavailable:
		message = "You were not available to start this booking in time, so it was released."
	case BookingFailDriverOnTrip:
		message = "Your running trip could not finish in time for this pickup, so the booking was released."
	case BookingCancelledByRider:
		message = "The rider cancelled this booking."
	case BookingFailTripCancelled:
		message = "The trip from this booking was cancelled."
	default:
		// execution_blocked, award_cancelled and anything newer.
		message = "This booking could not go ahead, so it was released."
	}
	if failure.CommissionReversed {
		message += " Your 10% commission was returned with a linked reversal; nothing more is owed."
	}
	return message
}

// coarse rounds a coordinate to the ~1 km cell its area label names.
func coarse(value float64) float64 {
	return float64(int(value*100)) / 100
}

// DriverCalendarView is MpDriverCalendarSchema.
type DriverCalendarView struct {
	Bookings []*AdvanceBookingView `json:"bookings"`
	Note     string                `json:"note"`
}

// driverCalendarNote explains the calendar's relation to the live slots.
const driverCalendarNote = "Future bookings live on this calendar, not in your current/next jobs. Each enters your live jobs near its pickup, and only if you are free or finishing a trip that ends in time."

// RecurringTemplateView is MpRecurringTemplateSchema.
type RecurringTemplateView struct {
	TemplateID         string                  `json:"templateId"`
	State              string                  `json:"state"`
	Version            int                     `json:"version"`
	Product            string                  `json:"product"`
	DaysOfWeek         []string                `json:"daysOfWeek"`
	LocalTime          string                  `json:"localTime"`
	TimeZone           string                  `json:"timeZone"`
	StartsOn           string                  `json:"startsOn"`
	EndsOn             *string                 `json:"endsOn"`
	WindowMinutes      int                     `json:"windowMinutes"`
	RequestedFareMinor Money                   `json:"requestedFareMinor"`
	MaxFareMinor       Money                   `json:"maxFareMinor"`
	PaymentMethodID    string                  `json:"paymentMethodId"`
	Service            string                  `json:"service"`
	VehicleClass       string                  `json:"vehicleClass"`
	Pickup             Area                    `json:"pickup"`
	Dropoff            Area                    `json:"dropoff"`
	Stops              []RouteStop             `json:"stops,omitempty"`
	GeneratedThrough   *string                 `json:"generatedThrough"`
	SeriesNote         string                  `json:"seriesNote"`
	Occurrences        []*ScheduledRequestView `json:"occurrences"`
	CreatedAt          time.Time               `json:"createdAt"`
	UpdatedAt          time.Time               `json:"updatedAt"`
}

// seriesNote is stated on every template view: a series is never
// "confirmed" because one occurrence found a driver.
const seriesNote = "Each trip in this series is booked, approved, paid and cancellable on its own. A driver secured for one trip does not secure any other."

func templateViewOf(t *RecurringTemplate, occurrences []*ScheduledRequestView) *RecurringTemplateView {
	view := &RecurringTemplateView{
		TemplateID:         t.ID.String(),
		State:              t.State,
		Version:            t.Version,
		Product:            t.Product,
		DaysOfWeek:         t.DaysOfWeek,
		LocalTime:          t.LocalTime,
		TimeZone:           t.TimeZone,
		StartsOn:           t.StartsOn,
		EndsOn:             t.EndsOn,
		WindowMinutes:      t.WindowSec / 60,
		RequestedFareMinor: money(t.RequestedMinor, t.Currency),
		MaxFareMinor:       money(t.MaxFareMinor, t.Currency),
		PaymentMethodID:    t.PaymentMethodID,
		Service:            t.Service,
		VehicleClass:       t.VehicleClass,
		Pickup:             t.Pickup,
		Dropoff:            t.Dropoff,
		GeneratedThrough:   t.GeneratedThrough,
		SeriesNote:         seriesNote,
		Occurrences:        occurrences,
		CreatedAt:          t.CreatedAt,
		UpdatedAt:          t.UpdatedAt,
	}
	if len(t.Stops) > 0 {
		view.Stops = t.Stops
	}
	if view.Occurrences == nil {
		view.Occurrences = []*ScheduledRequestView{}
	}
	return view
}
