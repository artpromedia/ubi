/**
 * Driver and vehicle documents (slice 03, board 13b / 3c).
 *
 * The Lagos set is licence, LASDRI, insurance, roadworthiness, background check
 * and vehicle registration. Which of those are required, and which belong to
 * the driver rather than the vehicle, is stated once here.
 *
 * EXPIRY IS ENFORCED SERVER-SIDE. `sweepDocumentExpiry` flips a lapsed document
 * to `expired` and, in the same transaction, writes `drivers.is_online = false`.
 * A client that keeps its socket open, replays an old "go online" call, or
 * simply ignores the event is still offline, because matching reads the row and
 * the row says so.
 *
 * A document row holds a REFERENCE to the file in object storage, never the
 * file. Nothing here writes document contents to Postgres or to a log.
 */
import { ContractError } from "@ubi/contracts";
import { z } from "zod";

import { writeAudit } from "./audit";
import { auditRevision } from "./common";
import type { IdentityDeps } from "./deps";
import { APPEAL_MESSAGE, APPEAL_PATH, takeDriverOffline } from "./driver";
import { deterministicId, newId } from "./ids";
import { writeOutboxEvent, writeOutboxEventOnce } from "./outbox";

export const DRIVER_DOCUMENT_TYPES = [
  "licence",
  "lasdri",
  "background_check",
] as const;

export const VEHICLE_DOCUMENT_TYPES = [
  "insurance",
  "roadworthiness",
  "vehicle_registration",
] as const;

export const DOCUMENT_TYPES = [...DRIVER_DOCUMENT_TYPES, ...VEHICLE_DOCUMENT_TYPES] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = ["pending", "valid", "rejected", "expired"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Human labels, so the driver is told which document in their own words. */
export const DOCUMENT_LABELS: Readonly<Record<DocumentType, string>> = {
  licence: "driver's licence",
  lasdri: "LASDRI card",
  background_check: "background check",
  insurance: "insurance certificate",
  roadworthiness: "roadworthiness certificate",
  vehicle_registration: "vehicle registration",
};

export const UploadDocumentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  /** Object-storage reference. The file itself never reaches this service's database. */
  fileRef: z.string().min(8).max(500),
  /** Date the document lapses, YYYY-MM-DD. Absent for documents that do not expire. */
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expiresAt must be YYYY-MM-DD")
    .optional(),
});

export type UploadDocumentBody = z.infer<typeof UploadDocumentSchema>;

export interface DocumentView {
  readonly id: string;
  readonly type: DocumentType | string;
  readonly label: string;
  readonly status: DocumentStatus | string;
  readonly expiresAt: string | null;
  readonly daysUntilExpiry: number | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly blocksGoingOnline: boolean;
}

export interface DocumentsResponse {
  readonly documents: readonly DocumentView[];
  /** Required documents with nothing on file yet — shown, never hidden. */
  readonly missing: readonly { type: DocumentType; label: string }[];
  readonly appealPath: string;
  readonly appealMessage: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysUntil(expiresAt: Date, now: Date): number {
  return Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS);
}

function label(type: string): string {
  return DOCUMENT_LABELS[type as DocumentType] ?? type.replace(/_/g, " ");
}

export async function listDriverDocuments(
  deps: IdentityDeps,
  driverId: string,
  vehicleId: string | null,
): Promise<DocumentsResponse> {
  const now = deps.now();
  const owners: { ownerType: string; ownerId: string }[] = [
    { ownerType: "driver", ownerId: driverId },
  ];
  if (vehicleId !== null) owners.push({ ownerType: "vehicle", ownerId: vehicleId });

  const rows = await deps.prisma.identityDocument.findMany({
    where: { OR: owners },
    orderBy: [{ type: "asc" }, { createdAt: "desc" }],
  });

  const seen = new Set<string>();
  const documents: DocumentView[] = [];
  for (const row of rows) {
    if (seen.has(row.type)) continue;
    seen.add(row.type);
    documents.push({
      id: row.id,
      type: row.type,
      label: label(row.type),
      status: row.status,
      expiresAt: row.expiresAt?.toISOString().slice(0, 10) ?? null,
      daysUntilExpiry: row.expiresAt === null ? null : daysUntil(row.expiresAt, now),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewNote: row.reviewNote,
      blocksGoingOnline: row.status === "expired" || row.status === "rejected",
    });
  }

  const missing = DOCUMENT_TYPES.filter((type) => !seen.has(type)).map((type) => ({
    type,
    label: DOCUMENT_LABELS[type],
  }));

  return { documents, missing, appealPath: APPEAL_PATH, appealMessage: APPEAL_MESSAGE };
}

export interface UploadContext {
  readonly userId: string;
  readonly role: string;
  readonly driverId: string;
  readonly vehicleId: string | null;
  readonly cityId: string | null;
  readonly idempotencyKey: string;
}

/**
 * A new document goes to the review queue as `pending`. The driver does not
 * decide that it is valid, and neither does this service: a reviewer does
 * (board 4d).
 */
