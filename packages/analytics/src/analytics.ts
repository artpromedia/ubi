/**
 * UBI Analytics
 *
 * Provider-agnostic analytics tracking abstraction.
 * Supports multiple analytics providers through adapters.
 */

// Event types
export type AnalyticsEventProperties = Record<string, unknown>;

export interface BaseEvent {
  name: string;
  timestamp?: number;
  properties?: AnalyticsEventProperties;
}

export interface PageViewEvent extends BaseEvent {
  name: "page_view";
  properties: {
    path: string;
    title?: string;
    referrer?: string;
    search?: string;
  };
}

export interface IdentifyEvent {
  userId: string;
  traits?: UserTraits;
}

export interface UserTraits {
  email?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  createdAt?: string;
  plan?: string;
  role?: string;
  [key: string]: unknown;
}

// UBI-specific event types
export type UBIEventName =
  // Auth events
  | "sign_up_started"
  | "sign_up_completed"
  | "sign_in"
  | "sign_out"
  | "password_reset_requested"
  // Ride events (Move)
  | "ride_search_started"
  | "ride_estimate_viewed"
  | "ride_requested"
  | "ride_cancelled"
  | "ride_started"
  | "ride_completed"
  | "ride_rated"
  // Food events (Bites)
  | "restaurant_viewed"
  | "menu_item_viewed"
  | "cart_item_added"
  | "cart_item_removed"
  | "checkout_started"
  | "food_order_placed"
  | "food_order_cancelled"
  | "food_order_delivered"
  | "food_order_rated"
  // Delivery events (Send)
  | "delivery_quote_requested"
  | "delivery_created"
  | "delivery_cancelled"
  | "delivery_picked_up"
  | "delivery_completed"
  // Payment events
  | "payment_method_added"
  | "payment_method_removed"
  | "payment_initiated"
  | "payment_completed"
  | "payment_failed"
  | "wallet_topped_up"
  // Engagement events
  | "notification_received"
  | "notification_clicked"
  | "promo_code_applied"
  | "support_contacted"
  | "feature_used"
  | "error_occurred";

export interface UBIEvent extends BaseEvent {
  name: UBIEventName;
}

// Analytics provider interface
export interface AnalyticsProvider {
  name: string;
  initialize(config: Record<string, unknown>): Promise<void>;
  identify(userId: string, traits?: UserTraits): Promise<void>;
  track(event: BaseEvent): Promise<void>;
  page(event: PageViewEvent): Promise<void>;
  reset(): Promise<void>;
  setUserProperties?(properties: Record<string, unknown>): Promise<void>;
}

// Analytics configuration
export interface AnalyticsConfig {
  providers: AnalyticsProvider[];
  debug?: boolean;
  disabled?: boolean;
  defaultProperties?: Record<string, unknown>;
  onError?: (error: Error, provider: string) => void;
}

// Analytics client
export class Analytics {
  private providers: AnalyticsProvider[] = [];
  private config: AnalyticsConfig;
  private userId: string | null = null;
  private userTraits: UserTraits = {};
  private initialized = false;
  private queue: Array<() => Promise<void>> = [];

  constructor(config: AnalyticsConfig) {
    this.config = config;
    this.providers = config.providers;
  }

  /**
   * Initialize all providers
   */
  async initialize(
    providerConfigs: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    if (this.config.disabled) {
      return;
    }

    const initPromises = this.providers.map(async (provider) => {
      const config = providerConfigs[provider.name];
      if (config) {
        try {
          await provider.initialize(config);
          this.log(`Initialized provider: ${provider.name}`);
        } catch (error) {
          this.handleError(error as Error, provider.name);
        }
      }
    });

    await Promise.all(initPromises);
    this.initialized = true;

    // Process queued events
    while (this.queue.length > 0) {
      const fn = this.queue.shift();
      if (fn) {
        await fn();
      }
    }
  }

