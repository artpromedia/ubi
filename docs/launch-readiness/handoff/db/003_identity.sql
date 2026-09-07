-- Conventions: ids are text (nanoid), money is bigint minor units + currency text, timestamps timestamptz.
-- Every table carries created_at/updated_at; tables that hold state carry version int for optimistic concurrency.
-- Translate to Prisma models in packages/database; keep names.
-- 003 identity (user-service)
create table devices (id text primary key, user_id text not null, platform text, model text, trusted boolean default false, enrolled_at timestamptz default now(), last_seen timestamptz);
create table step_up_challenges (id text primary key, user_id text not null, device_id text references devices(id), method text not null check (method in ('old_device_approve','selfie_nin','sms_otp')), status text not null, score numeric, created_at timestamptz default now(), resolved_at timestamptz);
create table sim_swap_signals (id text primary key, user_id text not null, phone text not null, reported_at timestamptz not null, source text, handled boolean default false);
create table documents (id text primary key, owner_type text not null, owner_id text not null, type text not null, file_ref text not null, expires_at date, status text not null check (status in ('pending','valid','rejected','expired')), reviewed_by text, reviewed_at timestamptz, review_note text);
create index documents_expiry on documents(expires_at) where status = 'valid';
create table identity_cases (id text primary key, driver_id text not null, signals jsonb not null, status text not null, decision text, decided_by text[], created_at timestamptz default now());
create table face_checks (id text primary key, driver_id text not null, device_id text, score numeric, passed boolean, reason text, created_at timestamptz default now());
