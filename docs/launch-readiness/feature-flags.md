# Feature flag registry

Every flag, what it gates, and its production default. Flags are **deny-by-default**
and evaluated **server-side per city** (handoff CLAUDE.md #5).

The registry is closed: `FLAG_KEYS` in `packages/contracts/src/flags.ts` is the
source of truth, and `config-service` refuses to create a rule for a key nobody
registered. A flag with no rule falls back to its `defaultOn`, and an unknown
flag is `false` — a service that has never heard of a flag cannot expose the
feature behind it.

## Production defaults

Every flag ships `defaultOn = false`. Nothing is enabled by a default; a city
must be given an explicit rule.

| Flag                | Gates                                               | Lagos (LOS) at launch |
| ------------------- | --------------------------------------------------- | --------------------- |
| `move`              | The Move tile and the whole ride journey            | **on**                |
| `ride_request`      | Kill switch for creating rides, without hiding Move | **on**                |
| `driver_online`     | Kill switch for drivers going online                | **on**                |
| `bites`             | UBI Bites tile, discovery, cart, orders             | off                   |
| `send`              | UBI Send tile, shipments, recipient tracking        | off                   |
| `travel`            | Flights (One-Ticket)                                | off                   |
| `stays`             | Hotels                                              | off                   |
| `journeys`          | Door-to-door itineraries                            | off                   |
| `reservations`      | Scheduled and airport pickups                       | off                   |
| `fleet`             | Fleet console, assignments, remittance splits       | off                   |
| `wallet_p2p`        | Wallet transfers and split fare                     | off                   |
| `wallet_nip`        | Bank transfers out of the wallet                    | off                   |
| `tips`              | Tipping at rating                                   | off                   |
| `scheduled_rides`   | Booking a ride for later                            | off                   |
| `recording`         | In-trip audio/video, market-approved only           | off                   |
| `provider_payments` | Non-cash payment providers                          | off                   |

Only three flags are on for Lagos, and they are exactly the ones the handoff's
build order calls for: Move, and the two kill switches that let ride creation or
driver availability be stopped without taking the whole vertical down.

`recording` deserves a specific note: it stays off until legal and policy approve
it per market, and it is not merely a UI toggle — the handoff requires explicit
education, encrypted local handling, controlled upload, retention limits and an
access audit before it can be turned on anywhere.

## Flags added by the RN migration and the marketplace rounds

Every one of these also ships `defaultOn = false` and is **off in every city**,
Lagos included; nothing in any round enabled one. "Server gate" is the service
that refuses the capability when the flag is off (clients hide it too, but a
client is never the gate). A `marketplace_*` ride capability also needs the
`marketplace_rides` vertical in the same city. Switching any of them off stops
NEW activity only: existing trips, bookings, holds and their recoveries keep
running, so no money is stranded.

| Flag                                     | Server gate (owner)                                                                                                    | What it gates                                                                                                                                                                              | Added                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `ai_assistant`                           | ask-service                                                                                                            | The Ask UBI assistant: threads, messages, read-only tools                                                                                                                                  | RN migration             |
| `ai_transactions`                        | ask-service                                                                                                            | The assistant's transactional path: an explicit confirm mints an action grant, then the execution books                                                                                    | RN migration             |
| `ai_mandates`                            | none server-side (rider-mobile hides the surface; user-service `/mandates` is gated by the `mandate:manage` scope)     | Standing authorisations in the app                                                                                                                                                         | RN migration             |
| `flights_booking`                        | travel-service; payment-service (`/v1/finance/travel`)                                                                 | Flight search and booking, and the wallet authorize / capture / release behind it                                                                                                          | RN migration             |
| `stays_booking`                          | travel-service; payment-service (`/v1/finance/travel`)                                                                 | Hotel search and booking, and its money                                                                                                                                                    | RN migration             |
| `rider_promotions`                       | growth-service (`/v1/benefits`)                                                                                        | Rider promotions: reserve on a promise, consume on qualification, release on expiry                                                                                                        | RN migration             |
| `driver_commission_rebates`              | growth-service (driver incentives)                                                                                     | Driver commission rebates                                                                                                                                                                  | RN migration             |
| `referrals`                              | growth-service (`/v1/referrals`)                                                                                       | Referral codes, qualification and rewards                                                                                                                                                  | RN migration             |
| `ai_marketing`                           | none server-side (growth-service `/v1/ai/marketing` returns drafts only, scope-gated)                                  | The marketing assistant                                                                                                                                                                    | RN migration             |
| `marketplace_rides`                      | ride-service                                                                                                           | The negotiated-fare marketplace for rides: quote, publish, private bids, requester-selected award                                                                                          | M01                      |
| `marketplace_delivery`                   | ride-service (award hand-off to delivery-service and its cancellation); payment-service                                | Negotiated-fare package delivery. What still blocks enabling it: `services/delivery-service/docs/MARKETPLACE-DELIVERY-ENABLEMENT.md`                                                       | M01                      |
| `marketplace_queued_jobs`                | ride-service                                                                                                           | The queued next-job slot (finishing-trip matching): one current + one queued job across rides and deliveries                                                                               | M01                      |
| `ai_marketplace`                         | ask-service                                                                                                            | The assistant quoting, publishing a bounded request and selecting an offer within a grant or mandate. Independent of `marketplace_rides`                                                   | C10                      |
| `marketplace_multi_stop`                 | ride-service                                                                                                           | Ordered intermediate stops on marketplace ride requests (quote, publish, pre-award revision) and per-stop arrival / waiting events                                                         | round 1                  |
| `marketplace_trip_amendments`            | ride-service                                                                                                           | Post-award trip amendments and safe early termination; money moves only through linked adjustments                                                                                         | round 3                  |
| `scheduled_rides` (key above, reused)    | ride-service                                                                                                           | Book for Later SCHEDULED REQUESTS: a stored intent no driver is committed to, published at the city's lead time                                                                            | round 4                  |
| `marketplace_advance_reservations`       | ride-service                                                                                                           | ADVANCE DRIVER RESERVATIONS on the booking calendar (commission captured once at that award; never the live current / next slots)                                                          | round 4                  |
| `marketplace_recurring_journeys`         | ride-service                                                                                                           | Recurring journey templates (each occurrence is one of the two products above)                                                                                                             | round 4                  |
| `reservations` (key above)               | travel-service (`/v1/reservations`)                                                                                    | Airport transfers, made as real scheduled requests travel-service signs as the traveller; never "secured" before a real award                                                              | round 5                  |
| `marketplace_preferred_drivers`          | ride-service                                                                                                           | Saved drivers, a driver's opt-in, and a preferred driver's bounded exclusive window (the market opens only with the rider's explicit fallback consent)                                     | round 5                  |
| `marketplace_accessibility_requirements` | ride-service                                                                                                           | Stated service requirements, matched only to VERIFIED capability                                                                                                                           | round 5                  |
| `marketplace_guest_bookings`             | ride-service                                                                                                           | Book for another adult, and the passenger's scoped, expiring, revocable trip link                                                                                                          | round 6                  |
| `business_travel`                        | user-service (organizations); payment-service (prefunded budgets); ride-service (a ride booked on an organization)     | Business travel: organizations, invitations, top-ups, budget allocations and reservations; the budget replaces personal funding for that trip, never the driver's 10% commission           | rounds 6–7               |
| `marketplace_booking_vehicle_swaps`      | ride-service (`POST /internal/fleet/bookings/:blockId/vehicle-swaps`)                                                  | A fleet proposing to move a confirmed advance booking to another of its vehicles: the booked driver decides, the rider consents, the fare is unchanged and the commission never re-charged | round 8 (fleet calendar) |
| `fleet` (key above)                      | fleet-service; ride-service (vehicle identity, occupancy ledger, risk overlay); payment-service; user-service; support | The fleet console and, since round 8, the fleet availability calendar                                                                                                                      | slice 10; round 8        |

## Service switches that are not city flags

Some capabilities are switched per deployment by an environment variable rather
than per city. They are deny-by-default in the same way — only the literal
value turns them on.

| Variable                           | Service          | Gates                                                                                                                                                                     |
| ---------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DELIVERY_CHARGED_RETURNS_ENABLED` | delivery-service | Fee-bearing returns (`"true"` only). Off: a fee is refused with `CHARGED_RETURNS_NOT_OFFERED`; turning it off stops new charged returns and never strands a reserved fee. |

## How a flag is read

```ts
import { isEnabled } from "@ubi/contracts";
import { getFlags, requireFlag } from "@ubi/config-client";

const flags = await getFlags({ cityId, userId }); // DENY_ALL if unreachable
if (isEnabled(flags, "bites")) {
  /* ... */
}
requireFlag(flags, "bites"); // throws feature_disabled (404)
```

Two properties this enforces:

- **Fail closed.** If `config-service` is unreachable, times out, errors or
  returns a body that is not a flag map, `getFlags` resolves to `DENY_ALL`. A
  denied result is deliberately _not_ cached, so recovery is immediate rather
  than delayed by the TTL.
- **404, not 403.** A disabled feature answers `feature_disabled` with a 404, so
  a deep link cannot even confirm the feature exists.

Both are covered by tests in `packages/config-client/tests/client.test.ts`.

## Changing a flag

Flag rules are versioned and audited like any config change: the write, its
`audit_log` row and its `flag.changed` outbox row are one transaction, and the
Redis cache is busted on commit. Repeating the same change under one
Idempotency-Key does not emit a second event.

## Not yet enforced

The registry and the server-side evaluation are live. What is not yet done:

- **Client gating.** The Flutter apps do not yet render tiles from flags or show
  the honest "not available here" screen (`common.flagOff.screen`). That is the
  client half of slice 01 and is not implemented.
- **Deep-link 404s in the apps.** Same reason.
- **Two-person approval on flag changes specifically.** City _config_ changes
  require a second approver who is not the author, and that is tested. Flag rule
  changes currently require an admin role and are audited, but do not go through
  the same two-person path. The handoff asks for versioned, two-person config
  changes; whether individual flag flips need the same ceremony as a fare change
  is a policy decision, and it has not been made.
