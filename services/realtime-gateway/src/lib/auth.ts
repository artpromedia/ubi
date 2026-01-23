/**
 * JWT Authentication Module for Real-Time Gateway
 *
 * Provides secure JWT verification matching user-service token format.
 * Supports both access tokens and service-to-service tokens.
 */

import * as jose from "jose";
import { logger } from "./logger.js";

// ===========================================
// Configuration
// ===========================================

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return new TextEncoder().encode(secret);
}

const JWT_ISSUER = "ubi.africa";
const JWT_AUDIENCE = "ubi-api";

// Service secret for internal service-to-service communication
const SERVICE_SECRET = process.env.SERVICE_SECRET;

// ===========================================
// Types
// ===========================================

export interface JWTPayload {
  sub: string; // User ID
  email?: string;
  role?: string;
  permissions?: string[];
  type?: "access" | "refresh";
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}

export interface VerifyTokenResult {
  valid: boolean;
  userId: string | null;
  payload: JWTPayload | null;
  error?: string;
}

// ===========================================
// Token Verification
// ===========================================

/**
 * Verify a JWT token and extract the payload
 *
 * @param token - The JWT token to verify
 * @returns VerifyTokenResult with userId and payload if valid
 */
export async function verifyToken(token: string): Promise<VerifyTokenResult> {
  if (!token) {
    return {
      valid: false,
      userId: null,
      payload: null,
      error: "No token provided",
    };
  }

  // Check if this is a service token (for internal service communication)
  if (token.startsWith("svc_") && SERVICE_SECRET) {
    return verifyServiceToken(token);
  }

  try {
    // Verify JWT signature and claims
    const { payload } = await jose.jwtVerify(token, getJwtSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    // Validate required claims
    if (!payload.sub) {
      logger.warn({ token: token.substring(0, 20) }, "Token missing sub claim");
      return {
        valid: false,
        userId: null,
        payload: null,
        error: "Token missing required claims",
      };
    }

    // Check if token is a refresh token (not allowed for WebSocket auth)
    if (payload.type === "refresh") {
      logger.warn(
        { userId: payload.sub },
        "Refresh token used for WebSocket auth",
      );
      return {
        valid: false,
        userId: null,
        payload: null,
        error: "Refresh tokens cannot be used for WebSocket authentication",
      };
    }

    logger.debug(
      { userId: payload.sub, role: payload.role },
      "Token verified successfully",
    );

    return {
      valid: true,
      userId: payload.sub as string,
      payload: payload as JWTPayload,
    };
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      logger.debug("Token expired");
      return {
        valid: false,
        userId: null,
        payload: null,
        error: "Token expired",
      };
    }

    if (error instanceof jose.errors.JWTClaimValidationFailed) {
      logger.warn(
        { error: (error as Error).message },
        "Token claim validation failed",
      );
      return {
        valid: false,
        userId: null,
        payload: null,
        error: "Token validation failed",
      };
    }

    if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
      logger.warn("Token signature verification failed");
      return {
        valid: false,
        userId: null,
        payload: null,
        error: "Invalid token signature",
      };
    }

    logger.error({ error }, "Unexpected error during token verification");
    return {
      valid: false,
      userId: null,
      payload: null,
      error: "Token verification failed",
    };
  }
}

/**
 * Verify a JWT token without throwing (for optional auth scenarios)
 */
export async function verifyTokenSafe(token: string): Promise<string | null> {
  const result = await verifyToken(token);
  return result.valid ? result.userId : null;
}

/**
 * Verify service-to-service token
 * Used for internal communication between microservices
 */
function verifyServiceToken(token: string): VerifyTokenResult {
  if (!SERVICE_SECRET) {
    logger.warn("Service token provided but SERVICE_SECRET not configured");
    return {
      valid: false,
      userId: null,
      payload: null,
      error: "Service authentication not configured",
    };
  }

  // Service tokens format: svc_{serviceId}_{hmac}
  const parts = token.split("_");
  if (parts.length !== 3) {
    return {
      valid: false,
      userId: null,
      payload: null,
      error: "Invalid service token format",
    };
  }

  const [, serviceId, providedHmac] = parts;

  // Compute expected HMAC
  const crypto = require("crypto");
  const expectedHmac = crypto
    .createHmac("sha256", SERVICE_SECRET)
    .update(`svc_${serviceId}`)
    .digest("hex")
    .substring(0, 32);

  if (providedHmac !== expectedHmac) {
    logger.warn({ serviceId }, "Invalid service token HMAC");
    return {
      valid: false,
      userId: null,
      payload: null,
      error: "Invalid service token",
    };
  }

  logger.debug({ serviceId }, "Service token verified");
  return {
    valid: true,
    userId: `service:${serviceId}`,
    payload: {
      sub: `service:${serviceId}`,
      role: "service",
      permissions: ["broadcast", "subscribe"],
    },
  };
}

/**
 * Decode a token without verification (for debugging only)
 * WARNING: Do not use this for authentication decisions
 */
export function decodeTokenUnsafe(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payloadPart = parts[1];
    if (!payloadPart) return null;

    const payload = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf-8"),
    );
    return payload;
  } catch {
    return null;
  }
}

/**
 * Check if a token is expired without full verification
 * Useful for client-side token refresh decisions
 */
export function isTokenExpired(token: string): boolean {
  const payload = decodeTokenUnsafe(token);
  if (!payload?.exp) return true;

  // Add 30 second buffer for clock skew
  return Date.now() >= payload.exp * 1000 - 30000;
}

/**
 * Get time until token expiration in seconds
 * Returns 0 if already expired or invalid
 */
export function getTokenTimeToLive(token: string): number {
  const payload = decodeTokenUnsafe(token);
  if (!payload?.exp) return 0;

  const ttl = Math.floor((payload.exp * 1000 - Date.now()) / 1000);
  return Math.max(0, ttl);
}
