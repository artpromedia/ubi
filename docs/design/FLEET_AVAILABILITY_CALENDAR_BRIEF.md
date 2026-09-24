# Claude Design brief — UBI Fleet availability & maintenance calendar (A05)

Ubiquiti Mobility Inc. (UBI) · repository `artpromedia/ubi` · requested by engineering after the
22–23 Sep 2026 marketplace rounds. This brief is self-contained: you do not need repository access.

## Why this brief exists

Engineering is building the fleet vertical (addendum A05). Every part of it is specified **except the
availability and maintenance calendar**, which has no design anywhere: the fleet API contract covers
vehicles, drivers, consented remittance terms and assignment offers, but nothing about _when_ a vehicle
or driver is available, when a vehicle is off the road for maintenance, or how that interacts with
rides riders have already booked in advance. Engineering will not guess this, because getting it wrong
either strands booked riders or lets a fleet owner overrule a driver's consent.

**What we need from you:** the product and interaction design for that calendar — fleet-owner web
portal, driver mobile app, and the few rider-facing moments it causes — delivered in the same handoff
format as the previous UBI marketplace/travel/AI handoff (see _Return format_).

> If you have the previous handoff bundle (`design_handoff_marketplace_travel_ai` — README + `.dc.html`
> board + `support.js`), use it as the visual and structural reference. Match its tokens, board style,
> annotation strips and README structure. Do not introduce a new design system.

---

## 1. Context you need

### 1.1 The product

UBI is a mobility marketplace in African cities. Riders request a trip and receive **private offers
from eligible drivers**; the **rider chooses** the driver. Drivers bid only while safely stationary.
Riders can also **book for later**:

- **Scheduled request** — stored intent, published to drivers near pickup time; _no driver secured_.
- **Advance reservation** — a named driver has committed to a specific future trip ("driver confirmed").
- **Recurring journeys** — a template generating independent occurrences.

A **fleet** is a business that owns several vehicles and places UBI drivers in them. The fleet proposes
terms (weekly fixed remittance or % of net, capped by city policy, with a shortfall rule and a shift);
the driver **signs with a PIN**; the ledger then shows the fleet's remittance as its own line on every
payout. The fleet portal is a **Next.js web app** (dark theme). Drivers use a **React Native** app
(dark-default). No Flutter, no WebView.

### 1.2 What already exists — do not redesign, design _around_ it

**Fleet API contract (exists as a contract only; the fleet backend is not built yet):**

| Endpoint                                                                                 | Purpose                                                         |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `POST /v1/fleets`                                                                        | create fleet (KYB)                                              |
| `GET /v1/fleets/{id}/overview`                                                           | gross, remittances due/covered, utilisation, idle, alerts       |
| `GET /v1/fleets/{id}/vehicles`                                                           | vehicles with status now, drivers, week gross, remittance, docs |
| `POST /v1/fleets/{id}/assignments/propose`                                               | propose driver↔vehicle terms (offer valid 48 h)                 |
| `GET /v1/drivers/me/fleet-offers` · `POST /v1/fleet-offers/{id}/sign {pin}` · `/decline` | driver side of consent                                          |
| `GET /v1/drivers/me/fleet` · `POST /v1/drivers/me/fleet/terminate`                       | current arrangement; 2-week notice                              |

`FleetVehicle` fields: `vehicleId, plate, model, classes[], drivers[{driverId, displayName, shift: full|day|night}],
statusNow: on_trip|online|offline|idle|held_by_ubi|unassigned, weekGross (Money), remittance {due, covered,
status: covered|short|pending}, documents {status: valid|expiring|expired, nextExpiry}`.

`AssignmentTerms`: `vehicleId, driverId, type: weekly_fixed|percent_of_net, amountMinor (≤ city cap), percent,
shortfall {policy: carry_forward…}, shift`.

