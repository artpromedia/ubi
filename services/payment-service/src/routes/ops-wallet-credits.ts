/**
 * `/v1/ops/wallet-credits` — Audited dual-approval operations credits for
 * driver commission wallets (CC-B03, DEC-6 Part B).
 *
 * Every route requires a verified `x-ubi-identity` JWS from `api-gateway`
 * (never plain `X-User-*` headers) with an operations finance role
 * (`finance_ops`, `ops_admin`, `admin`, `super_admin`) and a trusted
 * non-limited session (`!modes.includes("limited")`).
 */
import { Hono, type Context, type Next } from "hono";
import { z } from "zod";

import {
  ContractError,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
} from "@ubi/contracts";

import { IDENTITY_HEADER, verifyIdentityContext } from "../identity/context";
import {
  approveOpsCredit,
  getOpsCredit,
  listOpsCredits,
  OPS_CREDIT_STATUSES,
  rejectOpsCredit,
  requestOpsCredit,
  reverseOpsCredit,
} from "../ledger/ops-credits";
import { logger } from "../lib/logger";

import type { WalletDeps } from "../ledger/context";
import type { Actor } from "../ledger/types";

declare module "hono" {
  interface ContextVariableMap {
    opsCreditActor: Actor;
  }
}

export const OPS_CREDIT_ROLES = [
  "finance_ops",
  "ops_admin",
  "admin",
  "super_admin",
] as const;

const ALLOWED_ROLE_SET: ReadonlySet<string> = new Set(OPS_CREDIT_ROLES);

const CreateOpsCreditBody = z.object({
  cityId: z.string().min(1).max(128),
  driverUserId: z.string().min(1).max(128),
  amountMinor: z.number().int().positive(),
  reasonCode: z.string().min(1).max(64),
  note: z.string().max(280).optional(),
  reference: z.string().max(128).optional(),
});

const ReasonBody = z.object({
  reason: z.string().trim().min(3).max(280),
});

const ListQuerySchema = z.object({
  cityId: z.string().min(1).max(128).optional(),
  status: z.enum(OPS_CREDIT_STATUSES).optional(),
  driverUserId: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function fail(c: Context, error: unknown): Response {
  if (error instanceof ContractError) {
    return c.json(error.toBody(), error.status as 200);
  }
  logger.error(
    { err: error, component: "ops-wallet-credits" },
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

async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
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

function idempotencyKeyOf(c: Context): string {
  const parsed = IdempotencyKeySchema.safeParse(
    c.req.header(IDEMPOTENCY_HEADER),
  );
  if (!parsed.success) {
    throw new ContractError(
      "validation_failed",
      `a valid ${IDEMPOTENCY_HEADER} header is required`,
    );
  }
  return parsed.data;
}

async function requireOpsCreditIdentity(
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
    if (principal.modes.includes("limited")) {
      return fail(
        c,
        new ContractError(
          "limited_mode",
          "a device in limited mode cannot manage ops wallet credits",
        ),
      );
    }
    if (!ALLOWED_ROLE_SET.has(principal.role)) {
      return fail(
        c,
        new ContractError(
          "forbidden",
          "ops wallet credits require finance or operations admin authorization",
        ),
      );
    }
    c.set("opsCreditActor", { id: principal.userId, role: principal.role });
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

export function createOpsWalletCreditRoutes(deps: WalletDeps): Hono {
  const routes = new Hono();
  routes.use("*", requireOpsCreditIdentity);

  routes.get("/", async (c) => {
    try {
      const query = ListQuerySchema.safeParse({
        cityId: c.req.query("cityId") || undefined,
        status: c.req.query("status") || undefined,
        driverUserId: c.req.query("driverUserId") || undefined,
        limit: c.req.query("limit") || undefined,
      });
      if (!query.success) {
        throw new ContractError(
          "validation_failed",
          "invalid query parameters",
          {
            issues: query.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        );
      }
      const credits = await listOpsCredits(deps, query.data);
      c.header("Cache-Control", "no-store");
      return c.json({ credits });
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.get("/:id", async (c) => {
    try {
      const credit = await getOpsCredit(deps, c.req.param("id"));
      c.header("Cache-Control", "no-store");
      return c.json({ credit });
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/", async (c) => {
    try {
      const idempotencyKey = idempotencyKeyOf(c);
      const body = await parseBody(c, CreateOpsCreditBody);
      const outcome = await requestOpsCredit(deps, {
        actor: c.get("opsCreditActor"),
        cityId: body.cityId,
        driverUserId: body.driverUserId,
        amountMinor: body.amountMinor,
        reasonCode: body.reasonCode,
        note: body.note ?? null,
        reference: body.reference ?? null,
        idempotencyKey,
      });
      c.header("Cache-Control", "no-store");
      return c.json(outcome, outcome.replayed ? 200 : 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/:id/approve", async (c) => {
    try {
      const idempotencyKey = idempotencyKeyOf(c);
      const outcome = await approveOpsCredit(deps, {
        actor: c.get("opsCreditActor"),
        creditId: c.req.param("id"),
        idempotencyKey,
      });
      c.header("Cache-Control", "no-store");
      return c.json(outcome, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/:id/reject", async (c) => {
    try {
      const idempotencyKey = idempotencyKeyOf(c);
      const body = await parseBody(c, ReasonBody);
      const outcome = await rejectOpsCredit(deps, {
        actor: c.get("opsCreditActor"),
        creditId: c.req.param("id"),
        reason: body.reason,
        idempotencyKey,
      });
      c.header("Cache-Control", "no-store");
      return c.json(outcome, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/:id/reverse", async (c) => {
    try {
      const idempotencyKey = idempotencyKeyOf(c);
      const body = await parseBody(c, ReasonBody);
      const outcome = await reverseOpsCredit(deps, {
        actor: c.get("opsCreditActor"),
        creditId: c.req.param("id"),
        reason: body.reason,
        idempotencyKey,
      });
      c.header("Cache-Control", "no-store");
      return c.json(outcome, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  return routes;
}
