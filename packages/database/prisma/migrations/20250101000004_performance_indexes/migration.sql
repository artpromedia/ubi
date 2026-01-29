-- Performance Optimization Indexes Migration
-- Adds composite indexes for frequently accessed query patterns

-- WalletAccount: High-frequency balance lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallet_accounts_user_type_currency_active 
ON wallet_accounts(user_id, account_type, currency) 
WHERE is_active = true;

-- Transaction: Status-based queries with date filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_status_type_created 
ON transactions(status, transaction_type, created_at DESC);

-- Transaction: User transaction history (via ledger entries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ledger_entries_account_created_desc 
ON ledger_entries(account_id, created_at DESC);

-- PaymentTransaction: User payment history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_transactions_user_status_initiated 
ON payment_transactions(user_id, status, initiated_at DESC);

-- PaymentTransaction: Provider reconciliation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_transactions_provider_status_created 
ON payment_transactions(provider, status, initiated_at DESC);

-- PaymentMethods: User payment methods lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_methods_user_verified_default 
ON payment_methods(user_id, is_verified, is_default) 
WHERE is_verified = true;

-- BalanceHold: Active holds lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_balance_holds_account_active 
ON balance_holds(account_id, status) 
WHERE status = 'ACTIVE';

-- Fraud alerts: Active alerts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fraud_alerts_user_active 
ON fraud_alerts(user_id, is_active, created_at DESC) 
WHERE is_active = true;

-- Payout: Pending payouts for processing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payouts_status_scheduled 
ON payouts(status, scheduled_at) 
WHERE status IN ('PENDING', 'SCHEDULED');

-- Driver earnings: Period-based queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_driver_earnings_driver_period 
ON driver_earnings(driver_id, period_start DESC, period_end DESC);

-- Partial index for recent transactions (hot data)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_recent 
ON transactions(created_at DESC) 
WHERE created_at > NOW() - INTERVAL '30 days';

-- Partial index for pending/processing transactions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_pending_processing 
ON transactions(status, created_at DESC) 
WHERE status IN ('PENDING', 'PROCESSING');

-- Analyze tables to update statistics after index creation
ANALYZE wallet_accounts;
ANALYZE transactions;
ANALYZE ledger_entries;
ANALYZE payment_transactions;
ANALYZE payment_methods;
ANALYZE balance_holds;
