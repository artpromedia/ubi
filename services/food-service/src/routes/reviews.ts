/**
 * Review Routes
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { cache, redis } from "../lib/redis";
import { generateId } from "../lib/utils";

const reviewRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const createReviewSchema = z.object({
  orderId: z.string(),
  restaurantRating: z.number().min(1).max(5),
  foodRating: z.number().min(1).max(5),
  deliveryRating: z.number().min(1).max(5).optional(),
  comment: z.string().max(1000).optional(),
  images: z.array(z.string().url()).max(5).default([]),
  tags: z.array(z.string()).max(10).default([]),
});

const updateReviewSchema = z.object({
  restaurantRating: z.number().min(1).max(5).optional(),
  foodRating: z.number().min(1).max(5).optional(),
  deliveryRating: z.number().min(1).max(5).optional(),
  comment: z.string().max(1000).optional(),
  images: z.array(z.string().url()).max(5).optional(),
  tags: z.array(z.string()).max(10).optional(),
});

const restaurantReplySchema = z.object({
  reply: z.string().min(1).max(500),
});

// ============================================
// Routes
// ============================================

/**
 * POST /reviews - Create a review
 */
reviewRoutes.post("/", zValidator("json", createReviewSchema), async (c) => {
  const customerId = c.get("userId");
  const data = c.req.valid("json");

  // Get the order
  const order = await prisma.order.findUnique({
    where: { id: data.orderId },
    select: {
      id: true,
      customerId: true,
      restaurantId: true,
      driverId: true,
      status: true,
      type: true,
    },
  });

  if (!order) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Order not found" },
      },
      404,
    );
  }

  if (order.customerId !== customerId) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not your order" },
      },
      403,
    );
  }

  if (order.status !== "DELIVERED") {
    return c.json(
      {
        success: false,
        error: {
          code: "ORDER_NOT_DELIVERED",
          message: "Can only review delivered orders",
        },
      },
      400,
    );
  }

  // Check if already reviewed
  const existingReview = await prisma.review.findFirst({
    where: { orderId: data.orderId },
  });

  if (existingReview) {
    return c.json(
      {
        success: false,
        error: { code: "ALREADY_REVIEWED", message: "Order already reviewed" },
      },
      400,
    );
  }

  // Calculate overall rating
  const ratings = [data.restaurantRating, data.foodRating];
  if (data.deliveryRating) ratings.push(data.deliveryRating);
  const overallRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;

  const review = await prisma.review.create({
    data: {
      id: generateId("rev"),
      orderId: data.orderId,
      customerId,
      restaurantId: order.restaurantId,
      driverId: order.type === "DELIVERY" ? order.driverId : null,
      restaurantRating: data.restaurantRating,
      foodRating: data.foodRating,
      deliveryRating: data.deliveryRating,
      overallRating,
      comment: data.comment,
      images: data.images,
      tags: data.tags,
    },
    include: {
      customer: {
        select: { id: true, firstName: true, lastName: true, avatarUrl: true },
      },
    },
  });

  // Update restaurant rating
  await updateRestaurantRating(order.restaurantId);

  // Update driver rating if applicable
  if (order.driverId && data.deliveryRating) {
    await updateDriverRating(order.driverId);
  }

  // Invalidate restaurant cache
  await cache.delete(`restaurant:${order.restaurantId}`);

  return c.json(
    {
      success: true,
      data: review,
    },
    201,
  );
});

/**
 * GET /reviews/:id - Get review by ID
 */
reviewRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const review = await prisma.review.findUnique({
    where: { id },
    include: {
      customer: {
        select: { id: true, firstName: true, lastName: true, avatarUrl: true },
      },
      restaurant: {
        select: { id: true, name: true },
      },
    },
  });

  if (!review) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Review not found" },
      },
      404,
    );
  }

  return c.json({
    success: true,
    data: review,
  });
});

/**
 * PUT /reviews/:id - Update review (within 24 hours)
 */
