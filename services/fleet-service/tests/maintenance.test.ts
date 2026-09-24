/**
 * Maintenance preview / confirm / 409 / move / cancel, off-road reports and
 * their abuse control, the server clock and vehicle swaps — all through the
 * REAL ride port against the faithful contract A double.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addStaff,
  addVehicle,
  api,
  closeTestDb,
  idemKey,
  resetFleet,
  seedFleet,
  seedUser,
  signedArrangement,
  startHarness,
  type FleetWorld,
  type Harness,
} from "./helpers";
import {
  MaintenancePreviewViewSchema,
  NeedsResolutionDetailsSchema,
  OCCUPIED_BLOCK_FIELDS,
  OffRoadViewSchema,
} from "../src/contract";
import {
  advanceMaintenanceClock,
  checkOffRoadIntegrity,
} from "../src/ops/maintenance";

let h: Harness;
let world: FleetWorld;
let vehicleId: string;
let driverId: string;

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
  world = await seedFleet(h);
  vehicleId = await addVehicle(h, world, {
    classes: ["go", "comfort"],
    capacity: 4,
  });
  driverId = await seedUser(h.db, {
    driver: true,
    firstName: "Kemi",
    lastName: "Bello",
  });
  await signedArrangement(h, world, {
    vehicleId,
    driverId,
    shift: "day",
    validFrom: "2026-09-28",
  });
});

const WINDOW = {
  kind: "planned_service",
  startsAt: "2026-10-02T09:00:00.000Z",
  endsAt: "2026-10-02T13:00:00.000Z",
} as const;

async function preview(
  token = world.ownerToken,
  window: Record<string, unknown> = WINDOW,
) {
  return api(h.app, {
    method: "POST",
    path: `/v1/fleets/${world.fleetId}/maintenance:preview`,
    token,
    city: world.cityId,
    body: { vehicleId, ...window },
    idem: null,
  });
}

async function create(
  previewToken: string,
  key = idemKey("mnt"),
  window: Record<string, unknown> = WINDOW,
  token = world.ownerToken,
) {
  return api(h.app, {
    method: "POST",
    path: `/v1/fleets/${world.fleetId}/maintenance`,
    token,
    city: world.cityId,
    body: { vehicleId, ...window, previewToken },
    idem: key,
  });
}

describe("planned maintenance", () => {
  it("previews a free window (the signed shift that loses hours included) and confirms it: scheduled on the ledger", async () => {
    const result = await preview();
    expect(result.status).toBe(200);
    const view = MaintenancePreviewViewSchema.parse(result.body);
    expect(view.feasible).toBe(true);
    expect(view.affectedBlocks).toEqual([]);
    expect(view.affectedAssignments).toHaveLength(1);
    expect(view.affectedAssignments[0]?.driverDisplayName).toBe("Kemi B.");
    expect(view.affectedAssignments[0]?.lostInterval).toEqual({
      startsAt: WINDOW.startsAt,
      endsAt: WINDOW.endsAt,
    });

    const confirmed = await create(view.previewToken);
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.status).toBe("scheduled");
    expect(h.ride.occupancies).toHaveLength(1);
    const call = h.ride.requests.find(
      (request) => request.path === "/internal/fleet/occupancy/maintenance",
    );
    expect(call?.headers["x-service-key"]).toBe(
      process.env.FLEET_RIDE_SERVICE_KEY,
    );
    expect(call?.headers["idempotency-key"]).toMatch(/^fleet-maint-mnt_/);
    const events = await h.db.outboxEvent.findMany({
      where: { aggregateId: String(confirmed.body.blockId) },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => (event.payload as { to: string }).to)).toEqual(
      ["checking", "scheduled"],
    );
    expect(
      events.every(
        (event) =>
          event.aggregateType === "maintenance_block" &&
          event.idempotencyKey.length <= 64,
      ),
    ).toBe(true);
  });

  it("shows an overlapped booking as an opaque block, suggests move / swap / ask-driver, and refuses the confirm with 409", async () => {
    const booking = h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-10-02T10:00:00.000Z",
      endsAt: "2026-10-02T11:30:00.000Z",
      decisionDeadline: "2026-10-01T18:00:00.000Z",
    });
    const small = await addVehicle(h, world, {
      classes: ["go", "comfort"],
      capacity: 2,
    });
    const eligible = await addVehicle(h, world, {
      classes: ["go", "comfort", "xl"],
      capacity: 6,
    });

    const result = await preview();
    const view = MaintenancePreviewViewSchema.parse(result.body);
    expect(view.feasible).toBe(false);
    expect(view.affectedBlocks).toHaveLength(1);
    expect(Object.keys(view.affectedBlocks[0] ?? {}).sort()).toEqual(
      [...OCCUPIED_BLOCK_FIELDS].sort(),
    );
    const move = view.suggestions.find(
      (suggestion) => suggestion.kind === "move",
    );
    expect(move).toEqual({
      kind: "move",
      startsAt: "2026-10-02T11:30:00.000Z",
      endsAt: "2026-10-02T15:30:00.000Z",
    });
    const swap = view.suggestions.find(
      (suggestion) => suggestion.kind === "swap",
    );
    expect(
      swap?.kind === "swap"
        ? swap.candidates.find((c) => c.vehicleId === small)?.reasons
        : null,
    ).toEqual(["capacity_too_small"]);
    expect(
      swap?.kind === "swap"
        ? swap.candidates.find((c) => c.vehicleId === eligible)?.eligible
        : null,
    ).toBe(true);
    expect(
      view.suggestions.some((suggestion) => suggestion.kind === "ask_driver"),
    ).toBe(true);

    const key = idemKey("mnt-409");
    const refused = await create(view.previewToken, key);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("needs_resolution");
    const details = NeedsResolutionDetailsSchema.parse(refused.body.details);
    expect(details.block.status).toBe("needs_resolution");
    expect(details.affectedBlocks.map((block) => block.blockId)).toEqual([
      booking.blockId,
    ]);
    expect(h.ride.occupancies).toHaveLength(0);
    const conflicts = await h.db.fleetConflict.findMany({
      where: { maintenanceBlockId: details.block.blockId },
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      type: "maintenance_overlaps_booking",
      severity: "critical",
      driverId,
      status: "open",
    });
    expect(conflicts[0]?.deadlineAt?.toISOString()).toBe(
      "2026-10-01T18:00:00.000Z",
    );

    // Replay: the same answer, no second block.
    const again = await create(view.previewToken, key);
    expect(again.status).toBe(409);
    expect(
      await h.db.fleetMaintenanceBlock.count({ where: { vehicleId } }),
    ).toBe(1);

    // The booking itself is untouched: planned maintenance never cancels one.
    expect(booking.state).toBe("confirmed");
    expect(booking.risk).toBe("ok");

    // Move the block to the server's next free window: scheduled, conflict resolved.
    const moved = await api(h.app, {
      method: "PATCH",
      path: `/v1/fleets/${world.fleetId}/maintenance/${details.block.blockId}`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        startsAt: "2026-10-02T11:30:00.000Z",
        endsAt: "2026-10-02T15:30:00.000Z",
        previewToken: MaintenancePreviewViewSchema.parse(
          (
            await preview(world.ownerToken, {
              ...WINDOW,
              startsAt: "2026-10-02T11:30:00.000Z",
              endsAt: "2026-10-02T15:30:00.000Z",
            })
          ).body,
        ).previewToken,
      },
    });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe("scheduled");
    const after = await h.db.fleetConflict.findMany({
      where: { maintenanceBlockId: details.block.blockId },
    });
    expect(after.every((conflict) => conflict.status === "resolved")).toBe(
      true,
    );
  });

  it("keeps an open conflict for every booking a moved block still overlaps, and settles the ones it no longer does", async () => {
    const first = h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-10-02T09:30:00.000Z",
      endsAt: "2026-10-02T10:30:00.000Z",
      decisionDeadline: "2026-10-01T18:00:00.000Z",
    });
    const second = h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-10-02T12:00:00.000Z",
      endsAt: "2026-10-02T13:30:00.000Z",
      decisionDeadline: "2026-10-01T20:00:00.000Z",
    });
    const view = MaintenancePreviewViewSchema.parse((await preview()).body);
    const refused = await create(view.previewToken);
    expect(refused.status).toBe(409);
    const blockId = NeedsResolutionDetailsSchema.parse(refused.body.details)
      .block.blockId;
    const openFor = async () =>
      (
        await h.db.fleetConflict.findMany({
          where: { maintenanceBlockId: blockId, status: "open" },
        })
      )
        .map((conflict) => conflict.bookingBlockId)
        .sort();
    expect(await openFor()).toEqual([first.blockId, second.blockId].sort());

    // Moved to 11:00-15:00: clear of the first booking, still over the second.
    const moved = {
      startsAt: "2026-10-02T11:00:00.000Z",
      endsAt: "2026-10-02T15:00:00.000Z",
    };
    const patch = async (key: string) =>
      api(h.app, {
        method: "PATCH",
        path: `/v1/fleets/${world.fleetId}/maintenance/${blockId}`,
        token: world.ownerToken,
        city: world.cityId,
        body: {
          ...moved,
          previewToken: MaintenancePreviewViewSchema.parse(
            (await preview(world.ownerToken, { ...WINDOW, ...moved })).body,
          ).previewToken,
        },
        idem: key,
      });
    const key = idemKey("move-still-over");
    const still = await patch(key);
    expect(still.status).toBe(409);
    expect(still.body.code).toBe("needs_resolution");
    const details = NeedsResolutionDetailsSchema.parse(still.body.details);
    expect(details.affectedBlocks.map((block) => block.blockId)).toEqual([
      second.blockId,
    ]);
    expect(details.conflictIds).toHaveLength(1);
    // The conflict centre still shows the unresolved overlap.
    expect(await openFor()).toEqual([second.blockId]);
    const centre = await api<{
      conflicts: { conflictId: string; status: string }[];
    }>(h.app, {
      path: `/v1/fleets/${world.fleetId}/conflicts?status=open`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(centre.body.conflicts.map((c) => c.conflictId)).toEqual(
      details.conflictIds,
    );
    // A replay of the same move lands on the same open conflict.
    const replay = await patch(key);
    expect(replay.status).toBe(409);
    expect(
      NeedsResolutionDetailsSchema.parse(replay.body.details).conflictIds,
    ).toEqual(details.conflictIds);
    expect(await openFor()).toEqual([second.blockId]);

    // A re-check at the same window keeps the same conflict, never a duplicate.
    const recheck = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/maintenance/${blockId}/confirm`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        previewToken: MaintenancePreviewViewSchema.parse(
          (await preview(world.ownerToken, { ...WINDOW, ...moved })).body,
        ).previewToken,
      },
    });
    expect(recheck.status).toBe(409);
    expect(
      NeedsResolutionDetailsSchema.parse(recheck.body.details).conflictIds,
    ).toEqual(details.conflictIds);
    expect(
      await h.db.fleetConflict.count({
        where: {
          maintenanceBlockId: blockId,
          bookingBlockId: second.blockId,
          status: { in: ["open", "resolving"] },
        },
      }),
    ).toBe(1);
  });

  it("refuses a confirm that does not match the previewed window (409 preview_stale)", async () => {
    const view = MaintenancePreviewViewSchema.parse((await preview()).body);
    const result = await create(view.previewToken, idemKey("stale"), {
      ...WINDOW,
      endsAt: "2026-10-02T14:00:00.000Z",
    });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("preview_stale");
  });

  it("cancels a scheduled block and gives the vehicle back on the ledger", async () => {
    const view = MaintenancePreviewViewSchema.parse((await preview()).body);
    const created = await create(view.previewToken);
    const cancelled = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/maintenance/${String(created.body.blockId)}/cancel`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    expect(h.ride.occupancies[0]?.released).toBe(true);
  });

  it("lets a manager create maintenance but not read-only staff", async () => {
    const manager = await addStaff(h, world, "manager");
    const readOnly = await addStaff(h, world, "read_only");
    const view = MaintenancePreviewViewSchema.parse(
      (await preview(manager.token)).body,
    );
    expect(
      (await create(view.previewToken, idemKey("mgr"), WINDOW, manager.token))
        .status,
    ).toBe(201);
    const refused = await preview(readOnly.token);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("forbidden");
  });

  it("answers 503 and moves nothing past what ride-service confirmed when it is down; a replay then completes", async () => {
    const view = MaintenancePreviewViewSchema.parse((await preview()).body);
    h.ride.down = true;
    const key = idemKey("down");
    const failed = await create(view.previewToken, key);
    expect(failed.status).toBe(503);
    const block = await h.db.fleetMaintenanceBlock.findFirstOrThrow({
      where: { vehicleId },
    });
    expect(block.status).toBe("checking");
    h.ride.down = false;
    const replay = await create(view.previewToken, key);
    expect(replay.status).toBe(201);
    expect(replay.body.status).toBe("scheduled");
  });

  it("runs the server clock: scheduled → active → completed", async () => {
    const view = MaintenancePreviewViewSchema.parse((await preview()).body);
    const created = await create(view.previewToken);
    h.clock.now = new Date("2026-10-02T10:00:00.000Z");
    expect(await advanceMaintenanceClock(h.deps)).toBeGreaterThanOrEqual(1);
    expect(
      (
        await h.db.fleetMaintenanceBlock.findUniqueOrThrow({
          where: { id: String(created.body.blockId) },
        })
      ).status,
    ).toBe("active");
    h.clock.now = new Date("2026-10-02T13:00:00.000Z");
    expect(await advanceMaintenanceClock(h.deps)).toBeGreaterThanOrEqual(1);
    expect(
      (
        await h.db.fleetMaintenanceBlock.findUniqueOrThrow({
          where: { id: String(created.body.blockId) },
        })
      ).status,
    ).toBe("completed");
    // The server clock's transitions are audited as well as published.
    const audit = await h.db.auditLog.findMany({
      where: { subjectId: String(created.body.blockId) },
      orderBy: { createdAt: "asc" },
    });
    expect(
      audit
        .filter((row) => row.actorId === "fleet-service")
        .map((row) => row.action),
    ).toEqual(["fleet.maintenance.active", "fleet.maintenance.completed"]);
  });
});

describe("report off-road", () => {
  it("takes effect immediately, puts overlapping bookings at risk (never cancels), audits, and opens critical conflicts", async () => {
    const booking = h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-28T12:00:00.000Z",
      endsAt: "2026-09-28T13:30:00.000Z",
      windowStart: "2026-09-28T12:15:00.000Z",
      windowEnd: "2026-09-28T12:25:00.000Z",
    });
    const result = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/off-road`,
      token: world.ownerToken,
      city: world.cityId,
      body: { vehicleId, expectedEndsAt: "2026-09-29T08:00:00.000Z" },
    });
    expect(result.status).toBe(201);
    const view = OffRoadViewSchema.parse(result.body);
    expect(view.block.kind).toBe("unplanned_off_road");
    expect(view.block.status).toBe("active");
    expect(view.atRiskBookings).toEqual([
      {
        blockId: booking.blockId,
        decisionDeadline: "2026-09-28T11:45:00.000Z",
      },
    ]);
    expect(booking.risk).toBe("at_risk");
    expect(booking.state).toBe("confirmed");
    const conflict = await h.db.fleetConflict.findFirstOrThrow({
      where: { maintenanceBlockId: view.block.blockId },
    });
    expect(conflict).toMatchObject({
      type: "unplanned_off_road",
      severity: "critical",
      driverId,
      bookingBlockId: booking.blockId,
    });
    const audit = await h.db.auditLog.findMany({
      where: { subjectId: view.block.blockId },
    });
    expect(audit.map((row) => row.action)).toContain("fleet.off_road.reported");
    const reported = await h.db.outboxEvent.findFirst({
      where: {
        name: "fleet.offroad.reported",
        aggregateId: view.block.blockId,
      },
    });
    expect(reported?.actorId).toBe(world.ownerId);
  });

  it("is owner/manager only", async () => {
    const readOnly = await addStaff(h, world, "read_only");
    const result = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/off-road`,
      token: readOnly.token,
      city: world.cityId,
      body: { vehicleId },
    });
    expect(result.status).toBe(403);
  });

  it("is flagged for UBI ops when the vehicle is on a trip during the claimed breakdown", async () => {
    const reported = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/off-road`,
      token: world.ownerToken,
      city: world.cityId,
      body: { vehicleId },
    });
    expect(reported.status).toBe(201);
    expect(await checkOffRoadIntegrity(h.deps)).toBe(0);
    h.ride.addBooking({
      driverId,
      vehicleId,
      kind: "on_trip",
      state: "activated",
      startsAt: "2026-09-28T08:30:00.000Z",
      endsAt: "2026-09-28T09:10:00.000Z",
    });
    h.clock.now = new Date("2026-09-28T09:00:00.000Z");
    expect(await checkOffRoadIntegrity(h.deps)).toBe(1);
    expect(await checkOffRoadIntegrity(h.deps)).toBe(0);
    const blockId = (reported.body as { block: { blockId: string } }).block
      .blockId;
    const flagged = await h.db.outboxEvent.findFirstOrThrow({
      where: { name: "fleet.offroad.flagged", aggregateId: blockId },
    });
    expect((flagged.payload as { reason: string }).reason).toBe(
      "vehicle_on_trip_during_off_road",
    );
    const list = await api<{
      blocks: { blockId: string; offRoadFlagged: boolean }[];
    }>(h.app, {
      path: `/v1/fleets/${world.fleetId}/maintenance?vehicleId=${vehicleId}`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(
      list.body.blocks.find((block) => block.blockId === blockId)
        ?.offRoadFlagged,
    ).toBe(true);
  });

  it("is flagged when the assigned driver is online during the claimed breakdown", async () => {
    await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/off-road`,
      token: world.ownerToken,
      city: world.cityId,
      body: { vehicleId },
    });
    await h.db.driver.update({
      where: { userId: driverId },
      data: { isOnline: true },
    });
    h.clock.now = new Date("2026-09-28T08:30:00.000Z");
    expect(await checkOffRoadIntegrity(h.deps)).toBe(1);
  });

  it("completes when the vehicle is back: released on the ledger, conflicts resolved", async () => {
    h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-28T12:00:00.000Z",
      endsAt: "2026-09-28T13:00:00.000Z",
    });
    const reported = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/off-road`,
      token: world.ownerToken,
      city: world.cityId,
      body: { vehicleId },
    });
    const blockId = (reported.body as { block: { blockId: string } }).block
      .blockId;
    h.clock.now = new Date("2026-09-28T10:00:00.000Z");
    const done = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/maintenance/${blockId}/complete`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("completed");
    expect(done.body.endsAt).toBe("2026-09-28T10:00:00.000Z");
    expect(
      h.ride.occupancies.find((o) => o.blockId === blockId)?.released,
    ).toBe(true);
    const conflicts = await h.db.fleetConflict.findMany({
      where: { maintenanceBlockId: blockId },
    });
    expect(conflicts.every((conflict) => conflict.status === "resolved")).toBe(
      true,
    );
  });
});

describe("vehicle swaps (contract A route 7)", () => {
  it("requests a swap for one of the fleet's bookings; the rider's consent stays ride-service's", async () => {
    const booking = h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-10-03T08:00:00.000Z",
      endsAt: "2026-10-03T09:30:00.000Z",
    });
    const target = await addVehicle(h, world, {
      classes: ["go", "comfort"],
      capacity: 4,
    });
    const result = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/bookings/${booking.blockId}/vehicle-swaps`,
      token: world.ownerToken,
      city: world.cityId,
      body: { toVehicleId: target },
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      status: "proposed",
      fromVehicleId: vehicleId,
      toVehicleId: target,
    });
    const call = h.ride.requests.find((request) =>
      request.path.endsWith("/vehicle-swaps"),
    );
    expect(call?.body).toEqual({
      toVehicleId: target,
      requestedByStaffId: world.ownerId,
    });
  });

  it("pre-checks eligibility in ride-service's vocabulary and passes ride-service's refusal through", async () => {
    const booking = h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-10-03T08:00:00.000Z",
      endsAt: "2026-10-03T09:30:00.000Z",
    });
    const tooSmall = await addVehicle(h, world, {
      classes: ["go"],
      capacity: 2,
    });
    const refused = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/bookings/${booking.blockId}/vehicle-swaps`,
      token: world.ownerToken,
      city: world.cityId,
      body: { toVehicleId: tooSmall },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("swap_ineligible");
    expect((refused.body.details as { reasons: string[] }).reasons).toEqual([
      "class_not_eligible",
      "capacity_too_small",
    ]);

    const fine = await addVehicle(h, world, {
      classes: ["go", "comfort"],
      capacity: 4,
    });
    h.ride.swapIneligible = ["swap_already_open"];
    const rideRefused = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/bookings/${booking.blockId}/vehicle-swaps`,
      token: world.ownerToken,
      city: world.cityId,
      body: { toVehicleId: fine },
    });
    expect(rideRefused.status).toBe(422);
    expect((rideRefused.body.details as { reasons: string[] }).reasons).toEqual(
      ["swap_already_open"],
    );
  });

  it("does not reach a booking that is not the fleet's", async () => {
    const stranger = await seedUser(h.db, { driver: true });
    const booking = h.ride.addBooking({
      driverId: stranger,
      vehicleId: null,
      startsAt: "2026-10-03T08:00:00.000Z",
      endsAt: "2026-10-03T09:30:00.000Z",
    });
    const target = await addVehicle(h, world);
    const result = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/bookings/${booking.blockId}/vehicle-swaps`,
      token: world.ownerToken,
      city: world.cityId,
      body: { toVehicleId: target },
    });
    expect(result.status).toBe(404);
  });
});
