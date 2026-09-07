import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Dedicated config for the Bites integration tests. The service's root
 * `vitest.config.ts` only collects `src/**` tests, so these are run with
 *   npx vitest run --config tests/bites/vitest.config.ts
 * against a database provisioned by the agent (default: ubi_bites_p2).
 */
const TEST_DATABASE_URL =
  process.env.BITES_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_bites_p2";

export default defineConfig({
  root: path.resolve(__dirname, "../.."),
  test: {
    globals: true,
    environment: "node",
    include: ["tests/bites/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // One shared Postgres database, so files run sequentially.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: TEST_DATABASE_URL,
      BITES_TEST_DATABASE_URL: TEST_DATABASE_URL,
    },
  },
});
