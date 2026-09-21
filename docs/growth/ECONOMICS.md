# Growth/referral/rebate economics (C09, part 2)

Traced end to end: `services/growth-service/src/routes/*.ts` →
`src/ops/*.ts` → `src/ops/ledger-port.ts` → payment-service's
`/v1/finance/{incentives,benefits}` over HTTP. Every claim below cites the
file and line it comes from. Nothing here is invented; where a mechanism
doesn't exist, that is stated plainly rather than assumed.

## 1. Does growth-service move money itself, or call payment-service?

It never opens a second ledger. `src/ops/ledger-port.ts:1-26` states the
rule and the code follows it: `createHttpLedger` (`ledger-port.ts:124-238`)
POSTs to payment-service's `/v1/finance/incentives` and
`/v1/finance/benefits` with an idempotency header
(`ledger-port.ts:127-161`), and growth-service's own database never holds a
`journalEntry`/`journalLine`-style table. The only money-moving calls in
`src/` are `deps.ledger.postIncentive` (`incentives.ts:283`, `:452`, `:598`)
and `deps.ledger.postBenefit` (`promotions.ts:534`). Tests substitute a
`FakeLedger` (`tests/helpers.ts:256-372`) that writes real, balanced journal
rows so the "separate line, base commission untouched" invariant is checked
by the same double-entry balance trigger production uses — but that fake
lives only in `tests/`, confirming nothing in `src/` implements a second
ledger.

## 2. Where is a campaign's budget held? Is it reserved/decremented atomically?

**Budget exists and is real**, not merely a UI number: `campaign_budgets`
(one row per `campaign_versions` row) with `reserved_minor`,
`consumed_minor`, `reversed_minor`, and `budget_limit_minor` on the version
itself (`promotions.ts:80-111`, `ops/campaigns.ts:107-111`).

`reserve()` (`promotions.ts:201-393`) takes `SELECT … FOR UPDATE OF b` on
the budget row (`promotions.ts:93-99`, called at `:267`) _before_ checking
`committed = reserved + consumed` against `budget_limit_minor`
(`promotions.ts:283-297`) and writing the new reservation in the same
transaction. Concurrent reservations for the same campaign version are
therefore serialised by Postgres, and this is proven, not just argued: the
existing test `"serialises concurrent reservations so the budget is never
oversold"` (`tests/promotions.test.ts:43-70`) fires 12 concurrent
reservations against a budget sized for exactly 5 and asserts exactly 5 are
granted. **Answer: yes, atomic, and it cannot be oversold at the reserve
step.**

## 3. Duplicate-event safety — can the same qualifying event pay twice?

This needed real investigation, not just reading the reserve path, because
reserving isn't the same operation as _qualifying_ (consuming a
reservation, or posting a driver rebate). Three call sites had the same
class of gap: a pre-transaction "is this already done?" read that goes
stale under true concurrency (two callers racing, e.g. a redelivered
webhook — not a simple sequential retry, which was already handled).

- **`promotions.consume()`** (rider/referral benefit qualification —
  `promotions.ts:502` before this pass): read `reservation.state`, then
  _outside_ any lock called the ledger, then in a transaction blindly
  applied `reservedMinor -= amount; consumedMinor += amount`. Two
  concurrent `consume()` calls for the same reservation both passed the
  initial checks and both attempted the budget mutation.
  **Verified concurrently** by reverting the fix and re-running the new
  test: without it, the second call throws an unhandled
  `PrismaClientKnownRequestError` (`Unique constraint failed on … outbox
idempotency_key`) instead of returning gracefully — a real production
  error path for any redelivered qualifying event, not a false alarm.
  **Fixed** (`promotions.ts:541-576`): a compare-and-swap
  `updateMany({ where: { id, state: "reserved" }, data: { state:
"consumed" } })` inside the transaction; a losing concurrent caller sees
  `count: 0` and returns the current (already-consumed) view without
  touching the budget or granting a second credit. Ledger money movement
  was already safe either way (payment-service's own idempotency key on
  `benefit:${reservationId}` — `promotions.ts:535`), so the defect was in
  growth-service's own budget bookkeeping and error behaviour, not in a
  double payment reaching the ledger.
