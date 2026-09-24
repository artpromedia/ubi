package marketplace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// Business marketplace rides (A06 part C, behind business_travel AND the ride
// vertical; packages/contracts/src/business-travel.ts).
//
// A request may be BOOKED ON AN ORGANIZATION. The three roles stay apart:
//
//   - the PAYER is the organization: its prefunded budget in payment-service
//     funds the trip INSTEAD OF the rider's personal funding — never both
//     (the request's payment method is `business`; no rider funding is ever
//     authorized for it);
//   - the BOOKER is the authenticated requester, allowed by the
//     organization's policy (payment-service derives the authority from the
//     ACTIVE membership — ride-service never asserts a role);
//   - the TRAVELLER is the passenger, an active member. When it is not the
//     booker, the booking names them as the round-6 guest passenger (their
//     trip link, the driver's first-name card), so nothing about the booker
//     reaches the traveller and nothing about the organization reaches the
//     driver.
//
// The money follows the contract's sequence, one award = one booking ref:
//
//  1. QUOTE    — POST /policy-check at the suggested fare: an out-of-policy
//     or unfunded option is shown unavailable with its reasons.
//  2. PUBLISH  — the policy check again at the requested fare; a refusal
//     (service, class, per-trip cap, cost centre, membership, no budget,
//     insufficient budget) refuses the publish with its reason. No money.
//  3. SELECT   — the check at the offer's amount (refused synchronously,
//     before any award is started), then the award saga RESERVES the agreed
//     fare under business:<awardId>:reserve in its funding step (the step
//     that authorizes rider funding for a personal trip). A definite refusal
//     compensates the award before any transport is promised; an unknown
//     outcome parks the award and is reconciled through GET
//     /reservations/:bookingRef before the SAME key is re-sent. The
//     driver's 10% commission hold and its ONE capture at selection are
//     untouched — the organization is never charged it.
//  4. COMPLETE — the ACTUAL total (agreed fare + committed adjustments,
//     derived exactly like a personal settlement, never above the
//     reservation) is COMMITTED under business:<awardId>:commit, owed
//     durably in the claim-completion transaction. A total that grows — an
//     approved fare increase, paid waiting — first raises the reservation
//     (POST /reserve-top-up under business:<awardId>:topup:<amendmentId>)
//     in the amendment's funding leg, BEFORE the raised total commits; a
//     refusal (no budget, the per-trip cap) fails the amendment into
//     compensation and the original agreement stands. So the actual can
//     never exceed what was reserved. The rider's personal settlement is
//     never called for a business award.
//  5. CANCEL   — the reservation is RELEASED under business:<awardId>:release,
//     owed durably in the transaction that ends the award: compensation, a
//     driver cancellation, an ops cancellation or a no-show release as the
//     system; the passenger's free decline through their trip link as the
//     traveller; the requester's cancel before pickup as the booker (or as
//     the traveller when they booked for themselves). If payment-service
//     refuses that party (the booker left the organization), the trip has
//     still ended without service, so the release is re-sent as the system
//     under its own key — the budget is never stranded.
//
// Every owed op lives on the mp.business_bookings row (owed_op) and is
// driven after commit and then by the sweep until payment-service answers
// definitely. Every state move is an mpBusinessBooking transition with its
// business_booking.* event and audit row.

// PaymentMethodBusiness is the payment method of a request booked on an
// organization: the budget pays; no rider funding exists for it.
const PaymentMethodBusiness = "business"

// PaymentMethodPaidByUBI (MP_PAID_BY_UBI_METHOD) is what the DRIVER is told
// about a business trip's payment: paid through UBI, nothing to collect, and
// no payer details (BUSINESS_VISIBILITY). The execution ride — read by the
// driver's ride views and published in every ride.* event — carries it
// instead of `business`; the requester's marketplace views keep `business`.
const PaymentMethodPaidByUBI = "paid_by_ubi"

// executionPaymentMethod is the payment method an execution ride carries: a
// business request's becomes paid_by_ubi; any other is the requester's own
// (cash stays cash — the driver must know to collect it).
func executionPaymentMethod(requestMethod string) string {
	if requestMethod == PaymentMethodBusiness {
		return PaymentMethodPaidByUBI
	}
	return requestMethod
}

// Business booking owed ops.
const (
	businessOpCommit  = "commit"
	businessOpRelease = "release"
)

// subjectBusinessBooking is the outbox subject of the business_booking.*
// events (never mp.*: nothing about the organization reaches the driver).
const subjectBusinessBooking = "business_booking"

// Business publish refusal reasons of ride-service's own (details.reason).
const (
	ReasonBusinessPassengerRequired = "business_passenger_required"
	ReasonBusinessPaymentMethod     = "business_payment_method"
	ReasonBusinessServiceUnsupport  = "business_service_unsupported"
	ReasonBusinessCheckUnavailable  = "business_check_unavailable"
)

// businessTopUpMarker tags a refused reserve top-up's details (topUp), so
// the amendment names the organization's refusal (business_<reason>), never
// the driver's spendable.
const businessTopUpMarker = "business"

// businessOpBackoffCap bounds how long a stuck owed op waits between drives.
const businessOpBackoffCap = 10 * time.Minute

