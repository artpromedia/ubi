package custody_test

import (
	"strings"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/custody"
)

func validUpload() custody.ProofUploadInput {
	return custody.ProofUploadInput{
		Type:        custody.ProofPickup,
		ContentType: "image/jpeg",
		SizeBytes:   1024 * 200,
		SHA256:      strings.Repeat("a", 64),
	}
}

func TestValidateProofUploadAcceptsAGoodDeclaration(t *testing.T) {
	for _, proofType := range []string{custody.ProofPickup, custody.ProofDelivery, custody.ProofReturn} {
		in := validUpload()
		in.Type = proofType
		if problems := custody.ValidateProofUpload(in); len(problems) != 0 {
			t.Fatalf("%s: expected no problems, got %v", proofType, problems)
		}
	}
}

func TestValidateProofUploadRejectsUnknownType(t *testing.T) {
	in := validUpload()
	in.Type = "selfie"
	if problems := custody.ValidateProofUpload(in); len(problems) == 0 {
		t.Fatal("expected a problem for an unknown proof type")
	}
}

func TestValidateProofUploadRejectsBadContentType(t *testing.T) {
	for _, contentType := range []string{"application/x-msdownload", "image/svg+xml", "text/html", ""} {
		in := validUpload()
		in.ContentType = contentType
		if problems := custody.ValidateProofUpload(in); len(problems) == 0 {
			t.Fatalf("%q: expected a problem for a disallowed content type", contentType)
		}
	}
}

func TestValidateProofUploadRejectsOversizeAndZeroSize(t *testing.T) {
	for _, size := range []int64{0, -1, custody.MaxProofSizeBytes + 1} {
		in := validUpload()
		in.SizeBytes = size
		if problems := custody.ValidateProofUpload(in); len(problems) == 0 {
			t.Fatalf("size %d: expected a problem", size)
		}
	}
}

func TestValidateProofUploadRejectsMalformedChecksum(t *testing.T) {
	for _, sha := range []string{"", "not-hex", strings.Repeat("a", 63), strings.Repeat("g", 64)} {
		in := validUpload()
		in.SHA256 = sha
		if problems := custody.ValidateProofUpload(in); len(problems) == 0 {
			t.Fatalf("sha256 %q: expected a problem", sha)
		}
	}
}

// Uppercase hex is well-formed, not malformed: storage normalizes to
// lowercase before the (deliveryId, type, sha256) uniqueness check runs, so
// two idempotent retries that differ only in casing collide on the SAME row.
func TestValidateProofUploadAcceptsUppercaseHex(t *testing.T) {
	in := validUpload()
	in.SHA256 = strings.ToUpper(in.SHA256)
	if problems := custody.ValidateProofUpload(in); len(problems) != 0 {
		t.Fatalf("expected uppercase hex to be well-formed, got %v", problems)
	}
}

// The server makes every key, namespaced to the delivery, proof type and the
// actor the upload was issued to — nothing a client supplies.
func TestProofObjectKeyIsNamespacedToDeliveryTypeAndActor(t *testing.T) {
	key := custody.ProofObjectKey("d1", custody.ProofDelivery, "a1", "u1")
	if key != "proofs/d1/delivery/a1/u1" {
		t.Fatalf("key = %q", key)
	}
	if !strings.HasPrefix(key, custody.ProofObjectKeyPrefix("d1", custody.ProofDelivery, "a1")) {
		t.Fatal("the key must live under its delivery/type/actor prefix")
	}
	if strings.HasPrefix(key, custody.ProofObjectKeyPrefix("d1", custody.ProofDelivery, "a2")) {
		t.Fatal("another actor's prefix must not match")
	}
}

func TestSniffProofContentTypeClassifiesBytesNotClaims(t *testing.T) {
	jpeg := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 'J', 'F', 'I', 'F', 0}
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
	webp := append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), make([]byte, 8)...)
	cases := []struct {
		name string
		head []byte
		want string
	}{
		{"jpeg", jpeg, "image/jpeg"},
		{"png", png, "image/png"},
		{"webp", webp, "image/webp"},
		{"html pretending to be an image", []byte("<html><script>alert(1)</script>"), ""},
		{"a zip archive", []byte("PK\x03\x04 some archive"), ""},
		{"empty", nil, ""},
	}
	for _, testCase := range cases {
		if got := custody.SniffProofContentType(testCase.head); got != testCase.want {
			t.Fatalf("%s: sniffed %q, want %q", testCase.name, got, testCase.want)
		}
	}
}

