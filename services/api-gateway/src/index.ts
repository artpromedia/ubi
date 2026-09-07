/**
 * UBI API Gateway
 *
 * High-performance API gateway using Hono framework.
 * Handles authentication, identity, rate limiting, and request routing
 * to downstream microservices.
 *
 * Features:
 * - JWT-based authentication
 * - Signed internal identity context (see middleware/identity.ts)
 * - Limited-mode and wallet-safe-mode scope enforcement
 * - Redis-backed rate limiting
 * - Request/response logging
 * - Health checks
 */

import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { logger } from "./lib/logger.js";

// Environment configuration
const PORT = Number.parseInt(process.env.PORT || "4000", 10);
const NODE_ENV = process.env.NODE_ENV || "development";

const app = createApp(NODE_ENV);

logger.info({ port: PORT, environment: NODE_ENV }, "UBI API Gateway starting");

serve({
  fetch: app.fetch,
  port: PORT,
});

export default app;
