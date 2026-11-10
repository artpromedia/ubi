-- Audited pilot driver ops wallet credits and idempotent PSP webhook receipts
-- (CC-B03, DEC-6 = C).
--
-- Invariants enforced at the database boundary:
--  1. `ops_wallet_credits.amount_minor > 0`
--  2. `ops_wallet_credits.status` is one of `pending_approval`, `approved`,
--     `rejected`, `reversed`
--  3. Two-person approval (`approved_by IS NULL OR approved_by <> created_by`):
--     an author can never approve their own credit, even if a caller bypassed
--     service validation
--  4. Unique idempotency keys on every mutation (`request`, `approve`,
--     `reject`, `reverse`)
--  5. `topups.psp_ref` is unique across non-null provider references and
--     `psp_webhook_events` is unique on `(provider, event_type, external_ref)`,
--     so replayed PSP callbacks can never credit a wallet twice.

-- CreateTable
CREATE TABLE "ops_wallet_credits" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "driver_user_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "note" TEXT,
    "reference_ref" TEXT,
    "status" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_by_role" TEXT NOT NULL,
    "request_payload_hash" TEXT NOT NULL,
    "request_idempotency_key" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_by_role" TEXT,
    "approval_note" TEXT,
    "approved_at" TIMESTAMP(3),
    "approve_payload_hash" TEXT,
    "approve_idempotency_key" TEXT,
    "rejected_by" TEXT,
    "rejected_by_role" TEXT,
    "rejected_reason" TEXT,
    "rejected_at" TIMESTAMP(3),
    "reject_payload_hash" TEXT,
    "reject_idempotency_key" TEXT,
    "reversed_by" TEXT,
    "reversed_by_role" TEXT,
    "reversal_reason" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reverse_payload_hash" TEXT,
    "reverse_idempotency_key" TEXT,
    "entry_id" TEXT,
    "reversal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_wallet_credits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ops_wallet_credits_positive_amount_chk" CHECK ("amount_minor" > 0),
    CONSTRAINT "ops_wallet_credits_status_chk" CHECK (
        "status" IN ('pending_approval', 'approved', 'rejected', 'reversed')
    ),
    CONSTRAINT "ops_wallet_credits_dual_approval_chk" CHECK (
        "approved_by" IS NULL OR "approved_by" <> "created_by"
    )
);

-- CreateTable
CREATE TABLE "psp_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "external_ref" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "topup_id" TEXT,
    "nip_id" TEXT,
    "entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "psp_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "topups_psp_ref_key" ON "topups"("psp_ref");

-- CreateIndex
CREATE UNIQUE INDEX "ops_wallet_credits_request_idempotency_key_key" ON "ops_wallet_credits"("request_idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ops_wallet_credits_approve_idempotency_key_key" ON "ops_wallet_credits"("approve_idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ops_wallet_credits_reject_idempotency_key_key" ON "ops_wallet_credits"("reject_idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ops_wallet_credits_reverse_idempotency_key_key" ON "ops_wallet_credits"("reverse_idempotency_key");

-- CreateIndex
CREATE INDEX "ops_wallet_credits_city_id_status_created_at_idx" ON "ops_wallet_credits"("city_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ops_wallet_credits_driver_user_id_created_at_idx" ON "ops_wallet_credits"("driver_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ops_wallet_credits_city_id_created_at_idx" ON "ops_wallet_credits"("city_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "psp_webhook_events_provider_event_type_external_ref_key" ON "psp_webhook_events"("provider", "event_type", "external_ref");

-- CreateIndex
CREATE INDEX "psp_webhook_events_provider_external_ref_idx" ON "psp_webhook_events"("provider", "external_ref");

-- AddForeignKey
ALTER TABLE "ops_wallet_credits" ADD CONSTRAINT "ops_wallet_credits_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
