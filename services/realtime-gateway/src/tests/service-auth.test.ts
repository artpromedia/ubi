/**
 * Tests for service authentication on the broadcast endpoint.
 */

import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkServiceAuth,
  requireServiceAuth,
  verifyServiceHmacToken,
} from "../lib/service-auth.js";

const SERVICE_SECRET = "test-service-secret";
const INTERNAL_KEY = "test-internal-key";

function makeSvcToken(serviceId: string, secret: string): string {
  const hmac = createHmac("sha256", secret)
    .update(`svc_${serviceId}`)
    .digest("hex")
    .substring(0, 32);
  return `svc_${serviceId}_${hmac}`;
}

function makeApp() {
  const app = new Hono();
  app.post("/broadcast/user/:userId", requireServiceAuth, (c) =>
    c.json({ success: true }),
  );
  return app;
}

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv.SERVICE_SECRET = process.env.SERVICE_SECRET;
  savedEnv.INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
  delete process.env.SERVICE_SECRET;
  delete process.env.INTERNAL_SERVICE_KEY;
});

afterEach(() => {
  if (savedEnv.SERVICE_SECRET === undefined) delete process.env.SERVICE_SECRET;
  else process.env.SERVICE_SECRET = savedEnv.SERVICE_SECRET;
  if (savedEnv.INTERNAL_SERVICE_KEY === undefined) {
    delete process.env.INTERNAL_SERVICE_KEY;
  } else {
    process.env.INTERNAL_SERVICE_KEY = savedEnv.INTERNAL_SERVICE_KEY;
  }
});

describe("verifyServiceHmacToken", () => {
  it("accepts a correctly signed svc_ token", () => {
    const token = makeSvcToken("marketplace", SERVICE_SECRET);
    expect(verifyServiceHmacToken(token, SERVICE_SECRET)).toBe(true);
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = makeSvcToken("marketplace", "wrong-secret");
    expect(verifyServiceHmacToken(token, SERVICE_SECRET)).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifyServiceHmacToken("svc_only-two", SERVICE_SECRET)).toBe(false);
    expect(verifyServiceHmacToken("not-a-token", SERVICE_SECRET)).toBe(false);
  });
});

describe("POST /broadcast/user/:userId auth", () => {
  const body = JSON.stringify({
    type: "notification",
    payload: {
      id: "n1",
      title: "t",
      body: "b",
      priority: "normal",
      timestamp: 1,
    },
  });

  it("rejects an unauthenticated broadcast when SERVICE_SECRET is configured", async () => {
    process.env.SERVICE_SECRET = SERVICE_SECRET;
    const app = makeApp();

    const res = await app.request("/broadcast/user/usr_1", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("unauthorized");
  });

  it("rejects a broadcast with a forged svc_ token", async () => {
    process.env.SERVICE_SECRET = SERVICE_SECRET;
    const app = makeApp();

    const res = await app.request("/broadcast/user/usr_1", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeSvcToken("marketplace", "wrong-secret")}`,
      },
    });

    expect(res.status).toBe(401);
  });

  it("accepts a broadcast with a valid svc_ token", async () => {
    process.env.SERVICE_SECRET = SERVICE_SECRET;
    const app = makeApp();

    const res = await app.request("/broadcast/user/usr_1", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeSvcToken("marketplace", SERVICE_SECRET)}`,
      },
    });

    expect(res.status).toBe(200);
  });

  it("accepts a broadcast with a valid X-Service-Key", async () => {
    process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    const app = makeApp();

    const res = await app.request("/broadcast/user/usr_1", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-service-key": INTERNAL_KEY,
      },
    });

    expect(res.status).toBe(200);
  });

  it("rejects a wrong X-Service-Key", async () => {
    process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    const app = makeApp();

    const res = await app.request("/broadcast/user/usr_1", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-service-key": "wrong-key",
      },
    });

    expect(res.status).toBe(401);
  });

  it("allows requests when no secret is configured (dev mode)", async () => {
    const app = makeApp();

    const res = await app.request("/broadcast/user/usr_1", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(checkServiceAuth({}).unauthenticatedDev).toBe(true);
  });
});
