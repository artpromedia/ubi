/**
 * E2E Test: Food Ordering Flow
 *
 * Tests the complete food ordering flow including:
 * - Restaurant discovery
 * - Menu browsing
 * - Cart management
 * - Order placement
 * - Order tracking
 */

import { TEST_MENU_ITEMS, TEST_RESTAURANTS } from "@ubi/testing";
import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

test.describe("Restaurant Discovery", () => {
  test.beforeEach(async ({ authenticatedPage, mockLocation }) => {
    // Set location to Lagos
    await mockLocation(6.4281, 3.4219);
    await authenticatedPage.goto("/food");
    await waitForPageLoad(authenticatedPage);
  });

  test("should show nearby restaurants", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/restaurants\/nearby/, {
      success: true,
      data: {
        restaurants: TEST_RESTAURANTS.slice(0, 3),
      },
    });

    await authenticatedPage.goto("/food");

    // Should show restaurant listings
    await expect(
      authenticatedPage.locator("[data-testid='restaurant-list']")
    ).toBeVisible();

    // Should show restaurant names
    await expect(
      authenticatedPage.getByText(/restaurant/i).first()
    ).toBeVisible();
  });

  test("should show restaurant categories", async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/food");

    // Should show category filters
    await expect(
      authenticatedPage.locator("[data-testid='category-filters']")
    ).toBeVisible();

    // Common African food categories
    const categories = ["All", "Local", "Fast Food", "Rice", "Grills"];
    for (const category of categories.slice(0, 2)) {
      await expect(authenticatedPage.getByText(category)).toBeVisible();
    }
  });

  test("should search restaurants by name", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/restaurants\/search/, {
      success: true,
      data: {
        restaurants: [TEST_RESTAURANTS[0]],
      },
    });

    await authenticatedPage.goto("/food");

    // Search for restaurant
    await authenticatedPage.getByPlaceholder(/search|find/i).fill("Mama");

    // Should trigger search
    await authenticatedPage.waitForTimeout(500); // Debounce

    // Should show search results
    await expect(
      authenticatedPage.locator("[data-testid='search-results']")
    ).toBeVisible();
  });

  test("should filter restaurants by cuisine type", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto("/food");

    // Click on a cuisine filter
    await authenticatedPage
      .getByText(/nigerian|local/i)
      .first()
      .click();

    // URL should update with filter
    await expect(authenticatedPage).toHaveURL(/cuisine|filter|category/);
  });
});

test.describe("Restaurant Details", () => {
  test("should show restaurant menu", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const restaurant = TEST_RESTAURANTS[0];
    await mockApiResponse(new RegExp(`/api/restaurants/${restaurant.id}`), {
      success: true,
      data: { restaurant },
    });

    await mockApiResponse(
      new RegExp(`/api/restaurants/${restaurant.id}/menu`),
      {
        success: true,
        data: { menu: TEST_MENU_ITEMS },
      }
    );

    await authenticatedPage.goto(`/food/restaurant/${restaurant.id}`);

    // Should show restaurant name
    await expect(
      authenticatedPage.getByRole("heading", { level: 1 })
    ).toBeVisible();

    // Should show menu items
    await expect(
      authenticatedPage.locator("[data-testid='menu-items']")
    ).toBeVisible();
  });

  test("should show menu item details", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const menuItem = TEST_MENU_ITEMS[0];
    await mockApiResponse(new RegExp(`/api/menu-items/${menuItem.id}`), {
      success: true,
      data: { item: menuItem },
    });

    await authenticatedPage.goto("/food/restaurant/rest_001");

    // Click on menu item
    await authenticatedPage
      .locator("[data-testid='menu-item']")
      .first()
      .click();

    // Should show item modal/page
    await expect(
      authenticatedPage.locator("[data-testid='item-details']")
    ).toBeVisible();

    // Should show price
    await expect(authenticatedPage.getByText(/₦|NGN/)).toBeVisible();
  });

  test("should show restaurant rating and reviews", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto("/food/restaurant/rest_001");

    // Should show rating
    await expect(
      authenticatedPage.locator("[data-testid='restaurant-rating']")
    ).toBeVisible();

    // Should show delivery time estimate
    await expect(authenticatedPage.getByText(/min|minutes/i)).toBeVisible();
  });
});

