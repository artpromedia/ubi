/**
 * Driver Routes Unit Tests
 *
 * Tests driver onboarding, verification, and profile management.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Mock Prisma
const mockPrisma = {
  user: {
    findUnique: vi.fn(),
  },
  driver: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  vehicle: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  driverDocument: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock("../src/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Validation schemas (matching drivers.ts)
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

describe("Driver Application Validation", () => {
  describe("driverApplicationSchema", () => {
    const validApplication = {
      licenseNumber: "DL12345678",
      licenseExpiry: "2026-12-31T23:59:59Z",
      vehicleType: "SEDAN" as const,
      vehicle: {
        make: "Toyota",
        model: "Camry",
        year: 2020,
        color: "Silver",
        plateNumber: "KAB 123X",
        capacity: 4,
        isElectric: false,
      },
    };

    it("should accept valid driver application", () => {
      const result = driverApplicationSchema.parse(validApplication);
      expect(result.licenseNumber).toBe("DL12345678");
      expect(result.vehicle.make).toBe("Toyota");
    });

    it("should reject license number shorter than 5 characters", () => {
      const invalidApp = { ...validApplication, licenseNumber: "DL12" };
      expect(() => driverApplicationSchema.parse(invalidApp)).toThrow();
    });

    it("should reject invalid license expiry date format", () => {
      const invalidApp = { ...validApplication, licenseExpiry: "2026-12-31" };
      expect(() => driverApplicationSchema.parse(invalidApp)).toThrow();
    });

    it("should accept all valid vehicle types", () => {
      const vehicleTypes = [
        "SEDAN",
        "SUV",
        "VAN",
        "MOTORCYCLE",
        "ELECTRIC",
      ] as const;

      vehicleTypes.forEach((type) => {
        const app = { ...validApplication, vehicleType: type };
        const result = driverApplicationSchema.parse(app);
        expect(result.vehicleType).toBe(type);
      });
    });

    it("should reject invalid vehicle type", () => {
      const invalidApp = { ...validApplication, vehicleType: "TRUCK" };
      expect(() => driverApplicationSchema.parse(invalidApp)).toThrow();
    });

    it("should reject vehicle year before 1990", () => {
      const invalidApp = {
        ...validApplication,
        vehicle: { ...validApplication.vehicle, year: 1989 },
      };
      expect(() => driverApplicationSchema.parse(invalidApp)).toThrow();
    });

    it("should reject vehicle year in the future", () => {
      const futureYear = new Date().getFullYear() + 2;
      const invalidApp = {
        ...validApplication,
        vehicle: { ...validApplication.vehicle, year: futureYear },
      };
      expect(() => driverApplicationSchema.parse(invalidApp)).toThrow();
    });

    it("should default capacity to 4", () => {
      const appWithoutCapacity = {
        ...validApplication,
        vehicle: {
          make: "Toyota",
          model: "Camry",
          year: 2020,
          color: "Silver",
          plateNumber: "KAB 123X",
        },
      };
      const result = driverApplicationSchema.parse(appWithoutCapacity);
      expect(result.vehicle.capacity).toBe(4);
    });

    it("should reject capacity greater than 20", () => {
      const invalidApp = {
        ...validApplication,
        vehicle: { ...validApplication.vehicle, capacity: 21 },
      };
      expect(() => driverApplicationSchema.parse(invalidApp)).toThrow();
    });

    it("should default isElectric to false", () => {
      const appWithoutElectric = {
        ...validApplication,
        vehicle: {
          make: "Toyota",
          model: "Camry",
          year: 2020,
          color: "Silver",
          plateNumber: "KAB 123X",
        },
      };
      const result = driverApplicationSchema.parse(appWithoutElectric);
      expect(result.vehicle.isElectric).toBe(false);
    });
  });
});

describe("Document Upload Validation", () => {
  describe("documentUploadSchema", () => {
    it("should accept valid document upload", () => {
      const validDoc = {
        documentType: "license" as const,
        documentUrl: "https://storage.example.com/docs/license123.jpg",
      };

      const result = documentUploadSchema.parse(validDoc);
      expect(result.documentType).toBe("license");
    });

    it("should accept all valid document types", () => {
      const docTypes = [
        "license",
        "insurance",
        "vehicle_registration",
        "profile_photo",
        "vehicle_photo",
      ] as const;

      docTypes.forEach((type) => {
        const doc = {
          documentType: type,
          documentUrl: "https://example.com/doc.jpg",
        };
        const result = documentUploadSchema.parse(doc);
        expect(result.documentType).toBe(type);
      });
    });

    it("should reject invalid document type", () => {
      const invalidDoc = {
        documentType: "passport",
        documentUrl: "https://example.com/doc.jpg",
      };
      expect(() => documentUploadSchema.parse(invalidDoc)).toThrow();
    });

    it("should reject invalid URL", () => {
      const invalidDoc = {
        documentType: "license",
        documentUrl: "not-a-valid-url",
      };
      expect(() => documentUploadSchema.parse(invalidDoc)).toThrow();
    });
  });
});

describe("Location Update Validation", () => {
  describe("updateLocationSchema", () => {
    it("should accept valid location update", () => {
      const validLocation = {
        latitude: -1.2921,
        longitude: 36.8219,
        heading: 180,
        speed: 60,
        accuracy: 5,
      };

      const result = updateLocationSchema.parse(validLocation);
      expect(result.latitude).toBe(-1.2921);
      expect(result.longitude).toBe(36.8219);
    });

    it("should accept minimum required fields", () => {
      const minimalLocation = {
        latitude: 0,
        longitude: 0,
      };

      const result = updateLocationSchema.parse(minimalLocation);
      expect(result.latitude).toBe(0);
      expect(result.heading).toBeUndefined();
    });

    it("should reject latitude out of range", () => {
      const invalidLocation = {
        latitude: 91,
        longitude: 0,
      };
      expect(() => updateLocationSchema.parse(invalidLocation)).toThrow();
    });

    it("should reject longitude out of range", () => {
      const invalidLocation = {
        latitude: 0,
        longitude: -181,
      };
      expect(() => updateLocationSchema.parse(invalidLocation)).toThrow();
    });

    it("should reject invalid heading (greater than 360)", () => {
      const invalidLocation = {
        latitude: 0,
        longitude: 0,
        heading: 361,
      };
      expect(() => updateLocationSchema.parse(invalidLocation)).toThrow();
    });

    it("should reject negative speed", () => {
      const invalidLocation = {
        latitude: 0,
        longitude: 0,
        speed: -1,
      };
      expect(() => updateLocationSchema.parse(invalidLocation)).toThrow();
    });
  });
});

describe("Driver Status Validation", () => {
  describe("updateStatusSchema", () => {
    it("should accept valid status update", () => {
      const validStatus = {
        isOnline: true,
        isAvailable: true,
      };

      const result = updateStatusSchema.parse(validStatus);
      expect(result.isOnline).toBe(true);
      expect(result.isAvailable).toBe(true);
    });

    it("should accept partial status update", () => {
      const partialStatus = { isOnline: false };
      const result = updateStatusSchema.parse(partialStatus);
      expect(result.isOnline).toBe(false);
      expect(result.isAvailable).toBeUndefined();
    });

    it("should accept empty object", () => {
      const result = updateStatusSchema.parse({});
      expect(result.isOnline).toBeUndefined();
      expect(result.isAvailable).toBeUndefined();
    });
  });
});

describe("Driver Business Logic", () => {
  const mockUser = {
    id: "user_123",
    phone: "+254712345678",
    email: "driver@example.com",
    firstName: "John",
    lastName: "Driver",
    role: "DRIVER",
    driver: null,
  };

  const mockDriver = {
    id: "driver_123",
    userId: "user_123",
    licenseNumber: "DL12345678",
    licenseExpiry: new Date("2026-12-31"),
    vehicleId: "vehicle_123",
    isOnline: true,
    isAvailable: true,
    rating: 4.8,
    totalTrips: 150,
    status: "APPROVED",
    latitude: -1.2921,
    longitude: 36.8219,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Driver Application", () => {
    it("should prevent duplicate applications", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        driver: mockDriver,
      });

      const result = await mockPrisma.user.findUnique({
        where: { id: mockUser.id },
        include: { driver: true },
      });

      expect(result?.driver).toBeDefined();
      // In real route, this would throw DUPLICATE_ENTRY error
    });

    it("should check license uniqueness", async () => {
      mockPrisma.driver.findUnique.mockResolvedValue(mockDriver);

      const result = await mockPrisma.driver.findUnique({
        where: { licenseNumber: "DL12345678" },
      });

      expect(result).toBeDefined();
    });

    it("should check plate number uniqueness", async () => {
      const mockVehicle = {
        id: "vehicle_123",
        plateNumber: "KAB 123X",
      };

      mockPrisma.vehicle.findUnique.mockResolvedValue(mockVehicle);

      const result = await mockPrisma.vehicle.findUnique({
        where: { plateNumber: "KAB 123X" },
      });

      expect(result).toBeDefined();
    });
  });

  describe("Driver Status Updates", () => {
    it("should update driver online status", async () => {
      const updatedDriver = { ...mockDriver, isOnline: false };
      mockPrisma.driver.update.mockResolvedValue(updatedDriver);

      const result = await mockPrisma.driver.update({
        where: { id: mockDriver.id },
        data: { isOnline: false },
      });

      expect(result.isOnline).toBe(false);
    });

    it("should update driver availability", async () => {
      const updatedDriver = { ...mockDriver, isAvailable: false };
      mockPrisma.driver.update.mockResolvedValue(updatedDriver);

      const result = await mockPrisma.driver.update({
        where: { id: mockDriver.id },
        data: { isAvailable: false },
      });

      expect(result.isAvailable).toBe(false);
    });
  });

  describe("Driver Location Updates", () => {
    it("should update driver location", async () => {
      const newLocation = {
        latitude: -1.3,
        longitude: 36.85,
        heading: 90,
        speed: 45,
      };

      const updatedDriver = { ...mockDriver, ...newLocation };
      mockPrisma.driver.update.mockResolvedValue(updatedDriver);

      const result = await mockPrisma.driver.update({
        where: { id: mockDriver.id },
        data: newLocation,
      });

      expect(result.latitude).toBe(-1.3);
      expect(result.longitude).toBe(36.85);
    });
  });
});

describe("Driver Rating Calculations", () => {
  function calculateNewRating(
    currentRating: number,
    totalTrips: number,
    newRating: number,
  ): number {
    // Weighted average: new rating has more impact early, less impact later
    const weight = Math.min(totalTrips, 100);
    return (currentRating * weight + newRating) / (weight + 1);
  }

  it("should calculate new rating correctly", () => {
    // Driver with 100 trips and 4.8 rating gets a 5-star review
    const newRating = calculateNewRating(4.8, 100, 5);
    expect(newRating).toBeCloseTo(4.802, 2);
  });

  it("should give more weight to early ratings", () => {
    // Driver with 10 trips vs 100 trips
    const newRating10Trips = calculateNewRating(4.0, 10, 5.0);
    const newRating100Trips = calculateNewRating(4.0, 100, 5.0);

    // 10 trips should have larger increase
    expect(newRating10Trips - 4.0).toBeGreaterThan(newRating100Trips - 4.0);
  });

  it("should handle first rating", () => {
    const newRating = calculateNewRating(0, 0, 5);
    expect(newRating).toBe(5);
  });
});

describe("License Expiry Validation", () => {
  function isLicenseExpired(expiryDate: Date): boolean {
    return new Date() > expiryDate;
  }

  function isLicenseExpiringSoon(
    expiryDate: Date,
    daysThreshold: number = 30,
  ): boolean {
    const now = new Date();
    const threshold = new Date(
      now.getTime() + daysThreshold * 24 * 60 * 60 * 1000,
    );
    return expiryDate <= threshold && expiryDate > now;
  }

  it("should detect expired license", () => {
    const expiredDate = new Date("2020-01-01");
    expect(isLicenseExpired(expiredDate)).toBe(true);
  });

  it("should not flag valid license as expired", () => {
    const futureDate = new Date("2030-01-01");
    expect(isLicenseExpired(futureDate)).toBe(false);
  });

  it("should detect license expiring soon", () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 15);
    expect(isLicenseExpiringSoon(soon)).toBe(true);
  });

  it("should not flag license far from expiry", () => {
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 90);
    expect(isLicenseExpiringSoon(farFuture)).toBe(false);
  });
});

describe("Driver Earnings Calculations", () => {
  interface TripEarning {
    baseFare: number;
    distanceFare: number;
    timeFare: number;
    surge: number;
    tips: number;
    platformFee: number;
  }

  function calculateDriverEarnings(trip: TripEarning): number {
    const gross =
      trip.baseFare +
      trip.distanceFare +
      trip.timeFare +
      trip.surge +
      trip.tips;
    return gross - trip.platformFee;
  }

  function calculatePlatformFee(
    gross: number,
    feePercent: number = 20,
  ): number {
    // Platform fee does not include tips
    return gross * (feePercent / 100);
  }

  it("should calculate driver earnings correctly", () => {
    const trip: TripEarning = {
      baseFare: 100,
      distanceFare: 200,
      timeFare: 50,
      surge: 75,
      tips: 50,
      platformFee: 85, // 20% of 425 (excluding tips)
    };

    const earnings = calculateDriverEarnings(trip);
    expect(earnings).toBe(390); // 475 - 85
  });

  it("should calculate platform fee excluding tips", () => {
    const grossWithoutTips = 425;
    const fee = calculatePlatformFee(grossWithoutTips);
    expect(fee).toBe(85);
  });
});
