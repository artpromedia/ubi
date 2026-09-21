package custody_test

import (
	"strings"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/custody"
)

func validProof() custody.ProofInput {
	return custody.ProofInput{
		ObjectKey:   "deliveries/del_123/pickup/abc123.jpg",
		ContentType: "image/jpeg",
		SizeBytes:   1024 * 200,
		SHA256:      strings.Repeat("a", 64),
	}
}

func TestValidateProofAcceptsAGoodReference(t *testing.T) {
	if problems := custody.ValidateProof(validProof()); len(problems) != 0 {
		t.Fatalf("expected no problems, got %v", problems)
	}
}

func TestValidateProofRejectsPathTraversal(t *testing.T) {
	in := validProof()
	in.ObjectKey = "../../etc/passwd"
	problems := custody.ValidateProof(in)
	if len(problems) == 0 {
		t.Fatal("expected a problem for a path-traversal object key")
	}
}

func TestValidateProofRejectsLeadingSlash(t *testing.T) {
	in := validProof()
	in.ObjectKey = "/etc/passwd"
	if problems := custody.ValidateProof(in); len(problems) == 0 {
		t.Fatal("expected a problem for a leading-slash object key")
	}
}

func TestValidateProofRejectsBadContentType(t *testing.T) {
	in := validProof()
	in.ContentType = "application/x-msdownload"
	if problems := custody.ValidateProof(in); len(problems) == 0 {
		t.Fatal("expected a problem for a disallowed content type")
	}
}

func TestValidateProofRejectsOversizeAndZeroSize(t *testing.T) {
	for _, size := range []int64{0, -1, custody.MaxProofSizeBytes + 1} {
		in := validProof()
		in.SizeBytes = size
		if problems := custody.ValidateProof(in); len(problems) == 0 {
			t.Fatalf("size %d: expected a problem", size)
		}
	}
}

func TestValidateProofRejectsMalformedChecksum(t *testing.T) {
	cases := []string{"", "not-hex", strings.Repeat("a", 63), strings.Repeat("g", 64)}
	for _, sha := range cases {
		in := validProof()
		in.SHA256 = sha
		if problems := custody.ValidateProof(in); len(problems) == 0 {
			t.Fatalf("sha256 %q: expected a problem", sha)
		}
	}
}

// Uppercase hex is well-formed, not malformed — ValidateProof is
// case-insensitive on purpose, because storage normalizes to lowercase before
// the (deliveryId, type, sha256) uniqueness check runs (see handlers/custody.go),
// so two idempotent retries that differ only in casing still collide on the
// SAME row instead of silently creating a duplicate proof.
func TestValidateProofAcceptsUppercaseHex(t *testing.T) {
	in := validProof()
	in.SHA256 = strings.ToUpper(in.SHA256)
	if problems := custody.ValidateProof(in); len(problems) != 0 {
		t.Fatalf("expected uppercase hex to be well-formed, got %v", problems)
	}
}

func TestResolveChargeStatusNeverAuthorizesAFee(t *testing.T) {
	if got := custody.ResolveChargeStatus(0); got != custody.ChargeNotRequired {
		t.Fatalf("fee-free return: got %q, want %q", got, custody.ChargeNotRequired)
	}
	if got := custody.ResolveChargeStatus(50000); got != custody.ChargeUnsupported {
		t.Fatalf("fee-bearing return: got %q, want %q (no funding endpoint exists — this must never silently succeed)", got, custody.ChargeUnsupported)
	}
}

func TestCanCompleteReturnGatesOnlyTheChargedLeg(t *testing.T) {
	if !custody.CanCompleteReturn(custody.ChargeNotRequired) {
		t.Fatal("a fee-free/hold-point return must be able to complete")
	}
	if custody.CanCompleteReturn(custody.ChargeUnsupported) {
		t.Fatal("a return with an unsupported charge must never be reported completable — that would be an unauthorized charge or a silent write-off")
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
