package middleware

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/identity"
)

// The per-client limiter (ratelimit.go) in front of a handler that only
// counts what reaches it. Budgets are small so a test can exhaust one.

const (
	testServiceKey    = "a-strong-internal-service-key-for-tests"
	testContextSecret = "delivery-ratelimit-test-context-secret"
	testLimit         = 5
)

type limitRig struct {
	limiter *RateLimiter
	handler http.Handler
	reached int
}

func newLimitRig(t *testing.T, cfg RateLimitConfig) *limitRig {
	t.Helper()
	if cfg.Limit == 0 {
		cfg.Limit = testLimit
	}
	if cfg.Window == 0 {
		cfg.Window = time.Hour
	}
	rig := &limitRig{limiter: NewRateLimiter(cfg)}
	rig.handler = rig.limiter.ClientAddress(rig.limiter.Limit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		rig.reached++
		w.WriteHeader(http.StatusOK)
	})))
	return rig
}

func (rig *limitRig) send(remoteAddr string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/marketplace-assign", nil)
	req.RemoteAddr = remoteAddr
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	rec := httptest.NewRecorder()
	rig.handler.ServeHTTP(rec, req)
	return rec
}

// burst sends n requests and returns how many were refused with 429.
func (rig *limitRig) burst(n int, remoteAddr string, headers map[string]string) int {
	refused := 0
	for i := 0; i < n; i++ {
		if rig.send(remoteAddr, headers).Code == http.StatusTooManyRequests {
			refused++
		}
	}
	return refused
}

func TestValidServiceKeyIsNeverThrottled(t *testing.T) {
	rig := newLimitRig(t, RateLimitConfig{ServiceKey: testServiceKey})
	// Every ride-service hand-off arrives from the same pod address with no
	// forwarding header: the old LimitByIP put them all in one bucket.
	if refused := rig.burst(testLimit*20, "10.20.0.7:40000", map[string]string{ServiceKeyHeader: testServiceKey}); refused != 0 {
		t.Fatalf("%d service-key calls were throttled; a valid service call is never counted", refused)
	}
	if rig.reached != testLimit*20 {
		t.Fatalf("reached %d, want %d", rig.reached, testLimit*20)
	}
	// ...and they spend nothing from that address's client budget.
	if refused := rig.burst(testLimit, "10.20.0.7:40001", nil); refused != 0 {
		t.Fatalf("service calls consumed the address's client budget: %d refused", refused)
	}
}

