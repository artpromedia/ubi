/**
 * Search Routes
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { cache } from "../lib/redis";
import { CuisineType } from "../types";

const searchRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const searchSchema = z.object({
  query: z.string().min(1).max(100),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().min(0.5).max(50).default(10), // km
  cuisine: z.nativeEnum(CuisineType).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  isOpen: z.coerce.boolean().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

const suggestionsSchema = z.object({
  query: z.string().min(1).max(50),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().min(1).max(10).default(5),
});

// ============================================
// Routes
// ============================================

/**
 * GET /search - Search restaurants and menu items
 */
searchRoutes.get("/", zValidator("query", searchSchema), async (c) => {
  const params = c.req.valid("query");

  const results = await performSearch(params);

  return c.json({
    success: true,
    data: results,
    meta: {
      query: params.query,
      page: params.page,
      limit: params.limit,
    },
  });
});

/**
 * GET /search/suggestions - Get search suggestions (autocomplete)
 */
searchRoutes.get(
  "/suggestions",
  zValidator("query", suggestionsSchema),
  async (c) => {
    const { query, latitude, longitude, limit } = c.req.valid("query");

    const cacheKey = `search:suggestions:${query.toLowerCase()}:${latitude || "none"}:${longitude || "none"}`;
    const cached = await cache.get<any[]>(cacheKey);
    if (cached) {
      return c.json({ success: true, data: cached });
    }

    const suggestions: any[] = [];

    // Search restaurants by name
    const restaurants = await prisma.restaurant.findMany({
      where: {
        isOpen: true,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { cuisineTypes: { has: query.toUpperCase() } },
        ],
      },
      select: { id: true, name: true, cuisineTypes: true, imageUrl: true },
      take: limit,
    });

    suggestions.push(
      ...restaurants.map((r: (typeof restaurants)[number]) => ({
        type: "restaurant",
        id: r.id,
        name: r.name,
        subtitle: r.cuisineTypes.join(", "),
        image: r.imageUrl,
      })),
    );

    // Search menu items
    const menuItems = await prisma.menuItem.findMany({
      where: {
        isAvailable: true,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        restaurantId: true,
        restaurant: { select: { id: true, name: true } },
      },
      take: limit,
    });

    suggestions.push(
      ...menuItems.map((item: (typeof menuItems)[number]) => ({
        type: "menu_item",
        id: item.id,
        name: item.name,
        subtitle: `at ${item.restaurant.name}`,
        restaurantId: item.restaurant.id,
        image: item.imageUrl,
      })),
    );

    // Search cuisine types
    const cuisineMatches = Object.values(CuisineType).filter((c) =>
      c.toLowerCase().includes(query.toLowerCase()),
    );

    suggestions.push(
      ...cuisineMatches.slice(0, 3).map((cuisine) => ({
        type: "cuisine",
        id: cuisine,
        name:
          cuisine.charAt(0) +
          cuisine.slice(1).toLowerCase().replaceAll("_", " "),
        subtitle: "Cuisine type",
      })),
    );

    // Cache for 5 minutes
    await cache.set(cacheKey, suggestions, 300);

    return c.json({
      success: true,
      data: suggestions.slice(0, limit),
    });
  },
);

/**
 * GET /search/popular - Get popular searches in area
 */
