# Claude Design brief — UBI notifications copy and the missing ops boards (D3)

Ubiquiti Mobility Inc. (UBI) · repository `artpromedia/ubi` · requested by engineering after the
round-9 audit (24 Sep 2026, gap register items **P1-06, P1-11, P1-13, P2-02, P2-03, P2-04, P2-12**).
This brief is self-contained: you do not need repository access.

## Why this brief exists

Two kinds of gap share one root cause: **things happen and the right person never finds out.**

1. **People.** Fleet events (a driver reports a breakdown, a document is about to expire, a proposal is
   signed, a conflict needs action) reach **nobody**. Riders are not told when a fleet vehicle swap needs
   their consent, or when a failed advance booking offers them a rematch or refund. And no app registers
   for push yet, so today only SMS fallbacks reach anyone.
2. **UBI ops.** The admin console cannot see off-road abuse flags, failed notifications, or airport
   transfers that need action, and its policy page can only "Stop new awards", with no confirmation,
   no reason and no way back.

Engineering will build the delivery plumbing. **What we need from you** is the **copy and interaction
design**: who is told what, on which channel, with what words, and the ops boards that show what went
wrong. Deliver it in the same handoff format as the previous UBI handoffs (see _Return format_).

> If you have the previous handoff bundles (marketplace/travel/AI or fleet calendar: README +
> `.dc.html` board + `support.js`), use them as the visual and structural reference. Match their tokens,
> board style and README structure. Do not introduce a new design system.

---

## 1. Context you need

### 1.1 Channels that exist

| Channel                                     | Today                                                                                                                        | Rules                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Push** (FCM)                              | Built server-side; **no app registers a device yet** (engineering is adding it).                                             | Payload may carry only ids and a kind; never money, names, locations or photos. Title + body copy per role. |
| **SMS** (Africa's Talking, Twilio fallback) | Used as a fallback for a few critical events, only to the user's own verified number, only if they allow critical-alert SMS. | Short, no links except UBI's own, no PII of other people.                                                   |
| **In-app inbox**                            | Exists (list, read, mark all read, badge) but nothing writes to it yet.                                                      | Can carry more detail than push; still no other party's PII.                                                |
| **Web portal notices** (fleet portal)       | None.                                                                                                                        | Owners/managers of the fleet only.                                                                          |

There is **no email channel** and **no localisation** yet (English only). If you believe a language
beyond English is needed for launch, list it as an open question.

### 1.2 Who can be addressed

Rider (requester), driver, sender (delivery), traveller (airport transfer) today. Engineering will add
**fleet owner** and **fleet manager** (from the fleet's staff list) and **UBI ops**. Read-only fleet
staff receive nothing actionable.

### 1.3 Events that need copy (all exist; payloads carry ids, states and reasons)

**Fleet → fleet owners/managers (portal notice + push; SMS only where marked critical):**

- `fleet.alert` (driver reported `cannot_drive` → vehicle off-road now; or `service_soon` → schedule
  planned maintenance). **Critical** for `cannot_drive`.
- `fleet.offroad.reported`, `fleet.offroad.flagged` (UBI flagged the vehicle as used while reported
  off-road — ops-facing; the fleet sees status only).
- `fleet.conflict.opened` / `resolved` / `lapsed` / `reminder_sent` — types: maintenance overlaps a
  booking, unplanned off-road, document expiring, document expires inside a booking, driver resolving,
  termination with bookings. Each has a severity and a deadline.
- `vehicle.document.expiring` (30/14/7/1 days, or a booking after expiry) and `.expired` (vehicle
  becomes `doc_expired`).
- `assignment.proposal.status.changed` (signed / declined / expired), `assignment.signed`,
  `assignment.status.changed` (notice given, ended), `maintenance.status.changed`,
  `fleet.staff.changed`, `fleet.vehicle_swap.requested`.
- A **persistent "service soon" notice** in the fleet's conflict centre (today `service_soon` leaves no
  record the fleet can act on) — design where it lives and how it is dismissed or turned into a planned
  maintenance block.

**Fleet → driver (push; in-app):** a new proposal to review; proposal expiring; a conflict on one of
their bookings with its deadline; the fleet's reminder; arrangement notice started/ended; vehicle
swap proposed for their booking.

**Marketplace → rider (push; SMS where marked):**

- `mp.advance_booking.choice_offered` — a booking failed before pickup; the rider may take a
  **same-fare rematch** (only when offered) or a **refund**; the rider chooses; nothing is rebooked
  without them. Two variants. **Critical (SMS).**
- `mp.advance_booking.failed` reason "risk unresolved" (a fleet vehicle problem was not resolved in
  time) — one clear message, not two (coordinate with choice_offered).
- `mp.vehicle_swap.rider_consent_requested` — the booking will use a different vehicle; the rider must
  **confirm the new vehicle or cancel free**; nothing changes until they confirm. **Critical.** Also
  `applied`, `rider_declined`, `expired`.

**Marketplace → driver:** `mp.advance_booking.risk_changed` (your booking is at risk because of a
vehicle problem; resolve by the deadline).

**Delivery → sender:** return proposed (exists), plus the custody outcomes (see the separate delivery
brief D2 for screens; here only notification copy).

### 1.4 Ops facts for the boards

- **Off-road abuse flags**: raised when a vehicle reported off-road goes online or starts a trip during
  the claimed breakdown: vehicle, driver, trigger (`driver_online` | `trip_started`), observed time,
  the off-road report (who reported, when). One flag per occurrence. Ops need to review and decide
  (dismiss / warn fleet / escalate to standing). Fleets never see ops notes.
- **Notification failures**: failed pushes/SMS are kept in dead-letter lists with the event id, name,
  audience role, reason (e.g. `audience_unresolved`, provider error, invalid token) and time; separate
  list for the passenger trip-link SMS. Ops need a list, a detail view, and **replay** (idempotent) or
  **discard** with a reason.
- **Airport transfers**: travel orders can have linked ride "transfers" in states such as
  `action_required` and `failed`; ops can only see the caller's own today. Ops need a city-wide list
  with filters and the next action.
- **Config and flags**: a city's config changes through **change requests** (author + reason; **two
  distinct approvers** other than the author activate a new immutable version). A flag flip (including
  the **`marketplace_rides` kill switch** that stops new awards in a city) is **single-actor, reason
  required, audited**. There is no list of pending change requests and no reject/cancel today
  (engineering will add them). The current page has a single "Stop new awards" button with no
  confirmation, a fixed reason and no re-enable.

