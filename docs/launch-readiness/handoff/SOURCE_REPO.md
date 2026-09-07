# GitHub source

repo: artpromedia/ubi
branch: master

## Last sync
date: 2026-09-05T14:01:00Z
commit: 8aa7c2611d6cb006a1aba13f8b27af0f1eed29d4

### Updated in this project
- Verified HEAD == audit baseline `8aa7c26` (github_compare: no changes)
- Copied brand assets: logos (black/white/move/bites/send), app icon, favicon → `assets/brand/`
- Read design tokens: `packages/design-tokens/tokens/base.json`, `semantic.json`

## Screen map
| Screen (board) | Built from repo sources |
|---|---|
| Lockstep board 1a foundations | packages/design-tokens/tokens/{base,semantic,dark}.json; assets/brand/logos/* |
| Rider pairs 1b–1q (home, search, quote, matching, assigned, arrived, PIN, in-trip, complete, rate) | mobile/apps/rider_app ride_search/ride_tracking pages (rework targets); audit §4.4 rider machine |
| Driver pairs 1b–1q (offline, online, filters, offer, navigate, waiting, PIN, in-trip, cash, earnings) | mobile/apps/driver_app BLoCs (mock-data rework targets); audit §4.4 driver machine |
| Event chips (API/guards) | services/ride-service routes + audit §2.2 contract reconciliation |
| Turn 3 auth/KYC (3a–3d): OTP, permissions, driver docs, review states | mobile auth flows + audit §2.4 auth/KYC gaps; Lagos doc set (licence, LASDRI, reg, insurance, roadworthiness, selfie) |
| Turn 4 admin (4a–4d): live ops, ride rd_314 detail, safety case, KYC review | admin/ dashboard rework targets + audit §2.6 ops tooling; same event stream as phones |
| Turn 5 (5a–5d): Android parity pairs, wallets/settlement, Bites/Send gating | audit §§2.3 payments ledger, 2.5 platform parity, feature-flag policy |
| Turn 6 (6a–6g): unified launch — home + earning modes, Bites (checkout, merchant accept, tracking/pickup, delivered/proof), Send (create, pickup code, recipient web + delivery code) | services/order-service + delivery-service scaffolds; audit §3 Bites/Send readiness; shared matching/ledger/safety |
| Turn 7 (7a–7e): UBI Wallet P2P — recipient lookup/receive, confirm + PIN/received, split-fare request/pay, NIP bank transfer + status, KYC tiers + risk hold | services/wallet-service ledger + audit §2.3 payments; CBN tiered KYC / NIP assumptions flagged on board |
| Turn 8 (8a–8e): One-Ticket flights — search/pay, protected ticket + airport ride ⟷ driver deadline, cancellation → free switch ⟷ airport desk queue, switched ⟷ agent record/reclaim, ops disruption console | new flights-service (no repo scaffold yet); reuses wallet, Move, KYC identity, ops console pattern |
| Turn 9 (9a–9c): door-to-door journey — itinerary with both rides ⟷ Abuja driver reservation, landed pickup at ABV Door 3 ⟷ driver waiting, flight switch → journey re-timed ⟷ driver keep/release | scheduled-rides + journeys (no repo scaffold yet); maps assets/maps/abv-*, abuja-* (OSM, restyled) |
| Turn 10 (10a–10d): vendor admins — Bites merchant console (orders board, menu & payouts), Send business console (shipments, bulk import/pickups/API) + coverage map of designed vs missing screens | merchant-service / business accounts (no repo scaffold yet); reuses order + shipment event streams |
| Turn 11 (11a–11c): Bites discovery & search, restaurant page & item options, merchant onboarding (KYB) ⟷ ops merchant review | bites catalogue/cart services (no repo scaffold yet); KYB checks CAC/TIN/NIN per Lagos config |
| Turn 12 (12a–12b): admin city config & feature flags (2-person approval, versioned), customer-support console (unified timeline, typed remedies) | config-service + support case model (no repo scaffold yet); every policy chip on the board maps to 12a |
| Turn 13 (13a–13c): rider activity feed + account/settings, driver weekly statement + documents/vehicle, finance reconciliation console | activity projection, statements, recon over ledger/PSP/NIP/cash (no repo scaffold yet) |
| Turn 14 (14a–14e): recovery — Bites issue/refund ⟷ merchant response, merchant reject → instant release + alternatives, Send recipient unavailable ⟷ sender options, damage claim ⟷ ops custody review, wallet wrong-person return + inline top-up saga | order/shipment exception states, claims reserve, wallet saga (no repo scaffold yet) |
| Turn 15 (15a–15c): account recovery — new-device step-up + SIM-swap safe mode, locked PIN → selfie reset + cooling, driver device liveness gate ⟷ ops account-sharing review | auth-service device enrolment, wallet safe-mode scopes, trust & safety identity cases (no repo scaffold yet) |
| Turn 16 (16a–16g): return leg Abuja→Lagos (book return from itinerary, reserved hotel pickup, Lagos scheduled arrival pickup, journey receipt) + Android sweep of 1e/1g/1i/1j at 412×892 | journeys/reservations (ABV city config), mobile/apps/*_app Android parity — same tokens & contract |
| Turn 17 (17a–17d): UBI Stays — hotel search prefilled from flight, hotel page & rooms, review & pay with Journey Protection, 7-leg journey receipt, express check-in with live ETA ⟷ hotel front desk, flight-cancellation stay options ⟷ hotel partner console | stays-service + channel-manager integration, journey protection ledger (no repo scaffold yet); Travel tile in 6a now "Flights & stays" |
| Turn 18 (18a–18c): hotel self-onboarding ⟷ ops partner review, post-stay review ⟷ hotel reply, wallet statement & export ⟷ driver quests | partner onboarding + reviews (stays), wallet statements from ledger journal, quests as typed campaigns from config (no repo scaffold yet) |
| Turn 19 (19a–19c): UBI Fleet — fleet console (vehicles, drivers, remittances, alerts), fleet owner mobile ⟷ driver "my arrangement" split view, assign driver + terms ⟷ driver signs with PIN | fleet-service: assignments, split rules on payouts (3 ledger lines), vehicle-level document gating (no repo scaffold yet) |
