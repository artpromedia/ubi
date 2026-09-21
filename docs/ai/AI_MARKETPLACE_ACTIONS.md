# AI marketplace actions (C10)

Closes GAP_REGISTER **G13** — "Adapters exist behind flags (off), bound grants,
injection/replay/revocation tests pass; no direct balance/policy/ride mutation."

The ask-service assistant can now act in the negotiated-fare marketplace, but
only as a bounded **client**: it calls the same `/v1/mp/*` HTTP endpoints a human
uses, forwards the user's gateway identity on every call, and holds no privilege
a human client lacks. It **proposes**; the marketplace server **decides**. The
whole surface is **deny-by-default** and stays OFF until a city turns on the
`ai_marketplace` flag. Implemented ≠ enabled.

> Shared-brief rule this implements: "AI proposes actions through existing
> mandates, grants and deterministic backend validation. It cannot directly
> alter balances, policies or ride state."

## Where the pieces live

| Concern                     | File                                                            |
| --------------------------- | --------------------------------------------------------------- |
| Marketplace client port     | `services/ask-service/src/ports/marketplace-port.ts`            |
| Grant-scoped ops            | `services/ask-service/src/ops/marketplace.ts`                   |
| Model-facing tools          | `services/ask-service/src/ai/tools.ts` (`mp.*`)                 |
| Deny-by-default flag        | `packages/contracts/src/flags.ts` (`ai_marketplace`)            |
| Deterministic test suite    | `services/ask-service/tests/marketplace.test.ts`                |
| Fake marketplace + fixtures | `services/ask-service/tests/helpers.ts` (`FakeMarketplacePort`) |

## The port and which calls are binding

`MarketplacePort` mirrors the existing `RidePort`/`TravelPort` pattern — an
interface, a real HTTP adapter (`createHttpMarketplacePort`), and a test fake
(`FakeMarketplacePort`). Every call forwards `X-User-ID` / `X-User-Role` (never
an identity from a tool argument) and the service key, exactly as ride-service
serves them behind the gateway's `/v1/mp/*` proxy.

| Call             | Endpoint                           | Binding? | Money?                            |
| ---------------- | ---------------------------------- | -------- | --------------------------------- |
| `quote`          | `GET /v1/mp/quote`                 | no       | none (non-binding envelope)       |
| `prepareRequest` | `POST /v1/mp/requests`             | action   | **none** — publish spends nothing |
| `viewOffers`     | `GET /v1/mp/requests/{id}`         | no       | none (read)                       |
| `reviewOffer`    | (pure, no I/O)                     | no       | none — presents untrusted offers  |
| `getAward`       | `GET /v1/mp/requests/{id}/award`   | no       | none (convergence query)          |
| `select`         | `POST /v1/mp/requests/{id}/select` | **YES**  | **awards + funding + commission** |
| `cancel`         | `POST /v1/mp/requests/{id}/cancel` | action   | releases holds                    |

`select` is the **only** step that awards a job and moves money.

## Grant binding

The user's authorization is a `MarketplaceGrantScope`, minted into the existing
single-use `ActionGrant` by `authorizeNegotiation` (the confirm step). It binds:

| Field             | Where it is stored / bound                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| principal         | `ActionGrant.actorId`                                                                                 |
| action set        | `MarketplaceGrantScope.actions` ⊆ {quote, prepare, select, cancel}, folded into the terms fingerprint |
| city              | scope, folded into the terms fingerprint                                                              |
| currency          | `ActionGrant.currency`                                                                                |
| **maximum spend** | `ActionGrant.totalMinor` (the cap the selected fare must not exceed)                                  |
| vehicle class     | scope, folded into the terms fingerprint                                                              |
| expiry            | `ActionGrant.expiresAt`                                                                               |
| bound quote       | `ActionGrant.resourceRef` (the quote the negotiation rides on)                                        |

`fingerprintScope(scope)` is a stable string over all bound fields and is stored
as `ActionGrant.termsVersion`. At execution the ops layer **recomputes** it from
the AUTHORITATIVE request and requires it to match — so a city/currency/vehicle/
cap/action-set/quote drift is refused deterministically, never trusted.

### Where the server re-validates at execution

`selectOffer` (`ops/marketplace.ts`) re-validates against the **live** offer and
request from `viewOffers`, before consuming the grant:

- **cap** — `selectedFare (offer.totalMinor) ≤ ActionGrant.totalMinor` else
  `fare_out_of_bounds { reason: cap_exceeded }`.
- **city / currency / vehicle class** — `assertRequestInScope`, plus the terms
  fingerprint check inside `consumeGrant`.
- **bound quote** — `request.quoteId === ActionGrant.resourceRef`.
- **material change** — `offer.requestRevision === expectedRequestRevision`
  (`version_conflict { request_revised }`) and
  `selectedFare === expectedFareMinor` (`version_conflict { price_changed }`).

A material change outside the granted scope needs a **renewed** approval (a fresh
grant), never a silent widening. `prepareRequest` also refuses a requested fare
above the cap and confirms the published request landed inside scope.

## Prepare vs accept

Publishing (`prepareRequest`) and accepting a binding offer (`selectOffer`) are
separate:

- prepare requires a scope that permits it, moves no money, awards nothing, and
  **does not consume** the single-use grant;
- select is the only awarding step; it consumes the grant exactly once.

