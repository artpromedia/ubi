package marketplace

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
)

// The TRIP-LINK SEALED DELIVERY CONTRACT's fixed interop vector
// (TRIP_ACCESS_SEALED_TEST_VECTOR in packages/contracts/src/
// marketplace-guest.ts). notification-service pins the same bytes on the
// opening side.
const (
	vectorKeyBase64   = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
	vectorIVBase64URL = "oKGio6Slpqeoqaqr"
	vectorAAD         = "ubi.trip_access.v1|tac_0123456789abcdef"
	vectorPlaintext   = `{"phone":"+2348000000000","token":"tat_test_TOKEN_value_0001","firstName":"Ada"}`
	vectorCT          = "nToMRSqlZ51YR6zhNE747kCcaSCih3JcviIE8hDAEG_wTGWLzlYMSTrvcJddNci8CUQwKQ6lfyFxbjtvhlyn1t3O9ht-xImF1tjdWeuv7sc"
	vectorTag         = "F8NgMLVA0GJzT4obDPRkEA"
)

func vectorSealer(t *testing.T) *TripAccessSealer {
	t.Helper()
	sealer, err := NewTripAccessSealer(vectorKeyBase64, "vector")
	if err != nil {
		t.Fatalf("the vector key is usable: %v", err)
	}
	return sealer
}

// openVector is an independent opener (crypto/aes + GCM), not the sealer.
func openVector(t *testing.T, iv, ct, tag []byte, aad string) ([]byte, error) {
	t.Helper()
	key, err := base64.StdEncoding.DecodeString(vectorKeyBase64)
	if err != nil {
		t.Fatal(err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	return gcm.Open(nil, iv, append(append([]byte{}, ct...), tag...), []byte(aad))
}

func mustB64URL(t *testing.T, value string) []byte {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		t.Fatalf("%q is not base64url without padding: %v", value, err)
	}
	return raw
}

// TestTripAccessSealReproducesTheInteropVector: the producer's sealing core,
// given the vector's key and IV, reproduces its ciphertext and tag EXACTLY,
// and the compact plaintext the producer marshals is byte-for-byte the
// vector's.
func TestTripAccessSealReproducesTheInteropVector(t *testing.T) {
	sealer := vectorSealer(t)
	encoded, err := json.Marshal(tripAccessPlaintext{Phone: "+2348000000000", Token: "tat_test_TOKEN_value_0001", FirstName: "Ada"})
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) != vectorPlaintext {
		t.Fatalf("the producer's plaintext is the contract's compact JSON:\n got %s\nwant %s", encoded, vectorPlaintext)
	}
	sealed := sealTripAccessWithIV(sealer.aead, "vector", mustB64URL(t, vectorIVBase64URL), []byte(vectorAAD), encoded)
	if sealed.CT != vectorCT || sealed.Tag != vectorTag || sealed.IV != vectorIVBase64URL {
		t.Fatalf("the vector is reproduced exactly:\n ct  %s\n tag %s\n iv  %s", sealed.CT, sealed.Tag, sealed.IV)
	}
	if sealed.V != 1 || sealed.Alg != "A256GCM" || sealed.Kid != "vector" {
		t.Fatalf("the envelope names version 1, A256GCM and its key id: %+v", sealed)
	}
	plain, err := openVector(t, mustB64URL(t, sealed.IV), mustB64URL(t, sealed.CT), mustB64URL(t, sealed.Tag), vectorAAD)
	if err != nil || string(plain) != vectorPlaintext {
		t.Fatalf("an independent opener opens it: %v %s", err, plain)
	}
}

// TestTripAccessSealTamperFails: a one-bit change to the ciphertext, the tag
// or the AAD (another token's event) never opens.
func TestTripAccessSealTamperFails(t *testing.T) {
	iv, ct, tag := mustB64URL(t, vectorIVBase64URL), mustB64URL(t, vectorCT), mustB64URL(t, vectorTag)
	if plain, err := openVector(t, iv, ct, tag, vectorAAD); err != nil || string(plain) != vectorPlaintext {
		t.Fatalf("the untouched vector opens: %v", err)
	}
	flip := func(in []byte, bit int) []byte {
		out := append([]byte{}, in...)
		out[bit/8] ^= 1 << (bit % 8)
		return out
	}
	if _, err := openVector(t, iv, flip(ct, 0), tag, vectorAAD); err == nil {
		t.Fatal("a flipped ciphertext bit must not open")
	}
	if _, err := openVector(t, iv, flip(ct, len(ct)*8-1), tag, vectorAAD); err == nil {
		t.Fatal("a flipped last ciphertext bit must not open")
	}
	if _, err := openVector(t, iv, ct, flip(tag, 5), vectorAAD); err == nil {
		t.Fatal("a flipped tag bit must not open")
	}
	aad := []byte(vectorAAD)
	aad[len(aad)-1] ^= 1
	if _, err := openVector(t, iv, ct, tag, string(aad)); err == nil {
		t.Fatal("a one-bit AAD change (another token) must not open")
	}
	if _, err := openVector(t, iv, ct, tag, "ubi.trip_access.v1|tac_other"); err == nil {
		t.Fatal("another token's AAD must not open")
	}
}