### 1.5 Non-negotiable rules

1. **Minimum necessary.** No notification carries another person's name, phone, address, location,
   photo, or anyone's money beyond the recipient's own. A rider never sees a driver's commission; a
   fleet never sees rider data or a driver's net.
2. **One clear message per decision.** When a decision is needed, say what happened, what the choices
   are, the deadline, and what happens if nothing is chosen. No duplicate pushes for one decision.
3. **Consent language is exact.** "Nothing changes until you confirm" only when that is true; money
   outcomes are stated exactly (held / captured / released / refunded / not charged).
4. **Neutral copy.** Never assume a gender; use the person's name or "they/their".
5. **Quiet hours and preferences.** Respect the user's category preferences; critical SMS only where
   marked. Propose quiet-hours behaviour as an open question.
6. **Ops actions are audited**, need a reason, and show who did what; destructive or city-wide actions
   (kill switch, replay-all) need a confirmation that names the city and the effect.
7. **Accessibility.** Status is never colour-only; tables have text equivalents; keyboard operable.

---

## 2. What to design

### A. Notification copy deck (the main deliverable)

A table per event × audience × channel: title, body, in-app detail, deep-link target, SMS text (only for
critical), and the variants by reason/state. Include the push permission ask and the "notifications are
off" state in both apps (one screen each, reusing the existing permissions pattern).

### B. Fleet portal notices

A notices area (bell / panel / conflict-centre integration) for owners and managers: unread, read,
acted-on; the persistent **service soon** notice and its "Plan maintenance" action; critical banners
(vehicle off-road now).

### C. Admin console boards (Next.js)

1. **Off-road abuse flags** — list, filters (city, fleet, trigger, status), detail with the timeline of
   the report and the flag, decision actions with a reason.
2. **Notification failures** — push and trip-link SMS dead letters: list, filters, detail, replay /
   discard (single and bulk, idempotent, confirmed), counts over time.
3. **Airport transfers needing action** — city-wide list by state with next action and links to the
   travel order and the ride request.
4. **Config & flags console** — pending change requests (author, diff, reason, approvals so far),
   approve (with an optional note), reject/cancel with a reason; flag list per city with flip (reason
   required); the **kill switch**: stop new awards and **resume** them, each with a confirmation naming
   the city and effect, a required reason, and the audit history.

---

## 3. States and edge cases

Loading · empty · error · stale data · permission denied (non-ops role) · replay already done ·
change request already approved by you · author trying to approve their own change · kill switch
already stopped / resumed · a notification whose subject no longer exists · a user with notifications
off · SMS not allowed by preference.

---

## 4. Return format — what to hand back

Return a bundle in the **same structure as the previous UBI handoffs**:

1. **`README.md`** with: overview and scope; fidelity statement; tokens; **global rules** (§1.5 as
   applied); the **copy deck** (every event × audience × channel, with variables named, e.g.
   `{plate}`, `{deadlineLocal}`, `{amount}` — never another person's PII); **screens / views** (fleet
   portal notices, admin boards, app permission states), one subsection each with states and the
   endpoint(s) they need; **proposed API additions** marked **"proposed — backend to build"** (ops
   reads and actions for flags, dead letters, transfers, change requests), `Idempotency-Key` on every
   state-changing POST; **backend dependencies**; **accessibility notes**; **testIDs** in the
   `<app>.<screen>.<element>` camelCase convention (e.g. `admin.offroadFlags.row`,
   `admin.notificationFailures.replay`, `admin.config.killSwitchResume`, `fleet.notices.planMaintenance`);
   **open questions & assumptions**.
2. **`<name>.dc.html`** — the board (copy deck view, portal notices, admin boards, every state), with
   handoff annotation strips and a show/hide toggle, plus any `support.js` it needs.

## 5. Definition of done for this design

- [ ] Every event in §1.3 has copy for every audience that should hear about it, and an explicit "not
      notified" note for those who should not.
- [ ] No copy carries another person's PII or money the recipient should not see.
- [ ] Decision notifications state choices, deadline and default outcome, once.
- [ ] Every admin board has list / detail / action / audit and loading / empty / error / permission
      states; city-wide actions are confirmed and reasoned.
- [ ] Every proposed endpoint is marked proposed; open questions are listed.

## 6. Out of scope

Email and marketing messages; growth campaigns; localisation beyond English (open question only);
notification analytics dashboards beyond the failure counts above.
