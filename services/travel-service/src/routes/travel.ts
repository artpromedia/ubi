/**
 * `/v1/travel/*` (contracts/openapi/travel-v2.yaml).
 *
 * The routes are thin: they read the actor and city from the gateway headers,
 * validate the body with zod, and delegate to the ops modules. Every promise on
 * an offer comes from the adapter capability record; nothing is invented here.
 */
import { Hono } from "hono";
import { z } from "zod";

import {
  actorOf,
  cityOf,
  correlationIdOf,
  failure,
  gatewayAuth,
  idempotencyKeyOf,
} from "../middleware";
import { parseBody } from "./parse";
import { createCart, setPassengers } from "../ops/carts";
import { checkout } from "../ops/checkout";
import { getDisruption, switchOrder } from "../ops/disruptions";
import { cancelOrder, getOrder } from "../ops/orders";
import { getRefund } from "../ops/refunds";
import {
  flightSearch,
  refreshFlightSearch,
  staySearch,
  stayRates,
} from "../ops/search";
import { getLinked, getTrip } from "../ops/trips";

import type { TravelDeps } from "../ops/context";
import type { JsonRecord } from "../ops/types";

const MoneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const FlightSearchBody = z.object({
  from: z.string().min(3).max(4),
  to: z.string().min(3).max(4),
  departDate: z.string(),
  returnDate: z.string().optional(),
  passengers: z.number().int().min(1),
  cabin: z.enum(["economy", "business"]).optional(),
});

const StaySearchBody = z.object({
  city: z.string().min(1),
  near: z.string().optional(),
  checkIn: z.string(),
  checkOut: z.string(),
  guests: z.number().int().min(1),
});

const CartBody = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(["flight", "stay"]),
        offerRef: z.string().min(1),
        fareFamilyId: z.string().optional(),
        rateId: z.string().optional(),
      }),
    )
    .min(1),
});

const PassengersBody = z.array(
  z.object({
    givenNames: z.string().min(1),
    surname: z.string().min(1),
    title: z.string().optional(),
    dateOfBirth: z.string(),
    phone: z.string().min(1),
    identityRef: z.string().optional(),
    save: z.boolean().optional(),
  }),
);

const CheckoutBody = z.object({
  paymentMethodId: z.string().min(1),
  grantId: z.string().optional(),
  assurance: z.object({ method: z.string(), proof: z.string().optional() }).optional(),
  expectedTotal: MoneySchema.optional(),
});

const SwitchBody = z.object({
  alternativeId: z.string().min(1),
  grantId: z.string().optional(),
});

export function createTravelRoutes(deps: TravelDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.post("/flights/searches", async (c) => {
    try {
      const body = await parseBody(c, FlightSearchBody);
      const result = await flightSearch(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        params: body,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/flights/searches/:id", async (c) => {
    try {
      const result = await refreshFlightSearch(deps, actorOf(c), c.req.param("id"));
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/stays/searches", async (c) => {
    try {
      const body = await parseBody(c, StaySearchBody);
      const result = await staySearch(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        params: body,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/stays/:propertyId/rates", async (c) => {
    try {
      const searchId = c.req.query("searchId");
      if (searchId === undefined) {
        return c.json(
          { code: "validation_failed", message: "searchId is required" },
          422,
        );
      }
      const rates = await stayRates(
        deps,
        actorOf(c),
        c.req.param("propertyId"),
        searchId,
      );
      return c.json(rates, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/carts", async (c) => {
    try {
      const body = await parseBody(c, CartBody);
      const result = await createCart(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        items: body.items,
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.put("/carts/:id/passengers", async (c) => {
    try {
      const body = await parseBody(c, PassengersBody);
      const result = await setPassengers(deps, {
        actor: actorOf(c),
        cartId: c.req.param("id"),
        passengers: body as unknown as JsonRecord[],
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/carts/:id/checkout", async (c) => {
    try {
      const body = await parseBody(c, CheckoutBody);
      const result = await checkout(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        cartId: c.req.param("id"),
        paymentMethodId: body.paymentMethodId,
        grantId: body.grantId ?? null,
        assuranceMethod: body.assurance?.method ?? null,
        expectedTotal: body.expectedTotal ?? null,
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      if (result.kind === "repriced") {
        return c.json(result.cart, 409);
      }
      return c.json({ tripId: result.tripId, orders: result.orders }, 202);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/orders/:id", async (c) => {
    try {
      const result = await getOrder(deps, actorOf(c), c.req.param("id"));
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/orders/:id/cancel", async (c) => {
    try {
      const result = await cancelOrder(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        orderId: c.req.param("id"),
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 202);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/refunds/:id", async (c) => {
    try {
      const result = await getRefund(deps, actorOf(c), c.req.param("id"));
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/orders/:id/disruption", async (c) => {
    try {
      const result = await getDisruption(deps, actorOf(c), c.req.param("id"));
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/orders/:id/switch", async (c) => {
    try {
      const body = await parseBody(c, SwitchBody);
      const result = await switchOrder(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        orderId: c.req.param("id"),
        alternativeId: body.alternativeId,
        grantId: body.grantId ?? null,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 202);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/trips/:id", async (c) => {
    try {
      const result = await getTrip(deps, actorOf(c), c.req.param("id"));
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/trips/:id/linked", async (c) => {
    try {
      const result = await getLinked(deps, actorOf(c), c.req.param("id"));
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
