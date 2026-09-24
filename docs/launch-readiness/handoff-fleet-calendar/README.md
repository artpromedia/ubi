# Handoff: UBI Fleet Availability & Maintenance Calendar (A05)

## Overview & scope
This covers the product and interaction design for the **fleet availability and maintenance calendar**.
It sits on top of the existing fleet contract (`/v1/fleets/*`, fleet offers, PIN signing) and the
advance-booking calendar, which is built but behind a flag.

Surfaces:
- **Fleet portal:** Next.js, dark theme. Calendar (day and week, vehicle rows and driver rows), vehicle detail,
  maintenance editor with impact preview, conflict centre, assignment and shift proposals, utilisation,
  staff roles.
- **Driver app:** React Native, dark by default. My schedule, proposal review with PIN, maintenance or
  document impact on bookings, availability and time off.
- **Rider app:** React Native. Two moments only: consent to a vehicle swap, and "driver can't make it"
  (rematch or cancel).

Out of scope (per the brief): financing, listings, KYB, payout statements, live vehicle maps,
fleet-automated bidding or dispatch, pooled rides.

### About the design files
`UBI Fleet Availability Calendar.dc.html` is a **design reference built in HTML**. It is not production
code. Rebuild it in the existing Next.js fleet portal and the React Native driver and rider apps, using
`packages/ui` tokens. No Flutter and no WebView. The phone and browser frames are only there for
presentation. The board's **showHandoff** toggle shows or hides the annotation strips.

### Fidelity
- **High fidelity** for structure, copy, states, the layer vocabulary and flows.
- **Medium fidelity** for exact spacing. Use the `packages/ui` spacing scale.
- **All data is fixture data.** Every plate, name, time and amount is invented. Do not seed it.

## Design system & tokens
These come from `packages/ui/src/theme/tokens.ts`. The dark variants are the ones used on this board.

| Role | Value |
| --- | --- |
| Brand green (primary CTA, signed shift, "now" line) | `#1DB954` · tint `rgba(29,185,84,.18)` · text on dark `#86EFAC` |
| Ink / light-surface text | `#191414` |
| Dark surfaces | page `#121212` / `#141414` · card `#1A1A1A` · raised `#1C1C1C` · sidebar `#0F0F0F` · chrome `#0B0B0B` |
| Dark borders | `#1F1F1F` · `#222` · `#262626` · `#2A2A2A` |
| Dark text | primary `#F4F4F5` · secondary `#D4D4D8` · muted `#A1A1AA` · dim `#71717A` |
| Booking (opaque) | fill `#27345C` · border `#5B73C4` · text `#C7D2FE` |
| Maintenance | 135° hatch of `rgba(245,158,11,.30/.12)` · border `#F59E0B` · text `#FCD34D` |
| Held by UBI | hatch of `#3F3F46`/`#27272A` · border `#52525B` |
| Time off (driver) | hatch of `rgba(161,161,170,.22/.08)` · border `#71717A` |
| Driver availability | fill `rgba(255,255,255,.04)` · border `#52525B` |
| Proposed (unsigned) | transparent · `1px dashed #1DB954` |
| Conflict | fill `#3A1F2A` · `2px solid #EF4444` · text `#FECACA` |
| Warning / error / info | `#F59E0B` / `#EF4444` / `#5B73C4` |

Typography: **Poppins** for headings (600–800), **Inter** for body text, and **JetBrains Mono** for plates,
times, zones and IDs.
Radius: blocks 6px, cards 12–14px, pills 999px.
Icons: monoline, 2px stroke, `currentColor`. Map them to the codebase's icon library (lucide or its RN equivalent).

## Global rules, as they apply here
1. **Driver consent.** A fleet can propose assignments, shifts and terms. It can never accept, bid, change
   earnings or commit a driver's time. Material changes (remittance, shift pattern, vehicle) need a new PIN
   signature. Declining has no penalty, no score and no acceptance rate.
   *Enforced on:* B7, C2, C3, C4, and the read-only driver layers in B3.
2. **Rider commitments are never silently changed.** A rider keeps the driver they selected. A change of driver, class, capacity or pickup window needs
   revalidation plus the rider's **explicit consent**. A vehicle-only swap (same driver, class, capacity,
   window and fare) is revalidated, then the rider is **notified with the new plate and free cancellation**
   until pickup (Q3). Never divert a current passenger.
   *Enforced on:* B5 (Confirm is blocked), D1, D2.
3. **Fleet privacy.** Bookings appear to fleets as opaque time blocks ("Booked · 07:15–09:40"), with the
   server's risk flag. There is no rider identity, contact, address, route or safety evidence.
   **Decided (Q1):** no zone label, ever.
