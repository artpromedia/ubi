/**
 * Push Notification Routes (Firebase Cloud Messaging)
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { pushLogger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { generateId } from "../lib/utils";
import { flushPendingForUser } from "../marketplace/consumer";
import { auth, serviceAuth } from "../middleware/auth";
import { firebaseService } from "../providers/firebase";
import { NotificationPriority, NotificationStatus } from "../types";

const pushRoutes = new Hono();

// ============================================
// Schemas
// ============================================

// `.strict()` rejects any client-supplied `userId` in the request body so device
// registration can bind ONLY to `c.get("userId")` from verified auth context.
const registerDeviceSchema = z
  .object({
    token: z.string().min(1).max(4096),
    platform: z.enum(["ios", "android", "web"]),
    deviceId: z.string().min(1).max(255).optional(),
    appVersion: z.string().min(1).max(64).optional(),
  })
  .strict();

const unregisterDeviceBodySchema = z
  .object({
    token: z.string().min(1).max(4096),
  })
  .strict();

const sendPushSchema = z.object({
  userId: z.string(),
  title: z.string().max(100),
  body: z.string().max(500),
  data: z.record(z.any()).optional(),
  image: z.string().url().optional(),
  priority: z
    .nativeEnum(NotificationPriority)
    .default(NotificationPriority.NORMAL),
  ttl: z.number().int().min(0).max(2419200).optional(), // Max 28 days
  collapseKey: z.string().optional(),
});

const sendBatchPushSchema = z.object({
  userIds: z.array(z.string()).min(1).max(500),
  title: z.string().max(100),
  body: z.string().max(500),
  data: z.record(z.any()).optional(),
  image: z.string().url().optional(),
});

const sendTopicPushSchema = z.object({
  topic: z.string(),
  title: z.string().max(100),
  body: z.string().max(500),
  data: z.record(z.any()).optional(),
});

// ============================================
// Routes
// ============================================

/**
 * POST /push/devices - Register device for push notifications
 */
pushRoutes.post(
  "/devices",
  auth,
  zValidator("json", registerDeviceSchema),
  async (c) => {
    const userId = c.get("userId");
    // GAP: the DeviceToken model has no `deviceId`/`appVersion` columns, so those
    // client hints are validated but not persisted. Accepted for forward-compat.
    const { token, platform } = c.req.valid("json");

    // Upsert device token strictly for the authenticated principal (`userId`).
    await prisma.deviceToken.upsert({
      where: {
        userId_token: { userId, token },
      },
      update: {
        platform,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        id: generateId("dev"),
        userId,
        token,
        platform,
        isActive: true,
      },
    });

    // Best-effort short-window flush of notifications deferred while this user
    // had no active device token (CC-B04 / P1-13). A Redis hiccup never fails
    // token registration itself.
    let flushed = 0;
    try {
      const flushResult = await flushPendingForUser(redis, userId);
      flushed = flushResult.flushed;
    } catch (err) {
      pushLogger.warn(
        {
          userId,
          err: err instanceof Error ? err.message : "pending_flush_failed",
        },
        "Short-window pending push flush failed on device registration",
      );
    }

    return c.json({
      success: true,
      message: "Device registered for push notifications",
      data: { flushed },
    });
  },
);

/**
 * DELETE /push/devices - Unregister caller's device token via body or query
 * (safe for FCM tokens containing `:` or `/` characters).
 */
pushRoutes.delete("/devices", auth, async (c) => {
  const userId = c.get("userId");
  let token = c.req.query("token")?.trim() ?? "";

  if (token.length === 0) {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      rawBody = undefined;
    }
    const parsed = unregisterDeviceBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "A non-empty device token is required",
          },
        },
        400,
      );
    }
    token = parsed.data.token;
  }

  await prisma.deviceToken.updateMany({
    where: { userId, token },
    data: { isActive: false },
  });

  return c.json({
    success: true,
    message: "Device unregistered",
  });
});

/**
 * DELETE /push/devices/:token - Unregister caller's device token by URL segment
 */
pushRoutes.delete("/devices/:token", auth, async (c) => {
  const userId = c.get("userId");
  const token = decodeURIComponent(c.req.param("token"));

  await prisma.deviceToken.updateMany({
    where: { userId, token },
    data: { isActive: false },
  });

  return c.json({
    success: true,
    message: "Device unregistered",
  });
});

