# Hetzner pilot — round 9 runbook deltas

What changed in the pilot's deploy configuration in round 9, what an operator
does differently because of it, and what was verified here. Read with
[`docs/deploy/HETZNER_PILOT.md`](../deploy/HETZNER_PILOT.md) (the runbook this
amends; where the two disagree, this page is newer) and
[`DEPLOY_ENV_MATRIX.md`](DEPLOY_ENV_MATRIX.md) (every variable, its class and
source).

**Configured, not deployed, not enabled.** Everything below is configuration in
the repository. No host ran it, no image was pushed, and no feature flag or
capability switch was turned on: flags stay deny-by-default in config-service,
and capabilities keyed by an optional secret stay closed until an operator sets
the key.

## 1. What the stack now contains

| Service                                        | Before round 9                                                               | Now                                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ask, travel, fleet, growth                     | no Dockerfile, not in compose                                                | Dockerfiles (workspace-aware, non-root, HEALTHCHECK) and compose entries                   |
| config, support, realtime-gateway              | broken Dockerfiles, not in compose                                           | fixed Dockerfiles and compose entries (user-service's identity routes need config-service) |
| api-gateway, user, food, payment, notification | Dockerfiles missed workspace packages / copied a non-existent `.prisma` path | fixed (below)                                                                              |
| ride, delivery (Go)                            | Dockerfiles only built from the service directory; ride on Go 1.21, cgo off  | build from the repository root like compose does; ride on Go 1.24 with cgo (h3-go)         |
| web-app, admin-dashboard                       | referenced by compose, **no Dockerfile existed**                             | Dockerfiles (`next build` / `next start`)                                                  |
| Caddy                                          | stock `caddy:2-alpine`, which refuses the Caddyfile                          | `caddy/Dockerfile`: Caddy 2.8.4 + caddy-ratelimit v0.1.0; dedicated supplier-webhook host  |
| Postgres                                       | `postgis/postgis:15-3.4-alpine`, init script failed on line 1                | `postgis/postgis:16-3.4-alpine` (what CI migrates against); init script fixed              |

Public surface: unchanged except the new webhooks host. growth, config,
support and realtime-gateway have **no public route** (the gateway does not
proxy them; Caddy has no site for them). growth-service still reads its caller
from a plain `X-User-ID` header, so it must stay unreachable from outside
`ubi-network` until it verifies the signed context.

## 2. Defects found and fixed (each would have stopped the pilot)

1. **ride-service could not boot**: it refuses to start without
   `RIDE_QUOTE_SIGNING_SECRET` (≥ 32 bytes, `internal/move/quote.go`), which
   compose never set. Now required in `.env`.
2. **ride-service could not build**: `CGO_ENABLED=0` with `github.com/uber/h3-go`
   (cgo-only) fails with "build constraints exclude all Go files"; the image also
   pinned Go 1.21 against a `go 1.24` module and assumed the service directory as
   build context. location-service had the same cgo/context defects plus a binary
   in `/root/` its non-root user could not read. Both cgo images now pin the
   builder and runtime to the same Alpine release (3.22): the binary links the
   builder's musl, which must not be newer than the runtime's (the floating
   `golang:1.24-alpine` is Alpine 3.23; the runtime was `alpine:3.19`).
3. **Caddy could not start**: `rate_limit` is not a stock Caddy directive
   (`caddy adapt` with stock 2.8.4: `Caddyfile:82: unrecognized directive:
rate_limit`). The custom image keeps the rate limit as designed.
4. **web-app and admin-dashboard would have gone 503 after 30 s**: Caddy's active
   health check probed `/api/health`, which neither app serves; a failing check
   marks the only upstream down. Now `/` (web-app) and `/login` (admin).
5. **Postgres initialisation failed on first boot**: `init-db.sql` began with `#`
   lines, which psql rejects (`syntax error at or near "#"`, exit 3 under
   `ON_ERROR_STOP`). A restart then skips the script for good, leaving the
   database without `postgis` / `btree_gist`. Its grants also named
   `ubi_production` / `ubi` literally, so a `.env` with another `POSTGRES_DB` or
   `POSTGRES_USER` failed the same way; they now use the connected database and
   user.
6. **Node images did not build**: the old Dockerfiles copied neither
   `packages/contracts`, `packages/outbox`, `packages/config-client` nor the two
   config packages, installed the whole lockfile against a handful of manifests,
   and COPYed a root `node_modules/.prisma` that pnpm never creates. The
   notification-service pattern (08a886a) is now used everywhere.
7. **The production prune silently pruned nothing**: `pnpm install --prod` after a
   full install asks before recreating modules directories; with no TTY the
   question ends the step with exit 0 and nothing done. With the purge
   pre-confirmed, the root `prepare` (husky) then fails. All images now pass
   `--config.confirmModulesPurge=false --ignore-scripts`.
8. **HEALTHCHECK ports**: api-gateway probed 4000, payment 4005, ride 4003,
   delivery 4004 while compose runs them on 3000/3005/3002/3004. Every
   HEALTHCHECK now probes `${PORT:-<code default>}`.
9. **Missing service configuration**: notification-service had neither
   `JWT_SECRET` (user routes 500) nor `INTERNAL_SERVICE_KEY` (service routes
   refused); user-service had no `CONFIG_SERVICE_URL` (identity routes throw);
   food-service had no `JWT_SECRET`/`INTERNAL_SERVICE_KEY`/`PAYMENT_SERVICE_URL`;
   the gateway had no ask/travel/fleet URLs (those routes would 503); no service
   had its trusted-proxy list (every client behind the gateway counted as one).
   Notification provider names did not match the code (`FIREBASE_PRIVATE_KEY`,
   `TWILIO_PHONE_NUMBER` → `FIREBASE_SERVICE_ACCOUNT`, `TWILIO_FROM_NUMBER`).
10. **`deploy.sh` migrated nothing and carried on**: it ran prisma inside the
    api-gateway image (no CLI, no migrations) and only warned on failure. It now
    runs the `migrate` tool service and stops the deploy if it fails.
11. **MinIO could not be pulled**: `minio/minio:latest` no longer exists on
    Docker Hub (the registry answers 401 for `minio/minio` and `minio/mc`).
    Now `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` (pinned; the image
    still carries `curl` for the existing healthcheck and `mc`), and
    `quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z` for `minio-init`.
12. **Browsers could not call the API cross-origin**: the API host answered
    every `OPTIONS` itself with `Access-Control-Allow-Origin: https://$DOMAIN`
    and only `Authorization, Content-Type, X-Requested-With`, so the gateway's
    own CORS (web and admin origins; `Idempotency-Key`, `X-City-ID`,
    `X-Trip-Access-Token`) never ran: every admin-dashboard call, the passenger
    trip-link page and every web POST with an idempotency key were refused by
    the browser. Caddy now proxies preflights to the gateway like any request.

## 3. Operator steps that change

Pre-deploy (in addition to `HETZNER_PILOT.md` §3–§4):

1. **DNS**: also point `WEBHOOKS_DOMAIN` (default `hooks.$DOMAIN`) at the host.
2. **Secrets**: `cp .env.example .env`, then generate every required secret
   (`openssl rand -base64 48 | tr -d '\n'`), each its own value:
   `JWT_SECRET`, `JWT_REFRESH_SECRET`, `UBI_IDENTITY_SECRET`,
   `RIDE_INTERNAL_CONTEXT_SECRET`, `INTERNAL_SERVICE_KEY`,
   `RIDE_QUOTE_SIGNING_SECRET`, `RIDE_PIN_VAULT_SECRET`,
   `DRIVER_PROFILE_RIDE_SERVICE_KEY`, `AI_GRANTS_SERVICE_KEY`,
   `TRAVEL_ASK_SERVICE_KEY`, `FLEET_SERVICE_KEY`, `FLEET_RIDE_SERVICE_KEY`,
   `FLEET_PAYMENT_SERVICE_KEY`. The new service keys are empty in
   `.env.example` on purpose: compose refuses to start until they are set, and a
   placeholder long enough to pass a service's length check can never slip
   through.
3. **Preflight**: `./scripts/deploy.sh preflight` — compose interpolates, no
   `CHANGE_ME` left, every required secret ≥ 32 characters, the trust-boundary
   secrets pairwise distinct, the build list matches compose. `deploy` runs it
   first and stops on failure.
4. **Proof bucket** (before delivery custody proofs are used): set
   `PROOF_STORAGE_ACCESS_KEY` / `PROOF_STORAGE_SECRET_KEY`, bring MinIO up, then
   `docker compose -f docker-compose.prod.yml --profile tools run --rm minio-init`
   (private bucket + a MinIO user limited to it: get/put/delete on its objects,
   list + read-policy on the bucket — exactly what delivery-service's proof
   store and its readiness check call; never put-policy). Until then
   delivery-service refuses proof uploads and reports not-ready in production —
   correct while marketplace delivery is unused.
5. **Supplier webhooks** (only when a supplier is actually configured): register
   `https://$WEBHOOKS_DOMAIN/v1/travel/webhooks/<supplierId>` with the supplier,
   and inject its secrets as `TRAVEL_SECRET_<REF>` through a host-local compose
   override (never in the repository).

Bring-up order (replaces `HETZNER_PILOT.md` §4 steps 1–4):

```
./scripts/deploy.sh preflight
docker compose -f docker-compose.prod.yml build            # 17 images
docker compose -f docker-compose.prod.yml up -d postgres redis minio
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml up -d            # the rest; Caddy last
```

`./scripts/deploy.sh deploy` performs the same sequence (plus the pre-deploy
backup).

**The network definition changed** (fixed addresses for Caddy `172.28.0.10` and
the gateway `172.28.0.11`, dynamic addresses from `172.28.1.0/24`). An existing
`ubi-network` keeps its old IPAM settings: run `docker compose down` (named
volumes are kept) before the first `up` with this file.

**Postgres 16**: a data directory initialised by 15 cannot be opened by 16. The
pilot has not been deployed, so this applies to a fresh volume. If a 15 volume
exists anywhere, dump it with the old image and restore into 16 (`pg_dump` /
`psql`, `HETZNER_PILOT.md` §6) — do not point 16 at it.

## 4. Supplier webhooks ingress

Caddy site `{$WEBHOOKS_DOMAIN}` accepts exactly `POST /v1/travel/webhooks/<id>`
and proxies it straight to `travel-service:4012`; everything else is a 404,
bodies over 1 MB are refused (413), and the gateway's reserved identity headers
(`X-UBI-*`, `X-Auth-*`, `X-User-*`, `X-Session-Id`, `X-Internal-Service`,
`X-Service-Key`) are removed before forwarding. The body is forwarded byte for
byte, so the supplier's own signature (`X-Duffel-Signature`, LiteAPI's
`authorization`) still verifies in travel-service. The API host's routing is
unchanged (only its CORS preflight short-circuit was removed, §2 item 12) — the
gateway never proxies `/v1/travel/webhooks/*` (it answers 404 there).