var (
	businessIDPattern       = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,64}$`)
	expenseCategoryPattern  = regexp.MustCompile(`^[A-Za-z0-9 ._-]{1,64}$`)
	businessReasonSanitizer = regexp.MustCompile(`[^a-z0-9_]+`)
)

// BusinessInput is the optional `business` object of POST /v1/mp/requests
// (MpBusinessBookingInputSchema). TravellerID defaults to the requester.
type BusinessInput struct {
	OrganizationID  string     `json:"organizationId"`
	CostCentreID    string     `json:"costCentreId,omitempty"`
	ExpenseCategory string     `json:"expenseCategory,omitempty"`
	TravellerID     *uuid.UUID `json:"travellerId,omitempty"`
}

// BusinessQuoteInput asks the quote to check an organization's policy.
type BusinessQuoteInput struct {
	OrganizationID string
	CostCentreID   string
	TravellerID    *uuid.UUID
}

// RequestBusiness is one mp.request_business row: the business terms a
// request was published under.
type RequestBusiness struct {
	RequestID       uuid.UUID
	OrganizationID  string
	CostCentreID    string
	ExpenseCategory string
	BookerID        uuid.UUID
	TravellerID     uuid.UUID
	CityID          string
	PolicyVersion   *int
	CheckedCentreID string
	CreatedAt       time.Time
}

// BusinessBooking is one mp.business_bookings row: one award's budget
// funding (machine mpBusinessBooking).
type BusinessBooking struct {
	AwardID         uuid.UUID
	RequestID       uuid.UUID
	BookingRef      string
	OrganizationID  string
	CostCentreID    string
	ExpenseCategory string
	BookerID        uuid.UUID
	TravellerID     uuid.UUID
	CityID          string
	Service         string
	VehicleClass    string
	Currency        string
	ReservedMinor   int64
	State           string
	Version         int
	ReservationID   string
	BudgetID        string
	PolicyVersion   *int
	RefusalReason   string
	OwedOp          string
	ReleaseParty    string
	ReleaseUserID   *uuid.UUID
	ReleaseReason   string
	CommittedMinor  *int64
	CommitEntryID   string
	Taxes           []BusinessTaxLine
	Billing         *BusinessReservationStatus
	Attempts        int
	NextAttemptAt   *time.Time
	LastError       string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	ResolvedAt      *time.Time
}

// businessKey is the ONE idempotency key an award's budget op is ever sent
// under (contract: business:<awardId>:<op>).
func businessKey(awardID uuid.UUID, op string) string {
	return "business:" + awardID.String() + ":" + op
}

// businessReleaseReason turns an internal reason into the snake_case code
// the release contract accepts (^[a-z0-9_]+$, at most 64 characters).
func businessReleaseReason(reason string) string {
	code := strings.Trim(businessReasonSanitizer.ReplaceAllString(strings.ToLower(reason), "_"), "_")
	if code == "" {
		code = "cancelled"
	}
	if len(code) > 64 {
		code = strings.TrimRight(code[:64], "_")
	}
	return code
}

// businessTermsOf is the reservation's terms, derived only from stored rows
// so every re-send carries byte-identical terms (payment-service refuses a
// key or a booking ref replayed with different terms).
func businessTermsOf(b *BusinessBooking) BusinessBookingTerms {
	return BusinessBookingTerms{
		BookingRef:      b.BookingRef,
		OrganizationID:  b.OrganizationID,
		CostCentreID:    b.CostCentreID,
		BookerID:        b.BookerID.String(),
		TravellerID:     b.TravellerID.String(),
		Service:         b.Service,
		VehicleClass:    b.VehicleClass,
		AmountMinor:     b.ReservedMinor,
		Currency:        b.Currency,
		ExpenseCategory: b.ExpenseCategory,
	}
}

// businessRefusalCode is the canonical code a refusal travels as — the same
// mapping payment-service uses (src/business/model.ts REFUSAL_CODE), so a
// client branches identically on either service's answer.
func businessRefusalCode(reason string) domain.Code {
	switch reason {
	case BusinessReasonFeatureDisabled:
		return domain.CodeFeatureDisabled
	case "cost_centre_invalid", "currency_mismatch":
		return domain.CodeValidationFailed
	case "trip_cap_exceeded":
		return domain.CodeLimitExceeded
	case BusinessReasonNoBudget, BusinessReasonBudgetInsufficient:
		return domain.CodeInsufficientSpendable
	default:
		return domain.CodeForbidden
	}
}

// businessRefusalMessage phrases a refusal for the requester. No unsecured
// credit: an unfunded booking is refused, never deferred or invoiced later.
func businessRefusalMessage(reason string) string {
	switch reason {
	case BusinessReasonFeatureDisabled:
		return "business travel is not available here"
	case "organization_not_active":
		return "this organization cannot book right now"
	case BusinessReasonBookerUnauthorized:
		return "you are not authorized to book for this organization"
	case "traveller_not_member":
		return "the passenger is not an active member of this organization"
	case "cost_centre_invalid":
		return "the booking must name an active cost centre of this organization"
	case "service_not_allowed":
		return "the organization's travel policy does not allow this service"
	case "class_not_allowed":
		return "the organization's travel policy does not allow this vehicle class"
	case "trip_cap_exceeded":
		return "this trip is above the organization's per-trip cap"
	case "currency_mismatch":
		return "this trip is not in the organization's currency"
	case BusinessReasonNoBudget:
		return "this cost centre has no budget for the current period; the booking is refused, not deferred"
	case BusinessReasonBudgetInsufficient:
		return "this cost centre's budget cannot cover the trip; the booking is refused, not deferred"
	default:
		return "the organization's policy refused this booking"
	}
}

// outsiderVerdict reports a verdict that says the caller may not book on
// this organization at all (payment-service names booker_not_authorized for
// anyone who is not an active member allowed to book here). Such a caller is
// answered exactly like one naming no organization at all — the single
// reason, never the rest of the verdict — so an outsider learns nothing of
// a real organization: not that it exists, nor its status, policy, cost
// centres or budget (BUSINESS_VISIBILITY).
func outsiderVerdict(reasons []string) bool {
	for _, reason := range reasons {
		if reason == BusinessReasonBookerUnauthorized {
			return true
		}
	}
	return false
}

// outsiderRefusal is the one answer an outsider gets, whether or not the
// organization exists.
func outsiderRefusal(stage string) *domain.Error {
	return businessRefusal([]string{BusinessReasonBookerUnauthorized}, stage)
}

// businessRefusal builds the requester's error for a policy verdict.
func businessRefusal(reasons []string, stage string) *domain.Error {
	first := "organization_refused"
	if len(reasons) > 0 {
		first = reasons[0]
	}
	return domain.Errorf(businessRefusalCode(first), "%s", businessRefusalMessage(first)).
		WithDetails(map[string]any{"field": "business", "reason": first, "reasons": reasons, "stage": stage})
}

// ---------------------------------------------------------------------------
// Quote: the advisory policy check
// ---------------------------------------------------------------------------

// Business quote statuses.
const (
	BusinessQuoteAllowed     = "allowed"
	BusinessQuoteRefused     = "refused"
	BusinessQuoteUnavailable = "unavailable"
)

// BusinessQuoteView is the quote envelope's `business` block
// (MpBusinessQuoteCheckSchema): advisory — the reservation re-decides all of
// it atomically.
type BusinessQuoteView struct {
	OrganizationID     string   `json:"organizationId"`
	Status             string   `json:"status"`
	Reasons            []string `json:"reasons"`
	CheckedAmountMinor Money    `json:"checkedAmountMinor"`
	Available          *Money   `json:"available"`
	CostCentreID       *string  `json:"costCentreId"`
	PolicyVersion      *int     `json:"policyVersion"`
	Note               string   `json:"note"`
}

// validateBusinessIDs checks the ids a caller names before any call.
func validateBusinessIDs(organizationID, costCentreID string) error {
	if !businessIDPattern.MatchString(organizationID) {
		return domain.Errorf(domain.CodeValidationFailed, "name the organization to book on").
			WithDetails(map[string]any{"field": "business.organizationId"})
	}
	if costCentreID != "" && !businessIDPattern.MatchString(costCentreID) {
		return domain.Errorf(domain.CodeValidationFailed, "that cost centre id is not valid").
			WithDetails(map[string]any{"field": "business.costCentreId"})
	}
	return nil
}

// quoteBusinessCheck answers the quote's advisory business block. The flag
// is enforced (a business quote in a city without business travel is 404);
// an unanswered check is `unavailable`, never `allowed`.
func (s *Service) quoteBusinessCheck(ctx context.Context, actor Actor, quote *Quote, input *BusinessQuoteInput) (*BusinessQuoteView, error) {
	if input == nil {
		return nil, nil
	}
	if err := s.requireFlag(ctx, cityconfig.FlagBusinessTravel, actor, quote.CityID); err != nil {
		return nil, err
	}
	if err := validateBusinessIDs(input.OrganizationID, input.CostCentreID); err != nil {
		return nil, err
	}
	if quote.Service != ServiceRide {
		return nil, domain.Errorf(domain.CodeValidationFailed, "business booking is available for rides").
			WithDetails(map[string]any{"field": "business", "reason": ReasonBusinessServiceUnsupport})
	}
	traveller := actor.UserID
	if input.TravellerID != nil {
		traveller = *input.TravellerID
	}
	view := &BusinessQuoteView{
		OrganizationID:     input.OrganizationID,
		Reasons:            []string{},
		CheckedAmountMinor: money(quote.SuggestedMinor, quote.Currency),
		Note:               "Advisory: the organization's budget is reserved only when you select an offer, and re-checked then.",
	}
	verdict, err := s.business().PolicyCheck(ctx, quote.CityID, BusinessBookingTerms{
		BookingRef:     "quote:" + quote.ID.String(),
		OrganizationID: input.OrganizationID,
		CostCentreID:   input.CostCentreID,
		BookerID:       actor.UserID.String(),
		TravellerID:    traveller.String(),
		Service:        quote.Service,
		VehicleClass:   quote.VehicleClass,
		AmountMinor:    quote.SuggestedMinor,
		Currency:       quote.Currency,
	})
	if err != nil {
		if isDefiniteNotFound(err) {
			// Indistinguishable from "not a member": a non-member must not
			// learn whether an organization exists.
			return nil, outsiderRefusal("quote")
		}
		s.deps.Logger.Warn().Err(err).Msg("business policy check at quote unavailable")
		view.Status = BusinessQuoteUnavailable
		return view, nil
	}
	if outsiderVerdict(verdict.Reasons) {
		// Not a member allowed to book here: the no-such-organization
		// answer, never the verdict's status, policy or budget.
		return nil, outsiderRefusal("quote")
	}
	view.Reasons = verdict.Reasons
	if view.Reasons == nil {
		view.Reasons = []string{}
	}
	view.Available, view.CostCentreID, view.PolicyVersion = verdict.Available, verdict.CostCentreID, verdict.PolicyVersion
	view.Status = BusinessQuoteRefused
	if verdict.Allowed {
		view.Status = BusinessQuoteAllowed
	}
	return view, nil
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

// validateBusiness checks a publish's business input BEFORE anything is
// written: the flag, the service, the payment method, the traveller /
// passenger separation, the ids — and the organization's policy and budget
// at the requested fare through the documented policy check. nil input is a
// personal trip.
func (s *Service) validateBusiness(ctx context.Context, actor Actor, quote *Quote, requestID uuid.UUID, req PublishRequest) (*RequestBusiness, error) {
	if req.Business == nil {
		if req.PaymentMethodID == PaymentMethodBusiness {
			return nil, domain.Errorf(domain.CodeValidationFailed, "an organization's budget pays only for a trip booked on that organization").
				WithDetails(map[string]any{"field": "paymentMethodId", "reason": ReasonBusinessPaymentMethod})
		}
		return nil, nil
	}
	input := req.Business
	if err := s.requireFlag(ctx, cityconfig.FlagBusinessTravel, actor, quote.CityID); err != nil {
		return nil, err
	}
	if quote.Service != ServiceRide {
		return nil, domain.Errorf(domain.CodeValidationFailed, "business booking is available for rides").
			WithDetails(map[string]any{"field": "business", "reason": ReasonBusinessServiceUnsupport})
	}
	if req.PaymentMethodID != "" && req.PaymentMethodID != PaymentMethodBusiness {
		// Never both: a business trip is paid from the budget, and the
		// rider's own funding is not a fallback.
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"a business trip is paid from the organization's budget; leave the payment method out or name %q", PaymentMethodBusiness).
			WithDetails(map[string]any{"field": "paymentMethodId", "reason": ReasonBusinessPaymentMethod})
	}
	if err := validateBusinessIDs(input.OrganizationID, input.CostCentreID); err != nil {
		return nil, err
	}
	category := strings.TrimSpace(input.ExpenseCategory)
	if category != "" && !expenseCategoryPattern.MatchString(category) {
		return nil, domain.Errorf(domain.CodeValidationFailed, "an expense category is letters, digits, spaces and . _ -").
			WithDetails(map[string]any{"field": "business.expenseCategory"})
	}
	traveller := actor.UserID
	if input.TravellerID != nil && *input.TravellerID != uuid.Nil {
		traveller = *input.TravellerID
	}
	switch {
	case traveller != actor.UserID && req.Passenger == nil:
		// The traveller is not the booker: they travel as the named guest
		// passenger (trip link, first-name card), never as the booker.
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"booking for a colleague names them as the passenger, with their consent").
			WithDetails(map[string]any{"field": "passenger", "reason": ReasonBusinessPassengerRequired})
	case traveller == actor.UserID && req.Passenger != nil:
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"a passenger booked on an organization must be a member: name them as the traveller").
			WithDetails(map[string]any{"field": "business.travellerId", "reason": ReasonBusinessPassengerRequired})
	}

	verdict, err := s.business().PolicyCheck(ctx, quote.CityID, BusinessBookingTerms{
		BookingRef:      "request:" + requestID.String(),
		OrganizationID:  input.OrganizationID,
		CostCentreID:    input.CostCentreID,
		BookerID:        actor.UserID.String(),
		TravellerID:     traveller.String(),
		Service:         quote.Service,
		VehicleClass:    quote.VehicleClass,
		AmountMinor:     req.RequestedFareMinor.AmountMinor,
		Currency:        quote.Currency,
		ExpenseCategory: category,
	})
	if err != nil {
		if isDefiniteNotFound(err) {
			// Indistinguishable from "not a member": a non-member must not
			// learn whether an organization exists.
			return nil, outsiderRefusal("publish")
		}
		if mapped, ok := domain.AsError(err); ok && !errors.Is(err, ErrWalletUnknownOutcome) && mapped.Code == domain.CodeServiceUnavailable {
			return nil, mapped
		}
		return nil, domain.Errorf(domain.CodeServiceUnavailable,
			"the organization's policy could not be checked right now; nothing was booked — try again").
			WithDetails(map[string]any{"field": "business", "reason": ReasonBusinessCheckUnavailable}).Wrap(err)
	}
	if !verdict.Allowed {
		if outsiderVerdict(verdict.Reasons) {
			return nil, outsiderRefusal("publish")
		}
		return nil, businessRefusal(verdict.Reasons, "publish")
	}
	row := &RequestBusiness{
		RequestID:       requestID,
		OrganizationID:  input.OrganizationID,
		CostCentreID:    input.CostCentreID,
		ExpenseCategory: category,
		BookerID:        actor.UserID,
		TravellerID:     traveller,
		CityID:          quote.CityID,
		PolicyVersion:   verdict.PolicyVersion,
	}
	if verdict.CostCentreID != nil {
		row.CheckedCentreID = *verdict.CostCentreID
	}
	return row, nil
}

// writeRequestBusiness records the business terms inside the publishing
// transaction, with their audit row.
func (s *Service) writeRequestBusiness(ctx context.Context, tx pgx.Tx, request *Request, actor Actor, row *RequestBusiness) error {
	if err := s.deps.Store.InsertRequestBusiness(ctx, tx, row); err != nil {
		return err
	}
	return writeAudit(ctx, tx, AuditRecord{
		ActorID:     actor.UserID.String(),
		ActorRole:   actor.Role,
		Action:      "mp.request.business_booked",
		SubjectType: subjectRequest,
		SubjectID:   request.ID.String(),
		After: map[string]any{
			"payer":           "organization",
			"organizationId":  row.OrganizationID,
			"costCentreId":    row.CheckedCentreID,
			"bookerId":        row.BookerID.String(),
			"travellerId":     row.TravellerID.String(),
			"policyVersion":   row.PolicyVersion,
			"requestedMinor":  request.RequestedMinor,
			"currency":        request.Currency,
			"personalFunding": false,
		},
		Reason: "requester booked the ride on an organization; its budget pays instead of the rider",
	})
}

// requestBusiness reads a request's business terms (nil for a personal trip).
func (s *Service) requestBusiness(ctx context.Context, db DB, requestID uuid.UUID) (*RequestBusiness, error) {
	row, err := s.deps.Store.RequestBusinessByRequest(ctx, db, requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, nil
	}
	return row, err
}

// ---------------------------------------------------------------------------
// Select: the synchronous check and the booking row
// ---------------------------------------------------------------------------

// preCheckBusinessSelection refuses a selection the organization would
// refuse at the offer's amount, BEFORE any award is started — so no
// transport is ever promised on a budget that cannot pay. Advisory for the
// reservation, which re-decides atomically.
func (s *Service) preCheckBusinessSelection(ctx context.Context, request *Request, biz *RequestBusiness, bid *Bid) error {
	if bid.Slot == SlotAdvance || request.Service != ServiceRide {
		return domain.Errorf(domain.CodeValidationFailed, "business booking is available for immediate rides").
			WithDetails(map[string]any{"field": "business", "reason": ReasonBusinessServiceUnsupport})
	}
	verdict, err := s.business().PolicyCheck(ctx, request.CityID, BusinessBookingTerms{
		BookingRef:      "select:" + bid.ID.String(),
		OrganizationID:  biz.OrganizationID,
		CostCentreID:    biz.CostCentreID,
		BookerID:        biz.BookerID.String(),
		TravellerID:     biz.TravellerID.String(),
		Service:         request.Service,
		VehicleClass:    request.VehicleClass,
		AmountMinor:     bid.AmountMinor,
		Currency:        request.Currency,
		ExpenseCategory: biz.ExpenseCategory,
	})
	if err != nil {
		if mapped, ok := domain.AsError(err); ok && !errors.Is(err, ErrWalletUnknownOutcome) && mapped.Code == domain.CodeServiceUnavailable {
			return mapped
		}
		return domain.Errorf(domain.CodeServiceUnavailable,
			"the organization's budget could not be checked right now; nothing was booked — try again").
			WithDetails(map[string]any{"field": "business", "reason": ReasonBusinessCheckUnavailable}).Wrap(err)
	}
	if !verdict.Allowed {
		if outsiderVerdict(verdict.Reasons) {
			// The booker has left the organization (or lost the right to
			// book) since publishing: the outsider answer, nothing more.
			return outsiderRefusal("select")
		}
		return businessRefusal(verdict.Reasons, "select")
	}
	return nil
}

// newBusinessBooking is the award's booking row, written in the selection's
// transaction: the reservation is owed from that moment.
func newBusinessBooking(award *Award, request *Request, biz *RequestBusiness) *BusinessBooking {
	return &BusinessBooking{
		AwardID:         award.ID,
		RequestID:       request.ID,
		BookingRef:      award.ID.String(),
		OrganizationID:  biz.OrganizationID,
		CostCentreID:    biz.CostCentreID,
		ExpenseCategory: biz.ExpenseCategory,
		BookerID:        biz.BookerID,
		TravellerID:     biz.TravellerID,
		CityID:          request.CityID,
		Service:         request.Service,
		VehicleClass:    request.VehicleClass,
		Currency:        request.Currency,
		// The AGREED FARE: the driver's commission is never the org's.
		ReservedMinor: award.FareMinor,
		State:         machine.MpBusinessReserving,
		Version:       1,
	}
}

// ---------------------------------------------------------------------------
// The award saga's funding step for a business award
// ---------------------------------------------------------------------------

// runBusinessFundingStep reserves the organization's budget for the award,
// exactly once, INSTEAD OF the rider's funding authorization. It is the same
// durable step (mp.award_attempts `funding`), so a crash anywhere resumes it
// through the stalled-award sweep:
//
//   - reserved already (a crash after recording it): advance to capture;
//   - refused already: compensate (the decision was definite);
//   - a previous send's outcome unknown: reconcile through the booking-ref
//     status read first — a landed reservation is recorded, nothing found is
//     re-sent under the SAME key (payment-service replays by key and by
//     booking ref, so a re-send can never reserve twice);
//   - a definite refusal compensates the award with its reason — nothing was
//     captured, no transport was promised, nothing is put on credit.
func (s *Service) runBusinessFundingStep(ctx context.Context, award *Award, attempt *AwardAttempt, booking *BusinessBooking) (bool, error) {
	now := s.now()
	switch booking.State {
	case machine.MpBusinessReserved:
		return s.advanceToCapture(ctx, award.ID, now)
	case machine.MpBusinessRefused:
		s.compensateAward(ctx, award.ID, "business_refused:"+booking.RefusalReason, false)
		return false, nil
	case machine.MpBusinessReserving:
	default:
		return false, fmt.Errorf("award %s: business booking is %s during funding", award.ID, booking.State)
	}

	if attempt.State == AttemptStateUnknown {
		status, err := s.business().ReservationStatus(ctx, booking.BookingRef)
		switch {
		case err == nil && status.Reservation.BookingRef == booking.BookingRef:
			// The earlier send landed. Its terms are the stored terms (one
			// reservation per booking ref ever), so it is recorded as is.
			if err := s.recordBusinessReserved(ctx, booking, &status.Reservation, now); err != nil {
				return false, err
			}
			return s.advanceToCapture(ctx, award.ID, now)
		case err == nil:
			// A reservation for another ref cannot answer this read.
			return false, s.parkBusinessFunding(ctx, award, attempt, fmt.Errorf("%w: status answered booking %s", ErrWalletUnknownOutcome, status.Reservation.BookingRef), now)
		case isDefiniteNotFound(err):
			// Nothing landed: fall through and re-send under the same key.
		default:
			return false, s.parkBusinessFunding(ctx, award, attempt, err, now)
		}
	}

	result, err := s.business().Reserve(ctx, booking.CityID, businessTermsOf(booking), businessKey(award.ID, "reserve"))
	if err != nil {
		if mapped, ok := domain.AsError(err); ok && !errors.Is(err, ErrWalletUnknownOutcome) {
			reason := businessReasonOf(err)
			if reason == "" {
				reason = string(mapped.Code)
			}
			if recErr := s.recordBusinessRefused(ctx, booking, reason, now); recErr != nil {
				return false, recErr
			}
			s.compensateAward(ctx, award.ID, "business_refused:"+reason, false)
			return false, nil
		}
		return false, s.parkBusinessFunding(ctx, award, attempt, err, now)
	}
	if err := s.recordBusinessReserved(ctx, booking, &result.Reservation, now); err != nil {
		return false, err
	}
	return s.advanceToCapture(ctx, award.ID, now)
}

// advanceToCapture moves the award saga to its ONE commission capture.
func (s *Service) advanceToCapture(ctx context.Context, awardID uuid.UUID, now time.Time) (bool, error) {
	retryAt := now.Add(attemptRetryDelay)
	if err := s.deps.Store.SaveAttempt(ctx, s.deps.Store.Pool(), awardID, AttemptStepCapture, AttemptStatePending, "", &retryAt); err != nil {
		return false, err
	}
	return true, nil
}

// parkBusinessFunding leaves the award pending with an unknown funding
// outcome for the sweep: it NEVER compensates on an unknown, because the
// reservation may have landed.
func (s *Service) parkBusinessFunding(ctx context.Context, award *Award, attempt *AwardAttempt, cause error, now time.Time) error {
	retryAt := now.Add(stepBackoff(attempt.Attempts))
	if err := s.deps.Store.SaveAttempt(ctx, s.deps.Store.Pool(), award.ID,
		AttemptStepFunding, AttemptStateUnknown, truncateError(cause), &retryAt); err != nil {
		s.deps.Logger.Error().Err(err).Msg("could not park the business funding step")
	}
	return cause
}

// isDefiniteNotFound reports a definite not_found answer.
func isDefiniteNotFound(err error) bool {
	mapped, ok := domain.AsError(err)
	return ok && !errors.Is(err, ErrWalletUnknownOutcome) && mapped.Code == domain.CodeNotFound
}

// recordBusinessReserved moves the booking reserving → reserved with the
// reservation payment-service holds, its event and audit row.
func (s *Service) recordBusinessReserved(ctx context.Context, booking *BusinessBooking, reservation *BusinessReservation, now time.Time) error {
	if reservation.State != BudgetReservationReserved && reservation.State != "" {
		// A reservation already committed or released cannot back an award
		// that is still funding; alarm rather than guess.
		return fmt.Errorf("business reservation %s for award %s is %s, not reserved",
			reservation.ReservationID, booking.AwardID, reservation.State)
	}
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BusinessBookingForUpdate(ctx, tx, booking.AwardID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpBusinessReserving {
			return nil
		}
		if err := machine.Assert(machine.MpBusinessBooking, locked.State, machine.MpBusinessReserved); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE mp.business_bookings SET
				state = $2, version = version + 1, reservation_id = $3,
				cost_centre_id = COALESCE(NULLIF($4, ''), cost_centre_id), budget_id = $5,
				policy_version = $6, last_error = NULL, updated_at = $7
			WHERE award_id = $1`,
			locked.AwardID, machine.MpBusinessReserved, nullable(reservation.ReservationID),
			reservation.CostCentreID, nullable(reservation.BudgetID), reservation.PolicyVersion, now); err != nil {
			return fmt.Errorf("failed to record the business reservation: %w", err)
		}
		return s.writeBusinessTransition(ctx, tx, locked, machine.MpBusinessReserved, "business_booking.reserved", now,
			map[string]any{
				"reservationId": reservation.ReservationID,
				"costCentreId":  reservation.CostCentreID,
				"amountMinor":   locked.ReservedMinor,
				"currency":      locked.Currency,
			}, "the organization's budget reserved the awarded fare instead of the rider's funding")
	})
}

