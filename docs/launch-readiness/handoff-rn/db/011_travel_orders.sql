-- 011 travel v2 (owner: travel-service). Canonical UBI ids; supplier refs stored, never used as keys.
CREATE TABLE travel_suppliers ( id text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('flight','stay')), adapter text NOT NULL, config jsonb NOT NULL, enabled boolean NOT NULL DEFAULT false );
CREATE TABLE travel_capabilities_log ( id text PRIMARY KEY, supplier_id text NOT NULL REFERENCES travel_suppliers(id), offer_ref text NOT NULL, capabilities jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE travel_searches ( id text PRIMARY KEY, user_id text NOT NULL, kind text NOT NULL, params jsonb NOT NULL, supplier_id text REFERENCES travel_suppliers(id), prices_as_of timestamptz NOT NULL, offers jsonb NOT NULL, cache_until timestamptz, created_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE travel_carts (
  id text PRIMARY KEY, user_id text NOT NULL, status text NOT NULL CHECK (status IN ('building','priced','repriced','paying','checked_out','expired')), items jsonb NOT NULL, passengers jsonb, fees jsonb, adjustments jsonb,
  total_minor bigint, currency text, previous_total_minor bigint, idempotency_key text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE travel_trips ( id text PRIMARY KEY, user_id text NOT NULL, title text NOT NULL, start_date date, end_date date, timezone text NOT NULL DEFAULT 'Africa/Lagos', created_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE travel_orders (
  id text PRIMARY KEY, trip_id text REFERENCES travel_trips(id), cart_id text REFERENCES travel_carts(id), user_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('flight','stay')), supplier_id text NOT NULL REFERENCES travel_suppliers(id),
  state text NOT NULL CHECK (state IN ('payment_authorized','submitted','supplier_pending','confirmed','ticketed','failed_released','unknown_reconciling','disrupted','cancelled','refunded','completed')),
  state_at timestamptz NOT NULL DEFAULT now(), supplier_refs jsonb NOT NULL DEFAULT '{}', offer_snapshot jsonb NOT NULL, capabilities jsonb NOT NULL,
  price_minor bigint NOT NULL, currency text NOT NULL, supplier_price_minor bigint, supplier_currency text, fx_rate numeric(18,6), fx_locked_until timestamptz,
  held_minor bigint NOT NULL DEFAULT 0, charged_minor bigint NOT NULL DEFAULT 0, released_minor bigint NOT NULL DEFAULT 0, pay_at_property_minor bigint NOT NULL DEFAULT 0,
  policy jsonb NOT NULL, protection_rule_id text, grant_id text, idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON travel_orders (user_id, state);
CREATE TABLE travel_order_events ( id bigserial PRIMARY KEY, order_id text NOT NULL REFERENCES travel_orders(id), from_state text, to_state text NOT NULL, actor text NOT NULL, detail jsonb, at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE travel_documents ( id text PRIMARY KEY, order_id text NOT NULL REFERENCES travel_orders(id), kind text NOT NULL CHECK (kind IN ('eticket','booking_confirmation','boarding_pass')), number text NOT NULL, passenger_index int, issued_at timestamptz NOT NULL );
CREATE TABLE travel_refunds (
  id text PRIMARY KEY, order_id text NOT NULL REFERENCES travel_orders(id), amount_minor bigint NOT NULL, currency text NOT NULL, penalty_minor bigint NOT NULL DEFAULT 0,
  stage text NOT NULL CHECK (stage IN ('requested','supplier_confirmed','supplier_refund_pending','refunded_to_wallet','rejected')), expected_by date, supplier_ref text, ledger_entry_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE travel_disruptions (
  id text PRIMARY KEY, order_id text NOT NULL REFERENCES travel_orders(id), cause text NOT NULL, verified_at timestamptz NOT NULL, source text NOT NULL,
  covered boolean NOT NULL, rule_id text, funded_by text, cap_minor bigint, alternatives jsonb NOT NULL, airline_options jsonb NOT NULL, resolution text, resolved_at timestamptz
);
CREATE TABLE travel_webhooks ( id text PRIMARY KEY, supplier_id text NOT NULL REFERENCES travel_suppliers(id), external_id text NOT NULL, signature_ok boolean NOT NULL, payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, UNIQUE (supplier_id, external_id) );
CREATE TABLE travel_settlements ( id text PRIMARY KEY, order_id text NOT NULL REFERENCES travel_orders(id), charged_minor bigint NOT NULL, invoiced_minor bigint NOT NULL, difference_minor bigint NOT NULL, currency text NOT NULL, resolution text CHECK (resolution IN ('accepted','disputed')), resolved_by text, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE travel_commercial_rates ( id text PRIMARY KEY, supplier_id text NOT NULL REFERENCES travel_suppliers(id), route_or_property text NOT NULL, fee_schedule jsonb NOT NULL, source text NOT NULL, effective_date date NOT NULL, terms_ref text );
CREATE TABLE ride_reservation_links ( reservation_id text PRIMARY KEY, order_id text NOT NULL REFERENCES travel_orders(id), direction text NOT NULL CHECK (direction IN ('to_airport','from_airport')), retimed_count int NOT NULL DEFAULT 0 );
