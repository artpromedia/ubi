/**
 * UBI B2B API Routes (Hono)
 *
 * Routes for all B2B platform services:
 * - Corporate Accounts
 * - Delivery API
 * - Healthcare Transport
 * - School Transport
 * - Billing
 * - Webhooks & API Keys
 */

import { Hono } from "hono";

import { apiInfrastructureService } from "../services/api-infrastructure.service";
import { billingService } from "../services/billing.service";
import { corporateAccountsService } from "../services/corporate-accounts.service";
import { deliveryApiService } from "../services/delivery-api.service";
import { healthcareTransportService } from "../services/healthcare-transport.service";
import { schoolTransportService } from "../services/school-transport.service";

import type { ApiKeyScope } from "../types/b2b.types";

// =============================================================================
// TYPES
// =============================================================================

type Variables = {
  apiKey: any;
  organizationId: string;
};

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * API Key Authentication Middleware
 */
const authenticateApiKey = (requiredScope?: ApiKeyScope) => {
  return async (c: any, next: () => Promise<void>) => {
    const authHeader = c.req.header("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json(
        {
          error: "unauthorized",
          message: "API key required. Use Authorization: Bearer <api_key>",
        },
        401,
      );
    }

    const apiKey = authHeader.substring(7);
    const clientIp = c.req.header("x-forwarded-for") || "unknown";

    try {
      const result = await apiInfrastructureService.validateApiKey(
        apiKey,
        clientIp,
        requiredScope,
      );

      if (!result.valid || !result.apiKey) {
        return c.json(
          {
            error: "unauthorized",
            message: result.error || "Invalid API key",
          },
          401,
        );
      }

      // Check rate limits
      const rateLimitResult = await apiInfrastructureService.checkRateLimit(
        result.apiKey.id,
      );

      if (!rateLimitResult.allowed) {
        return c.json(
          {
            error: "rate_limit_exceeded",
            message: "Too many requests",
            retryAfter: rateLimitResult.retryAfter,
            limits: rateLimitResult.remaining,
          },
          429,
        );
      }

      // Increment rate limit counter
      await apiInfrastructureService.incrementRateLimit(result.apiKey.id);

      // Set context variables
      c.set("apiKey", result.apiKey);
      c.set("organizationId", result.apiKey.organizationId);

      await next();
    } catch (error) {
      return c.json(
        {
          error: "internal_error",
          message: "Authentication failed",
        },
        500,
      );
    }
  };
};

/**
 * Request logging middleware
 */
const logApiRequest = async (c: any, next: () => Promise<void>) => {
  const startTime = Date.now();
  await next();

  const apiKey = c.get("apiKey");
  if (apiKey) {
    await apiInfrastructureService.logRequest({
      organizationId: apiKey.organizationId,
      apiKeyId: apiKey.id,
      method: c.req.method,
      path: c.req.path,
      statusCode: c.res.status,
      latencyMs: Date.now() - startTime,
      clientIp: c.req.header("x-forwarded-for") || "unknown",
      userAgent: c.req.header("user-agent"),
    });
  }
};

// =============================================================================
// CREATE B2B ROUTES
// =============================================================================

export const b2bRoutes = new Hono<{ Variables: Variables }>();

// Apply logging middleware globally
b2bRoutes.use("*", logApiRequest);

// =============================================================================
// CORPORATE ACCOUNTS ROUTES
// =============================================================================

// Organizations
b2bRoutes.get(
  "/corporate/organization",
  authenticateApiKey("organizations:read"),
  async (c) => {
    const orgId = c.get("organizationId");
    const org = await corporateAccountsService.getOrganization(orgId);
    return c.json({ data: org });
  },
);

b2bRoutes.patch(
  "/corporate/organization",
  authenticateApiKey("organizations:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const body = await c.req.json();
    const org = await corporateAccountsService.updateOrganization(orgId, body);
    return c.json({ data: org });
  },
);