4. **UBI decisions are status only.** "Held by UBI" and document expiry enforcement show the status and its
   effect. There is no evidence and no override.
5. **Money.** The commission is 10% of the commissionable fare, reserved at bid and captured once at
   selection. The driver sees commission, fleet share and driver net as separate lines. **Fleets see gross, UBI commission and
   their own remittance status, never the driver's net (decided, Q7).** There is no invented owner percentage. Amounts are server-computed integer minor units, `{amountMinor, currency}`.
6. **Feasibility is decided by the server.** Screens show "Checking…" until the server responds. They never
   compute conflicts, travel time or money themselves.
7. **Honesty.** Fixture screens are labelled as such. Unknown values display as "Not enough data".
8. **Time.** Show the city's local time with the zone labelled (`Africa/Lagos · WAT (UTC+1)`). Store UTC plus
   an IANA zone. Days split at local midnight. On DST days the ruler repeats or skips the hour and labels
   the offset.
9. **Accessibility.** Every block and badge has text. The timeline has an agenda or table equivalent (see
   Accessibility below).

## Availability model

### Layers and precedence (a higher layer wins)
| # | Layer | Owner | Notes |
| --- | --- | --- | --- |
| 1 | UBI status: `held_by_ubi`, `doc_expired`, `suspended` | UBI | Status only. Overrides everything. |
| 2 | Marketplace commitments: `on_trip` now, and confirmed or reconfirmed advance bookings (occupied interval including pre/post buffers) | Rider + driver | Never silently displaced. |
| 3 | Driver time off | Driver | Fleets see the hours read-only, with no reason (Q9). The fleet cannot override it. If it overlaps the driver's own booking, the driver resolves it. |
| 4 | Maintenance block | Fleet | Cannot be confirmed over layer 2 until every overlap is resolved. Unplanned off-road takes effect immediately and puts bookings in `at_risk`. |
| 5 | Signed assignment / shift | Fleet + driver PIN | Pairs a driver with a vehicle under a terms version. |
| 6 | Driver availability window | Driver | When the driver is open to work. |
| 7 | Proposals (unsigned) | Fleet | Never count as availability. |

**Bookable interval** for a driver/vehicle pair = (6) ∩ (5), minus (1)–(4), minus routed travel time
between adjacent commitments. The server computes this.

### Entities (proposed; all times are UTC plus `zone`)
```ts
type Money = { amountMinor: number; currency: string };           // server-computed

MaintenanceBlock {
  id; fleetId; vehicleId;
  kind: 'planned_service' | 'inspection' | 'repair' | 'unplanned_off_road';
  startsAt; endsAt; zone; note?;
  status: 'draft' | 'checking' | 'needs_resolution' | 'scheduled' | 'active' | 'completed' | 'cancelled';
  createdBy: staffId; version;
}
DriverAvailability {                                                // authored by the driver only
  id; driverId; kind: 'available' | 'time_off';
  startsAt; endsAt; rrule?; zone;
  status: 'draft' | 'checking' | 'saved' | 'saved_with_withdrawals';
}
Assignment {                                                        // history table (replaces the single vehicleId)
  id; fleetId; vehicleId; driverId;
  shift: 'full' | 'day' | 'night' | { custom: { start: 'HH:mm'; end: 'HH:mm' } };
  validFrom; validTo?; termsVersion; signedAt;
}
AssignmentProposal {
  id; fleetId; vehicleId; driverId; shift; terms: AssignmentTerms; diff: TermDiff[];
  status: 'draft' | 'checking' | 'sent' | 'pending_signature' | 'signed' | 'declined' | 'expired' | 'withdrawn' | 'superseded';
  expiresAt;                                                         // sent + 48h
}
OccupiedBlock {                                                     // the ONLY booking shape a fleet receives
  blockId; driverId; vehicleId?; startsAt; endsAt;                  // includes buffers
  kind: 'booked' | 'on_trip'; risk: 'ok' | 'at_risk';
}                                                                    // no rider, no location, no fare
UbiStatus { subject: 'driver' | 'vehicle'; subjectId; status: 'held_by_ubi' | 'doc_expired' | 'suspended'; effectiveFrom; effectiveTo? }
Conflict {
  id; type: ConflictType; severity: 'critical' | 'high' | 'medium' | 'blocked' | 'status';
  subjects: { vehicleId?; driverId?; blockId? }[];
  resolverRoles: ('fleet' | 'driver' | 'rider' | 'ubi')[];
  allowedActions: ActionId[]; deadlineAt?;
  status: 'open' | 'resolving' | 'resolved' | 'lapsed';
}
BookingVehicleSwap {
  id; bookingId; fromVehicleId; toVehicleId;
  status: 'proposed' | 'driver_accepted' | 'revalidating' | 'rider_notified' | 'rider_consent_pending' | 'applied'
        | 'driver_declined' | 'revalidation_failed' | 'rider_declined' | 'expired';
}
```
Derived and never written by clients: `VehicleAvailability per interval ∈ in_service | maintenance |
doc_expired | held_by_ubi | unassigned`.

