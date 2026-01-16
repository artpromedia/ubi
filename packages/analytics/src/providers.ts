/**
 * Analytics Providers
 *
 * Built-in adapters for common analytics services.
 */

import type {
  AnalyticsProvider,
  BaseEvent,
  PageViewEvent,
  UserTraits,
} from "./analytics";

// Re-export AnalyticsProvider type for convenience
export type { AnalyticsProvider };

// Provider types
export type ProviderType =
  | "console"
  | "ga4"
  | "mixpanel"
  | "amplitude"
  | "posthog"
  | "segment";

export interface ProviderConfig {
  type: ProviderType;
  // GA4
  measurementId?: string;
  // Mixpanel
  token?: string;
  // Amplitude
  apiKey?: string;
  // PostHog
  host?: string;
  // Segment
  writeKey?: string;
  // Common options
  options?: Record<string, unknown>;
}

// Console provider (for development/debugging)
export class ConsoleProvider implements AnalyticsProvider {
  name = "console";
  private prefix = "[Analytics]";

  async initialize(): Promise<void> {
    console.log(`${this.prefix} Console provider initialized`);
  }

  async identify(userId: string, traits?: UserTraits): Promise<void> {
    console.log(`${this.prefix} Identify:`, { userId, traits });
  }

  async track(event: BaseEvent): Promise<void> {
    console.log(`${this.prefix} Track:`, event.name, event.properties);
  }

  async page(event: PageViewEvent): Promise<void> {
    console.log(
      `${this.prefix} Page:`,
      event.properties.path,
      event.properties
    );
  }

  async reset(): Promise<void> {
    console.log(`${this.prefix} Reset`);
  }
}

// Google Analytics 4 provider
export class GoogleAnalytics4Provider implements AnalyticsProvider {
  name = "google_analytics_4";

