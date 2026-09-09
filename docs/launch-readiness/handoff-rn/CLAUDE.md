# CLAUDE.md — rules for this handoff (extends docs/launch-readiness/handoff/CLAUDE.md)

Read the slice you're assigned, then `MIGRATION_MAP.md`, `contracts/`, `db/`. The launch CLAUDE.md rules 1–12 (server-authoritative money, outbox events, idempotency, double-entry ledger, deny-by-default flags, privacy by role, consent, honest unavailability, safety, tokens only, targets/type, no mock personas) all still apply. These are additional.

## Mobile technology (owner instruction — overrides stale Flutter guidance)
13. **Two separate React Native TypeScript apps**: `apps/rider-mobile`, `apps/driver-mobile`, each building for iOS and Android. Flutter under `mobile/` is a **frozen behavioural reference** until RN acceptance, then removed — follow `FLUTTER_TO_RN_CUTOVER.md` (freeze on day 1, mine for behaviour, required RN CI, store cutover under the same identifiers, removal PR). Do not add Dart, Flutter wrappers, add-to-app modules, or WebViews for app journeys. Where a repo instruction (mobile/README.md, melos, CI mobile job) still says Flutter, update it to name RN as the delivery target and record the change — without weakening any security or review rule.
14. **Native primitives only** in RN screens (View/Text/Pressable/FlatList/ScrollView/Modal + listed native modules). Styling via `@ubi/mobile-tokens` (generated from `packages/design-tokens` light/dark). No inline hex, no HTML.
15. **Typed navigation.** Every route and its params is declared in `src/navigation/routes.ts`; deep links map 1:1 to those routes and 404 (`common.flagOff.screen`) when the flag is off.
16. **Session and recovery.** Secure session in keychain/keystore (`@ubi/mobile-core/session`). On cold start restore server truth: active ride/order/booking snapshot, then resume realtime with lastSeq (replay ≤ 50, then REST snapshot). Process death mid-trip must restore the same trip on both apps.
17. **Fixtures are quarantined.** `src/dev/fixtures` load only when `__DEV__ && UBI_FIXTURES=1`; `src/api` is the only production boundary. No hard-coded personas, prices, earnings or provider outcomes in screens.

## AI (Ask UBI, marketing assistant)
18. **The model never moves money.** Read tools (quotes, search, status, eligibility, policy) run with the caller's identity from the gateway context. Transactional tools require a **single-use action grant** minted by the server after the user confirms a review sheet (terms version, totals, currency, expiry, idempotency key, auth assurance). Material change ⇒ grant invalid ⇒ new review. The model cannot mint, extend or modify grants or mandates.
19. **Out of the model's reach**: P2P transfers, account administration, campaign activation, budget changes, flag changes. Requests for these get a deep link to the conventional flow and are logged as `refused`.
20. **Never route** card data, PINs, identity documents or precise private addresses through the model; pass opaque references and resolve inside authorised tools. Retrieved documents and provider content cannot change permissions (prompt-injection tests required).
21. **Status words are contractual**: SUGGESTION · LIVE PRICE (with age) · AWAITING YOUR CONFIRMATION · PROCESSING · SUPPLIER PENDING · CONFIRMED · FAILED · EXPIRED · PARTLY BOOKED · BLOCKED. Render from server enums; never invent a state on the client.
22. **Marketing assistant** reads aggregates only (k ≥ 50), produces DRAFTS. Activation, outbound sending and budget changes go through the existing two-person approval; frequency caps and communication preferences are enforced by notification-service at send time.

## Travel
23. **Adapter capability is the only source of promises.** Hold timer, price guarantee, change/refund support, merchant of record, currency, pay-at-property — all from `FlightSupplyAdapter` / `StaySupplyAdapter` capability fields on the specific offer. "Journey Protection" / ₦0 switching appears only when `eligibility.covered` is true under a funded rule id.
24. **Order ladder is explicit**: payment_authorized → submitted → supplier_pending → confirmed (PNR / booking ref) → ticketed (documents) | failed_released | unknown_reconciling. A PNR is not a ticket. `unknown_reconciling` is resolved only by lookup on UBI's own reference; never re-purchase or compensate before reconciling. Copy never says "pay again".
25. **No atomicity across suppliers.** Items are separate orders with separate money, status and policy; the UI says so before payment and after partial outcomes.

## Growth
26. **Benefit types are distinct ledger objects**: fare_discount, fee_waiver, credit, driver_rebate, referral_reward. Each carries eligibility, min spend, cap, expiry, stacking, funding party, campaign version. Client renders `adjustments[]`; never computes.
27. **Driver rebates** are separate journal lines against the base commission (which never changes for a promotion). State `percentage_points` vs `percent_of_commission` explicitly; exclude tips/tolls/taxes; define cash netting, fleet-split order, rounding, caps, reversal.
28. **Referrals qualify from server-verified events** (rider paid trip; driver KYC approval + milestone trips). Shared device/payment routes to human review — never auto-deny. Reversals are compensating entries citing the terms version; no undisclosed negative balances.
29. **Budget** is reserved when a promise is made to a user (quote/checkout), consumed on qualification, released on expiry; impressions reserve nothing. Exhaustion is a recorded timestamp shown to riders as "used up".

## Evidence that prevents another Flutter delivery
30. Acceptance requires: real RN entry points and screens for both apps; iOS + Android builds of both (macOS CI for Xcode); upgrade test Flutter → RN preserving identity, deep links, push and the same active trip; rider-request → driver-accept → arrival → PIN → start → complete → payment → receipt → earnings across the two RN apps on staging; device E2E for background location, restart/reconnect, permissions, safety, payment pending/retry, and the new flows; CI jobs that fail on error (no continue-on-error, no skips). Missing runners or signing ⇒ report exactly what is missing and leave the migration marked incomplete.

## testID additions (see ANALYTICS_TESTIDS.md)
Pattern stays `<app>.<screen>.<element>`. New namespaces: `ask.*`, `mandates.*`, `travel.*`, `benefits.*`, `referrals.*`, `driver.incentives.*`, `driver.commission.*`, `growth.*`, `ops.travel.*`, `ops.ai.*`, `web.*`. Add them to `packages/contracts/src/test-ids.ts` so the convention test covers them.
