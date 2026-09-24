/**
 * The gateway → travel-service hop (slice T-GW).
 *
 * travel-service authenticates every client and ops route ONLY with the
 * signed `x-ubi-identity` context in production, derives the city from that
 * context's claim (and the `x-auth-city-id` / `x-ubi-city-id` mirrors written
 * from it), and refuses a client-declared `x-city-id` that disagrees. So what
 * this hop forwards must be exactly what travel-service verifies:
 *
 *   - the context the gateway minted (verified here with the shared
 *     UBI_IDENTITY_SECRET), naming the token's user, role, scopes and city;
 *   - none of the client's forged identity or city claims;
 *   - the client's declared `x-city-id` and `Idempotency-Key`, untouched.
 *
 * And the supplier webhook route travel-service serves is never forwarded,
 * whether or not the caller holds a token.
 *
 * That travel-service's OWN verifier accepts exactly what this hop sends is
 * proven end to end on the travel side: services/travel-service/tests/
 * gateway-e2e.test.ts drives the real gateway app in front of the real
 * travel-service app and database.
 */
import "./env";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyIdentityContext } from "../src/identity/context";
import { setIdentityStateStore } from "../src/lib/redis";

import {
  clientToken,
  openRiskStore,
  startUpstream,
  type Upstream,
} from "./helpers";

let travel: Upstream;
const app = createApp("test");

beforeAll(async () => {
  travel = await startUpstream();
  process.env.TRAVEL_SERVICE_URL = travel.url;
});

afterAll(async () => {
  await travel.close();
});

beforeEach(() => {
  travel.received.length = 0;
  setIdentityStateStore(openRiskStore);
});

describe("the travel-service hop", () => {
  it("forwards a checkout with the gateway's signed context and none of the client's forged claims", async () => {
    const token = await clientToken({
      sub: "usr_traveller",
      role: "rider",
      cityId: "ABV",
    });
    const response = await app.fetch(
      new Request("http://gateway.test/v1/travel/carts/cart_1/checkout", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "idem-travel-checkout-0001",
          // Declared context: passes through; travel-service compares it with
          // the verified city.
          "x-city-id": "ABV",
          // Forged identity and city claims: stripped before anything reads them.
          "x-ubi-identity": "forged.context.value",
          "x-user-id": "usr_victim",
          "x-user-role": "travel_ops",
          "x-auth-city-id": "LOS",
          "x-ubi-city-id": "LOS",
        },
        body: JSON.stringify({ paymentMethodId: "wallet" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(travel.received).toHaveLength(1);
    const forwarded = travel.received[0];
    expect(forwarded?.method).toBe("POST");
    expect(forwarded?.url).toBe("/v1/travel/carts/cart_1/checkout");

    const context = forwarded?.headers["x-ubi-identity"] ?? "";
    expect(context).not.toBe("forged.context.value");
    const verified = await verifyIdentityContext(context);
    expect(verified).toMatchObject({
      userId: "usr_traveller",
      role: "rider",
      cityId: "ABV",
      modes: [],
    });
    expect(verified.scopes).toEqual(
      expect.arrayContaining(["travel:read", "travel:book", "mp:request"]),
    );
    expect(verified.scopes).not.toContain("travel:ops");

    // Mirrors are the gateway's, written from the verified token.
    expect(forwarded?.headers["x-user-id"]).toBe("usr_traveller");
    expect(forwarded?.headers["x-user-role"]).toBe("rider");
    expect(forwarded?.headers["x-auth-city-id"]).toBe("ABV");
    expect(forwarded?.headers["x-ubi-city-id"]).toBe("ABV");
    // Client context that is not an identity claim crosses untouched.
    expect(forwarded?.headers["x-city-id"]).toBe("ABV");
    expect(forwarded?.headers["idempotency-key"]).toBe(
      "idem-travel-checkout-0001",
    );
  });

  it("forwards a limited-mode read with the limited mode in the signed context, so travel-service can apply it too", async () => {
    const token = await clientToken({
      sub: "usr_new_device",
      role: "rider",
      mode: "limited",
    });
    const response = await app.fetch(
      new Request("http://gateway.test/v1/reservations?linkedOrderId=ord_1", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(response.status).toBe(200);
    const forwarded = travel.received[0];
    expect(forwarded?.url).toBe("/v1/reservations?linkedOrderId=ord_1");
    const verified = await verifyIdentityContext(
      forwarded?.headers["x-ubi-identity"] ?? "",
    );
    expect(verified.modes).toEqual(["limited"]);
    // No city on the token: none is invented, so travel-service will not act
    // in a city for this caller in production.
    expect(verified.cityId).toBeNull();
    expect(forwarded?.headers["x-auth-city-id"]).toBeUndefined();
    // The transfer actions need mp:request, which limited mode strips.
    expect(verified.scopes).toContain("travel:read");
    expect(verified.scopes).not.toContain("mp:request");
  });

  it("lets the web and admin origins send Idempotency-Key and a declared X-City-ID (CORS preflight)", async () => {
    for (const origin of [
      "https://app.ubi.africa",
      "https://admin.ubi.africa",
    ]) {
      const preflight = await app.fetch(
        new Request(
          "http://gateway.test/v1/ops/travel/exceptions/ord_1/actions",
          {
            method: "OPTIONS",
            headers: {
              origin,
              "access-control-request-method": "POST",
              "access-control-request-headers":
                "authorization,content-type,idempotency-key,x-city-id",
            },
          },
        ),
      );
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
      const allowed = (
        preflight.headers.get("access-control-allow-headers") ?? ""
      )
        .toLowerCase()
        .split(",")
        .map((name) => name.trim());
      expect(allowed).toEqual(
        expect.arrayContaining([
          "idempotency-key",
          "x-city-id",
          "authorization",
        ]),
      );
      // Identity headers are never on the list: the gateway writes them.
      expect(allowed).not.toContain("x-ubi-identity");
      expect(allowed).not.toContain("x-user-id");
    }
    expect(travel.received).toHaveLength(0);
  });

  it("never forwards a supplier webhook, with or without a token", async () => {
    const token = await clientToken({ sub: "usr_admin", role: "admin" });
    const withToken = await app.fetch(
      new Request("http://gateway.test/v1/travel/webhooks/sup_duffel", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-duffel-signature": "t=1,v1=00",
        },
        body: "{}",
      }),
    );
    expect(withToken.status).toBe(404);
    const anonymous = await app.fetch(
      new Request("http://gateway.test/v1/travel/webhooks/sup_duffel", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-duffel-signature": "t=1,v1=00",
        },
        body: "{}",
      }),
    );
    // Not a public gateway route either: suppliers call travel-service
    // directly, so an unauthenticated caller is refused at the edge.
    expect(anonymous.status).toBe(401);
    expect(travel.received).toHaveLength(0);
  });
});
