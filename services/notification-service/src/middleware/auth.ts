/**
 * Authentication Middleware
 */

import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { verify } from "jsonwebtoken";
import { authLogger } from "../lib/logger.js";

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
    if (error instanceof HTTPException) throw error;
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

  const validServiceKey = process.env.INTERNAL_SERVICE_KEY;

  if (!validServiceKey || serviceKey !== validServiceKey) {
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
 * Webhook authentication (signature verification)
 */
export async function webhookAuth(
  c: Context,
  next: Next,
  options: { headerName: string; secret: string },
): Promise<void> {
  const signature = c.req.header(options.headerName);

  if (!signature) {
    throw new HTTPException(401, { message: "Missing webhook signature" });
  }

  // For now, simple comparison - in production, use HMAC verification
  // const body = await c.req.text();
  // const expectedSignature = crypto.createHmac('sha256', options.secret).update(body).digest('hex');

  // if (signature !== expectedSignature) {
  //   throw new HTTPException(401, { message: 'Invalid webhook signature' });
  // }

  await next();
}