**Constraints for engineering:**
- An exclusion constraint on `(vehicleId, tstzrange)` across scheduled or active maintenance and confirmed
  bookings that have a vehicle recorded.
- The existing driver-level booking overlap constraint stays in place.
- Signed assignments on the same vehicle must have non-overlapping shift intervals.

### State machines
| Entity | Transition | Triggered by | Consent |
| --- | --- | --- | --- |
| MaintenanceBlock | draft → checking | fleet owner or manager | none |
|  | checking → scheduled (no overlap) · → needs_resolution (overlaps a booking) | server | — |
|  | needs_resolution → checking (block moved or shortened) · → scheduled (every overlap resolved) | fleet · server | whatever each resolution needs |
|  | scheduled → active → completed | server clock | — |
|  | any state before active → cancelled | fleet | none |
|  | unplanned_off_road: created → active; overlapped bookings → at_risk | fleet | none (safety). Bookings follow the swap or withdraw path. |
| AssignmentProposal | draft → checking → sent → pending_signature | fleet → server | — |
|  | checking fails (`shift_overlap`, `above_city_cap`) | server | cannot be sent |
|  | pending_signature → signed | driver | **PIN** |
|  | → declined | driver | none, no penalty |
|  | → expired (48 h) · → withdrawn | server · fleet | — |
|  | signed + material change → a new proposal supersedes it | fleet | **new PIN** |
| DriverAvailability | draft → checking → saved | driver → server | driver |
|  | → saved_with_withdrawals | driver confirms each explained withdrawal | driver |
| BookingVehicleSwap | proposed → driver_accepted → revalidating → **rider_notified** → applied (vehicle-only change) | fleet → driver → server | **driver**. The rider is notified and can cancel free until pickup. |
|  | proposed → driver_accepted → revalidating → rider_consent_pending → applied (driver, class, capacity or window changes) | fleet → driver → server → rider | **driver + rider** |
|  | any failure or decline → the booking keeps its original vehicle; if the blocker remains → booking at_risk | — | — |
| Booking risk overlay | ok → at_risk → resolved, or at the deadline → booking `failed(reason)` | server | — |
| Arrangement termination | signed → notice (2 weeks) → ended; bookings after the end date → at_risk | fleet or driver | none for notice. A later swap follows Q3: the rider is notified (vehicle-only change) or asked for consent (other changes). |

## Conflict matrix
| Conflict | Severity | Resolved by | Allowed actions | Consent | Financial outcome |
| --- | --- | --- | --- | --- | --- |
| Maintenance overlaps a confirmed booking | Critical | Fleet → driver → rider | Move or shorten the block; propose a vehicle swap; driver may withdraw. **The fleet cannot create the block over the booking** (Confirm is disabled, and the server returns 409). The preview shows affected assignments and opaque bookings before confirmation. | Swap: driver, then rider. Withdraw: driver. | Weekly fixed remittance pro-rated for lost shift hours (Q2). Withdraw: driver's commission reserve returned; rider funding released; rider offered a rematch at the same fare or a refund; no penalty. |
| Two drivers, same vehicle, overlapping shifts | Blocked | Fleet | Change the times. It is prevented at propose time (422 `shift_overlap`). The overlap is shown inline, naming the signed shift. | — | None |
| Vehicle document expires inside a booking | High | Fleet renews · UBI enforces | **Prevented first:** the server never offers a booking that falls after a known expiry (Q6). For bookings that already exist: Upload the renewal before expiry; otherwise swap the vehicle or the driver withdraws. Warnings at 30/14/7/1 days and whenever a booking falls after expiry. At expiry the vehicle becomes `doc_expired` (status only). | Swap as above | If still unresolved at expiry: booking `failed(eligibility_lost)`; commission returned; funding released or rematched. |
| Driver licence expires inside a booking | High | Driver renews · UBI enforces | Driver renews; otherwise driver withdraws or the rider is offered a rematch. The fleet can only send a reminder. | Rematch: rider (different driver) | Same as eligibility_lost |
| Driver time off overlaps their own booking | Medium | Driver | Trim the time off to keep the booking, or keep the time off and withdraw. The fleet sees "Driver resolving" only. | Driver; the rider then chooses rematch or refund | Commission returned; funding released or rematched at the same fare |
| Vehicle swap for a booking | Medium | Fleet proposes · driver accepts · rider notified or consents | Same or higher class, at least the same capacity, revalidated by the server | Driver always. Rider notified with free cancellation for a vehicle-only change; explicit consent otherwise (Q3). | Fare unchanged; commission not charged again |
| Termination (2-week notice) with bookings after the notice date | High | Driver · rider | The driver keeps the booking on another eligible vehicle (swap path) or withdraws. The driver sees the list of affected bookings when notice starts. | Rider if the vehicle changes | Withdraw as above; remittance stops at the notice end and is not retroactive |
| UBI holds a driver or vehicle | Status | UBI | The fleet has no action. The rider sees "Your driver can't make this trip", with no reason given. | Rider chooses rematch or refund | Rider funding released on refund; commission handled per UBI's decision |
| Unplanned off-road (breakdown) | Critical | Driver, owner or manager reports (Q5) → driver → rider | The block takes effect immediately; bookings become at_risk with the Q4 deadline; swap or withdraw path | As swap | Weekly fixed remittance pro-rated (Q8). Bookings: as withdraw. |

