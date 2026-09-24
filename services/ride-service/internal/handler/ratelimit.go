package handler

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"net/netip"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-chi/httprate"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
)

// RATE LIMITING (round 8, P0).
//
// Before this file, cmd/server mounted chi's middleware.RealIP — which
// believes True-Client-IP, X-Real-IP and X-Forwarded-For from ANY sender — and
// then httprate.LimitByIP(300/min), before any identity was known. Every
// caller of this service is another service: the api-gateway (for every
// client), ask-service and travel-service (HMAC-signed delegations for one
// user each), fleet-service. Gateway traffic was keyed by whatever address
// the client itself wrote (the gateway passed X-Forwarded-For through
// unchecked), so any client could name a fresh address per request and never
// be limited; ask-service's and travel-service's delegations, which forward
// no address, all shared their container's one bucket.
//
// RateLimiter replaces both middlewares:
//
//   - ClientAddress (where RealIP was) resolves who the client is. The socket
//     peer IS the client unless the peer is listed in RIDE_TRUSTED_PROXIES
//     (comma-separated IP addresses and/or CIDR ranges; unset — the default —
//     trusts no one). From a trusted peer, X-Forwarded-For is walked from the
//     RIGHT, skipping trusted hops, and the first address that is not one is
//     the client; X-Real-IP is read only when the chain names none; a chain
//     that is malformed before a client is reached leaves the peer as the
//     client. True-Client-IP is never read. The result replaces r.RemoteAddr,
//     exactly where RealIP left it, so the trip link's own per-client limit
//     (marketplace_guest.go clientKey) keeps reading the passenger's address.
//     List the api-gateway's addresses (and any ingress in front of it):
//     without them every call the gateway forwards is one client.
//
//   - Limit (where LimitByIP was) counts a request against WHO it is:
//
//     1. A verified ride context — the gateway's, or an ask-service /
//     travel-service delegation, signed with the same key list and checked
//     here with the same InternalContextVerifier RequireIdentity uses — is
//     counted as its actor (`actor:<user id>`). This service cannot tell
//     which signer produced a context, and does not need to: a delegation
//     acts for exactly one user and is counted against that user, so a
//     runaway assistant or transfer worker spends the budget of the user it
//     acts for and nobody else's. Exempting delegations instead would exempt
//     every gateway call too — they carry the same proof.
//     2. fleet-service's calls to /internal/fleet (internal contract A)
//     that present a VALID X-Service-Key — the constant-time check
//     RequireFleetServiceKey refuses with, against FLEET_RIDE_SERVICE_KEY
//     (ExemptFleetServiceKey) — are not throttled at all, like
//     payment-service's service-key exemption: the key is one credential
//     the client gateway never proxies, its holder is a platform service
//     bounded by its own retries, and a 429 mid-saga (an off-road report,
//     a maintenance block, a swap) costs more than serving it. A missing,
//     wrong or short key is NOT exempt: it is counted per client below and
//     then refused (401) by RequireFleetServiceKey, never against the
//     service it claims to be.
//     3. Everything else — the trip link, health checks, an /internal/fleet
//     call without a valid key, and any request whose context does not
//     verify — is counted per client address (an IPv4 host, or an IPv6
//     /64).
//
//     Nothing here authenticates or writes anything identity reads:
//     RequireIdentity still runs, unchanged, on every identified route, and
//     refuses what it always refused. With signatures disabled (development
//     only — cmd/server refuses to boot that way in production) identity
//     headers are unproven claims, so they are never a key: every request is
//     counted per client address.
//
// NO DETERMINABLE ADDRESS. There is no shared fallback bucket. A request
// whose RemoteAddr is not an IP address (impossible on the TCP listener
// cmd/server starts) is refused rather than counted under a common key.
//
// Counters are per process (httprate's in-memory window, as LimitByIP was),
// so there is no store to fail: a Redis outage cannot change what this
// limiter decides, and authentication never depends on it.

// EnvTrustedProxies names the proxies allowed to say who the client is.
const EnvTrustedProxies = "RIDE_TRUSTED_PROXIES"

// Default budget per key: the 300 a minute LimitByIP enforced per address.
const (
	DefaultRateLimit       = 300
	DefaultRateLimitWindow = time.Minute
)

// untrustedForwardLogInterval throttles the misconfiguration warning.
const untrustedForwardLogInterval = time.Minute

type clientAddressKey struct{}

// RateLimiter resolves client addresses and limits requests per verified actor
// or per client address.
type RateLimiter struct {
	verifier *InternalContextVerifier
	trusted  []netip.Prefix
	limiter  *httprate.RateLimiter
	logger   zerolog.Logger
	// fleetKey matches a valid FLEET_RIDE_SERVICE_KEY; nil exempts nobody.
	fleetKey func(presented string) bool

	lastUntrustedWarning atomic.Int64
}