searchRoutes.get("/popular", async (c) => {
  const city = c.req.query("city");

  const cacheKey = `search:popular:${city || "global"}`;
  const cached = await cache.get<any[]>(cacheKey);
  if (cached) {
    return c.json({ success: true, data: cached });
  }

  // Get popular cuisines based on order count
  const popularCuisines = await prisma.restaurant.groupBy({
    by: ["cuisineTypes"],
    where: {
      isOpen: true,
    },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 5,
  });

  // Get trending restaurants
  const trendingRestaurants = await prisma.restaurant.findMany({
    where: {
      isOpen: true,
    },
    orderBy: [{ rating: "desc" }, { totalOrders: "desc" }],
    select: {
      id: true,
      name: true,
      cuisineTypes: true,
      rating: true,
      imageUrl: true,
    },
    take: 5,
  });

  // Get popular items
  const popularItems = await prisma.menuItem.findMany({
    where: {
      isAvailable: true,
    },
    select: {
      id: true,
      name: true,
      imageUrl: true,
      restaurant: { select: { id: true, name: true } },
    },
    take: 5,
  });

  const result = {
    cuisines: popularCuisines
      .map((c: (typeof popularCuisines)[number]) => c.cuisineTypes[0])
      .filter(Boolean),
    restaurants: trendingRestaurants.map((r) => ({
      ...r,
      averageRating: r.rating,
      logo: r.imageUrl,
    })),
    items: popularItems.map((item: (typeof popularItems)[number]) => ({
      id: item.id,
      name: item.name,
      image: item.imageUrl,
      restaurantName: item.restaurant.name,
      restaurantId: item.restaurant.id,
    })),
  };

  // Cache for 1 hour
  await cache.set(cacheKey, result, 3600);

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * GET /search/nearby-categories - Get available categories nearby
 */
searchRoutes.get("/nearby-categories", async (c) => {
  const latitude = Number.parseFloat(c.req.query("latitude") || "0");
  const longitude = Number.parseFloat(c.req.query("longitude") || "0");
  const radius = Number.parseFloat(c.req.query("radius") || "10");

  if (!latitude || !longitude) {
    return c.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Location required" },
      },
      400,
    );
  }

  const cacheKey = `search:categories:${latitude.toFixed(2)}:${longitude.toFixed(2)}:${radius}`;
  const cached = await cache.get<any[]>(cacheKey);
  if (cached) {
    return c.json({ success: true, data: cached });
  }

  // Get nearby restaurant cuisine distribution
  const radiusInMeters = radius * 1000;

  const cuisineCounts = await prisma.$queryRaw<
    { cuisine: string; count: bigint }[]
  >`
    SELECT unnest(r."cuisineTypes") as cuisine, COUNT(*) as count
    FROM "Restaurant" r
    WHERE r.status = 'ACTIVE'
    AND ST_DWithin(
      ST_MakePoint(
        (r.location->>'longitude')::float,
        (r.location->>'latitude')::float
      )::geography,
      ST_MakePoint(${longitude}, ${latitude})::geography,
      ${radiusInMeters}
    )
    GROUP BY cuisine
    ORDER BY count DESC
  `;

  const categories = cuisineCounts.map((c: (typeof cuisineCounts)[number]) => ({
    cuisine: c.cuisine,
    displayName:
      c.cuisine.charAt(0) +
      c.cuisine.slice(1).toLowerCase().replaceAll("_", " "),
    restaurantCount: Number(c.count),
  }));

  // Cache for 30 minutes
  await cache.set(cacheKey, categories, 1800);

  return c.json({
    success: true,
    data: categories,
  });
});

/**
 * GET /search/filters - Get available filter options
 */
searchRoutes.get("/filters", async (c) => {
  const city = c.req.query("city");

  const cacheKey = `search:filters:${city || "global"}`;
  const cached = await cache.get<any>(cacheKey);
  if (cached) {
    return c.json({ success: true, data: cached });
  }

  const where = {
    isOpen: true,
  };

  // Get all available cuisines
  const cuisines = await prisma.restaurant.findMany({
    where,
    select: { cuisineTypes: true },
    distinct: ["cuisineTypes"],
  });

  const allCuisineTypes = cuisines.flatMap(
    (r: (typeof cuisines)[number]) => r.cuisineTypes,
  );
  const uniqueCuisines = [...new Set<string>(allCuisineTypes)];

  // Get rating distribution instead of price range
  const ratingDistribution = await prisma.restaurant.groupBy({
    by: ["rating"],
    where,
    _count: { id: true },
  });

  const filters = {
    cuisines: uniqueCuisines.map((c: string) => ({
      value: c,
      label: c.charAt(0) + c.slice(1).toLowerCase().replaceAll("_", " "),
    })),
    ratings: [1, 2, 3, 4, 5].map((rating) => ({
      value: rating,
      label: `${rating}+ stars`,
      count: ratingDistribution
        .filter((r: (typeof ratingDistribution)[number]) => r.rating >= rating)
        .reduce((sum, r) => sum + r._count.id, 0),
    })),
    sortOptions: [
      { value: "relevance", label: "Relevance" },
      { value: "rating", label: "Top Rated" },
      { value: "distance", label: "Distance" },
      { value: "delivery_time", label: "Delivery Time" },
      { value: "price_low", label: "Price: Low to High" },
      { value: "price_high", label: "Price: High to Low" },
    ],
  };

  // Cache for 1 hour
  await cache.set(cacheKey, filters, 3600);

  return c.json({
    success: true,
    data: filters,
  });
});

// ============================================
// Search Implementation
// ============================================