## Screens / views
Every screen has **loading, empty, error, offline/stale (last updated time), flag off, and permission
denied** variants, as listed in "States" below.

### Fleet portal (Next.js)
- **B1 FleetCalendar, day, vehicle rows.** 06:00–22:00 ruler; "now" marker; zone label; layer toggles
  (Assignments, Maintenance, Bookings, Documents); filters (class, status, conflicts only); plate search;
  virtualised fixed-height rows (tested to 200+). Two lanes per row: top for assignments and maintenance,
  bottom for opaque bookings. `GET /v1/fleets/{id}/calendar?from&to&zoom=day&rows=vehicles&layers=`
- **B2 FleetCalendar, week.** Per-day summary cells (booked count, shift summary, flags). Month boundary
  labelled. Selecting a cell opens that day. Same endpoint with `zoom=week`.
- **B3 FleetCalendar, driver rows.** Three lanes: availability and time off (read-only, "set by driver"),
  signed shift plus the vehicle's maintenance, opaque bookings. Hours summary. `rows=drivers`
- **B4 VehicleDetail.** Documents plotted against 30 days of commitments; maintenance (upcoming and past);
  assigned drivers and shifts with terms version; week gross / UBI commission / fleet remittance / remittance status (the driver's net is never shown), from `/overview` with asOf.
  `GET /v1/fleets/{id}/vehicles/{vid}/availability`
- **B5 MaintenanceEditor.** Form (vehicle, kind, start and end in local time) → "Checking impact with the
  server…" → impact preview: affected assignments, opaque bookings, and resolution options suggested by the
  server (move to the next feasible window, swap with eligibility reasons, ask the driver to review).
  Confirm is disabled until resolved. Includes a "Report off-road" path.
  `POST …/maintenance:preview` → `POST …/maintenance`
- **B6 ConflictCentre.** Severity, conflict, subject, who resolves, deadline, actions. Actions come from
  `allowedActions[]`. `GET …/conflicts?status=open`, plus `fleet.conflict.*` events.
- **B7 ProposeAssignment.** Terms diff (vehicle, shift, remittance, shortfall), server overlap and city-cap
  checks, consent timeline (sent → waiting for the signature, with its expiry → signed, declined or
  expired). The fleet never sees why a driver declined. Extends the existing `assignments/propose` with
  `shift{start,end}`.
- **B8 Utilisation.** Per vehicle: on trip, online idle, booked ahead, maintenance, and offline hours, with
  a definition for each, asOf, and "Not enough data" for vehicles with less than 7 days. No benchmarks.
  `GET …/utilisation`
- **B9 StaffRoles.** Owner / manager / read-only matrix (below). Permission denied hides the controls.
  `GET/PUT …/staff`

| Capability | Owner | Manager | Read-only |
| --- | --- | --- | --- |
| View calendar and utilisation | Yes | Yes | Yes |
| Create or edit maintenance; report off-road | Yes | Yes | No |
| Propose assignments and shifts | Yes | Yes | No |
| Propose remittance terms | Yes | No | No |
| Upload vehicle documents | Yes | Yes | No |
| Terminate an arrangement | Yes | No | No |
| Manage staff | Yes | No | No |
| See rider identity, routes or safety evidence | Never | Never | Never |

### Driver app (React Native)
- **C1 DriverSchedule.** A single agenda for each day combining the driver's availability, signed shift,
  vehicle maintenance and bookings, with an alert when a decision is needed. Extends the existing driver
  calendar. `GET /v1/drivers/me/schedule`
- **C2 FleetProposalReview.** Terms diff; server check result; "Accept & sign with PIN" / "Decline, no
  penalty". Uses the existing sign and decline endpoints.
- **C2b Motion lock.** Decisions can't be taken while moving (reuses the stationary gate). Shows the
  earliest deadline.
- **C3 BookingImpact.** Choices: keep the booking on a swapped vehicle (disabled, with the reason, when none
  is eligible), keep it and ask the fleet to move the block, or withdraw. Each choice shows its explained
  outcome with server amounts. `GET /v1/drivers/me/conflicts/{id}` → `POST …/withdraw`
- **C5 ReportVehicleIssue.** When stationary, the driver reports "Can't drive: breakdown" or "Can drive, needs
  service soon". This creates an `unplanned_off_road` block, alerts the fleet, pro-rates remittance and starts
  the booking decisions. It points to SOS for personal safety. `POST /v1/drivers/me/vehicle-issues`
- **C4 AvailabilityEditor.** Time-off form → server preview listing the shift and bookings it affects →
  choose to trim, or to withdraw with the outcome shown → save.
  `POST /v1/drivers/me/availability:preview` → `PUT`

### Rider (React Native, Book-for-Later visual language)
- **D1 BookingVehicleUpdated / BookingChangeConsent.**
  - **Vehicle-only change:** the rider is notified ("Your driver will arrive in a different car"), sees the old
    and new vehicle and the plate, and gets "Got it" / "Cancel for free". It is applied immediately.
  - **Driver, class, capacity or window change:** the same layout, but with explicit "Confirm" / "Cancel for
    free". Nothing changes until the rider confirms.
- **D2 BookingDriverLost.** No reason is shown. "You won't be charged." Options: find another driver at the
  same fare, or cancel and release the funds.

## Proposed API contract (all marked **proposed — backend to build**)
Every state-changing POST/PUT requires `Idempotency-Key`. Money is `{amountMinor, currency}`. Times are
ISO-8601 UTC, and each response carries `zone` (IANA).

```http
GET  /v1/fleets/{id}/calendar?from&to&zoom=day|week&rows=vehicles|drivers&layers=assignments,maintenance,bookings,documents&class&status&conflictsOnly&q&cursor
→ { zone, asOf, rows: [{ vehicleId|driverId, label, statusNow, flags[],
      assignments: Assignment[], maintenance: MaintenanceBlock[], occupied: OccupiedBlock[],
      documents: [{ kind, status, expiresAt }], ubiStatus?: UbiStatus,
      availability?: DriverAvailability[] /* rows=drivers only, read-only */ }],
    daySummaries?: [{ date, rowId, bookedCount, shiftSummary, flags[] }] /* zoom=week */, nextCursor }

POST /v1/fleets/{id}/maintenance:preview   { vehicleId, kind, startsAt, endsAt }
→ { feasible: boolean, affectedAssignments: [{ assignmentId, driverDisplayName, lostInterval, lostShiftHours,
      remittanceDelta: Money /* pro-rated, weekly_fixed only */ }],
    affectedBlocks: OccupiedBlock[], suggestions: [{ kind: 'move', startsAt, endsAt }
      | { kind: 'swap', candidates: [{ vehicleId, eligible, reason? }] } | { kind: 'ask_driver' }] }
POST /v1/fleets/{id}/maintenance            { …same, previewToken }   → 201 MaintenanceBlock | 409 needs_resolution
PATCH /v1/fleets/{id}/maintenance/{mid}     → re-preview is required
POST /v1/fleets/{id}/maintenance/{mid}:cancel
POST /v1/fleets/{id}/off-road               { vehicleId, startsAt, expectedEndsAt? } → MaintenanceBlock(active) + conflicts

GET  /v1/fleets/{id}/vehicles/{vid}/availability?from&to
GET  /v1/fleets/{id}/conflicts?status=open|resolving|resolved
     → Conflict[] (with allowedActions for the caller's role)
POST /v1/fleets/{id}/conflicts/{cid}:remind                            (driver-owned conflicts)
POST /v1/fleets/{id}/assignments/propose    (existing) + { shift: { start, end } }   → 422 shift_overlap | above_city_cap
POST /v1/bookings/{bid}/vehicle-swaps       { toVehicleId }  (fleet)   → BookingVehicleSwap
POST /v1/drivers/me/vehicle-swaps/{sid}:accept|decline
POST /v1/bookings/{bid}/changes/{cid}:accept|decline  (rider)
GET  /v1/fleets/{id}/utilisation?from&to   → { asOf, rows: [{ vehicleId, hours: { onTrip, onlineIdle, bookedAhead, maintenance, offline } | null, reason? }] }
GET|PUT /v1/fleets/{id}/staff              → [{ staffId, role: 'owner'|'manager'|'read_only' }]

GET  /v1/drivers/me/schedule?from&to       → { zone, items: [{ kind, startsAt, endsAt, label, risk?, decisionDeadline? }] }
POST /v1/drivers/me/availability:preview   { windows[] } → { affects: [{ kind:'shift'|'booking', id, effect, outcome?: { commissionReturned: Money } }] }
PUT  /v1/drivers/me/availability           { windows[], withdrawals: bookingId[], previewToken }
GET  /v1/drivers/me/conflicts/{cid}        → { options: [{ id, enabled, reason?, outcome: { commissionReturned?: Money, riderEffect } }] }
POST /v1/drivers/me/conflicts/{cid}:withdraw|keep
POST /v1/drivers/me/vehicle-issues         { vehicleId, severity: 'cannot_drive'|'service_soon', note? } → MaintenanceBlock(active|draft) + conflicts
```

**Events:** `fleet.conflict.opened | resolved | lapsed` · `booking.risk.changed` ·
`maintenance.status.changed` · `assignment.proposal.status.changed` · `vehicle.document.expiring`
(sent at T-30/14/7/1).

## Route → endpoint / event map
```
FleetCalendar        GET  /v1/fleets/{id}/calendar                 (proposed)
VehicleDetail        GET  /v1/fleets/{id}/vehicles/{vid}/availability (proposed) + /overview (existing)
MaintenanceEditor    POST …/maintenance:preview → POST …/maintenance (proposed)
ReportOffRoad        POST …/off-road                                (proposed)
ConflictCentre       GET  …/conflicts · POST …:remind               (proposed)
ProposeAssignment    POST …/assignments/propose + shift             (existing + extension)
VehicleSwap          POST /v1/bookings/{id}/vehicle-swaps           (proposed)
Utilisation          GET  …/utilisation                             (proposed)
StaffRoles           GET|PUT …/staff                                (proposed)
DriverSchedule       GET  /v1/drivers/me/schedule                   (proposed)
FleetProposalReview  POST /v1/fleet-offers/{id}/sign {pin} · /decline (existing)
BookingImpact        GET/POST /v1/drivers/me/conflicts/{cid}        (proposed)
AvailabilityEditor   POST …/availability:preview → PUT              (proposed)
ReportVehicleIssue   POST /v1/drivers/me/vehicle-issues             (proposed)
BookingChangeConsent POST /v1/bookings/{id}/changes/{cid}:accept|decline (proposed)
Events               fleet.conflict.* · booking.risk.changed · maintenance.status.changed · assignment.proposal.status.changed
```

## Backend dependencies
| ID | Dependency |
| --- | --- |
| FL-1 | The fleet backend isn't built (contract only), and the `fleet` flag is off. Every screen is a fixture until this lands. |
| FL-2 | A maintenance block store with an exclusion constraint against confirmed booking intervals per vehicle. |
| FL-3 | **Drivers on several vehicles over time:** today a driver has a single `vehicleId`, so this needs an Assignment history table with non-overlapping shifts per vehicle. |
| FL-4 | **Writing `vehicleId` onto advance bookings**, so the per-vehicle overlap constraint applies (this calendar supplies it). |
| FL-5 | Driver availability and time-off store, plus preview endpoints. |
| FL-6 | A fleet-safe booking projection (`OccupiedBlock`) with a risk overlay. No rider or location fields may be present, even as null. |
| FL-7 | Utilisation aggregates with `asOf`. |
| FL-8 | A vehicle swap flow on bookings, including rider notification (vehicle-only change) or consent (other changes). |
| FL-9 | Document-expiry scheduler and events. |
| FL-10 | Remittance pro-rating: when fleet-scheduled maintenance or an off-road report removes signed shift hours, the ledger reduces that week's weekly_fixed remittance by (lost ÷ scheduled shift hours), snapshotted per week. |
| FL-11 | Driver-reported vehicle issues: an endpoint, fleet alerting, and auto-creation of an unplanned_off_road block. |
| FL-12 | Expiry-aware feasibility: booking eligibility excludes any vehicle or driver whose known document expiry falls before the booking ends. |
| FL-13 | A city-configurable resolution lead time (default 2 h) and an automatic rider rematch at the deadline. |
| — | **No odometer feed** exists, so mileage-based maintenance is not proposed. It is time-based only. |

## Copy deck
**Fleet portal**
- Calendar: "Fleet calendar" · "Now 09:42" · "Africa/Lagos · WAT (UTC+1)" · "Booked · 07:15–09:40" ·
  "Held by UBI · status only · decided by UBI" · "Proposed · {driver} · awaiting signature" · "Unassigned"
  · "Feasibility from server · updated {time} WAT".
- Maintenance: "New maintenance block" · "Checking impact with the server…" · "We don't assume anything is
  free until the server confirms it." · "Affected booking · 1" · "Must be resolved first" · "Move block to
  {start}–{end}" · "Next window the server found with no overlaps (buffers included)" · "No eligible
  vehicle: {reasons}" · "Ask {driver} to review the booking" · "{driver} will be notified. Her signed terms don't change. Her weekly fixed remittance is pro-rated for the {n} lost shift hours: −{amount} (computed by UBI)." · "Only {driver} can withdraw. The block stays
  in needs_resolution until they decide." · "Planned maintenance never cancels a booking. Breakdown? Use
  'Report off-road'." · Buttons: "Move & confirm" / "Confirm block" (disabled while checking).
- Proposal: "Server check passed: no overlap with {driver}'s signed {shift} shift, and {amount} is within
  the {city} city cap." · Blocked: "{time} overlaps {driver}'s signed shift on {plate} ({overlap}). Change
  the times to send." · "Waiting for {driver}'s signature · Expires {date} (48 h). Not counted as
  availability." · "{driver} declined. No reason is required and there is no penalty." · "No reply in 48 h.
  You can send a new proposal."
- Utilisation: "No benchmarks or targets are shown." · "Not enough data · added {date}".
- Permission: "Your role can view the calendar but can't create maintenance. Ask a fleet owner or manager."

**Driver**
- "My schedule" · "1 booking needs your decision" · "Vehicle in service during {interval}" · "Decide by
  {time}".
- Proposal: "Proposal from {fleet}" · "This doesn't clash with your availability or your bookings (checked
  by UBI)." · "If you decline, nothing changes and there is no penalty. Your fleet only sees 'declined'." ·
  "Accept & sign with PIN" / "Decline, no penalty".
