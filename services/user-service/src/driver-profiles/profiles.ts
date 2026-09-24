/**
 * Verified driver-profile read model (P10).
 *
 * ride-service deliberately holds no driver identity or reputation (see
 * docs/marketplace/DRIVER_IDENTITY.md); this is the privacy-limited card it —
 * and ask-service — resolve from here, in one batched call per projection.
 * The wire shape is `DriverProfilesResponseSchema` in @ubi/contracts
 * (packages/contracts/src/driver-profile.ts); the tests parse every response
 * against it.
 *
 * Every field comes from a real row or is explicitly absent:
 *  - rating and completed trips are aggregated from `rides`. The denormalised
 *    `drivers.rating` (column default 5.0) and `drivers.total_rides` counters
 *    are never read — a driver nobody has rated has `rating: null`, not 5.0 and
 *    not 0;
 *  - verification is the reviewer's approval (`drivers.verified_at`) checked
 *    against the documents on file, the expiry dates recorded on the driver
 *    and vehicle rows, and any undecided identity review, so a lapsed licence
 *    stops reading as "verified" even before the sweep runs;
 *  - there is no verified photo or accessibility-capability source in the data
 *    model, so the photo is marked unverified and accessibility "unavailable".
 *
 * Unknown ids, users who are not drivers, and drivers whose account is not
 * ACTIVE (suspended, deactivated, deleted, never activated) resolve to the same
 * `{ driverId, status: "unavailable" }`. Nothing about why is disclosed.
 *
 * Read-only: no state changes, so no outbox event, audit row or idempotency key.
 */
import type { PrismaClient } from "@prisma/client";

export interface DriverProfileDeps {
  readonly prisma: PrismaClient;
  /** The clock document expiry is judged against. */
  readonly now: () => Date;
}

export type VerificationStatus = "verified" | "pending_review" | "not_current";
export type VehicleBodyType =
  | "sedan"
  | "suv"
  | "van"
  | "motorcycle"
  | "electric";

export interface AvailableDriverProfile {
  readonly driverId: string;
  readonly status: "available";
  readonly displayName: string | null;
  readonly initials: string | null;
  readonly photo: { readonly ref: string; readonly verified: boolean } | null;
  readonly verification: {
    readonly status: VerificationStatus;
    readonly verifiedAt: string | null;
  };
  readonly vehicle: {
    readonly make: string | null;
    readonly model: string | null;
    readonly colour: string | null;
    readonly type: VehicleBodyType;
    readonly plateMasked: string;
  } | null;
  readonly rating: { readonly average: number; readonly count: number } | null;
  readonly completedTrips: number;
  readonly memberSince: string;
  readonly accessibility: { readonly status: "unavailable" };
}

export interface UnavailableDriverProfile {
  readonly driverId: string;
  readonly status: "unavailable";
}

export type DriverProfileResolution =
  | AvailableDriverProfile
  | UnavailableDriverProfile;

// ---------------------------------------------------------------------------
// Privacy helpers (pure)
// ---------------------------------------------------------------------------

function firstCodePoint(text: string): string | undefined {
  return Array.from(text)[0];
}

/** The first word of the first name; null when none is on file. */
function givenName(firstName: string): string | null {
  const word = firstName.trim().split(/\s+/)[0] ?? "";
  return word.length === 0 ? null : word;
}

/**
 * First name + last initial ("Adaeze O."). The surname itself never leaves
 * this service. Null when there is no first name to show.
 */
export function displayNameOf(
  firstName: string,
  lastName: string,
): string | null {
  const given = givenName(firstName);
  if (given === null) {
    return null;
  }
  const initial = firstCodePoint(lastName.trim());
  return initial === undefined
    ? given
    : `${given} ${initial.toLocaleUpperCase()}.`;
}

/** Two-letter avatar fallback ("AO"), from the same name parts. */
export function initialsOf(firstName: string, lastName: string): string | null {
  const given = givenName(firstName);
  if (given === null) {
    return null;
  }
  const first = firstCodePoint(given) ?? "";
  const last = firstCodePoint(lastName.trim()) ?? "";
  return `${first}${last}`.toLocaleUpperCase();
}

/**
 * Enough of the plate for a rider to recognise the car, not enough to find
 * it: a fixed "•••" (so the plate's length is not leaked either) and the last
 * two letters or digits. A plate too short to spare two characters shows none.
 * The full plate belongs to the post-award pickup view, not this card.
 */
export function maskPlate(plateNumber: string): string {
  const normalised = plateNumber.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
  const characters = Array.from(normalised);
  if (characters.length < 5) {
    return "•••";
  }
  return `•••${characters.slice(-2).join("")}`;
}

function nonEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

interface DocumentRow {
  readonly ownerType: string;
  readonly ownerId: string;
  readonly type: string;
  readonly status: string;
  readonly expiresAt: Date | null;
}

