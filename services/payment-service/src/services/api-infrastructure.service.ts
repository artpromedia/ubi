/**
 * UBI B2B API Infrastructure Service
 *
 * Comprehensive API management for B2B customers:
 * - API key generation and management
 * - Rate limiting (per-minute, per-day, per-month)
 * - IP whitelisting
 * - Request logging and analytics
 * - Webhook management
 * - Usage tracking
 */

import crypto from "crypto";
import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type {
  ApiEnvironment,
  ApiKey,
  ApiKeyScope,
  ApiRequest,
  PaginatedResponse,
  PaginationParams,
  Webhook,
  WebhookDelivery,
  WebhookEvent,
} from "../types/b2b.types";

// =============================================================================
// INTERFACES
// =============================================================================

interface RateLimitConfig {
  perMinute: number;
  perHour: number;
  perDay: number;
  perMonth: number;
}

interface RateLimitBucket {
  minute: { count: number; resetAt: Date };
  hour: { count: number; resetAt: Date };
  day: { count: number; resetAt: Date };
  month: { count: number; resetAt: Date };
}

interface RateLimitResult {
  allowed: boolean;
  remaining: {
    minute: number;
    hour: number;
    day: number;
    month: number;
  };
  resetAt: {
    minute: Date;
    hour: Date;
    day: Date;
    month: Date;
  };
  retryAfter?: number;
}

interface ApiUsageStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  requestsByEndpoint: Record<string, number>;
  requestsByStatus: Record<number, number>;
  requestsByHour: { hour: string; count: number }[];
}

interface WebhookRetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  starter: { perMinute: 60, perHour: 1000, perDay: 10000, perMonth: 100000 },
  growth: { perMinute: 300, perHour: 5000, perDay: 50000, perMonth: 500000 },
  enterprise: {
    perMinute: 1000,
    perHour: 20000,
    perDay: 200000,
    perMonth: 2000000,
  },
  unlimited: {
    perMinute: 100000,
    perHour: 1000000,
    perDay: 10000000,
    perMonth: 100000000,
  },
};

const WEBHOOK_RETRY_CONFIG: WebhookRetryConfig = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 3600000, // 1 hour
  backoffMultiplier: 2,
};

const WEBHOOK_EVENT_TYPES: WebhookEvent[] = [
  // Delivery events
  "delivery.created",
  "delivery.assigned",
  "delivery.picked_up",
  "delivery.in_transit",
  "delivery.arrived",
  "delivery.delivered",
  "delivery.failed",
  "delivery.cancelled",
  // Ride events
  "ride.requested",
  "ride.confirmed",
  "ride.driver_assigned",
  "ride.started",
  "ride.completed",
  "ride.cancelled",
  // Payment events
  "payment.completed",
  "payment.failed",
  "payment.refunded",
  // Invoice events
  "invoice.created",
  "invoice.paid",
  "invoice.overdue",
  // School transport events
  "student.picked_up",
  "student.dropped_off",
  "route.started",
  "route.completed",
];

// =============================================================================
// API INFRASTRUCTURE SERVICE
// =============================================================================

export class ApiInfrastructureService extends EventEmitter {
  private apiKeys: Map<string, ApiKey> = new Map();
  private apiKeysByHash: Map<string, string> = new Map(); // hash -> keyId
  private rateLimitBuckets: Map<string, RateLimitBucket> = new Map();
  private apiRequests: Map<string, ApiRequest[]> = new Map(); // organizationId -> requests
  private webhooks: Map<string, Webhook> = new Map();
  private webhookDeliveries: Map<string, WebhookDelivery[]> = new Map();
  private webhookQueue: WebhookDelivery[] = [];

  constructor() {
    super();
    this.setMaxListeners(100);
    this.startWebhookProcessor();
  }

  // ===========================================================================
  // API KEY MANAGEMENT
  // ===========================================================================

