/**
 * E2E Test Fixtures for Restaurant Portal
 */

import { test as base, expect, Page } from "@playwright/test";

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
  restaurantUser: async ({}, use) => {
    await use(TEST_RESTAURANT_USERS.owner);
  },

  authenticatedPage: async ({ page, restaurantUser }, use) => {
    await page.goto("/");

    await page.evaluate(
      ({ user }) => {
        localStorage.setItem("restaurant_token", user.token);
        localStorage.setItem("restaurant_user", JSON.stringify(user));
      },
      { user: restaurantUser },
    );

    await page.goto("/dashboard");
    await use(page);
  },

  loginAsRestaurant: async ({ page }, use) => {
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

  createMockOrder: async ({}, use) => {
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

    await use(createOrder);
  },
});

export { expect, TEST_RESTAURANT_USERS };

export async function waitForPageLoad(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}