**Vehicle and driver data that exists today:** vehicle make/model/year/colour/plate/type/capacity/electric,
`insuranceExpiry`, `inspectionExpiry`; driver `licenseExpiry`, a **single** current `vehicleId`, online flag.
There is **no odometer / mileage feed** confirmed.

**The advance-booking calendar (built, running behind a flag).** Every driver-confirmed advance booking
reserves an **occupied interval** = pickup window start − pre-buffer … pickup window end + routed trip
duration + post-buffer. The database refuses two overlapping occupied intervals for the **same driver**,
and for the **same vehicle** once a vehicle is recorded on the booking (today no vehicle is recorded —
the fleet calendar is what will supply it). Consecutive bookings must also leave enough routed travel
time between one drop-off and the next pickup. Bookings live inside a bounded booking horizon, need a
driver **reconfirmation** shortly before pickup, and are **activated** into the driver's live queue a set
time before pickup. Booking states: `held → payment_pending | confirmed → reconfirmed → activated →
completed`, or `failed / cancelled` with an explained reason (withdrawal, eligibility loss, missed
reconfirmation, funding not secured). The driver app already has a **driver calendar** screen listing
the driver's own advance bookings.

**Live work:** a driver holds at most **one current job + one immediate queued job** across rides and
deliveries. Future bookings do not occupy that live slot until activation.

**Feature flag:** `fleet` exists and is **off by default**. Every fleet surface must render an honest
"not available" state when it is off.

### 1.3 Non-negotiable product rules

These are invariants, not styling. Every screen and flow must respect them; call out in annotations
where a screen enforces one.

1. **Driver consent.** A fleet may _propose_ assignments, shifts and terms. It may **never** accept a
   ride, place a bid, change earnings arrangements, or commit a driver's time on the driver's behalf.
   Changing material terms (remittance, shift pattern, vehicle) requires the driver's renewed PIN
   signature. A driver may decline with **no penalty, no score, no acceptance-rate metric**.
2. **Rider commitments are never silently changed.** A rider who selected a driver keeps that driver.
   A different driver or a different vehicle requires revalidation and, where the rider would notice
   (driver, vehicle class, capacity, pickup window), the **rider's explicit consent**. Never divert a
   current passenger to resolve a conflict.
3. **Fleet privacy.** Fleet owners and staff see vehicles, drivers on them, hours, gross, remittance
   status and document expiry. They **never** see rider identity or contact details, pickup/drop-off
   addresses or exact routes, or safety/Trust & Safety evidence. Show advance bookings to the fleet as
   **opaque time blocks** ("Booked · 07:15–09:40") with backend-computed feasibility results — no location
   by default. (If you think a coarse zone label is essential, propose it as an _open question_, not a
   default.)
4. **UBI decisions are status-only for fleets.** Identity holds, deactivation, document-expiry
   enforcement and suspensions are decided by UBI; the fleet sees the status ("Held by UBI") and its
   effect on availability, never the evidence or a way to override it.
5. **Money.** The standard driver commission is 10% of the commissionable fare, reserved at bid and
   captured once at the rider's selection; it comes from the driver's wallet by default. A fleet may
   sponsor commission only through an explicit, budgeted, journaled arrangement — **never both**
   parties charged. Remittance applies to the contractually defined base and is snapshotted per job
   (later term changes are not retroactive). Show UBI commission, fleet share and driver net
   separately. **Do not invent a fixed owner percentage.** Money is server-computed integer minor units
   in the city's currency; clients never calculate money.
6. **Server-authoritative feasibility.** Conflict detection, travel-time feasibility and availability
   are computed by the backend. Screens _show_ results and reasons; they never compute them.
7. **Honesty.** No sample drivers, vehicles or numbers presented as real. Fixture screens must be
   labelled as design references. Unknowns are shown as unknown ("not enough data"), never filled in.
8. **Time.** Everything is shown in the **city's local time with the timezone labelled**; storage is UTC
   with an IANA zone. Design for daylight-saving transitions even though most launch cities have none.
