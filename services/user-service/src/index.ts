/**
 * UBI User Service
 *
 * Handles user authentication, registration, profiles, and session management.
 * Supports phone OTP, email/password, and social login authentication methods.
 *
 * Features:
 * - User registration and login
 * - OTP verification (SMS)
 * - JWT token management
 * - Profile management
 * - Driver onboarding
 * - Session management with Redis
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";

import { errorHandler } from "./middleware/error-handler";
import { serviceAuthMiddleware } from "./middleware/service-auth";
import { authRoutes } from "./routes/auth";
import { driverRoutes } from "./routes/drivers";
import { healthRoutes } from "./routes/health";
import { sessionRoutes } from "./routes/sessions";
import { userRoutes } from "./routes/users";

// Environment configuration
const PORT = Number.parseInt(process.env.PORT || "4001", 10);
const NODE_ENV = process.env.NODE_ENV || "development";

// Create Hono app
const app = new Hono();

// ===========================================
// Global Middleware
// ===========================================

app.use("*", secureHeaders());
app.use("*", timing());
app.use("*", logger());

// CORS configuration
app.use(
  "*",
  cors({
    origin: [
      "https://app.ubi.africa",
      "https://admin.ubi.africa",
      ...(NODE_ENV === "development"
        ? ["http://localhost:3000", "http://localhost:4000"]
        : []),
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-ID",
      "X-Auth-User-ID",
      "X-Auth-User-Role",
    ],
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
// Public Auth Routes
// ===========================================
app.route("/auth", authRoutes);

// ===========================================
// Protected Routes (requires service auth or JWT)
// ===========================================
const protectedApi = new Hono();

// Service-to-service auth middleware
protectedApi.use("*", serviceAuthMiddleware);

// User routes
protectedApi.route("/users", userRoutes);

// Driver routes
protectedApi.route("/drivers", driverRoutes);

// Session routes
protectedApi.route("/sessions", sessionRoutes);

// Mount protected routes
app.route("/", protectedApi);

// ===========================================
// 404 Handler
// ===========================================
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "The requested endpoint was not found",
      },
    },
    404,
  );
});

// ===========================================
// Start Server
// ===========================================
console.info(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   👤 UBI User Service                                 ║
║   ────────────────────                                ║
║   Environment: ${NODE_ENV.padEnd(40)}║
║   Port: ${String(PORT).padEnd(47)}║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port: PORT,
});

export default app;
