/**
 * Push Notification Routes (Firebase Cloud Messaging)
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { generateId } from "../lib/utils";
import { auth, serviceAuth } from "../middleware/auth";
import { firebaseService } from "../providers/firebase";
import { NotificationPriority, NotificationStatus } from "../types";

const pushRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const registerDeviceSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]),
  deviceId: z.string().optional(),
  appVersion: z.string().optional(),
});

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
    const { token, platform, deviceId, appVersion } = c.req.valid("json");

    // Upsert device token
    await prisma.deviceToken.upsert({
      where: {
        userId_token: { userId, token },
      },
      update: {
        platform,
        deviceId,
        appVersion,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        id: generateId("dev"),
        userId,
        token,
        platform,
        deviceId,
        appVersion,
        isActive: true,
      },
    });

    return c.json({
      success: true,
      message: "Device registered for push notifications",
    });
  }
);

/**
 * DELETE /push/devices/:token - Unregister device
 */
pushRoutes.delete("/devices/:token", auth, async (c) => {
  const userId = c.get("userId");
  const token = c.req.param("token");

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
        400
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

    // Log notification
    await prisma.notificationLog.create({
      data: {
        id: generateId("log"),
        userId: data.userId,
        channel: "PUSH",
        type: data.data?.type || "GENERAL",
        title: data.title,
        body: data.body,
        data: data.data,
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
  }
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
  }
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
  }
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
