/**
 * Notification Dead-Letter Queue (DLQ) Ops Routes (CC-A15 / P2-04).
 *
 * Exposes read, detail, idempotent replay, and audited discard endpoints over
 * `notif:mp:dlq` (marketplace push + SMS fallback dead letters) and
 * `notif:trip_access:dlq` (guest trip-link SMS dead letters).
 *
 * Privacy & security guarantees:
 * - Never returns raw phone numbers, access tokens, or sealed ciphertext.
 * - Every replay and discard action writes an AuditLog row.
 * - Replay is idempotent: replaying an already-replayed item returns 200
 *   `idempotent: true` without re-delivering.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { redis as defaultRedis } from "../lib/redis.js";
import {
  buildMarketplacePushPorts,
  deterministicMpDlqId,
  type PushPortOverrides,
} from "../marketplace/consumer.js";
import {
  MarketplacePushDeliverer,
  type DeadLetterEntry,
} from "../marketplace/push.js";
import { opsOnly } from "../middleware/auth.js";
import {
  buildTripAccessPorts,
  deterministicTripAccessDlqId,
  loadTripAccessConfig,
} from "../trip-access/consumer.js";
import {
  TripAccessSmsDeliverer,
  type TripAccessDeadLetter,
} from "../trip-access/deliverer.js";

import type { SmsSender } from "../providers/sms.js";
import type { Prisma } from "@prisma/client";
import type { EventEnvelope } from "@ubi/contracts";
import type { Redis } from "ioredis";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const listQuerySchema = z.object({
  queue: z
    .enum(["all", "marketplace", "trip_access"])
    .optional()
    .default("all"),
  status: z
    .enum(["all", "pending", "replayed", "discarded"])
    .optional()
    .default("pending"),
  eventName: z.string().trim().optional(),
  role: z.string().trim().optional(),
  reason: z.string().trim().optional(),
  since: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const discardBodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export interface SanitizedDlqItem {
  readonly id: string;
  readonly queue: "marketplace" | "trip_access";
  readonly status: "pending" | "replayed" | "discarded";
  readonly eventId: string;
  readonly eventName: string;
  readonly userId: string | null;
  readonly role: string | null;
  readonly channel: "push" | "sms";
  readonly attempts: number;
  readonly reason: string;
  readonly tokenId: string | null;
  readonly requestId: string | null;
  readonly maskedPhone: string | null;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly cityId: string | null;
  readonly replayable: boolean;
  readonly at: string | null;
  readonly replayedAt: string | null;
  readonly replayedBy: string | null;
  readonly replayOutcome: string | null;
  readonly discardedAt: string | null;
  readonly discardedBy: string | null;
  readonly discardReason: string | null;
}

export interface DlqRouteDeps {
  readonly redis?: Redis;
  readonly mpKeyPrefix?: string;
  readonly taKeyPrefix?: string;
  readonly mpOverrides?: PushPortOverrides;
  readonly taEnv?: Readonly<Record<string, string | undefined>>;
  readonly taSms?: SmsSender;
  readonly recordAudit?: (entry: {
    readonly actorId: string;
    readonly action: string;
    readonly resourceId: string;
    readonly details: Record<string, unknown>;
  }) => Promise<void>;
}

function statusOf(raw: {
  replayedAt?: string;
  discardedAt?: string;
}): "pending" | "replayed" | "discarded" {
  if (raw.discardedAt) return "discarded";
  if (raw.replayedAt) return "replayed";
  return "pending";
}

function sanitizeMpEntry(entry: DeadLetterEntry): SanitizedDlqItem {
  const id = entry.id ?? deterministicMpDlqId(entry);
  const env = entry.envelope;
  return {
    id,
    queue: "marketplace",
    status: statusOf(entry),
    eventId: entry.eventId,
    eventName: entry.eventName,
    userId: entry.userId || null,
    role: entry.role ?? null,
    channel: entry.channel ?? "push",
    attempts: entry.attempts,
    reason: entry.reason,
    tokenId: null,
    requestId:
      typeof env?.payload?.requestId === "string"
        ? env.payload.requestId
        : null,
    maskedPhone: null,
    subjectType: env?.subject?.type ?? null,
    subjectId: env?.subject?.id ?? null,
    cityId: env?.cityId ?? null,
    replayable: Boolean(env),
    at: entry.at ?? null,
    replayedAt: entry.replayedAt ?? null,
    replayedBy: entry.replayedBy ?? null,
    replayOutcome: entry.replayOutcome ?? null,
    discardedAt: entry.discardedAt ?? null,
    discardedBy: entry.discardedBy ?? null,
    discardReason: entry.discardReason ?? null,
  };
}

function sanitizeTaEntry(entry: TripAccessDeadLetter): SanitizedDlqItem {
  const id = entry.id ?? deterministicTripAccessDlqId(entry);
  return {
    id,
    queue: "trip_access",
    status: statusOf(entry),
    eventId: entry.eventId,
    eventName: "trip_access.issued",
    userId: null,
    role: "guest_passenger",
    channel: "sms",
    attempts: entry.attempts,
    reason: entry.reason,
    tokenId: entry.tokenId,
    requestId: entry.requestId ?? null,
    maskedPhone: entry.maskedPhone ?? null,
    subjectType: "trip_access",
    subjectId: entry.tokenId,
    cityId: null,
    replayable: Boolean(entry.sealed && entry.smsCopy && entry.expiresAt),
    at: entry.at ?? null,
    replayedAt: entry.replayedAt ?? null,
    replayedBy: entry.replayedBy ?? null,
    replayOutcome: entry.replayOutcome ?? null,
    discardedAt: entry.discardedAt ?? null,
    discardedBy: entry.discardedBy ?? null,
    discardReason: entry.discardReason ?? null,
  };
}

interface LocatedDlqRecord {
  readonly queue: "marketplace" | "trip_access";
  readonly listKey: string;
  readonly index: number;
  readonly mp?: DeadLetterEntry;
  readonly ta?: TripAccessDeadLetter;
  readonly sanitized: SanitizedDlqItem;
}

async function loadAllDlqRecords(
  commands: Redis,
  mpPrefix: string,
  taPrefix: string,
): Promise<LocatedDlqRecord[]> {
  const mpListKey = `${mpPrefix}dlq`;
  const taListKey = `${taPrefix}dlq`;
  const [mpRaw, taRaw] = await Promise.all([
    commands.lrange(mpListKey, 0, -1),
    commands.lrange(taListKey, 0, -1),
  ]);

  const records: LocatedDlqRecord[] = [];
  for (let i = 0; i < mpRaw.length; i += 1) {
    try {
      const parsed = JSON.parse(mpRaw[i]!) as DeadLetterEntry;
      records.push({
        queue: "marketplace",
        listKey: mpListKey,
        index: i,
        mp: parsed,
        sanitized: sanitizeMpEntry(parsed),
      });
    } catch {
      // Ignore malformed entry
    }
  }
  for (let i = 0; i < taRaw.length; i += 1) {
    try {
      const parsed = JSON.parse(taRaw[i]!) as TripAccessDeadLetter;
      records.push({
        queue: "trip_access",
        listKey: taListKey,
        index: i,
        ta: parsed,
        sanitized: sanitizeTaEntry(parsed),
      });
    } catch {
      // Ignore malformed entry
    }
  }
  return records;
}

async function defaultRecordAudit(entry: {
  readonly actorId: string;
  readonly action: string;
  readonly resourceId: string;
  readonly details: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog
    .create({
      data: {
        userId: UUID_RE.test(entry.actorId) ? entry.actorId : null,
        action: entry.action,
        resource: "notification_dlq",
        resourceId: entry.resourceId,
        details: {
          ...entry.details,
          actorId: entry.actorId,
        } as Prisma.InputJsonValue,
      },
    })
    .catch(() => undefined);
}

export function createDlqRoutes(deps: DlqRouteDeps = {}): Hono {
  const router = new Hono();
  const commands = deps.redis ?? defaultRedis;
  const mpPrefix = deps.mpKeyPrefix ?? "notif:mp:";
  const taPrefix = deps.taKeyPrefix ?? "notif:trip_access:";
  const recordAudit = deps.recordAudit ?? defaultRecordAudit;

  router.use("*", opsOnly);

  /**
   * GET /api/v1/ops/notifications/dlq
   * Lists dead-lettered notifications across marketplace and trip_access queues.
   */
  router.get("/", zValidator("query", listQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const all = await loadAllDlqRecords(commands, mpPrefix, taPrefix);

    let marketplaceCount = 0;
    let tripAccessCount = 0;
    let pendingCount = 0;
    let replayedCount = 0;
    let discardedCount = 0;

    for (const r of all) {
      if (r.queue === "marketplace") marketplaceCount += 1;
      else tripAccessCount += 1;
      if (r.sanitized.status === "pending") pendingCount += 1;
      else if (r.sanitized.status === "replayed") replayedCount += 1;
      else discardedCount += 1;
    }

    const sinceMs = query.since ? Date.parse(query.since) : null;
    const filtered = all
      .map((r) => r.sanitized)
      .filter((item) => {
        if (query.queue !== "all" && item.queue !== query.queue) {
          return false;
        }
        if (query.status !== "all" && item.status !== query.status) {
          return false;
        }
        if (
          query.eventName &&
          !item.eventName.toLowerCase().includes(query.eventName.toLowerCase())
        ) {
          return false;
        }
        if (query.role && item.role !== query.role) {
          return false;
        }
        if (
          query.reason &&
          !item.reason.toLowerCase().includes(query.reason.toLowerCase())
        ) {
          return false;
        }
        if (sinceMs !== null && Number.isFinite(sinceMs)) {
          const itemMs = item.at ? Date.parse(item.at) : Number.NaN;
          if (!Number.isFinite(itemMs) || itemMs < sinceMs) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

    return c.json({
      success: true,
      data: {
        items: filtered.slice(0, query.limit),
        total: filtered.length,
        counts: {
          marketplace: marketplaceCount,
          tripAccess: tripAccessCount,
          pending: pendingCount,
          replayed: replayedCount,
          discarded: discardedCount,
        },
      },
    });
  });

  /**
   * GET /api/v1/ops/notifications/dlq/:id
   * Inspects a single dead-lettered notification without exposing secrets.
   */
  router.get("/:id", async (c) => {
    const id = c.req.param("id");
    const all = await loadAllDlqRecords(commands, mpPrefix, taPrefix);
    const found = all.find((r) => r.sanitized.id === id);
    if (!found) {
      return c.json(
        {
          success: false,
          error: {
            code: "dlq_item_not_found",
            message: `DLQ item ${id} not found`,
          },
        },
        404,
      );
    }

    return c.json({
      success: true,
      data: found.sanitized,
    });
  });

  /**
   * POST /api/v1/ops/notifications/dlq/:id/replay
   * Idempotently replays a dead-lettered notification through its deliverer.
   */
  router.post("/:id/replay", async (c) => {
    const id = c.req.param("id");
    const actorId = c.get("userId") || "ops";
    const all = await loadAllDlqRecords(commands, mpPrefix, taPrefix);
    const found = all.find((r) => r.sanitized.id === id);
    if (!found) {
      return c.json(
        {
          success: false,
          error: {
            code: "dlq_item_not_found",
            message: `DLQ item ${id} not found`,
          },
        },
        404,
      );
    }

    if (found.sanitized.status === "discarded") {
      return c.json(
        {
          success: false,
          error: {
            code: "dlq_item_discarded",
            message: "Cannot replay a discarded DLQ item",
          },
        },
        409,
      );
    }

    if (found.sanitized.status === "replayed") {
      return c.json({
        success: true,
        replayed: true,
        idempotent: true,
        data: found.sanitized,
      });
    }

    if (found.queue === "marketplace" && found.mp) {
      const env = found.mp.envelope;
      if (!env) {
        return c.json(
          {
            success: false,
            error: {
              code: "dlq_item_not_replayable",
              message: "DLQ entry does not carry a replayable event envelope",
            },
          },
          422,
        );
      }

      // Clear dedupe and per-subject sequence markers so the replay runs.
      const keysToClear = [
        `${mpPrefix}seen:${found.mp.eventId}`,
        `${mpPrefix}seq:${env.subject.type}:${env.subject.id}`,
        `${mpPrefix}seq:${env.subject.type}:${env.subject.id}:choice_offered`,
      ];
      await commands.del(...keysToClear);

      const ports = buildMarketplacePushPorts(commands, {
        keyPrefix: mpPrefix,
        ...deps.mpOverrides,
      });
      const deliverer = new MarketplacePushDeliverer(ports);
      const replayRes = await deliverer.handle(env);

      const nowIso = new Date().toISOString();
      const updated: DeadLetterEntry = {
        ...found.mp,
        id: found.sanitized.id,
        replayedAt: nowIso,
        replayedBy: actorId,
        replayOutcome: replayRes.outcome,
      };
      await commands.lset(found.listKey, found.index, JSON.stringify(updated));

      await recordAudit({
        actorId,
        action: "notification.dlq.replay",
        resourceId: id,
        details: {
          queue: "marketplace",
          eventId: found.mp.eventId,
          eventName: found.mp.eventName,
          outcome: replayRes.outcome,
        },
      });

      return c.json({
        success: true,
        replayed: true,
        idempotent: false,
        data: sanitizeMpEntry(updated),
      });
    }

    if (found.queue === "trip_access" && found.ta) {
      if (!found.ta.sealed || !found.ta.smsCopy || !found.ta.expiresAt) {
        return c.json(
          {
            success: false,
            error: {
              code: "dlq_item_not_replayable",
              message:
                "Trip-access DLQ entry is missing sealed payload metadata and cannot be replayed",
            },
          },
          422,
        );
      }

      const config = loadTripAccessConfig(deps.taEnv ?? process.env);
      if (!config.ok) {
        return c.json(
          {
            success: false,
            error: {
              code: "trip_access_not_configured",
              message: config.reason,
            },
          },
          503,
        );
      }

      await commands.del(`${taPrefix}sms:${found.ta.tokenId}`);
      const ports = buildTripAccessPorts(commands, config, {
        keyPrefix: taPrefix,
        sms: deps.taSms,
      });
      const deliverer = new TripAccessSmsDeliverer(ports);
      const rebuilt: EventEnvelope = {
        id: found.ta.eventId,
        name: "trip_access.issued",
        version: 1,
        occurredAt: found.ta.at ?? new Date().toISOString(),
        actor: { type: "system", id: "dlq-replay" },
        subject: { type: "trip_access", id: found.ta.tokenId },
        idempotencyKey: `replay:${found.ta.tokenId}`.slice(0, 64),
        fromVersion: null,
        toVersion: 1,
        cityId: null,
        payload: {
          tokenId: found.ta.tokenId,
          requestId: found.ta.requestId ?? "req_replay",
          scope: "guest_passenger",
          expiresAt: found.ta.expiresAt,
          recipient: { channel: "sms" },
          smsCopy: found.ta.smsCopy,
          sealed: found.ta.sealed,
        },
      };

      const replayRes = await deliverer.handle(rebuilt);
      const nowIso = new Date().toISOString();
      const updated: TripAccessDeadLetter = {
        ...found.ta,
        id: found.sanitized.id,
        replayedAt: nowIso,
        replayedBy: actorId,
        replayOutcome: replayRes.outcome,
      };
      await commands.lset(found.listKey, found.index, JSON.stringify(updated));

      await recordAudit({
        actorId,
        action: "notification.dlq.replay",
        resourceId: id,
        details: {
          queue: "trip_access",
          eventId: found.ta.eventId,
          tokenId: found.ta.tokenId,
          outcome: replayRes.outcome,
        },
      });

      return c.json({
        success: true,
        replayed: true,
        idempotent: false,
        data: sanitizeTaEntry(updated),
      });
    }

    return c.json(
      {
        success: false,
        error: {
          code: "dlq_item_not_replayable",
          message: "DLQ entry cannot be replayed",
        },
      },
      422,
    );
  });

  /**
   * POST /api/v1/ops/notifications/dlq/:id/discard
   * Marks a dead-lettered notification as discarded with an audited reason.
   */
  router.post(
    "/:id/discard",
    zValidator("json", discardBodySchema),
    async (c) => {
      const id = c.req.param("id");
      const { reason } = c.req.valid("json");
      const actorId = c.get("userId") || "ops";

      const all = await loadAllDlqRecords(commands, mpPrefix, taPrefix);
      const found = all.find((r) => r.sanitized.id === id);
      if (!found) {
        return c.json(
          {
            success: false,
            error: {
              code: "dlq_item_not_found",
              message: `DLQ item ${id} not found`,
            },
          },
          404,
        );
      }

      if (found.sanitized.status === "discarded") {
        return c.json({
          success: true,
          discarded: true,
          idempotent: true,
          data: found.sanitized,
        });
      }

      const nowIso = new Date().toISOString();
      if (found.queue === "marketplace" && found.mp) {
        const updated: DeadLetterEntry = {
          ...found.mp,
          id: found.sanitized.id,
          discardedAt: nowIso,
          discardedBy: actorId,
          discardReason: reason,
        };
        await commands.lset(
          found.listKey,
          found.index,
          JSON.stringify(updated),
        );
        await recordAudit({
          actorId,
          action: "notification.dlq.discard",
          resourceId: id,
          details: {
            queue: "marketplace",
            eventId: found.mp.eventId,
            eventName: found.mp.eventName,
            reason,
          },
        });
        return c.json({
          success: true,
          discarded: true,
          idempotent: false,
          data: sanitizeMpEntry(updated),
        });
      }

      if (found.queue === "trip_access" && found.ta) {
        const updated: TripAccessDeadLetter = {
          ...found.ta,
          id: found.sanitized.id,
          discardedAt: nowIso,
          discardedBy: actorId,
          discardReason: reason,
        };
        await commands.lset(
          found.listKey,
          found.index,
          JSON.stringify(updated),
        );
        await recordAudit({
          actorId,
          action: "notification.dlq.discard",
          resourceId: id,
          details: {
            queue: "trip_access",
            eventId: found.ta.eventId,
            tokenId: found.ta.tokenId,
            reason,
          },
        });
        return c.json({
          success: true,
          discarded: true,
          idempotent: false,
          data: sanitizeTaEntry(updated),
        });
      }

      return c.json(
        {
          success: false,
          error: {
            code: "dlq_item_not_found",
            message: `DLQ item ${id} not found`,
          },
        },
        404,
      );
    },
  );

  return router;
}

export const dlqRoutes = createDlqRoutes();
