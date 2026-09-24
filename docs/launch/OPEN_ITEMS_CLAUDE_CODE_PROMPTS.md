# Claude Code prompts — closing the open gap-register items

Source of truth: `docs/launch/GAP_REGISTER.md` (round-9 audit plus integration
fixes, 24 Sep 2026). Each prompt below closes named register items. They are
written to be pasted into Claude Code in this repository (`artpromedia/ubi`),
one prompt per session or per workflow slice. Every prompt tells the agent to
read §0 of this file first, so the shared rules travel with it.

Screens without a design (fleet onboarding and sign-in, delivery custody in
the apps, notification copy and the new ops boards) have their own Claude
Design briefs in `docs/design/` (see §2). Their build prompts are in wave C and
wait for the returned handoff, in the same way the fleet calendar did.

**How to run them.** Waves A and B can run in parallel slices; §6 lists the
batches that do not collide and the few pairs that must land in order. Wave C
waits for its design. Each prompt ends with a return format that fits the
implement-then-verify rounds used for rounds 1–9, so any wave can also be run
as a workflow if you opt in.

---

## 0. Shared rules (every prompt applies these)

Paste this block at the top of a prompt if the session cannot read this file.

```text
SHARED RULES — UBI (artpromedia/ubi)

Stack and boundaries
- Monorepo: pnpm 9 + Turborepo. Go services: ride-service (chi; embedded mp
  schema), delivery-service. Node/Hono services: api-gateway, user, payment,
  travel, ask, notification, fleet, growth, config, support, realtime-gateway.
- Prisma (packages/database) is the ONLY migration owner. ride-service's mp
  schema is embedded SQL; do not add a second migration owner.
- Mobile is React Native TypeScript (apps/rider-mobile, apps/driver-mobile,
  packages/mobile-*). Web consoles are Next.js (apps/admin-dashboard,
  apps/fleet-portal, apps/web-app). No Flutter, no WebView, no HTML shipped
  inside a native app.
- Clients reach services only through api-gateway. Every new client route
  needs: a PROXY_RULES entry (or an exact route like src/routes/config-read.ts
  when a wildcard would expose writes), a scope rule in
  src/identity/scopes.ts, and a route-contract case checked against the
  service's generated routes.manifest. Service-to-service routes
  (/internal/*) are never proxied and stay pinned as the gateway's 404.
- Services read identity ONLY from the gateway-signed x-ubi-identity context
  (ride/delivery: the HMAC context). Never trust a plain X-User-ID header.

Money
- Server-authoritative, integer minor units, {amountMinor, currency}; the
  currency comes from city config. Clients never compute money.
- The 10% driver commission is reserved at bid and CAPTURED ONCE at the
  award. It is never re-charged; it is only ever returned by its linked
  reversal. payment-service's ledger is the only place money moves.
- Every state-changing POST takes an Idempotency-Key; a replay answers the
  original result; a reused key with a different body is refused.

Flags and deployment
- Flags are deny-by-default (packages/contracts/src/flags.ts). New features
  ship behind an existing or new flag that defaults OFF. Never enable a flag
  in any real environment, never edit a production seed to turn one on.
- Nothing is deployed. Do not deploy, push images or touch real credentials.
- Fixtures and sandbox responses are never evidence that a feature works;
  label them as fixtures.

Product rules that recur
- docs/design/FLEET_CALENDAR_DECISIONS.md wins over the fleet handoff.
- Fleets never see rider identity, locations or a driver's net earnings.
- Driver consent and rider consent are never bypassed; nothing is
  republished or reassigned without the person's choice.
- Copy never assumes a gender (use the name or "they/their").
- Rate limits are keyed by verified identity; never a shared "unknown"
  bucket; service-key calls are exempt; fail open on a Redis outage, while
  auth never fails open.

Definition of done (every prompt)
- Tests that name the behaviour, including at least one negative control
  that fails if the fix is reverted. Run the touched workspaces' typecheck,
  lint, tests; regenerate any route manifest you change; keep
  `pnpm format:check` clean; for Go, gofmt + go vet + golangci-lint.
- If you add a dependency, update pnpm-lock.yaml and prove
  `pnpm install --frozen-lockfile --offline` passes.
- Update docs/launch/GAP_REGISTER.md: mark the items you closed with evidence
  (file paths, test names), and add anything new you found.
- Commit per logical slice on the current branch with a clear message; do
  not open a PR unless asked.

Return format (end your final message with this)
- Items closed (register IDs) and the evidence for each.
- Tests run with pass/fail counts.
- Files changed.
- Residual risks and anything you deliberately left out, with the reason.
- Out-of-area needs: changes another slice or a human must make.
```

---

## 1. Decisions to make before pasting

Some items cannot be closed well without a product or architecture decision.
Each has a recommended default; the prompts use it unless you change it here.

| ID    | Question                                                                                                                                                                                       | Options                                                                                                                                                                                                                                                                                                                              | Recommended                                                                                                                                                                        | Blocks         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| DEC-1 | How do admins reach config-service's writes (flag flips, the `marketplace_rides` kill switch, change requests, history)?                                                                       | **A.** Admin-scoped exact gateway routes with a new `config:admin` scope held only by the config/ops/admin roles. **B.** A separate admin ingress (own host, IP allowlist or VPN) in front of config-service, never the public gateway.                                                                                              | **A**: every other admin console already goes through the gateway, and config-service re-checks the verified role and keeps dual approval on change requests.                      | CC-B01, CC-C05 |
| DEC-2 | Q4: at the pickup − lead deadline a rematch is never available, because a rematch is a new advance request that needs the city's `minLeadSec`, while the lead is capped at that same value.    | **A.** Allow `riskResolutionLeadSec` above `minLeadSec` and require it to exceed `minLeadSec` by a sweep margin before the offer promises a rematch. **B.** A rematch republishes with a shorter lead (a scheduled request rather than an advance booking).                                                                          | **A**: the smallest change, and it keeps "a rematch at the same fare" meaning a driver-confirmed booking.                                                                          | CC-A05         |
| DEC-3 | How is a fleet driver's vehicle chosen for LIVE rides (the rider checks the plate)?                                                                                                            | **A.** At go-online, ride-service asks fleet-service which vehicle the driver is assigned to now, records it on the online session, and the award shows that vehicle; a fleet driver with no resolvable vehicle cannot go online in fleet mode. **B.** fleet-service writes `drivers.vehicle_id` when an assignment starts and ends. | **A**: one owner answers "which vehicle now" (fleet-service), and a failure is visible at go-online instead of showing a wrong plate mid-trip.                                     | CC-A01         |
| DEC-4 | How do fleet staff sign in to the portal?                                                                                                                                                      | **A.** The same phone OTP as the apps (staff are UBI users; roles come from fleet-service's staff table). **B.** Email and password with OTP step-up.                                                                                                                                                                                | **A**, unless the design (D1) shows a strong reason for B.                                                                                                                         | CC-B05, CC-C01 |
| DEC-5 | Fleet KYB requirements per city (registration certificate, tax id, director identity, proof of address…).                                                                                      | A city-config list authored by UBI ops/legal.                                                                                                                                                                                                                                                                                        | Put the list in city config (`fleet.kyb.requirements`); engineering builds the mechanism, and UBI supplies the Lagos list. Until it exists, fleet creation stays `pending_review`. | CC-C02         |
| DEC-6 | Wallet funding for the pilot (register P0-03): no driver can bid without cleared commission balance.                                                                                           | **A.** A PSP top-up rail (Paystack / Flutterwave / M-Pesa) once credentials exist. **B.** An audited ops credit for the pilot: admin-initiated, dual-approved, journaled, capped per driver. **C.** Both, B first.                                                                                                                   | **C**, if UBI accepts an ops procedure for the pilot; the policy is UBI's call, not engineering's.                                                                                 | CC-B03         |
| DEC-7 | New-device trust for a brand-new account (P1-14). The hardened sign-in puts even a new account's first device in limited mode, and its only step-up (`selfie_nin`) has no configured provider. | **A.** Trust a new account's FIRST device once the OTP is verified (there is no earlier device to protect); every later new device stays limited until step-up. **B.** Keep every first device limited until a NIN selfie passes (needs a face provider contract).                                                                   | **A** for the pilot; B when a face provider is contracted.                                                                                                                         | CC-B00         |
| DEC-8 | How does a verified city get into the token (P0-06)?                                                                                                                                           | **A.** A home city chosen at sign-up from the cities config-service marks launched, stored on the user, signed into every token; changing city re-issues the token after server validation. **B.** Derived per session from device location.                                                                                         | **A** (single-city pilot; location is spoofable and optional).                                                                                                                     | CC-B00         |
| DEC-9 | Under `percent_of_net` terms a fleet can infer a driver's net (remittance ÷ percent), yet Q7 says fleets never see net.                                                                        | **A.** Accept it (the fleet signed the percent), but never display net or a per-trip split. **B.** Show percent-of-net remittance only as weekly totals, not per assignment. **C.** Disable `percent_of_net` for the pilot.                                                                                                          | **A**, recorded in FLEET_CALENDAR_DECISIONS.md.                                                                                                                                    | CC-A02, CC-C03 |

Items with no code fix (external): P0-02 signing, runners and devices; P0-03
the PSP contract and credentials; P0-04 a provisioned host, backups and a
restore drill; P0-05 SMS provider credentials (the code half is P0-07,
CC-A06); P1-10 a Google Maps key; FCM/APNs credentials for push (the code
half is CC-B04).

---

## 2. Claude Design briefs (hand these off first; wave C waits for them)

| Brief | File                                         | Covers                                                                                                                                                                                                                                                                                                                                           |
| ----- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1    | `docs/design/FLEET_PORTAL_ACCOUNT_BRIEF.md`  | Console sign-in (fleet portal, reused for the admin console), staff invitations, fleet onboarding + KYB with the UBI ops review screen, vehicle documents (upload, review, renewal), the weekly remittance statement (P1-03, P1-05, P1-09, P1-12).                                                                                               |
| D2    | `docs/design/DELIVERY_CUSTODY_APPS_BRIEF.md` | Driver pickup/delivery custody with proof capture, returns, recipient-unavailable and retry, the rider/sender custody timeline and return consent (P1-07).                                                                                                                                                                                       |
| D3    | `docs/design/NOTIFICATIONS_AND_OPS_BRIEF.md` | Notification copy deck (fleet, rider, driver, sender; push, SMS, in-app), push permission states, fleet portal notices incl. the "service soon" notice, and the new ops boards: off-road abuse flags, notification failures, airport transfers, the config console and kill switch (P1-06, P1-11 UI, P1-13 UI, P2-02, P2-03 copy, P2-04, P2-12). |

---

## 3. Wave A: code only, no decision or design needed (except where noted)

### CC-A01 · A fleet driver's vehicle on live rides (P1-04, rider safety)

Uses DEC-3 (recommended A). Size: M. Owns: ride-service go-online/award
vehicle resolution, user-service driver profile read, fleet-service route 8
(`VehicleAt`) if it needs a "now" variant.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

Goal: a rider on a LIVE ride with a fleet driver is shown the vehicle the
fleet has assigned to that driver right now, never a stale plate
(GAP_REGISTER P1-04). Riders check the plate at pickup for safety
(FLEET_CALENDAR_DECISIONS.md Q3), so a wrong plate is a safety defect.

Facts (verify before changing):
- The verified driver card (plate, make, colour) comes from
  drivers.vehicle_id in user-service:
  services/user-service/src/driver-profiles/profiles.ts:329-340.
- fleet-service never writes that column
  (services/fleet-service/src/ops/assignments.ts has no drivers write).
- ride-service asks fleet-service for the assigned vehicle only at ADVANCE
  awards: services/ride-service/internal/marketplace/award.go:228 and
  fleet_vehicle.go:57-70 (resolveBookingVehicle → Fleet.VehicleAt, gated by
  the fleet flag, "pending" on any failure).

Build (DEC-3 option A unless §1 says otherwise):
1. At go-online, when the fleet flag is on for the driver's city and the
   driver has an active fleet arrangement, ride-service resolves the vehicle
   for [now, end of the signed shift or a bounded horizon] through the
   existing internal contract A (/internal/fleet, FLEET_RIDE_SERVICE_KEY) and
   records it on the driver's online session (plate, make, model, colour,
   class, capacity, vehicleId, resolvedAt).