  async initialize(config: { measurementId: string }): Promise<void> {
    if (typeof window === "undefined") return;

    // Load gtag script
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${config.measurementId}`;
    document.head.appendChild(script);

    // Initialize gtag
    (window as any).dataLayer = (window as any).dataLayer || [];
    function gtag(...args: unknown[]) {
      (window as any).dataLayer.push(args);
    }
    (window as any).gtag = gtag;
    gtag("js", new Date());
    gtag("config", config.measurementId);
  }

  async identify(userId: string, traits?: UserTraits): Promise<void> {
    if (typeof window === "undefined" || !(window as any).gtag) return;

    (window as any).gtag("set", { user_id: userId });
    if (traits) {
      (window as any).gtag("set", "user_properties", traits);
    }
  }

  async track(event: BaseEvent): Promise<void> {
    if (typeof window === "undefined" || !(window as any).gtag) return;

    (window as any).gtag("event", event.name, event.properties);
  }

  async page(event: PageViewEvent): Promise<void> {
    if (typeof window === "undefined" || !(window as any).gtag) return;

    (window as any).gtag("event", "page_view", {
      page_path: event.properties.path,
      page_title: event.properties.title,
      page_referrer: event.properties.referrer,
    });
  }

  async reset(): Promise<void> {
    if (typeof window === "undefined" || !(window as any).gtag) return;

    (window as any).gtag("set", { user_id: null });
  }

  async setUserProperties(properties: Record<string, unknown>): Promise<void> {
    if (typeof window === "undefined" || !(window as any).gtag) return;

    (window as any).gtag("set", "user_properties", properties);
  }
}

// Mixpanel provider
export class MixpanelProvider implements AnalyticsProvider {
  name = "mixpanel";
  private mixpanel: any = null;

  async initialize(config: {
    token: string;
    options?: Record<string, unknown>;
  }): Promise<void> {
    if (typeof window === "undefined") return;

    // Load Mixpanel library dynamically
    // @ts-ignore - Optional peer dependency
    const { default: mixpanel } = await import("mixpanel-browser");
    mixpanel.init(config.token, {
      track_pageview: false, // We handle this manually
      ...config.options,
    });
    this.mixpanel = mixpanel;
  }

  async identify(userId: string, traits?: UserTraits): Promise<void> {
    if (!this.mixpanel) return;

    this.mixpanel.identify(userId);
    if (traits) {
      this.mixpanel.people.set(traits);
    }
  }

  async track(event: BaseEvent): Promise<void> {
    if (!this.mixpanel) return;

    this.mixpanel.track(event.name, event.properties);
  }

  async page(event: PageViewEvent): Promise<void> {
    if (!this.mixpanel) return;

    this.mixpanel.track("Page View", event.properties);
  }

  async reset(): Promise<void> {
    if (!this.mixpanel) return;

    this.mixpanel.reset();
  }

  async setUserProperties(properties: Record<string, unknown>): Promise<void> {
    if (!this.mixpanel) return;

    this.mixpanel.people.set(properties);
  }
}

// Amplitude provider
export class AmplitudeProvider implements AnalyticsProvider {
  name = "amplitude";
  private amplitude: any = null;

  async initialize(config: {
    apiKey: string;
    options?: Record<string, unknown>;
  }): Promise<void> {
    if (typeof window === "undefined") return;

    // @ts-ignore - Optional peer dependency
    const { init } = await import("@amplitude/analytics-browser");
    // @ts-ignore - Optional peer dependency
    this.amplitude = await import("@amplitude/analytics-browser");
    init(config.apiKey, undefined, config.options);
  }

  async identify(userId: string, traits?: UserTraits): Promise<void> {
    if (!this.amplitude) return;

    this.amplitude.setUserId(userId);
    if (traits) {
      const identify = new this.amplitude.Identify();
      Object.entries(traits).forEach(([key, value]) => {
        identify.set(key, value);
      });
      this.amplitude.identify(identify);
    }
  }

  async track(event: BaseEvent): Promise<void> {
    if (!this.amplitude) return;

    this.amplitude.track(event.name, event.properties);
  }

  async page(event: PageViewEvent): Promise<void> {
    if (!this.amplitude) return;

    this.amplitude.track("Page View", event.properties);
  }

  async reset(): Promise<void> {
    if (!this.amplitude) return;

    this.amplitude.reset();
  }

  async setUserProperties(properties: Record<string, unknown>): Promise<void> {
    if (!this.amplitude) return;

    const identify = new this.amplitude.Identify();
    Object.entries(properties).forEach(([key, value]) => {
      identify.set(key, value);
    });
    this.amplitude.identify(identify);
  }
}

// PostHog provider
export class PostHogProvider implements AnalyticsProvider {
  name = "posthog";
  private posthog: any = null;

  async initialize(config: {
    apiKey: string;
    host?: string;
    options?: Record<string, unknown>;
  }): Promise<void> {
    if (typeof window === "undefined") return;

    const posthogModule = await import("posthog-js");
    const posthog = posthogModule.default;
    (posthog as any).init(config.apiKey, {
      api_host: config.host || "https://app.posthog.com",
      capture_pageview: false, // We handle this manually
      ...config.options,
    });
    this.posthog = posthog;
  }

  async identify(userId: string, traits?: UserTraits): Promise<void> {
    if (!this.posthog) return;

    this.posthog.identify(userId, traits);
  }

  async track(event: BaseEvent): Promise<void> {
    if (!this.posthog) return;

    this.posthog.capture(event.name, event.properties);
  }

  async page(event: PageViewEvent): Promise<void> {
    if (!this.posthog) return;

    this.posthog.capture("$pageview", event.properties);
  }

  async reset(): Promise<void> {
    if (!this.posthog) return;

    this.posthog.reset();
  }

  async setUserProperties(properties: Record<string, unknown>): Promise<void> {
    if (!this.posthog) return;

    this.posthog.setPersonProperties(properties);
  }
}

// Segment provider
export class SegmentProvider implements AnalyticsProvider {
  name = "segment";

  async initialize(config: { writeKey: string }): Promise<void> {
    if (typeof window === "undefined") return;

    // Load Segment analytics.js
    const analytics = ((window as any).analytics =
      (window as any).analytics || []);
    if (!analytics.initialize) {
      if (analytics.invoked) return;
      analytics.invoked = true;
      analytics.methods = [
        "trackSubmit",
        "trackClick",
        "trackLink",
        "trackForm",
        "pageview",
        "identify",
        "reset",
        "group",
        "track",
        "ready",
        "alias",
        "debug",
        "page",
        "once",
        "off",
        "on",
        "addSourceMiddleware",
        "addIntegrationMiddleware",
        "setAnonymousId",
        "addDestinationMiddleware",
      ];
      analytics.factory = function (method: string) {
        return function () {
          const args = Array.prototype.slice.call(arguments);
          args.unshift(method);
          analytics.push(args);
          return analytics;
        };
      };
      for (let i = 0; i < analytics.methods.length; i++) {
        const method = analytics.methods[i];
        analytics[method] = analytics.factory(method);
      }
      analytics.load = function (key: string) {
        const script = document.createElement("script");
        script.type = "text/javascript";
        script.async = true;
        script.src = `https://cdn.segment.com/analytics.js/v1/${key}/analytics.min.js`;
        const first = document.getElementsByTagName("script")[0];
        if (first?.parentNode) {
          first.parentNode.insertBefore(script, first);
        } else {
          document.head.appendChild(script);
        }
      };
      analytics.SNIPPET_VERSION = "4.13.1";
      analytics.load(config.writeKey);
    }
  }

  async identify(userId: string, traits?: UserTraits): Promise<void> {
    if (typeof window === "undefined" || !(window as any).analytics) return;

    (window as any).analytics.identify(userId, traits);
  }

  async track(event: BaseEvent): Promise<void> {
    if (typeof window === "undefined" || !(window as any).analytics) return;

    (window as any).analytics.track(event.name, event.properties);
  }

  async page(event: PageViewEvent): Promise<void> {
    if (typeof window === "undefined" || !(window as any).analytics) return;

    (window as any).analytics.page(event.properties.title, event.properties);
  }

  async reset(): Promise<void> {
    if (typeof window === "undefined" || !(window as any).analytics) return;

    (window as any).analytics.reset();
  }
}

// Create providers factory
export function createProvider(
  type: "console" | "ga4" | "mixpanel" | "amplitude" | "posthog" | "segment"
): AnalyticsProvider {
  switch (type) {
    case "console":
      return new ConsoleProvider();
    case "ga4":
      return new GoogleAnalytics4Provider();
    case "mixpanel":
      return new MixpanelProvider();
    case "amplitude":
      return new AmplitudeProvider();
    case "posthog":
      return new PostHogProvider();
    case "segment":
      return new SegmentProvider();
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}