// recordBusinessRefused moves the booking reserving → refused.
func (s *Service) recordBusinessRefused(ctx context.Context, booking *BusinessBooking, reason string, now time.Time) error {
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BusinessBookingForUpdate(ctx, tx, booking.AwardID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpBusinessReserving {
			return nil
		}
		if err := machine.Assert(machine.MpBusinessBooking, locked.State, machine.MpBusinessRefused); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE mp.business_bookings SET state = $2, version = version + 1, refusal_reason = $3,
				resolved_at = $4, updated_at = $4
			WHERE award_id = $1`, locked.AwardID, machine.MpBusinessRefused, reason, now); err != nil {
			return fmt.Errorf("failed to record the business refusal: %w", err)
		}
		return s.writeBusinessTransition(ctx, tx, locked, machine.MpBusinessRefused, "business_booking.refused", now,
			map[string]any{"reason": reason, "amountMinor": locked.ReservedMinor, "currency": locked.Currency},
			"the organization refused the reservation; no transport was promised and nothing was put on credit")
	})
}

// writeBusinessTransition writes one mpBusinessBooking transition's event and
// audit row. Payload: ids and integer minor amounts only; no driver id.
func (s *Service) writeBusinessTransition(ctx context.Context, tx pgx.Tx, booking *BusinessBooking, to, name string, now time.Time, extra map[string]any, reason string) error {
	payload := map[string]any{
		"awardId":        booking.AwardID.String(),
		"requestId":      booking.RequestID.String(),
		"bookingRef":     booking.BookingRef,
		"organizationId": booking.OrganizationID,
		"bookerId":       booking.BookerID.String(),
		"travellerId":    booking.TravellerID.String(),
		"state":          to,
	}
	for key, value := range extra {
		payload[key] = value
	}
	fromVersion := booking.Version
	if err := writeEvent(ctx, tx, Event{
		Name:           name,
		AggregateType:  subjectBusinessBooking,
		AggregateID:    booking.AwardID.String(),
		FromVersion:    &fromVersion,
		ToVersion:      booking.Version + 1,
		CityID:         booking.CityID,
		ActorType:      "system",
		ActorID:        "ride-service",
		IdempotencyKey: name + ":" + booking.AwardID.String(),
		OccurredAt:     now,
		Payload:        payload,
	}); err != nil {
		return err
	}
	return writeAudit(ctx, tx, AuditRecord{
		ActorID:     "ride-service",
		ActorRole:   "system",
		Action:      name,
		SubjectType: subjectBusinessBooking,
		SubjectID:   booking.AwardID.String(),
		Before:      map[string]any{"state": booking.State},
		After:       payload,
		Reason:      reason,
	})
}

// ---------------------------------------------------------------------------
// Owed ops: commit at completion, release on cancel
// ---------------------------------------------------------------------------

// businessRelease names who released a booking and why.
type businessRelease struct {
	party  string
	userID *uuid.UUID
	reason string
}

// systemRelease is a release nobody asked for: no award, compensation, a
// driver or ops cancellation, a no-show.
func systemRelease(reason string) businessRelease {
	return businessRelease{party: BusinessPartySystem, reason: reason}
}

// requesterRelease is the requester's own cancel before pickup: the booker's
// right, or the traveller's when they booked for themselves.
func requesterRelease(booking *BusinessBooking, reason string) businessRelease {
	user := booking.BookerID
	party := BusinessPartyBooker
	if booking.BookerID == booking.TravellerID {
		party = BusinessPartyTraveller
	}
	return businessRelease{party: party, userID: &user, reason: reason}
}

// travellerRelease is the passenger's own decline (their trip link).
func travellerRelease(booking *BusinessBooking, reason string) businessRelease {
	user := booking.TravellerID
	return businessRelease{party: BusinessPartyTraveller, userID: &user, reason: reason}
}

// businessTopUpKey is the ONE key an amendment's reserve top-up is ever
// sent under (contract: business:<awardId>:topup:<reasonRef>).
func businessTopUpKey(awardID uuid.UUID, reasonRef string) string {
	return businessKey(awardID, "topup:"+reasonRef)
}

// raiseBusinessReservation is a business trip's funding leg for a raised
// total (A06 part C): before the amendment commits — an approved fare
// increase, or paid waiting — the organization's budget reservation is
// raised to the new total through payment-service's reserve top-up, exactly
// once per amendment (key and reasonRef = the amendment id). A total still
// within the reservation (after an earlier decrease) needs no raise. The
// increase is derived from stored rows only, so a re-send after a lost
// answer carries identical terms and payment-service replays it. An unknown
// outcome parks the amendment (the sweep re-sends the same key); a definite
// refusal fails it into compensation — the commission increment released,
// the original agreement standing — with the organization's reason.
func (s *Service) raiseBusinessReservation(ctx context.Context, amendment *Amendment) error {
	if amendment.fareDelta() <= 0 {
		return nil
	}
	booking, err := s.deps.Store.BusinessBookingByAward(ctx, s.deps.Store.Pool(), amendment.AwardID)
	if errors.Is(err, domain.ErrNotFound) {
		return businessTopUpRefusal(domain.Errorf(domain.CodeConflict, "this business trip has no budget reservation"),
			businessIncreaseReason(amendment), "no_reservation")
	}
	if err != nil {
		return err
	}
	if booking.State != machine.MpBusinessReserved {
		return businessTopUpRefusal(domain.Errorf(domain.CodeIllegalTransition, "the budget reservation is %s", booking.State),
			businessIncreaseReason(amendment), "reservation_not_open")
	}
	increase := amendment.RevisedFareMinor - booking.ReservedMinor
	if increase <= 0 {
		return nil
	}
	reason := businessIncreaseReason(amendment)
	result, err := s.business().ReserveTopUp(ctx, BusinessReserveTopUpRequest{
		BookingRef:  booking.BookingRef,
		AmountMinor: increase,
		Currency:    booking.Currency,
		Reason:      reason,
		ReasonRef:   amendment.ID.String(),
	}, businessTopUpKey(booking.AwardID, amendment.ID.String()))
	if err != nil {
		if isUnknownOutcome(err) {
			return err
		}
		return businessTopUpRefusal(err, reason, "")
	}
	raised := result.Increase.Reserved
	if raised.Currency != booking.Currency || raised.AmountMinor < amendment.RevisedFareMinor ||
		result.Reservation.Reserved.AmountMinor != raised.AmountMinor {
		s.deps.Logger.Error().Str("award_id", booking.AwardID.String()).Str("amendment_id", amendment.ID.String()).
			Int64("reserved", raised.AmountMinor).Int64("needed", amendment.RevisedFareMinor).
			Msg("ALARM: payment-service's reserve top-up answered a reservation that does not cover the raised total")
		return businessTopUpRefusal(domain.Errorf(domain.CodeConflict, "the raised reservation does not cover the new total"),
			reason, "reservation_short")
	}
	return s.recordBusinessIncrease(ctx, booking.AwardID, amendment, result, reason, s.now())
}

// businessIncreaseReason names why a reservation grows: paid waiting for a
// stop's waiting fee, a fare increase for anything else.
func businessIncreaseReason(amendment *Amendment) string {
	if amendment.Kind == AmendmentKindStopWaiting {
		return BusinessIncreasePaidWaiting
	}
	return BusinessIncreaseFareIncrease
}

// businessTopUpRefusal explains a refused raise to the party whose approval
// ran the commit: the organization's reason (details.reason), the stage, and
// that the trip continues on the agreed terms. `fallback` names a refusal
// payment-service gave no reason for.
func businessTopUpRefusal(cause error, stage, fallback string) error {
	reason := businessReasonOf(cause)
	if reason == "" {
		reason = fallback
	}
	if reason == "" {
		reason = "refused"
	}
	code := domain.CodeConflict
	if mapped, ok := domain.AsError(cause); ok {
		code = mapped.Code
	}
	message := "the organization's budget could not be raised for this change, so it was not applied; the trip continues on the agreed terms"
	switch reason {
	case BusinessReasonBudgetInsufficient, BusinessReasonNoBudget:
		message = "the organization's budget cannot cover the higher fare, so the change was not applied; the trip continues on the agreed terms"
	case "trip_cap_exceeded":
		message = "the higher fare is above the organization's per-trip cap, so the change was not applied; the trip continues on the agreed terms"
	case "organization_not_active", BusinessReasonFeatureDisabled:
		message = "the organization cannot fund a higher fare right now, so the change was not applied; the trip continues on the agreed terms"
	}
	return domain.Errorf(code, "%s", message).WithDetails(map[string]any{
		"field": "business", "reason": reason, "stage": stage, "topUp": businessTopUpMarker,
	}).Wrap(cause)
}

// recordBusinessIncrease writes the raised reservation onto the booking —
// once: a replay that finds it already recorded changes nothing — with its
// business_booking.reserve_increased event and audit row.
func (s *Service) recordBusinessIncrease(ctx context.Context, awardID uuid.UUID, amendment *Amendment, result *BusinessTopUpResult, reason string, now time.Time) error {
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BusinessBookingForUpdate(ctx, tx, awardID)
		if err != nil {
			return err
		}
		raised := result.Increase.Reserved.AmountMinor
		if locked.ReservedMinor >= raised {
			return nil
		}
		if _, err := tx.Exec(ctx, `
			UPDATE mp.business_bookings SET reserved_minor = $2, version = version + 1, updated_at = $3
			WHERE award_id = $1`, awardID, raised, now); err != nil {
			return fmt.Errorf("failed to record the raised business reservation: %w", err)
		}
		name := "business_booking.reserve_increased"
		fromVersion := locked.Version
		payload := map[string]any{
			"awardId":          locked.AwardID.String(),
			"requestId":        locked.RequestID.String(),
			"bookingRef":       locked.BookingRef,
			"organizationId":   locked.OrganizationID,
			"state":            locked.State,
			"reason":           reason,
			"reasonRef":        amendment.ID.String(),
			"increase":         result.Amount,
			"previousReserved": money(locked.ReservedMinor, locked.Currency),
			"reserved":         money(raised, locked.Currency),
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           name,
			AggregateType:  subjectBusinessBooking,
			AggregateID:    locked.AwardID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      locked.Version + 1,
			CityID:         locked.CityID,
			ActorType:      "system",
			ActorID:        "ride-service",
			IdempotencyKey: eventKey(name, locked.AwardID.String(), amendment.ID.String()),
			OccurredAt:     now,
			Payload:        payload,
		}); err != nil {
			return err
		}
		return writeAudit(ctx, tx, AuditRecord{
			ActorID:     "ride-service",
			ActorRole:   "system",
			Action:      name,
			SubjectType: subjectBusinessBooking,
			SubjectID:   locked.AwardID.String(),
			Before:      map[string]any{"reservedMinor": locked.ReservedMinor},
			After:       payload,
			Reason:      "the organization's reservation was raised before a raised total committed (" + reason + ")",
		})
	})
}

// AuthorizeRiderCancel implements move.RiderCancelGuard (and guards the
// requester's queued-award cancel): before the requester cancels a business
// trip booked for a COLLEAGUE, their authority is re-checked at cancel time
// through the documented membership contract — payment-service's read-only
// POST /policy-check, whose booker_not_authorized says the booker is no
// longer an active booking member of the organization (the same rule its
// release applies to a booker, BUSINESS_CANCEL_RIGHTS). A booker who left
// is refused and the trip is untouched: the passenger may still decline it
// from their trip link, and the system still releases the budget when the
// trip ends without service. A traveller who booked for themselves always
// may cancel their own trip. Fails closed: when membership cannot be read,
// nothing is cancelled. A personal (non-business) trip is never asked about.
func (s *Service) AuthorizeRiderCancel(ctx context.Context, awardID, riderID uuid.UUID) error {
	booking, err := s.deps.Store.BusinessBookingByAward(ctx, s.deps.Store.Pool(), awardID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil
	}
	if err != nil {
		return asDomainError(err)
	}
	if riderID != booking.BookerID || booking.BookerID == booking.TravellerID {
		return nil
	}
	terms := businessTermsOf(booking)
	terms.BookingRef = "cancel:" + booking.AwardID.String()
	verdict, err := s.business().PolicyCheck(ctx, booking.CityID, terms)
	if err != nil {
		return domain.Errorf(domain.CodeServiceUnavailable,
			"the organization's membership could not be checked right now; nothing was cancelled").
			WithDetails(map[string]any{"reason": ReasonBusinessCheckUnavailable}).Wrap(err)
	}
	if outsiderVerdict(verdict.Reasons) {
		return domain.Errorf(domain.CodeForbidden,
			"you are no longer a booker for this organization, so you cannot cancel a colleague's business trip; the passenger can still decline it from their trip link").
			WithDetails(map[string]any{"reason": BusinessReasonCancelNotPermitted, "party": BusinessPartyBooker})
	}
	return nil
}

// oweBusinessOp records, inside the caller's transaction, that the award's
// booking owes one terminal op. It is the durable intent: written in the same
// transaction as the trip event that decides it, so a crash after that commit
// still owes the op to the sweep. Idempotent — an op already owed or a
// booking already terminal is left alone. `release` is ignored for a commit.
func (s *Service) oweBusinessOp(ctx context.Context, tx pgx.Tx, awardID uuid.UUID, op string, release businessRelease, now time.Time) (bool, error) {
	locked, err := s.deps.Store.BusinessBookingForUpdate(ctx, tx, awardID)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if locked.OwedOp != "" || (locked.State != machine.MpBusinessReserved && locked.State != machine.MpBusinessReserving) {
		return false, nil
	}
	if op == businessOpCommit && locked.State != machine.MpBusinessReserved {
		// Only a reservation can be committed; the award saga has not yet
		// reserved it (it cannot have completed a trip either).
		return false, fmt.Errorf("award %s: a commit is owed but the budget was never reserved", awardID)
	}
	var party, reason *string
	var userID *uuid.UUID
	if op == businessOpRelease {
		p, r := release.party, businessReleaseReason(release.reason)
		party, reason, userID = &p, &r, release.userID
	}
	if _, err := tx.Exec(ctx, `
		UPDATE mp.business_bookings SET owed_op = $2, release_party = $3, release_user_id = $4,
			release_reason = $5, next_attempt_at = $6, updated_at = $6
		WHERE award_id = $1 AND owed_op IS NULL`,
		awardID, op, party, userID, reason, now); err != nil {
		return false, fmt.Errorf("failed to record the owed business %s: %w", op, err)
	}
	after := map[string]any{"owedOp": op, "bookingRef": locked.BookingRef, "organizationId": locked.OrganizationID}
	if party != nil {
		after["party"], after["reason"] = *party, *reason
	}
	return true, writeAudit(ctx, tx, AuditRecord{
		ActorID:     "ride-service",
		ActorRole:   "system",
		Action:      "business_booking." + op + "_owed",
		SubjectType: subjectBusinessBooking,
		SubjectID:   awardID.String(),
		Before:      map[string]any{"state": locked.State},
		After:       after,
		Reason:      "the trip's outcome owes the organization's budget a " + op,
	})
}

// releaseBusinessFunding owes and drives the release of an abandoned award's
// budget reservation (the business twin of releaseRiderFunding). Safe to call
// for any award: a personal trip has no booking and nothing happens.
func (s *Service) releaseBusinessFunding(ctx context.Context, awardID uuid.UUID, release businessRelease) {
	now := s.now()
	owed := false
	if err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		var err error
		owed, err = s.oweBusinessOp(ctx, tx, awardID, businessOpRelease, release, now)
		return err
	}); err != nil {
		s.deps.Logger.Error().Err(err).Str("award_id", awardID.String()).
			Msg("could not record the owed business release; the award's compensation will retry it")
		return
	}
	if owed {
		s.driveBusinessOp(ctx, awardID)
	}
}

// driveBusinessOp drives an award's owed op now; anything unconfirmed stays
// owed for the sweep, under the same key.
func (s *Service) driveBusinessOp(ctx context.Context, awardID uuid.UUID) {
	if err := s.runBusinessOp(ctx, awardID); err != nil {
		s.deps.Logger.Warn().Err(err).Str("award_id", awardID.String()).
			Msg("business budget op unconfirmed; the sweep owns the owed op")
	}
}

// sweepBusinessBookings is the durable side of every owed commit/release.
func (s *Service) sweepBusinessBookings(ctx context.Context, now time.Time) {
	ids, err := s.deps.Store.DueBusinessOps(ctx, s.deps.Store.Pool(), now, sweepBatch)
	if err != nil {
		s.deps.Logger.Error().Err(err).Msg("failed to list owed business budget ops")
		return
	}
	for _, id := range ids {
		s.driveBusinessOp(ctx, id)
	}
}

// runBusinessOp performs one owed op against payment-service.
func (s *Service) runBusinessOp(ctx context.Context, awardID uuid.UUID) error {
	booking, err := s.deps.Store.BusinessBookingByAward(ctx, s.deps.Store.Pool(), awardID)
	if err != nil {
		return err
	}
	switch booking.OwedOp {
	case "":
		return nil
	case businessOpCommit:
		return s.runBusinessCommit(ctx, booking)
	case businessOpRelease:
		return s.runBusinessRelease(ctx, booking)
	default:
		return fmt.Errorf("award %s owes an unknown business op %q", awardID, booking.OwedOp)
	}
}

// runBusinessCommit commits the ACTUAL total: the committed fare the
// personal settlement would have settled (agreed fare + committed
// adjustments), derived at drive time and deferred while any adjustment
// still holds open money. A total of zero is released, not committed.
func (s *Service) runBusinessCommit(ctx context.Context, booking *BusinessBooking) error {
	now := s.now()
	award, err := s.deps.Store.AwardByID(ctx, s.deps.Store.Pool(), booking.AwardID)
	if err != nil {
		return err
	}
	final, err := s.committedSettlement(ctx, SettlementRequest{
		AwardID:   award.ID,
		FareMinor: money(award.FareMinor, booking.Currency),
	})
	if err != nil {
		return s.parkBusinessOp(ctx, booking, err, now)
	}
	actual := final.FareMinor.AmountMinor
	if actual > booking.ReservedMinor {
		// Unreachable: every raised total raised the reservation first
		// (raiseBusinessReservation). Never commit more than was reserved
		// (payment-service refuses it too). Alarm and park for ops.
		err := fmt.Errorf("award %s: actual %d exceeds the budget reservation %d", award.ID, actual, booking.ReservedMinor)
		s.deps.Logger.Error().Err(err).Msg("ALARM: a business trip's actual total exceeds its reservation")
		return s.parkBusinessOp(ctx, booking, err, now)
	}
	if actual <= 0 {
		return s.convertCommitToRelease(ctx, booking, now)
	}

	result, err := s.business().Commit(ctx, BusinessCommitRequest{
		BookingRef: booking.BookingRef, ActualMinor: actual, Currency: booking.Currency,
	}, businessKey(award.ID, businessOpCommit))
	if err != nil {
		if isUnknownOutcome(err) {
			if reconciled := s.reconcileBusinessOp(ctx, booking, now); reconciled {
				return nil
			}
			return s.parkBusinessOp(ctx, booking, err, now)
		}
		// A definite refusal (conflict / illegal transition): the ledger
		// disagrees with this booking. Reconcile with what payment-service
		// holds; alarm and park when that does not settle it.
		if reconciled := s.reconcileBusinessOp(ctx, booking, now); reconciled {
			return nil
		}
		s.deps.Logger.Error().Err(err).Str("award_id", award.ID.String()).
			Msg("ALARM: payment-service refused a business commit; parked for ops")
		return s.parkBusinessOp(ctx, booking, err, now)
	}
	return s.recordBusinessCommitted(ctx, booking, &result.Reservation, result.EntryID, now)
}

// convertCommitToRelease turns an owed commit of a zero total into the owed
// release the contract asks for ("a trip that ends up costing nothing is
// released, not committed").
func (s *Service) convertCommitToRelease(ctx context.Context, booking *BusinessBooking, now time.Time) error {
	if _, err := s.deps.Store.Pool().Exec(ctx, `
		UPDATE mp.business_bookings SET owed_op = $2, release_party = $3, release_user_id = NULL,
			release_reason = 'trip_cost_nothing', updated_at = $4
		WHERE award_id = $1 AND owed_op = $5`,
		booking.AwardID, businessOpRelease, BusinessPartySystem, now, businessOpCommit); err != nil {
		return fmt.Errorf("failed to convert the owed commit into a release: %w", err)
	}
	return s.runBusinessOp(ctx, booking.AwardID)
}

// runBusinessRelease frees the reservation, naming who cancelled. A refusal
// of the named party (the booker left the organization, say) is re-sent as
// the system under its own key: the trip ended without service either way,
// and the budget must never stay encumbered.
func (s *Service) runBusinessRelease(ctx context.Context, booking *BusinessBooking) error {
	now := s.now()
	if booking.State == machine.MpBusinessReserving {
		// The release was owed before the reserve's outcome was known: learn
		// it first. Nothing reserved ⇒ nothing to release.
		status, err := s.business().ReservationStatus(ctx, booking.BookingRef)
		switch {
		case isDefiniteNotFound(err):
			return s.recordBusinessNothingReserved(ctx, booking, now)
		case err != nil:
			return s.parkBusinessOp(ctx, booking, err, now)
		}
		if err := s.recordBusinessReserved(ctx, booking, &status.Reservation, now); err != nil {
			return s.parkBusinessOp(ctx, booking, err, now)
		}
		if booking, err = s.deps.Store.BusinessBookingByAward(ctx, s.deps.Store.Pool(), booking.AwardID); err != nil {
			return err
		}
	}
	party := booking.ReleaseParty
	if party == "" {
		party = BusinessPartySystem
	}
	req := BusinessReleaseRequest{
		BookingRef:  booking.BookingRef,
		CancelledBy: BusinessCancelledBy{Party: party},
		Reason:      businessReleaseReason(booking.ReleaseReason),
	}
	if party != BusinessPartySystem && booking.ReleaseUserID != nil {
		user := booking.ReleaseUserID.String()
		req.CancelledBy.UserID = &user
	}
	key := businessKey(booking.AwardID, businessOpRelease)
	result, err := s.business().Release(ctx, req, key)
	if err != nil && party != BusinessPartySystem && businessReasonOf(err) == BusinessReasonCancelNotPermitted {
		// The named party is no longer entitled (the booker left, say), but
		// the trip ended without service: the system releases, under its
		// OWN key — deterministic, so a lost answer re-drives into the same
		// fallback and payment-service replays it.
		s.deps.Logger.Warn().Str("award_id", booking.AwardID.String()).Str("party", party).
			Msg("payment-service refused the named party; the trip ended without service, so the system releases the budget")
		req.CancelledBy = BusinessCancelledBy{Party: BusinessPartySystem}
		result, err = s.business().Release(ctx, req, key+":system")
	}
	if err != nil {
		if isUnknownOutcome(err) {
			if reconciled := s.reconcileBusinessOp(ctx, booking, now); reconciled {
				return nil
			}
			return s.parkBusinessOp(ctx, booking, err, now)
		}
		if isDefiniteNotFound(err) {
			return s.recordBusinessNothingReserved(ctx, booking, now)
		}
		if reconciled := s.reconcileBusinessOp(ctx, booking, now); reconciled {
			return nil
		}
		s.deps.Logger.Error().Err(err).Str("award_id", booking.AwardID.String()).
			Msg("ALARM: payment-service refused a business release; parked for ops")
		return s.parkBusinessOp(ctx, booking, err, now)
	}
	return s.recordBusinessReleased(ctx, booking, &result.Reservation, now)
}

// reconcileBusinessOp reads the reservation payment-service holds and
// records a terminal outcome it already reached (a commit or release that
// landed before its answer was lost). It reports whether that settled the
// owed op.
func (s *Service) reconcileBusinessOp(ctx context.Context, booking *BusinessBooking, now time.Time) bool {
	status, err := s.business().ReservationStatus(ctx, booking.BookingRef)
	if err != nil {
		return false
	}
	switch status.Reservation.State {
	case BudgetReservationCommitted:
		if err := s.recordBusinessCommitted(ctx, booking, &status.Reservation, status.Reservation.CommitEntryID, now); err != nil {
			s.deps.Logger.Error().Err(err).Str("award_id", booking.AwardID.String()).Msg("could not record the reconciled commit")
			return false
		}
		if booking.OwedOp == businessOpRelease {
			s.deps.Logger.Error().Str("award_id", booking.AwardID.String()).
				Msg("ALARM: a release was owed but payment-service already committed the booking; investigate")
		}
		return true
	case BudgetReservationReleased:
		if err := s.recordBusinessReleased(ctx, booking, &status.Reservation, now); err != nil {
			s.deps.Logger.Error().Err(err).Str("award_id", booking.AwardID.String()).Msg("could not record the reconciled release")
			return false
		}
		if booking.OwedOp == businessOpCommit {
			s.deps.Logger.Error().Str("award_id", booking.AwardID.String()).
				Msg("ALARM: a commit was owed but payment-service already released the booking; investigate")
		}
		return true
	default:
		return false
	}
}

// recordBusinessCommitted moves the booking reserved → committed.
func (s *Service) recordBusinessCommitted(ctx context.Context, booking *BusinessBooking, reservation *BusinessReservation, entryID *string, now time.Time) error {
	if reservation.Committed == nil {
		return fmt.Errorf("award %s: a committed reservation carries no committed amount", booking.AwardID)
	}
	taxes, err := json.Marshal(reservation.Taxes)
	if err != nil {
		return err
	}
	entry := ""
	if entryID != nil {
		entry = *entryID
	}
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BusinessBookingForUpdate(ctx, tx, booking.AwardID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpBusinessReserved {
			return nil
		}
		if err := machine.Assert(machine.MpBusinessBooking, locked.State, machine.MpBusinessCommitted); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE mp.business_bookings SET state = $2, version = version + 1, owed_op = NULL,
				committed_minor = $3, commit_entry_id = $4, taxes = $5, last_error = NULL,
				next_attempt_at = NULL, resolved_at = $6, updated_at = $6
			WHERE award_id = $1`,
			locked.AwardID, machine.MpBusinessCommitted, reservation.Committed.AmountMinor, nullable(entry), taxes, now); err != nil {
			return fmt.Errorf("failed to record the business commit: %w", err)
		}
		return s.writeBusinessTransition(ctx, tx, locked, machine.MpBusinessCommitted, "business_booking.committed", now,
			map[string]any{
				"amountMinor":   reservation.Committed.AmountMinor,
				"reservedMinor": locked.ReservedMinor,
				"currency":      locked.Currency,
				"entryId":       entry,
			}, "the trip completed; its actual total left the organization's budget (the driver's commission untouched)")
	})
}

