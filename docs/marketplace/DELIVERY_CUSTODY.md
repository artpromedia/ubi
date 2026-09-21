# Delivery custody and returns (C07, G08)

Closes `docs/launch/GAP_REGISTER.md` row **G08** for the flows named below.
`marketplace_delivery` stays OFF — this is implemented, not enabled; see
"What stays gated" at the end.

## Migration-owner outcome

`deliveries` is Prisma-owned (`packages/database/prisma`, baseline
migration). delivery-service reads/writes it through pgx, never through
Prisma's generated client, and owns no DDL of its own. The new custody/return
tables follow the same rule: they are Prisma-owned
(migration `20260921033947_delivery_custody`, timestamped after
`20260921000000_mp_rider_reservations`), with real foreign keys to
`deliveries`, and delivery-service reaches them via pgx exactly as it reaches
`deliveries`. **delivery-service contains zero `CREATE TABLE`.**

Verified locally (real Postgres 16 + PostGIS):

- `prisma validate` — passes.
- `prisma migrate deploy` against a fresh `ubi_dev`/`ubi_test` — applies
  cleanly; a second `migrate deploy` reports "No pending migrations to
  apply" (the idempotency property `infrastructure/hetzner/scripts/deploy.sh`
  depends on).
- `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --shadow-database-url ... --exit-code`
  against a fresh shadow database — **"No difference detected"**, exit 0.
  Drift-clean.

The migration also adds two columns to the pre-existing `deliveries` table —
see "A deeper pre-existing defect, found and partially closed" below for why.

## The custody/return state machine

