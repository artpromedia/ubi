/**
 * Fleet KYB onboarding, staff invitations, ownership transfer, and vehicle
 * documents integration tests (CC-C02 / P1-05, DEC-5).
 */
import { createHash } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/index";
import { documentSweep } from "../src/ops/documents";
import { expireInvitations } from "../src/ops/invitations";
import { createUnconfiguredDocStore } from "../src/ports/doc-store";

import {
  addStaff,
  addVehicle,
  api,
  closeTestDb,
  DEFAULT_NOW,
  resetFleet,
  seedFleet,
  seedUser,
  startHarness,
  tokenFor,
  type Harness,
} from "./helpers";

const VALID_PDF_BYTES = Buffer.from(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  "utf8",
);
const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const TEST_KYB_POLICY = {
  kyb: {
    requirements: [
      {
        key: "cac_certificate",
        label: "CAC Certificate of Incorporation",
        kind: "document" as const,
        required: true,
      },
      {
        key: "tax_clearance",
        label: "Tax Clearance Certificate",
        kind: "document" as const,
        required: true,
      },
      {
        key: "tax_identification_number",
        label: "Tax Identification Number (TIN)",
        kind: "text" as const,
        required: true,
      },
    ],
  },
};

describe("Fleet KYB, Staff Invitations & Vehicle Documents (CC-C02 / P1-05)", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h.close();
    await closeTestDb();
  });

  beforeEach(async () => {
    h.clock.now = new Date(DEFAULT_NOW);
    h.docs.clear();
    await resetFleet(h.db);
  });

  it("enforces DEC-5 when city KYB requirements are unconfigured and blocks operational capabilities until KYB approval", async () => {
    const world = await seedFleet(h, {
      keepPendingReview: true,
    });
    const driverId = await seedUser(h.db, { driver: true });
    const vehicleId = await addVehicle(h, world);

    // 1. Operational assignment capability is blocked while fleet is pending_review.
    const proposalAttempt = await api<{ code: string }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/assignments/propose`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        vehicleId,
        driverId,
        terms: {
          model: "fixed_weekly",
          fixedMinor: 500_000,
          currency: "NGN",
          shift: { kind: "full_time" },
          validFrom: "2026-10-01",
        },
      },
    });
    expect(proposalAttempt.status).toBe(403);
    expect(proposalAttempt.body.code).toBe("kyb_not_approved");

    // 2. DEC-5: city without fleet.kyb.requirements reports configured: false
    // and refuses KYB submission with 409 kyb_requirements_unconfigured.
    const reqs = await api<{ configured: boolean }>(h.app, {
      path: `/v1/fleets/kyb-requirements?cityId=${world.cityId}`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(reqs.status).toBe(200);
    expect(reqs.body.configured).toBe(false);

    const submitUnconfigured = await api<{ code: string }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/kyb/submit`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        registrationNumber: "RC123456",
        fields: { tax_identification_number: "12345678-0001" },
        declarationsAccepted: true,
        documents: [
          {
            requirementKey: "cac_certificate",
            uploadId: "fup_missing",
          },
        ],
      },
    });
    expect(submitUnconfigured.status).toBe(409);
    expect(submitUnconfigured.body.code).toBe("kyb_requirements_unconfigured");
  });

  it("drives the full KYB state machine (pending_review -> changes_requested -> pending_review -> approved) and verifies uploads", async () => {
    const world = await seedFleet(h, {
      keepPendingReview: true,
      fleetPolicy: TEST_KYB_POLICY,
    });

    const opsUserId = await seedUser(h.db, {
      firstName: "Bisi",
      lastName: "Ops",
    });
    const opsToken = await tokenFor(opsUserId, world.cityId, {
      role: "ops_admin",
      scopes: ["mp:admin:read", "mp:admin:write"],
    });

    // Presign and upload CAC certificate (PDF) and Tax Clearance (PNG)
    const cacSha = sha256Hex(VALID_PDF_BYTES);
    const cacUpload = await api<{
      uploadId: string;
      objectKey: string;
      uploadUrl: string;
    }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/kyb/uploads`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        purpose: "kyb_document",
        contentType: "application/pdf",
        sizeBytes: VALID_PDF_BYTES.byteLength,
        sha256Hex: cacSha,
      },
    });
    expect(cacUpload.status).toBe(201);
    h.docs.putObject(
      cacUpload.body.objectKey,
      VALID_PDF_BYTES,
      "application/pdf",
    );

    const taxSha = sha256Hex(VALID_PNG_BYTES);
    const taxUpload = await api<{
      uploadId: string;
      objectKey: string;
    }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/kyb/uploads`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        purpose: "kyb_document",
        contentType: "image/png",
        sizeBytes: VALID_PNG_BYTES.byteLength,
        sha256Hex: taxSha,
      },
    });
    expect(taxUpload.status).toBe(201);
    h.docs.putObject(taxUpload.body.objectKey, VALID_PNG_BYTES, "image/png");

    // Submit KYB application
    const submitted = await api<{
      kybStatus: string;
      status: string;
      registrationNumber: string;
      taxId: string;
      documents: { kybDocumentId: string; requirementKey: string }[];
    }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/kyb/submit`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        registrationNumber: "RC123456",
        taxId: "12345678-0001",
        fields: {
          tax_identification_number: "12345678-0001",
        },
        declarationsAccepted: true,
        documents: [
          {
            requirementKey: "cac_certificate",
            uploadId: cacUpload.body.uploadId,
          },
          {
            requirementKey: "tax_clearance",
            uploadId: taxUpload.body.uploadId,
          },
        ],
      },
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.kybStatus).toBe("pending_review");
    expect(submitted.body.registrationNumber).toBe("RC123456");
    expect(submitted.body.documents).toHaveLength(2);

    // Owner and admin can fetch short-lived download URL with private no-store cache header
    const docId = submitted.body.documents[0]!.kybDocumentId;
    const ownerDocUrl = await api<{
      url: string;
      expiresAt: string;
      contentType: string;
    }>(h.app, {
      path: `/v1/fleets/${world.fleetId}/kyb/documents/${docId}/url`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(ownerDocUrl.status).toBe(200);
    expect(ownerDocUrl.body.url).toContain(
      "response-cache-control=private%2C%20no-store",
    );

    // Admin lists KYB applications and requests changes
    const adminList = await api<{
      applications: { fleetId: string; kybStatus: string }[];
    }>(h.app, {
      path: `/v1/admin/fleets/kyb?cityId=${world.cityId}&status=pending_review`,
      token: opsToken,
      city: world.cityId,
    });
    expect(adminList.status).toBe(200);
    expect(adminList.body.applications.map((a) => a.fleetId)).toContain(
      world.fleetId,
    );

    const changesReq = await api<{
      kybStatus: string;
      reviewNote: string | null;
    }>(h.app, {
      method: "POST",
      path: `/v1/admin/fleets/${world.fleetId}/kyb/review`,
      token: opsToken,
      city: world.cityId,
      body: {
        decision: "changes_requested",
        note: "Please upload a clearer scan of the CAC certificate.",
      },
    });
    expect(changesReq.status).toBe(200);
    expect(changesReq.body.kybStatus).toBe("changes_requested");
    expect(changesReq.body.reviewNote).toContain("clearer scan");

    // Owner re-uploads CAC certificate and resubmits
    const cacUpload2 = await api<{ uploadId: string; objectKey: string }>(
      h.app,
      {
        method: "POST",
        path: `/v1/fleets/${world.fleetId}/kyb/uploads`,
        token: world.ownerToken,
        city: world.cityId,
        body: {
          purpose: "kyb_document",
          contentType: "application/pdf",
          sizeBytes: VALID_PDF_BYTES.byteLength,
          sha256Hex: cacSha,
        },
      },
    );
    h.docs.putObject(
      cacUpload2.body.objectKey,
      VALID_PDF_BYTES,
      "application/pdf",
    );
    const taxUpload2 = await api<{ uploadId: string; objectKey: string }>(
      h.app,
      {
        method: "POST",
        path: `/v1/fleets/${world.fleetId}/kyb/uploads`,
        token: world.ownerToken,
        city: world.cityId,
        body: {
          purpose: "kyb_document",
          contentType: "image/png",
          sizeBytes: VALID_PNG_BYTES.byteLength,
          sha256Hex: taxSha,
        },
      },
    );
    h.docs.putObject(taxUpload2.body.objectKey, VALID_PNG_BYTES, "image/png");

    const resubmitted = await api<{ kybStatus: string }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/kyb/submit`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        registrationNumber: "RC123456",
        taxId: "12345678-0001",
        fields: {
          tax_identification_number: "12345678-0001",
        },
        declarationsAccepted: true,
        documents: [
          {
            requirementKey: "cac_certificate",
            uploadId: cacUpload2.body.uploadId,
          },
          {
            requirementKey: "tax_clearance",
            uploadId: taxUpload2.body.uploadId,
          },
        ],
      },
    });
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.kybStatus).toBe("pending_review");

    // Admin approves KYB -> promotes fleet to active
    const approved = await api<{
      kybStatus: string;
      status: string;
    }>(h.app, {
      method: "POST",
      path: `/v1/admin/fleets/${world.fleetId}/kyb/review`,
      token: opsToken,
      city: world.cityId,
      body: {
        decision: "approved",
        note: "CAC and TIN verified.",
      },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.kybStatus).toBe("approved");
    expect(approved.body.status).toBe("active");

    // Operational capability now succeeds!
    const vehicleCreated = await api<{ vehicleId: string }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/vehicles`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        plate: "LND-202BB",
        make: "Toyota",
        model: "Corolla",
        year: 2022,
        color: "Silver",
        type: "SEDAN",
        capacity: 4,
        classes: ["go"],
      },
    });
    expect(vehicleCreated.status).toBe(201);
  });

  it("refuses uploads when storage is unconfigured or when magic bytes/size/checksum fail verification", async () => {
    const world = await seedFleet(h, {
      keepPendingReview: true,
      fleetPolicy: TEST_KYB_POLICY,
    });

    // 1. Unconfigured storage answers 503 doc_storage_not_configured
    const unconfiguredApp = createApp({
      ...h.deps,
      docs: createUnconfiguredDocStore(),
    });
    const unconfRes = await api<{ code: string }>(unconfiguredApp, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/kyb/uploads`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        purpose: "kyb_document",
        contentType: "application/pdf",
        sizeBytes: VALID_PDF_BYTES.byteLength,
        sha256Hex: sha256Hex(VALID_PDF_BYTES),
      },
    });
    expect(unconfRes.status).toBe(503);
    expect(unconfRes.body.code).toBe("doc_storage_not_configured");

    // 2. Spoofed magic bytes (plain text pretending to be PDF) -> 422 upload_verification_failed
    const fakePdfBytes = Buffer.from("Hello world, not a PDF!", "utf8");
    const fakeSha = sha256Hex(fakePdfBytes);
    const presignFake = await api<{ uploadId: string; objectKey: string }>(
      h.app,
      {
        method: "POST",
        path: `/v1/fleets/${world.fleetId}/kyb/uploads`,
        token: world.ownerToken,
        city: world.cityId,
        body: {
          purpose: "kyb_document",
          contentType: "application/pdf",
          sizeBytes: fakePdfBytes.byteLength,
          sha256Hex: fakeSha,
        },
      },
    );
    expect(presignFake.status).toBe(201);
    h.docs.putObject(
      presignFake.body.objectKey,
      fakePdfBytes,
      "application/pdf",
    );

    const taxUpload = await api<{ uploadId: string; objectKey: string }>(
      h.app,
      {
        method: "POST",
        path: `/v1/fleets/${world.fleetId}/kyb/uploads`,
        token: world.ownerToken,
        city: world.cityId,
        body: {
          purpose: "kyb_document",
          contentType: "image/png",
          sizeBytes: VALID_PNG_BYTES.byteLength,
          sha256Hex: sha256Hex(VALID_PNG_BYTES),
        },
      },
    );
    h.docs.putObject(taxUpload.body.objectKey, VALID_PNG_BYTES, "image/png");

    const submitFake = await api<{
      code: string;
      details?: { reason?: string };
    }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/kyb/submit`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        registrationNumber: "RC123456",
        taxId: "12345678-0001",
        fields: {
          tax_identification_number: "12345678-0001",
        },
        declarationsAccepted: true,
        documents: [
          {
            requirementKey: "cac_certificate",
            uploadId: presignFake.body.uploadId,
          },
          {
            requirementKey: "tax_clearance",
            uploadId: taxUpload.body.uploadId,
          },
        ],
      },
    });
    expect(submitFake.status).toBe(422);
    expect(submitFake.body.code).toBe("upload_verification_failed");
    expect(submitFake.body.details?.reason).toBe("content_type_mismatch");
  });

  it("manages staff invitations (invite, accept, decline, revoke, expiry sweep) and atomic ownership transfer", async () => {
    const world = await seedFleet(h);

    const managerUserId = await seedUser(h.db, {
      firstName: "Tunde",
      lastName: "Manager",
    });
    const managerUser = await h.db.user.findUniqueOrThrow({
      where: { id: managerUserId },
      select: { phone: true },
    });
    const managerToken = await tokenFor(managerUserId, world.cityId);

    // 1. Invite manager by phone
    const inviteRes = await api<{
      invitationId: string;
      status: string;
      role: string;
      kind: string;
    }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/invitations`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        phone: managerUser.phone,
        role: "manager",
      },
    });
    expect(inviteRes.status).toBe(201);
    expect(inviteRes.body.status).toBe("pending");
    expect(inviteRes.body.kind).toBe("staff_invite");

    // 2. Recipient sees incoming invitation on GET /v1/fleet-invitations
    const myInvites = await api<{
      invitations: { invitationId: string; fleetName: string }[];
    }>(h.app, {
      path: "/v1/fleet-invitations",
      token: managerToken,
      city: world.cityId,
    });
    expect(myInvites.status).toBe(200);
    expect(myInvites.body.invitations.map((i) => i.invitationId)).toContain(
      inviteRes.body.invitationId,
    );

    // 3. Recipient accepts invitation -> becomes active manager
    const accepted = await api<{ status: string }>(h.app, {
      method: "POST",
      path: `/v1/fleet-invitations/${inviteRes.body.invitationId}/accept`,
      token: managerToken,
      city: world.cityId,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("accepted");

    // 4. Last-owner rule: owner cannot demote or remove themselves while they are the sole owner
    const ownerStaff = await h.db.fleetStaff.findFirstOrThrow({
      where: { fleetId: world.fleetId, userId: world.ownerId },
    });
    const selfRemove = await api<{ error: { code: string } }>(h.app, {
      method: "DELETE",
      path: `/v1/fleets/${world.fleetId}/staff/${ownerStaff.id}`,
      token: world.ownerToken,
      city: world.cityId,
    });
    expect(selfRemove.status).toBe(422);

    // 5. Atomic ownership transfer: owner invites active manager with kind = ownership_transfer
    const transferInvite = await api<{ invitationId: string }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/invitations`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        phone: managerUser.phone,
        role: "owner",
        kind: "ownership_transfer",
      },
    });
    expect(transferInvite.status).toBe(201);

    const acceptTransfer = await api<{ status: string }>(h.app, {
      method: "POST",
      path: `/v1/fleet-invitations/${transferInvite.body.invitationId}/accept`,
      token: managerToken,
      city: world.cityId,
    });
    expect(acceptTransfer.status).toBe(200);

    // Verify new owner is `owner` and previous owner was atomically demoted to `manager`
    const staffAfterTransfer = await h.db.fleetStaff.findMany({
      where: { fleetId: world.fleetId, status: "active" },
    });
    const newOwnerRow = staffAfterTransfer.find(
      (s) => s.userId === managerUserId,
    );
    const oldOwnerRow = staffAfterTransfer.find(
      (s) => s.userId === world.ownerId,
    );
    expect(newOwnerRow?.role).toBe("owner");
    expect(oldOwnerRow?.role).toBe("manager");

    // 6. Expiry sweep marks pending invitations past expiresAt as expired
    const readOnlyUserId = await seedUser(h.db, { firstName: "Sade" });
    const readOnlyUser = await h.db.user.findUniqueOrThrow({
      where: { id: readOnlyUserId },
      select: { phone: true },
    });
    const expInvite = await api<{ invitationId: string }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/invitations`,
      token: managerToken, // new owner
      city: world.cityId,
      body: {
        phone: readOnlyUser.phone,
        role: "read_only",
      },
    });
    expect(expInvite.status).toBe(201);

    h.clock.now = new Date(DEFAULT_NOW.getTime() + 8 * 24 * 3600 * 1000);
    const expiredCount = await expireInvitations(h.deps);
    expect(expiredCount).toBe(1);
  });

  it("enforces vehicle document permissions (refusing read_only on upload/attach/url) and resolves document_expiring conflicts on valid review", async () => {
    const world = await seedFleet(h);
    const readOnly = await addStaff(h, world, "read_only");
    const opsUserId = await seedUser(h.db, { firstName: "Ops" });
    const opsToken = await tokenFor(opsUserId, world.cityId, {
      role: "ops_admin",
      scopes: ["mp:admin:read", "mp:admin:write"],
    });

    // Add a vehicle whose insurance expires in 5 days so the expiry sweep opens a document_expiring conflict
    const expiringSoon = new Date(DEFAULT_NOW.getTime() + 5 * 24 * 3600 * 1000);
    const vehicleId = await addVehicle(h, world, {
      insuranceExpiry: expiringSoon,
    });

    await documentSweep(h.deps);
    const openConflictsBefore = await h.db.fleetConflict.findMany({
      where: {
        fleetId: world.fleetId,
        vehicleId,
        type: "document_expiring",
        status: "open",
      },
    });
    expect(openConflictsBefore).toHaveLength(1);

    // 1. read_only staff can list vehicle documents, but cannot presign uploads
    const listByReadOnly = await api<{ documents: unknown[] }>(h.app, {
      path: `/v1/fleets/${world.fleetId}/vehicles/${vehicleId}/documents`,
      token: readOnly.token,
      city: world.cityId,
    });
    expect(listByReadOnly.status).toBe(200);

    const uploadByReadOnly = await api<{ error: { code: string } }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/vehicles/${vehicleId}/documents/uploads`,
      token: readOnly.token,
      city: world.cityId,
      body: {
        purpose: "vehicle_document",
        contentType: "application/pdf",
        sizeBytes: VALID_PDF_BYTES.byteLength,
        sha256Hex: sha256Hex(VALID_PDF_BYTES),
      },
    });
    expect(uploadByReadOnly.status).toBe(403);

    // 2. Owner uploads and attaches renewed insurance document
    const insUpload = await api<{ uploadId: string; objectKey: string }>(
      h.app,
      {
        method: "POST",
        path: `/v1/fleets/${world.fleetId}/vehicles/${vehicleId}/documents/uploads`,
        token: world.ownerToken,
        city: world.cityId,
        body: {
          purpose: "vehicle_document",
          contentType: "application/pdf",
          sizeBytes: VALID_PDF_BYTES.byteLength,
          sha256Hex: sha256Hex(VALID_PDF_BYTES),
        },
      },
    );
    expect(insUpload.status).toBe(201);
    h.docs.putObject(
      insUpload.body.objectKey,
      VALID_PDF_BYTES,
      "application/pdf",
    );

    const newExpiry = "2027-10-01T00:00:00.000Z";
    const attached = await api<{
      documentId: string;
      status: string;
    }>(h.app, {
      method: "POST",
      path: `/v1/fleets/${world.fleetId}/vehicles/${vehicleId}/documents`,
      token: world.ownerToken,
      city: world.cityId,
      body: {
        docType: "insurance",
        uploadId: insUpload.body.uploadId,
        expiresAt: newExpiry,
      },
    });
    expect(attached.status).toBe(201);
    expect(attached.body.status).toBe("pending");

    // 3. read_only staff is refused on GET .../documents/:docId/url
    const urlByReadOnly = await api<{ error: { code: string } }>(h.app, {
      path: `/v1/fleets/${world.fleetId}/vehicles/${vehicleId}/documents/${attached.body.documentId}/url`,
      token: readOnly.token,
      city: world.cityId,
    });
    expect(urlByReadOnly.status).toBe(403);

    // 4. Admin reviews document as `valid` -> updates vehicles.insurance_expiry AND resolves open document_expiring conflict
    const reviewed = await api<{
      documentId: string;
      status: string;
    }>(h.app, {
      method: "POST",
      path: `/v1/admin/fleet-documents/${attached.body.documentId}/review`,
      token: opsToken,
      city: world.cityId,
      body: {
        decision: "valid",
      },
    });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.status).toBe("valid");

    const updatedVehicle = await h.db.vehicle.findUniqueOrThrow({
      where: { id: vehicleId },
      select: { insuranceExpiry: true },
    });
    expect(updatedVehicle.insuranceExpiry?.toISOString()).toBe(newExpiry);

    const openConflictsAfter = await h.db.fleetConflict.findMany({
      where: {
        fleetId: world.fleetId,
        vehicleId,
        type: "document_expiring",
        status: "open",
      },
    });
    expect(openConflictsAfter).toHaveLength(0);
  });
});
