# Slice 02 — Move core lockstep + recovery (acceptance demo)
Board: 1b–1q (happy path + recovery), 16d–16g (Android), 5a–5b.

## Goal
One ride, both apps, never out of sync. Rider machine: idle → destination_selected → quote_ready → matching → driver_assigned → driver_arrived → pin_verification → in_progress → completed (+ rating/tip). Driver machine: offline → available → offer_received → accepted → navigating_to_pickup → arrived/waiting → pin_verified → in_trip → collecting_payment → completed → available. Full machines: contracts/state-machines.json.

## Backend (extend services/ride-service, location-service, realtime-gateway, payment-service)
Endpoints: POST /v1/quotes {pickup, stops[], vehicleClass} → {quoteId, fareMinor, currency, expiresAt, signature} · POST /v1/rides {quoteId, paymentMethodId} + Idempotency-Key → 201 SEARCHING · GET /v1/rides/active (204 when none) · GET /v1/rides/:id (ETag/version) · POST /v1/offers/:id/accept → ok | expired | already_assigned (atomic lock in Redis SETNX + DB unique) · POST /v1/rides/:id/arrived (server checks ≤150 m) · POST /v1/rides/:id/verify-pin {pin} → 200 | 422 wrong_pin{attemptsLeft} (rate-limited, hashed) · POST /v1/rides/:id/start (requires pin_verified) · POST /v1/rides/:id/complete → final fare from ledger · POST /v1/payments/:id/cash-ack | cash-dispute · POST /v1/rides/:id/rating {stars, tags, tipMinor} · POST /v1/rides/:id/cancel {reasonCode} (driver reason mandatory; unsafe → safety flow) · POST /v1/rides/:id/switch-class {quoteId} · POST /v1/drivers/me/status {online, filters} · POST /v1/drivers/me/locations (batch, seq, accuracy; reject implausible) · POST /v1/safety/sos (durable, SMS fallback).
Realtime: WS topics ride.{id} with events ride.assigned(v), ride.driver_arrived, ride.pin_verified, ride.started, ride.location(seq), ride.completed, ride.cancelled_by_driver, ride.safety_hold; resume(lastSeq).
Matching: rings with widening radius, offer TTL 12s from config, retries bounded, every offer + response persisted (ops timeline 4b). No-driver → rider options (switch class / keep waiting / cancel free).
Ledger: ride completion posts fare, fee (20%), tip (bypasses fee), wait fees, cash-owed netting for cash trips (1j/1k).

## Client
Screens per board id with exact copy; trip status persists as text (map never sole carrier); offline banner shows stale timestamp; SOS hold 3s; PIN screens (1g/1h). Android: bottom sheets radius 28, 48dp targets (16d–16g).

## Guards to test
No double assignment under concurrent accepts · PIN attempts limit · arrived geofence · fare equals quote unless server-policy reroute · idempotent ride create · WS gap → snapshot · driver cancel needs reasonCode.

## Acceptance
Maestro flows: rider_happy_path_cash, driver_happy_path, rider_driver_cancel_rematch, rider_offline_reconnect, sos_safety_hold. k6: 500 concurrent accepts on one offer → exactly one ok.

## Claude Code prompt
"Implement slice 02 in services/ride-service (+ location-service, realtime-gateway, payment-service) per contracts/openapi and contracts/state-machines.json. Replace mock data in mobile/apps/driver_app BLoCs and rider_app ride_search/ride_tracking with the real contract; build every screen 1b–1q with the copy on the board; add testIDs from CLAUDE.md; write the vitest guards and Maestro flows listed."
