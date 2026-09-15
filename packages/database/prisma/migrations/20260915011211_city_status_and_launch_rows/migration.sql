-- AlterTable
ALTER TABLE "cities" ADD COLUMN     "launch_group" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'planned';

-- CreateIndex
CREATE INDEX "cities_status_idx" ON "cities"("status");

-- Backfill: every city that was already live keeps reading as live. `active`
-- stays a derived mirror of `status` from here on (config-service writes both).
UPDATE "cities" SET "status" = 'active' WHERE "active" = true;
