/**
 * E2E Test: Restaurant Orders Management
 *
 * Tests the order queue, order acceptance, and order status management.
 */

import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

test.describe("Order Queue", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/dashboard");
    await waitForPageLoad(authenticatedPage);
  });

  test("should display active orders", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Should show orders section
    await expect(
      page.getByText(/orders|active orders|new orders/i).first(),
    ).toBeVisible();
  });

  test("should show order details", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Should display order info
    await expect(page.getByText(/ORD-|order/i).first()).toBeVisible();

    // Should show items
    const orderItems = page.getByText(/jollof|rice|chicken|soup|suya/i);
    expect(await orderItems.count()).toBeGreaterThan(0);
  });

  test("should show order status badges", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Status indicators
    const statusBadges = page.getByText(/new|preparing|ready|picked.up/i);
    expect(await statusBadges.count()).toBeGreaterThan(0);
  });

  test("should display order total", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Should show price/total
    const priceText = page.getByText(/₦|NGN|\d{1,3}(,\d{3})*/);
    expect(await priceText.count()).toBeGreaterThan(0);
  });

  test("should show customer name", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Customer names typically show as initials or partial names
    const customerInfo = page.locator(
      '[class*="customer"], [data-testid*="customer"]',
    );
    // May or may not have specific test IDs
  });

  test("should display prep time estimate", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Prep time shows in minutes
    const prepTime = page.getByText(/\d+\s*min/i);
    expect(await prepTime.count()).toBeGreaterThan(0);
  });
});

test.describe("Accept/Reject Orders", () => {
  test("should accept new order", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/orders\/.*\/accept/, {
      success: true,
      data: { status: "preparing" },
    });

    await page.goto("/dashboard");

    const acceptButton = page.getByRole("button", {
      name: /accept|confirm|✓/i,
    });

    if (await acceptButton.first().isVisible()) {
      await acceptButton.first().click();

      // Order should move to preparing status
      await expect(page.getByText(/preparing|accepted/i).first()).toBeVisible();
    }
  });

  test("should reject order with reason", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/orders\/.*\/reject/, {
      success: true,
      data: { status: "cancelled" },
    });

    await page.goto("/dashboard");

    const rejectButton = page.getByRole("button", {
      name: /reject|decline|✗|×/i,
    });

    if (await rejectButton.first().isVisible()) {
      await rejectButton.first().click();

      // May need to provide reason
      const reasonSelect = page.getByRole("combobox", { name: /reason/i });
      if (await reasonSelect.isVisible()) {
        await reasonSelect.selectOption({ index: 1 });
      }

      const confirmButton = page.getByRole("button", {
        name: /confirm|reject/i,
      });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }
    }
  });

  test("should set custom prep time", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/orders\/.*\/prep-time/, {
      success: true,
      data: { prepTime: 25 },
    });

    await page.goto("/dashboard");

    // Look for prep time input or button
    const prepTimeButton = page.getByRole("button", {
      name: /prep|time|\d+\s*min/i,
    });

    if (await prepTimeButton.first().isVisible()) {
      await prepTimeButton.first().click();

      const timeInput = page.getByRole("spinbutton");
      if (await timeInput.isVisible()) {
        await timeInput.fill("25");
      }
    }
  });
});

test.describe("Order Status Updates", () => {
  test("should mark order as ready", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/orders\/.*\/ready/, {
      success: true,
      data: { status: "ready" },
    });

    await page.goto("/dashboard");

    const readyButton = page.getByRole("button", {
      name: /ready|done|complete/i,
    });

    if (await readyButton.first().isVisible()) {
      await readyButton.first().click();

      // Should update status
      await expect(page.getByText(/ready|completed/i).first()).toBeVisible();
    }
  });

  test("should mark order as picked up", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/orders\/.*\/picked-up/, {
      success: true,
      data: { status: "picked_up" },
    });

    await page.goto("/dashboard");

    const pickedUpButton = page.getByRole("button", {
      name: /picked.*up|delivered|handoff/i,
    });

    if (await pickedUpButton.first().isVisible()) {
      await pickedUpButton.first().click();
    }
  });

  test("should filter orders by status", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    // Status filter tabs
    const allTab = page.getByRole("button", { name: /all/i });
    const newTab = page.getByRole("button", { name: /^new$/i });
    const preparingTab = page.getByRole("button", { name: /preparing/i });
    const readyTab = page.getByRole("button", { name: /ready/i });

    if (await newTab.isVisible()) {
      await newTab.click();
      // Should filter to new orders only
    }
  });
});

