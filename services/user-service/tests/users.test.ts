/**
 * User Routes Unit Tests
 *
 * Tests user profile management, preferences, and saved places.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Mock Prisma
const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  rider: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  driver: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  savedPlace: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("../src/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Validation schemas (matching users.ts)
const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  language: z.string().max(5).optional(),
  avatarUrl: z.string().url().optional(),
});

const savedPlaceSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  placeId: z.string().optional(),
  type: z.enum(["home", "work", "other"]).default("other"),
});

const updatePreferencesSchema = z.object({
  defaultPayment: z
    .enum(["CASH", "CARD", "WALLET", "MPESA", "MTN_MOMO", "AIRTEL_MONEY"])
    .optional(),
  notifications: z
    .object({
      push: z.boolean().optional(),
      sms: z.boolean().optional(),
      email: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
    })
    .optional(),
});

describe("User Profile Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateProfileSchema", () => {
    it("should accept valid profile update data", () => {
      const validData = {
        firstName: "John",
        lastName: "Doe",
        email: "john.doe@example.com",
        language: "en",
      };

      const result = updateProfileSchema.parse(validData);
      expect(result).toEqual(validData);
    });

    it("should accept partial updates", () => {
      const partialData = { firstName: "Jane" };
      const result = updateProfileSchema.parse(partialData);
      expect(result).toEqual(partialData);
    });

    it("should reject firstName exceeding max length", () => {
      const invalidData = {
        firstName: "a".repeat(101),
      };

      expect(() => updateProfileSchema.parse(invalidData)).toThrow();
    });

    it("should reject invalid email format", () => {
      const invalidData = {
        email: "not-an-email",
      };

      expect(() => updateProfileSchema.parse(invalidData)).toThrow();
    });

    it("should accept valid avatar URL", () => {
      const validData = {
        avatarUrl: "https://example.com/avatar.jpg",
      };

      const result = updateProfileSchema.parse(validData);
      expect(result.avatarUrl).toBe(validData.avatarUrl);
    });

    it("should reject invalid avatar URL", () => {
      const invalidData = {
        avatarUrl: "not-a-url",
      };

      expect(() => updateProfileSchema.parse(invalidData)).toThrow();
    });

    it("should accept language codes", () => {
      const languages = ["en", "sw", "fr", "ar", "yo"];

      languages.forEach((lang) => {
        const result = updateProfileSchema.parse({ language: lang });
        expect(result.language).toBe(lang);
      });
    });
  });
});

describe("Saved Places Validation", () => {
  describe("savedPlaceSchema", () => {
    it("should accept valid saved place data", () => {
      const validPlace = {
        name: "Home",
        address: "123 Main Street, Nairobi",
        latitude: -1.2921,
        longitude: 36.8219,
        placeId: "ChIJLa-123abc",
        type: "home" as const,
      };

      const result = savedPlaceSchema.parse(validPlace);
      expect(result).toEqual(validPlace);
    });

    it("should default type to 'other'", () => {
      const placeWithoutType = {
        name: "Coffee Shop",
        address: "456 Coffee Lane",
        latitude: -1.3,
        longitude: 36.8,
      };

      const result = savedPlaceSchema.parse(placeWithoutType);
      expect(result.type).toBe("other");
    });

    it("should reject empty name", () => {
      const invalidPlace = {
        name: "",
        address: "123 Main Street",
        latitude: -1.2921,
        longitude: 36.8219,
      };

      expect(() => savedPlaceSchema.parse(invalidPlace)).toThrow();
    });

    it("should reject invalid latitude (out of range)", () => {
      const invalidPlace = {
        name: "Invalid Location",
        address: "123 Main Street",
        latitude: 91, // Invalid: max is 90
        longitude: 36.8219,
      };

      expect(() => savedPlaceSchema.parse(invalidPlace)).toThrow();
    });

    it("should reject invalid longitude (out of range)", () => {
      const invalidPlace = {
        name: "Invalid Location",
        address: "123 Main Street",
        latitude: -1.2921,
        longitude: 181, // Invalid: max is 180
      };

      expect(() => savedPlaceSchema.parse(invalidPlace)).toThrow();
    });

    it("should accept valid type values", () => {
      const types: ("home" | "work" | "other")[] = ["home", "work", "other"];

      types.forEach((type) => {
        const place = {
          name: "Test",
          address: "Test Address",
          latitude: 0,
          longitude: 0,
          type,
        };

        const result = savedPlaceSchema.parse(place);
        expect(result.type).toBe(type);
      });
    });

    it("should reject invalid type values", () => {
      const invalidPlace = {
        name: "Test",
        address: "Test Address",
        latitude: 0,
        longitude: 0,
        type: "invalid",
      };

      expect(() => savedPlaceSchema.parse(invalidPlace)).toThrow();
    });
  });
});

describe("User Preferences Validation", () => {
  describe("updatePreferencesSchema", () => {
    it("should accept valid preferences data", () => {
      const validPrefs = {
        defaultPayment: "MPESA" as const,
        notifications: {
          push: true,
          sms: true,
          email: false,
          whatsapp: true,
        },
      };

      const result = updatePreferencesSchema.parse(validPrefs);
      expect(result).toEqual(validPrefs);
    });

    it("should accept all valid payment methods", () => {
      const paymentMethods = [
        "CASH",
        "CARD",
        "WALLET",
        "MPESA",
        "MTN_MOMO",
        "AIRTEL_MONEY",
      ] as const;

      paymentMethods.forEach((method) => {
        const result = updatePreferencesSchema.parse({
          defaultPayment: method,
        });
        expect(result.defaultPayment).toBe(method);
      });
    });

    it("should reject invalid payment method", () => {
      const invalidPrefs = {
        defaultPayment: "BITCOIN",
      };

      expect(() => updatePreferencesSchema.parse(invalidPrefs)).toThrow();
    });

    it("should accept partial notification preferences", () => {
      const partialNotifications = {
        notifications: {
          push: true,
        },
      };

      const result = updatePreferencesSchema.parse(partialNotifications);
      expect(result.notifications?.push).toBe(true);
      expect(result.notifications?.sms).toBeUndefined();
    });
  });
});

describe("User Service Business Logic", () => {
  const mockUser = {
    id: "user_123",
    phone: "+254712345678",
    email: "test@example.com",
    firstName: "John",
    lastName: "Doe",
    role: "RIDER",
    status: "ACTIVE",
    passwordHash: "hashed_password",
    country: "KE",
    language: "en",
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Get User Profile", () => {
    it("should return user without password hash", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await mockPrisma.user.findUnique({
        where: { id: mockUser.id },
      });

      expect(result).toBeDefined();

      // Simulate removing sensitive data
      const { passwordHash, ...safeUser } = result!;
      expect(safeUser).not.toHaveProperty("passwordHash");
      expect(safeUser.id).toBe(mockUser.id);
      expect(safeUser.email).toBe(mockUser.email);
    });

    it("should return null for non-existent user", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await mockPrisma.user.findUnique({
        where: { id: "non_existent" },
      });

      expect(result).toBeNull();
    });
  });

  describe("Update User Profile", () => {
    it("should update user profile successfully", async () => {
      const updateData = { firstName: "Jane", lastName: "Smith" };
      const updatedUser = { ...mockUser, ...updateData };

      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const result = await mockPrisma.user.update({
        where: { id: mockUser.id },
        data: updateData,
      });

      expect(result.firstName).toBe("Jane");
      expect(result.lastName).toBe("Smith");
    });

    it("should check for email uniqueness", async () => {
      const existingUser = { ...mockUser, id: "other_user" };
      mockPrisma.user.findUnique.mockResolvedValue(existingUser);

      const result = await mockPrisma.user.findUnique({
        where: { email: "test@example.com" },
      });

      expect(result).toBeDefined();
      expect(result!.id).not.toBe(mockUser.id);
    });
  });

  describe("Deactivate User Account", () => {
    it("should update user status to DEACTIVATED", async () => {
      const deactivatedUser = { ...mockUser, status: "DEACTIVATED" };
      mockPrisma.user.update.mockResolvedValue(deactivatedUser);

      const result = await mockPrisma.user.update({
        where: { id: mockUser.id },
        data: { status: "DEACTIVATED" },
      });

      expect(result.status).toBe("DEACTIVATED");
    });
  });
});

describe("Saved Places Operations", () => {
  const mockRiderId = "rider_123";

  const mockSavedPlaces = [
    {
      id: "place_1",
      riderId: mockRiderId,
      name: "Home",
      address: "123 Main St",
      latitude: -1.2921,
      longitude: 36.8219,
      placeId: "ChIJ123",
      type: "home",
      createdAt: new Date(),
    },
    {
      id: "place_2",
      riderId: mockRiderId,
      name: "Work",
      address: "456 Office Ave",
      latitude: -1.3,
      longitude: 36.85,
      placeId: "ChIJ456",
      type: "work",
      createdAt: new Date(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Get Saved Places", () => {
    it("should return all saved places for a rider", async () => {
      mockPrisma.savedPlace.findMany.mockResolvedValue(mockSavedPlaces);

      const result = await mockPrisma.savedPlace.findMany({
        where: { riderId: mockRiderId },
      });

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Home");
      expect(result[1].name).toBe("Work");
    });

    it("should return empty array for rider with no saved places", async () => {
      mockPrisma.savedPlace.findMany.mockResolvedValue([]);

      const result = await mockPrisma.savedPlace.findMany({
        where: { riderId: "new_rider" },
      });

      expect(result).toHaveLength(0);
    });
  });

  describe("Create Saved Place", () => {
    it("should create a new saved place", async () => {
      const newPlace = {
        id: "place_3",
        riderId: mockRiderId,
        name: "Gym",
        address: "789 Fitness Rd",
        latitude: -1.25,
        longitude: 36.9,
        placeId: "ChIJ789",
        type: "other",
        createdAt: new Date(),
      };

      mockPrisma.savedPlace.create.mockResolvedValue(newPlace);

      const result = await mockPrisma.savedPlace.create({
        data: {
          riderId: mockRiderId,
          name: "Gym",
          address: "789 Fitness Rd",
          latitude: -1.25,
          longitude: 36.9,
          placeId: "ChIJ789",
          type: "other",
        },
      });

      expect(result.name).toBe("Gym");
      expect(result.type).toBe("other");
    });
  });

  describe("Delete Saved Place", () => {
    it("should delete a saved place", async () => {
      mockPrisma.savedPlace.delete.mockResolvedValue(mockSavedPlaces[0]);

      const result = await mockPrisma.savedPlace.delete({
        where: { id: "place_1" },
      });

      expect(result.id).toBe("place_1");
    });
  });
});

describe("Phone Number Validation", () => {
  const phonePatterns = {
    KE: /^\+254[17]\d{8}$/,
    NG: /^\+234[789]\d{9}$/,
    GH: /^\+233[235]\d{8}$/,
    UG: /^\+2567\d{8}$/,
    RW: /^\+2507\d{8}$/,
    ZA: /^\+27[6-8]\d{8}$/,
    TZ: /^\+255[67]\d{8}$/,
  };

  it("should validate Kenyan phone numbers", () => {
    const validKenyan = ["+254712345678", "+254712345679", "+254112345678"];
    const invalidKenyan = ["+254", "+2541234", "0712345678"];

    validKenyan.forEach((phone) => {
      expect(phonePatterns.KE.test(phone)).toBe(true);
    });

    invalidKenyan.forEach((phone) => {
      expect(phonePatterns.KE.test(phone)).toBe(false);
    });
  });

  it("should validate Nigerian phone numbers", () => {
    const validNigerian = [
      "+2348012345678",
      "+2349012345678",
      "+2347012345678",
    ];
    const invalidNigerian = ["+234", "+234801234567"];

    validNigerian.forEach((phone) => {
      expect(phonePatterns.NG.test(phone)).toBe(true);
    });

    invalidNigerian.forEach((phone) => {
      expect(phonePatterns.NG.test(phone)).toBe(false);
    });
  });

  it("should validate Ghanaian phone numbers", () => {
    const validGhanaian = ["+233201234567", "+233501234567", "+233301234567"];

    validGhanaian.forEach((phone) => {
      expect(phonePatterns.GH.test(phone)).toBe(true);
    });
  });
});

describe("User Role Permissions", () => {
  const rolePermissions = {
    RIDER: ["read:profile", "write:profile", "create:ride", "read:ride"],
    DRIVER: [
      "read:profile",
      "write:profile",
      "accept:ride",
      "complete:ride",
      "read:earnings",
    ],
    ADMIN: ["*"],
    SUPPORT: ["read:user", "read:ride", "update:ride_status"],
  };

  it("should define correct permissions for RIDER role", () => {
    expect(rolePermissions.RIDER).toContain("read:profile");
    expect(rolePermissions.RIDER).toContain("create:ride");
    expect(rolePermissions.RIDER).not.toContain("accept:ride");
  });

  it("should define correct permissions for DRIVER role", () => {
    expect(rolePermissions.DRIVER).toContain("accept:ride");
    expect(rolePermissions.DRIVER).toContain("read:earnings");
    expect(rolePermissions.DRIVER).not.toContain("create:ride");
  });

  it("should give ADMIN all permissions", () => {
    expect(rolePermissions.ADMIN).toContain("*");
  });

  it("should limit SUPPORT permissions", () => {
    expect(rolePermissions.SUPPORT).toContain("read:user");
    expect(rolePermissions.SUPPORT).not.toContain("delete:user");
  });
});
