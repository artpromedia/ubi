# Migration map — Flutter → React Native (RN-01 rider, RN-02 driver)

Source of truth read: `mobile/apps/rider_app/lib/src/core/router/app_router.dart`, `mobile/apps/driver_app/lib/src/core/router/app_router.dart`, `mobile/packages/core/lib/src/config/*` (flags, city config, money), `mobile/packages/core/lib/src/testing/test_ids.dart`, `packages/contracts/src/{flags,test-ids}.ts`, `contracts/state-machines.json`. Everything below is *specified*; RN files under `rn/` are *unverified build*.

## Shared foundations (both apps) — `rn/packages/*`
| Concern | Flutter today | RN destination | Reuses | Evidence |
|---|---|---|---|---|
| Tokens | `ui_kit/tokens/ubi_token_*` | `@ubi/mobile-tokens` generated from `packages/design-tokens` {base,semantic,dark}.json | design-tokens JSON | snapshot test: token file equals generator output |
| Flags | `core/config/feature_flags.dart`, `flag_gate.dart` | `@ubi/mobile-core/flags` (`useFlag`, `<FlagGate>` → `common.flagOff.screen`) | `@ubi/config-client` semantics: DENY_ALL on failure, 404 deep links | unit: unreachable config ⇒ all tiles hidden; Maestro: deep link to disabled vertical shows flagOff |
| City config + money | `core/config/city_config.dart`, `money_formatter.dart` | `@ubi/mobile-core/config` + `money.ts` (Intl from config currency, tabular) | config-service ETag cache | unit: formatter parity with Dart tests (`money_formatter_test.dart` ported) |
| Session | `api_client` interceptors, secure storage | `@ubi/mobile-core/session` (react-native-keychain; refresh; logout) | gateway identity context, user-service | E2E: token refresh, logout, upgrade bridge (Flutter secure storage → RN keychain, or controlled re-auth restoring server state) |
| Realtime | ws in api_client | `@ubi/mobile-core/realtime` (lastSeq resume, replay ≤ 50, REST snapshot) | realtime-gateway | E2E: kill app mid-trip, relaunch, same trip |
| testIDs | `ubi_test_ids.dart` | `@ubi/contracts TEST_IDS` imported directly | contracts | convention test |
| Maps | `ui_kit/maps` (Google) | react-native-maps (provider per Phase 1.3 decision) | — | device smoke on both platforms |
| Push / deep links | Flutter plugins | `@react-native-firebase/messaging` + notifee (or existing provider); Universal/App Links → `routes.ts` | notification-service | E2E: push replacement after upgrade; link → correct screen |
| Payments | `packages/payments` (M-Pesa, cards) | entry points in `src/api/payments.ts`; provider SDK per payment-service config | payment-service | E2E: payment pending → retry path (never double-charge) |

