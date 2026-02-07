/**
 * API Client for UBI Driver App
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

class ApiClient {
  private readonly baseUrl: string;
  private accessToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
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
}

export const apiClient = new ApiClient(API_BASE_URL);
export default apiClient;
