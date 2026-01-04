/**
 * Authentication Routes
 *
 * Handles user registration, login, OTP verification, and token management.
 */

import {
  ErrorCodes,
  generateOTP,
  generateReferralCode,
  UbiError,
} from "@ubi/utils";
import bcrypt from "bcrypt";
import { Hono } from "hono";
import * as jose from "jose";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

const authRoutes = new Hono();

// ===========================================
// Validation Schemas
// ===========================================

const registerSchema = z.object({
  phone: z.string().min(10).max(15),
  email: z.string().email().optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  country: z.string().length(2),
  language: z.string().default("en"),
  role: z.enum(["RIDER", "DRIVER"]).default("RIDER"),
  referralCode: z.string().optional(),
});

const loginOTPSchema = z.object({
  phone: z.string().min(10).max(15),
});

const verifyOTPSchema = z.object({
  phone: z.string().min(10).max(15),
  code: z.string().length(6),
});

const loginCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
});

const confirmResetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8),
});

// ===========================================
// JWT Configuration
// ===========================================

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "ubi-dev-secret-change-in-prod"
);
const JWT_ISSUER = "ubi.africa";
const JWT_AUDIENCE = "ubi-api";
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";

/**
 * Generate JWT tokens for a user
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
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .setIssuedAt()
    .sign(JWT_SECRET);

  const refreshToken = await new jose.SignJWT({
    sub: user.id,
    type: "refresh",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .setIssuedAt()
    .sign(JWT_SECRET);

  return {
    accessToken,
    refreshToken,
    expiresIn: 900, // 15 minutes in seconds
  };
}

// ===========================================
// Routes
// ===========================================

/**
 * POST /auth/register
 * Register a new user
 */
authRoutes.post("/register", async (c) => {
  const body = await c.req.json();
  const data = registerSchema.parse(body);

  // Check if phone already exists
  const existingUser = await prisma.user.findUnique({
    where: { phone: data.phone },
  });

  if (existingUser) {
    throw new UbiError(
      ErrorCodes.DUPLICATE_ENTRY,
      "A user with this phone number already exists"
    );
  }

  // Check if email already exists (if provided)
  if (data.email) {
    const existingEmail = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingEmail) {
      throw new UbiError(
        ErrorCodes.DUPLICATE_ENTRY,
        "A user with this email already exists"
      );
    }
  }

  // Generate referral code for the user
  const referralCode = generateReferralCode();

  // Find referrer if referral code provided
  let referredBy: string | undefined;
  if (data.referralCode) {
    const referrer = await prisma.rider.findUnique({
      where: { referralCode: data.referralCode },
    });
    if (referrer) {
      referredBy = referrer.id;
    }
  }

  // Create user
  const user = await prisma.user.create({
    data: {
      phone: data.phone,
      email: data.email || `${data.phone}@placeholder.ubi.africa`,
      passwordHash: "", // Will be set when they add a password
      firstName: data.firstName,
      lastName: data.lastName,
      country: data.country,
      language: data.language,
      role: data.role,
      status: "PENDING", // Requires OTP verification
      rider:
        data.role === "RIDER"
          ? {
              create: {
                referralCode,
                referredBy,
              },
            }
          : undefined,
    },
    select: {
      id: true,
      phone: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      country: true,
      language: true,
      createdAt: true,
    },
  });

  // Generate and send OTP
  const otp = generateOTP(6);
  await redis.setex(`otp:${data.phone}`, 300, otp); // 5 minute expiry

  // NOTE: SMS integration pending - notification-service will handle this
  console.log(`[DEV] OTP for ${data.phone}: ${otp}`);

  return c.json({
    success: true,
    data: {
      user,
      message:
        "Registration successful. Please verify your phone number with the OTP sent.",
    },
  });
});

/**
 * POST /auth/login/otp
 * Request OTP for phone login
 */
authRoutes.post("/login/otp", async (c) => {
  const body = await c.req.json();
  const { phone } = loginOTPSchema.parse(body);

  // Check if user exists
  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, status: true },
  });

  if (!user) {
    // Don't reveal if user exists or not for security
    // But still "send" OTP to prevent enumeration
  }

  if (user?.status === "SUSPENDED") {
    throw new UbiError(
      ErrorCodes.ACCOUNT_SUSPENDED,
      "Your account has been suspended"
    );
  }

  // Generate and store OTP
  const otp = generateOTP(6);
  await redis.setex(`otp:${phone}`, 300, otp); // 5 minute expiry

  // Rate limit OTP requests
  const otpCount = await redis.incr(`otp_count:${phone}`);
  if (otpCount === 1) {
    await redis.expire(`otp_count:${phone}`, 3600); // Reset after 1 hour
  }
  if (otpCount > 5) {
    throw new UbiError(
      ErrorCodes.RATE_LIMIT_EXCEEDED,
      "Too many OTP requests. Please try again later."
    );
  }

  // NOTE: SMS integration pending - notification-service will handle this
  console.log(`[DEV] OTP for ${phone}: ${otp}`);

  return c.json({
    success: true,
    data: {
      message: "OTP sent successfully",
      expiresIn: 300,
    },
  });
});

