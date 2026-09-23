package handler

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// The ride-service limiter counts WHO a request is — the verified ride-context
// actor, else the client address resolved from the socket and
// RIDE_TRUSTED_PROXIES — never an address a caller merely wrote in a header,
// and never one shared bucket (ratelimit.go).
//
// The router below is main.go's composition in miniature: ClientAddress where
// RealIP was, Limit where LimitByIP was, the REAL RequireIdentity on an
// identified group, and a guest route that answers with the REAL clientKey the
// trip link limits on. TestMainWiresTheLimiter pins that main.go really is
// composed that way.

const rateLimitSecret = "rate-limit-suite-context-secret-0001"

func rateLimitRouter(t *testing.T, verifier *InternalContextVerifier, trustedProxies string, limit int) http.Handler {
	t.Helper()
	limiter := NewRateLimiter(verifier, trustedProxies, limit, time.Minute, zerolog.Nop())
	router := chi.NewRouter()
	router.Use(limiter.ClientAddress)
	router.Use(limiter.Limit)
	router.Get("/v1/mp/trip-access", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"client": clientKey(r)})
	})
	router.Group(func(identified chi.Router) {
		identified.Use(RequireIdentity(verifier))
		identified.Get("/v1/rides/active", echoActor)
	})
	return router
}

// rlRequest builds a request arriving from `peer` (host only).
func rlRequest(path, peer string) *http.Request {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.RemoteAddr = peer + ":40123"
	return request
}

// rlSigned is a ride context for `userID`, signed as the gateway, ask-service
// or travel-service would sign it — they share the key list.
func rlSigned(verifier *InternalContextVerifier, request *http.Request, userID uuid.UUID) *http.Request {
	issuedAt := time.Now()
	request.Header.Set(HeaderUserID, userID.String())
	request.Header.Set(HeaderUserRole, move.RoleRider)
	request.Header.Set(HeaderCityID, "LOS")
	request.Header.Set(HeaderIssuedAt, strconv.FormatInt(issuedAt.Unix(), 10))
	request.Header.Set(HeaderSignature, verifier.Sign(userID.String(), move.RoleRider, "LOS", issuedAt))
	return request
}

func rlServe(router http.Handler, request *http.Request) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func rlCode(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Code  string `json:"code"`
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("error body is not JSON: %q", recorder.Body.String())
	}
	if body.Code != "" {
		return body.Code
	}
	return body.Error.Code
}

func rlClient(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	if recorder.Code != http.StatusOK {
		t.Fatalf("status %d, want 200 (%s)", recorder.Code, recorder.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return body["client"]
}

func requireStatusRL(t *testing.T, recorder *httptest.ResponseRecorder, want int, what string) {
	t.Helper()
	if recorder.Code != want {
		t.Fatalf("%s: status %d, want %d (%s)", what, recorder.Code, want, recorder.Body.String())
	}
}

// A flood from one verified actor is refused without touching another actor
// arriving from the same gateway, a delegation for a third user, or the
// per-client bucket of that address.
func TestRateLimitFloodedActorLeavesOtherIdentitiesAlone(t *testing.T) {
	const limit = 5
	verifier := NewInternalContextVerifier(rateLimitSecret, 5*time.Minute)
	router := rateLimitRouter(t, verifier, "10.0.0.0/8", limit)
	flooder, neighbour, delegated := uuid.New(), uuid.New(), uuid.New()

	for i := 0; i < limit; i++ {
		request := rlSigned(verifier, rlRequest("/v1/rides/active", "10.0.0.1"), flooder)
		// Rotating the forwarded address buys nothing: the bucket is the actor.
		request.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i))
		requireStatusRL(t, rlServe(router, request), http.StatusOK, fmt.Sprintf("call %d", i+1))
	}
	limited := rlServe(router, rlSigned(verifier, rlRequest("/v1/rides/active", "10.0.0.1"), flooder))
	requireStatusRL(t, limited, http.StatusTooManyRequests, "flooder over budget")
	if code := rlCode(t, limited); code != "rate_limited" {
		t.Fatalf("code %q, want rate_limited", code)
	}
	if limited.Header().Get("Retry-After") == "" {
		t.Fatal("a refusal carries Retry-After")
	}
	// From another gateway pod: still the same actor, still refused.
	requireStatusRL(t, rlServe(router, rlSigned(verifier, rlRequest("/v1/rides/active", "10.0.0.2"), flooder)),
		http.StatusTooManyRequests, "flooder via another pod")

	requireStatusRL(t, rlServe(router, rlSigned(verifier, rlRequest("/v1/rides/active", "10.0.0.1"), neighbour)),
		http.StatusOK, "another rider through the same gateway")
	// An ask-service / travel-service delegation arrives from its own
	// container with the same proof; it is counted as the user it acts for.
	requireStatusRL(t, rlServe(router, rlSigned(verifier, rlRequest("/v1/rides/active", "172.20.0.9"), delegated)),
		http.StatusOK, "a delegation for a third user")
	requireStatusRL(t, rlServe(router, rlRequest("/v1/mp/trip-access", "10.0.0.1")),
		http.StatusOK, "the gateway's own client bucket")
}

