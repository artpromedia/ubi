/**
 * Order Routes
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import {
  calculateOrderTotals,
  generateId,
  generateOrderNumber,
} from "../lib/utils";
import {
  ItemAvailability,
  OrderStatus,
  OrderType,
  PaymentStatus,
} from "../types";

const orderRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const orderItemSchema = z.object({
  menuItemId: z.string(),
  quantity: z.number().int().min(1).max(99),
  selectedOptions: z
    .array(
      z.object({
        optionId: z.string(),
        choiceId: z.string(),
      })
    )
    .default([]),
  selectedAddons: z.array(z.string()).default([]),
  specialInstructions: z.string().max(500).optional(),
});

const deliveryAddressSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().optional(),
  country: z.string().min(2).max(2),
  postalCode: z.string().optional(),
});

const createOrderSchema = z.object({
  restaurantId: z.string(),
  type: z.nativeEnum(OrderType),
  items: z.array(orderItemSchema).min(1),
  deliveryAddress: deliveryAddressSchema.optional(),
  deliveryInstructions: z.string().max(500).optional(),
  customerNote: z.string().max(500).optional(),
  tip: z.number().min(0).default(0),
  promoCode: z.string().optional(),
});

const updateOrderStatusSchema = z.object({
  status: z.nativeEnum(OrderStatus),
  note: z.string().max(500).optional(),
  estimatedTime: z.number().int().min(1).optional(), // minutes
});

// ============================================
// Routes
// ============================================

/**
 * POST /orders - Create new order
 */
orderRoutes.post("/", zValidator("json", createOrderSchema), async (c) => {
  const customerId = c.get("userId");
  const data = c.req.valid("json");
  const idempotencyKey = c.req.header("X-Idempotency-Key");

  // Check idempotency
  if (idempotencyKey) {
    const existing = await redis.get(`idempotency:order:${idempotencyKey}`);
    if (existing) {
      return c.json(JSON.parse(existing));
    }
  }

  // Validate delivery address for delivery orders
  if (data.type === OrderType.DELIVERY && !data.deliveryAddress) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Delivery address is required",
        },
      },
      400
    );
  }

  // Get restaurant
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: data.restaurantId },
  });

  if (!restaurant) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Restaurant not found" },
      },
      404
    );
  }

  if (restaurant.status !== "ACTIVE") {
    return c.json(
      {
        success: false,
        error: {
          code: "RESTAURANT_UNAVAILABLE",
          message: "Restaurant is not accepting orders",
        },
      },
      400
    );
  }

  // Get all menu items
  const menuItemIds = data.items.map((i) => i.menuItemId);
  const menuItems = await prisma.menuItem.findMany({
    where: {
      id: { in: menuItemIds },
      restaurantId: data.restaurantId,
      isActive: true,
    },
  });

  if (menuItems.length !== menuItemIds.length) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_ITEMS",
          message: "Some menu items are not available",
        },
      },
      400
    );
  }

  // Check availability
  const unavailableItems = menuItems.filter(
    (i: (typeof menuItems)[number]) =>
      i.availability === ItemAvailability.OUT_OF_STOCK
  );
  if (unavailableItems.length > 0) {
    return c.json(
      {
        success: false,
        error: {
          code: "ITEMS_OUT_OF_STOCK",
          message: "Some items are out of stock",
          details: {
            items: unavailableItems.map(
              (i: (typeof menuItems)[number]) => i.name
            ),
          },
        },
      },
      400
    );
  }

  // Build order items with prices
  const orderItems = data.items.map((item) => {
    const menuItem = menuItems.find(
      (mi: (typeof menuItems)[number]) => mi.id === item.menuItemId
    )!;
    let itemPrice = menuItem.discountPrice || menuItem.price;

    // Calculate option price modifiers
    const selectedOptions = item.selectedOptions.map((so) => {
      const option = (menuItem.options as any[]).find(
        (o) => o.id === so.optionId
      );
      const choice = option?.choices.find((ch: any) => ch.id === so.choiceId);

      if (choice) {
        itemPrice += choice.priceModifier;
      }

      return {
        optionId: so.optionId,
        optionName: option?.name || "",
        choiceId: so.choiceId,
        choiceName: choice?.name || "",
        priceModifier: choice?.priceModifier || 0,
      };
    });

    // Calculate addon prices
    const selectedAddons = item.selectedAddons.map((addonId) => {
      const addon = (menuItem.addons as any[]).find((a) => a.id === addonId);

      if (addon) {
        itemPrice += addon.price;
      }

      return {
        addonId,
        addonName: addon?.name || "",
        price: addon?.price || 0,
      };
    });

    return {
      id: generateId("oit"),
      menuItemId: item.menuItemId,
      name: menuItem.name,
      quantity: item.quantity,
      unitPrice: itemPrice,
      totalPrice: itemPrice * item.quantity,
      selectedOptions,
      selectedAddons,
      specialInstructions: item.specialInstructions,
    };
  });

  // Calculate totals
  const totals = calculateOrderTotals(orderItems, {
    deliveryFee: data.type === OrderType.DELIVERY ? restaurant.deliveryFee : 0,
    tip: data.tip,
    currency: restaurant.currency || "NGN",
  });

  // Check minimum order
  if (totals.subtotal < restaurant.minimumOrder) {
    return c.json(
      {
        success: false,
        error: {
          code: "BELOW_MINIMUM",
          message: `Minimum order is ${restaurant.minimumOrder} ${restaurant.currency || "NGN"}`,
        },
      },
      400
    );
  }

  // Calculate estimated prep time
  const maxPrepTime = Math.max(
    ...menuItems.map((i: (typeof menuItems)[number]) => i.prepTime || 15)
  );
  const estimatedPrepTime = maxPrepTime + Math.floor(orderItems.length / 3) * 5;

  const orderId = generateId("ord");
  const orderNumber = generateOrderNumber();

  // Create order
  const order = await prisma.order.create({
    data: {
      id: orderId,
      orderNumber,
      customerId,
      restaurantId: data.restaurantId,
      type: data.type,
      status: OrderStatus.PENDING,
      items: orderItems,
      subtotal: totals.subtotal,
      deliveryFee: totals.deliveryFee,
      serviceFee: totals.serviceFee,
      tax: totals.tax,
      tip: totals.tip,
      discount: totals.discount,
      total: totals.total,
      currency: restaurant.currency || "NGN",
      paymentStatus: PaymentStatus.PENDING,
      deliveryAddress: data.deliveryAddress,
      deliveryInstructions: data.deliveryInstructions,
      estimatedPrepTime,
      customerNote: data.customerNote,
    },
  });

  // Publish order event
  await redis.publish(
    "order:created",
    JSON.stringify({
      type: "order.created",
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId,
      restaurantId: data.restaurantId,
      total: order.total,
      timestamp: new Date().toISOString(),
    })
  );

  const response = {
    success: true,
    data: {
      ...order,
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        phone: restaurant.phone,
      },
    },
  };

  if (idempotencyKey) {
    await redis.setex(
      `idempotency:order:${idempotencyKey}`,
      86400,
      JSON.stringify(response)
    );
  }

  return c.json(response, 201);
});

