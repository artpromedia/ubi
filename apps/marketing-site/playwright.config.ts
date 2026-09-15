/**
 * Marketing-site E2E: the real production build (`next build && next start`)
 * against a mocked config-service and user-service (e2e/mock/services.mjs),
 * at 1440 and 390 (board 24). Tests switch the mock's scenario and purge the
 * site's cache through the real /api/revalidate route, so every state in
 * ACCEPTANCE.md is exercised the way production would reach it.
 */
import { defineConfig, devices } from "@playwright/test";

export const SITE_PORT = 3102;
export const MOCK_CONFIG_PORT = 3111;
export const MOCK_USER_PORT = 3112;
export const REVALIDATE_SECRET = "e2e-revalidate-secret-0123456789";
export const MOCK_CONFIG_URL = `http://127.0.0.1:${MOCK_CONFIG_PORT}`;
export const BASE_URL = `http://127.0.0.1:${SITE_PORT}`;

const CI = !!process.env.CI;

/**
 * The environment the site runs with. Deliberately mixed so both branches of
 * DestinationLink are covered: rider, driver and privacy are https; the store
 * links, fleet and help are unset; terms is http (treated as unset); no
 * safety line.
 */
export const SITE_ENV: Record<string, string> = {
  NODE_ENV: "production",
  PORT: String(SITE_PORT),
  UBI_CONFIG_BASE_URL: MOCK_CONFIG_URL,
  UBI_CONFIG_SERVICE_TOKEN: "e2e-config-token",
  UBI_USER_BASE_URL: `http://127.0.0.1:${MOCK_USER_PORT}`,
  UBI_REVALIDATE_SECRET: REVALIDATE_SECRET,
  UBI_RIDER_URL: "https://app.ubi.africa",
  UBI_DRIVER_URL: "https://driver.ubi.africa/auth/signup",
  UBI_PRIVACY_URL: "https://www.ubi.africa/privacy",
  UBI_TERMS_URL: "http://insecure.example/terms",
};

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "./e2e-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // The mock's scenario is shared state: one worker, tests in file order.
  workers: 1,
  fullyParallel: false,
  reporter: CI
    ? [["list"], ["html", { outputFolder: "./e2e-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "./e2e-report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    // Local runners with a preinstalled Chromium (PLAYWRIGHT_BROWSERS_PATH) can
    // point at it instead of downloading; CI runs `playwright install chromium`.
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "desktop-1440",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-390",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: "node e2e/mock/services.mjs",
      url: `${MOCK_CONFIG_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec next start -p ${SITE_PORT}`,
      url: `${BASE_URL}/help`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: SITE_ENV,
    },
  ],
});
