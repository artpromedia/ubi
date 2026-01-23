/**
 * UBI API Gateway
 *
 * High-performance API gateway using Hono framework.
 * Handles authentication, rate limiting, and request routing
 * to downstream microservices.
 *
 * Features:
 * - JWT-based authentication
 * - Redis-backed rate limiting
 * - Request/response logging
 * - Health checks
 * - OpenAPI documentation
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { etag } from "hono/etag";
import { logger as honoLogger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";
import { logger } from "./lib/logger.js";

import { authMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { healthRoutes } from "./routes/health";
import { proxyRoutes } from "./routes/proxy";

// Environment configuration
const PORT = parseInt(process.env.PORT || "4000", 10);
const NODE_ENV = process.env.NODE_ENV || "development";

// Create Hono app
const app = new Hono();

// ===========================================
// Global Middleware
// ===========================================

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
      ...(NODE_ENV === "development"
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
// API Routes (with auth and rate limiting)
// ===========================================
const api = new Hono();

// Rate limiting
api.use("*", rateLimitMiddleware);

// Authentication (skip for public routes)
api.use("*", authMiddleware);

// Proxy routes to downstream services
api.route("/", proxyRoutes);

// Mount API routes
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

// ===========================================
// Start Server
// ===========================================
logger.info({ port: PORT, environment: NODE_ENV }, "UBI API Gateway starting");

serve({
  fetch: app.fetch,
  port: PORT,
});

export default app;
