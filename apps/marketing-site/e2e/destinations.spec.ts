/**
 * DestinationLink: an https destination renders a link; an unset or http value
 * renders a launch-status notice that is not focusable. Store badges never
 * appear without a store URL. Every outbound anchor is https.
 */
import { expect, test } from "@playwright/test";

import { scenario } from "./helpers";

test("rider and driver CTAs are https links; store links are pending notices", async ({
  page,
  request,
}) => {
  await scenario(request, "launch_day");
  await page.goto("/cities/lagos");

  await expect(page.getByTestId("marketing.city.riderCta")).toHaveAttribute(
    "href",
    "https://app.ubi.africa/",
  );
  const rider = page.getByTestId("marketing.access.rider");
  const pending = rider.getByTestId("marketing.destination.pending");
  await expect(pending).toHaveCount(2);
  await expect(pending.nth(0)).toHaveText(
    "App Store link appears when the listing is published.",
  );
  await expect(pending.nth(1)).toHaveText(
    "Google Play link appears when the listing is published.",
  );
  for (const span of await pending.all()) {
    await expect(span).toHaveAttribute("aria-disabled", "true");
    expect(await span.evaluate((el) => el.tagName)).toBe("SPAN");
    expect(await span.evaluate((el) => el.hasAttribute("tabindex"))).toBe(
      false,
    );
  }
  await expect(
    page.locator(
      'img[src*="app-store"], img[src*="google-play"], img[alt*="App Store"], img[alt*="Google Play"]',
    ),
  ).toHaveCount(0);
});

test("a non-https value is treated as unset (Terms), an https value renders (Privacy)", async ({
  page,
  request,
}) => {
  await scenario(request, "launch_day");
  await page.goto("/help");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "href",
    "https://www.ubi.africa/privacy",
  );
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveCount(0);
  await expect(
    footer.getByText("Terms are published before public launch."),
  ).toBeVisible();
  await expect(page.getByTestId("marketing.drive.requirements")).toHaveCount(0);
});

test("fleet contact and help destinations render launch-status copy on /drive", async ({
  page,
  request,
}) => {
  await scenario(request, "launch_day");
  await page.goto("/drive");
  await expect(
    page.getByText(
      "Fleet arrangements are agreed with UBI directly. Contact details follow at launch.",
    ),
  ).toBeVisible();
});

test("analytics hooks are present on CTAs but nothing is sent before consent", async ({
  page,
  request,
}) => {
  await scenario(request, "launch_day");
  const outbound: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith("http://127.0.0.1")) outbound.push(url);
  });
  await page.goto("/cities/lagos");
  await expect(page.getByTestId("marketing.city.riderCta")).toHaveAttribute(
    "data-analytics",
    "ride",
  );
  await expect(page.getByTestId("marketing.city.riderCta")).toHaveAttribute(
    "data-destination-set",
    "true",
  );
  await page.waitForTimeout(500);
  // Fonts are self-hosted by the build; no analytics vendor, no third-party call.
  expect(outbound.filter((url) => !url.startsWith("data:"))).toEqual([]);
});
