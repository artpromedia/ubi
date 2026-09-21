-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "driver_id" UUID,
ADD COLUMN     "marketplace_metadata" JSONB;

-- CreateIndex (driver_id was assumed by delivery-service's Go code since M03
-- but had no index — or column — until this migration; see C07 report).
CREATE INDEX "deliveries_driver_id_idx" ON "deliveries"("driver_id");

-- CreateIndex: the marketplace award hand-off (MarketplaceAssign) looks up an
-- existing delivery by award id for idempotent replay
-- (marketplace_metadata->>'marketplaceAwardId'); a partial expression index
-- makes that an index lookup instead of a sequential scan, and doubles as a
-- soft uniqueness guard (the handler itself still resolves a race with a
-- Redis lock, matching AcceptDelivery's existing idiom).
CREATE INDEX "deliveries_marketplace_award_id_idx" ON "deliveries" (((marketplace_metadata->>'marketplaceAwardId'))) WHERE marketplace_metadata IS NOT NULL;

-- CreateTable
CREATE TABLE "delivery_custody" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'created',
    "version" INTEGER NOT NULL DEFAULT 1,
    "sender_id" UUID NOT NULL,
    "driver_id" UUID,
    "recipient_unreachable_at" TIMESTAMP(3),
    "picked_up_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_custody_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custody_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "custody_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custody_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_proofs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "custody_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "uploaded_role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "custody_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "fee_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT,
    "charge_status" TEXT NOT NULL DEFAULT 'not_required',
    "proposed_by" UUID NOT NULL,
    "proposed_by_role" TEXT NOT NULL,
    "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consent_state" TEXT NOT NULL DEFAULT 'pending',
    "consent_expires_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_custody_delivery_id_key" ON "delivery_custody"("delivery_id");

-- CreateIndex
CREATE INDEX "delivery_custody_state_idx" ON "delivery_custody"("state");

-- CreateIndex
CREATE INDEX "custody_events_custody_id_created_at_idx" ON "custody_events"("custody_id", "created_at");

-- CreateIndex
CREATE INDEX "custody_events_delivery_id_idx" ON "custody_events"("delivery_id");

-- CreateIndex
CREATE INDEX "delivery_proofs_custody_id_idx" ON "delivery_proofs"("custody_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_proofs_delivery_id_type_sha256_key" ON "delivery_proofs"("delivery_id", "type", "sha256");

-- CreateIndex
CREATE INDEX "delivery_returns_delivery_id_idx" ON "delivery_returns"("delivery_id");

-- CreateIndex
CREATE INDEX "delivery_returns_consent_state_consent_expires_at_idx" ON "delivery_returns"("consent_state", "consent_expires_at");

-- AddForeignKey
ALTER TABLE "delivery_custody" ADD CONSTRAINT "delivery_custody_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_custody_id_fkey" FOREIGN KEY ("custody_id") REFERENCES "delivery_custody"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_custody_id_fkey" FOREIGN KEY ("custody_id") REFERENCES "delivery_custody"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_returns" ADD CONSTRAINT "delivery_returns_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_returns" ADD CONSTRAINT "delivery_returns_custody_id_fkey" FOREIGN KEY ("custody_id") REFERENCES "delivery_custody"("id") ON DELETE CASCADE ON UPDATE CASCADE;
