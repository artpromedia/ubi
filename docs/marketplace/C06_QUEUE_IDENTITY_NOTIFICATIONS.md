# C06 — Queue, identity projections and durable notifications

What this slice implemented, and the decisions behind each part. **Implemented ≠
enabled:** queued next-jobs stay **OFF** (the `marketplace_queued_jobs` flag is
deny-by-default and untouched) until these paths are exercised in a pilot. The
rider queue endpoint, the PIN retrieval endpoint and the winner/offer identity
projection work today for current-slot awards; the queued-job path they also
serve only lights up where the flag is turned on.

## G07 — Rider queue projection

- `GET /v1/mp/requests/{id}/queue` (ride-service). Owner-only: the ownership
  check mirrors the request snapshot, so a foreign rider gets **404** (existence
  not leaked), matching the C04 authz tests.
- Authorized + versioned: `version` mirrors the request version (optimistic
  refresh); `asOf` stamps freshness so a client can detect a stale ETA.
- Composed server-side from the real state: claim/job `status`
  (`queued`/`promoting`/`assigned`/`arrived`/`in_progress`/`settled`/
  `cancelled`), `promotion` (reusing the driver-jobs promotion state), the ETA
  vs the consented window, the pickup window + its `uncertaintySec`, and the
  rider's `actions` (`canCancel`, fee-free `feeFreeExit` once the window breaks).
- rider-mobile: `marketplaceApi.queue` now points at the real endpoint (PROPOSED
  marking removed); `MpQueueView` is the `@ubi/contracts` type; the dev fixture
  mirrors the real shape. `deliveryReturnState`/`deliveryReturnConsent` stay
  PROPOSED (that is G08, out of scope).

## G09 — Winner/verified driver projection

See `DRIVER_IDENTITY.md`. Decision in one line: ride-service owns **no** verified
driver identity/rating/vehicle-registry data and makes no cross-service call for
it, so `verifiedDriverView` exposes only the server-verified vehicle class and
marks identity/rating **`profileStatus: "unavailable"`** rather than fabricating
`0`/`"–"` as real. Offer, winner and queue projections share the one function,
so they are consistent. The user-service verified-profile join is the tracked
remaining dependency (A08).

## Secure PIN retrieval for promotion-created rides

- **Storage decision.** Ride PINs are **bcrypt-hashed** in `ride.rides`
  (`internal/move/pin.go`) and cannot be re-derived. The current-slot award
  reveals the PIN once in the `/select` response, but a **promotion** creates the
  ride with no rider call in flight — so the PIN would otherwise be unreachable.
  We therefore **capture the plaintext at ride creation** (inside
  `createExecutionRide`, shared by both the select and promotion paths) into a
  new `mp.execution_pins` vault, **encrypted at rest with AES-256-GCM**. The key
  is derived from the service secret (`RIDE_PIN_VAULT_SECRET`, falling back to
  `RIDE_INTERNAL_CONTEXT_SECRET`; a fixed dev key when neither is set), so a
  database reader without the app secret still cannot read a usable PIN — the
  same posture bcrypt gives the hash.
- `GET /v1/mp/requests/{id}/pin`: entitled requester only (foreign → 404);
  refused (**409**) unless the execution ride is in a PIN-relevant state
  (`driver_assigned`/`driver_arrived`/`pin_verification`), checked **live**
  against ride state so a spent PIN cannot be re-fetched; rate-limited
  (**429**, a fixed window on the vault row). The PIN is returned only in the
  response body — **never** in an event, a push payload or a log (the handler's
  error logger records code+path only). Tests assert all four cases and that the
  plaintext never appears in any outbox payload, across the whole ride lifecycle
  and after a promotion.

## G10 — Durable marketplace push (notification-service)

- Subscribes to the canonical `event:mp.*` outbox stream (same stream
  realtime-gateway consumes), replacing the logging-stub handlers.
- **Dedupe / DLQ mechanism = Redis** — the store notification-service already
  uses (cache, pub/sub, rate-limit, OTP). No new datastore, and the shared
  Prisma schema is untouched:
  - dedupe: `SET NX` on the event id (via `@ubi/outbox` + a deliverer-level
    guard);
  - ordering: a per-subject max-sequence guard (Lua CAS) drops out-of-order and
    superseded/expired events;
  - retry: capped exponential backoff (`@ubi/outbox` `backoffDelayMs`), then a
    **dead-letter list** (`notif:mp:dlq`);
  - offline recipients are **recorded for retry** (`notif:mp:pending`) rather
    than dropped;
  - token rotation: FCM invalid-token failures deactivate the token
    (`sendClassifiedMulticast` classifies unregistered vs transient);
  - preferences: per-user push opt-out honored; documented default **allow**
    when no preference row exists.
- **Privacy:** winner and loser are notified **without** any bid amount — the
  payload is a **hint** only (ids + type), never money and never a PIN; bid
  events stay private to requester + bidding driver (rivals never notified).
  Asserted in `src/marketplace/push.test.ts`.
- The deliverer is pure and port-driven (unit-tested with in-memory fakes, no
  Redis/Prisma/FCM); production wiring is in `src/marketplace/consumer.ts`.

## G15 — Dedicated settlement event (consumer side only)

- Added the name **`mp.settlement.posted`** to `@ubi/contracts` `EVENT_NAMES`,
  the Go `eventNames` registry, and the event catalog.
- **notification-service** and **realtime-gateway** recognize it now, alongside
  the legacy `transfer.posted` / `payment.cash_acknowledged` names.
- **Scope split (important):** payment-service is the producer and is **out of
  scope** — it is **not** edited here. When payment-service later emits
  `mp.settlement.posted` (alongside the old names, for a backward-compatible
  rollout), the consumers already handle it. realtime-gateway needs no per-name
  wiring — the name matches its `event:mp.*` pattern and its payload resolves
  through the default audience branch.

## A07 — DriverView cross-city exposure

`marketplace DriverView` (`feed.go`) let any driver-role identity view any OPEN
request by id with only the per-city flag. **Decision: small fix.** Drivers
legitimately need to see requests to bid, and the feed is already city-scoped,
but a driver could probe (and bid on) an out-of-city request by id. `DriverView`
now returns **404** when the request's city differs from the driver's actor
city, so existence — and the feed item's coarse pickup label/distance — is not
leaked cross-city. Eligibility still gates whether an in-city driver can bid.
No rate-limiting added: reads are cheap and already flag/eligibility gated;
over-engineering avoided.
