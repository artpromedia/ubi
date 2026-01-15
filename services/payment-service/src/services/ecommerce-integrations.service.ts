/**
 * UBI E-commerce Integrations Service
 *
 * Supports integration with major e-commerce platforms:
 * - Shopify
 * - WooCommerce
 * - Magento
 * - African platforms: Jumia, Takealot, Konga
 * - Custom API integrations
 */

import crypto from "crypto";
import { EventEmitter } from "events";

import { nanoid } from "nanoid";

import { deliveryApiService } from "./delivery-api.service";

import type {
  CreateDeliveryRequest,
  Integration,
  IntegrationSettings,
  IntegrationType,
} from "../types/b2b.types";

// =============================================================================
// INTERFACES
// =============================================================================

interface IntegrationCredentials {
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  shopDomain?: string;
  webhookSecret?: string;
  additionalConfig?: Record<string, any>;
}

interface IntegrationOrder {
  id: string;
  integrationId: string;
  externalOrderId: string;
  externalOrderNumber: string;
  status: "pending" | "processed" | "delivery_created" | "failed" | "skipped";
  orderData: any;
  deliveryId?: string;
  processedAt?: Date;
  failureReason?: string;
  createdAt: Date;
}

interface ShopifyWebhookPayload {
  id: number;
  email: string;
  created_at: string;
  updated_at: string;
  order_number: number;
  total_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  shipping_address: {
    first_name: string;
    last_name: string;
    address1: string;
    address2?: string;
    city: string;
    province?: string;
    zip: string;
    country: string;
    phone?: string;
  };
  billing_address: {
    address1: string;
    city: string;
    country: string;
  };
  line_items: {
    id: number;
    title: string;
    quantity: number;
    price: string;
    grams: number;
    sku?: string;
  }[];
  customer: {
    email: string;
    first_name: string;
    last_name: string;
    phone?: string;
  };
  tags?: string;
  note?: string;
}

interface WooCommerceOrder {
  id: number;
  number: string;
  status: string;
  date_created: string;
  total: string;
  currency: string;
  billing: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address_1: string;
    address_2?: string;
    city: string;
    state?: string;
    postcode?: string;
    country: string;
  };
  shipping: {
    first_name: string;
    last_name: string;
    address_1: string;
    address_2?: string;
    city: string;
    state?: string;
    postcode?: string;
    country: string;
  };
  line_items: {
    id: number;
    name: string;
    quantity: number;
    total: string;
    sku?: string;
    weight?: number;
  }[];
  shipping_lines: {
    method_title: string;
    total: string;
  }[];
  meta_data?: { key: string; value: string }[];
}

interface JumiaOrder {
  order_id: string;
  order_number: string;
  created_at: string;
  status: string;
  price: {
    total: number;
    currency: string;
  };
  customer: {
    first_name: string;
    last_name: string;
    phone: string;
    email?: string;
  };
  address: {
    first_name: string;
    last_name: string;
    phone: string;
    address: string;
    city: string;
    region?: string;
    country: string;
  };
  items: {
    name: string;
    quantity: number;
    price: number;
    sku: string;
  }[];
}

interface IntegrationWebhook {
  id: string;
  integrationId: string;
  event: string;
  payload: any;
  signature?: string;
  processedAt?: Date;
  success: boolean;
  error?: string;
  createdAt: Date;
}

// =============================================================================
// E-COMMERCE INTEGRATIONS SERVICE
// =============================================================================

export class EcommerceIntegrationsService extends EventEmitter {
  private integrations: Map<string, Integration> = new Map();
  private credentials: Map<string, IntegrationCredentials> = new Map();
  private orders: Map<string, IntegrationOrder> = new Map();
  private webhookLogs: Map<string, IntegrationWebhook[]> = new Map();

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  // ===========================================================================
  // INTEGRATION MANAGEMENT
  // ===========================================================================