- Motion: "Review when stopped" · "They'll open once you're safely stationary."
- Impact: "Keep it on another vehicle", with "Not available: {reason}" when disabled · "Keep it, and ask
  the fleet to move the service" · "Withdraw from this booking: Your {amount} commission reserve is returned
  to your wallet. The rider's funding is released and they're offered a rematch at the same fare. No
  penalty and no score." · "Amounts are from UBI. Nothing changes until you confirm."
- Report issue: "Report a vehicle problem" · "Can't drive: breakdown" / "Can drive, needs service soon" · "Your
  fleet is alerted right away, and the vehicle is marked off-road." · "Your remittance is pro-rated for the lost
  hours." · "If you're unsafe, use the SOS button. This form only reports the vehicle." · "Report breakdown".
- Time off: "Only you can set this" · "Checked by UBI" · "Hours reduced" / "Conflicts" · "Start time off at
  {time}. Keep the booking" · "Keep {time} and withdraw the booking: {amount} returned · rider offered a
  rematch · no penalty".

**Rider**
- D1 (vehicle only): "Vehicle updated" · "Your driver will arrive in a different car" · "Your driver, class, seats,
  pickup time and fare are all unchanged. You can cancel for free until pickup. Check the plate when the car
  arrives." · "Got it" / "Cancel for free".