- **`incentives.postIncentiveLine()`** (driver rebate / commission-free
  window — the shared function behind `postRebate`/`postWindowWaiver`,
  `incentives.ts:203-289` before this pass): the trip-cap and money-cap
  checks were already correctly locked (`lockRule`,
  `incentives.ts:159-161`, called at `:247`) — that part was never broken.
  But the _existence_ check for "has this trip already got this kind of
  posting" (`incentives.ts:210-226`, the `driver_incentive_postings`
  `UNIQUE(trip_id, kind)`) ran only once, before the lock. Two concurrent
  calls for the same trip+kind both passed it, both computed the rebate,
  and the second hit a deterministic-primary-key collision inside the
  transaction — again an unhandled DB error, not a silent double rebate,
  but still a real duplicate-event-safety gap. **Fixed**
  (`incentives.ts:246-284`): re-check for the existing posting _after_
  acquiring the rule lock; a loser replays the winner's posting instead of
  erroring or paying twice.
- **`incentives.postMilestone()`** (driver-referral milestone bonus,
  `incentives.ts:560-660` before this pass): had _no_ lock at all guarding
  its check-then-insert. **Fixed**: wrapped the insert in try/catch and,
  on `isUniqueViolation` (the same idiom already used elsewhere in this
  service, e.g. `campaigns.ts:342-351`), replay the existing posting.

