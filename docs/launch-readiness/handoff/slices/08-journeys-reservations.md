# Slice 08 — Journeys and reservations (door-to-door, return leg)
Board: 9a–9c, 16a–16c, 8b (airport ride with flight deadline), 16b (scheduled pickups).

## Product rule
A journey is an ordered set of legs (ride → flight → ride → stay → ride → flight → ride) on one receipt. Rides attached to flights derive their time from the flight: arriveBy = departure − check-in cutoff − buffer; arrival pickups = landing + 20 min. Reservations guarantee a driver for early/late pickups; a flight change re-times every dependent leg and asks affected drivers to keep or release.

## Backend (new: services/journey-service; extend ride-service with reservations)
Tables: 006_travel.sql (journeys, journey_legs, leg_dependencies, reservations, reservation_pool, driver_reminders, journey_receipts).
Endpoints (contracts/openapi/journeys.yaml): POST /v1/journeys {legs[]} · POST /v1/journeys/:id/legs {type, ref, direction:return} (return prefilled from outbound) · GET /v1/journeys/:id (timeline, totals from ledger) · GET /v1/journeys/:id/receipt.pdf · POST /v1/rides/reservations {pickupAt, pickup, dropoff, vehicleClass, linkedBookingId, cityId} → assigned T−12h from pool + standby · POST /v1/reservations/:id/release (free until window from config) · driver: GET /v1/drivers/me/scheduled · flight status → leg.retimed → reservation.pickup_moved → driver keep|release.
Events: journey.created, journey.leg_added, leg.retimed{cause}, reservation.assigned, reservation.reminder(T−60m), reservation.pickup_moved, driver.kept/released, journey.completed, receipt.compiled.

## Guards
pickupAt derived from config (cutoff, buffer), never typed by user · Abuja legs use ABV city config (fares, geofence, airport doors) · driver sees door + time, never PNR or phone · release window enforced; late release counts against reservation access · journey total = Σ ledgered legs.

## Acceptance
vitest: dependency re-timing on flight change, pool assignment at T−12h, receipt totals. Maestro: journey_book_both_rides, landed_pickup_door3, flight_switch_retimes_rides, return_leg_reserved_pickup.

## Claude Code prompt
"Create services/journey-service per contracts/openapi/journeys.yaml and db/migrations/006_travel.sql; add reservations to services/ride-service; wire flight.status_changed consumers. Build rider_app journey screens 9a–9c, 16a, 16c and driver_app scheduled/reservation screens 9a–9c, 16b, 16c. Tests listed."