## Rider — `mobile/apps/rider_app` → `apps/rider-mobile`
| Flutter route | RN route (`routes.ts`) | Retained states | Reuse | Board | Evidence |
|---|---|---|---|---|---|
| `/` SplashPage | `Splash` → restores session + active ride/order snapshot | boot, restoring, offline | session, realtime | — | E2E process-death restore |
| `/onboarding` | `Onboarding` | 3 panes | — | 3a | render |
| `/login` `/otp` `/register` | `Auth.Login` `Auth.Otp{verificationId}` `Auth.Register` | otp sent/expired/locked; new-device step-up (15a) | user-service | 3a–3b, 15a–b | Maestro auth_login_otp |
| `/home` HomeTilesPage | `Main.Home` (tiles from flags + Ask UBI entry + Benefits row) | flags loading/denied; active trip banner | flags | 6a, 20a | Maestro home_tiles_flags |
| `/home/ride/search` | `Ride.Search` → `Ride.Pickup` → `Ride.Quote` | search/empty/choose on map; quote valid/expired/changed | ride-service, places | 1b–1d, 22a | Maestro ride_request_quote |
| `/home/ride/:id/tracking` | `Ride.Matching` `Ride.Assigned` `Ride.Pin` `Ride.InTrip` `Ride.Pay` `Ride.Rate` (one stack keyed by rider machine) | searching, assigned, arrived, pin, in_trip, safety_hold, completed, cancelled_*, no_show, payment pending/retry | rider machine (contracts) | 1e–1q, 16d–g | Maestro lockstep_acceptance (with driver app) |
| `/home/ride/:id/details` | `Ride.Details{rideId}` + `Activity` tab | receipt, dispute | ledger receipt | 13a | render + receipt fixture |
| `/home/food/*` | `Bites.Restaurants` `Bites.Restaurant{id}` `Bites.Cart` `Bites.OrderTracking{id}` `Bites.OrderDetails{id}` | flag off; closed merchant; issue/refund (14a) | food-service | 6b–6d, 11a–b, 14a–b | Maestro bites_checkout |
| `/home/delivery/*` | `Send.New` `Send.Tracking{id}` `Send.Details{id}` | flag off; recipient unavailable (14c) | delivery-service | 6e–6g, 14c–d | Maestro send_create |
| `/profile` + edit/places/payments/settings | `Account.Profile` `Account.Edit` `Account.Places` `Account.Payments` `Account.Settings` + **new** `Account.Benefits` `Account.Referrals` `Account.Automation` | theme, language, notifications prefs | user-service | 13a, 22b, 20d | render |
| — (not in Flutter) | `Wallet.*` (7a–7e, 14e, 18c) — Flutter has no wallet screens; RN builds from board | P2P, split fare, NIP, safe mode, statement | payment-service wallet | 7a–7e | Maestro wallet_p2p |
| — | `Ask.*` `Travel.*` | see NEW-01 / NEW-02 | new services | 20–21 | slice acceptance |

## Driver — `mobile/apps/driver_app` → `apps/driver-mobile`
| Flutter route | RN route | Retained states | Reuse | Board | Evidence |
|---|---|---|---|---|---|
| `/` `/onboarding` `/login` `/register` `/otp-verification` | `Splash` `Onboarding` `Auth.*` | KYC doc gating, liveness gate (15c) | user-service | 3c–3d, 15c | Maestro driver_auth_docs |
| `/home` HomePage | `Main.Home` (map, online toggle, filters, eligibility, incentive strip) | offline, online, filters, blocked (docs/identity), flag driver_online off | ride-service, location | 1b–1c, 22c | E2E background location |
| `/trip-request` | `Trip.Offer{requestId}` modal (TTL from city config) | countdown, accepted, lost, declined | offer TTL | 1e | race test: one winner |
| `/active-trip` `/navigation` | `Trip.Navigate` `Trip.Waiting` `Trip.Pin` `Trip.InTrip` `Trip.Cash` `Trip.Complete` | navigate, arrived/wait timer, no_show, pin, in_trip, safety_hold, cash received/dispute, complete | driver machine | 1f–1q | Maestro lockstep_acceptance |
| `/earnings` history/trip/:id/payouts | `Earnings.Overview` `Earnings.Statement{periodId}` `Earnings.TripDetail{tripId}` `Earnings.Payouts` | draft vs paid statement; cashout | ledger statements | 13b, 22d | render + fixture |
| — | `Incentives.*` | see NEW-04 | promotions | 22c–d | slice acceptance |
| `/profile` edit/vehicle/documents/upload/ratings `/settings` | `Account.*` + `Account.FleetArrangement` (19b) | doc expiry, vehicle held | user-service, fleet | 3c, 13b, 19b | render |

## Journeys not yet enabled anywhere (stay text-only until flagged)
scheduled_rides UI (backend flag exists) · recording · tips at rating (flag off). Port the flag gate, not the screens.

## Upgrade path Flutter → RN (RN-01/02 shared)
1. Keep bundle/application identifiers, signing, URL schemes, Universal/App Link domains, push sender ids identical (read from store consoles; not in repo).
2. On first RN launch: attempt keychain/keystore read of the Flutter secure-storage keys (document the exact key names from `mobile/packages/storage` and `api_client` interceptors). If unreadable → controlled re-auth (OTP) that restores server-owned state (active trip, bookings, wallet).
3. Re-register push token; re-verify deep link handling; run the restore E2E on both platforms.
