/**
 * Restaurant Routes
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { cache, redis } from "../lib/redis";
import { generateId, generateSlug } from "../lib/utils";
import { CuisineType, DayOfWeek, RestaurantStatus } from "../types";

const restaurantRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().optional(),
  country: z.string().min(2).max(2),
  postalCode: z.string().optional(),
});

const openingHoursSchema = z.object({
  day: z.nativeEnum(DayOfWeek),
  openTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  closeTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  isClosed: z.boolean().default(false),
});

const createRestaurantSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(1000).optional(),
  phone: z.string().min(10).max(15),
  email: z.string().email().optional(),
  location: locationSchema,
  cuisineTypes: z.array(z.nativeEnum(CuisineType)).min(1),
  priceRange: z.number().min(1).max(4),
  deliveryFee: z.number().min(0),
  minimumOrder: z.number().min(0),
  averagePrepTime: z.number().min(5).max(120),
  openingHours: z.array(openingHoursSchema).min(1),
  features: z.object({
    hasDelivery: z.boolean().default(true),
    hasPickup: z.boolean().default(true),
    hasDineIn: z.boolean().default(false),
    acceptsCash: z.boolean().default(true),
    acceptsCard: z.boolean().default(true),
    acceptsMobileMoney: z.boolean().default(true),
  }),
});

const updateRestaurantSchema = createRestaurantSchema.partial();

const nearbyQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(0.5).max(50).default(5), // km
  limit: z.coerce.number().min(1).max(50).default(20),
  page: z.coerce.number().min(1).default(1),
});

// ============================================
// Routes
// ============================================

/**
 * GET /restaurants - List restaurants with filters
 */
