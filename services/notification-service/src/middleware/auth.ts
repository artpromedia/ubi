/**
 * Authentication Middleware
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { HTTPException } from "hono/http-exception";
import { verify } from "jsonwebtoken";

import { authLogger } from "../lib/logger.js";

import type { Context, Next } from "hono";

export const MIN_SERVICE_KEY_LENGTH = 32;

// ============================================
// Types
// ============================================

interface JWTPayload {
  sub: string;
  email?: string;
  role: string;
  type: string;
  iat: number;
  exp: number;
}

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userRole: string;
    jwtPayload: JWTPayload;
  }
}

/**
 * Constant-time string comparison via SHA-256 digests.
 */
function constantTimeMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(presented, "utf8").digest(),
    createHash("sha256").update(expected, "utf8").digest(),
  );
}

/**
 * Refuses to start notification-service in production without >= 32-character
 * `INTERNAL_SERVICE_KEY` and `NOTIFICATION_SERVICE_KEY`.
 */
export function assertServiceAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  const internalKey = env.INTERNAL_SERVICE_KEY;
  if (
    internalKey === undefined ||
    internalKey.trim().length < MIN_SERVICE_KEY_LENGTH
  ) {
    throw new Error(
      `INTERNAL_SERVICE_KEY is required in production (at least ${MIN_SERVICE_KEY_LENGTH} characters)`,
    );
  }
  const userKey = env.NOTIFICATION_SERVICE_KEY;
  if (userKey === undefined || userKey.trim().length < MIN_SERVICE_KEY_LENGTH) {
    throw new Error(
      `NOTIFICATION_SERVICE_KEY is required in production (at least ${MIN_SERVICE_KEY_LENGTH} characters)`,
    );
  }
}

/**
 * Verifies a service-to-service caller in constant time.
 * `user-service` presents its dedicated `NOTIFICATION_SERVICE_KEY`; other
 * internal callers present `INTERNAL_SERVICE_KEY`. Neither key opens the
 * other's caller identity, and unconfigured keys fail closed.
 */
export function verifyServiceCaller(
  serviceName: string | undefined,
  presentedKey: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const caller = serviceName?.trim().toLowerCase() ?? "";
  if (
    caller.length === 0 ||
    presentedKey === undefined ||
    presentedKey.length === 0
  ) {
    return false;
  }
  const expectedKey =
    caller === "user-service"
      ? env.NOTIFICATION_SERVICE_KEY
      : env.INTERNAL_SERVICE_KEY;

  if (expectedKey === undefined || expectedKey.length === 0) {
    return false;
  }
  if (
    env.NODE_ENV === "production" &&
    expectedKey.length < MIN_SERVICE_KEY_LENGTH
  ) {
    return false;
  }
  return constantTimeMatches(presentedKey, expectedKey);
}

// ============================================
// JWT Auth Middleware
// ============================================

/**
 * Standard JWT authentication
 */
export async function auth(c: Context, next: Next): Promise<void> {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new HTTPException(401, {
      message: "Missing or invalid authorization header",
    });
  }

  const token = authHeader.substring(7);

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new HTTPException(500, { message: "JWT secret not configured" });
    }

    const payload = verify(token, secret) as JWTPayload;

    // Set context variables
    c.set("userId", payload.sub);
    c.set("userRole", payload.role);
    c.set("jwtPayload", payload);

    await next();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(401, { message: "Invalid or expired token" });
  }
}

/**
 * Optional authentication (doesn't fail if no token)
 */
export async function optionalAuth(c: Context, next: Next): Promise<void> {
  const authHeader = c.req.header("Authorization");

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);

    try {
      const secret = process.env.JWT_SECRET;
      if (secret) {
        const payload = verify(token, secret) as JWTPayload;
        c.set("userId", payload.sub);
        c.set("userRole", payload.role);
        c.set("jwtPayload", payload);
      }
    } catch {
      // Ignore invalid tokens for optional auth
    }
  }

  await next();
}

/**
 * Admin-only access
 */
export async function adminOnly(c: Context, next: Next): Promise<void> {
  await auth(c, async () => {
    const role = c.get("userRole");

    if (role !== "admin" && role !== "super_admin") {
      throw new HTTPException(403, { message: "Admin access required" });
    }

    await next();
  });
}

/**
 * Service-to-service authentication
 */
export async function serviceAuth(c: Context, next: Next): Promise<void> {
  const serviceKey = c.req.header("X-Service-Key");
  const serviceName = c.req.header("X-Service-Name");

  if (!serviceKey || !serviceName) {
    throw new HTTPException(401, { message: "Missing service authentication" });
  }

  if (!verifyServiceCaller(serviceName, serviceKey)) {
    throw new HTTPException(401, { message: "Invalid service key" });
  }

  // Log service call for audit
  authLogger.debug({ serviceName }, "Service call received");

  await next();
}

/**
 * Combined auth - accepts either user JWT or service key
 */
export async function combinedAuth(c: Context, next: Next): Promise<void> {
  const authHeader = c.req.header("Authorization");
  const serviceKey = c.req.header("X-Service-Key");

  if (serviceKey) {
    await serviceAuth(c, next);
  } else if (authHeader) {
    await auth(c, next);
  } else {
    throw new HTTPException(401, { message: "Authentication required" });
  }
}

/**
 * Webhook authentication (constant-time HMAC-SHA256 signature verification)
 */
export async function webhookAuth(
  c: Context,
  next: Next,
  options: { headerName: string; secret: string },
): Promise<void> {
  if (!options.secret || options.secret.trim().length < 16) {
    throw new HTTPException(503, {
      message: "Webhook authentication is not configured",
    });
  }

  const signature = c.req.header(options.headerName)?.trim();
  if (!signature) {
    throw new HTTPException(401, { message: "Missing webhook signature" });
  }

  const normalizedSig = signature.replace(/^sha256=/i, "");
  const body = await c.req.raw.clone().text();
  const expectedSignature = createHmac("sha256", options.secret)
    .update(body, "utf8")
    .digest("hex");

  if (!constantTimeMatches(normalizedSig, expectedSignature)) {
    throw new HTTPException(401, { message: "Invalid webhook signature" });
  }

  await next();
}
