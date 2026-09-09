# Completeness check — Claude Design prompt vs what this package contains

Legend: **designed** = hi-fi screens on a board · **code** = RN/React file in this package · **specified** = routes/contracts/states written, no file · **gap** = intentionally not done here, stated.

## The ten additions
| # | Addition | Boards | RN / web code | Contracts | Status |
|---|---|---|---|---|---|
| 1 | Ask UBI — entry, plans, live quotes, clarifying fields, sourced policy answers, transaction review, status, human handoff; conventional forms remain | 20a, 20b, 20c | rider `screens/ask/*`, `components/ask/*`; web `AskPanel`, `/ask` | `ask.yaml`, events, `askReview`/`askExecution` machines, 010 SQL | designed + code |
| 2 | Flights & stays — search/filter/compare, passenger/guest details, full price & terms, checkout, provider confirmation, itinerary, changes/cancellations, refund progress, support; baggage, fare rules, occupancy, pay-now vs at-property, currency, local time zones, cancellation deadlines; hold timer only when guaranteed | 21a, 21b, 21c, 21d | rider `screens/travel/*` (11 screens), `components/travel/*`; web `/travel`, `/trips/[tripId]` | `travel-v2.yaml`, `travelOrder`/`travelRefund` machines, 011 SQL | designed + code · web checkout page **specified** (route + RN checkout as reference) |
| 3 | Airport ride linkage — attach reservation, separate outcomes, per-part policies, disruption alternatives only when supported | 21e, 21d | `AttachAirportRideScreen`, `LinkedOrdersScreen`, `DisruptionScreen` | reservations endpoints in travel-v2, `rideReservation` machine | designed + code |
| 4 | Rider offers & referrals — savings at quote/checkout, first-use, retention, referral sharing/qualification/reward, benefits screen; discount vs fee waiver vs credit; eligibility, min spend, caps, expiry, stacking, pending, reversal | 22a, 22b (+ 20a home row) | `SavingsBreakdown`, `SavingsChangedBanner`, `BenefitsScreen`, `ReferralsScreen`; web `/benefits` | `promotions.yaml`, `referral`/`promotionReservation` machines, 009 SQL | designed + code |
| 5 | Driver incentives — time-limited commission discounts, zero-commission windows with caps, referral milestones, trip incentive; base/rebate/effective/eligible/time left/statement; pp vs % explicit; safe while driving | 22c, 22d | driver `IncentiveStrip`, `IncentivesScreen`, `CommissionDetailScreen`, `StatementScreen` | `incentives.yaml`, 009 SQL | designed + code · driver Referrals/Window detail screens **specified** (placeholders in navigator) |
| 6 | Admin growth — campaign creation, audience, geo/time, benefit, qualification, stacking, funding, liability preview, budget, holdout, approval, activation, pause, exhaustion, outcomes; commission incentive view, referral review, abuse queue, promotion recon | 23a, 23b, 23c | `CampaignForm`, `LiabilityPanel`, `StateBadge`, `OutcomePanel`, campaigns + referrals pages | `growth-ops.yaml`, `campaign` machine, 009 SQL | designed + code · commission-incentive view and promotion-recon pages **specified** (23c sibling tabs; reuse 13c recon table) |
| 7 | AI marketing assistant — briefs, audiences, localized copy, channel variants, experiment summaries; evidence, assumptions, budget impact, editable; drafts only; comms preferences + frequency caps | 23d | admin `assistant/page.tsx` | `growth-ops.yaml` `/v1/ai/marketing/*`, `Proposal` schema | designed + code |
| 8 | Admin travel & AI ops — exceptions, pending ticketing, provider uncertainty, refunds, settlement differences, provider health, AI action history, model/version, task success, cost, blocked reasons; reuses ops/support surfaces | 23e | admin `ops/travel/page.tsx`, `ops/ai-actions/page.tsx` | `growth-ops.yaml` `/v1/ops/*`, 012 SQL | designed + code |
| 9 | Consumer web — responsive travel, Ask UBI, benefits/referrals, checkout, booking management; marketing only for enabled capabilities; web-to-app handoff with fallback | 23f | `/travel`, `/ask`, `/benefits`, `/trips/[tripId]`, `HandoffBanner`, `OfferRow`, `AskPanel` | same contracts as RN; attribution claim in promotions.yaml | designed + code · marketing-site sections **specified** (NEW-05) |
| 10 | Authorized automation — mandates with allowed action, passenger, provider/category, spend limit, frequency, expiry, material-term constraints, history, pause/revoke; receipts; P2P/admin/unrestricted excluded | 20d | `MandatesScreen`, `MandateEditorScreen`, `MandateReceiptScreen` | `mandates.yaml`, `mandate`/`mandateRun` machines, 010 SQL | designed + code |

