# Slice 04 — UBI Wallet: P2P, split fare, NIP, top-up saga, statements
Board: 7a–7e, 14e, 18c (statement), 5c (settlement).

## Backend (extend services/payment-service; wallet module)
Tables: 002_wallet.sql (wallets, journal_entries, journal_lines, transfers, transfer_requests, nip_transfers, topups, return_requests, kyc_tiers, safe_mode_holds, statements).
Endpoints (contracts/openapi/wallet-p2p.yaml): GET /v1/wallet · GET /v1/wallet/recipients/lookup?q=@tag|phone → display name (full name shown before PIN) · POST /v1/wallet/transfers {toUserId, amountMinor, note, pin} + Idempotency-Key → posted | held{risk} · POST /v1/wallet/requests {fromUserId, amountMinor, rideId?} (split fare) · POST /v1/wallet/requests/:id/pay · POST /v1/wallet/nip {bankCode, account, amountMinor} → pending → confirmed | reversed(24h) via bank webhook; name enquiry first · POST /v1/wallet/topups {methodId, amountMinor} · POST /v1/wallet/transfers/:id/return-request → recipient consent → reversal · POST /v1/wallet/disputes (48h) · GET /v1/wallet/statements?from&to → PDF/CSV signed URL · Saga: topup+transfer atomic (either both post or neither).
Ledger rules: fee lines separate; tips bypass commission; cash-owed nets against driver wallet at settlement; every line has counterpartRef.
Risk: velocity + new-recipient checks → hold with human review (7e); KYC tiers (CBN-style) set limits from config.

## Guards
No unilateral pull-back of posted transfers · idempotent transfers · safe-mode scope enforcement · daily limit by tier · PIN required for send, biometrics optional.

## Acceptance
vitest: double-entry invariant (sum lines = 0), idempotency replay, saga rollback, limit enforcement. Maestro: wallet_send_p2p, split_fare_request_pay, nip_transfer_pending_confirmed, insufficient_funds_topup_and_send.

## Claude Code prompt
"Implement slice 04 in services/payment-service per contracts/openapi/wallet-p2p.yaml and db/migrations/002. Enforce double-entry with a DB constraint or transaction check. Build 7a–7e, 14e and the statement screen (18c) in rider_app; the driver settlement view (5c/13b) in driver_app. Tests listed."
