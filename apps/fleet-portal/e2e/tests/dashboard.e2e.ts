/**
 * E2E Test: Fleet Dashboard
 *
 * The fleet portal has no working backend yet. This suite checks that the
 * dashboard says so honestly instead of rendering the fabricated driver
 * stats, charts and alerts an earlier mockup used to show.
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

  test("does not render fabricated fleet numbers", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    // No mock stat cards, chart or driver leaderboard.
    await expect(page.locator(".recharts-wrapper")).toHaveCount(0);
    await expect(page.getByText("Chukwuemeka O.")).toHaveCount(0);
    await expect(page.getByText(/₦|NGN/)).toHaveCount(0);
  });
});
