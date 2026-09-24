package marketplace

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// subjectAmendment is the event subject of the amendment aggregate
// (packages/contracts/src/events.ts SUBJECT_TYPES).
const subjectAmendment = "mp_amendment"

// TripPlaceView is a trip endpoint as the two parties to an award see it.
type TripPlaceView struct {
	Label string  `json:"label"`
	Lat   float64 `json:"lat"`
	Lng   float64 `json:"lng"`
}

func tripPlaceOf(area Area) TripPlaceView {
	return TripPlaceView(area)
}

// AmendmentApprovalView is one party's approval state.
type AmendmentApprovalView struct {
	Approved   bool       `json:"approved"`
	ApprovedAt *time.Time `json:"approvedAt,omitempty"`
}

// AmendmentApprovalsView is both parties' approval state.
type AmendmentApprovalsView struct {
	Rider  AmendmentApprovalView `json:"rider"`
	Driver AmendmentApprovalView `json:"driver"`
}

// AmendmentView is one amendment as a party sees it (MpAmendmentSchema).
// Every amount is server-computed: the revised total, the delta, what the
// rider's funding must add (or gets back). The driver additionally sees the
// incremental commission and their net change; the rider never sees the
// driver's commission.
type AmendmentView struct {
	AmendmentID            string                 `json:"amendmentId"`
	RequestID              string                 `json:"requestId"`
	AwardID                string                 `json:"awardId"`
	Kind                   string                 `json:"kind"`
	State                  string                 `json:"state"`
	ProposedByRole         string                 `json:"proposedByRole"`
	BaseRouteRevision      int                    `json:"baseRouteRevision"`
	BaseFareRevision       int                    `json:"baseFareRevision"`
	RouteRevision          int                    `json:"routeRevision"`
	FareRevision           int                    `json:"fareRevision"`
	Stops                  []RouteStop            `json:"stops"`
	Dropoff                TripPlaceView          `json:"dropoff"`
	PriorFareMinor         Money                  `json:"priorFareMinor"`
	RevisedFareMinor       Money                  `json:"revisedFareMinor"`
	FareDeltaMinor         Money                  `json:"fareDeltaMinor"`
	RiderFundingDeltaMinor Money                  `json:"riderFundingDeltaMinor"`
	RiderFunding           string                 `json:"riderFunding"`
	CommissionDeltaMinor   *Money                 `json:"commissionDeltaMinor,omitempty"`
	DriverNetDeltaMinor    *Money                 `json:"driverNetDeltaMinor,omitempty"`
	AddedDistanceMeters    int64                  `json:"addedDistanceMeters"`
	AddedDurationSec       int64                  `json:"addedDurationSec"`
	Approvals              AmendmentApprovalsView `json:"approvals"`
	ExpiresAt              time.Time              `json:"expiresAt"`
	Reason                 string                 `json:"reason,omitempty"`
	Pricing                map[string]any         `json:"pricing,omitempty"`
	CreatedAt              time.Time              `json:"createdAt"`
	ResolvedAt             *time.Time             `json:"resolvedAt,omitempty"`
}

// AmendmentListView answers GET .../amendments: the trip's committed terms
// and every change ever proposed on it.
type AmendmentListView struct {
	RequestID       string           `json:"requestId"`
	RouteRevision   int              `json:"routeRevision"`
	FareRevision    int              `json:"fareRevision"`
	AgreedFareMinor Money            `json:"agreedFareMinor"`
	Amendments      []*AmendmentView `json:"amendments"`
}

// riderFundingState names the rider-side money of an amendment honestly:
// what is reserved, committed or released — or that nothing is needed.
func riderFundingState(amendment *Amendment, secured bool) string {
	delta := amendment.fundingDelta()
	switch {
	case !secured:
		return "unsecured_cash"
	case delta == 0:
		return "not_required"
	case delta < 0 && amendment.State == machine.MpAmendmentCommitted:
		return "partially_released"
	case delta < 0:
		return "release_on_commit"
	case amendment.State == machine.MpAmendmentCommitted:
		return "committed"
	case amendment.State == machine.MpAmendmentProposed:
		return "pending"
	case amendment.State == machine.MpAmendmentAwaiting:
		return "reserved"
	default:
		return "released"
	}
}

