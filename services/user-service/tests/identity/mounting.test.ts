import "./setup-env";

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { serviceAuthMiddleware } from "../../src/middleware/service-auth";
import { createDeviceRoutes } from "../../src/routes/devices";
import { createIdentityRoutes } from "../../src/routes/identity";
import {
  authedHeaders,
  closeConnections,
  createHarness,
  createUser,
  FULL_SCOPES,
  type TestHarness,
  type TestUser,
} from "./harness";

/**
 * src/index.ts mounts the identity routes BEFORE the `protectedApi` group whose
 * `use("*", serviceAuthMiddleware)` matches every path.
 *
 * That ordering is load-bearing. `serviceAuthMiddleware` authenticates on the
 * plain `x-auth-user-id` header — exactly the trust the identity module exists
 * to remove — so if it ran first, a forged header would satisfy it and the
 * signed-context check would never be reached. This reconstructs the same mount
 * order and proves the identity routes still answer for themselves.
 */
let harness: TestHarness;
let app: Hono;
let user: TestUser;

beforeAll(async () => {
  harness = createHarness();
  harness.setNow(new Date("2026-09-01T10:00:00.000Z"));
  user = await createUser("RIDER");

  app = new Hono();
  app.route("/devices", createDeviceRoutes(harness.deps));
  app.route("/", createIdentityRoutes(harness.deps));

  const protectedApi = new Hono();
  protectedApi.use("*", serviceAuthMiddleware);
  protectedApi.get("/users/me", (c) => c.json({ success: true, data: { via: "protectedApi" } }));
  app.route("/", protectedApi);
});

afterAll(async () => {
  await closeConnections();
});

describe("identity routes are not shadowed by the header-trusting service auth", () => {
  it("answers a forged x-auth-user-id with its own 401, not with a session", async () => {
    const response = await app.fetch(
      new Request("http://user-service.test/devices/enroll", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-auth-user-id": user.id,
          "x-auth-user-role": "admin",
        },
        body: JSON.stringify({ deviceId: "device-mount-forged" }),
      }),
    );

    expect(response.status).toBe(401);
    // The canonical lower-case code is this module's; the legacy middleware
    // answers with "UNAUTHORIZED".
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("serves a valid signed context even though a /* middleware is mounted", async () => {
    const response = await app.fetch(
      new Request("http://user-service.test/devices/enroll", {
        method: "POST",
        headers: await authedHeaders({
          userId: user.id,
          role: "rider",
          scopes: FULL_SCOPES,
        }),
        body: JSON.stringify({ deviceId: "device-mount-ok-001" }),
      }),
    );
    expect(response.status).toBe(201);
  });

  it("leaves the existing protected routes on their own middleware", async () => {
    const unauthenticated = await app.fetch(
      new Request("http://user-service.test/users/me"),
    );
    expect(unauthenticated.status).toBe(401);

    const authenticated = await app.fetch(
      new Request("http://user-service.test/users/me", {
        headers: { "x-auth-user-id": user.id, "x-auth-user-role": "rider" },
      }),
    );
    expect(authenticated.status).toBe(200);
  });

  it("keeps the telco webhook reachable without any user header", async () => {
    const response = await app.fetch(
      new Request("http://user-service.test/webhooks/telco/sim-swap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    // Refused by the signature check, which is the identity module's own —
    // not by the service-auth middleware.
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.message).toContain("signature");
  });
});
