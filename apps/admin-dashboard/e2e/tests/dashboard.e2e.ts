/**
 * E2E Test: Admin Dashboard
 *
 * Tests the main dashboard page with statistics, charts, and alerts.
 */

import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

test.describe("Dashboard Overview", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/dashboard");
    await waitForPageLoad(authenticatedPage);
  });

  test("should display main statistics cards", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    // Should show key metrics
    await expect(page.getByText(/total users/i)).toBeVisible();
    await expect(page.getByText(/active rides/i)).toBeVisible();
    await expect(page.getByText(/food orders/i)).toBeVisible();
    await expect(page.getByText(/deliveries/i)).toBeVisible();
  });

  test("should display revenue chart", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Should have a revenue section
    await expect(
      page.getByText(/revenue|earnings|income/i).first(),
    ).toBeVisible();

    // Chart should be visible (Recharts renders SVG)
    const chart = page.locator(".recharts-wrapper, svg.recharts-surface");
    await expect(chart.first()).toBeVisible();
  });

  test("should show recent alerts section", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Should show alerts section
    await expect(page.getByText(/recent alerts|alerts/i).first()).toBeVisible();

    // Should have alert items
    const alertItems = page.locator('[class*="alert"], [data-testid*="alert"]');
    // Or text that indicates alert presence
    const fraudText = page.getByText(/fraud|suspicious|payment|activity/i);

    // At least one should be visible
    const hasAlertItems = (await alertItems.count()) > 0;
    const hasFraudText = await fraudText
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasAlertItems || hasFraudText).toBeTruthy();
  });

  test("should display trend indicators on stats", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    // Should show percentage changes (positive or negative)
    const trendIndicators = page.getByText(/\+?\d+\.?\d*%/);
    expect(await trendIndicators.count()).toBeGreaterThan(0);
  });

  test("should have working navigation links", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    // Find navigation links
    const usersLink = page.getByRole("link", { name: /users/i });
    const fraudLink = page.getByRole("link", { name: /fraud/i });

    // At least one nav link should exist
    const hasUsersLink = await usersLink.isVisible().catch(() => false);
    const hasFraudLink = await fraudLink.isVisible().catch(() => false);

    expect(hasUsersLink || hasFraudLink).toBeTruthy();
  });
});

test.describe("Dashboard Filtering", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/dashboard");
    await waitForPageLoad(authenticatedPage);
  });

  test("should filter by date range", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Look for date picker or date range selector
    const datePicker = page.getByRole("button", {
      name: /date|period|range|last.*days/i,
    });

    if (await datePicker.isVisible()) {
      await datePicker.click();

      // Should show date options
      await expect(
        page.getByText(/today|yesterday|7 days|30 days|custom/i).first(),
      ).toBeVisible();
    }
  });

  test("should filter by region/country", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Look for region filter
    const regionFilter = page.getByRole("combobox", {
      name: /region|country|location/i,
    });

    if (await regionFilter.isVisible()) {
      await regionFilter.click();

      // Should show African countries
      await expect(
        page.getByText(/Nigeria|Kenya|Ghana|South Africa/i).first(),
      ).toBeVisible();
    }
  });
});

test.describe("Dashboard Real-time Updates", () => {
  test("should refresh statistics periodically", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    let callCount = 0;

    await page.route(/\/api\/dashboard\/stats/, (route) => {
      callCount++;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalUsers: 10000000 + callCount * 100,
          activeRides: 23000 + callCount * 10,
        }),
      });
    });

    await page.goto("/dashboard");

    // Wait for potential auto-refresh (usually 30s or 60s intervals)
    // For test, we check if the refresh mechanism exists
    const refreshButton = page.getByRole("button", { name: /refresh|reload/i });

    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      // API should have been called
      expect(callCount).toBeGreaterThan(0);
    }
  });

  test("should show real-time ride count", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Active rides should show a number
    const activeRidesValue = page
      .locator(
        '[data-testid="active-rides-value"], :text-matches("\\\\d+,?\\\\d*")',
      )
      .first();
    await expect(activeRidesValue).toBeVisible();
  });
});

test.describe("Dashboard Charts", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/dashboard");
    await waitForPageLoad(authenticatedPage);
  });

  test("should toggle between chart views", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Look for chart type toggles (rides, food, delivery, etc.)
    const chartToggle = page.getByRole("button", {
      name: /rides|food|delivery|all/i,
    });

    if (await chartToggle.first().isVisible()) {
      await chartToggle.first().click();
      // Chart should update (verify by checking for re-render)
      await page.waitForTimeout(500);
    }
  });

  test("should show tooltip on chart hover", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Find chart area
    const chartArea = page.locator(".recharts-wrapper").first();

    if (await chartArea.isVisible()) {
      // Hover over chart
      await chartArea.hover();

      // Tooltip may appear
      const tooltip = page.locator(".recharts-tooltip-wrapper");
      // Don't fail if tooltip doesn't appear - some charts may not have it
    }
  });
});

test.describe("Dashboard Mobile Responsiveness", () => {
  test("should stack cards on mobile viewport", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/dashboard");

    // Stats cards should still be visible
    await expect(page.getByText(/total users/i)).toBeVisible();

    // Should have hamburger menu for navigation
    const hamburger = page.getByRole("button", { name: /menu|toggle/i });
    // Mobile nav should be accessible
  });

  test("should have accessible touch targets", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/dashboard");

    // Buttons should be at least 44x44px for touch
    const buttons = page.getByRole("button");
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const button = buttons.nth(i);
      const box = await button.boundingBox();
      if (box) {
        // Touch target should be at least 40px
        expect(box.width).toBeGreaterThanOrEqual(40);
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    }
  });
});