async function performSearch(params: z.infer<typeof searchSchema>) {
  const {
    query,
    latitude,
    longitude,
    radius,
    cuisine,
    minRating,
    isOpen,
    page,
    limit,
  } = params;

  const offset = (page - 1) * limit;

  // Build restaurant search
  const restaurantWhere: any = {
    isOpen: true,
    OR: [
      { name: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
    ],
  };

  if (cuisine) restaurantWhere.cuisineTypes = { has: cuisine };
  if (minRating) restaurantWhere.rating = { gte: minRating };

  // Location-based search
  let restaurants: any[] = [];
  let menuItems: any[] = [];

  if (latitude && longitude) {
    // Use PostGIS for location search
    const radiusInMeters = radius * 1000;

    restaurants = await prisma.$queryRaw`
      SELECT 
        r.*,
        ST_Distance(
          ST_MakePoint((r.location->>'longitude')::float, (r.location->>'latitude')::float)::geography,
          ST_MakePoint(${longitude}, ${latitude})::geography
        ) as distance
      FROM "Restaurant" r
      WHERE r."isOpen" = true
      AND (
        r.name ILIKE ${"%" + query + "%"}
        OR r.description ILIKE ${"%" + query + "%"}
        OR ${"%" + query.toUpperCase() + "%"} = ANY(r."cuisineTypes")
      )
      ${cuisine ? prisma.$queryRaw`AND ${cuisine} = ANY(r."cuisineTypes")` : prisma.$queryRaw``}
      ${minRating ? prisma.$queryRaw`AND r."rating" >= ${minRating}` : prisma.$queryRaw``}
      AND ST_DWithin(
        ST_MakePoint((r.location->>'longitude')::float, (r.location->>'latitude')::float)::geography,
        ST_MakePoint(${longitude}, ${latitude})::geography,
        ${radiusInMeters}
      )
      ORDER BY distance ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    // Search menu items in nearby restaurants
    menuItems = await prisma.$queryRaw`
      SELECT 
        mi.*,
        r.name as restaurant_name,
        r.id as restaurant_id,
        ST_Distance(
          ST_MakePoint((r.location->>'longitude')::float, (r.location->>'latitude')::float)::geography,
          ST_MakePoint(${longitude}, ${latitude})::geography
        ) as distance
      FROM "MenuItem" mi
      JOIN "Restaurant" r ON mi."restaurantId" = r.id
      WHERE mi."isAvailable" = true
      AND (
        mi.name ILIKE ${"%" + query + "%"}
        OR mi.description ILIKE ${"%" + query + "%"}
      )
      AND r."isOpen" = true
      AND ST_DWithin(
        ST_MakePoint((r.location->>'longitude')::float, (r.location->>'latitude')::float)::geography,
        ST_MakePoint(${longitude}, ${latitude})::geography,
        ${radiusInMeters}
      )
      ORDER BY distance ASC
      LIMIT ${limit}
    `;
  } else {
    // Search without location
    restaurants = await prisma.restaurant.findMany({
      where: restaurantWhere,
      orderBy: [{ rating: "desc" }, { totalOrders: "desc" }],
      skip: offset,
      take: limit,
    });

    menuItems = await prisma.menuItem.findMany({
      where: {
        isAvailable: true,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
        restaurant: {
          isOpen: true,
        },
      },
      include: {
        restaurant: {
          select: { id: true, name: true, isOpen: true },
        },
      },
      take: limit,
    });
  }

  // Filter by isOpen if requested
  if (isOpen) {
    const now = new Date();
    const currentDay = [
      "SUNDAY",
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
    ][now.getDay()];
    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

    restaurants = restaurants.filter((r) => {
      const hours = r.openingHours?.find((h: any) => h.day === currentDay);
      if (!hours || hours.isClosed) return false;
      return currentTime >= hours.open && currentTime <= hours.close;
    });
  }

  return {
    restaurants: restaurants.map((r) => ({
      ...r,
      distance: r.distance ? Math.round(r.distance / 100) / 10 : null, // Convert to km
    })),
    menuItems: menuItems.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price,
      discountPrice: item.discountPrice,
      imageUrl: item.imageUrl,
      restaurantId: item.restaurant_id || item.restaurant?.id,
      restaurantName: item.restaurant_name || item.restaurant?.name,
      distance: item.distance ? Math.round(item.distance / 100) / 10 : null,
    })),
    totalResults: restaurants.length + menuItems.length,
  };
}

export { searchRoutes };