func TestForgedOrMissingServiceKeyIsCountedPerClient(t *testing.T) {
	for name, headers := range map[string]map[string]string{
		"a wrong key":            {ServiceKeyHeader: testServiceKey + "x"},
		"a prefix of the key":    {ServiceKeyHeader: testServiceKey[:10]},
		"an empty key":           {ServiceKeyHeader: ""},
		"no key at all":          nil,
		"the committed default ": {ServiceKeyHeader: "internal-key"},
	} {
		t.Run(name, func(t *testing.T) {
			rig := newLimitRig(t, RateLimitConfig{ServiceKey: testServiceKey})
			if refused := rig.burst(testLimit, "198.51.100.4:1000", headers); refused != 0 {
				t.Fatalf("within budget, %d refused", refused)
			}
			rec := rig.send("198.51.100.4:1001", headers)
			if rec.Code != http.StatusTooManyRequests {
				t.Fatalf("over budget: status = %d, want 429", rec.Code)
			}
			var body struct {
				Success bool `json:"success"`
				Error   struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Success || body.Error.Code != "RATE_LIMITED" {
				t.Fatalf("429 body = %s (%v)", rec.Body.String(), err)
			}
			if rec.Header().Get("X-RateLimit-Limit") != strconv.Itoa(testLimit) {
				t.Fatalf("X-RateLimit-Limit = %q", rec.Header().Get("X-RateLimit-Limit"))
			}
		})
	}
}

func TestNoConfiguredServiceKeyExemptsNobody(t *testing.T) {
	// NewRouter passes an empty key when INTERNAL_SERVICE_KEY is unset or the
	// committed default: then nothing a caller presents buys an exemption.
	rig := newLimitRig(t, RateLimitConfig{})
	for _, presented := range []string{"", "internal-key"} {
		rig.burst(testLimit, "198.51.100.9:1", map[string]string{ServiceKeyHeader: presented})
	}
	if refused := rig.burst(1, "198.51.100.9:2", map[string]string{ServiceKeyHeader: "internal-key"}); refused != 1 {
		t.Fatal("with no usable key configured, the committed default must be counted like any client")
	}
}

func signedHeaders(verifier *identity.Verifier, userID uuid.UUID, role string) map[string]string {
	issuedAt := time.Now()
	return map[string]string{
		identity.HeaderUserID:    userID.String(),
		identity.HeaderUserRole:  role,
		identity.HeaderCityID:    "LOS",
		identity.HeaderSignature: verifier.Sign(userID.String(), role, "LOS", issuedAt),
		identity.HeaderIssuedAt:  strconv.FormatInt(issuedAt.Unix(), 10),
	}
}

func TestVerifiedIdentityIsCountedAsItsUser(t *testing.T) {
	verifier := identity.NewVerifierFor(testContextSecret, 0, true)
	rig := newLimitRig(t, RateLimitConfig{Verifier: verifier})
	gateway := "10.30.0.2:5000" // every custody call arrives from the gateway
	alice, bob := uuid.New(), uuid.New()

	if refused := rig.burst(testLimit, gateway, signedHeaders(verifier, alice, identity.RoleRider)); refused != 0 {
		t.Fatalf("alice within budget: %d refused", refused)
	}
	if rig.send(gateway, signedHeaders(verifier, alice, identity.RoleRider)).Code != http.StatusTooManyRequests {
		t.Fatal("alice over budget must be refused")
	}
	// Bob, through the very same gateway address, has his own budget.
	if refused := rig.burst(testLimit, gateway, signedHeaders(verifier, bob, identity.RoleDriver)); refused != 0 {
		t.Fatalf("bob shares alice's bucket: %d refused", refused)
	}

	// A context that does not verify is not an identity: it is counted
	// against the address it came from, never against the user it names.
	forged := signedHeaders(verifier, uuid.New(), identity.RoleRider)
	forged[identity.HeaderSignature] = "not-a-signature"
	if refused := rig.burst(testLimit+1, "203.0.113.50:1", forged); refused != 1 {
		t.Fatalf("an unverified context must share its sender's client bucket; refused %d, want 1", refused)
	}
}

func TestUnsignedIdentityHeadersAreNeverAKey(t *testing.T) {
	// Signatures disabled (development): the plain headers are claims, so
	// rotating the user id buys nothing.
	rig := newLimitRig(t, RateLimitConfig{Verifier: identity.NewVerifier("", 0)})
	refused := 0
	for i := 0; i < testLimit+3; i++ {
		rec := rig.send("198.51.100.20:9", map[string]string{
			identity.HeaderUserID:   uuid.NewString(),
			identity.HeaderUserRole: identity.RoleRider,
		})
		if rec.Code == http.StatusTooManyRequests {
			refused++
		}
	}
	if refused != 3 {
		t.Fatalf("refused %d, want 3: unsigned identities must be counted per client", refused)
	}
}

func TestForwardedHeadersAreIgnoredFromAnUntrustedPeer(t *testing.T) {
	rig := newLimitRig(t, RateLimitConfig{})
	refused := 0
	for i := 0; i < testLimit+2; i++ {
		// A client naming a fresh address per request — the old RealIP
		// believed it and gave each one a fresh bucket.
		rec := rig.send("198.51.100.30:7", map[string]string{
			"X-Forwarded-For": fmt.Sprintf("203.0.113.%d", i+1),
			"X-Real-IP":       fmt.Sprintf("192.0.2.%d", i+1),
			"True-Client-IP":  fmt.Sprintf("192.0.2.%d", i+100),
		})
		if rec.Code == http.StatusTooManyRequests {
			refused++
		}
	}
	if refused != 2 {
		t.Fatalf("refused %d, want 2: forwarding headers from an untrusted peer must not mint buckets", refused)
	}
}

func TestTrustedProxyForwardingIsWalkedFromTheRight(t *testing.T) {
	rig := newLimitRig(t, RateLimitConfig{TrustedProxies: "10.0.0.0/8, 172.16.0.5"})
	proxy := "10.1.2.3:443"

	// Two clients behind the same trusted proxy have separate budgets.
	if refused := rig.burst(testLimit, proxy, map[string]string{"X-Forwarded-For": "203.0.113.7"}); refused != 0 {
		t.Fatalf("client A within budget: %d refused", refused)
	}
	if refused := rig.burst(testLimit, proxy, map[string]string{"X-Forwarded-For": "203.0.113.8"}); refused != 0 {
		t.Fatalf("client B shares A's bucket: %d refused", refused)
	}
	// A client prepending a spoofed entry is still counted as itself: the
	// chain is read from the right, skipping trusted hops.
	spoof := map[string]string{"X-Forwarded-For": "1.2.3.4, 203.0.113.7, 172.16.0.5"}
	if rec := rig.send(proxy, spoof); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("a spoofed leftmost entry escaped client A's bucket: status %d", rec.Code)
	}
	// X-Real-IP only when the chain names no client.
	if refused := rig.burst(testLimit, proxy, map[string]string{"X-Real-IP": "203.0.113.9"}); refused != 0 {
		t.Fatalf("client C via X-Real-IP: %d refused", refused)
	}
	// A malformed entry before any client is reached leaves the proxy as
	// the client — never a free bucket.
	if refused := rig.burst(testLimit+1, proxy, map[string]string{"X-Forwarded-For": "203.0.113.10, not-an-ip"}); refused != 1 {
		t.Fatalf("malformed chain: refused %d, want 1 (counted as the proxy)", refused)
	}
}