- D1 (consent variant): "Your confirmation needed" · "Nothing changes unless you confirm. Cancelling is free." ·
  "Confirm" / "Cancel for free".
- D2: "Driver unavailable" · "Your driver can't make this trip" · "You won't be charged." · "Find another
  driver: same fare, {amount}. You choose from the new offers." · "Cancel and release my {amount}".

**States:** "Loading calendar…" · "No vehicles yet. Add a vehicle to start planning." · "We couldn't load
the calendar. Try again." · "Offline · showing data from {time}" · "Fleet tools aren't available yet in
your city." · "Checking with UBI…" · "At risk · needs a decision by {time}" · "{day} · 25-hour day ·
{hour} happens twice" · "Showing 1–40 of {n} vehicles".

## Accessibility
- **Timeline keyboard model:** the grid is `role="grid"`. Up and Down move between rows; Left and Right
  move between blocks in a row, in time order; Enter opens a block's detail; `D` and `W` switch zoom;
  `T` jumps to now; `/` focuses plate search.
- **Screen-reader equivalent:** an "Agenda / table" toggle renders the same data as a sortable table with
  columns vehicle, start, end, layer, label and status. Each block's accessible name is, for example,
  "LAG-118-AB, Booked, 11:20 to 13:00 West Africa Time, conflict with maintenance".