## 5. Trusted proxies

The client address is believed from `X-Forwarded-For` only when the socket peer
is listed. Caddy (`172.28.0.10`) is the only proxy the gateway trusts; the
services behind the gateway trust the gateway **and** Caddy, because the
gateway forwards `X-Forwarded-For: <client>, <caddy>` (the chain is walked from
the right, so a list without Caddy would count every client as Caddy). Keep
Docker's default iptables port publishing (it preserves the client source
address); with the userland proxy (e.g. IPv6 without `ip6tables`) every client
arrives as the bridge gateway and must not be trusted. If a load balancer is
ever put in front of Caddy, add its address to `GATEWAY_TRUSTED_PROXIES`.

## 6. Connection budget

Postgres allows 100 connections by default. Each Prisma client opens up to
`2 × vCPU + 1` connections unless `connection_limit` is set; ride-service and
delivery-service each allow 25 (pgx). The round-9 services therefore carry
`connection_limit` (ask, travel, fleet 10; config, growth, support 5 — 45 in
total); user, food, payment and notification stay unbounded as before
(api-gateway and realtime-gateway do not connect). On a CX41 (8 vCPU) the
worst case is 4 × 17 + 25 + 25 + 45 = 163 — above 100, as the pre-round-9
stack (118) already was. **Estimate, pending measurement.** Before load
testing, either set `connection_limit` on the older services or raise
`max_connections` (`init-db.sql` has the commented setting), and record the
choice here.

