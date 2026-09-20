# Rollout checklist and residual blockers

Production rollout is a separate explicit action after this evidence is
reviewed (pack §M09). Nothing here is enabled by default: all three flags
are deny-by-default and every market fails closed until its policy block is
configured and activated through the two-person config flow.

## Before activating any market

Record these versioned policy values per city (fixture numbers in tests and
dev fixtures are NOT production defaults):

- [ ] `fareBounds` per `service:vehicleClass` — absolute floor, cost-based
      floor, floor bps of suggested, ceiling bps of suggested
- [ ] `searchEnvelope` — initial/max radius, initial/max pickup ETA budget,
      expand-after, min offers before expand, expansion steps
- [ ] `stationary` — dwell, speed gate, location freshness/accuracy, close
      hysteresis
- [ ] `finishingTrip` — max remaining service time, completion and
      uncertainty buffers, corridor bearing delta
- [ ] `bids` — bid/request expiry, revision cooldown, per-driver live-bid
      cap, per-requester open-request cap
- [ ] `queue.pickupWindowToleranceSec`
- [ ] `rateProfileBounds` per scope — max per-km rate, max minimum trip fare
- [ ] cancellation/refund matrix ownership confirmed (default implemented:
      pre-service cancellation, technical failure and driver no-show reverse
      the commission via linked entries; any penalty retention needs its own
      versioned policy before activation)

Deployment prerequisites:

- [ ] `INTERNAL_SERVICE_KEY` + `PAYMENT_SERVICE_URL` set for ride-service;
      `SERVICE_SECRET` set for realtime-gateway (broadcast auth)
- [ ] Prisma migration `20260920000000_mp_commission_holds` deployed;
      ride-service boot migration applied the `mp` schema (advisory-locked,
      idempotent)
- [ ] Alert thresholds configured for the RUNBOOK health signals (explicit
      deployment configuration, not code defaults)

## Staged activation

1. `marketplace_rides` on for one pilot city, `marketplace_queued_jobs` OFF
   (stationary-only pilot — supported and honest: finishing-trip bids answer
   `QUEUE_DISABLED`).
2. Observe: publish→first-offer latency, publish→award latency, funding
   rejection rate, hold-release lag, pending-award age, reservation-recovery
   backlog, cancellation rates.
3. `marketplace_queued_jobs` on (queued next jobs, pickup-window consent,
   promotion, fee-free missed-window exit).
4. `marketplace_delivery` on after the delivery pilot checklist below.
5. Kill switch at any point: flags off stop NEW publication/awards while
   existing bids/holds/awards resolve safely.

## Feature-complete vs. staged-off

Queued next jobs and driver rate profiles are IMPLEMENTED and tested; a
pilot may run with `marketplace_queued_jobs` off, but that gating is
activation staging, not a missing feature.

## Residual blockers (explicit, per the pack's completion gate)

Marked unsupported/unresolved rather than papered over:

1. **Execution surfaces are RN-01/RN-02 placeholders.** After
   `award.confirmed`, rider `Ride.Active`/PIN and driver trip execution
   screens do not exist yet in the RN apps (pre-existing gap the pack's
   repo review also flagged). The marketplace hands off correctly — ride
   rows with the execution ref, PIN generated/hashed, one-time reveal in
   the select response now parsed and passed to the Assigned route by the
   rider app — but the placeholder Assigned screen does not yet render the
   PIN; the in-trip UI is the outstanding RN port.
2. **R11 delivery custody server-side.** The return-consent/custody-proof
   endpoints for delivery exceptions are fixture-backed only
   (`apps/rider-mobile/src/api/marketplace.ts` marks them PROPOSED);
   delivery-service has no managed custody/returns model yet — its
   `deliveries` DDL is itself unmanaged (pre-existing schema drift risk).
3. **R10 queue projection.** `GET /v1/mp/requests/:id/queue` remains a
   PROPOSED read projection served by fixtures (the underlying state and
   events exist server-side). `GET /v1/mp/driver/jobs` is now implemented
   per the DriverJob contract; its schema carries no award-confirmed
   "winner toast" composition, so the D05 winner card renders only from
   fixtures until that projection is added.
4. **Promotion-created ride PIN delivery.** The PIN for a ride created at
   promotion has no delivery channel to the rider yet (needs a realtime
   push or one-time reveal endpoint).
5. **Driver display data.** Rider-facing offer cards use server-derived
   pseudonymous name/initials and masked plate; a user-directory join for
   real display name/rating/vehicle is not wired.
6. **Rider funding is a check, not an authorization hold.** Wallet rides
   settle at completion exactly like legacy rides; a true rider-side
   encumbrance from selection to completion is a follow-up
   (`src/ledger/mp-funding.ts` documents the semantics).
7. **Driver cancel of a marketplace execution ride** lands in `rematching`
   (contract machine has no driver-cancel terminal edge); Dispatch skips
   marketplace rides so nothing re-offers, but ops must resolve such rides
   until a contract state-machine change lands.
8. **Motion telemetry (RN-02).** `useMotionGate` is driven by the explicit
   parked attestation + dev signals; production GPS/motion wiring does not
   exist in driver-mobile (there is no location plumbing in the app at
   all). The server evaluator is authoritative regardless.
9. **No device/E2E or load evidence from this environment.** Native
   iOS/Android builds, Maestro flows, admin Playwright against seeded
   backends, and the fan-out/bid-burst load tests require CI
   runners/devices this container does not have. Unit/integration coverage
   is listed in TRACEABILITY.md; measured capacity numbers do not exist yet
   and are not claimed.
10. **D12 standing/appeals and admin A04/A05/A08/A06/A09 pages** are
    annotation-only per the design MANIFEST (patterns exist; pages not
    built). The reconciliation data (`mp.award_attempts`,
    `mp.reservation_recovery`) is already queryable.
11. **notification-service push handlers** for `mp.*` events remain
    log-only stubs (its legacy event convention predates the outbox);
    realtime WS + REST snapshots carry the product today.
12. **Ask UBI / airport-reservation adapters** were reviewed for bypass
    only (no marketplace writes exist there); deep integration (Ask
    publishing marketplace requests under mandates) is out of scope and
    remains behind the existing action-grant boundary.
13. **Quarantined legacy payment routes** (`routes/webhooks.ts`,
    `payouts.ts`, `mobile-money.ts` — unmounted per QUARANTINE.md) contain
    inline `X-Service-Key` comparisons that fail open when the env var is
    unset; the live `internalServiceAuth` middleware now fails closed, and
    the quarantined files should be cleaned up or deleted before any of
    them is ever remounted.
14. **Settlement events reuse existing names.** Marketplace completion
    settlement posts under `transfer.posted`/`payment.cash_acknowledged`
    with a marketplace aggregate; a dedicated `mp.settlement.completed`
    event name in the closed catalog would make the ops timeline clearer.
