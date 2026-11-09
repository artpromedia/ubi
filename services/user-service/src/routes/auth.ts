/**
 * Legacy Authentication & Password-Reset Routes
 *
 * Sign-up, OTP verification, device enrolment, session refresh, and logout now
 * live in `src/routes/identity.ts` (CC-B00). Legacy `/register`, `/login/otp`,
 * `/verify-otp`, and `/login` return `410 legacy_auth_retired` for one release
 * so older app builds surface an explicit upgrade message instead of minting
 * cityless or deviceless tokens.
 */

import bcrypt from "bcrypt";
import { Hono } from "hono";
import { z } from "zod";

import { ContractError } from "@ubi/contracts";
import { ErrorCodes, UbiError } from "@ubi/utils";

import { authLogger } from "../lib/logger.js";
import { notificationClient } from "../lib/notification-client.js";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

const authRoutes = new Hono();

const resetPasswordSchema = z.object({
  email: z.string().email(),
});

const confirmResetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8),
});

const RETIRED_AUTH_MESSAGE =
  "This sign-in endpoint has been retired. Please update the app or use /v1/auth/signup, /v1/auth/otp, and /v1/auth/verify.";

/**
 * POST /auth/register — retired in favour of POST /auth/signup (CC-B00).
 */
authRoutes.post("/register", () => {
  throw new ContractError("legacy_auth_retired", RETIRED_AUTH_MESSAGE, {
    replacement: "/v1/auth/signup",
  });
});

/**
 * POST /auth/login/otp — retired in favour of POST /auth/otp (CC-B00).
 */
authRoutes.post("/login/otp", () => {
  throw new ContractError("legacy_auth_retired", RETIRED_AUTH_MESSAGE, {
    replacement: "/v1/auth/otp",
  });
});

/**
 * POST /auth/verify-otp — retired in favour of POST /auth/verify (CC-B00).
 */
authRoutes.post("/verify-otp", () => {
  throw new ContractError("legacy_auth_retired", RETIRED_AUTH_MESSAGE, {
    replacement: "/v1/auth/verify",
  });
});

/**
 * POST /auth/login — retired because password-only login minted tokens without
 * device enrolment or city verification (CC-B00).
 */
authRoutes.post("/login", () => {
  throw new ContractError("legacy_auth_retired", RETIRED_AUTH_MESSAGE, {
    replacement: "/v1/auth/otp",
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

    // Send password reset email via notification service
    const resetUrl = `${process.env.APP_URL || "https://app.ubi.africa"}/reset-password?token=${resetToken}`;
    try {
      await notificationClient.sendEmail({
        userId: user.id,
        email: user.email,
        subject: "Reset your UBI password",
        body: `
Hello ${user.firstName},

You requested to reset your password. Click the link below to set a new password:

${resetUrl}

This link expires in 1 hour. If you didn't request this, please ignore this email.

- The UBI Team
        `.trim(),
      });
      authLogger.info(
        { userId: user.id },
        "Password reset email sent successfully",
      );
    } catch (error) {
      authLogger.warn(
        {
          userId: user.id,
          err: error instanceof Error ? error.message : "send_failed",
        },
        "Failed to send password reset email via notification service",
      );
    }
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
      "Invalid or expired reset token",
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

export { authRoutes };
