/**
 * Common types for UBI
 */

/**
 * Geographic coordinate (base type)
 */
export interface GeoCoordinate {
  latitude: number;
  longitude: number;
}

/**
 * Location with address details (base type)
 */
export interface GeoLocation extends GeoCoordinate {
  address?: string;
  name?: string;
  placeId?: string;
}

/**
 * User role types
 */
export type UserRole = "RIDER" | "DRIVER" | "RESTAURANT" | "MERCHANT" | "ADMIN";

/**
 * Payment method types
 */
export type PaymentMethodType = "CARD" | "MOBILE_MONEY" | "WALLET" | "CASH";

/**
 * Common API response wrapper
 */
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

/**
 * Pagination parameters
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/**
 * Date range filter
 */
export interface DateRange {
  from: Date | string;
  to: Date | string;
}

/**
 * Status type for various entities
 */
export type Status =
  | "ACTIVE"
  | "INACTIVE"
  | "PENDING"
  | "SUSPENDED"
  | "DELETED";

/**
 * Vehicle types
 */
export type VehicleType = "CAR" | "MOTORCYCLE" | "TUKTUK" | "TRUCK" | "VAN";

/**
 * Rating with optional comment
 */
export interface Rating {
  score: number;
  comment?: string;
  createdAt: Date | string;
}

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Async result type
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;
