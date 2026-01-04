/**
 * Error Handler Middleware
 */

import { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

/**
 * Custom API Error
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(
    message: string,
    code: string = "BAD_REQUEST",
    details?: Record<string, any>
  ) {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(
    message: string = "Unauthorized",
    code: string = "UNAUTHORIZED"
  ) {
    return new ApiError(401, code, message);
  }

  static forbidden(message: string = "Forbidden", code: string = "FORBIDDEN") {
    return new ApiError(403, code, message);
  }

  static notFound(message: string = "Not found", code: string = "NOT_FOUND") {
    return new ApiError(404, code, message);
  }

  static conflict(message: string, code: string = "CONFLICT") {
    return new ApiError(409, code, message);
  }

  static internal(
    message: string = "Internal server error",
    code: string = "INTERNAL_ERROR"
  ) {
    return new ApiError(500, code, message);
  }
}

/**
 * Error handler middleware
 */
export async function errorHandler(
  c: Context,
  next: Next
): Promise<void | Response> {
  try {
    await next();
  } catch (error) {
    console.error("Error:", error);

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      const fieldErrors = error.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));

      return c.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed",
            details: { fields: fieldErrors },
          },
        },
        400
      );
    }

    // Handle custom API errors
    if (error instanceof ApiError) {
      return c.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        },
        error.statusCode as ContentfulStatusCode
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
        error.status
      );
    }

    // Handle Prisma errors
    if (error instanceof Error) {
      if (error.name === "PrismaClientKnownRequestError") {
        const prismaError = error as any;

        switch (prismaError.code) {
          case "P2002":
            return c.json(
              {
                success: false,
                error: {
                  code: "DUPLICATE_ENTRY",
                  message: "A record with this value already exists",
                  details: { fields: prismaError.meta?.target },
                },
              },
              409
            );

          case "P2025":
            return c.json(
              {
                success: false,
                error: {
                  code: "NOT_FOUND",
                  message: "Record not found",
                },
              },
              404
            );

          default:
            console.error(
              "Prisma error:",
              prismaError.code,
              prismaError.message
            );
        }
      }
    }

    // Generic error response
    const isProduction = process.env.NODE_ENV === "production";

    return c.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: isProduction
            ? "An unexpected error occurred"
            : error instanceof Error
              ? error.message
              : "Unknown error",
        },
      },
      500
    );
  }
}
