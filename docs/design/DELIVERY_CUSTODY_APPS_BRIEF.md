# Claude Design brief — UBI marketplace delivery in the apps: custody, proof, returns (D2)

Ubiquiti Mobility Inc. (UBI) · repository `artpromedia/ubi` · requested by engineering after the
round-9 audit (24 Sep 2026, gap register item **P1-07**). This brief is self-contained: you do not need
repository access.

## Why this brief exists

UBI's negotiated-fare marketplace already handles **deliveries** on the server: a sender posts a
delivery request, drivers send private offers, the sender chooses one, and the delivery is handed to
the delivery service, which tracks **custody** of the parcel from pickup to drop-off (or back to the
sender) with **verified photo proof**. All of that is built and tested server-side, but **the phones
have almost nothing**:

- The **driver app** has no delivery job screen, no pickup/drop-off flow and no way to capture or upload
  proof. Its "Continue current trip" button opens the ride screens even for a delivery.
- The **rider (sender) app** has one deep-linked "return" sheet that no screen links to, and nothing
  after a delivery offer is accepted.

Engineering will not guess these flows: custody moves money (return fees) and evidence (photos), so
getting them wrong either loses parcels or charges senders unfairly.

**What we need from you:** the product and interaction design for delivery execution in both React
Native apps, delivered in the same handoff format as the previous UBI handoffs (see _Return format_).

> If you have the previous handoff bundles (marketplace/travel/AI, or the fleet calendar: README +
> `.dc.html` board + `support.js`), use them as the visual and structural reference. Match their tokens,
> board style, annotation strips and README structure. Do not introduce a new design system. The
> original launch board already has Send screens (6e–6g create / pickup code / delivery code, 14c
> recipient unavailable, 14d damage claim); treat those as visual precedent only, because the rules
> below supersede them where they differ.

---

## 1. Context you need

### 1.1 The product

- **Senders** are riders who send a parcel. They use the **rider app** (React Native, light-default).
- **Drivers** use the **driver app** (React Native, dark-default). A driver holds at most **one current
  job + one queued job** across rides and deliveries.
- A delivery is **single drop-off** (no multi-stop). The sender chose the driver and agreed the fare.
- The standard driver commission (10%) was **captured once** when the sender accepted the offer. Nothing
  in custody changes it.
- No Flutter, no WebView.

### 1.2 What already exists — design around it, do not redesign it

**Custody states the phones can actually observe** (the server stores only the final state of each
step):

| State                                                        | Meaning                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `courier_assigned`                                           | The driver has the job; parcel not yet collected.                                  |
| `in_transit`                                                 | Pickup proof accepted; parcel with the driver.                                     |
| `recipient_unreachable`                                      | The driver attempted delivery and could not hand over.                             |
| `return_proposed`                                            | Sender or driver proposed a return; waiting for the sender (24 h window).          |
| `returning`                                                  | Return approved and a fee is held; the driver is bringing it back.                 |
| `held_at_point`                                              | Sender rejected the return, or the 24 h window lapsed; parcel held for collection. |
| `delivered` · `return_to_sender` · `collected` · `cancelled` | Final states.                                                                      |

**Server actions (all exist; each returns a short result):**