  /**
   * Identify a user
   */
  async identify(userId: string, traits?: UserTraits): Promise<void> {
    if (this.config.disabled) {
      return;
    }

    this.userId = userId;
    this.userTraits = { ...this.userTraits, ...traits };

    const identify = async () => {
      await Promise.all(
        this.providers.map(async (provider) => {
          try {
            await provider.identify(userId, this.userTraits);
            this.log(`Identified user ${userId} in ${provider.name}`);
          } catch (error) {
            this.handleError(error as Error, provider.name);
          }
        }),
      );
    };

    if (!this.initialized) {
      this.queue.push(identify);
    } else {
      await identify();
    }
  }

  /**
   * Track a custom event
   */
  async track(
    eventName: UBIEventName | string,
    properties?: Record<string, unknown>,
  ): Promise<void> {
    if (this.config.disabled) {
      return;
    }

    const event: BaseEvent = {
      name: eventName,
      timestamp: Date.now(),
      properties: {
        ...this.config.defaultProperties,
        ...properties,
      },
    };

    const track = async () => {
      await Promise.all(
        this.providers.map(async (provider) => {
          try {
            await provider.track(event);
            this.log(
              `Tracked ${eventName} in ${provider.name}`,
              event.properties,
            );
          } catch (error) {
            this.handleError(error as Error, provider.name);
          }
        }),
      );
    };

    if (!this.initialized) {
      this.queue.push(track);
    } else {
      await track();
    }
  }

  /**
   * Track a page view
   */
  async page(
    path: string,
    properties?: Omit<PageViewEvent["properties"], "path">,
  ): Promise<void> {
    if (this.config.disabled) {
      return;
    }

    const event: PageViewEvent = {
      name: "page_view",
      timestamp: Date.now(),
      properties: {
        path,
        ...properties,
        ...this.config.defaultProperties,
      } as PageViewEvent["properties"],
    };

    const page = async () => {
      await Promise.all(
        this.providers.map(async (provider) => {
          try {
            await provider.page(event);
            this.log(`Page view ${path} in ${provider.name}`);
          } catch (error) {
            this.handleError(error as Error, provider.name);
          }
        }),
      );
    };

    if (!this.initialized) {
      this.queue.push(page);
    } else {
      await page();
    }
  }

  /**
   * Set user properties
   */
  async setUserProperties(properties: Record<string, unknown>): Promise<void> {
    if (this.config.disabled) {
      return;
    }

    await Promise.all(
      this.providers.map(async (provider) => {
        if (provider.setUserProperties) {
          try {
            await provider.setUserProperties(properties);
          } catch (error) {
            this.handleError(error as Error, provider.name);
          }
        }
      }),
    );
  }

  /**
   * Reset/logout
   */
  async reset(): Promise<void> {
    this.userId = null;
    this.userTraits = {};

    await Promise.all(
      this.providers.map(async (provider) => {
        try {
          await provider.reset();
          this.log(`Reset ${provider.name}`);
        } catch (error) {
          this.handleError(error as Error, provider.name);
        }
      }),
    );
  }

  /**
   * Get current user ID
   */
  getUserId(): string | null {
    return this.userId;
  }

  /**
   * Check if analytics is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  private log(message: string, data?: unknown): void {
    if (this.config.debug) {
      console.log(`[Analytics] ${message}`, data ?? "");
    }
  }

  private handleError(error: Error, provider: string): void {
    if (this.config.onError) {
      this.config.onError(error, provider);
    } else if (this.config.debug) {
      console.error(`[Analytics] Error in ${provider}:`, error);
    }
  }
}

// Singleton instance
let analyticsInstance: Analytics | null = null;

export function createAnalytics(config: AnalyticsConfig): Analytics {
  analyticsInstance = new Analytics(config);
  return analyticsInstance;
}

export function getAnalytics(): Analytics {
  if (!analyticsInstance) {
    throw new Error("Analytics not initialized. Call createAnalytics() first.");
  }
  return analyticsInstance;
}