restaurantRoutes.get("/", async (c) => {
  const city = c.req.query("city");
  const cuisine = c.req.query("cuisine") as CuisineType;
  const isOpen = c.req.query("isOpen") === "true";
  const minRating = Number.parseFloat(c.req.query("minRating") || "0");
  const priceRange = c.req.query("priceRange")?.split(",").map(Number);
  const page = Number.parseInt(c.req.query("page") || "1");
  const limit = Number.parseInt(c.req.query("limit") || "20");

  // Build where clause
  const where: any = {
    status: RestaurantStatus.ACTIVE,
  };

  if (city) {
    where.location = { path: ["city"], equals: city };
  }

  if (cuisine) {
    where.cuisineTypes = { has: cuisine };
  }

  if (minRating > 0) {
    where.rating = { gte: minRating };
  }

  if (priceRange?.length) {
    where.priceRange = { in: priceRange };
  }

  const [restaurants, total] = await Promise.all([
    prisma.restaurant.findMany({
      where,
      orderBy: [{ rating: "desc" }, { reviewCount: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.restaurant.count({ where }),
  ]);

  // Filter by open status if requested
  let filteredRestaurants = restaurants;
  if (isOpen) {
    filteredRestaurants = restaurants.filter(
      (r: (typeof restaurants)[number]) => isRestaurantOpen(r.openingHours),
    );
  }

  return c.json({
    success: true,
    data: filteredRestaurants.map((r: (typeof restaurants)[number]) => ({
      ...r,
      isOpen: isRestaurantOpen(r.openingHours),
    })),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * GET /restaurants/nearby - Get nearby restaurants
 */
restaurantRoutes.get(
  "/nearby",
  zValidator("query", nearbyQuerySchema),
  async (c) => {
    const { latitude, longitude, radius, limit, page } = c.req.valid("query");

    // Use PostGIS for geospatial query
    const restaurants = await prisma.$queryRaw<any[]>`
    SELECT 
      r.*,
      ST_Distance(
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
        ST_SetSRID(ST_MakePoint((r.location->>'longitude')::float, (r.location->>'latitude')::float), 4326)::geography
      ) / 1000 as distance_km
    FROM restaurants r
    WHERE r.status = 'ACTIVE'
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
        ST_SetSRID(ST_MakePoint((r.location->>'longitude')::float, (r.location->>'latitude')::float), 4326)::geography,
        ${radius * 1000}
      )
    ORDER BY distance_km ASC
    LIMIT ${limit}
    OFFSET ${(page - 1) * limit}
  `;

    return c.json({
      success: true,
      data: restaurants.map((r: (typeof restaurants)[number]) => ({
        ...r,
        isOpen: isRestaurantOpen(r.openingHours),
        distance: Math.round(r.distance_km * 10) / 10,
      })),
    });
  },
);

/**
 * GET /restaurants/:id - Get restaurant details
 */
restaurantRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  // Try cache first
  const cached = await cache.get<any>(`restaurant:${id}`);
  if (cached) {
    return c.json({
      success: true,
      data: { ...cached, isOpen: isRestaurantOpen(cached.openingHours) },
    });
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id },
    include: {
      menuCategories: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!restaurant) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Restaurant not found" },
      },
      404,
    );
  }

  // Cache for 5 minutes
  await cache.set(`restaurant:${id}`, restaurant, 300);

  return c.json({
    success: true,
    data: {
      ...restaurant,
      isOpen: isRestaurantOpen(restaurant.openingHours),
    },
  });
});

/**
 * GET /restaurants/:id/menu - Get restaurant menu
 */
restaurantRoutes.get("/:id/menu", async (c) => {
  const id = c.req.param("id");

  // Try cache first
  const cached = await cache.get<any>(`menu:${id}`);
  if (cached) {
    return c.json({ success: true, data: cached });
  }

  const categories = await prisma.menuCategory.findMany({
    where: { restaurantId: id, isActive: true },
    orderBy: { sortOrder: "asc" },
    include: {
      items: {
        where: { isActive: true },
        orderBy: [{ isPopular: "desc" }, { sortOrder: "asc" }],
      },
    },
  });

  // Cache for 10 minutes
  await cache.set(`menu:${id}`, categories, 600);

  return c.json({
    success: true,
    data: categories,
  });
});

/**
 * POST /restaurants - Create restaurant (restaurant owner)
 */
restaurantRoutes.post(
  "/",
  zValidator("json", createRestaurantSchema),
  async (c) => {
    const ownerId = c.req.header("X-User-ID");
    if (!ownerId) {
      return c.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        },
        401,
      );
    }

    const data = c.req.valid("json");
    const id = generateId("rst");
    const slug = generateSlug(data.name);

    // Check for duplicate slug
    const existing = await prisma.restaurant.findFirst({
      where: { slug },
    });

    const finalSlug = existing ? `${slug}-${id.slice(-6)}` : slug;

    const restaurant = await prisma.restaurant.create({
      data: {
        id,
        ownerId,
        slug: finalSlug,
        status: RestaurantStatus.PENDING,
        rating: 0,
        reviewCount: 0,
        isOpen: false,
        images: [],
        ...data,
      },
    });

    return c.json(
      {
        success: true,
        data: restaurant,
      },
      201,
    );
  },
);

/**
 * PUT /restaurants/:id - Update restaurant
 */
restaurantRoutes.put(
  "/:id",
  zValidator("json", updateRestaurantSchema),
  async (c) => {
    const id = c.req.param("id");
    const ownerId = c.req.header("X-User-ID");
    const data = c.req.valid("json");

    const restaurant = await prisma.restaurant.findUnique({
      where: { id },
    });

    if (!restaurant) {
      return c.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Restaurant not found" },
        },
        404,
      );
    }

    if (restaurant.ownerId !== ownerId) {
      return c.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Not authorized to update this restaurant",
          },
        },
        403,
      );
    }

    const updated = await prisma.restaurant.update({
      where: { id },
      data,
    });

    // Invalidate cache
    await cache.delete(`restaurant:${id}`);
    await cache.delete(`menu:${id}`);

    return c.json({
      success: true,
      data: updated,
    });
  },
);

