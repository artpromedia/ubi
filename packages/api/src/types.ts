/**
 * API Response Types
 *
 * Common response types and pagination helpers.
 */

// Pagination
export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    nextCursor?: string;
    previousCursor?: string;
  };
}

export interface CursorPaginatedResponse<T> {
  data: T[];
  meta: {
    hasMore: boolean;
    nextCursor?: string;
    previousCursor?: string;
    total?: number;
  };
}

// API Response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  requestId?: string;
}

// Error response
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
  requestId?: string;
}

// Common entities
export interface Timestamps {
  createdAt: string;
  updatedAt: string;
}

export interface SoftDelete {
  deletedAt?: string;
}

// Location types
export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Address {
  street?: string;
  city: string;
  state?: string;
  country: string;
  postalCode?: string;
  formattedAddress: string;
  coordinates: Coordinates;
}

// Money type
export interface Money {
  amount: number;
  currency: string;
}

// Date range
export interface DateRange {
  from: string;
  to: string;
}

// Filter operators
export type FilterOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "nin"
  | "contains"
  | "startsWith"
  | "endsWith";

export interface Filter {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

// Utility function to build query params
export function buildQueryParams(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((v) => searchParams.append(key, String(v)));
    } else if (typeof value === "object") {
      searchParams.append(key, JSON.stringify(value));
    } else {
      searchParams.append(key, String(value));
    }
  });

  return searchParams.toString();
}

// Utility to parse paginated response
export function parsePaginatedResponse<T>(response: PaginatedResponse<T>): {
  items: T[];
  pagination: PaginatedResponse<T>["meta"];
} {
  return {
    items: response.data,
    pagination: response.meta,
  };
}
