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

| What                                       | Headers                                                                                                                                                                 | Key env var                                                               | Verifier                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity context JWS (HS256, 120 s TTL)    | `x-ubi-identity`                                                                                                                                                        | `UBI_IDENTITY_SECRET` (+ `_PREVIOUS`, `_KEY_ID`)                          | api-gateway (`src/identity/context.ts`), user-service (`src/identity/context.ts`), payment-service (`src/identity/context.ts`), ask-service (`src/lib/identity-context.ts`), travel-service (`src/lib/identity-context.ts` + `src/middleware/auth.ts`), fleet-service (`src/lib/identity-context.ts` + `src/middleware/auth.ts`) |
| Ride-service HMAC context                  | `x-auth-signature`, `x-auth-issued-at`, `x-auth-city-id`                                                                                                                | `RIDE_INTERNAL_CONTEXT_SECRET`                                            | ride-service (`internal/handler/identity.go`), delivery-service custody routes (`internal/identity`); signers: api-gateway (`src/identity/ride-context.ts`), and — each for exactly one user — ask-service (`src/lib/ride-context.ts`) and travel-service (`src/lib/ride-context.ts`, airport transfers as the traveller)        |
| Service-to-service key                     | `X-Service-Key`                                                                                                                                                         | `INTERNAL_SERVICE_KEY` and the per-surface keys below                     | payment-service (`internalServiceAuth`, fail-closed), delivery-service (`ServiceAuth` + boot guard) — see **Internal service-key surfaces**                                                                                                                                                                                      |
| Travel payment port `/v1/finance/travel/*` | `X-Service-Key` (auth); `x-ubi-identity` verified when presented; `X-User-ID`/`X-User-Role` recorded as unverified context only; scoped `Idempotency-Key` on every POST | `INTERNAL_SERVICE_KEY` (same value on travel-service and payment-service) | payment-service (`src/finance/travel-routes.ts`: `internalServiceAuth` fail-closed + signed-identity check); caller travel-service (`src/ports/payment-port.ts`, keys `<orderId>:auth\|:cap\|:rel`, `status()` read-back after an ambiguous or 409 answer)                                                                       |

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
  repository default (`internal-key` / `your-secret-key`), when
  `RIDE_INTERNAL_CONTEXT_SECRET` is unusable (the custody/return routes verify
  the gateway's HMAC context) and when `RIDE_ALLOW_UNSIGNED_IDENTITY` is set.
  The per-request guards on the marketplace hand-off and its cancellation (503
  `SERVICE_KEY_NOT_CONFIGURED` under an empty or default key) remain as the
  second line of defence.
- **travel-service** (`src/index.ts`): refuses to boot in production without
  a usable `UBI_IDENTITY_SECRET`, with a test-only supplier adapter enabled,
  or without the ride signing key; every route verifies `x-ubi-identity` and
  never falls back to the plain mirrors there. It re-checks the gateway's
  scopes on the signed context: every money-moving `/v1/travel` write needs
  `travel:book` and is refused in limited mode (`src/middleware/scopes.ts`).
- **fleet-service** (`src/index.ts`): refuses to boot in production without a
  usable `UBI_IDENTITY_SECRET`; client routes read the caller, role and city
  from the signed context only.
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

## Gateway routing (which path a request arrives at)

Caddy sends all API traffic to the gateway, which mounts `/v1`. The
downstream path is decided per service by
`services/api-gateway/src/routes/proxy-map.ts`, never by a blanket strip of
`/v1` (round 4 found that strip 404-ing every ride-service, payment-service
and delivery-service call). Identity headers are identical under every
mapping.

| Service               | Gateway rules                                                                                                    | Arrives as                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| user-service          | `/auth`, `/users`, `/devices`, `/identity`, `/webhooks/telco`, `/drivers/me/documents\|eligibility`, `/mandates` | `/v1` stripped (`/v1/users/me` → `/users/me`)                                                                  |
| ride-service          | `/rides`, `/drivers`, `/locations`, `/mp`, `/admin/mp`                                                           | unchanged (`/v1/mp/quote`)                                                                                     |
| ask-service           | `/ask`                                                                                                           | unchanged (`/v1/ask/threads`)                                                                                  |
| payment-service       | `/wallet` (+ unbacked `/wallets`, `/payments`, `/transactions`)                                                  | unchanged (`/v1/wallet/mp/overview`)                                                                           |
| delivery-service      | `/delivery` (+ unbacked `/packages`)                                                                             | `/api/v1` base, `/delivery` removed (`/v1/delivery/deliveries/:id/custody` → `/api/v1/deliveries/:id/custody`) |
| notification-service  | `/notifications`                                                                                                 | `/api/v1` base (`/api/v1/notifications`)                                                                       |
| food-service          | `/restaurants`, `/menus` (+ unbacked `/food`)                                                                    | `/v1` stripped                                                                                                 |
| travel-service        | `/travel/{flights,stays,carts,orders,refunds,trips}`, `/reservations`, `/ops/travel`                             | unchanged; `/v1/travel/webhooks/*` (suppliers) and `/internal/ask/*` are never proxied                         |
| user-service (org)    | `/organizations`                                                                                                 | `/v1` stripped (signed context only)                                                                           |
| payment-service (biz) | `/business`                                                                                                      | unchanged (`/v1/business`); the internal `/v1/finance/business` is never proxied                               |
| fleet-service         | `/fleets`, `/fleet-offers`, `/drivers/me/{fleet,fleet-offers,schedule,availability,conflicts}`                   | fleet-service's client routes; `/internal/fleet` is never proxied                                              |

- **Proof, not convention.** ride-service and delivery-service walk their
  production chi routers into `internal/handler(s)/routes.manifest`
  (`routes_manifest_test.go`); payment-service reads its Hono route table into
  `tests/routes.manifest` (`tests/routes-manifest.test.ts`). Each fails when
  stale and names the `UPDATE_ROUTE_MANIFEST=1` command. The gateway's
  `tests/route-contract.test.ts` maps representative client paths through the
  real mapping and the real app and requires each to land on a manifest route;
  every proxy rule must be covered or declared unbacked with a reason.
- **Delivery custody through the gateway.** The rider app's custody timeline
  and return consent (`/v1/delivery/deliveries/:id/custody[...]`) now reach
  delivery-service's gateway-identity custody group. The legacy delivery CRUD,
  driver and webhook routes behind the same rule still authenticate with the
  service's own JWT / service key, which the gateway does not forward.
- **Not proxied at all (gateway 404):** growth-service (`/v1/benefits`,
  `/v1/referrals`, `/v1/attribution`, `/v1/driver`, `/v1/growth`,
  `/v1/ai/marketing`), config-service (`/v1/config`, `/v1/flags`), `/v1/kyc`,
  `/v1/ops/*` other than `/v1/ops/travel`, and every service's `/internal/*`
  and service-key webhook surface. travel-service has been proxied since
  round 6 (route manifest `services/travel-service/tests/routes.manifest`).
  Adding a rule is a scope decision (see `identity/scopes.ts`) and is pinned by
  the contract test's unproxied list.
- **Ask streamed turn and `PROXY_TIMEOUT`.** The gateway buffers every
  downstream body before answering, including ask-service's
  `text/event-stream` message turn, and `PROXY_TIMEOUT` (default 30 s) covers
  the whole exchange. A turn is up to `maxToolLoops` (6) model calls, each
  bounded by the model provider's 20 s default timeout, so a long turn is
  answered `504 GATEWAY_TIMEOUT` and the client sees no event until the turn
  ends. Until the proxy streams the body through, raise `PROXY_TIMEOUT` on the
  gateway toward, but below, Caddy's 120 s `read_timeout`; a turn longer than
  that cannot complete through the edge.
- **Every rule needs its service URL.** The gateway falls back to
  `localhost` defaults when a `*_SERVICE_URL` is unset; the production compose
  file must set `ASK_SERVICE_URL` (and any other service it proxies) or those
  rules answer 503.

## Relays and delegations (a service acting for one user)

A service that calls another on a user's behalf presents THAT user's proof,
never its own key as a user, and never an identity taken from a request body
or a model's tool arguments.

- **ask-service → travel-service: the identity relay** (round 7). Every
  request-scoped assistant travel call RELAYS the gateway-signed
  `x-ubi-identity` token the user's own request arrived with, byte for byte,
  with the city mirrors the gateway wrote from its claim and the request id
  (`services/ask-service/src/lib/identity-relay.ts`,
  `src/ports/travel-port.ts`). No plain `X-User-ID` / `X-User-Role` and no
  `X-Service-Key` go with it in production. A relay for a user other than the
  one being acted for, or no relay at all in production (a background sweep),
  is refused by the port before anything is sent. travel-service verifies the
  token like any client's: past its 120 s lifetime it answers 401 (reported
  as `unauthorized`); a context it accepts but does not ALLOW — its
  `travel:book` re-check, limited mode, a city mismatch — answers 403, which
  the port reports as the permission refusal it is (`limited_mode` /
  `forbidden` with a reason the assistant can explain), never as
  `service_unavailable` (round 8).
