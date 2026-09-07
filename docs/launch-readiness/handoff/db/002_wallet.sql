-- Conventions: ids are text (nanoid), money is bigint minor units + currency text, timestamps timestamptz.
-- Every table carries created_at/updated_at; tables that hold state carry version int for optimistic concurrency.
-- Translate to Prisma models in packages/database; keep names.
-- 002 wallet (payment-service)
create table wallets (id text primary key, owner_type text not null, owner_id text not null, currency text not null, tier text not null, safe_mode_until timestamptz, locked boolean default false, pin_hash text, pin_failed_attempts int default 0, pin_locked_until timestamptz, cooling_until timestamptz, unique(owner_type, owner_id, currency));
create table journal_entries (id text primary key, kind text not null, reference text not null, description text, occurred_at timestamptz not null, idempotency_key text unique, case_ref text);
create table journal_lines (id text primary key, entry_id text references journal_entries(id), account text not null, wallet_id text references wallets(id), amount_minor bigint not null, currency text not null, counterpart_ref text);
create index journal_lines_wallet on journal_lines(wallet_id);
-- invariant enforced in a deferred trigger: sum(amount_minor) per entry_id = 0
create table transfers (id text primary key, from_wallet text references wallets(id), to_wallet text references wallets(id), amount_minor bigint not null, currency text not null, note text, status text not null, risk_hold_reason text, entry_id text references journal_entries(id), idempotency_key text unique, created_at timestamptz default now());
create table transfer_requests (id text primary key, from_user text not null, to_user text not null, amount_minor bigint not null, ride_id text, status text not null, created_at timestamptz default now());
create table return_requests (id text primary key, transfer_id text references transfers(id), status text not null check (status in ('requested','returned','declined','disputed')), created_at timestamptz default now());
create table nip_transfers (id text primary key, wallet_id text references wallets(id), bank_code text, account_number text, account_name text, amount_minor bigint, status text not null, session_id text, confirmed_at timestamptz, reversed_at timestamptz, idempotency_key text unique);
create table topups (id text primary key, wallet_id text references wallets(id), method_id text, amount_minor bigint, status text not null, psp_ref text, saga_transfer_id text references transfers(id));
create table statements (id text primary key, wallet_id text references wallets(id), period_start date, period_end date, opening_minor bigint, in_minor bigint, out_minor bigint, closing_minor bigint, file_url text, created_at timestamptz default now());
create table split_rules (id text primary key, driver_id text not null, fleet_id text not null, vehicle_id text not null, type text not null, amount_minor bigint, percent numeric, shortfall_policy text, shortfall_max_weeks int, terms_hash text not null, signed_at timestamptz, active boolean default false);
create table remittances (id text primary key, split_rule_id text references split_rules(id), week_start date, due_minor bigint, covered_minor bigint, carried_minor bigint default 0, entry_id text references journal_entries(id), status text not null);
