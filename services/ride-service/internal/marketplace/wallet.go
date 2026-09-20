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

// ErrWalletUnknownOutcome marks a wallet call whose outcome this service does
// not know: the request may or may not have been applied. The caller must
// treat the money as possibly moved — record a recovery row and let the sweep
// converge with the wallet's idempotency, never assume "failed means no-op".
var ErrWalletUnknownOutcome = errors.New("wallet outcome unknown")

// Hold is the wallet's view of one commission reservation
// (contracts/openapi/marketplace.yaml → WalletHold).
type Hold struct {
	ReservationID string `json:"reservationId"`
	BidID         string `json:"bidId"`
	DriverID      string `json:"driverId"`
	State         string `json:"state"`
	AmountMinor   int64  `json:"amountMinor"`
	BaseMinor     int64  `json:"baseMinor"`
	PolicyVersion int    `json:"policyVersion"`
}

// CaptureResult is the answer to the single commission capture.
type CaptureResult struct {
	Hold           Hold   `json:"hold"`
	ReceiptID      string `json:"receiptId"`
	JournalEntryID string `json:"journalEntryId"`
}

// Overview is the driver's wallet with the one server-computed spendable.
type Overview struct {
	ClearedMinor   int64  `json:"clearedMinor"`
	HeldMinor      int64  `json:"heldMinor"`
	SpendableMinor int64  `json:"spendableMinor"`
	Holds          []Hold `json:"holds"`
}

// ReserveRequest is the body of POST /v1/wallet/mp/holds/reserve.
type ReserveRequest struct {
	DriverID      uuid.UUID `json:"driverId"`
	BidID         uuid.UUID `json:"bidId"`
	RequestID     uuid.UUID `json:"requestId"`
	AmountMinor   int64     `json:"amountMinor"`
	BaseMinor     int64     `json:"baseMinor"`
	PolicyVersion int       `json:"policyVersion"`
	CityID        string    `json:"cityId"`
}

// WalletPort is everything the marketplace engine asks of payment-service.
// Every mutating call carries its own idempotency key, so a retry converges on
// the wallet rather than moving money twice.
type WalletPort interface {
	Reserve(ctx context.Context, req ReserveRequest, idempotencyKey string) (*Hold, error)
	Adjust(ctx context.Context, reservationID string, amountMinor, baseMinor int64, idempotencyKey string) (*Hold, error)
	Release(ctx context.Context, reservationID string, idempotencyKey string) (*Hold, error)
	Capture(ctx context.Context, reservationID, awardID string, idempotencyKey string) (*CaptureResult, error)
	Reverse(ctx context.Context, reservationID, awardID, reason string, idempotencyKey string) (*Hold, error)
	Overview(ctx context.Context, driverID uuid.UUID) (*Overview, error)
}

// HTTPWallet talks to payment-service's /v1/wallet/mp/* surface with the
// internal service key. An HTTPWallet with no base URL refuses every call:
// a wallet nobody wired must fail closed, not pretend to reserve.
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
func (w *HTTPWallet) Adjust(ctx context.Context, reservationID string, amountMinor, baseMinor int64, idempotencyKey string) (*Hold, error) {
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
func (w *HTTPWallet) Capture(ctx context.Context, reservationID, awardID string, idempotencyKey string) (*CaptureResult, error) {
	var result CaptureResult
	body := map[string]any{"awardId": awardID}
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

// Overview implements WalletPort.
func (w *HTTPWallet) Overview(ctx context.Context, driverID uuid.UUID) (*Overview, error) {
	var overview Overview
	if err := w.call(ctx, http.MethodGet, "/v1/wallet/mp/overview?driverId="+driverID.String(), nil, "", &overview); err != nil {
		return nil, err
	}
	return &overview, nil
}
