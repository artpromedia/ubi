/**
 * The AI action log for ops (`/v1/ops/ai/*`), and the daily metrics rollup.
 *
 * Reads are admin-only and every read is itself audited into
 * `ai_action_access_log` (migration 012 — access audited). The log carries the
 * minimum content and no hidden reasoning or secrets; it is surfaced here exactly
 * as stored. Metrics come from `ai_model_metrics_daily`, and the "unsafe actions"
 * figure is computed from a real signal — a transactional action that completed
 * without a grant — so "must be 0" is a provable property of the data, not a
 * hard-coded zero.
 */
import { money, type Money } from "@ubi/contracts";

import type { AskDeps } from "./context";
import type { Actor, JsonRecord } from "./types";
import type { Prisma } from "@prisma/client/index";

function asJson(value: JsonRecord): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export interface AiActionView {
  readonly at: string;
  readonly actor: { readonly kind: string; readonly ref: string };
  readonly threadId?: string;
  readonly action: string;
  readonly tool?: string;
  readonly model?: string;
  readonly modelRevision?: string;
  readonly promptVersion?: string;
  readonly authRef?: string;
  readonly authKind: string;
  readonly outcome: string;
  readonly reasonCode?: string;
  readonly providerRefs: readonly string[];
  readonly tokens?: number;
  readonly cost?: Money;
}

export async function listActions(
  deps: AskDeps,
  admin: Actor,
  options: { readonly since: Date | null; readonly limit: number },
): Promise<readonly AiActionView[]> {
  const where = options.since === null ? {} : { at: { gte: options.since } };
  const rows = await deps.db.aiAction.findMany({
    where,
    orderBy: { at: "desc" },
    take: options.limit,
  });
  await deps.db.aiActionAccessLog.create({
    data: {
      adminId: admin.id,
      query: asJson({
        since: options.since === null ? null : options.since.toISOString(),
        limit: options.limit,
      }),
    },
  });
  return rows.map((row) => ({
    at: row.at.toISOString(),
    actor: { kind: row.actorKind, ref: row.actorRef },
    threadId: row.threadId ?? undefined,
    action: row.action,
    tool: row.tool ?? undefined,
    model: row.model ?? undefined,
    modelRevision: row.modelRevision ?? undefined,
    promptVersion: row.promptVersion ?? undefined,
    authRef: row.authRef ?? undefined,
    authKind: row.authKind,
    outcome: row.outcome,
    reasonCode: row.reasonCode ?? undefined,
    providerRefs: row.providerRefs,
    tokens: row.tokens ?? undefined,
    cost:
      row.costMinor === null || row.currency === null
        ? undefined
        : money(Number(row.costMinor), row.currency),
  }));
}

const TRANSACTIONAL_ACTIONS = new Set(["review.confirm", "execution.run"]);
const TURN_ACTIONS = new Set([
  "assistant.answer",
  "review.confirm",
  "execution.run",
  "loop.exhausted",
  "tool.refused",
]);

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

interface DailyBucket {
  tasks: number;
  success: number;
  unsafe: number;
  latencies: number[];
  costMinor: number;
  currency: string;
}

/**
 * Aggregates a single day of `ai_actions` into `ai_model_metrics_daily`, one row
 * per (model, revision). Idempotent: re-running for the same day overwrites the
 * rows with the recomputed figures.
 */
export async function rollupDailyMetrics(
  deps: AskDeps,
  day: Date,
): Promise<number> {
  const start = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const rows = await deps.db.aiAction.findMany({
    where: { at: { gte: start, lt: end }, model: { not: null } },
  });

  const buckets = new Map<string, DailyBucket>();
  for (const row of rows) {
    if (row.model === null) {
      continue;
    }
    const revision = row.modelRevision ?? "unknown";
    const key = `${row.model}::${revision}`;
    const bucket =
      buckets.get(key) ??
      ({
        tasks: 0,
        success: 0,
        unsafe: 0,
        latencies: [],
        costMinor: 0,
        currency: row.currency ?? "NGN",
      } satisfies DailyBucket);
    if (TURN_ACTIONS.has(row.action)) {
      bucket.tasks += 1;
    }
    if (row.outcome === "done") {
      bucket.success += 1;
    }
    if (TRANSACTIONAL_ACTIONS.has(row.action) && row.authKind !== "grant") {
      bucket.unsafe += 1;
    }
    if (row.latencyMs !== null) {
      bucket.latencies.push(row.latencyMs);
    }
    if (row.costMinor !== null) {
      bucket.costMinor += Number(row.costMinor);
    }
    buckets.set(key, bucket);
  }

  let written = 0;
  for (const [key, bucket] of buckets) {
    const [model, revision] = key.split("::");
    if (model === undefined || revision === undefined) {
      continue;
    }
    const p95 = percentile(bucket.latencies, 95);
    await deps.db.aiModelMetricsDaily.upsert({
      where: {
        day_model_modelRevision: { day: start, model, modelRevision: revision },
      },
      create: {
        day: start,
        model,
        modelRevision: revision,
        tasks: bucket.tasks,
        success: bucket.success,
        unsafeActions: bucket.unsafe,
        p95LatencyMs: p95,
        costMinor: BigInt(bucket.costMinor),
        currency: bucket.currency,
      },
      update: {
        tasks: bucket.tasks,
        success: bucket.success,
        unsafeActions: bucket.unsafe,
        p95LatencyMs: p95,
        costMinor: BigInt(bucket.costMinor),
        currency: bucket.currency,
      },
    });
    written += 1;
  }
  return written;
}

export interface ModelMetricView {
  readonly model: string;
  readonly modelRevision: string;
  readonly tasks: number;
  readonly success: number;
  readonly successRate: number;
  readonly unsafeActions: number;
  readonly p95LatencyMs: number | null;
  readonly cost: Money;
}

export interface MetricsView {
  readonly window: string;
  readonly generatedAt: string;
  readonly unsafeActionsTotal: number;
  readonly models: readonly ModelMetricView[];
}

export async function getMetrics(
  deps: AskDeps,
  admin: Actor,
  options: { readonly sinceDay: Date | null },
): Promise<MetricsView> {
  const where =
    options.sinceDay === null ? {} : { day: { gte: options.sinceDay } };
  const rows = await deps.db.aiModelMetricsDaily.findMany({
    where,
    orderBy: [{ day: "desc" }, { model: "asc" }],
  });
  await deps.db.aiActionAccessLog.create({
    data: {
      adminId: admin.id,
      query: asJson({
        kind: "metrics",
        sinceDay:
          options.sinceDay === null
            ? null
            : options.sinceDay.toISOString().slice(0, 10),
      }),
    },
  });

  const models: ModelMetricView[] = rows.map((row) => ({
    model: row.model,
    modelRevision: row.modelRevision,
    tasks: row.tasks,
    success: row.success,
    successRate: row.tasks === 0 ? 0 : row.success / row.tasks,
    unsafeActions: row.unsafeActions,
    p95LatencyMs: row.p95LatencyMs,
    cost: money(Number(row.costMinor), row.currency),
  }));
  return {
    window: options.sinceDay === null ? "all" : "since",
    generatedAt: deps.now().toISOString(),
    unsafeActionsTotal: models.reduce((sum, m) => sum + m.unsafeActions, 0),
    models,
  };
}
