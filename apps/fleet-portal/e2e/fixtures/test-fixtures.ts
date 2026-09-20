/**
 * E2E Test Fixtures for Fleet Portal
 */

import { test as base, expect, type Page } from "@playwright/test";

interface FleetUser {
  id: string;
  email: string;
  name: string;
  fleetId: string;
  fleetName: string;
  role: "owner" | "manager" | "dispatcher";
  token: string;
}

const TEST_FLEET_USERS: Record<string, FleetUser> = {
  owner: {
    id: "fleet_user_001",
    email: "owner@fleet.com",
    name: "Fleet Owner",
    fleetId: "fleet_001",
    fleetName: "Lagos Express Fleet",
    role: "owner",
    token: "test_fleet_owner_token",
  },
  manager: {
    id: "fleet_user_002",
    email: "manager@fleet.com",
    name: "Fleet Manager",
    fleetId: "fleet_001",
    fleetName: "Lagos Express Fleet",
    role: "manager",
    token: "test_fleet_manager_token",
  },
  dispatcher: {
    id: "fleet_user_003",
    email: "dispatcher@fleet.com",
    name: "Dispatcher",
    fleetId: "fleet_001",
    fleetName: "Lagos Express Fleet",
    role: "dispatcher",
    token: "test_dispatcher_token",
  },
};

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
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures require a destructuring pattern for the first arg
  fleetUser: async ({}, run) => {
    await run(TEST_FLEET_USERS.owner);
  },

  authenticatedPage: async ({ page, fleetUser }, run) => {
    await page.goto("/");

    await page.evaluate(
      ({ user }) => {
        localStorage.setItem("fleet_token", user.token);
        localStorage.setItem("fleet_user", JSON.stringify(user));
      },
      { user: fleetUser },
    );

    await page.goto("/dashboard");
    await run(page);
  },

  loginAsFleet: async ({ page }, run) => {
    const login = async (role: keyof typeof TEST_FLEET_USERS = "owner") => {
      const user = TEST_FLEET_USERS[role];

      await page.evaluate(
        ({ user }) => {
          localStorage.setItem("fleet_token", user.token);
          localStorage.setItem("fleet_user", JSON.stringify(user));
        },
        { user },
      );
    };

    await run(login);
  },

  mockApiResponse: async ({ page }, run) => {
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

    await run(mock);
  },
});

export { expect, TEST_FLEET_USERS };

export async function waitForPageLoad(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}
