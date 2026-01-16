/**
 * Analytics Provider
 *
 * Initializes analytics tracking for the UBI web app.
 */

"use client";

import { useAuthStore, useUserStore } from "@/store";
import { createAnalytics } from "@ubi/analytics";
import { AnalyticsProvider as AnalyticsContextProvider } from "@ubi/analytics/react";
import { getDeviceInfo } from "@ubi/utils";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";

// Create analytics instance
const analytics = createAnalytics({
  providers: [
    // Console logging in development
    ...(process.env.NODE_ENV === "development" ? [{ type: "console" as const }] : []),
    // Google Analytics 4
    ...(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
      ? [{ type: "ga4" as const, measurementId: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID }]
      : []),
    // Mixpanel
    ...(process.env.NEXT_PUBLIC_MIXPANEL_TOKEN
      ? [{ type: "mixpanel" as const, token: process.env.NEXT_PUBLIC_MIXPANEL_TOKEN }]
      : []),
    // Amplitude
    ...(process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY
      ? [{ type: "amplitude" as const, apiKey: process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY }]
      : []),
    // PostHog
    ...(process.env.NEXT_PUBLIC_POSTHOG_KEY
      ? [{
          type: "posthog" as const,
          apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
          host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
        }]
      : []),
  ],
  debug: process.env.NODE_ENV === "development",
  defaultProperties: {
    app: "web-app",
    platform: "web",
    ...getDeviceInfo(),
  },
});

// Export analytics instance for direct use
export { analytics };

// Auto page view tracker component
function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const url = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : "");
    analytics.page(url, {
      search: searchParams.toString(),
      title: document.title,
      referrer: document.referrer,
    });
  }, [pathname, searchParams]);

  return null;
}

// User identification syncer
function UserIdentifier() {
  const { isAuthenticated, userId } = useAuthStore();
  const { profile } = useUserStore();

  useEffect(() => {
    if (isAuthenticated && userId) {
      analytics.identify(userId, {
        email: profile?.email,
        firstName: profile?.firstName,
        lastName: profile?.lastName,
        phone: profile?.phone,
        preferredLanguage: profile?.preferredLanguage,
        preferredCurrency: profile?.preferredCurrency,
      });
    } else {
      analytics.reset();
    }
  }, [isAuthenticated, userId, profile]);

  return null;
}

interface AnalyticsProviderProps {
  children: ReactNode;
}

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  return (
    <AnalyticsContextProvider analytics={analytics}>
      <PageViewTracker />
      <UserIdentifier />
      {children}
    </AnalyticsContextProvider>
  );
}