/**
 * GET /orders - Get user's orders
 */
orderRoutes.get("/", async (c) => {
  const customerId = c.get("userId");
  const status = c.req.query("status") as OrderStatus;
  const page = Number.parseInt(c.req.query("page") || "1");
  const limit = Number.parseInt(c.req.query("limit") || "20");

  const where: any = { customerId };
  if (status) {
    where.status = status;
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        restaurant: {
          select: { id: true, name: true, logo: true },
        },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return c.json({
    success: true,
    data: orders,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * GET /orders/active - Get user's active orders
 */
orderRoutes.get("/active", async (c) => {
  const customerId = c.get("userId");

  const activeStatuses = [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.PICKED_UP,
  ];

  const orders = await prisma.order.findMany({
    where: {
      customerId,
      status: { in: activeStatuses },
    },
    orderBy: { createdAt: "desc" },
    include: {
      restaurant: {
        select: {
          id: true,
          name: true,
          phone: true,
          logo: true,
          location: true,
        },
      },
    },
  });

  return c.json({
    success: true,
    data: orders,
  });
});

/**
 * GET /orders/:id - Get order details
 */
orderRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("userId");

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      restaurant: {
        select: {
          id: true,
          name: true,
          phone: true,
          logo: true,
          location: true,
        },
      },
    },
  });

  if (!order) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Order not found" },
      },
      404
    );
  }

  // Check access
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: order.restaurantId },
  });

  const isCustomer = order.customerId === userId;
  const isRestaurantOwner = restaurant?.ownerId === userId;
  const isDriver = order.driverId === userId;

  if (!isCustomer && !isRestaurantOwner && !isDriver) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not authorized" },
      },
      403
    );
  }

  return c.json({
    success: true,
    data: order,
  });
});

/**
 * GET /orders/:id/track - Get order tracking info
 */
