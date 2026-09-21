-- Rider funding reservations (C02, handoff CLAUDE.md #4).
--
-- The award saga's rider-side funding authorization becomes a DURABLE
-- reservation: like a commission hold it is a table row, never a journal
-- movement — the wallet's cleared balance (the journal sum) stays untouched
-- and the one spendable figure every debit path checks drops by the sum of
-- `active` reservations. The reservation is consumed exactly once inside the
-- marketplace settlement transaction, or released (with a linked reason) when
-- the award is abandoned. One reservation per award, enforced by the unique
-- index on award_id.

-- CreateTable
CREATE TABLE "mp_rider_reservations" (
    "id" TEXT NOT NULL,
    "award_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "payment_method_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "mp_rider_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the award id is the idempotency authority — one reservation per award.
CREATE UNIQUE INDEX "mp_rider_reservations_award_id_key" ON "mp_rider_reservations"("award_id");

-- CreateIndex: the spendable sum reads active reservations per wallet.
CREATE INDEX "mp_rider_reservations_spendable" ON "mp_rider_reservations"("wallet_id", "status");

-- AddForeignKey
ALTER TABLE "mp_rider_reservations" ADD CONSTRAINT "mp_rider_reservations_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
