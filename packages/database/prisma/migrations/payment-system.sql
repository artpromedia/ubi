-- Migration: Add Comprehensive Payment System
-- Description: Double-entry ledger, wallet accounts, payment methods, fraud detection, reconciliation
-- Date: 2026-01-04

-- Add new enums
CREATE TYPE "AccountType" AS ENUM ('USER_WALLET', 'DRIVER_WALLET', 'RESTAURANT_WALLET', 'UBI_COMMISSION', 'UBI_FLOAT', 'CEERION_ESCROW', 'PROMOTIONAL', 'REFUND_RESERVE');
CREATE TYPE "EntryType" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "TransactionType" AS ENUM ('WALLET_TOPUP', 'WALLET_WITHDRAWAL', 'RIDE_PAYMENT', 'RIDE_REFUND', 'FOOD_PAYMENT', 'FOOD_REFUND', 'DELIVERY_PAYMENT', 'DRIVER_EARNING', 'COMMISSION_DEDUCTION', 'CEERION_DEDUCTION', 'INCENTIVE_BONUS', 'PROMOTIONAL_CREDIT', 'TIP', 'SETTLEMENT_PAYOUT', 'INTERNAL_TRANSFER');
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED', 'CANCELLED');
CREATE TYPE "PaymentMethodType" AS ENUM ('CARD', 'MOBILE_MONEY', 'BANK_ACCOUNT');
CREATE TYPE "PaymentProvider" AS ENUM ('PAYSTACK', 'FLUTTERWAVE', 'MPESA', 'MTN_MOMO', 'AIRTEL_MONEY', 'TELEBIRR', 'ORANGE_MONEY');
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "RiskAction" AS ENUM ('ALLOW', 'REVIEW', 'REQUIRE_3DS', 'BLOCK');

-- Wallet Accounts (Double-Entry Ledger)
CREATE TABLE "wallet_accounts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
  "account_type" "AccountType" NOT NULL,
  "currency" "Currency" NOT NULL,
  "balance" DECIMAL(19, 4) NOT NULL DEFAULT 0 CHECK ("balance" >= 0),
  "available_balance" DECIMAL(19, 4) NOT NULL DEFAULT 0 CHECK ("available_balance" >= 0),
  "held_balance" DECIMAL(19, 4) NOT NULL DEFAULT 0 CHECK ("held_balance" >= 0),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "wallet_accounts_user_account_currency_unique" UNIQUE ("user_id", "account_type", "currency"),
  CONSTRAINT "balance_integrity" CHECK ("balance" = "available_balance" + "held_balance")
);

CREATE INDEX "idx_wallet_accounts_user" ON "wallet_accounts"("user_id");
CREATE INDEX "idx_wallet_accounts_type" ON "wallet_accounts"("account_type");
CREATE INDEX "idx_wallet_accounts_currency" ON "wallet_accounts"("currency");

-- Ledger Entries (Immutable)
CREATE TABLE "ledger_entries" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "transaction_id" UUID NOT NULL,
  "account_id" UUID NOT NULL REFERENCES "wallet_accounts"("id"),
  "entry_type" "EntryType" NOT NULL,
  "amount" DECIMAL(19, 4) NOT NULL CHECK ("amount" > 0),
  "balance_after" DECIMAL(19, 4) NOT NULL,
  "description" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX "idx_ledger_entries_transaction" ON "ledger_entries"("transaction_id");
CREATE INDEX "idx_ledger_entries_account_date" ON "ledger_entries"("account_id", "created_at" DESC);
CREATE INDEX "idx_ledger_entries_created" ON "ledger_entries"("created_at");

-- Transactions
CREATE TABLE "transactions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "idempotency_key" VARCHAR(255) UNIQUE NOT NULL,
  "transaction_type" "TransactionType" NOT NULL,
  "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(19, 4) NOT NULL CHECK ("amount" > 0),
  "currency" "Currency" NOT NULL,
  "fee" DECIMAL(19, 4) NOT NULL DEFAULT 0,
  "description" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "completed_at" TIMESTAMP
);

