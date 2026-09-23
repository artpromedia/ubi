import path from "node:path";

import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL =
  process.env.FLEET_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_fleet_test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 30000,
    hookTimeout: 30000,
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    // One shared Postgres database: files run sequentially so one file's
    // fixtures never show up in another's queries.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: TEST_DATABASE_URL,
      FLEET_TEST_DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: process.env.FLEET_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/3",
      // Test-only secrets (never production values).
      UBI_IDENTITY_SECRET: "fleet-test-identity-secret-0123456789abcdef",
      JWT_SECRET: "fleet-test-client-jwt-secret-not-the-identity-key",
      FLEET_SERVICE_KEY: "fleet-test-ride-to-fleet-service-key-0123456789",
      FLEET_PAYMENT_SERVICE_KEY: "fleet-test-payment-to-fleet-key-0123456789ab",
      FLEET_RIDE_SERVICE_KEY: "fleet-test-fleet-to-ride-service-key-012345678",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tests": path.resolve(__dirname, "./tests"),
    },
  },
});
