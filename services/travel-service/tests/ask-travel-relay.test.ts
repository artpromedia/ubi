/**
 * ask-service → travel-service identity (round 7, X-SEC item 1).
 *
 * Round 6 made travel-service refuse every unsigned caller in production. The
 * assistant's travel port still sent plain `X-User-ID` / `X-User-Role` plus
 * `X-Service-Key`, so every AI travel call there was a 401. The port now
 * RELAYS the gateway-signed context the user's own request arrived with
 * (services/ask-service/src/lib/identity-relay.ts), and a background read with
 * no user behind it has its own service-key surface
 * (src/routes/internal-ask.ts) that exposes one order's state and nothing
 * more.
 *
 * Everything here is real: the REAL ask-service HTTP travel port
 * (services/ask-service/src/ports/travel-port.ts) calls the REAL travel-service
 * app (createApp, in-process via app.fetch) against real Postgres, in
 * PRODUCTION mode, with contexts minted by the REAL gateway signer
 * (services/api-gateway/src/identity/context.ts, via tests/helpers.ts) and
 * turned into a relay exactly as ask-service's gatewayAuth does — by
 * verifying them with ask-service's own verifier.
 *
 * Pinned:
 *   - a valid relay is accepted, and ownership still holds on it;
 *   - an expired or tampered relay is refused by travel-service (401) and
 *     reported as `unauthorized`; an absent relay, or a relay for someone
 *     else, is refused by the port before anything is sent;
 *   - the pre-round-7 headers are refused by production travel-service;
 *   - the background read answers only ONE AI-booked order under THE grant
 *     named, only by service key, only its state, with the owner taken from
 *     the order — and the key opens nothing else.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ContractError } from "@ubi/contracts";

import {
  identityVerificationKeys as askVerificationKeys,
  verifyIdentityContext as askVerify,
} from "../../ask-service/src/lib/identity-context";
import {
  runWithIdentityRelay,
  type IdentityRelay,
} from "../../ask-service/src/lib/identity-relay";
import { createHttpTravelPort } from "../../ask-service/src/ports/travel-port";
import {
  closeTestDb,
  gatewayContext,
  idemKey,
  makeDeps,
  resetTravel,
  rider,
  seedCity,
  seedFlightSupplier,
  stubIdentityKeys,
  testDb,
  uid,
} from "./helpers";
import { createApp } from "../src/index";
import { createCart } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";
import {
  ASK_SERVICE_KEY_ENV,
  createAskInternalRoutes,
} from "../src/routes/internal-ask";

const db = testDb();
const ASK_KEY = "ask-to-travel-background-read-key-0123456789";

interface Hop {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly status: number;
}

let hops: Hop[] = [];

beforeEach(async () => {
  await resetTravel(db);
  stubIdentityKeys();
  vi.stubEnv(ASK_SERVICE_KEY_ENV, ASK_KEY);
  hops = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(closeTestDb);

function production(): void {
  vi.stubEnv("NODE_ENV", "production");
}

/**
 * The real travel-service app, with the background-read router mounted where
 * src/index.ts createApp mounts client routers, reached in-process.
 */
function travelApp() {
  const { deps } = makeDeps(db);
  const app = createApp(deps);
  app.route("/internal/ask", createAskInternalRoutes(deps));
  return app;
}

/** The REAL ask travel port, talking to that app over `app.fetch`. */
function askPort(options: { readonly internalServiceKey?: string } = {}) {
  const app = travelApp();
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = new Request(input, init);
    const response = await app.fetch(request);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    hops.push({
      method: request.method,
      path: new URL(request.url).pathname,
      headers,
      status: response.status,
    });
    return response;
  }) as typeof fetch;
  return createHttpTravelPort({
    baseUrl: "http://travel-service.internal",
    fetchImpl,
    ...options,
  });
}

/**
 * The relay ask-service's gatewayAuth builds: the context verified with
 * ask-service's own verifier, relayed as the exact token it arrived as.
 */
