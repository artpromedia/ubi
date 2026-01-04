/**
 * API Response Matchers
 *
 * Custom matchers for validating API responses.
 */

import { expect } from "vitest";
import type { TestApiError, TestApiResponse } from "../types";

interface ApiResponseMatchers<R = unknown> {
  toBeSuccessResponse(): R;
  toBeErrorResponse(expectedStatus?: number): R;
  toHaveResponseData<T>(validator?: (data: T) => boolean): R;
  toMatchApiSchema(schema: Record<string, unknown>): R;
  toHavePagination(): R;
}

declare module "vitest" {
  interface Assertion<T = unknown> extends ApiResponseMatchers<T> {}
  interface AsymmetricMatchersContaining extends ApiResponseMatchers {}
}

/**
 * Check if response is a successful API response
 */
export function toBeSuccessResponse(received: unknown) {
  const response = received as TestApiResponse<unknown>;

  const pass =
    response &&
    typeof response === "object" &&
    "success" in response &&
    response.success === true &&
    "data" in response;

  return {
    pass,
    message: () =>
      pass
        ? `Expected response not to be a success response`
        : `Expected response to be a success response with { success: true, data: ... }, but got ${JSON.stringify(received)}`,
  };
}

/**
 * Check if response is an error response
 */
export function toBeErrorResponse(received: unknown, expectedStatus?: number) {
  const response = received as TestApiError;

  let pass =
    response &&
    typeof response === "object" &&
    "error" in response &&
    typeof response.error === "string";

  if (pass && expectedStatus !== undefined) {
    pass = response.status === expectedStatus;
  }

  return {
    pass,
    message: () =>
      pass
        ? `Expected response not to be an error response`
        : `Expected response to be an error response${expectedStatus ? ` with status ${expectedStatus}` : ""}, but got ${JSON.stringify(received)}`,
  };
}

/**
 * Check if response has valid data matching optional validator
 */
export function toHaveResponseData<T>(
  received: unknown,
  validator?: (data: T) => boolean
) {
  const response = received as TestApiResponse<T>;

  let pass =
    response &&
    typeof response === "object" &&
    "data" in response &&
    response.data !== null &&
    response.data !== undefined;

  if (pass && validator) {
    pass = validator(response.data);
  }

  return {
    pass,
    message: () =>
      pass
        ? `Expected response not to have valid data`
        : `Expected response to have valid data${validator ? " matching validator" : ""}, but got ${JSON.stringify(received)}`,
  };
}

/**
 * Check if response matches expected schema structure
 */
export function toMatchApiSchema(
  received: unknown,
  schema: Record<string, string | Record<string, unknown>>
) {
  const response = received as TestApiResponse<Record<string, unknown>>;

  if (!response || typeof response !== "object" || !("data" in response)) {
    return {
      pass: false,
      message: () => `Expected response to have data property`,
    };
  }

  const data = response.data as Record<string, unknown>;
  const missingKeys: string[] = [];
  const wrongTypes: string[] = [];

  for (const [key, expectedType] of Object.entries(schema)) {
    if (!(key in data)) {
      missingKeys.push(key);
    } else if (typeof expectedType === "string") {
      const actualType = Array.isArray(data[key]) ? "array" : typeof data[key];
      if (actualType !== expectedType) {
        wrongTypes.push(`${key}: expected ${expectedType}, got ${actualType}`);
      }
    }
  }

  const pass = missingKeys.length === 0 && wrongTypes.length === 0;

  return {
    pass,
    message: () =>
      pass
        ? `Expected response not to match schema`
        : `Response does not match schema. Missing keys: [${missingKeys.join(", ")}]. Wrong types: [${wrongTypes.join(", ")}]`,
  };
}

/**
 * Check if response has pagination metadata
 */
export function toHavePagination(received: unknown) {
  const response = received as TestApiResponse<unknown>;

  const pass =
    response &&
    typeof response === "object" &&
    "meta" in response &&
    response.meta &&
    typeof response.meta === "object" &&
    "page" in response.meta &&
    "limit" in response.meta &&
    ("total" in response.meta || "totalPages" in response.meta);

  return {
    pass,
    message: () =>
      pass
        ? `Expected response not to have pagination`
        : `Expected response to have pagination metadata (meta.page, meta.limit, meta.total), but got ${JSON.stringify((received as any)?.meta)}`,
  };
}

/**
 * API matchers object for extending expect
 */
export const apiMatchers = {
  toBeSuccessResponse,
  toBeErrorResponse,
  toHaveResponseData,
  toMatchApiSchema,
  toHavePagination,
};
