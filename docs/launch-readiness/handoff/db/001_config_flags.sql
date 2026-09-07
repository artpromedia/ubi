-- Conventions: ids are text (nanoid), money is bigint minor units + currency text, timestamps timestamptz.
-- Every table carries created_at/updated_at; tables that hold state carry version int for optimistic concurrency.
-- Translate to Prisma models in packages/database; keep names.
-- 001 config & flags (config-service)
create table cities (id text primary key, name text not null, country text not null, timezone text not null, active boolean default false);
create table city_config_versions (id text primary key, city_id text references cities(id), version int not null, config jsonb not null, activated_at timestamptz, created_by text not null, approved_by text, unique(city_id, version));
create table config_change_requests (id text primary key, city_id text references cities(id), patch jsonb not null, reason text not null, author_id text not null, status text not null check (status in ('pending','approved','rejected','activated')), created_at timestamptz default now());
create table config_approvals (id text primary key, request_id text references config_change_requests(id), approver_id text not null, created_at timestamptz default now(), unique(request_id, approver_id));
create table feature_flags (key text primary key, description text, default_on boolean not null default false);
create table flag_rules (id text primary key, flag_key text references feature_flags(key), city_id text references cities(id), segment jsonb, enabled boolean not null default false, updated_by text, updated_at timestamptz default now());
create table audit_log (id text primary key, actor_id text not null, actor_role text not null, action text not null, subject_type text not null, subject_id text not null, before jsonb, after jsonb, reason text, created_at timestamptz default now());
create index audit_subject on audit_log(subject_type, subject_id);
