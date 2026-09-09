# RN-02 — Driver RN shell + migrated journeys (`apps/driver-mobile`)

## Scope
Create `apps/driver-mobile` (dark-default theme). Port onboarding/KYC docs, home online/offline with filters and eligibility, offer modal (TTL from city config), trip execution (navigate, waiting/no-show, PIN, in-trip, cash, complete), earnings/statements/payouts, ratings, profile/vehicle/documents, settings, fleet arrangement (19b), safety (SOS, liveness gate 15c). Incentives are a flag-gated tab filled by NEW-04.

## Routes
Root: Splash → Onboarding → Auth{Login, Register, Otp{phone}} → Main tabs {Home, Earnings, Incentives, Account}.
Stacks: Trip{Offer{requestId} (modal), Navigate{tripId}, Waiting{tripId}, Pin{tripId}, InTrip{tripId}, Cash{tripId}, Complete{tripId}} · Earnings{Overview, Statement{periodId}, TripDetail{tripId}, Payouts, Cashout} · Incentives{Overview, CommissionDetail{incentiveId}, Referrals, Window{windowId}} · Account{Profile, Edit, Vehicle, Documents, UploadDocument{documentType}, Ratings, Settings, FleetArrangement, LivenessCheck} · Modals{Sos, FlagOff, SecureConfirm}.

## State transitions
Driver machine: offline → online → offered → accepted → navigating → arrived(wait timer) → pin_verified → in_trip → completed → (cash: awaiting_cash → received | disputed) → online; no_show; safety_hold; blocked (documents/identity/vehicle held) prevents online. Offer: countdown → accepted | declined | lost (server decides one winner).

## Native integrations (must be real, not mocked)
Foreground + background location while online (permission denial states; battery copy); realtime reconnect/replay; process-death restore of active trip; push for offers with app in background; navigation hand-off to maps app; secure storage; deep links. Safe-driving: while speed ≥ 5 km/h only glanceable, non-interactive incentive/quest strips; detail screens open when parked.

## Placement map
`apps/driver-mobile/src/navigation/{routes.ts, RootNavigator.tsx}` · `src/screens/{home,trip,earnings,incentives,account,auth}` · `src/native/{location.ts, background.ts}` · `src/api/{driver.ts, trips.ts, earnings.ts, incentives.ts}` · shared packages from RN-01.

## Acceptance
- go race test already exists for one-winner accept; RN: offer modal honours server result.
- Maestro: driver_auth_docs · go_online_permissions · offer_accept_navigate_pin_complete (lockstep with rider) · cash_received · background_location_restart · statement_view · fleet_arrangement_sign.
- Builds: Driver iOS + Android; upgrade test; CI required.

## Claude Code prompt
"Create apps/driver-mobile (React Native CLI + TypeScript, dark default) from design_handoff_ubi_rn_migration/rn/apps/driver-mobile and the shared packages. Port every Flutter driver route in MIGRATION_MAP.md with all driver-machine states; implement background location, push-delivered offers with city-config TTL, realtime resume, process-death restore, secure session and deep links. Add the Incentives tab (flag driver_commission_rebates) as a stub for NEW-04. Add the Maestro flows listed and required CI. No Dart, no WebView."
