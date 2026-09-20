/**
 * UBI B2B TypeScript SDK
 *
 * Official SDK for integrating with UBI Business APIs:
 * - Delivery API
 * - Healthcare Transport
 * - School Transport
 * - Corporate Accounts
 * - Billing
 */

import crypto from "node:crypto";

// =============================================================================
// TYPES
// =============================================================================

export interface UbiConfig {
  apiKey: string;
  environment?: "sandbox" | "production";
  baseUrl?: string;
  timeout?: number;
  retries?: number;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Delivery Types
export interface DeliveryQuoteRequest {
  pickup: {
    address: string;
    coordinates?: { lat: number; lng: number };
    contactName?: string;
    contactPhone?: string;
  };
  dropoff: {
    address: string;
    coordinates?: { lat: number; lng: number };
    contactName?: string;
    contactPhone?: string;
  };
  packageSize?: "SMALL" | "MEDIUM" | "LARGE" | "XLARGE" | "CUSTOM";
  packageWeight?: number;
  priority?:
    | "ECONOMY"
    | "STANDARD"
    | "EXPRESS"
    | "SAME_DAY"
    | "RUSH"
    | "INSTANT";
}

export interface DeliveryQuote {
  id: string;
  price: number;
  currency: string;
  estimatedPickup: Date;
  estimatedDelivery: Date;
  expiresAt: Date;
  distance: number;
  duration: number;
}

export interface DeliveryRequest {
  quoteId?: string;
  pickup: {
    address: string;
    coordinates?: { lat: number; lng: number };
    contactName: string;
    contactPhone: string;
    instructions?: string;
  };
  dropoff: {
    address: string;
    coordinates?: { lat: number; lng: number };
    contactName: string;
    contactPhone: string;
    instructions?: string;
  };
  packageDetails: {
    size?: "SMALL" | "MEDIUM" | "LARGE" | "XLARGE" | "CUSTOM";
    weight?: number;
    description?: string;
    value?: number;
    fragile?: boolean;
  };
  priority?:
    | "ECONOMY"
    | "STANDARD"
    | "EXPRESS"
    | "SAME_DAY"
    | "RUSH"
    | "INSTANT";
  scheduledPickup?: Date;
  reference?: string;
  metadata?: Record<string, string>;
}

export interface Delivery {
  id: string;
  trackingNumber: string;
  status: string;
  pickup: any;
  dropoff: any;
  packageDetails: any;
  price: number;
  currency: string;
  createdAt: Date;
  estimatedDelivery?: Date;
}

export interface TrackingInfo {
  trackingNumber: string;
  status: string;
  estimatedDelivery?: Date;
  events: TrackingEvent[];
  currentLocation?: { lat: number; lng: number };
}

export interface TrackingEvent {
  status: string;
  timestamp: Date;
  location?: { lat: number; lng: number };
  description?: string;
}

// Webhook Types
export interface WebhookEvent {
  id: string;
  type: string;
  data: any;
  createdAt: Date;
}

// =============================================================================
// UBI CLIENT
// =============================================================================

export class UbiClient {
  private config: Required<UbiConfig>;
  private baseUrl: string;

  // Sub-clients
  public delivery: DeliveryClient;
  public healthcare: HealthcareClient;
  public school: SchoolClient;
  public corporate: CorporateClient;
  public billing: BillingClient;
  public webhooks: WebhookClient;

  constructor(config: UbiConfig) {
    this.config = {
      apiKey: config.apiKey,
      environment: config.environment || "sandbox",
      baseUrl: config.baseUrl || this.getDefaultBaseUrl(config.environment),
      timeout: config.timeout || 30000,
      retries: config.retries || 3,
    };

    this.baseUrl = this.config.baseUrl;

    // Initialize sub-clients
    this.delivery = new DeliveryClient(this);
    this.healthcare = new HealthcareClient(this);
    this.school = new SchoolClient(this);
    this.corporate = new CorporateClient(this);
    this.billing = new BillingClient(this);
    this.webhooks = new WebhookClient(this);
  }

  private getDefaultBaseUrl(environment?: string): string {
    return environment === "production"
      ? "https://api.ubi.com/v1/b2b"
      : "https://sandbox-api.ubi.com/v1/b2b";
  }

