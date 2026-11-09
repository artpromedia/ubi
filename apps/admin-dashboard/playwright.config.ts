/**
 * Playwright Configuration for Admin Dashboard E2E Tests
 *
 * Tests for admin users managing the UBI platform.
 */

import fs from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3002";
const CI = !!process.env.CI;
const SYSTEM_CHROMIUM = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].find((candidate): candidate is string =>
  Boolean(candidate && fs.existsSync(candidate)),
);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "./e2e-results",
  timeout: 90000,

  expect: {
    timeout: 20000,
  },

  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./e2e-report", open: "never" }],
    ...(CI ? [["github", {}] as const] : []),
  ],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: SYSTEM_CHROMIUM && !CI ? "off" : "retain-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 45000,
  },

  globalSetup: "./e2e/setup/global-setup.ts",

  projects: [
    {
      name: "Desktop Chrome",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        ...(SYSTEM_CHROMIUM
          ? {
              launchOptions: {
                executablePath: SYSTEM_CHROMIUM,
                args: [
                  "--no-sandbox",
                  "--disable-dev-shm-usage",
                  "--proxy-bypass-list=<-loopback>",
                ],
              },
            }
          : {}),
      },
    },
  ],

  webServer: CI
    ? undefined
    : {
        command: "pnpm exec next dev --port 3002",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120000,
        env: {
          ...process.env,
          NO_PROXY: "127.0.0.1,localhost",
          no_proxy: "127.0.0.1,localhost",
          ADMIN_GATEWAY_URL:
            process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:44180",
          ADMIN_SESSION_SECRET:
            process.env.ADMIN_SESSION_SECRET ||
            "e2e-admin-session-secret-with-at-least-32-chars!",
        },
      },
});
