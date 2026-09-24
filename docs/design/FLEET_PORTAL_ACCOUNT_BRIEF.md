# Claude Design brief — UBI fleet portal account surfaces: sign-in, onboarding & KYB, vehicle documents, remittance statement (D1)

Ubiquiti Mobility Inc. (UBI) · repository `artpromedia/ubi` · requested by engineering after the
round-9 audit (24 Sep 2026, gap register items **P1-03, P1-05, P1-09, P1-12**). This brief is
self-contained: you do not need repository access.

## Why this brief exists

The fleet portal's **calendar** is designed and built (screens B1–B9 from the fleet availability
calendar handoff). What is missing is everything **around** the calendar that a real fleet business
needs before it can use it:

1. **Signing in.** The portal has no sign-in at all; the admin console's sign-in is a placeholder too.
2. **Becoming a fleet.** Today a fleet is created by name only and is active immediately. There is no
   business verification (KYB), no documents, no review by UBI, and no way to invite staff other than
   typing an internal user id.
3. **Vehicle documents.** Insurance and inspection expiry drive the whole calendar's warnings and
   conflicts, but **nothing can write them**: there is no upload, no review and no renewal. The portal's
   "Upload renewal" action currently says it isn't available.
4. **Seeing money.** The vehicle page has four money lines (week gross, UBI commission, fleet
   remittance, remittance status) that all say "Not available yet", and there is no weekly statement.

The earlier calendar brief listed KYB and payout statements as out of scope. They are now in scope.

**What we need from you:** product and interaction design for these surfaces, in the same handoff
format as the previous UBI handoffs (see _Return format_).

> If you have the fleet calendar handoff (`design_handoff_fleet_availability_calendar`: README +
> `.dc.html` board + `support.js`) or the earlier marketplace/travel/AI handoff, use them as the visual
> and structural reference: same tokens (fleet portal is dark), board style, annotation strips and README
> structure. Do not introduce a new design system.

---

## 1. Context you need

### 1.1 The product and the people

- **UBI** is a mobility marketplace in African cities (launch city Lagos; currency NGN; money in integer
  minor units).
- A **fleet** is a business that owns vehicles and places UBI drivers in them under **terms the driver
  signs with a PIN** (weekly fixed remittance or a percentage of net, capped by city policy).
- **Fleet staff** have one of three roles inside a fleet: **owner** (everything, including staff,
  remittance terms and money), **manager** (vehicles, maintenance, assignments under existing terms,
  vehicle documents), **read-only**. A fleet must always keep at least one owner.
- Every fleet staff member is a **UBI user** (they have a UBI account; staff are linked by user).
- The fleet portal is a **Next.js web app (dark theme)**. Staff use desktop or tablet browsers.
- **UBI ops** review verification and documents in the **admin console** (Next.js).
- The feature flag `fleet` is **off by default** per city; every surface needs an honest "not available
  yet" state.

### 1.2 What exists today — design around it

**Sign-in (UBI accounts):**

- Riders and drivers sign in by **phone number + SMS one-time code**. A **device** is enrolled on
  sign-in. A device UBI already trusts signs in normally; a **new device** gets a **limited** session
  (reads only, nothing that moves money or changes security) until a **step-up** passes: approve from an
  already-trusted device, or a selfie + national ID (NIN) check.
- Password sign-in exists only for accounts that set a password through an email reset link.
- Sessions: a short-lived access token (15 min) plus a refresh token; logout ends all sessions.
- The session must carry the user's **city**: fleet tools refuse a session without one.
- Engineering's recommended default (decision DEC-4): **the same phone + code sign-in as the apps**,
  with the limited-session / step-up model. Propose otherwise only as an open question with reasons.

**Staff management:** the owner replaces the staff list (user + role); removed staff are kept as
history. There is **no invitation flow**. A reusable pattern exists elsewhere in UBI (organization
invitations for business travel): invite by **phone number + role**, the invitee accepts or declines,
invitations can be revoked, and they expire; an invite to a phone with no UBI account is refused.

