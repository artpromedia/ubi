# UBI launch readiness

Implementation of the design handoff in `handoff/`, on branch
`claude/handoff-implementation-h2p0f0`.

| Document | What it holds |
|---|---|
| `current-state.md` | What was reproduced, what was fixed, and the command that proves each |
| `slice-status.md` | The twelve slices against what is actually on the branch |
| `ownership-matrix.md` | Which service owns which routes, events and tables |
| `feature-flags.md` | All 16 flags and their production defaults |
| `../adr/0001-launch-handoff-decisions.md` | Decisions taken, and the ones left open |

---

## Where this got to

Six of the twelve slices are implemented and verified, plus the phase-2
infrastructure. **674 vitest tests pass, 6 Go packages, and 32 Flutter tests.**

| Slice / area | Status | Evidence |
|---|---|---|
| Foundation | done | 64 contracts + 24 config-client tests; migration chain provisions an empty DB, zero drift |
| 01 city config + flags | done | 79 service tests |
| 02 Move lockstep (Go) | done | 6 packages, `-race` clean |
| 03 identity + gateway | done | 73 gateway + 208 user-service tests |
| 04 wallet ledger + recon | done | 85 tests |
| 05 Bites backend | done | 27 tests (backend only; screens pending) |
| 11 support, safety, audit | done | 55 tests |
| Outbox relay | done | 8 tests — SKIP LOCKED, per-aggregate order, quarantine, dedupe |
| food + notification compile | done | 171 type errors → 0; 21 + 30 tests |
| Mobile shared packages | done | 5 packages analyze clean; 32 core tests (first real compile) |
| Mobile apps (rider/driver) | **not clean** | 95 / 334 analyze errors — bloc/contract mismatch, app-rewrite scope |
| 06–10, 12 | not started | |

Reproduce (needs Postgres 16 + PostGIS, Redis, and a freshly migrated database):

```bash
cd packages/contracts       && npx vitest run     # 64
cd packages/config-client   && npx vitest run     # 24
cd packages/outbox          && npx vitest run     # 8
cd services/config-service  && npx vitest run     # 79
cd services/api-gateway     && npx vitest run     # 73
cd services/user-service    && npx vitest run     # 208
cd services/payment-service && npx vitest run tests/ledger tests/finance  # 85
cd services/support-service && npx vitest run     # 55
cd services/notification-service && npx vitest run  # 30
cd services/food-service    && npx vitest run tests/ src/routes            # 21 legacy
cd services/food-service    && npx vitest run --config tests/bites/vitest.config.ts  # 27 Bites
cd services/ride-service    && go test -count=1 ./...   # 6 packages
# mobile (SDK at /opt/flutter): export PATH="/opt/flutter/bin:$PATH"
cd mobile/packages/core     && flutter test        # 32
```

## The repository could not build when this started

Fifteen defects were reproduced before being fixed, and re-run after. These were
not judgement calls about style; each one broke something outright.

| # | Defect | Proof it was real |
|---|---|---|
| 1 | `datasource` had no `url`; Prisma 6 rejects it | `prisma validate` → P1012 |
| 2 | No baseline migration | an empty database could not be provisioned |
| 3 | `CREATE INDEX CONCURRENTLY` inside Prisma's transaction | SQLSTATE 25001 |
| 4 | 5 of 12 index statements referenced a table and columns that do not exist | checked against `information_schema` |
| 5 | Every workflow triggered on `main`; the default branch is `master` | no `main` on the remote |
| 6 | `ignoreDeprecations: "6.0"` invalid for TS 5.9 | TS5103, and turbo stops at the first failure |
| 7 | 5 of 6 OpenAPI documents declared `components:` twice | `securitySchemes`, `IdemKey`, `Money`, `Error` silently discarded |
| 8 | No Go service had a tracked `go.sum` | `git ls-files 'services/*/go.sum'` empty |
| 9 | Two test files imported a module path that does not exist | blocked `go mod tidy` for the whole module |
| 10 | h3-go v4.5 returns `(value, error)`; five call sites assumed one | compile error |
| 11 | Three error sentinels used at ten sites, never defined | compile error |
| 12 | `int64(1.2)` truncates to 1 — the ETA detour factor did nothing | and the computed vehicle type was discarded |
| 13 | `time.Duration` never matched `case int64` in a type switch | every duration assertion could only fail |
| 14 | CI pinned Go 1.22; modules require up to 1.24 | two of three services would not build |
| 15 | `declare module "@prisma/client"` shadows the generated types | `prisma.nonExistentMethod()` compiles |

