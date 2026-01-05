/**
 * UBI B2B API Routes
 *
 * Express routes for all B2B platform services:
 * - Corporate Accounts
 * - Delivery API
 * - Healthcare Transport
 * - School Transport
 * - Billing
 * - Webhooks
 */

import { NextFunction, Request, Response, Router } from "express";
import { apiInfrastructureService } from "../services/api-infrastructure.service";
import { billingService } from "../services/billing.service";
import { corporateAccountsService } from "../services/corporate-accounts.service";
import { deliveryApiService } from "../services/delivery-api.service";
import { healthcareTransportService } from "../services/healthcare-transport.service";
import { schoolTransportService } from "../services/school-transport.service";
import type { ApiKeyScope } from "../types/b2b.types";

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * API Key Authentication Middleware
 */
export const authenticateApiKey = (requiredScope?: ApiKeyScope) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "unauthorized",
        message: "API key required. Use Authorization: Bearer <api_key>",
      });
    }

    const apiKey = authHeader.substring(7);
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";

    try {
      const result = await apiInfrastructureService.validateApiKey(
        apiKey,
        clientIp,
        requiredScope
      );

      if (!result.valid || !result.apiKey) {
        return res.status(401).json({
          error: "unauthorized",
          message: result.error || "Invalid API key",
        });
      }

      // Check rate limits
      const rateLimitResult = await apiInfrastructureService.checkRateLimit(
        result.apiKey.id
      );

      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          error: "rate_limit_exceeded",
          message: "Too many requests",
          retryAfter: rateLimitResult.retryAfter,
          limits: rateLimitResult.remaining,
        });
      }

      // Increment rate limit counter
      await apiInfrastructureService.incrementRateLimit(result.apiKey.id);

      // Attach to request
      (req as any).apiKey = result.apiKey;
      (req as any).organizationId = result.apiKey.organizationId;

      next();
    } catch (error) {
      return res.status(500).json({
        error: "internal_error",
        message: "Authentication failed",
      });
    }
  };
};

/**
 * Request logging middleware
 */
export const logApiRequest = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const startTime = Date.now();

  res.on("finish", async () => {
    const apiKey = (req as any).apiKey;
    if (apiKey) {
      await apiInfrastructureService.logRequest({
        organizationId: apiKey.organizationId,
        apiKeyId: apiKey.id,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        latencyMs: Date.now() - startTime,
        clientIp: req.ip || "unknown",
        userAgent: req.headers["user-agent"],
      });
    }
  });

  next();
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

const getOrgId = (req: Request): string => (req as any).organizationId;

// =============================================================================
// CORPORATE ACCOUNTS ROUTES
// =============================================================================

export const corporateRoutes = Router();

// Organizations
corporateRoutes.get(
  "/organization",
  authenticateApiKey("organizations:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const org = await corporateAccountsService.getOrganization(getOrgId(req));
    res.json({ data: org });
  })
);

corporateRoutes.patch(
  "/organization",
  authenticateApiKey("organizations:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const org = await corporateAccountsService.updateOrganization(
      getOrgId(req),
      req.body
    );
    res.json({ data: org });
  })
);

// Members
corporateRoutes.get(
  "/members",
  authenticateApiKey("organizations:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const members = await corporateAccountsService.listMembers(getOrgId(req), {
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 20,
    });
    res.json(members);
  })
);

corporateRoutes.post(
  "/members",
  authenticateApiKey("organizations:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const member = await corporateAccountsService.addMember(
      getOrgId(req),
      req.body
    );
    res.status(201).json({ data: member });
  })
);

corporateRoutes.patch(
  "/members/:memberId",
  authenticateApiKey("organizations:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const member = await corporateAccountsService.updateMember(
      req.params.memberId,
      req.body
    );
    res.json({ data: member });
  })
);

corporateRoutes.delete(
  "/members/:memberId",
  authenticateApiKey("organizations:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    await corporateAccountsService.removeMember(req.params.memberId);
    res.status(204).send();
  })
);

// Cost Centers
corporateRoutes.get(
  "/cost-centers",
  authenticateApiKey("organizations:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const costCenters = await corporateAccountsService.listCostCenters(
      getOrgId(req)
    );
    res.json({ data: costCenters });
  })
);

