package marketplace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// The business-travel port (A06 part C): ride-service's side of
// payment-service's internal API at BUSINESS_INTERNAL_BASE_PATH
// (/v1/finance/business; packages/contracts/src/business-travel.ts). Every
// call carries X-Service-Key; every POST but /policy-check an
// Idempotency-Key; /policy-check and /reserve an X-City-ID — the TRIP's city,
// whose business_travel flag, budget month and tax rates apply.
//
// Answers: 201 recorded / 200 replayed (BusinessOpResult); refusals are the
// canonical error body with details.reason from BUSINESS_REFUSAL_REASONS (or
// cancel_not_permitted), returned here as a definite *domain.Error carrying
// payment-service's code and details. A wire failure, a timeout, a 5xx or an
// unreadable 2xx is an UNKNOWN outcome (ErrWalletUnknownOutcome): the caller
// reconciles through ReservationStatus and re-sends under the SAME key.

// BusinessInternalBasePath mirrors BUSINESS_INTERNAL_BASE_PATH.
const BusinessInternalBasePath = "/v1/finance/business"

// Business refusal reasons (details.reason; BUSINESS_REFUSAL_REASONS) this
// service branches on, plus the release refusal.
const (
	BusinessReasonFeatureDisabled    = "feature_disabled"
	BusinessReasonBookerUnauthorized = "booker_not_authorized"
	BusinessReasonNoBudget           = "no_budget_for_period"
	BusinessReasonBudgetInsufficient = "budget_insufficient"
	BusinessReasonCancelNotPermitted = "cancel_not_permitted"
)

// Business cancel parties (BUSINESS_CANCEL_PARTIES).
const (
	BusinessPartyTraveller = "traveller"
	BusinessPartyBooker    = "booker"
	BusinessPartyOrgAdmin  = "org_admin"
	BusinessPartySystem    = "system"
)

// Budget reservation states (BUDGET_RESERVATION_STATES).
const (
	BudgetReservationReserved  = "reserved"
	BudgetReservationCommitted = "committed"
	BudgetReservationReleased  = "released"
)

// BusinessBookingTerms is BusinessBookingTermsSchema: the terms ride-service
// states at POLICY CHECK (read-only) and at RESERVE. AmountMinor is the
// server-computed total in integer minor units — the agreed fare, never the
// driver's commission.
type BusinessBookingTerms struct {
	BookingRef      string `json:"bookingRef"`
	OrganizationID  string `json:"organizationId"`
	CostCentreID    string `json:"costCentreId,omitempty"`
	BookerID        string `json:"bookerId"`
	TravellerID     string `json:"travellerId"`
	Service         string `json:"service"`
	VehicleClass    string `json:"vehicleClass"`
	AmountMinor     int64  `json:"amountMinor"`
	Currency        string `json:"currency"`
	ExpenseCategory string `json:"expenseCategory,omitempty"`
}

// BusinessPolicyVerdict is BusinessPolicyCheckResultSchema.
type BusinessPolicyVerdict struct {
	Allowed       bool     `json:"allowed"`
	Reasons       []string `json:"reasons"`
	CostCentreID  *string  `json:"costCentreId"`
	BudgetID      *string  `json:"budgetId"`
	Available     *Money   `json:"available"`
	PolicyVersion *int     `json:"policyVersion"`
}

// BusinessTaxLine is BusinessTaxLineSchema: a tax INCLUDED in the committed
// amount at the trip city's configured rate.
type BusinessTaxLine struct {
	Code        string `json:"code"`
	RateBps     int    `json:"rateBps"`
	AmountMinor int64  `json:"amountMinor"`
}

// BusinessReservation is BusinessReservationViewSchema.
type BusinessReservation struct {
	ReservationID   string            `json:"reservationId"`
	BookingRef      string            `json:"bookingRef"`
	OrganizationID  string            `json:"organizationId"`
	CostCentreID    string            `json:"costCentreId"`
	BudgetID        string            `json:"budgetId"`
	Period          string            `json:"period"`
	BookerID        string            `json:"bookerId"`
	TravellerID     string            `json:"travellerId"`
	Service         string            `json:"service"`
	VehicleClass    string            `json:"vehicleClass"`
	ExpenseCategory *string           `json:"expenseCategory"`
	State           string            `json:"state"`
	Reserved        Money             `json:"reserved"`
	Committed       *Money            `json:"committed"`
	Taxes           []BusinessTaxLine `json:"taxes"`
	CommitEntryID   *string           `json:"commitEntryId"`
	PolicyVersion   int               `json:"policyVersion"`
	ReleaseReason   *string           `json:"releaseReason"`
	ReleasedBy      *string           `json:"releasedBy"`
	CreatedAt       string            `json:"createdAt"`
	CommittedAt     *string           `json:"committedAt"`
	ReleasedAt      *string           `json:"releasedAt"`
}

