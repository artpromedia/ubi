/**
 * `/internal/ask/*` — the ONE read ask-service may make with no user behind
 * it (a background status sweep over its own executions).
 *
 * Every request-scoped assistant call reaches travel-service like any client:
 * ask-service relays the gateway-signed `x-ubi-identity` context the user's
 * request arrived with (services/ask-service/src/ports/travel-port.ts), and
 * `/v1/travel` verifies it (middleware/auth.ts). A sweep that runs later has
 * no such context — the gateway's contexts live 120 s — and must never
 * borrow or mint one. It gets this router instead, which is deliberately
 * tiny:
 *
 *   GET /internal/ask/grants/:grantId/orders/:orderId
 *       the state of ONE order ask-service booked under ONE action grant.
 *
 * AUTHENTICATION is the service key alone: `X-Service-Key` must equal
 * TRAVEL_ASK_SERVICE_KEY (≥ 32 characters, compared in constant time). A
 * missing or short configured key is an outage (503), never an open door; a
 * wrong or absent presented key is 401. Neither the gateway identity nor any
 * plain `X-User-ID` / `X-User-Role` header is read here — they are simply
 * ignored — and the gateway proxies nothing under `/internal`.
 *
 * SCOPE is what the sweep needs and nothing more:
 *   - read only (no other method is served);
 *   - one order at a time, addressed by id, never listed or searched;
 *   - only an order placed under an AI action grant, and only under THE grant
 *     the caller names — the grant id comes from ask-service's persisted
 *     execution record, so the key cannot reach a traveller's own bookings
 *     or another execution's; any mismatch is the same 404 as a missing
 *     order;
 *   - only the order's state fields: no money, no passengers, no documents,
 *     no offer snapshot.
 *
 * THE ACTOR is derived from the persisted order, never supplied: the answer
 * names the order's owner (`ownerId`, the traveller the order belongs to), so
 * ask-service can check it against the actor on its own execution record.
 *
 * MOUNTING. It belongs at `/internal/ask`, beside the client routers in
 * src/index.ts `createApp` and outside every gateway-identity middleware:
 *
 *   app.route("/internal/ask", createAskInternalRoutes(deps));
 *
 * (then regenerate tests/routes.manifest). tests/ask-travel-relay.test.ts
 * mounts it on the real `createApp` app exactly that way.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { Hono, type Context, type Next } from "hono";

import { ContractError } from "@ubi/contracts";

import { logger } from "../lib/logger";
import { failure } from "../middleware";

import type { TravelDeps } from "../ops/context";
import type { JsonRecord } from "../ops/types";

/** The shared key ask-service presents for its background reads. */
export const ASK_SERVICE_KEY_ENV = "TRAVEL_ASK_SERVICE_KEY";
export const SERVICE_KEY_HEADER = "X-Service-Key";

const MIN_KEY_LENGTH = 32;

/** What a background status read answers — state, never money or people. */
export interface AskOrderStatus {
  readonly orderId: string;
  readonly kind: string;
  readonly state: string;
  readonly stateAt: string;
  readonly supplierRefs: JsonRecord;
  /** The traveller the order belongs to, read from the order itself. */
  readonly ownerId: string;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

async function askServiceAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const configured = process.env[ASK_SERVICE_KEY_ENV];
  if (configured === undefined || configured.length < MIN_KEY_LENGTH) {
    logger.error(
      `${ASK_SERVICE_KEY_ENV} is not set (or shorter than ${MIN_KEY_LENGTH} characters): the ask background read is closed`,
    );
    return c.json(
      {
        code: "service_unavailable",
        message: "this internal read is not configured",
      },
      503,
    );
  }
  const presented = c.req.header(SERVICE_KEY_HEADER);
  // Compared as fixed-length digests, so neither the length nor the content
  // of the configured key leaks through timing.
  if (
    presented === undefined ||
    presented.length === 0 ||
    !timingSafeEqual(digest(presented), digest(configured))
  ) {
    return c.json(
      { code: "unauthorized", message: "service authentication required" },
      401,
    );
  }
  await next();
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function createAskInternalRoutes(deps: TravelDeps): Hono {
  const routes = new Hono();
  routes.use("*", askServiceAuth);

  routes.get("/grants/:grantId/orders/:orderId", async (c) => {
    try {
      const grantId = c.req.param("grantId");
      const orderId = c.req.param("orderId");
      const order = await deps.db.travelOrder.findUnique({
        where: { id: orderId },
      });
      // Not booked under an AI grant, or under a different one: the same
      // answer as no order at all, so the key learns nothing it may not read.
      if (
        order === null ||
        order.grantId === null ||
        order.grantId !== grantId
      ) {
        throw new ContractError("not_found", "no such order", { orderId });
      }
      const status: AskOrderStatus = {
        orderId: order.id,
        kind: order.kind,
        state: order.state,
        stateAt: order.stateAt.toISOString(),
        supplierRefs: asRecord(order.supplierRefs),
        ownerId: order.userId,
      };
      return c.json(status, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
