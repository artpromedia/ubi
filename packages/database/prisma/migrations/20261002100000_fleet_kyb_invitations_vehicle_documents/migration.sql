-- Fleet KYB, staff invitations, ownership transfers and vehicle documents
-- (CC-C02 / P1-05, DEC-5).
--
-- 1. `fleets` gains KYB application columns (`kyb_status`, `registration_number`,
--    `tax_id`, `kyb_fields`, `kyb_declarations_accepted`, `kyb_submitted_at`,
--    `kyb_reviewed_by`, `kyb_reviewed_at`, `kyb_review_note`), and its status
--    vocabulary expands to `('pending_review', 'changes_requested', 'approved',
--    'active', 'rejected', 'suspended')`. Existing active fleets default to
--    `kyb_status = 'approved'` (grandfathered per CC-C02 / DEC-5); newly
--    created fleets start at `status = 'pending_review'`, `kyb_status =
--    'pending_review'`.
-- 2. `fleet_invitations`: invite by phone + role (`owner | manager | read_only`),
--    or `ownership_transfer` (`role = 'owner'`). Status `pending -> accepted |
--    declined | revoked | expired`.
-- 3. `fleet_document_uploads`: short-lived, scope-bound (`kyb | vehicle`)
--    presigned upload slots with declared `content_type`, `size_bytes` and
--    `sha256`, re-verified on attach.
-- 4. `fleet_kyb_documents` and `vehicle_documents`: verified documents attached
--    to a fleet KYB application or a fleet vehicle (`insurance | inspection |
--    registration`), reviewed by UBI ops (`pending -> valid | rejected`, plus
--    `expired` for vehicle documents).

-- AlterTable: fleets
ALTER TABLE "fleets" DROP CONSTRAINT IF EXISTS "fleets_status_check";

ALTER TABLE "fleets"
    ADD COLUMN "kyb_status" TEXT NOT NULL DEFAULT 'approved',
    ADD COLUMN "registration_number" TEXT,
    ADD COLUMN "tax_id" TEXT,
    ADD COLUMN "kyb_fields" JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN "kyb_declarations_accepted" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "kyb_submitted_at" TIMESTAMP(3),
    ADD COLUMN "kyb_reviewed_by" TEXT,
    ADD COLUMN "kyb_reviewed_at" TIMESTAMP(3),
    ADD COLUMN "kyb_review_note" TEXT;

ALTER TABLE "fleets" ADD CONSTRAINT "fleets_status_check" CHECK (
    "status" IN ('pending_review', 'changes_requested', 'approved', 'active', 'rejected', 'suspended')
);

ALTER TABLE "fleets" ADD CONSTRAINT "fleets_kyb_status_check" CHECK (
    "kyb_status" IN ('pending_review', 'changes_requested', 'approved', 'rejected')
);

CREATE INDEX "fleets_kyb_status_created_at_idx" ON "fleets"("kyb_status", "created_at");

-- CreateTable: fleet_invitations
CREATE TABLE "fleet_invitations" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'staff_invite',
    "role" TEXT NOT NULL,
    "invitee_phone" TEXT NOT NULL,
    "invitee_masked" TEXT NOT NULL,
    "invitee_user_id" TEXT,
    "invited_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fleet_invitations_kind_check" CHECK ("kind" IN ('staff_invite', 'ownership_transfer')),
    CONSTRAINT "fleet_invitations_role_check" CHECK ("role" IN ('owner', 'manager', 'read_only')),
    CONSTRAINT "fleet_invitations_transfer_role_check" CHECK ("kind" <> 'ownership_transfer' OR "role" = 'owner'),
    CONSTRAINT "fleet_invitations_status_check" CHECK ("status" IN ('pending', 'accepted', 'declined', 'revoked', 'expired'))
);