2. A fleet driver whose vehicle cannot be resolved (fleet-service down, no
   assignment now, vehicle off-road or doc_expired) cannot go online in fleet
   mode: an explained refusal with its own error code registered in
   packages/contracts/src/errors.ts and pinned by
   internal/domain/errors_contract_test.go. Non-fleet drivers are unchanged.
3. Live awards and the rider's assigned-driver view use the online session's
   vehicle. If the assignment changes while online (shift end, swap,
   off-road), the next award re-resolves; a trip in progress keeps the
   vehicle it started with.
4. Off-road abuse control (decisions correction 4): a vehicle reported
   off-road that goes online in this path is flagged exactly as
   fleet_risk.go already flags it.
5. The rider receipt and the ops timeline name the same vehicle.

Tests: ride-service HTTP tests for (a) a fleet driver shows the fleet
vehicle, not drivers.vehicle_id; (b) fleet-service down → go-online refused
with the code, nothing shown; (c) non-fleet driver unchanged; (d) flag off →
unchanged; (e) assignment changes between awards. Negative control: revert
the award change and (a) fails.
```

### CC-A02 · Fleets can see their money (P1-09, data half)

Uses DEC-9. Size: M–L. Owns: `services/payment-service/src/fleet/**`,
`services/fleet-service/src/ops/{vehicles,calendar,assignments}.ts` money
fields, `packages/contracts/src/fleet.ts` money schemas, the portal's
`WeekMoneyPanel` and overview money card. The weekly statement SCREEN is
CC-C03 (after design D1).

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.
Decision Q7 (docs/design/FLEET_CALENDAR_DECISIONS.md): fleets see hours,
shifts, gross, UBI commission, their own remittance and its status — never
a driver's net earnings.

Facts (verify first):
- payment-service's fleet routes (src/fleet/routes.ts, mounted at
  /v1/finance/fleet in src/index.ts:165-171) are ops-only
  (requireOpsIdentity, role admin) and never proxied.
- Settlement: each (assignment, week) settles once into one
  fleet_remittance_settlement journal entry (src/fleet/settlement.ts,
  model.ts); the durable record is the remittance.applied event
  (+ .shortfall / .carried). RemittanceRecordSchema has due, cap, carry,
  collected, refunded, shortfall, carry-out, wallet-locked, journal id —
  NO gross or commission.
- Gross/commission can be derived from the driver-wallet ledger kinds
  (src/ledger/ledger-reads.ts NET_EARNING_KINDS / NET_COMMISSION_KINDS),
  which exclude cash fares and tips.
- fleet-service returns MONEY_UNAVAILABLE {available:false} on the vehicle
  view and overview (src/ops/vehicles.ts:41-47, ops/calendar.ts:905); the
  contract's MoneyUnavailableSchema is the literal false
  (packages/contracts/src/fleet.ts ~1003-1007); the portal shows "Not
  available yet" in four lines (apps/fleet-portal/src/lib/vehicle-model.ts
  204-252) and has a money-guard test.

Build:
1. payment-service: a SERVICE-KEYED internal read for fleet-service (a new
   FLEET_PAYMENT_SERVICE_KEY direction, or the existing contract B key if
   it fits), never a client route: per fleet and week (and per vehicle /
   assignment), return week gross and UBI commission for the jobs driven
   under that fleet's assignments (with an explicit `excludes:
   ["cash_fares", "tips"]` when that is what the ledger can prove),
   remittance due / collected / shortfall / carried / refunded and status,
   as {amountMinor, currency}, with asOf. Never return a driver's net, a
   per-trip split or any rider data. Settlement stays the single writer.
2. fleet-service: call it (contract B style: timeout, fail to
   {available:false, reason}), cache briefly, and fill the vehicle view
   and overview money with a new MoneyAvailable shape; extend the contract
   so money is `available:true` with exactly the four Q7 fields + asOf +
   excludes, or `available:false` with a reason. The privacy walk over
   FLEET_RESPONSE_SCHEMAS must reject any net/earnings field.
3. Portal: render the four lines with asOf and the "excludes" note; keep
   the money-guard test and extend it so a net field fails.
4. DEC-9: record the chosen option in FLEET_CALENDAR_DECISIONS.md and
   enforce it (option A: never display net or a per-trip split).

Tests: payment-service read (auth: service key only; a client token is
refused), fleet-service mapping and failure path, contract privacy walk,
portal rendering, and a negative control that adding a driverNet field
fails the privacy test.
```

### CC-A03 · Fleet events reach people (P1-06, plumbing half)

Size: L. Owns: `services/notification-service/src/{marketplace,fleet}/**`,
`packages/contracts/src/fleet.ts` (event payload schemas, a service-request
conflict type), `packages/database` (one migration for the conflict type
check), `services/fleet-service/src/ops/{vehicle-issues,conflicts,documents,swaps}.ts`
payload fields. Final copy comes from design D3 (CC-C05); ship neutral
placeholder copy in one table so it can be replaced.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

Facts (verify first):
- notification-service specs: NotificationSpec in
  src/marketplace/audience.ts:51-68 (roles requester | driver | sender |
  traveller only); NOTIFICATION_SPECS in src/marketplace/specs.ts:208-732;
  NOTIFICATION_PATTERNS (735-740) subscribe to event:mp.*,
  trip_access.declined, reservation.*, shipment.return_proposed — no fleet
  event. Audience resolution in push.ts:300-404; unresolved audiences are
  dead-lettered.
- Fleet events: FLEET_EVENT_NAMES (packages/contracts/src/fleet.ts:445-463)
  plus the legacy fleet.alert (events.ts:264). Payloads are built inline
  (no Zod schemas). fleet.conflict.resolved / .lapsed carry no fleetId or
  driverId.
- service_soon (services/fleet-service/src/ops/vehicle-issues.ts:350-434)
  writes only fleet.alert + an audit row: no persistent record the fleet
  can act on, because CONFLICT_TYPES (fleet.ts:186-193) has no
  service-request type.
- No specs exist for mp.vehicle_swap.* (including
  rider_consent_requested, which Q3 makes mandatory: the rider must
  confirm a new vehicle) or mp.advance_booking.risk_changed (driver).
- The in-app inbox exists (src/routes/in-app.ts) but nothing writes rows;
  GET /badge is registered after GET /:id (likely shadowed, P3-12).

Build:
1. Zod payload schemas for every fleet event in packages/contracts, used
   by fleet-service when writing and by notification-service when
   reading. Add fleetId (and driverId where relevant) to
   fleet.conflict.resolved / .lapsed.
2. A service-request conflict type (e.g. vehicle_service_requested,
   severity medium, resolver fleet, action "plan maintenance"), added to
   CONFLICT_TYPES and FLEET_VISIBLE_CONFLICT_TYPES, with a Prisma migration
   for the fleet_conflicts type check; service_soon opens it (deduplicated
   per vehicle while open) and planning maintenance resolves it.
3. notification-service: new audience roles fleet_owner and fleet_manager
   resolved from fleet_staff (active owners/managers of payload.fleetId;
   read-only staff never), and ubi_ops where a board needs it. Subscribe to
   the fleet event patterns. Specs per event and audience (push + in-app;
   SMS only for cannot_drive and document expired), with neutral
   placeholder copy in one table.
4. Specs for mp.vehicle_swap.rider_consent_requested / applied /
   rider_declined / expired (rider; consent language exact; SMS for
   consent requested) and mp.advance_booking.risk_changed (driver).
   Also (GAP_REGISTER P2-03) a rider spec for
   mp.advance_booking.choice_offered (audience payload.requesterId only;
   two variants: rematch + refund, or refund only; SMS), add
   risk_unresolved to RIDER_BOOKING_REASON and the driver reason map, and
   suppress the generic mp.advance_booking.failed push when a
   choice_offered exists for the same booking, so the rider gets ONE
   clear message (prove it with a test).
5. Write in-app inbox rows for every notification (so the portal and apps
   have a history); fix the /badge route order (P3-12); correct the stale
   "not yet registered" header in packages/contracts/src/fleet.ts:48-53
   (P3-12).
6. Push payloads carry ids only (the existing allowlist); no rider data to
   fleets, no driver net anywhere.

Tests: audience resolution (owner/manager yes, read-only no, removed staff
no), each spec's copy has no PII placeholders, dedupe of service_soon,
migration applies on a fresh database, inbox rows written, /badge reachable.
Negative control: remove the fleet pattern and the fleet tests fail.
```

### CC-A04 · Admin reads: owed work, off-road flags, airport transfers (P2-01, P2-02 and P2-12 backend)

Size: M. Owns: `apps/admin-dashboard/src/lib/{marketplace-api,saga-steps,mp-events,travel-ops}.ts`
and the owed-work boards, `services/ride-service/internal/{handler,marketplace}/admin*`,
`services/travel-service/src/{routes,ops}/` (ops transfers). New admin
BOARDS for off-road flags and transfers follow design D3 (CC-C05); this
prompt ships the reads and wires the boards that already exist.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

1. P2-01: ride-service already serves GET /v1/admin/mp/business-bookings
   ?owed=true, GET /v1/admin/mp/delivery-cancellations?state=pending and
   their POST …/{awardId}/retry ({dryRun, expectedAttempts},
   Idempotency-Key) (internal/handler/marketplace_admin_owed.go). The admin
   UI still lists them as missing (apps/admin-dashboard/src/lib/
   saga-steps.ts:153-175 OWED_WORK_WITHOUT_ADMIN_READ) and has no client
   calls. Add the calls to marketplace-api.ts, render the two owed lists on
   the stuck-saga board with retry (dry run first, then confirm), and
   remove the stale gap entries. Also add RecoveryView.currency and
   PendingSagaView.fundingSource if ride-service returns them. Add a
   required reason to the retry body server-side and audit it. Check the
   gateway scope rule covers POST /v1/admin/mp/*/retry (only GET
   /v1/admin/mp is declared) and add one.
