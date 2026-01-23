/**
 * Error Handler Middleware
 */

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { logger } from "../lib/logger.js";

// Type guards for Prisma errors
function isPrismaKnownRequestError(
  error: unknown,
): error is { code: string; meta?: Record<string, unknown> } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    error.constructor.name === "PrismaClientKnownRequestError"
  );
}

function isPrismaValidationError(error: unknown): error is Error {
  return (
    typeof error === "object" &&
    error !== null &&
    error.constructor.name === "PrismaClientValidationError"
  );
}

// ============================================
// Custom Error Classes
// ============================================

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      "NOT_FOUND",
      id ? `${resource} with ID ${id} not found` : `${resource} not found`,
      404,
    );
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super("FORBIDDEN", message, 403);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = "Rate limit exceeded") {
    super("RATE_LIMIT_EXCEEDED", message, 429);
  }
}

export class ProviderError extends AppError {
  constructor(provider: string, message: string) {
    super("PROVIDER_ERROR", `${provider}: ${message}`, 502);
  }
}

// ============================================
// Error Response Interface
// ============================================

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    stack?: string;
  };
}

// ============================================
// Error Handler
// ============================================

export function errorHandler(err: Error, c: Context): Response {
  logger.error({ err }, "Request error");

  let response: ErrorResponse = {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
  };

  let statusCode = 500;

  // Handle custom app errors
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    response.error = {
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }

  // Handle HTTP exceptions
  else if (err instanceof HTTPException) {
    statusCode = err.status;
    response.error = {
      code: "HTTP_ERROR",
      message: err.message,
    };
  }

  // Handle Zod validation errors
  else if (err instanceof ZodError) {
    statusCode = 400;
    response.error = {
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: {
        errors: err.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      },
    };
  }

  // Handle Prisma errors
  else if (isPrismaKnownRequestError(err)) {
    switch (err.code) {
      case "P2002": // Unique constraint violation
        statusCode = 409;
        response.error = {
          code: "UNIQUE_VIOLATION",
          message: "A record with this value already exists",
          details: { fields: err.meta?.target },
        };
        break;

      case "P2025": // Record not found
        statusCode = 404;
        response.error = {
          code: "NOT_FOUND",
          message: "Record not found",
        };
        break;

      case "P2003": // Foreign key constraint violation
        statusCode = 400;
        response.error = {
          code: "FOREIGN_KEY_VIOLATION",
          message: "Related record not found",
          details: { field: err.meta?.field_name },
        };
        break;

      case "P2014": // Required relation violation
        statusCode = 400;
        response.error = {
          code: "RELATION_VIOLATION",
          message: "Required relation missing",
        };
        break;

      default:
        response.error = {
          code: `PRISMA_${err.code}`,
          message: "Database operation failed",
        };
    }
  }

  // Handle Prisma validation errors
  else if (isPrismaValidationError(err)) {
    statusCode = 400;
    response.error = {
      code: "PRISMA_VALIDATION",
      message: "Invalid data provided",
    };
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === "development") {
    response.error.stack = err.stack;
  }

  return c.json(
    response,
    statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502,
  );
}

// ============================================
// Not Found Handler
// ============================================

export function notFoundHandler(c: Context): Response {
  return c.json(
    {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
    },
    404,
  );
}
