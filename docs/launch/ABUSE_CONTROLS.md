# Abuse threat model (C09, part 3)

Read-only research across ride-service, user-service and payment-service
(none of these were edited — this prompt's writable scope is web/portal
apps, growth-service and docs). Every "existing control" cites file:line.
No proportionate-control proposal here punishes a driver for merely
declining offers or for poor connectivity; each proposal names an appeal
path. **Nothing new was implemented in any service for this part** — the
only implementation this prompt authorised was the two small growth-service
idempotency fixes already made and documented in `docs/growth/ECONOMICS.md`
part 2. Every row below is marked proposal-only unless it cites code that
already exists today.

## 1. Self-referral

- **Existing control (implemented):** a referral code is deterministic per
  user (`referralCodeFor`, `services/growth-service/src/ops/referrals.ts:43-48`).
  When a claim's code resolves to a template whose `referrerId` equals the
  claimant's own id, attribution is downgraded to `"unknown"` and never
  creates a referral or a reward (`referrals.ts:264-270`). No reward is ever
  reserved for a self-referral because `qualifyReferral`/`rewardReferral`
  only run against a `referral` row, and none is created in the self-match
  case.
- **Missing control:** nothing stops a person from referring a _second_
  account they also control but registered with a different phone number —
  self-referral detection here is purely "same user id," not "same person."
- **Proposed control (proposal-only):** feed the existing shared-device /
  shared-payment-method signal path (see §2) into `qualifyReferral`'s
  `signals` parameter (`referrals.ts:427`) for referrer↔referee pairs, not
  only referee-side signups — currently nothing populates `signals` for a
  self-referral-via-second-account pattern. Route to human review, exactly
  as the code already does for other high-severity signals
  (`referrals.ts:494-548`); never auto-deny. **Appeal path:** the existing
  review-case flow already gives a human decision with a `reasonCode`
  (`decideReview`, `referrals.ts:834-973`) and a `hold` option that extends
  the SLA rather than denying outright — this proposal reuses that path, it
  doesn't need a new one.

## 2. Multi-accounting

- **Existing control (implemented, partial):** `User.phone` is a unique
  database column (`packages/database/prisma/schema.prisma:206`) — one
  phone number, one account, at registration time.
- **Existing control (implemented, but explicitly _not_ a detection
  signal):** device enrolment intentionally **namespaces the device id per
  user** (`deterministicId("dev", userId, clientId)`,
  `services/user-service/src/identity/devices.ts:9-12`) specifically so
  "two users claiming the same install id get two different device rows
  and neither can inherit the other's trust." This is a _security_ control
  (stops trust inheritance across accounts on a shared/stolen device) but
  it is a deliberate design choice that also means device rows cannot be
  used to detect the same physical device running several accounts — that
  correlation is not built here.
- **Existing consumer, no producer found:** `qualifyReferral` already
  accepts `signals: readonly AbuseSignal[]` and routes any `"high"`
  severity signal to human review rather than auto-denying
  (`referrals.ts:415-419,494-548`), and its module docstring names the
  exact intended signal: _"Shared-device / shared-payment signals route a
  referral to HUMAN review; they never auto-deny"_ (`referrals.ts:10-12`).
  Searched the repository for anything that actually computes a
  shared-device or shared-payment signal and passes it into this
  parameter: **none found.** The consumption path is built and tested; the
  detection that should feed it is not.
- **Proposed control (proposal-only):** a signal producer — e.g. comparing
  a referee's enrolled device or payment instrument fingerprint against
  other accounts' — that populates `QualifyInput.signals` before calling
  `qualifyReferral`. Given the existing code already treats any such
  signal as review-triggering rather than auto-denying, adding the
  producer (not the consumer) closes this gap without changing the
  human-in-the-loop guarantee already in place. **Appeal path:** same
  review-case flow as §1 (`decideReview`).

## 3. Rider-driver collusion

