-- Conventions: ids are text (nanoid), money is bigint minor units + currency text, timestamps timestamptz.
-- Every table carries created_at/updated_at; tables that hold state carry version int for optimistic concurrency.
-- Translate to Prisma models in packages/database; keep names.
-- 004 bites (food-service)
create table merchants (id text primary key, legal_name text, trade_name text, cac_rc text, tin text, status text not null, approved_at timestamptz, rank_score numeric default 0);
create table merchant_kyb (id text primary key, merchant_id text references merchants(id), checks jsonb not null, permit_file text, permit_expiry date, reviewed_by text, decision text, created_at timestamptz default now());
create table outlets (id text primary key, merchant_id text references merchants(id), address text, lat numeric, lng numeric, hours jsonb, paused_until timestamptz, open boolean default true);
create table menu_items (id text primary key, outlet_id text references outlets(id), category text, name text, description text, price_minor bigint, currency text, allergens text[], sold_out_until timestamptz, photo_ref text, active boolean default true);
create table option_groups (id text primary key, item_id text references menu_items(id), name text, required boolean, min_select int, max_select int);
create table options (id text primary key, group_id text references option_groups(id), name text, price_delta_minor bigint default 0);
create table carts (id text primary key, user_id text not null, outlet_id text references outlets(id), items jsonb not null, subtotal_minor bigint, updated_at timestamptz default now());
create table orders (id text primary key, user_id text not null, outlet_id text references outlets(id), status text not null, items jsonb not null, totals jsonb not null, payment_intent_id text, auth_captured boolean default false, handover_code text, delivery_code text, courier_id text, version int default 1, created_at timestamptz default now());
create table order_issues (id text primary key, order_id text references orders(id), items jsonb not null, type text not null, photo_ref text, requested_minor bigint, status text not null, merchant_response text, respond_by timestamptz, decided_at timestamptz);
create table merchant_payouts (id text primary key, merchant_id text references merchants(id), week_start date, gross_minor bigint, fees_minor bigint, refunds_minor bigint, net_minor bigint, entry_id text, status text);