// Members
b2bRoutes.get(
  "/corporate/members",
  authenticateApiKey("organizations:read"),
  async (c) => {
    const orgId = c.get("organizationId");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const members = await corporateAccountsService.listMembers(
      orgId,
      {},
      {
        page,
        limit,
      },
    );
    return c.json(members);
  },
);

b2bRoutes.post(
  "/corporate/members",
  authenticateApiKey("organizations:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const body = await c.req.json();
    const member = await corporateAccountsService.inviteMember(
      orgId,
      body,
      "api",
    );
    return c.json({ data: member }, 201);
  },
);

b2bRoutes.patch(
  "/corporate/members/:memberId",
  authenticateApiKey("organizations:write"),
  async (c) => {
    const memberId = c.req.param("memberId");
    const body = await c.req.json();
    const member = await corporateAccountsService.updateMember(memberId, body);
    return c.json({ data: member });
  },
);

b2bRoutes.delete(
  "/corporate/members/:memberId",
  authenticateApiKey("organizations:write"),
  async (c) => {
    const memberId = c.req.param("memberId");
    await corporateAccountsService.removeMember(memberId);
    return c.body(null, 204);
  },
);

// Cost Centers
b2bRoutes.get(
  "/corporate/cost-centers",
  authenticateApiKey("organizations:read"),
  async (c) => {
    const orgId = c.get("organizationId");
    const costCenters = await corporateAccountsService.listCostCenters(orgId);
    return c.json({ data: costCenters });
  },
);

b2bRoutes.post(
  "/corporate/cost-centers",
  authenticateApiKey("organizations:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const body = await c.req.json();
    const costCenter = await corporateAccountsService.createCostCenter(
      orgId,
      body,
    );
    return c.json({ data: costCenter }, 201);
  },
);

// =============================================================================
// DELIVERY API ROUTES
// =============================================================================

// Quotes
b2bRoutes.post(
  "/delivery/quotes",
  authenticateApiKey("deliveries:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const body = await c.req.json();
    const quote = await deliveryApiService.getQuote(orgId, body);
    return c.json({ data: quote }, 201);
  },
);

// Deliveries
b2bRoutes.post(
  "/delivery/deliveries",
  authenticateApiKey("deliveries:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const body = await c.req.json();
    const delivery = await deliveryApiService.createDelivery(orgId, body);

    // Record usage
    await billingService.recordUsage(orgId, {
      type: "delivery",
      quantity: 1,
      referenceId: delivery.id,
      referenceType: "delivery",
      description: `Delivery ${delivery.trackingCode}`,
    });

    return c.json({ data: delivery }, 201);
  },
);

b2bRoutes.post(
  "/delivery/deliveries/batch",
  authenticateApiKey("deliveries:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const body = await c.req.json();
    const batch = await deliveryApiService.createBatchDeliveries(orgId, body);

    // Record usage for batch
    await billingService.recordUsage(orgId, {
      type: "delivery",
      quantity: batch.total,
      referenceId: `batch_${Date.now()}`,
      referenceType: "batch_delivery",
      description: `Batch delivery (${batch.total} deliveries)`,
    });

    return c.json({ data: batch }, 201);
  },
);

b2bRoutes.get(
  "/delivery/deliveries",
  authenticateApiKey("deliveries:read"),
  async (c) => {
    const orgId = c.get("organizationId");
    const status = c.req.query("status");
    const dateFrom = c.req.query("dateFrom");
    const dateTo = c.req.query("dateTo");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");

    const deliveries = await deliveryApiService.listDeliveries(
      orgId,
      {
        status: status as any,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
      },
      { page, limit },
    );
    return c.json(deliveries);
  },
);

b2bRoutes.get(
  "/delivery/deliveries/:deliveryId",
  authenticateApiKey("deliveries:read"),
  async (c) => {
    const deliveryId = c.req.param("deliveryId");
    const delivery = await deliveryApiService.getDelivery(deliveryId);
    if (!delivery) {
      return c.json({ error: "not_found", message: "Delivery not found" }, 404);
    }
    return c.json({ data: delivery });
  },
);

