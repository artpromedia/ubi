# Marketplace runbook

## Moving parts

- **ride-service** hosts the engine (schema `mp`), the eligibility evaluator,
  the award saga and two background loops wired in `cmd/server/main.go`:
  the existing move dispatcher and the marketplace **sweeper** (bid/request
  expiry, envelope expansion, queued-window recomputation, promotion
  backstop, reservation recovery, award reconciliation).
- **payment-service** owns money: `mp_commission_holds` plus the journal.
  Spendable = balance − active holds, everywhere.
- **realtime-gateway** relays `event:mp.*` outbox events to the engine-named
  audience only. Pushes are hints; DB state is the authority and clients
  reconverge through REST snapshots.
- Cross-service calls: ride→payment (`/v1/wallet/mp/holds/*`,
  `/v1/wallet/mp/funding/authorize`) and ride→delivery
  (`/api/v1/webhooks/marketplace-assign`), all `X-Service-Key`
  (INTERNAL_SERVICE_KEY) + Idempotency-Key.

Required env: ride-service `PAYMENT_SERVICE_URL`, `INTERNAL_SERVICE_KEY`
(funding/holds fail closed when unset — selection cannot complete);
realtime-gateway `SERVICE_SECRET`/`INTERNAL_SERVICE_KEY` (broadcast endpoint
is open with a logged warning when unset — set in production).

## Health signals to watch (A06 metrics inputs)

- `mp.awards` age in `pending` (saga stuck: wallet capture unknown, funding
  outage). The reconciliation sweep re-polls; a growing backlog means the
  wallet path is down, not that awards should be reopened.
- `mp.reservation_recovery` backlog (holds whose release/reverse failed —
  the sweep retries with backoff; investigate payment-service if it grows).
- `mp.driver_claims` in `next` whose dependency ride is terminal for longer
  than a sweep period (promotion misfiring).
- Holds in `capture_pending` in `mp_commission_holds` older than minutes
  (capture crashed mid-flight; the award reconciliation resolves it).
- Feed/bid rejection rates by eligibility reason code (policy tuning).

## Incidents

**Award stuck in `award_pending`.** Do nothing destructive. The sweep polls
capture status by award id until definite, then confirms or compensates.
Never manually reopen the request while the debit may still commit
(`award_unresolved` is the guard). If payment-service was down, restore it;
the sweep converges.

**Driver reports fee taken but no job / job lost.** Look up the award:
`failed`→`compensated` must show the linked `mp_commission_reversal` journal
entry. If the award is `confirmed` but execution is missing (delivery
adapter outage), the claim still owns the slot: re-fire the assign webhook
(idempotent on awardId) or cancel the award through the engine (reverses
the fee).

**Queued pickup badly delayed.** The sweep emits `mp.queue.window_missed`
once past tolerance; the rider gets the fee-free exit which reverses the
captured fee exactly once. Ops must not hand-edit balances — remedies go
through `/v1/finance/remedies` or the award cancel path.

**Kill switch.** `Stop new awards` in the admin console (or
`PUT /v1/flags/marketplace_rides` / `marketplace_delivery` per city,
enabled=false). Deny-by-default means NEW quotes/publications/bids stop
immediately; existing bids, holds and awards resolve through their normal
lifecycle. It never reverts active negotiated jobs to legacy settlement.
`marketplace_queued_jobs` off stops new next-slot bids only.

**Redis loss.** Stationary sample ring and parked attestations live in
Redis: bidding degrades to NOT_STATIONARY/LOCATION_STALE (fail closed);
feeds and money paths are unaffected. Realtime hints stop; clients converge
by polling.

## Policy changes (A03/A07)

Marketplace policy lives in the versioned `CityConfig.marketplace` block and
changes only through config-service's two-person change-request flow. The
commission is not a policy value: 1,000 bps is a contract literal and any
config claiming otherwise fails validation. Removing the block (or a
service:vehicle pair from `fareBounds`) fails that market closed with
`market_not_configured` — that is the intended emergency posture, not an
error.

## Test databases / local verification

Postgres with the Prisma migrations applied plus Redis; then:

```
pnpm --filter @ubi/contracts build && pnpm --filter @ubi/contracts test
cd services/ride-service && RIDE_TEST_DATABASE_URL=... go test ./...
cd services/payment-service && WALLET_TEST_DATABASE_URL=... pnpm exec vitest run tests/ledger
pnpm --filter @ubi/api-gateway test
cd services/realtime-gateway && pnpm exec vitest run
pnpm --filter @ubi/rider-mobile test && pnpm --filter @ubi/driver-mobile test
pnpm --filter @ubi/admin-dashboard test
```
