# Completeness check — marketing city pages, driver entry, help (board 24) · 14 Sep 2026

Legend: **designed** = hi-fi on board 24 · **code** = React/Next file in `src/` · **specified** = contracted in words only · **gap** = stated, not done here.

## Routes the site links to, and where each lands
| Route | Board | Viewports | Code | Data | Status |
|---|---|---|---|---|---|
| `/cities/[cityId]` active (Lagos; Abuja renders the same template from its own config) | 24a, 24b | 1440, 390 | `app/cities/-cityId-/page.tsx`, `ServicesGrid`, `ServiceCard`, `CityCarousel`, `Steps`, `AccessCards`, `Faq` | city config + flags (server-side, DENY_ALL on failure) | designed + code |
| `/cities/[cityId]` launching · planned · unknown | 24c | cards | `PreLaunch.tsx`, `not-found.tsx` | city row status | designed + code |
| `/cities/[cityId]` loading · availability unknown · destination missing | 24c | cards | `ServicesGrid` skeleton, `AvailabilityNotice`, `DestinationLink` pending | — | designed + code |
| `/cities` | 24f | 1440 | `app/cities/page.tsx` | city rows grouped active/launching/planned | designed + code · mobile follows 24b rules (specified) |
| `/drive` | 24d, 24e | 1440, 390 | `app/drive/page.tsx`, `RequirementsList`, `Steps` | city config (serviceFeePct, classes, emergency), driver requirements from user-service | designed + code |
| `/help` | 24g | 1440, 390 | `app/help/page.tsx` | static topics + `DestinationLink` for support/legal | designed + code |
| `/` (homepage) | review branch | — | not in this package | — | out of scope; tokens must be reconciled on merge |
| Header: Ride → `/`, Drive → `/drive`, Cities → `/cities`, Help → `/help`; Log in / Get the app → `UBI_RIDER_URL`; Driver log in / Apply → `UBI_DRIVER_URL` | all | — | `SiteHeader`, `MobileMenu`, `DestinationLink` | env | every nav target exists or is env-gated with launch-status copy |
| Footer: city links → `/cities/[id]`; Privacy / Terms / Help → env | all | — | `SiteFooter` | env | same |

## Launch facts encoded (owner, 13–14 Sep)
Lagos and Abuja launch together on the same day · Move, Bites, Send and Flights & stays launch together in both cities · Ask UBI stays "Not yet available" until `ai_assistant` is on · expansion planned: Port Harcourt, Ibadan, Benin City, Enugu, Uyo, Calabar, Asaba, Onitsha (planned rows, no dates, no sign-ups) · activation of both cities' configs and flags in one approved change, with a guard that fails if only one launch city is active.

## Truth rules honoured
No usage counts, ratings, testimonials, fares, earnings, promo percentages, safety statistics, store badges without a store URL, dates for planned cities, or waitlist (no waitlist API exists) · every "Live" pill maps to a flag; every fact on the Rides card maps to a config field · hero photos are openly licensed with visible credit, or replaced by UBI-owned photography · no em dashes in customer copy.

## Accessibility and keyboard
Skip link · one h1 per page · landmarks · `aria-current` · dialog menu with focus trap, Esc, focus return, scroll lock · native disclosure FAQ · carousel: `role="region"` + `aria-roledescription="carousel"`, dots as `tablist`, arrows as buttons, autoplay off, reduced-motion honoured · CTAs are `<a href>` only · focus ring 3 px UBI green · contrast table on 24e · 44 px targets · zoom 200%.

## Gaps stated honestly
1. Every `.tsx` is **unverified build** (no compiler here). `@ubi/ui` export names and the homepage branch's CSS variables must be reconciled on merge.
2. `/cities` and `/help` were drawn at 1440 (help also at 390); `/cities` mobile is specified by the 24b responsive rules, not drawn.
3. Abuja's city page is rendered by the same template from Abuja's config; the board shows the Lagos instance. Abuja config (ABV doors, region FCT) does not exist in the repo yet.
4. `City.status` on config-service and `GET /v1/kyc/requirements` on user-service are specified, not implemented; until they exist the site falls back to `active` boolean and hides the requirements list.
5. Hero photos are hotlinked from Wikimedia Commons on the board; production must download originals to `/public/marketing/cities/` and keep the credit (CC BY-SA 2.0 for the Lagos image).
6. No Playwright or Lighthouse has been run; `ACCEPTANCE.md` lists what must pass.

How to close each: `CLOSING_THE_GAPS.md`.