  /**
   * Create a new e-commerce integration
   */
  async createIntegration(
    organizationId: string,
    type: IntegrationType,
    name: string,
    credentials: IntegrationCredentials,
    settings?: Partial<IntegrationSettings>,
  ): Promise<Integration> {
    // Validate credentials based on type
    this.validateCredentials(type, credentials);

    const integration: Integration = {
      id: nanoid(),
      organizationId,
      type,
      name,
      externalShopId:
        credentials.shopDomain || credentials.additionalConfig?.shopId,
      settings: {
        autoDispatch: settings?.autoDispatch ?? true,
        defaultPriority: settings?.defaultPriority || "STANDARD",
        proofOfDelivery: settings?.proofOfDelivery || "PHOTO",
        syncInventory: settings?.syncInventory ?? false,
        fulfillmentLocations: settings?.fulfillmentLocations || [],
        orderFilters: settings?.orderFilters,
      },
      status: "PENDING_SETUP",
      ordersProcessed: 0,
      deliveriesCreated: 0,
      isActive: false,
      createdAt: new Date(),
    };

    this.integrations.set(integration.id, integration);
    this.credentials.set(integration.id, this.encryptCredentials(credentials));

    // Test connection
    try {
      await this.testConnection(integration.id);
      integration.status = "ACTIVE";
      integration.isActive = true;
    } catch (error) {
      integration.status = "ERROR";
      integration.lastError =
        error instanceof Error ? error.message : "Connection failed";
      integration.lastErrorAt = new Date();
    }

    this.integrations.set(integration.id, integration);

    this.emit("integration:created", integration);

    return integration;
  }

  /**
   * Update integration settings
   */
  async updateIntegration(
    integrationId: string,
    updates: {
      name?: string;
      settings?: Partial<IntegrationSettings>;
      isActive?: boolean;
    },
  ): Promise<Integration> {
    const integration = this.integrations.get(integrationId);
    if (!integration) {
      throw new Error("Integration not found");
    }

    if (updates.name) {
      integration.name = updates.name;
    }

    if (updates.settings) {
      integration.settings = { ...integration.settings, ...updates.settings };
    }

    if (updates.isActive !== undefined) {
      integration.isActive = updates.isActive;
      integration.status = updates.isActive ? "ACTIVE" : "PAUSED";
    }

    this.integrations.set(integrationId, integration);

    this.emit("integration:updated", integration);

    return integration;
  }

  /**
   * Update integration credentials
   */
  async updateCredentials(
    integrationId: string,
    credentials: Partial<IntegrationCredentials>,
  ): Promise<void> {
    const integration = this.integrations.get(integrationId);
    if (!integration) {
      throw new Error("Integration not found");
    }

    const existingCredentials = this.credentials.get(integrationId) || {};
    this.credentials.set(
      integrationId,
      this.encryptCredentials({ ...existingCredentials, ...credentials }),
    );

    // Re-test connection
    try {
      await this.testConnection(integrationId);
      integration.status = "ACTIVE";
      integration.lastError = undefined;
      integration.lastErrorAt = undefined;
    } catch (error) {
      integration.status = "ERROR";
      integration.lastError =
        error instanceof Error ? error.message : "Connection failed";
      integration.lastErrorAt = new Date();
    }

    this.integrations.set(integrationId, integration);
  }

  /**
   * Delete an integration
   */
  async deleteIntegration(integrationId: string): Promise<void> {
    const integration = this.integrations.get(integrationId);
    if (!integration) {
      throw new Error("Integration not found");
    }

    this.integrations.delete(integrationId);
    this.credentials.delete(integrationId);

    this.emit("integration:deleted", {
      integrationId,
      organizationId: integration.organizationId,
    });
  }

  /**
   * Get integration by ID
   */
  async getIntegration(integrationId: string): Promise<Integration | null> {
    return this.integrations.get(integrationId) || null;
  }

  /**
   * List integrations for an organization
   */
  async listIntegrations(organizationId: string): Promise<Integration[]> {
    return Array.from(this.integrations.values()).filter(
      (i) => i.organizationId === organizationId,
    );
  }