/**
 * Status of a row synthesised from an expiry DATE recorded on the driver or
 * vehicle itself (`drivers.license_expiry`, `vehicles.insurance_expiry`,
 * `vehicles.inspection_expiry`) rather than an uploaded, reviewed document.
 * Such a date can only make a document type lapse — it never satisfies one,
 * so it cannot mask an expired or rejected upload.
 */
const RECORDED_EXPIRY = "recorded_expiry";

function isCurrentlyValid(row: DocumentRow, now: Date): boolean {
  return (
    row.status === "valid" &&
    (row.expiresAt === null || row.expiresAt.getTime() > now.getTime())
  );
}

function hasLapsed(row: DocumentRow, now: Date): boolean {
  if (row.status === "expired" || row.status === "rejected") {
    return true;
  }
  // A valid document whose date has passed is expired whether or not the
  // hourly sweep has flipped it yet; so is a recorded expiry date.
  return (
    (row.status === "valid" || row.status === RECORDED_EXPIRY) &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() <= now.getTime()
  );
}

/**
 * The expiry dates carried on the driver and vehicle rows, as document rows of
 * the matching type. A driver approved before the documents table existed has
 * nothing uploaded, and this is the only expiry on file for them.
 */
function recordedExpiries(driver: {
  readonly id: string;
  readonly licenseExpiry: Date;
  readonly vehicleId: string | null;
  readonly vehicle: {
    readonly insuranceExpiry: Date | null;
    readonly inspectionExpiry: Date | null;
  } | null;
}): DocumentRow[] {
  const rows: DocumentRow[] = [
    {
      ownerType: "driver",
      ownerId: driver.id,
      type: "licence",
      status: RECORDED_EXPIRY,
      expiresAt: driver.licenseExpiry,
    },
  ];
  if (driver.vehicleId !== null && driver.vehicle !== null) {
    const recorded: readonly [string, Date | null][] = [
      ["insurance", driver.vehicle.insuranceExpiry],
      ["roadworthiness", driver.vehicle.inspectionExpiry],
    ];
    for (const [type, expiresAt] of recorded) {
      if (expiresAt !== null) {
        rows.push({
          ownerType: "vehicle",
          ownerId: driver.vehicleId,
          type,
          status: RECORDED_EXPIRY,
          expiresAt,
        });
      }
    }
  }
  return rows;
}

/**
 * A document type blocks verification when nothing of that type is currently
 * valid and something of that type has lapsed or been rejected — including a
 * recorded expiry date that has passed. A newer valid upload supersedes an old
 * expired one (or a passed recorded date); a first upload still awaiting
 * review blocks nothing on its own (the driver is not approved yet anyway).
 */
function documentsLapsed(
  documents: readonly DocumentRow[],
  now: Date,
): boolean {
  const byType = new Map<string, DocumentRow[]>();
  for (const row of documents) {
    const key = `${row.ownerType}:${row.type}`;
    const rows = byType.get(key) ?? [];
    rows.push(row);
    byType.set(key, rows);
  }
  for (const rows of byType.values()) {
    const satisfied = rows.some((row) => isCurrentlyValid(row, now));
    if (!satisfied && rows.some((row) => hasLapsed(row, now))) {
      return true;
    }
  }
  return false;
}

