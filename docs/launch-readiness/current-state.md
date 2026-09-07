# UBI current state — launch-readiness baseline

**Repository:** artpromedia/ubi
**Default branch:** `master`
**Audit baseline commit:** `8aa7c2611d6cb006a1aba13f8b27af0f1eed29d4`
**HEAD when this document was written:** `8aa7c26` — identical to the audit baseline, so every
finding in the audit was re-checked against unchanged code.
**Working branch:** `claude/handoff-implementation-h2p0f0`

This is the Phase 0.1 deliverable from the master Claude Code prompt: what is actually
true in the repository, established by running things rather than by reading documentation.
Every claim below carries the command that produced it.

---

## 1. Environment used for verification

| Tool | Version | Notes |
|---|---|---|
| Node | 22.22.2 | |
| pnpm | 9.14.2 | matches `packageManager` |
| Go | 1.24.7 | |
| PostgreSQL | 16.13 | started locally for this work |
| PostGIS | 3.4 | installed; `schema.prisma` declares the extension |
| Redis | 7.x | started locally |
| Flutter / Dart | **absent** | `which flutter` and `which dart` both fail |

The missing Flutter SDK is the single largest verification gap. No Dart in this repository
can currently be compiled, analysed or tested here, so any mobile change is
**author-reviewed but not compiler-verified**. That is stated wherever it applies.

---

## 2. Defects found and fixed in this pass

Each was reproduced before being fixed, and the fix was re-run to prove it.

### 2.1 The Prisma schema could not be validated at all

`datasource db` declared no `url`, relying on `prisma.config.ts` — a Prisma 7 feature —
while the pinned CLI is Prisma 6.19.1.

```
$ npx prisma validate
Error code: P1012
error: Argument "url" is missing in data source block "db".
```

Fixed by adding `url = env("DATABASE_URL")`. `prisma.config.ts` reads the same variable, so
the two cannot drift. `prisma validate` now reports the schema valid.

### 2.2 There was no baseline migration

`prisma/migrations/` contained one timestamped migration that only adds indexes, plus a
stray `payment-system.sql` outside the migration structure, and no `migration_lock.toml`.
An empty database could not be provisioned.

Added `20250101000000_baseline` generated from the datamodel, and `migration_lock.toml`.

### 2.3 The only migration could never be applied

It used `CREATE INDEX CONCURRENTLY`, which Postgres refuses inside a transaction — and
Prisma Migrate wraps every migration in one.

```
Applying migration `20250101000004_performance_indexes`
Database error code: 25001
ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
```

### 2.4 Five of that migration's twelve statements referenced a schema that does not exist

Verified by provisioning a database from the baseline and querying `information_schema`:

| Statement referenced | Reality | Resolution |
|---|---|---|
| `balance_holds(account_id, status)`, `WHERE status = 'ACTIVE'` | no `status` column; the model uses `is_released` | re-expressed as `WHERE is_released = false` |
| `fraud_alerts(user_id, is_active, ...)` | **table does not exist**; nearest is `alerts`, which has neither column | replaced with an index on the real `alerts` shape |
| `payouts(status, scheduled_at)` | no `scheduled_at` column | uses `initiated_at` |
| `driver_earnings(driver_id, period_start, period_end)` | neither period column exists | uses `created_at` |
| `idx_transactions_recent … WHERE created_at > NOW() - INTERVAL '30 days'` | index predicates must be IMMUTABLE; `NOW()` is STABLE | replaced with a plain index on `created_at` |

Every change is annotated inline in the migration file with the reason.

**Result — the Phase 0 database exit gate now passes:**

```
$ npx prisma migrate deploy          # against an empty database
Applying migration `20250101000000_baseline`
Applying migration `20250101000001_ledger_balance_constraint`
Applying migration `20250101000004_performance_indexes`
All migrations have been successfully applied.
```

### 2.5 CI has never run on the default branch

All five workflows trigger on `main`/`develop`; the default branch is `master`, and no
`main` branch exists on the remote (`git branch -r` lists only `master` and this working
branch). Every gate in the repository has therefore been dormant.

`ci.yml`, `test.yml` and `infrastructure.yml` now include `master`. `deploy.yml` and
`release.yml` are **deliberately left unchanged** and annotated instead: adding `master`
there would arm deployment and package publication on every merge to the default branch,
which is an operational decision for the team, not a repair.

### 2.6 A tracked build log

`build-errors.txt` was a 68 KB UTF-16 PowerShell transcript containing a developer's local
absolute paths (`C:\Projects\...`, `C:\Users\...`). Removed and added to `.gitignore`.

The failure it recorded — `location-search.tsx:182 Parameter 'e' implicitly has an 'any'
type` — **is already fixed at HEAD**; that parameter is now typed
`React.ChangeEvent<HTMLInputElement>`. The log was stale, which is precisely why build
output does not belong in version control.

---

## 3. Contract observations

