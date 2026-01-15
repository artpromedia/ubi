/**
 * Global Error Handler
 *
 * Catches and formats all errors consistently.
 */

import { z } from "zod";

import { ErrorCodes, formatErrorForLogging, UbiError } from "@ubi/utils";

import type { Context } from "hono";

export const errorHandler = (error: Error, c: Context) => {
  const isDev = process.env.NODE_ENV === "development";
  const requestId = c.req.header("x-request-id") || crypto.randomUUID();

  // Log error
  console.error(
    JSON.stringify({
      requestId,
      ...formatErrorForLogging(error),
      path: c.req.path,
      method: c.req.method,
      timestamp: new Date().toISOString(),
    }),
  );

  // Handle UbiError
  if (error instanceof UbiError) {
    return c.json(error.toJSON(), error.statusCode as 400);
  }

  // Handle Zod validation errors
  if (error instanceof z.ZodError) {
    return c.json(
      {
        success: false,
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: "Request validation failed",
          details: error.errors.map((e) => ({
            path: e.path.join("."),
            message: e.message,
          })),
        },
      },
      400,
    );
  }

  // Handle Prisma errors
  if (error.name === "PrismaClientKnownRequestError") {
    const prismaError = error as Error & { code: string };

    if (prismaError.code === "P2002") {
      return c.json(
        {
          success: false,
          error: {
            code: ErrorCodes.DUPLICATE_ENTRY,
            message: "A record with this value already exists",
          },
        },
        409,
      );
    }

    if (prismaError.code === "P2025") {
      return c.json(
        {
          success: false,
          error: {
            code: ErrorCodes.NOT_FOUND,
            message: "Record not found",
          },
        },
        404,
      );
    }
  }

  // Default internal error
  return c.json(
    {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: isDev ? error.message : "An unexpected error occurred",
        ...(isDev && { stack: error.stack }),
      },
    },
    500,
  );
};
