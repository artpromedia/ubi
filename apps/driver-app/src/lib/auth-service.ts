/**
 * Authentication Service
 *
 * Handles user login, registration, OTP verification, and token management.
 */

import apiClient, { type ApiResponse } from "./api-client";

export interface LoginOTPRequest {
  phone: string;
}

export interface VerifyOTPRequest {
  phone: string;
  code: string;
}

export interface RegisterRequest {
  phone: string;
  email?: string;
  firstName: string;
  lastName: string;
  country: string;
  role: "DRIVER";
  referralCode?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserProfile {
  id: string;
  phone: string;
  email?: string;
  firstName: string;
  lastName: string;
  photoUrl?: string;
  role: string;
  isVerified: boolean;
  createdAt: string;
}

export interface DriverProfile extends UserProfile {
  driver: {
    id: string;
    licenseNumber: string;
    vehicleType: string;
    isOnline: boolean;
    isAvailable: boolean;
    rating: number;
    totalTrips: number;
    vehicle?: {
      make: string;
      model: string;
      year: number;
      color: string;
      plateNumber: string;
    };
  };
}

export const authService = {
  /**
   * Request OTP for phone login
   */
  async requestOTP(phone: string): Promise<ApiResponse<{ message: string }>> {
    return apiClient.post("/auth/otp/request", { phone });
  },

  /**
   * Verify OTP and get auth tokens
   */
  async verifyOTP(
    phone: string,
    code: string,
  ): Promise<ApiResponse<{ tokens: AuthTokens; user: UserProfile }>> {
    return apiClient.post("/auth/otp/verify", { phone, code });
  },

  /**
   * Register a new driver
   */
  async register(
    data: RegisterRequest,
  ): Promise<ApiResponse<{ user: UserProfile; message: string }>> {
    return apiClient.post("/auth/register", data);
  },

  /**
   * Refresh access token
   */
  async refreshToken(
    refreshToken: string,
  ): Promise<ApiResponse<{ accessToken: string; expiresIn: number }>> {
    return apiClient.post("/auth/refresh", { refreshToken });
  },

  /**
   * Logout and invalidate tokens
   */
  async logout(): Promise<ApiResponse<{ message: string }>> {
    return apiClient.post("/auth/logout");
  },

  /**
   * Get current user profile
   */
  async getProfile(): Promise<ApiResponse<DriverProfile>> {
    return apiClient.get("/users/me");
  },

  /**
   * Change password
   */
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient.post("/auth/password/change", {
      currentPassword,
      newPassword,
    });
  },
};

export default authService;
