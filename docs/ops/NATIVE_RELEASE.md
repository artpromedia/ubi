# RN native release — what must exist before a real device build

Status as of this pass (C11): **JS-complete, natively unverified.** The RN
apps' TypeScript, jest and lint all run and pass in CI today
(`.github/workflows/ci.yml` `rn-mobile` job; `.github/workflows/rn-native.yml`
`rn-verify` job). Neither app has ever produced an installable Android or iOS
build in this environment, because neither has a native project directory.
This document is the exact, checkable list of what closes that gap — see
`docs/launch/GAP_REGISTER.md` row **G06** and
`docs/launch-readiness/handoff-rn/FLUTTER_TO_RN_CUTOVER.md` §3–4 for the
owner rules this must satisfy.

## What is real today

| Check                                     | Where it runs                                                                                           | Evidence                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| tsc (shared mobile packages + both apps)  | `ci.yml` → `rn-mobile`; `rn-native.yml` → `rn-verify`                                                   | 0 errors, both places, verified locally |
| jest (both apps)                          | same two jobs                                                                                           | rider 37/37, driver 71/71               |
| eslint (both apps)                        | `rn-native.yml` → `rn-verify` (new); repo-wide `lint` job in `ci.yml`/`test.yml` also covers these apps | 0 errors (98 and 45 warnings only)      |
| Metro bundle dry-run                      | **not run** — see "Newly-found gap" below                                                               | fails today, documented not faked       |
| Android `assembleRelease` / iOS `archive` | `rn-native.yml` → `rn-android` / `rn-ios` (guarded, inert)                                              | never executed — no native project      |
| Device E2E (Maestro)                      | `rn-native.yml` → `rn-e2e` (guarded, inert)                                                             | never executed — no device farm         |

`rn-native.yml` is intentionally **not** part of the `ci-success` merge gate
and is not a required branch-protection check. When the guarded jobs run
without the prerequisites below, they print exactly what is missing and
succeed — that is a report of "not attempted", never a fabricated pass.

## 1. Native project directories (do not exist)

Neither `apps/rider-mobile` nor `apps/driver-mobile` has an `android/` or
`ios/` directory. **These are plain React Native CLI apps, not Expo** —
there is no `app.config.*` and no `expo` dependency in either
`package.json` (only `react-native ^0.79.0` + `react ^19.0.0`). The
previous version of `rn-native.yml` generated missing native dirs with
`npx expo prebuild`, which is wrong for a non-Expo project and has been
removed.

The pinned generation command (from
`docs/launch-readiness/handoff-rn/CLOSING_THE_GAPS.md` Gap 2, step 1 — do
not deviate without recording why):

```
npx @react-native-community/cli init UbiRiderMobile --skip-install
# copy ios/, android/, metro.config.js, babel.config.js, Gemfile,
# .watchmanconfig from the generated temp project into apps/rider-mobile/
# repeat with a driver-named temp project into apps/driver-mobile/
```

Keep `App.tsx`, `index.js`, `app.json`, and `src/**` from this repo — only
the native scaffolding and the four/five named config files are copied in.
Set the bundle id / applicationId in the copied `android/app/build.gradle`
and `ios/*/Info.plist` from the store consoles (§2), never left at the
scaffold tool's placeholder values.

**Newly-found gap, discovered while implementing this pass:** neither app's
`package.json` lists `@react-native-community/cli` as a dependency (it is
what `npx react-native <command>` resolves to; `react-native`'s own bin only
re-exports to it). Verified locally: `react-native bundle` and
`react-native start`/`run-android`/`run-ios` all currently exit 1 with
_"react-native depends on `@react-native-community/cli` for cli
commands"_. The scaffold step above will pull that dependency into the
_temporary_ project it generates; whoever runs it must also add it to
`apps/rider-mobile/package.json` and `apps/driver-mobile/package.json`
(and commit the lockfile) — a package.json/lockfile change, which is
outside this prompt's writable scope (`.github/workflows/**`,
`infrastructure/**`, `k8s/**`, `docs/**`), so it is recorded here rather
than silently worked around. Until it lands, no Metro bundle dry-run can be
added to CI as a real, passing step.

## 2. Store identities to preserve (not in the repo; pull from the consoles)

Per `FLUTTER_TO_RN_CUTOVER.md` §3, the RN apps must ship under **exactly**
the Flutter apps' existing identifiers — never a newly generated identifier
of any kind:

- Bundle id (iOS) / `applicationId` (Android)
- Signing certificate / keystore (see §3 below)
- URL schemes and Universal Link / App Link domains
- Push sender IDs (FCM/APNs)

The repo only has display names today: rider `app.json` → `"UBI"`
(`_note`: "Keep the store-facing name identical to the Flutter listing"),
driver `app.json` → `"UBIDriver"` / `"UBI Driver"`. None of the actual
identifiers are checked in anywhere in this repo (`mobile/` — the frozen
Flutter reference — does not contain native `Info.plist`/`build.gradle`
files either; this environment cannot read the store consoles or the
signing store). Pull them from App Store Connect, Play Console, and the
signing store, and put the values in release config, not in code, per the
cutover doc.

