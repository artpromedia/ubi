# NEW-03 — Rider offers, benefits, referrals, attribution (boards 22a–22b, 23f handoff)

## Screens
Ride.Quote gains `SavingsBreakdown` + `SavingsChangedBanner` (22a) · Travel.Checkout shows `adjustments[]` (none/eligible) · `Account.Benefits` BenefitsScreen (credit card, offers, changes) · `Account.Referrals` ReferralsScreen (share, status list) · Home benefits row (20a). Web: /benefits (NEW-05). Attribution entry: deferred deep link → `/v1/attribution/claim` on first open; web handoff banner (23f).

## Rules the UI renders (server computes)
Benefit types: fare_discount (fundedBy marketing; driver unaffected) · fee_waiver · credit (expiry, perRideCap, scope) · referral_reward. Offer statuses: active · scheduled · used_up (exhaustion timestamp) · expired · ineligible(reasonCode: min_spend, scope, cap_reached, market) . Changes: earned · reversed{reasonCode, termsRef} · expired. Referral stages: invited → installed → qualifying(deadline) → in_review → rewarded | reversed | expired; caps per month.

## API (contracts/openapi/promotions.yaml)
Quote/checkout responses carry `adjustments[]{type,label,amountMinor,fundedBy,campaignVersionId,reasonCode?}` and `payableMinor`; POST create returns 409 quote_changed with new breakdown when eligibility changed. GET /v1/benefits · GET /v1/referrals · POST /v1/referrals/share → {code, url} · GET /v1/referrals/:id · POST /v1/attribution/claim {token|code, campaign} · GET /v1/benefits/changes/:id (terms link).
Events: promotion.reserved{campaignVersionId, userId, amountMinor, expiresAt} · promotion.consumed · promotion.released · promotion.exhausted{at} · referral.{created,installed,qualified,review_requested,rewarded,reversed} · attribution.claimed{source, campaign, unknown:boolean}.

## Backend guidance
Extend the canonical promotion/loyalty implementation if present (grep schema-*.prisma fragments as design material only); forward migrations from db/009. Atomic reserve/consume against campaign/user/referral caps with idempotent event processing; campaign version pinned to each promise; reversals as compensating entries; qualification only from ride.completed_and_paid; abuse checks → review queue (never auto-deny household sharing).

## Placement
`rn/apps/rider-mobile/src/components/ride/{SavingsBreakdown,SavingsChangedBanner}.tsx` · `src/screens/benefits/{BenefitsScreen,ReferralsScreen}.tsx` · `src/api/benefits.ts` · fixtures `src/dev/fixtures/benefits.ts`.

## Acceptance
jest: breakdown renders all adjustment types; exhausted banner from reasonCode; referral rows by stage. Server: concurrent reservations at cap, stacking priority, stable holdout, reversal on refund, attribution unknown vs organic. Maestro: quote_with_savings · quote_offer_exhausted · benefits_reversal_explained · referral_share_status · deeplink_attribution_claim.

## Claude Code prompt
"Implement NEW-03: promotions/referrals module per contracts/openapi/promotions.yaml and db/migrations/009 (atomic caps, reservation on promise, versions, reversals, review queue), adjustments[] on ride quotes and travel checkout, attribution claim endpoint; RN screens and components per rn/apps/rider-mobile/src/{components/ride,screens/benefits}; flags rider_promotions, referrals; tests and Maestro flows listed."