All three fixes are proved by new tests that race two real concurrent
calls against the same Postgres test database and assert the budget/table
reflects exactly one application:
`tests/promotions.test.ts` ("does not pay a qualifying event twice when
consume() races itself"), `tests/incentives.test.ts` ("does not post the
same trip's rebate twice…", "…milestone bonus twice…"). A fourth,
pre-existing latent gap was found but **not fixed** (kept to "small, clear
defects" — see §7): the referral **monthly cap** check
(`referrals.ts:595-611`) counts consumed rewards this month and then calls
`reserve()` as two separate, unlocked steps — two referrals qualifying for
the same referrer in the same instant could both pass the cap check. This
is a narrower race (same referrer, two referral rewards, same moment) than
the three fixed above, and is documented as a finding with a proposed
design rather than patched here.

**A secondary safety net already existed and would have caught the
`consume()` bug even without today's fix**: `reconForDate()`
(`recon.ts:16-76`) independently sums `promotion_reservations` rows by
state and compares that to the `campaign_budgets` counters, refusing to
"close the day" (`canClose: totalUnexplained === 0`, `recon.ts:74`) if they
disagree. A double-applied `consume()` would have shown up there as a
nonzero `unexplainedMinor` — detective, not preventive, which is exactly
why the preventive fix in §3 still mattered.

## 4. Caps, eligibility windows, expiry, attribution

| Control                                 | Exists?                              | Evidence                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Per-user cap on a promotion             | Yes, atomic                          | `perUserCap` checked under the same budget lock, `promotions.ts:261,270-281`                                                                                             |
| Campaign budget ceiling                 | Yes, atomic                          | §2 above                                                                                                                                                                 |
| Referral monthly cap per referrer       | Yes, **not atomic**                  | `referrals.ts:595-611` — see §3                                                                                                                                          |
| Eligibility window (campaign version)   | Yes                                  | `reserve()` refuses outside `[windowStart, windowEnd)`, `promotions.ts:254-259`                                                                                          |
| Referral reward expiry                  | Yes                                  | reservation `expiresAt: program.windowEnd`, `referrals.ts:623`                                                                                                           |
| Rebate one-per-trip cap                 | Yes, atomic                          | `UNIQUE(trip_id, kind)` + rule lock, `incentives.ts:20-21,246-284`                                                                                                       |
| Driver incentive trip-count / money cap | Yes, atomic                          | locked recheck, `incentives.ts:159-161,290-311`                                                                                                                          |
| Attribution: who gets credit, when      | Yes, first-touch, immutable          | unique `attributionClaim.userId`, checked and caught on race (`referrals.ts:245-253,389-403`)                                                                            |
| Self-referral guard                     | Yes                                  | a code matching the claimant's own `userId` is downgraded to `"unknown"`, never rewarded (`referrals.ts:264-270`)                                                        |
| Refund/chargeback clawback              | Yes, but **manually triggered only** | `reverseReferral()`/`reverse()` post a compensating entry citing a terms version (`referrals.ts:705-786`, `promotions.ts:691-769`) — see §6 for what actually calls them |

## 5. Is a rebate distinguishable from the 10% base commission? Is the effective commission visible?

**Yes to both, with evidence.** A rebate is never an edit to the trip's
base commission line — it is a second, separate journal entry
(`incentives.ts:317` comment + the actual separate `postIncentive` call at
`:283`), recorded in growth-service's own `driver_incentive_postings` table
with its own `kind` (`rebate` / `window_waiver` / `rebate_reversal` /
`milestone`) and its own `ledgerLineId`, distinct from whatever entry kind
payment-service's pricing engine used for the base commission (per
`docs/launch/GAP_REGISTER.md`'s G15, that's `mp_ride_completion(_cash)` —
a different kind string entirely, so the two are trivially distinguishable
by entry kind and by which table/service owns the row).

The **effective commission is surfaced**, not left for someone to
reconstruct: `getRebateDetail()`/`getIncentivesOverview()`
(`incentives.ts:713-765`, `:629-711`) return `effectiveBps = baseBps -
reductionBps` (or `0` for a window waiver) directly to the driver, and
`commissionIncentivesLive()` (`incentives.ts:771-834`) gives admins a live
per-campaign spend board plus which drivers have hit their cap.

**One labelled caveat**: `effectiveBps` is derived from `rule.baseBps`, a
value an operator enters when the incentive rule is created
(`seedIncentiveRule`/rule creation), not read live from
payment-service's actual commission configuration at posting time. Nothing
in growth-service cross-checks that `rule.baseBps` still matches the real
base rate the pricing engine used for that trip. If the two ever drift
(e.g. the marketplace commission changes but an old rule's `baseBps`
isn't updated), the driver-facing "effective rate" would be internally
consistent but wrong relative to what's actually posted. This is a
finding, not a bug fixed here — no evidence one way or the other that
drift has occurred, and cross-checking it would mean growth-service
reading payment-service's live config, which is out of this pass's scope.

## 6. The most important finding: the reward pipeline has no trigger

`qualifyReferral()`, `postRebate()`, `postWindowWaiver()`, and
`postMilestone()` are the only functions that actually reserve/consume a
reward or post a rebate from a real-world event (a ride completing, a
referred driver hitting a milestone). **None of them is called from
anywhere in `services/growth-service/src` outside their own definition
files** — confirmed by `grep -rn` across `src/routes/*.ts`, `src/wiring.ts`
and `src/index.ts`: zero matches. The only place `qualifyReferral`'s sibling
`rewardReferral()` is reachable in production is via the admin
`decideReview` → `qualify` path (`routes/growth-admin.ts:218-234` →
`referrals.ts:915-928`), i.e. a human manually overriding a review case —
there is no automatic path from "referee completed a paid ride" to a
reward. `routes/incentives.ts` exposes only three **read** endpoints
(`GET /v1/driver/incentives`, `/:id`, `/statements/:periodId` —
`routes/incentives.ts:22-62`); there is no `POST` anywhere in this service
that a ride/trip-completion event could hit to trigger `postRebate`.
Cross-checked further: no other service in the repository references
growth-service by name or URL at all (`grep -rln "growth-service\|
GROWTH_SERVICE_URL"` across every other service returns nothing), and
`@ubi/outbox` is a declared dependency (`package.json`) that is never
imported anywhere in `src/` — growth-service produces outbox events
(`campaign.*`, `promotion.*`, `referral.*`) for others to consume, but
does not itself consume ride-service's completion events.

**What this means economically**: the budget/cap/idempotency machinery
audited above is real and (after this pass) correctly guards against
double-spend — but it currently guards a pipeline that nothing in the
deployed system invokes. A driver today cannot actually earn a rebate, and
a referrer cannot actually be rewarded, through any live event path; both
are reachable only via a direct function call (tests) or a human clicking
"qualify" on a review case. This is a **missing feature**, not a confirmed
defect in the code that exists — it belongs in the gap register (see the
note at the end of this document) rather than being "fixed" here, since
closing it means building a webhook/outbox-consumer that reacts to
ride-service's trip-completion event, which is architectural, crosses a
service boundary this prompt does not authorise touching, and is exactly
the kind of change this prompt reserves for a proposed design rather than
an in-place fix.

## 7. Small fixes made — summary

| File                                          | Defect                                                                                                                       | Fix                                                                                                                                                                | Test                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `src/ops/promotions.ts` (`consume`)           | Concurrent consume of the same reservation double-applies the budget delta / throws unhandled                                | Compare-and-swap `updateMany` on `state="reserved"` inside the transaction; loser replays                                                                          | `tests/promotions.test.ts` "does not pay a qualifying event twice…"      |
| `src/ops/incentives.ts` (`postIncentiveLine`) | Concurrent rebate/window posting for the same trip+kind throws unhandled instead of replaying                                | Re-check for the existing posting after acquiring the rule lock                                                                                                    | `tests/incentives.test.ts` "does not post the same trip's rebate twice…" |
| `src/ops/incentives.ts` (`postMilestone`)     | No lock at all; concurrent posting throws unhandled                                                                          | Catch `isUniqueViolation` and replay, matching the idiom already used in `campaigns.ts`                                                                            | `tests/incentives.test.ts` "…milestone bonus twice…"                     |
| `tests/helpers.ts` (`FakeLedger.postPair`)    | The test double for the ledger wasn't itself race-safe on its idempotency key, which masked/confused the milestone race test | Catch the unique-violation and replay, so the fake matches the "idempotent under concurrency" behaviour every comment in `src/` already assumes of the real ledger | covered by the same incentives tests                                     |

**Not fixed (architectural / out of scope), reported as findings:**

- Referral monthly cap race (§3, §4) — proposed design: move the
  "count consumed this month" check inside a lock keyed on the referrer
  (e.g. a `SELECT … FOR UPDATE` against a per-referrer row, or fold the
  count into the same transaction as the reward's `reserve()` call so both
  are serialised together).
- No live event wiring into the reward pipeline (§6) — proposed design: an
  outbox consumer (the `@ubi/outbox` dependency already exists) subscribing
  to ride-service's trip-completion events, translating them into
  `postRebate`/`qualifyReferral` calls with the trip id as the natural
  idempotency key — the exact shape `postIncentiveLine`'s "one rebate per
  trip" unique constraint is already designed to support safely.
- `effectiveBps`/base-rate drift (§5) — proposed design: growth-service
  reads the live commission bps from the same source ride-service/
  payment-service use (`packages/contracts/src/marketplace.ts`'s
  `commissionBps` literal) rather than trusting a rule-authored snapshot,
  or the rule-creation flow validates against it at creation time.

## 8. Test run — before and after

The suite could not run at all locally until the test database existed
(`ubi_growth_test` was absent — this is the historical "25 DB-bound
failures" the prompt warned about, which in practice means every
integration test errors on `ECONNREFUSED`/"database does not exist" rather
than failing an assertion). Set up:

```
PGPASSWORD=ubi_dev_password psql -h 127.0.0.1 -U ubi -d postgres \
  -c 'CREATE DATABASE ubi_growth_test'
DATABASE_URL=postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_growth_test \
  pnpm --filter @ubi/database exec prisma migrate deploy   # 8 migrations, clean
  pnpm --filter @ubi/database exec prisma generate
```

- **Before this pass's fix** (repo state at hand-off, DB now present):
  `pnpm --filter @ubi/growth-service test` → **5 files, 30/30 tests
  passed**. The pre-existing suite did not exercise true concurrent
  `consume()`/`postRebate()`/`postMilestone()` calls, so it passed despite
  the bugs — confirmed directly by reverting only the `consume()` fix and
  re-running `tests/promotions.test.ts` with the new race test added: it
  fails with the unhandled Prisma error described in §3.
- **After this pass**: `pnpm --filter @ubi/growth-service test` → **5
  files, 33/33 tests passed** (30 original + 3 new concurrency tests, one
  per fix). `tsc --noEmit` clean. `eslint src --ext .ts` → **0 errors**
  (11 pre-existing warnings, all `turbo/no-undeclared-env-vars` and
  `no-nested-ternary`, none introduced by this pass). `prettier --write`
  run on every file this pass touched.

## 9. Unit-economics worksheet (illustrative)

Every input below is a documented fixture or contract literal, cited by
file:line. **No traffic, revenue or user counts are invented or implied**
— this is arithmetic on the numbers that already exist in the repo, not a
forecast.

**Inputs**

- Marketplace commission: **10%, 1,000 bps**, half-up rounding at the
  minor unit — `packages/contracts/src/marketplace.ts:306,335` (schema
  literal), `services/ride-service/internal/marketplace/commission.go:3-19`
  (the arithmetic, `(fareMinor*1000 + 5000) / 10000`). This is the
  authoritative marketplace figure per the launch ground truth — distinct
  from the unrelated legacy `serviceFeePct: 20` field in the Lagos seed
  (`services/config-service/src/seed/lagos.ts:129`), which this worksheet
  does not use.
- Fare inputs: the Lagos config seed's own worked example — "an 8 km / 20
  min trip: go ₦2,640, comfort ₦3,620, xl ₦4,960"
  (`services/config-service/src/seed/lagos.ts:47-51`), built from that
  file's per-class `baseMinor`/`perKmMinor`/`perMinMinor`/`bookingFeeMinor`
  (lines 52-73). That whole fares block is explicitly labelled
  **"PROVISIONAL, pending ops/finance sign-off"** in the source
  (`lagos.ts:18,127`) — carried through here as illustrative, not a
  committed price.
- The marketplace model means the _actual_ accepted fare is
  requester-edited within `[minimumFareMinor, maximumFareMinor]` around a
  `suggestedFareMinor` (`packages/contracts/src/marketplace.ts:52-54`), not
  a fixed quote. This worksheet treats the seed's computed fare as the
  illustrative _accepted_ fare for arithmetic simplicity — a labelled
  assumption, not a claim about what riders actually pay.

**Per-ride revenue at 10% commission on the documented worked example**

| Class   | Fare (₦) | Commission (10%, half-up) | Driver keeps (₦) |
| ------- | -------: | ------------------------: | ---------------: |
| go      | 2,640.00 |                    264.00 |         2,376.00 |
| comfort | 3,620.00 |                    362.00 |         3,258.00 |
| xl      | 4,960.00 |                    496.00 |         4,464.00 |

(Commission = fare × 1,000 bps ÷ 10,000, exact here since each fare is a
whole number of kobo divisible by 100 — no rounding remainder to show.)

**Promo cost scenario: funded vs. unfunded** (illustrative amounts, using
the mechanics from §1–§3, not real campaign data)

Suppose a `fare_discount` campaign version offers ₦500 off the go fare
above, funded by `ubi_marketing` (`ledger-port.ts:59`), with a budget of
₦50,000 (`campaignVersion.budgetLimitMinor`, `campaigns.ts:287`).

- **Funded case** (budget has headroom): `reserve()` locks the budget row,
  confirms `reserved + consumed + 50,000 ≤ 5,000,000` kobo, creates the
  reservation (`promotions.ts:299-317`). On the rider's ride completing,
  `consume()` calls `postBenefit` (`promotions.ts:526-539`): payment-service
  debits `ubi_marketing` ₦500 and credits the rider's fare adjustment —
  **the driver still receives the full ₦2,376 computed above**, because a
  rider benefit funds the difference rather than reducing what the driver
  is owed (`ledger-port.ts:16-20`, "a rider discount therefore never posts
  a negative line against a driver"). Net effect: rider pays ₦2,140,
  marketing spends ₦500, driver economics are unchanged.
- **Unfunded case** (budget exhausted): the same `reserve()` call instead
  finds `remaining < amountMinor` (`promotions.ts:284-297`), returns
  `{ reserved: false, reasonCode: "budget_exhausted" }`, and — the first
  time this happens for the version — flips the campaign to `exhausted`
  (`promotions.ts:288-296`, `exhaustCampaign` at `:443-473`) so no further
  promise is made from it. **No reservation, no ledger call, no discount is
  shown to the rider.** There is no code path in `src/` that lets a
  promotion draw money once its budget is exhausted — this is enforced by
  the same atomic check as §2, not a policy that could be bypassed by a
  retry.

## Note for a gap-register addendum

Two findings from this document belong in `docs/launch/GAP_REGISTER.md` as
new rows (not edited directly, per this prompt's instructions):

1. **No live trigger for growth-service's reward pipeline** (§6):
   `qualifyReferral`/`postRebate`/`postWindowWaiver`/`postMilestone` are
   real, tested, and now race-safe, but unreachable from any real ride- or
   trip-completion event — only a human "qualify" decision or a direct test
   call invokes them. Closure test: an outbox consumer (or equivalent) that
   turns a real `ride.completed_and_paid`-class event into a
   `postRebate`/`qualifyReferral` call, with an end-to-end test proving a
   completed trip produces exactly one rebate posting.
2. **Referral monthly-cap check is not atomic** (§3, §4): two referrals
   qualifying for the same referrer at the same instant could both pass
   the monthly-cap check before either reservation commits. Narrower blast
   radius than the three fixed races (needs two referrals for the _same_
   referrer in the same instant) but the same class of gap. Closure test:
   a concurrent-qualification test analogous to the three added here,
   proving the cap holds under a race.