// recordBusinessReleased moves the booking reserved → released.
func (s *Service) recordBusinessReleased(ctx context.Context, booking *BusinessBooking, reservation *BusinessReservation, now time.Time) error {
	party := booking.ReleaseParty
	if reservation.ReleasedBy != nil {
		party = *reservation.ReleasedBy
	}
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BusinessBookingForUpdate(ctx, tx, booking.AwardID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpBusinessReserved {
			return nil
		}
		if err := machine.Assert(machine.MpBusinessBooking, locked.State, machine.MpBusinessReleased); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE mp.business_bookings SET state = $2, version = version + 1, owed_op = NULL,
				release_party = $3, last_error = NULL, next_attempt_at = NULL, resolved_at = $4, updated_at = $4
			WHERE award_id = $1`,
			locked.AwardID, machine.MpBusinessReleased, nullable(party), now); err != nil {
			return fmt.Errorf("failed to record the business release: %w", err)
		}
		return s.writeBusinessTransition(ctx, tx, locked, machine.MpBusinessReleased, "business_booking.released", now,
			map[string]any{
				"party":       party,
				"reason":      locked.ReleaseReason,
				"amountMinor": locked.ReservedMinor,
				"currency":    locked.Currency,
			}, "the trip did not go ahead; the organization's reservation was released")
	})
}

// recordBusinessNothingReserved settles an owed release for a booking whose
// reserve never landed (payment-service holds no reservation for its ref).
// No mpBusinessBooking transition applies — nothing was ever reserved — so
// the booking closes as refused with that reason, audited.
func (s *Service) recordBusinessNothingReserved(ctx context.Context, booking *BusinessBooking, now time.Time) error {
	if booking.State != machine.MpBusinessReserving {
		s.deps.Logger.Error().Str("award_id", booking.AwardID.String()).Str("state", booking.State).
			Msg("ALARM: payment-service has no reservation for a booking recorded as reserved; parked for ops")
		return s.parkBusinessOp(ctx, booking, fmt.Errorf("no reservation for booking %s", booking.BookingRef), now)
	}
	return s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		locked, err := s.deps.Store.BusinessBookingForUpdate(ctx, tx, booking.AwardID)
		if err != nil {
			return err
		}
		if locked.State != machine.MpBusinessReserving {
			return nil
		}
		if _, err := tx.Exec(ctx, `
			UPDATE mp.business_bookings SET state = $2, version = version + 1, owed_op = NULL,
				refusal_reason = 'never_reserved', next_attempt_at = NULL, resolved_at = $3, updated_at = $3
			WHERE award_id = $1`, locked.AwardID, machine.MpBusinessRefused, now); err != nil {
			return err
		}
		return s.writeBusinessTransition(ctx, tx, locked, machine.MpBusinessRefused, "business_booking.refused", now,
			map[string]any{"reason": "never_reserved", "amountMinor": locked.ReservedMinor, "currency": locked.Currency},
			"the award ended before the organization's budget was reserved; nothing to release")
	})
}

// parkBusinessOp leaves an owed op for the sweep with backoff.
func (s *Service) parkBusinessOp(ctx context.Context, booking *BusinessBooking, cause error, now time.Time) error {
	backoff := stepBackoff(booking.Attempts)
	if backoff > businessOpBackoffCap {
		backoff = businessOpBackoffCap
	}
	if _, err := s.deps.Store.Pool().Exec(ctx, `
		UPDATE mp.business_bookings SET attempts = attempts + 1, last_error = $2, next_attempt_at = $3, updated_at = $4
		WHERE award_id = $1`, booking.AwardID, truncateError(cause), now.Add(backoff), now); err != nil {
		s.deps.Logger.Error().Err(err).Msg("could not park the owed business op")
	}
	return cause
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

// RequestBusinessView is the requester's `business` block on their own
// request (MpRequestBusinessSchema): the payer, the booking's terms and
// where the organization's funding stands. Never shown to the driver.
type RequestBusinessView struct {
	OrganizationID  string               `json:"organizationId"`
	CostCentreID    *string              `json:"costCentreId"`
	ExpenseCategory *string              `json:"expenseCategory"`
	BookerID        string               `json:"bookerId"`
	TravellerID     string               `json:"travellerId"`
	PayerRole       string               `json:"payerRole"`
	Funding         *BusinessFundingView `json:"funding"`
}

// BusinessFundingView is where the award's budget funding stands.
type BusinessFundingView struct {
	State          string  `json:"state"`
	ReservedMinor  Money   `json:"reservedMinor"`
	CommittedMinor *Money  `json:"committedMinor"`
	RefusalReason  *string `json:"refusalReason"`
	ReleasedBy     *string `json:"releasedBy"`
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

// attachBusiness adds the business block to the requester's request view. A
// read failure omits the block rather than failing the snapshot.
func (s *Service) attachBusiness(ctx context.Context, view *RequestView, request *Request) {
	biz, err := s.requestBusiness(ctx, s.deps.Store.Pool(), request.ID)
	if err != nil {
		s.deps.Logger.Warn().Err(err).Str("request_id", request.ID.String()).Msg("could not read the request's business terms")
		return
	}
	if biz == nil {
		return
	}
	view.Business = requestBusinessViewOf(biz, nil)
	if award, err := s.deps.Store.LatestAwardForRequest(ctx, s.deps.Store.Pool(), request.ID); err == nil {
		if booking, err := s.deps.Store.BusinessBookingByAward(ctx, s.deps.Store.Pool(), award.ID); err == nil {
			view.Business = requestBusinessViewOf(biz, booking)
		}
	}
	if view.Passenger != nil {
		view.Passenger.PayerRole = "organization"
	}
}

func requestBusinessViewOf(biz *RequestBusiness, booking *BusinessBooking) *RequestBusinessView {
	centre := biz.CheckedCentreID
	if centre == "" {
		centre = biz.CostCentreID
	}
	view := &RequestBusinessView{
		OrganizationID:  biz.OrganizationID,
		CostCentreID:    optionalString(centre),
		ExpenseCategory: optionalString(biz.ExpenseCategory),
		BookerID:        biz.BookerID.String(),
		TravellerID:     biz.TravellerID.String(),
		PayerRole:       "organization",
	}
	if booking != nil {
		funding := &BusinessFundingView{
			State:         booking.State,
			ReservedMinor: money(booking.ReservedMinor, booking.Currency),
			RefusalReason: optionalString(booking.RefusalReason),
		}
		if booking.CommittedMinor != nil {
			committed := money(*booking.CommittedMinor, booking.Currency)
			funding.CommittedMinor = &committed
		}
		if booking.State == machine.MpBusinessReleased {
			funding.ReleasedBy = optionalString(booking.ReleaseParty)
		}
		if booking.CostCentreID != "" {
			view.CostCentreID = optionalString(booking.CostCentreID)
		}
		view.Funding = funding
	}
	return view
}

// ---------------------------------------------------------------------------
// Store: mp.request_business and mp.business_bookings
// ---------------------------------------------------------------------------

// InsertRequestBusiness records a request's business terms.
func (s *Store) InsertRequestBusiness(ctx context.Context, tx pgx.Tx, row *RequestBusiness) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO mp.request_business (
			request_id, organization_id, cost_centre_id, expense_category, booker_id, traveller_id,
			city_id, policy_version, checked_cost_centre_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		row.RequestID, row.OrganizationID, nullable(row.CostCentreID), nullable(row.ExpenseCategory),
		row.BookerID, row.TravellerID, row.CityID, row.PolicyVersion, nullable(row.CheckedCentreID)); err != nil {
		return fmt.Errorf("failed to record the request's business terms: %w", err)
	}
	return nil
}

// RequestBusinessByRequest reads a request's business terms.
func (s *Store) RequestBusinessByRequest(ctx context.Context, db DB, requestID uuid.UUID) (*RequestBusiness, error) {
	var row RequestBusiness
	err := db.QueryRow(ctx, `
		SELECT request_id, organization_id, COALESCE(cost_centre_id, ''), COALESCE(expense_category, ''),
			booker_id, traveller_id, city_id, policy_version, COALESCE(checked_cost_centre_id, ''), created_at
		FROM mp.request_business WHERE request_id = $1`, requestID).Scan(
		&row.RequestID, &row.OrganizationID, &row.CostCentreID, &row.ExpenseCategory,
		&row.BookerID, &row.TravellerID, &row.CityID, &row.PolicyVersion, &row.CheckedCentreID, &row.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read the request's business terms: %w", err)
	}
	return &row, nil
}

// InsertBusinessBooking writes an award's booking row, once.
func (s *Store) InsertBusinessBooking(ctx context.Context, tx pgx.Tx, b *BusinessBooking) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO mp.business_bookings (
			award_id, request_id, booking_ref, organization_id, cost_centre_id, expense_category,
			booker_id, traveller_id, city_id, service, vehicle_class, currency, reserved_minor, state
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		ON CONFLICT (award_id) DO NOTHING`,
		b.AwardID, b.RequestID, b.BookingRef, b.OrganizationID, nullable(b.CostCentreID), nullable(b.ExpenseCategory),
		b.BookerID, b.TravellerID, b.CityID, b.Service, b.VehicleClass, b.Currency, b.ReservedMinor, b.State); err != nil {
		return fmt.Errorf("failed to record the business booking: %w", err)
	}
	return nil
}

