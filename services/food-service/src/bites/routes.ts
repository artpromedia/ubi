/**
 * The Bites HTTP surface.
 *
 * Four sub-apps mounted by `src/index.ts`:
 *   /v1/bites      — discovery (feed, search)
 *   /v1/merchants  — onboarding, KYB review, the merchant console
 *   /v1/carts      — the cart (server-recomputed prices)
 *   /v1/orders     — placement, the merchant lifecycle, courier hand-offs, issues
 *
 * Every body and query is a zod schema, so anything outside the closed sets
 * (reject reasons, issue types, availability actions, decisions) is refused with
 * 422 before it reaches a handler.
 */
import { Hono } from "hono";
import { z } from "zod";

import { ContractError } from "@ubi/contracts";

import {
  actorOf,
  cityOf,
  correlationIdOf,
  failure,
  gatewayAuth,
  idempotencyKeyOf,
  parseBody,
  parseLimit,
} from "./middleware.js";
import { addItem, getCart } from "./services/carts.js";
import { feed, search } from "./services/discovery.js";
import { getConsoleMenu, getPublicMenu } from "./services/menu.js";
import {
  applyMerchant,
  createMenuItem,
  createOutlet,
  getPayouts,
  listMerchantOrders,
  pauseStore,
  reviewMerchant,
  setAvailability,
} from "./services/merchants.js";
import {
  acceptOrder,
  advanceOrder,
  deliverOrder,
  getOrder,
  handoverOrder,
  ISSUE_TYPES,
  placeOrder,
  rejectOrder,
  REJECT_REASONS,
  reportIssue,
  respondIssue,
} from "./services/orders.js";

import type { BitesDeps } from "./context.js";
import type { JsonRecord } from "./lib/types.js";

