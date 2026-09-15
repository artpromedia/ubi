/**
 * The marketing consumer forwards only the events that change what the site
 * shows, retries transient failures, and never retries a refusal.
 */
import { describe, expect, it, vi } from "vitest";

import { createMarketingRevalidator } from "@/marketing-revalidate";

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function revalidator(fetchImpl: typeof fetch, attempts = 3) {
  return createMarketingRevalidator({
    url: "https://www.ubi.africa/api/revalidate",
    secret: "s3cret-s3cret-s3cret",
    fetch: fetchImpl,
    attempts,
    backoffMs: 1,
    log: silent,
    sleep: async () => undefined,
  });
}

describe("marketing revalidation", () => {
  it("posts the availability tag with the bearer secret for a config event", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const ok = await revalidator(fetchImpl as unknown as typeof fetch).handle({
      id: "evt_1",
      name: "config.version_activated",
      cityId: "LOS",
    });
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://www.ubi.africa/api/revalidate");
    expect((init.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer s3cret-s3cret-s3cret",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      tags: ["availability"],
      reason: "config.version_activated",
    });
  });

  it("forwards flag and city status changes and ignores everything else", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const r = revalidator(fetchImpl as unknown as typeof fetch);
    expect(
      await r.handle({ id: "e1", name: "flag.changed", cityId: "LOS" }),
    ).toBe(true);
    expect(
      await r.handle({ id: "e2", name: "city.status_changed", cityId: "ABV" }),
    ).toBe(true);
    expect(
      await r.handle({ id: "e3", name: "ride.completed", cityId: "LOS" }),
    ).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx and gives up after the configured attempts", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 }));
    const ok = await revalidator(
      fetchImpl as unknown as typeof fetch,
      3,
    ).handle({
      id: "e4",
      name: "flag.changed",
      cityId: "LOS",
    });
    expect(ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a refusal (wrong secret)", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));
    const ok = await revalidator(fetchImpl as unknown as typeof fetch).handle({
      id: "e5",
      name: "flag.changed",
      cityId: "LOS",
    });
    expect(ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
