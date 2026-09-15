# Handoff: UBI marketing — city/service landing pages + driver onboarding entry (board 24)

Target: **apps/marketing-site** in artpromedia/ubi (Next 15 · React 19 · Tailwind · @ubi/ui). Continues the green/cream homepage redesign described in the 13 Sep review; does not restart branding or touch the RN migration.

## About the design files
`design/Marketing 24 — City Pages + Driver Entry.dc.html` is a **design reference built in HTML** (serve `design/` statically, e.g. `npx serve design`; anchors #24a … #24e). It shows look, copy, states and keyboard behaviour; it is not production code. Recreate it as Next.js server components in `apps/marketing-site` using the slices in `src/` here.

## Fidelity
**High-fidelity.** Recreate pixel-close at 1440 and 390: colours, type, spacing and copy are final (`tokens/marketing.css`). Poppins 600 for headings, Inter for body. Every visible fact about availability comes from config-service at request time; every external link from environment.

## What is true in the repo (read 13 Sep 2026, master cc5a9d3)
- `apps/marketing-site` on master is the **old** site (hero stats, six countries, testimonials, phone mockup, nav to routes that don't exist). The redesigned homepage from the review lives on its own branch — merge order: homepage PR first, then this.
- **One city is configured: Lagos (LOS)** — `services/config-service/src/seed/lagos.ts`. Flags on for Lagos: `move`, `ride_request`, `driver_online`. Off: `bites`, `send`, `travel`, `stays`, `reservations`, `ai_assistant`, `flights_booking`, `stays_booking`, `rider_promotions`, `referrals` … (`packages/contracts/src/flags.ts`, deny-by-default, absent = off).
- City config (`GET /v1/config/cities/{cityId}`, `CityConfigSchema`): currency NGN, classes `go/comfort/xl`, payment methods cash/card/bank_transfer/wallet, waitPolicy 300 s free, pinRequired, emergency 112, airport doors for LOS, serviceFeePct 20, cancelPolicy. **Fares are provisional pending finance sign-off — never render a fare.**
- Flags: `GET /v1/flags?cityId=` returns a flag map with `Cache-Control: private, no-store`. Call it server-side with a service credential; unreachable ⇒ `DENY_ALL` ⇒ the page states it cannot confirm availability.
- Production routes that exist: consumer web `/auth/login`, `/auth/signup` (apps/web-app); driver web `/auth/signup`, `/onboarding`, `/documents` (apps/driver-app — its document list is a Kenya-flavoured mock; the Lagos list must come from user-service, see below). RN apps are the mobile delivery (design_handoff_ubi_rn_migration).
- Lagos driver document set (launch board 3c/13b): driver's licence, LASDRI card, NIN identity + selfie/liveness, vehicle registration, roadworthiness, third-party insurance, background check. Served by user-service; if the endpoint doesn't exist yet, add `GET /v1/kyc/requirements?cityId=&role=driver` (specified in `src/lib/requirements.ts`) — do not hard-code the list in the marketing site.

## Launch plan and city status (owner, 13 Sep 2026)
Lagos and Abuja launch **together, on the same day**; with **Move, Bites, Send and Flights & stays all live on launch day in both cities** (Ask UBI stays off); expansion planned to Port Harcourt, Ibadan, Benin City, Enugu, Uyo, Calabar, Asaba, Onitsha. Only Lagos is seeded today and only `move`/`ride_request`/`driver_online` are on; Send (slice 06) and travel (NEW-02) services must ship before their flags can be switched on — the site follows the flags, it never leads them. Required in config-service (specified): `City.status ∈ {planned, launching, active, paused}` (keep `active` as a derived boolean for existing readers), an Abuja city row + provisional config (ABV airport doors, NGN, 112, Africa/Lagos) under the same sign-off as Lagos, both cities activated and their flags switched on in **one approved change** (neither may read live before the other), and the eight planned cities as `planned` rows. Until launch day both launch cities carry status `launching`. The marketing site renders **only** from these rows: active ⇒ services from flags; launching ⇒ "coming, no date", driver CTA only (both launch cities pre-launch); planned ⇒ named on `/cities` and a short noindex page; unknown id ⇒ 404. The planned list is never a constant in the site.

## Start here for Claude Code
`CLAUDE_CODE_PROMPT.md` (paste-ready) · `COMPLETENESS.md` (what is designed, coded, specified, and the honest gaps) · `CLOSING_THE_GAPS.md` (steps + evidence per gap) · `ACCEPTANCE.md` (states, keyboard, Playwright).

## Pages
| Route | Board | Data | Notes |
|---|---|---|---|
| `/cities/[cityId]` | 24a desktop · 24b mobile · 24c states | city config + flags | `generateStaticParams` from active cities; `revalidate = 300` + on-demand revalidate on `config.version_activated` / flag change; unknown city ⇒ `notFound()` with the 24c body |
| `/cities` | (index, specified) | active cities | lists only cities with an activated config; one card per city → `/cities/[cityId]` |
| `/help` | 24g desktop + mobile | city config (emergency), `UBI_SUPPORT_PHONE` | routes to in-app support; anchors #riders #drivers #travel |
| `/drive` | 24d desktop · 24e mobile | city config (serviceFeePct, classes, emergency, cancelPolicy) + driver requirements | city chosen from `?city=` or the only active city; later `/drive/[cityId]` |

## Hero city carousel
One iconic, licensed photograph per city at `/public/marketing/cities/{cityId}.jpg` (Lagos: Lekki-Ikoyi Link Bridge or Marina; Abuja: Zuma Rock or the National Mosque), alt + caption + credit from the city record (specified) or `src/lib/city-images.ts`. The city page opens on its own city; `/cities` shows all active cities and auto-advances (6 s, pauses on hover/focus, off under reduced motion). Launch photos are openly licensed from Wikimedia Commons and carry a visible credit (LOS: dotun55, CC BY-SA 2.0; ABV: Jeff Attaway, CC BY 2.0; sources in `src/lib/city-images.ts`). Download the originals into `/public/marketing/cities/`, keep the credit overlay, or replace with UBI-owned photography. No app screenshots, no stock of other cities.

## Route map
Every link on these pages lands on a designed page: header Ride → `/` (homepage redesign branch) · Drive → `/drive` (24d/24e) · Cities → `/cities` (24f) · Help → `/help` (24g) · city cards → `/cities/[cityId]` (24a/24b, states 24c incl. 404) · Log in → `UBI_RIDER_URL/auth/login` (exists) · service links → `UBI_RIDER_URL` home, Book travel → `UBI_RIDER_URL/travel` (board 23f) · driver CTAs → `UBI_DRIVER_URL` (driver web `/auth/signup`, exists) · stores, fleet, legal, safety line → env, missing ⇒ launch-status copy. Copy contains no em dashes.

## Destinations (environment, HTTPS only, server-read)
`UBI_RIDER_URL` · `UBI_DRIVER_URL` · `UBI_IOS_STORE_URL` · `UBI_ANDROID_STORE_URL` · `UBI_DRIVER_IOS_STORE_URL` · `UBI_DRIVER_ANDROID_STORE_URL` · `UBI_PRIVACY_URL` · `UBI_TERMS_URL` · `UBI_FLEET_CONTACT_URL` · `UBI_HELP_URL` · `UBI_SUPPORT_PHONE` (safety line, shown on /help only when set). See `.env.example.additions`. A missing or non-https value renders launch-status copy through `DestinationLink` — never a dead link, never a fabricated badge. No waitlist form exists because no persistent, rate-limited waitlist API exists.

## Deliverables here
`tokens/marketing.css` + `tokens/tailwind.extend.ts` · `src/lib/{availability,destinations,requirements}.ts` · `src/components/marketing/*.tsx` (SkipLink, SiteHeader, MobileMenu, StatusPill, DestinationLink, ServiceCard, ServicesGrid, AvailabilityNotice, Steps, Faq, AccessCards, RequirementsList, SiteFooter) · `src/app/cities/[cityId]/{page,not-found}.tsx` · `src/app/drive/page.tsx` · `ACCEPTANCE.md` (states, keyboard, Playwright) · `CLAUDE_CODE_PROMPT.md`.
Path note: `-cityId-` in this package = the dynamic segment `[cityId]`.

## Honesty labels
**verified** = read in source · **specified** = designed and contracted here · **unverified build** = every `.tsx` here (no compiler in this environment). Nothing here asserts that any service beyond Lagos rides is live.
