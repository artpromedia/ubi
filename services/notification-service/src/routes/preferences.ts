/**
 * Notification Preferences Routes
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { generateId } from "../lib/utils";
import { auth, serviceAuth } from "../middleware/auth";
import { NotificationChannel, NotificationType } from "../types";

const preferencesRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const updatePreferencesSchema = z.object({
  pushEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),

  // Granular push preferences
  pushRideUpdates: z.boolean().optional(),
  pushFoodUpdates: z.boolean().optional(),
  pushDeliveryUpdates: z.boolean().optional(),
  pushPaymentUpdates: z.boolean().optional(),
  pushPromotions: z.boolean().optional(),
  pushNews: z.boolean().optional(),

  // Granular email preferences
  emailReceipts: z.boolean().optional(),
  emailPromotions: z.boolean().optional(),
  emailNewsletter: z.boolean().optional(),
  emailSecurityAlerts: z.boolean().optional(),

  // Granular SMS preferences
  smsOtp: z.boolean().optional(),
  smsCriticalAlerts: z.boolean().optional(),

  // Quiet hours
  quietHoursEnabled: z.boolean().optional(),
  quietHoursStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(), // HH:mm
  quietHoursEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
  quietHoursTimezone: z.string().optional(),

  // Frequency limits
  maxDailyPush: z.number().min(0).max(100).optional(),
  maxDailySms: z.number().min(0).max(20).optional(),
  maxDailyEmail: z.number().min(0).max(50).optional(),
});

// ============================================
// Routes
// ============================================

/**
 * GET /preferences - Get user preferences
 */
preferencesRoutes.get("/", auth, async (c) => {
  const userId = c.get("userId");

  let preferences = await prisma.notificationPreference.findUnique({
    where: { userId },
  });

  // Create default preferences if not exists
  if (!preferences) {
    preferences = await prisma.notificationPreference.create({
      data: {
        id: generateId("pref"),
        userId,
        pushEnabled: true,
        smsEnabled: true,
        emailEnabled: true,
        inAppEnabled: true,
        pushRideUpdates: true,
        pushFoodUpdates: true,
        pushDeliveryUpdates: true,
        pushPaymentUpdates: true,
        pushPromotions: true,
        pushNews: true,
        emailReceipts: true,
        emailPromotions: true,
        emailNewsletter: false,
        emailSecurityAlerts: true,
        smsOtp: true,
        smsCriticalAlerts: true,
        quietHoursEnabled: false,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
        quietHoursTimezone: "Africa/Lagos",
        maxDailyPush: 50,
        maxDailySms: 10,
        maxDailyEmail: 20,
      },
    });
  }

  return c.json({ success: true, data: { preferences } });
});

/**
 * PATCH /preferences - Update preferences
 */
