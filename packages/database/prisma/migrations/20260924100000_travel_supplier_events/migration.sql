-- Travel supplier events and order context (P8 — Duffel / LiteAPI adapters).
--
-- travel_orders gains:
--  - city_id: the city the order was placed in. payment-service scopes each
--    travel money item to a city and refuses a capture/release that names a
--    different one, so a webhook- or reconcile-driven capture must use the
--    order's own city — not whatever header the caller happened to send;
--  - supplier_offer_ref: the supplier's offer / quote id the order was booked
--    from. Duffel's `order.creation_failed` event names only the offer, so the
--    order is resolved through it (indexed per supplier).
--
-- travel_webhooks gains verified-event metadata — event_type, object_ref (the
-- supplier object the event is about), occurred_at (the supplier's own
-- timestamp) and outcome (what processing did: confirmed, already_resolved,
-- supplier_conflict, …) — so ops can see duplicate and out-of-order delivery
-- without re-parsing payloads. The dedupe key stays the existing unique
-- (supplier_id, external_id); a delivery whose signature fails is now recorded
-- under a `rejected:` id of our own so it can never occupy a real event's slot.
--
-- travel_documents becomes unique per (order_id, kind, number): a ticket or a
-- booking confirmation is written once even when a webhook and a reconcile
-- converge the same order at the same moment. Exact duplicates written before
-- this index (same order, kind and number) are collapsed to the earliest row
-- first — they carry no information of their own.
--
-- All new columns are nullable: existing rows keep their meaning, and nothing
-- is backfilled with a guess.

-- AlterTable
ALTER TABLE "travel_orders" ADD COLUMN     "city_id" TEXT,
ADD COLUMN     "supplier_offer_ref" TEXT;

-- AlterTable
ALTER TABLE "travel_webhooks" ADD COLUMN     "event_type" TEXT,
ADD COLUMN     "object_ref" TEXT,
ADD COLUMN     "occurred_at" TIMESTAMP(3),
ADD COLUMN     "outcome" TEXT;

-- Collapse exact duplicate documents before the unique index.
DELETE FROM "travel_documents" AS later
USING "travel_documents" AS earlier
WHERE later."order_id" = earlier."order_id"
  AND later."kind" = earlier."kind"
  AND later."number" = earlier."number"
  AND (later."issued_at", later."id") > (earlier."issued_at", earlier."id");

-- CreateIndex
CREATE UNIQUE INDEX "travel_documents_order_id_kind_number_key" ON "travel_documents"("order_id", "kind", "number");

-- CreateIndex
CREATE INDEX "travel_orders_supplier_id_supplier_offer_ref_idx" ON "travel_orders"("supplier_id", "supplier_offer_ref");

-- CreateIndex
CREATE INDEX "travel_webhooks_supplier_id_object_ref_idx" ON "travel_webhooks"("supplier_id", "object_ref");
