# ADR-0002: One marketplace award authority for rides and deliveries

Date: 2026-09-20 · Status: accepted · Slice: M01 (prompt pack §5)

## Context

The negotiated-fare marketplace lets a requester publish a server-bounded
fare, eligible drivers submit funded private bids (10% commission reserved at
bid time), and the requester select the winner — one commission debit, one
winner, one current execution plus at most one queued next job per driver
across rides AND deliveries.

Today the two execution paths could not be more different:

- **ride-service** (Go) is the strict codebase: signed quotes, machine-checked
  transitions ported from `contracts/state-machines.json`, per-ride Redis lock
  → conditional UPDATE → partial unique indexes as final authority, scoped
  idempotency with byte-replayed responses, transactional outbox + audit in
  the same tx, durable sweeps.
- **delivery-service** (Go) claims work with a naive 30s Redis SETNX and a
  non-transactional read-check-update (`AcceptDelivery`), publishes
  fire-and-forget Redis pub/sub instead of the outbox, and its `deliveries`
  DDL is not owned by any migration in the repo.

Building a second bidding engine inside delivery-service would duplicate the
race-prone parts the prompt pack explicitly forbids, and no DB constraint
could span two engines' tables to enforce the cross-service driver capacity
invariant.

## Decision

1. **The marketplace engine lives in ride-service** as a new
   `internal/marketplace` package owning a new Postgres schema `mp`
   (requests, revisions, bids, commission-reservation references, awards,
   driver work claims, reconciliation attempts), applied via the embedded
   schema.sql / `Store.Migrate` house pattern. It reuses ride-service's
   pricing engine, router, signed quotes, city config provider, machine
   port, outbox writer, idempotency store and sweep runner.
2. **Driver capacity is one table**: `mp.driver_claims` holds the `current`
   and dependent `next` slots for BOTH services, with partial unique indexes
   as the final authority (one current claim per driver, one next claim per
   driver, `award_pending` claims included). Execution services couple their
   transitions to fenced claim ownership (fencing token + availability
   epoch); a service-local write may not bypass the claim.
3. **Execution adapters are thin.** On `award.confirmed` the engine creates
   the ride execution row itself (same DB, same tx domain) or calls a
   service-authenticated assignment endpoint on delivery-service; either way
   the adapter carries the award id, the fencing token and no pricing
   authority. Legacy direct-accept endpoints (`AcceptOffer`,
   `AcceptDelivery`) refuse marketplace-managed jobs.
4. **payment-service stays the only money truth.** Commission encumbrances
   are a `CommissionHold` table plus ONE spendable calculation
   (`spendableOf = balanceOf − active holds`) threaded through every debit
   path; capture posts the single 10% journal debit under the award id. The
   marketplace engine talks to it over service-authenticated, idempotent
   HTTP (reserve / adjust / release / capture / reverse) with payload-hash
   conflict detection — no second balance source of truth, no ledger writes
   from Go.
5. **Award is a durable saga, not a transaction.** Ledger (payment-service)
   and award (ride-service) live in different owners, so selection runs:
   atomically claim request + driver capacity (`award_pending`, immutable
   award id) → authorize rider funding → capture the winning hold
   (idempotent on award id) → commit execution + outbox → resolve losers.
   Unknown financial outcomes stay `award_pending` until the reconciliation
   sweeper resolves them; the state machine deliberately has no timeout edge
   out of `award_pending`.
6. **Rollout flags are per city and per service** (`marketplace_rides`,
   `marketplace_delivery`, `marketplace_queued_jobs`), deny-by-default, with
   the numeric policy in the versioned `CityConfig.marketplace` block —
   unconfigured markets fail closed (`market_not_configured`).

## Consequences

- Rides and deliveries get identical negotiation semantics from one code
  path; the cross-service "one current + one next" invariant is a DB
  constraint, not a convention.
- delivery-service keeps its legacy instant flow for non-marketplace jobs
  untouched; marketplace deliveries only enter it at assignment time.
- ride-service gains an HTTP dependency on payment-service for bid funding;
  the compensating sweeps and `award_unresolved` semantics in M04/M05 are the
  price of not smuggling money writes into Go.
- The wire contract is `contracts/openapi/marketplace.yaml` +
  `packages/contracts/src/marketplace.ts`; the Go engine and TS services must
  both be regenerated/rebuilt when it changes.
