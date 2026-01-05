/**
 * UBI Delivery API Service
 *
 * Last-mile delivery platform for B2B customers including:
 * - Quote generation
 * - Single and batch delivery creation
 * - Real-time tracking
 * - Proof of delivery
 * - Driver assignment
 */

import crypto from "crypto";
import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import type {
  BatchDeliveryRequest,
  BatchDeliveryResult,
  Coordinates,
  CreateDeliveryRequest,
  Delivery,
  DeliveryPriority,
  DeliveryQuote,
  DeliveryQuoteRequest,
  DeliverySchedule,
  DeliveryStatus,
  DriverInfo,
  PackageSize,
  PaginatedResponse,
  PaginationParams,
} from "../types/b2b.types";

// =============================================================================
// DELIVERY CONFIGURATION
// =============================================================================

interface DeliveryPricingConfig {
  currency: string;
  baseRates: Record<DeliveryPriority, number>;
  sizeMultipliers: Record<PackageSize, number>;
  perKmRate: number;
  insuranceRate: number;
  codFee: number;
  taxRate: number;
}

const DEFAULT_PRICING_CONFIG: DeliveryPricingConfig = {
  currency: "NGN",
  baseRates: {
    ECONOMY: 500,
    STANDARD: 800,
    EXPRESS: 1200,
    SAME_DAY: 1500,
    INSTANT: 2000,
    SCHEDULED: 700,
  },
  sizeMultipliers: {
    ENVELOPE: 1.0,
    SMALL: 1.2,
    MEDIUM: 1.5,
    LARGE: 2.0,
    XLARGE: 3.0,
    CUSTOM: 2.5,
  },
  perKmRate: 50,
  insuranceRate: 0.01, // 1% of declared value
  codFee: 100, // Fixed COD handling fee
  taxRate: 0.075, // 7.5% VAT
};

// =============================================================================
// DELIVERY STATUS MACHINE
// =============================================================================

const VALID_STATUS_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING: ["QUOTED", "CANCELLED"],
  QUOTED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["DRIVER_ASSIGNED", "CANCELLED"],
  DRIVER_ASSIGNED: ["PICKUP_EN_ROUTE", "CANCELLED"],
  PICKUP_EN_ROUTE: ["AT_PICKUP", "CANCELLED"],
  AT_PICKUP: ["PICKED_UP", "FAILED", "CANCELLED"],
  PICKED_UP: ["IN_TRANSIT"],
  IN_TRANSIT: ["AT_DROPOFF"],
  AT_DROPOFF: ["DELIVERED", "FAILED"],
  DELIVERED: ["RETURNED"],
  FAILED: ["DRIVER_ASSIGNED", "CANCELLED", "RETURNED"],
  CANCELLED: [],
  RETURNED: [],
};

// =============================================================================
// INTERFACES
// =============================================================================

interface DeliveryStatusHistory {
  id: string;
  deliveryId: string;
  status: DeliveryStatus;
  location?: Coordinates;
  notes?: string;
  updatedBy?: string;
  createdAt: Date;
}

interface DeliveryBatch {
  id: string;
  organizationId: string;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  status: "processing" | "completed" | "partial_failure";
  deliveryIds: string[];
  createdAt: Date;
  completedAt?: Date;
}

interface DeliveryFilters {
  status?: DeliveryStatus;
  priority?: DeliveryPriority;
  driverId?: string;
  costCenterId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  externalId?: string;
  trackingCode?: string;
}

// =============================================================================
// DELIVERY API SERVICE
// =============================================================================

export class DeliveryApiService extends EventEmitter {
  private deliveries: Map<string, Delivery> = new Map();
  private statusHistory: Map<string, DeliveryStatusHistory[]> = new Map();
  private batches: Map<string, DeliveryBatch> = new Map();
  private quotes: Map<string, DeliveryQuote> = new Map();
  private pricingConfigs: Map<string, DeliveryPricingConfig> = new Map();

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  // ===========================================================================
  // QUOTE MANAGEMENT
  // ===========================================================================