// BusinessOpRecord is one recorded op on a reservation (the status read).
type BusinessOpRecord struct {
	Ref       string  `json:"ref"`
	Op        string  `json:"op"`
	ClientKey string  `json:"clientKey"`
	Amount    Money   `json:"amount"`
	EntryID   *string `json:"entryId"`
	CreatedAt string  `json:"createdAt"`
}

// BusinessOpResult is BusinessOpResultSchema (reserve, commit, release).
type BusinessOpResult struct {
	Ref         string              `json:"ref"`
	Op          string              `json:"op"`
	EntryID     *string             `json:"entryId"`
	Amount      Money               `json:"amount"`
	Reservation BusinessReservation `json:"reservation"`
	Replayed    bool                `json:"replayed"`
}

// BusinessBilling is the organization's billing identity a business receipt
// names (BusinessReservationStatusSchema.organization).
type BusinessBilling struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	LegalName *string `json:"legalName"`
	TaxID     *string `json:"taxId"`
}

// BusinessCostCentre is the reservation's cost centre as the receipt names it.
type BusinessCostCentre struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

// BusinessReservationStatus is BusinessReservationStatusSchema: what
// GET /reservations/:bookingRef answers — for a caller whose request timed
// out, and for the business receipt.
type BusinessReservationStatus struct {
	Reservation  BusinessReservation `json:"reservation"`
	Ops          []BusinessOpRecord  `json:"ops"`
	Organization *BusinessBilling    `json:"organization"`
	CostCentre   *BusinessCostCentre `json:"costCentre"`
}

// BusinessCommitRequest is BusinessCommitInputSchema: the ACTUAL total at
// completion, never above the reservation.
type BusinessCommitRequest struct {
	BookingRef  string `json:"bookingRef"`
	ActualMinor int64  `json:"actualMinor"`
	Currency    string `json:"currency"`
}

// BusinessCancelledBy names who cancelled (BUSINESS_CANCEL_PARTIES). UserID
// is nil exactly for the system.
type BusinessCancelledBy struct {
	Party  string  `json:"party"`
	UserID *string `json:"userId"`
}

// BusinessReleaseRequest is BusinessReleaseInputSchema.
type BusinessReleaseRequest struct {
	BookingRef  string              `json:"bookingRef"`
	CancelledBy BusinessCancelledBy `json:"cancelledBy"`
	Reason      string              `json:"reason"`
}

// BusinessPort is everything ride-service asks of payment-service's business
// API. Reserve, Commit and Release are idempotent on their key AND on the
// booking ref (one reservation per ref ever, at most one commit and one
// release); a replay answers the original result.
type BusinessPort interface {
	PolicyCheck(ctx context.Context, cityID string, terms BusinessBookingTerms) (*BusinessPolicyVerdict, error)
	Reserve(ctx context.Context, cityID string, terms BusinessBookingTerms, idempotencyKey string) (*BusinessOpResult, error)
	Commit(ctx context.Context, req BusinessCommitRequest, idempotencyKey string) (*BusinessOpResult, error)
	Release(ctx context.Context, req BusinessReleaseRequest, idempotencyKey string) (*BusinessOpResult, error)
	ReservationStatus(ctx context.Context, bookingRef string) (*BusinessReservationStatus, error)
}

// HTTPBusiness talks to payment-service's /v1/finance/business with the
// internal service key. With no base URL it refuses every call with a
// definite service_unavailable: business travel nobody wired fails closed,
// never pretends an organization paid.
type HTTPBusiness struct {
	baseURL    string
	serviceKey string
	client     *http.Client
}

// NewHTTPBusiness builds the client. `baseURL` is PAYMENT_SERVICE_URL and
// `serviceKey` is INTERNAL_SERVICE_KEY.
func NewHTTPBusiness(baseURL, serviceKey string, client *http.Client) *HTTPBusiness {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &HTTPBusiness{baseURL: baseURL, serviceKey: serviceKey, client: client}
}

// errBusinessUnconfigured is the definite refusal of an unwired port.
func errBusinessUnconfigured() *domain.Error {
	return domain.Errorf(domain.CodeServiceUnavailable, "business travel is not configured here").
		WithDetails(map[string]any{"reason": "business_unconfigured"})
}

