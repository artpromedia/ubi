// Package domain holds the ride-service vocabulary: the canonical error codes
// every UBI service answers with, and the value types that carry money,
// coordinates and fares between the layers.
package domain

import (
	"errors"
	"fmt"
	"net/http"
)

// Code is a canonical error code. The list and the status mapping below are the
// Go port of packages/contracts/src/errors.ts, so this service answers a client
// exactly the way the TypeScript services do.
type Code string

const (
	CodeUnauthorized             Code = "unauthorized"
	CodeForbidden                Code = "forbidden"
	CodeNotFound                 Code = "not_found"
	CodeValidationFailed         Code = "validation_failed"
	CodeRateLimited              Code = "rate_limited"
	CodeConflict                 Code = "conflict"
	CodeInternalError            Code = "internal_error"
	CodeServiceUnavailable       Code = "service_unavailable"
	CodeFeatureDisabled          Code = "feature_disabled"
	CodeCityUnsupported          Code = "city_unsupported"
	CodeConfigUnavailable        Code = "config_unavailable"
	CodeIllegalTransition        Code = "illegal_transition"
	CodeVersionConflict          Code = "version_conflict"
	CodeIdempotencyKeyReuse      Code = "idempotency_key_reuse"
	CodeQuoteExpired             Code = "quote_expired"
	CodeQuoteSignatureInvalid    Code = "quote_signature_invalid"
	CodePaymentMethodUnavailable Code = "payment_method_unavailable"
	CodeAlreadyAssigned          Code = "already_assigned"
	CodeOfferExpired             Code = "offer_expired"
	CodeDriverIneligible         Code = "driver_ineligible"
	CodeNotAtPickup              Code = "not_at_pickup"
	CodeWrongPin                 Code = "wrong_pin"
	CodePinAttemptsExhausted     Code = "pin_attempts_exhausted"
	CodePinNotVerified           Code = "pin_not_verified"
	CodeReasonCodeRequired       Code = "reason_code_required"
	CodeNoActiveRide             Code = "no_active_ride"
)

var statusByCode = map[Code]int{
	CodeUnauthorized:             http.StatusUnauthorized,
	CodeForbidden:                http.StatusForbidden,
	CodeNotFound:                 http.StatusNotFound,
	CodeValidationFailed:         http.StatusUnprocessableEntity,
	CodeRateLimited:              http.StatusTooManyRequests,
	CodeConflict:                 http.StatusConflict,
	CodeInternalError:            http.StatusInternalServerError,
	CodeServiceUnavailable:       http.StatusServiceUnavailable,
	CodeFeatureDisabled:          http.StatusNotFound,
	CodeCityUnsupported:          http.StatusNotFound,
	CodeConfigUnavailable:        http.StatusServiceUnavailable,
	CodeIllegalTransition:        http.StatusConflict,
	CodeVersionConflict:          http.StatusConflict,
	CodeIdempotencyKeyReuse:      http.StatusConflict,
	CodeQuoteExpired:             http.StatusConflict,
	CodeQuoteSignatureInvalid:    http.StatusUnprocessableEntity,
	CodePaymentMethodUnavailable: http.StatusUnprocessableEntity,
	CodeAlreadyAssigned:          http.StatusConflict,
	CodeOfferExpired:             http.StatusConflict,
	CodeDriverIneligible:         http.StatusForbidden,
	CodeNotAtPickup:              http.StatusUnprocessableEntity,
	CodeWrongPin:                 http.StatusUnprocessableEntity,
	CodePinAttemptsExhausted:     http.StatusTooManyRequests,
	CodePinNotVerified:           http.StatusConflict,
	CodeReasonCodeRequired:       http.StatusUnprocessableEntity,
	CodeNoActiveRide:             http.StatusNotFound,
}

// StatusFor returns the HTTP status every UBI service uses for a code.
func StatusFor(code Code) int {
	if status, ok := statusByCode[code]; ok {
		return status
	}
	return http.StatusInternalServerError
}

// Error carries a canonical code, a human message and structured details.
// Handlers render it; nothing else builds an error body by hand.
type Error struct {
	Code    Code           `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
	cause   error
}

// Errorf builds an Error with a formatted message.
func Errorf(code Code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// WithDetails attaches structured details. Details are rendered to clients, so
// they carry ids, counts and state names only — never PII (CLAUDE.md #7).
func (e *Error) WithDetails(details map[string]any) *Error {
	e.Details = details
	return e
}

// Wrap records the underlying cause for the logs without exposing it.
func (e *Error) Wrap(cause error) *Error {
	e.cause = cause
	return e
}

func (e *Error) Error() string {
	if e.cause != nil {
		return string(e.Code) + ": " + e.Message + ": " + e.cause.Error()
	}
	return string(e.Code) + ": " + e.Message
}

// Unwrap exposes the cause to errors.Is/As.
func (e *Error) Unwrap() error { return e.cause }

// Status is the HTTP status for this error.
func (e *Error) Status() int { return StatusFor(e.Code) }

// AsError extracts an *Error from an error chain, or reports false.
func AsError(err error) (*Error, bool) {
	var target *Error
	if errors.As(err, &target) {
		return target, true
	}
	return nil, false
}

// ErrNotFound is the sentinel a data-access layer returns when a row the caller
// named does not exist. It is deliberately not an *Error: whether a missing row
// is a 404 or something else is the caller's judgement.
var ErrNotFound = errors.New("not found")
