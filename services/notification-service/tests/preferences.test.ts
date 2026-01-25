/**
 * Notification Preferences Tests
 *
 * Tests user notification preferences management.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Enums
enum NotificationChannel {
  SMS = "SMS",
  EMAIL = "EMAIL",
  PUSH = "PUSH",
  IN_APP = "IN_APP",
  WHATSAPP = "WHATSAPP",
}

enum NotificationType {
  ORDER_CONFIRMATION = "ORDER_CONFIRMATION",
  ORDER_STATUS = "ORDER_STATUS",
  DELIVERY_UPDATE = "DELIVERY_UPDATE",
  PAYMENT_SUCCESS = "PAYMENT_SUCCESS",
  PAYMENT_FAILED = "PAYMENT_FAILED",
  PROMOTIONAL = "PROMOTIONAL",
  ACCOUNT_UPDATE = "ACCOUNT_UPDATE",
}

// Schemas
const updatePreferencesSchema = z.object({
  smsEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  quietHoursStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
  quietHoursEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
  timezone: z.string().optional(),
  language: z.string().min(2).max(5).optional(),
  categoryPreferences: z.record(z.boolean()).optional(),
});

const channelPreferenceSchema = z.object({
  channel: z.nativeEnum(NotificationChannel),
  enabled: z.boolean(),
  types: z.array(z.nativeEnum(NotificationType)).optional(),
});

describe("Preferences Schema Validation", () => {
  describe("updatePreferencesSchema", () => {
    it("should validate valid preferences", () => {
      const result = updatePreferencesSchema.safeParse({
        smsEnabled: true,
        emailEnabled: true,
        pushEnabled: true,
        inAppEnabled: true,
        whatsappEnabled: false,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
        timezone: "Africa/Lagos",
        language: "en",
        categoryPreferences: {
          promotional: false,
          orderUpdates: true,
        },
      });
      expect(result.success).toBe(true);
    });

    it("should allow partial updates", () => {
      const result = updatePreferencesSchema.safeParse({
        pushEnabled: false,
      });
      expect(result.success).toBe(true);
    });

    it("should validate quiet hours format", () => {
      const validTimes = ["00:00", "12:30", "23:59"];
      validTimes.forEach((time) => {
        const result = updatePreferencesSchema.safeParse({
          quietHoursStart: time,
        });
        expect(result.success).toBe(true);
      });
    });

    it("should reject invalid quiet hours format", () => {
      const invalidTimes = ["25:00", "12:60", "9:00", "12"];
      invalidTimes.forEach((time) => {
        const result = updatePreferencesSchema.safeParse({
          quietHoursStart: time,
        });
        expect(result.success).toBe(false);
      });
    });

    it("should validate language code length", () => {
      const result = updatePreferencesSchema.safeParse({
        language: "en",
      });
      expect(result.success).toBe(true);

      const resultLong = updatePreferencesSchema.safeParse({
        language: "en-US",
      });
      expect(resultLong.success).toBe(true);

      const resultTooLong = updatePreferencesSchema.safeParse({
        language: "en-US-extra",
      });
      expect(resultTooLong.success).toBe(false);
    });
  });

  describe("channelPreferenceSchema", () => {
    it("should validate channel preference", () => {
      const result = channelPreferenceSchema.safeParse({
        channel: NotificationChannel.PUSH,
        enabled: true,
        types: [
          NotificationType.ORDER_STATUS,
          NotificationType.DELIVERY_UPDATE,
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should validate all channels", () => {
      Object.values(NotificationChannel).forEach((channel) => {
        const result = channelPreferenceSchema.safeParse({
          channel,
          enabled: true,
        });
        expect(result.success).toBe(true);
      });
    });
  });
});

describe("Preference Logic", () => {
  interface UserPreferences {
    smsEnabled: boolean;
    emailEnabled: boolean;
    pushEnabled: boolean;
    inAppEnabled: boolean;
    whatsappEnabled: boolean;
    quietHoursStart?: string;
    quietHoursEnd?: string;
    timezone: string;
    categoryPreferences: Record<string, boolean>;
  }

  function isChannelEnabled(
    preferences: UserPreferences,
    channel: NotificationChannel,
  ): boolean {
    switch (channel) {
      case NotificationChannel.SMS:
        return preferences.smsEnabled;
      case NotificationChannel.EMAIL:
        return preferences.emailEnabled;
      case NotificationChannel.PUSH:
        return preferences.pushEnabled;
      case NotificationChannel.IN_APP:
        return preferences.inAppEnabled;
      case NotificationChannel.WHATSAPP:
        return preferences.whatsappEnabled;
      default:
        return false;
    }
  }

  function isCategoryEnabled(
    preferences: UserPreferences,
    category: string,
  ): boolean {
    // Default to true if not explicitly set
    return preferences.categoryPreferences[category] !== false;
  }

  function isInQuietHours(
    preferences: UserPreferences,
    currentTime: Date,
  ): boolean {
    if (!preferences.quietHoursStart || !preferences.quietHoursEnd) {
      return false;
    }

    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    const currentMinutes = hours * 60 + minutes;

    const [startHour, startMin] = preferences.quietHoursStart
      .split(":")
      .map(Number);
    const [endHour, endMin] = preferences.quietHoursEnd.split(":").map(Number);

    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    // Handle overnight quiet hours (e.g., 22:00 - 08:00)
    if (startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  const defaultPreferences: UserPreferences = {
    smsEnabled: true,
    emailEnabled: true,
    pushEnabled: true,
    inAppEnabled: true,
    whatsappEnabled: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
    timezone: "Africa/Lagos",
    categoryPreferences: {
      promotional: false,
      orderUpdates: true,
    },
  };

  it("should check channel enabled status", () => {
    expect(isChannelEnabled(defaultPreferences, NotificationChannel.SMS)).toBe(
      true,
    );
    expect(
      isChannelEnabled(defaultPreferences, NotificationChannel.WHATSAPP),
    ).toBe(false);
  });

  it("should check category enabled status", () => {
    expect(isCategoryEnabled(defaultPreferences, "orderUpdates")).toBe(true);
    expect(isCategoryEnabled(defaultPreferences, "promotional")).toBe(false);
    // Unknown category defaults to true
    expect(isCategoryEnabled(defaultPreferences, "unknown")).toBe(true);
  });

  it("should detect quiet hours (overnight)", () => {
    // 23:00 - should be in quiet hours
    const lateNight = new Date();
    lateNight.setHours(23, 0, 0, 0);
    expect(isInQuietHours(defaultPreferences, lateNight)).toBe(true);

    // 07:00 - should be in quiet hours
    const earlyMorning = new Date();
    earlyMorning.setHours(7, 0, 0, 0);
    expect(isInQuietHours(defaultPreferences, earlyMorning)).toBe(true);

    // 12:00 - should not be in quiet hours
    const midday = new Date();
    midday.setHours(12, 0, 0, 0);
    expect(isInQuietHours(defaultPreferences, midday)).toBe(false);
  });

  it("should handle no quiet hours set", () => {
    const noQuietHours: UserPreferences = {
      ...defaultPreferences,
      quietHoursStart: undefined,
      quietHoursEnd: undefined,
    };

    const anyTime = new Date();
    expect(isInQuietHours(noQuietHours, anyTime)).toBe(false);
  });
});

describe("Notification Delivery Decision", () => {
  interface DeliveryDecision {
    shouldSend: boolean;
    reason?: string;
    suggestedChannel?: NotificationChannel;
  }

  interface UserPreferences {
    smsEnabled: boolean;
    emailEnabled: boolean;
    pushEnabled: boolean;
    inAppEnabled: boolean;
    quietHoursStart?: string;
    quietHoursEnd?: string;
    categoryPreferences: Record<string, boolean>;
  }

  function shouldDeliverNotification(
    preferences: UserPreferences,
    channel: NotificationChannel,
    category: string,
    isPriority: boolean,
    isInQuietHours: boolean,
  ): DeliveryDecision {
    // In-app notifications are always allowed
    if (channel === NotificationChannel.IN_APP) {
      return { shouldSend: true };
    }

    // Check if channel is enabled
    const channelEnabled = {
      [NotificationChannel.SMS]: preferences.smsEnabled,
      [NotificationChannel.EMAIL]: preferences.emailEnabled,
      [NotificationChannel.PUSH]: preferences.pushEnabled,
      [NotificationChannel.IN_APP]: preferences.inAppEnabled,
      [NotificationChannel.WHATSAPP]: false,
    }[channel];

    if (!channelEnabled) {
      return {
        shouldSend: false,
        reason: "Channel disabled by user",
        suggestedChannel: NotificationChannel.IN_APP,
      };
    }

    // Check category preference
    if (preferences.categoryPreferences[category] === false) {
      return {
        shouldSend: false,
        reason: "Category disabled by user",
      };
    }

    // Check quiet hours (priority messages can bypass)
    if (isInQuietHours && !isPriority) {
      return {
        shouldSend: false,
        reason: "User is in quiet hours",
        suggestedChannel: NotificationChannel.IN_APP,
      };
    }

    return { shouldSend: true };
  }

  const preferences: UserPreferences = {
    smsEnabled: true,
    emailEnabled: false,
    pushEnabled: true,
    inAppEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
    categoryPreferences: {
      promotional: false,
      orderUpdates: true,
    },
  };

  it("should allow delivery when all conditions met", () => {
    const decision = shouldDeliverNotification(
      preferences,
      NotificationChannel.PUSH,
      "orderUpdates",
      false,
      false,
    );
    expect(decision.shouldSend).toBe(true);
  });

  it("should block disabled channel", () => {
    const decision = shouldDeliverNotification(
      preferences,
      NotificationChannel.EMAIL,
      "orderUpdates",
      false,
      false,
    );
    expect(decision.shouldSend).toBe(false);
    expect(decision.reason).toContain("Channel disabled");
  });

  it("should block disabled category", () => {
    const decision = shouldDeliverNotification(
      preferences,
      NotificationChannel.PUSH,
      "promotional",
      false,
      false,
    );
    expect(decision.shouldSend).toBe(false);
    expect(decision.reason).toContain("Category disabled");
  });

  it("should block during quiet hours", () => {
    const decision = shouldDeliverNotification(
      preferences,
      NotificationChannel.PUSH,
      "orderUpdates",
      false,
      true,
    );
    expect(decision.shouldSend).toBe(false);
    expect(decision.reason).toContain("quiet hours");
  });

  it("should allow priority messages during quiet hours", () => {
    const decision = shouldDeliverNotification(
      preferences,
      NotificationChannel.PUSH,
      "orderUpdates",
      true, // priority
      true, // quiet hours
    );
    expect(decision.shouldSend).toBe(true);
  });

  it("should always allow in-app notifications", () => {
    const decision = shouldDeliverNotification(
      preferences,
      NotificationChannel.IN_APP,
      "promotional", // disabled category
      false,
      true, // quiet hours
    );
    expect(decision.shouldSend).toBe(true);
  });
});

describe("Preference Migration", () => {
  interface LegacyPreferences {
    notifications: boolean;
    marketing: boolean;
  }

  interface NewPreferences {
    smsEnabled: boolean;
    emailEnabled: boolean;
    pushEnabled: boolean;
    inAppEnabled: boolean;
    categoryPreferences: Record<string, boolean>;
  }

  function migrateLegacyPreferences(legacy: LegacyPreferences): NewPreferences {
    return {
      smsEnabled: legacy.notifications,
      emailEnabled: legacy.notifications,
      pushEnabled: legacy.notifications,
      inAppEnabled: true, // Always enable in-app
      categoryPreferences: {
        orderUpdates: legacy.notifications,
        accountUpdates: legacy.notifications,
        promotional: legacy.marketing,
      },
    };
  }

  it("should migrate enabled notifications", () => {
    const legacy: LegacyPreferences = {
      notifications: true,
      marketing: false,
    };

    const migrated = migrateLegacyPreferences(legacy);
    expect(migrated.smsEnabled).toBe(true);
    expect(migrated.emailEnabled).toBe(true);
    expect(migrated.categoryPreferences.promotional).toBe(false);
  });

  it("should migrate disabled notifications", () => {
    const legacy: LegacyPreferences = {
      notifications: false,
      marketing: false,
    };

    const migrated = migrateLegacyPreferences(legacy);
    expect(migrated.smsEnabled).toBe(false);
    expect(migrated.inAppEnabled).toBe(true); // Always true
  });
});

describe("Preference Defaults", () => {
  function getDefaultPreferences(
    userType: "customer" | "driver" | "restaurant",
  ): Record<string, any> {
    const base = {
      smsEnabled: true,
      emailEnabled: true,
      pushEnabled: true,
      inAppEnabled: true,
      whatsappEnabled: false,
      timezone: "Africa/Lagos",
      language: "en",
    };

    const categoryDefaults = {
      customer: {
        orderUpdates: true,
        deliveryUpdates: true,
        promotional: true,
        accountUpdates: true,
      },
      driver: {
        rideRequests: true,
        earningsUpdates: true,
        promotional: false, // Drivers opt-out by default
        accountUpdates: true,
      },
      restaurant: {
        newOrders: true,
        orderUpdates: true,
        promotional: false,
        accountUpdates: true,
      },
    };

    return {
      ...base,
      categoryPreferences: categoryDefaults[userType],
    };
  }

  it("should return customer defaults", () => {
    const prefs = getDefaultPreferences("customer");
    expect(prefs.categoryPreferences.promotional).toBe(true);
    expect(prefs.categoryPreferences.orderUpdates).toBe(true);
  });

  it("should return driver defaults", () => {
    const prefs = getDefaultPreferences("driver");
    expect(prefs.categoryPreferences.promotional).toBe(false);
    expect(prefs.categoryPreferences.rideRequests).toBe(true);
  });

  it("should return restaurant defaults", () => {
    const prefs = getDefaultPreferences("restaurant");
    expect(prefs.categoryPreferences.newOrders).toBe(true);
    expect(prefs.categoryPreferences.promotional).toBe(false);
  });
});

describe("Bulk Preference Updates", () => {
  interface BulkUpdate {
    userIds: string[];
    preferences: Partial<Record<string, any>>;
  }

  function validateBulkUpdate(update: BulkUpdate): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (update.userIds.length === 0) {
      errors.push("At least one user ID required");
    }

    if (update.userIds.length > 1000) {
      errors.push("Cannot update more than 1000 users at once");
    }

    if (Object.keys(update.preferences).length === 0) {
      errors.push("At least one preference must be specified");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  it("should validate valid bulk update", () => {
    const update: BulkUpdate = {
      userIds: ["user_1", "user_2"],
      preferences: { promotional: false },
    };

    const result = validateBulkUpdate(update);
    expect(result.valid).toBe(true);
  });

  it("should reject empty user list", () => {
    const update: BulkUpdate = {
      userIds: [],
      preferences: { promotional: false },
    };

    const result = validateBulkUpdate(update);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("At least one user ID required");
  });

  it("should reject oversized user list", () => {
    const update: BulkUpdate = {
      userIds: new Array(1001).fill("user_1"),
      preferences: { promotional: false },
    };

    const result = validateBulkUpdate(update);
    expect(result.valid).toBe(false);
  });

  it("should reject empty preferences", () => {
    const update: BulkUpdate = {
      userIds: ["user_1"],
      preferences: {},
    };

    const result = validateBulkUpdate(update);
    expect(result.valid).toBe(false);
  });
});
