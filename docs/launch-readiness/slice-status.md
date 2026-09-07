# Slice implementation status

Tracks the twelve slices in `docs/launch-readiness/handoff/slices/` against what is
actually in this branch. "Verified" means a command was run and its output checked, not that
the code looks right.

Statuses: **done** · **partial** · **not started** · **blocked**

| Slice | Scope | Status |
|---|---|---|
| — | Foundation: `packages/contracts`, Prisma models, migration chain, CI gates | **done** — 64 tests |
| 01 | City config + deny-by-default flags | **done** — 90 tests |
| 02 | Move core lockstep (`ride-service`, Go) | **done** — 67 tests, race-clean |
| 03 | Auth, KYC, device trust, gateway identity context | **done** — 281 tests |
| 04 | Wallet: double-entry ledger, P2P, NIP, saga, statements, finance recon | **done** — 77 tests |
| 05 | Bites | **done** — 27 tests (backend); Flutter/console screens pending |
| 06 | Send | not started |
| 07 | Flights (One-Ticket) | not started |
| 08 | Journeys and reservations | not started |
| 09 | Stays | not started |
| 10 | Fleet | not started |
| 11 | Ops: support, safety, reviews, audit | in progress |
| 12 | Android parity, testIDs, Maestro | partial — testID registry only |

**579 tests green** across the five completed areas.

## Slice 05 is blocked, not merely unstarted

Two things must be decided before any Bites code is written:

1. `food-service`, which slice 05 extends, **does not compile** — 116 type errors,
   almost all of them references to Prisma models (`menuCategory`, `order`, …)
   that exist in no schema file in the repository. Its data model has to be
   designed, not recovered. See `current-state.md` §6.
2. The `merchants` and `menu_items` table names collide with existing models
   (ADR 0001 §8).

Slices 06–10 are untouched by design: the handoff's own build order puts foundations,
Move, auth and wallet first.

---

## Foundation (verified)

| Item | Evidence |
|---|---|
| `packages/contracts` | `npx vitest run` → 64 passed |
| State machines generated from the contract | `pnpm --filter @ubi/contracts codegen` |
| Prisma schema validates | `npx prisma validate` → valid (previously failed P1012) |
| Empty database provisions | `npx prisma migrate deploy` → 3 migrations applied |
| No schema drift | `prisma migrate diff --exit-code` → "No difference detected" |
| Ledger invariant enforced by the database | unbalanced entry refused at COMMIT, nothing persisted |
| Monorepo typechecks | `turbo run typecheck --filter=./packages/*` → 11 passed |
| Slice 01 | `vitest run` → 90 tests (config-service 66, config-client 24) |
| Slice 02 | `go build`, `go vet`, `go test -count=1 ./...` → 6 packages, 67 tests, `-race` clean |
| Slice 02 headline guard | 64 concurrent accepts on one offer with Redis DISABLED → exactly one winner, verified in the database |
| Slice 03 | 73 gateway + 208 user-service tests; forged `x-auth-*` headers stripped; scopes cannot be widened by a token |
| Slice 04 | `vitest run tests/ledger tests/finance` → 71 tests on a fresh database |
| Go services | `go build ./...` and `go vet ./...` clean for location- and delivery-service |
| Contracts | `node tooling/scripts/validate-contracts.mjs` → all six documents resolve |

## Known verification gaps

1. **No Flutter or Dart SDK in this environment.** Every Dart change is author-reviewed,
   not compiler-verified. The new CI `mobile` job closes this on GitHub runners, but it is
   `continue-on-error` until the existing analysis failures are cleared.
2. **No Maestro flows yet.** Slice 12 lists 30 named flows. Only the testID registry that
   they depend on exists.
3. **The old and new ledgers coexist.** Only the new one is balance-enforced (ADR 0001 §4).
4. **`payment-system.sql`** still sits outside the timestamped migration structure. It was
   not folded in, because doing so needs a decision about whether it was ever applied to a
   real database.
5. **The wallet and recon tests are not self-cleaning.** They seed fixed dates and ids and
   assume a freshly migrated database. Run twice against the same database and the second
   run fails in ways that look like logic bugs but are leftover rows. A schema per test run
   would fix it.
6. **payment-service test files no longer run in parallel.** They share one database and
   their fixtures collided, which presented as flakiness. Serialising them is a stopgap;
   per-file isolation is the real fix.
