import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules", "dist", "**/*.test.ts", "vitest.config.ts"],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
    isolate: true,
    // Mock environment variables for tests
    env: {
      NODE_ENV: "test",
      JWT_SECRET: "test-secret-for-unit-testing-only",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test_db",
      REDIS_URL: "redis://localhost:6379",
    },
  },
});
