# Web truthfulness audit (C09, part 1)

Scope: `apps/marketing-site`, `apps/web-app`, `apps/fleet-portal`,
`apps/merchant-portal`, `apps/restaurant-portal`. Every public claim and CTA
was checked against `docs/launch/GAP_REGISTER.md`'s availability matrix and
the marketplace model (requester-edited bounded fare, private driver offers,
requester-only selection, eligibility-envelope broadcast, 10% commission,
cash unsecured, PSP fail-closed, delivery/queued-jobs/AI not live).

Verdict key: **accurate** (matches the matrix or is dynamically sourced from
it), **overclaim** (states or implies more than is true), **broken CTA**
(link/button leads nowhere or does nothing), **unavailable-implied-live**
(presents a not-live service/feature as available today).

## Summary by verdict

| App               | Accurate | Overclaim | Broken CTA | Unavailable-implied-live |
| ----------------- | -------: | --------: | ---------: | -----------------------: |
| marketing-site    |       38 |         0 |          0 |                        0 |
| web-app           |        9 |         9 |         11 |                        6 |
| fleet-portal      |        1 |         0 |          9 |      1 (whole dashboard) |
| merchant-portal   |        1 |         0 |         10 |      1 (whole dashboard) |
| restaurant-portal |        1 |         0 |          9 |      1 (whole dashboard) |

Counts are claim/CTA groups, not individual lines of JSX; see the per-app
tables below for the itemised findings and the action taken for each.

## marketing-site — accurate, no fixes needed

Every page (`/`, `/drive`, `/cities`, `/cities/[cityId]`, `/help`) reads
availability, service fees, requirements and emergency numbers live from
`config-service`/`user-service` through `src/lib/availability.ts` and
`src/lib/requirements.ts`, never hard-codes them, and fails to an honest
"can't confirm availability" or "not yet available" state rather than
guessing (`AvailabilityNotice.tsx`, `PreLaunch.tsx`, `ServiceCard.tsx`). All
outbound app/store links route through `DestinationLink`
(`src/components/marketing/DestinationLink.tsx`), which renders a real
`<a>` only when an https destination env var is set and otherwise a
non-interactive "not yet" notice (`src/lib/destinations.ts`
`PENDING_COPY`) — never a dead link or a fake completed action. Copy
explicitly avoids the five banned overclaims: no "every driver" (broadcast
is described only as "a driver nearby"), no guaranteed earnings ("We don't
advertise earnings here because they depend on when and where you drive",
`drive/page.tsx:196-198`), no guaranteed cheapest price, no instant refunds
("Refunds appear in Activity with their own status", `help/page.tsx:170`),
no autonomous-AI claim (Ask UBI is described as "helps you plan," reviewed
before confirming), and delivery/travel/queued-jobs/AI are all gated behind
live flags (`availability-pure.ts` `servicesFrom`) with honest "not yet"
copy per service. Driver commission is shown only as the dynamic
`serviceFeePct` pulled from city config (`drive/page.tsx:170`), never a
hard-coded number. No pilot definition or matrix conflict found.

