/**
 * UBI API Client
 *
 * Type-safe HTTP client for UBI services.
 */

import ky, { type KyInstance, type Options } from "ky";
import { createKyOptions, defaultConfig, type ApiConfig, type ApiError } from "./config";

export class ApiClient {
  private client: KyInstance;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = { ...defaultConfig, ...config };
    this.client = ky.create(createKyOptions(this.config));
  }

  /**
   * Update the client configuration
   */
  configure(config: Partial<ApiConfig>): void {
    this.config = { ...this.config, ...config };
    this.client = ky.create(createKyOptions(this.config));
  }

  /**
   * GET request
   */
  async get<T>(url: string, options?: Options): Promise<T> {
    return this.client.get(url, options).json<T>();
  }

  /**
   * POST request
   */
  async post<T>(url: string, data?: unknown, options?: Options): Promise<T> {
    return this.client
      .post(url, { json: data, ...options })
      .json<T>();
  }

  /**
   * PUT request
   */
  async put<T>(url: string, data?: unknown, options?: Options): Promise<T> {
    return this.client
      .put(url, { json: data, ...options })
      .json<T>();
  }

  /**
   * PATCH request
   */
  async patch<T>(url: string, data?: unknown, options?: Options): Promise<T> {
    return this.client
      .patch(url, { json: data, ...options })
      .json<T>();
  }

  /**
   * DELETE request
   */
  async delete<T>(url: string, options?: Options): Promise<T> {
    return this.client.delete(url, options).json<T>();
  }

  /**
   * Upload a file
   */
  async upload<T>(
    url: string,
    file: File | Blob,
    fieldName = "file",
    additionalData?: Record<string, string>,
    options?: Options
  ): Promise<T> {
    const formData = new FormData();
    formData.append(fieldName, file);

    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }

    return this.client
      .post(url, { body: formData, ...options })
      .json<T>();
  }

  /**
   * Download a file
   */
  async download(url: string, options?: Options): Promise<Blob> {
    return this.client.get(url, options).blob();
  }

  /**
   * Stream response (for SSE or chunked responses)
   */
  async stream(url: string, options?: Options): Promise<ReadableStream<Uint8Array>> {
    const response = await this.client.get(url, options);
    if (!response.body) {
      throw new Error("Response body is null");
    }
    return response.body;
  }

  /**
   * Get the underlying ky instance for advanced use cases
   */
  getInstance(): KyInstance {
    return this.client;
  }

  /**
   * Get the base URL for constructing WebSocket URLs
   */
  getBaseUrl(): string {
    return this.config.baseUrl;
  }
}

// Singleton instance for convenience
let defaultClient: ApiClient | null = null;

export function createApiClient(config: ApiConfig): ApiClient {
  return new ApiClient(config);
}

export function initializeApiClient(config: ApiConfig): ApiClient {
  defaultClient = new ApiClient(config);
  return defaultClient;
}

export function getApiClient(): ApiClient {
  if (!defaultClient) {
    throw new Error(
      "API client not initialized. Call initializeApiClient() first."
    );
  }
  return defaultClient;
}

export { type ApiConfig, type ApiError };
