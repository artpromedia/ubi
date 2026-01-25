/**
 * Vehicle Financing Routes
 * API endpoints for vehicle marketplace and financing functionality
 *
 * Endpoints:
 * - GET  /vehicles - List marketplace vehicles
 * - GET  /vehicles/:id - Get vehicle details
 * - GET  /vehicles/recommended - Get recommended vehicles
 * - POST /vehicles/:id/eligibility - Check financing eligibility
 * - POST /vehicles/:id/apply - Submit financing application
 * - GET  /applications - List user's applications
 * - GET  /applications/:id - Get application details
 * - POST /applications/:id/accept - Accept approved financing
 * - POST /applications/:id/cancel - Cancel application
 * - GET  /financing - List user's active financings
 * - GET  /financing/:id - Get financing details
 * - GET  /financing/:id/schedule - Get payment schedule
 * - POST /financing/:id/pay - Make a payment
 * - PUT  /financing/:id/auto-deduct - Update auto-deduction settings
 * - GET  /financing/dashboard - Get financing dashboard
 * - GET  /financing/summary - Get financing summary
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { vehicleFinancingLogger } from "../lib/logger";
import { vehicleFinancingService } from "../services/vehicle-financing.service";

import type { Currency, VehicleType } from "@prisma/client";

const vehicleFinancingRoutes = new Hono();

// ===========================================
// SCHEMAS
// ===========================================

const listVehiclesSchema = z.object({
  make: z.string().optional(),
  model: z.string().optional(),
  yearMin: z.coerce.number().min(2000).optional(),
  yearMax: z.coerce.number().max(2030).optional(),
  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().optional(),
  vehicleType: z
    .enum(["SEDAN", "SUV", "VAN", "MOTORCYCLE", "ELECTRIC"])
    .optional(),
  condition: z.enum(["NEW", "USED", "CERTIFIED"]).optional(),
  fuelType: z.enum(["PETROL", "DIESEL", "ELECTRIC", "HYBRID"]).optional(),
  transmission: z.enum(["AUTOMATIC", "MANUAL"]).optional(),
  financingAvailable: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  location: z.string().optional(),
  sortBy: z
    .enum(["price_asc", "price_desc", "year_desc", "newest"])
    .default("newest"),
  limit: z.coerce.number().min(1).max(50).default(20),
  offset: z.coerce.number().min(0).default(0),
});

const eligibilityCheckSchema = z.object({
  requestedAmount: z.number().positive(),
  requestedTermMonths: z.number().min(6).max(48),
});

const applyFinancingSchema = z.object({
  requestedAmount: z.number().positive(),
  downPaymentAmount: z.number().positive(),
  requestedTermMonths: z.number().min(6).max(48),
  planType: z.enum(["LEASE_TO_OWN", "RENT_TO_OWN", "LOAN"]),
  currency: z.enum(["NGN", "KES", "ZAR", "GHS", "RWF", "ETB", "USD"]),
  monthlyIncome: z.number().positive().optional(),
  employmentStatus: z.string().optional(),
  drivingExperienceYears: z.number().min(0).optional(),
  documents: z
    .array(
      z.object({
        type: z.enum([
          "DRIVERS_LICENSE",
          "NATIONAL_ID",
          "PROOF_OF_INCOME",
          "BANK_STATEMENT",
          "PROOF_OF_ADDRESS",
          "INSURANCE_CERTIFICATE",
        ]),
        url: z.string().url(),
        name: z.string(),
        uploadedAt: z.string().datetime(),
      }),
    )
    .optional(),
  notes: z.string().max(500).optional(),
});

const makePaymentSchema = z.object({
  paymentNumber: z.number().int().positive().optional(),
  amount: z.number().positive().optional(),
  paymentSource: z.enum([
    "WALLET",
    "MPESA",
    "MTN_MOMO",
    "CARD",
    "BANK_TRANSFER",
  ]),
  paymentDetails: z.record(z.any()).optional(),
});

const updateAutoDeductSchema = z.object({
  enabled: z.boolean(),
  percentage: z.number().min(5).max(50).optional(),
  day: z.number().min(1).max(28).optional(),
  minEarningsThreshold: z.number().min(0).optional(),
});

// ===========================================
// MARKETPLACE ROUTES
// ===========================================

/**
 * GET /vehicles - List marketplace vehicles
 */
