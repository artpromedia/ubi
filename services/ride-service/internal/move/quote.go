package move

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// QuoteSigner signs and verifies quotes with a server-held secret.
//
// The signature covers the quote id, the fare, the currency, the expiry and
// the config version the fare was computed from. A client that edits any of
// them — including pushing the expiry out — produces a signature this service
// will not accept, which is what makes the quote server-authoritative on the
// wire as well as in the database.
type QuoteSigner struct {
	secret []byte
}

// NewQuoteSigner refuses a secret too short to be worth signing with.
func NewQuoteSigner(secret string) (*QuoteSigner, error) {
	if len(secret) < 32 {
		return nil, fmt.Errorf("quote signing secret must be at least 32 bytes; got %d", len(secret))
	}
	return &QuoteSigner{secret: []byte(secret)}, nil
}

// signingPayload is the canonical string the HMAC covers. The field order is
// fixed and every field is separated, so two different quotes cannot produce
// the same payload by shifting digits across a boundary.
func signingPayload(quoteID uuid.UUID, fareMinor int64, currency string, expiresAt time.Time, configVersion int) string {
	return strings.Join([]string{
		"ubi.quote.v1",
		quoteID.String(),
		strconv.FormatInt(fareMinor, 10),
		currency,
		strconv.FormatInt(expiresAt.UTC().Unix(), 10),
		strconv.Itoa(configVersion),
	}, "|")
}

// Sign returns the base64url signature for a quote.
func (s *QuoteSigner) Sign(quoteID uuid.UUID, fareMinor int64, currency string, expiresAt time.Time, configVersion int) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(signingPayload(quoteID, fareMinor, currency, expiresAt, configVersion)))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// Verify checks a signature in constant time.
func (s *QuoteSigner) Verify(signature string, quoteID uuid.UUID, fareMinor int64, currency string, expiresAt time.Time, configVersion int) bool {
	expected := s.Sign(quoteID, fareMinor, currency, expiresAt, configVersion)
	return hmac.Equal([]byte(expected), []byte(signature))
}