const businessBookingColumns = `
	award_id, request_id, booking_ref, organization_id, COALESCE(cost_centre_id, ''), COALESCE(expense_category, ''),
	booker_id, traveller_id, city_id, service, vehicle_class, currency, reserved_minor, state, version,
	COALESCE(reservation_id, ''), COALESCE(budget_id, ''), policy_version, COALESCE(refusal_reason, ''),
	COALESCE(owed_op, ''), COALESCE(release_party, ''), release_user_id, COALESCE(release_reason, ''),
	committed_minor, COALESCE(commit_entry_id, ''), taxes, billing, attempts, next_attempt_at,
	COALESCE(last_error, ''), created_at, updated_at, resolved_at`

func scanBusinessBooking(row pgx.Row) (*BusinessBooking, error) {
	var b BusinessBooking
	var taxes, billing []byte
	err := row.Scan(&b.AwardID, &b.RequestID, &b.BookingRef, &b.OrganizationID, &b.CostCentreID, &b.ExpenseCategory,
		&b.BookerID, &b.TravellerID, &b.CityID, &b.Service, &b.VehicleClass, &b.Currency, &b.ReservedMinor, &b.State, &b.Version,
		&b.ReservationID, &b.BudgetID, &b.PolicyVersion, &b.RefusalReason,
		&b.OwedOp, &b.ReleaseParty, &b.ReleaseUserID, &b.ReleaseReason,
		&b.CommittedMinor, &b.CommitEntryID, &taxes, &billing, &b.Attempts, &b.NextAttemptAt,
		&b.LastError, &b.CreatedAt, &b.UpdatedAt, &b.ResolvedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read the business booking: %w", err)
	}
	if len(taxes) > 0 {
		if err := json.Unmarshal(taxes, &b.Taxes); err != nil {
			return nil, fmt.Errorf("unreadable business booking taxes: %w", err)
		}
	}
	if len(billing) > 0 {
		var status BusinessReservationStatus
		if err := json.Unmarshal(billing, &status); err == nil {
			b.Billing = &status
		}
	}
	return &b, nil
}