9. **Accessibility.** Status is never colour-only; every block and badge carries text. The timeline has
   a keyboard-navigable and screen-reader-friendly equivalent (e.g. an agenda/table view).

---

## 2. What to design

### A. The availability model (the core decision — design this first)

Propose how availability is represented, then design everything else on top of it. At minimum model:

1. **Vehicle availability** — in service; **maintenance block** (planned service, inspection, repair,
   unplanned off-road); document-expired (UBI-enforced, status-only); held by UBI (status-only);
   unassigned.
2. **Driver availability** — owned by the **driver** (availability windows, time off); fleet-proposed
   **shifts** the driver has signed; UBI holds (status-only).
3. **Assignment timeline** — which driver is paired with which vehicle over which intervals and shift,
   under which signed terms version. Assume several drivers can share one vehicle on different shifts,
   and that a driver may change vehicles over time (today's data model allows one vehicle per driver —
   flag the change as a backend dependency).
4. **Marketplace commitments** — advance bookings (opaque occupied intervals, including buffers) and
   "on a trip now".

Define precedence (what wins when layers overlap), what counts as a **conflict**, and the **resolution
path** for each conflict that respects rules 1–4. Examples you must cover:

| Conflict                                                                             | Must answer                                                                                     |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Maintenance block overlaps a confirmed advance booking on that vehicle               | Can the fleet create the block? What is shown _before_ confirming? What happens to the booking? |
| Two drivers on the same vehicle in overlapping shifts                                | Prevented at proposal time? How is it shown?                                                    |
| Vehicle document (insurance/inspection) expires inside a future booking window       | Warning timing, who acts, effect on the booking                                                 |
| Driver licence expires inside a future booking window                                | Same, driver-side                                                                               |
| Driver time-off overlaps a booking the driver committed to                           | Driver's own conflict — withdrawal path and explained outcome                                   |
| Proposed vehicle swap for a booking                                                  | Class/capacity must still fit; when is rider consent required?                                  |
| Fleet terminates an arrangement (2-week notice) with bookings beyond the notice date | What the driver and rider see                                                                   |
| UBI holds a driver or vehicle                                                        | Status-only effect for fleet; explained outcome for rider                                       |

For each conflict give: severity, who can resolve it (fleet / driver / rider / UBI), the allowed
actions, which consent each action needs, and the explained financial outcome where money is affected
(e.g. a withdrawn advance booking returns the driver's commission and releases the rider's funding).

### B. Fleet portal (Next.js, dark)

1. **Fleet calendar** — vehicle-row timeline, day and week zoom, "now" marker, city timezone label,
   layer toggles (assignments / maintenance / bookings / documents), filters (class, status, conflicts
   only), plate search, scales from 3 to ~200 vehicles.
2. **Driver-row view** of the same data (hours, shifts, bookings as opaque blocks).
3. **Vehicle detail** — availability, upcoming and past maintenance, documents with expiry plotted
   against upcoming commitments, assigned drivers and shifts, week gross and remittance status.
4. **Create / edit maintenance block** with an **impact preview** (affected assignments and bookings,
   opaque) and the resolution required before it can be confirmed. Planned maintenance can never
   silently cancel a booking.
5. **Conflict centre** — all open conflicts with severity, owner, deadline and actions.
6. **Propose assignment / shift change** → driver consent pending → signed / declined / expired, with
   the terms diff the driver will see.
7. **Utilisation** — online, on-trip, idle, booked-ahead and maintenance hours per vehicle, with metric
   definitions and data freshness shown. No invented benchmarks.
8. **Roles** — how owner vs manager vs read-only staff differ (the original fleet handoff named fleet
   staff roles; nothing is built).

### C. Driver app (React Native, dark-default)

1. **My schedule** — one view combining the driver's own availability, signed fleet shifts, advance
   bookings, and any vehicle maintenance that affects them.
2. **Review a fleet proposal** — shift/assignment/terms change with a clear diff; accept (PIN when terms
   change) or decline with "no penalty". Never actionable while driving.
