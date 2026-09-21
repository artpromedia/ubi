package marketplace

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// Queue projection lifecycle statuses (contract QueueView.status).
const (
	QueueStatusQueued     = "queued"
	QueueStatusPromoting  = "promoting"
	QueueStatusAssigned   = "assigned"
	QueueStatusArrived    = "arrived"
	QueueStatusInProgress = "in_progress"
	QueueStatusSettled    = "settled"
	QueueStatusCancelled  = "cancelled"
)

// QueueStepView is one ladder row in the rider's tracker.
type QueueStepView struct {
	Label  string `json:"label"`
	Detail string `json:"detail,omitempty"`
	State  string `json:"state"`
}

// QueueEtaView is the current pickup estimate with its own freshness.
type QueueEtaView struct {
	Label      string    `json:"label"`
	InWindow   bool      `json:"inWindow"`
	EtaSeconds *int      `json:"etaSeconds"`
	AsOf       time.Time `json:"asOf"`
}

// QueuePickupWindowView is the consented window plus its uncertainty band.
type QueuePickupWindowView struct {
	EarliestSec    int `json:"earliestSec"`
	LatestSec      int `json:"latestSec"`
	EtaVersion     int `json:"etaVersion"`
	UncertaintySec int `json:"uncertaintySec"`
}

// QueueActionsView is the set of actions the server permits the rider.
type QueueActionsView struct {
	CanCancel   bool `json:"canCancel"`
	FeeFreeExit bool `json:"feeFreeExit"`
}

// QueueReversalView is the money-movement state shown after a free cancellation.
type QueueReversalView struct {
	RiderHold string `json:"riderHold"`
	DriverFee string `json:"driverFee"`
}

// QueueDelayView is the delay/cancellation notice, or null when on track.
type QueueDelayView struct {
	NoticeTitle string             `json:"noticeTitle"`
	NoticeBody  string             `json:"noticeBody"`
	KeepLabel   string             `json:"keepLabel"`
	Reversal    *QueueReversalView `json:"reversal"`
}

// QueueView answers GET /v1/mp/requests/{id}/queue (contract QueueView).
type QueueView struct {
	RequestID       string                 `json:"requestId"`
	Version         int                    `json:"version"`
	AsOf            time.Time              `json:"asOf"`
	Status          string                 `json:"status"`
	Promotion       string                 `json:"promotion"`
	Driver          OfferDriverView        `json:"driver"`
	DriverFirstName string                 `json:"driverFirstName"`
	Steps           []QueueStepView        `json:"steps"`
	FareMinor       Money                  `json:"fareMinor"`
	WindowLabel     string                 `json:"windowLabel"`
	Eta             QueueEtaView           `json:"eta"`
	PickupWindow    *QueuePickupWindowView `json:"pickupWindow"`
	Actions         QueueActionsView       `json:"actions"`
	Delayed         *QueueDelayView        `json:"delayed"`
}

func ceilMinutes(sec int) int {
	if sec <= 0 {
		return 0
	}
	return (sec + 59) / 60
}

