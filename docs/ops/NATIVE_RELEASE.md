# RN native release — what is verified in-repo and what remains external

Status after **CC-B02 + CC-B04**: **JS + Metro bundle + native project scaffolds verified in-repo; signed store builds and physical/emulator device runs remain external.**

Both `apps/rider-mobile` (`UbiRiderMobile`, JS root `"UBI"`) and `apps/driver-mobile` (`UbiDriverMobile`, JS root `"UBIDriver"`) now carry:

- `@react-native-community/cli@18.0.0`, `@react-native-community/cli-platform-android@18.0.0`, `@react-native-community/cli-platform-ios@18.0.0`, `@react-native/codegen`, `@react-native/gradle-plugin`, and `@babel/runtime` pinned in `package.json` and `pnpm-lock.yaml` (offline frozen lockfile install verified).
- Monorepo-aware `metro.config.js` (`watchFolders`, `nodeModulesPaths`, `unstable_enableSymlinks: true`, and `extraNodeModules` pinning singletons `react`, `react-native`, `@babel/runtime`, and `@tanstack/react-query` to each app's `node_modules`).
- Official React Native `0.79.7` `android/` and `ios/` project directories, `Gemfile`, `.watchmanconfig`, and `firebase.json`.
- Loud build-time guards for store identifiers, signing credentials, and Firebase config files (`google-services.json` / `GoogleService-Info.plist`) so release builds fail immediately if real credentials are omitted or left at placeholder values.

## What is real today

| Check                                          | Where it runs                                                | Status / Evidence                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --offline`     | Local + CI                                                   | Verified locally (0 network calls, lockfile in sync)                                              |
| `tsc --noEmit` (shared packages + both apps)   | `ci.yml` → `rn-mobile`; `rn-native.yml` → `rn-verify`        | 0 errors across `@ubi/mobile-tokens`, `@ubi/mobile-ui`, `@ubi/mobile-core`, rider & driver apps   |
| `jest` (both apps)                             | `ci.yml` → `rn-mobile`; `rn-native.yml` → `rn-verify`        | Verified locally (native modules mocked honestly)                                                 |
| `eslint` (both apps)                           | `ci.yml` → `lint`; `rn-native.yml` → `rn-verify`             | 0 errors on both apps                                                                             |
| Production Metro JS bundle (`android` + `ios`) | `ci.yml` → `rn-mobile`; `rn-native.yml` → `rn-verify`        | Verified locally (`react-native bundle --dev false` produces Android & iOS bundles for both apps) |
| Android `./gradlew assembleDebug` (unsigned)   | `rn-native.yml` → `rn-android` (`ubuntu-latest`, non-gating) | Wired on `ubuntu-latest` with `android-actions/setup-android@v3` + Temurin JDK 17                 |
| Android `./gradlew assembleRelease` (signed)   | `rn-native.yml` → `rn-android-release` (guarded)             | Guarded — requires store `applicationId`, release keystore, and real `google-services.json`       |
| iOS `xcodebuild archive` (`macos-14`, signed)  | `rn-native.yml` → `rn-ios` (guarded)                         | Guarded — requires store bundle id, Apple signing cert/profile, and `GoogleService-Info.plist`    |
| Device E2E (Maestro)                           | `rn-native.yml` → `rn-e2e` (guarded)                         | Guarded — requires device farm / emulator (`MAESTRO_CLOUD_API_KEY`)                               |

> **Honesty note:** No physical device or emulator run is claimed in this repository pass. `rn-native.yml` stays separate from `ci.yml`'s `ci-success` merge gate so guarded skips (`not attempted: no signing identity / no device farm`) can never be mistaken for signed store or device-run acceptance.

## 1. Native scaffolds & pnpm monorepo wiring

- **Android (`apps/{rider,driver}-mobile/android/`):**
  - Generated from `@react-native-community/template@0.79.7` (`compileSdk 35`, `minSdk 24`, `targetSdk 35`, Kotlin `2.0.21`, Hermes + New Architecture enabled).
  - `REACT_NATIVE_NODE_MODULES_DIR` is set on both `rootProject.ext` and `:app` so native modules resolved inside `node_modules/.pnpm` (`react-native-reanimated`, `react-native-svg`, `react-native-gesture-handler`, `@react-native-community/netinfo`) find the app's `react-native` package cleanly.
  - `@notifee/react-native`'s bundled local Maven repository (`$rootDir/../node_modules/@notifee/react-native/android/libs`) is registered in `android/build.gradle`.
  - Deep-link intent filters match `src/navigation/linking.ts` (`ubi://`, `https://ubi.africa`, `https://links.ubi.africa` for rider; `ubidriver://`, `https://driver.ubi.africa` for driver).
- **iOS (`apps/{rider,driver}-mobile/ios/`):**
  - Xcode projects/schemes `UbiRiderMobile` (`withModuleName: "UBI"`) and `UbiDriverMobile` (`withModuleName: "UBIDriver"`).
  - `Podfile` resolves `react_native_pods.rb` via Node, sets `$RNFirebaseAsStaticFramework = true`, and enables modular headers for `GoogleUtilities` and `FirebaseCoreInternal`.
  - `AppDelegate.swift` forwards URL schemes and Universal Links to `RCTLinkingManager` and calls `FirebaseApp.configure()` when a real `GoogleService-Info.plist` is bundled.

## 2. Store identities & Firebase placeholders (never commit real keys)

Per `docs/launch-readiness/handoff-rn/FLUTTER_TO_RN_CUTOVER.md` §3, production builds must preserve the existing Flutter apps' store listings:

- **Debug builds (`assembleDebug` / Xcode `Debug`):** default to explicit `.debug` identifiers (`com.ubi.rider.debug` / `com.ubi.driver.debug`) so an unsigned CI build can never collide with or masquerade as a store listing. If `google-services.json` / `GoogleService-Info.plist` is absent in `Debug` (and `REQUIRE_FIREBASE_CONFIG` is not `"true"`), the build logs a warning and skips Google Services resource injection.
- **Release builds (`assembleRelease` / Xcode `Release`):** fail loudly (`GradleException` / Run Script `exit 1`) if any of the following are missing or left at placeholder values:
  1. `ANDROID_APPLICATION_ID` (or `-PUBI_APPLICATION_ID`) / `IOS_BUNDLE_IDENTIFIER` matching Play Console / App Store Connect (`.debug` suffixes are rejected).
  2. Release signing credentials (`ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` on Android; Apple signing certificate + provisioning profile on iOS).
  3. Real untracked `android/app/google-services.json` / `ios/<Scheme>/GoogleService-Info.plist` copied from the tracked `.placeholder` templates and populated from Firebase Console (`PLACEHOLDER_DO_NOT_USE` sentinel is rejected; real filenames are gitignored).

## 3. External CI variables and secrets required for release & device gates

| Name                                                             | Kind          | Used by                      | Purpose                                                            |
| ---------------------------------------------------------------- | ------------- | ---------------------------- | ------------------------------------------------------------------ |
| `ANDROID_APPLICATION_ID_RIDER` / `ANDROID_APPLICATION_ID_DRIVER` | repo variable | `rn-android-release`         | Exact Play Console `applicationId` matching the Flutter listings   |
| `ANDROID_KEYSTORE`                                               | secret        | `gate`, `rn-android-release` | Base64-encoded upload/release keystore                             |
| `ANDROID_KEYSTORE_PASSWORD`                                      | secret        | `rn-android-release`         | Keystore password                                                  |
| `ANDROID_KEY_ALIAS`                                              | secret        | `rn-android-release`         | Signing key alias                                                  |
| `ANDROID_KEY_PASSWORD`                                           | secret        | `rn-android-release`         | Signing key password                                               |
| `GOOGLE_SERVICES_JSON_RIDER` / `GOOGLE_SERVICES_JSON_DRIVER`     | secret        | `gate`, `rn-android-release` | Real Firebase `google-services.json` contents for each Android app |
| `IOS_BUNDLE_ID_RIDER` / `IOS_BUNDLE_ID_DRIVER`                   | repo variable | `gate`, `rn-ios`             | Exact App Store Connect bundle identifiers                         |
| `IOS_SCHEME_RIDER` / `IOS_SCHEME_DRIVER`                         | repo variable | `rn-ios` (optional override) | Defaults to `UbiRiderMobile` / `UbiDriverMobile`                   |
| `IOS_DISTRIBUTION_CERTIFICATE_P12`                               | secret        | `gate`, `rn-ios`             | Apple distribution certificate                                     |
| `IOS_CERTIFICATE_PASSWORD`                                       | secret        | `rn-ios`                     | `.p12` password                                                    |
| `IOS_PROVISIONING_PROFILE`                                       | secret        | `rn-ios`                     | Provisioning profile matching the store bundle identifier          |
| `GOOGLE_SERVICE_INFO_PLIST_RIDER` / `..._DRIVER`                 | secret        | `gate`, `rn-ios`             | Real Firebase `GoogleService-Info.plist` contents for each iOS app |
| `MAESTRO_CLOUD_API_KEY`                                          | secret        | `gate`, `rn-e2e`             | Device farm / Maestro Cloud API credential                         |

## 4. Definition of done for full native cutover (`G06` / `P0-02` ops half)

Per `FLUTTER_TO_RN_CUTOVER.md` §4 / `CLAUDE.md` rule 30: `rn-android-release`, `rn-ios`, and `rn-e2e` green with commit-SHA artifacts for **both** apps on real signing credentials, real FCM/APNs credentials, and a real device/emulator.