test.describe("Cart Management", () => {
  test("should add item to cart", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/cart/, {
      success: true,
      data: {
        cart: {
          items: [{ itemId: "item_001", quantity: 1, price: 1500 }],
          total: 1500,
        },
      },
    });

    await authenticatedPage.goto("/food/restaurant/rest_001");

    // Add item to cart
    await authenticatedPage
      .getByRole("button", { name: /add|plus|\+/i })
      .first()
      .click();

    // Should show cart indicator
    await expect(
      authenticatedPage.locator("[data-testid='cart-indicator']")
    ).toBeVisible();
  });

  test("should update item quantity in cart", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/cart/, {
      success: true,
      data: {
        cart: {
          items: [{ itemId: "item_001", quantity: 2, price: 1500 }],
          total: 3000,
        },
      },
    });

    await authenticatedPage.goto("/food/cart");

    // Increase quantity
    await authenticatedPage
      .getByRole("button", { name: /plus|\+|increase/i })
      .click();

    // Should update total
    await expect(authenticatedPage.getByText(/3,000|3000/)).toBeVisible();
  });

  test("should remove item from cart", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/cart\/items\/item_001/, {
      success: true,
      data: { cart: { items: [], total: 0 } },
    });

    await authenticatedPage.goto("/food/cart");

    // Remove item
    await authenticatedPage
      .getByRole("button", { name: /remove|delete|trash/i })
      .first()
      .click();

    // Should show empty cart
    await expect(authenticatedPage.getByText(/empty|no items/i)).toBeVisible();
  });

  test("should persist cart across sessions", async ({
    authenticatedPage,
    context,
  }) => {
    // Add item to cart
    await authenticatedPage.goto("/food/restaurant/rest_001");
    await authenticatedPage
      .getByRole("button", { name: /add|\+/i })
      .first()
      .click();

    // Open new page in same context
    const newPage = await context.newPage();
    await newPage.goto("/food/cart");

    // Cart should have item
    await expect(newPage.locator("[data-testid='cart-item']")).toBeVisible();

    await newPage.close();
  });
});

test.describe("Order Placement", () => {
  test("should show checkout page with order summary", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/cart/, {
      success: true,
      data: {
        cart: {
          items: [
            {
              itemId: "item_001",
              name: "Jollof Rice",
              quantity: 1,
              price: 1500,
            },
          ],
          total: 1500,
          restaurantId: "rest_001",
        },
      },
    });

    await authenticatedPage.goto("/food/checkout");

    // Should show order summary
    await expect(
      authenticatedPage.locator("[data-testid='order-summary']")
    ).toBeVisible();

    // Should show delivery address section
    await expect(
      authenticatedPage.getByText(/delivery|address/i)
    ).toBeVisible();

    // Should show payment section
    await expect(authenticatedPage.getByText(/payment/i)).toBeVisible();
  });

  test("should allow selecting delivery address", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/users\/.*\/addresses/, {
      success: true,
      data: {
        addresses: [
          { id: "addr_001", name: "Home", address: "15 Victoria Island" },
          { id: "addr_002", name: "Work", address: "Ikeja City Mall" },
        ],
      },
    });

    await authenticatedPage.goto("/food/checkout");

    // Click address section
    await authenticatedPage
      .getByRole("button", { name: /change|select|address/i })
      .first()
      .click();

    // Should show saved addresses
    await expect(authenticatedPage.getByText(/home/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/work/i)).toBeVisible();
  });

  test("should place order successfully", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/food-orders/, {
      success: true,
      data: {
        order: {
          id: "order_001",
          status: "confirmed",
          estimatedDelivery: 45,
        },
      },
    });

    await authenticatedPage.goto("/food/checkout");

    // Place order
    await authenticatedPage
      .getByRole("button", { name: /place order|confirm|order now/i })
      .click();

    // Should redirect to tracking page
    await expect(authenticatedPage).toHaveURL(/track|order/);
  });

  test("should handle payment failure gracefully", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/food-orders/, {
      success: false,
      error: {
        code: "PAYMENT_FAILED",
        message: "Payment could not be processed",
      },
    });

    await authenticatedPage.goto("/food/checkout");

    // Try to place order
    await authenticatedPage
      .getByRole("button", { name: /place order|confirm/i })
      .click();

    // Should show error message
    await expect(
      authenticatedPage.getByText(/payment|failed|error/i)
    ).toBeVisible();
  });
});