reviewRoutes.put("/:id", zValidator("json", updateReviewSchema), async (c) => {
  const id = c.req.param("id");
  const customerId = c.get("userId");
  const data = c.req.valid("json");

  const review = await prisma.review.findUnique({
    where: { id },
  });

  if (!review) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Review not found" },
      },
      404,
    );
  }

  if (review.customerId !== customerId) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not your review" },
      },
      403,
    );
  }

  // Check 24 hour window
  const hoursSinceCreated =
    (Date.now() - review.createdAt.getTime()) / (1000 * 60 * 60);
  if (hoursSinceCreated > 24) {
    return c.json(
      {
        success: false,
        error: {
          code: "EDIT_WINDOW_CLOSED",
          message: "Reviews can only be edited within 24 hours",
        },
      },
      400,
    );
  }

  // Recalculate overall rating if ratings changed
  let overallRating = review.overallRating;
  if (data.restaurantRating || data.foodRating || data.deliveryRating) {
    const ratings = [
      data.restaurantRating || review.restaurantRating,
      data.foodRating || review.foodRating,
    ];
    if (data.deliveryRating || review.deliveryRating) {
      ratings.push(data.deliveryRating || review.deliveryRating!);
    }
    overallRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  }

  const updated = await prisma.review.update({
    where: { id },
    data: {
      ...data,
      overallRating,
      editedAt: new Date(),
    },
    include: {
      customer: {
        select: { id: true, firstName: true, lastName: true, avatarUrl: true },
      },
    },
  });

  // Update restaurant rating
  await updateRestaurantRating(review.restaurantId);

  return c.json({
    success: true,
    data: updated,
  });
});

/**
 * DELETE /reviews/:id - Delete review
 */
reviewRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const customerId = c.get("userId");

  const review = await prisma.review.findUnique({
    where: { id },
  });

  if (!review) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Review not found" },
      },
      404,
    );
  }

  if (review.customerId !== customerId) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not your review" },
      },
      403,
    );
  }

  await prisma.review.delete({ where: { id } });

  // Update restaurant rating
  await updateRestaurantRating(review.restaurantId);

  return c.json({
    success: true,
    message: "Review deleted",
  });
});

/**
 * GET /reviews/restaurant/:restaurantId - Get reviews for restaurant
 */
reviewRoutes.get("/restaurant/:restaurantId", async (c) => {
  const restaurantId = c.req.param("restaurantId");
  const page = Number.parseInt(c.req.query("page") || "1");
  const limit = Number.parseInt(c.req.query("limit") || "20");
  const sort = c.req.query("sort") || "recent";
  const rating = c.req.query("rating")
    ? Number.parseInt(c.req.query("rating")!)
    : undefined;

  const where: any = { restaurantId };
  if (rating) {
    where.overallRating = { gte: rating, lt: rating + 1 };
  }

  const orderBy: any = {};
  switch (sort) {
    case "recent":
      orderBy.createdAt = "desc";
      break;
    case "highest":
      orderBy.overallRating = "desc";
      break;
    case "lowest":
      orderBy.overallRating = "asc";
      break;
    case "helpful":
      orderBy.helpfulCount = "desc";
      break;
  }

  const [reviews, total, stats] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    }),
    prisma.review.count({ where }),
    getReviewStats(restaurantId),
  ]);

  return c.json({
    success: true,
    data: {
      reviews,
      stats,
    },
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * POST /reviews/:id/reply - Restaurant reply to review
 */
reviewRoutes.post(
  "/:id/reply",
  zValidator("json", restaurantReplySchema),
  async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");
    const { reply } = c.req.valid("json");

    const review = await prisma.review.findUnique({
      where: { id },
      include: {
        restaurant: {
          select: { ownerId: true },
        },
      },
    });

    if (!review) {
      return c.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Review not found" },
        },
        404,
      );
    }

    if (review.restaurant.ownerId !== userId) {
      return c.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "Not authorized" },
        },
        403,
      );
    }

    const updated = await prisma.review.update({
      where: { id },
      data: {
        restaurantReply: reply,
        restaurantRepliedAt: new Date(),
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    });

    // Notify customer of reply
    await redis.publish(
      "notification:push",
      JSON.stringify({
        userId: review.customerId,
        type: "review_reply",
        title: "Restaurant replied to your review",
        body: reply.substring(0, 100) + (reply.length > 100 ? "..." : ""),
      }),
    );

    return c.json({
      success: true,
      data: updated,
    });
  },
);

/**
 * POST /reviews/:id/helpful - Mark review as helpful
 */