  /**
   * Test integration connection
   */
  async testConnection(
    integrationId: string,
  ): Promise<{ success: boolean; message: string }> {
    const integration = this.integrations.get(integrationId);
    if (!integration) {
      throw new Error("Integration not found");
    }

    const credentials = this.credentials.get(integrationId);
    if (!credentials) {
      throw new Error("Integration credentials not found");
    }

    try {
      switch (integration.type) {
        case "SHOPIFY":
          return await this.testShopifyConnection(credentials);
        case "WOOCOMMERCE":
          return await this.testWooCommerceConnection(credentials);
        case "JUMIA":
          return await this.testJumiaConnection(credentials);
        case "TAKEALOT":
          return await this.testTakealotConnection(credentials);
        case "KONGA":
          return await this.testKongaConnection(credentials);
        default:
          return { success: true, message: "Connection successful" };
      }
    } catch (error) {
      throw new Error(
        `Connection test failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  // ===========================================================================
  // WEBHOOK HANDLING
  // ===========================================================================

  /**
   * Process Shopify webhook
   */
  async processShopifyWebhook(
    integrationId: string,
    event: string,
    payload: ShopifyWebhookPayload,
    signature: string,
  ): Promise<{ processed: boolean; deliveryId?: string }> {
    const integration = this.integrations.get(integrationId);
    if (!integration) {
      throw new Error("Integration not found");
    }

    const credentials = this.credentials.get(integrationId);
    if (!credentials) {
      throw new Error("Credentials not found");
    }

    // Verify webhook signature
    if (
      !this.verifyShopifySignature(
        payload,
        signature,
        credentials.webhookSecret!,
      )
    ) {
      throw new Error("Invalid webhook signature");
    }

    // Log webhook
    await this.logWebhook(integrationId, event, payload, signature);

    // Process based on event type
    if (event === "orders/create" || event === "orders/paid") {
      return await this.processShopifyOrder(integration, payload);
    }

    return { processed: true };
  }

  /**
   * Process WooCommerce webhook
   */
  async processWooCommerceWebhook(
    integrationId: string,
    event: string,
    payload: WooCommerceOrder,
    signature: string,
  ): Promise<{ processed: boolean; deliveryId?: string }> {
    const integration = this.integrations.get(integrationId);
    if (!integration) {
      throw new Error("Integration not found");
    }

    await this.logWebhook(integrationId, event, payload, signature);

    if (event === "order.created" || event === "order.completed") {
      return await this.processWooCommerceOrder(integration, payload);
    }

    return { processed: true };
  }

  /**
   * Process Jumia order webhook
   */
  async processJumiaWebhook(
    integrationId: string,
    event: string,
    payload: JumiaOrder,
    signature: string,
  ): Promise<{ processed: boolean; deliveryId?: string }> {
    const integration = this.integrations.get(integrationId);
    if (!integration) {
      throw new Error("Integration not found");
    }

    await this.logWebhook(integrationId, event, payload, signature);

    if (event === "order.ready_to_ship" || event === "order.paid") {
      return await this.processJumiaOrder(integration, payload);
    }

    return { processed: true };
  }

  // ===========================================================================
  // ORDER PROCESSING
  // ===========================================================================

  /**
   * Process a Shopify order
   */
  private async processShopifyOrder(
    integration: Integration,
    orderData: ShopifyWebhookPayload,
  ): Promise<{ processed: boolean; deliveryId?: string }> {
    // Check if order already processed
    const existingOrder = Array.from(this.orders.values()).find(
      (o) =>
        o.integrationId === integration.id &&
        o.externalOrderId === String(orderData.id),
    );

    if (existingOrder) {
      return {
        processed: true,
        deliveryId: existingOrder.deliveryId,
      };
    }

    // Create order record
    const order: IntegrationOrder = {
      id: nanoid(),
      integrationId: integration.id,
      externalOrderId: String(orderData.id),
      externalOrderNumber: String(orderData.order_number),
      status: "pending",
      orderData,
      createdAt: new Date(),
    };

    this.orders.set(order.id, order);

    // Check order filters
    if (!this.passesOrderFilters(integration, orderData)) {
      order.status = "skipped";
      this.orders.set(order.id, order);
      return { processed: true };
    }

    try {
      // Convert to delivery request
      const deliveryRequest = this.shopifyOrderToDeliveryRequest(
        integration,
        orderData,
      );

      // Create delivery
      const delivery = await deliveryApiService.createDelivery(
        integration.organizationId,
        deliveryRequest,
      );

      order.status = "delivery_created";
      order.deliveryId = delivery.id;
      order.processedAt = new Date();

      integration.ordersProcessed++;
      integration.deliveriesCreated++;
      integration.lastSyncAt = new Date();
      this.integrations.set(integration.id, integration);

      // Auto-confirm if enabled
      if (integration.settings.autoDispatch) {
        await deliveryApiService.confirmDelivery(delivery.id);
      }

      this.emit("order:processed", { integration, order, delivery });

      return { processed: true, deliveryId: delivery.id };
    } catch (error) {
      order.status = "failed";
      order.failureReason =
        error instanceof Error ? error.message : "Unknown error";
      this.orders.set(order.id, order);

      integration.lastErrorAt = new Date();
      integration.lastError = order.failureReason;
      this.integrations.set(integration.id, integration);

      this.emit("order:failed", { integration, order, error });

      throw error;
    }
  }

  /**
   * Process a WooCommerce order
   */
  private async processWooCommerceOrder(
    integration: Integration,
    orderData: WooCommerceOrder,
  ): Promise<{ processed: boolean; deliveryId?: string }> {
    const order: IntegrationOrder = {
      id: nanoid(),
      integrationId: integration.id,
      externalOrderId: String(orderData.id),
      externalOrderNumber: orderData.number,
      status: "pending",
      orderData,
      createdAt: new Date(),
    };

    this.orders.set(order.id, order);

    try {
      const deliveryRequest = this.wooCommerceOrderToDeliveryRequest(
        integration,
        orderData,
      );

      const delivery = await deliveryApiService.createDelivery(
        integration.organizationId,
        deliveryRequest,
      );

      order.status = "delivery_created";
      order.deliveryId = delivery.id;
      order.processedAt = new Date();

      integration.ordersProcessed++;
      integration.deliveriesCreated++;
      integration.lastSyncAt = new Date();
      this.integrations.set(integration.id, integration);

      if (integration.settings.autoDispatch) {
        await deliveryApiService.confirmDelivery(delivery.id);
      }

      return { processed: true, deliveryId: delivery.id };
    } catch (error) {
      order.status = "failed";
      order.failureReason =
        error instanceof Error ? error.message : "Unknown error";
      this.orders.set(order.id, order);
      throw error;
    }
  }

  /**
   * Process a Jumia order
   */
  private async processJumiaOrder(
    integration: Integration,
    orderData: JumiaOrder,
  ): Promise<{ processed: boolean; deliveryId?: string }> {
    const order: IntegrationOrder = {
      id: nanoid(),
      integrationId: integration.id,
      externalOrderId: orderData.order_id,
      externalOrderNumber: orderData.order_number,
      status: "pending",
      orderData,
      createdAt: new Date(),
    };

    this.orders.set(order.id, order);

    try {
      const deliveryRequest = this.jumiaOrderToDeliveryRequest(
        integration,
        orderData,
      );

      const delivery = await deliveryApiService.createDelivery(
        integration.organizationId,
        deliveryRequest,
      );

      order.status = "delivery_created";
      order.deliveryId = delivery.id;
      order.processedAt = new Date();

      integration.ordersProcessed++;
      integration.deliveriesCreated++;
      integration.lastSyncAt = new Date();
      this.integrations.set(integration.id, integration);

      if (integration.settings.autoDispatch) {
        await deliveryApiService.confirmDelivery(delivery.id);
      }

      return { processed: true, deliveryId: delivery.id };
    } catch (error) {
      order.status = "failed";
      order.failureReason =
        error instanceof Error ? error.message : "Unknown error";
      this.orders.set(order.id, order);
      throw error;
    }
  }

  // ===========================================================================
  // ORDER SYNC (PULL)
  // ===========================================================================

  /**
   * Sync orders from Shopify
   */
  async syncShopifyOrders(
    integrationId: string,
    _options?: { since?: Date; limit?: number },
  ): Promise<{ synced: number; failed: number }> {
    const integration = this.integrations.get(integrationId);
    if (!integration || integration.type !== "SHOPIFY") {
      throw new Error("Invalid Shopify integration");
    }

    const credentials = this.credentials.get(integrationId);
    if (!credentials) {
      throw new Error("Credentials not found");
    }

    // In production, make actual API call to Shopify
    // GET /admin/api/2024-01/orders.json?status=any&fulfillment_status=unfulfilled

    // Mock response for now
    const mockOrders: ShopifyWebhookPayload[] = [];

    let synced = 0;
    let failed = 0;

    for (const orderData of mockOrders) {
      try {
        await this.processShopifyOrder(integration, orderData);
        synced++;
      } catch (error) {
        failed++;
      }
    }

    integration.lastSyncAt = new Date();
    this.integrations.set(integrationId, integration);

    return { synced, failed };
  }

  /**
   * Sync orders from WooCommerce
   */
  async syncWooCommerceOrders(
    integrationId: string,
    _options?: { since?: Date; limit?: number },
  ): Promise<{ synced: number; failed: number }> {
    const integration = this.integrations.get(integrationId);
    if (!integration || integration.type !== "WOOCOMMERCE") {
      throw new Error("Invalid WooCommerce integration");
    }

    // In production, make actual API call to WooCommerce
    // GET /wp-json/wc/v3/orders?status=processing&per_page=100

    const mockOrders: WooCommerceOrder[] = [];

    let synced = 0;
    let failed = 0;

    for (const orderData of mockOrders) {
      try {
        await this.processWooCommerceOrder(integration, orderData);
        synced++;
      } catch (error) {
        failed++;
      }
    }

    integration.lastSyncAt = new Date();
    this.integrations.set(integrationId, integration);

    return { synced, failed };
  }

  // ===========================================================================
  // FULFILLMENT UPDATES
  // ===========================================================================

  /**
   * Update Shopify fulfillment when delivery completes
   */
  async updateShopifyFulfillment(
    integrationId: string,
    orderId: string,
    trackingNumber: string,
    trackingUrl: string,
  ): Promise<void> {
    const integration = this.integrations.get(integrationId);
    if (!integration || integration.type !== "SHOPIFY") {
      throw new Error("Invalid Shopify integration");
    }

    const credentials = this.credentials.get(integrationId);
    if (!credentials) {
      throw new Error("Credentials not found");
    }

    // In production, make API call:
    // POST /admin/api/2024-01/orders/{order_id}/fulfillments.json
    // {
    //   "fulfillment": {
    //     "tracking_number": trackingNumber,
    //     "tracking_url": trackingUrl,
    //     "tracking_company": "UBI Delivery"
    //   }
    // }

    this.emit("fulfillment:updated", {
      integration,
      orderId,
      trackingNumber,
      trackingUrl,
    });
  }

  /**
   * Update WooCommerce order status
   */
  async updateWooCommerceStatus(
    integrationId: string,
    orderId: string,
    status: "completed" | "shipped",
  ): Promise<void> {
    const integration = this.integrations.get(integrationId);
    if (!integration || integration.type !== "WOOCOMMERCE") {
      throw new Error("Invalid WooCommerce integration");
    }

    // In production, make API call:
    // PUT /wp-json/wc/v3/orders/{order_id}
    // { "status": status }

    this.emit("woocommerce:status_updated", { integration, orderId, status });
  }

  // ===========================================================================
  // ORDER QUERIES
  // ===========================================================================

  /**
   * Get integration order by external ID
   */
  async getOrderByExternalId(
    integrationId: string,
    externalOrderId: string,
  ): Promise<IntegrationOrder | null> {
    return (
      Array.from(this.orders.values()).find(
        (o) =>
          o.integrationId === integrationId &&
          o.externalOrderId === externalOrderId,
      ) || null
    );
  }

  /**
   * List orders for an integration
   */
  async listIntegrationOrders(
    integrationId: string,
    filters?: {
      status?: IntegrationOrder["status"];
      dateFrom?: Date;
      dateTo?: Date;
    },
  ): Promise<IntegrationOrder[]> {
    let orders = Array.from(this.orders.values()).filter(
      (o) => o.integrationId === integrationId,
    );

    if (filters?.status) {
      orders = orders.filter((o) => o.status === filters.status);
    }
    if (filters?.dateFrom) {
      orders = orders.filter((o) => o.createdAt >= filters.dateFrom!);
    }
    if (filters?.dateTo) {
      orders = orders.filter((o) => o.createdAt <= filters.dateTo!);
    }

    return orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Retry failed order
   */
  async retryFailedOrder(
    orderId: string,
  ): Promise<{ processed: boolean; deliveryId?: string }> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error("Order not found");
    }

    if (order.status !== "failed") {
      throw new Error("Order is not in failed status");
    }

    const integration = this.integrations.get(order.integrationId);
    if (!integration) {
      throw new Error("Integration not found");
    }

    switch (integration.type) {
      case "SHOPIFY":
        return await this.processShopifyOrder(integration, order.orderData);
      case "WOOCOMMERCE":
        return await this.processWooCommerceOrder(integration, order.orderData);
      case "JUMIA":
        return await this.processJumiaOrder(integration, order.orderData);
      default:
        throw new Error(`Unsupported integration type: ${integration.type}`);
    }
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private validateCredentials(
    type: IntegrationType,
    credentials: IntegrationCredentials,
  ): void {
    switch (type) {
      case "SHOPIFY":
        if (!credentials.accessToken || !credentials.shopDomain) {
          throw new Error("Shopify requires accessToken and shopDomain");
        }
        break;
      case "WOOCOMMERCE":
        if (!credentials.apiKey || !credentials.apiSecret) {
          throw new Error("WooCommerce requires apiKey and apiSecret");
        }
        break;
      case "JUMIA":
      case "KONGA":
      case "TAKEALOT":
        if (!credentials.apiKey) {
          throw new Error(`${type} requires apiKey`);
        }
        break;
    }
  }

  private encryptCredentials(
    credentials: IntegrationCredentials,
  ): IntegrationCredentials {
    // In production, encrypt sensitive fields
    return credentials;
  }

  private verifyShopifySignature(
    payload: any,
    signature: string,
    secret: string,
  ): boolean {
    const computedSignature = crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(payload))
      .digest("base64");

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(computedSignature),
    );
  }

  private async testShopifyConnection(
    _credentials: IntegrationCredentials,
  ): Promise<{ success: boolean; message: string }> {
    // In production, make API call to Shopify
    // GET https://{shop}.myshopify.com/admin/api/2024-01/shop.json
    return { success: true, message: "Connected to Shopify" };
  }

  private async testWooCommerceConnection(
    _credentials: IntegrationCredentials,
  ): Promise<{ success: boolean; message: string }> {
    // In production, make API call to WooCommerce
    return { success: true, message: "Connected to WooCommerce" };
  }

  private async testJumiaConnection(
    _credentials: IntegrationCredentials,
  ): Promise<{ success: boolean; message: string }> {
    return { success: true, message: "Connected to Jumia Seller Center" };
  }

  private async testTakealotConnection(
    _credentials: IntegrationCredentials,
  ): Promise<{ success: boolean; message: string }> {
    return { success: true, message: "Connected to Takealot Seller Portal" };
  }

  private async testKongaConnection(
    _credentials: IntegrationCredentials,
  ): Promise<{ success: boolean; message: string }> {
    return { success: true, message: "Connected to Konga Seller Hub" };
  }

  private passesOrderFilters(
    integration: Integration,
    orderData: any,
  ): boolean {
    const filters = integration.settings.orderFilters;
    if (!filters) {
      return true;
    }

    // Check minimum order value
    if (filters.minOrderValue) {
      const orderValue = parseFloat(
        orderData.total_price || orderData.total || "0",
      );
      if (orderValue < filters.minOrderValue) {
        return false;
      }
    }

    // Check excluded tags (Shopify)
    if (filters.excludeTags && orderData.tags) {
      const orderTags = orderData.tags
        .split(",")
        .map((t: string) => t.trim().toLowerCase());
      for (const excludeTag of filters.excludeTags) {
        if (orderTags.includes(excludeTag.toLowerCase())) {
          return false;
        }
      }
    }

    // Check included tags (Shopify)
    if (
      filters.includeTags &&
      filters.includeTags.length > 0 &&
      orderData.tags
    ) {
      const orderTags = orderData.tags
        .split(",")
        .map((t: string) => t.trim().toLowerCase());
      const hasIncludedTag = filters.includeTags.some((tag) =>
        orderTags.includes(tag.toLowerCase()),
      );
      if (!hasIncludedTag) {
        return false;
      }
    }

    return true;
  }

  private shopifyOrderToDeliveryRequest(
    integration: Integration,
    orderData: ShopifyWebhookPayload,
  ): CreateDeliveryRequest {
    const shipping = orderData.shipping_address;
    const customer = orderData.customer;

    // Calculate total weight
    const totalWeightGrams = orderData.line_items.reduce(
      (sum, item) => sum + item.grams * item.quantity,
      0,
    );

    return {
      external_id: String(orderData.id),
      pickup: {
        address:
          integration.settings.fulfillmentLocations[0] || "Warehouse Address",
        contact_name: "Warehouse",
        contact_phone: "+2348000000000",
      },
      dropoff: {
        address: `${shipping.address1}${shipping.address2 ? ", " + shipping.address2 : ""}, ${shipping.city}, ${shipping.province || ""} ${shipping.zip}, ${shipping.country}`,
        contact_name: `${shipping.first_name} ${shipping.last_name}`,
        contact_phone: shipping.phone || customer.phone || "",
      },
      recipient: {
        name: `${shipping.first_name} ${shipping.last_name}`,
        phone: shipping.phone || customer.phone || "",
        email: customer.email,
      },
      package: {
        size: this.estimatePackageSize(totalWeightGrams),
        weight_kg: totalWeightGrams / 1000,
        description: orderData.line_items
          .map((i) => `${i.quantity}x ${i.title}`)
          .join(", "),
        value: parseFloat(orderData.total_price),
      },
      options: {
        priority: integration.settings.defaultPriority,
        proof_of_delivery: integration.settings.proofOfDelivery,
      },
      metadata: {
        source: "shopify",
        order_number: orderData.order_number,
        order_id: orderData.id,
      },
    };
  }

  private wooCommerceOrderToDeliveryRequest(
    integration: Integration,
    orderData: WooCommerceOrder,
  ): CreateDeliveryRequest {
    const shipping = orderData.shipping;
    const billing = orderData.billing;

    const totalWeightKg = orderData.line_items.reduce(
      (sum, item) => sum + (item.weight || 0) * item.quantity,
      0,
    );

    return {
      external_id: String(orderData.id),
      pickup: {
        address:
          integration.settings.fulfillmentLocations[0] || "Warehouse Address",
        contact_name: "Warehouse",
        contact_phone: "+2348000000000",
      },
      dropoff: {
        address: `${shipping.address_1}${shipping.address_2 ? ", " + shipping.address_2 : ""}, ${shipping.city}, ${shipping.state || ""} ${shipping.postcode || ""}, ${shipping.country}`,
        contact_name: `${shipping.first_name} ${shipping.last_name}`,
        contact_phone: billing.phone,
      },
      recipient: {
        name: `${shipping.first_name} ${shipping.last_name}`,
        phone: billing.phone,
        email: billing.email,
      },
      package: {
        size: this.estimatePackageSize(totalWeightKg * 1000),
        weight_kg: totalWeightKg,
        description: orderData.line_items
          .map((i) => `${i.quantity}x ${i.name}`)
          .join(", "),
        value: parseFloat(orderData.total),
      },
      options: {
        priority: integration.settings.defaultPriority,
        proof_of_delivery: integration.settings.proofOfDelivery,
      },
      metadata: {
        source: "woocommerce",
        order_number: orderData.number,
        order_id: orderData.id,
      },
    };
  }

  private jumiaOrderToDeliveryRequest(
    integration: Integration,
    orderData: JumiaOrder,
  ): CreateDeliveryRequest {
    const address = orderData.address;
    const customer = orderData.customer;

    return {
      external_id: orderData.order_id,
      pickup: {
        address:
          integration.settings.fulfillmentLocations[0] || "Warehouse Address",
        contact_name: "Warehouse",
        contact_phone: "+2348000000000",
      },
      dropoff: {
        address: `${address.address}, ${address.city}, ${address.region || ""}, ${address.country}`,
        contact_name: `${address.first_name} ${address.last_name}`,
        contact_phone: address.phone,
      },
      recipient: {
        name: `${customer.first_name} ${customer.last_name}`,
        phone: customer.phone,
        email: customer.email,
      },
      package: {
        size: "MEDIUM",
        description: orderData.items
          .map((i) => `${i.quantity}x ${i.name}`)
          .join(", "),
        value: orderData.price.total,
      },
      options: {
        priority: integration.settings.defaultPriority,
        proof_of_delivery: integration.settings.proofOfDelivery,
      },
      metadata: {
        source: "jumia",
        order_number: orderData.order_number,
        order_id: orderData.order_id,
      },
    };
  }

  private estimatePackageSize(
    weightGrams: number,
  ): "ENVELOPE" | "SMALL" | "MEDIUM" | "LARGE" | "XLARGE" {
    if (weightGrams < 500) {
      return "ENVELOPE";
    }
    if (weightGrams < 2000) {
      return "SMALL";
    }
    if (weightGrams < 5000) {
      return "MEDIUM";
    }
    if (weightGrams < 15000) {
      return "LARGE";
    }
    return "XLARGE";
  }

  private async logWebhook(
    integrationId: string,
    event: string,
    payload: any,
    signature?: string,
  ): Promise<void> {
    const logs = this.webhookLogs.get(integrationId) || [];

    logs.push({
      id: nanoid(),
      integrationId,
      event,
      payload,
      signature,
      success: true,
      createdAt: new Date(),
    });

    // Keep only last 100 logs per integration
    if (logs.length > 100) {
      logs.splice(0, logs.length - 100);
    }

    this.webhookLogs.set(integrationId, logs);
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const ecommerceIntegrationsService = new EcommerceIntegrationsService();