/**
 * POST /restaurants/:id/status - Update restaurant open/closed status
 */
restaurantRoutes.post("/:id/status", async (c) => {
  const id = c.req.param("id");
  const ownerId = c.req.header("X-User-ID");
  const { isOpen, reason } = await c.req.json<{
    isOpen: boolean;
    reason?: string;
  }>();

  const restaurant = await prisma.restaurant.findUnique({
    where: { id },
  });

  if (!restaurant) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Restaurant not found" },
      },
      404,
    );
  }

  if (restaurant.ownerId !== ownerId) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not authorized" },
      },
      403,
    );
  }

  await prisma.restaurant.update({
    where: { id },
    data: {
      isOpen,
      metadata: {
        ...(restaurant.metadata as object),
        manualStatusChange: {
          isOpen,
          reason,
          changedAt: new Date().toISOString(),
        },
      },
    },
  });

  // Invalidate cache
  await cache.delete(`restaurant:${id}`);

  // Publish event
  await redis.publish(
    "restaurant:status",
    JSON.stringify({
      type: isOpen ? "restaurant.opened" : "restaurant.closed",
      restaurantId: id,
      reason,
      timestamp: new Date().toISOString(),
    }),
  );

  return c.json({
    success: true,
    data: { isOpen },
  });
});

/**
 * GET /restaurants/:id/stats - Get restaurant statistics (owner only)
 */
restaurantRoutes.get("/:id/stats", async (c) => {
  const id = c.req.param("id");
  const ownerId = c.req.header("X-User-ID");
  const period = c.req.query("period") || "week"; // day, week, month

  const restaurant = await prisma.restaurant.findUnique({
    where: { id },
  });

  if (!restaurant || restaurant.ownerId !== ownerId) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not authorized" },
      },
      403,
    );
  }

  const now = new Date();
  let startDate: Date;

  switch (period) {
    case "day":
      startDate = new Date(now.setHours(0, 0, 0, 0));
      break;
    case "month":
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    default: // week
      startDate = new Date(now.setDate(now.getDate() - 7));
  }

  const [orderStats, topItems, ratingBreakdown] = await Promise.all([
    // Order statistics
    prisma.order.aggregate({
      where: {
        restaurantId: id,
        createdAt: { gte: startDate },
        status: { in: ["DELIVERED", "COMPLETED"] },
      },
      _count: true,
      _sum: { total: true },
      _avg: { total: true },
    }),

    // Top selling items
    prisma.$queryRaw<any[]>`
      SELECT 
        oi.menu_item_id,
        oi.name,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.total_price) as total_revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.restaurant_id = ${id}
        AND o.created_at >= ${startDate}
        AND o.status IN ('DELIVERED', 'COMPLETED')
      GROUP BY oi.menu_item_id, oi.name
      ORDER BY total_quantity DESC
      LIMIT 10
    `,

    // Rating breakdown
    prisma.review.groupBy({
      by: ["rating"],
      where: {
        restaurantId: id,
        createdAt: { gte: startDate },
      },
      _count: true,
    }),
  ]);

  return c.json({
    success: true,
    data: {
      period,
      orders: {
        count: orderStats._count,
        totalRevenue: orderStats._sum.total || 0,
        averageOrderValue: orderStats._avg.total || 0,
      },
      topItems,
      ratings: ratingBreakdown,
    },
  });
});

// ============================================
// Helpers
// ============================================

function isRestaurantOpen(openingHours: any[]): boolean {
  if (!openingHours?.length) return false;

  const now = new Date();
  const days = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];
  const currentDay = days[now.getDay()];
  const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

  const todayHours = openingHours.find((h) => h.day === currentDay);

  if (!todayHours || todayHours.isClosed) return false;

  return (
    currentTime >= todayHours.openTime && currentTime <= todayHours.closeTime
  );
}

export { restaurantRoutes };