## 7. Memory

The seven added services reserve 512 MB and are limited to 2 GB in total; the
compose limits now sum to roughly 10 GB. CX41 (16 GB) remains the practical
floor — a sizing-table inference, not a measurement.

## 8. Kubernetes

Not the pilot. Only `infrastructure/kubernetes/services/api-gateway` exists; its
Deployment now carries `ASK_SERVICE_URL`, `TRAVEL_SERVICE_URL`,
`FLEET_SERVICE_URL`, `GATEWAY_TRUSTED_PROXIES` (ConfigMap, dev VPC CIDR as the
widest safe default), the identity secrets from an externally provisioned
`api-gateway-secrets` Secret and `REDIS_URL` (the gateway never read the
`REDIS_HOST/PORT/PASSWORD` triple). No other service was given a manifest.
`.github/workflows/deploy.yml` (the ECS track) still builds from the service
directory (`cd services/<svc> && docker build .`), which does not match the
repository-root context every Dockerfile now uses — see "Open items".

## 9. Verification performed here

No Docker daemon was available (the CLI and `docker compose` were; starting a
daemon was not permitted), so no `docker build` ran. Instead:

| Check                                                                                                                                                                                                                                          | Result                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose -f infrastructure/hetzner/docker-compose.prod.yml --env-file <filled scratch env> config -q`                                                                                                                                   | exit 0; 24 services (+ `migrate`, `minio-init` under `--profile tools`). With `.env.example` as-is it refuses (`FLEET_PAYMENT_SERVICE_KEY is required`), as designed.                                                                       |
| `node infrastructure/scripts/check-dockerfiles.mjs`                                                                                                                                                                                            | 17 / 17 Dockerfiles pass. The same checker over the HEAD versions of the 11 pre-existing Dockerfiles: 0 / 11.                                                                                                                               |
| **Dockerfile replay** (scratch tool): each Dockerfile's COPY/RUN sequence executed in per-stage directories holding only what the file copies, then the production-stage layout booted in production mode against a scratch database and Redis | All 14 composed backends built and answered `GET /health` 200 in production mode (ride-service: `environment: production`, database and Redis connected). The web apps' `next build` was not replayed (memory); they pass the static check. |
| `node infrastructure/scripts/check-compose-env.mjs`                                                                                                                                                                                            | PASS — 16 services, 165 classified variables. Against the HEAD compose file: 45 problems (among them the missing `RIDE_QUOTE_SIGNING_SECRET`, `CONFIG_SERVICE_URL`, notification `JWT_SECRET`).                                             |
| `caddy validate` with Caddy 2.8.4 + caddy-ratelimit v0.1.0                                                                                                                                                                                     | Valid configuration. Stock 2.8.4 rejects it (`unrecognized directive: rate_limit`).                                                                                                                                                         |
| Webhook ingress exercised on a local Caddy against an echo upstream                                                                                                                                                                            | signed POST forwarded with body intact and no identity headers; GET, other paths, `..` traversal → 404; 1.1 MB body → 413.                                                                                                                  |
| `init-db.sql` through `psql -v ON_ERROR_STOP=1` (in a rolled-back transaction)                                                                                                                                                                 | HEAD: exit 3 at line 1. Fixed: exit 0.                                                                                                                                                                                                      |
| `deploy.sh preflight`                                                                                                                                                                                                                          | Passes a filled env; fails `.env.example` (CHANGE_ME lines, short keys, compose interpolation) and a shared secret pair.                                                                                                                    |
| `kustomize build` + `kubeconform -strict -kubernetes-version 1.29.0`                                                                                                                                                                           | base 46/46 valid; services/api-gateway 5/5 valid.                                                                                                                                                                                           |
| Every image reference resolved against its registry (Docker Hub / quay.io manifests)                                                                                                                                                           | All resolve (Prometheus: rate-limited by Docker Hub, not missing). `minio/minio` / `minio/mc` on Docker Hub: 401 — hence quay.io.                                                                                                           |

The replay ran against the working tree at the time, which included other
round-9 slices' uncommitted service changes; a real `docker build` on the
committed tree remains the acceptance step.

Independent verification (same constraints, no Docker daemon):

| Check                                                                                                        | Result                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replay of `apps/web-app` and `apps/admin-dashboard` Dockerfiles, then `next start` from the production stage | Both `next build`s succeed from exactly the copied files; web-app `/` and `/trip-link` 200, admin `/login` 200 (`/` 307), i.e. the Caddy and HEALTHCHECK probes hold.                                                                                                   |
| Replay of `services/fleet-service`, production boot with its compose environment                             | `/health` and `/health/ready` 200; the service's own `node_modules` pruned to runtime dependencies; the generated Prisma client present in the production stage.                                                                                                        |
| `minio-init`'s policy on a local MinIO, then delivery-service (`UBI_ENV=production`) with that user's keys   | The first version (object get/put only) left `/health/ready` 503 (`proof bucket ... is unreachable: Access Denied`: HeadBucket and GetBucketPolicy denied) and could not delete a rejected upload. Fixed policy: 200.                                                   |
| `deploy.sh preflight` with a `.env` that omits a key                                                         | The first version aborted silently mid-check (a non-matching grep under `set -e -o pipefail`), and `load_env` did the same for a valid `.env` without `POSTGRES_USER`. Fixed: the key reads as empty and is reported.                                                   |
| API host `OPTIONS` on a local Caddy (plugin build) against an echo upstream                                  | Before: Caddy itself answered an admin-origin preflight (`Allow-Origin: https://ubi.africa`, three headers). After: proxied to the upstream; the gateway's own preflight test (`services/api-gateway/tests/travel-proxy.test.ts`) passes for the web and admin origins. |
| `init-db.sql` in a rolled-back transaction on a database not named `ubi_production`                          | The first version stopped at `GRANT ... ON DATABASE ubi_production` (exit 3); now exit 0.                                                                                                                                                                               |

## 10. Open items (not configuration, or outside this slice)

- **user-service → notification-service OTP SMS**: user-service's client sends
  `Authorization: Bearer $SERVICE_API_KEY`; notification-service's service routes
  take `X-Service-Key`. OTP SMS cannot authenticate whatever is configured.
- **`.github/workflows/deploy.yml`** must build with
  `docker build -f services/<svc>/Dockerfile .` from the repository root.
- **`docker/docker-compose.realtime.yml`** builds with contexts relative to
  `docker/` that do not exist; it was already broken.
- **No `.dockerignore` at the repository root.** The Dockerfiles name every file
  they copy, so none is needed for correctness; the per-service `.dockerignore`
  files are not consulted when the context is the root.
- **realtime-gateway** declares no `@ubi/typescript-config` devDependency; it
  builds because pnpm links the root project's copy.
- The capacity measurement and restore drill of `HETZNER_PILOT.md` remain open.