/**
 * POST /auth/verify-otp
 * Verify OTP and login/complete registration
 */
authRoutes.post("/verify-otp", async (c) => {
  const body = await c.req.json();
  const { phone, code } = verifyOTPSchema.parse(body);

  // Get stored OTP
  const storedOTP = await redis.get(`otp:${phone}`);

  if (!storedOTP) {
    throw new UbiError(
      ErrorCodes.OTP_EXPIRED,
      "OTP has expired. Please request a new one."
    );
  }

  if (storedOTP !== code) {
    // Track failed attempts
    const attempts = await redis.incr(`otp_attempts:${phone}`);
    if (attempts >= 5) {
      await redis.del(`otp:${phone}`);
      throw new UbiError(
        ErrorCodes.OTP_INVALID,
        "Too many failed attempts. Please request a new OTP."
      );
    }
    await redis.expire(`otp_attempts:${phone}`, 300);

    throw new UbiError(ErrorCodes.OTP_INVALID, "Invalid OTP code");
  }

  // Clear OTP and attempts
  await redis.del(`otp:${phone}`);
  await redis.del(`otp_attempts:${phone}`);
  await redis.del(`otp_count:${phone}`);

  // Get or create user
  let user = await prisma.user.findUnique({
    where: { phone },
    include: {
      rider: true,
      driver: true,
    },
  });

  if (!user) {
    throw new UbiError(
      ErrorCodes.USER_NOT_FOUND,
      "User not found. Please register first."
    );
  }

  // Update user status if pending
  if (user.status === "PENDING") {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        status: "ACTIVE",
        phoneVerified: true,
      },
      include: {
        rider: true,
        driver: true,
      },
    });
  }

  // Generate tokens
  const tokens = await generateTokens({
    id: user.id,
    email: user.email,
    role: user.role,
    permissions: getRolePermissions(user.role),
  });

  // Create session
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      token: tokens.refreshToken,
      deviceType: c.req.header("x-device-type"),
      deviceId: c.req.header("x-device-id"),
      ipAddress:
        c.req.header("x-forwarded-for")?.split(",")[0] ||
        c.req.header("x-real-ip"),
      userAgent: c.req.header("user-agent"),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  // Store session in Redis for quick lookup
  await redis.setex(
    `session:${session.id}`,
    7 * 24 * 60 * 60,
    JSON.stringify({ userId: user.id, role: user.role })
  );

  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
        avatarUrl: user.avatarUrl,
        rider: user.rider,
        driver: user.driver,
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
    },
  });
});

/**
 * POST /auth/login
 * Login with email and password
 */
authRoutes.post("/login", async (c) => {
  const body = await c.req.json();
  const { email, password } = loginCredentialsSchema.parse(body);

  // Find user
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      rider: true,
      driver: true,
    },
  });

  if (!user?.passwordHash) {
    throw new UbiError(
      ErrorCodes.INVALID_CREDENTIALS,
      "Invalid email or password"
    );
  }

  if (user.status === "SUSPENDED") {
    throw new UbiError(
      ErrorCodes.ACCOUNT_SUSPENDED,
      "Your account has been suspended"
    );
  }

  // Verify password
  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    throw new UbiError(
      ErrorCodes.INVALID_CREDENTIALS,
      "Invalid email or password"
    );
  }

  // Generate tokens
  const tokens = await generateTokens({
    id: user.id,
    email: user.email,
    role: user.role,
    permissions: getRolePermissions(user.role),
  });

  // Create session
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      token: tokens.refreshToken,
      deviceType: c.req.header("x-device-type"),
      deviceId: c.req.header("x-device-id"),
      ipAddress:
        c.req.header("x-forwarded-for")?.split(",")[0] ||
        c.req.header("x-real-ip"),
      userAgent: c.req.header("user-agent"),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  await redis.setex(
    `session:${session.id}`,
    7 * 24 * 60 * 60,
    JSON.stringify({ userId: user.id, role: user.role })
  );

  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
        avatarUrl: user.avatarUrl,
        rider: user.rider,
        driver: user.driver,
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
    },
  });
});

/**
 * POST /auth/refresh
 * Refresh access token
 */
