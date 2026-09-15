# Acceptance — marketing city pages + driver entry

## Visual (pixel-close to board 24)
| Board | Route | Viewport | Must match |
|---|---|---|---|
| 24a | /cities/lagos | 1440 | hero 2-col with city photo carousel (opens on Lagos; arrows, dots, keyboard Left/Right, swipe; caption names place + city), status pill "Live · rides, food, packages, travel" + timezone line, 3-col grid with Move spanning 2 and facts <dl>, Bites/Send/Travel live cards with links, Ask dashed, forest steps card + safety card, rider/driver access cards, FAQ, footer |
| 24b | /cities/lagos | 390 | single column, CTAs stacked rider-first, artwork below CTAs, cards full width, menu sheet |
| 24d | /drive | 1440 | driver header (green CTAs), requirements aside, 5-step row (last forest), pay + safety cards |
| 24e | /drive | 390 | stacked; steps as list rows |
| 24g | /help | 1440 + 390 | urgent band (112 from config, safety line or "Published at launch"), three entry cards, three FAQ columns, safety + data cards |
| 24f | /cities | 1440 | Live now + Launching cards side by side, Planned next chip list, footer |

## States (each has a Playwright test with mocked config-service)
| State | Trigger | Expected |
|---|---|---|
| loading | slow /v1/flags | hero + CTAs painted; grid skeleton with aria-busy; no "Live" pill before flags resolve; no shimmer with reduced motion |
| ok · launch day (Lagos, Abuja) | move, ride_request, bites, send, flights_booking, stays_booking on | Move Live with facts from config (classes, pay methods, pickup, airport doors, emergency); Bites, Send, Flights & stays Live with their bodies and links; Ask UBI "Not yet available"; no fare, fee or count anywhere |
| ok · today (Lagos seed) | seed flags only | Move Live; Bites/Send "Not yet in Lagos"; Travel/Ask "Not yet available" |
| service flips on | flags.bites=true | Bites card becomes Live with its body; no other change; on-demand revalidate refreshes within one request |
| availability unknown | /v1/flags 500 or unreachable | AvailabilityNotice (role=status), zero service cards, CTAs present, response not cached as ok |
| launching cities (Lagos + Abuja pre-launch) | city row status=launching | PreLaunch: "coming", no date, driver CTA + link to live cities, indexable, no services grid |
| planned city (e.g. PHC) | city row status=planned | PreLaunch planned variant: intent only, noindex, no CTAs |
| launch-day consistency | one launch city active, the other not | server-side guard fails the activation; site never shows one launch city live without the other |
| cities index | rows active/launching/planned | 24f grouping; active card body derived from flags/config; planned chips from rows; zero rows ⇒ status notice |
| unknown city | id not in /v1/config/cities and config 404 | HTTP 404, not-found body, noindex, link(s) to active cities, no form |
| destination missing | unset UBI_IOS_STORE_URL etc. | pending notice span (aria-disabled, not focusable) in place of link; build log lists the variable |
| destination non-https | http:// value | treated as missing |
| requirements unavailable | user-service 500 | requirements list hidden with status text; CTA stays; nothing hard-coded appears |

## Keyboard / a11y (axe + manual at 1440 and 390)
Skip link first tab stop, visible on focus, moves focus to #main · header order logo → nav → CTAs · aria-current on current page · menu: Enter/Space opens, focus on first link, Tab cycles inside, Esc closes and returns focus to the button, body scroll locked · FAQ buttons toggle with Enter/Space, aria-expanded/aria-controls, panels hidden attribute · all CTAs are <a href> · focus ring 3px UBI green offset 3 (cream on forest) · contrast per board table · one h1 · landmarks · images alt / aria-hidden artwork · zoom 200% and 320 px no horizontal scroll · text ≥ 14 px.

## Route coverage (Playwright)
Crawl both pages plus /cities, /help: every internal href resolves 200 (or intended 404 for unknown cities); every external anchor is https; every DestinationLink without env renders the pending span; no anchor has href="#" or an empty href.

## Carousel (Playwright + axe)
Opens on the page's city · arrows and dots change slide · Left/Right keys work when the region is focused · swipe ≥ 40 px changes slide on touch · auto-advance only on /cities, pauses on hover/focus, none under reduced motion · every image has alt; captions name place and city · a licensed photo renders its credit (author, source, licence) and the credit links to the source · missing image file ⇒ slide omitted, never a broken image.

## Content rules (lint test on rendered HTML)
No em dash (U+2014) in rendered copy · No digits followed by "+" or "M"/"K" users/drivers/cities · no "★" or "rating" · no "₦" except serviceFeePct context (which has none) — fail if any "₦" renders on these routes · no "guarantee" · no store badge images unless the store URL is set.

## Analytics
marketing_city_viewed{cityId, liveServices[]} on render · marketing_cta_clicked{cta, destinationSet} on DestinationLink click (data-analytics) via the existing consent-gated client; nothing before consent; no PII in URLs.

## Build
`pnpm -F @ubi/marketing-site typecheck && build` in the monorepo (not isolated); Playwright suite green; Lighthouse a11y ≥ 95 on both routes at both viewports.
