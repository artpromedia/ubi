/**
 * Authentication Middleware
 */

import { Context, Next } from "hono";
import { verify } from "jsonwebtoken";
import { redis } from "../lib/redis";

// Augment Hono's ContextVariableMap for type-safe context variables
declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userEmail?: string;
    userRole?: string;
    sessionId?: string;
    restaurantId?: string;
  }
}

interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  restaurantId?: string;
  iat: number;
  exp: number;
}

/**
 * JWT Authentication Middleware
 */
export async function auth(c: Context, next: Next): Promise<void | Response> {
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Missing or invalid authorization header",
        },
      },
      401
    );
  }

  const token = authHeader.substring(7);

  try {
    // Check if token is blacklisted
    const isBlacklisted = await redis.get(`token:blacklist:${token}`);
    if (isBlacklisted) {
      return c.json(
        {
          success: false,
          error: { code: "TOKEN_REVOKED", message: "Token has been revoked" },
        },
        401
      );
    }

    const payload = verify(
      token,
      process.env.JWT_SECRET || "secret"
    ) as TokenPayload;

    // Set user context
    c.set("userId", payload.userId);
    c.set("userEmail", payload.email);
    c.set("userRole", payload.role);
    c.set("restaurantId", payload.restaurantId);

    await next();
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      return c.json(
        {
          success: false,
          error: { code: "TOKEN_EXPIRED", message: "Token has expired" },
        },
        401
      );
    }

    return c.json(
      {
        success: false,
        error: { code: "INVALID_TOKEN", message: "Invalid token" },
      },
      401
    );
  }
}

/**
 * Restaurant Owner Middleware
 */
export async function restaurantOwner(
  c: Context,
  next: Next
): Promise<void | Response> {
  const userRole = c.get("userRole");
  const userId = c.get("userId");
  const restaurantId =
    c.req.param("restaurantId") || c.req.query("restaurantId");

  if (userRole === "ADMIN") {
    await next();
    return;
  }

  if (userRole !== "RESTAURANT_OWNER") {
    return c.json(
      {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Restaurant owner access required",
        },
      },
      403
    );
  }

  // Verify restaurant ownership if restaurantId is provided
  if (restaurantId) {
    const { prisma } = await import("../lib/prisma.js");
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { ownerId: true },
    });

    if (restaurant?.ownerId !== userId) {
      return c.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Not authorized for this restaurant",
          },
        },
        403
      );
    }
  }

  await next();
}

/**
 * Admin Only Middleware
 */
export async function adminOnly(
  c: Context,
  next: Next
): Promise<void | Response> {
  const userRole = c.get("userRole");

  if (userRole !== "ADMIN") {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Admin access required" },
      },
      403
    );
  }

  await next();
}

/**
 * Service-to-Service Authentication
 */
export async function serviceAuth(
  c: Context,
  next: Next
): Promise<void | Response> {
  const serviceKey = c.req.header("X-Service-Key");

  if (!serviceKey || serviceKey !== process.env.INTERNAL_SERVICE_KEY) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Invalid service key" },
      },
      403
    );
  }

  await next();
}

/**
 * Optional Auth - Sets user context if token present, continues regardless
 */
export async function optionalAuth(
  c: Context,
  next: Next
): Promise<void | Response> {
  const authHeader = c.req.header("Authorization");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);

    try {
      const isBlacklisted = await redis.get(`token:blacklist:${token}`);
      if (!isBlacklisted) {
        const payload = verify(
          token,
          process.env.JWT_SECRET || "secret"
        ) as TokenPayload;
        c.set("userId", payload.userId);
        c.set("userEmail", payload.email);
        c.set("userRole", payload.role);
        c.set("restaurantId", payload.restaurantId);
      }
    } catch {
      // Ignore errors for optional auth
    }
  }

  await next();
}
