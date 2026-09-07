/**
 * Proxy Routes
 *
 * Routes requests to downstream microservices.
 *
 * Identity is NOT reconstructed here. By the time a request reaches this file
 * the identity middleware has already deleted every client-supplied identity
 * header and installed the gateway's own, including the signed
 * `X-UBI-Identity` context. This file only decides which of them cross the
 * wire, and it copies them from the request object rather than rebuilding them,
 * so there is exactly one place that can mint an identity.
 *
 * See middleware/identity.ts for the canonical header contract.
 */
import type { Context } from "hono";
import { Hono } from "hono";

import { proxyLogger } from "../lib/logger.js";
import { IDENTITY_HEADER, REQUEST_ID_HEADER } from "../middleware/identity";

const proxyRoutes = new Hono();

// Service registry - maps route prefixes to service URLs
const SERVICE_REGISTRY: Record<string, string> = {
  users: process.env.USER_SERVICE_URL || "http://localhost:4001",
  auth: process.env.USER_SERVICE_URL || "http://localhost:4001",
  identity: process.env.USER_SERVICE_URL || "http://localhost:4001",
  devices: process.env.USER_SERVICE_URL || "http://localhost:4001",
  rides: process.env.RIDE_SERVICE_URL || "http://localhost:4002",
  food: process.env.FOOD_SERVICE_URL || "http://localhost:4003",
  restaurants: process.env.FOOD_SERVICE_URL || "http://localhost:4003",
  delivery: process.env.DELIVERY_SERVICE_URL || "http://localhost:4004",
  packages: process.env.DELIVERY_SERVICE_URL || "http://localhost:4004",
  payments: process.env.PAYMENT_SERVICE_URL || "http://localhost:4005",
  wallets: process.env.PAYMENT_SERVICE_URL || "http://localhost:4005",
  notifications:
    process.env.NOTIFICATION_SERVICE_URL || "http://localhost:4006",
  analytics: process.env.ANALYTICS_SERVICE_URL || "http://localhost:4007",
  ceerion: process.env.CEERION_SERVICE_URL || "http://localhost:4008",
  vehicles: process.env.CEERION_SERVICE_URL || "http://localhost:4008",
};

// Request timeout in milliseconds
const REQUEST_TIMEOUT = Number.parseInt(
  process.env.PROXY_TIMEOUT || "30000",
  10,
);

/**
 * Headers copied from the (already sanitized) inbound request.
 *
 * The identity entries are safe to copy precisely because the strip middleware
 * removed the client's versions and the identity middleware wrote the
 * gateway's. `x-internal-service` is deliberately absent: it is a bypass in
 * user-service and the gateway never speaks it.
 */
const HEADERS_TO_FORWARD: readonly string[] = [
  "content-type",
  "accept",
  "accept-language",
  "x-forwarded-for",
  "x-real-ip",
  "x-idempotency-key",
  "idempotency-key",
  REQUEST_ID_HEADER,
  IDENTITY_HEADER,
  "x-auth-user-id",
  "x-auth-user-role",
  "x-user-id",
  "x-user-role",
  "x-session-id",
  "x-ubi-city-id",
  "x-ubi-tenant-id",
  "x-ubi-scopes",
  "x-ubi-modes",
];

const RESPONSE_HEADERS_TO_FORWARD: readonly string[] = [
  "content-type",
  REQUEST_ID_HEADER,
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
];

/**
 * Generic proxy handler
 * Forwards requests to the appropriate downstream service
 */
const proxyToService = async (
  serviceName: string,
  originalPath: string,
  c: Context,
): Promise<Response> => {
  const serviceUrl = SERVICE_REGISTRY[serviceName];

  if (!serviceUrl) {
    return c.json(
      {
        success: false,
        error: {
          code: "SERVICE_NOT_FOUND",
          message: `Service '${serviceName}' is not configured`,
        },
      },
      503,
    );
  }

  const url = new URL(c.req.url);
  const targetUrl = `${serviceUrl}${originalPath}${url.search}`;

  const forwardHeaders = new Headers();
  for (const header of HEADERS_TO_FORWARD) {
    const value = c.req.header(header);
    if (value !== undefined && value.length > 0) {
      forwardHeaders.set(header, value);
    }
  }

  if (!forwardHeaders.has(REQUEST_ID_HEADER)) {
    forwardHeaders.set(REQUEST_ID_HEADER, crypto.randomUUID());
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers: forwardHeaders,
      body:
        c.req.method !== "GET" && c.req.method !== "HEAD"
          ? c.req.raw.body
          : undefined,
      signal: controller.signal,
      duplex: "half",
    } as RequestInit);

    for (const header of RESPONSE_HEADERS_TO_FORWARD) {
      const value = response.headers.get(header);
      if (value !== null) {
        c.header(header, value);
      }
    }

    // Downstream services answer in JSON, but a 204 or an error page must not
    // become a gateway 500 — pass the body through as it came.
    const body = await response.text();
    if (body.length === 0) {
      return c.body(null, response.status as 204);
    }
    return c.body(body, response.status as 200);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return c.json(
        {
          success: false,
          error: {
            code: "GATEWAY_TIMEOUT",
            message: "The request took too long to process",
          },
        },
        504,
      );
    }

    proxyLogger.error({ err: error, serviceName }, "Proxy error");

    return c.json(
      {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: `Unable to reach ${serviceName} service`,
        },
      },
      503,
    );
  } finally {
    clearTimeout(timeoutId);
  }
};

