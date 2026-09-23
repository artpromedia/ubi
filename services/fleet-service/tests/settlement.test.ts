/**
 * INTERNAL CONTRACT B — the settlement inputs payment-service reads. Hours
 * from signed shift intervals ∩ the week ∩ maintenance, planned vs
 * unplanned, week boundaries, custom shifts, a mid-week terms change and both
 * DST transitions; plus the service-key door.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addVehicle,
  api,
  closeTestDb,
  idemKey,
  resetFleet,
  seedFleet,
  seedUser,
  setFleetFlag,
  signedArrangement,
  startHarness,
  tokenFor,
  OWNER_TERMS,
  type FleetWorld,
  type Harness,
} from "./helpers";
import {
  SettlementInputsResponseSchema,
  type SettlementInputItem,
} from "../src/contract";

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
  h.pin.reset();
  h.ride.reset();
});

async function inputs(
  cityId: string,
  weekStart: string,
  key: string | null | undefined = process.env.FLEET_PAYMENT_SERVICE_KEY,
) {
  return api(h.app, {
    path: `/internal/fleet/settlement-inputs?weekStart=${weekStart}&cityId=${cityId}`,
    headers: key === null || key === undefined ? {} : { "x-service-key": key },
  });
}

async function itemsFor(
  world: FleetWorld,
  weekStart: string,
): Promise<SettlementInputItem[]> {
  const result = await inputs(world.cityId, weekStart);
  expect(result.status).toBe(200);
  return SettlementInputsResponseSchema.parse(result.body).items;
}

async function block(
  world: FleetWorld,
  vehicleId: string,
  kind: string,
  status: string,
  startsAt: string,
  endsAt: string | null,
): Promise<void> {
  await h.db.fleetMaintenanceBlock.create({
    data: {
      id: idemKey("mnt"),
      fleetId: world.fleetId,
      vehicleId,
      kind,
      startsAt: new Date(startsAt),
      endsAt: endsAt === null ? null : new Date(endsAt),
      zone: "Africa/Lagos",
      status,
      createdBy: world.ownerId,
      createdByRole: "owner",
      idempotencyKey: idemKey("mnt-key"),
    },
  });
}

describe("contract B: shape and door", () => {
  it("answers the documented shape with the signed terms snapshot", async () => {
    h.clock.now = new Date("2026-09-20T08:00:00.000Z");
    const world = await seedFleet(h);
    const vehicleId = await addVehicle(h, world);
    const driverId = await seedUser(h.db, { driver: true });
    const { assignmentId } = await signedArrangement(h, world, {
      vehicleId,
      driverId,
      shift: "full",
      validFrom: "2026-09-21",
    });
    const result = await inputs(world.cityId, "2026-09-28");
    expect(result.status).toBe(200);
    const body = SettlementInputsResponseSchema.parse(result.body);
    expect(body).toMatchObject({
      weekStart: "2026-09-28",
      weekEnd: "2026-10-04",
      zone: "Africa/Lagos",
    });
    expect(body.items).toEqual([
      {
        assignmentId,
        fleetId: world.fleetId,
        driverId,
        vehicleId,
        termsVersion: 1,
        terms: {
          type: "weekly_fixed",
          amountMinor: OWNER_TERMS.amountMinor,
          currency: "NGN",
          percent: null,
          shortfall: { policy: "carry_forward", maxWeeks: 4 },
        },
        shiftHoursInWeek: 168,
        plannedMaintenanceHoursInWeek: 0,
        unplannedOffRoadHoursInWeek: 0,
        activeFrom: "2026-09-20T23:00:00.000Z",
        activeTo: null,
      },
    ]);
    // Switching fleet tools off never strands settlement of signed terms.
    await setFleetFlag(h.db, world.cityId, false);
    const afterFlagOff = await inputs(world.cityId, "2026-09-28");
    expect(afterFlagOff.status).toBe(200);
    expect(
      SettlementInputsResponseSchema.parse(afterFlagOff.body).items,
    ).toHaveLength(1);
    expect((await inputs("no-such-city", "2026-09-28")).status).toBe(404);
  });

  it("needs FLEET_PAYMENT_SERVICE_KEY (constant-time compare; closed when unset) and is not the ride key's door", async () => {
    const world = await seedFleet(h);
    expect((await inputs(world.cityId, "2026-09-28", null)).status).toBe(401);
    expect(
      (await inputs(world.cityId, "2026-09-28", "x".repeat(40))).status,
    ).toBe(401);
    expect(
      (await inputs(world.cityId, "2026-09-28", process.env.FLEET_SERVICE_KEY))
        .status,
    ).toBe(401);
    const previous = process.env.FLEET_PAYMENT_SERVICE_KEY;
    delete process.env.FLEET_PAYMENT_SERVICE_KEY;
    try {
      expect((await inputs(world.cityId, "2026-09-28", previous)).status).toBe(
        503,
      );
    } finally {
      process.env.FLEET_PAYMENT_SERVICE_KEY = previous;
    }
  });

  it("refuses a weekStart that is not a Monday", async () => {
    const world = await seedFleet(h);
    const result = await inputs(world.cityId, "2026-09-29");
    expect(result.status).toBe(422);
  });

  it("is not reachable with a user identity", async () => {
    const world = await seedFleet(h);
    const result = await api(h.app, {
      path: `/internal/fleet/settlement-inputs?weekStart=2026-09-28&cityId=${world.cityId}`,
      token: await tokenFor(world.ownerId, world.cityId),
      city: world.cityId,
    });
    expect(result.status).toBe(401);
  });
});

describe("contract B: hours", () => {
  it("counts named and custom shifts across the week boundary (a night shift's Monday morning, a Sunday night clipped)", async () => {
    h.clock.now = new Date("2026-09-20T08:00:00.000Z");
    const world = await seedFleet(h);
    const day = await signedArrangement(h, world, {
      vehicleId: await addVehicle(h, world),
      driverId: await seedUser(h.db, { driver: true }),
      shift: "day",
      validFrom: "2026-09-21",
    });
    const night = await signedArrangement(h, world, {
      vehicleId: await addVehicle(h, world),
      driverId: await seedUser(h.db, { driver: true }),
      shift: "night",
      validFrom: "2026-09-21",
    });
    const custom = await signedArrangement(h, world, {
      vehicleId: await addVehicle(h, world),
      driverId: await seedUser(h.db, { driver: true }),
      shift: { start: "20:00", end: "04:00" },
      validFrom: "2026-09-30",
      validTo: "2026-10-02",
    });
    const items = await itemsFor(world, "2026-09-28");
    const hours = (id: string) =>
      items.find((item) => item.assignmentId === id)?.shiftHoursInWeek;
    expect(hours(day.assignmentId)).toBe(84);
    // Sun 27 night reaches Mon 00-06 (6) + Mon-Sat nights (6 × 12) + Sun 4 Oct 18-24 (6).
    expect(hours(night.assignmentId)).toBe(84);
    // Instances start Wed 30 Sep and Thu 1 Oct only.
    expect(hours(custom.assignmentId)).toBe(16);
    const customItem = items.find(
      (item) => item.assignmentId === custom.assignmentId,
    );
    expect(customItem?.activeTo).toBe("2026-10-01T23:00:00.000Z");
    // A week outside every validity: no custom item at all.
    const later = await itemsFor(world, "2026-10-05");
    expect(
      later.find((item) => item.assignmentId === custom.assignmentId),
    ).toBeUndefined();
  });

  it("splits planned maintenance from unplanned off-road, inside the signed shift only, never counting an hour twice", async () => {
    h.clock.now = new Date("2026-09-20T08:00:00.000Z");
    const world = await seedFleet(h);
    const vehicleId = await addVehicle(h, world);
    const { assignmentId } = await signedArrangement(h, world, {
      vehicleId,
      driverId: await seedUser(h.db, { driver: true }),
      shift: "day",
      validFrom: "2026-09-21",
    });
    // Tue 09:00-13:00 local: 4 planned hours.
    await block(
      world,
      vehicleId,
      "planned_service",
      "completed",
      "2026-09-29T08:00:00.000Z",
      "2026-09-29T12:00:00.000Z",
    );
    // Night-time inspection: outside the day shift, so 0 shift hours lost.
    await block(
      world,
      vehicleId,
      "inspection",
      "completed",
      "2026-09-29T20:00:00.000Z",
      "2026-09-29T23:00:00.000Z",
    );
    // A cancelled block never held the vehicle.
    await block(
      world,
      vehicleId,
      "repair",
      "cancelled",
      "2026-09-30T08:00:00.000Z",
      "2026-09-30T12:00:00.000Z",
    );
    // Breakdown Thu 16:00 → Fri 10:00 local: 2 h Thu + 4 h Fri of shift.
    await block(
      world,
      vehicleId,
      "unplanned_off_road",
      "completed",
      "2026-10-01T15:00:00.000Z",
      "2026-10-02T09:00:00.000Z",
    );
    // A repair inside the breakdown on Fri 08:00-09:00 local counts as planned only.
    await block(
      world,
      vehicleId,
      "repair",
      "completed",
      "2026-10-02T07:00:00.000Z",
      "2026-10-02T08:00:00.000Z",
    );
    const item = (await itemsFor(world, "2026-09-28")).find(
      (entry) => entry.assignmentId === assignmentId,
    );
    expect(item?.shiftHoursInWeek).toBe(84);
    expect(item?.plannedMaintenanceHoursInWeek).toBe(5);
    expect(item?.unplannedOffRoadHoursInWeek).toBe(5);
  });

  it("gives a mid-week terms change two items, each with the terms signed for its part", async () => {
    h.clock.now = new Date("2026-09-20T08:00:00.000Z");
    const world = await seedFleet(h);
    const vehicleId = await addVehicle(h, world);
    const driverId = await seedUser(h.db, { driver: true });
    const first = await signedArrangement(h, world, {
      vehicleId,
      driverId,
      shift: "day",
      validFrom: "2026-09-21",
    });
    const proposal = await api<{ proposalId: string }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/assignments/propose`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        vehicleId,
        driverId,
        shift: "day",
        validFrom: "2026-10-01",
        terms: {
          type: "percent_of_net",
          percent: 30,
          shortfall: { policy: "carry_forward", maxWeeks: 2 },
          fuelBy: "driver",
          servicingBy: "fleet",
        },
      },
    });
    expect(proposal.status).toBe(201);
    const signed = await api<{ arrangement: { assignmentId: string } }>(h.app, {
      method: "POST",
      path: `/v1/fleet-offers/${proposal.body.proposalId}/sign`,
      token: await tokenFor(driverId, world.cityId, { kind: "driver" }),
      city: world.cityId,
      body: { pin: "4321" },
    });
    expect(signed.status).toBe(200);
    const items = await itemsFor(world, "2026-09-28");
    const before = items.find(
      (item) => item.assignmentId === first.assignmentId,
    );
    const after = items.find(
      (item) => item.assignmentId === signed.body.arrangement.assignmentId,
    );
    expect(before).toMatchObject({
      termsVersion: 1,
      shiftHoursInWeek: 36,
      activeTo: "2026-09-30T23:00:00.000Z",
    });
    expect(before?.terms.type).toBe("weekly_fixed");
    expect(after).toMatchObject({
      termsVersion: 2,
      shiftHoursInWeek: 48,
      activeFrom: "2026-09-30T23:00:00.000Z",
      activeTo: null,
    });
    expect(after?.terms).toEqual({
      type: "percent_of_net",
      amountMinor: null,
      currency: "NGN",
      percent: 30,
      shortfall: { policy: "carry_forward", maxWeeks: 2 },
    });
    // The earlier week is untouched by the later change (never retroactive).
    const previous = await itemsFor(world, "2026-09-21");
    expect(previous.filter((item) => item.driverId === driverId)).toHaveLength(
      1,
    );
    expect(
      previous.find((item) => item.driverId === driverId)?.termsVersion,
    ).toBe(1);
  });

  it("counts real hours on DST weeks: 169 when clocks fall back, 167 when they spring forward", async () => {
    h.clock.now = new Date("2026-10-01T08:00:00.000Z");
    const world = await seedFleet(h, { timezone: "Europe/London" });
    const full = await signedArrangement(h, world, {
      vehicleId: await addVehicle(h, world),
      driverId: await seedUser(h.db, { driver: true }),
      shift: "full",
      validFrom: "2026-10-12",
    });
    const night = await signedArrangement(h, world, {
      vehicleId: await addVehicle(h, world),
      driverId: await seedUser(h.db, { driver: true }),
      shift: "night",
      validFrom: "2026-10-12",
    });
    const fallBack = await inputs(world.cityId, "2026-10-19");
    const body = SettlementInputsResponseSchema.parse(fallBack.body);
    expect(body.zone).toBe("Europe/London");
    expect(
      body.items.find((item) => item.assignmentId === full.assignmentId)
        ?.shiftHoursInWeek,
    ).toBe(169);
    // The night of Sat 24 → Sun 25 Oct is 13 real hours.
    expect(
      body.items.find((item) => item.assignmentId === night.assignmentId)
        ?.shiftHoursInWeek,
    ).toBe(85);
    const springForward = SettlementInputsResponseSchema.parse(
      (await inputs(world.cityId, "2027-03-22")).body,
    );
    expect(
      springForward.items.find(
        (item) => item.assignmentId === full.assignmentId,
      )?.shiftHoursInWeek,
    ).toBe(167);
  });
});
