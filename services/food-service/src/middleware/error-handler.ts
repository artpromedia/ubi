/**
 * Error Handler Middleware
 */

import { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { logger } from "../lib/logger.js";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, any>;

  constructor(
    message: string,
    statusCode = 500,
    code = "INTERNAL_ERROR",
    details?: Record<string, any>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = "AppError";
  }
}

// Common errors
export const NotFoundError = (resource: string) =>
  new AppError(`${resource} not found`, 404, "NOT_FOUND");

export const ValidationError = (
  message: string,
  details?: Record<string, any>,
) => new AppError(message, 400, "VALIDATION_ERROR", details);

export const UnauthorizedError = (message = "Unauthorized") =>
  new AppError(message, 401, "UNAUTHORIZED");

export const ForbiddenError = (message = "Forbidden") =>
  new AppError(message, 403, "FORBIDDEN");

export const ConflictError = (message: string) =>
  new AppError(message, 409, "CONFLICT");

export const RateLimitError = (retryAfter?: number) =>
  new AppError("Too many requests", 429, "RATE_LIMIT_EXCEEDED", { retryAfter });

/**
 * Global Error Handler
 */
export async function errorHandler(
  c: Context,
  next: Next,
): Promise<void | Response> {
  try {
    await next();
  } catch (error: any) {
    logger.error(
      {
        path: c.req.path,
        method: c.req.method,
        err: error,
      },
      "Request error",
    );

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return c.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request data",
            details: {
              issues: error.errors.map((e) => ({
                path: e.path.join("."),
                message: e.message,
              })),
            },
          },
        },
        400,
      );
    }

    // Handle AppError
    if (error instanceof AppError) {
      return c.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        },
        error.statusCode as ContentfulStatusCode,
      );
    }

    // Handle Hono HTTP exceptions
    if (error instanceof HTTPException) {
      return c.json(
        {
          success: false,
          error: {
            code: "HTTP_ERROR",
            message: error.message,
          },
        },
        error.status,
      );
    }

    // Handle Prisma errors
    if (error.code?.startsWith("P")) {
      const prismaError = handlePrismaError(error);
      return c.json(
        {
          success: false,
          error: prismaError,
        },
        prismaError.statusCode as ContentfulStatusCode,
      );
    }

    // Default error response
    return c.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message:
            process.env.NODE_ENV === "production"
              ? "An unexpected error occurred"
              : error.message,
        },
      },
      500,
    );
  }
}

/**
 * Handle Prisma-specific errors
 */
function handlePrismaError(error: any): {
  code: string;
  message: string;
  statusCode: number;
} {
  switch (error.code) {
    case "P2002": {
      // Unique constraint violation
      const target = error.meta?.target;
      return {
        code: "DUPLICATE_ENTRY",
        message: `A record with this ${Array.isArray(target) ? target.join(", ") : "value"} already exists`,
        statusCode: 409,
      };
    }

    case "P2025":
      // Record not found
      return {
        code: "NOT_FOUND",
        message: "Record not found",
        statusCode: 404,
      };

    case "P2003":
      // Foreign key constraint failure
      return {
        code: "REFERENCE_ERROR",
        message: "Referenced record does not exist",
        statusCode: 400,
      };

    case "P2014":
      // Required relation violation
      return {
        code: "RELATION_ERROR",
        message: "Required relation is missing",
        statusCode: 400,
      };

    default:
      return {
        code: "DATABASE_ERROR",
        message: "A database error occurred",
        statusCode: 500,
      };
  }
}

/**
 * Not Found Handler
 */
export function notFound(c: Context) {
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
