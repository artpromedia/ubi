/**
 * User Service API
 *
 * API client for user-related operations.
 */

import { type ApiClient, getApiClient } from "../client";
import type {
    Address,
    ApiResponse,
    PaginatedResponse,
    PaginationParams,
    Timestamps,
} from "../types";

// User types
export type UserRole = "rider" | "driver" | "admin" | "restaurant" | "merchant";
export type UserStatus = "active" | "inactive" | "suspended" | "pending";

export interface User extends Timestamps {
  id: string;
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl?: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  preferences?: UserPreferences;
}

export interface UserPreferences {
  language: string;
  currency: string;
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
  };
  theme: "light" | "dark" | "system";
}

export interface UserProfile extends User {
  addresses?: Address[];
  paymentMethods?: PaymentMethod[];
  stats?: UserStats;
}

export interface PaymentMethod {
  id: string;
  type: "card" | "mobile_money" | "bank";
  lastFour?: string;
  brand?: string;
  provider?: string;
  isDefault: boolean;
}

export interface UserStats {
  totalRides: number;
  totalOrders: number;
  totalDeliveries: number;
  totalSpent: {
    amount: number;
    currency: string;
  };
  memberSince: string;
}

// Request/Response types
export interface RegisterRequest {
  email: string;
  phone?: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
}

export interface LoginRequest {
  email?: string;
  phone?: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
  preferences?: Partial<UserPreferences>;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ResetPasswordRequest {
  email: string;
}

export interface VerifyEmailRequest {
  token: string;
}

export interface VerifyPhoneRequest {
  code: string;
}

export interface UserFilters extends PaginationParams {
  role?: UserRole;
  status?: UserStatus;
  search?: string;
}

// User Service API
export class UserServiceApi {
  private client: ApiClient;
  private basePath = "users";

  constructor(client?: ApiClient) {
    this.client = client ?? getApiClient();
  }

  // Authentication
  async register(data: RegisterRequest): Promise<ApiResponse<AuthResponse>> {
    return this.client.post("auth/register", data);
  }

  async login(data: LoginRequest): Promise<ApiResponse<AuthResponse>> {
    return this.client.post("auth/login", data);
  }

  async logout(): Promise<ApiResponse<void>> {
    return this.client.post("auth/logout");
  }

  async refreshToken(refreshToken: string): Promise<ApiResponse<AuthResponse>> {
    return this.client.post("auth/refresh", { refreshToken });
  }

  async forgotPassword(data: ResetPasswordRequest): Promise<ApiResponse<void>> {
    return this.client.post("auth/forgot-password", data);
  }

  async resetPassword(token: string, newPassword: string): Promise<ApiResponse<void>> {
    return this.client.post("auth/reset-password", { token, newPassword });
  }

  async verifyEmail(data: VerifyEmailRequest): Promise<ApiResponse<void>> {
    return this.client.post("auth/verify-email", data);
  }

  async sendPhoneVerification(): Promise<ApiResponse<void>> {
    return this.client.post("auth/send-phone-verification");
  }

  async verifyPhone(data: VerifyPhoneRequest): Promise<ApiResponse<void>> {
    return this.client.post("auth/verify-phone", data);
  }

  // Current user
  async getMe(): Promise<ApiResponse<UserProfile>> {
    return this.client.get(`${this.basePath}/me`);
  }

  async updateMe(data: UpdateProfileRequest): Promise<ApiResponse<UserProfile>> {
    return this.client.patch(`${this.basePath}/me`, data);
  }

  async changePassword(data: ChangePasswordRequest): Promise<ApiResponse<void>> {
    return this.client.post(`${this.basePath}/me/change-password`, data);
  }

  async uploadAvatar(file: File): Promise<ApiResponse<{ avatarUrl: string }>> {
    return this.client.upload(`${this.basePath}/me/avatar`, file);
  }

  async deleteAccount(): Promise<ApiResponse<void>> {
    return this.client.delete(`${this.basePath}/me`);
  }

  // Addresses
  async getAddresses(): Promise<ApiResponse<Address[]>> {
    return this.client.get(`${this.basePath}/me/addresses`);
  }

  async addAddress(address: Omit<Address, "id">): Promise<ApiResponse<Address>> {
    return this.client.post(`${this.basePath}/me/addresses`, address);
  }

  async updateAddress(id: string, address: Partial<Address>): Promise<ApiResponse<Address>> {
    return this.client.patch(`${this.basePath}/me/addresses/${id}`, address);
  }

  async deleteAddress(id: string): Promise<ApiResponse<void>> {
    return this.client.delete(`${this.basePath}/me/addresses/${id}`);
  }

  // Payment methods
  async getPaymentMethods(): Promise<ApiResponse<PaymentMethod[]>> {
    return this.client.get(`${this.basePath}/me/payment-methods`);
  }

  async addPaymentMethod(data: unknown): Promise<ApiResponse<PaymentMethod>> {
    return this.client.post(`${this.basePath}/me/payment-methods`, data);
  }

  async deletePaymentMethod(id: string): Promise<ApiResponse<void>> {
    return this.client.delete(`${this.basePath}/me/payment-methods/${id}`);
  }

  async setDefaultPaymentMethod(id: string): Promise<ApiResponse<void>> {
    return this.client.post(`${this.basePath}/me/payment-methods/${id}/default`);
  }

  // Admin endpoints
  async getUsers(filters?: UserFilters): Promise<PaginatedResponse<User>> {
    return this.client.get(this.basePath, { searchParams: filters as any });
  }

  async getUser(id: string): Promise<ApiResponse<UserProfile>> {
    return this.client.get(`${this.basePath}/${id}`);
  }

  async updateUser(id: string, data: UpdateProfileRequest): Promise<ApiResponse<UserProfile>> {
    return this.client.patch(`${this.basePath}/${id}`, data);
  }

  async updateUserStatus(id: string, status: UserStatus): Promise<ApiResponse<User>> {
    return this.client.patch(`${this.basePath}/${id}/status`, { status });
  }

  async deleteUser(id: string): Promise<ApiResponse<void>> {
    return this.client.delete(`${this.basePath}/${id}`);
  }
}

// Export singleton instance
let userServiceApi: UserServiceApi | null = null;

export function getUserServiceApi(): UserServiceApi {
  if (!userServiceApi) {
    userServiceApi = new UserServiceApi();
  }
  return userServiceApi;
}
