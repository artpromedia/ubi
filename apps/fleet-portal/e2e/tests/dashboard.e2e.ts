/**
 * E2E Test: Fleet overview
 *
 * The portal reads fleet-service through the API gateway with the signed-in
 * staff member's token, behind the deny-by-default `fleet` flag. Without a
 * real signed-in fleet member (these fixtures use a placeholder token) the
 * overview must show one of its honest states — signed out, not available
 * in this city, UBI unreachable, or no fleet linked — and never fabricated
 * numbers, drivers or money.
 */

import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

const HONEST_STATE =
  /Signed out|Fleet tools aren.t available yet in your city|You.re offline|No fleet is linked to your UBI account|Not available for your role|Something went wrong/i;

test.describe("Fleet overview", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/dashboard");
    await waitForPageLoad(authenticatedPage);
  });

  test("shows an honest state instead of fleet data it cannot verify", async ({
    authenticatedPage,
  }) => {
    await expect(
      authenticatedPage.getByText(HONEST_STATE).first(),
    ).toBeVisible();
  });

  test("does not render fabricated fleet numbers or money", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;
    await expect(page.locator(".recharts-wrapper")).toHaveCount(0);
    await expect(page.getByText("Chukwuemeka O.")).toHaveCount(0);
    await expect(page.getByText(/₦|NGN/)).toHaveCount(0);
    await expect(
      page.locator('[data-testid="fleet.calendar.vehicleRow"]'),
    ).toHaveCount(0);
  });

  test("names every real section in the navigation", async ({
    authenticatedPage,
  }) => {
    const nav = authenticatedPage.getByRole("navigation", {
      name: "Fleet portal",
    });
    for (const name of [
      "Overview",
      "Calendar",
      "Vehicles",
      "Conflicts",
      "Assignments",
      "Utilisation",
      "Staff & roles",
    ]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
  });
});
