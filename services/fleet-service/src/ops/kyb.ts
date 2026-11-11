/**
 * Fleet onboarding and KYB verification (CC-C02 / P1-05, DEC-5).
 *
 * State machine (`kybApplication`):
 *   pending_review → changes_requested | approved | rejected
 *   changes_requested → pending_review | rejected
 *   approved → changes_requested | rejected
 *   rejected → (terminal)
 *
 * DEC-5: Per-city KYB requirements live in `cityConfig.fleet.kyb.requirements`.
 * When a city has no `fleet.kyb.requirements` configured yet, fleet creation
 * stays in `pending_review` and KYB submission / approval fails closed with
 * `409 kyb_requirements_unconfigured`.
 */
import {
  ContractError,
  canFleetTransition,
  type CreateDocumentUploadInput,
  type DocumentDownloadUrlView,
  type DocumentUploadSlotView,
  type FleetAdminKybList,
  type FleetDocumentContentType,
  type FleetKybApplicationView,
  type FleetKybDocumentView,
  type FleetKybRequirement,
  type FleetKybRequirementsResponse,
  type FleetKybStatus,
  type FleetStatus,
  type ReviewFleetKybInput,
  type SubmitFleetKybInput,
} from "@ubi/contracts";

import { requireFleetEnabled, type FleetCityConfig } from "./config";
import { illegalTransition, notFound } from "./errors";
import { withOutbox } from "./outbox";
import { assertCapability, type FleetAccess } from "./roles";
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
import type { Fleet, FleetKybDocument } from "@prisma/client/index";

function docStoreOf(deps: FleetDeps): DocStore {
  return deps.docs ?? createUnconfiguredDocStore();
}

export function kybRequirementsOf(
  config: FleetCityConfig,
): readonly FleetKybRequirement[] {
  return config.policy.kyb?.requirements ?? [];
}

function kybDocumentView(row: FleetKybDocument): FleetKybDocumentView {
  return {
    kybDocumentId: row.id,
    requirementKey: row.requirementKey,
    uploadId: row.uploadId,
    contentType: row.contentType,
    sizeBytes: Number(row.sizeBytes),
    sha256Hex: row.sha256,
    status: row.status as "pending" | "valid" | "rejected",
    reviewNote: row.reviewNote,
    createdAt: iso(row.createdAt.getTime()),
  };
}

function kybFieldsRecord(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}

export function kybApplicationView(
  fleet: Fleet,
  docs: readonly FleetKybDocument[],
  config: FleetCityConfig,
): FleetKybApplicationView {
  const requirements = [...kybRequirementsOf(config)];
  return {
    fleetId: fleet.id,
    name: fleet.name,
    cityId: fleet.cityId,
    status: fleet.status as FleetStatus,
    kybStatus: fleet.kybStatus as FleetKybStatus,
    registrationNumber: fleet.registrationNumber,
    taxId: fleet.taxId,
    fields: kybFieldsRecord(fleet.kybFields),
    declarationsAccepted: fleet.kybDeclarationsAccepted,
    submittedAt:
      fleet.kybSubmittedAt === null
        ? null
        : iso(fleet.kybSubmittedAt.getTime()),
    reviewedBy: fleet.kybReviewedBy,
    reviewedAt:
      fleet.kybReviewedAt === null ? null : iso(fleet.kybReviewedAt.getTime()),
    reviewNote: fleet.kybReviewNote,
    requirementsConfigured: requirements.length > 0,
    requirements,
    documents: docs.map(kybDocumentView),
  };
}

export async function getKybRequirements(
  deps: FleetDeps,
  cityId: string,
): Promise<FleetKybRequirementsResponse> {
  const config = await requireFleetEnabled(deps.config, cityId);
  const requirements = [...kybRequirementsOf(config)];
  return {
    cityId,
    configured: requirements.length > 0,
    requirements,
  };
}

