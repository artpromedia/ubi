/**
 * The travel port relays the caller's gateway-signed identity — and only from
 * ask-service's verified request context (round 7, X-SEC item 1).
 *
 * travel-service believes one caller identity in production: the gateway's
 * signed `x-ubi-identity` context. The assistant's travel port used to send
 * plain `X-User-ID` / `X-User-Role` plus `X-Service-Key`, which production
 * travel-service refuses. It now relays the context the user's request came
 * in with, from the relay scope `gatewayAuth` opens (src/lib/identity-relay.ts).
 *
 * This file drives the REAL ask app (createApp: gatewayAuth, the message
 * route, the model loop, the booking.status tool) with contexts minted by the
 * REAL gateway signer, and the REAL HTTP travel port. What it pins is what
 * LEAVES ask-service, so the travel end is a recording endpoint answering
 * travel-service's documented order view; the real travel-service verifying
 * the relayed context is services/travel-service/tests/ask-travel-relay.test.ts.
 *
 *   - the relayed context is the inbound token byte for byte, with the city
 *     mirrors from its claim and its request id, and no plain identity or
 *     service key;
 *   - concurrent requests each relay their own caller;
 *   - forged inbound mirrors and tool arguments cannot change it;
 *   - work outside a request (a background sweep) has no relay, and in
 *     production the port refuses before sending anything;
 *   - the token is never persisted (messages, AI action log, outbox);
 *   - the documented unsigned development mode still works without a gateway.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ContractError } from "@ubi/contracts";

import { signIdentityContext } from "../../api-gateway/src/identity/context";
import { createApp } from "../src/index";
import { createHttpTravelPort } from "../src/ports/travel-port";
import {
  closeTestDb,
  makeDeps,
  rider,
  seedCity,
  testDb,
  uid,
  type TestDeps,
} from "./helpers";

import type { Scope } from "../../api-gateway/src/identity/scopes";

const IDENTITY_SECRET = "ask-travel-relay-test-internal-secret-000001";
const RIDER_SCOPES = [
  "profile:read",
  "ride:read",
  "ask:converse",
  "ask:transact",
  "travel:read",
  "travel:book",
] as const;

interface Outbound {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
}

let cityId: string;
let outbound: Outbound[] = [];
let deps: TestDeps;

/**
 * Stands in for travel-service's GET /v1/travel/orders/:id (its OrderView,
 * money included — the port refuses an order whose money does not read) and
 * records every request exactly as it left.
 */
const travelEndpoint = (async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const request = new Request(input, init);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const path = new URL(request.url).pathname;
  outbound.push({ method: request.method, path, headers });
  const orderId = path.split("/").at(-1) ?? "";
  const ngn = (amountMinor: number) => ({ amountMinor, currency: "NGN" });
  return new Response(
    JSON.stringify({
      id: orderId,
      tripId: "trip_1",
      kind: "flight",
      state: "ticketed",
      supplierRefs: { pnr: "QX1234", orderRef: "ord_supplier_1" },
      price: ngn(14_850_000),
      held: ngn(14_850_000),
      charged: ngn(14_850_000),
      released: ngn(0),
      stateAt: "2026-09-12T06:45:00.000Z",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;

beforeAll(async () => {
  process.env.UBI_IDENTITY_SECRET = IDENTITY_SECRET;
  process.env.UBI_IDENTITY_KEY_ID = "test-k1";
  process.env.JWT_SECRET = "ask-travel-relay-test-client-secret-00001";
  cityId = await seedCity(testDb());
  deps = makeDeps(testDb(), {
    travel: createHttpTravelPort({
      baseUrl: "http://travel-service.internal",
      fetchImpl: travelEndpoint,
    }),
  });
});

beforeEach(() => {
  outbound = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  delete process.env.UBI_IDENTITY_SECRET;
  delete process.env.UBI_IDENTITY_KEY_ID;
  delete process.env.JWT_SECRET;
  await closeTestDb();
});

async function contextFor(
  userId: string,
  requestId: string,
  city: string | null = cityId,
): Promise<string> {
  return signIdentityContext({
    userId,
    role: "rider",
    scopes: [...RIDER_SCOPES] as Scope[],
    modes: [],
    cityId: city,
    tenantId: null,
    sessionId: null,
    deviceId: null,
    requestId,
  });
}

/** Exactly what the gateway forwards for a verified caller. */
function gatewayHeaders(
  token: string,
  userId: string,
  requestId: string,
  city: string | null = cityId,
): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-ubi-identity": token,
    "x-user-id": userId,
    "x-user-role": "rider",
    "x-request-id": requestId,
    ...(city === null ? {} : { "x-auth-city-id": city, "x-ubi-city-id": city }),
  };
}

async function openThread(headers: Record<string, string>): Promise<string> {
  const response = await createApp(deps).request("/v1/ask/threads", {
    method: "POST",
    headers,
    body: JSON.stringify({ source: "home" }),
  });
  expect(response.status).toBe(201);
  return String(((await response.json()) as { id: string }).id);
}

async function askStatus(
  headers: Record<string, string>,
  threadId: string,
  args: Record<string, unknown>,
): Promise<{ status: number; text: string }> {
  const response = await createApp(deps).request(
    `/v1/ask/threads/${threadId}/messages`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        text: `where is my flight? @tool booking.status ${JSON.stringify(args)}`,
      }),
    },
  );
  return { status: response.status, text: await response.text() };
}