vehicleFinancingRoutes.get(
  "/vehicles",
  zValidator("query", listVehiclesSchema),
  async (c) => {
    const filters = c.req.valid("query");

    try {
      const result = await vehicleFinancingService.getListings({
        ...filters,
        vehicleType: filters.vehicleType as VehicleType | undefined,
      });

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      vehicleFinancingLogger.error(
        { err: error },
        "Failed to get vehicle listings",
      );

      return c.json(
        {
          success: false,
          error: {
            code: "LISTING_ERROR",
            message: "Failed to get vehicle listings",
          },
        },
        500,
      );
    }
  },
);

/**
 * GET /vehicles/recommended - Get recommended vehicles for user
 */
vehicleFinancingRoutes.get("/vehicles/recommended", async (c) => {
  const userId = c.get("userId");
  const limit = Number.parseInt(c.req.query("limit") || "10");

  try {
    const listings = await vehicleFinancingService.getRecommendedListings(
      userId,
      limit,
    );

    return c.json({
      success: true,
      data: { listings },
    });
  } catch (error) {
    vehicleFinancingLogger.error(
      { err: error, userId },
      "Failed to get recommended vehicles",
    );

    return c.json(
      {
        success: false,
        error: {
          code: "RECOMMENDATION_ERROR",
          message: "Failed to get recommendations",
        },
      },
      500,
    );
  }
});

/**
 * GET /vehicles/:id - Get vehicle details
 */
vehicleFinancingRoutes.get("/vehicles/:id", async (c) => {
  const vehicleId = c.req.param("id");

  try {
    const listing = await vehicleFinancingService.getListingById(vehicleId);

    if (!listing) {
      return c.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Vehicle not found" },
        },
        404,
      );
    }

    return c.json({
      success: true,
      data: listing,
    });
  } catch (error) {
    vehicleFinancingLogger.error(
      { err: error, vehicleId },
      "Failed to get vehicle details",
    );

    return c.json(
      {
        success: false,
        error: {
          code: "VEHICLE_ERROR",
          message: "Failed to get vehicle details",
        },
      },
      500,
    );
  }
});

// ===========================================
// ELIGIBILITY & APPLICATION ROUTES
// ===========================================

/**
 * POST /vehicles/:id/eligibility - Check financing eligibility
 */
vehicleFinancingRoutes.post(
  "/vehicles/:id/eligibility",
  zValidator("json", eligibilityCheckSchema),
  async (c) => {
    const userId = c.get("userId");
    const vehicleId = c.req.param("id");
    const { requestedAmount, requestedTermMonths } = c.req.valid("json");

    try {
      const result = await vehicleFinancingService.checkEligibility({
        userId,
        vehicleListingId: vehicleId,
        requestedAmount,
        requestedTermMonths,
      });

      vehicleFinancingLogger.info(
        {
          userId,
          vehicleId,
          eligible: result.eligible,
          creditScore: result.creditScore,
        },
        "Eligibility check completed",
      );

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      vehicleFinancingLogger.error(
        { err: error, userId, vehicleId },
        "Eligibility check failed",
      );

      const message =
        error instanceof Error ? error.message : "Eligibility check failed";
      return c.json(
        {
          success: false,
          error: { code: "ELIGIBILITY_ERROR", message },
        },
        400,
      );
    }
  },
);

/**
 * POST /vehicles/:id/apply - Submit financing application
 */
vehicleFinancingRoutes.post(
  "/vehicles/:id/apply",
  zValidator("json", applyFinancingSchema),
  async (c) => {
    const userId = c.get("userId");
    const vehicleId = c.req.param("id");
    const body = c.req.valid("json");

    try {
      const application = await vehicleFinancingService.submitApplication(
        userId,
        {
          vehicleListingId: vehicleId,
          ...body,
          currency: body.currency as Currency,
          documents: body.documents?.map((d) => ({
            ...d,
            uploadedAt: new Date(d.uploadedAt),
          })),
        },
      );

      vehicleFinancingLogger.info(
        {
          userId,
          vehicleId,
          applicationId: application.id,
          status: application.status,
        },
        "Financing application submitted",
      );

      return c.json({
        success: true,
        data: application,
      });
    } catch (error) {
      vehicleFinancingLogger.error(
        { err: error, userId, vehicleId },
        "Application submission failed",
      );

      const message =
        error instanceof Error
          ? error.message
          : "Application submission failed";
      return c.json(
        {
          success: false,
          error: { code: "APPLICATION_ERROR", message },
        },
        400,
      );
    }
  },
);