### 3.1 States declared only as transition targets

`contracts/state-machines.json` names states in transition targets that never appear as
keys in the `transitions` map. They are terminal leaves, and the generator keeps them in
the state union rather than dropping them silently, reporting them in
`TERMINAL_ONLY_STATES`:

| Machine | Target-only states |
|---|---|
| rider | `cancelled_by_ops`, `cancelled_by_rider`, `no_show` |
| driver | `no_show` |
| order | `auth_released`, `closed` |
| shipment | `closed`, `hub_pickup`, `neighbour_delivery`, `return_to_sender` |
| flightBooking | `hold_expired`, `next_day_switched` |
| stayBooking | `cancelled_by_guest`, `closed`, `first_night_covered`, `hold_expired`, `refunded`, `replied` |
| journeyLeg | `cancelled` |
| reservation | `completed`, `no_show` |
| fleetAssignment | `declined`, `expired` |
| walletTransfer | `closed`, `rejected_limit`, `rejected_safe_mode`, `reversed` |
| supportCase | `closed` |

**Needs a contract decision:** whether each of these is genuinely terminal, or whether a
transition out of it is missing. `rider.cancelled_by_rider` and `reservation.completed`
look most likely to be omissions.

### 3.2 Table-name collisions between the handoff DDL and the existing schema

The handoff DDL says "keep names". Two of its tables already exist with different shapes:

| Table | Existing owner | Handoff owner (slice 05) |
|---|---|---|
| `merchants` | `Merchant` model | Bites merchant with CAC/TIN/KYB |
| `menu_items` | `MenuItem` model | Bites menu item with option groups |

**Needs a decision before slice 05 is built**: rename the new tables, migrate the old
models onto the new shape, or namespace one side. No models were added for slices 04–07
in this pass, so nothing has been decided by default.

### 3.3 Service stack differs from the handoff README

The handoff README describes services as "Hono + zod-openapi + Prisma + Redis + pino
(TypeScript, vitest)". That is true of payment, user, food, notification, realtime and the
gateway — but `ride-service` and the `location-service`/`delivery-service` scaffolds are
**Go** (chi, pgxpool, go-redis). Slice 02 targets `ride-service`, so its implementation is
Go, per the handoff's own instruction to ground everything in what exists.

---

## 4. Money and identity conventions

Two conventions now coexist in `schema.prisma`, on purpose:

| | Original models | Handoff models |
|---|---|---|
| Primary key | `uuid` via `gen_random_uuid()` | `text` (nanoid) |
| Money | `Decimal(19,4)` | `BigInt` minor units + explicit `currency` |
| Table names | snake_case via `@@map` | snake_case, names kept exactly as the handoff DDL |

The handoff requires minor units: the double-entry invariant (lines sum to zero) only holds
exactly over integers. The two conventions are separated by module, not mixed within one.

**Residual risk:** the older `WalletAccount`/`LedgerEntry`/`Transaction` models and the new
`Wallet`/`JournalEntry`/`JournalLine` models both describe a ledger. Only the new one
enforces balance in the database. Retiring the old path is not yet scheduled.

---

## 5. What the database now enforces itself

`20250101000001_ledger_balance_constraint` adds, as database objects rather than
application conventions:

- a **deferred constraint trigger** on `journal_lines` — a journal entry whose lines do not
  sum to zero per currency is refused at `COMMIT`, so an unbalanced entry cannot be
  committed even by code that forgets to check;
- an immediate trigger refusing a journal line whose currency differs from its wallet's;
- a `wallet_balances` **view** — balances are derived from the journal, never stored.

Exercised directly in SQL: a balanced entry commits and the derived balances are correct;
an unbalanced entry inserts without error mid-transaction and then fails at `COMMIT`, with
nothing persisted; a cross-currency line is refused on insert.

---

## 6. Build matrix — what actually compiles

Measured with `turbo run typecheck --continue` and `go build ./...`. `--continue`
matters: turbo halts at the first failure by default, and the first failure was
`@ubi/database` (see the first-failure mask below), so **no other package's type errors had ever been
visible**.

### TypeScript services

| Service | Type errors | Note |
|---|---:|---|
| `api-gateway` | 0 | |
| `user-service` | 0 | |
| `realtime-gateway` | 0 | |
| `config-service` | 0 | added in this branch |
| `payment-service` | ~350 | pre-existing, excluding the new ledger module |
| `food-service` | 116 | |
| `notification-service` | 55 | |

All 11 shared packages typecheck.

### The 521 pre-existing errors are mostly one root cause

`food-service` and `notification-service` are written against **Prisma models
that do not exist**:

`inAppNotification` · `menuCategory` · `notificationLog` ·
`notificationPreference` · `notificationTemplate` · `order` · `review` ·
`reviewReport`

