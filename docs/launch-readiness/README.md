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

Five of the twelve slices are implemented and verified. **575 tests** pass, plus
six Go packages.

| Slice | Status | Evidence |
|---|---|---|
| Foundation | done | 64 tests · migration chain provisions an empty database |
| 01 city config + flags | done | 90 tests (66 service + 24 client) |
| 02 Move lockstep (Go) | done | 6 packages, `-race` clean, live Postgres + Redis |
| 03 identity + gateway | done | 281 tests (73 gateway + 208 user-service) |
| 04 wallet ledger + recon | done | 85 tests |
| 11 support, safety, audit | done | 55 tests |
| 01 client (Flutter) | landed, **not compiler-verified** | no Dart SDK here; see below |
| 05 Bites | **blocked** | see below |
| 06–10, 12 | not started | |

Reproduce any of it:

```bash
cd packages/contracts        && npx vitest run     # 64
cd packages/config-client    && npx vitest run     # 24
cd services/config-service   && npx vitest run     # 66
cd services/api-gateway      && npx vitest run     # 73
cd services/user-service     && npx vitest run     # 208
cd services/payment-service  && npx vitest run tests/ledger tests/finance   # 85
cd services/support-service  && npx vitest run     # 55
cd services/ride-service     && go test -count=1 ./...   # 6 packages
```

Integration tests need Postgres 16 + PostGIS and Redis, and a **freshly migrated**
database — several suites seed fixed ids and dates and do not clean up.

---

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

## Decisions this work did not make

1. **`merchants` / `menu_items` collide** with the slice 05 DDL. Rename, migrate
   or namespace? Blocks slice 05.
2. **`food-service` does not compile** — 116 errors, mostly references to Prisma
   models that exist in **no** schema file here. It was written against a data
   model that has never been in this repository, so fixing the schema path cannot
   help; the model must be designed. Also blocks slice 05.
3. **Arming release on `master`.** CI gates now run there; `deploy.yml` and
   `release.yml` were deliberately left alone, because adding `master` would
   deploy and publish on every merge to the default branch.
4. **Retiring the old ledger.** `wallet_accounts`/`ledger_entries` and
   `wallets`/`journal_entries` both model money. Only the new one is
   balance-enforced.
5. **The Prisma shim.** Deleting it takes payment-service from 350 to 1020 type
   errors — 670 real errors it has been hiding in the service that moves money.
6. **Target-only contract states** (`rider.cancelled_by_rider`,
   `reservation.completed`, …) are treated as terminal. Some look like omissions.

---

## Residual risk

- **No Dart toolchain here.** Every mobile change is author-reviewed, not
  compiled. The CI `mobile` job closes this on a runner, but is
  `continue-on-error` until the existing analysis failures are cleared.
- **No outbox relay.** Every service writes `outbox_events` transactionally;
  nothing publishes them yet. Consumers are idempotent on `id` for when one
  exists.
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
