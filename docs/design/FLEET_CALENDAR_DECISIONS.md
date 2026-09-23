# Fleet availability calendar — product decisions and engineering corrections

This file turns the vendored Claude Design handoff
(`docs/launch-readiness/handoff-fleet-calendar/`, answering
`docs/design/FLEET_AVAILABILITY_CALENDAR_BRIEF.md`) into a build contract. Where
this file and the handoff disagree, **this file wins**. The `fleet` flag stays
off until the vertical has its own end-to-end evidence.

Decided by UBI on 23 Sep 2026. The handoff was revised once (v2, now the
vendored copy). v2 "resolved" every open question itself; UBI reviewed each of
those resolutions and **kept its own earlier decision where they differ** —
the table below is the result, and v2 text that contradicts it does not apply.

## Product decisions

| #   | Question                                         | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                            | v2 handoff says                                                                                                                                                                                                  |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Zone label on booking blocks shown to fleets     | **Fully opaque.** Fleets see `Booked · 07:15–09:40` plus the server's risk flag, and nothing else. Travel-time feasibility is computed server-side, so fleets never need a location.                                                                                                                                                                                                                                                                | Same.                                                                                                                                                                                                            |
| Q2  | Remittance for hours lost to planned maintenance | **Pro-rate.** A `weekly_fixed` remittance is reduced pro rata for the signed shift hours a vehicle spends in a **planned** maintenance block (planned service, inspection, repair), because the fleet chose that downtime. `percent_of_net` needs no change. The basis is the signed shift's hours in the settlement week; the adjustment is a server-computed, journaled line, never a client calculation, and never retroactive to a closed week. | Same.                                                                                                                                                                                                            |
| Q3  | Rider consent for a vehicle swap                 | **Always required**, including a vehicle-only swap (same driver, class, capacity, window and fare). Riders check the plate at pickup for safety, so any vehicle change on an advance booking needs the rider's "Confirm new vehicle" or a free cancel. Nothing changes until they confirm.                                                                                                                                                          | **Overridden.** v2 applies a vehicle-only swap after revalidation and only notifies the rider (`rider_notified` state, D1 "Vehicle updated / Got it"). Do not build that path; D1 is always the consent variant. |
| Q4  | Conflict-resolution deadline                     | **The earlier of the reconfirmation time and pickup − 2 h**, a city-configurable policy value. At the deadline the booking fails through the existing path with its explained outcome, and the rider is **proactively offered** a same-fare rematch (only when the server's `rematchAvailable` allows it) or a refund. The rider chooses; the trip is **never republished without the rider's choice**.                                             | Adopted, as an offer (v2's "automatic rematch" means an automatic offer, not a republish).                                                                                                                       |
| Q5  | Who can report a vehicle off-road                | **The driver (from the app, while stationary), plus fleet owners and managers.** Read-only staff cannot. Adopts v2's driver screen **C5 ReportVehicleIssue** (`cannot_drive` / `service_soon`), which creates the unplanned off-road block, alerts the fleet and points to SOS for personal safety.                                                                                                                                                 | Adopted (C5, FL-11).                                                                                                                                                                                             |
| Q6  | Document-expiry handling                         | **Warnings at 30 / 14 / 7 / 1 days**, and immediately whenever a booking falls after an expiry date; unresolved bookings follow the conflict matrix. Bookings are **not** pre-emptively filtered on known expiry.                                                                                                                                                                                                                                   | **Not adopted:** v2's FL-12 (never offer bookings that end after a known expiry).                                                                                                                                |
| Q7  | What money fleets see                            | **No driver net.** Fleets see hours, shifts, gross, UBI commission, their own remittance and its status. A driver's net earnings stay private to the driver.                                                                                                                                                                                                                                                                                        | Same.                                                                                                                                                                                                            |
| Q8  | Do breakdowns pro-rate remittance                | **No.** Unplanned off-road hours (including driver-reported breakdowns) follow the signed terms' shortfall / carry-forward rule; only fleet-scheduled planned maintenance is pro-rated (Q2).                                                                                                                                                                                                                                                        | **Overridden.** v2 pro-rates breakdowns too. Do not.                                                                                                                                                             |
| Q9  | Do fleets see driver time off                    | **As an unexplained "Unavailable" block** — read-only hours, never labelled "time off", never with a reason.                                                                                                                                                                                                                                                                                                                                        | Read-only hours with no reason (compatible; use the "Unavailable" label).                                                                                                                                        |
| —   | Remittance delta in the maintenance preview      | **Not adopted.** The impact preview lists affected assignments and opaque bookings; it does not show per-driver pro-rated remittance amounts.                                                                                                                                                                                                                                                                                                       | **Not adopted:** v2's `lostShiftHours` / `remittanceDelta` preview fields and the matching copy.                                                                                                                 |

Other handoff assumptions accepted as designed: planned maintenance is never
confirmed over a booking; unplanned off-road only sets bookings `at_risk`;
proposals never count as availability; driver time off outranks a fleet shift
(and is not pro-rated — the fleet did not cause it); swap eligibility is
same-or-higher class and at-least-equal capacity at an unchanged fare;
utilisation needs 7 days of data; maintenance is time-based only (no odometer
feed).

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
8. **Neutral copy.** Copy templates never assume a gender (v2 has "Her signed
   terms don't change…"); use the driver's name or "their".
9. **Round-8 build vs these decisions.** The round-8 fleet slices were briefed
   on the earlier deadline (activation − 30 min) and without C5; the Q4 default
   and the driver breakdown report are applied as a round-9 delta.
