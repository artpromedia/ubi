/**
 * Split Fare Routes
 * API endpoints for fare splitting functionality
 *
 * Endpoints:
 * - POST /rides/:id/split - Initiate a fare split
 * - GET  /rides/:id/split - Get split status
 * - POST /splits/:id/accept - Accept invitation (token-based)
 * - POST /splits/:id/decline - Decline invitation
 * - POST /splits/:id/pay - Pay your share
 * - GET  /splits/my - Get user's splits
 * - POST /splits/:id/cancel - Cancel split (initiator only)
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { splitFareLogger } from "../lib/logger";
import { splitFareService } from "../services/split-fare.service";

import type { Currency } from "@prisma/client";

const splitFareRoutes = new Hono();

// ===========================================
// SCHEMAS
// ===========================================

const initiateSplitSchema = z.object({
  totalAmount: z.number().positive("Total amount must be positive"),
  currency: z.enum(["NGN", "KES", "ZAR", "GHS", "RWF", "ETB", "USD"]),
  splitType: z.enum(["EQUAL", "CUSTOM", "PERCENTAGE"]).default("EQUAL"),
  participants: z
    .array(
      z.object({
        phone: z.string().min(10, "Valid phone number required"),
        name: z.string().optional(),
        email: z.string().email().optional(),
        amount: z.number().positive().optional(), // For CUSTOM split
        percentage: z.number().min(1).max(100).optional(), // For PERCENTAGE split
      }),
    )
    .min(1, "At least one participant required")
    .max(3, "Maximum 3 participants allowed (plus initiator)"),
  primaryPayerFallbackEnabled: z.boolean().default(true),
  expiresInMinutes: z.number().min(15).max(1440).default(60), // 15 min to 24 hours
  metadata: z.record(z.any()).optional(),
});

const acceptSplitSchema = z.object({
  token: z.string().min(1, "Invitation token required"),
});

const declineSplitSchema = z.object({
  token: z.string().min(1, "Invitation token required"),
  reason: z.string().max(200).optional(),
});

const paySplitSchema = z.object({
  participantId: z.string().optional(),
  paymentMethod: z.enum([
    "WALLET",
    "CARD",
    "MPESA",
    "MTN_MOMO",
    "AIRTEL_MONEY",
  ]),
  paymentDetails: z.record(z.any()).optional(),
  pin: z.string().length(4).optional(), // For wallet payments
});

const cancelSplitSchema = z.object({
  reason: z.string().max(200).optional(),
});

const getSplitsQuerySchema = z.object({
  type: z.enum(["initiated", "participated", "all"]).default("all"),
  status: z
    .enum([
      "PENDING",
      "ACTIVE",
      "COMPLETED",
      "PARTIALLY_PAID",
      "CANCELLED",
      "EXPIRED",
    ])
    .optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  offset: z.coerce.number().min(0).default(0),
});

// ===========================================
// ROUTES
// ===========================================

/**
 * POST /rides/:id/split - Initiate a fare split for a ride
 */
splitFareRoutes.post(
  "/rides/:id/split",
  zValidator("json", initiateSplitSchema),
  async (c) => {
    const userId = c.get("userId");
    const rideId = c.req.param("id");
    const body = c.req.valid("json");

    try {
      const result = await splitFareService.initiateSplit(userId, {
        rideId,
        totalAmount: body.totalAmount,
        currency: body.currency as Currency,
        splitType: body.splitType,
        participants: body.participants,
        primaryPayerFallbackEnabled: body.primaryPayerFallbackEnabled,
        expiresInMinutes: body.expiresInMinutes,
        metadata: body.metadata,
      });

      splitFareLogger.info(
        {
          userId,
          rideId,
          splitId: result.splitId,
          participantCount: body.participants.length,
        },
        "Split fare initiated via API",
      );

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      splitFareLogger.error(
        { err: error, userId, rideId },
        "Failed to initiate split fare",
      );

      const message =
        error instanceof Error
          ? error.message
          : "Failed to initiate split fare";
      return c.json(
        {
          success: false,
          error: { code: "SPLIT_INITIATION_FAILED", message },
        },
        400,
      );
    }
  },
);

/**
 * GET /rides/:id/split - Get split status for a ride
 */
splitFareRoutes.get("/rides/:id/split", async (c) => {
  const userId = c.get("userId");
  const rideId = c.req.param("id");

  try {
    // Find split by ride ID
    const { prisma } = await import("../lib/prisma");
    const split = await prisma.fareSplit.findFirst({
      where: { rideId },
      orderBy: { createdAt: "desc" },
    });

    if (!split) {
      return c.json(
        {
          success: false,
          error: {
            code: "SPLIT_NOT_FOUND",
            message: "No split found for this ride",
          },
        },
        404,
      );
    }

    const result = await splitFareService.getSplitStatus(split.id);

    // Check authorization - must be initiator or participant
    const isInitiator = result.initiator.userId === userId;
    const isParticipant = result.participants.some((p) => {
      // Check if user's phone matches (need to get user phone)
      return p.isUbiUser;
    });

    if (!isInitiator && !isParticipant) {
      return c.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Not authorized to view this split",
          },
        },
        403,
      );
    }

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    splitFareLogger.error(
      { err: error, userId, rideId },
      "Failed to get split status",
    );

    const message =
      error instanceof Error ? error.message : "Failed to get split status";
    return c.json(
      {
        success: false,
        error: { code: "GET_SPLIT_FAILED", message },
      },
      500,
    );
  }
});