This is worse than the audit's diagnosis. The audit attributed the orphaned-model
problem to `prisma.config.ts` pointing only at `schema.prisma`, leaving the seven
`schema-*.prisma` fragments out of generation. That is true, but it is not what
is happening here: **none of these eight models exists in any schema file in the
repository**, fragments included. Verified with
`grep -l "^model <Name> " packages/database/prisma/*.prisma` for each.

These services were written against a schema that has never existed here. That
is a design gap, not a configuration mistake, and it cannot be closed by fixing
the schema path.

**Consequence for the build order:** slice 05 (Bites) extends `food-service`, and
several slices depend on `notification-service`. Both need their data model
designed and agreed before the slice can start — on top of the
`merchants`/`menu_items` collision already recorded in §3.2. Nothing here was
guessed at or patched over, because doing so would mean inventing a schema.

### Go services

**No Go service in the repository had a tracked `go.sum`.** `git ls-files
'services/*/go.sum'` returns nothing at the audit baseline, so all three failed
to build from a clean checkout — dependency resolution is not reproducible
without it.

| Service | Before | After |
|---|---|---|
| `ride-service` | **could not build** — no `go.sum` | in progress (slice 02) |
| `location-service` | **could not build** — no `go.sum` | builds, vets clean |
| `delivery-service` | **could not build** — no `go.sum`, and `go mod tidy` failed on a test importing a module path that does not exist | builds, vets clean, handler tests pass |

### payment-service: a hand-written shim turns every database query into `any`

`services/payment-service/src/types/prisma.d.ts` contains
`declare module "@prisma/client" { ... }`. That is an **ambient module
declaration**, so it *replaces* the generated Prisma client's types for the whole
service rather than adding to them. Its hand-written `PrismaClient` class ends
with:

```ts
[key: string]: ModelDelegate | ((...args: any[]) => any) | any;
```

Any property access therefore type-checks and yields `any`. Verified directly:

```ts
prisma.thisMethodDoesNotExist().andNeitherDoesThis();  // no error in payment-service
```

The identical line in `food-service`, which has no such shim, is correctly
rejected with TS2339. **Every query, every `where` clause and every `data`
payload in the service that moves money is unchecked.** The model list is also
hand-maintained and already stale: it names 33 models and knows nothing about
`wallet`, `journalEntry`, `journalLine`, `transfer` or `reconRun`.

**Measured:** deleting the file takes `tsc --noEmit` from **350 errors to 1020**.
The extra 670 are real type errors the shim has been suppressing.

The file is left in place with a deprecation header stating all of the above.
Removing it means fixing 670 errors in the money service, which is a scheduled
piece of work and a decision for the team — not a side effect of this pass. The
handoff forbids hand-written duplicates of a generated client, so this must be
resolved before payment-service is launch-ready.

New code does not depend on it: `src/ledger/` imports from
`"@prisma/client/index"` to get the real generated types, which is why the 26
ledger modules typecheck at zero errors against the true schema.

**This revises §6 above.** The "521 pre-existing errors" figure counts what is
*visible*. The true figure for payment-service alone is ~1020, so the repository
carries roughly **1,190 type errors**, not 521.

### The first-failure mask

`@ubi/database` failed `typecheck` on an invalid `ignoreDeprecations: "6.0"`
value (TS5103) that TypeScript 5.9.3 rejects. Because turbo stops at the first
failure, that single line hid the state of every other package. It is removed
from all six tsconfigs that carried it.

## 7. Mock and stub inventory (marker scan)

Files matching `mock data|mock_|MOCK |// Mock|TODO: replace|hardcoded|hard-coded`:

| Area | Files |
|---|---|
| `apps/` | 24 |
| `services/` | 33 |
| `mobile/` | 7 |
| `packages/` | 7 |

This is a marker scan, not a judgement: some are legitimate test fixtures. It is a starting
worklist, not a defect count.

## 8. Route inventory (Next.js `page.tsx` per app)

| App | Pages |
|---|---|
| `apps/driver-app` | 23 |
| `apps/admin-dashboard` | 5 |
| `apps/web-app` | 4 |
| `apps/fleet-portal` | 1 |
| `apps/marketing-site` | 1 |
| `apps/merchant-portal` | 1 |
| `apps/restaurant-portal` | 1 |

The admin navigation advertises far more destinations than the five pages that exist, and
fleet/merchant/restaurant portals are single-page shells. Consistent with the audit.

---

## 9. Verification commands

```bash
# contracts
cd packages/contracts && npx vitest run          # 64 tests
npx tsc --noEmit -p packages/contracts/tsconfig.json

# database — provision an empty database from scratch
psql -h 127.0.0.1 -U ubi -d postgres -c "CREATE DATABASE ubi_test OWNER ubi;"
cd packages/database
DATABASE_URL="postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_test" npx prisma validate
DATABASE_URL="postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_test" npx prisma migrate deploy

# regenerate the state machines from the contract
pnpm --filter @ubi/contracts codegen
```
