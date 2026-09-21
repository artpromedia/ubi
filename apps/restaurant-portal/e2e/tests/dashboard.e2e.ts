/**
 * E2E Test: Restaurant Dashboard
 *
 * UBI Bites isn't live and this portal has no working order/menu backend.
 * This suite checks that the dashboard says so honestly instead of
 * rendering the fabricated orders, revenue and prep-time stats an earlier
 * mockup used to show.
 */

import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

test.describe("Dashboard placeholder", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/dashboard");
    await waitForPageLoad(authenticatedPage);
  });

  test("says the portal isn't available yet", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await expect(
      page.getByRole("heading", { name: /isn.t available yet/i }),
    ).toBeVisible();
    await expect(page.getByText(/arranged directly with ubi/i)).toBeVisible();
  });

  test("does not render fabricated order or revenue data", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    await expect(page.locator(".recharts-wrapper")).toHaveCount(0);
    await expect(page.getByText("Jollof Rice")).toHaveCount(0);
    await expect(page.getByText(/₦|NGN/)).toHaveCount(0);
  });
});