- Status is never shown by colour alone. Every block and badge has text, and the hatch patterns
  distinguish maintenance, held and time off even in greyscale.
- Mobile touch targets are at least 44 px. Driver decisions are locked while moving.
- Contrast: text on dark surfaces is at least 4.5:1 (for example `#D4D4D8` on `#141414`).

## testIDs (`<app>.<screen>.<element>`)
```
fleet.calendar.vehicleRow · fleet.calendar.driverRow · fleet.calendar.block · fleet.calendar.nowMarker
fleet.calendar.zoomDay · fleet.calendar.zoomWeek · fleet.calendar.weekCell · fleet.calendar.layerToggle
fleet.calendar.filterConflicts · fleet.calendar.plateSearch · fleet.calendar.agendaToggle
fleet.vehicle.documentsTimeline · fleet.vehicle.maintenanceList · fleet.vehicle.weekMoney
fleet.maintenance.form · fleet.maintenance.impactPreview · fleet.maintenance.resolutionOption · fleet.maintenance.confirm
fleet.offRoad.report
fleet.conflicts.row · fleet.conflicts.action
fleet.assignment.termsDiff · fleet.assignment.proposeSubmit · fleet.assignment.consentStatus
fleet.utilisation.vehicleBar · fleet.staff.roleMatrix
driver.fleet.scheduleView · driver.fleet.decisionBanner · driver.fleet.proposalAccept · driver.fleet.proposalDecline
driver.fleet.pinPad · driver.fleet.motionLock · driver.fleet.impactOption · driver.fleet.impactWithdraw
driver.fleet.timeOffPreview · driver.fleet.timeOffSave · driver.fleet.reportIssue
rider.booking.vehicleUpdatedAck · rider.booking.vehicleChangeConfirm · rider.booking.vehicleChangeCancel · rider.booking.rematchSameFare · rider.booking.cancelRelease
```