## Retained journeys (RN-01 / RN-02)
| Requirement | Where | Status |
|---|---|---|
| Map of supported rider and driver journeys Flutter → RN with destination, reusable components, contracts, retained states, evidence | `MIGRATION_MAP.md`; board 20 panel | done |
| Existing RN work located | none exists (verified) | done |
| Screens for retained journeys | boards 1–19 in `docs/launch-readiness/handoff/design` (already in repo) | **designed earlier; RN files not authored here** — navigators carry typed routes + `PlaceholderScreen`; RN-01/RN-02 build them from those boards |
| Flutter removal guidance | `FLUTTER_TO_RN_CUTOVER.md` | done |

## Shared design rules (prompt §"Shared design rules")
Server computes money/eligibility (all screens render `adjustments[]`, ladders, eligibility objects) ✓ · internal terms out of customer copy (ActionGrant/adapter/ledger never appear on rider/driver screens) ✓ · states: loading, empty, offline, expired offer, repricing, ineligible, exhausted, permission denied (FlagGate), payment pending, supplier pending, partial success, cancelled, refunded, reversed incentive, support escalation — see `ACCEPTANCE.md` matrix ✓ · pending stays pending; no "pay again" copy ✓ · secure confirmation reused (SecureConfirm route) ✓ · both themes from tokens; dynamic type (`maxFontSizeMultiplier=2`), screen-reader labels for money/status, 44/48 targets, reduced-motion note, keyboard avoiding, localization via i18next ✓ · no unfunded promises (eligibility.covered, priceGuaranteeUntil, protectionOffered fields) ✓.

## Per-slice deliverables (prompt §"For every slice deliver")
| Deliverable | Where |
|---|---|
| 1 Routes/screens + state transitions + reuse | `slices/*.md` §Routes/§State transitions/§Reuse; `routes.ts` |
| 2 RN .tsx with native primitives; React for web | `rn/**`, `web/**` (no HTML in mobile) |
| 3 Exports, props, nav params, tokens, validation, a11y labels | in each `.tsx`; `@ubi/mobile-tokens`; `routes.ts` |
| 4 API/event mapping, loading/reconnect, analytics, testIDs, placement map | slices §API, `@ubi/mobile-core/realtime`, `ANALYTICS_TESTIDS.md`, slices §Placement |
| 5 Fixtures isolated / production boundary | `src/api/*` vs `src/dev/fixtures/*` gated by `__DEV__ && UBI_FIXTURES=1` |
| 6 Visual acceptance refs, interaction specs, state coverage, dependency manifest, honest labels | `ACCEPTANCE.md`, `DEPENDENCIES.md`, "unverified build" labels throughout |

## Gaps stated honestly
1. RN files for boards 1–19 (auth, ride states, Bites, Send, wallet, profile, driver trip execution, documents, fleet) are not in this package — they are the RN-01/RN-02 work, designed on the launch board and mapped in `MIGRATION_MAP.md`.
2. No compiler, simulator or device was available: every `rn/` and `web/` file is *unverified build*.
3. Android-specific frames for the new screens were not drawn; the Android parity rules (48 dp, sheet radius 28, back handling) from slice 12 apply unchanged.
4. Driver Referrals / Window detail, admin commission-incentive and promotion-recon pages, web checkout page, marketing-site sections: specified, not authored.
5. Supplier choice (Duffel Stays vs Nuitee/LiteAPI), RN version pinning, background-location library licence, bundle identifiers: owner decisions recorded as such.

**How to close each gap: `CLOSING_THE_GAPS.md`** — inputs, files to create, the sibling to copy, and the evidence that closes it.
