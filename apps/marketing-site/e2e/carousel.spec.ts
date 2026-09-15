/**
 * City photo carousel (boards 24a/24b/24f): opens on the page's city, arrows
 * and dots change the slide, Left/Right keys work when the region has focus,
 * swipe changes the slide on touch, auto-advance only on /cities (paused on
 * hover and focus, off under reduced motion), alt and caption on every image,
 * and a visible licence credit linking to the source.
 */
import { type Page, expect, test } from "@playwright/test";

import { gotoHydrated, isMobile, scenario } from "./helpers";

const active = (page: Page) =>
  page.locator('[data-testid="marketing.carousel.slide"][data-active="true"]');

test.beforeEach(async ({ request }) => {
  await scenario(request, "launch_day");
});

test("opens on the page's city; arrows, dots and arrow keys change the slide", async ({
  page,
}) => {
  await page.goto("/cities/abuja");
  const region = page.getByTestId("marketing.carousel");
  await expect(region).toHaveAttribute("aria-roledescription", "carousel");
  await expect(active(page)).toHaveAttribute("data-city", "ABV");

  await region.getByRole("button", { name: "Next city" }).click();
  await expect(active(page)).toHaveAttribute("data-city", "LOS");
  await region.getByRole("button", { name: "Previous city" }).click();
  await expect(active(page)).toHaveAttribute("data-city", "ABV");

  await region.getByRole("tab", { name: "Lagos" }).click();
  await expect(active(page)).toHaveAttribute("data-city", "LOS");
  await expect(region.getByRole("tab", { name: "Lagos" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await region.focus();
  await page.keyboard.press("ArrowRight");
  await expect(active(page)).toHaveAttribute("data-city", "ABV");
  await page.keyboard.press("ArrowLeft");
  await expect(active(page)).toHaveAttribute("data-city", "LOS");
});

test("every slide has alt text, a caption naming place and city, and a licence credit linking to the source", async ({
  page,
}) => {
  await page.goto("/cities/lagos");
  const slides = page.getByTestId("marketing.carousel.slide");
  await expect(slides).toHaveCount(2);
  for (const slide of await slides.all()) {
    const alt = await slide.locator("img").getAttribute("alt");
    expect(alt).toBeTruthy();
    const city = await slide.getAttribute("data-city");
    const caption = await slide.locator("figcaption").innerText();
    expect(caption).toContain(city === "LOS" ? "Lagos" : "Abuja");
    expect(caption).toContain(
      city === "LOS" ? "Lekki-Ikoyi Link Bridge" : "Zuma Rock",
    );
    // Inactive slides are aria-hidden, so role queries skip them: use a CSS locator.
    const credit = slide.getByTestId("marketing.carousel.credit").locator("a");
    await expect(credit).toHaveAttribute(
      "href",
      /^https:\/\/commons\.wikimedia\.org\//,
    );
    await expect(credit).toHaveAttribute("rel", /license/);
    await expect(credit).toContainText(/CC BY/);
  }
  const src = await active(page).locator("img").getAttribute("src");
  expect(src).toBeTruthy();
  const image = await page.request.get(src as string);
  expect(image.status()).toBe(200);
});

test("swipe of at least 40 px changes the slide on touch", async ({ page }) => {
  test.skip(!isMobile(), "touch only");
  await gotoHydrated(page, "/cities/lagos");
  await expect(active(page)).toHaveAttribute("data-city", "LOS");
  const region = page.getByTestId("marketing.carousel");
  await region.evaluate((el) => {
    const touch = (x: number) =>
      new Touch({ identifier: 1, target: el, clientX: x, clientY: 100 });
    el.dispatchEvent(
      new TouchEvent("touchstart", { bubbles: true, touches: [touch(300)] }),
    );
    el.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        touches: [],
        changedTouches: [touch(200)],
      }),
    );
  });
  await expect(active(page)).toHaveAttribute("data-city", "ABV");
  await region.evaluate((el) => {
    const touch = (x: number) =>
      new Touch({ identifier: 2, target: el, clientX: x, clientY: 100 });
    el.dispatchEvent(
      new TouchEvent("touchstart", { bubbles: true, touches: [touch(200)] }),
    );
    el.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        touches: [],
        changedTouches: [touch(230)],
      }),
    );
  });
  // A 30 px move is below the threshold.
  await expect(active(page)).toHaveAttribute("data-city", "ABV");
});

test("auto-advances only on /cities, pauses on hover and focus, never under reduced motion", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/cities/lagos");
  await expect(page.getByTestId("marketing.carousel")).toHaveAttribute(
    "data-auto",
    "false",
  );
  await page.clock.runFor(7_000);
  await expect(active(page)).toHaveAttribute("data-city", "LOS");

  await page.goto("/cities");
  await expect(page.getByTestId("marketing.carousel")).toHaveAttribute(
    "data-auto",
    "true",
  );
  await expect(active(page)).toHaveAttribute("data-city", "LOS");
  await page.clock.runFor(6_500);
  await expect(active(page)).toHaveAttribute("data-city", "ABV");

  if (!isMobile()) {
    await page.getByTestId("marketing.carousel").hover();
    await page.clock.runFor(7_000);
    await expect(active(page)).toHaveAttribute("data-city", "ABV");
    await page.mouse.move(0, 0);
  }
  await page.getByTestId("marketing.carousel").focus();
  await page.clock.runFor(7_000);
  await expect(active(page)).toHaveAttribute("data-city", "ABV");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/cities");
  await expect(active(page)).toHaveAttribute("data-city", "LOS");
  await page.clock.runFor(13_000);
  await expect(active(page)).toHaveAttribute("data-city", "LOS");
});

test("captions on /cities link to the city page", async ({ page }) => {
  await page.goto("/cities");
  await expect(
    active(page).locator("figcaption").getByRole("link"),
  ).toHaveAttribute("href", "/cities/lagos");
});