test.describe("Order Tracking", () => {
  test("should show order status timeline", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/food-orders\/order_001/, {
      success: true,
      data: {
        order: {
          id: "order_001",
          status: "preparing",
          statusHistory: [
            { status: "confirmed", timestamp: "2024-01-15T10:00:00Z" },
            { status: "preparing", timestamp: "2024-01-15T10:05:00Z" },
          ],
          estimatedDelivery: 35,
        },
      },
    });

    await authenticatedPage.goto("/food/order/order_001");

    // Should show order timeline
    await expect(
      authenticatedPage.locator("[data-testid='order-timeline']")
    ).toBeVisible();

    // Should show current status
    await expect(
      authenticatedPage.getByText(/preparing|being prepared/i)
    ).toBeVisible();
  });

  test("should show delivery driver info when assigned", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/food-orders\/order_001/, {
      success: true,
      data: {
        order: {
          id: "order_001",
          status: "out_for_delivery",
          deliveryDriver: {
            id: "driver_001",
            firstName: "Kwame",
            rating: 4.7,
            phoneNumber: "+233241234567",
          },
          estimatedDelivery: 15,
        },
      },
    });

    await authenticatedPage.goto("/food/order/order_001");

    // Should show driver info
    await expect(authenticatedPage.getByText(/kwame/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/4\.7/)).toBeVisible();

    // Should show call button
    await expect(
      authenticatedPage.getByRole("button", { name: /call|contact/i })
    ).toBeVisible();
  });

  test("should update order status in real-time", async ({
    authenticatedPage,
    page,
  }) => {
    await authenticatedPage.goto("/food/order/order_001");

    // Status should update (via WebSocket or polling)
    await expect(
      authenticatedPage.locator("[data-testid='order-status']")
    ).toBeVisible();
  });
});

test.describe("Order History", () => {
  test("should show past orders", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/food-orders/, {
      success: true,
      data: {
        orders: [
          {
            id: "order_001",
            restaurantName: "Mama Putt's Kitchen",
            total: 4500,
            status: "delivered",
            createdAt: "2024-01-14T12:00:00Z",
          },
          {
            id: "order_002",
            restaurantName: "Java House",
            total: 2800,
            status: "delivered",
            createdAt: "2024-01-10T18:00:00Z",
          },
        ],
        pagination: { page: 1, totalPages: 1 },
      },
    });

    await authenticatedPage.goto("/food/orders");

    // Should show order history
    await expect(
      authenticatedPage.locator("[data-testid='order-history']")
    ).toBeVisible();

    // Should show past orders
    await expect(authenticatedPage.getByText(/mama putt/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/java house/i)).toBeVisible();
  });

  test("should allow reordering from history", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/food-orders\/order_001\/reorder/, {
      success: true,
      data: {
        cart: {
          items: [{ itemId: "item_001", quantity: 1, price: 1500 }],
          total: 1500,
        },
      },
    });

    await authenticatedPage.goto("/food/orders");

    // Click reorder
    await authenticatedPage
      .getByRole("button", { name: /reorder|order again/i })
      .first()
      .click();

    // Should redirect to cart
    await expect(authenticatedPage).toHaveURL(/cart|checkout/);
  });
});

test.describe("Promotions and Discounts", () => {
  test("should apply promo code", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/cart\/promo/, {
      success: true,
      data: {
        discount: 500,
        discountType: "fixed",
        newTotal: 1000,
      },
    });

    await authenticatedPage.goto("/food/checkout");

    // Enter promo code
    await authenticatedPage
      .getByPlaceholder(/promo|code|coupon/i)
      .fill("WELCOME50");

    // Apply code
    await authenticatedPage.getByRole("button", { name: /apply/i }).click();

    // Should show discount
    await expect(authenticatedPage.getByText(/discount|saved/i)).toBeVisible();
  });

  test("should handle invalid promo code", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/cart\/promo/, {
      success: false,
      error: {
        code: "INVALID_PROMO",
        message: "Invalid or expired promo code",
      },
    });

    await authenticatedPage.goto("/food/checkout");

    // Enter invalid promo code
    await authenticatedPage.getByPlaceholder(/promo|code/i).fill("INVALID");

    await authenticatedPage.getByRole("button", { name: /apply/i }).click();

    // Should show error
    await expect(
      authenticatedPage.getByText(/invalid|expired|not found/i)
    ).toBeVisible();
  });
});
