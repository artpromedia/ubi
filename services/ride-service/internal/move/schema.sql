-- Slice 02 — Move core lockstep.
--
-- These tables belong to the ride-service and live in their own `ride` schema.
-- The Prisma `public.rides` table cannot carry this slice: its RideStatus enum
-- has no rematching / pin_verification / no_driver / safety_hold state, it has
-- no pinned city config version, no signed quote, no offer history and no
-- aggregate version for ETags. Rather than silently widen a table another
-- service owns, the lockstep state lives here and is reported as a schema gap.
--
-- Events are published through the shared transactional outbox
-- (public.outbox_events) and every operator action is written to
-- public.audit_log, so nothing here is a private side channel.

CREATE SCHEMA IF NOT EXISTS ride;

-- ---------------------------------------------------------------------------
-- Quotes: server-authoritative and signed. A client can neither move the fare
-- nor the expiry, because both are stored here and re-checked on use.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ride.quotes (
    id               uuid PRIMARY KEY,
    city_id          text NOT NULL,
    config_version   integer NOT NULL,
    rider_id         uuid NOT NULL,
    vehicle_class    text NOT NULL,
    pickup_lat       double precision NOT NULL,
    pickup_lng       double precision NOT NULL,
    pickup_address   text NOT NULL DEFAULT '',
    dropoff_lat      double precision NOT NULL,
    dropoff_lng      double precision NOT NULL,
    dropoff_address  text NOT NULL DEFAULT '',
    stops            jsonb NOT NULL DEFAULT '[]'::jsonb,
    distance_meters  bigint NOT NULL,
    duration_seconds bigint NOT NULL,
    fare_minor       bigint NOT NULL,
    currency         text NOT NULL,
    breakdown        jsonb NOT NULL,
    expires_at       timestamptz NOT NULL,
    consumed_by      uuid,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotes_rider_created_idx ON ride.quotes (rider_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Rides: `state` is a state of the rider machine in contracts/state-machines.json.
-- `version` is the aggregate version used for ETags and outbox from/to versions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ride.rides (
    id                 uuid PRIMARY KEY,
    city_id            text NOT NULL,
    config_version     integer NOT NULL,
    quote_id           uuid NOT NULL REFERENCES ride.quotes (id),
    rider_id           uuid NOT NULL,
    driver_id          uuid,
    state              text NOT NULL,
    version            integer NOT NULL DEFAULT 1,
    active             boolean NOT NULL DEFAULT true,
    vehicle_class      text NOT NULL,
    payment_method_id  text NOT NULL,
    pickup_lat         double precision NOT NULL,
    pickup_lng         double precision NOT NULL,
    pickup_address     text NOT NULL DEFAULT '',
    dropoff_lat        double precision NOT NULL,
    dropoff_lng        double precision NOT NULL,
    dropoff_address    text NOT NULL DEFAULT '',
    quoted_fare_minor  bigint NOT NULL,
    final_fare_minor   bigint,
    wait_fee_minor     bigint NOT NULL DEFAULT 0,
    currency           text NOT NULL,
    pin_hash           bytea NOT NULL,
    pin_attempts       integer NOT NULL DEFAULT 0,
    pin_locked         boolean NOT NULL DEFAULT false,
    pin_verified_at    timestamptz,
    dispatch_ring      integer NOT NULL DEFAULT 0,
    dispatch_rounds    integer NOT NULL DEFAULT 0,
    assigned_at        timestamptz,
    arrived_at         timestamptz,
    started_at         timestamptz,
    completed_at       timestamptz,
    cancelled_at       timestamptz,
    cancelled_by_role  text,
    cancel_reason_code text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- One live ride per rider and one live ride per driver. The partial unique
-- index is the database's own refusal of a double assignment; it does not
-- depend on any application lock being taken.
CREATE UNIQUE INDEX IF NOT EXISTS rides_one_active_per_rider
    ON ride.rides (rider_id) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS rides_one_active_per_driver
    ON ride.rides (driver_id) WHERE active AND driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rides_dispatchable_idx
    ON ride.rides (state, updated_at) WHERE active;

-- ---------------------------------------------------------------------------
-- Offers: every offer and every response is persisted so the ops timeline can
-- show them (slice 02 / board 4b). Nothing about a dispatch lives only in RAM.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ride.offers (
    id              uuid PRIMARY KEY,
    ride_id         uuid NOT NULL REFERENCES ride.rides (id) ON DELETE CASCADE,
    driver_id       uuid NOT NULL,
    ring            integer NOT NULL,
    radius_meters   integer NOT NULL,
    distance_meters double precision NOT NULL,
    eta_seconds     bigint NOT NULL,
    state           text NOT NULL,
    reason          text,
    expires_at      timestamptz NOT NULL,
    responded_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- A ride is offered to a driver at most once, and at most one offer per ride
-- may ever reach `accepted`. Concurrent accepts collide here.
CREATE UNIQUE INDEX IF NOT EXISTS offers_ride_driver_uniq ON ride.offers (ride_id, driver_id);
CREATE UNIQUE INDEX IF NOT EXISTS offers_one_accepted_per_ride
    ON ride.offers (ride_id) WHERE state = 'accepted';
CREATE INDEX IF NOT EXISTS offers_live_idx ON ride.offers (state, expires_at);
CREATE INDEX IF NOT EXISTS offers_driver_idx ON ride.offers (driver_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Driver sessions: `state` is a state of the driver machine in
-- contracts/state-machines.json. Location is kept here as the durable record;
-- Redis holds the same point only as a geospatial index.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ride.driver_sessions (
    driver_id        uuid PRIMARY KEY,
    city_id          text NOT NULL,
    state            text NOT NULL,
    version          integer NOT NULL DEFAULT 1,
    vehicle_classes  jsonb NOT NULL DEFAULT '[]'::jsonb,
    filters          jsonb NOT NULL DEFAULT '{}'::jsonb,
    current_ride_id  uuid,
    last_seq         bigint NOT NULL DEFAULT 0,
    last_lat         double precision,
    last_lng         double precision,
    last_accuracy_m  double precision,
    last_location_at timestamptz,
    online_since     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_sessions_available_idx
    ON ride.driver_sessions (city_id, state, last_location_at);

-- ---------------------------------------------------------------------------
-- Idempotency: the original response is stored so a replay is byte-identical.
-- The request fingerprint makes key reuse with a different body a conflict
-- rather than a silently different answer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ride.idempotency_keys (
    scope        text NOT NULL,
    actor_id     uuid NOT NULL,
    key          text NOT NULL,
    request_hash text NOT NULL,
    status_code  integer NOT NULL,
    response     jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, actor_id, key)
);
