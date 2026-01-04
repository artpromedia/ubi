/**
 * E2E Test Fixtures
 *
 * Custom Playwright fixtures for UBI tests.
 */

import { test as base, expect, Page } from "@playwright/test";
import { TEST_AUTH_TOKENS, TEST_RIDERS } from "@ubi/testing";

// =============================================================================
// Types
// =============================================================================

interface AuthenticatedUser {
  id: string;
  email: string;
  phone: string;
  token: string;
}

interface NetworkProfile {
  name: string;
  downloadThroughput: number;
  uploadThroughput: number;
  latency: number;
}

// =============================================================================
// Network Profiles
// =============================================================================

const NETWORK_PROFILES: Record<string, NetworkProfile> = {
  "2G": {
    name: "2G EDGE",
    downloadThroughput: (50 * 1024) / 8,
    uploadThroughput: (20 * 1024) / 8,
    latency: 500,
  },
  "3G": {
    name: "3G",
    downloadThroughput: (500 * 1024) / 8,
    uploadThroughput: (100 * 1024) / 8,
    latency: 200,
  },
  "4G": {
    name: "4G LTE",
    downloadThroughput: (4 * 1024 * 1024) / 8,
    uploadThroughput: (1 * 1024 * 1024) / 8,
    latency: 50,
  },
  wifi: {
    name: "WiFi",
    downloadThroughput: (10 * 1024 * 1024) / 8,
    uploadThroughput: (5 * 1024 * 1024) / 8,
    latency: 20,
  },
};

// =============================================================================
// Custom Fixtures
// =============================================================================

interface UbiFixtures {
  /**
   * Authenticated user context
   */
  authenticatedPage: Page;

  /**
   * Authenticated rider
   */
  rider: AuthenticatedUser;

  /**
   * Network throttling helper
   */
  setNetworkConditions: (
    profile: keyof typeof NETWORK_PROFILES
  ) => Promise<void>;

  /**
   * Mock geolocation
   */
  mockLocation: (latitude: number, longitude: number) => Promise<void>;

  /**
   * API interceptor for mocking responses
   */
  mockApiResponse: (
    urlPattern: string | RegExp,
    response: unknown,
    status?: number
  ) => Promise<void>;
}

// =============================================================================
// Extended Test
// =============================================================================

export const test = base.extend<UbiFixtures>({
  // Authenticated page with pre-set auth token
  authenticatedPage: async ({ page, context }, use) => {
    // Set auth token in storage
    await context.addCookies([
      {
        name: "auth_token",
        value: TEST_AUTH_TOKENS.VALID_TOKEN,
        domain: "localhost",
        path: "/",
      },
    ]);

    // Set local storage
    await page.addInitScript(() => {
      localStorage.setItem("auth_token", "test_token");
      localStorage.setItem(
        "user",
        JSON.stringify({
          id: "rider_ng_001",
          email: "adaobi@test.ubi.com",
          firstName: "Adaobi",
          lastName: "Eze",
        })
      );
    });

    await use(page);
  },

  // Authenticated rider fixture
  rider: async ({}, use) => {
    const rider: AuthenticatedUser = {
      id: TEST_RIDERS.ADAOBI_RIDER.id,
      email: TEST_RIDERS.ADAOBI_RIDER.email,
      phone: TEST_RIDERS.ADAOBI_RIDER.phone,
      token: TEST_AUTH_TOKENS.VALID_TOKEN,
    };

    await use(rider);
  },

  // Network throttling
  setNetworkConditions: async ({ page }, use) => {
    const cdpSession = await page.context().newCDPSession(page);

    const setConditions = async (profile: keyof typeof NETWORK_PROFILES) => {
      const conditions = NETWORK_PROFILES[profile];
      await cdpSession.send("Network.emulateNetworkConditions", {
        offline: false,
        downloadThroughput: conditions.downloadThroughput,
        uploadThroughput: conditions.uploadThroughput,
        latency: conditions.latency,
      });
    };

    await use(setConditions);

    // Reset network conditions after test
    await cdpSession.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });
  },

  // Geolocation mocking
  mockLocation: async ({ context }, use) => {
    const setLocation = async (latitude: number, longitude: number) => {
      await context.setGeolocation({ latitude, longitude });
      await context.grantPermissions(["geolocation"]);
    };

    await use(setLocation);
  },

  // API response mocking
  mockApiResponse: async ({ page }, use) => {
    const mock = async (
      urlPattern: string | RegExp,
      response: unknown,
      status = 200
    ) => {
      await page.route(urlPattern, (route) => {
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(response),
        });
      });
    };

    await use(mock);
  },
});

// =============================================================================
// Custom Expect Matchers
// =============================================================================

export { expect };

// =============================================================================
// Page Object Helpers
// =============================================================================

/**
 * Wait for page to be fully loaded
 */
export async function waitForPageLoad(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForLoadState("domcontentloaded");
}

/**
 * Wait for API response
 */
export async function waitForApiResponse(
  page: Page,
  urlPattern: string | RegExp
): Promise<unknown> {
  const response = await page.waitForResponse(urlPattern);
  return response.json();
}

/**
 * Take screenshot with timestamp
 */
export async function takeTimestampedScreenshot(
  page: Page,
  name: string
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await page.screenshot({
    path: `./e2e-results/screenshots/${name}-${timestamp}.png`,
    fullPage: true,
  });
}

/**
 * Performance metrics helper
 */
export async function getPerformanceMetrics(page: Page) {
  return page.evaluate(() => {
    const timing = performance.timing;
    return {
      domContentLoaded:
        timing.domContentLoadedEventEnd - timing.navigationStart,
      load: timing.loadEventEnd - timing.navigationStart,
      firstPaint: performance.getEntriesByType("paint")[0]?.startTime || 0,
      firstContentfulPaint:
        performance.getEntriesByType("paint")[1]?.startTime || 0,
    };
  });
}
