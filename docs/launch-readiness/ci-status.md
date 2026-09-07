# CI status

The state of every CI job on `claude/handoff-implementation-h2p0f0`, and how to
reproduce each locally. Requires Postgres 16 + PostGIS and Redis (a fresh
`ubi_*` database migrated with `prisma migrate deploy`).

## The merge gate — `ci-success` — is GREEN

`ci-success` requires `[build, test, go-build, db-check, contracts]`. All green:

| Job | Status | What it runs / proof |
|---|---|---|
| `typecheck` | ✅ **36 / 36** | `turbo run typecheck` — every package and service, 0 errors |
| `build` | ✅ green | `turbo run build` — 21 packages/services build; the 7 Next.js apps build individually (a batch run only times out under local concurrency) |
| `test` | ✅ green | 664 vitest tests + 6 Go packages (see below) |
| `go-build` | ✅ green | ride-, delivery-, location-service build + vet clean |
| `db-check` | ✅ green | empty DB provisions from the migration chain; zero schema drift; the ledger invariant is asserted to reject an unbalanced entry |
| `contracts` | ✅ green | all six OpenAPI docs parse, resolve and declare auth |

### Test counts (664 vitest + 32 Flutter + Go)

| Suite | Tests |
|---|---|
| packages/contracts | 64 |
| packages/config-client | 24 |
| packages/outbox | 8 |
| services/config-service | 79 |
| services/api-gateway | 73 |
| services/user-service | 208 |
| services/support-service | 55 |
| services/notification-service | 30 |
| services/food-service (legacy 21 + Bites 27, minus overlap) | 38 |
| services/payment-service (ledger + finance) | 85 |
| ride-service (Go) | 5 packages + integration, `-race` clean |
| mobile/packages/core (Flutter) | 32 |

## Jobs that are not green, and why

### `lint` — RED, pre-existing legacy debt (not this work)

`lint` = `pnpm format:check` + `pnpm lint:affected`.

- **format:check**: green for the code this branch authored (prettier-formatted;
  a `.prettierignore` excludes build output, generated Dart, Prisma migrations
  and the vendored handoff).
- **eslint (`lint:affected`)**: RED. eslint carries a large pre-existing debt —
  `user-service` alone, unchanged from master, reports 152 errors; roughly
  **1,400 repo-wide**. This was red on `master` before any of this work. Clearing
  ~1,400 eslint errors across legacy code is a separate, non-launch-blocking
  effort and is deliberately not churned here. New packages were given the
  missing eslint configs so they lint at all.

### `mobile` — continue-on-error (by design)

The 5 shared Flutter packages analyze clean and core's 32 tests pass, but
`rider_app` (95 analyze errors) and `driver_app` (334) do not — their blocs target
a different contract than `core`. Real bloc/data work, tracked in the README.

## Two CI-plumbing defects fixed (would have failed the pipeline regardless of code)

1. The `*:affected` scripts filtered on `origin/main`, a branch that does not
   exist here (default is `master`), so build/test/typecheck/lint jobs could not
   resolve their git base. Switched to turbo's `--affected` (auto-detects the base).
2. config-service and three new packages had no `.eslintrc`, so `eslint src`
   errored on "no config found". Added.
