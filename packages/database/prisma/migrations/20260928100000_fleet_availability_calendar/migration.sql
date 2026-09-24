-- Fleet availability, maintenance and assignments (addendum A05) —
-- fleet-service (services/fleet-service) is the only writer.
--
-- Contract: packages/contracts/src/fleet.ts. Decisions:
-- docs/design/FLEET_CALENDAR_DECISIONS.md (wins over the design handoff in
-- docs/launch-readiness/handoff-fleet-calendar/).
--
--  - fleets / fleet_staff (owner | manager | read_only) / fleet_vehicles: a
--    vehicle (the shared `vehicles` row) is in at most ONE fleet at a time;
--  - fleet_assignment_proposals: vehicle + shift + remittance terms a fleet
--    proposes. A proposal never counts as availability; only the driver's
--    PIN signature (verified by user-service) turns it into
--  - fleet_assignments: the assignment HISTORY (one row per signed terms
--    version) that replaces reliance on the single drivers.vehicle_id. Terms
--    are immutable snapshots — settlement (payment-service, internal
--    contract B) always reads the version signed for the week;
--  - fleet_assignment_shift_segments: every signed shift as local-day
--    segments, with EXCLUDE constraints so two active signed shifts on one
--    vehicle — or of one driver — can never overlap, whatever the app races;
--  - fleet_maintenance_blocks: planned kinds occupy the vehicle through
--    ride-service's single occupancy ledger (the vehicle/booking exclusion
--    lives there — decisions correction 3); here an EXCLUDE refuses two
--    planned blocks, or two off-road reports, on one vehicle at once;
--  - driver_availability: driver-authored windows (a fleet sees time off
--    only as "unavailable");
--  - fleet_conflicts: the conflict centre (allowed actions are computed per
--    caller role, never stored);
--  - fleet_vehicle_swap_requests and fleet_idempotency_records.
--
-- There are NO settlement or money-movement tables here: remittance is
-- journaled by payment-service on the canonical ledger.

-- Equality on uuid/text inside GiST exclusion constraints.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateTable
CREATE TABLE "fleets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_staff" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "added_by" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "fleet_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_vehicles" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "classes" TEXT[],
    "capacity" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "added_by" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "fleet_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_assignment_proposals" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" TEXT NOT NULL,
    "proposed_by" TEXT NOT NULL,
    "proposed_by_role" TEXT NOT NULL,
    "supersedes_assignment_id" TEXT,
    "shift_kind" TEXT NOT NULL,
    "shift_start" TEXT NOT NULL,
    "shift_end" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "terms_version" INTEGER NOT NULL,
    "terms_type" TEXT NOT NULL,
    "amount_minor" BIGINT,
    "currency" TEXT NOT NULL,
    "percent" DECIMAL(5,2),
    "shortfall_policy" TEXT NOT NULL,
    "shortfall_max_weeks" INTEGER NOT NULL,
    "fuel_by" TEXT NOT NULL,
    "servicing_by" TEXT NOT NULL,
    "terms_hash" TEXT NOT NULL,
    "diff" JSONB NOT NULL,
    "check_result" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_assignment_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_assignments" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "shift_kind" TEXT NOT NULL,
    "shift_start" TEXT NOT NULL,
    "shift_end" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "terms_version" INTEGER NOT NULL,
    "terms_type" TEXT NOT NULL,
    "amount_minor" BIGINT,
    "currency" TEXT NOT NULL,
    "percent" DECIMAL(5,2),
    "shortfall_policy" TEXT NOT NULL,
    "shortfall_max_weeks" INTEGER NOT NULL,
    "fuel_by" TEXT NOT NULL,
    "servicing_by" TEXT NOT NULL,
    "terms_hash" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL,
    "pin_verification_ref" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "notice_started_at" TIMESTAMP(3),
    "notice_started_by" TEXT,
    "ended_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_assignment_shift_segments" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" TEXT NOT NULL,
    "days_from" DATE NOT NULL,
    "days_to" DATE,
    "minute_from" INTEGER NOT NULL,
    "minute_to" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_assignment_shift_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_maintenance_blocks" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "zone" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL,
    "occupancy_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_by_role" TEXT NOT NULL,
    "off_road_flagged_at" TIMESTAMP(3),
    "off_road_flag_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "fleet_maintenance_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_availability" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "rrule" TEXT,
    "zone" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "set_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "driver_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_conflicts" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "driver_id" TEXT,
    "booking_block_id" TEXT,
    "maintenance_block_id" TEXT,
    "assignment_id" TEXT,
    "resolver_roles" TEXT[],
    "deadline_at" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "detail" JSONB,
    "resolution" TEXT,
    "last_reminded_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "fleet_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_vehicle_swap_requests" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "booking_block_id" TEXT NOT NULL,
    "from_vehicle_id" TEXT NOT NULL,
    "to_vehicle_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "swap_id" TEXT,
    "status" TEXT NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_vehicle_swap_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_idempotency_records" (
    "id" TEXT NOT NULL,
    "scoped_key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fleets_city_id_idx" ON "fleets"("city_id");

