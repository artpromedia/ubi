/**
 * Route coverage: every internal href resolves (200, or the intended 404 for
 * an unknown city); every external anchor is https; no anchor has href="#" or
 * an empty href; DestinationLinks without env render the pending span.
 */
import { expect, test } from "@playwright/test";

import { scenario } from "./helpers";

const ROUTES = [
  "/",
  "/cities",
  "/cities/lagos",
  "/cities/abuja",
  "/cities/port-harcourt",
  "/drive",
  "/help",
  "/cities/xyz",
];

test("crawl: internal hrefs resolve, external anchors are https, no empty hrefs", async ({
  page,
  request,
}) => {
  await scenario(request, "today");
  const seen = new Map<string, number>();
  for (const route of ROUTES) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(route === "/cities/xyz" ? 404 : 200);
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a")).map((a) => ({
        href: a.getAttribute("href") ?? "",
        text: a.textContent?.trim().slice(0, 40) ?? "",
      })),
    );
    for (const { href, text } of hrefs) {
      expect(href, `${route}: "${text}" has an empty href`).not.toBe("");
      expect(href, `${route}: "${text}" has href="#"`).not.toBe("#");
      if (href.startsWith("#") || href.startsWith("tel:")) continue;
      if (href.startsWith("/")) {
        const path = href.split("#")[0] as string;
        if (!seen.has(path)) {
          const res = await request.get(path);
          seen.set(path, res.status());
        }
        const status = seen.get(path);
        const expected = /^\/cities\/xyz/.test(path) ? 404 : 200;
        expect(status, `${route}: ${href} answered ${status}`).toBe(expected);
        continue;
      }
      expect(href, `${route}: external "${text}" is not https`).toMatch(
        /^https:\/\//,
      );
    }
  }
});

test("pending destinations render as spans wherever the env is unset", async ({
  page,
  request,
}) => {
  await scenario(request, "today");
  await page.goto("/cities/lagos");
  const pending = page.getByTestId("marketing.destination.pending");
  const keys = await pending.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-destination")),
  );
  expect(new Set(keys)).toEqual(new Set(["iosStore", "androidStore", "terms"]));
});