// amendmentViewFor renders one amendment for a party.
func (s *Service) amendmentViewFor(ctx context.Context, amendment *Amendment, role string) *AmendmentView {
	secured, business := true, false
	if route, err := s.deps.Store.ExecutionRouteByAward(ctx, s.deps.Store.Pool(), amendment.AwardID); err == nil {
		secured, business = route.securedFunding(), route.businessFunded()
	}
	currency := amendment.Currency
	stops := amendment.Stops
	if stops == nil {
		stops = []RouteStop{}
	}
	view := &AmendmentView{
		AmendmentID:            amendment.ID.String(),
		RequestID:              amendment.RequestID.String(),
		AwardID:                amendment.AwardID.String(),
		Kind:                   amendment.Kind,
		State:                  amendment.State,
		ProposedByRole:         amendment.ProposedByRole,
		BaseRouteRevision:      amendment.BaseRouteRevision,
		BaseFareRevision:       amendment.BaseFareRevision,
		RouteRevision:          amendment.RouteRevision,
		FareRevision:           amendment.FareRevision,
		Stops:                  stops,
		Dropoff:                tripPlaceOf(amendment.Dropoff),
		PriorFareMinor:         money(amendment.PriorFareMinor, currency),
		RevisedFareMinor:       money(amendment.RevisedFareMinor, currency),
		FareDeltaMinor:         money(amendment.fareDelta(), currency),
		RiderFundingDeltaMinor: money(amendment.fundingDelta(), currency),
		RiderFunding:           riderFundingState(amendment, secured),
		AddedDistanceMeters:    amendment.AddedDistanceM,
		AddedDurationSec:       amendment.AddedDurationSec,
		Approvals: AmendmentApprovalsView{
			Rider:  AmendmentApprovalView{Approved: amendment.RiderApprovedAt != nil, ApprovedAt: amendment.RiderApprovedAt},
			Driver: AmendmentApprovalView{Approved: amendment.DriverApprovedAt != nil, ApprovedAt: amendment.DriverApprovedAt},
		},
		ExpiresAt:  amendment.ExpiresAt,
		Reason:     amendmentReasonFor(role, amendment.Reason),
		CreatedAt:  amendment.CreatedAt,
		ResolvedAt: amendment.ResolvedAt,
	}
	if business {
		// A business trip has no rider funding at all: the organization's
		// budget reservation covers the agreed fare (raised before an
		// increase commits) and completion commits the actual.
		view.RiderFunding = "not_required"
	}
	if role == partyDriver {
		commission := money(amendment.commissionDelta(), currency)
		net := money(amendment.fareDelta()-amendment.commissionDelta(), currency)
		view.CommissionDeltaMinor = &commission
		view.DriverNetDeltaMinor = &net
		view.Pricing = amendment.Pricing
	}
	return view
}

// WaitingTermsView publishes the paid stop-waiting terms of a trip.
type WaitingTermsView struct {
	IncludedBasis      string `json:"includedBasis"`
	PerMinMinor        Money  `json:"perMinMinor"`
	MaxAuthorizedMinor Money  `json:"maxAuthorizedMinor"`
	AuthorizedCapMinor Money  `json:"authorizedCapMinor"`
	CapRevision        int    `json:"capRevision"`
	CommittedMinor     Money  `json:"committedMinor"`
	ExcessiveAfterSec  int    `json:"excessiveAfterSec"`
	GeofenceMeters     int    `json:"geofenceMeters"`
}

// StopWaitingView is one stop's waiting, as the server measures it.
type StopWaitingView struct {
	WaitedSec             int64  `json:"waitedSec"`
	IncludedSec           int64  `json:"includedSec"`
	AllowanceRemainingSec int64  `json:"allowanceRemainingSec"`
	PaidSec               int64  `json:"paidSec"`
	FeeMinor              Money  `json:"feeMinor"`
	Accruing              bool   `json:"accruing"`
	ApprovalRequired      bool   `json:"approvalRequired"`
	Excessive             bool   `json:"excessive"`
	Settlement            string `json:"settlement"`
}

