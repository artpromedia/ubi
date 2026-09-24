/**
 * The server-composed fleet calendar and driver schedule, driver availability
 * (preview + explicit withdrawal), utilisation's honest "not enough data",
 * and the PRIVACY guarantees: a walk over every fleet-service response schema
 * for forbidden fields, and proof that fields ride-service must never send are
 * dropped at the boundary even if it does.
 */
import {
  ZodArray,
  ZodDefault,
  ZodDiscriminatedUnion,
  ZodNullable,
  ZodObject,
  ZodOptional,
  ZodRecord,
  ZodUnion,
  ZodEffects,
  type ZodTypeAny,
} from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addVehicle,
  api,
  closeTestDb,
  idemKey,
  resetFleet,
  seedFleet,
  seedUser,
  signedArrangement,
  startHarness,
  tokenFor,
  type FleetWorld,
  type Harness,
} from "./helpers";
import {
  AvailabilityPreviewViewSchema,
  AvailabilitySavedViewSchema,
  DriverConflictViewSchema,
  DriverScheduleSchema,
  FLEET_FORBIDDEN_FIELD_PATTERNS,
  FLEET_RESPONSE_SCHEMAS,
  FleetCalendarSchema,
  OCCUPIED_BLOCK_FIELDS,
  UtilisationSchema,
} from "../src/contract";

let h: Harness;
let world: FleetWorld;
let vehicleId: string;
let driverId: string;
let driverToken: string;

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
  vehicleId = await addVehicle(h, world);
  driverId = await seedUser(h.db, {
    driver: true,
    firstName: "Tunde",
    lastName: "Eze",
  });
  driverToken = await tokenFor(driverId, world.cityId, { kind: "driver" });
  await signedArrangement(h, world, {
    vehicleId,
    driverId,
    shift: "day",
    validFrom: "2026-09-28",
  });
});

/** Every key name a schema can produce, at any depth. */
function keysOf(schema: ZodTypeAny, path: string, out: string[]): void {
  if (schema instanceof ZodObject) {
    for (const [key, child] of Object.entries(
      schema.shape as Record<string, ZodTypeAny>,
    )) {
      out.push(`${path}.${key}`);
      keysOf(child, `${path}.${key}`, out);
    }
  } else if (schema instanceof ZodArray) {
    keysOf(schema.element as ZodTypeAny, `${path}[]`, out);
  } else if (
    schema instanceof ZodNullable ||
    schema instanceof ZodOptional ||
    schema instanceof ZodDefault
  ) {
    keysOf(schema._def.innerType as ZodTypeAny, path, out);
  } else if (
    schema instanceof ZodUnion ||
    schema instanceof ZodDiscriminatedUnion
  ) {
    for (const option of schema.options as ZodTypeAny[])
      keysOf(option, path, out);
  } else if (schema instanceof ZodEffects) {
    keysOf(schema._def.schema as ZodTypeAny, path, out);
  } else if (schema instanceof ZodRecord) {
    keysOf(schema._def.valueType as ZodTypeAny, `${path}{}`, out);
  }
}

