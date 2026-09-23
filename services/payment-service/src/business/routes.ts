/**
 * Business travel money on the canonical ledger (A06 part C) — the HTTP
 * surface. Contract: packages/contracts/src/business-travel.ts.
 *
 * `/v1/business` — the organization's people, by the gateway-SIGNED identity
 * context only (`x-ubi-identity`, verified with UBI_IDENTITY_SECRET, in every
 * environment: no plain-header fallback). Authority comes from the caller's
 * ACTIVE membership, read per request (./authority.ts).
 *
 *   GET  /organizations/:orgId/funding               owner/admin
 *   POST /organizations/:orgId/topups                owner/admin   (Idempotency-Key)
 *   GET  /organizations/:orgId/budgets?period=       owner/admin/booker
 *   POST /organizations/:orgId/budgets/allocations   owner/admin   (Idempotency-Key)
 *   POST /organizations/:orgId/budgets/returns       owner/admin   (Idempotency-Key)
 *   GET  /organizations/:orgId/bookings?period=      owner/admin (all), booker (own)
 *   GET  /bookings/mine                              the traveller's own
 *   GET  /organizations/:orgId/statements/:period?format=json|csv   owner/admin
 *
 * `/v1/finance/business` — the internal API ride-service calls, by service
 * key (`internalServiceAuth`, fails closed). The gateway never proxies
 * `/v1/finance`, and strips X-Service-Key from client traffic.
 *
 *   POST /policy-check              read-only verdict (X-City-ID)
 *   POST /reserve                   (Idempotency-Key, X-City-ID)
 *   POST /commit                    (Idempotency-Key)
 *   POST /release                   (Idempotency-Key)
 *   GET  /reservations/:bookingRef  status, for reconciliation — and the
 *                                   organization's billing identity and the
 *                                   cost centre for ride-service's receipt
 *
 * Both routers are mounted from src/index.ts's ROUTER_REGISTRY; the finance
 * one BEFORE `/v1/finance`, whose admin-session guards would otherwise run
 * first for every path under it (the /v1/finance/travel ordering rule).
 */
import { Hono, type Context, type Next } from "hono";
import { z } from "zod";

import {
  ContractError,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
  MP_SERVICES,
  VEHICLE_CLASSES,
} from "@ubi/contracts";

import {
  allocateBudget,
  fundingView,
  listBudgets,
  returnBudget,
  topUpOrganization,
} from "./budgets";
import { CANCEL_PARTIES } from "./model";
import {
  checkPolicy,
  commitBudget,
  listMyBusinessBookings,
  listOrganizationBookings,
  releaseBudget,
  reservationStatus,
  reserveBudget,
} from "./reservations";
import { buildStatement, statementCsv, STATEMENT_FORMATS } from "./statements";
import { IDENTITY_HEADER, verifyIdentityContext } from "../identity/context";
import { logger } from "../lib/logger";
import { internalServiceAuth } from "../middleware";

import type { OpOutcome } from "./ops";
import type { WalletDeps } from "../ledger/context";
import type { Actor } from "../ledger/types";

declare module "hono" {
  interface ContextVariableMap {
    businessActor: Actor;
  }
}

// ── Bodies (mirror the contract's input schemas) ──────────────────────────

const Minor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const Currency = z.string().regex(/^[A-Z]{3}$/);
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM");
const BookingRef = z.string().min(1).max(200);

const TopupBody = z.object({ methodId: z.string().min(1), amountMinor: Minor });

const BudgetMoveBody = z.object({
  costCentreId: z.string().min(1),
  period: Period,
  amountMinor: Minor,
});

const BookingTermsBody = z.object({
  bookingRef: BookingRef,
  organizationId: z.string().min(1),
  costCentreId: z.string().min(1).optional(),
  bookerId: z.string().min(1),
  travellerId: z.string().min(1),
  service: z.enum(MP_SERVICES),
  vehicleClass: z.enum(VEHICLE_CLASSES),
  amountMinor: Minor,
  currency: Currency,
  expenseCategory: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9 ._-]+$/)
    .optional(),
});

const CommitBody = z.object({
  bookingRef: BookingRef,
  actualMinor: Minor,
  currency: Currency,
});

const ReleaseBody = z.object({
  bookingRef: BookingRef,
  cancelledBy: z.object({
    party: z.enum(CANCEL_PARTIES),
    userId: z.string().min(1).nullable(),
  }),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, "a release reason is a snake_case code"),
});

/**
 * ride-service scopes its keys (`business:<award>:<op>`), so they may outgrow
 * the 64-character limit on raw client keys. Same url-safe alphabet.
 */
const ServiceIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(255)
  .regex(/^[A-Za-z0-9_.:-]+$/);

// ── Plumbing ──────────────────────────────────────────────────────────────

