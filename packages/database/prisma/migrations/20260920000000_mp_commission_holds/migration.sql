-- Marketplace commission reservations (M04, handoff CLAUDE.md #4).
--
-- A hold is deliberately NOT a journal movement: the wallet's cleared balance
-- (the journal sum) stays untouched while a bid is live, and the one spendable
-- figure every debit path checks is balance − SUM(holds in active or
-- capture_pending). Money only moves at capture, through an ordinary
-- double-entry journal entry that the deferred balance trigger verifies.

-- CreateTable
CREATE TABLE "mp_commission_holds" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "bid_ref" TEXT NOT NULL,
    "request_ref" TEXT NOT NULL,
    "award_ref" TEXT,
    "receipt_id" TEXT,
    "journal_entry_id" TEXT,
    "reversal_entry_id" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "base_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "commission_bps" INTEGER NOT NULL,
    "rounding_rule" TEXT NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "captured_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),

    CONSTRAINT "mp_commission_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mp_commission_holds_bid_ref_key" ON "mp_commission_holds"("bid_ref");

-- CreateIndex
CREATE UNIQUE INDEX "mp_commission_holds_idempotency_key_key" ON "mp_commission_holds"("idempotency_key");

-- CreateIndex: the spendable sum reads active|capture_pending holds per wallet.
CREATE INDEX "mp_commission_holds_spendable" ON "mp_commission_holds"("wallet_id", "state");

-- AddForeignKey
ALTER TABLE "mp_commission_holds" ADD CONSTRAINT "mp_commission_holds_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
