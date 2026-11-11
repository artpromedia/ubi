/**
 * E2E Test: Fleet assignments & drivers (/assignments and /drivers redirect)
 *
 * Driver relationships in the Fleet Portal live under `/assignments` (signed
 * arrangements and pending proposals) and `/calendar?rows=drivers`. Without a
 * verified fleet session it renders an honest state — never fabricated driver
 * directories, ratings or earnings.
 */

import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

const HONEST_STATE =
  /Signed out|Fleet tools aren.t available yet in your city|You.re offline|No fleet is linked to your UBI account|Not available for your role|Something went wrong/i;

test.describe("Fleet assignments & drivers", () => {
  test("shows an honest state on /assignments instead of fabricated drivers", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto("/assignments");
    await waitForPageLoad(authenticatedPage);
    await expect(
      authenticatedPage.getByText(HONEST_STATE).first(),
    ).toBeVisible();
  });

  test("never renders mock-era driver directory, ratings, or net earnings", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;
    await page.goto("/assignments");
    await waitForPageLoad(page);
    await expect(page.getByText("Driver Directory")).toHaveCount(0);
    await expect(page.getByText("Chidi Okafor")).toHaveCount(0);
    await expect(page.getByText("Chukwuemeka O.")).toHaveCount(0);
    await expect(page.getByText(/★/)).toHaveCount(0);
  });
});