// TripStopView is one stop of an executing trip.
type TripStopView struct {
	StopID                string           `json:"stopId"`
	Order                 int              `json:"order"`
	State                 string           `json:"state"`
	Label                 string           `json:"label"`
	Purpose               string           `json:"purpose"`
	Lat                   float64          `json:"lat"`
	Lng                   float64          `json:"lng"`
	DwellSec              int              `json:"dwellSec"`
	ArrivedAt             *time.Time       `json:"arrivedAt,omitempty"`
	ArrivalDisputed       bool             `json:"arrivalDisputed"`
	ArrivalDistanceMeters *int             `json:"arrivalDistanceMeters,omitempty"`
	DepartedAt            *time.Time       `json:"departedAt,omitempty"`
	SkippedAt             *time.Time       `json:"skippedAt,omitempty"`
	SkipReason            string           `json:"skipReason,omitempty"`
	Waiting               *StopWaitingView `json:"waiting,omitempty"`
}

// TripAdjustmentView is one committed line of the receipt.
type TripAdjustmentView struct {
	AmendmentID    string    `json:"amendmentId"`
	Kind           string    `json:"kind"`
	FareDeltaMinor Money     `json:"fareDeltaMinor"`
	FareRevision   int       `json:"fareRevision"`
	CommittedAt    time.Time `json:"committedAt"`
}

// TripView is an executing trip's committed terms and stop states
// (MpTripSchema): the receipt reconciles as original fare + committed
// adjustments = agreed fare, and nothing uncommitted ever appears in it.
type TripView struct {
	RequestID               string               `json:"requestId"`
	AwardID                 string               `json:"awardId"`
	ExecutionID             string               `json:"executionId"`
	RouteRevision           int                  `json:"routeRevision"`
	FareRevision            int                  `json:"fareRevision"`
	OriginalFareMinor       Money                `json:"originalFareMinor"`
	AgreedFareMinor         Money                `json:"agreedFareMinor"`
	CommittedAdjustments    []TripAdjustmentView `json:"committedAdjustments"`
	CapturedCommissionMinor *Money               `json:"capturedCommissionMinor,omitempty"`
	Pickup                  TripPlaceView        `json:"pickup"`
	Dropoff                 TripPlaceView        `json:"dropoff"`
	Stops                   []TripStopView       `json:"stops"`
	WaitingTerms            WaitingTermsView     `json:"waitingTerms"`
	OpenAmendmentID         *string              `json:"openAmendmentId,omitempty"`
	TerminatedAt            *time.Time           `json:"terminatedAt,omitempty"`
	Version                 int                  `json:"version"`
}

