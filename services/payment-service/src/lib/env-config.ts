/**
 * Environment Configuration Validation
 * UBI Payment Service - Sprint 3: Production Hardening
 *
 * Validates all required environment variables at startup
 * and fails fast if critical configuration is missing.
 */

import { z } from "zod";

// =============================================================================
// ENVIRONMENT SCHEMAS
// =============================================================================

/**
 * Base configuration required for all environments
 */
const BaseEnvSchema = z.object({
  // Server config
  NODE_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  PORT: z.string().regex(/^\d+$/).transform(Number).default("4003"),

  // Database
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid PostgreSQL URL"),

  // Redis
  REDIS_URL: z.string().url("REDIS_URL must be a valid Redis URL"),

  // JWT/Auth
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  SERVICE_SECRET: z
    .string()
    .min(16, "SERVICE_SECRET must be at least 16 characters"),

  // Encryption
  ENCRYPTION_KEY: z
    .string()
    .length(64, "ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),
});

/**
 * M-Pesa configuration (Kenya)
 */
const MpesaEnvSchema = z.object({
  MPESA_CONSUMER_KEY: z.string().min(1, "MPESA_CONSUMER_KEY is required"),
  MPESA_CONSUMER_SECRET: z.string().min(1, "MPESA_CONSUMER_SECRET is required"),
  MPESA_SHORTCODE: z
    .string()
    .regex(/^\d{5,7}$/, "MPESA_SHORTCODE must be 5-7 digits"),
  MPESA_PASSKEY: z
    .string()
    .min(32, "MPESA_PASSKEY must be at least 32 characters"),
  MPESA_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),

  // B2C (Payouts)
  MPESA_B2C_SHORT_CODE: z
    .string()
    .regex(/^\d{5,7}$/)
    .optional(),
  MPESA_B2C_INITIATOR_NAME: z.string().optional(),
  MPESA_B2C_SECURITY_CREDENTIAL: z.string().optional(),
  MPESA_B2C_QUEUE_TIMEOUT_URL: z.string().url().optional(),
  MPESA_B2C_RESULT_URL: z.string().url().optional(),
});

/**
 * MTN MoMo configuration (Ghana, Uganda)
 */
const MomoEnvSchema = z.object({
  MTN_MOMO_SUBSCRIPTION_KEY: z.string().optional(),
  MTN_MOMO_API_USER: z.string().optional(),
  MTN_MOMO_API_KEY: z.string().optional(),
  MTN_MOMO_ENVIRONMENT: z
    .enum(["sandbox", "mtnghana", "mtnuganda"])
    .default("sandbox"),
  MTN_MOMO_CALLBACK_URL: z.string().url().optional(),
});

/**
 * Paystack configuration (Nigeria)
 */
const PaystackEnvSchema = z.object({
  PAYSTACK_SECRET_KEY: z
    .string()
    .startsWith("sk_")
    .min(40, "Invalid Paystack secret key format"),
  PAYSTACK_PUBLIC_KEY: z
    .string()
    .startsWith("pk_")
    .min(40, "Invalid Paystack public key format"),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional(),
});

/**
 * Flutterwave configuration (Pan-African)
 */
const FlutterwaveEnvSchema = z.object({
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_PUBLIC_KEY: z.string().optional(),
  FLUTTERWAVE_ENCRYPTION_KEY: z.string().optional(),
  FLUTTERWAVE_WEBHOOK_SECRET: z.string().optional(),
});

/**
 * Airtel Money configuration
 */
const AirtelEnvSchema = z.object({
  AIRTEL_MONEY_CLIENT_ID: z.string().optional(),
  AIRTEL_MONEY_CLIENT_SECRET: z.string().optional(),
  AIRTEL_MONEY_ENVIRONMENT: z
    .enum(["sandbox", "production"])
    .default("sandbox"),
});

/**
 * External services
 */
const ExternalServicesEnvSchema = z.object({
  // API Gateway
  API_BASE_URL: z.string().url().optional(),

  // Notification service
  NOTIFICATION_SERVICE_URL: z.string().url().optional(),

  // User service
  USER_SERVICE_URL: z.string().url().optional(),
});

/**
 * Production-only strict requirements
 */
const ProductionEnvSchema = z.object({
  // Must use production M-Pesa
  MPESA_ENVIRONMENT: z.literal("production"),

  // Must have secure JWT (not containing dev/test)
  JWT_SECRET: z
    .string()
    .min(64, "Production JWT_SECRET must be at least 64 characters")
    .refine(
      (s) => !/(dev|test|local|secret)/i.test(s),
      "Production JWT_SECRET must not contain 'dev', 'test', 'local', or 'secret'",
    ),

  // Must have Paystack live key
  PAYSTACK_SECRET_KEY: z
    .string()
    .startsWith("sk_live_", "Production requires live Paystack key"),

  // Must have callback URLs configured
  MPESA_B2C_RESULT_URL: z
    .string()
    .url("Production requires MPESA_B2C_RESULT_URL"),
  API_BASE_URL: z.string().url("Production requires API_BASE_URL"),
});

// =============================================================================
// COMBINED SCHEMAS
// =============================================================================

/**
 * Development environment - relaxed validation
 */
const DevelopmentEnvSchema = BaseEnvSchema.merge(
  z.object({
    // Make provider configs optional in development
    MPESA_CONSUMER_KEY: z.string().optional(),
    MPESA_CONSUMER_SECRET: z.string().optional(),
    MPESA_SHORTCODE: z.string().optional(),
    MPESA_PASSKEY: z.string().optional(),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_PUBLIC_KEY: z.string().optional(),
  }),
);

