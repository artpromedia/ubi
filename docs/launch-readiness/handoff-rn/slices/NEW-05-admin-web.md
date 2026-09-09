# NEW-05 — Admin growth, marketing assistant, travel/AI operations, consumer web (boards 23a–23f)

## Admin (apps/admin-dashboard, Next 15, (admin) group, @ubi/ui)
Routes: /growth (overview) · /growth/campaigns · /growth/campaigns/new · /growth/campaigns/[id] (versions, outcome) · /growth/commission · /growth/referrals (review queue + case panel) · /growth/recon · /growth/assistant · /growth/experiments · /growth/attribution · /ops/travel (exceptions, refunds, settlement, provider health) · /ops/ai-actions.
Components: CampaignForm (Form + zod), LiabilityPanel, ApprovalPanel, CampaignTable (DataTable), OutcomePanel (metric cards with denominator/window/CI, method label), AbuseQueue + AbuseCasePanel, AssistantThread + ProposalGrid, TravelExceptionsTable, ProviderHealthStrip, AiActionsTable. Nav: add Growth and Ops › Travel / AI entries to `components/layout/navigation.tsx` (only pages that exist).
API (contracts/openapi/growth-ops.yaml): /v1/growth/campaigns (+versions/simulate/submit/activate/pause/resume) · /v1/growth/referrals/review-queue + decision · /v1/growth/commission-incentives/live · /v1/growth/recon/:date · /v1/ai/marketing/threads/:id/messages · /v1/growth/experiments · /v1/growth/attribution/report · /v1/ops/travel/exceptions (+lookup/escalate/accept-diff/dispute) · /v1/ops/travel/providers/health · /v1/ops/ai/actions · /v1/ops/ai/metrics. Approvals reuse the config-service two-person flow.

## Consumer web (apps/web-app, (app) group, next-intl)
Routes: /travel (search + results + Ask panel) · /travel/checkout/[cartId] · /trips/[tripId] (booking management) · /ask · /benefits (+ referrals). Components: TravelSearchBar, OfferRow, AskPanel, TripItemCard, HandoffBanner (Universal/App Links → rider-mobile; attribution token stored server-side 30 d; web remains fully usable). Marketing site: sections only for enabled capabilities with real store links.

## Analytics / testIDs
growth.*, ops.travel.*, ops.ai.*, web.* (ANALYTICS_TESTIDS.md).

## Placement
`web/apps/admin-dashboard/src/app/(admin)/growth/**`, `…/ops/travel/page.tsx`, `…/ops/ai-actions/page.tsx`, `src/components/growth/*` · `web/apps/web-app/src/app/(app)/{travel,trips/[tripId],ask,benefits}/page.tsx`, `src/components/travel/*`.

## Acceptance
Playwright (existing e2e setup): campaign draft → simulate → submit → second approver activates; author cannot approve own; exhausted state shows timestamp; outcome metrics show denominators; abuse decision requires reason; assistant output saves as DRAFT only; travel exception lookup never re-books; AI action refused rows visible. Web: travel search → checkout → trip page; handoff banner opens app link and falls back; attribution claimed on first app open (E2E with RN build).

## Claude Code prompt
"Implement NEW-05: admin growth/ops routes in apps/admin-dashboard and consumer travel/Ask/benefits/trips routes in apps/web-app from design_handoff_ubi_rn_migration/web, using @ubi/ui and the existing auth/approval flows, per contracts/openapi/growth-ops.yaml; add nav entries only for pages that exist; add Playwright tests listed; update marketing-site sections only for enabled capabilities with real store links; implement web-to-app handoff with server-side attribution token and fallback."