b2bRoutes.get(
  "/delivery/deliveries/track/:trackingNumber",
  authenticateApiKey("deliveries:read"),
  async (c) => {
    const trackingNumber = c.req.param("trackingNumber");
    const tracking = await deliveryApiService.getTrackingInfo(trackingNumber);
    if (!tracking) {
      return c.json({ error: "not_found", message: "Tracking not found" }, 404);
    }
    return c.json({ data: tracking });
  },
);

b2bRoutes.post(
  "/delivery/deliveries/:deliveryId/cancel",
  authenticateApiKey("deliveries:write"),
  async (c) => {
    const deliveryId = c.req.param("deliveryId");
    const body = await c.req.json();
    const delivery = await deliveryApiService.cancelDelivery(
      deliveryId,
      body.reason,
    );
    return c.json({ data: delivery });
  },
);

b2bRoutes.get(
  "/delivery/stats",
  authenticateApiKey("deliveries:read"),
  async (c) => {
    const orgId = c.get("organizationId");
    const dateFrom = c.req.query("dateFrom");
    const dateTo = c.req.query("dateTo");
    const stats = await deliveryApiService.getDeliveryStats(
      orgId,
      new Date(dateFrom!),
      new Date(dateTo!),
    );
    return c.json({ data: stats });
  },
);

// =============================================================================
// HEALTHCARE TRANSPORT ROUTES
// =============================================================================

// Providers
b2bRoutes.post(
  "/healthcare/providers",
  authenticateApiKey("healthcare:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const body = await c.req.json();
    const provider = await healthcareTransportService.registerProvider(
      orgId,
      body.providerType,
      body.details || {},
    );
    return c.json({ data: provider }, 201);
  },
);

b2bRoutes.get(
  "/healthcare/providers",
  authenticateApiKey("healthcare:read"),
  async (c) => {
    const orgId = c.get("organizationId");
    const provider =
      await healthcareTransportService.getProviderByOrganization(orgId);
    return c.json({ data: provider });
  },
);

// Medical Deliveries
b2bRoutes.post(
  "/healthcare/deliveries",
  authenticateApiKey("healthcare:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const body = await c.req.json();
    const delivery = await healthcareTransportService.createMedicalDelivery(
      body.providerId,
      body,
    );

    // Record usage
    await billingService.recordUsage(orgId, {
      type: "medical_transport",
      quantity: 1,
      referenceId: delivery.id,
      referenceType: "medical_delivery",
      description: `Medical delivery: ${delivery.deliveryType}`,
    });

    return c.json({ data: delivery }, 201);
  },
);

b2bRoutes.get(
  "/healthcare/deliveries",
  authenticateApiKey("healthcare:read"),
  async (c) => {
    const providerId = c.req.query("providerId");
    const status = c.req.query("status");
    const deliveryType = c.req.query("deliveryType");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");

    const deliveries = await healthcareTransportService.listMedicalDeliveries(
      providerId as string,
      { status: status as any, deliveryType: deliveryType as any },
      { page, limit },
    );
    return c.json(deliveries);
  },
);

// Patient Transport
b2bRoutes.post(
  "/healthcare/patient-transport",
  authenticateApiKey("healthcare:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const body = await c.req.json();
    const transport = await healthcareTransportService.createPatientTransport(
      body.providerId,
      body,
    );

    // Record usage
    await billingService.recordUsage(orgId, {
      type: "medical_transport",
      quantity: 1,
      referenceId: transport.id,
      referenceType: "patient_transport",
      description: `Patient transport: ${transport.appointmentTime}`,
    });

    return c.json({ data: transport }, 201);
  },
);

b2bRoutes.get(
  "/healthcare/patient-transport",
  authenticateApiKey("healthcare:read"),
  async (c) => {
    const providerId = c.req.query("providerId");
    const status = c.req.query("status");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");

    const transports = await healthcareTransportService.listPatientTransports(
      providerId as string,
      { status: status as any },
      { page, limit },
    );
    return c.json(transports);
  },
);

