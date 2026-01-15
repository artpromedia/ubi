/**
 * Global Error Handler
 *
 * Catches all unhandled errors and returns consistent error responses.
 * Logs errors for debugging and monitoring.
 */

import { z } from "zod";

import type { Context } from "hono";
import type { StatusCode } from "hono/utils/http-status";

// Error types
interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    stack?: string;
  };
}

// Known error codes and their HTTP status codes
const ERROR_STATUS_MAP: Record<string, StatusCode> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  RATE_LIMIT_EXCEEDED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export const errorHandler = (error: Error, c: Context) => {
  const isDev = process.env.NODE_ENV === "development";
  const requestId = c.req.header("x-request-id") || crypto.randomUUID();

  // Log error
  console.error({
    requestId,
    error: error.message,
    stack: error.stack,
    path: c.req.path,
    method: c.req.method,
    timestamp: new Date().toISOString(),
  });

  // Handle Zod validation errors
  if (error instanceof z.ZodError) {
    const response: ApiError = {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      },
    };

    return c.json(response, 400);
  }

  // Handle known application errors
  if (error.name === "AppError" && "code" in error) {
    const appError = error as Error & { code: string; statusCode?: number };
    const status = (appError.statusCode ||
      ERROR_STATUS_MAP[appError.code] ||
      500) as 200 | 400 | 401 | 403 | 404 | 500 | 502 | 503;

    const response: ApiError = {
      success: false,
      error: {
        code: appError.code,
        message: appError.message,
        ...(isDev && { stack: appError.stack }),
      },
    };

    return c.json(response, status);
  }

  // Handle fetch/network errors (from proxy to downstream services)
  if (error.name === "FetchError" || error.message.includes("fetch")) {
    const response: ApiError = {
      success: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Unable to connect to the service. Please try again later.",
        ...(isDev && { details: error.message }),
      },
    };

    return c.json(response, 503);
  }

  // Handle timeout errors
  if (error.name === "TimeoutError" || error.message.includes("timeout")) {
    const response: ApiError = {
      success: false,
      error: {
        code: "GATEWAY_TIMEOUT",
        message: "The request took too long to process. Please try again.",
      },
    };

    return c.json(response, 504);
  }

  // Default: Internal server error
  const response: ApiError = {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: isDev
        ? error.message
        : "An unexpected error occurred. Please try again later.",
      ...(isDev && { stack: error.stack }),
    },
  };

  return c.json(response, 500);
};

/**
 * Custom application error class
 */
export class AppError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode || ERROR_STATUS_MAP[code] || 500;
  }

  static badRequest(message: string) {
    return new AppError("BAD_REQUEST", message, 400);
  }

  static unauthorized(message = "Authentication required") {
    return new AppError("UNAUTHORIZED", message, 401);
  }

  static forbidden(
    message = "You don't have permission to access this resource"
  ) {
    return new AppError("FORBIDDEN", message, 403);
  }

  static notFound(resource = "Resource") {
    return new AppError("NOT_FOUND", `${resource} not found`, 404);
  }

  static conflict(message: string) {
    return new AppError("CONFLICT", message, 409);
  }

  static internal(message = "An unexpected error occurred") {
    return new AppError("INTERNAL_ERROR", message, 500);
  }
}