preferencesRoutes.patch(
  "/",
  auth,
  zValidator("json", updatePreferencesSchema),
  async (c) => {
    const userId = c.get("userId");
    const data = c.req.valid("json");

    // Ensure preferences exist
    const existing = await prisma.notificationPreference.findUnique({
      where: { userId },
    });

    let preferences;
    if (!existing) {
      preferences = await prisma.notificationPreference.create({
        data: {
          id: generateId("pref"),
          userId,
          ...getDefaultPreferences(),
          ...data,
        },
      });
    } else {
      preferences = await prisma.notificationPreference.update({
        where: { userId },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    }

    return c.json({ success: true, data: { preferences } });
  }
);

/**
 * POST /preferences/reset - Reset to defaults
 */
preferencesRoutes.post("/reset", auth, async (c) => {
  const userId = c.get("userId");

  const preferences = await prisma.notificationPreference.upsert({
    where: { userId },
    create: {
      id: generateId("pref"),
      userId,
      ...getDefaultPreferences(),
    },
    update: {
      ...getDefaultPreferences(),
      updatedAt: new Date(),
    },
  });

  return c.json({ success: true, data: { preferences } });
});

/**
 * GET /preferences/check - Check if user can receive notification (service-to-service)
 */
preferencesRoutes.get("/check", serviceAuth, async (c) => {
  const userId = c.req.query("userId");
  const channel = c.req.query("channel") as NotificationChannel;
  const type = c.req.query("type") as NotificationType;

  if (!userId || !channel) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_PARAMS",
          message: "userId and channel required",
        },
      },
      400
    );
  }

  const preferences = await prisma.notificationPreference.findUnique({
    where: { userId },
  });

  // Default to allowing if no preferences set
  if (!preferences) {
    return c.json({ success: true, data: { allowed: true } });
  }

  // Check channel enabled
  const channelEnabled = {
    [NotificationChannel.PUSH]: preferences.pushEnabled,
    [NotificationChannel.SMS]: preferences.smsEnabled,
    [NotificationChannel.EMAIL]: preferences.emailEnabled,
    [NotificationChannel.IN_APP]: preferences.inAppEnabled,
  }[channel];

  if (!channelEnabled) {
    return c.json({
      success: true,
      data: { allowed: false, reason: "Channel disabled" },
    });
  }

  // Check quiet hours
  if (preferences.quietHoursEnabled) {
    const isQuietHours = checkQuietHours(
      preferences.quietHoursStart!,
      preferences.quietHoursEnd!,
      preferences.quietHoursTimezone!
    );

    // Only block non-critical during quiet hours
    const criticalTypes: NotificationType[] = [
      NotificationType.OTP,
      NotificationType.PASSWORD_RESET,
      NotificationType.SECURITY_ALERT,
      NotificationType.ACCOUNT_LOCKED,
      NotificationType.SOS_ALERT,
    ];

    if (isQuietHours && type && !criticalTypes.includes(type)) {
      return c.json({
        success: true,
        data: { allowed: false, reason: "Quiet hours" },
      });
    }
  }

  // Check granular preferences
  if (type && channel === NotificationChannel.PUSH) {
    const typePreferences: Partial<
      Record<NotificationType, boolean | undefined>
    > = {
      [NotificationType.RIDE_REQUESTED]: preferences.pushRideUpdates,
      [NotificationType.RIDE_ACCEPTED]: preferences.pushRideUpdates,
      [NotificationType.DRIVER_ARRIVED]: preferences.pushRideUpdates,
      [NotificationType.RIDE_STARTED]: preferences.pushRideUpdates,
      [NotificationType.RIDE_COMPLETED]: preferences.pushRideUpdates,
      [NotificationType.FOOD_ORDER_CONFIRMED]: preferences.pushFoodUpdates,
      [NotificationType.FOOD_PREPARING]: preferences.pushFoodUpdates,
      [NotificationType.FOOD_READY_FOR_PICKUP]: preferences.pushFoodUpdates,
      [NotificationType.FOOD_OUT_FOR_DELIVERY]: preferences.pushFoodUpdates,
      [NotificationType.FOOD_DELIVERED]: preferences.pushFoodUpdates,
      [NotificationType.DELIVERY_CREATED]: preferences.pushDeliveryUpdates,
      [NotificationType.DELIVERY_PICKED_UP]: preferences.pushDeliveryUpdates,
      [NotificationType.DELIVERY_IN_TRANSIT]: preferences.pushDeliveryUpdates,
      [NotificationType.DELIVERY_COMPLETED]: preferences.pushDeliveryUpdates,
      [NotificationType.PAYMENT_SUCCESSFUL]: preferences.pushPaymentUpdates,
      [NotificationType.PAYMENT_FAILED]: preferences.pushPaymentUpdates,
      [NotificationType.PROMO_CODE]: preferences.pushPromotions,
      [NotificationType.MARKETING]: preferences.pushPromotions,
    };

    const pref = typePreferences[type];
    if (pref === false) {
      return c.json({
        success: true,
        data: { allowed: false, reason: "Notification type disabled" },
      });
    }
  }

  // Check daily limits
  if (
    channel === NotificationChannel.PUSH &&
    preferences.maxDailyPush !== null
  ) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const count = await prisma.notificationLog.count({
      where: {
        userId,
        channel: "PUSH",
        sentAt: { gte: todayStart },
      },
    });

    if (count >= preferences.maxDailyPush!) {
      return c.json({
        success: true,
        data: { allowed: false, reason: "Daily limit reached" },
      });
    }
  }

  return c.json({ success: true, data: { allowed: true } });
});

