/**
 * k6 HTTP Helpers
 *
 * Common HTTP utilities for performance tests
 */

import http, { RefinedResponse, ResponseType } from "k6/http";
import { check, fail } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// Custom metrics
export const errorRate = new Rate("error_rate");
export const requestDuration = new Trend("request_duration", true);
export const authSuccess = new Counter("auth_success");
export const authFailure = new Counter("auth_failure");
export const rideRequests = new Counter("ride_requests");
export const paymentRequests = new Counter("payment_requests");

// Request headers
export interface AuthHeaders {
  Authorization: string;
  "Content-Type": string;
  Accept: string;
  "X-Request-ID"?: string;
  "X-Client-Version"?: string;
  "X-Device-Type"?: string;
}

export function createHeaders(token?: string): AuthHeaders {
  const headers: AuthHeaders = {
    Authorization: token ? `Bearer ${token}` : "",
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Request-ID": `k6-${Date.now()}-${Math.random().toString(36).substring(2, 2 + 9)}`,
    "X-Client-Version": "1.0.0",
    "X-Device-Type": "web",
  };

  return headers;
}

// Response type
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

// Checked HTTP methods
export function checkedGet<T>(
  url: string,
  headers: AuthHeaders,
  checkName: string
): ApiResponse<T> | null {
  const response = http.get(url, { headers });

  requestDuration.add(response.timings.duration);

  const passed = check(response, {
    [`${checkName} - status is 200`]: (r) => r.status === 200,
    [`${checkName} - response has body`]: (r) => r.body !== null,
  });

  errorRate.add(!passed);

  if (!passed) {
    console.error(`GET ${url} failed: ${response.status} - ${response.body}`);
    return null;
  }

  try {
    return JSON.parse(response.body as string) as ApiResponse<T>;
  } catch {
    return null;
  }
}

export function checkedPost<T, B = unknown>(
  url: string,
  body: B,
  headers: AuthHeaders,
  checkName: string,
  expectedStatus: number = 200
): ApiResponse<T> | null {
  const response = http.post(url, JSON.stringify(body), { headers });

  requestDuration.add(response.timings.duration);

  const passed = check(response, {
    [`${checkName} - status is ${expectedStatus}`]: (r) =>
      r.status === expectedStatus,
    [`${checkName} - response has body`]: (r) => r.body !== null,
  });

  errorRate.add(!passed);

  if (!passed) {
    console.error(`POST ${url} failed: ${response.status} - ${response.body}`);
    return null;
  }

  try {
    return JSON.parse(response.body as string) as ApiResponse<T>;
  } catch {
    return null;
  }
}

export function checkedPut<T, B = unknown>(
  url: string,
  body: B,
  headers: AuthHeaders,
  checkName: string
): ApiResponse<T> | null {
  const response = http.put(url, JSON.stringify(body), { headers });

  requestDuration.add(response.timings.duration);

  const passed = check(response, {
    [`${checkName} - status is 200`]: (r) => r.status === 200,
  });

  errorRate.add(!passed);

  if (!passed) {
    console.error(`PUT ${url} failed: ${response.status} - ${response.body}`);
    return null;
  }

  try {
    return JSON.parse(response.body as string) as ApiResponse<T>;
  } catch {
    return null;
  }
}

export function checkedDelete(
  url: string,
  headers: AuthHeaders,
  checkName: string
): boolean {
  const response = http.del(url, null, { headers });

  requestDuration.add(response.timings.duration);

  const passed = check(response, {
    [`${checkName} - status is 200 or 204`]: (r) =>
      r.status === 200 || r.status === 204,
  });

  errorRate.add(!passed);

  return passed;
}

// Batch requests
export interface BatchRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  body?: unknown;
  params?: {
    headers: AuthHeaders;
    tags?: Record<string, string>;
  };
}

export function batchRequests(
  requests: BatchRequest[],
  checkName: string
): RefinedResponse<ResponseType>[] {
  const batchArray = requests.map((req) => {
    return {
      method: req.method,
      url: req.url,
      body: req.body ? JSON.stringify(req.body) : null,
      params: req.params,
    };
  });

  const responses = http.batch(batchArray);

  const allPassed = responses.every((r) => r.status >= 200 && r.status < 300);
  errorRate.add(!allPassed);

  check(responses, {
    [`${checkName} - all batch requests succeeded`]: () => allPassed,
  });

  return responses;
}

// Retry logic for unreliable networks
export function withRetry<T>(
  fn: () => T | null,
  maxRetries: number = 3,
  backoffMs: number = 1000
): T | null {
  let lastError: unknown;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const result = fn();
      if (result !== null) return result;
    } catch (e) {
      lastError = e;
    }

    retryCount++;
    if (retryCount < maxRetries) {
      // Simple sleep (k6 sleep in actual usage)
      const waitTime = backoffMs * Math.pow(2, retryCount - 1);
      console.log(`Retry ${retryCount}/${maxRetries} after ${waitTime}ms`);
    }
  }

  console.error(
    `All ${maxRetries} retries failed. Last error: ${lastError}`
  );
  return null;
}
