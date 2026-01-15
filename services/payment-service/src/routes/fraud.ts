/**
 * Fraud Detection Routes
 *
 * Manual review queue and fraud management
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { FraudDetectionService } from "../services/fraud-detection.service";

const fraudRoutes = new Hono();
const fraudService = new FraudDetectionService(prisma);

/**
 * Assess transaction risk
 * POST /api/v1/fraud/assess
 */
fraudRoutes.post(
  "/assess",
  zValidator(
    "json",
    z.object({
      userId: z.string(),
      amount: z.number().positive(),
      currency: z.string(),
      ipAddress: z.string().optional(),
      deviceId: z.string().optional(),
      userAgent: z.string().optional(),
      location: z
        .object({
          latitude: z.number(),
          longitude: z.number(),
          country: z.string().optional(),
          city: z.string().optional(),
        })
        .optional(),
      paymentMethod: z.string().optional(),
      metadata: z.record(z.any()).optional(),
    }),
  ),
  async (c) => {
    try {
      const request = c.req.valid("json");
      const result = await fraudService.assessRisk(request);

      return c.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error("Risk assessment error:", error);
      return c.json(
        {
          success: false,
          error: error.message || "Failed to assess risk",
        },
        500,
      );
    }
  },
);

/**
 * Get pending review queue
 * GET /api/v1/fraud/review-queue
 */
fraudRoutes.get("/review-queue", async (c) => {
  try {
    const limit = Number(c.req.query("limit")) || 20;
    const offset = Number(c.req.query("offset")) || 0;
    const minRiskScore = Number(c.req.query("minRiskScore")) || 50;

    const queue = await fraudService.getPendingReviews({
      limit,
      offset,
      minRiskScore,
    });

    return c.json({
      success: true,
      data: queue,
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
});

/**
 * Approve transaction
 * POST /api/v1/fraud/approve/:assessmentId
 */
fraudRoutes.post("/approve/:assessmentId", async (c) => {
  try {
    const assessmentId = c.req.param("assessmentId");
    const reviewedBy = c.get("userId") || "admin"; // Get from auth context

    await fraudService.approveTransaction(assessmentId, reviewedBy);

    return c.json({
      success: true,
      message: "Transaction approved",
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      400,
    );
  }
});

/**
 * Reject transaction
 * POST /api/v1/fraud/reject/:assessmentId
 */
fraudRoutes.post(
  "/reject/:assessmentId",
  zValidator(
    "json",
    z.object({
      reason: z.string(),
    }),
  ),
  async (c) => {
    try {
      const assessmentId = c.req.param("assessmentId");
      const { reason } = c.req.valid("json");
      const reviewedBy = c.get("userId") || "admin";

      await fraudService.rejectTransaction(assessmentId, reviewedBy, reason);

      return c.json({
        success: true,
        message: "Transaction rejected",
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: error.message,
        },
        400,
      );
    }
  },
);

export default fraudRoutes;
