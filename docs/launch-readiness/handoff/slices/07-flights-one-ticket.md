# Slice 07 — Travel: flights with One-Ticket
Board: 8a–8e (search/pay, protected ticket + airport ride, cancellation → free switch ⟷ airport desk, switched ⟷ agent record, ops disruption console).

## Product rule
Traveller books any partner airline in UBI. If the airline cancels, the traveller switches to any flight on the route within 24h across partner airlines and pays ₦0; UBI fronts the fare difference and reclaims the original fare from the airline (NCAA consumer rules). No seat same day → free next-day switch or instant refund to wallet. Not covered: no-show or voluntary change. Domestic only at launch.

## Backend (new: services/flights-service)
Tables: db/migrations/006_travel.sql (flight_offers cache, bookings, passengers, tickets, protections, flight_status_watch, alternatives, switches, reclaims, coverage_ledger, disruption_events, desk_agents, desk_queue).
Endpoints (contracts/openapi/flights.yaml): GET /v1/flights/search {from, to, date, pax} → offers[] with oneTicketEligible (partner with signed reclaim agreement) · POST /v1/flights/offers/:id/hold (10 min price hold) · POST /v1/flights/bookings {offerId, passenger{nameAsOnId, nin|passport}, paymentMethodId} + Idempotency-Key → ticketed{pnr} · GET /v1/flights/bookings/:id · GET /v1/flights/bookings/:id/alternatives (ranked: same terminal, seats, time) · POST /v1/flights/bookings/:id/switch {offerId} → seat held atomically at airline before traveller sees ₦0; new PNR; coverage line = newFare − originalFare · POST /v1/flights/bookings/:id/refund (protection) · desk: POST /v1/desk/scan {qr} → traveller record; POST /v1/desk/switch (agent acts for traveller without data; ID check logged) · ops: GET /v1/flights/disruptions (exposure, inventory, reclaims).
Integrations: airline/GDS inventory adapters (interface per airline; fallback to GDS on latency), airline status feed (poll + push), reclaim filing per airline.
Events: booking.confirmed, flight.watch_started, flight.status_changed{delayed, cancelled}, oneticket.activated (for every protected booking on the flight), alternatives.ranked, seat.held, booking.switched{oldPnr, newPnr, coveredMinor}, reclaim.filed/recovered/disputed, booking.refunded_to_wallet, desk.assisted.
Jobs: status poller, exposure calculator (Σ coverage − Σ recovered per flight/airline), airline reliability score → eligibility badge threshold.

## Guards
Airline price authoritative; hold 10 min · name must match ID · protection only when cancellation is feed-verified · seats reserved before "₦0" is shown · exposure tracked per flight · eligibility badge off for airlines below reliability threshold · desk actions scoped to scanned booking.

## Acceptance
vitest: alternative ranking, switch atomicity (seat hold failure → next alternative), coverage ledger lines, reclaim state. Maestro: flights_search_pay, flights_cancelled_switch_free, desk_scan_switch.

## Claude Code prompt
"Create services/flights-service (Hono + zod-openapi + Prisma, pattern from services/ride-service) per contracts/openapi/flights.yaml and db/migrations/006_travel.sql. Implement airline adapters behind an interface with a mock airline for tests. Build rider_app Travel screens 8a–8d and a desk-agent mode in a new apps/desk (or driver_app dark shell) per 8c–8d; ops console 8e in apps/admin. Tests listed."
