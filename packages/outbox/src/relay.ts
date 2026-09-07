/**
 * Transactional outbox relay (CLAUDE.md #2).
 *
 * Every service writes `outbox_events` rows in the same transaction as the
 * state change; this relay is the piece that actually publishes them. One pass
 * (`tick`) does the following, all inside a single database transaction so the
 * work is safe to run in many replicas at once:
 *
 *  1. Claim a bounded batch of unpublished rows, oldest-first by
 *     (`occurred_at`, `id`), with `FOR UPDATE SKIP LOCKED` so two relays never
 *     select the same row.
 *  2. Enforce per-aggregate ordering: a row is only eligible when no *earlier*
 *     still-live row exists for the same aggregate (lower `to_version`). A later
 *     event can therefore never overtake an earlier unpublished one; across
 *     different aggregates there is no ordering constraint.
 *  3. For each claimed row: rebuild and validate the envelope, publish it to the
 *     subject channel and the per-event-type channel, then stamp `published_at`
 *     on the same row.
 *
 * Failure handling:
 *  - A transient publish failure increments `attempts`, records `last_error`,
 *    and schedules an in-process capped-exponential backoff so the row is not
 *    retried in a hot loop. After `maxAttempts` the claim query stops selecting
 *    it (it is left for inspection and logged), so a poison row cannot spin.
 *  - A row whose envelope fails validation is *quarantined*: its `last_error` is
 *    recorded, `attempts` is pinned at `maxAttempts` so it is never re-claimed,
 *    and it is never published. Quarantining one row never crashes the loop nor
 *    blocks other aggregates.
 */
import type { EventEnvelope } from "@ubi/contracts";

import { backoffDelayMs } from "./backoff";
import { eventTypeChannel, subjectChannel } from "./channels";
import { envelopeFromRow, type RawOutboxRow } from "./envelope";

/** The subset of a Prisma transaction client the relay needs. */
export interface OutboxRelayTx {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

/** The subset of a Prisma client the relay needs (satisfied by PrismaClient). */
export interface OutboxRelayPrisma {
  $transaction<R>(fn: (tx: OutboxRelayTx) => Promise<R>): Promise<R>;
}

/** The subset of an ioredis client the relay needs. */
export interface OutboxPublisher {
  publish(channel: string, message: string): Promise<number>;
}

/** Structural logger; a pino instance satisfies it. */
export interface OutboxRelayLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface CreateOutboxRelayOptions {
  readonly prisma: OutboxRelayPrisma;
  readonly redis: OutboxPublisher;
  /** Maximum rows claimed per pass. Default 100. */
  readonly batchSize?: number;
  /** Give up (leave the row) after this many failed attempts. Default 8. */
  readonly maxAttempts?: number;
  /** First retry delay; doubles each failure. Default 250ms. */
  readonly backoffBaseMs?: number;
  /** Backoff ceiling. Default 30000ms. */
  readonly backoffMaxMs?: number;
  /** Delay between passes when running via start(). Default 500ms. */
  readonly pollIntervalMs?: number;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => Date;
  readonly logger?: OutboxRelayLogger;
}

export interface OutboxTickResult {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
  readonly quarantined: number;
  readonly skippedBackoff: number;
}

export interface OutboxRelay {
  /** Begin polling on an interval. Idempotent. */
  start(): void;
  /** Stop polling and wait for any in-flight pass to finish. */
  stop(): Promise<void>;
  /** Run exactly one pass. Exposed for tests and for external schedulers. */
  tick(): Promise<OutboxTickResult>;
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_BACKOFF_BASE_MS = 250;
const DEFAULT_BACKOFF_MAX_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const MAX_LAST_ERROR_LENGTH = 500;
const QUARANTINE_PREFIX = "QUARANTINE: ";

// Oldest-first, one eligible "head" per aggregate. The NOT EXISTS clause is
// what preserves per-aggregate order: a row is skipped while any earlier live
// row (lower to_version, then earlier occurred_at/id) for the same aggregate is
// still waiting or retryable. A row that has exhausted its attempts no longer
// counts as a blocker, so a stuck row cannot wedge its aggregate forever.
const CLAIM_SQL = `
SELECT
  o.id, o.name, o.schema_version, o.aggregate_type, o.aggregate_id,
  o.from_version, o.to_version, o.sequence, o.city_id,
  o.actor_type, o.actor_id, o.idempotency_key, o.correlation_id,
  o.causation_id, o.payload, o.occurred_at, o.published_at,
  o.attempts, o.last_error, o.created_at
FROM outbox_events o
WHERE o.published_at IS NULL
  AND o.attempts < $1
  AND NOT EXISTS (
    SELECT 1
    FROM outbox_events e
    WHERE e.aggregate_type = o.aggregate_type
      AND e.aggregate_id = o.aggregate_id
      AND e.published_at IS NULL
      AND e.attempts < $1
      AND (
        e.to_version < o.to_version
        OR (e.to_version = o.to_version AND e.occurred_at < o.occurred_at)
        OR (e.to_version = o.to_version AND e.occurred_at = o.occurred_at AND e.id < o.id)
      )
  )
ORDER BY o.occurred_at ASC, o.id ASC
LIMIT $2
FOR UPDATE OF o SKIP LOCKED
`;

const MARK_PUBLISHED_SQL = `
UPDATE outbox_events SET published_at = $1, last_error = NULL WHERE id = $2
`;

const RECORD_FAILURE_SQL = `
UPDATE outbox_events SET attempts = attempts + 1, last_error = $1 WHERE id = $2
`;

const QUARANTINE_SQL = `
UPDATE outbox_events SET attempts = $1, last_error = $2 WHERE id = $3
`;

const noopLogger: OutboxRelayLogger = {
  info() {
    /* no-op */
  },
  warn() {
    /* no-op */
  },
  error() {
    /* no-op */
  },
};

function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.length > MAX_LAST_ERROR_LENGTH ? raw.slice(0, MAX_LAST_ERROR_LENGTH) : raw;
}

class OutboxRelayImpl implements OutboxRelay {
  private readonly prisma: OutboxRelayPrisma;
  private readonly redis: OutboxPublisher;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly pollIntervalMs: number;
  private readonly now: () => Date;
  private readonly logger: OutboxRelayLogger;

