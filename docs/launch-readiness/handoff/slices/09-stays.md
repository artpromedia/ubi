# Slice 09 — UBI Stays (hotels inside the journey)
Board: 17a–17d, 18a–18b.

## Product rule
Hotel search prefilled from the flight (city, dates). Rates and availability come live from contracted hotels via channel managers; UBI reads, never writes rates. Journey Protection extends One-Ticket: airline-caused delay → room held, no no-show fee; airline-caused cancellation → move stay free or refund to wallet, UBI pays the hotel a first-night cover per signed terms. Traveller's own change → hotel policy. Physical ID still shown at desk; express check-in pre-verifies via UBI KYC and shares the live ride ETA (ETA only, from ride start to arrival).

## Backend (new: services/stays-service)
Tables: 006_travel.sql (hotels, hotel_partners, partner_terms, room_types, rate_cache, stay_bookings, checkins, eta_shares, stay_protection_events, hotel_reviews, hotel_replies, hotel_staff).
Endpoints (contracts/openapi/stays.yaml): GET /v1/stays/search {city, checkIn, checkOut, guests, journeyId} → hotels[] {protectionEligible, fromRateMinor taxesIncluded, minutesToSavedPlace} · GET /v1/stays/hotels/:id/rooms?dates (held 10 min at select) · POST /v1/stays/bookings {rateId, guest, paymentMode: pay_now|pay_at_hotel(card guarantee), journeyId} + Idempotency-Key → confirmed{confirmationCode} · POST /v1/stays/bookings/:id/checkin {prefs, signature} → PMS via channel manager · ride.started{linkedStayId} → POST hotel eta share (expires at arrival) · flight.status_changed → stay.late_arrival(auto) | protection options {keep|move|cancel} · reviews: POST /v1/stays/bookings/:id/review (verified, 24h window) · hotel: GET /v1/hotels/me/arrivals (front desk), POST /v1/hotels/me/reviews/:id/reply (once) · partner console (17d): bookings, protection ledger, payouts; onboarding (18a): CAC, TIN, licence, channel test booking, payout account, protection terms v3 → ops review.
Events: stay.booked, stay.checkin_precompleted, hotel.eta_shared, stay.late_arrival, stay.moved, stay.cancelled_by_airline_cause, hotel.first_night_cover(ledger), stay.checked_out, review.posted, hotel.replied, partner.applied/approved.

## Guards
Total = hotel's quoted gross (taxes inside), UBI never re-derives tax · protection outcomes only from feed-verified airline events · incidentals hold is the hotel's tokenised guarantee, never UBI-captured · ETA share scoped and expiring · reviews only from completed stays; single public reply · staff roles scoped (desk sees arrivals only).

## Acceptance
vitest: protection decision matrix (airline vs traveller cause), ETA share expiry, review eligibility. Maestro: stays_search_pay_in_journey, stays_express_checkin, stays_flight_cancelled_keep_move_cancel.

## Claude Code prompt
"Create services/stays-service per contracts/openapi/stays.yaml and db/migrations/006_travel.sql with a channel-manager adapter interface (mock for tests). Build rider_app Stays screens 17a–17d traveller side and 18b review; hotel front-desk mode (apps/desk) 17c and partner console (apps/partners) 17d/18a/18b. Tests listed."
