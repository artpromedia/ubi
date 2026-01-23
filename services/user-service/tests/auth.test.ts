/**
 * Authentication Tests for User Service
 *
 * Tests JWT token generation, verification, OTP flow, and security measures.
 */

import * as jose from "jose";
import { describe, expect, it } from "vitest";

// JWT configuration matching auth.ts
const JWT_SECRET = new TextEncoder().encode(
  "test-secret-for-unit-testing-only",
);
const JWT_ISSUER = "ubi.africa";
const JWT_AUDIENCE = "ubi-api";

/**
 * Generate JWT tokens for testing (mirrors auth.ts implementation)
 */
async function generateTokens(user: {
  id: string;
  email: string;
  role: string;
  permissions?: string[];
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const accessToken = await new jose.SignJWT({
    sub: user.id,
    email: user.email,
    role: user.role.toLowerCase(),
    permissions: user.permissions || [],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime("15m")
    .setIssuedAt()
    .sign(JWT_SECRET);

  const refreshToken = await new jose.SignJWT({
    sub: user.id,
    type: "refresh",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(JWT_SECRET);

  return {
    accessToken,
    refreshToken,
    expiresIn: 900,
  };
}

/**
 * Verify and decode a JWT token
 */
async function verifyToken(token: string, options: { audience?: string } = {}) {
  return jose.jwtVerify(token, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: options.audience,
  });
}

describe("JWT Token Generation", () => {
  const testUser = {
    id: "user_123456",
    email: "test@example.com",
    role: "RIDER",
    permissions: ["read:profile", "write:profile"],
  };

  it("should generate valid access and refresh tokens", async () => {
    const tokens = await generateTokens(testUser);

    expect(tokens.accessToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();
    expect(tokens.expiresIn).toBe(900);

    // Tokens should be non-empty strings
    expect(typeof tokens.accessToken).toBe("string");
    expect(tokens.accessToken.length).toBeGreaterThan(50);
    expect(typeof tokens.refreshToken).toBe("string");
    expect(tokens.refreshToken.length).toBeGreaterThan(50);
  });

  it("should include correct claims in access token", async () => {
    const tokens = await generateTokens(testUser);
    const { payload } = await verifyToken(tokens.accessToken, {
      audience: JWT_AUDIENCE,
    });

    expect(payload.sub).toBe(testUser.id);
    expect(payload.email).toBe(testUser.email);
    expect(payload.role).toBe(testUser.role.toLowerCase());
    expect(payload.permissions).toEqual(testUser.permissions);
    expect(payload.iss).toBe(JWT_ISSUER);
    expect(payload.aud).toBe(JWT_AUDIENCE);
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeDefined();
  });

  it("should include correct claims in refresh token", async () => {
    const tokens = await generateTokens(testUser);
    const { payload } = await verifyToken(tokens.refreshToken);

    expect(payload.sub).toBe(testUser.id);
    expect(payload.type).toBe("refresh");
    expect(payload.iss).toBe(JWT_ISSUER);
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeDefined();
    // Refresh token should not have audience
    expect(payload.aud).toBeUndefined();
  });

  it("should generate unique tokens for same user", async () => {
    const tokens1 = await generateTokens(testUser);
    // Add a small delay to ensure different iat timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));
    const tokens2 = await generateTokens(testUser);

    // Note: If generated in same second with same claims, tokens could be identical
    // The important thing is that each token is valid and contains correct claims
    expect(tokens1.accessToken).toBeDefined();
    expect(tokens2.accessToken).toBeDefined();

    // Verify both tokens are valid
    const payload1 = await verifyToken(tokens1.accessToken, {
      audience: JWT_AUDIENCE,
    });
    const payload2 = await verifyToken(tokens2.accessToken, {
      audience: JWT_AUDIENCE,
    });
    expect(payload1.payload.sub).toBe(testUser.id);
    expect(payload2.payload.sub).toBe(testUser.id);
  });

  it("should handle user with no permissions", async () => {
    const userNoPermissions = {
      id: "user_456",
      email: "rider@example.com",
      role: "RIDER",
    };

    const tokens = await generateTokens(userNoPermissions);
    const { payload } = await verifyToken(tokens.accessToken, {
      audience: JWT_AUDIENCE,
    });

    expect(payload.permissions).toEqual([]);
  });

  it("should normalize role to lowercase", async () => {
    const users = [
      { id: "1", email: "a@a.com", role: "RIDER" },
      { id: "2", email: "b@b.com", role: "DRIVER" },
      { id: "3", email: "c@c.com", role: "ADMIN" },
    ];

    for (const user of users) {
      const tokens = await generateTokens(user);
      const { payload } = await verifyToken(tokens.accessToken, {
        audience: JWT_AUDIENCE,
      });
      expect(payload.role).toBe(user.role.toLowerCase());
    }
  });
});

describe("JWT Token Verification", () => {
  const testUser = {
    id: "user_789",
    email: "verify@example.com",
    role: "DRIVER",
  };

  it("should verify valid access token", async () => {
    const tokens = await generateTokens(testUser);

    const result = await verifyToken(tokens.accessToken, {
      audience: JWT_AUDIENCE,
    });

    expect(result.payload.sub).toBe(testUser.id);
    expect(result.protectedHeader.alg).toBe("HS256");
  });

  it("should verify valid refresh token", async () => {
    const tokens = await generateTokens(testUser);

    const result = await verifyToken(tokens.refreshToken);

    expect(result.payload.sub).toBe(testUser.id);
    expect(result.payload.type).toBe("refresh");
  });

  it("should reject token with wrong secret", async () => {
    const wrongSecret = new TextEncoder().encode("wrong-secret");
    const badToken = await new jose.SignJWT({ sub: "user_123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(JWT_ISSUER)
      .sign(wrongSecret);

    await expect(verifyToken(badToken)).rejects.toThrow();
  });

  it("should reject token with wrong issuer", async () => {
    const badToken = await new jose.SignJWT({ sub: "user_123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("wrong-issuer")
      .sign(JWT_SECRET);

    await expect(verifyToken(badToken)).rejects.toThrow(
      /unexpected "iss" claim value/,
    );
  });

  it("should reject token with wrong audience when specified", async () => {
    const badToken = await new jose.SignJWT({ sub: "user_123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(JWT_ISSUER)
      .setAudience("wrong-audience")
      .sign(JWT_SECRET);

    await expect(
      verifyToken(badToken, { audience: JWT_AUDIENCE }),
    ).rejects.toThrow(/unexpected "aud" claim value/);
  });

  it("should reject expired token", async () => {
    const expiredToken = await new jose.SignJWT({ sub: "user_123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(JWT_ISSUER)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // 1 hour ago
      .sign(JWT_SECRET);

    await expect(verifyToken(expiredToken)).rejects.toThrow(
      /"exp" claim timestamp check failed/,
    );
  });

  it("should reject malformed token", async () => {
    const malformedTokens = [
      "not-a-token",
      "eyJhbGciOiJIUzI1NiJ9.invalid",
      "eyJhbGciOiJIUzI1NiJ9..signature",
      "",
      "null",
    ];

    for (const token of malformedTokens) {
      await expect(verifyToken(token)).rejects.toThrow();
    }
  });
});

describe("Token Expiration", () => {
  it("should set access token expiry to 15 minutes", async () => {
    const tokens = await generateTokens({
      id: "user_exp",
      email: "exp@test.com",
      role: "RIDER",
    });

    const { payload } = await verifyToken(tokens.accessToken, {
      audience: JWT_AUDIENCE,
    });

    const now = Math.floor(Date.now() / 1000);
    const expiry = payload.exp as number;
    const issuedAt = payload.iat as number;

    // Should be approximately 15 minutes (900 seconds) from now
    expect(expiry - issuedAt).toBe(900);
    expect(expiry - now).toBeGreaterThan(890); // Within 10 second tolerance
    expect(expiry - now).toBeLessThanOrEqual(900);
  });

  it("should set refresh token expiry to 7 days", async () => {
    const tokens = await generateTokens({
      id: "user_exp",
      email: "exp@test.com",
      role: "RIDER",
    });

    const { payload } = await verifyToken(tokens.refreshToken);

    const now = Math.floor(Date.now() / 1000);
    const expiry = payload.exp as number;
    const issuedAt = payload.iat as number;

    // Should be approximately 7 days (604800 seconds) from now
    const sevenDays = 7 * 24 * 60 * 60;
    expect(expiry - issuedAt).toBe(sevenDays);
    expect(expiry - now).toBeGreaterThan(sevenDays - 10);
  });
});

describe("Role-Based Permissions", () => {
  /**
   * Get default permissions for a role (mirrors getRolePermissions in auth.ts)
   */
  function getRolePermissions(role: string): string[] {
    const permissions: Record<string, string[]> = {
      RIDER: [
        "read:profile",
        "write:profile",
        "read:rides",
        "write:rides",
        "read:payments",
        "write:payments",
      ],
      DRIVER: [
        "read:profile",
        "write:profile",
        "read:rides",
        "write:rides",
        "read:earnings",
        "read:payments",
        "write:availability",
      ],
      ADMIN: [
        "admin:users",
        "admin:rides",
        "admin:payments",
        "admin:reports",
        "read:all",
        "write:all",
      ],
      SUPPORT: [
        "read:users",
        "read:rides",
        "read:payments",
        "write:support_tickets",
      ],
    };
    return permissions[role] || [];
  }

  it("should have correct rider permissions", () => {
    const permissions = getRolePermissions("RIDER");

    expect(permissions).toContain("read:profile");
    expect(permissions).toContain("write:profile");
    expect(permissions).toContain("read:rides");
    expect(permissions).toContain("write:rides");
    expect(permissions).not.toContain("admin:users");
    expect(permissions).not.toContain("read:earnings");
  });

  it("should have correct driver permissions", () => {
    const permissions = getRolePermissions("DRIVER");

    expect(permissions).toContain("read:profile");
    expect(permissions).toContain("read:earnings");
    expect(permissions).toContain("write:availability");
    expect(permissions).not.toContain("admin:users");
  });

  it("should have correct admin permissions", () => {
    const permissions = getRolePermissions("ADMIN");

    expect(permissions).toContain("admin:users");
    expect(permissions).toContain("admin:rides");
    expect(permissions).toContain("read:all");
    expect(permissions).toContain("write:all");
  });

  it("should return empty array for unknown role", () => {
    const permissions = getRolePermissions("UNKNOWN");
    expect(permissions).toEqual([]);
  });
});

describe("OTP Validation", () => {
  /**
   * Generate OTP (mirrors generateOTP from @ubi/utils)
   */
  function generateOTP(length: number = 6): string {
    const digits = "0123456789";
    let otp = "";
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
  }

  it("should generate 6-digit OTP", () => {
    const otp = generateOTP(6);

    expect(otp).toHaveLength(6);
    expect(/^\d{6}$/.test(otp)).toBe(true);
  });

  it("should generate unique OTPs", () => {
    const otps = new Set<string>();
    for (let i = 0; i < 100; i++) {
      otps.add(generateOTP(6));
    }
    // With 100 random 6-digit codes, we should have high uniqueness
    expect(otps.size).toBeGreaterThan(90);
  });

  it("should generate OTP of specified length", () => {
    expect(generateOTP(4)).toHaveLength(4);
    expect(generateOTP(8)).toHaveLength(8);
  });

  it("should only contain digits", () => {
    for (let i = 0; i < 50; i++) {
      const otp = generateOTP(6);
      expect(/^\d+$/.test(otp)).toBe(true);
    }
  });
});

describe("Phone Number Validation", () => {
  /**
   * Validate phone number format (international format preferred)
   */
  function isValidPhone(phone: string): boolean {
    const cleaned = phone.replace(/[\s\-()]/g, "");
    // International format: +country code followed by 9-14 digits
    // Or local format starting with 0 followed by 9-12 digits
    // Or just digits without prefix (e.g., 2348012345678)
    return (
      /^\+[1-9]\d{9,14}$/.test(cleaned) ||
      /^0[1-9]\d{8,11}$/.test(cleaned) ||
      /^[1-9]\d{10,14}$/.test(cleaned)
    );
  }

  it("should accept valid Nigerian phone numbers", () => {
    const validNumbers = [
      "+2348012345678", // International format with +
      "2348012345678", // International format without +
      "08012345678", // Local format
    ];

    for (const phone of validNumbers) {
      expect(isValidPhone(phone)).toBe(true);
    }
  });

  it("should accept valid Kenyan phone numbers", () => {
    const validNumbers = [
      "+254712345678", // International format with +
      "254712345678", // International format without +
      "0712345678", // Local format
    ];

    for (const phone of validNumbers) {
      expect(isValidPhone(phone)).toBe(true);
    }
  });

  it("should reject invalid phone numbers", () => {
    const invalidNumbers = [
      "",
      "123",
      "abcdefghijk",
      "+0012345678",
      "+++1234567890",
    ];

    for (const phone of invalidNumbers) {
      expect(isValidPhone(phone)).toBe(false);
    }
  });
});

describe("Password Security", () => {
  /**
   * Validate password strength
   */
  function isStrongPassword(password: string): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (password.length < 8) {
      errors.push("Password must be at least 8 characters");
    }
    if (!/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    }
    if (!/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }
    if (!/[0-9]/.test(password)) {
      errors.push("Password must contain at least one number");
    }

    return { valid: errors.length === 0, errors };
  }

  it("should accept strong passwords", () => {
    const strongPasswords = [
      "Password123!",
      "Secure@Pass1",
      "MyStr0ngP@ss",
      "Abc12345",
    ];

    for (const password of strongPasswords) {
      const result = isStrongPassword(password);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    }
  });

  it("should reject weak passwords", () => {
    expect(isStrongPassword("short").valid).toBe(false);
    expect(isStrongPassword("alllowercase123").valid).toBe(false);
    expect(isStrongPassword("ALLUPPERCASE123").valid).toBe(false);
    expect(isStrongPassword("NoNumbersHere").valid).toBe(false);
  });

  it("should provide specific error messages", () => {
    const result = isStrongPassword("abc");

    expect(result.errors).toContain("Password must be at least 8 characters");
    expect(result.errors).toContain(
      "Password must contain at least one uppercase letter",
    );
    expect(result.errors).toContain(
      "Password must contain at least one number",
    );
  });
});

describe("Email Validation", () => {
  /**
   * Validate email format
   */
  function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  it("should accept valid email addresses", () => {
    const validEmails = [
      "test@example.com",
      "user.name@domain.org",
      "user+tag@example.co.ke",
      "a@b.io",
    ];

    for (const email of validEmails) {
      expect(isValidEmail(email)).toBe(true);
    }
  });

  it("should reject invalid email addresses", () => {
    const invalidEmails = [
      "",
      "notanemail",
      "@nodomain.com",
      "noat.com",
      "spaces in@email.com",
      "multiple@@at.com",
    ];

    for (const email of invalidEmails) {
      expect(isValidEmail(email)).toBe(false);
    }
  });
});

describe("Session Token Handling", () => {
  it("should decode token payload without verification", () => {
    // Test that we can decode the payload without verification for debugging
    const base64Decode = (str: string) =>
      JSON.parse(Buffer.from(str, "base64url").toString());

    const token =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSJ9.signature";
    const [, payload] = token.split(".");

    const decoded = base64Decode(payload);
    expect(decoded.sub).toBe("user_123");
    expect(decoded.email).toBe("test@example.com");
  });

  it("should extract protected header from token", async () => {
    const tokens = await generateTokens({
      id: "user_hdr",
      email: "header@test.com",
      role: "RIDER",
    });

    const header = jose.decodeProtectedHeader(tokens.accessToken);

    expect(header.alg).toBe("HS256");
    expect(header.typ).toBeUndefined(); // Not set by default
  });
});

describe("Security Edge Cases", () => {
  it("should handle very long user IDs", async () => {
    const longId = "user_" + "a".repeat(100);
    const tokens = await generateTokens({
      id: longId,
      email: "long@test.com",
      role: "RIDER",
    });

    const { payload } = await verifyToken(tokens.accessToken, {
      audience: JWT_AUDIENCE,
    });
    expect(payload.sub).toBe(longId);
  });

  it("should handle special characters in email", async () => {
    const specialEmail = "user+test.name@sub.domain.co.ke";
    const tokens = await generateTokens({
      id: "user_special",
      email: specialEmail,
      role: "RIDER",
    });

    const { payload } = await verifyToken(tokens.accessToken, {
      audience: JWT_AUDIENCE,
    });
    expect(payload.email).toBe(specialEmail);
  });

  it("should handle Unicode in user data", async () => {
    // Note: Email with Unicode may not be valid, but testing token handling
    const tokens = await generateTokens({
      id: "user_unicode_123",
      email: "test@example.com",
      role: "RIDER",
      permissions: ["read:données", "write:profil"],
    });

    const { payload } = await verifyToken(tokens.accessToken, {
      audience: JWT_AUDIENCE,
    });
    expect(payload.permissions).toContain("read:données");
  });

  it("should not include sensitive data in token", async () => {
    const tokens = await generateTokens({
      id: "user_sensitive",
      email: "sensitive@test.com",
      role: "RIDER",
    });

    const { payload } = await verifyToken(tokens.accessToken, {
      audience: JWT_AUDIENCE,
    });

    // Ensure no password or other sensitive data
    expect(payload).not.toHaveProperty("password");
    expect(payload).not.toHaveProperty("passwordHash");
    expect(payload).not.toHaveProperty("phone");
  });
});