  // Per-process retry schedule: event id -> epoch ms before which we will not
  // re-publish it. Not shared across replicas by design; SKIP LOCKED already
  // prevents double work, and another replica retrying sooner is harmless.
  private readonly backoffUntil = new Map<string, number>();

  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<unknown> = Promise.resolve();

  constructor(options: CreateOutboxRelayOptions) {
    this.prisma = options.prisma;
    this.redis = options.redis;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.backoffMaxMs = options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? noopLogger;
  }

  async tick(): Promise<OutboxTickResult> {
    const nowMs = this.now().getTime();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<RawOutboxRow[]>(
        CLAIM_SQL,
        this.maxAttempts,
        this.batchSize,
      );

      let published = 0;
      let failed = 0;
      let quarantined = 0;
      let skippedBackoff = 0;

      for (const row of rows) {
        const retryAt = this.backoffUntil.get(row.id);
        if (retryAt !== undefined && retryAt > nowMs) {
          skippedBackoff += 1;
          continue;
        }

        const parsed = envelopeFromRow(row);
        if (!parsed.ok) {
          await tx.$executeRawUnsafe(
            QUARANTINE_SQL,
            this.maxAttempts,
            `${QUARANTINE_PREFIX}${parsed.error}`.slice(0, MAX_LAST_ERROR_LENGTH),
            row.id,
          );
          this.backoffUntil.delete(row.id);
          quarantined += 1;
          this.logger.warn(
            {
              outboxId: row.id,
              eventName: row.name,
              aggregateType: row.aggregate_type,
              reason: parsed.error,
            },
            "outbox row quarantined: envelope failed validation",
          );
          continue;
        }

        try {
          await this.publishEnvelope(parsed.envelope);
          await tx.$executeRawUnsafe(MARK_PUBLISHED_SQL, this.now(), row.id);
          this.backoffUntil.delete(row.id);
          published += 1;
        } catch (err) {
          const attempts = row.attempts + 1;
          await tx.$executeRawUnsafe(RECORD_FAILURE_SQL, errorMessage(err), row.id);
          const delay = backoffDelayMs(attempts, {
            baseMs: this.backoffBaseMs,
            maxMs: this.backoffMaxMs,
          });
          this.backoffUntil.set(row.id, nowMs + delay);
          failed += 1;
          if (attempts >= this.maxAttempts) {
            this.logger.error(
              { outboxId: row.id, eventName: row.name, attempts },
              "outbox row exhausted retries; left unpublished for inspection",
            );
          } else {
            this.logger.warn(
              { outboxId: row.id, eventName: row.name, attempts, retryInMs: delay },
              "outbox publish failed; will retry after backoff",
            );
          }
        }
      }

      return { claimed: rows.length, published, failed, quarantined, skippedBackoff };
    });
  }

  private async publishEnvelope(envelope: EventEnvelope): Promise<void> {
    const message = JSON.stringify(envelope);
    await this.redis.publish(subjectChannel(envelope.subject), message);
    await this.redis.publish(eventTypeChannel(envelope.name), message);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.inFlight = this.runOnce();
    }, delayMs);
  }

  private async runOnce(): Promise<void> {
    try {
      await this.tick();
    } catch (err) {
      this.logger.error({ err: errorMessage(err) }, "outbox relay pass failed");
    } finally {
      if (this.running) this.schedule(this.pollIntervalMs);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
  }
}

export function createOutboxRelay(options: CreateOutboxRelayOptions): OutboxRelay {
  return new OutboxRelayImpl(options);
}
