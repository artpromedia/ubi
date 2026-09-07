-- Conventions: ids are text (nanoid), money is bigint minor units + currency text, timestamps timestamptz.
-- Every table carries created_at/updated_at; tables that hold state carry version int for optimistic concurrency.
-- Translate to Prisma models in packages/database; keep names.
-- 008 ops: support, recon, reviews, safety (support-service, payment-service finance)
create table support_cases (id text primary key, user_type text, user_id text, subject_type text, subject_id text, category text, status text not null, sla_due timestamptz, assignee text, created_at timestamptz default now(), resolved_at timestamptz);
create table case_events (id text primary key, case_id text references support_cases(id), kind text, payload jsonb, actor text, created_at timestamptz default now());
create table remedies (id text primary key, case_id text references support_cases(id), type text not null, amount_minor bigint, reason text, entry_id text, by_user text, created_at timestamptz default now());
create table recon_runs (date date primary key, status text not null, unexplained_minor bigint, closed_by text, closed_at timestamptz);
create table recon_rails (id text primary key, date date references recon_runs(date), rail text not null, ledger_minor bigint, external_minor bigint, diff_minor bigint, status text);
create table recon_breaks (id text primary key, rail_id text references recon_rails(id), amount_minor bigint, description text, owner text, deadline timestamptz, resolution_ref text, resolved_at timestamptz);
create table safety_cases (id text primary key, ride_id text, raised_by text, severity text, status text not null, sla_due timestamptz, responder text, timeline jsonb, created_at timestamptz default now());
create table review_decisions (id text primary key, queue text not null, subject_type text, subject_id text, checks jsonb, decision text not null, reviewers text[] not null, note text, created_at timestamptz default now());
