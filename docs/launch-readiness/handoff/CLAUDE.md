# CLAUDE.md — rules for implementing the UBI handoff

Read the slice you are assigned, then contracts/, then db/. Ground everything in the repo (Hono + zod-openapi + Prisma + Redis; Flutter + BLoC; packages/design-tokens). Do not invent alternatives to what exists.

## Non-negotiables
1. **Server is authoritative.** Fares, quotes, taxes, fees, remittance splits, refunds, ETAs and eligibility are computed and signed server-side. Clients render; they never compute money. Currency, tiers, wait fees, cancellation windows, PIN policy, limits come from **city config** (slice 01), never from code constants.
2. **Every state transition is an event** with actor, timestamp, idempotency key, prior/next version, audit record. Publish through a transactional **outbox**. Clients resume WebSocket streams with lastSeq → bounded replay (≤50) → REST snapshot fallback.
3. **Idempotency everywhere money or state moves.** POST endpoints that create rides/orders/shipments/transfers/bookings take Idempotency-Key and return the original result on replay.
4. **Ledger is double-entry; balances are derived, never stored as truth.** Fees, tips, refunds, reversals, remittances, coverage, reclaims are separate journal lines with a counterpart reference. Daily recon (slice 11) blocks day-close while unexplained ≠ 0.
5. **Feature flags deny-by-default**, evaluated server-side, per city. Bites/Send/Travel/Fleet/Stays tiles render only when the flag is on; deep links 404 when off. Config changes are versioned and need two-person approval.
6. **Privacy by role.** Masked calls/chat between rider and driver. Fleets see vehicle-scoped trips/hours/earnings only. Hotels see name, room, ETA, ID-verified flag. Merchants see order data only. Biometric checks store a score, never the image. Safety evidence stays with UBI Trust & Safety.
7. **Consent for money rules.** Remittance/split rules activate only after the driver signs with PIN; changes require re-signing. Wallet transfers are never pulled back unilaterally (recipient-consented return or dispute).
8. **Honest unavailability.** Unsupported payment methods, closed merchants, out-of-range results, unprotected hotels/airlines are shown as unavailable — never hidden, never silently failing.
9. **Safety.** SOS is durable (retried, SMS fallback), lands in a 24/7 queue with SLA, puts the ride in safety_hold visible to both parties. Emergency number is from city config (Lagos: 112).
10. **Design tokens only.** Semantic tokens from packages/design-tokens for both themes (see tokens/semantic-tokens.json). Poppins for headings, Inter for body. Rider ships light-default, driver dark-default; both themes must pass WCAG 2.2 AA. Colour never carries meaning alone.
11. **Targets and type.** 44pt iOS / 48dp Android minimum; primary buttons 54–56px; body ≥ 12.5px on phones. Money tabular-nums. Plates in monospace.
12. **No mock personas, no hard-coded Nairobi/KES, no client-side pricing, no silent flag defaults, no PII in logs.**

## testID convention (stable, used by Maestro)
<app>.<screen>.<element> in camelCase, e.g. rider.home.whereTo · rider.quote.confirm · rider.match.cancel · rider.pin.display · rider.trip.shareTrip · rider.trip.safetyHub · rider.pay.cashConfirm · rider.rate.submit · driver.home.goOnline · driver.offer.accept · driver.offer.decline · driver.pickup.arrived · driver.pin.input · driver.trip.complete · driver.cash.received · driver.earnings.cashout · common.sos.hold · wallet.send.confirmPin · wallet.request.pay · bites.cart.checkout · bites.issue.submit · send.create.confirm · send.recipient.deliveryCode · flights.search.results · flights.pay.confirm · flights.switch.confirm · journey.itinerary.view · stays.pay.confirm · stays.checkin.complete · fleet.assign.send · driver.fleet.signPin · desk.scan.qr · ops.case.remedy.

## Working a slice
1. Read slices/NN-*.md end to end. 2. Add/extend Prisma models from db/migrations. 3. Implement endpoints from contracts/openapi with zod schemas; register events from contracts/events. 4. Write vitest unit + integration tests for guards listed in the slice. 5. Build Flutter screens from the board anchors with the exact copy; wire testIDs. 6. Add the Maestro flow named in the slice. 7. One PR per slice; PR description lists board ids covered.

## Definition of done per screen
Renders in light and dark from tokens · all states on the board (loading, empty, error, offline, success) · copy matches the board · testIDs present · no client-side money math · analytics event on primary action · accessibility labels for money, plates, status.
