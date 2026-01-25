/**
 * Security Hardening Configuration
 * UBI Payment Service
 *
 * Security middleware and utilities
 */

import { Context, Next } from "hono";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { securityLogger } from "./logger.js";
import { redis } from "./redis.js";

// ===========================================
// INPUT VALIDATION SCHEMAS
// ===========================================

export const PaymentAmountSchema = z.object({
  amount: z
    .number()
    .positive("Amount must be positive")
    .max(10000000, "Amount exceeds maximum limit") // 10M limit
    .refine((n) => Number.isFinite(n), "Invalid amount")
    .refine((n) => Math.round(n * 100) / 100 === n, "Max 2 decimal places"),
});

export const PhoneNumberSchema = z
  .string()
  .regex(/^\+?[1-9]\d{6,14}$/, "Invalid phone number format");

export const BankAccountSchema = z.object({
  bankCode: z.string().min(2).max(10),
  accountNumber: z.string().regex(/^\d{10,15}$/, "Invalid account number"),
  accountName: z.string().min(2).max(100),
});

export const IdempotencyKeySchema = z
  .string()
  .min(16, "Idempotency key must be at least 16 characters")
  .max(64, "Idempotency key must be at most 64 characters")
  .regex(/^[a-zA-Z0-9_-]+$/, "Invalid idempotency key format");

// ===========================================
// RATE LIMITING CONFIGURATIONS
// ===========================================

export const rateLimitConfigs = {
  // Standard API endpoints
  default: {
    requests: 100,
    window: 60 * 1000, // 1 minute
    windowMs: 60 * 1000,
    max: 100,
  },

  // Payment operations (stricter)
  payment: {
    requests: 30,
    window: 60 * 1000,
    windowMs: 60 * 1000,
    max: 30,
  },

  // STK Push (very strict to prevent abuse)
  stkPush: {
    requests: 5,
    window: 60 * 1000,
    windowMs: 60 * 1000,
    max: 5,
    perUser: true,
  },

  // Webhook endpoints (higher limit)
  webhook: {
    requests: 1000,
    window: 60 * 1000,
    windowMs: 60 * 1000,
    max: 1000,
  },

  // Admin endpoints
  admin: {
    requests: 200,
    window: 60 * 1000,
    windowMs: 60 * 1000,
    max: 200,
  },

  // Auth/login attempts (strict to prevent brute force)
  auth: {
    requests: 5,
    window: 15 * 60 * 1000, // 15 minutes
    windowMs: 15 * 60 * 1000,
    max: 5,
    blockDuration: 60 * 60 * 1000, // 1 hour block after exceeded
  },

  // Login attempts alias
  login: {
    requests: 5,
    window: 15 * 60 * 1000,
    windowMs: 15 * 60 * 1000,
    max: 5,
  },

  // OTP requests (very strict)
  otp: {
    requests: 3,
    window: 60 * 1000,
    windowMs: 60 * 1000,
    max: 3,
    perUser: true,
  },
};

// ===========================================
// WEBHOOK SIGNATURE VERIFICATION
// ===========================================

/**
 * Verify Paystack webhook signature
 */
