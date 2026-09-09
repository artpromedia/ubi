# Dependency manifest — RN apps (to validate and pin at implementation)

Status: **unverified build**. Versions below are the intended majors as of 2026-09; pin exact versions against current official docs during RN-01, record them in the app package.json files, and commit lockfiles.

## Runtime
- react-native (current stable; New Architecture on). Pair the React version RN requires — web is React 19; RN ≥ 0.78 aligns with React 19, older RN needs 18.3. Decide once, in RN-01.
- typescript ^5.6 · @ubi/contracts, @ubi/config-client (workspace) · zod ^3 · @tanstack/react-query ^5 · zustand ^5 (same libs as web)
- @react-navigation/native ^7, @react-navigation/native-stack ^7, @react-navigation/bottom-tabs ^7 · react-native-screens · react-native-safe-area-context
- react-native-reanimated ^3 · react-native-gesture-handler ^2 · @shopify/flash-list · react-native-svg
- react-native-maps (provider decision per audit Phase 1.3) · react-native-geolocation-service (rider) · **driver background location**: react-native-background-geolocation (commercial licence — owner decision) or a documented alternative; Expo Go is not evidence for background location.
- react-native-keychain (session) · react-native-mmkv (cache) · @react-native-community/netinfo · react-native-permissions · react-native-device-info
- Push: @react-native-firebase/messaging + @notifee/react-native (or the provider notification-service already uses)
- i18n: react-i18next + react-native-localize; message catalogs shared with web-app's next-intl JSON
- Payments: provider SDK entry points per payment-service config (cards/bank transfer/mobile money); never store PAN on device.

## Tooling
- React Native CLI (bare) — needed for background location, maps, payments natives. Expo prebuild acceptable only as a build tool, never Expo Go for evidence.
- jest + @testing-library/react-native (unit) · Maestro (E2E; flows named in slices) · detox not required.
- CI: GitHub Actions — `rn-android` (ubuntu, Gradle assembleRelease), `rn-ios` (macos, xcodebuild archive), `rn-test` (jest), `rn-e2e` (Maestro cloud or emulator). All required; none continue-on-error.

## Web (unchanged)
Next 15 · React 19 · Tailwind 3 · @ubi/ui · react-query · zustand · zod · next-auth · next-intl · recharts (admin). No new web frameworks.

## Backend additions (contracts here; implementation in Claude Code)
ask-service (Hono) with ModelProvider/EmbeddingProvider interfaces (candidates Qwen/Qwen3-30B-A3B-Instruct-2507, Qwen/Qwen3-Embedding-0.6B; validate licence/revision/tool-calling; serve via vLLM/SGLang privately) · travel-service adapters (Duffel flights; Duffel Stays vs Nuitee/LiteAPI) · promotions module inside payment-service or a bounded growth-service (owner decision; one owner per table) · action grants + mandates in user-service auth domain (single-use, bound to terms/total/expiry/idempotency/assurance).