func (b *HTTPBusiness) call(ctx context.Context, method, path, cityID, idempotencyKey string, body, target any) error {
	if b == nil || b.baseURL == "" || b.serviceKey == "" {
		return errBusinessUnconfigured()
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("unserialisable business request: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, b.baseURL+BusinessInternalBasePath+path, reader)
	if err != nil {
		return fmt.Errorf("failed to build the business request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Service-Key", b.serviceKey)
	if idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}
	if cityID != "" {
		request.Header.Set("X-City-ID", cityID)
	}
	response, err := b.client.Do(request)
	if err != nil {
		// The wire failed: payment-service may or may not have recorded it.
		return fmt.Errorf("%w: %v", ErrWalletUnknownOutcome, err)
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("%w: %v", ErrWalletUnknownOutcome, err)
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		if err := json.Unmarshal(raw, target); err != nil {
			// Landed, unreadable: the op is idempotent, so a re-send converges.
			return fmt.Errorf("%w: unreadable business answer: %v", ErrWalletUnknownOutcome, err)
		}
		return nil
	}
	if response.StatusCode >= 500 {
		return fmt.Errorf("%w: the business API answered %d", ErrWalletUnknownOutcome, response.StatusCode)
	}
	var failure walletError
	if err := json.Unmarshal(raw, &failure); err == nil && failure.Code != "" {
		// A definite answer: carry payment-service's code and details.reason.
		return domain.Errorf(domain.Code(failure.Code), "%s", failure.Message).WithDetails(failure.Details)
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return domain.Errorf(domain.CodeServiceUnavailable, "the business API refused this service's key").
			WithDetails(map[string]any{"reason": "business_unconfigured"})
	}
	return domain.Errorf(domain.CodeServiceUnavailable, "the business API refused the call with status %d", response.StatusCode)
}

// PolicyCheck implements BusinessPort against POST /policy-check.
func (b *HTTPBusiness) PolicyCheck(ctx context.Context, cityID string, terms BusinessBookingTerms) (*BusinessPolicyVerdict, error) {
	var verdict BusinessPolicyVerdict
	if err := b.call(ctx, http.MethodPost, "/policy-check", cityID, "", terms, &verdict); err != nil {
		return nil, err
	}
	return &verdict, nil
}

// Reserve implements BusinessPort against POST /reserve.
func (b *HTTPBusiness) Reserve(ctx context.Context, cityID string, terms BusinessBookingTerms, idempotencyKey string) (*BusinessOpResult, error) {
	var result BusinessOpResult
	if err := b.call(ctx, http.MethodPost, "/reserve", cityID, idempotencyKey, terms, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Commit implements BusinessPort against POST /commit.
func (b *HTTPBusiness) Commit(ctx context.Context, req BusinessCommitRequest, idempotencyKey string) (*BusinessOpResult, error) {
	var result BusinessOpResult
	if err := b.call(ctx, http.MethodPost, "/commit", "", idempotencyKey, req, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Release implements BusinessPort against POST /release.
func (b *HTTPBusiness) Release(ctx context.Context, req BusinessReleaseRequest, idempotencyKey string) (*BusinessOpResult, error) {
	var result BusinessOpResult
	if err := b.call(ctx, http.MethodPost, "/release", "", idempotencyKey, req, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ReservationStatus implements BusinessPort against GET
// /reservations/:bookingRef. A booking with no reservation is a definite
// not_found.
func (b *HTTPBusiness) ReservationStatus(ctx context.Context, bookingRef string) (*BusinessReservationStatus, error) {
	var status BusinessReservationStatus
	if err := b.call(ctx, http.MethodGet, "/reservations/"+url.PathEscape(bookingRef), "", "", nil, &status); err != nil {
		return nil, err
	}
	return &status, nil
}

// unconfiguredBusiness is the port an unwired deployment gets.
type unconfiguredBusiness struct{}

func (unconfiguredBusiness) PolicyCheck(context.Context, string, BusinessBookingTerms) (*BusinessPolicyVerdict, error) {
	return nil, errBusinessUnconfigured()
}
func (unconfiguredBusiness) Reserve(context.Context, string, BusinessBookingTerms, string) (*BusinessOpResult, error) {
	return nil, errBusinessUnconfigured()
}
func (unconfiguredBusiness) Commit(context.Context, BusinessCommitRequest, string) (*BusinessOpResult, error) {
	return nil, errBusinessUnconfigured()
}
func (unconfiguredBusiness) Release(context.Context, BusinessReleaseRequest, string) (*BusinessOpResult, error) {
	return nil, errBusinessUnconfigured()
}
func (unconfiguredBusiness) ReservationStatus(context.Context, string) (*BusinessReservationStatus, error) {
	return nil, errBusinessUnconfigured()
}

// business answers the wired port, or the fail-closed one.
func (s *Service) business() BusinessPort {
	if s.deps.Business == nil {
		return unconfiguredBusiness{}
	}
	return s.deps.Business
}

// businessReasonOf reads details.reason off a definite business refusal.
func businessReasonOf(err error) string {
	var mapped *domain.Error
	if errors.As(err, &mapped) && mapped.Details != nil {
		if reason, ok := mapped.Details["reason"].(string); ok {
			return reason
		}
	}
	return ""
}
