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

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// Money is the one cross-language money shape (contracts Money): integer
// minor units with an explicit currency. Every client-facing amount and every
// payment-service wire amount is a Money object, never a bare integer.
type Money struct {
	AmountMinor int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
}

// money builds a Money value.
func money(amountMinor int64, currency string) Money {
	return Money{AmountMinor: amountMinor, Currency: currency}
}

// ErrWalletUnknownOutcome marks a wallet call whose outcome this service does
// not know: the request may or may not have been applied. The caller must
// treat the money as possibly moved — record a recovery row and let the sweep
// converge with the wallet's idempotency, never assume "failed means no-op".
var ErrWalletUnknownOutcome = errors.New("wallet outcome unknown")

// Hold is the wallet's view of one commission reservation
// (contracts/openapi/marketplace.yaml → WalletHold). Its money fields are
// Money objects, exactly as payment-service serialises them.
type Hold struct {
	ReservationID string `json:"reservationId"`
	BidID         string `json:"bidId"`
	DriverID      string `json:"driverId"`
	State         string `json:"state"`
	AmountMinor   Money  `json:"amountMinor"`
	BaseMinor     Money  `json:"baseMinor"`
	PolicyVersion int    `json:"policyVersion"`
}

// CaptureResult is the answer to the single commission capture.
type CaptureResult struct {
	Hold           Hold   `json:"hold"`
	ReceiptID      string `json:"receiptId"`
	JournalEntryID string `json:"journalEntryId"`
}

// Overview is the driver's wallet with the one server-computed spendable
// (contract WalletOverview: Money objects throughout).
type Overview struct {
	ClearedMinor   Money  `json:"clearedMinor"`
	HeldMinor      Money  `json:"heldMinor"`
	SpendableMinor Money  `json:"spendableMinor"`
	Holds          []Hold `json:"holds"`
}

// ReserveRequest is the body of POST /v1/wallet/mp/holds/reserve. amountMinor
// and baseMinor are Money objects per the contract.
type ReserveRequest struct {
	DriverID      uuid.UUID `json:"driverId"`
	BidID         uuid.UUID `json:"bidId"`
	RequestID     uuid.UUID `json:"requestId"`
	AmountMinor   Money     `json:"amountMinor"`
	BaseMinor     Money     `json:"baseMinor"`
	PolicyVersion int       `json:"policyVersion"`
	CityID        string    `json:"cityId"`
}

// ExecutionRef names the execution a marketplace award produced.
type ExecutionRef struct {
	Service string `json:"service"`
	ID      string `json:"id"`
}

// SettlementRequest is the body of POST /v1/wallet/mp/settlements (M06): the
// completion-time settlement of a marketplace execution. The 10% fee was
// captured at selection and is NEVER charged here.
type SettlementRequest struct {
	AwardID      uuid.UUID    `json:"awardId"`
	ExecutionRef ExecutionRef `json:"executionRef"`
	RequesterID  uuid.UUID    `json:"requesterId"`
	DriverID     uuid.UUID    `json:"driverId"`
	FareMinor    Money        `json:"fareMinor"`
	Method       string       `json:"method"`
	CityID       string       `json:"cityId"`
}

// WalletPort is everything the marketplace engine asks of payment-service.
// Every mutating call carries its own idempotency key, so a retry converges on
// the wallet rather than moving money twice.
type WalletPort interface {
	Reserve(ctx context.Context, req ReserveRequest, idempotencyKey string) (*Hold, error)
	Adjust(ctx context.Context, reservationID string, amountMinor, baseMinor Money, idempotencyKey string) (*Hold, error)
	Release(ctx context.Context, reservationID string, idempotencyKey string) (*Hold, error)
	// Capture debits the winning hold exactly once under the award id.
	// expectedAmountMinor is the award's PINNED commission: a hold whose
	// current amount differs is refused with a definite conflict, which the
	// saga compensates instead of debiting terms that were never awarded.
	Capture(ctx context.Context, reservationID, awardID string, expectedAmountMinor Money, idempotencyKey string) (*CaptureResult, error)
	Reverse(ctx context.Context, reservationID, awardID, reason string, idempotencyKey string) (*Hold, error)
	Overview(ctx context.Context, driverID uuid.UUID, cityID string) (*Overview, error)

	// Post-award commission deltas (A02; payment-service
	// docs/MARKETPLACE-MONEY.md "Post-award amendments"). `reservationID` is
	// the award's CAPTURED hold; the amendment id is the idempotency
	// authority. Only the difference ever moves: a fare increase reserves
	// then captures the increment once, a decrease refunds prior − new as a
	// linked partial reversal — the 10% is never charged twice.
	ReserveCommissionDelta(ctx context.Context, reservationID, amendmentID string, terms DeltaTerms, idempotencyKey string) (*CommissionDelta, error)
	CaptureCommissionDelta(ctx context.Context, reservationID, amendmentID, awardID string, newTotalMinor Money, idempotencyKey string) (*CommissionDelta, error)
	ReleaseCommissionDelta(ctx context.Context, reservationID, amendmentID, awardID, reason string, idempotencyKey string) (*CommissionDelta, error)
	RefundCommissionDelta(ctx context.Context, reservationID, amendmentID string, terms DeltaTerms, idempotencyKey string) (*CommissionDelta, error)
}