// TripView answers GET /v1/mp/requests/{id}/trip for either party. It reads
// only; waiting figures are computed from the server's timestamps at `now`.
func (s *Service) TripView(ctx context.Context, actor Actor, requestID uuid.UUID) (*TripView, error) {
	trip, err := s.tripFor(ctx, actor, requestID, cityconfig.FlagMarketplaceMultiStop)
	if err != nil {
		// A trip without stops is still viewable behind the amendments flag.
		mapped, ok := domain.AsError(err)
		if !ok || mapped.Code != domain.CodeFeatureDisabled {
			return nil, err
		}
		if trip, err = s.tripFor(ctx, actor, requestID, cityconfig.FlagMarketplaceTripAmendments); err != nil {
			return nil, err
		}
	}
	route := trip.route
	stops, err := s.deps.Store.ExecutionStops(ctx, s.deps.Store.Pool(), route.AwardID)
	if err != nil {
		return nil, asDomainError(err)
	}
	amendments, err := s.deps.Store.AmendmentsForAward(ctx, s.deps.Store.Pool(), route.AwardID)
	if err != nil {
		return nil, asDomainError(err)
	}
	now := s.now()
	currency := route.Currency
	view := &TripView{
		RequestID:            route.RequestID.String(),
		AwardID:              route.AwardID.String(),
		ExecutionID:          route.ExecutionID.String(),
		RouteRevision:        route.RouteRevision,
		FareRevision:         route.FareRevision,
		OriginalFareMinor:    money(route.OriginalFareMinor, currency),
		AgreedFareMinor:      money(route.AgreedFareMinor, currency),
		CommittedAdjustments: []TripAdjustmentView{},
		Pickup:               tripPlaceOf(route.Pickup),
		Dropoff:              tripPlaceOf(route.Dropoff),
		Stops:                []TripStopView{},
		WaitingTerms: WaitingTermsView{
			IncludedBasis:      route.WaitingTerms.IncludedBasis,
			PerMinMinor:        money(route.WaitingTerms.PerMinMinor, currency),
			MaxAuthorizedMinor: money(route.WaitingTerms.MaxAuthorizedMinor, currency),
			AuthorizedCapMinor: money(route.WaitingCapMinor, currency),
			CapRevision:        route.CapRevision,
			CommittedMinor:     money(route.WaitingCommittedMinor, currency),
			ExcessiveAfterSec:  route.WaitingTerms.ExcessiveAfterSec,
			GeofenceMeters:     route.WaitingTerms.GeofenceMeters,
		},
		TerminatedAt: route.TerminatedAt,
		Version:      route.Version,
	}
	if trip.role == partyDriver {
		captured := money(route.CapturedCommissionMinor, currency)
		view.CapturedCommissionMinor = &captured
	}
	for _, amendment := range amendments {
		if amendment.State == machine.MpAmendmentCommitted {
			committedAt := amendment.UpdatedAt
			if amendment.ResolvedAt != nil {
				committedAt = *amendment.ResolvedAt
			}
			view.CommittedAdjustments = append(view.CommittedAdjustments, TripAdjustmentView{
				AmendmentID:    amendment.ID.String(),
				Kind:           amendment.Kind,
				FareDeltaMinor: money(amendment.fareDelta(), currency),
				FareRevision:   amendment.FareRevision,
				CommittedAt:    committedAt,
			})
		}
		if amendment.MoneyOpen {
			id := amendment.ID.String()
			view.OpenAmendmentID = &id
		}
	}
	for _, stop := range stops {
		if stop.State == StopStateRemoved {
			continue
		}
		stopView := TripStopView{
			StopID:                stop.StopID.String(),
			Order:                 stop.Order,
			State:                 stop.State,
			Label:                 stop.Label,
			Purpose:               stop.Purpose,
			Lat:                   stop.Lat,
			Lng:                   stop.Lng,
			DwellSec:              stop.DwellSec,
			ArrivedAt:             stop.ArrivedAt,
			ArrivalDisputed:       stop.ArrivalDisputed,
			ArrivalDistanceMeters: stop.ArrivalDistanceM,
			DepartedAt:            stop.DepartedAt,
			SkippedAt:             stop.SkippedAt,
			SkipReason:            stop.SkipReason,
		}
		if stop.ArrivedAt != nil {
			end := now
			if stop.DepartedAt != nil {
				end = *stop.DepartedAt
			} else if stop.SkippedAt != nil {
				end = *stop.SkippedAt
			}
			waiting := waitingOf(stop, route.WaitingTerms, remainingCapFor(route, stops, stop.StopID), end)
			fee := waiting.feeMinor
			if stop.State != StopStateArrived {
				fee = stop.WaitingFeeMinor
			}
			allowanceLeft := waiting.includedSec - waiting.waitedSec
			if allowanceLeft < 0 || stop.WaitStartedAt == nil {
				allowanceLeft = 0
				if stop.WaitStartedAt == nil {
					allowanceLeft = waiting.includedSec
				}
			}
			stopView.Waiting = &StopWaitingView{
				WaitedSec:             waiting.waitedSec,
				IncludedSec:           waiting.includedSec,
				AllowanceRemainingSec: allowanceLeft,
				PaidSec:               waiting.paidSec,
				FeeMinor:              money(fee, currency),
				Accruing:              stop.State == StopStateArrived && waiting.paidSec > 0 && !waiting.approvalRequired,
				ApprovalRequired:      stop.State == StopStateArrived && waiting.approvalRequired,
				Excessive:             waiting.excessive,
				Settlement:            stop.WaitingSettlement,
			}
		}
		view.Stops = append(view.Stops, stopView)
	}
	return view, nil
}
