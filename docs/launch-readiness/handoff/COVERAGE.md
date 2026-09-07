# COVERAGE — what is designed

Board: design/UBI Move - Rider + Driver Lockstep.dc.html (anchors are the ids below). Every pair shows rider/customer and counterpart at the same server state, with event/API/guard chips.

| Turn | Ids | Designed |
|---|---|---|
| 1 Move lockstep | 1a–1q | foundations, home/offline, search/available, quote/filters, matching/offer, assigned/navigate, arrived/waiting, PIN, in-trip, cash complete, rate/earnings; recovery: no-driver, driver-cancel rematch, reconnect/GPS, SOS/safety-hold, payment-failed fallback; theme proof |
| 2 | 2a–… | rider onboarding + driver KYC intro pairs |
| 3 auth/KYC | 3a–3d | OTP, permissions, driver documents (Lagos set), review states |
| 4 ops | 4a–4d | live ops map, ride detail rd_314, safety case, KYC review |
| 5 | 5a–5d | Android parity pairs, wallets/settlement, Bites/Send gating |
| 6 unified launch | 6a–6g | home + earning modes; Bites checkout/merchant accept/tracking/delivered; Send create/pickup code/recipient web/delivery code |
| 7 wallet | 7a–7e | P2P lookup/receive, confirm+PIN, split fare, NIP transfer, KYC tiers + risk hold |
| 8 One-Ticket | 8a–8e | flight search/pay, protected ticket + airport ride, cancellation → free switch ⟷ airport desk, switched ⟷ agent record, ops disruption console |
| 9 journeys | 9a–9c | itinerary with both rides ⟷ Abuja driver reservation, landed pickup ⟷ driver at arrivals, re-timed journey ⟷ keep/release |
| 10 vendor admins | 10a–10d | Bites merchant console (orders, menu, payouts), Send business console (shipments, bulk, API) |
| 11 Bites front | 11a–11c | discovery/search, restaurant page/item options, merchant onboarding ⟷ ops review |
| 12 admin | 12a–12b | city config & flags (2-person approval), customer-support console |
| 13 accounts | 13a–13c | rider activity + account, driver statement + documents/vehicle, finance reconciliation |
| 14 recovery | 14a–14e | Bites issue/refund, merchant reject, Send recipient unavailable, damage claim, wallet wrong-person + top-up saga |
| 15 security | 15a–15c | new device + SIM-swap safe mode, locked PIN reset, driver liveness ⟷ ops account-sharing |
| 16 | 16a–16g | return leg Abuja→Lagos + Android sweep of 1e/1g/1i/1j |
| 17 Stays | 17a–17d | hotel search, hotel page/rooms, pay + Journey Protection, 7-leg receipt, express check-in ⟷ front desk, disruption ⟷ hotel partner console |
| 18 | 18a–18c | hotel onboarding ⟷ ops, post-stay review ⟷ hotel reply, wallet statement ⟷ driver quests |
| 19 Fleet | 19a–19c | fleet console, owner mobile ⟷ driver arrangement/split, assign + terms ⟷ driver signs |

Hotel-facing: 17c (front desk app), 17d (partner console), 18a (onboarding), 18b (reviews). Fleet-facing: 19a–19c.

## Intentionally text-only (low launch risk — implement from the guard chips, no screens)
Bites scheduled and group orders · Send lost-in-transit claim and business self-signup · group/corporate stays · promos · fleet KYB onboarding (mirror 11c/18a) · multi-shift scheduling · telematics · fleet invoices/tax statements · driver trip-history list (pattern = 13a) · in-app support chat rider side (pattern = 12b timeline) · Abuja map imagery (placeholders until city confirmed).
