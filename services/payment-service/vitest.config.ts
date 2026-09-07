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
