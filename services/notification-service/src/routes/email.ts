/**
 * Email Routes (SendGrid)
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { generateId } from "../lib/utils";
import { serviceAuth } from "../middleware/auth";
import { emailService } from "../providers/sendgrid";
import { NotificationStatus, NotificationType } from "../types";

const emailRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const sendEmailSchema = z.object({
  userId: z.string().optional(),
  to: z.string().email(),
  subject: z.string().max(200),
  html: z.string().optional(),
  text: z.string().optional(),
  templateId: z.string().optional(),
  templateData: z.record(z.any()).optional(),
  from: z.string().email().optional(),
  replyTo: z.string().email().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        content: z.string(), // Base64
        contentType: z.string(),
      }),
    )
    .optional(),
});

const sendBatchEmailSchema = z.object({
  recipients: z
    .array(
      z.object({
        email: z.string().email(),
        templateData: z.record(z.any()).optional(),
      }),
    )
    .min(1)
    .max(1000),
  subject: z.string().max(200),
  templateId: z.string(),
  from: z.string().email().optional(),
});

const sendTransactionalSchema = z.object({
  userId: z.string(),
  type: z.nativeEnum(NotificationType),
  data: z.record(z.any()),
});

// ============================================
// Routes
// ============================================

/**
 * POST /email/send - Send email (service-to-service)
 */
emailRoutes.post(
  "/send",
  serviceAuth,
  zValidator("json", sendEmailSchema),
  async (c) => {
    const data = c.req.valid("json");

    // Check user preferences if userId provided
    if (data.userId) {
      const prefs = await prisma.notificationPreference.findUnique({
        where: { userId: data.userId },
      });

      if (prefs && !prefs.emailEnabled) {
        return c.json(
          {
            success: false,
            error: {
              code: "EMAIL_DISABLED",
              message: "User has disabled email notifications",
            },
          },
          400,
        );
      }
    }

    // Send email
    const result = await emailService.send({
      to: data.to,
      subject: data.subject,
      html: data.html,
      text: data.text,
      templateId: data.templateId,
      templateData: data.templateData,
      from: data.from,
      replyTo: data.replyTo,
      attachments: data.attachments,
    });

    // Log notification
    await prisma.notificationLog.create({
      data: {
        id: generateId("log"),
        userId: data.userId,
        channel: "EMAIL",
        type: "GENERAL",
        title: data.subject,
        recipient: data.to,
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
            code: "EMAIL_FAILED",
            message: result.error || "Failed to send email",
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
 * POST /email/batch - Send batch emails
 */
emailRoutes.post(
  "/batch",
  serviceAuth,
  zValidator("json", sendBatchEmailSchema),
  async (c) => {
    const { recipients, subject, templateId, from } = c.req.valid("json");

    // Send in batches
    const batchSize = 100;
    let totalSuccess = 0;
    let totalFailure = 0;

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);

      const results = await Promise.all(
        batch.map(async (r) => {
          const result = await emailService.send({
            to: r.email,
            subject,
            templateId,
            templateData: r.templateData,
            from,
          });
          return result.success;
        }),
      );

      totalSuccess += results.filter(Boolean).length;
      totalFailure += results.filter((r) => !r).length;
    }

    return c.json({
      success: true,
      data: {
        total: recipients.length,
        successCount: totalSuccess,
        failureCount: totalFailure,
      },
    });
  },
);

/**
 * POST /email/transactional - Send transactional email
 */
emailRoutes.post(
  "/transactional",
  serviceAuth,
  zValidator("json", sendTransactionalSchema),
  async (c) => {
    const { userId, type, data } = c.req.valid("json");

    // Get user email
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true },
    });

    if (!user || !user.email) {
      return c.json(
        {
          success: false,
          error: { code: "USER_NOT_FOUND", message: "User email not found" },
        },
        404,
      );
    }

    // Get template
    const template = await prisma.notificationTemplate.findFirst({
      where: { type, channel: "EMAIL", isActive: true },
    });

    if (!template) {
      return c.json(
        {
          success: false,
          error: {
            code: "TEMPLATE_NOT_FOUND",
            message: "Email template not found",
          },
        },
        404,
      );
    }

    // Prepare template data
    const templateData = {
      firstName: user.firstName,
      lastName: user.lastName,
      ...data,
    };

    // Send email
    const result = await emailService.send({
      to: user.email,
      subject: interpolateTemplate(template.title, templateData),
      html: interpolateTemplate(
        template.htmlBody || template.body,
        templateData,
      ),
      text: interpolateTemplate(template.body, templateData),
    });

    // Log
    await prisma.notificationLog.create({
      data: {
        id: generateId("log"),
        userId,
        channel: "EMAIL",
        type,
        title: template.title,
        recipient: user.email,
        status: result.success
          ? NotificationStatus.SENT
          : NotificationStatus.FAILED,
        sentAt: new Date(),
      },
    });

    return c.json(
      {
        success: result.success,
        data: result.success ? { messageId: result.messageId } : undefined,
        error: result.success
          ? undefined
          : { code: "EMAIL_FAILED", message: result.error },
      },
      result.success ? 200 : 500,
    );
  },
);

/**
 * POST /email/welcome - Send welcome email
 */
emailRoutes.post("/welcome", serviceAuth, async (c) => {
  const { userId } = await c.req.json<{ userId: string }>();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true },
  });

  if (!user || !user.email) {
    return c.json(
      {
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      },
      404,
    );
  }

  const result = await emailService.send({
    to: user.email,
    subject: "Welcome to UBI!",
    templateId: process.env.SENDGRID_WELCOME_TEMPLATE_ID,
    templateData: {
      firstName: user.firstName,
      appUrl: process.env.APP_URL || "https://ubi.africa",
    },
  });

  return c.json({
    success: result.success,
    data: result.success ? { messageId: result.messageId } : undefined,
  });
});

/**
 * POST /email/receipt - Send receipt email
 */
emailRoutes.post("/receipt", serviceAuth, async (c) => {
  const { userId, orderId, orderType, amount, currency, items } =
    await c.req.json<{
      userId: string;
      orderId: string;
      orderType: "ride" | "food" | "delivery";
      amount: number;
      currency: string;
      items?: Array<{ name: string; quantity: number; price: number }>;
    }>();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true },
  });

  if (!user || !user.email) {
    return c.json(
      {
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      },
      404,
    );
  }

  // Check preferences
  const prefs = await prisma.notificationPreference.findUnique({
    where: { userId },
  });

  if (prefs && !prefs.emailReceipts) {
    return c.json({
      success: true,
      data: { skipped: true, reason: "User disabled receipts" },
    });
  }

  const result = await emailService.send({
    to: user.email,
    subject: `Your UBI ${orderType} receipt - ${orderId}`,
    templateId: process.env.SENDGRID_RECEIPT_TEMPLATE_ID,
    templateData: {
      firstName: user.firstName,
      orderId,
      orderType,
      amount,
      currency,
      items,
      date: new Date().toLocaleDateString(),
    },
  });

  return c.json({
    success: result.success,
    data: result.success ? { messageId: result.messageId } : undefined,
  });
});

// ============================================
// Helpers
// ============================================

function interpolateTemplate(
  template: string,
  data: Record<string, any>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] !== undefined ? String(data[key]) : match;
  });
}

export { emailRoutes };