// A context that does not verify names nobody: it is counted against the
// address that sent it, never against the user it claims, and identity still
// refuses it.
func TestRateLimitForgedContextIsCountedAgainstItsSender(t *testing.T) {
	const limit = 3
	verifier := NewInternalContextVerifier(rateLimitSecret, 5*time.Minute)
	router := rateLimitRouter(t, verifier, "", limit)
	victim := uuid.New()

	for i := 0; i < limit; i++ {
		request := rlSigned(verifier, rlRequest("/v1/rides/active", "203.0.113.66"), victim)
		request.Header.Set(HeaderSignature, "forged-signature")
		requireStatusRL(t, rlServe(router, request), http.StatusUnauthorized, fmt.Sprintf("forged call %d", i+1))
	}
	forged := rlSigned(verifier, rlRequest("/v1/rides/active", "203.0.113.66"), victim)
	forged.Header.Set(HeaderSignature, "forged-signature")
	requireStatusRL(t, rlServe(router, forged), http.StatusTooManyRequests, "forger over budget")

	requireStatusRL(t, rlServe(router, rlSigned(verifier, rlRequest("/v1/rides/active", "10.0.0.1"), victim)),
		http.StatusOK, "the victim's own budget is untouched")
}

// Without a trusted proxy, forwarded headers are the caller's own claims: the
// peer is counted, however many addresses it names.
func TestRateLimitSpoofedForwardingMintsNoBuckets(t *testing.T) {
	const limit = 4
	verifier := NewInternalContextVerifier(rateLimitSecret, 5*time.Minute)
	router := rateLimitRouter(t, verifier, "", limit)

	for i := 0; i < limit; i++ {
		request := rlRequest("/v1/mp/trip-access", "203.0.113.5")
		request.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d, 192.0.2.%d", i, i))
		request.Header.Set("X-Real-IP", fmt.Sprintf("192.0.2.%d", 100+i))
		request.Header.Set("True-Client-IP", fmt.Sprintf("192.0.2.%d", 200+i))
		if got := rlClient(t, rlServe(router, request)); got != "203.0.113.5" {
			t.Fatalf("call %d: the trip link keyed %q, want the peer 203.0.113.5", i+1, got)
		}
	}
	request := rlRequest("/v1/mp/trip-access", "203.0.113.5")
	request.Header.Set("X-Forwarded-For", "198.51.100.250")
	requireStatusRL(t, rlServe(router, request), http.StatusTooManyRequests, "spoofing peer over budget")

	requireStatusRL(t, rlServe(router, rlRequest("/v1/mp/trip-access", "203.0.113.6")),
		http.StatusOK, "another client")
}

