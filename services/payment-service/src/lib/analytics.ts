/**
 * Analytics Service for Payment Service
 *
 * Provides server-side analytics tracking for driver experience events.
 * Integrates with PostHog, Segment, or custom analytics backend.
 */

import { logger } from "./logger.js";

// Configuration
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://app.posthog.com";
const SEGMENT_WRITE_KEY = process.env.SEGMENT_WRITE_KEY;
const ANALYTICS_ENABLED = process.env.ANALYTICS_ENABLED !== "false";

// Types
export interface AnalyticsEvent {
  event: string;
  userId?: string;
  anonymousId?: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
  context?: Record<string, unknown>;
}

export interface UserTraits {
  email?: string;
  phone?: string;
  name?: string;
  role?: string;
  plan?: string;
  createdAt?: Date;
  [key: string]: unknown;
}

export interface IAnalyticsService {
  track(
    event: string,
    properties?: Record<string, unknown>,
    userId?: string,
  ): Promise<void>;
  identify(userId: string, traits: UserTraits): Promise<void>;
  group(
    userId: string,
    groupId: string,
    traits?: Record<string, unknown>,
  ): Promise<void>;
}

/**
 * Analytics Service Implementation
 *
 * Sends events to configured analytics providers.
 * Falls back to logging if no providers are configured.
 */
class AnalyticsServiceImpl implements IAnalyticsService {
  private buffer: AnalyticsEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly batchSize = 100;
  private readonly flushIntervalMs = 10000; // 10 seconds

  constructor() {
    // Start batch processing
    if (ANALYTICS_ENABLED) {
      this.startFlushInterval();
    }
  }

  /**
   * Track an analytics event
   */
  async track(
    event: string,
    properties?: Record<string, unknown>,
    userId?: string,
  ): Promise<void> {
    if (!ANALYTICS_ENABLED) {
      logger.debug({ event, properties }, "Analytics disabled, skipping track");
      return;
    }

    const analyticsEvent: AnalyticsEvent = {
      event,
      userId,
      properties: {
        ...properties,
        service: "payment-service",
        environment: process.env.NODE_ENV,
      },
      timestamp: new Date(),
      context: {
        library: {
          name: "@ubi/payment-service",
          version: process.env.npm_package_version || "1.0.0",
        },
      },
    };

    this.buffer.push(analyticsEvent);

    // Flush if buffer is full
    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }

    logger.debug({ event, userId }, "Analytics event tracked");
  }

  /**
   * Identify a user with traits
   */
  async identify(userId: string, traits: UserTraits): Promise<void> {
    if (!ANALYTICS_ENABLED) {
      return;
    }

    try {
      if (POSTHOG_API_KEY) {
        await this.sendToPostHog({
          type: "identify",
          distinct_id: userId,
          properties: {
            $set: traits,
          },
        });
      }

      if (SEGMENT_WRITE_KEY) {
        await this.sendToSegment({
          type: "identify",
          userId,
          traits,
        });
      }

      logger.debug({ userId }, "User identified");
    } catch (error) {
      logger.error({ error, userId }, "Failed to identify user");
    }
  }

  /**
   * Associate a user with a group (e.g., fleet, company)
   */
  async group(
    userId: string,
    groupId: string,
    traits?: Record<string, unknown>,
  ): Promise<void> {
    if (!ANALYTICS_ENABLED) {
      return;
    }

    try {
      if (POSTHOG_API_KEY) {
        await this.sendToPostHog({
          type: "group",
          distinct_id: userId,
          properties: {
            $group_type: "company",
            $group_key: groupId,
            $group_set: traits,
          },
        });
      }

      if (SEGMENT_WRITE_KEY) {
        await this.sendToSegment({
          type: "group",
          userId,
          groupId,
          traits,
        });
      }

      logger.debug({ userId, groupId }, "User grouped");
    } catch (error) {
      logger.error({ error, userId, groupId }, "Failed to group user");
    }
  }

  /**
   * Flush buffered events to analytics providers
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const events = [...this.buffer];
    this.buffer = [];

    try {
      const promises: Promise<void>[] = [];

      if (POSTHOG_API_KEY) {
        promises.push(this.flushToPostHog(events));
      }

      if (SEGMENT_WRITE_KEY) {
        promises.push(this.flushToSegment(events));
      }

      // If no providers configured, just log
      if (promises.length === 0) {
        logger.debug(
          { count: events.length },
          "Analytics events (no provider configured)",
        );
        return;
      }

      await Promise.allSettled(promises);
      logger.debug({ count: events.length }, "Analytics events flushed");
    } catch (error) {
      logger.error(
        { error, count: events.length },
        "Failed to flush analytics events",
      );
      // Re-add events to buffer for retry (with limit)
      if (this.buffer.length < this.batchSize * 2) {
        this.buffer.unshift(...events);
      }
    }
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch((error) => {
        logger.error({ error }, "Analytics flush interval error");
      });
    }, this.flushIntervalMs);
  }

  /**
   * Send events to PostHog
   */
  private async flushToPostHog(events: AnalyticsEvent[]): Promise<void> {
    const batch = events.map((e) => ({
      type: "capture",
      event: e.event,
      distinct_id: e.userId || "anonymous",
      properties: {
        ...e.properties,
        $lib: "payment-service",
      },
      timestamp: e.timestamp?.toISOString(),
    }));

    const response = await fetch(`${POSTHOG_HOST}/batch/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: POSTHOG_API_KEY,
        batch,
      }),
    });

    if (!response.ok) {
      throw new Error(`PostHog batch failed: ${response.status}`);
    }
  }

  private async sendToPostHog(payload: Record<string, unknown>): Promise<void> {
    const response = await fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: POSTHOG_API_KEY,
        ...payload,
      }),
    });

    if (!response.ok) {
      throw new Error(`PostHog capture failed: ${response.status}`);
    }
  }

  /**
   * Send events to Segment
   */
  private async flushToSegment(events: AnalyticsEvent[]): Promise<void> {
    const batch = events.map((e) => ({
      type: "track",
      event: e.event,
      userId: e.userId,
      anonymousId: e.anonymousId || (e.userId ? undefined : "server"),
      properties: e.properties,
      timestamp: e.timestamp?.toISOString(),
      context: e.context,
    }));

    const response = await fetch("https://api.segment.io/v1/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${SEGMENT_WRITE_KEY}:`).toString("base64")}`,
      },
      body: JSON.stringify({ batch }),
    });

    if (!response.ok) {
      throw new Error(`Segment batch failed: ${response.status}`);
    }
  }

  private async sendToSegment(payload: Record<string, unknown>): Promise<void> {
    const response = await fetch(`https://api.segment.io/v1/${payload.type}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${SEGMENT_WRITE_KEY}:`).toString("base64")}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Segment ${payload.type} failed: ${response.status}`);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
    logger.info("Analytics service shut down");
  }
}

// Singleton instance
export const analyticsService = new AnalyticsServiceImpl();

// Export interface adapter for driver services
export const analyticsAdapter: IAnalyticsService = {
  track: async (event, properties, userId) =>
    analyticsService.track(event, properties, userId),
  identify: async (userId, traits) => analyticsService.identify(userId, traits),
  group: async (userId, groupId, traits) =>
    analyticsService.group(userId, groupId, traits),
};

export default analyticsService;