**Fleet record:** name, city, currency, zone, status (`active` | `suspended`), created by. A suspended
fleet can read but not write. The original UBI fleet spec intended KYB fields such as **legal name,
company registration number (CAC RC in Nigeria), tax id (TIN)**, a status and an approval time, and a
**vehicle documents** table (vehicle, type, file, expiry, status). The exact per-city list of KYB
requirements is **a UBI ops/legal decision** (DEC-5): design for a configurable list with Lagos
examples, clearly marked as examples.

**Vehicle record:** plate, make, model, year, colour, class, capacity, electric,
**insurance expiry**, **inspection expiry**. Adding a plate today creates a vehicle with **no
expiries** ("documents pending").

**Documents pattern that exists for drivers:** a driver submits a document (type, a stored file
reference, expiry date); it starts **pending**; UBI ops review it as **valid** or **rejected** with a
note; an expiry sweep warns at **30 / 14 / 7 / 1 days** and marks it **expired** at the date. An
already-expired date is refused. Vehicle document types that exist for drivers: insurance,
roadworthiness (inspection), vehicle registration.

**Photo/file upload pattern that exists (deliveries):** the client asks the server for a short-lived
**presigned upload URL** for a declared file type, size and checksum, uploads directly to private
storage, then attaches the upload; the server re-checks the file and rejects mismatches with a named
reason. Files are viewable only through short-lived private links.

**Document effects in the calendar (already built):** warnings at 30/14/7/1 days and immediately when a
booking falls after an expiry; at expiry the vehicle is `doc_expired` (status only, UBI-enforced);
conflicts `document_expiring` and `document_expires_in_booking` offer **"Upload renewal"**, which must
now lead to your renewal flow. A new expiry date resolves those conflicts.

**Money that exists:**

- The driver's 10% commission is captured once per job from the driver's wallet.
- Each (assignment, week) settles **once** into one journal entry that moves the remittance from the
  driver's wallet to the fleet's wallet. The settlement record has: terms type and version, shift and
  planned-maintenance hours (planned maintenance pro-rates weekly fixed remittance; breakdowns do not),
  amount due, whether the city cap applied, carry-in, amount collected, refunded, shortfall and
  carry-forward, and whether the driver's wallet was locked. **It has no gross or commission field**;
  those would come from the driver-side ledger and exclude cash fares and tips.
- The fleet's wallet has **no cash-out rail yet**.
- **Decided (Q7): fleets see gross, UBI commission, their own remittance and its status — never a
  driver's net earnings.** Caution: under `percent_of_net` terms, remittance ÷ percent reveals net.
  Treat how to present percent-of-net remittance as an **open question** (engineering's suggestion:
  never display net or a per-trip breakdown, accept that the fleet knows its own signed percent).

### 1.3 Non-negotiable product rules

1. **Staff act for the fleet, never for drivers.** Nothing here lets a fleet accept work, sign terms or
   see a driver's net for them. Driver consent (PIN) stays on the driver's phone.
2. **UBI decisions are status only.** KYB approval, document validity and suspensions are decided by UBI
   ops; the fleet sees the status, the reason UBI chose to share, and what it can do next — never
   internal evidence or a way to override.
3. **Privacy.** Fleet screens never show rider identity, locations or a driver's net earnings.
   Documents are visible to the fleet's owners/managers and UBI ops only.
4. **Money** is server-computed integer minor units with the currency; the portal never computes it;
   every figure names its source and "as of" time; unknown is shown as unknown.
5. **Honesty.** Pending review is never shown as verified; fixture screens are labelled design
   references; no invented approval times.
6. **Security.** Sign-in and staff changes are audited; a new browser gets a limited session until
   step-up; removing the last owner is impossible; ownership transfer needs the new owner's acceptance.
7. **Accessibility.** Status is never colour-only; forms have labels and error text; the upload flow
   works by keyboard.

---

## 2. What to design

### A. Console sign-in (fleet portal; the same pattern reused for the admin console)

Phone entry → code → device check → **limited session** state (what is visible, what is locked, how to
step up) → full session. Session expiry and refresh, sign-out, "signed out elsewhere", no city on the
account, account suspended, fleet flag off. Show the **admin console** variant (same flow, admin
branding, admin-only roles) as a sibling screen.

### B. Fleet onboarding and KYB

