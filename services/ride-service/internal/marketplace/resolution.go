package marketplace

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// The unified resolution timeline (C08): request → award → funding →
// commission → execution → settlement/reversal → notification, stitched
// from ride-service's own tables plus the append-only outbox. Every stage
// is tagged with a status that a client renders distinctly:
//
//   - view       — informational, nothing pending
//   - proposed   — an action or outcome is in flight, not yet definite
//   - committed  — the effect landed
//   - failed     — the stage ended in a failure/refusal
//   - unavailable — the stage has not been reached, OR (notification) no
//     admin-reachable read exists for it — named, not fabricated.
const (
	StageView        = "view"
	StageProposed    = "proposed"
	StageCommitted   = "committed"
	StageFailed      = "failed"
	StageUnavailable = "unavailable"
)

// ResolutionStage is one segment of the timeline.
type ResolutionStage struct {
	Name   string     `json:"name"`
	Status string     `json:"status"`
	Detail string     `json:"detail"`
	At     *time.Time `json:"at,omitempty"`
}

// ResolutionAwardView is the award slice of the resolution view.
type ResolutionAwardView struct {
	AwardID          string    `json:"awardId"`
	State            string    `json:"state"`
	DriverID         string    `json:"driverId"`
	FareMinor        Money     `json:"fareMinor"`
	CommissionMinor  Money     `json:"commissionMinor"`
	CaptureReceiptID string    `json:"captureReceiptId,omitempty"`
	FailReason       string    `json:"failReason,omitempty"`
	SagaStep         string    `json:"sagaStep,omitempty"`
	SagaState        string    `json:"sagaState,omitempty"`
	SagaAttempts     int       `json:"sagaAttempts,omitempty"`
	Captured         bool      `json:"captured"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

// ResolutionExecutionView is the execution-ride slice.
type ResolutionExecutionView struct {
	RideID           string     `json:"rideId"`
	State            string     `json:"state"`
	Active           bool       `json:"active"`
	CancelledByRole  string     `json:"cancelledByRole,omitempty"`
	CancelReasonCode string     `json:"cancelReasonCode,omitempty"`
	CompletedAt      *time.Time `json:"completedAt,omitempty"`
	CancelledAt      *time.Time `json:"cancelledAt,omitempty"`
}

// ResolutionView answers GET /v1/admin/mp/requests/{id}/resolution: the
// single composed case file a resolution board opens.
type ResolutionView struct {
	RequestID     string                   `json:"requestId"`
	CityID        string                   `json:"cityId"`
	RequestState  string                   `json:"requestState"`
	CloseReason   string                   `json:"closeReason,omitempty"`
	Award         *ResolutionAwardView     `json:"award,omitempty"`
	Execution     *ResolutionExecutionView `json:"execution,omitempty"`
	Recoveries    []*RecoveryView          `json:"recoveries"`
	Stages        []*ResolutionStage       `json:"stages"`
	Events        []*TimelineEvent         `json:"events"`
	DriverBlocked *bool                    `json:"driverBlocked,omitempty"`
	Gaps          []string                 `json:"gaps"`
}

// AdminResolution composes the unified resolution timeline for one request.
// Every field is read from a table this or another C0x slice already writes;
// where no admin-reachable read exists anywhere (payment-service's wallet
// reservation/hold state by award id, and any notification-delivery
// outcome), the stage is marked StageUnavailable and the exact missing
// source is named in Gaps — never fabricated.
func (s *Service) AdminResolution(ctx context.Context, actor Actor, requestID uuid.UUID) (*ResolutionView, error) {
	if actor.Role != move.RoleAdmin {
		return nil, domain.Errorf(domain.CodeForbidden, "only an operator can read a resolution case")
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	events, err := s.outboxTimelineEvents(ctx, requestID)
	if err != nil {
		return nil, err
	}

	view := &ResolutionView{
		RequestID: request.ID.String(), CityID: request.CityID, RequestState: request.State,
		CloseReason: request.CloseReason, Recoveries: []*RecoveryView{}, Events: events, Gaps: []string{},
	}

	requestStage := &ResolutionStage{Name: "request", Status: StageView, Detail: "state: " + request.State}
	if isRequestTerminal(request.State) {
		requestStage.Status = StageCommitted
		if request.CloseReason != "" {
			requestStage.Detail += " (" + request.CloseReason + ")"
		}
	}
	view.Stages = append(view.Stages, requestStage)

	award, err := s.deps.Store.LatestAwardForRequest(ctx, s.deps.Store.Pool(), requestID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, asDomainError(err)
	}
	if award == nil {
		view.Stages = append(view.Stages,
			&ResolutionStage{Name: "award", Status: StageUnavailable, Detail: "no bid has been selected yet"},
			&ResolutionStage{Name: "funding", Status: StageUnavailable, Detail: "no award yet"},
			&ResolutionStage{Name: "commission", Status: StageUnavailable, Detail: "no award yet"},
			&ResolutionStage{Name: "execution", Status: StageUnavailable, Detail: "no award yet"},
			&ResolutionStage{Name: "settlement", Status: StageUnavailable, Detail: "no award yet"},
		)
	} else {
		attempt, attemptErr := s.deps.Store.AttemptFor(ctx, s.deps.Store.Pool(), award.ID)
		if attemptErr != nil && !errors.Is(attemptErr, domain.ErrNotFound) {
			return nil, asDomainError(attemptErr)
		}
		view.Award = &ResolutionAwardView{
			AwardID: award.ID.String(), State: award.State, DriverID: award.DriverID.String(),
			FareMinor: money(award.FareMinor, request.Currency), CommissionMinor: money(award.CommissionMinor, request.Currency),
			CaptureReceiptID: award.CaptureReceiptID, FailReason: award.FailReason, UpdatedAt: award.UpdatedAt,
		}
		if attempt != nil {
			view.Award.SagaStep = attempt.Step
			view.Award.SagaState = attempt.State
			view.Award.SagaAttempts = attempt.Attempts
			view.Award.Captured = attempt.Captured
		}
		view.Stages = append(view.Stages, awardStage(award))
		view.Stages = append(view.Stages, fundingStage(award, attempt))
		view.Stages = append(view.Stages, commissionStage(award, attempt))

		blocked, blockedErr := s.driverBlocked(ctx, award.DriverID)
		if blockedErr == nil {
			view.DriverBlocked = &blocked
		}

		if award.ExecutionID != nil {
			exec, execErr := s.deps.Store.ExecutionRideSummary(ctx, s.deps.Store.Pool(), *award.ExecutionID)
			if execErr != nil && !errors.Is(execErr, domain.ErrNotFound) {
				return nil, asDomainError(execErr)
			}
			if exec != nil {
				view.Execution = &ResolutionExecutionView{
					RideID: exec.RideID.String(), State: exec.State, Active: exec.Active,
					CancelledByRole: exec.CancelledByRole, CancelReasonCode: exec.CancelReasonCode,
					CompletedAt: exec.CompletedAt, CancelledAt: exec.CancelledAt,
				}
				view.Stages = append(view.Stages, executionStage(exec))
			}
		}
		if view.Execution == nil {
			view.Stages = append(view.Stages, &ResolutionStage{Name: "execution", Status: StageUnavailable, Detail: "no execution ride yet"})
		}

		recoveries, recErr := s.deps.Store.RecoveriesForBid(ctx, s.deps.Store.Pool(), award.BidID)
		if recErr != nil {
			return nil, asDomainError(recErr)
		}
		now := s.now()
		for _, r := range recoveries {
			view.Recoveries = append(view.Recoveries, toRecoveryView(r, now))
		}
		view.Stages = append(view.Stages, settlementStage(award, recoveries, view.Execution))
		// A06 part C: a business award's organization-budget funding is its
		// own saga (mpBusinessBooking) — shown as a stage so support sees an
		// owed commit/release and why it is still owed.
		if booking, bizErr := s.deps.Store.BusinessBookingByAward(ctx, s.deps.Store.Pool(), award.ID); bizErr == nil {
			view.Stages = append(view.Stages, businessFundingStage(booking))
		} else if !errors.Is(bizErr, domain.ErrNotFound) {
			return nil, asDomainError(bizErr)
		}
	}

	view.Stages = append(view.Stages, &ResolutionStage{
		Name: "notification", Status: StageUnavailable,
		Detail: "no admin-reachable read exists for notification delivery outcomes (notification-service's DLQ/pending keys are internal Redis state with no exposed endpoint) — gap, not fabricated",
	})
	view.Gaps = append(view.Gaps,
		"funding/commission stages reflect ride-service's own saga bookkeeping only — no payment-service endpoint reachable by admin-dashboard independently verifies wallet reservation/hold state by award id",
		"notification delivery outcomes are not readable by any admin surface today (notification-service DLQ/pending Redis keys have no admin endpoint)",
	)
	return view, nil
}

func isRequestTerminal(state string) bool {
	switch state {
	case machine.MpRequestCancelled, machine.MpRequestExpired, machine.MpRequestNoOffers,
		machine.MpRequestAwarded, machine.MpRequestExecution:
		return true
	default:
		return false
	}
}

func awardStage(award *Award) *ResolutionStage {
	switch award.State {
	case machine.MpAwardPending:
		return &ResolutionStage{Name: "award", Status: StageProposed, Detail: "awaiting saga resolution"}
	case machine.MpAwardConfirmed:
		return &ResolutionStage{Name: "award", Status: StageCommitted, Detail: "confirmed", At: &award.UpdatedAt}
	case machine.MpAwardFailed, machine.MpAwardCancelled:
		detail := award.FailReason
		if detail == "" {
			detail = award.State
		}
		return &ResolutionStage{Name: "award", Status: StageFailed, Detail: detail, At: &award.UpdatedAt}
	default:
		return &ResolutionStage{Name: "award", Status: StageView, Detail: award.State}
	}
}

// fundingStage infers the rider-funding step's outcome from the saga's
// recorded position: Funding runs before Capture and Finalize, so an award
// that ever reached those steps (or a terminal state past them) necessarily
// funded first. This is ride-service's OWN record of what it asked
// payment-service to do — see the named gap in AdminResolution.
func fundingStage(award *Award, attempt *AwardAttempt) *ResolutionStage {
	if attempt == nil {
		if award.State == machine.MpAwardConfirmed {
			return &ResolutionStage{Name: "funding", Status: StageCommitted, Detail: "inferred funded (award confirmed)"}
		}
		return &ResolutionStage{Name: "funding", Status: StageView, Detail: "no saga record"}
	}
	switch attempt.Step {
	case AttemptStepFunding:
		if attempt.State == AttemptStateUnknown {
			return &ResolutionStage{Name: "funding", Status: StageProposed, Detail: "funding outcome unknown; the sweep is re-polling"}
		}
		return &ResolutionStage{Name: "funding", Status: StageProposed, Detail: "funding authorization in flight"}
	case AttemptStepCapture, AttemptStepHandoff, AttemptStepFinalize:
		return &ResolutionStage{Name: "funding", Status: StageCommitted, Detail: "funding step completed before capture"}
	case AttemptStepCompensate:
		return &ResolutionStage{Name: "funding", Status: StageFailed, Detail: "compensating: " + attempt.LastError}
	default:
		return &ResolutionStage{Name: "funding", Status: StageView, Detail: attempt.Step}
	}
}

func commissionStage(award *Award, attempt *AwardAttempt) *ResolutionStage {
	if award.CaptureReceiptID != "" {
		return &ResolutionStage{Name: "commission", Status: StageCommitted, Detail: "captured, receipt " + award.CaptureReceiptID}
	}
	if attempt != nil {
		switch attempt.Step {
		case AttemptStepCapture:
			return &ResolutionStage{Name: "commission", Status: StageProposed, Detail: "capture in flight"}
		case AttemptStepCompensate:
			if attempt.Captured {
				return &ResolutionStage{Name: "commission", Status: StageFailed, Detail: "captured fee is being reversed"}
			}
			return &ResolutionStage{Name: "commission", Status: StageView, Detail: "never captured; nothing to reverse"}
		}
	}
	if award.State == machine.MpAwardFailed || award.State == machine.MpAwardCancelled {
		return &ResolutionStage{Name: "commission", Status: StageView, Detail: "not captured"}
	}
	return &ResolutionStage{Name: "commission", Status: StageUnavailable, Detail: "not reached yet"}
}

func executionStage(exec *ExecutionRideSummary) *ResolutionStage {
	switch exec.State {
	case machine.RiderCompleted:
		return &ResolutionStage{Name: "execution", Status: StageCommitted, Detail: "completed", At: exec.CompletedAt}
	case machine.RiderCancelledByDriver, machine.RiderCancelledByRider, machine.RiderCancelledByOps, machine.RiderNoShow:
		detail := exec.State
		if exec.CancelReasonCode != "" {
			detail += " (" + exec.CancelReasonCode + ")"
		}
		return &ResolutionStage{Name: "execution", Status: StageFailed, Detail: detail, At: exec.CancelledAt}
	default:
		return &ResolutionStage{Name: "execution", Status: StageView, Detail: exec.State}
	}
}

func settlementStage(award *Award, recoveries []*RecoveryRow, exec *ResolutionExecutionView) *ResolutionStage {
	for _, r := range recoveries {
		if r.ResolvedAt != nil {
			continue
		}
		switch r.Action {
		case RecoverySettle:
			return &ResolutionStage{Name: "settlement", Status: StageProposed, Detail: "settlement pending; the sweep is retrying"}
		case RecoveryReverse, RecoveryFundingRelease:
			return &ResolutionStage{Name: "settlement", Status: StageProposed, Detail: "reversal/release pending; the sweep is retrying"}
		}
	}
	if exec != nil && exec.State == machine.RiderCompleted {
		return &ResolutionStage{Name: "settlement", Status: StageCommitted, Detail: "settled (no unresolved recovery for this award)"}
	}
	if award.State == machine.MpAwardCancelled || award.State == machine.MpAwardFailed {
		return &ResolutionStage{Name: "settlement", Status: StageCommitted, Detail: "resolved via compensation (no unresolved recovery for this award)"}
	}
	return &ResolutionStage{Name: "settlement", Status: StageUnavailable, Detail: "not reached yet"}
}

// businessFundingStage renders a business award's budget funding for the
// resolution board.
func businessFundingStage(b *BusinessBooking) *ResolutionStage {
	stage := &ResolutionStage{Name: "business_funding", At: &b.UpdatedAt}
	switch {
	case b.OwedOp != "":
		stage.Status = StageProposed
		stage.Detail = "the organization's budget " + b.OwedOp + " is owed (booking ref " + b.BookingRef + "); the sweep is retrying"
		if b.LastError != "" {
			stage.Detail += ": " + b.LastError
		}
	case b.State == machine.MpBusinessReserving:
		stage.Status = StageProposed
		stage.Detail = "reserving the organization's budget for the awarded fare"
	case b.State == machine.MpBusinessRefused:
		stage.Status = StageFailed
		stage.Detail = "the organization refused the reservation (" + b.RefusalReason + "); nothing was put on credit"
	case b.State == machine.MpBusinessReleased:
		stage.Status = StageCommitted
		stage.Detail = "the reservation was released by the " + b.ReleaseParty
	case b.State == machine.MpBusinessCommitted:
		stage.Status = StageCommitted
		stage.Detail = "the actual total was committed from the organization's budget"
	default:
		stage.Status = StageCommitted
		stage.Detail = "the organization's budget holds the awarded fare"
	}
	return stage
}
