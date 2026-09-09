-- 009 promotions, referrals, driver incentives (owner: promotions module). Money = bigint minor + currency. Ids = text (nanoid).
CREATE TABLE campaigns (
  id text PRIMARY KEY, name text NOT NULL, benefit_type text NOT NULL CHECK (benefit_type IN ('fare_discount','fee_waiver','credit','driver_rebate','driver_window','referral')),
  state text NOT NULL CHECK (state IN ('draft','simulated','awaiting_approval','scheduled','active','paused','exhausted','ended')),
  state_at timestamptz NOT NULL DEFAULT now(), state_by text, author_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE campaign_versions (
  id text PRIMARY KEY, campaign_id text NOT NULL REFERENCES campaigns(id), version int NOT NULL,
  audience_rule text NOT NULL, market text NOT NULL, window_start timestamptz NOT NULL, window_end timestamptz NOT NULL, timezone text NOT NULL,
  value jsonb NOT NULL, caps jsonb NOT NULL, qualification_event text NOT NULL, stacking jsonb NOT NULL, funding jsonb NOT NULL,
  budget_limit_minor bigint NOT NULL, currency text NOT NULL, experiment jsonb, copy text NOT NULL,
  approval_id text, approved_by text, approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, version), CHECK (approved_by IS NULL OR approved_by <> (SELECT author_id FROM campaigns c WHERE c.id = campaign_id))
);
CREATE TABLE campaign_budgets (
  campaign_version_id text PRIMARY KEY REFERENCES campaign_versions(id),
  reserved_minor bigint NOT NULL DEFAULT 0, consumed_minor bigint NOT NULL DEFAULT 0, reversed_minor bigint NOT NULL DEFAULT 0,
  exhausted_at timestamptz, CHECK (reserved_minor >= 0 AND consumed_minor >= 0)
);
CREATE TABLE promotion_reservations (
  id text PRIMARY KEY, campaign_version_id text NOT NULL REFERENCES campaign_versions(id), user_id text NOT NULL, subject_kind text NOT NULL, subject_id text NOT NULL,
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('fare_discount','fee_waiver','credit','referral_reward','driver_rebate','window_waiver')),
  amount_minor bigint NOT NULL, currency text NOT NULL, state text NOT NULL CHECK (state IN ('reserved','consumed','released','reversed')),
  reason_code text, terms_ref text, idempotency_key text NOT NULL UNIQUE, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON promotion_reservations (user_id, campaign_version_id, state);
CREATE TABLE user_credits (
  id text PRIMARY KEY, user_id text NOT NULL, amount_minor bigint NOT NULL, currency text NOT NULL, per_ride_cap_minor bigint, scope text NOT NULL DEFAULT 'rides',
  expires_at date NOT NULL, source_reservation_id text REFERENCES promotion_reservations(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE referrals (
  id text PRIMARY KEY, program_version_id text NOT NULL REFERENCES campaign_versions(id), referrer_id text NOT NULL, referee_id text, code text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('invited','installed','qualifying','in_review','rewarded','reversed','expired')),
  qualifying_ride_id text, deadline date, stage_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON referrals (referrer_id, stage);
CREATE TABLE referral_review_cases (
  id text PRIMARY KEY, referral_id text NOT NULL REFERENCES referrals(id), signals jsonb NOT NULL, opened_at timestamptz NOT NULL DEFAULT now(), sla_hours int NOT NULL DEFAULT 24,
  decision text CHECK (decision IN ('qualify','hold','deny')), reason_code text, decided_by text, decided_at timestamptz
);
CREATE TABLE attribution_claims (
  id text PRIMARY KEY, user_id text NOT NULL, source text NOT NULL, code text, campaign text, token text, kind text NOT NULL CHECK (kind IN ('referral','campaign','unknown','organic')),
  claimed_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id)
);
CREATE TABLE driver_incentive_rules (
  id text PRIMARY KEY, campaign_version_id text NOT NULL REFERENCES campaign_versions(id), kind text NOT NULL CHECK (kind IN ('percentage_points','percent_of_commission','window')),
  base_bps int, reduction_bps int, applies_to text NOT NULL DEFAULT 'fare_only', exclusions text[] NOT NULL DEFAULT ARRAY['tips','tolls','taxes'],
  eligible_trip_cap int, money_cap_minor bigint, zones text[], starts_at timestamptz, ends_at timestamptz, cash_settlement text NOT NULL DEFAULT 'nets_against_owed',
  fleet_interaction text NOT NULL DEFAULT 'after_rebate', rounding text NOT NULL DEFAULT 'kobo_per_trip'
);
CREATE TABLE driver_incentive_postings (
  id text PRIMARY KEY, rule_id text NOT NULL REFERENCES driver_incentive_rules(id), driver_id text NOT NULL, trip_id text NOT NULL, ledger_line_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('rebate','window_waiver','rebate_reversal','milestone')), amount_minor bigint NOT NULL, currency text NOT NULL, reason_code text,
  posted_at timestamptz NOT NULL DEFAULT now(), UNIQUE (trip_id, kind)
);