CREATE INDEX "idx_transactions_status_created" ON "transactions"("status", "created_at");
CREATE INDEX "idx_transactions_type" ON "transactions"("transaction_type");
CREATE INDEX "idx_transactions_idempotency" ON "transactions"("idempotency_key");
CREATE INDEX "idx_transactions_created" ON "transactions"("created_at");

-- Add foreign key after transactions table exists
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_fkey" 
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id");

-- Payment Methods (Tokenized)
CREATE TABLE "payment_methods" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" "PaymentMethodType" NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "token" VARCHAR(500) NOT NULL,
  "last_four" VARCHAR(4),
  "brand" VARCHAR(50),
  "phone_number" VARCHAR(20),
  "bank_code" VARCHAR(20),
  "account_number" VARCHAR(50),
  "account_name" VARCHAR(255),
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_verified" BOOLEAN NOT NULL DEFAULT false,
  "expires_at" TIMESTAMP,
  "metadata" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX "idx_payment_methods_user" ON "payment_methods"("user_id");
CREATE INDEX "idx_payment_methods_user_default" ON "payment_methods"("user_id", "is_default") WHERE "is_default" = true;
CREATE INDEX "idx_payment_methods_type_provider" ON "payment_methods"("type", "provider");

-- Payment Transactions
CREATE TABLE "payment_transactions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id"),
  "payment_method_id" UUID REFERENCES "payment_methods"("id"),
  "transaction_id" UUID UNIQUE REFERENCES "transactions"("id"),
  "provider" "PaymentProvider" NOT NULL,
  "provider_reference" VARCHAR(255) UNIQUE,
  "amount" DECIMAL(19, 4) NOT NULL,
  "currency" "Currency" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "initiated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "confirmed_at" TIMESTAMP,
  "failed_at" TIMESTAMP,
  "failure_reason" TEXT,
  "provider_response" JSONB,
  "webhook_received" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX "idx_payment_transactions_user_status" ON "payment_transactions"("user_id", "status");
CREATE INDEX "idx_payment_transactions_status_created" ON "payment_transactions"("status", "created_at");
CREATE INDEX "idx_payment_transactions_provider_ref" ON "payment_transactions"("provider", "provider_reference");
CREATE INDEX "idx_payment_transactions_created" ON "payment_transactions"("created_at");

-- Balance Holds
CREATE TABLE "balance_holds" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL REFERENCES "wallet_accounts"("id"),
  "amount" DECIMAL(19, 4) NOT NULL CHECK ("amount" > 0),
  "currency" "Currency" NOT NULL,
  "reason" VARCHAR(255) NOT NULL,
  "reference" VARCHAR(255),
  "is_released" BOOLEAN NOT NULL DEFAULT false,
  "released_at" TIMESTAMP,
  "expires_at" TIMESTAMP NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX "idx_balance_holds_account_released" ON "balance_holds"("account_id", "is_released");
CREATE INDEX "idx_balance_holds_expires" ON "balance_holds"("expires_at");

-- Payouts
CREATE TABLE "payouts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "driver_id" UUID NOT NULL REFERENCES "drivers"("id"),
  "transaction_id" UUID UNIQUE REFERENCES "transactions"("id"),
  "amount" DECIMAL(19, 4) NOT NULL,
  "fee" DECIMAL(19, 4) NOT NULL DEFAULT 0,
  "net_amount" DECIMAL(19, 4) NOT NULL,
  "currency" "Currency" NOT NULL,
  "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
  "provider" "PaymentProvider" NOT NULL,
  "provider_reference" VARCHAR(255),
  "payout_method" VARCHAR(50) NOT NULL,
  "account_number" VARCHAR(100) NOT NULL,
  "account_name" VARCHAR(255),
  "initiated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "completed_at" TIMESTAMP,
  "failed_at" TIMESTAMP,
  "failure_reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX "idx_payouts_driver_status" ON "payouts"("driver_id", "status");
CREATE INDEX "idx_payouts_status_created" ON "payouts"("status", "created_at");
CREATE INDEX "idx_payouts_provider_ref" ON "payouts"("provider", "provider_reference");

