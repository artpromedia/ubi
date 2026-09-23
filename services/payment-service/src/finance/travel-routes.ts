/**
 * `/v1/finance/travel` — the supplier-travel payment endpoint travel-service's
 * payment port posts to by default (P7, recheck T02; contract:
 * contracts/openapi/finance-travel.yaml). The money semantics live in
 * ./travel.ts; this file is the HTTP surface.
 *
 *   POST /authorize | /capture | /release | /refund   (Idempotency-Key required)
 *   GET  /orders/:orderId                               (status, for reconciliation)
 *
 * AUTH — service-to-service, the same convention as /v1/finance/remedies and
 * the /v1/wallet/mp hold mutations: `internalServiceAuth` requires
 * `X-Service-Key` to equal INTERNAL_SERVICE_KEY and fails CLOSED when that is
 * unset. travel-service already sends it (src/wiring.ts reads the same
 * INTERNAL_SERVICE_KEY). A traveller never reaches this router: the gateway
 * does not proxy /v1/finance and strips X-Service-Key from client traffic.
 *
 * The forwarded `X-User-ID`/`X-User-Role` name who travel-service acted for;
 * they are recorded as context, never as authentication. If the caller also
 * forwards a gateway-signed `x-ubi-identity`, it must verify (401 otherwise,
 * 503 when the verifier is misconfigured) and its principal is recorded as the
 * verified context instead — there is no silent fall-back to the plain headers
 * underneath a JWS that failed.
 *
 * MOUNT — src/index.ts mounts this router BEFORE the `/v1/finance` recon
 * router, whose `use("*")` admin-session guards would otherwise run first for
 * every path under /v1/finance (the same ordering rule as /v1/wallet/mp ahead
 * of /v1/wallet).
 */
import { Hono, type Context, type Next } from "hono";
import { z } from "zod";

import { ContractError, IDEMPOTENCY_HEADER } from "@ubi/contracts";

import {
  authorizeTravelItem,
  captureTravelItem,
  type OnBehalfOf,
  refundTravelItem,
  releaseTravelItem,
  type TravelPaymentInput,
  type TravelPaymentOutcome,
  travelPaymentStatus,
} from "./travel";
import { IDENTITY_HEADER, verifyIdentityContext } from "../identity/context";
import { logger } from "../lib/logger";
import { internalServiceAuth } from "../middleware";

import type { WalletDeps } from "../ledger/context";

declare module "hono" {
  interface ContextVariableMap {
    travelOnBehalfOf: OnBehalfOf | null;
  }
}

/** The wire body travel-service's payment port sends — integer minor units, explicit currency. */
const TravelPaymentBody = z.object({
  orderId: z.string().min(1).max(200),
  userId: z.string().min(1).max(200),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  reason: z.string().max(500).optional(),
});

/**
 * travel-service scopes its keys before sending them
 * (`travel.checkout:<cart>:<user>:<client key>:<item>:auth`), so they outgrow
 * the 64-character limit on raw client keys. Same url-safe alphabet, a longer
 * bound.
 */
const TravelIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(255)
  .regex(/^[A-Za-z0-9_.:-]+$/);

type Operation = (
  deps: WalletDeps,
  input: TravelPaymentInput,
  clientKey: string,
) => Promise<TravelPaymentOutcome>;

function idempotencyKeyOf(c: Context): string {
  const parsed = TravelIdempotencyKeySchema.safeParse(
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
    { err: error, component: "finance-travel" },
    "unhandled travel payment error",
  );
  return c.json(
    {
      code: "internal_error",
      message: "something went wrong handling that request",
    },
    500,
  );
}

/**
 * Records who the travel service acted for. A presented signed identity is
 * authoritative and must verify; otherwise the plain mirrors are kept as
 * unverified context.
 */
async function onBehalfOfContext(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const signed = c.req.header(IDENTITY_HEADER);
  if (signed !== undefined && signed.length > 0) {
    try {
      const principal = await verifyIdentityContext(signed);
      c.set("travelOnBehalfOf", {
        id: principal.userId,
        role: principal.role,
        verified: true,
      });
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
      // A misconfigured UBI_IDENTITY_SECRET is an outage, never a reason to
      // fall back to the unsigned headers.
      return fail(
        c,
        new ContractError(
          "service_unavailable",
          "identity could not be verified; please retry",
        ),
      );
    }
    await next();
    return;
  }

  const id = c.req.header("X-User-ID");
  c.set(
    "travelOnBehalfOf",
    id === undefined || id.length === 0
      ? null
      : { id, role: c.req.header("X-User-Role") ?? "unknown", verified: false },
  );
  await next();
}

/** The one POST handler shape all four ops share. */
function travelPost(deps: WalletDeps, operation: Operation) {
  return async (c: Context): Promise<Response> => {
    try {
      const clientKey = idempotencyKeyOf(c);
      const body = await parse(c, TravelPaymentBody);
      const input: TravelPaymentInput = {
        orderId: body.orderId,
        userId: body.userId,
        amountMinor: body.amountMinor,
        currency: body.currency,
        cityId: cityOf(c),
        reason: body.reason ?? null,
        onBehalfOf: c.get("travelOnBehalfOf") ?? null,
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

export function createTravelPaymentRoutes(deps: WalletDeps): Hono {
  const routes = new Hono();

  routes.use("*", internalServiceAuth);
  routes.use("*", onBehalfOfContext);

  routes.post("/authorize", travelPost(deps, authorizeTravelItem));
  routes.post("/capture", travelPost(deps, captureTravelItem));
  routes.post("/release", travelPost(deps, releaseTravelItem));
  routes.post("/refund", travelPost(deps, refundTravelItem));

  routes.get("/orders/:orderId", async (c) => {
    try {
      return c.json(await travelPaymentStatus(deps, c.req.param("orderId")));
    } catch (error) {
      return fail(c, error);
    }
  });

  return routes;
}
