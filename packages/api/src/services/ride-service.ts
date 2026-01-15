/**
 * Ride Service API
 *
 * API client for ride-related operations (UBI Move).
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

// Ride types
export type RideStatus =
  | "pending"
  | "searching"
  | "accepted"
  | "arriving"
  | "started"
  | "completed"
  | "cancelled";

export type RideType = "economy" | "comfort" | "premium" | "xl" | "moto";

export interface Ride extends Timestamps {
  id: string;
  riderId: string;
  driverId?: string;
  status: RideStatus;
  type: RideType;
  pickup: Address;
  dropoff: Address;
  waypoints?: Address[];
  estimatedDuration: number; // minutes
  estimatedDistance: number; // meters
  actualDuration?: number;
  actualDistance?: number;
  fare: RideFare;
  paymentMethod: string;
  rating?: number;
  review?: string;
  cancelReason?: string;
  cancelledBy?: "rider" | "driver" | "system";
  startedAt?: string;
  completedAt?: string;
}

export interface RideFare {
  baseFare: Money;
  distanceFare: Money;
  timeFare: Money;
  surgeFare?: Money;
  discount?: Money;
  tips?: Money;
  total: Money;
  surgeMultiplier?: number;
}

export interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  rating: number;
  totalRides: number;
  vehicle: Vehicle;
  location?: Coordinates;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  licensePlate: string;
  photoUrl?: string;
}

export interface RideEstimate {
  type: RideType;
  displayName: string;
  estimatedFare: {
    min: Money;
    max: Money;
  };
  estimatedDuration: number;
  estimatedDistance: number;
  surgeMultiplier?: number;
  eta: number; // minutes until pickup
  available: boolean;
}

// Request/Response types
export interface RequestRideRequest {
  pickup: {
    coordinates: Coordinates;
    address?: string;
  };
  dropoff: {
    coordinates: Coordinates;
    address?: string;
  };
  waypoints?: {
    coordinates: Coordinates;
    address?: string;
  }[];
  type: RideType;
  paymentMethod: string;
  promoCode?: string;
  notes?: string;
  scheduledFor?: string;
}

export interface RideEstimateRequest {
  pickup: Coordinates;
  dropoff: Coordinates;
  waypoints?: Coordinates[];
}

export interface RideFilters extends PaginationParams {
  status?: RideStatus;
  type?: RideType;
  riderId?: string;
  driverId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface RideLocationUpdate {
  coordinates: Coordinates;
  heading?: number;
  speed?: number;
  accuracy?: number;
}

export interface RateRideRequest {
  rating: number;
  review?: string;
  tip?: number;
}

// Ride Service API
export class RideServiceApi {
  private client: ApiClient;
  private basePath = "rides";

  constructor(client?: ApiClient) {
    this.client = client ?? getApiClient();
  }

  // Ride estimates
  async getEstimates(
    data: RideEstimateRequest,
  ): Promise<ApiResponse<RideEstimate[]>> {
    return this.client.post(`${this.basePath}/estimate`, data);
  }

  // Request a ride
  async requestRide(data: RequestRideRequest): Promise<ApiResponse<Ride>> {
    return this.client.post(this.basePath, data);
  }

  // Get ride details
  async getRide(id: string): Promise<ApiResponse<Ride & { driver?: Driver }>> {
    return this.client.get(`${this.basePath}/${id}`);
  }

  // Cancel a ride
  async cancelRide(id: string, reason?: string): Promise<ApiResponse<Ride>> {
    return this.client.post(`${this.basePath}/${id}/cancel`, { reason });
  }

  // Rate a ride
  async rateRide(
    id: string,
    data: RateRideRequest,
  ): Promise<ApiResponse<Ride>> {
    return this.client.post(`${this.basePath}/${id}/rate`, data);
  }

  // Get ride history (for riders)
  async getRideHistory(
    filters?: RideFilters,
  ): Promise<PaginatedResponse<Ride>> {
    return this.client.get(`${this.basePath}/history`, {
      searchParams: filters as any,
    });
  }

  // Get current active ride
  async getActiveRide(): Promise<
    ApiResponse<(Ride & { driver?: Driver }) | null>
  > {
    return this.client.get(`${this.basePath}/active`);
  }

  // Get nearby drivers (for showing on map)
  async getNearbyDrivers(
    location: Coordinates,
    radius?: number,
  ): Promise<ApiResponse<{ drivers: Coordinates[]; count: number }>> {
    return this.client.get(`${this.basePath}/nearby-drivers`, {
      searchParams: {
        lat: location.latitude,
        lng: location.longitude,
        radius: radius ?? 5000,
      },
    });
  }

  // Subscribe to ride updates (returns WebSocket URL)
  getRideUpdatesUrl(rideId: string): string {
    // WebSocket URL is constructed based on the API base URL
    return `/ws/rides/${rideId}`;
  }

  // Driver endpoints
  async getAvailableRides(location: Coordinates): Promise<ApiResponse<Ride[]>> {
    return this.client.get(`${this.basePath}/available`, {
      searchParams: {
        lat: location.latitude,
        lng: location.longitude,
      },
    });
  }

  async acceptRide(id: string): Promise<ApiResponse<Ride>> {
    return this.client.post(`${this.basePath}/${id}/accept`);
  }

  async arriveAtPickup(id: string): Promise<ApiResponse<Ride>> {
    return this.client.post(`${this.basePath}/${id}/arrive`);
  }

  async startRide(id: string): Promise<ApiResponse<Ride>> {
    return this.client.post(`${this.basePath}/${id}/start`);
  }

  async completeRide(id: string): Promise<ApiResponse<Ride>> {
    return this.client.post(`${this.basePath}/${id}/complete`);
  }

  async updateLocation(
    id: string,
    location: RideLocationUpdate,
  ): Promise<ApiResponse<void>> {
    return this.client.post(`${this.basePath}/${id}/location`, location);
  }

  // Admin endpoints
  async getRides(filters?: RideFilters): Promise<PaginatedResponse<Ride>> {
    return this.client.get(this.basePath, { searchParams: filters as any });
  }

  async getRideStats(
    dateFrom: string,
    dateTo: string,
  ): Promise<ApiResponse<RideStats>> {
    return this.client.get(`${this.basePath}/stats`, {
      searchParams: { dateFrom, dateTo },
    });
  }
}

export interface RideStats {
  totalRides: number;
  completedRides: number;
  cancelledRides: number;
  totalRevenue: Money;
  averageRating: number;
  averageDuration: number;
  averageDistance: number;
  ridesByType: Record<RideType, number>;
  ridesByStatus: Record<RideStatus, number>;
}

// Export singleton instance
let rideServiceApi: RideServiceApi | null = null;

export function getRideServiceApi(): RideServiceApi {
  if (!rideServiceApi) {
    rideServiceApi = new RideServiceApi();
  }
  return rideServiceApi;
}
