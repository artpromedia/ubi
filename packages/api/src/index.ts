/**
 * UBI API Client
 *
 * Type-safe API client for all UBI services.
 *
 * @packageDocumentation
 */

// Core client
export {
  ApiClient,
  createApiClient,
  initializeApiClient,
  getApiClient,
} from "./client";

// Configuration
export {
  type ApiConfig,
  type ApiError,
  defaultConfig,
} from "./config";

// Common types
export * from "./types";

// Service APIs
export * from "./services";
