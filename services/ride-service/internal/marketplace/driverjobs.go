package marketplace

import (
	"context"
	"errors"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// Promotion states the jobs projection reports (contract DriverJobs.promotion).
const (
	PromotionNone = "none"
	// PromotionPending: the queued claim's dependency has finished and the
	// promotion is being driven (by the completion callback or the sweep).
	PromotionPending = "pending"
	// PromotionFailedRevalidating: the dependency has finished but the queued
	// award's consented pickup window is already broken, so the promotion is
	// revalidating rather than silently starting a late job.
	PromotionFailedRevalidating = "failed_revalidating"
)

// DriverJobs answers GET /v1/mp/driver/jobs (D05 winner card, D11
// current-plus-next timeline): the driver's claims projection with each job's
// money, receipt, execution reference and — for the queued job — the pickup
// window, plus the promotion state.
func (s *Service) DriverJobs(ctx context.Context, actor Actor) (*DriverJobsView, error) {
	if !actor.IsDriver() {
		return nil, domain.Errorf(domain.CodeForbidden, "only a driver has marketplace jobs")
	}

	view := &DriverJobsView{Promotion: PromotionNone}

	current, err := s.deps.Store.CurrentClaim(ctx, s.deps.Store.Pool(), actor.UserID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, asDomainError(err)
	}
	if current != nil {
		job, jobErr := s.driverJobOf(ctx, current)
		if jobErr != nil {
			return nil, jobErr
		}
		view.Current = job
	}

	next, err := s.deps.Store.NextClaim(ctx, s.deps.Store.Pool(), actor.UserID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, asDomainError(err)
	}
	if next != nil {
		job, jobErr := s.driverJobOf(ctx, next)
		if jobErr != nil {
			return nil, jobErr
		}
		view.Next = job
		view.Promotion = s.promotionStateOf(ctx, next)
	}
	return view, nil
}

// driverJobOf renders one claim with its award's money and execution.
func (s *Service) driverJobOf(ctx context.Context, claim *Claim) (*DriverJobView, error) {
	job := &DriverJobView{
		ClaimID: claim.ID.String(),
		Slot:    claim.Slot,
		Service: claim.Service,
		State:   claim.State,
	}
	if claim.ExecutionID != nil {
		service := claim.ExecutionService
		if service == "" {
			service = ServiceRide
		}
		job.ExecutionRef = &ExecutionRefView{Service: service, ID: claim.ExecutionID.String()}
	}
	if claim.AwardID == nil {
		return job, nil
	}
	award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), *claim.AwardID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return job, nil
		}
		return nil, asDomainError(err)
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), award.RequestID)
	if err != nil {
		return nil, asDomainError(err)
	}
	job.RequestID = award.RequestID.String()
	job.FareMinor = money(award.FareMinor, request.Currency)
	job.CommissionMinor = money(award.CommissionMinor, request.Currency)
	if award.CaptureReceiptID != "" {
		receipt := award.CaptureReceiptID
		job.ReceiptID = &receipt
	}
	if job.ExecutionRef == nil && award.ExecutionID != nil {
		service := award.ExecutionService
		if service == "" {
			service = ServiceRide
		}
		job.ExecutionRef = &ExecutionRefView{Service: service, ID: award.ExecutionID.String()}
	}
	// A06 part B: a trip booked for another adult names the passenger's
	// first name and the pickup verification, nothing more.
	job.Passenger = s.driverPassengerFor(ctx, request)
	if award.PickupWindow != nil {
		job.PickupWindow = &PickupWindow{
			EarliestSec: award.PickupWindow.EarliestSec,
			LatestSec:   award.PickupWindow.LatestSec,
			EtaVersion:  award.PickupWindow.EtaVersion,
		}
	}
	return job, nil
}

// promotionStateOf reports where the queued claim's promotion stands: none
// while its dependency still runs, pending once the dependency finished, and
// failed_revalidating when the consented window was already missed.
func (s *Service) promotionStateOf(ctx context.Context, next *Claim) string {
	if next.State != machine.MpClaimNext {
		return PromotionNone
	}
	dependencyDone := next.DependsOnClaimID == nil
	if next.DependsOnClaimID != nil {
		dep, err := s.deps.Store.ClaimByID(ctx, s.deps.Store.Pool(), *next.DependsOnClaimID)
		if errors.Is(err, domain.ErrNotFound) {
			dependencyDone = true
		} else if err == nil {
			dependencyDone = dep.State == machine.MpClaimCompleted || dep.State == machine.MpClaimReleased
		}
	}
	if !dependencyDone {
		return PromotionNone
	}
	if next.AwardID != nil {
		if award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), *next.AwardID); err == nil &&
			award.PickupWindow != nil && award.PickupWindow.MissedEmitted {
			return PromotionFailedRevalidating
		}
	}
	return PromotionPending
}
