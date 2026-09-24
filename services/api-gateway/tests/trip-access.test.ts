import "./env";

/**
 * The passenger trip link through the real gateway (src/routes/trip-access.ts).
 *
 * A guest passenger (book for another adult, A06 part B) has no UBI account
 * and no bearer token: ride-service authenticates GET /v1/mp/trip-access,
 * GET /v1/mp/trip-access/pin and POST /v1/mp/trip-access/decline by the trip
 * access token alone. Before this round the gateway answered all three 401
 * (authorization required), so the link could not work through the edge.
 *
 * Pinned here, against a recording upstream standing in for ride-service:
 *   - exactly these three method + path pairs pass without a token;
 *   - ONLY the trip token (plus the decline's Idempotency-Key, a request id
 *     and the one client address) crosses — every client identity header,
 *     a bearer token and the body are left behind, and nothing is minted;
 *   - a missing or malformed token is refused at the edge without a hop;
 *   - the gateway's own per-client rate limit refuses before forwarding;
 *   - answers are never cacheable.
 * The route-contract test pins the same three paths against ride-service's
 * route manifest.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { setIdentityStateStore } from "../src/lib/redis";
import {
  TRIP_ACCESS_RATE_LIMIT,
  resetTripAccessLimiter,
} from "../src/routes/trip-access";
import {
  clientToken,
  openRiskStore,
  startUpstream,
  type Upstream,
} from "./helpers";

let ride: Upstream;
let others: Upstream;
const app = createApp("test");

const TOKEN = "uta_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-";
let ipCounter = 0;

function nextClient(): string {
  ipCounter += 1;
  return `10.91.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

beforeAll(async () => {
  ride = await startUpstream();
  others = await startUpstream();
  process.env.RIDE_SERVICE_URL = ride.url;
  for (const name of [
    "USER_SERVICE_URL",
    "PAYMENT_SERVICE_URL",
    "ASK_SERVICE_URL",
    "TRAVEL_SERVICE_URL",
    "DELIVERY_SERVICE_URL",
  ]) {
    process.env[name] = others.url;
  }
});

afterAll(async () => {
  await ride.close();
  await others.close();
});

beforeEach(() => {
  ride.received.length = 0;
  others.received.length = 0;
  setIdentityStateStore(openRiskStore);
  resetTripAccessLimiter();
});

/**
 * One call arriving from `peer` — the socket address the gateway limits and
 * forwards (middleware/client-address.ts). Headers can no longer name the
 * client: no proxy is trusted here.
 */
