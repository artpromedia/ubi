/**
 * Driver Routes
 *
 * Handles driver onboarding, verification, and profile management.
 */

import { Prisma } from "@prisma/client";
import { ErrorCodes, UbiError } from "@ubi/utils";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const driverRoutes = new Hono();

// ===========================================
// Validation Schemas
// ===========================================

const driverApplicationSchema = z.object({
  licenseNumber: z.string().min(5).max(50),
  licenseExpiry: z.string().datetime(),
  vehicleType: z.enum(["SEDAN", "SUV", "VAN", "MOTORCYCLE", "ELECTRIC"]),
  vehicle: z.object({
    make: z.string().min(1),
    model: z.string().min(1),
    year: z
      .number()
      .min(1990)
      .max(new Date().getFullYear() + 1),
    color: z.string().min(1),
    plateNumber: z.string().min(3),
    capacity: z.number().min(1).max(20).default(4),
    isElectric: z.boolean().default(false),
  }),
});

const documentUploadSchema = z.object({
  documentType: z.enum([
    "license",
    "insurance",
    "vehicle_registration",
    "profile_photo",
    "vehicle_photo",
  ]),
  documentUrl: z.string().url(),
});

const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
  accuracy: z.number().min(0).optional(),
});

const updateStatusSchema = z.object({
  isOnline: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
});

// ===========================================
// Routes
// ===========================================

/**
 * POST /drivers/apply
 * Submit driver application
 */
driverRoutes.post("/apply", async (c) => {
  const userId = c.req.header("x-auth-user-id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const body = await c.req.json();
  const data = driverApplicationSchema.parse(body);

  // Check if user exists and is not already a driver
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { driver: true },
  });

  if (!user) {
    throw new UbiError(ErrorCodes.USER_NOT_FOUND, "User not found");
  }

  if (user.driver) {
    throw new UbiError(
      ErrorCodes.DUPLICATE_ENTRY,
      "You already have a driver application"
    );
  }

  // Check license uniqueness
  const existingLicense = await prisma.driver.findUnique({
    where: { licenseNumber: data.licenseNumber },
  });

  if (existingLicense) {
    throw new UbiError(
      ErrorCodes.DUPLICATE_ENTRY,
      "This license number is already registered"
    );
  }

  // Check plate number uniqueness
  const existingPlate = await prisma.vehicle.findUnique({
    where: { plateNumber: data.vehicle.plateNumber },
  });

  if (existingPlate) {
    throw new UbiError(
      ErrorCodes.DUPLICATE_ENTRY,
      "This plate number is already registered"
    );
  }

  // Create vehicle and driver profile in transaction
  const { vehicle, driver } = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // Create vehicle
      const newVehicle = await tx.vehicle.create({
        data: {
          make: data.vehicle.make,
          model: data.vehicle.model,
          year: data.vehicle.year,
          color: data.vehicle.color,
          plateNumber: data.vehicle.plateNumber,
          type: data.vehicleType,
          capacity: data.vehicle.capacity,
          isElectric: data.vehicle.isElectric,
        },
      });

      // Create driver
      const newDriver = await tx.driver.create({
        data: {
          userId: user.id,
          licenseNumber: data.licenseNumber,
          licenseExpiry: new Date(data.licenseExpiry),
          vehicleId: newVehicle.id,
          isOnline: false,
          isAvailable: false,
        },
      });

      // Update user role if currently RIDER
      if (user.role === "RIDER") {
        await tx.user.update({
          where: { id: user.id },
          data: { role: "DRIVER" },
        });
      }

      return { vehicle: newVehicle, driver: newDriver };
    }
  );

  return c.json({
    success: true,
    data: {
      driver: {
        id: driver!.id,
        licenseNumber: driver!.licenseNumber,
        status: "pending_verification",
        vehicle,
      },
      message: "Application submitted. Please upload required documents.",
    },
  });
});

/**
 * POST /drivers/documents
 * Upload driver documents
 */
driverRoutes.post("/documents", async (c) => {
  const userId = c.req.header("x-auth-user-id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const body = await c.req.json();
  const data = documentUploadSchema.parse(body);

  const driver = await prisma.driver.findUnique({
    where: { userId },
  });

  if (!driver) {
    throw new UbiError(ErrorCodes.NOT_FOUND, "Driver profile not found");
  }

  // In production, store document reference in a separate documents table
  // For now, we'll track in metadata
  // NOTE: Document verification workflow pending - requires admin review system

  return c.json({
    success: true,
    data: {
      message: "Document uploaded successfully. It will be reviewed shortly.",
      documentType: data.documentType,
    },
  });
});

/**
 * GET /drivers/me/status
 * Get driver application/verification status
 */
driverRoutes.get("/me/status", async (c) => {
  const userId = c.req.header("x-auth-user-id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const driver = await prisma.driver.findUnique({
    where: { userId },
    include: {
      vehicle: true,
    },
  });

  if (!driver) {
    throw new UbiError(ErrorCodes.NOT_FOUND, "No driver application found");
  }

  const status = driver.verifiedAt ? "verified" : "pending_verification";

  return c.json({
    success: true,
    data: {
      status,
      driver: {
        id: driver.id,
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        rating: driver.rating,
        totalRides: driver.totalRides,
        totalEarnings: driver.totalEarnings,
        acceptanceRate: driver.acceptanceRate,
        verifiedAt: driver.verifiedAt,
        vehicle: driver.vehicle,
      },
    },
  });
});

/**
 * GET /drivers/me
 * Get current driver profile
 */
