/**
 * Authentication Helpers
 *
 * Common authentication flows for performance tests
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { getBaseUrl, generatePhoneNumber } from "../config";
import { createHeaders, authSuccess, authFailure, ApiResponse } from "./http";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface User {
  id: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  email?: string;
}

// Test user pool for load testing
export const TEST_USERS = [
  { phone: "+2348012345001", pin: "1234" },
  { phone: "+2348012345002", pin: "1234" },
  { phone: "+2348012345003", pin: "1234" },
  { phone: "+2348012345004", pin: "1234" },
  { phone: "+2348012345005", pin: "1234" },
  { phone: "+2348012345006", pin: "1234" },
  { phone: "+2348012345007", pin: "1234" },
  { phone: "+2348012345008", pin: "1234" },
  { phone: "+2348012345009", pin: "1234" },
  { phone: "+2348012345010", pin: "1234" },
];

// Get a test user based on VU ID for distribution
export function getTestUser(vuId: number): { phone: string; pin: string } {
  const index = vuId % TEST_USERS.length;
  return TEST_USERS[index];
}

// Request OTP
export function requestOtp(phoneNumber: string): boolean {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/auth/otp/request`;

  const response = http.post(url, JSON.stringify({ phoneNumber }), {
    headers: createHeaders(),
  });

  const passed = check(response, {
    "OTP request - status is 200": (r) => r.status === 200,
    "OTP request - success": (r) => {
      try {
        const body = JSON.parse(r.body as string) as ApiResponse;
        return body.success === true;
      } catch {
        return false;
      }
    },
  });

  if (passed) {
    authSuccess.add(1);
  } else {
    authFailure.add(1);
  }

  return passed;
}

// Verify OTP and get tokens
export function verifyOtp(phoneNumber: string, otp: string): AuthTokens | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/auth/otp/verify`;

  const response = http.post(url, JSON.stringify({ phoneNumber, otp }), {
    headers: createHeaders(),
  });

  const passed = check(response, {
    "OTP verify - status is 200": (r) => r.status === 200,
    "OTP verify - returns tokens": (r) => {
      try {
        const body = JSON.parse(r.body as string) as ApiResponse<{
          tokens: AuthTokens;
        }>;
        return body.success === true && body.data?.tokens !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (!passed) {
    authFailure.add(1);
    return null;
  }

  authSuccess.add(1);

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      tokens: AuthTokens;
    }>;
    return body.data?.tokens || null;
  } catch {
    return null;
  }
}

// Login with phone and PIN (for returning users)
export function loginWithPin(
  phoneNumber: string,
  pin: string,
): AuthTokens | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/auth/login`;

  const response = http.post(url, JSON.stringify({ phoneNumber, pin }), {
    headers: createHeaders(),
  });

  const passed = check(response, {
    "Login - status is 200": (r) => r.status === 200,
    "Login - returns tokens": (r) => {
      try {
        const body = JSON.parse(r.body as string) as ApiResponse<{
          tokens: AuthTokens;
        }>;
        return body.success === true && body.data?.tokens !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (!passed) {
    authFailure.add(1);
    return null;
  }

  authSuccess.add(1);

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      tokens: AuthTokens;
    }>;
    return body.data?.tokens || null;
  } catch {
    return null;
  }
}

// Refresh access token
export function refreshToken(refreshToken: string): AuthTokens | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/auth/refresh`;

  const response = http.post(url, JSON.stringify({ refreshToken }), {
    headers: createHeaders(),
  });

  const passed = check(response, {
    "Token refresh - status is 200": (r) => r.status === 200,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      tokens: AuthTokens;
    }>;
    return body.data?.tokens || null;
  } catch {
    return null;
  }
}

// Get current user profile
export function getCurrentUser(accessToken: string): User | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/users/me`;

  const response = http.get(url, {
    headers: createHeaders(accessToken),
  });

  const passed = check(response, {
    "Get user - status is 200": (r) => r.status === 200,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      user: User;
    }>;
    return body.data?.user || null;
  } catch {
    return null;
  }
}

// Full authentication flow simulation
export function authenticateUser(vuId: number): {
  tokens: AuthTokens;
  user: User;
} | null {
  const testUser = getTestUser(vuId);

  // Request OTP
  if (!requestOtp(testUser.phone)) {
    console.error(`Failed to request OTP for ${testUser.phone}`);
    return null;
  }

  // In test mode, OTP is usually "123456" or we use PIN instead
  sleep(0.5); // Simulate user waiting for SMS

  // For load testing, we'll use PIN-based login
  const tokens = loginWithPin(testUser.phone, testUser.pin);
  if (!tokens) {
    console.error(`Failed to login for ${testUser.phone}`);
    return null;
  }

  // Get user profile
  const user = getCurrentUser(tokens.accessToken);
  if (!user) {
    console.error(`Failed to get user profile for ${testUser.phone}`);
    return null;
  }

  return { tokens, user };
}

// Logout
export function logout(accessToken: string): boolean {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/auth/logout`;

  const response = http.post(url, null, {
    headers: createHeaders(accessToken),
  });

  return check(response, {
    "Logout - status is 200 or 204": (r) =>
      r.status === 200 || r.status === 204,
  });
}
