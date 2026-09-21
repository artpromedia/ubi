package marketplace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
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

// FakeFunding is the in-memory FundingPort tests drive: idempotent like the
// real one, with injectable definite failures and unknown outcomes, and a
// full record of releases so "released exactly once, with this reason" is a
// property a test can observe.
type FakeFunding struct {
	mu   sync.Mutex
	seen map[string]bool
	// reservations maps awards that authorized a SECURED (non-cash) funding
	// to the fake reservation id the authorize answered.
	reservations map[uuid.UUID]string

	// Fail makes the next Authorize calls answer this definite refusal.
	Fail error
	// Unknown makes Authorize record the authorization but answer
	// ErrWalletUnknownOutcome, which is what a lost response looks like.
	Unknown bool
	// FailRelease makes the next Release calls answer this error.
	FailRelease error
	// Consumed marks awards whose reservation the settlement already
	// consumed: Release answers ErrFundingReservationConsumed for them.
	Consumed map[uuid.UUID]bool

	// Calls counts every Authorize; EffectiveCalls counts non-replayed ones.
	Calls          int
	EffectiveCalls int
	// ReleaseCalls counts every Release; EffectiveReleases counts
	// non-replayed ones. ReleasedAwards records each award's release reason.
	ReleaseCalls      int
	EffectiveReleases int
	ReleasedAwards    map[uuid.UUID]string
}

// NewFakeFunding builds an empty fake.
func NewFakeFunding() *FakeFunding {
	return &FakeFunding{
		seen:           map[string]bool{},
		reservations:   map[uuid.UUID]string{},
		Consumed:       map[uuid.UUID]bool{},
		ReleasedAwards: map[uuid.UUID]string{},
	}
}

// Authorize implements FundingPort.
func (f *FakeFunding) Authorize(_ context.Context, req FundingRequest, idempotencyKey string) (*FundingAuthorization, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls++
	if f.Fail != nil {
		return nil, f.Fail
	}
	if !f.seen[idempotencyKey] {
		f.seen[idempotencyKey] = true
		f.EffectiveCalls++
	}
	if f.Unknown {
		return nil, fmt.Errorf("%w: injected", ErrWalletUnknownOutcome)
	}
	auth := &FundingAuthorization{
		Authorized:      true,
		AwardID:         req.AwardID.String(),
		PaymentMethodID: req.PaymentMethodID,
	}
	if req.PaymentMethodID != "cash" {
		reservationID, ok := f.reservations[req.AwardID]
		if !ok {
			reservationID = "mfr_" + uuid.NewString()
			f.reservations[req.AwardID] = reservationID
		}
		auth.Secured = true
		auth.ReservationID = &reservationID
	}
	return auth, nil
}

// Release implements FundingPort: exactly-once per award, forgiving like the
// real endpoint (missing/already-released answer nil), consumed distinct.
func (f *FakeFunding) Release(_ context.Context, awardID uuid.UUID, reason string, idempotencyKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ReleaseCalls++
	if f.FailRelease != nil {
		return f.FailRelease
	}
	if f.Consumed[awardID] {
		return fmt.Errorf("%w: award %s", ErrFundingReservationConsumed, awardID)
	}
	if f.seen[idempotencyKey] {
		return nil
	}
	f.seen[idempotencyKey] = true
	if _, released := f.ReleasedAwards[awardID]; !released {
		if _, had := f.reservations[awardID]; had {
			f.EffectiveReleases++
		}
		f.ReleasedAwards[awardID] = reason
	}
	return nil
}