// BusinessBookingByAward reads one award's booking.
func (s *Store) BusinessBookingByAward(ctx context.Context, db DB, awardID uuid.UUID) (*BusinessBooking, error) {
	return scanBusinessBooking(db.QueryRow(ctx, `SELECT `+businessBookingColumns+` FROM mp.business_bookings WHERE award_id = $1`, awardID))
}

// BusinessBookingForUpdate reads and locks one award's booking.
func (s *Store) BusinessBookingForUpdate(ctx context.Context, tx pgx.Tx, awardID uuid.UUID) (*BusinessBooking, error) {
	return scanBusinessBooking(tx.QueryRow(ctx, `SELECT `+businessBookingColumns+` FROM mp.business_bookings WHERE award_id = $1 FOR UPDATE`, awardID))
}

// DueBusinessOps lists awards whose owed op is due another drive.
func (s *Store) DueBusinessOps(ctx context.Context, db DB, now time.Time, limit int) ([]uuid.UUID, error) {
	rows, err := db.Query(ctx, `
		SELECT award_id FROM mp.business_bookings
		WHERE owed_op IS NOT NULL AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
		ORDER BY next_attempt_at NULLS FIRST, award_id
		LIMIT $2`, now, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list owed business ops: %w", err)
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// SetBusinessBilling snapshots the organization's billing identity and cost
// centre the receipt names (from payment-service's status read), once.
func (s *Store) SetBusinessBilling(ctx context.Context, db DB, awardID uuid.UUID, status *BusinessReservationStatus) error {
	encoded, err := json.Marshal(status)
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, `UPDATE mp.business_bookings SET billing = $2 WHERE award_id = $1 AND billing IS NULL`, awardID, encoded)
	return err
}