  /**
   * Generate a delivery quote
   */
  async getQuote(
    organizationId: string,
    request: DeliveryQuoteRequest
  ): Promise<DeliveryQuote> {
    const config = this.getPricingConfig(organizationId);

    // Calculate distance
    const distance = this.calculateDistance(
      request.pickup.latitude && request.pickup.longitude
        ? { lat: request.pickup.latitude, lng: request.pickup.longitude }
        : await this.geocodeAddress(request.pickup.address),
      request.dropoff.latitude && request.dropoff.longitude
        ? { lat: request.dropoff.latitude, lng: request.dropoff.longitude }
        : await this.geocodeAddress(request.dropoff.address)
    );

    // Calculate pricing
    const priority = request.priority || "STANDARD";
    const size = request.package?.size || "SMALL";

    const basePrice = config.baseRates[priority];
    const sizeMultiplier = config.sizeMultipliers[size];
    const distancePrice = distance * config.perKmRate;

    const subtotal = basePrice * sizeMultiplier + distancePrice;
    const tax = subtotal * config.taxRate;
    const total = Math.round(subtotal + tax);

    // Estimate duration based on distance and priority
    const estimatedDurationMins = this.estimateDeliveryDuration(
      distance,
      priority
    );

    const quote: DeliveryQuote = {
      id: nanoid(),
      price: total,
      currency: config.currency,
      distanceKm: Math.round(distance * 10) / 10,
      estimatedDurationMins,
      priority,
      breakdown: {
        basePrice: Math.round(basePrice * sizeMultiplier),
        distancePrice: Math.round(distancePrice),
        priorityFee:
          priority === "INSTANT" ? 500 : priority === "EXPRESS" ? 300 : 0,
        insuranceFee: 0,
        tax: Math.round(tax),
      },
      validUntil: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
    };

    this.quotes.set(quote.id, quote);

    return quote;
  }

  /**
   * Get multi-destination quotes
   */
  async getMultiQuote(
    organizationId: string,
    pickup: { address: string; latitude?: number; longitude?: number },
    dropoffs: { address: string; latitude?: number; longitude?: number }[]
  ): Promise<{ quotes: DeliveryQuote[]; totalPrice: number }> {
    const quotes: DeliveryQuote[] = [];
    let totalPrice = 0;

    for (const dropoff of dropoffs) {
      const quote = await this.getQuote(organizationId, {
        pickup,
        dropoff,
        package: { size: "SMALL" },
        priority: "STANDARD",
      });
      quotes.push(quote);
      totalPrice += quote.price;
    }

    return { quotes, totalPrice };
  }

  // ===========================================================================
  // DELIVERY CREATION
  // ===========================================================================

