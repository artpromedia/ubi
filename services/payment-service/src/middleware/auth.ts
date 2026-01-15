/**
 * Service Auth Middleware
 *
 * Extracts user information from API Gateway headers
 */

import type { Context, Next } from "hono";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userEmail?: string;
    userRole?: string;
    sessionId?: string;
  }
}

/**
 * Service authentication middleware
 * Extracts user info from API Gateway forwarded headers
 */
export async function serviceAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  // Headers set by API Gateway after authentication
  const userId = c.req.header("X-User-ID");
  const userEmail = c.req.header("X-User-Email");
  const userRole = c.req.header("X-User-Role");
  const sessionId = c.req.header("X-Session-ID");

  if (!userId) {
    return c.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
        },
      },
      401,
    );
  }

  // Set context variables
  c.set("userId", userId);
  if (userEmail) {
    c.set("userEmail", userEmail);
  }
  if (userRole) {
    c.set("userRole", userRole);
  }
  if (sessionId) {
    c.set("sessionId", sessionId);
  }

  await next();
}

/**
 * Optional auth middleware
 * Extracts user info if available, but doesn't require it
 */
export async function optionalAuth(c: Context, next: Next) {
  const userId = c.req.header("X-User-ID");
  const userEmail = c.req.header("X-User-Email");
  const userRole = c.req.header("X-User-Role");
  const sessionId = c.req.header("X-Session-ID");

  if (userId) {
    c.set("userId", userId);
    if (userEmail) {
      c.set("userEmail", userEmail);
    }
    if (userRole) {
      c.set("userRole", userRole);
    }
    if (sessionId) {
      c.set("sessionId", sessionId);
    }
  }

  await next();
}

/**
 * Internal service auth middleware
 * For service-to-service communication
 */
export async function internalServiceAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const serviceKey = c.req.header("X-Service-Key");

  if (serviceKey !== process.env.INTERNAL_SERVICE_KEY) {
    return c.json(
      {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Internal endpoint",
        },
      },
      403,
    );
  }

  await next();
}

/**
 * Admin auth middleware
 */
export async function adminAuth(
  c: Context,
  next: Next,
): Promise<void | Response> {
  const userRole = c.req.header("X-User-Role");

  if (!userRole || !["ADMIN", "SUPER_ADMIN"].includes(userRole)) {
    return c.json(
      {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Admin access required",
        },
      },
      403,
    );
  }

  await next();
}
