// Package identity turns the API gateway's signed caller identity into an
// Actor for the custody/return endpoints (C07). It is a port of
// services/ride-service/internal/handler/identity.go, kept byte-for-byte
// compatible on the wire (same header names, same HMAC payload, same
// "ubi.internal.v1" version string) because the gateway signs ONE identity
// context per request and forwards it to whichever backend a route proxies
// to (services/api-gateway/src/middleware/identity.ts). The legacy per-service
// JWT in internal/middleware/auth.go stays as-is for the pre-existing CRUD
// routes; only the new custody/return routes use this gateway identity.
//
// Posture: production fails closed, exactly like ride-service after C03.
//   - Boot: config.ValidateProduction refuses to start a production process
//     without a usable RIDE_INTERNAL_CONTEXT_SECRET, or with the
//     RIDE_ALLOW_UNSIGNED_IDENTITY bypass set (config.ValidateIdentity), and
//     handlers.Readiness never reports that state ready.
//   - Request: a production-posture verifier (NewVerifierFor with
//     production=true) makes the signature mandatory and, should it ever be
//     built without a key, refuses every request with 503 rather than falling
//     back to the plain headers. The plain headers alone never authenticate
//     anyone in production.
//
// Outside production an empty key list still means unsigned dev-trust of the
// gateway's plain headers (cmd/server warns about it at start-up).
package identity

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Identity headers the API gateway sends downstream (see
// services/api-gateway/src/middleware/identity.ts — the mirrors marked
// "CONVENIENCE MIRRORS" there). Go canonicalises header names on lookup, so
// `x-auth-user-id` and `X-Auth-User-Id` are the same key; the lowercase
// spelling matches the gateway source this has to agree with.
const (
	HeaderUserID    = "x-auth-user-id"
	HeaderUserRole  = "x-auth-user-role"
	HeaderCityID    = "x-auth-city-id"
	HeaderSignature = "x-auth-signature"
	HeaderIssuedAt  = "x-auth-issued-at"
)

// Roles this service acts on.
const (
	RoleRider   = "rider" // the sender: UBI has no separate "sender" role.
	RoleDriver  = "driver"
	RoleAdmin   = "admin"
	RoleService = "service"
)

type contextKey string

const actorContextKey contextKey = "ubi.delivery.actor"

// Actor is the caller identity established by RequireIdentity.
type Actor struct {
	UserID uuid.UUID
	Role   string
	CityID string
}

// Verifier checks the signature the gateway puts on the identity it forwards.
// See services/ride-service/internal/handler/identity.go for the full
// rationale; this is that same design, ported.
type Verifier struct {
	secrets [][]byte
	maxAge  time.Duration
	// production is the fail-closed posture: with no key configured the
	// verifier refuses every request instead of trusting the plain headers.
	production bool
}

// NewVerifier builds a verifier. The secret is a comma-separated key list —
// "new-key,previous-key" during a rotation, one key otherwise. An empty list
// disables signature checking (development only).
func NewVerifier(secret string, maxAge time.Duration) *Verifier {
	if maxAge <= 0 {
		maxAge = 5 * time.Minute
	}
	var secrets [][]byte
	for _, part := range strings.Split(secret, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			secrets = append(secrets, []byte(trimmed))
		}
	}
	return &Verifier{secrets: secrets, maxAge: maxAge}
}

// NewVerifierFor builds the verifier in the posture the process's environment
// demands. production=true is the fail-closed posture: a signature is
// mandatory on every request, and an empty key list refuses every request with
// 503 IDENTITY_NOT_CONFIGURED instead of trusting the plain headers (the boot
// check in config.ValidateProduction makes that state unreachable; this is the
// second line of defence). production=false is NewVerifier. cmd/server and the
// test harness both reach it through handlers.NewRouter, so the posture under
// test is the posture production serves.
func NewVerifierFor(secret string, maxAge time.Duration, production bool) *Verifier {
	verifier := NewVerifier(secret, maxAge)
	verifier.production = production
	return verifier
}

// Enabled reports whether signatures are being checked.
func (v *Verifier) Enabled() bool { return v != nil && len(v.secrets) > 0 }

// refusesAll reports a verifier that can authenticate nobody: a nil verifier
// (a wiring mistake, never a reason to trust headers), or the production
// posture without a key.
func (v *Verifier) refusesAll() bool {
	return v == nil || (v.production && len(v.secrets) == 0)
}

func signingPayload(userID, role, cityID, issuedAt string) string {
	return strings.Join([]string{"ubi.internal.v1", userID, role, cityID, issuedAt}, "|")
}

