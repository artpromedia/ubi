-- Conventions: ids are text (nanoid), money is bigint minor units + currency text, timestamps timestamptz.
-- Every table carries created_at/updated_at; tables that hold state carry version int for optimistic concurrency.
-- Translate to Prisma models in packages/database; keep names.
-- 005 send (delivery-service)
create table business_accounts (id text primary key, legal_name text, cac_rc text, tin text, status text, billing jsonb);
create table api_keys (id text primary key, business_id text references business_accounts(id), key_hash text not null, scopes text[], created_at timestamptz default now(), revoked_at timestamptz);
create table webhooks (id text primary key, business_id text references business_accounts(id), url text, secret text, events text[]);
create table shipments (id text primary key, sender_type text, sender_id text, business_id text, pickup jsonb, dropoff jsonb, recipient jsonb, size text, declared_value_minor bigint, quote_minor bigint, currency text, status text not null, pickup_code text, delivery_code text, courier_id text, hub_id text, version int default 1, idempotency_key text unique, created_at timestamptz default now());
create table custody_photos (id text primary key, shipment_id text references shipments(id), stage text check (stage in ('pickup','handover','exception','recipient')), file_ref text, lat numeric, lng numeric, taken_at timestamptz);
create table shipment_exceptions (id text primary key, shipment_id text references shipments(id), type text not null, evidence jsonb not null, sender_decision text, decide_by timestamptz, fee_minor bigint, created_at timestamptz default now());
create table claims (id text primary key, shipment_id text references shipments(id), claimant text, category text, photos text[], declared_value_minor bigint, decision text, decided_minor bigint, decided_by text, appeal_status text, created_at timestamptz default now());
create table bulk_imports (id text primary key, business_id text references business_accounts(id), file_ref text, rows int, valid int, errors jsonb, created_at timestamptz default now());
create table scheduled_pickups (id text primary key, business_id text references business_accounts(id), window_start timestamptz, window_end timestamptz, address jsonb, expected_count int, status text);