// QueueProjection answers GET /v1/mp/requests/{id}/queue (G07): the requester's
// authorized, versioned view of an awarded (typically finishing-trip) job —
// claim/job status, promotion state, ETA vs the consented window with an asOf
// freshness stamp, the pickup window and its uncertainty, and the permitted
// actions. Owner-only: a foreign rider gets 404, exactly as the snapshot does.
func (s *Service) QueueProjection(ctx context.Context, actor Actor, requestID uuid.UUID) (*QueueView, error) {
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

	award, err := s.deps.Store.LatestAwardForRequest(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeNotFound, "this request has no queued job")
	}
	if err != nil {
		return nil, asDomainError(err)
	}

	// The city currency's fraction digits phrase the fare in the ladder detail.
	digits := 0
	if config, cfgErr := s.config(ctx, request.CityID); cfgErr == nil {
		digits = config.CurrencyFractionDigits
	}

	now := s.now()
	driver := verifiedDriverView(award.DriverID.String(), request.VehicleClass)

	view := &QueueView{
		RequestID:       request.ID.String(),
		Version:         request.Version,
		AsOf:            now,
		Promotion:       PromotionNone,
		Driver:          driver,
		DriverFirstName: driver.DisplayName,
		FareMinor:       money(award.FareMinor, request.Currency),
		Steps:           []QueueStepView{},
		Eta:             QueueEtaView{Label: "Pickup estimate unavailable", InWindow: true, AsOf: now},
	}

	// The consented window and its uncertainty band.
	consentedLatest := 0
	if award.PickupWindow != nil {
		w := award.PickupWindow
		consentedLatest = w.ConsentedLatestSec
		if consentedLatest == 0 {
			consentedLatest = w.LatestSec
		}
		uncertainty := w.LatestSec - w.EarliestSec
		if uncertainty < 0 {
			uncertainty = 0
		}
		view.PickupWindow = &QueuePickupWindowView{
			EarliestSec:    w.EarliestSec,
			LatestSec:      w.LatestSec,
			EtaVersion:     w.EtaVersion,
			UncertaintySec: uncertainty,
		}
		view.WindowLabel = itoa(ceilMinutes(w.EarliestSec)) + "–" + itoa(ceilMinutes(consentedLatest)) + " min"

		predicted := w.PredictedSec
		if predicted == 0 {
			predicted = w.LatestSec
		}
		predictedMin := ceilMinutes(predicted)
		inWindow := !w.MissedEmitted && predicted <= consentedLatest
		predictedSec := predicted
		view.Eta = QueueEtaView{
			Label:      "About " + itoa(predictedMin) + " min",
			InWindow:   inWindow,
			EtaSeconds: &predictedSec,
			AsOf:       now,
		}
	}

	// The claim tells us where the job is and whether promotion is pending.
	var claim *Claim
	if c, claimErr := s.deps.Store.ClaimByAwardID(ctx, s.deps.Store.Pool(), award.ID); claimErr == nil {
		claim = c
		if claim.State == machine.MpClaimNext {
			view.Promotion = s.promotionStateOf(ctx, claim)
		}
	} else if !errors.Is(claimErr, domain.ErrNotFound) {
		return nil, asDomainError(claimErr)
	}

	// The composed lifecycle status, from the request/award/claim and — once a
	// ride exists — its live execution state.
	requestClosed := request.State != machine.MpRequestAwarded && request.State != machine.MpRequestExecution
	cancelled := award.State == machine.MpAwardCancelled ||
		(requestClosed && request.CloseReason != "" && request.CloseReason != "awarded")

	rideState := ""
	if award.ExecutionID != nil {
		if ride, rideErr := s.deps.Store.ExecutionRideRow(ctx, s.deps.Store.Pool(), *award.ExecutionID); rideErr == nil {
			rideState = ride.State
		} else if !errors.Is(rideErr, domain.ErrNotFound) {
			return nil, asDomainError(rideErr)
		}
	}

	switch {
	case cancelled:
		view.Status = QueueStatusCancelled
	case rideState != "":
		switch {
		case rideState == machine.RiderInProgress:
			view.Status = QueueStatusInProgress
		case rideState == machine.RiderDriverArrived || rideState == machine.RiderPinVerification:
			view.Status = QueueStatusArrived
		case rideState == machine.RiderDriverAssigned || rideState == machine.RiderMatching:
			view.Status = QueueStatusAssigned
		case machine.IsRiderActive(rideState):
			view.Status = QueueStatusInProgress
		default:
			view.Status = QueueStatusSettled
		}
	case view.Promotion == PromotionPending:
		view.Status = QueueStatusPromoting
	default:
		view.Status = QueueStatusQueued
	}

	// Permitted actions. A rider can cancel while the request is live; the exit
	// is fee-free once the estimate has broken the window they consented to.
	feeFree := false
	if award.PickupWindow != nil {
		feeFree = award.PickupWindow.MissedEmitted ||
			(consentedLatest > 0 && award.PickupWindow.PredictedSec > consentedLatest)
	}
	view.Actions = QueueActionsView{
		CanCancel:   !requestClosed && view.Status != QueueStatusCancelled,
		FeeFreeExit: feeFree && view.Status != QueueStatusCancelled,
	}

	view.Steps = s.queueSteps(view, driver.DisplayName, request.Currency, digits)
	view.Delayed = s.queueDelay(ctx, view, award, feeFree)
	return view, nil
}