/** The gateway mounts /v1; downstream services do not carry the version prefix. */
const downstreamPath = (c: Context): string => c.req.path.replace(/^\/v1/, "");

// ===========================================
// Route Definitions
// ===========================================

// User Service routes
proxyRoutes.all("/auth/*", (c) => proxyToService("auth", downstreamPath(c), c));
proxyRoutes.all("/users/*", (c) => proxyToService("users", downstreamPath(c), c));

// Identity (slice 03) — device enrolment, step-up, documents, review cases.
// These are registered BEFORE /drivers/* so driver documents reach the
// user-service rather than the ride-service.
proxyRoutes.all("/devices", (c) => proxyToService("devices", downstreamPath(c), c));
proxyRoutes.all("/devices/*", (c) => proxyToService("devices", downstreamPath(c), c));
proxyRoutes.all("/identity/*", (c) => proxyToService("identity", downstreamPath(c), c));
proxyRoutes.all("/drivers/me/documents", (c) =>
  proxyToService("identity", downstreamPath(c), c),
);
proxyRoutes.all("/drivers/me/documents/*", (c) =>
  proxyToService("identity", downstreamPath(c), c),
);
proxyRoutes.all("/drivers/me/eligibility", (c) =>
  proxyToService("identity", downstreamPath(c), c),
);

// Ride Service routes
proxyRoutes.all("/rides/*", (c) => proxyToService("rides", downstreamPath(c), c));
proxyRoutes.all("/drivers/*", (c) => proxyToService("rides", downstreamPath(c), c));
proxyRoutes.all("/pricing/*", (c) => proxyToService("rides", downstreamPath(c), c));
proxyRoutes.all("/locations/*", (c) => proxyToService("rides", downstreamPath(c), c));

// Food Service routes
proxyRoutes.all("/food/*", (c) => proxyToService("food", downstreamPath(c), c));
proxyRoutes.all("/restaurants/*", (c) =>
  proxyToService("restaurants", downstreamPath(c), c),
);
proxyRoutes.all("/menus/*", (c) => proxyToService("food", downstreamPath(c), c));

// Delivery Service routes
proxyRoutes.all("/delivery/*", (c) => proxyToService("delivery", downstreamPath(c), c));
proxyRoutes.all("/packages/*", (c) => proxyToService("packages", downstreamPath(c), c));

// Payment Service routes
proxyRoutes.all("/payments/*", (c) => proxyToService("payments", downstreamPath(c), c));
proxyRoutes.all("/wallets/*", (c) => proxyToService("wallets", downstreamPath(c), c));
proxyRoutes.all("/wallet/*", (c) => proxyToService("wallets", downstreamPath(c), c));
proxyRoutes.all("/transactions/*", (c) =>
  proxyToService("payments", downstreamPath(c), c),
);

// Notification Service routes
proxyRoutes.all("/notifications/*", (c) =>
  proxyToService("notifications", downstreamPath(c), c),
);

// Analytics Service routes
proxyRoutes.all("/analytics/*", (c) => proxyToService("analytics", downstreamPath(c), c));
proxyRoutes.all("/reports/*", (c) => proxyToService("analytics", downstreamPath(c), c));

// CEERION Service routes (EV financing)
proxyRoutes.all("/ceerion/*", (c) => proxyToService("ceerion", downstreamPath(c), c));
proxyRoutes.all("/vehicles/*", (c) => proxyToService("vehicles", downstreamPath(c), c));
proxyRoutes.all("/financing/*", (c) => proxyToService("ceerion", downstreamPath(c), c));

export { proxyRoutes };