const HoursSchema = z.record(z.unknown()).optional();

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export function createDiscoveryRoutes(deps: BitesDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.get("/feed", async (c) => {
    try {
      const addressId = c.req.query("addressId");
      if (addressId === undefined || addressId.length === 0) {
        throw new ContractError("validation_failed", "addressId is required");
      }
      return c.json(await feed(deps, cityOf(c), addressId), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/search", async (c) => {
    try {
      const result = await search(deps, cityOf(c), {
        q: c.req.query("q"),
        openNow: c.req.query("openNow") === "true",
        limit: parseLimit(c.req.query("limit"), 50, 100),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}

// ---------------------------------------------------------------------------
// Merchants & console
// ---------------------------------------------------------------------------

const ApplyBody = z.object({
  legalName: z.string().min(1).max(200),
  tradeName: z.string().min(1).max(200),
  cacRc: z.string().min(1).max(40),
  tin: z.string().min(1).max(40),
  ownerNin: z.string().min(1).max(40),
  ownerSelfieRef: z.string().min(1).max(400),
  ownerSelfieScore: z.number().min(0).max(1).optional(),
  hygienePermitRef: z.string().min(1).max(400),
  permitExpiry: z.coerce.date().optional(),
  outlet: z.object({
    address: z.string().min(1).max(400),
    lat: z.number(),
    lng: z.number(),
    hours: HoursSchema,
  }),
});

const ReviewBody = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(1).max(400),
});

const OutletBody = z.object({
  address: z.string().min(1).max(400),
  lat: z.number(),
  lng: z.number(),
  hours: HoursSchema,
});

const OptionInput = z.object({
  name: z.string().min(1).max(120),
  priceDeltaMinor: z.number().int(),
});
const OptionGroupInputSchema = z.object({
  name: z.string().min(1).max(120),
  required: z.boolean(),
  minSelect: z.number().int().min(0),
  maxSelect: z.number().int().min(1),
  options: z.array(OptionInput).min(1),
});
const MenuItemBody = z.object({
  outletId: z.string().min(1),
  category: z.string().min(1).max(80).nullable().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  // The merchant's own price; the currency is server-side from city config.
  priceMinor: z.number().int().nonnegative(),
  allergens: z.array(z.string().min(1)).optional(),
  photoRef: z.string().max(400).nullable().optional(),
  optionGroups: z.array(OptionGroupInputSchema).optional(),
});

const AvailabilityBody = z.object({
  action: z.enum(["sold_out", "available", "activate", "deactivate"]),
  soldOutUntil: z.coerce.date().optional(),
});

const PauseBody = z.object({ pausedUntil: z.coerce.date() });

export function createMerchantRoutes(deps: BitesDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.post("/", async (c) => {
    try {
      const body = await parseBody(c, ApplyBody);
      const result = await applyMerchant(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        legalName: body.legalName,
        tradeName: body.tradeName,
        cacRc: body.cacRc,
        tin: body.tin,
        ownerNin: body.ownerNin,
        ownerSelfieRef: body.ownerSelfieRef,
        ...(body.ownerSelfieScore === undefined
          ? {}
          : { ownerSelfieScore: body.ownerSelfieScore }),
        hygienePermitRef: body.hygienePermitRef,
        permitExpiry: body.permitExpiry ?? null,
        outlet: {
          address: body.outlet.address,
          lat: body.outlet.lat,
          lng: body.outlet.lng,
          hours: (body.outlet.hours ?? null) as JsonRecord | null,
        },
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/:id/menu", async (c) => {
    try {
      return c.json(
        await getPublicMenu(deps, cityOf(c), c.req.param("id")),
        200,
      );
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/:id/console/menu", async (c) => {
    try {
      return c.json(
        await getConsoleMenu(deps, actorOf(c), c.req.param("id")),
        200,
      );
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:id/review", async (c) => {
    try {
      const body = await parseBody(c, ReviewBody);
      const result = await reviewMerchant(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        merchantId: c.req.param("id"),
        decision: body.decision,
        reason: body.reason,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:id/outlets", async (c) => {
    try {
      const body = await parseBody(c, OutletBody);
      const result = await createOutlet(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        merchantId: c.req.param("id"),
        address: body.address,
        lat: body.lat,
        lng: body.lng,
        hours: (body.hours ?? null) as JsonRecord | null,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:id/menu-items", async (c) => {
    try {
      const body = await parseBody(c, MenuItemBody);
      const result = await createMenuItem(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        outletId: body.outletId,
        category: body.category ?? null,
        name: body.name,
        description: body.description ?? null,
        priceMinor: body.priceMinor,
        allergens: body.allergens ?? [],
        photoRef: body.photoRef ?? null,
        optionGroups: (body.optionGroups ?? []).map((group) => ({
          name: group.name,
          required: group.required,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          options: group.options.map((option) => ({
            name: option.name,
            priceDeltaMinor: option.priceDeltaMinor,
          })),
        })),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:id/items/:itemId/availability", async (c) => {
    try {
      const body = await parseBody(c, AvailabilityBody);
      const result = await setAvailability(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        itemId: c.req.param("itemId"),
        action: body.action,
        soldOutUntil: body.soldOutUntil ?? null,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:id/outlets/:outletId/pause", async (c) => {
    try {
      const body = await parseBody(c, PauseBody);
      const result = await pauseStore(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        outletId: c.req.param("outletId"),
        pausedUntil: body.pausedUntil,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/:id/orders", async (c) => {
    try {
      const status = c.req.query("status");
      const result = await listMerchantOrders(
        deps,
        actorOf(c),
        c.req.param("id"),
        {
          ...(status === undefined ? {} : { status }),
          limit: parseLimit(c.req.query("limit"), 50, 200),
        },
      );
      return c.json({ orders: result }, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/:id/payouts", async (c) => {
    try {
      const result = await getPayouts(deps, actorOf(c), c.req.param("id"));
      return c.json({ payouts: result }, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}

// ---------------------------------------------------------------------------
// Carts
// ---------------------------------------------------------------------------

const AddItemBody = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive().max(50),
  optionIds: z.array(z.string().min(1)).optional(),
  // NOTE: no `price` field — a client-supplied price is intentionally not read.
});

export function createCartRoutes(deps: BitesDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.post("/:id/items", async (c) => {
    try {
      const body = await parseBody(c, AddItemBody);
      const result = await addItem(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        cartId: c.req.param("id"),
        itemId: body.itemId,
        quantity: body.quantity,
        optionIds: body.optionIds ?? [],
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/:id", async (c) => {
    try {
      return c.json(await getCart(deps, actorOf(c), c.req.param("id")), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const PlaceOrderBody = z.object({
  cartId: z.string().min(1),
  addressId: z.string().min(1),
  paymentMethodId: z.string().min(1),
});

const RejectBody = z.object({
  reason: z.enum(REJECT_REASONS),
  itemId: z.string().min(1).optional(),
  pausedUntil: z.coerce.date().optional(),
});

const AdvanceBody = z.object({ to: z.enum(["preparing", "ready"]) });

const HandoverBody = z.object({ handoverCode: z.string().min(1).max(12) });

const DeliverBody = z
  .object({
    deliveryCode: z.string().min(1).max(12).optional(),
    photoRef: z.string().min(1).max(400).optional(),
  })
  .refine(
    (body) => body.deliveryCode !== undefined || body.photoRef !== undefined,
    {
      message: "provide the delivery code or a drop photo",
    },
  );

const IssueBody = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  type: z.enum(ISSUE_TYPES),
  photoRef: z.string().min(1).max(400).optional(),
});

const RespondBody = z.object({
  decision: z.enum(["accept", "redeliver", "dispute"]),
});

export function createOrderRoutes(deps: BitesDeps): Hono {
  const routes = new Hono();
  routes.use("*", gatewayAuth);

  routes.post("/", async (c) => {
    try {
      const body = await parseBody(c, PlaceOrderBody);
      const result = await placeOrder(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        cartId: body.cartId,
        addressId: body.addressId,
        paymentMethodId: body.paymentMethodId,
        idempotencyKey: idempotencyKeyOf(c),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get("/:id", async (c) => {
    try {
      return c.json(await getOrder(deps, actorOf(c), c.req.param("id")), 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:id/accept", async (c) => {
    try {
      const result = await acceptOrder(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        orderId: c.req.param("id"),
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:id/reject", async (c) => {
    try {
      const body = await parseBody(c, RejectBody);
      const result = await rejectOrder(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        orderId: c.req.param("id"),
        reason: body.reason,
        itemId: body.itemId ?? null,
        pausedUntil: body.pausedUntil ?? null,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:id/advance", async (c) => {
    try {
      const body = await parseBody(c, AdvanceBody);
      const result = await advanceOrder(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        orderId: c.req.param("id"),
        to: body.to,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:id/handover", async (c) => {
    try {
      const body = await parseBody(c, HandoverBody);
      const result = await handoverOrder(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        orderId: c.req.param("id"),
        handoverCode: body.handoverCode,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:id/deliver", async (c) => {
    try {
      const body = await parseBody(c, DeliverBody);
      const result = await deliverOrder(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        orderId: c.req.param("id"),
        deliveryCode: body.deliveryCode ?? null,
        photoRef: body.photoRef ?? null,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:id/issues", async (c) => {
    try {
      const body = await parseBody(c, IssueBody);
      const result = await reportIssue(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        orderId: c.req.param("id"),
        items: body.items,
        type: body.type,
        photoRef: body.photoRef ?? null,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post("/:id/issues/:issueId/respond", async (c) => {
    try {
      const body = await parseBody(c, RespondBody);
      const result = await respondIssue(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        orderId: c.req.param("id"),
        issueId: c.req.param("issueId"),
        decision: body.decision,
        correlationId: correlationIdOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
