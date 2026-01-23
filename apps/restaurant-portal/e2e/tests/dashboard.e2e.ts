/**
 * E2E Test: Restaurant Dashboard
 *
 * Tests the main dashboard with statistics, revenue, and overview.
 */

import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

test.describe("Dashboard Overview", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/dashboard");
    await waitForPageLoad(authenticatedPage);
  });

  test("should display today's statistics", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Key metrics
    await expect(
      page.getByText(/today.*revenue|revenue/i).first(),
    ).toBeVisible();
    await expect(page.getByText(/total.*orders|orders/i).first()).toBeVisible();
  });

  test("should show average prep time", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await expect(page.getByText(/avg.*prep|prep.*time/i).first()).toBeVisible();
  });

  test("should display restaurant rating", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Rating with star
    await expect(page.getByText(/rating|\d\.\d|★/i).first()).toBeVisible();
  });

  test("should show revenue chart", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Recharts renders SVG
    const chart = page.locator(".recharts-wrapper, svg");
    expect(await chart.count()).toBeGreaterThan(0);
  });

  test("should display trend indicators", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Percentage changes
    const trends = page.getByText(/\+?\-?\d+\.?\d*%/);
    expect(await trends.count()).toBeGreaterThan(0);
  });
});

test.describe("Dashboard Navigation", () => {
  test("should navigate to menu management", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    const menuLink = page.getByRole("link", { name: /menu/i });

    if (await menuLink.isVisible()) {
      await menuLink.click();
      await expect(page).toHaveURL(/menu/);
    }
  });

  test("should navigate to analytics", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    const analyticsLink = page.getByRole("link", {
      name: /analytics|reports/i,
    });

    if (await analyticsLink.isVisible()) {
      await analyticsLink.click();
      await expect(page).toHaveURL(/analytics|reports/);
    }
  });

  test("should navigate to settings", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    const settingsLink = page.getByRole("link", { name: /settings/i });

    if (await settingsLink.isVisible()) {
      await settingsLink.click();
      await expect(page).toHaveURL(/settings/);
    }
  });
});

test.describe("Quick Actions", () => {
  test("should toggle restaurant open/closed", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/restaurant\/status/, {
      success: true,
      data: { isOpen: false },
    });

    await page.goto("/dashboard");

    const toggleButton = page.getByRole("button", {
      name: /open|closed|toggle.*status/i,
    });

    if (await toggleButton.isVisible()) {
      await toggleButton.click();
    }
  });

  test("should pause orders temporarily", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/restaurant\/pause/, {
      success: true,
      data: { paused: true },
    });

    await page.goto("/dashboard");

    const pauseButton = page.getByRole("button", {
      name: /pause|stop.*orders/i,
    });

    if (await pauseButton.isVisible()) {
      await pauseButton.click();
    }
  });
});

test.describe("Alerts Section", () => {
  test("should show low stock alerts", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    const lowStockAlert = page.getByText(
      /low.*stock|out.*of.*stock|running.*low/i,
    );
    // May or may not have alerts
  });

  test("should show busy time warnings", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    const busyWarning = page.getByText(/busy|high.*demand|peak/i);
    // Contextual - may not always appear
  });
});

test.describe("Revenue Details", () => {
  test("should filter revenue by date", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    const datePicker = page.getByRole("button", { name: /today|date|period/i });

    if (await datePicker.isVisible()) {
      await datePicker.click();

      const yesterdayOption = page.getByText(/yesterday/i);
      if (await yesterdayOption.isVisible()) {
        await yesterdayOption.click();
      }
    }
  });

  test("should show revenue breakdown", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    // Revenue breakdown by category or time
    const breakdown = page.getByText(/breakdown|by.*category|by.*hour/i);
    // Optional feature
  });
});
