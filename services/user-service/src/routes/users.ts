/**
 * User Routes
 *
 * Handles user profile management and queries.
 */

import { Hono } from "hono";
import { z } from "zod";

import { ErrorCodes, UbiError } from "@ubi/utils";

import { prisma } from "../lib/prisma";

const userRoutes = new Hono();

// ===========================================
// Validation Schemas
// ===========================================

const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  language: z.string().max(5).optional(),
  avatarUrl: z.string().url().optional(),
});

// NOTE: updatePreferencesSchema will be used for preferences endpoint
// const updatePreferencesSchema = z.object({
//   defaultPayment: z.enum(["CASH", "CARD", "WALLET", "MPESA", "MTN_MOMO", "AIRTEL_MONEY"]).optional(),
//   notifications: z.object({
//     push: z.boolean().optional(),
//     sms: z.boolean().optional(),
//     email: z.boolean().optional(),
//     whatsapp: z.boolean().optional(),
//   }).optional(),
// });

const savedPlaceSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  placeId: z.string().optional(),
  type: z.enum(["home", "work", "other"]).default("other"),
});

// ===========================================
// Routes
// ===========================================

/**
 * GET /users/me
 * Get current user profile
 */
userRoutes.get("/me", async (c) => {
  const userId = c.req.header("x-auth-user-id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      rider: {
        include: {
          savedPlaces: true,
        },
      },
      driver: {
        include: {
          vehicle: true,
        },
      },
      walletAccounts: true,
    },
  });

  if (!user) {
    throw new UbiError(ErrorCodes.USER_NOT_FOUND, "User not found");
  }

  // Remove sensitive fields
  const { passwordHash: _passwordHash, ...safeUser } = user;

  return c.json({
    success: true,
    data: { user: safeUser },
  });
});

/**
 * PATCH /users/me
 * Update current user profile
 */
userRoutes.patch("/me", async (c) => {
  const userId = c.req.header("x-auth-user-id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const body = await c.req.json();
  const data = updateProfileSchema.parse(body);

  // Check email uniqueness if updating
  if (data.email) {
    const existingEmail = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingEmail && existingEmail.id !== userId) {
      throw new UbiError(ErrorCodes.DUPLICATE_ENTRY, "Email already in use");
    }
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...data,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      phone: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      avatarUrl: true,
      language: true,
      country: true,
      updatedAt: true,
    },
  });

  return c.json({
    success: true,
    data: { user },
  });
});

/**
 * DELETE /users/me
 * Deactivate current user account
 */
userRoutes.delete("/me", async (c) => {
  const userId = c.req.header("x-auth-user-id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  // Soft delete - set deletedAt and status
  await prisma.user.update({
    where: { id: userId },
    data: {
      status: "DEACTIVATED",
      deletedAt: new Date(),
    },
  });

  // Invalidate all sessions
  await prisma.session.deleteMany({
    where: { userId },
  });

  return c.json({
    success: true,
    data: { message: "Account deactivated successfully" },
  });
});

/**
 * GET /users/:id
 * Get user by ID (admin only)
 */
userRoutes.get("/:id", async (c) => {
  const userRole = c.req.header("x-auth-user-role");
  const targetUserId = c.req.param("id");

  // Only admins can view other users
  if (userRole !== "admin" && userRole !== "super_admin") {
    throw new UbiError(ErrorCodes.FORBIDDEN, "Admin access required");
  }

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: {
      rider: true,
      driver: {
        include: { vehicle: true },
      },
      walletAccounts: true,
    },
  });

  if (!user) {
    throw new UbiError(ErrorCodes.USER_NOT_FOUND, "User not found");
  }

  const { passwordHash: _passwordHash, ...safeUser } = user;

  return c.json({
    success: true,
    data: { user: safeUser },
  });
});

/**
 * GET /users
 * List users (admin only)
 */
userRoutes.get("/", async (c) => {
  const userRole = c.req.header("x-auth-user-role");

  if (userRole !== "admin" && userRole !== "super_admin") {
    throw new UbiError(ErrorCodes.FORBIDDEN, "Admin access required");
  }

  const page = Number.parseInt(c.req.query("page") || "1");
  const limit = Math.min(Number.parseInt(c.req.query("limit") || "20"), 100);
  const role = c.req.query("role");
  const status = c.req.query("status");
  const search = c.req.query("search");

  const where: Record<string, unknown> = {};

  if (role) {
    where.role = role;
  }
  if (status) {
    where.status = status;
  }
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        phone: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        country: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  return c.json({
    success: true,
    data: {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

// ===========================================
// Rider-specific routes
// ===========================================

/**
 * GET /users/me/saved-places
 * Get saved places for current rider
 */
userRoutes.get("/me/saved-places", async (c) => {
  const userId = c.req.header("x-auth-user-id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const rider = await prisma.rider.findUnique({
    where: { userId },
    include: { savedPlaces: true },
  });

  if (!rider) {
    throw new UbiError(ErrorCodes.NOT_FOUND, "Rider profile not found");
  }

  return c.json({
    success: true,
    data: { places: rider.savedPlaces },
  });
});

/**
 * POST /users/me/saved-places
 * Add a saved place
 */
userRoutes.post("/me/saved-places", async (c) => {
  const userId = c.req.header("x-auth-user-id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const body = await c.req.json();
  const data = savedPlaceSchema.parse(body);

  const rider = await prisma.rider.findUnique({
    where: { userId },
  });

  if (!rider) {
    throw new UbiError(ErrorCodes.NOT_FOUND, "Rider profile not found");
  }

  const place = await prisma.savedPlace.create({
    data: {
      riderId: rider.id,
      ...data,
    },
  });

  return c.json({
    success: true,
    data: { place },
  });
});

/**
 * DELETE /users/me/saved-places/:id
 * Delete a saved place
 */
userRoutes.delete("/me/saved-places/:id", async (c) => {
  const userId = c.req.header("x-auth-user-id");
  const placeId = c.req.param("id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const rider = await prisma.rider.findUnique({
    where: { userId },
  });

  if (!rider) {
    throw new UbiError(ErrorCodes.NOT_FOUND, "Rider profile not found");
  }

  await prisma.savedPlace.deleteMany({
    where: {
      id: placeId,
      riderId: rider.id,
    },
  });

  return c.json({
    success: true,
    data: { message: "Place deleted" },
  });
});

/**
 * GET /users/me/ride-history
 * Get ride history for current user
 */
userRoutes.get("/me/ride-history", async (c) => {
  const userId = c.req.header("x-auth-user-id");
  const page = Number.parseInt(c.req.query("page") || "1");
  const limit = Math.min(Number.parseInt(c.req.query("limit") || "20"), 50);

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const rider = await prisma.rider.findUnique({
    where: { userId },
  });

  if (!rider) {
    throw new UbiError(ErrorCodes.NOT_FOUND, "Rider profile not found");
  }

  const [rides, total] = await Promise.all([
    prisma.ride.findMany({
      where: { riderId: rider.id },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        driver: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                avatarUrl: true,
              },
            },
            vehicle: {
              select: {
                make: true,
                model: true,
                color: true,
                plateNumber: true,
              },
            },
          },
        },
      },
    }),
    prisma.ride.count({ where: { riderId: rider.id } }),
  ]);

  return c.json({
    success: true,
    data: {
      rides,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

export { userRoutes };