reviewRoutes.post("/:id/helpful", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("userId");

  const review = await prisma.review.findUnique({
    where: { id },
  });

  if (!review) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Review not found" },
      },
      404,
    );
  }

  // Check if already marked
  const helpfulKey = `review:helpful:${id}:${userId}`;
  const alreadyMarked = await redis.get(helpfulKey);

  if (alreadyMarked) {
    return c.json(
      {
        success: false,
        error: { code: "ALREADY_MARKED", message: "Already marked as helpful" },
      },
      400,
    );
  }

  await Promise.all([
    prisma.review.update({
      where: { id },
      data: { helpfulCount: { increment: 1 } },
    }),
    redis.set(helpfulKey, "1"), // No expiry
  ]);

  return c.json({
    success: true,
    message: "Marked as helpful",
  });
});

/**
 * POST /reviews/:id/report - Report a review
 */
reviewRoutes.post("/:id/report", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("userId");
  const { reason, details } = await c.req.json<{
    reason: string;
    details?: string;
  }>();

  const review = await prisma.review.findUnique({
    where: { id },
  });

  if (!review) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Review not found" },
      },
      404,
    );
  }

  // Store report
  await prisma.reviewReport.create({
    data: {
      id: generateId("rpt"),
      reviewId: id,
      reporterId: userId,
      reason,
      details,
    },
  });

  // Update report count
  const reportCount = await prisma.reviewReport.count({
    where: { reviewId: id },
  });

  // Auto-flag if multiple reports
  if (reportCount >= 3) {
    await prisma.review.update({
      where: { id },
      data: { isFlagged: true },
    });
  }

  return c.json({
    success: true,
    message: "Report submitted",
  });
});

/**
 * GET /reviews/pending - Get orders pending review
 */
reviewRoutes.get("/pending", async (c) => {
  const customerId = c.get("userId");

  // Get delivered orders without reviews
  const pendingOrders = await prisma.order.findMany({
    where: {
      customerId,
      status: "DELIVERED",
      review: null,
      deliveredAt: {
        // Only show orders delivered in last 7 days
        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    },
    select: {
      id: true,
      orderNumber: true,
      deliveredAt: true,
      restaurant: {
        select: { id: true, name: true, logo: true },
      },
    },
    orderBy: { deliveredAt: "desc" },
  });

  return c.json({
    success: true,
    data: pendingOrders,
  });
});

// ============================================
// Helpers
// ============================================

async function updateRestaurantRating(restaurantId: string): Promise<void> {
  const stats = await prisma.review.aggregate({
    where: { restaurantId },
    _avg: {
      overallRating: true,
      restaurantRating: true,
      foodRating: true,
    },
    _count: { id: true },
  });

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      averageRating: stats._avg.overallRating || 0,
      totalReviews: stats._count.id,
    },
  });
}

async function updateDriverRating(driverId: string): Promise<void> {
  const stats = await prisma.review.aggregate({
    where: { driverId },
    _avg: { deliveryRating: true },
    _count: { id: true },
  });

  // Publish to user service to update driver rating
  await redis.publish(
    "driver:rating:update",
    JSON.stringify({
      driverId,
      averageRating: stats._avg.deliveryRating || 0,
      totalReviews: stats._count.id,
    }),
  );
}

async function getReviewStats(restaurantId: string) {
  const [aggregate, distribution] = await Promise.all([
    prisma.review.aggregate({
      where: { restaurantId },
      _avg: {
        overallRating: true,
        restaurantRating: true,
        foodRating: true,
        deliveryRating: true,
      },
      _count: { id: true },
    }),
    prisma.$queryRaw<{ rating: number; count: bigint }[]>`
      SELECT 
        FLOOR("overallRating") as rating,
        COUNT(*) as count
      FROM "Review"
      WHERE "restaurantId" = ${restaurantId}
      GROUP BY FLOOR("overallRating")
      ORDER BY rating DESC
    `,
  ]);

  return {
    averageRating: aggregate._avg.overallRating || 0,
    averageRestaurantRating: aggregate._avg.restaurantRating || 0,
    averageFoodRating: aggregate._avg.foodRating || 0,
    averageDeliveryRating: aggregate._avg.deliveryRating || null,
    totalReviews: aggregate._count.id,
    distribution: distribution.reduce(
      (acc: Record<number, number>, d: { rating: number; count: bigint }) => {
        acc[d.rating] = Number(d.count);
        return acc;
      },
      { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<number, number>,
    ),
  };
}

export { reviewRoutes };