-- Risk Assessments
CREATE TABLE "risk_assessments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_transaction_id" UUID UNIQUE NOT NULL REFERENCES "payment_transactions"("id"),
  "user_id" UUID NOT NULL REFERENCES "users"("id"),
  "score" INTEGER NOT NULL CHECK ("score" >= 0 AND "score" <= 100),
  "level" "RiskLevel" NOT NULL,
  "action" "RiskAction" NOT NULL,
  "device_fingerprint" VARCHAR(255),
  "ip_address" VARCHAR(45),
  "ip_location" JSONB,
  "reviewed_at" TIMESTAMP,
  "reviewed_by" UUID REFERENCES "users"("id"),
  "review_notes" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX "idx_risk_assessments_user_level" ON "risk_assessments"("user_id", "level");
CREATE INDEX "idx_risk_assessments_level_action" ON "risk_assessments"("level", "action");
CREATE INDEX "idx_risk_assessments_created" ON "risk_assessments"("created_at");

-- Risk Factors
CREATE TABLE "risk_factors" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "risk_assessment_id" UUID NOT NULL REFERENCES "risk_assessments"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "score" INTEGER NOT NULL,
  "details" TEXT,
  "metadata" JSONB
);

CREATE INDEX "idx_risk_factors_assessment" ON "risk_factors"("risk_assessment_id");

-- Reconciliation Reports
CREATE TABLE "reconciliation_reports" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "date" DATE NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "currency" "Currency" NOT NULL,
  "total_internal" INTEGER NOT NULL,
  "total_provider" INTEGER NOT NULL,
  "matched" INTEGER NOT NULL,
  "unmatched_internal" INTEGER NOT NULL,
  "unmatched_provider" INTEGER NOT NULL,
  "discrepancies" INTEGER NOT NULL,
  "internal_amount" DECIMAL(19, 4) NOT NULL,
  "provider_amount" DECIMAL(19, 4) NOT NULL,
  "amount_difference" DECIMAL(19, 4) NOT NULL,
  "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
  "reviewed_at" TIMESTAMP,
  "reviewed_by" UUID REFERENCES "users"("id"),
  "notes" TEXT,
  "report_data" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "reconciliation_reports_date_provider_currency_unique" UNIQUE ("date", "provider", "currency")
);

CREATE INDEX "idx_reconciliation_date_provider" ON "reconciliation_reports"("date", "provider");
CREATE INDEX "idx_reconciliation_status" ON "reconciliation_reports"("status");

-- Webhook Events
CREATE TABLE "webhook_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" "PaymentProvider" NOT NULL,
  "event_id" VARCHAR(255) NOT NULL,
  "event_type" VARCHAR(100) NOT NULL,
  "payload" JSONB NOT NULL,
  "processed" BOOLEAN NOT NULL DEFAULT false,
  "processed_at" TIMESTAMP,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "last_retry_at" TIMESTAMP,
  "error" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "webhook_events_provider_event_id_unique" UNIQUE ("provider", "event_id")
);

CREATE INDEX "idx_webhook_events_processed_created" ON "webhook_events"("processed", "created_at");
CREATE INDEX "idx_webhook_events_provider_type" ON "webhook_events"("provider", "event_type");

-- Disputes
CREATE TABLE "disputes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_transaction_id" UUID NOT NULL,
  "user_id" UUID NOT NULL REFERENCES "users"("id"),
  "type" VARCHAR(50) NOT NULL,
  "status" VARCHAR(50) NOT NULL DEFAULT 'open',
  "amount" DECIMAL(19, 4) NOT NULL,
  "currency" "Currency" NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" JSONB,
  "provider_reference" VARCHAR(255),
  "opened_at" TIMESTAMP NOT NULL DEFAULT now(),
  "responded_at" TIMESTAMP,
  "resolved_at" TIMESTAMP,
  "resolution" VARCHAR(50),
  "notes" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX "idx_disputes_user_status" ON "disputes"("user_id", "status");
CREATE INDEX "idx_disputes_status_opened" ON "disputes"("status", "opened_at");
CREATE INDEX "idx_disputes_provider_ref" ON "disputes"("provider_reference");