corporateRoutes.post(
  "/cost-centers",
  authenticateApiKey("organizations:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const costCenter = await corporateAccountsService.createCostCenter(
      getOrgId(req),
      req.body
    );
    res.status(201).json({ data: costCenter });
  })
);

// =============================================================================
// DELIVERY API ROUTES
// =============================================================================

export const deliveryRoutes = Router();

// Quotes
deliveryRoutes.post(
  "/quotes",
  authenticateApiKey("deliveries:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const quote = await deliveryApiService.createQuote(getOrgId(req), req.body);
    res.status(201).json({ data: quote });
  })
);

// Deliveries
deliveryRoutes.post(
  "/deliveries",
  authenticateApiKey("deliveries:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const delivery = await deliveryApiService.createDelivery(
      getOrgId(req),
      req.body
    );

    // Record usage
    await billingService.recordUsage(getOrgId(req), {
      type: "delivery",
      quantity: 1,
      referenceId: delivery.id,
      referenceType: "delivery",
      description: `Delivery ${delivery.trackingNumber}`,
    });

    res.status(201).json({ data: delivery });
  })
);

deliveryRoutes.post(
  "/deliveries/batch",
  authenticateApiKey("deliveries:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const batch = await deliveryApiService.createBatchDelivery(
      getOrgId(req),
      req.body
    );

    // Record usage for batch
    await billingService.recordUsage(getOrgId(req), {
      type: "delivery",
      quantity: batch.totalDeliveries,
      referenceId: batch.id,
      referenceType: "batch_delivery",
      description: `Batch delivery (${batch.totalDeliveries} deliveries)`,
    });

    res.status(201).json({ data: batch });
  })
);

deliveryRoutes.get(
  "/deliveries",
  authenticateApiKey("deliveries:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const deliveries = await deliveryApiService.listDeliveries(
      getOrgId(req),
      {
        status: req.query.status as any,
        dateFrom: req.query.dateFrom
          ? new Date(req.query.dateFrom as string)
          : undefined,
        dateTo: req.query.dateTo
          ? new Date(req.query.dateTo as string)
          : undefined,
      },
      {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      }
    );
    res.json(deliveries);
  })
);

deliveryRoutes.get(
  "/deliveries/:deliveryId",
  authenticateApiKey("deliveries:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const delivery = await deliveryApiService.getDelivery(
      req.params.deliveryId
    );
    if (!delivery) {
      return res
        .status(404)
        .json({ error: "not_found", message: "Delivery not found" });
    }
    res.json({ data: delivery });
  })
);

deliveryRoutes.get(
  "/deliveries/track/:trackingNumber",
  authenticateApiKey("deliveries:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const tracking = await deliveryApiService.trackDelivery(
      req.params.trackingNumber
    );
    if (!tracking) {
      return res
        .status(404)
        .json({ error: "not_found", message: "Tracking not found" });
    }
    res.json({ data: tracking });
  })
);

deliveryRoutes.post(
  "/deliveries/:deliveryId/cancel",
  authenticateApiKey("deliveries:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const delivery = await deliveryApiService.cancelDelivery(
      req.params.deliveryId,
      req.body.reason
    );
    res.json({ data: delivery });
  })
);

deliveryRoutes.get(
  "/deliveries/stats",
  authenticateApiKey("deliveries:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const stats = await deliveryApiService.getDeliveryStats(
      getOrgId(req),
      new Date(req.query.dateFrom as string),
      new Date(req.query.dateTo as string)
    );
    res.json({ data: stats });
  })
);

// =============================================================================
// HEALTHCARE TRANSPORT ROUTES
// =============================================================================

export const healthcareRoutes = Router();

// Providers
healthcareRoutes.post(
  "/providers",
  authenticateApiKey("healthcare:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const provider = await healthcareTransportService.registerProvider(
      getOrgId(req),
      req.body
    );
    res.status(201).json({ data: provider });
  })
);

