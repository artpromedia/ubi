-- 012 AI action log (owner: ask-service; readers: ops). Minimum content, 90-day retention, access audited. Never store hidden reasoning or secrets.
CREATE TABLE ai_actions (
  id text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor_kind text NOT NULL CHECK (actor_kind IN ('rider','driver','mandate','admin')), actor_ref text NOT NULL,
  thread_id text, action text NOT NULL, tool text, model text, model_revision text, prompt_version text, redacted_inputs jsonb,
  auth_kind text NOT NULL CHECK (auth_kind IN ('grant','mandate','read_only','none')), auth_ref text, provider_refs text[],
  outcome text NOT NULL CHECK (outcome IN ('done','partial','blocked','refused','error')), reason_code text, tokens int, cost_minor bigint, currency text, latency_ms int,
  retention_until date NOT NULL DEFAULT (current_date + 90)
);
CREATE INDEX ON ai_actions (at DESC);
CREATE INDEX ON ai_actions (actor_ref, at DESC);
CREATE TABLE ai_model_metrics_daily ( day date NOT NULL, model text NOT NULL, model_revision text NOT NULL, tasks int NOT NULL, success int NOT NULL, unsafe_actions int NOT NULL, p95_latency_ms int, cost_minor bigint NOT NULL, currency text NOT NULL, PRIMARY KEY (day, model, model_revision) );
CREATE TABLE ai_action_access_log ( id bigserial PRIMARY KEY, admin_id text NOT NULL, query jsonb NOT NULL, at timestamptz NOT NULL DEFAULT now() );
