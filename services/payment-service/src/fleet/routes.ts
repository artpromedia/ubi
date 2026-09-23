/**
 * `/v1/finance/fleet` — UBI OPS's surface for weekly fleet remittance
 * settlement (A05). Mounted from src/index.ts's ROUTER_REGISTRY ahead of
 * `/v1/finance` (the /v1/finance/travel ordering rule), under the existing
 * `/v1/finance/*` rate limiter. The gateway never proxies `/v1/finance`.
 *
 * Every route requires the gateway-SIGNED identity context (`x-ubi-identity`,
 * verified with UBI_IDENTITY_SECRET in every environment — no plain-header
 * fallback) with role `admin`: settlement is an ops action, never a fleet's
 * or a driver's. A missing or unverifiable context is 401, another role 403,
 * a misconfigured verifier 503.
 *
 *   POST /settlements/run                       { cityId, weekStart }  (Idempotency-Key)
 *        settles every contract-B item of an ENDED week; per item exactly
 *        once on (assignmentId, weekStart). 201 recorded / 200 replayed.
 *   GET  /settlements/:cityId/:weekStart        the week's settlement and
 *        adjustment records
 *   GET  /carry-forward/:fleetId/:driverId?currency=XXX
 *        the pair's DERIVED carry-forward, by origin week
 *
 * The `fleet` city flag gates the run (deny-by-default: `feature_disabled`).
 */
import { Hono, type Context, type Next } from "hono";
import { z } from "zod";

import {
  ContractError,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
} from "@ubi/contracts";

import {
  httpSettlementInputsClient,
  type SettlementInputsClient,
} from "./inputs";
import { isLinkId, isMonday } from "./model";
import {
  carryForwardView,
  runSettlementOnce,
  settlementsOfWeek,
} from "./settlement";
import { IDENTITY_HEADER, verifyIdentityContext } from "../identity/context";
import { logger } from "../lib/logger";

import type { WalletDeps } from "../ledger/context";
import type { Actor } from "../ledger/types";

declare module "hono" {
  interface ContextVariableMap {
    fleetOpsActor: Actor;
  }
}

/** The signed identity role allowed to run settlement. */
export const FLEET_SETTLEMENT_ROLE = "admin";

const RunBody = z.object({
  cityId: z.string().min(1).max(128),
  weekStart: z
    .string()
    .refine(isMonday, "a settlement week is named by its Monday, YYYY-MM-DD"),
});

function fail(c: Context, error: unknown): Response {
  if (error instanceof ContractError) {
    return c.json(error.toBody(), error.status as 200);
  }
  logger.error(
    { err: error, component: "fleet-settlement" },
    "unhandled error",
  );
  return c.json(
    {
      code: "internal_error",
      message: "something went wrong handling that request",
    },
    500,
  );
}

async function parse<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ContractError(
      "validation_failed",
      "the request body is not valid",
      {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  }
  return parsed.data;
}

function keyOf(c: Context): string {
  const parsed = IdempotencyKeySchema.safeParse(
    c.req.header(IDEMPOTENCY_HEADER),
  );
  if (!parsed.success) {
    throw new ContractError(
      "validation_failed",
      `a valid ${IDEMPOTENCY_HEADER} header is required so a retry cannot settle twice`,
    );
  }
  return parsed.data;
}

async function requireOpsIdentity(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const signed = c.req.header(IDENTITY_HEADER);
  if (signed === undefined || signed.length === 0) {
    return fail(
      c,
      new ContractError("unauthorized", "authentication required"),
    );
  }
  try {
    const principal = await verifyIdentityContext(signed);
    if (principal.role !== FLEET_SETTLEMENT_ROLE) {
      return fail(
        c,
        new ContractError(
          "forbidden",
          "fleet remittance settlement is an operations action",
        ),
      );
    }
    c.set("fleetOpsActor", { id: principal.userId, role: principal.role });
  } catch (error) {
    if (error instanceof ContractError) {
      return fail(
        c,
        new ContractError(
          "unauthorized",
          "the signed identity context did not verify",
        ),
      );
    }
    return fail(
      c,
      new ContractError(
        "service_unavailable",
        "identity could not be verified; please retry",
      ),
    );
  }
  await next();
}

export function createFleetFinanceRoutes(
  deps: WalletDeps,
  inputs: SettlementInputsClient = httpSettlementInputsClient(),
): Hono {
  const routes = new Hono();
  routes.use("*", requireOpsIdentity);

  routes.post("/settlements/run", async (c) => {
    try {
      const key = keyOf(c);
      const body = await parse(c, RunBody);
      const outcome = await runSettlementOnce(
        deps,
        inputs,
        body,
        c.get("fleetOpsActor"),
        key,
      );
      // Settlement records name drivers and fleets: never cached.
      c.header("Cache-Control", "no-store");
      return c.json(
        { ...outcome.result, replayed: outcome.replayed },
        outcome.replayed ? 200 : 201,
      );
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.get("/settlements/:cityId/:weekStart", async (c) => {
    try {
      const view = await settlementsOfWeek(
        deps,
        c.req.param("cityId"),
        c.req.param("weekStart"),
      );
      c.header("Cache-Control", "no-store");
      return c.json(view);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.get("/carry-forward/:fleetId/:driverId", async (c) => {
    try {
      const fleetId = c.req.param("fleetId");
      const driverId = c.req.param("driverId");
      const currency = c.req.query("currency") ?? "";
      if (!isLinkId(fleetId) || !isLinkId(driverId)) {
        throw new ContractError(
          "validation_failed",
          "fleetId and driverId are 1-128 letters, digits, '_', '.' or '-'",
        );
      }
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new ContractError(
          "validation_failed",
          "currency is required (an ISO 4217 code)",
        );
      }
      c.header("Cache-Control", "no-store");
      return c.json(await carryForwardView(deps, fleetId, driverId, currency));
    } catch (error) {
      return fail(c, error);
    }
  });

  return routes;
}
