# RN-01 — Rider RN shell + migrated journeys (`apps/rider-mobile`)

## Scope
Create `apps/rider-mobile` (React Native CLI, TypeScript). Port every enabled Flutter rider journey (MIGRATION_MAP.md) with all states from boards 1–7, 13–16 and the launch contracts. New features (Ask, Travel, Benefits) are stubs behind flags here and are filled by NEW-01…03.

## Routes (`rn/apps/rider-mobile/src/navigation/routes.ts`) — typed params are the contract
Root: Splash → Onboarding → Auth{Login, Otp{verificationId}, Register} → Main tabs {Home, Activity, Wallet, Account}.
Stacks: Ride{Search, Pickup{placeId}, Quote{quoteId}, Matching{rideId}, Assigned{rideId}, Pin{rideId}, InTrip{rideId}, Pay{rideId}, Rate{rideId}, Details{rideId}} · Bites{Restaurants, Restaurant{restaurantId}, Cart, OrderTracking{orderId}, OrderDetails{orderId}} · Send{New, Tracking{deliveryId}, Details{deliveryId}} · Wallet{Home, Send, Request, Nip, Statement, TopUp} · Account{Profile, Edit, Places, Payments, Settings, Benefits, Referrals, Automation, MandateEditor{mandateId?}, MandateReceipt{executionId}} · Ask{Thread{threadId?}, Review{reviewId}, Execution{executionId}} · Travel{…NEW-02} · Modals{FlagOff{feature}, Sos, SecureConfirm{purpose}}.
Deep links: `ubi://` + Universal/App Links mirror Flutter paths (`/home/ride/:id/tracking` etc.) and 404 to FlagOff when the vertical flag is off.

## State transitions to port
Rider machine (contracts/state-machines.json): searching → assigned → arrived → in_trip → completed | cancelled_by_rider | cancelled_by_driver | cancelled_by_ops | no_show; safety_hold overlay; payment: pending → paid | retry. Screen = f(state) — one `RideFlow` container subscribes to the ride stream and renders the state's screen; back navigation never changes server state.

## Reuse
`@ubi/contracts` (flags, test-ids, state machines, money) · `@ubi/config-client` semantics ported to `@ubi/mobile-core` · ride-service (Go) REST + realtime-gateway · user-service auth/KYC/device trust · payment-service wallet + receipts · food/delivery services · design-tokens JSON → `@ubi/mobile-tokens`.

## API / event mapping
Rides: POST /v1/rides/quotes → POST /v1/rides (Idempotency-Key) → GET /v1/rides/:id · stream `ride.*` events with seq → replay. Wallet: /v1/wallet/* (slice 04). Auth: /v1/auth/* + device enrolment (slice 03). Reconnect: exponential backoff 1–30 s, jitter, lastSeq; offline banner `rider.offline.banner` with stale timestamp.

## Placement map
`apps/rider-mobile/{package.json, app.json, index.js, App.tsx, ios/, android/}` · `src/navigation/{routes.ts, RootNavigator.tsx, linking.ts}` · `src/screens/{splash,onboarding,auth,home,ride,bites,send,wallet,account,activity}` · `src/api/{client.ts, rides.ts, wallet.ts, auth.ts, places.ts}` · `src/dev/fixtures` · `packages/mobile-tokens`, `packages/mobile-ui`, `packages/mobile-core` (shared with driver).

## Fixtures boundary
`src/api/client.ts` reads `UBI_API_BASE`; `src/dev/fixtures` registers MSW-style handlers only when `__DEV__ && UBI_FIXTURES=1`. Screens import types from `src/api`, never from fixtures.

## Acceptance
- jest: routes typecheck; FlagGate hides tiles on DENY_ALL; money formatter parity with Dart tests.
- Maestro: auth_login_otp · home_tiles_flags · ride_request_quote · lockstep_acceptance (with driver app, staging) · wallet_p2p · bites_checkout · send_create · deeplink_flag_off · process_death_restore.
- Builds: Rider iOS (macOS CI) + Rider Android with existing identifiers; upgrade test from the Flutter build.

## Claude Code prompt
"Create apps/rider-mobile (React Native CLI + TypeScript) and shared packages/mobile-{tokens,ui,core} from design_handoff_ubi_rn_migration/rn/. Port every Flutter rider route in MIGRATION_MAP.md to the typed routes in src/navigation/routes.ts, rendering all ride states from contracts/state-machines.json through one RideFlow container. Use @ubi/contracts TEST_IDS and flags; DENY_ALL on config failure; deep links 404 to FlagOff. Wire rides/wallet/auth APIs with realtime lastSeq resume. Keep bundle ids, signing and links identical to the Flutter app; implement the secure-storage upgrade bridge or documented re-auth. Add jest + Maestro flows listed; add required CI jobs rn-android/rn-ios/rn-test that fail on error. Do not generate Dart, wrappers or WebViews."
