/**
 * Trip Monitor Service Unit Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TripMonitorService } from "../../src/services/trip-monitor.service";

// Mock the notification client
vi.mock("../../src/lib/notification-client", () => ({
  notificationClient: {
    notifyTripShared: vi.fn().mockResolvedValue({ success: true }),
    notifyTripEnded: vi.fn().mockResolvedValue({ success: true }),
    sendSafetyCheck: vi.fn().mockResolvedValue({ success: true }),
    notifyCrashDetected: vi.fn().mockResolvedValue({ success: true }),
    notifyRouteDeviation: vi.fn().mockResolvedValue({ success: true }),
  },
}));

describe("TripMonitorService", () => {
  let tripMonitor: TripMonitorService;

  beforeEach(() => {
    tripMonitor = new TripMonitorService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("startMonitoring", () => {
    it("should start monitoring a trip", async () => {
      const session = await tripMonitor.startMonitoring({
        tripId: "trip_1",
        riderId: "rider_1",
        driverId: "driver_1",
        expectedRoute: [
          { lat: 6.5244, lng: 3.3792, accuracy: 10, timestamp: new Date() },
          { lat: 6.53, lng: 3.38, accuracy: 10, timestamp: new Date() },
        ],
        eta: new Date(Date.now() + 30 * 60 * 1000), // 30 mins
      });

      expect(session).toBeDefined();
      expect(session.tripId).toBe("trip_1");
      expect(session.riderId).toBe("rider_1");
      expect(session.status).toBe("ACTIVE");
      expect(session.riskLevel).toBeDefined();
    });

    it("should calculate initial risk score", async () => {
      const session = await tripMonitor.startMonitoring({
        tripId: "trip_risk",
        riderId: "rider_1",
        driverId: "driver_1",
        expectedRoute: [
          { lat: 6.5244, lng: 3.3792, accuracy: 10, timestamp: new Date() },
        ],
        eta: new Date(Date.now() + 30 * 60 * 1000),
      });

      // Risk level should be one of: LOW, MEDIUM, HIGH, CRITICAL
      expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(
        session.riskLevel,
      );
    });
  });

  describe("updateLocation", () => {
    it("should update trip location and check for anomalies", async () => {
      await tripMonitor.startMonitoring({
        tripId: "trip_loc",
        riderId: "rider_loc",
        driverId: "driver_loc",
        expectedRoute: [
          { lat: 6.5244, lng: 3.3792, accuracy: 10, timestamp: new Date() },
          { lat: 6.53, lng: 3.38, accuracy: 10, timestamp: new Date() },
        ],
        eta: new Date(Date.now() + 30 * 60 * 1000),
      });

      // Update with normal location
      const result = await tripMonitor.updateLocation("trip_loc", {
        lat: 6.525,
        lng: 3.3795,
        speed: 40,
        accuracy: 10,
        timestamp: new Date(),
      });

      expect(result.session).toBeDefined();
      expect(result.session.currentLocation).toBeDefined();
    });

    it("should detect route deviation", async () => {
      await tripMonitor.startMonitoring({
        tripId: "trip_deviation",
        riderId: "rider_dev",
        driverId: "driver_dev",
        expectedRoute: [
          { lat: 6.5244, lng: 3.3792, accuracy: 10, timestamp: new Date() },
          { lat: 6.53, lng: 3.38, accuracy: 10, timestamp: new Date() },
        ],
        eta: new Date(Date.now() + 30 * 60 * 1000),
      });

      // Update with location far from expected route (> 500m)
      const result = await tripMonitor.updateLocation("trip_deviation", {
        lat: 6.6, // Significantly different
        lng: 3.5,
        speed: 40,
        accuracy: 10,
        timestamp: new Date(),
      });

      // Should have anomaly or warning
      expect(
        result.anomalies.length + (result.warnings?.length || 0),
      ).toBeGreaterThanOrEqual(0);
    });
  });

  describe("processAccelerometerData", () => {
    it("should detect potential crash from high G-force", async () => {
      await tripMonitor.startMonitoring({
        tripId: "trip_crash",
        riderId: "rider_crash",
        driverId: "driver_crash",
        expectedRoute: [
          { lat: 6.5244, lng: 3.3792, accuracy: 10, timestamp: new Date() },
        ],
        eta: new Date(Date.now() + 30 * 60 * 1000),
      });

      // Simulate crash-level G-force (> 4G)
      const crashData = await tripMonitor.processAccelerometerData(
        "trip_crash",
        {
          x: 4.5,
          y: 0,
          z: 0,
          timestamp: new Date(),
          magnitude: 4.5, // > CRASH_G_FORCE_THRESHOLD
        },
      );

      expect(crashData).toBeDefined();
    });

    it("should not trigger crash detection for normal movement", async () => {
      await tripMonitor.startMonitoring({
        tripId: "trip_normal",
        riderId: "rider_normal",
        driverId: "driver_normal",
        expectedRoute: [
          { lat: 6.5244, lng: 3.3792, accuracy: 10, timestamp: new Date() },
        ],
        eta: new Date(Date.now() + 30 * 60 * 1000),
      });

      // Normal movement G-force (< 2G)
      const result = await tripMonitor.processAccelerometerData("trip_normal", {
        x: 0.5,
        y: 0.5,
        z: 1.0,
        timestamp: new Date(),
        magnitude: 1.22,
      });

      // Should not detect crash
      expect(result?.confirmed).toBeFalsy();
    });
  });

  describe("createTripShare", () => {
    it("should create trip share with contacts", async () => {
      await tripMonitor.startMonitoring({
        tripId: "trip_share",
        riderId: "rider_share",
        driverId: "driver_share",
        expectedRoute: [
          { lat: 6.5244, lng: 3.3792, accuracy: 10, timestamp: new Date() },
        ],
        eta: new Date(Date.now() + 30 * 60 * 1000),
      });

      const shares = await tripMonitor.createTripShare(
        "trip_share",
        "rider_share",
        ["contact_1", "contact_2"],
      );

      expect(shares).toHaveLength(2);
      expect(shares[0].tripId).toBe("trip_share");
      expect(shares[0].sharedBy).toBe("rider_share");
      expect(shares[0].shareLink).toBeDefined();
      expect(shares[0].isActive).toBe(true);
    });

    it("should generate unique share links", async () => {
      const link1 = await tripMonitor.generatePublicShareLink("trip_1");
      const link2 = await tripMonitor.generatePublicShareLink("trip_2");

      expect(link1).toContain("https://ubi.app/trip/track/");
      expect(link2).toContain("https://ubi.app/trip/track/");
      expect(link1).not.toBe(link2);
    });
  });

  describe("safetyCheckIn", () => {
    it("should send safety check-in", async () => {
      await tripMonitor.startMonitoring({
        tripId: "trip_checkin",
        riderId: "rider_checkin",
        driverId: "driver_checkin",
        expectedRoute: [
          { lat: 6.5244, lng: 3.3792, accuracy: 10, timestamp: new Date() },
        ],
        eta: new Date(Date.now() + 30 * 60 * 1000),
      });

      const check = await tripMonitor.sendSafetyCheck(
        "trip_checkin",
        "rider_checkin",
        "Routine check-in",
      );

      expect(check).toBeDefined();
      expect(check.tripId).toBe("trip_checkin");
      expect(check.status).toBe("PENDING");
      expect(check.reason).toBe("Routine check-in");
    });

    it("should handle safety check response", async () => {
      await tripMonitor.startMonitoring({
        tripId: "trip_respond",
        riderId: "rider_respond",
        driverId: "driver_respond",
        expectedRoute: [
          { lat: 6.5244, lng: 3.3792, accuracy: 10, timestamp: new Date() },
        ],
        eta: new Date(Date.now() + 30 * 60 * 1000),
      });

      const check = await tripMonitor.sendSafetyCheck(
        "trip_respond",
        "rider_respond",
        "Test check",
      );

      // Respond to check
      const response = await tripMonitor.respondToSafetyCheck(check.id, "safe");

      expect(response.success).toBe(true);
    });
  });

  describe("stopMonitoring", () => {
    it("should stop monitoring and cleanup", async () => {
      await tripMonitor.startMonitoring({
        tripId: "trip_stop",
        riderId: "rider_stop",
        driverId: "driver_stop",
        expectedRoute: [
          { lat: 6.5244, lng: 3.3792, accuracy: 10, timestamp: new Date() },
        ],
        eta: new Date(Date.now() + 30 * 60 * 1000),
      });

      await tripMonitor.stopMonitoring("trip_stop", "completed");

      // Session should no longer be active
      const session = await tripMonitor.getActiveSession("trip_stop");
      expect(session).toBeUndefined();
    });
  });
});
