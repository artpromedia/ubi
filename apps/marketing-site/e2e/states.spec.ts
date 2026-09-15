/**
 * Every state in ACCEPTANCE.md, driven by the mocked config-service and
 * user-service. Each state also takes a full-page screenshot at 1440 and 390.
 */
import { expect, test } from "@playwright/test";

import {
  assertContentRules,
  expectNoindex,
  pageText,
  scenario,
  shot,
} from "./helpers";

test.describe("city page states", () => {
  test("launch day: Move, Bites, Send and Flights & stays live; Ask UBI not yet; never a fare", async ({
    page,
    request,
  }) => {
    await scenario(request, "launch_day");
    await page.goto("/cities/lagos");

    await expect(page.getByTestId("marketing.city.checked")).toContainText(
      "Africa/Lagos",
    );
    await expect(page.locator('[data-status="live"]').first()).toContainText(
      /Live in Lagos/,
    );
    await expect(page.getByTestId("marketing.city.lead")).toContainText(
      "Rides, food delivery, package delivery and flights and stays in Lagos",
    );

    const grid = page.getByTestId("marketing.city.services");
    await expect(grid).toBeVisible();
    const move = page.getByTestId("marketing.service.move");
    await expect(move).toHaveAttribute("data-status", "live");
    const facts = move.locator("dl");
    await expect(facts).toContainText("Go · Comfort · XL");
    await expect(facts).toContainText(
      "Cash · Card · Bank transfer · UBI Wallet",
    );
    await expect(facts).toContainText("PIN-verified · 5 min free waiting");
    await expect(facts).toContainText(
      "LOS · Arrivals Door C · Domestic Arrivals Door 2",
    );
    await expect(facts).toContainText("112 from inside the trip screen");
    await expect(
      move.getByRole("link", { name: /Ride in Lagos/ }),
    ).toHaveAttribute("href", /^https:\/\/app\.ubi\.africa/);

    for (const key of ["bites", "send", "travel"]) {
      const card = page.getByTestId(`marketing.service.${key}`);
      await expect(card).toHaveAttribute("data-status", "live");
      await expect(card.getByRole("link")).toHaveAttribute("href", /^https:/);
    }
    const ask = page.getByTestId("marketing.service.ask");
    await expect(ask).toHaveAttribute("data-status", "not_yet");
    await expect(ask).toContainText("Not yet available");

    await expect(page.getByTestId("marketing.city.rideSections")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Can I book a flight or hotel/ }),
    ).toBeVisible();

    const text = await pageText(page);
    assertContentRules(text, "/cities/lagos launch day");
    expect(text).not.toMatch(/\b1,?200\b|\b2,?600\b/);
    await shot(page, "city-launch-day");
  });

  test("today (Lagos seed flags): Move live; Bites and Send not yet in Lagos; Travel and Ask not yet available", async ({
    page,
    request,
  }) => {
    await scenario(request, "today");
    await page.goto("/cities/lagos");

    await expect(page.getByTestId("marketing.service.move")).toHaveAttribute(
      "data-status",
      "live",
    );
    await expect(page.getByTestId("marketing.service.bites")).toContainText(
      "Not yet in Lagos",
    );
    await expect(page.getByTestId("marketing.service.send")).toContainText(
      "Not yet in Lagos",
    );
    await expect(page.getByTestId("marketing.service.travel")).toContainText(
      "Not yet available",
    );
    await expect(page.getByTestId("marketing.service.ask")).toContainText(
      "Not yet available",
    );
    await expect(page.getByTestId("marketing.city.lead")).toContainText(
      "Rides in Lagos.",
    );
    await expect(
      page.getByRole("button", { name: /When do the other services start/ }),
    ).toBeVisible();
    assertContentRules(await pageText(page), "/cities/lagos today");
    await shot(page, "city-today");
  });

  test("service flips on: Bites becomes Live after on-demand revalidation; nothing else changes", async ({
    page,
    request,
  }) => {
    await scenario(request, "today");
    await page.goto("/cities/lagos");
    await expect(page.getByTestId("marketing.service.bites")).toHaveAttribute(
      "data-status",
      "not_yet",
    );

    // Flip the flag without purging: the cached answer still says not yet.
    const flags = {
      move: true,
      ride_request: true,
      driver_online: true,
      bites: true,
    };
    await scenario(
      request,
      "today",
      { flags: { LOS: flags, ABV: {} } },
      { revalidate: false },
    );
    await page.reload();
    await expect(page.getByTestId("marketing.service.bites")).toHaveAttribute(
      "data-status",
      "not_yet",
    );

    // The flag.changed consumer calls /api/revalidate: the next request is fresh.
    await scenario(request, "today", { flags: { LOS: flags, ABV: {} } });
    await page.reload();
    const bites = page.getByTestId("marketing.service.bites");
    await expect(bites).toHaveAttribute("data-status", "live");
    await expect(bites).toContainText("Order from restaurants near you");
    await expect(page.getByTestId("marketing.service.send")).toHaveAttribute(
      "data-status",
      "not_yet",
    );
    await expect(page.getByTestId("marketing.service.travel")).toHaveAttribute(
      "data-status",
      "not_yet",
    );
    await shot(page, "city-bites-flipped-on");
  });

  test("availability unknown: notice, zero service cards, CTAs stay, and the outage is never cached", async ({
    page,
    request,
  }) => {
    await scenario(request, "launch_day", { flagsMode: "error" });
    await page.goto("/cities/lagos");

    const notice = page.getByTestId("marketing.city.availabilityUnknown");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute("role", "status");
    await expect(notice).toContainText(
      "We can't confirm what's available in Lagos right now.",
    );
    await expect(
      page.locator('[data-testid^="marketing.service."]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-status="live"]')).toHaveCount(0);
    await expect(page.getByTestId("marketing.city.riderCta")).toHaveAttribute(
      "href",
      /^https:/,
    );
    await expect(page.getByTestId("marketing.city.driverCta")).toBeVisible();
    assertContentRules(await pageText(page), "/cities/lagos unknown");
    await shot(page, "city-availability-unknown");

    // Recovery WITHOUT revalidation: the error was not stored as an answer.
    await scenario(request, "launch_day", {}, { revalidate: false });
    await page.reload();
    await expect(page.getByTestId("marketing.city.services")).toBeVisible();
    await expect(page.getByTestId("marketing.service.move")).toHaveAttribute(
      "data-status",
      "live",
    );
  });

  test("unreachable flags (socket dropped) read as availability unknown, not as live", async ({
    page,
    request,
  }) => {
    await scenario(request, "launch_day", { flagsMode: "unreachable" });
    await page.goto("/cities/lagos");
    await expect(
      page.getByTestId("marketing.city.availabilityUnknown"),
    ).toBeVisible();
    await expect(page.locator('[data-status="live"]')).toHaveCount(0);
  });

  test("loading: hero and CTAs paint first, the grid shows a skeleton, no Live pill before flags resolve", async ({
    page,
    request,
  }) => {
    await scenario(request, "launch_day", { flagsDelayMs: 2500 });
    await page.goto("/cities/lagos", { waitUntil: "commit" });

    await expect(
      page.getByRole("heading", { level: 1, name: "UBI in Lagos" }),
    ).toBeVisible();
    await expect(page.getByTestId("marketing.city.riderCta")).toBeVisible();
    const skeleton = page.getByTestId("marketing.city.servicesLoading");
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toHaveAttribute("aria-busy", "true");
    await expect(page.locator('[data-status="live"]')).toHaveCount(0);
    await shot(page, "city-loading");

    await expect(page.getByTestId("marketing.city.services")).toBeVisible({
      timeout: 15_000,
    });
    await expect(skeleton).toHaveCount(0);
    await expect(page.locator('[data-status="live"]').first()).toBeVisible();
  });

  test("launching city: coming with no date, driver CTA, links to live cities, indexable, no grid", async ({
    page,
    request,
  }) => {
    await scenario(request, "today");
    await page.goto("/cities/abuja");

    const main = page.getByTestId("marketing.city.launching");
    await expect(main).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "UBI is coming to Abuja",
    );
    await expect(main).toContainText(
      /(Abuja and Lagos|Lagos and Abuja) open together/,
    );
    const text = await pageText(page);
    expect(text).not.toMatch(
      /\b20\d\d\b|\bQ[1-4]\b|January|February|March|April|May|June|July|August|September|October|November|December/,
    );
    await expect(
      main.getByRole("link", { name: /Drive with UBI in Abuja/ }),
    ).toHaveAttribute("href", /^https:/);
    await expect(
      main.getByRole("link", { name: /See UBI in Lagos/ }),
    ).toHaveAttribute("href", "/cities/lagos");
    await expect(
      page.locator('[data-testid^="marketing.service."]'),
    ).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    assertContentRules(text, "/cities/abuja launching");
    await shot(page, "city-launching");
  });

  test("planned city: intent only, noindex, no CTAs", async ({
    page,
    request,
  }) => {
    await scenario(request, "today");
    await page.goto("/cities/port-harcourt");

    const main = page.getByTestId("marketing.city.planned");
    await expect(main).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Port Harcourt is on our list",
    );
    await expect(main).toContainText("we don't take sign-ups");
    await expectNoindex(page);
    await expect(main.locator("a[data-analytics]")).toHaveCount(0);
    await expect(
      main.getByRole("link", { name: /See all cities/ }),
    ).toHaveAttribute("href", "/cities");
    await expect(page.locator("form")).toHaveCount(0);
    await shot(page, "city-planned");
  });

  test("unknown city: HTTP 404, not-found body, noindex, links to live cities, no form", async ({
    page,
    request,
  }) => {
    await scenario(request, "today");
    const response = await page.goto("/cities/xyz");
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("marketing.city.notFound")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "UBI isn't here yet",
    );
    await expectNoindex(page);
    await expect(
      page.getByRole("link", { name: /See UBI in Lagos/ }),
    ).toHaveAttribute("href", "/cities/lagos");
    await expect(page.locator("form")).toHaveCount(0);
    await shot(page, "city-unknown");
  });

  test("paused city: nothing live, no date, listed as paused on the index", async ({
    page,
    request,
  }) => {
    const paused = [
      {
        id: "LOS",
        name: "Lagos",
        country: "NG",
        region: "Lagos State",
        timezone: "Africa/Lagos",
        status: "paused",
        active: false,
        launchGroup: "ng-launch-2026",
      },
      {
        id: "ABV",
        name: "Abuja",
        country: "NG",
        region: "FCT",
        timezone: "Africa/Lagos",
        status: "active",
        active: true,
        launchGroup: "ng-launch-2026",
      },
    ];
    await scenario(request, "launch_day", { cities: paused });
    await page.goto("/cities/lagos");
    await expect(page.getByTestId("marketing.city.paused")).toBeVisible();
    await expect(page.locator('[data-status="live"]')).toHaveCount(0);
    await page.goto("/cities");
    await expect(page.getByTestId("marketing.cities.card.LOS")).toContainText(
      "Paused",
    );
    await expect(page.getByTestId("marketing.cities.card.ABV")).toContainText(
      "Live",
    );
  });
});

