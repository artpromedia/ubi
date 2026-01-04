/**
 * In-App Notification Routes
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { publishEvent, redis } from "../lib/redis";
import { generateId } from "../lib/utils";
import { auth, serviceAuth } from "../middleware/auth";
import {
  NotificationPriority,
  NotificationStatus,
  NotificationType,
} from "../types";

const inAppRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const createNotificationSchema = z.object({
  userId: z.string(),
  type: z.nativeEnum(NotificationType),
  title: z.string().max(100),
  body: z.string().max(500),
  imageUrl: z.string().url().optional(),
  actionUrl: z.string().optional(),
  data: z.record(z.any()).optional(),
  priority: z
    .nativeEnum(NotificationPriority)
    .default(NotificationPriority.NORMAL),
  expiresAt: z.string().datetime().optional(),
});

const createBulkSchema = z.object({
  userIds: z.array(z.string()).min(1).max(1000),
  type: z.nativeEnum(NotificationType),
  title: z.string().max(100),
  body: z.string().max(500),
  imageUrl: z.string().url().optional(),
  actionUrl: z.string().optional(),
  data: z.record(z.any()).optional(),
  priority: z
    .nativeEnum(NotificationPriority)
    .default(NotificationPriority.NORMAL),
});

const listNotificationsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  unreadOnly: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  type: z.nativeEnum(NotificationType).optional(),
});

// ============================================
// Routes
// ============================================

/**
 * GET /notifications - List user notifications
 */
inAppRoutes.get(
  "/",
  auth,
  zValidator("query", listNotificationsSchema),
  async (c) => {
    const userId = c.get("userId");
    const { page, limit, unreadOnly, type } = c.req.valid("query");

    const where: Record<string, unknown> = {
      userId,
      channel: "IN_APP",
    };

    if (unreadOnly) {
      where.readAt = null;
    }

    if (type) {
      where.type = type;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.inAppNotification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.inAppNotification.count({ where }),
      prisma.inAppNotification.count({
        where: { userId, readAt: null },
      }),
    ]);

    return c.json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  }
);

/**
 * GET /notifications/:id - Get notification
 */
inAppRoutes.get("/:id", auth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const notification = await prisma.inAppNotification.findFirst({
    where: { id, userId },
  });

  if (!notification) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Notification not found" },
      },
      404
    );
  }

  return c.json({ success: true, data: { notification } });
});

/**
 * POST /notifications - Create notification (service-to-service)
 */
inAppRoutes.post(
  "/",
  serviceAuth,
  zValidator("json", createNotificationSchema),
  async (c) => {
    const data = c.req.valid("json");

    // Check user preferences
    const prefs = await prisma.notificationPreference.findUnique({
      where: { userId: data.userId },
    });

    if (prefs && !prefs.inAppEnabled) {
      return c.json(
        {
          success: false,
          error: {
            code: "IN_APP_DISABLED",
            message: "User has disabled in-app notifications",
          },
        },
        400
      );
    }

    const notification = await prisma.inAppNotification.create({
      data: {
        id: generateId("notif"),
        userId: data.userId,
        type: data.type,
        title: data.title,
        body: data.body,
        imageUrl: data.imageUrl,
        actionUrl: data.actionUrl,
        data: data.data || {},
        priority: data.priority,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        status: NotificationStatus.DELIVERED,
      },
    });

    // Publish real-time event
    await publishEvent("notification:created", {
      userId: data.userId,
      notification,
    });

    // Update badge count
    const unreadCount = await prisma.inAppNotification.count({
      where: { userId: data.userId, readAt: null },
    });
    await redis.set(`user:${data.userId}:badge`, unreadCount, "EX", 86400);

    return c.json({ success: true, data: { notification } }, 201);
  }
);

/**
 * POST /notifications/bulk - Create bulk notifications
 */
