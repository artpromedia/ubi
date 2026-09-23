/**
 * Fixtures and wiring for the fleet-service tests.
 *
 * These run against a REAL PostgreSQL database (FLEET_TEST_DATABASE_URL): the
 * EXCLUDE constraints that refuse overlapping signed shifts and maintenance,
 * the CHECK constraints on terms, the unique idempotency keys and the
 * transactional outbox are Postgres's, not a mock's memory. ride-service and
 * user-service are reached through the REAL HTTP ports over sockets, against
 * faithful doubles written from their contracts (tests/doubles/). Identity
 * contexts are minted by the API gateway's own signer.
 */
import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { signIdentityContext } from "../../api-gateway/src/identity/context";
import { createApp } from "../src/index";
import { createCityConfigProvider } from "../src/ops/config";
import { createHttpPinPort } from "../src/ports/pin-port";
import { createHttpRidePort } from "../src/ports/ride-port";

import { startPinDouble, type PinDouble } from "./doubles/pin-double";
import { startRideDouble, type RideDouble } from "./doubles/ride-double";

import type { Scope } from "../../api-gateway/src/identity/scopes";
import type { FleetDeps } from "../src/ops/context";
import type { FleetDb } from "../src/ops/types";
import type { Hono } from "hono";

export const TEST_DATABASE_URL =
  process.env.FLEET_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_fleet_test";

let client: PrismaClient | undefined;

export function testDb(): FleetDb {
  if (client === undefined) {
    client = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
      log: ["error"],
    });
  }
  return client as unknown as FleetDb;
}

