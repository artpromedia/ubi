/**
 * `serviceAuth`'s production-vs-dev identity trust boundary (C03 review).
 *
 * `GET /v1/wallet/mp/overview` (mp-holds.ts) — and every other route guarded
 * by `serviceAuth`: `/fraud/*`, `/safety/*`, `/admin/*` (src/index.ts),
 * `/v1/finance/*` (finance/routes.ts) and the rest of `/v1/wallet/*`
 * (wallet-v1.ts) — used to authenticate the caller purely from the plain
 * `X-User-ID` header. Any caller with service-network access could read (or
 * act as) any driver by setting that header, since api-gateway is the only
 * thing that normally strips and re-sets it. This mirrors the fix already
 * applied to user-service's `src/middleware/service-auth.ts` and to the Go
 * ride-service (G03): in production only the gateway-signed `X-UBI-Identity`
 * JWS (verified with `UBI_IDENTITY_SECRET` by ../src/identity/context.ts)
 * authenticates.
 *
 * vi.stubEnv persists across tests within a file (this suite never calls
 * vi.unstubAllEnvs), so a test that stubs a bad/missing secret would
 * otherwise leak into the next one — every test re-stubs NODE_ENV and
 * UBI_IDENTITY_SECRET to known-good values in beforeEach before overriding
 * whichever one it means to test (see
 * tests/unit/flutterwave.encryption.test.ts for the same trap).
 */
import { Hono } from "hono";
import * as jose from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { serviceAuth } from "../src/middleware/auth";

const GOOD_SECRET = "payment-service-test-internal-identity-secret-01";
const WRONG_SECRET = "a-completely-different-internal-identity-secret-0";

interface Claims {
  readonly sub: string;
  readonly role: string;
  readonly sid?: string | null;
}

/** Signs a context exactly the way api-gateway's signIdentityContext does. */
async function signIdentity(
  claims: Claims,
  secret: string = GOOD_SECRET,
): Promise<string> {
  return new jose.SignJWT({
    role: claims.role,
    scp: [],
    mod: [],
    city: null,
    tenant: null,
    sid: claims.sid ?? null,
    dev: null,
    rid: "test-request-1",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer("ubi-gateway")
    .setAudience("ubi-internal")
    .setIssuedAt()
    .setExpirationTime("120s")
    .sign(new TextEncoder().encode(secret));
}

function testApp(): Hono {
  const app = new Hono();
  app.get("/whoami", serviceAuth, (c) =>
    c.json({
      userId: c.get("userId"),
      userRole: c.get("userRole"),
      sessionId: c.get("sessionId"),
    }),
  );
  return app;
}

describe("serviceAuth in production", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UBI_IDENTITY_SECRET", GOOD_SECRET);
  });

  it("refuses a bare X-User-ID header with no gateway-signed context", async () => {
    const response = await testApp().request("/whoami", {
      headers: { "X-User-ID": "driver-1" },
    });
    expect(response.status).toBe(401);
  });

  it("refuses a request with no identity headers at all", async () => {
    const response = await testApp().request("/whoami");
    expect(response.status).toBe(401);
  });

  it("accepts a valid X-UBI-Identity JWS and takes identity from its claims", async () => {
    const token = await signIdentity({
      sub: "driver-victim",
      role: "driver",
      sid: "sess-1",
    });
    const response = await testApp().request("/whoami", {
      headers: {
        "x-ubi-identity": token,
        // An attacker-controlled mirror naming someone else. It must be
        // ignored once a JWS is present.
        "X-User-ID": "driver-attacker",
        "X-User-Role": "admin",
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      userId: string;
      userRole: string;
      sessionId: string;
    };
    expect(body.userId).toBe("driver-victim");
    expect(body.userRole).toBe("driver");
    expect(body.sessionId).toBe("sess-1");
  });

  it("refuses a JWS signed with the wrong key (tampered/forged)", async () => {
    const token = await signIdentity(
      { sub: "driver-1", role: "driver" },
      WRONG_SECRET,
    );
    const response = await testApp().request("/whoami", {
      headers: { "x-ubi-identity": token },
    });
    expect(response.status).toBe(401);
  });

  it("answers 503 when UBI_IDENTITY_SECRET is missing, never falling back to the bare header", async () => {
    const token = await signIdentity({ sub: "driver-1", role: "driver" });
    vi.stubEnv("UBI_IDENTITY_SECRET", "");

    const response = await testApp().request("/whoami", {
      headers: { "x-ubi-identity": token, "X-User-ID": "driver-1" },
    });
    expect(response.status).toBe(503);
  });
});

describe("serviceAuth in development/test", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("UBI_IDENTITY_SECRET", GOOD_SECRET);
  });

  it("keeps trusting the plain X-User-* mirrors when no JWS is presented (unchanged)", async () => {
    const response = await testApp().request("/whoami", {
      headers: {
        "X-User-ID": "driver-1",
        "X-User-Role": "driver",
        "X-Session-ID": "sess-1",
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      userId: string;
      userRole: string;
      sessionId: string;
    };
    expect(body.userId).toBe("driver-1");
    expect(body.userRole).toBe("driver");
    expect(body.sessionId).toBe("sess-1");
  });

  it("still refuses when neither a JWS nor X-User-ID is presented (unchanged)", async () => {
    const response = await testApp().request("/whoami");
    expect(response.status).toBe(401);
  });

  it("a presented JWS wins over the mirrors, even outside production", async () => {
    const token = await signIdentity({ sub: "driver-victim", role: "driver" });
    const response = await testApp().request("/whoami", {
      headers: { "x-ubi-identity": token, "X-User-ID": "driver-attacker" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { userId: string };
    expect(body.userId).toBe("driver-victim");
  });

  it("a tampered JWS is refused outright, never falling back to the mirror", async () => {
    const token = await signIdentity(
      { sub: "driver-1", role: "driver" },
      WRONG_SECRET,
    );
    const response = await testApp().request("/whoami", {
      headers: { "x-ubi-identity": token, "X-User-ID": "driver-1" },
    });
    expect(response.status).toBe(401);
  });
});
