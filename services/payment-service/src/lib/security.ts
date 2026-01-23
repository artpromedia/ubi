/**
 * Security Hardening Configuration
 * UBI Payment Service
 *
 * Security middleware and utilities
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { Context, Next } from "hono";
import { z } from "zod";
import { securityLogger } from "./logger.js";

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
    windowMs: 60 * 1000, // 1 minute
    max: 100,
  },

  // Payment operations (stricter)
  payment: {
    windowMs: 60 * 1000,
    max: 30,
  },

  // STK Push (very strict to prevent abuse)
  stkPush: {
    windowMs: 60 * 1000,
    max: 5,
    perUser: true,
  },

  // Webhook endpoints (higher limit)
  webhook: {
    windowMs: 60 * 1000,
    max: 1000,
  },

  // Admin endpoints
  admin: {
    windowMs: 60 * 1000,
    max: 200,
  },

  // Auth/login attempts
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    blockDuration: 60 * 60 * 1000, // 1 hour block after exceeded
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

      // Remove prototype pollution attempts
      delete body.__proto__;
      delete body.constructor;
      delete body.prototype;

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
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/javascript:/gi, "")
      .replace(/on\w+=/gi, "")
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
    const requestTime = parseInt(timestamp);
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    if (isNaN(requestTime) || Math.abs(now - requestTime) > maxAge) {
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

  // Check nonce hasn't been used (would need Redis)
  if (nonce) {
    // TODO: Check nonce in Redis
  }

  return await next();
}

/**
 * Middleware to mask sensitive data in responses
 */
export async function maskSensitiveData(c: Context, next: Next) {
  await next();

  // Get response body
  const body = c.res.body;
  if (body && typeof body === "object" && !(body instanceof ReadableStream)) {
    // maskObject would be used to replace response body
    // Currently just a placeholder for future implementation
    maskObject(body as Record<string, unknown>);
  }
}

function maskObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitiveFields = [
    "accountNumber",
    "cardNumber",
    "cvv",
    "pin",
    "password",
    "secret",
    "accessToken",
    "refreshToken",
  ];

  const masked = { ...obj };

  for (const field of sensitiveFields) {
    if (masked[field] && typeof masked[field] === "string") {
      const value = masked[field] as string;
      if (value.length > 4) {
        masked[field] = "*".repeat(value.length - 4) + value.slice(-4);
      } else {
        masked[field] = "****";
      }
    }
  }

  return masked;
}

// ===========================================
// ENCRYPTION UTILITIES
// ===========================================

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

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
};

export default security;
