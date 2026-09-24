-- Business travel foundation (A06 part C) on the canonical ledger.
--
-- Contract: packages/contracts/src/business-travel.ts.
--
-- user-service owns the ORGANIZATION side (src/organizations):
--  - organizations: name, governing city, billing profile and the travel
--    policy — per-trip cap and allowed services / vehicle classes. The policy
--    is deny-by-default: a new organization has a zero cap and empty allow
--    lists, so nothing is bookable until an admin sets it;
--  - organization_members: owner | admin | booker | traveller, one row per
--    (organization, user) ever — removal keeps the row;
--  - organization_invitations: bound to ONE existing user, who alone can
--    accept or decline, so nobody joins (and becomes visible to the
--    organization's business-trip view) without consenting;
--  - organization_cost_centres: archived, never deleted.
--
-- payment-service owns the MONEY side (src/business), and only READS the rows
-- above to authorize a reservation inside the transaction that takes it:
--  - the organization's funding wallet (wallets.owner_type = 'organization')
--    is topped up through the wallet top-up rail — there is no credit line,
--    no negative balance and no "bill me later" anywhere in this schema;
--  - org_budget_accounts: one per cost centre per city-local month, each
--    with its OWN ledger wallet (owner_type = 'org_budget'). An allocation is
--    a journal entry (organization wallet -> budget wallet), so a budget's
--    balance is derived from journal lines like every other balance;
--  - org_budget_reservations: one per booking reference, ever. A reservation
--    is a table row, never a journal movement; available = budget balance -
--    SUM(reserved). Reservations serialize on a row lock of the budget
--    account, so concurrent bookings can never overspend it. Commit posts ONE
--    entry (budget wallet -> business_clearing) for the actual amount, never
--    more than reserved; release frees it without moving money;
--  - org_budget_ops: the idempotency record for every accepted POST, and at
--    most one reserve / commit / release per reservation (unique index).
--
-- The quarantined B2B models (schema-b2b.prisma: float budgets, in-memory
-- check-then-act) are NOT these tables and remain unmigrated.

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "legal_name" TEXT,
    "tax_id" TEXT,
    "trip_cap_minor" BIGINT NOT NULL DEFAULT 0,
    "allowed_services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_classes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "policy_version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cost_centre_id" TEXT,
    "added_by" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_invitations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invitee_user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "cost_centre_id" TEXT,
    "status" TEXT NOT NULL,
    "invited_by" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_cost_centres" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_cost_centres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_budget_accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "cost_centre_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_budget_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_budget_reservations" (
    "id" TEXT NOT NULL,
    "booking_ref" TEXT NOT NULL,
    "budget_account_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "cost_centre_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "booker_id" TEXT NOT NULL,
    "traveller_id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "vehicle_class" TEXT NOT NULL,
    "expense_category" TEXT,
    "city_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "reserved_minor" BIGINT NOT NULL,
    "committed_minor" BIGINT,
    "state" TEXT NOT NULL,
    "terms_hash" TEXT NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "commit_entry_id" TEXT,
    "tax_lines" JSONB,
    "release_reason" TEXT,
    "released_by_role" TEXT,
    "released_by_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "committed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),

    CONSTRAINT "org_budget_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_budget_ops" (
    "id" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "budget_account_id" TEXT,
    "reservation_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "client_key" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "entry_id" TEXT,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_budget_ops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organizations_city_id_idx" ON "organizations"("city_id");

-- CreateIndex
CREATE INDEX "organization_members_user_id_status_idx" ON "organization_members"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitations_idempotency_key_key" ON "organization_invitations"("idempotency_key");

-- CreateIndex
CREATE INDEX "organization_invitations_invitee_user_id_status_idx" ON "organization_invitations"("invitee_user_id", "status");

-- CreateIndex
CREATE INDEX "organization_invitations_organization_id_status_idx" ON "organization_invitations"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_cost_centres_organization_id_code_key" ON "organization_cost_centres"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "org_budget_accounts_wallet_id_key" ON "org_budget_accounts"("wallet_id");

-- CreateIndex
CREATE INDEX "org_budget_accounts_organization_id_period_idx" ON "org_budget_accounts"("organization_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "org_budget_accounts_cost_centre_id_period_key" ON "org_budget_accounts"("cost_centre_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "org_budget_reservations_booking_ref_key" ON "org_budget_reservations"("booking_ref");

-- CreateIndex
CREATE UNIQUE INDEX "org_budget_reservations_commit_entry_id_key" ON "org_budget_reservations"("commit_entry_id");

-- CreateIndex
CREATE INDEX "org_budget_reservations_available" ON "org_budget_reservations"("wallet_id", "state");

-- CreateIndex
CREATE INDEX "org_budget_reservations_organization_id_created_at_idx" ON "org_budget_reservations"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "org_budget_reservations_traveller_id_created_at_idx" ON "org_budget_reservations"("traveller_id", "created_at");

-- CreateIndex
CREATE INDEX "org_budget_reservations_booker_id_created_at_idx" ON "org_budget_reservations"("booker_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "org_budget_ops_idempotency_key_key" ON "org_budget_ops"("idempotency_key");

-- CreateIndex
CREATE INDEX "org_budget_ops_organization_id_created_at_idx" ON "org_budget_ops"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "org_budget_ops_reservation_id_op_key" ON "org_budget_ops"("reservation_id", "op");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "organization_cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "organization_cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_cost_centres" ADD CONSTRAINT "organization_cost_centres_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_budget_accounts" ADD CONSTRAINT "org_budget_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_budget_accounts" ADD CONSTRAINT "org_budget_accounts_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "organization_cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_budget_accounts" ADD CONSTRAINT "org_budget_accounts_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_budget_reservations" ADD CONSTRAINT "org_budget_reservations_budget_account_id_fkey" FOREIGN KEY ("budget_account_id") REFERENCES "org_budget_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_budget_reservations" ADD CONSTRAINT "org_budget_reservations_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_budget_reservations" ADD CONSTRAINT "org_budget_reservations_commit_entry_id_fkey" FOREIGN KEY ("commit_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_budget_ops" ADD CONSTRAINT "org_budget_ops_budget_account_id_fkey" FOREIGN KEY ("budget_account_id") REFERENCES "org_budget_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_budget_ops" ADD CONSTRAINT "org_budget_ops_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "org_budget_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_budget_ops" ADD CONSTRAINT "org_budget_ops_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Closed value sets and money bounds, enforced by the database rather than by
-- application code remembering to check. (Prisma does not model CHECK
-- constraints, so these carry no schema drift.)
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_status_check" CHECK (
    "status" IN ('active', 'suspended')
);

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_trip_cap_check" CHECK (
    "trip_cap_minor" >= 0
);

ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_role_check" CHECK (
    "role" IN ('owner', 'admin', 'booker', 'traveller')
);

ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_status_check" CHECK (
    "status" IN ('active', 'removed')
    AND (("status" = 'removed') = ("removed_at" IS NOT NULL))
);

ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_role_check" CHECK (
    "role" IN ('owner', 'admin', 'booker', 'traveller')
);

ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_status_check" CHECK (
    "status" IN ('pending', 'accepted', 'declined', 'revoked', 'expired')
);

