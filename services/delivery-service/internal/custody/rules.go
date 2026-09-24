package custody

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// DefaultReturnConsentWindow is how long a return proposal waits for the
// sender before the safe default (held_at_point) applies. Exported so
// handlers and tests share one number.
const DefaultReturnConsentWindow = 24 * time.Hour

// Proof content-type allowlist and size cap (P17). Since proofs became
// verified objects these bound the REAL bytes, not a client's claim: the
// declared type/size are checked when an upload is issued, and the stored
// object is re-measured, re-hashed and sniffed before it can be attached
// (handlers.verifyProofObject).
var allowedProofContentTypes = map[string]struct{}{
	"image/jpeg": {},
	"image/png":  {},
	"image/webp": {},
}

// MaxProofSizeBytes bounds a proof object. 15 MiB comfortably covers a
// phone-camera photo; nothing this service accepts should be larger.
const MaxProofSizeBytes int64 = 15 * 1024 * 1024

var sha256Pattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// ProofType values (delivery_proofs.type, delivery_proof_uploads.type).
const (
	ProofPickup   = "pickup"
	ProofDelivery = "delivery"
	// ProofReturn is the hand-back to the sender that completes a charged
	// return (returning -> return_to_sender) and triggers the fee capture.
	ProofReturn = "return"
)

// IsProofType reports whether t is one of the three proof types.
func IsProofType(t string) bool {
	return t == ProofPickup || t == ProofDelivery || t == ProofReturn
}

// IsAllowedProofContentType reports whether ct is an accepted image type.
func IsAllowedProofContentType(ct string) bool {
	_, ok := allowedProofContentTypes[ct]
	return ok
}

// ProofUploadInput is what a driver declares when asking for an upload slot.
type ProofUploadInput struct {
	Type        string
	ContentType string
	SizeBytes   int64
	SHA256      string
}

// ValidateProofUpload returns every problem with a declared upload, or nil.
// The SHA-256 is compared case-insensitively here and stored lowercase, so a
// retry that differs only in casing is still the same proof. Pure.
func ValidateProofUpload(in ProofUploadInput) []string {
	var problems []string
	if !IsProofType(in.Type) {
		problems = append(problems, "type must be one of pickup, delivery, return")
	}
	if !IsAllowedProofContentType(in.ContentType) {
		problems = append(problems, "contentType must be one of image/jpeg, image/png, image/webp")
	}
	if in.SizeBytes <= 0 || in.SizeBytes > MaxProofSizeBytes {
		problems = append(problems, fmt.Sprintf("sizeBytes must be between 1 and %d", MaxProofSizeBytes))
	}
	if !sha256Pattern.MatchString(strings.ToLower(in.SHA256)) {
		problems = append(problems, "sha256 must be a 64-character hex digest")
	}
	return problems
}

// ProofObjectKey is the ONE place a proof object key is made: the server
// generates it, namespaced to the delivery, the proof type and the actor the
// upload was issued to. A client never chooses (or learns in advance) a key.
func ProofObjectKey(deliveryID, proofType, actorID, uploadID string) string {
	return "proofs/" + deliveryID + "/" + proofType + "/" + actorID + "/" + uploadID
}

// ProofObjectKeyPrefix is the namespace an actor's uploads for one delivery
// and proof type live under. Attach re-checks the stored key against it.
func ProofObjectKeyPrefix(deliveryID, proofType, actorID string) string {
	return "proofs/" + deliveryID + "/" + proofType + "/" + actorID + "/"
}

// SniffProofContentType classifies an object by its leading bytes, returning
// one of the allowed image types or "" — so a file that merely CLAIMS to be
// a JPEG is not accepted as one. Pure.
func SniffProofContentType(head []byte) string {
	detected := http.DetectContentType(head)
	if IsAllowedProofContentType(detected) {
		return detected
	}
	return ""
}

// Return charge status values (delivery_returns.charge_status). See the
// DeliveryReturn model in packages/database/prisma/schema.prisma for the
// full ladder; the money itself moves only in payment-service.
const (
	// ChargeNotRequired: a fee-free return, or one resolved to a hold point.
	ChargeNotRequired = "not_required"
	// ChargeUnsupported: a legacy (pre-P17) fee-bearing proposal recorded when
	// no funding path existed. It can never complete the charged leg.
	ChargeUnsupported = "unsupported"
	// ChargeAuthorizationRequired: a fee-bearing proposal made while charged
	// returns are enabled; the sender's approval reserves the fee.
	ChargeAuthorizationRequired = "authorization_required"
	// ChargeReserving: the reserve call was sent and its outcome is not yet
	// recorded. A write-ahead marker: resolving the return any other way
	// releases the (possible) reservation first.
	ChargeReserving = "reserving"
	// ChargeReserved: the fee is held on the sender's wallet.
	ChargeReserved = "reserved"
	// ChargeCapturePending: the driver proved the return; the capture is owed
	// and retried until payment-service confirms it.
	ChargeCapturePending = "capture_pending"
	// ChargeCaptured: taken, exactly once.
	ChargeCaptured = "captured"
	// ChargeReleased: the hold was released (charge cancelled, or the
	// approval never committed).
	ChargeReleased = "released"
)

// ResolveChargeStatus decides how a proposed return fee is recorded.
//
// A fee-free return is always offered (not_required). A fee-bearing one is
// offered only while charged returns are enabled (authorization_required —
// nothing is held until the sender approves); with the switch off it is NOT
// offered at all (offered=false), and the caller refuses the proposal
// explicitly rather than recording a charge nobody can collect. Pure.
func ResolveChargeStatus(feeMinor int64, chargedReturnsEnabled bool) (status string, offered bool) {
	if feeMinor <= 0 {
		return ChargeNotRequired, true
	}
	if !chargedReturnsEnabled {
		return "", false
	}
	return ChargeAuthorizationRequired, true
}

// ValidateReturnFee checks a proposed fee against the server-set bounds: an
// integer minor amount above zero, in the delivery's own currency, and never
// more than the delivery's agreed fare — the return leg retraces the same
// route, so the award's price is its ceiling. Pure.
func ValidateReturnFee(feeMinor int64, currency, deliveryCurrency string, agreedFareMinor int64) []string {
	var problems []string
	if feeMinor <= 0 {
		problems = append(problems, "feeMinor must be a positive integer minor amount")
	}
	if currency != deliveryCurrency {
		problems = append(problems, "currency must be the delivery's currency ("+deliveryCurrency+")")
	}
	if agreedFareMinor <= 0 {
		problems = append(problems, "this delivery has no agreed fare to bound a return fee")
	} else if feeMinor > agreedFareMinor {
		problems = append(problems, fmt.Sprintf("feeMinor must not exceed the delivery's agreed fare (%d)", agreedFareMinor))
	}
	return problems
}

// NeedsReservation reports a fee-bearing return whose fee must be reserved
// (or whose reservation outcome must be confirmed) before it can complete.
func NeedsReservation(chargeStatus string) bool {
	return chargeStatus == ChargeAuthorizationRequired || chargeStatus == ChargeReserving
}

// MayHoldReservation reports a return that has — or may have — a fee held
// on the sender's wallet. Any path that resolves such a return without
// completing it must release first.
func MayHoldReservation(chargeStatus string) bool {
	return chargeStatus == ChargeReserving || chargeStatus == ChargeReserved
}

// CanCompleteReturn reports whether a return in this charge status may reach
// return_consented/returning without a (further) reservation. Sender consent
// is necessary but never sufficient for a charged return.
func CanCompleteReturn(chargeStatus string) bool {
	return chargeStatus == ChargeNotRequired
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
