/**
 * SMS Routes (Africa's Talking + Twilio fallback)
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { generateId, generateOTP } from "../lib/utils";
import { serviceAuth } from "../middleware/auth";
import { smsService } from "../providers/sms";
import { NotificationStatus } from "../types";

const smsRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const sendSMSSchema = z.object({
  userId: z.string().optional(),
  phone: z.string().min(10).max(15),
  message: z.string().min(1).max(160),
  senderId: z.string().optional(),
});

const sendBatchSMSSchema = z.object({
  recipients: z
    .array(
      z.object({
        phone: z.string(),
        message: z.string().max(160),
      }),
    )
    .min(1)
    .max(100),
  senderId: z.string().optional(),
});

const sendOTPSchema = z.object({
  userId: z.string().optional(),
  phone: z.string().min(10).max(15),
  purpose: z.enum(["login", "verification", "password_reset", "transaction"]),
  length: z.number().int().min(4).max(8).default(6),
  expiresInMinutes: z.number().int().min(1).max(30).default(5),
});

const verifyOTPSchema = z.object({
  phone: z.string().min(10).max(15),
  code: z.string().min(4).max(8),
  purpose: z.enum(["login", "verification", "password_reset", "transaction"]),
});

// ============================================
// Routes
// ============================================

/**
 * POST /sms/send - Send SMS (service-to-service)
 */
smsRoutes.post(
  "/send",
  serviceAuth,
  zValidator("json", sendSMSSchema),
  async (c) => {
    const { userId, phone, message, senderId } = c.req.valid("json");

    // Check user preferences if userId provided
    if (userId) {
      const prefs = await prisma.notificationPreference.findUnique({
        where: { userId },
      });

      if (prefs && !prefs.smsEnabled) {
        return c.json(
          {
            success: false,
            error: {
              code: "SMS_DISABLED",
              message: "User has disabled SMS notifications",
            },
          },
          400,
        );
      }
    }

    // Send SMS
    const result = await smsService.send({
      to: phone,
      message,
      senderId: senderId || "UBI",
    });

    // Log notification
    await prisma.notificationLog.create({
      data: {
        id: generateId("log"),
        userId,
        channel: "SMS",
        type: "GENERAL",
        body: message,
        recipient: phone,
        status: result.success
          ? NotificationStatus.SENT
          : NotificationStatus.FAILED,
        externalId: result.messageId,
        error: result.error,
        sentAt: new Date(),
      },
    });

    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            code: "SMS_FAILED",
            message: result.error || "Failed to send SMS",
          },
        },
        500,
      );
    }

    return c.json({
      success: true,
      data: { messageId: result.messageId },
    });
  },
);

/**
 * POST /sms/batch - Send batch SMS
 */
smsRoutes.post(
  "/batch",
  serviceAuth,
  zValidator("json", sendBatchSMSSchema),
  async (c) => {
    const { recipients, senderId } = c.req.valid("json");

    const results = await Promise.all(
      recipients.map(async (r) => {
        const result = await smsService.send({
          to: r.phone,
          message: r.message,
          senderId: senderId || "UBI",
        });

        return {
          phone: r.phone,
          success: result.success,
          messageId: result.messageId,
          error: result.error,
        };
      }),
    );

    const successCount = results.filter((r) => r.success).length;

    return c.json({
      success: true,
      data: {
        total: recipients.length,
        successCount,
        failureCount: recipients.length - successCount,
        results,
      },
    });
  },
);

/**
 * POST /sms/otp - Send OTP via SMS
 */
smsRoutes.post(
  "/otp",
  serviceAuth,
  zValidator("json", sendOTPSchema),
  async (c) => {
    const { userId, phone, purpose, length, expiresInMinutes } =
      c.req.valid("json");

    // Rate limit OTP requests (max 3 per 10 minutes)
    const rateLimitKey = `otp:ratelimit:${phone}:${purpose}`;
    const attempts = await redis.incr(rateLimitKey);
    if (attempts === 1) {
      await redis.expire(rateLimitKey, 600);
    }
    if (attempts > 3) {
      return c.json(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many OTP requests. Try again later.",
          },
        },
        429,
      );
    }

    // Generate OTP
    const otp = generateOTP(length);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    // Store OTP in Redis
    const otpKey = `otp:${phone}:${purpose}`;
    await redis.set(otpKey, otp, "EX", expiresInMinutes * 60);

    // Send SMS
    const message = getOTPMessage(purpose, otp, expiresInMinutes);
    const result = await smsService.send({
      to: phone,
      message,
      senderId: "UBI",
    });

    // Log
    await prisma.notificationLog.create({
      data: {
        id: generateId("log"),
        userId,
        channel: "SMS",
        type: "OTP",
        body: `OTP sent for ${purpose}`,
        recipient: phone,
        status: result.success
          ? NotificationStatus.SENT
          : NotificationStatus.FAILED,
        sentAt: new Date(),
      },
    });

    if (!result.success) {
      return c.json(
        {
          success: false,
          error: { code: "SMS_FAILED", message: "Failed to send OTP" },
        },
        500,
      );
    }

    return c.json({
      success: true,
      data: {
        expiresAt,
        length,
      },
    });
  },
);

/**
 * POST /sms/otp/verify - Verify OTP
 */
smsRoutes.post(
  "/otp/verify",
  zValidator("json", verifyOTPSchema),
  async (c) => {
    const { phone, code, purpose } = c.req.valid("json");

    const otpKey = `otp:${phone}:${purpose}`;
    const storedOTP = await redis.get(otpKey);

    if (!storedOTP) {
      return c.json(
        {
          success: false,
          error: { code: "OTP_EXPIRED", message: "OTP has expired" },
        },
        400,
      );
    }

    if (storedOTP !== code) {
      // Track failed attempts
      const failKey = `otp:fail:${phone}:${purpose}`;
      const failAttempts = await redis.incr(failKey);
      if (failAttempts === 1) {
        await redis.expire(failKey, 300);
      }

      // Lock after 5 failed attempts
      if (failAttempts >= 5) {
        await redis.del(otpKey);
        return c.json(
          {
            success: false,
            error: { code: "OTP_LOCKED", message: "Too many failed attempts" },
          },
          400,
        );
      }

      return c.json(
        {
          success: false,
          error: { code: "INVALID_OTP", message: "Invalid OTP" },
        },
        400,
      );
    }

    // Delete OTP after successful verification
    await redis.del(otpKey);
    await redis.del(`otp:fail:${phone}:${purpose}`);

    return c.json({
      success: true,
      data: { verified: true },
    });
  },
);

/**
 * GET /sms/status/:messageId - Get SMS delivery status
 */
smsRoutes.get("/status/:messageId", serviceAuth, async (c) => {
  const messageId = c.req.param("messageId");

  const status = await smsService.getStatus(messageId);

  return c.json({
    success: true,
    data: status,
  });
});

// ============================================
// Helpers
// ============================================

function getOTPMessage(
  purpose: string,
  otp: string,
  expiresIn: number,
): string {
  const messages: Record<string, string> = {
    login: `Your UBI login code is ${otp}. Valid for ${expiresIn} minutes. Do not share.`,
    verification: `Your UBI verification code is ${otp}. Valid for ${expiresIn} minutes.`,
    password_reset: `Your UBI password reset code is ${otp}. Valid for ${expiresIn} minutes. Do not share.`,
    transaction: `Your UBI transaction code is ${otp}. Valid for ${expiresIn} minutes. Do not share.`,
  };
  return (
    messages[purpose] ||
    `Your UBI code is ${otp}. Valid for ${expiresIn} minutes.`
  );
}

export { smsRoutes };
