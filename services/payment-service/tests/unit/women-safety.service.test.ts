/**
 * Women Safety Service Unit Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notificationClient } from "../../src/lib/notification-client";
import { WomenSafetyService } from "../../src/services/women-safety.service";

// Mock the notification client
vi.mock("../../src/lib/notification-client", () => ({
  notificationClient: {
    notifyTripShared: vi.fn().mockResolvedValue({ success: true }),
    notifyTripEnded: vi.fn().mockResolvedValue({ success: true }),
    sendEmergencyPush: vi.fn().mockResolvedValue({ success: true }),
  },
}));

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
      const preferences = await womenSafety.getPreferences("user_1");

      expect(preferences.womenSafetyModeEnabled).toBe(true);
    });

    it("should disable women safety mode", async () => {
      await womenSafety.enableWomenSafetyMode("user_2");
      await womenSafety.disableWomenSafetyMode("user_2");
      const preferences = await womenSafety.getPreferences("user_2");

      expect(preferences.womenSafetyModeEnabled).toBe(false);
    });

    it("should update gender preference", async () => {
      await womenSafety.updatePreferences("user_3", {
        genderPreference: "FEMALE_ONLY",
      });
      const preferences = await womenSafety.getPreferences("user_3");

      expect(preferences.genderPreference).toBe("FEMALE_ONLY");
    });
  });

  describe("femaleDriverMatching", () => {
    it("should find female drivers based on location", async () => {
      await womenSafety.enableWomenSafetyMode("rider_1");

      const matches = await womenSafety.findFemaleDrivers({
        location: { lat: 6.5244, lng: 3.3792 },
        radius: 5000,
        minRating: 4,
      });

      // Matches array should be defined (may be empty if no registered drivers)
      expect(Array.isArray(matches)).toBe(true);
    });

    it("should check gender preference match", async () => {
      await womenSafety.enableWomenSafetyMode("rider_2");
      await womenSafety.updatePreferences("rider_2", {
        genderPreference: "FEMALE_ONLY",
      });

      const result = await womenSafety.checkGenderPreferenceMatch(
        "rider_2",
        "driver_1",
      );

      expect(result).toBeDefined();
      expect(result.preference).toBe("FEMALE_ONLY");
    });

    it("should allow any driver when preference is NO_PREFERENCE", async () => {
      await womenSafety.updatePreferences("rider_3", {
        genderPreference: "NO_PREFERENCE",
      });

      const result = await womenSafety.checkGenderPreferenceMatch(
        "rider_3",
        "driver_1",
      );

      expect(result.matches).toBe(true);
    });
  });

  describe("pinVerification", () => {
    it("should generate trip PIN", async () => {
      const tripPin = await womenSafety.generateTripPin("trip_1", "rider_1");

      expect(tripPin).toBeDefined();
      expect(tripPin.tripId).toBe("trip_1");
      expect(tripPin.pin).toBeDefined();
      expect(tripPin.expiresAt).toBeDefined();
    });

    it("should verify correct PIN", async () => {
      const tripPin = await womenSafety.generateTripPin(
        "trip_pin_1",
        "rider_pin_1",
      );

      const result = await womenSafety.verifyTripPin("trip_pin_1", tripPin.pin);

      expect(result.valid).toBe(true);
    });

    it("should reject incorrect PIN", async () => {
      await womenSafety.generateTripPin("trip_pin_2", "rider_pin_2");

      const result = await womenSafety.verifyTripPin("trip_pin_2", "0000");

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should check if PIN is required based on preferences", async () => {
      await womenSafety.enableWomenSafetyMode("rider_pin_check");
      await womenSafety.updatePreferences("rider_pin_check", {
        pinVerificationEnabled: true,
      });

      const required = await womenSafety.shouldRequirePin("rider_pin_check", {
        pickupLocation: { lat: 6.5244, lng: 3.3792 },
        dropoffLocation: { lat: 6.53, lng: 3.38 },
        estimatedDuration: 15,
        hasHighRiskZones: false,
      });

      expect(required).toBe(true);
    });
  });

  describe("autoTripSharing", () => {
    it("should setup auto share with contacts", async () => {
      await womenSafety.enableWomenSafetyMode("rider_share");
      await womenSafety.setupAutoShare("rider_share", [
        "contact_1",
        "contact_2",
      ]);

      const prefs = await womenSafety.getPreferences("rider_share");
      expect(prefs.autoShareTrips).toBe(true);
      expect(prefs.autoShareContacts).toContain("contact_1");
      expect(prefs.autoShareContacts).toContain("contact_2");
    });

    it("should auto share trip when enabled", async () => {
      await womenSafety.enableWomenSafetyMode("rider_auto");
      await womenSafety.setupAutoShare("rider_auto", ["contact_1"]);

      const session = await womenSafety.autoShareTrip(
        "trip_auto",
        "rider_auto",
      );

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
        "I need help me now please",
      );

      expect(result.detected).toBe(true);
      expect(result.word).toBe("help me");
    });

    it("should not detect safe word when not present", async () => {
      await womenSafety.setSafeWords("user_no_detect", ["emergency"]);

      const result = await womenSafety.detectSafeWord(
        "user_no_detect",
        "Everything is fine",
      );

      expect(result.detected).toBe(false);
    });
  });

  describe("quietHours", () => {
    it("should configure quiet hours", async () => {
      await womenSafety.configureQuietHours(
        "user_quiet",
        true,
        "22:00",
        "06:00",
      );

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
      const handleSOS = vi.fn();
      womenSafety.on("silent_sos", handleSOS);

      await womenSafety.triggerSilentSOS("user_silent", "trip_silent");

      expect(handleSOS).toHaveBeenCalled();
    });
  });
});