healthcareRoutes.get(
  "/providers",
  authenticateApiKey("healthcare:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const providers = await healthcareTransportService.listProviders(
      getOrgId(req),
      {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      }
    );
    res.json(providers);
  })
);

// Medical Deliveries
healthcareRoutes.post(
  "/deliveries",
  authenticateApiKey("healthcare:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const delivery = await healthcareTransportService.createMedicalDelivery(
      req.body.providerId,
      req.body
    );

    // Record usage
    await billingService.recordUsage(getOrgId(req), {
      type: "medical_transport",
      quantity: 1,
      referenceId: delivery.id,
      referenceType: "medical_delivery",
      description: `Medical delivery: ${delivery.deliveryType}`,
    });

    res.status(201).json({ data: delivery });
  })
);

healthcareRoutes.get(
  "/deliveries",
  authenticateApiKey("healthcare:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const deliveries = await healthcareTransportService.listMedicalDeliveries(
      req.query.providerId as string,
      {
        status: req.query.status as any,
        deliveryType: req.query.deliveryType as any,
      },
      {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      }
    );
    res.json(deliveries);
  })
);

// Patient Transport
healthcareRoutes.post(
  "/patient-transport",
  authenticateApiKey("healthcare:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const transport = await healthcareTransportService.createPatientTransport(
      req.body.providerId,
      req.body
    );

    // Record usage
    await billingService.recordUsage(getOrgId(req), {
      type: "medical_transport",
      quantity: 1,
      referenceId: transport.id,
      referenceType: "patient_transport",
      description: `Patient transport: ${transport.appointmentType}`,
    });

    res.status(201).json({ data: transport });
  })
);

healthcareRoutes.get(
  "/patient-transport",
  authenticateApiKey("healthcare:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const transports = await healthcareTransportService.listPatientTransports(
      req.query.providerId as string,
      {
        status: req.query.status as any,
      },
      {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      }
    );
    res.json(transports);
  })
);

// =============================================================================
// SCHOOL TRANSPORT ROUTES
// =============================================================================

export const schoolRoutes = Router();

// Schools
schoolRoutes.post(
  "/schools",
  authenticateApiKey("school:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const school = await schoolTransportService.registerSchool(
      getOrgId(req),
      req.body
    );
    res.status(201).json({ data: school });
  })
);

schoolRoutes.get(
  "/schools/:schoolId",
  authenticateApiKey("school:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const school = await schoolTransportService.getSchool(req.params.schoolId);
    if (!school) {
      return res
        .status(404)
        .json({ error: "not_found", message: "School not found" });
    }
    res.json({ data: school });
  })
);

// Students
schoolRoutes.post(
  "/schools/:schoolId/students",
  authenticateApiKey("school:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const student = await schoolTransportService.registerStudent(
      req.params.schoolId,
      req.body
    );
    res.status(201).json({ data: student });
  })
);

schoolRoutes.get(
  "/schools/:schoolId/students",
  authenticateApiKey("school:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const students = await schoolTransportService.listStudents(
      req.params.schoolId,
      {
        grade: req.query.grade as string,
        className: req.query.className as string,
        routeId: req.query.routeId as string,
      },
      {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      }
    );
    res.json(students);
  })
);

// Routes
schoolRoutes.post(
  "/schools/:schoolId/routes",
  authenticateApiKey("school:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const route = await schoolTransportService.createRoute(
      req.params.schoolId,
      req.body
    );
    res.status(201).json({ data: route });
  })
);

schoolRoutes.get(
  "/schools/:schoolId/routes",
  authenticateApiKey("school:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const routes = await schoolTransportService.listRoutes(
      req.params.schoolId,
      req.query.type as any
    );
    res.json({ data: routes });
  })
);

// Active Routes
schoolRoutes.post(
  "/routes/:routeId/start",
  authenticateApiKey("school:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const activeRoute = await schoolTransportService.startRoute(
      req.params.routeId,
      req.body.driverId,
      req.body.driverName,
      req.body.driverPhone,
      req.body.vehiclePlate
    );

    // Record usage
    const route = await schoolTransportService.getRoute(req.params.routeId);
    if (route) {
      await billingService.recordUsage(getOrgId(req), {
        type: "school_transport",
        quantity: route.studentCount,
        referenceId: activeRoute.id,
        referenceType: "school_route",
        description: `School route: ${route.name}`,
      });
    }

    res.status(201).json({ data: activeRoute });
  })
);

