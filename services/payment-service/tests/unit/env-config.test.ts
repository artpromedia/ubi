/**
 * Environment Configuration Tests
 * Sprint 3: Production Hardening - Task 8
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOptionalEnv,
  getRequiredEnv,
  isDevelopment,
  isProduction,
  validateEnvironment,
} from "../../src/lib/env-config";

describe("Environment Configuration Validation", () => {
  beforeEach(() => {
    // Reset to minimal valid env for each test
    vi.resetModules();
  });

  describe("validateEnvironment", () => {
    describe("Development Environment", () => {
      it("should pass with minimal config in development", () => {
        const env = {
          NODE_ENV: "development",
          DATABASE_URL: "postgresql://localhost:5432/ubi",
          REDIS_URL: "redis://localhost:6379",
          JWT_SECRET: "dev-secret-key-at-least-32-characters-long",
          SERVICE_SECRET: "service-secret-16ch",
          ENCRYPTION_KEY: "0".repeat(64),
        };

        const result = validateEnvironment(env as NodeJS.ProcessEnv);

        expect(result.valid).toBe(true);
        expect(result.environment).toBe("development");
        expect(result.errors).toHaveLength(0);
      });

      it("should fail if DATABASE_URL is missing", () => {
        const env = {
          NODE_ENV: "development",
          REDIS_URL: "redis://localhost:6379",
          JWT_SECRET: "dev-secret-key-at-least-32-characters-long",
          SERVICE_SECRET: "service-secret-16ch",
          ENCRYPTION_KEY: "0".repeat(64),
        };

        const result = validateEnvironment(env as NodeJS.ProcessEnv);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("DATABASE_URL"))).toBe(
          true,
        );
      });

      it("should fail if JWT_SECRET is too short", () => {
        const env = {
          NODE_ENV: "development",
          DATABASE_URL: "postgresql://localhost:5432/ubi",
          REDIS_URL: "redis://localhost:6379",
          JWT_SECRET: "short",
          SERVICE_SECRET: "service-secret-16ch",
          ENCRYPTION_KEY: "0".repeat(64),
        };

        const result = validateEnvironment(env as NodeJS.ProcessEnv);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
      });

      it("should fail if ENCRYPTION_KEY is wrong length", () => {
        const env = {
          NODE_ENV: "development",
          DATABASE_URL: "postgresql://localhost:5432/ubi",
          REDIS_URL: "redis://localhost:6379",
          JWT_SECRET: "dev-secret-key-at-least-32-characters-long",
          SERVICE_SECRET: "service-secret-16ch",
          ENCRYPTION_KEY: "tooshort",
        };

        const result = validateEnvironment(env as NodeJS.ProcessEnv);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("ENCRYPTION_KEY"))).toBe(
          true,
        );
      });
    });

    describe("Production Environment", () => {
      const validProductionEnv = {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://prod-server:5432/ubi",
        REDIS_URL: "redis://prod-redis:6379",
        JWT_SECRET: "a".repeat(64), // 64 chars, no dev patterns
        SERVICE_SECRET: "prod-service-secret-32chars-min",
        ENCRYPTION_KEY: "a".repeat(64),

        // M-Pesa
        MPESA_CONSUMER_KEY: "prod-consumer-key",
        MPESA_CONSUMER_SECRET: "prod-consumer-secret",
        MPESA_SHORTCODE: "174379",
        MPESA_PASSKEY: "a".repeat(40),
        MPESA_ENVIRONMENT: "production",
        MPESA_B2C_SHORT_CODE: "600000",
        MPESA_B2C_INITIATOR_NAME: "initiator",
        MPESA_B2C_SECURITY_CREDENTIAL: "credential",
        MPESA_B2C_QUEUE_TIMEOUT_URL: "https://api.ubi.africa/timeout",
        MPESA_B2C_RESULT_URL: "https://api.ubi.africa/result",

        // Paystack
        PAYSTACK_SECRET_KEY: "sk_live_" + "x".repeat(40),
        PAYSTACK_PUBLIC_KEY: "pk_live_" + "x".repeat(40),

        // API
        API_BASE_URL: "https://api.ubi.africa",
      };

      it("should pass with all required production config", () => {
        const result = validateEnvironment(
          validProductionEnv as NodeJS.ProcessEnv,
        );

        expect(result.valid).toBe(true);
        expect(result.environment).toBe("production");
      });

      it("should fail if M-Pesa is in sandbox mode", () => {
        const env = {
          ...validProductionEnv,
          MPESA_ENVIRONMENT: "sandbox",
        };

        const result = validateEnvironment(env as NodeJS.ProcessEnv);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("MPESA_ENVIRONMENT"))).toBe(
          true,
        );
      });

      it("should fail if Paystack key is test key", () => {
        const env = {
          ...validProductionEnv,
          PAYSTACK_SECRET_KEY: "sk_test_" + "x".repeat(40),
        };

        const result = validateEnvironment(env as NodeJS.ProcessEnv);

        expect(result.valid).toBe(false);
        expect(
          result.errors.some(
            (e) => e.includes("PAYSTACK_SECRET_KEY") || e.includes("live"),
          ),
        ).toBe(true);
      });

      it("should fail if JWT_SECRET contains dev patterns", () => {
        const env = {
          ...validProductionEnv,
          JWT_SECRET:
            "prod-dev-secret-that-is-definitely-long-enough-64-chars-ok",
        };

        const result = validateEnvironment(env as NodeJS.ProcessEnv);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
      });

      it("should fail if API_BASE_URL is missing", () => {
        const env = { ...validProductionEnv };
        delete (env as Record<string, string>).API_BASE_URL;

        const result = validateEnvironment(env as NodeJS.ProcessEnv);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("API_BASE_URL"))).toBe(
          true,
        );
      });

      it("should warn about missing webhook secrets", () => {
        const env = { ...validProductionEnv };

        const result = validateEnvironment(env as NodeJS.ProcessEnv);

        expect(
          result.warnings.some((w) => w.includes("PAYSTACK_WEBHOOK_SECRET")),
        ).toBe(true);
      });
    });

    describe("Staging Environment", () => {
      it("should require M-Pesa config but allow sandbox", () => {
        const env = {
          NODE_ENV: "staging",
          DATABASE_URL: "postgresql://staging:5432/ubi",
          REDIS_URL: "redis://staging:6379",
          JWT_SECRET: "staging-secret-key-at-least-32-characters-long",
          SERVICE_SECRET: "staging-service-secret",
          ENCRYPTION_KEY: "0".repeat(64),

          // M-Pesa can be sandbox
          MPESA_CONSUMER_KEY: "sandbox-key",
          MPESA_CONSUMER_SECRET: "sandbox-secret",
          MPESA_SHORTCODE: "174379",
          MPESA_PASSKEY: "a".repeat(40),
          MPESA_ENVIRONMENT: "sandbox",

          // Paystack can be test
          PAYSTACK_SECRET_KEY: "sk_test_" + "x".repeat(40),
          PAYSTACK_PUBLIC_KEY: "pk_test_" + "x".repeat(40),
        };

        const result = validateEnvironment(env as NodeJS.ProcessEnv);

        expect(result.valid).toBe(true);
        expect(result.environment).toBe("staging");
      });
    });
  });

  describe("getRequiredEnv", () => {
    it("should return value when env var exists", () => {
      process.env.TEST_VAR = "test_value";

      expect(getRequiredEnv("TEST_VAR")).toBe("test_value");

      delete process.env.TEST_VAR;
    });

    it("should throw when env var is missing", () => {
      delete process.env.MISSING_VAR;

      expect(() => getRequiredEnv("MISSING_VAR")).toThrow(
        "Required environment variable MISSING_VAR is not set",
      );
    });
  });

  describe("getOptionalEnv", () => {
    it("should return value when env var exists", () => {
      process.env.OPTIONAL_VAR = "real_value";

      expect(getOptionalEnv("OPTIONAL_VAR", "default")).toBe("real_value");

      delete process.env.OPTIONAL_VAR;
    });

    it("should return default when env var is missing", () => {
      delete process.env.MISSING_OPTIONAL;

      expect(getOptionalEnv("MISSING_OPTIONAL", "default_value")).toBe(
        "default_value",
      );
    });
  });

  describe("isProduction / isDevelopment", () => {
    it("isProduction should return true when NODE_ENV is production", () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      expect(isProduction()).toBe(true);
      expect(isDevelopment()).toBe(false);

      process.env.NODE_ENV = originalNodeEnv;
    });

    it("isDevelopment should return true when NODE_ENV is development", () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      expect(isDevelopment()).toBe(true);
      expect(isProduction()).toBe(false);

      process.env.NODE_ENV = originalNodeEnv;
    });

    it("isDevelopment should return true when NODE_ENV is not set", () => {
      const originalNodeEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;

      expect(isDevelopment()).toBe(true);

      process.env.NODE_ENV = originalNodeEnv;
    });
  });
});

describe("M-Pesa Configuration Validation", () => {
  it("should validate shortcode format (5-7 digits)", () => {
    const validShortcodes = ["17437", "174379", "1743791"];
    const invalidShortcodes = ["1234", "12345678", "abc123"];

    for (const code of validShortcodes) {
      expect(/^\d{5,7}$/.test(code)).toBe(true);
    }

    for (const code of invalidShortcodes) {
      expect(/^\d{5,7}$/.test(code)).toBe(false);
    }
  });
});

describe("Paystack Configuration Validation", () => {
  it("should validate secret key format", () => {
    const validKeys = [
      "sk_test_" + "x".repeat(40),
      "sk_live_" + "y".repeat(40),
    ];
    const invalidKeys = [
      "sk_test_short",
      "invalid_key",
      "pk_test_" + "x".repeat(40), // Public key format
    ];

    for (const key of validKeys) {
      expect(key.startsWith("sk_") && key.length >= 40).toBe(true);
    }

    for (const key of invalidKeys) {
      expect(key.startsWith("sk_") && key.length >= 40).toBe(false);
    }
  });
});

describe("Security Configuration Validation", () => {
  it("should detect dev patterns in production secrets", () => {
    const devPatterns = ["dev-secret", "test-secret", "changeme", "local"];

    for (const pattern of devPatterns) {
      const secret = `some-${pattern}-value`;
      expect(/(dev|test|local|secret)/i.test(secret)).toBe(true);
    }
  });

  it("should validate encryption key is proper hex", () => {
    const validHexKey = "a".repeat(64);
    const invalidKeys = [
      "g".repeat(64), // Invalid hex char
      "a".repeat(32), // Too short
      "a".repeat(128), // Too long
    ];

    expect(/^[a-f0-9]{64}$/i.test(validHexKey)).toBe(true);

    for (const key of invalidKeys) {
      expect(key.length === 64 && /^[a-f0-9]+$/i.test(key)).toBe(false);
    }
  });
});