/**
 * GET /splits/:id - Get split status by ID
 */
splitFareRoutes.get("/splits/:id", async (c) => {
  const userId = c.get("userId");
  const splitId = c.req.param("id");

  try {
    const result = await splitFareService.getSplitStatus(splitId);

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    splitFareLogger.error(
      { err: error, userId, splitId },
      "Failed to get split status",
    );

    const message = error instanceof Error ? error.message : "Split not found";
    return c.json(
      {
        success: false,
        error: { code: "SPLIT_NOT_FOUND", message },
      },
      404,
    );
  }
});

/**
 * POST /splits/:id/accept - Accept a split invitation
 * Can be called with or without authentication (for non-UBI users)
 */
splitFareRoutes.post(
  "/splits/:id/accept",
  zValidator("json", acceptSplitSchema),
  async (c) => {
    const userId = c.get("userId"); // May be undefined for non-logged-in users
    const splitId = c.req.param("id");
    const { token } = c.req.valid("json");

    try {
      const result = await splitFareService.acceptSplit({
        token,
        userId,
      });

      splitFareLogger.info(
        { splitId, userId, token: token.substring(0, 8) + "..." },
        "Split invitation accepted",
      );

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      splitFareLogger.error(
        { err: error, splitId },
        "Failed to accept split invitation",
      );

      const message =
        error instanceof Error ? error.message : "Failed to accept invitation";
      return c.json(
        {
          success: false,
          error: { code: "ACCEPT_FAILED", message },
        },
        400,
      );
    }
  },
);

/**
 * POST /splits/:id/decline - Decline a split invitation
 */
splitFareRoutes.post(
  "/splits/:id/decline",
  zValidator("json", declineSplitSchema),
  async (c) => {
    const splitId = c.req.param("id");
    const { token, reason } = c.req.valid("json");

    try {
      const result = await splitFareService.declineSplit({ token, reason });

      splitFareLogger.info(
        { splitId, token: token.substring(0, 8) + "...", reason },
        "Split invitation declined",
      );

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      splitFareLogger.error(
        { err: error, splitId },
        "Failed to decline split invitation",
      );

      const message =
        error instanceof Error ? error.message : "Failed to decline invitation";
      return c.json(
        {
          success: false,
          error: { code: "DECLINE_FAILED", message },
        },
        400,
      );
    }
  },
);

/**
 * POST /splits/:id/pay - Pay your share of the split
 */
splitFareRoutes.post(
  "/splits/:id/pay",
  zValidator("json", paySplitSchema),
  async (c) => {
    const userId = c.get("userId");
    const splitId = c.req.param("id");
    const { participantId, paymentMethod, paymentDetails, pin } =
      c.req.valid("json");

    try {
      const result = await splitFareService.payShare(userId, {
        splitId,
        participantId,
        userId,
        paymentMethod,
        paymentDetails,
        pin,
      });

      splitFareLogger.info(
        {
          splitId,
          userId,
          paymentMethod,
          amount: result.amount,
          allPaid: result.allPaid,
        },
        "Split payment processed",
      );

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      splitFareLogger.error(
        { err: error, splitId, userId, paymentMethod },
        "Failed to process split payment",
      );

      const message = error instanceof Error ? error.message : "Payment failed";
      return c.json(
        {
          success: false,
          error: { code: "PAYMENT_FAILED", message },
        },
        400,
      );
    }
  },
);

/**
 * POST /splits/:id/cancel - Cancel a split (initiator only)
 */
splitFareRoutes.post(
  "/splits/:id/cancel",
  zValidator("json", cancelSplitSchema),
  async (c) => {
    const userId = c.get("userId");
    const splitId = c.req.param("id");
    const { reason } = c.req.valid("json");

    try {
      const result = await splitFareService.cancelSplit(
        splitId,
        userId,
        reason,
      );

      splitFareLogger.info({ splitId, userId, reason }, "Split fare cancelled");

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      splitFareLogger.error(
        { err: error, splitId, userId },
        "Failed to cancel split",
      );

      const message =
        error instanceof Error ? error.message : "Failed to cancel split";
      return c.json(
        {
          success: false,
          error: { code: "CANCEL_FAILED", message },
        },
        400,
      );
    }
  },
);

/**
 * GET /splits/my - Get user's splits (initiated and participated)
 */
