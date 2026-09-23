-- Travel payment items (P7 / recheck T02).
--
-- payment-service's side of travel-service's per-item money ladder, served at
-- /v1/finance/travel/{authorize,capture,release,refund}. One row per travel
-- order item:
--
--  - authorize creates the row in `authorized`. Like a commission hold or a
--    rider funding reservation it is a table row, never a journal movement:
--    the wallet's cleared balance (the journal sum) stays untouched and the
--    one spendable figure every debit path checks drops by the sum of
--    `authorized` items;
--  - capture posts ONE journal entry (traveller wallet -> travel_clearing) and
--    ends the encumbrance in the same transaction;
--  - release frees an unused authorization (no journal movement);
--  - refund posts a linked counter-entry (travel_clearing -> wallet) whose
--    counterpart reference names the capture entry, fully or partially.
--
-- Supplier travel never touches mp_commission_holds or any ride account.
--
-- travel_payment_ops is the idempotency record: one row per accepted POST,
-- unique on the scoped Idempotency-Key, carrying the payload hash (a replay
-- with different money terms is refused) and the original response (a replay
-- answers it verbatim).

-- CreateTable
CREATE TABLE "travel_payment_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "authorized_minor" BIGINT NOT NULL,
    "captured_minor" BIGINT NOT NULL DEFAULT 0,
    "refunded_minor" BIGINT NOT NULL DEFAULT 0,
    "capture_entry_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "captured_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),

    CONSTRAINT "travel_payment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_payment_ops" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "client_key" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "entry_id" TEXT,
    "on_behalf_of_id" TEXT,
    "on_behalf_of_role" TEXT,
    "reason" TEXT,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_payment_ops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one authorization per travel order item, ever.
CREATE UNIQUE INDEX "travel_payment_items_order_id_key" ON "travel_payment_items"("order_id");

-- CreateIndex: the spendable sum reads authorized items per wallet.
CREATE INDEX "travel_payment_items_spendable" ON "travel_payment_items"("wallet_id", "state");

-- CreateIndex: the scoped Idempotency-Key makes a replay a replay.
CREATE UNIQUE INDEX "travel_payment_ops_idempotency_key_key" ON "travel_payment_ops"("idempotency_key");

-- CreateIndex
CREATE INDEX "travel_payment_ops_item_id_created_at_idx" ON "travel_payment_ops"("item_id", "created_at");

-- AddForeignKey
ALTER TABLE "travel_payment_items" ADD CONSTRAINT "travel_payment_items_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_payment_items" ADD CONSTRAINT "travel_payment_items_capture_entry_id_fkey" FOREIGN KEY ("capture_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_payment_ops" ADD CONSTRAINT "travel_payment_ops_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "travel_payment_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_payment_ops" ADD CONSTRAINT "travel_payment_ops_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Money bounds, enforced by the database rather than by application code
-- remembering to check: an authorization is positive, a capture never exceeds
-- what was authorized, and refunds never exceed what was captured. The state
-- set is closed. (Prisma does not model CHECK constraints, so these carry no
-- schema drift.)
ALTER TABLE "travel_payment_items" ADD CONSTRAINT "travel_payment_items_amounts_check" CHECK (
    "authorized_minor" > 0
    AND "captured_minor" >= 0
    AND "captured_minor" <= "authorized_minor"
    AND "refunded_minor" >= 0
    AND "refunded_minor" <= "captured_minor"
);

ALTER TABLE "travel_payment_items" ADD CONSTRAINT "travel_payment_items_state_check" CHECK (
    "state" IN ('authorized', 'captured', 'released', 'partially_refunded', 'refunded')
);

ALTER TABLE "travel_payment_ops" ADD CONSTRAINT "travel_payment_ops_op_check" CHECK (
    "op" IN ('authorize', 'capture', 'release', 'refund')
    AND "amount_minor" > 0
);