1. **Create a fleet** (from a signed-in UBI account): business details per the city's requirement list,
   documents (upload), declarations, submit.
2. **Pending review** state: what the fleet can do meanwhile (e.g. add vehicles as drafts; no
   assignments), what it cannot.
3. **Changes requested / rejected / approved / suspended** states, with UBI's shared reason and the
   next action.
4. **UBI ops review screen** in the admin console: the application, documents (private links),
   checklist, approve / request changes / reject with a reason; audit trail.

### C. Staff invitations

Invite by phone + role; pending / accepted / declined / expired / revoked; the invitee's acceptance
screen (after sign-in); role change; remove; **ownership transfer**; the last-owner rule.

### D. Vehicle documents

1. **Add vehicle** with its documents (insurance, inspection/roadworthiness, registration — per city
   list) and expiry dates.
2. **Upload / renew** a document (from the vehicle page and from a calendar conflict's "Upload
   renewal"): pick file → upload progress → submitted (pending review) → valid / rejected (with UBI's
   note).
3. **Document list per vehicle** with status, expiry, history, and the calendar effect of each state.
4. **UBI ops document review** (admin console): queue, document viewer, valid / reject with a note.

### E. Money

1. The **vehicle page money panel** (four lines) with real values, "as of", and the unknown/partial
   states (e.g. "excludes cash fares").
2. A **weekly remittance statement** per fleet and per assignment: due, pro-rated hours, cap applied,
   collected, shortfall, carried forward, refunded, status, journal reference; closed-week adjustments.
3. The **fleet wallet** balance with an honest "cash-out not available yet".

---

## 3. States and edge cases every surface must show

Loading · empty · error · offline / stale (last-updated time) · flag off · permission denied (role) ·
limited session · KYB pending / changes requested / rejected / suspended · document pending / valid /
rejected / expiring / expired · upload failures (too large, wrong type, checksum mismatch, link expired,
storage unavailable) · invitation expired or revoked · last owner · money unavailable / partial ·
closed week adjusted.

---

## 4. Return format — what to hand back

Return a bundle in the **same structure as the previous UBI handoffs**:

1. **`README.md`** with: overview and scope; fidelity statement; tokens (dark fleet portal, admin
   console); **global rules** (§1.3 as applied); **state machines** for KYB application, staff
   invitation and vehicle document (states, transitions, who triggers each); **screens / views**, one
   subsection each (target app — fleet portal or admin console — purpose, states, endpoint(s));
   **proposed API contract** marked **"proposed — backend to build"** (KYB application, invitations,
   document upload/review, fleet money reads), Money as `{amountMinor, currency}`, `Idempotency-Key` on
   every state-changing POST; a **route → endpoint map**; **backend dependencies**; a **copy deck** for
   every state; **accessibility notes**; **testIDs** in the `<app>.<screen>.<element>` camelCase
   convention (e.g. `fleet.signIn.codeInput`, `fleet.kyb.submit`, `fleet.documents.uploadRenewal`,
   `admin.fleetReview.approve`); **open questions & assumptions** (including percent-of-net
   presentation and the Lagos KYB list).
2. **`<name>.dc.html`** — the screen-flow board (every flow and state, exception grid, handoff
   annotation strips with a show/hide toggle), plus any `support.js` it needs.

## 5. Definition of done for this design

- [ ] Sign-in works with phone + code and the limited-session / step-up model, and names what a limited
      session can do.
- [ ] KYB, invitation and document state machines are explicit enough to build tables and endpoints
      from without guessing.
- [ ] UBI decisions are status-only for fleets; ops review screens exist for KYB and documents.
- [ ] No screen shows a driver's net earnings, rider data or locations; money names its source.
- [ ] Every screen has loading / empty / error / offline / flag-off / permission states.
- [ ] Every proposed endpoint is marked proposed; open questions are listed, not silently decided.
- [ ] Fleet portal and admin console are Next.js; nothing is a native app or WebView.

## 6. Out of scope

Vehicle financing and listings; fleet invoices and tax statements; a fleet mobile app; telematics and
odometer; cash-out rails (show as unavailable); anything in the calendar handoff (B1–B9) beyond linking
into it.
