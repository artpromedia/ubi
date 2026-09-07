# Handoff: UBI launch — Move · Bites · Send · Wallet · Travel (One-Ticket, Stays, Journeys) · Fleet · Ops

## Overview
This package hands the complete UBI launch design (19 board turns, 84 screen pairs/consoles) to engineering, with backend guidance for every feature that does not yet exist in the repo. Target repo: **artpromedia/ubi @ master (baseline 8aa7c26)** — pnpm/turbo monorepo; services are **Hono + @hono/zod-openapi + Prisma + Redis + pino (TypeScript, vitest)**; mobile apps are **Flutter (rider_app, driver_app, BLoC)**; web consoles live under **apps/**. Design tokens live in **packages/design-tokens**.

## About the design files
Everything under design/ is a **design reference built in HTML** — it shows intended look, copy and behaviour. It is not production code. Recreate the screens in the codebase's own environment: Flutter widgets for the phones, the existing React/Next admin stack for consoles, Hono services for the backend. Open the board with a static server (for example: npx serve design) and use the anchors (#1e, #17b …) referenced throughout this package.

## Fidelity
**High-fidelity.** Colours, type, spacing, copy and states are final. Recreate pixel-close using packages/design-tokens (light + dark) — never Material colour roles, never invented hexes. Money is always tabular-nums in NGN from city config.

## Folder map
- CLAUDE.md — rules Claude Code must follow on every slice (server-authoritative, ledger, flags, privacy, tokens, testIDs).
- COVERAGE.md — what is designed (by board id) and what is intentionally text-only.
- slices/ — 12 implementation slices, each self-contained: scope, screens, backend (tables, endpoints, events, jobs), guards, acceptance, and a paste-ready Claude Code prompt.
- contracts/openapi/ — OpenAPI 3.1 for the new/extended services (zod-openapi friendly).
- contracts/events/catalog.md — every domain event on the board: producer, payload, consumers.
- contracts/state-machines.json — canonical machines (rider, driver, order, shipment, booking, stay, journey, assignment, transfer, case).
- db/migrations/ — Postgres DDL for new tables (translate to Prisma schema in packages/database).
- tokens/semantic-tokens.json — the exact semantic values used on the board (light/dark).
- design/ — the board (.dc.html), runtime (support.js), device frames, brand logos and Lagos/Abuja map backdrops.
- SOURCE_REPO.md — repo grounding and screen → source-file map.

## Implementation order (each slice = one PR train)
0. slices/01 foundations: tokens in both apps, city config + feature flags service (deny-by-default), money/date formatting from config.
1. slices/02 Move core lockstep + recovery (the acceptance demo).
2. slices/03 auth, KYC, account recovery, device trust.
3. slices/04 wallet: P2P, split fare, NIP, safe mode, statements.
4. slices/05 Bites and slices/06 Send incl. vendor consoles and exception flows.
5. slices/11 ops consoles: config/flags, support, finance recon, safety/identity.
6. slices/07 flights (One-Ticket) → slices/08 journeys & reservations → slices/09 Stays.
7. slices/10 Fleet.
8. slices/12 Android parity, testIDs, Maestro flows.

## Screen index (board id → slice)
1a–1q, 5a–5b, 16d–16g → 02 · 3a–3d, 15a–15c → 03 · 5c, 7a–7e, 14e, 18c(wallet) → 04 · 5d, 6a–6d, 10a–10b, 11a–11c, 14a–14b → 05 · 6e–6g, 10c–10d, 14c–14d → 06 · 8a–8e → 07 · 9a–9c, 16a–16c → 08 · 17a–17d, 18a–18b → 09 · 19a–19c → 10 · 4a–4d, 12a–12b, 13c, 13a–13b, 18c(quests) → 11 · 16d–16g + testIDs → 12.

## Cast and fixtures used across the board (reuse in seeds and tests)
Rider Adaeze Nwosu (+234 813 ••• 2291, NIN verified, Tier 1) · Driver Chinedu Okafor (4.9★, silver Toyota Corolla KJA 481 XA, fleet Okafor Motors) · Ride rd_314: 14 Adeola Odeku St, VI → Nike Art Gallery, Lekki Phase 1, UBI Go ₦3,100 cash, PIN 4827 · Flight P4 7120 LOS→ABV 14:30 (cancelled) → switched to QI 0316 · Stay Transcorp Hilton Abuja King 2 nights ₦370,000 · Journey total ₦701,000.

## Assets
Brand: design/assets/brand (from repo assets/brand). Maps: design/assets/maps — OpenStreetMap-derived backdrops for mockups only; production uses the licensed maps provider chosen in Phase 1.3 of the audit. Photos on the board are labelled placeholders — merchants/hotels upload real imagery.