export function verificationOf(
  verifiedAt: Date | null,
  documents: readonly DocumentRow[],
  identityReviewOpen: boolean,
  now: Date,
): AvailableDriverProfile["verification"] {
  if (verifiedAt === null) {
    return { status: "pending_review", verifiedAt: null };
  }
  if (identityReviewOpen || documentsLapsed(documents, now)) {
    return { status: "not_current", verifiedAt: null };
  }
  return {
    status: "verified",
    verifiedAt: verifiedAt.toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

/** Ratings outside the 1–5 scale are corrupt rows, not opinions. */
const RATING_MIN = 1;
const RATING_MAX = 5;

function roundRating(average: number): number {
  return Math.round(average * 100) / 100;
}

// ---------------------------------------------------------------------------
// Batch resolution
// ---------------------------------------------------------------------------

const VEHICLE_BODY_TYPES: Readonly<Record<string, VehicleBodyType>> = {
  SEDAN: "sedan",
  SUV: "suv",
  VAN: "van",
  MOTORCYCLE: "motorcycle",
  ELECTRIC: "electric",
};

function unavailable(driverId: string): UnavailableDriverProfile {
  return { driverId, status: "unavailable" };
}

/**
 * Resolves driver USER ids (`users.id`, the id ride-service puts on bids) to
 * profiles: one entry per distinct id, in request order. Callers validate the
 * batch (uuid form, size) before calling.
 */
export async function resolveDriverProfiles(
  deps: DriverProfileDeps,
  userIds: readonly string[],
): Promise<DriverProfileResolution[]> {
  const requested = [...new Set(userIds)];
  if (requested.length === 0) {
    return [];
  }
  const now = deps.now();

  const drivers = await deps.prisma.driver.findMany({
    where: { userId: { in: requested } },
    select: {
      id: true,
      userId: true,
      vehicleId: true,
      licenseExpiry: true,
      verifiedAt: true,
      createdAt: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          avatarUrl: true,
          status: true,
          deletedAt: true,
        },
      },
      vehicle: {
        select: {
          make: true,
          model: true,
          color: true,
          plateNumber: true,
          type: true,
          insuranceExpiry: true,
          inspectionExpiry: true,
        },
      },
    },
  });

  // Only an ACTIVE, undeleted account is disclosed. Nothing else is read for
  // the rest, so a suspended driver's stats are never even aggregated.
  const disclosable = drivers.filter(
    (driver) =>
      driver.user.status === "ACTIVE" && driver.user.deletedAt === null,
  );
  const driverIds = disclosable.map((driver) => driver.id);
  const vehicleIds = disclosable
    .map((driver) => driver.vehicleId)
    .filter((id): id is string => id !== null);

  if (driverIds.length === 0) {
    return requested.map(unavailable);
  }

  const [ratings, completed, documents, openCases] = await Promise.all([
    deps.prisma.ride.groupBy({
      by: ["driverId"],
      where: {
        driverId: { in: driverIds },
        status: "COMPLETED",
        driverRating: { gte: RATING_MIN, lte: RATING_MAX },
      },
      _avg: { driverRating: true },
      _count: { driverRating: true },
    }),
    deps.prisma.ride.groupBy({
      by: ["driverId"],
      where: { driverId: { in: driverIds }, status: "COMPLETED" },
      _count: { _all: true },
    }),
    deps.prisma.identityDocument.findMany({
      where: {
        OR: [
          { ownerType: "driver", ownerId: { in: driverIds } },
          ...(vehicleIds.length === 0
            ? []
            : [{ ownerType: "vehicle", ownerId: { in: vehicleIds } }]),
        ],
      },
      select: {
        ownerType: true,
        ownerId: true,
        type: true,
        status: true,
        expiresAt: true,
      },
    }),
    // Any case not yet decided is a live review — including a deactivation
    // one reviewer has proposed and a second has yet to confirm. Same test as
    // the reviewer queue (`listOpenIdentityCases`).
    deps.prisma.identityCase.findMany({
      where: { driverId: { in: driverIds }, status: { not: "decided" } },
      select: { driverId: true },
    }),
  ]);

  const ratingByDriver = new Map<string, { average: number; count: number }>();
  for (const row of ratings) {
    const average = row._avg.driverRating;
    const count = row._count.driverRating;
    if (row.driverId !== null && average !== null && count > 0) {
      ratingByDriver.set(row.driverId, {
        average: roundRating(average),
        count,
      });
    }
  }
  const completedByDriver = new Map<string, number>();
  for (const row of completed) {
    if (row.driverId !== null) {
      completedByDriver.set(row.driverId, row._count._all);
    }
  }
  const documentsByOwner = new Map<string, DocumentRow[]>();
  for (const row of documents) {
    const key = `${row.ownerType}:${row.ownerId}`;
    const rows = documentsByOwner.get(key) ?? [];
    rows.push(row);
    documentsByOwner.set(key, rows);
  }
  const reviewOpen = new Set(openCases.map((row) => row.driverId));

  const byUser = new Map<string, AvailableDriverProfile>();
  for (const driver of disclosable) {
    const ownDocuments = [
      ...(documentsByOwner.get(`driver:${driver.id}`) ?? []),
      ...(driver.vehicleId === null
        ? []
        : (documentsByOwner.get(`vehicle:${driver.vehicleId}`) ?? [])),
      ...recordedExpiries(driver),
    ];
    const avatar =
      driver.user.avatarUrl === null ? null : nonEmpty(driver.user.avatarUrl);
    const vehicle = driver.vehicle;
    const bodyType =
      vehicle === null ? undefined : VEHICLE_BODY_TYPES[vehicle.type];

    byUser.set(driver.userId, {
      driverId: driver.userId,
      status: "available",
      displayName: displayNameOf(driver.user.firstName, driver.user.lastName),
      initials: initialsOf(driver.user.firstName, driver.user.lastName),
      // The self-set account avatar is the only photo on file; nothing has
      // matched it to the driver's identity.
      photo: avatar === null ? null : { ref: avatar, verified: false },
      verification: verificationOf(
        driver.verifiedAt,
        ownDocuments,
        reviewOpen.has(driver.id),
        now,
      ),
      vehicle:
        vehicle === null || bodyType === undefined
          ? null
          : {
              make: nonEmpty(vehicle.make),
              model: nonEmpty(vehicle.model),
              colour: nonEmpty(vehicle.color),
              type: bodyType,
              plateMasked: maskPlate(vehicle.plateNumber),
            },
      rating: ratingByDriver.get(driver.id) ?? null,
      completedTrips: completedByDriver.get(driver.id) ?? 0,
      memberSince: driver.createdAt.toISOString().slice(0, 7),
      accessibility: { status: "unavailable" },
    });
  }

  return requested.map((id) => byUser.get(id) ?? unavailable(id));
}
