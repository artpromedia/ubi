/**
 * E2E Test: Fleet vehicles (/vehicles)
 *
 * The vehicles screen reads `GET /v1/fleets/:id/vehicles` through the API
 * gateway behind the deny-by-default `fleet` flag. Without a verified fleet
 * session it renders an honest state — never fabricated plates or status
 * badges — and with a contract-valid response it renders the server's plate,
 * statusNow, documents and signed drivers.
 */

import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

const HONEST_STATE =
  /Signed out|Fleet tools aren.t available yet in your city|You.re offline|No fleet is linked to your UBI account|Not available for your role|Something went wrong/i;

test.describe("Fleet vehicles", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/vehicles");
    await waitForPageLoad(authenticatedPage);
  });

  test("shows an honest state instead of fabricated vehicles when unauthenticated", async ({
    authenticatedPage,
  }) => {
    await expect(
      authenticatedPage.getByText(HONEST_STATE).first(),
    ).toBeVisible();
  });

  test("never renders mock-era plates or registry chrome", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;
    await expect(page.getByText("Vehicle Registry")).toHaveCount(0);
    await expect(page.getByText("KJA-102-XY")).toHaveCount(0);
    await expect(page.getByText("ABC123XY")).toHaveCount(0);
  });
});
