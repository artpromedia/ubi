/**
 * Shared Vitest Configuration
 *
 * Base configuration for all UBI services and applications.
 */

import path from "path";
import { defineConfig, type UserConfig } from "vitest/config";

export interface UbiTestConfigOptions {
  /**
   * Project root directory
   */
  root?: string;

  /**
   * Test environment: 'node' for services, 'jsdom' for web apps
   */
  environment?: "node" | "jsdom" | "happy-dom";

  /**
   * Coverage configuration
   */
  coverage?: {
    enabled?: boolean;
    threshold?: number;
    include?: string[];
    exclude?: string[];
  };

  /**
   * Include integration tests
   */
  includeIntegration?: boolean;

  /**
   * Include E2E tests
   */
  includeE2E?: boolean;

  /**
   * Setup files to run before tests
   */
  setupFiles?: string[];

  /**
   * Global timeout for tests (ms)
   */
  timeout?: number;

  /**
   * Additional Vitest config overrides
   */
  overrides?: Partial<UserConfig["test"]>;
}

/**
 * Create base Vitest configuration for UBI projects
 */
export function createVitestConfig(
  options: UbiTestConfigOptions = {}
): UserConfig {
  const {
    root = process.cwd(),
    environment = "node",
    coverage = {},
    includeIntegration = false,
    includeE2E = false,
    setupFiles = [],
    timeout = 10000,
    overrides = {},
  } = options;

  // Build include patterns
  const include: string[] = [
    "**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
  ];

  if (includeIntegration) {
    include.push("**/*.integration.{test,spec}.{js,ts,tsx}");
  }

  // Build exclude patterns
  const exclude: string[] = [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.{idea,git,cache,output,temp}/**",
  ];

  if (!includeE2E) {
    exclude.push("**/e2e/**", "**/*.e2e.{test,spec}.*");
  }

  // Coverage configuration
  const coverageConfig = {
    enabled: coverage.enabled ?? false,
    provider: "v8" as const,
    reporter: ["text", "json", "html", "lcov"] as const,
    reportsDirectory: "./coverage",
    include: coverage.include ?? ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
    exclude: [
      ...(coverage.exclude ?? []),
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
      "**/index.ts",
      "**/__mocks__/**",
      "**/types/**",
    ],
    thresholds: coverage.threshold
      ? {
          lines: coverage.threshold,
          functions: coverage.threshold,
          branches: coverage.threshold,
          statements: coverage.threshold,
        }
      : undefined,
  };

  return defineConfig({
    test: {
      root,
      environment,
      include,
      exclude,
      globals: true,
      passWithNoTests: true,
      testTimeout: timeout,
      hookTimeout: timeout,

      // Setup files
      setupFiles: [path.resolve(__dirname, "./setup.ts"), ...setupFiles],

      // Coverage
      coverage: coverageConfig,

      // Pool configuration for faster tests
      pool: "threads",
      poolOptions: {
        threads: {
          singleThread: false,
        },
      },

      // Reporter configuration
      reporters: ["default"],

      // Retry flaky tests
      retry: process.env.CI ? 2 : 0,

      // Watch mode configuration
      watch: false,

      // Apply overrides
      ...overrides,
    },
  }) as UserConfig;
}

/**
 * Create Vitest configuration for Node.js services
 */
export function createServiceConfig(
  options: Omit<UbiTestConfigOptions, "environment"> = {}
): UserConfig {
  return createVitestConfig({
    ...options,
    environment: "node",
    timeout: options.timeout ?? 15000,
  });
}

/**
 * Create Vitest configuration for React/Next.js applications
 */
export function createWebAppConfig(
  options: Omit<UbiTestConfigOptions, "environment"> = {}
): UserConfig {
  return createVitestConfig({
    ...options,
    environment: "jsdom",
    setupFiles: [...(options.setupFiles ?? [])],
    overrides: {
      ...options.overrides,
      css: true,
    },
  });
}

/**
 * Create Vitest configuration for integration tests
 */
export function createIntegrationConfig(
  options: Omit<UbiTestConfigOptions, "includeIntegration"> = {}
): UserConfig {
  return createVitestConfig({
    ...options,
    environment: "node",
    includeIntegration: true,
    timeout: options.timeout ?? 30000,
    coverage: {
      ...options.coverage,
      enabled: false, // Disable coverage for integration tests
    },
  });
}
