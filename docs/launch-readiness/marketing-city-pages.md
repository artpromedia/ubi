# Marketing city pages, driver entry and help (board 24)

Implements `docs/launch-readiness/handoff-marketing` (README, ACCEPTANCE,
COMPLETENESS, CLOSING_THE_GAPS) on top of the homepage redesign
(`docs/marketing-redesign/REVIEW.md`). Everything visible about availability is
read from config-service at request time; every external link comes from the
environment; nothing is asserted that a flag or a city row does not say.

## Routes (apps/marketing-site)

| Route              | Board    | Renders from                                                                     |
| ------------------ | -------- | -------------------------------------------------------------------------------- |
| `/`                | redesign | shared header/footer (city rows); homepage body unchanged                        |
| `/cities`          | 24f      | `GET /v1/config/cities` grouped active / launching / paused / planned            |
| `/cities/[cityId]` | 24a/b/c  | city row + active config + flags; pre-launch, planned, paused, unknown (404)     |
| `/drive`           | 24d/e    | city config (serviceFeePct, classes, emergency) + `GET /v1/kyc/requirements`     |
| `/help`            | 24g      | emergency number from config, safety line from `UBI_SUPPORT_PHONE`               |
| `/api/revalidate`  | backend  | bearer `UBI_REVALIDATE_SECRET`; purges the `availability` / `requirements` cache |

Pages render per request (`connection()`); reads go through the Next data cache
(`unstable_cache`, 300 s, tag `availability`) and are purged on demand by
config-service's marketing consumer on `config.version_activated`,
`flag.changed` and `city.status_changed`. A failed upstream read throws inside
the cache, so an outage is never stored as an answer.

## Backend additions

- `packages/contracts`: `CITY_STATUSES` / `CitySummarySchema`, error code
  `launch_pair_incomplete` (409), event `city.status_changed`.
- `packages/database`: migration `20260915011211_city_status_and_launch_rows`
  (`cities.status`, `region`, `launch_group`; `active` backfilled and derived).
- `services/config-service`: `GET /v1/config/cities`,
  `POST /v1/config/cities/status` (audited, idempotent, flags in the same
  transaction, launch-pair guard), seeds for Abuja (provisional config, no flags)
  and the eight planned rows, Lagos and Abuja `launching` in one launch group,
  `marketing-revalidate.ts` consumer (`MARKETING_REVALIDATE_URL` / `_SECRET`).
- `services/user-service`: `GET /v1/kyc/requirements?cityId=&role=driver` (and
  the gateway-stripped `/kyc/requirements`); Lagos set with LASDRI, Abuja
  without.

## Environment per deployment

Set only verified HTTPS destinations. Unset or `http://` values render
launch-status copy (never a dead link); the build log and the server log list
them (`reportUnsetDestinations`). No value below exists in the repository;
each is an external decision.

| Variable                                                                                                 | dev            | staging | production |
| -------------------------------------------------------------------------------------------------------- | -------------- | ------- | ---------- |
| `UBI_RIDER_URL`, `UBI_DRIVER_URL`                                                                        | unset          | unset   | unset      |
| `UBI_IOS_STORE_URL`, `UBI_ANDROID_STORE_URL`, `UBI_DRIVER_IOS_STORE_URL`, `UBI_DRIVER_ANDROID_STORE_URL` | unset          | unset   | unset      |
| `UBI_PRIVACY_URL`, `UBI_TERMS_URL`, `UBI_FLEET_CONTACT_URL`, `UBI_HELP_URL`, `UBI_SUPPORT_PHONE`         | unset          | unset   | unset      |
| `UBI_CONFIG_BASE_URL`, `UBI_CONFIG_SERVICE_TOKEN`, `UBI_USER_BASE_URL`                                   | local services | unset   | unset      |
| `UBI_REVALIDATE_SECRET` (site) = `MARKETING_REVALIDATE_SECRET` + `MARKETING_REVALIDATE_URL` (config)     | unset          | unset   | unset      |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (analytics after consent; unset ⇒ dropped)         | unset          | unset   | unset      |

## Externally blocked

- Store listings (App Store, Google Play, both apps) and their URLs.
- Privacy policy and terms URLs (legal). No legal text was invented.
- The UBI safety line number.
- Service credentials for the marketing site's server-side reads.
- Finance sign-off on the provisional Lagos and Abuja configs; ops confirmation
  of the Abuja airport door labels.
- Launch day itself: `POST /v1/config/cities/status` with `cityIds: [LOS, ABV]`,
  `status: active` and the launch flags, by a config admin. The guard refuses
  one city without the other.

## Verification

- `pnpm --filter @ubi/marketing-site typecheck`, `test` (vitest), `build`.
- `pnpm --filter @ubi/marketing-site test:e2e`: Playwright against mocked
  services, every ACCEPTANCE state at 1440 and 390, keyboard flows, route crawl,
  carousel, content rules, axe. CI job `marketing-e2e` (required).
- `pnpm --filter @ubi/config-service test` (real Postgres + Redis) and
  `pnpm --filter @ubi/user-service exec vitest run tests/kyc`.
- Photo licences: `apps/marketing-site/THIRD_PARTY_NOTICES.md`.
