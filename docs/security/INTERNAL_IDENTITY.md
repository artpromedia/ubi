# Internal identity: the gateway → service trust boundary

This page is the operator's contract for how a caller's identity crosses from
the API gateway into a backend service, which environment variables carry the
keys, what fails closed in production, and how to rotate a key. The canonical
header list lives in `services/api-gateway/src/middleware/identity.ts`.

## The boundary in one paragraph

The API gateway is the ONLY issuer of identity. On every inbound request it
first DELETES every reserved header a client may have sent (`x-auth-*`,
`x-ubi-*`, `x-user-*`, `x-internal-*`, `x-service-key`, `x-session-id`), then —
after validating the bearer token — installs its own set: the authoritative
signed `X-UBI-Identity` JWS, plain mirrors (`x-auth-user-id`, `x-user-id`, …)
for services that have not migrated to the JWS, and the ride-service HMAC
context described below. A service that receives traffic ONLY from the gateway
on an isolated network may temporarily trust the mirrors in development;
in production every service below refuses to run unauthenticated.

## Signatures on the wire

| What                                    | Headers                                                  | Key env var                                      | Verifier                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Identity context JWS (HS256, 120 s TTL) | `x-ubi-identity`                                         | `UBI_IDENTITY_SECRET` (+ `_PREVIOUS`, `_KEY_ID`) | api-gateway (`src/identity/context.ts`), user-service (`src/identity/context.ts`), payment-service (`src/identity/context.ts`) |
| Ride-service HMAC context               | `x-auth-signature`, `x-auth-issued-at`, `x-auth-city-id` | `RIDE_INTERNAL_CONTEXT_SECRET`                   | ride-service (`internal/handler/identity.go`); signer: api-gateway (`src/identity/ride-context.ts`)                            |
| Service-to-service key                  | `X-Service-Key`                                          | `INTERNAL_SERVICE_KEY`                           | payment-service (`internalServiceAuth`, fail-closed), delivery-service (`ServiceAuth` + boot guard)                            |

The ride HMAC signs the canonical payload
`ubi.internal.v1|<userId>|<role>|<cityId>|<issuedAt unix seconds>`
(HMAC-SHA256, base64url without padding). Gateway and ride-service pin the
same test fixture (`tests/ride-signature.test.ts` /
`internal/handler/ride_test.go: TestSigningParityWithTheGateway`), so a drift
in the payload turns tests red on both sides instead of turning production
traffic into 401s. The context's maximum age is 5 minutes by default and can
be tuned with `RIDE_INTERNAL_CONTEXT_MAX_AGE_MS` on the ride-service.

## Environment names

- Node services read `NODE_ENV` (`development` / `test` / `production`).
- Go services read **`UBI_ENV`** (introduced by this hardening; values
  `development` / `staging` / `production`, `prod` accepted). For backward
  compatibility ride-service falls back to `NODE_ENV` and delivery-service to
  `ENV` when `UBI_ENV` is unset. Set `UBI_ENV=production` in every production
  Go manifest.

## What fails closed in production

- **ride-service** (`cmd/server/main.go`): boots FATALLY when
  `RIDE_INTERNAL_CONTEXT_SECRET` is empty, and FATALLY when
  `RIDE_ALLOW_UNSIGNED_IDENTITY` is set to ANY value — the bypass variable is
  development-only and may never appear in a production manifest, even
  alongside a valid secret. Belt-and-braces: `/health/ready` answers 503
  (`"dependency":"identity"`) in that state, so even a refactored boot path
  would never receive traffic. Development keeps the old behavior with a
  start-up warning.
- **delivery-service** (`internal/config.ValidateProduction`): boots fatally
  when `INTERNAL_SERVICE_KEY` or `JWT_SECRET` is empty or still the committed
  repository default (`internal-key` / `your-secret-key`). The per-request
  guard on the marketplace hand-off remains as the second line of defence.
- **user-service** (`src/middleware/service-auth.ts`): with
  `NODE_ENV=production`, the legacy `/users` `/drivers` `/sessions` surface
  authenticates ONLY via the verified `x-ubi-identity` JWS; the plain
  `x-auth-user-id` mirror and the `x-internal-service: true` bypass are
  refused. (The identity/device/mandate routes already verified the JWS.)
- **payment-service**: the live `internalServiceAuth` refuses every request
  when `INTERNAL_SERVICE_KEY` is unset. The quarantined legacy routes with
  fail-open key checks stay unmounted, enforced structurally by the router
  registry in `src/index.ts` and the tripwire test
  `tests/routes-inventory.test.ts` (see `QUARANTINE.md`). `serviceAuth`
  (`src/middleware/auth.ts`) — guarding `/fraud/*`, `/safety/*`, `/admin/*`,
  `/v1/wallet/*` (including the marketplace wallet overview) and
  `/v1/finance/*` — verifies a presented `x-ubi-identity` JWS in every
  environment and it wins when present; with `NODE_ENV=production` it is
  REQUIRED, so the plain `X-User-ID` mirror (previously trusted alone, which
  let any caller with service-network access read another driver's wallet by
  setting the header) is refused, and a missing/misconfigured
  `UBI_IDENTITY_SECRET` is a 503, never a fall back to the unsigned header.

## Rotating `RIDE_INTERNAL_CONTEXT_SECRET`

The variable is a comma-separated key list on BOTH the gateway and the
ride-service. Every listed key verifies; the FIRST key signs.

1. Set `RIDE_INTERNAL_CONTEXT_SECRET=<new>,<old>` on the ride-service and roll
   it (it now accepts both keys).
2. Set the same value on the gateway and roll it (it now signs with `<new>`;
   in-flight requests signed with `<old>` still verify).
3. After one context lifetime, drop `,<old>` from both.

`UBI_IDENTITY_SECRET` rotates the same way via `UBI_IDENTITY_SECRET_PREVIOUS`
and `UBI_IDENTITY_KEY_ID[_PREVIOUS]` (see `src/identity/context.ts`). Keys are
read per call on the gateway, so rotation needs no restart beyond the env
change itself.

## Known non-goals of this boundary (deployment scope)

- **Network isolation is still required.** The mirrors are trusted by some
  services in development — payment-service reads `X-User-ID` there when no
  JWS is presented — and location-service exposes an entirely unauthenticated
  internal API (`services/location-service`, no identity surface at all).
  None of these may be reachable from outside the service network.
- The gateway does not proxy WebSockets; the realtime-gateway is a separate
  ingress with its own authentication and is not covered by the header
  stripping described here.
