import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test environment
    environment: "node",

    // Global setup/teardown
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],

    // Test file patterns
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
    exclude: [
      "node_modules",
      "dist",
      "tests/load/**", // Load tests run separately

      // QUARANTINED-MODULE SUITES — see QUARANTINE.md.
      //
      // Each suite below tests a module that is excluded from the build
      // (tsconfig.json "exclude") and from lint (.eslintrc.js ignorePatterns):
      // superseded pre-ledger payment flows or deferred PSP providers that
      // reference Prisma models absent from the launch schema. Running their
      // tests is as meaningless as compiling their subjects. Remove a path
      // here when its feature is rebuilt on the canonical ledger and its
      // tsconfig/eslint quarantine entries are removed.
      //
      // NOTE: tests/performance.test.ts is NOT excluded — it tests
      // src/lib/performance.ts, which is live code (imported by
      // wallet.service.ts, provider-health.service.ts and routes/metrics.ts).
      "tests/unit/reconciliation.service.test.ts", // imports src/services/reconciliation.service.ts (quarantined: old recon, superseded by src/finance)
      "tests/unit/loans.service.test.ts", // imports src/services/loans.service.ts (quarantined: neo-bank, loan/loanProduct models absent)
      "tests/unit/settlement.service.test.ts", // imports src/services/settlement.service.ts (quarantined: old settlement, superseded by src/finance)
      "tests/unit/orange-money.service.test.ts", // imports src/providers/orange-money.service.ts (quarantined: deferred PSP provider)
      "tests/unit/telebirr.service.test.ts", // imports src/providers/telebirr.service.ts (quarantined: deferred PSP provider)
      "tests/integration/payment-flows.test.ts", // imports no src code; drives the OLD unmounted routes (/mobile-money, /webhooks, /wallets — all quarantined) against a bare Hono app
      "tests/integration/payment-channels.test.ts", // imports no src code; self-mocked SMS/USSD/voice channels (src/services/offline is quarantined)
    ],

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/**/index.ts", "src/types/**"],
      thresholds: {
        global: {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
      },
    },

    // Timeout settings
    testTimeout: 30000,
    hookTimeout: 30000,

    // Reporter
    reporters: ["verbose", "junit"],
    outputFile: {
      junit: "./test-results/junit.xml",
    },

    // Pool settings
    //
    // Integration tests here share ONE Postgres database, so running test files
    // in parallel lets their fixtures collide: tests/ledger/transfers and
    // tests/ledger/statements each pass alone and fail when run together, which
    // reads as flakiness rather than as the interference it is. Files run
    // sequentially; tests within a file still share a worker.
    //
    // The faster alternative is a schema (or database) per test file. If this
    // suite grows enough for the wall-clock to matter, do that instead of
    // turning parallelism back on.
    fileParallelism: false,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
        isolate: true,
      },
    },

    // Mock settings
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tests": path.resolve(__dirname, "./tests"),
    },
  },
});
