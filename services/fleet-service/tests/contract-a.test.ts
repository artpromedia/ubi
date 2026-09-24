/**
 * INTERNAL CONTRACT A, both directions, against its transcription
 * (tests/fixtures/contract-a.json):
 *  - the contract module (packages/contracts/src/fleet.ts) matches the text;
 *  - fleet-service's REAL ride port calls routes 1-7 exactly as written
 *    (method, path, query, X-Service-Key, Idempotency-Key where required),
 *    against the faithful double, and fails closed without its key;
 *  - fleet-service serves routes 8-9 behind FLEET_SERVICE_KEY with exactly
 *    the documented shapes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addVehicle,
  api,
  closeTestDb,
  resetFleet,
  seedFleet,
  seedUser,
  signedArrangement,
  startHarness,
  type FleetWorld,
  type Harness,
} from "./helpers";
import {
  CONTRACT_A_ROUTES,
  FleetInternalVehicleSchema,
  FleetVehicleAtResponseSchema,
  OCCUPIED_BLOCK_FIELDS,
  OccupiedBlockSchema,
  RideMaintenancePreviewResponseSchema,
  RideOccupancyConflictSchema,
  RideOccupancyCreatedSchema,
  RideOccupancyReleasedSchema,
  RideOffRoadResponseSchema,
  RideSwapIneligibleSchema,
  RideVehicleSwapResponseSchema,
} from "../src/contract";
import {
  createHttpRidePort,
  RideUnavailableError,
} from "../src/ports/ride-port";

interface FixtureRoute {
  n: number;
  key: keyof typeof CONTRACT_A_ROUTES;
  server: string;
  method: string;
  path: string;
  idempotencyKey?: boolean;
  responses: Record<string, unknown>;
}

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, "fixtures/contract-a.json"), "utf8"),
) as {
  auth: { minLength: number };
  occupiedBlock: { fields: string[]; example: unknown };
  routes: FixtureRoute[];
};

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
  await resetFleet(h.db);
});

afterAll(async () => {
  await h.close();
  await closeTestDb();
});

beforeEach(() => {
  h.ride.reset();
  h.pin.reset();
  h.clock.now = new Date("2026-09-28T08:00:00.000Z");
});

describe("the contract module matches the contract text", () => {
  it("names all nine routes with their servers, methods and paths", () => {
    expect(fixture.routes).toHaveLength(9);
    for (const route of fixture.routes) {
      expect(CONTRACT_A_ROUTES[route.key], route.key).toEqual({
        server: route.server,
        method: route.method,
        path: route.path,
      });
    }
  });

  it("defines OccupiedBlock as exactly the eight fields, strictly", () => {
    expect([...OCCUPIED_BLOCK_FIELDS]).toEqual(fixture.occupiedBlock.fields);
    expect(OccupiedBlockSchema.parse(fixture.occupiedBlock.example)).toEqual(
      fixture.occupiedBlock.example,
    );
    expect(
      OccupiedBlockSchema.safeParse({
        ...(fixture.occupiedBlock.example as object),
        riderName: null,
      }).success,
    ).toBe(false);
  });

  it("parses every documented response with the matching schema", () => {
    const byKey = new Map(
      fixture.routes.map((route) => [route.key, route.responses]),
    );
    expect(
      RideMaintenancePreviewResponseSchema.safeParse(
        byKey.get("maintenancePreview")?.["200"],
      ).success,
    ).toBe(true);
    expect(
      RideOccupancyCreatedSchema.safeParse(
        byKey.get("maintenanceCreate")?.["201"],
      ).success,
    ).toBe(true);
    expect(
      RideOccupancyConflictSchema.safeParse(
        byKey.get("maintenanceCreate")?.["409"],
      ).success,
    ).toBe(true);
    expect(
      RideOccupancyReleasedSchema.safeParse(
        byKey.get("maintenanceRelease")?.["200"],
      ).success,
    ).toBe(true);
    expect(
      RideOffRoadResponseSchema.safeParse(byKey.get("offRoad")?.["201"])
        .success,
    ).toBe(true);
    expect(
      RideVehicleSwapResponseSchema.safeParse(byKey.get("vehicleSwap")?.["201"])
        .success,
    ).toBe(true);
    expect(
      RideSwapIneligibleSchema.safeParse(byKey.get("vehicleSwap")?.["422"])
        .success,
    ).toBe(true);
    expect(
      FleetVehicleAtResponseSchema.safeParse(byKey.get("vehicleAt")?.["200"])
        .success,
    ).toBe(true);
    expect(
      FleetInternalVehicleSchema.safeParse(byKey.get("vehicle")?.["200"])
        .success,
    ).toBe(true);
  });
});

describe("fleet-service calls routes 1-7 as written", () => {
  const vehicleId = "5b0c3e4a-8d40-4c1e-9f3b-0f4e7c1a2b3c";

  function port(
    key: string | null = process.env.FLEET_RIDE_SERVICE_KEY ?? null,
  ) {
    return createHttpRidePort({
      baseUrl: h.ride.url,
      serviceKey: key ?? undefined,
    });
  }

  it("sends X-Service-Key everywhere and Idempotency-Key exactly on the state-changing routes", async () => {
    const rides = port();
    h.ride.addBooking({
      driverId: "drv_1",
      vehicleId,
      startsAt: "2026-10-02T10:00:00.000Z",
      endsAt: "2026-10-02T11:00:00.000Z",
    });
    await rides.previewMaintenance({
      vehicleId,
      kind: "repair",
      startsAt: "2026-10-03T09:00:00.000Z",
      endsAt: "2026-10-03T10:00:00.000Z",
    });
    await rides.createMaintenanceOccupancy(
      {
        blockId: "mnt_a",
        vehicleId,
        kind: "repair",
        startsAt: "2026-10-03T09:00:00.000Z",
        endsAt: "2026-10-03T10:00:00.000Z",
      },
      "fleet-maint-a-v1",
    );
    await rides.releaseOccupancy("mnt_a", "fleet-release-a");
    await rides.reportOffRoad(
      {
        blockId: "mnt_b",
        vehicleId,
        startsAt: "2026-10-02T09:30:00.000Z",
        expectedEndsAt: null,
      },
      "fleet-offroad-b",
    );
    await rides.occupiedBlocks({
      vehicleIds: [vehicleId, "veh_x"],
      driverIds: ["drv_1"],
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-05T00:00:00.000Z",
    });
    await rides.driverCalendar(
      "drv_1",
      "2026-10-01T00:00:00.000Z",
      "2026-10-05T00:00:00.000Z",
    );
    await rides.requestVehicleSwap(
      "blk_1",
      { toVehicleId: "veh_2", requestedByStaffId: "usr_1" },
      "fleet-swap-1",
    );

    const seen = h.ride.requests.map((request) => ({
      method: request.method,
      path: request.path.split("?")[0],
      query: request.path.includes("?") ? request.path.split("?")[1] : null,
      key: request.headers["x-service-key"],
      idem: request.headers["idempotency-key"] ?? null,
    }));
    expect(
      seen.every(
        (request) => request.key === process.env.FLEET_RIDE_SERVICE_KEY,
      ),
    ).toBe(true);
    const expected = fixture.routes.filter(
      (route) => route.server === "ride-service",
    );
    for (const route of expected) {
      const pattern = new RegExp(
        `^${route.path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`,
      );
      const call = seen.find(
        (request) =>
          request.method === route.method && pattern.test(request.path ?? ""),
      );
      expect(call, route.key).toBeDefined();
      expect(call?.idem !== null, `${route.key} Idempotency-Key`).toBe(
        route.idempotencyKey === true,
      );
    }
    const blocks = seen.find(
      (request) => request.path === "/internal/fleet/occupancy/blocks",
    );
    const query = new URLSearchParams(blocks?.query ?? "");
    expect(query.get("vehicleIds")).toBe(`${vehicleId},veh_x`);
    expect(query.get("driverIds")).toBe("drv_1");
    expect(query.get("from")).toBe("2026-10-01T00:00:00.000Z");
  });

  it("gets the same answer on a replay and refuses the key with another body", async () => {
    const rides = port();
    const body = {
      blockId: "mnt_c",
      vehicleId,
      kind: "inspection" as const,
      startsAt: "2026-10-04T09:00:00.000Z",
      endsAt: "2026-10-04T10:00:00.000Z",
    };
    const first = await rides.createMaintenanceOccupancy(
      body,
      "fleet-maint-c-v1",
    );
    const again = await rides.createMaintenanceOccupancy(
      body,
      "fleet-maint-c-v1",
    );
    expect(again).toEqual(first);
    await expect(
      rides.createMaintenanceOccupancy(
        { ...body, endsAt: "2026-10-04T11:00:00.000Z" },
        "fleet-maint-c-v1",
      ),
    ).rejects.toBeInstanceOf(RideUnavailableError);
  });

  it("fails closed: no key configured → nothing is sent; a wrong key → refused", async () => {
    await expect(
      port(null).occupiedBlocks({
        vehicleIds: [vehicleId],
        driverIds: [],
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-02T00:00:00Z",
      }),
    ).rejects.toBeInstanceOf(RideUnavailableError);
    expect(h.ride.requests).toHaveLength(0);
    await expect(
      port("w".repeat(fixture.auth.minLength)).occupiedBlocks({
        vehicleIds: [vehicleId],
        driverIds: [],
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-02T00:00:00Z",
      }),
    ).rejects.toBeInstanceOf(RideUnavailableError);
  });

  it("projects every block onto the eight fields even when the other side sends more", async () => {
    h.ride.addBooking({
      driverId: "drv_1",
      vehicleId,
      startsAt: "2026-10-02T10:00:00.000Z",
      endsAt: "2026-10-02T11:00:00.000Z",
    });
    h.ride.leakExtraFields = true;
    const blocks = await port().occupiedBlocks({
      vehicleIds: [vehicleId],
      driverIds: [],
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-05T00:00:00Z",
    });
    expect(Object.keys(blocks[0] ?? {}).sort()).toEqual(
      [...OCCUPIED_BLOCK_FIELDS].sort(),
    );
  });
});

describe("fleet-service serves routes 8-9 behind FLEET_SERVICE_KEY", () => {
  let world: FleetWorld;
  let vehicleId: string;
  let driverId: string;
  let assignmentId: string;

  beforeEach(async () => {
    world = await seedFleet(h);
    vehicleId = await addVehicle(h, world, {
      classes: ["comfort", "go"],
      capacity: 4,
      inspectionExpiry: null,
    });
    driverId = await seedUser(h.db, { driver: true });
    ({ assignmentId } = await signedArrangement(h, world, {
      vehicleId,
      driverId,
      shift: "day",
      validFrom: "2026-09-28",
    }));
  });

  async function internal(
    pathname: string,
    key: string | null = process.env.FLEET_SERVICE_KEY ?? null,
  ) {
    return api(h.app, {
      path: pathname,
      headers: key === null ? {} : { "x-service-key": key },
    });
  }

  it("route 8: the vehicle assigned for the WHOLE interval, else nulls", async () => {
    const inside = await internal(
      `/internal/fleet/drivers/${driverId}/vehicle-at?from=2026-10-01T07:00:00.000Z&to=2026-10-01T09:30:00.000Z`,
    );
    expect(inside.status).toBe(200);
    expect(inside.body).toEqual({
      vehicleId,
      assignmentId,
      vehicleClass: "comfort",
      capacity: 4,
    });
    expect(Object.keys(inside.body).sort()).toEqual([
      "assignmentId",
      "capacity",
      "vehicleClass",
      "vehicleId",
    ]);
    // Crosses the 18:00 local shift end: not covered for the whole interval.
    const crossing = await internal(
      `/internal/fleet/drivers/${driverId}/vehicle-at?from=2026-10-01T16:00:00.000Z&to=2026-10-01T18:00:00.000Z`,
    );
    expect(crossing.body).toEqual({
      vehicleId: null,
      assignmentId: null,
      vehicleClass: null,
      capacity: null,
    });
    const stranger = await internal(
      `/internal/fleet/drivers/nobody/vehicle-at?from=2026-10-01T07:00:00.000Z&to=2026-10-01T08:00:00.000Z`,
    );
    expect(stranger.body).toEqual({
      vehicleId: null,
      assignmentId: null,
      vehicleClass: null,
      capacity: null,
    });
    const bad = await internal(
      `/internal/fleet/drivers/${driverId}/vehicle-at?from=yesterday`,
    );
    expect(bad.status).toBe(422);
  });

  it("route 9: the swap-revalidation facts, exactly", async () => {
    const result = await internal(`/internal/fleet/vehicles/${vehicleId}`);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      vehicleId,
      fleetId: world.fleetId,
      classes: ["comfort", "go"],
      capacity: 4,
      documents: {
        insuranceExpiry: "2027-06-30T00:00:00.000Z",
        inspectionExpiry: null,
      },
    });
    expect(
      (
        await internal(
          "/internal/fleet/vehicles/00000000-0000-0000-0000-000000000000",
        )
      ).status,
    ).toBe(404);
  });

  it("refuses a missing or wrong key (the payment key included) and closes when the key is unset", async () => {
    const target = `/internal/fleet/vehicles/${vehicleId}`;
    expect((await internal(target, null)).status).toBe(401);
    expect((await internal(target, "k".repeat(40))).status).toBe(401);
    expect(
      (await internal(target, process.env.FLEET_PAYMENT_SERVICE_KEY ?? null))
        .status,
    ).toBe(401);
    const previous = process.env.FLEET_SERVICE_KEY;
    process.env.FLEET_SERVICE_KEY = "too-short";
    try {
      expect((await internal(target, "too-short")).status).toBe(503);
    } finally {
      process.env.FLEET_SERVICE_KEY = previous;
    }
  });
});