describe("the travel port relays the verified caller", () => {
  it("presents the gateway's own context to travel-service in production, and nothing weaker", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const user = rider();
    const requestId = `req_${uid("r")}`;
    const token = await contextFor(user.id, requestId);
    const headers = gatewayHeaders(token, user.id, requestId);
    const threadId = await openThread(headers);

    const turn = await askStatus(headers, threadId, { orderId: "tord_1" });
    expect(turn.status).toBe(200);

    expect(outbound).toHaveLength(1);
    const call = outbound[0] as Outbound;
    expect(call.method).toBe("GET");
    expect(call.path).toBe("/v1/travel/orders/tord_1");
    expect(call.headers["x-ubi-identity"]).toBe(token);
    expect(call.headers["x-auth-city-id"]).toBe(cityId);
    expect(call.headers["x-ubi-city-id"]).toBe(cityId);
    expect(call.headers["x-request-id"]).toBe(requestId);
    for (const stale of [
      "x-user-id",
      "x-user-role",
      "x-service-key",
      "x-city-id",
    ]) {
      expect(call.headers[stale], stale).toBeUndefined();
    }

    // The tool answered from travel-service's order view.
    const log = await testDb().aiAction.findMany({
      where: { actorRef: user.id, tool: "booking.status" },
    });
    expect(log.map((row) => row.outcome)).toEqual(["done"]);
    expect(log[0]?.providerRefs).toEqual(["tord_1"]);
  });

  it("relays each concurrent request's own caller", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const callers = await Promise.all(
      [rider(), rider(), rider()].map(async (user) => {
        const requestId = `req_${uid("r")}`;
        const token = await contextFor(user.id, requestId);
        const headers = gatewayHeaders(token, user.id, requestId);
        return { user, token, headers, threadId: await openThread(headers) };
      }),
    );
    outbound = [];

    const turns = await Promise.all(
      callers.map((caller, index) =>
        askStatus(caller.headers, caller.threadId, {
          orderId: `tord_c${index}`,
        }),
      ),
    );
    expect(turns.map((turn) => turn.status)).toEqual([200, 200, 200]);

    expect(outbound).toHaveLength(3);
    for (const [index, caller] of callers.entries()) {
      const call = outbound.find(
        (entry) => entry.path === `/v1/travel/orders/tord_c${index}`,
      );
      expect(call?.headers["x-ubi-identity"]).toBe(caller.token);
    }
  });

  it("cannot be steered by forged inbound mirrors or by tool arguments", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const user = rider();
    const victim = rider();
    const requestId = `req_${uid("r")}`;
    const token = await contextFor(user.id, requestId);
    const headers = {
      ...gatewayHeaders(token, user.id, requestId),
      // Plain mirrors rewritten to someone else: the signed claim wins.
      "x-user-id": victim.id,
      "x-auth-user-id": victim.id,
    };
    const threadId = await openThread(headers);

    // A tool argument naming an identity is not an argument the tool takes:
    // the strict schema rejects the call and nothing is sent.
    const smuggled = await askStatus(headers, threadId, {
      orderId: "tord_2",
      "x-ubi-identity": "forged.context.token",
    });
    expect(smuggled.status).toBe(200);
    expect(outbound).toHaveLength(0);

    const honest = await askStatus(headers, threadId, { orderId: "tord_2" });
    expect(honest.status).toBe(200);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]?.headers["x-ubi-identity"]).toBe(token);
  });

  it("has no relay outside a request: in production the port refuses before sending", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // What a background sweep would do: call the port with an actor it read
    // from its own records, with no inbound request behind it.
    let refusal: unknown;
    try {
      await deps.travel.bookingStatus(rider(), "tord_3");
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(ContractError);
    expect((refusal as ContractError).code).toBe("unauthorized");
    expect((refusal as ContractError).details).toMatchObject({
      reason: "no_identity_relay",
    });
    expect(outbound).toHaveLength(0);
  });

  it("never persists the relayed context", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const user = rider();
    const requestId = `req_${uid("r")}`;
    const token = await contextFor(user.id, requestId);
    const headers = gatewayHeaders(token, user.id, requestId);
    const threadId = await openThread(headers);
    expect(
      (await askStatus(headers, threadId, { orderId: "tord_4" })).status,
    ).toBe(200);
    expect(outbound).toHaveLength(1);

    const signature = token.split(".")[2] ?? "";
    expect(signature.length).toBeGreaterThan(20);
    const rows = JSON.stringify([
      await testDb().askMessage.findMany({ where: { threadId } }),
      await testDb().aiAction.findMany({ where: { actorRef: user.id } }),
      await testDb().outboxEvent.findMany({ where: { actorId: user.id } }),
    ]);
    expect(rows).not.toContain(signature);
  });

  it("keeps the documented unsigned development mode working without a gateway", async () => {
    const user = rider();
    const headers = {
      "content-type": "application/json",
      "X-User-ID": user.id,
      "X-User-Role": "rider",
      "X-City-ID": cityId,
    };
    const threadId = await openThread(headers);
    expect(
      (await askStatus(headers, threadId, { orderId: "tord_5" })).status,
    ).toBe(200);
    expect(outbound).toHaveLength(1);
    const call = outbound[0] as Outbound;
    expect(call.headers["x-ubi-identity"]).toBeUndefined();
    expect(call.headers["x-user-id"]).toBe(user.id);
    expect(call.headers["x-user-role"]).toBe("rider");
    expect(call.headers["x-city-id"]).toBe(cityId);
    expect(call.headers["x-service-key"]).toBeUndefined();
  });
});