test.describe("cities index", () => {
  test("launch day: Lagos and Abuja live side by side, planned chips from rows", async ({
    page,
    request,
  }) => {
    await scenario(request, "launch_day");
    await page.goto("/cities");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Where UBI is",
    );
    await expect(
      page.getByText("UBI launched in Lagos and Abuja together."),
    ).toBeVisible();
    const lagos = page.getByTestId("marketing.cities.card.LOS");
    await expect(lagos).toContainText("Live · 4 services");
    await expect(lagos).toContainText(
      "Rides, food delivery, package delivery and flights and stays.",
    );
    await expect(lagos).toContainText(
      "Cash, Card, Bank transfer and UBI Wallet.",
    );
    await expect(lagos).toContainText("Airport pickups at LOS.");
    await expect(page.getByTestId("marketing.cities.card.ABV")).toContainText(
      "Airport pickups at ABV.",
    );
    const planned = page.getByTestId("marketing.cities.planned");
    await expect(planned.getByRole("link")).toHaveCount(8);
    await expect(planned).toContainText(
      "After Lagos and Abuja, UBI plans to expand to these cities.",
    );
    await expect(
      planned.getByRole("link", { name: "Onitsha" }),
    ).toHaveAttribute("href", "/cities/onitsha");
    assertContentRules(await pageText(page), "/cities launch day");
    await shot(page, "cities-launch-day");
  });

  test("today: Lagos live, Abuja launching, intro derived from rows", async ({
    page,
    request,
  }) => {
    await scenario(request, "today");
    await page.goto("/cities");
    await expect(page.getByTestId("marketing.cities.card.LOS")).toContainText(
      "Live · 1 service",
    );
    await expect(page.getByTestId("marketing.cities.card.LOS")).toContainText(
      "Rides.",
    );
    await expect(page.getByTestId("marketing.cities.card.ABV")).toContainText(
      "Launching · no date yet",
    );
    await expect(page.getByText("UBI launches in Abuja first.")).toBeVisible();
    await shot(page, "cities-today");
  });

  test("zero rows: a status notice instead of an empty page", async ({
    page,
    request,
  }) => {
    await scenario(request, "today", { citiesMode: "error" });
    await page.goto("/cities");
    const notice = page.getByTestId("marketing.cities.unavailable");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute("role", "status");
    await expect(
      page.locator('[data-testid^="marketing.cities.card."]'),
    ).toHaveCount(0);
    await shot(page, "cities-unavailable");
  });
});