export async function uploadDocument(
  deps: IdentityDeps,
  context: UploadContext,
  body: UploadDocumentBody,
): Promise<DocumentView> {
  const now = deps.now();
  const isVehicleDocument = (VEHICLE_DOCUMENT_TYPES as readonly string[]).includes(body.type);
  if (isVehicleDocument && context.vehicleId === null) {
    throw new ContractError(
      "validation_failed",
      "Add your vehicle before uploading a vehicle document",
      { type: body.type },
    );
  }

  const ownerType = isVehicleDocument ? "vehicle" : "driver";
  const ownerId = isVehicleDocument ? (context.vehicleId as string) : context.driverId;
  const id = deterministicId("doc", ownerType, ownerId, body.type, context.idempotencyKey);
  const expiresAt = body.expiresAt === undefined ? null : new Date(`${body.expiresAt}T00:00:00Z`);

  if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
    throw new ContractError(
      "validation_failed",
      "That document has already expired. Upload a current one.",
      { type: body.type, expiresAt: body.expiresAt },
    );
  }

  const existing = await deps.prisma.identityDocument.findUnique({ where: { id } });
  if (existing !== null) {
    // Replay of the same upload: the original result, not a second row.
    return {
      id: existing.id,
      type: existing.type,
      label: label(existing.type),
      status: existing.status,
      expiresAt: existing.expiresAt?.toISOString().slice(0, 10) ?? null,
      daysUntilExpiry: existing.expiresAt === null ? null : daysUntil(existing.expiresAt, now),
      reviewedAt: existing.reviewedAt?.toISOString() ?? null,
      reviewNote: existing.reviewNote,
      blocksGoingOnline: false,
    };
  }

  await deps.prisma.$transaction(async (tx) => {
    await tx.identityDocument.create({
      data: {
        id,
        ownerType,
        ownerId,
        type: body.type,
        fileRef: body.fileRef,
        status: "pending",
        createdAt: now,
        ...(expiresAt === null ? {} : { expiresAt }),
      },
    });

    await writeAudit(tx, {
      actorId: context.userId,
      actorRole: context.role,
      action: "document.uploaded",
      subjectType: "document",
      subjectId: id,
      // The reference, never the file.
      after: { ownerType, ownerId, type: body.type, status: "pending" },
    });
  });

  return {
    id,
    type: body.type,
    label: DOCUMENT_LABELS[body.type],
    status: "pending",
    expiresAt: body.expiresAt ?? null,
    daysUntilExpiry: expiresAt === null ? null : daysUntil(expiresAt, now),
    reviewedAt: null,
    reviewNote: null,
    blocksGoingOnline: false,
  };
}

export interface ReviewDecisionInput {
  readonly documentId: string;
  readonly reviewerId: string;
  readonly decision: "valid" | "rejected";
  readonly note: string;
  readonly cityId: string | null;
}

/** A human decides. The decision and the reviewer go to the audit log. */
export async function reviewDocument(
  deps: IdentityDeps,
  input: ReviewDecisionInput,
): Promise<DocumentView> {
  const now = deps.now();
  const document = await deps.prisma.identityDocument.findUnique({
    where: { id: input.documentId },
  });
  if (document === null) throw new ContractError("not_found", "Document not found");

  const updated = await deps.prisma.$transaction(async (tx) => {
    const row = await tx.identityDocument.update({
      where: { id: input.documentId },
      data: {
        status: input.decision,
        reviewedBy: input.reviewerId,
        reviewedAt: now,
        reviewNote: input.note,
      },
    });

    await writeAudit(tx, {
      actorId: input.reviewerId,
      actorRole: "agent",
      action: `document.${input.decision}`,
      subjectType: "document",
      subjectId: input.documentId,
      before: { status: document.status },
      after: { status: input.decision },
      reason: input.note,
    });

    await tx.reviewDecision.create({
      data: {
        id: newId("rvd"),
        queue: "kyc",
        subjectType: "document",
        subjectId: input.documentId,
        decision: input.decision,
        reviewers: [input.reviewerId],
        note: input.note,
        createdAt: now,
      },
    });

    return row;
  });

  return {
    id: updated.id,
    type: updated.type,
    label: label(updated.type),
    status: updated.status,
    expiresAt: updated.expiresAt?.toISOString().slice(0, 10) ?? null,
    daysUntilExpiry: updated.expiresAt === null ? null : daysUntil(updated.expiresAt, now),
    reviewedAt: updated.reviewedAt?.toISOString() ?? null,
    reviewNote: updated.reviewNote,
    blocksGoingOnline: updated.status !== "valid",
  };
}

export interface ExpirySweepResult {
  readonly remindersEmitted: number;
  readonly expired: number;
  readonly driversTakenOffline: readonly string[];
}

async function driversForDocument(
  deps: IdentityDeps,
  ownerType: string,
  ownerId: string,
): Promise<readonly string[]> {
  if (ownerType === "driver") return [ownerId];
  const drivers = await deps.prisma.driver.findMany({
    where: { vehicleId: ownerId },
    select: { id: true },
  });
  return drivers.map((driver) => driver.id);
}

