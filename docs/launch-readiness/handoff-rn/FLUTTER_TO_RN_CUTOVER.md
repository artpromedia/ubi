# Drop Flutter, ship React Native — cutover plan (owner instruction)

**Decision:** UBI Rider and UBI Driver are React Native TypeScript apps. Flutter (`mobile/`) is a *reference implementation* from today until RN acceptance, then it is removed. No new Flutter work is accepted from the moment RN-01 starts. This page tells Claude Code exactly what to change, in what order, and what "Flutter is gone" means.

## 0. Freeze Flutter (day 1 of RN-01)
- Add `mobile/DEPRECATED.md`: "Reference only. No feature work. Bug fixes only if they block the RN port (e.g. to learn intended behaviour). Removal tracked in FLUTTER_TO_RN_CUTOVER.md §6."
- Update `mobile/README.md` first paragraph and `pnpm-workspace.yaml` comment block (`# MOBILE (Flutter)`) to state the RN targets and link this file.
- Update any AGENTS.md / CLAUDE.md / contributor guide sentence that says "mobile is Flutter/Dart/BLoC" to: "Mobile is React Native TypeScript at `apps/rider-mobile` and `apps/driver-mobile`; `mobile/` is a frozen reference until removal." Record each edit in the PR. **Do not weaken any security or review rule while editing these files.**
- CI: the `mobile` job (Flutter analyze/test, currently `continue-on-error`) becomes **non-required** and is renamed `flutter-reference` so nobody mistakes it for mobile acceptance. It is deleted in §6.
- Branch protection: add the new required checks `rn-test`, `rn-android`, `rn-ios` (see §4) as soon as they exist, even while red.

