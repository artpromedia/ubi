package custody

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// DefaultReturnConsentWindow is how long a return proposal waits for the
// sender before the safe default (held_at_point) applies. Exported so
// handlers and tests share one number.
const DefaultReturnConsentWindow = 24 * time.Hour

// Proof content-type allowlist and size cap. No S3/MinIO client is wired into
// delivery-service today (see the C07 report / docs/marketplace/
// DELIVERY_CUSTODY.md "object storage"), so these validate the METADATA a
// client claims about a binary this service never receives or serves.
var allowedProofContentTypes = map[string]struct{}{
	"image/jpeg": {},
	"image/png":  {},
	"image/webp": {},
}

// MaxProofSizeBytes bounds the claimed object size. 15 MiB comfortably covers
// a phone-camera photo; nothing this service accepts should be larger.
const MaxProofSizeBytes int64 = 15 * 1024 * 1024

var sha256Pattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// objectKeyPattern is deliberately conservative: no path traversal, no
// leading slash, no whitespace, no characters that would need escaping in a
// URL path segment.
var objectKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9/_.-]{3,255}$`)

// ProofType values (delivery_proofs.type).
const (
	ProofPickup   = "pickup"
	ProofDelivery = "delivery"
)

// ProofInput is the client-supplied proof reference this service validates
// and stores — never the bytes. See ValidateProof.
type ProofInput struct {
	ObjectKey   string
	ContentType string
	SizeBytes   int64
	SHA256      string
}

// ValidateProof returns every field problem in a proof reference, or nil when
// it is acceptable. Pure — no I/O, no clock, unit-tested without a database.
func ValidateProof(in ProofInput) []string {
	var problems []string

	if strings.Contains(in.ObjectKey, "..") || strings.HasPrefix(in.ObjectKey, "/") || !objectKeyPattern.MatchString(in.ObjectKey) {
		problems = append(problems, "objectKey must be a safe storage key: no leading slash, no \"..\", 4-256 characters")
	}
	if _, ok := allowedProofContentTypes[in.ContentType]; !ok {
		problems = append(problems, "contentType must be one of image/jpeg, image/png, image/webp")
	}
	if in.SizeBytes <= 0 || in.SizeBytes > MaxProofSizeBytes {
		problems = append(problems, fmt.Sprintf("sizeBytes must be between 1 and %d", MaxProofSizeBytes))
	}
	if !sha256Pattern.MatchString(strings.ToLower(in.SHA256)) {
		problems = append(problems, "sha256 must be a 64-character lowercase hex digest")
	}
	return problems
}

// Return charge status values (delivery_returns.charge_status).
const (
	// ChargeNotRequired: a fee-free return, or one resolved to a hold point.
	// This is the only charge status a return may complete under.
	ChargeNotRequired = "not_required"
	// ChargeUnsupported: a fee was proposed, but delivery-service has no
	// authorized funding path to collect it (see ResolveChargeStatus). The
	// return is recorded honestly and blocked from completing the charged
	// leg until payment-service grows a dedicated endpoint.
	ChargeUnsupported = "unsupported"
)

// ResolveChargeStatus decides whether a proposed return fee can ever be
// authorized today.
//
// delivery-service owns no money. The only funding primitive it could call is
// payment-service's /v1/wallet/mp/funding/authorize — and that endpoint is
// keyed one-reservation-per-AWARD (unique on awardId): calling it again for a
// return would either collide with the delivery's existing reservation (the
// exact "reuse the ride/delivery commission" shortcut this must never take)
// or require inventing a second award payment-service was never told exists.
// Neither is a real authorization. So: a fee-free return (feeMinor == 0) can
// always complete; a fee-bearing return is recorded — the intended charge is
// not discarded — but gated UNSUPPORTED until payment-service ships a
// dedicated, sender-authorized delivery-return funding endpoint this service
// can call the same way the marketplace calls funding/authorize today.
func ResolveChargeStatus(feeMinor int64) string {
	if feeMinor > 0 {
		return ChargeUnsupported
	}
	return ChargeNotRequired
}

// CanCompleteReturn reports whether a return in this charge status may reach
// return_consented/returning/return_to_sender. Sender consent is necessary
// but never sufficient for a charged return: consenting to an unsupported
// charge still cannot complete the charged leg, only a fee-free resolution
// (or diverting to held_at_point) can.
func CanCompleteReturn(chargeStatus string) bool {
	return chargeStatus != ChargeUnsupported
}

// Consent states (delivery_returns.consent_state).
const (
	ConsentPending   = "pending"
	ConsentConsented = "consented"
	ConsentRejected  = "rejected"
	ConsentExpired   = "expired"
)

// ConsentExpiresAt is the deadline a fresh return proposal gets.
func ConsentExpiresAt(proposedAt time.Time) time.Time {
	return proposedAt.Add(DefaultReturnConsentWindow)
}

// ConsentWindowExpired reports whether `now` is past `expiresAt` — the
// trigger for the safe default (held_at_point), never an auto-charge.
func ConsentWindowExpired(now, expiresAt time.Time) bool {
	return now.After(expiresAt)
}

// Actor roles recorded on custody_events.actor_type.
const (
	ActorSender    = "sender"
	ActorDriver    = "driver"
	ActorRecipient = "recipient"
	ActorSystem    = "system"
	ActorOps       = "ops"
)