/**
 * Reminders at 30 / 14 / 7 / 1 days, then expiry.
 *
 * Each reminder is emitted at most once per document per threshold, because the
 * outbox idempotency key contains both — so this can run every hour without
 * shouting at the driver every hour.
 */
export async function sweepDocumentExpiry(deps: IdentityDeps): Promise<ExpirySweepResult> {
  const now = deps.now();
  const policy = await deps.policy.forCity(null);
  const thresholds = [...policy.documentReminderDays].sort((a, b) => a - b);
  const horizon = new Date(now.getTime() + (thresholds[thresholds.length - 1] ?? 30) * DAY_MS);

  const documents = await deps.prisma.identityDocument.findMany({
    where: { status: "valid", expiresAt: { not: null, lte: horizon } },
    orderBy: { expiresAt: "asc" },
    take: 1000,
  });

  let remindersEmitted = 0;
  let expired = 0;
  const offline = new Set<string>();

  for (const document of documents) {
    if (document.expiresAt === null) continue;
    const remaining = daysUntil(document.expiresAt, now);

    if (remaining > 0) {
      const threshold = thresholds.find((candidate) => remaining <= candidate);
      if (threshold === undefined) continue;

      const emitted = await deps.prisma.$transaction(async (tx) =>
        writeOutboxEventOnce(tx, {
          name: "document.expiring",
          subjectType: "document",
          subjectId: document.id,
          actorType: "system",
          actorId: "system:identity-sweep",
          idempotencyKey: `document.expiring:${document.id}:${threshold}`,
          fromVersion: null,
          toVersion: threshold,
          cityId: policy.cityId,
          payload: {
            ownerType: document.ownerType,
            ownerId: document.ownerId,
            docType: document.type,
            expiry: document.expiresAt.toISOString().slice(0, 10),
            days: threshold,
            label: label(document.type),
          },
          occurredAt: now,
        }),
      );
      if (emitted !== undefined) remindersEmitted += 1;
      continue;
    }

    const driverIds = await driversForDocument(deps, document.ownerType, document.ownerId);

    await deps.prisma.$transaction(async (tx) => {
      const updated = await tx.identityDocument.updateMany({
        where: { id: document.id, status: "valid" },
        data: { status: "expired" },
      });
      if (updated.count === 0) return;
      expired += 1;

      await writeAudit(tx, {
        actorId: "system:identity-sweep",
        actorRole: "system",
        action: "document.expired",
        subjectType: "document",
        subjectId: document.id,
        before: { status: "valid" },
        after: { status: "expired" },
        reason: "expiry_date_passed",
      });

      await writeOutboxEventOnce(tx, {
        name: "document.expired",
        subjectType: "document",
        subjectId: document.id,
        actorType: "system",
        actorId: "system:identity-sweep",
        idempotencyKey: `document.expired:${document.id}`,
        fromVersion: null,
        toVersion: 1,
        cityId: policy.cityId,
        payload: {
          ownerType: document.ownerType,
          ownerId: document.ownerId,
          docType: document.type,
          expiry: document.expiresAt?.toISOString().slice(0, 10) ?? null,
          label: label(document.type),
        },
        occurredAt: now,
      });

      const reason = `Your ${label(document.type)} expired on ${
        document.expiresAt?.toISOString().slice(0, 10) ?? "an earlier date"
      }. Upload a current one to go back online.`;

      for (const driverId of driverIds) {
        const wasOnline = await takeDriverOffline(tx, {
          driverId,
          reasons: [reason],
          actorId: "system:identity-sweep",
          actorRole: "system",
          cityId: policy.cityId,
          occurredAt: now,
        });
        if (wasOnline) offline.add(driverId);
      }

      if (document.ownerType === "vehicle") {
        await writeOutboxEvent(tx, {
          name: "vehicle.offline_for_all_drivers",
          subjectType: "document",
          subjectId: document.id,
          actorType: "system",
          actorId: "system:identity-sweep",
          idempotencyKey: `vehicle.offline_for_all_drivers:${document.id}`,
          fromVersion: null,
          toVersion: 1,
          cityId: policy.cityId,
          payload: {
            ownerType: document.ownerType,
            ownerId: document.ownerId,
            docType: document.type,
            expiry: document.expiresAt?.toISOString().slice(0, 10) ?? null,
            driverIds: [...driverIds],
          },
          occurredAt: now,
        });
      }
    });
  }

  return { remindersEmitted, expired, driversTakenOffline: [...offline] };
}

/**
 * Whether a driver may be online right now, from documents alone. Used by the
 * eligibility endpoint and by the sweep's follow-up checks.
 */
export async function hasBlockingDocument(
  deps: IdentityDeps,
  driverId: string,
  vehicleId: string | null,
): Promise<boolean> {
  const owners: { ownerType: string; ownerId: string }[] = [
    { ownerType: "driver", ownerId: driverId },
  ];
  if (vehicleId !== null) owners.push({ ownerType: "vehicle", ownerId: vehicleId });

  const blocking = await deps.prisma.identityDocument.count({
    where: { OR: owners, status: { in: ["expired", "rejected"] } },
  });
  return blocking > 0;
}
