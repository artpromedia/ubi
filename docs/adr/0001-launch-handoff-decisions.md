# ADR 0001 — Decisions taken while implementing the launch handoff

**Status:** accepted for the slices implemented on `claude/handoff-implementation-h2p0f0`
**Date:** 2026-09-07
**Context:** the design handoff in `docs/launch-readiness/handoff/`, applied to the repository
at `8aa7c26`.

Each decision records what the handoff asked for, what the repository actually contains, and
why the resulting choice is the one that keeps both true. Where a decision is genuinely the
team's to make, it is marked **OPEN** rather than settled quietly.

---

## 1. The handoff contracts are vendored into the repository

`contracts/` at the repository root now holds the OpenAPI documents, the event catalog, the
state machines and the semantic tokens, copied verbatim from the handoff.

Code generated from a document that lives only in a zip drifts the moment the zip is lost.
`packages/contracts` generates its state machines from `contracts/state-machines.json` at
build time (`pnpm --filter @ubi/contracts codegen`), so a contract change is a diff rather
than a memory.

## 2. `ride-service` stays Go

The handoff README describes the services as "Hono + zod-openapi + Prisma + Redis
(TypeScript, vitest)". That holds for payment, user, food, notification, realtime and the
gateway. It does **not** hold for `ride-service`, `location-service` or `delivery-service`,
which are Go (chi, pgxpool, go-redis).

Slice 02 targets `ride-service`. The handoff's own first rule is to ground everything in
what exists and not to invent alternatives, so slice 02 is implemented in Go and the
canonical state machines are ported into it rather than the service being rewritten.

**Consequence:** the rider and driver machines exist in two languages. They are generated
from, and tested against, the same `contracts/state-machines.json`, so a divergence is a
test failure rather than a silent inconsistency.

## 3. Money is integer minor units, not `Decimal`

The original schema stores money as `Decimal(19,4)`. Every handoff table stores
`bigint` minor units plus an explicit currency column, and CLAUDE.md requires it.

New models follow the handoff. The reason is not style: the double-entry invariant is
"the lines of an entry sum to exactly zero", and that is only decidable over integers.
A decimal ledger has to choose a tolerance, and a tolerance is a hole.

`splitPercent()` in `@ubi/contracts` returns the rounding remainder alongside the part, so
a percentage split (a 20% service fee) can be posted as journal lines that still sum to
zero, rather than losing a kobo to rounding.

**Consequence:** two money conventions coexist, separated by module. They are not mixed
within a single flow.

## 4. The new ledger is added beside the old one, not on top of it

`payment-service` already contains `WalletAccount`/`LedgerEntry`/`Transaction` and a large
body of code around them. The handoff's ledger is `wallets`/`journal_entries`/
`journal_lines`.

The new ledger is added as a separate module. Nothing in the old path is deleted, per the
handoff rule to preserve working code and replace only once tests demonstrate equivalent
behaviour.

**OPEN:** retiring the old ledger. Only the new one is balance-enforced by the database,
so running both indefinitely means running one ledger that cannot go wrong beside one that
can. This needs an owner and a date.

## 5. The double-entry invariant lives in the database

`20250101000001_ledger_balance_constraint` adds a **deferred constraint trigger**: an entry
whose lines do not sum to zero per currency is refused at `COMMIT`.

Deferred, not immediate, because an entry and its lines are written in one transaction and
the balance is only meaningful once all the lines are in. In the database, not in the
service, because an invariant enforced by convention is enforced by whoever remembers it.
`wallet_balances` is a view for the same reason: a stored balance is a second source of
truth that can disagree with the journal.

CI asserts the trigger still bites, by trying to commit an unbalanced entry and failing the
build if it succeeds.

## 6. Deny-by-default flags fail closed on the client too

`packages/config-client` resolves every flag to `false` when the config service is
unreachable, and `getCityConfig` rejects rather than returning a fallback.

A client that fails open into a half-built vertical is worse than one that shows nothing:
the handoff's honest-unavailability rule (#8) means a feature that cannot be confirmed
available is shown as unavailable. A disabled vertical answers `404`, not `403`, so a deep
link cannot even confirm the feature exists.

## 7. States declared only as transition targets are treated as terminal

`contracts/state-machines.json` references states in transition targets that are never keys
in the `transitions` map — `rider.cancelled_by_rider`, `shipment.return_to_sender` and
others (the full list is in `TERMINAL_ONLY_STATES` and in `current-state.md`).

Dropping them from the state union would make a legal transition untypeable; inventing
transitions out of them would be inventing contract. They are kept as terminal states and
reported.

**OPEN:** whether each is genuinely terminal. `rider.cancelled_by_rider` and
`reservation.completed` look most like omissions.

## 8. Slices 05–10 got no Prisma models in this pass

The handoff DDL says "keep names". Two of its tables already exist with different shapes:
`merchants` (existing `Merchant` vs the Bites merchant with CAC/TIN/KYB) and `menu_items`
(existing `MenuItem` vs the Bites item with option groups).

Adding sixty models for slices with no service behind them would have meant resolving that
collision by fiat, in a direction nobody had chosen. Models were added only for the slices
actually implemented, so nothing is decided by default.

**OPEN, before slice 05 starts:** rename the new tables, migrate the existing models onto
the new shape, or namespace one side.

## 9. `deploy.yml` and `release.yml` were not pointed at `master`

CI, tests and infrastructure validation were dormant because they trigger on `main` while
the default branch is `master`; they now include `master`.

Deployment and release were left alone and annotated instead. Adding `master` there would
arm deployment and package publication on every merge to the default branch. That is an
operational decision with outward-facing consequences, not a repair, and it belongs to
whoever owns the release process.

## 10. Flutter changes are not compiler-verified

There is no Flutter or Dart SDK in the environment used for this work. Dart changes are
author-reviewed only.

Removing mock data and hard-coded literals is low-risk without a compiler; restructuring
dependency injection is not, so the known-broken DI in `rider_app/injection.dart` is
reported rather than rewritten. Every file carrying this risk is listed in the slice status
document.

**Required before this is trusted:** `flutter analyze` and `flutter test` in CI, which the
repository does not have today.