// DeltaTerms is the body of the commission-delta reserve and refund calls:
// the award's captured total as ride-service knows it, the new total (the
// ONE commission function applied to the new fare) and the amended
// commissionable fare. payment-service checks the prior against its ledger
// (a stale prior is version_conflict with refreshedTerms) and derives the
// delta itself.
type DeltaTerms struct {
	AwardID         string `json:"awardId"`
	PriorTotalMinor Money  `json:"priorTotalMinor"`
	NewTotalMinor   Money  `json:"newTotalMinor"`
	NewBaseMinor    Money  `json:"newBaseMinor"`
}

// CommissionDelta is payment-service's MpCommissionDelta answer.
type CommissionDelta struct {
	ReservationID      string  `json:"reservationId"`
	AmendmentID        string  `json:"amendmentId"`
	AwardID            string  `json:"awardId"`
	Direction          string  `json:"direction"`
	State              string  `json:"state"`
	DeltaReservationID *string `json:"deltaReservationId"`
	DeltaMinor         Money   `json:"deltaMinor"`
	PriorTotalMinor    *Money  `json:"priorTotalMinor"`
	NewTotalMinor      *Money  `json:"newTotalMinor"`
	NewBaseMinor       *Money  `json:"newBaseMinor"`
	ReceiptID          *string `json:"receiptId"`
	JournalEntryID     *string `json:"journalEntryId"`
	OriginalReceiptID  *string `json:"originalReceiptId"`
}

// SettlementPort is the completion-settlement port (M06), idempotent on the
// award id: a replay returns the original outcome and never moves money twice.
type SettlementPort interface {
	Settle(ctx context.Context, req SettlementRequest, idempotencyKey string) error
}

// HTTPWallet talks to payment-service's /v1/wallet/mp/* surface with the
// internal service key. An HTTPWallet with no base URL refuses every call:
// a wallet nobody wired must fail closed, not pretend to reserve. It also
// implements SettlementPort against POST /v1/wallet/mp/settlements.
type HTTPWallet struct {
	baseURL    string
	serviceKey string
	client     *http.Client
}

// NewHTTPWallet builds the client. `baseURL` is PAYMENT_SERVICE_URL and
// `serviceKey` is INTERNAL_SERVICE_KEY.
func NewHTTPWallet(baseURL, serviceKey string, client *http.Client) *HTTPWallet {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &HTTPWallet{baseURL: baseURL, serviceKey: serviceKey, client: client}
}

// walletError is the canonical error body payment-service answers with.
type walletError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details"`
}

func (w *HTTPWallet) call(ctx context.Context, method, path string, body any, idempotencyKey string, target any) error {
	if w.baseURL == "" {
		return domain.Errorf(domain.CodeServiceUnavailable,
			"the wallet is not configured; funded bidding is unavailable")
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("unserialisable wallet request: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, w.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("failed to build wallet request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Service-Key", w.serviceKey)
	if idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}

	response, err := w.client.Do(request)
	if err != nil {
		// The wire failed: the wallet may or may not have applied the call.
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
			return fmt.Errorf("unreadable wallet response: %w", err)
		}
		return nil
	}

	var failure walletError
	if err := json.Unmarshal(raw, &failure); err == nil && failure.Code != "" {
		// The wallet answered a definite no; carry its code and details through.
		return domain.Errorf(domain.Code(failure.Code), "%s", failure.Message).WithDetails(failure.Details)
	}
	if response.StatusCode == http.StatusConflict {
		// A 409 is a DEFINITE refusal even without a parseable body: for
		// capture it means the hold no longer matches the awarded terms, and
		// the saga must compensate, never keep polling.
		return domain.Errorf(domain.CodeConflict, "the wallet refused the call with status %d", response.StatusCode)
	}
	if response.StatusCode >= 500 {
		return fmt.Errorf("%w: the wallet answered %d", ErrWalletUnknownOutcome, response.StatusCode)
	}
	return domain.Errorf(domain.CodeServiceUnavailable, "the wallet refused the call with status %d", response.StatusCode)
}

// Reserve implements WalletPort.
func (w *HTTPWallet) Reserve(ctx context.Context, req ReserveRequest, idempotencyKey string) (*Hold, error) {
	var hold Hold
	if err := w.call(ctx, http.MethodPost, "/v1/wallet/mp/holds/reserve", req, idempotencyKey, &hold); err != nil {
		return nil, err
	}
	return &hold, nil
}

// Adjust implements WalletPort.
func (w *HTTPWallet) Adjust(ctx context.Context, reservationID string, amountMinor, baseMinor Money, idempotencyKey string) (*Hold, error) {
	var hold Hold
	body := map[string]any{"amountMinor": amountMinor, "baseMinor": baseMinor}
	if err := w.call(ctx, http.MethodPost, "/v1/wallet/mp/holds/"+reservationID+"/adjust", body, idempotencyKey, &hold); err != nil {
		return nil, err
	}
	return &hold, nil
}