/**
 * GET /applications - List user's financing applications
 */
vehicleFinancingRoutes.get("/applications", async (c) => {
  const userId = c.get("userId");
  const status = c.req.query("status");
  const limit = Number.parseInt(c.req.query("limit") || "20");
  const offset = Number.parseInt(c.req.query("offset") || "0");

  try {
    const { prisma } = await import("../lib/prisma");

    const where: any = { applicantUserId: userId };
    if (status) {
      where.status = status;
    }

    const [applications, total] = await Promise.all([
      prisma.vehicleFinancingApplication.findMany({
        where,
        include: { vehicleListing: true },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.vehicleFinancingApplication.count({ where }),
    ]);

    return c.json({
      success: true,
      data: {
        applications,
        pagination: { total, limit, offset, hasMore: offset + limit < total },
      },
    });
  } catch (error) {
    vehicleFinancingLogger.error(
      { err: error, userId },
      "Failed to get applications",
    );

    return c.json(
      {
        success: false,
        error: { code: "FETCH_ERROR", message: "Failed to get applications" },
      },
      500,
    );
  }
});

/**
 * GET /applications/:id - Get application details
 */
vehicleFinancingRoutes.get("/applications/:id", async (c) => {
  const userId = c.get("userId");
  const applicationId = c.req.param("id");

  try {
    const { prisma } = await import("../lib/prisma");

    const application = await prisma.vehicleFinancingApplication.findUnique({
      where: { id: applicationId },
      include: { vehicleListing: true },
    });

    if (!application) {
      return c.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Application not found" },
        },
        404,
      );
    }

    if (application.applicantUserId !== userId) {
      return c.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Not authorized to view this application",
          },
        },
        403,
      );
    }

    return c.json({
      success: true,
      data: application,
    });
  } catch (error) {
    vehicleFinancingLogger.error(
      { err: error, userId, applicationId },
      "Failed to get application",
    );

    return c.json(
      {
        success: false,
        error: { code: "FETCH_ERROR", message: "Failed to get application" },
      },
      500,
    );
  }
});

/**
 * POST /applications/:id/accept - Accept approved financing
 */
vehicleFinancingRoutes.post("/applications/:id/accept", async (c) => {
  const userId = c.get("userId");
  const applicationId = c.req.param("id");

  try {
    const financing = await vehicleFinancingService.acceptFinancing(
      applicationId,
      userId,
    );

    vehicleFinancingLogger.info(
      { userId, applicationId, financingId: financing.id },
      "Financing accepted",
    );

    return c.json({
      success: true,
      data: financing,
    });
  } catch (error) {
    vehicleFinancingLogger.error(
      { err: error, userId, applicationId },
      "Failed to accept financing",
    );

    const message =
      error instanceof Error ? error.message : "Failed to accept financing";
    return c.json(
      {
        success: false,
        error: { code: "ACCEPT_ERROR", message },
      },
      400,
    );
  }
});

/**
 * POST /applications/:id/cancel - Cancel application
 */
