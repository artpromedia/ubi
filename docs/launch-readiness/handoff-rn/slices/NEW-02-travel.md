# NEW-02 — Flights, stays, itinerary, servicing, airport ride linkage (boards 21a–21e)

## Screens & routes (rider-mobile `Travel.*`)
FlightSearch · FlightResults{searchId} · StaySearch{params} · StayRooms{propertyId, searchId} · PassengerDetails{cartId, index} · Checkout{cartId} · OrderStatus{orderId} · Itinerary{tripId} · Servicing{orderId} (change/cancel entry) · RefundStatus{refundId} · Disruption{orderId} · AttachAirportRide{orderId, direction} · LinkedOrders{tripId}. Flags: `flights_booking`, `stays_booking` (new), `reservations` (existing).

## State transitions
Search: idle → loading → results | empty | error · offers age → expired(refresh) · Cart: building → revalidating → priced | repriced(diff) → paying(PIN) → executing · Order (flight): payment_authorized → submitted → supplier_pending → confirmed_pnr → ticketed | failed_released | unknown_reconciling · Order (stay): payment_authorized → prebooked? → booked → confirmed | failed_released | unknown_reconciling · Ride reservation: requested → reserved | reservation_failed → (day-of) assigned → completed · Refund: requested → supplier_approved → refunded_to_wallet | rejected · Disruption: detected(verified) → options{covered|not_covered} → switched | refunded | kept.

## API (contracts/openapi/travel-v2.yaml)
POST /v1/travel/flights/searches → {searchId, offers[]} · GET /v1/travel/flights/searches/:id (refresh) · POST /v1/travel/stays/searches · GET /v1/travel/stays/:propertyId/rates?searchId · POST /v1/travel/carts · PUT /v1/travel/carts/:id/passengers · POST /v1/travel/carts/:id/checkout (Idempotency-Key; grant or PIN) → {tripId, orders[]} · GET /v1/travel/orders/:id · GET /v1/travel/trips/:id · GET /v1/travel/trips/:id/linked · POST /v1/travel/orders/:id/cancel · GET /v1/travel/refunds/:id · GET /v1/travel/orders/:id/disruption · POST /v1/travel/orders/:id/switch {alternativeId} · POST /v1/reservations {linkedOrderId, pickupAt, classId}.
Adapters: FlightSupplyAdapter (Duffel), StaySupplyAdapter (Duffel Stays | Nuitee/LiteAPI) — capabilities per offer {holdSupported, priceGuaranteeUntil, merchantOfRecord, changeSupported, refundSupported, currency, payAtProperty}. Webhooks verified + deduped; outbox; reconciliation job; comparison harness for launch routes/properties (config-stored commercial rates with source/date).
Events: travel.search.completed · travel.cart.repriced · travel.order.{submitted,supplier_pending,confirmed,ticketed,failed_released,unknown} · travel.refund.{requested,supplier_approved,refunded} · travel.disruption.{detected,options_ready,switched} · reservation.{reserved,failed,assigned} · travel.settlement.difference.

## Money rules
Provider amounts authoritative; taxes and pay-at-property listed; FX via server quote with rate and lock time; UBI service fee its own line; savings `adjustments[]` from promotions (NEW-03) never computed on device; holds per item; capture on confirmation; releases as ledger lines.

## Placement
`rn/apps/rider-mobile/src/screens/travel/*.tsx` · `src/components/travel/{OfferCard,FareFamilyOption,RateCard,Ladder,ItemCard,AlternativeCard,TermsBlock}.tsx` · `src/api/travel.ts` · fixtures `src/dev/fixtures/travel.ts` · web: NEW-05.

## Acceptance
Contract fixtures + sandbox: duplicate submissions/callbacks, timeout then late confirmation, PNR-without-ticket, refund tracking, partial linked success, settlement difference, FX lock. jest: ladder renders 7 states; "guaranteed to" only with adapter field; disruption variants from eligibility. Maestro: travel_search_checkout · travel_pending_then_ticketed · travel_cancel_refund · travel_disruption_covered · travel_disruption_not_covered · travel_attach_ride_failed.

## Claude Code prompt
"Implement NEW-02: travel-service adapters (Duffel flights; Duffel Stays vs Nuitee/LiteAPI per approved access) behind FlightSupplyAdapter/StaySupplyAdapter with capability records, durable per-item order workflows and the explicit ladder, reconciliation-first timeout handling, verified/deduped webhooks via the outbox and ledger, linked airport reservations through the existing reservations capability, and the comparison harness. Build RN screens rn/apps/rider-mobile/src/screens/travel with copy from boards 21a–21e; flags flights_booking/stays_booking; tests and Maestro flows listed."