  /**
   * Generate a new API key
   */
  async generateApiKey(
    organizationId: string,
    keyData: {
      name: string;
      environment: ApiEnvironment;
      scopes: ApiKeyScope[];
      ipWhitelist?: string[];
      expiresAt?: Date;
      rateLimitTier?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<{ apiKey: ApiKey; secret: string }> {
    // Generate secure key
    const keyPrefix =
      keyData.environment === "production" ? "ubi_live_" : "ubi_test_";
    const randomPart = crypto.randomBytes(24).toString("base64url");
    const secret = `${keyPrefix}${randomPart}`;

    // Hash the key for storage
    const keyHash = this.hashApiKey(secret);

    const apiKey: ApiKey = {
      id: uuidv4(),
      organizationId,
      name: keyData.name,
      keyPrefix: secret.substring(0, 12) + "...",
      keyHash,
      environment: keyData.environment,
      scopes: keyData.scopes,
      ipWhitelist: keyData.ipWhitelist || [],
      rateLimits: DEFAULT_RATE_LIMITS[keyData.rateLimitTier || "starter"],
      requestCount: 0,
      lastUsedAt: undefined,
      expiresAt: keyData.expiresAt,
      isActive: true,
      createdAt: new Date(),
      metadata: keyData.metadata || {},
    };

    this.apiKeys.set(apiKey.id, apiKey);
    this.apiKeysByHash.set(keyHash, apiKey.id);

    // Initialize rate limit buckets
    this.initializeRateLimits(apiKey.id, apiKey.rateLimits);

    this.emit("api_key:created", { apiKey, organizationId });

    // Return both the API key record and the actual secret (only shown once)
    return { apiKey, secret };
  }

  /**
   * Validate and authenticate an API key
   */
  async validateApiKey(
    secret: string,
    clientIp: string,
    requiredScope?: ApiKeyScope
  ): Promise<{
    valid: boolean;
    apiKey?: ApiKey;
    error?: string;
  }> {
    const keyHash = this.hashApiKey(secret);
    const keyId = this.apiKeysByHash.get(keyHash);

    if (!keyId) {
      return { valid: false, error: "Invalid API key" };
    }

    const apiKey = this.apiKeys.get(keyId);
    if (!apiKey) {
      return { valid: false, error: "API key not found" };
    }

    // Check if active
    if (!apiKey.isActive) {
      return { valid: false, error: "API key is inactive" };
    }

    // Check expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return { valid: false, error: "API key has expired" };
    }

    // Check IP whitelist
    if (
      apiKey.ipWhitelist.length > 0 &&
      !this.isIpAllowed(clientIp, apiKey.ipWhitelist)
    ) {
      return { valid: false, error: "IP address not allowed" };
    }

    // Check scope
    if (requiredScope && !apiKey.scopes.includes(requiredScope)) {
      return {
        valid: false,
        error: `Missing required scope: ${requiredScope}`,
      };
    }

    // Update last used
    apiKey.lastUsedAt = new Date();
    apiKey.requestCount++;
    this.apiKeys.set(keyId, apiKey);

    return { valid: true, apiKey };
  }

  /**
   * Rotate an API key (generate new secret)
   */
  async rotateApiKey(
    keyId: string
  ): Promise<{ apiKey: ApiKey; secret: string }> {
    const existingKey = this.apiKeys.get(keyId);
    if (!existingKey) {
      throw new Error("API key not found");
    }

    // Remove old hash mapping
    this.apiKeysByHash.delete(existingKey.keyHash);

    // Generate new secret
    const keyPrefix =
      existingKey.environment === "production" ? "ubi_live_" : "ubi_test_";
    const randomPart = crypto.randomBytes(24).toString("base64url");
    const secret = `${keyPrefix}${randomPart}`;
    const keyHash = this.hashApiKey(secret);

    // Update key
    existingKey.keyHash = keyHash;
    existingKey.keyPrefix = secret.substring(0, 12) + "...";

    this.apiKeys.set(keyId, existingKey);
    this.apiKeysByHash.set(keyHash, keyId);

    this.emit("api_key:rotated", { apiKey: existingKey });

    return { apiKey: existingKey, secret };
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(keyId: string): Promise<void> {
    const apiKey = this.apiKeys.get(keyId);
    if (!apiKey) {
      throw new Error("API key not found");
    }

    apiKey.isActive = false;
    this.apiKeys.set(keyId, apiKey);

    this.emit("api_key:revoked", { apiKey });
  }

  /**
   * Update API key settings
   */
  async updateApiKey(
    keyId: string,
    updates: {
      name?: string;
      scopes?: ApiKeyScope[];
      ipWhitelist?: string[];
      expiresAt?: Date;
      rateLimits?: RateLimitConfig;
      isActive?: boolean;
    }
  ): Promise<ApiKey> {
    const apiKey = this.apiKeys.get(keyId);
    if (!apiKey) {
      throw new Error("API key not found");
    }

    Object.assign(apiKey, updates);
    this.apiKeys.set(keyId, apiKey);

    // Update rate limits if changed
    if (updates.rateLimits) {
      this.initializeRateLimits(keyId, updates.rateLimits);
    }

    return apiKey;
  }

  /**
   * List API keys for an organization
   */
  async listApiKeys(
    organizationId: string,
    environment?: ApiEnvironment
  ): Promise<ApiKey[]> {
    let keys = Array.from(this.apiKeys.values()).filter(
      (k) => k.organizationId === organizationId
    );

    if (environment) {
      keys = keys.filter((k) => k.environment === environment);
    }

    return keys.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // ===========================================================================
  // RATE LIMITING
  // ===========================================================================

  /**
   * Check rate limit for an API key
   */
  async checkRateLimit(keyId: string): Promise<RateLimitResult> {
    const apiKey = this.apiKeys.get(keyId);
    if (!apiKey) {
      throw new Error("API key not found");
    }

    const bucket = this.rateLimitBuckets.get(keyId);
    if (!bucket) {
      throw new Error("Rate limit bucket not found");
    }

    const now = new Date();

    // Reset buckets if needed
    this.resetExpiredBuckets(bucket, now);

    // Check limits
    const limits = apiKey.rateLimits;
    const minuteExceeded = bucket.minute.count >= limits.perMinute;
    const hourExceeded = bucket.hour.count >= limits.perHour;
    const dayExceeded = bucket.day.count >= limits.perDay;
    const monthExceeded = bucket.month.count >= limits.perMonth;

    const allowed =
      !minuteExceeded && !hourExceeded && !dayExceeded && !monthExceeded;

    const result: RateLimitResult = {
      allowed,
      remaining: {
        minute: Math.max(0, limits.perMinute - bucket.minute.count),
        hour: Math.max(0, limits.perHour - bucket.hour.count),
        day: Math.max(0, limits.perDay - bucket.day.count),
        month: Math.max(0, limits.perMonth - bucket.month.count),
      },
      resetAt: {
        minute: bucket.minute.resetAt,
        hour: bucket.hour.resetAt,
        day: bucket.day.resetAt,
        month: bucket.month.resetAt,
      },
    };

    if (!allowed) {
      // Calculate retry after
      if (minuteExceeded) {
        result.retryAfter = Math.ceil(
          (bucket.minute.resetAt.getTime() - now.getTime()) / 1000
        );
      } else if (hourExceeded) {
        result.retryAfter = Math.ceil(
          (bucket.hour.resetAt.getTime() - now.getTime()) / 1000
        );
      } else if (dayExceeded) {
        result.retryAfter = Math.ceil(
          (bucket.day.resetAt.getTime() - now.getTime()) / 1000
        );
      } else {
        result.retryAfter = Math.ceil(
          (bucket.month.resetAt.getTime() - now.getTime()) / 1000
        );
      }
    }

    return result;
  }

  /**
   * Increment rate limit counter
   */
  async incrementRateLimit(keyId: string): Promise<void> {
    const bucket = this.rateLimitBuckets.get(keyId);
    if (!bucket) {
      throw new Error("Rate limit bucket not found");
    }

    bucket.minute.count++;
    bucket.hour.count++;
    bucket.day.count++;
    bucket.month.count++;

    this.rateLimitBuckets.set(keyId, bucket);
  }

  // ===========================================================================
  // REQUEST LOGGING
  // ===========================================================================

  /**
   * Log an API request
   */
  async logRequest(request: {
    organizationId: string;
    apiKeyId: string;
    method: string;
    path: string;
    statusCode: number;
    latencyMs: number;
    clientIp: string;
    userAgent?: string;
    requestBody?: Record<string, unknown>;
    responseBody?: Record<string, unknown>;
    errorMessage?: string;
  }): Promise<ApiRequest> {
    const apiRequest: ApiRequest = {
      id: uuidv4(),
      organizationId: request.organizationId,
      apiKeyId: request.apiKeyId,
      method: request.method as ApiRequest["method"],
      path: request.path,
      statusCode: request.statusCode,
      latencyMs: request.latencyMs,
      clientIp: request.clientIp,
      userAgent: request.userAgent,
      requestBody: request.requestBody,
      responseBody: request.responseBody,
      errorMessage: request.errorMessage,
      timestamp: new Date(),
    };

    const requests = this.apiRequests.get(request.organizationId) || [];
    requests.push(apiRequest);

    // Keep only last 10,000 requests per org (in memory)
    if (requests.length > 10000) {
      requests.splice(0, requests.length - 10000);
    }

    this.apiRequests.set(request.organizationId, requests);

    this.emit("api:request_logged", apiRequest);

    return apiRequest;
  }

  /**
   * Get API requests for an organization
   */
  async getRequests(
    organizationId: string,
    filters: {
      apiKeyId?: string;
      method?: string;
      path?: string;
      statusCode?: number;
      dateFrom?: Date;
      dateTo?: Date;
    },
    pagination: PaginationParams
  ): Promise<PaginatedResponse<ApiRequest>> {
    let requests = this.apiRequests.get(organizationId) || [];

    if (filters.apiKeyId) {
      requests = requests.filter((r) => r.apiKeyId === filters.apiKeyId);
    }
    if (filters.method) {
      requests = requests.filter((r) => r.method === filters.method);
    }
    if (filters.path) {
      requests = requests.filter((r) => r.path.includes(filters.path));
    }
    if (filters.statusCode) {
      requests = requests.filter((r) => r.statusCode === filters.statusCode);
    }
    if (filters.dateFrom) {
      requests = requests.filter((r) => r.timestamp >= filters.dateFrom!);
    }
    if (filters.dateTo) {
      requests = requests.filter((r) => r.timestamp <= filters.dateTo!);
    }

    requests.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return this.paginate(requests, pagination);
  }

  /**
   * Get API usage statistics
   */
  async getUsageStats(
    organizationId: string,
    dateFrom: Date,
    dateTo: Date
  ): Promise<ApiUsageStats> {
    let requests = this.apiRequests.get(organizationId) || [];
    requests = requests.filter(
      (r) => r.timestamp >= dateFrom && r.timestamp <= dateTo
    );

    const stats: ApiUsageStats = {
      totalRequests: requests.length,
      successfulRequests: requests.filter((r) => r.statusCode < 400).length,
      failedRequests: requests.filter((r) => r.statusCode >= 400).length,
      averageLatency: 0,
      requestsByEndpoint: {},
      requestsByStatus: {},
      requestsByHour: [],
    };

    if (requests.length > 0) {
      // Average latency
      const totalLatency = requests.reduce((sum, r) => sum + r.latencyMs, 0);
      stats.averageLatency = Math.round(totalLatency / requests.length);

      // By endpoint
      for (const req of requests) {
        const endpoint = `${req.method} ${req.path}`;
        stats.requestsByEndpoint[endpoint] =
          (stats.requestsByEndpoint[endpoint] || 0) + 1;
      }

      // By status code
      for (const req of requests) {
        stats.requestsByStatus[req.statusCode] =
          (stats.requestsByStatus[req.statusCode] || 0) + 1;
      }

      // By hour (last 24 hours)
      const hourCounts: Record<string, number> = {};
      for (const req of requests) {
        const hour = req.timestamp.toISOString().substring(0, 13);
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }
      stats.requestsByHour = Object.entries(hourCounts)
        .map(([hour, count]) => ({ hour, count }))
        .sort((a, b) => a.hour.localeCompare(b.hour));
    }

    return stats;
  }

  // ===========================================================================
  // WEBHOOK MANAGEMENT
  // ===========================================================================

  /**
   * Register a webhook
   */
  async registerWebhook(
    organizationId: string,
    webhookData: {
      url: string;
      events: WebhookEvent[];
      description?: string;
      headers?: Record<string, string>;
    }
  ): Promise<Webhook> {
    // Validate URL
    try {
      new URL(webhookData.url);
    } catch {
      throw new Error("Invalid webhook URL");
    }

    // Validate events
    for (const event of webhookData.events) {
      if (!WEBHOOK_EVENT_TYPES.includes(event)) {
        throw new Error(`Invalid event type: ${event}`);
      }
    }

    // Generate signing secret
    const signingSecret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;

    const webhook: Webhook = {
      id: uuidv4(),
      organizationId,
      url: webhookData.url,
      events: webhookData.events,
      signingSecret,
      description: webhookData.description,
      headers: webhookData.headers || {},
      isActive: true,
      createdAt: new Date(),
    };

    this.webhooks.set(webhook.id, webhook);
    this.webhookDeliveries.set(webhook.id, []);

    this.emit("webhook:registered", webhook);

    return webhook;
  }

  /**
   * Update webhook
   */
  async updateWebhook(
    webhookId: string,
    updates: {
      url?: string;
      events?: WebhookEvent[];
      description?: string;
      headers?: Record<string, string>;
      isActive?: boolean;
    }
  ): Promise<Webhook> {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      throw new Error("Webhook not found");
    }

    if (updates.url) {
      try {
        new URL(updates.url);
      } catch {
        throw new Error("Invalid webhook URL");
      }
    }

    if (updates.events) {
      for (const event of updates.events) {
        if (!WEBHOOK_EVENT_TYPES.includes(event)) {
          throw new Error(`Invalid event type: ${event}`);
        }
      }
    }

    Object.assign(webhook, updates);
    this.webhooks.set(webhookId, webhook);

    return webhook;
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(webhookId: string): Promise<void> {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      throw new Error("Webhook not found");
    }

    this.webhooks.delete(webhookId);
    this.webhookDeliveries.delete(webhookId);

    this.emit("webhook:deleted", webhook);
  }

  /**
   * Rotate webhook signing secret
   */
  async rotateWebhookSecret(webhookId: string): Promise<Webhook> {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      throw new Error("Webhook not found");
    }

    webhook.signingSecret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
    this.webhooks.set(webhookId, webhook);

    return webhook;
  }

  /**
   * List webhooks for an organization
   */
  async listWebhooks(organizationId: string): Promise<Webhook[]> {
    return Array.from(this.webhooks.values()).filter(
      (w) => w.organizationId === organizationId
    );
  }

  /**
   * Get webhook deliveries
   */
  async getWebhookDeliveries(
    webhookId: string,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<WebhookDelivery>> {
    const deliveries = this.webhookDeliveries.get(webhookId) || [];
    deliveries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return this.paginate(deliveries, pagination);
  }

  /**
   * Dispatch a webhook event
   */
  async dispatchWebhook(
    organizationId: string,
    event: WebhookEvent,
    payload: Record<string, unknown>
  ): Promise<void> {
    const webhooks = Array.from(this.webhooks.values()).filter(
      (w) =>
        w.organizationId === organizationId &&
        w.isActive &&
        w.events.includes(event)
    );

    for (const webhook of webhooks) {
      const delivery = this.createWebhookDelivery(webhook, event, payload);
      this.webhookQueue.push(delivery);
    }
  }

  /**
   * Retry failed webhook delivery
   */
  async retryWebhookDelivery(deliveryId: string): Promise<WebhookDelivery> {
    // Find delivery across all webhooks
    for (const [webhookId, deliveries] of this.webhookDeliveries) {
      const delivery = deliveries.find((d) => d.id === deliveryId);
      if (delivery) {
        const webhook = this.webhooks.get(webhookId);
        if (!webhook) {
          throw new Error("Webhook not found");
        }

        // Reset retry count and queue
        delivery.status = "pending";
        delivery.retryCount = 0;
        this.webhookQueue.push(delivery);

        return delivery;
      }
    }

    throw new Error("Webhook delivery not found");
  }

  /**
   * Test webhook endpoint
   */
  async testWebhook(webhookId: string): Promise<WebhookDelivery> {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      throw new Error("Webhook not found");
    }

    const testPayload = {
      test: true,
      message: "This is a test webhook from UBI",
      timestamp: new Date().toISOString(),
    };

    const delivery = this.createWebhookDelivery(
      webhook,
      "delivery.created" as WebhookEvent, // Use a generic event for testing
      testPayload
    );

    // Process immediately
    await this.processWebhookDelivery(delivery);

    return delivery;
  }

  // ===========================================================================
  // SIGNATURE VERIFICATION
  // ===========================================================================

  /**
   * Generate webhook signature
   */
  generateWebhookSignature(
    payload: string,
    secret: string,
    timestamp: number
  ): string {
    const signedPayload = `${timestamp}.${payload}`;
    const signature = crypto
      .createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");

    return `t=${timestamp},v1=${signature}`;
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string,
    tolerance: number = 300 // 5 minutes
  ): boolean {
    try {
      const parts = signature.split(",");
      const timestampPart = parts.find((p) => p.startsWith("t="));
      const signaturePart = parts.find((p) => p.startsWith("v1="));

      if (!timestampPart || !signaturePart) {
        return false;
      }

      const timestamp = parseInt(timestampPart.substring(2), 10);
      const expectedSignature = signaturePart.substring(3);

      // Check timestamp tolerance
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > tolerance) {
        return false;
      }

      // Compute expected signature
      const signedPayload = `${timestamp}.${payload}`;
      const computedSignature = crypto
        .createHmac("sha256", secret)
        .update(signedPayload)
        .digest("hex");

      // Timing-safe comparison
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(computedSignature)
      );
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private hashApiKey(secret: string): string {
    return crypto.createHash("sha256").update(secret).digest("hex");
  }

  private isIpAllowed(clientIp: string, whitelist: string[]): boolean {
    for (const entry of whitelist) {
      if (entry === clientIp) return true;

      // CIDR notation support
      if (entry.includes("/")) {
        if (this.isIpInCidr(clientIp, entry)) return true;
      }
    }
    return false;
  }

  private isIpInCidr(ip: string, cidr: string): boolean {
    const [range, bits] = cidr.split("/");
    const mask = ~(2 ** (32 - parseInt(bits)) - 1);

    const ipNum = this.ipToNumber(ip);
    const rangeNum = this.ipToNumber(range);

    return (ipNum & mask) === (rangeNum & mask);
  }

  private ipToNumber(ip: string): number {
    const parts = ip.split(".").map(Number);
    return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
  }

  private initializeRateLimits(keyId: string, limits: RateLimitConfig): void {
    const now = new Date();

    const bucket: RateLimitBucket = {
      minute: {
        count: 0,
        resetAt: new Date(now.getTime() + 60 * 1000),
      },
      hour: {
        count: 0,
        resetAt: new Date(now.getTime() + 60 * 60 * 1000),
      },
      day: {
        count: 0,
        resetAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
      month: {
        count: 0,
        resetAt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      },
    };

    this.rateLimitBuckets.set(keyId, bucket);
  }

  private resetExpiredBuckets(bucket: RateLimitBucket, now: Date): void {
    if (now >= bucket.minute.resetAt) {
      bucket.minute.count = 0;
      bucket.minute.resetAt = new Date(now.getTime() + 60 * 1000);
    }
    if (now >= bucket.hour.resetAt) {
      bucket.hour.count = 0;
      bucket.hour.resetAt = new Date(now.getTime() + 60 * 60 * 1000);
    }
    if (now >= bucket.day.resetAt) {
      bucket.day.count = 0;
      bucket.day.resetAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
    if (now >= bucket.month.resetAt) {
      bucket.month.count = 0;
      bucket.month.resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }
  }

  private createWebhookDelivery(
    webhook: Webhook,
    event: WebhookEvent,
    payload: Record<string, unknown>
  ): WebhookDelivery {
    const delivery: WebhookDelivery = {
      id: uuidv4(),
      webhookId: webhook.id,
      event,
      payload,
      status: "pending",
      retryCount: 0,
      timestamp: new Date(),
    };

    const deliveries = this.webhookDeliveries.get(webhook.id) || [];
    deliveries.push(delivery);

    // Keep only last 100 deliveries per webhook
    if (deliveries.length > 100) {
      deliveries.splice(0, deliveries.length - 100);
    }

    this.webhookDeliveries.set(webhook.id, deliveries);

    return delivery;
  }

  private async processWebhookDelivery(
    delivery: WebhookDelivery
  ): Promise<void> {
    const webhook = this.webhooks.get(delivery.webhookId);
    if (!webhook || !webhook.isActive) {
      delivery.status = "failed";
      delivery.errorMessage = "Webhook not found or inactive";
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const payloadString = JSON.stringify(delivery.payload);
    const signature = this.generateWebhookSignature(
      payloadString,
      webhook.signingSecret,
      timestamp
    );

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-UBI-Webhook-Signature": signature,
      "X-UBI-Webhook-ID": webhook.id,
      "X-UBI-Webhook-Event": delivery.event,
      "X-UBI-Webhook-Timestamp": timestamp.toString(),
      ...webhook.headers,
    };

    try {
      // In production, this would use fetch or axios
      // Simulating webhook delivery for now
      const success = Math.random() > 0.1; // 90% success rate for simulation

      if (success) {
        delivery.status = "delivered";
        delivery.deliveredAt = new Date();
        delivery.responseStatus = 200;
        webhook.lastSuccessAt = new Date();
      } else {
        throw new Error("Simulated webhook failure");
      }
    } catch (error) {
      delivery.retryCount++;
      delivery.errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      delivery.responseStatus = 500;
      webhook.lastFailureAt = new Date();
      webhook.failureCount = (webhook.failureCount || 0) + 1;

      if (delivery.retryCount < WEBHOOK_RETRY_CONFIG.maxRetries) {
        // Schedule retry
        const delay = Math.min(
          WEBHOOK_RETRY_CONFIG.initialDelayMs *
            Math.pow(
              WEBHOOK_RETRY_CONFIG.backoffMultiplier,
              delivery.retryCount - 1
            ),
          WEBHOOK_RETRY_CONFIG.maxDelayMs
        );
        delivery.nextRetryAt = new Date(Date.now() + delay);

        // Re-queue for retry
        setTimeout(() => {
          this.webhookQueue.push(delivery);
        }, delay);
      } else {
        delivery.status = "failed";
      }
    }

    this.webhooks.set(webhook.id, webhook);
  }

  private startWebhookProcessor(): void {
    setInterval(async () => {
      while (this.webhookQueue.length > 0) {
        const delivery = this.webhookQueue.shift();
        if (delivery) {
          await this.processWebhookDelivery(delivery);
        }
      }
    }, 1000);
  }

  private paginate<T>(
    items: T[],
    params: PaginationParams
  ): PaginatedResponse<T> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const total = items.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const end = start + limit;

    return {
      data: items.slice(start, end),
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const apiInfrastructureService = new ApiInfrastructureService();