export async function closeTestDb(): Promise<void> {
  if (client !== undefined) {
    await client.$disconnect();
    client = undefined;
  }
}

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${process.pid.toString(36)}_${Date.now().toString(36)}_${counter}`;
}

export function idemKey(label = "k"): string {
  return uid(label).replace(/[^A-Za-z0-9_.:-]/g, "-");
}

/** Every fleet row, so each file starts from a clean fleet world. */
export async function resetFleet(db: FleetDb): Promise<void> {
  await db.fleetAssignmentShiftSegment.deleteMany({});
  await db.fleetAssignment.deleteMany({});
  await db.fleetAssignmentProposal.deleteMany({});
  await db.fleetMaintenanceBlock.deleteMany({});
  await db.fleetConflict.deleteMany({});
  await db.fleetVehicleSwapRequest.deleteMany({});
  await db.fleetIdempotencyRecord.deleteMany({});
  await db.driverAvailability.deleteMany({});
  const vehicles = await db.fleetVehicle.findMany({
    select: { vehicleId: true },
  });
  await db.fleetVehicle.deleteMany({});
  await db.vehicle.deleteMany({
    where: { id: { in: vehicles.map((row) => row.vehicleId) } },
  });
  await db.fleetStaff.deleteMany({});
  await db.fleet.deleteMany({});
  await db.outboxEvent.deleteMany({ where: { name: { in: FLEET_EVENTS } } });
}

const FLEET_EVENTS = [
  "fleet.created",
  "fleet.staff.changed",
  "fleet.vehicle.added",
  "assignment.proposal.status.changed",
  "assignment.signed",
  "assignment.status.changed",
  "maintenance.status.changed",
  "fleet.offroad.reported",
  "fleet.offroad.flagged",
  "fleet.conflict.opened",
  "fleet.conflict.resolved",
  "fleet.conflict.lapsed",
  "fleet.conflict.reminder_sent",
  "vehicle.document.expiring",
  "vehicle.document.expired",
  "driver.availability.saved",
  "fleet.vehicle_swap.requested",
];

// ── Cities ─────────────────────────────────────────────────────────────────

export interface SeedCityOptions {
  readonly fleet?: boolean;
  readonly timezone?: string;
  readonly remittanceCapMinor?: number;
  readonly vehicleClasses?: readonly string[];
  readonly fleetPolicy?: Record<string, unknown>;
}

export async function seedCity(
  db: FleetDb,
  options: SeedCityOptions = {},
): Promise<string> {
  const cityId = uid("city");
  const timezone = options.timezone ?? "Africa/Lagos";
  const config: Record<string, unknown> = {
    cityId,
    version: 1,
    currency: "NGN",
    currencyFractionDigits: 2,
    locale: "en-NG",
    timezone,
    emergencyNumber: "112",
    vehicleClasses: options.vehicleClasses ?? ["go", "comfort", "xl"],
    fares: {
      go: {
        baseMinor: 50_000,
        perKmMinor: 12_000,
        perMinMinor: 3_000,
        bookingFeeMinor: 10_000,
        minFareMinor: 80_000,
      },
    },
    waitPolicy: { freeSec: 300, perMinMinor: 5_000 },
    cancelPolicy: {
      riderFeeAfterAssignMinor: 30_000,
      driverFeeMinor: 0,
      freeWindowSec: 120,
    },
    pinRequired: true,
    quoteTtlSec: 120,
    offerTtlSec: 20,
    matchingRings: [{ radiusMeters: 1500, maxCandidates: 8 }],
    arrivedGeofenceMeters: 120,
    maxPinAttempts: 5,
    paymentMethods: [{ id: "wallet", available: true }],
    kycTiers: [
      {
        tier: "tier1",
        dailyOutMinor: 5_000_000,
        singleTransferMinor: 2_000_000,
        balanceCapMinor: 30_000_000,
      },
    ],
    serviceFeePct: 20,
    remittanceCapMinor: options.remittanceCapMinor ?? 15_000_000,
    reservationFreeReleaseSec: 900,
    airport: {
      codes: ["LOS"],
      arrivalBufferMin: 45,
      checkInCutoffMin: 60,
      trafficBufferMin: 30,
      doors: { LOS: "D" },
    },
    taxes: { vat: 7.5 },
    ...(options.fleetPolicy === undefined
      ? {}
      : { fleet: options.fleetPolicy }),
  };
  await db.city.create({
    data: {
      id: cityId,
      name: cityId,
      country: "NG",
      timezone,
      active: true,
      status: "active",
    },
  });
  await db.cityConfigVersion.create({
    data: {
      id: uid("cfg"),
      cityId,
      version: 1,
      config: config as never,
      activatedAt: new Date(),
      createdBy: "seed",
      approvedBy: "seed-approver",
    },
  });
  await db.featureFlag.upsert({
    where: { key: "fleet" },
    create: { key: "fleet", defaultOn: false },
    update: {},
  });
  await db.flagRule.upsert({
    where: { flagKey_cityId: { flagKey: "fleet", cityId } },
    create: {
      id: uid("rule"),
      flagKey: "fleet",
      cityId,
      enabled: options.fleet ?? true,
    },
    update: { enabled: options.fleet ?? true },
  });
  return cityId;
}

export async function setFleetFlag(
  db: FleetDb,
  cityId: string,
  enabled: boolean,
): Promise<void> {
  await db.flagRule.update({
    where: { flagKey_cityId: { flagKey: "fleet", cityId } },
    data: { enabled },
  });
}

// ── People ─────────────────────────────────────────────────────────────────

export async function seedUser(
  db: FleetDb,
  options: {
    driver?: boolean;
    status?: "ACTIVE" | "SUSPENDED";
    firstName?: string;
    lastName?: string;
  } = {},
): Promise<string> {
  const tag = randomUUID().slice(0, 12);
  const user = await db.user.create({
    data: {
      email: `fleet.${tag}@test.ubi.africa`,
      phone: `+23480${Math.floor(Math.random() * 1e9)
        .toString()
        .padStart(9, "0")}`,
      passwordHash: "not-a-real-hash",
      firstName: options.firstName ?? "Ada",
      lastName: options.lastName ?? "Okafor",
      role: options.driver === true ? "DRIVER" : "RIDER",
      status: options.status ?? "ACTIVE",
      country: "NG",
    },
  });
  if (options.driver === true) {
    await db.driver.create({
      data: {
        userId: user.id,
        licenseNumber: `LIC-${tag}`,
        licenseExpiry: new Date("2030-01-01T00:00:00Z"),
      },
    });
  }
  return user.id;
}

const STAFF_SCOPES: readonly Scope[] = [
  "fleet:read",
  "fleet:manage",
  "wallet:read",
] as unknown as readonly Scope[];
const DRIVER_SCOPES: readonly Scope[] = [
  "fleet:driver",
  "wallet:read",
] as unknown as readonly Scope[];

export async function tokenFor(
  userId: string,
  cityId: string | null,
  options: {
    kind?: "staff" | "driver";
    scopes?: readonly string[];
    modes?: readonly string[];
    ttlSeconds?: number;
    role?: string;
  } = {},
): Promise<string> {
  const scopes =
    options.scopes ??
    (options.kind === "driver" ? DRIVER_SCOPES : STAFF_SCOPES);
  return signIdentityContext(
    {
      userId,
      role: options.role ?? (options.kind === "driver" ? "driver" : "rider"),
      scopes: scopes as readonly Scope[],
      modes: (options.modes ?? []) as never,
      cityId,
      tenantId: null,
      sessionId: null,
      deviceId: null,
      requestId: `req_${randomUUID()}`,
    },
    options.ttlSeconds,
  );
}

// ── Harness ────────────────────────────────────────────────────────────────

export interface Clock {
  now: Date;
}

export interface Harness {
  readonly app: Hono;
  readonly deps: FleetDeps;
  readonly db: FleetDb;
  readonly ride: RideDouble;
  readonly pin: PinDouble;
  readonly clock: Clock;
  close(): Promise<void>;
}

/** Monday 28 Sep 2026, 09:00 in Lagos. */
export const DEFAULT_NOW = new Date("2026-09-28T08:00:00.000Z");

export async function startHarness(now: Date = DEFAULT_NOW): Promise<Harness> {
  const db = testDb();
  const ride = await startRideDouble();
  const pin = await startPinDouble();
  const clock: Clock = { now };
  const deps: FleetDeps = {
    db,
    config: createCityConfigProvider(db),
    rides: createHttpRidePort({
      baseUrl: ride.url,
      serviceKey: process.env.FLEET_RIDE_SERVICE_KEY,
    }),
    pins: createHttpPinPort({ baseUrl: pin.url, now: () => clock.now }),
    now: () => clock.now,
  };
  return {
    app: createApp(deps),
    deps,
    db,
    ride,
    pin,
    clock,
    async close() {
      await ride.close();
      await pin.close();
    },
  };
}

export interface ApiCall {
  readonly method?: string;
  readonly path: string;
  readonly token?: string | null;
  readonly city?: string | null;
  readonly body?: unknown;
  readonly idem?: string | null;
  readonly headers?: Record<string, string>;
}

export interface ApiResult<T = Record<string, unknown>> {
  readonly status: number;
  readonly body: T;
}

export async function api<T = Record<string, unknown>>(
  app: Hono,
  call: ApiCall,
): Promise<ApiResult<T>> {
  const method = call.method ?? "GET";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(call.headers ?? {}),
  };
  if (call.token !== undefined && call.token !== null) {
    headers["x-ubi-identity"] = call.token;
  }
  if (call.city !== undefined && call.city !== null) {
    headers["x-auth-city-id"] = call.city;
    headers["x-ubi-city-id"] = call.city;
  }
  if (call.idem !== null && method !== "GET") {
    headers["idempotency-key"] = call.idem ?? idemKey("req");
  }
  const response = await app.fetch(
    new Request(`http://fleet.test${call.path}`, {
      method,
      headers,
      ...(call.body === undefined || method === "GET"
        ? {}
        : { body: JSON.stringify(call.body) }),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    body: (text.length === 0 ? {} : JSON.parse(text)) as T,
  };
}

