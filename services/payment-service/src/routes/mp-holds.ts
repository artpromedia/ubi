/**
 * `/v1/wallet/mp` — marketplace commission reservations (M04/D04,
 * contracts/openapi/marketplace.yaml).
 *
 * The hold mutations are service-to-service: the marketplace award engine
 * (ride-service) calls them with `X-Service-Key`, and the driver never
 * reaches them. The only driver-facing surface here is the wallet overview,
 * which reads the caller's OWN wallet — the one server-computed spendable.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";

import {
  ContractError,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
} from "@ubi/contracts";

import {
  adjustHold,
  captureHold,
  getMpWalletOverview,
  releaseHold,
  reserveHold,
  type WalletDeps,
} from "../ledger";
import { reverseCapturedHold } from "../ledger/mp-holds";
import { walletLogger } from "../lib/logger";
import { internalServiceAuth, serviceAuth } from "../middleware";

/** Wire money: integer minor units plus the currency, never a float. */
const MoneyBody = z.object({
  amountMinor: z.number().int(),
  currency: z.string().min(3).max(3),
});

const ReserveBody = z.object({
  driverId: z.string().min(1),
  bidId: z.string().min(1),
  requestId: z.string().min(1),
  amountMinor: MoneyBody,
  baseMinor: MoneyBody,
  policyVersion: z.number().int().positive(),
  cityId: z.string().min(1),
});

const AdjustBody = z.object({
  amountMinor: MoneyBody,
  baseMinor: MoneyBody,
});

const CaptureBody = z.object({ awardId: z.string().min(1) });

const ReverseBody = z.object({
  awardId: z.string().min(1),
  reason: z.string().min(1).max(280),
});

function idempotencyKeyOf(c: Context): string {
  const raw = c.req.header(IDEMPOTENCY_HEADER);
  const parsed = IdempotencyKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ContractError(
      "validation_failed",
      `a valid ${IDEMPOTENCY_HEADER} header is required for this operation`,
    );
  }
  return parsed.data;
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
  walletLogger.error({ err: error }, "unhandled marketplace hold error");
  return c.json(
    {
      code: "internal_error",
      message: "something went wrong handling that request",
    },
    500,
  );
}

export function createMpHoldRoutes(deps: WalletDeps): Hono {
  const routes = new Hono();

  // Driver-facing: the wallet overview reads the authenticated caller's own
  // wallet. Registered before the service-key guard takes the rest.
  routes.get("/overview", serviceAuth, async (c) => {
    try {
      const driverId = c.get("userId");
      const cityId = c.req.header("X-City-ID");
      if (cityId === undefined || cityId.length === 0) {
        throw new ContractError(
          "city_unsupported",
          "the request does not say which city it belongs to",
        );
      }
      return c.json(await getMpWalletOverview(deps, driverId, cityId), 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.use("/holds/*", internalServiceAuth);

  routes.post("/holds/reserve", async (c) => {
    try {
      const body = await parse(c, ReserveBody);
      const result = await reserveHold(
        deps,
        {
          driverId: body.driverId,
          bidRef: body.bidId,
          requestRef: body.requestId,
          amountMinor: body.amountMinor.amountMinor,
          baseMinor: body.baseMinor.amountMinor,
          policyVersion: body.policyVersion,
          cityId: body.cityId,
        },
        idempotencyKeyOf(c),
      );
      return c.json(result.hold, result.replayed ? 200 : 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/holds/:id/adjust", async (c) => {
    try {
      const body = await parse(c, AdjustBody);
      const result = await adjustHold(
        deps,
        c.req.param("id"),
        {
          amountMinor: body.amountMinor.amountMinor,
          baseMinor: body.baseMinor.amountMinor,
        },
        idempotencyKeyOf(c),
      );
      return c.json(result.hold, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/holds/:id/release", async (c) => {
    try {
      const result = await releaseHold(
        deps,
        c.req.param("id"),
        idempotencyKeyOf(c),
      );
      return c.json(result.hold, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/holds/:id/capture", async (c) => {
    try {
      const body = await parse(c, CaptureBody);
      const result = await captureHold(
        deps,
        c.req.param("id"),
        { awardId: body.awardId },
        idempotencyKeyOf(c),
      );
      return c.json(
        {
          hold: result.hold,
          receiptId: result.receiptId,
          journalEntryId: result.journalEntryId,
        },
        200,
      );
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/holds/:id/reverse", async (c) => {
    try {
      const body = await parse(c, ReverseBody);
      const result = await reverseCapturedHold(
        deps,
        c.req.param("id"),
        { awardId: body.awardId, reason: body.reason },
        idempotencyKeyOf(c),
      );
      return c.json(result.hold, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  return routes;
}