export function verifyPaystackSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  try {
    const hash = createHmac("sha512", secret).update(payload).digest("hex");

    return timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Verify M-Pesa callback authenticity
 * M-Pesa uses IP whitelisting + basic auth
 */
export function verifyMpesaCallback(
  ip: string,
  authHeader: string | undefined,
): boolean {
  const allowedIPs = [
    "196.201.214.200",
    "196.201.214.206",
    "196.201.213.114",
    "196.201.214.207",
    "196.201.214.208",
    "196.201.213.44",
    "196.201.212.127",
    "196.201.212.138",
    "196.201.212.129",
    "196.201.212.136",
    "196.201.212.74",
    "196.201.212.69",
  ];

  // Check IP whitelist
  if (!allowedIPs.includes(ip)) {
    securityLogger.warn({ ip }, "M-Pesa callback from unauthorized IP");
    return false;
  }

  // Verify basic auth if provided
  if (authHeader) {
    const expectedAuth = Buffer.from(
      `${process.env.MPESA_SHORTCODE}:${process.env.MPESA_PASSKEY}`,
    ).toString("base64");

    if (authHeader !== `Basic ${expectedAuth}`) {
      return false;
    }
  }

  return true;
}

/**
 * Verify MTN MoMo webhook signature
 */
export function verifyMomoSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  try {
    const hash = createHmac("sha256", secret).update(payload).digest("base64");

    return timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ===========================================
// SECURITY MIDDLEWARE
// ===========================================

/**
 * Middleware to sanitize request inputs
 */
export async function sanitizeInput(c: Context, next: Next) {
  // Remove potentially dangerous fields
  if (c.req.method === "POST" || c.req.method === "PUT") {
    try {
      const body = await c.req.json();

      // Remove prototype pollution attempts using Reflect.deleteProperty
      Reflect.deleteProperty(body, "__proto__");
      Reflect.deleteProperty(body, "constructor");
      Reflect.deleteProperty(body, "prototype");

      // Sanitize string fields
      const sanitized = sanitizeObject(body);

      // Store sanitized body for handlers
      c.set("sanitizedBody", sanitized);
    } catch {
      // Body parsing failed, let it fail in handler
    }
  }

  await next();
}

function sanitizeObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    // Remove script tags and other XSS vectors
    return obj
      .replaceAll(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replaceAll(/javascript:/gi, "")
      .replaceAll(/on\w+=/gi, "")
      .trim();
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Skip dangerous keys
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        continue;
      }
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Middleware to validate admin role
 */
export async function requireAdmin(
  c: Context,
  next: Next,
): Promise<Response | void> {
  const userRole = c.req.header("X-User-Role");

  if (!userRole || !["ADMIN", "SUPER_ADMIN", "FINANCE"].includes(userRole)) {
    return c.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Admin access required",
        },
      },
      403,
    );
  }

  return await next();
}

/**
 * Middleware to prevent replay attacks
 */
export async function preventReplay(
  c: Context,
  next: Next,
): Promise<Response | void> {
  const timestamp = c.req.header("X-Timestamp");
  const nonce = c.req.header("X-Nonce");

  if (timestamp) {
    const requestTime = Number.parseInt(timestamp);
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    if (Number.isNaN(requestTime) || Math.abs(now - requestTime) > maxAge) {
      return c.json(
        {
          success: false,
          error: {
            code: "REQUEST_EXPIRED",
            message: "Request timestamp is too old",
          },
        },
        400,
      );
    }
  }

  // Check nonce hasn't been used (prevents replay attacks)
  if (nonce) {
    const nonceKey = `nonce:${nonce}`;
    const nonceExists = await redis.get(nonceKey);

    if (nonceExists) {
      securityLogger.warn({ nonce }, "Nonce replay attempt detected");
      return c.json(
        {
          success: false,
          error: {
            code: "NONCE_REUSED",
            message: "Request nonce has already been used",
          },
        },
        400,
      );
    }

    // Store nonce with 1 hour TTL (longer than request window)
    await redis.set(nonceKey, "1", "EX", 3600);
  }

  return await next();
}

/**
 * Comprehensive list of sensitive field patterns for PII/financial data masking
 */
const SENSITIVE_FIELD_PATTERNS: RegExp[] = [
  // Financial data
  /^(account|card|bank).*number$/i,
  /^(cvv|cvc|cvv2|cvc2)$/i,
  /^(pin|otp|verification.?code)$/i,
  /^(routing|iban|swift|bic).*$/i,
  /^mpesa.*pin$/i,
  /^(momo|mobile.?money).*secret$/i,

  // Authentication tokens
  /^(password|secret|key|token)$/i,
  /^(access|refresh|bearer|auth).?token$/i,
  /^api.?key$/i,
  /^(session|csrf).?token$/i,
  /^(private|secret).?key$/i,

  // PII - African context included
  /^(national|voter|passport|bvn|nin).?(id|number)?$/i,
  /^(drivers?.?license|id.?card|kra.?pin).*$/i,
  /^(ssn|social.?security)$/i,
  /^(date.?of.?birth|dob|birth.?date)$/i,

  // Contact info
  /^(phone|mobile|cell|telephone).*$/i,
  /^(email|e.?mail).*$/i,
  /^(address|street|postal|zip).*$/i,

  // M-Pesa specific
  /^(initiator|security).?credential$/i,
  /^(consumer|api).?(key|secret)$/i,
  /^passkey$/i,
];

