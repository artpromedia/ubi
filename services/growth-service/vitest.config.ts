import path from "node:path";
import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL =
  process.env.GROWTH_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_growth_test";

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
    // The integration tests share one Postgres database, so files run
    // sequentially: parallel files would let one file's fixtures show up in
    // another file's aggregate reads and read as flakiness.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: TEST_DATABASE_URL,
      GROWTH_TEST_DATABASE_URL: TEST_DATABASE_URL,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tests": path.resolve(__dirname, "./tests"),
    },
  },
});