vehicleFinancingRoutes.post("/applications/:id/cancel", async (c) => {
  const userId = c.get("userId");
  const applicationId = c.req.param("id");

  try {
    const { prisma } = await import("../lib/prisma");

    const application = await prisma.vehicleFinancingApplication.findUnique({
      where: { id: applicationId },
    });

    if (!application) {
      return c.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Application not found" },
        },
        404,
      );
    }

    if (application.applicantUserId !== userId) {
      return c.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Not authorized" },
        },
        403,
      );
    }

    if (!["PENDING", "REVIEWING", "APPROVED"].includes(application.status)) {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_STATUS",
            message: "Cannot cancel this application",
          },
        },
        400,
      );
    }

    await prisma.vehicleFinancingApplication.update({
      where: { id: applicationId },
      data: { status: "CANCELLED" },
    });

    // Release vehicle if reserved
    await prisma.vehicleMarketplaceListing.update({
      where: { id: application.vehicleListingId },
      data: { status: "AVAILABLE" },
    });

    vehicleFinancingLogger.info(
      { userId, applicationId },
      "Application cancelled",
    );

    return c.json({
      success: true,
      message: "Application cancelled",
    });
  } catch (error) {
    vehicleFinancingLogger.error(
      { err: error, userId, applicationId },
      "Failed to cancel application",
    );

    return c.json(
      {
        success: false,
        error: {
          code: "CANCEL_ERROR",
          message: "Failed to cancel application",
        },
      },
      500,
    );
  }
});

// ===========================================
// FINANCING ROUTES
// ===========================================

/**
 * GET /financing - List user's active financings
 */
vehicleFinancingRoutes.get("/financing", async (c) => {
  const userId = c.get("userId");
  const status = c.req.query("status");

  try {
    const { prisma } = await import("../lib/prisma");

    const where: any = { driverUserId: userId };
    if (status) {
      where.status = status;
    }

    const financings = await prisma.vehicleFinancing.findMany({
      where,
      include: {
        application: {
          include: { vehicleListing: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return c.json({
      success: true,
      data: { financings },
    });
  } catch (error) {
    vehicleFinancingLogger.error(
      { err: error, userId },
      "Failed to get financings",
    );

    return c.json(
      {
        success: false,
        error: { code: "FETCH_ERROR", message: "Failed to get financings" },
      },
      500,
    );
  }
});

/**
 * GET /financing/dashboard - Get financing dashboard
 */
vehicleFinancingRoutes.get("/financing/dashboard", async (c) => {
  const userId = c.get("userId");

  try {
    const dashboard = await vehicleFinancingService.getDashboard(userId);

    return c.json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    vehicleFinancingLogger.error(
      { err: error, userId },
      "Failed to get financing dashboard",
    );

    return c.json(
      {
        success: false,
        error: { code: "DASHBOARD_ERROR", message: "Failed to get dashboard" },
      },
      500,
    );
  }
});

/**
 * GET /financing/summary - Get financing summary
 */
vehicleFinancingRoutes.get("/financing/summary", async (c) => {
  const userId = c.get("userId");

  try {
    const summary = await vehicleFinancingService.getFinancingSummary(userId);

    return c.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    vehicleFinancingLogger.error(
      { err: error, userId },
      "Failed to get financing summary",
    );

    return c.json(
      {
        success: false,
        error: { code: "SUMMARY_ERROR", message: "Failed to get summary" },
      },
      500,
    );
  }
});

/**
 * GET /financing/:id - Get financing details
 */
vehicleFinancingRoutes.get("/financing/:id", async (c) => {
  const userId = c.get("userId");
  const financingId = c.req.param("id");

  try {
    const { prisma } = await import("../lib/prisma");

    const financing = await prisma.vehicleFinancing.findUnique({
      where: { id: financingId },
      include: {
        application: {
          include: { vehicleListing: true },
        },
        payments: {
          orderBy: { paymentNumber: "asc" },
        },
      },
    });

    if (!financing) {
      return c.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Financing not found" },
        },
        404,
      );
    }

    if (financing.driverUserId !== userId) {
      return c.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Not authorized" },
        },
        403,
      );
    }

    return c.json({
      success: true,
      data: financing,
    });
  } catch (error) {
    vehicleFinancingLogger.error(
      { err: error, userId, financingId },
      "Failed to get financing details",
    );

    return c.json(
      {
        success: false,
        error: {
          code: "FETCH_ERROR",
          message: "Failed to get financing details",
        },
      },
      500,
    );
  }
});

/**
 * GET /financing/:id/schedule - Get payment schedule
 */
vehicleFinancingRoutes.get("/financing/:id/schedule", async (c) => {
  const userId = c.get("userId");
  const financingId = c.req.param("id");

  try {
    const { prisma } = await import("../lib/prisma");

    const financing = await prisma.vehicleFinancing.findUnique({
      where: { id: financingId },
      include: {
        payments: {
          orderBy: { paymentNumber: "asc" },
        },
      },
    });

    if (!financing) {
      return c.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Financing not found" },
        },
        404,
      );
    }

    if (financing.driverUserId !== userId) {
      return c.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Not authorized" },
        },
        403,
      );
    }

    return c.json({
      success: true,
      data: {
        financingId: financing.id,
        termMonths: financing.termMonths,
        monthlyPayment: Number(financing.monthlyPayment),
        paymentsCompleted: financing.paymentsCompleted,
        paymentsRemaining: financing.paymentsRemaining,
        schedule: financing.payments.map((p) => ({
          paymentNumber: p.paymentNumber,
          dueDate: p.dueDate,
          principalAmount: Number(p.principalAmount),
          interestAmount: Number(p.interestAmount),
          totalAmount: Number(p.totalAmount),
          amountPaid: Number(p.amountPaid),
          status: p.status,
          paidAt: p.paidAt,
          isOverdue:
            p.status === "OVERDUE" ||
            (p.dueDate < new Date() && p.status === "PENDING"),
        })),
      },
    });
  } catch (error) {
    vehicleFinancingLogger.error(
      { err: error, userId, financingId },
      "Failed to get payment schedule",
    );

    return c.json(
      {
        success: false,
        error: {
          code: "FETCH_ERROR",
          message: "Failed to get payment schedule",
        },
      },
      500,
    );
  }
});

