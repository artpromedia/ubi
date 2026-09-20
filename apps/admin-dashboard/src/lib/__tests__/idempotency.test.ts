/**
 * Regression tests for client-contract finding #7: config-service requires an
 * `idempotency-key` header (min 8 chars, url-safe) on PUT /v1/flags/{key} and
 * POST /v1/config/change-requests. Before the fix the admin client never sent
 * one, so the kill switch and policy publish always 422'd.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient, newIdempotencyKey } from "../api-client";
import { marketplaceApi } from "../marketplace-api";

// Matches @ubi/contracts IdempotencyKeySchema: 8–64 chars, url-safe alphabet.
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,64}$/;

const fetchMock = vi.fn();

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve(jsonResponse({ ok: true })),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentHeaders(callIndex = 0): Record<string, string> {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return (init?.headers ?? {}) as Record<string, string>;
}

describe("newIdempotencyKey", () => {
  it("generates a url-safe key of at least 8 characters", () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(IDEMPOTENCY_KEY_RE);
  });

  it("generates distinct keys per call", () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe("api client idempotency-key option", () => {
  it("sends the idempotency-key header on post when provided", async () => {
    await apiClient.post(
      "/v1/config/change-requests",
      { a: 1 },
      { idempotencyKey: "test-key-12345678" },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentHeaders()["idempotency-key"]).toBe("test-key-12345678");
  });

  it("sends the idempotency-key header on put when provided", async () => {
    await apiClient.put(
      "/v1/flags/marketplace_rides",
      { enabled: false },
      { idempotencyKey: "test-key-87654321" },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentHeaders()["idempotency-key"]).toBe("test-key-87654321");
  });

  it("omits the header when no key is given", async () => {
    await apiClient.post("/v1/other", { a: 1 });
    expect(sentHeaders()["idempotency-key"]).toBeUndefined();
  });
});

describe("marketplaceApi mutating calls", () => {
  it("stopAwards PUTs the flag with a valid generated idempotency-key header", async () => {
    await marketplaceApi.stopAwards("lagos", "runaway market");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/flags/marketplace_rides");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      cityId: "lagos",
      enabled: false,
      reason: "runaway market",
    });
    expect(sentHeaders()["idempotency-key"]).toMatch(IDEMPOTENCY_KEY_RE);
  });

  it("proposePolicyChange POSTs the change request with a valid generated idempotency-key header", async () => {
    await marketplaceApi.proposePolicyChange(
      "lagos",
      { bids: { bidExpirySec: 90 } },
      "tighten expiry",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/config/change-requests");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      cityId: "lagos",
      patch: { bids: { bidExpirySec: 90 } },
      reason: "tighten expiry",
    });
    expect(sentHeaders()["idempotency-key"]).toMatch(IDEMPOTENCY_KEY_RE);
  });

  it("uses a fresh key per invocation (no accidental replay collisions)", async () => {
    await marketplaceApi.stopAwards("lagos", "first");
    await marketplaceApi.stopAwards("lagos", "second");
    const first = sentHeaders(0)["idempotency-key"];
    const second = sentHeaders(1)["idempotency-key"];
    expect(first).toMatch(IDEMPOTENCY_KEY_RE);
    expect(second).toMatch(IDEMPOTENCY_KEY_RE);
    expect(first).not.toBe(second);
  });
});
