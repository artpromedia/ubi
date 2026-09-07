# Slice 01 — Foundations: tokens, city config, feature flags
Board: 1a (foundations), 12a (config & flags console), 5d (gating).

## Goal
Every number, currency, policy and tile the apps show comes from a versioned city config + flags service. Both apps render from packages/design-tokens in light and dark.

## Backend (new: services/config-service, Hono)
Tables: db/migrations/001_config_flags.sql (cities, city_config_versions, feature_flags, flag_rules, config_change_requests, approvals).
Endpoints (contracts/openapi/support-config.yaml):
- GET /v1/config/cities/:cityId → active version: currency (NGN), emergencyNumber (112), vehicleClasses [go, comfort, xl] (no moto in Lagos), fares per class (base, perKm, perMin, bookingFee, minFare), waitPolicy (free 5:00 then ₦50/min), cancelPolicy (free until assigned, ₦300 after; driver-cancel ₦0), pinPolicy (mandatory), quoteTtlSec 300, offerTtlSec 12, matchingRings, paymentMethods [cash, card, bank_transfer, wallet] with availability, kycTiers & limits, airportDoors, taxes.
- GET /v1/flags?cityId&userId → evaluated flags {bites, send, travel, stays, fleet, reservations, tips, ...}; deny-by-default.
- POST /v1/config/change-requests {cityId, patch, reason} → pending; POST /v1/config/change-requests/:id/approve (second approver, cannot be author) → new version; GET history.
Events: config.version_activated{cityId, version, diff}, flag.changed{key, cityId, from, to, by}.
Cache: Redis with 60s TTL + pub/sub invalidation; clients poll ETag on foreground.

## Client
- rider_app + driver_app: theme from tokens (light default rider, dark default driver, user switchable). Money formatter uses config currency; never NGN literal. Emergency number from config.
- Home tiles (6a) render from flags; deep links check flag → 404 screen with honest copy.

## Guards to test
Second approver ≠ author · flags default false when service unreachable (fail closed) · config version pinned per ride at request time (ride stores configVersion).

## Acceptance
vitest: approve flow, deny-by-default, ETag. Maestro: home renders Move only when bites/send/travel flags off.

## Claude Code prompt
"Implement services/config-service per slices/01 and contracts/openapi/support-config.yaml using the Hono + zod-openapi + Prisma pattern from services/ride-service. Add Prisma models from db/migrations/001. Add a shared client in packages/ (config-client) with Redis cache + ETag. In mobile/apps/rider_app and driver_app, replace all hard-coded currency, fares, emergency numbers and tile visibility with config/flags; add theme support from packages/design-tokens for light and dark. Tests as listed."
