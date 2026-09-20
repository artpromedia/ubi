package marketplace

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// FundingRequest is the rider-side funding authorization the award saga asks
// for before the winning commission is captured: it verifies the SELECTED
// amount can actually be paid with the request's stored payment method. Cash
// is validated locally against city config; wallet funding goes through this
// port to payment-service.
type FundingRequest struct {
	RequesterID     uuid.UUID `json:"requesterId"`
	RequestID       uuid.UUID `json:"requestId"`
	AwardID         uuid.UUID `json:"awardId"`
	PaymentMethodID string    `json:"paymentMethodId"`
	AmountMinor     int64     `json:"amountMinor"`
	Currency        string    `json:"currency"`
	CityID          string    `json:"cityId"`
}

// FundingPort is the small port the award saga uses for rider funding. Every
// call carries its own idempotency key (the award id), so a retry converges
// instead of authorizing twice.
type FundingPort interface {
	Authorize(ctx context.Context, req FundingRequest, idempotencyKey string) error
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

// Authorize implements FundingPort against POST /v1/wallet/mp/funding/authorize.
func (f *HTTPFunding) Authorize(ctx context.Context, req FundingRequest, idempotencyKey string) error {
	if f.baseURL == "" {
		return domain.Errorf(domain.CodeServiceUnavailable,
			"rider funding is not configured; the selection cannot be completed")
	}
	encoded, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("unserialisable funding request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		f.baseURL+"/v1/wallet/mp/funding/authorize", bytes.NewReader(encoded))
	if err != nil {
		return fmt.Errorf("failed to build funding request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Service-Key", f.serviceKey)
	request.Header.Set("Idempotency-Key", idempotencyKey)

	response, err := f.client.Do(request)
	if err != nil {
		// The wire failed: the authorization may or may not have been recorded.
		return fmt.Errorf("%w: %v", ErrWalletUnknownOutcome, err)
	}
	defer func() { _ = response.Body.Close() }()

	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("%w: %v", ErrWalletUnknownOutcome, err)
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
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

// FakeFunding is the in-memory FundingPort tests drive: idempotent like the
// real one, with injectable definite failures and unknown outcomes.
type FakeFunding struct {
	mu   sync.Mutex
	seen map[string]bool

	// Fail makes the next calls answer this definite refusal.
	Fail error
	// Unknown makes calls record the authorization but answer
	// ErrWalletUnknownOutcome, which is what a lost response looks like.
	Unknown bool

	// Calls counts every call; EffectiveCalls counts non-replayed ones.
	Calls          int
	EffectiveCalls int
}

// NewFakeFunding builds an empty fake.
func NewFakeFunding() *FakeFunding {
	return &FakeFunding{seen: map[string]bool{}}
}

// Authorize implements FundingPort.
func (f *FakeFunding) Authorize(_ context.Context, _ FundingRequest, idempotencyKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls++
	if f.Fail != nil {
		return f.Fail
	}
	if !f.seen[idempotencyKey] {
		f.seen[idempotencyKey] = true
		f.EffectiveCalls++
	}
	if f.Unknown {
		return fmt.Errorf("%w: injected", ErrWalletUnknownOutcome)
	}
	return nil
}
