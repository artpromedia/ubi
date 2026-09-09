# Handoff: UBI — React Native migration + Ask UBI, travel, growth (boards 20–23)

Target repo: **artpromedia/ubi @ master** (read 2026-09-09; 75 commits past the launch-handoff baseline 8aa7c26). This package continues `docs/launch-readiness/handoff/` (slices 01–12); it does not restart it.

## What is true in the repo today (verified by reading source, not docs)
- **No React Native exists anywhere.** No metro/expo config, no RN package, no `.tsx` outside Next.js apps and `packages/ui`. Mobile is Flutter: `mobile/apps/rider_app` (go_router, BLoC, flag-gated routes) and `mobile/apps/driver_app`.
- `apps/driver-app` is a **Next.js web app** (port 3002), not a mobile target. The RN apps therefore land at **`apps/rider-mobile`** and **`apps/driver-mobile`** (pnpm workspace already globs `apps/*`).
- Web: Next 15 · React 19 · Tailwind · `@ubi/ui` (50 components + 16 `ubi/*` composites) · react-query · zustand · zod · next-auth · next-intl (web-app). Admin: `apps/admin-dashboard` `(admin)` route group with 5 pages and a nav that advertises more.
- Contracts are closed registries: `packages/contracts/src/flags.ts` (`FLAG_KEYS`, 16 flags, deny-by-default, 404 when off) and `packages/contracts/src/test-ids.ts` (`TEST_IDS`). This handoff **adds** keys there (see `ANALYTICS_TESTIDS.md`); nothing bypasses them.
- Backend: config-service, gateway identity context, user-service (auth/KYC/device trust), payment-service new ledger (double-entry, DB-enforced balance), ride-service (Go), food-service (Bites backend) are implemented (579 tests). Slices 06–10 (Send, flights One-Ticket, journeys, stays, fleet) are **not started** — travel here binds to new supplier adapters, not to One-Ticket 8a–8e.
- Native identifiers (bundle id / applicationId / signing / URL schemes) are **not tracked in the repo**. Take them from the store consoles and signing store; never generate replacement production keys.

## About the design files
Everything under `design/` is a **design reference built in HTML** (boards 20–23; boards 1–19 are in `docs/launch-readiness/handoff/design`). It shows intended look, copy, states and behaviour — it is not production code and must not be shipped or wrapped. Recreate the screens in the codebase's own environments: **React Native TypeScript** (`apps/rider-mobile`, `apps/driver-mobile`) for phones using the `.tsx` starting points in `rn/`, **Next.js/React** (`apps/admin-dashboard`, `apps/web-app`) for consoles and consumer web using `web/`, Hono/Go services for the backend per `contracts/`. Open the boards with a static server (e.g. `npx serve design`) and use the anchors (#20a … #23f).

## Fidelity
**High-fidelity.** Colours, type, spacing, copy and states are final; recreate pixel-close from `packages/design-tokens` (mirrored in `tokens/semantic-tokens.json` and `rn/packages/mobile-tokens`) — never Material colour roles, never invented hexes. Poppins for headings, Inter for body, monospace for refs/PNRs/plates; money tabular-nums from city config. Rider light-default, driver dark-default, both themes WCAG 2.2 AA.

## Start here for Claude Code
`CLAUDE_CODE_PROMPT.md` (paste-ready master prompt) · `COMPLETENESS.md` (what is designed, coded, specified, and the honest gaps) · `CLOSING_THE_GAPS.md` (exact steps + evidence to close each gap) · `FLUTTER_TO_RN_CUTOVER.md` (how Flutter is frozen and removed).

