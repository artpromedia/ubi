# Slice 05 — Bites: discovery → order → merchant → delivery → exceptions
Board: 11a–11c, 6b–6d, 10a–10b, 14a–14b, 5d.

## Backend (extend services/food-service + delivery-service; new merchant module)
Tables: 004_bites.sql (merchants, merchant_kyb, outlets, menus, items, option_groups, options, carts, orders, order_items, order_issues, merchant_responses, payouts).
Endpoints: GET /v1/bites/feed?addressId · GET /v1/bites/search?q&filters (ETA + fee quoted per merchant from courier supply) · GET /v1/merchants/:id/menu (option groups: required/min/max/priceDeltaMinor) · POST /v1/carts/:id/items (server recomputes price) · POST /v1/orders {cartId, addressId, paymentMethodId} + Idempotency-Key → pre-auth, not captured · merchant: POST /v1/orders/:id/accept|reject{reason→side effect: item sold out / store paused / closed} · courier flow: handover code at counter, delivery code / photo at drop · POST /v1/orders/:id/issues {items[], type, photo} → merchant respond within 2h (accept | redeliver | dispute) else auto-accept → refund per item to wallet · merchant console (10a–10b): orders board, menu availability, payouts statement · onboarding (11c): CAC, TIN, owner NIN+selfie, outlet pin, hygiene permit → ops review → merchant.approved.
Events: order.placed, merchant.accepted/rejected{reason}, courier.assigned, order.picked_up, order.delivered{proof}, order.issue_reported, merchant.responded, refund.posted, menu.item_unavailable, store.paused, merchant.applied/approved.

## Guards
Required option groups enforced · sold-out not addable · single-merchant cart · reject releases pre-auth (never a transfer) · refunds per item at menu price · repeated missing-item reports lower rank · menu can be built before approval, never published.

## Acceptance
vitest: option validation, price recompute, reject → auth release, 2h auto-accept job. Maestro: bites_order_happy_path, bites_missing_item_refund, merchant_reject_sold_out.

## Claude Code prompt
"Implement slice 05 across services/food-service and delivery-service per db/migrations/004 and the endpoints above (add to contracts as you go, zod-openapi). Build rider_app Bites screens 11a–11b, 6b–6d, 14a–14b; merchant console (apps/merchant) 10a–10b and 14a merchant side; onboarding 11c. Tests listed."
