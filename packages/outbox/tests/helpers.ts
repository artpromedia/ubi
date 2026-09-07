/**
 * Fixtures and wiring for the @ubi/outbox integration tests.
 *
 * These run against a real PostgreSQL database and a real Redis, because the
 * relay's guarantees only exist there: `FOR UPDATE SKIP LOCKED` is what stops
 * two replicas double-publishing a row, and the pub/sub delivery is what a
 * consumer actually dedupes. No fakes stand in for either.
 */
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { type ActorType, type SubjectType } from "@ubi/contracts";

export const TEST_DATABASE_URL =
  process.env.OUTBOX_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_outbox_test";

export const TEST_REDIS_URL =
  process.env.OUTBOX_TEST_REDIS_URL ?? "redis://127.0.0.1:6379";

export function makePrisma(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: TEST_DATABASE_URL } },
    log: ["error"],
  });
}

export function makeRedis(): Redis {
  return new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
}

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${process.pid.toString(36)}_${Date.now().toString(36)}_${counter}`;
}

/** Empty the outbox so each test starts from a known state. */
export async function truncateOutbox(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe("TRUNCATE TABLE outbox_events");
}

export interface InsertRowOptions {
  readonly id?: string;
  readonly name?: string;
  readonly aggregateType?: string;
  readonly aggregateId: string;
  readonly fromVersion?: number | null;
  readonly toVersion: number;
  readonly actorType?: string;
  readonly actorId?: string;
  readonly idempotencyKey?: string;
  readonly cityId?: string | null;
  readonly payload?: Record<string, unknown> | unknown[];
  readonly occurredAt?: Date;
  readonly sequence?: bigint | null;
}

/**
 * Inserts one `outbox_events` row exactly as a producing service would, using
 * the Prisma model. Fields default to a well-formed `ride.completed` envelope so
 * a test only has to say what it cares about (aggregate id, version, timing).
 *
 * `aggregateType` is a plain string on purpose: passing something that is not a
 * valid subject type is how a test builds a "poison" row that the relay must
 * quarantine.
 */
export async function insertRow(
  prisma: PrismaClient,
  opts: InsertRowOptions,
): Promise<string> {
  const id = opts.id ?? uid("evt");
  await prisma.outboxEvent.create({
    data: {
      id,
      name: opts.name ?? "ride.completed",
      schemaVersion: 1,
      aggregateType: opts.aggregateType ?? ("ride" satisfies SubjectType),
      aggregateId: opts.aggregateId,
      fromVersion: opts.fromVersion ?? opts.toVersion - 1,
      toVersion: opts.toVersion,
      sequence: opts.sequence ?? null,
      cityId: opts.cityId ?? "LOS",
      actorType: opts.actorType ?? ("system" satisfies ActorType),
      actorId: opts.actorId ?? "matching",
      idempotencyKey: opts.idempotencyKey ?? id,
      payload: (opts.payload ?? { rideId: opts.aggregateId }) as object,
      occurredAt: opts.occurredAt ?? new Date(),
      attempts: 0,
    },
  });
  return id;
}

export interface OutboxRowState {
  readonly id: string;
  readonly publishedAt: Date | null;
  readonly attempts: number;
  readonly lastError: string | null;
}

export async function readRow(
  prisma: PrismaClient,
  id: string,
): Promise<OutboxRowState> {
  const row = await prisma.outboxEvent.findUniqueOrThrow({
    where: { id },
    select: { id: true, publishedAt: true, attempts: true, lastError: true },
  });
  return row;
}

export interface Captured {
  readonly channel: string;
  readonly id: string;
  readonly name: string;
  readonly raw: string;
}

/**
 * A real Redis subscriber that records every message delivered on `pattern`,
 * with a `waitFor` that resolves once a predicate holds (bounded, so a missing
 * message fails the test instead of hanging).
 */
export interface Collector {
  readonly messages: Captured[];
  waitFor(predicate: (messages: Captured[]) => boolean, timeoutMs?: number): Promise<void>;
  stop(): Promise<void>;
}

export async function collect(pattern: string): Promise<Collector> {
  const sub = makeRedis();
  const messages: Captured[] = [];
  sub.on("pmessage", (_p: string, channel: string, raw: string) => {
    try {
      const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown };
      messages.push({
        channel,
        id: typeof parsed.id === "string" ? parsed.id : "",
        name: typeof parsed.name === "string" ? parsed.name : "",
        raw,
      });
    } catch {
      messages.push({ channel, id: "", name: "", raw });
    }
  });
  await sub.psubscribe(pattern);
  return {
    messages,
    async waitFor(predicate, timeoutMs = 5000): Promise<void> {
      const start = Date.now();
      while (!predicate(messages)) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(
            `collector timed out after ${timeoutMs}ms; saw ${messages.length} message(s)`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    async stop(): Promise<void> {
      await sub.punsubscribe(pattern);
      await sub.quit();
    },
  };
}

/** Wait until `predicate` holds or the timeout elapses (test-only polling). */
export async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