  /**
   * Make an authenticated API request
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T is an assertion about the parsed JSON; defaulting to any restores the pre-lint inference for delegating methods
  async request<T = any>(
    method: string,
    path: string,
    data?: any,
    options?: RequestOptions,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
      "X-UBI-SDK-Version": "1.0.0",
      ...options?.headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(
          url,
          fetchOptions,
          options?.timeout,
        );

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as any;
          throw new UbiApiError(
            errorBody.message || `HTTP ${response.status}`,
            response.status,
            errorBody.error,
            errorBody,
          );
        }

        const responseData = (await response.json()) as any;
        return responseData.data || responseData;
      } catch (error) {
        lastError = error as Error;

        if (error instanceof UbiApiError && error.status < 500) {
          throw error; // Don't retry client errors
        }

        if (attempt < this.config.retries - 1) {
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw (
      lastError ??
      new Error("request failed after retries without capturing an error")
    );
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout?: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      timeout || this.config.timeout,
    );

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// ERROR CLASS
// =============================================================================

export class UbiApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: any,
  ) {
    super(message);
    this.name = "UbiApiError";
  }
}

// =============================================================================
// DELIVERY CLIENT
// =============================================================================

export class DeliveryClient {
  constructor(private client: UbiClient) {}

  /**
   * Get a delivery quote
   */
  async createQuote(request: DeliveryQuoteRequest): Promise<DeliveryQuote> {
    const response = await this.client.request(
      "POST",
      "/delivery/quotes",
      request,
    );
    return response;
  }

  /**
   * Create a delivery
   */
  async create(request: DeliveryRequest): Promise<Delivery> {
    const response = await this.client.request(
      "POST",
      "/delivery/deliveries",
      request,
    );
    return response;
  }

  /**
   * Create multiple deliveries at once
   */
  async createBatch(deliveries: DeliveryRequest[]): Promise<{
    id: string;
    deliveries: Delivery[];
    totalDeliveries: number;
  }> {
    const response = await this.client.request(
      "POST",
      "/delivery/deliveries/batch",
      {
        deliveries,
      },
    );
    return response;
  }

  /**
   * Get a delivery by ID
   */
  async get(deliveryId: string): Promise<Delivery> {
    const response = await this.client.request(
      "GET",
      `/delivery/deliveries/${deliveryId}`,
    );
    return response;
  }

  /**
   * List deliveries
   */
  async list(
    filters?: {
      status?: string;
      dateFrom?: Date;
      dateTo?: Date;
    },
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<Delivery>> {
    const params = new URLSearchParams();

    if (filters?.status) {
      params.append("status", filters.status);
    }
    if (filters?.dateFrom) {
      params.append("dateFrom", filters.dateFrom.toISOString());
    }
    if (filters?.dateTo) {
      params.append("dateTo", filters.dateTo.toISOString());
    }
    if (pagination?.page) {
      params.append("page", pagination.page.toString());
    }
    if (pagination?.limit) {
      params.append("limit", pagination.limit.toString());
    }

    const query = params.toString();
    const response = await this.client.request(
      "GET",
      `/delivery/deliveries${query ? `?${query}` : ""}`,
    );
    return response;
  }

  /**
   * Track a delivery by tracking number
   */
  async track(trackingNumber: string): Promise<TrackingInfo> {
    const response = await this.client.request(
      "GET",
      `/delivery/deliveries/track/${trackingNumber}`,
    );
    return response;
  }

  /**
   * Cancel a delivery
   */
  async cancel(deliveryId: string, reason?: string): Promise<Delivery> {
    const response = await this.client.request(
      "POST",
      `/delivery/deliveries/${deliveryId}/cancel`,
      { reason },
    );
    return response;
  }

  /**
   * Get delivery statistics
   */
  async getStats(dateFrom: Date, dateTo: Date): Promise<any> {
    const params = new URLSearchParams({
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    });
    const response = await this.client.request(
      "GET",
      `/delivery/deliveries/stats?${params}`,
    );
    return response;
  }
}

// =============================================================================
// HEALTHCARE CLIENT
// =============================================================================

export class HealthcareClient {
  constructor(private client: UbiClient) {}

  /**
   * Register a healthcare provider
   */
  async registerProvider(providerData: any): Promise<any> {
    const response = await this.client.request(
      "POST",
      "/healthcare/providers",
      providerData,
    );
    return response;
  }