// =============================================================================
// SCHOOL TRANSPORT ROUTES
// =============================================================================

// Schools
b2bRoutes.post(
  "/school/schools",
  authenticateApiKey("school:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const body = await c.req.json();
    const school = await schoolTransportService.registerSchool(orgId, body);
    return c.json({ data: school }, 201);
  },
);

b2bRoutes.get(
  "/school/schools/:schoolId",
  authenticateApiKey("school:read"),
  async (c) => {
    const schoolId = c.req.param("schoolId");
    const school = await schoolTransportService.getSchool(schoolId);
    if (!school) {
      return c.json({ error: "not_found", message: "School not found" }, 404);
    }
    return c.json({ data: school });
  },
);

// Students
b2bRoutes.post(
  "/school/schools/:schoolId/students",
  authenticateApiKey("school:write"),
  async (c) => {
    const schoolId = c.req.param("schoolId");
    const body = await c.req.json();
    const student = await schoolTransportService.registerStudent(
      schoolId,
      body,
    );
    return c.json({ data: student }, 201);
  },
);

b2bRoutes.get(
  "/school/schools/:schoolId/students",
  authenticateApiKey("school:read"),
  async (c) => {
    const schoolId = c.req.param("schoolId");
    const grade = c.req.query("grade");
    const className = c.req.query("className");
    const routeId = c.req.query("routeId");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");

    const students = await schoolTransportService.listStudents(
      schoolId,
      { grade, className, routeId },
      { page, limit },
    );
    return c.json(students);
  },
);

// Routes
b2bRoutes.post(
  "/school/schools/:schoolId/routes",
  authenticateApiKey("school:write"),
  async (c) => {
    const schoolId = c.req.param("schoolId");
    const body = await c.req.json();
    const route = await schoolTransportService.createRoute(schoolId, body);
    return c.json({ data: route }, 201);
  },
);

b2bRoutes.get(
  "/school/schools/:schoolId/routes",
  authenticateApiKey("school:read"),
  async (c) => {
    const schoolId = c.req.param("schoolId");
    const type = c.req.query("type");
    const routes = await schoolTransportService.listRoutes(
      schoolId,
      type as any,
    );
    return c.json({ data: routes });
  },
);

// Active Routes
b2bRoutes.post(
  "/school/routes/:routeId/start",
  authenticateApiKey("school:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const routeId = c.req.param("routeId");
    const body = await c.req.json();
    const activeRoute = await schoolTransportService.startRoute(
      routeId,
      body.driverId,
      body.driverName,
      body.driverPhone,
      body.vehiclePlate,
    );

    // Record usage
    const route = await schoolTransportService.getRoute(routeId);
    if (route) {
      await billingService.recordUsage(orgId, {
        type: "school_transport",
        quantity: route.studentCount,
        referenceId: activeRoute.id,
        referenceType: "school_route",
        description: `School route: ${route.name}`,
      });
    }

    return c.json({ data: activeRoute }, 201);
  },
);

b2bRoutes.post(
  "/school/active-routes/:activeRouteId/pickup",
  authenticateApiKey("school:write"),
  async (c) => {
    const activeRouteId = c.req.param("activeRouteId");
    const body = await c.req.json();
    const log = await schoolTransportService.recordStudentPickup(
      activeRouteId,
      body.studentId,
      body.verificationMethod,
      body.photoUrl,
    );
    return c.json({ data: log }, 201);
  },
);

b2bRoutes.post(
  "/school/active-routes/:activeRouteId/dropoff",
  authenticateApiKey("school:write"),
  async (c) => {
    const activeRouteId = c.req.param("activeRouteId");
    const body = await c.req.json();
    const log = await schoolTransportService.recordStudentDropoff(
      activeRouteId,
      body.studentId,
      body.verificationMethod,
      body.photoUrl,
    );
    return c.json({ data: log }, 201);
  },
);

