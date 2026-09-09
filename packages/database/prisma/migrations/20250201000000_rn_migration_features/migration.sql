-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "benefit_type" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "state_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state_by" TEXT,
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_versions" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "audience_rule" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "caps" JSONB NOT NULL,
    "qualification_event" TEXT NOT NULL,
    "stacking" JSONB NOT NULL,
    "funding" JSONB NOT NULL,
    "budget_limit_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "experiment" JSONB,
    "copy" TEXT NOT NULL,
    "approval_id" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_budgets" (
    "campaign_version_id" TEXT NOT NULL,
    "reserved_minor" BIGINT NOT NULL DEFAULT 0,
    "consumed_minor" BIGINT NOT NULL DEFAULT 0,
    "reversed_minor" BIGINT NOT NULL DEFAULT 0,
    "exhausted_at" TIMESTAMP(3),

    CONSTRAINT "campaign_budgets_pkey" PRIMARY KEY ("campaign_version_id")
);

-- CreateTable
CREATE TABLE "promotion_reservations" (
    "id" TEXT NOT NULL,
    "campaign_version_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject_kind" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "adjustment_type" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reason_code" TEXT,
    "terms_ref" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_credits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "per_ride_cap_minor" BIGINT,
    "scope" TEXT NOT NULL DEFAULT 'rides',
    "expires_at" DATE NOT NULL,
    "source_reservation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "program_version_id" TEXT NOT NULL,
    "referrer_id" TEXT NOT NULL,
    "referee_id" TEXT,
    "code" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "qualifying_ride_id" TEXT,
    "deadline" DATE,
    "stage_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_review_cases" (
    "id" TEXT NOT NULL,
    "referral_id" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sla_hours" INTEGER NOT NULL DEFAULT 24,
    "decision" TEXT,
    "reason_code" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "referral_review_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribution_claims" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "code" TEXT,
    "campaign" TEXT,
    "token" TEXT,
    "kind" TEXT NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attribution_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_incentive_rules" (
    "id" TEXT NOT NULL,
    "campaign_version_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "base_bps" INTEGER,
    "reduction_bps" INTEGER,
    "applies_to" TEXT NOT NULL DEFAULT 'fare_only',
    "exclusions" TEXT[] DEFAULT ARRAY['tips', 'tolls', 'taxes']::TEXT[],
    "eligible_trip_cap" INTEGER,
    "money_cap_minor" BIGINT,
    "zones" TEXT[],
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "cash_settlement" TEXT NOT NULL DEFAULT 'nets_against_owed',
    "fleet_interaction" TEXT NOT NULL DEFAULT 'after_rebate',
    "rounding" TEXT NOT NULL DEFAULT 'kobo_per_trip',

    CONSTRAINT "driver_incentive_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_incentive_postings" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "ledger_line_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "reason_code" TEXT,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_incentive_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_grants" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_ref" TEXT NOT NULL,
    "provider" TEXT,
    "terms_version" TEXT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "assurance" TEXT NOT NULL,
    "mandate_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "passengers" TEXT NOT NULL,
    "categories" TEXT[],
    "providers" TEXT[],
    "per_run_cap_minor" BIGINT NOT NULL,
    "period_cap_minor" BIGINT NOT NULL,
    "period_runs" INTEGER NOT NULL,
    "max_price_variance_minor" BIGINT,
    "currency" TEXT NOT NULL,
    "constraints" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mandates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandate_allowances" (
    "mandate_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "amount_used_minor" BIGINT NOT NULL DEFAULT 0,
    "runs_used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "mandate_allowances_pkey" PRIMARY KEY ("mandate_id","period_start")
);

-- CreateTable
CREATE TABLE "mandate_executions" (
    "id" TEXT NOT NULL,
    "mandate_id" TEXT NOT NULL,
    "trigger_ref" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason_code" TEXT,
    "grant_id" TEXT,
    "receipt_ref" TEXT,
    "result_ref" TEXT,
    "amount_minor" BIGINT,
    "currency" TEXT,
    "summary" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mandate_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ask_threads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "ask_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ask_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "redacted_text" TEXT NOT NULL,
    "cards" JSONB,
    "sources" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ask_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ask_reviews" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "terms_version" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "adjustments" JSONB,
    "total_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "payment_method_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "grant_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ask_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ask_executions" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ask_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_suppliers" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "travel_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_capabilities_log" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "offer_ref" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_capabilities_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_searches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "supplier_id" TEXT,
    "prices_as_of" TIMESTAMP(3) NOT NULL,
    "offers" JSONB NOT NULL,
    "cache_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_carts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "passengers" JSONB,
    "fees" JSONB,
    "adjustments" JSONB,
    "total_minor" BIGINT,
    "currency" TEXT,
    "previous_total_minor" BIGINT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_trips" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_orders" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT,
    "cart_id" TEXT,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "state_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplier_refs" JSONB NOT NULL DEFAULT '{}',
    "offer_snapshot" JSONB NOT NULL,
    "capabilities" JSONB NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "supplier_price_minor" BIGINT,
    "supplier_currency" TEXT,
    "fx_rate" DECIMAL(18,6),
    "fx_locked_until" TIMESTAMP(3),
    "held_minor" BIGINT NOT NULL DEFAULT 0,
    "charged_minor" BIGINT NOT NULL DEFAULT 0,
    "released_minor" BIGINT NOT NULL DEFAULT 0,
    "pay_at_property_minor" BIGINT NOT NULL DEFAULT 0,
    "policy" JSONB NOT NULL,
    "protection_rule_id" TEXT,
    "grant_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_order_events" (
    "id" BIGSERIAL NOT NULL,
    "order_id" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "detail" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_documents" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "passenger_index" INTEGER,
    "issued_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_refunds" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "penalty_minor" BIGINT NOT NULL DEFAULT 0,
    "stage" TEXT NOT NULL,
    "expected_by" DATE,
    "supplier_ref" TEXT,
    "ledger_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_disruptions" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "covered" BOOLEAN NOT NULL,
    "rule_id" TEXT,
    "funded_by" TEXT,
    "cap_minor" BIGINT,
    "alternatives" JSONB NOT NULL,
    "airline_options" JSONB NOT NULL,
    "resolution" TEXT,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "travel_disruptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_webhooks" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "signature_ok" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "travel_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_settlements" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "charged_minor" BIGINT NOT NULL,
    "invoiced_minor" BIGINT NOT NULL,
    "difference_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "resolution" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_commercial_rates" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "route_or_property" TEXT NOT NULL,
    "fee_schedule" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "terms_ref" TEXT,

    CONSTRAINT "travel_commercial_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_reservation_links" (
    "reservation_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "retimed_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ride_reservation_links_pkey" PRIMARY KEY ("reservation_id")
);

-- CreateTable
CREATE TABLE "ai_actions" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_kind" TEXT NOT NULL,
    "actor_ref" TEXT NOT NULL,
    "thread_id" TEXT,
    "action" TEXT NOT NULL,
    "tool" TEXT,
    "model" TEXT,
    "model_revision" TEXT,
    "prompt_version" TEXT,
    "redacted_inputs" JSONB,
    "auth_kind" TEXT NOT NULL,
    "auth_ref" TEXT,
    "provider_refs" TEXT[],
    "outcome" TEXT NOT NULL,
    "reason_code" TEXT,
    "tokens" INTEGER,
    "cost_minor" BIGINT,
    "currency" TEXT,
    "latency_ms" INTEGER,
    "retention_until" DATE NOT NULL DEFAULT (CURRENT_DATE + 90),

    CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_metrics_daily" (
    "day" DATE NOT NULL,
    "model" TEXT NOT NULL,
    "model_revision" TEXT NOT NULL,
    "tasks" INTEGER NOT NULL,
    "success" INTEGER NOT NULL,
    "unsafe_actions" INTEGER NOT NULL,
    "p95_latency_ms" INTEGER,
    "cost_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,

    CONSTRAINT "ai_model_metrics_daily_pkey" PRIMARY KEY ("day","model","model_revision")
);

-- CreateTable
CREATE TABLE "ai_action_access_log" (
    "id" BIGSERIAL NOT NULL,
    "admin_id" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_action_access_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_versions_campaign_id_version_key" ON "campaign_versions"("campaign_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_reservations_idempotency_key_key" ON "promotion_reservations"("idempotency_key");

-- CreateIndex
CREATE INDEX "promotion_reservations_user_id_campaign_version_id_state_idx" ON "promotion_reservations"("user_id", "campaign_version_id", "state");

-- CreateIndex
CREATE INDEX "referrals_referrer_id_stage_idx" ON "referrals"("referrer_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "attribution_claims_user_id_key" ON "attribution_claims"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "driver_incentive_postings_trip_id_kind_key" ON "driver_incentive_postings"("trip_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "action_grants_idempotency_key_key" ON "action_grants"("idempotency_key");

-- CreateIndex
CREATE INDEX "action_grants_actor_id_expires_at_idx" ON "action_grants"("actor_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "mandate_executions_receipt_ref_key" ON "mandate_executions"("receipt_ref");

-- CreateIndex
CREATE UNIQUE INDEX "mandate_executions_mandate_id_trigger_ref_key" ON "mandate_executions"("mandate_id", "trigger_ref");

-- CreateIndex
CREATE UNIQUE INDEX "travel_carts_idempotency_key_key" ON "travel_carts"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "travel_orders_idempotency_key_key" ON "travel_orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "travel_orders_user_id_state_idx" ON "travel_orders"("user_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "travel_webhooks_supplier_id_external_id_key" ON "travel_webhooks"("supplier_id", "external_id");

-- CreateIndex
CREATE INDEX "ai_actions_at_idx" ON "ai_actions"("at" DESC);

-- CreateIndex
CREATE INDEX "ai_actions_actor_ref_at_idx" ON "ai_actions"("actor_ref", "at" DESC);

-- AddForeignKey
ALTER TABLE "campaign_versions" ADD CONSTRAINT "campaign_versions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_budgets" ADD CONSTRAINT "campaign_budgets_campaign_version_id_fkey" FOREIGN KEY ("campaign_version_id") REFERENCES "campaign_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_reservations" ADD CONSTRAINT "promotion_reservations_campaign_version_id_fkey" FOREIGN KEY ("campaign_version_id") REFERENCES "campaign_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_credits" ADD CONSTRAINT "user_credits_source_reservation_id_fkey" FOREIGN KEY ("source_reservation_id") REFERENCES "promotion_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_program_version_id_fkey" FOREIGN KEY ("program_version_id") REFERENCES "campaign_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_review_cases" ADD CONSTRAINT "referral_review_cases_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_incentive_rules" ADD CONSTRAINT "driver_incentive_rules_campaign_version_id_fkey" FOREIGN KEY ("campaign_version_id") REFERENCES "campaign_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_incentive_postings" ADD CONSTRAINT "driver_incentive_postings_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "driver_incentive_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate_allowances" ADD CONSTRAINT "mandate_allowances_mandate_id_fkey" FOREIGN KEY ("mandate_id") REFERENCES "mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate_executions" ADD CONSTRAINT "mandate_executions_mandate_id_fkey" FOREIGN KEY ("mandate_id") REFERENCES "mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate_executions" ADD CONSTRAINT "mandate_executions_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "action_grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "ask_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ask_reviews" ADD CONSTRAINT "ask_reviews_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "ask_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ask_reviews" ADD CONSTRAINT "ask_reviews_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "action_grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ask_executions" ADD CONSTRAINT "ask_executions_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "ask_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_capabilities_log" ADD CONSTRAINT "travel_capabilities_log_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "travel_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_searches" ADD CONSTRAINT "travel_searches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "travel_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_orders" ADD CONSTRAINT "travel_orders_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "travel_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_orders" ADD CONSTRAINT "travel_orders_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "travel_carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_orders" ADD CONSTRAINT "travel_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "travel_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_order_events" ADD CONSTRAINT "travel_order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "travel_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_documents" ADD CONSTRAINT "travel_documents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "travel_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_refunds" ADD CONSTRAINT "travel_refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "travel_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_disruptions" ADD CONSTRAINT "travel_disruptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "travel_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_webhooks" ADD CONSTRAINT "travel_webhooks_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "travel_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_settlements" ADD CONSTRAINT "travel_settlements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "travel_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_commercial_rates" ADD CONSTRAINT "travel_commercial_rates_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "travel_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_reservation_links" ADD CONSTRAINT "ride_reservation_links_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "travel_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

