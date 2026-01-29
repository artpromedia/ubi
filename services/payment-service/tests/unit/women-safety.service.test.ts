/**
 * Women Safety Service Unit Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock the notification client
vi.mock("../../src/lib/notification-client", () => ({
  notificationClient: {
    notifyTripShared: vi.fn().mockResolvedValue({ success: true }),
    notifyTripEnded: vi.fn().mockResolvedValue({ success: true }),
    sendEmergencyPush: vi.fn().mockResolvedValue({ success: true }),
  },
}));

import { WomenSafetyService } from "../../src/services/women-safety.service";
import { notificationClient } from "../../src/lib/notification-client";

describe("WomenSafetyService", () => {
  let womenSafety: WomenSafetyService;

  beforeEach(() => {
    womenSafety = new WomenSafetyService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("preferences", () => {
    it("should enable women safety mode", async () => {
      await womenSafety.enableWomenSafetyMode("user_1");
      const prefs = await womenSafety.getPreferences("user_1");

      expect(prefs.enabled).toBe(true);
    });

    it("should disable women safety mode", async () => {
      await womenSafety.enableWomenSafetyMode("user_2");
      await womenSafety.disableWomenSafetyMode("user_2");
      const prefs = await womenSafety.getPreferences("user_2");

      expect(prefs.enabled).toBe(false);
    });

    it("should update gender preference", async () => {
      await womenSafety.setDriverGenderPreference("user_3", "FEMALE_ONLY");
      const prefs = await womenSafety.getPreferences("user_3");

      expect(prefs.preferredDriverGender).toBe("FEMALE_ONLY");
    });
  });

  describe("femaleDriverMatching", () => {
    it("should match female driver when preference is FEMALE_ONLY", async () => {
      await womenSafety.enableWomenSafetyMode("rider_1");
      await womenSafety.setDriverGenderPreference("rider_1", "FEMALE_ONLY");

      const availableDrivers = [
        { id: "driver_m1", gender: "male", rating: 4.8, distance: 500 },
        { id: "driver_f1", gender: "female", rating: 4.5, distance: 800 },
        { id: "driver_f2", gender: "female", rating: 4.9, distance: 1000 },
      ];

      const match = await womenSafety.matchFemaleDriver(
        "rider_1",
        availableDrivers,
        { lat: 6.5244, lng: 3.3792 },
        { lat: 6.5300, lng: 3.3800 }
      );

      expect(match).toBeDefined();
      expect(match?.matchedDriver.gender).toBe("female");
    });

    it("should return null when no female drivers available", async () => {
      await womenSafety.enableWomenSafetyMode("rider_2");
      await womenSafety.setDriverGenderPreference("rider_2", "FEMALE_ONLY");

      const availableDrivers = [
        { id: "driver_m1", gender: "male", rating: 4.8, distance: 500 },
        { id: "driver_m2", gender: "male", rating: 4.5, distance: 800 },
      ];

      const match = await womenSafety.matchFemaleDriver(
        "rider_2",
        availableDrivers,
        { lat: 6.5244, lng: 3.3792 },
        { lat: 6.5300, lng: 3.3800 }
      );

      expect(match).toBeNull();
    });

    it("should prioritize female drivers when preference is PREFER_FEMALE", async () => {
      await womenSafety.enableWomenSafetyMode("rider_3");
      await womenSafety.setDriverGenderPreference("rider_3", "PREFER_FEMALE");

      const availableDrivers = [
        { id: "driver_m1", gender: "male", rating: 4.9, distance: 200 },
        { id: "driver_f1", gender: "female", rating: 4.5, distance: 800 },
      ];

      const match = await womenSafety.matchFemaleDriver(
        "rider_3",
        availableDrivers,
        { lat: 6.5244, lng: 3.3792 },
        { lat: 6.5300, lng: 3.3800 }
      );

      // Should prefer female driver even if male is closer
      expect(match?.matchedDriver.gender).toBe("female");
    });
  });

  describe("pinVerification", () => {
    it("should generate trip PIN", async () => {
      const tripPin = await womenSafety.generateTripPin("trip_1", "rider_1");

      expect(tripPin).toBeDefined();
      expect(tripPin.tripId).toBe("trip_1");
      expect(tripPin.riderId).toBe("rider_1");
      expect(tripPin.pin).toHaveLength(4);
      expect(tripPin.expiresAt).toBeDefined();
    });

    it("should verify correct PIN", async () => {
      const tripPin = await womenSafety.generateTripPin("trip_pin_1", "rider_pin_1");
      
      const result = await womenSafety.verifyTripPin("trip_pin_1", tripPin.pin);

      expect(result.verified).toBe(true);
    });

    it("should reject incorrect PIN", async () => {
      await womenSafety.generateTripPin("trip_pin_2", "rider_pin_2");
      
      const result = await womenSafety.verifyTripPin("trip_pin_2", "0000");

      expect(result.verified).toBe(false);
      expect(result.attemptsRemaining).toBeDefined();
    });

    it("should check if PIN is required based on preferences", async () => {
      await womenSafety.enableWomenSafetyMode("rider_pin_check");
      await womenSafety.updatePreferences("rider_pin_check", {
        requirePinVerification: true,
      });

      const required = await womenSafety.shouldRequirePin("rider_pin_check", {
        isNightTime: false,
        isCashTrip: false,
        tripDuration: 15,
        driverRating: 4.8,
      });

      expect(required).toBe(true);
    });
  });

  describe("autoTripSharing", () => {
    it("should setup auto share with contacts", async () => {
      await womenSafety.enableWomenSafetyMode("rider_share");
      await womenSafety.setupAutoShare("rider_share", ["contact_1", "contact_2"]);

      const prefs = await womenSafety.getPreferences("rider_share");
      expect(prefs.autoShareTrips).toBe(true);
      expect(prefs.autoShareContacts).toContain("contact_1");
      expect(prefs.autoShareContacts).toContain("contact_2");
    });

    it("should auto share trip when enabled", async () => {
      await womenSafety.enableWomenSafetyMode("rider_auto");
      await womenSafety.setupAutoShare("rider_auto", ["contact_1"]);

      const session = await womenSafety.autoShareTrip("trip_auto", "rider_auto");

      expect(session).toBeDefined();
      expect(session?.tripId).toBe("trip_auto");
      expect(session?.isActive).toBe(true);
    });

    it("should end trip share and notify contacts", async () => {
      await womenSafety.enableWomenSafetyMode("rider_end");
      await womenSafety.setupAutoShare("rider_end", ["contact_1"]);
      await womenSafety.autoShareTrip("trip_end", "rider_end");

      await womenSafety.endTripShare("trip_end");

      // Verify notification was called
      expect(notificationClient.notifyTripEnded).toHaveBeenCalled();
    });
  });

  describe("safeWordDetection", () => {
    it("should configure safe words", async () => {
      await womenSafety.setSafeWords("user_safe", ["help me", "code red"]);

      const prefs = await womenSafety.getPreferences("user_safe");
      expect(prefs.safeWords).toContain("help me");
      expect(prefs.safeWords).toContain("code red");
    });

    it("should detect safe word in message", async () => {
      await womenSafety.setSafeWords("user_detect", ["emergency", "help me"]);

      const result = await womenSafety.detectSafeWord(
        "user_detect",
        "I need help me now please"
      );

      expect(result.detected).toBe(true);
      expect(result.word).toBe("help me");
    });

    it("should not detect safe word when not present", async () => {
      await womenSafety.setSafeWords("user_no_detect", ["emergency"]);

      const result = await womenSafety.detectSafeWord(
        "user_no_detect",
        "Everything is fine"
      );

      expect(result.detected).toBe(false);
    });
  });

  describe("quietHours", () => {
    it("should configure quiet hours", async () => {
      await womenSafety.configureQuietHours("user_quiet", true, "22:00", "06:00");

      const prefs = await womenSafety.getPreferences("user_quiet");
      expect(prefs.quietHoursEnabled).toBe(true);
      expect(prefs.quietHoursStart).toBe("22:00");
      expect(prefs.quietHoursEnd).toBe("06:00");
    });
  });

  describe("trustedContacts", () => {
    it("should add trusted contact", async () => {
      const contactId = await womenSafety.addTrustedContact("user_trusted", {
        name: "Mom",
        phoneNumber: "+234800000001",
        relationship: "parent",
      });

      expect(contactId).toBeDefined();
    });

    it("should remove trusted contact", async () => {
      const contactId = await womenSafety.addTrustedContact("user_remove", {
        name: "Friend",
        phoneNumber: "+234800000002",
        relationship: "friend",
      });

      await womenSafety.removeTrustedContact("user_remove", contactId);

      const contacts = await womenSafety.getTrustedContacts("user_remove");
      const found = contacts.find((c) => c.id === contactId);
      expect(found).toBeUndefined();
    });
  });

  describe("silentSOS", () => {
    it("should trigger silent SOS", async () => {
      const eventEmitted = new Promise<void>((resolve) => {
        womenSafety.on("silent_sos", () => resolve());
      });

      await womenSafety.triggerSilentSOS("user_silent", "trip_silent");

      // Should emit event
      await expect(eventEmitted).resolves.toBeUndefined();
    });
  });
});
