# payment-service — quarantined (deferred) modules

The launch money path is `src/ledger/**` and `src/finance/**` (the canonical
wallet double-entry ledger, finance reconciliation and support remedies — ~85
tests), mounted at `/v1/wallet`, `/v1/finance` and `/v1/finance/remedies`, plus
the safety/fraud/admin/health routes and their services. That path typechecks
against the REAL generated Prisma types (the `declare module "@prisma/client"`
any-shim was deleted); `npx tsc --noEmit` reports 0 errors.

## Superseded by the canonical /v1 ledger

The following OLD payment modules were quarantined out of the build (added to
`tsconfig.json` `exclude`) and UNMOUNTED from `src/index.ts`. They referenced
Prisma models/shape that DO NOT EXIST in the launch schema — `prisma.payment`,
`prisma.walletTransaction`, a stored-balance `wallet.balance`/`lockedBalance`/
`wallet.userId`, and `prisma.providerBalance` — and only ever "compiled" under
the deleted any-shim. They are replaced by the canonical `/v1/wallet` +
`/v1/finance` ledger (whose `Wallet` has no stored balance — balances are
DERIVED from journal lines).

Routes (unmounted from `src/index.ts`):
- `src/routes/payments.ts`        (was `/payments`)
- `src/routes/wallet.ts`          (was `/wallets` — the OLD wallet route; `/v1/wallet` stays)
- `src/routes/payouts.ts`         (was `/payouts`)
- `src/routes/mobile-money.ts`    (was `/mobile-money`)
- `src/routes/webhooks.ts`        (was `/webhooks`)

Services:
- `src/services/settlement.service.ts`  (fictional payment/walletTransaction models; canonical settlement is `src/finance`). The `src/services/index.ts` barrel no longer re-exports it, and `src/routes/admin.ts` was decoupled from it (its settlement-action endpoints now 410-redirect to `/v1/finance`; the settlement LIST/summary/report reads use `prisma.settlement` directly).

PSP provider integrations (deferred — rebuild on the canonical ledger):
- `src/providers/orange-money.service.ts`  (fictional `prisma.providerBalance`; unsupported XOF currency)
- `src/providers/telebirr.service.ts`       (fictional `prisma.providerBalance`)
  The `src/providers/index.ts` barrel no longer re-exports these two.

The remaining PSP providers ARE kept and were fixed against the real generated
types (they are still imported by kept files — `src/routes/admin.ts` uses
`PaystackService`, and `src/services/payout.service.ts`/`src/gateway` use momo/
mpesa/paystack): `src/providers/momo.service.ts`, `src/providers/mpesa.service.ts`,
`src/providers/paystack.service.ts` (all `Payout.providerMetadata` → `metadata`;
paystack card fields → `token`/`brand`/metadata JSON), `src/gateway/payment-gateway.ts`
(`ProviderHealth.lastCheckAt`/`avgResponseTime`, PaymentMethod card fields via
metadata) and `src/services/payout.service.ts` (`Payout.accountNumber`/`metadata`;
`Driver.verifiedAt` instead of a non-existent `status`).

### Residual launch gap (not yet implemented on the canonical ledger)

PSP card / mobile-money COLLECTION, bank PAYOUT batches, and payment WEBHOOKS
are NOT yet implemented on the canonical `/v1` ledger. The old routes/services
above provided them against the fictional schema and are now unmounted; the kept
gateway/provider/payout code compiles against the real types but its money moves
still need to be re-expressed as canonical journal entries before those flows
launch. Two smaller placeholders in kept, launch code:
- `src/services/sos.service.ts` emergency-contact CRUD is held in-process (a
  Map on the singleton) because the launch schema has no `EmergencyContact`
  table; it must be re-pointed at a real model before it can persist.
- `src/services/fraud-detection.service.ts` persists a `RiskAssessment` only
  when an assessment is tied to a `paymentTransactionId` (the launch model
  requires that 1:1 link); a pre-payment `/fraud/assess` without one returns a
  computed result that is not stored (and so does not enter the review queue).

The paths listed under `exclude` in `tsconfig.json` are DEFERRED features per
the handoff ("financial services beyond required ride payments and driver
payouts, unvalidated ML features, and nonessential B2B verticals" are
flag-gated off until Move is green). They are kept in source but excluded from
the build because they reference Prisma models that are not in the launch
schema (walletBalance, card, beneficiary, savingsPocket, loan, creditScore,
pointsAccount, referral, challenge, …). Each is annotated inline in
tsconfig.json with the reason.

Before any of these features launches, its service must be rebuilt against real
schema models (add the models, generate the client, remove the exclude) and its
route re-mounted in `src/index.ts` behind its feature flag.