3. **Maintenance or document impact on my bookings** — the choices available (keep booking on a
   swapped vehicle if revalidated and, where needed, rider-consented; or withdraw with the explained
   outcome).
4. **Set availability / time off** — and see which commitments it conflicts with before saving.

### D. Rider-facing moments (minimal)

Only where a fleet-side change reaches a rider's advance booking: e.g. "Your trip will use a different
vehicle (same class) — confirm or cancel free", or "Your driver can't make it — choose rematch at the
same fare or a refund". Reuse the existing Book-for-Later visual language; keep it to the states needed.

---

## 3. States and edge cases every surface must show

Loading · empty (new fleet, no vehicles) · error · offline / stale data (show last-updated time) ·
flag off ("not available yet") · permission denied (staff role) · held by UBI · conflicts present ·
consent pending / expired · document expiring / expired · a booking at risk · long timelines (DST
changeover day, week spanning a month boundary) · very large fleet (virtualised rows) · slow backend
feasibility check ("checking…", never optimistic success).

---

## 4. Return format — what to hand back

Return a bundle in the **same structure as the previous UBI handoff**:

1. **`README.md`** with these sections:
   - Overview and scope; fidelity statement.
   - Design system and tokens used (from the existing UBI tokens; dark variants for fleet portal and
     driver app).
   - **Global rules** (restate §1.3 as they apply to your screens).
   - **Availability model**: entities, fields, enums, and a **state machine per entity** (states,
     transitions, who triggers each, which consent each needs).
   - **Conflict matrix** (table from §2A, completed for every conflict type you define).
   - **Screens / views**, one subsection each, naming the target (Next.js fleet portal / React Native
     driver / rider), purpose, states, and the endpoint(s) it needs.
   - **Proposed API contract** — endpoints with request/response shapes and events, each marked
     **"proposed — backend to build"**; Money as `{amountMinor, currency}`; `Idempotency-Key` on every
     state-changing POST; the opaque booking-block shape the fleet receives (no rider or location data).
   - **Route → endpoint / event map** (quick-reference block, like the previous handoff).
   - **Backend dependencies** table (e.g. multi-vehicle drivers, maintenance store, odometer feed if you
     propose mileage-based maintenance, writing the vehicle onto advance bookings).
   - **Copy deck** — every string, per state, including the explained financial outcomes.
   - **Accessibility notes** — timeline keyboard model, screen-reader equivalent, text on every status.
   - **testIDs** following the existing convention `<app>.<screen>.<element>` in camelCase, e.g.
     `fleet.calendar.vehicleRow`, `fleet.maintenance.impactPreview`, `driver.fleet.scheduleView`,
     `driver.fleet.proposalAccept`.
   - **Open questions & assumptions** — every product decision you had to make, stated plainly so UBI
     can confirm or change it before engineering starts.
2. **`<name>.dc.html`** — the screen-flow board (all flows, every state, exception grid, handoff
   annotation strips with a show/hide toggle), plus any `support.js` it needs.

## 5. Definition of done for this design

- [ ] The availability model and conflict rules are explicit enough to implement database constraints
      from them without guessing.
- [ ] Every conflict type has a resolution path that never bypasses driver consent or rider consent,
      and never shows rider PII, locations or safety evidence to a fleet.
- [ ] No screen computes money or feasibility client-side; every figure names its server source.
- [ ] Every screen has loading / empty / error / offline / flag-off / permission states.
- [ ] Every proposed endpoint is marked proposed, and every backend dependency is listed.
- [ ] Open questions are listed rather than silently decided.
- [ ] Fleet portal slices are Next.js; driver and rider slices are React Native. No Flutter, no WebView.

## 6. Out of scope

Vehicle financing and marketplace listings; fleet KYB onboarding (already specified); payouts
statements beyond showing remittance status; live map tracking of vehicles; automated bidding or
dispatch by fleets (not allowed); pooled rides.
