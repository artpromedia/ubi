import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL =
  process.env.OUTBOX_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_outbox_test";

const TEST_REDIS_URL = process.env.OUTBOX_TEST_REDIS_URL ?? "redis://127.0.0.1:6379";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // The integration tests share one Postgres database and one Redis, so the
    // files run sequentially: parallel files would let one file's outbox rows
    // and pub/sub deliveries bleed into another's and read as flakiness.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: TEST_DATABASE_URL,
      OUTBOX_TEST_DATABASE_URL: TEST_DATABASE_URL,
      OUTBOX_TEST_REDIS_URL: TEST_REDIS_URL,
    },
  },
});
