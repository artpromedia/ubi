-- Grant → mandate binding, atomic period allowance, marketplace execution intent
-- (recheck A03 / P02, CLAUDE.md #18).
--
-- 1. `action_grants.mandate_id` already exists; it is now the persisted,
--    server-side ORIGIN of every `assurance = 'mandate'` grant. Indexed so the
--    grants a mandate authorised can be found when it is paused or revoked.
--
-- 2. `mandate_allowance_reservations` + the two SQL functions below are THE
--    canonical period-allowance mechanism. It is the guarded UPDATE that used to
--    live in user-service `mandates/run.ts reserveAllowance`, lifted into the
--    database unchanged in its semantics so that every caller runs it inside
--    its OWN transaction: user-service's mandate runs and ask-service's
--    marketplace selections both call `mandate_allowance_reserve` and
--    `mandate_allowance_settle` — there is no second implementation anywhere.
--
--      reserve  budget + one run, re-checking status / expiry / currency /
--               per-run cap on the mandate row (read FOR SHARE) and the period
--               cap / run count on the allowance row (one guarded UPDATE).
--               A pause, revoke or edit is an UPDATE of the mandate row, so it
--               either committed before the reservation (and is seen) or waits
--               for the reserving transaction: that is the exact commit
--               boundary for "revalidated immediately before the effect".
--      settle   exactly once: `commit` records the actual spend (returning any
--               unspent part of the reservation), `release` returns the budget
--               and the run. Both are guarded by `status = 'pending'`, so a
--               replayed settlement is a no-op, never a double adjustment.
--
--    Usage counters in `mandate_allowances` include pending reservations, so
--    concurrent in-flight executions can never overspend the period cap or
--    exceed the run count, and an ambiguous outcome stays counted (pending,
--    reconcilable) until it is known.
--
-- 3. `ask_mp_executions` persists the intent of one assistant marketplace
--    selection BEFORE the external award call, keyed to the grant and bound to
--    (grant, request, bid, versions) by its idempotency key.

-- CreateTable
CREATE TABLE "mandate_allowance_reservations" (
    "id" TEXT NOT NULL,
    "mandate_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "grant_id" TEXT,
    "reserved_minor" BIGINT NOT NULL,
    "committed_minor" BIGINT,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason_code" TEXT,
    "result_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "mandate_allowance_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mandate_allowance_reservations_status_check"
      CHECK ("status" IN ('pending', 'committed', 'released')),
    CONSTRAINT "mandate_allowance_reservations_amounts_check"
      CHECK ("reserved_minor" >= 0 AND ("committed_minor" IS NULL OR "committed_minor" >= 0)),
    -- Only a committed reservation carries an actual spend.
    CONSTRAINT "mandate_allowance_reservations_committed_check"
      CHECK (("status" = 'committed') = ("committed_minor" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "ask_mp_executions" (
    "id" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "mandate_id" TEXT,
    "reservation_id" TEXT,
    "request_id" TEXT NOT NULL,
    "bid_id" TEXT NOT NULL,
    "request_version" INTEGER NOT NULL,
    "bid_version" INTEGER NOT NULL,
    "request_revision" INTEGER NOT NULL,
    "fare_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "award_id" TEXT,
    "reason_code" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lease_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "ask_mp_executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ask_mp_executions_status_check"
      CHECK ("status" IN ('pending', 'awarded', 'failed')),
    CONSTRAINT "ask_mp_executions_fare_check" CHECK ("fare_minor" > 0),
    CONSTRAINT "ask_mp_executions_attempts_check" CHECK ("attempts" >= 1),
    CONSTRAINT "ask_mp_executions_award_check"
      CHECK ("status" <> 'awarded' OR "award_id" IS NOT NULL),
    -- A mandate-backed execution always holds its allowance reservation.
    CONSTRAINT "ask_mp_executions_mandate_reservation_check"
      CHECK ("mandate_id" IS NULL OR "reservation_id" IS NOT NULL)
);

-- A usage counter can never go negative (a settlement that did would be a bug).
ALTER TABLE "mandate_allowances"
  ADD CONSTRAINT "mandate_allowances_usage_check"
  CHECK ("amount_used_minor" >= 0 AND "runs_used" >= 0);

-- CreateIndex
CREATE UNIQUE INDEX "mandate_allowance_reservations_idempotency_key_key" ON "mandate_allowance_reservations"("idempotency_key");

-- CreateIndex
CREATE INDEX "mandate_allowance_reservations_mandate_id_period_start_stat_idx" ON "mandate_allowance_reservations"("mandate_id", "period_start", "status");

-- CreateIndex
CREATE INDEX "mandate_allowance_reservations_grant_id_idx" ON "mandate_allowance_reservations"("grant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ask_mp_executions_grant_id_key" ON "ask_mp_executions"("grant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ask_mp_executions_reservation_id_key" ON "ask_mp_executions"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "ask_mp_executions_idempotency_key_key" ON "ask_mp_executions"("idempotency_key");

-- CreateIndex
CREATE INDEX "ask_mp_executions_status_lease_until_idx" ON "ask_mp_executions"("status", "lease_until");

-- CreateIndex
CREATE INDEX "ask_mp_executions_mandate_id_idx" ON "ask_mp_executions"("mandate_id");

-- CreateIndex
CREATE INDEX "action_grants_mandate_id_idx" ON "action_grants"("mandate_id");

-- AddForeignKey
ALTER TABLE "mandate_allowance_reservations" ADD CONSTRAINT "mandate_allowance_reservations_mandate_id_fkey" FOREIGN KEY ("mandate_id") REFERENCES "mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ask_mp_executions" ADD CONSTRAINT "ask_mp_executions_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "action_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ask_mp_executions" ADD CONSTRAINT "ask_mp_executions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "mandate_allowance_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- mandate_allowance_reserve — reserve budget + one run, atomically.
--
-- Returns one row (r_outcome, r_reservation_id):
--   reserved            a new pending reservation (r_reservation_id = p_reservation_id)
--   replayed            p_idempotency_key already reserved; its id is returned
--   mandate_not_found | mandate_paused | mandate_revoked | mandate_expired
--   currency_mismatch | price_above_cap | allowance_exhausted
-- No budget or run is consumed unless the outcome is `reserved` (a refusal may
-- leave the period's zero-usage allowance row behind, exactly as before).
-- `p_now` is UTC, the same clock the timestamp(3) columns are written in.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mandate_allowance_reserve(
  p_reservation_id  TEXT,
  p_idempotency_key TEXT,
  p_mandate_id      TEXT,
  p_period_start    DATE,
  p_amount_minor    BIGINT,
  p_currency        TEXT,
  p_grant_id        TEXT,
  p_now             TIMESTAMP(3)
) RETURNS TABLE (r_outcome TEXT, r_reservation_id TEXT) AS $$
DECLARE
  prior RECORD;
  m RECORD;
BEGIN
  IF p_amount_minor IS NULL OR p_amount_minor < 0 THEN
    RAISE EXCEPTION 'a mandate reservation amount must be a non-negative integer'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT res.id, res.mandate_id INTO prior
    FROM mandate_allowance_reservations res
   WHERE res.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF prior.mandate_id <> p_mandate_id THEN
      RAISE EXCEPTION 'reservation key % belongs to another mandate', p_idempotency_key
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN QUERY SELECT 'replayed'::TEXT, prior.id;
    RETURN;
  END IF;

  -- FOR SHARE: a concurrent pause / revoke / edit (an UPDATE of this row) is
  -- either already committed and seen here, or waits until we commit.
  SELECT md.status, md.expires_at, md.currency, md.per_run_cap_minor,
         md.period_cap_minor, md.period_runs
    INTO m
    FROM mandates md
   WHERE md.id = p_mandate_id
     FOR SHARE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'mandate_not_found'::TEXT, NULL::TEXT;
    RETURN;
  END IF;
  IF m.status <> 'active' THEN
    RETURN QUERY SELECT ('mandate_' || m.status)::TEXT, NULL::TEXT;
    RETURN;
  END IF;
  IF m.expires_at <= p_now THEN
    RETURN QUERY SELECT 'mandate_expired'::TEXT, NULL::TEXT;
    RETURN;
  END IF;
  IF m.currency <> p_currency THEN
    RETURN QUERY SELECT 'currency_mismatch'::TEXT, NULL::TEXT;
    RETURN;
  END IF;
  IF p_amount_minor > m.per_run_cap_minor THEN
    RETURN QUERY SELECT 'price_above_cap'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  INSERT INTO mandate_allowances (mandate_id, period_start, amount_used_minor, runs_used)
  VALUES (p_mandate_id, p_period_start, 0, 0)
  ON CONFLICT (mandate_id, period_start) DO NOTHING;

  -- The guarded UPDATE: increments AND re-checks under the allowance row lock,
  -- so it succeeds only if the reservation still fits after any concurrent one.
  UPDATE mandate_allowances al
     SET amount_used_minor = al.amount_used_minor + p_amount_minor,
         runs_used = al.runs_used + 1
   WHERE al.mandate_id = p_mandate_id
     AND al.period_start = p_period_start
     AND al.runs_used + 1 <= m.period_runs
     AND al.amount_used_minor + p_amount_minor <= m.period_cap_minor;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'allowance_exhausted'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  INSERT INTO mandate_allowance_reservations
    (id, mandate_id, period_start, idempotency_key, grant_id, reserved_minor,
     currency, status, created_at)
  VALUES
    (p_reservation_id, p_mandate_id, p_period_start, p_idempotency_key,
     p_grant_id, p_amount_minor, p_currency, 'pending', p_now);

  RETURN QUERY SELECT 'reserved'::TEXT, p_reservation_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- mandate_allowance_settle — resolve a pending reservation, exactly once.
--
--   p_action = 'commit'   actual spend p_actual_minor; the unspent part of the
--                         reservation is returned to the period's budget. The
--                         run stays used.
--   p_action = 'release'  the whole reservation (budget + run) is returned.
--
-- Returns committed | released on the settling call; already_committed |
-- already_released when the reservation was settled before (no adjustment);
-- not_found for an unknown id. `p_grant_id` back-fills a reservation made
-- before its grant existed (a mandate run).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mandate_allowance_settle(
  p_reservation_id TEXT,
  p_action         TEXT,
  p_actual_minor   BIGINT,
  p_result_ref     TEXT,
  p_grant_id       TEXT,
  p_reason_code    TEXT,
  p_now            TIMESTAMP(3)
) RETURNS TEXT AS $$
DECLARE
  settled RECORD;
  current_status TEXT;
BEGIN
  IF p_action NOT IN ('commit', 'release') THEN
    RAISE EXCEPTION 'unknown settlement action %', p_action
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_action = 'commit' AND (p_actual_minor IS NULL OR p_actual_minor < 0) THEN
    RAISE EXCEPTION 'a committed spend must be a non-negative integer'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE mandate_allowance_reservations res
     SET status = CASE WHEN p_action = 'commit' THEN 'committed' ELSE 'released' END,
         committed_minor = CASE WHEN p_action = 'commit' THEN p_actual_minor ELSE NULL END,
         result_ref = COALESCE(p_result_ref, res.result_ref),
         grant_id = COALESCE(res.grant_id, p_grant_id),
         reason_code = p_reason_code,
         resolved_at = p_now
   WHERE res.id = p_reservation_id
     AND res.status = 'pending'
  RETURNING res.mandate_id, res.period_start, res.reserved_minor INTO settled;

  IF NOT FOUND THEN
    SELECT res.status INTO current_status
      FROM mandate_allowance_reservations res
     WHERE res.id = p_reservation_id;
    IF NOT FOUND THEN
      RETURN 'not_found';
    END IF;
    RETURN 'already_' || current_status;
  END IF;

  IF p_action = 'commit' THEN
    UPDATE mandate_allowances al
       SET amount_used_minor = al.amount_used_minor - settled.reserved_minor + p_actual_minor
     WHERE al.mandate_id = settled.mandate_id
       AND al.period_start = settled.period_start;
    RETURN 'committed';
  END IF;

  UPDATE mandate_allowances al
     SET amount_used_minor = al.amount_used_minor - settled.reserved_minor,
         runs_used = al.runs_used - 1
   WHERE al.mandate_id = settled.mandate_id
     AND al.period_start = settled.period_start;
  RETURN 'released';
END;
$$ LANGUAGE plpgsql;
