/**
 * Security Audit Test Suite
 * Comprehensive tests for PII masking, encryption, and security utilities
 *
 * Sprint 3: Production Hardening - Task 1
 */

import { describe, expect, it } from "vitest";
import {
  containsSensitiveData,
  decryptSensitive,
  encryptSensitive,
  hashSensitive,
  maskCardNumber,
  maskForLogging,
  security,
  validateCardDataHandling,
  verifyMomoSignature,
  verifyMpesaCallback,
  verifyPaystackSignature,
} from "../../src/lib/security";

describe("Security Module - PII Masking", () => {
  describe("maskForLogging", () => {
    it("should mask phone numbers (Kenya format)", () => {
      const data = {
        phoneNumber: "+254712345678",
        mobileNumber: "0712345678",
      };

      const masked = maskForLogging(data);

      expect(masked.phoneNumber).not.toBe(data.phoneNumber);
      expect(masked.phoneNumber).toContain("***");
      expect((masked.phoneNumber as string).slice(-3)).toBe("678");
    });

    it("should mask phone numbers (Nigeria format)", () => {
      const data = {
        phone: "+2348012345678",
        cellNumber: "08012345678",
      };

      const masked = maskForLogging(data);

      expect(masked.phone).toContain("*");
      expect(masked.cellNumber).toContain("*");
    });

    it("should mask email addresses", () => {
      const data = {
        email: "john.doe@example.com",
        userEmail: "test@ubi.africa",
      };

      const masked = maskForLogging(data);

      expect(masked.email).toBe("j***@example.com");
      expect(masked.userEmail).toBe("t***@ubi.africa");
    });

    it("should fully mask passwords and secrets", () => {
      const data = {
        password: "mysecretpassword123",
        apiSecret: "sk_live_xxxxxxxxxxxx",
        pin: "1234",
        otp: "567890",
      };

      const masked = maskForLogging(data);

      expect(masked.password).toBe("********");
      expect(masked.apiSecret).toBe("********");
      expect(masked.pin).toBe("********");
      expect(masked.otp).toBe("********");
    });

    it("should mask card numbers showing last 4", () => {
      const data = {
        cardNumber: "4111111111111111",
        accountNumber: "0123456789",
      };

      const masked = maskForLogging(data);

      expect(masked.cardNumber).toBe("************1111");
      expect(masked.accountNumber).toBe("******6789");
    });

    it("should mask M-Pesa specific fields", () => {
      const data = {
        initiatorCredential: "secretcred123",
        consumerKey: "ck_test_123456789",
        consumerSecret: "cs_test_987654321",
        passkey: "bfb279f9aa9bdbcf158e97dd71a467cd",
        mpesaPin: "1234",
      };

      const masked = maskForLogging(data);

      expect(masked.initiatorCredential).toBe("********");
      expect(masked.consumerKey).toBe("********");
      expect(masked.consumerSecret).toBe("********");
      expect(masked.passkey).toBe("********");
      expect(masked.mpesaPin).toBe("********");
    });

    it("should mask tokens showing first 8 chars", () => {
      const data = {
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload",
        refreshToken: "rt_1234567890abcdefghijklmnop",
        bearerToken: "Bearer abc123def456ghi789",
      };

      const masked = maskForLogging(data);

      expect((masked.accessToken as string).startsWith("eyJhbGci")).toBe(true);
      expect(masked.accessToken).toContain("*");
    });

    it("should mask African national ID numbers", () => {
      const data = {
        bvn: "22236734217", // Nigeria BVN
        nin: "12345678901", // Nigeria NIN
        kraPin: "A123456789B", // Kenya KRA PIN
        nationalId: "12345678", // Generic ID
        passportNumber: "A12345678",
      };

      const masked = maskForLogging(data);

      expect(masked.bvn).toBe("*******4217");
      expect(masked.nin).toBe("*******8901");
      expect(masked.kraPin).toBe("*******789B");
    });

    it("should recursively mask nested objects", () => {
      const data = {
        user: {
          profile: {
            phoneNumber: "+254712345678",
            email: "user@test.com",
          },
          payment: {
            cardNumber: "4111111111111111",
          },
        },
      };

      const masked = maskForLogging(data);
      const maskedUser = masked.user as Record<string, unknown>;
      const maskedProfile = maskedUser.profile as Record<string, unknown>;
      const maskedPayment = maskedUser.payment as Record<string, unknown>;

      expect(maskedProfile.phoneNumber).toContain("*");
      expect(maskedProfile.email).toContain("***");
      expect(maskedPayment.cardNumber).toBe("************1111");
    });

    it("should mask arrays of sensitive data", () => {
      const data = {
        recipients: [
          { phoneNumber: "+254712345678", amount: 1000 },
          { phoneNumber: "+254787654321", amount: 2000 },
        ],
      };

      const masked = maskForLogging(data);
      const recipients = masked.recipients as Array<Record<string, unknown>>;

      expect(recipients[0].phoneNumber).toContain("*");
      expect(recipients[1].phoneNumber).toContain("*");
      expect(recipients[0].amount).toBe(1000); // Non-sensitive, unchanged
    });

    it("should not mask non-sensitive fields", () => {
      const data = {
        transactionId: "txn_123456",
        amount: 5000,
        currency: "KES",
        status: "completed",
        timestamp: "2024-01-01T12:00:00Z",
      };

      const masked = maskForLogging(data);

      expect(masked).toEqual(data);
    });

    it("should handle null and undefined values", () => {
      const data = {
        phoneNumber: null,
        email: undefined,
        cardNumber: "",
      };

      const masked = maskForLogging(data);

      expect(masked.phoneNumber).toBeNull();
      expect(masked.email).toBeUndefined();
      expect(masked.cardNumber).toBe("");
    });

    it("should prevent deep recursion attacks", () => {
      // Create deeply nested object
      let nested: Record<string, unknown> = { phoneNumber: "+254712345678" };
      for (let i = 0; i < 20; i++) {
        nested = { level: nested };
      }

      // Should not throw and should handle gracefully
      expect(() => maskForLogging(nested)).not.toThrow();
    });
  });

  describe("containsSensitiveData", () => {
    it("should detect sensitive fields", () => {
      expect(containsSensitiveData({ password: "test" })).toBe(true);
      expect(containsSensitiveData({ phoneNumber: "123" })).toBe(true);
      expect(containsSensitiveData({ cardNumber: "4111" })).toBe(true);
      expect(containsSensitiveData({ bvn: "12345" })).toBe(true);
    });

    it("should not flag non-sensitive fields", () => {
      expect(containsSensitiveData({ amount: 1000 })).toBe(false);
      expect(containsSensitiveData({ currency: "KES" })).toBe(false);
      expect(containsSensitiveData({ status: "pending" })).toBe(false);
    });
  });
});

