/**
 * Service Authentication Middleware
 *
 * Validates requests from API Gateway with user context headers.
 */

import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";

export const serviceAuthMiddleware = createMiddleware(async (c: Context, next: Next) => {
  // Check for service-to-service auth headers from API Gateway
  const userId = c.req.header("x-auth-user-id");
  const userRole = c.req.header("x-auth-user-role");

  // Allow internal service calls (no auth headers = trusted internal call)
  const isInternalCall = c.req.header("x-internal-service") === "true";

  // Public endpoints don't require auth
  const path = c.req.path;
  const publicPaths = ["/health", "/docs"];
  if (publicPaths.some((p) => path.startsWith(p))) {
    return next();
  }

  // For external requests, require auth context from gateway
  if (!isInternalCall && !userId) {
    return c.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
        },
      },
      401
    );
  }

  // Add auth context to request for downstream handlers
  c.set("userId", userId);
  c.set("userRole", userRole);

  return next();
});
