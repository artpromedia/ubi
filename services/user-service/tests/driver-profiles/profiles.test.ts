import { ASK_SERVICE_KEY, RIDE_SERVICE_KEY } from "./setup-env";

import { randomInt, randomUUID } from "node:crypto";

import { Hono } from "hono";
import * as jose from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The shared wire contract. Imported from source because @ubi/contracts does
// not re-export it yet; every response below is parsed against it.
import {
  DriverProfilesResponseSchema,
  type AvailableDriverProfile,
  type DriverProfileResolution,
} from "../../../../packages/contracts/src/driver-profile";
import {
  displayNameOf,
  initialsOf,
  maskPlate,
  verificationOf,
} from "../../src/driver-profiles/profiles";
import { prisma } from "../../src/lib/prisma";
import { serviceAuthMiddleware } from "../../src/middleware/service-auth";
import { createDriverProfileRoutes } from "../../src/routes/driver-profiles";
import { INTERNAL_IDENTITY_SECRET } from "../identity/setup-env";

import type { Prisma } from "@prisma/client";

/**
 * Real Postgres, real route handlers, and the production mount order: the
 * driver-profile routes first, then a `protectedApi` group whose
 * `use("*", serviceAuthMiddleware)` trusts plain `x-auth-*` headers outside
 * production. The only thing supplied is the clock.
 */
