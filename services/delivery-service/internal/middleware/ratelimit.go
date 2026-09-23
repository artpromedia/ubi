package middleware

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"net/netip"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-chi/httprate"
	"github.com/rs/zerolog/log"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/identity"
)

// RATE LIMITING (round 8; the delivery half of the payment-service survey,
// d9d7054).
//
// Before this file the router ran chi's middleware.RealIP — which believes
// True-Client-IP, X-Real-IP and X-Forwarded-For from ANY sender — and then
// httprate.LimitByIP(100/min), both BEFORE ServiceAuth on /api/v1/webhooks/*.
// ride-service's marketplace hand-offs (marketplace-assign) and their
// compensations (marketplace-cancel) send no forwarding header, so every one
// of them, platform-wide, shared ride-service's container address: at most
// 100 delivery awards (and cancellations) a minute for the whole platform,
// and a burst of legacy webhooks from the same pod could starve them. Any
// client, meanwhile, could name a fresh address per request and never be
// limited.
//
// RateLimiter replaces both middlewares:
//
//   - ClientAddress (where RealIP was) resolves who the client is. The
//     socket peer IS the client unless the peer is listed in
//     DELIVERY_TRUSTED_PROXIES (comma-separated IP addresses and/or CIDR
//     ranges; unset — the default — trusts no one). From a trusted peer,
//     X-Forwarded-For is walked from the RIGHT, skipping trusted hops, and
//     the first address that is not one is the client; X-Real-IP is read only
//     when the chain names none; a malformed entry before a client is reached
//     leaves the peer as the client. True-Client-IP is never read. The result
//     replaces r.RemoteAddr, where RealIP used to leave it.
//
//   - Limit (where LimitByIP was) counts a request against WHO it is:
//
//     1. A valid internal service key (X-Service-Key equal, in constant
//     time, to a USABLE INTERNAL_SERVICE_KEY — non-empty and not the
//     committed repository default) is not throttled by this per-client
//     limiter at all. The key is one credential shared by every calling
//     service, so a "per-service" bucket could only be keyed by something
//     the caller declares about itself; and a 429 here lands mid-saga on a
//     hand-off whose refusal costs more than serving it (a refused cancel
//     leaves an orphan delivery assigned to a driver). The key never reaches
//     clients — the gateway deletes X-Service-Key from every request it
//     forwards (services/api-gateway/src/middleware/identity.ts) — so its
//     holder is a platform service bounded by its own concurrency and retry
//     budgets. A forged key is NOT exempt: it is counted per client, and
//     ServiceAuth refuses it.
//     2. A verified gateway identity (the HMAC context the custody routes
//     require, checked with the same verifier RequireIdentity uses) is
//     counted as its user (`actor:<user id>`). With signatures disabled
//     (development only) identity headers are unproven claims and are never
//     a key.
//     3. Everything else — the legacy JWT routes, health checks, any request
//     whose identity does not verify — is counted per client address (an
//     IPv4 host, or an IPv6 /64).
//
//     Nothing here authenticates or writes anything authentication reads:
//     ServiceAuth, RequireIdentity and the legacy JWT middleware still run,
//     unchanged, on every route this lets through.
//
// NO SHARED FALLBACK. A request whose RemoteAddr is not an IP address
// (impossible on the TCP listener cmd/server starts) is refused rather than
// counted under a common key.
//
// Counters are per process (httprate's in-memory window, as LimitByIP was),
// so there is no store to fail and authentication never depends on one.

// EnvTrustedProxies names the proxies allowed to say who the client is.
const EnvTrustedProxies = "DELIVERY_TRUSTED_PROXIES"

// Default budget per key: the 100 a minute LimitByIP enforced per address.
const (
	DefaultRateLimit       = 100
	DefaultRateLimitWindow = time.Minute
)

// ServiceKeyHeader is the header a service-to-service caller presents the
// internal key in (ServiceAuth reads the same one).
const ServiceKeyHeader = "X-Service-Key"

// untrustedForwardLogInterval throttles the misconfiguration warning.
const untrustedForwardLogInterval = time.Minute

type clientAddressKey struct{}

