/**
 * E2E Test Fixtures for Restaurant Portal
 */

import { test as base, expect, type Page } from "@playwright/test";

// =============================================================================
// Types
// =============================================================================

interface RestaurantUser {
  id: string;
  email: string;
  name: string;
  restaurantId: string;
  restaurantName: string;
  role: "owner" | "manager" | "staff";
  token: string;
}

interface Order {
  id: string;
  items: string[];
  total: number;
  customer: string;
  status: "new" | "preparing" | "ready" | "picked_up" | "cancelled";
  time: string;
  prepTime: number;
}

// =============================================================================
// Test Users
// =============================================================================

const TEST_RESTAURANT_USERS: Record<string, RestaurantUser> = {
  owner: {
    id: "rest_user_001",
    email: "owner@restaurant.com",
    name: "Restaurant Owner",
    restaurantId: "rest_001",
    restaurantName: "Mama's Kitchen",
    role: "owner",
    token: "test_owner_token",
  },
  manager: {
    id: "rest_user_002",
    email: "manager@restaurant.com",
    name: "Restaurant Manager",
    restaurantId: "rest_001",
    restaurantName: "Mama's Kitchen",
    role: "manager",
    token: "test_manager_token",
  },
  staff: {
    id: "rest_user_003",
    email: "staff@restaurant.com",
    name: "Kitchen Staff",
    restaurantId: "rest_001",
    restaurantName: "Mama's Kitchen",
    role: "staff",
    token: "test_staff_token",
  },
};

// =============================================================================
// Custom Fixtures
// =============================================================================

interface RestaurantFixtures {
  authenticatedPage: Page;
  restaurantUser: RestaurantUser;
  mockApiResponse: (
    urlPattern: string | RegExp,
    response: unknown,
    status?: number,
  ) => Promise<void>;
  loginAsRestaurant: (
    role?: keyof typeof TEST_RESTAURANT_USERS,
  ) => Promise<void>;
  createMockOrder: (overrides?: Partial<Order>) => Order;
}

export const test = base.extend<RestaurantFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures require a destructuring pattern for the first arg
  restaurantUser: async ({}, run) => {
    await run(TEST_RESTAURANT_USERS.owner);
  },

  authenticatedPage: async ({ page, restaurantUser }, run) => {
    await page.goto("/");

    await page.evaluate(
      ({ user }) => {
        localStorage.setItem("restaurant_token", user.token);
        localStorage.setItem("restaurant_user", JSON.stringify(user));
      },
      { user: restaurantUser },
    );

    await page.goto("/dashboard");
    await run(page);
  },

  loginAsRestaurant: async ({ page }, run) => {
    const login = async (
      role: keyof typeof TEST_RESTAURANT_USERS = "owner",
    ) => {
      const user = TEST_RESTAURANT_USERS[role];

      await page.evaluate(
        ({ user }) => {
          localStorage.setItem("restaurant_token", user.token);
          localStorage.setItem("restaurant_user", JSON.stringify(user));
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

  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures require a destructuring pattern for the first arg
  createMockOrder: async ({}, run) => {
    const createOrder = (overrides: Partial<Order> = {}): Order => ({
      id: `ORD-${Date.now()}`,
      items: ["Jollof Rice (2)", "Suya", "Chapman"],
      total: 8500,
      customer: "Test Customer",
      status: "new",
      time: "2 min ago",
      prepTime: 15,
      ...overrides,
    });

    await run(createOrder);
  },
});

export { expect, TEST_RESTAURANT_USERS };

export async function waitForPageLoad(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}
