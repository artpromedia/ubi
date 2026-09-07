import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Tests run against a real Postgres and a real Redis. Files run one at a time
 * because the integration tests truncate the config tables between cases.
 */
const TEST_DATABASE_URL =
  process.env.CONFIG_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_config_test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 30000,
    hookTimeout: 60000,
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    fileParallelism: false,
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
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