## Decisions & assumptions
Every question has been resolved following marketplace best practice, favouring whatever removes friction and
prevents failed bookings, without weakening consent or privacy. The **Why** column gives the efficiency reason.

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| Q1 | Zone label on fleet booking blocks? | **Fully opaque.** | Privacy by default. The server already does feasibility, so fleets don't need a location to plan. |
| Q2 | Weekly fixed remittance during fleet-scheduled maintenance? | **Pro-rated** by (lost ÷ scheduled signed shift hours), server-computed and snapshotted weekly. percent_of_net needs no adjustment. | Drivers don't pay for downtime the fleet causes. This avoids disputes and keeps drivers from leaving the fleet. |
| Q3 | Rider consent for a vehicle swap? | **Vehicle-only swap** (same driver, class, capacity, window and fare): **notify** with the plate and free cancellation until pickup. **Any other change: explicit consent.** | This matches the brief's rule 2 ("where the rider would notice"). An explicit tap on every plate change leaves bookings stuck waiting for a reply. |
| Q4 | Conflict resolution deadline? | **The earlier of** reconfirmation and **pickup − 2 h** (city-configurable). At the deadline the **rider is offered a rematch at the same fare automatically**. | 2 h leaves enough lead time to rematch. Automatic rematch recovers the trip instead of letting it fail. |
| Q5 | Who can report unplanned off-road? | **The driver** (from the app) **plus the owner and manager.** Read-only staff cannot. | The driver is the first to know about a breakdown. Reporting minutes earlier protects the bookings that follow. |
| Q6 | Document-expiry handling? | **Warnings at 30/14/7/1 days**, and the server **never offers bookings that fall after a known expiry**. | Preventing the conflict up front is cheaper than resolving it later. |
| Q7 | What money do fleets see? | **No driver net.** Hours, gross, UBI commission and remittance status only. | Privacy. Fleets have everything they need to reconcile remittance. |
| Q8 | Do breakdowns pro-rate remittance? | **Yes**, the same as Q2. | Asset risk sits with the vehicle owner. |
| Q9 | Do fleets see driver time off? | **Yes, as read-only hours with no reason.** | Fleets can plan cover without the driver's privacy being compromised. |

**Assumptions carried into the design (engineering may rely on these):**
- **A1** Planned maintenance can never be confirmed over a booking. Unplanned off-road can be, but it only
  sets bookings to at_risk. It never cancels them.
- **A2** Proposals never count as availability.
- **A3** Driver time off takes precedence over a fleet shift. Its effect on remittance follows the terms'
  shortfall rule. It is not pro-rated, because the fleet did not cause it.
- **A4** Swap eligibility is same or higher class and at least the same capacity. The fare is unchanged (no upsell).
- **A5** Utilisation needs at least 7 days of data before it is shown.
- **A6** Maintenance is time-based only (there is no odometer feed).

## Files
- `UBI Fleet Availability Calendar.dc.html`: the screen-flow board. It contains the model, portal B1–B9,
  driver C1–C4, rider D1–D2, the states grid, and the handoff panel, and has a showHandoff toggle.
- `support.js`: the runtime the board needs to open in a browser.
