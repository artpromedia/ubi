/**
 * SqlPartyDirectory against REAL Postgres (NOTIFY_TEST_DATABASE_URL, migrated
 * to the shared Prisma schema).
 *
 *   - mp.awards / mp.requests are ride-service's (Go-owned, not Prisma); the
 *     suite creates a throwaway schema with the columns the directory reads
 *     (id, requester_id, driver_id — the names in ride-service
 *     internal/marketplace/schema.sql) and drops it afterwards;
 *   - AirportTransfer.userId and User.phone/phoneVerified are the real shared
 *     tables, written through Prisma and removed afterwards.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SqlPartyDirectory } from "./parties.js";

const TEST_DATABASE_URL =
  process.env.NOTIFY_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_notify_test";

const RUN = randomBytes(4).toString("hex");
const SCHEMA = `notify_test_mp_${RUN}`;

const db = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
  log: ["error"],
});

const requester = randomUUID();
const driver = randomUUID();
const awardId = randomUUID();
const requestId = randomUUID();
const supplierId = `sup_notify_${RUN}`;
const orderId = `ord_notify_${RUN}`;
const transferId = `trf_notify_${RUN}`;
const traveller = randomUUID();
const verifiedUser = randomUUID();
const unverifiedUser = randomUUID();
const deletedUser = randomUUID();

function user(id: string, phone: string, verified: boolean, deleted = false) {
  return {
    id,
    email: `notify-${RUN}-${id.slice(0, 8)}@test.ubi`,
    phone,
    passwordHash: "x",
    firstName: "Test",
    lastName: "User",
    country: "NG",
    phoneVerified: verified,
    deletedAt: deleted ? new Date() : null,
  };
}

beforeAll(async () => {
  await db.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);
  await db.$executeRawUnsafe(
    `CREATE TABLE "${SCHEMA}".requests (id uuid PRIMARY KEY, requester_id uuid NOT NULL)`,
  );
  await db.$executeRawUnsafe(
    `CREATE TABLE "${SCHEMA}".awards (id uuid PRIMARY KEY, request_id uuid NOT NULL, driver_id uuid NOT NULL, requester_id uuid NOT NULL)`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "${SCHEMA}".requests (id, requester_id) VALUES ($1::uuid, $2::uuid)`,
    requestId,
    requester,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "${SCHEMA}".awards (id, request_id, driver_id, requester_id) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    awardId,
    requestId,
    driver,
    requester,
  );

  await db.travelSupplier.create({
    data: { id: supplierId, kind: "flight", adapter: "test", config: {} },
  });
  await db.travelOrder.create({
    data: {
      id: orderId,
      userId: traveller,
      kind: "flight",
      supplierId,
      state: "ticketed",
      offerSnapshot: {},
      capabilities: {},
      priceMinor: BigInt(1_000_000),
      currency: "NGN",
      policy: {},
      idempotencyKey: `idem_notify_${RUN}`,
    },
  });
  await db.airportTransfer.create({
    data: {
      id: transferId,
      orderId,
      userId: traveller,
      cityId: "lagos",
      direction: "arrival_pickup",
      legIndex: 0,
      airportCode: "LOS",
      flightDepartAt: new Date("2026-09-24T05:00:00Z"),
      flightArriveAt: new Date("2026-09-24T07:00:00Z"),
      pickup: { label: "LOS", lat: 6.58, lng: 3.32 },
      dropoff: { label: "Home", lat: 6.45, lng: 3.4 },
      timeZone: "Africa/Lagos",
      windowSec: 1800,
      vehicleClass: "standard",
      currency: "NGN",
      maxFareMinor: BigInt(500_000),
      paymentMethodId: "wallet",
      policyVersion: "airport-transfer.v1",
      state: "requested",
      submitAfter: new Date("2026-09-23T07:00:00Z"),
      requestHash: "h",
      createResult: {},
    },
  });

  const n = Number.parseInt(RUN, 16) % 10_000_000;
  await db.user.createMany({
    data: [
      user(verifiedUser, `+23480${String(n).padStart(8, "0")}`, true),
      user(unverifiedUser, `+23481${String(n).padStart(8, "0")}`, false),
      user(deletedUser, `+23482${String(n).padStart(8, "0")}`, true, true),
    ],
  });
});

afterAll(async () => {
  await db.user.deleteMany({
    where: { id: { in: [verifiedUser, unverifiedUser, deletedUser] } },
  });
  await db.airportTransfer.deleteMany({ where: { id: transferId } });
  await db.travelOrder.deleteMany({ where: { id: orderId } });
  await db.travelSupplier.deleteMany({ where: { id: supplierId } });
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await db.$disconnect();
});

describe("SqlPartyDirectory (real Postgres)", () => {
  const directory = () =>
    new SqlPartyDirectory(db, { marketplaceSchema: SCHEMA });

  it("resolves an award's requester and driver from the marketplace tables", async () => {
    expect(await directory().award(awardId)).toEqual({
      requesterId: requester,
      driverId: driver,
    });
  });

  it("resolves a request's requester", async () => {
    expect(await directory().requester(requestId)).toBe(requester);
  });

  it("answers null for unknown or malformed ids (never a guess)", async () => {
    expect(await directory().award(randomUUID())).toBeNull();
    expect(await directory().requester(randomUUID())).toBeNull();
    expect(await directory().award("'; DROP TABLE x; --")).toBeNull();
    expect(await directory().traveller("trf_unknown")).toBeNull();
  });

  it("resolves an airport transfer's traveller from the shared AirportTransfer model", async () => {
    expect(await directory().traveller(transferId)).toBe(traveller);
  });

  it("returns a phone only when it is the account holder's own VERIFIED, live number", async () => {
    const n = Number.parseInt(RUN, 16) % 10_000_000;
    expect(await directory().verifiedPhone(verifiedUser)).toBe(
      `+23480${String(n).padStart(8, "0")}`,
    );
    expect(await directory().verifiedPhone(unverifiedUser)).toBeNull();
    expect(await directory().verifiedPhone(deletedUser)).toBeNull();
    expect(await directory().verifiedPhone(randomUUID())).toBeNull();
    expect(await directory().verifiedPhone("not-a-uuid")).toBeNull();
  });

  it("throws (so the deliverer records lookup_failed) when the marketplace schema is absent", async () => {
    const missing = new SqlPartyDirectory(db, {
      marketplaceSchema: `notify_absent_${RUN}`,
    });
    await expect(missing.award(awardId)).rejects.toThrow();
  });

  it("refuses a schema name that is not a plain identifier", () => {
    expect(
      () => new SqlPartyDirectory(db, { marketplaceSchema: 'mp"; --' }),
    ).toThrow();
  });
});
