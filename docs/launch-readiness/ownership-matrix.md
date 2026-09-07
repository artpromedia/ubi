# Route, event and data ownership

Which service owns which HTTP surface, which events it publishes, and which
tables it may migrate. The last column is the important one: **two services must
never migrate the same table.**

Status is measured, not aspirational: **live** means implemented and covered by
tests on this branch; **partial** means implemented but not fully verified;
**contract only** means the OpenAPI document exists and nothing implements it.

---

## 1. HTTP surface

Everything is mounted under `/v1` at the gateway. The rider web client's
`http://localhost:4000/api` default is wrong and is tracked in the audit.

| Route | Owner | Status |
|---|---|---|
| `GET /v1/config/cities/:cityId` | config-service | **live** |
| `GET /v1/config/cities/:cityId/history` | config-service | **live** |
| `POST /v1/config/change-requests` | config-service | **live** |
| `POST /v1/config/change-requests/:id/approve` | config-service | **live** |
| `GET /v1/flags`, `GET/POST /v1/flags/:key` | config-service | **live** |
| `GET /v1/wallet` | payment-service | **live** |
| `GET /v1/wallet/recipients/lookup` | payment-service | **live** |
| `POST /v1/wallet/transfers` | payment-service | **live** |
| `POST /v1/wallet/transfers/:id/return-request` (+ `/respond`) | payment-service | **live** |
| `POST /v1/wallet/disputes` | payment-service | **live** |
| `GET/POST /v1/wallet/requests`, `POST /v1/wallet/requests/:id/pay` | payment-service | **live** |
| `GET /v1/wallet/nip/name-enquiry`, `POST /v1/wallet/nip` | payment-service | **live** |
| `POST /v1/wallet/nip/callbacks` (bank webhook, signed) | payment-service | **live** |
| `POST /v1/wallet/topups` | payment-service | **live** |
| `POST /v1/wallet/pin`, `POST /v1/wallet/pin/reset`, `POST /v1/wallet/lock` | payment-service | **live** |
| `GET /v1/wallet/statements` | payment-service | **live** |
| `GET /v1/finance/recon/:date`, `POST /v1/finance/recon/:date/close` | payment-service | **live** |
| `POST /v1/quotes`, `POST /v1/rides`, `GET /v1/rides/active`, `GET /v1/rides/:id` | ride-service | in progress |
| `POST /v1/offers/:id/accept` | ride-service | in progress |
| `POST /v1/rides/:id/{arrived,verify-pin,start,complete,cancel}` | ride-service | in progress |
| `POST /v1/drivers/me/status`, `POST /v1/drivers/me/locations` | ride-service | in progress |
| `POST /v1/devices/enroll`, `POST /v1/auth/step-up/selfie` | user-service | not started |
| `GET/POST /v1/drivers/me/documents` | user-service | not started |
| `POST /v1/safety/sos` | support-service | not started |
| `POST /v1/support/cases`, `POST /v1/support/cases/:id/remedies` | support-service | not started |
| `GET /v1/reviews/:queue` | support-service | not started |
| `/v1/flights/*`, `/v1/desk/*` | flights-service | contract only |
| `/v1/journeys/*`, `/v1/rides/reservations`, `/v1/reservations/*` | journey-service | contract only |
| `/v1/stays/*`, `/v1/hotels/me/*`, `/v1/partners/hotels` | stays-service | contract only |
| `/v1/fleets/*`, `/v1/fleet-offers/*`, `/v1/drivers/me/fleet*` | fleet-service | contract only |
| `/v1/bites/*`, `/v1/merchants/*`, `/v1/carts/*`, `/v1/orders/*` | food-service | **blocked** (see below) |
| `/v1/shipments/*`, business API | delivery-service | not started |

`flights-service`, `journey-service`, `stays-service` and `fleet-service` do not
exist as directories. Their contracts are vendored in `contracts/openapi/`.

---

## 2. Table ownership

One owner per table. The owner is the only service that may migrate it; everyone
else reads through that service's API, not the database.

| Owner | Tables |
|---|---|
| config-service | `cities`, `city_config_versions`, `config_change_requests`, `config_approvals`, `feature_flags`, `flag_rules` |
| payment-service | `wallets`, `journal_entries`, `journal_lines`, `transfers`, `transfer_requests`, `return_requests`, `nip_transfers`, `topups`, `statements`, `split_rules`, `remittances`, `recon_runs`, `recon_rails`, `recon_breaks` |
| user-service | `devices`, `step_up_challenges`, `sim_swap_signals`, `documents`, `identity_cases`, `face_checks` |
| support-service | `support_cases`, `case_events`, `remedies`, `safety_cases`, `review_decisions` |
| ride-service | `rides` and its own migrations under `services/ride-service/migrations/` |
| **shared, no single owner** | `audit_log`, `outbox_events` |

`audit_log` and `outbox_events` are append-only and written by every service in
the same transaction as the change they record. Nothing updates or deletes a row
in either. That is what makes shared ownership safe here; it would not be for a
mutable table.

### Ownership conflicts that are not yet resolved

- **`merchants` and `menu_items`** already exist as `Merchant` and `MenuItem`
  with a different shape from the slice 05 DDL. Unresolved (ADR 0001 §8).
- **Two ledgers.** `wallet_accounts` / `ledger_entries` / `transactions` (old)
  and `wallets` / `journal_entries` / `journal_lines` (new) both model money in
  payment-service. Only the new one is balance-enforced by the database.
  Retirement of the old set is unscheduled (ADR 0001 §4).

---

## 3. Events

Producers, from `contracts/events/catalog.md`. Everything goes through
`outbox_events` in the same transaction as its state change, and consumers are
idempotent on the event id.

| Producer | Events | Status |
|---|---|---|
| config-service | `config.version_activated`, `flag.changed` | **live** |
| payment-service | `transfer.*`, `request.*`, `nip.*`, `topup.captured`, `pin.*`, `cooling.started`, `recon.*` | **live** |
| ride-service | `quote.*`, `ride.*`, `offer.*`, `matching.*` | in progress |
| user-service | `device.*`, `step_up.*`, `wallet.safe_mode_*`, `document.*`, `face_check.failed`, `identity.case_*`, `driver.*` | not started |
| support-service | `case.*`, `remedy.posted`, `safety.sos_raised`, `incident.created` | not started |
| food-service | `order.*`, `merchant.*`, `menu.item_unavailable`, `store.paused`, `refund.posted` | blocked |
| delivery-service | `shipment.*`, `sender.decision`, `claim.*` | not started |
| flights/journey/stays/fleet | `booking.*`, `flight.*`, `oneticket.*`, `journey.*`, `leg.*`, `reservation.*`, `stay.*`, `hotel.*`, `fleet.*`, `remittance.*` | contract only |

The event-name set is closed in `packages/contracts` (`EVENT_NAMES`), and
`assertKnownEventName` refuses anything outside it — a producer cannot invent an
event no consumer knows how to render.

---

## 4. Why `food-service` is blocked rather than merely unstarted

It does not compile: 116 type errors, almost all references to Prisma models
(`menuCategory`, `order`, `review`, `reviewReport`, …) that exist in **no schema
file in this repository**. It was written against a data model that has never
been here, so the model must be designed before slice 05 can start. Detail in
`current-state.md` §6.

`notification-service` has the same problem on a smaller scale (55 errors,
`notificationTemplate`, `notificationLog`, `notificationPreference`,
`inAppNotification`).
