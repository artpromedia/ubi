/**
 * Vehicle document upload, attachment, UBI ops review, and expiry
 * write-through (CC-C02 / P1-05).
 *
 * State machine (`vehicleDocument`):
 *   pending → valid | rejected
 *   valid → expired | rejected
 *
 * Single writer of `vehicles.insurance_expiry` and `vehicles.inspection_expiry`:
 *   When UBI ops reviews a `vehicle_documents` row as `valid`, this module
 *   writes the verified `expiresAt` into `vehicles.insurance_expiry` (for
 *   `insurance`) or `vehicles.inspection_expiry` (for `inspection`) and
 *   immediately resolves any open `document_expiring` /
 *   `document_expires_in_booking` conflicts for that vehicle and document
 *   kind.
 */
import {
  ContractError,
  canFleetTransition,
  type AttachVehicleDocumentInput,
  type CreateDocumentUploadInput,
  type DocumentDownloadUrlView,
  type DocumentUploadSlotView,
  type FleetAdminDocumentList,
  type FleetDocumentContentType,
  type ReviewVehicleDocumentInput,
  type VehicleDocumentList,
  type VehicleDocumentReviewStatus,
  type VehicleDocumentType,
  type VehicleDocumentView,
} from "@ubi/contracts";

import { resolveConflicts } from "./conflicts";
import { requireFleetEnabled } from "./config";
import { FleetError, illegalTransition, notFound } from "./errors";
import { withOutbox, type OutboxInput } from "./outbox";
import { assertCapability, type FleetAccess } from "./roles";
import { fleetVehicleOf } from "./vehicles";
import { generateId } from "../lib/ids";
import { iso } from "../lib/time";
import {
  createUnconfiguredDocStore,
  DOWNLOAD_TTL_SEC,
  UPLOAD_TTL_SEC,
  verifyStoredObject,
  type DocStore,
} from "../ports/doc-store";

import type { FleetDeps } from "./context";
import type { Actor } from "./types";
import type { VehicleDocument } from "@prisma/client/index";

function docStoreOf(deps: FleetDeps): DocStore {
  return deps.docs ?? createUnconfiguredDocStore();
}

function vehicleDocumentView(
  row: VehicleDocument,
  plate: string,
): VehicleDocumentView {
  return {
    documentId: row.id,
    vehicleId: row.vehicleId,
    fleetId: row.fleetId,
    plate,
    docType: row.type as VehicleDocumentType,
    uploadId: row.uploadId,
    contentType: row.contentType,
    sizeBytes: Number(row.sizeBytes),
    sha256Hex: row.sha256,
    expiresAt: iso(row.expiresAt.getTime()),
    status: row.status as VehicleDocumentReviewStatus,
    uploadedByUserId: row.uploadedBy,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt === null ? null : iso(row.reviewedAt.getTime()),
    reviewNote: row.reviewNote,
    createdAt: iso(row.createdAt.getTime()),
  };
}

async function requireFleetVehicle(
  deps: FleetDeps,
  fleetId: string,
  vehicleId: string,
): Promise<{ vehicleId: string; plate: string }> {
  const fv = await fleetVehicleOf(deps.db, fleetId, vehicleId);
  return { vehicleId: fv.vehicleId, plate: fv.vehicle.plateNumber };
}