- **Existing control (implemented):** the marketplace never broadcasts a
  request to "every driver" — `EvaluateEligibility`
  (`services/ride-service/internal/marketplace/eligibility.go:78-138`) is
  described as "the ONE server-owned eligibility function" and refuses a
  driver who is outside the request's radius (`ReasonOutsideRadius`,
  checked against `request.EnvelopeRadiusM`, `eligibility.go:157-159`) or
  whose routed ETA exceeds the request's pickup budget
  (`ReasonPickupEtaTooLong`, `:162-168`). A rider and a specific driver
  cannot arrange for that driver alone to see the request; the driver has
  to already be genuinely near the pickup and reachable in time. The same
  envelope re-applies for a queued next job (`evaluateFinishingTrip`,
  `:180-256`), including a direction/corridor check
  (`ReasonWrongDirection`, `:238-244`) so a queued bid can't be used to
  detour a driver toward a colluding rider's pickup.
- **Existing control (implemented):** only the requester can award a bid —
  the marketplace model (per this prompt's ground truth) has no
  driver-side "accept," so a driver cannot unilaterally lock in a
  favourable rate with a colluding rider without the requester's own
  selection action being the one that binds the terms.
- **Missing control:** no pattern-detection for a rider and driver who
  repeatedly and exclusively match each other across many requests
  (a classic collusion signature — e.g. splitting an inflated commission
  refund, or gaming an incentive's per-trip cap by cycling the same pair).
  Nothing in `ride-service` or `growth-service` computes a
  rider↔driver repeat-pairing rate.
- **Proposed control (proposal-only):** an offline/batch signal — repeat
  rider↔driver pairing rate above a threshold within a rolling window —
  that, like §1/§2, feeds `growth-service`'s existing review-case
  machinery (for incentive-adjacent abuse) or a ride-service-side
  equivalent case queue (per `docs/launch/GAP_REGISTER.md`'s G11: the
  admin dashboard has no "cases" board yet, either). **Appeal path:**
  never an automatic account action; a held incentive/rebate pending human
  review, following the same "hold, don't deny" pattern already
  established in `referrals.ts`.

## 4. Fake completions

- **Existing control (implemented):** the pickup PIN. `VerifyPin`
  (`services/ride-service/internal/move/lifecycle.go:158-...`) requires the
  rider's 4-digit PIN before a trip can start; a wrong PIN costs an
  attempt and a Redis-backed rate limit caps guessing at
  `pinRateLimitAttempts = 5` per `pinRateLimitWindow = 1 minute`
  (`lifecycle.go:144-163`), independent of and on top of the city's own
  permanent attempt ceiling (`config.MaxPinAttempts`, e.g. 3 in the Lagos
  seed, `services/config-service/src/seed/lagos.ts` `maxPinAttempts`
  field) which **permanently locks** the ride's PIN once exhausted,
  requiring support to unlock it (`domain.CodePinAttemptsExhausted`,
  `lifecycle.go:184-186,243`). This directly prevents a driver from
  starting/completing a ride without the actual rider present.
- **Existing control (implemented):** the stationary/motion gate (see §5)
  also guards against a driver spoofing "arrived" or "completed" states
  while not actually near the trip.
- **Missing control:** no server-side check that the trip's _route_
  telemetry (not just the pickup PIN) is consistent with a real trip
  having occurred (e.g. GPS trace length roughly matching the fare's
  claimed distance) before commission is captured. This prompt's ground
  truth already states commission capture happens once at completion; no
  evidence was found of a post-hoc trip-plausibility check gating that
  capture.
- **Proposed control (proposal-only):** a completion-time plausibility
  check (e.g. minimum elapsed time and minimum GPS-trace distance relative
  to the quoted route) that, if it fails, holds the commission capture and
  opens a case rather than blocking the rider's receipt or the driver's
  payout outright. **Appeal path:** a held-not-denied state with a
  support case, consistent with how commission holds already work (§6).

## 5. GPS spoofing

- **Existing control (implemented):** the stationary gate.
  `motionVerdict`/`stationaryVerdict`
  (`eligibility.go:258-331`) classify a driver's recent location samples
  as `parked_confirmed`, `moving`, or `stale_location` from the actual
  telemetry — explicitly, "no attestation may override" clear evidence of
  motion (`eligibility.go:259-260,320-321`), and a parked confirmation is
  refused outright if the telemetry shows speed above the configured gate
  (`ReasonNotStationary`, `:291-299`) or a stale/inaccurate fix
  (`ReasonLocationStale`/`ReasonLocationInaccurate`, `:275-280`). Fix age
  and accuracy are bounds-checked on every eligibility call, not only on
  the parked button (`:121-127`).
- **Existing control (implemented, payment-service):** a separate,
  ML-oriented fraud-detection surface already exists and is mounted (not
  dead code — reachable via `routes/fraud.ts` and `routes/safety.ts`,
  `services/payment-service/src/services/index.ts`): `hasMockLocation` is
  checked directly (`safety-fraud.service.ts:315-321,363,382-383`) and
  `detectGPSSpoofing` runs as part of a broader fraud check
  (`safety-fraud.service.ts:576-582,634`), with `GPS_SPOOFING` as a named
  fraud type in the ML model
  (`services/payment-service/src/types/ml.types.ts:147`,
  `services/payment-service/src/services/ml/fraud-detection.service.ts:247-250`).
  This system is in payment-service, outside this prompt's writable and
  deep-audit scope, so its detection accuracy was not independently
  verified — its existence and live mounting is confirmed, its efficacy is
  not.
- **Missing / unverified:** whether the `hasMockLocation` flag is actually
  populated from a real OS-level mock-location API on both driver
  platforms (Android's `isFromMockProvider()` equivalent, iOS's much
  weaker signal) was not verified — this prompt's read-only scope does not
  include the mobile client code that would set that flag, and GAP
  register G05 separately notes the driver app currently sends **no**
  location telemetry off-device at all (`apps/driver-mobile/src/lib/motion.ts`),
  which would make `hasMockLocation` moot until G05 closes.
- **Proposed control:** none needed beyond closing G05 (already tracked in
  the gap register) — once real telemetry flows, the stationary gate and
  the payment-service fraud checks above already have somewhere to look.

## 6. Offer spam

- **Existing control (implemented):** every bid reserves the 10%
  commission through the driver's wallet **before** it becomes live
  (`CreateBid`, `services/ride-service/internal/marketplace/bids.go:36-49`
  docstring; the reservation-then-insert order is the function's stated
  "money invariant"). A driver cannot submit unlimited free-standing offers
  — each one requires cleared, held funds.
- **Existing control (implemented, atomic):** a per-driver live-bid cap,
  enforced twice — a fast advisory check (`bids.go:152-160`,
  `policy.Bids.MaxLiveBidsPerDriver`) and the authoritative recheck inside
  the same transaction as the insert, serialised on a Postgres advisory
  lock (`AcquireCapLock`, `bids.go:243-258`) so "N concurrent submissions
  can never end with more than the cap live" (comment at `:244-246`). A
  driver is also blocked from holding two live bids on the _same_ request
  (`bids.go:162-164`).
- **Existing control (implemented):** every bid submission requires an
  idempotency key (`ValidateIdempotencyKey`, `bids.go:52`), so a client
  retry cannot itself manufacture duplicate offers.
- **Missing control:** no evidence of a rate limit on how quickly a driver
  can _withdraw and resubmit_ to cycle through the live-bid cap repeatedly
  (e.g. spamming revise/withdraw/resubmit against many different requests
  in quick succession) — the cap bounds _how many_ are live at once, not
  _how fast_ a driver can churn through requests.
- **Proposed control (proposal-only):** a short per-driver cooldown on
  bid submission rate (distinct from the funded-live-bid cap above),
  mirroring the existing PIN rate limit's shape (a Redis counter with a
  window, `lifecycle.go:144-163`) — refusing with a `rate_limited` code
  that is honest about being a pacing limit, never a denial of eligibility
  or a mark against standing. **Appeal path:** none needed — a rate limit
  by definition self-clears after the window; this is explicitly _not_ a
  punishment for declining offers (a driver who simply doesn't bid is
  never touched by this).

## 7. Repeated cancellation

- **Existing control (implemented, but a fee, not an abuse control):**
  city config carries a `cancelPolicy` (`services/config-service/src/seed/lagos.ts`
  `cancelPolicy` block: `riderFeeAfterAssignMinor`, `driverFeeMinor: 0`,
  `freeWindowSec`) that charges the rider a fee for cancelling _after_ a
  driver is assigned, and explicitly charges a driver **nothing** for
  cancelling (matching the marketing-site's own honest driver-facing copy,
  `apps/marketing-site/src/app/drive/page.tsx:222-225`: "Cancellations by
  riders after you're assigned are charged to them, not to you"). This is
  a per-incident fee that compensates the other party for _that_
  cancellation — it is not a pattern-detection control.
- **Missing control:** searched `ride-service` for any cancellation
  _count_, streak, or threshold logic (driver or rider) — **none found.**
  Nothing currently distinguishes a driver who cancels occasionally for a
  legitimate reason from one who repeatedly cancels low-value trips while
  cherry-picking high-value ones, and nothing distinguishes a rider who
  repeatedly cancels after assignment to avoid the fee via some other
  means. This matches `docs/launch/GAP_REGISTER.md`'s G11 finding at the
  admin layer — only two of nine planned admin boards exist, and
  "standing/appeals" is explicitly one of the missing ones, so even if a
  pattern were detected today there is no admin surface to review it.
- **Proposed control (proposal-only):** a rolling-window cancellation-rate
  counter per driver and per rider (e.g. cancellations in the last N
  completed-or-cancelled trips), surfaced first as an internal metric,
  then — only past a generous, clearly-documented threshold — a soft
  standing effect (e.g. temporarily narrower eligibility envelope, never
  suspension without human review) with the exact reason and threshold
  disclosed to the affected person. **Never** counts a driver declining to
  bid (declining isn't cancelling) or a cancellation attributable to poor
  connectivity (e.g. one immediately followed by a reconnect and honest
  retry) against the count — this distinction has to be designed in from
  the start, not bolted on later, precisely because the failure mode this
  prompt warns against (punishing declines/connectivity) is easy to
  introduce accidentally in a naive "count cancellations" implementation.
  **Appeal path:** the same missing admin "standing/appeals" board G11
  already calls for — this proposal and G11's closure are the same piece
  of work.

## Summary: implemented vs proposal-only

| Vector                 | Implemented today                                                                                 | Proposal-only                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Self-referral          | Deterministic-code self-match guard                                                               | Feed shared-device/payment signals into existing review path                                 |
| Multi-accounting       | Unique phone; per-user device namespacing (deliberately not cross-correlating)                    | A signal _producer_ for the review path that already exists and expects one                  |
| Rider-driver collusion | Geo/ETA eligibility envelope; requester-only award                                                | Repeat-pairing rate detection + review case                                                  |
| Fake completions       | PIN + dual-layer rate limit/lockout; stationary gate                                              | Route-plausibility check before commission capture                                           |
| GPS spoofing           | Stationary/motion gate (ride-service); mock-location + ML fraud checks (payment-service, mounted) | None new — depends on closing G05 (driver telemetry)                                         |
| Offer spam             | Funded-bid requirement; atomic per-driver live-bid cap; idempotency keys                          | Submission-rate cooldown, separate from the live-bid cap                                     |
| Repeated cancellation  | Per-incident fee (not a pattern control)                                                          | Rolling cancellation-rate signal + soft standing effect, tied to G11's missing appeals board |

Nothing in this document was implemented as code in this pass — every
"existing control" row cites code that already existed before this prompt
started; the only code changes this prompt made anywhere are the two
small growth-service idempotency fixes in `docs/growth/ECONOMICS.md` §7,
which are unrelated to this document's seven vectors (they are budget/
double-pay races, not abuse controls).