An **additive** extension of the pre-existing `shipment` machine in
`contracts/state-machines.json` (not a new top-level machine — see "Why
extend `shipment` instead of adding a new machine" below). New states and
edges only; nothing removed, nothing renamed.

```
created ───────────────► courier_assigned ───► picked_up ───► in_transit
  │                            │                                  │
  └──► cancelled ◄─────────────┘                                  ├──► delivered
                                                                   │
                                                                   └──► delivery_attempted
                                                                          │
                                                              ┌───────────┼───────────┐
                                                              ▼           ▼           ▼
                                                    recipient_unreachable │           │
                                                              │           │           │
                                              ┌───────────────┼───────────┼───┐       │
                                              ▼               ▼           ▼   ▼       │
                                     return_proposed   held_at_point  delivery_retry ◄─┘
                                        │      │            │              │
                                        ▼      │            ▼              ▼
                                return_consented│        collected     delivered
                                        │       │      (TERMINAL)     (TERMINAL)
                                        ▼       │
                                     returning  │
                                        │       │
                                        ▼       ▼
                                  return_to_sender (TERMINAL)   [reject/expiry]
```

Terminal states: `delivered`, `return_to_sender`, `collected`, `cancelled`.

Legacy `shipment` branches this feature does not exercise (`exception`,
`hub_hold`, `retry_scheduled`, `neighbour_delivery`, `hub_pickup`,
`claim_opened`/`claim_approved`/`claim_partial`/`claim_declined`/`appealed`/
`closed`) are ported unchanged for contract parity but untouched by any
custody handler.

**Go mirror**: `services/delivery-service/internal/custody/machine.go` is an
exact port, states and edges, of the contract's `shipment` machine.
`machine_test.go`'s `TestPortMatchesContract` reads
`contracts/state-machines.json` directly and fails the build the moment the
two disagree (the same pattern `services/ride-service/internal/machine`
uses).

### Why extend `shipment` instead of adding a new machine

The prompt allowed either. `packages/contracts/tests/state-machines.test.ts`
(outside this feature's writable scope) hardcodes the exact list of machine
names contracts/state-machines.json is expected to declare. Adding a new
top-level machine would add a new name to that list and fail that test — a
file this work is not permitted to edit. Extending an existing, already-listed
machine (`shipment`) sidesteps that entirely while covering every state the
prompt asked for.

One consequence: `created` plays the role the prompt calls "awaiting_pickup"
(a marketplace-assigned delivery is seeded directly at `courier_assigned`
since the award saga already knows the driver — `created` is only reachable
by an open-market delivery, which this feature does not touch), and
`return_to_sender` plays "returned_to_sender". Renaming either would not be
additive.

## Tables

| Table              | Purpose                                                                | Key columns                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `delivery_custody` | One row per delivery: current state + optimistic-concurrency `version` | `delivery_id` (unique FK), `state`, `version`, `sender_id`, `driver_id`                                                                 |
| `custody_events`   | Append-only transition log (never updated/deleted)                     | `custody_id` FK, `delivery_id` FK, `from_state`, `to_state`, `actor_type`, `actor_id`, `reason`                                         |
| `delivery_proofs`  | A proof **reference** — never the bytes                                | `type` (pickup\|delivery), `object_key`, `content_type`, `size_bytes`, `sha256`, `uploaded_by`; unique on `(delivery_id, type, sha256)` |
| `delivery_returns` | A return proposal                                                      | `reason`, `fee_minor`, `charge_status`, `consent_state`, `consent_expires_at`, `resolved_at/by`                                         |

All four cascade-delete from `deliveries`. Indexes: `delivery_custody(state)`,
`custody_events(custody_id, created_at)` + `(delivery_id)`,
`delivery_proofs(custody_id)`, `delivery_returns(delivery_id)` +
`(consent_state, consent_expires_at)` (the expiry sweep candidate index).

`delivery_custody.version` is the optimistic-concurrency token: every
transition is one `UPDATE ... WHERE id = $1 AND version = $2`. Two concurrent
requests racing to move the same row can only ever have one winner — the
loser's `UPDATE` matches zero rows and the handler answers 409 `STATE_CONFLICT`
without having written anything. See "Concurrency" below for the test that
proves this.

## Endpoints and permissions

All under `/api/v1/deliveries/{id}/custody/*`, authenticated by the API
gateway's signed identity (`internal/identity`, a port of
`services/ride-service/internal/handler/identity.go` — same header names,
same HMAC payload), **not** the legacy per-delivery-service JWT
(`internal/middleware/auth.go`, unchanged, still guards the pre-existing CRUD
routes). Every handler goes through one gate first
(`loadCustodyForActor`): unknown delivery, no custody row (legacy/open-market
delivery), or an actor who is neither the sender nor the assigned driver all
answer **404** — the same convention the marketplace admin/`mp.*` surfaces
use, so a foreign caller cannot distinguish "not yours" from "does not
exist."

| Endpoint                 | Method |   Sender    | Assigned driver | Recipient | Notes                                                                             |
| ------------------------ | ------ | :---------: | :-------------: | :-------: | --------------------------------------------------------------------------------- |
| `/pickup-proof`          | POST   |      —      |       ✅        |     —     | `courier_assigned → picked_up → in_transit`                                       |
| `/delivery-proof`        | POST   |      —      |       ✅        |     —     | reaches `delivered`; chains through `delivery_retry` from `recipient_unreachable` |
| `/recipient-unreachable` | POST   |      —      |       ✅        |     —     | starts the return/hold-point timer                                                |
| `/return/propose`        | POST   |     ✅      |       ✅        |     —     | records `feeMinor`/`chargeStatus` honestly; never authorizes a charge             |
| `/return/consent`        | POST   | ✅ **only** |    ❌ (403)     |     —     | `action: consent\|reject`; consent on an unsupported charge → 409                 |
| `/collected`             | POST   |      —      |  ✅ or `admin`  |     —     | `held_at_point → collected`, or chains from the two direct-fork states            |
| `GET /` (timeline)       | GET    |     ✅      |       ✅        |     —     | read-only                                                                         |

**Recipient.** UBI has no recipient account in this system today —
`deliveries` carries only a dropoff contact name/phone, never a user id, and
there is no OTP/magic-link mechanism to safely hand a recipient a scoped
token in this pass. The recipient's real-world role — attesting receipt — is
exercised **through the driver's delivery-proof capture** (photo/signature at
hand-off), exactly as the legacy `models.Package.RequiresPOD` flag already
implies. A recipient-facing read-only access token is a named, not-built,
follow-up (see "What stays gated").

**Cross-tenant tests**: `internal/handlers/custody_integration_test.go`'s
`TestMaliciousObjectOwnershipRefused` — an unrelated driver posting a proof,
and an unrelated sender reading the timeline, both for a real delivery that
belongs to two other actors — assert 404 (not 403), matching the table above.

## Object storage — the decision, exactly

**Traced**: `grep -r "minio\|aws-sdk"` across every service's `go.mod`/
`go.sum` and every Node service's `package.json` finds nothing. The Hetzner
Compose stack (`infrastructure/hetzner/docker-compose*.yml`) runs a real
MinIO container, but **no service in this repository has a wired client for
it** — not delivery-service, not any other Go or Node service.

