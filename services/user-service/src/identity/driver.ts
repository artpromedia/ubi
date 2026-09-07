/**
 * Server-side driver availability.
 *
 * Two things in this slice can take a driver offline: an expired document and a
 * failed face check. Both do it HERE, by writing `drivers.is_online = false` in
 * the same transaction as the finding. The client is not asked to comply and
 * cannot decline: whatever the app believes, matching reads the row.
 *
 * Neither one deactivates the account. A driver who is offline is told why and
 * how to appeal (slice 03 guards).
 */
import type { Prisma } from "@prisma/client";

import { writeAudit, type Tx } from "./audit";
import { auditRevision } from "./common";
import type { IdentityDeps } from "./deps";
import { eventIdempotencyKey, writeOutboxEvent } from "./outbox";

/** Where a driver disputes an offline decision. Shown with every reason. */
export const APPEAL_PATH = "/support/cases?topic=identity_review";
export const APPEAL_MESSAGE =
  "If you think this is wrong, open a review from Support and a person will look at it.";

export interface OfflineInput {
  readonly driverId: string;
  readonly reasons: readonly string[];
  readonly actorId: string;
  readonly actorRole: string;
  readonly cityId: string | null;
  readonly occurredAt: Date;
}

/**
 * Forces a driver offline. Returns false when they were already offline, so a
 * sweep that runs hourly does not emit the same event every hour.
 */
export async function takeDriverOffline(
  tx: Tx,
  input: OfflineInput,
): Promise<boolean> {
  const driver = await tx.driver.findUnique({
    where: { id: input.driverId },
    select: { id: true, isOnline: true, isAvailable: true },
  });
  if (driver === null) return false;
  if (!driver.isOnline && !driver.isAvailable) return false;

  await tx.driver.update({
    where: { id: input.driverId },
    data: { isOnline: false, isAvailable: false },
  });

  const revision = await auditRevision(tx, "driver", input.driverId);
  await writeAudit(tx, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "driver.forced_offline",
    subjectType: "driver",
    subjectId: input.driverId,
    before: { isOnline: driver.isOnline, isAvailable: driver.isAvailable },
    after: { isOnline: false, isAvailable: false },
    reason: input.reasons.join(","),
  });

  const payload: Prisma.InputJsonObject = {
    driverId: input.driverId,
    online: false,
    reasons: [...input.reasons],
    appealPath: APPEAL_PATH,
  };

  await writeOutboxEvent(tx, {
    name: "driver.status_changed",
    subjectType: "driver",
    subjectId: input.driverId,
    actorType: "system",
    actorId: input.actorId,
    idempotencyKey: eventIdempotencyKey(
      "driver.status_changed",
      input.driverId,
      input.occurredAt.toISOString(),
    ),
    fromVersion: revision,
    toVersion: revision + 1,
    cityId: input.cityId,
    payload,
    occurredAt: input.occurredAt,
  });

  await writeOutboxEvent(tx, {
    name: "driver.eligibility_changed",
    subjectType: "driver",
    subjectId: input.driverId,
    actorType: "system",
    actorId: input.actorId,
    idempotencyKey: eventIdempotencyKey(
      "driver.eligibility_changed",
      input.driverId,
      input.occurredAt.toISOString(),
    ),
    fromVersion: revision,
    toVersion: revision + 1,
    cityId: input.cityId,
    payload,
    occurredAt: input.occurredAt,
  });

  return true;
}

export interface Eligibility {
  readonly driverId: string;
  readonly online: boolean;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly appealPath: string;
  readonly appealMessage: string;
}

/**
 * Why a driver can or cannot go online, in words they can act on. The driver is
 * always told the reason and the appeal path (slice 03 guards).
 */
export async function driverEligibility(
  deps: IdentityDeps,
  driverId: string,
): Promise<Eligibility> {
  const now = deps.now();
  const driver = await deps.prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, isOnline: true, vehicleId: true },
  });

  const reasons: string[] = [];
  if (driver === null) {
    return {
      driverId,
      online: false,
      eligible: false,
      reasons: ["No driver profile is attached to this account."],
      appealPath: APPEAL_PATH,
      appealMessage: APPEAL_MESSAGE,
    };
  }

  // Both the driver's own documents and the vehicle's: an expired insurance
  // certificate stops the driver just as surely as an expired licence.
  const owners: { ownerType: string; ownerId: string }[] = [
    { ownerType: "driver", ownerId: driverId },
  ];
  if (driver.vehicleId !== null) {
    owners.push({ ownerType: "vehicle", ownerId: driver.vehicleId });
  }

  const expired = await deps.prisma.identityDocument.findMany({
    where: { OR: owners, status: "expired" },
    select: { type: true, expiresAt: true },
  });
  for (const document of expired) {
    reasons.push(
      `Your ${document.type.replace(/_/g, " ")} expired on ${
        document.expiresAt?.toISOString().slice(0, 10) ?? "an earlier date"
      }. Upload a current one to go back online.`,
    );
  }

  const openCase = await deps.prisma.identityCase.findFirst({
    where: { driverId, status: "open" },
    select: { id: true },
  });
  if (openCase !== null) {
    reasons.push(
      "A liveness check did not match your ID, so a person is reviewing your account.",
    );
  }

  const failedRecently = await deps.prisma.faceCheck.findFirst({
    where: {
      driverId,
      passed: false,
      createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (failedRecently !== null && openCase === null) {
    reasons.push(
      "Your last liveness check did not pass. Try the check again from the app.",
    );
  }

  return {
    driverId,
    online: driver.isOnline,
    eligible: reasons.length === 0,
    reasons,
    appealPath: APPEAL_PATH,
    appealMessage: APPEAL_MESSAGE,
  };
}
