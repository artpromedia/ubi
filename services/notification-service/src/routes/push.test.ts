/**
 * Push Routes Tests
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Define schemas matching the routes for validation testing
const registerDeviceSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]),
  deviceId: z.string().optional(),
  appVersion: z.string().optional(),
});

const sendPushSchema = z.object({
  userId: z.string(),
  title: z.string().max(100),
  body: z.string().max(500),
  data: z.record(z.any()).optional(),
  image: z.string().url().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  ttl: z.number().int().min(0).max(2419200).optional(), // Max 28 days
  collapseKey: z.string().optional(),
});

const sendBatchPushSchema = z.object({
  userIds: z.array(z.string()).min(1).max(500),
  title: z.string().max(100),
  body: z.string().max(500),
  data: z.record(z.any()).optional(),
  image: z.string().url().optional(),
});

const sendTopicPushSchema = z.object({
  topic: z.string(),
  title: z.string().max(100),
  body: z.string().max(500),
  data: z.record(z.any()).optional(),
});

describe("Push Notification Schema Validation", () => {
  describe("registerDeviceSchema", () => {
    it("should validate valid device registration", () => {
      const validData = {
        token: "fcm_token_abc123",
        platform: "android",
        deviceId: "device-uuid-123",
        appVersion: "1.0.0",
      };

      const result = registerDeviceSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should require token", () => {
      const result = registerDeviceSchema.safeParse({
        platform: "ios",
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty token", () => {
      const result = registerDeviceSchema.safeParse({
        token: "",
        platform: "ios",
      });
      expect(result.success).toBe(false);
    });

    it("should validate platform enum", () => {
      const validPlatforms = ["ios", "android", "web"];
      validPlatforms.forEach((platform) => {
        const result = registerDeviceSchema.safeParse({
          token: "token123",
          platform,
        });
        expect(result.success).toBe(true);
      });
    });

    it("should reject invalid platform", () => {
      const result = registerDeviceSchema.safeParse({
        token: "token123",
        platform: "windows",
      });
      expect(result.success).toBe(false);
    });

    it("should allow optional fields", () => {
      const result = registerDeviceSchema.safeParse({
        token: "token123",
        platform: "ios",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("sendPushSchema", () => {
    it("should validate valid push notification", () => {
      const validPush = {
        userId: "user_123",
        title: "Test Notification",
        body: "This is a test notification body",
        data: { orderId: "order_123" },
        priority: "HIGH",
      };

      const result = sendPushSchema.safeParse(validPush);
      expect(result.success).toBe(true);
    });

    it("should require userId", () => {
      const result = sendPushSchema.safeParse({
        title: "Test",
        body: "Body",
      });
      expect(result.success).toBe(false);
    });

    it("should reject title over 100 chars", () => {
      const result = sendPushSchema.safeParse({
        userId: "user_123",
        title: "a".repeat(101),
        body: "Body",
      });
      expect(result.success).toBe(false);
    });

    it("should reject body over 500 chars", () => {
      const result = sendPushSchema.safeParse({
        userId: "user_123",
        title: "Title",
        body: "a".repeat(501),
      });
      expect(result.success).toBe(false);
    });

    it("should validate image URL", () => {
      const result = sendPushSchema.safeParse({
        userId: "user_123",
        title: "Title",
        body: "Body",
        image: "not-a-url",
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid image URL", () => {
      const result = sendPushSchema.safeParse({
        userId: "user_123",
        title: "Title",
        body: "Body",
        image: "https://example.com/image.jpg",
      });
      expect(result.success).toBe(true);
    });

    it("should default priority to NORMAL", () => {
      const result = sendPushSchema.safeParse({
        userId: "user_123",
        title: "Title",
        body: "Body",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.priority).toBe("NORMAL");
      }
    });

    it("should validate TTL range", () => {
      // TTL too large
      const resultTooLarge = sendPushSchema.safeParse({
        userId: "user_123",
        title: "Title",
        body: "Body",
        ttl: 2419201, // > 28 days
      });
      expect(resultTooLarge.success).toBe(false);

      // Negative TTL
      const resultNegative = sendPushSchema.safeParse({
        userId: "user_123",
        title: "Title",
        body: "Body",
        ttl: -1,
      });
      expect(resultNegative.success).toBe(false);

      // Valid TTL
      const resultValid = sendPushSchema.safeParse({
        userId: "user_123",
        title: "Title",
        body: "Body",
        ttl: 86400, // 1 day
      });
      expect(resultValid.success).toBe(true);
    });
  });

  describe("sendBatchPushSchema", () => {
    it("should validate valid batch push", () => {
      const validBatch = {
        userIds: ["user_1", "user_2", "user_3"],
        title: "Batch Notification",
        body: "This goes to multiple users",
      };

      const result = sendBatchPushSchema.safeParse(validBatch);
      expect(result.success).toBe(true);
    });

    it("should require at least one userId", () => {
      const result = sendBatchPushSchema.safeParse({
        userIds: [],
        title: "Title",
        body: "Body",
      });
      expect(result.success).toBe(false);
    });

    it("should reject more than 500 userIds", () => {
      const result = sendBatchPushSchema.safeParse({
        userIds: Array.from({ length: 501 }, (_, i) => `user_${i}`),
        title: "Title",
        body: "Body",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("sendTopicPushSchema", () => {
    it("should validate valid topic push", () => {
      const validTopic = {
        topic: "promotions",
        title: "New Promotion!",
        body: "Check out our latest deals",
      };

      const result = sendTopicPushSchema.safeParse(validTopic);
      expect(result.success).toBe(true);
    });

    it("should require topic", () => {
      const result = sendTopicPushSchema.safeParse({
        title: "Title",
        body: "Body",
      });
      expect(result.success).toBe(false);
    });

    it("should allow optional data", () => {
      const result = sendTopicPushSchema.safeParse({
        topic: "news",
        title: "Title",
        body: "Body",
        data: { category: "sports" },
      });
      expect(result.success).toBe(true);
    });
  });
});
