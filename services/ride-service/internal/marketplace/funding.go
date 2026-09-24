package marketplace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// FundingRequest is the rider-side funding authorization the award saga asks
// for before the winning commission is captured: it secures the SELECTED
// amount with the request's stored payment method. Cash is validated locally
// against city config; wallet funding goes through this port to
// payment-service, which now answers with a DURABLE reservation (C02) rather
// than a check that evaporates.
type FundingRequest struct {
	RequesterID     uuid.UUID `json:"requesterId"`
	RequestID       uuid.UUID `json:"requestId"`
	AwardID         uuid.UUID `json:"awardId"`
	PaymentMethodID string    `json:"paymentMethodId"`
	AmountMinor     int64     `json:"amountMinor"`
	Currency        string    `json:"currency"`
	CityID          string    `json:"cityId"`
}

// FundingAuthorization is payment-service's authorize answer (C02): whether
// the amount is SECURED by a durable reservation (wallet) or explicitly
// unsecured (cash), and which reservation backs a secured one.
type FundingAuthorization struct {
	Authorized      bool    `json:"authorized"`
	AwardID         string  `json:"awardId"`
	PaymentMethodID string  `json:"paymentMethodId"`
	Secured         bool    `json:"secured"`
	ReservationID   *string `json:"reservationId"`
}

// fundingReleaseResponse is the release endpoint's answer.
type fundingReleaseResponse struct {
	Released bool   `json:"released"`
	Status   string `json:"status"`
}

// ErrFundingReservationConsumed marks a release that found the reservation
// already CONSUMED: the award settled with this money, so settlement and the
// abandoning path disagree about the award's outcome. It is a DEFINITE
// answer — retrying can never change it — and callers must alarm, not loop.
var ErrFundingReservationConsumed = errors.New("rider funding reservation already consumed")

// FundingPort is the small port the award saga uses for rider funding. Every
// call carries its own idempotency key (derived from the award id), so a
// retry converges instead of authorizing or releasing twice.
type FundingPort interface {
	Authorize(ctx context.Context, req FundingRequest, idempotencyKey string) (*FundingAuthorization, error)
	// Release frees the award's active funding reservation with a linked
	// reason. It is idempotent and forgiving on the wallet side
	// (missing/already-released answer the current state); a reservation the
	// settlement already consumed answers ErrFundingReservationConsumed.
	Release(ctx context.Context, awardID uuid.UUID, reason string, idempotencyKey string) error

	// Post-award funding amendments (A02; payment-service
	// docs/MARKETPLACE-MONEY.md). The award's original reservation is never
	// edited: a fare increase tops it up with a linked adjustment BEFORE
	// approvals and commits it when the amendment commits (or releases it on
	// reject/expiry); a decrease partially releases at commit. The amendment
	// id is the idempotency authority; bare-integer amounts, like Authorize.
	TopUp(ctx context.Context, req FundingAmendment, idempotencyKey string) (*FundingAdjustment, error)
	CommitTopUp(ctx context.Context, awardID uuid.UUID, amendmentID string, newAmountMinor int64, idempotencyKey string) (*FundingAdjustment, error)
	ReleaseTopUp(ctx context.Context, awardID uuid.UUID, amendmentID, reason string, idempotencyKey string) (*FundingAdjustment, error)
	PartialRelease(ctx context.Context, req FundingAmendment, idempotencyKey string) (*FundingAdjustment, error)
}

// FundingAmendment is the body of /funding/top-up and
// /funding/partial-release: the award's funded amount as ride-service knows
// it and the amended fare. payment-service verifies the prior against the
// original reservation plus committed adjustments (a stale prior is
// version_conflict with refreshedTerms.fundedAmountMinor) and derives the
// delta itself.
type FundingAmendment struct {
	RequesterID      uuid.UUID `json:"requesterId"`
	AwardID          uuid.UUID `json:"awardId"`
	AmendmentID      string    `json:"amendmentId"`
	PaymentMethodID  string    `json:"paymentMethodId"`
	PriorAmountMinor int64     `json:"priorAmountMinor"`
	NewAmountMinor   int64     `json:"newAmountMinor"`
	Currency         string    `json:"currency"`
	CityID           string    `json:"cityId"`
}

