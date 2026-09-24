import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Supplier SANDBOX integration tests (`pnpm test:sandbox`).
 *
 * They call the real Duffel test-mode API and the real LiteAPI sandbox, so
 * they need DUFFEL_TEST_TOKEN / LITEAPI_TEST_KEY and outbound network access —
 * an external credential dependency, kept out of the default `test` run (which
 * must pass offline and never reports these as passing). Each suite is skipped,
 * with its reason, when its credential is absent.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/sandbox/**/*.sandbox.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tests": path.resolve(__dirname, "./tests"),
    },
  },
});
