/**
 * The passenger trip link's client logic (src/lib/trip-link.ts), with only `fetch` and the
 * browser's location/history/sessionStorage stubbed. Proves: the token is read from the URL
 * FRAGMENT only (never a query string) and then removed from the address bar; it travels only
 * in the X-Trip-Access-Token header (no URL, no body, no credentials, no referrer, never
 * cached); the decline carries a held Idempotency-Key that survives an offline retry; and each
 * refusal (expired / revoked / invalid / rate limited / past pickup / offline) is distinct.
 */
import { describe, expect, it, vi } from "vitest";

import { TEST_IDS } from "../../../../../packages/contracts/src/test-ids";
import { WEB_TEST_IDS } from "../../components/travel/types";
import {
  TRIP_ACCESS_HEADER,
  TRIP_TOKEN_SESSION_KEY,
  createDeclineCommand,
  createTripLinkClient,
  failureOf,
  forgetTripToken,
  readTripTokenFromFragment,
  resolveTripToken,
  takeTripTokenFromLocation,
} from "../trip-link";
import { TOKEN, tripPin, tripView } from "./trip-link.fixtures";

const BASE = "https://app.ubi.africa/api";

function memorySession() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

type Captured = { url: string; init: RequestInit };

function stubFetch(
  answers: (c: Captured) => { status: number; json?: unknown } | "offline",
) {
  const calls: Captured[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const c = { url, init };
    calls.push(c);
    const a = answers(c);
    if (a === "offline") throw new TypeError("Failed to fetch");
    const text = a.json === undefined ? "" : JSON.stringify(a.json);
    return new Response(text, { status: a.status });
  });
  return { calls, client: createTripLinkClient({ baseUrl: BASE, fetch }) };
}

describe("the token comes from the URL fragment only", () => {
  it("reads #t=… and nothing else", () => {
    expect(readTripTokenFromFragment("#t=" + TOKEN)).toBe(TOKEN);
    expect(readTripTokenFromFragment("#ref=sms&t=" + TOKEN)).toBe(TOKEN);
    expect(readTripTokenFromFragment("")).toBeNull();
    expect(readTripTokenFromFragment("#t=")).toBeNull();
    expect(readTripTokenFromFragment("#t=not a token!")).toBeNull();
    // A query string is never a fragment.
    expect(readTripTokenFromFragment("?t=" + TOKEN)).toBeNull();
  });

  it("ignores a token in the query string and removes the fragment from the address bar", () => {
    const session = memorySession();
    const replaceState = vi.fn();
    // A token only in ?t= is NOT honoured.
    expect(
      takeTripTokenFromLocation(
        { hash: "", pathname: "/trip-link", search: "?t=" + TOKEN },
        { replaceState },
        session,
      ),
    ).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();

    const token = takeTripTokenFromLocation(
      { hash: "#t=" + TOKEN, pathname: "/trip-link", search: "" },
      { replaceState },
      session,
    );
    expect(token).toBe(TOKEN);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/trip-link");
    expect(replaceState.mock.calls[0]![2]).not.toContain(TOKEN);
  });

  it("keeps it for this tab's session only, and forgets it on request", () => {
    const session = memorySession();
    expect(resolveTripToken("#t=" + TOKEN, session)).toBe(TOKEN);
    expect(session.store.get(TRIP_TOKEN_SESSION_KEY)).toBe(TOKEN);
    // A reload in the same tab (fragment already removed) still opens the trip.
    expect(resolveTripToken("", session)).toBe(TOKEN);
    forgetTripToken(session);
    expect(resolveTripToken("", session)).toBeNull();
  });

  it("still works when storage is blocked (private mode) — memory only", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(resolveTripToken("#t=" + TOKEN, blocked)).toBe(TOKEN);
    expect(resolveTripToken("", blocked)).toBeNull();
    expect(() => forgetTripToken(blocked)).not.toThrow();
  });
});