// With the gateway trusted, the client it forwarded is keyed — and what that
// client prepended is never reached.
func TestRateLimitTrustedProxyKeysTheForwardedClient(t *testing.T) {
	const limit = 4
	verifier := NewInternalContextVerifier(rateLimitSecret, 5*time.Minute)
	router := rateLimitRouter(t, verifier, "10.0.0.0/8, fd00::/8", limit)

	for i := 0; i < limit; i++ {
		request := rlRequest("/v1/mp/trip-access", "10.0.0.1")
		request.Header.Set("X-Forwarded-For", fmt.Sprintf("6.6.6.%d, 198.51.100.7", i))
		if got := rlClient(t, rlServe(router, request)); got != "198.51.100.7" {
			t.Fatalf("call %d: keyed %q, want the forwarded client 198.51.100.7", i+1, got)
		}
	}
	over := rlRequest("/v1/mp/trip-access", "10.0.0.1")
	over.Header.Set("X-Forwarded-For", "198.51.100.7")
	requireStatusRL(t, rlServe(router, over), http.StatusTooManyRequests, "forwarded client over budget")

	neighbour := rlRequest("/v1/mp/trip-access", "10.0.0.1")
	neighbour.Header.Set("X-Forwarded-For", "198.51.100.8")
	if got := rlClient(t, rlServe(router, neighbour)); got != "198.51.100.8" {
		t.Fatalf("neighbour keyed %q", got)
	}

	cases := []struct {
		name    string
		peer    string
		headers map[string]string
		want    string
	}{
		{"every trusted hop is walked past", "10.0.0.1",
			map[string]string{"X-Forwarded-For": "198.51.100.9, 10.2.3.4"}, "198.51.100.9"},
		{"X-Real-IP when the chain names no client", "10.0.0.1",
			map[string]string{"X-Forwarded-For": "10.9.9.9", "X-Real-IP": "198.51.100.11"}, "198.51.100.11"},
		{"a malformed chain leaves the proxy as the client", "10.0.0.1",
			map[string]string{"X-Forwarded-For": "198.51.100.12, not-an-address"}, "10.0.0.1"},
		{"a port on a forwarded entry is stripped", "10.0.0.1",
			map[string]string{"X-Forwarded-For": "198.51.100.13:5555"}, "198.51.100.13"},
		{"an untrusted peer is its own client, whatever it forwards", "203.0.113.20",
			map[string]string{"X-Forwarded-For": "198.51.100.14"}, "203.0.113.20"},
		{"an IPv6 proxy is trusted by range", "fd00::1",
			map[string]string{"X-Forwarded-For": "2001:db8::5"}, "2001:db8::5"},
	}
	for _, tc := range cases {
		request := rlRequest("/v1/mp/trip-access", tc.peer)
		if tc.peer == "fd00::1" {
			request.RemoteAddr = "[fd00::1]:40123"
		}
		for name, value := range tc.headers {
			request.Header.Set(name, value)
		}
		if got := rlClient(t, rlServe(router, request)); got != tc.want {
			t.Fatalf("%s: keyed %q, want %q", tc.name, got, tc.want)
		}
	}
}

// An IPv6 client is counted per /64, so walking through its own block mints
// nothing.
func TestRateLimitCountsIPv6PerSlash64(t *testing.T) {
	const limit = 3
	verifier := NewInternalContextVerifier(rateLimitSecret, 5*time.Minute)
	router := rateLimitRouter(t, verifier, "10.0.0.1", limit)
	send := func(client string) *httptest.ResponseRecorder {
		request := rlRequest("/v1/mp/trip-access", "10.0.0.1")
		request.Header.Set("X-Forwarded-For", client)
		return rlServe(router, request)
	}
	for i := 1; i <= limit; i++ {
		requireStatusRL(t, send(fmt.Sprintf("2001:db8:1:2:%x::1", i)), http.StatusOK, fmt.Sprintf("call %d", i))
	}
	requireStatusRL(t, send("2001:db8:1:2:ffff::1"), http.StatusTooManyRequests, "same /64")
	requireStatusRL(t, send("2001:db8:1:3::1"), http.StatusOK, "another /64")
}