export async function getFleetKyb(
  deps: FleetDeps,
  access: FleetAccess,
): Promise<FleetKybApplicationView> {
  const docs = await deps.db.fleetKybDocument.findMany({
    where: { fleetId: access.fleet.id },
    orderBy: { createdAt: "asc" },
  });
  return kybApplicationView(access.fleet, docs, access.config);
}

export async function createKybUpload(
  deps: FleetDeps,
  access: FleetAccess,
  input: CreateDocumentUploadInput,
): Promise<DocumentUploadSlotView> {
  assertCapability(access, "manage_staff");
  if (input.purpose !== "kyb_document") {
    throw new ContractError(
      "validation_failed",
      "Expected purpose kyb_document for a KYB upload slot",
    );
  }
  const store = docStoreOf(deps);
  if (!store.configured()) {
    throw new ContractError(
      "doc_storage_not_configured",
      "Document storage is not configured in this environment",
    );
  }
  const uploadId = generateId("fup");
  const objectKey = `kyb/${access.fleet.id}/${uploadId}`;
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
      scope: "kyb",
      subjectId: access.fleet.id,
      docType: "kyb_document",
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

export async function submitFleetKyb(
  deps: FleetDeps,
  access: FleetAccess,
  input: SubmitFleetKybInput,
): Promise<FleetKybApplicationView> {
  assertCapability(access, "manage_staff");
  const requirements = kybRequirementsOf(access.config);
  if (requirements.length === 0) {
    throw new ContractError(
      "kyb_requirements_unconfigured",
      "Fleet business verification requirements are not configured for this city yet.",
      { cityId: access.cityId },
    );
  }
  const currentKyb = access.fleet.kybStatus;
  if (
    currentKyb !== "pending_review" &&
    !canFleetTransition("kybApplication", currentKyb, "pending_review")
  ) {
    throw illegalTransition("kybApplication", currentKyb, "pending_review");
  }

  const mergedFields: Record<string, string> = {
    ...kybFieldsRecord(access.fleet.kybFields),
    ...input.fields,
  };
  if (input.taxId && !mergedFields.tax_identification_number) {
    mergedFields.tax_identification_number = input.taxId;
  }

  const docByReq = new Map<string, string>();
  for (const doc of input.documents) {
    docByReq.set(doc.requirementKey, doc.uploadId);
  }

  const missing: string[] = [];
  for (const req of requirements) {
    if (!req.required) {
      continue;
    }
    if (req.kind === "text") {
      const value = mergedFields[req.key]?.trim() ?? "";
      if (value.length === 0) {
        missing.push(req.key);
      }
    } else if (!docByReq.has(req.key)) {
      missing.push(req.key);
    }
  }
  if (missing.length > 0) {
    throw new ContractError(
      "validation_failed",
      "Missing required KYB fields or documents",
      { missingRequirements: missing },
    );
  }

  // Verify every uploaded document against private storage BEFORE opening a SQL transaction.
  const store = docStoreOf(deps);
  const verifiedUploads: {
    requirementKey: string;
    uploadId: string;
    objectKey: string;
    contentType: FleetDocumentContentType;
    sizeBytes: number;
    sha256Hex: string;
  }[] = [];

  for (const [requirementKey, uploadId] of docByReq.entries()) {
    const upload = await deps.db.fleetDocumentUpload.findUnique({
      where: { id: uploadId },
    });
    if (
      upload === null ||
      upload.fleetId !== access.fleet.id ||
      upload.scope !== "kyb"
    ) {
      throw new ContractError(
        "validation_failed",
        "Unknown or mismatched KYB document upload",
        { requirementKey, uploadId },
      );
    }
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
    verifiedUploads.push({
      requirementKey,
      uploadId: upload.id,
      objectKey: upload.objectKey,
      contentType: upload.contentType as FleetDocumentContentType,
      sizeBytes: sizeBytesNum,
      sha256Hex: upload.sha256,
    });
  }

  const now = deps.now();
  const fleetId = access.fleet.id;
  return withOutbox(deps.db, async (tx) => {
    for (const item of verifiedUploads) {
      await tx.fleetDocumentUpload.update({
        where: { id: item.uploadId },
        data: { status: "attached", attachedAt: now },
      });
      const existingDoc = await tx.fleetKybDocument.findFirst({
        where: { fleetId, requirementKey: item.requirementKey },
      });
      if (existingDoc === null) {
        await tx.fleetKybDocument.create({
          data: {
            id: generateId("fkd"),
            fleetId,
            requirementKey: item.requirementKey,
            uploadId: item.uploadId,
            objectKey: item.objectKey,
            contentType: item.contentType,
            sizeBytes: BigInt(item.sizeBytes),
            sha256: item.sha256Hex,
            status: "pending",
            uploadedBy: access.actor.id,
          },
        });
      } else {
        await tx.fleetKybDocument.update({
          where: { id: existingDoc.id },
          data: {
            uploadId: item.uploadId,
            objectKey: item.objectKey,
            contentType: item.contentType,
            sizeBytes: BigInt(item.sizeBytes),
            sha256: item.sha256Hex,
            status: "pending",
            uploadedBy: access.actor.id,
            reviewedBy: null,
            reviewedAt: null,
            reviewNote: null,
          },
        });
      }
    }

    const updatedFleet = await tx.fleet.update({
      where: { id: fleetId },
      data: {
        status: "pending_review",
        kybStatus: "pending_review",
        registrationNumber:
          input.registrationNumber ?? access.fleet.registrationNumber,
        taxId:
          input.taxId ??
          mergedFields.tax_identification_number ??
          access.fleet.taxId,
        kybFields: mergedFields,
        kybDeclarationsAccepted: true,
        kybSubmittedAt: now,
        version: { increment: 1 },
      },
    });
    const docs = await tx.fleetKybDocument.findMany({
      where: { fleetId },
      orderBy: { createdAt: "asc" },
    });

    return {
      result: kybApplicationView(updatedFleet, docs, access.config),
      audits: [
        {
          actor: access.actor,
          action: "fleet.kyb.submitted",
          subjectType: "fleet",
          subjectId: fleetId,
          before: { kybStatus: currentKyb },
          after: {
            kybStatus: "pending_review",
            documentCount: docs.length,
          },
        },
      ],
      events: [
        {
          name: "fleet.kyb.submitted",
          aggregateType: "fleet",
          aggregateId: fleetId,
          fromVersion: access.fleet.version,
          toVersion: updatedFleet.version,
          actor: access.actor,
          cityId: access.cityId,
          occurredAt: now,
          payload: {
            fleetId,
            cityId: access.cityId,
            submittedBy: access.actor.id,
            documentCount: docs.length,
          },
        },
      ],
    };
  });
}

export async function getKybDocumentUrl(
  deps: FleetDeps,
  access: FleetAccess,
  kybDocumentId: string,
): Promise<DocumentDownloadUrlView> {
  // Read-only staff cannot download private KYB documents (permission matrix).
  assertCapability(access, "manage_vehicles");
  const doc = await deps.db.fleetKybDocument.findFirst({
    where: { id: kybDocumentId, fleetId: access.fleet.id },
  });
  if (doc === null) {
    throw notFound("kyb_document");
  }
  const store = docStoreOf(deps);
  const presigned = await store.presignGet({
    objectKey: doc.objectKey,
    ttlSec: DOWNLOAD_TTL_SEC,
  });
  return {
    url: presigned.url,
    expiresAt: iso(presigned.expiresAt.getTime()),
    contentType: doc.contentType,
  };
}

export async function listAdminKybApplications(
  deps: FleetDeps,
  cityId: string,
  statusFilter?: FleetKybStatus,
): Promise<FleetAdminKybList> {
  const config = await requireFleetEnabled(deps.config, cityId);
  const fleets = await deps.db.fleet.findMany({
    where: {
      cityId,
      ...(statusFilter ? { kybStatus: statusFilter } : {}),
    },
    include: {
      kybDocuments: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    applications: fleets.map((fleet) =>
      kybApplicationView(fleet, fleet.kybDocuments, config),
    ),
  };
}

export async function getAdminKybDocumentUrl(
  deps: FleetDeps,
  _actor: Actor,
  cityId: string,
  fleetId: string,
  kybDocumentId: string,
): Promise<DocumentDownloadUrlView> {
  await requireFleetEnabled(deps.config, cityId);
  const fleet = await deps.db.fleet.findUnique({ where: { id: fleetId } });
  if (fleet === null || fleet.cityId !== cityId) {
    throw notFound("fleet");
  }
  const doc = await deps.db.fleetKybDocument.findFirst({
    where: { id: kybDocumentId, fleetId },
  });
  if (doc === null) {
    throw notFound("kyb_document");
  }
  const store = docStoreOf(deps);
  const presigned = await store.presignGet({
    objectKey: doc.objectKey,
    ttlSec: DOWNLOAD_TTL_SEC,
  });
  return {
    url: presigned.url,
    expiresAt: iso(presigned.expiresAt.getTime()),
    contentType: doc.contentType,
  };
}

export async function reviewFleetKyb(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  fleetId: string,
  input: ReviewFleetKybInput,
): Promise<FleetKybApplicationView> {
  const config = await requireFleetEnabled(deps.config, cityId);
  if (input.decision === "approved" && kybRequirementsOf(config).length === 0) {
    throw new ContractError(
      "kyb_requirements_unconfigured",
      "Cannot approve a fleet when city KYB requirements are not configured.",
      { cityId },
    );
  }
  const fleet = await deps.db.fleet.findUnique({ where: { id: fleetId } });
  if (fleet === null || fleet.cityId !== cityId) {
    throw notFound("fleet");
  }
  const fromKyb = fleet.kybStatus as FleetKybStatus;
  if (!canFleetTransition("kybApplication", fromKyb, input.decision)) {
    throw illegalTransition("kybApplication", fromKyb, input.decision);
  }

  const nextFleetStatus: FleetStatus =
    input.decision === "approved"
      ? "active"
      : input.decision === "changes_requested"
        ? "changes_requested"
        : "rejected";
  const nextDocStatus =
    input.decision === "approved"
      ? "valid"
      : input.decision === "rejected"
        ? "rejected"
        : "pending";
  const now = deps.now();
  const note = input.note?.trim() ?? null;

  return withOutbox(deps.db, async (tx) => {
    await tx.fleetKybDocument.updateMany({
      where: { fleetId },
      data: {
        status: nextDocStatus,
        reviewedBy: actor.id,
        reviewedAt: now,
        reviewNote: note,
      },
    });
    const updated = await tx.fleet.update({
      where: { id: fleetId },
      data: {
        status: nextFleetStatus,
        kybStatus: input.decision,
        kybReviewedBy: actor.id,
        kybReviewedAt: now,
        kybReviewNote: note,
        version: { increment: 1 },
      },
    });
    const docs = await tx.fleetKybDocument.findMany({
      where: { fleetId },
      orderBy: { createdAt: "asc" },
    });
    return {
      result: kybApplicationView(updated, docs, config),
      audits: [
        {
          actor,
          action: "fleet.kyb.reviewed",
          subjectType: "fleet",
          subjectId: fleetId,
          before: { status: fleet.status, kybStatus: fromKyb },
          after: {
            status: updated.status,
            kybStatus: input.decision,
            note,
          },
        },
      ],
      events: [
        {
          name: "fleet.kyb.status.changed",
          aggregateType: "fleet",
          aggregateId: fleetId,
          fromVersion: fleet.version,
          toVersion: updated.version,
          actor,
          cityId,
          occurredAt: now,
          payload: {
            fleetId,
            cityId,
            from: fromKyb,
            to: input.decision,
            reviewedBy: actor.id,
            hasNote: note !== null && note.length > 0,
          },
        },
      ],
    };
  });
}