function fail(c: Context, error: unknown): Response {
  if (error instanceof ContractError) {
    return c.json(error.toBody(), error.status as 200);
  }
  logger.error(
    { err: error, component: "business" },
    "unhandled business error",
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

function userKeyOf(c: Context): string {
  const parsed = IdempotencyKeySchema.safeParse(
    c.req.header(IDEMPOTENCY_HEADER),
  );
  if (!parsed.success) {
    throw new ContractError(
      "validation_failed",
      `a valid ${IDEMPOTENCY_HEADER} header is required so a retry cannot move money twice`,
    );
  }
  return parsed.data;
}

function serviceKeyOf(c: Context): string {
  const parsed = ServiceIdempotencyKeySchema.safeParse(
    c.req.header(IDEMPOTENCY_HEADER),
  );
  if (!parsed.success) {
    throw new ContractError(
      "validation_failed",
      `a valid ${IDEMPOTENCY_HEADER} header is required so a retry cannot move money twice`,
    );
  }
  return parsed.data;
}

function cityOf(c: Context): string {
  const cityId = c.req.header("X-City-ID");
  if (cityId === undefined || cityId.length === 0) {
    throw new ContractError(
      "city_unsupported",
      "the request does not say which city the trip is in",
    );
  }
  return cityId;
}

function periodQuery(c: Context): string | undefined {
  const period = c.req.query("period");
  if (period === undefined || period.length === 0) {
    return undefined;
  }
  if (!Period.safeParse(period).success) {
    throw new ContractError("validation_failed", "period must be YYYY-MM", {
      period,
    });
  }
  return period;
}

/** 201 when this call recorded the op; 200 when it replayed an earlier one. */
function opReply<T extends object>(
  c: Context,
  outcome: OpOutcome<T>,
): Response {
  return c.json(
    { ...outcome.result, replayed: outcome.replayed },
    outcome.replayed ? 200 : 201,
  );
}

/**
 * The signed identity context, in EVERY environment — the plain `X-User-*`
 * mirrors are never enough to reach an organization's money. A context that
 * does not verify is 401; a misconfigured verifier is 503, never a fallback.
 */
async function requireSignedIdentity(
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
    c.set("businessActor", { id: principal.userId, role: principal.role });
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

function actorOf(c: Context): Actor {
  return c.get("businessActor");
}

// ── /v1/business ──────────────────────────────────────────────────────────

export function createBusinessRoutes(deps: WalletDeps): Hono {
  const routes = new Hono();
  routes.use("*", requireSignedIdentity);

  routes.get("/organizations/:orgId/funding", async (c) => {
    try {
      return c.json(await fundingView(deps, actorOf(c), c.req.param("orgId")));
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/organizations/:orgId/topups", async (c) => {
    try {
      const key = userKeyOf(c);
      const body = await parse(c, TopupBody);
      return opReply(
        c,
        await topUpOrganization(
          deps,
          actorOf(c),
          c.req.param("orgId"),
          body,
          key,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.get("/organizations/:orgId/budgets", async (c) => {
    try {
      const budgets = await listBudgets(
        deps,
        actorOf(c),
        c.req.param("orgId"),
        periodQuery(c),
      );
      return c.json({ budgets });
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/organizations/:orgId/budgets/allocations", async (c) => {
    try {
      const key = userKeyOf(c);
      const body = await parse(c, BudgetMoveBody);
      return opReply(
        c,
        await allocateBudget(deps, actorOf(c), c.req.param("orgId"), body, key),
      );
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/organizations/:orgId/budgets/returns", async (c) => {
    try {
      const key = userKeyOf(c);
      const body = await parse(c, BudgetMoveBody);
      return opReply(
        c,
        await returnBudget(deps, actorOf(c), c.req.param("orgId"), body, key),
      );
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.get("/organizations/:orgId/bookings", async (c) => {
    try {
      const bookings = await listOrganizationBookings(
        deps,
        actorOf(c),
        c.req.param("orgId"),
        periodQuery(c),
      );
      // Business trip metadata: personal-adjacent data, never cached.
      c.header("Cache-Control", "no-store");
      return c.json({ bookings });
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.get("/bookings/mine", async (c) => {
    try {
      const bookings = await listMyBusinessBookings(deps, actorOf(c));
      c.header("Cache-Control", "no-store");
      return c.json({ bookings });
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.get("/organizations/:orgId/statements/:period", async (c) => {
    try {
      const format = c.req.query("format") ?? "json";
      if (!(STATEMENT_FORMATS as readonly string[]).includes(format)) {
        throw new ContractError(
          "validation_failed",
          "that statement format is not available",
          { requested: format, supported: STATEMENT_FORMATS },
        );
      }
      const period = c.req.param("period");
      const statement = await buildStatement(
        deps,
        actorOf(c),
        c.req.param("orgId"),
        period,
      );
      c.header("Cache-Control", "no-store");
      if (format === "csv") {
        c.header("Content-Type", "text/csv; charset=utf-8");
        c.header(
          "Content-Disposition",
          `attachment; filename="statement-${statement.organizationId}-${period}.csv"`,
        );
        return c.body(statementCsv(statement));
      }
      return c.json(statement);
    } catch (error) {
      return fail(c, error);
    }
  });

  return routes;
}

// ── /v1/finance/business ──────────────────────────────────────────────────

export function createBusinessFinanceRoutes(deps: WalletDeps): Hono {
  const routes = new Hono();
  routes.use("*", internalServiceAuth);

  routes.post("/policy-check", async (c) => {
    try {
      const body = await parse(c, BookingTermsBody);
      return c.json(await checkPolicy(deps, { ...body, cityId: cityOf(c) }));
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/reserve", async (c) => {
    try {
      const key = serviceKeyOf(c);
      const body = await parse(c, BookingTermsBody);
      return opReply(
        c,
        await reserveBudget(deps, { ...body, cityId: cityOf(c) }, key),
      );
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/commit", async (c) => {
    try {
      const key = serviceKeyOf(c);
      const body = await parse(c, CommitBody);
      return opReply(c, await commitBudget(deps, body, key));
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/release", async (c) => {
    try {
      const key = serviceKeyOf(c);
      const body = await parse(c, ReleaseBody);
      return opReply(c, await releaseBudget(deps, body, key));
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.get("/reservations/:bookingRef", async (c) => {
    try {
      return c.json(await reservationStatus(deps, c.req.param("bookingRef")));
    } catch (error) {
      return fail(c, error);
    }
  });

  return routes;
}