/**
 * Check if a field name matches sensitive patterns
 */
function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

/**
 * Mask phone number - show country code + last 3
 */
function maskPhoneNumber(value: string): string | null {
  const cleanPhone = value.replaceAll(/\D/g, "");
  if (cleanPhone.length >= 10) {
    return (
      cleanPhone.slice(0, 4) +
      "*".repeat(cleanPhone.length - 7) +
      cleanPhone.slice(-3)
    );
  }
  return null;
}

/**
 * Mask email - show first char + domain
 */
function maskEmail(value: string): string | null {
  const [local, domain] = value.split("@");
  if (local && domain) {
    return local[0] + "***@" + domain;
  }
  return null;
}

/**
 * Mask with last 4 visible
 */
function maskShowLast4(value: string): string {
  if (value.length > 4) {
    return "*".repeat(value.length - 4) + value.slice(-4);
  }
  return "****";
}

/**
 * Mask token - show first 8 chars for debugging
 */
function maskToken(value: string): string {
  return value.slice(0, 8) + "*".repeat(value.length - 8);
}

/**
 * Mask a string value based on its type
 */
function maskValue(value: string, fieldName: string): string {
  const lowerField = fieldName.toLowerCase();

  // Full masking for highly sensitive fields
  if (
    /(password|secret|pin|cvv|cvc|otp|key|credential|passkey)/.test(lowerField)
  ) {
    return "********";
  }

  // Phone number masking
  if (/(phone|mobile|cell)/.test(lowerField) && value.length >= 10) {
    const masked = maskPhoneNumber(value);
    if (masked) return masked;
  }

  // Email masking
  if (/(email)/.test(lowerField) && value.includes("@")) {
    const masked = maskEmail(value);
    if (masked) return masked;
  }

  // Card/account number masking - show last 4
  if (/(card|account|iban).*number/.test(lowerField)) {
    return maskShowLast4(value);
  }

  // Token masking - show first 8 chars for debugging
  if (/(token|key|secret)/.test(lowerField) && value.length > 12) {
    return maskToken(value);
  }

  // National ID masking (BVN, NIN, KRA PIN)
  if (/(bvn|nin|kra|national.*id|passport)/.test(lowerField)) {
    return maskShowLast4(value);
  }

  // Default masking
  return maskShowLast4(value);
}

/**
 * Recursively mask sensitive data in an object
 */
function maskObject(
  obj: Record<string, unknown>,
  depth: number = 0,
): Record<string, unknown> {
  // Prevent infinite recursion
  if (depth > 10) return obj;

  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      masked[key] = value;
      continue;
    }

    // Check if this field should be masked
    if (isSensitiveField(key) && typeof value === "string") {
      masked[key] = maskValue(value, key);
      continue;
    }

    // Recursively process nested objects
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      masked[key] = maskObject(value as Record<string, unknown>, depth + 1);
      continue;
    }

    // Process arrays
    if (Array.isArray(value)) {
      masked[key] = value.map((item) => {
        if (
          typeof item === "object" &&
          item !== null &&
          !(item instanceof Date)
        ) {
          return maskObject(item as Record<string, unknown>, depth + 1);
        }
        return item;
      });
      continue;
    }

    // Pass through non-sensitive values
    masked[key] = value;
  }

  return masked;
}

/**
 * Middleware to mask sensitive data in responses
 * Implements comprehensive PII masking for GDPR/POPIA compliance
 */