// RateLimitConfig configures NewRateLimiter.
type RateLimitConfig struct {
	// ServiceKey is the internal service key whose holders are not throttled
	// — pass it ONLY when it is usable (non-empty and not the committed
	// default); an empty value exempts nobody.
	ServiceKey string
	// Verifier checks the gateway identity (the custody routes' verifier).
	Verifier *identity.Verifier
	// TrustedProxies is DELIVERY_TRUSTED_PROXIES as configured.
	TrustedProxies string
	// Limit requests per Window per key (defaults: 100 per minute).
	Limit  int
	Window time.Duration
}

// RateLimiter resolves client addresses and limits requests per verified
// user or per client address; valid service calls are not throttled.
type RateLimiter struct {
	serviceKey []byte
	verifier   *identity.Verifier
	trusted    []netip.Prefix
	limiter    *httprate.RateLimiter

	lastUntrustedWarning atomic.Int64
}

// NewRateLimiter builds the limiter. A DELIVERY_TRUSTED_PROXIES entry that is
// not an IP address or CIDR range is ignored — trusting less, never more —
// and logged.
func NewRateLimiter(cfg RateLimitConfig) *RateLimiter {
	trusted, rejected := ParseTrustedProxies(cfg.TrustedProxies)
	for _, entry := range rejected {
		log.Error().Str("entry", entry).Msg(EnvTrustedProxies + " entry is not an IP address or CIDR range; ignored")
	}
	limit, window := cfg.Limit, cfg.Window
	if limit <= 0 {
		limit = DefaultRateLimit
	}
	if window <= 0 {
		window = DefaultRateLimitWindow
	}
	var key []byte
	if strings.TrimSpace(cfg.ServiceKey) != "" {
		key = []byte(cfg.ServiceKey)
	}
	return &RateLimiter{
		serviceKey: key,
		verifier:   cfg.Verifier,
		trusted:    trusted,
		limiter: httprate.NewRateLimiter(limit, window,
			httprate.WithLimitHandler(func(w http.ResponseWriter, _ *http.Request) {
				writeLimitError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests; try again shortly")
			})),
	}
}

func writeLimitError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success": false,
		"error":   map[string]string{"code": code, "message": message},
	})
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
// addresses are being ignored because no proxy is trusted.
func (l *RateLimiter) warnUntrustedForward(peer netip.Addr) {
	now := time.Now().UnixNano()
	last := l.lastUntrustedWarning.Load()
	if now-last < int64(untrustedForwardLogInterval) || !l.lastUntrustedWarning.CompareAndSwap(last, now) {
		return
	}
	log.Warn().Str("peer", peer.String()).
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

// isServiceCall reports a request presenting the usable internal key — the
// same constant-time comparison ServiceAuth refuses with.
func (l *RateLimiter) isServiceCall(r *http.Request) bool {
	if len(l.serviceKey) == 0 {
		return false
	}
	presented := r.Header.Get(ServiceKeyHeader)
	return presented != "" && subtle.ConstantTimeCompare([]byte(presented), l.serviceKey) == 1
}

// RateSubject is who a request is counted as: exempt (a valid service call)
// or a key. ok=false means no key could be determined.
func (l *RateLimiter) RateSubject(r *http.Request) (key string, exempt bool, ok bool) {
	if l.isServiceCall(r) {
		return "", true, true
	}
	if actor, verified := l.verifier.VerifiedActor(r); verified {
		return "actor:" + actor.UserID.String(), false, true
	}
	client, found := r.Context().Value(clientAddressKey{}).(netip.Addr)
	if !found {
		// Mounted without ClientAddress: the socket peer, never a header.
		client, found = parseAddress(r.RemoteAddr)
	}
	if !found {
		return "", false, false
	}
	return clientBucket(client), false, true
}

// Limit refuses a request over its key's budget with 429 RATE_LIMITED and
// X-RateLimit-* headers; a valid service call passes uncounted.
func (l *RateLimiter) Limit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key, exempt, ok := l.RateSubject(r)
		if !ok {
			writeLimitError(w, http.StatusBadRequest, "CLIENT_ADDRESS_UNAVAILABLE", "The client address of this connection is unavailable")
			return
		}
		if !exempt && l.limiter.RespondOnLimit(w, r, key) {
			return
		}
		next.ServeHTTP(w, r)
	})
}
