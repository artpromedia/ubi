import { apiClient, newIdempotencyKey } from "./api-client";

export type FleetStatus =
  | "pending_review"
  | "changes_requested"
  | "active"
  | "approved"
  | "rejected"
  | "suspended";

export type FleetKybStatus =
  | "pending_review"
  | "changes_requested"
  | "approved"
  | "rejected";

export interface FleetKybRequirement {
  readonly key: string;
  readonly label: string;
  readonly kind: "text" | "document";
  readonly required: boolean;
  readonly description?: string;
}

export interface FleetKybDocumentView {
  readonly kybDocumentId: string;
  readonly requirementKey: string;
  readonly uploadId: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256Hex: string;
  readonly status: "pending" | "valid" | "rejected";
  readonly reviewNote: string | null;
  readonly createdAt: string;
}

export interface FleetKybApplicationView {
  readonly fleetId: string;
  readonly name: string;
  readonly cityId: string;
  readonly status: FleetStatus;
  readonly kybStatus: FleetKybStatus;
  readonly registrationNumber: string | null;
  readonly taxId: string | null;
  readonly fields: Readonly<Record<string, string>>;
  readonly declarationsAccepted: boolean;
  readonly submittedAt: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly requirementsConfigured: boolean;
  readonly requirements: readonly FleetKybRequirement[];
  readonly documents: readonly FleetKybDocumentView[];
}

export interface FleetAdminKybList {
  readonly applications: readonly FleetKybApplicationView[];
}

export interface ReviewFleetKybInput {
  readonly decision: "approved" | "changes_requested" | "rejected";
  readonly note?: string;
}

export type VehicleDocumentType = "insurance" | "inspection" | "registration";

export type VehicleDocumentReviewStatus =
  | "pending"
  | "valid"
  | "rejected"
  | "expired";

export interface VehicleDocumentView {
  readonly documentId: string;
  readonly vehicleId: string;
  readonly fleetId: string;
  readonly plate: string;
  readonly docType: VehicleDocumentType;
  readonly uploadId: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256Hex: string;
  readonly expiresAt: string;
  readonly status: VehicleDocumentReviewStatus;
  readonly uploadedByUserId: string;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly createdAt: string;
}

export interface FleetAdminDocumentList {
  readonly documents: readonly VehicleDocumentView[];
}

export interface ReviewVehicleDocumentInput {
  readonly decision: "valid" | "rejected";
  readonly note?: string;
}

export interface DocumentDownloadUrlView {
  readonly url: string;
  readonly expiresAt: string;
  readonly contentType: string;
}

export const ADMIN_FLEET_REVIEW_TEST_IDS = {
  kyb: {
    list: "admin.fleetReview.list",
    row: "admin.fleetReview.row",
    approve: "admin.fleetReview.approve",
    requestChanges: "admin.fleetReview.requestChanges",
    reject: "admin.fleetReview.reject",
    noteInput: "admin.fleetReview.noteInput",
    openDocument: "admin.fleetReview.openDocument",
  },
  documents: {
    list: "admin.documentReview.list",
    row: "admin.documentReview.row",
    approve: "admin.documentReview.approve",
    reject: "admin.documentReview.reject",
    noteInput: "admin.documentReview.noteInput",
    openDocument: "admin.documentReview.openDocument",
  },
} as const;

export async function listAdminFleetKyb(
  params?: {
    readonly status?: FleetKybStatus;
    readonly cityId?: string;
  },
  signal?: AbortSignal,
): Promise<FleetAdminKybList> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.cityId) qs.set("cityId", params.cityId);
  const query = qs.toString();
  return apiClient.get<FleetAdminKybList>(
    `/v1/admin/fleets/kyb${query ? `?${query}` : ""}`,
    { signal },
  );
}

export async function getAdminFleetKybDocumentUrl(
  fleetId: string,
  docId: string,
  signal?: AbortSignal,
): Promise<DocumentDownloadUrlView> {
  return apiClient.get<DocumentDownloadUrlView>(
    `/v1/admin/fleets/${encodeURIComponent(fleetId)}/kyb/documents/${encodeURIComponent(docId)}/url`,
    { signal },
  );
}

export async function reviewAdminFleetKyb(
  fleetId: string,
  input: ReviewFleetKybInput,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<FleetKybApplicationView> {
  return apiClient.post<FleetKybApplicationView>(
    `/v1/admin/fleets/${encodeURIComponent(fleetId)}/kyb/review`,
    input,
    { idempotencyKey },
  );
}

export async function listAdminFleetDocuments(
  params?: {
    readonly status?: VehicleDocumentReviewStatus;
    readonly cityId?: string;
  },
  signal?: AbortSignal,
): Promise<FleetAdminDocumentList> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.cityId) qs.set("cityId", params.cityId);
  const query = qs.toString();
  return apiClient.get<FleetAdminDocumentList>(
    `/v1/admin/fleet-documents${query ? `?${query}` : ""}`,
    { signal },
  );
}

export async function getAdminFleetDocumentUrl(
  documentId: string,
  signal?: AbortSignal,
): Promise<DocumentDownloadUrlView> {
  return apiClient.get<DocumentDownloadUrlView>(
    `/v1/admin/fleet-documents/${encodeURIComponent(documentId)}/url`,
    { signal },
  );
}

export async function reviewAdminFleetDocument(
  documentId: string,
  input: ReviewVehicleDocumentInput,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<VehicleDocumentView> {
  return apiClient.post<VehicleDocumentView>(
    `/v1/admin/fleet-documents/${encodeURIComponent(documentId)}/review`,
    input,
    { idempotencyKey },
  );
}
