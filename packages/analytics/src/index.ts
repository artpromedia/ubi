/**
 * UBI Analytics Package
 *
 * A unified analytics abstraction for all UBI web properties.
 * Supports multiple providers including Google Analytics 4, Mixpanel,
 * Amplitude, PostHog, and Segment.
 *
 * @example
 * ```typescript
 * // Initialize analytics
 * import { createAnalytics } from '@ubi/analytics';
 *
 * const analytics = createAnalytics({
 *   providers: [
 *     { type: 'ga4', measurementId: 'G-XXXXXXXXXX' },
 *     { type: 'mixpanel', token: 'your-token' },
 *   ],
 *   debug: process.env.NODE_ENV === 'development',
 * });
 *
 * // Track events
 * analytics.identify('user-123', { name: 'John Doe' });
 * analytics.track('ride_requested', { pickup: 'Lagos', destination: 'Ikeja' });
 * analytics.page('/rides');
 * ```
 *
 * @example React Usage
 * ```tsx
 * import { AnalyticsProvider, useTrack, usePageView } from '@ubi/analytics/react';
 *
 * function App() {
 *   return (
 *     <AnalyticsProvider analytics={analytics}>
 *       <MyApp />
 *     </AnalyticsProvider>
 *   );
 * }
 *
 * function HomePage() {
 *   usePageView('/home');
 *   const track = useTrack();
 *
 *   return (
 *     <button onClick={() => track('cta_clicked', { cta: 'hero' })}>
 *       Get Started
 *     </button>
 *   );
 * }
 * ```
 */

// Core exports
export { Analytics, createAnalytics } from "./analytics";
export type {
  AnalyticsConfig,
  AnalyticsEventProperties,
  UBIEventName,
  UserTraits,
} from "./analytics";

// Provider exports
export {
  AmplitudeProvider,
  ConsoleProvider,
  GoogleAnalytics4Provider,
  MixpanelProvider,
  PostHogProvider,
  SegmentProvider,
  createProvider,
} from "./providers";
export type { ProviderConfig, ProviderType } from "./providers";