authRoutes.post("/refresh", async (c) => {
  const body = await c.req.json();
  const { refreshToken } = refreshTokenSchema.parse(body);

  try {
    // Verify refresh token
    const { payload } = await jose.jwtVerify(refreshToken, JWT_SECRET, {
      issuer: JWT_ISSUER,
    });

    if (payload.type !== "refresh") {
      throw new Error("Invalid token type");
    }

    // Check if session exists
    const session = await prisma.session.findFirst({
      where: {
        token: refreshToken,
        userId: payload.sub,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: true,
      },
    });

    if (!session) {
      throw new UbiError(
        ErrorCodes.SESSION_EXPIRED,
        "Session expired. Please login again."
      );
    }

    // Generate new tokens
    const tokens = await generateTokens({
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
      permissions: getRolePermissions(session.user.role),
    });

    // Update session with new refresh token
    await prisma.session.update({
      where: { id: session.id },
      data: {
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return c.json({
      success: true,
      data: {
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
        },
      },
    });
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      throw new UbiError(
        ErrorCodes.TOKEN_EXPIRED,
        "Refresh token expired. Please login again."
      );
    }
    throw new UbiError(ErrorCodes.INVALID_TOKEN, "Invalid refresh token");
  }
});

/**
 * POST /auth/logout
 * Logout and invalidate session
 */
authRoutes.post("/logout", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ success: true, data: { message: "Logged out" } });
  }

  try {
    const token = authHeader.substring(7);
    const { payload } = await jose.jwtVerify(token, JWT_SECRET);

    // Delete all sessions for this user (optional: just current session)
    await prisma.session.deleteMany({
      where: { userId: payload.sub },
    });

    // Clear Redis cache
    const sessions = await redis.keys(`session:*`);
    for (const session of sessions) {
      const data = await redis.get(session);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.userId === payload.sub) {
          await redis.del(session);
        }
      }
    }
  } catch {
    // Ignore errors, logout anyway
  }

  return c.json({
    success: true,
    data: { message: "Logged out successfully" },
  });
});

/**
 * POST /auth/forgot-password
 * Request password reset
 */
authRoutes.post("/forgot-password", async (c) => {
  const body = await c.req.json();
  const { email } = resetPasswordSchema.parse(body);

  // Always return success to prevent email enumeration
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (user) {
    // Generate reset token
    const resetToken = crypto.randomUUID();
    await redis.setex(`password_reset:${resetToken}`, 3600, user.id); // 1 hour expiry

    // NOTE: Email integration pending - notification-service will handle this
    console.log(
      `[DEV] Password reset link: https://app.ubi.africa/reset-password?token=${resetToken}`
    );
  }

  return c.json({
    success: true,
    data: {
      message:
        "If an account exists with this email, a password reset link will be sent.",
    },
  });
});

/**
 * POST /auth/reset-password
 * Reset password with token
 */
authRoutes.post("/reset-password", async (c) => {
  const body = await c.req.json();
  const { token, password } = confirmResetPasswordSchema.parse(body);

  // Get user ID from token
  const userId = await redis.get(`password_reset:${token}`);
  if (!userId) {
    throw new UbiError(
      ErrorCodes.INVALID_TOKEN,
      "Invalid or expired reset token"
    );
  }

  // Hash new password
  const passwordHash = await bcrypt.hash(password, 12);

  // Update password
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  // Invalidate reset token
  await redis.del(`password_reset:${token}`);

  // Invalidate all sessions
  await prisma.session.deleteMany({
    where: { userId },
  });

  return c.json({
    success: true,
    data: {
      message:
        "Password reset successfully. Please login with your new password.",
    },
  });
});

// ===========================================
// Helper Functions
// ===========================================

/**
 * Get permissions for a role
 */
function getRolePermissions(role: string): string[] {
  const permissions: Record<string, string[]> = {
    RIDER: [
      "ride:create",
      "ride:read",
      "ride:cancel",
      "order:create",
      "order:read",
      "delivery:create",
      "delivery:read",
    ],
    DRIVER: [
      "ride:accept",
      "ride:read",
      "ride:update",
      "delivery:accept",
      "delivery:update",
      "earnings:read",
    ],
    RESTAURANT: ["menu:manage", "order:manage", "earnings:read"],
    MERCHANT: ["delivery:create", "delivery:read", "delivery:manage"],
    FLEET_MANAGER: ["driver:manage", "vehicle:manage", "analytics:read"],
    ADMIN: [
      "*:read",
      "user:manage",
      "driver:manage",
      "order:manage",
      "payment:manage",
    ],
    SUPER_ADMIN: ["*"],
  };

  return permissions[role] || [];
}

export { authRoutes };
