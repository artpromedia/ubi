/**
 * E2E Test Fixtures for Admin Dashboard
 */

import { test as base, expect, Page } from "@playwright/test";

// =============================================================================
// Types
// =============================================================================

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "super_admin" | "admin" | "analyst" | "support";
  token: string;
}

interface TestDataHelpers {
  createMockUser: (overrides?: Partial<AdminUser>) => AdminUser;
  createMockFraudAlert: () => object;
  createMockUserRecord: () => object;
}

// =============================================================================
// Test Users
// =============================================================================

const TEST_ADMIN_USERS: Record<string, AdminUser> = {
  super_admin: {
    id: "admin_001",
    email: "super@ubi.com",
    name: "Super Admin",
    role: "super_admin",
    token: "test_super_admin_token",
  },
  admin: {
    id: "admin_002",
    email: "admin@ubi.com",
    name: "Regular Admin",
    role: "admin",
    token: "test_admin_token",
  },
  analyst: {
    id: "admin_003",
    email: "analyst@ubi.com",
    name: "Data Analyst",
    role: "analyst",
    token: "test_analyst_token",
  },
  support: {
    id: "admin_004",
    email: "support@ubi.com",
    name: "Support Agent",
    role: "support",
    token: "test_support_token",
  },
};

// =============================================================================
// Custom Fixtures
// =============================================================================

interface AdminFixtures {
  authenticatedPage: Page;
  adminUser: AdminUser;
  testData: TestDataHelpers;
  mockApiResponse: (
    urlPattern: string | RegExp,
    response: unknown,
    status?: number,
  ) => Promise<void>;
  loginAsAdmin: (role?: keyof typeof TEST_ADMIN_USERS) => Promise<void>;
}

export const test = base.extend<AdminFixtures>({
  adminUser: async ({}, use) => {
    await use(TEST_ADMIN_USERS.admin);
  },

  authenticatedPage: async ({ page, adminUser }, use) => {
    // Set up authentication state
    await page.goto("/login");

    // Set auth token in localStorage
    await page.evaluate(
      ({ user }) => {
        localStorage.setItem("admin_token", user.token);
        localStorage.setItem("admin_user", JSON.stringify(user));
      },
      { user: adminUser },
    );

    await page.goto("/dashboard");
    await use(page);
  },

  loginAsAdmin: async ({ page }, use) => {
    const login = async (role: keyof typeof TEST_ADMIN_USERS = "admin") => {
      const user = TEST_ADMIN_USERS[role];

      await page.evaluate(
        ({ user }) => {
          localStorage.setItem("admin_token", user.token);
          localStorage.setItem("admin_user", JSON.stringify(user));
        },
        { user },
      );
    };

    await use(login);
  },

  mockApiResponse: async ({ page }, use) => {
    const mock = async (
      urlPattern: string | RegExp,
      response: unknown,
      status = 200,
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

  testData: async ({}, use) => {
    const helpers: TestDataHelpers = {
      createMockUser: (overrides = {}) => ({
        id: `admin_${Date.now()}`,
        email: "test@ubi.com",
        name: "Test Admin",
        role: "admin",
        token: "test_token",
        ...overrides,
      }),

      createMockFraudAlert: () => ({
        id: `FRD-${Date.now()}`,
        type: "payment_fraud",
        severity: "high",
        status: "pending",
        title: "Test fraud alert",
        description: "Test alert description",
        user: {
          name: "Test User",
          id: "USR-12345",
          email: "test@email.com",
        },
        amount: 50000,
        location: "Lagos, Nigeria",
        timestamp: new Date().toISOString(),
        indicators: ["velocity_spike"],
      }),

      createMockUserRecord: () => ({
        id: `USR-${Date.now()}`,
        firstName: "Test",
        lastName: "User",
        email: "testuser@email.com",
        phone: "+2348012345678",
        status: "active",
        createdAt: new Date().toISOString(),
        totalRides: 25,
        totalSpent: 150000,
      }),
    };

    await use(helpers);
  },
});

export { expect, TEST_ADMIN_USERS };

/**
 * Helper to wait for page to be fully loaded
 */
export async function waitForPageLoad(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}

/**
 * Helper to wait for dashboard data to load
 */
export async function waitForDashboardLoad(page: Page): Promise<void> {
  await page
    .waitForSelector('[data-testid="dashboard-stats"]', {
      state: "visible",
      timeout: 10000,
    })
    .catch(() => {
      // Stats may not have test IDs, wait for any loading indicators to disappear
      return page.waitForLoadState("networkidle");
    });
}
