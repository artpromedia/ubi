/**
 * `/v1/ops/travel/*` — the travel-ops exception console
 * (contracts/openapi/growth-ops.yaml). Admin-only: every route requires an ops
 * role (a traveller role is refused). The commercial-rates and settlement routes
 * are the config/recon surface behind the launch comparison harness.
 *
 * Every state POST (exception actions, settlement, commercial rates) takes an
 * Idempotency-Key and runs exactly once per operator + key (ops/console.ts);
 * a replay answers the stored result with `Idempotent-Replayed: true`. The
 * city a console write records is `cityProvenanceOf`: gateway-verified, or
 * declared by a signed operator bound to no city — and then the outbox and
 * audit rows say which operator declared it.
 */
import { Hono, type Context, type Next } from "hono";
import { z } from "zod";

import { ContractError } from "@ubi/contracts";

import {
  actorOf,
  cityProvenanceOf,
  correlationIdOf,
  failure,
  gatewayAuth,
  idempotencyKeyOf,
} from "../middleware";
import { parseBody } from "./parse";
import { verifiedGatewayAuth } from "../middleware/transfer-auth";
import {
  listCommercialRates,
  upsertCommercialRate,
} from "../ops/commercial-rates";
import { FLIGHT_STATUSES, recordFlightStatus } from "../ops/flight-status";
import {
  applyExceptionAction,
  EXCEPTION_ACTIONS,
  listExceptions,
  providersHealth,
} from "../ops/ops-travel";
import { recordSettlement } from "../ops/reconcile";
import { isOpsRole } from "../ops/roles";
import { advanceTransfer } from "../ops/transfer-orchestrator";

import type { ConsoleAnswer, ConsoleCity } from "../ops/console";
import type { TravelDeps } from "../ops/context";
import type { JsonRecord } from "../ops/types";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The city a console write records, with its provenance. Supplier-level
 * writes (commercial rates) may name no city: `optional` answers null then,
 * instead of refusing. An unsupported declared city never gets here —
 * `gatewayAuth` refuses it first.
 */
function consoleCityOf(c: Context): ConsoleCity;
function consoleCityOf(c: Context, optional: true): ConsoleCity | null;
function consoleCityOf(c: Context, optional = false): ConsoleCity | null {
  try {
    return cityProvenanceOf(c);
  } catch (error) {
    if (
      optional &&
      error instanceof ContractError &&
      error.code === "city_unsupported" &&
      error.details === undefined
    ) {
      return null;
    }
    throw error;
  }
}

function answer(c: Context, result: ConsoleAnswer): Response {
  if (result.replayed) {
    c.header("Idempotent-Replayed", "true");
  }
  return c.json(result.body, result.status as ContentfulStatusCode);
}

async function opsOnly(c: Context, next: Next): Promise<void | Response> {
  const actor = c.get("actor");
  if (actor === undefined || !isOpsRole(actor.role)) {
    return c.json(
      { code: "forbidden", message: "the travel-ops console is admin-only" },
      403,
    );
  }
  await next();
}

const ActionBody = z.object({
  action: z.enum(EXCEPTION_ACTIONS),
  note: z.string().optional(),
});

const RateBody = z.object({
  supplierId: z.string().min(1),
  routeOrProperty: z.string().min(1),
  feeSchedule: z.record(z.unknown()),
  source: z.string().min(1),
  effectiveDate: z.string(),
  termsRef: z.string().optional(),
});

const SettlementBody = z.object({
  invoicedMinor: z.number().int().nonnegative(),
});

const Instant = z.string().datetime({ offset: true });

/**
 * A verified flight status observation for one leg (e.g. from the airline's
 * notice). The event id is the dedupe key: a repeat changes nothing.
 */
const FlightStatusBody = z
  .object({
    eventId: z.string().min(1).max(200),
    orderId: z.string().min(1),
    legIndex: z.number().int().min(0).max(8),
    status: z.enum(FLIGHT_STATUSES),
    departAt: Instant.optional(),
    arriveAt: Instant.optional(),
    observedAt: Instant,
    source: z.string().min(1).max(100).optional(),
  })
  .strict();

export function createOpsRoutes(deps: TravelDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);
  routes.use("*", opsOnly);

  routes.get("/exceptions", async (c) => {
    try {
      return c.json(await listExceptions(deps), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/exceptions/:id/actions", async (c) => {
    try {
      const idempotencyKey = idempotencyKeyOf(c);
      const body = await parseBody(c, ActionBody);
      const result = await applyExceptionAction(deps, {
        actor: actorOf(c),
        city: consoleCityOf(c),
        orderId: c.req.param("id"),
        action: body.action,
        note: body.note ?? null,
        idempotencyKey,
        correlationId: correlationIdOf(c),
      });
      return answer(c, result);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/providers/health", async (c) => {
    try {
      return c.json(await providersHealth(deps), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/commercial-rates", async (c) => {
    try {
      const supplierId = c.req.query("supplierId") ?? null;
      return c.json(await listCommercialRates(deps, supplierId), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/commercial-rates", async (c) => {
    try {
      const idempotencyKey = idempotencyKeyOf(c);
      const body = await parseBody(c, RateBody);
      const result = await upsertCommercialRate(deps, {
        actor: actorOf(c),
        city: consoleCityOf(c, true),
        idempotencyKey,
        supplierId: body.supplierId,
        routeOrProperty: body.routeOrProperty,
        feeSchedule: body.feeSchedule as unknown as JsonRecord,
        source: body.source,
        effectiveDate: body.effectiveDate,
        termsRef: body.termsRef ?? null,
      });
      return answer(c, result);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/orders/:id/settlement", async (c) => {
    try {
      const idempotencyKey = idempotencyKeyOf(c);
      const body = await parseBody(c, SettlementBody);
      const result = await recordSettlement(deps, {
        actor: actorOf(c),
        city: consoleCityOf(c),
        orderId: c.req.param("id"),
        invoicedMinor: body.invoicedMinor,
        idempotencyKey,
        correlationId: correlationIdOf(c),
      });
      return answer(c, result);
    } catch (error) {
      return failure(c, error);
    }
  });

  // A flight status event drives ride-service calls signed as the affected
  // travellers (withdrawals, retimes), so who sent it must be what the gateway
  // proved: the signed identity context, required in production, and an ops
  // role re-checked on it.
  routes.post("/flight-status", verifiedGatewayAuth, opsOnly, async (c) => {
    try {
      const body = await parseBody(c, FlightStatusBody);
      const result = await recordFlightStatus(deps, {
        actor: actorOf(c),
        source: `ops:${body.source ?? "verified"}`,
        eventId: body.eventId,
        orderId: body.orderId,
        legIndex: body.legIndex,
        status: body.status,
        departAt: body.departAt === undefined ? null : new Date(body.departAt),
        arriveAt: body.arriveAt === undefined ? null : new Date(body.arriveAt),
        observedAt: new Date(body.observedAt),
        correlationId: correlationIdOf(c),
      });
      // Carry retimes / withdrawals to ride-service promptly; the worker
      // retries whatever does not complete here.
      for (const { transferId } of result.applied) {
        await advanceTransfer(deps, transferId).catch(() => undefined);
      }
      return c.json(result, result.duplicate ? 200 : 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
