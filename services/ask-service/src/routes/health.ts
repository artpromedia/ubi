/**
 * Liveness and readiness.
 *
 * `/health/ready` is the pod's readiness: the database and Redis. It also reports
 * whether AI execution is available — the model endpoint reachable AND its
 * serving identity attested against the pin (ai/attestation.ts) — but a model
 * outage never makes the pod unready: threads, reviews, confirmations,
 * executions and the ops views keep working, and only the assistant's model turn
 * is off (it fails as `service_unavailable`, the conventional-flow fallback).
 * The probe never waits on the model; it reports the latest attestation and
 * refreshes it in the background.
 *
 * `/health/ready/ai` is internal (the `X-Service-Key` convention, fail closed):
 * the full attestation — pinned vs reported identity, per-field verdicts and the
 * digest recorded on ai_actions rows — with 200 only when AI execution may run.
 */
import { timingSafeEqual } from "node:crypto";

import { Hono, type Context, type Next } from "hono";

import { checkPrismaConnection } from "../lib/prisma";
import { checkRedisConnection } from "../lib/redis";

import type { ModelProvider } from "../ai/model-provider";

interface AiReadiness {
  readonly ready: boolean;
  readonly reason: string | null;
  readonly checkedAt: string | null;
}

function aiReadiness(model: ModelProvider): AiReadiness {
  if (model.attest === undefined || model.lastAttestation === undefined) {
    return {
      ready: false,
      reason: "attestation_unsupported",
      checkedAt: null,
    };
  }
  const last = model.lastAttestation();
  // Re-checks only when the cached attestation is past its TTL; never awaited.
  void model.attest().catch(() => undefined);
  if (last === null) {
    return { ready: false, reason: "attestation_pending", checkedAt: null };
  }
  return { ready: last.ok, reason: last.reason, checkedAt: last.checkedAt };
}

function keysMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Internal callers only; refuses everything when the key is not provisioned. */
async function internalServiceKey(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const expected = process.env.INTERNAL_SERVICE_KEY;
  const given = c.req.header("X-Service-Key");
  if (
    expected === undefined ||
    expected.length === 0 ||
    given === undefined ||
    !keysMatch(given, expected)
  ) {
    return c.json({ code: "forbidden", message: "internal endpoint" }, 403);
  }
  await next();
}

export function createHealthRoutes(model: ModelProvider): Hono {
  const routes = new Hono();

  routes.get("/", (c) => c.json({ status: "ok", service: "ask-service" }, 200));

  routes.get("/ready", async (c) => {
    const [database, redis] = await Promise.all([
      checkPrismaConnection(),
      checkRedisConnection(),
    ]);
    const ai = aiReadiness(model);
    const ready = database.healthy && redis;
    return c.json(
      {
        status: ready ? "ready" : "degraded",
        checks: { database: database.healthy, redis, model: ai.ready },
        capabilities: { app: ready, aiExecution: ready && ai.ready },
        ai,
      },
      ready ? 200 : 503,
    );
  });

  routes.get("/ready/ai", internalServiceKey, async (c) => {
    if (model.attest === undefined) {
      return c.json(
        { ready: false, reason: "attestation_unsupported", attestation: null },
        503,
      );
    }
    const attestation = await model.attest({
      force: c.req.query("refresh") === "1",
    });
    return c.json(
      { ready: attestation.ok, reason: attestation.reason, attestation },
      attestation.ok ? 200 : 503,
    );
  });

  return routes;
}