  /**
   * Create a single delivery
   */
  async createDelivery(
    organizationId: string,
    request: CreateDeliveryRequest,
    _memberId?: string
  ): Promise<Delivery> {
    // Generate tracking code
    const trackingCode = this.generateTrackingCode(organizationId);

    // Geocode addresses if needed
    const pickupCoords =
      request.pickup.latitude && request.pickup.longitude
        ? { lat: request.pickup.latitude, lng: request.pickup.longitude }
        : await this.geocodeAddress(request.pickup.address);

    const dropoffCoords =
      request.dropoff.latitude && request.dropoff.longitude
        ? { lat: request.dropoff.latitude, lng: request.dropoff.longitude }
        : await this.geocodeAddress(request.dropoff.address);

    // Calculate quote if not provided
    const quote = await this.getQuote(organizationId, {
      pickup: { address: request.pickup.address, ...pickupCoords },
      dropoff: { address: request.dropoff.address, ...dropoffCoords },
      package: {
        size: request.package?.size,
        weight_kg: request.package?.weight_kg,
      },
      priority: request.options?.priority,
    });

    // Build delivery object
    const delivery: Delivery = {
      id: nanoid(),
      organizationId,
      externalId: request.external_id,
      trackingCode,
      status: "PENDING",
      priority: request.options?.priority || "STANDARD",
      pickup: {
        address: request.pickup.address,
        coordinates: pickupCoords,
        plusCode: request.pickup.plus_code,
        contactName: request.pickup.contact_name,
        contactPhone: request.pickup.contact_phone,
        instructions: request.pickup.instructions,
      },
      dropoff: {
        address: request.dropoff.address,
        coordinates: dropoffCoords,
        plusCode: request.dropoff.plus_code,
        contactName: request.dropoff.contact_name,
        contactPhone: request.dropoff.contact_phone,
        instructions: request.dropoff.instructions,
      },
      recipient: {
        name: request.recipient?.name || request.dropoff.contact_name!,
        phone: request.recipient?.phone || request.dropoff.contact_phone!,
        email: request.recipient?.email,
      },
      package: {
        size: request.package?.size || "SMALL",
        weightKg: request.package?.weight_kg,
        description: request.package?.description,
        value: request.package?.value,
        isFragile: request.package?.fragile || false,
        requiresSignature: request.package?.requires_signature || false,
      },
      schedule: this.parseSchedule(request.schedule),
      options: {
        priority: request.options?.priority || "STANDARD",
        cashOnDelivery: request.options?.cash_on_delivery,
        proofOfDeliveryType: request.options?.proof_of_delivery || "PHOTO",
        insurance: request.options?.insurance || false,
        insuranceAmount: request.options?.insurance_amount,
        ageVerification: request.options?.age_verification,
      },
      pricing: {
        quotedPrice: quote.price,
        currency: quote.currency,
        distanceKm: quote.distanceKm,
        estimatedDurationMins: quote.estimatedDurationMins,
        breakdown: {
          ...quote.breakdown,
          codFee: request.options?.cash_on_delivery ? 100 : 0,
        },
      },
      timestamps: {
        quotedAt: new Date(),
      },
      metadata: request.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.deliveries.set(delivery.id, delivery);

    // Create initial status history entry
    await this.addStatusHistory(
      delivery.id,
      "PENDING",
      undefined,
      "Delivery created"
    );

    this.emit("delivery:created", delivery);

    return delivery;
  }

  /**
   * Create multiple deliveries in batch
   */
  async createBatchDeliveries(
    organizationId: string,
    request: BatchDeliveryRequest,
    memberId?: string
  ): Promise<BatchDeliveryResult> {
    const batch: DeliveryBatch = {
      id: nanoid(),
      organizationId,
      totalDeliveries: request.deliveries.length,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      status: "processing",
      deliveryIds: [],
      createdAt: new Date(),
    };

    this.batches.set(batch.id, batch);

    const results: BatchDeliveryResult["results"] = [];

    for (let i = 0; i < request.deliveries.length; i++) {
      try {
        const deliveryRequest = request.deliveries[i];
        if (!deliveryRequest) continue;
        const delivery = await this.createDelivery(
          organizationId,
          deliveryRequest,
          memberId
        );
        batch.successfulDeliveries++;
        batch.deliveryIds.push(delivery.id);
        results.push({
          index: i,
          success: true,
          delivery,
        });
      } catch (error) {
        batch.failedDeliveries++;
        results.push({
          index: i,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    batch.status =
      batch.failedDeliveries === 0
        ? "completed"
        : batch.successfulDeliveries === 0
          ? "partial_failure"
          : "partial_failure";
    batch.completedAt = new Date();

    this.batches.set(batch.id, batch);

    this.emit("batch:completed", batch);

    return {
      total: request.deliveries.length,
      successful: batch.successfulDeliveries,
      failed: batch.failedDeliveries,
      results,
    };
  }

  // ===========================================================================
  // DELIVERY OPERATIONS
  // ===========================================================================

  /**
   * Confirm a delivery (move from QUOTED to CONFIRMED)
   */
  async confirmDelivery(deliveryId: string): Promise<Delivery> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) {
      throw new Error("Delivery not found");
    }

    await this.updateDeliveryStatus(
      deliveryId,
      "CONFIRMED",
      undefined,
      "Delivery confirmed"
    );

    delivery.timestamps.confirmedAt = new Date();
    delivery.updatedAt = new Date();
    this.deliveries.set(deliveryId, delivery);

    // Trigger driver matching
    this.emit("delivery:confirmed", delivery);
    this.matchDriver(delivery);

    return delivery;
  }

  /**
   * Assign a driver to a delivery
   */
  async assignDriver(
    deliveryId: string,
    driverInfo: DriverInfo
  ): Promise<Delivery> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) {
      throw new Error("Delivery not found");
    }

    delivery.driver = driverInfo;
    delivery.timestamps.driverAssignedAt = new Date();
    delivery.updatedAt = new Date();

    await this.updateDeliveryStatus(
      deliveryId,
      "DRIVER_ASSIGNED",
      driverInfo.location,
      `Driver ${driverInfo.name} assigned`
    );

    this.deliveries.set(deliveryId, delivery);

    this.emit("delivery:driver_assigned", delivery);

    return delivery;
  }

  /**
   * Update delivery status
   */
  async updateDeliveryStatus(
    deliveryId: string,
    newStatus: DeliveryStatus,
    location?: Coordinates,
    notes?: string,
    updatedBy?: string
  ): Promise<Delivery> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) {
      throw new Error("Delivery not found");
    }

