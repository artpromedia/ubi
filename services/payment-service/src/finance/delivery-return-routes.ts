/**
 * `/v1/finance/delivery-returns` — the return-leg fee endpoint
 * delivery-service's return flow calls (P17). The money semantics live in
 * ./delivery-returns.ts; this file is the HTTP surface.
 *
 *   POST /reserve | /capture | /release   (Idempotency-Key + X-City-ID required)
 *   GET  /returns/:returnId                (status, for reconciliation)
 *
 * AUTH — service-to-service, the same convention as /v1/finance/travel and
 * the /v1/wallet/mp mutations: `internalServiceAuth` requires `X-Service-Key`
 * to equal INTERNAL_SERVICE_KEY and fails CLOSED when that is unset. A sender
 * never reaches this router: the gateway does not proxy /v1/finance and
 * strips X-Service-Key from client traffic. The sender's approval is
 * established by delivery-service (gateway-signed identity, sender-only
 * consent route) before it calls reserve.
 *
 * MOUNT — src/index.ts mounts this router BEFORE the `/v1/finance` recon
 * router, whose `use("*")` admin-session guards would otherwise run first for
 * every path under /v1/finance.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";

import { ContractError, IDEMPOTENCY_HEADER } from "@ubi/contracts";

import {
  captureDeliveryReturnFee,
  type DeliveryReturnChargeInput,
  type DeliveryReturnOutcome,
  deliveryReturnStatus,
  releaseDeliveryReturnFee,
  reserveDeliveryReturnFee,
} from "./delivery-returns";
import { logger } from "../lib/logger";
import { internalServiceAuth } from "../middleware";

import type { WalletDeps } from "../ledger/context";

/** The wire body delivery-service sends — integer minor units, explicit currency. */
const DeliveryReturnBody = z.object({
  returnId: z.string().min(1).max(128),
  deliveryId: z.string().min(1).max(128),
  awardId: z.string().min(1).max(128),
  senderId: z.string().min(1).max(128),
  driverId: z.string().min(1).max(128),
  feeMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  reason: z.string().max(500).optional(),
});

/**
 * delivery-service derives its keys from the return id
 * (`delivery-return:<returnId>:<op>`), which outgrows the 64-character limit
 * on raw client keys. Same url-safe alphabet, a longer bound.
 */
const DeliveryReturnIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(255)
  .regex(/^[A-Za-z0-9_.:-]+$/);

type Operation = (
  deps: WalletDeps,
  input: DeliveryReturnChargeInput,
  clientKey: string,
) => Promise<DeliveryReturnOutcome>;

function idempotencyKeyOf(c: Context): string {
  const parsed = DeliveryReturnIdempotencyKeySchema.safeParse(
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
      "the request does not say which city it belongs to",
    );
  }
  return cityId;
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

function fail(c: Context, error: unknown): Response {
  if (error instanceof ContractError) {
    return c.json(error.toBody(), error.status as 200);
  }
  logger.error(
    { err: error, component: "finance-delivery-returns" },
    "unhandled delivery return fee error",
  );
  return c.json(
    {
      code: "internal_error",
      message: "something went wrong handling that request",
    },
    500,
  );
}

/** The one POST handler shape all three ops share. */
function deliveryReturnPost(deps: WalletDeps, operation: Operation) {
  return async (c: Context): Promise<Response> => {
    try {
      const clientKey = idempotencyKeyOf(c);
      const body = await parse(c, DeliveryReturnBody);
      const input: DeliveryReturnChargeInput = {
        returnId: body.returnId,
        deliveryId: body.deliveryId,
        awardId: body.awardId,
        senderId: body.senderId,
        driverId: body.driverId,
        feeMinor: body.feeMinor,
        currency: body.currency,
        cityId: cityOf(c),
        reason: body.reason ?? null,
      };
      const outcome = await operation(deps, input, clientKey);
      // 201 when this call recorded the op; 200 when it replayed an earlier one.
      return c.json(
        { ...outcome.result, replayed: outcome.replayed },
        outcome.replayed ? 200 : 201,
      );
    } catch (error) {
      return fail(c, error);
    }
  };
}

export function createDeliveryReturnRoutes(deps: WalletDeps): Hono {
  const routes = new Hono();

  routes.use("*", internalServiceAuth);

  routes.post("/reserve", deliveryReturnPost(deps, reserveDeliveryReturnFee));
  routes.post("/capture", deliveryReturnPost(deps, captureDeliveryReturnFee));
  routes.post("/release", deliveryReturnPost(deps, releaseDeliveryReturnFee));

  routes.get("/returns/:returnId", async (c) => {
    try {
      return c.json(
        await deliveryReturnStatus(deps.db, c.req.param("returnId")),
      );
    } catch (error) {
      return fail(c, error);
    }
  });

  return routes;
}
