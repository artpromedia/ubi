// Package funding is delivery-service's client for payment-service's
// delivery return-leg fee module, `/v1/finance/delivery-returns` (P17;
// services/payment-service/src/finance/delivery-returns.ts).
//
// delivery-service never moves money. It asks payment-service to reserve a
// return fee from the sender's wallet when the sender approves the return, to
// capture it when the driver proves the parcel is back, and to release it
// when the charge is cancelled or the approval never committed. The return
// leg is a NEW charge: nothing here names, reuses or re-charges the original
// award's 10% commission (payment-service only reads the award's captured
// hold to bind the payee to the award's driver).
//
// Every call carries a deterministic Idempotency-Key derived from the return
// id (`delivery-return:<returnId>:<op>`), so any retry — a timeout, a crash
// between the call and the local commit, a lazy reconciliation on the next
// read — replays the original answer instead of moving money twice.
package funding

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Terms are the money terms of one return charge. All three operations send
// the same terms; payment-service refuses a capture or release whose terms
// differ from the reservation's.
type Terms struct {
	ReturnID   string `json:"returnId"`
	DeliveryID string `json:"deliveryId"`
	AwardID    string `json:"awardId"`
	SenderID   string `json:"senderId"`
	DriverID   string `json:"driverId"`
	FeeMinor   int64  `json:"feeMinor"`
	Currency   string `json:"currency"`
	Reason     string `json:"reason,omitempty"`
	// CityID travels as the X-City-ID header, not in the body.
	CityID string `json:"-"`
}

// Charge is payment-service's answer for one op.
type Charge struct {
	ChargeID       string
	State          string // reserved | captured | released
	ReservationID  string
	CaptureEntryID string
	EntryID        string
	Replayed       bool
}

// Refusal is a definite, business-level "no" from payment-service: nothing
// was written for this op, and retrying with the same terms will not change
// the answer. Code is payment-service's error code.
type Refusal struct {
	Status  int
	Code    string
	Message string
	// ChargeState is the charge's state when payment-service reported it
	// with the refusal (e.g. "released" for a capture refused because ops
	// cancelled the charge); empty otherwise.
	ChargeState string
}

func (r *Refusal) Error() string {
	return fmt.Sprintf("payment-service refused the return fee (%d %s): %s", r.Status, r.Code, r.Message)
}

// InsufficientFunds reports a refusal because the sender's wallet cannot
// cover the fee.
func (r *Refusal) InsufficientFunds() bool {
	return r.Code == "insufficient_funds" || r.Code == "insufficient_spendable"
}

// FeatureDisabled reports a refusal because charged returns are switched off
// in the city (payment-service's marketplace_delivery gate).
func (r *Refusal) FeatureDisabled() bool { return r.Code == "feature_disabled" }

// ErrUnavailable wraps every failure whose outcome is UNKNOWN — a transport
// error, a timeout, a 5xx, an unreadable answer. The op may or may not have
// happened; the caller must keep its write-ahead marker and retry with the
// same idempotency key.
var ErrUnavailable = errors.New("payment-service return-fee outcome unknown")

// Client is the return-fee port. HTTPClient is the production
// implementation; tests may supply their own speaking the same contract.
type Client interface {
	Reserve(ctx context.Context, terms Terms) (Charge, error)
	Capture(ctx context.Context, terms Terms) (Charge, error)
	Release(ctx context.Context, terms Terms) (Charge, error)
}

// IdempotencyKey is the deterministic key for one op on one return.
func IdempotencyKey(returnID, op string) string {
	return "delivery-return:" + returnID + ":" + op
}

// HTTPClient calls payment-service with the internal service key.
type HTTPClient struct {
	baseURL    string
	serviceKey string
	http       *http.Client
}

// NewHTTPClient builds the production client. A short timeout bounds how
// long a sender's approval waits; an unknown outcome is handled by the
// write-ahead marker, not by waiting longer.
func NewHTTPClient(baseURL, serviceKey string) *HTTPClient {
	return &HTTPClient{
		baseURL:    strings.TrimRight(baseURL, "/"),
		serviceKey: serviceKey,
		http:       &http.Client{Timeout: 10 * time.Second},
	}
}