// TestTripAccessSealUsesAFreshIVEachTime: production sealing draws 12 fresh
// random bytes per message; two seals of the same delivery never share an IV
// and each opens only under its own token's AAD.
func TestTripAccessSealUsesAFreshIVEachTime(t *testing.T) {
	sealer := vectorSealer(t)
	delivery := tripAccessPlaintext{Phone: "+2348000000000", Token: "uta_x", FirstName: "Ada"}
	first, err := sealer.seal("tok-1", delivery)
	if err != nil {
		t.Fatal(err)
	}
	second, err := sealer.seal("tok-1", delivery)
	if err != nil {
		t.Fatal(err)
	}
	if first.IV == second.IV || first.CT == second.CT {
		t.Fatal("every message gets a fresh IV")
	}
	if len(mustB64URL(t, first.IV)) != 12 || len(mustB64URL(t, first.Tag)) != 16 {
		t.Fatal("a 12-byte IV and a 16-byte tag")
	}
	if _, err := openVector(t, mustB64URL(t, first.IV), mustB64URL(t, first.CT), mustB64URL(t, first.Tag), "ubi.trip_access.v1|tok-1"); err != nil {
		t.Fatalf("it opens under its token's AAD: %v", err)
	}
	if _, err := openVector(t, mustB64URL(t, first.IV), mustB64URL(t, first.CT), mustB64URL(t, first.Tag), "ubi.trip_access.v1|tok-2"); err == nil {
		t.Fatal("it never opens under another token's AAD")
	}
	failing := &TripAccessSealer{kid: sealer.kid, aead: sealer.aead, random: bytes.NewReader(nil)}
	if _, err := failing.seal("tok-1", delivery); err == nil {
		t.Fatal("no randomness means no seal — never a fixed IV")
	}
}

// TestTripAccessKeyIsUsedExactlyAsConfigured: anything but standard base64
// of exactly 32 bytes with a clean key id is unusable (fail closed).
func TestTripAccessKeyIsUsedExactlyAsConfigured(t *testing.T) {
	short := base64.StdEncoding.EncodeToString(make([]byte, 16))
	urlSafe := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0xfb}, 32))
	for name, c := range map[string][2]string{
		"no key":        {"", "k1"},
		"no kid":        {vectorKeyBase64, ""},
		"16-byte key":   {short, "k1"},
		"not base64":    {"not-a-key!!", "k1"},
		"base64url key": {urlSafe, "k1"},
		"bad kid":       {vectorKeyBase64, "k 1/../x"},
	} {
		if _, err := NewTripAccessSealer(c[0], c[1]); !errors.Is(err, ErrTripAccessKeyUnusable) {
			t.Errorf("%s: want ErrTripAccessKeyUnusable, got %v", name, err)
		}
	}
	if _, err := NewTripAccessSealer(vectorKeyBase64, "2026-09.a"); err != nil {
		t.Fatalf("a standard base64 32-byte key with a clean kid is usable: %v", err)
	}
}

// TestBusinessReleaseReasonIsASnakeCaseCode: internal reasons become the
// release contract's ^[a-z0-9_]+$ code of at most 64 characters.
func TestBusinessReleaseReasonIsASnakeCaseCode(t *testing.T) {
	cases := map[string]string{
		"funding_refused: forbidden":           "funding_refused_forbidden",
		"business_refused:budget_insufficient": "business_refused_budget_insufficient",
		"Driver Cancelled":                     "driver_cancelled",
		"":                                     "cancelled",
		"---":                                  "cancelled",
	}
	for in, want := range cases {
		if got := businessReleaseReason(in); got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
	long := businessReleaseReason(string(bytes.Repeat([]byte("ab_"), 40)))
	if len(long) > 64 || long[len(long)-1] == '_' {
		t.Fatalf("bounded and trimmed: %q", long)
	}
}
