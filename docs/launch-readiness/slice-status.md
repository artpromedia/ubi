# Slice implementation status

Tracks the twelve slices in `docs/launch-readiness/handoff/slices/` against what is
actually in this branch. "Verified" means a command was run and its output checked, not that
the code looks right.

Statuses: **done** · **partial** · **not started** · **blocked**

| Slice | Scope | Status |
|---|---|---|
| — | Foundation: `packages/contracts`, Prisma models, migration chain, CI gates | done |
| 01 | City config + deny-by-default flags (`config-service`, `config-client`) | see below |
| 02 | Move core lockstep (`ride-service`, Go) | see below |
| 03 | Auth, KYC, device trust, gateway identity context | see below |
| 04 | Wallet: double-entry ledger, P2P, NIP, saga, statements | see below |
| 05 | Bites | not started |
| 06 | Send | not started |
| 07 | Flights (One-Ticket) | not started |
| 08 | Journeys and reservations | not started |
| 09 | Stays | not started |
| 10 | Fleet | not started |
| 11 | Ops: support, safety, reviews, audit, finance recon | see below |
| 12 | Android parity, testIDs, Maestro | partial — testID registry only |

Slices 05–10 are untouched by design. The handoff's own build order puts foundations,
Move, auth and wallet first, and slice 05 additionally needs the `merchants`/`menu_items`
table-name collision resolved (ADR 0001 §8) before any model can be added honestly.

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
