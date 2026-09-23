/**
 * `/v1/travel/webhooks/:supplierId` — supplier callbacks.
 *
 * These are authenticated by each supplier's own scheme over the raw body —
 * Duffel's timestamped `X-Duffel-Signature`, LiteAPI's `authorization`
 * token, the fixture's `X-Signature` HMAC — not by the gateway actor headers,
 * so this router does NOT use `gatewayAuth`. The raw body is read verbatim
 * (`c.req.text()`) before any parsing, because signatures are computed over
 * the exact bytes the supplier sent. A live supplier's order carries its own
 * city; only the fixture envelope needs `X-City-ID`.
 */
import { Hono } from "hono";
import { z } from "zod";

import { failure } from "../middleware";
import { receiveSupplierWebhook, type WebhookEnvelope } from "../ops/webhooks";

import type { TravelDeps } from "../ops/context";

const AlternativeSchema = z.object({
  id: z.string(),
  carrier: z.string(),
  flightNumber: z.string(),
  departAt: z.string(),
  arriveAt: z.string(),
  fareFamily: z.string().optional(),
  priceMinor: z.number().int(),
  coveredMinor: z.number().int(),
  customerPaysMinor: z.number().int(),
  heldUntil: z.string().optional(),
});

const EnvelopeSchema = z.object({
  externalId: z.string().min(1),
  type: z.string().min(1),
  orderRef: z.string().optional(),
  supplierRefs: z.record(z.unknown()).optional(),
  documentsIssued: z.boolean().optional(),
  invoicedMinor: z.number().int().optional(),
  disruption: z
    .object({
      cause: z.enum(["airline_cancelled", "schedule_change", "delay_major"]),
      covered: z.boolean(),
      ruleId: z.string().optional(),
      fundedBy: z.string().optional(),
      capMinor: z.number().int().optional(),
      alternatives: z.array(AlternativeSchema).optional(),
      airlineOptions: z.array(AlternativeSchema).optional(),
    })
    .optional(),
});

export function createWebhookRoutes(deps: TravelDeps): Hono {
  const routes = new Hono();

  routes.post("/:supplierId", async (c) => {
    try {
      const rawBody = await c.req.text();
      const outcome = await receiveSupplierWebhook(deps, {
        supplierId: c.req.param("supplierId"),
        rawBody,
        header: (name) => c.req.header(name) ?? null,
        cityId: c.req.header("X-City-ID") ?? null,
        parseEnvelope: (raw) => EnvelopeSchema.parse(raw) as WebhookEnvelope,
      });
      const status = outcome.result === "rejected" ? 400 : 200;
      return c.json(outcome, status);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
