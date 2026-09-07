# Slice 11 — Ops consoles: live ops, config/flags, support, finance recon, safety & identity
Board: 4a–4d, 12a–12b, 13c, 8e, 15c (ops side), 14d (ops side), 11c/18a (review queues).

## Backend
- Live ops (4a–4b): read projections from ride/order/shipment streams; ride detail = full event timeline incl. every offer/response; interventions are typed, audited actions (reassign, cancel-with-fee-waiver, contact).
- Support (12b, new services/support-service): cases with unified timeline across ride, wallet, messages; typed remedies only (fee reversal, refund, credit, re-delivery) posted as ledger lines with case reference; SLA timers; outcome visible to the user on the item it touched (13a).
- Config & flags (12a): slice 01.
- Finance recon (13c, payment-service finance module): daily recon per rail — ledger vs PSP settlement files vs bank (NIP) statements vs driver cash acks vs merchant/hotel payouts vs One-Ticket coverage/reclaims; breaks have owner + deadline; adjustments are journal entries referencing a case or bug; day-close blocked while unexplained ≠ 0; auditor export.
- Trust & safety (4c, 15c, 14d): safety cases with SLA, identity cases (face-check fails, rider reports, device patterns), claims evidence review; two-reviewer deactivation; appeal path.
- Review queues (4d KYC, 11c merchants, 18a hotels): automated checks advisory, human decides; decision + reviewer to audit log.
Tables: 008_ops.sql (support_cases, case_events, remedies, recon_runs, recon_rails, recon_breaks, safety_cases, identity_cases, review_decisions, audit_log).
Endpoints: contracts/openapi/support-config.yaml (support, recon, reviews sections).

## Guards
Every ops action typed + audited (who, what, why, before/after) · remedies never edit fares — they post counter-lines · recon close gate · PII visibility by role.

## Acceptance
vitest: recon sums to zero on fixtures; remedy posts ledger lines; audit completeness. Playwright (apps/admin): case remedy flow, recon break assignment, config approval.

## Claude Code prompt
"Implement slice 11: services/support-service, finance recon module in services/payment-service, ops projections in services/ride-service; build apps/admin screens 4a–4d, 12a–12b, 13c, 8e and review queues (4d, 11c, 18a) using the existing admin stack; every action typed and written to audit_log. Tests listed."