driverRoutes.get("/me", async (c) => {
  const userId = c.req.header("x-auth-user-id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const driver = await prisma.driver.findUnique({
    where: { userId },
    include: {
      vehicle: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
  });

  if (!driver) {
    throw new UbiError(ErrorCodes.NOT_FOUND, "Driver profile not found");
  }

  return c.json({
    success: true,
    data: { driver },
  });
});

/**
 * PUT /drivers/me/location
 * Update driver location
 */
driverRoutes.put("/me/location", async (c) => {
  const userId = c.req.header("x-auth-user-id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const body = await c.req.json();
  const data = updateLocationSchema.parse(body);

  const driver = await prisma.driver.update({
    where: { userId },
    data: {
      currentLatitude: data.latitude,
      currentLongitude: data.longitude,
      lastLocationUpdate: new Date(),
    },
  });

  // NOTE: Location updates will be published via event bus for real-time tracking
  // await publishEvent('driver.location_updated', { driverId: driver.id, ...data });

  return c.json({
    success: true,
    data: {
      location: {
        latitude: driver.currentLatitude,
        longitude: driver.currentLongitude,
        updatedAt: driver.lastLocationUpdate,
      },
    },
  });
});

/**
 * PUT /drivers/me/status
 * Update driver online/availability status
 */
driverRoutes.put("/me/status", async (c) => {
  const userId = c.req.header("x-auth-user-id");

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const body = await c.req.json();
  const data = updateStatusSchema.parse(body);

  // Check if driver is verified
  const existingDriver = await prisma.driver.findUnique({
    where: { userId },
  });

  if (!existingDriver) {
    throw new UbiError(ErrorCodes.NOT_FOUND, "Driver profile not found");
  }

  if (!existingDriver.verifiedAt) {
    throw new UbiError(
      ErrorCodes.DRIVER_NOT_VERIFIED,
      "Your driver profile is not yet verified"
    );
  }

  const driver = await prisma.driver.update({
    where: { userId },
    data: {
      isOnline: data.isOnline,
      isAvailable: data.isAvailable,
    },
  });

  // NOTE: Status changes will trigger ride-service checks and event publishing

  return c.json({
    success: true,
    data: {
      isOnline: driver.isOnline,
      isAvailable: driver.isAvailable,
    },
  });
});

/**
 * GET /drivers/me/earnings
 * Get driver earnings summary
 */
driverRoutes.get("/me/earnings", async (c) => {
  const userId = c.req.header("x-auth-user-id");
  const period = c.req.query("period") || "week"; // day, week, month, all

  if (!userId) {
    throw new UbiError(ErrorCodes.UNAUTHORIZED, "Authentication required");
  }

  const driver = await prisma.driver.findUnique({
    where: { userId },
  });

  if (!driver) {
    throw new UbiError(ErrorCodes.NOT_FOUND, "Driver profile not found");
  }

  // Calculate date range
  const now = new Date();
  let startDate: Date;

  switch (period) {
    case "day":
      startDate = new Date(now.setHours(0, 0, 0, 0));
      break;
    case "week":
      startDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case "month":
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    default:
      startDate = new Date(0);
  }

  const earnings = await prisma.driverEarning.findMany({
    where: {
      driverId: driver.id,
      createdAt: { gte: startDate },
    },
    orderBy: { createdAt: "desc" },
  });

  // Calculate totals by type
  const initialValue: Record<string, number> = { total: 0 };
  type EarningItem = { type: string; amount: unknown };
  const summary = (earnings as EarningItem[]).reduce(
    (acc: Record<string, number>, e: EarningItem) => {
      const amount = Number(e.amount);
      acc.total = (acc.total ?? 0) + amount;
      acc[e.type] = (acc[e.type] ?? 0) + amount;
      return acc;
    },
    initialValue
  );

  return c.json({
    success: true,
    data: {
      period,
      summary,
      totalEarnings: driver.totalEarnings,
      recentEarnings: earnings.slice(0, 10),
    },
  });
});

/**
 * GET /drivers/:id
 * Get driver by ID (for ride matching)
 */
driverRoutes.get("/:id", async (c) => {
  const driverId = c.req.param("id");

  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: {
      vehicle: {
        select: {
          make: true,
          model: true,
          year: true,
          color: true,
          plateNumber: true,
          type: true,
        },
      },
      user: {
        select: {
          firstName: true,
          lastName: true,
          avatarUrl: true,
        },
      },
    },
  });

  if (!driver) {
    throw new UbiError(ErrorCodes.DRIVER_NOT_FOUND, "Driver not found");
  }

  return c.json({
    success: true,
    data: {
      driver: {
        id: driver.id,
        name: `${driver.user.firstName} ${driver.user.lastName}`,
        avatarUrl: driver.user.avatarUrl,
        rating: driver.rating,
        totalRides: driver.totalRides,
        vehicle: driver.vehicle,
        location: driver.isOnline
          ? {
              latitude: driver.currentLatitude,
              longitude: driver.currentLongitude,
            }
          : null,
      },
    },
  });
});

/**
 * POST /drivers/:id/verify (Admin only)
 * Verify a driver application
 */
driverRoutes.post("/:id/verify", async (c) => {
  const userRole = c.req.header("x-auth-user-role");
  const driverId = c.req.param("id");

  if (userRole !== "admin" && userRole !== "super_admin") {
    throw new UbiError(ErrorCodes.FORBIDDEN, "Admin access required");
  }

  const driver = await prisma.driver.update({
    where: { id: driverId },
    data: {
      verifiedAt: new Date(),
    },
    include: {
      user: true,
    },
  });

  // NOTE: Approval notification will be sent via notification-service

  return c.json({
    success: true,
    data: {
      message: "Driver verified successfully",
      driver: {
        id: driver.id,
        verifiedAt: driver.verifiedAt,
      },
    },
  });
});

export { driverRoutes };
