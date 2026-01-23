/**
 * Notification Types Tests
 */

import { describe, expect, it } from "vitest";
import {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  NotificationType,
} from "./index";

describe("Notification Enums", () => {
  describe("NotificationChannel", () => {
    it("should have all expected channels", () => {
      expect(NotificationChannel.PUSH).toBe("PUSH");
      expect(NotificationChannel.SMS).toBe("SMS");
      expect(NotificationChannel.EMAIL).toBe("EMAIL");
      expect(NotificationChannel.IN_APP).toBe("IN_APP");
    });

    it("should have exactly 4 channels", () => {
      const channels = Object.values(NotificationChannel);
      expect(channels).toHaveLength(4);
    });
  });

  describe("NotificationType", () => {
    it("should have account types", () => {
      expect(NotificationType.WELCOME).toBe("WELCOME");
      expect(NotificationType.EMAIL_VERIFICATION).toBe("EMAIL_VERIFICATION");
      expect(NotificationType.PASSWORD_RESET).toBe("PASSWORD_RESET");
      expect(NotificationType.OTP).toBe("OTP");
    });

    it("should have ride types", () => {
      expect(NotificationType.RIDE_REQUESTED).toBe("RIDE_REQUESTED");
      expect(NotificationType.RIDE_ACCEPTED).toBe("RIDE_ACCEPTED");
      expect(NotificationType.DRIVER_ARRIVING).toBe("DRIVER_ARRIVING");
      expect(NotificationType.RIDE_COMPLETED).toBe("RIDE_COMPLETED");
    });

    it("should have food order types", () => {
      expect(NotificationType.ORDER_PLACED).toBe("ORDER_PLACED");
      expect(NotificationType.ORDER_CONFIRMED).toBe("ORDER_CONFIRMED");
      expect(NotificationType.ORDER_PREPARING).toBe("ORDER_PREPARING");
      expect(NotificationType.ORDER_DELIVERED).toBe("ORDER_DELIVERED");
    });

    it("should have delivery types", () => {
      expect(NotificationType.DELIVERY_CREATED).toBe("DELIVERY_CREATED");
      expect(NotificationType.DELIVERY_PICKED_UP).toBe("DELIVERY_PICKED_UP");
      expect(NotificationType.DELIVERY_DELIVERED).toBe("DELIVERY_DELIVERED");
    });

    it("should have payment types", () => {
      expect(NotificationType.PAYMENT_RECEIVED).toBe("PAYMENT_RECEIVED");
      expect(NotificationType.PAYMENT_FAILED).toBe("PAYMENT_FAILED");
      expect(NotificationType.REFUND_PROCESSED).toBe("REFUND_PROCESSED");
    });
  });

  describe("NotificationStatus", () => {
    it("should have all expected statuses", () => {
      expect(NotificationStatus.PENDING).toBe("PENDING");
      expect(NotificationStatus.SENT).toBe("SENT");
      expect(NotificationStatus.DELIVERED).toBe("DELIVERED");
      expect(NotificationStatus.FAILED).toBe("FAILED");
      expect(NotificationStatus.READ).toBe("READ");
    });
  });

  describe("NotificationPriority", () => {
    it("should have all expected priorities", () => {
      expect(NotificationPriority.LOW).toBe("LOW");
      expect(NotificationPriority.NORMAL).toBe("NORMAL");
      expect(NotificationPriority.HIGH).toBe("HIGH");
      expect(NotificationPriority.URGENT).toBe("URGENT");
    });

    it("should have exactly 4 priorities", () => {
      const priorities = Object.values(NotificationPriority);
      expect(priorities).toHaveLength(4);
    });
  });
});
