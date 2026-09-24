/**
 * The driver's vehicle-problem report (handoff C5, decisions Q5 / Q8 /
 * correction 4) — POST /v1/drivers/me/vehicle-issues — through the REAL ride
 * port against the faithful contract A double, like the owner/manager
 * off-road tests in maintenance.test.ts: who may report, the active off-road
 * block on ride-service's ledger (bookings at risk, never cancelled), the
 * fleet alert, the audit trail, the abuse sweep, idempotent replay, the flag,
 * and remittance hours that are never pro-rated for a breakdown.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { envelopeFromRow, type RawOutboxRow } from "@ubi/outbox";

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
  type FleetWorld,
  type Harness,
} from "./helpers";
import {
  FLEET_FORBIDDEN_FIELD_PATTERNS,
  SettlementInputsResponseSchema,
} from "../src/contract";
import { checkOffRoadIntegrity } from "../src/ops/maintenance";
import {
  VehicleIssueViewSchema,
  type VehicleIssueView,
} from "../src/vehicle-issue-contract";

let h: Harness;
let world: FleetWorld;
let vehicleId: string;
let driverId: string;
let driverToken: string;

const PATH = "/v1/drivers/me/vehicle-issues";
const OFF_ROAD_ROUTE = "/internal/fleet/occupancy/off-road";

beforeAll(async () => {
  h = await startHarness();
  await resetFleet(h.db);
});

afterAll(async () => {
  await h.close();
  await closeTestDb();
});

beforeEach(async () => {
  // Monday 28 Sep 2026, 09:00 in Lagos — inside the day shift.
  h.clock.now = new Date("2026-09-28T08:00:00.000Z");
  h.ride.reset();
  h.pin.reset();
  world = await seedFleet(h);
  vehicleId = await addVehicle(h, world, { classes: ["go"], capacity: 4 });
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
  driverToken = await tokenFor(driverId, world.cityId, { kind: "driver" });
});

async function report(
  body: Record<string, unknown>,
  options: { token?: string; idem?: string | null } = {},
) {
  return api(h.app, {
    method: "POST",
    path: PATH,
    token: options.token ?? driverToken,
    city: world.cityId,
    body,
    ...(options.idem === undefined ? {} : { idem: options.idem }),
  });
}

function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      out.push(key);
      keysOf(entry, out);
    }
  }
  return out;
}

describe("cannot_drive: the assigned driver reports a breakdown", () => {
  it("takes effect immediately on ride-service's ledger, puts the driver's booking at risk (never cancels), alerts the fleet and audits", async () => {
    const booking = h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-28T12:00:00.000Z",
      endsAt: "2026-09-28T13:30:00.000Z",
      windowStart: "2026-09-28T12:15:00.000Z",
      windowEnd: "2026-09-28T12:25:00.000Z",
    });
    const result = await report({
      vehicleId,
      severity: "cannot_drive",
      note: "Engine won't start",
    });
    expect(result.status).toBe(201);
    const view = VehicleIssueViewSchema.parse(result.body);
    expect(view).toMatchObject({
      severity: "cannot_drive",
      vehicleId,
      reportedAt: "2026-09-28T08:00:00.000Z",
      fleetAlerted: true,
      remittanceEffect: "signed_terms_shortfall_rule",
      block: {
        kind: "unplanned_off_road",
        status: "active",
        startsAt: "2026-09-28T08:00:00.000Z",
        endsAt: null,
      },
    });
    // The booking is at risk with ride-service's deadline — still confirmed.
    expect(booking.risk).toBe("at_risk");
    expect(booking.state).toBe("confirmed");
    expect(view.decisions).toHaveLength(1);
    expect(view.decisions[0]?.deadlineAt).toBe("2026-09-28T11:45:00.000Z");

    // The block is the same kind of row an owner's report creates, but the
    // driver's: created by them, in the driver capacity, holding their note.
    const block = await h.db.fleetMaintenanceBlock.findUniqueOrThrow({
      where: { id: view.block?.blockId ?? "" },
    });
    expect(block).toMatchObject({
      fleetId: world.fleetId,
      vehicleId,
      kind: "unplanned_off_road",
      status: "active",
      createdBy: driverId,
      createdByRole: "driver",
      note: "Engine won't start",
    });
    expect(block.occupancyId).not.toBeNull();

    // Recorded through contract A route 4, keyed by the block.
    const offRoad = h.ride.requests.filter(
      (request) => request.path === OFF_ROAD_ROUTE,
    );
    expect(offRoad).toHaveLength(1);
    expect(offRoad[0]?.body).toEqual({
      blockId: block.id,
      vehicleId,
      startsAt: "2026-09-28T08:00:00.000Z",
      expectedEndsAt: null,
    });
    expect(offRoad[0]?.headers["idempotency-key"]).toBe(
      `fleet-offroad-${block.id}`,
    );

    const conflict = await h.db.fleetConflict.findUniqueOrThrow({
      where: { id: view.decisions[0]?.conflictId ?? "" },
    });
    expect(conflict).toMatchObject({
      type: "unplanned_off_road",
      severity: "critical",
      driverId,
      maintenanceBlockId: block.id,
      bookingBlockId: booking.blockId,
      status: "open",
    });

    const audits = await h.db.auditLog.findMany({
      where: { subjectId: block.id },
    });
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "fleet.off_road.reported",
        "fleet.vehicle_issue.reported",
        "fleet.off_road.recorded",
      ]),
    );
    const reportedAudit = audits.find(
      (row) => row.action === "fleet.off_road.reported",
    );
    expect(reportedAudit?.actorId).toBe(driverId);
    expect((reportedAudit?.after as { role: string }).role).toBe("driver");

    const reported = await h.db.outboxEvent.findFirstOrThrow({
      where: { name: "fleet.offroad.reported", aggregateId: block.id },
    });
    expect(reported.actorId).toBe(driverId);
    expect(reported.actorType).toBe("driver");
    expect(reported.payload).toMatchObject({
      reportedBy: driverId,
      reportedByRole: "driver",
      expectedEndsAt: null,
    });
    const alert = await h.db.outboxEvent.findFirstOrThrow({
      where: { name: "fleet.alert", aggregateId: vehicleId },
    });
    expect(alert.aggregateType).toBe("vehicle");
    expect(alert.actorType).toBe("driver");
    expect(alert.payload).toMatchObject({
      alertType: "vehicle_issue_reported",
      issueId: view.issueId,
      severity: "cannot_drive",
      fleetId: world.fleetId,
      vehicleId,
      driverId,
      blockId: block.id,
      fleetAction: "vehicle_off_road",
      hasNote: true,
    });
    // The note is on the block the fleet reads — never in an event.
    expect(JSON.stringify(alert.payload)).not.toContain("Engine");
    expect(JSON.stringify(reported.payload)).not.toContain("Engine");

    // The fleet sees it on its maintenance list, note included.
    const list = await api<{
      blocks: { blockId: string; kind: string; note: string | null }[];
    }>(h.app, {
      path: `/v1/fleets/${world.fleetId}/maintenance?vehicleId=${vehicleId}`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(list.body.blocks).toContainEqual(
      expect.objectContaining({
        blockId: block.id,
        kind: "unplanned_off_road",
        note: "Engine won't start",
      }),
    );
  });

  it("answers only the reporting driver's own decisions, never another driver's booking on the same vehicle", async () => {
    const nightDriver = await seedUser(h.db, {
      driver: true,
      firstName: "Musa",
      lastName: "Idris",
    });
    await signedArrangement(h, world, {
      vehicleId,
      driverId: nightDriver,
      shift: "night",
      validFrom: "2026-09-28",
    });
    h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-28T12:00:00.000Z",
      endsAt: "2026-09-28T13:00:00.000Z",
    });
    const theirs = h.ride.addBooking({
      driverId: nightDriver,
      vehicleId,
      startsAt: "2026-09-28T19:00:00.000Z",
      endsAt: "2026-09-28T20:00:00.000Z",
      windowStart: "2026-09-28T19:15:00.000Z",
      windowEnd: "2026-09-28T19:25:00.000Z",
    });
    const result = await report({ vehicleId, severity: "cannot_drive" });
    expect(result.status).toBe(201);
    const view = VehicleIssueViewSchema.parse(result.body);
    // Both bookings are at risk (the vehicle is off the road for both) …
    expect(theirs.risk).toBe("at_risk");
    const conflicts = await h.db.fleetConflict.findMany({
      where: { maintenanceBlockId: view.block?.blockId ?? "" },
    });
    expect(conflicts.map((row) => row.driverId).sort()).toEqual(
      [driverId, nightDriver].sort(),
    );
    // … but the reporter is answered only their own.
    const mine = conflicts.find((row) => row.driverId === driverId);
    expect(view.decisions).toEqual([
      {
        conflictId: mine?.id,
        deadlineAt: mine?.deadlineAt?.toISOString() ?? null,
      },
    ]);
    expect(JSON.stringify(result.body)).not.toContain(theirs.blockId);
    expect(JSON.stringify(result.body)).not.toContain(nightDriver);
  });

  it("carries ids, codes and times only (no rider, place, fare or net field)", async () => {
    h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-28T12:00:00.000Z",
      endsAt: "2026-09-28T13:00:00.000Z",
    });
    const result = await report({ vehicleId, severity: "cannot_drive" });
    expect(result.status).toBe(201);
    const leaks = keysOf(result.body).filter((key) =>
      FLEET_FORBIDDEN_FIELD_PATTERNS.some((pattern) => pattern.test(key)),
    );
    expect(leaks).toEqual([]);
  });

  it("is flagged for UBI ops when the reporting driver goes online during the claimed breakdown", async () => {
    const reported = await report({ vehicleId, severity: "cannot_drive" });
    expect(reported.status).toBe(201);
    const view = reported.body as unknown as VehicleIssueView;
    expect(await checkOffRoadIntegrity(h.deps)).toBe(0);
    await h.db.driver.update({
      where: { userId: driverId },
      data: { isOnline: true },
    });
    h.clock.now = new Date("2026-09-28T08:30:00.000Z");
    expect(await checkOffRoadIntegrity(h.deps)).toBe(1);
    const flagged = await h.db.outboxEvent.findFirstOrThrow({
      where: {
        name: "fleet.offroad.flagged",
        aggregateId: view.block?.blockId ?? "",
      },
    });
    expect(flagged.payload).toMatchObject({
      reportedBy: driverId,
      reason: "driver_online_on_vehicle_during_off_road",
    });
  });

  it("is flagged when the vehicle is seen on a trip during the claimed breakdown", async () => {
    const reported = await report({ vehicleId, severity: "cannot_drive" });
    expect(reported.status).toBe(201);
    h.ride.addBooking({
      driverId,
      vehicleId,
      kind: "on_trip",
      state: "activated",
      startsAt: "2026-09-28T08:20:00.000Z",
      endsAt: "2026-09-28T08:50:00.000Z",
    });
    h.clock.now = new Date("2026-09-28T08:40:00.000Z");
    expect(await checkOffRoadIntegrity(h.deps)).toBe(1);
  });

  it("refuses a second report while the vehicle is already off-road, in plain words", async () => {
    const first = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/off-road`,
      token: world.ownerToken,
      city: world.cityId,
      body: { vehicleId },
    });
    expect(first.status).toBe(201);
    const second = await report({ vehicleId, severity: "cannot_drive" });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("maintenance_overlap");
    expect(String(second.body.message)).toContain("already reported off-road");
    expect(
      await h.db.fleetMaintenanceBlock.count({
        where: { vehicleId, kind: "unplanned_off_road" },
      }),
    ).toBe(1);
  });

  it("the fleet brings the vehicle back: released on the ledger, the driver's conflict resolved", async () => {
    h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-28T12:00:00.000Z",
      endsAt: "2026-09-28T13:00:00.000Z",
    });
    const reported = await report({ vehicleId, severity: "cannot_drive" });
    const blockId = (reported.body as unknown as VehicleIssueView).block
      ?.blockId;
    h.clock.now = new Date("2026-09-28T10:00:00.000Z");
    const done = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/maintenance/${blockId}/complete`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("completed");
    expect(
      h.ride.occupancies.find((o) => o.blockId === blockId)?.released,
    ).toBe(true);
    const conflicts = await h.db.fleetConflict.findMany({
      where: { maintenanceBlockId: blockId ?? "" },
    });
    expect(conflicts.every((conflict) => conflict.status === "resolved")).toBe(
      true,
    );
  });

  it("answers 503 when ride-service is down, keeps the block, and the same key then completes it (no second block)", async () => {
    h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-28T12:00:00.000Z",
      endsAt: "2026-09-28T13:00:00.000Z",
    });
    h.ride.down = true;
    const key = idemKey("vis");
    const failed = await report(
      { vehicleId, severity: "cannot_drive" },
      { idem: key },
    );
    expect(failed.status).toBe(503);
    const pending = await h.db.fleetMaintenanceBlock.findMany({
      where: { vehicleId, kind: "unplanned_off_road" },
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.occupancyId).toBeNull();
    h.ride.down = false;
    const retried = await report(
      { vehicleId, severity: "cannot_drive" },
      { idem: key },
    );
    expect(retried.status).toBe(201);
    const view = VehicleIssueViewSchema.parse(retried.body);
    expect(view.block?.blockId).toBe(pending[0]?.id);
    expect(view.decisions).toHaveLength(1);
    expect(
      await h.db.fleetMaintenanceBlock.count({
        where: { vehicleId, kind: "unplanned_off_road" },
      }),
    ).toBe(1);
  });

  it("a key whose breakdown is still pending on the ledger can't be retried against another vehicle", async () => {
    // The same driver also drives a second vehicle on the night shift.
    const second = await addVehicle(h, world);
    await signedArrangement(h, world, {
      vehicleId: second,
      driverId,
      shift: "night",
      validFrom: "2026-09-28",
    });
    h.ride.down = true;
    const key = idemKey("vis");
    const failed = await report(
      { vehicleId, severity: "cannot_drive" },
      { idem: key },
    );
    expect(failed.status).toBe(503);
    h.ride.down = false;
    // No idempotency record was stored (503), but the key's block names the
    // first vehicle: another vehicle under that key is a different request.
    const other = await report(
      { vehicleId: second, severity: "cannot_drive" },
      { idem: key },
    );
    expect(other.status).toBe(409);
    expect(other.body.code).toBe("idempotency_key_reuse");
    expect(
      await h.db.fleetMaintenanceBlock.count({ where: { vehicleId: second } }),
    ).toBe(0);
    // The original request still completes under its key.
    const retried = await report(
      { vehicleId, severity: "cannot_drive" },
      { idem: key },
    );
    expect(retried.status).toBe(201);
    expect(VehicleIssueViewSchema.parse(retried.body).vehicleId).toBe(
      vehicleId,
    );
  });
});

describe("service_soon: the vehicle stays on the road", () => {
  it("alerts the fleet to schedule planned maintenance: no block, no ledger write, no booking touched", async () => {
    const booking = h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-28T12:00:00.000Z",
      endsAt: "2026-09-28T13:00:00.000Z",
    });
    const result = await report({
      vehicleId,
      severity: "service_soon",
      note: "Brake pads squeal",
    });
    expect(result.status).toBe(201);
    const view = VehicleIssueViewSchema.parse(result.body);
    expect(view).toMatchObject({
      severity: "service_soon",
      vehicleId,
      fleetAlerted: true,
      block: null,
      decisions: [],
      remittanceEffect: "none",
    });
    expect(booking.risk).toBe("ok");
    expect(
      h.ride.requests.filter((request) => request.path === OFF_ROAD_ROUTE),
    ).toEqual([]);
    expect(
      await h.db.fleetMaintenanceBlock.count({ where: { vehicleId } }),
    ).toBe(0);
    expect(await h.db.fleetConflict.count({ where: { vehicleId } })).toBe(0);
    const alert = await h.db.outboxEvent.findFirstOrThrow({
      where: { name: "fleet.alert", aggregateId: vehicleId },
    });
    expect(alert.payload).toMatchObject({
      alertType: "vehicle_issue_reported",
      issueId: view.issueId,
      severity: "service_soon",
      fleetId: world.fleetId,
      driverId,
      blockId: null,
      fleetAction: "schedule_planned_maintenance",
      hasNote: true,
    });
    expect(JSON.stringify(alert.payload)).not.toContain("Brake");
    // The note is kept for UBI ops in the audit row, with the report.
    const audit = await h.db.auditLog.findFirstOrThrow({
      where: { action: "fleet.vehicle_issue.reported", subjectId: vehicleId },
    });
    expect(audit.actorId).toBe(driverId);
    expect(audit.after).toMatchObject({
      issueId: view.issueId,
      severity: "service_soon",
      note: "Brake pads squeal",
    });
  });

  it("replays the same answer for the same key and body, alerting once", async () => {
    const key = idemKey("vis");
    const first = await report(
      { vehicleId, severity: "service_soon" },
      { idem: key },
    );
    h.clock.now = new Date("2026-09-28T08:05:00.000Z");
    const replay = await report(
      { vehicleId, severity: "service_soon" },
      { idem: key },
    );
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(
      await h.db.outboxEvent.count({
        where: { name: "fleet.alert", aggregateId: vehicleId },
      }),
    ).toBe(1);
  });
});

describe("who may report", () => {
  it("refuses a driver with no signed arrangement on the vehicle, and a vehicle that does not exist, with the same 403", async () => {
    const stranger = await seedUser(h.db, { driver: true });
    const strangerToken = await tokenFor(stranger, world.cityId, {
      kind: "driver",
    });
    const notTheirs = await report(
      { vehicleId, severity: "cannot_drive" },
      { token: strangerToken },
    );
    const missing = await report({
      vehicleId: "00000000-0000-4000-8000-000000000000",
      severity: "cannot_drive",
    });
    const garbage = await report({
      vehicleId: "veh_1",
      severity: "cannot_drive",
    });
    for (const refused of [notTheirs, missing, garbage]) {
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({
        code: "forbidden",
        details: { reason: "not_assigned_to_vehicle" },
      });
    }
    expect(
      await h.db.fleetMaintenanceBlock.count({ where: { vehicleId } }),
    ).toBe(0);
    expect(h.ride.requests).toEqual([]);
  });

  it("refuses the driver on a vehicle they are not assigned to TODAY (the arrangement starts tomorrow)", async () => {
    const other = await addVehicle(h, world);
    const later = await seedUser(h.db, { driver: true });
    await signedArrangement(h, world, {
      vehicleId: other,
      driverId: later,
      shift: "day",
      validFrom: "2026-09-29",
    });
    const refused = await report(
      { vehicleId: other, severity: "service_soon" },
      { token: await tokenFor(later, world.cityId, { kind: "driver" }) },
    );
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("forbidden");
  });

  it("answers a vehicle the fleet has since removed with the same 403, never a 404", async () => {
    await h.db.fleetVehicle.updateMany({
      where: { fleetId: world.fleetId, vehicleId },
      data: { status: "removed" },
    });
    for (const severity of ["cannot_drive", "service_soon"]) {
      const refused = await report({ vehicleId, severity });
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({
        code: "forbidden",
        details: { reason: "not_assigned_to_vehicle" },
      });
    }
    expect(
      await h.db.fleetMaintenanceBlock.count({ where: { vehicleId } }),
    ).toBe(0);
    expect(h.ride.requests).toEqual([]);
  });

  it("refuses the driver once their arrangement has ended", async () => {
    await h.db.fleetAssignment.updateMany({
      where: { driverId },
      data: { validTo: new Date("2026-09-28T00:00:00.000Z"), status: "ended" },
    });
    const refused = await report({ vehicleId, severity: "cannot_drive" });
    expect(refused.status).toBe(403);
  });

  it("is a driver route: fleet staff (no fleet:driver scope) and limited-mode devices are refused", async () => {
    const staff = await report(
      { vehicleId, severity: "cannot_drive" },
      { token: world.ownerToken },
    );
    expect(staff.status).toBe(403);
    expect(staff.body.code).toBe("forbidden");
    const limited = await report(
      { vehicleId, severity: "cannot_drive" },
      {
        token: await tokenFor(driverId, world.cityId, {
          kind: "driver",
          modes: ["limited"],
        }),
      },
    );
    expect(limited.body.code).toBe("limited_mode");
  });

  it("refuses a request without identity", async () => {
    const result = await api(h.app, {
      method: "POST",
      path: PATH,
      city: world.cityId,
      body: { vehicleId, severity: "cannot_drive" },
    });
    expect(result.status).toBe(401);
  });

  it("answers the honest 404 feature_disabled with the fleet flag off — before reading the body or the key", async () => {
    await setFleetFlag(h.db, world.cityId, false);
    const result = await report(
      { vehicleId, severity: "not-a-severity" },
      { idem: null },
    );
    expect(result.status).toBe(404);
    expect(result.body.code).toBe("feature_disabled");
    expect(
      await h.db.fleetMaintenanceBlock.count({ where: { vehicleId } }),
    ).toBe(0);
  });
});

describe("idempotency", () => {
  it("needs an Idempotency-Key", async () => {
    const result = await report(
      { vehicleId, severity: "cannot_drive" },
      { idem: null },
    );
    expect(result.status).toBe(422);
    expect(result.body.code).toBe("validation_failed");
    expect(
      await h.db.fleetMaintenanceBlock.count({ where: { vehicleId } }),
    ).toBe(0);
  });

  it("replays a breakdown report verbatim: one block, one ledger write, one alert", async () => {
    h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-28T12:00:00.000Z",
      endsAt: "2026-09-28T13:00:00.000Z",
    });
    const key = idemKey("vis");
    const first = await report(
      { vehicleId, severity: "cannot_drive" },
      { idem: key },
    );
    const replay = await report(
      { vehicleId, severity: "cannot_drive" },
      { idem: key },
    );
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(
      await h.db.fleetMaintenanceBlock.count({ where: { vehicleId } }),
    ).toBe(1);
    expect(
      h.ride.requests.filter((request) => request.path === OFF_ROAD_ROUTE),
    ).toHaveLength(1);
    expect(
      await h.db.outboxEvent.count({
        where: { name: "fleet.alert", aggregateId: vehicleId },
      }),
    ).toBe(1);
  });

  it("refuses the same key with another body (409 idempotency_key_reuse)", async () => {
    const key = idemKey("vis");
    const first = await report(
      { vehicleId, severity: "service_soon" },
      { idem: key },
    );
    expect(first.status).toBe(201);
    const reused = await report(
      { vehicleId, severity: "cannot_drive" },
      { idem: key },
    );
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe("idempotency_key_reuse");
    expect(
      await h.db.fleetMaintenanceBlock.count({ where: { vehicleId } }),
    ).toBe(0);
  });

  it("validates the body strictly", async () => {
    const unknownSeverity = await report({ vehicleId, severity: "flat_tyre" });
    expect(unknownSeverity.status).toBe(422);
    const extra = await report({
      vehicleId,
      severity: "service_soon",
      startsAt: "2026-09-28T07:00:00.000Z",
    });
    expect(extra.status).toBe(422);
    const longNote = await report({
      vehicleId,
      severity: "service_soon",
      note: "x".repeat(281),
    });
    expect(longNote.status).toBe(422);
  });
});

describe("the outbox", () => {
  it("every event a report writes is a publishable envelope, recorded as the driver, with no note in it", async () => {
    h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-28T12:00:00.000Z",
      endsAt: "2026-09-28T13:00:00.000Z",
    });
    const breakdown = await report({
      vehicleId,
      severity: "cannot_drive",
      note: "Smoke from the bonnet",
    });
    expect(breakdown.status).toBe(201);
    const blockId = (breakdown.body as unknown as VehicleIssueView).block
      ?.blockId;
    const rows = await h.db.$queryRawUnsafe<RawOutboxRow[]>(
      `SELECT * FROM outbox_events WHERE aggregate_id = ANY($1::text[]) OR payload->>'maintenanceBlockId' = $2 ORDER BY created_at`,
      [vehicleId, blockId],
      blockId,
    );
    expect(rows.map((row) => row.name).sort()).toEqual(
      [
        "fleet.alert",
        "fleet.conflict.opened",
        "fleet.offroad.reported",
        "maintenance.status.changed",
      ].sort(),
    );
    for (const row of rows) {
      const parsed = envelopeFromRow(row);
      expect(parsed.ok, `${row.name}: ${parsed.ok ? "" : parsed.error}`).toBe(
        true,
      );
      expect(row.actor_type).toBe("driver");
      expect(row.actor_id).toBe(driverId);
      expect(JSON.stringify(row.payload)).not.toMatch(/Smoke|bonnet/);
    }
  });
});

describe("remittance (decisions Q8)", () => {
  it("hands a driver-reported breakdown to settlement as off-road hours, never as pro-rated planned maintenance", async () => {
    const reported = await report({ vehicleId, severity: "cannot_drive" });
    const blockId = (reported.body as unknown as VehicleIssueView).block
      ?.blockId;
    // The fleet marks the vehicle back on the road two hours later.
    h.clock.now = new Date("2026-09-28T10:00:00.000Z");
    const done = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/maintenance/${blockId}/complete`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(done.status).toBe(200);
    const inputs = await api(h.app, {
      path: `/internal/fleet/settlement-inputs?weekStart=2026-09-28&cityId=${world.cityId}`,
      headers: {
        "x-service-key": process.env.FLEET_PAYMENT_SERVICE_KEY ?? "",
      },
    });
    expect(inputs.status).toBe(200);
    const item = SettlementInputsResponseSchema.parse(inputs.body).items.find(
      (entry) => entry.driverId === driverId,
    );
    expect(item).toMatchObject({
      plannedMaintenanceHoursInWeek: 0,
      unplannedOffRoadHoursInWeek: 2,
    });
  });
});