ALTER TABLE "organization_cost_centres" ADD CONSTRAINT "organization_cost_centres_status_check" CHECK (
    "status" IN ('active', 'archived')
);

ALTER TABLE "org_budget_accounts" ADD CONSTRAINT "org_budget_accounts_period_check" CHECK (
    "period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
);

-- A reservation is positive; a commit is positive and never exceeds what was
-- reserved; `committed` always names its amount and its one journal entry,
-- and nothing else does.
ALTER TABLE "org_budget_reservations" ADD CONSTRAINT "org_budget_reservations_amounts_check" CHECK (
    "reserved_minor" > 0
    AND ("committed_minor" IS NULL OR ("committed_minor" > 0 AND "committed_minor" <= "reserved_minor"))
);

ALTER TABLE "org_budget_reservations" ADD CONSTRAINT "org_budget_reservations_state_check" CHECK (
    "state" IN ('reserved', 'committed', 'released')
    AND (("state" = 'committed') = ("committed_minor" IS NOT NULL))
    AND (("state" = 'committed') = ("commit_entry_id" IS NOT NULL))
);

ALTER TABLE "org_budget_ops" ADD CONSTRAINT "org_budget_ops_op_check" CHECK (
    "op" IN ('topup', 'allocate', 'return', 'reserve', 'commit', 'release')
    AND "amount_minor" > 0
);