orderRoutes.get("/:id/track", async (c) => {
  const id = c.req.param("id");

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      type: true,
      estimatedPrepTime: true,
      estimatedDeliveryTime: true,
      confirmedAt: true,
      preparingAt: true,
      readyAt: true,
      pickedUpAt: true,
      deliveredAt: true,
      driverId: true,
      deliveryAddress: true,
      restaurant: {
        select: { id: true, name: true, location: true, phone: true },
      },
    },
  });

  if (!order) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Order not found" },
      },
      404
    );
  }

  // Get driver location if assigned
  let driverLocation = null;
  if (order.driverId && ["PICKED_UP"].includes(order.status)) {
    const locationData = await redis.get(`driver:location:${order.driverId}`);
    if (locationData) {
      driverLocation = JSON.parse(locationData);
    }
  }

  return c.json({
    success: true,
    data: {
      ...order,
      driverLocation,
      timeline: buildOrderTimeline(order),
    },
  });
});

/**
 * PUT /orders/:id/status - Update order status (restaurant)
 */
orderRoutes.put(
  "/:id/status",
  zValidator("json", updateOrderStatusSchema),
  async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");
    const { status, note, estimatedTime } = c.req.valid("json");

    const order = await prisma.order.findUnique({
      where: { id },
      include: { restaurant: true },
    });

    if (!order) {
      return c.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Order not found" },
        },
        404
      );
    }

    // Verify restaurant owner or driver
    const isRestaurantOwner = order.restaurant.ownerId === userId;
    const isDriver = order.driverId === userId;

    if (!isRestaurantOwner && !isDriver) {
      return c.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "Not authorized" },
        },
        403
      );
    }

    // Validate status transition
    if (!isValidStatusTransition(order.status as OrderStatus, status)) {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_TRANSITION",
            message: `Cannot transition from ${order.status} to ${status}`,
          },
        },
        400
      );
    }

    // Build update data
    const updateData: any = {
      status,
      restaurantNote: note,
    };

    // Set timestamps based on status
    switch (status) {
      case OrderStatus.CONFIRMED:
        updateData.confirmedAt = new Date();
        if (estimatedTime) {
          updateData.estimatedPrepTime = estimatedTime;
        }
        break;
      case OrderStatus.PREPARING:
        updateData.preparingAt = new Date();
        break;
      case OrderStatus.READY_FOR_PICKUP:
        updateData.readyAt = new Date();
        updateData.actualPrepTime = Math.round(
          (Date.now() -
            (order.preparingAt?.getTime() ||
              order.confirmedAt?.getTime() ||
              Date.now())) /
            60000
        );
        break;
      case OrderStatus.PICKED_UP:
        updateData.pickedUpAt = new Date();
        break;
      case OrderStatus.DELIVERED:
        updateData.deliveredAt = new Date();
        updateData.actualDeliveryTime = Math.round(
          (Date.now() - (order.pickedUpAt?.getTime() || Date.now())) / 60000
        );
        break;
    }

    const updated = await prisma.order.update({
      where: { id },
      data: updateData,
    });

    // Publish status event
    await redis.publish(
      "order:status",
      JSON.stringify({
        type: `order.${status.toLowerCase()}`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        restaurantId: order.restaurantId,
        driverId: order.driverId,
        status,
        timestamp: new Date().toISOString(),
      })
    );

    return c.json({
      success: true,
      data: updated,
    });
  }
);

/**
 * POST /orders/:id/cancel - Cancel order
 */
orderRoutes.post("/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("userId");
  const { reason } = await c.req.json<{ reason: string }>();

  const order = await prisma.order.findUnique({
    where: { id },
    include: { restaurant: true },
  });

  if (!order) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Order not found" },
      },
      404
    );
  }

  const isCustomer = order.customerId === userId;
  const isRestaurantOwner = order.restaurant.ownerId === userId;

  if (!isCustomer && !isRestaurantOwner) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not authorized" },
      },
      403
    );
  }

  // Can only cancel pending or confirmed orders
  if (
    ![OrderStatus.PENDING, OrderStatus.CONFIRMED].includes(
      order.status as OrderStatus
    )
  ) {
    return c.json(
      {
        success: false,
        error: {
          code: "CANNOT_CANCEL",
          message: "Order cannot be cancelled at this stage",
        },
      },
      400
    );
  }

  const updated = await prisma.order.update({
    where: { id },
    data: {
      status: OrderStatus.CANCELLED,
      cancelledAt: new Date(),
      cancellationReason: reason,
    },
  });

  // Request refund if paid
  if (order.paymentStatus === PaymentStatus.PAID) {
    await redis.publish(
      "order:refund",
      JSON.stringify({
        orderId: order.id,
        customerId: order.customerId,
        amount: order.total,
        currency: order.currency,
        reason,
      })
    );
  }

  return c.json({
    success: true,
    data: updated,
  });
});