  /**
   * List healthcare providers
   */
  async listProviders(
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<any>> {
    const params = new URLSearchParams();
    if (pagination?.page) {
      params.append("page", pagination.page.toString());
    }
    if (pagination?.limit) {
      params.append("limit", pagination.limit.toString());
    }

    const query = params.toString();
    const response = await this.client.request(
      "GET",
      `/healthcare/providers${query ? `?${query}` : ""}`,
    );
    return response;
  }

  /**
   * Create a medical delivery
   */
  async createDelivery(delivery: any): Promise<any> {
    const response = await this.client.request(
      "POST",
      "/healthcare/deliveries",
      delivery,
    );
    return response;
  }

  /**
   * List medical deliveries
   */
  async listDeliveries(
    filters?: { providerId?: string; status?: string; deliveryType?: string },
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<any>> {
    const params = new URLSearchParams();
    if (filters?.providerId) {
      params.append("providerId", filters.providerId);
    }
    if (filters?.status) {
      params.append("status", filters.status);
    }
    if (filters?.deliveryType) {
      params.append("deliveryType", filters.deliveryType);
    }
    if (pagination?.page) {
      params.append("page", pagination.page.toString());
    }
    if (pagination?.limit) {
      params.append("limit", pagination.limit.toString());
    }

    const query = params.toString();
    const response = await this.client.request(
      "GET",
      `/healthcare/deliveries${query ? `?${query}` : ""}`,
    );
    return response;
  }

  /**
   * Create patient transport
   */
  async createPatientTransport(transport: any): Promise<any> {
    const response = await this.client.request(
      "POST",
      "/healthcare/patient-transport",
      transport,
    );
    return response;
  }

  /**
   * List patient transports
   */
  async listPatientTransports(
    filters?: { providerId?: string; status?: string },
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<any>> {
    const params = new URLSearchParams();
    if (filters?.providerId) {
      params.append("providerId", filters.providerId);
    }
    if (filters?.status) {
      params.append("status", filters.status);
    }
    if (pagination?.page) {
      params.append("page", pagination.page.toString());
    }
    if (pagination?.limit) {
      params.append("limit", pagination.limit.toString());
    }

    const query = params.toString();
    const response = await this.client.request(
      "GET",
      `/healthcare/patient-transport${query ? `?${query}` : ""}`,
    );
    return response;
  }
}

// =============================================================================
// SCHOOL CLIENT
// =============================================================================

export class SchoolClient {
  constructor(private client: UbiClient) {}

  /**
   * Register a school
   */
  async registerSchool(schoolData: any): Promise<any> {
    const response = await this.client.request(
      "POST",
      "/school/schools",
      schoolData,
    );
    return response;
  }

  /**
   * Get school by ID
   */
  async getSchool(schoolId: string): Promise<any> {
    const response = await this.client.request(
      "GET",
      `/school/schools/${schoolId}`,
    );
    return response;
  }

  /**
   * Register a student
   */
  async registerStudent(schoolId: string, studentData: any): Promise<any> {
    const response = await this.client.request(
      "POST",
      `/school/schools/${schoolId}/students`,
      studentData,
    );
    return response;
  }

  /**
   * List students
   */
  async listStudents(
    schoolId: string,
    filters?: { grade?: string; className?: string; routeId?: string },
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<any>> {
    const params = new URLSearchParams();
    if (filters?.grade) {
      params.append("grade", filters.grade);
    }
    if (filters?.className) {
      params.append("className", filters.className);
    }
    if (filters?.routeId) {
      params.append("routeId", filters.routeId);
    }
    if (pagination?.page) {
      params.append("page", pagination.page.toString());
    }
    if (pagination?.limit) {
      params.append("limit", pagination.limit.toString());
    }

    const query = params.toString();
    const response = await this.client.request(
      "GET",
      `/school/schools/${schoolId}/students${query ? `?${query}` : ""}`,
    );
    return response;
  }

  /**
   * Create a route
   */
  async createRoute(schoolId: string, routeData: any): Promise<any> {
    const response = await this.client.request(
      "POST",
      `/school/schools/${schoolId}/routes`,
      routeData,
    );
    return response;
  }

  /**
   * List routes
   */
  async listRoutes(schoolId: string, type?: string): Promise<any[]> {
    const params = type ? `?type=${type}` : "";
    const response = await this.client.request(
      "GET",
      `/school/schools/${schoolId}/routes${params}`,
    );
    return response;
  }

  /**
   * Start a route
   */
  async startRoute(routeId: string, driverInfo: any): Promise<any> {
    const response = await this.client.request(
      "POST",
      `/school/routes/${routeId}/start`,
      driverInfo,
    );
    return response;
  }

  /**
   * Record student pickup
   */
  async recordPickup(activeRouteId: string, data: any): Promise<any> {
    const response = await this.client.request(
      "POST",
      `/school/active-routes/${activeRouteId}/pickup`,
      data,
    );
    return response;
  }

  /**
   * Record student dropoff
   */
  async recordDropoff(activeRouteId: string, data: any): Promise<any> {
    const response = await this.client.request(
      "POST",
      `/school/active-routes/${activeRouteId}/dropoff`,
      data,
    );
    return response;
  }

  /**
   * Complete a route
   */
  async completeRoute(activeRouteId: string): Promise<any> {
    const response = await this.client.request(
      "POST",
      `/school/active-routes/${activeRouteId}/complete`,
    );
    return response;
  }

  /**
   * Get student location
   */
  async getStudentLocation(studentId: string): Promise<any> {
    const response = await this.client.request(
      "GET",
      `/school/students/${studentId}/location`,
    );
    return response;
  }

  /**
   * Get student trip history
   */
  async getStudentTrips(
    studentId: string,
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<any[]> {
    const params = new URLSearchParams();
    if (dateFrom) {
      params.append("dateFrom", dateFrom.toISOString());
    }
    if (dateTo) {
      params.append("dateTo", dateTo.toISOString());
    }

    const query = params.toString();
    const response = await this.client.request(
      "GET",
      `/school/students/${studentId}/trips${query ? `?${query}` : ""}`,
    );
    return response;
  }
}

// =============================================================================
// CORPORATE CLIENT
// =============================================================================

export class CorporateClient {
  constructor(private client: UbiClient) {}

  /**
   * Get organization details
   */
  async getOrganization(): Promise<any> {
    const response = await this.client.request(
      "GET",
      "/corporate/organization",
    );
    return response;
  }

  /**
   * Update organization
   */
  async updateOrganization(updates: any): Promise<any> {
    const response = await this.client.request(
      "PATCH",
      "/corporate/organization",
      updates,
    );
    return response;
  }

  /**
   * List members
   */
  async listMembers(
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<any>> {
    const params = new URLSearchParams();
    if (pagination?.page) {
      params.append("page", pagination.page.toString());
    }
    if (pagination?.limit) {
      params.append("limit", pagination.limit.toString());
    }

    const query = params.toString();
    const response = await this.client.request(
      "GET",
      `/corporate/members${query ? `?${query}` : ""}`,
    );
    return response;
  }

  /**
   * Add a member
   */
  async addMember(memberData: any): Promise<any> {
    const response = await this.client.request(
      "POST",
      "/corporate/members",
      memberData,
    );
    return response;
  }

  /**
   * Update a member
   */
  async updateMember(memberId: string, updates: any): Promise<any> {
    const response = await this.client.request(
      "PATCH",
      `/corporate/members/${memberId}`,
      updates,
    );
    return response;
  }

  /**
   * Remove a member
   */
  async removeMember(memberId: string): Promise<void> {
    const response = await this.client.request(
      "DELETE",
      `/corporate/members/${memberId}`,
    );
    return response;
  }

  /**
   * List cost centers
   */
  async listCostCenters(): Promise<any[]> {
    const response = await this.client.request(
      "GET",
      "/corporate/cost-centers",
    );
    return response;
  }

  /**
   * Create a cost center
   */
  async createCostCenter(costCenterData: any): Promise<any> {
    const response = await this.client.request(
      "POST",
      "/corporate/cost-centers",
      costCenterData,
    );
    return response;
  }
}

// =============================================================================
// BILLING CLIENT
// =============================================================================

export class BillingClient {
  constructor(private client: UbiClient) {}

  /**
   * Get current subscription
   */
  async getSubscription(): Promise<any> {
    const response = await this.client.request("GET", "/billing/subscription");
    return response;
  }

  /**
   * Create subscription
   */
  async createSubscription(planId: string): Promise<any> {
    const response = await this.client.request(
      "POST",
      "/billing/subscription",
      { planId },
    );
    return response;
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(cancelImmediately?: boolean): Promise<any> {
    const response = await this.client.request(
      "POST",
      "/billing/subscription/cancel",
      {
        cancelImmediately,
      },
    );
    return response;
  }

  /**
   * Get usage summary
   */
  async getUsage(periodStart: Date, periodEnd: Date): Promise<any> {
    const params = new URLSearchParams({
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    });
    const response = await this.client.request(
      "GET",
      `/billing/usage?${params}`,
    );
    return response;
  }

  /**
   * List invoices
   */
  async listInvoices(
    status?: string,
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<any>> {
    const params = new URLSearchParams();
    if (status) {
      params.append("status", status);
    }
    if (pagination?.page) {
      params.append("page", pagination.page.toString());
    }
    if (pagination?.limit) {
      params.append("limit", pagination.limit.toString());
    }

    const query = params.toString();
    const response = await this.client.request(
      "GET",
      `/billing/invoices${query ? `?${query}` : ""}`,
    );
    return response;
  }

  /**
   * Get invoice by ID
   */
  async getInvoice(invoiceId: string): Promise<any> {
    const response = await this.client.request(
      "GET",
      `/billing/invoices/${invoiceId}`,
    );
    return response;
  }

  /**
   * Get credit balance
   */
  async getCreditBalance(): Promise<any> {
    const response = await this.client.request("GET", "/billing/credits");
    return response;
  }

  /**
   * Get credit transactions
   */
  async getCreditTransactions(
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<any>> {
    const params = new URLSearchParams();
    if (pagination?.page) {
      params.append("page", pagination.page.toString());
    }
    if (pagination?.limit) {
      params.append("limit", pagination.limit.toString());
    }

    const query = params.toString();
    const response = await this.client.request(
      "GET",
      `/billing/credits/transactions${query ? `?${query}` : ""}`,
    );
    return response;
  }

  /**
   * List payment methods
   */
  async listPaymentMethods(): Promise<any[]> {
    const response = await this.client.request(
      "GET",
      "/billing/payment-methods",
    );
    return response;
  }

  /**
   * Add payment method
   */
  async addPaymentMethod(method: any): Promise<any> {
    const response = await this.client.request(
      "POST",
      "/billing/payment-methods",
      method,
    );
    return response;
  }
}

// =============================================================================
// WEBHOOK CLIENT
// =============================================================================

export class WebhookClient {
  constructor(private client: UbiClient) {}

  /**
   * List webhooks
   */
  async list(): Promise<any[]> {
    const response = await this.client.request("GET", "/webhooks");
    return response;
  }

  /**
   * Create a webhook
   */
  async create(webhookData: {
    url: string;
    events: string[];
    description?: string;
    headers?: Record<string, string>;
  }): Promise<any> {
    const response = await this.client.request(
      "POST",
      "/webhooks",
      webhookData,
    );
    return response;
  }

  /**
   * Update a webhook
   */
  async update(webhookId: string, updates: any): Promise<any> {
    const response = await this.client.request(
      "PATCH",
      `/webhooks/${webhookId}`,
      updates,
    );
    return response;
  }

  /**
   * Delete a webhook
   */
  async delete(webhookId: string): Promise<void> {
    const response = await this.client.request(
      "DELETE",
      `/webhooks/${webhookId}`,
    );
    return response;
  }

  /**
   * Test a webhook
   */
  async test(webhookId: string): Promise<any> {
    const response = await this.client.request(
      "POST",
      `/webhooks/${webhookId}/test`,
    );
    return response;
  }

  /**
   * Get webhook deliveries
   */
  async getDeliveries(
    webhookId: string,
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<any>> {
    const params = new URLSearchParams();
    if (pagination?.page) {
      params.append("page", pagination.page.toString());
    }
    if (pagination?.limit) {
      params.append("limit", pagination.limit.toString());
    }

    const query = params.toString();
    const response = await this.client.request(
      "GET",
      `/webhooks/${webhookId}/deliveries${query ? `?${query}` : ""}`,
    );
    return response;
  }

  /**
   * Verify webhook signature
   */
  verifySignature(
    payload: string,
    signature: string,
    secret: string,
    tolerance: number = 300,
  ): boolean {
    try {
      const parts = signature.split(",");
      const timestampPart = parts.find((p) => p.startsWith("t="));
      const signaturePart = parts.find((p) => p.startsWith("v1="));

      if (!timestampPart || !signaturePart) {
        return false;
      }

      const timestamp = Number.parseInt(timestampPart.substring(2), 10);
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
        Buffer.from(computedSignature),
      );
    } catch {
      return false;
    }
  }

  /**
   * Parse webhook event
   */
  parseEvent(payload: string, signature: string, secret: string): WebhookEvent {
    if (!this.verifySignature(payload, signature, secret)) {
      throw new Error("Invalid webhook signature");
    }

    return JSON.parse(payload);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default UbiClient;

// Factory function for convenience
export function createUbiClient(config: UbiConfig): UbiClient {
  return new UbiClient(config);
}