// FleetInternalPrefix is where cmd/server mounts internal contract A.
const FleetInternalPrefix = "/internal/fleet"

// ExemptFleetServiceKey exempts fleet-service's /internal/fleet calls that
// present `serviceKey` (FLEET_RIDE_SERVICE_KEY) from the per-client limit.
// An unset or short key (the fleet contract refuses everyone then) exempts
// nobody. Call it once, before serving.
func (l *RateLimiter) ExemptFleetServiceKey(serviceKey string) {
	if len(serviceKey) < FleetServiceKeyMinLength {
		l.fleetKey = nil
		return
	}
	l.fleetKey = fleetKeyMatcher(serviceKey)
}

// fleetKeyMatcher compares a presented key with the configured one over
// SHA-256 digests in constant time, so neither the key nor its length leaks
// through timing. An empty presented key never matches.
func fleetKeyMatcher(serviceKey string) func(presented string) bool {
	want := sha256.Sum256([]byte(serviceKey))
	return func(presented string) bool {
		if presented == "" {
			return false
		}
		got := sha256.Sum256([]byte(presented))
		return subtle.ConstantTimeCompare(got[:], want[:]) == 1
	}
}

// exemptServiceCall reports an /internal/fleet call carrying the VALID
// fleet service key — the only traffic this limiter does not count.
func (l *RateLimiter) exemptServiceCall(r *http.Request) bool {
	if l.fleetKey == nil {
		return false
	}
	path := r.URL.Path
	if path != FleetInternalPrefix && !strings.HasPrefix(path, FleetInternalPrefix+"/") {
		return false
	}
	return l.fleetKey(r.Header.Get(marketplace.FleetServiceKeyHeader))
}

// NewRateLimiter builds the limiter: `limit` requests per `window` per key.
// trustedProxies is RIDE_TRUSTED_PROXIES as configured; an entry that is not
// an IP address or CIDR range is ignored — trusting less, never more — and
// logged.
func NewRateLimiter(verifier *InternalContextVerifier, trustedProxies string, limit int, window time.Duration, logger zerolog.Logger) *RateLimiter {
	trusted, rejected := ParseTrustedProxies(trustedProxies)
	for _, entry := range rejected {
		logger.Error().Str("entry", entry).Msg(EnvTrustedProxies + " entry is not an IP address or CIDR range; ignored")
	}
	return &RateLimiter{
		verifier: verifier,
		trusted:  trusted,
		limiter: httprate.NewRateLimiter(limit, window,
			httprate.WithLimitHandler(func(w http.ResponseWriter, _ *http.Request) {
				writeError(w, domain.Errorf(domain.CodeRateLimited, "too many requests; try again shortly"))
			})),
		logger: logger,
	}
}

// ParseTrustedProxies parses a comma-separated list of IP addresses and CIDR
// ranges, returning the ranges and every entry it could not parse.
func ParseTrustedProxies(raw string) ([]netip.Prefix, []string) {
	var trusted []netip.Prefix
	var rejected []string
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if strings.Contains(entry, "/") {
			prefix, err := netip.ParsePrefix(entry)
			if err != nil {
				rejected = append(rejected, entry)
				continue
			}
			addr := prefix.Addr()
			if addr.Is4In6() {
				// ::ffff:10.0.0.0/104 names the IPv4 range 10.0.0.0/8.
				if prefix.Bits() < 96 {
					rejected = append(rejected, entry)
					continue
				}
				prefix = netip.PrefixFrom(addr.Unmap(), prefix.Bits()-96)
			}
			trusted = append(trusted, prefix.Masked())
			continue
		}
		addr, ok := parseAddress(entry)
		if !ok {
			rejected = append(rejected, entry)
			continue
		}
		trusted = append(trusted, netip.PrefixFrom(addr, addr.BitLen()))
	}
	return trusted, rejected
}

// parseAddress reads a bare address from a socket or header value — port,
// brackets and zone stripped, an IPv4-mapped IPv6 address unmapped.
func parseAddress(raw string) (netip.Addr, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return netip.Addr{}, false
	}
	if addrPort, err := netip.ParseAddrPort(value); err == nil {
		return addrPort.Addr().WithZone("").Unmap(), true
	}
	if strings.HasPrefix(value, "[") && strings.HasSuffix(value, "]") {
		value = value[1 : len(value)-1]
	}
	addr, err := netip.ParseAddr(value)
	if err != nil {
		return netip.Addr{}, false
	}
	return addr.WithZone("").Unmap(), true
}

