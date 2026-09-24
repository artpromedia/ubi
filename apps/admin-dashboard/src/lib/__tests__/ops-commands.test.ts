/**
 * Ops command wiring at the network boundary (fetch stubbed; the thing under
 * test is what the admin client SENDS and how it reads a refusal):
 *   - a reconcile/retry apply sends the idempotency key minted at preview,
 *     so a double-click or a re-send after an ambiguous failure replays ONE
 *     server outcome; a dry run sends none;
 *   - a travel-ops action posts the closed action enum with its key;
 *   - both error envelopes (service {code,message} and gateway
 *     {success:false,error:{…}}) surface the canonical code the role /
 *     device guards classify.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyError } from "../access";
import { ApiError } from "../api-client";
import { marketplaceApi } from "../marketplace-api";
import { travelOpsApi } from "../travel-ops";

const fetchMock = vi.fn();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const sent = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return {
    url,
    headers: (init.headers ?? {}) as Record<string, string>,
    body: init.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
  };
};

describe("reconcile / retry idempotency", () => {
  it("an apply sends exactly the key minted at preview, twice if re-sent", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ awardId: "a1", outcome: "resolved" })),
    );
    const body = { dryRun: false, expectedUpdatedAt: "2026-09-23T09:00:00Z" };
    await marketplaceApi.reconcileAward("a1", body, "preview-key-0001");
    await marketplaceApi.reconcileAward("a1", body, "preview-key-0001");
    expect(sent(0).headers["idempotency-key"]).toBe("preview-key-0001");
    expect(sent(1).headers["idempotency-key"]).toBe("preview-key-0001");
    expect(sent(0).url).toMatch(/\/v1\/admin\/mp\/awards\/a1\/reconcile$/);
    expect(sent(0).body).toEqual(body);
  });

  it("a dry-run preview sends no idempotency key", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ row: {} })));
    await marketplaceApi.retryRecovery(
      "r1",
      { dryRun: true },
      "ignored-key-01",
    );
    expect(sent().headers["idempotency-key"]).toBeUndefined();
  });

  it("a retry apply carries the previewed attempts and key", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ row: {} })));
    await marketplaceApi.retryRecovery(
      "r1",
      { dryRun: false, expectedAttempts: 3 },
      "preview-key-0002",
    );
    expect(sent().headers["idempotency-key"]).toBe("preview-key-0002");
    expect(sent().body).toEqual({ dryRun: false, expectedAttempts: 3 });
  });
});

describe("travel ops action", () => {
  it("posts the closed action enum with the confirmation's key", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ action: "chase_refund" })),
    );
    await travelOpsApi.act("ord/1", "chase_refund", "confirm-key-0003");
    expect(sent().url).toMatch(
      /\/v1\/ops\/travel\/exceptions\/ord%2F1\/actions$/,
    );
    expect(sent().body).toEqual({ action: "chase_refund" });
    expect(sent().headers["idempotency-key"]).toBe("confirm-key-0003");
  });

  it("reads the itinerary from the ops-readable trip route", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ id: "t1", items: [] })),
    );
    await travelOpsApi.trip("t1");
    expect(sent().url).toMatch(/\/v1\/travel\/trips\/t1$/);
  });
});

describe("error envelopes feed the guards", () => {
  it("reads a service {code, message} refusal", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        json(
          {
            code: "forbidden",
            message: "only an operator can read the marketplace monitor",
          },
          403,
        ),
      ),
    );
    const err = await marketplaceApi.requests().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("forbidden");
    expect((err as ApiError).message).toBe(
      "403 only an operator can read the marketplace monitor",
    );
    expect(classifyError(err, true).kind).toBe("forbidden");
  });

  it("reads the gateway's wrapped refusal for an unverified device", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        json(
          {
            success: false,
            error: {
              code: "limited_mode",
              message: "This device is not verified yet.",
            },
          },
          403,
        ),
      ),
    );
    const err = await travelOpsApi.exceptions().catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("limited_mode");
    expect(classifyError(err, true).kind).toBe("device_unverified");
  });

  it("a non-JSON failure keeps the status text", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response("oops", { status: 502, statusText: "Bad Gateway" }),
      ),
    );
    const err = await travelOpsApi.providersHealth().catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).code).toBeNull();
    expect((err as ApiError).message).toBe("502 Bad Gateway");
  });
});
