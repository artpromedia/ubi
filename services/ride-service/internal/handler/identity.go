package handler

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// Identity headers the API gateway sends downstream.
//
// These are the names services/api-gateway/src/routes/proxy.ts actually writes
// and services/user-service/src/middleware/service-auth.ts actually reads. Go
// canonicalises header names on lookup, so `x-auth-user-id` and
// `X-Auth-User-Id` are the same key; the lowercase spelling is used here to
// match the gateway source it has to agree with.
//
// The service previously read X-User-ID / X-User-Role, which the gateway has
// never sent — so every request arrived anonymous and every handler that looked
// up a user id got uuid.Nil.
const (
	HeaderUserID    = "x-auth-user-id"
	HeaderUserRole  = "x-auth-user-role"
	HeaderCityID    = "x-auth-city-id"
	HeaderSignature = "x-auth-signature"
	HeaderIssuedAt  = "x-auth-issued-at"
)

type contextKey string

const actorContextKey contextKey = "ubi.actor"

// InternalContextVerifier checks the signature the gateway puts on the identity
// it forwards. When a secret is configured the signature is mandatory: an
// unsigned request is refused, so a caller that reaches this service directly
// cannot simply assert a user id in a header.
//
// When no secret is configured the service trusts the gateway's headers on a
// private network. That is a development-only posture: cmd/server refuses to
// start in production without a secret (see docs/security/INTERNAL_IDENTITY.md),
// and in development the gap is logged at start-up rather than left implicit.
type InternalContextVerifier struct {
	// secrets are every key a signature may verify against. The FIRST one is
	// the signing key; the rest are previous keys kept during a rotation, so
	// the gateway and this service can roll keys without a flag day.
	secrets [][]byte
	maxAge  time.Duration
}

// NewInternalContextVerifier builds a verifier. The secret is a comma-separated
// key list — `new-key,previous-key` during a rotation, one key otherwise. Every
// listed key verifies; the first key signs. An empty list disables signature
// checking (development only; production refuses to boot that way).
func NewInternalContextVerifier(secret string, maxAge time.Duration) *InternalContextVerifier {
	if maxAge <= 0 {
		maxAge = 5 * time.Minute
	}
	var secrets [][]byte
	for _, part := range strings.Split(secret, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			secrets = append(secrets, []byte(trimmed))
		}
	}
	return &InternalContextVerifier{secrets: secrets, maxAge: maxAge}
}

// Enabled reports whether signatures are being checked.
func (v *InternalContextVerifier) Enabled() bool { return v != nil && len(v.secrets) > 0 }

// signingPayload is the canonical string the gateway signs.
func signingPayload(userID, role, cityID, issuedAt string) string {
	return strings.Join([]string{"ubi.internal.v1", userID, role, cityID, issuedAt}, "|")
}

// computeSignature is the one place a signature is derived from a payload.
func computeSignature(secret []byte, payload string) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// Sign produces the signature a gateway would send, using the current (first)
// key. It exists so the gateway and this service can be tested against one
// definition rather than two.
func (v *InternalContextVerifier) Sign(userID, role, cityID string, issuedAt time.Time) string {
	if !v.Enabled() {
		return ""
	}
	payload := signingPayload(userID, role, cityID, strconv.FormatInt(issuedAt.UTC().Unix(), 10))
	return computeSignature(v.secrets[0], payload)
}

func (v *InternalContextVerifier) verify(r *http.Request, userID, role, cityID string) error {
	if !v.Enabled() {
		return nil
	}
	signature := r.Header.Get(HeaderSignature)
	issuedAt := r.Header.Get(HeaderIssuedAt)
	if signature == "" || issuedAt == "" {
		return domain.Errorf(domain.CodeUnauthorized, "this request carries no signed caller identity")
	}
	seconds, err := strconv.ParseInt(issuedAt, 10, 64)
	if err != nil {
		return domain.Errorf(domain.CodeUnauthorized, "this request carries an unreadable identity timestamp")
	}
	age := time.Since(time.Unix(seconds, 0))
	if age < -v.maxAge || age > v.maxAge {
		return domain.Errorf(domain.CodeUnauthorized, "this request's caller identity has expired")
	}
	payload := signingPayload(userID, role, cityID, issuedAt)
	for _, secret := range v.secrets {
		// hmac.Equal is a constant-time compare, and comparing computed MACs
		// (not raw secrets) keeps the timing independent of the input.
		if hmac.Equal([]byte(computeSignature(secret, payload)), []byte(signature)) {
			return nil
		}
	}
	return domain.Errorf(domain.CodeUnauthorized, "this request's caller identity is not signed by the gateway")
}

// knownRoles are the roles the gateway issues that this service acts on. An
// unrecognised role is refused rather than treated as a rider.
var knownRoles = map[string]struct{}{
	move.RoleRider:  {},
	move.RoleDriver: {},
	move.RoleAdmin:  {},
	"service":       {},
}

// RequireIdentity builds the middleware that turns gateway headers into an
// Actor. A request without a user id and a role is refused with 401; there is
// no anonymous fallback, because every endpoint behind it acts on somebody's
// money or somebody's ride.
func RequireIdentity(verifier *InternalContextVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rawID := strings.TrimSpace(r.Header.Get(HeaderUserID))
			role := strings.TrimSpace(r.Header.Get(HeaderUserRole))
			cityID := strings.TrimSpace(r.Header.Get(HeaderCityID))

			if rawID == "" || role == "" {
				writeError(w, domain.Errorf(domain.CodeUnauthorized,
					"this request did not arrive with a caller identity from the gateway"))
				return
			}
			if _, ok := knownRoles[role]; !ok {
				writeError(w, domain.Errorf(domain.CodeForbidden, "the role %q may not use this service", role))
				return
			}
			userID, err := uuid.Parse(rawID)
			if err != nil {
				writeError(w, domain.Errorf(domain.CodeUnauthorized, "the caller identity is not a user id"))
				return
			}
			if err := verifier.verify(r, rawID, role, cityID); err != nil {
				writeError(w, err)
				return
			}

			actor := move.Actor{UserID: userID, Role: role, CityID: cityID}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorContextKey, actor)))
		})
	}
}

// ActorFrom reads the actor the middleware established. The second result is
// false only if a route was mounted without RequireIdentity, which the handlers
// treat as an internal error rather than as an anonymous caller.
func ActorFrom(ctx context.Context) (move.Actor, bool) {
	actor, ok := ctx.Value(actorContextKey).(move.Actor)
	return actor, ok
}
