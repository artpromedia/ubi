/**
 * Authentication Middleware
 *
 * Validates JWT tokens and attaches user context to requests.
 * Supports both access tokens and API keys for service-to-service communication.
 */

import { createMiddleware } from "hono/factory";
import * as jose from "jose";
import type { Context, Next } from "hono";

// Types
interface JWTPayload {
  sub: string;
  email: string;
  role: "rider" | "driver" | "restaurant" | "merchant" | "admin" | "service";
  permissions: string[];
  iat: number;
  exp: number;
}

interface AuthContext {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
}

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  "/v1/auth/login",
  "/v1/auth/register",
  "/v1/auth/forgot-password",
  "/v1/auth/reset-password",
  "/v1/auth/verify-otp",
  "/v1/auth/refresh",
  "/v1/locations/autocomplete",
  "/v1/restaurants/public",
  "/v1/pricing/estimate",
];

// Get JWT secret from environment
const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return new TextEncoder().encode(secret);
};

export const authMiddleware = createMiddleware(async (c: Context, next: Next) => {
  const path = c.req.path;

  // Skip auth for public routes
  if (PUBLIC_ROUTES.some((route) => path.startsWith(route))) {
    return next();
  }

  // Skip auth for health checks
  if (path.startsWith("/health")) {
    return next();
  }

  // Get authorization header
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authorization header is required",
        },
      },
      401
    );
  }

  // Check for Bearer token
  if (!authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_TOKEN",
          message: "Invalid authorization format. Use: Bearer <token>",
        },
      },
      401
    );
  }

  const token = authHeader.substring(7);

  // Check for API key (service-to-service)
  if (token.startsWith("ubi_sk_")) {
    // TODO: Validate API key against database
    const serviceAuth: AuthContext = {
      userId: "service",
      email: "service@ubi.africa",
      role: "service",
      permissions: ["*"],
    };
    c.set("auth", serviceAuth);
    return next();
  }

  // Validate JWT token
  try {
    const { payload } = await jose.jwtVerify(token, getJWTSecret(), {
      issuer: "ubi.africa",
      audience: "ubi-api",
    });

    const jwtPayload = payload as unknown as JWTPayload;

    // Attach auth context to request
    const auth: AuthContext = {
      userId: jwtPayload.sub,
      email: jwtPayload.email,
      role: jwtPayload.role,
      permissions: jwtPayload.permissions,
    };

    c.set("auth", auth);
    return next();
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      return c.json(
        {
          success: false,
          error: {
            code: "TOKEN_EXPIRED",
            message: "Your session has expired. Please log in again.",
          },
        },
        401
      );
    }

    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_TOKEN",
          message: "Invalid or malformed token",
        },
      },
      401
    );
  }
});

/**
 * Permission check middleware factory
 * Use to protect routes that require specific permissions
 */
export const requirePermission = (permission: string) => {
  return createMiddleware(async (c: Context, next: Next) => {
    const auth = c.get("auth") as AuthContext | undefined;

    if (!auth) {
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

    // Service accounts have all permissions
    if (auth.role === "service" || auth.permissions.includes("*")) {
      return next();
    }

    // Check for specific permission
    if (!auth.permissions.includes(permission)) {
      return c.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: `You don't have permission to perform this action`,
          },
        },
        403
      );
    }

    return next();
  });
};

/**
 * Role check middleware factory
 * Use to protect routes that require specific roles
 */
export const requireRole = (...roles: string[]) => {
  return createMiddleware(async (c: Context, next: Next) => {
    const auth = c.get("auth") as AuthContext | undefined;

    if (!auth) {
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

    if (!roles.includes(auth.role)) {
      return c.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: `This action requires one of the following roles: ${roles.join(", ")}`,
          },
        },
        403
      );
    }

    return next();
  });
};
