# Negotiated-fare marketplace — implementation record

Implements the UBI marketplace prompt pack (20 Sep 2026) and its Claude
Design handoff (`handoff-marketplace`, boards R01–R11 · D01–D12 · A01–A09)
on top of commit `a6bb8c8`. Slices M01–M09, including M03A and M05A.

The requester publishes a server-bounded fare; all eligible drivers discover
it; drivers submit funded private bids (10% commission reserved at bid); the
requester selects the winner; the fee is debited exactly once at selection;
one current execution plus at most one queued next job per driver across
rides AND deliveries.

| Doc                                                                                      | Contents                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [TRACEABILITY.md](./TRACEABILITY.md)                                                     | Every board and business rule → contract, route, schema, test       |
| [RUNBOOK.md](./RUNBOOK.md)                                                               | Operating the engine: sweeps, reconciliation, kill switch, recovery |
| [ROLLOUT.md](./ROLLOUT.md)                                                               | Activation checklist, policy values to record, residual blockers    |
| [../adr/0002-marketplace-award-authority.md](../adr/0002-marketplace-award-authority.md) | Architecture: one award authority, thin execution adapters          |

## Where the code lives

| Concern                                    | Location                                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wire contracts                             | `packages/contracts/src/marketplace.ts`, `city-config.ts` (policy), `contracts/openapi/marketplace.yaml`, `contracts/state-machines.json` (mp\*), `contracts/events/catalog-additions.md` |
| Award engine (M02/M03/M03A/M05/M05A)       | `services/ride-service/internal/marketplace/` (+ `internal/machine`, `internal/cityconfig/marketplace.go`, `internal/handler/marketplace.go`)                                             |
| Wallet encumbrances + settlement (M04/M06) | `services/payment-service/src/ledger/{mp-holds,mp-funding,balances,limits,ride-posting}.ts`, `src/routes/mp-holds.ts`, migration `20260920000000_mp_commission_holds`                     |
| Realtime fan-out (M07)                     | `services/realtime-gateway/src/marketplace-events.ts`                                                                                                                                     |
| Gateway routing/scopes                     | `services/api-gateway/src/routes/proxy.ts`, `src/identity/scopes.ts`                                                                                                                      |
| Delivery adapter                           | `services/delivery-service/internal/handlers/marketplace.go`                                                                                                                              |
| Rider app (M08)                            | `apps/rider-mobile/src/screens/marketplace/`, `src/api/marketplace.ts`                                                                                                                    |
| Driver app (M08)                           | `apps/driver-mobile/src/screens/marketplace/`, `src/api/marketplace.ts`, `src/lib/motion.ts`                                                                                              |
| Admin console (M09)                        | `apps/admin-dashboard/src/app/(admin)/marketplace/`, `src/lib/marketplace-api.ts`                                                                                                         |

## Core invariants and where they are enforced

- **A driver's "accept" is a bid, never an assignment** — `mpBid` machine;
  the winner exists only after the requester's selection commits
  (`mp.awards`, partial unique `awards_one_live_per_request`).
- **10% commission, 1,000 bps, half-up** — `MarketplacePolicySchema.commissionBps`
  is `z.literal(1000)`; `commissionMinorFor` (TS) and `CommissionMinor` (Go)
  are the only implementations; the admin console renders the rate read-only.
- **Reserved at bid, debited once at selection** — a bid becomes live only
  after `reserveHold` succeeds; `captureHold` posts the single journal debit
  keyed by the award id; `postMarketplaceCompletion` never charges it again.
- **One spendable calculation** — `spendableOf = balanceOf − active holds`,
  enforced inside `assertSufficientFunds`, which every debit path calls.
- **One current + one dependent next job across services** —
  `mp.driver_claims` partial unique indexes (award_pending counted).
- **`award_pending` never times out while a debit may commit** — the state
  machine has no timeout edge; the reconciliation sweep resolves unknowns.
- **Bids are private** — rider sees only their request's offers; a driver
  sees only their own bid; realtime fan-out routes by engine-named audience
  and strips recipient lists.
- **Unconfigured markets fail closed** — `marketplaceBoundsFor` /
  `MarketplacePolicyFor` throw `market_not_configured` (503); flags are
  deny-by-default per city (`marketplace_rides`, `marketplace_delivery`,
  `marketplace_queued_jobs`).