// queueSteps renders the ladder for the tracker from the composed status.
func (s *Service) queueSteps(view *QueueView, driverName, currency string, digits int) []QueueStepView {
	if view.Status == QueueStatusCancelled {
		return []QueueStepView{}
	}
	chose := QueueStepView{
		Label:  "You chose " + driverName,
		Detail: "Fare fixed at " + formatMinor(view.FareMinor.AmountMinor, currency, digits),
		State:  "done",
	}
	switch view.Status {
	case QueueStatusQueued, QueueStatusPromoting:
		finishing := QueueStepView{Label: "Finishing their current trip", State: "active"}
		if view.Eta.EtaSeconds != nil {
			if view.Eta.InWindow {
				finishing.Detail = "About " + itoa(ceilMinutes(*view.Eta.EtaSeconds)) + " min remaining"
			} else {
				finishing.Detail = "Now estimated " + itoa(ceilMinutes(*view.Eta.EtaSeconds)) + " min"
			}
		}
		return []QueueStepView{chose, finishing, {Label: "Heading to you", State: "pending"}}
	case QueueStatusAssigned:
		return []QueueStepView{chose, {Label: "Finishing their current trip", State: "done"}, {Label: "Heading to you", State: "active"}}
	case QueueStatusArrived:
		return []QueueStepView{chose, {Label: "Finishing their current trip", State: "done"}, {Label: "Driver has arrived", State: "active"}}
	case QueueStatusInProgress, QueueStatusSettled:
		return []QueueStepView{chose, {Label: "Finishing their current trip", State: "done"}, {Label: "Your trip is under way", State: "done"}}
	default:
		return []QueueStepView{chose}
	}
}

// queueDelay composes the delay/cancellation notice. On a broken window it
// offers the fee-free exit; after a cancellation it surfaces the reversal state
// derived from the financial confirmation (never phrased as done before it is).
func (s *Service) queueDelay(ctx context.Context, view *QueueView, award *Award, feeFree bool) *QueueDelayView {
	if view.Status == QueueStatusCancelled {
		reversal := s.queueReversal(ctx, award)
		title := "Cancelled"
		body := "This request was cancelled. Money movements below settle as the events confirm."
		if feeFree {
			title = "Cancelled — free of charge"
			body = "The new estimate was outside the window you accepted, so this cancellation costs nothing. Money movements below settle as the events confirm."
		}
		return &QueueDelayView{
			NoticeTitle: title,
			NoticeBody:  body,
			KeepLabel:   "Search again instead",
			Reversal:    reversal,
		}
	}
	// A live job whose estimate broke the accepted window: offer the fee-free exit.
	if feeFree && view.Eta.EtaSeconds != nil {
		mins := ceilMinutes(*view.Eta.EtaSeconds)
		return &QueueDelayView{
			NoticeTitle: "Now estimated " + itoa(mins) + " min",
			NoticeBody:  "The pickup is now estimated beyond the window you accepted. You can keep waiting, or cancel free and search again — your money only moves when a trip happens.",
			KeepLabel:   "Keep waiting · new ETA " + itoa(mins) + " min",
			Reversal:    nil,
		}
	}
	return nil
}

// queueReversal reports the money-movement state after a cancellation: the
// winning bid's confirmed hold release drives it, so nothing reads as done
// before the financial event lands.
func (s *Service) queueReversal(ctx context.Context, award *Award) *QueueReversalView {
	released := false
	if bid, err := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), award.BidID); err == nil {
		released = bid.HoldReleasedAt != nil
	}
	if released {
		return &QueueReversalView{RiderHold: "released", DriverFee: "reversed"}
	}
	return &QueueReversalView{RiderHold: "releasing", DriverFee: "pending"}
}