/**
 * POST /push/send - Send push notification (service-to-service)
 */
pushRoutes.post(
  "/send",
  serviceAuth,
  zValidator("json", sendPushSchema),
  async (c) => {
    const data = c.req.valid("json");

    // Get user's device tokens
    const devices = await prisma.deviceToken.findMany({
      where: { userId: data.userId, isActive: true },
    });

    if (devices.length === 0) {
      return c.json(
        {
          success: false,
          error: {
            code: "NO_DEVICES",
            message: "User has no registered devices",
          },
        },
        400,
      );
    }

    const tokens = devices.map((d: (typeof devices)[number]) => d.token);

    // Send push notification
    const result = await firebaseService.sendMulticast({
      tokens,
      title: data.title,
      body: data.body,
      data: data.data,
      imageUrl: data.image,
      priority: data.priority,
    });

    // Log notification.
    // GAP: NotificationLog has no JSON `data` column, so the push payload is not
    // persisted on the log row (only channel/type/title/body/status).
    await prisma.notificationLog.create({
      data: {
        id: generateId("log"),
        userId: data.userId,
        channel: "PUSH",
        type: data.data?.type || "GENERAL",
        title: data.title,
        body: data.body,
        status: result.success
          ? NotificationStatus.SENT
          : NotificationStatus.FAILED,
        sentAt: new Date(),
      },
    });

    // Handle failed tokens (remove from database)
    if (result.failedTokens && result.failedTokens.length > 0) {
      await prisma.deviceToken.updateMany({
        where: { token: { in: result.failedTokens } },
        data: { isActive: false },
      });
    }

    return c.json({
      success: true,
      data: {
        successCount: result.successCount,
        failureCount: result.failureCount,
      },
    });
  },
);

/**
 * POST /push/batch - Send batch push notifications
 */
pushRoutes.post(
  "/batch",
  serviceAuth,
  zValidator("json", sendBatchPushSchema),
  async (c) => {
    const { userIds, title, body, data, image } = c.req.valid("json");

    // Get all device tokens for users
    const devices = await prisma.deviceToken.findMany({
      where: { userId: { in: userIds }, isActive: true },
    });

    if (devices.length === 0) {
      return c.json({
        success: true,
        data: { successCount: 0, failureCount: 0 },
      });
    }

    const tokens = devices.map((d: (typeof devices)[number]) => d.token);

    // Send in batches of 500 (FCM limit)
    const batchSize = 500;
    let totalSuccess = 0;
    let totalFailure = 0;

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const result = await firebaseService.sendMulticast({
        tokens: batch,
        title,
        body,
        data,
        imageUrl: image,
      });
      totalSuccess += result.successCount || 0;
      totalFailure += result.failureCount || 0;
    }

    return c.json({
      success: true,
      data: {
        successCount: totalSuccess,
        failureCount: totalFailure,
        totalUsers: userIds.length,
      },
    });
  },
);

/**
 * POST /push/topic - Send push to topic subscribers
 */
pushRoutes.post(
  "/topic",
  serviceAuth,
  zValidator("json", sendTopicPushSchema),
  async (c) => {
    const { topic, title, body, data } = c.req.valid("json");

    const result = await firebaseService.sendToTopic({
      topic,
      title,
      body,
      data,
    });

    return c.json({
      success: true,
      data: { messageId: result.messageId },
    });
  },
);

/**
 * POST /push/subscribe - Subscribe to topic
 */
pushRoutes.post("/subscribe", auth, async (c) => {
  // userId not used but available from auth context
  const { topic, token } = await c.req.json<{ topic: string; token: string }>();

  await firebaseService.subscribeToTopic([token], topic);

  return c.json({
    success: true,
    message: `Subscribed to ${topic}`,
  });
});

/**
 * POST /push/unsubscribe - Unsubscribe from topic
 */
pushRoutes.post("/unsubscribe", auth, async (c) => {
  const { topic, token } = await c.req.json<{ topic: string; token: string }>();

  await firebaseService.unsubscribeFromTopic([token], topic);

  return c.json({
    success: true,
    message: `Unsubscribed from ${topic}`,
  });
});

export { pushRoutes };