schoolRoutes.post(
  "/active-routes/:activeRouteId/pickup",
  authenticateApiKey("school:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const log = await schoolTransportService.recordStudentPickup(
      req.params.activeRouteId,
      req.body.studentId,
      req.body.verificationMethod,
      req.body.photoUrl
    );
    res.status(201).json({ data: log });
  })
);

schoolRoutes.post(
  "/active-routes/:activeRouteId/dropoff",
  authenticateApiKey("school:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const log = await schoolTransportService.recordStudentDropoff(
      req.params.activeRouteId,
      req.body.studentId,
      req.body.verificationMethod,
      req.body.photoUrl
    );
    res.status(201).json({ data: log });
  })
);

schoolRoutes.post(
  "/active-routes/:activeRouteId/complete",
  authenticateApiKey("school:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const activeRoute = await schoolTransportService.completeRoute(
      req.params.activeRouteId
    );
    res.json({ data: activeRoute });
  })
);

// Parent Features
schoolRoutes.get(
  "/students/:studentId/location",
  authenticateApiKey("school:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const location = await schoolTransportService.getStudentLocation(
      req.params.studentId
    );
    res.json({ data: location });
  })
);

schoolRoutes.get(
  "/students/:studentId/trips",
  authenticateApiKey("school:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const trips = await schoolTransportService.getStudentTripHistory(
      req.params.studentId,
      req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
      req.query.dateTo ? new Date(req.query.dateTo as string) : undefined
    );
    res.json({ data: trips });
  })
);

// =============================================================================
// BILLING ROUTES
// =============================================================================

export const billingRoutes = Router();

// Subscription
billingRoutes.get(
  "/subscription",
  authenticateApiKey("billing:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const subscription = await billingService.getSubscription(getOrgId(req));
    res.json({ data: subscription });
  })
);

billingRoutes.post(
  "/subscription",
  authenticateApiKey("billing:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const subscription = await billingService.createSubscription(
      getOrgId(req),
      req.body.planId
    );
    res.status(201).json({ data: subscription });
  })
);

billingRoutes.post(
  "/subscription/cancel",
  authenticateApiKey("billing:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const subscription = await billingService.getSubscription(getOrgId(req));
    if (!subscription) {
      return res
        .status(404)
        .json({ error: "not_found", message: "No active subscription" });
    }
    const cancelled = await billingService.cancelSubscription(
      subscription.id,
      req.body.cancelImmediately
    );
    res.json({ data: cancelled });
  })
);

// Usage
billingRoutes.get(
  "/usage",
  authenticateApiKey("billing:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const summary = await billingService.getUsageSummary(
      getOrgId(req),
      new Date(req.query.periodStart as string),
      new Date(req.query.periodEnd as string)
    );
    res.json({ data: summary });
  })
);

// Invoices
billingRoutes.get(
  "/invoices",
  authenticateApiKey("billing:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const invoices = await billingService.listInvoices(
      getOrgId(req),
      req.query.status as any,
      {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      }
    );
    res.json(invoices);
  })
);

billingRoutes.get(
  "/invoices/:invoiceId",
  authenticateApiKey("billing:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const invoice = await billingService.getInvoice(req.params.invoiceId);
    if (!invoice) {
      return res
        .status(404)
        .json({ error: "not_found", message: "Invoice not found" });
    }
    res.json({ data: invoice });
  })
);

// Credits
billingRoutes.get(
  "/credits",
  authenticateApiKey("billing:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const balance = await billingService.getCreditBalance(getOrgId(req));
    res.json({ data: balance });
  })
);

billingRoutes.get(
  "/credits/transactions",
  authenticateApiKey("billing:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const transactions = await billingService.getCreditTransactions(
      getOrgId(req),
      {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      }
    );
    res.json(transactions);
  })
);