/**
 * POST /orders/:id/assign-driver - Assign driver to order (internal)
 */
orderRoutes.post("/:id/assign-driver", async (c) => {
  const serviceKey = c.req.header("X-Service-Key");
  if (serviceKey !== process.env.INTERNAL_SERVICE_KEY) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Internal endpoint" },
      },
      403
    );
  }

  const id = c.req.param("id");
  const { driverId, estimatedDeliveryTime } = await c.req.json<{
    driverId: string;
    estimatedDeliveryTime: number;
  }>();

  const order = await prisma.order.findUnique({
    where: { id },
  });

  if (!order) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Order not found" },
      },
      404
    );
  }

  if (order.type !== OrderType.DELIVERY) {
    return c.json(
      {
        success: false,
        error: {
          code: "NOT_DELIVERY",
          message: "Order is not a delivery order",
        },
      },
      400
    );
  }

  const updated = await prisma.order.update({
    where: { id },
    data: {
      driverId,
      estimatedDeliveryTime,
    },
  });

  return c.json({
    success: true,
    data: updated,
  });
});

/**
 * GET /orders/restaurant/:restaurantId - Get orders for restaurant
 */
orderRoutes.get("/restaurant/:restaurantId", async (c) => {
  const restaurantId = c.req.param("restaurantId");
  const userId = c.get("userId");
  const status = c.req.query("status") as OrderStatus;
  const page = Number.parseInt(c.req.query("page") || "1");
  const limit = Number.parseInt(c.req.query("limit") || "50");

  // Verify restaurant owner
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
  });

  if (restaurant?.ownerId !== userId) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not authorized" },
      },
      403
    );
  }

  const where: any = { restaurantId };
  if (status) {
    where.status = status;
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return c.json({
    success: true,
    data: orders,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * GET /orders/restaurant/:restaurantId/active - Get active orders for KDS
 */
orderRoutes.get("/restaurant/:restaurantId/active", async (c) => {
  const restaurantId = c.req.param("restaurantId");
  const userId = c.get("userId");

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
  });

  if (restaurant?.ownerId !== userId) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not authorized" },
      },
      403
    );
  }

  const activeStatuses = [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.READY_FOR_PICKUP,
  ];

  const orders = await prisma.order.findMany({
    where: {
      restaurantId,
      status: { in: activeStatuses },
    },
    orderBy: { createdAt: "asc" }, // Oldest first
  });

  return c.json({
    success: true,
    data: orders,
  });
});

// ============================================
// Helpers
// ============================================

function isValidStatusTransition(
  current: OrderStatus,
  next: OrderStatus
): boolean {
  const transitions: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
    [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
    [OrderStatus.PREPARING]: [OrderStatus.READY_FOR_PICKUP],
    [OrderStatus.READY_FOR_PICKUP]: [
      OrderStatus.PICKED_UP,
      OrderStatus.DELIVERED,
    ], // DELIVERED for pickup orders
    [OrderStatus.PICKED_UP]: [OrderStatus.DELIVERED],
    [OrderStatus.DELIVERED]: [],
    [OrderStatus.CANCELLED]: [],
    [OrderStatus.REFUNDED]: [],
  };

  return transitions[current]?.includes(next) || false;
}

function buildOrderTimeline(order: any) {
  const timeline = [
    {
      status: "PENDING",
      label: "Order Placed",
      timestamp: order.createdAt,
      completed: true,
    },
    {
      status: "CONFIRMED",
      label: "Order Confirmed",
      timestamp: order.confirmedAt,
      completed: !!order.confirmedAt,
    },
    {
      status: "PREPARING",
      label: "Preparing",
      timestamp: order.preparingAt,
      completed: !!order.preparingAt,
    },
    {
      status: "READY_FOR_PICKUP",
      label: order.type === "PICKUP" ? "Ready for Pickup" : "Ready",
      timestamp: order.readyAt,
      completed: !!order.readyAt,
    },
  ];

  if (order.type === "DELIVERY") {
    timeline.push(
      {
        status: "PICKED_UP",
        label: "Out for Delivery",
        timestamp: order.pickedUpAt,
        completed: !!order.pickedUpAt,
      },
      {
        status: "DELIVERED",
        label: "Delivered",
        timestamp: order.deliveredAt,
        completed: !!order.deliveredAt,
      }
    );
  }

  return timeline;
}

export { orderRoutes };