-- CreateIndex
CREATE INDEX "fleet_staff_user_id_status_idx" ON "fleet_staff"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_staff_fleet_id_user_id_key" ON "fleet_staff"("fleet_id", "user_id");

-- CreateIndex
CREATE INDEX "fleet_vehicles_fleet_id_status_idx" ON "fleet_vehicles"("fleet_id", "status");

-- CreateIndex
CREATE INDEX "fleet_vehicles_vehicle_id_idx" ON "fleet_vehicles"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_assignment_proposals_idempotency_key_key" ON "fleet_assignment_proposals"("idempotency_key");

-- CreateIndex
CREATE INDEX "fleet_assignment_proposals_driver_id_status_idx" ON "fleet_assignment_proposals"("driver_id", "status");

-- CreateIndex
CREATE INDEX "fleet_assignment_proposals_fleet_id_status_idx" ON "fleet_assignment_proposals"("fleet_id", "status");

-- CreateIndex
CREATE INDEX "fleet_assignment_proposals_status_expires_at_idx" ON "fleet_assignment_proposals"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_assignments_proposal_id_key" ON "fleet_assignments"("proposal_id");

-- CreateIndex
CREATE INDEX "fleet_assignments_vehicle_id_status_idx" ON "fleet_assignments"("vehicle_id", "status");

-- CreateIndex
CREATE INDEX "fleet_assignments_driver_id_status_idx" ON "fleet_assignments"("driver_id", "status");

-- CreateIndex
CREATE INDEX "fleet_assignments_fleet_id_status_idx" ON "fleet_assignments"("fleet_id", "status");

-- CreateIndex
CREATE INDEX "fleet_assignment_shift_segments_assignment_id_idx" ON "fleet_assignment_shift_segments"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_maintenance_blocks_idempotency_key_key" ON "fleet_maintenance_blocks"("idempotency_key");

-- CreateIndex
CREATE INDEX "fleet_maintenance_blocks_vehicle_id_starts_at_idx" ON "fleet_maintenance_blocks"("vehicle_id", "starts_at");

-- CreateIndex
CREATE INDEX "fleet_maintenance_blocks_fleet_id_status_idx" ON "fleet_maintenance_blocks"("fleet_id", "status");

-- CreateIndex
CREATE INDEX "fleet_maintenance_blocks_status_starts_at_idx" ON "fleet_maintenance_blocks"("status", "starts_at");