// ── Common fleet fixtures ──────────────────────────────────────────────────

export interface FleetWorld {
  readonly cityId: string;
  readonly fleetId: string;
  readonly ownerId: string;
  readonly ownerToken: string;
}

export async function seedFleet(
  h: Harness,
  options: SeedCityOptions = {},
): Promise<FleetWorld> {
  const cityId = await seedCity(h.db, options);
  const ownerId = await seedUser(h.db, { firstName: "Olu", lastName: "Owner" });
  const ownerToken = await tokenFor(ownerId, cityId);
  const created = await api<{ fleetId: string }>(h.app, {
    method: "POST",
    path: "/v1/fleets",
    token: ownerToken,
    city: cityId,
    body: { name: "Eko Fleet" },
  });
  if (created.status !== 201) {
    throw new Error(
      `fleet create failed: ${created.status} ${JSON.stringify(created.body)}`,
    );
  }
  return { cityId, fleetId: created.body.fleetId, ownerId, ownerToken };
}

export async function addStaff(
  h: Harness,
  world: FleetWorld,
  role: "manager" | "read_only",
): Promise<{ userId: string; token: string }> {
  const userId = await seedUser(h.db, {
    firstName: role === "manager" ? "Mo" : "Ren",
  });
  const current = await h.db.fleetStaff.findMany({
    where: { fleetId: world.fleetId, status: "active" },
  });
  const result = await api(h.app, {
    method: "PUT",
    path: `/v1/fleets/${world.fleetId}/staff`,
    token: world.ownerToken,
    city: world.cityId,
    body: {
      staff: [
        ...current.map((row) => ({ userId: row.userId, role: row.role })),
        { userId, role },
      ],
    },
  });
  if (result.status !== 200) {
    throw new Error(
      `staff put failed: ${result.status} ${JSON.stringify(result.body)}`,
    );
  }
  return { userId, token: await tokenFor(userId, world.cityId) };
}

