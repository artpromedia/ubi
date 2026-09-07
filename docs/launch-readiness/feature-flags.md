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
