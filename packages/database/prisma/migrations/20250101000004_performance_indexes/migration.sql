-- Performance Optimization Indexes Migration
-- Adds composite indexes for frequently accessed query patterns.
--
-- This migration previously could not be applied at all. Two classes of defect
-- were fixed; each change is annotated inline so the intent stays reviewable.
--
--   1. CREATE INDEX CONCURRENTLY cannot run inside a transaction (SQLSTATE
--      25001) and Prisma Migrate wraps every migration in one. The chain must
--      provision an empty database, where concurrency buys nothing, so these are
--      plain CREATE INDEX. To roll out onto a live populated database, create
--      them out of band with CONCURRENTLY first and then
--      `prisma migrate resolve --applied 20250101000004_performance_indexes`;
--      the IF NOT EXISTS guards make that a no-op.
--
--   2. Five statements referenced columns and a table that do not exist in the
--      schema (verified against a freshly provisioned database). They are
--      corrected to the real columns, or removed where there is no target.

-- WalletAccount: High-frequency balance lookups
CREATE INDEX IF NOT EXISTS idx_wallet_accounts_user_type_currency_active
ON wallet_accounts(user_id, account_type, currency)
WHERE is_active = true;

-- Transaction: Status-based queries with date filtering
CREATE INDEX IF NOT EXISTS idx_transactions_status_type_created
ON transactions(status, transaction_type, created_at DESC);

-- REMOVED: idx_ledger_entries_account_created_desc duplicated the index the
-- datamodel already declares on LedgerEntry as @@index([accountId, createdAt]).

-- PaymentTransaction: User payment history
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_status_initiated
ON payment_transactions(user_id, status, initiated_at DESC);

-- PaymentTransaction: Provider reconciliation
CREATE INDEX IF NOT EXISTS idx_payment_transactions_provider_status_created
ON payment_transactions(provider, status, initiated_at DESC);

-- PaymentMethods: User payment methods lookup
CREATE INDEX IF NOT EXISTS idx_payment_methods_user_verified_default
ON payment_methods(user_id, is_verified, is_default)
WHERE is_verified = true;

-- BalanceHold: Active holds lookup.
-- FIXED: balance_holds has no `status` column. An active hold is one that has
-- not been released, which the model expresses as is_released = false.
CREATE INDEX IF NOT EXISTS idx_balance_holds_account_active
ON balance_holds(account_id, expires_at)
WHERE is_released = false;

-- REMOVED: an index on `fraud_alerts(user_id, is_active, ...)`. No fraud_alerts
-- table exists. The closest table is `alerts`, which has neither user_id nor
-- is_active (it uses `resolved`), so this is indexed on its real shape instead.
CREATE INDEX IF NOT EXISTS idx_alerts_type_unresolved
ON alerts(type, created_at DESC)
WHERE resolved = false;

-- Payout: Pending payouts for processing.
-- FIXED: payouts has no `scheduled_at` column; initiated_at is when the payout
-- entered the queue.
CREATE INDEX IF NOT EXISTS idx_payouts_status_initiated
ON payouts(status, initiated_at)
WHERE status IN ('PENDING', 'PROCESSING');

-- REMOVED: an index on driver_earnings(driver_id, period_start, period_end).
-- Those columns do not exist; statements are derived by filtering created_at
-- per driver, and the datamodel already declares @@index([driverId, createdAt]).

-- REMOVED: a partial index predicated on `created_at > NOW() - INTERVAL '30
-- days'`. Postgres requires index predicates to be IMMUTABLE and NOW() is
-- STABLE, so the statement is rejected. No replacement is needed: the datamodel
-- already declares @@index([createdAt]) on Transaction.

-- Partial index for pending/processing transactions
CREATE INDEX IF NOT EXISTS idx_transactions_pending_processing
ON transactions(status, created_at DESC)
WHERE status IN ('PENDING', 'PROCESSING');

-- Analyze tables to update statistics after index creation
ANALYZE wallet_accounts;
ANALYZE transactions;
ANALYZE ledger_entries;
ANALYZE payment_transactions;
ANALYZE payment_methods;
ANALYZE balance_holds;
