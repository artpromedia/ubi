/**
 * Error Handling Utilities
 *
 * Standardized error handling across all UBI services.
 */

/**
 * UBI Error codes used across all services
 */
export const ErrorCodes = {
  // Authentication errors (1xxx)
  UNAUTHORIZED: "E1001",
  INVALID_TOKEN: "E1002",
  TOKEN_EXPIRED: "E1003",
  INVALID_CREDENTIALS: "E1004",
  ACCOUNT_LOCKED: "E1005",
  OTP_INVALID: "E1006",
  OTP_EXPIRED: "E1007",
  SESSION_EXPIRED: "E1008",

  // Authorization errors (2xxx)
  FORBIDDEN: "E2001",
  INSUFFICIENT_PERMISSIONS: "E2002",
  ROLE_REQUIRED: "E2003",
  ACCOUNT_SUSPENDED: "E2004",
  DRIVER_NOT_VERIFIED: "E2005",

  // Validation errors (3xxx)
  VALIDATION_ERROR: "E3001",
  INVALID_INPUT: "E3002",
  MISSING_REQUIRED_FIELD: "E3003",
  INVALID_FORMAT: "E3004",
  VALUE_OUT_OF_RANGE: "E3005",
  DUPLICATE_ENTRY: "E3006",

  // Resource errors (4xxx)
  NOT_FOUND: "E4001",
  USER_NOT_FOUND: "E4002",
  RIDE_NOT_FOUND: "E4003",
  ORDER_NOT_FOUND: "E4004",
  DRIVER_NOT_FOUND: "E4005",
  RESTAURANT_NOT_FOUND: "E4006",
  DELIVERY_NOT_FOUND: "E4007",
  PAYMENT_NOT_FOUND: "E4008",

  // Business logic errors (5xxx)
  RIDE_ALREADY_ACCEPTED: "E5001",
  NO_DRIVERS_AVAILABLE: "E5002",
  OUTSIDE_SERVICE_AREA: "E5003",
  RESTAURANT_CLOSED: "E5004",
  INSUFFICIENT_BALANCE: "E5005",
  DRIVER_OFFLINE: "E5006",
  RIDE_CANCELLED: "E5007",
  ORDER_CANCELLED: "E5008",
  RIDE_IN_PROGRESS: "E5009",
  INVALID_RIDE_STATUS: "E5010",
  INVALID_ORDER_STATUS: "E5011",
  MENU_ITEM_UNAVAILABLE: "E5012",
  MINIMUM_ORDER_NOT_MET: "E5013",
  DELIVERY_TOO_FAR: "E5014",
  CEERION_PAYMENT_OVERDUE: "E5015",

  // Payment errors (6xxx)
  PAYMENT_FAILED: "E6001",
  PAYMENT_DECLINED: "E6002",
  PAYMENT_TIMEOUT: "E6003",
  INVALID_PAYMENT_METHOD: "E6004",
  WALLET_DISABLED: "E6005",
  WITHDRAWAL_LIMIT_EXCEEDED: "E6006",
  REFUND_FAILED: "E6007",
  MOBILE_MONEY_ERROR: "E6008",
  CARD_DECLINED: "E6009",

  // Rate limiting errors (7xxx)
  RATE_LIMIT_EXCEEDED: "E7001",
  TOO_MANY_REQUESTS: "E7002",
  DAILY_LIMIT_EXCEEDED: "E7003",

  // External service errors (8xxx)
  EXTERNAL_SERVICE_ERROR: "E8001",
  MAPS_API_ERROR: "E8002",
  SMS_PROVIDER_ERROR: "E8003",
  PUSH_NOTIFICATION_ERROR: "E8004",
  PAYMENT_PROVIDER_ERROR: "E8005",

  // Internal errors (9xxx)
  INTERNAL_ERROR: "E9001",
  DATABASE_ERROR: "E9002",
  CACHE_ERROR: "E9003",
  QUEUE_ERROR: "E9004",
  SERVICE_UNAVAILABLE: "E9005",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * HTTP status code mapping for error codes
 */
export const ErrorHttpStatus: Record<string, number> = {
  // 1xxx - 401 Unauthorized
  E1001: 401,
  E1002: 401,
  E1003: 401,
  E1004: 401,
  E1005: 401,
  E1006: 401,
  E1007: 401,
  E1008: 401,

  // 2xxx - 403 Forbidden
  E2001: 403,
  E2002: 403,
  E2003: 403,
  E2004: 403,
  E2005: 403,

  // 3xxx - 400 Bad Request
  E3001: 400,
  E3002: 400,
  E3003: 400,
  E3004: 400,
  E3005: 400,
  E3006: 409, // Conflict for duplicates

  // 4xxx - 404 Not Found
  E4001: 404,
  E4002: 404,
  E4003: 404,
  E4004: 404,
  E4005: 404,
  E4006: 404,
  E4007: 404,
  E4008: 404,

  // 5xxx - 422 Unprocessable Entity
  E5001: 409,
  E5002: 503,
  E5003: 422,
  E5004: 422,
  E5005: 422,
  E5006: 422,
  E5007: 409,
  E5008: 409,
  E5009: 409,
  E5010: 422,
  E5011: 422,
  E5012: 422,
  E5013: 422,
  E5014: 422,
  E5015: 402,

  // 6xxx - 402 Payment Required
  E6001: 402,
  E6002: 402,
  E6003: 408,
  E6004: 400,
  E6005: 403,
  E6006: 422,
  E6007: 500,
  E6008: 502,
  E6009: 402,

  // 7xxx - 429 Too Many Requests
  E7001: 429,
  E7002: 429,
  E7003: 429,

  // 8xxx - 502 Bad Gateway
  E8001: 502,
  E8002: 502,
  E8003: 502,
  E8004: 502,
  E8005: 502,

  // 9xxx - 500 Internal Server Error
  E9001: 500,
  E9002: 500,
  E9003: 500,
  E9004: 500,
  E9005: 503,
};

/**
 * UBI Application Error class
 */
export class UbiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly isOperational: boolean;
  public readonly timestamp: Date;
  public readonly requestId?: string;

  constructor(
    code: string,
    message: string,
    options?: {
      details?: unknown;
      cause?: Error;
      requestId?: string;
      isOperational?: boolean;
    },
  ) {
    super(message);

    this.name = "UbiError";
    this.code = code;
    this.statusCode = ErrorHttpStatus[code] || 500;
    this.details = options?.details;
    this.isOperational = options?.isOperational ?? true;
    this.timestamp = new Date();
    this.requestId = options?.requestId;

    if (options?.cause) {
      this.cause = options.cause;
    }

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON response format
   */
  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        timestamp: this.timestamp.toISOString(),
        requestId: this.requestId,
      },
    };
  }

  /**
   * Create error with details
   */
  static withDetails(
    code: string,
    message: string,
    details: unknown,
  ): UbiError {
    return new UbiError(code, message, { details });
  }
}