// FundingAdjustment is payment-service's answer to every funding amendment
// call. `secured` is false for cash (nothing to encumber).
type FundingAdjustment struct {
	AwardID          string  `json:"awardId"`
	AmendmentID      string  `json:"amendmentId"`
	Kind             string  `json:"kind"`
	Secured          bool    `json:"secured"`
	Status           string  `json:"status"`
	AdjustmentID     *string `json:"adjustmentId"`
	ReservationID    *string `json:"reservationId"`
	DeltaMinor       int64   `json:"deltaMinor"`
	PriorAmountMinor *int64  `json:"priorAmountMinor"`
	NewAmountMinor   *int64  `json:"newAmountMinor"`
	Currency         *string `json:"currency"`
	Replayed         bool    `json:"replayed"`
}

// fundingReleaseKeyFor is the ONE idempotency key an award's rider funding is
// ever released under, so compensation and the sweep converge on one release.
func fundingReleaseKeyFor(awardID uuid.UUID) string {
	return "mp.fund.release:" + awardID.String()
}

// RecoveryFundingRelease is a rider funding release the engine still owes
// payment-service (mp.reservation_recovery action). The sweep re-drives it
// under the award's one release key until the wallet answers.
const RecoveryFundingRelease = "funding_release"

// FundingReleaseRecoveryPayload is what a funding_release recovery row needs
// to converge: the award and the reason the release must carry.
type FundingReleaseRecoveryPayload struct {
	AwardID uuid.UUID `json:"awardId"`
	Reason  string    `json:"reason"`
}

// HTTPFunding talks to payment-service. An HTTPFunding with no base URL
// refuses every call: funding nobody wired must fail closed, not pretend the
// rider can pay.
type HTTPFunding struct {
	baseURL    string
	serviceKey string
	client     *http.Client
}

// NewHTTPFunding builds the client. `baseURL` is PAYMENT_SERVICE_URL and
// `serviceKey` is INTERNAL_SERVICE_KEY.
func NewHTTPFunding(baseURL, serviceKey string, client *http.Client) *HTTPFunding {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &HTTPFunding{baseURL: baseURL, serviceKey: serviceKey, client: client}
}