-- Provider Health
CREATE TABLE "provider_health" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" "PaymentProvider" UNIQUE NOT NULL,
  "is_healthy" BOOLEAN NOT NULL DEFAULT true,
  "last_check_at" TIMESTAMP NOT NULL DEFAULT now(),
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "avg_response_time" INTEGER,
  "success_rate" DOUBLE PRECISION,
  "last_incident_at" TIMESTAMP,
  "metadata" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

-- Partitioning for large tables (PostgreSQL 10+)
-- Partition ledger_entries by month for better performance
-- This can be done manually or via Prisma migrations

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_wallet_accounts_updated_at BEFORE UPDATE ON "wallet_accounts" 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON "transactions" 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_methods_updated_at BEFORE UPDATE ON "payment_methods" 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_transactions_updated_at BEFORE UPDATE ON "payment_transactions" 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_balance_holds_updated_at BEFORE UPDATE ON "balance_holds" 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payouts_updated_at BEFORE UPDATE ON "payouts" 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_disputes_updated_at BEFORE UPDATE ON "disputes" 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_provider_health_updated_at BEFORE UPDATE ON "provider_health" 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create system accounts (UBI Commission, Float, etc.)
INSERT INTO "wallet_accounts" ("account_type", "currency", "balance", "available_balance", "held_balance")
VALUES 
  ('UBI_COMMISSION', 'NGN', 0, 0, 0),
  ('UBI_COMMISSION', 'KES', 0, 0, 0),
  ('UBI_COMMISSION', 'ZAR', 0, 0, 0),
  ('UBI_COMMISSION', 'GHS', 0, 0, 0),
  ('UBI_COMMISSION', 'RWF', 0, 0, 0),
  ('UBI_COMMISSION', 'ETB', 0, 0, 0),
  ('UBI_FLOAT', 'NGN', 0, 0, 0),
  ('UBI_FLOAT', 'KES', 0, 0, 0),
  ('UBI_FLOAT', 'ZAR', 0, 0, 0),
  ('UBI_FLOAT', 'GHS', 0, 0, 0),
  ('UBI_FLOAT', 'RWF', 0, 0, 0),
  ('UBI_FLOAT', 'ETB', 0, 0, 0),
  ('CEERION_ESCROW', 'NGN', 0, 0, 0),
  ('REFUND_RESERVE', 'NGN', 0, 0, 0),
  ('REFUND_RESERVE', 'KES', 0, 0, 0),
  ('REFUND_RESERVE', 'ZAR', 0, 0, 0),
  ('REFUND_RESERVE', 'GHS', 0, 0, 0),
  ('REFUND_RESERVE', 'RWF', 0, 0, 0),
  ('REFUND_RESERVE', 'ETB', 0, 0, 0);

-- Comments for documentation
COMMENT ON TABLE "wallet_accounts" IS 'Double-entry ledger wallet accounts for users and system accounts';
COMMENT ON TABLE "ledger_entries" IS 'Immutable ledger entries (debits and credits). Every transaction creates balanced entries.';
COMMENT ON TABLE "transactions" IS 'Groups related ledger entries. Enforces idempotency via idempotency_key.';
COMMENT ON TABLE "payment_methods" IS 'Tokenized payment methods (cards, mobile money, bank accounts). No raw card data stored.';
COMMENT ON TABLE "payment_transactions" IS 'External payment transactions via payment providers (Paystack, M-Pesa, etc.)';
COMMENT ON TABLE "balance_holds" IS 'Pre-authorization holds on wallet balances (e.g., during ride matching)';
COMMENT ON TABLE "payouts" IS 'Driver cashouts to external accounts (mobile money, bank transfers)';
COMMENT ON TABLE "risk_assessments" IS 'Fraud detection risk scores and actions for payment transactions';
COMMENT ON TABLE "reconciliation_reports" IS 'Daily reconciliation reports matching internal and provider transactions';
COMMENT ON TABLE "webhook_events" IS 'Idempotent webhook event processing from payment providers';
COMMENT ON TABLE "disputes" IS 'Chargebacks, refund requests, and payment disputes';
COMMENT ON TABLE "provider_health" IS 'Real-time health monitoring of payment providers';
