/**
 * API Client for UBI Web App
 *
 * Centralized HTTP client with authentication handling,
 * error management, and request/response interceptors.
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface ApiError {
  code: string;
  message: string;
  status: number;
}

// Auth response types
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
  };
  tokens: AuthTokens;
}

export interface SignUpResponse {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
  };
  tokens: AuthTokens;
}

class ApiClient {
  private readonly baseUrl: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private onTokenRefresh?: (accessToken: string, refreshToken: string) => void;
  private onAuthError?: () => void;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  setRefreshToken(token: string | null) {
    this.refreshToken = token;
  }

  setAuthCallbacks(
    onTokenRefresh: (accessToken: string, refreshToken: string) => void,
    onAuthError: () => void,
  ) {
    this.onTokenRefresh = onTokenRefresh;
    this.onAuthError = onAuthError;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retry = true,
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (this.accessToken) {
      (headers as Record<string, string>)["Authorization"] =
        `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Handle token refresh on 401
      if (response.status === 401 && retry && this.refreshToken) {
        const refreshed = await this.refreshTokens();
        if (refreshed) {
          return this.request<T>(endpoint, options, false);
        }
        this.onAuthError?.();
        return {
          success: false,
          error: {
            code: "AUTH_EXPIRED",
            message: "Session expired. Please login again.",
          },
        };
      }

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: data.error?.code || "UNKNOWN_ERROR",
            message: data.error?.message || "An error occurred",
            details: data.error?.details,
          },
        };
      }

      return {
        success: true,
        data: data.data || data,
        meta: data.meta,
      };
    } catch (error) {
      console.error("API request failed:", error);
      return {
        success: false,
        error: {
          code: "NETWORK_ERROR",
          message: "Unable to connect to server",
        },
      };
    }
  }

  private async refreshTokens(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken;
      this.onTokenRefresh?.(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  async get<T>(endpoint: string, params?: Record<string, string>) {
    const queryString = params
      ? "?" + new URLSearchParams(params).toString()
      : "";
    return this.request<T>(endpoint + queryString, { method: "GET" });
  }

  async post<T>(endpoint: string, body?: unknown) {
    return this.request<T>(endpoint, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(endpoint: string, body?: unknown) {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(endpoint: string, body?: unknown) {
    return this.request<T>(endpoint, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: "DELETE" });
  }

  // Auth-specific methods
  async login(
    emailOrPhone: string,
    password: string,
  ): Promise<ApiResponse<LoginResponse>> {
    const response = await this.post<LoginResponse>("/auth/login", {
      emailOrPhone,
      password,
    });

    if (response.success && response.data) {
      this.accessToken = response.data.tokens.accessToken;
      this.refreshToken = response.data.tokens.refreshToken;
    }

    return response;
  }

  async signUp(data: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    password: string;
  }): Promise<ApiResponse<SignUpResponse>> {
    const response = await this.post<SignUpResponse>("/auth/register", data);

    if (response.success && response.data) {
      this.accessToken = response.data.tokens.accessToken;
      this.refreshToken = response.data.tokens.refreshToken;
    }

    return response;
  }

  async logout(): Promise<void> {
    if (this.accessToken) {
      await this.post("/auth/logout", {}).catch(() => {
        // Ignore logout errors
      });
    }
    this.accessToken = null;
    this.refreshToken = null;
  }

  async verifyOtp(
    phone: string,
    otp: string,
  ): Promise<ApiResponse<{ verified: boolean }>> {
    return this.post<{ verified: boolean }>("/auth/verify-otp", { phone, otp });
  }

  async resendOtp(phone: string): Promise<ApiResponse<{ sent: boolean }>> {
    return this.post<{ sent: boolean }>("/auth/resend-otp", { phone });
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
export default apiClient;
