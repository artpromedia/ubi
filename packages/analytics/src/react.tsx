/**
 * React Analytics Hooks and Components
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

import type {
  Analytics,
  AnalyticsConfig,
  UBIEventName,
  UserTraits,
} from "./analytics";

// Analytics context
const AnalyticsContext = createContext<Analytics | null>(null);

// Provider component
interface AnalyticsProviderProps {
  analytics: Analytics;
  children: ReactNode;
}

export function AnalyticsProvider({
  analytics,
  children,
}: AnalyticsProviderProps): ReactNode {
  return (
    <AnalyticsContext.Provider value={analytics}>
      {children}
    </AnalyticsContext.Provider>
  );
}

// Hook to access analytics
export function useAnalytics(): Analytics {
  const analytics = useContext(AnalyticsContext);
  if (!analytics) {
    throw new Error("useAnalytics must be used within an AnalyticsProvider");
  }
  return analytics;
}

// Hook for tracking events
export function useTrack() {
  const analytics = useAnalytics();

  return useCallback(
    (
      eventName: UBIEventName | string,
      properties?: Record<string, unknown>,
    ) => {
      void analytics.track(eventName, properties);
    },
    [analytics],
  );
}

// Hook for identifying users
export function useIdentify() {
  const analytics = useAnalytics();

  return useCallback(
    (userId: string, traits?: UserTraits) => {
      void analytics.identify(userId, traits);
    },
    [analytics],
  );
}

// Hook for page tracking
export function usePage() {
  const analytics = useAnalytics();

  return useCallback(
    (path: string, properties?: Record<string, unknown>) => {
      void analytics.page(path, properties);
    },
    [analytics],
  );
}

// Hook to track page views automatically
export function usePageView(
  path: string,
  properties?: Record<string, unknown>,
  dependencies: unknown[] = [],
) {
  const analytics = useAnalytics();

  useEffect(() => {
    void analytics.page(path, properties);
  }, [path, analytics, ...dependencies]);
}

// Hook to track events on mount
export function useTrackOnMount(
  eventName: UBIEventName | string,
  properties?: Record<string, unknown>,
  dependencies: unknown[] = [],
) {
  const track = useTrack();

  useEffect(() => {
    track(eventName, properties);
  }, [eventName, track, ...dependencies]);
}

// Hook for timing events
export function useTrackTiming() {
  const track = useTrack();

  return useCallback(
    (
      eventName: UBIEventName | string,
      startTime: number,
      properties?: Record<string, unknown>,
    ) => {
      const duration = Date.now() - startTime;
      track(eventName, { ...properties, duration_ms: duration });
    },
    [track],
  );
}

// Hook for tracking form events
export function useTrackForm(formName: string) {
  const track = useTrack();

  const trackStart = useCallback(() => {
    track("form_started", { form_name: formName });
  }, [track, formName]);

  const trackSubmit = useCallback(
    (success: boolean, error?: string) => {
      track(success ? "form_submitted" : "form_error", {
        form_name: formName,
        error,
      });
    },
    [track, formName],
  );

  const trackFieldChange = useCallback(
    (fieldName: string) => {
      track("form_field_changed", {
        form_name: formName,
        field_name: fieldName,
      });
    },
    [track, formName],
  );

  const trackAbandon = useCallback(() => {
    track("form_abandoned", { form_name: formName });
  }, [track, formName]);

  return {
    trackStart,
    trackSubmit,
    trackFieldChange,
    trackAbandon,
  };
}

// Hook for tracking button clicks
export function useTrackClick(
  eventName: UBIEventName | string,
  properties?: Record<string, unknown>,
) {
  const track = useTrack();

  return useCallback(() => {
    track(eventName, properties);
  }, [track, eventName, properties]);
}

// Higher-order component for tracking page views
export function withPageTracking<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  pageName: string,
  properties?: Record<string, unknown>,
) {
  return function PageTrackedComponent(props: P) {
    usePageView(pageName, properties);
    return <WrappedComponent {...props} />;
  };
}

export { type AnalyticsConfig, type UBIEventName, type UserTraits };
