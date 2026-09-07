-- Double-entry invariant (handoff CLAUDE.md #4, db/migrations/002_wallet.sql).
--
-- The lines of a journal entry must sum to zero. The check is a CONSTRAINT
-- TRIGGER declared DEFERRABLE INITIALLY DEFERRED so an entry and its lines can
-- be inserted in any order inside one transaction; the balance is verified once,
-- at COMMIT. An unbalanced entry therefore cannot be committed at all — the
-- invariant does not depend on application code remembering to check.

CREATE OR REPLACE FUNCTION assert_journal_entry_balances() RETURNS TRIGGER AS $$
DECLARE
  target_entry TEXT;
  unbalanced RECORD;
BEGIN
  target_entry := COALESCE(NEW.entry_id, OLD.entry_id);

  -- An entry with no lines yet (mid-transaction) is not an error; an entry with
  -- lines that do not sum to zero, per currency, is.
  SELECT jl.currency, SUM(jl.amount_minor) AS total
    INTO unbalanced
    FROM journal_lines jl
   WHERE jl.entry_id = target_entry
   GROUP BY jl.currency
  HAVING SUM(jl.amount_minor) <> 0
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'journal entry % is unbalanced: % lines sum to % (must be 0)',
      target_entry, unbalanced.currency, unbalanced.total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_lines_balance
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balances();

-- A journal line must reference a wallet whose currency matches the line, so a
-- NGN line can never land in a KES wallet.
CREATE OR REPLACE FUNCTION assert_journal_line_currency() RETURNS TRIGGER AS $$
DECLARE
  wallet_currency TEXT;
BEGIN
  IF NEW.wallet_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT w.currency INTO wallet_currency FROM wallets w WHERE w.id = NEW.wallet_id;

  IF wallet_currency IS NOT NULL AND wallet_currency <> NEW.currency THEN
    RAISE EXCEPTION
      'journal line currency % does not match wallet % currency %',
      NEW.currency, NEW.wallet_id, wallet_currency
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_lines_currency
  BEFORE INSERT OR UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION assert_journal_line_currency();

-- Balances are derived from the journal, never stored as truth (CLAUDE.md #4).
CREATE OR REPLACE VIEW wallet_balances AS
  SELECT w.id AS wallet_id,
         w.owner_type,
         w.owner_id,
         w.currency,
         COALESCE(SUM(jl.amount_minor), 0)::BIGINT AS balance_minor
    FROM wallets w
    LEFT JOIN journal_lines jl ON jl.wallet_id = w.id AND jl.currency = w.currency
   GROUP BY w.id, w.owner_type, w.owner_id, w.currency;
