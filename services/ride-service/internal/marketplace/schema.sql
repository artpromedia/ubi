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

-- ---------------------------------------------------------------------------
-- Post-review additions (idempotent, applied to existing databases too).
--   * reservation_recovery.payload carries the full replay payload for the
--     reserve_replay (unknown-outcome reserve) and settle actions.
--   * bids.hold_released_at is the financial confirmation of the hold's
--     release: the driver view says `released` only once this is set.
--   * award_attempts.captured records, durably and BEFORE any reversal is
--     driven, whether the compensation being recorded covers a captured fee.
-- ---------------------------------------------------------------------------
ALTER TABLE mp.reservation_recovery ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE mp.bids ADD COLUMN IF NOT EXISTS hold_released_at timestamptz;
ALTER TABLE mp.award_attempts ADD COLUMN IF NOT EXISTS captured boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Secure pickup-PIN vault (G07 companion).
--
-- A marketplace execution ride's PIN is bcrypt-hashed in ride.rides (move owns
-- that; the plaintext cannot be re-derived). The current-slot award reveals it
-- once in the /select response, but a PROMOTION-created ride happens with no
-- rider call in flight, so the rider must be able to fetch it afterwards over
-- the authenticated REST channel. This table captures the plaintext at ride
-- creation, ENCRYPTED at rest (AES-256-GCM; the key is derived from the service
-- secret, never stored here), so a database reader still cannot read a usable
-- PIN — the same posture bcrypt gives the hash. Retrieval is owner-only,
-- lifecycle-restricted (checked live against ride state) and rate-limited via
-- the window columns. The PIN never enters an event, a push payload or a log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mp.execution_pins (
    execution_id    uuid PRIMARY KEY,
    request_id      uuid NOT NULL,
    requester_id    uuid NOT NULL,
    ciphertext      bytea NOT NULL,
    nonce           bytea NOT NULL,
    expires_at      timestamptz NOT NULL,
    retrieval_count integer NOT NULL DEFAULT 0,
    window_start    timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_execution_pins_request_idx
    ON mp.execution_pins (request_id);

-- ---------------------------------------------------------------------------
-- Driver standing & appeals (C08).
--
-- An admin-workflow aggregate, not part of any negotiated-fare machine: it
-- never adjusts money and is never written by anything but the standing
-- commands in standing.go. `warning` is informational and commits on the
-- one admin's say-so; `suspension` and `reinstatement` are PROTECTED — they
-- change a driver's marketplace eligibility (see EvaluateEligibility) and
-- require a second, distinct operator's approval before they take effect
-- (maker-checker, mirroring config-service's change-request pattern). An
-- active suspension can be appealed; the appeal decision is ALSO
-- maker-checker (the operator who logged the appeal cannot decide it).
-- Every proposal, approval, rejection and appeal decision writes one
-- public.audit_log row in the same transaction — there is no unaudited path.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mp.driver_standing_actions (
    id                 uuid PRIMARY KEY,
    driver_id          uuid NOT NULL,
    city_id            text NOT NULL,
    action_type        text NOT NULL, -- warning | suspension | reinstatement
    reason_code        text NOT NULL,
    reason_note        text NOT NULL DEFAULT '',
    status             text NOT NULL, -- pending_approval | active | rejected | appealed | appeal_upheld | appeal_denied
    proposed_by        uuid NOT NULL,
    proposed_at        timestamptz NOT NULL DEFAULT now(),
    decided_by         uuid,
    decided_at         timestamptz,
    decision_reason    text,
    appealed_by        uuid,
    appealed_at        timestamptz,
    appeal_note        text,
    appeal_decided_by  uuid,
    appeal_decided_at  timestamptz,
    appeal_reason      text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_standing_driver_idx
    ON mp.driver_standing_actions (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mp_standing_status_idx
    ON mp.driver_standing_actions (status, created_at ASC);

-- ---------------------------------------------------------------------------
-- Multiple stops (A02), additive and idempotent.
--
--   * quotes.stops / requests.stops hold the ORDERED intermediate stops, each
--     with a stable server-assigned stopId, its 1-based order, lat/lng, label,
--     purpose and expected dwell. '[]' is the plain pickup → dropoff route, so
--     every existing row reads exactly as before.
--   * stops_dwell_sec is the total expected dwell the quote priced as route
--     time; route_fingerprint names the exact stop set (and endpoints) the
--     bounds were priced for. A request inherits both from the quote it was
--     published or revised against — never from anything a client restates.
--   * requests.route_revision bumps only when a revision changes the stop set.
--     The request `revision` still bumps on EVERY price- or route-affecting
--     edit and remains the one counter bids are pinned to, so a bid placed on
--     an obsolete route is invalidated and can never be selected.
--   * requests.routed_distance_m / routed_duration_sec carry the priced
--     route's metrics so the driver card can state them without a quote read.
-- ---------------------------------------------------------------------------
ALTER TABLE mp.quotes ADD COLUMN IF NOT EXISTS stops jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE mp.quotes ADD COLUMN IF NOT EXISTS stops_dwell_sec bigint NOT NULL DEFAULT 0;
ALTER TABLE mp.quotes ADD COLUMN IF NOT EXISTS route_fingerprint text NOT NULL DEFAULT '';
ALTER TABLE mp.requests ADD COLUMN IF NOT EXISTS stops jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE mp.requests ADD COLUMN IF NOT EXISTS route_revision integer NOT NULL DEFAULT 1;
ALTER TABLE mp.requests ADD COLUMN IF NOT EXISTS route_fingerprint text NOT NULL DEFAULT '';
ALTER TABLE mp.requests ADD COLUMN IF NOT EXISTS routed_distance_m bigint NOT NULL DEFAULT 0;
ALTER TABLE mp.requests ADD COLUMN IF NOT EXISTS routed_duration_sec bigint NOT NULL DEFAULT 0;
ALTER TABLE mp.requests ADD COLUMN IF NOT EXISTS stops_dwell_sec bigint NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Driver preferences (A04.2), additive and idempotent.
--
-- A driver's marketplace preferences in one city, versioned and append-only
-- exactly like mp.rate_profiles (the per-km rate and the minimum trip FARE
-- stay there, per service/vehicle class). A PATCH writes the next version;
-- the UNIQUE (driver_id, city_id, version) key is the optimistic-concurrency
-- authority, so two PATCHes against the same version cannot both land.
--
-- Preferences FILTER and RANK the driver's feed and pre-fill suggested offers.
-- They are never eligibility (EvaluateEligibility does not read this table)
-- and nothing reads them to place a bid: manual stationary bidding stays the
-- only way an offer exists.
--
--   * min_trip_amount_minor: hide requests whose MAXIMUM fare cannot reach it
--     (NULL = no minimum). Integer minor units in `currency` (the city's).
--   * max_pickup_distance_m: hide requests whose pickup is farther (NULL = the
--     request's own search envelope decides; a preference never widens it).
--   * accepts_deliveries / accepts_stops / max_stops: multi-stop and delivery
--     willingness (max_stops NULL = the market's limit).
--   * homeward: {lat, lng, radiusMeters, label} — the driver's OWN return
--     area (NULL = none); homeward_only hides everything not ending there.
--     Matching uses the dropoff's coarse area cell, never its coordinate.
--   * availability: [{day, startMinute, endMinute}] in the city's local
--     time. Filters advance-booking cards in the feed (A03) — never
--     eligibility.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mp.driver_preferences (
    id                     uuid PRIMARY KEY,
    driver_id              uuid NOT NULL,
    city_id                text NOT NULL,
    version                integer NOT NULL,
    currency               text NOT NULL,
    min_trip_amount_minor  bigint,
    max_pickup_distance_m  integer,
    accepts_deliveries     boolean NOT NULL DEFAULT true,
    accepts_stops          boolean NOT NULL DEFAULT true,
    max_stops              integer,
    homeward               jsonb,
    homeward_only          boolean NOT NULL DEFAULT false,
    availability           jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT driver_preferences_version_key UNIQUE (driver_id, city_id, version),
    CONSTRAINT driver_preferences_min_trip_positive CHECK (min_trip_amount_minor IS NULL OR min_trip_amount_minor > 0),
    CONSTRAINT driver_preferences_pickup_positive CHECK (max_pickup_distance_m IS NULL OR max_pickup_distance_m > 0),
    CONSTRAINT driver_preferences_stops_nonnegative CHECK (max_stops IS NULL OR max_stops >= 0)
);

-- ---------------------------------------------------------------------------
-- Post-award trip amendments + server-authoritative stop events (A02 items
-- 4-7), additive and idempotent.
--
--   * execution_routes is the COMMITTED terms of one awarded execution: the
--     route (pickup, ordered stops, dropoff) and route revision, the agreed
--     fare and fare revision, the commission captured so far, what the
--     rider's funding covers, and the award's pricing snapshot (the city
--     config version its quote was priced under — deltas are priced under it,
--     never under today's policy) and paid-waiting terms. Created lazily from
--     the award on first use, so an award that never amends or reports a stop
--     reads exactly as before. The original agreement stays in force until an
--     amendment COMMITS; only committed adjustments ever change this row.
--   * execution_stops is each stop's server-authoritative state: arrival
--     (geofenced, disputed when outside the fence), the paid-waiting clock
--     (started only by a confirmed arrival), departure/skip, and the waiting
--     fee finalised at departure and settled through the amendment path.
--   * amendments is the mpAmendment aggregate; `money_open` is true while
--     payment-service may hold anything for it (a reserved increment or
--     top-up, a commit in flight, a compensation or release owed), and the
--     partial unique index is the database refusing a second amendment with
--     open money per award — payment-service's own one-open rule, mirrored.
--   * amendment_history is append-only (an UPDATE is refused by trigger):
--     every transition and approval, with the revisions it was bound to.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mp.execution_routes (
    award_id                  uuid PRIMARY KEY REFERENCES mp.awards (id),
    request_id                uuid NOT NULL,
    execution_id              uuid NOT NULL,
    requester_id              uuid NOT NULL,
    driver_id                 uuid NOT NULL,
    city_id                   text NOT NULL,
    service                   text NOT NULL,
    vehicle_class             text NOT NULL,
    currency                  text NOT NULL,
    payment_method_id         text NOT NULL,
    reservation_id            text NOT NULL,
    config_version            integer NOT NULL,
    policy_version            integer NOT NULL,
    route_revision            integer NOT NULL DEFAULT 1,
    fare_revision             integer NOT NULL DEFAULT 1,
    original_fare_minor       bigint NOT NULL,
    agreed_fare_minor         bigint NOT NULL,
    captured_commission_minor bigint NOT NULL,
    funded_minor              bigint NOT NULL,
    pickup                    jsonb NOT NULL,
    dropoff                   jsonb NOT NULL,
    stops                     jsonb NOT NULL DEFAULT '[]'::jsonb,
    waiting_terms             jsonb NOT NULL,
    waiting_cap_minor         bigint NOT NULL DEFAULT 0,
    cap_revision              integer NOT NULL DEFAULT 1,
    waiting_committed_minor   bigint NOT NULL DEFAULT 0,
    terminated_at             timestamptz,
    version                   integer NOT NULL DEFAULT 1,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT execution_routes_money_nonnegative CHECK (
        agreed_fare_minor > 0 AND captured_commission_minor >= 0 AND funded_minor >= 0
        AND waiting_cap_minor >= 0 AND waiting_committed_minor >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS execution_routes_execution_uniq
    ON mp.execution_routes (execution_id);

CREATE TABLE IF NOT EXISTS mp.execution_stops (
    award_id              uuid NOT NULL REFERENCES mp.execution_routes (award_id) ON DELETE CASCADE,
    stop_id               uuid NOT NULL,
    execution_id          uuid NOT NULL,
    stop_order            integer NOT NULL,
    state                 text NOT NULL, -- pending | arrived | departed | skipped | removed
    lat                   double precision NOT NULL,
    lng                   double precision NOT NULL,
    label                 text NOT NULL DEFAULT '',
    purpose               text NOT NULL,
    dwell_sec             integer NOT NULL,
    arrived_at            timestamptz,
    arrival_distance_m    integer,
    arrival_accuracy_m    double precision,
    arrival_disputed      boolean NOT NULL DEFAULT false,
    wait_started_at       timestamptz,
    departed_at           timestamptz,
    skipped_at            timestamptz,
    skip_reason           text,
    waiting_fee_minor     bigint NOT NULL DEFAULT 0,
    waiting_settlement    text NOT NULL DEFAULT 'none', -- none | pending | committed | failed
    waiting_amendment_id  uuid,
    version               integer NOT NULL DEFAULT 1,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (award_id, stop_id),
    CONSTRAINT execution_stops_fee_nonnegative CHECK (waiting_fee_minor >= 0)
);

CREATE INDEX IF NOT EXISTS mp_execution_stops_waiting_idx
    ON mp.execution_stops (state, waiting_settlement);

CREATE TABLE IF NOT EXISTS mp.amendments (
    id                       uuid PRIMARY KEY,
    award_id                 uuid NOT NULL REFERENCES mp.execution_routes (award_id),
    request_id               uuid NOT NULL,
    execution_id             uuid NOT NULL,
    city_id                  text NOT NULL,
    kind                     text NOT NULL, -- route | stop_waiting | early_termination
    state                    text NOT NULL,
    proposed_by              text NOT NULL,
    proposed_by_role         text NOT NULL,
    base_route_revision      integer NOT NULL,
    base_fare_revision       integer NOT NULL,
    route_revision           integer NOT NULL,
    fare_revision            integer NOT NULL,
    stops                    jsonb NOT NULL DEFAULT '[]'::jsonb,
    dropoff                  jsonb NOT NULL,
    currency                 text NOT NULL,
    prior_fare_minor         bigint NOT NULL,
    revised_fare_minor       bigint NOT NULL,
    prior_commission_minor   bigint NOT NULL,
    revised_commission_minor bigint NOT NULL,
    prior_funded_minor       bigint NOT NULL,
    revised_funded_minor     bigint NOT NULL,
    added_distance_m         bigint NOT NULL DEFAULT 0,
    added_duration_sec       bigint NOT NULL DEFAULT 0,
    pricing                  jsonb NOT NULL DEFAULT '{}'::jsonb,
    reference_stop_id        uuid,
    rider_approved_at        timestamptz,
    driver_approved_at       timestamptz,
    expires_at               timestamptz NOT NULL,
    step                     text NOT NULL,
    step_state               text NOT NULL,
    attempts                 integer NOT NULL DEFAULT 0,
    last_error               text,
    next_retry_at            timestamptz,
    funding_done             boolean NOT NULL DEFAULT false,
    commission_done          boolean NOT NULL DEFAULT false,
    money_open               boolean NOT NULL DEFAULT true,
    reason                   text,
    version                  integer NOT NULL DEFAULT 1,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    resolved_at              timestamptz,
    CONSTRAINT amendments_money_positive CHECK (revised_fare_minor > 0 AND prior_fare_minor > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS amendments_one_open_per_award
    ON mp.amendments (award_id) WHERE money_open;
CREATE INDEX IF NOT EXISTS mp_amendments_award_idx
    ON mp.amendments (award_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mp_amendments_due_idx
    ON mp.amendments (next_retry_at) WHERE money_open;

CREATE TABLE IF NOT EXISTS mp.amendment_history (
    id              bigserial PRIMARY KEY,
    amendment_id    uuid NOT NULL REFERENCES mp.amendments (id) ON DELETE CASCADE,
    award_id        uuid NOT NULL,
    event           text NOT NULL,
    from_state      text,
    to_state        text NOT NULL,
    actor_role      text NOT NULL,
    actor_id        text NOT NULL,
    route_revision  integer NOT NULL,
    fare_revision   integer NOT NULL,
    detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_amendment_history_amendment_idx
    ON mp.amendment_history (amendment_id, id);

CREATE OR REPLACE FUNCTION mp.refuse_history_update() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'mp.amendment_history is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS amendment_history_append_only ON mp.amendment_history;
CREATE TRIGGER amendment_history_append_only
    BEFORE UPDATE ON mp.amendment_history
    FOR EACH ROW EXECUTE FUNCTION mp.refuse_history_update();

-- ---------------------------------------------------------------------------
-- Book for Later (A03), additive and idempotent. Two explicitly different
-- products plus recurring templates — and a naming rule: "reservation" in
-- this schema already means the WALLET funding/commission reservation
-- (mp.reservation_recovery), so the new concepts are named distinctly.
--
--   * scheduled_requests is a STORED INTENT that no driver is committed to:
--     pickup as a local date + local time + IANA timezone, the resolved UTC
--     instant and the DST resolution applied, a pickup window, the rider's
--     approved maximum fare and the route (stops included). A durable worker
--     publishes it as an ordinary mp.requests row at publish_at (the market's
--     lead time), refreshing routing, bounds and funding; terms outside the
--     approval park it in needs_rider_approval instead. It is ALSO the
--     occurrence row of a recurring template: (template_id, occurrence_date)
--     is unique, so a replayed generation can never create a duplicate.
--   * recurring_templates is the series, stored apart from its occurrences.
--   * advance_bookings is the BOOKING CALENDAR of advance driver
--     reservations — separate from mp.driver_claims (the live current/next
--     slots), which a booking only enters at activation near pickup. Each
--     booking occupies [window_start − pre buffer, window_end + routed trip +
--     post buffer); btree_gist exclusion constraints refuse two committed
--     bookings of one driver (and, once the fleet slice supplies vehicle
--     identity, of one vehicle) whose intervals overlap, whatever the app
--     races. The travel time between consecutive bookings is checked on top,
--     under a per-driver transaction lock.
--   * requests gain the booking kind (immediate | scheduled | advance), the
--     pickup window and the resolved schedule of a future pickup.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE mp.requests ADD COLUMN IF NOT EXISTS booking_kind text NOT NULL DEFAULT 'immediate';
ALTER TABLE mp.requests ADD COLUMN IF NOT EXISTS pickup_window_start timestamptz;
ALTER TABLE mp.requests ADD COLUMN IF NOT EXISTS pickup_window_end timestamptz;
ALTER TABLE mp.requests ADD COLUMN IF NOT EXISTS pickup_schedule jsonb;
ALTER TABLE mp.requests ADD COLUMN IF NOT EXISTS scheduled_request_id uuid;

CREATE INDEX IF NOT EXISTS mp_requests_booking_kind_idx
    ON mp.requests (booking_kind, state) WHERE booking_kind <> 'immediate';

CREATE TABLE IF NOT EXISTS mp.recurring_templates (
    id                 uuid PRIMARY KEY,
    requester_id       uuid NOT NULL,
    city_id            text NOT NULL,
    product            text NOT NULL,
    service            text NOT NULL,
    vehicle_class      text NOT NULL,
    currency           text NOT NULL,
    state              text NOT NULL,
    version            integer NOT NULL DEFAULT 1,
    pickup             jsonb NOT NULL,
    dropoff            jsonb NOT NULL,
    stops              jsonb NOT NULL DEFAULT '[]'::jsonb,
    payment_method_id  text NOT NULL,
    requested_minor    bigint NOT NULL,
    max_fare_minor     bigint NOT NULL,
    days_of_week       text[] NOT NULL,
    local_time         text NOT NULL,
    time_zone          text NOT NULL,
    window_sec         integer NOT NULL,
    dst_disambiguation text NOT NULL,
    starts_on          date NOT NULL,
    ends_on            date,
    generated_through  date,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recurring_templates_product CHECK (product IN ('scheduled_request', 'advance_reservation')),
    CONSTRAINT recurring_templates_money CHECK (requested_minor > 0 AND max_fare_minor >= requested_minor),
    CONSTRAINT recurring_templates_days CHECK (cardinality(days_of_week) BETWEEN 1 AND 7),
    CONSTRAINT recurring_templates_series CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS mp_recurring_templates_active_idx
    ON mp.recurring_templates (state, generated_through) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS mp_recurring_templates_requester_idx
    ON mp.recurring_templates (requester_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mp.scheduled_requests (
    id                 uuid PRIMARY KEY,
    product            text NOT NULL,
    requester_id       uuid NOT NULL,
    city_id            text NOT NULL,
    service            text NOT NULL,
    vehicle_class      text NOT NULL,
    currency           text NOT NULL,
    state              text NOT NULL,
    version            integer NOT NULL DEFAULT 1,
    pickup             jsonb NOT NULL,
    dropoff            jsonb NOT NULL,
    stops              jsonb NOT NULL DEFAULT '[]'::jsonb,
    payment_method_id  text NOT NULL,
    requested_minor    bigint NOT NULL,
    max_fare_minor     bigint NOT NULL,
    local_date         date NOT NULL,
    local_time         text NOT NULL,
    time_zone          text NOT NULL,
    utc_offset_sec     integer NOT NULL,
    dst_resolution     text NOT NULL,
    window_sec         integer NOT NULL,
    pickup_at          timestamptz NOT NULL,
    window_end         timestamptz NOT NULL,
    publish_at         timestamptz NOT NULL,
    template_id        uuid REFERENCES mp.recurring_templates (id),
    occurrence_date    date,
    request_id         uuid,
    approval           jsonb,
    reminders_sent     integer[] NOT NULL DEFAULT '{}',
    attempts           integer NOT NULL DEFAULT 0,
    next_attempt_at    timestamptz,
    last_error         text,
    close_reason       text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT scheduled_requests_product CHECK (product IN ('scheduled_request', 'advance_reservation')),
    CONSTRAINT scheduled_requests_money CHECK (requested_minor > 0 AND max_fare_minor >= requested_minor),
    CONSTRAINT scheduled_requests_window CHECK (window_end > pickup_at),
    CONSTRAINT scheduled_requests_occurrence CHECK ((template_id IS NULL) = (occurrence_date IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_requests_one_per_occurrence
    ON mp.scheduled_requests (template_id, occurrence_date) WHERE template_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_requests_one_per_request
    ON mp.scheduled_requests (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mp_scheduled_requests_due_idx
    ON mp.scheduled_requests (state, publish_at);
CREATE INDEX IF NOT EXISTS mp_scheduled_requests_requester_idx
    ON mp.scheduled_requests (requester_id, pickup_at);

CREATE TABLE IF NOT EXISTS mp.advance_bookings (
    id                     uuid PRIMARY KEY,
    award_id               uuid NOT NULL REFERENCES mp.awards (id),
    request_id             uuid NOT NULL REFERENCES mp.requests (id),
    bid_id                 uuid NOT NULL,
    driver_id              uuid NOT NULL,
    requester_id           uuid NOT NULL,
    -- NULL until the fleet slice (A05) supplies a vehicle identity for the
    -- driver; the vehicle exclusion constraint applies once it is set.
    vehicle_id             text,
    city_id                text NOT NULL,
    state                  text NOT NULL,
    version                integer NOT NULL DEFAULT 1,
    funding_state          text NOT NULL DEFAULT 'pending',
    payment_method_id      text NOT NULL,
    currency               text NOT NULL,
    fare_minor             bigint NOT NULL,
    commission_minor       bigint NOT NULL,
    window_start           timestamptz NOT NULL,
    window_end             timestamptz NOT NULL,
    trip_duration_sec      bigint NOT NULL,
    occupied               tstzrange NOT NULL,
    pickup                 jsonb NOT NULL,
    dropoff                jsonb NOT NULL,
    funding_due_at         timestamptz NOT NULL,
    funding_deadline       timestamptz NOT NULL,
    reconfirm_opens_at     timestamptz NOT NULL,
    reconfirm_deadline     timestamptz NOT NULL,
    activation_at          timestamptz NOT NULL,
    activation_deadline    timestamptz NOT NULL,
    reconfirm_requested_at timestamptz,
    reconfirmed_at         timestamptz,
    activated_at           timestamptz,
    activated_slot         text,
    claim_id               uuid,
    reminders_sent         integer[] NOT NULL DEFAULT '{}',
    failure                jsonb,
    rematch_request_id     uuid,
    attempts               integer NOT NULL DEFAULT 0,
    next_attempt_at        timestamptz,
    last_error             text,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT advance_bookings_award_uniq UNIQUE (award_id),
    CONSTRAINT advance_bookings_window CHECK (window_end > window_start AND NOT isempty(occupied)),
    CONSTRAINT advance_bookings_money CHECK (fare_minor > 0 AND commission_minor >= 0),
    CONSTRAINT advance_bookings_no_overlap EXCLUDE USING gist (driver_id WITH =, occupied WITH &&)
        WHERE (state IN ('held', 'payment_pending', 'confirmed', 'reconfirmed', 'activated')),
    CONSTRAINT advance_bookings_vehicle_no_overlap EXCLUDE USING gist (vehicle_id WITH =, occupied WITH &&)
        WHERE (vehicle_id IS NOT NULL AND state IN ('held', 'payment_pending', 'confirmed', 'reconfirmed', 'activated'))
);

CREATE INDEX IF NOT EXISTS mp_advance_bookings_driver_idx
    ON mp.advance_bookings (driver_id, window_start);
CREATE INDEX IF NOT EXISTS mp_advance_bookings_requester_idx
    ON mp.advance_bookings (requester_id, window_start);
CREATE INDEX IF NOT EXISTS mp_advance_bookings_due_idx
    ON mp.advance_bookings (state, window_start);
