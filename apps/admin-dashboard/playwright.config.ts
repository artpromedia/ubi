/**
 * Playwright Configuration for Admin Dashboard E2E Tests
 *
 * Tests for admin users managing the UBI platform.
 */

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3002";
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "./e2e-results",
  timeout: 60000,

  expect: {
    timeout: 10000,
  },

  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./e2e-report" }],
    ...(CI ? [["github" as const]] : []),
  ],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  globalSetup: "./e2e/setup/global-setup.ts",

  projects: [
    {
      name: "Desktop Chrome",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: "Desktop Firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "Desktop Safari",
      use: { ...devices["Desktop Safari"] },
    },
    // Tablet for on-the-go admin work
    {
      name: "iPad Pro",
      use: { ...devices["iPad Pro"] },
    },
  ],

  webServer: CI
    ? undefined
    : {
        command: "pnpm dev",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120000,
      },
});
