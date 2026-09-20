/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@ubi/eslint-config/node"],
  parserOptions: {
    project: ["./tsconfig.json", "./tsconfig.test.json"],
    tsconfigRootDir: __dirname,
  },
  // QUARANTINED legacy/deferred modules — mirrors the tsconfig.json "exclude"
  // list exactly (see QUARANTINE.md for the per-path reason). These files are
  // excluded from the build, unmounted from src/index.ts and reference Prisma
  // models that do not exist in the launch schema, so linting them is as
  // meaningless as compiling them. Remove a path here when its feature is
  // rebuilt on the canonical ledger and the tsconfig exclude is removed.
  ignorePatterns: [
    // --- Superseded by the canonical /v1 ledger (src/ledger + src/finance) ---
    "src/routes/payments.ts",
    "src/routes/wallet.ts",
    "src/routes/payouts.ts",
    "src/routes/mobile-money.ts",
    "src/routes/webhooks.ts",
    "src/services/settlement.service.ts",
    "src/providers/orange-money.service.ts",
    "src/providers/telebirr.service.ts",

    // --- Dead code: imported by ZERO files ---
    "src/services/ml/**",
    "src/services/offline/**",
    "src/services/batch.service.ts",

    // --- Superseded by the canonical src/finance reconciliation ---
    "src/services/reconciliation.service.ts",
    "src/services/scheduled-jobs.service.ts",

    // --- Neo-bank fintech beyond ride payments/driver payouts ---
    "src/services/enhanced-wallet.service.ts",
    "src/services/p2p.service.ts",
    "src/services/cards.service.ts",
    "src/services/savings.service.ts",
    "src/services/loans.service.ts",
    "src/services/credit-scoring.service.ts",
    "src/services/bills.service.ts",
    "src/services/subscription.service.ts",
    "src/services/qr-payment.service.ts",
    "src/services/remittance.service.ts",

    // --- Loyalty / gamification (deferred; models absent) ---
    "src/services/points.service.ts",
    "src/services/tier.service.ts",
    "src/services/achievements.service.ts",
    "src/services/streaks.service.ts",
    "src/services/referrals.service.ts",
    "src/services/challenges.service.ts",
    "src/services/leaderboards.service.ts",

    // --- B2B / extended verticals (deferred) ---
    "src/services/billing.service.ts",
    "src/services/corporate-accounts.service.ts",
    "src/services/healthcare-transport.service.ts",
    "src/services/school-transport.service.ts",
    "src/services/ecommerce-integrations.service.ts",
    "src/services/api-infrastructure.service.ts",
    "src/services/delivery-api.service.ts",
    "src/services/vehicle-financing.service.ts",

    // --- Driver experience extras (career/benefits/goals/incentives/fleet) ---
    "src/services/driver/**",
    "src/lib/service-adapters.ts",

    // --- Deferred routes (unmounted; their services are quarantined) ---
    "src/routes/b2b.ts",
    "src/routes/loyalty.ts",
    "src/routes/driver.ts",
    "src/routes/vehicle-financing.ts",

    // --- Type decls used only by the quarantined features above ---
    "src/types/ml.types.ts",
    "src/types/offline.types.ts",
    "src/types/b2b.types.ts",
    "src/types/loyalty.types.ts",
    "src/types/fintech.types.ts",
    "src/types/vehicle-financing.types.ts",
    "src/types/driver.types.ts",
  ],
};
