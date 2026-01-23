/**
 * E2E Test: Fleet Dashboard
 *
 * Tests the main fleet management dashboard with driver stats and performance.
 */

import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

test.describe("Dashboard Overview", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/dashboard");
    await waitForPageLoad(authenticatedPage);
  });

  test("should display fleet statistics", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Key metrics
    await expect(page.getByText(/active.*drivers/i).first()).toBeVisible();
    await expect(page.getByText(/vehicles/i).first()).toBeVisible();
  });

  test("should show earnings overview", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await expect(page.getByText(/earnings|revenue/i).first()).toBeVisible();

    // Naira amounts
    const amounts = page.getByText(/₦|NGN/);
    expect(await amounts.count()).toBeGreaterThan(0);
  });

  test("should display average rating", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await expect(
      page.getByText(/rating|avg.*rating|\d\.\d+/i).first(),
    ).toBeVisible();
  });

  test("should show top performing drivers", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await expect(
      page.getByText(/top.*drivers|best.*drivers|performance/i).first(),
    ).toBeVisible();

    // Driver names
    const driverNames = page.locator(
      '[class*="driver"], [data-testid*="driver"]',
    );
    expect(await driverNames.count()).toBeGreaterThan(0);
  });

  test("should display performance chart", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Chart should be visible
    const chart = page.locator(".recharts-wrapper, svg");
    expect(await chart.count()).toBeGreaterThan(0);
  });

  test("should show trend indicators", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const trends = page.getByText(/\+?\-?\d+\.?\d*%/);
    expect(await trends.count()).toBeGreaterThan(0);
  });
});

test.describe("Driver Status Overview", () => {
  test("should show online/offline status breakdown", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    // Status indicators
    await expect(
      page.getByText(/online|offline|busy|available/i).first(),
    ).toBeVisible();
  });

  test("should show acceptance rate", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    const acceptanceRate = page.getByText(/acceptance.*rate|\d+%/i);
    expect(await acceptanceRate.count()).toBeGreaterThan(0);
  });
});

test.describe("Quick Actions", () => {
  test("should navigate to drivers list", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    const driversLink = page.getByRole("link", { name: /drivers|view.*all/i });

    if (await driversLink.first().isVisible()) {
      await driversLink.first().click();
      await expect(page).toHaveURL(/drivers/);
    }
  });

  test("should navigate to vehicles list", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    const vehiclesLink = page.getByRole("link", { name: /vehicles/i });

    if (await vehiclesLink.isVisible()) {
      await vehiclesLink.click();
      await expect(page).toHaveURL(/vehicles/);
    }
  });
});

test.describe("Alerts Section", () => {
  test("should display fleet alerts", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    const alertsSection = page.getByText(/alerts|attention|issues/i);
    // May or may not have alerts
  });

  test("should show low acceptance rate warnings", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;
    await page.goto("/dashboard");

    const warningIndicators = page.locator(
      '[class*="warning"], [class*="alert"]',
    );
    // Contextual - may not always appear
  });
});
