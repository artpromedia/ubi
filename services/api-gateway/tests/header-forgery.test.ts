import "./env";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyIdentityContext } from "../src/identity/context";
import { setIdentityStateStore } from "../src/lib/redis";
import { IDENTITY_HEADER } from "../src/middleware/identity";
import { clientToken, openRiskStore, startUpstream, type Upstream } from "./helpers";

let upstream: Upstream;
const app = createApp("test");

beforeAll(async () => {
  upstream = await startUpstream();
  process.env.USER_SERVICE_URL = upstream.url;
  process.env.RIDE_SERVICE_URL = upstream.url;
  process.env.PAYMENT_SERVICE_URL = upstream.url;
});

afterAll(async () => {
  await upstream.close();
});

beforeEach(() => {
  upstream.received.length = 0;
  setIdentityStateStore(openRiskStore);
});

describe("inbound identity headers are stripped", () => {
  it("does not let a forged x-auth-user-id reach the upstream service", async () => {
    const token = await clientToken({ sub: "usr_real", role: "rider" });

    const response = await app.fetch(
      new Request("http://gateway.test/v1/users/me", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-auth-user-id": "usr_victim",
          "x-auth-user-role": "admin",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(upstream.received).toHaveLength(1);

    const forwarded = upstream.received[0];
    expect(forwarded).toBeDefined();
    expect(forwarded?.headers["x-auth-user-id"]).toBe("usr_real");
    expect(forwarded?.headers["x-auth-user-role"]).toBe("rider");
    expect(forwarded?.headers["x-auth-user-id"]).not.toBe("usr_victim");
  });

  it("strips every reserved family, including the internal-service bypass", async () => {
    // A limited-mode token, so a forged wide scope header would be visible.
    const token = await clientToken({ sub: "usr_real", role: "rider", mode: "limited" });

    await app.fetch(
      new Request("http://gateway.test/v1/users/me", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-internal-service": "true",
          "x-user-id": "usr_victim",
          "x-user-role": "admin",
          "x-ubi-scopes": "wallet:transfer:p2p security:pin:change",
          "x-ubi-modes": "",
          "x-session-id": "forged-session",
          "x-service-key": "forged-service-key",
        },
      }),
    );

    const forwarded = upstream.received[0];
    expect(forwarded).toBeDefined();
    expect(forwarded?.headers["x-internal-service"]).toBeUndefined();
    expect(forwarded?.headers["x-service-key"]).toBeUndefined();
    expect(forwarded?.headers["x-user-id"]).toBe("usr_real");
    expect(forwarded?.headers["x-user-role"]).toBe("rider");
    expect(forwarded?.headers["x-session-id"]).toBeUndefined();
    // The scope header is the gateway's own computation, not the client's:
    // a limited-mode session never carries a money or security scope.
    expect(forwarded?.headers["x-ubi-scopes"]).not.toContain("security:pin:change");
    expect(forwarded?.headers["x-ubi-scopes"]).not.toContain("wallet:transfer:p2p");
    expect(forwarded?.headers["x-ubi-scopes"]).toContain("ride:book:cash");
    expect(forwarded?.headers["x-ubi-modes"]).toBe("limited");
  });

  it("replaces a forged signed context with one the gateway actually issued", async () => {
    const token = await clientToken({
      sub: "usr_real",
      role: "rider",
      sid: "sess_1",
      cityId: "LOS",
    });

    await app.fetch(
      new Request("http://gateway.test/v1/users/me", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          [IDENTITY_HEADER]: "forged.identity.context",
        },
      }),
    );

    const forwarded = upstream.received[0];
    const context = forwarded?.headers[IDENTITY_HEADER];
    expect(context).toBeDefined();
    expect(context).not.toBe("forged.identity.context");

    const verified = await verifyIdentityContext(context as string);
    expect(verified.userId).toBe("usr_real");
    expect(verified.role).toBe("rider");
    expect(verified.sessionId).toBe("sess_1");
    expect(verified.cityId).toBe("LOS");
    expect(verified.requestId).toBe(forwarded?.headers["x-request-id"]);
  });

  it("mints no identity at all for an unauthenticated public route", async () => {
    await app.fetch(
      new Request("http://gateway.test/v1/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-auth-user-id": "usr_victim",
          "x-auth-user-role": "admin",
        },
        body: JSON.stringify({ email: "a@b.test", password: "hunter22222" }),
      }),
    );

    const forwarded = upstream.received[0];
    expect(forwarded).toBeDefined();
    expect(forwarded?.headers["x-auth-user-id"]).toBeUndefined();
    expect(forwarded?.headers[IDENTITY_HEADER]).toBeUndefined();
  });
});