inAppRoutes.post(
  "/bulk",
  serviceAuth,
  zValidator("json", createBulkSchema),
  async (c) => {
    const { userIds, ...notificationData } = c.req.valid("json");

    // Filter out users with notifications disabled
    const prefs = await prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, inAppEnabled: false },
      select: { userId: true },
    });

    const disabledUserIds = new Set(
      prefs.map((p: (typeof prefs)[number]) => p.userId)
    );
    const eligibleUserIds = userIds.filter((id) => !disabledUserIds.has(id));

    if (eligibleUserIds.length === 0) {
      return c.json({
        success: true,
        data: { created: 0, skipped: userIds.length },
      });
    }

    // Create notifications
    const notifications = eligibleUserIds.map((userId) => ({
      id: generateId("notif"),
      userId,
      type: notificationData.type,
      title: notificationData.title,
      body: notificationData.body,
      imageUrl: notificationData.imageUrl,
      actionUrl: notificationData.actionUrl,
      data: notificationData.data || {},
      priority: notificationData.priority,
      status: NotificationStatus.DELIVERED,
    }));

    await prisma.inAppNotification.createMany({ data: notifications });

    // Publish events
    for (const notif of notifications) {
      await publishEvent("notification:created", {
        userId: notif.userId,
        notification: notif,
      });
    }

    return c.json({
      success: true,
      data: {
        created: notifications.length,
        skipped: userIds.length - eligibleUserIds.length,
      },
    });
  }
);

/**
 * PATCH /notifications/:id/read - Mark notification as read
 */
inAppRoutes.patch("/:id/read", auth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const notification = await prisma.inAppNotification.findFirst({
    where: { id, userId },
  });

  if (!notification) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Notification not found" },
      },
      404
    );
  }

  if (notification.readAt) {
    return c.json({ success: true, data: { notification } });
  }

  const updated = await prisma.inAppNotification.update({
    where: { id },
    data: { readAt: new Date(), status: NotificationStatus.READ },
  });

  // Update badge count
  const unreadCount = await prisma.inAppNotification.count({
    where: { userId, readAt: null },
  });
  await redis.set(`user:${userId}:badge`, unreadCount, "EX", 86400);

  return c.json({ success: true, data: { notification: updated } });
});

/**
 * POST /notifications/read-all - Mark all notifications as read
 */
inAppRoutes.post("/read-all", auth, async (c) => {
  const userId = c.get("userId");

  const result = await prisma.inAppNotification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date(), status: NotificationStatus.READ },
  });

  // Reset badge count
  await redis.set(`user:${userId}:badge`, 0, "EX", 86400);

  return c.json({
    success: true,
    data: { markedAsRead: result.count },
  });
});

/**
 * DELETE /notifications/:id - Delete notification
 */
inAppRoutes.delete("/:id", auth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const notification = await prisma.inAppNotification.findFirst({
    where: { id, userId },
  });

  if (!notification) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Notification not found" },
      },
      404
    );
  }

  await prisma.inAppNotification.delete({ where: { id } });

  // Update badge count if was unread
  if (!notification.readAt) {
    const unreadCount = await prisma.inAppNotification.count({
      where: { userId, readAt: null },
    });
    await redis.set(`user:${userId}:badge`, unreadCount, "EX", 86400);
  }

  return c.json({ success: true });
});

/**
 * DELETE /notifications - Delete all notifications
 */
inAppRoutes.delete("/", auth, async (c) => {
  const userId = c.get("userId");

  await prisma.inAppNotification.deleteMany({ where: { userId } });

  // Reset badge count
  await redis.set(`user:${userId}:badge`, 0, "EX", 86400);

  return c.json({ success: true });
});

/**
 * GET /notifications/badge - Get badge count
 */
inAppRoutes.get("/badge", auth, async (c) => {
  const userId = c.get("userId");

  // Try cache first
  let badgeCount = await redis.get(`user:${userId}:badge`);

  if (badgeCount === null) {
    badgeCount = String(
      await prisma.inAppNotification.count({
        where: { userId, readAt: null },
      })
    );
    await redis.set(`user:${userId}:badge`, badgeCount, "EX", 86400);
  }

  return c.json({
    success: true,
    data: { unreadCount: parseInt(badgeCount, 10) },
  });
});

export { inAppRoutes };
