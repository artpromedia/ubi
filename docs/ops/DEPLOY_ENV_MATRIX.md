# Deployment environment matrix — Hetzner pilot stack

Every environment variable the services built by
`infrastructure/hetzner/docker-compose.prod.yml` read, who reads it, whether
production needs it, and where its value comes from. Round 9 (deploy
configuration only). The runbook changes that go with it are in
[`PILOT_RUNBOOK_DELTAS.md`](PILOT_RUNBOOK_DELTAS.md).

## Configured, deployed, enabled

| State          | Meaning                                                                                    | Round 9                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Configured** | The compose file, `.env.example`, Dockerfiles, Caddyfile and scripts describe the service. | **All 14 backend services, both web apps, Caddy (with the supplier-webhook ingress), MinIO proof bucket.** ask, travel, fleet, growth, config, support and realtime-gateway are new in the compose file.                                                        |
| **Deployed**   | A real host runs that configuration.                                                       | **Nothing.** No host, no `docker compose up`, no image pushed. No Docker daemon was available here (see "Verification" in the runbook deltas).                                                                                                                  |
| **Enabled**    | A feature flag (config-service, deny-by-default) or a capability switch is on for a city.  | **Nothing.** No flag is set by any file here. Capabilities keyed by an optional secret (guest trip link, proof storage, supplier credentials, payment rails, the model endpoint) stay closed until an operator sets the key, and even then the flag gates them. |

## How this is checked

```
node infrastructure/scripts/check-compose-env.mjs      # this matrix vs compose vs the code
node infrastructure/scripts/check-dockerfiles.mjs      # every Dockerfile vs the workspace
infrastructure/hetzner/scripts/deploy.sh preflight     # a real .env, before a deploy
```

`check-compose-env.mjs` holds the machine-readable classification (`CONTRACT`)
this page describes. It reads what each service's shipped code reads (Node:
files reachable from `src/index.ts` plus runtime workspace packages; Go: `cmd/`
and `internal/`), and fails when the code reads a variable nobody classified,
when a `required` variable is not enforced by compose, when a deliberately
`unset` variable appears in compose, when compose sets a name no code reads,
when a compose interpolation is undocumented in `.env.example`, or when this
page stops naming a classified variable.

## Classes and sources

| Class    | Production                                                                                   |
| -------- | -------------------------------------------------------------------------------------------- |
| required | Must be set. Compose sets a literal or `${VAR:?}` and refuses to start without it.           |
| set      | Set by compose (URL, address list, interval); a default is fine.                             |
| optional | May be empty; empty means a safe code default or a closed surface (named below).             |
| unset    | Deliberately **not** configured: a deny-by-default switch, a dev bypass, or no backend here. |
| dev      | Development / test only; never in compose.                                                   |
| unread   | Set by compose for compatibility; no code reads it.                                          |

Sources: **.env** = an operator secret or setting in `infrastructure/hetzner/.env`
(template `.env.example`); **compose** = a literal in the compose file;
**compose default** = a compose default an operator may override in `.env`;
**code** = the service's own default.

Service ports on `ubi-network` (compose sets `PORT` explicitly for each):
api-gateway 3000 (fixed address 172.28.0.11), user 3001, ride 3002, food 3003,
delivery 3004, payment 3005, notification 3006, config 3010, realtime-gateway
4010, support 4011, travel 4012, ask 4013, growth 4014, fleet 4015; web-app and
admin-dashboard 3000; Caddy 172.28.0.10.

## 1. Runtime basics

