/**
 * `/v1/ops/travel/*` — the travel-ops exception console
 * (contracts/openapi/growth-ops.yaml). Admin-only: every route requires an ops
 * role (a traveller role is refused). The commercial-rates and settlement routes
 * are the config/recon surface behind the launch comparison harness.
 */
import { Hono } from "hono";
import { z } from "zod";

import {
  actorOf,
  cityOf,
  correlationIdOf,
  failure,
  gatewayAuth,
} from "../middleware";
import { parseBody } from "./parse";
import { isOpsRole } from "../ops/roles";
import {
  applyExceptionAction,
  EXCEPTION_ACTIONS,
  listExceptions,
  providersHealth,
} from "../ops/ops-travel";
import {
  listCommercialRates,
  upsertCommercialRate,
} from "../ops/commercial-rates";
import { recordSettlement } from "../ops/reconcile";

import type { TravelDeps } from "../ops/context";
import type { JsonRecord } from "../ops/types";
import type { Context, Next } from "hono";

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
      const body = await parseBody(c, ActionBody);
      const result = await applyExceptionAction(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        orderId: c.req.param("id"),
        action: body.action,
        note: body.note ?? null,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
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
      const body = await parseBody(c, RateBody);
      const result = await upsertCommercialRate(deps, {
        supplierId: body.supplierId,
        routeOrProperty: body.routeOrProperty,
        feeSchedule: body.feeSchedule as unknown as JsonRecord,
        source: body.source,
        effectiveDate: body.effectiveDate,
        termsRef: body.termsRef ?? null,
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/orders/:id/settlement", async (c) => {
    try {
      const body = await parseBody(c, SettlementBody);
      const result = await recordSettlement(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        orderId: c.req.param("id"),
        invoicedMinor: body.invoicedMinor,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