CREATE UNIQUE INDEX "fleet_invitations_idempotency_key_key" ON "fleet_invitations"("idempotency_key");
CREATE INDEX "fleet_invitations_fleet_id_status_idx" ON "fleet_invitations"("fleet_id", "status");
CREATE INDEX "fleet_invitations_invitee_user_id_status_idx" ON "fleet_invitations"("invitee_user_id", "status");
CREATE INDEX "fleet_invitations_invitee_phone_status_idx" ON "fleet_invitations"("invitee_phone", "status");

ALTER TABLE "fleet_invitations"
    ADD CONSTRAINT "fleet_invitations_fleet_id_fkey"
    FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: fleet_document_uploads
CREATE TABLE "fleet_document_uploads" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "issued_to" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "reject_reason" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attached_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_document_uploads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fleet_document_uploads_scope_check" CHECK ("scope" IN ('kyb', 'vehicle')),
    CONSTRAINT "fleet_document_uploads_status_check" CHECK ("status" IN ('issued', 'attached', 'rejected')),
    CONSTRAINT "fleet_document_uploads_size_check" CHECK ("size_bytes" BETWEEN 1 AND 10485760),
    CONSTRAINT "fleet_document_uploads_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "fleet_document_uploads_object_key_key" ON "fleet_document_uploads"("object_key");
CREATE INDEX "fleet_document_uploads_fleet_id_scope_status_idx" ON "fleet_document_uploads"("fleet_id", "scope", "status");
CREATE INDEX "fleet_document_uploads_subject_id_status_idx" ON "fleet_document_uploads"("subject_id", "status");

ALTER TABLE "fleet_document_uploads"
    ADD CONSTRAINT "fleet_document_uploads_fleet_id_fkey"
    FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: fleet_kyb_documents
CREATE TABLE "fleet_kyb_documents" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "requirement_key" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "uploaded_by" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_kyb_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fleet_kyb_documents_status_check" CHECK ("status" IN ('pending', 'valid', 'rejected'))
);

CREATE UNIQUE INDEX "fleet_kyb_documents_upload_id_key" ON "fleet_kyb_documents"("upload_id");
CREATE INDEX "fleet_kyb_documents_fleet_id_requirement_key_idx" ON "fleet_kyb_documents"("fleet_id", "requirement_key");
CREATE INDEX "fleet_kyb_documents_status_created_at_idx" ON "fleet_kyb_documents"("status", "created_at");

ALTER TABLE "fleet_kyb_documents"
    ADD CONSTRAINT "fleet_kyb_documents_fleet_id_fkey"
    FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fleet_kyb_documents"
    ADD CONSTRAINT "fleet_kyb_documents_upload_id_fkey"
    FOREIGN KEY ("upload_id") REFERENCES "fleet_document_uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: vehicle_documents
CREATE TABLE "vehicle_documents" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "file_ref" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "uploaded_by" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vehicle_documents_type_check" CHECK ("type" IN ('insurance', 'inspection', 'registration')),
    CONSTRAINT "vehicle_documents_status_check" CHECK ("status" IN ('pending', 'valid', 'rejected', 'expired'))
);

CREATE UNIQUE INDEX "vehicle_documents_upload_id_key" ON "vehicle_documents"("upload_id");
CREATE INDEX "vehicle_documents_vehicle_id_type_created_at_idx" ON "vehicle_documents"("vehicle_id", "type", "created_at");
CREATE INDEX "vehicle_documents_fleet_id_status_idx" ON "vehicle_documents"("fleet_id", "status");
CREATE INDEX "vehicle_documents_status_created_at_idx" ON "vehicle_documents"("status", "created_at");

ALTER TABLE "vehicle_documents"
    ADD CONSTRAINT "vehicle_documents_fleet_id_fkey"
    FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_documents"
    ADD CONSTRAINT "vehicle_documents_vehicle_id_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_documents"
    ADD CONSTRAINT "vehicle_documents_upload_id_fkey"
    FOREIGN KEY ("upload_id") REFERENCES "fleet_document_uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
