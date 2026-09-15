# Paste-ready Claude Code prompt — marketing city pages + driver entry

Read the 13 Sep marketing review and the current `apps/marketing-site` implementation first (the redesigned homepage branch, then master). Then read `design_handoff_ubi_marketing/README.md`, `COMPLETENESS.md`, `CLOSING_THE_GAPS.md`, `ACCEPTANCE.md` and open `design/` (board 24) for pixel reference.

Implement in `apps/marketing-site` (Next 15, React 19, Tailwind, @ubi/ui; keep the homepage's tokens — reconcile `tokens/marketing.css` with the homepage branch's variables and use one set):

1. `/cities/[cityId]` and `/cities` from `src/app/cities/**`: server components; availability from `src/lib/availability.ts` (config-service `GET /v1/config/cities/:id` + `GET /v1/flags?cityId=` with a server-side service credential; `DENY_ALL` when unreachable; never a fare). Unknown city ⇒ `notFound()` rendering `not-found.tsx` (noindex). `revalidate = 300` plus an on-demand revalidation route triggered by `config.version_activated` and flag-change events (reuse the outbox consumer pattern).
2. `/drive` from `src/app/drive/page.tsx`: requirements from user-service. If `GET /v1/kyc/requirements?cityId=&role=driver` does not exist, add it to user-service from the document types already used for driver KYC (Lagos set on board 3c/13b) — do not hard-code documents in the marketing site. No earnings figures, no review-time promises; `serviceFeePct` from city config is the only number.
3. All outbound links through `DestinationLink` (`src/lib/destinations.ts`): https-only from the named env variables in `.env.example.additions`; missing ⇒ launch-status copy, not a link. Build must log unset destinations. Header/footer link only to routes that exist.
4. Keyboard and a11y exactly as `ACCEPTANCE.md`: skip link, native disclosure FAQ, dialog menu with focus trap and Esc, `:focus-visible` ring, contrast table, reduced motion, one h1, landmarks.
5. Analytics only through the existing growth attribution/consent contract (`marketing_city_viewed`, `marketing_cta_clicked`); no personal data in URLs; no new vendor.
6. Playwright: the list in `ACCEPTANCE.md` (states via mocked config-service responses: ok, DENY_ALL, unknown city; env present/missing; keyboard flows at 1440 and 390). `next build` green in the monorepo, not only isolated.

Do not: add a waitlist without a persistent rate-limited API; publish counts, ratings, testimonials, fares, earnings, promo percentages or safety statistics; show any service as live unless its flag is on for that city; use WebViews or touch the RN apps; invent legal text.

Finish with: implemented paths, screenshots at 1440/390 for each state, Playwright results, the list of env variables still unset in each environment, and anything externally blocked (credentials, store listings, legal URLs).
