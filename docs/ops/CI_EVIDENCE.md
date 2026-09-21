# CI evidence: what the green checks actually verify, and what was removed

This is the honest inventory the C11 brief asks for: exactly what each
currently-green job proves, exactly what the previously-declared
integration/E2E/pact/performance jobs would need to become real, and the
migration-testing gap in what exists today. Nothing here restores a job that
cannot pass in this environment — see
`.github/workflows/test.yml`'s NOTE block and `docs/launch/GAP_REGISTER.md`
row **G06** for why they were removed instead of left red or faked.

## What the two green workflows currently verify

### `Testing Pipeline` (`.github/workflows/test.yml`)

| Job             | Gated by (`changes`)                                                                        | What it actually proves                                                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`          | always                                                                                      | ESLint + `prettier --check` across the whole repo (includes both RN apps).                                                                                                                                                                                                                                       |
| `typecheck`     | always                                                                                      | `tsc --noEmit` for every workspace package via turbo (includes both RN apps and their shared packages).                                                                                                                                                                                                          |
| `unit-packages` | `packages/**` changed, or push                                                              | `@ubi/ui`, `@ubi/utils`, `@ubi/contracts`, `@ubi/config-client` unit tests; `@ubi/outbox`'s integration suite against real Postgres+Redis (`FOR UPDATE SKIP LOCKED`, pub/sub delivery).                                                                                                                          |
| `unit-services` | `services/**` (minus Go) or shared paths (fixed below) changed, or push                     | `api-gateway`, `user-service`, `food-service`, `payment-service`, `notification-service` unit tests against real Postgres+Redis with migrations applied — **this is where payment-service's DB-backed ledger tests run** (deferred double-entry trigger, row locks, idempotency keys: the financial safety net). |
| `unit-go`       | `services/ride-service\|delivery-service/**` or shared paths (fixed below) changed, or push | `go test -race` for ride-service and delivery-service against real Postgres (PostGIS) + Redis with migrations applied.                                                                                                                                                                                           |
| `coverage`      | always (`if: always()`)                                                                     | Merges coverage artifacts; does not gate pass/fail.                                                                                                                                                                                                                                                              |
| `test-status`   | always                                                                                      | The actual required rollup: lint/typecheck must succeed; the three unit jobs must not have _failed or been cancelled_ (a legitimate skip is not a failure).                                                                                                                                                      |

### `CI` (`.github/workflows/ci.yml`)

| Job                               | What it actually proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`/`typecheck`/`build`/`test` | Affected-scoped lint/typecheck/build, then hermetic `turbo run test` over `packages/*` + `apps/*` (excludes `@ubi/outbox`/`@ubi/config-client`/`@ubi/contract-testing`, which need real infra or have no CI home — see below).                                                                                                                                                                                                                                                                                                                                         |
| `go-lint`/`go-build`              | `golangci-lint` + `go build` + `go test -race` for `ride-service`, `delivery-service`, `location-service` against real Postgres/Redis with migrations applied.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `db-check`                        | Validates the Prisma schema; **provisions an empty database from the full migration chain** (forward-migration exit gate); a `prisma migrate diff --exit-code` schema-drift gate (already existed); **new in this pass**: re-runs `prisma migrate deploy` a second time to prove it is safe to invoke repeatedly (the exact operation `infrastructure/hetzner/scripts/deploy.sh` performs on every deploy — see "Migration-testing gap" below); asserts the ledger's deferred double-entry trigger actually rejects an unbalanced journal entry at the database level. |
| `contracts`                       | OpenAPI/state-machine documents parse and every `$ref` resolves; codegen (`packages/contracts` state machines) is a no-op on a clean tree, i.e. committed generated code cannot drift from `contracts/state-machines.json`.                                                                                                                                                                                                                                                                                                                                            |
| `rn-mobile`                       | `tsc --noEmit` + `jest` for both RN apps and their shared packages (rider 37/37, driver 71/71) — real, required, no `continue-on-error`.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `marketing-e2e`                   | Builds `apps/marketing-site` for real, then runs its Playwright suite (unit tests + full E2E) against the built site — **this one does run**, unlike the RN device E2E, which does not exist anywhere yet.                                                                                                                                                                                                                                                                                                                                                             |
| `ci-success`                      | Rollup: build, test, go-build, db-check, contracts, rn-mobile, marketing-e2e must all succeed. **Fixed this pass**: `rn-mobile` was already listed in `needs` (so `ci-success` waited for it) but its result was never checked in the pass/fail condition — a failing `rn-mobile` could not have failed `ci-success`. `rn-mobile` currently always succeeds, so this changes no behaviour today; it only starts mattering if it ever regresses.                                                                                                                        |

### `RN Native` (`.github/workflows/rn-native.yml`, rewritten this pass)

See `docs/ops/NATIVE_RELEASE.md` for the full breakdown. In short: `rn-verify`
is real and unconditional (typecheck+jest+lint for both apps, no native
project needed); `rn-android`/`rn-ios`/`rn-e2e` are guarded and inert today
(no native project, no signing, no device farm) — they succeed with an
explicit skip log rather than being silently `if: false`, and none of them
is a required check.

## What coverage does NOT exist in CI today (found while doing this pass)

`ask-service`, `growth-service`, `travel-service`, `config-service`,
`support-service` and `realtime-gateway` each define a real `vitest run`
test script (several depend on `DATABASE_URL` — real Postgres — per their
`tests/helpers.ts`/`global-setup.ts`), but **none of them is invoked by
either CI workflow**: they are absent from `test.yml`'s `unit-services`
matrix (`[api-gateway, user-service, food-service, payment-service,
notification-service]`) and `ci.yml`'s `test` job explicitly scopes to
`./packages/*` + `./apps/*` only, excluding all `services/*`. Their suites
are real (`docs/launch-readiness/rn-migration-status.md` records tsc-0 and
vitest counts for several of them from local runs), but that evidence has
never been reproduced by CI, so a regression in any of these six services
would not be caught by either green workflow. **Not fixed in this pass** —
wiring six services with real DB dependencies into a CI matrix without
being able to verify each one's environment expectations here would risk
turning currently-green CI red, which is out of bounds for this change.
Recorded here as a named, scoped follow-up: add each to `test.yml`'s
`unit-services` matrix (or a new matrix) with `DATABASE_URL`/`REDIS_URL`
wired the same way `payment-service` already is, verifying locally first.

## What the removed E2E / consumer-pact / performance jobs needed

These jobs (removed from `test.yml`, see its NOTE block) are not restored,
because none of the following exists in this environment:

- **Integration/E2E.** Called root scripts `db:migrate:test` and
  `test:integration` that never existed, and an E2E flow that expects a
  fully seeded platform already listening on `localhost:3000`. To become
  real: the named root scripts need to exist; a seeded, running composition
  of the backend services (docker-compose or an ephemeral k8s namespace)
  needs to be brought up in CI with representative city/config/flag rows;
  and the E2E spec suite itself needs to be written or restored from
  wherever it originally lived.
- **Consumer-pact.** `@ubi/contract-testing`'s pact suites do not compile
  today (`ci.yml`'s `test` job explicitly excludes the package with a
  comment recording this). To become real: the package needs to build
  cleanly, provider states need implementations against running provider
  services, and a Pact broker (self-hosted or PactFlow) needs to exist for
  publish/verify to target.
- **Performance/load.** No k6 (or other load tool) scripts exist anywhere
  in the repo, and there is no environment sized or isolated for load
  testing without risking shared infrastructure. To become real: load
  scripts need to be written against the marketplace's actual endpoints
  (`docs/marketplace/ROLLOUT.md` names the metrics to observe: publish→
  first-offer latency, publish→award latency, funding rejection rate,
  hold-release lag, pending-award age, reservation-recovery backlog,
  cancellation rates), a k6 (or equivalent) job needs to run in CI or a
  dedicated environment, and thresholds need to be set — see
  `docs/ops/RELEASE_CHECKLIST.md`, which leaves all of these as
  owner-set targets rather than inventing passing numbers.

## Migration-testing gap

`db-check` (`ci.yml`) proves the **forward** migration chain applies
cleanly to an **empty** database, and that the chain matches the committed
Prisma schema exactly (`migrate diff --exit-code`). New in this pass: it
also proves a _second_, no-op `migrate deploy` invocation against that same
already-migrated database succeeds — this is the specific behaviour
`infrastructure/hetzner/scripts/deploy.sh`'s `cmd_deploy`/`cmd_migrate`
depend on, since they invoke `migrate deploy` on every deploy whether or
not a new migration exists. Verified locally before landing (8 migrations
applied cleanly, second invocation reports "No pending migrations to
apply", exit 0).

**What is still not covered**: a migration that only breaks against a
**populated** database — e.g. adding a `NOT NULL` column with no default to
a table that already has rows, or a data-backfill migration whose assumed
shape doesn't match real accumulated data — passes `db-check` today,
because `db-check` always starts from empty. There is no step anywhere in
CI that takes a snapshot of a previous schema version with representative
seed data and applies the newest migration on top of it. Closing this
needs either (a) a maintained "previous schema + seed data" fixture that CI
restores before running the latest migration, or (b) a staging-environment
migration dry-run as a release gate — neither exists here, and inventing
seed data that doesn't reflect real production shapes would not actually
prove anything, so it is named as a gap rather than worked around.