// No request is ever counted under a common key: one with no readable address
// is refused, uncounted, and two unidentified clients never share.
func TestRateLimitHasNoSharedFallbackBucket(t *testing.T) {
	verifier := NewInternalContextVerifier(rateLimitSecret, 5*time.Minute)
	limiter := NewRateLimiter(verifier, "", 1, time.Minute, zerolog.Nop())
	for _, remote := range []string{"", "@", "not-an-address"} {
		request := httptest.NewRequest(http.MethodGet, "/v1/mp/trip-access", nil)
		request.RemoteAddr = remote
		if key, ok := limiter.rateKey(request); ok {
			t.Fatalf("RemoteAddr %q was keyed as %q", remote, key)
		}
	}

	router := rateLimitRouter(t, verifier, "", 1)
	request := httptest.NewRequest(http.MethodGet, "/v1/mp/trip-access", nil)
	request.RemoteAddr = ""
	refused := rlServe(router, request)
	requireStatusRL(t, refused, http.StatusUnprocessableEntity, "no readable address")
	if code := rlCode(t, refused); code != "validation_failed" {
		t.Fatalf("code %q", code)
	}
	for _, client := range []string{"203.0.113.30", "203.0.113.31", "203.0.113.32"} {
		requireStatusRL(t, rlServe(router, rlRequest("/v1/mp/trip-access", client)), http.StatusOK, client)
	}
}

// With signatures disabled (development only), identity headers are unproven
// claims: they are never a key, so naming a fresh user per request mints
// nothing — while RequireIdentity keeps its development posture unchanged.
func TestRateLimitNeverKeysAnUnsignedClaim(t *testing.T) {
	const limit = 3
	verifier := NewInternalContextVerifier("", 0)
	router := rateLimitRouter(t, verifier, "", limit)
	claim := func() *http.Request {
		request := rlRequest("/v1/rides/active", "203.0.113.40")
		request.Header.Set(HeaderUserID, uuid.NewString())
		request.Header.Set(HeaderUserRole, move.RoleRider)
		return request
	}
	for i := 0; i < limit; i++ {
		requireStatusRL(t, rlServe(router, claim()), http.StatusOK, fmt.Sprintf("claim %d", i+1))
	}
	requireStatusRL(t, rlServe(router, claim()), http.StatusTooManyRequests, "a fresh claimed user")
}

// The limiter grants nothing: a request it lets through still meets
// RequireIdentity exactly as before, and its counters live in process — no
// store whose outage could change either decision.
func TestRateLimitNeverAuthenticates(t *testing.T) {
	verifier := NewInternalContextVerifier(rateLimitSecret, 5*time.Minute)
	router := rateLimitRouter(t, verifier, "10.0.0.0/8", 100)

	unsigned := rlRequest("/v1/rides/active", "10.0.0.1")
	unsigned.Header.Set(HeaderUserID, uuid.NewString())
	unsigned.Header.Set(HeaderUserRole, move.RoleRider)
	requireStatusRL(t, rlServe(router, unsigned), http.StatusUnauthorized, "unsigned context")

	stale := rlRequest("/v1/rides/active", "10.0.0.1")
	userID := uuid.New()
	issuedAt := time.Now().Add(-time.Hour)
	stale.Header.Set(HeaderUserID, userID.String())
	stale.Header.Set(HeaderUserRole, move.RoleRider)
	stale.Header.Set(HeaderIssuedAt, strconv.FormatInt(issuedAt.Unix(), 10))
	stale.Header.Set(HeaderSignature, verifier.Sign(userID.String(), move.RoleRider, "", issuedAt))
	requireStatusRL(t, rlServe(router, stale), http.StatusUnauthorized, "stale context")

	requireStatusRL(t, rlServe(router, rlRequest("/v1/rides/active", "10.0.0.1")), http.StatusUnauthorized, "no context")
}