| Variable              | Services                                     | Class                                       | Source          | Notes                                                                                                                              |
| --------------------- | -------------------------------------------- | ------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`            | every Node service, web-app, admin-dashboard | required                                    | compose         | `production`. ride-service only falls back to it for `UBI_ENV` (unset there).                                                      |
| `UBI_ENV`             | ride, delivery (travel also honours it)      | required (Go)                               | compose         | `production` — what arms the Go services' fail-closed boot checks.                                                                 |
| `ENVIRONMENT`         | ride, delivery                               | unread                                      | compose         | Historical; kept, never read.                                                                                                      |
| `ENV`                 | delivery                                     | unset                                       | —               | Old fallback for `UBI_ENV`.                                                                                                        |
| `PORT`                | every backend                                | set                                         | compose         | See the port list above; Dockerfile HEALTHCHECKs probe `${PORT:-default}`.                                                         |
| `LOG_LEVEL`           | every Node service                           | set (Go: unread)                            | compose default | `info`.                                                                                                                            |
| `DATABASE_URL`        | every service except realtime-gateway        | required (gateway: unread; realtime: unset) | compose         | Built from `POSTGRES_*`. Go URLs use `?sslmode=disable` (pgx rejects `schema=`); the round-9 Node services add `connection_limit`. |
| `REDIS_URL`           | every backend                                | required                                    | compose         | Built from `REDIS_PASSWORD`.                                                                                                       |
| `SERVICE_VERSION`     | food, delivery                               | optional                                    | code            | Reported by `/health`.                                                                                                             |
| `npm_package_version` | Node services                                | dev                                         | —               | Set by the package manager in development only.                                                                                    |

## 2. Internal trust boundary (docs/security/INTERNAL_IDENTITY.md)

| Variable                           | Services                                                                                            | Class    | Source | Notes                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                       | api-gateway, user, food, delivery, notification, realtime-gateway                                   | required | .env   | Client session key. Never equal to `UBI_IDENTITY_SECRET` (the gateway refuses).                                                                    |
| `JWT_REFRESH_SECRET`               | api-gateway                                                                                         | unread   | .env   | In compose since before round 9; no code reads it.                                                                                                 |
| `UBI_IDENTITY_SECRET`              | api-gateway (signs); user, payment, ask, travel, fleet (verify)                                     | required | .env   | travel and fleet refuse to boot without it; payment answers 503 rather than trust an unsigned header.                                              |
| `UBI_IDENTITY_SECRET_PREVIOUS`     | same verifiers                                                                                      | optional | —      | Rotation only.                                                                                                                                     |
| `UBI_IDENTITY_KEY_ID`              | api-gateway                                                                                         | optional | —      | Rotation `kid`.                                                                                                                                    |
| `UBI_IDENTITY_KEY_ID_PREVIOUS`     | api-gateway                                                                                         | optional | —      | Rotation `kid`.                                                                                                                                    |
| `RIDE_INTERNAL_CONTEXT_SECRET`     | api-gateway, ask, travel (sign); ride, delivery (verify)                                            | required | .env   | ride, delivery, ask and travel refuse to boot in production without it. Comma list for rotation.                                                   |
| `RIDE_INTERNAL_CONTEXT_MAX_AGE_MS` | ride                                                                                                | optional | code   | 5 min.                                                                                                                                             |
| `RIDE_ALLOW_UNSIGNED_IDENTITY`     | ride, delivery                                                                                      | unset    | —      | Development bypass; ride and delivery refuse to boot in production if it is set to anything.                                                       |
| `INTERNAL_SERVICE_KEY`             | ride, food, delivery, payment, notification, config, ask, travel, growth, support, realtime-gateway | required | .env   | The shared X-Service-Key. delivery refuses the committed default; realtime-gateway admits unauthenticated service calls without it (so it is set). |

## 3. Per-surface service keys (each ≥ 32 characters, its own value)

| Variable                          | Caller → callee                                | Set on         | Class    | Source                              | Unset behaviour                                                                                                                    |
| --------------------------------- | ---------------------------------------------- | -------------- | -------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DRIVER_PROFILE_RIDE_SERVICE_KEY` | ride → user `/internal/driver-profiles`        | ride, user     | required | .env                                | Offers show "details unavailable".                                                                                                 |
| `DRIVER_PROFILE_ASK_SERVICE_KEY`  | ask → user driver profiles                     | user           | unset    | —                                   | No caller exists (ask-service does not call it); the route refuses ask.                                                            |
| `AI_GRANTS_SERVICE_KEY`           | ask → user grants / mandate runs               | ask, user      | required | .env                                | Grants cannot be minted; assistant actions refused.                                                                                |
| `TRAVEL_ASK_SERVICE_KEY`          | ask → travel `/internal/ask`                   | ask, travel    | required | .env                                | 503 on the background read.                                                                                                        |
| `FLEET_SERVICE_KEY`               | ride → fleet (contract A, vehicle lookups)     | ride, fleet    | required | .env                                | Advance awards carry no vehicle; no swap offered.                                                                                  |
| `FLEET_RIDE_SERVICE_KEY`          | fleet → ride `/internal/fleet`                 | fleet, ride    | required | .env                                | Fleet calendar / maintenance answer 503.                                                                                           |
| `FLEET_PAYMENT_SERVICE_KEY`       | payment → fleet settlement inputs (contract B) | payment, fleet | required | .env                                | The fleet remittance sweep does not start.                                                                                         |
| `DELIVERY_SERVICE_KEY`            | ride → delivery marketplace-assign / -cancel   | ride           | required | compose (`${INTERNAL_SERVICE_KEY}`) | delivery authenticates the hand-off with its own `INTERNAL_SERVICE_KEY`, which it also presents to payment, so all three share it. |