2. mp-events.ts TIMELINE_COVERAGE_GAPS says the timeline returns mp.* only;
   ride-service's timeline now includes trip_access.*, business_booking.*
   and ride.* (internal/marketplace/admin.go:159-189). Correct it.
3. P2-02 backend: an admin read of mp.offroad_use_flags
   (schema.sql:1243-1255; written by fleet_risk.go:639-692, read by
   nothing): GET /v1/admin/mp/offroad-flags (filters: city, vehicle,
   trigger, since; cursor) and a decision route (dismiss / warn fleet /
   escalate to standing, with a reason, audited). Include
   vehicle_occupancy.* in the admin timeline for the request when it
   applies. Regenerate the ride manifest; route-contract cases.
4. P2-12 backend: travel-service GET /v1/ops/travel/transfers?state=
   action_required,failed city-wide for travel:ops (today listTransfers
   filters by the caller, src/ops/transfers.ts:458-459); route-contract case
   under the existing /ops/travel/* rule; update TRANSFERS_GAP in
   travel-ops.ts to consume it on the existing travel ops board.

Tests per item; negative control: remove the scope rule and the retry
reaches no service.
```

### CC-A05 · Q4 in practice: a rematch the rider can actually take (P2-03)

Uses DEC-2 (recommended A). Size: M. Owns: ride-service cityconfig
scheduling + advance booking end path, contracts scheduling schema,
config-service Lagos seed (dev only). The rider's notification for this
event is built in CC-A03 (it owns notification-service's spec table).

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

Goal: when an at-risk advance booking lapses at its Q4 deadline, the rider's
proactive offer includes a same-fare rematch whenever the city's policy makes
one possible (GAP_REGISTER P2-03; the rider's notification is CC-A03;
FLEET_CALENDAR_DECISIONS.md Q4: "the earlier of the reconfirmation time and
pickup − 2 h, city-configurable … the rider is proactively offered a
same-fare rematch (only when rematchAvailable) or a refund. The trip is never
republished without the rider's choice.").

Facts (verify first):
- services/ride-service/internal/marketplace/advance.go (~762-770): a
  rematch is offered only when windowStart − now ≥ minLeadSec, because a
  rematch is a NEW advance request.
- services/ride-service/internal/cityconfig/scheduling.go (~59-86):
  RiskResolutionLead() is capped at MinLeadSec. So at the pickup − lead
  deadline, windowStart − now ≤ minLead, and after sweep latency it is
  below it: the offer is effectively refund-only.
- riskResolutionLeadSec is not seeded in config-service.
- mp.advance_booking.choice_offered (advance.go writeChoiceOffered) has no
  notification spec yet; CC-A03 adds it — do not edit notification-service
  here.
- packages/contracts/src/fleet.ts FleetPolicySchema.resolutionLeadMinutes
  describes the deadline as "activation minus this lead" (stale), a second
  knob for the same rule.

Build (DEC-2 option A):
1. Allow riskResolutionLeadSec above minLeadSec (bounded by the booking
   horizon and by reconfirmation/activation ordering). Validate it in the
   contracts schema and in ride-service. Document that a rematch is offered
   only when lead ≥ minLeadSec + a sweep margin (a named constant, tested).
2. One source of truth: ride-service computes the deadline. (The duplicate
   FleetPolicySchema.resolutionLeadMinutes in packages/contracts/src/fleet.ts
   is cleaned up by CC-A10, which owns that file in its batch.) Fix the
   stale scheduling comments (register P3-07 names them).
3. Seed riskResolutionLeadSec in the Lagos DEV seed only
   (services/config-service/src/seed/lagos.ts), with a value that satisfies
   the margin; never a production seed.
4. The payload of mp.advance_booking.choice_offered already names only the
   requester (no driverId), so realtime-gateway delivers it to the rider
   alone; pin that with a test rather than changing the gateway.

Tests: a lapse at the deadline with lead = minLead + margin offers a rematch;
with lead = minLead it is refund-only; the offer never republishes; the
realtime audience is the requester only. Negative control: restore the cap
and the rematch test fails.
```

### CC-A06 · OTP texts actually send, honestly (P0-07, P2-05, P2-17)

Size: M. Owns: `services/user-service/src/{lib/notification-client.ts,routes/auth.ts,identity/deps.ts}`,
`services/notification-service/src/{routes/sms.ts,middleware/auth.ts}`,
`packages/logger`, compose/env matrix entries for the keys.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.
This is the code half of P0-05 (SMS credentials stay external).

Facts (verify first):
- user-service sends Authorization: Bearer ${SERVICE_API_KEY} (only if set)
  + X-Service-Name (src/lib/notification-client.ts:12,61-68);
  notification-service's service routes require X-Service-Key ===
  INTERNAL_SERVICE_KEY + X-Service-Name (src/middleware/auth.ts:116-134);
  compose gives user-service neither key → every OTP send is 401. The
  identity notifier uses the same client (src/identity/deps.ts:148-152).
  Documented at docs/ops/PILOT_RUNBOOK_DELTAS.md:245-246.
- Registration and login still answer "OTP sent" after a failed send
  (src/routes/auth.ts:217-246, 291-314); sendOTPFallback only re-stores the
  code in Redis (logs it only in development).
- Phone numbers are logged at info/warn (auth.ts:226-235, 298-304);
  @ubi/logger has no redaction.
- notification-service /sms/send stores the full message (an OTP) and the
  phone in notificationLog.body (src/routes/sms.ts:98-112);
  POST /sms/otp/verify has no auth (261-263).

Build:
1. One service-auth convention: user-service sends X-Service-Key from a
   dedicated key (e.g. NOTIFICATION_SERVICE_KEY, mapped to what
   notification-service verifies), configured in compose, .env.example,
   DEPLOY_ENV_MATRIX.md and check-compose-env.mjs (required for both).
   Refuse to boot in production without it on both sides.
2. Honest answers: if the OTP send fails, say so with a retryable error
   code (registered in contracts errors.ts) and do not claim it was sent;
   keep the stored code so a retry can resend within the rate limit.
3. Redaction: add a redaction layer to @ubi/logger (phone, email, otp,
   code, token, authorization, pin fields) and remove raw phone logging in
   auth.ts; store OTP messages in notificationLog with the code masked.
4. Protect or remove POST /sms/otp/verify (user-service owns OTP
   verification); if kept, require the service key.
5. An integration test that runs user-service's real client against
   notification-service's real auth middleware (both in-process) and
   proves an OTP send is accepted with the configured key and refused
   without it.

Negative control: revert the header change and the integration test fails.
```

### CC-A07 · Infrastructure: connection budget, CI deploy checks, config hygiene, Node 22 (P1-08, P2-11, P2-13, P3-08, P3-11)

Size: M. Owns: `infrastructure/**`, `.github/workflows/**`, Dockerfiles,
`docs/ops/**`.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.
Nothing here deploys anything.

1. P1-08 connection budget. docs/ops/PILOT_RUNBOOK_DELTAS.md §6 estimates a
   worst case of ~163 Postgres connections against max_connections 100
   (user, food, payment and notification Prisma pools are unbounded). Set
   connection_limit on those four in infrastructure/hetzner/
   docker-compose.prod.yml (DATABASE_URL query), keep ride/delivery pgx pools
   explicit, and make the total fit with headroom for migrations and psql.
   Record the arithmetic in §6. Extend infrastructure/scripts/
   check-compose-env.mjs so a Prisma service without connection_limit fails.
2. P2-11 CI. Run node infrastructure/scripts/check-dockerfiles.mjs and
   check-compose-env.mjs in CI (infrastructure.yml or ci.yml), and add
   `kustomize build infrastructure/kubernetes/services/api-gateway | kubeconform`
   to the Kubernetes validation job. Fix .github/workflows/deploy.yml to build
   images from the repository root with -f services/<svc>/Dockerfile (the
   Dockerfiles expect the root context). Do not add any job that pushes an
   image or deploys.
3. P2-13 hygiene. Narrow the k8s overlay's GATEWAY_TRUSTED_PROXIES
   (kustomization.yaml:34-37) to a documented placeholder that fails closed
   rather than trusting 10.0.0.0/16. Re-enable the Grafana IP allowlist in the
   Caddyfile (~244-245) with a placeholder env. Remove .env.example keys no
   code reads, or wire them (MPESA_SHORTCODE vs MPESA_SHORT_CODE: use the name
   the code reads). check-compose-env.mjs must stay green.
4. P3-08 images. Move every Node Dockerfile and CI NODE_VERSION from Node 20
   (EOL 2026-04-30) to Node 22 LTS; keep root devDependencies out of
   production images; make .next/cache writable for the Next.js images.
   Prove each image still builds with the repository's replay method
   (check-dockerfiles.mjs), and run the full test matrix on Node 22 locally.
5. P3-11. location-service has a Dockerfile but no compose entry, and
   /v1/locations/* goes to ride-service. Either document it as intentionally
   not deployed (and pin that in the checker) or remove the dead Dockerfile —
   do not add a service nobody routes to.

Tests/evidence: both checkers pass and each has a negative control; CI YAML
validates (actionlint if available); the Node 22 matrix passes.
```

### CC-A08 · Delivery client/server contract fixes (P1-15, the code half of P1-07)

Size: M. Owns: `apps/rider-mobile/src/api/marketplace.ts` (delivery part),
`apps/rider-mobile/src/screens/marketplace/DeliveryReturn*`,
`apps/driver-mobile/src/screens/marketplace/JobsTimelineContainer.tsx`,
`contracts/openapi/marketplace.yaml` (custody paths),
`services/api-gateway/tests/route-contract.test.ts` (custody cases),
`services/delivery-service/docs/*`. The full delivery screens are CC-C04
(after design D2).

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

Facts (verify first):
- delivery-service wraps replies as {success:true,data} / {success:false,
  error:{code,message}} (internal/handlers/handlers.go:82-95); the gateway
  passes bodies through; mobile-core api() returns the raw JSON and reads
  a top-level code/message (packages/mobile-core/src/api.ts:76-89). So the
  rider's deliveryReturnState gets {success,data} and
  mapCustodyToReturnView calls t.events.map on undefined
  (apps/rider-mobile/src/api/marketplace.ts:245). Fixtures return
  unwrapped bodies, hiding it.
- return/consent returns {deliveryId, custodyState, consentState
  [, chargeStatus, chargeRef]} (internal/handlers/custody.go:562,591;
  return_funding.go:298-301), but the client expects a full timeline
  (marketplace.ts:579-591). retry_recipient is sent although the server
  only accepts consent | reject (400).
- The local CustodyTimeline type (marketplace.ts:180-201) lacks
  returnPolicy, proofs and most chargeStatus values; the approved banner
  claims a fee was funded even when none was.
- Driver "Continue current trip" opens the ride Trip stack with
  executionRef.id whatever the service
  (apps/driver-mobile/src/screens/marketplace/JobsTimelineContainer.tsx:86,
  96); for deliveries ride-service sets executionRef =
  {service:"delivery", id:<deliveryId>} (award.go:959-971).
- apps/rider-mobile/src/api/unsupported.ts:41-45 says delivery-service has
  no custody endpoints (stale).
- marketplace.yaml documents the custody routes at /api/v1 paths with the
  old ProofReference body and chargeStatus [not_required, unsupported];
  proof-uploads, proofs/{id}/url, return/complete, return/cancel-charge,
  webhooks/marketplace-cancel and the PROOF_* / RETURN_FEE_* codes are
  missing; the envelope is undocumented.
- Route-contract has cases for GET custody, return/consent, proof-uploads,
  pickup-proof and proofs/{id}/url only.

Build:
1. Rider delivery API: unwrap the delivery-service envelope in the
   delivery module (not globally — other callers depend on raw bodies),
   map envelope errors to ApiError with the server code, align the
   CustodyTimeline type with the server (returnPolicy, proofs, every
   chargeStatus), map the consent result correctly (then re-read the
   timeline), remove retry_recipient (only the driver's delivery proof
   retries), and make the banner state the real money outcome. Fixtures
   return the real envelope.
2. Driver: route "Continue current job" by executionRef.service; a
   delivery opens an honest placeholder ("Delivery jobs open in the next
   app update" with the job's state) until CC-C04 lands — never the ride
   stack.
3. Stale text: unsupported.ts entry; the enablement doc's "gateway path:
   no" row (the path exists; scopes remain).
4. OpenAPI: document every custody route at its gateway path
   (/v1/delivery/deliveries/{id}/custody/...), the envelope, the upload
   and attach bodies, charge states, returnPolicy/proofs, and every
   PROOF_* / RETURN_FEE_* code; run tooling/scripts/validate-contracts.mjs.
5. Route-contract cases for delivery-proof, recipient-unreachable,
   return/propose, return/complete, return/cancel-charge and collected.

Tests: rider parsing against the real envelope (a fixture generated from a
delivery-service handler test), consent mapping, driver routing by service.
Negative control: an unwrapped fixture must fail the parser test.
```

### CC-A09 · Ask travel residuals (P2-06)

Size: S–M. Owns: `services/ask-service/src/ports/travel-port.ts`,
`src/ops/executions.ts`, travel-service checkout/cart views.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

Close GAP_REGISTER P2-06 (the round-9 ASK-TRAVEL verifier's unfixed items):
1. A sweep that reconciles execution items left `unknown_reconciling` that
   have no order id (travel-port.ts ~88, ~290): look the cart up by its
   derived key, resolve to confirmed/refused/unknown with a bounded retry,
   never book again.
2. The relayed gateway context lives 120 s (services/api-gateway/src/
   identity/context.ts:35) but cart + passengers + checkout + two replays can
   exceed it. Either refresh the relayed context between steps through the
   existing grant (preferred), or bound the replay schedule to fit, with a
   test that simulates the worst case.
3. Pay-at-property amounts are part of the reviewed terms: expose them on
   the cart view and treat a change at checkout as a terms change (refused
   under reviewedTermsOnly), with a test.
4. A travel:book or limited-mode refusal must be detected before the
   single-use grant is consumed (check scopes/modes from the verified context
   first), so the user is not asked to review again for nothing.
5. The flight search card must show the same priced amount the review will
   use (see the verifier note on fare-family snapshot vs offer price).
6. Traveller phone numbers that pass a Luhn check must not be redacted as
   card numbers in ai/loop.ts recordableCall when they are traveller fields.

Tests: one per item, each with a negative control.
```

### CC-A10 · Fleet UI defects and small fleet API gaps (P2-07, P2-08 + round-9 out-of-area needs)

Size: M. Owns: `apps/fleet-portal/**`, `apps/driver-mobile/src/screens/fleet/**`,
`packages/contracts/src/fleet.ts`, `services/fleet-service/src/{routes,ops}/**`.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.
Follow docs/design/FLEET_CALENDAR_DECISIONS.md and the vendored handoff in
docs/launch-readiness/handoff-fleet-calendar/.

Fleet portal (P2-07):
- Debounce plate search and keep previous data while a new query loads.
- Gate write buttons on the gateway's reachability (the stale banner's own
  signal), not only navigator.onLine.
- "Waiting for a signature" lists only proposals awaiting a signature;
  settled ones move to their own section.
- Conflict centre, B4 and B5 include `resolving` conflicts by default.
- Clicking a gridcell keeps focus on the grid (aria-activedescendant), and
  virtualisation never drops focus to the body.
- Replace the mock-era e2e specs (e2e/tests/{vehicles,drivers}.e2e.ts) with
  specs for the current screens, or delete them; the test script must not
  reference mock data.

Driver app (P2-08):
- A failed GET /v1/drivers/me/fleet-offers shows "Proposals couldn't be
  loaded — retry" instead of silently hiding them.
- Withdraw/swap with bookingId null are disabled with a reason, never a
  no-op tap.
- Deduplicate service_soon reports per vehicle per open issue on the server
  (fleet-service vehicle-issues.ts), answering the existing report.

API gaps the round-9 slices left (out-of-area needs):
- ConflictView carries maintenanceBlockId (or a subject link) so B6's
  move/cancel/complete block actions act on the block directly.
- GET /v1/drivers/me/availability returns the saved windows with their
  recurrence rules, so C4 carries them over instead of asking to replace
  them.
- DriverArrangementListSchema includes the vehicle plate, make and model, so
  C1/C5 name the vehicle as the handoff shows.
- Move ReportVehicleIssueSchema / VehicleIssueViewSchema from
  services/fleet-service/src/vehicle-issue-contract.ts into
  packages/contracts/src/fleet.ts and FLEET_RESPONSE_SCHEMAS so the privacy
  walk covers them; have apps/fleet-portal import contract types instead of
  mirroring them where practical.
- FleetPolicySchema.resolutionLeadMinutes (packages/contracts/src/fleet.ts)
  describes the Q4 deadline as "activation minus this lead" and duplicates
  ride-service's riskResolutionLeadSec: remove it if nothing reads it, or
  derive it from the mp scheduling policy; ride-service computes the
  deadline.
- Regenerate fleet-service's routes.manifest and add route-contract cases
  for any new client route (GET /v1/drivers/me/availability is already under
  the existing /drivers/me/availability rule — prove it with a case).

Tests: portal vitest, driver jest, fleet-service vitest for each change.
```

### CC-A11 · Realtime: fix the leak, then expose it (P2-09, P2-16)

Size: M. Owns: `services/realtime-gateway/**`, `packages/mobile-core/src/realtime.ts`,
`services/ride-service/internal/marketplace/bids.go` (payload field),
Caddy site for realtime. Apps keep polling as the fallback; nothing here is
required for a foreground pilot except the leak fix (item 1).

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

Facts (verify first):
- realtime-gateway translateEnvelope copies every payload key except
  driverIds / audienceDriverIds (src/marketplace-events.ts:102-107), so
  mp.award.confirmed's commissionMinor (ride-service award.go:1136-1145)
  reaches the requester; the push path forbids it.
- mp.bid.submitted has no requesterId (bids.go:313-323), so the requester
  gets no realtime bid event (routing at marketplace-events.ts:66-96).
- WS path /ws on 4010, JWT via ?token= or Bearer, and a REQUIRED
  client-asserted userType query param (src/index.ts:84-133); /stats has no
  auth. mobile-core connects to wss://rt.ubi.africa/v1/stream?channel=
  &lastSeq=&token= (realtime.ts:49-56): different path, no userType (the
  server closes 4002), no channel/lastSeq replay, a different message shape.
  useResumableStream has no callers.
- No Caddy site and no gateway WS proxy expose it.

Build:
1. Leak fix (do first): an explicit per-event, per-audience payload
   allowlist in realtime-gateway (mirror the push allowlist); a requester
   never receives commissionMinor or any driver money; a driver never
   receives rider PII. Test every mp.* event name in the catalog.
2. Add requesterId to mp.bid.submitted in ride-service (and the event
   contract) so the requester's channel gets it.
3. Identity: derive the role from the verified token, not a query param;
   verify the gateway-signed identity where the service verifies tokens
   today; protect /stats.
4. One protocol: pick the server's path and message shape or mobile-core's,
   document it, and make the other side match (resume with lastSeq if the
   server keeps a bounded replay buffer; otherwise the client refetches via
   REST on reconnect). Wire useResumableStream into the driver feed and
   the rider's bid inbox behind the existing flags, with polling as the
   fallback.
5. Expose it: a Caddy site (e.g. rt.$DOMAIN) with WebSocket upgrade to
   realtime-gateway, compose and env matrix entries, rate limits keyed by
   verified identity. Nothing deploys.

Tests: allowlist per event and audience (negative control: remove one
allowlist entry and a test fails), requesterId present, role from token,
protocol round-trip between mobile-core and the server in-process.
```

### CC-A12 · Growth verifies identity before anything is exposed (P2-10)

Size: M. Owns: `services/growth-service/src/{middleware,index.ts}`,
gateway rules/scopes for growth, route-contract, growth route manifest.
Growth flags stay off.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

Facts (verify first): growth-service's gatewayAuth trusts plain
X-User-ID + X-User-Role (src/middleware/auth.ts:28-52) — the gateway's own
docs say those mirrors must never be trusted alone; the two-person campaign
check (approver ≠ author) depends on them; CORS allows X-User-ID /
X-User-Role from admin, app and any localhost origin (src/index.ts:53-80).
All routes (/v1/benefits, /v1/referrals, /v1/attribution, /v1/driver,
/v1/growth, /v1/ai/marketing) sit behind gatewayAuth; none is proxied, and
the gateway's route-contract pins them as its own 404.

Build:
1. Verify the gateway-signed x-ubi-identity (the same verifier travel and
   fleet use; UBI_IDENTITY_SECRET with rotation) and derive user, role,
   city and scopes from it; refuse to boot in production without the
   secret; delete the plain-header trust and the permissive CORS (the
   service is never called by browsers directly).
2. Generate a route manifest for growth-service (like the other Hono
   services) and add it to the gateway's MANIFEST_SOURCES.
3. Only then add gateway rules, one family at a time, with scopes:
   rider/driver reads (benefits, referrals, driver incentives) under
   profile:read or a new growth:read; admin campaign routes under a new
   growth:admin scope held by growth roles/admin only; /v1/ai/marketing
   stays unproxied unless explicitly cleared. Move the matching
   UNPROXIED_CLIENT_CALLS entries to reachable cases.
4. The two-person campaign rule reads the verified actor; test that a
   forged X-User-ID can no longer approve.

Negative control: a request with only X-User-ID headers (no signed
context) is refused.
```

### CC-A13 · City-config shape drift (P2-14)

Size: S. Owns: `packages/mobile-core/src/config.ts`,
`packages/contracts/src/city-config.ts`, config-service seed (dev).

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

mobile-core's CityConfig type (packages/mobile-core/src/config.ts:5-18) is
not the contract (packages/contracts/src/city-config.ts:179-211):
supportPhone, currencySymbol, minorDigitsShown, countryCode and
reservationFreeCancelMin are never served. Only supportPhone is read (the SOS
screens and the Ask hand-off) and both hide the line when it is absent.

1. Make mobile-core use the contract type (import from @ubi/contracts), and
   fix every app reference; derive display values (symbol, digits) with the
   existing money formatters from currency + currencyFractionDigits.
2. Add an optional supportPhone (E.164) to CityConfigSchema, validated, and
   to the Lagos DEV seed only; screens keep hiding the line when absent.
3. The gateway already serves GET /v1/config/cities/{cityId}
   (services/api-gateway/src/routes/config-read.ts); add a mobile-core test
   that parses a real config-service response fixture generated from the
   contract schema, so a future drift fails a test.
```

### CC-A14 · Hygiene batch (P3-01 … P3-10)

Size: M. Owns: the files named in each register row.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.
Close GAP_REGISTER P3-01 to P3-10 (P3-08 and P3-11 are in CC-A07, P3-05 in
CC-B00). Each is small; do them one commit each:
- P3-01 emit the registered settlement event where the ledger settles
  (services/payment-service/src/ledger/mp-settlement.ts:224-235) and fix the
  comment that says it does not exist; add an outbox test.
- P3-02 make the referral monthly cap atomic (a conditional insert or a
  row lock), with a concurrency test.
- P3-03 cross-check a rebate's effectiveBps against the live commission rate
  from the ledger, refusing a rule that disagrees.
- P3-04 an automatic repeated-cancellation standing flag behind the existing
  board, thresholds from city config, no automatic penalty.
- P3-05 is fixed by CC-B00 (it rewrites mobile-core's session refresh).
- P3-06 remove the pid-dependent length assertions in ask-service tests;
  make the user-service identity harness migrate an existing database; make
  TestAdminRecoveryCarriesCurrencyAndSagasTheirFunding assert its
  personal-wallet half.
- P3-07 fix the stale docs and comments listed in the register row.
- P3-09 lock the admin retry expectedAttempts check; answer "no longer
  cancellable" for an ended business trip; make the phone redaction regex
  catch numbers without "+".
- P3-10 add a traceability note mapping P06 and value-addendum A07 to the
  code that implements them, or record them as not implemented.
- P3-12 is split: the fleet.ts header and /badge are CC-A03, FLEET_MANAGER
  is CC-A16, the admin sidebar is CC-C05.
```

### CC-A15 · Durable events and a readable dead-letter queue (P2-15, P2-04 backend)

Size: L. Owns: `packages/outbox/**`, `services/notification-service/src/{marketplace/consumer.ts,trip-access/consumer.ts,routes/**}`,
realtime-gateway's consumer wiring, gateway ops routes for the DLQ. The
admin BOARD is CC-C05 (design D3).

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

Facts (verify first): the outbox relay publishes with Redis PUBLISH
(packages/outbox/src/relay.ts:295-296) and consumers psubscribe
(consumer.ts:108): a consumer that is down at publish time never sees the
event, and a handler that throws drops it (consumer.ts:291-300).
notification-service keeps seen/seq/dlq/pending lists in Redis
(src/marketplace/consumer.ts:45-49,158-205) and notif:trip_access:dlq;
nothing reads or replays them; outbox pushes never write notificationLog.

Build:
1. Durable delivery: move the relay → consumer transport to Redis Streams
   with consumer groups (XADD / XREADGROUP / XACK, bounded MAXLEN, pending
   entry reclaim), keeping the envelope, subject-type validation and
   quarantine behaviour. Every consumer (notification-service,
   realtime-gateway, and any other psubscribe user) migrates; a handler
   error leaves the entry pending for retry with backoff and moves it to a
   dead-letter stream after N attempts. Keep dedupe by event id.
2. DLQ read and replay in notification-service (service-authenticated):
   list (filters: event name, audience role, reason, since; cursor),
   detail, replay (idempotent by event id + audience) and discard (reason
   required, audited), for both the marketplace and trip-link DLQs.
3. Expose them to ops through the gateway as exact routes under an ops
   scope (e.g. /v1/ops/notifications/dlq…, scope notifications:ops held by
   admin/ops roles), with route-contract cases.
4. Write a notificationLog row for outbox pushes so /health/detailed counts
   are true.
5. A migration note for running the relay across the switch (drain, then
   switch; no double delivery thanks to dedupe).

Tests: a consumer that starts after publish still receives the event; a
throwing handler retries then dead-letters; replay delivers once;
negative control: revert to psubscribe and the late-consumer test fails.
```

### CC-A16 · The fleet portal is deployable (P1-03, deploy half; P3-12 role)

Size: S–M. Owns: `apps/fleet-portal/Dockerfile`, compose, Caddyfile,
`services/api-gateway/src/app.ts` CORS, `src/identity/scopes.ts` ROLE_SCOPES,
`docs/ops/**`. Sign-in is CC-C01 (after design D1).

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.
Nothing deploys.

Facts: apps/fleet-portal has no Dockerfile, no compose service and no Caddy
site; it runs on port 3004; the gateway's CORS origins are hard-coded to
app./admin./root (+ localhost:3000-3002 in development) in
services/api-gateway/src/app.ts:86-128, and compose's CORS_ORIGINS is never
read (docs/ops/DEPLOY_ENV_MATRIX.md). The admin dashboard is the pattern:
apps/admin-dashboard/Dockerfile, compose service admin-dashboard, Caddy site
{$ADMIN_DOMAIN}. The DB role FLEET_MANAGER has no ROLE_SCOPES entry (a token
with it gets zero scopes).

Build:
1. apps/fleet-portal/Dockerfile mirroring the admin one (repo-root context,
   NEXT_PUBLIC_API_URL build arg, healthcheck), a compose service, a Caddy
   site {$FLEET_DOMAIN:fleet.ubi.africa}, env matrix + check-compose-env +
   check-dockerfiles entries.
2. Gateway CORS: read allowed origins from CORS_ORIGINS (validated, exact
   origins, no wildcards) with the current list as the default; add the
   fleet domain and localhost:3004 in development; tests for allowed and
   refused origins.
3. FLEET_MANAGER: either map it in ROLE_SCOPES to the fleet staff scopes
   (fleet:read, fleet:manage, profile:read) or remove the role if nothing
   issues it — decide from where tokens are minted, and test it.

Evidence: check-dockerfiles and check-compose-env pass with the new entries;
CORS tests; the image builds under the repository's replay method.
```

## 4. Wave B: needs a decision from §1, or an external dependency

### CC-B00 · A verified city in every token, and a first device that works (P0-06, P1-14) — pilot blocker

Uses DEC-7 and DEC-8. Size: L. Owns: `services/user-service/src/{routes/auth.ts,routes/identity.ts,identity/**}`,
`packages/database` (user home city), `services/api-gateway/src/middleware/auth.ts`
tests, `packages/mobile-core/src/session.ts`, both apps' auth flows.
Land it before any other prompt that touches user-service auth (CC-A06 edits
the same files: land A06 first).

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

Facts (verify first):
- The legacy login the apps use (POST /v1/auth/login/otp then
  /v1/auth/verify-otp; apps/rider-mobile/src/api/auth.ts:4-8) mints tokens
  in generateTokens (services/user-service/src/routes/auth.ts:92-126) with
  sub, email, role, permissions — no cityId and no mode (the gateway treats
  a missing mode as full, skipping device trust).
- The hardened sign-in (POST /auth/otp, /auth/verify;
  src/routes/identity.ts:129-202) passes cityId: null and returns an
  access token only (no refresh token). Every new device — including a
  brand-new account's first — is enrolled untrusted and handed a
  LIMITED token (src/identity/devices.ts:1-13, 144-200); the first
  device's only step-up is selfie_nin, whose face provider is not
  configured. Limited mode drops every marketplace and fleet scope.
- The gateway signs the city only from the token's cityId
  (services/api-gateway/src/middleware/auth.ts:227; identity.ts 217-279).
  ride-service refuses a driver going online or reading the feed without
  it (internal/move/drivers.go:52, internal/marketplace/feed.go:144);
  fleet-service refuses in production (src/middleware/auth.ts:215-231).

Build:
1. DEC-8 (A): a user home city. Collect it at sign-up (only cities
   config-service lists as launched/enabled), store it on the user
   (Prisma migration), and sign it into every token as cityId. A change
   of city is its own endpoint that validates the target and re-issues
   the token. Backfill: existing users without a city must choose one on
   next sign-in (the apps show a picker); no silent default.
2. One sign-in path: move both apps and the consoles to the hardened
   /auth/otp + /auth/verify (device enrolment, modes), add refresh-token
   issuance and rotation to it (sessions table), and retire the legacy
   /auth/login/otp, /verify-otp and /register token minting (keep them
   answering a clear "use the new sign-in" error for one release).
3. DEC-7 (A): a brand-new account's FIRST device is trusted once its OTP
   is verified (audited as first_device_trusted); every later new device
   stays limited until step-up (old_device_approve, or selfie_nin when a
   provider exists). Existing accounts with no trusted device get one
   honest recovery path (support-assisted, audited) instead of being stuck.
4. The gateway: a token without cityId is refused for city-scoped routes
   with an explained code (not a downstream 422), and the apps route that
   code to the city picker.
5. mobile-core session: store the refresh token, refresh before expiry,
   re-issue on city change; fix the hard-coded refresh URL (P3-05) while
   here.

Tests: end to end in-process (user-service → gateway → ride-service): a new
rider signs up, picks Lagos, gets a full-mode token with cityId=LOS, and a
new driver can go online; a second device is limited until step-up; a token
without a city gets the explained refusal; the legacy path answers the
"use the new sign-in" error. Negative control: drop cityId from the token
and the go-online test fails.
```

### CC-B01 · Admin config writes and the kill switch through the edge (P1-11)

Uses DEC-1. Size: M. Owns: `services/api-gateway/src/routes/config-read.ts`
(or a sibling `config-admin.ts`), `src/identity/scopes.ts`, route-contract,
config-service authorization tests, admin-dashboard policy page wiring.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

Today the gateway serves only two config reads (src/routes/config-read.ts:
GET /v1/config/flags → config-service GET /v1/flags, and
GET /v1/config/cities/{cityId}). The admin policy console's writes answer
the gateway's own 404: PUT /v1/flags/{key} (including the marketplace_rides
kill switch), POST /v1/config/change-requests and
/change-requests/{id}/approve, POST /v1/config/cities/status and
GET /v1/config/cities/{cityId}/history
(apps/admin-dashboard/src/lib/marketplace-api.ts ~456-473). config-service
authorizes them on the gateway's verified x-user-role (CONFIG_ADMIN_ROLES in
services/config-service/src/middleware/actor.ts). They are pinned as
withheld in services/api-gateway/tests/route-contract.test.ts
(UNPROXIED_CLIENT_CALLS, CONFIG_WITHHELD).

If DEC-1 = A (recommended):
1. Add a scope config:admin to SCOPES, held only by the roles in
   config-service's CONFIG_ADMIN_ROLES (config_admin, ops_admin, admin,
   super_admin) and never in LIMITED_MODE_SCOPES; test that it never
   survives limited mode.
2. Serve each admin route EXACTLY (method + path, like config-read.ts),
   never a wildcard: PUT /v1/flags/{key}, POST /v1/config/change-requests,
   POST /v1/config/change-requests/{id}/approve, POST /v1/config/cities/status,
   GET /v1/config/cities/{cityId}/history, GET /v1/config/cities. Scope rule
   config:admin for all of them. Idempotency-Key must cross (it already is in
   HEADERS_TO_FORWARD — prove it).
3. Keep dual approval (config-service: REQUIRED_APPROVALS = 2 distinct
   approvers other than the author; approver_is_author and
   already_approved refusals). Add what the console needs and does not
   have: GET pending change requests (with approvals so far), POST
   …/{id}/reject (reason required, author or config admin), an optional
   note on approve with an audit row for the FIRST approval too (today only
   activation is audited). Every flip and approval writes an audit row with
   the actor and reason.
3b. The kill switch: the policy page's "Stop new awards" has no
   confirmation, a hard-coded reason and no resume
   (apps/admin-dashboard/src/components/marketplace/PolicyEditorPage.tsx
   65-71, policies/page.tsx 63-70). Add a confirmation naming the city, a
   required reason, and a resume action; the full console design comes
   from D3 (CC-C05).
4. Move the entries out of UNPROXIED_CLIENT_CALLS / CONFIG_WITHHELD into
   reachable cases checked against services/config-service/tests/
   routes.manifest. Keep a withheld probe for anything still not routed.
5. The kill switch must work under a Redis outage (rate limit fails open;
   auth does not) — test it.
6. Update docs/security/INTERNAL_IDENTITY.md ("config-service: two reads
   only") and the admin policy page's copy if it says the switch is
   unavailable.

If DEC-1 = B: build a separate admin ingress instead (own Caddy site and
host, IP allowlist placeholder that fails closed, the same exact-route and
scope checks in a tiny admin gateway or Caddy matcher), and keep the public
gateway's CONFIG_WITHHELD probes as they are.

Tests: gateway (scopes, exact routes, withheld probes, Idempotency-Key),
config-service (dual approval, audit), and a negative control that widening
to a wildcard fails the contract test.
```

### CC-B02 · Native projects and the RN CLI (P0-02, the code half)

Size: M. Owns: `apps/{rider,driver}-mobile/{android,ios,package.json}`,
`.github/workflows/rn-native.yml`, `docs/ops/NATIVE_RELEASE.md`.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.
React Native CLI only — these are NOT Expo apps (no app.config, no expo
dependency). No Flutter, no WebView.

Facts: neither app has android/ or ios/; @react-native-community/cli is
absent from both package.json files, so react-native start/bundle/run-*
exit 1 (GAP_REGISTER P0-02; docs/ops/NATIVE_RELEASE.md §1 has the pinned
generation command from docs/launch-readiness/handoff-rn/CLOSING_THE_GAPS.md
Gap 2).

1. Add @react-native-community/cli (and platform packages) matching
   react-native ^0.79 to both apps; update pnpm-lock.yaml; prove a frozen
   offline install.
2. Generate android/ and ios/ with the pinned template for RN 0.79, set the
   bundle ids / application ids from NATIVE_RELEASE.md, wire Firebase
   messaging and notifee config files as PLACEHOLDERS that fail the build
   loudly if the real google-services.json / GoogleService-Info.plist are
   missing (never commit real keys).
3. Make `react-native bundle` succeed for both apps (Metro config for the
   pnpm monorepo: watchFolders, nodeModulesPaths, symlinks). Add a CI step
   that runs the Android and iOS JS bundle as a real check.
4. Make rn-native.yml's rn-android job run `./gradlew assembleDebug` on
   ubuntu (no signing) as a real, non-gating check; keep release signing,
   the iOS archive and device E2E guarded and honest ("not attempted: no
   signing identity / no device farm").
5. Update NATIVE_RELEASE.md with what is now real and what stays external
   (signing keys, store accounts, device farm, FCM/APNs credentials).

Evidence: the bundle and assembleDebug logs. Do not claim a device run.
```

### CC-B03 · Wallet funding for the pilot (P0-03)

Uses DEC-6. Size: L. Owns: `services/payment-service/src/ledger/**`,
admin-dashboard finance page, rider/driver wallet screens.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.
Only start this after UBI has recorded DEC-6 in §1 of this file.

Facts: the top-up and bank-payout rails are ports that return null until
configured, and a null rail answers service_unavailable
(services/payment-service/src/ledger/providers.ts:1-6,226-235,
src/ledger/topups.ts). Every bid needs a commission hold on CLEARED wallet
balance (src/ledger/mp-holds.ts:219-226,392: insufficient_spendable).
Rider Wallet.TopUp and driver Earnings.Payouts/Cashout are
FeatureUnavailableScreen.

If DEC-6 includes B (audited ops credit):
- An admin-initiated credit to a driver's commission wallet: reason code,
  per-driver and per-day caps from city config, two-person approval (author
  ≠ approver), journaled as its own ledger entry type with an audit row, a
  reversal path, and an outbox event. Cleared immediately only after
  approval. A new flag (default off) gates it; it never touches rider
  funds.
- An admin page listing pending/approved credits with the approval action;
  follows the existing admin patterns (no new design needed).
If DEC-6 includes A (PSP rail):
- Implement the chosen provider behind the existing TopUpProvider /
  PayoutProvider ports with webhook signature verification over the raw
  body, idempotent crediting on the provider reference, and a sandbox test
  suite that is skipped (not faked) without credentials. The provider's
  webhook is a supplier route: never proxied by the client gateway (pin it
  like travel's supplier webhooks).
- Replace Wallet.TopUp / Payouts / Cashout FeatureUnavailable screens only
  behind the flag, using the boards named in the RN handoff (14e top-up
  saga, 13b statements).

Evidence: ledger invariants tests (no money created, every credit
balanced), approval tests, webhook replay tests.
```

### CC-B04 · Push device registration (P1-13)

Needs CC-B02 (native projects) for a real device and FCM/APNs credentials
(external) for delivery; the JS and server halves can land first. Size: M.
Owns: `services/notification-service/src/routes/push.ts`, gateway rule +
scope, `packages/mobile-core` push module, both apps' permission screens.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

Facts: no app registers an FCM token (@react-native-firebase/messaging is a
dependency nothing imports); POST /api/v1/push/devices
(services/notification-service/src/routes/push.ts:63) is not proxied, so
every push ends deferred_no_device and only the 8 smsFallback events reach
anyone.

Build:
1. Gateway: exact rules for register / unregister device
   (POST/DELETE /v1/push/devices) → notification-service, scope
   profile:read (survives limited mode: a new device still needs pushes);
   notification-service reads the user from the verified context, never
   from the body; route-contract cases against a generated
   notification-service manifest.
2. mobile-core: a push module that asks permission at the right moment
   (after sign-in, using the existing permissions board pattern), gets the
   FCM token, registers it (idempotent), refreshes on token change,
   unregisters on sign-out, and handles notification open → deep link
   (getInitialNotification / onNotificationOpenedApp) using the ids-only
   payload.
3. Both apps: wire it; an honest "notifications are off" state with a link
   to settings.
4. Flush the `pending` (no device) list for a user when they register a
   device, within a short window, without duplicates.

Tests: jest for the module with the native module mocked (clearly a mock);
notification-service route tests; gateway contract. Do not claim a device
delivery without a device run.
```

### CC-B05 · Admin console sign-in (P1-12) — pilot blocker for ops

Needs CC-B00 (sign-in path and first-device trust). Size: M. Owns:
`apps/admin-dashboard/src/{app/login,app/(admin)/layout.tsx,lib/api-client.ts,lib/session*}`.
The fleet portal's sign-in follows design D1 (CC-C01); the admin console
reuses the same flow and can go first with its existing login page layout.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first.

Facts: apps/admin-dashboard/src/app/login/page.tsx:27-31 simulates a login
(1.5 s timeout, redirect); api-client.ts:47-55 sends
localStorage.ubi_admin_token, which nothing writes; (admin)/layout.tsx has no
guard; next-auth is listed but unused; Caddy's basic-auth block is commented.

Build:
1. Replace the simulated login with the hardened phone + OTP sign-in
   (CC-B00), device enrolment and step-up; only roles with an admin scope
   may enter (admin, super_admin, ops roles); others get an explained
   refusal.
2. Token handling: prefer an httpOnly, Secure, SameSite=Strict cookie set by
   a tiny Next.js route handler over localStorage; refresh before expiry;
   sign-out clears it and calls the server logout.
3. A guard for every (admin) route (middleware), with redirects to /login
   and back.
4. Limited-mode sessions see a clear "verify this device" state and no
   action buttons.
5. Remove the fake Google/GitHub buttons.

Tests: unit tests for the guard and session refresh; a Playwright test
against a local gateway + user-service in-process if feasible (label any
mocked OTP provider as a mock).
```

## 5. Wave C: after the design handoff returns

Each prompt assumes the returned bundle is vendored byte-for-byte under
`docs/launch-readiness/handoff-<name>/` (README + `.dc.html` + `support.js`,
added to `.prettierignore`) and that a decisions file like
`docs/design/FLEET_CALENDAR_DECISIONS.md` records what UBI accepted,
overrode or deferred from the handoff's open questions. Where the decisions
file and the handoff disagree, the decisions file wins.

### CC-C01 · Fleet portal sign-in (P1-03, sign-in half)

Needs D1, DEC-4, CC-B00, CC-A16. Size: M.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first,
then the D1 handoff README and its decisions file.

Build the fleet portal's sign-in exactly as designed: phone + OTP via the
hardened sign-in (CC-B00), device enrolment, the limited-session state and
step-up, session refresh, sign-out and "signed out elsewhere". Reuse the
admin console's session handling from CC-B05 (httpOnly cookie via a Next.js
route handler, a middleware guard) instead of localStorage fleet_token;
delete the fleet_token path except in e2e fixtures, which must use a real
test sign-in. FleetGate keeps classifying flag_off / limited_mode /
safe_mode / 401 / 403 as today (src/lib/access.ts). testIDs from the
handoff. Tests: vitest for the flow and guard; Playwright against the
in-process stack where feasible.
```

### CC-C02 · Fleet onboarding, KYB, invitations and vehicle documents (P1-05)

Needs D1, DEC-5. Size: L. Owns: fleet-service (fleets, staff, vehicles,
documents), `packages/database` (KYB + vehicle documents + invitations
tables), contracts, portal screens, the admin review screens, and a
document storage service.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first,
then the D1 handoff README and its decisions file.

Facts: createFleet takes {name} and creates an ACTIVE fleet
(services/fleet-service/src/ops/fleets.ts:23-91; fleet.yaml says "KYB out of
scope"); the Fleet table has no KYB columns; putStaff replaces the whole
staff list by user id (no invitations; fleets.ts:134-271); nothing writes
vehicles.insurance_expiry / inspection_expiry; renew_document is offered by
conflicts but the portal marks it unavailable
(apps/fleet-portal/src/lib/conflicts-model.ts:104-112). Reusable patterns:
user-service organization invitations (invite by phone + role, accept /
decline / revoke / expire), user-service driver documents (pending → review
valid/rejected with a note, 30/14/7/1-day expiry sweep), delivery-service
presigned uploads (declare type/size/sha256 → PUT to private storage →
attach; server re-checks; short-lived private GET links).

Build, following the handoff's state machines:
1. KYB: a fleet application with the city's requirement list from city
   config (fleet.kyb.requirements, DEC-5), documents via presigned upload,
   status pending_review → changes_requested | approved | rejected;
   suspended stays. A fleet is usable for assignments only when approved
   (existing active fleets are grandfathered or migrated per the decisions
   file). Admin review routes (approve / request changes / reject with a
   reason; audited) and the admin review screen.
2. Invitations: invite by phone + role, accept/decline (the invitee must
   be signed in), revoke, expire; role change; ownership transfer needing
   the new owner's acceptance; the last-owner rule stays.
3. Vehicle documents: a vehicle_documents table (type, file ref, expiry,
   status, review fields); upload/renew via presigned upload; UBI ops
   review; on a VALID review, write vehicles.insurance_expiry /
   inspection_expiry (fleet-service becomes the single writer) so the FL-9
   sweep and the calendar conflicts resolve as already built.
4. Storage: reuse delivery-service's proofstore approach (private bucket,
   signed headers, checksum re-verification) in a shared package or a
   fleet copy, with its own bucket/prefix and env vars in the matrix.
5. Gateway rules/scopes for every new client route; manifests
   regenerated; the privacy walk extended to the new schemas.

Tests: state machines, permission matrix (owner/manager/read-only/ops),
upload verification failures, the expiry write-through resolving a
conflict, route contract. Negative control per item.
```

### CC-C03 · Weekly remittance statement and fleet wallet view (P1-09, statement half)

Needs D1, CC-A02, DEC-9. Size: M.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first,
then the D1 handoff README and its decisions file.

Build the designed weekly statement (per fleet and per assignment: due,
pro-rated planned-maintenance hours, cap applied, collected, shortfall,
carried forward, refunded, status, journal reference, closed-week
adjustments) and the fleet wallet balance with an honest "cash-out not
available yet", on top of CC-A02's service-keyed read (extend it for
statements; still never a driver's net or a per-trip split; enforce
DEC-9). All figures come from payment-service; the portal computes nothing.
Tests: contract privacy walk, portal rendering, money guard.
```

### CC-C04 · Marketplace delivery in the apps (P1-07)

Needs D2, CC-A08. Size: L. Owns: both apps' delivery screens, a delivery
detail read in delivery-service, camera/crypto/file dependencies, gateway
rules/scopes for custody reads.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first,
then the D2 handoff README and its decisions file.

Facts: delivery-service serves the custody routes described in the D2
brief (services/delivery-service/internal/handlers/{custody,proofs,
return_funding}.go; routes.manifest), behind the gateway identity group;
custody state machine in internal/custody/machine.go; proof images
JPEG/PNG/WebP ≤ 15 MB with SHA-256; presigned PUT with signed Content-Type
and X-Amz-Checksum-Sha256; attach re-verifies. No read gives the apps the
addresses, package or drop-off contact (the legacy GET /deliveries/{id}
uses the old per-service JWT and selects columns Prisma does not have).
The driver app has no camera, image-picker, crypto or file-system
dependency.

Build, following the handoff:
1. delivery-service: a gateway-identity delivery detail read for the
   sender and the assigned driver with exactly the fields the decisions
   file allows (and when — e.g. the drop-off contact only while
   in_transit, masked or relayed); route-contract case; OpenAPI.
2. Driver app: the delivery job detail, pickup / drop-off / unreachable /
   returning / held / collected flows, proof capture (camera → compress
   within limits → SHA-256 → request upload → PUT → attach), every named
   upload failure, offline retry, and the stationary lock for every
   custody action. Add the native dependencies (RN CLI, not Expo) and
   update the lockfile.
3. Rider app: post-acceptance delivery status, custody timeline with
   proof viewing (short-lived URLs, never cached), return decision with
   fee disclosure and the 402 path, final outcomes with the exact money
   statement, deep links and push entry points.
4. Flags: marketplace_delivery stays off; every surface has the flag-off
   state. Charged returns stay behind DELIVERY_CHARGED_RETURNS_ENABLED.

Tests: jest per flow with the real envelope; a proof-upload test against a
local MinIO when available (skipped, not faked, otherwise); gateway
contract. Do not claim a device run.
```

### CC-C05 · Notification copy and the ops boards (P1-06 copy, P1-11 console, P1-13 UI, P2-02, P2-04, P2-12 boards)

Needs D3, CC-A03, CC-A04, CC-A15, CC-B01 (and CC-B04 for push UI). Size: L.

```text
Read docs/launch/OPEN_ITEMS_CLAUDE_CODE_PROMPTS.md §0 (shared rules) first,
then the D3 handoff README and its decisions file.

1. Replace the placeholder copy table from CC-A03 with the D3 copy deck
   (every event × audience × channel); a test asserts every spec has copy
   for every audience the deck names and that no copy variable is another
   person's PII.
2. Fleet portal notices (bell/panel/conflict-centre integration) reading
   the in-app inbox rows from CC-A03, including the persistent "service
   soon" notice and its "Plan maintenance" action.
3. Admin boards: off-road abuse flags (on CC-A04's read and decision
   routes), notification failures with replay/discard (on CC-A15's DLQ
   routes), airport transfers needing action (on CC-A04's ops read), and
   the config console with pending change requests, approve/reject, flag
   flips and the kill switch stop/resume with confirmation and reason (on
   CC-B01). Remove the admin sidebar's links to pages that do not exist
   (P3-12).
4. App push permission and "notifications off" states (on CC-B04).

Tests: vitest/jest per board and state; the copy-coverage test; negative
control: delete one deck entry and the coverage test fails.
```

---

## 6. Suggested order and known overlaps

**Pilot-critical first** (the smallest money-moving pilot in GAP_REGISTER §10
cannot run without these): CC-A06 (OTP texts) → CC-B00 (city in the token,
first-device trust; after DEC-7/DEC-8) → CC-B05 (admin sign-in) → CC-B01
(kill switch through the edge; after DEC-1) → CC-A07 (connection budget, CI
checks) → CC-B02 (native projects) → CC-B03 (wallet funding; after DEC-6) →
CC-B04 (push; needs credentials). CC-A01 (live-ride vehicle) is required
before the `fleet` flag goes on anywhere; CC-A11 item 1 (realtime leak)
before realtime is exposed.

**Parallel batches that do not collide** (each prompt in a batch owns
different files; the batches run in order):

- Batch 1: CC-A01, CC-A04, CC-A06, CC-A09, CC-A10, CC-A12, CC-A13.
- Batch 2: CC-A02, CC-A05, CC-A07, CC-A08.
- Batch 3: CC-A03, CC-A14, CC-A16.
- Batch 4: CC-A15, then CC-A11 (both touch realtime-gateway's consumer; A15
  changes the transport first).
- Wave B after its decisions: CC-B00 (after CC-A06), CC-B05 (after B00),
  CC-B01, CC-B02, CC-B03, CC-B04 (after B02).

**Ordering rules:** CC-A06 before CC-A07 (both edit compose, the env
matrix and check-compose-env) and before CC-B00 (both edit user-service
auth); CC-A03 before CC-A15 (notification-service consumers); CC-A04, CC-A03,
CC-A15 and CC-B01 before CC-C05; CC-A16 and CC-B00 before CC-C01; CC-A08
before CC-C04; CC-A02 before CC-C03.

**Shared registries** take small additive edits from several prompts by
design: `services/api-gateway/tests/route-contract.test.ts`,
`src/identity/scopes.ts`, `packages/contracts/src/{errors,events,test-ids}.ts`
and each service's generated `routes.manifest`. Prompts in one batch may
all append to them; the second to land rebases, keeps both sides, and
regenerates the manifests and the Go error-code pin
(`internal/domain/errors_contract_test.go`) instead of hand-merging.

**After each prompt:** re-run the round verification (the per-service suites,
`turbo run typecheck lint`, `pnpm format:check`, route-contract, Go vet/lint,
Prisma drift, frozen install) and update `docs/launch/GAP_REGISTER.md`.

---

## 7. Coverage: every open register item → its prompt

| Register item                    | Prompt(s)                           | Register item                | Prompt(s)                                  |
| -------------------------------- | ----------------------------------- | ---------------------------- | ------------------------------------------ |
| P0-02 native builds              | CC-B02 (+ external signing/devices) | P2-01 admin owed work        | CC-A04                                     |
| P0-03 wallet funding             | CC-B03 (DEC-6; rails external)      | P2-02 off-road flags         | CC-A04, CC-C05                             |
| P0-04 not deployed               | external                            | P2-03 Q4 in practice         | CC-A05, CC-A03                             |
| P0-05 SMS provider               | external (code half P0-07)          | P2-04 notification failures  | CC-A15, CC-C05                             |
| P0-06 no city in tokens          | CC-B00                              | P2-05 OTP honesty, PII       | CC-A06                                     |
| P0-07 OTP send auth              | CC-A06                              | P2-06 ask travel residuals   | CC-A09                                     |
| P1-03 fleet portal reach/sign-in | CC-A16, CC-C01                      | P2-07 portal defects         | CC-A10                                     |
| P1-04 live-ride vehicle          | CC-A01                              | P2-08 driver fleet defects   | CC-A10                                     |
| P1-05 KYB, documents             | CC-C02                              | P2-09 realtime exposure      | CC-A11                                     |
| P1-06 fleet events               | CC-A03, CC-C05                      | P2-10 growth identity        | CC-A12                                     |
| P1-07 delivery in apps           | CC-A08, CC-C04                      | P2-11 deploy checks in CI    | CC-A07                                     |
| P1-08 connection budget          | CC-A07                              | P2-12 ops transfers list     | CC-A04, CC-C05                             |
| P1-09 fleet money                | CC-A02, CC-C03                      | P2-13 config hygiene         | CC-A07                                     |
| P1-10 maps key                   | external                            | P2-14 city-config drift      | CC-A13                                     |
| P1-11 admin config writes        | CC-B01, CC-C05                      | P2-15 events lost in transit | CC-A15                                     |
| P1-12 admin sign-in              | CC-B05                              | P2-16 realtime leak          | CC-A11                                     |
| P1-13 push registration          | CC-B04, CC-C05                      | P2-17 SMS/OTP hygiene        | CC-A06                                     |
| P1-14 new-device trust           | CC-B00                              | P3-01 … P3-10                | CC-A14 (P3-05 CC-B00; P3-08, P3-11 CC-A07) |
| P1-15 delivery contract          | CC-A08                              | P3-12 small findings         | CC-A03, CC-A16, CC-C05                     |
