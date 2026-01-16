/**
 * Delivery Service API
 *
 * API client for package delivery operations (UBI Send).
 */

import { type ApiClient, getApiClient } from "../client";
import type {
  Address,
  ApiResponse,
  Coordinates,
  Money,
  PaginatedResponse,
  PaginationParams,
  Timestamps,
} from "../types";

// Delivery types
export type DeliveryStatus =
  | "draft"
  | "pending"
  | "confirmed"
  | "pickup_assigned"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "failed";

export type PackageSize = "small" | "medium" | "large" | "extra_large";
export type PackageType = "document" | "parcel" | "fragile" | "food" | "other";
export type DeliveryPriority =
  | "standard"
  | "express"
  | "same_day"
  | "scheduled";

export interface Delivery extends Timestamps {
  id: string;
  trackingNumber: string;
  senderId: string;
  sender: ContactInfo;
  recipient: ContactInfo;
  pickup: Address;
  dropoff: Address;
  status: DeliveryStatus;
  priority: DeliveryPriority;
  package: PackageInfo;
  pricing: DeliveryPricing;
  paymentMethod: string;
  paymentStatus: "pending" | "paid" | "refunded";
  driverId?: string;
  driverLocation?: Coordinates;
  estimatedPickupTime?: string;
  actualPickupTime?: string;
  estimatedDeliveryTime?: string;
  actualDeliveryTime?: string;
  proofOfDelivery?: ProofOfDelivery;
  notes?: string;
  cancelReason?: string;
  timeline: DeliveryEvent[];
}

export interface ContactInfo {
  name: string;
  phone: string;
  email?: string;
}

export interface PackageInfo {
  size: PackageSize;
  type: PackageType;
  weight?: number; // kg
  dimensions?: {
    length: number;
    width: number;
    height: number;
    unit: "cm" | "in";
  };
  description?: string;
  value?: Money;
  isFragile: boolean;
  requiresSignature: boolean;
  insuranceRequired: boolean;
}

export interface DeliveryPricing {
  baseFare: Money;
  distanceFare: Money;
  sizeFare: Money;
  priorityFare?: Money;
  insuranceFee?: Money;
  discount?: Money;
  total: Money;
}

export interface ProofOfDelivery {
  signature?: string; // base64
  photoUrl?: string;
  recipientName?: string;
  deliveredAt: string;
  notes?: string;
}

export interface DeliveryEvent {
  status: DeliveryStatus;
  description: string;
  location?: Coordinates;
  timestamp: string;
}

// Request/Response types
export interface CreateDeliveryRequest {
  sender: ContactInfo;
  recipient: ContactInfo;
  pickup: {
    address: string;
    coordinates?: Coordinates;
    instructions?: string;
  };
  dropoff: {
    address: string;
    coordinates?: Coordinates;
    instructions?: string;
  };
  package: Omit<
    PackageInfo,
    "isFragile" | "requiresSignature" | "insuranceRequired"
  > & {
    isFragile?: boolean;
    requiresSignature?: boolean;
    insuranceRequired?: boolean;
  };
  priority: DeliveryPriority;
  paymentMethod: string;
  scheduledPickupTime?: string;
  promoCode?: string;
  notes?: string;
}

export interface DeliveryEstimateRequest {
  pickup: Coordinates;
  dropoff: Coordinates;
  package: {
    size: PackageSize;
    type: PackageType;
    weight?: number;
  };
  priority: DeliveryPriority;
}

export interface DeliveryEstimate {
  priority: DeliveryPriority;
  pricing: DeliveryPricing;
  estimatedPickupTime: { min: string; max: string };
  estimatedDeliveryTime: { min: string; max: string };
  available: boolean;
}

export interface DeliveryFilters extends PaginationParams {
  status?: DeliveryStatus;
  priority?: DeliveryPriority;
  senderId?: string;
  driverId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

// Delivery Service API
export class DeliveryServiceApi {
  private readonly client: ApiClient;
  private readonly basePath = "deliveries";

  constructor(client?: ApiClient) {
    this.client = client ?? getApiClient();
  }

  // Estimates
  async getEstimates(
    data: DeliveryEstimateRequest
  ): Promise<ApiResponse<DeliveryEstimate[]>> {
    return this.client.post(`${this.basePath}/estimate`, data);
  }

  // Create delivery
  async createDelivery(
    data: CreateDeliveryRequest
  ): Promise<ApiResponse<Delivery>> {
    return this.client.post(this.basePath, data);
  }

  // Get delivery
  async getDelivery(id: string): Promise<ApiResponse<Delivery>> {
    return this.client.get(`${this.basePath}/${id}`);
  }

