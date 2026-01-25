/**
 * SMS Routes Tests
 *
 * Tests SMS sending, OTP generation, and delivery verification.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Schemas
const sendSMSSchema = z.object({
  userId: z.string().optional(),
  phone: z.string().min(10).max(15),
  message: z.string().min(1).max(160),
  senderId: z.string().optional(),
});

const sendBatchSMSSchema = z.object({
  recipients: z
    .array(
      z.object({
        phone: z.string(),
        message: z.string().max(160),
      }),
    )
    .min(1)
    .max(100),
  senderId: z.string().optional(),
});

const sendOTPSchema = z.object({
  userId: z.string().optional(),
  phone: z.string().min(10).max(15),
  purpose: z.enum(["login", "verification", "password_reset", "transaction"]),
  length: z.number().int().min(4).max(8).default(6),
  expiresInMinutes: z.number().int().min(1).max(30).default(5),
});

const verifyOTPSchema = z.object({
  phone: z.string().min(10).max(15),
  code: z.string().min(4).max(8),
  purpose: z.enum(["login", "verification", "password_reset", "transaction"]),
});

describe("SMS Schema Validation", () => {
  describe("sendSMSSchema", () => {
    it("should validate valid SMS", () => {
      const result = sendSMSSchema.safeParse({
        phone: "+2348012345678",
        message: "Your order has been confirmed!",
      });
      expect(result.success).toBe(true);
    });

    it("should validate with userId", () => {
      const result = sendSMSSchema.safeParse({
        userId: "user_123",
        phone: "+2348012345678",
        message: "Hello!",
        senderId: "UBI",
      });
      expect(result.success).toBe(true);
    });

    it("should require phone", () => {
      const result = sendSMSSchema.safeParse({
        message: "Hello!",
      });
      expect(result.success).toBe(false);
    });

    it("should reject phone too short", () => {
      const result = sendSMSSchema.safeParse({
        phone: "12345",
        message: "Hello!",
      });
      expect(result.success).toBe(false);
    });

    it("should reject phone too long", () => {
      const result = sendSMSSchema.safeParse({
        phone: "1234567890123456",
        message: "Hello!",
      });
      expect(result.success).toBe(false);
    });

    it("should require message", () => {
      const result = sendSMSSchema.safeParse({
        phone: "+2348012345678",
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty message", () => {
      const result = sendSMSSchema.safeParse({
        phone: "+2348012345678",
        message: "",
      });
      expect(result.success).toBe(false);
    });

    it("should reject message over 160 chars", () => {
      const result = sendSMSSchema.safeParse({
        phone: "+2348012345678",
        message: "A".repeat(161),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("sendBatchSMSSchema", () => {
    it("should validate valid batch SMS", () => {
      const result = sendBatchSMSSchema.safeParse({
        recipients: [
          { phone: "+2348012345678", message: "Hello 1" },
          { phone: "+2348012345679", message: "Hello 2" },
        ],
        senderId: "UBI",
      });
      expect(result.success).toBe(true);
    });

    it("should require at least one recipient", () => {
      const result = sendBatchSMSSchema.safeParse({
        recipients: [],
      });
      expect(result.success).toBe(false);
    });

    it("should reject more than 100 recipients", () => {
      const recipients = new Array(101).fill({
        phone: "+2348012345678",
        message: "Hello",
      });
      const result = sendBatchSMSSchema.safeParse({ recipients });
      expect(result.success).toBe(false);
    });
  });

  describe("sendOTPSchema", () => {
    it("should validate valid OTP request", () => {
      const result = sendOTPSchema.safeParse({
        phone: "+2348012345678",
        purpose: "login",
      });
      expect(result.success).toBe(true);
    });

    it("should validate all purposes", () => {
      const purposes = [
        "login",
        "verification",
        "password_reset",
        "transaction",
      ];
      purposes.forEach((purpose) => {
        const result = sendOTPSchema.safeParse({
          phone: "+2348012345678",
          purpose,
        });
        expect(result.success).toBe(true);
      });
    });

    it("should reject invalid purpose", () => {
      const result = sendOTPSchema.safeParse({
        phone: "+2348012345678",
        purpose: "invalid",
      });
      expect(result.success).toBe(false);
    });

    it("should apply default OTP length", () => {
      const result = sendOTPSchema.safeParse({
        phone: "+2348012345678",
        purpose: "login",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(6);
      }
    });

    it("should reject OTP length less than 4", () => {
      const result = sendOTPSchema.safeParse({
        phone: "+2348012345678",
        purpose: "login",
        length: 3,
      });
      expect(result.success).toBe(false);
    });

    it("should reject OTP length greater than 8", () => {
      const result = sendOTPSchema.safeParse({
        phone: "+2348012345678",
        purpose: "login",
        length: 10,
      });
      expect(result.success).toBe(false);
    });

    it("should apply default expiry time", () => {
      const result = sendOTPSchema.safeParse({
        phone: "+2348012345678",
        purpose: "login",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.expiresInMinutes).toBe(5);
      }
    });
  });

  describe("verifyOTPSchema", () => {
    it("should validate valid OTP verification", () => {
      const result = verifyOTPSchema.safeParse({
        phone: "+2348012345678",
        code: "123456",
        purpose: "login",
      });
      expect(result.success).toBe(true);
    });

    it("should reject code too short", () => {
      const result = verifyOTPSchema.safeParse({
        phone: "+2348012345678",
        code: "123",
        purpose: "login",
      });
      expect(result.success).toBe(false);
    });

    it("should reject code too long", () => {
      const result = verifyOTPSchema.safeParse({
        phone: "+2348012345678",
        code: "123456789",
        purpose: "login",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("OTP Generation", () => {
  function generateOTP(length: number): string {
    let otp = "";
    for (let i = 0; i < length; i++) {
      otp += Math.floor(Math.random() * 10);
    }
    return otp;
  }

  it("should generate OTP of specified length", () => {
    expect(generateOTP(4).length).toBe(4);
    expect(generateOTP(6).length).toBe(6);
    expect(generateOTP(8).length).toBe(8);
  });

  it("should generate numeric-only OTP", () => {
    const otp = generateOTP(6);
    expect(otp).toMatch(/^\d+$/);
  });

  it("should generate different OTPs", () => {
    const otps = new Set<string>();
    for (let i = 0; i < 100; i++) {
      otps.add(generateOTP(6));
    }
    // With 6 digits, we should have high uniqueness
    expect(otps.size).toBeGreaterThan(90);
  });
});

describe("Phone Number Validation", () => {
  function isValidNigerianPhone(phone: string): boolean {
    const normalized = phone.replaceAll(/\D/g, "");
    // Nigerian numbers: +234XXXXXXXXXX (13 digits with +234)
    // or 0XXXXXXXXXX (11 digits with leading 0)
    if (normalized.startsWith("234")) {
      return normalized.length === 13;
    }
    if (normalized.startsWith("0")) {
      return normalized.length === 11;
    }
    return false;
  }

  function isValidKenyanPhone(phone: string): boolean {
    const normalized = phone.replaceAll(/\D/g, "");
    // Kenyan numbers: +254XXXXXXXXX (12 digits with +254)
    // or 0XXXXXXXXX (10 digits with leading 0)
    if (normalized.startsWith("254")) {
      return normalized.length === 12;
    }
    if (normalized.startsWith("0")) {
      return normalized.length === 10;
    }
    return false;
  }

  function normalizePhone(phone: string, countryCode: string): string {
    const normalized = phone.replaceAll(/\D/g, "");
    if (normalized.startsWith(countryCode.replace("+", ""))) {
      return `+${normalized}`;
    }
    if (normalized.startsWith("0")) {
      return `${countryCode}${normalized.slice(1)}`;
    }
    return `${countryCode}${normalized}`;
  }

  it("should validate Nigerian phone numbers", () => {
    expect(isValidNigerianPhone("+2348012345678")).toBe(true);
    expect(isValidNigerianPhone("08012345678")).toBe(true);
    expect(isValidNigerianPhone("234801234567")).toBe(false); // Missing digit
    expect(isValidNigerianPhone("+234123")).toBe(false); // Too short
  });

  it("should validate Kenyan phone numbers", () => {
    expect(isValidKenyanPhone("+254712345678")).toBe(true);
    expect(isValidKenyanPhone("0712345678")).toBe(true);
    expect(isValidKenyanPhone("25471234567")).toBe(false); // Missing digit
  });

  it("should normalize phone numbers", () => {
    expect(normalizePhone("08012345678", "+234")).toBe("+2348012345678");
    expect(normalizePhone("0712345678", "+254")).toBe("+254712345678");
    expect(normalizePhone("+2348012345678", "+234")).toBe("+2348012345678");
  });
});

describe("SMS Rate Limiting", () => {
  interface RateLimitConfig {
    maxPerMinute: number;
    maxPerHour: number;
    maxPerDay: number;
  }

  interface UserSMSUsage {
    lastMinuteCount: number;
    lastHourCount: number;
    lastDayCount: number;
  }

  function canSendSMS(
    usage: UserSMSUsage,
    config: RateLimitConfig,
  ): { allowed: boolean; reason?: string } {
    if (usage.lastMinuteCount >= config.maxPerMinute) {
      return {
        allowed: false,
        reason: "Rate limit exceeded: too many requests per minute",
      };
    }
    if (usage.lastHourCount >= config.maxPerHour) {
      return {
        allowed: false,
        reason: "Rate limit exceeded: too many requests per hour",
      };
    }
    if (usage.lastDayCount >= config.maxPerDay) {
      return {
        allowed: false,
        reason: "Rate limit exceeded: daily limit reached",
      };
    }
    return { allowed: true };
  }

  const defaultConfig: RateLimitConfig = {
    maxPerMinute: 5,
    maxPerHour: 20,
    maxPerDay: 50,
  };

  it("should allow SMS within limits", () => {
    const usage: UserSMSUsage = {
      lastMinuteCount: 2,
      lastHourCount: 10,
      lastDayCount: 30,
    };

    expect(canSendSMS(usage, defaultConfig).allowed).toBe(true);
  });

  it("should block SMS when minute limit exceeded", () => {
    const usage: UserSMSUsage = {
      lastMinuteCount: 5,
      lastHourCount: 10,
      lastDayCount: 30,
    };

    const result = canSendSMS(usage, defaultConfig);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("minute");
  });

  it("should block SMS when hour limit exceeded", () => {
    const usage: UserSMSUsage = {
      lastMinuteCount: 2,
      lastHourCount: 20,
      lastDayCount: 30,
    };

    const result = canSendSMS(usage, defaultConfig);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("hour");
  });

  it("should block SMS when daily limit exceeded", () => {
    const usage: UserSMSUsage = {
      lastMinuteCount: 2,
      lastHourCount: 10,
      lastDayCount: 50,
    };

    const result = canSendSMS(usage, defaultConfig);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("daily");
  });
});

describe("SMS Message Formatting", () => {
  function formatOrderConfirmation(data: {
    orderId: string;
    restaurantName: string;
    estimatedTime: number;
  }): string {
    return `Your order #${data.orderId.slice(-6).toUpperCase()} from ${data.restaurantName} is confirmed! Estimated delivery: ${data.estimatedTime} mins.`;
  }

  function formatDriverAssigned(data: {
    driverName: string;
    vehicleInfo: string;
  }): string {
    return `Your driver ${data.driverName} is on the way! Vehicle: ${data.vehicleInfo}. Track your order in the app.`;
  }

  function formatDeliveryComplete(data: {
    orderId: string;
    total: string;
  }): string {
    return `Your order #${data.orderId.slice(-6).toUpperCase()} has been delivered. Total: ${data.total}. Thank you for using UBI!`;
  }

  it("should format order confirmation message", () => {
    const message = formatOrderConfirmation({
      orderId: "order_abc123def456",
      restaurantName: "Pizza Palace",
      estimatedTime: 30,
    });

    expect(message).toContain("EF456");
    expect(message).toContain("Pizza Palace");
    expect(message).toContain("30 mins");
    expect(message.length).toBeLessThanOrEqual(160);
  });

  it("should format driver assigned message", () => {
    const message = formatDriverAssigned({
      driverName: "John",
      vehicleInfo: "Black Honda ABC-123",
    });

    expect(message).toContain("John");
    expect(message).toContain("Black Honda ABC-123");
    expect(message.length).toBeLessThanOrEqual(160);
  });

  it("should format delivery complete message", () => {
    const message = formatDeliveryComplete({
      orderId: "order_xyz789",
      total: "₦5,500",
    });

    expect(message).toContain("₦5,500");
    expect(message.length).toBeLessThanOrEqual(160);
  });
});

describe("SMS Provider Failover", () => {
  interface SMSResult {
    success: boolean;
    provider?: string;
    error?: string;
  }

  type SMSProvider = () => Promise<SMSResult>;

  async function sendWithFailover(
    primaryProvider: SMSProvider,
    fallbackProvider: SMSProvider,
  ): Promise<SMSResult> {
    const primaryResult = await primaryProvider();

    if (primaryResult.success) {
      return primaryResult;
    }

    // Try fallback
    const fallbackResult = await fallbackProvider();
    return fallbackResult;
  }

  it("should use primary provider when successful", async () => {
    const primary: SMSProvider = async () => ({
      success: true,
      provider: "africas_talking",
    });
    const fallback: SMSProvider = async () => ({
      success: true,
      provider: "twilio",
    });

    const result = await sendWithFailover(primary, fallback);
    expect(result.provider).toBe("africas_talking");
  });

  it("should use fallback when primary fails", async () => {
    const primary: SMSProvider = async () => ({
      success: false,
      error: "Primary failed",
    });
    const fallback: SMSProvider = async () => ({
      success: true,
      provider: "twilio",
    });

    const result = await sendWithFailover(primary, fallback);
    expect(result.provider).toBe("twilio");
  });

  it("should return failure when both providers fail", async () => {
    const primary: SMSProvider = async () => ({
      success: false,
      error: "Primary failed",
    });
    const fallback: SMSProvider = async () => ({
      success: false,
      error: "Fallback failed",
    });

    const result = await sendWithFailover(primary, fallback);
    expect(result.success).toBe(false);
  });
});
