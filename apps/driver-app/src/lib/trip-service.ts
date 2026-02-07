/**
 * Trip Service
 *
 * Handles trip requests, history, and active trip management.
 */

import apiClient, { type ApiResponse } from "./api-client";

// ============================================
// Types
// ============================================

export type TripStatus =
  | "requested"
  | "accepted"
  | "arrived"
  | "started"
  | "completed"
  | "cancelled";

export type TripType = "ride" | "delivery";

export interface TripRequest {
  id: string;
  type: TripType;
  pickupAddress: string;
  pickupLatitude: number;
  pickupLongitude: number;
  dropoffAddress: string;
  dropoffLatitude: number;
  dropoffLongitude: number;
  estimatedDistance: number; // in meters
  estimatedDuration: number; // in seconds
  estimatedEarnings: number;
  riderName: string;
  riderPhone?: string;
  riderRating: number;
  riderPhoto?: string;
  paymentMethod: "cash" | "wallet" | "mpesa";
  scheduledAt?: string;
  expiresAt: string;
}

export interface Trip {
  id: string;
  type: TripType;
  status: TripStatus;
  pickupAddress: string;
  pickupLatitude: number;
  pickupLongitude: number;
  dropoffAddress: string;
  dropoffLatitude: number;
  dropoffLongitude: number;
  distance: number;
  duration: number;
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  tip?: number;
  totalEarnings: number;
  platformFee: number;
  riderName: string;
  riderPhone?: string;
  riderRating?: number;
  driverRating?: number;
  paymentMethod: string;
  paymentStatus: "pending" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  createdAt: string;
}

export interface TripHistory {
  trips: Trip[];
  meta: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// ============================================
// Service
// ============================================

export const tripService = {
  /**
   * Get active trip (if any)
   */
  async getActiveTrip(): Promise<ApiResponse<Trip | null>> {
    return apiClient.get("/trips/active");
  },

  /**
   * Accept a trip request
   */
  async acceptTrip(tripId: string): Promise<ApiResponse<{ trip: Trip }>> {
    return apiClient.post(`/trips/${tripId}/accept`);
  },

  /**
   * Decline a trip request
   */
  async declineTrip(
    tripId: string,
    reason?: string,
  ): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient.post(`/trips/${tripId}/decline`, { reason });
  },

  /**
   * Mark arrived at pickup
   */
  async arriveAtPickup(tripId: string): Promise<ApiResponse<{ trip: Trip }>> {
    return apiClient.post(`/trips/${tripId}/arrive`);
  },

  /**
   * Start trip
   */
  async startTrip(tripId: string): Promise<ApiResponse<{ trip: Trip }>> {
    return apiClient.post(`/trips/${tripId}/start`);
  },

  /**
   * Complete trip
   */
  async completeTrip(
    tripId: string,
    finalLocation?: { latitude: number; longitude: number },
  ): Promise<ApiResponse<{ trip: Trip; earnings: number }>> {
    return apiClient.post(`/trips/${tripId}/complete`, finalLocation);
  },

  /**
   * Cancel trip
   */
  async cancelTrip(
    tripId: string,
    reason: string,
  ): Promise<ApiResponse<{ success: boolean; penaltyApplied?: boolean }>> {
    return apiClient.post(`/trips/${tripId}/cancel`, { reason });
  },

  /**
   * Get trip history
   */
  async getHistory(
    page = 1,
    limit = 20,
    filters?: {
      type?: TripType;
      status?: TripStatus;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<ApiResponse<TripHistory>> {
    const params: Record<string, string> = {
      page: page.toString(),
      limit: limit.toString(),
    };

    if (filters?.type) params.type = filters.type;
    if (filters?.status) params.status = filters.status;
    if (filters?.startDate) params.startDate = filters.startDate;
    if (filters?.endDate) params.endDate = filters.endDate;

    return apiClient.get("/trips/history", params);
  },

  /**
   * Get trip details
   */
  async getTripDetails(tripId: string): Promise<ApiResponse<Trip>> {
    return apiClient.get(`/trips/${tripId}`);
  },

  /**
   * Rate a rider
   */
  async rateRider(
    tripId: string,
    rating: number,
    feedback?: string,
  ): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient.post(`/trips/${tripId}/rate`, { rating, feedback });
  },

  /**
   * Report issue with trip
   */
  async reportIssue(
    tripId: string,
    issueType: string,
    description: string,
  ): Promise<ApiResponse<{ ticketId: string }>> {
    return apiClient.post(`/trips/${tripId}/report`, {
      issueType,
      description,
    });
  },
};

export default tripService;
