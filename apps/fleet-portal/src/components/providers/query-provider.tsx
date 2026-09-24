"use client";

/**
 * TanStack Query provider for the fleet portal. One browser-side client is
 * reused across renders; the server makes a fresh client per request. Reads
 * retry twice; mutations never retry on their own (a retry is the user's
 * "Try again", which re-sends the same idempotency key).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

const makeQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: true,
        retry: (count, error) =>
          count < 2 &&
          !(
            typeof error === "object" &&
            error !== null &&
            "status" in error &&
            typeof error.status === "number" &&
            error.status >= 400 &&
            error.status < 500
          ),
      },
      mutations: { retry: 0 },
    },
  });

let browserQueryClient: QueryClient | undefined;

const getQueryClient = (): QueryClient => {
  if (typeof window === "undefined") {
    return makeQueryClient();
  }
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
};

export const QueryProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  // eslint-disable-next-line react/hook-use-state -- created once per mount, no setter needed
  const [queryClient] = useState(getQueryClient);
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};
