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
  authorizeMarketplaceFunding,
  captureHold,
  getMpWalletOverview,
  releaseHold,
  releaseMarketplaceFunding,
  reserveHold,
  settleMarketplaceCompletion,
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

const CaptureBody = z.object({
  awardId: z.string().min(1),
  // The award's pinned commission: capture debits exactly this or refuses
  // with a conflict, so a revise-raise racing selection can never inflate
  // the fee (contracts/openapi/marketplace.yaml).
  expectedAmountMinor: MoneyBody,
});

const SettlementBody = z.object({
  awardId: z.string().min(1),
  executionRef: z.object({
    service: z.enum(["ride", "delivery"]),
    id: z.string().min(1),
  }),
  requesterId: z.string().min(1),
  driverId: z.string().min(1),
  fareMinor: MoneyBody,
  tipMinor: MoneyBody.optional(),
  method: z.enum(["wallet", "cash"]),
  cityId: z.string().min(1),
});

const ReverseBody = z.object({
  awardId: z.string().min(1),
  reason: z.string().min(1).max(280),
});

/**
 * Matches ride-service's FundingRequest wire shape (marketplace/funding.go):
 * a bare integer amount, not a Money object.
 */
const FundingBody = z.object({
  requesterId: z.string().min(1),
  requestId: z.string().min(1),
  awardId: z.string().min(1),
  paymentMethodId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  currency: z.string().min(3).max(3),
  cityId: z.string().min(1),
});

const FundingReleaseBody = z.object({
  awardId: z.string().min(1),
  reason: z.string().min(1).max(280),
});

/** Two Money bodies on one request must agree on their denomination. */
function sharedCurrencyOf(
  amount: { currency: string },
  base: { currency: string },
): string {
  if (amount.currency !== base.currency) {
    throw new ContractError(
      "validation_failed",
      "amountMinor and baseMinor must carry the same currency",
      { amountCurrency: amount.currency, baseCurrency: base.currency },
    );
  }
  return amount.currency;
}

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
  // wallet. Registered before the service-key guard takes the rest. The city
  // arrives as a `cityId` query param or an X-City-ID header — the gateway
  // and the apps disagree on which, so both work.
  routes.get("/overview", serviceAuth, async (c) => {
    try {
      const driverId = c.get("userId");
      const cityId = c.req.query("cityId") ?? c.req.header("X-City-ID");
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
  routes.use("/funding/*", internalServiceAuth);
  routes.use("/settlements", internalServiceAuth);

  // Service-to-service variant of the overview: the marketplace engine names
  // the driver to build affordability-checked presets (D02). It lives under
  // /holds so the gateway's admin-only rule keeps user tokens away from it.
  routes.get("/holds/overview", async (c) => {
    try {
      const driverId = c.req.query("driverId");
      const cityId = c.req.query("cityId");
      if (driverId === undefined || driverId.length === 0) {
        throw new ContractError(
          "validation_failed",
          "driverId is a required query parameter",
        );
      }
      if (cityId === undefined || cityId.length === 0) {
        throw new ContractError(
          "validation_failed",
          "cityId is a required query parameter",
        );
      }
      return c.json(await getMpWalletOverview(deps, driverId, cityId), 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  // Award saga step 3 (M05, hardened by C02): rider funding for the SELECTED
  // amount. A wallet method creates a durable reservation (idempotent on the
  // award id); cash answers explicitly unsecured; every other method fails
  // closed. See src/ledger/mp-funding.ts. The Idempotency-Key header is
  // required for parity with every other money mutation here, though the
  // award id is the idempotency authority.
  routes.post("/funding/authorize", async (c) => {
    try {
      idempotencyKeyOf(c);
      const body = await parse(c, FundingBody);
      return c.json(await authorizeMarketplaceFunding(deps, body), 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  // Releases an award's active funding reservation (saga compensation and the
  // ride-service sweep both converge here). Idempotent and forgiving:
  // missing/already-released answer 200 with the current state; a CONSUMED
  // reservation is reported distinctly so callers can alarm.
  routes.post("/funding/release", async (c) => {
    try {
      idempotencyKeyOf(c);
      const body = await parse(c, FundingReleaseBody);
      return c.json(await releaseMarketplaceFunding(deps, body), 200);
    } catch (error) {
      return fail(c, error);
    }
  });

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
          currency: sharedCurrencyOf(body.amountMinor, body.baseMinor),
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
          currency: sharedCurrencyOf(body.amountMinor, body.baseMinor),
        },
        idempotencyKeyOf(c),
      );
      return c.json(result.hold, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/settlements", async (c) => {
    try {
      // Parity with every other mutation here: the header is required, but
      // the award id is the idempotency authority.
      idempotencyKeyOf(c);
      const body = await parse(c, SettlementBody);
      const result = await settleMarketplaceCompletion(deps, {
        awardId: body.awardId,
        executionRef: body.executionRef,
        requesterId: body.requesterId,
        driverId: body.driverId,
        fareMinor: body.fareMinor,
        tipMinor: body.tipMinor,
        method: body.method,
        cityId: body.cityId,
      });
      return c.json(
        result.journalEntryId === null
          ? { settled: result.settled, method: result.method }
          : {
              settled: result.settled,
              method: result.method,
              journalEntryId: result.journalEntryId,
            },
        200,
      );
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
        {
          awardId: body.awardId,
          expectedAmountMinor: body.expectedAmountMinor,
        },
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
