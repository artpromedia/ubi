/**
 * `/v1/finance/recon` — the finance console's reconciliation surface
 * (slice 11, contracts/openapi/support-config.yaml).
 *
 * Every action here is typed and audited, and the day-close is gated on the
 * ledger rather than on a reviewer's judgement.
 */
import { Hono } from "hono";
import { z } from "zod";

import { ContractError } from "@ubi/contracts";

import { LEDGER_ACCOUNTS } from "../ledger/accounts";
import { logger } from "../lib/logger";
import { adminAuth, serviceAuth } from "../middleware";
import { isReconRail, type ReconRailName } from "./rails";
import {
  assignBreak,
  closeRecon,
  getRecon,
  recordExternalTotal,
  resolveBreak,
  runRecon,
} from "./recon";

import type { WalletDeps } from "../ledger/context";
import type { Actor } from "../ledger/types";
import type { Context } from "hono";

const ExternalBody = z.object({
  amountMinor: z.number().int(),
  source: z.string().min(1).max(200),
});

const AssignBody = z.object({
  owner: z.string().min(1).max(120),
  deadline: z.string().datetime({ offset: true }).optional(),
});

const ResolveBody = z.object({
  caseRef: z.string().min(1).max(120),
  note: z.string().max(280).optional(),
  adjustment: z
    .object({
      lines: z
        .array(
          z.object({
            account: z.enum(LEDGER_ACCOUNTS),
            walletId: z.string().min(1).nullable().optional(),
            amountMinor: z.number().int(),
          }),
        )
        .min(2),
    })
    .optional(),
});

function actorOf(c: Context): Actor {
  const id = c.get("userId");
  if (typeof id !== "string" || id.length === 0) {
    throw new ContractError("unauthorized", "authentication required");
  }
  return { id, role: c.req.header("X-User-Role") ?? "agent" };
}

function cityOf(c: Context): string {
  const cityId = c.req.header("X-City-ID");
  if (cityId === undefined || cityId.length === 0) {
    throw new ContractError(
      "city_unsupported",
      "the request does not say which city it belongs to",
    );
  }
  return cityId;
}

async function parse<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ContractError("validation_failed", "the request body is not valid", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

function railOf(c: Context): ReconRailName {
  const rail = c.req.param("rail");
  if (!isReconRail(rail)) {
    throw new ContractError("validation_failed", "unknown reconciliation rail", { rail });
  }
  return rail;
}

function fail(c: Context, error: unknown): Response {
  if (error instanceof ContractError) {
    return c.json(error.toBody(), error.status as 200);
  }
  logger.error({ err: error, component: "finance-recon" }, "unhandled recon error");
  return c.json(
    { code: "internal_error", message: "something went wrong handling that request" },
    500,
  );
}

export function createFinanceRoutes(deps: WalletDeps): Hono {
  const routes = new Hono();

  routes.use("*", serviceAuth);
  routes.use("*", adminAuth);

  routes.get("/recon/:date", async (c) => {
    try {
      return c.json(await getRecon(deps, cityOf(c), c.req.param("date")), 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/recon/:date/run", async (c) => {
    try {
      const report = await runRecon(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        date: c.req.param("date"),
      });
      return c.json(report, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/recon/:date/rails/:rail", async (c) => {
    try {
      const body = await parse(c, ExternalBody);
      const rail = railOf(c);
      const view = await recordExternalTotal(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        date: c.req.param("date"),
        rail,
        amountMinor: body.amountMinor,
        source: body.source,
      });
      return c.json(view, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/recon/:date/breaks/:breakId/assign", async (c) => {
    try {
      const body = await parse(c, AssignBody);
      const view = await assignBreak(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        date: c.req.param("date"),
        breakId: c.req.param("breakId"),
        owner: body.owner,
        deadline: body.deadline,
      });
      return c.json(view, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/recon/:date/breaks/:breakId/resolve", async (c) => {
    try {
      const body = await parse(c, ResolveBody);
      const result = await resolveBreak(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        date: c.req.param("date"),
        breakId: c.req.param("breakId"),
        caseRef: body.caseRef,
        note: body.note,
        adjustment: body.adjustment,
      });
      return c.json(result, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/recon/:date/close", async (c) => {
    try {
      const report = await closeRecon(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        date: c.req.param("date"),
      });
      return c.json(report, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  return routes;
}
