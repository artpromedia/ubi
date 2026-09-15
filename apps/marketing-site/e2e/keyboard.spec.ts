/**
 * Keyboard and accessibility (board 24e): skip link, header order,
 * aria-current, dialog menu with focus trap and Esc, native disclosure FAQ,
 * CTAs as links, focus ring, landmarks, one h1, images, zoom and narrow widths,
 * plus axe on every route at both viewports.
 */
import { expect, test } from "@playwright/test";

import { axeCheck, gotoHydrated, isMobile, scenario } from "./helpers";

const ROUTES = [
  "/",
  "/cities",
  "/cities/lagos",
  "/cities/abuja",
  "/cities/port-harcourt",
  "/drive",
  "/help",
];

test.beforeEach(async ({ request }) => {
  await scenario(request, "today");
});

test("skip link is the first tab stop, visible on focus, and moves focus to #main", async ({
  page,
}) => {
  await gotoHydrated(page, "/cities/lagos");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("header tab order: logo, Ride, Drive, Cities, Help, Log in, Get the app; aria-current on the current page", async ({
  page,
}) => {
  test.skip(isMobile(), "desktop navigation only");
  await page.goto("/cities/lagos");
  const expected = [
    "UBI home",
    "Ride",
    "Drive",
    "Cities",
    "Help",
    "Log in",
    "Get the app",
  ];
  await page.keyboard.press("Tab"); // skip link
  for (const name of expected) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? "";
    });
    expect(active).toBe(name);
  }
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Cities" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator('a[aria-current="page"]')).toHaveCount(1);
});

test("mobile menu: opens on Enter, focuses the first link, traps Tab, Esc closes and returns focus, body scroll locked", async ({
  page,
}) => {
  test.skip(!isMobile(), "mobile menu only");
  await gotoHydrated(page, "/cities/lagos");
  const button = page.getByTestId("marketing.menu.button");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Menu" });
  await expect(dialog).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByRole("link", { name: "Ride" })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(
    "hidden",
  );

  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(
      () =>
        document.getElementById("mk-menu")?.contains(document.activeElement) ??
        false,
    );
    expect(inside, `tab ${i + 1} left the dialog`).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(() =>
      document.getElementById("mk-menu")?.contains(document.activeElement),
    ),
  ).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await expect(dialog).toHaveCount(0);
});

test("FAQ: buttons toggle with Enter and Space, aria-expanded and aria-controls, panels use the hidden attribute", async ({
  page,
}) => {
  await gotoHydrated(page, "/cities/lagos");
  const faq = page.getByTestId("marketing.faq");
  const buttons = faq.getByRole("button");
  const first = buttons.nth(0);
  const second = buttons.nth(1);
  await expect(first).toHaveAttribute("aria-expanded", "true");
  const firstPanelId = await first.getAttribute("aria-controls");
  expect(firstPanelId).toBeTruthy();
  const firstPanel = page.locator(`[id="${firstPanelId as string}"]`);
  await expect(firstPanel).toBeVisible();
  expect(await firstPanel.getAttribute("role")).toBe("region");

  await first.focus();
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-expanded", "false");
  expect(await firstPanel.evaluate((el) => el.hasAttribute("hidden"))).toBe(
    true,
  );

  await second.focus();
  await page.keyboard.press("Space");
  await expect(second).toHaveAttribute("aria-expanded", "true");
  const secondPanel = page.locator(
    `[id="${(await second.getAttribute("aria-controls")) as string}"]`,
  );
  await expect(secondPanel).toBeVisible();
  expect(await faq.locator("h3 > button").count()).toBeGreaterThan(0);
});

test("every CTA is an <a href>; focus ring is 3 px UBI green with 3 px offset", async ({
  page,
}) => {
  await page.goto("/cities/lagos");
  const ctas = page.locator("[data-analytics]");
  const count = await ctas.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const el = ctas.nth(i);
    expect(await el.evaluate((node) => node.tagName)).toBe("A");
    expect(await el.getAttribute("href")).toMatch(/^(https:|\/)/);
  }
  await page.getByTestId("marketing.city.riderCta").focus();
  const ring = await page
    .getByTestId("marketing.city.riderCta")
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        width: style.outlineWidth,
        color: style.outlineColor,
        offset: style.outlineOffset,
      };
    });
  expect(ring.width).toBe("3px");
  expect(ring.offset).toBe("3px");
  expect(ring.color).toBe("rgb(29, 185, 84)");
});

test("landmarks, one h1, images with alt, text sizes", async ({ page }) => {
  for (const route of ["/cities/lagos", "/drive", "/help", "/cities"]) {
    await page.goto(route);
    await expect(page.locator("h1"), route).toHaveCount(1);
    await expect(page.getByRole("banner"), route).toHaveCount(1);
    await expect(page.getByRole("main"), route).toHaveCount(1);
    await expect(page.getByRole("contentinfo"), route).toHaveCount(1);
    // Desktop shows the primary nav; mobile shows the menu button that opens it.
    if (isMobile()) {
      await expect(
        page.getByTestId("marketing.menu.button"),
        route,
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("navigation", { name: "Primary" }).first(),
        route,
      ).toBeVisible();
    }
    const missingAlt = await page.locator("img:not([alt])").count();
    expect(missingAlt, `${route} image without alt`).toBe(0);
    const small = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          "main p:not(.mk-small), main li, main dd, main h1, main h2, main h3",
        ),
      )
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => ({
          text: el.textContent?.slice(0, 30),
          size: parseFloat(getComputedStyle(el).fontSize),
        }))
        .filter((entry) => entry.size < 14),
    );
    expect(small, `${route} text under 14 px`).toEqual([]);
  }
});

test("no horizontal scroll at 320 px and at 200% zoom", async ({ page }) => {
  for (const route of ["/cities/lagos", "/drive", "/help", "/cities"]) {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(route);
    const overflow320 = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow320, `${route} overflows at 320 px`).toBeLessThanOrEqual(0);
    if (!isMobile()) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(route);
      await page.evaluate(() => {
        (document.body.style as unknown as { zoom: string }).zoom = "2";
      });
      const overflowZoom = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(
        overflowZoom,
        `${route} overflows at 200% zoom`,
      ).toBeLessThanOrEqual(0);
    }
  }
});

test("axe: no serious or critical violations on any route", async ({
  page,
}) => {
  for (const route of ROUTES) {
    await page.goto(route);
    await axeCheck(page, `${route} @ ${test.info().project.name}`);
  }
});
