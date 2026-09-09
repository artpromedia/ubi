# RN migration + AI/travel/growth — status

Phase 3 of the UBI launch work: the mandatory Flutter→React Native migration plus
the Ask UBI (open-weight AI), travel (flights/stays), and growth (promotions,
referrals, driver incentives, marketing) features. Continues
`docs/launch-readiness/handoff-rn/` (boards 20–23); does not restart phases 1–2.

Labels: **verified** = tsc/tests/build run green here · **externally blocked** =
needs a credential, runner or hardware absent from this environment.

## What is implemented and verified

| Area | What | Evidence |
|---|---|---|
| Contracts | +9 flags, +78 events, +new testIDs, +10 state machines (21 total) | packages/contracts tsc 0, 94 tests |
| Database | 35 Prisma models (migrations 009–012) + forward migration | validate ok; chain applies to empty DB; zero drift |
| travel-service (new) | flight/stay adapters + capabilities, per-item orders, the travelOrder ladder (PNR≠ticket, reconcile-before-repurchase), refunds, disruptions, verified+deduped webhooks, settlements, ops/travel | tsc 0; 19 vitest on real Postgres |
| ask-service (new) | ModelProvider/EmbeddingProvider interfaces, RAG+citations, bounded read tools (identity from context), grant-gated transactional tools, redaction, refused out-of-scope, ai_actions + ops/ai | tsc 0; 29 vitest (incl. prompt-injection, wrong-user, redaction, expired/replayed grant) |
| growth-service (new) | campaigns + two-person approval, budget reserve/consume/release, distinct benefit objects, referrals + abuse review, driver rebates as separate journal lines, marketing drafts (k≥50) | tsc 0; 30 vitest |
| user-service | single-use action grants (mint service-to-service, atomic verify+consume) + standing mandates (allow-list, atomic per-run allowance, revoke) | tsc 0; 238 vitest (+30 new) |
| RN shared packages | mobile-tokens, mobile-ui (14 components), mobile-core (session/api/realtime/flags/money) | tsc 0 each |
| apps/rider-mobile | typed navigation, new feature screens (Ask, Travel, Benefits, Mandates) wired through the api boundary, fixtures gated | tsc 0; **17 jest** (FlagGate DENY_ALL, money parity, screen renders) |
| apps/driver-mobile | typed navigation, incentives/earnings screens, incentive strip | tsc 0; **23 jest** |
| apps/admin-dashboard | growth (campaigns/referrals/assistant) + ops (travel/ai-actions) pages | tsc 0; next build compiles all 6 routes |
| apps/web-app | ask/benefits/travel/trips pages + web→app handoff with fallback | tsc 0; next build green |
| CI | `rn-mobile` job (tsc + jest for both apps, real, in the merge gate); stale Flutter job removed | ci.yml valid; commands verified locally |

**Monorepo-wide: `turbo run typecheck` 41/41 green; ~500 backend+contract tests +
40 RN jest tests all pass; the merge gate (build, test, go-build, db-check,
contracts, rn-mobile) is green.**

## Externally blocked (reported, not faked)

1. **Native iOS/Android builds of both RN apps.** No Android SDK and no Xcode
   here, and the `apps/*/android` and `apps/*/ios` native projects are not yet
   generated (that needs the toolchain). The apps are JS/TS-complete (tsc+jest);
   the native gate is `.github/workflows/rn-native.yml`, which builds both apps
   on macOS/Android runners once they and signing exist. Until then the migration
   is **JS-complete but not natively accepted** — per handoff rule 30.
2. **Signing / store cutover.** Bundle id, applicationId and provisioning must
   equal the existing Flutter app's, taken from the store consoles; never
   generated. Not available here.
3. **Device E2E (Maestro).** Needs an emulator/device farm (flows named in
   RN-01/RN-02).
4. **Retained rider/driver journeys (boards 1–19).** The new-feature screens are
   built; the full port of auth/ride/bites/send/wallet/profile and driver
   onboarding/trip/earnings from the launch boards remains — they are typed
   routes with `PlaceholderScreen` in the navigators today.
5. **Live provider calls.** Duffel (flights) and Duffel Stays/Nuitee (hotels)
   are HTTP shells reading a secret ref; no credentials here. All tested travel
   behaviour runs through the deterministic fixture adapter.
6. **Private model serving.** Qwen3-30B / Qwen3-Embedding via vLLM/SGLang need a
   GPU + weights; ask-service ships the interfaces + a deterministic test provider
   and an HTTP shell for the real endpoint.
7. **Payment-service ledger endpoints** the travel/growth ports call
   (authorize/capture/refund, incentive/benefit postings) must exist on
   payment-service; the ports are typed and tested with fakes.

## Not done, by scope
- Full retained-journey RN port (item 4 above).
- Wiring each service's outbox runner into its bootstrap (runners exist; not auto-started).
- The mobile-tokens generator remains a stub; the theme is hand-mirrored and key-verified against packages/design-tokens.
