/**
 * E2E Test Fixtures for Admin Dashboard
 */

/* eslint-disable no-empty-pattern, react-hooks/rules-of-hooks -- Playwright fixture `use` is not a React hook, and `{}` is the idiomatic empty fixture arg. */
import { test as base, expect, type Page } from "@playwright/test";

import {
  ADMIN_SESSION_COOKIE,
  sealSessionCookie,
  type AdminSessionData,
} from "../../src/lib/session";

const E2E_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET ||
  "e2e-admin-session-secret-with-at-least-32-chars!";

// =============================================================================
// Types
// =============================================================================

interface AdminUser {
  id: string;
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  role: "super_admin" | "admin" | "ops_admin" | "support_agent";
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

const TEST_ADMIN_USERS = {
  super_admin: {
    id: "admin_001",
    phone: "+2348010000001",
    email: "super@ubi.africa",
    firstName: "Adaeze",
    lastName: "Okafor",
    name: "Adaeze Okafor",
    role: "super_admin",
    token: "test_super_admin_token",
  },
  admin: {
    id: "admin_002",
    phone: "+2348010000002",
    email: "admin@ubi.africa",
    firstName: "Chidi",
    lastName: "Nwosu",
    name: "Chidi Nwosu",
    role: "admin",
    token: "test_admin_token",
  },
  analyst: {
    id: "admin_003",
    phone: "+2348010000003",
    email: "ops@ubi.africa",
    firstName: "Kemi",
    lastName: "Adeyemi",
    name: "Kemi Adeyemi",
    role: "ops_admin",
    token: "test_ops_admin_token",
  },
  support: {
    id: "admin_004",
    phone: "+2348010000004",
    email: "support@ubi.africa",
    firstName: "Musa",
    lastName: "Bello",
    name: "Musa Bello",
    role: "support_agent",
    token: "test_support_token",
  },
} satisfies Record<string, AdminUser>;

async function setAdminSessionCookie(
  page: Page,
  user: AdminUser,
  baseUrl: string,
): Promise<void> {
  const session: AdminSessionData = {
    user: {
      id: user.id,
      phone: user.phone,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      homeCityId: "LOS",
    },
    accessToken: user.token,
    refreshToken: `rt_${user.token}`,
    deviceId: `adm_web_fixture_${user.id}`,
    mode: "full",
    expiresAt: Date.now() + 15 * 60 * 1000,
    stepUp: null,
  };
  const sealed = await sealSessionCookie(session, E2E_SESSION_SECRET);
  await page.context().addCookies([
    {
      name: ADMIN_SESSION_COOKIE,
      value: sealed,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
}

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

  authenticatedPage: async ({ page, adminUser, baseURL }, use) => {
    const targetUrl = baseURL ?? "http://127.0.0.1:3002";
    await setAdminSessionCookie(page, adminUser, targetUrl);
    await page.goto("/dashboard");
    await use(page);
  },

  loginAsAdmin: async ({ page, baseURL }, use) => {
    const targetUrl = baseURL ?? "http://127.0.0.1:3002";
    const login = async (role: keyof typeof TEST_ADMIN_USERS = "admin") => {
      const user = TEST_ADMIN_USERS[role];
      await setAdminSessionCookie(page, user, targetUrl);
    };

    await use(login);
  },

  mockApiResponse: async ({ page }, use) => {
    const mock = async (
      urlPattern: string | RegExp,
      response: unknown,
      status = 200,
    ) => {
      await page.route(urlPattern, async (route) => {
        await route.fulfill({
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
        phone: "+2348019999999",
        email: "test@ubi.africa",
        firstName: "Test",
        lastName: "Admin",
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

export async function waitForPageLoad(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}

export async function waitForDashboardLoad(page: Page): Promise<void> {
  await page
    .waitForSelector('[data-testid="dashboard-stats"]', {
      state: "visible",
      timeout: 10000,
    })
    .catch(async () => {
      await page.waitForLoadState("networkidle");
    });
}
