-- Delivery vertical completion (P17, recheck R02).
--
-- 1. Verified proof storage. `delivery_proof_uploads` is a server-issued,
--    short-lived, scope-bound upload slot: delivery-service generates the
--    object key (proofs/<delivery>/<type>/<actor>/<upload>), records the
--    declared content type, size and SHA-256 and who it was issued to, and
--    answers a presigned PUT for exactly that key. A proof (`delivery_proofs`)
--    is attached only from such an upload, by the actor it was issued to, and
--    only after the stored object's bytes verify — `upload_id` and
--    `verified_at` record that. Rows written before this migration keep both
--    NULL: they were client-asserted references and stay marked as such.
--
-- 2. Charged returns. `delivery_returns` gains the mirror of payment-service's
--    charge (`charge_city_id`, `charge_ref`, `charge_entry_id`,
--    `charge_updated_at`); `charge_status` becomes a closed set.
--    `delivery_return_charges` / `delivery_return_charge_ops` are
--    payment-service's side (/v1/finance/delivery-returns): one charge per
--    return, reserved from the sender's wallet through a companion
--    mp_rider_reservations row (award key `delivery_return:<returnId>`, so the
--    one spendable figure already subtracts it), captured once as a
--    sender-wallet -> driver-wallet journal entry, or released (a release
--    that arrives first leaves a tombstone so a late reserve is refused). The
--    original award's commission hold is only ever read (to bind the payee
--    to the award's driver), never adjusted or re-captured.

-- AlterTable
ALTER TABLE "delivery_proofs" ADD COLUMN     "upload_id" UUID,
ADD COLUMN     "verified_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "delivery_returns" ADD COLUMN     "charge_city_id" TEXT,
ADD COLUMN     "charge_entry_id" TEXT,
ADD COLUMN     "charge_ref" TEXT,
ADD COLUMN     "charge_updated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "delivery_proof_uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "custody_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "issued_to" UUID NOT NULL,
    "issued_role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "reject_reason" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attached_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_proof_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_return_charges" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "award_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "wallet_id" TEXT,
    "city_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "fee_minor" BIGINT NOT NULL,
    "state" TEXT NOT NULL,
    "reservation_id" TEXT,
    "capture_entry_id" TEXT,
    "release_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "captured_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),

    CONSTRAINT "delivery_return_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_return_charge_ops" (
    "id" TEXT NOT NULL,
    "charge_id" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "client_key" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "entry_id" TEXT,
    "reason" TEXT,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_return_charge_ops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_proof_uploads_object_key_key" ON "delivery_proof_uploads"("object_key");

-- CreateIndex
CREATE INDEX "delivery_proof_uploads_delivery_id_status_idx" ON "delivery_proof_uploads"("delivery_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_return_charges_return_id_key" ON "delivery_return_charges"("return_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_return_charges_reservation_id_key" ON "delivery_return_charges"("reservation_id");

-- CreateIndex
CREATE INDEX "delivery_return_charges_delivery_id_idx" ON "delivery_return_charges"("delivery_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_return_charge_ops_idempotency_key_key" ON "delivery_return_charge_ops"("idempotency_key");

-- CreateIndex
CREATE INDEX "delivery_return_charge_ops_charge_id_created_at_idx" ON "delivery_return_charge_ops"("charge_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_proofs_upload_id_key" ON "delivery_proofs"("upload_id");

-- CreateIndex
CREATE INDEX "delivery_returns_charge_status_idx" ON "delivery_returns"("charge_status");

-- AddForeignKey
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "delivery_proof_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_proof_uploads" ADD CONSTRAINT "delivery_proof_uploads_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_proof_uploads" ADD CONSTRAINT "delivery_proof_uploads_custody_id_fkey" FOREIGN KEY ("custody_id") REFERENCES "delivery_custody"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_return_charges" ADD CONSTRAINT "delivery_return_charges_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_return_charges" ADD CONSTRAINT "delivery_return_charges_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "mp_rider_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_return_charges" ADD CONSTRAINT "delivery_return_charges_capture_entry_id_fkey" FOREIGN KEY ("capture_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_return_charge_ops" ADD CONSTRAINT "delivery_return_charge_ops_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "delivery_return_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_return_charge_ops" ADD CONSTRAINT "delivery_return_charge_ops_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Closed value sets and money bounds, enforced by the database rather than by
-- application code remembering to check. (Prisma does not model CHECK
-- constraints, so these carry no schema drift.)
ALTER TABLE "delivery_proof_uploads" ADD CONSTRAINT "delivery_proof_uploads_values_check" CHECK (
    "type" IN ('pickup', 'delivery', 'return')
    AND "status" IN ('issued', 'attached', 'rejected')
    AND "size_bytes" > 0
    AND "sha256" ~ '^[a-f0-9]{64}$'
);

ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_type_check" CHECK (
    "type" IN ('pickup', 'delivery', 'return')
);

ALTER TABLE "delivery_returns" ADD CONSTRAINT "delivery_returns_charge_status_check" CHECK (
    "charge_status" IN (
        'not_required', 'unsupported', 'authorization_required', 'reserving',
        'reserved', 'capture_pending', 'captured', 'released'
    )
    AND "fee_minor" >= 0
);

-- A reserved or captured charge always names the wallet and the reservation
-- that encumbered it; only a tombstone (released before any reservation
-- existed) may carry neither.
ALTER TABLE "delivery_return_charges" ADD CONSTRAINT "delivery_return_charges_values_check" CHECK (
    "state" IN ('reserved', 'captured', 'released')
    AND "fee_minor" > 0
    AND ("state" = 'released' OR ("wallet_id" IS NOT NULL AND "reservation_id" IS NOT NULL))
);

ALTER TABLE "delivery_return_charge_ops" ADD CONSTRAINT "delivery_return_charge_ops_op_check" CHECK (
    "op" IN ('reserve', 'capture', 'release')
    AND "amount_minor" > 0
);
