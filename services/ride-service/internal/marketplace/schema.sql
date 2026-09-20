-- Slices M02/M03/M03A — negotiated-fare marketplace engine core.
--
-- These tables belong to the ride-service marketplace engine and live in their
-- own `mp` schema, applied idempotently the same way the `ride` schema is.
-- Money is BIGINT integer minor units with an explicit currency; timestamps
-- are timestamptz; every negotiable aggregate carries an optimistic `version`.
-- Events go through the shared transactional outbox (public.outbox_events) and
-- money-adjacent actions are written to public.audit_log in the same tx.

CREATE SCHEMA IF NOT EXISTS mp;

-- ---------------------------------------------------------------------------
-- Quotes: the server-priced envelope a request is published against. Bounds
-- are snapshotted here and the published amount is validated against THIS row,
-- never against numbers a client restates.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mp.quotes (
    id                 uuid PRIMARY KEY,
    requester_id       uuid NOT NULL,
    city_id            text NOT NULL,
    service            text NOT NULL,
    vehicle_class      text NOT NULL,
    currency           text NOT NULL,
    suggested_minor    bigint NOT NULL,
    min_minor          bigint NOT NULL,
    max_minor          bigint NOT NULL,
    routed_distance_m  bigint NOT NULL,
    routed_duration_sec bigint NOT NULL,
    -- The routed endpoints, pinned at pricing time: the published request's
    -- pickup/dropoff come from HERE, never restated by the client, so bounds
    -- priced for one route cannot be spent on another.
    pickup             jsonb NOT NULL,
    dropoff            jsonb NOT NULL,
    breakdown          jsonb NOT NULL DEFAULT '[]'::jsonb,
    pricing_version    text NOT NULL,
    policy_version     integer NOT NULL,
    expires_at         timestamptz NOT NULL,
    consumed_by        uuid,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_quotes_requester_idx ON mp.quotes (requester_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Requests: `state` is a state of the mpRequest machine. `revision` bumps on
-- price-affecting edits (which invalidate bids); `version` is the optimistic
-- aggregate version. The search envelope expands without bumping revision.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mp.requests (
    id                 uuid PRIMARY KEY,
    quote_id           uuid NOT NULL REFERENCES mp.quotes (id),
    requester_id       uuid NOT NULL,
    city_id            text NOT NULL,
    service            text NOT NULL,
    vehicle_class      text NOT NULL,
    currency           text NOT NULL,
    state              text NOT NULL,
    revision           integer NOT NULL DEFAULT 1,
    version            integer NOT NULL DEFAULT 1,
    requested_minor    bigint NOT NULL,
    suggested_minor    bigint NOT NULL,
    min_minor          bigint NOT NULL,
    max_minor          bigint NOT NULL,
    pickup             jsonb NOT NULL,
    dropoff            jsonb NOT NULL,
    delivery           jsonb,
    payment_method_id  text NOT NULL,
    envelope_step      integer NOT NULL DEFAULT 0,
    envelope_radius_m  integer NOT NULL,
    envelope_eta_sec   integer NOT NULL,
    policy_version     integer NOT NULL,
    pricing_version    text NOT NULL,
    expires_at         timestamptz NOT NULL,
    close_reason       text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_requests_state_expiry_idx ON mp.requests (state, expires_at);
CREATE INDEX IF NOT EXISTS mp_requests_city_state_idx ON mp.requests (city_id, state);

-- Every revision is snapshotted so the timeline can show exactly what each
-- bid was placed against.
CREATE TABLE IF NOT EXISTS mp.request_revisions (
    request_id       uuid NOT NULL REFERENCES mp.requests (id) ON DELETE CASCADE,
    revision         integer NOT NULL,
    requested_minor  bigint NOT NULL,
    quote_id         uuid NOT NULL,
    snapshot         jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (request_id, revision)
);

-- ---------------------------------------------------------------------------
-- Bids: `state` is a state of the mpBid machine; `bid_version` is the
-- optimistic version selection pins. The partial unique index is the database
-- refusing a second live bid per driver per request, whatever the app races.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mp.bids (
    id                   uuid PRIMARY KEY,
    request_id           uuid NOT NULL REFERENCES mp.requests (id) ON DELETE CASCADE,
    request_revision     integer NOT NULL,
    driver_id            uuid NOT NULL,
    state                text NOT NULL,
    bid_version          integer NOT NULL DEFAULT 1,
    amount_minor         bigint NOT NULL,
    commission_minor     bigint NOT NULL,
    net_minor            bigint NOT NULL,
    slot                 text NOT NULL,
    depends_on_claim_id  uuid,
    availability_epoch   bigint NOT NULL DEFAULT 0,
    reservation_id       text NOT NULL,
    rate_profile_version integer,
    expires_at           timestamptz NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bids_one_live_per_driver_request
    ON mp.bids (request_id, driver_id)
    WHERE state IN ('submitted', 'revised', 'selected_pending');
CREATE INDEX IF NOT EXISTS mp_bids_state_expiry_idx ON mp.bids (state, expires_at);
CREATE INDEX IF NOT EXISTS mp_bids_driver_state_idx ON mp.bids (driver_id, state);

CREATE TABLE IF NOT EXISTS mp.bid_revisions (
    bid_id           uuid NOT NULL REFERENCES mp.bids (id) ON DELETE CASCADE,
    bid_version      integer NOT NULL,
    amount_minor     bigint NOT NULL,
    commission_minor bigint NOT NULL,
    reason           text NOT NULL DEFAULT '',
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (bid_id, bid_version)
);

-- ---------------------------------------------------------------------------
-- Awards: created here for the award saga (M05, a following slice) to drive.
-- At most one live award per request, enforced by the database.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mp.awards (
    id                 uuid PRIMARY KEY,
    request_id         uuid NOT NULL REFERENCES mp.requests (id),
    bid_id             uuid NOT NULL REFERENCES mp.bids (id),
    driver_id          uuid NOT NULL,
    requester_id       uuid NOT NULL,
    state              text NOT NULL,
    request_version    integer NOT NULL,
    bid_version        integer NOT NULL,
    fare_minor         bigint NOT NULL,
    commission_minor   bigint NOT NULL,
    slot               text NOT NULL,
    execution_service  text,
    execution_id       uuid,
    capture_receipt_id text,
    fail_reason        text,
    pickup_window      jsonb,
    created_at         timestamptz NOT NULL DEFAULT now(),
    resolved_at        timestamptz,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS awards_one_live_per_request
    ON mp.awards (request_id)
    WHERE state IN ('pending', 'confirmed');

-- The award saga's durable step ledger (driven by the following slice).
CREATE TABLE IF NOT EXISTS mp.award_attempts (
    award_id      uuid PRIMARY KEY REFERENCES mp.awards (id) ON DELETE CASCADE,
    step          text NOT NULL,
    state         text NOT NULL,
    attempts      integer NOT NULL DEFAULT 0,
    last_error    text,
    next_retry_at timestamptz,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Driver claims: the shared capacity authority — one current and at most one
-- dependent next claim per driver ACROSS rides and deliveries, DB-enforced.
-- The fencing token is what execution services couple their transitions to.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS mp.claim_fencing_seq;

CREATE TABLE IF NOT EXISTS mp.driver_claims (
    id                  uuid PRIMARY KEY,
    driver_id           uuid NOT NULL,
    state               text NOT NULL,
    slot                text NOT NULL,
    service             text NOT NULL,
    award_id            uuid REFERENCES mp.awards (id),
    execution_service   text,
    execution_id        uuid,
    depends_on_claim_id uuid,
    availability_epoch  bigint NOT NULL DEFAULT 0,
    fencing_token       bigint NOT NULL DEFAULT nextval('mp.claim_fencing_seq'),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS claims_one_current_per_driver
    ON mp.driver_claims (driver_id)
    WHERE (state = 'current' OR (state = 'award_pending' AND slot = 'current'));
CREATE UNIQUE INDEX IF NOT EXISTS claims_one_next_per_driver
    ON mp.driver_claims (driver_id)
    WHERE (state = 'next' OR (state = 'award_pending' AND slot = 'next'));

-- ---------------------------------------------------------------------------
-- Rate profiles: versioned and append-only. Saving a new version never touches
-- outstanding bids; it only shapes future calculations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mp.rate_profiles (
    id             uuid PRIMARY KEY,
    driver_id      uuid NOT NULL,
    city_id        text NOT NULL,
    service        text NOT NULL,
    vehicle_class  text NOT NULL,
    currency       text NOT NULL,
    version        integer NOT NULL,
    per_km_minor   bigint NOT NULL,
    min_trip_minor bigint NOT NULL,
    components     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (driver_id, city_id, service, vehicle_class, version)
);

-- ---------------------------------------------------------------------------
-- Reservation recovery: a wallet reservation whose bid transaction failed, or
-- a release/adjust that could not be delivered, is written down here and the
-- sweep retries it until the wallet answers. Money is never "probably fine".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mp.reservation_recovery (
    id             uuid PRIMARY KEY,
    reservation_id text NOT NULL,
    driver_id      uuid NOT NULL,
    bid_id         uuid,
    action         text NOT NULL,
    amount_minor   bigint,
    attempts       integer NOT NULL DEFAULT 0,
    last_error     text,
    next_retry_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_reservation_recovery_due_idx
    ON mp.reservation_recovery (next_retry_at) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- Idempotency: mirrors ride.idempotency_keys — the original response is stored
-- and replayed byte-for-byte; key reuse with a different body is a conflict.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mp.idempotency_keys (
    scope        text NOT NULL,
    actor_id     uuid NOT NULL,
    key          text NOT NULL,
    request_hash text NOT NULL,
    status_code  integer NOT NULL,
    response     jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, actor_id, key)
);