export async function listVehicleDocuments(
  deps: FleetDeps,
  access: FleetAccess,
  vehicleId: string,
): Promise<VehicleDocumentList> {
  const vehicle = await requireFleetVehicle(deps, access.fleet.id, vehicleId);
  const docs = await deps.db.vehicleDocument.findMany({
    where: {
      fleetId: access.fleet.id,
      vehicleId: vehicle.vehicleId,
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    vehicleId: vehicle.vehicleId,
    documents: docs.map((doc) => vehicleDocumentView(doc, vehicle.plate)),
  };
}

export async function createVehicleDocumentUpload(
  deps: FleetDeps,
  access: FleetAccess,
  vehicleId: string,
  input: CreateDocumentUploadInput,
): Promise<DocumentUploadSlotView> {
  assertCapability(access, "manage_vehicles");
  if (input.purpose !== "vehicle_document") {
    throw new ContractError(
      "validation_failed",
      "Expected purpose vehicle_document for a vehicle document upload slot",
    );
  }
  await requireFleetVehicle(deps, access.fleet.id, vehicleId);
  const store = docStoreOf(deps);
  if (!store.configured()) {
    throw new ContractError(
      "doc_storage_not_configured",
      "Document storage is not configured in this environment",
    );
  }
  const uploadId = generateId("fup");
  const objectKey = `vehicles/${access.fleet.id}/${vehicleId}/${uploadId}`;
  const normalizedSha = input.sha256Hex.toLowerCase();
  const presigned = await store.presignPut({
    objectKey,
    contentType: input.contentType,
    sha256Hex: normalizedSha,
    ttlSec: UPLOAD_TTL_SEC,
  });

  await deps.db.fleetDocumentUpload.create({
    data: {
      id: uploadId,
      fleetId: access.fleet.id,
      scope: "vehicle",
      subjectId: vehicleId,
      docType: "vehicle_document",
      objectKey,
      contentType: input.contentType,
      sizeBytes: BigInt(input.sizeBytes),
      sha256: normalizedSha,
      issuedTo: access.actor.id,
      status: "issued",
      expiresAt: presigned.expiresAt,
    },
  });

  return {
    uploadId,
    objectKey,
    uploadUrl: presigned.url,
    method: "PUT",
    requiredHeaders: presigned.requiredHeaders,
    expiresAt: iso(presigned.expiresAt.getTime()),
  };
}

export async function attachVehicleDocument(
  deps: FleetDeps,
  access: FleetAccess,
  vehicleId: string,
  input: AttachVehicleDocumentInput,
): Promise<VehicleDocumentView> {
  assertCapability(access, "manage_vehicles");
  const vehicle = await requireFleetVehicle(deps, access.fleet.id, vehicleId);
  const now = deps.now();
  const expiresAt = new Date(input.expiresAt);
  if (expiresAt.getTime() <= now.getTime()) {
    throw new FleetError(
      "document_already_expired",
      "Document expiry date must be in the future.",
      { expiresAt: input.expiresAt },
    );
  }

  const upload = await deps.db.fleetDocumentUpload.findUnique({
    where: { id: input.uploadId },
  });
  if (
    upload === null ||
    upload.fleetId !== access.fleet.id ||
    upload.scope !== "vehicle" ||
    upload.subjectId !== vehicle.vehicleId
  ) {
    throw new ContractError(
      "validation_failed",
      "Unknown or mismatched vehicle document upload",
      { uploadId: input.uploadId },
    );
  }

  // Verify stored bytes in private storage BEFORE opening a SQL transaction.
  const store = docStoreOf(deps);
  const sizeBytesNum = Number(upload.sizeBytes);
  try {
    await verifyStoredObject(store, {
      objectKey: upload.objectKey,
      expectedContentType: upload.contentType as FleetDocumentContentType,
      expectedSizeBytes: sizeBytesNum,
      expectedSha256Hex: upload.sha256,
    });
  } catch (error) {
    await deps.db.fleetDocumentUpload
      .update({
        where: { id: upload.id },
        data: { status: "rejected" },
      })
      .catch(() => undefined);
    throw error;
  }

  const documentId = generateId("vdc");
  return withOutbox(deps.db, async (tx) => {
    await tx.fleetDocumentUpload.update({
      where: { id: upload.id },
      data: { status: "attached", attachedAt: now },
    });

    const created = await tx.vehicleDocument.create({
      data: {
        id: documentId,
        vehicleId: vehicle.vehicleId,
        fleetId: access.fleet.id,
        type: input.docType,
        uploadId: upload.id,
        fileRef: upload.objectKey,
        contentType: upload.contentType,
        sizeBytes: upload.sizeBytes,
        sha256: upload.sha256,
        expiresAt,
        status: "pending",
        uploadedBy: access.actor.id,
      },
    });

    return {
      result: vehicleDocumentView(created, vehicle.plate),
      audits: [
        {
          actor: access.actor,
          action: "vehicle.document.submitted",
          subjectType: "vehicle",
          subjectId: vehicle.vehicleId,
          after: {
            documentId,
            fleetId: access.fleet.id,
            docType: input.docType,
            expiresAt: iso(expiresAt.getTime()),
          },
        },
      ],
      events: [
        {
          name: "vehicle.document.submitted",
          aggregateType: "vehicle",
          aggregateId: vehicle.vehicleId,
          fromVersion: null,
          toVersion: 1,
          idempotencyKey: `vehicle.document.submitted:${documentId}`,
          actor: access.actor,
          cityId: access.cityId,
          occurredAt: now,
          payload: {
            documentId,
            vehicleId: vehicle.vehicleId,
            fleetId: access.fleet.id,
            docType: input.docType,
            expiresAt: iso(expiresAt.getTime()),
            uploadedByUserId: access.actor.id,
          },
        },
      ],
    };
  });
}

export async function getVehicleDocumentUrl(
  deps: FleetDeps,
  access: FleetAccess,
  vehicleId: string,
  documentId: string,
): Promise<DocumentDownloadUrlView> {
  // Permission matrix: read-only staff may NOT view raw vehicle documents.
  assertCapability(access, "manage_vehicles");
  await requireFleetVehicle(deps, access.fleet.id, vehicleId);
  const doc = await deps.db.vehicleDocument.findFirst({
    where: {
      id: documentId,
      fleetId: access.fleet.id,
      vehicleId,
    },
  });
  if (doc === null) {
    throw notFound("vehicle_document");
  }
  const store = docStoreOf(deps);
  const presigned = await store.presignGet({
    objectKey: doc.fileRef,
    ttlSec: DOWNLOAD_TTL_SEC,
  });
  return {
    url: presigned.url,
    expiresAt: iso(presigned.expiresAt.getTime()),
    contentType: doc.contentType,
  };
}

export async function listAdminVehicleDocuments(
  deps: FleetDeps,
  cityId: string,
  statusFilter?: VehicleDocumentReviewStatus,
): Promise<FleetAdminDocumentList> {
  await requireFleetEnabled(deps.config, cityId);
  const rows = await deps.db.vehicleDocument.findMany({
    where: {
      fleet: { cityId },
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    include: {
      vehicle: { select: { plateNumber: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    documents: rows.map((row) =>
      vehicleDocumentView(row, row.vehicle.plateNumber),
    ),
  };
}

export async function getAdminVehicleDocumentUrl(
  deps: FleetDeps,
  _actor: Actor,
  cityId: string,
  documentId: string,
): Promise<DocumentDownloadUrlView> {
  await requireFleetEnabled(deps.config, cityId);
  const doc = await deps.db.vehicleDocument.findUnique({
    where: { id: documentId },
    include: { fleet: { select: { cityId: true } } },
  });
  if (doc === null || doc.fleet.cityId !== cityId) {
    throw notFound("vehicle_document");
  }
  const store = docStoreOf(deps);
  const presigned = await store.presignGet({
    objectKey: doc.fileRef,
    ttlSec: DOWNLOAD_TTL_SEC,
  });
  return {
    url: presigned.url,
    expiresAt: iso(presigned.expiresAt.getTime()),
    contentType: doc.contentType,
  };
}

export async function reviewVehicleDocument(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  documentId: string,
  input: ReviewVehicleDocumentInput,
): Promise<VehicleDocumentView> {
  await requireFleetEnabled(deps.config, cityId);
  const doc = await deps.db.vehicleDocument.findUnique({
    where: { id: documentId },
    include: {
      fleet: { select: { id: true, cityId: true } },
      vehicle: { select: { id: true, plateNumber: true } },
    },
  });
  if (doc === null || doc.fleet.cityId !== cityId) {
    throw notFound("vehicle_document");
  }
  if (!canFleetTransition("vehicleDocument", doc.status, input.decision)) {
    throw illegalTransition("vehicleDocument", doc.status, input.decision);
  }

  const now = deps.now();
  const note = input.note?.trim() ?? null;
  const expiryIso = iso(doc.expiresAt.getTime());
  const docType = doc.type as VehicleDocumentType;

  return withOutbox(deps.db, async (tx) => {
    const updated = await tx.vehicleDocument.update({
      where: { id: doc.id },
      data: {
        status: input.decision,
        reviewedBy: actor.id,
        reviewedAt: now,
        reviewNote: note,
      },
    });

    const extraEvents: OutboxInput[] = [];
    if (input.decision === "valid") {
      if (docType === "insurance") {
        await tx.vehicle.update({
          where: { id: doc.vehicleId },
          data: { insuranceExpiry: doc.expiresAt },
        });
      } else if (docType === "inspection") {
        await tx.vehicle.update({
          where: { id: doc.vehicleId },
          data: { inspectionExpiry: doc.expiresAt },
        });
      }

      if (
        (docType === "insurance" || docType === "inspection") &&
        doc.expiresAt.getTime() > now.getTime()
      ) {
        const openConflicts = await tx.fleetConflict.findMany({
          where: {
            vehicleId: doc.vehicleId,
            type: { in: ["document_expiring", "document_expires_in_booking"] },
            status: { in: ["open", "resolving"] },
          },
        });
        const matchingIds = openConflicts
          .filter((conflict) => {
            const detail = (conflict.detail ?? {}) as {
              kind?: string;
              expiresAt?: string;
            };
            return detail.kind === docType;
          })
          .map((conflict) => conflict.id);

        if (matchingIds.length > 0) {
          const resolvedEvents = await resolveConflicts(
            tx,
            { ids: matchingIds },
            "document_renewed",
            actor,
            cityId,
            now,
          );
          extraEvents.push(...resolvedEvents);
        }
      }
    }

    return {
      result: vehicleDocumentView(updated, doc.vehicle.plateNumber),
      audits: [
        {
          actor,
          action: "vehicle.document.reviewed",
          subjectType: "vehicle",
          subjectId: doc.vehicleId,
          before: { status: doc.status },
          after: {
            documentId: doc.id,
            docType,
            status: input.decision,
            expiresAt: expiryIso,
            note,
          },
        },
      ],
      events: [
        {
          name: "vehicle.document.reviewed",
          aggregateType: "vehicle",
          aggregateId: doc.vehicleId,
          fromVersion: 1,
          toVersion: 2,
          idempotencyKey: `vehicle.document.reviewed:${doc.id}:${input.decision}`,
          actor,
          cityId,
          occurredAt: now,
          payload: {
            documentId: doc.id,
            vehicleId: doc.vehicleId,
            fleetId: doc.fleetId,
            docType,
            decision: input.decision,
            reviewedBy: actor.id,
            expiresAt: expiryIso,
          },
        },
        ...extraEvents,
      ],
    };
  });
}
