-- Conventions: ids are text (nanoid), money is bigint minor units + currency text, timestamps timestamptz.
-- Every table carries created_at/updated_at; tables that hold state carry version int for optimistic concurrency.
-- Translate to Prisma models in packages/database; keep names.
-- 007 fleet (fleet-service)
create table fleets (id text primary key, legal_name text, cac_rc text, tin text, status text not null, approved_at timestamptz);
create table fleet_staff (id text primary key, fleet_id text references fleets(id), user_id text, role text check (role in ('owner','manager','viewer')));
create table fleet_vehicles (id text primary key, fleet_id text references fleets(id), plate text unique, make text, model text, year int, colour text, classes text[], status text not null, telematics_ref text);
create table vehicle_documents (id text primary key, vehicle_id text references fleet_vehicles(id), type text, file_ref text, expires_at date, status text);
create table assignment_offers (id text primary key, fleet_id text references fleets(id), vehicle_id text references fleet_vehicles(id), driver_id text not null, terms jsonb not null, terms_hash text not null, historic_earnings jsonb, status text not null, expires_at timestamptz, signed_at timestamptz, created_at timestamptz default now());
create table assignments (id text primary key, offer_id text references assignment_offers(id), fleet_id text, vehicle_id text, driver_id text, shift text, split_rule_id text, status text not null, notice_given_at timestamptz, ends_at timestamptz);
create table fleet_alerts (id text primary key, fleet_id text references fleets(id), vehicle_id text, type text, severity text, message text, resolved boolean default false, created_at timestamptz default now());
