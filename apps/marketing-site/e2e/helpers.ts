import AxeBuilder from "@axe-core/playwright";
import {
  type APIRequestContext,
  type Page,
  expect,
  test,
} from "@playwright/test";

import {
  BASE_URL,
  MOCK_CONFIG_URL,
  REVALIDATE_SECRET,
} from "../playwright.config";

export type Preset = "launch_day" | "today" | "pre_launch";

export interface ScenarioOverrides {
  cities?: unknown[];
  citiesMode?: "ok" | "error";
  configMode?: "ok" | "error";
  flags?: Record<string, Record<string, boolean>>;
  flagsMode?: "ok" | "error" | "unreachable";
  flagsDelayMs?: number;
  requirementsMode?: "ok" | "error";
}

/** Switch the mock's scenario and purge the site's cache the production way. */
export async function scenario(
  request: APIRequestContext,
  preset: Preset,
  overrides: ScenarioOverrides = {},
  { revalidate = true }: { revalidate?: boolean } = {},
): Promise<void> {
  const switched = await request.post(`${MOCK_CONFIG_URL}/__scenario`, {
    data: { preset, overrides },
  });
  expect(switched.ok()).toBe(true);
  if (revalidate) await revalidateSite(request);
}

export async function revalidateSite(
  request: APIRequestContext,
  tags?: string[],
): Promise<void> {
  const response = await request.post(`${BASE_URL}/api/revalidate`, {
    headers: { authorization: `Bearer ${REVALIDATE_SECRET}` },
    data: tags ? { tags } : {},
  });
  expect(response.status(), await response.text()).toBe(200);
}

export function isMobile(): boolean {
  return test.info().project.name.startsWith("mobile");
}

/** Full-page screenshot named after the state and the project (1440 / 390). */
export async function shot(page: Page, name: string): Promise<void> {
  const width = isMobile() ? "390" : "1440";
  await page.screenshot({
    path: `e2e/screenshots/${name}-${width}.png`,
    fullPage: true,
  });
}

/** Content rules (ACCEPTANCE.md): run on the rendered text of a page. */
export function assertContentRules(text: string, url: string): void {
  const rules: [RegExp, string][] = [
    [/—/, "em dash"],
    [/\d+\+/, "count with plus sign"],
    [
      /\d+\s?[MK]\+?\s+(users|drivers|cities|riders)/i,
      "M/K users, drivers or cities count",
    ],
    [/★|\brating\b/i, "star or rating"],
    [/₦/, "naira sign (a fare or fee)"],
    [/\bguarantee/i, "guarantee"],
  ];
  for (const [pattern, label] of rules) {
    const match = pattern.exec(text);
    expect(match, `${url} renders a ${label}: "${match?.[0]}"`).toBeNull();
  }
}

export async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

export async function axeCheck(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    // The hidden slides of the carousel are aria-hidden by design.
    .exclude('[data-testid="marketing.carousel.slide"][data-active="false"]')
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const summary = results.violations
    .map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help}`)
    .join("\n");
  expect(serious, `${label}: axe violations\n${summary}`).toEqual([]);
  if (results.violations.length > 0) {
    test.info().annotations.push({
      type: "axe-moderate",
      description: `${label}: ${summary}`,
    });
  }
}

/**
 * React attaches fiber keys to DOM nodes once hydration completes; keyboard
 * and click interactions on client components are only meaningful after that.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const node = document.querySelector(
      '[data-testid="marketing.menu.button"]',
    );
    return (
      node !== null &&
      Object.keys(node).some((key) => key.startsWith("__reactFiber"))
    );
  });
}

/** Navigate and wait for hydration. */
export async function gotoHydrated(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await waitForHydration(page);
}

/**
 * Next adds its own `noindex` robots meta to 404 pages alongside the page's,
 * so assert on every robots tag rather than exactly one.
 */
export async function expectNoindex(page: Page): Promise<void> {
  const tags = page.locator('meta[name="robots"]');
  expect(await tags.count()).toBeGreaterThan(0);
  for (const tag of await tags.all()) {
    expect(await tag.getAttribute("content")).toMatch(/noindex/);
  }
}