/**
 * Validation Error - for request validation failures
 */
export class ValidationError extends UbiError {
  public readonly fieldErrors: Record<string, string[]>;

  constructor(
    message: string,
    fieldErrors: Record<string, string[]>,
    options?: { requestId?: string },
  ) {
    super(ErrorCodes.VALIDATION_ERROR, message, {
      details: { fieldErrors },
      requestId: options?.requestId,
    });
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Not Found Error
 */
export class NotFoundError extends UbiError {
  constructor(
    resource: string,
    identifier?: string,
    options?: { requestId?: string },
  ) {
    const message = identifier
      ? `${resource} with ID '${identifier}' not found`
      : `${resource} not found`;

    super(ErrorCodes.NOT_FOUND, message, {
      details: { resource, identifier },
      requestId: options?.requestId,
    });
    this.name = "NotFoundError";
  }
}

/**
 * Unauthorized Error
 */
export class UnauthorizedError extends UbiError {
  constructor(
    message: string = "Authentication required",
    options?: { requestId?: string },
  ) {
    super(ErrorCodes.UNAUTHORIZED, message, { requestId: options?.requestId });
    this.name = "UnauthorizedError";
  }
}

/**
 * Forbidden Error
 */
export class ForbiddenError extends UbiError {
  constructor(
    message: string = "You do not have permission to perform this action",
    options?: { requestId?: string },
  ) {
    super(ErrorCodes.FORBIDDEN, message, { requestId: options?.requestId });
    this.name = "ForbiddenError";
  }
}

/**
 * Rate Limit Error
 */
export class RateLimitError extends UbiError {
  public readonly retryAfter: number;

  constructor(retryAfter: number = 60, options?: { requestId?: string }) {
    super(
      ErrorCodes.RATE_LIMIT_EXCEEDED,
      "Too many requests. Please try again later.",
      {
        details: { retryAfter },
        requestId: options?.requestId,
      },
    );
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * Payment Error
 */
export class PaymentError extends UbiError {
  constructor(
    code: string,
    message: string,
    options?: { details?: unknown; requestId?: string },
  ) {
    super(code, message, options);
    this.name = "PaymentError";
  }
}

/**
 * External Service Error
 */
export class ExternalServiceError extends UbiError {
  constructor(
    serviceName: string,
    message: string,
    options?: {
      cause?: Error;
      details?: Record<string, unknown>;
      requestId?: string;
    },
  ) {
    const additionalDetails = options?.details ?? {};
    super(ErrorCodes.EXTERNAL_SERVICE_ERROR, message, {
      details: { service: serviceName, ...additionalDetails },
      cause: options?.cause,
      requestId: options?.requestId,
    });
    this.name = "ExternalServiceError";
  }
}

/**
 * Check if error is operational (expected) vs programming error
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof UbiError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Wrap async functions to catch and transform errors
 * Returns the original function with proper error propagation
 */
export function catchAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
): T {
  return ((...args: unknown[]) => {
    return fn(...args);
  }) as T;
}

/**
 * Safely extract error message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unexpected error occurred";
}

/**
 * Safely extract error code
 */
export function getErrorCode(error: unknown): string {
  if (error instanceof UbiError) {
    return error.code;
  }
  return ErrorCodes.INTERNAL_ERROR;
}

/**
 * Format error for logging
 */
export function formatErrorForLogging(error: unknown): Record<string, unknown> {
  if (error instanceof UbiError) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      details: error.details,
      requestId: error.requestId,
      timestamp: error.timestamp,
      stack: error.stack,
      cause: error.cause ? formatErrorForLogging(error.cause) : undefined,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? formatErrorForLogging(error.cause) : undefined,
    };
  }

  if (typeof error === "string") {
    return { error };
  }

  if (error && typeof error === "object") {
    return { error: JSON.stringify(error) };
  }

  return { error: "Unknown error" };
}