- **ask-service → travel-service: the background read.** A sweep with no user
  behind it reads ONE order ask-service booked under ONE action grant at
  `GET /internal/ask/grants/:grantId/orders/:orderId` with
  `X-Service-Key = TRAVEL_ASK_SERVICE_KEY` — the same value on both services,
  at least 32 characters, compared in constant time; unset or short closes the
  route (503). The owner is taken from the order and checked against ask's
  execution record (`services/travel-service/src/routes/internal-ask.ts`).
- **ask-service → ride-service** (round 1) and **travel-service →
  ride-service** (airport transfers, round 5) sign a ride-service HMAC context
  for the one user they act for with `RIDE_INTERNAL_CONTEXT_SECRET`; the
  gateway is not in that path, and ride-service verifies it exactly as a
  gateway-signed context. ride-service's rate limiter counts such a
  delegation against the user it acts for.
- **ask-service → user-service grants** (`AI_GRANTS_SERVICE_KEY`) mint and
  consume action grants for the signed-in user; the user comes from ask's
  verified request, never the model.

## Public routes with no user identity: the passenger trip link

Book for another adult (round 6–7): the passenger is not a UBI user and
follows a link carrying a scoped, expiring, revocable trip access token. The
gateway forwards exactly three routes WITHOUT a bearer token, matched by
method and exact path ahead of the authenticated `/v1` group
(`services/api-gateway/src/routes/trip-access.ts`):