**Attended** selection needs the human confirm step ask-service already has for
bookings: `authorizeNegotiation` mints the grant from a PIN/biometric assurance.
**Unattended** (no-human-in-the-loop) selection is allowed **only** when a valid,
active **mandate** authorises it — its per-run cap, currency, ownership, expiry
and status are re-checked at execution and a `MandateExecution` receipt is
written. With neither a mandate nor an assurance, authorization is refused
(`step_up_required`).

**Pause / revoke:** revoking or pausing the mandate (`Mandate.status`) blocks
every further unattended action at execution time; a spent or expired grant
blocks the attended path. Every executed action writes an `ai_actions` receipt
(and unattended runs a `MandateExecution` row) carrying the award id and amount.

## Untrusted model output + injection

Actions are controlled by **tool schemas and server rules**, never the model's
free text:

- The model-facing `mp.*` tools have strict zod schemas — a tool can only carry a
  `requestId` / `bidId`, never a fare, identity or free-text instruction. Unknown
  keys and wrong types are rejected before the tool runs.
- Offer text (`driver.displayName`, `whyRecommended`), provider text and thread
  content are **untrusted**. `reviewOffer` / `presentOffersForReview` wrap every
  free-text field as `{ untrusted: true, value }` and the tools surface it as
  clearly-labelled data, never as instructions.
- The model can never **directly** select, award, auto-bid, or touch a driver's
  stationary gate: `mp.select`, `mp.award`, `mp.autobid`, `mp.bid`,
  `driver.bid`, `mp.driver.gate.bypass`, `driver.parked`, `ride.state.set` and
  `policy.change` are in `FORBIDDEN_CAPABILITIES` — naming any of them (e.g. from
  an injected offer) is a logged `refused`, and the port exposes no such method.

An injection in offer/driver/provider text cannot change which tool runs or its
arguments beyond what the schema and grant already allow.

## Idempotency / no double charge

- Every money-affecting call carries an idempotency key **derived from the
  grant** (`scopedIdempotencyKey("mp.select", actorId, grantId)`), stable across
  retries — never regenerated.
- The grant is single-use: a replayed grant / duplicate `selectOffer` sees the
  grant already consumed and **converges** on the existing award by querying
  `getAward`, issuing no second selection.
- On an uncertain outcome (tool timeout, or `award_unresolved`) the adapter
  **queries** the authoritative award (`getAward`) rather than resubmitting the
  selection. A duplicate action converges on one award; there is never a second
  charge.

## Hard prohibitions (asserted in tests)

- never select above the grant cap (`fare_out_of_bounds`);
- never bypass a driver's stationary gate — no such port method; the capability
  is forbidden;
- never enable automatic driver bidding — no such port method; forbidden;
- never directly alter a balance, policy or ride state — the adapter only calls
  the authorized marketplace endpoints as a client.

## The gating flag

`ai_marketplace` (in `FLAG_KEYS`, `packages/contracts/src/flags.ts`) is
deny-by-default (`DENY_ALL` maps it to `false`; `FeatureFlag.defaultOn` is
`false`). It is independent of `marketplace_rides`: the human marketplace can be
live in a city while the AI is not authorised to act there. **Nothing enables it
in this change** — it stays OFF until the C10 deterministic suite gates it on per
city. Every op in `ops/marketplace.ts` calls `assertFlag` first, so with the flag
off every action answers `feature_disabled` (404).

## Deterministic test coverage

`services/ask-service/tests/marketplace.test.ts` (21 tests), all with the fake
port — no real network, no real model:

- deny-by-default (flag off → `feature_disabled`);
- prepare publishes but awards nothing / moves no money; select awards and
  consumes the grant once, writing a receipt;
- cap: selection above cap and publish above cap both refused, no consume;
- material change: re-price and revision-bump refused deterministically;
- idempotency: duplicate select converges on one award, one charge, stable key;
  a spent grant cannot start a fresh action;
- uncertainty: timeout and `award_unresolved` both converge by querying, never a
  blind retry;
- unattended: refused without a mandate; succeeds under a valid active mandate
  with a `MandateExecution` receipt; a revoked mandate blocks authorization and
  selection; a per-run cap below the scope cap is refused;
- scope binding: an action outside the scope, and a live request that drifted out
  of the granted city, are both refused; cancel works under a cancel-scoped grant;
- injection: an `@obey` directive in an offer's `whyRecommended` cannot invoke a
  forbidden capability, and the model cannot directly `mp.select`;
- the scope fingerprint changes when any bound field changes.

## Remaining / out of scope

- **HTTP routes** for the assistant marketplace flow are not added in this pass;
  the adapters are exercised via the ops functions and the tool loop (as the
  existing review/confirm suite is). Wiring `/v1/ask/mp/*` routes is a small
  follow-up and does not change the transactional guarantees here.
- **Period-cap allowance accounting** (`MandateAllowance`) is not incremented
  yet; per-run cap, status, ownership, currency and expiry are enforced. Period
  accounting is a follow-up.
- **Real model wiring** is unchanged and externally blocked (no GPU/weights);
  tests inject the deterministic provider. **Open-weight model benchmarking is
  explicitly NOT a prerequisite** for C10 and is out of scope — model selection
  never gates transactional correctness.
- Implemented ≠ enabled: `ai_marketplace` stays OFF; no flag default changed.