function relayFrom(token: string): IdentityRelay {
  const identity = askVerify(token, askVerificationKeys(process.env));
  return {
    kind: "signed",
    token,
    userId: identity.userId,
    role: identity.role,
    cityId: identity.cityId,
    requestId: identity.requestId,
  };
}

async function order(
  cityId: string,
  actor: { id: string; role: string },
  grantId: string | null,
): Promise<string> {
  const { deps } = makeDeps(db);
  const cart = await createCart(deps, {
    actor,
    cityId,
    items: [{ kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" }],
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  const result = await checkout(deps, {
    actor,
    cityId,
    cartId: cart.id,
    paymentMethodId: "wallet",
    grantId,
    assuranceMethod: grantId === null ? "pin" : null,
    expectedTotal: null,
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  if (result.kind !== "ok") {
    throw new Error("expected a booked order");
  }
  return result.orders[0]?.id ?? "";
}

async function bookedWorld(): Promise<{
  cityId: string;
  traveller: { id: string; role: string };
  other: { id: string; role: string };
  aiOrderId: string;
  grantId: string;
  ownOrderId: string;
  othersOrderId: string;
}> {
  const cityId = await seedCity(db);
  await seedFlightSupplier(db, {
    control: {
      "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" },
    },
  });
  const traveller = rider();
  const other = rider();
  const grantId = uid("grant");
  return {
    cityId,
    traveller,
    other,
    grantId,
    aiOrderId: await order(cityId, traveller, grantId),
    ownOrderId: await order(cityId, traveller, null),
    othersOrderId: await order(cityId, other, uid("grant")),
  };
}

async function refusal(work: Promise<unknown>): Promise<ContractError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ContractError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to be refused");
}

describe("request-scoped calls relay the user's gateway-signed context", () => {
  it("is accepted by production travel-service, which reads the traveller's own order as them", async () => {
    const world = await bookedWorld();
    production();
    const token = await gatewayContext(world.traveller, {
      cityId: world.cityId,
    });
    const port = askPort();

    const status = await runWithIdentityRelay(relayFrom(token), () =>
      port.bookingStatus(world.traveller, world.aiOrderId),
    );

    expect(status).toEqual({
      orderId: world.aiOrderId,
      state: "confirmed",
      supplierRef: "AP7QX2",
    });
    expect(hops).toHaveLength(1);
    const hop = hops[0] as Hop;
    expect(hop.status).toBe(200);
    expect(hop.path).toBe(`/v1/travel/orders/${world.aiOrderId}`);
    // The very context the gateway signed, plus the mirrors it writes from
    // the same city claim — and nothing the old port sent.
    expect(hop.headers["x-ubi-identity"]).toBe(token);
    expect(hop.headers["x-auth-city-id"]).toBe(world.cityId);
    expect(hop.headers["x-ubi-city-id"]).toBe(world.cityId);
    for (const stale of ["x-user-id", "x-user-role", "x-service-key"]) {
      expect(hop.headers[stale], stale).toBeUndefined();
    }
  });

  it("keeps ownership on the relayed identity: another traveller's order is not theirs to read", async () => {
    const world = await bookedWorld();
    production();
    const token = await gatewayContext(world.traveller, {
      cityId: world.cityId,
    });
    const status = await runWithIdentityRelay(relayFrom(token), () =>
      askPort().bookingStatus(world.traveller, world.othersOrderId),
    );
    expect(status).toBeNull();
    expect(hops[0]?.status).toBe(404);
  });

  it("is refused by travel-service once the relayed context has expired, and reported as unauthorized", async () => {
    const world = await bookedWorld();
    production();
    // A context minted 2 minutes and 10 seconds ago: past the gateway's 120 s.
    const expired = await gatewayContext(world.traveller, {
      cityId: world.cityId,
      ttlSeconds: -10,
    });
    // ask-service verified it while it was live; the relay is that token.
    const relay: IdentityRelay = {
      kind: "signed",
      token: expired,
      userId: world.traveller.id,
      role: world.traveller.role,
      cityId: world.cityId,
      requestId: "req-expired-relay",
    };

    const error = await refusal(
      runWithIdentityRelay(relay, () =>
        askPort().bookingStatus(world.traveller, world.aiOrderId),
      ),
    );
    expect(error.code).toBe("unauthorized");
    expect(hops).toHaveLength(1);
    expect(hops[0]?.status).toBe(401);
  });

  it("is refused by travel-service when the relayed context was tampered with", async () => {
    const world = await bookedWorld();
    production();
    const genuine = await gatewayContext(world.other, { cityId: world.cityId });
    const [head, payload, signature] = genuine.split(".");
    const claims = JSON.parse(
      Buffer.from(payload ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    claims.sub = world.traveller.id;
    const forged = `${head}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
    const relay: IdentityRelay = {
      kind: "signed",
      token: forged,
      userId: world.traveller.id,
      role: "rider",
      cityId: world.cityId,
      requestId: null,
    };
    const error = await refusal(
      runWithIdentityRelay(relay, () =>
        askPort().bookingStatus(world.traveller, world.aiOrderId),
      ),
    );
    expect(error.code).toBe("unauthorized");
    expect(hops[0]?.status).toBe(401);
  });

  it("fails closed with no relay in production: nothing is sent at all", async () => {
    const world = await bookedWorld();
    production();
    const error = await refusal(
      askPort().bookingStatus(world.traveller, world.aiOrderId),
    );
    expect(error.code).toBe("unauthorized");
    expect(error.details).toMatchObject({ reason: "no_identity_relay" });
    expect(hops).toHaveLength(0);
  });

  it("refuses a relay for anyone but the actor the assistant is acting for", async () => {
    const world = await bookedWorld();
    production();
    const othersToken = await gatewayContext(world.other, {
      cityId: world.cityId,
    });
    const error = await refusal(
      runWithIdentityRelay(relayFrom(othersToken), () =>
        askPort().bookingStatus(world.traveller, world.aiOrderId),
      ),
    );
    expect(error.code).toBe("forbidden");
    expect(error.details).toMatchObject({ reason: "relay_actor_mismatch" });
    expect(hops).toHaveLength(0);
  });

  it("the headers the port sent before round 7 are refused by production travel-service", async () => {
    const world = await bookedWorld();
    production();
    const response = await travelApp().request(
      `/v1/travel/orders/${world.aiOrderId}`,
      {
        headers: {
          "content-type": "application/json",
          "X-User-ID": world.traveller.id,
          "X-User-Role": "rider",
          "X-Service-Key": ASK_KEY,
        },
      },
    );
    expect(response.status).toBe(401);
  });
});

describe("the background read is limited to its scope", () => {
  it("reads one AI-booked order by service key alone, with the owner taken from the order", async () => {
    const world = await bookedWorld();
    production();
    const port = askPort({ internalServiceKey: ASK_KEY });

    // Even when it happens to run inside a request, the background read
    // carries no user identity.
    const token = await gatewayContext(world.traveller, {
      cityId: world.cityId,
    });
    const status = await runWithIdentityRelay(relayFrom(token), () =>
      port.executionOrderStatus({
        orderId: world.aiOrderId,
        grantId: world.grantId,
        actorId: world.traveller.id,
      }),
    );
    expect(status).toEqual({
      orderId: world.aiOrderId,
      state: "confirmed",
      supplierRef: "AP7QX2",
    });
    const hop = hops[0] as Hop;
    expect(hop.status).toBe(200);
    expect(hop.path).toBe(
      `/internal/ask/grants/${world.grantId}/orders/${world.aiOrderId}`,
    );
    expect(hop.headers["x-service-key"]).toBe(ASK_KEY);
    for (const identity of [
      "x-ubi-identity",
      "x-auth-city-id",
      "x-ubi-city-id",
      "x-user-id",
      "x-user-role",
    ]) {
      expect(hop.headers[identity], identity).toBeUndefined();
    }

    // The raw answer: state only, owner from the order, no money or people.
    const raw = await travelApp().request(hop.path, {
      headers: { "X-Service-Key": ASK_KEY },
    });
    const body = (await raw.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "kind",
      "orderId",
      "ownerId",
      "state",
      "stateAt",
      "supplierRefs",
    ]);
    expect(body.ownerId).toBe(world.traveller.id);
  });

  it("answers nothing outside the grant it names: another grant, a traveller's own booking, another owner", async () => {
    const world = await bookedWorld();
    production();
    const port = askPort({ internalServiceKey: ASK_KEY });

    // Right order, wrong grant.
    expect(
      await port.executionOrderStatus({
        orderId: world.aiOrderId,
        grantId: uid("grant"),
        actorId: world.traveller.id,
      }),
    ).toBeNull();
    // A booking the traveller made themself (no AI grant) is not the key's.
    expect(
      await port.executionOrderStatus({
        orderId: world.ownOrderId,
        grantId: world.grantId,
        actorId: world.traveller.id,
      }),
    ).toBeNull();
    expect(hops.map((hop) => hop.status)).toEqual([404, 404]);

    // travel-service names the owner; an execution whose actor is someone
    // else gets nothing, even though the order exists under that grant.
    expect(
      await port.executionOrderStatus({
        orderId: world.aiOrderId,
        grantId: world.grantId,
        actorId: world.other.id,
      }),
    ).toBeNull();
    expect(hops[2]?.status).toBe(200);
  });

  it("opens only by the right key, closes when unconfigured, and serves no write", async () => {
    const world = await bookedWorld();
    production();
    const ref = {
      orderId: world.aiOrderId,
      grantId: world.grantId,
      actorId: world.traveller.id,
    };

    const wrongKey = await refusal(
      askPort({
        internalServiceKey: "not-the-key-for-the-ask-background-read",
      }).executionOrderStatus(ref),
    );
    expect(wrongKey.code).toBe("unauthorized");
    expect(hops[0]?.status).toBe(401);

    // No key on the ask side: refused before anything is sent.
    const unconfiguredPort = await refusal(askPort().executionOrderStatus(ref));
    expect(unconfiguredPort.code).toBe("service_unavailable");
    expect(hops).toHaveLength(1);

    // No (or a short) key on the travel side: closed, never open.
    vi.stubEnv(ASK_SERVICE_KEY_ENV, "short");
    const closed = await refusal(
      askPort({ internalServiceKey: "short" }).executionOrderStatus(ref),
    );
    expect(closed.code).toBe("service_unavailable");
    expect(hops[1]?.status).toBe(503);
    vi.stubEnv(ASK_SERVICE_KEY_ENV, ASK_KEY);

    const app = travelApp();
    const path = `/internal/ask/grants/${world.grantId}/orders/${world.aiOrderId}`;
    // A valid gateway identity is not a key.
    const identityOnly = await app.request(path, {
      headers: {
        "x-ubi-identity": await gatewayContext(world.traveller, {
          cityId: world.cityId,
        }),
      },
    });
    expect(identityOnly.status).toBe(401);
    // Read only.
    for (const method of ["POST", "PUT", "DELETE"]) {
      const write = await app.request(path, {
        method,
        headers: { "X-Service-Key": ASK_KEY },
      });
      expect(write.status, method).toBe(404);
    }
    // The key opens no client route: /v1/travel still wants the signed user.
    const clientRoute = await app.request(
      `/v1/travel/orders/${world.aiOrderId}`,
      { headers: { "X-Service-Key": ASK_KEY } },
    );
    expect(clientRoute.status).toBe(401);
  });
});
