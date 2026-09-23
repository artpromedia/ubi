/**
 * `/v1/reservations` — airport transfers (contracts/openapi/travel-v2.yaml).
 *
 * The family keeps its path, but what it serves is new: a transfer INTENT
 * linked to the traveller's flight order, turned into a scheduled ride request
 * on ride-service near the trip. Nothing here answers "reserved": the create
 * answer is 202 with the pending intent, and `driverSecured` becomes true only
 * once ride-service reports a requester-approved award.
 *
 * Every route is behind the deny-by-default `reservations` flag for the
 * request's city (docs/launch-readiness/feature-flags.md): with the flag off —
 * or the flag unreadable — each answers `feature_disabled` (404), never a
 * half-built vertical. The worker keeps serving transfers that already exist.
 *
 * The caller and the city come from the gateway's SIGNED identity context
 * (../middleware/transfer-auth.ts; required in production), never from the
 * plain mirrors alone: travel-service re-signs this identity for ride-service,
 * so it must only ever sign what the gateway proved. Every action that makes,
 * changes or cancels a ride also needs the gateway's `mp:request` scope, as
 * `/v1/mp` itself does.
 */
import { Hono, type Context, type Next } from "hono";
import { z } from "zod";

import { featureDisabled, isEnabled } from "@ubi/contracts";

import {
  actorOf,
  correlationIdOf,
  failure,
  idempotencyKeyOf,
} from "../middleware";
import { parseBody, parseOptionalBody } from "./parse";
import { logger } from "../lib/logger";
import {
  assertMarketplaceAllowed,
  verifiedCityOf,
  verifiedGatewayAuth,
} from "../middleware/transfer-auth";
import { advanceTransfer } from "../ops/transfer-orchestrator";
import { TRANSFER_DIRECTIONS } from "../ops/transfer-policy";
import {
  createTransfer,
  decideTransfer,
  getTransfer,
  listTransfers,
  TRANSFER_CHOICES,
} from "../ops/transfers";

import type { TravelDeps } from "../ops/context";

const MoneyBody = z
  .object({
    amountMinor: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

const PlaceBody = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    label: z.string().min(1).max(120).optional(),
  })
  .strict();

// Strict: a body can never name a user, a role, a city, a pickup time or a
// fare bound — those come from the gateway context and the server's policy.
const TransferBody = z
  .object({
    linkedOrderId: z.string().min(1),
    legIndex: z.number().int().min(0).max(8).default(0),
    direction: z.enum(TRANSFER_DIRECTIONS),
    airportPoint: PlaceBody,
    place: PlaceBody,
    vehicleClass: z.string().min(1),
    maxFareMinor: MoneyBody,
    requestedFareMinor: MoneyBody.optional(),
    paymentMethodId: z.string().min(1),
  })
  .strict();

const DecisionBody = z
  .object({
    choice: z.enum(TRANSFER_CHOICES),
    maxFareMinor: MoneyBody.optional(),
  })
  .strict();

function reservationsFlag(deps: TravelDeps) {
  return async (c: Context, next: Next): Promise<void | Response> => {
    try {
      const config = await deps.config.load(verifiedCityOf(c));
      if (!isEnabled(config.flags, "reservations")) {
        return failure(c, featureDisabled("reservations"));
      }
    } catch (error) {
      return failure(c, error);
    }
    await next();
  };
}

/** Best-effort first pass right after an accepted change; the worker retries. */
async function kick(deps: TravelDeps, transferId: string): Promise<void> {
  try {
    await advanceTransfer(deps, transferId);
  } catch (error) {
    logger.warn(
      { err: error, transferId },
      "airport transfer first pass failed; the worker will retry",
    );
  }
}

export function createReservationRoutes(deps: TravelDeps): Hono {
  const routes = new Hono();
  routes.use("*", verifiedGatewayAuth);
  routes.use("*", reservationsFlag(deps));

  routes.post("/", async (c) => {
    try {
      assertMarketplaceAllowed(c);
      const body = await parseBody(c, TransferBody);
      const answer = await createTransfer(deps, {
        actor: actorOf(c),
        cityId: verifiedCityOf(c),
        body: { ...body, legIndex: body.legIndex ?? 0 },
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      if (!answer.replayed) {
        // The stored answer is the intent as accepted; progress is read with
        // GET /v1/reservations/:id.
        await kick(deps, String(answer.body.transferId));
      }
      return c.json(answer.body, 202);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/", async (c) => {
    try {
      const linkedOrderId = c.req.query("linkedOrderId");
      const items = await listTransfers(deps, actorOf(c), {
        ...(linkedOrderId === undefined ? {} : { linkedOrderId }),
      });
      return c.json({ items }, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/:transferId", async (c) => {
    try {
      return c.json(
        await getTransfer(deps, actorOf(c), c.req.param("transferId")),
        200,
      );
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:transferId/decision", async (c) => {
    try {
      assertMarketplaceAllowed(c);
      const body = await parseBody(c, DecisionBody);
      const answer = await decideTransfer(deps, {
        actor: actorOf(c),
        transferId: c.req.param("transferId"),
        choice: body.choice,
        ...(body.maxFareMinor === undefined
          ? {}
          : { maxFareMinor: body.maxFareMinor }),
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(answer.body, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:transferId/cancel", async (c) => {
    try {
      assertMarketplaceAllowed(c);
      await parseOptionalBody(c, z.object({}).strict());
      const answer = await decideTransfer(deps, {
        actor: actorOf(c),
        transferId: c.req.param("transferId"),
        choice: "cancel",
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(answer.body, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
