-- DEC-8 (CC-B00): User home city chosen from launched cities at sign-up (or next sign-in for existing accounts).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "home_city_id" VARCHAR(16);
CREATE INDEX IF NOT EXISTS "users_home_city_id_idx" ON "users"("home_city_id");
