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
 *   2. rate limiting
 *   3. authMiddleware               validates the bearer token / API key.
 *   4. identityContextMiddleware    mints and signs the internal identity
 *                                   context and installs it on the request.
 *   5. scopeEnforcementMiddleware   applies the limited-mode / safe-mode
 *                                   matrix, deny-by-default.
 *   6. proxyRoutes                  forwards to the downstream service.
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
import { healthRoutes } from "./routes/health";
import { proxyRoutes } from "./routes/proxy";

export function createApp(
  nodeEnv: string = process.env.NODE_ENV || "development",
): Hono {
  const app = new Hono();

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
      origin: [
        "https://app.ubi.africa",
        "https://admin.ubi.africa",
        "https://ubi.africa",
        // Development origins
        ...(nodeEnv === "development"
          ? [
              "http://localhost:3000",
              "http://localhost:3001",
              "http://localhost:3002",
            ]
          : []),
      ],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "X-Request-ID",
        "X-Idempotency-Key",
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
  // API Routes (with auth, identity and rate limiting)
  // ===========================================
  const api = new Hono();

  api.use("*", rateLimitMiddleware);
  api.use("*", authMiddleware);
  api.use("*", identityContextMiddleware);
  api.use("*", scopeEnforcementMiddleware);

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
