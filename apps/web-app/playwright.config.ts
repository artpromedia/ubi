/**
 * Playwright Configuration for UBI E2E Tests
 *
 * This configuration is optimized for testing African market conditions
 * including network throttling, device emulation, and mobile-first testing.
 */

import { defineConfig, devices } from "@playwright/test";

/**
 * Read environment variables
 */
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const CI = !!process.env.CI;

/**
 * Network conditions for African markets
 * @internal Prepared for future network throttling implementation
 */
export const NETWORK_CONDITIONS = {
  "2G": {
    offline: false,
    downloadThroughput: (50 * 1024) / 8, // 50 KB/s
    uploadThroughput: (20 * 1024) / 8,
    latency: 500,
  },
  "3G": {
    offline: false,
    downloadThroughput: (500 * 1024) / 8, // 500 KB/s
    uploadThroughput: (100 * 1024) / 8,
    latency: 200,
  },
  "4G": {
    offline: false,
    downloadThroughput: (4 * 1024 * 1024) / 8, // 4 MB/s
    uploadThroughput: (1 * 1024 * 1024) / 8,
    latency: 50,
  },
};

export default defineConfig({
  // Test directory
  testDir: "./e2e",

  // Test matching patterns
  testMatch: "**/*.e2e.ts",

  // Output directory for test artifacts
  outputDir: "./e2e-results",

  // Maximum time one test can run
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 10000,
  },

  // Fail the build on CI if test.only() is left in code
  forbidOnly: CI,

  // Retry failed tests
  retries: CI ? 2 : 0,

  // Run tests in parallel
  fullyParallel: true,

  // Number of workers
  workers: CI ? 2 : undefined,

  // Reporter configuration
  reporter: CI
    ? [
        ["html", { outputFolder: "./e2e-report" }],
        ["junit", { outputFile: "./e2e-results/junit.xml" }],
        ["json", { outputFile: "./e2e-results/results.json" }],
      ]
    : [["html", { outputFolder: "./e2e-report", open: "never" }]],

  // Global setup/teardown
  globalSetup: "./e2e/setup/global-setup.ts",
  globalTeardown: "./e2e/setup/global-teardown.ts",

  // Shared settings for all projects
  use: {
    // Base URL for relative URLs
    baseURL: BASE_URL,

    // Collect trace on failure
    trace: "on-first-retry",

    // Capture screenshot on failure
    screenshot: "only-on-failure",

    // Record video on failure
    video: "on-first-retry",

    // Extra HTTP headers
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },

    // Ignore HTTPS errors (for local development)
    ignoreHTTPSErrors: true,

    // Viewport size (default for desktop)
    viewport: { width: 1280, height: 720 },

    // Action timeout
    actionTimeout: 15000,

    // Navigation timeout
    navigationTimeout: 30000,
  },

  // Configure projects for different browsers and devices
  projects: [
    // ==========================================================================
    // Desktop Browsers
    // ==========================================================================
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1280, height: 720 },
      },
    },

    // ==========================================================================
    // Mobile Devices (Primary targets for African market)
    // ==========================================================================

    // High-end Android (Samsung Galaxy S21)
    {
      name: "mobile-chrome-highend",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 393, height: 851 },
      },
    },

    // Mid-range Android (Popular in Africa)
    {
      name: "mobile-chrome-midrange",
      use: {
        ...devices["Pixel 4a (5G)"],
        viewport: { width: 353, height: 745 },
      },
    },

    // Budget Android (Transsion Tecno/Infinix - popular in Africa)
    {
      name: "mobile-chrome-budget",
      use: {
        browserName: "chromium",
        viewport: { width: 320, height: 568 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (Linux; Android 10; TECNO KC8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      },
    },

    // iPhone (for comparison and iOS testing)
    {
      name: "mobile-safari",
      use: {
        ...devices["iPhone 13"],
      },
    },

    // ==========================================================================
    // Network Condition Tests (Critical for African markets)
    // ==========================================================================

    // 3G Network simulation
    {
      name: "mobile-3g",
      use: {
        ...devices["Pixel 5"],
        // Network throttling will be applied in tests
      },
    },

    // 2G Network simulation (for extreme conditions)
    {
      name: "mobile-2g",
      use: {
        ...devices["Pixel 4a (5G)"],
        // Network throttling will be applied in tests
      },
    },

    // ==========================================================================
    // Tablet
    // ==========================================================================
    {
      name: "tablet",
      use: {
        ...devices["iPad (gen 7)"],
      },
    },
  ],

  // Web server configuration
  webServer: {
    command: "pnpm --filter @ubi/web-app dev",
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 120000,
  },
});
