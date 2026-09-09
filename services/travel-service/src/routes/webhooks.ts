/**
 * `/v1/travel/webhooks/:supplierId` — supplier callbacks.
 *
 * These are authenticated by the HMAC signature over the raw body, not by the
 * gateway actor headers, so this router does NOT use `gatewayAuth`. The raw body
 * is read verbatim (`c.req.text()`) before any parsing, because the signature is
 * computed over the exact bytes the supplier sent.
 */
import { Hono } from "hono";
import { z } from "zod";

import { ContractError } from "@ubi/contracts";

import { failure } from "../middleware";
import { receiveWebhook, type WebhookEnvelope } from "../ops/webhooks";

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
      const supplierId = c.req.param("supplierId");
      const cityId = c.req.header("X-City-ID");
      if (cityId === undefined || cityId.length === 0) {
        throw new ContractError("city_unsupported", "the webhook does not name a city");
      }
      const rawBody = await c.req.text();
      let parsedEnvelope: unknown;
      try {
        parsedEnvelope = JSON.parse(rawBody);
      } catch {
        throw new ContractError("validation_failed", "the webhook body is not JSON");
      }
      const envelope = EnvelopeSchema.parse(parsedEnvelope) as WebhookEnvelope;
      const signature = c.req.header("X-Signature") ?? null;

      const outcome = await receiveWebhook(deps, {
        supplierId,
        cityId,
        rawBody,
        signature,
        envelope,
      });
      const status = outcome.result === "rejected" ? 400 : 200;
      return c.json(outcome, status);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
