/**
 * UBI API Client Configuration
 *
 * Configuration for the API client including base URLs,
 * authentication, and request/response interceptors.
 */

import type { Options } from "ky";

export interface ApiConfig {
  /** Base URL for the API Gateway */
  baseUrl: string;
  /** API version prefix */
  version?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Function to get the current auth token */
  getToken?: () => Promise<string | null> | string | null;
  /** Function to refresh the auth token */
  refreshToken?: () => Promise<string | null>;
  /** Custom headers to include in all requests */
  headers?: Record<string, string>;
  /** Enable request/response logging */
  debug?: boolean;
  /** Retry configuration */
  retry?: {
    limit?: number;
    methods?: string[];
    statusCodes?: number[];
  };
  /** Called when auth fails (e.g., redirect to login) */
  onAuthError?: () => void;
  /** Called on any request error */
  onError?: (error: ApiError) => void;
}

export interface ApiError {
  status: number;
  statusText: string;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

export const defaultConfig: Partial<ApiConfig> = {
  version: "v1",
  timeout: 30000,
  retry: {
    limit: 2,
    methods: ["GET", "HEAD", "OPTIONS"],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
};

export function createKyOptions(config: ApiConfig): Options {
  const fullBaseUrl = config.version
    ? `${config.baseUrl}/api/${config.version}`
    : config.baseUrl;

  return {
    prefixUrl: fullBaseUrl,
    timeout: config.timeout ?? defaultConfig.timeout,
    retry: config.retry ?? defaultConfig.retry,
    hooks: {
      beforeRequest: [
        async (request) => {
          // Add auth token
          if (config.getToken) {
            const token = await config.getToken();
            if (token) {
              request.headers.set("Authorization", `Bearer ${token}`);
            }
          }

          // Add custom headers
          if (config.headers) {
            Object.entries(config.headers).forEach(([key, value]) => {
              request.headers.set(key, value);
            });
          }

          // Debug logging
          if (config.debug) {
            console.log(`[API] ${request.method} ${request.url}`);
          }
        },
      ],
      afterResponse: [
        async (request, _options, response) => {
          // Debug logging
          if (config.debug) {
            console.log(
              `[API] ${response.status} ${request.method} ${request.url}`
            );
          }

          // Handle 401 - try to refresh token
          if (response.status === 401 && config.refreshToken) {
            const newToken = await config.refreshToken();
            if (newToken) {
              // Retry with new token
              request.headers.set("Authorization", `Bearer ${newToken}`);
              return ky(request);
            } else {
              config.onAuthError?.();
            }
          }

          return response;
        },
      ],
      beforeError: [
        async (error) => {
          const { response } = error;

          if (response) {
            try {
              const body: {
                message?: string;
                code?: string;
                details?: Record<string, unknown>;
              } = await response.json();
              const apiError: ApiError = {
                status: response.status,
                statusText: response.statusText,
                message: body.message ?? response.statusText,
                code: body.code,
                details: body.details,
                requestId: response.headers.get("x-request-id") ?? undefined,
              };

              // Call error handler
              config.onError?.(apiError);

              // Attach to error
              (error as any).apiError = apiError;
            } catch {
              // Response wasn't JSON
              const apiError: ApiError = {
                status: response.status,
                statusText: response.statusText,
                message: response.statusText,
                requestId: response.headers.get("x-request-id") ?? undefined,
              };
              config.onError?.(apiError);
              (error as any).apiError = apiError;
            }
          }

          return error;
        },
      ],
    },
  };
}

// Import ky for the afterResponse hook
import ky from "ky";