func computeSignature(secret []byte, payload string) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// Sign produces the signature a gateway would send, using the current (first)
// key. It exists so tests can construct a signed request without two
// definitions of the payload drifting apart.
func (v *Verifier) Sign(userID, role, cityID string, issuedAt time.Time) string {
	if !v.Enabled() {
		return ""
	}
	payload := signingPayload(userID, role, cityID, strconv.FormatInt(issuedAt.UTC().Unix(), 10))
	return computeSignature(v.secrets[0], payload)
}

func (v *Verifier) verify(r *http.Request, userID, role, cityID string) error {
	if v.refusesAll() {
		return errNotConfigured()
	}
	if !v.Enabled() {
		return nil
	}
	signature := r.Header.Get(HeaderSignature)
	issuedAt := r.Header.Get(HeaderIssuedAt)
	if signature == "" || issuedAt == "" {
		return errUnauthorized("this request carries no signed caller identity")
	}
	seconds, err := strconv.ParseInt(issuedAt, 10, 64)
	if err != nil {
		return errUnauthorized("this request carries an unreadable identity timestamp")
	}
	age := time.Since(time.Unix(seconds, 0))
	if age < -v.maxAge || age > v.maxAge {
		return errUnauthorized("this request's caller identity has expired")
	}
	payload := signingPayload(userID, role, cityID, issuedAt)
	for _, secret := range v.secrets {
		// hmac.Equal is a constant-time compare, and comparing computed MACs
		// (not raw secrets) keeps the timing independent of the input.
		if hmac.Equal([]byte(computeSignature(secret, payload)), []byte(signature)) {
			return nil
		}
	}
	return errUnauthorized("this request's caller identity is not signed by the gateway")
}

var knownRoles = map[string]struct{}{
	RoleRider:   {},
	RoleDriver:  {},
	RoleAdmin:   {},
	RoleService: {},
}

type apiError struct {
	status  int
	code    string
	message string
}

func errUnauthorized(message string) error {
	return apiError{status: http.StatusUnauthorized, code: "UNAUTHORIZED", message: message}
}

func errForbidden(message string) error {
	return apiError{status: http.StatusForbidden, code: "FORBIDDEN", message: message}
}

// errNotConfigured is the deployment's fault, not the caller's — 503, the same
// honesty as the marketplace hand-off's SERVICE_KEY_NOT_CONFIGURED.
func errNotConfigured() error {
	return apiError{
		status:  http.StatusServiceUnavailable,
		code:    "IDENTITY_NOT_CONFIGURED",
		message: "caller identity cannot be verified: RIDE_INTERNAL_CONTEXT_SECRET is not configured",
	}
}

func (e apiError) Error() string { return e.message }

// writeErrorBody mirrors the {success:false,error:{code,message}} envelope
// every other delivery-service handler answers with (internal/handlers).
type writeErrorBody struct {
	Success bool `json:"success"`
	Error   struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusUnauthorized
	code := "UNAUTHORIZED"
	message := err.Error()
	if apiErr, ok := err.(apiError); ok {
		status = apiErr.status
		code = apiErr.code
		message = apiErr.message
	}
	body := writeErrorBody{Success: false}
	body.Error.Code = code
	body.Error.Message = message
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// RequireIdentity builds the middleware that turns gateway headers into an
// Actor. A request without a user id and a role is refused with 401; there is
// no anonymous fallback, because every endpoint behind it acts on somebody's
// delivery. A verifier that can authenticate nobody (nil, or production
// posture without a key) refuses every request with 503 before any header is
// read.
func RequireIdentity(verifier *Verifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if verifier.refusesAll() {
				writeError(w, errNotConfigured())
				return
			}
			rawID := strings.TrimSpace(r.Header.Get(HeaderUserID))
			role := strings.TrimSpace(r.Header.Get(HeaderUserRole))
			cityID := strings.TrimSpace(r.Header.Get(HeaderCityID))

			if rawID == "" || role == "" {
				writeError(w, errUnauthorized("this request did not arrive with a caller identity from the gateway"))
				return
			}
			if _, ok := knownRoles[role]; !ok {
				writeError(w, errForbidden("the role \""+role+"\" may not use this service"))
				return
			}
			userID, err := uuid.Parse(rawID)
			if err != nil {
				writeError(w, errUnauthorized("the caller identity is not a user id"))
				return
			}
			if err := verifier.verify(r, rawID, role, cityID); err != nil {
				writeError(w, err)
				return
			}

			actor := Actor{UserID: userID, Role: role, CityID: cityID}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorContextKey, actor)))
		})
	}
}

// ActorFrom reads the actor the middleware established. The second result is
// false only if a route was mounted without RequireIdentity, which handlers
// treat as an internal error rather than as an anonymous caller.
func ActorFrom(ctx context.Context) (Actor, bool) {
	actor, ok := ctx.Value(actorContextKey).(Actor)
	return actor, ok
}