| Action                 | Who                     | Notes                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read custody timeline  | sender, assigned driver | state, version, open return (fee, consent state, deadline), return policy (`chargedReturnsOffered`, `feeFreeOnly`), proofs (metadata only: type, time, verified) and the event history (from → to, actor type, reason, time). **No addresses, package details or recipient contact** — see §1.4.                                                          |
| Request a proof upload | driver                  | Declares type (`pickup` / `delivery` / `return`), image type (JPEG/PNG/WebP), size (≤ 15 MB) and a SHA-256 of the photo; gets a short-lived upload URL (≈5 min) and PUTs the image directly to private storage. Max 6 open uploads.                                                                                                                       |
| Attach pickup proof    | driver                  | `courier_assigned` → `in_transit`. The server re-checks size, hash and image type; a mismatch rejects the photo with a named reason.                                                                                                                                                                                                                      |
| Attach delivery proof  | driver                  | → `delivered` (also from `recipient_unreachable`: this is the only "try again" path, and only the driver can do it).                                                                                                                                                                                                                                      |
| Recipient unreachable  | driver                  | From `in_transit`, optional reason.                                                                                                                                                                                                                                                                                                                       |
| Propose a return       | sender or driver        | Reason required; a **fee** (0 < fee ≤ agreed fare) only when charged returns are offered in that city. The proposer sets the fee; there is no server-computed fee.                                                                                                                                                                                        |
| Respond to a return    | **sender only**         | `consent` or `reject`. Consent to a fee-free return completes the return on the record immediately. Consent to a fee **holds the fee on the sender's wallet** (402 if funds are insufficient); the driver completes the return with a return photo, and only then is the fee captured and paid to the driver. Reject (or 24 h silence) → `held_at_point`. |
| Complete a return      | driver                  | Attaches a `return` photo; `returning` → `return_to_sender`.                                                                                                                                                                                                                                                                                              |
| Mark collected         | driver or ops           | From `held_at_point`, `recipient_unreachable` or `return_proposed`.                                                                                                                                                                                                                                                                                       |
| View a proof photo     | sender, driver, ops     | Short-lived (≈60 s) private URL; never cached.                                                                                                                                                                                                                                                                                                            |
| Cancel a held fee      | ops only                | Not a phone action.                                                                                                                                                                                                                                                                                                                                       |

**Return fee charge states:** `not_required`, `unsupported`, `authorization_required`, `reserving`,
`reserved`, `capture_pending`, `captured`, `released`. Charged returns are **off by default** per city;
when off, every return is fee-free and the screen must say so.

**There is no recipient app, no delivery PIN/code and no signature on the custody path today.** The
recipient is not a UBI user. If you believe a handover code or a recipient confirmation is needed,
propose it as an **open question with its backend dependency**, not as a default.

