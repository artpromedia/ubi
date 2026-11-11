/**
 * The UBI API Gateway application.
 *
 * Separated from index.ts so the app can be exercised by tests with
 * `app.fetch(request)` without binding a port.
 *
 * MIDDLEWARE ORDER IS SECURITY-CRITICAL:
 *
 *   1. stripInboundIdentityHeaders  deletes every client-supplied identity
 *                                   header. Runs before ANYTHING reads a
 *                                   header, so no later stage can observe a
 *                                   forged value.
 *   2. authMiddleware               validates the bearer token / API key.
 *   3. rateLimitMiddleware          counts the request against the caller
 *                                   step 2 verified, or — on a public route —
 *                                   against its client address, resolved from
 *                                   the socket and GATEWAY_TRUSTED_PROXIES
 *                                   (middleware/client-address.ts). It runs
 *                                   AFTER auth so no header a client writes
 *                                   picks the bucket.
 *   4. identityContextMiddleware    mints and signs the internal identity
 *                                   context and installs it on the request.
 *   5. scopeEnforcementMiddleware   applies the limited-mode / safe-mode
 *                                   matrix, deny-by-default.
 *   6. configReadRoutes             the read-only config family
 *                                   (routes/config-read.ts): GET, exact
 *                                   paths, to config-service.
 *      configAdminRoutes            the admin config & flag family
 *                                   (routes/config-admin.ts): exact method +
 *                                   path, gated by config:admin, to
 *                                   config-service.
 *      proxyRoutes                  forwards to the downstream service.
 *
 * ONE family sits outside steps 2-6: the passenger trip link
 * (routes/trip-access.ts — GET /v1/mp/trip-access, GET /v1/mp/trip-access/pin,
 * POST /v1/mp/trip-access/decline, matched exactly). A guest passenger is not
 * a UBI user and has no bearer token; ride-service authenticates those calls
 * by the trip access token alone. They still pass step 1, carry their own
 * per-client rate limit, and forward only the token — never an identity.
 */
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { etag } from "hono/etag";
import { logger as honoLogger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";

import { authMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import {
  identityContextMiddleware,
  scopeEnforcementMiddleware,
  stripInboundIdentityHeaders,
} from "./middleware/identity";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { configAdminRoutes } from "./routes/config-admin";
import { configReadRoutes } from "./routes/config-read";
import { healthRoutes } from "./routes/health";
import { opsWalletCreditRoutes } from "./routes/ops-wallet-credits";
import { proxyRoutes } from "./routes/proxy";
import { pushDeviceRoutes } from "./routes/push-devices";
import { tripAccessRoutes } from "./routes/trip-access";

const DEFAULT_CORS_ORIGINS = [
  "https://app.ubi.africa",
  "https://admin.ubi.africa",
  "https://fleet.ubi.africa",
  "https://ubi.africa",
] as const;

const DEV_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3004",
] as const;

export function parseCorsOrigins(
  rawCorsOrigins: string | undefined = process.env.CORS_ORIGINS,
  nodeEnv: string = process.env.NODE_ENV || "development",
): string[] {
  const configured = rawCorsOrigins
    ? rawCorsOrigins
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [...DEFAULT_CORS_ORIGINS];

  const validated: string[] = [];
  for (const entry of configured) {
    if (entry.includes("*")) {
      throw new Error(
        `Invalid CORS_ORIGINS entry "${entry}": wildcards are not permitted`,
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      throw new Error(
        `Invalid CORS_ORIGINS entry "${entry}": must be a valid http(s) origin`,
      );
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.origin !== entry ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      throw new Error(
        `Invalid CORS_ORIGINS entry "${entry}": must be an exact http(s)://host[:port] origin`,
      );
    }
    validated.push(parsed.origin);
  }

  const base = validated.length > 0 ? validated : [...DEFAULT_CORS_ORIGINS];
  const combined =
    nodeEnv === "development" ? [...base, ...DEV_CORS_ORIGINS] : base;
  return [...new Set(combined)];
}

export function createApp(
  nodeEnv: string = process.env.NODE_ENV || "development",
  rawCorsOrigins: string | undefined = process.env.CORS_ORIGINS,
): Hono {
  const app = new Hono();
  const allowedOrigins = parseCorsOrigins(rawCorsOrigins, nodeEnv);

  // ===========================================
  // Global Middleware
  // ===========================================

  // Identity hygiene first: a forged header must never be observable.
  app.use("*", stripInboundIdentityHeaders);

  // Security headers
  app.use("*", secureHeaders());

  // Compression for responses
  app.use("*", compress());

  // ETags for caching
  app.use("*", etag());

  // Request timing headers
  app.use("*", timing());

  // Request logging
  app.use("*", honoLogger());

  // CORS configuration
  app.use(
    "*",
    cors({
      origin: allowedOrigins,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "X-Request-ID",
        "X-Idempotency-Key",
        // The idempotency header every money/state POST carries (travel
        // carts and checkout among them), and the client's DECLARED city.
        // Neither is an identity claim: the token's city travels only in the
        // reserved x-ubi-city-id / x-auth-city-id headers the gateway writes,
        // and travel-service refuses a declared city that disagrees with it
        // (an unbound operator's X-City-ID names the city a console action is
        // for).
        "Idempotency-Key",
        "X-City-ID",
        // A guest passenger's trip link (routes/trip-access.ts) sends its
        // token here, never in the URL.
        "X-Trip-Access-Token",
      ],
      exposeHeaders: [
        "X-Request-ID",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
      ],
      maxAge: 86400,
      credentials: true,
    }),
  );

  // Global error handler
  app.onError(errorHandler);

  // ===========================================
  // Health Check Routes (no auth required)
  // ===========================================
  app.route("/health", healthRoutes);

  // ===========================================
  // Passenger trip link (no user token; its own rate limit and token)
  //
  // Registered BEFORE the authenticated /v1 group so exactly these three
  // method + path pairs answer without a bearer token. Every other path —
  // /v1/mp/trip-access/anything-else included — falls through to the group.
  // ===========================================
  app.route("/", tripAccessRoutes);

  // ===========================================
  // API Routes (with auth, identity and rate limiting)
  // ===========================================
  const api = new Hono();

  api.use("*", authMiddleware);
  api.use("*", rateLimitMiddleware);
  api.use("*", identityContextMiddleware);
  api.use("*", scopeEnforcementMiddleware);

  // Exact-route config, ops-finance, and push-device families: GET-only config
  // reads (`profile:read`), exact config admin routes (`config:admin`, DEC-1 = A),
  // exact ops wallet credit routes (`finance:ops`, DEC-6 = C), and exact push
  // device registration/unregistration (`profile:read`, CC-B04). Nothing in
  // PROXY_RULES matches `/config`, `/flags`, `/ops/wallet-credits`, or `/push`,
  // so every unrouted method or path under them falls through to the gateway's
  // own 404.
  api.route("/", configReadRoutes);
  api.route("/", configAdminRoutes);
  api.route("/", opsWalletCreditRoutes);
  api.route("/", pushDeviceRoutes);
  api.route("/", proxyRoutes);

  // The gateway mounts /v1. `/api` is not a UBI prefix.
  app.route("/v1", api);

  // ===========================================
  // 404 Handler
  // ===========================================
  app.notFound((c) => {
    return c.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "The requested resource was not found",
        },
      },
      404,
    );
  });

  return app;
}