b2bRoutes.post(
  "/school/active-routes/:activeRouteId/complete",
  authenticateApiKey("school:write"),
  async (c) => {
    const activeRouteId = c.req.param("activeRouteId");
    const activeRoute =
      await schoolTransportService.completeRoute(activeRouteId);
    return c.json({ data: activeRoute });
  },
);

// Parent Features
b2bRoutes.get(
  "/school/students/:studentId/location",
  authenticateApiKey("school:read"),
  async (c) => {
    const studentId = c.req.param("studentId");
    const location = await schoolTransportService.getStudentLocation(studentId);
    return c.json({ data: location });
  },
);

b2bRoutes.get(
  "/school/students/:studentId/trips",
  authenticateApiKey("school:read"),
  async (c) => {
    const studentId = c.req.param("studentId");
    const dateFrom = c.req.query("dateFrom");
    const dateTo = c.req.query("dateTo");
    const trips = await schoolTransportService.getStudentTripHistory(
      studentId,
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined,
    );
    return c.json({ data: trips });
  },
);

// =============================================================================
// BILLING ROUTES
// =============================================================================

// Subscription
b2bRoutes.get(
  "/billing/subscription",
  authenticateApiKey("billing:read"),
  async (c) => {
    const orgId = c.get("organizationId");
    const subscription = await billingService.getSubscription(orgId);
    return c.json({ data: subscription });
  },
);

b2bRoutes.post(
  "/billing/subscription",
  authenticateApiKey("billing:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const body = await c.req.json();
    const subscription = await billingService.createSubscription(
      orgId,
      body.planId,
    );
    return c.json({ data: subscription }, 201);
  },
);

b2bRoutes.post(
  "/billing/subscription/cancel",
  authenticateApiKey("billing:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const body = await c.req.json();
    const subscription = await billingService.getSubscription(orgId);
    if (!subscription) {
      return c.json(
        { error: "not_found", message: "No active subscription" },
        404,
      );
    }
    const cancelled = await billingService.cancelSubscription(
      subscription.id,
      body.cancelImmediately,
    );
    return c.json({ data: cancelled });
  },
);

// Usage
b2bRoutes.get(
  "/billing/usage",
  authenticateApiKey("billing:read"),
  async (c) => {
    const orgId = c.get("organizationId");
    const periodStart = c.req.query("periodStart");
    const periodEnd = c.req.query("periodEnd");
    const summary = await billingService.getUsageSummary(
      orgId,
      new Date(periodStart!),
      new Date(periodEnd!),
    );
    return c.json({ data: summary });
  },
);

// Invoices
b2bRoutes.get(
  "/billing/invoices",
  authenticateApiKey("billing:read"),
  async (c) => {
    const orgId = c.get("organizationId");
    const status = c.req.query("status");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const invoices = await billingService.listInvoices(orgId, status as any, {
      page,
      limit,
    });
    return c.json(invoices);
  },
);

b2bRoutes.get(
  "/billing/invoices/:invoiceId",
  authenticateApiKey("billing:read"),
  async (c) => {
    const invoiceId = c.req.param("invoiceId");
    const invoice = await billingService.getInvoice(invoiceId);
    if (!invoice) {
      return c.json({ error: "not_found", message: "Invoice not found" }, 404);
    }
    return c.json({ data: invoice });
  },
);

// Credits
b2bRoutes.get(
  "/billing/credits",
  authenticateApiKey("billing:read"),
  async (c) => {
    const orgId = c.get("organizationId");
    const balance = await billingService.getCreditBalance(orgId);
    return c.json({ data: balance });
  },
);

b2bRoutes.get(
  "/billing/credits/transactions",
  authenticateApiKey("billing:read"),
  async (c) => {
    const orgId = c.get("organizationId");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const transactions = await billingService.getCreditTransactions(orgId, {
      page,
      limit,
    });
    return c.json(transactions);
  },
);

// Payment Methods
b2bRoutes.get(
  "/billing/payment-methods",
  authenticateApiKey("billing:read"),
  async (c) => {
    const orgId = c.get("organizationId");
    const methods = await billingService.listPaymentMethods(orgId);
    return c.json({ data: methods });
  },
);