async function send(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
  peer: string = nextClient(),
): Promise<Response> {
  const response = await app.fetch(
    new Request(`http://gateway.test${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    }),
    { incoming: { socket: { remoteAddress: peer } }, outgoing: {} },
  );
  return response;
}

/** Everything a hostile client could try to smuggle onto a trip-link call. */
async function forgedHeaders(): Promise<Record<string, string>> {
  const bearer = await clientToken({ sub: "usr_requester", role: "rider" });
  return {
    authorization: `Bearer ${bearer}`,
    cookie: "session=stolen",
    "content-type": "application/json",
    "x-ubi-identity": "forged.context.token",
    "x-auth-user-id": "usr_victim",
    "x-auth-user-role": "admin",
    "x-auth-city-id": "LOS",
    "x-auth-issued-at": "1700000000",
    "x-auth-signature": "forged",
    "x-user-id": "usr_victim",
    "x-user-role": "admin",
    "x-ubi-city-id": "LOS",
    "x-ubi-scopes": "admin:all",
    "x-ubi-modes": "",
    "x-internal-service": "ride-service",
    "x-service-key": "ubi_sk_ride_forged",
    "x-session-id": "ses_forged",
    "x-city-id": "ABV",
    "x-idempotency-key": "idem-legacy-header",
  };
}

const ALLOWED_FORWARDED = new Set([
  "x-trip-access-token",
  "x-request-id",
  "x-forwarded-for",
  "idempotency-key",
]);

describe("the passenger trip link", () => {
  it.each([
    ["GET", "/v1/mp/trip-access"],
    ["GET", "/v1/mp/trip-access/pin"],
    ["POST", "/v1/mp/trip-access/decline"],
  ] as const)(
    "%s %s forwards only the trip token, never an identity",
    async (method, path) => {
      const client = nextClient();
      const response = await send(
        method,
        path,
        {
          ...(await forgedHeaders()),
          "x-trip-access-token": TOKEN,
          "idempotency-key": "idem-trip-decline-01",
          // A chain the client wrote: ignored, it names nobody.
          "x-forwarded-for": "198.51.100.9, 172.16.0.9",
          "x-request-id": "req-trip-link-0001",
        },
        method === "POST" ? JSON.stringify({ reason: "not me" }) : undefined,
        client,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(others.received).toHaveLength(0);
      expect(ride.received).toHaveLength(1);
      const arrived = ride.received[0];
      expect(arrived?.method).toBe(method);
      expect(arrived?.url).toBe(path);

      const headers = arrived?.headers ?? {};
      expect(headers["x-trip-access-token"]).toBe(TOKEN);
      expect(headers["x-request-id"]).toBe("req-trip-link-0001");
      // The one address the gateway limited on (the peer) — never the chain.
      expect(headers["x-forwarded-for"]).toBe(client);
      if (method === "POST") {
        expect(headers["idempotency-key"]).toBe("idem-trip-decline-01");
      } else {
        expect(headers["idempotency-key"]).toBeUndefined();
      }
      // Nothing identity-shaped crosses, and nothing is minted either.
      const custom = Object.keys(headers).filter(
        (name) => name.startsWith("x-") || name.endsWith("-key"),
      );
      expect(custom.filter((name) => !ALLOWED_FORWARDED.has(name))).toEqual([]);
      for (const name of ["authorization", "cookie", "content-type"]) {
        expect(headers[name], name).toBeUndefined();
      }
      // No body crosses: ride-service reads none on these routes.
      expect(headers["content-length"] ?? "0").toBe("0");
    },
  );

  it("refuses a missing or malformed token at the edge, without a hop", async () => {
    for (const token of [
      undefined,
      "",
      "uta with spaces",
      "uta_<script>",
      `uta_${"x".repeat(200)}`,
    ]) {
      const headers: Record<string, string> = {
        "x-forwarded-for": nextClient(),
      };
      if (token !== undefined) headers["x-trip-access-token"] = token;
      const response = await send("GET", "/v1/mp/trip-access", headers);
      expect(response.status, String(token)).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(ride.received).toHaveLength(0);
  });

  it("rate limits each client before forwarding, and leaves other clients alone", async () => {
    const client = nextClient();
    for (let i = 0; i < TRIP_ACCESS_RATE_LIMIT.points; i += 1) {
      const allowed = await send(
        "GET",
        "/v1/mp/trip-access",
        {
          "x-trip-access-token": TOKEN,
          // Rotating the header buys nothing: the peer is the client.
          "x-forwarded-for": nextClient(),
        },
        undefined,
        client,
      );
      expect(allowed.status, `call ${i + 1}`).toBe(200);
    }
    expect(ride.received).toHaveLength(TRIP_ACCESS_RATE_LIMIT.points);

    // Guessing tokens does not reset the budget: the limit is per client.
    const limited = await send(
      "GET",
      "/v1/mp/trip-access/pin",
      { "x-trip-access-token": "uta_a_different_guess" },
      undefined,
      client,
    );
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await limited.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(ride.received).toHaveLength(TRIP_ACCESS_RATE_LIMIT.points);

    const otherClient = await send("GET", "/v1/mp/trip-access", {
      "x-trip-access-token": TOKEN,
    });
    expect(otherClient.status).toBe(200);
  });

  it("is exact: every other trip-access shape still needs a bearer token", async () => {
    for (const [method, path] of [
      ["GET", "/v1/mp/trip-access/"],
      ["POST", "/v1/mp/trip-access"],
      ["DELETE", "/v1/mp/trip-access"],
      ["POST", "/v1/mp/trip-access/pin"],
      ["GET", "/v1/mp/trip-access/decline"],
      ["GET", "/v1/mp/trip-access/../requests/mpr_1"],
      ["GET", "/v1/mp/trip-access-admin"],
    ] as const) {
      const response = await send(method, path, {
        "x-trip-access-token": TOKEN,
        "x-forwarded-for": nextClient(),
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect(ride.received).toHaveLength(0);
  });

  it("does not carry a signed-in requester's identity either", async () => {
    // A requester opening the passenger's link on their own phone: the bearer
    // token is ignored, no context is minted, and the link is still the only
    // credential ride-service sees.
    const bearer = await clientToken({
      sub: "usr_requester",
      role: "rider",
      cityId: "LOS",
    });
    const response = await send("GET", "/v1/mp/trip-access", {
      authorization: `Bearer ${bearer}`,
      "x-trip-access-token": TOKEN,
      "x-forwarded-for": nextClient(),
    });
    expect(response.status).toBe(200);
    const headers = ride.received[0]?.headers ?? {};
    expect(headers["x-ubi-identity"]).toBeUndefined();
    expect(headers["x-auth-user-id"]).toBeUndefined();
    expect(headers["x-auth-signature"]).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
  });
});