/**
 * POST /financing/:id/pay - Make a financing payment
 */
vehicleFinancingRoutes.post(
  "/financing/:id/pay",
  zValidator("json", makePaymentSchema),
  async (c) => {
    const userId = c.get("userId");
    const financingId = c.req.param("id");
    const body = c.req.valid("json");

    try {
      const result = await vehicleFinancingService.makePayment(userId, {
        financingId,
        ...body,
      });

      vehicleFinancingLogger.info(
        {
          userId,
          financingId,
          paymentNumber: result.paymentNumber,
          amount: result.amountPaid,
        },
        "Payment processed",
      );

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      vehicleFinancingLogger.error(
        { err: error, userId, financingId },
        "Payment failed",
      );

      const message = error instanceof Error ? error.message : "Payment failed";
      return c.json(
        {
          success: false,
          error: { code: "PAYMENT_ERROR", message },
        },
        400,
      );
    }
  },
);

/**
 * PUT /financing/:id/auto-deduct - Update auto-deduction settings
 */
vehicleFinancingRoutes.put(
  "/financing/:id/auto-deduct",
  zValidator("json", updateAutoDeductSchema),
  async (c) => {
    const userId = c.get("userId");
    const financingId = c.req.param("id");
    const { enabled, percentage, day, minEarningsThreshold } =
      c.req.valid("json");

    try {
      const { prisma } = await import("../lib/prisma");

      const financing = await prisma.vehicleFinancing.findUnique({
        where: { id: financingId },
      });

      if (!financing) {
        return c.json(
          {
            success: false,
            error: { code: "NOT_FOUND", message: "Financing not found" },
          },
          404,
        );
      }

      if (financing.driverUserId !== userId) {
        return c.json(
          {
            success: false,
            error: { code: "UNAUTHORIZED", message: "Not authorized" },
          },
          403,
        );
      }

      const updated = await prisma.vehicleFinancing.update({
        where: { id: financingId },
        data: {
          autoDeductEnabled: enabled,
          autoDeductPercentage: percentage,
          autoDeductDay: day,
          minEarningsThreshold: minEarningsThreshold,
        },
      });

      vehicleFinancingLogger.info(
        { userId, financingId, enabled, percentage },
        "Auto-deduct settings updated",
      );

      return c.json({
        success: true,
        data: {
          autoDeductEnabled: updated.autoDeductEnabled,
          autoDeductPercentage: updated.autoDeductPercentage
            ? Number(updated.autoDeductPercentage)
            : undefined,
          autoDeductDay: updated.autoDeductDay,
          minEarningsThreshold: updated.minEarningsThreshold
            ? Number(updated.minEarningsThreshold)
            : undefined,
        },
      });
    } catch (error) {
      vehicleFinancingLogger.error(
        { err: error, userId, financingId },
        "Failed to update auto-deduct settings",
      );

      return c.json(
        {
          success: false,
          error: { code: "UPDATE_ERROR", message: "Failed to update settings" },
        },
        500,
      );
    }
  },
);

