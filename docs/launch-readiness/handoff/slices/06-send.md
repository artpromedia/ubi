# Slice 06 — Send: create → pickup → deliver → exceptions → business console
Board: 6e–6g, 10c–10d, 14c–14d.

## Backend (extend services/delivery-service; business accounts)
Tables: 005_send.sql (shipments, shipment_events, custody_photos, delivery_codes, exceptions, claims, business_accounts, api_keys, webhooks, bulk_imports, scheduled_pickups).
Endpoints: POST /v1/shipments {pickup, dropoff, size, declaredValueMinor, recipient{phone,name}} → quote + pickup code · recipient web page (no app): tracking + delivery code + issue/claim (14d) · courier: pickup code + photo, delivery code + photo/handover type · exceptions: POST /v1/shipments/:id/exceptions {recipient_unavailable, evidence{call, sms, wait, photo}} → sender decision {retry|neighbour(consent)|return|hub_pickup} else hub_hold after 15 min · claims: POST /v1/shipments/:id/claims {photos, category} within 24h → ops evidence review (custody photos side by side) → approve|partial|decline capped at declared value · business: bulk CSV import, scheduled pickups, API keys + webhooks (10d).
Events: shipment.created, shipment.picked_up, shipment.exception, sender.decision, shipment.hub_held, shipment.delivered{proof}, claim.opened/decided, business.webhook_delivered.

## Guards
Courier cannot mark unavailable without call + SMS + wait + photo logged · neighbour handoff needs explicit sender consent · exception fees from config · claim window 24h, payout ≤ declared value, velocity checks both sides.

## Acceptance
vitest: exception evidence gate, claim cap, webhook signing. Maestro: send_create_pickup_deliver, send_recipient_unavailable_retry, send_damage_claim.

## Claude Code prompt
"Implement slice 06 in services/delivery-service per db/migrations/005; add business account auth (API keys) in api-gateway; build rider_app Send screens 6e–6f, 14c sender; recipient web (apps/track) 6g/14d; courier screens in driver_app 6f/14c; business console (apps/business) 10c–10d. Tests listed."