/**
 * GET /preferences/unsubscribe - Generate unsubscribe token
 */
preferencesRoutes.get("/unsubscribe-token", auth, async (c) => {
  const userId = c.get("userId");
  const channel = c.req.query("channel") as NotificationChannel;

  if (!channel) {
    return c.json(
      {
        success: false,
        error: { code: "INVALID_PARAMS", message: "channel required" },
      },
      400
    );
  }

  // Generate signed token
  const payload = {
    userId,
    channel,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  }; // 30 days
  const token = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const unsubscribeUrl = `${process.env.APP_URL}/unsubscribe?token=${token}`;

  return c.json({
    success: true,
    data: { unsubscribeUrl, token },
  });
});

/**
 * POST /preferences/unsubscribe - Process unsubscribe
 */
preferencesRoutes.post("/unsubscribe", async (c) => {
  const { token } = await c.req.json<{ token: string }>();

  try {
    const payload = JSON.parse(Buffer.from(token, "base64url").toString());

    if (payload.exp < Date.now()) {
      return c.json(
        {
          success: false,
          error: {
            code: "TOKEN_EXPIRED",
            message: "Unsubscribe token has expired",
          },
        },
        400
      );
    }

    const { userId, channel } = payload;

    const updateData: Record<string, boolean> = {};
    if (channel === NotificationChannel.PUSH) {
      updateData.pushEnabled = false;
    } else if (channel === NotificationChannel.EMAIL) {
      updateData.emailEnabled = false;
    } else if (channel === NotificationChannel.SMS) {
      updateData.smsEnabled = false;
    }

    await prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        id: generateId("pref"),
        userId,
        ...getDefaultPreferences(),
        ...updateData,
      },
      update: updateData,
    });

    return c.json({ success: true, message: "Successfully unsubscribed" });
  } catch {
    return c.json(
      {
        success: false,
        error: { code: "INVALID_TOKEN", message: "Invalid unsubscribe token" },
      },
      400
    );
  }
});

// ============================================
// Helpers
// ============================================

function getDefaultPreferences() {
  return {
    pushEnabled: true,
    smsEnabled: true,
    emailEnabled: true,
    inAppEnabled: true,
    pushRideUpdates: true,
    pushFoodUpdates: true,
    pushDeliveryUpdates: true,
    pushPaymentUpdates: true,
    pushPromotions: true,
    pushNews: true,
    emailReceipts: true,
    emailPromotions: true,
    emailNewsletter: false,
    emailSecurityAlerts: true,
    smsOtp: true,
    smsCriticalAlerts: true,
    quietHoursEnabled: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    quietHoursTimezone: "Africa/Lagos",
    maxDailyPush: 50,
    maxDailySms: 10,
    maxDailyEmail: 20,
  };
}

function checkQuietHours(
  start: string,
  end: string,
  timezone: string
): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const timeString = formatter.format(now);
    const [hours, minutes] = timeString.split(":").map(Number);
    const currentMinutes = (hours ?? 0) * 60 + (minutes ?? 0);

    const [startHours, startMinutes] = start.split(":").map(Number);
    const [endHours, endMinutes] = end.split(":").map(Number);

    const startTotal = (startHours ?? 0) * 60 + (startMinutes ?? 0);
    const endTotal = (endHours ?? 0) * 60 + (endMinutes ?? 0);

    // Handle overnight quiet hours (e.g., 22:00 - 07:00)
    if (startTotal > endTotal) {
      return currentMinutes >= startTotal || currentMinutes < endTotal;
    }

    return currentMinutes >= startTotal && currentMinutes < endTotal;
  } catch {
    return false;
  }
}

export { preferencesRoutes };
