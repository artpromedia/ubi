# Marketplace money — `/v1/wallet/mp`

The wallet side of the negotiated-fare marketplace. Everything except
`GET /overview` is service-to-service: ride-service calls it with
`X-Service-Key` (the router's `internalServiceAuth`; the gateway also limits
`/v1/wallet/mp/holds*` and `/v1/wallet/mp/funding*` to `admin:all`). Every POST
needs an `Idempotency-Key` header. Money is integer minor units; a Money body
is `{ "amountMinor": 50000, "currency": "NGN" }`.

| Route                                               | Purpose                                                            | Idempotency authority      |
| --------------------------------------------------- | ------------------------------------------------------------------ | -------------------------- |
| `POST /holds/reserve`                               | reserve the 10% commission of a live bid                           | Idempotency-Key + bid      |
| `POST /holds/:id/adjust` / `release`                | revise / release a live bid hold                                   | Idempotency-Key            |
| `POST /holds/:id/capture`                           | the single 10% debit at selection                                  | award id                   |
| `POST /holds/:id/reverse`                           | award cancelled: hand back the award's **net** captured commission | award id                   |
| `POST /funding/authorize` / `release`               | rider funding reservation for the selected fare                    | award id                   |
| `POST /settlements`                                 | completion: fare to the driver, fee never charged again            | award id                   |
| `POST /holds/:id/amendments/:amendmentId/*`         | post-award commission delta (below)                                | reservation + amendment id |
| `POST /funding/top-up*`, `/funding/partial-release` | post-award funding amendment (below)                               | award + amendment id       |

## Post-award amendments (A02 item 5)

A post-award fare change never reverses and re-captures the commission (that
would charge the 10% twice). Only the difference moves, as a record linked to
the award: `src/ledger/mp-commission-deltas.ts` and
`src/ledger/mp-funding-amendments.ts`.

Rules for every amendment call:

- `amendmentId` is ride-service's id, `[A-Za-z0-9][A-Za-z0-9_.-]{0,127}`. It
  is the idempotency authority: retry a timed-out call with the same
  amendment id (any `Idempotency-Key`) and you get the original answer; the
  same amendment with different terms is `409 idempotency_key_reuse`.
- The caller sends the prior total and the new one; payment-service checks the
  prior against the ledger and derives the delta itself. A stale prior is
  `409 version_conflict` with `details.refreshedTerms`.
- One open amendment per award: while an increment is reserved (or a top-up is
  pending), another amendment on that award is `409 conflict`.
- An amendment id is either an increase or a decrease, never both.

### Commission delta — `POST /v1/wallet/mp/holds/{reservationId}/amendments/{amendmentId}/{op}`

`reservationId` is the award's **captured** hold (the one `/capture` stamped).

| op        | when                               | body                                | success              |
| --------- | ---------------------------------- | ----------------------------------- | -------------------- |
| `reserve` | fare increase, before approval     | `DeltaTerms`                        | `201` (`200` replay) |
| `capture` | the increase commits               | `{ awardId, newTotalMinor: Money }` | `200`                |
| `release` | the increase is rejected / expires | `{ awardId, reason }`               | `200`                |
| `refund`  | a fare decrease commits            | `DeltaTerms`                        | `201` (`200` replay) |

```jsonc
// DeltaTerms — all three Money bodies in the award's currency
{
  "awardId": "awd_…",
  "priorTotalMinor": { "amountMinor": 50000, "currency": "NGN" }, // captured so far, as you know it
  "newTotalMinor": { "amountMinor": 60050, "currency": "NGN" }, // commission(new fare): 10%, half-up
  "newBaseMinor": { "amountMinor": 600500, "currency": "NGN" }, // the amended commissionable fare
}
```

- `reserve` encumbers `new − captured` on the driver's spendable (cleared
  balance − holds − rider reservations − travel authorizations). If it does
  not fit: `422 insufficient_spendable` (`requiredMinor`, `spendableMinor`,
  `shortfallMinor` …) and nothing is written.
- `capture` debits exactly the reserved increment once (journal kind
  `mp_commission_delta_capture`, counterpart ref
  `award:<awardId>:amendment:<amendmentId>`); `newTotalMinor` must be the
  total the increment was reserved for.
- `release` of an amendment that never reserved closes it
  (`direction: "none"`), so a late `reserve` is refused. A captured increment
  cannot be released.
- `refund` hands back `prior − new` (journal kind `mp_commission_delta_refund`,
  ref `…:amendment:<amendmentId>:refund`) — never more than captured.

Response (`MpCommissionDelta`):