func (l *RateLimiter) isTrusted(addr netip.Addr) bool {
	for _, prefix := range l.trusted {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

// resolveClient is the client a request is attributed to, from the socket
// peer and — only when the peer is trusted — what it forwarded.
func (l *RateLimiter) resolveClient(r *http.Request) (netip.Addr, bool) {
	peer, ok := parseAddress(r.RemoteAddr)
	if !ok {
		return netip.Addr{}, false
	}
	if !l.isTrusted(peer) {
		if len(l.trusted) == 0 && r.Header.Get("X-Forwarded-For") != "" {
			l.warnUntrustedForward(peer)
		}
		return peer, true
	}
	var entries []string
	for _, header := range r.Header.Values("X-Forwarded-For") {
		for _, entry := range strings.Split(header, ",") {
			if entry = strings.TrimSpace(entry); entry != "" {
				entries = append(entries, entry)
			}
		}
	}
	for index := len(entries) - 1; index >= 0; index-- {
		addr, ok := parseAddress(entries[index])
		if !ok {
			// Nothing to the left of a bad entry can be attributed to anyone.
			return peer, true
		}
		if !l.isTrusted(addr) {
			return addr, true
		}
	}
	if real, ok := parseAddress(r.Header.Get("X-Real-IP")); ok {
		return real, true
	}
	return peer, true
}

// warnUntrustedForward says, at most once a minute, that forwarded client
// addresses are being ignored because no proxy is trusted — the deployment
// state in which every client behind the gateway is one client here.
func (l *RateLimiter) warnUntrustedForward(peer netip.Addr) {
	now := time.Now().UnixNano()
	last := l.lastUntrustedWarning.Load()
	if now-last < int64(untrustedForwardLogInterval) || !l.lastUntrustedWarning.CompareAndSwap(last, now) {
		return
	}
	l.logger.Warn().Str("peer", peer.String()).
		Msg(EnvTrustedProxies + " is unset: X-Forwarded-For is ignored and this peer is counted as one client")
}

// ClientAddress resolves the client address and puts it in r.RemoteAddr (a
// bare address, as RealIP did) for everything after it. It never refuses.
func (l *RateLimiter) ClientAddress(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		client, ok := l.resolveClient(r)
		if ok {
			if peer, _ := parseAddress(r.RemoteAddr); peer != client {
				r.RemoteAddr = client.String()
			}
			r = r.WithContext(context.WithValue(r.Context(), clientAddressKey{}, client))
		}
		next.ServeHTTP(w, r)
	})
}

// clientBucket is the key for a client address: an IPv4 host, or an IPv6 /64
// — the block one subscriber is normally given.
func clientBucket(addr netip.Addr) string {
	if addr.Is4() {
		return "ip:" + addr.String()
	}
	return "ip6:" + netip.PrefixFrom(addr, 64).Masked().String()
}

// verifiedActor is the user a request's ride context names, when — and only
// when — the context verifies exactly as RequireIdentity would accept it.
func (l *RateLimiter) verifiedActor(r *http.Request) (uuid.UUID, bool) {
	if !l.verifier.Enabled() {
		return uuid.Nil, false
	}
	rawID := strings.TrimSpace(r.Header.Get(HeaderUserID))
	role := strings.TrimSpace(r.Header.Get(HeaderUserRole))
	cityID := strings.TrimSpace(r.Header.Get(HeaderCityID))
	if rawID == "" || role == "" {
		return uuid.Nil, false
	}
	if _, known := knownRoles[role]; !known {
		return uuid.Nil, false
	}
	userID, err := uuid.Parse(rawID)
	if err != nil {
		return uuid.Nil, false
	}
	if l.verifier.verify(r, rawID, role, cityID) != nil {
		return uuid.Nil, false
	}
	return userID, true
}

// rateKey is who a request is counted as.
func (l *RateLimiter) rateKey(r *http.Request) (string, bool) {
	if actor, ok := l.verifiedActor(r); ok {
		return "actor:" + actor.String(), true
	}
	client, ok := r.Context().Value(clientAddressKey{}).(netip.Addr)
	if !ok {
		// Mounted without ClientAddress: the socket peer, never a header.
		client, ok = parseAddress(r.RemoteAddr)
	}
	if !ok {
		return "", false
	}
	return clientBucket(client), true
}

// Limit refuses a request over its key's budget with 429 rate_limited and
// X-RateLimit-* / Retry-After headers. A valid fleet service call is not
// counted (ExemptFleetServiceKey).
func (l *RateLimiter) Limit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if l.exemptServiceCall(r) {
			next.ServeHTTP(w, r)
			return
		}
		key, ok := l.rateKey(r)
		if !ok {
			writeError(w, domain.Errorf(domain.CodeValidationFailed, "the client address of this connection is unavailable"))
			return
		}
		if l.limiter.RespondOnLimit(w, r, key) {
			return
		}
		next.ServeHTTP(w, r)
	})
}
