# Slice 10 — UBI Fleet (multi-vehicle owners and investors)
Board: 19a–19c, 13b (documents/vehicle), 15c (identity holds visible as status).

## Product rule
A fleet owns vehicles and places UBI drivers in them. UBI makes the money split transparent and consented: fleet proposes terms (weekly remittance or % of net, ≤ policy cap; shortfall rule; shift; fuel/servicing), driver signs with PIN, the ledger applies remittance as its own line on every payout. Fleet sees vehicles, drivers on them, hours, gross, remittance status, document expiry — never rider PII, routes or safety evidence. Deactivation/identity stay UBI decisions; fleet sees status only.

## Backend (new: services/fleet-service; extend payment-service split rules)
Tables: db/migrations/007_fleet.sql (fleets, fleet_kyb, fleet_vehicles, vehicle_documents, fleet_staff, assignment_offers, assignments, split_rules, remittances, remittance_carryforwards, fleet_alerts).
Endpoints (contracts/openapi/fleet.yaml): POST /v1/fleets (KYB mirrors merchant 11c) · POST /v1/fleets/:id/vehicles {plate, make, model, year, classes, documents} · GET /v1/fleets/:id/overview (gross, remittances due/covered, utilisation, idle, alerts) · GET /v1/fleets/:id/vehicles (status now, drivers, week gross, remittance, docs) · GET /v1/fleets/:id/applicants (UBI-verified drivers who applied) · POST /v1/fleets/:id/assignments/propose {vehicleId, driverId, terms} → offer 48h · driver: GET /v1/drivers/me/fleet-offers, POST /v1/fleet-offers/:id/sign {pin} → split_rule.active; POST /v1/drivers/me/fleet/terminate (2-week notice) · payout engine: on weekly settlement post 3 lines: ubiFee, remittance→fleet, driverNet; shortfall → carry_forward ≤ N weeks per terms · vehicle-level document expiry → vehicle.offline_for_all_drivers · fleet remittance statements & payouts.
Events: fleet.assignment_proposed, driver.signed_terms, split_rule.activated/changed(requires re-sign), remittance.applied/shortfall/carried, vehicle.document_expiring/expired, fleet.alert.

## Guards
Remittance ≤ cap from config · rule immutable without driver PIN · fleet scope = own vehicles; PII minimised · historic earnings shown to applicant are real ledger data for that vehicle · termination notice enforced both ways · "held by UBI" is status only.

## Acceptance
vitest: split posting sums, cap enforcement, re-sign on change, scope filters. Maestro: fleet_assign_driver_sign_pin, driver_view_arrangement_split.

## Claude Code prompt
"Create services/fleet-service per contracts/openapi/fleet.yaml and db/migrations/007_fleet.sql; extend services/payment-service settlement to apply split rules as separate journal lines. Build apps/fleet console 19a, fleet-owner mobile 19b/19c (Flutter module or responsive web) and driver_app 19b/19c screens. Tests listed."
