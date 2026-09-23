/**
 * Every state change leaves an audit row and an outbox row the shared relay
 * can actually publish: each fleet event, read back the way @ubi/outbox's
 * relay reads it (raw SQL, snake_case), must rebuild into a valid canonical
 * envelope — a known name, an envelope subject and actor type, and an
 * idempotency key within the envelope's 64 characters. A row that failed
 * this would be quarantined by the relay and never reach a consumer.
 * Production also refuses to boot without the identity secret.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { envelopeFromRow, type RawOutboxRow } from "@ubi/outbox";

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
  type Harness,
} from "./helpers";
import {
  FLEET_ACTOR_TYPES,
  FLEET_EVENT_NAMES,
  FLEET_SUBJECT_TYPES,
  MaintenancePreviewViewSchema,
} from "../src/contract";
import { assertIdentityConfigured } from "../src/lib/identity-context";
import { documentSweep } from "../src/ops/documents";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
  await resetFleet(h.db);
});

afterAll(async () => {
  await h.close();
  await closeTestDb();
});

describe("the outbox", () => {
  it("writes a publishable envelope, with an audit row, for every fleet state change", async () => {
    h.clock.now = new Date("2026-09-28T08:00:00.000Z");
    const world = await seedFleet(h);
    const vehicleId = await addVehicle(h, world, {
      insuranceExpiry: new Date("2026-10-05T00:00:00.000Z"),
    });
    const driverId = await seedUser(h.db, { driver: true });
    const { assignmentId } = await signedArrangement(h, world, {
      vehicleId,
      driverId,
      shift: "day",
      validFrom: "2026-09-28",
    });
    const preview = MaintenancePreviewViewSchema.parse(
      (
        await api(h.app, {
          method: "POST",
          path: `/v1/fleets/${world.fleetId}/maintenance:preview`,
          token: world.ownerToken,
          city: world.cityId,
          body: {
            vehicleId,
            kind: "inspection",
            startsAt: "2026-10-01T08:00:00.000Z",
            endsAt: "2026-10-01T10:00:00.000Z",
          },
          idem: null,
        })
      ).body,
    );
    const created = await api(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/maintenance`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        vehicleId,
        kind: "inspection",
        startsAt: "2026-10-01T08:00:00.000Z",
        endsAt: "2026-10-01T10:00:00.000Z",
        previewToken: preview.previewToken,
      },
    });
    expect(created.status).toBe(201);
    expect(
      (
        await api(h.app, {
          method: "POST",
          path: `/v1/fleets/${world.fleetId}/off-road`,
          token: world.ownerToken,
          city: world.cityId,
          body: { vehicleId },
        })
      ).status,
    ).toBe(201);
    const driverToken = await tokenFor(driverId, world.cityId, {
      kind: "driver",
    });
    const window = {
      kind: "available",
      startsAt: "2026-10-02T06:00:00.000Z",
      endsAt: "2026-10-02T10:00:00.000Z",
    };
    const availability = await api<{ previewToken: string }>(h.app, {
      method: "POST",
      path: "/v1/drivers/me/availability:preview",
      token: driverToken,
      city: world.cityId,
      body: { windows: [window] },
      idem: null,
    });
    expect(
      (
        await api(h.app, {
          method: "PUT",
          path: "/v1/drivers/me/availability",
          token: driverToken,
          city: world.cityId,
          body: {
            windows: [window],
            withdrawals: [],
            previewToken: availability.body.previewToken,
          },
          idem: idemKey("avail"),
        })
      ).status,
    ).toBe(200);
    await documentSweep(h.deps);

    const rows = await h.db.$queryRawUnsafe<RawOutboxRow[]>(
      `SELECT * FROM outbox_events WHERE name = ANY($1::text[]) ORDER BY created_at`,
      [...FLEET_EVENT_NAMES],
    );
    const names = new Set(rows.map((row) => row.name));
    for (const expected of [
      "fleet.created",
      "fleet.vehicle.added",
      "assignment.proposal.status.changed",
      "assignment.signed",
      "maintenance.status.changed",
      "fleet.offroad.reported",
      "driver.availability.saved",
      "vehicle.document.expiring",
      "fleet.conflict.opened",
    ]) {
      expect(names.has(expected), expected).toBe(true);
    }
    for (const row of rows) {
      expect(FLEET_SUBJECT_TYPES as readonly string[]).toContain(
        row.aggregate_type,
      );
      expect(FLEET_ACTOR_TYPES as readonly string[]).toContain(row.actor_type);
      expect(row.idempotency_key.length).toBeLessThanOrEqual(64);
      const parsed = envelopeFromRow(row);
      expect(parsed.ok, `${row.name}: ${parsed.ok ? "" : parsed.error}`).toBe(
        true,
      );
      expect(JSON.stringify(row.payload)).not.toMatch(
        /Okafor|firstName|phone|email/,
      );
    }
    // The signature is audited with its evidence.
    const audit = await h.db.auditLog.findFirstOrThrow({
      where: { subjectId: assignmentId },
    });
    expect(audit.actorId).toBe(driverId);
    // Driver-side events are recorded as the driver.
    const signed = rows.find((row) => row.name === "assignment.signed");
    expect(signed?.actor_type).toBe("driver");
  });
});

describe("boot configuration", () => {
  it("refuses to start in production without a usable UBI_IDENTITY_SECRET", () => {
    expect(() => assertIdentityConfigured({ NODE_ENV: "production" })).toThrow(
      /UBI_IDENTITY_SECRET/,
    );
    expect(() =>
      assertIdentityConfigured({
        NODE_ENV: "production",
        UBI_IDENTITY_SECRET: "short",
      }),
    ).toThrow();
    expect(
      assertIdentityConfigured({
        NODE_ENV: "production",
        UBI_IDENTITY_SECRET: "x".repeat(40),
      }),
    ).toBe(true);
    // Outside production an absent key is the documented unsigned dev mode.
    expect(assertIdentityConfigured({ NODE_ENV: "development" })).toBe(false);
  });
});