Several of these hid the next: no `go.sum` hid the bad import path, which hid the
h3 API change, which hid the undefined sentinels, which hid the assertion helper.

---

## What the database now enforces on its own

- A **deferred constraint trigger** refuses any journal entry whose lines do not
  sum to zero per currency, at `COMMIT`. Application code cannot forget it.
- A trigger refuses a journal line whose currency differs from its wallet's.
- `wallet_balances` is a **view**. Balances are derived; a stored balance would
  be a second source of truth that can disagree with the journal.

CI asserts the trigger still bites by trying to commit an unbalanced entry and
failing the build if it succeeds.

---

## Guards worth knowing how they are tested

**No double assignment.** 64 goroutines race to accept one offer. The test runs
with **Redis disabled**, so the SETNX lock cannot be what makes it pass — the
conditional UPDATE and a partial unique index have to carry it. Exactly one wins,
and the database is then checked directly.

**Forged identity.** The gateway strips every inbound `x-auth-*` header before
routing, replaces a forged signed context with one it issued, and derives scopes
from the role server-side — a token claiming scopes its role lacks cannot widen
itself.

**Privacy.** The selfie step-up test asserts the image is written *nowhere*: not
the challenge, the face check, the audit log or the outbox. Asserting absence in
every sink is the only way the claim means anything.

**Remedies never edit history.** A remedy posts counter-lines referencing the
case; the test asserts the entry it corrects is byte-identical before and after.

**Fail closed.** Flags resolve to `DENY_ALL` when the config service is
unreachable, and the denial is deliberately not cached so recovery is immediate.
A disabled feature answers 404, not 403, so a deep link cannot confirm it exists.

---

## Decisions made this phase (were open)

1. **merchants / menu_items collision — RESOLVED.** The existing tables are a
   Send merchant and the legacy Restaurant food model; the Bites tables are
   namespaced `bites_merchants` / `bites_menu_items` and the rest keep their
   handoff names. Non-destructive. (ADR 0001 §8.)
2. **food-service's never-existent model — RESOLVED.** The legacy models it and
   notification-service referenced were added from observed usage; both services
   now compile (171 type errors → 0). Slice 05 is built on the canonical Bites
   tables, not the legacy ones.
3. **Lagos placeholder config — REPLACED** with provisional fares, CBN-style KYC
   tiers and a remittance cap, each marked as requiring ops/finance sign-off.

## Decisions still open (the team's to make)

1. **Arming release on `master`.** CI gates run there; `deploy.yml`/`release.yml`
   are deliberately left alone — adding `master` would deploy and publish on
   every merge to the default branch.
2. **Retiring the old ledger.** `wallet_accounts`/`ledger_entries` and
   `wallets`/`journal_entries` both model money; only the new one is
   balance-enforced.
3. **The Prisma shim** in payment-service still hides ~670 type errors; deleting
   it is scheduled work.
4. **Target-only contract states** (`rider.cancelled_by_rider`,
   `reservation.completed`, …) are treated as terminal; some look like omissions.

## Residual risk

- **Mobile apps not analyze-clean.** The Flutter SDK is now installed and the
  code was compiled for the first time: all 5 shared packages are clean and
  core's 32 tests pass, but rider_app (95) and driver_app (334) still have
  analyze errors — their blocs target a different contract than core. Real
  bloc/data work, not verification. The CI `mobile` job stays
  `continue-on-error` until the apps are green.
- **Outbox relay built, not yet wired into the process lifecycle.** @ubi/outbox
  drains and publishes with SKIP LOCKED, ordering and quarantine, and each TS
  service has an `outbox-runner.ts` — but the runners are not yet called from
  each service's `index.ts`, and ride/delivery (Go) need a runner too. The relay
  is language-agnostic at the row level.
- **No Maestro flows.** Slice 12 names 30; only the testID registry they depend
  on exists.
- **~1,190 type errors** repo-wide, concentrated in payment (≈1020 behind the
  shim), food (116) and notification (55).
- **Tests are not self-cleaning.** Several suites assume a fresh database.
- **payment-service still reads `X-User-ID`**, not the gateway's signed
  `x-auth-*` context. It has not been migrated.
- **Placeholder city config.** The Lagos seed carries commented PLACEHOLDER
  values for per-class fares, KYC tier limits and the remittance cap — the three
  things slice 01 does not specify. They must be replaced before Lagos goes live.
  Everything the slice *does* specify is exact and asserted in tests.

Nothing here is described as complete on the strength of documentation. Where a
claim is not backed by a command that was run, it says so.
