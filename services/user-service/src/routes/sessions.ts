/**
 * Session Routes
 *
 * Handles user session management.
 */

import { ErrorCodes, UbiError } from "@ubi/utils";
import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

const sessionRoutes = new Hono();

/**
 * GET /sessions
 * Get all active sessions for current user
 */
sessionRoutes.get("/", async (c) => {
  const userId = c.req.header("x-auth-user-id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const sessions = await prisma.session.findMany({
    where: {
      userId,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      deviceType: true,
      deviceId: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return c.json({
    success: true,
    data: { sessions },
  });
});

/**
 * DELETE /sessions/:id
 * Revoke a specific session
 */
sessionRoutes.delete("/:id", async (c) => {
  const userId = c.req.header("x-auth-user-id");
  const sessionId = c.req.param("id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  // Verify session belongs to user
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      userId,
    },
  });

  if (!session) {
    throw new UbiError(ErrorCodes.NOT_FOUND, "Session not found");
  }

  // Delete session
  await prisma.session.delete({
    where: { id: sessionId },
  });

  // Clear from Redis
  await redis.del(`session:${sessionId}`);

  return c.json({
    success: true,
    data: { message: "Session revoked" },
  });
});

/**
 * DELETE /sessions
 * Revoke all sessions except current
 */
sessionRoutes.delete("/", async (c) => {
  const userId = c.req.header("x-auth-user-id");
  const currentSessionId = c.req.query("exceptCurrent");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  // Get all sessions to clear from Redis
  const sessions = await prisma.session.findMany({
    where: {
      userId,
      ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
    },
    select: { id: true },
  });

  // Delete from database
  await prisma.session.deleteMany({
    where: {
      userId,
      ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
    },
  });

  // Clear from Redis
  for (const session of sessions) {
    await redis.del(`session:${session.id}`);
  }

  return c.json({
    success: true,
    data: {
      message: "Sessions revoked",
      count: sessions.length,
    },
  });
});

export { sessionRoutes };
