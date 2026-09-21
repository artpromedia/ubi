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
- [ ] Prisma migrations `20260920000000_mp_commission_holds` and
      `20260921000000_mp_rider_reservations` deployed; ride-service boot
      migration applied the `mp` schema (advisory-locked, idempotent)
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
2. **R11 delivery custody server-side — CLOSED for the flows below (C07).**
   delivery-service now owns a real custody/return state machine (an
   additive extension of the `shipment` contract machine) backed by
   Prisma-owned tables (`delivery_custody`, `custody_events`,
   `delivery_proofs`, `delivery_returns` — migration
   `20260921033947_delivery_custody`, real FKs to `deliveries`), with
   endpoints for pickup/delivery proof, recipient-unreachable, return
   propose/consent/reject, and collected-at-point, gated to the delivery's
   sender and assigned driver (gateway identity; foreign actor → 404). The
   rider app's `deliveryReturnState`/`deliveryReturnConsent`/`postmarkPickup`
   calls now hit these real endpoints for a marketplace-managed delivery
   (see `docs/marketplace/DELIVERY_CUSTODY.md`). **Still gated/residual:**
   `marketplace_delivery` stays OFF (this closure does not flip it); a
   return-leg CHARGE is recorded but cannot complete — no payment-service
   delivery-return funding endpoint exists, so only a fee-free return or a
   hold-point resolution can finish (`RETURN_CHARGE_UNSUPPORTED` otherwise);
   the object-storage upload/serve path is not wired (proof rows are a
   validated reference — object key + checksum — never the bytes); and the
   gateway-identity signature on these routes is unsigned-trust when
   `RIDE_INTERNAL_CONTEXT_SECRET` is unset, same posture as G03 pre-C03. A
   deeper, pre-existing defect was also found and partially closed while
   wiring this: `deliveries.sender_id`/`driver_id`/most of its data columns
   didn't match what delivery-service's Go code assumed at all (invalid
   UUID ids, nonexistent columns/enum values) — MarketplaceAssign could not
   previously insert a row against the real schema. The column/enum
   mismatch is fixed; a further FK detail (`sender_id` requires a `riders`
   profile row, not a bare user id) is named but not closed — see the C07
   report.
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
6. **Rider funding: wallet is now a durable reservation; PSP provider
   authorization remains deferred.** Wallet funding at selection creates a
   durable `mp_rider_reservations` row (idempotent on the award id) that
   encumbers spendable from selection until the settlement transaction
   consumes it exactly once, or a release (saga compensation, award
   reversal, or the ride-service sweep via
   `POST /v1/wallet/mp/funding/release`) frees it with a linked reason.
   Cash is authorized as explicitly UNSECURED (`secured: false`, audit
   states it). What remains: PSP provider authorization (card,
   mobile-money) is still not built on the canonical ledger — those
   config-listed methods now FAIL CLOSED at
   `/v1/wallet/mp/funding/authorize` (`payment_method_unavailable`:
   config availability is not provider authorization), so they must stay
   hidden from marketplace payment-method selection until a real
   provider authorize/capture flow exists
   (`src/ledger/mp-funding.ts`, payment-service QUARANTINE.md).
7. **Driver cancel of a marketplace execution ride is now terminal (C04,
   closes G04).** The rider machine gained the `cancelled_by_driver`
   terminal state (reachable from `driver_assigned`, `driver_arrived` and —
   for the repair path — `rematching`); a driver cancelling a
   marketplace-managed ride ends it there instead of `rematching`, and the
   terminal funnel releases the capacity claim, cancels the award, reverses
   the captured commission and releases the rider's funding reservation
   exactly once through the existing `reverseCapturedHold`-backed path
   (idempotent under the award's reverse/release keys, sweep-backstopped),
   then promotes or releases a queued next job through the normal promotion
   logic from the driver's actual position. The originating request keeps
   its terminal state with `closeReason: driver_cancelled`, so the rider
   app can render "driver cancelled — search again?"; a new search starts
   only when the requester explicitly publishes a new request. Legacy
   (non-marketplace) rides keep today's `rematching` re-dispatch behavior
   unchanged. Rides stranded in `rematching` by cancellations that predate
   this change converge through the admin repair
   `POST /v1/admin/mp/repairs/stranded-rides` (`{dryRun, rideIds?, limit?}`,
   Idempotency-Key honored, hard cap 50 rides per call, audited per ride),
   which drives the same terminal funnel and never touches money rows
   directly (see RUNBOOK.md).
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