// ===========================================
// INTERNAL/WEBHOOK ROUTES
// ===========================================

/**
 * POST /webhooks/financing/auto-deduct - Process auto-deduction (from driver earnings)
 * Called by earnings service when driver receives earnings
 */
vehicleFinancingRoutes.post("/webhooks/financing/auto-deduct", async (c) => {
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
  const { earningsId, driverId, amount } = body;

  if (!earningsId || !driverId || !amount) {
    return c.json(
      {
        success: false,
        error: { code: "INVALID_REQUEST", message: "Missing required fields" },
      },
      400,
    );
  }

  try {
    const result = await vehicleFinancingService.processAutoDeduction(
      earningsId,
      driverId,
      amount,
    );

    if (!result) {
      return c.json({
        success: true,
        data: {
          deducted: false,
          message: "No active financing with auto-deduction enabled",
        },
      });
    }

    vehicleFinancingLogger.info(
      { earningsId, driverId, result },
      "Auto-deduction processed",
    );

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    vehicleFinancingLogger.error(
      { err: error, earningsId, driverId },
      "Auto-deduction failed",
    );

    return c.json(
      {
        success: false,
        error: { code: "DEDUCTION_ERROR", message: "Auto-deduction failed" },
      },
      500,
    );
  }
});

/**
 * POST /webhooks/financing/payment-due - Process payment due reminders (cron job)
 */
vehicleFinancingRoutes.post("/webhooks/financing/payment-due", async (c) => {
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

  try {
    const { prisma } = await import("../lib/prisma");
    const { notificationClient, NotificationType, NotificationPriority } =
      await import("../lib/notification-client");

    // Find payments due in next 3 days
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    const upcomingPayments = await prisma.vehicleFinancingPayment.findMany({
      where: {
        status: { in: ["PENDING", "PARTIAL"] },
        dueDate: { lte: threeDaysFromNow },
      },
      include: {
        financing: true,
      },
    });

    let reminders = 0;
    for (const payment of upcomingPayments) {
      const daysUntilDue = Math.ceil(
        (payment.dueDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
      );

      await notificationClient.send({
        userId: payment.financing.driverUserId,
        title: daysUntilDue <= 0 ? "Payment Overdue!" : "Payment Due Soon",
        body:
          daysUntilDue <= 0
            ? `Your vehicle financing payment of ${payment.currency} ${Number(payment.totalAmount).toFixed(0)} is overdue!`
            : `Your vehicle financing payment of ${payment.currency} ${Number(payment.totalAmount).toFixed(0)} is due in ${daysUntilDue} day(s).`,
        type: NotificationType.LOAN_DUE_REMINDER,
        priority:
          daysUntilDue <= 0
            ? NotificationPriority.URGENT
            : NotificationPriority.HIGH,
        data: {
          type: "financing_payment_reminder",
          financingId: payment.financingId,
          paymentNumber: payment.paymentNumber,
          amount: Number(payment.totalAmount),
          dueDate: payment.dueDate.toISOString(),
          isOverdue: daysUntilDue <= 0,
        },
      });

      // Mark as overdue if past due
      if (daysUntilDue <= 0 && payment.status !== "OVERDUE") {
        await prisma.vehicleFinancingPayment.update({
          where: { id: payment.id },
          data: { status: "OVERDUE" },
        });

        // Update financing late payment count
        await prisma.vehicleFinancing.update({
          where: { id: payment.financingId },
          data: { latePayments: { increment: 1 } },
        });
      }

      reminders++;
    }

    vehicleFinancingLogger.info(
      { remindersSent: reminders },
      "Payment reminders processed",
    );

    return c.json({
      success: true,
      data: { remindersSent: reminders },
    });
  } catch (error) {
    vehicleFinancingLogger.error(
      { err: error },
      "Failed to process payment reminders",
    );

    return c.json(
      {
        success: false,
        error: {
          code: "REMINDER_ERROR",
          message: "Failed to process reminders",
        },
      },
      500,
    );
  }
});

export default vehicleFinancingRoutes;
