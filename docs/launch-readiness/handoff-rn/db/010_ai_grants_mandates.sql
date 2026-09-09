-- 010 action grants + mandates (owner: user-service auth domain) and ask threads (owner: ask-service)
CREATE TABLE action_grants (
  id text PRIMARY KEY, actor_id text NOT NULL, action text NOT NULL, resource_ref text NOT NULL, provider text, terms_version text NOT NULL,
  total_minor bigint NOT NULL, currency text NOT NULL, idempotency_key text NOT NULL UNIQUE, assurance text NOT NULL CHECK (assurance IN ('pin','biometric','mandate')),
  mandate_id text, expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON action_grants (actor_id, expires_at);
CREATE TABLE mandates (
  id text PRIMARY KEY, user_id text NOT NULL, action text NOT NULL CHECK (action IN ('airport_pickup.reserve','flight.rebook_on_cancel','scheduled_ride.book')),
  title text NOT NULL, passengers text NOT NULL CHECK (passengers IN ('self_only','saved_passengers')), categories text[] NOT NULL, providers text[],
  per_run_cap_minor bigint NOT NULL, period_cap_minor bigint NOT NULL, period_runs int NOT NULL, max_price_variance_minor bigint, currency text NOT NULL,
  constraints jsonb NOT NULL, status text NOT NULL CHECK (status IN ('active','paused','revoked','expired')), expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK (expires_at <= created_at + interval '12 months')
);
CREATE TABLE mandate_allowances (
  mandate_id text NOT NULL REFERENCES mandates(id), period_start date NOT NULL, amount_used_minor bigint NOT NULL DEFAULT 0, runs_used int NOT NULL DEFAULT 0,
  PRIMARY KEY (mandate_id, period_start)
);
CREATE TABLE mandate_executions (
  id text PRIMARY KEY, mandate_id text NOT NULL REFERENCES mandates(id), trigger_ref text NOT NULL, outcome text NOT NULL CHECK (outcome IN ('executed','blocked')),
  reason_code text, grant_id text REFERENCES action_grants(id), receipt_ref text UNIQUE, result_ref text, amount_minor bigint, currency text, summary text,
  at timestamptz NOT NULL DEFAULT now(), UNIQUE (mandate_id, trigger_ref)
);
CREATE TABLE ask_threads (
  id text PRIMARY KEY, user_id text NOT NULL, role text NOT NULL, source text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz
);
CREATE TABLE ask_messages (
  id text PRIMARY KEY, thread_id text NOT NULL REFERENCES ask_threads(id), sender text NOT NULL CHECK (sender IN ('user','assistant','system')), redacted_text text NOT NULL,
  cards jsonb, sources jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ask_reviews (
  id text PRIMARY KEY, thread_id text NOT NULL REFERENCES ask_threads(id), user_id text NOT NULL, terms_version text NOT NULL, items jsonb NOT NULL, adjustments jsonb,
  total_minor bigint NOT NULL, currency text NOT NULL, payment_method_id text NOT NULL, status text NOT NULL CHECK (status IN ('awaiting_confirmation','executing','expired','superseded','cancelled')),
  expires_at timestamptz NOT NULL, grant_id text REFERENCES action_grants(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ask_executions (
  id text PRIMARY KEY, review_id text NOT NULL REFERENCES ask_reviews(id), status text NOT NULL CHECK (status IN ('processing','confirmed','partly_booked','failed')),
  items jsonb NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