## 4. Service URLs (compose literals)

| Variable                       | Read by                                                    | Class | Value                                                                                                      |
| ------------------------------ | ---------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `USER_SERVICE_URL`             | api-gateway, ride, delivery, ask, fleet                    | set   | `http://user-service:3001`                                                                                 |
| `RIDE_SERVICE_URL`             | api-gateway, ask, travel, fleet                            | set   | `http://ride-service:3002`                                                                                 |
| `FOOD_SERVICE_URL`             | api-gateway                                                | set   | `http://food-service:3003`                                                                                 |
| `DELIVERY_SERVICE_URL`         | api-gateway, ride                                          | set   | `http://delivery-service:3004`                                                                             |
| `PAYMENT_SERVICE_URL`          | api-gateway, ride, food, delivery, travel, growth, support | set   | `http://payment-service:3005`                                                                              |
| `NOTIFICATION_SERVICE_URL`     | api-gateway, user, delivery, payment, support              | set   | `http://notification-service:3006`                                                                         |
| `CONFIG_SERVICE_URL`           | api-gateway, user                                          | set   | `http://config-service:3010` (identity routes throw without it; the gateway's two config reads answer 503) |
| `SUPPORT_SERVICE_URL`          | ask                                                        | set   | `http://support-service:4011`                                                                              |
| `TRAVEL_SERVICE_URL`           | api-gateway, ask                                           | set   | `http://travel-service:4012`                                                                               |
| `ASK_SERVICE_URL`              | api-gateway                                                | set   | `http://ask-service:4013`                                                                                  |
| `FLEET_SERVICE_URL`            | api-gateway, ride, payment                                 | set   | `http://fleet-service:4015`                                                                                |
| `APP_URL`                      | user, notification                                         | set   | `https://$DOMAIN`                                                                                          |
| `REFERRAL_URL_BASE`            | growth                                                     | set   | `https://$DOMAIN/r`                                                                                        |
| `PASSENGER_TRIP_LINK_BASE_URL` | notification                                               | set   | `https://$DOMAIN/trip-link` (the web passenger page; https required in production)                         |
| `ANALYTICS_SERVICE_URL`        | api-gateway                                                | unset | No such service exists; those rules keep answering 503.                                                    |
| `CEERION_SERVICE_URL`          | api-gateway                                                | unset | Same.                                                                                                      |
| `PROMOTIONS_SERVICE_URL`       | ask                                                        | unset | No service serves `/v1/promotions`; the port reports unavailable.                                          |
| `PAYMENT_TRAVEL_PATH`          | travel                                                     | unset | Code default `/v1/finance/travel` is the mounted route.                                                    |
| `LEDGER_REMEDY_PATH`           | support                                                    | unset | Code default is the canonical remedy route.                                                                |

## 5. Who the client is: trusted proxies

Values are compose defaults matching the fixed addresses on `ubi-network`
(Caddy `172.28.0.10`, api-gateway `172.28.0.11`). The downstream lists include
Caddy because the gateway forwards `X-Forwarded-For: <client>, <caddy>`; a list
without it would count every client as Caddy.

| Variable                       | Service      | Class | Default                   |
| ------------------------------ | ------------ | ----- | ------------------------- |
| `GATEWAY_TRUSTED_PROXIES`      | api-gateway  | set   | `172.28.0.10`             |
| `RIDE_TRUSTED_PROXIES`         | ride         | set   | `172.28.0.10,172.28.0.11` |
| `PAYMENT_TRUSTED_PROXIES`      | payment      | set   | `172.28.0.10,172.28.0.11` |
| `DELIVERY_TRUSTED_PROXIES`     | delivery     | set   | `172.28.0.10,172.28.0.11` |
| `NOTIFICATION_TRUSTED_PROXIES` | notification | set   | `172.28.0.10,172.28.0.11` |

## 6. Signing keys, guest trip link, proof storage

| Variable                            | Services           | Class    | Source          | Notes                                                                                                                                                          |
| ----------------------------------- | ------------------ | -------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RIDE_QUOTE_SIGNING_SECRET`         | ride               | required | .env            | ride-service **refuses to start** without ≥ 32 bytes. It was missing from compose before round 9, so ride-service could not have booted there.                 |
| `RIDE_PIN_VAULT_SECRET`             | ride               | required | .env            | Pickup-PIN encryption key. Its code fallback is `RIDE_INTERNAL_CONTEXT_SECRET`, whose rotation would make stored PINs unreadable — keep it separate.           |
| `TRIP_ACCESS_DELIVERY_KEY`          | ride, notification | optional | .env            | base64 of 32 bytes. Empty: book-for-another-adult is refused and no link is sent.                                                                              |
| `TRIP_ACCESS_DELIVERY_KID`          | ride, notification | optional | .env            | Names the key.                                                                                                                                                 |
| `TRIP_ACCESS_DELIVERY_KEY_PREVIOUS` | notification       | optional | .env            | Rotation only (ride seals with the current key only).                                                                                                          |
| `TRIP_ACCESS_DELIVERY_KID_PREVIOUS` | notification       | optional | .env            | Rotation only.                                                                                                                                                 |
| `PROOF_STORAGE_ENDPOINT`            | delivery           | set      | compose         | `http://minio:9000`.                                                                                                                                           |
| `PROOF_STORAGE_PUBLIC_ENDPOINT`     | delivery           | set      | compose         | `https://storage.$DOMAIN` — presigned URLs are signed for the host the apps reach.                                                                             |
| `PROOF_STORAGE_REGION`              | delivery           | set      | compose default | `us-east-1`.                                                                                                                                                   |
| `PROOF_STORAGE_BUCKET`              | delivery           | set      | compose default | `ubi-delivery-proofs` (private; `minio-init` creates it).                                                                                                      |
| `PROOF_STORAGE_ACCESS_KEY`          | delivery           | optional | .env            | The bucket-limited MinIO user (`minio-init`: object get/put/delete, bucket list + read-policy). Empty: proof routes refuse and production readiness stays 503. |
| `PROOF_STORAGE_SECRET_KEY`          | delivery           | optional | .env            | Same.                                                                                                                                                          |
| `PROOF_UPLOAD_URL_TTL`              | delivery           | optional | code            | 5m (bounded ≤ 15m).                                                                                                                                            |
| `PROOF_DOWNLOAD_URL_TTL`            | delivery           | optional | code            | 60s (bounded ≤ 5m).                                                                                                                                            |

## 7. Sweeps and timings (compose defaults equal the code defaults)

| Variable                             | Service     | Class    | Default                                                  |
| ------------------------------------ | ----------- | -------- | -------------------------------------------------------- |
| `FLEET_SETTLEMENT_SWEEP_INTERVAL_MS` | payment     | set      | 3600000                                                  |
| `BUSINESS_PAYOUT_SWEEP_INTERVAL_MS`  | payment     | set      | 300000                                                   |
| `TRANSFER_SWEEP_INTERVAL_MS`         | travel      | set      | 30000                                                    |
| `SOS_SWEEP_INTERVAL_MS`              | support     | set      | 30000                                                    |
| `BITES_ISSUE_SWEEP_INTERVAL_MS`      | food        | set      | 60000                                                    |
| `RIDE_MP_SWEEP_INTERVAL_MS`          | ride        | set      | 1000                                                     |
| `RIDE_DISPATCH_INTERVAL_MS`          | ride        | optional | code: 1000                                               |
| `RIDE_CONFIG_CACHE_TTL_MS`           | ride        | optional | code: 60000                                              |
| `RIDE_SHUTDOWN_TIMEOUT_MS`           | ride        | optional | code: 30000                                              |
| `PROXY_TIMEOUT`                      | api-gateway | optional | code: 30000 (see INTERNAL_IDENTITY.md on long ask turns) |
| `CONFIG_CACHE_TTL_SEC`               | config      | optional | code: 60                                                 |
| `AI_GRANT_TTL_SECONDS`               | user        | optional | code default                                             |
| `SLOW_QUERY_THRESHOLD_MS`            | payment     | optional | code default                                             |

## 8. Identity, maps, marketing (optional, fail closed when empty)

| Variable                      | Service | Class    | Empty means                                                                   |
| ----------------------------- | ------- | -------- | ----------------------------------------------------------------------------- |
| `IDENTITY_OTP_PEPPER`         | user    | optional | OTP cache keys are unpeppered (set it).                                       |
| `IDENTITY_JOB_SERVICE_KEY`    | user    | optional | Scheduled identity job routes refuse (< 32 = unset).                          |
| `TELCO_SIM_SWAP_SECRET`       | user    | optional | Telco SIM-swap webhook refuses.                                               |
| `IDENTITY_FACE_PROVIDER_URL`  | user    | optional | Face checks answer `service_unavailable`.                                     |
| `IDENTITY_FACE_PROVIDER_KEY`  | user    | optional | Same.                                                                         |
| `IDENTITY_DEFAULT_CITY_ID`    | user    | unset    | City comes from the signed context only.                                      |
| `GOOGLE_MAPS_API_KEY`         | ride    | optional | Routes are estimated, not measured.                                           |
| `MAPBOX_ACCESS_TOKEN`         | ride    | optional | Read only by `internal/eta`, which the server does not wire: no effect today. |
| `OSRM_BASE_URL`               | ride    | optional | Same.                                                                         |
| `MARKETING_MODEL`             | growth  | optional | Code default.                                                                 |
| `MARKETING_PROMPT_VERSION`    | growth  | optional | Code default.                                                                 |
| `MARKETING_REVALIDATE_URL`    | config  | optional | Marketing site is not asked to revalidate.                                    |
| `MARKETING_REVALIDATE_SECRET` | config  | optional | Same.                                                                         |

## 9. Payment rails and providers (payment-service; optional)

A rail with an empty base URL or key is unavailable and its operations fail
closed; nothing is simulated.

| Variable                                                                                                                                   | Class    | Notes                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------ |
| `NIP_BASE_URL`, `NIP_API_KEY`, `NIP_WEBHOOK_SECRET`                                                                                        | optional | Canonical payout rail (read as `${prefix}_BASE_URL` / `_API_KEY`).       |
| `TOPUP_BASE_URL`, `TOPUP_API_KEY`                                                                                                          | optional | Canonical top-up rail.                                                   |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_WEBHOOK_SECRET`, `PAYSTACK_ENVIRONMENT`                                            | optional | Paystack.                                                                |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_ENVIRONMENT`, `MPESA_PASSKEY`, `MPESA_SHORT_CODE`, `MPESA_CALLBACK_URL`              | optional | M-Pesa.                                                                  |
| `MPESA_B2C_SHORT_CODE`, `MPESA_B2C_INITIATOR_NAME`, `MPESA_B2C_SECURITY_CREDENTIAL`, `MPESA_B2C_QUEUE_TIMEOUT_URL`, `MPESA_B2C_RESULT_URL` | optional | M-Pesa B2C payouts.                                                      |
| `MOMO_ENVIRONMENT`, `MOMO_CALLBACK_URL`, `MOMO_<COUNTRY>_*`                                                                                | optional | MTN MoMo payouts; the per-country keys are built at runtime.             |
| `STRIPE_SECRET_KEY`                                                                                                                        | unread   | In compose since before round 9; no reachable code reads it.             |
| `NOTIFICATION_SERVICE_API_KEY`                                                                                                             | unset    | Legacy notification client (safety/admin); not the service-key contract. |
| `ANALYTICS_ENABLED`, `POSTHOG_API_KEY`, `POSTHOG_HOST`, `SEGMENT_WRITE_KEY`                                                                | unset    | No product analytics in the pilot.                                       |

## 10. Notification providers (notification-service; optional)

An empty key leaves that channel off. These are the names the providers read;
round 9 corrected two compose names (`FIREBASE_PRIVATE_KEY` →
`FIREBASE_SERVICE_ACCOUNT`, `TWILIO_PHONE_NUMBER` → `TWILIO_FROM_NUMBER`).

| Variable                                                                                                                                                                                                    | Class    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`                                                                                                                                                           | optional |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`                                                                                                                                             | optional |
| `AFRICASTALKING_API_KEY`, `AFRICASTALKING_USERNAME`, `AFRICASTALKING_ENV`                                                                                                                                   | optional |
| `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`, `SENDGRID_VERIFICATION_TEMPLATE_ID`, `SENDGRID_PASSWORD_RESET_TEMPLATE_ID`, `SENDGRID_RECEIPT_TEMPLATE_ID`, `SENDGRID_WELCOME_TEMPLATE_ID` | optional |
| `APP_DEEP_LINK_SCHEME`                                                                                                                                                                                      | optional |
| `NOTIFY_TEST_REDIS_URL`                                                                                                                                                                                     | dev      |

## 11. Travel suppliers, the model endpoint and other deliberately unset capabilities

| Variable                                                                                                                                                                                                                                      | Service          | Class  | Why unset                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRAVEL_SECRET_<REF>`                                                                                                                                                                                                                         | travel           | —      | Supplier credentials, injected per supplier row's `secretRef` / `webhookSecretRef`. None set: every supplier is `credentials_missing`, nothing is booked. Add them in a compose override on the host, never in the repo.      |
| `MODEL_ENDPOINT_URL`, `MODEL_NAME`, `MODEL_REVISION`, `MODEL_API_KEY`, `MODEL_SERVED_ID`, `MODEL_WEIGHTS_REVISION`, `MODEL_TOKENIZER_REVISION`, `MODEL_SERVING_IMAGE`, `MODEL_TOOL_PARSER`, `MODEL_ATTESTATION_URL`, `MODEL_ATTESTATION_MODE` | ask              | unset  | No model server runs on the pilot host. Unset, every model call answers `service_unavailable` (the assistant is unavailable, never faked). Set only with an attested endpoint (`services/ask-service/docs/MODEL-SERVING.md`). |
| `EMBED_ENDPOINT_URL`, `EMBED_NAME`, `EMBED_REVISION`                                                                                                                                                                                          | ask              | unset  | The offline lexical embedder serves retrieval. Must be absent, not empty: an empty URL would replace it with a broken HTTP embedder.                                                                                          |
| `DELIVERY_CHARGED_RETURNS_ENABLED`                                                                                                                                                                                                            | delivery         | unset  | Deny-by-default switch for fee-bearing returns (only `true` enables).                                                                                                                                                         |
| `CONFIG_SEED_ENABLED`                                                                                                                                                                                                                         | config           | unset  | The seed never runs in production.                                                                                                                                                                                            |
| `RIDE_MIGRATE_ON_BOOT`                                                                                                                                                                                                                        | ride             | unset  | Migrations run once, from `@ubi/database`, via the `migrate` tool service.                                                                                                                                                    |
| `VALID_SERVICE_API_KEYS`                                                                                                                                                                                                                      | api-gateway      | unset  | API-key auth on the gateway fails closed while it is empty.                                                                                                                                                                   |
| `SERVICE_API_KEY`                                                                                                                                                                                                                             | user             | unset  | user-service's notification client sends it as `Authorization: Bearer`, which notification-service's service routes do not accept (they take `X-Service-Key`); setting it would not make OTP SMS work. Out-of-area fix.       |
| `SERVICE_SECRET`                                                                                                                                                                                                                              | realtime-gateway | unset  | `INTERNAL_SERVICE_KEY` closes its service endpoint instead.                                                                                                                                                                   |
| `CORS_ORIGINS`                                                                                                                                                                                                                                | api-gateway      | unread | Kept in compose; the gateway does not read it.                                                                                                                                                                                |

## 12. Web apps (build-time)

`NEXT_PUBLIC_*` values are inlined by `next build`; compose passes
`NEXT_PUBLIC_API_URL` as a build argument and at runtime.

| Variable                                                                                                                                              | App                      | Class    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------- |
| `NEXT_PUBLIC_API_URL`                                                                                                                                 | web-app, admin-dashboard | set      |
| `NEXT_PUBLIC_APP_URL`                                                                                                                                 | web-app                  | optional |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_MIXPANEL_TOKEN`, `NEXT_PUBLIC_AMPLITUDE_API_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | web-app                  | unset    |

## Not in the pilot stack

- **location-service** (Go): not in compose. It exposes an unauthenticated
  internal API; its Dockerfile was fixed to the repository-root context so it
  builds, but running it is a separate decision.
- **Kubernetes**: only `infrastructure/kubernetes/services/api-gateway` exists
  (scale-out track, never applied). Its env now carries the ask/travel/fleet
  URLs, `GATEWAY_TRUSTED_PROXIES`, the identity secrets and `REDIS_URL`; no
  other service gets a manifest this round — compose is the pilot path.