splitFareRoutes.get(
  "/splits/my",
  zValidator("query", getSplitsQuerySchema),
  async (c) => {
    const userId = c.get("userId");
    const { type, status, limit, offset } = c.req.valid("query");

    try {
      let splits = await splitFareService.getUserSplits(userId, type);

      // Filter by status if provided
      if (status) {
        splits = splits.filter((s) => s.status === status);
      }

      // Apply pagination
      const total = splits.length;
      const paginatedSplits = splits.slice(offset, offset + limit);

      return c.json({
        success: true,
        data: {
          splits: paginatedSplits,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total,
          },
        },
      });
    } catch (error) {
      splitFareLogger.error(
        { err: error, userId },
        "Failed to get user splits",
      );

      const message =
        error instanceof Error ? error.message : "Failed to get splits";
      return c.json(
        {
          success: false,
          error: { code: "GET_SPLITS_FAILED", message },
        },
        500,
      );
    }
  },
);

/**
 * POST /rides/:id/split/complete - Handle ride completion (webhook from ride service)
 * Triggers payment deadline for split participants
 */
splitFareRoutes.post("/rides/:id/split/complete", async (c) => {
  const rideId = c.req.param("id");
  const apiKey = c.req.header("X-API-Key");

  // Validate internal API key
  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return c.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid API key" },
      },
      401,
    );
  }

  try {
    await splitFareService.handleRideCompletion(rideId);

    splitFareLogger.info({ rideId }, "Ride completion handled for split fare");

    return c.json({
      success: true,
      message: "Ride completion processed",
    });
  } catch (error) {
    splitFareLogger.error(
      { err: error, rideId },
      "Failed to handle ride completion",
    );

    return c.json(
      {
        success: false,
        error: {
          code: "COMPLETION_FAILED",
          message: "Failed to process ride completion",
        },
      },
      500,
    );
  }
});

/**
 * POST /webhooks/split-fare/deadline - Handle payment deadline (internal cron)
 */
splitFareRoutes.post("/webhooks/split-fare/deadline", async (c) => {
  const apiKey = c.req.header("X-API-Key");

  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return c.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid API key" },
      },
      401,
    );
  }

  const body = await c.req.json();
  const splitId = body.splitId;

  if (!splitId) {
    return c.json(
      {
        success: false,
        error: { code: "INVALID_REQUEST", message: "Split ID required" },
      },
      400,
    );
  }

  try {
    await splitFareService.handlePaymentDeadline(splitId);

    splitFareLogger.info({ splitId }, "Payment deadline handled");

    return c.json({
      success: true,
      message: "Deadline processed",
    });
  } catch (error) {
    splitFareLogger.error(
      { err: error, splitId },
      "Failed to handle payment deadline",
    );

    return c.json(
      {
        success: false,
        error: {
          code: "DEADLINE_FAILED",
          message: "Failed to process deadline",
        },
      },
      500,
    );
  }
});

/**
 * GET /splits/public/:token - Public endpoint to view split by token (for deep links)
 * No authentication required
 */
splitFareRoutes.get("/splits/public/:token", async (c) => {
  const token = c.req.param("token");

  try {
    const { prisma } = await import("../lib/prisma");

    // Find participant by token
    const participant = await prisma.fareSplitParticipant.findFirst({
      where: { invitationToken: token },
      include: {
        fareSplit: {
          include: {
            participants: {
              select: {
                id: true,
                phone: true,
                name: true,
                amount: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!participant) {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_TOKEN",
            message: "Invalid or expired invitation",
          },
        },
        404,
      );
    }

    const split = participant.fareSplit;

    // Get initiator name
    const initiator = await prisma.user.findUnique({
      where: { id: split.initiatorUserId },
      select: { firstName: true, lastName: true },
    });

    // Return limited info for public view
    return c.json({
      success: true,
      data: {
        splitId: split.id,
        status: split.status,
        totalAmount: Number(split.totalAmount),
        currency: split.currency,
        splitType: split.splitType,
        initiatorName: initiator
          ? `${initiator.firstName} ${initiator.lastName}`.trim()
          : "UBI User",
        participant: {
          phone: participant.phone,
          name: participant.name,
          amount: Number(participant.amount),
          status: participant.status,
        },
        invitationExpiresAt: split.invitationExpiresAt,
        paymentDeadline: split.paymentDeadline,
        isExpired: split.invitationExpiresAt < new Date(),
        canAccept:
          participant.status === "INVITED" &&
          split.invitationExpiresAt > new Date() &&
          split.status !== "CANCELLED" &&
          split.status !== "COMPLETED",
      },
    });
  } catch (error) {
    splitFareLogger.error(
      { err: error, token: token.substring(0, 8) + "..." },
      "Failed to get public split info",
    );

    return c.json(
      {
        success: false,
        error: {
          code: "GET_SPLIT_FAILED",
          message: "Failed to get split info",
        },
      },
      500,
    );
  }
});

export default splitFareRoutes;