  // Track by tracking number
  async trackDelivery(trackingNumber: string): Promise<ApiResponse<Delivery>> {
    return this.client.get(`${this.basePath}/track/${trackingNumber}`);
  }

  // Get delivery history
  async getDeliveryHistory(
    filters?: DeliveryFilters
  ): Promise<PaginatedResponse<Delivery>> {
    return this.client.get(this.basePath, { searchParams: filters as any });
  }

  // Get active deliveries
  async getActiveDeliveries(): Promise<ApiResponse<Delivery[]>> {
    return this.client.get(`${this.basePath}/active`);
  }

  // Cancel delivery
  async cancelDelivery(
    id: string,
    reason?: string
  ): Promise<ApiResponse<Delivery>> {
    return this.client.post(`${this.basePath}/${id}/cancel`, { reason });
  }

  // Reschedule delivery
  async rescheduleDelivery(
    id: string,
    scheduledPickupTime: string
  ): Promise<ApiResponse<Delivery>> {
    return this.client.patch(`${this.basePath}/${id}/reschedule`, {
      scheduledPickupTime,
    });
  }

  // Update delivery address
  async updateDeliveryAddress(
    id: string,
    type: "pickup" | "dropoff",
    address: Partial<Address>
  ): Promise<ApiResponse<Delivery>> {
    return this.client.patch(`${this.basePath}/${id}/address`, {
      type,
      address,
    });
  }

  // Real-time tracking
  getDeliveryTrackingUrl(deliveryId: string): string {
    return `${this.client.getBaseUrl()}/ws/deliveries/${deliveryId}`;
  }

  // Driver/Courier endpoints
  async getAssignedDeliveries(): Promise<ApiResponse<Delivery[]>> {
    return this.client.get(`${this.basePath}/assigned`);
  }

  async getAvailableDeliveries(
    location: Coordinates
  ): Promise<ApiResponse<Delivery[]>> {
    return this.client.get(`${this.basePath}/available`, {
      searchParams: { lat: location.latitude, lng: location.longitude },
    });
  }

  async acceptDelivery(id: string): Promise<ApiResponse<Delivery>> {
    return this.client.post(`${this.basePath}/${id}/accept`);
  }

  async confirmPickup(
    id: string,
    photo?: File
  ): Promise<ApiResponse<Delivery>> {
    if (photo) {
      return this.client.upload(
        `${this.basePath}/${id}/pickup`,
        photo,
        "photo"
      );
    }
    return this.client.post(`${this.basePath}/${id}/pickup`);
  }

  async updateDeliveryLocation(
    id: string,
    location: Coordinates
  ): Promise<ApiResponse<void>> {
    return this.client.post(`${this.basePath}/${id}/location`, location);
  }

  async completeDelivery(
    id: string,
    proof: {
      photo?: File;
      signature?: string;
      recipientName?: string;
      notes?: string;
    }
  ): Promise<ApiResponse<Delivery>> {
    const formData = new FormData();
    if (proof.photo) formData.append("photo", proof.photo);
    if (proof.signature) formData.append("signature", proof.signature);
    if (proof.recipientName)
      formData.append("recipientName", proof.recipientName);
    if (proof.notes) formData.append("notes", proof.notes);

    return this.client
      .getInstance()
      .post(`${this.basePath}/${id}/complete`, {
        body: formData,
      })
      .json();
  }

  async reportDeliveryIssue(
    id: string,
    issue: { type: string; description: string; photo?: File }
  ): Promise<ApiResponse<void>> {
    if (issue.photo) {
      return this.client.upload(
        `${this.basePath}/${id}/issue`,
        issue.photo,
        "photo",
        { type: issue.type, description: issue.description }
      );
    }
    return this.client.post(`${this.basePath}/${id}/issue`, {
      type: issue.type,
      description: issue.description,
    });
  }

  // Admin/Stats
  async getDeliveryStats(
    dateFrom: string,
    dateTo: string
  ): Promise<ApiResponse<DeliveryStats>> {
    return this.client.get(`${this.basePath}/stats`, {
      searchParams: { dateFrom, dateTo },
    });
  }
}

export interface DeliveryStats {
  totalDeliveries: number;
  completedDeliveries: number;
  cancelledDeliveries: number;
  failedDeliveries: number;
  totalRevenue: Money;
  averageDeliveryTime: number; // minutes
  onTimeRate: number; // percentage
  deliveriesByStatus: Record<DeliveryStatus, number>;
  deliveriesByPriority: Record<DeliveryPriority, number>;
}

// Export singleton instance
let deliveryServiceApi: DeliveryServiceApi | null = null;

export function getDeliveryServiceApi(): DeliveryServiceApi {
  deliveryServiceApi ??= new DeliveryServiceApi();
  return deliveryServiceApi;
}