func TestIPv6ClientsAreCountedPerSlash64(t *testing.T) {
	rig := newLimitRig(t, RateLimitConfig{})
	refused := 0
	for i := 0; i < testLimit+2; i++ {
		rec := rig.send(fmt.Sprintf("[2001:db8:1:2::%x]:443", i+1), nil)
		if rec.Code == http.StatusTooManyRequests {
			refused++
		}
	}
	if refused != 2 {
		t.Fatalf("refused %d, want 2: rotating inside one /64 must not mint buckets", refused)
	}
	if rec := rig.send("[2001:db8:1:3::1]:443", nil); rec.Code != http.StatusOK {
		t.Fatalf("another /64 is another client: status %d", rec.Code)
	}
}

func TestNoDeterminableAddressIsRefusedNotShared(t *testing.T) {
	rig := newLimitRig(t, RateLimitConfig{})
	rec := rig.send("not-an-address", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if rig.reached != 0 {
		t.Fatal("a request with no determinable client reached the handler")
	}
	// A valid service call does not depend on the address at all.
	if rec := rig.send("not-an-address", map[string]string{ServiceKeyHeader: testServiceKey}); rec.Code != http.StatusBadRequest {
		t.Fatalf("with no exempt key configured the call is still refused: %d", rec.Code)
	}
	exempt := newLimitRig(t, RateLimitConfig{ServiceKey: testServiceKey})
	if rec := exempt.send("not-an-address", map[string]string{ServiceKeyHeader: testServiceKey}); rec.Code != http.StatusOK {
		t.Fatalf("a valid service call: status %d, want 200", rec.Code)
	}
}

func TestParseTrustedProxiesTrustsLessNeverMore(t *testing.T) {
	trusted, rejected := ParseTrustedProxies(" 10.0.0.0/8 , 192.0.2.1, ::ffff:172.16.0.0/108, garbage, 300.1.1.1, ::ffff:1.2.3.4/64, ")
	if len(trusted) != 3 {
		t.Fatalf("trusted = %v, want 3 entries", trusted)
	}
	if len(rejected) != 3 {
		t.Fatalf("rejected = %v, want garbage, 300.1.1.1 and the too-wide mapped range", rejected)
	}
	if got := trusted[2].String(); got != "172.16.0.0/12" {
		t.Fatalf("mapped range = %s, want 172.16.0.0/12", got)
	}
}