| Route                             | Forwarded headers                                        |
| --------------------------------- | -------------------------------------------------------- |
| `GET /v1/mp/trip-access`          | `x-trip-access-token`, `x-request-id`, `x-forwarded-for` |
| `GET /v1/mp/trip-access/pin`      | same                                                     |
| `POST /v1/mp/trip-access/decline` | same + `idempotency-key` (ride-service requires it)      |

Nothing else crosses: no Authorization, no `x-ubi-identity`, no mirror, no
city, no scopes, no body. The gateway rate-limits each call per client
address before forwarding (no shared bucket) and forwards the ONE address it
limited on, so ride-service's own per-client and per-token limits see the
passenger. Answers carry `Cache-Control: no-store` and
`Referrer-Policy: no-referrer`. ride-service authenticates each call by the
token alone (`internal/handler/marketplace_guest.go`). Anything else under
`/v1/mp/trip-access…` falls through to the authenticated group.

The link itself reaches the passenger only by SMS from notification-service,
out of the `trip_access.issued` event's sealed envelope (AES-256-GCM, AAD
`ubi.trip_access.v1|<tokenId>`): `TRIP_ACCESS_DELIVERY_KEY` /
`TRIP_ACCESS_DELIVERY_KID`, with a `TRIP_ACCESS_DELIVERY_KEY_PREVIOUS` /
`_KID_PREVIOUS` pair for rotation (selected by kid), and
`PASSENGER_TRIP_LINK_BASE_URL` (the token rides in a URL fragment). Without a
key in production the consumer does not start and nothing is sent.

## Business scopes

Business travel (rounds 6–7) adds three gateway scopes
(`services/api-gateway/src/identity/scopes.ts`); authority INSIDE an
organization (owner / admin / booker / traveller) is the owning service's own
membership check — the scopes only decide whether the session may ask.

| Scope             | Routes                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `business:read`   | `GET /v1/organizations…` (user-service), `GET /v1/business…` (payment-service)                                       |
| `business:manage` | writes to `/v1/organizations…`: create, members, invitations (incl. accept / decline), cost centres, policy, billing |
| `business:fund`   | writes to `/v1/business…`: top-ups, budget allocations and returns (organization money)                              |

None of them survives limited mode (reads included: an organization's
bookings are other people's travel), and `business:fund` is also withdrawn in
wallet safe mode. payment-service's `/v1/finance/business` (ride-service
reserving and committing a trip against a budget, by service key) is not
proxied at all.

## Internal service-key surfaces

Service keys authenticate SERVICES on routes the gateway never proxies (or,
where the gateway's rule would reach the path, deletes `X-Service-Key` from
every forwarded request, so a client can never present one). Every key below
is compared in constant time and fails CLOSED: unset (or, where stated, short
or the committed default) refuses the route rather than opening it.

