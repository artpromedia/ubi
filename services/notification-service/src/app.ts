/**
 * Notification Service Hono application factory.
 *
 * Separated from `src/index.ts` so route-manifest inspection and HTTP route
 * tests exercise the exact production router without binding a TCP port or
 * opening background Redis subscriber loops.
 */
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { dlqRoutes } from "./routes/dlq";
import { emailRoutes } from "./routes/email";
import { healthRoutes } from "./routes/health";
import { inAppRoutes } from "./routes/in-app";
import { preferencesRoutes } from "./routes/preferences";
import { pushRoutes } from "./routes/push";
import { smsRoutes } from "./routes/sms";
import { templatesRoutes } from "./routes/templates";

export function createApp(): Hono {
  const app = new Hono();

  // Global middleware
  app.use("*", cors());
  app.use("*", honoLogger());
  app.use("*", secureHeaders());
  app.use("*", compress());

  // Error handling
  app.onError(errorHandler);

  // Health check routes
  app.route("/health", healthRoutes);

  // API routes
  app.route("/api/v1/push", pushRoutes);
  app.route("/api/v1/sms", smsRoutes);
  app.route("/api/v1/email", emailRoutes);
  app.route("/api/v1/notifications", inAppRoutes);
  app.route("/api/v1/ops/notifications/dlq", dlqRoutes);
  app.route("/api/v1/templates", templatesRoutes);
  app.route("/api/v1/preferences", preferencesRoutes);

  // 404 handler
  app.notFound(notFoundHandler);

  return app;
}