describe("Security Module - Encryption", () => {
  const testData = "sensitive-payment-data-12345";

  describe("encryptSensitive / decryptSensitive", () => {
    it("should encrypt and decrypt data correctly", () => {
      const encrypted = encryptSensitive(testData);
      const decrypted = decryptSensitive(encrypted);

      expect(encrypted).not.toBe(testData);
      expect(decrypted).toBe(testData);
    });

    it("should produce different ciphertext for same plaintext (IV randomization)", () => {
      const encrypted1 = encryptSensitive(testData);
      const encrypted2 = encryptSensitive(testData);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it("should use AES-256-GCM format (iv:authTag:ciphertext)", () => {
      const encrypted = encryptSensitive(testData);
      const parts = encrypted.split(":");

      expect(parts.length).toBe(3);
      expect(parts[0].length).toBe(32); // IV: 16 bytes = 32 hex chars
      expect(parts[1].length).toBe(32); // Auth tag: 16 bytes = 32 hex chars
    });

    it("should handle empty strings", () => {
      const encrypted = encryptSensitive("");
      const decrypted = decryptSensitive(encrypted);

      expect(decrypted).toBe("");
    });

    it("should handle special characters", () => {
      const specialData = 'M-Pesa™ @#$%^&*()_+={}[]|\\:";<>,.?/~`';
      const encrypted = encryptSensitive(specialData);
      const decrypted = decryptSensitive(encrypted);

      expect(decrypted).toBe(specialData);
    });

    it("should handle unicode (African language support)", () => {
      const unicodeData = "ไทย • العربية • Kiswahili";
      const encrypted = encryptSensitive(unicodeData);
      const decrypted = decryptSensitive(encrypted);

      expect(decrypted).toBe(unicodeData);
    });
  });

  describe("hashSensitive", () => {
    it("should produce consistent hashes", () => {
      const hash1 = hashSensitive(testData);
      const hash2 = hashSensitive(testData);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different data", () => {
      const hash1 = hashSensitive("data1");
      const hash2 = hashSensitive("data2");

      expect(hash1).not.toBe(hash2);
    });

    it("should produce SHA-256 hash (64 hex chars)", () => {
      const hash = hashSensitive(testData);

      expect(hash.length).toBe(64);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });
  });
});

describe("Security Module - Webhook Verification", () => {
  describe("verifyPaystackSignature", () => {
    it("should verify valid Paystack signatures", () => {
      const payload = JSON.stringify({ event: "charge.success", data: {} });
      const secret = "sk_test_123456789";
      const crypto = require("node:crypto");
      const expectedSig = crypto
        .createHmac("sha512", secret)
        .update(payload)
        .digest("hex");

      const result = verifyPaystackSignature(payload, expectedSig, secret);

      expect(result).toBe(true);
    });

    it("should reject invalid signatures", () => {
      const payload = JSON.stringify({ event: "charge.success" });
      const secret = "sk_test_123456789";

      const result = verifyPaystackSignature(
        payload,
        "invalid_signature",
        secret,
      );

      expect(result).toBe(false);
    });

    it("should reject tampered payloads", () => {
      const payload = JSON.stringify({ event: "charge.success" });
      const tamperedPayload = JSON.stringify({ event: "charge.failed" });
      const secret = "sk_test_123456789";
      const crypto = require("node:crypto");
      const signature = crypto
        .createHmac("sha512", secret)
        .update(payload)
        .digest("hex");

      const result = verifyPaystackSignature(
        tamperedPayload,
        signature,
        secret,
      );

      expect(result).toBe(false);
    });
  });

  describe("verifyMpesaCallback", () => {
    const validMpesaIP = "196.201.214.200";
    const invalidIP = "192.168.1.1";

    it("should accept requests from whitelisted M-Pesa IPs", () => {
      const result = verifyMpesaCallback(validMpesaIP, undefined);

      expect(result).toBe(true);
    });

    it("should reject requests from non-whitelisted IPs", () => {
      const result = verifyMpesaCallback(invalidIP, undefined);

      expect(result).toBe(false);
    });

    it("should verify basic auth when provided", () => {
      const originalEnv = { ...process.env };
      process.env.MPESA_SHORTCODE = "174379";
      process.env.MPESA_PASSKEY = "testpasskey123";

      const expectedAuth = Buffer.from("174379:testpasskey123").toString(
        "base64",
      );
      const result = verifyMpesaCallback(validMpesaIP, `Basic ${expectedAuth}`);

      expect(result).toBe(true);

      process.env = originalEnv;
    });
  });

  describe("verifyMomoSignature", () => {
    it("should verify valid MTN MoMo signatures", () => {
      const payload = JSON.stringify({ status: "SUCCESSFUL" });
      const secret = "momo_secret_key";
      const crypto = require("node:crypto");
      const expectedSig = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("base64");

      const result = verifyMomoSignature(payload, expectedSig, secret);

      expect(result).toBe(true);
    });
  });
});

describe("Security Module - PCI DSS Compliance", () => {
  describe("validateCardDataHandling", () => {
    it("should throw on raw card number storage attempt", () => {
      expect(() => {
        validateCardDataHandling({ cardNumber: "4111111111111111" });
      }).toThrow("PCI DSS Violation");
    });

    it("should throw on CVV storage attempt", () => {
      expect(() => {
        validateCardDataHandling({ cvv: "123" });
      }).toThrow("PCI DSS Violation");
    });

    it("should throw on CVC storage attempt", () => {
      expect(() => {
        validateCardDataHandling({ cvc: "456" });
      }).toThrow("PCI DSS Violation");
    });

    it("should throw on PAN storage attempt", () => {
      expect(() => {
        validateCardDataHandling({ pan: "4111111111111111" });
      }).toThrow("PCI DSS Violation");
    });

    it("should allow masked/tokenized data", () => {
      expect(() => {
        validateCardDataHandling({
          last4: "1111",
          cardToken: "tok_visa_123",
          cardBrand: "Visa",
        });
      }).not.toThrow();
    });
  });

  describe("maskCardNumber", () => {
    it("should mask card number showing last 4 digits", () => {
      expect(maskCardNumber("4111111111111111")).toBe("**** **** **** 1111");
    });

    it("should handle short card numbers", () => {
      expect(maskCardNumber("1234")).toBe("****");
    });

    it("should handle Verve cards (Nigeria)", () => {
      expect(maskCardNumber("5060990580000217499")).toMatch(/\*+.*7499$/);
    });
  });
});

describe("Security Module - Rate Limiting Configs", () => {
  it("should have appropriate rate limits for payment endpoints", () => {
    const { rateLimits } = security;

    expect(rateLimits.payment.requests).toBeLessThanOrEqual(100);
    expect(rateLimits.payment.window).toBeGreaterThanOrEqual(60000);
  });

  it("should have stricter limits for sensitive operations", () => {
    const { rateLimits } = security;

    // Login attempts should be more restricted
    expect(rateLimits.login.requests).toBeLessThanOrEqual(10);

    // OTP requests should be very restricted
    expect(rateLimits.otp.requests).toBeLessThanOrEqual(5);
  });
});

describe("Security Module - Validation Schemas", () => {
  describe("PaymentAmountSchema", () => {
    const { PaymentAmountSchema } = security.schemas;

    it("should accept valid amounts", () => {
      expect(() => PaymentAmountSchema.parse(1000)).not.toThrow();
      expect(() => PaymentAmountSchema.parse(50000)).not.toThrow();
    });

    it("should reject negative amounts", () => {
      expect(() => PaymentAmountSchema.parse(-100)).toThrow();
    });

    it("should reject zero amounts", () => {
      expect(() => PaymentAmountSchema.parse(0)).toThrow();
    });
  });

  describe("PhoneNumberSchema", () => {
    const { PhoneNumberSchema } = security.schemas;

    it("should accept Kenya phone numbers", () => {
      expect(() => PhoneNumberSchema.parse("+254712345678")).not.toThrow();
      expect(() => PhoneNumberSchema.parse("254712345678")).not.toThrow();
    });

    it("should accept Nigeria phone numbers", () => {
      expect(() => PhoneNumberSchema.parse("+2348012345678")).not.toThrow();
    });

    it("should accept Ghana phone numbers", () => {
      expect(() => PhoneNumberSchema.parse("+233201234567")).not.toThrow();
    });

    it("should reject invalid phone numbers", () => {
      expect(() => PhoneNumberSchema.parse("invalid")).toThrow();
      expect(() => PhoneNumberSchema.parse("123")).toThrow();
    });
  });

  describe("IdempotencyKeySchema", () => {
    const { IdempotencyKeySchema } = security.schemas;

    it("should accept valid UUID format", () => {
      expect(() =>
        IdempotencyKeySchema.parse("123e4567-e89b-12d3-a456-426614174000"),
      ).not.toThrow();
    });

    it("should accept custom key format", () => {
      expect(() =>
        IdempotencyKeySchema.parse("pay_123456789_retry_1"),
      ).not.toThrow();
    });
  });
});

describe("Security Module - Security Headers", () => {
  it("should enforce strict CSP", () => {
    const { headers } = security;

    expect(headers.contentSecurityPolicy.directives.defaultSrc).toContain(
      "'self'",
    );
    expect(headers.contentSecurityPolicy.directives.frameSrc).toContain(
      "'none'",
    );
    expect(headers.contentSecurityPolicy.directives.objectSrc).toContain(
      "'none'",
    );
  });

  it("should enable HSTS with preload", () => {
    const { headers } = security;

    expect(headers.hsts.maxAge).toBeGreaterThanOrEqual(31536000); // 1 year
    expect(headers.hsts.includeSubDomains).toBe(true);
    expect(headers.hsts.preload).toBe(true);
  });

  it("should deny framing", () => {
    const { headers } = security;

    expect(headers.frameguard.action).toBe("deny");
  });
});
