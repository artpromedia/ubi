/**
 * SOS Service Unit Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SOSEmergencyService } from "../../src/services/sos.service";

// Mock the notification client before importing the service
vi.mock("../../src/lib/notification-client", () => ({
  notificationClient: {
    sendEmergencySMS: vi
      .fn()
      .mockResolvedValue({ success: true, notificationId: "msg_123" }),
    sendEmergencyPush: vi.fn().mockResolvedValue({ success: true }),
    notifyEmergencyContacts: vi.fn().mockResolvedValue({ sent: 2, failed: 0 }),
  },
}));

vi.mock("../../src/lib/prisma", () => ({
  prisma: {
    emergencyContact: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        id: "contact_1",
        userId: "user_1",
        name: "Test Contact",
        phoneNumber: "+234800000001",
        relationship: "family",
        isPrimary: true,
        whatsappEnabled: false,
        telegramEnabled: false,
        emailEnabled: false,
        notifyOnTrip: true,
        isVerified: false,
        isActive: true,
      }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user_1",
        firstName: "Test",
        lastName: "User",
        phone: "+234800000001",
        countryCode: "NG",
      }),
    },
    $disconnect: vi.fn(),
  },
}));

describe("SOSEmergencyService", () => {
  let sosService: SOSEmergencyService;

  beforeEach(() => {
    sosService = new SOSEmergencyService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("triggerSOS", () => {
    it("should trigger SOS and create incident", async () => {
      const params = {
        userId: "user_1",
        tripId: "trip_1",
        driverId: "driver_1",
        triggerMethod: "button" as const,
        location: {
          lat: 6.5244,
          lng: 3.3792,
          accuracy: 10,
          timestamp: new Date(),
        },
        batteryLevel: 80,
        networkType: "4G",
      };

      const incident = await sosService.triggerSOS(params);

      expect(incident).toBeDefined();
      expect(incident.userId).toBe("user_1");
      expect(incident.tripId).toBe("trip_1");
      expect(incident.status).toBe("ACTIVE");
      expect(incident.escalationLevel).toBe("LEVEL_1");
      expect(incident.triggerMethod).toBe("button");
      expect(incident.triggerLocation).toEqual(params.location);
    });

    it("should not create duplicate incident for same user", async () => {
      const params = {
        userId: "user_2",
        triggerMethod: "button" as const,
        location: {
          lat: 6.5244,
          lng: 3.3792,
          accuracy: 10,
          timestamp: new Date(),
        },
      };

      const incident1 = await sosService.triggerSOS(params);
      const incident2 = await sosService.triggerSOS(params);

      // Should return same incident
      expect(incident2.id).toBe(incident1.id);
    });

    it("should handle different trigger methods", async () => {
      const triggerMethods = [
        "button",
        "voice",
        "shake",
        "auto",
        "crash_detected",
      ] as const;

      for (const method of triggerMethods) {
        const params = {
          userId: `user_${method}`,
          triggerMethod: method,
          location: {
            lat: 6.5244,
            lng: 3.3792,
            accuracy: 10,
            timestamp: new Date(),
          },
        };

        const incident = await sosService.triggerSOS(params);
        expect(incident.triggerMethod).toBe(method);
      }
    });
  });

  describe("cancelSOS", () => {
    it("should cancel SOS with correct PIN", async () => {
      // First trigger SOS
      const params = {
        userId: "user_cancel_1",
        triggerMethod: "button" as const,
        location: {
          lat: 6.5244,
          lng: 3.3792,
          accuracy: 10,
          timestamp: new Date(),
        },
      };

      const incident = await sosService.triggerSOS(params);

      // Cancel with PIN
      const cancelResult = await sosService.cancelSOS(
        incident.id,
        "user_cancel_1",
        "1234", // Mock PIN
        "false_alarm",
      );

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.incident?.status).toBe("CANCELLED");
    });

    it("should reject cancellation with wrong PIN", async () => {
      const params = {
        userId: "user_cancel_2",
        triggerMethod: "button" as const,
        location: {
          lat: 6.5244,
          lng: 3.3792,
          accuracy: 10,
          timestamp: new Date(),
        },
      };

      const incident = await sosService.triggerSOS(params);

      const cancelResult = await sosService.cancelSOS(
        incident.id,
        "user_cancel_2",
        "wrong_pin",
        "false_alarm",
      );

      expect(cancelResult.success).toBe(false);
      expect(cancelResult.error).toBe("Invalid PIN");
    });
  });

  describe("escalation", () => {
    it("should escalate incident to next level", async () => {
      const params = {
        userId: "user_escalate",
        triggerMethod: "button" as const,
        location: {
          lat: 6.5244,
          lng: 3.3792,
          accuracy: 10,
          timestamp: new Date(),
        },
      };

      const incident = await sosService.triggerSOS(params);
      expect(incident.escalationLevel).toBe("LEVEL_1");

      // Manually trigger escalation
      await sosService.escalateIncident(incident.id, "No response from agent");

      const updated = await sosService.getSOSIncident(incident.id);
      expect(updated?.escalationLevel).toBe("LEVEL_2");
    });
  });

  describe("emergencyContacts", () => {
    it("should add emergency contact", async () => {
      const contact = await sosService.addEmergencyContact("user_1", {
        name: "Test Contact",
        phoneNumber: "+234800000001",
        relationship: "family",
        isPrimary: true,
        whatsappEnabled: false,
        telegramEnabled: false,
        emailEnabled: false,
        notifyOnTrip: true,
      });

      expect(contact.id).toBeDefined();
      expect(contact.name).toBe("Test Contact");
      expect(contact.phoneNumber).toBe("+234800000001");
    });

    it("should get emergency contacts for user", async () => {
      const contacts = await sosService.getEmergencyContacts("user_1");
      expect(Array.isArray(contacts)).toBe(true);
    });
  });

  describe("userSafetyContext", () => {
    it("should return user safety context", async () => {
      const context = await sosService.getUserSafetyContext("user_1");

      expect(context).toBeDefined();
      expect(context?.userId).toBe("user_1");
      expect(context?.hasActiveTrip).toBeDefined();
      expect(context?.emergencyContacts).toBeDefined();
    });
  });
});
