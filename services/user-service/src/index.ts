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
import { logger as honoLogger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";

import { defaultIdentityDeps } from "./identity/deps";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma";
import { errorHandler } from "./middleware/error-handler";
import { serviceAuthMiddleware } from "./middleware/service-auth";
import { authRoutes } from "./routes/auth";
import { createDeviceRoutes } from "./routes/devices";
import { createDriverProfileRoutes } from "./routes/driver-profiles";
import { driverRoutes } from "./routes/drivers";
import { createGrantRoutes } from "./routes/grants";
import { healthRoutes } from "./routes/health";
import { createIdentityRoutes } from "./routes/identity";
import { createKycRoutes } from "./routes/kyc";
import { createMandateRoutes } from "./routes/mandates";
import { createOrganizationRoutes } from "./routes/organizations";
import { sessionRoutes } from "./routes/sessions";
import { userRoutes } from "./routes/users";

import type { AiActionDeps } from "./grants/types";

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
app.use("*", honoLogger());

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
// Identity (slice 03) — devices, step-up, PIN, documents, SIM-swap.
//
// These routes authenticate themselves: user-facing ones verify the API
// gateway's SIGNED identity context, and the webhook and sweeps verify a
// shared secret. They are mounted OUTSIDE `protectedApi` because they must not
// inherit the header-trusting service-auth middleware.
// ===========================================
const identityDeps = defaultIdentityDeps();
app.route("/devices", createDeviceRoutes(identityDeps));
app.route("/", createIdentityRoutes(identityDeps));

// KYC requirements per city: public, no account data (marketing site and
// driver app read the same list). Mounted outside `protectedApi` on purpose.
app.route("/", createKycRoutes());

// ===========================================
// Action grants + mandates (slice NEW-01)
//
// User mandate CRUD (`/mandates`) authenticates via the gateway's signed
// identity context; the internal grant + mandate-run surface (`/internal/*`)
// authenticates via the service key. Both are mounted at "/" OUTSIDE
// `protectedApi` so they do not inherit the header-trusting service-auth
// middleware, exactly like the identity slice.
// ===========================================
const aiActionDeps: AiActionDeps = { prisma, now: () => new Date() };
app.route("/", createMandateRoutes(aiActionDeps));
app.route("/", createGrantRoutes(aiActionDeps));

// ===========================================
// Verified driver-profile read model (P10)
//
// `GET /internal/driver-profiles` — ride-service and ask-service resolve the
// privacy-limited driver card, each with its own service key. Mounted OUTSIDE
// `protectedApi` for the same reason as the grant surface: a user identity or
// a forged `x-auth-*` header must never be what lets a request in.
// ===========================================
app.route("/", createDriverProfileRoutes({ prisma, now: () => new Date() }));

// ===========================================
// Business travel organizations (A06 part C)
//
// `/organizations…` — organizations, members, invitations, cost centres and
// the travel policy. Signed identity context only, mounted OUTSIDE
// `protectedApi` like the mandate routes. The money side (funding, budgets,
// business bookings, statements) is payment-service `/v1/business`.
// ===========================================
app.route("/", createOrganizationRoutes({ prisma, now: () => new Date() }));

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
logger.info({ port: PORT, environment: NODE_ENV }, "UBI User Service starting");

serve({
  fetch: app.fetch,
  port: PORT,
});

export default app;