func TestParseTrustedProxies(t *testing.T) {
	trusted, rejected := ParseTrustedProxies(" 10.0.0.1 , 172.16.0.0/12, fd00::/8, ::ffff:192.168.0.0/112, [::1], nonsense, 10.0.0.0/99, ")
	var got []string
	for _, prefix := range trusted {
		got = append(got, prefix.String())
	}
	want := []string{"10.0.0.1/32", "172.16.0.0/12", "fd00::/8", "192.168.0.0/16", "::1/128"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("trusted %v, want %v", got, want)
	}
	if fmt.Sprint(rejected) != fmt.Sprint([]string{"nonsense", "10.0.0.0/99"}) {
		t.Fatalf("rejected %v", rejected)
	}
}

// main.go must mount the limiter exactly where RealIP and LimitByIP were —
// and neither of them. Parsed from source like the route manifest test, so a
// revert of the wiring fails here.
func TestMainWiresTheLimiter(t *testing.T) {
	const mainGo = "../../cmd/server/main.go"
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, mainGo, nil, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", mainGo, err)
	}
	var uses []string
	constructed := false
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		if receiver, ok := selector.X.(*ast.Ident); ok && receiver.Name == "handler" && selector.Sel.Name == "NewRateLimiter" {
			constructed = true
			if len(call.Args) < 2 {
				t.Fatalf("NewRateLimiter called with %d arguments", len(call.Args))
			}
			env, ok := call.Args[1].(*ast.CallExpr)
			if !ok || len(env.Args) != 2 {
				t.Fatal("NewRateLimiter's trusted proxies must come from getEnv(handler.EnvTrustedProxies, \"\")")
			}
			name, ok := env.Args[0].(*ast.SelectorExpr)
			def, isLit := env.Args[1].(*ast.BasicLit)
			if !ok || name.Sel.Name != "EnvTrustedProxies" || !isLit || def.Value != `""` {
				t.Fatal("RIDE_TRUSTED_PROXIES must default to trusting no one")
			}
		}
		if receiver, ok := selector.X.(*ast.Ident); !ok || receiver.Name != "router" || selector.Sel.Name != "Use" {
			return true
		}
		for _, arg := range call.Args {
			switch expr := arg.(type) {
			case *ast.SelectorExpr:
				if owner, ok := expr.X.(*ast.Ident); ok {
					uses = append(uses, owner.Name+"."+expr.Sel.Name)
				}
			case *ast.CallExpr:
				if inner, ok := expr.Fun.(*ast.SelectorExpr); ok {
					if owner, ok := inner.X.(*ast.Ident); ok {
						uses = append(uses, owner.Name+"."+inner.Sel.Name+"()")
					}
				}
			}
		}
		return true
	})
	if !constructed {
		t.Fatal("main.go never builds handler.NewRateLimiter")
	}
	index := map[string]int{}
	for i, use := range uses {
		index[use] = i
		switch use {
		case "middleware.RealIP", "httprate.LimitByIP()", "httprate.LimitByRealIP()", "httprate.Limit()":
			t.Fatalf("main.go still mounts %s (router.Use order: %v)", use, uses)
		}
	}
	clientAt, hasClient := index["limiter.ClientAddress"]
	limitAt, hasLimit := index["limiter.Limit"]
	if !hasClient || !hasLimit {
		t.Fatalf("main.go must mount limiter.ClientAddress and limiter.Limit (router.Use order: %v)", uses)
	}
	if recovererAt, ok := index["middleware.Recoverer"]; !ok || clientAt > recovererAt || clientAt < index["middleware.RequestID"] {
		t.Fatalf("limiter.ClientAddress must sit where RealIP did, after RequestID and before Recoverer (router.Use order: %v)", uses)
	}
	if limitAt != len(uses)-1 || limitAt < index["cors.Handler()"] {
		t.Fatalf("limiter.Limit must be the last router.Use, after CORS (router.Use order: %v)", uses)
	}
}