export async function addVehicle(
  h: Harness,
  world: FleetWorld,
  options: {
    classes?: string[];
    capacity?: number;
    insuranceExpiry?: Date | null;
    inspectionExpiry?: Date | null;
  } = {},
): Promise<string> {
  const plate = `TST-${randomUUID().slice(0, 6).toUpperCase()}`;
  const result = await api<{ vehicleId: string }>(h.app, {
    method: "POST",
    path: `/v1/fleets/${world.fleetId}/vehicles`,
    token: world.ownerToken,
    city: world.cityId,
    body: {
      plate,
      make: "Toyota",
      model: "Corolla",
      year: 2021,
      color: "Silver",
      type: "SEDAN",
      capacity: options.capacity ?? 4,
      classes: options.classes ?? ["go"],
    },
  });
  if (result.status !== 201) {
    throw new Error(
      `vehicle add failed: ${result.status} ${JSON.stringify(result.body)}`,
    );
  }
  // UBI verifies documents; the tests set what UBI would hold.
  await h.db.vehicle.update({
    where: { id: result.body.vehicleId },
    data: {
      insuranceExpiry:
        options.insuranceExpiry === undefined
          ? new Date("2027-06-30T00:00:00Z")
          : options.insuranceExpiry,
      inspectionExpiry:
        options.inspectionExpiry === undefined
          ? new Date("2027-06-30T00:00:00Z")
          : options.inspectionExpiry,
    },
  });
  return result.body.vehicleId;
}

export const OWNER_TERMS = {
  type: "weekly_fixed",
  amountMinor: 2_500_000,
  shortfall: { policy: "carry_forward", maxWeeks: 4 },
  fuelBy: "driver",
  servicingBy: "fleet",
} as const;

/** Proposes (as the owner) and signs (as the driver, with the double's PIN). */
export async function signedArrangement(
  h: Harness,
  world: FleetWorld,
  input: {
    vehicleId: string;
    driverId: string;
    shift: unknown;
    validFrom: string;
    validTo?: string;
    pin?: string;
  },
): Promise<{ proposalId: string; assignmentId: string }> {
  const proposal = await api<{ proposalId: string }>(h.app, {
    method: "POST",
    path: `/v1/fleets/${world.fleetId}/assignments/propose`,
    token: world.ownerToken,
    city: world.cityId,
    body: {
      vehicleId: input.vehicleId,
      driverId: input.driverId,
      shift: input.shift,
      validFrom: input.validFrom,
      ...(input.validTo === undefined ? {} : { validTo: input.validTo }),
      terms: OWNER_TERMS,
    },
  });
  if (proposal.status !== 201) {
    throw new Error(
      `propose failed: ${proposal.status} ${JSON.stringify(proposal.body)}`,
    );
  }
  if (!h.pin.wallets.has(input.driverId)) {
    h.pin.setPin(input.driverId, input.pin ?? "4321");
  }
  const driverToken = await tokenFor(input.driverId, world.cityId, {
    kind: "driver",
  });
  const signed = await api<{ arrangement: { assignmentId: string } }>(h.app, {
    method: "POST",
    path: `/v1/fleet-offers/${proposal.body.proposalId}/sign`,
    token: driverToken,
    city: world.cityId,
    body: { pin: input.pin ?? "4321" },
  });
  if (signed.status !== 200) {
    throw new Error(
      `sign failed: ${signed.status} ${JSON.stringify(signed.body)}`,
    );
  }
  return {
    proposalId: proposal.body.proposalId,
    assignmentId: signed.body.arrangement.assignmentId,
  };
}