// Release implements WalletPort.
func (w *HTTPWallet) Release(ctx context.Context, reservationID string, idempotencyKey string) (*Hold, error) {
	var hold Hold
	if err := w.call(ctx, http.MethodPost, "/v1/wallet/mp/holds/"+reservationID+"/release", nil, idempotencyKey, &hold); err != nil {
		return nil, err
	}
	return &hold, nil
}

// Capture implements WalletPort.
func (w *HTTPWallet) Capture(ctx context.Context, reservationID, awardID string, expectedAmountMinor Money, idempotencyKey string) (*CaptureResult, error) {
	var result CaptureResult
	body := map[string]any{"awardId": awardID, "expectedAmountMinor": expectedAmountMinor}
	if err := w.call(ctx, http.MethodPost, "/v1/wallet/mp/holds/"+reservationID+"/capture", body, idempotencyKey, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Reverse implements WalletPort.
func (w *HTTPWallet) Reverse(ctx context.Context, reservationID, awardID, reason string, idempotencyKey string) (*Hold, error) {
	var hold Hold
	body := map[string]any{"awardId": awardID, "reason": reason}
	if err := w.call(ctx, http.MethodPost, "/v1/wallet/mp/holds/"+reservationID+"/reverse", body, idempotencyKey, &hold); err != nil {
		return nil, err
	}
	return &hold, nil
}

// Overview implements WalletPort against the service-authenticated internal
// variant GET /v1/wallet/mp/holds/overview?driverId&cityId.
func (w *HTTPWallet) Overview(ctx context.Context, driverID uuid.UUID, cityID string) (*Overview, error) {
	var overview Overview
	path := "/v1/wallet/mp/holds/overview?driverId=" + driverID.String() + "&cityId=" + cityID
	if err := w.call(ctx, http.MethodGet, path, nil, "", &overview); err != nil {
		return nil, err
	}
	return &overview, nil
}

// amendmentPath is the commission-delta route for one amendment operation.
func amendmentPath(reservationID, amendmentID, op string) string {
	return "/v1/wallet/mp/holds/" + url.PathEscape(reservationID) +
		"/amendments/" + url.PathEscape(amendmentID) + "/" + op
}

// ReserveCommissionDelta implements WalletPort (201 created, 200 replay).
func (w *HTTPWallet) ReserveCommissionDelta(ctx context.Context, reservationID, amendmentID string, terms DeltaTerms, idempotencyKey string) (*CommissionDelta, error) {
	var delta CommissionDelta
	if err := w.call(ctx, http.MethodPost, amendmentPath(reservationID, amendmentID, "reserve"), terms, idempotencyKey, &delta); err != nil {
		return nil, err
	}
	return &delta, nil
}

// CaptureCommissionDelta implements WalletPort: the committed increment,
// debited once; newTotalMinor must be the total it was reserved for.
func (w *HTTPWallet) CaptureCommissionDelta(ctx context.Context, reservationID, amendmentID, awardID string, newTotalMinor Money, idempotencyKey string) (*CommissionDelta, error) {
	var delta CommissionDelta
	body := map[string]any{"awardId": awardID, "newTotalMinor": newTotalMinor}
	if err := w.call(ctx, http.MethodPost, amendmentPath(reservationID, amendmentID, "capture"), body, idempotencyKey, &delta); err != nil {
		return nil, err
	}
	return &delta, nil
}

// ReleaseCommissionDelta implements WalletPort: safe to call for an amendment
// whose reserve never landed (payment-service closes it, so a late reserve is
// refused).
func (w *HTTPWallet) ReleaseCommissionDelta(ctx context.Context, reservationID, amendmentID, awardID, reason string, idempotencyKey string) (*CommissionDelta, error) {
	var delta CommissionDelta
	body := map[string]any{"awardId": awardID, "reason": reason}
	if err := w.call(ctx, http.MethodPost, amendmentPath(reservationID, amendmentID, "release"), body, idempotencyKey, &delta); err != nil {
		return nil, err
	}
	return &delta, nil
}

// RefundCommissionDelta implements WalletPort: a committed decrease's linked
// partial reversal (201 created, 200 replay).
func (w *HTTPWallet) RefundCommissionDelta(ctx context.Context, reservationID, amendmentID string, terms DeltaTerms, idempotencyKey string) (*CommissionDelta, error) {
	var delta CommissionDelta
	if err := w.call(ctx, http.MethodPost, amendmentPath(reservationID, amendmentID, "refund"), terms, idempotencyKey, &delta); err != nil {
		return nil, err
	}
	return &delta, nil
}

// Settle implements SettlementPort against POST /v1/wallet/mp/settlements.
func (w *HTTPWallet) Settle(ctx context.Context, req SettlementRequest, idempotencyKey string) error {
	return w.call(ctx, http.MethodPost, "/v1/wallet/mp/settlements", req, idempotencyKey, nil)
}
