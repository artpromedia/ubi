/**
 * App Providers
 *
 * Combines all providers in the correct order.
 */

"use client";

import { type ReactNode, Suspense } from "react";

import { AnalyticsProvider } from "./analytics-provider";
import { QueryProvider } from "./query-provider";
import { ThemeProvider } from "./theme-provider";

interface ProvidersProps {
  children: ReactNode;
}

export const Providers = ({ children }: ProvidersProps) => {
  return (
    <QueryProvider>
      <ThemeProvider>
        <Suspense fallback={null}>
          <AnalyticsProvider>{children}</AnalyticsProvider>
        </Suspense>
      </ThemeProvider>
    </QueryProvider>
  );
};

export { analytics, AnalyticsProvider } from "./analytics-provider";
export { QueryProvider } from "./query-provider";
export { ThemeProvider, useTheme } from "./theme-provider";