// Reserve holds the fee on the sender's wallet.
func (c *HTTPClient) Reserve(ctx context.Context, terms Terms) (Charge, error) {
	return c.post(ctx, "reserve", terms)
}

// Capture takes the reserved fee, once.
func (c *HTTPClient) Capture(ctx context.Context, terms Terms) (Charge, error) {
	return c.post(ctx, "capture", terms)
}

// Release frees the reserved fee (or tombstones a return never reserved).
func (c *HTTPClient) Release(ctx context.Context, terms Terms) (Charge, error) {
	return c.post(ctx, "release", terms)
}

type opResponse struct {
	ChargeID string  `json:"chargeId"`
	EntryID  *string `json:"entryId"`
	State    string  `json:"state"`
	Replayed bool    `json:"replayed"`
	Charge   struct {
		ReservationID  *string `json:"reservationId"`
		CaptureEntryID *string `json:"captureEntryId"`
	} `json:"charge"`
}

type errorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details struct {
		Charge struct {
			State string `json:"state"`
		} `json:"charge"`
	} `json:"details"`
}

func (c *HTTPClient) post(ctx context.Context, op string, terms Terms) (Charge, error) {
	body, err := json.Marshal(terms)
	if err != nil {
		return Charge{}, fmt.Errorf("encode return fee terms: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/finance/delivery-returns/"+op, bytes.NewReader(body))
	if err != nil {
		return Charge{}, fmt.Errorf("build return fee request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Service-Key", c.serviceKey)
	req.Header.Set("Idempotency-Key", IdempotencyKey(terms.ReturnID, op))
	req.Header.Set("X-City-ID", terms.CityID)

	resp, err := c.http.Do(req)
	if err != nil {
		return Charge{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return Charge{}, fmt.Errorf("%w: read response: %v", ErrUnavailable, err)
	}

	switch {
	case resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated:
		var decoded opResponse
		if err := json.Unmarshal(raw, &decoded); err != nil || decoded.ChargeID == "" {
			return Charge{}, fmt.Errorf("%w: unreadable %s answer", ErrUnavailable, op)
		}
		charge := Charge{ChargeID: decoded.ChargeID, State: decoded.State, Replayed: decoded.Replayed}
		if decoded.EntryID != nil {
			charge.EntryID = *decoded.EntryID
		}
		if decoded.Charge.ReservationID != nil {
			charge.ReservationID = *decoded.Charge.ReservationID
		}
		if decoded.Charge.CaptureEntryID != nil {
			charge.CaptureEntryID = *decoded.Charge.CaptureEntryID
		}
		return charge, nil
	case resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests:
		var decoded errorResponse
		_ = json.Unmarshal(raw, &decoded)
		if decoded.Code == "" {
			// The internal-service-key guard answers its own envelope.
			decoded.Code = "forbidden"
			decoded.Message = strings.TrimSpace(string(raw))
		}
		return Charge{}, &Refusal{Status: resp.StatusCode, Code: decoded.Code, Message: decoded.Message, ChargeState: decoded.Details.Charge.State}
	default:
		return Charge{}, fmt.Errorf("%w: %s answered %d", ErrUnavailable, op, resp.StatusCode)
	}
}

// Disabled is the port when no payment-service is configured: every call is
// refused as unavailable, so a charged return can never be approved.
type Disabled struct{}

func (Disabled) Reserve(context.Context, Terms) (Charge, error) {
	return Charge{}, fmt.Errorf("%w: no payment-service is configured", ErrUnavailable)
}
func (Disabled) Capture(context.Context, Terms) (Charge, error) {
	return Charge{}, fmt.Errorf("%w: no payment-service is configured", ErrUnavailable)
}
func (Disabled) Release(context.Context, Terms) (Charge, error) {
	return Charge{}, fmt.Errorf("%w: no payment-service is configured", ErrUnavailable)
}
