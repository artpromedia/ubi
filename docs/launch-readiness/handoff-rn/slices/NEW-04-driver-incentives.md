# NEW-04 — Driver commission incentives, referrals, progress, statements (boards 22c–22d)

## Screens (driver-mobile)
Home `IncentiveStrip` (read-only, aria-live, only when a rebate/window is live; no interaction while moving) · `Incentives.Overview` (RebateCard base/points/effective + worked example, WindowCard with caps, ReferralMilestones, QuestCard from 18c) · `Incentives.CommissionDetail{incentiveId}` (rule table, worked example, pp-vs-% note) · `Earnings.Statement{periodId}` gains rebate / window / reversal lines and per-trip commission detail.

## Rules rendered (server computes)
rebate{baseBps, reductionBps, kind: percentage_points|percent_of_commission, effectiveBps, appliesTo: fare_only, exclusions[tips,tolls,taxes], eligibility{completedPaid, firstN}, cashSettlement: nets_against_owed, fleetInteraction: after_rebate, rounding: kobo_per_trip, endsAt, fundedBy} · window{start,end,zones[], tripCap, moneyCapMinor, startedInWindow:true} · milestones{approved, trips25, trips100{deadline}} · reversal{reasonCode, tripId}.

## API (contracts/openapi/incentives.yaml)
GET /v1/driver/incentives · GET /v1/driver/incentives/:id · GET /v1/driver/statements/:period (lines with ledgerLineId, kind ∈ fare, tip, toll, commission, rebate, window_waiver, rebate_reversal, cash_collected, remittance, payout) · GET /v1/driver/referrals.
Events: incentive.rebate.posted{tripId, ledgerLineId, amountMinor} · incentive.window.applied · incentive.rebate.reversed{reasonCode} · driver_referral.milestone_reached/paid · statement.finalised.

## Backend guidance
Compute base commission through existing city/pricing rules; each rebate is a separate journal line with counterpart; never edit the global rate; caps atomic; cash trips net; fleet split (slice 10) after rebate; reversals disclosed; statement totals from ledger only.

## Placement
`rn/apps/driver-mobile/src/components/IncentiveStrip.tsx` · `src/screens/incentives/{IncentivesScreen,CommissionDetailScreen}.tsx` · `src/screens/earnings/StatementScreen.tsx` · `src/api/incentives.ts` · fixtures `src/dev/fixtures/incentives.ts`.

## Acceptance
jest: pp vs % copy switches by kind; strip hidden with no live incentive; statement lines map 1:1 to ledger lines. Server: rounding, cap at boundary, cash netting, fleet order, reversal on refund, window boundaries by trip start. Maestro: driver_incentives_overview · commission_detail · statement_rebate_lines.

## Claude Code prompt
"Implement NEW-04: driver rebates, commission-free windows and driver referral milestones as separate auditable ledger lines per contracts/openapi/incentives.yaml and db/migrations/009; RN driver screens per rn/apps/driver-mobile/src/{components,screens/incentives,screens/earnings} with copy from boards 22c–22d; flag driver_commission_rebates; tests and Maestro flows listed."