/**
 * Staging environment - most configs required
 */
const StagingEnvSchema = BaseEnvSchema.merge(MpesaEnvSchema)
  .merge(MomoEnvSchema)
  .merge(PaystackEnvSchema)
  .merge(ExternalServicesEnvSchema);

/**
 * Production environment - all configs strictly required
 */
const FullProductionEnvSchema = BaseEnvSchema.merge(MpesaEnvSchema)
  .merge(MomoEnvSchema)
  .merge(PaystackEnvSchema)
  .merge(FlutterwaveEnvSchema)
  .merge(AirtelEnvSchema)
  .merge(ExternalServicesEnvSchema)
  .merge(ProductionEnvSchema);

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

export type ValidatedEnv = z.infer<typeof BaseEnvSchema>;

/**
 * Configuration validation results
 */
export interface ConfigValidationResult {
  valid: boolean;
  environment: string;
  errors: string[];
  warnings: string[];
  config?: ValidatedEnv;
}

/**
 * Get appropriate schema based on environment
 */
function getSchemaForEnvironment(nodeEnv: string): z.ZodTypeAny {
  switch (nodeEnv) {
    case "production":
      return FullProductionEnvSchema;
    case "staging":
      return StagingEnvSchema;
    case "test":
    case "development":
    default:
      return DevelopmentEnvSchema;
  }
}

/**
 * Check production-specific security warnings
 */
function checkProductionSecurity(
  env: NodeJS.ProcessEnv,
  warnings: string[],
): void {
  if (env.JWT_SECRET && env.JWT_SECRET.length < 64) {
    warnings.push("JWT_SECRET should be at least 64 characters in production");
  }
  if (!env.PAYSTACK_WEBHOOK_SECRET) {
    warnings.push(
      "PAYSTACK_WEBHOOK_SECRET is missing - webhook verification disabled",
    );
  }
  if (!env.MPESA_B2C_SECURITY_CREDENTIAL) {
    warnings.push(
      "MPESA_B2C_SECURITY_CREDENTIAL missing - B2C payouts disabled",
    );
  }
}

/**
 * Check for development credentials in non-dev environments
 */
function checkDevCredentials(env: NodeJS.ProcessEnv, warnings: string[]): void {
  const devPatterns = [
    { key: "JWT_SECRET", patterns: ["dev-secret", "test-secret", "changeme"] },
    { key: "ENCRYPTION_KEY", patterns: ["0000000000", "test", "dev"] },
    { key: "PAYSTACK_SECRET_KEY", patterns: ["sk_test_"] },
  ];

  for (const { key, patterns } of devPatterns) {
    const value = env[key];
    if (value && patterns.some((p) => value.includes(p))) {
      warnings.push(`${key} appears to contain development/test credentials`);
    }
  }
}

/**
 * Validate environment configuration
 * @param env - Process environment object
 * @returns Validation result with errors/warnings
 */
export function validateEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ConfigValidationResult {
  const nodeEnv = env.NODE_ENV || "development";
  const errors: string[] = [];
  const warnings: string[] = [];

  const schema = getSchemaForEnvironment(nodeEnv);
  const result = schema.safeParse(env);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.join(".");
      errors.push(`${path}: ${issue.message}`);
    }

    return {
      valid: false,
      environment: nodeEnv,
      errors,
      warnings,
    };
  }

  // Additional security checks
  if (nodeEnv === "production") {
    checkProductionSecurity(env, warnings);
  }

  // Check for development credentials in non-dev
  if (nodeEnv !== "development" && nodeEnv !== "test") {
    checkDevCredentials(env, warnings);
  }

  return {
    valid: true,
    environment: nodeEnv,
    errors,
    warnings,
    config: result.data as ValidatedEnv,
  };
}

/**
 * Validate environment and fail fast on critical errors
 * Call this at application startup
 */
export function validateEnvironmentOrExit(): ValidatedEnv {
  const result = validateEnvironment();

  // Log warnings
  for (const warning of result.warnings) {
    console.warn(`⚠️  Config Warning: ${warning}`);
  }

  if (!result.valid) {
    console.error("\n🚨 CONFIGURATION ERROR - Cannot start service\n");
    console.error(`Environment: ${result.environment}\n`);

    for (const error of result.errors) {
      console.error(`  ❌ ${error}`);
    }

    console.error(
      "\n📚 Please check your .env file or environment variables.\n",
    );

    // In production, exit immediately
    if (result.environment === "production") {
      process.exit(1);
    }

    // In development, log but continue with defaults
    console.warn("⚠️  Continuing with defaults in development mode...\n");
  }

  console.log(
    `✅ Configuration validated for ${result.environment} environment`,
  );

  return result.config!;
}

/**
 * Get required environment variable or throw
 */
export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

/**
 * Get optional environment variable with default
 */
export function getOptionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development" || !process.env.NODE_ENV;
}

// =============================================================================
// EXPORTS
// =============================================================================

export const envSchemas = {
  base: BaseEnvSchema,
  mpesa: MpesaEnvSchema,
  momo: MomoEnvSchema,
  paystack: PaystackEnvSchema,
  flutterwave: FlutterwaveEnvSchema,
  airtel: AirtelEnvSchema,
  production: FullProductionEnvSchema,
};

export default {
  validateEnvironment,
  validateEnvironmentOrExit,
  getRequiredEnv,
  getOptionalEnv,
  isProduction,
  isDevelopment,
};