-- CreateIndex
CREATE INDEX "driver_availability_driver_id_status_idx" ON "driver_availability"("driver_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_conflicts_dedupe_key_key" ON "fleet_conflicts"("dedupe_key");

-- CreateIndex
CREATE INDEX "fleet_conflicts_fleet_id_status_idx" ON "fleet_conflicts"("fleet_id", "status");

-- CreateIndex
CREATE INDEX "fleet_conflicts_driver_id_status_idx" ON "fleet_conflicts"("driver_id", "status");

-- CreateIndex
CREATE INDEX "fleet_conflicts_status_deadline_at_idx" ON "fleet_conflicts"("status", "deadline_at");

-- CreateIndex
CREATE INDEX "fleet_conflicts_maintenance_block_id_idx" ON "fleet_conflicts"("maintenance_block_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_vehicle_swap_requests_idempotency_key_key" ON "fleet_vehicle_swap_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "fleet_vehicle_swap_requests_fleet_id_created_at_idx" ON "fleet_vehicle_swap_requests"("fleet_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_idempotency_records_scoped_key_key" ON "fleet_idempotency_records"("scoped_key");

-- CreateIndex
CREATE INDEX "fleet_idempotency_records_actor_id_created_at_idx" ON "fleet_idempotency_records"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "fleet_staff" ADD CONSTRAINT "fleet_staff_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_assignment_proposals" ADD CONSTRAINT "fleet_assignment_proposals_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_assignments" ADD CONSTRAINT "fleet_assignments_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_assignments" ADD CONSTRAINT "fleet_assignments_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "fleet_assignment_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_assignment_shift_segments" ADD CONSTRAINT "fleet_assignment_shift_segments_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "fleet_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_maintenance_blocks" ADD CONSTRAINT "fleet_maintenance_blocks_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Vocabularies and bounds the database enforces rather than trusting the
-- application to remember them. (Prisma does not model CHECK or EXCLUDE.)
-- ---------------------------------------------------------------------------

ALTER TABLE "fleets" ADD CONSTRAINT "fleets_status_check" CHECK (
    "status" IN ('active', 'suspended'));

ALTER TABLE "fleet_staff" ADD CONSTRAINT "fleet_staff_role_check" CHECK (
    "role" IN ('owner', 'manager', 'read_only'));
ALTER TABLE "fleet_staff" ADD CONSTRAINT "fleet_staff_status_check" CHECK (
    "status" IN ('active', 'removed'));

ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_status_check" CHECK (
    "status" IN ('active', 'removed'));
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_capacity_check" CHECK (
    "capacity" BETWEEN 1 AND 20);
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_classes_check" CHECK (
    cardinality("classes") >= 1
    AND "classes" <@ ARRAY['go', 'comfort', 'xl', 'moto']::TEXT[]);
-- One ACTIVE fleet per vehicle.
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_one_active_fleet"
    EXCLUDE USING gist ("vehicle_id" WITH =) WHERE ("status" = 'active');

-- Terms snapshots: the amount / percent must match the terms type, money is a
-- positive integer in minor units, and the shortfall rule is the one contract
-- B settles (carry_forward, bounded weeks).
ALTER TABLE "fleet_assignment_proposals" ADD CONSTRAINT "fleet_assignment_proposals_terms_check" CHECK (
    ("terms_type" = 'weekly_fixed' AND "amount_minor" > 0 AND "percent" IS NULL)
    OR ("terms_type" = 'percent_of_net' AND "amount_minor" IS NULL
        AND "percent" > 0 AND "percent" <= 100));
ALTER TABLE "fleet_assignment_proposals" ADD CONSTRAINT "fleet_assignment_proposals_shortfall_check" CHECK (
    "shortfall_policy" = 'carry_forward' AND "shortfall_max_weeks" BETWEEN 1 AND 52);
ALTER TABLE "fleet_assignment_proposals" ADD CONSTRAINT "fleet_assignment_proposals_parties_check" CHECK (
    "fuel_by" IN ('driver', 'fleet') AND "servicing_by" IN ('driver', 'fleet'));
