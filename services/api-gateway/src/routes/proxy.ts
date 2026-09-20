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
import { Hono, type Context } from "hono";

import { proxyLogger } from "../lib/logger.js";
import { IDENTITY_HEADER, REQUEST_ID_HEADER } from "../middleware/identity";

const proxyRoutes = new Hono();

/**
 * Service registry — maps a logical service to the env var that carries its
 * URL and the local default. Resolved per request rather than at import, so a
 * redeploy that changes a service URL does not need the gateway rebuilt.
 */
const SERVICE_REGISTRY: Record<
  string,
  { readonly env: string; readonly fallback: string }
> = {
  users: { env: "USER_SERVICE_URL", fallback: "http://localhost:4001" },
  auth: { env: "USER_SERVICE_URL", fallback: "http://localhost:4001" },
  identity: { env: "USER_SERVICE_URL", fallback: "http://localhost:4001" },
  devices: { env: "USER_SERVICE_URL", fallback: "http://localhost:4001" },
  rides: { env: "RIDE_SERVICE_URL", fallback: "http://localhost:4002" },
  food: { env: "FOOD_SERVICE_URL", fallback: "http://localhost:4003" },
  restaurants: { env: "FOOD_SERVICE_URL", fallback: "http://localhost:4003" },
  delivery: { env: "DELIVERY_SERVICE_URL", fallback: "http://localhost:4004" },
  packages: { env: "DELIVERY_SERVICE_URL", fallback: "http://localhost:4004" },
  payments: { env: "PAYMENT_SERVICE_URL", fallback: "http://localhost:4005" },
  wallets: { env: "PAYMENT_SERVICE_URL", fallback: "http://localhost:4005" },
  notifications: {
    env: "NOTIFICATION_SERVICE_URL",
    fallback: "http://localhost:4006",
  },
  analytics: {
    env: "ANALYTICS_SERVICE_URL",
    fallback: "http://localhost:4007",
  },
  ceerion: { env: "CEERION_SERVICE_URL", fallback: "http://localhost:4008" },
  vehicles: { env: "CEERION_SERVICE_URL", fallback: "http://localhost:4008" },
};

function serviceUrl(serviceName: string): string | undefined {
  const entry = SERVICE_REGISTRY[serviceName];
  if (entry === undefined) {
    return undefined;
  }
  const configured = process.env[entry.env];
  return configured !== undefined && configured.length > 0
    ? configured
    : entry.fallback;
}

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
  // Signed by the telco over the raw body; user-service verifies it.
  "x-telco-signature",
  REQUEST_ID_HEADER,
  IDENTITY_HEADER,
  "x-auth-user-id",
  "x-auth-user-role",
  "x-user-id",
  "x-user-role",
  "x-session-id",
  // Client-declared active city context. Not an identity claim (the reserved
  // x-ubi-city-id below carries the token's city), so the strip middleware
  // leaves it alone; payment-service reads it for the marketplace wallet
  // overview (GET /v1/wallet/mp/overview) city scoping.
  "x-city-id",
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
  const baseUrl = serviceUrl(serviceName);

  if (baseUrl === undefined) {
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
  const targetUrl = `${baseUrl}${originalPath}${url.search}`;

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

/** Builds a route callback: an async handler that awaits the proxy hop. */
const forward =
  (serviceName: string) =>
  async (c: Context): Promise<Response> => {
    const response = await proxyToService(serviceName, downstreamPath(c), c);
    return response;
  };

// ===========================================
// Route Definitions
// ===========================================

// User Service routes
proxyRoutes.all("/auth/*", forward("auth"));
proxyRoutes.all("/users/*", forward("users"));

// Identity (slice 03) — device enrolment, step-up, documents, review cases.
// These are registered BEFORE /drivers/* so driver documents reach the
// user-service rather than the ride-service.
proxyRoutes.all("/devices", forward("devices"));
proxyRoutes.all("/devices/*", forward("devices"));
proxyRoutes.all("/identity/*", forward("identity"));
proxyRoutes.all("/webhooks/telco/*", forward("identity"));
proxyRoutes.all("/drivers/me/documents", forward("identity"));
proxyRoutes.all("/drivers/me/documents/*", forward("identity"));
proxyRoutes.all("/drivers/me/eligibility", forward("identity"));

// Ride Service routes
proxyRoutes.all("/rides/*", forward("rides"));
proxyRoutes.all("/drivers/*", forward("rides"));
proxyRoutes.all("/pricing/*", forward("rides"));
proxyRoutes.all("/locations/*", forward("rides"));

// Marketplace (negotiated-fare) routes — the marketplace engine lives in the
// ride-service, so /mp/* rides on the existing rides registry entry. The
// wallet-side marketplace endpoints (/wallet/mp/*) are served by
// payment-service and already flow through the /wallet/* mount below.
proxyRoutes.all("/mp/*", forward("rides"));
proxyRoutes.all("/admin/mp/*", forward("rides"));

// Food Service routes
proxyRoutes.all("/food/*", forward("food"));
proxyRoutes.all("/restaurants/*", forward("restaurants"));
proxyRoutes.all("/menus/*", forward("food"));

// Delivery Service routes
proxyRoutes.all("/delivery/*", forward("delivery"));
proxyRoutes.all("/packages/*", forward("packages"));

// Payment Service routes
proxyRoutes.all("/payments/*", forward("payments"));
proxyRoutes.all("/wallets/*", forward("wallets"));
proxyRoutes.all("/wallet/*", forward("wallets"));
proxyRoutes.all("/transactions/*", forward("payments"));

// Notification Service routes
proxyRoutes.all("/notifications/*", forward("notifications"));

// Analytics Service routes
proxyRoutes.all("/analytics/*", forward("analytics"));
proxyRoutes.all("/reports/*", forward("analytics"));

// CEERION Service routes (EV financing)
proxyRoutes.all("/ceerion/*", forward("ceerion"));
proxyRoutes.all("/vehicles/*", forward("vehicles"));
proxyRoutes.all("/financing/*", forward("ceerion"));

export { proxyRoutes };
