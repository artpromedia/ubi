/**
 * Vehicle document expiry (FL-9): warnings at 30/14/7/1 days sent once each,
 * immediately when a booking runs past an expiry, the doc_expired status
 * (status only), renewal settling the conflicts, and conflicts lapsing at
 * their deadline.
 */
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
import { FleetCalendarSchema, FleetVehicleListSchema } from "../src/contract";
import {
  crossedThreshold,
  documentSweep,
  lapseConflicts,
} from "../src/ops/documents";

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
  h.clock.now = new Date("2026-09-28T08:00:00.000Z");
  h.ride.reset();
  h.pin.reset();
  await resetFleet(h.db);
  world = await seedFleet(h);
});

async function warnings(vehicleId: string) {
  return h.db.outboxEvent.findMany({
    where: {
      aggregateId: vehicleId,
      name: { in: ["vehicle.document.expiring", "vehicle.document.expired"] },
    },
    orderBy: { createdAt: "asc" },
  });
}

describe("document expiry warnings", () => {
  it("crosses 30 / 14 / 7 / 1 days", () => {
    const policy = { documentWarningDays: [30, 14, 7, 1] } as never;
    const now = new Date("2026-09-28T08:00:00.000Z");
    const inDays = (days: number) =>
      new Date(now.getTime() + days * 86_400_000);
    expect(crossedThreshold(inDays(40), now, policy)).toBeNull();
    expect(crossedThreshold(inDays(30), now, policy)).toBe(30);
    expect(crossedThreshold(inDays(10), now, policy)).toBe(14);
    expect(crossedThreshold(inDays(7), now, policy)).toBe(7);
    expect(crossedThreshold(inDays(0.5), now, policy)).toBe(1);
    expect(crossedThreshold(inDays(-1), now, policy)).toBeNull();
  });

  it("warns once per threshold and opens one conflict per expiry", async () => {
    const vehicleId = await addVehicle(h, world, {
      insuranceExpiry: new Date("2026-10-08T08:00:00.000Z"),
    });
    await documentSweep(h.deps);
    await documentSweep(h.deps);
    let sent = await warnings(vehicleId);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toMatchObject({
      document: "insurance",
      thresholdDays: 14,
      reason: "threshold",
    });
    expect(sent[0]?.aggregateType).toBe("vehicle");
    h.clock.now = new Date("2026-10-02T08:00:00.000Z");
    await documentSweep(h.deps);
    sent = await warnings(vehicleId);
    expect(
      sent.map(
        (event) => (event.payload as { thresholdDays: number }).thresholdDays,
      ),
    ).toEqual([14, 7]);
    const conflicts = await h.db.fleetConflict.findMany({
      where: { vehicleId, type: "document_expiring" },
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.deadlineAt?.toISOString()).toBe(
      "2026-10-08T08:00:00.000Z",
    );
  });

  it("warns immediately when a booking runs past the expiry, naming the driver's opaque block", async () => {
    const vehicleId = await addVehicle(h, world, {
      inspectionExpiry: new Date("2026-11-20T00:00:00.000Z"),
    });
    const driverId = await seedUser(h.db, { driver: true });
    await signedArrangement(h, world, {
      vehicleId,
      driverId,
      shift: "full",
      validFrom: "2026-09-28",
    });
    const booking = h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-11-20T07:00:00.000Z",
      endsAt: "2026-11-20T09:00:00.000Z",
      decisionDeadline: "2026-11-19T18:00:00.000Z",
    });
    // 53 days out: no threshold yet — the booking alone triggers the warning.
    await documentSweep(h.deps);
    const sent = await warnings(vehicleId);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toMatchObject({
      document: "inspection",
      reason: "booking_after_expiry",
      bookingBlockId: booking.blockId,
    });
    const conflict = await h.db.fleetConflict.findFirstOrThrow({
      where: { vehicleId, type: "document_expires_in_booking" },
    });
    expect(conflict).toMatchObject({
      severity: "high",
      driverId,
      bookingBlockId: booking.blockId,
    });
    expect(conflict.deadlineAt?.toISOString()).toBe("2026-11-19T18:00:00.000Z");
  });

  it("marks an expired vehicle doc_expired (status only) and settles the conflicts once UBI records a renewal", async () => {
    const vehicleId = await addVehicle(h, world, {
      insuranceExpiry: new Date("2026-09-30T00:00:00.000Z"),
    });
    await documentSweep(h.deps);
    h.clock.now = new Date("2026-10-01T08:00:00.000Z");
    await documentSweep(h.deps);
    expect((await warnings(vehicleId)).map((event) => event.name)).toEqual([
      "vehicle.document.expiring",
      "vehicle.document.expired",
    ]);
    const list = FleetVehicleListSchema.parse(
      (
        await api(h.app, {
          path: `/v1/fleets/${world.fleetId}/vehicles`,
          token: world.ownerToken,
          city: world.cityId,
        })
      ).body,
    );
    expect(list.vehicles[0]?.statusNow).toBe("doc_expired");
    const calendar = FleetCalendarSchema.parse(
      (
        await api(h.app, {
          path: `/v1/fleets/${world.fleetId}/calendar`,
          token: world.ownerToken,
          city: world.cityId,
        })
      ).body,
    );
    expect(calendar.rows[0]?.ubiStatus).toEqual({
      subject: "vehicle",
      subjectId: vehicleId,
      status: "doc_expired",
      effectiveFrom: "2026-09-30T00:00:00.000Z",
      effectiveTo: null,
    });

    await h.db.vehicle.update({
      where: { id: vehicleId },
      data: { insuranceExpiry: new Date("2027-09-30T00:00:00.000Z") },
    });
    await documentSweep(h.deps);
    // Nothing to warn about for the new expiry — but the renewal still settles the old conflict.
    const conflicts = await h.db.fleetConflict.findMany({
      where: { vehicleId },
    });
    expect(conflicts.every((conflict) => conflict.status !== "open")).toBe(
      true,
    );
  });

  it("lapses a conflict whose decision deadline passed unresolved", async () => {
    const vehicleId = await addVehicle(h, world, {
      insuranceExpiry: new Date("2026-10-08T08:00:00.000Z"),
    });
    await documentSweep(h.deps);
    h.clock.now = new Date("2026-10-08T08:00:01.000Z");
    expect(await lapseConflicts(h.deps)).toBe(1);
    const conflict = await h.db.fleetConflict.findFirstOrThrow({
      where: { vehicleId },
    });
    expect(conflict.status).toBe("lapsed");
    expect(
      await h.db.outboxEvent.count({
        where: { name: "fleet.conflict.lapsed", aggregateId: conflict.id },
      }),
    ).toBe(1);
    // Both transitions the sweeps made are audited, not only published.
    const audit = await h.db.auditLog.findMany({
      where: { subjectId: conflict.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((row) => row.action)).toEqual([
      "fleet.conflict.opened",
      "fleet.conflict.lapsed",
    ]);
    expect(audit.every((row) => row.actorId === "fleet-service")).toBe(true);
  });
});
