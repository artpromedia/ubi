/**
 * JWT & Gateway Identity Authentication Module for Real-Time Gateway
 *
 * Provides cryptographic JWT verification matching both:
 *   1. user-service access tokens (`JWT_SECRET`, issuer `ubi.africa`, audience `ubi-api`)
 *   2. api-gateway signed `x-ubi-identity` tokens (`UBI_IDENTITY_SECRET` /
 *      `UBI_IDENTITY_SECRET_PREVIOUS`, issuer `ubi-api-gateway`, audience `ubi-internal`)
 *   3. service-to-service HMAC tokens (`SERVICE_SECRET`)
 */

import { createHmac } from "node:crypto";
import * as jose from "jose";
import type { UserType } from "../types/index.js";
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

function getIdentitySecrets(): Uint8Array[] {
  const secrets: Uint8Array[] = [];
  const current = process.env.UBI_IDENTITY_SECRET?.trim();
  const previous = process.env.UBI_IDENTITY_SECRET_PREVIOUS?.trim();
  if (current && current.length >= 32) {
    secrets.push(new TextEncoder().encode(current));
  }
  if (previous && previous.length >= 32) {
    secrets.push(new TextEncoder().encode(previous));
  }
  return secrets;
}

const JWT_ISSUER = "ubi.africa";
const JWT_AUDIENCE = "ubi-api";

const IDENTITY_ISSUER = "ubi-api-gateway";
const IDENTITY_AUDIENCE = "ubi-internal";

// ===========================================
// Types
// ===========================================

export interface JWTPayload {
  sub: string; // User ID
  email?: string;
  role?: string;
  modes?: string[];
  scopes?: string[];
  cityId?: string;
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

/**
 * Derive the canonical WebSocket `UserType` from the verified token's `role`
 * (or `modes` claim on an `x-ubi-identity` token). The client may never
 * self-assert a role that contradicts its verified token.
 */
export function deriveUserTypeFromRole(
  role?: string,
  modes?: readonly string[],
): UserType | null {
  const normalized = role?.trim().toLowerCase();
  if (normalized) {
    switch (normalized) {
      case "driver":
        return "driver";
      case "rider":
      case "user":
      case "admin":
      case "super_admin":
      case "ops":
      case "ops_agent":
      case "support_agent":
      case "finance_ops":
      case "safety_ops":
      case "fleet_manager":
        return "rider";
      case "restaurant":
      case "merchant":
      case "vendor":
        return "restaurant";
      case "delivery_partner":
      case "courier":
        return "delivery_partner";
      default:
        break;
    }
  }
  if (Array.isArray(modes)) {
    const lowerModes = modes.map((m) => String(m).toLowerCase());
    if (lowerModes.includes("driver")) return "driver";
    if (lowerModes.includes("rider")) return "rider";
  }
  return null;
}

// ===========================================
// Token Verification
// ===========================================

/**
 * Verify a gateway-signed `x-ubi-identity` JWT (`UBI_IDENTITY_SECRET` /
 * `UBI_IDENTITY_SECRET_PREVIOUS`).
 */
export async function verifyIdentityToken(
  token: string,
): Promise<VerifyTokenResult> {
  const secrets = getIdentitySecrets();
  if (secrets.length === 0) {
    return {
      valid: false,
      userId: null,
      payload: null,
      error: "UBI_IDENTITY_SECRET not configured",
    };
  }

  let lastError: unknown;
  for (const secret of secrets) {
    try {
      const { payload } = await jose.jwtVerify(token, secret, {
        algorithms: ["HS256"],
        issuer: IDENTITY_ISSUER,
        audience: IDENTITY_AUDIENCE,
        maxTokenAge: "120s",
      });
      if (!payload.sub || typeof payload.sub !== "string") {
        return {
          valid: false,
          userId: null,
          payload: null,
          error: "Identity token missing required claims",
        };
      }
      const modes = Array.isArray(payload.modes)
        ? payload.modes.filter((m): m is string => typeof m === "string")
        : undefined;
      const role =
        typeof payload.role === "string"
          ? payload.role
          : modes?.includes("driver")
            ? "driver"
            : modes?.includes("rider")
              ? "rider"
              : undefined;

      return {
        valid: true,
        userId: payload.sub,
        payload: {
          ...(payload as JWTPayload),
          sub: payload.sub,
          ...(role ? { role } : {}),
          ...(modes ? { modes } : {}),
        },
      };
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError instanceof jose.errors.JWTExpired) {
    return {
      valid: false,
      userId: null,
      payload: null,
      error: "Token expired",
    };
  }
  return {
    valid: false,
    userId: null,
    payload: null,
    error: "Invalid token signature",
  };
}

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
  if (token.startsWith("svc_") && process.env.SERVICE_SECRET) {
    return verifyServiceToken(token);
  }

  // If the token was issued by api-gateway (x-ubi-identity), verify against UBI_IDENTITY_SECRET.
  const unverified = decodeTokenUnsafe(token);
  if (unverified?.iss === IDENTITY_ISSUER && getIdentitySecrets().length > 0) {
    return verifyIdentityToken(token);
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
  const serviceSecret = process.env.SERVICE_SECRET;
  if (!serviceSecret) {
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
  const expectedHmac = createHmac("sha256", serviceSecret)
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
