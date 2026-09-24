/**
 * The gateway's signed identity context, verified here (the same contract
 * payment-service and user-service verify).
 *
 * The context is minted by the REAL API gateway signer
 * (services/api-gateway/src/identity/context.ts `signIdentityContext`), so a
 * drift between issuer and verifier turns this file red. Covered: the actor,
 * city and scopes come from the verified claims and beat any forged plain
 * header; a tampered, wrong-key, unsigned or expired context is refused;
 * production requires the context; a broken secret is an outage, not trust;
 * and limited mode keeps the assistant's chat but refuses its marketplace
 * surfaces — including the marketplace TOOLS, which reach ride-service
 * without passing the gateway's `/v1/mp` rule.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { signIdentityContext } from "../../api-gateway/src/identity/context";
import { createApp } from "../src/index";
import {
  closeTestDb,
  FakeMarketplacePort,
  makeDeps,
  mpOffer,
  mpRequest,
  rider,
  seedCity,
  testDb,
  uid,
  type TestDeps,
} from "./helpers";

import type { Scope } from "../../api-gateway/src/identity/scopes";

const IDENTITY_SECRET = "ask-identity-context-test-internal-secret-01";
const RIDER_SCOPES = [
  "profile:read",
  "ride:read",
  "mp:request",
  "ask:converse",
  "ask:transact",
] as const;
const LIMITED_SCOPES = ["profile:read", "ride:read", "ask:converse"] as const;

let cityId: string;
let deps: TestDeps;
let marketplace: FakeMarketplacePort;

beforeAll(async () => {
  process.env.UBI_IDENTITY_SECRET = IDENTITY_SECRET;
  process.env.UBI_IDENTITY_KEY_ID = "test-k1";
  process.env.JWT_SECRET = "ask-identity-context-test-client-secret-01";
  cityId = await seedCity(testDb(), { aiMarketplace: true });
  marketplace = new FakeMarketplacePort();
  deps = makeDeps(testDb(), { marketplace });
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

async function signed(
  userId: string,
  options: {
    readonly role?: string;
    readonly city?: string | null;
    readonly scopes?: readonly string[];
    readonly modes?: readonly ("limited" | "wallet_safe")[];
    readonly ttlSeconds?: number;
  } = {},
): Promise<string> {
  return signIdentityContext(
    {
      userId,
      role: options.role ?? "rider",
      scopes: [...(options.scopes ?? RIDER_SCOPES)] as Scope[],
      modes: [...(options.modes ?? [])],
      cityId: options.city === undefined ? cityId : options.city,
      tenantId: null,
      sessionId: null,
      deviceId: null,
      requestId: `req_${uid("r")}`,
    },
    options.ttlSeconds,
  );
}

async function openThreadWith(headers: Record<string, string>) {
  return createApp(deps).request("/v1/ask/threads", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ source: "home" }),
  });
}

function tamper(token: string): string {
  const [header, payload, signature] = token.split(".") as [
    string,
    string,
    string,
  ];
  const claims = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  claims.sub = "usr_victim";
  const forged = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${forged}.${signature}`;
}

describe("the verified context is the identity", () => {
  it("takes the actor and city from the gateway-signed claims, not a forged header", async () => {
    const userId = uid("rider");
    const response = await openThreadWith({
      "x-ubi-identity": await signed(userId),
      // A forged plain mirror naming someone else is ignored.
      "x-user-id": "usr_attacker",
      "x-user-role": "rider",
    });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const thread = await testDb().askThread.findUniqueOrThrow({
      where: { id },
    });
    expect(thread.userId).toBe(userId);
  });

  it("refuses a tampered, wrong-key, unsigned or expired context", async () => {
    const good = await signed(uid("rider"));
    const [header, payload] = good.split(".") as [string, string, string];
    const unsigned = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${payload}.`;

    vi.stubEnv(
      "UBI_IDENTITY_SECRET",
      "a-completely-different-internal-secret-99",
    );
    const wrongKey = await signed(uid("rider"));
    vi.unstubAllEnvs();
    process.env.UBI_IDENTITY_SECRET = IDENTITY_SECRET;

    for (const token of [
      tamper(good),
      wrongKey,
      unsigned,
      `${header}.${payload}`,
      await signed(uid("rider"), { ttlSeconds: -30 }),
    ]) {
      const response = await openThreadWith({ "x-ubi-identity": token });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "unauthorized" });
    }
  });

  it("requires the context in production, and accepts it there", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const plain = await openThreadWith({
      "x-user-id": uid("rider"),
      "x-user-role": "rider",
      "x-auth-city-id": cityId,
    });
    expect(plain.status).toBe(401);
    const verified = await openThreadWith({
      "x-ubi-identity": await signed(uid("rider")),
    });
    expect(verified.status).toBe(201);
  });

  it("is an outage, not trust, when the verification secret is unusable", async () => {
    const token = await signed(uid("rider"));
    vi.stubEnv("UBI_IDENTITY_SECRET", "short");
    const response = await openThreadWith({
      "x-ubi-identity": token,
      "x-user-id": uid("rider"),
      "x-user-role": "rider",
    });
    expect(response.status).toBe(503);
  });

  it("refuses a mirrored city that contradicts the signed one", async () => {
    const response = await openThreadWith({
      "x-ubi-identity": await signed(uid("rider")),
      "x-auth-city-id": uid("other_city"),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      details: { reason: "city_mismatch" },
    });
  });

  it("never acts in a merely-declared city in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await openThreadWith({
      "x-ubi-identity": await signed(uid("rider"), { city: null }),
      "x-city-id": cityId,
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "city_unsupported" });
  });

  it("gives other roles no access", async () => {
    const response = await openThreadWith({
      "x-ubi-identity": await signed(uid("m"), { role: "merchant" }),
    });
    expect(response.status).toBe(403);
  });
});

describe("limited mode keeps the chat and refuses the marketplace", () => {
  it("refuses the marketplace stages with limited_mode", async () => {
    const token = await signed(uid("rider"), {
      scopes: LIMITED_SCOPES,
      modes: ["limited"],
    });
    const quote = await createApp(deps).request("/v1/ask/mp/quotes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-ubi-identity": token },
      body: JSON.stringify({
        service: "ride",
        vehicleClass: "go",
        pickup: { lat: 6.5, lng: 3.35 },
        dropoff: { lat: 6.45, lng: 3.4 },
      }),
    });
    expect(quote.status).toBe(403);
    expect(await quote.json()).toMatchObject({ code: "limited_mode" });
  });

  it("cannot confirm a marketplace review without the marketplace scope", async () => {
    const actor = rider();
    const request = mpRequest({ requesterId: actor.id, cityId, revision: 1 });
    const bidId = uid("bid");
    marketplace.seedRequest(request);
    marketplace.setOffers(request.requestId, [
      mpOffer({ bidId, requestRevision: 1 }),
    ]);
    const app = createApp(deps);
    const full = await signed(actor.id);
    const opened = await app.request("/v1/ask/threads", {
      method: "POST",
      headers: { "content-type": "application/json", "x-ubi-identity": full },
      body: JSON.stringify({ source: "home" }),
    });
    const { id: threadId } = (await opened.json()) as { id: string };
    const created = await app.request("/v1/ask/mp/reviews", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ubi-identity": full,
        "idempotency-key": uid("rv"),
      },
      body: JSON.stringify({
        stage: "select",
        threadId,
        requestId: request.requestId,
        bidId,
      }),
    });
    expect(created.status).toBe(201);
    const review = (await created.json()) as {
      id: string;
      termsVersion: string;
    };

    // A token narrowed to ask:transact without mp:request.
    const narrowed = await signed(actor.id, {
      scopes: ["profile:read", "ask:converse", "ask:transact"],
    });
    const confirm = await app.request(`/v1/ask/reviews/${review.id}/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ubi-identity": narrowed,
        "idempotency-key": uid("cf"),
      },
      body: JSON.stringify({
        termsVersion: review.termsVersion,
        assurance: { method: "pin", proof: "p" },
      }),
    });
    expect(confirm.status).toBe(403);
    expect(await confirm.json()).toMatchObject({
      details: { reason: "marketplace_scope_missing" },
    });
    expect(marketplace.selectCalls).toHaveLength(0);
  });

  it("answers the marketplace tools as unavailable without reaching the marketplace", async () => {
    const actor = rider();
    const request = mpRequest({ requesterId: actor.id, cityId, revision: 1 });
    const bidId = uid("bid");
    marketplace.seedRequest(request);
    marketplace.setOffers(request.requestId, [
      mpOffer({ bidId, requestRevision: 1 }),
    ]);
    let reached = false;
    marketplace.onViewOffers = () => {
      reached = true;
      return Promise.resolve();
    };
    const token = await signed(actor.id, {
      scopes: LIMITED_SCOPES,
      modes: ["limited"],
    });
    const app = createApp(deps);
    const opened = await app.request("/v1/ask/threads", {
      method: "POST",
      headers: { "content-type": "application/json", "x-ubi-identity": token },
      body: JSON.stringify({ source: "home" }),
    });
    expect(opened.status).toBe(201);
    const { id } = (await opened.json()) as { id: string };
    const turn = await app.request(`/v1/ask/threads/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ubi-identity": token },
      body: JSON.stringify({
        text: `@tool mp.propose_selection ${JSON.stringify({ requestId: request.requestId, bidId })}`,
      }),
    });
    expect(turn.status).toBe(200);
    const stream = await turn.text();
    expect(stream).not.toContain("review_ready");
    expect(reached).toBe(false);
    marketplace.onViewOffers = null;
    expect(
      await testDb().askReview.count({ where: { userId: actor.id } }),
    ).toBe(0);
  });
});
