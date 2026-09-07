# payment-service — quarantined (deferred) modules

The launch money path is `src/ledger/**` and `src/finance/**` (the canonical
wallet double-entry ledger, finance reconciliation and support remedies — ~85
tests), plus the payment/payout/webhook/mobile-money/safety/fraud routes and
their services, and the PSP providers. That path typechecks against the REAL
generated Prisma types (the `declare module "@prisma/client"` any-shim was
deleted).

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