## 1. Read Flutter for behaviour, never for code
Use `mobile/` to answer: which states exist, which strings are shown, which API calls and events a screen makes, what is persisted locally, what permissions are requested. Port **behaviour** into TypeScript. Never: transpile Dart, embed a Flutter module (`flutter_module`/add-to-app), wrap `apps/web-app` in a WebView, or ship "RN shell + Flutter screens". Any of those fails acceptance (CLAUDE.md #13).

Specifically mine these files, then close them:
| Need | Flutter source | RN destination |
|---|---|---|
| Routes + deep-link surface | `mobile/apps/*/lib/src/core/router/app_router.dart` | `src/navigation/routes.ts`, `linking.ts` |
| Flag gate + honest "not available" | `mobile/packages/core/lib/src/config/{feature_flags,flag_gate}.dart` | `@ubi/mobile-core/flags`, `<FlagGate>` |
| City config, money formatting + its tests | `mobile/packages/core/lib/src/config/{city_config,money_formatter}.dart`, `test/config/*` | `@ubi/mobile-core/{config,money}` + ported jest tests |
| API client, retry/cache/error interceptors | `mobile/packages/api_client/lib/src/interceptors/*` | `@ubi/mobile-core/api` |
| Secure storage keys, Isar collections | `mobile/packages/storage/**`, `api_client` auth interceptor | `@ubi/mobile-core/session` (keychain), MMKV cache — see §3 |
| Location/permission flows | `mobile/packages/location/**` | `driver-mobile/src/native/*` |
| testIDs | `mobile/packages/core/lib/src/testing/test_ids.dart` | `@ubi/contracts TEST_IDS` (already the source of truth) |
| Tokens/theme | `mobile/packages/ui_kit/lib/src/tokens/*` | `@ubi/mobile-tokens` generated from `packages/design-tokens` |

## 2. Build order that never leaves users without an app
1. RN-01 rider shell + retained journeys; RN-02 driver shell + retained journeys (parallel teams allowed; shared packages first).
2. Lockstep acceptance on staging across the **two RN apps**: request → accept → arrive → PIN → start → complete → pay → receipt → earnings.
3. NEW-01…05 land on RN only. Flutter never receives Ask UBI, travel v2, promotions or incentives.
4. Internal/dogfood release of RN builds under the **same** identifiers (TestFlight internal, Play internal track).
5. Store cutover (§5). Flutter build stays downloadable only as the previous version during staged rollout.
6. Removal (§6).

## 3. Identity, session and data — what must survive the upgrade
- **Bundle id / applicationId / signing / URL schemes / Universal + App Link domains / push sender ids**: identical to the Flutter listing. They are not in the repo; pull from App Store Connect, Play Console, and the signing store. Never generate replacement production keys. Store the values in the release config, not in code.
- **Session**: on first RN launch try to read the Flutter secure-storage entries (`flutter_secure_storage` writes to iOS Keychain with its own service name and to Android EncryptedSharedPreferences/Keystore; document the exact service/key names found in `mobile/packages/storage` and the auth interceptor). If readable → migrate into `@ubi/mobile-core/session` and delete the legacy entry. If not → controlled re-authentication (OTP) that restores **server-owned** state: active ride/trip, bookings, wallet, documents. Either path is acceptable; "user loses an active trip" is not.
- **Local caches** (Isar/Hive ride, order, user collections): not migrated. They are caches; the server is truth. Delete on first RN launch.
- **Push**: re-register the token on first launch; verify a test push reaches the RN app after upgrade on both platforms.
- **Deep links**: run the link matrix (rides, orders, deliveries, trips, referral `/r/CODE`, `unavailable/:feature`) against the upgraded install.
- **Permissions**: previously granted location/notification permissions persist under the same identifiers; the RN app must handle "already granted", "denied", and Android background-location prompts.

## 4. CI — evidence that prevents another Flutter delivery
Required (branch protection), all failing on error, no `continue-on-error`, no `--passWithNoTests`, no skipped suites, no manual pass variable:
- `rn-test`: typecheck + jest for `packages/mobile-*`, `apps/rider-mobile`, `apps/driver-mobile`.
- `rn-android`: Gradle `assembleRelease` for both apps; upload the APK/AAB with commit sha in the artifact name.
- `rn-ios`: `xcodebuild archive` for both apps on a macOS runner; export ad-hoc/TestFlight `.ipa` with commit sha.
- `rn-e2e`: Maestro flows named in the slices against staging (lockstep flow requires both apps).
If a runner or signing certificate is unavailable, the job **fails** and the slice status says "externally blocked: <exact missing item>". Do not fake green.

## 5. Store cutover
- Same listings, same identifiers, version bumped above the last Flutter build (e.g. Flutter 2.x → RN 3.0.0, build number monotonic).
- Staged rollout: Play 10% → 50% → 100% with crash-free-session and active-trip-restore metrics gating each step; TestFlight → phased release on iOS.
- In-app minimum-version policy from config-service: once RN is 100%, set `minVersion` so remaining Flutter installs see the existing forced-update screen pointing at the store. Never break active trips: the check runs only when no ride/order is active.
- Rollback plan: halt rollout; the previous Flutter build remains the served version. No data rollback is needed because the server owns state.

## 6. Remove Flutter — definition of done
Only after: both RN apps at 100% rollout for 14 days, crash-free sessions ≥ Flutter baseline, active-trip-restore E2E green, support queue shows no upgrade-related cases for 7 days.
Then, in one PR titled "Remove Flutter reference implementation":
- `git rm -r mobile/` (apps, packages, `melos.yaml`, `analysis_options.yaml`, `pubspec.yaml`, `.gitignore`).
- Delete the `flutter-reference` CI job and any Flutter caches/secrets in workflows; remove Flutter/Dart tooling from Dockerfiles and `infrastructure/` docs.
- Remove the `# MOBILE (Flutter)` block from `pnpm-workspace.yaml`; update root `README.md`, `docs/ARCHITECTURE.md`, `docs/SERVICES.md`, `CONTRIBUTING.md`, `cspell.json` words, and `docs/launch-readiness/handoff/CLAUDE.md` ("Build Flutter screens…" → "Build RN screens…").
- Update `docs/launch-readiness/slice-status.md`: slice 12 (Android parity) is satisfied by RN builds + Maestro, not Flutter.
- Archive the last Flutter tag `flutter-final-<sha>` so behaviour can still be consulted from history.
The PR description lists every deleted path and links the four green RN release jobs.

## 7. What is NOT allowed at any point
Adding Dart, `pubspec.yaml` changes for features, Flutter plugins, add-to-app modules, WebView journeys, "temporary" Flutter screens inside RN, marking Flutter CI as mobile acceptance, or leaving `mobile/` documented as the mobile target.
