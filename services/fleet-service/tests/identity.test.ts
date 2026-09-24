/**
 * Identity, city, scopes and the deny-by-default `fleet` flag on every
 * client route. The context is minted by the API gateway's own signer.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  api,
  closeTestDb,
  idemKey,
  resetFleet,
  seedFleet,
  setFleetFlag,
  startHarness,
  tokenFor,
  type FleetWorld,
  type Harness,
} from "./helpers";

let h: Harness;
let world: FleetWorld;

beforeAll(async () => {
  h = await startHarness();
  await resetFleet(h.db);
});

afterAll(async () => {
  await h.close();
  await closeTestDb();
});

beforeEach(async () => {
  world = await seedFleet(h);
});

describe("gateway-signed identity", () => {
  it("serves the fleet to its owner with a verified context", async () => {
    const result = await api<{ fleetId: string; myRole: string }>(h.app, {
      path: `/v1/fleets/${world.fleetId}`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(result.status).toBe(200);
    expect(result.body.myRole).toBe("owner");
  });

  it("refuses a request with no identity at all", async () => {
    const result = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}`,
      city: world.cityId,
    });
    expect(result.status).toBe(401);
    expect(result.body.code).toBe("unauthorized");
  });

  it("refuses a forged context (signed with another key) and never falls back to plain headers", async () => {
    const good = world.ownerToken.split(".");
    const forged = `${good[0]}.${good[1]}.${Buffer.from("not-the-signature").toString("base64url")}`;
    const result = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}`,
      token: forged,
      city: world.cityId,
      headers: { "x-user-id": world.ownerId, "x-user-role": "admin" },
    });
    expect(result.status).toBe(401);
  });

  it("refuses an expired context", async () => {
    const expired = await tokenFor(world.ownerId, world.cityId, {
      ttlSeconds: -30,
    });
    const result = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}`,
      token: expired,
      city: world.cityId,
    });
    expect(result.status).toBe(401);
  });

  it("refuses a declared city that disagrees with the verified one", async () => {
    const result = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}`,
      token: world.ownerToken,
      city: world.cityId,
      headers: { "x-city-id": "some-other-city" },
    });
    expect(result.status).toBe(403);
    expect((result.body.details as { reason: string }).reason).toBe(
      "city_mismatch",
    );
  });

  it("refuses mirrors that disagree with the context's city", async () => {
    const result = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}`,
      token: world.ownerToken,
      headers: { "x-auth-city-id": "elsewhere", "x-ubi-city-id": "elsewhere" },
    });
    expect(result.status).toBe(403);
  });

  it("in production refuses the plain development headers outright", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const result = await api(h.app, {
        path: `/v1/fleets/${world.fleetId}`,
        headers: {
          "x-user-id": world.ownerId,
          "x-user-role": "rider",
          "x-city-id": world.cityId,
        },
      });
      expect(result.status).toBe(401);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("answers 503 (never trust) when the verification key is unusable", async () => {
    const previous = process.env.UBI_IDENTITY_SECRET;
    const token = world.ownerToken;
    process.env.UBI_IDENTITY_SECRET = "short";
    try {
      const result = await api(h.app, {
        path: `/v1/fleets/${world.fleetId}`,
        token,
        city: world.cityId,
      });
      expect(result.status).toBe(503);
    } finally {
      process.env.UBI_IDENTITY_SECRET = previous;
    }
  });
});

describe("signed scopes are re-checked", () => {
  it("refuses a fleet write without fleet:manage", async () => {
    const token = await tokenFor(world.ownerId, world.cityId, {
      scopes: ["fleet:read"],
    });
    const result = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/off-road`,
      token,
      city: world.cityId,
      body: { vehicleId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("forbidden");
  });

  it("refuses every fleet route in limited mode, reads included", async () => {
    const token = await tokenFor(world.ownerId, world.cityId, {
      modes: ["limited"],
    });
    const result = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}/calendar`,
      token,
      city: world.cityId,
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("limited_mode");
  });

  it("keeps the driver routes to fleet:driver", async () => {
    const token = await tokenFor(world.ownerId, world.cityId, {
      scopes: ["fleet:read", "fleet:manage"],
    });
    const result = await api(h.app, {
      path: "/v1/drivers/me/schedule",
      token,
      city: world.cityId,
    });
    expect(result.status).toBe(403);
  });
});

describe("the deny-by-default fleet flag", () => {
  it("answers an honest 404 feature_disabled on every family when the flag is off", async () => {
    await setFleetFlag(h.db, world.cityId, false);
    const driverToken = await tokenFor(world.ownerId, world.cityId, {
      kind: "driver",
    });
    for (const [method, path, token] of [
      ["GET", `/v1/fleets/${world.fleetId}`, world.ownerToken],
      ["GET", `/v1/fleets/${world.fleetId}/calendar`, world.ownerToken],
      ["GET", "/v1/fleets", world.ownerToken],
      ["POST", "/v1/fleets", world.ownerToken],
      ["GET", "/v1/drivers/me/fleet-offers", driverToken],
      ["GET", "/v1/drivers/me/schedule", driverToken],
      ["POST", "/v1/fleet-offers/fap_x/decline", driverToken],
    ] as const) {
      const result = await api(h.app, {
        method,
        path,
        token,
        city: world.cityId,
        ...(method === "POST" ? { body: { name: "Another fleet" } } : {}),
      });
      expect(result.status, `${method} ${path}`).toBe(404);
      expect(result.body.code, `${method} ${path}`).toBe("feature_disabled");
    }
  });

  it("answers 404 feature_disabled before reading the body, the key or the idempotency record", async () => {
    const driverToken = await tokenFor(world.ownerId, world.cityId, {
      kind: "driver",
    });
    // A key used while the flag was on: with the flag off, neither its replay
    // nor a reuse with another body may answer anything but 404.
    const used = idemKey("flag-on");
    const created = await api(h.app, {
      method: "POST",
      path: "/v1/fleets",
      token: world.ownerToken,
      city: world.cityId,
      body: { name: "Before the flag went off" },
      idem: used,
    });
    expect(created.status).toBe(201);
    await setFleetFlag(h.db, world.cityId, false);
    const calls: {
      method: "POST" | "PUT";
      path: string;
      token: string;
      body: unknown;
      idem: string | null;
    }[] = [
      // An invalid body (no name) and no Idempotency-Key.
      {
        method: "POST",
        path: "/v1/fleets",
        token: world.ownerToken,
        body: {},
        idem: null,
      },
      // The same key: a replay, then a reuse with another body.
      {
        method: "POST",
        path: "/v1/fleets",
        token: world.ownerToken,
        body: { name: "Before the flag went off" },
        idem: used,
      },
      {
        method: "POST",
        path: "/v1/fleets",
        token: world.ownerToken,
        body: { name: "Another body" },
        idem: used,
      },
      // A malformed PIN and no key.
      {
        method: "POST",
        path: "/v1/fleet-offers/fap_x/sign",
        token: driverToken,
        body: { pin: "x" },
        idem: null,
      },
      {
        method: "POST",
        path: "/v1/drivers/me/availability:preview",
        token: driverToken,
        body: { windows: "not-a-list" },
        idem: null,
      },
      {
        method: "PUT",
        path: "/v1/drivers/me/availability",
        token: driverToken,
        body: {},
        idem: null,
      },
      {
        method: "POST",
        path: "/v1/drivers/me/fleet/terminate",
        token: driverToken,
        body: {},
        idem: null,
      },
    ];
    for (const call of calls) {
      const result = await api(h.app, { ...call, city: world.cityId });
      expect(result.status, `${call.method} ${call.path}`).toBe(404);
      expect(result.body.code, `${call.method} ${call.path}`).toBe(
        "feature_disabled",
      );
    }
  });

  it("stays off in a city with no rule at all (deny-by-default)", async () => {
    await h.db.flagRule.delete({
      where: { flagKey_cityId: { flagKey: "fleet", cityId: world.cityId } },
    });
    const result = await api(h.app, {
      path: "/v1/fleets",
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(result.status).toBe(404);
    expect(result.body.code).toBe("feature_disabled");
  });
});

describe("tenancy", () => {
  it("does not disclose a fleet to a user who is not its staff", async () => {
    const other = await seedFleet(h);
    const result = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}/calendar`,
      token: await tokenFor(other.ownerId, world.cityId),
      city: world.cityId,
    });
    expect(result.status).toBe(404);
    expect(result.body.code).toBe("not_found");
  });

  it("does not serve a fleet outside its own city", async () => {
    const other = await seedFleet(h);
    const result = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}`,
      token: await tokenFor(world.ownerId, other.cityId),
      city: other.cityId,
    });
    expect(result.status).toBe(404);
  });
});