// Payment Methods
billingRoutes.get(
  "/payment-methods",
  authenticateApiKey("billing:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const methods = await billingService.listPaymentMethods(getOrgId(req));
    res.json({ data: methods });
  })
);

billingRoutes.post(
  "/payment-methods",
  authenticateApiKey("billing:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const method = await billingService.addPaymentMethod(
      getOrgId(req),
      req.body
    );
    res.status(201).json({ data: method });
  })
);

// =============================================================================
// WEBHOOK ROUTES
// =============================================================================

export const webhookRoutes = Router();

webhookRoutes.get(
  "/",
  authenticateApiKey("webhooks:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const webhooks = await apiInfrastructureService.listWebhooks(getOrgId(req));
    res.json({ data: webhooks });
  })
);

webhookRoutes.post(
  "/",
  authenticateApiKey("webhooks:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const webhook = await apiInfrastructureService.registerWebhook(
      getOrgId(req),
      req.body
    );
    res.status(201).json({ data: webhook });
  })
);

webhookRoutes.patch(
  "/:webhookId",
  authenticateApiKey("webhooks:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const webhook = await apiInfrastructureService.updateWebhook(
      req.params.webhookId,
      req.body
    );
    res.json({ data: webhook });
  })
);

webhookRoutes.delete(
  "/:webhookId",
  authenticateApiKey("webhooks:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    await apiInfrastructureService.deleteWebhook(req.params.webhookId);
    res.status(204).send();
  })
);

webhookRoutes.post(
  "/:webhookId/test",
  authenticateApiKey("webhooks:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const delivery = await apiInfrastructureService.testWebhook(
      req.params.webhookId
    );
    res.json({ data: delivery });
  })
);

webhookRoutes.get(
  "/:webhookId/deliveries",
  authenticateApiKey("webhooks:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const deliveries = await apiInfrastructureService.getWebhookDeliveries(
      req.params.webhookId,
      {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      }
    );
    res.json(deliveries);
  })
);

// =============================================================================
// API KEY ROUTES (Admin)
// =============================================================================

export const apiKeyRoutes = Router();

apiKeyRoutes.get(
  "/",
  authenticateApiKey("api_keys:read"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const keys = await apiInfrastructureService.listApiKeys(
      getOrgId(req),
      req.query.environment as any
    );
    res.json({ data: keys });
  })
);

apiKeyRoutes.post(
  "/",
  authenticateApiKey("api_keys:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const result = await apiInfrastructureService.generateApiKey(
      getOrgId(req),
      req.body
    );
    res.status(201).json({
      data: result.apiKey,
      secret: result.secret, // Only shown once
    });
  })
);

apiKeyRoutes.patch(
  "/:keyId",
  authenticateApiKey("api_keys:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const key = await apiInfrastructureService.updateApiKey(
      req.params.keyId,
      req.body
    );
    res.json({ data: key });
  })
);

apiKeyRoutes.post(
  "/:keyId/rotate",
  authenticateApiKey("api_keys:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    const result = await apiInfrastructureService.rotateApiKey(
      req.params.keyId
    );
    res.json({
      data: result.apiKey,
      secret: result.secret, // Only shown once
    });
  })
);

apiKeyRoutes.delete(
  "/:keyId",
  authenticateApiKey("api_keys:write"),
  logApiRequest,
  asyncHandler(async (req, res) => {
    await apiInfrastructureService.revokeApiKey(req.params.keyId);
    res.status(204).send();
  })
);

// =============================================================================
// MAIN B2B ROUTER
// =============================================================================

export const b2bRouter = Router();

// Mount all sub-routers
b2bRouter.use("/corporate", corporateRoutes);
b2bRouter.use("/delivery", deliveryRoutes);
b2bRouter.use("/healthcare", healthcareRoutes);
b2bRouter.use("/school", schoolRoutes);
b2bRouter.use("/billing", billingRoutes);
b2bRouter.use("/webhooks", webhookRoutes);
b2bRouter.use("/api-keys", apiKeyRoutes);

// Error handler
b2bRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("B2B API Error:", err);

  res.status(500).json({
    error: "internal_error",
    message: err.message || "An unexpected error occurred",
  });
});

export default b2bRouter;