**Action taken:** none. Verified with the full unit suite (15/15 passing)
and the full Playwright e2e suite (73 passed, 3 skipped — touch/viewport
tests that don't apply to the desktop runner, 0 failed) against the
production build, per `.github/workflows/ci.yml`'s "Marketing E2E" job,
run locally with `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

## web-app

| Page/component                                                        | Claim / CTA                                                                                                                                                                                                                                                                                                    | Verdict                                                                                                                           | Action taken                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/page.tsx` hero                                               | "10M+ Happy Riders", "6 Countries", "4.8★ App Rating"                                                                                                                                                                                                                                                          | overclaim (fabricated numbers, no source)                                                                                         | Removed; replaced with "Availability varies by city. Check the app for what's live near you."                                                                                                                                                                                                           |
| hero floating cards                                                   | "Food Delivered In 25 min", "Package Sent Same day delivery"                                                                                                                                                                                                                                                   | unavailable-implied-live (delivery not live per matrix)                                                                           | Replaced with real, always-true properties of Move ("Fare shown upfront", "PIN-verified pickup")                                                                                                                                                                                                        |
| "One App, Three Services"                                             | Bites/Send copy ("delicious food delivered to your door", "fast and reliable") with "Order Now"/"Send Package" CTAs to `/auth/signup`                                                                                                                                                                          | unavailable-implied-live                                                                                                          | Reworded to "rolling out city by city… not yet on in every market"; CTA text changed to "Check availability"                                                                                                                                                                                            |
| "Available Across Africa" section                                     | Hard-coded 6-country/city grid ("Nigeria: Lagos, Abuja, Ibadan", "Kenya: Nairobi, Mombasa", etc.)                                                                                                                                                                                                              | overclaim (invented — matrix and marketing-site's config only support city-by-city, Nigeria-led launch)                           | Removed the grid; replaced with "UBI launches city by city… Sign in to see exactly what's live where you are"                                                                                                                                                                                           |
| "Ecosystem" cards: Rider/Driver App Store & Play Store links          | `apps.apple.com/app/ubi*`, `play.google.com/…africa.ubi.*`                                                                                                                                                                                                                                                     | broken CTA (G06: no native builds/store listings exist)                                                                           | Removed; replaced with plain "not yet published" text                                                                                                                                                                                                                                                   |
| Driver App "Web App" link                                             | `http://localhost:3002`                                                                                                                                                                                                                                                                                        | broken CTA (dev-only URL, dead in any real deployment)                                                                            | Removed; replaced with honest "Driver sign-up opens with the launch in your city"                                                                                                                                                                                                                       |
| Restaurant/Fleet/Merchant Portal cards                                | "Open Portal" → `http://localhost:3003/3004/3005`                                                                                                                                                                                                                                                              | broken CTA                                                                                                                        | Removed; replaced with "Not yet available — arranged directly with UBI"                                                                                                                                                                                                                                 |
| Admin Dashboard card                                                  | "Staff Only" → `http://localhost:3001`, advertised to public riders                                                                                                                                                                                                                                            | overclaim/inappropriate (internal tool advertised on a public rider page; admin-dashboard is out of this prompt's writable scope) | Card removed entirely from the public page                                                                                                                                                                                                                                                              |
| "Become a Partner" CTA                                                | Links to `/become-driver`, `/restaurant-signup`, `/business`                                                                                                                                                                                                                                                   | broken CTA (routes don't exist — 404)                                                                                             | Links removed; replaced with plain text "Sign-up for these isn't open here yet"                                                                                                                                                                                                                         |
| Footer "For Users"                                                    | Download iOS/Android links to fake store URLs                                                                                                                                                                                                                                                                  | broken CTA                                                                                                                        | Removed; replaced with "not yet published" text                                                                                                                                                                                                                                                         |
| Footer "For Partners"                                                 | Links to `/become-driver` and three `localhost` portal URLs                                                                                                                                                                                                                                                    | broken CTA                                                                                                                        | Replaced with plain text pointing to direct UBI arrangement                                                                                                                                                                                                                                             |
| Footer "Company"                                                      | `/about`, `/safety`, `/privacy`, `/terms` — none of these pages exist                                                                                                                                                                                                                                          | broken CTA                                                                                                                        | Replaced with plain text ("Ubiquiti Mobility Inc.", "Safety and legal pages are published before launch")                                                                                                                                                                                               |
| Footer copyright / metadata authors                                   | "UBI Africa"                                                                                                                                                                                                                                                                                                   | brand consistency                                                                                                                 | Changed to "Ubiquiti Mobility Inc." (footer, `layout.tsx` `authors`/`creator`/`publisher`) per the legal-entity branding this prompt names                                                                                                                                                              |
| Bottom CTA                                                            | "Join millions of users across Africa"                                                                                                                                                                                                                                                                         | overclaim (no traction data exists)                                                                                               | Replaced with "Create an account and request a ride when UBI is live in your city"                                                                                                                                                                                                                      |
| `(app)/home/page.tsx` Bites tab                                       | Full interactive UI: sample restaurant list (`Mama's Kitchen`, ratings, delivery times), food categories, search — all hard-coded sample data                                                                                                                                                                  | unavailable-implied-live                                                                                                          | Replaced with a single honest "Bites isn't on here yet… we don't take orders or sign-ups for it before then" panel                                                                                                                                                                                      |
| `(app)/home/page.tsx` Send tab                                        | Full interactive UI: package size/type pickers, address fields, a "Get delivery quote" button that does nothing on click                                                                                                                                                                                       | unavailable-implied-live + broken CTA (dead-end submit)                                                                           | Replaced with a single honest "Send isn't on here yet" panel                                                                                                                                                                                                                                            |
| `(app)/home/page.tsx` map card                                        | "Nairobi, Kenya … 3 drivers nearby" (hard-coded, not read from any real location/driver feed)                                                                                                                                                                                                                  | overclaim (fabricated live data)                                                                                                  | Reworded to "Set your pickup location / Nearby drivers are shown once you request a ride"                                                                                                                                                                                                               |
| `(app)/home/page.tsx` "Recent" card                                   | Three specific hard-coded saved places (Work/Home/Java House with street addresses) presented as the user's history                                                                                                                                                                                            | overclaim (fabricated personal data)                                                                                              | Replaced with "Your recent places will appear here after your first ride"                                                                                                                                                                                                                               |
| `(app)/home/page.tsx` promo card                                      | "First Ride Free! Use code WELCOME for your first ride up to KES 500 off" with a non-functional "Apply Code" button                                                                                                                                                                                            | overclaim + broken CTA (fabricated promo not backed by any growth-service campaign)                                               | Replaced with a generic, honest "Any offer you're eligible for is shown here with its terms" note                                                                                                                                                                                                       |
| `components/move/ride-booking-card.tsx`                               | "Get ride prices" → `Math.random()`-generated fixed prices with surge multiplier, then "Request {vehicle}" that does nothing (comment: "would navigate to ride tracking page")                                                                                                                                 | overclaim (guaranteed/instant fixed price; the real marketplace has no instant fixed price) + broken CTA (dead-end booking)       | Location search kept (real, harmless); the fake pricing/booking step replaced with an honest explanation of the actual marketplace model (bounded fare, private driver offers, requester selects) and a plain statement that requesting isn't wired up on web yet — no fake price, no fake confirmation |
| `components/navigation/app-header.tsx` user menu                      | Profile/Wallet/Saved Places/Trip History/Promotions/Settings/Help links to `/account/*` routes that don't exist                                                                                                                                                                                                | broken CTA                                                                                                                        | Replaced with one honest line: "Profile, wallet, saved places and support aren't available from this web menu yet"                                                                                                                                                                                      |
| `auth/signup/page.tsx`                                                | "Join millions of riders across Africa"                                                                                                                                                                                                                                                                        | overclaim                                                                                                                         | Changed to "Sign up to request a ride with UBI"                                                                                                                                                                                                                                                         |
| `auth/login`, `auth/signup` forms                                     | Real POST to `/auth/login` / `/auth/register` via `apiClient`, honest error states on failure                                                                                                                                                                                                                  | accurate                                                                                                                          | No change — this is a genuine attempt against a real endpoint, not a faked completion                                                                                                                                                                                                                   |
| `(app)/ask`, `(app)/benefits`, `(app)/travel`, `(app)/trips/[tripId]` | Real TanStack Query calls to `/v1/ask/*`, `/v1/benefits`, `/v1/travel/*`; rides explicitly say "Rides are booked in the app (live driver tracking needs it)" (`trip-items.tsx:70-79`); flight price-guarantee copy only renders when the offer's `priceGuaranteeUntil` field is present (`OfferRow.tsx:31-40`) | accurate                                                                                                                          | No change — these already follow the honest, source-of-truth pattern                                                                                                                                                                                                                                    |

## fleet-portal / merchant-portal / restaurant-portal

All three portals had identical structure: a `/dashboard` page (the only
route that exists in any of them) rendering entirely fabricated data — fake
driver/order/delivery names, fake revenue and acceptance-rate numbers, fake
`recharts` graphs of invented weekly trends, a fake "live map" with
hard-coded lat/lng markers, and sidebar navigation with a dozen-plus links
(`/drivers`, `/vehicles`, `/payouts`, `/analytics`, `/incidents`, `/menu`,
`/pickups`, `/reviews`, `/settings`, `/help`, etc.) to pages that do not
exist anywhere in the app. Headers additionally carried fake live badge
counts ("3 Pickups", "12 active orders", notification badge "3"/"5") and a
fabricated business identity ("Elite Fleet Ltd", "Jumia Fashion",
"Mama's Bistro").

Verdict: **unavailable-implied-live** for the whole dashboard in each
portal (a fully worked, seemingly-live back office over data that isn't
connected to anything real), plus one **broken CTA** per non-existent nav
item (9–10 per portal).

**Action taken (all three portals, same shape):**

- `(portal)/dashboard/page.tsx` rewritten as a single honest "isn't
  available yet" surface naming what's true (no real driver/vehicle/order
  data, arrangements handled directly with UBI) — no mock numbers, no
  charts, no fabricated names.
- `components/layout/navigation.tsx` simplified to the one route that's
  real (`/dashboard`); every other nav item, fake badge count, and
  fabricated business/account persona removed. The sidebar states plainly
  which sections aren't available yet instead of implying they exist.
- Root `layout.tsx` metadata descriptions changed from "manage your X"
  (implies a working product) to "Not yet available — arranged directly
  with UBI" (all three already carry `robots: {index:false, follow:false}`,
  unchanged).
- `e2e/tests/dashboard.e2e.ts` (fleet-portal and restaurant-portal — the
  only portals with real `*.e2e.ts` specs) rewritten to assert the new
  honest empty state and the absence of the old fabricated data, instead of
  asserting the fake stats existed.

**Known gap, not fixed (documented, not touched):** `fleet-portal`'s
`e2e/tests/drivers.e2e.ts` and `vehicles.e2e.ts`, and `restaurant-portal`'s
`menu.e2e.ts` and `orders.e2e.ts` (2,027 lines combined) test `/drivers`,
`/vehicles`, `/menu`, `/orders` — pages that have never existed in either
app. These were already broken before this pass (not caused by it), are not
wired into any CI job (only `apps/marketing-site`'s e2e suite runs in CI —
confirmed via `.github/workflows/ci.yml`), and fixing them would mean
either building those pages (out of scope: "do not rebuild sites") or
deleting ~2,000 lines of test code, which is a bigger call than this
prompt's "smallest honest edit" mandate covers. Flagged here as a
gap-register-worthy finding — see the note at the end of this document.

## Verification run

- `pnpm --filter @ubi/marketing-site test` — 4 files, 15/15 passed.
- `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm --filter @ubi/marketing-site test:e2e` — 73 passed, 3 skipped, 0 failed (76 total, both 1440 and 390 viewports).
- `pnpm exec turbo run build --filter=@ubi/marketing-site --filter=@ubi/web-app --filter=@ubi/fleet-portal --filter=@ubi/merchant-portal --filter=@ubi/restaurant-portal --concurrency=2 --env-mode=loose` — 11/11 tasks successful.
- `tsc --noEmit` clean on web-app, fleet-portal, merchant-portal, restaurant-portal.
- `eslint` on web-app, fleet-portal, merchant-portal, restaurant-portal — 0 errors on all four (pre-existing style warnings only, e.g. `import/order`, `react/function-component-definition`, none introduced by this pass beyond the same pre-existing pattern already present in untouched files).
- `prettier --write` run on every file this pass touched.

## Note for a gap-register addendum

Two findings surfaced here belong in `docs/launch/GAP_REGISTER.md` as new
rows (not edited directly, per this prompt's instructions):

1. **Stale non-CI e2e suites**: `fleet-portal/e2e/tests/{drivers,vehicles}.e2e.ts`
   and `restaurant-portal/e2e/tests/{menu,orders}.e2e.ts` assert pages that
   were never built and are not run anywhere in CI. They should either be
   deleted or gated with an explicit "pending" skip until those pages exist,
   so a future contributor doesn't mistake them for coverage.
2. **web-app duplicates marketing-site's public landing surface** with a
   second, independently-maintained homepage (`apps/web-app/src/app/page.tsx`)
   that had drifted from the matrix (this pass corrected the copy, but the
   duplication itself is a standing risk: the two sites can drift again).
   Consider redirecting web-app's `/` to the marketing site, or deleting the
   duplicate content, as a follow-up architectural decision (out of scope
   for a "smallest honest edit" pass).