## Deliverables in this package
- `FLUTTER_TO_RN_CUTOVER.md` — **how to drop Flutter**: freeze, mine for behaviour, build order, identity/session upgrade, required CI, store cutover, removal PR, definition of done.
- `MIGRATION_MAP.md` — every Flutter route → RN destination, reusable components, contracts, retained states, evidence.
- `slices/` — RN-01, RN-02, NEW-01 … NEW-05: routes/screens + state transitions, reuse list, API/event mapping, analytics + testIDs, placement map, fixtures boundary, acceptance, dependency notes, paste-ready Claude Code prompt.
- `rn/` — React Native TypeScript: `packages/mobile-tokens`, `packages/mobile-ui`, `packages/mobile-core`, `apps/rider-mobile`, `apps/driver-mobile` (navigation, typed routes, API boundaries, screens for every new feature, dev fixtures). Native RN primitives only — no HTML.
- `web/` — Next.js/React additions for `apps/admin-dashboard` and `apps/web-app` using `@ubi/ui`.
- `contracts/` — OpenAPI 3.1 for ask, mandates, travel v2, promotions/referrals, driver incentives, growth admin, ops; event catalog additions; state-machine additions.
- `db/` — forward migrations 009–012 (Postgres; translate to Prisma models in `packages/database`, keep one owner per table, bigint minor units + currency).
- `ACCEPTANCE.md` — visual acceptance references (board ids), screen-state coverage matrix, interaction specs.
- `DEPENDENCIES.md` — RN stack manifest with what is pinned vs to-validate; honest "unverified build" labels.
- `design/` — boards 20–23 (HTML design references; open with a static server), device frames, runtime, map/brand assets. Boards 1–19 remain in the launch handoff.

## Honesty labels used throughout
- **verified** — read in source or run.  **specified** — designed and contracted here, not yet built.  **unverified build** — RN/native files authored without a compiler or device in this environment. Every `rn/` file is *unverified build* until CI proves otherwise.

## Ordered slices (one PR train each)
1. **RN-01** Rider RN shell + migrated journeys (auth, home/flags, ride all states, Bites, Send, wallet/receipts, profile) — the acceptance demo runs rider ⟷ driver across the two RN apps against staging.
2. **RN-02** Driver RN shell + migrated journeys (onboarding/docs, online/offline, offer, trip execution, earnings/payouts, safety, fleet arrangement) incl. background location and restart recovery.
3. **NEW-01** Ask UBI, transaction review/status, automation (mandates) — boards 20a–20d.
4. **NEW-02** Flights, stays, itinerary, servicing, airport ride linkage — boards 21a–21e.
5. **NEW-03** Rider offers, benefits, referrals, attribution entry points — boards 22a–22b (+ 23f handoff).
6. **NEW-04** Driver commission incentives, referrals, progress, statements — boards 22c–22d.
7. **NEW-05** Admin growth, marketing assistant, travel/AI operations, consumer web — boards 23a–23f.

## Board index
20a Ask entry + plan · 20b clarify/policy + transaction review · 20c processing/partial/handoff · 20d mandates · 21a flight search/results · 21b stay rates, passenger, checkout · 21c status ladder + itinerary · 21d refund tracker + disruption (covered / not) · 21e airport ride attach + linked outcomes · 22a quote savings (+ exhausted) · 22b benefits + referrals · 22c driver strip + incentives · 22d commission detail + statement · 23a campaign builder · 23b campaigns + outcomes · 23c referrals/abuse (+ commission, recon tabs) · 23d marketing assistant · 23e travel ops + AI actions · 23f consumer web + handoff.

## Cast and fixtures (dev only — see `rn/apps/rider-mobile/src/dev/fixtures`)
Rider Adaeze Chioma Nwosu · Driver Chinedu Okafor (fleet Okafor Motors) · Trip Abuja Fri 12 – Sun 14 Sep 2026 · Flight Air Peace P4 7120 LOS→ABV 06:45 Saver ₦148,500 (taxes ₦8,400) · Alternates Ibom Air QI 0312/0316 · Stays Transcorp Hilton (₦370,000) / Fraser Suites (USD 262 → ₦412,600 @ 1,574.8) · Ride rd_314 ₦3,100 · Rebate 5 pp on 20% base. Fixtures never ship: the production API boundary is `src/api/*`, fixtures load only when `__DEV__ && UBI_FIXTURES=1`.