## 3. CI secrets and variables required (none exist in this repo today)

| Name                                     | Kind          | Used by                        | Purpose                                                       |
| ---------------------------------------- | ------------- | ------------------------------ | ------------------------------------------------------------- |
| `ANDROID_KEYSTORE`                       | secret        | `rn-native.yml` → `rn-android` | base64-encoded release keystore (gate + decode)               |
| `ANDROID_KEYSTORE_PASSWORD`              | secret        | `rn-android`                   | keystore password                                             |
| `ANDROID_KEY_ALIAS`                      | secret        | `rn-android`                   | signing key alias                                             |
| `ANDROID_KEY_PASSWORD`                   | secret        | `rn-android`                   | signing key password                                          |
| `IOS_DISTRIBUTION_CERTIFICATE_P12`       | secret        | `rn-ios`                       | Apple distribution certificate (gate check)                   |
| `IOS_CERTIFICATE_PASSWORD`               | secret        | `rn-ios`                       | .p12 password                                                 |
| `IOS_PROVISIONING_PROFILE`               | secret        | `rn-ios`                       | provisioning profile matching the bundle id                   |
| `IOS_SCHEME_RIDER` / `IOS_SCHEME_DRIVER` | repo variable | `rn-ios`                       | the Xcode scheme name the scaffold actually produced (see §4) |
| `MAESTRO_CLOUD_API_KEY`                  | secret        | `rn-e2e`                       | device farm / Maestro Cloud credential                        |

None of these are set. `rn-native.yml`'s guarded jobs check for them at
runtime and never invent, hardcode, or fall back to a placeholder value for
any of them — an unset value fails the archive step loudly (`IOS_SCHEME_*`)
or leaves the job in "skipped: here's exactly why" success (everything
else).

## 4. Wrong assumptions in the previous `rn-native.yml`, corrected in this pass

1. **`npx expo prebuild`** — removed. This is not an Expo project (§1).
2. **`-scheme Release`** in the iOS archive step — `Release` is a build
   _configuration_, not a _scheme_; Xcode names the scheme after the
   project passed to `react-native-community/cli init` (e.g.
   `UbiRiderMobile`), not "Release". Replaced with `IOS_SCHEME_RIDER` /
   `IOS_SCHEME_DRIVER` repo variables that must be set once the real scheme
   name is known — there is no safe literal to default to, so an unset
   variable now fails the step instead of silently building whatever
   Xcode's default resolution picks.
3. **Implicit working directory via a leading `cd`** — replaced with the
   `working-directory:` step field in both the Android and iOS jobs, so the
   directory a step runs in is visible from its declaration.
4. **No signing wiring at all** — `assembleRelease` was previously invoked
   with no keystore, which would have produced an unsigned/debug-signed
   build even if the `android/` project had existed. Signing secrets are
   now decoded to a keystore file and passed as env vars; `build.gradle`'s
   `signingConfigs.release` must read those exact env var names once the
   project is scaffolded (§1).

## 5. The macOS / device-runner dependency

- `rn-ios` requires `runs-on: macos-14` — a GitHub-hosted macOS runner.
  These are billed at a materially higher per-minute rate than
  `ubuntu-latest` and were not exercised in this environment (no macOS
  runner is available here to prove the job green; only its structure and
  YAML validity were verified).
- `rn-e2e` requires an Android emulator or a device farm (Maestro Cloud or
  equivalent) — none is configured. No self-hosted or GitHub-hosted device
  runner was available in this environment either.
- Both are genuine external dependencies, not something this pass can
  close from within the sandbox it ran in.

## 6. Other decisions already made that native acceptance depends on

From `CLOSING_THE_GAPS.md` Gap 5 (recorded so this stays consistent going
forward, not re-litigated here):

- **RN version / React pairing**: RN latest stable paired with React 19
  (matches web) — already reflected in both apps' `package.json`
  (`react-native ^0.79.0`, `react ^19.0.0`).
- **Driver background location library**: `react-native-background-geolocation`
  (commercial licence) was the default decision over the alternatives. The
  licence has not been purchased in this environment; this blocks G05
  (driver location telemetry) independently of the native build gate, and
  is a real spend decision for the project owner, not something to
  substitute a free fork for silently.

## Definition of done for this gap (G06)

Per `FLUTTER_TO_RN_CUTOVER.md` §4 / `CLAUDE.md` rule 30: `rn-android`,
`rn-ios` and `rn-e2e` green with artifact names carrying the commit SHA,
for **both** apps, on real signing and a real device/emulator — no
`continue-on-error`, no skipped suites, no manual pass override. Until
then, this migration stays reported as **JS-complete but not natively
accepted**, exactly as `docs/launch-readiness/rn-migration-status.md`
already states.
