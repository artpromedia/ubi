/**
 * Proxy Routes
 *
 * Routes requests to downstream microservices.
 * Handles service discovery, load balancing, and circuit breaking.
 */

import { Hono } from "hono";

const proxyRoutes = new Hono();

// Service registry - maps route prefixes to service URLs
const SERVICE_REGISTRY: Record<string, string> = {
  users: process.env.USER_SERVICE_URL || "http://localhost:4001",
  auth: process.env.USER_SERVICE_URL || "http://localhost:4001",
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
  10
);

/**
 * Generic proxy handler
 * Forwards requests to the appropriate downstream service
 */
const proxyToService = async (
  serviceName: string,
  originalPath: string,
  c: {
    req: {
      method: string;
      header: (name: string) => string | undefined;
      raw: Request;
    };
    json: (data: object, status?: number) => Response;
    header: (name: string, value: string) => void;
  }
) => {
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
      503
    );
  }

  // Build target URL
  const targetUrl = `${serviceUrl}${originalPath}`;

  // Forward headers (excluding hop-by-hop headers)
  const forwardHeaders = new Headers();
  const headersToForward = [
    "content-type",
    "accept",
    "accept-language",
    "x-request-id",
    "x-idempotency-key",
    "x-forwarded-for",
    "x-real-ip",
  ];

  for (const header of headersToForward) {
    const value = c.req.header(header);
    if (value) {
      forwardHeaders.set(header, value);
    }
  }

  // Add auth context if available
  const auth = (c as unknown as { get: (key: string) => unknown }).get?.(
    "auth"
  );
  if (auth) {
    forwardHeaders.set("x-auth-user-id", (auth as { userId: string }).userId);
    forwardHeaders.set("x-auth-user-role", (auth as { role: string }).role);
  }

  // Generate request ID if not present
  if (!forwardHeaders.has("x-request-id")) {
    forwardHeaders.set("x-request-id", crypto.randomUUID());
  }

  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    // Forward the request
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

    clearTimeout(timeoutId);

    // Forward response headers
    const responseHeaders = [
      "content-type",
      "x-request-id",
      "x-ratelimit-limit",
      "x-ratelimit-remaining",
      "x-ratelimit-reset",
    ];

    for (const header of responseHeaders) {
      const value = response.headers.get(header);
      if (value) {
        c.header(header, value);
      }
    }

    // Return the response
    const data = (await response.json()) as object;
    return c.json(data, response.status as 200);
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
        504
      );
    }

    console.error(`Proxy error to ${serviceName}:`, error);

    return c.json(
      {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: `Unable to reach ${serviceName} service`,
        },
      },
      503
    );
  }
};

// ===========================================
// Route Definitions
// ===========================================

// User Service routes
proxyRoutes.all("/auth/*", (c) =>
  proxyToService("auth", c.req.path.replace("/v1", ""), c)
);
proxyRoutes.all("/users/*", (c) =>
  proxyToService("users", c.req.path.replace("/v1", ""), c)
);

// Ride Service routes
proxyRoutes.all("/rides/*", (c) =>
  proxyToService("rides", c.req.path.replace("/v1", ""), c)
);
proxyRoutes.all("/drivers/*", (c) =>
  proxyToService("rides", c.req.path.replace("/v1", ""), c)
);
proxyRoutes.all("/pricing/*", (c) =>
  proxyToService("rides", c.req.path.replace("/v1", ""), c)
);
proxyRoutes.all("/locations/*", (c) =>
  proxyToService("rides", c.req.path.replace("/v1", ""), c)
);

// Food Service routes
proxyRoutes.all("/food/*", (c) =>
  proxyToService("food", c.req.path.replace("/v1", ""), c)
);
proxyRoutes.all("/restaurants/*", (c) =>
  proxyToService("restaurants", c.req.path.replace("/v1", ""), c)
);
proxyRoutes.all("/menus/*", (c) =>
  proxyToService("food", c.req.path.replace("/v1", ""), c)
);

// Delivery Service routes
proxyRoutes.all("/delivery/*", (c) =>
  proxyToService("delivery", c.req.path.replace("/v1", ""), c)
);
proxyRoutes.all("/packages/*", (c) =>
  proxyToService("packages", c.req.path.replace("/v1", ""), c)
);

// Payment Service routes
proxyRoutes.all("/payments/*", (c) =>
  proxyToService("payments", c.req.path.replace("/v1", ""), c)
);
proxyRoutes.all("/wallets/*", (c) =>
  proxyToService("wallets", c.req.path.replace("/v1", ""), c)
);
proxyRoutes.all("/transactions/*", (c) =>
  proxyToService("payments", c.req.path.replace("/v1", ""), c)
);

// Notification Service routes
proxyRoutes.all("/notifications/*", (c) =>
  proxyToService("notifications", c.req.path.replace("/v1", ""), c)
);

// Analytics Service routes
proxyRoutes.all("/analytics/*", (c) =>
  proxyToService("analytics", c.req.path.replace("/v1", ""), c)
);
proxyRoutes.all("/reports/*", (c) =>
  proxyToService("analytics", c.req.path.replace("/v1", ""), c)
);

// CEERION Service routes (EV financing)
proxyRoutes.all("/ceerion/*", (c) =>
  proxyToService("ceerion", c.req.path.replace("/v1", ""), c)
);
proxyRoutes.all("/vehicles/*", (c) =>
  proxyToService("vehicles", c.req.path.replace("/v1", ""), c)
);
proxyRoutes.all("/financing/*", (c) =>
  proxyToService("ceerion", c.req.path.replace("/v1", ""), c)
);

export { proxyRoutes };