ALTER TABLE "fleet_assignment_proposals" ADD CONSTRAINT "fleet_assignment_proposals_shift_check" CHECK (
    "shift_kind" IN ('full', 'day', 'night', 'custom')
    AND "shift_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "shift_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "fleet_assignment_proposals" ADD CONSTRAINT "fleet_assignment_proposals_validity_check" CHECK (
    "valid_to" IS NULL OR "valid_to" > "valid_from");
ALTER TABLE "fleet_assignment_proposals" ADD CONSTRAINT "fleet_assignment_proposals_role_check" CHECK (
    "proposed_by_role" IN ('owner', 'manager'));
ALTER TABLE "fleet_assignment_proposals" ADD CONSTRAINT "fleet_assignment_proposals_status_check" CHECK (
    "status" IN ('draft', 'checking', 'sent', 'pending_signature', 'signed',
                 'declined', 'expired', 'withdrawn', 'superseded'));
ALTER TABLE "fleet_assignment_proposals" ADD CONSTRAINT "fleet_assignment_proposals_terms_version_check" CHECK (
    "terms_version" >= 1);

ALTER TABLE "fleet_assignments" ADD CONSTRAINT "fleet_assignments_terms_check" CHECK (
    ("terms_type" = 'weekly_fixed' AND "amount_minor" > 0 AND "percent" IS NULL)
    OR ("terms_type" = 'percent_of_net' AND "amount_minor" IS NULL
        AND "percent" > 0 AND "percent" <= 100));
ALTER TABLE "fleet_assignments" ADD CONSTRAINT "fleet_assignments_shortfall_check" CHECK (
    "shortfall_policy" = 'carry_forward' AND "shortfall_max_weeks" BETWEEN 1 AND 52);
ALTER TABLE "fleet_assignments" ADD CONSTRAINT "fleet_assignments_parties_check" CHECK (
    "fuel_by" IN ('driver', 'fleet') AND "servicing_by" IN ('driver', 'fleet'));
ALTER TABLE "fleet_assignments" ADD CONSTRAINT "fleet_assignments_shift_check" CHECK (
    "shift_kind" IN ('full', 'day', 'night', 'custom')
    AND "shift_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "shift_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "fleet_assignments" ADD CONSTRAINT "fleet_assignments_validity_check" CHECK (
    "valid_to" IS NULL OR "valid_to" >= "valid_from");
ALTER TABLE "fleet_assignments" ADD CONSTRAINT "fleet_assignments_status_check" CHECK (
    "status" IN ('active', 'notice', 'ended', 'superseded'));
ALTER TABLE "fleet_assignments" ADD CONSTRAINT "fleet_assignments_terms_version_check" CHECK (
    "terms_version" >= 1);
-- Signature evidence is mandatory on every signed row.
ALTER TABLE "fleet_assignments" ADD CONSTRAINT "fleet_assignments_signature_check" CHECK (
    length("pin_verification_ref") > 0 AND length("terms_hash") > 0);

ALTER TABLE "fleet_assignment_shift_segments" ADD CONSTRAINT "fleet_assignment_shift_segments_minutes_check" CHECK (
    "minute_from" >= 0 AND "minute_to" <= 1440 AND "minute_from" < "minute_to");
ALTER TABLE "fleet_assignment_shift_segments" ADD CONSTRAINT "fleet_assignment_shift_segments_days_check" CHECK (
    "days_to" IS NULL OR "days_to" >= "days_from");
-- The shift-overlap rule (handoff: "signed assignments on the same vehicle
-- must have non-overlapping shift intervals"), for the vehicle AND for the
-- driver (one driver is never on two vehicles at once). Days are local dates
-- [from, to); minutes are local minutes of the day [from, to).
ALTER TABLE "fleet_assignment_shift_segments" ADD CONSTRAINT "fleet_shift_segments_vehicle_no_overlap"
    EXCLUDE USING gist (
        "vehicle_id" WITH =,
        daterange("days_from", "days_to", '[)') WITH &&,
        int4range("minute_from", "minute_to", '[)') WITH &&
    ) WHERE ("active");
ALTER TABLE "fleet_assignment_shift_segments" ADD CONSTRAINT "fleet_shift_segments_driver_no_overlap"
    EXCLUDE USING gist (
        "driver_id" WITH =,
        daterange("days_from", "days_to", '[)') WITH &&,
        int4range("minute_from", "minute_to", '[)') WITH &&
    ) WHERE ("active");

ALTER TABLE "fleet_maintenance_blocks" ADD CONSTRAINT "fleet_maintenance_blocks_kind_check" CHECK (
    "kind" IN ('planned_service', 'inspection', 'repair', 'unplanned_off_road'));
ALTER TABLE "fleet_maintenance_blocks" ADD CONSTRAINT "fleet_maintenance_blocks_status_check" CHECK (
    "status" IN ('draft', 'checking', 'needs_resolution', 'scheduled', 'active',
                 'completed', 'cancelled'));
-- Only an off-road report may be open-ended; every interval is non-empty.
ALTER TABLE "fleet_maintenance_blocks" ADD CONSTRAINT "fleet_maintenance_blocks_interval_check" CHECK (
    ("ends_at" IS NULL AND "kind" = 'unplanned_off_road')
    OR ("ends_at" IS NOT NULL AND "ends_at" > "starts_at"));
-- Two planned blocks that hold the vehicle never overlap; neither do two
-- off-road reports. (Planned vs off-road is deliberately not refused: a
-- breakdown must always be reportable.)
ALTER TABLE "fleet_maintenance_blocks" ADD CONSTRAINT "fleet_maintenance_planned_no_overlap"
    EXCLUDE USING gist (
        "vehicle_id" WITH =,
        tsrange("starts_at", "ends_at", '[)') WITH &&
    ) WHERE ("kind" <> 'unplanned_off_road' AND "status" IN ('scheduled', 'active'));
ALTER TABLE "fleet_maintenance_blocks" ADD CONSTRAINT "fleet_maintenance_off_road_no_overlap"
    EXCLUDE USING gist (
        "vehicle_id" WITH =,
        tsrange("starts_at", "ends_at", '[)') WITH &&
    ) WHERE ("kind" = 'unplanned_off_road' AND "status" = 'active');

ALTER TABLE "driver_availability" ADD CONSTRAINT "driver_availability_kind_check" CHECK (
    "kind" IN ('available', 'time_off'));
ALTER TABLE "driver_availability" ADD CONSTRAINT "driver_availability_status_check" CHECK (
    "status" IN ('saved', 'saved_with_withdrawals', 'removed'));
ALTER TABLE "driver_availability" ADD CONSTRAINT "driver_availability_interval_check" CHECK (
    "ends_at" > "starts_at");

ALTER TABLE "fleet_conflicts" ADD CONSTRAINT "fleet_conflicts_type_check" CHECK (
    "type" IN ('maintenance_overlaps_booking', 'unplanned_off_road',
               'document_expiring', 'document_expires_in_booking',
               'time_off_overlaps_booking', 'termination_bookings'));
ALTER TABLE "fleet_conflicts" ADD CONSTRAINT "fleet_conflicts_severity_check" CHECK (
    "severity" IN ('critical', 'high', 'medium', 'blocked', 'status'));
ALTER TABLE "fleet_conflicts" ADD CONSTRAINT "fleet_conflicts_status_check" CHECK (
    "status" IN ('open', 'resolving', 'resolved', 'lapsed'));
ALTER TABLE "fleet_conflicts" ADD CONSTRAINT "fleet_conflicts_resolver_roles_check" CHECK (
    "resolver_roles" <@ ARRAY['fleet', 'driver', 'rider', 'ubi']::TEXT[]);

ALTER TABLE "fleet_vehicle_swap_requests" ADD CONSTRAINT "fleet_vehicle_swap_requests_status_check" CHECK (
    "status" IN ('proposed', 'ineligible'));
