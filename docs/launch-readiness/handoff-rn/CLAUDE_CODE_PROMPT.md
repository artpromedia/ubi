# Paste-ready Claude Code prompt — UBI RN migration + Ask UBI / travel / growth

Copy everything below the line into Claude Code, run from the repo root on the authorized branch, with this folder attached (or committed at `docs/rn-handoff/`).

---

You are UBI's lead React Native and backend integration engineer working in https://github.com/artpromedia/ubi (default branch `master`). The owner confirms the launch handoff slices 01–05 are implemented server-side; mobile is still Flutter. Your job: complete the mandatory Flutter → React Native migration and implement the new AI, travel and growth features, using the attached design handoff `design_handoff_ubi_rn_migration/` as the source of truth for screens, contracts and rules.

## Read first, in this order
1. `design_handoff_ubi_rn_migration/README.md`, `CLAUDE.md` (rules 13–30 extend `docs/launch-readiness/handoff/CLAUDE.md` 1–12), `COMPLETENESS.md`, then `CLOSING_THE_GAPS.md` — the step-by-step for every stated gap (porting boards 1–19, making the RN/web files compile, Android parity, the specified-only screens, owner decisions).
2. `FLUTTER_TO_RN_CUTOVER.md` — do §0 (freeze Flutter, rename its CI job non-required, rewrite stale "mobile is Flutter" instructions without weakening security/review rules) in your first PR.
3. `MIGRATION_MAP.md`, `DEPENDENCIES.md`, `ACCEPTANCE.md`, `ANALYTICS_TESTIDS.md`.
4. `contracts/openapi/*.yaml`, `contracts/events/catalog-additions.md`, `contracts/state-machines-additions.json`, `db/migrations/009–012`.
5. The slice you are on: `slices/RN-01 … NEW-05`. Each has a placement map and its own acceptance list.
6. Boards for pixel reference: `design/*.dc.html` (serve statically, e.g. `npx serve design`; anchors #20a … #23f). Boards 1–19 are in `docs/launch-readiness/handoff/design`.

## Non-negotiables
- Deliver **two separate RN TypeScript apps**: `apps/rider-mobile`, `apps/driver-mobile`, iOS + Android, keeping the Flutter apps' bundle ids, applicationIds, signing, URL schemes, Universal/App Links and push sender ids (from the store consoles; never generate production keys). No Dart, no add-to-app, no WebView journeys. Flutter under `mobile/` is a frozen reference until removal per the cutover plan.
- Start from `rn/` in the handoff: `packages/mobile-{tokens,ui,core}` and the two app skeletons (typed `routes.ts`, `linking.ts`, navigators, `src/api/*` boundaries, `src/dev/fixtures` gated by `__DEV__ && UBI_FIXTURES=1`, feature screens). Treat every file as *unverified build*: make it compile, pin versions per `DEPENDENCIES.md`, replace `PlaceholderScreen` with the ported journeys.
- Reuse existing services and packages (`@ubi/contracts` flags + TEST_IDS registries — add the new keys there; `@ubi/config-client` semantics; ride-service (Go), user-service, payment-service ledger, food/delivery services, realtime-gateway, notification-service, config-service two-person approvals). Add bounded modules for ask-service, travel adapters, promotions/incentives, action grants + mandates; one owner per table; bigint minor units + currency.
- Server computes all money and eligibility; clients render `adjustments[]`, ladders and eligibility objects. Status words are contractual (SUGGESTION · LIVE PRICE · AWAITING YOUR CONFIRMATION · PROCESSING · SUPPLIER PENDING · CONFIRMED · TICKETED · FAILED · EXPIRED · PARTLY BOOKED · BLOCKED). No "pay again" copy anywhere.
- The model never moves money: read tools with actor from the gateway context; transactional tools only with a server-minted single-use action grant bound to terms version/total/currency/expiry/idempotency/assurance; mandates revalidated and allowance reserved atomically per run; P2P, account admin, campaign activation and budget changes are out of the model's reach and logged as refused. Serve open-weight models privately (validate Qwen3-30B-A3B-Instruct-2507 / Qwen3-Embedding-0.6B licence, revision, tool calling; pin).
- Travel: promises come from adapter capability fields on the specific offer (hold, price guarantee, merchant of record, change/refund, currency, pay-at-property). Per-item orders; explicit ladder (PNR ≠ ticket); unknown results reconcile by UBI reference — never re-purchase; verified/deduped webhooks via the outbox and ledger; comparison harness with config-stored commercial rates.
- Growth: distinct benefit types as ledger objects; driver rebates as separate journal lines against an unchanged base rate, with `percentage_points` vs `percent_of_commission` explicit; budget reserved on promise, consumed on qualification; referrals from server-verified events; shared device/payment → human review, never auto-deny; reversals as disclosed compensating entries.

## Deliver in this order (one PR train per slice; commits focused by slice)
1. Cutover §0 + shared foundations (`packages/mobile-*`, flags/testIDs registry additions, CI jobs `rn-test` / `rn-android` / `rn-ios` (macOS) / `rn-e2e` as required checks that fail on error — no continue-on-error, no skips, no manual pass).
2. **RN-01** rider shell + retained journeys; **RN-02** driver shell + retained journeys (background location, offers with city-config TTL, restart/reconnect restore, secure session + Flutter→RN upgrade bridge or controlled re-auth). Lockstep acceptance across the two RN apps against staging.
3. Travel adapters, promotions/referrals, driver incentives, grants + mandates: contracts, forward migrations, ledger integration, tests (**NEW-02/03/04** backend).
4. **NEW-01** ask-service + Ask UBI/mandates screens over those verified services.
5. **NEW-02/03/04** RN screens, **NEW-05** admin + consumer web + marketing-site updates (enabled capabilities only), then integrated acceptance evidence.
6. Store cutover and Flutter removal per `FLUTTER_TO_RN_CUTOVER.md` §5–§6.

## Tests you must add (minimum)
Strict tool schemas · wrong-user access · prompt injection via retrieved/provider content · redaction · expired/replayed grants · changed terms → new review · revoked mandate · concurrent mandate spend caps · versioned task suite (launch languages, ambiguous dates/currencies, policy questions, live status, supported transactions) with thresholds: 0 unauthorised actions, 0 credential leaks · provider fixtures + sandbox: duplicate submissions/callbacks, timeout then late confirmation, PNR-without-ticket, refund tracking, partial linked success, settlement difference, FX lock · promotions: concurrent reservations at cap, stacking priority, stable holdout, reversal on refund, attribution unknown vs organic · rebates: rounding, cap boundary, cash netting, fleet order, reversal · Maestro flows named in each slice · Playwright for admin/web listed in NEW-05.

## Finish with
Implemented paths · four-platform build results with commit ids · retained-journey matrix with evidence · new-feature E2E results · provider sandbox evidence · model evaluation/cost results · migrations · rollout/rollback steps · remaining external blockers (exact credential, runner, provider capability or contract decision). Distinguish implemented / verified / externally blocked. A Flutter delivery, a WebView shell, or disabled-flag functionality is not completion.
