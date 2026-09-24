-- Airport transfer intents (P16 / recheck T03).
--
-- Replaces the airport "reservation" fiction: a ride_reservation_links row was
-- only ever a link plus an event — no marketplace request, no award, no pickup
-- time, class or status — so nothing in it was secured transport. That table
-- is left in place, untouched and no longer written, so what a traveller was
-- once shown stays auditable; nothing is backfilled from it with a guess.
--
-- airport_transfers is the persisted INTENT: a flight order (kind = flight,
-- owned by the traveller, same city) + one leg + direction (arrival pickup /
-- departure drop-off), the airport and the other end, a timezone-aware pickup
-- window derived from the leg under the city's airport policy, the vehicle
-- class, the traveller's approved spend limit (integer minor units) and the
-- policy version. travel-service turns it into a Book for Later SCHEDULED
-- REQUEST on ride-service near the pickup; `awarded` is written only when
-- ride-service reports a requester-approved award. The row holds no flight
-- money and no ride money: the two stay separate orders.
--
-- Idempotent create: the id is derived from the scoped Idempotency-Key, and
-- the normalized request hash plus the stored answer (create_result) make a
-- replay answer the original and a conflicting replay a 409.
--
-- airport_transfer_actions records each accepted traveller action (cancel,
-- keep, re-request, approve a new limit) under its scoped key the same way.
--
-- travel_flight_status_events is the dedupe + monotonic record of verified
-- flight delay / cancellation observations per order leg.
--
-- Prisma does not model CHECK constraints, so the closed sets below carry no
-- schema drift.

-- CreateTable
CREATE TABLE "airport_transfers" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "leg_index" INTEGER NOT NULL,
    "flight_number" TEXT,
    "airport_code" TEXT NOT NULL,
    "flight_depart_at" TIMESTAMP(3) NOT NULL,
    "flight_arrive_at" TIMESTAMP(3) NOT NULL,
    "flight_status" TEXT NOT NULL DEFAULT 'scheduled',
    "flight_status_at" TIMESTAMP(3),
    "pickup" JSONB NOT NULL,
    "dropoff" JSONB NOT NULL,
    "time_zone" TEXT NOT NULL,
    "pickup_at" TIMESTAMP(3),
    "window_end" TIMESTAMP(3),
    "arrive_by" TIMESTAMP(3),
    "window_sec" INTEGER NOT NULL,
    "vehicle_class" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "max_fare_minor" BIGINT NOT NULL,
    "requested_fare_minor" BIGINT,
    "payment_method_id" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "submit_after" TIMESTAMP(3) NOT NULL,
    "next_action_at" TIMESTAMP(3),
    "lease_until" TIMESTAMP(3),
    "generation" INTEGER NOT NULL DEFAULT 0,
    "pending_create" JSONB,
    "retime_target" JSONB,
    "retimed_count" INTEGER NOT NULL DEFAULT 0,
    "pending_cancel" TEXT,
    "scheduled_request_id" TEXT,
    "ride_request_id" TEXT,
    "ride_state" TEXT,
    "ride_request_state" TEXT,
    "ride_notice" JSONB,
    "action_required" JSONB,
    "outcome" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "request_hash" TEXT NOT NULL,
    "create_result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "airport_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airport_transfer_actions" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airport_transfer_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_flight_status_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "leg_index" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "depart_at" TIMESTAMP(3),
    "arrive_at" TIMESTAMP(3),
    "observed_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" JSONB,

    CONSTRAINT "travel_flight_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "airport_transfers_order_id_leg_index_idx" ON "airport_transfers"("order_id", "leg_index");

-- CreateIndex
CREATE INDEX "airport_transfers_user_id_created_at_idx" ON "airport_transfers"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "airport_transfers_state_next_action_at_idx" ON "airport_transfers"("state", "next_action_at");

-- CreateIndex
CREATE INDEX "airport_transfer_actions_transfer_id_created_at_idx" ON "airport_transfer_actions"("transfer_id", "created_at");

-- CreateIndex
CREATE INDEX "travel_flight_status_events_order_id_leg_index_observed_at_idx" ON "travel_flight_status_events"("order_id", "leg_index", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "travel_flight_status_events_source_event_id_key" ON "travel_flight_status_events"("source", "event_id");

-- AddForeignKey
ALTER TABLE "airport_transfers" ADD CONSTRAINT "airport_transfers_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "travel_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airport_transfer_actions" ADD CONSTRAINT "airport_transfer_actions_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "airport_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_flight_status_events" ADD CONSTRAINT "travel_flight_status_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "travel_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Closed sets and money sanity.
ALTER TABLE "airport_transfers" ADD CONSTRAINT "airport_transfers_state_check" CHECK (
    "state" IN ('pending_unassigned', 'requested', 'awarded', 'failed', 'cancelled')
);

ALTER TABLE "airport_transfers" ADD CONSTRAINT "airport_transfers_direction_check" CHECK (
    "direction" IN ('arrival_pickup', 'departure_dropoff')
);

ALTER TABLE "airport_transfers" ADD CONSTRAINT "airport_transfers_flight_status_check" CHECK (
    "flight_status" IN ('scheduled', 'delayed', 'cancelled')
);

ALTER TABLE "airport_transfers" ADD CONSTRAINT "airport_transfers_amounts_check" CHECK (
    "max_fare_minor" > 0
    AND ("requested_fare_minor" IS NULL
         OR ("requested_fare_minor" > 0 AND "requested_fare_minor" <= "max_fare_minor"))
    AND "window_sec" > 0
    AND "leg_index" >= 0
    AND "generation" >= 0
    AND "retimed_count" >= 0
);

ALTER TABLE "travel_flight_status_events" ADD CONSTRAINT "travel_flight_status_events_status_check" CHECK (
    "status" IN ('delayed', 'cancelled')
);