**Notifications that exist:** the sender gets a push/SMS when a return is proposed ("Approve a return
fee" / "Return proposed for your delivery"). Nothing else is sent yet.

**Flag:** `marketplace_delivery` is **off by default**. Every surface needs an honest "not available yet"
state.

### 1.3 Non-negotiable product rules

1. **Evidence is private.** Proof photos are visible only to the sender, the assigned driver and UBI
   ops. Never show another party's photos; never show a photo inline in a notification.
2. **The sender decides returns.** The driver may propose a return; only the sender can consent,
   reject or let it lapse. Nothing is returned, charged or held without the sender's explicit consent.
3. **Money.** Fees are server-computed integer minor units in the city's currency, shown with the
   currency. The phone never computes a fee. The driver's commission is not touched by a return. A fee
   is held at consent, captured only after the return photo, and released if it never completes. Say
   exactly which of these has happened.
4. **Driver safety.** Photo capture and every custody action happen **only when the vehicle is
   stationary** (the app already locks bidding while moving — reuse that lock). Never ask a driver to
   type while driving.
5. **Honesty.** No invented tracking, ETA, map pin or recipient details the server does not return.
   Unknown is shown as unknown. Fixture screens are labelled as design references.
6. **No dark patterns** around fees: the fee, who receives it, and the alternative (hold for
   collection) are shown before the sender approves.
7. **Accessibility.** Status is never colour-only; every state has text; the camera flow has a
   non-camera fallback path described (e.g. retry, contact support), and all controls have labels.

### 1.4 Backend gaps you must design around (engineering will build them)

- **No delivery detail read for the phones yet**: pickup and drop-off addresses, package description,
  size/weight class, and the drop-off contact's name/phone are not available to the apps through the
  current routes. Design the screens that need them and list each field as a **backend dependency**.
  Decide (as an open question) what the driver may see and when — e.g. the drop-off contact's phone only
  while `in_transit`, masked or relayed.
- **Handover to the recipient** has no code or confirmation step (see §1.2).
- **Sender-side cancellation** before pickup is not on the custody path.

---

## 2. What to design

### A. Driver app (React Native, dark-default)

1. **Delivery job card and detail** — reached from the jobs timeline and "Continue current job" (which
   must open this, not the ride screens): pickup, drop-off, package, agreed fare, the custody state and
   the next action.
2. **Pickup** — arrive → take pickup photo → upload progress → server verification → `in_transit`.
   Every failure: upload expired, too large, checksum mismatch, wrong image type, storage unavailable,
   offline, 6 uploads open.
3. **Drop-off** — take delivery photo → verified → delivered.
4. **Recipient unreachable** — record the attempt (with an optional reason) → the options that follow:
   try again (delivery photo later), propose a return (with a fee only when offered), or hold for
   collection. Show the 24 h sender window and what happens when it lapses.
5. **Returning** — the approved return, fee status, then the return photo → `return_to_sender`.
6. **Held at point / collected.**
7. **Proof gallery** for the job (the driver's own photos, via short-lived URLs).

### B. Rider (sender) app (React Native)

1. **After the sender accepts a delivery offer** — what they see instead of the ride hand-off
   (today nothing happens).
2. **Delivery status** — the custody timeline in plain language, with proofs (tap to view) and the
   current state.
3. **Return proposed** — the reason, who proposed it, the fee (or "no fee"), who receives it, the
   deadline, and the three choices: approve (with a wallet hold), keep it at a collection point (reject),
   or do nothing (lapses to held at point). Handle **insufficient funds (402)** with a path to add money
   that is honest when top-up is unavailable.
4. **Returning / returned / held for collection / collected / cancelled** — each with the explained
   money outcome (fee held, captured, released, or none).
5. **Deep link and push entry** into each of these states.

### C. The explained outcomes (copy)

For every final state and every return path, write the one-line outcome for sender and driver, e.g.
"Returned to you. The ₦1,500 return fee was paid to your driver." / "Held for collection. No fee was
charged."

---

## 3. States and edge cases every surface must show

Loading · error · offline (queued upload, retry) · flag off · stale timeline (last-updated time) · a
concurrent change (someone else moved the state: "this delivery was updated", reload) · upload
rejected with each named reason · storage not configured (honest "photo upload isn't available") ·
charged returns off vs on · fee held / capture pending / captured / released · consent window
expiring and expired · a delivery that is cancelled before pickup · a job the driver no longer holds.

---

## 4. Return format — what to hand back

Return a bundle in the **same structure as the previous UBI handoffs**:

1. **`README.md`** with: overview and scope; fidelity statement; tokens used; **global rules** (§1.3
   as applied); the **custody flow** per role with the state each screen reads; **screens / views**, one
   subsection each (target app, purpose, states, the server action it uses); **proposed API
   additions** marked **"proposed — backend to build"** (the delivery detail read and anything else you
   need), with Money as `{amountMinor, currency}`; a **route → action map**; **backend dependencies**;
   a **copy deck** for every state and outcome; **accessibility notes** (camera fallback, labels);
   **testIDs** in the existing `<app>.<screen>.<element>` camelCase convention (e.g.
   `driver.delivery.pickupPhoto`, `driver.delivery.uploadRetry`, `rider.delivery.returnApprove`);
   **open questions & assumptions**.
2. **`<name>.dc.html`** — the screen-flow board (every flow, every state, an exception grid, handoff
   annotation strips with a show/hide toggle), plus any `support.js` it needs.

## 5. Definition of done for this design

- [ ] Every custody action a phone performs maps to one server action in §1.2 (or a listed proposed
      one), and every observable state has a screen.
- [ ] No screen shows data the server does not return; each missing field is a listed dependency.
- [ ] Returns never happen, and fees are never held or charged, without the sender's consent, and
      every money outcome is explained.
- [ ] Proof photos are only visible to the sender, the driver and ops.
- [ ] Driver actions are stationary-only; loading / error / offline / flag-off states exist everywhere.
- [ ] Both apps are React Native. No Flutter, no WebView.

## 6. Out of scope

Recipient-facing app or web page (propose only as an open question); multi-stop deliveries; damage
claims and insurance; merchant/business delivery consoles; live map tracking; ops-side fee
cancellation screens.