**Decision (Path B, per the prompt's own fallback)**: delivery-service does
not invent a storage client. `delivery_proofs` stores a client-supplied,
**validated** object reference only:

- `objectKey` — no path traversal, no leading slash, 4–256 chars
  (`internal/custody/rules.go:ValidateProof`)
- `contentType` — allowlist `image/jpeg`, `image/png`, `image/webp`
- `sizeBytes` — 1 byte to 15 MiB
- `sha256` — 64-char hex, case-insensitive on input, normalized to lowercase
  before the `(delivery_id, type, sha256)` uniqueness check (so a retry that
  differs only in casing still collides on the same row)

**Never the bytes.** No upload endpoint, no download/serve endpoint, no
presigned-URL minting exists in this pass.

**Explicit, named, gated dependency**: making a proof reference actually
resolve to a viewable image requires (1) a MinIO/S3 client wired into
delivery-service (new dependency, none exists today), (2) an authenticated
upload path with the same content-type/size validation enforced
server-side against the real bytes (not just the client's claim), (3)
private objects only — no public URLs, served via a short-lived signed GET or
a proxied authenticated read, and (4) a retention policy (proof photos are
PII-adjacent; a stated retention window and deletion job, not "forever").
None of this exists; none of it is faked. A `delivery_proofs` row today is
inert data until that client exists.

## Return-leg charge — the money boundary, exactly

delivery-service owns no money. The only funding primitive reachable is
payment-service's `POST /v1/wallet/mp/funding/authorize`
(`contracts/openapi/marketplace.yaml`), and that endpoint is **keyed
one-reservation-per-award** (`awardId` unique). Calling it again for a return
would do one of two things, both wrong:

1. **Reuse the delivery's existing award-scoped reservation/commission** —
   exactly the "reuse the ride/delivery commission" shortcut this prompt
   forbids outright.
2. **Invent a second award id** payment-service was never told exists — not
   a real authorization, just a fabricated key.

No third option (a dedicated delivery-return funding endpoint) exists in
payment-service, and payment-service is out of this feature's writable
scope.

**Decision**: `custody.ResolveChargeStatus` (`internal/custody/rules.go`)
records the intended charge honestly and gates it:

```go
func ResolveChargeStatus(feeMinor int64) string {
    if feeMinor > 0 {
        return ChargeUnsupported // recorded, never authorized
    }
    return ChargeNotRequired
}
```

- `feeMinor == 0` → `not_required`. The return can complete
  (`return_consented → returning → return_to_sender`) on sender consent, or
  resolve to `held_at_point` on rejection/expiry. **This is the only path
  that can reach a terminal return outcome today.**
- `feeMinor > 0` → `unsupported`. The proposal, the fee, and the reason are
  all stored (nothing is discarded). Sender **consent is necessary but never
  sufficient**: `POST .../return/consent {action:"consent"}` on an
  unsupported-charge return answers **409 `RETURN_CHARGE_UNSUPPORTED`** and
  changes nothing. The sender may still `reject` it (→ `held_at_point`,
  always allowed, no charge), or the consent window's expiry defaults to the
  same safe place.

**Proven in tests**
(`TestChargedReturnCannotCompleteWithoutAuthorization`): propose a return
with `feeMinor: 50000` → `chargeStatus: unsupported`; sender consents → 409,
custody state **unchanged** (still `return_proposed` — no double charge, no
silent completion); sender rejects the same return → 200, `held_at_point`.

## Exception handling

- **Recipient-unreachable timer.** `POST /recipient-unreachable` stamps
  `delivery_custody.recipient_unreachable_at` and moves to
  `recipient_unreachable`, from which the driver/sender may propose a
  return, the driver may retry, or the parcel goes straight to a hold point.
- **Sender-cannot-respond → expiry → safe default.** Every return proposal
  gets a `consent_expires_at` = `proposed_at + 24h`
  (`custody.DefaultReturnConsentWindow`). `resolveExpiredReturn` runs at the
  top of `return/consent`, `collected`, and the timeline `GET` — a lazy,
  read-triggered sweep (no cron in this service) — and once the window has
  passed with `consent_state: pending`, it atomically moves
  `return_proposed → held_at_point` and marks the return `expired`. **Never
  an auto-charge**: the default is always the fee-free hold point.
  `TestSenderNoResponseExpiryDefaultsToHoldPoint` backdates the window and
  proves the transition. A periodic sweep job (mirroring the stranded-ride
  repair pattern in `services/ride-service/internal/marketplace/repair.go`)
  would make this eager rather than lazy; not built in this pass — a return
  nobody ever reads again stays technically `pending` in the database,
  though functionally inert (it blocks nothing else).
- **Loss/damage/partial completion.** Not modeled as a settlement this
  service cannot perform. `held_at_point → collected` and
  `returning → return_to_sender` are the two non-`delivered` terminals; a
  loss/damage dispute is support-service/admin territory (G11's absent
  boards), out of scope here. No fabricated "settlement" state was added.

## Concurrency — no double outcome

`TestConcurrentReturnProposeVsRetryRaceHasExactlyOneWinner` fires 8 pairs of
concurrent requests at the same `recipient_unreachable` custody row — one
proposing a return, the other completing delivery via a retry proof — and
asserts **exactly one** of the 16 requests succeeds; the rest get 409. It
then asserts the database agrees: exactly one of `{delivery_returns row,
delivery_proofs row}` exists, matching whichever transition actually won.
This is the "concurrent return-consent vs delivery-completion" property the
prompt asked for, proved at the point in the state graph where the two
outcomes are actually reachable from the same state (return-consent itself
cannot race delivery-completion directly — they have disjoint predecessor
states in the machine; the propose-vs-retry fork from `recipient_unreachable`
is the real race, and the version CAS resolves it the same way for every
transition in this file).

## A deeper pre-existing defect, found and partially closed

While wiring `delivery_custody`'s FK to `deliveries`, `MarketplaceAssign`
(the only way this table's rows get created) turned out unable to insert a
row against the **real** schema at all, for reasons beyond G08's own
description:

1. `deliveryID := "del_" + uuid.New().String()[:12]` produced something like
   `"del_3fa85f64-571"` — Postgres rejects this outright
   (`invalid input syntax for type uuid`) against `deliveries.id UUID`.
2. The INSERT referenced columns that have never existed in the Prisma
   schema at all: `customer_id` (real name: `sender_id`), `driver_id`
   (did not exist — added by this migration), `type`, `pickup_location`/
   `dropoff_location`/`package` (jsonb — the real columns are flat
   `pickup_address`/`pickup_latitude`/... and `package_size`/
   `package_description`), `total_fare` (real name: `price`),
   `confirmed_at`/`driver_assigned_at` (do not exist).
3. `payment_status: "AUTHORIZED"` and currencies `UGX`/`TZS`/`XOF` are not
   members of the real `PaymentStatus`/`Currency` Postgres enums.

**Fixed in this pass** (`internal/handlers/marketplace.go`): the UUID
generation, the full column list (rewritten against the real schema), a
currency allowlist check with a clear validation error instead of an opaque
enum failure, and two new nullable columns this migration adds to
`deliveries` — `driver_id` (delivery-service's Go code has assumed this
column since M03; no migration had ever created it) and
`marketplace_metadata` (jsonb; replaces the `package` jsonb column an earlier
version of this adapter's own comments incorrectly claimed existed — the
marketplace linkage now lives here). `payment_method` has no
"marketplace-managed" enum member either; `WALLET` is stored as a documented
placeholder pending a real field on the hand-off payload.

**Found but NOT closed** (named, not silently worked around):
`deliveries.sender_id` carries a real foreign key to `riders.id` — a profile
row with its own `user_id`, referral code, etc. — not to `users.id` directly.
`MarketplaceAssign`'s `customerId` is, by every convention elsewhere in this
codebase (ride-service's `move.Actor.UserID`, the gateway's `x-auth-user-id`),
a plain user id. Inserting one into `sender_id` as-is will violate that FK
against any populated database unless the caller already resolves a
`riders.id` first. Fixing this for real means either changing the FK to
reference `users` directly (a schema decision on a column pre-dating this
feature) or teaching ride-service's marketplace engine to resolve/create a
Rider profile before calling this hand-off — both outside delivery-service
and outside this prompt's writable scope. The integration tests in this
feature seed a real `users` + `riders` row to satisfy the FK realistically;
production is not yet fixed for this specific gap. **This is the one
remaining blocker to `MarketplaceAssign` working end-to-end against a
populated production database**, named exactly here for the next workstream.

## What stays gated

- `marketplace_delivery` (city feature flag) — **untouched, stays OFF**.
  Nothing in this pass turns it on. Since it gates whether ride-service's
  marketplace engine ever creates a marketplace delivery request in the
  first place, delivery_custody rows do not exist in a production
  deployment until that flag is on for a city — this feature is dormant by
  construction, not just by convention.
- Object storage (upload/serve) — not wired; see above.
- Charged return completion — gated `RETURN_CHARGE_UNSUPPORTED`; see above.
- Gateway-identity signature verification on the custody routes is
  unsigned-trust when `RIDE_INTERNAL_CONTEXT_SECRET` is unset (development
  posture) — the same posture G03 named for ride-service before C03 fixed
  it there; not hardened into a boot-time requirement here, to avoid
  half-fixing a security workstream this prompt does not own across a
  second service.
- `deliveries.sender_id`'s FK to `riders` — see above.
- Rider-mobile fixtures — only the paths this feature actually implemented
  server-side were repointed; see the rider-mobile section of the C07 report
  for exactly which ones stayed fixture/gated and why.

**Implemented ≠ enabled.** Delivery custody/returns are real, tested against
a live database, and honestly documented — they are not live in any pilot
until `marketplace_delivery` is turned on for a city, and even then the
charged-return and object-storage paths remain explicitly unsupported until
their named dependencies (a payment-service endpoint; a storage client) are
built.
