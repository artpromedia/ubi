# Slice 03 — Auth, KYC, device trust, account recovery
Board: 3a–3d (OTP, permissions, driver documents, review), 15a–15c (new device, SIM-swap safe mode, locked PIN, driver liveness), 13b (documents & vehicle).

## Backend (extend services/user-service; new module identity)
Tables: 003_identity.sql (devices, device_trust, step_up_challenges, sim_swap_signals, pin_attempts, documents, document_reviews, identity_cases).
Endpoints: POST /v1/auth/otp, /v1/auth/verify → token with scopes · POST /v1/devices/enroll → step-up required when new device: {oldDeviceApprove | selfieNin} · POST /v1/auth/step-up/selfie (liveness + NIN face match → score only stored) · GET/POST /v1/drivers/me/documents {type} (Lagos set: licence, LASDRI, insurance, roadworthiness, background check, vehicle reg) → review queue (4d) · reminders at 30/14/7/1 days; auto-offline on expiry (server-enforced) · POST /v1/wallet/pin/reset (after biometric step-up) → cooling {2h, >₦20k new recipients} · telco SIM-swap webhook → wallet.safe_mode(24h) · driver liveness gate before first shift on new device + random ~10% shifts.
Events: device.enrolled, step_up.passed/failed, wallet.safe_mode_entered/exited, pin.locked, pin.rotated, document.expiring, document.expired, face_check.failed, identity.case_opened/decided.

## Guards
SMS OTP alone never unlocks money · safe mode blocks P2P, NIP, PIN/phone/contact changes; spend cap from config · failed face check = offline, not deactivation · deactivation two-reviewer · driver told reason + appeal path · limited-mode token scopes (book with cash, view history) until verified.

## Acceptance
vitest: scope matrix for limited mode and safe mode; PIN lockout after 5; cooling window. Maestro: new_device_signin_limited_mode, pin_locked_reset_selfie, driver_liveness_gate.

## Claude Code prompt
"Implement slice 03 in services/user-service per contracts/openapi/support-config.yaml (identity section) and db/migrations/003. Add token scopes and middleware in api-gateway enforcing limited mode and wallet safe mode. Build 3a–3d and 15a–15c in both Flutter apps with exact copy and testIDs. Tests listed."