describe("privacy: what a fleet response may carry", () => {
  it("no fleet-service response schema declares rider, location, route, fare, safety or driver-net fields", () => {
    const violations: string[] = [];
    for (const [name, schema] of Object.entries(FLEET_RESPONSE_SCHEMAS)) {
      const keys: string[] = [];
      keysOf(schema as ZodTypeAny, name, keys);
      expect(keys.length, name).toBeGreaterThan(0);
      for (const key of keys) {
        const leaf =
          key
            .split(".")
            .pop()
            ?.replace(/[[\]{}]/g, "") ?? "";
        if (
          FLEET_FORBIDDEN_FIELD_PATTERNS.some((pattern) => pattern.test(leaf))
        ) {
          violations.push(key);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("the walk is not vacuous: it catches a forbidden field when one is present", () => {
    const keys: string[] = [];
    keysOf(
      FleetCalendarSchema.extend({
        riderPhone: FleetCalendarSchema.shape.zone,
      }),
      "probe",
      keys,
    );
    expect(
      keys.some((key) =>
        FLEET_FORBIDDEN_FIELD_PATTERNS.some((pattern) =>
          pattern.test(key.split(".").pop() ?? ""),
        ),
      ),
    ).toBe(true);
  });

  it("drops fields ride-service must never send before they can reach a fleet", async () => {
    h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-28T10:00:00.000Z",
      endsAt: "2026-09-28T11:00:00.000Z",
    });
    h.ride.leakExtraFields = true;
    const result = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}/calendar`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(result.status).toBe(200);
    const text = JSON.stringify(result.body);
    for (const leaked of [
      "Leaky Rider",
      "+2348000000000",
      "Lekki",
      "riderName",
      "pickup",
      "fareMinor",
      "req_leak",
    ]) {
      expect(text).not.toContain(leaked);
    }
    const calendar = FleetCalendarSchema.parse(result.body);
    const block = calendar.rows[0]?.occupied[0];
    expect(Object.keys(block ?? {}).sort()).toEqual(
      [...OCCUPIED_BLOCK_FIELDS].sort(),
    );
  });
});

describe("the fleet calendar", () => {
  it("composes vehicle rows: signed shift intervals, maintenance, opaque bookings and documents, in the city zone", async () => {
    const booking = h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-28T10:00:00.000Z",
      endsAt: "2026-09-28T11:40:00.000Z",
    });
    const result = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}/calendar?zoom=day`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(result.status).toBe(200);
    const calendar = FleetCalendarSchema.parse(result.body);
    expect(calendar.zone).toBe("Africa/Lagos");
    expect(calendar.from).toBe("2026-09-27T23:00:00.000Z");
    expect(calendar.to).toBe("2026-09-28T23:00:00.000Z");
    const row = calendar.rows[0];
    expect(row?.vehicleId).toBe(vehicleId);
    expect(row?.statusNow).toBe("in_service");
    expect(row?.assignments[0]?.intervals).toEqual([
      {
        startsAt: "2026-09-28T05:00:00.000Z",
        endsAt: "2026-09-28T17:00:00.000Z",
      },
    ]);
    expect(row?.assignments[0]?.driverDisplayName).toBe("Tunde E.");
    expect(row?.occupied.map((block) => block.blockId)).toEqual([
      booking.blockId,
    ]);
    expect(row?.documents.map((doc) => doc.status)).toEqual(["valid", "valid"]);
    expect(row?.hours?.signedShiftHours).toBe(12);
    expect(calendar.totalRows).toBe(1);
    expect(calendar.nextCursor).toBeNull();
  });

  it("filters by class and plate, paginates with a cursor, and summarises weeks per local day", async () => {
    await addVehicle(h, world, { classes: ["comfort"] });
    await addVehicle(h, world, { classes: ["comfort"] });
    const comfort = FleetCalendarSchema.parse(
      (
        await api(h.app, {
          path: `/v1/fleets/${world.fleetId}/calendar?class=comfort&limit=1`,
          token: world.ownerToken,
          city: world.cityId,
        })
      ).body,
    );
    expect(comfort.totalRows).toBe(2);
    expect(comfort.rows).toHaveLength(1);
    expect(comfort.nextCursor).not.toBeNull();
    const next = FleetCalendarSchema.parse(
      (
        await api(h.app, {
          path: `/v1/fleets/${world.fleetId}/calendar?class=comfort&limit=1&cursor=${comfort.nextCursor ?? ""}`,
          token: world.ownerToken,
          city: world.cityId,
        })
      ).body,
    );
    expect(next.rows[0]?.vehicleId).not.toBe(comfort.rows[0]?.vehicleId);
    expect(next.nextCursor).toBeNull();

    const week = FleetCalendarSchema.parse(
      (
        await api(h.app, {
          path: `/v1/fleets/${world.fleetId}/calendar?zoom=week&class=go`,
          token: world.ownerToken,
          city: world.cityId,
        })
      ).body,
    );
    expect(week.daySummaries).toHaveLength(7);
    expect(week.daySummaries?.[0]).toMatchObject({
      date: "2026-09-28",
      shiftSummary: ["day 06:00–18:00"],
    });
  });

  it("shows driver rows with the driver's time off ONLY as an unexplained 'unavailable'", async () => {
    await h.db.driverAvailability.create({
      data: {
        id: idemKey("dav"),
        driverId,
        kind: "time_off",
        startsAt: new Date("2026-09-28T13:00:00.000Z"),
        endsAt: new Date("2026-09-28T15:00:00.000Z"),
        zone: "Africa/Lagos",
        status: "saved",
        setVersion: 1,
      },
    });
    const result = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}/calendar?rows=drivers`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(result.status).toBe(200);
    const calendar = FleetCalendarSchema.parse(result.body);
    const row = calendar.rows[0];
    expect(row?.driverId).toBe(driverId);
    expect(row?.availability).toEqual([
      {
        kind: "unavailable",
        startsAt: "2026-09-28T13:00:00.000Z",
        endsAt: "2026-09-28T15:00:00.000Z",
        setBy: "driver",
      },
    ]);
    expect(JSON.stringify(result.body)).not.toContain("time_off");
    expect(row?.hours?.signedShiftHours).toBe(12);
  });

  it("answers 503 rather than an empty booking lane when ride-service is down", async () => {
    h.ride.down = true;
    const result = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}/calendar`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(result.status).toBe(503);
    const noBookings = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}/calendar?layers=assignments,maintenance`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(noBookings.status).toBe(200);
  });
});

describe("driver availability and schedule", () => {
  const TIME_OFF = {
    kind: "time_off",
    startsAt: "2026-10-01T09:00:00.000Z",
    endsAt: "2026-10-01T12:00:00.000Z",
  } as const;

  it("previews what time off does: shift hours reduced and the booking it overlaps, with the explained outcome", async () => {
    const booking = h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-10-01T09:30:00.000Z",
      endsAt: "2026-10-01T11:00:00.000Z",
      windowStart: "2026-10-01T09:45:00.000Z",
      windowEnd: "2026-10-01T09:55:00.000Z",
      commissionMinor: { amountMinor: 52_000, currency: "NGN" },
    });
    const result = await api(h.app, {
      method: "POST",
      path: "/v1/drivers/me/availability:preview",
      token: driverToken,
      city: world.cityId,
      body: { windows: [TIME_OFF] },
      idem: null,
    });
    expect(result.status).toBe(200);
    const preview = AvailabilityPreviewViewSchema.parse(result.body);
    const shift = preview.affects.find((entry) => entry.kind === "shift");
    expect(shift).toMatchObject({ effect: "hours_reduced", lostHours: 3 });
    const conflict = preview.affects.find((entry) => entry.kind === "booking");
    expect(conflict).toMatchObject({
      bookingId: booking.bookingId,
      outcome: {
        commissionReturned: { amountMinor: 52_000, currency: "NGN" },
        fundingReleased: true,
        rematch: "decided_by_marketplace",
        penalty: "none",
      },
      options: ["trim_time_off", "withdraw_booking"],
    });
  });

  it("refuses to save over a booking the driver has not chosen for, and saves once they explicitly withdraw", async () => {
    const booking = h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-10-01T09:30:00.000Z",
      endsAt: "2026-10-01T11:00:00.000Z",
      windowStart: "2026-10-01T09:45:00.000Z",
      windowEnd: "2026-10-01T09:55:00.000Z",
    });
    const preview = AvailabilityPreviewViewSchema.parse(
      (
        await api(h.app, {
          method: "POST",
          path: "/v1/drivers/me/availability:preview",
          token: driverToken,
          city: world.cityId,
          body: { windows: [TIME_OFF] },
          idem: null,
        })
      ).body,
    );
    const unresolved = await api(h.app, {
      method: "PUT",
      path: "/v1/drivers/me/availability",
      token: driverToken,
      city: world.cityId,
      body: {
        windows: [TIME_OFF],
        withdrawals: [],
        previewToken: preview.previewToken,
      },
    });
    expect(unresolved.status).toBe(409);
    expect(unresolved.body.code).toBe("unresolved_booking_overlap");
    expect(await h.db.driverAvailability.count({ where: { driverId } })).toBe(
      0,
    );

    const saved = await api(h.app, {
      method: "PUT",
      path: "/v1/drivers/me/availability",
      token: driverToken,
      city: world.cityId,
      body: {
        windows: [TIME_OFF],
        withdrawals: [booking.bookingId],
        previewToken: preview.previewToken,
      },
    });
    expect(saved.status).toBe(200);
    const view = AvailabilitySavedViewSchema.parse(saved.body);
    expect(view.status).toBe("saved_with_withdrawals");
    expect(view.withdrawals[0]?.next).toEqual({
      method: "POST",
      path: `/v1/mp/advance-bookings/${booking.bookingId}/withdraw`,
    });
    // Nothing was withdrawn on the driver's behalf: the booking is still live.
    expect(booking.state).toBe("confirmed");
    const event = await h.db.outboxEvent.findFirstOrThrow({
      where: { name: "driver.availability.saved", aggregateId: driverId },
    });
    expect(event.actorType).toBe("driver");
    expect(event.aggregateType).toBe("driver");

    // The fleet sees only that the driver is resolving it.
    const conflicts = await api<{
      conflicts: {
        type: string;
        allowedActions: string[];
        subjects: unknown[];
      }[];
    }>(h.app, {
      path: `/v1/fleets/${world.fleetId}/conflicts`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(conflicts.body.conflicts.map((conflict) => conflict.type)).toEqual([
      "driver_resolving",
    ]);
    expect(conflicts.body.conflicts[0]?.allowedActions).toEqual(["remind"]);
    expect(JSON.stringify(conflicts.body)).not.toContain("time_off");

    // The driver sees their own conflict with the explained options.
    const conflictId = view.withdrawals[0]?.conflictId ?? "";
    const own = await api(h.app, {
      path: `/v1/drivers/me/conflicts/${conflictId}`,
      token: driverToken,
      city: world.cityId,
    });
    expect(own.status).toBe(200);
    const detail = DriverConflictViewSchema.parse(own.body);
    expect(detail.bookingId).toBe(booking.bookingId);
    expect(detail.options.map((option) => option.id)).toEqual([
      "trim_time_off",
      "withdraw",
    ]);
    const stranger = await tokenFor(
      await seedUser(h.db, { driver: true }),
      world.cityId,
      { kind: "driver" },
    );
    expect(
      (
        await api(h.app, {
          path: `/v1/drivers/me/conflicts/${conflictId}`,
          token: stranger,
          city: world.cityId,
        })
      ).status,
    ).toBe(404);
  });

  it("refuses a save whose preview is stale", async () => {
    const result = await api(h.app, {
      method: "PUT",
      path: "/v1/drivers/me/availability",
      token: driverToken,
      city: world.cityId,
      body: {
        windows: [TIME_OFF],
        withdrawals: [],
        previewToken: "apv_not_the_preview",
      },
    });
    expect(result.status).toBe(409);
  });

  it("expands a weekly rrule on the local wall clock and composes the driver's schedule", async () => {
    const preview = AvailabilityPreviewViewSchema.parse(
      (
        await api(h.app, {
          method: "POST",
          path: "/v1/drivers/me/availability:preview",
          token: driverToken,
          city: world.cityId,
          body: {
            windows: [
              {
                kind: "available",
                startsAt: "2026-09-28T16:00:00.000Z",
                endsAt: "2026-09-28T20:00:00.000Z",
                rrule: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
              },
            ],
          },
          idem: null,
        })
      ).body,
    );
    const saved = await api(h.app, {
      method: "PUT",
      path: "/v1/drivers/me/availability",
      token: driverToken,
      city: world.cityId,
      body: {
        windows: [
          {
            kind: "available",
            startsAt: "2026-09-28T16:00:00.000Z",
            endsAt: "2026-09-28T20:00:00.000Z",
            rrule: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
          },
        ],
        withdrawals: [],
        previewToken: preview.previewToken,
      },
    });
    expect(saved.status).toBe(200);
    const booking = h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-29T07:30:00.000Z",
      endsAt: "2026-09-29T09:00:00.000Z",
      windowStart: "2026-09-29T07:45:00.000Z",
      windowEnd: "2026-09-29T07:55:00.000Z",
    });
    const result = await api(h.app, {
      path: "/v1/drivers/me/schedule?from=2026-09-28T00:00:00.000Z&to=2026-10-05T00:00:00.000Z",
      token: driverToken,
      city: world.cityId,
    });
    expect(result.status).toBe(200);
    const schedule = DriverScheduleSchema.parse(result.body);
    const availability = schedule.items.filter(
      (item) => item.kind === "availability",
    );
    expect(availability.map((item) => item.startsAt)).toEqual([
      "2026-09-28T16:00:00.000Z",
      "2026-09-30T16:00:00.000Z",
    ]);
    expect(schedule.items.filter((item) => item.kind === "shift")).toHaveLength(
      7,
    );
    expect(
      schedule.items.find((item) => item.kind === "booking"),
    ).toMatchObject({ bookingId: booking.bookingId, risk: "ok" });
    // Composed by the server from ride-service's driver-entitled calendar (route 6).
    expect(
      h.ride.requests.some((request) =>
        request.path.startsWith(`/internal/fleet/drivers/${driverId}/calendar`),
      ),
    ).toBe(true);
  });
});

describe("utilisation", () => {
  it("shows 'not enough data' for a vehicle with under 7 days, and only real sources after", async () => {
    const early = await api(h.app, {
      path: `/v1/fleets/${world.fleetId}/utilisation`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(early.status).toBe(200);
    const first = UtilisationSchema.parse(early.body);
    expect(first.rows[0]).toMatchObject({
      enoughData: false,
      reason: "not_enough_data",
      hours: null,
    });

    await h.db.fleetVehicle.updateMany({
      where: { vehicleId },
      data: { createdAt: new Date("2026-09-01T00:00:00.000Z") },
    });
    h.ride.addBooking({
      driverId,
      vehicleId,
      startsAt: "2026-09-28T09:00:00.000Z",
      endsAt: "2026-09-28T10:30:00.000Z",
    });
    const later = UtilisationSchema.parse(
      (
        await api(h.app, {
          path: `/v1/fleets/${world.fleetId}/utilisation?from=2026-09-28T08:00:00.000Z&to=2026-09-29T08:00:00.000Z`,
          token: world.ownerToken,
          city: world.cityId,
        })
      ).body,
    );
    expect(later.rows[0]?.enoughData).toBe(true);
    expect(later.rows[0]?.hours).toEqual({
      onTrip: null,
      onlineIdle: null,
      bookedAhead: 1.5,
      maintenance: 0,
      offline: null,
    });
    expect(later.rows[0]?.unavailable.map((entry) => entry.metric)).toEqual([
      "onTrip",
      "onlineIdle",
      "offline",
    ]);
  });
});
