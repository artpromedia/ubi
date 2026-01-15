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
    return await next();
  }

  // Skip auth for health checks
  if (path.startsWith("/health")) {
    return await next();
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
    const apiKeyValidation = await validateApiKey(token);

    if (!apiKeyValidation.valid) {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_API_KEY",
            message: apiKeyValidation.error || "Invalid or expired API key",
          },
        },
        401
      );
    }

    const serviceAuth: AuthContext = {
      userId: apiKeyValidation.serviceId || "service",
      email: apiKeyValidation.serviceEmail || "service@ubi.africa",
      role: "service",
      permissions: apiKeyValidation.permissions || ["*"],
    };
    c.set("auth", serviceAuth);

    // Log API key usage for auditing
    logApiKeyUsage(token, c.req.path, c.req.method);

    return await next();
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
    return await next();
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

// API Key validation result type
interface ApiKeyValidationResult {
  valid: boolean;
  error?: string;
  serviceId?: string;
  serviceEmail?: string;
  serviceName?: string;
  permissions?: string[];
}

// In-memory cache for API keys (with TTL)
const apiKeyCache = new Map<string, { data: ApiKeyValidationResult; expiresAt: number }>();
const API_KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Validate API key against database
 */
async function validateApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
  // Check cache first
  const cached = apiKeyCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    // Hash the API key for lookup (keys are stored hashed in DB)
    const crypto = await import("crypto");
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

    // Query database for API key
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.error("[Auth] DATABASE_URL not configured");
      return { valid: false, error: "Service configuration error" };
    }

    // Use pg for direct database query (lighter than Prisma for this use case)
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });

    try {
      const result = await pool.query(
        `SELECT
          id,
          service_name,
          service_email,
          permissions,
          is_active,
          expires_at,
          rate_limit,
          allowed_ips
        FROM api_keys
        WHERE key_hash = $1`,
        [keyHash]
      );

      await pool.end();

      if (result.rows.length === 0) {
        const invalidResult: ApiKeyValidationResult = { valid: false, error: "API key not found" };
        apiKeyCache.set(apiKey, { data: invalidResult, expiresAt: Date.now() + 60000 }); // Cache invalid for 1 min
        return invalidResult;
      }

      const key = result.rows[0];

      // Check if key is active
      if (!key.is_active) {
        return { valid: false, error: "API key is disabled" };
      }

      // Check expiration
      if (key.expires_at && new Date(key.expires_at) < new Date()) {
        return { valid: false, error: "API key has expired" };
      }

      const validResult: ApiKeyValidationResult = {
        valid: true,
        serviceId: key.id,
        serviceEmail: key.service_email,
        serviceName: key.service_name,
        permissions: key.permissions || ["*"],
      };

      // Cache the valid result
      apiKeyCache.set(apiKey, { data: validResult, expiresAt: Date.now() + API_KEY_CACHE_TTL });

      return validResult;
    } catch (dbError) {
      await pool.end();
      throw dbError;
    }
  } catch (error) {
    console.error("[Auth] API key validation error:", error);

    // Fallback: If database is unavailable, check against environment variable for critical services
    const emergencyKey = process.env.EMERGENCY_API_KEY;
    if (emergencyKey && apiKey === emergencyKey) {
      return {
        valid: true,
        serviceId: "emergency",
        serviceEmail: "emergency@ubi.africa",
        serviceName: "Emergency Access",
        permissions: ["*"],
      };
    }

    return { valid: false, error: "Unable to validate API key" };
  }
}

/**
 * Log API key usage for auditing (async, non-blocking)
 */
function logApiKeyUsage(apiKey: string, path: string, method: string): void {
  // Fire and forget - don't block the request
  setImmediate(async () => {
    try {
      const crypto = await import("crypto");
      const keyPrefix = apiKey.substring(0, 12); // Only log prefix for security

      // Log to stdout for collection by log aggregator
      console.log(
        JSON.stringify({
          type: "API_KEY_USAGE",
          keyPrefix,
          path,
          method,
          timestamp: new Date().toISOString(),
        })
      );

      // Optionally update last_used_at in database
      const databaseUrl = process.env.DATABASE_URL;
      if (databaseUrl) {
        const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
        const { Pool } = await import("pg");
        const pool = new Pool({ connectionString: databaseUrl, max: 1 });

        await pool.query(
          `UPDATE api_keys SET last_used_at = NOW(), usage_count = usage_count + 1 WHERE key_hash = $1`,
          [keyHash]
        );

        await pool.end();
      }
    } catch (error) {
      // Non-critical, just log the error
      console.warn("[Auth] Failed to log API key usage:", error);
    }
  });
}

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
      await next();
      return;
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

    await next();
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

    await next();
  });
};