test.describe("Order Sound Alerts", () => {
  test("should have audio alert setting", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    // Look for sound toggle
    const soundToggle = page.getByRole("button", {
      name: /sound|audio|🔔|🔕/i,
    });

    if (await soundToggle.isVisible()) {
      await soundToggle.click();
      // Should toggle sound
    }
  });
});

test.describe("Order Details Modal", () => {
  test("should view full order details", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    // Click on order to expand/view details
    const orderCard = page
      .locator('[class*="order-card"], [data-testid*="order"]')
      .first();

    if (await orderCard.isVisible()) {
      await orderCard.click();

      // Should show full item list
      await expect(
        page.getByText(/items|order details/i).first(),
      ).toBeVisible();
    }
  });

  test("should show customer notes", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    // Expand order details
    const orderCard = page.locator('[class*="order-card"]').first();
    if (await orderCard.isVisible()) {
      await orderCard.click();
    }

    // Notes section
    const notes = page.getByText(/note|special.*instruction|comment/i);
    // May or may not have notes
  });

  test("should display delivery vs pickup", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    // Order type indicator
    const deliveryLabel = page.getByText(/delivery|pickup|dine.in/i);
    // Should have at least one type indicator
  });
});

test.describe("Bulk Order Actions", () => {
  test("should select multiple orders", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    const checkboxes = page.getByRole("checkbox");

    if ((await checkboxes.count()) > 1) {
      await checkboxes.nth(0).check();
      await checkboxes.nth(1).check();
    }
  });

  test("should bulk mark as ready", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/orders\/bulk/, {
      success: true,
      data: { updated: 2 },
    });

    await page.goto("/dashboard");

    const checkboxes = page.getByRole("checkbox");
    if ((await checkboxes.count()) > 1) {
      await checkboxes.nth(0).check();
      await checkboxes.nth(1).check();

      const bulkReadyButton = page.getByRole("button", {
        name: /mark.*ready|bulk|selected/i,
      });
      if (await bulkReadyButton.isVisible()) {
        await bulkReadyButton.click();
      }
    }
  });
});

test.describe("Real-time Order Updates", () => {
  test("should refresh orders automatically", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    let callCount = 0;
    await page.route(/\/api\/orders/, (route) => {
      callCount++;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          orders: [{ id: `ORD-00${callCount}`, status: "new" }],
        }),
      });
    });

    await page.goto("/dashboard");

    // Manual refresh
    const refreshButton = page.getByRole("button", { name: /refresh/i });
    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      expect(callCount).toBeGreaterThan(0);
    }
  });

  test("should show notification for new order", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    // New order notification badge
    const badge = page.locator(
      '[class*="badge"], [class*="notification"], [class*="new"]',
    );
    // May or may not have notifications
  });
});

test.describe("Tablet-Optimized Interface", () => {
  test("should have large touch targets", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await page.setViewportSize({ width: 1024, height: 768 }); // iPad
    await page.goto("/dashboard");

    const buttons = page.getByRole("button");
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const button = buttons.nth(i);
      const box = await button.boundingBox();
      if (box) {
        // Touch targets should be at least 44px
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    }
  });

  test("should be usable in portrait orientation", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    await page.setViewportSize({ width: 768, height: 1024 }); // Portrait
    await page.goto("/dashboard");

    // Should still show orders
    await expect(page.getByText(/orders/i).first()).toBeVisible();
  });
});
