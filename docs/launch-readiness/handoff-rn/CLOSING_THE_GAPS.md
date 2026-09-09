# Closing the gaps — exact instructions for Claude Code

Each gap in `COMPLETENESS.md` §"Gaps stated honestly" has a recipe here: inputs to read, files to create, the pattern to copy, and the evidence that closes it. Work them in the slice order; never mark a gap closed without its evidence.

---

## Gap 1 — RN screens for boards 1–19 (retained journeys) · slices RN-01, RN-02

**Inputs.** `MIGRATION_MAP.md` (route → RN destination → states → evidence), `docs/launch-readiness/handoff/design/*.dc.html` (boards 1–19; anchors #1b … #19c), `contracts/state-machines.json` (rider/driver machines), the Flutter screen for behaviour only (`mobile/apps/*/lib/src/features/**`).

**Pattern to copy.** Every new-feature screen in `rn/apps/rider-mobile/src/screens/travel/*.tsx` follows one shape — reuse it verbatim for ported screens:
```
useRoute typed params → useQuery(api.x) → loading Skeleton | error Banner | data
<Screen title onBack footer={primary Button}> … <Card>/<Row>/<StatusPill>/<MoneyText> …
testIDs from @ubi/contracts TEST_IDS · analytics via track() · no inline hex, only useTheme().colors
```

**Steps (rider).**
1. Replace each `PlaceholderScreen` registration in `src/navigation/RootNavigator.tsx` with a real screen file at the path the placeholder names (`screens/auth/LoginScreen.tsx`, `screens/ride/RideFlow.tsx`, `screens/bites/RestaurantsScreen.tsx`, …). Keep the route names and params from `routes.ts` — they are the deep-link contract.
2. Build `screens/ride/RideFlow.tsx` as one container: subscribes with `useResumableStream({ channel: 'ride:' + rideId, snapshotPath: '/v1/rides/' + rideId, reduce })`, then renders the screen for `state` (`searching → MatchingView`, `assigned → AssignedView`, `arrived → PinView`, `in_trip → InTripView`, `completed → PayView → RateView`, `cancelled_* / no_show → OutcomeView`, `safety_hold` overlay). Back navigation never changes server state.
3. Quote screen: mount `components/ride/SavingsBreakdown.tsx` + `SavingsChangedBanner.tsx` (already written) under the class list; on `409 quote_changed` swap the breakdown in place.
4. Wallet (7a–7e, 14e, 18c) has no Flutter source — build from the board and `payment-service` wallet endpoints (slice 04).
5. Port `money_formatter_test.dart` cases into `packages/mobile-core/src/__tests__/money.test.ts` before touching screens; formatter parity is the first green test.

**Steps (driver).** Same, plus `src/native/location.ts` (foreground) and `src/native/background.ts` (background while online; permission-denied and battery-optimisation states as screens, not toasts). `Trip.Offer` is a modal with the TTL countdown from `useCityConfig().offerTtlSec`; server decides the one winner — render the result, never assume.

**Evidence.** Maestro flows named in RN-01/RN-02 green on both platforms; `process_death_restore` on both apps; lockstep acceptance across the two RN apps on staging; upgrade test from the last Flutter build (`FLUTTER_TO_RN_CUTOVER.md` §3).

---

## Gap 2 — "unverified build" on every `rn/` and `web/` file

**Steps.**
1. Bootstrap once: `npx @react-native-community/cli init UbiRiderMobile --skip-install` into a temp dir, copy `ios/`, `android/`, `metro.config.js`, `babel.config.js`, `Gemfile`, `.watchmanconfig` into `apps/rider-mobile/`; repeat for `apps/driver-mobile`. Set the bundle id / applicationId from the store consoles. Keep `App.tsx`, `index.js`, `app.json`, `src/**` from the handoff.
2. Pin versions: choose the RN stable that pairs with React 19 (web is React 19; a split React version across the monorepo needs `pnpm.overrides` per app — decide once, record in `DEPENDENCIES.md`). Run `pnpm install`, commit lockfile.
3. `pnpm -F @ubi/rider-mobile typecheck` → fix every error in place. Expected classes of error: `react-native-keychain` API names (`ACCESSIBLE` enum), `@react-navigation` v7 typed `navigate` overloads (replace the ad-hoc `useNavigation<{ navigate: … }>()` casts with `NativeStackScreenProps<…>` from `routes.ts`), `fontVariant` typing on `type.money`, the `width: '47%' as unknown as number` progress bar in `IncentivesScreen.tsx` (use `flex` ratios instead), `openEventStream` (replace the whole-body fetch with `react-native-sse` or XHR progressive events — see `packages/mobile-core/src/api.ts` TODO).
4. Fonts: add Poppins/Inter TTFs to `assets/fonts`, `react-native.config.js` → `npx react-native-asset`; names in `mobile-tokens/src/index.ts` must equal the PostScript names.
5. Web: copy `web/apps/**` into the real apps, renaming `-admin-` → `(admin)`, `-app-` → `(app)`, `-tripId-` → `[tripId]`. Verify `@ubi/ui` export names against `packages/ui/src/index.ts` (the handoff assumes `Button, Card, Badge, Input, Label`); `pnpm -F @ubi/admin-dashboard typecheck && build`.
6. Storybook/jest snapshot for `StatusPill` (all 27 statuses) and `Ladder` (4 step states) — cheap proof that the shared UI compiles and renders both themes.

**Evidence.** `rn-test`, `rn-android`, `rn-ios` green with artifact names carrying the commit sha; admin + web-app `next build` green. Until then every PR description says "unverified build".

---

## Gap 3 — Android frames for the new screens (boards 20–23 drawn on iOS)

Not a code gap — the RN components already adapt. Apply the slice-12 Android parity rules when implementing: 48 dp targets (`targets.minAndroid`), sheet radius 28 (`Sheet.tsx` already switches on `Platform.OS`), Material back handling (`BackHandler` closes sheets before popping), no iOS-only glyphs (replace `‹` / `↑` text glyphs in `Screen.tsx` and `AskScreen.tsx` with `react-native-svg` icons from `packages/ui` icon set), status-bar colour from theme, `android:windowSoftInputMode="adjustResize"` for the Ask composer.

**Evidence.** Maestro flows run on an Android emulator (API 34) for every new-feature screen listed in `ACCEPTANCE.md`; screenshots attached to the PR.

---

## Gap 4 — Specified-but-not-coded screens

Each follows an existing sibling exactly. Create the file, register the route (already declared in `routes.ts`), remove the `PlaceholderScreen` line.

| Screen | Copy this sibling | Data | Board |
|---|---|---|---|
| driver `screens/incentives/ReferralsScreen.tsx` | rider `screens/benefits/ReferralsScreen.tsx` (dark theme comes from the provider) | `GET /v1/driver/referrals` → `referral` block of `IncentivesOverview` per referee with milestones | 22c referral card, expanded |
| driver `screens/incentives/WindowScreen.tsx` | `CommissionDetailScreen.tsx` (rule table + worked example) | `windows[]` item from `GET /v1/driver/incentives`; rules: started-in-window, zones, trip cap, money cap, "then your effective rate applies" | 22c window card |
| admin `growth/commission/page.tsx` | `growth/campaigns/page.tsx` table + right panel | `GET /v1/growth/commission-incentives/live` → columns: campaign · kind (pp / %) · drivers active · at cap · rebate spend · cash-netting total · wording check (pp vs % text must match `kind`) | 23c sibling tab |
| admin `growth/recon/page.tsx` | finance recon table from launch board 13c (`apps/admin-dashboard/src/app/(admin)/finance/recon` if present; else `campaigns/page.tsx`) | `GET /v1/growth/recon/:date` → per campaign version: promised · reserved · consumed · reversed · unexplained; **day-close disabled while unexplained ≠ 0** | 23c sibling tab |
| web `(app)/travel/checkout/[cartId]/page.tsx` | RN `TravelCheckoutScreen.tsx` line-for-line (breakdown card, terms card, payment card, pay button, 409 repriced banner) | `GET /v1/travel/carts/:id`, `POST …/checkout` via the existing web payment/PIN step | 21b checkout |
| marketing site sections | existing `apps/web-app` marketing pages | `GET /v1/config/flags?cityId=` at build time; render a section only when the flag is on; store links from env (`NEXT_PUBLIC_APPSTORE_URL`, `NEXT_PUBLIC_PLAY_URL`) | 23f note |

**Evidence.** Each page/screen appears in `ACCEPTANCE.md` with its states; Playwright/Maestro flow added; no `PlaceholderScreen` import remains in either navigator (add a lint rule: `no-restricted-imports` for `PlaceholderScreen` once RN-01/02 land).

---

## Gap 5 — Owner decisions that block code

Do not guess. Open one issue per item, labelled `decision-needed`, with the options and what each unblocks; proceed on everything else.

| Decision | Options | Unblocks | Default if no answer by the slice start |
|---|---|---|---|
| Hotel supplier | Duffel Stays (one vendor with flights, simpler settlement) vs Nuitee/LiteAPI (broader Nigerian inventory) | NEW-02 stays adapter, `travel_suppliers` row | Implement `StaySupplyAdapter` interface + Duffel Stays first; LiteAPI as second adapter behind config |
| RN version / React pairing | RN ≥ 0.78 with React 19 (matches web) vs older RN + React 18.3 per-app override | Gap 2 step 2 | RN latest stable + React 19 |
| Driver background location library | `react-native-background-geolocation` (commercial licence) vs `@mauron85/…` fork vs custom native module | RN-02 | Buy the licence; the alternative costs more than it saves |
| Bundle identifiers, signing, push sender ids | — (values, not options) | RN-01/02 builds, cutover §3 | None — externally blocked; CI fails and says so |
| Model + serving | Qwen3-30B-A3B-Instruct-2507 via vLLM on private GPU vs managed private endpoint | NEW-01 | Behind `ModelProvider`; start with the smallest instance that passes the task suite |
| Promotions ownership | module inside payment-service vs bounded growth-service | NEW-03/04 | Bounded growth-service owning tables in 009; ledger lines still posted through payment-service |

**Evidence.** The issue link and the chosen option recorded in the slice's PR description and in `DEPENDENCIES.md`.

---

## When all five are closed
`COMPLETENESS.md` gets a final column "closed by PR #"; `FLUTTER_TO_RN_CUTOVER.md` §6 becomes eligible only after Gaps 1 and 2 are closed for both apps and the rollout gates in §5 are met.
