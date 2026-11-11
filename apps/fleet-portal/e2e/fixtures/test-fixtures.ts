/**
 * E2E Test Fixtures for Fleet Portal (CC-C01)
 */

/* eslint-disable no-empty-pattern, react-hooks/rules-of-hooks -- Playwright fixture `use` is not a React hook, and `{}` is the idiomatic empty fixture arg. */
import { test as base, expect, type Page } from "@playwright/test";

import {
  FLEET_SESSION_COOKIE,
  sealSessionCookie,
  type FleetSessionData,
} from "../../src/lib/session";

const E2E_SESSION_SECRET =
  process.env.FLEET_SESSION_SECRET ||
  "ubi-fleet-dev-session-secret-not-for-production-32b";

interface FleetUser {
  id: string;
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  fleetId: string;
  fleetName: string;
  role: "rider" | "driver" | "fleet_manager";
  token: string;
}

const TEST_FLEET_USERS: Record<string, FleetUser> = {
  owner: {
    id: "fleet_user_001",
    phone: "+2348011000001",
    email: "owner@fleet.com",
    firstName: "Adewale",
    lastName: "Balogun",
    name: "Adewale Balogun",
    fleetId: "fleet_001",
    fleetName: "Lagos Express Fleet",
    role: "fleet_manager",
    token: "test_fleet_owner_token",
  },
  manager: {
    id: "fleet_user_002",
    phone: "+2348011000002",
    email: "manager@fleet.com",
    firstName: "Ngozi",
    lastName: "Eze",
    name: "Ngozi Eze",
    fleetId: "fleet_001",
    fleetName: "Lagos Express Fleet",
    role: "rider",
    token: "test_fleet_manager_token",
  },
  dispatcher: {
    id: "fleet_user_003",
    phone: "+2348011000003",
    email: "dispatcher@fleet.com",
    firstName: "Tunde",
    lastName: "Lawal",
    name: "Tunde Lawal",
    fleetId: "fleet_001",
    fleetName: "Lagos Express Fleet",
    role: "driver",
    token: "test_dispatcher_token",
  },
};

async function setFleetSessionCookie(
  page: Page,
  user: FleetUser,
  baseUrl: string,
): Promise<void> {
  const session: FleetSessionData = {
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
    deviceId: `flt_web_fixture_${user.id}`,
    mode: "full",
    expiresAt: Date.now() + 15 * 60 * 1000,
    stepUp: null,
  };
  const sealed = await sealSessionCookie(session, E2E_SESSION_SECRET);
  await page.context().addCookies([
    {
      name: FLEET_SESSION_COOKIE,
      value: sealed,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
}

interface FleetFixtures {
  authenticatedPage: Page;
  fleetUser: FleetUser;
  mockApiResponse: (
    urlPattern: string | RegExp,
    response: unknown,
    status?: number,
  ) => Promise<void>;
  loginAsFleet: (role?: keyof typeof TEST_FLEET_USERS) => Promise<void>;
}

export const test = base.extend<FleetFixtures>({
  fleetUser: async ({}, use) => {
    const ownerUser = TEST_FLEET_USERS.owner!;
    await use(ownerUser);
  },

  authenticatedPage: async ({ page, fleetUser, baseURL }, use) => {
    const targetUrl = baseURL ?? "http://localhost:3004";
    await setFleetSessionCookie(page, fleetUser, targetUrl);
    await page.goto("/dashboard");
    await use(page);
  },

  loginAsFleet: async ({ page, baseURL }, use) => {
    const targetUrl = baseURL ?? "http://localhost:3004";
    const login = async (role: keyof typeof TEST_FLEET_USERS = "owner") => {
      const user = TEST_FLEET_USERS[role]!;
      await setFleetSessionCookie(page, user, targetUrl);
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
});

export { expect, TEST_FLEET_USERS };

export async function waitForPageLoad(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}