b2bRoutes.post(
  "/billing/payment-methods",
  authenticateApiKey("billing:write"),
  async (c) => {
    const orgId = c.get("organizationId");
    const body = await c.req.json();
    const method = await billingService.addPaymentMethod(orgId, body);
    return c.json({ data: method }, 201);
  },
);

// =============================================================================
// WEBHOOK ROUTES
// =============================================================================

b2bRoutes.get("/webhooks", authenticateApiKey("webhooks:read"), async (c) => {
  const orgId = c.get("organizationId");
  const webhooks = await apiInfrastructureService.listWebhooks(orgId);
  return c.json({ data: webhooks });
});

b2bRoutes.post("/webhooks", authenticateApiKey("webhooks:write"), async (c) => {
  const orgId = c.get("organizationId");
  const body = await c.req.json();
  const webhook = await apiInfrastructureService.registerWebhook(orgId, body);
  return c.json({ data: webhook }, 201);
});

b2bRoutes.patch(
  "/webhooks/:webhookId",
  authenticateApiKey("webhooks:write"),
  async (c) => {
    const webhookId = c.req.param("webhookId");
    const body = await c.req.json();
    const webhook = await apiInfrastructureService.updateWebhook(
      webhookId,
      body,
    );
    return c.json({ data: webhook });
  },
);

b2bRoutes.delete(
  "/webhooks/:webhookId",
  authenticateApiKey("webhooks:write"),
  async (c) => {
    const webhookId = c.req.param("webhookId");
    await apiInfrastructureService.deleteWebhook(webhookId);
    return c.body(null, 204);
  },
);

b2bRoutes.post(
  "/webhooks/:webhookId/test",
  authenticateApiKey("webhooks:write"),
  async (c) => {
    const webhookId = c.req.param("webhookId");
    const delivery = await apiInfrastructureService.testWebhook(webhookId);
    return c.json({ data: delivery });
  },
);

b2bRoutes.get(
  "/webhooks/:webhookId/deliveries",
  authenticateApiKey("webhooks:read"),
  async (c) => {
    const webhookId = c.req.param("webhookId");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const deliveries = await apiInfrastructureService.getWebhookDeliveries(
      webhookId,
      { page, limit },
    );
    return c.json(deliveries);
  },
);

// =============================================================================
// API KEY ROUTES
// =============================================================================

b2bRoutes.get("/api-keys", authenticateApiKey("api_keys:read"), async (c) => {
  const orgId = c.get("organizationId");
  const environment = c.req.query("environment");
  const keys = await apiInfrastructureService.listApiKeys(
    orgId,
    environment as any,
  );
  return c.json({ data: keys });
});

b2bRoutes.post("/api-keys", authenticateApiKey("api_keys:write"), async (c) => {
  const orgId = c.get("organizationId");
  const body = await c.req.json();
  const result = await apiInfrastructureService.generateApiKey(orgId, body);
  return c.json(
    {
      data: result.apiKey,
      secret: result.secret, // Only shown once
    },
    201,
  );
});

b2bRoutes.patch(
  "/api-keys/:keyId",
  authenticateApiKey("api_keys:write"),
  async (c) => {
    const keyId = c.req.param("keyId");
    const body = await c.req.json();
    const key = await apiInfrastructureService.updateApiKey(keyId, body);
    return c.json({ data: key });
  },
);

b2bRoutes.post(
  "/api-keys/:keyId/rotate",
  authenticateApiKey("api_keys:write"),
  async (c) => {
    const keyId = c.req.param("keyId");
    const result = await apiInfrastructureService.rotateApiKey(keyId);
    return c.json({
      data: result.apiKey,
      secret: result.secret, // Only shown once
    });
  },
);

b2bRoutes.delete(
  "/api-keys/:keyId",
  authenticateApiKey("api_keys:write"),
  async (c) => {
    const keyId = c.req.param("keyId");
    await apiInfrastructureService.revokeApiKey(keyId);
    return c.body(null, 204);
  },
);

export default b2bRoutes;
