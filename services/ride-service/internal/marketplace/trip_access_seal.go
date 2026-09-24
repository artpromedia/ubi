package marketplace

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// The TRIP-LINK SEALED DELIVERY CONTRACT, producer side (shared with
// notification-service's trip_access consumer; packages/contracts/src/
// marketplace-guest.ts MpTripAccessIssuedPayloadSchema).
//
// The trip_access.issued event rides the shared outbox relay, which
// broadcasts every event to every event:* subscriber and keeps the row in
// public.outbox_events. So its payload carries NOTHING sensitive in clear:
// the passenger's phone, first name and the one-time link token travel only
// inside `sealed`, an AES-256-GCM envelope
//
//	{"v":1,"alg":"A256GCM","kid":…,"iv":…,"ct":…,"tag":…}
//
// with iv/ct/tag base64url without padding, where
//
//   - plaintext = the compact JSON object {"phone","token","firstName"};
//   - AAD       = "ubi.trip_access.v1|" + tokenId (the payload's tokenId,
//     which is also the event's aggregate id), so an envelope cannot be
//     replayed onto another token's event;
//   - key       = TRIP_ACCESS_DELIVERY_KEY (standard base64 of 32 random
//     bytes), named by TRIP_ACCESS_DELIVERY_KID;
//   - iv        = 12 fresh bytes from crypto/rand per message, never reused.
//
// Fail closed: without a usable key the Service has no sealer and refuses to
// issue any trip link (a publish naming a passenger, and a reissue, answer
// service_unavailable with details.reason trip_link_delivery_unavailable);
// booking a ride for yourself is unaffected. No path ever writes the phone,
// the first name or the token to the outbox in clear.

// Sealed-delivery constants (TRIP_ACCESS_SEALED_* in the contract).
const (
	tripAccessSealedVersion = 1
	tripAccessSealedAlg     = "A256GCM"
	tripAccessAADPrefix     = "ubi.trip_access.v1|"
	tripAccessKeyBytes      = 32
	tripAccessIVBytes       = 12
	tripAccessTagBytes      = 16
)

// ReasonTripLinkDeliveryUnavailable is details.reason when no trip link can
// be issued because the sealed-delivery key is not configured.
const ReasonTripLinkDeliveryUnavailable = "trip_link_delivery_unavailable"

// tripAccessKidPattern bounds a key id to something safe to log and compare.
var tripAccessKidPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// TripAccessSealed is the payload's `sealed` object.
type TripAccessSealed struct {
	V   int    `json:"v"`
	Alg string `json:"alg"`
	Kid string `json:"kid"`
	IV  string `json:"iv"`
	CT  string `json:"ct"`
	Tag string `json:"tag"`
}

// tripAccessPlaintext is what `sealed` opens to. Field order is the compact
// form the contract's interop vector uses; consumers parse JSON and do not
// depend on it.
type tripAccessPlaintext struct {
	Phone     string `json:"phone"`
	Token     string `json:"token"`
	FirstName string `json:"firstName"`
}

// TripAccessSealer seals trip_access.issued deliveries under one key.
type TripAccessSealer struct {
	kid    string
	aead   cipher.AEAD
	random io.Reader
}

// ErrTripAccessKeyUnusable marks a TRIP_ACCESS_DELIVERY_KEY/KID pair that
// cannot seal: absent, not standard base64, not exactly 32 bytes, or a key
// id outside [A-Za-z0-9._-]{1,64}.
var ErrTripAccessKeyUnusable = errors.New("the trip access delivery key is unusable")

// NewTripAccessSealer builds the sealer from TRIP_ACCESS_DELIVERY_KEY (standard
// base64 of 32 bytes) and TRIP_ACCESS_DELIVERY_KID. Anything else is
// ErrTripAccessKeyUnusable: a key is used exactly as configured or not at all.
func NewTripAccessSealer(keyBase64, kid string) (*TripAccessSealer, error) {
	keyBase64 = strings.TrimSpace(keyBase64)
	kid = strings.TrimSpace(kid)
	if keyBase64 == "" || kid == "" {
		return nil, fmt.Errorf("%w: TRIP_ACCESS_DELIVERY_KEY and TRIP_ACCESS_DELIVERY_KID are both required", ErrTripAccessKeyUnusable)
	}
	if !tripAccessKidPattern.MatchString(kid) {
		return nil, fmt.Errorf("%w: the key id must match [A-Za-z0-9._-]{1,64}", ErrTripAccessKeyUnusable)
	}
	key, err := base64.StdEncoding.Strict().DecodeString(keyBase64)
	if err != nil {
		return nil, fmt.Errorf("%w: the key is not standard base64", ErrTripAccessKeyUnusable)
	}
	if len(key) != tripAccessKeyBytes {
		return nil, fmt.Errorf("%w: the key is %d bytes, not %d", ErrTripAccessKeyUnusable, len(key), tripAccessKeyBytes)
	}
	aead, err := newTripAccessAEAD(key)
	if err != nil {
		return nil, err
	}
	return &TripAccessSealer{kid: kid, aead: aead, random: rand.Reader}, nil
}

func newTripAccessAEAD(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrTripAccessKeyUnusable, err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrTripAccessKeyUnusable, err)
	}
	return aead, nil
}

// Kid names the sealing key.
func (s *TripAccessSealer) Kid() string { return s.kid }

// tripAccessAAD is the additional authenticated data for one token's event.
func tripAccessAAD(tokenID string) []byte {
	return []byte(tripAccessAADPrefix + tokenID)
}

// seal encrypts one delivery for the token's event with a fresh random IV.
func (s *TripAccessSealer) seal(tokenID string, plaintext tripAccessPlaintext) (*TripAccessSealed, error) {
	encoded, err := json.Marshal(plaintext)
	if err != nil {
		return nil, fmt.Errorf("unserialisable trip access delivery: %w", err)
	}
	iv := make([]byte, tripAccessIVBytes)
	if _, err := io.ReadFull(s.random, iv); err != nil {
		return nil, fmt.Errorf("no randomness for the trip access IV: %w", err)
	}
	return sealTripAccessWithIV(s.aead, s.kid, iv, tripAccessAAD(tokenID), encoded), nil
}

// sealTripAccessWithIV is the deterministic core: AES-256-GCM of plaintext
// under iv and aad, split into ciphertext and the 16-byte tag. Only seal
// (fresh IV) calls it in production; the interop test pins it to the
// contract's fixed vector.
func sealTripAccessWithIV(aead cipher.AEAD, kid string, iv, aad, plaintext []byte) *TripAccessSealed {
	out := aead.Seal(nil, iv, plaintext, aad)
	ct, tag := out[:len(out)-tripAccessTagBytes], out[len(out)-tripAccessTagBytes:]
	return &TripAccessSealed{
		V:   tripAccessSealedVersion,
		Alg: tripAccessSealedAlg,
		Kid: kid,
		IV:  base64.RawURLEncoding.EncodeToString(iv),
		CT:  base64.RawURLEncoding.EncodeToString(ct),
		Tag: base64.RawURLEncoding.EncodeToString(tag),
	}
}

// tripLinkDeliveryUnavailable is the fail-closed refusal when no sealer is
// configured: the guest booking (which needs a link) is refused before
// anything is written, and nothing is ever written in clear.
func tripLinkDeliveryUnavailable() *domain.Error {
	return domain.Errorf(domain.CodeServiceUnavailable,
		"sending the passenger their trip link is unavailable right now; book the ride for yourself or try again later").
		WithDetails(map[string]any{"field": "passenger", "reason": ReasonTripLinkDeliveryUnavailable})
}