```jsonc
{
  "reservationId": "mph_…",          // the award's captured hold
  "amendmentId": "amd_…",
  "awardId": "awd_…",
  "direction": "increase",           // increase | decrease | none
  "state": "active",                 // active | captured | released | refunded | reversed
  "deltaReservationId": "mph_…",     // the increment's own hold row; null for a decrease
  "deltaMinor": { "amountMinor": 10050, "currency": "NGN" },
  "priorTotalMinor": { … } ,         // null when direction is none
  "newTotalMinor": { … },
  "newBaseMinor": { … },
  "receiptId": "mcr_…",              // this capture's / refund's receipt; null until then
  "journalEntryId": "je_…",
  "originalReceiptId": "mcr_…",      // the award's selection capture
  "createdAt": "…", "resolvedAt": "…"
}
```

Errors: `422 validation_failed` (currency mismatch, `newTotalMinor` not
10% of `newBaseMinor`, wrong direction for the op, bad ids, missing
Idempotency-Key); `422 insufficient_spendable`; `409 version_conflict`
(`refreshedTerms.capturedTotalMinor`); `409 conflict` (another open
amendment, award not captured / reversed / different award, capture after
release, release after capture); `409 idempotency_key_reuse`; `404 not_found`.

### Rider funding — `POST /v1/wallet/mp/funding/{op}`

Bare-integer amounts, like `/funding/authorize`.

| op                | when                               | body                                       | success                      |
| ----------------- | ---------------------------------- | ------------------------------------------ | ---------------------------- |
| `top-up`          | fare increase, before approval     | `FundingAmendment`                         | `201` (`200` replay or cash) |
| `top-up/commit`   | the increase commits               | `{ awardId, amendmentId, newAmountMinor }` | `200`                        |
| `top-up/release`  | the increase is rejected / expires | `{ awardId, amendmentId, reason }`         | `200`                        |
| `partial-release` | a fare decrease commits            | `FundingAmendment`                         | `201` (`200` replay or cash) |

```jsonc
// FundingAmendment
{
  "requesterId": "usr_…",
  "awardId": "awd_…",
  "amendmentId": "amd_…",
  "paymentMethodId": "wallet", // cash → secured:false, no row; other methods → 422 payment_method_unavailable
  "priorAmountMinor": 500000, // what the award is funded to, as you know it
  "newAmountMinor": 600000, // the amended fare
  "currency": "NGN",
  "cityId": "city_…",
}
```

Response (`FundingAdjustment`):

```jsonc
{
  "awardId": "awd_…",
  "amendmentId": "amd_…",
  "kind": "top_up", // top_up | partial_release | none
  "secured": true, // false for cash
  "status": "reserved", // reserved | committed | consumed | released | unsecured | missing
  "adjustmentId": "mra_…", // null for cash
  "reservationId": "mrr_…", // the award's original funding reservation
  "deltaMinor": 100000,
  "priorAmountMinor": 500000,
  "newAmountMinor": 600000,
  "currency": "NGN",
  "replayed": false,
}
```

The original reservation is never edited (the `/funding/authorize` replay
guard still matches the selected terms). Settlement consumes the original plus
every committed adjustment exactly once and releases a top-up that never
committed; `/holds/:id/reverse` and `/funding/release` release the
adjustments with the award. Errors: `422 insufficient_funds`,
`422 validation_failed`, `422 payment_method_unavailable`,
`409 version_conflict` (`refreshedTerms.fundedAmountMinor`), `409 conflict`,
`409 idempotency_key_reuse`, `404 not_found` (commit with nothing reserved).

### Adoption sequence for ride-service

- **Increase**: `reserve` + `top-up` before asking for approvals (both must
  succeed); on commit `capture` and `top-up/commit`; on reject/expiry
  `release` and `top-up/release` (safe to call even if the reserve never
  landed).
- **Decrease**: on commit `refund` and `partial-release`.
- **No fee change**: when `newTotalMinor` equals the captured total (a fare
  change the 10% half-up rounding absorbs), there is no commission call at
  all — `reserve` and `refund` each refuse a zero delta with `422`.
- **Completion with an increment still reserved**: settlement releases an
  uncommitted funding top-up, but NOT a reserved commission increment —
  ride-service must `release` it when the amendment expires, or it keeps
  encumbering the driver's spendable.
- **Completion**: `/settlements` with the final committed fare.
- **Cancellation**: `/holds/:id/reverse` hands back the net captured
  commission, releases any open increment and the rider's adjustments.

Outbox: the existing `mp.commission.reserved|captured|released|reversed`
names, with `payload.kind = "amendment_delta"` (or `"amendment_delta_refund"`,
`partial: true`). Funding amendments write audit rows only, like the rest of
rider funding — the closed event catalog has no `mp.funding.*` names yet.
