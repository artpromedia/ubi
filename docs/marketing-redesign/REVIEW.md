# UBI marketing redesign

Reviewed baseline: cc5a9d3 (master), 13 September 2026.
Scope: repository implementation of apps/marketing-site, not a verified live-domain audit.

## Findings

The marketing site did not reflect the latest RN, Ask UBI, travel and growth merge. The existing hero claimed six live countries, 10M+ active users, 500K+ drivers and 50+ cities without supporting evidence in the page. Download content supplied unverified ratings, download counts and an SMS shortcode. Testimonials were hardcoded. The homepage displayed an explicit mockup placeholder. Header/footer advertised routes absent from the marketing app; login/signup paths also differed from the consumer web app's /auth routes. Metadata claimed market leadership and published language alternates for routes that did not exist.

These findings block calling the old page market ready. Backend code presence alone does not verify commercial availability, store approval, safety operations or provider readiness.

## Implemented design

A responsive Next.js/React homepage with the existing UBI SVG wordmark, forest green typography, warm off-white canvas, illustrated route hero, three service cards, a driver acquisition section, qualified Ask UBI/travel sections, expandable FAQs and separate rider/driver access cards. It has no invented usage statistics, ratings, testimonials, earnings or commission promises. The hero illustration is conceptual artwork, not a purported app screenshot or live map.

All section navigation resolves locally. External conversion/legal links are server-side environment configuration; only HTTPS URLs render. Missing destinations produce visible launch-status copy instead of dead or fabricated links. No personal information is collected by this page. Existing unused legacy section components are retained but no longer imported by the homepage.

## Release requirements

1. Populate verified UBI_RIDER_URL, UBI_DRIVER_URL, UBI_IOS_STORE_URL and UBI_ANDROID_STORE_URL as applicable. Confirm the URLs belong to the actual UBI product and preserve the production app identifiers. See apps/marketing-site/.env.example. These variables are read at render/build time; rebuild after changes for static deployment.
2. Supply approved UBI_PRIVACY_URL and UBI_TERMS_URL before public launch. This change does not invent legal policy text.
3. Confirm enabled cities and services against operational configuration. Market-specific pages and availability claims require actual launch data. Until then this is a truthful prelaunch homepage, not an assertion that all services are live.
4. Verify every destination on real devices, including installed/uninstalled RN app behavior. React Native remains the mobile implementation; this marketing site is Next.js and does not replace either native app.
5. Enable analytics only through the project's consent and attribution approach. Track rider access, driver applications and store outbound clicks; never put personal data in URLs. No tracking vendor has been introduced in this change.
6. Test production booking and driver onboarding separately. A polished marketing page cannot certify those transactional journeys.

## Follow-on Claude Design prompt

Continue the existing implementation in apps/marketing-site; do not restart UBI branding or mobile migration. Refine this green/cream design using the supplied brand SVGs. Produce desktop 1440px and mobile 390px designs for verified city/service landing pages and driver onboarding entry, using existing production routes and real service availability. Supply React component slices and tokens, loading/error/unavailable states and keyboard behavior. Use real approved RN screenshots only when available. Never fabricate ratings, users, fares, driver income, promotional percentages, safety guarantees or store badges. Preserve the same semantic hierarchy, accessible contrast, and separate rider/driver conversion paths.

## Follow-on Claude Code prompt

Read this review and the current marketing implementation first. Resolve the release requirements using verified deployment configuration. Reuse actual operational city/service availability and the existing growth attribution/consent contracts; do not create parallel availability or promotion engines. If adding a waitlist, implement a persistent, rate-limited API with validated consent, errors, retries and duplicate handling before showing a success state. Maintain RN for Rider/Driver; use Next.js/React for marketing. Verify all outbound destinations, local anchors, mobile layouts, metadata and production builds. Remove or archive unused legacy section components only after checking their import graph. Do not publish unsupported commercial claims or silently activate unavailable features.

## Validation performed

- TypeScript check passed for the new homepage/layout in an isolated environment using React 19 and Next.js 15.5.25 (within the application's declared Next.js range).
- Production build passed and statically generated the homepage in that isolated environment. This is not a full monorepo build or locked-dependency CI result; legacy unused components were not part of the isolated check.
- Browser screenshot/responsive interaction verification remains pending because the Chromium download timed out in this environment. The responsive CSS is implemented but visual QA must be completed before release.
- No live site was deployed, no operational availability was assumed, and no production transaction was executed.
