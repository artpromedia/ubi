import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { actorOf, cityOf, gatewayAuth } from "../bites/middleware";
import { auth } from "../middleware/auth";
import {
  IDENTITY_HEADER,
  signIdentityContext,
  verifiedCallerUserId,
} from "./identity-context";

const SECRET = "food_unit_identity_secret_at_least_32_bytes_long_01";
process.env.UBI_IDENTITY_SECRET = SECRET;

describe("food-service signed gateway identity verification (CC-A12)", () => {
  it("verifies x-ubi-identity in bites gatewayAuth and ignores forged X-User-ID / X-User-Role", async () => {
    const app = new Hono();
    app.use("/v1/carts/*", gatewayAuth);
    app.post("/v1/carts/items", (c) =>
      c.json({ actor: actorOf(c), cityId: cityOf(c) }),
    );

    const token = signIdentityContext({
      userId: "usr_real_rider",
      role: "rider",
      cityId: "LOS",
      scopes: ["order:create", "profile:read"],
      secret: SECRET,
    });

    const ok = await app.request("/v1/carts/items", {
      method: "POST",
      headers: {
        [IDENTITY_HEADER]: token,
        "X-User-ID": "usr_forged_attacker",
        "X-User-Role": "ops_admin",
        "X-City-ID": "LOS",
      },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      actor: { id: "usr_real_rider", role: "rider" },
      cityId: "LOS",
    });

    const plainOnly = await app.request("/v1/carts/items", {
      method: "POST",
      headers: {
        "X-User-ID": "usr_real_rider",
        "X-User-Role": "rider",
        "X-City-ID": "LOS",
      },
    });
    expect(plainOnly.status).toBe(401);

    const cityMismatch = await app.request("/v1/carts/items", {
      method: "POST",
      headers: {
        [IDENTITY_HEADER]: token,
        "X-City-ID": "NBO",
      },
    });
    expect(cityMismatch.status).toBe(403);
    expect(await cityMismatch.json()).toMatchObject({
      code: "forbidden",
      details: { reason: "city_mismatch" },
    });
  });

  it("verifies x-ubi-identity in middleware/auth and verifiedCallerUserId while refusing plain X-User-ID", async () => {
    const app = new Hono();
    app.post("/restaurants", (c) =>
      c.json({ callerId: verifiedCallerUserId(c) ?? null }),
    );
    app.get("/protected", auth, (c) =>
      c.json({ userId: c.get("userId"), role: c.get("userRole") }),
    );

    const token = signIdentityContext({
      userId: "usr_owner_1",
      role: "merchant",
      cityId: "LOS",
      secret: SECRET,
    });

    const spoofAttempt = await app.request("/restaurants", {
      method: "POST",
      headers: {
        "X-User-ID": "usr_spoofed_owner",
      },
    });
    expect(await spoofAttempt.json()).toEqual({ callerId: null });

    const verifiedOwner = await app.request("/restaurants", {
      method: "POST",
      headers: {
        [IDENTITY_HEADER]: token,
        "X-User-ID": "usr_spoofed_owner",
      },
    });
    expect(await verifiedOwner.json()).toEqual({ callerId: "usr_owner_1" });

    const protectedRes = await app.request("/protected", {
      headers: {
        [IDENTITY_HEADER]: token,
      },
    });
    expect(protectedRes.status).toBe(200);
    expect(await protectedRes.json()).toEqual({
      userId: "usr_owner_1",
      role: "MERCHANT",
    });
  });
});