test.describe("drive and help", () => {
  test("drive: requirements from user-service, service fee from config, no earnings", async ({
    page,
    request,
  }) => {
    await scenario(request, "launch_day");
    await page.goto("/drive?city=los");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Drive with UBI in Lagos",
    );
    const requirements = page.getByTestId("marketing.drive.requirements");
    await expect(requirements).toHaveAttribute("data-status", "ok");
    const items = requirements.locator("li");
    await expect(items).toHaveCount(6);
    await expect(items.nth(0)).toContainText(
      "Driver's licence. Valid, in your name",
    );
    await expect(items.nth(1)).toContainText(
      "LASDRI card. Lagos State Drivers' Institute",
    );
    await expect(items.nth(2)).toContainText(
      "Identity. NIN, plus a selfie check in the app",
    );
    await expect(items.nth(3)).toContainText(
      "Vehicle papers. Third-party insurance, Roadworthiness, Registration",
    );
    await expect(items.nth(4)).toContainText(
      "Background check. You consent in the app; UBI runs it",
    );
    await expect(items.nth(5)).toContainText("A car for Go, Comfort or XL");
    await expect(page.getByTestId("marketing.drive.serviceFee")).toHaveText(
      "20% of the fare in Lagos",
    );
    await expect(page.getByTestId("marketing.drive.applyCta")).toHaveAttribute(
      "href",
      /^https:/,
    );
    await expect(
      page.getByTestId("marketing.drive.steps").locator("li"),
    ).toHaveCount(5);
    const text = await pageText(page);
    assertContentRules(text, "/drive");
    expect(text).not.toMatch(
      /earn(ings)? (up to|of)|per week|per month|within \d+ (days|hours)/i,
    );
    await shot(page, "drive");
  });

  test("drive: Abuja has no LASDRI card; unknown ?city falls back to the first live city", async ({
    page,
    request,
  }) => {
    await scenario(request, "launch_day");
    await page.goto("/drive?city=abuja");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Drive with UBI in Abuja",
    );
    // The mock publishes no Abuja set, which the site treats as "list hidden".
    await expect(
      page.getByTestId("marketing.drive.requirements"),
    ).toHaveAttribute("data-status", "error");
    await page.goto("/drive?city=nope");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Drive with UBI in Lagos",
    );
  });

  test("drive: requirements unavailable hides the list, keeps the CTA, shows nothing hard-coded", async ({
    page,
    request,
  }) => {
    await scenario(request, "launch_day", { requirementsMode: "error" });
    await page.goto("/drive?city=los");
    const requirements = page.getByTestId("marketing.drive.requirements");
    await expect(requirements).toHaveAttribute("data-status", "error");
    await expect(requirements.locator("li")).toHaveCount(0);
    await expect(requirements.getByRole("status")).toContainText(
      "The document list is shown inside the UBI Driver app when you apply.",
    );
    await expect(page.getByTestId("marketing.drive.applyCta")).toBeVisible();
    await expect(page.getByText("LASDRI")).toHaveCount(0);
    await shot(page, "drive-requirements-unavailable");
  });

  test("help: emergency number from config, safety line pending, three entries, three FAQ columns", async ({
    page,
    request,
  }) => {
    await scenario(request, "launch_day");
    await page.goto("/help");
    await expect(page.getByTestId("marketing.help.emergency")).toHaveText(
      "Call 112",
    );
    await expect(page.getByTestId("marketing.help.emergency")).toHaveAttribute(
      "href",
      "tel:112",
    );
    await expect(
      page.getByTestId("marketing.help.safetyLinePending"),
    ).toHaveText("Published at launch");
    await expect(
      page.getByTestId("marketing.help.entries").locator("article"),
    ).toHaveCount(3);
    await expect(page.locator('[data-testid="marketing.faq"]')).toHaveCount(3);
    await expect(page.locator("#riders, #drivers, #travel")).toHaveCount(3);
    assertContentRules(await pageText(page), "/help");
    await shot(page, "help");
  });

  test("homepage carries the shared header and footer", async ({
    page,
    request,
  }) => {
    await scenario(request, "launch_day");
    await page.goto("/");
    await expect(
      page.getByRole("banner").getByRole("link", { name: "UBI home" }),
    ).toBeVisible();
    await expect(
      page.locator('nav[aria-label="Primary"]').first(),
    ).toBeAttached();
    await expect(page.getByRole("contentinfo")).toContainText("Lagos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await shot(page, "home");
  });
});