describe("the token travels only in the X-Trip-Access-Token header", () => {
  it("GET /v1/mp/trip-access: header only — no URL parameter, body, credentials, referrer or cache", async () => {
    const { calls, client } = stubFetch(() => ({
      status: 200,
      json: tripView(),
    }));
    const r = await client.view(TOKEN);
    expect(r.ok && r.data.statusLabel).toBe("Your driver is on the way");
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(BASE + "/v1/mp/trip-access");
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers[TRIP_ACCESS_HEADER]).toBe(TOKEN);
    expect(headers.Authorization).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
  });

  it("GET /v1/mp/trip-access/pin the same way", async () => {
    const { calls, client } = stubFetch(() => ({
      status: 200,
      json: tripPin(),
    }));
    const r = await client.pin(TOKEN);
    expect(r.ok && r.data.pin).toBe("4831");
    expect(calls[0]!.url).toBe(BASE + "/v1/mp/trip-access/pin");
    expect(
      (calls[0]!.init.headers as Record<string, string>)[TRIP_ACCESS_HEADER],
    ).toBe(TOKEN);
  });
});

describe("decline — free, idempotent, never twice", () => {
  it("POSTs /v1/mp/trip-access/decline with an Idempotency-Key and no body", async () => {
    const { calls, client } = stubFetch(() => ({
      status: 200,
      json: tripView({
        status: "declined",
        statusLabel: "You declined this ride",
      }),
    }));
    const run = createDeclineCommand(client, () => "tripdecl_key_1");
    const r = await run(TOKEN);
    expect(r.ok && r.data.status).toBe("declined");
    const { url, init } = calls[0]!;
    expect(url).toBe(BASE + "/v1/mp/trip-access/decline");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("tripdecl_key_1");
    expect(headers[TRIP_ACCESS_HEADER]).toBe(TOKEN);
  });

  it("an offline attempt keeps the key, so the retry replays instead of declining twice", async () => {
    let offline = true;
    const { calls, client } = stubFetch(() =>
      offline
        ? "offline"
        : {
            status: 200,
            json: tripView({
              status: "declined",
              statusLabel: "You declined this ride",
            }),
          },
    );
    let minted = 0;
    const run = createDeclineCommand(client, () => "tripdecl_key_" + ++minted);
    const first = await run(TOKEN);
    expect(!first.ok && first.failure).toBe("offline");
    offline = false;
    await run(TOKEN);
    const keys = calls.map(
      (c) => (c.init.headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(keys).toEqual(["tripdecl_key_1", "tripdecl_key_1"]);
    // After a definite answer a NEW decline would mint a new key.
    await run(TOKEN);
    expect(
      (calls[2]!.init.headers as Record<string, string>)["Idempotency-Key"],
    ).toBe("tripdecl_key_2");
  });

  it("past pickup is its own refusal", async () => {
    const { client } = stubFetch(() => ({
      status: 409,
      json: {
        code: "conflict",
        message: "the trip is past pickup",
        details: { reason: "past_pickup" },
      },
    }));
    const r = await createDeclineCommand(client)(TOKEN);
    expect(!r.ok && r.failure).toBe("past_pickup");
  });
});

describe("refusals are distinct and never name a trip", () => {
  it("maps 401 expired / revoked / invalid, 429 and offline", async () => {
    const body = (reason: string) => ({
      code: "unauthorized",
      message: "this trip link is not valid",
      details: { reason },
    });
    expect(failureOf(401, body("expired")).failure).toBe("expired");
    expect(failureOf(401, body("revoked")).failure).toBe("revoked");
    expect(failureOf(401, body("invalid")).failure).toBe("invalid");
    expect(failureOf(401, undefined).failure).toBe("invalid");
    expect(failureOf(429, { code: "rate_limited" }).failure).toBe(
      "rate_limited",
    );
    expect(failureOf(500, undefined).failure).toBe("error");

    const expired = stubFetch(() => ({ status: 401, json: body("expired") }));
    const r = await expired.client.view(TOKEN);
    expect(!r.ok && r.failure).toBe("expired");
    const offline = stubFetch(() => "offline");
    const o = await offline.client.view(TOKEN);
    expect(!o.ok && o.failure).toBe("offline");
  });
});

describe("web.tripLink testIDs", () => {
  it("mirror the canonical @ubi/contracts registry exactly", () => {
    expect(WEB_TEST_IDS.tripLink).toEqual(TEST_IDS.web.tripLink);
  });
});