export async function maskSensitiveData(c: Context, next: Next) {
  await next();

  // Get response body
  const body = c.res.body;

  if (!body || body instanceof ReadableStream) {
    return;
  }

  // Only mask JSON responses
  const contentType = c.res.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    return;
  }

  try {
    if (typeof body === "object") {
      const maskedBody = maskObject(body as Record<string, unknown>);

      // Create new response with masked body
      c.res = new Response(JSON.stringify(maskedBody), {
        status: c.res.status,
        headers: c.res.headers,
      });
    }
  } catch (error) {
    // Log error but don't break response
    securityLogger.warn(
      { err: error },
      "Failed to mask sensitive data in response",
    );
  }
}

/**
 * Utility to mask data for logging (synchronous)
 */
export function maskForLogging(
  data: Record<string, unknown>,
): Record<string, unknown> {
  return maskObject(data);
}

/**
 * Utility to check if data contains sensitive fields
 */
export function containsSensitiveData(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((key) => isSensitiveField(key));
}

// ===========================================
// ENCRYPTION UTILITIES
// ===========================================

const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || randomBytes(32).toString("hex");
const ENCRYPTION_ALGORITHM = "aes-256-gcm";

/**
 * Encrypt sensitive data at rest
 */
export function encryptSensitive(data: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(
    ENCRYPTION_ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv,
  );

  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt sensitive data
 */
export function decryptSensitive(encryptedData: string): string {
  const parts = encryptedData.split(":");
  const ivHex = parts[0] || "";
  const authTagHex = parts[1] || "";
  const encrypted = parts[2] || "";

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const key = Buffer.from(ENCRYPTION_KEY, "hex");

  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Hash sensitive data (one-way)
 */
export function hashSensitive(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

// ===========================================
// AUDIT LOGGING
// ===========================================

export interface AuditLogEntry {
  timestamp: Date;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  result: "success" | "failure";
  errorMessage?: string;
}

export function createAuditLog(entry: AuditLogEntry): void {
  // In production, send to secure audit log service
  const log = {
    ...entry,
    timestamp: entry.timestamp.toISOString(),
    environment: process.env.NODE_ENV,
    service: "payment-service",
  };

  // Log to stdout for collection by log aggregator
  securityLogger.info({ type: "AUDIT", ...log }, "Audit log entry");
}

// ===========================================
// PCI DSS COMPLIANCE HELPERS
// ===========================================

/**
 * Check if card data handling is compliant
 * We should NEVER store full card numbers
 */
export function validateCardDataHandling(data: Record<string, unknown>): void {
  const cardFields = ["cardNumber", "cvv", "cvc", "pan"];

  for (const field of cardFields) {
    if (data[field]) {
      throw new Error(
        `PCI DSS Violation: ${field} should not be stored or logged`,
      );
    }
  }
}

/**
 * Mask card number for display
 */
export function maskCardNumber(cardNumber: string): string {
  if (cardNumber.length < 8) return "****";
  return "**** **** **** " + cardNumber.slice(-4);
}

// ===========================================
// SECURITY HEADERS
// ===========================================

export const securityHeadersConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: [
        "'self'",
        "https://api.paystack.co",
        "https://api.safaricom.co.ke",
      ],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: "deny" },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xssFilter: true,
};

// ===========================================
// EXPORT ALL
// ===========================================

export const security = {
  schemas: {
    PaymentAmountSchema,
    PhoneNumberSchema,
    BankAccountSchema,
    IdempotencyKeySchema,
  },
  rateLimits: rateLimitConfigs,
  verify: {
    paystack: verifyPaystackSignature,
    mpesa: verifyMpesaCallback,
    momo: verifyMomoSignature,
  },
  middleware: {
    sanitizeInput,
    requireAdmin,
    preventReplay,
    maskSensitiveData,
  },
  encryption: {
    encrypt: encryptSensitive,
    decrypt: decryptSensitive,
    hash: hashSensitive,
  },
  audit: createAuditLog,
  pci: {
    validateCardDataHandling,
    maskCardNumber,
  },
  headers: securityHeadersConfig,
  masking: {
    maskForLogging,
    containsSensitiveData,
  },
};

export default security;