| Surface                                                                                                                              | Caller → callee                 | Key                                                                                                                                          | Unset / weak key                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| delivery-service `POST /api/v1/webhooks/marketplace-assign` (award hand-off, idempotent on `awardId`)                                | ride-service → delivery-service | delivery's `INTERNAL_SERVICE_KEY`; ride-service sends `DELIVERY_SERVICE_KEY` (default: its `INTERNAL_SERVICE_KEY`) to `DELIVERY_SERVICE_URL` | 503 `SERVICE_KEY_NOT_CONFIGURED` (empty or committed default); production boot refuses |
| delivery-service `POST /api/v1/webhooks/marketplace-cancel` (queued-award compensation, round 8)                                     | ride-service → delivery-service | same                                                                                                                                         | same                                                                                   |
| ride-service `/internal/fleet/*` (fleet calendar contract A, routes 1–7: occupancy, calendar, swaps)                                 | fleet-service → ride-service    | `FLEET_RIDE_SERVICE_KEY` (≥ 32 characters, same value on both)                                                                               | 503                                                                                    |
| fleet-service `GET /internal/fleet/drivers/:driverId/vehicle-at`, `GET /internal/fleet/vehicles/:vehicleId` (contract A, routes 8–9) | ride-service → fleet-service    | `FLEET_SERVICE_KEY` (≥ 32; ride-service calls `FLEET_SERVICE_URL`)                                                                           | 503                                                                                    |
| fleet-service `GET /internal/fleet/settlement-inputs` (contract B, remittance inputs)                                                | payment-service → fleet-service | `FLEET_PAYMENT_SERVICE_KEY` (≥ 32)                                                                                                           | 503                                                                                    |
| travel-service `GET /internal/ask/grants/:grantId/orders/:orderId`                                                                   | ask-service → travel-service    | `TRAVEL_ASK_SERVICE_KEY` (≥ 32)                                                                                                              | 503                                                                                    |
| user-service `GET /internal/driver-profiles`                                                                                         | ride-service → user-service     | `DRIVER_PROFILE_RIDE_SERVICE_KEY`                                                                                                            | refused (`unauthorized`); keys < 32 characters count as unset                          |
| user-service grant + mandate-run surface (`/internal/*`)                                                                             | ask-service → user-service      | `AI_GRANTS_SERVICE_KEY`                                                                                                                      | refused (`unauthorized`); keys < 32 characters count as unset                          |
| payment-service `/v1/finance/*` (travel, business budgets, delivery returns)                                                         | services → payment-service      | `INTERNAL_SERVICE_KEY`                                                                                                                       | every request refused                                                                  |

The fleet contracts are specified in `contracts/openapi/marketplace-fleet-internal.yaml`
and `packages/contracts/src/marketplace-fleet.ts`; switching the `fleet` flag
off in a city stops new fleet activity, never ride-service's revalidation of
existing bookings or the settlement of terms a driver already signed.

## Trusted proxies and rate-limit keys (who the client is)

`X-Forwarded-For` and `X-Real-IP` are client-writable. Every service that
rate-limits per client believes them ONLY from the proxies its own variable
lists; unset — the default — trusts no one, and the socket peer is the
client. The rules are the same everywhere: comma-separated IP addresses
and/or CIDR ranges (an entry that parses as neither is ignored and logged —
trusting less, never more); the chain is walked from the RIGHT, skipping
trusted hops, and the first untrusted address is the client, so entries a
client prepends are never reached; `X-Real-IP` is read only when the chain
names no client; `True-Client-IP` is never read; IPv4 clients are counted per
host and IPv6 per /64; there is no shared fallback bucket.

| Variable                       | Service              | List                                             | Who else is not counted per client                                                                                                 |
| ------------------------------ | -------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GATEWAY_TRUSTED_PROXIES`      | api-gateway          | the ingress (Caddy / load balancer) addresses    | —                                                                                                                                  |
| `PAYMENT_TRUSTED_PROXIES`      | payment-service      | the ingress and the api-gateway                  | a valid `X-Service-Key` is not throttled; a verified `x-ubi-identity` is counted as its user                                       |
| `RIDE_TRUSTED_PROXIES`         | ride-service         | the api-gateway (and any ingress in front of it) | a verified ride context — gateway-signed or an ask / travel delegation — is counted as its user                                    |
| `DELIVERY_TRUSTED_PROXIES`     | delivery-service     | the api-gateway (and any ingress in front of it) | a valid, usable `X-Service-Key` (marketplace assign / cancel) is not throttled; a verified custody identity is counted as its user |
| `NOTIFICATION_TRUSTED_PROXIES` | notification-service | the api-gateway                                  | see `services/notification-service/src/middleware/rate-limit.ts`                                                                   |

A forged service key or a context that does not verify is never exempt: it
is counted against the address it came from, and the route's own
authentication still refuses it. Set each list in production — without it,
every client behind the gateway is one client downstream.

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
