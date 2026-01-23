/**
 * Tests for JWT Authentication Module
 */

import * as jose from "jose";
import { describe, expect, it } from "vitest";
import {
  decodeTokenUnsafe,
  getTokenTimeToLive,
  isTokenExpired,
  verifyToken,
  verifyTokenSafe,
} from "../lib/auth.js";

// Test JWT configuration - tests must set JWT_SECRET env var
const TEST_SECRET = "test-secret-for-testing-only";

// Ensure JWT_SECRET is set for tests
process.env.JWT_SECRET = TEST_SECRET;

const JWT_SECRET = new TextEncoder().encode(TEST_SECRET);
const JWT_ISSUER = "ubi.africa";
const JWT_AUDIENCE = "ubi-api";

/**
 * Generate a valid test token
 */
async function generateTestToken(
  payload: Record<string, unknown> = {},
  options: { expiresIn?: string } = {},
): Promise<string> {
  return await new jose.SignJWT({
    sub: "test-user-123",
    email: "test@example.com",
    role: "rider",
    permissions: [],
    ...payload,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(options.expiresIn || "15m")
    .setIssuedAt()
    .sign(JWT_SECRET);
}

/**
 * Generate an expired token
 */
async function generateExpiredToken(): Promise<string> {
  return await new jose.SignJWT({
    sub: "test-user-123",
    email: "test@example.com",
    role: "rider",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime("-1h") // Expired 1 hour ago
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .sign(JWT_SECRET);
}

/**
 * Generate a token with wrong signature
 */
async function generateInvalidSignatureToken(): Promise<string> {
  const wrongSecret = new TextEncoder().encode("wrong-secret");
  return await new jose.SignJWT({
    sub: "test-user-123",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime("15m")
    .setIssuedAt()
    .sign(wrongSecret);
}

describe("JWT Authentication", () => {
  describe("verifyToken", () => {
    it("should verify a valid token", async () => {
      const token = await generateTestToken();
      const result = await verifyToken(token);

      expect(result.valid).toBe(true);
      expect(result.userId).toBe("test-user-123");
      expect(result.payload?.email).toBe("test@example.com");
      expect(result.payload?.role).toBe("rider");
      expect(result.error).toBeUndefined();
    });

    it("should reject an empty token", async () => {
      const result = await verifyToken("");

      expect(result.valid).toBe(false);
      expect(result.userId).toBeNull();
      expect(result.error).toBe("No token provided");
    });

    it("should reject an expired token", async () => {
      const token = await generateExpiredToken();
      const result = await verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.userId).toBeNull();
      expect(result.error).toBe("Token expired");
    });

    it("should reject a token with invalid signature", async () => {
      const token = await generateInvalidSignatureToken();
      const result = await verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.userId).toBeNull();
      expect(result.error).toBe("Invalid token signature");
    });

    it("should reject a refresh token", async () => {
      const token = await generateTestToken({ type: "refresh" });
      const result = await verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe(
        "Refresh tokens cannot be used for WebSocket authentication",
      );
    });

    it("should reject a token with wrong issuer", async () => {
      const token = await new jose.SignJWT({ sub: "test-user" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("wrong-issuer")
        .setAudience(JWT_AUDIENCE)
        .setExpirationTime("15m")
        .setIssuedAt()
        .sign(JWT_SECRET);

      const result = await verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Token validation failed");
    });

    it("should reject a token with wrong audience", async () => {
      const token = await new jose.SignJWT({ sub: "test-user" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(JWT_ISSUER)
        .setAudience("wrong-audience")
        .setExpirationTime("15m")
        .setIssuedAt()
        .sign(JWT_SECRET);

      const result = await verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Token validation failed");
    });

    it("should reject a malformed token", async () => {
      const result = await verifyToken("not.a.valid.jwt");

      expect(result.valid).toBe(false);
      expect(result.userId).toBeNull();
    });
  });

  describe("verifyTokenSafe", () => {
    it("should return userId for valid token", async () => {
      const token = await generateTestToken();
      const userId = await verifyTokenSafe(token);

      expect(userId).toBe("test-user-123");
    });

    it("should return null for invalid token", async () => {
      const userId = await verifyTokenSafe("invalid-token");

      expect(userId).toBeNull();
    });
  });

  describe("isTokenExpired", () => {
    it("should return false for valid token", async () => {
      const token = await generateTestToken();
      expect(isTokenExpired(token)).toBe(false);
    });

    it("should return true for expired token", async () => {
      const token = await generateExpiredToken();
      expect(isTokenExpired(token)).toBe(true);
    });

    it("should return true for invalid token", () => {
      expect(isTokenExpired("invalid")).toBe(true);
    });
  });

  describe("getTokenTimeToLive", () => {
    it("should return positive TTL for valid token", async () => {
      const token = await generateTestToken({ expiresIn: "1h" } as any);
      const ttl = getTokenTimeToLive(token);

      // Should be roughly 3600 seconds (1 hour)
      expect(ttl).toBeGreaterThan(3500);
      expect(ttl).toBeLessThanOrEqual(3600);
    });

    it("should return 0 for expired token", async () => {
      const token = await generateExpiredToken();
      expect(getTokenTimeToLive(token)).toBe(0);
    });
  });

  describe("decodeTokenUnsafe", () => {
    it("should decode a valid token without verification", async () => {
      const token = await generateTestToken();
      const payload = decodeTokenUnsafe(token);

      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe("test-user-123");
      expect(payload?.email).toBe("test@example.com");
    });

    it("should return null for invalid token format", () => {
      expect(decodeTokenUnsafe("invalid")).toBeNull();
      expect(decodeTokenUnsafe("only.two")).toBeNull();
    });
  });
});
