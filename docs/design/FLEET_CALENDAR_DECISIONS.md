# Fleet availability calendar — product decisions and engineering corrections

This file turns the vendored Claude Design handoff
(`docs/launch-readiness/handoff-fleet-calendar/`, answering
`docs/design/FLEET_AVAILABILITY_CALENDAR_BRIEF.md`) into a build contract. Where
this file and the handoff disagree, **this file wins**. Nothing here is
implemented yet; the `fleet` flag stays off.

Decided by UBI on 23 Sep 2026.

## Product decisions (the handoff's open questions)

| #          | Question                                     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1         | Zone label on booking blocks shown to fleets | **Fully opaque.** Fleets see `Booked · 07:15–09:40` plus the server's risk flag, and nothing else. Travel-time feasibility is computed server-side, so fleets never need a location.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Q2         | Remittance for hours lost to maintenance     | **Pro-rate for fleet-scheduled downtime.** A `weekly_fixed` remittance is reduced pro rata for the hours a vehicle is in a **planned** maintenance block (planned service, inspection, repair), because the fleet chose that downtime. `percent_of_net` needs no change (no earnings, no remittance). **Unplanned off-road** (breakdown) follows the signed terms' shortfall rule. The pro-rata basis is the signed shift's hours in the settlement week; the adjustment is a server-computed, journaled line on the remittance, never a client calculation, and never retroactive to a closed week. |
| Q3         | Rider consent for a same-class vehicle swap  | **Always required.** Riders check the plate at pickup for safety, so any vehicle change on an advance booking needs the rider's "Confirm new vehicle" or a free cancel.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Fleet view | What fleets see about their drivers          | **No driver net.** Fleets see hours, shifts, gross, UBI commission, their own remittance and its status. A driver's time off appears to the fleet only as an unexplained **"Unavailable"** block (not labelled "time off"). A driver's net earnings stay private to the driver.                                                                                                                                                                                                                                                                                                                      |

Accepted as designed (the handoff's assumptions; not contradicted):

- **Q4** Resolution deadline = the earlier of the booking's reconfirmation time
  and activation − 30 min (engineering makes this a per-market policy value).
- **Q5** Owners and managers may report a vehicle off-road.
- **Q6** Document-expiry warnings at 30 / 14 / 7 / 1 days, and immediately
  whenever a booking falls after an expiry date.
- **A1–A6** as written in the handoff: planned maintenance is never confirmed
  over a booking; unplanned off-road only sets bookings `at_risk`; proposals
  never count as availability; driver time off outranks a fleet shift; swap
  eligibility is same-or-higher class and at-least-equal capacity at an
  unchanged fare; utilisation needs 7 days of data; maintenance is time-based
  only.

## Engineering corrections to the handoff

1. **Commission wording.** An advance booking's commission is **captured** at
   the advance award, not held as a reserve. Withdrawal copy says "Your
   {amount} commission is returned to your wallet", and the server performs
   the linked reversal of the captured commission (never a re-charge).
2. **Rematch is conditional.** The server offers a rematch only when enough
   lead time remains (`rematchAvailable`). The driver's withdraw outcome and
   the rider's D2 "Find another driver" option appear only when the server says
   a rematch is available; otherwise the outcome is a refund.
3. **One occupancy ledger, not a cross-table constraint.** Postgres cannot
   enforce one exclusion constraint across maintenance blocks (fleet side) and
   advance bookings (ride-service `mp` schema). Vehicle occupancy is written
   through a single shared occupancy table carrying both kinds, with the
   `(vehicle_id, tstzrange)` exclusion on that table; the existing per-driver
   booking exclusion stays.
4. **Off-road abuse control.** "Report off-road" is the only way a fleet can
   affect a confirmed booking, so every report is audited, visible to UBI ops,
   and flagged if the same vehicle goes online during the claimed breakdown.
5. **Manager proposals reuse signed terms.** Managers may propose shift and
   vehicle changes only under the driver's currently signed terms version;
   new remittance terms are owner-only (matching the role matrix).
6. **Endpoint namespace.** The handoff's `/v1/bookings/{id}/vehicle-swaps` and
   `/v1/bookings/{id}/changes/...` map onto the existing advance-booking routes
   under `/v1/mp/advance-bookings/{id}/...`; fleet routes are new under
   `/v1/fleets/...` and need gateway proxy rules and scopes.
7. **Driver schedule composition.** `GET /v1/drivers/me/schedule` combines
   fleet-owned data (assignments, maintenance, availability) with ride-service
   bookings; it is served by one owner that reads the other through an
   internal, service-authenticated projection — never by the client merging
   two sources.