    // Validate status transition
    const allowedTransitions = VALID_STATUS_TRANSITIONS[delivery.status];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(
        `Invalid status transition from ${delivery.status} to ${newStatus}`
      );
    }

    const oldStatus = delivery.status;
    delivery.status = newStatus;
    delivery.updatedAt = new Date();

    // Update timestamps
    this.updateDeliveryTimestamp(delivery, newStatus);

    // Update driver location if provided
    if (location && delivery.driver) {
      delivery.driver.location = location;
    }

    this.deliveries.set(deliveryId, delivery);

    // Add to status history
    await this.addStatusHistory(
      deliveryId,
      newStatus,
      location,
      notes,
      updatedBy
    );

    // Emit status change event
    this.emit(`delivery:${newStatus.toLowerCase()}`, delivery);
    this.emit("delivery:status_changed", {
      delivery,
      oldStatus,
      newStatus,
      location,
      notes,
    });

    return delivery;
  }

  /**
   * Record proof of delivery
   */
  async recordProofOfDelivery(
    deliveryId: string,
    proof: {
      photoUrl?: string;
      signatureUrl?: string;
      otpVerified?: boolean;
      recipientName?: string;
    }
  ): Promise<Delivery> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) {
      throw new Error("Delivery not found");
    }

    delivery.proofOfDelivery = {
      type: delivery.options.proofOfDeliveryType,
      ...proof,
      verifiedAt: new Date(),
    };

    delivery.updatedAt = new Date();
    this.deliveries.set(deliveryId, delivery);

    this.emit("delivery:proof_recorded", delivery);

    return delivery;
  }

  /**
   * Mark delivery as delivered
   */
  async completeDelivery(
    deliveryId: string,
    proof?: {
      photoUrl?: string;
      signatureUrl?: string;
      otpVerified?: boolean;
      recipientName?: string;
    },
    finalLocation?: Coordinates
  ): Promise<Delivery> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) {
      throw new Error("Delivery not found");
    }

    // Verify proof of delivery if required
    if (delivery.options.proofOfDeliveryType !== "NONE" && !proof) {
      throw new Error("Proof of delivery is required");
    }

    if (proof) {
      await this.recordProofOfDelivery(deliveryId, proof);
    }

    delivery.pricing.finalPrice = delivery.pricing.quotedPrice;

    await this.updateDeliveryStatus(
      deliveryId,
      "DELIVERED",
      finalLocation,
      `Delivered to ${proof?.recipientName || delivery.recipient.name}`
    );

    this.emit("delivery:completed", delivery);

    return delivery;
  }

  /**
   * Mark delivery as failed
   */
  async failDelivery(
    deliveryId: string,
    reason: string,
    location?: Coordinates
  ): Promise<Delivery> {
    await this.updateDeliveryStatus(deliveryId, "FAILED", location, reason);

    const delivery = this.deliveries.get(deliveryId)!;
    this.emit("delivery:failed", { delivery, reason });

    return delivery;
  }

  /**
   * Cancel a delivery
   */
  async cancelDelivery(
    deliveryId: string,
    reason: string,
    cancelledBy?: string
  ): Promise<Delivery> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) {
      throw new Error("Delivery not found");
    }

    // Check if delivery can be cancelled
    const nonCancellableStatuses: DeliveryStatus[] = [
      "DELIVERED",
      "CANCELLED",
      "RETURNED",
    ];
    if (nonCancellableStatuses.includes(delivery.status)) {
      throw new Error(`Cannot cancel delivery in ${delivery.status} status`);
    }

    await this.updateDeliveryStatus(
      deliveryId,
      "CANCELLED",
      undefined,
      reason,
      cancelledBy
    );

    this.emit("delivery:cancelled", { delivery, reason, cancelledBy });

    return delivery;
  }

  // ===========================================================================
  // DELIVERY QUERIES
  // ===========================================================================

  /**
   * Get delivery by ID
   */
  async getDelivery(deliveryId: string): Promise<Delivery | null> {
    return this.deliveries.get(deliveryId) || null;
  }

  /**
   * Get delivery by tracking code
   */
  async getDeliveryByTrackingCode(
    trackingCode: string
  ): Promise<Delivery | null> {
    return (
      Array.from(this.deliveries.values()).find(
        (d) => d.trackingCode === trackingCode
      ) || null
    );
  }

  /**
   * Get delivery by external ID
   */
  async getDeliveryByExternalId(
    organizationId: string,
    externalId: string
  ): Promise<Delivery | null> {
    return (
      Array.from(this.deliveries.values()).find(
        (d) =>
          d.organizationId === organizationId && d.externalId === externalId
      ) || null
    );
  }

  /**
   * List deliveries for an organization
   */
  async listDeliveries(
    organizationId: string,
    filters: DeliveryFilters,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<Delivery>> {
    let deliveries = Array.from(this.deliveries.values()).filter(
      (d) => d.organizationId === organizationId
    );

    // Apply filters
    if (filters.status) {
      deliveries = deliveries.filter((d) => d.status === filters.status);
    }
    if (filters.priority) {
      deliveries = deliveries.filter((d) => d.priority === filters.priority);
    }
    if (filters.driverId) {
      deliveries = deliveries.filter((d) => d.driver?.id === filters.driverId);
    }
    if (filters.dateFrom) {
      deliveries = deliveries.filter((d) => d.createdAt >= filters.dateFrom!);
    }
    if (filters.dateTo) {
      deliveries = deliveries.filter((d) => d.createdAt <= filters.dateTo!);
    }
    if (filters.externalId) {
      deliveries = deliveries.filter(
        (d) => d.externalId === filters.externalId
      );
    }
    if (filters.trackingCode) {
      deliveries = deliveries.filter((d) =>
        d.trackingCode
          .toLowerCase()
          .includes(filters.trackingCode!.toLowerCase())
      );
    }

    // Sort by creation date descending
    deliveries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return this.paginate(deliveries, pagination);
  }

  /**
   * Get delivery status history
   */
  async getDeliveryHistory(
    deliveryId: string
  ): Promise<DeliveryStatusHistory[]> {
    return this.statusHistory.get(deliveryId) || [];
  }

  /**
   * Get active deliveries for a driver
   */
  async getDriverActiveDeliveries(driverId: string): Promise<Delivery[]> {
    const activeStatuses: DeliveryStatus[] = [
      "DRIVER_ASSIGNED",
      "PICKUP_EN_ROUTE",
      "AT_PICKUP",
      "PICKED_UP",
      "IN_TRANSIT",
      "AT_DROPOFF",
    ];

    return Array.from(this.deliveries.values())
      .filter(
        (d) => d.driver?.id === driverId && activeStatuses.includes(d.status)
      )
      .sort(
        (a, b) =>
          (a.timestamps.driverAssignedAt?.getTime() || 0) -
          (b.timestamps.driverAssignedAt?.getTime() || 0)
      );
  }

  // ===========================================================================
  // TRACKING
  // ===========================================================================

  /**
   * Get real-time tracking info (public endpoint)
   */
  async getTrackingInfo(trackingCode: string): Promise<{
    trackingCode: string;
    status: DeliveryStatus;
    statusText: string;
    estimatedDelivery?: Date;
    driverLocation?: Coordinates;
    lastUpdate: Date;
    timeline: {
      status: string;
      timestamp: Date;
      location?: Coordinates;
    }[];
  } | null> {
    const delivery = await this.getDeliveryByTrackingCode(trackingCode);
    if (!delivery) {
      return null;
    }

    const history = await this.getDeliveryHistory(delivery.id);

    return {
      trackingCode: delivery.trackingCode,
      status: delivery.status,
      statusText: this.getStatusText(delivery.status),
      estimatedDelivery: this.calculateEstimatedDelivery(delivery),
      driverLocation: delivery.driver?.location,
      lastUpdate: delivery.updatedAt,
      timeline: history.map((h) => ({
        status: this.getStatusText(h.status),
        timestamp: h.createdAt,
        location: h.location,
      })),
    };
  }

  /**
   * Update driver location for active deliveries
   */
  async updateDriverLocation(
    driverId: string,
    location: Coordinates
  ): Promise<void> {
    const activeDeliveries = await this.getDriverActiveDeliveries(driverId);

    for (const delivery of activeDeliveries) {
      if (delivery.driver) {
        delivery.driver.location = location;
        delivery.driver.location.lat = location.lat || 0;
        delivery.driver.location.lng = location.lng || 0;
        delivery.updatedAt = new Date();
        this.deliveries.set(delivery.id, delivery);

        this.emit("delivery:driver_location_updated", {
          delivery,
          location,
        });
      }
    }
  }

  // ===========================================================================
  // ANALYTICS
  // ===========================================================================

  /**
   * Get delivery statistics for an organization
   */
  async getDeliveryStats(
    organizationId: string,
    dateFrom: Date,
    dateTo: Date
  ): Promise<{
    total: number;
    delivered: number;
    failed: number;
    cancelled: number;
    inProgress: number;
    avgDeliveryTime: number;
    avgDistance: number;
    totalRevenue: number;
    byPriority: Record<DeliveryPriority, number>;
    byStatus: Record<DeliveryStatus, number>;
    dailyVolume: { date: string; count: number; revenue: number }[];
  }> {
    const deliveries = Array.from(this.deliveries.values()).filter(
      (d) =>
        d.organizationId === organizationId &&
        d.createdAt >= dateFrom &&
        d.createdAt <= dateTo
    );

    const byPriority: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const dailyVolume: Map<string, { count: number; revenue: number }> =
      new Map();

    let totalDeliveryTime = 0;
    let deliveredCount = 0;
    let totalDistance = 0;
    let totalRevenue = 0;

    for (const delivery of deliveries) {
      // Count by priority
      byPriority[delivery.priority] = (byPriority[delivery.priority] || 0) + 1;

      // Count by status
      byStatus[delivery.status] = (byStatus[delivery.status] || 0) + 1;

      // Calculate delivery time for completed deliveries
      if (delivery.status === "DELIVERED" && delivery.timestamps.deliveredAt) {
        const deliveryTime =
          delivery.timestamps.deliveredAt.getTime() -
          delivery.createdAt.getTime();
        totalDeliveryTime += deliveryTime;
        deliveredCount++;
      }

      // Sum distance and revenue
      totalDistance += delivery.pricing.distanceKm || 0;
      totalRevenue +=
        delivery.pricing.finalPrice || delivery.pricing.quotedPrice || 0;

      // Daily volume
      const dateKey = delivery.createdAt.toISOString().split("T")[0] || "";
      const daily = dailyVolume.get(dateKey) || { count: 0, revenue: 0 };
      daily.count++;
      daily.revenue +=
        delivery.pricing.finalPrice || delivery.pricing.quotedPrice || 0;
      if (dateKey) {
        dailyVolume.set(dateKey, daily);
      }
    }

    const inProgressStatuses: DeliveryStatus[] = [
      "PENDING",
      "QUOTED",
      "CONFIRMED",
      "DRIVER_ASSIGNED",
      "PICKUP_EN_ROUTE",
      "AT_PICKUP",
      "PICKED_UP",
      "IN_TRANSIT",
      "AT_DROPOFF",
    ];

    return {
      total: deliveries.length,
      delivered: byStatus["DELIVERED"] || 0,
      failed: byStatus["FAILED"] || 0,
      cancelled: byStatus["CANCELLED"] || 0,
      inProgress: inProgressStatuses.reduce(
        (sum, s) => sum + (byStatus[s] || 0),
        0
      ),
      avgDeliveryTime:
        deliveredCount > 0
          ? Math.round(totalDeliveryTime / deliveredCount / 60000)
          : 0, // in minutes
      avgDistance:
        deliveries.length > 0
          ? Math.round((totalDistance / deliveries.length) * 10) / 10
          : 0,
      totalRevenue: Math.round(totalRevenue),
      byPriority: byPriority as Record<DeliveryPriority, number>,
      byStatus: byStatus as Record<DeliveryStatus, number>,
      dailyVolume: Array.from(dailyVolume.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  // ===========================================================================
  // PRICING CONFIGURATION
  // ===========================================================================

  /**
   * Set custom pricing for an organization
   */
  setOrganizationPricing(
    organizationId: string,
    config: Partial<DeliveryPricingConfig>
  ): void {
    const currentConfig = this.getPricingConfig(organizationId);
    this.pricingConfigs.set(organizationId, {
      ...currentConfig,
      ...config,
    });
  }

  /**
   * Get pricing config for an organization
   */
  getPricingConfig(organizationId: string): DeliveryPricingConfig {
    return this.pricingConfigs.get(organizationId) || DEFAULT_PRICING_CONFIG;
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private generateTrackingCode(_organizationId: string): string {
    const prefix = "UBI";
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(3).toString("hex").toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }

  private async geocodeAddress(_address: string): Promise<Coordinates> {
    // Simplified geocoding - in production, use actual geocoding service
    // Return placeholder coordinates for Lagos
    return {
      lat: 6.5244 + (Math.random() - 0.5) * 0.1,
      lng: 3.3792 + (Math.random() - 0.5) * 0.1,
    };
  }

  private calculateDistance(from: Coordinates, to: Coordinates): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(to.lat - from.lat);
    const dLng = this.toRad(to.lng - from.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(from.lat)) *
        Math.cos(this.toRad(to.lat)) *
        Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private estimateDeliveryDuration(
    distanceKm: number,
    priority: DeliveryPriority
  ): number {
    const baseMinutes = {
      ECONOMY: 180,
      STANDARD: 120,
      EXPRESS: 60,
      SAME_DAY: 240,
      INSTANT: 45,
      SCHEDULED: 90,
    };

    const base = baseMinutes[priority];
    const travelTime = Math.round(distanceKm * 3); // ~3 min per km in traffic

    return base + travelTime;
  }

  private parseSchedule(
    schedule?: CreateDeliveryRequest["schedule"]
  ): DeliverySchedule | undefined {
    if (!schedule) return undefined;

    return {
      pickupTime: schedule.pickup_time
        ? new Date(schedule.pickup_time)
        : undefined,
      pickupWindowStart: schedule.pickup_window_start
        ? new Date(schedule.pickup_window_start)
        : undefined,
      pickupWindowEnd: schedule.pickup_window_end
        ? new Date(schedule.pickup_window_end)
        : undefined,
      dropoffTime: schedule.dropoff_time
        ? new Date(schedule.dropoff_time)
        : undefined,
      dropoffWindowStart: schedule.dropoff_window_start
        ? new Date(schedule.dropoff_window_start)
        : undefined,
      dropoffWindowEnd: schedule.dropoff_window_end
        ? new Date(schedule.dropoff_window_end)
        : undefined,
    };
  }

  private updateDeliveryTimestamp(
    delivery: Delivery,
    status: DeliveryStatus
  ): void {
    const now = new Date();
    switch (status) {
      case "QUOTED":
        delivery.timestamps.quotedAt = now;
        break;
      case "CONFIRMED":
        delivery.timestamps.confirmedAt = now;
        break;
      case "DRIVER_ASSIGNED":
        delivery.timestamps.driverAssignedAt = now;
        break;
      case "PICKUP_EN_ROUTE":
        delivery.timestamps.pickupEnRouteAt = now;
        break;
      case "AT_PICKUP":
        delivery.timestamps.atPickupAt = now;
        break;
      case "PICKED_UP":
        delivery.timestamps.pickedUpAt = now;
        break;
      case "IN_TRANSIT":
        delivery.timestamps.inTransitAt = now;
        break;
      case "AT_DROPOFF":
        delivery.timestamps.atDropoffAt = now;
        break;
      case "DELIVERED":
        delivery.timestamps.deliveredAt = now;
        break;
      case "FAILED":
        delivery.timestamps.failedAt = now;
        break;
      case "CANCELLED":
        delivery.timestamps.cancelledAt = now;
        break;
      case "RETURNED":
        delivery.timestamps.returnedAt = now;
        break;
    }
  }

  private async addStatusHistory(
    deliveryId: string,
    status: DeliveryStatus,
    location?: Coordinates,
    notes?: string,
    updatedBy?: string
  ): Promise<void> {
    const history = this.statusHistory.get(deliveryId) || [];

    history.push({
      id: nanoid(),
      deliveryId,
      status,
      location,
      notes,
      updatedBy,
      createdAt: new Date(),
    });

    this.statusHistory.set(deliveryId, history);
  }

  private getStatusText(status: DeliveryStatus): string {
    const statusTexts: Record<DeliveryStatus, string> = {
      PENDING: "Order Placed",
      QUOTED: "Quote Generated",
      CONFIRMED: "Confirmed",
      DRIVER_ASSIGNED: "Driver Assigned",
      PICKUP_EN_ROUTE: "Driver En Route to Pickup",
      AT_PICKUP: "Driver at Pickup Location",
      PICKED_UP: "Package Picked Up",
      IN_TRANSIT: "In Transit",
      AT_DROPOFF: "Arriving at Destination",
      DELIVERED: "Delivered",
      FAILED: "Delivery Failed",
      CANCELLED: "Cancelled",
      RETURNED: "Returned to Sender",
    };
    return statusTexts[status] || status;
  }

  private calculateEstimatedDelivery(delivery: Delivery): Date | undefined {
    if (delivery.schedule?.dropoffTime) {
      return delivery.schedule.dropoffTime;
    }

    if (delivery.pricing.estimatedDurationMins) {
      return new Date(
        delivery.createdAt.getTime() +
          delivery.pricing.estimatedDurationMins * 60 * 1000
      );
    }

    return undefined;
  }

  private async matchDriver(delivery: Delivery): Promise<void> {
    // Simplified driver matching - in production, use actual matching algorithm
    setTimeout(() => {
      const mockDriver: DriverInfo = {
        id: nanoid(),
        name: "John Driver",
        phone: "+2348012345678",
        vehicleType: "motorcycle",
        vehiclePlate: "LAG-123-XY",
        rating: 4.8,
        location: delivery.pickup.coordinates || { lat: 0, lng: 0 },
      };

      this.assignDriver(delivery.id, mockDriver).catch(console.error);
    }, 5000);
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

export const deliveryApiService = new DeliveryApiService();