// call posts one funding request and decodes a 2xx answer into target.
func (f *HTTPFunding) call(ctx context.Context, path string, body any, idempotencyKey string, target any) error {
	if f.baseURL == "" {
		return domain.Errorf(domain.CodeServiceUnavailable,
			"rider funding is not configured; the selection cannot be completed")
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("unserialisable funding request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		f.baseURL+path, bytes.NewReader(encoded))
	if err != nil {
		return fmt.Errorf("failed to build funding request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Service-Key", f.serviceKey)
	request.Header.Set("Idempotency-Key", idempotencyKey)

	response, err := f.client.Do(request)
	if err != nil {
		// The wire failed: the call may or may not have been recorded.
		return fmt.Errorf("%w: %v", ErrWalletUnknownOutcome, err)
	}
	defer func() { _ = response.Body.Close() }()

	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("%w: %v", ErrWalletUnknownOutcome, err)
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		if target == nil {
			return nil
		}
		if err := json.Unmarshal(raw, target); err != nil {
			// The call landed but the answer is unreadable: the operation is
			// idempotent, so a retry converges on the recorded outcome.
			return fmt.Errorf("%w: unreadable funding response: %v", ErrWalletUnknownOutcome, err)
		}
		return nil
	}
	var failure walletError
	if err := json.Unmarshal(raw, &failure); err == nil && failure.Code != "" {
		return domain.Errorf(domain.Code(failure.Code), "%s", failure.Message).WithDetails(failure.Details)
	}
	if response.StatusCode >= 500 {
		return fmt.Errorf("%w: funding answered %d", ErrWalletUnknownOutcome, response.StatusCode)
	}
	return domain.Errorf(domain.CodeServiceUnavailable, "funding refused the call with status %d", response.StatusCode)
}

// Authorize implements FundingPort against POST /v1/wallet/mp/funding/authorize.
func (f *HTTPFunding) Authorize(ctx context.Context, req FundingRequest, idempotencyKey string) (*FundingAuthorization, error) {
	var auth FundingAuthorization
	if err := f.call(ctx, "/v1/wallet/mp/funding/authorize", req, idempotencyKey, &auth); err != nil {
		return nil, err
	}
	return &auth, nil
}

// Release implements FundingPort against POST /v1/wallet/mp/funding/release.
func (f *HTTPFunding) Release(ctx context.Context, awardID uuid.UUID, reason string, idempotencyKey string) error {
	body := map[string]any{"awardId": awardID.String(), "reason": reason}
	var answer fundingReleaseResponse
	if err := f.call(ctx, "/v1/wallet/mp/funding/release", body, idempotencyKey, &answer); err != nil {
		return err
	}
	if answer.Status == "consumed" {
		// Reported distinctly by the wallet so this side can alarm: the award
		// already settled with the reserved money.
		return fmt.Errorf("%w: award %s", ErrFundingReservationConsumed, awardID)
	}
	return nil
}

// TopUp implements FundingPort against POST /v1/wallet/mp/funding/top-up.
func (f *HTTPFunding) TopUp(ctx context.Context, req FundingAmendment, idempotencyKey string) (*FundingAdjustment, error) {
	var adjustment FundingAdjustment
	if err := f.call(ctx, "/v1/wallet/mp/funding/top-up", req, idempotencyKey, &adjustment); err != nil {
		return nil, err
	}
	return &adjustment, nil
}

// CommitTopUp implements FundingPort against POST
// /v1/wallet/mp/funding/top-up/commit.
func (f *HTTPFunding) CommitTopUp(ctx context.Context, awardID uuid.UUID, amendmentID string, newAmountMinor int64, idempotencyKey string) (*FundingAdjustment, error) {
	var adjustment FundingAdjustment
	body := map[string]any{"awardId": awardID.String(), "amendmentId": amendmentID, "newAmountMinor": newAmountMinor}
	if err := f.call(ctx, "/v1/wallet/mp/funding/top-up/commit", body, idempotencyKey, &adjustment); err != nil {
		return nil, err
	}
	return &adjustment, nil
}

// ReleaseTopUp implements FundingPort against POST
// /v1/wallet/mp/funding/top-up/release — safe even if the top-up never
// landed (payment-service closes the amendment).
func (f *HTTPFunding) ReleaseTopUp(ctx context.Context, awardID uuid.UUID, amendmentID, reason string, idempotencyKey string) (*FundingAdjustment, error) {
	var adjustment FundingAdjustment
	body := map[string]any{"awardId": awardID.String(), "amendmentId": amendmentID, "reason": reason}
	if err := f.call(ctx, "/v1/wallet/mp/funding/top-up/release", body, idempotencyKey, &adjustment); err != nil {
		return nil, err
	}
	return &adjustment, nil
}

// PartialRelease implements FundingPort against POST
// /v1/wallet/mp/funding/partial-release.
func (f *HTTPFunding) PartialRelease(ctx context.Context, req FundingAmendment, idempotencyKey string) (*FundingAdjustment, error) {
	var adjustment FundingAdjustment
	if err := f.call(ctx, "/v1/wallet/mp/funding/partial-release", req, idempotencyKey, &adjustment); err != nil {
		return nil, err
	}
	return &adjustment, nil
}
