/**
 * API Client for UBI Web App
 *
 * Centralized HTTP client targeting the UBI API Gateway (/v1/*) with hardened
 * phone + OTP authentication, refresh rotation, idempotency keys, and cityId
 * support (CC-B00 / DEC-8).
 */

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"
).replace(/\/+$/, "");

const DEVICE_STORAGE_KEY = "ubi.web.deviceId";

function webDeviceId(): string {
  if (typeof window === "undefined") {
    return "web_ssr_device";
  }
  try {
    const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (existing) return existing;
    const created =
      "web_" +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 10);
    window.localStorage.setItem(DEVICE_STORAGE_KEY, created);
    return created;
  } catch {
    return "web_" + Date.now().toString(36);
  }
}

function newIdempotencyKey(): string {
  return (
    "idem_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

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

export interface LaunchedCity {
  id: string;
  name: string;
  country: string;
  region?: string | null;
  timezone?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  mode?: "full" | "limited";
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  role?: string;
  cityId?: string | null;
  homeCityId?: string | null;
}

export interface VerifyOtpResponse {
  user: AuthUser;
  tokens: AuthTokens;
  citySelectionRequired?: boolean;
}

export interface SignUpResponse {
  user: AuthUser;
  expiresInSeconds?: number;
}

class ApiClient {
  private readonly baseUrl: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private onTokenRefresh?: (accessToken: string, refreshToken: string) => void;
  private onAuthError?: () => void;

  constructor(baseUrl: string) {
    // Strip legacy `/api` suffix if set in local .env so `/v1/*` hits the gateway cleanly.
    this.baseUrl = baseUrl.replace(/\/api$/, "").replace(/\/+$/, "");
  }

  private resolveUrl(endpoint: string): string {
    const clean = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    if (this.baseUrl.endsWith("/v1")) {
      return clean.startsWith("/v1/")
        ? `${this.baseUrl}${clean.slice(3)}`
        : `${this.baseUrl}${clean}`;
    }
    return clean.startsWith("/v1/") || clean === "/health"
      ? `${this.baseUrl}${clean}`
      : `${this.baseUrl}/v1${clean}`;
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
    const url = this.resolveUrl(endpoint);
    const method = (options.method || "GET").toUpperCase();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined),
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    if (
      method === "POST" &&
      !headers["Idempotency-Key"] &&
      !headers["idempotency-key"]
    ) {
      headers["Idempotency-Key"] = newIdempotencyKey();
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

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
            message: "Session expired. Please sign in again.",
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
        data: data.data ?? data,
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
      const response = await fetch(this.resolveUrl("/v1/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refreshToken: this.refreshToken,
          deviceId: webDeviceId(),
        }),
      });

      if (!response.ok) return false;

      const raw = await response.json();
      const tokens = raw?.data?.tokens ?? raw?.tokens ?? raw;
      if (!tokens?.accessToken || !tokens?.refreshToken) {
        return false;
      }
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      this.onTokenRefresh?.(tokens.accessToken, tokens.refreshToken);
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
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(endpoint: string, body?: unknown) {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(endpoint: string, body?: unknown) {
    return this.request<T>(endpoint, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: "DELETE" });
  }

  async getLaunchedCities(): Promise<ApiResponse<{ cities: LaunchedCity[] }>> {
    return this.get<{ cities: LaunchedCity[] }>("/v1/auth/cities");
  }

  async requestOtp(
    phone: string,
  ): Promise<ApiResponse<{ expiresInSeconds: number }>> {
    return this.post<{ expiresInSeconds: number }>("/v1/auth/otp", {
      phone,
      purpose: "login",
    });
  }

  async signUp(data: {
    firstName: string;
    lastName: string;
    phone: string;
    cityId: string;
    email?: string;
    country?: string;
  }): Promise<ApiResponse<SignUpResponse>> {
    return this.post<SignUpResponse>("/v1/auth/signup", {
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      cityId: data.cityId,
      ...(data.email ? { email: data.email } : {}),
      ...(data.country ? { country: data.country } : {}),
      role: "RIDER",
    });
  }

  async verifyOtp(
    phone: string,
    code: string,
  ): Promise<ApiResponse<VerifyOtpResponse>> {
    const response = await this.post<VerifyOtpResponse>("/v1/auth/verify", {
      phone,
      code,
      deviceId: webDeviceId(),
      platform: "web",
    });
    if (response.success && response.data) {
      this.accessToken = response.data.tokens.accessToken;
      this.refreshToken = response.data.tokens.refreshToken;
    }
    return response;
  }

  async selectCity(
    cityId: string,
  ): Promise<ApiResponse<{ cityId: string; tokens: AuthTokens }>> {
    const response = await this.post<{ cityId: string; tokens: AuthTokens }>(
      "/v1/auth/city",
      { cityId },
    );
    if (response.success && response.data) {
      this.accessToken = response.data.tokens.accessToken;
      this.refreshToken = response.data.tokens.refreshToken;
      this.onTokenRefresh?.(
        response.data.tokens.accessToken,
        response.data.tokens.refreshToken,
      );
    }
    return response;
  }

  async resendOtp(
    phone: string,
  ): Promise<ApiResponse<{ expiresInSeconds: number }>> {
    return this.requestOtp(phone);
  }

  async logout(): Promise<void> {
    if (this.accessToken) {
      await this.post("/v1/auth/logout", {
        ...(this.refreshToken ? { refreshToken: this.refreshToken } : {}),
      }).catch(() => {
        // Ignore logout errors; clear local session regardless.
      });
    }
    this.accessToken = null;
    this.refreshToken = null;
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
export default apiClient;