func TestResolveChargeStatusIsDenyByDefault(t *testing.T) {
	if status, offered := custody.ResolveChargeStatus(0, false); !offered || status != custody.ChargeNotRequired {
		t.Fatalf("fee-free return with charged returns off: %q offered=%v", status, offered)
	}
	if status, offered := custody.ResolveChargeStatus(0, true); !offered || status != custody.ChargeNotRequired {
		t.Fatalf("fee-free return with charged returns on: %q offered=%v", status, offered)
	}
	// Off: a fee is not offered at all — never recorded as payable.
	if status, offered := custody.ResolveChargeStatus(50000, false); offered || status != "" {
		t.Fatalf("fee-bearing return with charged returns off must not be offered, got %q offered=%v", status, offered)
	}
	// On: recorded as needing the sender's approval; nothing is held yet.
	if status, offered := custody.ResolveChargeStatus(50000, true); !offered || status != custody.ChargeAuthorizationRequired {
		t.Fatalf("fee-bearing return with charged returns on: %q offered=%v", status, offered)
	}
}

func TestValidateReturnFeeEnforcesServerBounds(t *testing.T) {
	if problems := custody.ValidateReturnFee(40000, "NGN", "NGN", 100000); len(problems) != 0 {
		t.Fatalf("a fee within the agreed fare: %v", problems)
	}
	if problems := custody.ValidateReturnFee(100000, "NGN", "NGN", 100000); len(problems) != 0 {
		t.Fatalf("a fee equal to the agreed fare: %v", problems)
	}
	for name, problems := range map[string][]string{
		"above the agreed fare": custody.ValidateReturnFee(100001, "NGN", "NGN", 100000),
		"another currency":      custody.ValidateReturnFee(40000, "KES", "NGN", 100000),
		"no agreed fare":        custody.ValidateReturnFee(40000, "NGN", "NGN", 0),
		"zero":                  custody.ValidateReturnFee(0, "NGN", "NGN", 100000),
		"negative":              custody.ValidateReturnFee(-5, "NGN", "NGN", 100000),
	} {
		if len(problems) == 0 {
			t.Fatalf("%s: expected a problem", name)
		}
	}
}

func TestChargeStatusPredicates(t *testing.T) {
	if !custody.CanCompleteReturn(custody.ChargeNotRequired) {
		t.Fatal("a fee-free/hold-point return must be able to complete")
	}
	for _, status := range []string{custody.ChargeUnsupported, custody.ChargeAuthorizationRequired, custody.ChargeReserving} {
		if custody.CanCompleteReturn(status) {
			t.Fatalf("%s must never complete without a reservation — that would be an unauthorized charge or a silent write-off", status)
		}
	}
	if !custody.NeedsReservation(custody.ChargeAuthorizationRequired) || !custody.NeedsReservation(custody.ChargeReserving) {
		t.Fatal("a fee awaiting (or confirming) its reservation needs one")
	}
	if custody.NeedsReservation(custody.ChargeUnsupported) || custody.NeedsReservation(custody.ChargeNotRequired) {
		t.Fatal("legacy unsupported and fee-free returns never reserve")
	}
	for _, status := range []string{custody.ChargeReserving, custody.ChargeReserved} {
		if !custody.MayHoldReservation(status) {
			t.Fatalf("%s may hold money and must be released before any other resolution", status)
		}
	}
	for _, status := range []string{custody.ChargeNotRequired, custody.ChargeAuthorizationRequired, custody.ChargeCaptured, custody.ChargeReleased, custody.ChargeCapturePending} {
		if custody.MayHoldReservation(status) {
			t.Fatalf("%s holds nothing releasable", status)
		}
	}
}

func TestConsentWindowExpiry(t *testing.T) {
	proposedAt := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)
	expiresAt := custody.ConsentExpiresAt(proposedAt)
	if expiresAt.Sub(proposedAt) != custody.DefaultReturnConsentWindow {
		t.Fatalf("expiry window = %v, want %v", expiresAt.Sub(proposedAt), custody.DefaultReturnConsentWindow)
	}
	if custody.ConsentWindowExpired(proposedAt.Add(time.Hour), expiresAt) {
		t.Fatal("one hour in must not be expired yet")
	}
	if !custody.ConsentWindowExpired(expiresAt.Add(time.Second), expiresAt) {
		t.Fatal("past the deadline must be expired")
	}
}