const NOW = new Date("2026-09-22T10:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

let app: Hono;
let riderId: string;

beforeAll(async () => {
  app = new Hono();
  app.route("/", createDriverProfileRoutes({ prisma, now: () => NOW }));
  const protectedApi = new Hono();
  protectedApi.use("*", serviceAuthMiddleware);
  protectedApi.all("*", (c) =>
    c.json({ success: true, data: { via: "protectedApi" } }),
  );
  app.route("/", protectedApi);

  const riderUser = await createUser({
    firstName: "Rider",
    lastName: "One",
    role: "RIDER",
  });
  const rider = await prisma.rider.create({
    data: { userId: riderUser, referralCode: `REF-${suffix()}` },
    select: { id: true },
  });
  riderId = rider.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let sequence = 0;
function suffix(): string {
  sequence += 1;
  return `${Date.now().toString(36)}${sequence}${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

interface UserInput {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly status?: "PENDING" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
  readonly deletedAt?: Date | null;
  readonly avatarUrl?: string | null;
  readonly role?: "RIDER" | "DRIVER";
}

async function createUser(input: UserInput = {}): Promise<string> {
  const user = await prisma.user.create({
    data: {
      phone: `+2348${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`,
      email: `driver-profile.${suffix()}@test.ubi.africa`,
      passwordHash: "",
      firstName: input.firstName ?? "Adaeze",
      lastName: input.lastName ?? "Okafor",
      country: "NG",
      role: input.role ?? "DRIVER",
      status: input.status ?? "ACTIVE",
      phoneVerified: true,
      avatarUrl: input.avatarUrl ?? null,
      deletedAt: input.deletedAt ?? null,
    },
    select: { id: true },
  });
  return user.id;
}

interface DriverInput extends UserInput {
  readonly verifiedAt?: Date | null;
  readonly createdAt?: Date;
  readonly vehicle?: {
    readonly make?: string;
    readonly model?: string;
    readonly color?: string;
    readonly plateNumber?: string;
    readonly type?: "SEDAN" | "SUV" | "VAN" | "MOTORCYCLE" | "ELECTRIC";
  } | null;
  /** Written straight to the denormalised columns the read model must ignore. */
  readonly storedRating?: number;
  readonly storedTotalRides?: number;
}

interface TestDriver {
  readonly userId: string;
  readonly driverId: string;
  readonly vehicleId: string | null;
  readonly plateNumber: string | null;
}

async function createDriver(input: DriverInput = {}): Promise<TestDriver> {
  const userId = await createUser(input);
  const plateNumber =
    input.vehicle === null
      ? null
      : (input.vehicle?.plateNumber ?? `LND-${suffix().slice(-6)}-AB`);
  const vehicle =
    input.vehicle === null
      ? null
      : await prisma.vehicle.create({
          data: {
            make: input.vehicle?.make ?? "Toyota",
            model: input.vehicle?.model ?? "Corolla",
            year: 2019,
            color: input.vehicle?.color ?? "Silver",
            plateNumber: plateNumber as string,
            type: input.vehicle?.type ?? "SEDAN",
          },
          select: { id: true },
        });
  const driver = await prisma.driver.create({
    data: {
      userId,
      licenseNumber: `LIC-${suffix()}`,
      licenseExpiry: new Date(NOW.getTime() + 365 * DAY_MS),
      vehicleId: vehicle?.id ?? null,
      verifiedAt:
        input.verifiedAt === undefined
          ? new Date("2025-01-10T09:00:00.000Z")
          : input.verifiedAt,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      ...(input.storedRating === undefined
        ? {}
        : { rating: input.storedRating }),
      ...(input.storedTotalRides === undefined
        ? {}
        : { totalRides: input.storedTotalRides }),
    },
    select: { id: true },
  });
  return {
    userId,
    driverId: driver.id,
    vehicleId: vehicle?.id ?? null,
    plateNumber,
  };
}

async function createRide(
  driverId: string,
  status: "COMPLETED" | "CANCELLED" | "IN_PROGRESS",
  driverRating: number | null,
): Promise<void> {
  const data: Prisma.RideUncheckedCreateInput = {
    riderId,
    driverId,
    status,
    rideType: "ECONOMY",
    pickupAddress: "Pickup",
    pickupLatitude: 6.45,
    pickupLongitude: 3.39,
    dropoffAddress: "Dropoff",
    dropoffLatitude: 6.6,
    dropoffLongitude: 3.35,
    estimatedFare: "2500.00",
    currency: "NGN",
    estimatedDistance: 12_000,
    estimatedDuration: 1_800,
    paymentMethod: "CASH",
    driverRating,
    ...(status === "COMPLETED" ? { completedAt: NOW } : {}),
    ...(status === "CANCELLED" ? { cancelledAt: NOW } : {}),
  };
  await prisma.ride.create({ data });
}

async function createDocument(
  ownerType: "driver" | "vehicle",
  ownerId: string,
  type: string,
  status: string,
  expiresAt: Date | null,
  createdAt: Date = NOW,
): Promise<void> {
  await prisma.identityDocument.create({
    data: {
      id: `doc_${suffix()}`,
      ownerType,
      ownerId,
      type,
      fileRef: `s3://ubi-test/${suffix()}`,
      status,
      expiresAt,
      createdAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function serviceHeaders(
  name = "ride-service",
  key: string | null = RIDE_SERVICE_KEY,
): Record<string, string> {
  return {
    "x-service-name": name,
    ...(key === null ? {} : { "x-service-key": key }),
  };
}

interface Envelope {
  readonly success: boolean;
  readonly data?: { profiles: DriverProfileResolution[] };
  readonly error?: { code: string; message: string };
}

async function fetchProfiles(
  ids: readonly string[] | string,
  headers: Record<string, string> = serviceHeaders(),
): Promise<{
  status: number;
  body: Envelope;
  raw: string;
  response: Response;
}> {
  const query = typeof ids === "string" ? ids : ids.join(",");
  const response = await app.fetch(
    new Request(
      `http://user-service.test/internal/driver-profiles?ids=${encodeURIComponent(query)}`,
      { method: "GET", headers },
    ),
  );
  const raw = await response.text();
  return {
    status: response.status,
    body: JSON.parse(raw) as Envelope,
    raw,
    response,
  };
}

/** Fetches, asserts 200, and parses the body against the shared contract. */
async function resolve(
  ids: readonly string[],
): Promise<DriverProfileResolution[]> {
  const result = await fetchProfiles(ids);
  expect(result.status).toBe(200);
  expect(result.body.success).toBe(true);
  return DriverProfilesResponseSchema.parse(result.body.data).profiles;
}

async function resolveOne(userId: string): Promise<AvailableDriverProfile> {
  const [profile] = await resolve([userId]);
  expect(profile?.status).toBe("available");
  return profile as AvailableDriverProfile;
}

async function gatewayIdentity(userId: string, role: string): Promise<string> {
  const key = new TextEncoder().encode(INTERNAL_IDENTITY_SECRET);
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({
    role,
    scp: ["profile:read"],
    mod: [],
    city: "LOS",
    tenant: null,
    sid: null,
    dev: null,
    rid: `req_${randomUUID()}`,
  })
    .setProtectedHeader({ alg: "HS256", kid: "test", typ: "UBI-IC" })
    .setSubject(userId)
    .setIssuer("ubi-gateway")
    .setAudience("ubi-internal")
    .setIssuedAt(now)
    .setExpirationTime(now + 120)
    .sign(key);
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe("only ride-service and ask-service may resolve driver profiles", () => {
  let driver: TestDriver;

  beforeAll(async () => {
    driver = await createDriver();
  });

  beforeEach(() => {
    process.env.DRIVER_PROFILE_RIDE_SERVICE_KEY = RIDE_SERVICE_KEY;
    process.env.DRIVER_PROFILE_ASK_SERVICE_KEY = ASK_SERVICE_KEY;
  });

  afterAll(() => {
    process.env.DRIVER_PROFILE_RIDE_SERVICE_KEY = RIDE_SERVICE_KEY;
    process.env.DRIVER_PROFILE_ASK_SERVICE_KEY = ASK_SERVICE_KEY;
  });

  it("serves ride-service and ask-service, each with its own key", async () => {
    const ride = await fetchProfiles([driver.userId]);
    expect(ride.status).toBe(200);
    const ask = await fetchProfiles(
      [driver.userId],
      serviceHeaders("ask-service", ASK_SERVICE_KEY),
    );
    expect(ask.status).toBe(200);
    expect(ask.body.data).toEqual(ride.body.data);
  });

  it("refuses a request with no credentials", async () => {
    const result = await fetchProfiles([driver.userId], {});
    expect(result.status).toBe(401);
    expect(result.body.error?.code).toBe("unauthorized");
    expect(result.raw).not.toContain(driver.userId);
  });

  it("refuses an end user's gateway-signed identity, even an admin's", async () => {
    for (const role of ["rider", "driver", "admin"]) {
      const result = await fetchProfiles([driver.userId], {
        "x-ubi-identity": await gatewayIdentity(randomUUID(), role),
      });
      expect(result.status).toBe(401);
      expect(result.body.error?.code).toBe("unauthorized");
    }
  });

  it("is not opened by the header-trusting protectedApi bypass mounted after it", async () => {
    const result = await fetchProfiles([driver.userId], {
      "x-internal-service": "true",
      "x-auth-user-id": driver.userId,
      "x-auth-user-role": "admin",
    });
    expect(result.status).toBe(401);
    // Lower-case canonical code: this route answered, not the legacy middleware.
    expect(result.body.error?.code).toBe("unauthorized");
    expect(result.raw).not.toContain("protectedApi");
  });

  it("refuses a caller that is not on the list, whatever key it presents", async () => {
    for (const name of ["payment-service", "gateway", "", "RIDE-SERVICE "]) {
      const result = await fetchProfiles(
        [driver.userId],
        serviceHeaders(name, RIDE_SERVICE_KEY),
      );
      if (name === "RIDE-SERVICE ") {
        // Caller names are case- and whitespace-insensitive; the key still has to match.
        expect(result.status).toBe(200);
        continue;
      }
      expect(result.status).toBe(401);
      expect(result.body.error?.code).toBe("unauthorized");
    }
  });

  it("does not let one caller's key open the door for the other", async () => {
    const swapped = await fetchProfiles(
      [driver.userId],
      serviceHeaders("ride-service", ASK_SERVICE_KEY),
    );
    expect(swapped.status).toBe(401);
    const wrong = await fetchProfiles(
      [driver.userId],
      serviceHeaders("ask-service", `${ASK_SERVICE_KEY}x`),
    );
    expect(wrong.status).toBe(401);
    const missing = await fetchProfiles(
      [driver.userId],
      serviceHeaders("ask-service", null),
    );
    expect(missing.status).toBe(401);
  });

  it("refuses a caller whose own key is not configured", async () => {
    delete process.env.DRIVER_PROFILE_ASK_SERVICE_KEY;
    const result = await fetchProfiles(
      [driver.userId],
      serviceHeaders("ask-service", ASK_SERVICE_KEY),
    );
    expect(result.status).toBe(401);
    // ride-service is unaffected.
    expect((await fetchProfiles([driver.userId])).status).toBe(200);
  });

  it("fails closed when no caller key is configured, or only a weak one", async () => {
    delete process.env.DRIVER_PROFILE_RIDE_SERVICE_KEY;
    delete process.env.DRIVER_PROFILE_ASK_SERVICE_KEY;
    const none = await fetchProfiles([driver.userId]);
    expect(none.status).toBe(503);
    expect(none.body.error?.code).toBe("service_unavailable");

    process.env.DRIVER_PROFILE_RIDE_SERVICE_KEY = "too-short";
    const weak = await fetchProfiles(
      [driver.userId],
      serviceHeaders("ride-service", "too-short"),
    );
    expect(weak.status).toBe(503);
    expect(weak.raw).not.toContain(driver.userId);
  });

  it("authenticates before validating, so a stranger learns nothing about its query", async () => {
    const result = await fetchProfiles("not-a-uuid", {});
    expect(result.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Batch lookup
// ---------------------------------------------------------------------------

describe("batch lookup", () => {
  it("resolves every distinct id once, in request order, with unknowns unavailable", async () => {
    const first = await createDriver({
      firstName: "Bola",
      lastName: "Adeyemi",
    });
    const second = await createDriver({ firstName: "Chidi", lastName: "Eze" });
    const riderOnly = await createUser({ role: "RIDER" });
    const unknown = randomUUID();

    const profiles = await resolve([
      second.userId,
      unknown,
      first.userId,
      riderOnly,
      second.userId,
    ]);

    expect(profiles.map((profile) => profile.driverId)).toEqual([
      second.userId,
      unknown,
      first.userId,
      riderOnly,
    ]);
    expect(profiles.map((profile) => profile.status)).toEqual([
      "available",
      "unavailable",
      "available",
      "unavailable",
    ]);
    expect((profiles[0] as AvailableDriverProfile).displayName).toBe(
      "Chidi E.",
    );
    expect((profiles[2] as AvailableDriverProfile).displayName).toBe("Bola A.");
    expect(profiles[1]).toEqual({ driverId: unknown, status: "unavailable" });
    expect(profiles[3]).toEqual({ driverId: riderOnly, status: "unavailable" });
  });

  it("resolves by the driver's USER id, not drivers.id", async () => {
    const driver = await createDriver();
    const profiles = await resolve([driver.driverId]);
    expect(profiles).toEqual([
      { driverId: driver.driverId, status: "unavailable" },
    ]);
  });

  it("accepts upper-case ids and answers in canonical lower case", async () => {
    const driver = await createDriver();
    const [profile] = await resolve([driver.userId.toUpperCase()]);
    expect(profile).toMatchObject({
      driverId: driver.userId,
      status: "available",
    });
  });

  it("rejects malformed, empty and oversized batches", async () => {
    const malformed = await fetchProfiles(["not-a-uuid"]);
    expect(malformed.status).toBe(422);
    expect(malformed.body.error?.code).toBe("validation_failed");

    const empty = await fetchProfiles("");
    expect(empty.status).toBe(422);

    const oversized = await fetchProfiles(
      Array.from({ length: 51 }, () => randomUUID()),
    );
    expect(oversized.status).toBe(422);

    // Fifty is allowed, and all-unknown is simply fifty "unavailable".
    const fifty = Array.from({ length: 50 }, () => randomUUID());
    const profiles = await resolve(fifty);
    expect(profiles).toHaveLength(50);
    expect(profiles.every((profile) => profile.status === "unavailable")).toBe(
      true,
    );
  });

  it("marks the card uncacheable", async () => {
    const driver = await createDriver();
    const result = await fetchProfiles([driver.userId]);
    expect(result.response.headers.get("cache-control")).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// Honest, null-safe fields
// ---------------------------------------------------------------------------

describe("fields with no real source are null or unavailable, never defaulted", () => {
  it("a driver nobody has rated has rating null — not 0, and not the 5.0 column default", async () => {
    const driver = await createDriver();
    const stored = await prisma.driver.findUniqueOrThrow({
      where: { id: driver.driverId },
      select: { rating: true, totalRides: true },
    });
    // The schema defaults these; the read model must not repeat them.
    expect(stored.rating).toBe(5);

    const profile = await resolveOne(driver.userId);
    expect(profile.rating).toBeNull();
    expect(profile.completedTrips).toBe(0);
    expect(profile.accessibility).toEqual({ status: "unavailable" });
  });

  it("ignores the denormalised drivers.rating / total_rides counters", async () => {
    const driver = await createDriver({
      storedRating: 4.97,
      storedTotalRides: 1_234,
    });
    await createRide(driver.driverId, "COMPLETED", 3);

    const profile = await resolveOne(driver.userId);
    expect(profile.rating).toEqual({ average: 3, count: 1 });
    expect(profile.completedTrips).toBe(1);
  });

  it("no avatar means no photo, and an avatar is never claimed as verified", async () => {
    const without = await createDriver({ avatarUrl: null });
    expect((await resolveOne(without.userId)).photo).toBeNull();

    const blank = await createDriver({ avatarUrl: "   " });
    expect((await resolveOne(blank.userId)).photo).toBeNull();

    const withAvatar = await createDriver({
      avatarUrl: "https://cdn.ubi.test/avatars/abc.jpg",
    });
    expect((await resolveOne(withAvatar.userId)).photo).toEqual({
      ref: "https://cdn.ubi.test/avatars/abc.jpg",
      verified: false,
    });
  });

  it("no attached vehicle means vehicle null", async () => {
    const driver = await createDriver({ vehicle: null });
    const profile = await resolveOne(driver.userId);
    expect(profile.vehicle).toBeNull();
  });

  it("a driver with no first name on file has no display name or initials", async () => {
    const driver = await createDriver({ firstName: "  ", lastName: "Okafor" });
    const profile = await resolveOne(driver.userId);
    expect(profile.displayName).toBeNull();
    expect(profile.initials).toBeNull();
  });

  it("reports tenure as the month the driver profile was created", async () => {
    const driver = await createDriver({
      createdAt: new Date("2024-03-15T12:00:00.000Z"),
    });
    expect((await resolveOne(driver.userId)).memberSince).toBe("2024-03");
  });
});

// ---------------------------------------------------------------------------
// Rating math from real rows
// ---------------------------------------------------------------------------

describe("rating and completed trips come from real trip rows", () => {
  it("averages only completed, in-range ratings and counts completed trips", async () => {
    const driver = await createDriver();
    const other = await createDriver();

    await createRide(driver.driverId, "COMPLETED", 5);
    await createRide(driver.driverId, "COMPLETED", 4);
    await createRide(driver.driverId, "COMPLETED", 4);
    await createRide(driver.driverId, "COMPLETED", null); // completed, unrated
    await createRide(driver.driverId, "COMPLETED", 0); // corrupt: off the scale
    await createRide(driver.driverId, "CANCELLED", 1); // not a completed trip
    await createRide(driver.driverId, "IN_PROGRESS", null);
    // Another driver's trips never bleed into this one.
    await createRide(other.driverId, "COMPLETED", 1);
    await createRide(other.driverId, "COMPLETED", 1);

    const [mine, theirs] = await resolve([driver.userId, other.userId]);
    expect(mine).toMatchObject({
      rating: { average: 4.33, count: 3 },
      completedTrips: 5,
    });
    expect(theirs).toMatchObject({
      rating: { average: 1, count: 2 },
      completedTrips: 2,
    });

    // Independently recomputed straight from the rows.
    const [expected] = await prisma.$queryRaw<
      { average: string; count: bigint; completed: bigint }[]
    >`
      SELECT round((avg(driver_rating) FILTER (WHERE driver_rating BETWEEN 1 AND 5))::numeric, 2)::text AS average,
             count(driver_rating) FILTER (WHERE driver_rating BETWEEN 1 AND 5) AS count,
             count(*) AS completed
        FROM rides
       WHERE driver_id = ${driver.driverId}::uuid AND status = 'COMPLETED'`;
    expect(expected).toBeDefined();
    const row = expected as {
      average: string;
      count: bigint;
      completed: bigint;
    };
    expect((mine as AvailableDriverProfile).rating).toEqual({
      average: Number(row.average),
      count: Number(row.count),
    });
    expect((mine as AvailableDriverProfile).completedTrips).toBe(
      Number(row.completed),
    );
  });

  it("keeps fractional ratings and rounds the mean to two places", async () => {
    const driver = await createDriver();
    await createRide(driver.driverId, "COMPLETED", 4.5);
    await createRide(driver.driverId, "COMPLETED", 5);
    await createRide(driver.driverId, "COMPLETED", 4);
    await createRide(driver.driverId, "COMPLETED", 4);
    await createRide(driver.driverId, "COMPLETED", 5);
    await createRide(driver.driverId, "COMPLETED", 5);
    // (4.5 + 5 + 4 + 4 + 5 + 5) / 6 = 4.5833…
    const profile = await resolveOne(driver.userId);
    expect(profile.rating).toEqual({ average: 4.58, count: 6 });
    expect(profile.completedTrips).toBe(6);
  });

  it("completed trips with no rating give a real count and rating null", async () => {
    const driver = await createDriver();
    await createRide(driver.driverId, "COMPLETED", null);
    await createRide(driver.driverId, "COMPLETED", null);
    const profile = await resolveOne(driver.userId);
    expect(profile.rating).toBeNull();
    expect(profile.completedTrips).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Non-disclosure
// ---------------------------------------------------------------------------

describe("suspended and deactivated drivers are not disclosed", () => {
  it("resolves suspended, deactivated, deleted and never-activated drivers exactly like an unknown id", async () => {
    const suspended = await createDriver({
      status: "SUSPENDED",
      firstName: "Hidden",
      lastName: "Suspended",
      avatarUrl: "https://cdn.ubi.test/avatars/suspended.jpg",
      vehicle: { plateNumber: `SUS-${suffix().slice(-6).toUpperCase()}-ZZ` },
    });
    const deactivated = await createDriver({
      status: "DEACTIVATED",
      deletedAt: NOW,
      firstName: "Hidden",
      lastName: "Deactivated",
    });
    const deletedButActive = await createDriver({ deletedAt: NOW });
    const pending = await createDriver({ status: "PENDING" });
    for (const hidden of [suspended, deactivated, deletedButActive, pending]) {
      await createRide(hidden.driverId, "COMPLETED", 5);
    }
    const unknown = randomUUID();

    const result = await fetchProfiles([
      suspended.userId,
      deactivated.userId,
      deletedButActive.userId,
      pending.userId,
      unknown,
    ]);
    expect(result.status).toBe(200);
    const profiles = DriverProfilesResponseSchema.parse(
      result.body.data,
    ).profiles;

    for (const profile of profiles) {
      // Exactly two keys: nothing else about the driver, and the same shape as
      // an id that was never registered.
      expect(Object.keys(profile).sort()).toEqual(["driverId", "status"]);
      expect(profile.status).toBe("unavailable");
    }
    expect(profiles.map((profile) => profile.driverId)).toEqual([
      suspended.userId,
      deactivated.userId,
      deletedButActive.userId,
      pending.userId,
      unknown,
    ]);
    for (const leaked of [
      "Hidden",
      "Suspended",
      "Deactivated",
      "suspended.jpg",
      "ZZ",
      "rating",
      "suspend",
    ]) {
      expect(result.raw).not.toContain(leaked);
    }
  });
});

// ---------------------------------------------------------------------------
// Privacy: plate masking and names
// ---------------------------------------------------------------------------

describe("privacy-limited card", () => {
  it("masks the plate and never returns surname, contact, licence or location", async () => {
    const driver = await createDriver({
      firstName: "Adaeze Chioma",
      lastName: "okafor",
      vehicle: {
        make: "Toyota",
        model: "Corolla",
        color: "Silver",
        plateNumber: `L${suffix().slice(-7).toUpperCase()}-KJ`,
        type: "SEDAN",
      },
    });
    await prisma.driver.update({
      where: { id: driver.driverId },
      data: { currentLatitude: 6.5244, currentLongitude: 3.3792 },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: driver.userId },
      select: { phone: true, email: true },
    });
    const licence = await prisma.driver.findUniqueOrThrow({
      where: { id: driver.driverId },
      select: { licenseNumber: true },
    });

    const result = await fetchProfiles([driver.userId]);
    const [profile] = DriverProfilesResponseSchema.parse(
      result.body.data,
    ).profiles;
    expect(profile).toMatchObject({
      status: "available",
      displayName: "Adaeze O.",
      initials: "AO",
      vehicle: {
        make: "Toyota",
        model: "Corolla",
        colour: "Silver",
        type: "sedan",
        plateMasked: "•••KJ",
      },
    });

    const plate = driver.plateNumber as string;
    for (const leaked of [
      plate,
      plate.replace(/-/g, ""),
      plate.slice(0, 5),
      "okafor",
      "Okafor",
      "Chioma",
      user.phone,
      user.email,
      licence.licenseNumber,
      "6.5244",
      "3.3792",
      driver.driverId,
      driver.vehicleId as string,
    ]) {
      expect(result.raw).not.toContain(leaked);
    }
  });

  it("maskPlate keeps a fixed prefix and at most the last two characters", () => {
    expect(maskPlate("LND-482-KJ")).toBe("•••KJ");
    expect(maskPlate("abc 123 de")).toBe("•••DE");
    expect(maskPlate("KAA 123A")).toBe("•••3A");
    // Length is not leaked: long and short plates share the prefix.
    expect(maskPlate("ABCDEFGHIJ12")).toBe("•••12");
    // Too short to spare two characters: nothing is shown.
    expect(maskPlate("AB-12")).toBe("•••");
    expect(maskPlate("")).toBe("•••");
    expect(maskPlate("---")).toBe("•••");
  });

  it("names are first name + last initial, from the first word of the first name", () => {
    expect(displayNameOf("Adaeze", "Okafor")).toBe("Adaeze O.");
    expect(displayNameOf("  Mary Jane ", " watson")).toBe("Mary W.");
    expect(displayNameOf("Ẹniọlá", "ọlá")).toBe("Ẹniọlá Ọ.");
    expect(displayNameOf("Ngozi", "")).toBe("Ngozi");
    expect(displayNameOf("", "Okafor")).toBeNull();
    expect(initialsOf("adaeze", "okafor")).toBe("AO");
    expect(initialsOf("Ngozi", " ")).toBe("N");
    expect(initialsOf(" ", "Okafor")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Verification status
// ---------------------------------------------------------------------------

describe("verification status is judged from the approval, documents and reviews", () => {
  const past = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);
  const future = (days: number): Date =>
    new Date(NOW.getTime() + days * DAY_MS);

  it("a never-approved driver is pending review", async () => {
    const driver = await createDriver({ verifiedAt: null });
    expect((await resolveOne(driver.userId)).verification).toEqual({
      status: "pending_review",
      verifiedAt: null,
    });
  });

  it("an approved driver with current documents is verified, with the approval date", async () => {
    const driver = await createDriver({
      verifiedAt: new Date("2025-02-03T08:00:00.000Z"),
    });
    await createDocument(
      "driver",
      driver.driverId,
      "licence",
      "valid",
      future(200),
    );
    await createDocument(
      "vehicle",
      driver.vehicleId as string,
      "insurance",
      "valid",
      future(90),
    );
    expect((await resolveOne(driver.userId)).verification).toEqual({
      status: "verified",
      verifiedAt: "2025-02-03",
    });
  });

  it("a document past its date is not current even before the sweep flips it", async () => {
    const driver = await createDriver();
    await createDocument(
      "vehicle",
      driver.vehicleId as string,
      "insurance",
      "valid",
      past(1),
    );
    expect((await resolveOne(driver.userId)).verification).toEqual({
      status: "not_current",
      verifiedAt: null,
    });
  });

  it("a rejected document makes the verification not current", async () => {
    const driver = await createDriver();
    await createDocument("driver", driver.driverId, "lasdri", "rejected", null);
    expect((await resolveOne(driver.userId)).verification.status).toBe(
      "not_current",
    );
  });

  it("a newer valid upload supersedes an old expired one", async () => {
    const driver = await createDriver();
    await createDocument(
      "driver",
      driver.driverId,
      "licence",
      "expired",
      past(30),
      past(400),
    );
    await createDocument(
      "driver",
      driver.driverId,
      "licence",
      "valid",
      future(300),
    );
    expect((await resolveOne(driver.userId)).verification.status).toBe(
      "verified",
    );
  });

  it("an open identity review makes the verification not current, without saying why", async () => {
    const driver = await createDriver();
    await prisma.identityCase.create({
      data: {
        id: `case_${suffix()}`,
        driverId: driver.driverId,
        signals: { liveness: "mismatch" },
        status: "open",
      },
    });
    const result = await fetchProfiles([driver.userId]);
    const [profile] = DriverProfilesResponseSchema.parse(
      result.body.data,
    ).profiles;
    expect((profile as AvailableDriverProfile).verification).toEqual({
      status: "not_current",
      verifiedAt: null,
    });
    expect(result.raw).not.toContain("liveness");
    expect(result.raw).not.toContain("mismatch");
  });

  it("a review awaiting its second reviewer is still open; a decided one is not", async () => {
    // A proposed deactivation needs two reviewers (identity/cases.ts): while
    // it waits for the second, the driver is still under review.
    const awaiting = await createDriver();
    await prisma.identityCase.create({
      data: {
        id: `case_${suffix()}`,
        driverId: awaiting.driverId,
        signals: { liveness: "mismatch" },
        status: "awaiting_second_reviewer",
        decision: "deactivate",
        decidedBy: [randomUUID()],
      },
    });
    const reinstated = await createDriver();
    await prisma.identityCase.create({
      data: {
        id: `case_${suffix()}`,
        driverId: reinstated.driverId,
        signals: { liveness: "mismatch" },
        status: "decided",
        decision: "reinstate",
        decidedBy: [randomUUID()],
      },
    });
    const [underReview, cleared] = await resolve([
      awaiting.userId,
      reinstated.userId,
    ]);
    expect((underReview as AvailableDriverProfile).verification).toEqual({
      status: "not_current",
      verifiedAt: null,
    });
    expect((cleared as AvailableDriverProfile).verification.status).toBe(
      "verified",
    );
  });

  it("a licence whose recorded expiry has passed is not current unless a valid licence was uploaded since", async () => {
    // drivers.license_expiry is the one expiry every driver row carries, even
    // one approved before the documents table existed.
    const lapsed = await createDriver();
    await prisma.driver.update({
      where: { id: lapsed.driverId },
      data: { licenseExpiry: past(2) },
    });
    const renewed = await createDriver();
    await prisma.driver.update({
      where: { id: renewed.driverId },
      data: { licenseExpiry: past(2) },
    });
    await createDocument(
      "driver",
      renewed.driverId,
      "licence",
      "valid",
      future(700),
    );
    const awaitingReview = await createDriver();
    await prisma.driver.update({
      where: { id: awaitingReview.driverId },
      data: { licenseExpiry: past(2) },
    });
    await createDocument(
      "driver",
      awaitingReview.driverId,
      "licence",
      "pending",
      future(700),
    );

    const [a, b, c] = await resolve([
      lapsed.userId,
      renewed.userId,
      awaitingReview.userId,
    ]);
    expect((a as AvailableDriverProfile).verification.status).toBe(
      "not_current",
    );
    expect((b as AvailableDriverProfile).verification.status).toBe("verified");
    expect((c as AvailableDriverProfile).verification.status).toBe(
      "not_current",
    );
  });

  it("a recorded vehicle insurance or inspection expiry that has passed is not current", async () => {
    const insurance = await createDriver();
    await prisma.vehicle.update({
      where: { id: insurance.vehicleId as string },
      data: { insuranceExpiry: past(1) },
    });
    const inspection = await createDriver();
    await prisma.vehicle.update({
      where: { id: inspection.vehicleId as string },
      data: { inspectionExpiry: past(1) },
    });
    const current = await createDriver();
    await prisma.vehicle.update({
      where: { id: current.vehicleId as string },
      data: { insuranceExpiry: future(30), inspectionExpiry: future(30) },
    });
    const [a, b, c] = await resolve([
      insurance.userId,
      inspection.userId,
      current.userId,
    ]);
    expect((a as AvailableDriverProfile).verification.status).toBe(
      "not_current",
    );
    expect((b as AvailableDriverProfile).verification.status).toBe(
      "not_current",
    );
    expect((c as AvailableDriverProfile).verification.status).toBe("verified");
  });

  it("a recorded expiry still in the future never masks a lapsed uploaded document", async () => {
    const driver = await createDriver();
    // license_expiry is a year out (fixture default), but the reviewed
    // licence on file has expired.
    await createDocument(
      "driver",
      driver.driverId,
      "licence",
      "expired",
      past(5),
      past(400),
    );
    expect((await resolveOne(driver.userId)).verification.status).toBe(
      "not_current",
    );
  });

  it("verificationOf treats a pending first upload as blocking nothing on its own", () => {
    expect(
      verificationOf(
        past(10),
        [
          {
            ownerType: "driver",
            ownerId: "d",
            type: "background_check",
            status: "pending",
            expiresAt: null,
          },
        ],
        false,
        NOW,
      ).status,
    ).toBe("verified");
  });
});
