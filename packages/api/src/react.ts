/**
 * React Query Hooks for UBI API
 *
 * TanStack Query integration for data fetching.
 */

import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  type UseInfiniteQueryOptions,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { PaginatedResponse, PaginationParams } from "./types";

// Query key factory
export const queryKeys = {
  // User
  user: {
    all: ["users"] as const,
    me: () => [...queryKeys.user.all, "me"] as const,
    detail: (id: string) => [...queryKeys.user.all, id] as const,
    list: (filters?: Record<string, unknown>) =>
      [...queryKeys.user.all, "list", filters] as const,
    addresses: () => [...queryKeys.user.me(), "addresses"] as const,
    paymentMethods: () => [...queryKeys.user.me(), "payment-methods"] as const,
  },

  // Rides
  ride: {
    all: ["rides"] as const,
    detail: (id: string) => [...queryKeys.ride.all, id] as const,
    active: () => [...queryKeys.ride.all, "active"] as const,
    history: (filters?: Record<string, unknown>) =>
      [...queryKeys.ride.all, "history", filters] as const,
    estimates: (params: Record<string, unknown>) =>
      [...queryKeys.ride.all, "estimates", params] as const,
    nearbyDrivers: (lat: number, lng: number) =>
      [...queryKeys.ride.all, "nearby", lat, lng] as const,
  },

  // Food
  food: {
    all: ["food"] as const,
    restaurants: {
      all: () => [...queryKeys.food.all, "restaurants"] as const,
      detail: (id: string) =>
        [...queryKeys.food.restaurants.all(), id] as const,
      menu: (id: string) =>
        [...queryKeys.food.restaurants.detail(id), "menu"] as const,
      list: (filters?: Record<string, unknown>) =>
        [...queryKeys.food.restaurants.all(), "list", filters] as const,
      featured: () =>
        [...queryKeys.food.restaurants.all(), "featured"] as const,
      search: (query: string) =>
        [...queryKeys.food.restaurants.all(), "search", query] as const,
    },
    orders: {
      all: () => [...queryKeys.food.all, "orders"] as const,
      detail: (id: string) => [...queryKeys.food.orders.all(), id] as const,
      active: () => [...queryKeys.food.orders.all(), "active"] as const,
      history: (filters?: Record<string, unknown>) =>
        [...queryKeys.food.orders.all(), "history", filters] as const,
    },
    favorites: () => [...queryKeys.food.all, "favorites"] as const,
    cuisineTypes: () => [...queryKeys.food.all, "cuisine-types"] as const,
  },

  // Deliveries
  delivery: {
    all: ["deliveries"] as const,
    detail: (id: string) => [...queryKeys.delivery.all, id] as const,
    track: (trackingNumber: string) =>
      [...queryKeys.delivery.all, "track", trackingNumber] as const,
    active: () => [...queryKeys.delivery.all, "active"] as const,
    history: (filters?: Record<string, unknown>) =>
      [...queryKeys.delivery.all, "history", filters] as const,
    estimates: (params: Record<string, unknown>) =>
      [...queryKeys.delivery.all, "estimates", params] as const,
  },

  // Payments
  payment: {
    all: ["payments"] as const,
    detail: (id: string) => [...queryKeys.payment.all, id] as const,
    history: (filters?: Record<string, unknown>) =>
      [...queryKeys.payment.all, "history", filters] as const,
    methods: () => [...queryKeys.payment.all, "methods"] as const,
    wallet: () => [...queryKeys.payment.all, "wallet"] as const,
    walletTransactions: (filters?: Record<string, unknown>) =>
      [...queryKeys.payment.wallet(), "transactions", filters] as const,
    providers: () => [...queryKeys.payment.all, "providers"] as const,
  },
};

// Utility types
type QueryKeyFactory = typeof queryKeys;

// Infinite query helper for paginated data
export function createInfiniteQueryOptions<TData>(
  queryFn: (params: PaginationParams) => Promise<PaginatedResponse<TData>>,
  baseKey: readonly unknown[],
  initialFilters?: Omit<PaginationParams, "page" | "cursor">
) {
  return {
    queryKey: [...baseKey, initialFilters],
    queryFn: ({ pageParam = 1 }: { pageParam: number }) =>
      queryFn({ ...initialFilters, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage: PaginatedResponse<TData>) =>
      lastPage.meta.hasNextPage ? lastPage.meta.page + 1 : undefined,
    getPreviousPageParam: (firstPage: PaginatedResponse<TData>) =>
      firstPage.meta.hasPreviousPage ? firstPage.meta.page - 1 : undefined,
  };
}

// Query client factory with default options
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes
        gcTime: 1000 * 60 * 30, // 30 minutes (formerly cacheTime)
        retry: 3,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 1,
      },
    },
  });
}

// Optimistic update helpers
export function createOptimisticUpdate<TData, TVariables>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  updateFn: (oldData: TData, variables: TVariables) => TData
) {
  return {
    onMutate: async (variables: TVariables) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot previous value
      const previousData = queryClient.getQueryData<TData>(queryKey);

      // Optimistically update
      if (previousData) {
        queryClient.setQueryData<TData>(
          queryKey,
          updateFn(previousData, variables)
        );
      }

      return { previousData };
    },
    onError: (
      _err: Error,
      _variables: TVariables,
      context: { previousData: TData | undefined } | undefined
    ) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    onSettled: () => {
      // Refetch after mutation
      queryClient.invalidateQueries({ queryKey });
    },
  };
}

// Export hooks and utilities
export {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  type UseInfiniteQueryOptions,
  type UseMutationOptions,
  type UseQueryOptions,
};

export type { QueryKeyFactory };
